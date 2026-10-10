---
title: Plugin troubleshooting and recovery
lastVerified: 2026-10-09
---
# Plugin troubleshooting and recovery

Preserve the work, original packages and error messages first. Do not clear site data or IndexedDB, and do not try unknown migrations on real work. See [complete backups](/en/guides/backup-restore).

| Symptom | Check first | Next step |
| --- | --- | --- |
| No Workshop entry | Version includes preview; correct application path | Open that application's `/workshop` and enable preview; see [status](./) for older versions |
| Installed but no feature | Installation and enabling differ; correct work/world | Trust and enable in **已安装**, then open the workbench or relevant history panel |
| Content package has no button | It has no executable UI | Inspect saved plugin content; a dedicated UI requires a feature plugin |
| Missing or mismatched dependency | Exact versions are required | Install declared dependencies; do not alter the manifest to fake compatibility |
| Target already replaced | Another replacement exists in this scope | Disable the old replacement first |
| Catalog download fails | Raw JSON/package, HTTPS, CORS, redirects, digest | Ask the author to fix distribution, or install a trusted original file; do not disable browser security |
| Same-version conflict | Same ID/version with different bytes | Author must release a new version, not overwrite the old one |
| Save conflict | Another tab or operation changed the record | Copy unsaved text, reload the latest record and merge manually |
| Data absent in another browser | Changed origin, port or profile | Export from the original environment, import into the new one; no automatic cross-origin sync |
| AI will not generate or confirm | Model setup, explicit start, stale candidate | Inspect AI task history; verify stale/unknown results before retrying |
| MCP unavailable | Running service, endpoint/protocol/tool, auth, browser network policy | Check the bridge or service instructions; prompts cannot enable unsupported Apps capabilities |

## A plugin breaks the page

Use Workshop **安全模式** (safe mode). If the page will not open normally, add `?safe-plugins=1` to the Workshop URL, or `&safe-plugins=1` if it already has query parameters. Example: `http://localhost:5173/storyforge/workshop/installed?safe-plugins=1`; substitute your actual address.

Safe startup skips plugins before module evaluation. Disable the faulty plugin, exit safe mode and check trusted plugins individually. If a loop has already frozen the tab, close it and open the safe-start URL in a new tab. Safe startup cannot terminate an already blocked main thread.

## Upgrade failure or older content

1. Keep a full backup, old/new packages, plugin ID/version and error.
2. Failed migration validation or transactions should retain the previous generation. Do not delete data or change schema versions to bypass failures.
3. In **已安装 → 数据恢复与操作记录**, select an available previous generation; reinstall its exact package if missing.
4. Recovery copies old content into a new generation without deleting newer edits from before recovery. Inspect content before enabling.
5. With a disabled or missing package, inspect **插件工作台 → 保存的插件内容** (saved plugin content). Visible raw records do not imply the custom editor is still available.

Imported AI candidates and tool results are read-only history. They do not regain old write or task-query/cancellation permissions. Continuing in the new work requires an explicitly started new task.

## Submit useful feedback

Include the host version/commit, plugin ID/version/digest, browser/OS, work or world scope, failing step, expected and actual results, and whether an isolated work reproduces it. Attach redacted screenshots or a minimal example.

Do not attach real manuscripts, complete browser databases or API keys. Contact the plugin author for plugin code issues; use [feedback](/en/feedback/) for host interfaces, installation or recovery. Fixes still need new versions, not unidentified replacement files.
