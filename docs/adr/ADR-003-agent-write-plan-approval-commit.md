# ADR-003: Agent writes use plan, approval and commit

## Status

Accepted

## Date

2026-07-10

## Context

现有 `adopt()` 会在归一化后立即写入。对话 Agent 必须在用户批准前展示准确、可复核的归一化变更；后台 Agent 也不能静默改动手稿或项目设定。如果预览和最终写入分别计算，用户批准的内容可能与真正落库的内容不一致。计划的内容身份与用户批准事实是两个不同概念，必须分别建模和持久化。

## Decision

- 将立即写入流程拆为 `planAdoption()` 与 `commitAdoption()`，并把计划身份 `planHash` 与批准事实 `ApprovalRecord` 分开持久化。
- `planAdoption()` 只完成 alias 解析、schema 验证、identity 解析、外键检查、stamp 计算和 diff 生成，返回规范化计划及其确定性 `planHash`；它不写入项目事实，也不创建 `ApprovalRecord`。
- propose 应用服务可以把规范化计划、diff、`planHash` 和基准 revision/locator 持久化为状态为 `pending` 的 pending action，供确认卡片展示。
- 只有宿主收到用户明确的批准事件后，审批应用服务才创建 `ApprovalRecord`，至少记录同一 `planHash`、actor/批准者、`approvedAt`、批准 policy 与 scope，并把对应 pending action 状态推进为 `approved`。用户修改计划时必须重新执行 `planAdoption()`，产生新的 `planHash` 并重新批准。
- `commitAdoption()` 在事务写入前必须同时验证：计划未过期；pending action 状态为 `approved`；`ApprovalRecord` 与待提交计划绑定同一 `planHash`；调用方拥有 commit capability；`ProjectLocator`、世界 identity、目标/base revision 与确定性 validators 全部通过。任一条件失败都不得写入。
- 对话 Agent 的预览与提交使用同一份规范化计划，不在批准后重新解释原始候选数据。
- 后台 Agent 可以调用 propose 能力生成待处理变更，但默认不提供 commit 工具；修改项目事实的 commit 必须由批准事件触发的宿主流程发起。

## Consequences

- 用户预览与最终提交来自同一计划，`planHash` 可稳定标识被批准的内容，`ApprovalRecord` 可独立审计谁在何时以何种 policy/scope 批准。
- locator、世界 identity、revision 或相关事实变化会使陈旧计划失败，调用方必须重新规划并再次审批。
- 计划、审批、拒绝和提交状态成为持久的 Agent 概念，可用于恢复、审计与撤销。
- 写入链路需要持久化 pending action、确定性 `planHash`、独立 `ApprovalRecord`，并提供确定性的过期检测与 capability 校验。

## Alternatives considered

- **用户预览后在提交阶段重新计算计划**：拒绝。重算可能受最新上下文、alias 或模型解释影响，使实际提交内容与用户看到并批准的 diff 不一致。
- **允许后台 Agent 对“低风险”候选直接提交**：拒绝。风险标签不能替代用户对项目事实变更的明确批准；后台仅可 read、generate、propose，commit 必须来自批准事件。
