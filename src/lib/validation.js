import path from 'node:path';

const BILIBILI_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv']);
const COOKIE_BROWSERS = new Set(['none', 'chrome', 'safari', 'file']);
const QUALITIES = new Set(['best', '1080', '720']);
const SUBTITLE_TYPES = new Set(['manual', 'ai']);
const SUBTITLE_LANGUAGES = new Set(['zh', 'en']);

export function validateBilibiliUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error('请输入有效的 Bilibili 视频地址');
  }

  const host = parsed.hostname.toLowerCase();
  const supportedHost = BILIBILI_HOSTS.has(host) || host.endsWith('.bilibili.com');
  if (!['http:', 'https:'].includes(parsed.protocol) || !supportedHost) {
    throw new Error('目前仅支持 bilibili.com 和 b23.tv 地址');
  }

  return parsed.toString();
}

export function validateCookie(cookie = {}) {
  const type = COOKIE_BROWSERS.has(cookie.type) ? cookie.type : 'none';
  if (type === 'file') {
    const filePath = String(cookie.path || '').trim();
    if (!filePath || !path.isAbsolute(filePath)) {
      throw new Error('Cookie 文件必须使用绝对路径');
    }
    return { type, path: path.normalize(filePath) };
  }
  return { type };
}

function selectedValues(values, allowed) {
  return [...new Set(Array.isArray(values) ? values.filter((value) => allowed.has(value)) : [])];
}

export function validateDownloadRequest(body = {}, defaultDirectory) {
  const url = validateBilibiliUrl(body.url);
  const directory = path.normalize(String(body.directory || defaultDirectory).trim());
  if (!path.isAbsolute(directory)) throw new Error('保存目录必须使用绝对路径');

  const outputs = {
    video: Boolean(body.outputs?.video),
    audio: Boolean(body.outputs?.audio),
    subtitles: Boolean(body.outputs?.subtitles),
  };
  if (!Object.values(outputs).some(Boolean)) throw new Error('请至少选择一种下载类型');

  const subtitleTypes = selectedValues(body.subtitleTypes, SUBTITLE_TYPES);
  const subtitleLanguages = selectedValues(body.subtitleLanguages, SUBTITLE_LANGUAGES);
  if (outputs.subtitles && (!subtitleTypes.length || !subtitleLanguages.length)) {
    throw new Error('下载字幕时，请至少选择一种字幕类型和一种语言');
  }

  return {
    url,
    directory,
    outputs,
    subtitleTypes,
    subtitleLanguages,
    quality: QUALITIES.has(body.quality) ? body.quality : 'best',
    cookie: validateCookie(body.cookie),
  };
}
