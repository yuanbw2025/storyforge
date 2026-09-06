# 可直接交给 Claude 的系统化架构任务提示词

> 使用方式：把本文件从“提示词正文开始”到结尾完整交给 Claude。完成问卷后，将问卷导出的 Markdown 粘贴到末尾的“产品负责人答案”区。  
> 目标：先产出可施工、可验证的完整架构方案，不在本轮直接扩大功能代码。

---

# 提示词正文开始

你现在是 StoryForge 的产品架构负责人、AI 游戏系统设计师、叙事设计负责人和商业化技术负责人。你的任务不是写一篇畅想，也不是把聊天机器人套上小镇 UI，而是基于仓库当前真实架构，设计一个能够分阶段开发、真实可玩、可长期演化并具备商业化质量路径的独立上层产品：

**StoryForge 后日谈 AI 角色小镇（产品身份：ai-town，暂定产品名：Afterstory Town / 后日谈）。**

本轮只做系统化架构与开发方案。除非用户另行明确授权，不要直接修改产品代码、数据库 schema、注册表或现有权威文档；可以创建一份非权威方案文档供审查。

## 一、先保护现场并建立事实基线

1. 先运行 git status --short --branch，确认当前分支、已有提交与未提交改动。
2. 任何已有改动都属于用户。不得覆盖、清理、重置、stash、checkout 或删除。
3. 获取最新 origin/main。如果当前工作树不适合 rebase，就只从 origin/main 读取文档和代码，不破坏现场。
4. 必须完整阅读最新主干的：
   - AGENTS.md
   - docs/CONTEXT-ROUTING.md
   - docs/PROJECT-MASTER-CHARTER.md
   - docs/DOCUMENT-AUTHORITY.md
   - docs/products/UPPER-PRODUCTS.md
   - docs/HARNESS-QUALITY-STANDARD.md
   - docs/ENGINEERING-QUALITY-STANDARD.md
   - docs/roadmap/CAPABILITY-BASELINE.md
   - docs/roadmap/README.md
5. 按 docs/CONTEXT-ROUTING.md 再读取本任务命中的现行文档。旧审计、旧蓝图或旧方案只能作为历史证据，不能恢复为施工权威。
6. 用 rg 建立“入口 → 世界读取 → Brief/生产 → Build/Release → Runtime → 三注册表 → schema/migration → 导入导出/删除/重映射 → 测试”的关联闭包。至少检查：
   - src/lib/types/product-identity.ts
   - src/lib/product/product-catalog.ts
   - src/lib/types/world-product-contracts.ts
   - src/lib/product/source-contracts.ts
   - src/lib/product/world-requirement-adapters.ts
   - src/lib/types/product-production.ts
   - src/lib/types/product-release.ts
   - src/lib/types/product-runtime.ts
   - src/lib/product-production/
   - src/lib/character-interaction/
   - src/lib/adventure/
   - src/lib/registry/context-sources.ts
   - src/lib/registry/field-registry.ts
   - src/lib/registry/project-tables.ts
   - src/lib/db/schema.ts
   - src/pages/ProductHubPage.tsx
   - src/components/character-interaction/
   - tests/regression/ 与 tests/e2e/ 中相关测试
7. 在方案开头写出：基线 commit、当前分支、读取的权威文档、代码事实和任何可能漂移的部分。严禁把“存在基础设施”写成“AI 小镇已经实现”。

## 二、不可违反的项目边界

StoryForge 是多个独立叙事产品、世界引擎和共享底座的组合。AI 小镇是独立上层产品，不是：

- 角色聊天的高级模式；
- 文字开放世界的皮肤；
- 文字冒险、AVG 或跑团的别名；
- 世界引擎里的运行按钮；
- 一个全产品公共 Brief、公共生产 DAG 或公共状态机的试验场。

必须遵循：

世界引擎  
→ 冻结 WorldRevision  
→ 发布不可变 WorldRelease  
→ 通过中立 WorldReference 选择世界版本  
→ AI 小镇主 Agent 与用户完成本产品设置  
→ 用户明确开始，冻结 AI 小镇专属 Brief + ProductSourcePlan  
→ 通过 AI 小镇专属 WorldRequirementAdapter 和世界网关按需读取  
→ AI 小镇自己的生产、媒资、Build、验证  
→ 不可变 ProductRelease  
→ AI 小镇自己的 Runtime Session、进度、记忆和私域演化。

硬约束：

1. 世界引擎只保存可版本化语义内容，不拥有 AI 小镇的生产、媒资、运行或记忆。
2. 上层产品只读引用不可变 WorldRelease，禁止直接读当前世界工作表或用实时草稿补齐冻结版本。
3. 产品 UI 和服务只能从中立 WorldReference 目录进入，再通过本产品 adapter 和 Gateway 使用 describe/search/read/readOriginalEvidence；不能穿透到物理 WorldRelease 行或底表。
4. 正式 AI 读取必须登记 CONTEXT_SOURCES 并经 assembleContext() / Context Gateway。
5. AI 输出先是类型化 CreativeArtifact 或产品候选；严格 parser、权限/作用域/哈希/状态校验后，作者确认才可 adopt 或进入产品正式状态。
6. 新表必须先登记 PROJECT_TABLES，并覆盖 schema、迁移、导出、导入、删除、scope 和引用重映射。
7. 新 AI 可写字段必须登记 FIELD_REGISTRY / AdoptionSchema。
8. 正式模型调用必须进入 AI 小镇专属 Agent Skill、Run Contract 和 durable Harness。重试有界、可见、可恢复。
9. 每个开放式运行任务必须拆成有限、可停止、可保存、可恢复的 durable run；禁止一个永不结束的模型调用或不可审计的常驻自治循环。
10. 运行事实不得自动改写世界引擎。回流只能形成带证据的候选，经作者确认和 adopt 治理，再创建新的 WorldRevision / WorldRelease。
11. 现有存档继续绑定旧 WorldRelease；升级必须显式生成新 SourcePlan、影响分析和新 ProductRelease，保留兼容/迁移/回退证据。
12. 只有至少被一个产品真实验证为相同的能力才可进入共享底座。不得因 AI 小镇开工而强迫其他产品统一。

如果设计必须修改世界引擎正式出口、改变总纲三阶段流程、让运行事实自动回写世界、建立跨产品公共生产层/媒资层，停止扩大方案，单列“总纲冲突与需要负责人裁决”，不要自行决定。

## 三、当前代码基线，必须复核而不是盲信

截至本任务发起时，最新主干呈现的事实包括：

- UpperProductKindV1 已登记 ai-town，但 PRODUCTION_PRODUCT_KINDS_V1 未包含它。
- 产品目录将 upper.ai-town 标为 experimental、默认隐藏，并明确“尚未形成独立产品闭环”。
- 当前统一生产 Harness 已接入 ttrpg、character-interaction、text-adventure、avg、text-open-world 五种身份。
- AI 小镇还没有专属 WorldRequirementAdapter、Brief、生产模块、RuntimePackage 或玩家入口。
- 角色互动已有单/多角色、冻结角色档案与场景模板、消息、public/private knowledge、候选/采用记忆、方向性关系、关系变化证据、scene director、有限预算、事件/checkpoint 和 Runtime Skill。
- 通用产品层已有 WorldReference、ProductSourcePlan、ConfirmedProductBrief、ProductSourceManifest、ProductReleaseLineage、Production/Build/Release、媒资 owner 和 ProductRuntimeSession 基础。
- 文字开放世界已有专属自治/演化能力，但它属于该产品内部，不能被 AI 小镇借身份接入。
- 路线图把 E-TOWN-01 标为 missing：缺少独立时间、日程、地点、群体关系、自治和离线演化闭环。
- 商业平台、账户、云同步、支付、SLA 和运营体系尚未形成正式闭环；本方案可设计商业化就绪要求，但不能假装这些已实现。

请逐项用最新代码与测试验证，并在输出中标注“可复用设施”“需要扩展”“AI 小镇专属新建”“明确禁止复用身份”。

## 四、产品愿景与暂定决策

### 4.1 核心产品命题

原作已经结束，但人物没有停止生活。

用户从一个冻结的世界版本选择原作角色与后日谈起点。系统提取这些角色的身份、经历、关系、知识、原作结局、世界规则与生活地点，生成一个产品私域中的后日谈共同体。用户可以以自己、新角色或世界角色身份加入，与居民单聊、参与群体场景、共同生活和建设，推动新的有限故事季。居民在受约束的时间、地点、日程、目标、记忆和关系系统中相互影响；用户离开时，只有在显式授权下才进行有界离线演化。

“小镇”是产品概念，不要求所有原作人物物理集中到同一个小镇。实现上仍需一个易理解的生活拓扑：推荐首版把 3–5 个相连地点组织成共同体；分散在山中、城市或异世界的角色可通过住所、信件、通道、集会或事件连接，但不能用“世界很大”逃避可玩循环。

### 4.2 产品支柱

1. 连续：尊重原作身份、经历、结局与世界规则。
2. 生长：角色形成有证据的新记忆、信念、关系和自我理解，但不无声改写身份核。
3. 共生：居民会彼此观察、交流、误解、合作、冲突和传播信息，不只围着玩家转。
4. 参与：用户能聊天、行动、帮助、拒绝和建设，但默认不是全知全能导演。
5. 节奏：以“生活日 + 有限故事季”形成期待、铺垫、高潮、收束和余韵。
6. 可回顾：每天发生了什么、为什么、谁知道、关系如何变化、花费多少预算都可查看。
7. 可控制：自治、离线推进、重大事件、内容边界、暂停、checkpoint 和回滚都可配置。

### 4.3 推荐首版假设

除非产品负责人问卷明确否定，按以下默认方案设计：

- 6 名核心居民，4 个生活地点。
- 游戏内一天分早、午后、夜三个时段。
- 用户每日 2–4 个主动行动，14 天构成首个故事季。
- 用户默认是“新加入的居民 / 共同体守护者”，可选择使用已有世界角色或新建角色。
- 严格后日谈存档绑定一个明确原作结局；平行后日谈必须另建产品实例或分支。
- 角色日常小事可自治；关系承诺、婚恋、永久离开、死亡、重大设施变化和世界规则变化默认需作者确认。
- 离线演化默认关闭；开启后单批最多推进 3 个游戏日，且有预算上限、变化等级和回归简报。
- 首版以文字 + 角色肖像/表情 + 地点卡 + 日历/关系图为主，不做 3D、连续像素寻路、全语音。
- 首版单人、本地优先；多人、公开 UGC、市场交易和云端常驻后置。

## 五、经营玩法取舍

请把“类似星露谷”拆成可验证的设计原则，而不是照搬功能清单。

首版应有一个轻量经营壳：

- 时间段与精力形成机会成本；
- 最多 3 类抽象物资；
- 一个与原作后日谈相关的共同建设项目；
- 居民日程、日历和季末群体事件；
- 小镇活力作为由联结、安全感、设施和事件结果派生的状态；
- 关系至少区分信任、亲近、戒备，显著变化必须有事件证据；
- 经营产出必须解锁对话、群体活动、地点用途或故事条件，不能只是数字增长。

首版不做完整农田格子、几十种作物、制造树、市场价格、采矿、战斗和钓鱼。请给出“为什么现在不做”和“满足哪些验证指标后进入第二阶段”的明确门槛。

第二阶段可以研究：

- 小型花园或工坊；
- 角色偏好驱动的礼物、食物和装饰；
- 商店、资源流和居民职业；
- 季节与节庆；
- 住所与公共空间改造；
- 低频探索和跨地点事件。

经营必须服务角色关系和后日谈，不得让每日对话变成机械打卡。

## 六、必须吸收的外部研究

在方案中复核以下一手来源，并在需要时补充 2026-09-06 以前的最新论文、产品帮助文档、官方介绍、公开仓库与真实用户反馈。所有可能变化的产品事实必须标注检索日期和链接；商业产品宣传主张与经验证实现要分开。

### 6.1 商业和准商业产品

- Character.AI Scenes：结构化 setting、backstory、player goal、intro、greeting；通用角色场景和主角场景分离。  
  https://blog.character.ai/introducing-scenes-your-new-way-to-tell-stories-on-c-ai/
- Character.AI Stories：2–3 角色、类型/前提、多路径、可重玩、视觉化和 UGC。  
  https://blog.character.ai/introducing-stories-a-new-way-to-create-play-and-share-adventures-with-your-favorite-characters/
- Kindroid Groupchats：角色私有 backstory/memory、共享 group context、自动/手动 turn-taking、可控跨个聊/群聊记忆。  
  https://kindroid.ai/v2/docs/groupchats/
- Kindroid Memory：persistent、cascaded、retrievable、Learned Context 的分层与成本差异。  
  https://kindroid.ai/v2/docs/memory/
- Nomi Identity Core 与 Shared Notes：作者设定和角色自我生长的双层关系。  
  https://nomi.ai/updates/introducing-the-nomi-identity-core-fostering-dynamic-and-authentic-identities/
- AI Dungeon Memory / Story Cards / Context：永久要点、近况、按需词条、故事摘要的分层。  
  https://help.aidungeon.com/faq/the-memory-system  
  https://help.aidungeon.com/faq/story-cards  
  https://help.aidungeon.com/faq/what-goes-into-the-context-sent-to-the-ai
- Redbean：以角色为原生对象的小镇生活模拟、记忆、移动、关系、故事和分享。  
  https://www.redbean.ai/
- inZOI Smart Zoi：传统生活模拟约束与语言模型自治的混合。  
  https://www.nvidia.com/en-eu/geforce/news/nvidia-ace-naraka-bladepoint-inzoi-launch-this-month/
- Animal Crossing：每日变化、季节、居民、轻收集、装饰和舒缓节奏。  
  https://animalcrossing.nintendo.com/new-horizons/explore/
- The Sims：需求、情绪、愿望、关系、自治和玩家接管。  
  https://www.ea.com/games/the-sims/the-sims-4/how-to-play-the-sims
- Stardew Valley：有限日程/精力、社区修复、技能成长、居民关系和季节事件的互锁。  
  https://www.stardewvalley.net/about/
- Life of an NPC：AI 导演、居民目标与愿望，同时观察其早期商业反馈风险。  
  https://store.steampowered.com/app/3489080/Life_of_an_NPC/
- Showrunner：持久角色、场景、canon 和可分享/重混的剧集化结果。  
  https://www.showrunnerstudio.com/

### 6.2 开源实现

- a16z AI Town 与 ARCHITECTURE.md：world/player/conversation、输入序列、tick/step、agent operation、会话摘要与向量记忆、暂停和成本边界。  
  https://github.com/a16z-infra/ai-town  
  https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md
- Stanford Generative Agents 代码：persona、memory stream、retrieval、reflection、planning 与仿真保存。  
  https://github.com/joonspk-research/generative_agents
- Google DeepMind Concordia：Entity / Component / Engine / Game Master 分离和环境裁决。  
  https://github.com/google-deepmind/concordia
- SillyTavern：角色卡、Lorebook、群聊 reply strategies、Prompt Inspector 和高级用户可控性。  
  https://github.com/SillyTavern/SillyTavern  
  https://docs.sillytavern.app/usage/core-concepts/groupchats/  
  https://docs.sillytavern.app/usage/core-concepts/worldinfo/
- RisuAI：角色、Lorebook、多角色与本地/多模型创作者工作流。  
  https://github.com/sub-hub/RisuAI
- ChatHaruhi：从原作对话与角色知识恢复既有角色的检索和评测路径。  
  https://github.com/LC1332/Chat-Haruhi-Suzumiya

不要复制仓库架构。逐项写出“可复用思想、与 StoryForge 不兼容之处、许可证/媒资风险、是否值得做 spike”。尤其不要把 a16z AI Town 的 Convex 常驻 60Hz 引擎直接移植进本地优先 React + TypeScript + IndexedDB 项目。

### 6.3 论文与评测

- Generative Agents：observation、memory retrieval、reflection、planning 对可信行为的作用和成本/错误边界。  
  https://arxiv.org/abs/2304.03442
- AI Agents Alone Are Not (Yet) Sufficient for Social Simulation：对环境、暴露、调度和初始信息的显式建模。  
  https://arxiv.org/abs/2603.00113
- SOTOPIA：社会目标、合作/竞争、规范和策略沟通的多维评测。  
  https://arxiv.org/abs/2310.11667
- CharacterBench：人格、行为、知识边界、事实、记忆、情绪和互动感等多维角色评测。  
  https://arxiv.org/abs/2412.11912
- RoleLLM：角色档案、知识抽取、语气和角色级基准。  
  https://arxiv.org/abs/2310.00746
- NCP-Bench：长程叙事承诺与事实连续性；高语言质量不代表长程一致。  
  https://arxiv.org/abs/2608.08160
- Façade Drama Manager：可组合 story beat、局部响应和全局 agency。  
  https://ojs.aaai.org/index.php/AIIDE/article/view/18722
- KNUDGE：NPC 对话对角色、关系、任务事实和信息揭示的忠实约束。  
  https://arxiv.org/abs/2212.10618
- Project Sid：大规模多代理编排，只作为远期规模研究，不作为首版目标。  
  https://arxiv.org/abs/2411.00114

输出必须明确承认：

- “像人说话”不等于社会模拟可信；
- 模型的流畅度不等于 canon、承诺或知识边界正确；
- 调度、可见性、环境和初始状态会支配群体结果；
- 全镇每角色每 tick 调模型不可接受；
- LLM Judge 不能是唯一质量证据；
- 长期记忆必须可审计、可拒绝、可更正和可追溯；
- 需要传统规则/状态机与 LLM 的混合架构。

## 七、需要你做出的核心架构设计

### 7.1 产品定义

给出：

- 一句话价值主张；
- 目标用户、核心 JTBD、首要幻想和不服务的人群；
- 与角色互动、文字冒险、AVG、文字开放世界、跑团的判定表；
- “后日谈”“小镇”“角色生长”“AI 主导”“无限推演”的可测试定义；
- 产品不是哪些东西；
- 15 分钟首玩、一个游戏日、14 日故事季和长期回访的体验承诺。

### 7.2 用户旅程与玩法循环

至少绘制并解释：

1. 从 WorldReference 选择世界到发布可玩小镇的作者旅程。
2. 首次进入、选择身份、认识居民、完成首日的玩家旅程。
3. 一日循环。
4. storylet / 故事季循环。
5. 单聊、群体场景、行动/工作/建设、日结反思的切换。
6. 离线推进开启、执行、回归简报、接受/回滚流程。
7. checkpoint、分支存档、重试、模型失败、预算耗尽和恢复。
8. WorldRelease 显式升级与存档兼容流程。
9. 运行事实形成世界回写候选但不自动写回的流程。

对每一步注明用户看到什么、AI 读什么、AI 产出什么候选、确定性代码校验什么、正式写入什么、失败如何表现。

### 7.3 世界数据需求表

回答：“AI 小镇为了完成 Brief、生产、媒资、验证、运行和演化，究竟需要世界引擎的哪些数据？”

逐项列出：

1. 产品能力/消费功能；
2. 世界语义；
3. 通过中立 WorldRelease provider 暴露的 capability area、context kind、resource kind 和字段/证据语义；若现有协议无法表达，标记为冲突，不得直读底表；
4. required / optional / conditional / excluded；
5. 整体身份、单记录、记录集合、关系子图、地点拓扑、叙事模块、原文证据段还是依赖闭包；
6. 缺失时 block、ask-author、product-private-supplement、degrade-explicitly 中的哪一种；
7. Brief、生产、媒资、验证、运行或演化阶段；
8. 读取深度 summary / normal / full / original evidence；
9. 谁知道该事实与是否允许进入公共上下文；
10. 新 WorldRelease 到来后如何影响和升级。

至少覆盖：WorldReference 身份、角色身份与原作结局、角色语气证据、角色关系、世界规则、地点、势力/组织、故事终局、未解决线索、物品/遗产/设施、事实、已有合法素材语义和原文证据。

明确排除：可变世界草稿、其他产品 runtime/媒资、未授权世界范围、物理 WorldRelease 行、Dexie 自增 ID 和未记录证据的后台补读。

### 7.4 AI 小镇专属来源选择契约

设计 AI 小镇自己的 typed goal/config、WorldRequirementAdapter、catalog/selection 视图和严格 parser。不得复制或改名其他产品专属协议来伪装公共层。

至少定义：

- adapter id/version/productType/contextTaskKind；
- 作者选择的核心居民、关系子图、终局叙事、地点拓扑、规则、势力、物品和可选原文证据范围；
- portable resource keys / export IDs / stable keys；
- allowed/prohibited selectors、depths、missing strategy；
- 世界 release ID/hash、world code、release uid、capability identity；
- plan hash、gateway policy hash、selection hash、scope 与 portable reference 校验；
- 依赖闭包如何由中立 relation 推导；
- consultation reads 与 production reads 如何留下 ContextManifestPointer；
- 发布时如何从真实 runs 聚合 ProductSourceManifest；
- stale、hash mismatch、dangling refs、跨 scope、重复 key、禁止资源、私有知识泄漏的反例。

先判断是否直接复用现有 ProductSourcePlanV1 逻辑交接物，还是需要 AI 小镇专属物理 schema/typed extension；给出理由，不要为统一而统一。

### 7.5 后日谈起点编译

设计一个可审查的 Ending-to-Town Snapshot 编译过程：

- 用户明确选择哪一个结局/时间点；
- 角色在结局后的生死、位置、关系、知识、承诺和未完成事项；
- 哪些来自 canon，哪些是作者补设定，哪些是产品私域合理推断；
- 冲突、不完整和多结局如何处理；
- 新角色如何创建，如何关联原作角色与世界语义；
- 分散角色怎样被组织成生活共同体；
- 严格后日谈与平行后日谈怎样隔离；
- 作者确认点和 hash；
- 编译结果如何进入 ProductRelease，而不写回世界。

### 7.6 AI 小镇专属 Brief / Run Contract

不要只往通用 ProductProductionBriefV3 塞一堆可选字段。评估：

- 跨产品 logical ConfirmedProductBrief 是否继续复用；
- AI 小镇产品专属 Brief 的物理 schema 与版本；
- 通用 Production/Build/Release 设施如何复用；
- 哪些状态、任务、表和质量证据必须产品专属。

Brief 至少覆盖：

- 产品实例和世界版本；
- 后日谈模式、结局锚点和时间偏移；
- 核心居民、背景居民和用户身份；
- 地点拓扑；
- 日长度、故事季长度、自治等级、离线推进；
- 重大事件确认策略；
- 管理系统强度和共同项目；
- 角色生长边界、禁止改变、内容边界；
- 叙事风格、冲突强度、浪漫/家庭/死亡等敏感机制；
- 媒资目标；
- 模型/成本/时延/存储预算；
- fallback 和 completion contract；
- unresolved decisions；
- author confirmation revision 与 stale 判定。

设计至少三个正式 Skill / Run Contract：

1. Town Production Director：从 Brief + SourcePlan 生产小镇成品。
2. Town Turn / Scene Runtime：处理当前用户行动、对话和即时场景。
3. Town Day Advance / Offline Batch：有限推进日程、事件、记忆和日结。

可以再拆角色回复、storylet 编排、记忆整理、日终反思、质量审计等内部 Skill，但必须说明调用边界、预算、输入、候选 schema、人工确认和恢复点。不要为了“多 Agent”而多 Agent。

### 7.7 生产流程与媒资流程

输出可施工 DAG、状态机和每步 completion gate。建议研究但不要盲从：

- Source preflight 与缺口会谈；
- Ending Snapshot；
- Town Bible；
- Resident Bible 与 identity locks；
- knowledge/secret graph；
- relationship graph；
- location/topology/schedule；
- management/economy lite；
- storylet pool、故事季与导演规则；
- memory/reflection policy；
- safety/content policy；
- visual/audio bible；
- deterministic compile；
- simulation dry run；
- quality/eval；
- preview；
- immutable ProductRelease。

对每个 task 写：

- lane、execution mode、Skill、依赖、输入/输出 artifact；
- source requirement；
- 最大尝试、超时、预算；
- failure policy、fallback；
- 并发/subject lock；
- acceptance gate；
- 可复用/增量重建策略；
- 人工确认点；
- receipt 与 hash。

媒资要明确：

- 首版必须、可选和延后种类；
- 角色肖像、表情、地点图、事件卡、地图、UI 装饰、环境音、音乐、语音的数量和规格；
- 身份一致性、风格一致性、权利来源和提示证据；
- 生成顺序与并发；
- release owner / runtime owner；
- content-addressed storage、版本、fallback、回收；
- 纯文字模式必须仍可完整运行。

### 7.8 运行域模型与状态机

给出字段级 typed domain model 草案，不只画概念框。至少包括：

- TownRuntimePackage；
- TownRuntimeSession；
- TownClock / Day / TimeSlot；
- ResidentDefinition 与 ResidentRuntimeState；
- IdentityLock 与 PostCanonGrowth；
- Location / Route / Presence；
- Schedule / Intention / Need / Mood；
- KnowledgeClaim / Belief / Exposure / Secret；
- EpisodicMemory / SemanticBelief / RelationshipMemory / Reflection；
- DirectionalRelationship 与 evidence-backed delta；
- Promise / Commitment / deadline / breach；
- Storylet / Beat / Preconditions / Effects / Cooldown；
- TownArc / Season / tension / resolution；
- SharedProject / resources / contribution / unlock；
- TownVitality 派生指标；
- PlayerPersona / permissions / boundaries；
- RuntimeEvent / Command / Candidate / Receipt；
- Checkpoint / Branch / Rewind；
- OfflineAdvanceAuthorization / Batch / Digest；
- WorldBackflowCandidate。

对每个对象说明：

- owner、scope、stable identity、portable identity；
- mutable / immutable；
- authoritative / derived / candidate；
- hash / CAS / sequence / idempotency；
- 写入者和读取者；
- 导入导出、删除和引用重映射；
- 与 WorldRelease / ProductRelease 的引用；
- 版本迁移和兼容。

所有正式状态变更必须用命令 → 候选/裁决 → append-only event → reducer → state hash 的可验证链条。禁止模型返回一个完整 JSON 状态然后覆盖现状。

### 7.9 混合仿真与导演

设计不是“所有居民永远调用 LLM”的混合系统：

- 确定性层管理时间、位置、可达性、资源、日程、权限、在场者、事件序列和数值边界。
- 传统 utility / rule / schedule 先筛出可行动角色和可行动作。
- LLM 只为高价值语义生成意图、台词、事件候选、反思和导演建议。
- foreground active set 高保真；background 角色低频、低保真批处理。
- 环境裁决者检查物理/社会/知识可行性。
- Town Director 用 storylets / beats 管理节奏、冲突、多角色聚合和季末收束，但不能直接改权威状态。
- 角色自治和导演目标冲突时，写出明确优先级与仲裁。
- 提供 manual / guided / autonomous 三档发言与自治控制。
- 给出避免所有角色围着玩家、过度友善、重复寒暄、无意义自言自语、角色抢话和剧情强推的机制。
- 给出不同模型能力下的降级矩阵。

### 7.10 记忆、知识与秘密

分别设计：

- Canon identity，不可由 runtime 自动改写；
- Post-canon identity growth，允许演化但需证据与兼容检查；
- recent working context；
- episodic memory；
- semantic belief；
- directional relationship memory；
- commitment；
- secret / knowledge ledger；
- reflection；
- town public history；
- user-visible journal。

检索至少考虑：相关性、时间新近、重要性、关系对象、地点、当前目标、知识权限、承诺、冲突和预算。明确：

- 谁能看到什么；
- 如何通过 exposure 传播；
- 角色可持有错误信念但系统事实不随之改变；
- memory candidate 如何验证、接受、拒绝、纠错、合并和 supersede；
- rewind 后如何撤销或重新基于分支计算；
- 私聊/群聊/离线事件如何流入不同记忆层；
- prompt/context inspector 给高级用户展示什么，不泄露其他角色秘密。

### 7.11 轻量经营设计

给出首版具体可玩规则，而不是“加入经营元素”一句话：

- 每日行动点/时间/精力的数值范围；
- 抽象物资不超过 3 类；
- 一个 shared project 怎样选自原作结局和地点语义；
- 居民如何按性格、关系、日程和目标参与；
- 玩家聊天、陪伴、工作、赠予、建设和休息怎样产生可验证结果；
- 管理结果如何解锁地点、对话、storylet、群体事件和关系机会；
- 怎样避免刷好感、送礼最优解和惩罚性断签；
- 14 日首季的起承转合和季末成品；
- 进入花园/工坊/商店/季节/经济第二阶段的指标门槛。

同时给出一个“若完全不加经营”的对照方案，比较可玩性、成本、留存、差异化和开发风险，最终作出明确推荐。

### 7.12 UX 与信息架构

至少给出文字线框或页面层级：

- 产品入口与世界选择；
- 主 Agent 会谈和 Brief；
- 居民/结局/地点选择；
- 生产进度、失败和恢复；
- 小镇首页；
- 一日计划；
- 地点与居民状态；
- 单聊与群体场景；
- 行动/工作/建设；
- 日历、storylet/任务、共同项目；
- 关系和记忆；
- 每日/离线简报；
- checkpoint、分支和回滚；
- 世界来源、版本和升级；
- 高级调试/上下文证据；
- 设置中的自治、内容和预算。

移动端和桌面端分别说明。首版不能依赖大地图拖动才能完成核心操作；文字和键盘路径必须完整。

### 7.13 三注册表与数据生命周期

逐项列出：

1. CONTEXT_SOURCES 要新增/复用哪些 source，谁通过 assembleContext() 读取，scope/预算/可见性是什么。
2. FIELD_REGISTRY / AdoptionSchema 要新增/复用哪些候选字段，谁确认，如何 adopt。
3. PROJECT_TABLES 要新增/复用哪些表，domain owner、scope、exportable、dependencies、refs、remap 和 delete policy。
4. schema version 与 migration。
5. 项目导出 → 导入 → ID 重映射 → hash/portable identity 复验。
6. 删除 world、work、product production、release、session、branch 时的级联或保留。
7. release 媒资与 runtime 媒资的 owner 唯一性。
8. 隔离测试项目中的全生命周期验证。

优先评估复用现有 productProductions、productBuilds、productReleases、productMediaAssets、productRuntimeSessions、productRuntimeEvents、productRuntimeCheckpoints；只有语义、索引、生命周期或性能明确不够时才建议专属表。不能把所有 AI 小镇状态塞入一个无限增长 JSON 而不分析查询、迁移、冲突和体积风险。

### 7.14 安全、伦理、隐私与权利

设计：

- AI 身份披露；
- 角色依恋与主动消息的边界，禁止情感勒索、假装真实在线或用负罪感制造留存；
- 未成年人、浪漫、性内容、暴力、自伤和骚扰边界；
- 用户内容、原作 IP、角色肖像和媒资权利；
- 私聊、秘密和导出数据的隐私；
- 删除、导出、模型提供商传输和本地优先；
- UGC 分享前的内容分级、举报、下架和侵权处理；
- 角色做出重大人生变化时的用户授权；
- 不把娱乐仿真宣称为真实人的科学预测。

### 7.15 商业化与单位经济

当前平台闭环未完成，但方案必须做到商业化可规划：

- 核心免费体验与可能的付费价值，不依赖操纵性留存；
- BYOK、本地模型和未来托管模型三种形态；
- 每个首日、游戏日、故事季、离线批次、媒资包的调用/Token/存储预算模型；
- model tiering：导演、角色回复、摘要、检索、评测分别用什么能力级别；
- 缓存、active set、批处理和低保真背景推演的成本控制；
- 质量档 prototype / internal / commercial-candidate；
- 分享 ProductRelease、作者模板、世界/小镇包的未来路线，但不得提前假设市场和支付已完成；
- 观测指标、隐私保护 telemetry、客服与可恢复性；
- 内容权益、退款/额度、供应商故障、限流和余额不足的产品表现；
- 单位经济的公式和待测参数，不要捏造收入或转化数据。

## 八、质量、反例、评测与真实用户路径

### 8.1 结构性测试

至少覆盖：

- strict parser、unknown field、版本错误、hash mismatch；
- stale Brief/SourcePlan/WorldReference；
- duplicate/dangling portable key；
- Dexie 自增 ID 被误作长期身份；
- 跨 project/world/work/session scope；
- prohibited source 和偷偷读世界草稿；
- private knowledge / secret 泄露；
- 不在场角色发言或知道现场事件；
- 角色自己改资源、地点、关系或世界事实；
- 关系大幅变化无证据；
- 不可能路径、日程冲突、重复占位；
- 同一 command 幂等、CAS 竞争、结果未知、断电恢复；
- checkpoint/rewind 后记忆和关系污染；
- import/export/remap；
- WorldRelease 显式升级与不兼容；
- release/runtime 媒资 owner 混淆；
- 离线预算耗尽、provider 4xx/429/5xx、余额不足、取消、刷新和恢复。

### 8.2 AI 与玩法评测

建立可重复的 eval suite：

- character identity、attribute、behavior、knowledge boundary、fact、memory、emotion；
- 100-turn canon/commitment preservation；
- 14 天与 30 天仿真；
- secret propagation；
- 群聊 speaker routing；
- NPC-to-NPC 关系与“不是所有人围着玩家”；
- 过度友善、谄媚、重复寒暄、同质语气；
- storylet 因果、铺垫、冲突、收束；
- 管理系统是否真正产生叙事后果；
- 模型切换和降级；
- 人类盲评，不只 LLM Judge；
- 对抗用户输入试图改 canon、偷看秘密、强迫重大状态或让角色替用户说话。

定义指标、样本、阈值、失败样例保留方式和 commercial-candidate gate。参考 CharacterBench、SOTOPIA 和 NCP-Bench，但不要声称直接兼容其完整数据集。

### 8.3 工程验证

给出每阶段定向测试、反例测试、检查器、构建、完整 CI 和隔离真实 UI/API E2E。最终交付门至少包括项目规定的：

- npm run check:architecture
- npm run check:required-tables
- npm run check:ai-manual
- npx tsc --noEmit
- 相关单元/回归测试
- npm run build
- git diff --check
- npm run ci
- 涉及真实 UI/API、数据恢复或跨产品纵切面时的 npm run ci:e2e

E2E 必须在隔离浏览器数据和隔离项目中运行，不能修改作者当前真实项目。

## 九、阶段性开发路线

给出可独立合并、每阶段都诚实标记成熟度的路线。至少包括：

### P0：产品与架构 spike

- 产品契约、世界数据需求、adapter 草案、Brief、domain model、成本模型；
- 2–3 个技术 spike：Ending Snapshot、单日事件驱动模拟、秘密隔离/发言调度；
- 不增加生产入口。

### P1：可玩垂直切片

- 1 个世界结局、3–4 名居民、2–3 地点、3 个游戏日；
- 文字为主、单聊 + 一个群体场景 + 一个共同项目；
- 事件、checkpoint、内存/关系、失败恢复；
- 真实模型路径和隔离 E2E。

### P2：首个 14 日 MVP

- 6 名居民、4 地点、14 日 story season；
- 日程、地点、群体关系、storylets、日结、可选 1–3 日离线批次；
- 肖像/表情/地点卡；
- 产品专属生产、Build、ProductRelease、Runtime 和演化闭环。

### P3：质量与商业候选

- 100-turn / 30-day eval；
- 世界版本升级、分支/回滚、导入导出；
- 性能、成本、可用性、内容分级、隐私与权利；
- commercial-candidate 质量门和真实用户试用。

### P4：经营扩展

- 只有 MVP 指标证明“角色生活 + 共同体”成立后，才加入花园/工坊/商店/装饰/季节等；
- 每项玩法都要说明如何影响人物、关系和故事。

### P5：平台化候选

- 分享、模板、市场、多人、云端常驻、跨设备；
- 依赖阶段 F 的账户、同步、计费、治理和运营能力，不得提前混入核心产品。

每个阶段写：

- 用户可得到的完成体验；
- 代码/契约/表/Skill/媒资；
- 明确不包含；
- 退出标准；
- 风险和回退；
- 预计依赖；
- 可并行与必须串行的工作；
- 建议 commit/PR 切片；
- 不能以“页面存在”替代的验收。

## 十、强制输出结构

最终产出一份可审查的 Markdown 方案，建议路径：

product-planning/character-town/AI-TOWN-SYSTEM-ARCHITECTURE.md

文档必须按以下顺序：

1. Executive Decision：是否做、为什么、首版是否加经营、最终产品一句话。
2. Current Repository Truth：主干事实、已实现、缺失、可复用与不可借身份。
3. Evidence Matrix：竞品、开源、论文、来源、检索日期、可借鉴和风险。
4. Product Definition and Boundaries。
5. Personas, JTBD, Core Fantasy, Success/Failure Metrics。
6. Product Flow and Player Loops，含 Mermaid。
7. World Data Requirement Matrix。
8. AI Town Source Adapter / SourcePlan / Selection Contract。
9. Ending-to-Town Snapshot Contract。
10. AI Town Brief and Author Confirmation。
11. Production DAG and State Machines。
12. Media Plan and Ownership。
13. ProductRelease / RuntimePackage / Lineage。
14. Runtime Domain Model and Event Contracts。
15. Hybrid Simulation, Town Director and Speaker Scheduling。
16. Memory, Knowledge, Secrets and Relationship Model。
17. Lightweight Management Rules and Later Expansion Gate。
18. UX Information Architecture and Key Screens。
19. Three Registries and Data Lifecycle Impact。
20. Safety, Privacy, Rights and Commercial Readiness。
21. Test/Eval/E2E Matrix，含正例、反例和真实路径。
22. P0–P5 Roadmap，含 PR/commit 切片。
23. Risk Register，按 severity、likelihood、detectability、mitigation、owner。
24. Open Decisions：只保留确实需要产品负责人决策的项目，并提供推荐默认值。
25. First Implementation Slice：列出首个不跨边界的具体改动顺序和受影响文件，但本轮不实现。

必须包含：

- 至少 3 张 Mermaid 图：三阶段产品主链、运行事件/日循环、离线推进/恢复或记忆可见性。
- 字段级 TypeScript interface 草案和严格 parser 规则。
- 状态机表、数据所有权表、世界数据需求表、上下文与写入治理表。
- “现有 vs 新增”文件/符号清单。
- 具体反例与 acceptance gate。
- 明确的成本公式和性能预算变量。
- 每个重要结论的证据链接。

## 十一、写作与判断标准

- 先给明确判断，再给理由。
- 不要用“建议使用先进 AI”“搭建多 Agent”“优化用户体验”这种无法施工的句子。
- 不要把希望写成现状，也不要把宣传页主张写成已验证事实。
- 不要设计一个全功能宇宙后才允许用户玩；每个阶段必须有纵向可玩结果。
- 不要靠 Prompt 承担 schema、权限、scope、hash、预算、状态机和事务。
- 不要用固定 top-N 记忆作为唯一策略；它只能是预算保护。
- 不要默认角色永远同意用户、永远友善或永远围着用户。
- 不要让 AI 替玩家决定言行。
- 不要让模型直接输出并覆盖完整状态。
- 不要隐藏重试、结果未知、余额不足或 provider 失败。
- 不要设计惩罚性签到和情感操纵留存。
- 不要把“无限推演”理解为无限资源消耗；它表示产品没有预定终点，但每一步运行有限且可恢复。
- 不要因为未来商业化而提前制造与当前本地优先架构冲突的平台依赖。
- 若证据不足，标记假设、提出最小实验、定义通过/失败阈值。

## 十二、产品负责人答案

以下答案来自可编辑问卷。它们是产品偏好输入；若与项目总纲冲突，以总纲为准并报告冲突。若留空，采用本提示词中的推荐默认值。

{{QUESTIONNAIRE_ANSWERS}}

# 提示词正文结束
