# Phase 10：AI 文档解析导入 — Playbook

> Opus 4.7 自执行。2026-05-06。

```yaml
phase: 10
title: AI 解析角色 / 世界观 / 大纲文档并批量入库
prerequisites: [PHASE-09 完成]
estimated_hours: 3
status: in-progress
deviation: 当前仅支持 .txt/.md/.csv（纯文本类）。.docx/.xlsx 需要额外库（mammoth/xlsx），后续按需补
```

## 目标

把 Phase 4 留下的「导入」占位面板替换为可工作的 AI 文档解析入口。
Phase 1 在 PromptModuleKey 已声明 import.parse-* 三个 key，但没注入种子；本 Phase 补齐。

## 改动

新增（3 文件）：
- `lib/ai/adapters/import-adapter.ts` — buildImportParsePrompt + extractJSON 工具
- `components/system/ImportDocPanel.tsx` — 类型选 + 上传/粘贴 + AI 解析 + 预览 + 确认导入
- `docs/playbooks/PHASE-10-import-doc.md`

修改：
- `lib/ai/prompt-seeds.ts` — 新增 3 条 system seed（import.parse-character/worldview/outline）
- `pages/WorkspacePage.tsx` — `import-doc` 由 Placeholder 改为真实面板，删掉 PlaceholderPanel import（已无占位）

## 设计

### 流程
1. 选导入类型（角色 / 世界观 / 大纲）
2. 粘贴文本或上传 .txt/.md/.csv
3. 「AI 解析」→ 流式输出原始结果
4. AI 输出用 ```json 包裹的结构化 JSON → extractJSON 抽取
5. 预览解析结果（不符合预期可重试）
6. 「确认导入」→ 写入对应 store

### 提示词设计
- 角色：输出 JSON 数组，每项含 name/role/shortDescription/...
- 世界观：输出 JSON 对象，键对应 v3 worldview 字段
- 大纲：输出 JSON 数组，节点含 type/title/summary/children

### 写入逻辑
- 角色：循环 addCharacter
- 世界观：合并到现有 worldview（已有内容追加，否则直接写）
- 大纲：递归 addNode，volume 节点的 children 写为 chapter

### 文档过长保护
adapter 截断到 30000 字符（约 8K tokens），避免 AI 调用爆 token。

## DoD

- [x] build 0 error
- [x] 「设置区 → 导入」点击显示完整 UI
- [x] 类型可切（角色/世界观/大纲）
- [x] 上传 .txt 或粘贴文本可填充内容
- [x] 「AI 解析」流式输出
- [x] 解析成功后 JSON 预览可见
- [x] 「确认导入」写入对应 store

## 副产品

Phase 4 设的全部 7 个 Placeholder 已经全部被替换为真实面板。删掉了 PlaceholderPanel 的 import。
（组件文件 components/shared/PlaceholderPanel.tsx 留着备用，下次有新占位仍可用。）
