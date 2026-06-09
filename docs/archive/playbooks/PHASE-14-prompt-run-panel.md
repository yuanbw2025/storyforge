# Phase 14：创作区临时微调浮窗 — Playbook

> Opus 4.7 自执行。2026-05-07。

## 目标

实现你提的"卡片化 + 创作区微调"核心 UX：
用户在创作区调用 AI 生成时，能在浮窗里临时调参 + 临时改 prompt 文字，
**这次生成生效，不写回模板**。

## 改动

新增：
- `components/shared/PromptRunPanel.tsx` — 可折叠浮窗，展示当前激活模板 +
  参数 UI + 高级文本覆盖 + 「重置」「另存为我的版本」

修改：
- `lib/ai/prompt-engine.ts` — 已支持 options.parameterValues / overrides（P12）
- `lib/ai/adapters/worldview-adapter.ts` — 加 6th `options` 参数
- `lib/ai/adapters/story-adapter.ts` — 加 6th `options` 参数
- `components/shared/AIFieldCard.tsx` — buildMessages 签名加 options，
  内部维护 parameterValues / systemOverride / userOverride 状态，
  传 moduleKey prop 时显示 PromptRunPanel
- `components/worldview/WorldviewFieldEditor.tsx` — 同上模式
- `components/worldview/StoryCorePanel.tsx` — mkBuilder 接 options 转发；
  AIFieldCard 加 moduleKey="story.generate"

## 关键设计

### 运行时三种覆盖

| 类型 | 状态 | 写回模板？ |
|---|---|---|
| `parameterValues` | 用户调滑块/下拉 | ❌ 不 |
| `systemOverride` / `userOverride` | 用户在「高级」里改文本 | ❌ 不 |
| 「另存为我的版本」 | 一键 cloneTemplate + 把当前覆盖固化 | ✅ 写新的 user 模板 |

### "工具不能支配用户"

每个 optional 参数有左侧复选框：
- 勾选 = 启用，参数值生效
- 不勾选 = 禁用，参数从 prompt 中消失（条件块 {{#if usesXxx}} 隐藏），
  AI 用自己的判断

这样用户既能用工具的预设参数，也能彻底关掉某个参数走原生效果。

### 模板查找优先级

PromptRunPanel 找当前激活模板的顺序：
1. user.isActive 优先
2. system.isActive 次之
3. 同 moduleKey 的任意模板兜底

### 文本覆盖的"还原"

`systemOverride/userOverride === null` 时显示模板原文（受控但允许 null
表示"未覆盖"）。点「还原」即把 override 设回 null。

## DoD

- [x] build 0 error
- [x] WorldviewFieldEditor / AIFieldCard 都显示 PromptRunPanel
- [x] 折叠展开按钮工作
- [x] 参数 UI（select 下拉 + 复选框启用/禁用 + 滑块）
- [x] 高级区显示当前模板的 system/user prompt 原文 + 可临时改
- [x] 「重置」清空所有覆盖
- [x] 「另存为我的版本」克隆模板并把当前参数值固化为新模板的 default

## 截图

世界观面板「世界起源 → 世界来源」字段卡片下方显示：
- 「📋 当前模板：内置-世界观维度生成」（折叠头）
- 展开后两个参数下拉「基调」「详尽度」+ 各自的启用复选框
- 「高级：临时修改 Prompt 文字（不写回模板）」折叠区
- 底部「⟲ 重置」+「💾 另存为我的版本」

## 下一步：Phase 13 题材包

5 套（玄幻爽文/仙侠修真/言情/现实主义/悬疑推理），每套 ~10 条模板，
全部走 `genres: ['xxx']` 标签。提示词库顶部加题材包切换器。
