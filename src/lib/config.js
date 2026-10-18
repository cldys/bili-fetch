import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const EXECUTABLE_CANDIDATES = {
  "yt-dlp": [
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
  ],
  ffmpeg: [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ],
};

export const DEFAULT_DOWNLOAD_DIRECTORY = process.env.BILIFETCH_DOWNLOAD_DIRECTORY || path.join(
  os.homedir(),
  "Downloads",
  "download",
  "BiliFetch",
);

export const DOWNLOAD_ROOTS = process.env.BILIFETCH_DOWNLOAD_ROOTS
  ? JSON.parse(process.env.BILIFETCH_DOWNLOAD_ROOTS)
  : [process.env.BILIFETCH_DOWNLOAD_ROOT || os.homedir()];

async function isExecutable(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function locateExecutable(name) {
  const pathEntries = (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  const candidates = [
    ...(EXECUTABLE_CANDIDATES[name] || []),
    ...pathEntries.map((entry) => path.join(entry, name)),
  ];

  for (const candidate of [...new Set(candidates)]) {
    if (await isExecutable(candidate)) return candidate;
  }

  return null;
}

export function runtimeEnvironment() {
  const extraPaths = ["/opt/homebrew/bin", "/usr/local/bin"];
  return {
    ...process.env,
    PATH: [...extraPaths, process.env.PATH || ""]
      .filter(Boolean)
      .join(path.delimiter),
  };
}
