---
title: Install and use plugins
lastVerified: 2026-10-09
---
# Install and use plugins

Scope: plugin 1.0 development preview. Confirm your application includes Workshop; see [current status](./). Start with an isolated test work and export a [complete backup](/en/guides/backup-restore) of important works first.

## Open Workshop and try the examples

1. Append `workshop` to your application's base path. For example, `http://localhost:5173/storyforge/` becomes `http://localhost:5173/storyforge/workshop`. Keep your actual host, port and application path.
2. Click **开启工坊开发预览** (enable Workshop preview). Workshop will then appear on the home page.
3. Under **发现插件** (discover plugins), choose **创建体验作品** or **创建体验世界** (create a sample work/world) and confirm. This creates separate test content and installs reference plugins without calling AI.
4. Try **创作便笺** (writing notes) in the work, or **世界历史工作台** (world history workbench) in the world. Save content, reload, then disable the plugin.

**Expected result**: notes belong to the selected work. The history workbench presents a timeline whose dates come from the calendar service. Official history events remain available in the original panel after disabling the replacement.

## Install a plugin

### Download from a catalog

1. Search **发现插件**; read the author, purpose, data owner and dependencies.
2. Click **下载并安装** (download and install). Exact dependencies present in the catalog download with it. Code is not enabled yet.
3. Open **已安装** (installed), select a workspace and **当前作品** or **当前世界** (current work/world) matching the plugin's owner.
4. Click **启用** (enable), read the trust notice and choose **信任并启用** (trust and enable).
5. Open **插件工作台** (plugin workbench), or the world history/story timeline panel it replaces.

### Install a shared file

Download the author's original `.sfplugin` and use **从文件安装** (install from file). Do not unpack it first. A source ZIP or developer kit is not an installable plugin. Obtain and install exact dependency versions before enabling a file-installed plugin.

### Read a community catalog

Enter the author's HTTPS JSON catalog address in the community catalog field and click **读取目录** (read catalog). Use the JSON file URL, not a project homepage, GitHub file viewer or download page. Reading a catalog neither installs nor trusts code.

## Update, disable and uninstall

- **Disable**: disables the plugin for the selected work/world, retaining records without automatically changing other works.
- **Upgrade**: back up first; disable consumers, then the provider. Install the new package and select **切换到此版本** (switch to this version). Re-enable in dependency order after migration succeeds. Never overwrite a published package with different bytes under the same version.
- **Uninstall**: removes the browser's package bytes, retaining creative data. If other works still enable it, disable it in those scopes first.
- **Recover**: inspect previous data generations in **数据恢复与操作记录** (data recovery and operations). Reinstall matching packages where needed. Recovery retains newer edits from before the recovery; see [recovery instructions](./troubleshooting).

## Saving and moving devices

Package bytes live in the current browser origin's database; each work/world owns its configuration and records. A different browser, port or site address does not automatically share that storage.

Complete work backups include plugin data and version contracts, **not executable packages**. Keep both the backup and original packages. Imported plugins are disabled until you reinstall matching versions and confirm trust. Old AI candidates and tool results remain read-only history; external tasks do not automatically resume.

## AI and external tools

Notes and timelines need no model setup. AI plugins require a configured model, explicit start in the host panel, and author review and confirmation. An unconfirmed candidate is not official content. Costs depend on the model service.

MCP tools show the destination, arguments and confirmation UI. Services may need separate startup or authentication. Do not put host tokens in manifests or backups. Network-query features send requests to their declared sites; read the author's explanation first. Avoid repeated blind retries after errors; follow [troubleshooting](./troubleshooting).
