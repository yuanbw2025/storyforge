# 火山方舟 DeepSeek 连接证据 · 2026-08-15

## 范围

本页只记录 StoryForge 设置页的最小真实连接验证，不把 HTTP 连接成功冒充 H4 质量、成本或
held-out 证据。API Key 不进入仓库、日志摘要或本文。

## 账号可见模型与调用契约

火山方舟控制台为当前账号显示三项生效中的 DeepSeek 文本推理资源包，并在官方接入示例中给出：

| 模型 | 方舟模型 ID | 接口 |
| --- | --- | --- |
| DeepSeek V4 Flash 正式版 | `deepseek-v4-flash-ga-260731` | OpenAI-compatible Chat |
| DeepSeek V4 Pro | `deepseek-v4-pro-260425` | OpenAI-compatible Responses；Chat 最小连接亦可用 |
| DeepSeek V4 Flash | `deepseek-v4-flash-260425` | OpenAI-compatible Responses |

区域端点为 `https://ark.cn-beijing.volces.com/api/v3`；浏览器验证经项目已有
`/doubao-proxy/api/v3` 同源代理发送。`doubao` 仍是兼容历史配置的内部 provider ID，设置页展示名已
改为“火山方舟（豆包 / DeepSeek）”。

## 真实结果

账户补欠费前，请求在推理前被账户校验层拒绝：

| 模型 | 结果 | 延迟 |
| --- | --- | ---: |
| `deepseek-v4-pro-260425` | `403 AccountOverdueError` | 174 ms |
| `deepseek-v4-flash-ga-260731` | `403 AccountOverdueError` | 328 ms |

账户恢复正常后，在设置页明确从方舟模型下拉框选择精确 ID 并重新发起最小 Chat 请求：

| 模型 | 结果 | 延迟 |
| --- | --- | ---: |
| `deepseek-v4-flash-ga-260731` | HTTP 成功，显示“连接成功” | 977 ms |
| `deepseek-v4-pro-260425` | HTTP 成功，显示“连接成功” | 1,263 ms |

这证明当前方舟 Key、同源代理和两个精确 DeepSeek 模型 ID 可用。最小测试响应没有返回可归档的
token usage、资源包扣减或现金成本，因此不能据此声称 0 成本，也不能替代新的完整 development
checkpoint。后续 verifier/generator 运行必须继续逐调用记录 usage、成本和延迟。

## 工程修正

- 方舟下拉新增上述三个精确 DeepSeek 模型 ID，并为版本化 ID 登记 128K 上下文预算；不再让它们按
  未识别模型的 8K fallback 计算。
- provider 展示名从“豆包”改为“火山方舟（豆包 / DeepSeek）”，避免把方舟承载模型与豆包模型混为
  一谈。
- `AccountOverdueError` 在 403 之前按正文错误码识别为账户欠费，不再误标为 API Key 权限不足。
- HTTP 402 余额不足不再被连接测试误报为成功。
- 本机已分别保存“方舟 DeepSeek V4 Pro”和“方舟 DeepSeek V4 Flash”预设；凭证仍只服从用户选择的
  local/session storage 策略，不进入 Git。
