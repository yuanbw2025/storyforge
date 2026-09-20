# 安装与启动

可以使用 [StoryForge 在线版](https://yuanbw.vercel.app/storyforge/)，也可以在本地运行源码。在线部署可能有时差；本文档按当前 main 说明。

本地运行推荐使用与项目 CI 一致的 Node.js 24 和 npm。

## 使用 Git

```bash
git clone https://github.com/yuanbw2025/storyforge.git
cd storyforge
npm ci
npm run dev
```

终端会显示本地访问地址。应用路径为 `/storyforge/`；端口被占用时以终端实际输出为准。

例如默认端口可用时是 `http://localhost:5173/storyforge/`。使用期间保持终端运行，退出按 `Ctrl+C`。

## 不使用 Git

也可以从 GitHub 下载最新 `main` 源码 ZIP，解压后在项目目录运行：

```bash
npm ci
npm run dev
```

::: warning
源码 ZIP 不是双击即可运行的安装包。旧 Release 是固定历史版本，不一定包含当前主干的全部功能。
:::

## 系统支持

源码方式可在 Windows、macOS、Linux 上运行。涉及本地文件夹读写时，浏览器对 File System Access API 的支持情况会影响部分体验。

在线版、本地地址和不同浏览器的作品存储分别独立，切换前请先[备份](/guides/backup-restore)。下一步：[五分钟上手](/getting-started/quick-start)。
