# 2026 年 10 月 StoryForge 架构与代码质量审查档案

审查于 2026 年 10 月 29 日固定在 `c5b51da301abd3875b26732d9657ad485ad39105`。当时登记 144 项问题，分为 52 项 P1、92 项 P2、22 个修复组。2026 年 11 月 13 日，最后九项随 PR #307 合入 `main` 的 `f2c2d471e`。原报告中的优先级、待整改状态、G1 和当时的检查结果均属于审查日期。[最后一批合并记录](https://github.com/yuanbw2025/storyforge/pull/307)

## 原始问题与审查方法

[原始机器任务清单](./evidence/quality-audit-20261029/original-task-plan.json)保留每项的 `taskId`、风险等级、审查位置、最小修复、验收条件、所属组和原始问题记录摘要。文件取自 `3a5b3722e`，字节与该提交中的 `quality-remediation-tasks-20261030.json` 完全相同。其 `status` 和 `closedFindings` 记录 10 月 30 日制定计划时的状态。回查修复可先查对应 `SFQA-` 编号，然后核对 PR 的合并提交、验证范围与历史数据反例。

| 原始材料 | 回查内容 |
|---|---|
| [审查范围和方法](https://github.com/yuanbw2025/storyforge/blob/3a5b3722e9e938add1ec9127982b54da52189a3f/docs/audits/PROJECT-QUALITY-AUDIT-PLAN-20261029.md) | 基线、审查方法、逐文件覆盖的口径和证据要求 |
| [项目审查报告](https://github.com/yuanbw2025/storyforge/blob/3a5b3722e9e938add1ec9127982b54da52189a3f/docs/audits/PROJECT-QUALITY-AUDIT-20261029.md) | 全部路径清点、分段阅读覆盖、原始失败、144 项问题、Opus 5.5 外部报告逐项复核 |
| [架构审查报告](https://github.com/yuanbw2025/storyforge/blob/3a5b3722e9e938add1ec9127982b54da52189a3f/docs/audits/PROJECT-ARCHITECTURE-REVIEW-20261029.md) | 产品 owner、跨层读写、世界来源、数据生命周期和故障恢复 |
| [代码质量报告](https://github.com/yuanbw2025/storyforge/blob/3a5b3722e9e938add1ec9127982b54da52189a3f/docs/audits/PROJECT-CODE-QUALITY-REVIEW-20261029.md) | 复杂度、重复、职责拆分、间接依赖和行为保护 |
| [原分轮整改设计](https://github.com/yuanbw2025/storyforge/blob/3a5b3722e9e938add1ec9127982b54da52189a3f/docs/roadmap/PROJECT-QUALITY-REMEDIATION-PLAN-20261030.md) | 截至 10 月 30 日的依赖拆分、共享修改范围和预计验收事项 |

审查基线清点了 17,554 个跟踪文件。原报告分别列出源码直接阅读、其他文本的复用或结构检查、二进制校验等覆盖方式。原环境的失败与受限检查保存在报告中；后续代码交付以合入时的实际证据为准。真实模型、人工体验、设备和发行各有独立的验收范围。

## 整改后适用的规则

- 小说作者显式派生世界草稿并确认封存，文字开放世界在产品内引用世界引擎的 `WorldRelease`。历史小说 `SourcePin` 的只读兼容按世界来源契约执行。[文字开放世界产品架构](../products/TEXT-OPEN-WORLD-PRODUCT-ARCHITECTURE.md)
- 后续代码变更按实际合并差异检查受影响功能、调用方和数据生命周期。六项运行时修复及五项契约、工作台、图像、模型派发与一致性修复分别先行合入；最终整合保留它们的提交历史。[协作流程](../COLLAB-WORKFLOW.md) · [六项运行时修复](https://github.com/yuanbw2025/storyforge/pull/326) · [五项修复](https://github.com/yuanbw2025/storyforge/pull/385)
