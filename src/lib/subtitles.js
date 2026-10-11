const LANGUAGE_PATTERN = /^(?:ai-)?(zh|en)(?:[-_].*)?$/i;

export function classifySubtitleTag(tag, declaredType) {
  const normalized = String(tag || '').trim().toLowerCase();
  if (!normalized || normalized === 'danmaku' || normalized === 'live_chat') return null;

  const match = normalized.match(LANGUAGE_PATTERN);
  if (!match) return null;

  return {
    tag: String(tag).trim(),
    type: declaredType === 'ai' || normalized.startsWith('ai-') ? 'ai' : 'manual',
    language: match[1],
  };
}

function uniqueTracks(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    const key = `${track.type}:${track.language}:${track.tag}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tracksFromMetadata(metadata) {
  const tracks = [];
  for (const [tag, formats] of Object.entries(metadata?.subtitles || {})) {
    if (!Array.isArray(formats) || !formats.length) continue;
    const track = classifySubtitleTag(tag, 'manual');
    if (track) tracks.push(track);
  }
  for (const [tag, formats] of Object.entries(metadata?.automatic_captions || {})) {
    if (!Array.isArray(formats) || !formats.length) continue;
    const track = classifySubtitleTag(tag, 'ai');
    if (track) tracks.push({ ...track, source: 'automatic' });
  }
  return uniqueTracks(tracks);
}

function fallbackTracks(output) {
  const tracks = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const firstColumn = line.trim().split(/\s+/)[0];
    const track = classifySubtitleTag(firstColumn, undefined);
    if (track) tracks.push(track);
  }
  return uniqueTracks(tracks);
}

export function parseProbeOutput(stdout, stderr = '') {
  const diagnosticOutput = `${stdout}\n${stderr}`;
  const authRequired = /subtitles are only available when logged in|need_login_subtitle/i.test(diagnosticOutput);
  const markerLine = String(stdout)
    .split(/\r?\n/)
    .find((line) => line.startsWith('PROBE:'));

  let metadata = {};
  if (markerLine) {
    try {
      metadata = JSON.parse(markerLine.slice('PROBE:'.length));
    } catch {
      metadata = {};
    }
  }

  let tracks = tracksFromMetadata(metadata);
  if (!markerLine && !tracks.length) tracks = fallbackTracks(diagnosticOutput);

  return {
    id: metadata.id || '',
    title: metadata.title || '',
    thumbnail: String(metadata.thumbnail || '').replace(/^http:\/\//i, 'https://'),
    duration: Number.isFinite(metadata.duration) ? metadata.duration : null,
    authRequired,
    tracks,
  };
}

const TYPE_LABELS = { manual: '人工', ai: 'AI' };
const LANGUAGE_LABELS = { zh: '中文', en: '英文' };

export function selectSubtitleTracks(tracks, selectedTypes, selectedLanguages) {
  const requested = [];
  const selected = [];
  const missing = [];

  for (const type of selectedTypes) {
    for (const language of selectedLanguages) {
      requested.push({ type, language });
      const matches = tracks.filter((track) => track.type === type && track.language === language);
      if (matches.length) selected.push(...matches);
      else missing.push(`${TYPE_LABELS[type]}${LANGUAGE_LABELS[language]}字幕`);
    }
  }

  return {
    requested,
    tracks: uniqueTracks(selected),
    missing,
  };
}
