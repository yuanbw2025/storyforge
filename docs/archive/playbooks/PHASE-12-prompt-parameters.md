# Phase 12：提示词参数化 + 默认徽章 + 网文老贼改名 — Playbook

> Opus 4.7 自执行。2026-05-07。

## 目标

为 Phase 13-15 的题材包 / 用户运行时调参 / 示例反例打地基。
本 Phase 聚焦三件事：
1. PromptTemplate 类型扩展（parameters / genres / isDefault / examples / lengthMode）
2. 渲染引擎升级支持参数变量 + uses* 条件块 + 运行时 overrides
3. 改名「网文老贼」为「长篇连载作者」+ UI 加默认徽章 + 列表加默认徽章
4. PromptTemplate 编辑器集成 PromptParametersEditor 子组件

## 改动清单

新增：
- `components/settings/prompt/PromptParametersEditor.tsx` — 模板参数声明编辑器
- `docs/playbooks/PHASE-12-prompt-parameters.md`

修改：
- `lib/types/prompt.ts` — PromptTemplate 加 5 个可选字段；新增 PromptParameter / PromptExample 类型
- `lib/ai/prompt-engine.ts` — renderPrompt 接受 options.parameterValues / overrides
- `lib/ai/prompt-seeds.ts` — chapter.content 改名 + 加 isDefault + 加 3 个 parameters；CHAPTER_SYSTEM 加条件块
- `stores/prompt.ts` — init() 改为：已有 system seed 自动用代码内容刷新（除 isActive 外）
- `components/settings/prompt/PromptTemplateList.tsx` — 默认徽章
- `components/settings/prompt/PromptTemplateEditor.tsx` — 默认徽章 + 集成参数编辑器

## 设计要点

### parameters 数据结构

```ts
PromptParameter {
  key, label, type, options?, min?, max?, step?, default,
  description?, optional?, // optional=true 时可被用户关闭
}
```

模板里可用：
- `{{key}}` — 直接插值
- `{{#if usesKey}}...{{/if}}` — 仅当参数启用时保留块（usesKey 自动生成）

### 渲染引擎 options.overrides

```ts
renderPrompt(tpl, ctx, {
  parameterValues: { tone: '轻松' },        // 运行时调参
  overrides: { systemPrompt: '...' },        // 运行时改 prompt 文字
})
```

为 Phase 14 的"创作区临时微调"打基础 — 可以在不改写模板的情况下，做这一次的临时覆盖。

### Seed 自动刷新

之前 `init()` 只在表为空时种 seed，导致已有用户库里"网文老贼"还在。
现在改为：每次启动检查并刷新所有 system seed（保留用户的 isActive 选择）。
这样每次升级提示词种子，用户重启 App 就拿到最新内容。

## DoD

- [x] build 0 error
- [x] DB 中 chapter.content seed 名称是「内置-长篇连载（默认）」
- [x] isDefault=true，UI 显示 ★ 默认徽章
- [x] 3 个 parameters 注入到模板，渲染引擎正确处理 usesXxx 条件块
- [x] 编辑器右侧出现「可调参数」区，显示 3 个参数

## 与 Phase 13-15 的衔接

- **P13** 题材包：每套包写一份 chapter.content / character.generate / outline.* 等模板，
  scope=system，genres=['xianxia'] 等。提示词库顶部加题材包切换器
- **P14** 创作区临时微调：在 ChapterEditor 等面板加「📋 当前提示词」浮窗，显示激活模板
  + 参数滑块；点 AI 生成时把 parameterValues / overrides 传给 renderPrompt（已就位）
- **P15** 示例反例：编辑器加示例区；运行时把 good 示例拼到 user prompt；AI 调用后弹标记按钮
