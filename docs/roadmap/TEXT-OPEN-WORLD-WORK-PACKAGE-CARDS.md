# 文字开放世界G1/G2功能开工卡与风险台账

> 版本：1.0.0 · 生效：2026-09-06 · 权威层级：L2
> 对应任务：`TOW-G0-09`
> 总进度入口：[`TEXT-OPEN-WORLD-IMPLEMENTATION-PLAN.md`](./TEXT-OPEN-WORLD-IMPLEMENTATION-PLAN.md)

本文为G1运行底座和G2确定性玩法的每个工作包冻结入口、owner、读写边界、迁移、测试、旧入口和主要风险。具体字段仍以开工时的代码关联闭包和三注册表为准。

## 产品化 W0：审计与施工边界（2026-10-13）

- 产品与生命周期：文字开放世界，StoryForge 产品研发，主要 S3.1/S3.2，组装/反馈涉及 S3.3/S3.4。
- owner：WorldRelease 只读冻结；内容归 ProductProduction / Artifact / Build，规则归产品 RuntimePackage，媒资归产品 Build/Release；Session/Event/Checkpoint 与私域演化不回写世界。
- 交接：WorldReference + ConfirmedProductBrief + ProductSourcePlan → Production Artifacts → ProductBuild → ProductRelease → Runtime Session/Event/Checkpoint。
- 入口闭包：`TextOpenWorldCreatorWorkflow` → `ProductProductionStudio` → `product-production/service.ts` → 共享 scheduler → `open-world/production-executor.ts` → V3 → QA → adoption/Creator Release → vNext player。
- 读取闭包：`production-contract.ts` 的 inputArtifactKeys → `product-production.brief/artifact-inputs` 及专属 `text-open-world.*-input` Context Sources → 各专业 Skill 的 Gateway/Manifest。
- 写入闭包：模型候选经 durable Run 和共享 Artifact Store 签收；`FIELD_REGISTRY` 已登记 `productBuildArtifacts.payloadJson/metadataJson/qualityJson/rightsJson`，采用 `product-production-artifacts` extension。本轮责任映射是确定性投影，不增加模型权限。
- 生命周期：`PROJECT_TABLES` 已管理 productProductions、productBuilds、productBuildArtifacts、quality receipts、媒体 Blob、ProductRelease、Session/Event/Checkpoint；责任分类不新增表、外键、schema 字段或迁移。需要冻结的三线证据放在产品已有 integration-report payload 内并单独版本化。

### 任务、产物、责任与消费者矩阵

下表产物均省略 `text-open-world.` 前缀；完整输入/输出清单唯一来源仍为 `src/lib/open-world/production-contract.ts`，共 26 个基础任务、40 种基础产物，P0 来源单元与可选 media 任务按 Plan 展开。
执行 lane 保持既有值；系统任务出现在 content lane 是调度现状，不能将它误解成内容 owner。

| 正式任务 | 现有 lane | 主责任 | 产物及跨线消费者 |
|---|---|---|---|
| p0.source-lock | integration | 内容 | source-pin / source-pin-unit；P1 与全图来源 |
| p1.source-curation | content | 内容 | source-manifest / source-ledger / source-gap-report；内容、系统读取 |
| p2.experience-design | content | 内容 | game-brief / experience-contract / protagonist-asset；系统与表现消费 |
| p2.gameplay-ruleset | content | 系统 | gameplay-ruleset-skeleton；任务和系统目录 |
| p2.presentation-profile | content | 系统 | presentation-profile；P10 媒资需求与运行 UI |
| p3.story-architecture | content | 内容 | story-arc / ending-contracts / narrative-promises；主支线与 V3 |
| p4.region-skeleton | content | 内容 | region-skeleton；地区、地图目录 |
| p4.player-build | content | 系统 | player-build；主线、成长、V3 |
| p5.mainline | content | 内容 | mainline-thread；支线、任务、V3 |
| p6.significant-threads | content | 内容 | significant-threads；地区、任务、V3 |
| p7.region-narrative-packs | content | 内容 | region-narrative-packs；目录、场景、V3 |
| p8.quest-skeletons | content | 内容 | quest-skeletons / content-requirement-manifest；六类系统目录 |
| p8.catalog.progression | content | 系统 | progression-catalogs；遭遇/物品/任务 |
| p8.catalog.encounters | content | 系统 | enemy-encounter-catalog；物品/任务 |
| p8.catalog.items-rewards | content | 系统 | item-reward-catalog；经济/任务 |
| p8.catalog.crafting-economy | content | 系统 | crafting-economy-catalog；NPC/任务 |
| p8.catalog.npc-runtime | content | 系统 | npc-runtime-catalog；任务/场景 |
| p8.catalog.map-interactions | content | 系统 | map-interaction-catalog；任务/场景 |
| p8f.quest-finalize | content | 内容 | quest-design-documents；director-decks 主 owner 为系统，同一任务产出、P9/P10/V3 消费 |
| p9.scene-scripts | content | 内容 | scene-scripts / choice-contracts；action-bindings 主 owner 为系统，P10/V3 消费 |
| p10.system-finalize | content | 系统 | system-configs；media-requirements 主 owner 为媒资，content-budget 主 owner 为内容；V1、media、V3 消费 |
| v1.deterministic-preflight | qa | 系统 | deterministic-preflight；V2/V3 |
| v2.balance-review | qa | 系统 | balance-review；V3 |
| v2.semantic-review | qa | 内容 | semantic-review；V3 |
| media.visual / media.audio（可选） | visual / audio | 媒资 | 按 Plan 声明的所有媒体输出；V3 绑定、QA 验权 |
| v3.runtime-package | integration | 系统，跨线组装 | runtime-package / integration-report；QA/Preview/Release |
| qa.release | qa | 系统，跨线验收 | quality-report；发布门 |

### W0 审计时的差距、兼容性和验证矩阵

1. W1/W2：目前仅有 lane 和总任务进度，无三线合同/完成门。推导责任映射和 owner，完成须同时满足 task receipt、有效产物、上游闭合和产品允许的媒资降级。
2. W3：`textOpenWorldProductionTaskDescendantsV1`、`creator-artifact-repair.ts` 已按冻结 Plan 下游闭包创建子 Build，`creator-media.ts` 已限定 media → V3 → QA。复用并补跨线证明，不扩大为全量重跑。
3. W4：旧 `TextOpenWorldWorkbench` 已不存在；真实工作台为共享 Studio 中挂载的 Creator Artifact/Media/Quality/Release 组件。在这里添加总览并复用原返修入口。
4. W5：`runtime-package-production.ts` 已验 schema、自身 Hash、输入链、媒体绑定/权利及 V1/V2。新增版本化三线证据；旧 v1 报告继续按旧合同验签，旧 Plan/Artifact/Release 不重写，分类本身不改变其 Hash。
5. W6：已有 provider-generate / author-import、准确能力绑定、媒资字节/权利/alt、新 Build 与 CAS；缺显式逐图人工确认及角色组检查。首版继续静音，无额外配音系统。
6. W7：已有确定性 Event、AI observability、问题回执和真人验收设施；需面向调优的只读统计，明确时钟跨度不等于真人主动游玩时长。
7. W8：继续保留 partial。真实盐脊 Build/Release/回执存在浏览器，当前环境未取得；禁止依据测试夹具补造或替代。新功能不触碰作者浏览器。

定向证据范围：`R-OPEN-WORLD3-production-contract/system-finalize/media-quality`、`R-OPEN-WORLD5-creator-artifact-repair/creator-media/governance-snapshot-cas/creator-quality`、`R-OPEN-WORLD7-release-lifecycle`；新三线合同、状态、UI 和统计反例另行补齐。隔离 E2E 复用 Creator artifact/lifecycle 与玩家旅程，不访问作者现用浏览器数据。

### W1～W7 工程交付闭包

- `614fe1ca`：责任合同、六态/完成门、调用/未知费用与只读工作台服务；原 lane、Plan Hash 和修复 DAG 保持。
- `3216158f`：精确 V3 输入与 integration-report v2 三线快照，保留 v1。
- `ae1b3f3a`：逐图人工回执、Blob/Build CAS 与发布质量 evidence v2；可移植发布校验和历史回执分版本读取。
- `2505ef9d`：既有工作台总览、任务/Artifact 定位及逐图人工 UI；窄屏/键盘与失败不误签验证。
- `404f5cf0`：本地体验统计与分类导出，只读事件/意图候选；初始通用启动事件、旧档和子分支均覆盖。
- `1108e3f1`：v2 装配与质量证据共同进入可移植 Release；重算集合 Hash 仍不能掩盖 Artifact 版本错配，v1 双来源开局继续通过。
- 定向 10 文件 45 项通过；V3 完整模拟 DAG 两项通过；Creator 两项和玩家存档/反馈/迁移一项隔离浏览器验证通过。全仓与最终交付状态以实施计划 W8 为准。

### W8 文档与交付收口

2026-10-14 完成主干同步复核，保留原架构、实施计划、能力基线、AI 手册生成来源及项目中英文知识库交付，并补齐真实作品验收操作说明。串行全量 CI 退出码 0，795 文件 4354 项通过；隔离 Chromium 254 项通过、2 项按开发模式配置跳过；知识库构建、39307 个内部链接、中英文映射和四种宽度预览通过。命令、覆盖率、包体余量、验证快照与外部事实边界统一登记在[实施计划 §0.2](./TEXT-OPEN-WORLD-IMPLEMENTATION-PLAN.md)。W0～W8 工程完成不改变首版/G7 进度，也不代表主干合并、部署或真实作品验收。

## 1. 共同施工契约

| 项目 | 统一要求 |
|---|---|
| 产品/阶段 | 文字开放世界；Release/Build为生产阶段，Session/Event/Projection为运行阶段 |
| 世界引用 | 只读锁定WorldRelease ID/hash；运行和产品内容不得回写世界 |
| Release owner | TextOpenWorldProductRuntimePackageV1内的文字开放世界逻辑模块；不可变 |
| Runtime owner | ProductRuntimeSession + ordered ProductRuntimeEvent；Projection只能重放得到 |
| AI读取 | 必须登记CONTEXT_SOURCES并经Context Gateway；G1/G2核心循环无需模型 |
| AI写入 | AI只写CreativeArtifact候选；作者采纳后由Adoption进入正式Build内容 |
| 普通写入 | 所有玩家动作经Command→EffectPlan→Event→Receipt，不允许组件/store散写 |
| 物理表 | 首版优先复用BuildArtifact、ProductRelease和ProductRuntime 表；只有查询/生命周期证明确有必要才拆表 |
| 迁移 | 旧OpenWorld/Adventure/Simulation内容只作兼容输入；新Release使用新包，旧Session绑定旧规则继续运行 |
| 完成验证 | parser/validator正反例、纯规划测试、提交幂等、重放、生命周期、真实UI；阶段末CI/E2E |

## 2. G1运行底座开工卡

| ID | 入口 | owner与正式写入 | 迁移/旧入口 | 必测反例 | 主要风险 |
|---|---|---|---|---|---|
| G1-01 | RuntimePackage parser、Build装配 | TextOpenWorldProductRuntimePackageV1 / ProductRelease | V1三模块可转换，不原地升级旧Release | 未知字段、版本、hash、跨模块缺失 | 包内再造第二套Release |
| G1-02 | 各Module parser/validator | Release逻辑模块 | OpenWorldV1字段映射到world/director | 重复ID、悬空引用、模块依赖环 | Schema只有类型没有运行消费者 |
| G1-03 | `commitTextOpenWorldCommand` | Session Event | 合并现有Adventure/OpenWorld envelope | 同commandId不同payload、未知提交结果 | 重试重复扣资源 |
| G1-04 | Action Registry与available actions | Release Action定义；Session不缓存第二份 | Adventure Action作为迁移输入 | actor/target/location越权、不可用原因 | UI和AI各维护动作表 |
| G1-05 | Condition parser/evaluator | Release Condition定义 | 旧Requirement/Condition转换 | 深度、条数、类型错配、秘密条件泄露 | 解释器成为任意代码执行 |
| G1-06 | Effect parser/planner | Event批次 | 旧Adventure/OpenWorld Effect转换 | 数值越界、保护对象、半提交、重复claim | Effect绕过系统owner |
| G1-07 | Event descriptor与排序 | ProductRuntimeEvent | 旧事件继续按旧Release重放 | sequence缺口、算法版本、随机证据缺失 | 新规则改变旧事件语义 |
| G1-08 | Session Projection reducer | 重放投影 | 组合旧narrative/adventure/openWorld状态 | 负资源、多所有者、非法任务/战斗态 | 缓存投影成为事实源 |
| G1-09 | Checkpoint/Replay/Branch | SimulationCheckpoint + child Session | 复用现有分支并扩展新投影 | hash漂移、坏检查点、父分支被改写 | 读档实际覆盖未来事件 |
| G1-10 | Build/Release/InitialState/Session | ProductBuild、ProductRelease、ProductRuntimeSession | 生产发布取代手工反向建WorldRelease | 多来源绑定、Release篡改、初始Hash错 | 预览和正式Release运行不同包 |
| G1-11 | CommandReceipt/FeedbackReceipt | Event终态和派生回执 | 兼容旧action narrative文本 | 规则失败却显示成功、降级遗漏 | AI文本冒充正式结果 |
| G1-12 | 三注册表与生命周期 | Registry + 已登记物理表 | 缺失登记先补，不手写表清单 | 导入重映射、删除、跨Work、stale写 | 新表/字段旁路治理 |
| G1-13 | 人工最小包真实入口 | 上述唯一owner | 新纵切面可用前不删除旧入口 | 刷新、断网、重复点击、分支重放 | 只测函数没有真实玩家路径 |

## 3. G2确定性玩法开工卡

| ID | 用户/代码入口 | owner与正式写入 | 迁移/旧入口 | 必测反例 | 主要风险 |
|---|---|---|---|---|---|
| G2-01 | 主角确认页/Build compiler | Release PlayerDefinition；Session player投影 | 旧playerIdentity转预设 | 来源角色漂移、非法初始物品/技能 | 身份文本和战斗构筑混成表海 |
| G2-02 | 角色页/派生值服务 | Release公式；Session基础属性 | 旧Adventure ability只作映射 | NaN、溢出、负值、显示名改语义键 | AI临时生成公式 |
| G2-03 | 经验奖励/升级投影 | Session progression Event | 旧ability奖励转换 | 重复经验、越过20级、多次升级 | 等级与属性分别写造成漂移 |
| G2-04 | 技能页/战斗Action | Release SkillDefinition；Session learned keys | 旧action转换基础技能 | 未学习、冷却、资源不足、重复解锁 | 技能效果复制Effect解释器 |
| G2-05 | 失败页/休息/复活 | Session health/status/branch Event | 复用Checkpoint；旧失败态只读 | 死亡仍行动、复活破坏任务、重复恢复 | 重试和复活产生不同事实历史 |
| G2-06 | 背包/拾取/使用/丢弃 | Session库存账本 | 迁移旧Adventure inventory | 负数量、双所有者、关键物品丢弃 | 仅存总量无法追溯唯一物品 |
| G2-07 | 装备页/equip Action | Session equipment + inventory Event | 旧equipped状态转换 | 重复占位、属性回算、生命裁剪 | 装备页自行算另一套属性 |
| G2-08 | 战斗/任务奖励结算 | Event claim ledger | 旧rewardEffects转换 | 重复领奖、部分结算、越界 | 奖励直接改多个store |
| G2-09 | 任务日志/任务编译 | Release QuestDefinition；Session QuestInstance | 旧Adventure/OpenWorld任务映射 | definition/instance混淆、悬空Stage | 随机任务改写模板定义 |
| G2-10 | 接取/放弃/失败/过期 | Quest状态Event | 旧状态映射并冻结规则版本 | 主线放弃/过期、非法逆转、重复接取 | 任务类别只写在文案里 |
| G2-11 | Quest Action/Objective | Action+Effect+Quest Event | 旧alternativeActionKeys转换 | 正文判完成、可选目标阻塞、重复领奖 | 任务私改玩家资源 |
| G2-12 | HUD/任务追踪/期限 | Session tracking projection | 旧任务列表默认主线优先 | 追踪等于接取/放弃、主线期限 | UI筛选状态误写正式任务 |
| G2-13 | 地图/旅行规划 | Release MapDefinition | RegionV1/EdgeV1迁移 | 不可达、剧情触发与到达耦合 | 为画图凭空造地点 |
| G2-14 | SVG地图/知识投影 | Session knowledge/map Event | 旧regionKnowledge映射 | 未知地点剧透、布局不稳定、无列表降级 | SVG坐标成为地点事实 |
| G2-15 | 普通旅行Action | Session location/time Event | 旧travel tick转世界分钟 | 非相邻旅行、提前到达误触主线 | 地图和任务各推进位置 |
| G2-16 | 快速旅行Action | Session unlocked point + travel Event | 新增，无旧写入 | 未到访解锁、途中插入事件、战斗中旅行 | 快旅绕过阻断和时间成本 |
| G2-17 | HUD时钟/天气服务 | Session clock/weather Event | 旧tick只迁移为兼容时钟 | 时间倒退、随机不可重放、查看UI推进时间 | 多系统各有自己的tick |
| G2-18 | NPC场景/服务可用性 | Release ActorDefinition；Session actor投影 | 旧profile/schedule迁移 | 不同层级成本、服务与位置不一致 | 每个普通NPC常驻Agent |
| G2-19 | 攻击NPC/剧情死亡/替代服务 | Session actor Event | 旧关键participant保护迁移 | 关键NPC死亡、替代者不存在、死者对话 | 保护只写Prompt不写规则 |
| G2-20 | 关系页/问候/价格 | Session morality/faction Event；态度派生 | 旧trust维度不进入首版权威 | 阈值边界、阵营缺失、主线被阻断 | 缓存态度成为独立亲密度 |
| G2-21 | 偷窃/欺骗/犯罪Action | Action/Effect/relationship Event | 新增局部效果 | 无目标犯罪、无限刷道德、触发未规划敌对 | 首版滑向通缉司法系统 |
| G2-22 | Encounter compiler/区域触发 | Release Enemy/Encounter定义 | 旧随机遭遇映射 | 无奖励/无逃跑/强度越界 | 敌人只是一段文本 |
| G2-23 | 战斗页/turn command | Session CombatProjection | 借鉴TTRPG事件，不复用D&D规则 | 非当前回合、终态继续行动、顺序漂移 | 战斗自建第二事件流 |
| G2-24 | 普攻/技能/道具/逃跑 | 统一Action与Combat Event | 旧quest-action不再承担战斗 | 未学技能、无道具、逃跑重复结算 | 四个按钮各写一套逻辑 |
| G2-25 | 伤害/状态/随机/胜利奖励 | EffectPlan + random evidence + claim | 抽取TTRPG随机证据工具 | 同seed异结果、负伤害、奖励两次 | 浮点/算法升级破坏旧档 |
| G2-26 | 制作页/craft Action | Release Recipe；Session recipe/inventory Event | 新增，无旧写入 | 未学配方、扣料失败、关键物品误耗 | 扣料和产出非原子 |
| G2-27 | 商店页/buy/sell | Release Vendor；Session库存/货币 Event | 新增，无旧写入 | 余额不足、特殊库存负数、价格不解释 | 商店维护第二份货币 |
| G2-28 | 世界导演/发牌/历程 | Release Director；Session world/knowledge Event | 迁移OpenWorldV1 Deck/Issue | 任务洪水、跨区参与者、无限传播/调用 | AI决定合法性并直接落任务 |

## 4. 风险台账

| 风险ID | 风险 | 影响 | 控制与关闭证据 |
|---|---|---|---|
| TOW-R01 | 新架构与V1运行时形成永久双轨 | 数据和UI持续分裂 | 新包可运行后只保留显式旧Release兼容适配；G7删除旧创作入口 |
| TOW-R02 | 共享`simulation/runtime.ts`继续膨胀 | 难以评审和测试 | 新规则写入产品专属纯模块，Simulation只保留统一提交/重放装配 |
| TOW-R03 | AI生成合法JSON但不可玩 | Build发布虚假完成 | 每个Artifact必须被真实下游parser消费，运行最短路径和可达性硬门 |
| TOW-R04 | 状态同时存在Adventure/OpenWorld和新投影 | 重放不一致 | 新Release只有一个文字开放世界SessionProjection；V1只经适配器读取 |
| TOW-R05 | 世界引擎分支后续变化 | 来源接口冲突 | 只依赖不可变WorldRelease和三层只读网关；通过契约测试协调 |
| TOW-R06 | 模板任务重复、洪水或无限AI调用 | 体验和费用失控 | Build变体、指纹、配额、冷却、Blank和单位时长预算全部由代码控制 |
| TOW-R07 | 主线保护导致自由输入僵硬 | 玩家体验差 | 合法意图映射、自然拒绝和固定Action降级；不让AI改核心目标 |
| TOW-R08 | 数值系统过早复杂化 | 无法平衡 | 首版三属性、20级、标准难度、三装备位、无元素/词缀/耐久 |
| TOW-R09 | 发布更新损坏真实存档 | 用户数据风险 | 默认留在旧Release；迁移预演、子分支和原存档保留 |
| TOW-R10 | 文档完成率冒充产品完成率 | 错误决策 | 单独统计G1～G7业务工作包；DONE必须有代码/测试/真实入口证据 |
| TOW-R11 | 大量物理表增加迁移面 | 生命周期失控 | 首版逻辑模块优先聚合进BuildArtifact/Release，仅按查询和独立生命周期拆表 |
| TOW-R12 | 媒资阻塞纯文字循环 | 首版无法验收 | 所有媒资有alt/fallback；程序地图、头像、背景为发布门，运行核心保持文字降级 |

## 5. 首张业务代码开工卡

```text
任务：TOW-G1-01 / TextOpenWorldRuntimePackage vNext
入口：ProductProduction Build装配、ProductRelease parser、Session初始化
上游：冻结WorldRelease、已授权Brief、集中校准配置、现有V1兼容模块
产物：可严格解析、可版本化、可Hash的文字开放世界运行包
下游：G1 Action/Event内核、G2全部玩法、G4玩家UI、G5创作者工作台
owner：不可变TextOpenWorldProductRuntimePackageV1 / ProductRelease；不写WorldRelease
读取：生产期注册来源和已采纳Artifact；运行期只读绑定Release
写入：生产Artifact候选→Adoption→Build；本任务不增加Session写路径
物理表：优先复用gameBuildArtifacts/gameReleases；不新建系统表
迁移：OpenWorldV1/AdventureV1/SimulationV1只通过显式兼容适配器转换
测试：严格字段、版本、稳定ID、模块缺失/重复/悬空引用、Hash、V1兼容
旧入口：不立即删除；G1-13真实纵切面完成后门控，G7最终下线
主要风险：复制第二套RuntimePackage、类型存在但无真实消费、兼容适配污染新模型
```
