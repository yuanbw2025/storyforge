# 安装与启动

从[最新版本下载页](https://github.com/yuanbw2025/storyforge/releases/latest)选择客户端安装包或便携 ZIP。Windows 和 Mac 可安装桌面客户端，Android 使用 APK；Linux 使用便携 ZIP。便携包自带运行环境和内置媒资，无需先安装开发环境。

## Windows / macOS / Android 客户端 {#开发中的-windows-android-客户端}

[v4.0.2](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.2) 已于 2026-10-16 发布桌面安装器与 Android APK，另有四平台便携 ZIP。iOS 本次暂缓。

| 设备 | 下载文件 | 安装方式 |
|---|---|---|
| Windows x64 | `StoryForge-4.0.2-windows-x64-setup.exe` | 运行安装器 |
| Mac，M 系列芯片 | `StoryForge-4.0.2-macos-arm64.dmg` | 将 StoryForge 拖入“应用程序” |
| Mac，Intel 芯片 | `StoryForge-4.0.2-macos-x64.dmg` | 将 StoryForge 拖入“应用程序” |
| Android | `StoryForge-4.0.2-android.apk` | 允许该下载来源安装应用，再确认安装 |

Windows 安装器尚无发布者证书；macOS 使用本地签名，尚未通过 Apple 公证。系统可能要求明确允许打开。请先核对官方发行来源及校验值，不要关闭系统整体安全防护。

首次启动请阅读并同意《用户协议》，其中包含个人信息与隐私保护条款；设置中可再次查阅。在“通用设置 → 问题与建议”可主动提交 Bug 或功能建议。

客户端启动后检查更新，设置中也提供“检查更新”“下载更新”“安装更新”。保存编辑并结束生成任务后再安装：Windows 运行安装器；Android 需系统确认；macOS 打开已下载并校验的 DMG，由您替换“应用程序”里的旧版。检查或下载失败不影响继续使用当前版本。

首次从浏览器切换客户端，请先导出完整 JSON，再在客户端明确导入。浏览器与客户端分别保存作品，各设备不会自动同步。升级前保留备份，直接覆盖安装，不要卸载或清除应用数据。Android 模型服务需使用 HTTPS，不能使用电脑本机 Codex 登录或文件夹备份；长时间生成请保持应用前台。移动布局和专用导出入口仍保留当前适配限制。

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
git clone -c core.longpaths=true https://github.com/yuanbw2025/storyforge.git
cd storyforge
npm ci
npm run dev
```

Windows 请使用 Git for Windows，并选择较短的目录路径。上述克隆命令在检出前为本仓库启用长路径。若出现 `Filename too long` 或 fatal 检出错误，先停止，不要继续运行 npm。保留不完整目录及其中的本地修改，另选新目录克隆，避免覆盖文件。`npm run dev` 现在会在关键源码或配置缺失时拒绝启动 Vite；这项检查不能保证全部文件完整。参见 [Git 克隆配置说明](https://git-scm.com/docs/git-clone#Documentation/git-clone.txt--ckeyvalue)。

不使用 Git 也可以下载 [最新 main 源码 ZIP](https://github.com/yuanbw2025/storyforge/archive/refs/heads/main.zip)，解压后运行同样的 `npm ci` 和 `npm run dev`。固定源码版本可从发布页的 `Source code (zip)` 获取。

默认地址同样是 `http://localhost:1111/storyforge/`。源码 ZIP 不包含依赖，需要联网安装；它与上面的便携 ZIP 是不同文件。

## 在线版与作品数据

[在线应用](https://yuanbw.vercel.app/storyforge/)可以直接打开，但部署可能晚于主干或固定发行。[官网项目体验页](https://storyforge-lab.com/storyforge/)关闭 AI 与外部服务，适合先看界面，不能替代完整本地版。

升级前先在旧版导出[完整 JSON 备份](/guides/backup-restore)。作品保存在当前浏览器，同一浏览器、同一 `http://localhost:1111` 地址下的旧数据可以继续使用；在线版、不同地址、端口和浏览器之间不自动转移数据。不要通过清除站点数据升级。正文导出不能代替完整备份。

涉及本地文件夹读写时，浏览器对 File System Access API 的支持会影响部分体验。下一步：[五分钟上手](/getting-started/quick-start)。
