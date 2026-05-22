# Phase 15：示例 / 反例（few-shot + 用户标记 + AI 自动生成）— Playbook

> Opus 4.7 自执行。2026-05-07。

## 目标

落实用户决议的第 5 点：
- **AI 自动生成示例**（一键基于模板生成 2-3 条样本）
- **用户使用中标记好坏**（每次 AI 生成完，旁边出现 ⭐/💩 按钮）
- **示例自动累积**到模板的 examples 字段
- **下次调用时自动注入** few-shot 到 user prompt 末尾

## 改动

新增：
- `components/settings/prompt/PromptExamplesEditor.tsx` — 模板编辑器中的「示例 / 反例」区
  · 双列布局：左 ⭐ 好示例 / 右 💩 反例
  · 每列「手动添加」+「AI 自动生成」+ 单条删除
  · 显示来源徽章：🤖 AI 生成 / 👤 用户标记 / ✍️ 手动添加
- `docs/playbooks/PHASE-15-examples-counterexamples.md`

修改：
- `lib/ai/prompt-engine.ts`: 渲染时自动把模板的 examples（最多 good 3 + bad 2）
  拼到 user prompt 末尾，作为 few-shot
- `components/shared/AIStreamOutput.tsx`:
  · 新增 moduleKey prop
  · 输出栏新增「⭐ 好示例 / 💩 反例」按钮
  · 点击后调 saveTemplate 把当前 output 写入对应模板的 examples
- `components/shared/AIFieldCard.tsx`: AIStreamOutput 加 moduleKey 透传
- `components/worldview/WorldviewFieldEditor.tsx`: 同上
- `components/settings/prompt/PromptTemplateEditor.tsx`: 集成 PromptExamplesEditor

## 设计

### 数据流

```
用户在创作区调用 AI
  ↓
prompt-engine 渲染时检查 template.examples
  ↓
拼接 [好示例 1-3 + 反例 1-2] 到 user prompt 末尾
  ↓
AI 生成
  ↓
用户在 AIStreamOutput 看到结果，点 ⭐/💩
  ↓
saveTemplate 把 output 存到 examples.good[] 或 examples.bad[]
  ↓
下次调用时自动作为 few-shot 影响 AI
```

### 来源标记

- `system` ✍️：用户在编辑器手动添加
- `ai-generated` 🤖：编辑器里点「AI 生成」批量生成
- `user-marked` 👤：创作区使用中点 ⭐/💩 标记的

来源仅用于 UI 区分，对 AI 没影响（拼接时统一处理）。

### AI 自动生成 meta-prompt

让 AI 反推模板要的输出：
- 好示例：「根据模板的 system+user prompt，生成 2 条高质量输出样本」
- 反例：「生成 2 条该模板希望避免的低质量样本」

输出用 `===EXAMPLE===` 分隔，前端 split 后入库。

### 限制

- good 最多取前 3 条，bad 最多前 2 条 — 避免 user prompt 过长烧 token
- 每条 user-marked 限制 2000 字，避免拷贝整章正文撑爆
- 用户在创作区每次 AI 调用的 ⭐/💩 只能标一次（按钮 disabled）

## DoD

- [x] build 0 error
- [x] PromptTemplateEditor 显示「示例 / 反例」区
- [x] 「手动」按钮工作 — prompt 弹窗输入文本入库
- [x] 「AI 生成」按钮工作（用户得有 API Key）
- [x] AIStreamOutput 在创作区显示 ⭐/💩 按钮（提供 moduleKey 时）
- [x] 标记后状态变 disabled，防止重复
- [x] 渲染引擎拼接 examples 到 user prompt（验证：检查 messages[1].content 包含「【参考示例】」）

## 完整功能闭环

```
1. 用户开始用一个模板
2. 第一次生成质量平平 → 标 💩
3. 调参/换种子 + 加 hint → 生成更好 → 标 ⭐
4. 多次循环后，模板已积累 5-10 条好/坏示例
5. 第 N 次生成：AI 看到自己之前的好/坏样本，自动校准风格
6. 模板"越用越准"
```

至此用户原始 5 个决策全部落地（题材包 / 改名+默认 / 卡片化创作区 /
参数化+不使用开关 / **示例反例 AI 自动生成 + 用户标记**）。
