# StoryForge · 故事熔炉

**Turn ideas into finished works. Give stories a life beyond the page.**

[简体中文](./README.md) · [Open the web app](https://yuanbw.vercel.app/storyforge/) · [Source download](https://github.com/yuanbw2025/storyforge/archive/refs/heads/main.zip) · [Issues](https://github.com/yuanbw2025/storyforge/issues)

StoryForge is an open-source, local-first AI narrative creation and experience toolkit. Write long or short fiction, adapt a novel into a screenplay or comic, build reusable worlds, and explore character interaction and playable stories. You choose the workflow and approve AI candidates before they become part of your work.

![Current StoryForge product hub](./docs/assets/readme/product-hub.png)

> This introduction describes `main`, checked on September 9, 2026. Long-form writing, short fiction, screenplay adaptation, comic adaptation, and the world engine have released product entries. Nodes and interactive products are previews. Historical GitHub Releases do not include subsequent changes; the hosted site may lag behind `main`. Use current source for the features shown here. Screenshots are from an isolated local workspace, not an author's private manuscript.

## Choose your starting point

| Goal | Entry | Result and maturity |
|---|---|---|
| Write a novel | New → Long novel | Settings, characters, outlines, chapters, continuity and revision; current engineering workflow accepted |
| Finish short fiction | New → Short novel | Story design, chapter cards, drafting, review, frozen release, Markdown/TXT/JSON export |
| Adapt a novel into a screenplay | New → Novel to screenplay | Frozen source, adaptation decisions, beats, scene writing, review, Fountain/FDX/print export |
| Adapt a novel into a comic | New → Novel to comic | Pages, panels, visual references, lettering, storyboard/visual releases and PNG/WebP/CBZ/PDF export; visual output depends on supported image services or suitable author assets |
| Build a world | New → World engine | Semantic content, explicit derivation, frozen world versions and read access |
| Compose a visual workflow | Node authoring | Preview; shares the long-form backend and work data |
| Play an original adventure | TTRPG → Published adventures | Community preview of *Fog Harbor: The Last Light* |
| Create interactive experiences | Character chat / Afterstory town / Text games | Preview; each product has its own production and runtime lifecycle |

Novel writing does **not** require the world engine. Long and short fiction may optionally be derived into a world by their author. Screenplays and comics are independent adaptations. A published adventure can be played without creating a world first.

## Quick start

Open the [web app](https://yuanbw.vercel.app/storyforge/) or run the source locally. Core local creation does not require a StoryForge account. AI generation uses your own provider credentials; cloud API charges are separate.

Use **Node.js 24** and npm, matching CI:

```bash
git clone https://github.com/yuanbw2025/storyforge.git
cd storyforge
npm ci
npm run dev
```

Open the address printed by Vite, with the `/storyforge/` path. Keep the terminal running while using the app. A downloaded source ZIP needs the same commands after extraction; it is not a desktop installer.

On the home page, open the top-right model/settings button (`模型与本地设置`). Choose a provider, enter your API Key, Base URL and an accessible model, then test the connection. Test a small generation before a large task. A successful connection does not establish task quality, account balance or context capacity. For browser CORS errors, follow the settings panel's local proxy instructions.

## Your first writing session

1. Click **New** (`新建`) → **Long novel** (`长篇小说`), enter a title and description. A local folder can be configured later.
2. Use project information, references and writing rules to record your intent. Fill only the settings needed for your story.
3. Plan the conflict and characters, then create volumes and chapters in the outline. Write manually or edit and approve AI candidates.
4. Open chapters, develop scene outlines and draft the text. Review before adopting results.
5. Check changes to facts, character states, relationships and foreshadowing before continuing.
6. Open **Data management** (`数据管理`) to export Markdown/TXT and a full JSON backup.

![Long-form outline workspace with a manually written demonstration outline](./docs/assets/readme/longform-outline.png)

The long-form workspace includes references, world settings, character profiles and relationships, storylines, outlines, chapter editing, foreshadowing, facts, inventories, style learning, prompt templates, usage records and version history. Node mode lets advanced authors connect intermediate artifacts and official generation actions using the same underlying data; complete cross-mode interoperability remains under validation.

Engineering tests cover 100,000 / 300,000 / 1,000,000-character workloads. These demonstrate storage and retrieval support, not a guarantee of literary quality or consistent million-word manuscripts. Model performance and author review still matter.

## Short fiction, screenplays and comics

**Short fiction** targets approximately 5,000–25,000 Chinese characters, with a brief, story design, chapter cards, per-chapter drafting, review, focused rewriting and a frozen release. Export Markdown, TXT or JSON.

**Screenplay adaptation** starts from an existing local novel, freezes the source and tracks facts, causality and adaptation decisions. Build beats, scene cards and scenes, review source fidelity and dramatic structure, then export Fountain, FDX or a printable version.

**Comic adaptation** organizes script, pages, panels, reading order, visual references, images and lettering. Storyboard and visual editions have separate completion checks. Export options include PNG, WebP, CBZ and PDF. A text API alone cannot produce the visual edition; reference images and editing capabilities are checked against the actual image provider.

All three have their current engineering workflows implemented on `main`. Provider performance and content quality continue to be evaluated. See the [capability baseline](./docs/roadmap/CAPABILITY-BASELINE.md) for evidence and limits.

## Try an original story

### Fog Harbor: The Last Light — community TTRPG preview

Investigate an old shipwreck with two AI companions, protect your character's secrets and decide how tonight's ships will return. An AI KP hosts the adventure using original 2d6 rules, with seven scenes, six clues and three endings.

![Fog Harbor adventure entry](./docs/assets/readme/ttrpg-preview.png)

Run current `main`, open **TTRPG** (`跑团`) and choose the adventure below the production section. The standalone route `/storyforge/play` also works. The game bundle, cover and included media ship with the repository. Configure your model API, choose a character and start.

Play solo with AI companions or use same-device handoff. Progress is local, with resume and checkpoints. Public online multiplayer is not deployed, and same-device secrets are not protected from the device owner. Read the [player guide](./examples/ttrpg/README.md) and [production/playthrough evidence](./examples/ttrpg/fog-harbor/production-status.md).

## Worlds and interactive products

Create a world directly or explicitly derive one from confirmed long/short fiction. Freeze a version, then configure and start production inside the selected product. Published experiences own their media, save data and private evolution. Later edits to a novel do not automatically synchronize with a derived world, and gameplay does not automatically rewrite the shared world.

Current previews include TTRPGs, character chat, an afterstory AI town, text adventures, AVG and a text open world. Long-term character quality, audiovisual delivery, multiplayer and complete product experiences remain subject to their own validation. Online community and commercial services are later-stage work, not current platform promises.

## Models, storage and privacy

- Bring your own cloud provider or use a compatible local model service such as Ollama or LM Studio. Provider presets are connection options, not certification that every model works equally well for every product.
- Cloud generation sends the task's selected context to your configured provider. Local-first does not mean every AI request is offline.
- Work and saves live in IndexedDB for the current browser profile and origin. Changing browser, hostname or port does not move your data.
- API Keys last for the current browser session by default. Explicitly choosing “remember on this device” stores them in localStorage.
- Export a **full JSON backup** before changing devices or clearing browser data. Markdown/TXT exports do not replace full backups; use the product/workspace export paths for media.
- Local folder access is user-authorized. See the [memory workspace guide](./docs/MEMORY-WORKSPACE-GUIDE.md).
- Optional GitHub Gist backup uploads full project JSON to your private Gist. It is not end-to-end encrypted storage.

## Community and contributing

- [Bilibili video guide](https://www.bilibili.com/video/BV1q37j6QExh/) and [Zhihu introduction](https://zhuanlan.zhihu.com/p/2038714210188780594): historical Chinese tutorials; menus may differ from current versions.
- QQ community: **1082374587**.
- [Developer's project site](https://yuanbw.vercel.app/) and [GitHub Issues](https://github.com/yuanbw2025/storyforge/issues).

For bugs, include the app version, browser/OS, steps, expected behavior and actual result. Remove secrets and private writing from screenshots and logs. Stars, tutorials, examples, translations and contributions are welcome.

StoryForge uses React, TypeScript, Vite, Zustand, TipTap and Dexie. Registered context sources, governed adoption and table lifecycle registries support the shared Agent/Harness infrastructure.

```bash
npm run ci
npm run ci:e2e
```

Read [AGENTS.md](./AGENTS.md), [CONTRIBUTING.md](./CONTRIBUTING.md) and the [collaboration workflow](./docs/COLLAB-WORKFLOW.md) before contributing. Product boundaries are defined in the [project charter](./docs/PROJECT-MASTER-CHARTER.md).

## Star history and support

[![StoryForge Star History](https://raw.githubusercontent.com/yuanbw2025/storyforge/readme-assets/storyforge-star-history.svg)](https://www.star-history.com/?repos=yuanbw2025%2Fstoryforge&type=date&legend=top-left)

Sponsorship is voluntary and does not change access to features or future updates. It supports model subscriptions and maintenance. See [sponsorship details](./README.md#自愿赞助).

Code is licensed under [MIT](./LICENSE). Original works, models, third-party media and outputs retain their respective terms. See the [TTRPG SRD license notice](./docs/ttrpg/licenses/SRD-5.2.1-CC-BY-4.0.md) where applicable.
