# Phase 5：世界观.世界起源 + 自然环境 — Playbook

> 由 Opus 4.7 撰写并自执行。写于 2026-05-06。

---

## § 1. 元信息

```yaml
phase: 05
title: 世界观.世界起源（3 字段）+ 自然环境（7+4 字段）+ 每字段 AI 生成
prerequisites: [PHASE-04 完成]
estimated_hours: 3-4
recommended_model: Opus 4.7（自执行）
status: in-progress
```

---

## § 2. 目标

把 Phase 4 留下的两个占位面板（worldview-origin / worldview-natural）落实成可工作的设定面板：

**世界起源（3 大字段）**：
- 世界来源（worldOrigin）
- 力量层次（powerHierarchy）
- 神明设定（divineDesign 复合：是否存在 + 层级 + 名号 + 规则）

**自然环境（6 主字段 + 4 子资源）**：
- 世界结构 / 世界尺寸 / 大陆分布 / 区域面积 / 山川河流 / 分区域气候
- 自然资源（嵌套）：珍禽异兽 / 灵药 / 矿石 / 其他特产

**每个字段都带 AI 生成**：复用 Phase 1 的 `worldview.dimension` 模板，传入字段的中文标签作为 `dimension` 变量；其他字段拼一个简短上下文供 AI 参考一致性。

---

## § 3. 改动清单

### 新增（4 文件）

- `src/components/worldview/WorldviewFieldEditor.tsx` — 公用「字段卡片」组件（label + textarea + AI 生成 + 流式输出 + accept/retry）
- `src/components/worldview/WorldviewOriginPanel.tsx` — 3 字段（含嵌套 divineDesign）
- `src/components/worldview/WorldviewNaturalPanel.tsx` — 6 主字段 + 4 子字段
- `docs/playbooks/PHASE-05-worldview-origin-natural.md`

### 修改

- `src/pages/WorkspacePage.tsx` — `worldview-origin` / `worldview-natural` 两个 case 由 PlaceholderPanel 改为真实面板

---

## § 4. 任务步骤

### 4.1 公用组件 WorldviewFieldEditor
- props: label, description, value, onChange, onSave, project, contextSummary, rows
- 内部状态：hint, showHintBox（折叠的 AI 提示输入），ai (useAIStream)
- 调 `buildWorldviewPrompt(label去emoji, projectName, genre, contextSummary, hint)`
- AIStreamOutput 接受/重试/停止

### 4.2 WorldviewOriginPanel
- 加载 worldview store
- 3 个字段：worldOrigin / powerHierarchy / divineDesign(checkbox + 3 sub textareas)
- 各字段 onSave 调 `saveWorldview({ projectId, [field]: value })`
- AI context：拼接其他字段值（前 200 字截断）

### 4.3 WorldviewNaturalPanel
- 同上，6 主字段 + naturalResources(4 sub)

### 4.4 WorkspacePage 路由替换占位

### 4.5 build + 浏览器自验

---

## § 5. 数据模型变更

无。Phase 3 已经把字段加进 Worldview interface，store.saveWorldview 用 partial spread 直接写新字段。

---

## § 6. DoD

- [ ] `npm run build` 0 error
- [ ] 侧边栏点「世界起源」→ 显示 3 大字段卡片
- [ ] 输入文字 → blur 自动保存 → 刷新页面后保留
- [ ] 「神明设定」勾选「存在神明」→ 展开 3 个子字段
- [ ] 侧边栏点「自然环境」→ 显示 6 主字段 + 4 资源子字段
- [ ] 任意字段点「AI 生成」→ 流式输出 → 「采用」→ 内容写入 textarea + 持久化
- [ ] AI 生成的 dimension 标签是字段中文名（不是 'origin' 这类英文 key）

---

## § 7. AI 全功能巡检

跑 1 条端到端：进世界起源 → 「世界来源」点 AI 生成 → 流式输出 → 采用 → 刷新 DB 中 worldview.worldOrigin 字段被填入。

---

## § 8. 故障排查

| 症状 | 原因 | 应对 |
|---|---|---|
| AI 生成结果完全偏题 | dimension 标签传错或为空 | 检查 buildWorldviewPrompt 第一参数 |
| onBlur 不保存 | saveWorldview 没传 projectId | 确保 patch 含 projectId |
| 嵌套对象（divineDesign）丢字段 | save 时没传完整 object | 用 spread `{ ...divineDesign, [k]: v }` |

---

## § 9. 提交规范

```bash
git commit -m "feat(phase-05): 世界观.世界起源 + 自然环境 — 共 13 字段每个带 AI 生成"
```
