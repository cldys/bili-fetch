import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySubtitleTag, parseProbeOutput, selectSubtitleTracks } from '../src/lib/subtitles.js';

test('classifies Bilibili manual and AI subtitle tags', () => {
  assert.deepEqual(classifySubtitleTag('zh-Hans'), { tag: 'zh-Hans', type: 'manual', language: 'zh' });
  assert.deepEqual(classifySubtitleTag('en-US'), { tag: 'en-US', type: 'manual', language: 'en' });
  assert.deepEqual(classifySubtitleTag('ai-zh'), { tag: 'ai-zh', type: 'ai', language: 'zh' });
  assert.deepEqual(classifySubtitleTag('ai-en'), { tag: 'ai-en', type: 'ai', language: 'en' });
  assert.equal(classifySubtitleTag('danmaku'), null);
  assert.equal(classifySubtitleTag('ja'), null);
});

test('parses machine-readable probe output and excludes danmaku', () => {
  const metadata = {
    id: 'BV123',
    title: 'Example',
    thumbnail: 'http://i0.hdslb.com/example.jpg',
    subtitles: { danmaku: [{}], 'zh-Hans': [{}], 'ai-en': [{}] },
    automatic_captions: {},
  };
  const result = parseProbeOutput(`noise\nPROBE:${JSON.stringify(metadata)}\n`);
  assert.equal(result.id, 'BV123');
  assert.equal(result.thumbnail, 'https://i0.hdslb.com/example.jpg');
  assert.deepEqual(result.tracks.map((track) => track.tag), ['zh-Hans', 'ai-en']);
});

test('reports missing subtitle combinations without discarding available tracks', () => {
  const tracks = [
    { tag: 'zh-Hans', type: 'manual', language: 'zh' },
    { tag: 'ai-en', type: 'ai', language: 'en' },
  ];
  const result = selectSubtitleTracks(tracks, ['manual', 'ai'], ['zh', 'en']);
  assert.deepEqual(result.tracks.map((track) => track.tag), ['zh-Hans', 'ai-en']);
  assert.deepEqual(result.missing, ['人工英文字幕', 'AI中文字幕']);
});
