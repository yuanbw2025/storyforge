# Phase 6：世界观.人文环境 — Playbook

> Opus 4.7 自执行。2026-05-06。

```yaml
phase: 06
title: 人文环境（7 字段，每个带 AI 生成）
prerequisites: [PHASE-05 完成]
estimated_hours: 1（同模式复用 P5 组件）
status: in-progress
```

## 目标

把 worldview-humanity 占位面板落地为可工作的 7 字段编辑面板：
- 📜 世界历史线
- 📅 世界大事记
- 🧬 种族设定
- ⚔ 势力分布（替代旧 factions 表）
- 🏛 政治 / 经济 / 文化
- 🔥 矛盾冲突
- 🗡 道具设计（替代旧 itemSystems 表）

## 改动

新增：
- `components/worldview/WorldviewHumanityPanel.tsx` — 7 字段，复用 `WorldviewFieldEditor`
- `docs/playbooks/PHASE-06-worldview-humanity.md`

修改：
- `pages/WorkspacePage.tsx` — `worldview-humanity` case 由 Placeholder 改为真实面板
- import 一行

## 设计要点

- 完全复用 Phase 5 的 `WorldviewFieldEditor`（无新组件）
- AI context 比 P5 更强：先注入"世界起源 + 力量层次 + 大陆分布"等上游设定，让 AI 生成的人文设定与底层世界观一致
- 字段间互相进入 contextSummary（ skip 当前字段 ）

## DoD

- [ ] build 0 error
- [ ] 侧边栏点「人文环境」→ 7 字段卡片
- [ ] 每个字段右下角有「AI 生成」按钮
- [ ] AI 调用时上下文包含已填的世界起源 / 自然环境关键字段
- [ ] onBlur 自动保存

## 提交

```bash
git commit -m "feat(phase-06): 世界观.人文环境 — 7 字段 + AI 生成"
```
