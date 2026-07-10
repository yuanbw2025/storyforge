# ADR-001: StoryForge-owned Agent runtime port

## Status

Accepted

## Date

2026-07-10

## Context

StoryForge 同时面向 Web/PWA 与 Tauri。对话副驾和后台 Agent 需要统一支持 tool loop、审批暂停与恢复、MCP，以及未来的多 Agent 编排。如果 UI、内部工具或领域服务直接依赖某个具体 AI SDK 的运行时类型，SDK 的事件模型、provider 格式和升级节奏就会渗入应用层，使运行时难以替换，也会让不同壳层产生分叉实现。

## Decision

- 定义 StoryForge 自有的 `AgentRuntimePort`，并将其作为唯一的应用层 Agent 运行时契约。
- 首个 adapter 后续使用 AI SDK 实现，但该选择只存在于 adapter 边界内。
- UI、StoryForge 内部工具和领域服务不得导入 AI SDK runtime 类型。
- `run`、`resume`、`cancel` 都以事件流形式工作；应用层只接收 StoryForge 定义的 `AgentEvent`。
- provider 与 SDK 的事件、tool-call、错误和恢复格式由 adapter 归一化为 StoryForge 契约。

## Consequences

- 可以替换现有 SDK，或并行补充新的 runtime adapter，而不改动 UI 与领域层。
- provider 差异集中在 adapter 中归一化，应用层只处理稳定的 `AgentEvent`。
- StoryForge 需要维护自己的端口、事件语义和契约测试。
- 本任务只记录边界决策，不添加 AI SDK 依赖。
