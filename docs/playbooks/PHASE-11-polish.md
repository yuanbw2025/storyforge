# Phase 11：抛光 + 走查 + 收尾 — Playbook

> Opus 4.7 自执行。2026-05-07。

```yaml
phase: 11
title: 全侧边栏巡检 / 主题修复 / 重复菜单清理 / HANDOFF 更新
prerequisites: [PHASE-10 完成]
estimated_hours: 1
status: done
```

## 走查发现的 issue + 修复

### 1. 主题切换在工作区不生效（pre-existing bug）

**现象**：`AIConfigPanel` 切主题，`document.documentElement[data-theme]` 改了，但工作区背景色不动。

**原因**：`WorkspacePage.tsx` 第 193 行设了 `<div data-theme="work" ...>`，
覆盖了根元素的主题属性。但 CSS 里没有 `[data-theme="work"]` 的定义，
所以工作区一直 fallback 到 `:root` 的默认值（midnight）。

**修复**：删掉 `data-theme="work"`（dead code）。
**验证**：5 个主题（midnight/ocean/graphite/mist/parchment）切换后 sidebar 背景色全部不同。

### 2. 侧边栏「数据管理」与其他菜单功能重复

**现象**：
- 侧边栏新结构后，「版本历史」「导入」「导出」都是一级菜单
- 老的 DataManagementPanel 提供的 3 个 Tab（导出导入 / 版本历史 / AI 解析导入）
  被一级菜单全部覆盖
- 「数据管理」点进去看到的还是 3 Tab 老界面，**功能重复**

**修复**：从 sidebar-tree.ts 的 `system` 段去掉 `data-management` 叶子。
路由仍兼容（WorkspacePage 还在处理 `case 'data-management'`），只是 sidebar 不暴露。
**等后续抽出独立 ExportPanel 时再彻底删 DataManagementPanel。**

### 3. HANDOFF.md 严重过时

**修复**：完全重写 § 3 / § 4 / § 6 / § 7：
- § 3：Phase 1-11 commit 表
- § 4：12 个 Phase 全部标记 ✅，加「设计偏差备忘」
- § 6：当前架构总览（提示词系统 / 数据模型 / 侧边栏 / AI 覆盖）
- § 7：可继续的方向（短期收尾 / 中期 v3 §3.7-3.8 / 长期 v3 §6 P9）

## 改动清单

修改：
- `pages/WorkspacePage.tsx`: 删 `data-theme="work"` + 删 PlaceholderPanel import（已无占位）
- `components/layout/sidebar-tree.ts`: 删「数据管理」叶子 + 删 Database icon import
- `docs/HANDOFF.md`: 重大更新

新增：
- `docs/playbooks/PHASE-11-polish.md`

## DoD

- [x] build 0 error
- [x] 5 主题在工作区都能正常切换（sidebar 背景色不同）
- [x] 23 个侧边栏叶子全部能渲染对应面板（无 broken 页）
- [x] HANDOFF.md 反映 Phase 1-11 已完成 + 当前架构 + 后续方向

## 提交

```bash
git commit -m "feat(phase-11): 抛光 — 主题修复 + 重复菜单清理 + HANDOFF 大更新"
```
