import { mkdir } from 'node:fs/promises';
import crypto from 'node:crypto';
import { buildDownloadTasks, buildProbeArguments } from './commands.js';
import { parseProbeOutput, selectSubtitleTracks } from './subtitles.js';
import { runCommand } from './process.js';

const jobs = new Map();

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    message: job.message,
    createdAt: job.createdAt,
    warnings: job.warnings,
    logs: job.logs,
    tasks: job.tasks,
  };
}

function broadcast(job) {
  const payload = `data: ${JSON.stringify(publicJob(job))}\n\n`;
  for (const response of job.listeners) response.write(payload);
}

function update(job, changes = {}) {
  Object.assign(job, changes);
  broadcast(job);
}

function appendLog(job, message) {
  const cleaned = String(message || '').trim();
  if (!cleaned) return;
  job.logs.push(cleaned);
  if (job.logs.length > 120) job.logs.splice(0, job.logs.length - 120);
}

function friendlyFailure(result) {
  const lines = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) || `yt-dlp exited with code ${result.code}`;
}

async function probeSubtitles(job, request, executable, env) {
  update(job, { status: 'probing', message: '正在检测可用字幕…' });
  const result = await runCommand(executable, buildProbeArguments(request), {
    env,
    onLine: (line) => {
      if (line.includes('WARNING') || line.includes('ERROR')) appendLog(job, line);
    },
  });
  if (result.code !== 0) throw new Error(friendlyFailure(result));
  return parseProbeOutput(result.stdout, result.stderr);
}

function parseProgress(line) {
  const match = String(line).match(/\[download\]\s+([\d.]+)%/);
  return match ? Number(match[1]) : null;
}

async function executeTask(job, task, plan, executable, env) {
  await mkdir(plan.outputDirectory, { recursive: true });
  task.status = 'running';
  task.progress = 0;
  task.message = `正在下载${task.label}…`;
  update(job, { status: 'downloading', message: task.message });

  const result = await runCommand(executable, plan.arguments, {
    env,
    onLine: (line) => {
      const progress = parseProgress(line);
      if (progress !== null) task.progress = progress;
      if (line.includes('WARNING') || line.includes('ERROR') || line.includes('[Merger]') || line.includes('[ExtractAudio]')) {
        appendLog(job, line);
      }
      broadcast(job);
    },
  });

  if (result.code === 0) {
    task.status = 'completed';
    task.progress = 100;
    task.message = `${task.label}完成`;
  } else {
    task.status = 'failed';
    task.message = friendlyFailure(result);
    appendLog(job, `${task.label}失败：${task.message}`);
  }
  broadcast(job);
}

async function runJob(job, request, executable, env) {
  let selectedSubtitleTracks = [];

  if (request.outputs.subtitles) {
    try {
      const probe = await probeSubtitles(job, request, executable, env);
      const selection = selectSubtitleTracks(probe.tracks, request.subtitleTypes, request.subtitleLanguages);
      selectedSubtitleTracks = selection.tracks;
      for (const missing of selection.missing) job.warnings.push(`未发现${missing}，已跳过`);
      if (!selection.tracks.length) job.warnings.push('没有符合选择条件的字幕，视频和音频任务不受影响');
    } catch (error) {
      job.warnings.push(`字幕检测失败，已跳过字幕：${error.message}`);
    }
  }

  const plans = buildDownloadTasks(request, selectedSubtitleTracks);
  job.tasks = plans.map((task) => ({
    id: task.id,
    label: task.label,
    outputDirectory: task.outputDirectory,
    status: 'pending',
    progress: 0,
    message: '等待中',
  }));
  broadcast(job);

  for (let index = 0; index < plans.length; index += 1) {
    await executeTask(job, job.tasks[index], plans[index], executable, env);
  }

  const failed = job.tasks.filter((task) => task.status === 'failed').length;
  const completed = job.tasks.filter((task) => task.status === 'completed').length;
  const status = failed && completed ? 'partial' : failed ? 'failed' : 'completed';
  const message = status === 'completed'
    ? (job.warnings.length ? '下载完成，部分选项已提示' : '全部下载完成')
    : status === 'partial'
      ? '部分任务完成，请查看失败信息'
      : plans.length
        ? '下载失败，请查看日志'
        : '没有可执行的下载任务';
  update(job, { status, message });
}

export function createJob(request, executable, env) {
  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'queued',
    message: '任务已创建',
    createdAt: new Date().toISOString(),
    warnings: [],
    logs: [],
    tasks: [],
    listeners: new Set(),
  };
  jobs.set(id, job);

  setImmediate(() => {
    runJob(job, request, executable, env).catch((error) => {
      appendLog(job, error.message);
      update(job, { status: 'failed', message: error.message });
    });
  });

  return publicJob(job);
}

export function getJob(id) {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}

export function subscribeToJob(id, response) {
  const job = jobs.get(id);
  if (!job) return false;
  job.listeners.add(response);
  response.write(`data: ${JSON.stringify(publicJob(job))}\n\n`);
  response.on('close', () => job.listeners.delete(response));
  return true;
}
