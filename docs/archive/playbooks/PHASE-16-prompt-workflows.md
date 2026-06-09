# Phase 16：提示词工作流（v3 §3.7 链式编排）— Playbook

> Opus 4.7 自执行。2026-05-07。

## 目标

落地 v3 §3.7 的"提示词工作流"——蛙蛙写作的差异化卖点。
让用户一键跑完一段创作流程（如"故事核心 → 世界观 → 角色 → 卷大纲 → 第一章"），
每步可暂停审核 / 重生成 / 跳过 / 修改。

## 改动

新增（5 文件）：
- `lib/types/workflow.ts` — PromptWorkflow / PromptWorkflowStep / WorkflowRunState
- `lib/db/schema.ts` v8 加 `promptWorkflows` 表
- `lib/ai/workflow-seeds.ts` — 3 条内置工作流
- `stores/workflow.ts` — Zustand store（init/save/clone/remove）
- `components/settings/prompt/PromptWorkflowsPanel.tsx` — 列表 + Runner 二合一

修改：
- `lib/types/index.ts` 导出 workflow 类型
- `main.tsx` REQUIRED_TABLES + bootstrap 调用 init
- `components/settings/prompt/PromptManagerPanel.tsx`
  · 顶部加二级 Tab：模板 / 工作流
  · 拆出 PromptTemplatesView 子组件保持原模板视图

## 内置工作流

1. **极速起书 · 通用**（默认）— 5 步
   - 一句话故事 → 世界起源 → 主要角色 → 卷级大纲 → 第一章正文
   - 每步带 inputMapping，把上一步输出作为下一步上下文
   - 中间步骤 userConfirmRequired=true，每步等用户确认

2. **单章深度生成** — 4 步
   - 细纲拆场景 → 写正文 → 润色 → 去 AI 味
   - 适合精雕细琢一章

3. **伏笔体系搭建** — 2 步
   - 世界观摘要 → 伏笔建议（5-8 个）
   - 适合中期补伏笔

## Runner 设计

```
[开始]                    ← 全部 idle 时
  ↓
执行第 0 步
  - status='running' + Loader2 转圈
  - useAIStream.start(messages)
  - 流式输出实时渲染到该步卡片
  ↓
完成 → 显示输出 + 「重新生成」「跳过」按钮
  ↓
检查 userConfirmRequired:
  - true: globalStatus='paused'，等用户点「继续」
  - false: 自动执行下一步（递归 runStep(idx+1)）
  ↓
全部完成 → status='completed'，显示汇总
```

每步独立卡片：
- 待执行：灰边框 + 只显示标题
- 运行中：accent 边框 + 闪烁 sparkles + 流式 output
- 完成：success 边框 + 文本预览 + 重新生成/跳过按钮
- 失败：error 边框 + 错误信息 + 重新生成

## 数据流

```
ctx 构造：
  - 上一步.output 通过 step.inputMapping[ 'previousOutput' ] 映射到 ctx.{key}
  - step.userHint 注入 ctx.userHint
  - step.parameterValues 通过 renderPrompt 的 options.parameterValues 注入

模板查找：
  - usePromptStore.getState().getActive(step.promptModuleKey)
  - 自动遵循"用户激活 > 系统激活"优先级

渲染 + 调用：
  - renderPrompt(tpl, ctx, { parameterValues: step.parameterValues })
  - useAIStream.start(messages) → output
  - output 存入 results.get(stepId).output
```

## DoD

- [x] build 0 error
- [x] DB 中有 3 条 system 工作流
- [x] 提示词库顶部出现「模板 / 工作流」Tab
- [x] 工作流 Tab 显示 3 张卡片，含「运行」按钮 + 步骤箭头链
- [x] 点「运行」进 Runner 界面，每步独立卡片
- [x] Runner 头部「开始 / 中止 / 继续 / 返回列表」按钮工作
- [x] 步骤完成后显示文本预览 + 「重新生成」按钮

## 不在本 Phase 范围

- 用户自建工作流的 UI 编辑器（克隆已有模板可用，但深度编辑步骤要 Phase 17）
- 输出自动写入对应模块（如把"第一章正文"自动存到 chapters 表）
  → 当前需要用户手动复制粘贴
- 工作流的导入 / 导出 JSON

## 用户原始 5 决策完整闭环

至此除了用户原始 5 点决策，**蛙蛙写作风格的工作流**也已落地。
StoryForge 的提示词系统达到了 v3 战略文档规划的完整功能终态：
- ✅ 提示词管理（卡片化）
- ✅ 题材包切换
- ✅ 参数化 + 不使用开关
- ✅ 创作区临时微调浮窗
- ✅ 示例反例（few-shot + 用户标记 + AI 生成）
- ✅ 链式工作流（一键跑流程，每步可审核）
