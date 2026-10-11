import crypto from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MAX_COOKIE_BYTES = 512 * 1024;
const COOKIE_HEADER = '# Netscape HTTP Cookie File\n# Stored locally by BiliFetch. Do not share this file.\n';

function emptyStatus() {
  return {
    configured: false,
    cookieCount: 0,
    hasSessionCookie: false,
    updatedAt: null,
  };
}

function inspectNetscapeCookies(content) {
  const records = [];
  const now = Date.now() / 1000;
  let hasActiveSession = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.startsWith('#HttpOnly_') ? rawLine.slice('#HttpOnly_'.length) : rawLine;
    if (!line || line.startsWith('#')) continue;

    const columns = line.split('\t');
    if (columns.length !== 7) continue;
    const domain = columns[0].replace(/^\./, '').toLowerCase();
    if (domain !== 'bilibili.com' && !domain.endsWith('.bilibili.com')) continue;
    const expires = Number(columns[4]);
    if (!columns[4] || !Number.isFinite(expires) || expires < 0 || (expires !== 0 && expires <= now)) continue;
    if (!columns[2].startsWith('/') || !columns[5] || !columns[6]) continue;
    if (!['TRUE', 'FALSE'].includes(columns[1]) || !['TRUE', 'FALSE'].includes(columns[3])) continue;

    records.push(rawLine);
    if (columns[5] === 'SESSDATA') hasActiveSession = true;
  }

  return {
    valid: records.length > 0 && hasActiveSession,
    hasSessionCookie: hasActiveSession,
    count: records.length,
    content: `${COOKIE_HEADER}${records.join('\n')}\n`,
  };
}

export class CookieStore {
  #directory;
  #filePath;
  #state = emptyStatus();

  constructor({ directory } = {}) {
    this.#directory = directory || path.join(os.homedir(), 'Library', 'Application Support', 'BiliFetch');
    this.#filePath = path.join(this.#directory, 'cookies.txt');
  }

  async initialize() {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await chmod(this.#directory, 0o700);

    try {
      const [content, fileStats] = await Promise.all([
        readFile(this.#filePath, 'utf8'),
        stat(this.#filePath),
      ]);
      const inspection = inspectNetscapeCookies(content);
      if (!inspection.valid) {
        this.#state = emptyStatus();
        return this.status();
      }

      await chmod(this.#filePath, 0o600);
      this.#state = {
        configured: true,
        cookieCount: inspection.count,
        hasSessionCookie: inspection.hasSessionCookie,
        updatedAt: fileStats.mtime.toISOString(),
      };
      return this.status();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.#state = emptyStatus();
      return this.status();
    }
  }

  async importCookies({ content }) {
    if (typeof content !== 'string' || !content.trim()) throw new Error('Cookie 文件为空');
    if (Buffer.byteLength(content, 'utf8') > MAX_COOKIE_BYTES) throw new Error('Cookie 文件不能超过 512 KB');
    if (content.includes('\0')) throw new Error('Cookie 文件内容无效');

    const inspection = inspectNetscapeCookies(content);
    if (!inspection.hasSessionCookie) {
      throw new Error('cookies.txt 中缺少有效的 Bilibili SESSDATA，请登录后重新导出（需包含 bilibili.com Cookie）');
    }
    if (!inspection.valid) {
      throw new Error('请选择包含有效 bilibili.com Cookie 的 Netscape 格式 cookies.txt');
    }

    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await chmod(this.#directory, 0o700);
    const temporaryPath = path.join(this.#directory, `.cookies-${crypto.randomUUID()}.tmp`);

    try {
      await writeFile(temporaryPath, inspection.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.#filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }

    const fileStats = await stat(this.#filePath);
    this.#state = {
      configured: true,
      cookieCount: inspection.count,
      hasSessionCookie: inspection.hasSessionCookie,
      updatedAt: fileStats.mtime.toISOString(),
    };
    return this.status();
  }

  status() {
    return { ...this.#state };
  }

  resolve() {
    if (!this.#state.configured) {
      const error = new Error('请先导入有效的 Bilibili cookies.txt');
      error.code = 'COOKIE_REQUIRED';
      throw error;
    }
    return { type: 'file', path: this.#filePath };
  }

  async clear() {
    await rm(this.#filePath, { force: true });
    this.#state = emptyStatus();
    return this.status();
  }
}
