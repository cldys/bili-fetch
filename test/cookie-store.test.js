import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CookieStore } from '../src/lib/cookie-store.js';

const VALID_COOKIES = [
  '# Netscape HTTP Cookie File',
  '.bilibili.com\tTRUE\t/\tTRUE\t2147483647\tSESSDATA\tfake-session-one',
  '.bilibili.com\tTRUE\t/\tFALSE\t2147483647\tDedeUserID\t123',
  '.example.com\tTRUE\t/\tFALSE\t2147483647\tother\tremove-me',
].join('\n');

async function withStore(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bilifetch-test-'));
  const directory = path.join(root, 'data');
  try {
    await run(new CookieStore({ directory }), directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('reports a missing persistent cookie file as not configured', async () => {
  await withStore(async (store) => {
    assert.deepEqual(await store.initialize(), {
      configured: false,
      cookieCount: 0,
      hasSessionCookie: false,
      updatedAt: null,
    });
    assert.throws(() => store.resolve(), /请先导入/);
  });
});

test('persists only Bilibili cookies with private permissions and reloads them', async () => {
  await withStore(async (store, directory) => {
    await store.initialize();
    const imported = await store.importCookies({ content: VALID_COOKIES });
    assert.equal(imported.configured, true);
    assert.equal(imported.hasSessionCookie, true);
    assert.equal(imported.cookieCount, 2);

    const resolved = store.resolve();
    assert.equal(resolved.type, 'file');
    assert.equal(resolved.path, path.join(directory, 'cookies.txt'));
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(resolved.path)).mode & 0o777, 0o600);

    const saved = await readFile(resolved.path, 'utf8');
    assert.match(saved, /bilibili\.com/);
    assert.doesNotMatch(saved, /example\.com|remove-me/);

    const restarted = new CookieStore({ directory });
    assert.equal((await restarted.initialize()).configured, true);
    assert.equal(restarted.status().cookieCount, 2);
  });
});

test('keeps the previous cookie file when a replacement is invalid', async () => {
  await withStore(async (store) => {
    await store.initialize();
    await store.importCookies({ content: VALID_COOKIES });
    const before = await readFile(store.resolve().path, 'utf8');

    await assert.rejects(
      store.importCookies({ content: '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t0\tkey\tvalue' }),
      /bilibili\.com/,
    );
    assert.equal(await readFile(store.resolve().path, 'utf8'), before);
    assert.equal(store.status().configured, true);
  });
});

test('atomically replaces an existing cookie file and supports explicit clearing', async () => {
  await withStore(async (store) => {
    await store.initialize();
    await store.importCookies({ content: VALID_COOKIES });
    const replacement = VALID_COOKIES.replace('fake-session-one', 'fake-session-two');
    await store.importCookies({ content: replacement });
    const cookiePath = store.resolve().path;
    assert.match(await readFile(cookiePath, 'utf8'), /fake-session-two/);

    assert.equal((await store.clear()).configured, false);
    await assert.rejects(readFile(cookiePath, 'utf8'), { code: 'ENOENT' });
    assert.throws(() => store.resolve(), /请先导入/);
  });
});

test('rejects an expired Bilibili session cookie', async () => {
  await withStore(async (store) => {
    await store.initialize();
    const expired = '.bilibili.com\tTRUE\t/\tTRUE\t1\tSESSDATA\texpired';
    await assert.rejects(store.importCookies({ content: expired }), /有效的 Bilibili SESSDATA/);
  });
});
