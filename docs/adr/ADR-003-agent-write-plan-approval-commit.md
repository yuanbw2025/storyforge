# ADR-003: Agent writes use plan, approval and commit

## Status

Accepted

## Date

2026-07-10

## Context

现有 `adopt()` 会在归一化后立即写入。对话 Agent 必须在用户批准前展示准确、可复核的归一化变更；后台 Agent 也不能静默改动手稿或项目设定。如果预览和最终写入分别计算，用户批准的内容可能与真正落库的内容不一致。

## Decision

- 将立即写入流程拆为 `planAdoption()` 与 `commitAdoption()`。
- `planAdoption()` 完成 alias 解析、schema 验证、identity 解析、外键检查、stamp 计算和 diff 生成，但不写入项目数据。
- `commitAdoption()` 在事务写入前复核计划是否过期，并校验 `ProjectLocator`、目标 revision、approval hash 与确定性校验结果；全部通过后才提交。
- 对话 Agent 的预览与提交使用同一份归一化计划，不在批准后重新解释原始候选数据。
- 后台 Agent 可以调用 propose 能力生成待处理变更，但默认不提供 commit 工具。

## Consequences

- 用户预览与最终提交来自同一计划，审批内容可准确追踪。
- locator、revision 或相关事实变化会使陈旧计划失败，调用方必须重新规划并再次审批。
- 审批、拒绝和提交状态成为持久的 Agent 概念，可用于恢复、审计与撤销。
- 写入链路需要持久化计划元数据、approval hash，并提供确定性的过期检测。
