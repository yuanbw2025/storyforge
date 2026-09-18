# 安装与启动

StoryForge 当前以源码方式运行。推荐使用与项目 CI 一致的 Node.js 24 和 npm。

## 使用 Git

```bash
git clone https://github.com/yuanbw2025/storyforge.git
cd storyforge
npm ci
npm run dev
```

终端会显示本地访问地址。应用路径为 `/storyforge/`；端口被占用时以终端实际输出为准。

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
