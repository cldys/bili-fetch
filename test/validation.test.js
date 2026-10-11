import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBilibiliUrl, validateBilibiliUrls, validateDownloadRequest } from '../src/lib/validation.js';

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
  }, '/tmp/downloads'), /字幕类型/);
});

test('does not accept cookie selection from the browser request', () => {
  const request = validateDownloadRequest({
    url: 'https://www.bilibili.com/video/BV123',
    directory: '/tmp/downloads',
    outputs: { video: true },
    cookie: { type: 'file', path: '/tmp/untrusted.txt' },
  }, '/tmp/downloads');
  assert.equal('cookie' in request, false);
});

test('accepts multiline batches and arrays, removing blank lines and normalized duplicates', () => {
  const urls = ['https://www.bilibili.com/video/BV123', 'https://b23.tv/example'];
  assert.deepEqual(validateBilibiliUrls(`\n${urls[0]}\r\n\n${urls[1]}\n${urls[0]}/\n${urls[0]}`), [...urls, `${urls[0]}/`]);
  assert.deepEqual(validateBilibiliUrls(['', urls[0], urls[1], urls[0]]), urls);
  const request = validateDownloadRequest({ urls, outputs: { subtitles: true }, subtitleTypes: ['ai'], subtitleLanguages: ['zh'] }, '/tmp/downloads');
  assert.deepEqual(request.urls, urls);
  assert.equal(request.url, urls[0]);
});

test('validates every batch entry and reports the original line number', () => {
  assert.throws(() => validateBilibiliUrls('https://b23.tv/example\n\nhttps://example.com/video'), /第 3 行/);
  assert.throws(() => validateBilibiliUrls(['https://b23.tv/example', 'https://user:password@b23.tv/another']), /第 2 行/);
  assert.throws(() => validateBilibiliUrls('\n\n'), /至少输入/);
  assert.throws(() => validateBilibiliUrls('https://b23.tv/one https://b23.tv/two'), /第 1 行/);
});
