import path from 'node:path';

const BILIBILI_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv']);
const QUALITIES = new Set(['best', '1080', '720']);
const SUBTITLE_TYPES = new Set(['manual', 'ai']);
const SUBTITLE_LANGUAGES = new Set(['zh', 'en']);
export function validateBilibiliUrl(value) {
  let parsed;
  try {
    const links = String(value || '').trim().match(/https?:\/\/[^\s<>"，。！？、（）【】]+/gi) || [];
    if (links.length !== 1) throw new Error('Invalid URL count');
    parsed = new URL(links[0].replace(/[),.!;…]+$/, ''));
  } catch {
    throw new Error('请输入有效的 Bilibili 视频地址');
  }

  if (parsed.username || parsed.password || parsed.port) throw new Error('视频地址不能包含账号、密码或自定义端口');
  const host = parsed.hostname.toLowerCase();
  const supportedHost = BILIBILI_HOSTS.has(host) || host.endsWith('.bilibili.com');
  if (!['http:', 'https:'].includes(parsed.protocol) || !supportedHost) {
    throw new Error('目前仅支持 bilibili.com 和 b23.tv 地址');
  }

  return parsed.toString();
}

function selectedValues(values, allowed) {
  return [...new Set(Array.isArray(values) ? values.filter((value) => allowed.has(value)) : [])];
}

export function validateBilibiliUrls(value) {
  const lines = Array.isArray(value) ? value : String(value || '').split(/\r\n|\r|\n/);
  const urls = [];
  for (const [index, line] of lines.entries()) {
    if (!String(line || '').trim()) continue;
    try {
      urls.push(validateBilibiliUrl(line));
    } catch (error) {
      throw new Error(`第 ${index + 1} 行：${error.message}`);
    }
  }
  if (!urls.length) throw new Error('请至少输入一个 Bilibili 视频链接');
  return [...new Set(urls)];
}

export function validateDownloadRequest(body = {}, defaultDirectory) {
  const urls = validateBilibiliUrls(body.urls ?? body.url);
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
  if (outputs.subtitles && (!subtitleLanguages.length || !subtitleTypes.length)) {
    throw new Error('下载字幕时，请至少选择一种字幕类型和一种语言');
  }

  return {
    url: urls[0],
    urls,
    directory,
    outputs,
    subtitleTypes,
    subtitleLanguages,
    quality: QUALITIES.has(body.quality) ? body.quality : 'best',
  };
}
