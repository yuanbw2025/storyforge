# ADR-001: StoryForge-owned Agent runtime port

## Status

Accepted

## Date

2026-07-10

## Context

StoryForge 同时面向 Web/PWA 与 Tauri。对话副驾和后台 Agent 需要统一支持 tool loop、审批暂停与恢复、MCP，以及未来的多 Agent 编排。如果 UI、内部工具、领域服务或编排服务直接依赖某个具体 AI SDK 的运行时类型，SDK 的事件模型、provider 格式和升级节奏就会渗入应用层，使运行时难以替换，也会让不同壳层产生分叉实现。

## Decision

- 定义 StoryForge 自有的 `AgentRuntimePort`，并将其作为唯一的应用层 Agent 运行时契约。
- `AgentRunner` 是 StoryForge 的编排应用服务；它的运行时依赖只有 `AgentRuntimePort`，只提交 `run` / `resume` / `cancel` 请求并消费 StoryForge 定义的 `AgentEvent`，不得导入 provider 或 AI SDK 的消息、tool-call、流事件类型。
- 首个实现为 `AiSdkAgentRuntimeAdapter`。provider tools 注入、provider/SDK 格式适配、tool-call 映射、错误与恢复格式转换、流事件归一化全部收口在该 adapter 内。
- UI、StoryForge 内部工具和领域服务不得导入 AI SDK runtime 类型，也不得为 Web/PWA 与 Tauri 分别实现独立的 Agent runtime 语义。
- `run`、`resume`、`cancel` 都以事件流形式工作；应用层只接收 StoryForge 定义的 `AgentEvent`。

## Consequences

- 可以替换现有 SDK，或并行补充新的 runtime adapter，而不改动 UI、`AgentRunner` 与领域层。
- provider 差异集中在 adapter 中归一化，应用层只处理稳定的 `AgentEvent`。
- StoryForge 需要维护自己的端口、事件语义、adapter 契约测试和恢复一致性测试。
- 本任务只记录边界决策，不添加 AI SDK 依赖。

## Alternatives considered

- **直接向应用层暴露 AI SDK runtime**：拒绝。它会把 provider tool 格式、流事件和升级节奏扩散到 UI、编排与领域代码，替换 SDK 时需要跨层重写。
- **Web/PWA 与 Tauri 壳层各自维护独立 runtime**：拒绝。两套实现会逐步分叉 tool loop、审批恢复和事件语义，导致同一项目在不同壳层表现不一致。
