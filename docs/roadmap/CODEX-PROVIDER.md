# Codex 本机订阅提供商

> 2026-10-10 · L2 · 本地提供商施工与维护契约；发布状态以交付 PR 为准。

## 产品边界与调整后的方案

这是共享 AI 底座的产品研发，不新增作品产品或改变 S1/S2/S3。入口为通用设置中的 `Codex（本机 ChatGPT 登录）`，交接物仍是既有 Harness 的 CreativeArtifact 候选；只有原产品的显式采纳动作可以写回。Work、WorldRelease 引用、媒资 owner 以及三注册表保持原有归属。

优先复用本机 Codex 的原生登录缓存。用户已经用 ChatGPT 登录且本地服务可访问相同凭据存储时，无需再次登录。打开项目不是登录凭据共享的保证；必须实际检测。登录缺失时提供 Codex 官方托管登录链接，也可以在终端执行 `codex login`。不得读取、复制或向浏览器返回 `auth.json`、OAuth token。API Key 模式不能代替订阅模式。停止连接只结束 StoryForge 子进程，不调用 `account/logout`。

通过官方 `codex app-server` JSON-RPC 适配，不能把 ChatGPT 登录当作 OpenAI API Key，也不是简单替换 Base URL。订阅额度和 API 账单分开；模型和配额以实际账户为准，不承诺无限使用或所有套餐均支持。

## 关联闭包与数据生命周期

`AIConfigPanel / CodexConnectionCard → ai-config / task-routing → client.chat / streamChat → codex-transport → 本地 bridge → app-server`。

- `CONTEXT_SOURCES`、Context Gateway 与各 Run Contract 继续提供输入；连接服务不再读项目目录、全局 AGENTS 或开发对话。
- 返回文本或 JSON schema 输出交回原调用者。`FIELD_REGISTRY / AdoptionSchema / adopt()` 继续校验正式写入，不引入另一套创作 Agent。
- 无新增业务表、schema 迁移或作品数据生命周期。现有 `aiUsageLog` 仍由 `PROJECT_TABLES` 管理；Codex 费用为 `null`，不伪造 API 价格或零费用。向量和图片审查明确拒绝 Codex，需独立提供商。
- 本地私有传输记录保存在 `~/.storyforge/codex/<工作目录摘要>/receipts.json`，目录 0700、文件 0600（Windows 由操作系统 ACL 管理）；含请求 ID、内容摘要、模型、状态、返回文本和用量，不保存输入提示词或凭据。保留 24 小时、最多 100 条，访问记录时清理。它不是作品数据库、不进入作品备份，也不能自动采纳。
- 每个目录由一个服务进程持有锁。刷新后在设置中检查记录、取回返回文本；未完成请求在服务重启后标为结果未知，禁止自动重放。

## 服务与隔离

开发服务器和 `npm run build` 后的 `npm run preview` 共用同源 `/storyforge/local-codex/v1`。按需启动，普通 API 用户和静态构建不会启动 Codex。仅允许回环客户端、回环 Host、同源 Origin 和专用请求头，拒绝跨域预检和 LAN 暴露。PWA 不缓存连接路由。

纯静态线上站点仅显示本机运行说明。此方案不提供远程代登录、共享账号、SaaS 订阅转售或多人订阅池。保留原浏览器地址、端口和 origin；换运行地址不会搬迁 IndexedDB，切换前按原备份流程保护手稿。

运行依赖 PATH 中的 Codex CLI，或 `STORYFORGE_CODEX_BIN` 指定可执行文件。当前协议最低版本为 0.162.0，实测 0.162.0-alpha.2；升级后继续验证协议和隔离，不把版本号作为长期兼容保证。

每次生成建立 ephemeral 新 thread，工作目录为临时空目录，环境、动态工具和 capability roots 均为空，关闭 shell、MCP、插件、skills、memories、搜索、浏览器与子 Agent。启动时核对有效配置，显式禁用所有已配置 MCP；发现无法隔离或非空 instructionSources 即停止。服务器工具/授权 RPC 一律拒绝。

使用专用 `storyforge-subscription` app-server provider：官方 OpenAI 身份认证、Responses 协议，不指定第三方 base URL、env key 或 token；HTTP/stream 重试均为 0。禁止替代模型和提供商；线程回执再次核对实际模型。此 provider 是 Codex 本地协议配置，不是 StoryForge 新增的付费 API 配置。

## 请求、恢复与能力

浏览器每次生成只提交一次 UUID；同 ID 同内容返回原记录，不同内容拒绝。服务顺序执行、最多 32 条待处理请求。取消排队请求不会发送模型请求；在途取消请求会向 Codex 发送 `turn/interrupt`。未知结果、授权失败、额度不足不静默重发。单次最多 20 分钟，请求和返回文本各限 2 MiB。

只把最终答复消息当作者文本，排除 reasoning 和 commentary；有明确 final_answer phase 时增量返回，否则等消息完成。必须收到 `turn/completed` 且有非空文本才成功。失联/崩溃后部分文本仍不能当成功候选。客户端保留 pre-dispatch / request-dispatched / response-observed 边界，现有 durable Harness 继续决定恢复和采纳。

现有以 API 金额为必填统计的模型评测入口暂不接受 Codex；在共享客户端发送前明确阻止，不伪造评测美元费用。原生 tool_calls 不支持，Agent 继续走既有 text-json 协议；JSON schema 映射 `outputSchema`；`json_object` 映射为固定格式约束并在共享客户端严格解析为对象，非法结果直接停止、不自动修复重发。两者仍需原产品字段/schema 校验。温度和 API max_tokens 不发送；本地上下文预算使用保守 32K、预留 8K 输出，可由高级设置调整。这不是模型实际窗口或远端输出 token 硬上限。批量生产的金额闸门不得把未知订阅成本当作零成本放行。

## 验收

- Node 协议/HTTP 反例：同源限制、工具隔离、错误登录/版本、模型替换、幂等、排队取消、服务重启、记录权限、禁止自动重发。
- 共享客户端：预设路由无 Key、chat/stream/schema、用量、未知结果边界、配置不落凭据；现有 API 提供商回归。
- 隔离浏览器：已登录不再登录、模型选择刷新持久化、停止连接不登出、错误账号与缺少服务提示。
- 真实账户只使用合成最小文本/结构化候选验证，不触碰作者手稿；短请求通过不代表文学质量、全产品长任务或长期额度验收。
- 根 AGENTS 所有交付闸门、知识库检查与 E2E；具体结果写入交付 PR，不以文档宣布未完成验证已通过。

## 官方依据

2026-10-10 核对：[App-server](https://learn.chatgpt.com/docs/app-server)、[认证](https://learn.chatgpt.com/docs/auth)、[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。托管 ChatGPT 登录仅用于受支持的本地/开源集成；商业托管产品应另行评估官方 Sign in with ChatGPT 接入，不复用本机桥作为云 API。
