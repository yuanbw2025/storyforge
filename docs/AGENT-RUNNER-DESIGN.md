# AGENT-1 · 只读 AgentRunner 设计

> 状态：Phase 27.1-b 已完成（2026-07-25）；H1 durable adapter 已完成（2026-08-08）。
> Runner 仍是受预算约束的单一只读执行内核，不包含写入确认卡或多 Agent。

## 1. 提供商边界

StoryForge 当前统一 `chat()` 只消费 OpenAI-compatible `chat/completions` 的文本
`message.content`。OpenAI 标准 function calling 使用 `tools`，模型返回
`message.tool_calls[]`，应用执行后再用 `role=tool + tool_call_id` 回传；所有 arguments
仍必须由应用校验。

- 本期先用所有已配置文本模型都可走的严格 JSON 动作协议；
- Runner 与模型 transport 分离，未来能力探测后可换原生 tools，不改执行内核；
- 原生 tools 不是完成本期安全闭环的前提。
- Agent 协议禁止沿用普通生成链的静默消息裁剪；窗口不足时明确停止，不能丢掉用户目标、
  工具证据或协议历史后继续执行。

## 2. 严格动作协议

模型每轮只能返回一个 JSON 对象：

```json
{"type":"tool","calls":[{"name":"read_project_status","arguments":{}}]}
```

或：

```json
{"type":"final","answer":"基于工具证据的最终答复"}
```

规则：

- 不从自然语言、Markdown 围栏、多个 JSON 或 JSON5 中猜动作；
- 单轮最多 4 个彼此独立的只读调用，减少模型往返和重复前缀；
- tool name 必须存在且 `risk=read`；
- 顶层、call 和 arguments 均走额外字段拒绝；
- project/world scope 不在协议内，由工作区执行上下文锁定；
- 工具返回的小说内容标记为“不可信数据”，不得当成指令。

## 3. 预算与停止

默认：

- 最多 8 次模型调用，硬上限 15；
- 最多 8 次工具调用，硬上限 20；
- 模型累计 48K tokens，硬上限 250K；
- 工具结果累计 24K tokens，硬上限 100K；
- 协议错误最多修正 2 次；
- 相同工具 + 相同参数不允许重复，批内重复也立即停机。

API 返回真实 usage 时保留真实值，但输入、输出和总量均不得低于本地保守估算；缺失、负数
或非有限 usage 会退回本地估算。每次模型请求前先计算完整 transcript 的预计输入，不能以
“下一次也许很短”为理由越过剩余预算。单个工具结果越过累计预算后立即停止，不再执行同批
剩余工具。

停止原因显式区分：

- `completed`
- `max_steps`
- `max_tool_calls`
- `token_budget`
- `tool_result_budget`
- `protocol_error`
- `loop_detected`
- `aborted`
- `model_error`

停止不等于成功；只有 `completed` 有正式 answer。

## 4. 审计与数据边界

Runner 内核不直接查询或写入 run 表、不保存对话、不写小说内容数据。可选的
`runDurableReadOnlyAgentV1()` 通过 awaited execution trace 把模型/工具边界的哈希、预算和
step/attempt 投影到已登记的 run ledger；最终答复只以 32,000 字符上限的 checkpoint 结果
保存，不复制完整 transcript、工具正文或隐藏推理。模型请求仍复用统一客户端，因此成功返回
usage 时会按既有规则增加一条 `aiUsageLog(category=agent.readonly)`；它只用于项目成本统计，
不进入便携导出，也不能被描述为角色、设定、正文或其它 Canon 写入。调用方可接收内存事件：

- start + limits；
- 每次模型输出与 usage；
- 协议错误；
- 工具名、成功/失败、结果 token；
- 最终 stop reason。

工具失败作为证据回传给模型换路，但工具循环、越权或预算越界由代码直接停止，
不交给模型自行判断。

## 5. 后续

1. 用纯只读“一致性项目巡检”继续验证当前已配置提供商的实际输出稳定性和成本；
2. 对明确支持 Chat Completions tools 的 provider 增加会话内能力探测；
3. 原生 tool transport 复用同一 action/registry/limits，不复制 Runner；
4. Phase 27.1-c 已用首个世界来源确认卡验证 `GenerationNode + gate + adopt`，不把
   候选写回能力混入只读 Runner；
5. 写入仍必须走 `GenerationNode + gate + adopt`，后台保持只读。
6. durable Runner 的模型 `final` 只形成可恢复的 step result；H2 terminal verifier 签发 fresh
   receipt 前，run 保持 `paused`，不得称为 Harness 已完成。

## 6. 验收证据

- `R-AGENT1-readonly-runner` 覆盖严格协议、作用域/分类锁定、消息裁剪拒绝、有限修正、
  循环、步数/工具/模型 token/工具结果预算、异常 usage、批间取消、跨项目失败和标准
  `aiUsageLog` 边界。
- 与 Phase 27.1-a 和任务路由合跑共 3 个文件、36 项专项测试通过。
- 真实浏览器项目 `IDEA-1 参考演化隔离验证` 使用当前已配置提供商完成 2 轮模型调用和
  2 个正式只读工具；工具结果 117 tokens、累计保守计量 2292 tokens。
- 真实验收前后只有 `aiUsageLog` 从 5 增至 7；角色、设定、正文、Canon 及其它项目内容
  表零变化。
- `R-HARNESS1-readonly-durable-runner` 覆盖工具 source 闭包、零写契约、真实 client adapter、
  四个边界共 20 次中断、整步/检查点恢复、scope/contract/tamper 和预算失败；checkpoint 后
  三个边界均不增加模型调用，checkpoint 前只重跑未完成 step。
