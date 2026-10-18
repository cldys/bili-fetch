import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('HTTP directory picker validates shared paths and persists isolated login data across restarts', { timeout: 20_000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bilifetch-server-test-'));
  const root = path.join(directory, '共享 Downloads');
  const data = path.join(directory, 'data');
  const defaultDirectory = path.join(root, 'download', 'BiliFetch');
  await mkdir(root);
  await mkdir(data);
  await symlink(data, path.join(root, 'outside-link'));
  const children = [];
  async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  t.after(async () => {
    for (const child of children) await stop(child);
    await rm(directory, { recursive: true, force: true });
  });
  async function start() {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.js', import.meta.url))], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: '0', BILIFETCH_DATA_DIRECTORY: data,
        BILIFETCH_DOWNLOAD_DIRECTORY: defaultDirectory, BILIFETCH_DOWNLOAD_ROOTS: JSON.stringify([root]) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '';
    child.stderr.on('data', (chunk) => { output += chunk; });
    const base = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', () => reject(new Error(`Server exited before startup: ${output}`)));
      child.stdout.on('data', (chunk) => {
        const address = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (address) resolve(address[0]);
      });
    });
    return { child, base };
  }
  let { child, base } = await start();
  const request = async (endpoint, body, headers = {}) => {
    const response = await fetch(`${base}${endpoint}`, body === undefined ? { headers }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await stat(defaultDirectory)).isDirectory(), true);
  const roots = await request('/api/directories');
  assert.deepEqual(roots.data.directories.map((entry) => entry.path), [root]);
  const listing = await request(`/api/directories?path=${encodeURIComponent(root)}`);
  assert.equal(listing.data.directories.some((entry) => entry.name === 'outside-link'), false);
  const created = await request('/api/directories', { directory: root, name: '中文 folder' });
  assert.equal(created.status, 201);
  assert.equal((await stat(path.join(root, '中文 folder'))).isDirectory(), true);
  const selected = await request('/api/select-directory', { directory: created.data.directory });
  assert.equal(selected.status, 200);
  for (const location of [data, path.join(root, '..'), path.join(root, 'outside-link')]) {
    assert.equal((await request('/api/select-directory', { directory: location })).status, 400);
  }
  const foreign = await request('/api/directories', { directory: root, name: 'foreign' }, { Origin: 'https://example.com' });
  assert.equal(foreign.status, 403);
  const imported = await request('/api/cookies/import', {
    content: '# Netscape HTTP Cookie File\n.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tfixture-session\n',
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.data.configured, true);
  const invalidDownload = await request('/api/download', { url: 'https://b23.tv/fixture', directory: data, outputs: { video: true } });
  assert.equal(invalidDownload.status, 400);
  assert.match(invalidDownload.data.error, /未共享/);
  await stop(child);
  ({ child, base } = await start());
  assert.equal((await request('/api/cookies/status')).data.configured, true);
  assert.equal((await request(`/api/directories?path=${encodeURIComponent(created.data.directory)}`)).status, 200);
});
