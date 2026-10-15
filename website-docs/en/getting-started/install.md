# Install and launch

Get a local portable package from the [latest release page](https://github.com/yuanbw2025/storyforge/releases/latest). The latest portable version includes the main-branch features, interface and bundled media at release time; ordinary users no longer need a development setup. Older releases remain historical snapshots. A fixed release does not automatically receive later main-branch changes.

## Portable packages: no Node.js installation

| Computer | ZIP to download | Launcher after extraction |
|---|---|---|
| Windows 64-bit | `StoryForge-vX.Y.Z-windows-x64.zip` | Double-click `Start-StoryForge.cmd` |
| Mac with an M-series chip | `StoryForge-vX.Y.Z-macos-arm64.zip` | Double-click `Start-StoryForge.command` |
| Intel Mac | `StoryForge-vX.Y.Z-macos-x64.zip` | Double-click `Start-StoryForge.command` |
| Linux x64 | `StoryForge-vX.Y.Z-linux-x64.zip` | Run `bash Start-StoryForge.sh` in the extracted folder |

1. Download the ZIP matching your computer and **extract the entire folder** before launching. Do not launch from inside the ZIP.
2. Open the launcher. Node.js and the built interface are included; there is no need to run `npm install`.
3. Your browser opens `http://localhost:1111/storyforge/`. Open that address manually if necessary.
4. Keep the launcher window running; press `Ctrl+C` to stop. If the port is occupied, close the old service first. The launcher will not silently change ports.

If macOS blocks double-click launching, run `bash Start-StoryForge.command` in a terminal in the extracted folder. If a macOS/Linux extraction tool did not preserve executable permissions, run `chmod +x runtime/node` first. These portable packages are not signed system installers.

Start with built-in works such as Mist Harbor: The Lost Tide Bell, which need no model API. AI creation requires [your own model service](/en/getting-started/model-config); the local package provides same-origin provider proxies. The Codex subscription connection still requires a separately installed, logged-in Codex CLI. Packaging does not change product maturity: preview features retain their labels.

The release attachment `SHA256SUMS.txt` lets you verify ZIP integrity. The included `release.json` records the version, source commit, platform and Node.js checksum.

## Developers or other architectures: run the source

Use Node.js 24 and npm, matching project CI:

```bash
git clone https://github.com/yuanbw2025/storyforge.git
cd storyforge
npm ci
npm run dev
```

Without Git, download the [latest main source ZIP](https://github.com/yuanbw2025/storyforge/archive/refs/heads/main.zip), extract it and run the same `npm ci` and `npm run dev` commands. To get a fixed source version, use `Source code (zip)` on a release page.

The default address is also `http://localhost:1111/storyforge/`. Source ZIPs require an internet connection to install dependencies; they are different from the portable ZIPs above.

## Online use and work data

The [online app](https://yuanbw.vercel.app/storyforge/) opens directly, but deployment may lag behind main or a fixed release. The [official website experience](https://storyforge-lab.com/storyforge/) disables AI and external services. It previews the interface and does not replace the full local app.

Before upgrading, export a [full JSON backup](/en/guides/backup-restore) from the old version. Works remain in the current browser. Existing data at the same `http://localhost:1111` address in the same browser remains available; online deployments, different addresses, ports and browsers do not transfer data automatically. Do not clear site data to upgrade. Plain-text exports do not replace full backups.

Browser support for the File System Access API affects some local-folder workflows. Next: [Quick start](/en/getting-started/quick-start).
