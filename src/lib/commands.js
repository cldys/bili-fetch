import path from 'node:path';

export function cookieArguments(cookie) {
  if (cookie.type === 'file') return ['--cookies', cookie.path];
  throw new Error('下载任务缺少有效的 cookies.txt');
}

export function buildProbeArguments({ url, cookie }) {
  return [
    '--ignore-config',
    '--no-playlist',
    ...cookieArguments(cookie),
    '--skip-download',
    '--list-subs',
    '--print',
    'PROBE:%()j',
    url,
  ];
}

function formatForQuality(quality) {
  if (quality === '1080') return 'bv*[height<=1080]+ba/b[height<=1080]';
  if (quality === '720') return 'bv*[height<=720]+ba/b[height<=720]';
  return 'bv*+ba/b';
}

function commonDownloadArguments(request, outputDirectory) {
  return [
    '--ignore-config',
    '--no-playlist',
    '--newline',
    '--continue',
    '--no-overwrites',
    ...cookieArguments(request.cookie),
    '--paths',
    outputDirectory,
    '--output',
    '%(title).180B [%(id)s].%(ext)s',
  ];
}

export function buildDownloadTasks(request, subtitleTracks = []) {
  const tasks = [];

  if (request.outputs.video) {
    const outputDirectory = path.join(request.directory, 'Video');
    tasks.push({
      id: 'video',
      label: '视频',
      outputDirectory,
      arguments: [
        ...commonDownloadArguments(request, outputDirectory),
        '--format',
        formatForQuality(request.quality),
        '--merge-output-format',
        'mp4',
        request.url,
      ],
    });
  }

  if (request.outputs.audio) {
    const outputDirectory = path.join(request.directory, 'Audio');
    tasks.push({
      id: 'audio',
      label: '音频',
      outputDirectory,
      arguments: [
        ...commonDownloadArguments(request, outputDirectory),
        '--format',
        'ba/b',
        '--extract-audio',
        '--audio-format',
        'm4a',
        '--audio-quality',
        '0',
        request.url,
      ],
    });
  }

  if (request.outputs.subtitles && subtitleTracks.length) {
    const outputDirectory = path.join(request.directory, 'Subtitles');
    tasks.push({
      id: 'subtitles',
      label: '字幕',
      outputDirectory,
      arguments: [
        ...commonDownloadArguments(request, outputDirectory),
        '--skip-download',
        '--write-subs',
        ...(subtitleTracks.some((track) => track.source === 'automatic') ? ['--write-auto-subs'] : []),
        '--sub-langs',
        subtitleTracks.map((track) => track.tag).join(','),
        '--sub-format',
        'srt/best',
        '--convert-subs',
        'srt',
        '--no-simulate',
        '--print',
        'after_video:SUBTITLE_FILES:%(requested_subtitles.:.filepath)j',
        request.url,
      ],
    });
  }

  return tasks;
}
