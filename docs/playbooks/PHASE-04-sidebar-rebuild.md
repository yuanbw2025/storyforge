# Phase 4：侧边栏与路由重建（含提示词库升级一级）— Playbook

> 由 Opus 4.7 撰写并自执行。写于 2026-05-06。

---

## § 1. 元信息

```yaml
phase: 04
title: 侧边栏 5 一级三级折叠树 + 路由重建 + 提示词库升一级
prerequisites: [PHASE-03 完成]
estimated_hours: 4-5
recommended_model: Opus 4.7（自执行）
status: in-progress
```

---

## § 2. 目标

把扁平 17 项的侧边栏改造为 v3 §2.1 的目标布局：

```
📚 著作信息
  ├─ 项目概况
  └─ 参考书目

🌍 设定库
  ├─ 世界观（折叠）
  │   ├─ 世界起源（占位）
  │   ├─ 自然环境（占位）
  │   └─ 人文环境（占位）
  ├─ 故事设计 → StoryCorePanel
  └─ 角色设计（折叠）
      ├─ 主要角色 → CharacterPanel(filter=main)
      ├─ 次要角色 → CharacterPanel(filter=minor)
      ├─ NPC → CharacterPanel(filter=npc)
      ├─ 路人 → CharacterPanel(filter=extra)
      └─ 关系网 → CharacterRelationPanel

✏️ 创作区
  ├─ 创作规则 → CreativeRulesPanel
  ├─ 大纲 → OutlinePanel
  ├─ 细纲（占位）
  ├─ 章节（占位）
  ├─ 正文 → ChapterEditor
  └─ 伏笔 → ForeshadowPanel

🎯 提示词库  → PromptManagerPanel（直接，无 Tab 包装）

⚙️ 设置区
  ├─ 版本历史（占位）
  ├─ 导入（占位）
  ├─ 导出 → DataManagementPanel
  ├─ 设置 → AIConfigPanel
  └─ 数据管理 → DataManagementPanel
```

**做完后**：
- 侧边栏支持 三级（一级 section / 二级 group / 三级 leaf）折叠
- 提示词库从「设置 Tab」升到「一级菜单」
- 7 个新占位面板出现，等 Phase 5+ 填实
- 所有现有面板继续工作（路由通过 SidebarModule 兼容）
- 旧标签 `geography / history / power-system / items / factions` 暂留但**不在新 sidebar 中暴露**（P5+ 改造或删除时一并处理）

---

## § 3. 改动清单

### 新增（2 文件）

- `src/components/shared/PlaceholderPanel.tsx` — 通用占位组件
- `src/components/layout/sidebar-tree.ts` — 新侧边栏数据结构（独立出来便于维护）

### 修改

- `src/components/layout/Sidebar.tsx` — 重写：5 section + 三级折叠 + 数据驱动渲染
- `src/components/settings/SettingsPage.tsx` — 移除「提示词管理」Tab，只剩 AIConfigPanel
- `src/pages/WorkspacePage.tsx` — 路由分发增加新 module ID + 复用 PlaceholderPanel
- `src/components/settings/AIConfigPanel.tsx`（不动，作为 settings 叶子直接渲染）

### 删除

- 无

### 新增的 SidebarModule 字面量（共 7 个新叶子）

```
worldview-origin     // 世界观.世界起源（占位）
worldview-natural    // 世界观.自然环境（占位）
worldview-humanity   // 世界观.人文环境（占位）
detailed-outline     // 创作区.细纲（占位）
chapters-list        // 创作区.章节列表（占位）
prompts              // 提示词库（一级，直接渲染 PromptManagerPanel）
version-history      // 设置区.版本历史（占位）
import-doc           // 设置区.导入（占位）
```

CharacterPanel 暂不拆 4 个 module ID — 4 个角色三级标签都映射到 `'characters'`，CharacterPanel 内部已有 filter；P7 角色重做时再细分。

---

## § 4. 任务步骤

### 4.1 新建 PlaceholderPanel
通用空状态，支持 props: title, phase（"将在 Phase X 实施"）, description。

### 4.2 新建 sidebar-tree.ts
导出 SidebarModule 类型 + NAV_TREE 数据 + 工具函数 getDefaultExpanded()。

### 4.3 重写 Sidebar.tsx
数据驱动 + 递归渲染。三层缩进：section / group / leaf。

### 4.4 SettingsPage 清理
直接 `return <div className="p-6"><AIConfigPanel /></div>`，不要 Tab。

### 4.5 WorkspacePage 路由
新增 8 个 case，全部映射到 PlaceholderPanel（除 `'prompts'` → PromptManagerPanel）。

### 4.6 build + 浏览器自验

---

## § 5. 数据模型变更

无。本 Phase 仅改 UI 路由结构。

---

## § 6. DoD

- [ ] `npm run build` 0 error
- [ ] 浏览器侧边栏显示 5 个一级分区，提示词库出现在第 4 项
- [ ] 设定库.世界观 可折叠展开 → 3 个三级子项
- [ ] 设定库.角色设计 可折叠展开 → 5 个三级子项
- [ ] 点提示词库 一级 → 直接渲染 PromptManagerPanel（不再经过设置 Tab）
- [ ] 点设置区.设置 → 仅显示 AIConfigPanel（无 Tab）
- [ ] 点占位项 → 显示"将在 Phase X 实施"提示
- [ ] 点旧入口（如大纲）→ OutlinePanel 正常工作
- [ ] Phase 1+2+3 功能全部继续可用

---

## § 7. AI 全功能巡检

跳过（不动 AI 链）。

---

## § 8. 故障排查

| 症状 | 原因 | 应对 |
|---|---|---|
| 旧路由 `/storyforge/workspace/:id` 跳转后默认 module 没了 | WorkspacePage 默认 active module 改了名 | 检查 useState 默认值 |
| 提示词库 一级 点不开 | module ID 'prompts' 没在 case 中 | 加 case |
| 三级展开后 indent 没缩进 | renderTree 缩进逻辑漏 | 加 depth prop |

---

## § 9. 提交规范

```bash
git commit -m "feat(phase-04): 侧边栏 5 一级三级树 + 提示词库升一级 + 7 个新占位"
```
