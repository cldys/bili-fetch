import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createJob, friendlyFailure, getJob, subscribeToJob } from '../src/lib/jobs.js';

async function runFixtureJob(outputs, metadata, probeFails = false, urls, queueAnother = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bilifetch-job-test-'));
  try {
    const subtitlesDirectory = path.join(directory, 'Subtitles');
    await mkdir(subtitlesDirectory);
    await writeFile(path.join(subtitlesDirectory, 'Unrelated.srt'), 'Unrelated file');
    const executable = path.join(directory, 'fake-yt-dlp');
    const callsFile = path.join(directory, 'calls.jsonl');
    await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_CALLS, JSON.stringify(args) + '\\n');
const fixture = JSON.parse(process.env.FIXTURE_METADATA);
const metadata = fixture.byUrl ? fixture.byUrl[args.at(-1)] : fixture;
if (args.includes('--list-subs')) {
  if (process.env.FIXTURE_FAIL === 'true' || metadata.failProbe) {
    console.error('ERROR: fixture probe failed');
    process.exit(1);
  }
  console.log('PROBE:' + JSON.stringify(metadata));
} else if (metadata.failDownload) {
  console.error('ERROR: fixture download failed');
  process.exit(1);
} else if (args.includes('--write-subs')) {
  const output = args[args.indexOf('--paths') + 1];
  const files = args[args.indexOf('--sub-langs') + 1].split(',').map((tag) => {
    const file = path.join(output, 'Fixture [' + metadata.id + '].' + tag + '.srt');
    fs.writeFileSync(file, '1\\n00:00:01,000 --> 00:00:02,000\\n大家好\\n\\n2\\n00:00:02,000 --> 00:00:03,000\\n大家好今天\\n');
    return file;
  });
  console.log('SUBTITLE_FILES:' + JSON.stringify(files));
} else console.log('[download] 100%');
`, { mode: 0o700 });
    const request = {
      url: 'https://www.bilibili.com/video/BV123', directory,
      ...(urls ? { urls } : {}),
      outputs, quality: 'best', subtitleTypes: ['ai'], subtitleLanguages: ['zh'],
      cookie: { type: 'file', path: path.join(directory, 'fake-cookies.txt') },
    };
    const env = { ...process.env, FIXTURE_CALLS: callsFile, FIXTURE_METADATA: JSON.stringify(metadata), FIXTURE_FAIL: String(probeFails) };
    const job = createJob(request, executable, env);
    const following = queueAnother ? createJob(request, executable, env) : null;
    const history = [];
    subscribeToJob(job.id, { write(message) { history.push(JSON.parse(message.slice('data: '.length))); }, on() {} });
    let finished;
    for (const id of [job.id, ...(following ? [following.id] : [])]) {
      let state;
      for (let attempt = 0; attempt < 300; attempt += 1) {
        state = getJob(id);
        if (!['queued', 'probing', 'downloading'].includes(state.status)) break;
        await setTimeout(10);
      }
      assert.ok(!['queued', 'probing', 'downloading'].includes(state.status), 'fixture job completed within timeout');
      if (id === job.id) finished = state;
    }
    assert.ok(!['queued', 'probing', 'downloading'].includes(finished.status), 'fixture job completed within timeout');
    const calls = (await readFile(callsFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const artifacts = Object.fromEntries(await Promise.all((await readdir(subtitlesDirectory))
      .map(async (file) => [file, await readFile(path.join(subtitlesDirectory, file), 'utf8')])));
    return { job: finished, calls, artifacts, history };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('missing Bilibili subtitles do not interrupt video and complete audio tasks', async () => {
  const { job, calls } = await runFixtureJob({ video: true, audio: true, subtitles: true }, { id: 'BV123', subtitles: {} });
  assert.equal(job.status, 'completed');
  assert.deepEqual(job.tasks.map((task) => [task.id, task.status]), [['video', 'completed'], ['audio', 'completed']]);
  assert.ok(job.warnings.some((warning) => warning.includes('已跳过')));
  assert.equal(calls.length, 3);
  assert.ok(calls.every((args) => !args.includes('--write-subs')));
});

test('subtitle-only requests with no Bilibili subtitles finish as skipped', async () => {
  const { job, calls } = await runFixtureJob({ subtitles: true }, { id: 'BV123', subtitles: {} });
  assert.equal(job.status, 'skipped');
  assert.match(job.message, /已跳过/);
  assert.deepEqual(job.tasks, []);
  assert.equal(calls.length, 1);
});

test('downloads available Bilibili AI subtitles with the existing default', async () => {
  const { job, calls, artifacts } = await runFixtureJob({ subtitles: true }, { id: 'BV123', subtitles: { 'ai-zh': [{}] } });
  assert.equal(job.status, 'completed');
  assert.equal(job.tasks[0].id, 'subtitles');
  assert.ok(calls[1].includes('ai-zh'));
  assert.ok(calls[1].includes('--convert-subs'));
  assert.equal(artifacts['Fixture [BV123].ai-zh_清理.txt'], '大家好今天');
  assert.ok(artifacts['Fixture [BV123].ai-zh.srt'].includes('-->'));
  assert.equal(artifacts['Unrelated.srt'], 'Unrelated file');
  assert.equal(artifacts['Unrelated_清理.txt'], undefined);
});

test('failed subtitle probing still allows a complete audio task', async () => {
  const { job } = await runFixtureJob({ audio: true, subtitles: true }, {}, true);
  assert.equal(job.status, 'completed');
  assert.equal(job.tasks[0].id, 'audio');
  assert.match(job.warnings[0], /字幕检测失败.*fixture probe failed/);
  assert.match(friendlyFailure({ stdout: '', stderr: 'ERROR: unrelated failure', code: 1 }), /unrelated failure/);
});

test('processes batch links serially and creates a separate SRT and TXT for each video', async () => {
  const urls = ['https://www.bilibili.com/video/BV1', 'https://www.bilibili.com/video/BV2'];
  const { job, calls, artifacts, history } = await runFixtureJob({ subtitles: true }, { byUrl: {
    [urls[0]]: { id: 'BV1', title: 'First', subtitles: { 'ai-zh': [{}] } },
    [urls[1]]: { id: 'BV2', title: 'Second', subtitles: { 'ai-zh': [{}] } },
  } }, false, [...urls, urls[0]]);
  assert.equal(job.status, 'completed');
  assert.equal(job.total, 2);
  assert.equal(job.processed, 2);
  assert.deepEqual(job.items.map((item) => [item.url, item.title, item.status]), [[urls[0], 'First', 'completed'], [urls[1], 'Second', 'completed']]);
  assert.deepEqual(calls.map((args) => args.at(-1)), [urls[0], urls[0], urls[1], urls[1]]);
  for (const id of ['BV1', 'BV2']) {
    assert.ok(artifacts[`Fixture [${id}].ai-zh.srt`].includes('-->'));
    assert.equal(artifacts[`Fixture [${id}].ai-zh_清理.txt`], '大家好今天');
  }
  assert.ok(history.some((state) => state.currentIndex === 2 && state.processed === 1));
  assert.ok(history.filter((state) => state.processed < state.total).every((state) => ['queued', 'probing', 'downloading'].includes(state.status)));
});

test('a failed batch download does not stop later links and missing subtitles are skipped separately', async () => {
  const urls = ['https://b23.tv/failed', 'https://b23.tv/missing', 'https://b23.tv/ready'];
  const { job, artifacts } = await runFixtureJob({ subtitles: true }, { byUrl: {
    [urls[0]]: { id: 'BV1', subtitles: { 'ai-zh': [{}] }, failDownload: true },
    [urls[1]]: { id: 'BV2', subtitles: {} },
    [urls[2]]: { id: 'BV3', subtitles: { 'ai-zh': [{}] } },
  } }, false, urls);
  assert.equal(job.status, 'partial');
  assert.equal(job.processed, 3);
  assert.deepEqual(job.items.map((item) => item.status), ['failed', 'skipped', 'completed']);
  assert.equal(artifacts['Fixture [BV3].ai-zh_清理.txt'], '大家好今天');
  assert.equal(artifacts['Fixture [BV2].ai-zh_清理.txt'], undefined);
  assert.ok(job.warnings.some((warning) => warning.startsWith('第 2 条')));
});

test('failed subtitle-only probing is a failure and the batch continues', async () => {
  const urls = ['https://b23.tv/failed', 'https://b23.tv/ready'];
  const { job } = await runFixtureJob({ subtitles: true }, { byUrl: {
    [urls[0]]: { id: 'BV1', subtitles: {}, failProbe: true },
    [urls[1]]: { id: 'BV2', subtitles: { 'ai-zh': [{}] } },
  } }, false, urls);
  assert.equal(job.status, 'partial');
  assert.deepEqual(job.items.map((item) => item.status), ['failed', 'completed']);
});

test('separate batches share a FIFO queue instead of downloading simultaneously', async () => {
  const urls = ['https://b23.tv/first', 'https://b23.tv/second'];
  const { job, calls } = await runFixtureJob({ subtitles: true }, { byUrl: {
    [urls[0]]: { id: 'BV1', subtitles: { 'ai-zh': [{}] } },
    [urls[1]]: { id: 'BV2', subtitles: { 'ai-zh': [{}] } },
  } }, false, urls, true);
  assert.equal(job.status, 'completed');
  assert.deepEqual(calls.map((args) => args.at(-1)), [urls[0], urls[0], urls[1], urls[1], urls[0], urls[0], urls[1], urls[1]]);
});
