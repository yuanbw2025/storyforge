---
name: storyforge-plugin-author
description: Develop, package, maintain and prepare distribution of independent StoryForge plugins using its public SDK. Use for StoryForge feature, content or bundle packages, not for editing a manuscript or installing skills into StoryForge's AI runtime.
---

# StoryForge plugin author

Deliver the requested feature as an independent `.sfplugin`, preserving the user's scope. Explain outcomes and limitations in the user's language. This kit targets the API/SDK recorded in `developer-kit.json`; it is a reference kit, not a standalone compiler or host.

## Locate the matching contract

Read `references/PLUGIN-DEVELOPMENT.md` and `references/index.d.ts` for the capabilities relevant to the request. Read `guides/develop.md` (Chinese) or `guides/en/develop.md` for environment and CLI setup. The six guides cover capability discovery, installation, AI-assisted development, packaging, publication and recovery. `developer-kit.json` lists source paths and hashes; compare against the user's host checkout when available. API 1 alone does not imply all preview builds are compatible.

For this skill's source checkout before packaging, use `docs/guides/PLUGIN-DEVELOPMENT.md`, `tools/plugin-sdk/index.d.ts`, `website-docs/workshop/` and `examples/plugins/` at the StoryForge repository root. Do not edit generated kit copies as a second contract.

The public SDK, manifest validator and host implementation decide what is supported. When instructions and types conflict, explain the mismatch and stop the affected part; do not invent signatures, silently switch host versions or patch private host code to claim plugin support.

## Map the request before coding

Identify the visible result, `work` or `world` owner, UI entry, data, AI/network needs and required public interfaces. Clarify material gaps; make routine UI choices without unnecessary questions. If only part is supported, explain a workable reduced scope and the missing interface.

Choose the nearest example under `examples/`: writing-notes for data/UI; world-timeline and calendar for replacement/service composition; idea-cards for author-confirmed AI; plot-flow for copied node flows; world-festivals for world adoption; harbor-rules for frozen RulePack; research-desk/tool-desk for network/MCP. For local programs, read `references/MCP-BRIDGE.md`; construction boundaries are in `references/PLUGIN-WORKSHOP-V1.md`. Content and bundles have no executable entry. Read only relevant examples.

Create a separate source folder using the matched repository CLI. Node.js 24 and repository dependencies are development prerequisites; the SDK is not a public npm release. Do not change unrelated host files, existing plugins or the author's browser data. Keep IDs and resource names in the author's namespace; never retain the official sample identity in a community release.

## Implementation invariants

- Only public SDK types and methods; no private host components, stores, database or AI imports. Bundle browser-compatible dependencies; share host React. No runtime CDN imports.
- Declare views, schema, permissions, services and exact dependency versions. One owner per package; consumers/providers share that owner. Replacements only target supported slots and do not take ownership of official records.
- Use plugin data APIs and revision checks; surface conflicts without overwriting. Use explicit core references where supported, not opaque payloads containing local database IDs. Clean up effects, timers and async work.
- AI goes through the declared task/host review contract. Authors start, inspect and confirm candidates. Do not call a model directly to bypass registered context or formal adoption. Never claim model quality from a mock response.
- Declare network destinations and tool names; keep secrets out of manifests, records, logs, source and packages. Ordinary plugin users need no development runtime; disclose optional external services, local bridge setup and fees.
- Native UI plugins are trusted same-origin code. Permission declarations are not a malicious-code sandbox; do not promise isolation.
- Preserve records on disabling/uninstall. Schema changes require a version increment and pure migration; keep prior data recoverable. Published ID/version bytes are immutable. Do not erase storage to pass an upgrade test.

## Verify and deliver

From the matched host repository root, run `node tools/plugin-sdk/cli.mjs check <plugin-folder>` and `node tools/plugin-sdk/cli.mjs pack <plugin-folder> <output.sfplugin>`. These check static structure and bundling, not full product behavior.

Install in an isolated browser profile and test the actual requested result, reload, cross-work isolation, disabling, uninstall/reinstall and backup round trip. Add dependency/replacement, migration failure/recovery, AI or network checks only where relevant. Use `references/ACCEPTANCE.md`. If browsers, models or services are unavailable, record those checks as unverified and provide reproducible steps. Never treat absence of tools as a pass.

Deliver the package with digest, maintainable source, README (purpose, scope, install, entry, usage, data, dependencies, costs, troubleshooting), tested host/SDK version, changelog and truthful acceptance record. Prepare catalog metadata using `guides/publish.md` or its English counterpart. Local development authorization does not imply permission to publish, open external submissions or message others. Obtain the user's explicit publishing direction before public actions; keep prepared files reviewable.
