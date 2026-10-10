# Plugins and Workshop 1.0 trial brief

> Reviewed: 2026-10-08 · Development commit `53c276f3` · API 1 / SDK 0.1 (developer preview).

::: warning Historical acceptance snapshot from 2026-10-08
This page preserves the 2026-10-08 review. See the [Workshop guides](/en/workshop/) for current instructions and the PR for latest delivery and check status.

At that review, [PR #113](https://github.com/yuanbw2025/storyforge/pull/113) remained an unmerged draft. A follow-up check at 16:14 (UTC+8) found that [remote CI](https://github.com/yuanbw2025/storyforge/actions/runs/37734889246) failed: 229 browser tests passed, 1 failed, and 2 were skipped. The complete text-open-world journey did not reach the expected combat result, including on retry. The cause still needs investigation; this result alone does not establish that plugins caused it. This page describes that branch and its local validation, not functionality already available in main, a tagged release, or the online application. “1.0” identifies the plugin and Workshop trial, not a new official StoryForge version.
:::

Plugins let community authors deliver interfaces, processing logic, owned data, AI tasks, and external tools as independent packages, enabled per work or world. Workshop provides discovery, search, file installation, trust confirmation, enabling, disabling, uninstalling, and version management. This reduces the need to absorb every community feature into the core project. This iteration uses local management and static HTTPS catalogs, without an online authoring server.

## Implemented trial scope

The framework handles feature integration, exact dependency composition, storage, upgrades, and recovery; Workshop handles discovery and management. Initial module replacements cover **world history** and **story progression**. The history workbench can call a separate calendar service, demonstrating cooperation between plugins. Other authoring products expose a general plugin workbench; this does not open every product's specialist algorithms to replacement.

The delivery contains **12 reference packages**, covering calendar services, notes, timelines, plot flows, content cards, bundles, AI ideas, world festivals, tabletop rules, and MCP tools. They illustrate interfaces and exercise extension types rather than restrict what the community may build. They are not stable third-party dependencies.

## How to try it

These steps apply only to a development build containing the stated commit. If the online application or an older release has no Workshop, check its version first. Publishing this documentation does not publish the plugin implementation.

1. Open `/workshop/discover` after your development application's base path; for an application hosted under `/storyforge/`, use `/storyforge/workshop/discover`. The entry is hidden by default. Select “开启工坊开发预览” (Enable Workshop developer preview) to show the home entry.
2. Select “创建体验作品” (Create trial work) or “创建体验世界” (Create trial world). Confirmation creates separate test content and enables reference plugins. This creation action does not call AI or consume model credits.
3. Try adding history, editing notes, and refreshing. In Installed, disable, re-enable, or uninstall and reinstall plugins to check the interface and data recovery. For ordinary installation, install a `.sfplugin` file or a catalog package, select a work/world, and explicitly confirm trust before enabling it. Installation alone does not execute plugin code.
4. For AI features, configure your model service, explicitly start a task, review its candidate, and confirm adoption. External tools require host confirmation; local programs additionally require the optional local bridge.

Packages are stored in the current browser's site data. Changing browser, port, or site address does not migrate them automatically. Ordinary plugin users need no extra Node or Python installation. The optional local stdio bridge requires Node.js 22+, allowed origins and commands, and a temporary pairing token.

## How developers deliver a plugin

Developers use the public SDK to declare interfaces, data schemas, dependencies, and required capabilities, validate them, and produce a `.sfplugin` package. Code and dependencies ship together; installation does not run npm or fetch runtime dependencies from a CDN. Development uses the repository's required Node environment and dependencies.

In this development-version repository, the basic sequence is:

```sh
node tools/plugin-sdk/cli.mjs create ../my-plugin
node tools/plugin-sdk/cli.mjs check ../my-plugin
node tools/plugin-sdk/cli.mjs pack ../my-plugin ../my-plugin.sfplugin
```

Communities may distribute files or maintain static HTTPS catalogs; additions to the official catalog go through PRs. Specialist module replacement still needs individually designed interfaces. Plugins must not depend directly on private host components, stores, databases, or internal AI modules. See the pinned development guide below for interface details and complete examples.

## Changes to the existing project

This extends shared infrastructure across installation, data, interfaces, and execution, beyond adding a download page. Existing ownership boundaries for works, worlds, media, and product releases remain. Plugins do not bypass world sealing, product orientation, or product execution.

| Area | Development-branch change and impact |
| --- | --- |
| Database and backups | Five plugin tables; database version 10 → 11 and backup version 14 → 15. The database migration only adds tables. Complete version 14 backups have an explicit conversion path; this does not imply compatibility with damaged or other older formats. |
| Plugin infrastructure | SDK, package loading, declaration validation, dependency management, version locking, migration, and recovery; owned data is isolated by work or world. |
| Product interfaces | Hidden-by-default Workshop, optional extension entries, initial history/progression replacements, and general authoring workbenches. |
| AI and data governance | Reuses the context, writable-field, and table-lifecycle registries. AI produces candidates for author confirmation before adoption, with existing Harness execution records. |
| World and product releases | Authors explicitly confirm plugin semantics into world entries; later edits do not synchronize automatically. Tabletop rules use the existing RulePack interface and freeze with product releases; older releases and sessions retain their versions. |
| External capabilities | MCP client with task querying and cancellation; optional local stdio bridge. No account, payment, or online authoring service. |

## Data retention and recovery

Disabling or uninstalling retains creative data. Work backups include configuration, data, contracts, and operation records, **but not executable packages**. Imported plugins default to disabled and run only after matching packages are reinstalled and confirmed. Historical AI candidates, author edits, and tool results remain read-only records; importing does not restore write authority over the original work or control of its external tasks.

Installation identity includes the exact version and SHA-256, with dependencies locked to versions. Different bytes cannot overwrite the same version. Migration writes a new data generation and switches only after validation; failure retains old data. Recovery also preserves newer edits instead of overwriting them with an older state. Missing plugins leave works and data intact, but plugin-specific interactions require the corresponding plugin to be restored.

Safe startup skips plugin loading before execution. Use Workshop's “安全模式” (Safe mode) or `?safe-plugins=1` in the application URL, then disable the faulty plugin. This cannot terminate a main-thread infinite loop that has already started.

## Current limits

- Native UI plugins execute in the host's origin as trusted code. Capability declarations are interface contracts, **not a security sandbox against malicious code**. Install only trusted sources.
- The SDK is a developer preview without a long-term compatibility promise across major versions. A general workbench does not mean every specialist module's internals are replaceable.
- This delivery excludes MCP Apps, sampling, roots, a standard Worker plugin protocol, automatic background updates, online accounts, payments, ratings, and an upload server.
- AI and HTTP regression tests use reproducible simulations, without calling the author's paid models. Passing tests does not establish real-model quality or external-service availability.
- Long-term memory endurance, performance across devices, and Windows/Linux delivery remain unverified.

## Validation and evidence limits

These are **local results for development commit `53c276f3`**, recorded in the delivery brief and corresponding logs. They are not plugin tests rerun by this documentation edit and do not replace final remote PR acceptance.

| Validation | Recorded result |
| --- | --- |
| Full local CI | 784 test files and 4,252 tests passed, along with architecture, registry, documentation, typing, build, and size checks. |
| Full browser regression | 230 passed and 2 skipped; CSP and offline PWA cases passed separately against a production build. |
| Final-commit production plugin acceptance | 14 passed and 1 skipped; the development-only product fixture was covered in the complete development suite. |
| Development and data flows | SDK creation, checking, packing, and prohibited-import rejection; regression coverage for composition, recovery, import isolation, and version migration. |
| External capabilities | Simulated AI/HTTP; an actual local stdio subprocess was verified on macOS. |

Performance is a sample from one development machine: alternating cold starts with 2 warm-up pairs and 12 measurement pairs. With no plugins, median home DOM readiness changed from 463.7 to 470.6 ms (+1.49%), and first contentful paint from 176 to 184 ms (+4.55%); the Workshop runtime was not loaded when plugins were disabled. A standard-plugin prose-input sample included 59 events, with response p95 around 16.3 ms and no observed main-thread long task over 50 ms. These results are not a performance promise for every device.

Next steps are to test installation, use, disabling, upgrades, and recovery with separate trial data, then improve Workshop and specialist interfaces from feedback, complete endurance and cross-platform validation, and define compatibility policy. Mainline integration and online availability remain subject to PR and deployment results.

## Pinned references

- [PR #113: code and current checks](https://github.com/yuanbw2025/storyforge/pull/113)
- [Delivery commit 53c276f3](https://github.com/yuanbw2025/storyforge/commit/53c276f350e66e58a9e83fc3a3f7b4826b5632d7)
- [Plugin development guide (Chinese)](https://github.com/yuanbw2025/storyforge/blob/53c276f350e66e58a9e83fc3a3f7b4826b5632d7/docs/guides/PLUGIN-DEVELOPMENT.md)
- [Plugin and Workshop phase-one roadmap (Chinese)](https://github.com/yuanbw2025/storyforge/blob/53c276f350e66e58a9e83fc3a3f7b4826b5632d7/docs/roadmap/PLUGIN-WORKSHOP-V1.md)

Continue: [Pending development](/en/updates/development-status) · [Changelog](/en/updates/changelog) · [Backup and recovery](/en/guides/backup-restore).
