import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanSrtText, exportSubtitleText } from '../src/lib/subtitle-text.js';

function srt(captions, newline = '\n') {
  return captions.map((caption, index) => `${index + 1}\n00:00:01,000 --> 00:00:02,000\n${caption}`).join('\n\n').replaceAll('\n', newline);
}

test('cleans the rolling subtitle example into one paragraph', () => {
  assert.equal(cleanSrtText(srt(['大家好', '大家好今天', '今天我们来聊', '我们来聊学习', '我们来聊学习', '效率提升。'])),
    '大家好今天我们来聊学习效率提升。');
});

test('removes markup, entities and invisible whitespace while preserving punctuation and spoken numbers', () => {
  const input = '\uFEFF' + srt(['<font color="red"><b> 大家\u200b好 </b></font>\n今天\u2060学习。',
    '2026', 'A&nbsp;B&amp;C&#33;&#x1F600;'], '\r\n');
  assert.equal(cleanSrtText(input), '大家好今天学习。2026AB&C!😀');
});

test('deduplicates adjacent captions and expansions but preserves nonadjacent repeats', () => {
  assert.equal(cleanSrtText(srt(['你好', '你好', '你好世界', '你好', '其他内容。', '你好'])), '你好世界其他内容。你好');
});

test('uses the longest overlap of at least two Unicode characters', () => {
  assert.equal(cleanSrtText(srt(['甲乙', '乙丙'])), '甲乙乙丙');
  assert.equal(cleanSrtText(srt(['甲乙丙', '乙丙丁'])), '甲乙丙丁');
  assert.equal(cleanSrtText(srt(['开场😀😀', '😀😀结束。'])), '开场😀😀结束。');
  assert.equal(cleanSrtText(srt(['开场😀', '😀结束。'])), '开场😀😀结束。');
});

test('handles empty captions and timestamp settings without exporting SRT headers', () => {
  assert.equal(cleanSrtText(''), '');
  assert.equal(cleanSrtText(srt(['', '正文。'])), '正文。');
  assert.equal(cleanSrtText('1\n00:00:01.000 --> 00:00:02.000 X1:10 X2:20\n正文。\n'), '正文。');
});

test('creates a UTF-8 TXT next to the SRT without modifying the SRT or an existing TXT', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bilifetch-subtitle-text-test-'));
  try {
    const file = path.join(directory, '视频标题 [BV123].ai-zh.srt');
    const original = srt(['大家好', '大家好今天', '今天学习。']);
    await writeFile(file, original);
    const txt = await exportSubtitleText(file);
    assert.equal(txt, path.join(directory, '视频标题 [BV123].ai-zh_清理.txt'));
    assert.equal(await readFile(txt, 'utf8'), '大家好今天学习。');
    assert.equal(await readFile(file, 'utf8'), original);
    await writeFile(txt, 'Existing text');
    await exportSubtitleText(file);
    assert.equal(await readFile(txt, 'utf8'), 'Existing text');
    assert.equal((await readdir(directory)).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
