# Saving, backup, and recovery

## November 13: saving, recovery and usage checks

Current main uses database **v14** and complete project backup **v18**; fixed v4.0.5's v13/v17 details remain in [compatibility](/en/updates/compatibility). Imports strictly validate legacy v14–v17 formats and current v18; do not edit version numbers manually. Damaged trees, missing required references or source conflicts reject the whole import while preserving the original file. After recovery, check outline order, parent relationships, original tasks and images. Moved old outline nodes and forward parent-task references restore through the complete mapping.

External-folder snapshots distinguish stable workspace identities, preventing same-name workspaces from overwriting one another. Snapshot failures retain drafts and show retry information; permission/device errors are distinct from deliberate cancellation. If export reports uncertain local references, review the explanation rather than deleting history to obtain a file. Private/reference material remains within its own scope rather than entering other works. Sources: [#307](https://github.com/yuanbw2025/storyforge/pull/307), [#328](https://github.com/yuanbw2025/storyforge/pull/328), [#395](https://github.com/yuanbw2025/storyforge/pull/395), [#439](https://github.com/yuanbw2025/storyforge/pull/439)。


Works are primarily stored in the current browser's local database for the current site. Autosave helps daily editing but cannot replace an independent backup.



## Deletion blocked by historical references

If local outline or prose deletion reports a historical run reference, retain the original content and run history, then export and inspect a backup. The local deletion is rejected atomically to prevent dangling targets in future complete backups. Unreferenced content and whole-work/project deletion follow their respective confirmation flows. Preserve an already damaged backup for separate investigation. The repair merged with [PR #301](https://github.com/yuanbw2025/storyforge/pull/301).

## Confirming deletion, import and export

Cancelling the backup also stops the associated project-deletion flow. Check the work and source before deletion. Preserve content and errors after a failed save or conflict, then inspect the original records. Import tasks stay bound to their original source, and late results cannot recreate that source after task deletion. Prose export retains root-level chapters in the work's canonical chapter order. Check the beginning, chapter order and end of the exported document. See [PR #255](https://github.com/yuanbw2025/storyforge/pull/255).

## Four different file types

| File | Purpose | Important distinction |
| --- | --- | --- |
| Markdown/TXT prose export | Reading, submission, external editing | Does not contain complete project relationships and run records |
| Product release JSON, such as a short-fiction release | Frozen delivery manifest for one product | Not a full project backup; do not use the project JSON import entry |
| Complete project JSON backup | Restore project data, registered records, and references | Use project JSON import in data management; the supported backup format must match |
| Local memory workspace / `.storyforge.json` package | Readable documents, recovery capsule, and validation information | Use workspace recovery or workspace-package import; not an ordinary prose ZIP |

The `.json` extension alone does not identify purpose. Short-fiction release JSON is a frozen work-version manifest. Data management exports full project backups. A workspace package is also JSON but has its own format and recovery entry.

## First backup

![Current data management: export/import and version history](/assets/current/data-current.png)

1. Open Home → Data and backups (首页 → 数据与备份) and select a workspace. Product-level Versions and export or General settings also provide backup entries.
2. Export complete project JSON and confirm the downloaded file exists.
3. Keep another copy elsewhere; include the work and date in the name.
4. Save important prose separately in a reading format.

## Are images, attachments, and runs included?

Complete project JSON exports registered data within the backup scope and makes registered shared media objects portable: it reads actual files, validates size and SHA-256, then embeds base64 content with its MIME type. Registered, ready media such as images are therefore not merely exported as local paths. Large media can make the JSON substantially larger.

This does not automatically bundle arbitrary external URLs, unrelated disk files, or unfinished downloads. Unready media, missing bytes, or failed integrity checks can block a complete backup. Repair the files and export again; do not mistake a failed download for a valid backup.

Recovery capsules can preserve runs, candidates, author decisions, and adoption evidence. These may include private manuscripts and context; full backups are not suitable public sharing packages by default.

## Workspace packages versus disk folders

Export workspace package (导出工作区包) in data management generates readable documents and a full recovery capsule from the **current browser project**, downloading `.storyforge.json`. It does not automatically merge unadopted disk edits. If the newest edits are on disk, check differences and confirm adoption before exporting.

Disk access depends on browser folder authorization. Readable Markdown alone is not complete recovery material. When moving devices, keep the entire folder including `.storyforge/`, or use a workspace package—not just chapter files. Recovery validates identity, manifests, the capsule, and hashes. Do not delete or alter validation files to bypass errors.

## What to check after recovery

Keep the original backup and folder; do not delete the old environment before verifying recovery. Check:

- Current project, works, chapter counts, opening/ending prose, and recent edits.
- Characters, settings, world references, and active plans or versions.
- Whether key images and other assets actually open, not merely appear in a list.
- Candidates, run records, and releases you still need.
- Whether workspace binding and authorization need reestablishing; inspect differences before choosing sync direction.

Workspace import rebinds identities of local objects. Some historical run receipts may consequently become “Needs review.” This explicitly signals changed references; it does not mean historical evidence was deleted. Do not treat an old success status as current-project verification.

Current main uses complete project backup format **18** and database **v14**. Import strictly validates v14, v15, both historical v16 shapes, v17, and current v18 before registered conversion. Conversion only adds missing new-table empty collections; it does not invent memories or author confirmation. Arbitrary old JSON is not supported. Preserve rejected originals and error details; see [compatibility](/en/updates/compatibility). Do not alter versions, add empty tables, or remove fields manually to force import.

## Changing browser, device, or address

The web app, localhost, another port, or another browser may use different storage. Export in the original environment, then restore through the supported target entry. Check works, chapters, and key media before retiring the old environment.

Private browsing, clearing site data, or losing a browser profile may make local works inaccessible.

## Disk workspaces

Bind a folder under Settings → Project storage workspace (设置 → 项目存储工作区), then inspect differences in data management. Binding does not automatically write to disk; completing a model task does not automatically synchronize it either.

See [Local memory workspace](/en/features/memory-workspace).

## Data suddenly missing

First check the address, port, browser, and browser profile against the original environment. Do not immediately clear site data or overwrite the original folder.

Restore JSON or workspace packages through their supported entries. If an old backup is rejected, preserve it, read [compatibility guidance](/en/updates/compatibility), and submit feedback.

## Large project backups

The October 4 mainline update improves large JSON file reading and writing, reducing failures caused by constructing one complete string in memory. Image-heavy backups still need sufficient storage and processing time. Confirm the downloaded file exists and verify recovery in an isolated environment before retiring the original environment. Large-file support does not guarantee every device can restore a backup of any size.

Evidence: [Large backups and pause recovery](https://github.com/yuanbw2025/storyforge/commit/3ad7d59d).

### Text-adventure production evidence and large backups

The October 14, 2026 main-branch review confirms that [PR #119](https://github.com/yuanbw2025/storyforge/pull/119) improves production-evidence rebinding after backup import, authorized image recovery, and indexed run-ledger export. Open the restored text-adventure production and check frozen sources, Builds, illustrations, and recovery notices. Evidence requiring review is not publication permission; keep the old environment if media is missing or verification fails.

These main-branch changes came after the fixed v4.0.0 archives and do not automatically enter existing downloads. See [Text adventure](/en/features/interactive/text-adventure) for image-preserving revisions and standalone web packages; complete-project backups still use the dedicated recovery entry described here.
