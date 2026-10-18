import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

function createApp(fetchHandler, cookieStatus = { platform: 'bilibili', configured: true, cookieCount: 1 }) {
  const elements = new Map();
  const streams = [];
  const requests = [];
  function node(tag = '') {
    const classes = new Set(tag.match(/class="([^"]*)"/)?.[1].split(' ') || []);
    return {
      value: '', checked: /\schecked(?:\s|>)/.test(tag), textContent: '', style: {}, children: [], listeners: {},
      classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, toggle(name, active) { active ? classes.add(name) : classes.delete(name); } },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(event, handler) { this.listeners[event] = handler; },
      showModal() { this.open = true; },
      close() { this.open = false; },
    };
  }
  const context = vm.createContext({
    URL,
    encodeURIComponent,
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, node(html.match(new RegExp(`<[^>]+id="${selector.slice(1)}"[^>]*>`))?.[0]));
        return elements.get(selector);
      },
      createElement() { return node(); },
    },
    fetch: async (url, options) => {
      requests.push(url);
      const data = url === '/api/cookies/status' ? cookieStatus : await fetchHandler(url, options);
      return { ok: !data.error, json: async () => data };
    },
    window: { confirm: () => true },
    EventSource: class {
      constructor(url) { this.url = url; this.closed = false; streams.push(this); }
      close() { this.closed = true; }
    },
  });
  vm.runInContext(source.replace('void loadHealth();', ''), context);
  return { elements, context, streams, requests };
}

async function enterUrls(app, input) {
  app.elements.get('#url').value = input;
  app.elements.get('#url').listeners.input();
  await new Promise(setImmediate);
}

function visibleText(element) {
  return [element.textContent, ...element.children.map(visibleText)].join(' ');
}

async function loadStatus(status) {
  const elements = new Map();
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, {
          textContent: '',
          classList: { add() {}, toggle() {} },
        });
        return elements.get(selector);
      },
    },
    fetch: async () => ({ ok: true, json: async () => status }),
  });
  vm.runInContext(source.slice(0, source.indexOf('function renderProbe(')), context);
  await vm.runInContext('loadCookieStatus()', context);
  return elements;
}

test('legacy backend status is rejected when the service identity is missing', async () => {
  const elements = await loadStatus({ configured: true, cookieCount: 26 });
  assert.equal(elements.get('#cookie-title').textContent, '登录状态读取失败');
  assert.match(elements.get('#cookie-description').textContent, /重启 BiliFetch/);
  for (const selector of ['#cookie-file', '#download-controls', '#probe-button', '#download-button']) {
    assert.equal(elements.get(selector).disabled, true, selector);
  }
});

test('unsupported service identity cannot unlock Bilibili actions', async () => {
  const elements = await loadStatus({ platform: 'unsupported', configured: true, cookieCount: 26 });
  assert.equal(elements.get('#cookie-file').disabled, true);
  assert.equal(elements.get('#download-controls').disabled, true);
  assert.match(elements.get('#cookie-description').textContent, /版本不匹配/);
});

test('verified Bilibili status without imported cookies enables import only', async () => {
  const elements = await loadStatus({ platform: 'bilibili', configured: false, cookieCount: 0 });
  assert.equal(elements.get('#cookie-title').textContent, '尚未导入Bilibili Cookie');
  assert.equal(elements.get('#cookie-file').disabled, false);
  assert.equal(elements.get('#download-controls').disabled, true);
  assert.equal(elements.get('#probe-button').disabled, true);
});

test('startup loads cookies without a URL and editing URLs leaves cookie status unchanged', async () => {
  const app = createApp();
  await new Promise(setImmediate);
  assert.equal(app.elements.get('#cookie-title').textContent, 'Bilibili Cookie 已加载');
  assert.equal(app.elements.get('#cookie-file').disabled, false);
  for (const selector of ['#download-controls', '#probe-button', '#download-button']) {
    assert.equal(app.elements.get(selector).disabled, true, selector);
  }

  await enterUrls(app, 'https://b23.tv/first');
  for (const selector of ['#download-controls', '#probe-button', '#download-button']) {
    assert.equal(app.elements.get(selector).disabled, false, selector);
  }
  for (const input of ['https://example.com/video', '']) {
    await enterUrls(app, input);
    assert.equal(app.elements.get('#cookie-title').textContent, 'Bilibili Cookie 已加载');
    assert.equal(app.elements.get('#cookie-file').disabled, false);
    for (const selector of ['#download-controls', '#probe-button', '#download-button']) {
      assert.equal(app.elements.get(selector).disabled, true, selector);
    }
  }
  assert.deepEqual(app.requests, ['/api/cookies/status']);
});

test('cookies can be imported and cleared without entering a URL', async () => {
  const app = createApp((url, options) => {
    if (url === '/api/cookies/import') {
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).content, 'Fixture cookie file');
      return { platform: 'bilibili', configured: true, cookieCount: 1 };
    }
    assert.equal(url, '/api/cookies');
    assert.equal(options.method, 'DELETE');
    return { platform: 'bilibili', configured: false, cookieCount: 0 };
  }, { platform: 'bilibili', configured: false, cookieCount: 0 });
  await new Promise(setImmediate);
  assert.equal(app.elements.get('#cookie-file').disabled, false);
  app.elements.get('#cookie-file').files = [{ text: async () => 'Fixture cookie file' }];
  await app.elements.get('#cookie-file').listeners.change();
  assert.equal(app.elements.get('#cookie-title').textContent, 'Bilibili Cookie 已加载');
  assert.equal(app.elements.get('#cookie-action-label').textContent, '重新导入');
  assert.equal(app.elements.get('#download-button').disabled, true);

  await app.elements.get('#cookie-clear').listeners.click();
  assert.equal(app.elements.get('#cookie-title').textContent, '尚未导入Bilibili Cookie');
  assert.equal(app.elements.get('#cookie-file').disabled, false);
  await enterUrls(app, 'https://b23.tv/first');
  for (const selector of ['#download-controls', '#probe-button', '#download-button']) {
    assert.equal(app.elements.get(selector).disabled, true, selector);
  }
  assert.deepEqual(app.requests, ['/api/cookies/status', '/api/cookies/import', '/api/cookies']);
});

test('a failed cookie replacement restores saved status and shows the error without a URL', async () => {
  const app = createApp(() => ({ error: 'Fixture invalid cookie file' }));
  await new Promise(setImmediate);
  app.elements.get('#cookie-file').files = [{ text: async () => 'Fixture invalid file' }];
  await app.elements.get('#cookie-file').listeners.change();
  assert.equal(app.elements.get('#cookie-title').textContent, 'Bilibili Cookie 已加载');
  assert.equal(app.elements.get('#cookie-action-label').textContent, '重新导入');
  assert.equal(app.elements.get('#cookie-file').disabled, false);
  assert.equal(app.elements.get('#download-button').disabled, true);
  assert.match(app.elements.get('#form-message').textContent, /Fixture invalid cookie file.*原有登录状态未被修改/);
});

test('batch input deduplicates links, keeps shared defaults and rejects an invalid line', async () => {
  const app = createApp();
  await enterUrls(app, 'https://b23.tv/first\n\nhttps://b23.tv/second\nhttps://b23.tv/first');
  assert.match(app.elements.get('#url-status').textContent, /2 个视频链接/);
  assert.equal(app.elements.get('#download-controls').disabled, false);
  const payload = JSON.parse(vm.runInContext('JSON.stringify(formPayload())', app.context));
  assert.deepEqual(payload.urls, ['https://b23.tv/first', 'https://b23.tv/second']);
  assert.deepEqual(payload.outputs, { video: false, audio: false, subtitles: true });
  assert.deepEqual(payload.subtitleTypes, ['ai']);
  assert.deepEqual(payload.subtitleLanguages, ['zh']);
  await enterUrls(app, 'https://b23.tv/first\n\nhttps://example.com/video');
  assert.match(app.elements.get('#url-status').textContent, /第 3 行/);
  assert.equal(app.elements.get('#download-controls').disabled, true);
});

test('batch probing continues after a failure and displays each result', async () => {
  const calls = [];
  const app = createApp((url, options) => {
    assert.equal(url, '/api/probe');
    const video = JSON.parse(options.body).url;
    calls.push(video);
    return video.endsWith('failed') ? { error: 'Fixture probe failed' } : { title: video, tracks: [], authRequired: false };
  });
  await enterUrls(app, 'https://b23.tv/first\nhttps://b23.tv/failed\nhttps://b23.tv/last');
  await app.elements.get('#probe-button').listeners.click();
  assert.deepEqual(calls, ['https://b23.tv/first', 'https://b23.tv/failed', 'https://b23.tv/last']);
  assert.equal(app.elements.get('#subtitle-summary').children.length, 3);
  assert.match(visibleText(app.elements.get('#subtitle-summary')), /Fixture probe failed/);
  assert.equal(app.elements.get('#probe-button').disabled, false);
});

test('batch submission and progress keep the stream open until all links have finished', async () => {
  const urls = ['https://b23.tv/first', 'https://b23.tv/second'];
  const job = { id: 'batch-fixture', status: 'queued', message: '任务已创建', total: 2, processed: 0, currentIndex: 0, warnings: [], logs: [], tasks: [],
    items: urls.map((url) => ({ url, title: '', status: 'queued', message: '等待中', tasks: [] })) };
  const app = createApp((url, options) => {
    assert.equal(url, '/api/download');
    assert.deepEqual(JSON.parse(options.body).urls, urls);
    return job;
  });
  await enterUrls(app, urls.join('\n'));
  await app.elements.get('#download-form').listeners.submit({ preventDefault() {} });
  const stream = app.streams[0];
  assert.equal(stream.url, '/api/jobs/batch-fixture/events');
  assert.equal(app.elements.get('#download-button').disabled, true);
  job.status = 'probing';
  job.currentIndex = 2;
  job.processed = 1;
  job.items[0].status = 'completed';
  job.items[1].status = 'probing';
  stream.onmessage({ data: JSON.stringify(job) });
  assert.equal(stream.closed, false);
  assert.match(visibleText(app.elements.get('#task-list')), /1 \/ 2 条已处理/);
  job.status = 'partial';
  job.processed = 2;
  job.items[1].status = 'failed';
  job.items[1].message = 'Fixture failure';
  stream.onmessage({ data: JSON.stringify(job) });
  assert.equal(stream.closed, true);
  assert.equal(app.elements.get('#download-button').disabled, false);
  assert.match(visibleText(app.elements.get('#task-list')), /Fixture failure/);
});

test('web directory picker navigates and creates folders, confirming only the chosen path', async () => {
  const root = '/shared/下载目录';
  const child = `${root}/中文 folder`;
  const created = `${child}/新建文件夹`;
  const app = createApp((url, options) => {
    if (url === '/api/directories' && options?.method === 'POST') {
      assert.deepEqual(JSON.parse(options.body), { directory: child, name: '新建文件夹' });
      return { directory: created };
    }
    if (url === '/api/select-directory') {
      assert.deepEqual(JSON.parse(options.body), { directory: created });
      return { directory: created };
    }
    const directory = url.includes('?') ? decodeURIComponent(url.split('?path=')[1]) : null;
    return { directory, parent: directory === root ? null : root,
      directories: !directory ? [{ name: root, path: root }] : directory === root ? [{ name: '中文 folder', path: child }] : [] };
  });
  app.elements.get('#directory').value = root;
  await app.elements.get('#directory-button').listeners.click();
  assert.equal(app.elements.get('#directory-dialog').open, true);
  assert.equal(app.elements.get('#directory-up').disabled, true);
  await app.elements.get('#directory-list').children[0].listeners.click();
  assert.equal(app.elements.get('#directory-path').value, child);
  assert.equal(app.elements.get('#directory').value, root);
  app.elements.get('#directory-name').value = '新建文件夹';
  await app.elements.get('#directory-create-form').listeners.submit({ preventDefault() {} });
  assert.equal(app.elements.get('#directory-path').value, created);
  await app.elements.get('#directory-confirm').listeners.click();
  assert.equal(app.elements.get('#directory').value, created);
  assert.equal(app.elements.get('#directory-dialog').open, false);
});

test('directory picker falls back to shared roots and cancel preserves the original path', async () => {
  const app = createApp((url) => url.includes('?') ? { error: '该目录未共享' }
    : { directory: null, parent: null, directories: [{ name: '/shared', path: '/shared' }] });
  app.elements.get('#directory').value = '/unmounted';
  await app.elements.get('#directory-button').listeners.click();
  assert.match(app.elements.get('#directory-message').textContent, /未共享/);
  assert.equal(app.elements.get('#directory-confirm').disabled, true);
  assert.equal(app.elements.get('#directory-create').disabled, true);
  app.elements.get('#directory-cancel').listeners.click();
  assert.equal(app.elements.get('#directory-dialog').open, false);
  assert.equal(app.elements.get('#directory').value, '/unmounted');
});

test('a rejected save location leaves the picker open and does not change the download path', async () => {
  const app = createApp((url) => url === '/api/select-directory' ? { error: '目录不可写' }
    : { directory: '/shared', parent: null, directories: [] });
  app.elements.get('#directory').value = '/shared';
  await app.elements.get('#directory-button').listeners.click();
  await app.elements.get('#directory-confirm').listeners.click();
  assert.equal(app.elements.get('#directory-dialog').open, true);
  assert.match(app.elements.get('#directory-message').textContent, /不可写/);
  assert.equal(app.elements.get('#directory').value, '/shared');
});

test('confirming an edited directory path validates the displayed path instead of saving the previous folder', async () => {
  const app = createApp((url, options) => {
    if (url === '/api/select-directory') {
      assert.equal(JSON.parse(options.body).directory, '/shared/edited');
      return { directory: '/shared/edited' };
    }
    return { directory: '/shared', parent: null, directories: [] };
  });
  app.elements.get('#directory').value = '/shared';
  await app.elements.get('#directory-button').listeners.click();
  app.elements.get('#directory-path').value = '/shared/edited';
  await app.elements.get('#directory-confirm').listeners.click();
  assert.equal(app.elements.get('#directory').value, '/shared/edited');
});
