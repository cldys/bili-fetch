import { mkdir } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { buildDownloadTasks, buildProbeArguments } from './commands.js';
import { parseProbeOutput, selectSubtitleTracks } from './subtitles.js';
import { runCommand } from './process.js';
import { exportSubtitleText } from './subtitle-text.js';

const jobs = new Map();
let queue = Promise.resolve();

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    message: job.message,
    createdAt: job.createdAt,
    warnings: job.warnings,
    logs: job.logs,
    tasks: job.tasks,
    ...(job.url ? { url: job.url, title: job.title || '' } : {}),
    ...(job.items ? {
      total: job.items.length,
      currentIndex: job.currentIndex,
      processed: job.processed,
      items: job.items.map(publicJob),
    } : {}),
  };
}

function broadcast(job) {
  job.onUpdate?.();
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

export function friendlyFailure(result) {
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

async function executeTask(job, task, plan, executable, env, prepareDirectory) {
  if (prepareDirectory) await prepareDirectory(plan.outputDirectory);
  else await mkdir(plan.outputDirectory, { recursive: true });
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
    if (task.id === 'subtitles') {
      try {
        const files = new Set();
        for (const line of result.stdout.split(/\r?\n/)) {
          if (!line.startsWith('SUBTITLE_FILES:')) continue;
          for (const file of JSON.parse(line.slice('SUBTITLE_FILES:'.length))) {
            const relative = path.relative(plan.outputDirectory, file);
            if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
              || path.extname(file).toLowerCase() !== '.srt') throw new Error('字幕文件路径无效');
            files.add(file);
          }
        }
        if (!files.size) throw new Error('未获取到已下载的 SRT 文件');
        for (const file of files) await exportSubtitleText(file);
      } catch (error) {
        task.status = 'failed';
        task.message = error.message;
        appendLog(job, `${task.label}失败：${task.message}`);
        broadcast(job);
        return;
      }
    }
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
  let probeFailed = false;

  if (request.outputs.subtitles) {
    try {
      const probe = await probeSubtitles(job, request, executable, env);
      job.title = probe.title;
      if (probe.authRequired) {
        job.warnings.push('当前 cookies.txt 已失效或未获得字幕权限，请重新导入；本次已跳过字幕，视频和音频任务不受影响');
      } else {
        const selection = selectSubtitleTracks(probe.tracks, request.subtitleTypes, request.subtitleLanguages);
        selectedSubtitleTracks = selection.tracks;
        for (const missing of selection.missing) job.warnings.push(`未发现${missing}，已跳过`);
        if (!selection.tracks.length) job.warnings.push('没有符合选择条件的字幕，视频和音频任务不受影响');
      }
    } catch (error) {
      probeFailed = true;
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
    try {
      await executeTask(job, job.tasks[index], plans[index], executable, env, request.prepareDirectory);
    } catch (error) {
      job.tasks[index].status = 'failed';
      job.tasks[index].message = error.message;
      appendLog(job, `${job.tasks[index].label}失败：${error.message}`);
      broadcast(job);
    }
  }

  const failed = job.tasks.filter((task) => task.status === 'failed').length;
  const completed = job.tasks.filter((task) => task.status === 'completed').length;
  const status = !plans.length ? (probeFailed ? 'failed' : 'skipped') : failed && completed ? 'partial' : failed ? 'failed' : 'completed';
  const message = !plans.length ? (probeFailed ? '字幕检测失败，请查看日志' : '未发现可下载的所选字幕，本次已跳过')
    : status === 'completed'
    ? (job.warnings.length ? '下载完成，部分选项已提示' : '全部下载完成')
    : status === 'partial'
      ? '部分任务完成，请查看失败信息'
      : plans.length
        ? '下载失败，请查看日志'
        : '没有可执行的下载任务';
  update(job, { status, message });
}

async function runBatchJob(job, request, executable, env) {
  for (const [index, item] of job.items.entries()) {
    job.currentIndex = index + 1;
    item.onUpdate = () => {
      job.status = item.status === 'probing' ? 'probing' : 'downloading';
      job.message = `正在处理第 ${index + 1} / ${job.items.length} 条 · ${item.message}`;
      job.warnings = job.items.flatMap((entry, position) => entry.warnings.map((warning) => `第 ${position + 1} 条：${warning}`));
      job.logs = job.items.flatMap((entry, position) => entry.logs.map((line) => `[${position + 1}] ${line}`)).slice(-120);
      broadcast(job);
    };
    try {
      await runJob(item, { ...request, url: item.url }, executable, env);
    } catch (error) {
      appendLog(item, error.message);
      update(item, { status: 'failed', message: error.message });
    }
    job.processed = index + 1;
    broadcast(job);
  }

  const count = (status) => job.items.filter((item) => item.status === status).length;
  const completed = count('completed');
  const partial = count('partial');
  const failed = count('failed');
  const skipped = count('skipped');
  const status = partial || (failed && completed) ? 'partial' : failed ? 'failed' : completed ? 'completed' : 'skipped';
  update(job, {
    status,
    message: `批量任务结束：${completed} 条完成，${partial} 条部分完成，${failed} 条失败，${skipped} 条跳过`,
  });
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
  const urls = [...new Set(request.urls || [request.url])];
  if (urls.length > 1) {
    job.currentIndex = 0;
    job.processed = 0;
    job.items = urls.map((url) => ({
      id: crypto.randomUUID(), url, title: '', status: 'queued', message: '等待中',
      createdAt: job.createdAt, warnings: [], logs: [], tasks: [], listeners: new Set(),
    }));
  }
  jobs.set(id, job);

  queue = queue.then(async () => {
    try {
      if (job.items) await runBatchJob(job, request, executable, env);
      else await runJob(job, { ...request, url: urls[0] }, executable, env);
    } catch (error) {
      appendLog(job, error.message);
      update(job, { status: 'failed', message: error.message });
    }
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
