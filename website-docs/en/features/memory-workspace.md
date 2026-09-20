# Local memory workspace

The local memory workspace projects confirmed browser IndexedDB content into readable files on your disk. It is both an inspectable representation and a way for authors to edit supported content from the project or disk within safety boundaries.

## Project location

- Choose a storage location when creating a project, or bind, change, or reauthorize it later under Settings → Project storage workspace (设置 → 项目存储工作区).
- Selecting a folder does not immediately write files. The author initiates checks and confirms synchronization.
- Without a bound folder, the project still works in the browser database.

Typical layout:

```text
My novel/
├─ storyforge.workspace.json
├─ worlds/
├─ works/
│  └─ <WORK-CODE>/
│     ├─ chapters/
│     └─ memory/
│        ├─ story-core.yaml
│        └─ creative-rules.yaml
└─ .storyforge/
   ├─ manifest.json
   ├─ recovery/
   ├─ runs/
   ├─ history/
   └─ trash/
```

## Routine synchronization

1. Bind or reauthorize the project folder.
2. Click Check memory and local files (检查记忆与本地文件). This performs local reads, parsing, hashes, scope, and dependency checks; it does not call models.
3. Inspect project changes, local changes, conflicts, missing/extra files, and damage.
4. Confirm project changes to write them to disk. Local changes first become candidates and impact plans, then require author adoption.
5. Explicitly choose which side wins conflicts. Preserve recovery evidence before overwriting or deleting.

## Editable and read-only scope

Workspace, World, Work, chapter Markdown, and each Work's `story-core.yaml` and `creative-rules.yaml` are directly editable. Harness runs, candidates, author decisions, adoption, and verification evidence enter the recovery capsule; high-risk ledgers and receipts remain read-only.

## Recovery

- Browser data still exists: reauthorize the original folder, check differences, then synchronize.
- Browser database lost: validate identity, manifest, recovery capsule, and file hashes before reconstructing official content and references.
- File System Access API unsupported: use workspace-package export/import.
- Keep a full JSON backup before major migration or deletion.

## Privacy and cost

File scans, difference checks, structural validation, impact plans, hashing, synchronization, and recovery run locally without model calls, so they consume no AI tokens. Only separately authorized AI generation, style learning, or semantic review calls your configured provider.

This currently does not include cloud synchronization, collaboration, automatic Git commits, or StoryForge server hosting.
