import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DEFAULT_DOWNLOAD_DIRECTORY, locateExecutable, runtimeEnvironment } from './lib/config.js';
import { buildProbeArguments } from './lib/commands.js';
import { CookieStore } from './lib/cookie-store.js';
import { createJob, friendlyFailure, getJob, subscribeToJob } from './lib/jobs.js';
import { runCommand } from './lib/process.js';
import { parseProbeOutput } from './lib/subtitles.js';
import { validateBilibiliUrl, validateDownloadRequest } from './lib/validation.js';

const execFileAsync = promisify(execFile);
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(currentDirectory, '..', 'public');
const port = Number(process.env.PORT || 4317);
const host = '127.0.0.1';
const env = runtimeEnvironment();
const cookieStore = new CookieStore({ directory: process.env.BILIFETCH_DATA_DIRECTORY });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/styles.css', 'styles.css'],
  ['/app.js', 'app.js'],
  ['/favicon.svg', 'favicon.svg'],
]);

function securityHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'",
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, securityHeaders('application/json; charset=utf-8'));
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('请求内容过大');
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new Error('请求内容不是有效 JSON');
  }
}

async function toolVersion(executable, argumentsList = ['--version']) {
  if (!executable) return null;
  try {
    const result = await runCommand(executable, argumentsList, { env, maxOutputBytes: 20_000 });
    return result.code === 0 ? result.stdout.trim().split(/\r?\n/)[0] : null;
  } catch {
    return null;
  }
}

async function handleApi(request, response, pathname) {
  if (request.method === 'POST' && pathname === '/api/cookies/import') {
    const body = await readJson(request);
    const imported = await cookieStore.importCookies({ content: body.content });
    return sendJson(response, 201, imported);
  }

  if (request.method === 'GET' && pathname === '/api/cookies/status') {
    return sendJson(response, 200, { ...cookieStore.status(), platform: 'bilibili' });
  }

  if (request.method === 'DELETE' && pathname === '/api/cookies') {
    return sendJson(response, 200, await cookieStore.clear());
  }

  if (request.method === 'GET' && pathname === '/api/health') {
    const ytDlp = await locateExecutable('yt-dlp');
    const ffmpeg = await locateExecutable('ffmpeg');
    const [ytDlpVersion, ffmpegVersion] = await Promise.all([
      toolVersion(ytDlp),
      toolVersion(ffmpeg, ['-version']),
    ]);
    return sendJson(response, 200, {
      ok: Boolean(ytDlp),
      defaultDirectory: DEFAULT_DOWNLOAD_DIRECTORY,
      tools: {
        ytDlp: { found: Boolean(ytDlp), path: ytDlp, version: ytDlpVersion },
        ffmpeg: { found: Boolean(ffmpeg), path: ffmpeg, version: ffmpegVersion },
      },
    });
  }

  if (request.method === 'POST' && pathname === '/api/select-directory') {
    try {
      const { stdout } = await execFileAsync('/usr/bin/osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "选择下载目录")',
      ]);
      return sendJson(response, 200, { directory: stdout.trim().replace(/\/$/, '') });
    } catch (error) {
      if (error.code === 1) return sendJson(response, 200, { cancelled: true });
      throw error;
    }
  }

  if (request.method === 'POST' && pathname === '/api/probe') {
    const body = await readJson(request);
    const url = validateBilibiliUrl(body.url);
    let cookie;
    try {
      cookie = cookieStore.resolve();
    } catch (error) {
      return sendJson(response, 428, { code: error.code, error: error.message });
    }
    const ytDlp = await locateExecutable('yt-dlp');
    if (!ytDlp) return sendJson(response, 503, { error: '未找到 yt-dlp，请先执行 brew install yt-dlp' });
    const probeRequest = {
      url,
      cookie,
    };
    const result = await runCommand(ytDlp, buildProbeArguments(probeRequest), { env });
    if (result.code !== 0) {
      return sendJson(response, 422, { error: friendlyFailure(result) });
    }
    return sendJson(response, 200, parseProbeOutput(result.stdout, result.stderr));
  }

  if (request.method === 'POST' && pathname === '/api/download') {
    const body = await readJson(request);
    const downloadRequest = validateDownloadRequest(body, DEFAULT_DOWNLOAD_DIRECTORY);
    let cookie;
    try {
      cookie = cookieStore.resolve();
    } catch (error) {
      return sendJson(response, 428, { code: error.code, error: error.message });
    }
    const ytDlp = await locateExecutable('yt-dlp');
    if (!ytDlp) return sendJson(response, 503, { error: '未找到 yt-dlp，请先执行 brew install yt-dlp' });
    downloadRequest.cookie = cookie;
    if (!(await locateExecutable('ffmpeg'))) {
      return sendJson(response, 503, { error: '视频合并、音频提取和字幕转换需要 ffmpeg，请先执行 brew install ffmpeg' });
    }
    return sendJson(response, 202, createJob(downloadRequest, ytDlp, env));
  }

  const jobMatch = pathname.match(/^\/api\/jobs\/([a-f0-9-]+)(?:\/events)?$/i);
  if (request.method === 'GET' && jobMatch) {
    const id = jobMatch[1];
    if (pathname.endsWith('/events')) {
      response.writeHead(200, {
        ...securityHeaders('text/event-stream; charset=utf-8'),
        Connection: 'keep-alive',
      });
      if (!subscribeToJob(id, response)) response.end('event: error\ndata: {"error":"任务不存在"}\n\n');
      return;
    }
    const job = getJob(id);
    return job ? sendJson(response, 200, job) : sendJson(response, 404, { error: '任务不存在' });
  }

  return sendJson(response, 404, { error: '接口不存在' });
}

async function serveStatic(response, pathname) {
  const fileName = STATIC_FILES.get(pathname);
  if (!fileName) return false;
  const filePath = path.join(publicDirectory, fileName);
  const body = await readFile(filePath);
  response.writeHead(200, securityHeaders(MIME_TYPES[path.extname(fileName)] || 'application/octet-stream'));
  response.end(body);
  return true;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url.pathname);
    if (await serveStatic(response, url.pathname)) return;
    sendJson(response, 404, { error: '页面不存在' });
  } catch (error) {
    sendJson(response, 400, { error: error.message || '请求处理失败' });
  }
});

await cookieStore.initialize();

server.listen(port, host, () => {
  console.log(`BiliFetch is running at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
