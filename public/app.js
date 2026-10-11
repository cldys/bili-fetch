const elements = {
  form: document.querySelector('#download-form'),
  downloadControls: document.querySelector('#download-controls'),
  url: document.querySelector('#url'),
  directory: document.querySelector('#directory'),
  quality: document.querySelector('#quality'),
  urlStatus: document.querySelector('#url-status'),
  cookiePanel: document.querySelector('#cookie-panel'),
  cookieFile: document.querySelector('#cookie-file'),
  cookieTitle: document.querySelector('#cookie-title'),
  cookieDescription: document.querySelector('#cookie-description'),
  cookieActionLabel: document.querySelector('#cookie-action-label'),
  cookieClear: document.querySelector('#cookie-clear'),
  outputVideo: document.querySelector('#output-video'),
  outputAudio: document.querySelector('#output-audio'),
  outputSubtitles: document.querySelector('#output-subtitles'),
  contentOptions: document.querySelector('#content-options'),
  videoOptions: document.querySelector('#video-options'),
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
let hasValidUrl = false;
let cookieConfigured = false;
let cookieServiceReady = false;
let probeBusy = false;
let jobRunning = false;

function updateControlAvailability() {
  const canDownload = hasValidUrl && cookieConfigured;
  elements.cookieFile.disabled = !cookieServiceReady;
  elements.downloadControls.disabled = !canDownload;
  elements.probeButton.disabled = !canDownload || probeBusy;
  elements.downloadButton.disabled = !canDownload || jobRunning;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function resourceUrls() {
  const urls = [];
  const lines = elements.url.value.split(/\r\n|\r|\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const links = line.match(/https?:\/\/[^\s<>"，。！？、（）【】]+/gi) || [];
    try {
      if (links.length !== 1) throw new Error('Invalid URL count');
      const parsed = new URL(links[0].replace(/[),.!;…]+$/, ''));
      const host = parsed.hostname.toLowerCase();
      if (parsed.username || parsed.password || parsed.port
        || !(host === 'b23.tv' || host === 'bilibili.com' || host.endsWith('.bilibili.com'))) {
        throw new Error('Unsupported URL');
      }
      urls.push(parsed.toString());
    } catch {
      throw new Error(`第 ${index + 1} 行：请输入有效的 Bilibili 或 b23.tv 视频链接`);
    }
  }
  if (!urls.length) throw new Error('请输入 Bilibili 视频链接');
  return [...new Set(urls)];
}

function formPayload() {
  return {
    urls: resourceUrls(),
    directory: elements.directory.value.trim(),
    quality: elements.quality.value,
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

function renderCookieStatus(status) {
  const configured = Boolean(status.configured);
  const label = 'Bilibili';
  cookieConfigured = configured;
  updateControlAvailability();
  elements.cookiePanel.className = `login-panel ${configured ? 'ready' : 'missing'}`;
  elements.cookieTitle.textContent = configured ? `${label} Cookie 已加载` : `尚未导入${label} Cookie`;
  elements.cookieActionLabel.textContent = configured ? '重新导入' : '导入 cookies.txt';
  elements.cookieClear.classList.toggle('hidden', !configured);

  if (configured) {
    const updated = status.updatedAt ? new Date(status.updatedAt).toLocaleString('zh-CN') : '刚刚';
    elements.cookieDescription.textContent = `已保存 ${status.cookieCount} 条${label} Cookie · 更新于 ${updated}`;
  } else {
    elements.cookieDescription.textContent = '导入后才能检测资源和开始下载；下次启动会自动加载。';
  }
}

async function loadCookieStatus() {
  cookieConfigured = false;
  cookieServiceReady = false;
  updateControlAvailability();
  elements.cookieClear.classList.add('hidden');
  elements.cookiePanel.className = 'login-panel loading';
  elements.cookieTitle.textContent = '正在读取 Bilibili Cookie…';
  try {
    const status = await api('/api/cookies/status');
    if (status.platform !== 'bilibili') {
      throw new Error('页面与服务版本不匹配，请重启 BiliFetch 服务后刷新页面');
    }
    cookieServiceReady = true;
    renderCookieStatus(status);
  } catch (error) {
    elements.cookiePanel.className = 'login-panel error';
    elements.cookieTitle.textContent = '登录状态读取失败';
    elements.cookieDescription.textContent = error.message;
  }
}

function renderProbe(result) {
  elements.resourcePreview.classList.remove('batch-preview');
  elements.previewImage.src = result.thumbnail || '/favicon.svg';
  elements.previewImage.hidden = !result.thumbnail;
  elements.previewId.textContent = `Bilibili · ${result.id || '视频'}`;
  elements.previewTitle.textContent = result.title || '已识别资源';
  elements.subtitleSummary.replaceChildren();

  if (result.authRequired) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = '当前登录状态无法读取字幕';
    elements.subtitleSummary.append(tag);
    elements.cookiePanel.className = 'login-panel error';
    elements.cookieTitle.textContent = 'Cookie 已失效或权限不足';
    elements.cookieDescription.textContent = '请从已登录 Bilibili 的浏览器重新导出并覆盖导入。';
  } else if (!result.tracks.length) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = '未发现可下载的中英文平台字幕，下载时将跳过';
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
    skipped: '已跳过',
  }[status] || '待命';
}

function renderTask(taskData, container) {
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
  const outputPath = document.createElement('p');
  outputPath.className = 'task-path';
  outputPath.textContent = taskData.outputDirectory;
  task.append(head, track, outputPath);
  container.append(task);
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
  if (job.items) {
    const progress = document.createElement('div');
    progress.className = 'batch-progress';
    const text = document.createElement('p');
    text.textContent = `${job.processed} / ${job.total} 条已处理`;
    const track = document.createElement('div');
    track.className = 'progress-track';
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    bar.style.width = `${job.total ? job.processed / job.total * 100 : 0}%`;
    track.append(bar);
    progress.append(text, track);
    elements.taskList.append(progress);
    for (const [index, item] of job.items.entries()) {
      const group = document.createElement('article');
      group.className = 'batch-item';
      const head = document.createElement('div');
      head.className = 'task-head';
      const title = document.createElement('strong');
      title.textContent = `${index + 1}. ${item.title || item.url}`;
      const state = document.createElement('span');
      state.className = 'task-status';
      state.textContent = statusLabel(item.status);
      head.append(title, state);
      const message = document.createElement('p');
      message.className = 'batch-item-message';
      message.textContent = item.message;
      group.append(head, message);
      for (const task of item.tasks) renderTask(task, group);
      elements.taskList.append(group);
    }
  } else {
    for (const task of job.tasks || []) renderTask(task, elements.taskList);
  }

  elements.jobLogs.textContent = (job.logs || []).join('\n') || '暂无日志';
  jobRunning = running;
  updateControlAvailability();
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

function updateContentOptions() {
  elements.contentOptions.classList.toggle('hidden', !elements.outputVideo.checked && !elements.outputSubtitles.checked);
  elements.videoOptions.classList.toggle('hidden', !elements.outputVideo.checked);
  elements.subtitleOptions.classList.toggle('hidden', !elements.outputSubtitles.checked);
}

function updateResourceUrl() {
  hasValidUrl = false;
  try {
    const urls = resourceUrls();
    hasValidUrl = true;
    elements.urlStatus.textContent = `已识别：Bilibili · ${urls.length} 个视频链接`;
  } catch (error) {
    elements.urlStatus.textContent = error.message;
  }
  elements.resourcePreview.classList.add('hidden');
  showMessage('');
  updateControlAvailability();
}

elements.url.addEventListener('input', updateResourceUrl);

elements.outputVideo.addEventListener('change', updateContentOptions);
elements.outputSubtitles.addEventListener('change', updateContentOptions);
updateContentOptions();

elements.cookieFile.addEventListener('change', async () => {
  const file = elements.cookieFile.files?.[0];
  if (!file || !cookieServiceReady) return;

  const previousLabel = elements.cookieActionLabel.textContent;
  elements.cookieActionLabel.textContent = '正在导入…';
  elements.cookiePanel.className = 'login-panel loading';
  try {
    const content = await file.text();
    const status = await api('/api/cookies/import', {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    renderCookieStatus(status);
    showMessage('');
  } catch (error) {
    await loadCookieStatus();
    elements.cookieActionLabel.textContent = previousLabel;
    showMessage(`Cookie 导入失败：${error.message}。原有登录状态未被修改。`);
  } finally {
    elements.cookieFile.value = '';
  }
});

elements.cookieClear.addEventListener('click', async () => {
  if (!window.confirm('确定清除本机保存的 Bilibili cookies.txt 吗？清除后将无法下载。')) return;
  try {
    const status = await api('/api/cookies', { method: 'DELETE' });
    renderCookieStatus(status);
    elements.resourcePreview.classList.add('hidden');
    showMessage('');
  } catch (error) {
    showMessage(error.message);
  }
});

elements.probeButton.addEventListener('click', async () => {
  const input = elements.url.value;
  showMessage('');
  probeBusy = true;
  setBusy(elements.probeButton, true, '检测资源');
  try {
    const urls = resourceUrls();
    const results = [];
    for (const [index, url] of urls.entries()) {
      elements.probeButton.textContent = `检测 ${index + 1} / ${urls.length}`;
      try {
        results.push({ ...await api('/api/probe', { method: 'POST', body: JSON.stringify({ url }) }), url });
      } catch (error) {
        results.push({ url, error: error.message });
      }
      if (input !== elements.url.value) return;
    }
    if (results.length === 1) {
      if (results[0].error) throw new Error(results[0].error);
      renderProbe(results[0]);
    } else {
      elements.resourcePreview.classList.add('batch-preview');
      elements.previewImage.hidden = true;
      elements.previewId.textContent = `Bilibili · ${results.length} 个视频`;
      elements.previewTitle.textContent = '资源检测结果';
      elements.subtitleSummary.replaceChildren();
      for (const [index, result] of results.entries()) {
        const row = document.createElement('div');
        row.className = 'probe-result';
        const title = document.createElement('strong');
        title.textContent = `${index + 1}. ${result.title || result.url}`;
        const summary = document.createElement('p');
        summary.textContent = result.error || (result.authRequired ? '当前登录状态无法读取字幕'
          : result.tracks.length ? result.tracks.map((track) => `${track.type === 'ai' ? 'AI' : '人工'}${track.language === 'zh' ? '中文' : '英文'}字幕`).join('、')
            : '未发现可下载的中英文字幕');
        row.append(title, summary);
        elements.subtitleSummary.append(row);
      }
      elements.resourcePreview.classList.remove('hidden');
    }
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(elements.probeButton, false, '检测资源');
    probeBusy = false;
    updateControlAvailability();
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
  if (jobRunning || !cookieConfigured) return;
  jobRunning = true;
  updateControlAvailability();
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
    jobRunning = false;
    showMessage(error.message);
    updateControlAvailability();
  }
});

updateResourceUrl();
void loadCookieStatus();
void loadHealth();
