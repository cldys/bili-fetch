# BiliFetch

一个运行在 macOS 本机的网页下载器，支持直接运行或使用本机 Docker Desktop。浏览器提供操作界面，Node 服务通过 `yt-dlp` 下载 Bilibili 视频、音频和字幕。

## 功能

- 多个独立视频链接批量下载，每行一个，自动去除空行和重复链接
- 视频、音频、字幕任意多选
- 人工字幕、AI 字幕多选
- 中文、英文字幕多选
- 字幕下载后自动保留 SRT 并生成同目录的纯文本 TXT
- 先探测实际字幕标签，再传给 `yt-dlp`
- 缺少所选字幕时给出提示，不阻断视频或音频任务
- 仅通过 `cookies.txt` 使用 Bilibili 登录状态
- Cookie 导入一次后持久保存，下次启动自动加载
- 未导入有效 Cookie 时，资源检测和下载功能保持锁定
- 网页目录选择器支持浏览共享目录、返回上一级、新建文件夹
- 默认仅通过本机 `127.0.0.1` 访问

## Docker 运行（推荐）

需要已安装并启动 Docker Desktop，以及 Docker Compose v2 或更高版本。应用服务、Node.js、`yt-dlp`、`ffmpeg` 均在 Linux 容器内运行，本机无需安装 Node 或 Homebrew 下载工具。镜像使用多架构 Node 基础镜像和与架构无关的 `yt-dlp` Python 入口，适用于 Apple Silicon 和 Intel Mac。

首次启动前停止占用 `4317` 端口的本地服务，然后在项目目录执行：

```bash
./scripts/docker-start.sh
```

启动脚本只检查 Docker、准备共享目录、传入当前用户 UID/GID，然后调用 Compose；它不作为后台服务运行。首次构建需要联网下载基础镜像及容器内工具，`yt-dlp` 固定为 `2026.08.19` 并验证发布校验和。浏览器打开：

```text
http://127.0.0.1:4317
```

默认使用以下绑定挂载，下载结果直接写入 Mac，无需从容器导出：

| 用途 | Mac 目录 | 容器内目录 |
| --- | --- | --- |
| 可选下载范围 | `$HOME/Downloads` | 与 Mac 相同的绝对路径 |
| 默认保存位置 | `$HOME/Downloads/download/BiliFetch` | 与 Mac 相同的绝对路径 |
| 登录数据 | `$HOME/Library/Application Support/BiliFetch` | `/data` |

原有 `Video`、`Audio`、`Subtitles` 子目录和 SRT/TXT 生成规则不变。网页中显示的下载路径可以直接在 Finder 中打开。现有 Cookie 由应用从挂载的数据目录加载；重新导入和清除也会作用于同一份数据。不要同时启动使用同一数据目录的本地服务和容器。

容器重启、重建或执行 `docker compose down` 都会保留这些本机目录中的文件。运行中的任务和排队信息仍保存在内存中，与直接运行一致，停止或重建前请等待下载结束。

常用命令：

```bash
# 查看状态和日志
docker compose ps
docker compose logs --tail=100 bilifetch

# 停止（保留本机文件）
docker compose down

# 修改代码后重新构建并启动
./scripts/docker-start.sh
```

启动脚本会匹配本机用户 UID/GID，避免下载文件归容器用户所有。直接运行 `docker compose up` 时，需自行准备目录并提供 `BILIFETCH_UID`、`BILIFETCH_GID`。默认仅发布 `127.0.0.1:4317`；容器内部监听 `0.0.0.0`，以便 Docker 转发端口。

### 网页选择保存目录

点击“选择…”会打开网页弹窗，支持进入子目录、返回上一级、输入完整路径、新建文件夹和“保存到这里”。取消不会改变原来的保存位置。目录名称支持中文和空格。

Docker 默认只共享 `Downloads`，未共享路径会明确报错；符号链接不能跳出配置的下载范围。确认保存位置时检查目录写入权限，下载开始前也会检查各输出子目录。无需 macOS 原生目录窗口或本机辅助程序。

更换整个下载范围或隔离登录数据，可以在每次启动时设置：

```bash
BILIFETCH_HOST_DOWNLOADS_DIRECTORY="/Volumes/Media" \
BILIFETCH_HOST_DATA_DIRECTORY="$HOME/Library/Application Support/BiliFetch-Docker" \
./scripts/docker-start.sh
```

先确认外置硬盘已挂载，且 Docker Desktop 允许共享该目录。上述两个主机目录变量必须在后续 Compose 命令中保持一致；也可以将自定义路径固定在本地 `compose.override.yaml` 中。

若要同时保留 `Downloads` 并增加外置硬盘，可新建 `compose.override.yaml`（将 `/Users/cailu` 替换为实际用户主目录）：

```yaml
services:
  bilifetch:
    environment:
      BILIFETCH_DOWNLOAD_ROOTS: '["/Users/cailu/Downloads", "/Volumes/Media"]'
    volumes:
      - type: bind
        source: /Volumes/Media
        target: /Volumes/Media
        bind:
          create_host_path: false
```

添加后重新执行启动脚本。新增位置必须同时配置绑定挂载和允许的下载范围，才能在“共享目录”中选择。不要把整台 Mac 的根目录挂载进容器。

### Docker 故障排查

- 无法连接 Docker API：先启动 Docker Desktop，确认 `docker info` 成功。
- 端口 `4317` 已占用：停止原来的 `npm start` 服务或已有容器后再启动。
- 挂载或权限错误：检查 Docker Desktop 文件共享设置、本机目录读写权限和启动时传入的 UID/GID；不要通过递归修改整个 Downloads 的权限来解决。
- 下载工具缺失或解析兼容问题：更新 `Dockerfile` 中的 `YT_DLP_VERSION`，或在 `compose.override.yaml` 的 `build.args` 中设置 `YT_DLP_VERSION`，然后重新构建。容器内工具与本机 Homebrew 工具独立更新。

如需换用其他访问端口，可设置 `BILIFETCH_HOST_PORT=4318 ./scripts/docker-start.sh`，随后访问 `http://127.0.0.1:4318`。若与本地服务同时运行，还应设置独立的 `BILIFETCH_HOST_DATA_DIRECTORY`。

开发验证可在构建镜像后执行 `npm run test:docker`（开发机需有 Node.js）。它使用临时目录和随机本机端口，检查网页目录接口、MP4/M4A/SRT/TXT 落盘及文件所有者、重建后的数据保留，并在 Linux 容器内执行完整测试。测试只导入生成的假 Cookie，不访问真实账号或下载网站资源；完成后清理测试容器和临时目录。

## 直接在 macOS 运行

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

每条视频下载到的字幕均自动保留 SRT 并生成 `_清理.txt`，分别保存在 `Subtitles` 目录，文件名包含视频 ID 和字幕标签。没有匹配字幕时跳过该条的字幕和 TXT，视频、音频任务仍继续。第一阶段的批量入口用于多个独立链接，不提供合集或作者主页批量下载。

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

字幕下载完成后，每个 SRT 文件会自动生成同名的 `_清理.txt`，例如 `视频标题.ai-zh.srt` 对应 `视频标题.ai-zh_清理.txt`。TXT 使用 UTF-8 编码，将文字合为一段，删除字幕序号、时间轴、简单 HTML 标签、空白和换行，保留原有标点；相邻完全重复字幕、整句扩展及至少 2 个字符的首尾重叠会自动合并。不同字幕分别导出，原始 SRT 保留，已有 TXT 不覆盖，无需额外操作或依赖。

Bilibili 的 AI 字幕在 `yt-dlp` 中通常仍位于普通字幕集合，并使用 `ai-zh`、`ai-en` 一类标签。本项目会带着已导入的 Cookie 执行 `--list-subs`，再按“人工/AI”和“中文/英文”的交集下载。

如果 Bilibili 返回“字幕仅登录可见”，页面会提示重新导入 Cookie；下载任务中只会跳过字幕，已选择的视频和音频任务仍继续。若所选语言或类型确实不存在，也只会给出提示。

Cookie 会过期。如果之前可用但后来无法检测 AI 中文字幕，请在浏览器重新登录 Bilibili、重新导出 `cookies.txt`，再使用页面的“重新导入”覆盖旧文件。

## 本地数据目录（开发/测试）

默认数据目录可以通过环境变量覆盖，便于隔离开发数据：

```bash
BILIFETCH_DATA_DIRECTORY=/tmp/bilifetch-dev npm start
```

生产式本地使用无需设置该变量。

直接运行时，网页目录选择器默认可浏览当前用户主目录。默认下载目录仍为 `~/Downloads/download/BiliFetch`。以下变量可覆盖运行配置：

| 变量 | 说明 |
| --- | --- |
| `HOST` | 监听地址；直接运行默认 `127.0.0.1` |
| `PORT` | 服务端口，默认 `4317` |
| `BILIFETCH_DOWNLOAD_DIRECTORY` | 默认下载绝对路径，必须位于允许的范围内 |
| `BILIFETCH_DOWNLOAD_ROOT` | 单个允许的下载根目录，默认当前用户主目录 |
| `BILIFETCH_DOWNLOAD_ROOTS` | 多个根目录的 JSON 数组；设置后优先于单目录配置 |
| `BILIFETCH_DATA_DIRECTORY` | Cookie 持久化目录 |

服务启动时会检查并创建默认下载目录；允许的根目录必须已存在。新增网页目录接口包括 `GET /api/directories?path=...`（省略路径时列出根目录）、`POST /api/directories`（`directory` 和 `name`）以及 `POST /api/select-directory`（`directory`，校验已存在且可写）。这些接口只操作文件夹，不返回文件内容。

下载内容应符合对应网站条款，并确保你有权保存相关资源。
