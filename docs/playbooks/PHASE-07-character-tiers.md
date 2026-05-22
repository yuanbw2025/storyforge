# Phase 7：角色分档面板（次要 / NPC / 路人）— Playbook

> Opus 4.7 自执行。2026-05-06。

```yaml
phase: 07
title: 次要角色（小卡片网格）/ NPC（紧凑列表）/ 路人（表格视图）
prerequisites: [PHASE-06 完成]
estimated_hours: 1.5（轻量 CRUD，不带 AI 按钮）
status: in-progress
```

## 目标

把 Phase 4 留下的 3 个角色分档占位面板替换成可工作面板，
按 v3 §2.1 的"主角大卡片 / 次要小卡片 / NPC 紧凑列表 / 路人表格"分级展示策略实现。

**主要角色**：保留现有 CharacterPanel（已包含 AI 设计/卡片视图/表格视图等完整功能）。
**关系网**：保留现有 CharacterRelationPanel。

**本 Phase 不做 AI 一键生成**（角色 AI 在 Phase 1 的 `character.generate` 模板已经就绪，
P8 集中给所有创作类面板加 AI 按钮时再补）。

## 改动

新增（3 文件）：
- `components/character/CharacterMinorPanel.tsx` — 小卡片网格（3 列）
- `components/character/CharacterNPCPanel.tsx` — 紧凑列表（一行一个）
- `components/character/CharacterExtraPanel.tsx` — 表格（姓名 / 出场时间 / 章节 / 作用 / 结局）
- `docs/playbooks/PHASE-07-character-tiers.md`

修改：
- `pages/WorkspacePage.tsx` — 3 个 case 由 Placeholder 改为真实面板，import 一行

## 设计要点

- 共享 `useCharacterStore`，按 `c.role` 过滤
- 全部使用 inline edit（textarea / input），无独立 modal — 减心智负担
- 路人表格利用 Phase 3 加进 Character 的新字段：firstAppearance / location（章节）/ storyRole / ending
- NPC 用 location（地点）作为快速辨识列
- 添加按钮预填空字段，立刻进编辑态

## DoD

- [x] build 0 error
- [x] 3 个 tab 各显示对应空态/数据
- [x] 新增按钮立刻在列表里加一行可编辑
- [x] 删除按钮工作
- [x] 路人表格 5 列与 v3 §2.1 完全一致

## 后续

- P8 给主要角色面板的 AI 设计按钮已完整；分档面板的 AI 按钮（按 role 批量设计）按需在 P8 加
- v3 §4.2 提到的 `factions` 表合并入 `worldview.factionLayout`：等到删除旧 FactionPanel 时一并迁数据（独立小任务）
