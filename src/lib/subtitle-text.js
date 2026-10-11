import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TIMESTAMP_LINE = /^\s*\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}(?:\s.*)?$/;
const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function normalizeCaption(text) {
  return text
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name) => {
      const normalized = name.toLowerCase();
      if (!normalized.startsWith('#')) return HTML_ENTITIES[normalized];
      const code = normalized.startsWith('#x') ? parseInt(normalized.slice(2), 16) : Number(normalized.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
    })
    .replace(/[\s\p{White_Space}\p{Cf}]+/gu, '');
}

export function cleanSrtText(srt) {
  const lines = String(srt).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const captions = [];
  let caption = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (TIMESTAMP_LINE.test(line)) {
      if (caption) captions.push(normalizeCaption(caption.join('\n')));
      caption = [];
    } else if (/^\s*\d+\s*$/.test(line) && TIMESTAMP_LINE.test(lines[index + 1] || '')) {
      continue;
    } else if (caption) {
      caption.push(line);
    }
  }
  if (caption) captions.push(normalizeCaption(caption.join('\n')));

  const chunks = [];
  let previous = '';
  for (const text of captions) {
    if (!text) continue;
    let addition = text;
    if (previous && previous.startsWith(text)) {
      addition = '';
    } else if (previous && text.startsWith(previous)) {
      addition = text.slice(previous.length);
    } else {
      const left = Array.from(previous);
      const right = Array.from(text);
      for (let overlap = Math.min(left.length, right.length); overlap >= 2; overlap -= 1) {
        if (left.slice(-overlap).join('') === right.slice(0, overlap).join('')) {
          addition = right.slice(overlap).join('');
          break;
        }
      }
    }
    chunks.push(addition);
    previous = text;
  }
  return chunks.join('');
}

export async function exportSubtitleText(filePath) {
  const outputPath = filePath.slice(0, -path.extname(filePath).length) + '_清理.txt';
  const text = cleanSrtText(await readFile(filePath, 'utf8'));
  try {
    await writeFile(outputPath, text, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await lstat(outputPath)).isFile()) throw error;
  }
  return outputPath;
}
