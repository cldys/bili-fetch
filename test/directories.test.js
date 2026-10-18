import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DirectoryBrowser } from '../src/lib/directories.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bilifetch-directory-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, '共享 Downloads');
  await mkdir(root);
  return { directory, root, browser: new DirectoryBrowser([root]) };
}

test('lists folders only, navigates within the root and creates Unicode paths with spaces', async (t) => {
  const { root, browser } = await fixture(t);
  await mkdir(path.join(root, '已有 folder'));
  await writeFile(path.join(root, 'existing.txt'), 'untouched');
  const roots = await browser.list();
  assert.equal(roots.directory, null);
  assert.equal(roots.directories[0].path, root);
  const listing = await browser.list(root);
  assert.equal(listing.parent, null);
  assert.deepEqual(listing.directories.map((entry) => entry.name), ['已有 folder']);
  const created = await browser.create(root, '中文 folder');
  assert.equal(created.directory, path.join(root, '中文 folder'));
  assert.equal((await browser.list(created.directory)).parent, root);
  assert.equal(await browser.resolve(created.directory, { writable: true }), created.directory);
  assert.equal(await readFile(path.join(root, 'existing.txt'), 'utf8'), 'untouched');
});

test('rejects unshared paths, parent traversal, root-prefix lookalikes and invalid folder names', async (t) => {
  const { directory, root, browser } = await fixture(t);
  for (const candidate of [directory, path.join(root, '..', 'escape'), `${root}-other`, '/data']) {
    await assert.rejects(browser.resolve(candidate, { create: true }), /未共享/);
  }
  for (const name of ['../escape', '/absolute', 'a/b', 'a\\b', '.', '..', '', ' ', 'name\0']) {
    await assert.rejects(browser.create(root, name), /文件夹名称/);
  }
  await assert.rejects(browser.resolve('relative'), /绝对路径/);
  await assert.rejects(lstat(path.join(directory, 'escape')), { code: 'ENOENT' });
});

test('blocks escaping and dangling symlinks before creating directories', async (t) => {
  const { directory, root, browser } = await fixture(t);
  const outside = path.join(directory, 'outside');
  await mkdir(outside);
  await symlink(outside, path.join(root, 'escape'));
  await symlink(path.join(outside, 'missing'), path.join(root, 'dangling'));
  await mkdir(path.join(root, 'inside'));
  await symlink(path.join(root, 'inside'), path.join(root, 'safe-link'));
  await assert.rejects(browser.resolve(path.join(root, 'escape', 'new', 'nested'), { create: true }), /符号链接/);
  await assert.rejects(browser.resolve(path.join(root, 'dangling', 'new'), { create: true }), /符号链接/);
  await assert.rejects(lstat(path.join(outside, 'new')), { code: 'ENOENT' });
  assert.deepEqual((await browser.list(root)).directories.map((entry) => entry.name), ['inside', 'safe-link']);
  const nested = path.join(root, 'safe-link', 'new', 'nested');
  assert.equal(await browser.resolve(nested, { create: true, writable: true }), nested);
  assert.equal((await stat(path.join(root, 'inside', 'new', 'nested'))).isDirectory(), true);
});

test('does not overwrite existing paths and rejects read-only save locations', async (t) => {
  const { root, browser } = await fixture(t);
  await writeFile(path.join(root, 'existing'), 'untouched');
  await assert.rejects(browser.create(root, 'existing'), /已存在/);
  await assert.rejects(browser.resolve(path.join(root, 'existing')), /文件夹/);
  assert.equal(await readFile(path.join(root, 'existing'), 'utf8'), 'untouched');
  if (process.getuid?.() !== 0) {
    const readOnly = path.join(root, 'readonly');
    await mkdir(readOnly);
    await chmod(readOnly, 0o500);
    try {
      await assert.rejects(browser.resolve(readOnly, { writable: true }), /权限/);
    } finally {
      await chmod(readOnly, 0o700);
    }
  }
});
