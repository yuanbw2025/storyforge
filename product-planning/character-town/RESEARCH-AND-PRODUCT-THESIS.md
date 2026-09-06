# 后日谈 AI 角色小镇：竞品、论文与产品判断

> 调研日期：2026-09-06  
> 文档性质：非权威研究输入，不改变 StoryForge 总纲、产品边界或现行代码事实。正式设计必须继续服从最新主干的 AGENTS.md、项目总纲、上层产品契约、Harness 与工程质量标准。

## 1. 结论先行

StoryForge 不应把现有“角色聊天”页面不断扩展成文字游戏，也不应在第一版复制一个完整的星露谷。最有差异化且与现有世界引擎最匹配的产品，是：

**一个引用不可变 WorldRelease、从原作结局开始、以熟悉角色的日常延续和群体关系演化为核心的“后日谈生活模拟器”。**

它的主要消费单位不是单条消息、单个任务或地图探索，而是“一个可感知、有结果、可回顾的生活日”。用户可以和某个角色单独交谈，也可以参与群体场景、共同建设项目和新的有限故事季；即使用户不在所有现场，角色也有受约束的日程、目标和相互影响。但任何“离线演化”都必须是有界、可见、可暂停、可回滚的有限运行，而不是持续烧模型的后台自言自语。

建议工作名：**后日谈 / Afterstory Town**。产品身份仍为 StoryForge 的 ai-town；“小镇”表示一个可理解的生活共同体，不强制所有角色物理上住在同一条街。

## 2. 与现有产品的边界

| 产品 | 核心消费单位 | 玩家期望 | 系统必须拥有 |
|---|---|---|---|
| 角色互动 | 一次场景或一次对话 | 和一个或少数角色高质量交流 | 说话者调度、角色语气、场景记忆、关系变化 |
| 后日谈 AI 小镇 | 一日 / 一个事件周期 | 看见熟悉角色继续生活，并通过陪伴与建设改变共同体 | 时间、地点、日程、群体关系、居民目标、事件导演、经营状态、有界离线演化 |
| 文字冒险 | 一段选择与结果 | 经历目标明确的冒险 | 选择、挑战、路径、结局 |
| 文字开放世界 | 一个行动 / 地区演化 | 自由探索广阔世界并创造任务 | 区域、移动、任务、资源、开放式世界变化 |

AI 小镇可以复用角色互动已经验证的消息、知识、记忆、关系、场景导演和运行事件设施，但不能借用 character-interaction 的产品身份、Brief、Release 或 Session。它必须建立自己的来源需求适配器、Brief、生产模块、ProductRelease、运行契约与质量门。

## 3. 市场产品观察

### 3.1 角色聊天与互动叙事

| 产品 | 已验证机制 | 对 StoryForge 的启示 | 不应照搬 |
|---|---|---|---|
| Character.AI Scenes | 场景创建明确区分通用角色场景与主角场景，并要求设置地点、背景、玩家目标、开场和第一句；结构化起点降低空白聊天门槛 | 小镇启动前也要冻结“时期、地点、用户身份、共同目标、开场事件”，不能只给输入框 | 只把每次体验做成孤立短场景 |
| Character.AI Stories | 2–3 个角色、类型与前提，形成视觉化、多路径、可重玩的引导叙事 | 小镇应有有限“故事季/事件链”，避免无限聊天失去节奏 | 把小镇完全做成选项式文字冒险 |
| Kindroid Groupchats | 每个角色读取自己的背景与记忆，不读取其他角色的私有背景；另有共享 group context；自动或手动发言；个聊与群聊记忆共享可控制 | 私有知识、公共知识、发言调度与跨场景记忆必须是显式契约 | 把全部角色卡和全部历史一次性塞入上下文 |
| Nomi | 单人和群聊共享长期人格演化；群聊支持手选下一人或自动决定；Shared Notes 与 Identity Core 分离作者设定和角色自我生长 | “作者锁定的人物核心”与“运行中形成的自我理解”应分层，后者不能覆盖前者 | 不可见、不可审计的核心人格自动改写 |
| AI Dungeon | Plot Essentials 永久在线；Story Cards 只在触发相关时进上下文；自动记忆、故事摘要和场景组件分层 | 世界语义、长期事实、近况、地点/人物词条要按需检索，提供上下文检查证据 | 靠关键词触发作为唯一检索与权限机制 |
| SillyTavern | Lorebook 动态注入；群聊有 Manual、Natural、List、Pooled 等发言策略；角色说话概率可调，活动角色卡可交换 | 发言编排必须可观察、可人工接管；角色私有卡、群体公共信息和会话信息要分开 | 把提示词拼装当成完整状态管理 |
| RisuAI | 角色卡、Lorebook、多角色群聊、跨模型和本地部署构成强创作者工具箱 | 高级用户需要可检查、可导入导出的角色与记忆数据 | 第一版暴露过多提示词参数导致产品只服务极客 |

来源：

- [Character.AI Scenes](https://blog.character.ai/introducing-scenes-your-new-way-to-tell-stories-on-c-ai/)
- [Character.AI Stories](https://blog.character.ai/introducing-stories-a-new-way-to-create-play-and-share-adventures-with-your-favorite-characters/)
- [Kindroid Groupchats](https://kindroid.ai/v2/docs/groupchats/)
- [Kindroid Memory](https://kindroid.ai/v2/docs/memory/)
- [Nomi Identity Core](https://nomi.ai/updates/introducing-the-nomi-identity-core-fostering-dynamic-and-authentic-identities/)
- [Nomi 入门与群聊](https://nomi.ai/nomi-knowledge/nomi-101-a-beginners-guide-to-getting-started-with-your-ai-companion/)
- [AI Dungeon Memory](https://help.aidungeon.com/faq/the-memory-system)
- [AI Dungeon Story Cards](https://help.aidungeon.com/faq/story-cards)
- [SillyTavern Group Chats](https://docs.sillytavern.app/usage/core-concepts/groupchats/)
- [SillyTavern World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)
- [RisuAI](https://github.com/sub-hub/RisuAI)

### 3.2 AI 小镇与生活模拟

| 产品或实践 | 已验证机制 | 对 StoryForge 的启示 | 风险信号 |
|---|---|---|---|
| Redbean | 明确定位为角色原生生活模拟：创建带人格、记忆和移动的 OC，放进小镇，观察其交友和故事演化，可从一个小镇扩到世界 | 市场上已经有人验证“角色不是聊天列表，而是生活共同体”的产品语言；StoryForge 的差异应是原作 WorldRelease 与后日谈连续性 | 仅有“会走、会聊”还不足以证明长期可玩性 |
| a16z AI Town | 世界、玩家、对话成员、输入日志、tick/step、代理循环和向量记忆分层；对话结束后摘要并检索相似记忆 | 仿真状态、代理状态和客户端显示应分层；所有动作通过可排序输入和状态变更 | 60Hz 移动和常驻后台不是本地优先 StoryForge 的首版目标；其当前对话以两人为主 |
| Stanford Generative Agents | 观察、记忆检索、反思、计划共同提高可信度，25 个角色能传播消息并协调活动 | 居民要有可检索经历、日程和周期反思，而非每轮只重述角色卡 | 25 人两天仿真代价高；检索错误、虚构补充和过度礼貌会破坏可信度 |
| Concordia | Entity、Component、Engine 分离，Game Master 把自然语言意图裁决为世界可接受结果 | 小镇导演应是环境裁决者，角色不能凭一句话直接改状态 | GM 若也自由生成事实，会成为新的单点漂移源 |
| Project Sid | 通过编排支持 10–1000+ 代理形成角色分工、规则和文化传播 | 大规模可以作为远期研究，但不应成为首版卖点 | 规模不等于角色深度，也带来巨大成本和可解释性问题 |
| inZOI Smart Zoi | 在传统生活模拟和环境约束上增加语言模型驱动的自治判断 | 最稳妥路径是混合架构：规则世界给边界，模型给意图和语言 | 纯模型自治会让行为不可预测，设备与成本要求也更高 |
| Animal Crossing | 每日变化、季节、居民、收集、装饰和轻量事件构成舒缓回访节奏 | “每天有一点变化”和熟人关系比无限事件量更重要 | 真实时间强制会惩罚断更用户，不适合默认采用 |
| The Sims | 需求、情绪、愿望、关系和自治动作叠加，同时给玩家手动控制 | 居民行为应由少量可解释驱动力产生，并允许玩家接管自治级别 | 全套人生模拟的系统面过大，不适合首版 |
| Stardew Valley | 有限日程与精力、成长技能、社区修复、居民关系、季节事件和资源循环相互咬合 | 经营必须服务“共同生活与关系”，首版可借用日循环和社区项目 | 农业、采矿、钓鱼、战斗、制造、经济同时开发会淹没核心验证 |
| Life of an NPC | AI 导演小镇、居民各有目标与愿望，可操纵目标或增添物体 | “改变约束后观察居民反应”是有趣的沙盒能力 | Steam 早期评价混合，说明“什么都可能发生”本身不是稳定乐趣 |
| Showrunner | 持久的角色、场景和 canon 跨集保存，观众可观看、创作、重混 | 小镇的事件回顾可形成可分享的“后日谈剧集” | 视频生成与社区传播不是首版生存条件 |

来源：

- [Redbean](https://www.redbean.ai/)
- [a16z AI Town](https://github.com/a16z-infra/ai-town)
- [AI Town Architecture](https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md)
- [Generative Agents](https://arxiv.org/abs/2304.03442)
- [Concordia](https://github.com/google-deepmind/concordia)
- [Project Sid](https://arxiv.org/abs/2411.00114)
- [NVIDIA Smart Zoi](https://www.nvidia.com/en-eu/geforce/news/nvidia-ace-naraka-bladepoint-inzoi-launch-this-month/)
- [Animal Crossing: New Horizons](https://animalcrossing.nintendo.com/new-horizons/explore/)
- [The Sims 4](https://www.ea.com/games/the-sims/the-sims-4/how-to-play-the-sims)
- [Stardew Valley](https://www.stardewvalley.net/about/)
- [Life of an NPC](https://store.steampowered.com/app/3489080/Life_of_an_NPC/)
- [Showrunner Studio](https://www.showrunnerstudio.com/)

## 4. 研究论文给出的设计约束

| 研究 | 可借鉴 | 必须吸取的警告 |
|---|---|---|
| Generative Agents | observation → retrieval → reflection → planning 是可信长期行为的基础模块 | 记忆检索和反思不是天然正确；高频全镇推演价格高且慢 |
| AI Agents Alone Are Not (Yet) Sufficient for Social Simulation | 把环境、暴露范围、调度和初始信息显式建模 | 角色对话“像人”不等于群体模拟有效；结果常被调度协议主导 |
| SOTOPIA | 用社会目标、合作、竞争、规范和策略交流做多维评测 | 强模型仍在社会常识和策略沟通上明显弱于人类 |
| CharacterBench | 角色质量不只是口吻，还包含人格、行为、知识边界、事实、记忆、情绪和互动感 | 只做“像不像原角色”的单一 LLM Judge 不够稳定 |
| RoleLLM | 角色档案、角色知识提取、语气示例和角色级评测需要分开 | 把整部作品全文塞入提示词成本高且会污染知识边界 |
| Narrative Commitment Preservation Benchmark | 用结构化事实、轨迹和承诺持续检查长程叙事 | 语言质量高并不代表事实连续；公开结果中最强模型在 20 轮后的完整存活率仍只有 42% |
| Façade / Drama Management | 用可组合 story beat 在局部响应玩家，同时保持全局节奏与因果 | 纯自由生成会缺少铺垫、收束和可解释的全局 agency |
| KNUDGE | NPC 对话应忠于人物、实体关系和任务事实，并控制信息揭示 | 对话若不受知识与状态约束，会提前泄密或生成不存在的任务事实 |

来源：

- [Generative Agents](https://arxiv.org/abs/2304.03442)
- [AI Agents Alone Are Not (Yet) Sufficient for Social Simulation](https://arxiv.org/abs/2603.00113)
- [SOTOPIA](https://arxiv.org/abs/2310.11667)
- [CharacterBench](https://arxiv.org/abs/2412.11912)
- [RoleLLM](https://arxiv.org/abs/2310.00746)
- [NCP-Bench](https://arxiv.org/abs/2608.08160)
- [Structuring Content in the Facade Interactive Drama Architecture](https://ojs.aaai.org/index.php/AIIDE/article/view/18722)
- [KNUDGE](https://arxiv.org/abs/2212.10618)

## 5. 推荐产品形态

### 5.1 核心承诺

“原作结束了，但人物没有停止生活。你可以回到他们身边，看见他们如何记得过去、面对新的日常、彼此改变，并和他们一起建设下一段生活。”

核心支柱：

1. **连续**：人物知道原作发生过什么，也知道哪些事自己不知道。
2. **共生**：居民不只回应用户，也会在日程、关系和共同事件中彼此影响。
3. **可参与**：用户能聊天、行动、帮助、拒绝、建设，但不是全知全能的上帝。
4. **可回顾**：每天和每个故事季都有因果清楚的摘要、关系变化和记忆证据。
5. **可控制**：时间、自治、离线推进和内容边界都可暂停、检查和回滚。

### 5.2 推荐首版范围

- 4–8 名核心居民，允许少量不运行完整心智的背景居民。
- 3–5 个语义地点，不做连续大地图或 60Hz 寻路。
- 一日分为早 / 午后 / 夜三个事件时段；用户每天有 2–4 个主动行动机会。
- 14 个游戏日构成一个首发“故事季”，可扩展到 28 日。
- 8–12 个手工定义结构 + AI 填充的 storylet，1 个共同建设项目，1 个季末事件。
- 角色拥有：不可变身份核、当前目标、日程、心情、私有知识、公共知识、承诺、分层记忆、对每人的关系看法。
- 用户拥有：身份与边界、住处/据点、时间与精力、少量抽象物资、关系和共同项目贡献。
- 视觉优先级：角色肖像与表情、地点卡、日历和关系图。像素行走地图、全语音和动态视频后置。
- 运行采用事件驱动的 active set：只高保真推演当前场景相关角色；其他居民在日结或用户授权的离线批次中低保真推进。

### 5.3 首版经营系统

建议加入，但仅做**轻量经营壳**：

- 时间段和精力：制造有意义的机会成本。
- 共同建设项目：例如修复温室、旅馆、纪念馆或交通节点，由原世界语义决定。
- 抽象物资：材料、食材或线索最多 3 类，不做庞大物品表。
- 小镇活力：由居民安全感、联结、公共设施和事件结果派生，不作为可刷分的唯一目标。
- 日历与庆典：提供中程期待和群体汇合点。
- 关系不是单一好感度；至少区分信任、亲近和戒备，并要求每次显著变化有事件证据。

首版不做：

- 农田格子、几十种作物、完整制造树、市场价格、采矿、战斗、钓鱼。
- 24 小时实时后台持续运行。
- 数十名角色逐 tick 调用模型。
- 开放 UGC 市场、多人在线、全语音、3D 或复杂像素寻路。
- 自动把运行结果写回世界引擎。

若“人物继续生活 + 共同项目 + 每日回访”不能建立留存，增加农业也不会修复产品核心；若核心成立，农业、工坊、商店和装饰可以成为第二阶段扩展。

## 6. 推荐运行架构

### 6.1 五层职责

1. **确定性世界状态层**：时间、地点、在场者、物资、项目、关系数值边界、事件序列、版本、权限和因果。
2. **居民心智层**：身份锁、当前目标、意图、情绪、承诺、信念、私有知识、记忆检索和日终反思。
3. **小镇导演层**：storylet 候选、节奏、冲突强度、居民聚合、季节目标和收束；不能直接写权威状态。
4. **互动编排层**：选择在场角色、发言顺序、行动可用性、秘密可见性和用户中断。
5. **表现层**：地图/地点卡、对话、肖像、日志、每日简报、回顾与媒资。

模型只产生类型化候选：意图、台词、事件草案、记忆草案、反思草案和导演建议。严格 parser、权限/知识/预算/状态校验和 reducer 才能产生正式事件。每次状态变化都必须能追溯到源事件，不能靠重新总结覆盖历史。

### 6.2 记忆与知识

- Canon identity：来自冻结 WorldRelease，运行时不可自动改写。
- Post-canon identity growth：角色对自己的新认识，必须保留来源和与 identity lock 的兼容结论。
- Episodic memory：发生了什么、何时、谁在场。
- Semantic belief：角色认为某件事是什么；允许不同角色持有不同甚至错误的信念。
- Relationship memory：角色 A 对 B 的印象和关键证据，方向性存储。
- Commitment：承诺、期限、完成/违约状态，纳入长程一致性检查。
- Secret / knowledge ledger：事实与知道者集合分离；信息传播必须有暴露事件。
- Recent working context：当前场景及临近事件。
- Reflection：在日结或阈值触发时生成候选，不在每条消息后无限反思。

### 6.3 时间与离线演化

- 默认按游戏日推进，不绑定真实时钟。
- 离线推进必须由用户显式打开，并配置最大游戏日、最大模型调用、允许的变化等级和不可触碰事项。
- 后台不是无限任务；每个批次是有限 durable run：读取 checkpoint → 生成/裁决若干事件 → 验证 → 保存 receipt → 结束。
- 回来时先展示“期间发生了什么、为什么、哪些角色知道、关系如何变化、花了多少预算”，再让用户继续。
- 关键不可逆事件、死亡、婚恋、永久离开、世界规则变化默认要求人工确认或在 Brief 中单独授权。

## 7. StoryForge 世界数据需求初稿

正式 SourcePlan 由 AI 小镇专用 adapter 生成；下面是方案阶段的数据语义，不是底表直读清单。

| 产品能力 | 世界语义 | 级别 | 粒度 | 缺失策略 | 阶段 |
|---|---|---|---|---|---|
| 锁定来源 | WorldReference、release ID/hash、capability identity | required | 整个身份包 | 阻止生产 | Brief/生产/验证/运行 |
| 核心居民 | 角色身份、人格、经历、动机、能力、原作结局状态、语气证据 | required | 4–8 条角色记录 + 依赖闭包 | 请求作者补设定或减少阵容 | Brief/生产/运行 |
| 群体关系 | 核心居民之间的关系、冲突、亲属/组织联系 | required | 入选角色关系子图 | 提示作者补设定；明确选择时可产品私域生成初始关系 | 生产/验证/运行 |
| 后日谈起点 | 故事结局、终局事实、已解决/未解决线索、时间锚点 | required | 叙事模块 + 相关事实闭包 | 阻止“严格后日谈”；可切换为非连续平行模式 | Brief/生产 |
| 世界约束 | 世界规则、社会规范、能力边界、禁忌 | required | 相关规则/词条集合 | 阻止或明确降级 | 生产/验证/运行 |
| 生活空间 | 地点、可达关系、归属、用途和气氛 | required | 3–5 个地点子图 | 请求用户选地点；允许产品私域补建新据点 | Brief/生产/媒资/运行 |
| 社会背景 | 势力、组织、职业和公共制度 | optional/conditional | 与居民/地点相连的依赖闭包 | 私域补全或降级为背景 | 生产/运行 |
| 物品与共同项目 | 已有物品、资源、遗产、设施 | optional | 精选记录集合 | 产品自行生成后日谈物资和项目 | 生产/媒资/运行 |
| 视觉/声音连续性 | 外观、服装、地点氛围、已有合法素材语义 | optional | 精选角色/地点/素材引用 | 文字降级或产品媒资生成 | 媒资 |
| 原文证据 | 关键章节/片段与事实证据 | conditional | 精确证据段 | 必须经 readOriginalEvidence 且记录 Context Manifest；没有时不伪造 | 生产/验证 |
| 可变世界草稿、其他产品私域 runtime、其他产品媒资、Dexie 自增 ID | 非本产品来源 | excluded | 全部禁止 | 拒绝 | 全阶段 |

世界发布新版本后，现有小镇继续绑定旧 WorldReference。升级必须重新生成 SourcePlan、做角色/结局/规则/地点影响分析、生成新的 ProductRelease，并保留旧存档或显式迁移；绝不热替换。

## 8. 商业化前必须证明的事情

首版成功不是“角色能说话”或“AI 会自己跑”。需要同时证明：

- 用户在 5 分钟内理解自己是谁、这些角色是谁、今天能做什么。
- 首次 15 分钟内出现一个源于原作、又只可能发生在这个后日谈中的有意义事件。
- 14 个游戏日后，角色仍保持身份与知识边界，关系变化有证据，故事不重置。
- 用户暂停数天再回来，简报足够理解变化且没有重大失控。
- 每个“生活日”的模型调用、延迟和成本可预算；低成本模型失败时能降级为确定性日程与文本摘要。
- 导出/导入、回滚、拒绝记忆、替换模型和 WorldRelease 升级不丢事实。
- 角色不靠迎合、情感勒索或虚假在线状态制造留存。
- 用户拥有/获授权的世界与角色素材有清晰权利边界；公开分享前有内容分级和侵权处理机制。

建议质量指标：

- canon contradiction rate、knowledge leakage rate、commitment survival rate。
- identity/persona/behavior/knowledge boundary/memory/emotion 六类角色一致性。
- 关系显著变化的证据覆盖率。
- 重复台词、无意义寒暄、无因果事件、越权状态写入率。
- 14 日完成率、主动回访率、居民偏好分布、共同项目参与率。
- 每日 P50/P95 延迟、模型调用数、输入/输出 token、失败与显式降级率。

## 9. 仍需产品负责人确认的问题

配套问卷将预填以下推荐答案：

- 用户默认以“新到来的共同体守护者/居民”身份参与，而非全知导演。
- 正史模式默认严格后日谈，允许另建“平行后日谈”而不能污染严格存档。
- 首版 6 名居民、4 个地点、一天 3 时段、14 天首季。
- AI 可自动处理日常小事；关系承诺、永久离开、死亡、婚恋和重大设施变化需确认。
- 默认游戏内时间，离线推进关闭；用户开启后最多推进 3 天并先展示预览。
- 经营采用时间/精力/抽象物资/共同项目，不做完整农场。
- 首版文字 + 肖像/表情 + 地点卡，不做 3D、全语音和连续走路地图。
- 单人本地优先；分享、市场和多人后置。

问卷答案应作为 Claude 架构方案的产品输入，但不能绕过 StoryForge 的世界版本、产品边界、三注册表、Harness 或用户确认治理。
