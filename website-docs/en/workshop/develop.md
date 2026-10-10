---
title: Build your first plugin
lastVerified: 2026-10-09
---
# Build your first plugin

Goal: build independent chapter-checklist notes for a work, retaining saved content after reload and reinstallation. This teaches the delivery process; substitute any supported idea afterward.

This guide targets API 1 / SDK 0.1. Read [capabilities](./), then consult the [technical contract](https://github.com/yuanbw2025/storyforge/blob/main/docs/guides/PLUGIN-DEVELOPMENT.md) and local `tools/plugin-sdk/index.d.ts` for exact fields and lifecycle rules. The SDK is not published to npm: do not expect `npm install @storyforge/plugin-sdk` to find an official release.

## 1 Prepare the environment

Use Git, Node.js 24, npm, and an editor or coding AI that can edit files. A chat-only assistant can draft code but cannot complete local packaging and installation checks for you.

Clone main into a new folder. Do not overwrite or force-switch an existing checkout with unsaved work:

```sh
git clone --branch main --single-branch https://github.com/yuanbw2025/storyforge.git storyforge-plugin-dev
cd storyforge-plugin-dev
npm ci
```

This is a development branch, not an immutable release. Record `git rev-parse HEAD` and match the host, SDK and reference kit. Do not mix types and implementations from different versions.

## 2 Create independent source

From the StoryForge repository root:

```sh
node tools/plugin-sdk/cli.mjs create ../chapter-checklist
```

The destination must not exist. It receives `manifest.json`, `src/index.tsx` and a development `package.json`. The CLI uses types and build tools already installed in StoryForge; the minimal example needs no second dependency installation. Keep plugin source separate from the host, optionally in its own Git repository.

## 3 Change identity and UI

Edit these fields in the new `manifest.json`, **retaining every other template field**:

```json
{
  "id": "yourname.chapter-checklist",
  "version": "0.1.0",
  "name": "Chapter checklist notes",
  "description": "Save chapter revision notes for the current work",
  "author": "Your name",
  "license": "MIT"
}
```

This is a field fragment, not a complete manifest. Replace `yourname` with your lowercase namespace and choose a license you are entitled and willing to use. Keep the ID stable after first publication; increment versions for updates.

Set `views[0].title` to your title. Edit the heading, explanation and placeholder in `src/index.tsx`. Retain the template's loading, saving, error handling and `expectedRevision` logic for the first installable version. Data remains the `text` field in the `note` schema; changing copy does not require a new data shape.

**Result**: a named panel for saving checklist text in the current work. It does not automatically inspect or change chapter prose. Additional official content requires a supported SDK reader; do not access private host tables.

## 4 Check and package

From the StoryForge repository root:

```sh
node tools/plugin-sdk/cli.mjs check ../chapter-checklist
node tools/plugin-sdk/cli.mjs pack ../chapter-checklist ../yourname.chapter-checklist-0.1.0.sfplugin
```

`check` validates the manifest, strict types and resulting archive. `pack` checks again, writes the package and prints its SHA-256. This proves static validation, not correct interaction or persistence. Do not simply ZIP TypeScript and rename its extension.

The package contains an independent JavaScript factory and assets, sharing host React. Import types from `@storyforge/plugin-sdk`; never import private host components, stores, databases or AI modules. Runtime CDN imports are unsupported. Put resources in `assets/` and use `ctx.resources.url()`. For a third-party pure JavaScript library, install and lock it in the plugin folder and verify browser bundling. Installing users do not run npm or Python.

## 5 Verify in an isolated work

Run `npm run dev -- --host 127.0.0.1` and use the address printed by the terminal. Create a test work in an isolated browser profile, leaving the author's real workspace untouched.

Follow [installation](./install), select the current work and enable your package. At minimum:

- Save “Clarify motivation in chapter three”; reload and verify. Another work must not see it.
- Disable and enable; uninstall and reinstall the original package. Records must remain readable.
- Export a complete backup, import in another isolated environment, verify disabled-by-default state and recover after reinstallation.
- Edit in two tabs: stale saves should report a conflict instead of silently overwriting.
- Verify narrow-screen controls, visible errors and safe startup.

Increment the package version after code edits and test explicit version switching. Schema changes require implemented and verified migration. Never clear browser storage to make upgrades appear successful. Record passed, failed and untested cases before [publishing](./publish).

## 6 Extend the feature

| Need | Interface and rule |
| --- | --- |
| Own records and complex UI | `ui` + `data`; declared views and schemas; updates carry the last read revision |
| World or story timeline | `domain.history`, `history` / `story-timeline` slots; one replacement per target |
| Structured AI candidates | `aiTasks` + `ai.propose`; registered context only, explicit start and confirmation |
| Reuse another plugin | `provides` / `consumes` + `services`; exact dependencies and matching owner |
| World entries or tabletop rules | `worldSemantics` / `rulePacks`; explicit adoption or frozen release respectively |
| External services | `network` / `connectors`; declare destinations/tools, costs and environment |

Package format, SDK, plugin and record-schema versions have distinct meanings. Archives are limited to 16 MiB compressed, 32 MiB expanded and 256 files. Data uses a bounded schema subset. Consult the contract and types as needed; do not ask AI to guess method signatures.
