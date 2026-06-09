# Phase 9：版本历史 UI — Playbook

> Opus 4.7 自执行。2026-05-06。

```yaml
phase: 09
title: 版本历史可视化（基于既有 snapshots 表 + backup store）
prerequisites: [PHASE-08 完成]
estimated_hours: 1（消费已有 store，纯 UI）
status: in-progress
deviation_from_v3: 暂不做"概念地图 Voronoi 程序化生成 + AI 视觉解析"，留给 P11 抛光后补
```

## 目标

把 Phase 4 留下的「版本历史」占位面板替换成可工作的快照管理界面。
功能复用既有 `useBackupStore`（5 分钟自动 + 手动快照）+ snapshots 表（v3 数据模型 v4 起就有）。

**不在本 Phase 范围**：
- 概念地图 Voronoi/Simplex 程序化生成（v3 §6 P9 §概念地图升级）
  → 工作量大，且 GeographyPanel 已有 AI 概念地图（Phase 1 系统模板），先用着
- AI 视觉反向解析（vision API 跨厂商兼容性大坑）
  → 留给后续专项 Phase（P11 之后单独立项）

## 改动

新增：
- `components/system/VersionHistoryPanel.tsx`
- `docs/playbooks/PHASE-09-version-history.md`

修改：
- `pages/WorkspacePage.tsx`: `version-history` case 由 Placeholder 改为真实面板

## 设计

- 顶部：「+ 创建快照」按钮 + label 输入（留空用时间戳）
- 时间线：snapshots 倒序，每行一张快照
  - 左：圆形图标（自动 vs 手动）
  - 中：label + 类型徽章 + 时间 + 大小
  - 右：恢复 / 删除
- 「恢复」走 backupStore.restoreSnapshot → 创建新项目 → 跳转过去（不会覆盖当前）
- 自动快照最多 20 条（store 里 prune 逻辑已有）

## DoD

- [x] build 0 error
- [x] 侧边栏点「版本历史」→ 显示当前项目所有快照
- [x] 「创建快照」按钮 → 立即新增一条手动快照
- [x] 「恢复」按钮 → 创建新项目并跳转
- [x] 「删除」按钮 → 从列表移除

## 提交

```bash
git commit -m "feat(phase-09): 版本历史 UI — 时间线 + 创建/恢复/删除"
```
