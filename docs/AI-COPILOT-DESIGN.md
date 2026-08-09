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
│   ┌─────────────┬──────────────┬──────────────┐           │
│   │ 只读工具      │ 生成工具       │ 写入工具       │           │
│   │ (查询项目)    │ (调 AI 生成)   │ (写 store)    │           │
│   └─────────────┴──────────────┴──────────────┘           │
│                       │                                    │
│                       ▼                                    │
│        现有 stores / adapters / prompt seeds（复用）         │
└─────────────────────────────────────────────────────────┘
```

**关键原则**：工具层是唯一地基，前台对话和后台 Agent 都通过它操作项目；工具内部**复用现有 store 方法和 adapter**，不另起炉灶，从根上避免逻辑分叉与 bug。Agent 阶段不是绕开现有注册表另起一套 AI 系统，而是在 `CONTEXT_SOURCES`、`FIELD_REGISTRY`、`PROJECT_TABLES` 与确定性一致性校验器之上加一层编排。

### 2.1 多 agent 团队形态

当前设计中的 `AgentRunner + ToolRegistry` 是简版：一个 agent 调用无状态工具完成多步任务。Phase 27 的升级版应支持**总 agent + 分 agent**的团队编排：

- **总 agent（领导 / 编排层）**：理解用户目标，拆分任务，选择领域 agent，分发子任务，收集结果，做跨模块收敛；如果检测到分 agent 产物与已确立事实、规则或其它分工结果不匹配，就把任务打回对应分 agent 重做。
- **分 agent（领域执行层）**：按领域划分为世界观、故事设计、角色、大纲、章节细纲、正文润色、历史考证等。它们是 §3.2 生成工具的进化形态：不只是一次 adapter 调用，而是能围绕一个领域做局部读取、推演、生成、解释。
- **per-role 模型 / API**：每个分 agent 可以配置专属模型与 API。例如世界观 agent 使用擅长架构设定的模型，故事 agent 使用擅长情节推进的模型，章节 agent 使用擅长文风续写的模型。模型选择按实际表现分配，不强求全项目共用一个模型。
- **输入权重可调**：用户可以调每个分 agent 的重点输入比例，例如角色 agent 更重视角色弧光，世界观 agent 更重视世界规则，章节 agent 更重视已写正文和当前章目标。权重影响上下文装配与排序，但不能绕过注册表。
- **前台入口不变**：用户仍然只面对 ChatCopilot。多 agent 团队是幕后执行形态，不把用户暴露在一堆 agent 面板里。

分 agent 使用不同模型是安全的前提，不是“相信每个模型都不会跑偏”，而是团队共享同一套确定性检测尺子。任何模型生成的产物，都要过同一套 canon 校验器与写入确认流程。

> 2026-07-27 实施进度：已先交付五领域 `精简 / 均衡 / 完整` 档位。档位按比例收窄
> `CONTEXT_SOURCES` 的登记预算，并冻结候选的实际纳入/省略/裁剪来源与 token 估算；
> 已实现跨调用团队三档总预算和整轮一次受控 Canon 打回；尚未开放任意单源滑块、并行
> 团队、模型投票或无限重试。

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

每个工具 = `{ name, description, parameters(JSON schema), execute(context, args) }`。
工具分三类：**只读 / 生成 / 写入**。写入类与生成类全部**复用现有 store 方法和 adapter**，不重写业务逻辑。

> 2026-07-25 实施校正：Phase 27.1-a 已按
> [`AGENT-TOOL-REGISTRY-DESIGN.md`](./AGENT-TOOL-REGISTRY-DESIGN.md) 落地。旧表中“直接读
> store state”只表达能力映射，不再是运行时路径；实际读取统一经过
> `CONTEXT_SOURCES → assembleContext()`，以保留预算、作用域与审计单一入口。

### 3.1 只读工具（查询项目，零风险，先做）

| 工具 | 复用 | 说明 |
|------|------|------|
| `read_project_status` | 各 store 的 state | 返回项目填写概况（哪些模块已填/空、字数、章节数、世界数） |
| `read_worldview` | `useWorldviewStore` | 读世界观（多世界下读指定世界组） |
| `read_story_core` | `useWorldviewStore.storyCore` | 读故事核心 |
| `read_characters` | `useCharacterStore` | 列角色 / 按名查角色 / 按世界过滤 |
| `read_outline` | `useOutlineStore` | 读卷/章大纲树 |
| `read_chapter` | `useChapterStore` | 读某章正文 |
| `read_history` | `useHistoricalStore` | 读历史年表事件/关键词 |
| `read_world_rules` | `useWorldRulesStore` | 读真实与幻想规则 |
| `read_foreshadows` | `useForeshadowStore` | 读伏笔及状态 |
| `read_inventory` | `useItemLedgerStore` | 读物品栏 |
| `read_story_timeline` | `useStoryTimelineStore` | 读故事进程年表 |
| `read_world_groups` | `useWorldGroupStore` | 读多世界列表与关系 |
| `search_text` | 跨 store | 按关键词跨章节/设定搜索（先用包含匹配，后可升级语义） |

### 3.2 生成工具（调 AI 生成内容，复用现有 adapter + prompt seed）

| 工具 | 复用 adapter / prompt key |
|------|--------------------------|
| `generate_worldview_field` | `worldview-adapter` / `worldview.dimension` |
| `generate_story_core` | 主 Agent `world-origin.story-core` / `story-core-copilot-v1`；`story.generate` 仅保留作者 Prompt 配置入口 |
| `generate_character` | `character-adapter` / `character.generate` |
| `generate_volume_outline` | `outline-adapter` / `outline.volume` |
| `generate_chapter_outline` | `outline-adapter` / `outline.chapter` |
| `generate_detail_scene` | `detail-scene-adapter` / `detail.scene` |
| `generate_chapter_content` | `chapter-adapter` / `chapter.content` |
| `reverse_from_inspiration` | `inspiration-reverse` / `inspiration.reverse(.multiworld)` |
| `suggest_worlds` | `world-group-ai` / `world-group.suggest` |
| `expand_world` | `world-group-ai` / `world-group.expand` |
| `suggest_foreshadows` | `foreshadow-adapter` / `foreshadow.generate` |
| `verify_scene` | `scene-verify-adapter` / `scene.verify` |
| `generate_map` | `voronoi-map-adapter` |

### 3.3 写入工具（写 store，**全部带确认关卡**，复用现有 store 方法）

| 工具 | 复用 store 方法 |
|------|----------------|
| `save_worldview` | `saveWorldview` / `savePowerSystem` |
| `save_story_core` | `saveStoryCore` |
| `add_character` / `update_character` | `addCharacter` / `updateCharacter` |
| `add_outline_node` / `update_outline_node` | `addNode` / `addNodes` / `updateNode` |
| `save_chapter_content` | `updateChapter` |
| `add_foreshadow` / `advance_foreshadow` | `addForeshadow` / `updateStatus` |
| `add_history_event` / `add_history_keyword` | `addEvent` / `addKeyword` |
| `set_world_rule` | `updateEntry`（真实与幻想维度） |
| `create_world_group` / `link_worlds` | `createGroup` / `createLink` |
| `add_inventory_entry` | `addEntry` / `addEntries` |
| `add_story_timeline_event` | `addEvent` / `addEvents` |
| `update_character_state` | `state-card` `addCard` / `updateCard` |

### 3.4 提取工具（从已写正文回提，供后台 Agent 用）

| 工具 | 复用 adapter |
|------|-------------|
| `extract_state_changes` | `state-extract-adapter` |
| `extract_inventory` | `inventory-extract-adapter` |
| `extract_story_events` | `story-timeline-adapter` |
| `extract_relations` | `relation-extract`（relation.extract） |

> **设计纪律**：工具层不写新业务逻辑，只做"参数校验 + 调用现有方法 + 统一返回格式"的薄封装。现有功能怎么跑，工具就怎么调，保证对话/Agent 路径与手动操作路径**行为完全一致**，不产生第二套真相。

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
- 用 `read_project_status` 随时掌握"填了什么、缺什么"，作为引导依据

### 4.4 确认机制（重中之重）

**所有写入类工具调用，默认走"先确认后执行"**：
- AI 调用写入工具 → 引擎**不立即执行**，而是把"将写入的内容"渲染成待确认卡片
- 用户「采纳」→ 才真正调 store 写入；「修改」→ 用户改完再写；「拒绝」→ 丢弃
- 支持"本轮全部采纳" / "信任此类操作本次会话免确认"（高级用户提速）
- 这是体验（用户始终掌控）+ 安全（AI 不静默改稿）的双重保险

### 4.5 与现有面板的双向同步

- AI 写入后，对应 store 更新 → **Zustand 响应式 → 左侧面板自动刷新**（这是现有机制，天然支持，无需额外做）
- 反向：用户在面板手动改了东西，对话栏的 AI 下次读 `read_*` 工具时拿到的是最新值（因为都读同一个 store）
- **关键**：对话栏和面板共享同一套 store，是"同一份真相的两个视图"，不存在数据不一致

### 4.6 与多世界的精密配合

- 对话栏顶部显示当前世界；用户说"切到斗破世界"→ AI 调 `setActiveGroup`
- 写入世界观/角色时，工具自动按当前 `activeGroupId` 盖章（复用现有按世界隔离逻辑）
- 这样对话副驾天然支持多世界，不需要单独处理

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
- 两者读写同一套 store，天然协同；调度器做**去重 + 限频**，避免同一时刻一堆 Agent 抢着跑

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

> 这一节专门回应"如何跟现有功能逻辑精密组合，不做出 bug"。

| 现有机制 | 组合方式 | 防 bug 要点 |
|---------|---------|------------|
| Zustand store | 工具只调 store 现有方法，不直接写 DB | 保证对话/Agent 与手动操作走同一条写入路径，单一真相 |
| 多世界隔离 | 写入工具读 `activeGroupId` 自动盖章 | 复用现有按世界过滤，不另写隔离逻辑 |
| `useAutoSave` | 对话不绕过正文自动保存机制 | 写正文走 `updateChapter`，与编辑器一致 |
| 确认机制 | 复用"待采纳预览"模式（如灵感反推/伏笔） | 写入前必经用户确认，行为可预期 |
| AI 解析（不用正则） | 工具内解析一律用 AI 重构（复用 `restructure.ts`） | 延续全局原则 |
| 字段映射 | 写入工具的字段名严格对齐 store 类型 | 复用此前修过的字段对齐经验，禁止脆弱映射 |
| 导入导出 | 新增的 NPC 轨迹等表纳入 json-export | 保证数据完整可迁移 |
| 提示词库 | 工具用的 prompt 走 `usePromptStore.getActive` | 用户可自定义，与现有提示词体系统一 |
| Token 透明 | 对话/Agent 的 token 消耗计入现有 logger | 延续"不设预算上限、透明展示"原则 |
| 确定性一致性校验 | 复用 CONSISTENCY-1 与后续 canon validators | 多模型产物用同一把尺子检测，不靠 LLM 自评 |

**核心纪律**：工具层是对现有功能的"薄封装 + 编排"，不复制业务逻辑。任何一个对话能做的事，手动也能做，且结果一致——这是不出 bug 的根本保证。

---

## 八、分期实施

**Phase 27.1-a 工具层地基（2026-07-25 已完成）**
- 已定义 Tool 接口 + 注册表并实现全部 13 个只读工具
- 已验证注册表读取、项目/世界隔离、有界搜索、总预算与零写入；当前为 headless 地基，尚未宣称 AI tool calling 已接通

**Phase 27.1-b Agent 执行引擎 + 提供商适配（2026-07-25 已完成）**
- AgentRunner 多步循环 + provider-neutral 严格 JSON 动作协议；协议与 transport 分离，
  原生 `tool_calls` 保留为后续能力探测优化，不复制执行内核
- 已用纯只读项目巡检跑通“模型 → 工具 → 证据 → 最终答复”，验证预算、取消、循环、
  作用域、消息裁剪拒绝、消耗统计和内容表零写入

**Phase 27.1-c 对话副驾 MVP（前台，2026-07-25 已完成）**
- 已交付右侧对话栏、当前项目/世界作用域、可编辑确认卡和面板同步；窄屏使用覆盖式右栏，
  不挤压主面板
- 首个闭环严格限定为 `read_project_status/read_worldview → worldview.dimension →
  可见候选 → 作者明确确认 → GenerationNode gate → adopt(worldviews.worldOrigin)`
- 确认采纳可见候选时不会再次调用模型；来源变化、空/过短/过长/无变化候选均阻断
- 当前尚未实现泛化意图识别，不能据此宣称“任意对话建完整世界观”；详细边界见
  [`CHAT-COPILOT-MVP-DESIGN.md`](./CHAT-COPILOT-MVP-DESIGN.md)

**Phase 27.1-d 扩展对话覆盖面（已完成）**
- 灵感对话反推的首个独立闭环已接入：作者选择已保存碎片，正式 read tool 有界装配，
  结构化候选可编辑，确认后只复用既有灵感版本写回，不自动采纳项目主档
- 详细边界与验收见
  [`CHAT-COPILOT-INSPIRATION-DESIGN.md`](./CHAT-COPILOT-INSPIRATION-DESIGN.md)
- 角色生成的第二个独立闭环已接入：正式 `read_worldview/read_characters` 装配当前世界
  关联闭包，复用 `character.generate` 生成闭集 JSON；作者编辑确认后只经
  `GenerationNode → adopt(characters)` 新增角色，同名与并发过期阻断
- HARNESS-33 已将分步骤角色面板的普通 AI 按钮也收口到同一 `character.create` Skill，并把正式读取扩展为
  世界、故事核心、角色、世界规则和历史。旧自由文本解析旁路已删除；人工 CRUD、角色轴、维度选择和 Prompt
  配置保留，不自动创建关系、物品、状态卡或大纲。
- 详细边界与验收见
  [`CHAT-COPILOT-CHARACTER-DESIGN.md`](./CHAT-COPILOT-CHARACTER-DESIGN.md)
- 大纲生成的第三个独立闭环已接入：复用手工大纲入口的 17 个正式上下文源、
  `outline.volume/outline.chapter` 提示和 `adopt(outlineNodes)`；候选整批可编辑，
  世界作用域、同层重复、并发快照和上游候选采纳依赖均由确定性代码阻断
- 详细边界与验收见
  [`CHAT-COPILOT-OUTLINE-DESIGN.md`](./CHAT-COPILOT-OUTLINE-DESIGN.md)
- 正文生成的第四个独立闭环已接入：空白章生成与已有正文显式续写复用正式章节上下文、
  `chapter.content/chapter.continue` 和 `adopt(chapters)`；目标章、正文 fingerprint、
  旧检索证据失效和非覆盖边界由代码保证
- 详细边界与验收见
  [`CHAT-COPILOT-PROSE-DESIGN.md`](./CHAT-COPILOT-PROSE-DESIGN.md)
- 27.1-d 四个领域已闭环；后续能力仍须逐项冻结读、候选、gate、确认写回与非范围，
  不提前泛化成任意意图

**Phase 27.1-e 多 agent 团队编排**
- 总 agent 负责任务拆解、领域分发、收敛与打回
- 分 agent 按世界观 / 故事 / 角色 / 大纲 / 章节细纲等领域配置专属模型/API与输入权重
- 复用确定性 canon 校验器做跨 agent 产物匹配检测，不通过则带证据打回
- 首个增量已实现六角色专属模型/API 路由：主 Agent 编排与世界、角色、灵感、大纲、正文
  分别绑定已有预设，且在上下文装配前解析实际模型；随后交付五领域上下文档位、可见输入
  证据、跨调用团队预算和一次确定性 Canon 打回。并行自治、任意单源权重、模型投票与长期
  后台团队仍未完成。详细边界见
  [`AGENT-TEAM-ROLE-ROUTING-DESIGN.md`](./AGENT-TEAM-ROLE-ROUTING-DESIGN.md)
  与 [`AGENT-TEAM-BUDGET-CANON-DESIGN.md`](./AGENT-TEAM-BUDGET-CANON-DESIGN.md)。

**Phase 27.2b-c / 5.2 后台 Agent**
- 整理本章 Agent 已完成：一次调用生成状态/事实/物品/年表/关系/伏笔六域证据候选，
  复用归档 Agent 事件流恢复，作者确认与正文 hash 守卫后才写回。详细边界见
  [`CHAPTER-ORGANIZATION-AGENT-DESIGN.md`](./CHAPTER-ORGANIZATION-AGENT-DESIGN.md)。
- 一致性 Agent 已完成：保存正文只运行零模型调用的确定性 Fast Guard；作者明确运行
  fast/deep 时最多调用模型一次，逐字证据经白名单校验，Canon 硬判仍由代码完成。报告
  复用归档 Agent 事件流，可恢复、有 hash 过期守卫且全程只读。详细边界见
  [`CONSISTENCY-AGENT-DESIGN.md`](./CONSISTENCY-AGENT-DESIGN.md)。
- 下一顺序：SIM-1 创作/运行时分层地基 → NPC 演进 Agent（最后，最复杂）

**每期独立可用**：工具层本身有用；只读 Agent 不写数据先验证；对话副驾从世界观单点切入。

---

## 九、风险与对策（汇总）

| 风险 | 对策 |
|------|------|
| 提供商不支持 tool calling | 适配层 + 提示词模拟降级 + API 预设单独配模型 |
| Token 成本（多步×多次 / 多模型团队） | 步数/预算上限、智能调度、后台 Agent 限频限额；多 agent 模式定位为工作室 / 专业用户能力 |
| AI 失控改数据 | 前台用户驱动写入全走确认；后台自主 Agent 默认只读；可中断 |
| 数据不一致 | 工具只调现有 store 方法，单一真相 |
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
