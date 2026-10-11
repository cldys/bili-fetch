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
  cookie: { type: 'chrome' },
};

test('builds a probe command with browser cookies and no playlist', () => {
  const args = buildProbeArguments(request);
  assert.ok(args.includes('--list-subs'));
  assert.ok(args.includes('chrome'));
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
