# StoryForge Agent、MCP、双存储与右侧对话工作台设计

> 状态：待用户书面审阅
> 日期：2026-07-10
> 目标阶段：Phase 27.1 + 本地文件存储基础设施
> 适用形态：Web/PWA + Tauri 双形态

## 1. 背景

StoryForge 当前是 React + TypeScript + Zustand + Dexie 的纯前端 Web/PWA 应用。AI 调用以“面板按钮触发一次生成、在按钮附近显示文本、用户采纳”为主。项目已经通过三个注册表建立了 AI 数据治理基础：

1. `CONTEXT_SOURCES`：AI 读取什么；
2. `FIELD_REGISTRY + ADOPTION_SCHEMAS`：AI 可以写回什么；
3. `PROJECT_TABLES`：项目表的生命周期、导入导出和引用关系。

现有 `docs/AI-COPILOT-DESIGN.md` 已提出 ChatCopilot、Tool Registry、AgentRunner、后台 Agent 和多 Agent 方向，但尚未解决以下工程问题：

- 当前 `client.ts` 不解析 tool calls、reasoning 或多步骤事件；
- 现有 Phase 27 文档仍把部分 Agent 工具设计为直接读写 Zustand store，与 `CLAUDE.md` 的三注册表铁律冲突；
- 当前本地文件能力只是 Dexie 项目的 JSON 备份，不是可替换的存储后端；
- `PROJECT_TABLES` 直接持有 Dexie Table 实例，存储实现与业务注册表耦合；
- AI 运行状态仍被建模为一个持续增长的字符串；
- 工作区只有可选属性面板，没有统一的 Agent 对话、步骤、工具调用和审批工作台；
- 浏览器不能启动本地 stdio MCP，必须划分 Web 与 Tauri 的能力边界。

本设计把这些需求收敛为一套可渐进迁移、可测试且不破坏现有用户数据的架构。

## 2. 目标

### 2.1 产品目标

1. 用户可以在右侧常驻 AI 对话栏中用自然语言驱动世界观、角色、大纲、章节等工作流。
2. 现有面板中的 AI 按钮不再在按钮下方输出大段内容，而是向右侧 Agent 对话发送结构化任务。
3. UI 能展示 Agent 当前阶段、工具调用、工具结果摘要、写入审批和最终回复。
4. Web/PWA 与 Tauri 共用同一套 Agent、内部工具和领域规则。
5. Web/PWA 使用 Dexie 项目；Tauri 可以使用本地项目目录作为主存储。
6. Web 支持远程 HTTP/SSE MCP；Tauri 额外支持本地 stdio MCP。
7. 用户驱动的写入必须先显示可验证 diff，再经用户确认落库。
8. 后台 Agent 默认只读或只产生候选变更，不能静默修改用户手稿。

### 2.2 工程目标

1. Agent Runtime、MCP、存储实现都通过 StoryForge 自有端口隔离。
2. Agent 不得直接导入 Zustand store、Dexie `db` 或 Tauri 文件命令。
3. 内部工具由三注册表驱动，不建立第四份设定/字段/表事实源。
4. 同一项目同一时刻只有一个活动主存储后端。
5. Dexie、内存测试后端和本地文件后端遵守同一套 storage contract tests。
6. Agent 运行采用结构化事件流，支持停止、审批暂停、恢复、失败和重试。
7. 新架构可以先服务单 Agent MVP，后续再增加后台 Agent 和多 Agent 编排。

### 2.3 用户需求追踪

| 用户需求 | 设计落点 | 完成判断 |
|---|---|---|
| 通用 Agent 框架，支持 MCP 和工具调用 | §4、§5、§6、§9、§15 | AgentRuntimePort 跑通内部工具、远程 MCP 和 Tauri stdio MCP |
| 所有设定读取和修改统一包装为工具 | §4.4、§8、§16、§19 | Agent 层零 store/DB 直访，读写均可追踪到三注册表 |
| 本地文件存储和统一存储接口 | §10、§11、§17、§18、§20 | Dexie/File 通过同一 contract tests，项目使用单一活动 backend |
| 右侧 AI 对话框，展示阶段和工具调用 | §7、§13、§14 | AI 输出进入 Agent Dock，局部面板不再显示大段生成文本 |

## 3. 非目标

本阶段不做：

- NPC 全生命周期自动演进；
- 多个领域 Agent 的并行协作；
- 云端同步或多人实时协作；
- 在 Web 环境启动本地进程；
- 将所有 39+ 张表一次性重写；
- 把所有手动 UI 操作改成 Agent 工具；
- 展示模型隐藏的原始 chain-of-thought；
- 在不支持原生 tool calling 的模型上静默模拟并执行写工具；
- Dexie 与本地文件的长期双向实时双写。

## 4. 核心决策

### 4.1 Agent Runtime

采用 AI SDK 当前 Agent 抽象作为第一实现，并在外层定义 StoryForge 自有 `AgentRuntimePort`。

选择依据：

- TypeScript/React 适配度高；
- 支持多提供商与 OpenAI-compatible endpoint；
- 支持工具循环、动态工具、MCP 和 UI 消息 parts；
- 更容易将工具调用、审批和 reasoning summary 映射到 React UI；
- 可在 Web 运行，并可通过 Tauri transport 扩展桌面能力。

不得让组件或领域代码直接依赖 AI SDK 的消息结构。未来如需替换为 OpenAI Agents SDK 或 LangGraph，只新增 `AgentRuntimePort` 实现。

官方参考：

- https://ai-sdk.dev/docs/agents/overview
- https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools
- https://ai-sdk.dev/providers/openai-compatible-providers
- https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage
- https://openai.github.io/openai-agents-js/
- https://docs.langchain.com/oss/javascript/langchain/agents

### 4.2 双运行形态

- Web/PWA：浏览器运行 Agent，项目主存储为 Dexie，只连接远程 HTTP/SSE MCP。
- Tauri：WebView 运行相同 Agent 应用层；项目可使用本地文件主存储，并通过 Tauri bridge/sidecar 支持 stdio MCP。

第一阶段不要求 Web 与 Tauri 同时打开同一项目并实时同步。

### 4.3 单一活动存储后端

每个项目通过 `ProjectLocator` 指定主存储：

```ts
export type ProjectLocator =
  | {
      backend: 'dexie'
      projectId: number
    }
  | {
      backend: 'local-folder'
      projectUuid: string
      projectPath: string
    }
```

项目运行期间，全部读写只进入 locator 指定的 backend。迁移是显式、可回滚的离线转换流程，不是双写。

### 4.4 三注册表仍是业务宪法

内部工具必须沿用：

- 读取：`CONTEXT_SOURCES + assembleContext()`；
- 写入：`FIELD_REGISTRY + ADOPTION_SCHEMAS + planAdoption()/commitAdoption()`；
- 生命周期与文件映射：`PROJECT_TABLES`。

Tool Registry 只登记执行契约、风险、权限、输入 schema 和展示摘要，不复制字段、表或上下文源定义。

### 4.5 写入分为计划与提交

现有 `adopt()` 拆为：

```ts
planAdoption(input): Promise<AdoptionPlan>
commitAdoption(plan): Promise<AdoptResult>
```

`planAdoption()` 完成归一、别名映射、类型校验、FK 校验、去重定位、自动盖章预计算和 diff 生成，但不写入。

`commitAdoption()` 只能提交未过期、未被篡改且已通过审批的计划，并在存储事务中复核目标 revision。

### 4.6 不展示隐藏思维链

UI 中“思考”表示：

- Agent 阶段；
- 模型明确返回的 reasoning summary；
- 工具调用状态；
- 规划摘要；
- 校验与冲突摘要。

不展示或持久化模型隐藏的原始 chain-of-thought。

## 5. 总体架构

```text
React Workspace
  └─ AgentDock / ToolTimeline / ApprovalCard
       └─ Agent Application Layer
            ├─ ConversationService
            ├─ AgentRunService
            ├─ ApprovalService
            └─ AgentRuntimePort
                 └─ AiSdkAgentRuntime
                      └─ UnifiedToolRegistry
                           ├─ StoryForge Internal Tools
                           │    ├─ ContextReadService
                           │    ├─ AdoptionService
                           │    ├─ SearchService
                           │    └─ DeterministicValidators
                           └─ MCP Tool Provider
                                ├─ HTTP/SSE Transport
                                └─ Tauri stdio Transport

Domain Services
  └─ ProjectStoragePort
       ├─ DexieStorageAdapter
       ├─ MemoryStorageAdapter
       └─ FileProjectStorageAdapter
```

## 6. Agent Runtime 端口

```ts
export interface AgentRuntimePort {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>

  resume(
    runId: string,
    decision?: ApprovalDecision,
  ): AsyncIterable<AgentEvent>

  cancel(runId: string): Promise<void>
}
```

```ts
export interface AgentRunInput {
  conversationId: string
  project: ProjectLocator
  scope: AgentScope
  userMessage: string
  preferredAgent?: string
  modelProfile?: string
  maxSteps?: number
  tokenBudget?: number
}
```

```ts
export interface AgentScope {
  projectId?: number
  projectUuid?: string
  worldGroupId?: number | null
  outlineNodeId?: number | null
  chapterId?: number | null
  module?: string
  entityId?: string | number | null
  selection?: {
    text: string
    from?: number
    to?: number
  }
}
```

Runtime 必须提供：

- 最大步骤数；
- token/成本预算；
- `AbortSignal`；
- 工具超时；
- 重复调用检测；
- 工具输出长度限制；
- provider capability 检查；
- 审批暂停和恢复；
- 每一步审计事件；
- 失败时保留已完成步骤，不重复执行已提交写入。

## 7. Agent 事件模型

```ts
export type AgentEvent =
  | RunStartedEvent
  | PhaseStartedEvent
  | PhaseCompletedEvent
  | ReasoningSummaryDeltaEvent
  | ReasoningSummaryEvent
  | MessageDeltaEvent
  | MessageCompletedEvent
  | ToolRequestedEvent
  | ToolStartedEvent
  | ToolProgressEvent
  | ToolCompletedEvent
  | ToolFailedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunCancelledEvent
```

所有事件具有：

```ts
interface BaseAgentEvent {
  id: string
  runId: string
  conversationId: string
  sequence: number
  timestamp: number
}
```

事件追加后不可原地修改。UI、最终消息和运行摘要均由事件投影得到。

### 7.1 事件顺序保证

- 同一 `runId` 的 `sequence` 单调递增；
- `ToolCompleted`/`ToolFailed` 必须对应先前的 `ToolStarted`；
- `ApprovalResolved` 必须对应未解决的 `ApprovalRequested`；
- `RunCompleted`、`RunFailed`、`RunCancelled` 为终态；
- 终态后拒绝追加执行事件，仅允许追加审计注释。

## 8. 内部工具设计

### 8.1 工具契约

```ts
export interface StoryForgeTool<Input, Output> {
  name: string
  title: string
  description: string
  inputSchema: unknown

  risk: 'read' | 'generate' | 'write' | 'destructive' | 'external'
  availability: 'web' | 'desktop' | 'both'
  requiredScopes: ToolScope[]

  execute(
    context: ToolExecutionContext,
    input: Input,
  ): Promise<Output>

  summarizeInput?(input: Input): string
  summarizeOutput?(output: Output): string
}
```

### 8.2 第一批工具

#### 读取

- `storyforge.project.inspect`
- `storyforge.context.read`
- `storyforge.settings.schema`
- `storyforge.settings.search`
- `storyforge.record.get`
- `storyforge.record.list`
- `storyforge.validator.run`

#### 写入审批

- `storyforge.change.propose`
- `storyforge.change.commit`
- `storyforge.change.reject`
- `storyforge.change.undo`

### 8.3 上下文读取

MVP 中 `storyforge.context.read` 直接调用 `assembleContext()`，返回：

```ts
interface ContextReadResult {
  text: string
  included: string[]
  omitted: string[]
  trimmed: string[]
  totalInputTokens: number
  inputBudget: number
}
```

后续可将 `ContextSource` 从“直接生成文本”升级为“加载结构化 payload + renderer”，但这不是 Agent MVP 的前置条件。

### 8.4 写入审批

`storyforge.change.propose` 返回：

```ts
interface AdoptionPlan {
  id: string
  projectLocator: ProjectLocator
  baseRevision: string
  createdAt: number
  expiresAt: number

  target: string
  mode: AdoptInput['mode']
  normalizedData: Record<string, unknown>[]
  diffs: AdoptionDiff[]

  aliasMapped: { from: string; to: string }[]
  unknown: string[]
  typeErrors: { field: string; expected: string; got: string }[]
  fkErrors: { field: string; refValue: unknown }[]
  skipped: { reason: string; data: unknown }[]

  risk: 'write' | 'destructive'
}
```

提交前必须再次检查：

- plan 未过期；
- 当前项目 locator 与 plan 一致；
- `baseRevision` 未变化；
- 用户审批内容 hash 与 plan 一致；
- 当前 Agent 具有相应 scope；
- deterministic validator 没有新增阻断错误。

## 9. MCP 架构

### 9.1 能力矩阵

| 能力 | Web/PWA | Tauri |
|---|---:|---:|
| 内置 StoryForge 工具 | 是 | 是 |
| Streamable HTTP MCP | 是 | 是 |
| SSE MCP | 是 | 是 |
| stdio MCP | 否 | 是 |
| 启动本地 sidecar | 否 | 是 |
| 任意本地文件访问 | 否 | 否，必须经过目录授权 |

### 9.2 MCP transport 端口

```ts
export interface McpTransportPort {
  connect(config: McpServerConfig): Promise<McpConnection>
  disconnect(serverId: string): Promise<void>
}
```

```ts
export interface McpServerConfig {
  id: string
  name: string
  enabled: boolean
  transport: 'streamable-http' | 'sse' | 'stdio'

  url?: string
  command?: string
  args?: string[]
  environmentRefs?: string[]

  enabledTools?: string[]
  blockedTools?: string[]
  approvalPolicy: 'always' | 'writes-only' | 'never'
  allowedRoots?: string[]
  timeoutMs: number
}
```

### 9.3 MCP 安全策略

1. MCP 工具统一命名为 `mcp.<serverId>.<toolName>`。
2. stdio MCP 只允许 Tauri 已登记的 server 配置启动。
3. 命令、参数和环境变量不接受 Agent 临时构造。
4. `allowedRoots` 必须收敛到项目目录或用户明确授权的目录。
5. destructive 工具每次审批。
6. 后台 Agent 不注册 write/destructive MCP 工具。
7. MCP secrets 保存在设备级安全存储，不进入项目导出。
8. 工具输出超限时写入临时 artifact，向模型返回摘要和引用。
9. 工具必须支持 timeout 和 cancel；取消 run 时终止对应 sidecar 请求。
10. MCP 工具描述属于不可信外部输入，不得覆盖系统策略和工具权限。

Tauri sidecar 官方参考：

- https://v2.tauri.app/develop/sidecar/
- https://v2.tauri.app/plugin/shell/

## 10. 存储抽象

### 10.1 ProjectStoragePort

```ts
export interface ProjectStoragePort {
  readonly locator: ProjectLocator
  readonly capabilities: StorageCapabilities

  transaction<T>(
    mode: 'readonly' | 'readwrite',
    tables: string[],
    work: (tx: StorageTransaction) => Promise<T>,
  ): Promise<T>

  table<T>(name: string): StorageTable<T>
  getRevision(): Promise<string>
  flush(): Promise<void>
  close(): Promise<void>
  watch?(listener: StorageChangeListener): () => void
}
```

```ts
export interface StorageTable<T> {
  get(id: number): Promise<T | undefined>
  list(query?: StorageQuery): Promise<T[]>
  findOne(query: StorageQuery): Promise<T | undefined>

  add(record: T): Promise<number>
  put(record: T): Promise<number>
  update(id: number, patch: Partial<T>): Promise<void>
  delete(id: number): Promise<void>

  bulkPut(records: T[]): Promise<void>
  bulkDelete(ids: number[]): Promise<void>
}
```

`StorageQuery` 只包含项目实际使用并可由所有后端一致实现的能力：

- equality filters；
- `in` filters；
- world/project scope；
- orderBy；
- offset/limit；
- 指定的复合 identity。

不暴露 Dexie collection/query builder。

### 10.2 PROJECT_TABLES 去 Dexie 化

当前：

```ts
{
  table: db.worldviews,
  name: 'worldviews',
}
```

目标：

```ts
{
  name: 'worldviews',
  owner: 'project',
  worldScoped: true,
  exportable: true,
  persistence: {
    kind: 'singleton-json',
    path: 'settings/worldviews',
  },
}
```

Dexie adapter 用 `name` 映射 Dexie Table；文件 adapter 用 `persistence` 解析文件路径和 codec。

### 10.3 Backend 选择

```ts
export interface StorageManager {
  open(locator: ProjectLocator): Promise<ProjectStoragePort>
  migrate(
    source: ProjectLocator,
    target: ProjectLocator,
    options: StorageMigrationOptions,
  ): Promise<StorageMigrationReport>
}
```

项目切换时：

1. 关闭旧 backend；
2. 清理项目级 Zustand state；
3. 打开新 backend；
4. 验证 schemaVersion 和 registry coverage；
5. 加载项目；
6. 启动 watcher/backup；
7. 向 Agent Runtime 更新当前 locator。

## 11. 本地项目目录

```text
小说项目/
├─ storyforge.project.json
├─ content/
│  ├─ chapters/
│  │  ├─ 000001-第一章.md
│  │  └─ 000002-第二章.md
│  └─ outlines/
│     ├─ tree.json
│     └─ detailed/
├─ settings/
│  ├─ worldview/
│  ├─ story-core.json
│  ├─ power-system/
│  └─ world-rules/
├─ entities/
│  ├─ characters/
│  ├─ locations/
│  ├─ codex/
│  └─ items/
├─ assets/
└─ .storyforge/
   ├─ manifest.json
   ├─ sequences.json
   ├─ tables/
   ├─ agent/
   │  ├─ conversations/
   │  ├─ runs/
   │  └─ pending-actions/
   ├─ journal/
   ├─ index/
   └─ cache/
```

### 11.1 文件可见性

- 正文、大纲和主要设定使用可读 Markdown/JSON；
- 内部索引、Agent 事件、运行审计、事务 journal 和缓存放在 `.storyforge`；
- API Key、MCP secrets、设备身份不进入项目目录；
- 文件名包含稳定数字 ID，标题变化不改变记录 identity；
- `storyforge.project.json` 保存项目 UUID、schemaVersion、显示名和创建时间；
- `.storyforge/manifest.json` 保存每个文件的逻辑表、记录 ID、revision 和 hash；
- 每条记录只能有一个权威表示：具有可见 Markdown/JSON codec 的表不再在 `.storyforge/tables` 保存第二份镜像；`.storyforge/tables` 仅存放没有用户可见 codec 的内部表。

### 11.2 原子写入与多文件事务

单文件写入采用 QMAI 同类策略：

1. 同目录写临时文件；
2. flush/fsync；
3. 通过平台安全的 replace 操作替换正式文件；Windows 实现必须处理目标已存在时的替换语义，不能假定普通 rename 在所有平台行为一致。

多文件事务采用 journal：

1. 创建 `journal/<txId>/manifest.json`；
2. 写所有临时文件；
3. 写 `prepared` marker；
4. 依次原子替换目标；
5. 写 `committed` marker；
6. 更新项目 revision；
7. 删除 journal。

项目打开时恢复：

- 无 `prepared`：删除未完成临时文件；
- 有 `prepared` 无 `committed`：依据 manifest 完成或回滚；
- 有 `committed`：完成清理；
- hash 与 manifest 冲突：停止自动写入并提示用户选择版本。

### 11.3 外部编辑冲突

Tauri watcher 发现文件变化时：

- 当前无未保存本地修改：重载对应记录；
- 有未保存修改且 base revision 相同：尝试字段级合并；
- revision 已变化：生成冲突卡片，不自动覆盖；
- Agent 正在基于旧 revision 运行：允许读步骤结束，但写入计划在提交时失效。

## 12. Agent 数据

新增逻辑表：

- `agentConversations`
- `agentMessages`
- `agentRuns`
- `agentEvents`
- `agentPendingActions`

全部登记到 `PROJECT_TABLES`，明确 export policy：

| 表 | 项目删除 | 标准导出 | 审计导出 |
|---|---:|---:|---:|
| agentConversations | 删除 | 可选 | 是 |
| agentMessages | 删除 | 可选 | 是 |
| agentRuns | 删除 | 否 | 是 |
| agentEvents | 删除 | 否 | 是 |
| agentPendingActions | 删除 | 否 | 否 |

设备级数据不进入 `PROJECT_TABLES`：

- API Key；
- MCP secrets；
- stdio command allowlist；
- 窗口布局偏好；
- 最近打开项目 locator。

## 13. 右侧 Agent Dock

### 13.1 Workspace 布局

当前右侧 `PropertiesPanel` 升级为可调整宽度的 Dock：

```text
左侧导航 | 主工作区 | 右侧 Dock
                       ├─ AI 副驾
                       └─ 属性
```

MVP 约束：

- 默认宽度 420px；
- 最小 340px；
- 最大为主窗口宽度的 45%；
- 可收起；
- `AI 副驾` 和 `属性` 使用 tab 切换；
- 暂不实现独立浮动窗口。

### 13.2 Agent Dock 组成

1. 顶部作用域：项目、世界、章节、选区；
2. 会话选择器；
3. Agent/模型 profile；
4. 消息列表；
5. 阶段时间线；
6. 工具调用卡片；
7. reasoning summary 折叠块；
8. 写入审批卡；
9. 引用/附件/作用域入口；
10. 输入框；
11. 发送、停止、重试按钮；
12. token/成本摘要。

### 13.3 工具调用卡片

显示：

- 工具标题和命名空间；
- read/write/external 风险徽标；
- 输入摘要；
- 当前状态；
- 耗时；
- 输出摘要；
- 错误和可重试状态；
- “查看详情”；
- MCP server 来源。

默认不展示完整上下文、完整工具原始输出或 secrets。

### 13.4 审批卡

必须显示：

- 目标表/字段；
- 作用域；
- 旧值；
- 新值；
- alias 映射；
- FK/类型告警；
- deterministic validator 结果；
- 受影响记录数；
- `采纳`、`编辑后采纳`、`拒绝`。

批量审批只允许同一风险等级、同一 Agent run、同一项目 revision 的计划合并。

## 14. 现有 AI 按钮迁移

当前：

```text
按钮 → useAIStream → 局部 output → 局部采纳
```

目标：

```text
按钮 → dispatchAgentIntent → 打开 AgentDock
     → Agent tool loop → 审批卡 → commit
     → Zustand/订阅刷新面板
```

```ts
export interface AgentIntent {
  type: string
  source: {
    module: string
    project: ProjectLocator
    worldGroupId?: number | null
    chapterId?: number | null
    entityId?: number | string | null
    field?: string
  }
  instruction?: string
  attachments?: AgentAttachment[]
}
```

面板保留：

- Agent 按钮；
- 运行状态小圆点；
- “在 AI 副驾中查看”；
- 成功写入后的字段内容。

面板删除：

- 大段局部 streaming output；
- 局部工具步骤；
- 局部 Agent 错误详情；
- 与右侧对话重复的采纳卡。

## 15. Provider 能力策略

维护 capability registry：

```ts
interface ModelCapabilities {
  nativeTools: boolean
  parallelToolCalls: boolean
  reasoningSummary: boolean
  streamingToolCalls: boolean
  structuredOutput: boolean
  maxToolSchemaBytes?: number
}
```

策略：

- 支持 native tools：启用完整 Agent；
- 只支持结构化输出：允许受控的只读单步操作，不执行写入；
- 不支持 tools：普通对话/旧生成路径；
- 无法确认 capability：默认关闭写工具；
- provider 返回异常 tool call：严格 schema 校验后作为失败事件，不猜测补全参数。

## 16. 前台与后台 Agent 安全线

### 16.1 用户驱动 Agent

- 可以注册 read/generate/write 工具；
- write 只产生 approval；
- 用户批准后 commit；
- 可以在当前会话临时信任特定低风险操作，但不能跨会话默认永久信任 destructive 操作。

### 16.2 后台 Agent

- 默认只注册 read、validator 和 propose 工具；
- 不注册 commit 工具；
- 结果以提醒、报告或 pending candidate 进入 Agent Dock；
- 用户打开候选后再批准；
- 不得静默改正文、设定、角色状态或项目文件。

## 17. 渐进实施顺序

### Phase 0：规格、ADR 与架构门

- 修正 `AI-COPILOT-DESIGN.md` 中直接读写 store 的描述；
- ADR：Agent Runtime；
- ADR：双存储后端；
- ADR：MCP 安全；
- 定义 AgentEvent、Tool、StoragePort；
- 新增 architecture rule，禁止 Agent 层导入 `db/schema` 和 Zustand store。

### Phase 1：存储端口垂直切片

选择：

- `worldviews`：世界级单例；
- `characters`：普通集合；
- `chapters`：大文本和 FK。

完成：

- `ProjectStoragePort`；
- `MemoryStorageAdapter`；
- `DexieStorageAdapter`；
- `PROJECT_TABLES` 去 Dexie 化的最小切片；
- storage contract tests；
- 原行为回归。

### Phase 2：内部工具层

完成：

- 第一批读工具；
- `planAdoption()/commitAdoption()`；
- approval persistence；
- tool policy；
- schema snapshot tests；
- Agent 工具层零直接 DB/store 访问。

### Phase 3：单 Agent Runtime

完成：

- AI SDK runtime adapter；
- tool loop；
- AgentEvent stream；
- cancel/retry/timeout；
- provider capability；
- HTTP/SSE MCP；
- 世界观字段端到端闭环。

### Phase 4：Agent Dock

完成：

- 右侧 Dock；
- 对话、步骤、工具卡、reasoning summary；
- approval card；
- conversation/run persistence；
- 面板同步；
- 第一批 AI 按钮迁移。

### Phase 5：Tauri 与本地文件后端

完成：

- Tauri 壳；
- Tauri 文件命令；
- `FileProjectStorageAdapter`；
- atomic write + journal；
- watcher/conflict；
- Dexie → 文件项目迁移；
- 文件项目 → Dexie 导入；
- stdio MCP transport。

本阶段的 File adapter 只在 contract tests、测试项目和开发者开关下运行。不得把同一真实项目拆成“部分表走文件、其余表走 Dexie”的混合 backend，也不得在全表覆盖前向普通用户开放本地项目主存储。

### Phase 6：存储全覆盖

- 迁移剩余直接 `db.*`；
- 所有 `PROJECT_TABLES` 通过双后端 contract tests；
- architecture gate 禁止新直接 DB 访问；
- Tauri 本地项目进入稳定可用状态。

### Phase 7：全部 AI 入口迁移

按模块逐步迁移世界观、角色、大纲、细纲、正文、伏笔、历史、状态卡、物品、场景考证、灵感反推和审稿。

### Phase 8：后台与多 Agent

先整理本章 Agent，再一致性后台 Agent，最后 supervisor + 领域 Agent 和 NPC 演进。

## 18. 测试与验证

### 18.1 存储 contract tests

同一组测试运行于 Memory、Dexie、File：

- CRUD；
- identity/duplicate policy；
- project/world scope；
- transaction rollback；
- bulk operations；
- revision；
- FK；
- lifecycle；
- export/import roundtrip；
- schema migration。

### 18.2 文件存储

- 单文件中断不产生半文件；
- 多文件事务中断可恢复；
- journal 重放幂等；
- 外部修改触发 watcher；
- 冲突不静默覆盖；
- 中文路径、长路径、非法文件名；
- 大章节性能；
- 目录缺失自修复；
- 不将 secrets 写入项目。

### 18.3 Agent 工具

- 每个读取工具可追踪至 `CONTEXT_SOURCES`；
- 每个写字段可追踪至 `FIELD_REGISTRY`；
- 集合写入可追踪至 `ADOPTION_SCHEMAS`；
- 新表可追踪至 `PROJECT_TABLES`；
- 未批准不能 commit；
- 过期 plan 不能 commit；
- revision 变化使 plan 失效；
- 后台 Agent 无 commit 工具；
- Agent 代码零 `db.*` 和 store 直接访问。

### 18.4 MCP

- Web 拒绝 stdio；
- Tauri stdio 只能访问允许目录；
- timeout/cancel 终止调用；
- destructive 工具强制确认；
- 动态工具加载不绕过 allowlist；
- 恶意工具描述不能改变系统策略；
- secrets 不进入事件和导出；
- 超长结果被截断并转 artifact。

### 18.5 UI

- Agent 事件顺序正确；
- 切换面板不丢 run；
- 刷新后恢复 conversation；
- 审批暂停后可恢复；
- stop 后旧请求不能覆盖新状态；
- tool card 状态完整；
- 面板按钮下不再出现大段生成文本；
- commit 后面板实时刷新；
- Dock 缩放和收起不破坏主编辑区。

## 19. 架构门

新增静态规则：

1. `src/lib/agent/**` 禁止导入 `src/lib/db/schema`；
2. `src/lib/agent/**` 禁止导入 `src/stores/**`；
3. 除 Dexie adapter、schema migration、数据库测试外，新增代码禁止导入 `db/schema`；
4. Agent 内部写入只能导入 AdoptionService；
5. Agent 内部读取只能导入 ContextReadService/注册表服务；
6. Tauri 命令不能直接理解 StoryForge 业务字段，只提供文件、watch、sidecar 等基础能力；
7. MCP 工具不能获得未声明的存储或目录权限。

## 20. 迁移和回滚

### 20.1 Dexie 到本地项目

1. 对源项目执行 registry export；
2. 生成 migration plan；
3. 写入临时目标目录；
4. 用 File adapter 重新打开；
5. 执行全表 coverage、FK、hash 和多世界检查；
6. 原子重命名为正式目录；
7. 记录新 locator；
8. 用户确认后切换；
9. 原 Dexie 项目默认保留。

### 20.2 本地项目到 Dexie

走现有 registry import 语义，通过 Dexie adapter 创建新项目，不覆盖已有项目。

### 20.3 Agent 回滚

- 未 commit：删除 pending plan；
- 已 commit 且支持 inverse patch：`change.undo`；
- destructive 或跨多表写入：创建自动 snapshot，undo 恢复 snapshot；
- 后台 Agent 从不自动 commit，因此不需要自动回滚用户稿件。

## 21. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 大量直接 DB 调用造成大爆炸重构 | 垂直切片、storage contract、架构门，禁止新增债务 |
| Dexie 和文件形成第二真相 | 单一活动 backend，迁移而非双写 |
| AI SDK/MCP API 演进 | AgentRuntimePort/McpTransportPort 隔离 |
| provider tool calling 不一致 | capability registry，不确定时关闭写工具 |
| Agent 改错数据 | plan → validator → approval → commit |
| 本地 MCP 权限过大 | allowlist、allowedRoots、destructive 审批 |
| 外部文件编辑冲突 | revision/hash/watcher/conflict card |
| 多 Agent token 成本失控 | 单 Agent MVP，按需加载领域 Agent，硬预算 |
| 原始思维链泄漏 | 只展示阶段和 reasoning summary |
| 文件事务损坏项目 | atomic write、journal、启动恢复、快照 |

## 22. 成功判据

### Agent MVP

- 用户能在右侧对话中完成“读取当前世界观 → 生成候选 → 查看工具步骤 → 审批 → 写入 → 面板刷新”；
- Agent 路径不直接访问 store/DB；
- 停止和失败不会重复提交写入；
- Web 上至少两个支持 tools 的 provider 跑通。

### MCP MVP

- Web 成功连接一个远程只读 MCP；
- Tauri 成功连接一个 stdio MCP；
- 工具 allowlist、timeout、cancel、审批和审计生效。

### 文件后端垂直切片

- worldviews/characters/chapters 在独立测试项目中通过 File adapter contract tests；
- 原子写入和崩溃恢复测试通过；
- 此时不开放真实用户项目的混合存储模式。

### 本地存储正式可用

- 所有 required/project lifecycle tables 均有文件 codec 或明确的内部表 codec；
- Tauri 可以新建完整本地项目；
- Dexie 项目能迁移到本地目录并无损回读；
- 迁移后项目只使用 File backend，不继续双写 Dexie。

### 全量完成

- 所有 `PROJECT_TABLES` 在 Dexie/File 两后端通过 contract tests；
- 普通业务代码不再新增直接 `db.*`；
- 所有主要 AI 按钮都将结果发送到 Agent Dock；
- 后台 Agent 默认无 commit 权限；
- 现有 Web 用户无需迁移即可继续使用。

## 23. 待后续 ADR 固化的决策

本设计批准后，应分别创建 ADR：

1. Agent Runtime 采用 AI SDK adapter；
2. 项目采用单一活动存储 backend；
3. `PROJECT_TABLES` 从 Dexie 实例解耦；
4. 本地文件多文件事务采用 journal；
5. Web/Tauri MCP 能力边界；
6. Agent 写入采用 plan/approval/commit；
7. Agent UI 只显示 reasoning summary，不显示隐藏 chain-of-thought。

这些 ADR 只固化已批准设计，不在 ADR 阶段重新扩大功能范围。