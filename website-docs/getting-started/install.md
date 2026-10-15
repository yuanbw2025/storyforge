# 安装与启动

推荐从 [最新版本下载页](https://github.com/yuanbw2025/storyforge/releases/latest) 获取本地便携包。最新便携包包含发布时冻结的主干功能、界面和内置媒资，不再要求普通用户先安装开发环境。旧 Release 保留为历史版本；固定发行不会自动跟随之后的主干开发。

## 便携包：无需安装 Node.js

| 电脑 | 选择的 ZIP | 解压后的启动文件 |
|---|---|---|
| Windows 64 位 | `StoryForge-vX.Y.Z-windows-x64.zip` | 双击 `Start-StoryForge.cmd` |
| Mac，M 系列芯片 | `StoryForge-vX.Y.Z-macos-arm64.zip` | 双击 `Start-StoryForge.command` |
| Mac，Intel 芯片 | `StoryForge-vX.Y.Z-macos-x64.zip` | 双击 `Start-StoryForge.command` |
| Linux x64 | `StoryForge-vX.Y.Z-linux-x64.zip` | 在解压目录运行 `bash Start-StoryForge.sh` |

1. 下载适合电脑的 ZIP，**先解压整个文件夹**，不要在压缩包内直接启动。
2. 打开对应启动文件。包内已包含 Node.js 和构建好的界面，不需要运行 `npm install`。
3. 浏览器会打开 `http://localhost:1111/storyforge/`。若没有自动打开，手动访问这个地址。
4. 使用期间保持启动窗口运行；退出按 `Ctrl+C`。端口被占用时先关闭旧服务，程序不会自动更换端口。

macOS 若阻止双击启动，可在解压目录的终端运行 `bash Start-StoryForge.command`；macOS/Linux 若解压工具没有保留运行权限，先运行 `chmod +x runtime/node`。便携包不是已签名的系统安装程序。

首页内置《雾港：失潮钟声》等作品可先体验，不需要模型 API。正式 AI 创作需要[配置自己的模型服务](/getting-started/model-config)；本地包提供同源提供商代理。Codex 订阅连接仍需另外安装并登录 Codex CLI。打包不会改变产品成熟度，预览功能仍保留预览标记。

发布页的 `SHA256SUMS.txt` 可核对 ZIP 是否下载完整。包内 `release.json` 标明版本、源码提交、平台与 Node.js 校验值。

## 开发者或其他架构：使用源码

使用与项目 CI 一致的 Node.js 24 和 npm：

```bash
git clone https://github.com/yuanbw2025/storyforge.git
cd storyforge
npm ci
npm run dev
```

不使用 Git 也可以下载 [最新 main 源码 ZIP](https://github.com/yuanbw2025/storyforge/archive/refs/heads/main.zip)，解压后运行同样的 `npm ci` 和 `npm run dev`。固定源码版本可从发布页的 `Source code (zip)` 获取。

默认地址同样是 `http://localhost:1111/storyforge/`。源码 ZIP 不包含依赖，需要联网安装；它与上面的便携 ZIP 是不同文件。

## 在线版与作品数据

[在线应用](https://yuanbw.vercel.app/storyforge/)可以直接打开，但部署可能晚于主干或固定发行。[官网项目体验页](https://storyforge-lab.com/storyforge/)关闭 AI 与外部服务，适合先看界面，不能替代完整本地版。

升级前先在旧版导出[完整 JSON 备份](/guides/backup-restore)。作品保存在当前浏览器，同一浏览器、同一 `http://localhost:1111` 地址下的旧数据可以继续使用；在线版、不同地址、端口和浏览器之间不自动转移数据。不要通过清除站点数据升级。正文导出不能代替完整备份。

涉及本地文件夹读写时，浏览器对 File System Access API 的支持会影响部分体验。下一步：[五分钟上手](/getting-started/quick-start)。
