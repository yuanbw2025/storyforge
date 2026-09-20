# Install and launch

Use the [StoryForge web app](https://yuanbw.vercel.app/storyforge/) or run the source locally. Live deployments may lag; these docs describe the current main branch.

For local use, Node.js 24 and npm are recommended, matching project CI.

## With Git

```bash
git clone https://github.com/yuanbw2025/storyforge.git
cd storyforge
npm ci
npm run dev
```

The terminal prints the local address. The app path is `/storyforge/`; if the port is occupied, use the actual terminal output.

With the default port available, the address is `http://localhost:5173/storyforge/`. Keep the terminal running while using the app; press `Ctrl+C` to stop.

## Without Git

Download the latest `main` source ZIP from GitHub, extract it, and run in the project folder:

```bash
npm ci
npm run dev
```

::: warning
A source ZIP is not a double-click installer. Old tagged releases are fixed historical versions and may lack current main-branch features.
:::

## System support

The source can run on Windows, macOS, and Linux. Browser support for the File System Access API affects some local-folder workflows.

The web app, local addresses, and different browsers use separate storage. [Back up](/en/guides/backup-restore) before switching. Next: [Quick start](/en/getting-started/quick-start).
