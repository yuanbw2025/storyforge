---
productId: upper.character-interaction
status: preview
lastVerified: 2026-09-20
---
# Character chat

> Preview: primarily text interaction. Long conversations, characterization, and behavior across more models remain under validation.

Entry: Character chat → Library (角色聊天 → 作品库). Let defined characters interact within a background and scene while preserving independent relationships and memories.

## Produce and start a conversation

1. In Production (制作台), define interaction goals, characters/scenes, memory, and boundaries.
2. Select required world versions; organize candidates in Planning conversation (方案会谈) and confirm the production plan.
3. Enter Production flow (制作流程), checking character snapshots, scenes, and rules.
4. Run Checks and playtest (检查与试玩); resolve blockers before Publishing and versions (发布与版本).
5. Start a session under Play → Start conversation (游玩 → 开始对话).
6. Inspect progress/history under Relationships and memory (关系与记忆) and Sessions and branches (会话与分支).

## How characters remember

Sessions can record promises, secrets, conflicts, and relationship changes. Characters can use only information they are allowed to know. Sessions and branches own independent state; they do not automatically rewrite original world character profiles.

These records support ongoing dialogue, but do not guarantee consistent characterization on every call. If behavior drifts, inspect snapshots, scene constraints, and relevant memories before deciding to branch or reproduce the work.

## Important boundaries

A newer world version does not automatically replace existing session sources. Production drafts, releases, and play saves are managed separately. Confirm the object you are operating on when switching works.

## New flows in the development branch (unreleased)

The following instructions describe candidate interfaces in the character-chat development branch. **Full validation is unfinished, and these additions are not in an official download.** If your software does not show these entries, use the existing flow above. See [pending development records](/en/updates/development-status#character-chat-candidate) for delivery status.

### Prepare a work from an original starter or character card

In the library, explicitly enable “View original starter drafts (experimental)” (查看原创体验起稿（实验性）) to preview original seeds for individual action, relationship development, or a group investigation. Confirmation creates a new work without replacing an existing one. These are still production drafts: select a frozen world, review character information and knowledge boundaries, explicitly start production, then review and publish. They are not ready-to-play experience packages.

In private-character settings, convert a local Character Card V2 JSON or PNG into a character draft. Check the name, background, personality, and speaking style, enter the character’s identity in this experience, and confirm; then save the plan. System prompts, history instructions, world books, extensions, macros, and opening messages are not automatically executed. A PNG image does not also become a portrait. Keep the original card and license information; attribution does not grant redistribution rights.

### Supply authorship and usage statements

In an experimental v3 production plan, explicitly enable “Include authorship and usage statements in the experience package” (随体验包提供作品署名与使用说明). Enter the author credit, optional material attribution and acknowledgements, and the applicable license or usage restrictions, then save the plan. These statements are public in newly published versions and are excluded from character story knowledge. Editing a production draft does not rewrite an existing release. Omitted statements are shown as not supplied; omission does not grant usage or redistribution rights, or indicate that the platform has verified identity or ownership.

### Install and export experience packages

Under “Install, compare, and export experience packages” (安装、比较与导出体验包), select a complete package JSON, review characters, openings, action triggers, pictures, and license information, then confirm installation. Installation makes no AI calls. Chatting still uses your configured model service; credentials and device voices are not included in the package.

Release version numbers do not change with installation order. If different content uses the same release version number, install it in another work; the existing version and saves will not be overwritten.

Different versions of the same work coexist. An identical, intact version can be reused; a damaged local copy explicitly blocks replacement. Exporting a complete experience package includes published content and pictures, **not chat saves or production drafts**. Use a [complete backup](/en/guides/backup-restore) for those. If the system save is cancelled or fails, follow the message and retry.

### Continue a save in a compatible new version

Select a formal save, open “Check a new version for this save” (为当前存档检查新版本), choose an installed version, and check compatibility. Only a compatible direct successor permits “Confirm creation of an upgraded copy” (确认创建升级副本). Descriptions or pictures may change; changes to character knowledge, story, permissions, or world sources require a new story in the new version.

If authorship or usage statements change, both the original and target statements are shown before confirmation. An upgrade retains the original save and continues dialogue in a separate copy. “Return to the original save” (返回原存档) returns to its original progress without merging new conversations from the two saves. Unsent drafts stay in the original save; return there to rewrite inherited messages. Resolve unfinished generation or pending situations before checking an upgrade.

Continue: [Works and worlds](/en/concepts/work-world) · [AI candidates](/en/guides/ai-workflow).
