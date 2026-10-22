# BiliFetch

一个运行在 macOS 本机的网页下载器。浏览器提供操作界面，本地 Node 服务通过 `yt-dlp` 下载 Bilibili 视频、音频和字幕。

## 功能

- 多个独立视频链接批量下载，每行一个，自动去除空行和重复链接
- 视频、音频、字幕任意多选
- 人工字幕、AI 字幕多选
- 中文、英文字幕多选
- 字幕下载后仅保留清理后的纯文本 TXT
- 先探测实际字幕标签，再传给 `yt-dlp`
- 缺少所选字幕时给出提示，不阻断视频或音频任务
- 仅通过 `cookies.txt` 使用 Bilibili 登录状态
- Cookie 导入一次后持久保存，下次启动自动加载
- 未导入有效 Cookie 时，资源检测和下载功能保持锁定
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

升级已通过 Homebrew 安装的下载和转换工具到 Homebrew 提供的最新稳定版本：

```bash
brew update && brew upgrade yt-dlp ffmpeg
```

提示：遇到视频解析失败或下载兼容性问题时，可先升级工具。请等待当前下载结束并停止本项目服务，升级完成后重新执行 `npm start` 并刷新页面。命令先更新 Homebrew，再升级 `yt-dlp` 和 `ffmpeg`，用法见 [Homebrew 官方文档](https://docs.brew.sh/Manpage#upgrade-options-installed_formulainstalled_cask-)。

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

## 批量下载

在“资源地址”每行粘贴一个 Bilibili 视频链接或 b23.tv 短链接。空行会忽略，规范化后完全相同的链接只处理一次；无效链接会标明所在行，修正后再提交。

整批使用同一组内容、质量、字幕类型、语言和保存目录。点击“检测资源”可逐条查看检测结果，点击“开始下载”后按输入顺序执行；多个下载请求也会排队，默认一次处理一个视频。单条失败后继续处理后续链接，右侧显示整批进度及每条的完成、失败或跳过状态。

每条视频下载到的字幕均只保留对应的 `_清理.txt`，分别保存在 `Subtitles` 目录，文件名包含视频 ID 和字幕标签，不保留 SRT。没有匹配字幕时跳过该条的字幕和 TXT，视频、音频任务仍继续。第一阶段的批量入口用于多个独立链接，不提供合集或作者主页批量下载。

## Cookie 登录状态

页面打开时自动加载 Bilibili Cookie 状态，无需先输入视频链接；导入、重新导入和清除 Cookie 均可独立操作。首次使用需在“登录状态”导入有效的 Netscape 格式 `cookies.txt`，文件需要包含 `bilibili.com` 的有效 `SESSDATA`。资源检测和下载需同时满足链接有效且 Cookie 已配置。“Cookie 已加载”表示本地已保存 Cookie，实际登录是否有效由资源检测或下载结果确认。

推荐流程：

1. 在浏览器中登录 Bilibili，并确认可以正常观看目标视频和字幕。
2. 使用可信的浏览器扩展把当前站点 Cookie 导出为 Netscape 格式的 `cookies.txt`。
3. 在 BiliFetch 首页的“登录状态”导入该文件。
4. 页面显示“Bilibili Cookie 已加载”后，粘贴视频链接，再检测和下载资源。

不要直接把浏览器 Cookie 数据库路径交给 `yt-dlp`。之前出现的：

```text
ERROR: could not find chrome cookies database in "/Users/.../Library/Application Support/Google/Chrome"
```

表示 `yt-dlp` 没找到 Chrome 的 Cookie 数据库，常见于未安装标准版 Chrome、使用其他浏览器/独立 Profile，或 macOS 权限受限。当前版本不再读取浏览器数据库，因此不会依赖 Chrome 的安装路径或“完全磁盘访问权限”。

### 保存和覆盖规则

导入成功后，服务只保留 bilibili.com 域的有效记录，并持久保存到：

```text
~/Library/Application Support/BiliFetch/cookies.txt
```

- 目录权限为 `0700`，文件权限为 `0600`
- 页面和运行日志不会返回 Cookie 内容或实际保存路径
- 重新导入时先完整校验新文件，再原子覆盖旧文件
- 新文件无效时保留原来的登录状态，不会破坏已有文件
- 点击页面中的“清除”会删除已保存文件，并立即锁定检测和下载功能

`cookies.txt` 本质上是登录凭据。不要将它提交到 Git，也不要粘贴到聊天、日志或截图中。如果怀疑泄露，请立即退出 Bilibili 登录或在账号安全页面撤销会话，再重新导出。

## 字幕说明

字幕下载完成后，每个字幕标签会自动生成对应的 `_清理.txt`，例如 `视频标题 [BV123].ai-zh_清理.txt`。TXT 使用 UTF-8 编码，将文字合为一段，删除字幕序号、时间轴、简单 HTML 标签、空白和换行，保留原有标点；相邻完全重复字幕、整句扩展及至少 2 个字符的首尾重叠会自动合并。不同字幕分别导出，SRT 仅在临时目录中用于转换，任务结束后自动清理，`Subtitles` 目录只新增 TXT，已有 TXT 不覆盖。历史下载的 SRT 不会自动删除，无需额外操作或依赖。

Bilibili 的 AI 字幕在 `yt-dlp` 中通常仍位于普通字幕集合，并使用 `ai-zh`、`ai-en` 一类标签。本项目会带着已导入的 Cookie 执行 `--list-subs`，再按“人工/AI”和“中文/英文”的交集下载。

如果 Bilibili 返回“字幕仅登录可见”，页面会提示重新导入 Cookie；下载任务中只会跳过字幕，已选择的视频和音频任务仍继续。若所选语言或类型确实不存在，也只会给出提示。

Cookie 会过期。如果之前可用但后来无法检测 AI 中文字幕，请在浏览器重新登录 Bilibili、重新导出 `cookies.txt`，再使用页面的“重新导入”覆盖旧文件。

## 本地数据目录（开发/测试）

默认数据目录可以通过环境变量覆盖，便于隔离开发数据：

```bash
BILIFETCH_DATA_DIRECTORY=/tmp/bilifetch-dev npm start
```

生产式本地使用无需设置该变量。

下载内容应符合对应网站条款，并确保你有权保存相关资源。
