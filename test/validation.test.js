import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBilibiliUrl, validateDownloadRequest } from '../src/lib/validation.js';

test('accepts Bilibili and b23.tv URLs', () => {
  assert.match(validateBilibiliUrl('https://www.bilibili.com/video/BV123'), /bilibili/);
  assert.match(validateBilibiliUrl('https://b23.tv/example'), /b23\.tv/);
});

test('rejects unrelated URLs', () => {
  assert.throws(() => validateBilibiliUrl('https://example.com/video'), /仅支持/);
});

test('requires subtitle type and language only when subtitles are selected', () => {
  assert.throws(() => validateDownloadRequest({
    url: 'https://www.bilibili.com/video/BV123',
    directory: '/tmp/downloads',
    outputs: { subtitles: true },
    subtitleTypes: [],
    subtitleLanguages: ['zh'],
    cookie: { type: 'none' },
  }, '/tmp/downloads'), /字幕类型/);
});
