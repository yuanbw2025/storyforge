# StoryForge AI 创作副驾 + 后台 Agent 设计方案

> Phase 27 — AI Agent 化（重定义版）
> 状态：设计阶段
> 作者构想 + 实现构想合并

---

## 〇、一句话定位

把"对话"做成整个工具的**总入口**：用户用自然语言提需求，AI 听懂后调用项目里对应的功能，生成并填好对应内容，从世界观一路到正文。同时，一组**后台 Agent** 基于现有内容自动运行，维护世界的一致性与"活性"。

两者**共用同一套工具层（Tool Layer）**。前者是"前台对话副驾"，后者是"后勤后台 Agent"；后续升级为多 agent 团队时，用户入口仍然是 ChatCopilot，只是幕后由总 agent 编排多个领域 agent 协同完成任务。

---

## 一、愿景与产品故事

### 1.1 现状的根本局限

当前每一次 AI 调用都是"单发"：用户点按钮 → AI 生成一段 → 用户采纳。AI 没有自主权——不能自己决定查什么数据、不能多步推理、不能自己动手维护数据。功能越做越多（多世界、状态卡、物品栏、故事年表…），但它们是**孤岛**，AI 看不到全局，用户得在十几个面板间手动操作。

### 1.2 双形态愿景

**形态 A — 对话副驾（前台，用户主导）**

右侧常驻一个 AI 对话栏。用户说话，AI 编排工具。特征：
- AI 主动发问引导（"真实历史还是架空？"）
- 填之前先把方案给用户确认，确认后才写入
- 能识别用户随口说的内容、自动归类路由到对应工具
- 两种模式：用户明确命令 / 用户给部分细节 AI 自动补全
- 覆盖全流程：世界观 → 故事核心 → 角色 → 大纲 → 细纲 → 正文

**形态 B — 后台 Agent（后勤，系统/事件触发）**

一组 Agent 在后台基于现有内容自动运行。特征：
- 弱交互、做完汇报
- 自动维护一致性、推演 NPC 人生、整理本章产物
- **在用户对话时也能同时运行**：用户聊着写世界观，后台 Agent 已在校验设定冲突、补全状态

### 1.3 产品故事

**故事 A — 聊着聊着把世界观建好了（对话副驾）**
> 用户新建空项目，打开对话栏。
> AI：「想写真实历史背景，还是纯架空世界？」
> 用户：「架空，但想借鉴宋代的味道。」
> AI：「好。那我按『架空·宋风』来。你心里大概是个什么世界？修仙、武侠还是别的？随便说说。」
> 用户：「修仙，但修炼靠的是写诗。」
> AI：（识别出这涉及【题材+力量体系+世界观】）「有意思。我先把力量体系定为『以诗入道』，给你拟个等级体系草案，你看看要不要调整——」
> （在对话里展示草案 → 用户确认 → AI 调用 saveWorldview 写入 → 左侧世界观面板实时刷新）
> AI：「世界来源和地理我也顺手补了草稿，自然环境还空着，要现在一起定吗？」

**故事 B — 一段灵感，AI 自动归类反推（对话副驾）**
> 用户：「赛博朋克+修仙，用代码修炼的程序员，背景是企业统治的废土城市。」
> AI：（识别：题材=赛博朋克+修仙；主角=程序员/代码修炼；世界观=企业统治废土）
> 「我从这段灵感里读出三块东西：题材、主角设定、世界背景。我来分别反推——
> · 世界观：企业凌驾政府的废土都市…
> · 力量体系：代码即法术，算力即修为…
> · 主角：一个底层运维程序员…
> 你看看哪些对路，我再写进对应的地方。」
> （= 对话驱动的灵感反推，自动路由到 worldview / storyCore / character）

**故事 C — NPC 有了自己的人生（后台 Agent）**
> 主角离开青云城闯荡 30 章后回城。后台「世界推演 Agent」已悄悄推演了店小二 NPC 这些年的轨迹（盘下酒楼、娶妻、卷入商战）。主角踏进城，侧栏提示：
> 💡 你笔下的 NPC「王二」也在这座城，这些年他从店小二变成了樊楼掌柜，正为一批被劫的货发愁。要不要让他们重逢？

**故事 D — 写着写着，AI 在旁边帮你盯着（后台 Agent + 对话）**
> 用户在正文里写主角掏出银票。后台「一致性 Agent」发现：设定里银票第三卷才出现。对话栏/侧栏轻提示：
> ⚠️ 这段写了银票，但你的设定里银票要到第三卷才出现，要改吗？

**故事 E — 一键"整理本章"（后台 Agent）**
> 写完一章点"整理本章"。一个 Agent 通读本章，自主完成：更新 3 个角色状态、给物品栏加 1 次获得 1 次消耗、把"主角突破金丹"写进故事年表、把一条伏笔从"已埋设"推进到"已呼应"，最后汇报改了什么、有无矛盾。

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────┐
│  前台：对话副驾 ChatCopilot        后台：Agent 调度器        │
│  （右侧常驻对话栏）                （事件/定时/手动触发）       │
│        │                              │                   │
│        └──────────────┬───────────────┘                   │
│                       ▼                                    │
│              Agent 执行引擎 (AgentRunner)                   │
│   总 agent 编排：分发任务 → 领域 agent 生成 → 确定性检测 → 打回/收敛 │
│                       │                                    │
│                       ▼                                    │
│              工具层 Tool Registry（统一接口）                │
│   ┌────────────────────────────────────────────┐           │
│   │ 内部：只读 / 生成 / 候选写入 / 提交；外部：MCP │           │
│   │ 注册表读取 / 应用服务规划 / 审批后事务提交      │           │
│   └────────────────────────────────────────────┘           │
│                       │                                    │
│                       ▼                                    │
│   三个注册表 / 应用服务 / adapters / ProjectStoragePort      │
└─────────────────────────────────────────────────────────┘
```

**关键原则**：工具层是统一能力入口，前台对话和后台 Agent 都通过它操作项目；工具内部只调用三个注册表对应的应用服务、受控端口和 adapter，不直接访问 Zustand、`db.*` 或 Tauri 文件命令。Agent 阶段不是绕开现有注册表另起一套 AI 系统，而是在 `CONTEXT_SOURCES`、`FIELD_REGISTRY`、`PROJECT_TABLES` 与确定性一致性校验器之上加一层编排。

### 2.1 多 agent 团队形态

当前设计中的 `AgentRunner + ToolRegistry` 是简版：一个 agent 调用无状态工具完成多步任务。Phase 27 的升级版应支持**总 agent + 分 agent**的团队编排：

- **总 agent（领导 / 编排层）**：理解用户目标，拆分任务，选择领域 agent，分发子任务，收集结果，做跨模块收敛；如果检测到分 agent 产物与已确立事实、规则或其它分工结果不匹配，就把任务打回对应分 agent 重做。
- **分 agent（领域执行层）**：按领域划分为世界观、故事设计、角色、大纲、章节细纲、正文润色、历史考证等。它们是 §3.2 生成工具的进化形态：不只是一次 adapter 调用，而是能围绕一个领域做局部读取、推演、生成、解释。
- **per-role 模型 / API**：每个分 agent 可以配置专属模型与 API。例如世界观 agent 使用擅长架构设定的模型，故事 agent 使用擅长情节推进的模型，章节 agent 使用擅长文风续写的模型。模型选择按实际表现分配，不强求全项目共用一个模型。
- **输入权重可调**：用户可以调每个分 agent 的重点输入比例，例如角色 agent 更重视角色弧光，世界观 agent 更重视世界规则，章节 agent 更重视已写正文和当前章目标。权重影响上下文装配与排序，但不能绕过注册表。
- **前台入口不变**：用户仍然只面对 ChatCopilot。多 agent 团队是幕后执行形态，不把用户暴露在一堆 agent 面板里。

分 agent 使用不同模型是安全的前提，不是“相信每个模型都不会跑偏”，而是团队共享同一套确定性检测尺子。任何模型生成的产物，都要过同一套 canon 校验器与写入确认流程。

### 2.2 检测环：确定性主干，向量副手

Phase 27 的一致性检测不能继续设计成“让另一个 LLM 看一遍”。原则必须改为：

**「有没有违反已确立的事实 / 规则」由确定性代码判(零 token、不漏硬矛盾);向量化只负责『召回相关远处前文供参考』,不作为判定一致性的依据。**

具体含义：

- 总 agent / 分 agent 的串联组合、匹配性检测、产物回收，都复用确定性 canon 校验器；不匹配就打回对应分 agent，而不是靠 LLM 说服自己“看起来还行”。
- 向量化用于召回远处正文、历史设定、角色状态、物品状态等相关材料，帮助 agent 看到可能相关的上下文；但“是否违反已确立事实 / 规则”的判定必须由确定性代码完成。
- 让 LLM agent “看”一致性，会在编排层放大旧问题：劝不判、漏硬矛盾、烧 token。确定性检测既准又省 token，是多模型 agent 成本可控的关键。

### 2.3 与一致性工程化的关系

Agent 编排不是从零开始做一个新的一致性系统。它站在“收敛路线 / 一致性工程化”的地基上：

- 已落地的 CONSISTENCY-1 `held-items` 是第一块确定性校验器：从 `itemLedger` 投影当前已持有物品，并在审校中发现“已持有物品又被写成首次获得”的硬矛盾。
- 后续 `readCurrentFacts`、持有状态投影、角色状态投影、世界规则 canon validator、历史锚点 validator 等，都会成为 agent 检测环复用的基础设施。
- 因此，一致性工程化 = agent 检测环的地基；agent 编排 = 地基之上的协作层。

---

## 三、工具层（Tool Registry）—— 与现有代码精确对应

每个工具 = `{ name, description, parameters(JSON schema), risk, requiredScopes, execute(args) }`。`risk` 用于审批策略，`requiredScopes` 用于能力授权；`execute(args)` 只能调用应用服务或受控端口。

Tool Registry 只登记能力元数据、风险、scope 和 executor 绑定，**不是第四个事实源**：

- 读项目数据必须走 `CONTEXT_SOURCES` + `assembleContext()`；
- 写项目数据必须走 `FIELD_REGISTRY` + `ADOPTION_SCHEMAS` + `planAdoption()` / `commitAdoption()`；
- 表生命周期与 codec 元信息必须走 `PROJECT_TABLES`；
- Agent 工具不得直接读取 Zustand store，不得直接调用 `db.*`，也不得直接执行 Tauri 文件命令。

工具分为两组：**StoryForge 内部工具**和 **MCP 外部工具**。内部工具再分为**只读、生成、候选写入、提交**四类；MCP 工具只提供外部能力，凡结果要写入项目，仍必须回到 StoryForge 的 propose / approval / commit 链路。

### 3.1 StoryForge 内部只读工具（零风险，先做）

| 工具 | risk / requiredScopes | 注册表 / 应用服务映射 | 说明 |
|------|-----------------------|-----------------------|------|
| `storyforge.project.inspect` | `low` / `project:read` | `CONTEXT_SOURCES.projectStatus` + `assembleContext({ need: ['projectStatus'] })` | 返回 `ProjectLocator` 摘要、活动存储类型和项目填写概况；不得直接查询存储 |
| `storyforge.context.read` | `low` / `project:read` | `CONTEXT_SOURCES` + `assembleContext()` | 按 `need` 读取世界观、角色、纲要、正文、历史、规则、伏笔、物品、故事年表和多世界关系 |
| `storyforge.settings.schema` | `low` / `project:read` | `FIELD_REGISTRY` + `ADOPTION_SCHEMAS` + 设置 schema 应用服务 | 返回可读写字段、alias、约束与目标类型，不从 store 类型临时推断 |
| `storyforge.settings.search` | `low` / `project:read` | `CONTEXT_SOURCES` + `assembleContext()` + 项目搜索应用服务 | 按关键词或结构化条件搜索已登记的章节正文与项目设定；首版可用包含匹配，后续可增加语义召回 |

> `storyforge.project.inspect` 的实现前置：如果当前 `CONTEXT_SOURCES` 尚未登记独立的 `projectStatus` source，必须先登记该 source，再由 `assembleContext({ need: ['projectStatus'] })` 读取。`PROJECT_TABLES` 只提供表生命周期与 codec 元信息，不作为 Agent 项目内容读取入口。

原 `read_project_status`、`read_worldview`、`read_story_core`、`read_characters`、`read_outline`、`read_chapter`、`read_history`、`read_world_rules`、`read_foreshadows`、`read_inventory`、`read_story_timeline`、`read_world_groups` 保留为未来兼容别名，统一构建在 `storyforge.project.inspect` / `storyforge.context.read` 之上；`search_text` 映射到 `storyforge.settings.search`，继续覆盖跨章节正文与项目设定搜索，不得退化为仅搜索 settings。所有别名都不得各自实现 store 读取。

### 3.2 StoryForge 内部生成工具（只产候选，不写项目）

| 通用工具 | risk / requiredScopes | 应用服务映射 | 说明 |
|----------|-----------------------|--------------|------|
| `storyforge.generate.run` | `medium` / `agent:generate` | 生成应用服务 + 现有 adapter / prompt seed | 根据注册的生成任务返回结构化候选结果；结果进入候选写入工具后才能落库 |
| `storyforge.extract.run` | `medium` / `agent:generate`、`project:read` | 提取应用服务 + 现有 extract adapter | 从正文提取状态、物品、故事事件和关系，只返回候选变更 |

以下原领域工具名保留为未来兼容别名，并统一委托给上述通用工具，而不是形成独立 store 实现：

- 生成别名：`generate_worldview_field`、`generate_story_core`、`generate_character`、`generate_volume_outline`、`generate_chapter_outline`、`generate_detail_scene`、`generate_chapter_content`、`reverse_from_inspiration`、`suggest_worlds`、`expand_world`、`suggest_foreshadows`、`verify_scene`、`generate_map`。
- 提取别名：`extract_state_changes`、`extract_inventory`、`extract_story_events`、`extract_relations`。

### 3.3 StoryForge 内部候选写入工具（规划，不落库）

| 工具 | risk / requiredScopes | 写入链路映射 | 说明 |
|------|-----------------------|--------------|------|
| `storyforge.change.propose` | `medium` / `project:write:propose` | `FIELD_REGISTRY` + `ADOPTION_SCHEMAS` + `planAdoption()` | 完成 alias、验证、identity、外键、stamp 与 diff，生成持久 pending action 和 approval hash，但不写项目 |

原 `save_worldview`、`save_story_core`、`add_character`、`update_character`、`add_outline_node`、`update_outline_node`、`save_chapter_content`、`add_foreshadow`、`advance_foreshadow`、`add_history_event`、`add_history_keyword`、`set_world_rule`、`create_world_group`、`link_worlds`、`add_inventory_entry`、`add_story_timeline_event`、`update_character_state` 保留为未来兼容别名；它们只负责把领域参数转换为 `storyforge.change.propose` 的通用输入，不得直接写 store 或存储后端。

### 3.4 StoryForge 内部提交与处置工具（审批后执行）

| 工具 | risk / requiredScopes | 写入链路映射 | 说明 |
|------|-----------------------|--------------|------|
| `storyforge.change.commit` | `high` / `project:write:commit` | `commitAdoption()` | 复核计划过期状态、`ProjectLocator`、revision、approval hash 和确定性校验后事务提交 |
| `storyforge.change.reject` | `low` / `project:write:propose` | pending action 应用服务 | 持久化拒绝状态，不修改项目事实 |
| `storyforge.change.undo` | `high` / `project:write:commit` | snapshot / inverse patch 应用服务 | 基于已提交变更的快照或逆向 patch 生成并提交可审计撤销 |

前台对话 Agent 默认拥有 propose，只有用户批准后才临时获得对应 commit 能力；后台 Agent 可以 propose，但默认不提供 `storyforge.change.commit` 或 `storyforge.change.undo`。

### 3.5 MCP 外部工具

MCP 工具通过独立 registry/adapter 暴露搜索、知识库、文件选择器等外部能力，并保留来源、权限和风险元数据。MCP 返回值不是 StoryForge 项目事实；需要进入项目的数据必须先转成 `storyforge.change.propose`，经用户审批后再调用 `storyforge.change.commit`。MCP executor 同样不得绕过应用服务直接访问 Zustand、`db.*` 或 Tauri 文件命令。

> **设计纪律**：工具层只做“参数校验 + 权限/风险判断 + 调用注册表应用服务或受控端口 + 统一返回格式”的薄封装。手动 UI 与 Agent 当前可以有不同入口，但项目事实、字段规则和表生命周期分别只由三个注册表定义；后续两条路径共同下沉 `ProjectStoragePort`，不产生第二套真相。

---

## 四、前台：对话副驾（ChatCopilot）

### 4.1 UI 形态

- 右侧常驻**可收起的对话栏**（类似 IDE 的 AI 助手栏），宽度可调，可固定/浮动
- 复用现有 `showProperties` 那套右栏开关机制，新增一个对话栏开关
- 对话气泡 + 当 AI 要写入数据时，**内嵌"待确认卡片"**（展示将写入什么 → 用户「采纳/修改/拒绝」）
- 顶部显示当前作用域（哪个项目 / 多世界下哪个世界）

### 4.2 核心环节：意图识别 + 任务路由

用户的话进来后，AI 第一步不是直接干，而是**理解 + 拆解**：

```
用户输入 → [意图识别] → 判断涉及哪些模块（题材/世界观/角色/大纲/正文…）
        → [任务拆解] → 拆成一串工具调用计划
        → [确认/澄清] → 缺信息就发问，要写入就先给方案
        → [执行] → 逐个调用工具
        → [回报 + 面板刷新]
```

这一步用 tool calling 实现：把 §3 的工具喂给 AI，AI 自己决定调哪些、按什么顺序。

### 4.3 引导式发问

AI 不是被动等指令，而是会**主动推进**：
- 检测项目空白处，主动问（"自然环境还没填，要现在补吗？"）
- 关键分叉先问清楚（真实/架空、几个世界、第几人称…）——这些问题的答案会改变后续调用哪些工具
- 用 `storyforge.project.inspect` 随时掌握“填了什么、缺什么”，作为引导依据；该信息由 `projectStatus` context source 经 `assembleContext()` 提供

### 4.4 确认机制（重中之重）

**所有项目变更默认走“先规划、后确认、再提交”**：
- AI 调用 `storyforge.change.propose` → `planAdoption()` 只生成规范化计划、diff、pending action 与 approval hash，不立即写入项目
- 用户「采纳」→ 调用 `storyforge.change.commit`，由 `commitAdoption()` 复核后事务提交；「修改」→ 基于修改内容重新 plan；「拒绝」→ 调用 `storyforge.change.reject` 持久化拒绝状态
- 支持“本轮全部采纳”或会话级信任策略，但每份计划仍必须产生可审计的 approval hash，不能绕过 commit 校验
- 这是体验（用户始终掌控）+ 安全（AI 不静默改稿）的双重保险

### 4.5 与现有面板的双向同步

- `commitAdoption()` 经注册表应用服务和活动 `ProjectStoragePort` 提交后，UI 的项目状态订阅/水合机制刷新对应面板；Agent 不接触 Zustand store
- 反向：用户在面板手动编辑暂经 store action 持久化后，Agent 下一次必须通过 `CONTEXT_SOURCES` + `assembleContext()` 读取最新项目事实
- **关键**：对话栏、后台 Agent 与手动 UI 共享注册表应用服务和活动 `ProjectStoragePort`；store 只是手动 UI 的过渡实现细节，不是 Agent 的事实源

### 4.6 与多世界的精密配合

- 对话栏顶部显示当前世界；用户说“切到斗破世界”时，由宿主/UI 解析目标并通过 `ToolExecutionContext` 将显式 `ProjectLocator` 与世界 identity 传给应用服务，不由 Agent 工具直接切换 store
- UI 的 `activeGroupId` 只能在调用边界转换为 `ToolExecutionContext`；工具不得自行读取它。`planAdoption()` 根据 context、identity 与 adoption schema 自动盖章，`commitAdoption()` 提交前再次复核作用域
- 因此多世界能力复用统一作用域和 adoption 链路，不产生 Agent 专用隔离逻辑

---

## 五、后台：Agent 调度器（Background Agents）

### 5.1 触发方式

| 触发 | 场景 |
|------|------|
| 事件触发 | 写完一章 → 触发"整理本章 Agent" |
| 手动触发 | 用户点"推演 NPC 近况" |
| 对话期间并行 | 用户在对话副驾里建世界观时，"一致性 Agent"同时校验冲突 |
| 打开补算 | 纯前端限制：长任务（NPC 推演）在项目打开时补算未处理的进度 |

### 5.2 具体 Agent

**整理本章 Agent（事件触发，最先做，价值高风险低）**
- 通读本章 → 串联调用提取工具（状态/物品/故事事件/关系）→ 推进伏笔状态
- 一次完成现在要点 4 个按钮的活，结果汇总给用户确认
- 复用 §3.4 提取工具，不新写提取逻辑

**一致性 Agent（事件/对话并行触发）**
- 读本章与相关上下文 → 调用确定性 canon 校验器核对世界观/角色设定/物品栏/伏笔/世界规则/历史锚点
- 发现硬矛盾（角色状态倒退、已消耗物品重新出现、违反力量规则、时代错乱）→ 提示；在多 agent 团队中则把不合格产物打回对应分 agent
- 向量召回只负责把远处相关前文找回来供参考，不作为一致性判定依据
- 纯只读 + 提示，不自动改，最安全

**NPC 演进 Agent（世界时间线引擎，最复杂，依赖前面地基）**
- 为每个 NPC 维护"位置/状态/经历"轨迹（扩展 state-card 或新表）
- 随故事时间推进异步推演 NPC 人生；主角到达某地 → 碰撞检测 → 重逢提示
- Token 消耗大，必须智能调度（只在需要/打开时推演，限频限额）
- 这是 zzjj 27.3 的核心，单独作为后续 Phase

### 5.3 后台与前台的协同

- 后台 Agent 的发现 → 推送到对话栏（作为 AI 的主动消息）或侧栏角标
- 用户在对话里的操作 → 可能触发后台 Agent（如对话里写完世界观 → 一致性 Agent 复查）
- 前台与后台统一通过 `CONTEXT_SOURCES`、`FIELD_REGISTRY` + `ADOPTION_SCHEMAS` 和活动 `ProjectStoragePort` 协同；后台只 propose，用户批准后由前台提交。调度器做**去重 + 限频**，避免同一时刻一堆 Agent 抢着跑

### 5.4 前台 / 后台安全线

幕后可以都是 agent，但驱动方式必须分清：

- **对话副驾（前台 · 用户驱动）**：用户发起对话 → 总 agent / 分 agent 团队执行 → 需要写入时生成确认卡片 → 用户确认后才落库。
- **后台 Agent（自主驱动）**：事件或定时触发，例如写完章整理、一致性核对、NPC 推演。默认只读或低风险，只能提示、汇总、准备候选变更，不能自动改用户手稿。

安全线：**写入确认只属于用户驱动侧；自主 agent 默认只读。** 这条线不能模糊，否则就会变成 AI 在用户不知情时自动改正文、改设定、改手稿。

---

## 六、Agent 执行引擎（AgentRunner）

AgentRunner 有两层形态：

- **单 agent 多步循环**：MVP 阶段用于跑通 tool calling、只读检查、单点写入确认。
- **团队编排循环**：升级阶段由总 agent 负责拆分任务、选择分 agent、汇总产物、调用确定性检测器，不合格则打回分 agent 重做。

### 6.1 核心循环

```
loop（受步数/Token 上限约束）:
  1. 调 AI（messages + tools）
  2. AI 回 tool_calls → 对每个：
     - 只读/生成工具：直接执行，结果喂回
     - 写入工具：生成待确认卡片，暂停等用户（前台）；后台 Agent 按策略（默认只读或低风险才自动）
  3. AI 无 tool_call、给出最终回复 → 结束
```

### 6.1b 团队编排循环

```
用户目标 / 后台事件
  → 总 agent 拆分任务
  → 按领域选择分 agent 与模型/API
  → 分 agent 读取上下文并生成候选产物
  → 确定性 canon 校验器检查事实/规则/跨模块匹配
  → 通过：总 agent 收敛为最终方案或确认卡片
  → 不通过：携带具体冲突证据打回对应分 agent 重做
```

团队编排中的“检测”不由 LLM 投票完成。LLM 可以解释冲突、提出修法、重写候选文本，但是否违反 canon 的判定由确定性校验器给出。

### 6.2 提供商兼容性（关键风险）

不同 API 的 tool calling 格式不统一：
- OpenAI 系（DeepSeek/Kimi/魔搭/NVIDIA NIM 等兼容）：标准 `tools` + `tool_calls`
- Claude：`tools` 但格式不同
- 国产/小厂：部分不支持

**对策**：
- 在 `client.ts` 的 `buildRequest` 增加 tools 注入层，按 provider 适配格式
- **能力探测 + 降级**：不支持 tool calling 的 provider → 退化为"提示词模拟工具调用"（让 AI 输出结构化 JSON 指令，我们解析后执行）或直接提示用户切换模型
- 配合刚做的 **API 预设**：用户可为"对话副驾"单独配一个支持 tool calling 的模型预设

### 6.3 安全与失控防护

- 步数上限（如单任务 ≤ 15 步）、Token 预算上限
- 写入工具全部走确认（前台用户驱动）；后台 Agent 默认只读/低风险，不能自动改用户手稿
- 每步可中断（停止按钮）
- 工具执行异常不崩溃整个循环，捕获后喂回 AI 让它换路
- 多 agent 模式增加项目级成本提示：每轮可能并行或串联多个模型调用，适合工作室 / 有产者 / 专业用户，不应默认压给普通 BYOK 用户

---

## 七、与现有功能的精密组合调用（避免 bug 的关键）

> 这一节专门回应“如何跟现有功能逻辑精密组合，不做出 bug”。

| 现有机制 | 组合方式 | 防 bug 要点 |
|---------|---------|------------|
| Zustand store | 手动 UI 暂走 store action；Agent 只走注册表应用服务；后续共同下沉 `ProjectStoragePort`；禁止 Agent 直接读写 store | 过渡期允许入口不同，但字段规则、项目事实与最终存储契约只有一套 |
| 多世界隔离 | `planAdoption()` 根据显式 `ProjectLocator`、identity 与 schema 计算 stamp，`commitAdoption()` 复核后提交 | 不从 UI 的临时 active state 猜目标世界，避免写错世界组 |
| `useAutoSave` | 手动正文编辑暂保留自动保存；Agent 正文变更走 propose / approval / commit | Agent 不绕过审批，也不直接调用编辑器 store；共同存储路径后续下沉 `ProjectStoragePort` |
| 确认机制 | pending action 持久化规范化计划、diff、approval hash 与状态 | 预览和提交使用同一计划；过期计划必须失败并重新审批 |
| AI 解析（不用正则） | 生成/提取应用服务复用现有 `restructure.ts` 等能力，产物先进入候选变更 | 解析结果不等于已采纳事实，不能跳过确定性校验与审批 |
| 字段映射 | `FIELD_REGISTRY` + `ADOPTION_SCHEMAS` 统一字段、alias、identity、FK 与 stamp | 禁止工具维护平行字段映射或从 store 类型临时推断 |
| 导入导出 | 表集合、生命周期与 codec 统一来自 `PROJECT_TABLES`，最终经活动 `ProjectStoragePort` | 不手写表清单；同一项目会话只有一个活动存储后端 |
| 提示词库 | Agent 通过设置/提示词应用服务读取已注册配置 | 保留用户自定义能力，同时禁止工具直接读取提示词 store |
| Token 透明 | 对话/Agent 的 token 消耗计入现有 logger | 延续“不设预算上限、透明展示”原则 |
| 确定性一致性校验 | 复用 CONSISTENCY-1 与后续 canon validators，并在 plan/commit 两阶段校验 | 多模型产物用同一把尺子检测，不靠 LLM 自评 |

**核心纪律**：Tool Registry 不是事实源。Agent 的读、写和表生命周期分别经 `CONTEXT_SOURCES`、`FIELD_REGISTRY` + `ADOPTION_SCHEMAS`、`PROJECT_TABLES` 收口；所有提交都经过计划、审批和事务提交，最终与手动 UI 共用 `ProjectStoragePort`。

---

## 八、分期实施

**Phase 27.1-a 工具层地基（只读工具优先）**
- 定义 Tool 接口 + 注册表；先实现全部**只读工具**（零风险）
- 验证：能让 AI 通过工具"看懂"整个项目

**Phase 27.1-b Agent 执行引擎 + 提供商适配**
- AgentRunner 多步循环 + `client.ts` tools 注入 + 兼容/降级
- 验证：拿"一致性检查"（纯只读 Agent）跑通整条 tool calling 链路，验证成本

**Phase 27.1-c 对话副驾 MVP（前台）**
- 右侧对话栏 UI + 意图识别 + 确认卡片 + 面板同步
- 先接**生成 + 写入工具的一个闭环**：对话引导填世界观（最高频入口）
- 验证：用户能"聊着把世界观建好"，面板实时刷新

**Phase 27.1-d 扩展对话覆盖面**
- 逐步接入：灵感对话反推、角色/大纲/正文的对话生成
- 写入工具全面接入确认机制

**Phase 27.1-e 多 agent 团队编排**
- 总 agent 负责任务拆解、领域分发、收敛与打回
- 分 agent 按世界观 / 故事 / 角色 / 大纲 / 章节细纲等领域配置专属模型/API与输入权重
- 复用确定性 canon 校验器做跨 agent 产物匹配检测，不通过则带证据打回

**Phase 27.2b / 5.2 后台 Agent**
- 整理本章 Agent（先）→ 一致性 Agent → NPC 演进 Agent（最后，最复杂）

**每期独立可用**：工具层本身有用；只读 Agent 不写数据先验证；对话副驾从世界观单点切入。

---

## 九、风险与对策（汇总）

| 风险 | 对策 |
|------|------|
| 提供商不支持 tool calling | 适配层 + 提示词模拟降级 + API 预设单独配模型 |
| Token 成本（多步×多次 / 多模型团队） | 步数/预算上限、智能调度、后台 Agent 限频限额；多 agent 模式定位为工作室 / 专业用户能力 |
| AI 失控改数据 | 前台提交必须有 approval hash 并走 `commitAdoption()`；后台自主 Agent 默认只有 propose、没有 commit；运行可中断 |
| 数据不一致 | Agent 只调用注册表应用服务和活动 `ProjectStoragePort`；Tool Registry 不保存项目事实 |
| 多模型产物互相打架 | 用确定性 canon 校验器做事实/规则/匹配性检测，不靠 LLM 自评 |
| 纯前端长任务受限 | "打开补算"策略；NPC 推演分片增量 |
| 意图识别错路由 | 先确认后执行；澄清式发问；用户可纠正 |
| 与现有功能冲突 | 工具薄封装、复用而非重写；行为与手动一致 |
| 新手被对话栏干扰 | 对话栏可收起；默认不强推，用户主动开 |

---

## 十、成功标准

1. **新手**：打开空项目，只靠和对话栏聊天，就能从零建出世界观→故事核心→角色→大纲，全程不用找面板。
2. **老手**：对话栏作为"快捷指挥"，一句话完成原本要点好几个面板的操作；手动操作照常可用，二者无冲突。
3. **一致性**：后台 Agent 和多 agent 团队共用确定性 canon 校验器，写到硬矛盾处有提示；写完一章一键整理产物。
4. **零回归**：对话/Agent 路径与手动路径行为完全一致，不引入数据不一致或新 bug。
