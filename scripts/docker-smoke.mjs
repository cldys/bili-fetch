import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only generated fixtures are mounted. Existing downloads and login data are never used.
const projectDirectory = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'bilifetch-docker-smoke-'));
const downloads = path.join(temporary, '共享 Downloads');
const data = path.join(temporary, 'data');
await mkdir(downloads);
await mkdir(data);
const env = { ...process.env,
  BILIFETCH_HOST_DOWNLOADS_DIRECTORY: downloads,
  BILIFETCH_HOST_DATA_DIRECTORY: data,
  BILIFETCH_HOST_PORT: '0',
  BILIFETCH_UID: String(process.getuid()),
  BILIFETCH_GID: String(process.getgid()),
};
const composeArgs = ['compose', '-p', `bilifetch-smoke-${process.pid}`, '-f', path.join(projectDirectory, 'compose.yaml')];
function compose(args, capture = false) {
  return execFileSync('docker', [...composeArgs, ...args], { env, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' })?.trim();
}
let base;
async function request(endpoint, body) {
  const response = await fetch(`${base}${endpoint}`, body === undefined ? {}
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.ok, true, result.error);
  return result;
}
try {
  compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '60']);
  base = `http://${compose(['port', 'bilifetch', '4317'], true)}`;
  const health = await request('/api/health');
  assert.equal(health.ok, true);
  assert.equal(health.tools.ytDlp.found, true);
  assert.equal(health.tools.ffmpeg.found, true);
  assert.equal(health.defaultDirectory, path.join(downloads, 'download', 'BiliFetch'));
  console.log('PASS: container health and download tools');

  const root = await request('/api/directories');
  assert.deepEqual(root.directories.map((entry) => entry.path), [downloads]);
  const { directory } = await request('/api/directories', { directory: downloads, name: '中文 folder' });
  await request('/api/select-directory', { directory });
  assert.equal((await stat(directory)).isDirectory(), true);
  const rejected = await fetch(`${base}/api/directories?path=${encodeURIComponent('/data')}`);
  assert.equal(rejected.status, 400);
  console.log('PASS: web folder creation writes to Mac and rejects unshared paths');

  const video = path.join(directory, 'Video', 'smoke.mp4');
  const audio = path.join(directory, 'Audio', 'smoke.m4a');
  const subtitle = path.join(directory, 'Subtitles', '测试.ai-zh.srt');
  const fixtureScript = `
    import { mkdir, writeFile } from 'node:fs/promises';
    import path from 'node:path';
    import { exportSubtitleText } from './src/lib/subtitle-text.js';
    for (const directory of JSON.parse(process.argv[1])) await mkdir(directory, { recursive: true });
    await writeFile(process.argv[2], '1\\n00:00:00,000 --> 00:00:01,000\\n大家好\\n\\n2\\n00:00:01,000 --> 00:00:02,000\\n大家好今天学习。\\n');
    await exportSubtitleText(process.argv[2]);
  `;
  compose(['exec', '-T', 'bilifetch', 'node', '--input-type=module', '-e', fixtureScript,
    JSON.stringify([path.dirname(video), path.dirname(audio), path.dirname(subtitle)]), subtitle]);
  compose(['exec', '-T', 'bilifetch', 'ffmpeg', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.2', '-c:v', 'libx264', video]);
  compose(['exec', '-T', 'bilifetch', 'ffmpeg', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0.2', '-c:a', 'aac', audio]);
  for (const file of [video, audio, subtitle]) {
    const info = await stat(file);
    assert.ok(info.size > 0);
    assert.equal(info.uid, process.getuid());
  }
  assert.equal(await readFile(subtitle.replace(/\.srt$/, '_清理.txt'), 'utf8'), '大家好今天学习。');
  console.log('PASS: container-generated MP4, M4A, SRT and TXT are readable on Mac with matching ownership');

  await request('/api/cookies/import', {
    content: '# Netscape HTTP Cookie File\n.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tfixture-session\n',
  });
  compose(['up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '60']);
  base = `http://${compose(['port', 'bilifetch', '4317'], true)}`;
  assert.equal((await request('/api/cookies/status')).configured, true);
  assert.ok((await stat(video)).size > 0);
  assert.equal((await request(`/api/directories?path=${encodeURIComponent(directory)}`)).directory, directory);
  console.log('PASS: downloaded files and fixture login state survive container recreation');

  compose(['run', '--rm', '--no-deps', '--volume', `${path.join(projectDirectory, 'test')}:/app/test:ro`,
    'bilifetch', 'node', '--test', '--test-reporter=dot']);
  console.log('PASS: full test suite inside the Linux container');
} finally {
  try {
    compose(['down']);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
