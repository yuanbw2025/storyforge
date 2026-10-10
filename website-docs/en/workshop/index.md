---
title: Plugins and Workshop
lastVerified: 2026-10-09
---
# Plugins and Workshop

**Add the features you want to your own StoryForge.** A plugin can be a new historical timeline, a writing board, a collection of content cards, or a complete tool with UI, data and AI capabilities. Different works can enable different plugins.

::: warning Development preview
These guides cover plugin preview 1.0, API 1 and SDK 0.1. The feature is delivered by [PR #113](https://github.com/yuanbw2025/storyforge/pull/113); use an application version that includes it. Check merge and online deployment status separately. Reading this guide does not add Workshop to an older application. Preview availability is not a public launch or long-term compatibility promise.
:::

## Start here

| Your goal | Next step | Result |
| --- | --- | --- |
| Try an existing feature | [Install and use](./install) | A plugin running in a test work or world |
| Have an idea but cannot code | [Develop with your AI](./ai) | Instructions, a reference kit and a Skill for a coding assistant |
| Write the code yourself | [Build your first plugin](./develop) | An independently packaged feature with persistent data |
| Share your plugin | [Publish and maintain](./publish) | File distribution or a community catalog listing |
| Resolve errors or missing data | [Troubleshooting and recovery](./troubleshooting) | Steps to diagnose problems while retaining data |

## What can you build today?

These are examples, not a restriction on subject matter. Feasibility depends on the public interfaces your idea requires.

| Desired result | Supported approach | Example source folder |
| --- | --- | --- |
| Notes, character idea cards or task boards | Custom UI and plugin-owned records in the author workbench | `writing-notes`, `idea-cards` |
| Alternative historical and story timelines | Add or replace world history or work timeline panels, using official history data | `world-timeline`, `story-board` |
| Dates supplied by another calendar plugin | Explicit services and exact version dependencies | `calendar`, `world-timeline` |
| Setting cards or a collection of writing tools | Code-free content packages or bundles that lock dependencies | `prompt-cards`, `writer-bundle` |
| Custom AI ideas and structured output | Declared tasks, context and output schema; the author starts, edits and confirms | `idea-cards` |
| Editable plot-generation workflows | Copy a declared flow into the longform node workbench; the author runs it | `plot-flow` |
| Festival settings used in worlds and derived products | Explicit preview and adoption into world entries, then the existing world-sealing flow | `world-festivals` |
| Custom tabletop rules | Existing RulePack format, frozen into a product release | `harbor-rules` |
| Research and external tools | Declared network origins or host-confirmed MCP connections | `research-desk`, `tool-desk` |

Sources are in `examples/plugins/` and the [AI development kit](./ai). You can describe any of these outcomes to your AI without knowing how to code.

## Choose a package type

- **Feature**: executable code for interactive UI, data processing, AI or external-tool entry points.
- **Content**: structured records without an executable entry point. It does not automatically create a custom UI or write into official settings.
- **Bundle**: no executable entry point; locks a set of plugin versions. Dependencies must be downloadable and share the same data owner.

## Set realistic expectations

A plugin is not an arbitrary patch to StoryForge source. Dedicated replacement slots currently cover world history and story timelines. Other products offer a common author workbench; this does not expose every editor, button, generation algorithm or game runtime. Request new interfaces through [feature feedback](/en/feedback/feature).

Ordinary plugins need no Node or Python installation to run. Development requires a development environment; local-program connections may need a separately started bridge. AI and external services may charge fees. Installing a plugin does not automatically call a model.

Native UI plugins execute in the same origin as StoryForge. Trust their authors and source. Capability declarations explain intended use but are not a malicious-code sandbox. Disabling or uninstalling retains records; raw records remain readable without the package, while custom interactions require the matching plugin.
