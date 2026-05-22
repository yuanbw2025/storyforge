# Phase 2：提示词管理 UI — Playbook

> 由 Opus 4.7 撰写并自执行。写于 2026-05-06。

---

## § 1. 元信息

```yaml
phase: 02
title: 提示词管理 UI（设置页新 Tab）
prerequisites: [PHASE-01 完成]
estimated_hours: 4-6
recommended_model: Opus 4.7（自执行）
status: in-progress
```

---

## § 2. 目标

让用户在「设置 → 提示词管理」二级 Tab 下，以可视化方式：
- 浏览全部 13 条系统模板（按模块分组）
- 克隆系统模板为"我的版本"做编辑
- 切换某个 moduleKey 的激活模板
- 实时预览模板渲染效果（用 Phase 1 的 prompt-engine）
- 导入/导出 JSON 模板

**不在本 Phase 范围**：
- 工作流（v3 §3.7，留给后续 Phase）
- 题材包（v3 §3.8，留给后续 Phase）
- 提示词升一级（按用户决定走原计划，留到 Phase 4 侧边栏重建时一起做）
- 模板版本谱系 UI（parentId 已存数据，但本 Phase 暂不展示家族树）

---

## § 3. 改动清单

### 新增

- `src/components/settings/SettingsPage.tsx` — Tab 容器（AI 配置 / 提示词管理）
- `src/components/settings/prompt/PromptManagerPanel.tsx` — 主面板（list + 详情 split）
- `src/components/settings/prompt/PromptTemplateList.tsx` — 左侧分组列表
- `src/components/settings/prompt/PromptTemplateEditor.tsx` — 右侧编辑器 + 实时预览
- `src/lib/ai/prompt-preview-vars.ts` — 实时预览用的样例变量字典

### 修改

- `src/pages/WorkspacePage.tsx` — `case 'settings'` 由 `<AIConfigPanel />` 改为 `<SettingsPage />`

---

## § 4. 任务步骤

### 4.1 样例变量字典 `prompt-preview-vars.ts`
覆盖 Phase 1 全部 13 条模板用到的变量；条件块变量（`isSummary` / `hasNoForeshadows`）默认为空字符串。

### 4.2 SettingsPage（Tab 容器）
两个 Tab：`AI 配置` / `提示词管理`。状态用 useState，默认 AI 配置。

### 4.3 PromptTemplateList
按 `moduleKey` 分组（13 条 → 7 大组），每组可折叠。每条显示：
- 名称
- 标签：系统/我的、激活中
- 点击 → 选中（emit selectedId）

顶部：scope filter（全部 / 系统 / 我的）+ 「+ 新建」「导入」「导出全部」三个按钮。

### 4.4 PromptTemplateEditor
传入选中的 templateId（无则显示空态）。内容：
- 顶部 meta：name / scope / moduleKey / 「设为激活」「克隆」「删除」「导出」按钮
  - 系统模板：编辑控件 readonly，仅显示「克隆为我的」
  - 用户模板：可编辑 systemPrompt / userPromptTemplate / name / description / variables（变量字符串数组，UI 显示为 chips 加号删除）
- 中间：System / User 两个 textarea
- 底部：实时预览面板，用 prompt-engine.renderPrompt() + 样例变量字典渲染最终 messages，markdown 风格展示

### 4.5 导入/导出
- 单条导出：editor 顶部按钮 → JSON Blob → download
- 全部导出：list 顶部按钮 → 全表 JSON
- 导入：file picker → JSON 解析 → 校验字段（scope / moduleKey / systemPrompt / userPromptTemplate / variables）→ 全部以 `scope='user'` 写入（无论原 JSON 是什么 scope）

### 4.6 路由接入
WorkspacePage 改 1 行，把 AIConfigPanel 换成 SettingsPage。

### 4.7 build + 浏览器自验

---

## § 5. 数据模型变更

无。Phase 1 已经把 `promptTemplates` 表建好；本 Phase 仅消费已有 store API。

---

## § 6. DoD

- [ ] `npm run build` 0 error
- [ ] 浏览器侧边栏点「设置」→ 默认显示 AI 配置 Tab → 切到提示词管理 Tab → 显示 13 条系统模板分组列表
- [ ] 选中一条系统模板 → 右侧显示只读编辑器 + 「克隆为我的」按钮
- [ ] 点「克隆」→ 新模板出现在「我的」组 → 自动选中 → 控件解锁可编辑
- [ ] 编辑 user 模板内容 → 「保存」→ DB 持久化 → 刷新页面后保留
- [ ] 「设为激活」→ 同 moduleKey 下的旧激活变成未激活
- [ ] 实时预览面板：编辑 system/user 模板时，预览同步更新
- [ ] 导出单条 → 浏览器下载 .json 文件，内容是该模板对象
- [ ] 导入一份 JSON → 列表新增"我的"模板

---

## § 7. AI 全功能巡检

不烧 token：本 Phase UI 改完，跑一遍激活切换 → 看 worldview/character/outline 几条 adapter 的 getActive 返回是不是切到了"我的"模板。

烧 token：跑一次世界观维度生成，确认用户激活的"我的"模板真的被用上（输出明显不同于系统默认风格）。

---

## § 8. 故障排查

| 症状 | 原因 | 应对 |
|---|---|---|
| 切 Tab 后内容空白 | SettingsPage state 没维护 | 检查 useState 初值 |
| 克隆后列表没刷新 | store reload 没触发 | clone 后 `await reload()` |
| 实时预览报变量缺失 warn | 样例字典少字段 | 补 prompt-preview-vars.ts |
| 导入的 JSON 校验失败 | 字段缺失或 type 错 | 在导入函数里给清晰错误提示 |

---

## § 9. 提交规范

```bash
git add storyforge/
git commit -m "feat(phase-02): 提示词管理 UI — 设置 Tab + 列表 + 编辑器 + 实时预览 + 导入导出"
```
