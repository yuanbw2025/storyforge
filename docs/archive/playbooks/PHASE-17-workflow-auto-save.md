# Phase 17：工作流自动写入对应模块 — Playbook

> Opus 4.7 自执行。2026-05-08。

## 目标

解决 P16 工作流的"复制粘贴痛点"：每步完成后，
若该步声明了 `saveTarget`，可一键写入项目对应模块（worldview/storyCore/creativeRules）。

## 改动

修改：
- `lib/types/workflow.ts` — 加 SaveTarget 类型 + PromptWorkflowStep.saveTarget
- `lib/ai/workflow-seeds.ts` — 「极速起书」加 2 个 saveTarget；「伏笔体系搭建」加 1 个
- `pages/WorkspacePage.tsx` — `case 'prompts'` 传 project 给 PromptManagerPanel
- `components/settings/prompt/PromptManagerPanel.tsx` — 加 project prop，透传给 workflows tab
- `components/settings/prompt/PromptWorkflowsPanel.tsx`
  · Runner 接收 project prop
  · 装载 worldview/storyCore/creativeRules store
  · handleSaveTarget 根据 SaveTarget 类型写入对应字段
  · StepCard 已完成时显示「复制」+「保存到 XXX」按钮
  · 已保存的步骤显示绿色「✓ 已存到 XXX」

新增：
- `docs/playbooks/PHASE-17-workflow-auto-save.md`

## SaveTarget 类型

```ts
type SaveTarget =
  | { type: 'worldview-field'; field: string; mode?: 'replace' | 'append' }
  | { type: 'storyCore-field'; field: string; mode?: 'replace' | 'append' }
  | { type: 'creativeRules-field'; field: string; mode?: 'replace' | 'append' }
```

mode：
- replace（默认）：覆盖现有内容
- append：在现有内容末尾追加（用 \n\n 分隔）

## 演示种子

「极速起书 · 通用」5 步中：
- 「一句话故事」→ saveTarget: storyCore.logline
- 「世界起源」→ saveTarget: worldview.worldOrigin

「伏笔体系搭建」2 步中：
- 「世界观摘要」→ saveTarget: worldview.summary

## 字段中文名映射

UI 显示「保存到 世界观.世界起源」而不是「保存到 worldview.worldOrigin」：
```ts
fieldMap: { worldOrigin: '世界起源', historyLine: '世界历史线', ... }
```

## 不在本 Phase 范围

- 角色 / 大纲 / 章节这种"多对象写入"的 saveTarget — 需要 AI 输出 JSON，
  逻辑复杂留给后续
- 用户在 UI 编辑工作流的 saveTarget — 本 Phase 仅用于内置工作流声明
- 撤销已保存的写入

## DoD

- [x] build 0 error
- [x] DB 中 workflow seeds 带 saveTarget 字段
- [x] Runner 跑完一步后显示「复制」+（如有 saveTarget）「保存到 XXX」按钮
- [x] 点保存按钮 → 字段写入对应 worldview / storyCore / creativeRules 表
- [x] 已保存步骤按钮变绿「✓ 已存到 XXX」
- [x] 没传 project 时按钮 disabled，提示「需先进入项目」
