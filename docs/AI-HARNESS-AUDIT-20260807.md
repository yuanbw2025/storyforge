# StoryForge 分步骤创作 AI Harness 现状审计与架构设计

> 审计日期：2026-08-07
> 审计分支：`feat/harness-audit-20260807`
> 审计基线：`774a2ae feat(WORLD-2): close executable world foundation through 2F`
> 范围：仅分步骤创作模式；世界引擎运行时体验不在本轮范围。
> 状态：第一阶段设计成果；不等同于已实现的目标 Harness。
> 目标全流程设计：[AI-HARNESS-FULL-FLOW-DESIGN-20260807](./AI-HARNESS-FULL-FLOW-DESIGN-20260807.md)。

## 0. 任务理解与审计结论

本轮工作的目标不是增加 Agent 数量或堆叠更长提示词，而是确认分步骤创作从世界观、故事核心、角色/物品、主线/支线、卷纲、章纲、细纲到正文的真实读写链路，识别哪些质量能力确实在主路径生效，哪些只是模块、文档或 UI 存在，并据此设计可恢复、可核查、可持续评测的 Agent + Harness。

严格边界如下：

- 保留现有分步骤模式和默认一键创作路径，不删除、架空或替换现有功能。
- 不修复世界引擎 `WORLD-2C C3-C5 → WORLD-2F` 的体验问题，也不把世界状态机引入本轮主流程。
- 所有后续实现必须继续遵守三个单一事实源：`CONTEXT_SOURCES + assembleContext()`、`FIELD_REGISTRY + AdoptionSchema + adopt()`、`PROJECT_TABLES`。
- 研究文档中的 Harness、durable run、receipt、验证器等均是目标提案；只有代码和测试能证明当前能力。

### 0.1 基线与研究材料

事实：工作树干净，`HEAD` 为 `774a2ae`；该提交存在于 `feat/world-2c-ownership-adr`、`origin/feat/world-2c-ownership-adr` 和当前审计分支，尚未被 `origin/main`（当前为 `3b434ae`）包含。因此本审计不修改或推送 `main`。

研究材料通过 KDocs/WPS 定位并核对了文件名、分享链接和仓库镜像；KDocs 对云端 `.md` 直接 `read-file` 返回“需先转智能文档或下载原文”，因此可读取正文的仓库镜像作为逐行证据，KDocs 文件作为来源索引：

| 研究主题 | KDocs 来源 | 仓库镜像/用途 |
|---|---|---|
| AI Harness 架构 | [AI-HARNESS-ARCHITECTURE-20260803](https://www.kdocs.cn/l/cbJgMzoS1dvF) | `docs/AI-HARNESS-ARCHITECTURE-20260803.md`；目标提案，不是实现证明 |
| 长期一致性 | [长期一致性研究](https://www.kdocs.cn/l/cfPWqPtTviTM) | 用于核对 NS-0~NS-6 的目标和证据边界 |
| 生成逻辑 | [生成逻辑研究](https://www.kdocs.cn/l/cdyxyb3kpotl) | 用于核对分阶段创作与产物契约方向 |
| 收敛路线 | [收敛路线](https://www.kdocs.cn/l/cpSeGWrxthCB) | 用于核对质量工程分期，不作为当前代码事实 |
| 上下文路由 | [上下文路由研究](https://www.kdocs.cn/l/cjSkYZLDNONi) | 与 `CONTEXT_SOURCES`/预算治理交叉核对 |

外部技术结论只采用研究文档中可追溯的官方来源或源码契约：Anthropic 的 [Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)、[A harness for every task](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)、OpenAI 的 [Harness Engineering](https://openai.com/zh-Hans-CN/index/harness-engineering/)，以及 Kimi K3 官方仓库/技术报告。它们支持“契约、状态、验证、观测和按任务选择工作流”的设计原则，不证明 StoryForge 已具备这些能力。

### 0.2 结论先行

1. **数据和单轮生成治理已有较强地基，但没有形成分步骤主 run 的统一控制面。** `CONTEXT_SOURCES`、`assembleContext()`、`FIELD_REGISTRY`、`AdoptionSchema`、`adopt()` 和 `PROJECT_TABLES` 均存在，且有注册表、作用域、CAS、导入导出和反例测试。
2. **主路径接入不一致。** 卷纲/章纲、部分细纲和正文已经使用 `assembleContext()` 与 `GenerationNode`；世界观、故事核心仍有组件级手工上下文；故事线 AI 生成明确绕过 `adopt()`；普通角色入口与更强的 Character Copilot 并存。
3. **`GenerationNode` 不是 durable Harness。** 它冻结一次请求内的消息，支持 gate 和显式 adopt，但没有持久的 run/step/attempt/checkpoint、统一终态 verifier、fresh receipt、Context Manifest 或跨刷新恢复。
4. **长期一致性能力是“模块闭环”，不是“创作主流程闭环”。** NS-0~NS-6、事实/认知/物品/检索/摘要/stale/影响分析和一致性 Agent 有独立测试，但正文接受后的检索、状态提取、记忆和审查是 best-effort 异步任务，没有统一的完成判定和恢复协议。
5. **质量不稳定的主要推断根因是接入断裂和证据断裂，而不是单纯缺少记忆模块。** 该推断由下文逐条代码、测试和调用路径支持，仍需通过后续主流程 held-out 评测验证。

> 2026-08-09 更新：本审计记录的是改造前基线。HARNESS-30 已修复下文指出的故事线 AI 直接写入旁路：
> 产品入口现路由到 `outline.story-arcs`，读取经 `assembleContext()`，候选进入 durable Run，作者确认后只经
> `adopt(target=storyArcs)` 写入；旧 adapter 已删除，人工 CRUD 保留。其余审计结论不因该单元自动失效。

## 1. 审计方法与证据等级

每个结论分为：

- **事实**：可由当前 commit 的源码、测试或运行路径直接复核。
- **推断**：由多个事实解释质量或可靠性问题，必须在后续评测中证伪/证实。
- **建议**：目标架构或实施决策，不描述当前已拥有的能力。

审计闭包按“入口 → 读取 → 生成/解析 → 校验 → 写回 → 失败/恢复 → 反哺 → 日志/评测/回放 → 测试”建立；不把 UI 有按钮或文档有标题当作主路径证据。

## 2. 三个单一事实源审计

### 2.1 上下文读取

**事实：** `src/lib/registry/context-sources.ts` 登记了世界观、故事核心、角色、故事线、章纲、细纲、事实、认知、物品、摘要、检索、规则等来源；`src/lib/registry/assemble-context.ts:35-71` 按显式 `sourceKeys`、作用域、源要求和预算装配，返回 `included/omitted/trimmed/totalInputTokens/inputBudget`。

**限制：** `assembleContext()` 的单源超预算路径仍可使用字符级 `slice()`；结果不是带 source hash、边界版本、run/step/attempt 标识的持久 Context Manifest。`ChapterEditor.tsx:570` 的日志只写控制台，刷新后没有运行证据。

### 2.2 AI 写回

**事实：** `FIELD_REGISTRY`、`ADOPTION_SCHEMAS` 和 `adopt()` 提供字段白名单、结构化校验、CAS/作用域检查和作者确认后的写回。`GenerationNode` 的接口注释也明确要求 `assembleInput` 复用 `assembleContext`，默认不自动 adopt（`src/lib/generation/generation-node.ts:15-30,75-120`）。

**审计时限制（已由 HARNESS-30 修复）：** 2026-08-07 的故事线 AI 生成曾调用 `addArc()`，而 `src/stores/story-arc.ts` 直接 `db.storyArcs.add()`；该主路径当时绕过了 `adopt()`。当前 AI 入口已改走 `outline.story-arcs` 候选与受治理采纳，store 直写只保留给明确的人工 CRUD。

### 2.3 数据生命周期

**事实：** `PROJECT_TABLES` 当前测试断言 66 张表（`tests/registry/project-tables.test.ts:23-33`），并派生世界作用域、项目作用域、删除事务、导出表和引用重映射；`agentConversations`、`agentEvents`、`nodeFlows`、`nodeRuns` 已登记（`src/lib/registry/project-tables.ts:437-481`）。

**测试证据：** `R-export-fullcoverage` 覆盖所有 exportable 表及双世界往返和外键重映射；`R-INV1-export-roundtrip` 覆盖角色引用 remap；注册表测试覆盖删除/导入事务派生。由此可证明生命周期治理存在，不能据此证明分步骤 Harness 已有 run ledger。

## 3. 分步骤创作功能清单与真实接入状态

状态定义：

- **A 主路径已使用**：入口在默认分步骤流程中调用该能力，并有路径证据。
- **B 已实现但未统一接入**：能力/Agent 有实现和测试，但默认入口仍有另一条路径。
- **C 仅文档或 UI**：没有可执行的生产闭环证据。
- **D 部分实现/旁路**：主路径有能力，但存在手工上下文、直接写库、异步无终态等缺口。
- **E 缺失**：当前没有足够的实现证据。

| 产物/能力 | 入口与事实 | 读/生成/写回证据 | 失败、反馈、观测 | 状态 |
|---|---|---|---|---|
| 世界观：起源/自然/人文 | `WorldviewOriginPanel.tsx`、`WorldviewNaturalPanel.tsx`、`WorldviewHumanityPanel.tsx` | 使用 `useAIStream`；保存 action 多数经 store `adopt()`，但各面板仍在组件内手拼并截断字段（起源 `:90-107`、自然 `:86-101`、人文 `:102-121`） | 神明信仰另起一次 `streamChat` 做 JSON 拆分，失败时把全文降级到 `divineRank`（起源 `:366-409`）；无统一 source manifest/终态回执 | D |
| 故事核心 | `StoryCorePanel.tsx` | `:72-85` 手工拼接 world view 并逐字段 `slice()`；`:184-200` 只装配 `historical` 后拼接；`:251-263` 接受纯文本后写 `saveStoryCore()` → `adopt()` | 有重试按钮，缺结构化 parser、语义冲突 gate、上下文快照和持久失败状态 | D |
| 角色普通生成 | `CharacterPanel.tsx` | `:120-160` 用 `assembleContext()`；`:298-327` 解析后 `adopt(target: 'characters')` | parser 失败可 fallback name/background，全文可作为 background；与 Copilot 的重复姓名、stale、事务 gate 不同 | D |
| 角色 Copilot | `src/lib/agent/character-copilot.ts` | 只读工具装配世界观/角色，冻结 roster snapshot，结构化候选，事务内重复/过期检查和 `adopt()`（`:327-386,397-410`） | 有 stale/duplicate 错误和回归测试，但没有证据表明普通分步骤角色按钮已切换到该路径 | B |
| 角色补全 | `CharacterSupplementAction.tsx` | `:49-85` 通过 `assembleContext()` 读取设定；可选读事实/正文证据；`adopt(recordId, merge-diffs)` | 解析空补丁直接返回；单任务可用，未纳入统一 run 恢复 | A（局部） |
| 主线/支线 | `StoryArcPanel.tsx` | `:82-109` 解析 `stages` 后调用 `addArc()`；adapter `:41-45` 手工 `slice(0,500)`；parser `:58-83` 仅检查 `name` 和数组 | `story-arc.ts:62-79` 直接 DB add/update；无结构 schema、阶段/因果/Canon gate | D（明确旁路） |
| 卷纲/章纲 | `OutlinePanel.tsx`、`useOutlineGenerationController.ts` | `:178-205` 显式 source keys；`GenerationNode` 负责 prepare/run；`adopt-generation.ts` 通过 `adopt()` 写 `outlineNodes` | 有预览、透明模式、取消、重试、JSON/重构/兜底解析和重复标题提示；没有 durable run/checkpoint/统一 terminal verifier | A（节点级） |
| 细纲/场景 | `DetailedOutlinePanel.tsx`、`ScenePanel.tsx` | `:124-139` 装配章纲/世界/角色/伏笔；增强细纲 `:181-214` 解析、过滤合法 ID、`adopt()`；场景采纳 `ScenePanel.tsx:75-83` | JSON 失败可 AI 重构；有 `lastUsedSummary` stale 提示；批量 `:233-260` 仅 UI 循环 + AbortController，无 durable attempt/checkpoint/resume | A（单次），D（批量） |
| 正文生成/续写 | `ChapterEditor.tsx` | `:524-568` 通过 `assembleContext()` 读取章纲、细纲、连续性、事实、认知、物品、检索、故事线等；`GenerationNode`/prose copilot 可生成候选 | 接受后先写正文，再异步检索块、摘要、状态提取、章节 memory（`:990-1044`）；大多数失败只日志/降级，无 run terminal receipt | A（生成），D（后处理） |
| 章节记忆/计划对账 | `run-chapter-memory.ts` | 正文 hash + 计划 hash CAS，解析失败不写回（`:22-78`） | 单调用有 stale 保护；不是跨步骤运行账本，不保证所有 post steps 完成 | A（独立任务），D（主流程收口） |
| 一致性 Agent | `consistency-agent.ts` | background Fast Guard 零 token；fast/deep 一次模型调用；结果写 `agentEvents`（`:275-311,332-405`） | 有正文 hash current 检查、持久候选和回归；未绑定分步骤主 run 的完成状态，也不自动编排上游修正 | B |
| 章节组织 Agent | `chapter-organization.ts` | 可将状态/认知/故事线/角色关系保存为候选事件，确认后 `adopt()` | 独立质量 workflow，不是正文生成必经阶段 | B |
| 反向反馈 | `impact-analysis.ts`、`R-downstream-reverse` | 正文编辑后 stale 事实、列出后续章节；`assembleContext` 可显式读下游角色/故事核心/故事线 | 只提示作者，不自动改正文或上游；无统一影响图、候选 patch、依赖重跑和回放证据 | D |
| Run ledger / receipt / replay | 现有 `agentConversations`/`agentEvents`、`nodeFlows`/`nodeRuns` | 对话、候选、自由节点可持久化；注册表已登记 | `GenerationNode` 是请求内运行时抽象；没有统一 step/attempt/checkpoint、Context Manifest、terminal verifier、fresh receipt | E |
| 离线评测 | `NS-0`、NS/AGENT/PIPELINE 回归 | 有 development/held-out fixture、预算、事实/约束/泄漏/证据指标 | 多数是模块级或 builder/eval 级；缺少真实分步骤从世界观到正文的端到端 held-out | B |

## 4. 现有分步骤链式流程（现状与新增能力同图）

下图中的实线是当前可执行路径；虚线是建议新增/调整的 Harness 控制面。新增节点不替换现有产物和默认快速入口，而是包住现有生成节点。

```mermaid
flowchart LR
  W[世界观\n起源/自然/人文] --> C[故事核心]
  C --> R[角色与物品]
  R --> A[主线/支线]
  A --> V[卷纲]
  V --> CH[章纲]
  CH --> D[细纲/场景]
  D --> P[正文]

  CTX[CONTEXT_SOURCES\nassembleContext] -.部分主路径已接入.-> W
  CTX -.部分主路径已接入.-> C
  CTX --> R
  CTX --> V
  CTX --> CH
  CTX --> D
  CTX --> P
  ADOPT[FIELD_REGISTRY\nAdoptionSchema + adopt] --> W
  ADOPT --> C
  ADOPT --> R
  ADOPT --> V
  ADOPT --> CH
  ADOPT --> D
  ADOPT --> P

  H[新增：RunContract\n目标/范围/验收/预算] -.包住每一步.-> W
  H -.-> C
  H -.-> R
  H -.-> A
  H -.-> V
  H -.-> CH
  H -.-> D
  H -.-> P
  M[新增：Context Manifest\nsource key/hash/预算/裁剪] -.记录.-> CTX
  G[新增：确定性终态 Verifier\n真实 DB 状态 + 依赖 + hash] -.签发 fresh receipt.-> ADOPT
  L[新增：Run ledger\nstep/attempt/checkpoint/retry] -.持久化证据.-> H
  OBS[新增：trace/指标/回放/评测] -.观测.-> L
```

### 4.1 新增/调整节点的工程契约

| 新增/调整 | 要做什么 | 解决什么问题 | 输入 | 输出 | 负责方 | 生效验证 |
|---|---|---|---|---|---|---|
| `RunContract` | 为一次分步骤创作声明目标产物、范围、依赖、预算、允许写入、验收器、重试和人工确认点 | 防止“模型返回 final 就算完成”、防目标漂移 | 项目/世界/作品作用域、step graph、用户请求、基线 hash | 不可变 contract + `runId` | Harness 控制面 | contract schema 反例；拒绝缺字段；contract hash 写入 run |
| `Context Manifest` | 在每个 step/attempt 固化 `sourceKeys`、source hash、included/omitted/trimmed、预算、prompt hash | 让“AI 到底读了什么”可复核、可重放 | `assembleContext()` 结果 | manifest + message hash | Context adapter/Harness | 同输入重放 hash 一致；源变化使 receipt stale |
| `step/attempt/checkpoint` | 将当前步骤、候选、错误、重试次数、可恢复输入和确认状态持久化 | 刷新/取消/网络失败后可恢复，避免重复生成或丢失中间结果 | contract、manifest、候选、错误 | durable state | Harness runner | 中断后 resume；失败不重复写 Canon |
| 终态 `Verifier` | 用确定性代码核查真实 DB 产物、依赖采纳、作用域、字段契约和 hash；语义评审只作 advisory 或受约束 gate | 消除“看起来完成但数据未写/过期/不一致” | contract、manifest、candidate、真实 DB | pass/block + fresh receipt | 独立 verifier 模块 | 伪造模型成功、过期候选、缺依赖反例必须阻断 |
| post-step barrier | 将检索块、状态提取、章节 memory、consistency review 定义为可重试子步骤，并明确 `completed` 条件 | 消除正文后处理 best-effort 造成的假完成 | 正文 hash、计划 hash、步骤依赖 | 每个子步骤 receipt + run terminal | Harness runner | 任一步失败时 run 为可恢复/部分完成而非 completed |
| feedback patch workflow | 影响分析只生成受治理候选 patch，由作者确认后按依赖方向重跑 | 让下游发现冲突后能回溯上游，而非静默级联改写 | stale fact、来源引用、下游章节、受影响产物 | patch candidate + impact graph | Consistency/Review agent + adopt | 只写允许字段；作者拒绝后 Canon 不变；重跑有新 run |

## 5. 下游反哺上游路径

当前已有“下游读回上游”和“正文修改后 stale/影响提示”，但还没有统一的反向修正工作流。目标路径必须保留作者确认，不自动级联重写正文。

```mermaid
flowchart TD
  P[正文/续写] --> X[事实抽取、认知、持有物、摘要]
  X --> F[事实账本/认知账本/检索块]
  P --> I[impact-analysis]
  I --> S[标记 stale + 列出后续章节\n现状：只提示作者]
  S -.新增.-> G[影响图\n来源→依赖产物→受影响步骤]
  G -.新增.-> Q[上游修正候选\n事实/角色状态/大纲/上下文 patch]
  Q --> R[确定性 gate + 语义 advisory]
  R --> U[作者确认]
  U --> A[adopt() 受治理写回]
  A --> C[新 Context Manifest + 新 run]
  C --> D[按依赖重跑下游步骤]
  D --> P
  P --> V[一致性 Agent\n现状：独立候选事件]
  V -.新增绑定.-> G
```

### 5.1 反哺边界

- 事实：`propagateChapterEditStale()` 会把证据已不在新正文中的非 locked confirmed fact 标为 `stale`；`analyzeEditImpact()` 只列事实和后续章节（`src/lib/consistency/impact-analysis.ts:23-74`）。
- 事实：`R-downstream-reverse` 证明显式传 `sourceKeys: ['storyCore','characters','storyArcs']` 且提供 `worldGroupId` 时可以用下游内容反推上游；不提供世界作用域时角色源会被省略。
- 建议：将“影响图”和“上游 patch”作为 Harness 候选，不新增事实源；patch 必须使用现有字段注册表和 `adopt()`，并在 receipt 中记录受影响来源和作者决定。
- 禁止：自动删除事实、改写 locked 事实、无作者确认级联改正文，或把模型自报冲突直接写入 Canon。

## 6. 当前质量问题、失效点与根因

| 问题/失效点 | 代码或测试证据 | 结论类型 | 影响 |
|---|---|---|---|
| 注册表存在但主路径不统一 | 世界观/故事核心手工 `slice()`；故事线 `addArc()` 直接 `db.storyArcs.add()`；普通角色与 Copilot 并存 | 推断 | 来源、预算、校验和写回标准不一致，模型输入/输出质量受入口影响 |
| 上下文可登记但不可完整复核 | `assembleContext()` 返回内存 `included/omitted/trimmed`；正文只打印控制台日志 | 事实 → 推断 | 无法可靠回答某次生成实际读了哪些源、何时被裁剪；问题难以回放 |
| 结构化契约强弱不一致 | 细纲有 JSON 重构和合法 ID 过滤；故事线 parser 只检查 `name`/`stages`；故事核心接受任意文本 | 事实 | 缺字段、类型错、阶段因果和 Canon 冲突可能进入正式数据 |
| 正文后处理无统一完成屏障 | `handleAutoPostGenerate()` 依次重建检索、状态提取、memory；失败仅 `console.error`/降级，调用方 `void` 启动 | 事实 → 推断 | UI/作者可能看到正文已保存，却不知道派生记忆、状态和检索是否完成；失败无法按步骤恢复 |
| 质量 Agent 未绑定主 run | 一致性候选写入 `agentEvents`，有 hash current；没有 run terminal/receipt 关联 | 事实 | 审查结果可查但不能决定某次创作是否完成，也不能自动触发上游修正 |
| 下游反馈只有提示没有闭环 | `impact-analysis` 明确“只读、只提示，不自动改正文” | 事实 | 发现冲突后作者仍需手工判断、修改和重跑，容易让 stale 事实继续传播 |
| 测试多为模块级闭环 | NS/AGENT/PIPELINE 测试覆盖 adapter、CAS、gate、registry、roundtrip；未见跨世界观→正文的真实主路径 held-out | 事实 → 推断 | 单模块绿不能证明真实分步骤流程长期一致 |
| 目标文档与实现成熟度混淆风险 | Harness 文档自标“提案”，但包含完整目标架构；当前代码只有节点级运行时 | 事实 | 若按文档标题重复开发，会形成平行入口或过早新增表 |

### 6.1 根因判断

**推断 1：质量能力分散在多个工程批次，缺少统一执行控制面。** NS-0~NS-6、Agent、透明管线分别交付了局部能力；每个模块能证明自己的不变量，但没有一个 run 负责把步骤依赖、重试、终态和证据连接起来。

**推断 2：主路径接入断裂比“记忆不足”更可能解释实际效果不稳。** 直接证据是故事线旁路写库、世界观/故事核心手工上下文、普通角色入口未统一到 Copilot。相同项目在不同入口上使用不同上下文和 gate，生成质量自然不可比。

**推断 3：失败可见性不足导致错误继续向后传播。** 正文后处理失败只记录日志并保留 tail/旧状态，没有 durable attempt 和明确的“部分完成/待恢复”状态，后续步骤可能继续读取旧的派生记忆。

**推断 4：测试证据与产品路径粒度不匹配。** 现有测试能证明 CAS、作用域、解析和导出安全，但不能回答“用户从世界观一路到正文是否每一步都经过同一治理入口”。

这些推断不得作为最终效果承诺；应在路线图阶段用端到端 fixture、失败注入、重放一致性和 held-out 质量指标验证。

## 7. 目标 Agent + Harness 分层架构

```mermaid
flowchart TB
  UI[分步骤创作 UI\n快速模式/深度模式/作者确认] --> WF[产品流程图与产物契约\nworldview→storyCore→characters→arcs→outline→detail→prose]
  WF --> H[Harness 控制面]
  H --> RC[RunContract\n目标/范围/预算/验收/回滚]
  H --> SM[Run state machine\nqueued→running→awaiting-review→retryable/blocked/completed]
  H --> EX[Step executor\n顺序/DAG/取消/重试/恢复]
  EX --> N[GenerationNode\n现有执行抽象]
  N --> CTX[Context plane\nCONTEXT_SOURCES + assembleContext\n按需路由/预算/压缩/manifest]
  N --> AG[专业 Agent\n仅在需要语义判断/创意推理时使用]
  N --> OUT[结构化/非结构化候选\n产物契约]
  OUT --> VG[Verifier / Review\n确定性优先，语义 advisory]
  VG --> AD[作者确认 + adopt()\nFIELD_REGISTRY/AdoptionSchema]
  AD --> CANON[正式 Canon 与派生记忆]
  CANON --> LIFE[PROJECT_TABLES 生命周期\n导出/导入/删除/迁移/remap]
  H --> OBS[Run ledger / trace / metrics / replay]
  OBS --> EVAL[离线评测与回归集\n开发/held-out/失败注入]
  CANON --> FB[影响分析与反向反馈]
  FB --> H
```

### 7.1 分层职责与约束

| 层 | 责任 | 不负责什么 |
|---|---|---|
| 产品流程与产物契约 | 定义每一步的输入、输出、依赖、作者确认点和允许降级 | 不在组件中手拼第二套上下文或写库 |
| Harness 控制面 | 运行状态、step/attempt、取消、重试、恢复、完成判定、回放 | 不复制 `assembleContext()`、parser 或 `adopt()` |
| Context plane | 只通过注册表路由、预算、压缩、来源 hash 和 manifest 提供输入 | 不静默加入未登记 DB 字段 |
| GenerationNode/专业 Agent | 领域提示词、语义推理、创意候选、窄职责协作 | 不自报完成，不绕过 gate/adopt |
| Verifier/Review | 确定性 schema/作用域/hash/依赖检查；必要时调用受约束语义评审 | 不把 LLM 自评作为唯一完成证明 |
| Canon/Adoption | 作者确认后按字段注册表写入正式数据，产出来源追踪 | 不自动级联重写 locked 或作者正文 |
| 观测/评测 | 记录输入、输出、成本、延迟、失败、receipt，支持 replay 和 held-out | 不把日志当事实源，不改变 Canon |

## 8. 当前架构与目标架构差距矩阵

| 能力 | 当前 | 目标 | 差距 | 依赖/优先级 |
|---|---|---|---|---|
| 产品步骤图 | UI 分散在多个面板，默认一键路径存在 | 有版本化 step graph 与产物契约，保留快速模式 | 缺统一 contract | H0/H1，高 |
| 上下文路由 | 注册表、预算、裁剪已存在；部分入口手拼 | 所有 AI 主入口统一 `assembleContext()`；每 attempt 有 manifest | 入口迁移 + hash/manifest | H1/H2，高 |
| 长期事实/状态/记忆 | NS-1~NS-6 局部能力已实现 | 作为步骤输入且与 run/receipt 绑定 | 运行状态绑定缺失 | H2/H3，高 |
| 执行控制 | `GenerationNode` 请求内 prepare/run/gate/adopt | durable state machine、取消、重试、resume | 缺持久 run ledger | H1，高 |
| Agent 协作 | 有 orchestrator/DAG/预算和领域 Agent | 动态选择但窄职责、依赖可验证、共享写冲突受控 | 现有 orchestrator 不是分步骤主入口 | H2，中高 |
| 产物契约 | 角色/大纲/细纲较强，故事核心/故事线较弱 | 每个步骤有 versioned schema 和 migration/compat 策略 | parser/gate 不一致 | H2，高 |
| 校验 | 一致性 Agent、硬 guard、局部 gate | verifier 独立签发 fresh receipt；语义评审与确定性检查分层 | 无统一终态 | H3，高 |
| 反馈 | stale + 后续章节提示，下游反推可显式读取 | 影响图、patch candidate、作者确认、按依赖重跑 | 缺反向 patch workflow | H4，中高 |
| 写入治理 | 三注册表强，故事线主路径旁路 | 所有 AI 写回统一 adopt；人工路径显式标注 | 需要收口旁路 | H2，高 |
| 观测与回放 | 控制台日志、agent events、透明预览 | run trace、manifest、成本/延迟、失败分类、replay | 缺 run 级持久证据 | H1/H5，高 |
| 评测 | 模块级 NS/AGENT/PIPELINE 和少量 held-out | 真实分步骤端到端、失败注入、回放等价、质量/成本门槛 | 缺主链证据 | H0/H5，高 |
| 数据生命周期 | `PROJECT_TABLES` 66 表，导入导出/remap 有测试 | 新 run 表（如需要）也必须注册表派生完整生命周期 | 尚未决定是否新增表 | H1 先复用现有表，避免扩表 |

## 9. 分阶段实施路线图

本路线图先从不新增表的控制面开始；任何新增 durable 表都必须先补 `PROJECT_TABLES`、schema/迁移、导出导入、删除、作用域、引用 remap 和反例测试。

| 阶段 | 范围与依赖 | 主要风险 | 验收标准 | 回滚边界 | 测试证据 |
|---|---|---|---|---|---|
| H0 基线与路径锁定 | 本审计文档；为每个主入口建立真实路径 fixture；依赖三注册表现状 | 把文档/Agent 当主路径 | 状态表逐项可复核；至少一条从世界观到正文的 trace fixture；确认不混入世界引擎 | 仅删除审计 fixture/文档，不动 Canon | `check:architecture`、`check:required-tables`、定向 registry/NS/AGENT/PIPELINE 测试 |
| H1 最小 RunContract + 证据 | 复用 `agentEvents`/`agentConversations` 或先用受控临时存储；定义 run/step/attempt 状态、contract hash、失败分类；不改变写入语义 | 把对话事件扩成无边界 ledger；旧数据兼容 | 能创建、取消、重试、恢复一个 outline/prose run；完成不再由模型返回决定；无 Canon 变更时回滚安全 | 默认入口仍走旧逻辑；Harness 仅 opt-in，旧入口可快速关闭 | contract/schema 反例、刷新 resume、重复 adopt、失败注入、旧数据回放 |
| H2 主入口收口与 Context Manifest | 先故事线/故事核心/世界观，再普通角色；将手工上下文迁移到 `assembleContext()`，AI 写回改为 `adopt()`；每 attempt 保存来源/预算/prompt hash | 大范围迁移造成生成行为漂移；字符裁剪改变结果 | 主入口所有 AI 调用都有 manifest；故事线无直接 DB add；旧快速模式输出契约保持兼容 | 按入口 feature flag 回退到迁移前调用，但保留审计数据只读 | 主路径 spy/trace、parser/gate 反例、`R-downstream-reverse`、端到端 fixture |
| H3 统一终态与后处理屏障 | 把正文检索、状态提取、章节 memory、一致性 review 变成可重试 steps；独立 verifier 签发 receipt | 延迟/成本上升；历史章节缺派生数据；并发编辑冲突 | 任一步失败显示 retryable/partial；只有所有必需 receipt fresh 才 completed；正文 hash/CAS 保护不变 | 保留正文已保存，后处理可单独重跑；关闭 barrier 不得删除正文 | 失败注入、CAS/stale、重复运行幂等、终态伪造阻断、成本/延迟指标 |
| H4 反向反馈闭环 | 影响图、上游 patch candidate、作者确认、按依赖重跑；复用事实/角色/大纲字段和 `adopt()` | 自动级联改稿、影响范围过大、循环重跑 | 正文冲突可追溯到来源并生成受限 patch；拒绝不改 Canon；确认后新 run 有依赖证据 | 只保留 stale/提示模式；patch 不自动写入 | stale/locked/引用消失、patch schema、拒绝/重放/循环上限测试 |
| H5 评测、回放与渐进发布 | 端到端 held-out、失败注入、输入重放、质量/成本/延迟指标；快速模式与深度模式 A/B | 评测 fixture 泄漏；把局部指标冒充质量提升 | 每阶段有非劣效阈值；run 可回放并解释差异；按入口逐步启用 | feature flag 逐步关闭新 Harness，不回滚作者已确认 Canon | `npm run ci`、`npm run ci:e2e`、固定 held-out、replay hash、独立浏览器数据验证 |

### 9.1 H1 的最小状态机建议

```text
queued
  → running(step/attempt)
  → awaiting-review
  → adopted
  → verifying
  → completed(receipt)

running → retryable(error class, next attempt)
running → blocked(gate/contract/作用域)
verifying → stale(source/state changed)
```

`completed` 必须同时满足：contract 未变、所有必需步骤 receipt 新鲜、目标数据真实存在且作用域正确、所有依赖候选已采纳、post-step barrier 通过。模型的 `final`、UI 的“接受”或单个 Agent event 都不单独满足该条件。

## 10. 旧入口收口与保留清单

| 入口 | 处理 | 边界 |
|---|---|---|
| 世界观三面板组件级 `worldCtx` | 收口到 `assembleContext()`；保留面板 UI 和字段编辑 | 普通人工编辑可继续走 store；AI 生成必须有 manifest |
| `StoryCorePanel.worldCtx()` + historical 拼接 | 登记完整 story-core 输入源并统一装配 | 纯文本字段仍可保留，但需结构化长度/冲突 gate |
| `StoryArcPanel → addArc()` | AI 候选改为 `adopt()`；`addArc/updateArc` 仅作为显式人工编辑入口 | 不复制第二个 arc 写回 service |
| `CharacterPanel` 普通生成 | 迁移到 Character Copilot 的契约，或明确 legacy fallback 并默认关闭 | 不删除手动角色 CRUD；统一 AI 入口后下线弱 parser |
| `GenerationNode` | 继续作为领域执行抽象，由 Harness 调度 | 不把它误命名为 durable run，不另造第二套生成运行器 |
| `agentConversations/agentEvents` | 继续承载对话/候选/确认/错误；可作为兼容投影 | 不无限扩展为 run ledger；字段扩展须先审计生命周期 |
| `nodeFlows/nodeRuns` | 继续服务 FLOW-3 自由节点 | 不直接冒充分步骤主流程 run，除非新增明确 contract/作用域/终态语义 |
| 正文 `handleAutoPostGenerate` best-effort 链 | 迁移为 H3 post-step barrier；保留正文先保存和 CAS | 失败不能删除正文；旧手动重建入口需收口到同一 step executor |
| `impact-analysis` 只提示 | 保留安全默认，增加 H4 patch candidate/作者确认 | 不自动级联重写正文或 locked 事实 |
| 透明管线/章纲工坊 | 继续作为 `GenerationNode` 的 opt-in 深度模式 | 快速模式默认保留；不新增平行 AI/DB 入口 |

## 11. 验收与交付边界

第一阶段完成不代表 Harness 已上线。当前交付仅包括本审计文档和可复核证据。进入 H1 前必须先通过：

```text
npm run check:architecture
npm run check:required-tables
npm run check:ai-manual
npx tsc --noEmit
npm run build
npm run ci
```

适用时另跑 `npm run ci:e2e`，并使用隔离浏览器数据；不得修改作者当前预览项目。提交前运行 `git diff --check`，确认工作树只包含本审计文档。

## 12. 尚未证明的事项

- 研究文档提出的目标 Harness 是否能提高真实长篇质量，尚无本项目端到端因果证据。
- 当前 `agentEvents` 是否足以承载 H1 ledger，需先做容量、查询、并发和迁移评估；不能默认扩展。
- 统一故事核心/故事线结构化契约会不会改变既有作者数据和 prompt 行为，必须用兼容 parser、回归 fixture 和可关闭 feature flag 验证。
- 反向 patch 的最小影响范围和人工确认 UX 尚未定稿；在 H4 之前不应自动修改上游或下游 Canon。
