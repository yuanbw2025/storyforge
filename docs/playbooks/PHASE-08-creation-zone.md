# Phase 8：创作区六模块全开 — Playbook

> Opus 4.7 自执行。2026-05-06。

```yaml
phase: 08
title: 故事设计扩 7 字段 / 创作规则 + AI / 章节列表 / 细纲（含场景 AI）
prerequisites: [PHASE-07 完成]
estimated_hours: 4-5
status: in-progress
```

## 目标

把 v3 §2.1「设定库 → 故事设计」+ 「创作区」全部模块拉齐：
- 故事设计：从 4 字段扩 7 字段（v3 §2.1 全套）+ 每个字段 AI 生成
- 创作规则：3 个 textarea 字段加 AI 建议（写作风格 / 基调氛围 / 特殊要求）
- 章节列表：独立面板，按卷分组、状态徽章、字数统计
- 细纲：场景拆分 + AI 一键拆场景

## 改动

新增（7 文件）：
- `lib/ai/adapters/story-adapter.ts` — buildStoryGeneratePrompt
- `lib/ai/adapters/rules-adapter.ts` — buildRulesGeneratePrompt
- `lib/ai/adapters/detail-scene-adapter.ts` — buildDetailSceneGeneratePrompt
- `components/shared/AIFieldCard.tsx` — 通用「字段 + AI 按钮」卡片（buildMessages 由调用方传）
- `components/editor/ChaptersListPanel.tsx` — 章节列表
- `components/outline/DetailedOutlinePanel.tsx` — 细纲（场景列表 + AI）
- `stores/detailed-outline.ts` — Zustand store（getOrCreate / save）

修改：
- `lib/ai/prompt-seeds.ts` — 新增 3 条系统模板（story.generate / rules.generate / detail.scene）
- `components/worldview/StoryCorePanel.tsx` — 重写为 7 字段 AIFieldCard
- `components/rules/CreativeRulesPanel.tsx` — 3 个字段加 AI 建议按钮
- `pages/WorkspacePage.tsx` — 接入 ChaptersListPanel 和 DetailedOutlinePanel

## DoD

- [x] build 0 error
- [x] 故事设计显示 7 字段，每个有 AI 生成
- [x] 创作规则的 3 个 textarea 字段都有 AI 建议按钮
- [x] 章节列表按卷分组 + 状态徽章 + 字数
- [x] 细纲：左侧选章节，右侧加场景 + AI 一键拆场景

## 后续

- 细纲的 AI 输出目前粘贴到第一个场景的"备注"字段里供用户参考；P10 可以加结构化解析自动建场景对象
- 大纲（OutlinePanel）和正文（ChapterEditor）已自带 AI（Phase 1 适配器），不动
- 伏笔（ForeshadowPanel）已自带 AI，不动
