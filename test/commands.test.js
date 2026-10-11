import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDownloadTasks, buildProbeArguments } from '../src/lib/commands.js';

const request = {
  url: 'https://www.bilibili.com/video/BV123',
  directory: '/tmp/BiliFetch',
  outputs: { video: true, audio: true, subtitles: true },
  subtitleTypes: ['manual'],
  subtitleLanguages: ['zh'],
  quality: '1080',
  cookie: { type: 'file', path: '/tmp/bilifetch-cookies.txt' },
};

test('builds a probe command with the persisted cookie file and no playlist', () => {
  const args = buildProbeArguments(request);
  assert.ok(args.includes('--list-subs'));
  assert.ok(args.includes('--cookies'));
  assert.ok(args.includes('/tmp/bilifetch-cookies.txt'));
  assert.ok(!args.includes('--cookies-from-browser'));
  assert.equal(args.at(-1), request.url);
});

test('builds independent video, audio and subtitle tasks', () => {
  const tasks = buildDownloadTasks(request, [{ tag: 'zh-Hans', type: 'manual', language: 'zh' }]);
  assert.deepEqual(tasks.map((task) => task.id), ['video', 'audio', 'subtitles']);
  assert.ok(tasks[0].arguments.includes('bv*[height<=1080]+ba/b[height<=1080]'));
  assert.ok(tasks[1].arguments.includes('--extract-audio'));
  assert.ok(tasks[2].arguments.includes('zh-Hans'));
});

test('omits only the subtitle task when no selected track exists', () => {
  const tasks = buildDownloadTasks(request, []);
  assert.deepEqual(tasks.map((task) => task.id), ['video', 'audio']);
});

test('downloads automatic caption sources and converts subtitles to SRT', () => {
  const tasks = buildDownloadTasks(request, [{ tag: 'zh', type: 'ai', language: 'zh', source: 'automatic' }]);
  const subtitles = tasks.find((task) => task.id === 'subtitles');
  assert.ok(subtitles.arguments.includes('--write-auto-subs'));
  assert.equal(subtitles.arguments[subtitles.arguments.indexOf('--convert-subs') + 1], 'srt');
  assert.ok(subtitles.arguments.includes('after_video:SUBTITLE_FILES:%(requested_subtitles.:.filepath)j'));
  assert.ok(subtitles.arguments.includes('--no-simulate'));
  assert.ok(buildProbeArguments(request).includes('--skip-download'));
});
