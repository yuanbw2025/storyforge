# AVG/Galgame 正式产品契约

> L2 · 版本：1.2.0 · 生效：2026-10-14 · 对应总纲 §6、§7、§9、§10.1、E-AVG-01。
> 状态：正式目标设计与施工入口；已授权按工作包施工，公共版本接缝已通过分支工程验收；私有模块、专业生成与新玩家仍按后续包施工。当前产品仍为 `partial`。
> 上位规则：[总纲](../PROJECT-MASTER-CHARTER.md)、[上层产品共同契约](UPPER-PRODUCTS.md)、[数据治理](../DATA-GOVERNANCE.md)、[Harness 标准](../HARNESS-QUALITY-STANDARD.md)。
> 施工基线：`e40fadce` + 设计 `7afa9156`；已有能力与目标分开记述。研究依据保留在 L4，不直接指导代码施工。

本文是 AVG 整体产品的唯一施工入口。子规格见[方案目录](avg-production/README.md)，实施顺序见[开发计划](../roadmap/AVG-IMPLEMENTATION-PLAN.md)，逐包范围与验收见[工作包卡](../roadmap/AVG-WORK-PACKAGE-CARDS.md)。本契约覆盖完整目标域；每批施工只承诺已选范围，不能把功能目录当作全部已细化/实现。首场景和短切片是验证集合，不限制产品题材、体量或长期系统范围。

## 1 产品结果、生命周期与所有权

作者从冻结世界及已确认制作方向出发，通过专业内容、系统配置和媒资生产，制作可修订、可试玩、可冻结发布、可独立游玩的原创视觉小说。质量目标包含鲜明人物、可理解的因果和选择、连续美术、有效演出/声音，以及可靠的阅读和恢复。

| 边界 | 约束 |
|---|---|
| 产品身份 | 始终为 `avg`；线性、分支、调查等是同一产品的配置，不能生成新的产品身份 |
| 本轮生命周期 | 产品研发；先施工版本接缝，不操作作者真实作品或启动收费校准 |
| S1 | 作者确认世界语义并封存；AVG 不接管小说/世界 owner |
| S2 | `/avg/:pageId?` 内保存专用草稿、选择准确 WorldRelease、会谈/估算和确认方向；无世界可保存草稿，不能开始正式生产 |
| S3.1 | 明确开始后冻结 WorldReference、Brief、SourcePlan 和授权 revision；按三条依赖式泳道生产受治理候选 |
| S3.2～3.4 | 同一 Build 验收 → 不可变 ProductRelease → 绑定 release 的运行、问题定位与后继版本维护 |
| 数据 owner | AVG Work 拥有定向、生产、工件和修订；release/runtime 媒资遵守现有 ownerKind；会话状态归 AVG 实例 |
| 世界读取 | 中立 `describe/search/read`、AVG requirement adapter、冻结 SourcePlan、逐 Run Context Manifest；运行和媒资不写回世界 |
| 正式写入 | AI 只产出登记 CreativeArtifact 候选；作者确认后经 typed adoption。版本/hash、状态机、正式引用和发布证据由代码生成 |
| 工程壳 | 复用 Production/Build/Release、Harness、Blob、事件、checkpoint 和三注册表；不复制另一套 AI、数据库或发布入口 |

作品标题/简介/封面等归 Work，不镜像 Project。Project 只作工作区壳；来源 Work、World 和 AVG Work 均保留各自稳定身份。

## 2 作者与玩家旅程

作者一级结构保持作品库 → 制作台 → 发布与版本 → 游玩。定向在该作品内完成；制作台提供内容、系统、媒资和联合预览四个工作区域，但联合预览是组装/验收职责，不是第四条创意生产线。

1. 作者选择来源/准确版本，输入作品体验、规模、边界与预算，查看来源缺口和补充方式。
2. 主 Agent 起草方向和计划；作者确认并明确开始。S2 表单内的路线/变量意向不等同于正式运行规则。
3. 作者先审故事/人物/路线和系统骨架，确认稳定主体、玩法与媒资范围。
4. 逐场生产脚本、规则/导演和真实媒资，查看候选、差异、实际图片/音频和费用；可以锁定已接受成果及局部返修。
5. 从准确 Build 试玩，定位对白、行动、画面、声音或存档问题；按依赖新建修订并重验。
6. 作者选择所需成熟度并确认冻结 release；本地发布、导出与外部发布分别进行。

玩家入口提供封面/简介/内容提示、新游戏/继续、沉浸舞台及按需菜单。只显示作品内容、可理解的操作和必要失败说明，不暴露内部 key、Run、注册表或质量计数。库存、手机、档案等只有作品启用且实际编译支持时显示。

### 2.1 S2 V2 必须明确的选择

| 字段组 | 目标语义与进入 S3 的条件 |
|---|---|
| 叙事/交互 | storyMode、模块/版本、玩家角色、规模/路线/结局意向与边界；系统骨架在 S3 正式化 |
| 视角/演出 | narrativePerspective、视角锚点/切换许可；独立的 cameraGrammar、构图/文字安全区与允许例外 |
| 视觉/声音 | 风格与主体参考策略、静态/高级表现能力、BGM/环境/SFX 范围、voice=off/key-lines/full（按实际支持）及音色/语言校准 |
| 交付范围 | 文本/声音 locale、画幅、目标设备/输入/浏览器、离线/导出需求；首批中文，不默认承诺全语言/设备 |
| 质量与能力 | QualityProfile 的准确商业参照/场景、rubric/观察门；CapabilityMatrix 中 compiler/renderer/Skill/provider/生命周期就绪情况 |
| 投入与开始 | 调用/token/次数/现金上界、修稿/修图/审听人工上限、停止/降级；作者确认后冻结 Brief/SourcePlan/授权 revision |

这些选择由 BASE-00B 落实 typed Settings；不可塞进 V1 的 routes/variables 字符串或让会谈模型代替版本/授权校验。既有 qualityProfile 的 prototype/internal/commercial-candidate 仍表示目标等级，新增结构化 qualityTarget 保存参照与标准，不冒充已验收状态；CapabilityMatrix 的就绪/证据由确定性能力探测与真实回执生成，作者/模型只能提出选用需求。V1 旧“无声音”保持 off，未声明的语言/能力默认不启用。

## 3 运行范围：底座与可选模块

基础阅读与演出是所有配置共同底座。`storyMode = linear | branching` 与可选模块清单分别冻结；调查作品是启用物品/证据/热点等模块的组合，不是第三套生产引擎。

| 范围 | 必须具备的语义 | 选用规则 |
|---|---|---|
| 对话/阅读 | 稳定句身份、说话人/显示名、旁白/对白、输入、已读、历史、自动/快进、回听 | 基础；无配音时回听不出现 |
| 路线/选择 | 变量类型/范围、条件/效果、结局、汇流与回响、人物/玩家知识 | 分支模式必需；线性模式保留明确结束和必要知识边界 |
| 舞台/演出 | 角色/外观、背景/CG、层/构图/焦点、Cue、推进依赖和打断 | 基础；纯文字模式声明省略视觉表现但不改变剧情 |
| 声音 | BGM/环境/SFX/voice 用途、持续/一次性、同步/恢复、失败策略 | 按 Brief 选范围；有声目标必须有真实音频验收 |
| 存档/设置 | 自动/手动/快速操作、checkpoint/版本 pin、偏好与作品进度的独立作用域 | 基础；具体槽/数量是玩家 UX，不另造 runtime |
| 物品/证据 | 定义/持有/状态、获得/查看/使用/出示、目标/反馈/知识及消费槽 | 可选；唯一证据不强制数量/消耗；背包不会自动包含装备/交易/合成 |
| 热点/地点 | 地点入口、可见/可用区域、已检查、移动和信息后果 | 可选；必须有键盘/触屏路径及非图像替代 |
| 话题/关键词 | 发现/已知、询问/思考目标、回应及前后条件 | 可选；关键词不作为物品数量 |
| 消息/手机 | 消息/线程、时点、已读/回复、合法后果和显示 | 可选；普通选择不会自动具备手机语义 |
| 关系 | 类型化关系维度、改变依据、显示策略、路线消费 | 可选；知识、物品、题目正确性不混成好感度 |
| 档案/鉴赏/路线回顾 | 内容和解锁条件、已体验信息、防剧透、只读回放 | 可选；回放不改当前会话或解锁未获得知识 |
| 提示/故事辅助 | 提示层次、作者确认的解题路径、失败/重试及模式切换 | 可选；自动阅读不替玩家答题，辅助模式不调用模型猜答案 |
| 本地化/可访问性 | 文本/声音语言、姓名/字体/长句、键盘/触屏、静音/减少动态 | 基础合同，语言与设备范围按 Brief 冻结 |
| 高级表现/专属小游戏 | 可动角色、视频、3D 检查、计时裁判等独立能力、输入/失败/恢复 | 后置模块；先取得表现瓶颈及能力/质量证据，不默认启用 |

运行协议与字段见[系统规格](avg-production/02-SYSTEMS-AND-RUNTIME.md)。默认作品不含运行时模型；主线、规则、知识、库存和结局由冻结内容及确定性命令执行。将来引入运行时 AI 必须另立 Runtime AI Contract 和验收单元。

## 4 三条生产线与确定性组装

| 生产线 | 拥有的候选 | 不得跨越的职责 |
|---|---|---|
| 内容 | 故事/人物/关系弧、路线/揭示、场景卡、脚本、对白补丁、内容问题单 | 不直接写世界、会话变量或正式库存/规则；修辞不得偷改已确认事实 |
| 系统配置 | 模块选择的形式化配置、变量/条件/效果、物品/知识/消息、导演/事件依赖、UI 消费需求 | 不执行任意生成代码；不因默认 Cue 可跑而自报专属玩法支持 |
| 媒资 | 风格/声音方向、人物/物件/地点基准、用途需求、真实候选/处理、质量与作者决定 | 不从图片/音频发明 Canon、物品事实或选择结果；不以 Prompt 代替真实资产 |

三线先共同确认稳定主体和消费槽，然后按依赖细化；配音等待准确脚本文本，关键 CG 等待动作关系和导演需求。调度 lane 保留共享 `planning/content/visual/audio/integration/qa`，用 AVG 职责映射表达三线，不全局重命名调度器。

Build Integrator 只消费合法版本的已采纳输入，确定性编译内容/规则、演出、媒资和 UI 投影；记录实际输入/hash、compiler/version、来源、缺口、允许降级及质量。正式跨线绑定不能由模型自报。专业生产和工件定义见[Agent/Skill 与工件规格](avg-production/01-AGENT-SKILLS-AND-ARTIFACTS.md)。

## 5 已冻结的设计裁决

| ID | 裁决 |
|---|---|
| AVG-D01 | 一个 `avg` 产品、一个生产/发布/运行体系；线性/分支与可选模块通过配置组合 |
| AVG-D02 | 世界只供版本化语义；所有产品补充、规则、媒资、运行与修订归 AVG，不自动回写来源 |
| AVG-D03 | S2 保存意向与约束，S3 才产出正式系统/媒资；开始授权、Brief、SourcePlan 不可绕过 |
| AVG-D04 | 专业岗位有唯一核心 Skill/写域；编辑产生补丁，评审产生问题，确定性服务执行采用与组装 |
| AVG-D05 | 句身份与文本/演法版本分开；同文不同演法可不同 clip，改稿使旧语音 stale |
| AVG-D06 | 物品、证据、话题/知识分别有语义；图标、详情图、剧情特写分别有消费者 |
| AVG-D07 | 九类既有 ProductMediaKind 不直接膨胀成业务角色；AVG 的用途/消费者 binding 区分 icon、头像、菜单、stage、参考和宣传 |
| AVG-D08 | 新功能使用显式版本化 AVG 模块与包；旧 V1 只读兼容，不原地升级旧 Release/Build/save |
| AVG-D09 | 默认无 runtime AI；自动阅读、辅助解题、媒资自动生产和绑定是不同机制 |
| AVG-D10 | 数据中心继续为现有工件、Blob、事件、checkpoint；只有跨周目进度确需独立持久化时增加 AVG 专用作用域 |
| AVG-D11 | 技术检查、专业艺术评审、作者采用、独立玩家及分发证据分别保存；缺观察能力记未知 |
| AVG-D12 | 工作包按前置交付；共享热点先独立基础提交串行集成，首场景不硬编码成产品本体 |

### 5.1 协议版本与兼容

目标为 `AvgAuthoringSettingsV2`、AVG 专用 `AvgRuntimeModuleV1`、`AvgPresentationContentV2` 与 `AvgMediaBindingV1`。新 AVG 模块由 **ProductRuntimePackage V2 / Preview Manifest V2 / ProductReleaseManifest V2** 承载，分派器明确接受旧 V1 和新 AVG V2；不把新字段塞入旧严格 parser，不强制其他产品改用 V2。包/导出/运行来源中嵌套该协议的 codec 同步版本分派，不能只升级包而让发布或导入无法读取。

共享版本承载的实际调用方是受治理 Build Preview 与正式 ProductRelease 冻结/运行：两者必须校验和消费同一不可变包，分别取得兼容证据。只把共同的版本/hash/来源承载放进公共层；AVG 模块仍由 AVG 编译器拥有，继续使用同一 Release 表和谱系，不创建平行发布家族。runtime 包只能含 portable 语义 key/必要版本和 hash，不含 Dexie id、作者凭据、二进制字节或 Build/Release id；内部工件/Run 证据留在产品生产层。

目标类型名称用于施工规格，目前不代表代码已有这些类型。`AVG-BASE-00A` 先交付公共版本分派与兼容，`AVG-BASE-00B` 交付 AVG 类型/工件接缝；未知 version/module 失败关闭。新播放器复用旧 V1 读取适配，旧发布的字节、hash、资产和 checkpoint 不重写；旧会话的新游戏/继续/存档操作仍可用，需要变更作品时显式派生新 Build/release。

媒体传输需要版本化 `ProductMediaRequestV2`，保留 V1 无参考/无 voice 调用。共享升级只在 AVG 与至少一个现有需求调用方的证据明确后进入公共合同；否则采用 AVG 适配层，不修改中立世界协议。参考和语音规格见[媒资合同](avg-production/03-MEDIA-PRODUCTION-AND-BINDING.md)。

## 6 数据与三注册表落点

| 域 | 现行复用与目标增量 |
|---|---|
| S2 | `avgAuthoringDrafts`、`avgDraftMedia` 与现行会谈/修订；V1→V2 转换显式记录，旧“无声音”不自动启用收费配音 |
| 生产/工件 | `productProductions/productProductionBriefs/productBuilds/productBuildArtifacts`、durable Harness；新增 schema/Artifact kind 为 AVG 专用，禁止所有岗位散写 DB |
| 读取 | 复用 `avg.authoring`、`product-production.brief`、`product-production.artifact-inputs` 及 Gateway；增加按场景/主体/规则/媒资/评审 purpose 的 AVG 投影源，登记权限与渐进读取 |
| AI 写域 | 已有 `productBuildArtifacts.payloadJson/metadataJson` 与 `product-production-artifacts` adoption；AVG 新 Skill 限唯一 schema/工件 key，质量/权利/hash/实际版本证据不由模型伪造 |
| 媒资 | 复用不可变 Blob、候选、资产/绑定与 release/runtime owner；基准参考、加工/复用 lineage 留在产品层 |
| 运行 | `productRuntimeSessions/productRuntimeEvents/productRuntimeCheckpoints`，只增加 AVG 模块投影/事件；库存/消息保存于同一正式会话，不维护第二套事实源 |
| 作品进度 | 拟增 `avgPlayerProgress`：Work + 本地 profileKey + portable productKey，保存已读/解锁及实际来源证据；不放 Project/世界，不用于当前剧情知识 |
| 偏好 | 复用应用本地偏好设施，增加版本化 AVG 设置；偏好不是运行规则或世界事实 |

物理新表和 schema migration 在工作包开工时按真实 L3 派生并登记 `PROJECT_TABLES`；任何新增 `avgPlayerProgress` 必须覆盖作用域、导出/导入、删除、引用重映射、去重及旧数据缺省。禁止手写与注册表并行的表清单或生命周期入口。

原始模型响应/Run 证据、schema 校验、候选拒绝/采用和 stale 均可恢复。输入工件/SourcePlan/参考/文本变化后，相应候选不能被采纳；锁定表示作者不愿更改，不绕过版本失效。反例与修订闭包见[质量/首场景规格](avg-production/04-QUALITY-REPAIR-AND-FIRST-SCENE.md)。

## 7 作者修改、版本与发布

对白、规则和资产修改均以新候选/revision 表达；工作台显示差异、受影响下游、允许保留项和费用。相同 Blob 可复用，但新 Build 必须重绑版本和实际消费证据；父 Build 的艺术/试玩通过不能直接当作子 Build 验收。

正式发布绑定确定性 SourceManifest、lineage、规则/媒资/编译器版本及质量回执。继续使用总纲四级成熟度：`engineering-playable`、`creator-accepted`、`player-validated`、`distribution-ready`。`commercial-candidate` 是质量目标/profile，不是成熟度或销量保证。

本地正式 runtime 只绑定不可变 ProductRelease；Build 预览走现有受治理 preview source。导出/导入使用同一 release、Blob closure 和 registry 生命周期，播放器包不得包含 API 凭据、作者配置、全部源世界或未采用候选。安装后 owner/remap 合法；运行问题从准确 release/save 重现，修复形成后继 release，旧档继续可运行。

## 8 当前能力、设计交付与实现缺口

| 项目 | 当前事实 | 本方案新增目标 |
|---|---|---|
| 作者入口 | S2 草稿、会谈、来源、制作与修订已接通 | V2 作品定向、专业工件工作台、可理解的缺口/差异/返修 |
| 内容 | 通用内容生产、有限叙事与选择底座 | 独立专业岗位、场景/对白补丁、路线知识及真实同预算评测 |
| 系统 | narrative/presentation、基本 Cue、自动/手动 checkpoint 与分支 | 完整阅读/声音协调、物品/证据/热点/消息等可选模块、玩家存档/收藏/偏好 |
| 媒资 | 需求、文本锚点、provider/import、Blob、基本 kind-to-Cue 组装 | 真实参考、连续家族、icon/detail/头像/菜单消费者、逐句 voice 生产与艺术验收 |
| 作品验收 | 工程测试、预写《雾港》可作旧版本/素材回归 | 新生成场景、连续质量/成本、作者/独立玩家、后继修复及旧档证据 |

本轮只完成 AVG-00 设计包。产品实现和作品质量不因白名单/路线图登记而升级；下一代码单元与依赖见开发计划。研究材料的九场完整商业场景观察和音频审听仍待补，校准时必须记录未知，不以宣传片代替游戏操作或艺术效果。

“可用系统”可用确定性工程证据验证；“可交付作品”需要准确作品的艺术/作者/玩家/分发证据；“接近指定商业参照”另外要求匹配场景/语言/观察者的直接质量比较。完整长篇的节奏/路线整合、高级演出和持续批量质量只由相应规模样本证明，短戏不能代证。允许授权的专业人工编辑/美术/声音输入以同一候选/采用流程提升质量，实际人工与现金计入投入；自动产物的原始效果仍单独记录。

## 9 设计交付完成条件

1. 三条生产线、系统/媒资/工件 owner、阶段交接、版本兼容、数据和三注册表增量可定位。
2. 物品/对话/存档和所有媒资用途都有正式消费与失败/恢复语义，自动配置不止一个默认 Cue 列表。
3. 每个工作包有依赖、入口、读取/写域、生命周期、正反例、旧入口及真实验收，第一代码单元明确。
4. 文档权威、产品/路线图/上下文路由一致，链接、表格、ID/依赖及 Git 差异通过交付检查。

这些是设计交付条件；代码、真实 provider、作者/玩家与市场证据按工作包另行验收。
