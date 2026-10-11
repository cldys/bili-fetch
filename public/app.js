const elements = {
  form: document.querySelector('#download-form'),
  url: document.querySelector('#url'),
  directory: document.querySelector('#directory'),
  quality: document.querySelector('#quality'),
  cookieType: document.querySelector('#cookie-type'),
  cookiePath: document.querySelector('#cookie-path'),
  cookiePathField: document.querySelector('#cookie-path-field'),
  outputVideo: document.querySelector('#output-video'),
  outputAudio: document.querySelector('#output-audio'),
  outputSubtitles: document.querySelector('#output-subtitles'),
  subtitleOptions: document.querySelector('#subtitle-options'),
  subtitleManual: document.querySelector('#subtitle-manual'),
  subtitleAi: document.querySelector('#subtitle-ai'),
  languageZh: document.querySelector('#language-zh'),
  languageEn: document.querySelector('#language-en'),
  probeButton: document.querySelector('#probe-button'),
  directoryButton: document.querySelector('#directory-button'),
  downloadButton: document.querySelector('#download-button'),
  toolStatus: document.querySelector('#tool-status'),
  formMessage: document.querySelector('#form-message'),
  resourcePreview: document.querySelector('#resource-preview'),
  previewImage: document.querySelector('#preview-image'),
  previewId: document.querySelector('#preview-id'),
  previewTitle: document.querySelector('#preview-title'),
  subtitleSummary: document.querySelector('#subtitle-summary'),
  emptyState: document.querySelector('#empty-state'),
  jobContent: document.querySelector('#job-content'),
  jobState: document.querySelector('#job-state'),
  jobMessage: document.querySelector('#job-message'),
  warningList: document.querySelector('#warning-list'),
  taskList: document.querySelector('#task-list'),
  jobLogs: document.querySelector('#job-logs'),
};

let eventSource;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function cookiePayload() {
  return {
    type: elements.cookieType.value,
    path: elements.cookiePath.value.trim(),
  };
}

function formPayload() {
  return {
    url: elements.url.value.trim(),
    directory: elements.directory.value.trim(),
    quality: elements.quality.value,
    cookie: cookiePayload(),
    outputs: {
      video: elements.outputVideo.checked,
      audio: elements.outputAudio.checked,
      subtitles: elements.outputSubtitles.checked,
    },
    subtitleTypes: [
      elements.subtitleManual.checked && 'manual',
      elements.subtitleAi.checked && 'ai',
    ].filter(Boolean),
    subtitleLanguages: [
      elements.languageZh.checked && 'zh',
      elements.languageEn.checked && 'en',
    ].filter(Boolean),
  };
}

function showMessage(message) {
  elements.formMessage.textContent = message;
  elements.formMessage.classList.toggle('hidden', !message);
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (label) button.textContent = busy ? '处理中…' : label;
}

function renderProbe(result) {
  elements.previewImage.src = result.thumbnail || '/favicon.svg';
  elements.previewImage.hidden = !result.thumbnail;
  elements.previewId.textContent = result.id || 'BILIBILI';
  elements.previewTitle.textContent = result.title || '已识别资源';
  elements.subtitleSummary.replaceChildren();

  if (!result.tracks.length) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = '未发现中英文字幕';
    elements.subtitleSummary.append(tag);
  } else {
    for (const track of result.tracks) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = `${track.type === 'ai' ? 'AI' : '人工'} · ${track.language === 'zh' ? '中文' : '英文'} · ${track.tag}`;
      elements.subtitleSummary.append(tag);
    }
  }
  elements.resourcePreview.classList.remove('hidden');
}

function statusLabel(status) {
  return {
    queued: '排队中',
    probing: '检测中',
    downloading: '下载中',
    completed: '已完成',
    partial: '部分完成',
    failed: '失败',
  }[status] || '待命';
}

function renderJob(job) {
  elements.emptyState.classList.add('hidden');
  elements.jobContent.classList.remove('hidden');
  elements.jobMessage.textContent = job.message;
  elements.jobState.textContent = statusLabel(job.status);
  const running = ['queued', 'probing', 'downloading'].includes(job.status);
  elements.jobState.className = `state-badge ${running ? 'running' : job.status === 'failed' ? 'failed' : 'completed'}`;

  elements.warningList.replaceChildren();
  for (const warningText of job.warnings || []) {
    const warning = document.createElement('div');
    warning.className = 'warning';
    warning.textContent = `⚠ ${warningText}`;
    elements.warningList.append(warning);
  }

  elements.taskList.replaceChildren();
  for (const taskData of job.tasks || []) {
    const task = document.createElement('article');
    task.className = 'task';

    const head = document.createElement('div');
    head.className = 'task-head';
    const label = document.createElement('strong');
    label.textContent = taskData.label;
    const state = document.createElement('span');
    state.className = 'task-status';
    state.textContent = taskData.message;
    head.append(label, state);

    const track = document.createElement('div');
    track.className = 'progress-track';
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    bar.style.width = `${Math.max(0, Math.min(100, taskData.progress || 0))}%`;
    track.append(bar);

    const path = document.createElement('p');
    path.className = 'task-path';
    path.textContent = taskData.outputDirectory;
    task.append(head, track, path);
    elements.taskList.append(task);
  }

  elements.jobLogs.textContent = (job.logs || []).join('\n') || '暂无日志';
  elements.downloadButton.disabled = running;
  if (!running) eventSource?.close();
}

async function loadHealth() {
  try {
    const health = await api('/api/health');
    elements.directory.value = health.defaultDirectory;
    const ytDlp = health.tools.ytDlp;
    const ffmpeg = health.tools.ffmpeg;
    elements.toolStatus.className = `tool-status ${ytDlp.found && ffmpeg.found ? 'ready' : 'error'}`;
    elements.toolStatus.querySelector('span:last-child').textContent = ytDlp.found && ffmpeg.found
      ? `工具就绪 · yt-dlp ${ytDlp.version || ''}`
      : `缺少 ${[!ytDlp.found && 'yt-dlp', !ffmpeg.found && 'ffmpeg'].filter(Boolean).join('、')}`;
  } catch (error) {
    elements.toolStatus.className = 'tool-status error';
    elements.toolStatus.querySelector('span:last-child').textContent = error.message;
  }
}

elements.outputSubtitles.addEventListener('change', () => {
  elements.subtitleOptions.classList.toggle('hidden', !elements.outputSubtitles.checked);
});

elements.cookieType.addEventListener('change', () => {
  elements.cookiePathField.classList.toggle('hidden', elements.cookieType.value !== 'file');
});

elements.probeButton.addEventListener('click', async () => {
  showMessage('');
  setBusy(elements.probeButton, true, '检测资源');
  try {
    const result = await api('/api/probe', {
      method: 'POST',
      body: JSON.stringify({ url: elements.url.value.trim(), cookie: cookiePayload() }),
    });
    renderProbe(result);
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(elements.probeButton, false, '检测资源');
  }
});

elements.directoryButton.addEventListener('click', async () => {
  showMessage('');
  setBusy(elements.directoryButton, true, '选择…');
  try {
    const result = await api('/api/select-directory', { method: 'POST', body: '{}' });
    if (result.directory) elements.directory.value = result.directory;
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(elements.directoryButton, false, '选择…');
  }
});

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('');
  elements.downloadButton.disabled = true;
  try {
    const job = await api('/api/download', {
      method: 'POST',
      body: JSON.stringify(formPayload()),
    });
    renderJob(job);
    eventSource?.close();
    eventSource = new EventSource(`/api/jobs/${job.id}/events`);
    eventSource.onmessage = (message) => renderJob(JSON.parse(message.data));
    eventSource.onerror = () => {
      if (elements.jobState.textContent === '下载中') showMessage('进度连接已断开，可刷新页面后重试');
    };
  } catch (error) {
    showMessage(error.message);
    elements.downloadButton.disabled = false;
  }
});

loadHealth();
