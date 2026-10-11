# BiliFetch

一个运行在 macOS 本机的网页下载器。浏览器负责操作界面，本地 Node 服务通过 `yt-dlp` 下载 Bilibili 视频、音频和字幕。

## 功能

- 视频、音频、字幕任意多选
- 人工字幕、AI 字幕多选
- 中文、英文字幕多选
- 先探测实际字幕标签，再传给 `yt-dlp`
- 缺少所选字幕时给出提示，不阻断视频或音频任务
- 支持 Chrome、Safari 登录状态或 `cookies.txt`
- 服务仅监听 `127.0.0.1`

## 环境

- macOS
- Node.js 20+
- `yt-dlp`
- `ffmpeg`

如果尚未安装命令行工具：

```bash
brew install yt-dlp ffmpeg
```

本项目没有 npm 第三方依赖，不需要执行 `npm install`。

## 启动

```bash
npm start
```

浏览器打开：

```text
http://127.0.0.1:4317
```

运行测试：

```bash
npm test
```

## 字幕说明

Bilibili 的 AI 字幕在 `yt-dlp` 中通常仍位于普通字幕集合，并使用 `ai-zh`、`ai-en` 一类标签。本项目会先通过 `--list-subs` 探测真实标签，再按“人工/AI”和“中文/英文”的交集下载。

部分字幕仅对已登录用户可见。如果探测不到字幕，可在页面中选择读取 Chrome、Safari 登录状态，或提供 Netscape 格式的 `cookies.txt` 绝对路径。

下载内容应符合对应网站条款，并确保你有权保存相关资源。
