# AI 主导文字开放世界游戏 · 完整开发清单

> 版本：1.1.84
> 建立日期：2026-09-06
> 对应总任务：`E-OPENWORLD-01`
> 当前状态：`IN_PROGRESS`；用户已于2026-09-06明确下达完整产品开发指令
> 产品架构：[`TEXT-OPEN-WORLD-PRODUCT-ARCHITECTURE.md`](../products/TEXT-OPEN-WORLD-PRODUCT-ARCHITECTURE.md)
> 叙事子系统：[`TEXT-OPEN-WORLD-NARRATIVE-BASE-ARCHITECTURE.md`](../products/TEXT-OPEN-WORLD-NARRATIVE-BASE-ARCHITECTURE.md)
> 历史与答疑：[`TEXT-OPEN-WORLD-VISION-AND-EVOLUTION.md`](../products/TEXT-OPEN-WORLD-VISION-AND-EVOLUTION.md)
> G1/G2开工卡：[`TEXT-OPEN-WORLD-WORK-PACKAGE-CARDS.md`](./TEXT-OPEN-WORLD-WORK-PACKAGE-CARDS.md)

## 0. 用途与进度口径

本文是文字开放世界产品的开发进度总表，把整体架构拆成可以逐项开工、验收和关闭的工作包。它不改变项目总路线图优先级；只有用户明确下达开始开发指令后，才把首个 `READY` 项切为 `IN_PROGRESS`。

状态只有以下五种：

| 状态 | 含义 |
|---|---|
| `DONE` | 代码、测试、数据生命周期、UI或文档证据均满足该项完成判据 |
| `READY` | 前置已满足，可以在用户指令后立即施工 |
| `QUEUED` | 已定义但仍依赖前序工作 |
| `BLOCKED` | 存在真实外部阻塞，并记录阻塞证据和解除条件 |
| `LATER` | 明确不进入首版，不计入首版完成率 |

进度不得只按页面是否存在计算：

```text
产品总进度 = DONE首版工作包 / 全部首版工作包
代码进度 = 已完成业务代码工作包 / 业务代码工作包
阶段进度 = 当前阶段DONE / 当前阶段总数
```

当前基线：

| 指标 | 当前值 |
|---|---|
| 首版工作包 | 121 |
| 已完成 | 82（G0、G1、G2及G3全部完成，G4完成13项） |
| 产品总进度 | 82 / 121（67.8%） |
| G1～G7业务功能进度 | 72 / 111（64.9%） |
| 当前阶段 | G4 完整玩家端 |
| G0阶段进度 | 10 / 10（100%） |
| G1阶段进度 | 13 / 13（100%） |
| G2阶段进度 | 28 / 28（100%） |
| G3阶段进度 | 18 / 18（100%） |
| G4阶段进度 | 13 / 15（86.7%） |
| 当前工作包 | `TOW-G4-14` |
| 当前阻塞项 | 无 |

每次状态变化必须同时更新本节汇总、对应任务行、验证证据和变更记录。

## 1. 总体依赖与实施原则

```text
G0 现状复核与开工冻结
 ↓
G1 运行包、Action/Event与数据治理底座
 ├──────────────┐
 ↓              ↓
G2 确定性玩法   G3 AI内容生产编译器前半段
 ├──────┬───────┘
 ↓      ↓
G4 玩家端     G5 创作者工作台
 └──────┬───────┘
        ↓
G6 运行时AI与有边界自由
        ↓
G7 盐脊验收、发布更新与旧入口收口
```

施工原则：

1. 一次只激活一个主工作包；真正独立时最多并行两个；
2. 每项开工前从产品架构第0.1节生成“功能开工卡”；
3. 先定义Release、Session和Event owner，再写页面；
4. AI输出先成为候选，确定性代码提交正式状态；
5. 新上下文、新可写字段和新物理表分别进入三注册表；
6. 每个纵切面同步完成刷新、失败恢复、导入导出、迁移与真实UI；
7. 新入口可用后必须下线被替代旧入口，不长期保留双轨；
8. 任何阶段都不得向WorldRelease回写游戏私域状态或媒资。

---

## 2. G0 · 现状复核与开工冻结（10项）

阶段目标：把已经完成的设计转成基于当前代码事实的施工边界，避免按旧残留继续扩建。

| ID | 状态 | 工作包 | 依赖 | 完成判据 |
|---|---|---|---|---|
| TOW-G0-01 | DONE | 建立文字开放世界专属分支 | 无 | 分支 `feat/text-open-world-product-architecture-mainline` 从最新 `origin/main` 建立；旧分支仅作迁移来源 |
| TOW-G0-02 | DONE | 建立整体产品、叙事子系统和愿景演进三层文档 | 无 | 三份文档进入权威清单、上下文路由和文档检查器 |
| TOW-G0-03 | DONE | 冻结36项首版产品决策 | G0-02 | 总架构第34节、叙事规格和愿景记录一致 |
| TOW-G0-04 | DONE | 审计当前文字开放世界完整关联闭包 | 用户开始指令 | 入口→服务→类型→三注册表→表→测试→下游已记录在开工能力审计，不把旧文件名当能力事实 |
| TOW-G0-05 | DONE | 核验并复用世界引擎正式读取出口 | 世界引擎清理/开发结果 | 新主干 `describe/search/read/readOriginal WorldRelease` 已实现，版本、Hash、权限、分页与冻结语义有专项测试；不移植旧重复网关 |
| TOW-G0-06 | DONE | 建立现有能力复用/改造/删除矩阵 | G0-04、G0-05 | 复用、改造和退场对象、owner、消费者及迁移边界已记录在开工能力审计 |
| TOW-G0-07 | DONE | 冻结首批校准参数登记方式 | G0-04 | 五项参数已进入集中配置和稳定决策ID，严格解析和fail-closed预算测试通过 |
| TOW-G0-08 | DONE | 编写“盐脊”验收世界Brief | G0-03、G0-07 | 世界概念、内容规模、全部系统、两个结局、17条路径、媒资和成本范围已冻结 |
| TOW-G0-09 | DONE | 建立纵切面开工卡与风险台账 | G0-04～G0-08 | G1/G2每个包的入口、owner、读写、迁移、测试、旧入口和风险已集中登记 |
| TOW-G0-10 | DONE | G0架构复核与开工回执 | G0-04～G0-09 | 27个相关回归测试、TypeScript、架构、115张表生命周期、文档和路线图检查通过；用户已确认进入G1 |

阶段出口：一份基于当前代码而非旧印象的差距审计，以及可直接实施的第一张功能开工卡。

---

## 3. G1 · 运行包、Action/Event与数据治理底座（13项）

阶段目标：人工构造的最小游戏包能够发布、启动、行动、刷新、重放和分支。

| ID | 状态 | 工作包 | 依赖 | 完成判据 |
|---|---|---|---|---|
| TOW-G1-01 | DONE | 定义 `TextOpenWorldRuntimePackage` vNext | G0-10 | 严格包络、15模块边界/依赖、版本、稳定ID、来源Hash、校准、媒资、质量和兼容字段可解析并有反例测试 |
| TOW-G1-02 | DONE | 定义各逻辑Module Schema与交叉引用 | G1-01 | 15模块均有严格Schema；稳定key、双向归属、跨模块引用、首版冻结边界、时间覆盖、区域牌组、三变体和根校准均有正反例 |
| TOW-G1-03 | DONE | 建立 `CommandEnvelope` 与命令幂等 | G1-01 | 严格命令/事件/Receipt合同、事务唯一事件、同ID冲突、stale阻断、重试复用和未知结果查询均有回归测试 |
| TOW-G1-04 | DONE | 建立统一Action注册与可用行动投影 | G1-02、G1-03 | 固定选项/任务/事件/教程消费者反查、操作者/位置/条件/重复/冷却/目标/确认投影和三种输入命令统一解析均有测试 |
| TOW-G1-05 | DONE | 扩展类型化Condition DSL | G1-02 | 九域白名单叶子、all/any/not、静态引用与跨归属校验、12层/256节点上限、公开失败原因和Action接入均有测试 |
| TOW-G1-06 | DONE | 扩展Effect DSL与原子 `EffectPlan` | G1-02、G1-05 | 30项白名单、静态引用、状态不变量、预演Hash、原子应用、跨域影响、幂等claim、保护对象与Receipt均有测试；禁止任意eval |
| TOW-G1-07 | DONE | 定义Simulation Event分类和顺序规则 | G1-03、G1-06 | command→0..128个确定性random→effects终态顺序、规则版本、seed证据、结果批次指纹、原子追加、幂等重试、专用入口和篡改重放反例均有测试 |
| TOW-G1-08 | DONE | 建立Session Projection与系统不变量 | G1-07 | RuntimePackage确定性初态、11域EffectState、Action/Director/协议状态、事件重建、中间态、状态不变量、Condition与Action权威上下文均有测试 |
| TOW-G1-09 | DONE | 打通Checkpoint、Replay与子分支 | G1-08 | 检查点终态约束、Hash/正文/序号/协议/重放诊断、runtime head诊断修复、历史检查点子分支重基线及父未来事件保留均有测试 |
| TOW-G1-10 | DONE | 打通ProductBuild、ProductRelease、InitialState与Session绑定 | G1-01、G1-09 | vNext 15模块作为共享ProductRuntimePackage的产品字段逐层校验；正式ProductRelease/Build Preview保持唯一冻结来源；新游戏确定性重建InitialState；命令边界复核ProductRelease或ProductBuild；存档与子分支固定原版本，来源和投影漂移fail-closed |
| TOW-G1-11 | DONE | 建立统一成功/失败/降级Receipt | G1-04、G1-06 | outcome/reason/degradation进入终态事件及批次指纹；统一回执覆盖拒绝、待确认、pending、成功、规则内失败和降级；仅终态成功/降级允许叙述成功；回执由规范事件派生并有Hash、证据序列和防伪反例 |
| TOW-G1-12 | DONE | 完成三注册表与数据全生命周期 | G1-01～G1-11 | `openWorldRuntime`可装配vNext玩家视角且隔离隐藏知识/锁定任务/NPC私有字段；AI无Session/Event通用adopt旁路；现有4张物理表均由`PROJECT_TABLES`派生导出、恢复、删除与引用重映射；Canon快照内容寻址且无本地主键；命令事件正文可移植并在恢复后继续幂等重试；跨项目读取fail-closed；本阶段不新增物理表，故无需schema migration |
| TOW-G1-13 | DONE | 人工最小包端到端验证 | G1-01～G1-12 | `executeTextOpenWorldActionV1`统一预检、幂等Command、确定性Effect与Feedback；vNext作为共享ProductRuntimePackage字段接入正式ProductRelease和真实玩家入口，可显示基础角色/地图/任务/背包、执行Action、保存和分支；无AI完成发布→启动→行动→保存→缓存丢失恢复→事件重放→分支；15个vNext回归文件、61项测试及真实React入口通过 |

阶段出口：后续所有玩法和AI共同依赖的唯一运行内核。

---

## 4. G2 · 确定性玩法纵切面（28项）

阶段目标：不调用AI，使用人工内容从开场玩到一个结局，并覆盖首版全部核心游戏循环。

### 4.1 玩家、成长、物品和任务

| ID | 状态 | 工作包 | 依赖 | 完成判据 |
|---|---|---|---|---|
| TOW-G2-01 | DONE | 主角身份与初始Build | G1-13 | 产品自建、已确认AI候选、预设和冻结WorldRelease角色统一编译为Release拥有的`PlayerCharacterDefinition`；故事身份保持复合小传，初始Build独立结构化；来源资源ID/Hash和版本受检，活角色漂移不影响冻结结果；非法等级/技能/物品/成长配置不能进入Build；Session只读取Release副本；玩家UI和`openWorldRuntime`消费完整身份 |
| TOW-G2-02 | DONE | 三属性与派生数值 | G2-01 | `power/vitality/agility`是不可改语义键，世界只可改显示名；唯一派生服务按Release公式、Session等级/基础属性和装备引用计算最大生命、攻击、防御、暴击、先手、技能资源及逐项来源；暴击/负向加成有界，NaN、非法第四属性、错误装备和溢出Build被拒绝；初始Session、Condition、玩家UI和AI上下文使用同一派生结果 |
| TOW-G2-03 | DONE | 等级与经验曲线 | G2-02 | Release严格冻结连续20级阈值、自动属性成长、资源上限差额同步和满级经验封顶策略；单次奖励可跨多级并在Receipt中记录实际/舍弃经验、属性、资源和技能变化；盐脊已验证1→5级，20级后不溢出；等级/经验/属性/资源漂移和重复claim均被拒绝；UI与AI上下文共享等级进度投影 |
| TOW-G2-04 | DONE | 技能定义、解锁、消耗、冷却和状态 | G2-02、G2-03 | Release冻结技能标签、主动/被动、类别、目标、成长属性、初始/等级/任务来源、使用Condition、优先级、资源消耗、冷却和Effect引用；等级来源与成长曲线双向一致，任务来源必须由该任务学习Effect兑现；Session只保存已学技能和已声明状态；统一目录按学习、资源、冷却、Condition投影可用性并为后续战斗准备合法执行参数；重复学习/状态施加移除及悬空引用失败关闭；玩家UI和AI上下文显示同一技能/状态定义 |
| TOW-G2-05 | DONE | 生命、休息、失败和复活 | G2-02、G1-09 | 生命0与战败状态双向一致，战败只开放复活/读档恢复；休息作为正式Action以原子EffectPlan恢复生命/技能资源、清除有害状态并推进冻结时长，战斗中失败关闭；快速旅行点显式声明复活资格，复活只可使用已解锁复活点，恢复安全资源且不扣货币/时间/物品、不改任务；开始战斗前幂等建立带用途与遭遇引用的自动检查点，检查点语义/Hash/重放均受检；重试保留父分支失败史并从战前点建立新Session；玩家UI和AI上下文明确区分重试新分支与保留进度复活；新增检查点元数据随PROJECT_TABLES备份恢复 |
| TOW-G2-06 | DONE | 物品定义、实例和库存账本 | G1-08 | Release冻结分类、标签、堆叠策略/上限、唯一性、使用Action、丢弃/出售/关键保护、数值与来源/表现引用；Session无限背包将堆叠物总量与装备/唯一物独立实例分账，实例拥有稳定ID、获得claim和状态标签；初始物品、拾取、使用、丢弃和出售统一走EffectPlan，数量上下界、分区、唯一重复、装备中移除、关键物移除及无正式来源均失败关闭；物品Action只能命中其消费/移除Effect绑定的物品；恢复品按资源未满Condition投影可用性；背包UI和AI上下文共享同一数量投影；90项vNext回归及UI、TypeScript、三项工程检查和build通过 |
| TOW-G2-07 | DONE | 三装备位与属性重算 | G2-02、G2-06 | Release中的weapon/armor/accessory语义槽、装备条件及成对equip/unequip Action与Effect严格绑定；Session以具体物品实例ID占槽，内容包仍用稳定物品定义key描述操作；同槽装备原子替换且旧实例回到可移除状态，装备实例不能被出售/丢弃，悬空实例、错误槽位和重复占位失败关闭；所有派生数值仍由唯一服务重算，装备提高资源上限不凭空治疗，卸装下降会裁剪当前生命/技能资源；真实Action→Event链验证装备可刷新重放；玩家装备页显示三槽、候选、前后数值差异和条件状态；21个vNext逻辑套件95项与2项UI回归通过 |
| TOW-G2-08 | DONE | 奖励、掉落和唯一领取 | G2-03、G2-06 | Release拥有独立RewardContract，冻结来源类型、一次性来源claim、预计时长/预算级别、Condition、静态Effect和DropTable；掉落表冻结算法版本、整数权重、数量范围、唯一策略及每个数量对应的授权grant Effect；奖励协调器先按Session seed/命令序号形成可重放随机证据，再把经验、货币、物品/材料/装备、技能、配方、道德、阵营、知识/地点/快速旅行、成就和世界Effect合成单一EffectPlan；任一越界全单失败且同一来源不能重复领取；EffectPlan携带Reward授权，Session重放会重新核对随机证据、掉落选择、claim和Effect闭集，无授权掉落不能提交；真实Command→Random Event→Effect Event链、刷新和幂等重试已验证；22个vNext逻辑套件100项与2项UI回归通过 |
| TOW-G2-09 | DONE | Quest定义、实例和稳定引用 | G1-02、G1-08 | Release任务定义冻结叙事等级、归属、地区、时间/生命周期、实例化、开局状态、时长和标签；非模板在Session建立唯一Release实例，模板只由Director按来源建立多个稳定实例；实例独立保存定义/来源Hash、Stage/Objective快照、时间、终态和奖励引用；Condition保留非模板定义聚合读模，Action/UI/AI上下文使用实例ID；模板不能被全局定义条件误作运行实例，定义不能被随机任务改写；Director实例账本交叉校验；23个vNext逻辑套件105项、2项UI、TypeScript、工程检查和build通过 |
| TOW-G2-10 | DONE | 任务状态机与类型策略 | G2-09 | 11态、12种意图与玩家/系统权限形成代码状态机；主线/重要故事不失败、不放弃、不撤回且等待玩家；普通任务按策略失败、确认放弃、重接或到期；实例目标授权进入EffectPlan/Event/Replay；真实发布、接取、放弃确认、刷新重放、旧投影迁移和玩家UI通过117项专项回归 |
| TOW-G2-11 | DONE | Stage、Objective、Action与奖励绑定 | G1-04～G1-06、G2-08～G2-10 | Quest v2双向绑定Objective完成Action、Stage系统Action与RewardContract/领取Action；Objective、阶段迁移和领奖分别形成实例授权与正式事件；系统在成功玩家行动后只结算已满足的Stage；必需目标、相邻Stage、多实例隔离、独立领奖与幂等重试由代码校验；旧Quest v1规范化只读兼容；玩家任务卡显示当前Stage、目标状态、实例专属Action和待领奖状态；27个vNext套件122项回归通过 |
| TOW-G2-12 | DONE | 任务追踪、期限和历史投影 | G2-10、G2-11 | Session冻结一个主追踪和最多3个HUD钉选，四类追踪/取消Action经实例授权、Effect Event和Replay落地，取消追踪不改变任务生命周期；主线开局自动主追踪；限时任务从揭示时登记绝对期限，成功玩家Action后由系统Action按未开始/各Stage覆盖自动过期；当前截止投影与规范事件任务历史均可按实例查询；HUD、任务卡和AI上下文共用追踪/期限状态；旧投影自动补齐追踪字段，Action v1旧Release仍按原无tracking初态Hash验证并在启动时迁移；28个vNext套件128项逻辑回归覆盖容量、过期、历史、防伪和兼容 |

### 4.2 地图、时间、NPC与关系

| ID | 状态 | 工作包 | 依赖 | 完成判据 |
|---|---|---|---|---|
| TOW-G2-13 | DONE | 世界/地区/地点/道路拓扑 | G1-02、G2-09 | World模块v2冻结地区主题/等级带/认知策略/快旅归属/来源、地点用途/功能/提前到达表现/来源及道路描述/风险/来源；构建期验证地区地点反向归属、单行方向、全图从初始地点结构可达、道路Condition、每区快旅点和表现引用；查询层提供不可变MapDefinition、相邻道路、确定性最短时间路线及场景/任务/人物/遭遇/商店内容候选索引，路线与到达结果不触发剧情；旧World v1只读规范化且不伪造来源；玩家页与`openWorldRuntime`共用地图投影并隐藏未知目的地名称；29个vNext套件132项回归通过 |
| TOW-G2-14 | DONE | SVG布局数据、探索与知识可见性 | G2-13 | World模块v3冻结逐地点`unknown/heard/visited/familiar`初始认知并约束不高于所属地区；Presentation模块v2冻结全地点、不重叠、规范坐标布局，旧模块获得可复算的确定性回退；Session把兼容用地点列表收口为地点认知派生值，揭示只提升到听说，到达/复活才提升为已到访且不触发任务；玩家地图投影完全省略未知定义，听说层只暴露名称，到访层才显示详情，同一防泄漏投影驱动SVG和等价列表；AI上下文复用同一投影；旧World v2 Release仍按原无地点认知初态Hash验证并在开局迁移；30个vNext套件137项回归覆盖布局伪造、未知信息泄漏、认知迁移和真实UI |
| TOW-G2-15 | DONE | 普通旅行和提前到达 | G2-13、G2-14 | Action模块v3要求每条有向道路恰有一项玩家普通旅行Action，并严格绑定`start-travel→advance-time→enter-location`三段Effect；构建期校验方向、双向覆盖、道路Condition、冻结分钟、目标和Effect归属，运行时再次校验当前位置、玩家可见目标、道路开放与单向方向；正式Command/Effect Event把地点认知、时间和到达原子提交并可刷新重放，通用EffectPlan也必须与命令Action及成功/失败分支一致；旅行合同不允许任务或场景Effect，玩家可提前到达但不会自动推进主线；SVG地点与道路列表均可发起同一Action，AI上下文显示相同可执行路线；旧Action v1/v2继续按冻结合同读取；31个vNext套件142项回归通过 |
| TOW-G2-16 | DONE | 快速旅行解锁与执行 | G2-15 | Action模块v4要求且只允许一条动态地点目标的玩家快旅Action，并绑定唯一`fast-travel` Effect；Release冻结普通路线耗时比例和最低分钟，Session授权按当前地点、已到访地点、已解锁快旅点、开放道路及世界分钟确定最短路线和实际耗时；默认解锁和运行时解锁均要求地点已到访，普通旅行到达自动解锁；执行前Action投影及授权再次拒绝战败/战斗、当前地点、未到访、未解锁和路线阻断；Command和单个跨map/time Effect原子落地地点与分钟，始终不创建`map.travel`，因此不存在可插入途中事件的中间态；Event重放复核命令目标、Action/Effect闭集和完整授权快照；SVG等价列表、专用快旅列表及AI玩家上下文使用同一投影；旧Action v1～v3继续读取；33个vNext套件149项回归覆盖正式发布、刷新重放、幂等、篡改、阻断、UI和兼容 |
| TOW-G2-17 | DONE | 世界分钟、天数、时间段和天气 | G1-08、G2-15 | TimeWeather模块v2冻结统一分钟制、无空洞昼夜段、天气更新周期及每地区有界整数权重气候表，Action模块v5要求唯一系统天气Action/Effect，并要求所有普通非零耗时Action用唯一成功`advance-time` Effect真正落实声明分钟；运行时只允许正向推进世界分钟，跨天气周期后先以独立确定性系统Command结算最终周期，再处理任务期限；Session记录最近已结算天气周期，同周期只结算一次，若应用在玩家耗时Effect与系统天气命令之间中断，后续成功行动会补齐，检查点分支则继承既有周期结果而不会换seed重抽；天气授权冻结世界分钟、周期、地区顺序、随机请求、抽取值及新旧天气，随机值由Session seed、Command序号和drawIndex生成正式Random Event，Effect Event重放会再次核对完整证据；快速旅行仍在单一Effect内完成地点/时间原子结算，天气只在抵达后结算；玩家HUD只显示第几天、时间段和当前地区天气，不暴露内部分钟，AI `openWorldRuntime`复用同一只读投影；旧TimeWeather v1按一天周期规范化，旧Action v1～v4不自动启用天气结算；35个vNext套件155项回归覆盖发布、跨周期、中断恢复、随机证据、刷新重放、幂等、防伪、UI和兼容 |
| TOW-G2-18 | DONE | Actor层级、日程和服务可用性 | G2-13、G2-17 | Actor模块v2保留复合小传，仅把mainline/significant/resident/transient层级、归属、功能与简单日程结构化；每个有日程角色必须无遗漏覆盖冻结时间段，日程条目只声明地点、当前活动和该时段开放的既有服务，越权服务、vendor反向归属及服务地点漂移在Build阶段失败关闭；Action模块v6以唯一系统Action/Effect和命令授权，在跨时间段后按“天气→角色日程→任务”顺序只结算最终投影，Session游标使同段剧情移动不被重置、跨段恢复日程、中断后可补偿且存档回放一致；死亡或被剧情移除的角色不会被日程复活；商店目标必须同时满足角色存活/在场、当前位置、当前日程与vendor地点；玩家UI和AI上下文共用披露安全角色投影，重要角色仅额外提供演绎准则，居民/临时人物不加载小传；旧Actor v1日程规范化并保留旧InitialState Hash候选，Action v1～v5不自动结算；37个vNext套件161项回归覆盖层级成本、正式系统事件、授权防伪、服务开闭、UI和兼容 |
| TOW-G2-19 | DONE | NPC死亡、保护和功能替代 | G2-10、G2-18 | Actor模块v3冻结`protected/story-only/mortal/despawn-on-resolution`四级死亡策略，保留人物小传整体且要求`protected`兼容位与策略一致、主线角色必为受保护；`change-actor-state`显式冻结玩家攻击/正式剧情/随机事件/事件解决原因，确定性生命周期目录拒绝关键角色死亡、story-only越权死亡、临时角色错误退场和死者复活；Action模块v7把玩家攻击限定为需确认、固定普通角色目标的`attack-actor`，把剧情/事件结果限定为系统`actor-state-action`，Event重放再次核对操作者、目标、Action和Effect；角色死亡后立即退出角色/对话/日程/商店目标；每项角色服务必须在Build声明随原主消失或由指定备用角色及服务接管，替代者、反向所有权、全覆盖、重复目标和替代链均失败关闭，备用服务只在原主死亡后启用；旧Actor v1/v2规范化为v3、旧Action v1～v6继续读取；38个vNext套件165项回归覆盖真实发布、攻击确认、剧情死亡、服务接管、死者对话、关键保护、缺失替代、替代链、临时退场和复活反例 |
| TOW-G2-20 | DONE | 道德、阵营亲合度和三档态度 | G2-18、G1-05 | Relationship v2冻结各阵营与无阵营角色对道德的`-1/0/1`解释，并完整配置差/一般/好三档标签、问候、非关键互动策略和买卖倍率；Session只存道德、全阵营亲合度和已发生的预制故事修正，Actor、Condition、玩家UI和AI上下文从单一确定性投影获得态度及可解释原因；独立NPC亲密度、缺失阵营状态、未预制修正、重复态度档均失败关闭；Build递归拒绝关系条件锁死主线任务、Stage和全部必需目标Action，主线角色在态度差时仍保留必要互动；旧Relationship v1确定性规范化；40个vNext套件171项回归通过 |
| TOW-G2-21 | DONE | 偷窃、欺骗和犯罪Action | G2-20、G1-04～G1-06 | Action v8与Relationship v3成对冻结一次性高风险犯罪机会、固定地点/目标、成功条件、成败分支、在场目击者和目击后果；玩家必须二次确认，代码从当前状态决定成功/失败并以专用授权原子提交道德、阵营、预制物品、知识或局部标记，失败同样形成带原因的正式终态；犯罪专用Effect不能被普通Action借用，不能提高道德、越出局部影响边界、制造敌对身份或触发司法系统，数值到边界时安全截断；事件重放复核Action、目标、条件结果、目击者、Effect闭集和Outcome，旧Action v1～v7/Relationship v1～v2继续读取；42个vNext套件174项回归通过 |

### 4.3 战斗、制作、经济和世界导演

| ID | 状态 | 工作包 | 依赖 | 完成判据 |
|---|---|---|---|---|
| TOW-G2-22 | DONE | 敌人、遭遇和标准难度定义 | G2-02～G2-04、G2-13 | Combat v2冻结唯一`standard`难度和倍率、可执行敌人技能策略、有序且有界的敌人组、等级/强度、地点/任务、逃跑、重试或复活、来源/媒资及三段表现；每个遭遇由唯一`start-combat` Action进入，独占`combat` RewardContract并与敌人掉落表双向一致；查询层提供不改状态的定义目录和相对强度战前预览；旧Combat v1确定性补齐定义且不猜测奖励所有权；43个vNext回归文件182项测试通过 |
| TOW-G2-23 | DONE | 战斗状态机与回合顺序 | G2-22、G1-07 | Combat v2 Session冻结战斗实例、敌人实例、先攻顺序、轮次、当前行动者和阶段游标；`started→round-start→actor-turn→action-resolved→next-turn/round-end`以及`victory/defeat/escaped`终态只能由代码状态机签发授权，并以唯一系统Action/Effect进入共享ProductRuntime事件流；开战后自动推进到首个行动者，稳定平局规则、非法跨阶段、禁逃、授权篡改和终态继续迁移均失败关闭；清空Head后逐事件重放一致，旧Combat v1/Action v8仍使用旧投影；44个开放世界回归文件188项测试通过 |
| TOW-G2-24 | DONE | 普通攻击/技能/道具/逃跑四类操作 | G2-04～G2-08、G2-23 | Action v10把玩家普攻、每项战斗技能、每种消耗品、逃跑及敌方技能编译为双向校验的静态Action/Effect表行；技能已学、资源、条件和回合冷却及道具持有/消耗共用正式投影；每个行动签发`CombatActionAuthorization`并经共享ProductRuntime命令/Effect事件原子提交，敌方按Release冻结策略自动选招并返回玩家下一回合；逃跑直达`escaped`终态，无道具、未学/资源不足/冷却中技能、非当前行动者和授权篡改失败关闭；Action v9保持可读可重放；45个开放世界回归文件194项测试通过 |
| TOW-G2-25 | DONE | 战斗数值、状态、随机证据与奖励 | G2-23、G2-24 | Combat v3与Action v11冻结`bounded-physical-v1`整数公式、主动攻击技能倍率、最小/最大伤害、万分制暴击上限和倍率；玩家派生值与敌人Release数值进入同一伤害结算，每个攻击目标保存随机请求、抽样证据及完整伤害前后值；伤害与预制状态Effect在同一原子计划提交，死亡后代码自动进入胜利/战败终态并清理声明的战斗临时状态；胜利以独立系统Action按遭遇RewardContract自动且仅一次领奖，失败与逃跑不领奖；Action v10/Combat v2不被静默升级；46个开放世界回归文件199项测试通过 |
| TOW-G2-26 | DONE | 配方学习与确定性制作 | G2-06、G2-08、G2-17 | Crafting v2与Action v12冻结100%成功、配方类别/学习状态/地点/条件/材料/产物/耗时以及批量和事件单位上限；每配方必须双向绑定唯一玩家`craft` Action和`perform-crafting` Effect，非默认配方必须存在`learn-recipe`解锁入口；Build拒绝关键物品或实例型材料、输入输出重叠、重复物品、单份产物/事件预算越界及不可执行合同；Action投影只开放已学习、在正确地点且至少可做一份的配方；命令显式提交数量并由专用授权冻结材料/产物前后值和总耗时，在单一EffectPlan内原子扣料、生成堆叠或实例产物、推进世界时间并用claim幂等；Event重放核对命令数量、Action、配方、条件和状态且拒绝篡改；Crafting v1只读兼容；47个开放世界回归文件203项测试通过 |
| TOW-G2-27 | DONE | 单货币、商店、价格和特殊库存 | G2-06～G2-08、G2-20 | Economy v2与Action v13冻结单币种、商人归属/营业条件、整型基点买卖倍率、可交易类别、普通无限库存和特殊有限库存；同一三档关系投影形成可解释价格，构建期阻断无风险套利；购买/出售以专用授权在单一EffectPlan中原子更新货币、玩家物品和Session有限库存，装备中物品不可出售，玩家售回物成为有限库存；命令、事件、刷新和重放会重新核对商人、物品、数量、价格、服务与状态并拒绝篡改；Economy v1只读兼容；48个开放世界回归文件207项测试通过 |
| TOW-G2-28 | DONE | 地区状态、发牌、随机事件和知识历程 | G2-09～G2-21、G2-25～G2-27 | Director v2与Action v14冻结逐地区压力范围、结算周期/漂移、状态档位、触发牌组、全局/地区任务预算、Blank权重、内容权重、等级/Condition、冷却、指纹和强度连击限制；Session保存地区结算游标、来源冷却、发牌证据/历史、动态任务实例、已见事件、传闻、知识和成就历程，主线不进入Director演化；玩家成功Action后按到达/探索/交谈/休息/任务/普通活动触发唯一系统Director Action，跨期地区演化和一次有界发牌通过同一Command→Random Evidence→EffectPlan→Receipt原子落地；固定普通任务只从available揭示，模板及任务升级生成稳定独立实例而不改定义，资源事件只能调用无需第二授权的安全Effect；同seed可重放、重试不重复抽牌、授权或证据篡改失败关闭，已提交未落地的Director命令会在下一次玩家行动前恢复，正式地区内容和成就进入受控运行上下文，Director v1保持只读兼容；49个开放世界回归文件213项测试通过 |

阶段出口：完整人工Fixture无需模型也能游玩、成长、战斗、交易、制作、探索、存档并完成结局。

---

## 5. G3 · AI内容生产编译器（18项）

阶段目标：从冻结世界观或小说来源生产可被G2直接运行的完整Build，不再机械映射通用叙事节点。

| ID | 状态 | 工作包 | 依赖 | 完成判据 |
|---|---|---|---|---|
| TOW-G3-01 | DONE | 产品专属Artifact Kind、Run Contract和生产DAG | G1-13、G0-06 | 当前40种产品专属Build Artifact（G3-02将SourcePin索引与大体量冻结单元分开）全部登记到统一Kind边界并拥有唯一任务owner；26个P0～P10/V1～V3/QA合同明确输入、输出、依赖、Context、写目标、22个模型型durable Run及按Brief有界分配的调用预算、重试/不可重试错误、超时、stale传递、验收门和终态回执；Ruleset/表现、六类玩法目录及平衡/语义评审均有独立Skill边界。当前完整Build预留154次初始模型调用，并另给P9保留1次明确片段修复授权：P1最多6次、P9最多127个Scene加1次共享表现及1次修复、其余模型任务各1次，总授权155次；token按156份独立叙事权重分配，时长另按100份权重分配。P8玩法目录并行、P8F后绑定任务，确定性预检先于双评审，V3是唯一G2包装配点；可选视觉/音频Lane只在P10媒资需求之后加入；专属Plan可通过共享`ProductProductionPlanV3`严格解析，现已由G3-18激活；新增回归并对Artifact Store补Kind运行时登记校验 |
| TOW-G3-02 | DONE | WorldRelease/小说SourcePin锁定 | G0-05、G3-01 | P0专属双来源合同统一冻结`sourceVersionHash/sourceBoundaryHash/authorizationHash/readEvidenceHash/pinHash`；WorldRelease入口只保存便携`WorldReference`、作者选定的中立资源坐标和真实index读取证据，不把物理Release行或完整manifest带入产品；小说入口从受控Work/大纲/规范章序读取，把选定故事核心、大纲和正文按20万字符上限完整复制为产品私有、逐单元Hash的Artifact，Pin内不保存可变来源行ID；授权保存Brief/开始revision、nonce Hash、明确rights basis及系统派生permission，原始nonce不落库；P0复用`productBuildArtifacts`，先写单元、最后写Pin闭合索引，相同Pin幂等、同Build换源失败关闭，源小说后续修改不影响冻结内容；新增3项双来源/分片/漂移/越界/篡改回归，无新增表、AI写字段或并行Context来源 |
| TOW-G3-03 | DONE | SourceManifest、Ledger和Gap Report | G3-02 | P1以登记的`text-open-world.source-pin`来源和专属Skill/Executor分批读取冻结内容；小说只向模型交付本批产品私有全文单元，WorldRelease只通过Context Gateway按冻结资源坐标完整读取，逐项复核内容Hash并保存交付证据；SourceManifest把每个单元严格区分为已读/未读，SourceLedger要求每项事实绑定已读单元、逐字引文、UTF-16偏移、来源Hash和批次，模型伪造引文、偏移、批次或引用未读单元均失败关闭；代码从实际读集和证据覆盖确定性生成SourceGapReport，未读、故事核心、主角、冲突、角色、势力、地点和时间线缺口显式进入后续阶段；三件产物形成Pin→Manifest→Ledger→GapReport Hash链并复用productBuildArtifacts候选生命周期，不增加业务表或世界引擎写入 |
| TOW-G3-04 | DONE | 主Agent会谈、GameBrief和ExperienceContract | G3-03 | 复用现有作者授权Brief作为会谈终态，以登记的单一P2 Context Source完整交付授权、SourcePin和已验收P1证据；代码确定性编译GameBrief中的主角模式、规模、严格顺序主线、有边界自由、三种输入、回合战斗、世界演化、关键到达策略、媒资、预算和直接发布完成条件；模型只补充体验语义与主角小传，并只能引用已交付claimKey；来源型主角必须引用绑定所选角色单元的证据；GameBrief、ExperienceContract和ProtagonistAsset形成Hash/basis链，任何作者意图、来源缺口、固定边界或capability偷换均失败关闭；仍只写Build Artifact候选，不读取活动来源、不写世界引擎或运行状态 |
| TOW-G3-05 | DONE | GameplayRulesetSkeleton Skill | G3-04、G2接口 | 登记的P2 Context Source只读取同一Build已验收的GameBrief、ExperienceContract、ProtagonistAsset和SourceLedger引用事实；模型只能生成世界化规则标题、说明、三属性/技能资源/装备位/货币/标准难度显示语义并引用已交付claim；代码冻结无职业/无配点、三语义属性、20级与1→5验收跨度、自动成长、G2公式、逐回合四操作、单人无元素战斗、有界物理结算、无代价复活、无限背包、三装备位、无词缀/强化/耐久、确定性制作、单货币与库存策略；唯一Effect词表直接复用G2类型事实源，并分为模型可提议、编译器专属和旧Release只读三类无重叠权限；Artifact精确声明Progression v1、Combat v3、Items v1、Crafting v2、Economy v2、Action v14及RuntimePackage v1映射，固定值、上游、claim、basis和内容Hash篡改均失败关闭；不新增表、不写Release/Session |
| TOW-G3-06 | DONE | 主角身份与PlayerBuild Skill | G3-04、G3-05 | 登记的P4 Context Source只读取同一Build已验收的GameBrief、ExperienceContract、ProtagonistAsset和GameplayRuleset；模型负责不改名、不改变核心目标的身份演绎、描述性玩法风格、两个不同主副属性选择以及基础攻击、标志技能、初始武器和恢复品语义，未知代词/外观/秘密允许留空且不得把玩法风格变成职业系统；代码固定1级、主5/副4/其余3且总预算12、初始货币100、两技能/两物品稳定键、技能机制映射、数量与后续目录依赖；PlayerBuild把真实运行字段与语义需求一并冻结，但明确标记`reserved-unbound/playerDefinitionReady=false`，只有后续Progression与Item目录精确兑现预留键后才允许装配；上下文、上游、身份、预算、货币、目录键、binding状态和最终Hash均可复验，不新增表、不写Release/Session |
| TOW-G3-07 | DONE | StoryArc、核心冲突、承诺和多结局 | G3-04 | 登记的P3 Context只读取同一Build已验收的GameBrief、ExperienceContract、ProtagonistAsset、SourceLedger和Gap Report，不重读活动来源；模型负责核心冲突、5～8个宏观节拍、与Brief数量一致的多结局语义及4～12项建立—回响—回收承诺，并只能引用当前选择的claim或允许显式假设的非阻断gap；代码固定严格顺序、等待玩家、不可永久失败、关键触发不只依赖地点，确保所有结局完成同一核心目标、阶段单调、结局差异轴唯一、至少覆盖核心冲突/角色/世界承诺且每个结局得到回收；稳定Story/Ending/Promise/Callback键由代码生成，结局Condition和承诺Scene绑定保持unbound等待后序任务与场景生产；三个Artifact形成完整上游、证据、basis和内容Hash链，结构篡改、伪造claim、错误顺序和缺失回收均失败关闭；不新增表、不写Release/Session |
| TOW-G3-08 | DONE | RegionSkeleton与世界级空间规划 | G3-03、G3-07 | P4专属Context只读取同一Build已验收的GameBrief、SourceManifest/Ledger、ExperienceContract和StoryArc；模型必须按Brief精确地区数与地点范围，把每个地区、地点和道路落到已交付claim或StoryArc空间需求，覆盖全部空间需求、每区叙事/探索/旅行功能、全图战斗/制作功能，并为所有地点写提前到达安全常态；代码按数组顺序生成Region/Location/Edge/FastTravel稳定键，固定完整世界在Build时存在但按知识渐进揭示、所有地点与地区双向连通、每区一个快旅/复活点、只有起点默认解锁、旅行耗时、无骨架期Condition、关键主线非到达触发；Scene/Quest/Actor/Encounter/Vendor/媒资及P5主线绑定全部显式unbound；完整上游、来源读取、空间需求、规模、稳定键、连通、绑定和Hash可重建复验，伪造claim、断图与重算Hash篡改失败关闭；不新增表、不写Release/Session |
| TOW-G3-09 | DONE | 严格顺序主线生产 | G3-05～G3-08 | P5专属Context只读取同一Build已验收的GameBrief、GameplayRuleset、StoryArc、EndingContracts、NarrativePromises、RegionSkeleton和PlayerBuild，不重读来源；模型在Brief范围内把每个StoryBeat单调编排为主线Stage，声明地区/地点、对话/调查/探索/战斗/准备/选择体验、玩家目标、揭示、结果、关键资产保护需求和失败恢复说明；代码生成`storyline.main`及Stage稳定键/前后链，保证首Stage来自起点、每个StoryBeat覆盖、全部Promise建立/回响/回收落到Stage、全部合规结局从最终Stage分流，按权重在冻结90～120分钟范围分配时长并从1级推进到5级；主线固定显式Action启动、非地点唯一触发、可无限等待、不可放弃/过期/永久失败、普通状态不得锁死，Quest/Objective/Scene/Reward/Condition/Effect全部保持unbound；完整上游、顺序、空间、节奏、Promise、结局、保护和Hash可重建复验，逆序、未知地点及重算Hash篡改失败关闭；不新增表、不写Release/Session |
| TOW-G3-10 | DONE | 角色/势力/地区重要故事线生产 | G3-07～G3-09 | P6专属Context只读取同一Build已验收的GameBrief、SourceLedger、StoryArc、EndingContracts、NarrativePromises、RegionSkeleton和MainlineThread，优先交付角色/势力/事件/空间claim并保持选择Hash；模型按Brief精确生成重要故事线，至少覆盖角色/势力/地区两种owner，每线形成2～4方目标/资源/压力冲突、3～6个可玩Stage、升级步骤、地区氛围信号、来源/StoryBeat/空间/Promise辅助锚点及局部后果计划；代码生成Thread/Owner预留/冲突方/Stage/Consequence稳定键，地区owner直接绑定、角色势力owner等待目录兑现，固定显式推进、非地点唯一触发、安全等待、不可放弃/过期/永久失败、缺席无压力、普通状态不阻断且不得改写主线核心目标/可达性/结局；Quest/Scene/Action/Reward/Condition/Effect/NPC/Faction绑定全部unbound，owner不足、越界空间、上游或重算Hash篡改失败关闭；不新增表、不写Release/Session |
| TOW-G3-11 | DONE | RegionNarrativePack与地区生态 | G3-08～G3-10 | P7专属Context只读取同一Build已验收的GameBrief、ExperienceContract、SourceLedger、RegionSkeleton、MainlineThread和SignificantThreads，优先交付体验/地区/重要故事必需claim；模型按地区逐项设计独特幻想、地方冲突/问题、生活基线、2～5条矛盾与状态轴，精确覆盖全部地点的日常活动/NPC需求/传闻/时段表现，并按Brief保底精确提供6个普通任务、4个任务模板、12个随机事件种子及每区至少3条传闻；每区同时提出重要Agent维护角色、规则驱动功能/氛围角色和势力需求，重要角色/势力owner由唯一地区需求承接；代码生成Pack/Tension/StateAxis/LocationPlan/Actor与Faction预留/Quest与Template与Event与Rumor种子稳定键，固定普通世界继续、主线等待、重要故事安全点等待、地区后果不阻断主线和全部目录绑定unbound；地点漏项、地区同质、保底不足、owner缺失及重算Hash篡改失败关闭；不新增表、不写Release/Session |
| TOW-G3-12 | DONE | QuestSkeleton与ContentRequirementManifest | G3-09～G3-11 | P8专属Context把Brief、体验、玩法、主线、重要故事和地区种子投影为23项确定性Quest Source；模型逐项生成故事动机、1～4 Stage、可执行Objective及语义内容需求，代码保证7主线Stage、6重要故事Stage、6普通任务种子和4地区模板一一覆盖，固定主线/重要故事无限等待不可放弃或永久失败、普通任务放弃可重接、模板由地区导演实例化、到达地点不单独触发；ContentRequirementManifest同时汇总全部Objective及地区角色/势力/地点交互需求，按技能、遭遇、物品奖励、制作经济、NPC、地图交互和QuestFinalize声明唯一后序owner，所有正式目录/Action/Condition/Reward/运行引用保持unbound；遗漏来源、弱化保护、无敌人战斗目标、同名定义冲突、模型越权字段和重算Hash篡改失败关闭 |
| TOW-G3-13 | DONE | 技能、物品、敌人、遭遇、奖励目录生产 | G3-05、G3-06、G3-12 | 三条专属Lane均从同一Build已验收QuestSkeleton与Manifest出发：Progression固定20级平方经验、自动属性成长、两项初始/六项等级/任务技能精确需求和主动攻击公式；Encounter逐项兑现enemy/encounter需求、每区基础遭遇、1～5级敌人数值、基础技能策略、战斗Objective/地区覆盖及失败恢复；Item/Reward精确兑现两项初始物品与item/equipment/material/reward需求，为全部23个任务和5个遭遇生成奖励、为5个敌人生成地区材料掉落，并确定性分配主线总计1600经验以支撑1→5级。模型只负责技能/状态/敌人/遭遇/物品/奖励语义和有界选择，代码固定稳定键、数值、保护、来源、预算与消费者；Action/Effect/Condition/Quest/Reward/Drop正式引用保持unbound交给P8F，漏项、越界、无来源、预算不闭合、模型越权及重算Hash篡改失败关闭 |
| TOW-G3-14 | DONE | 配方、商店、NPC运行规则目录生产 | G3-11～G3-13 | Crafting/Economy、NPC Runtime与Map Interaction三条Lane完成：配方/商店闭合来源消耗、库存、价格、服务Actor预留和反套利；NPC目录保留整体小传并固定关键保护、普通四时段规则、三档道德/阵营态度及功能替代；地图目录原样继承完整Region/Location/Edge/FastTravel拓扑，为每个地点和任务需求生成提前到达安全交互与确定性SVG坐标，固定逐步揭示、旅行推进时间、首版快旅不中断且不消耗资源。所有Action/Condition/Effect/Scene/Quest运行引用仍为unbound，留待P8F/P9装配 |
| TOW-G3-15 | DONE | QuestFinalize与EncounterFinalize | G3-12～G3-14 | 11件已验收叙事/任务/玩法目录以完整Hash链原子交付；模型只补任务与区域发牌语义，代码生成Quest/Stage/Objective、奖励、失败/过期/时间、战斗/物品/制作/商店/NPC/地图/旅行/复活/世界演化的Condition/Effect/Action及双向真实引用；每个结局也在P8F形成独立Condition及固定`route→unlock→reach` Effect/Action，不留给V3临时生成；主线和重要故事继续受保护等待，普通任务可放弃/过期；Director按区域冻结固定任务、模板、随机事件、冷却、并发与空白牌预算 |
| TOW-G3-16 | DONE | SceneScript、ChoiceContract和三类交互绑定 | G3-15 | P9以代码侧完整验签、模型侧去重投影的原子Context生产任务委托/目标/收束、角色对话、地点交互和随机事件Scene；Context v2只把同场景全部Action共有的Condition提升为场景门槛，每个Action/Choice仍各自持有条件，Objective只绑定当地显式内容需求Actor而不默认要求任务发布者在场；v1历史Context保留旧投影校验以支持durable Run恢复；模型只写场景/对话/选项标签、模板三变体、事件/传闻表现和非战斗自然语言示例，代码固定知识边界、稳定键、目标及Action Hash；最终主线场景为每个P8F结局Action生成唯一Choice，系统Action、固定Choice与两条自然语言示例共同指向该结果源；战斗自然语言关闭，低置信度只回应和推荐，高风险需确认，模型不得创建Action/Quest/地图或写状态 |
| TOW-G3-17 | DONE | UI/媒资需求、内容时长、平衡、语义评审和局部修复 | G3-06～G3-16 | P2表现轮廓、P10系统收口、V1预检和V2双评审均登记正式Skill/Context/Executor；代码冻结15个运行模块、18个UI消费槽及完整媒资槽，把本次实际排产与`fallback-only`槽分开并让0/4/9音频槽与Brief/Plan同源；内容库存时长和单次游玩时长分离；V1覆盖Schema/Hash链/全量Action—Scene—Choice—结局引用/可解性/预算/消费槽，V2问题映射到唯一新Build修复任务并按DAG传播stale，绝不原地修改已验收Artifact，真人时长校准继续保留为发布证据 |
| TOW-G3-18 | DONE | AI生产Build装配端到端验证 | G3-01～G3-17、G2-28 | 共享正式生产入口已按产品类型选择文字开放世界专属P0～P10/V1～V3/QA Plan与Executor；P0按Brief精确冻结来源单元，P1逐批保存真实ContextManifest且恢复不重复成功调用；Narrative v2完整携带P9正文/对话/随机事件，Action v15携带三类输入绑定，V3不再创造上游内容；每个实际媒资核验物理Blob、Capability、生产/Provider回执与权利策略，IntegrationReport及覆盖/权利子证据均验Hash；QA逐门判断，原型可玩fallback与商业真实资产覆盖分开；vNext-only、Hybrid、Legacy均有正式读取证据，Build Preview可创建只含统一`textOpenWorld`投影的Session，无需人工改JSON |

阶段出口：来源→故事→任务→玩法目录→场景→Build的完整内容生产链。

---

## 6. G4 · 完整玩家端（15项）

阶段目标：真实玩家不进入开发工具即可完成首版全部游戏循环。

| ID | 状态 | 工作包 | 依赖 | 完成判据 |
|---|---|---|---|---|
| TOW-G4-01 | DONE | 玩家入口、Release/存档选择和Session启动 | G1-10、G2-28 | 玩家默认停留游戏库；作品按已核验`productionKey`分组并以版本号选择当前Release，详情可明确切换旧版；新旅程、旧Release存档继续、正式Release与Build Preview显式隔离；版本/来源/Package/Release证据可见；损坏发布留作诊断且禁开新档，选档失败清空投影并可重试；删除需确认且即使来源损坏也只删除当前scope/世界分组的Session私域；24项定向回归覆盖选版、启动、预览、损坏、删除、并发载入隔离、stale确认恢复、跨Session行动结果隔离和原游戏循环 |
| TOW-G4-02 | DONE | 响应式游戏壳与场景主界面 | G4-01 | vNext与legacy共用纯展示壳；桌面左导航/中央主视图/右上下文三栏，1180px以下上下文抽屉，780px以下严格五项底部导航；场景、地图、任务、角色、更多只重排现有能力，Header、Release来源与运行包Hash、退出、战斗/全局状态和返回场景入口稳定；Session切换复位纯UI态并撤销旧确认；高风险确认和上下文抽屉隔离背景、循环焦点并支持Escape；旧版缺失角色合同明确降级且不伪造；13项壳/真实运行器回归与双视口Playwright证明导航不写Projection、三栏不重叠、移动抽屉和页面无横向溢出 |
| TOW-G4-03 | DONE | 场景叙述、NPC对话、固定选项和自然输入 | G2-11、G2-18、G4-02 | 当前地点、场景共有条件、任务生命周期与场景显式NPC在场/存活共同投影冻结P9场景，不保存第二份scene状态；旧P9无论同地或异地误注入的任务发布者都不会吞掉Objective，单个Action条件不成立也不会吞掉同场景其他合法Choice；新生产把角色拥有的委托/收束放在owner常驻地点，v1 Context保留旧Quest端点以恢复durable Run，旧冻结包运行时按常驻地点归一，地点改变时隐藏矛盾旧正文并显式使用确定性兼容回退；冻结叙事、NPC三档态度对白、固定Choice、系统Action及自然输入在同一场景共存，三类输入保留source后进入同一Action/Event；交谈与开战按冻结Actor场景和Encounter Effect收窄目标，Narrative v1 / Action v14还按旧稳定Action键恢复唯一交谈Actor；场景专属玩家Quest Action按offer/当前Objective/resolution生命周期精确收窄实例，同定义多轮任务不串目标，Quest页和命令不能越过NPC/地点/Stage/Objective，P8F的`observe + quest`兜底需求同样受管；通用use/equip/craft/buy/sell不会因被Objective引用而全局锁死，未绑定场景的合法通用Action仍作为环境行动；普通多目标、无目标、无匹配、战斗自由输入均fail-closed，多敌战斗在G4-09前确定性选首个存活目标；v15/v14场景均隐藏缺参数制作交易按钮；高风险确认必须携带整个ProductRuntimeState事件基线，拒绝缺失、跨标签页stale及旧DOM串Session，stale后刷新权威Projection再重试；Action执行期间切换存档后，旧回执、错误、busy和刷新均不得串入新Session；回执使用独立live region；运行投影不暴露内部purpose、知识边界或未发生结果；32项G4场景/壳回归、13项Action注册表及6项犯罪回归与真实浏览器路径覆盖上述边界 |
| TOW-G4-04 | DONE | HUD、当前任务、状态变化和通知 | G2-12、G2-17、G2-20、G4-02 | 生命/技能资源、地点/地区、天数/时段/天气从唯一Projection和冻结模块派生；显式主追踪不会被pin冒充，最多3个pin分列，摘要含状态、阶段、下一必需目标和期限；近期变化只从同Session连续且与Projection head闭合的Command/Random/Effects终态链重建，条目与细节有界，跨Session/断链/未来事件失败关闭；Director v2随机事件只有完整授权、冻结定义、Narrative和成功Effects才能标记已发生/已结算，不从历史猜测仍激活；初载/换档不重播，玩家回执和系统重要变化播报分流，常驻live region不被替换，独立读取暂态不推进cursor；10项新增投影/UI回归覆盖上述边界 |
| TOW-G4-05 | DONE | 完整任务日志 | G2-09～G2-12 | 四类任务与历史分类，状态/期限/追踪/地区/角色势力组合筛选；只投影已揭示实例、当前/过去Stage、Objective、已知地点、固定奖励、已读相关事实和规范Event历史；Session绑定地图定位不写状态；日志只执行追踪/取消和精确放弃，不绕过Scene接取/重接/目标/领奖。Action v16覆盖未开始/逐Stage放弃、原发布Scene四步原子重接、限时放弃按原期限过期、终态追踪清理与Director镜像同步；Quest v2配套验签，旧P8F/P10 Context与Action v15保持兼容 |
| TOW-G4-06 | DONE | SVG节点地图、路线和快速旅行UI | G2-13～G2-17 | 单一纯投影组合披露安全地图、相邻普通旅行和已授权快旅；未知地点/隐藏道路完全省略，听说地点只显示名称和公开通行信息，快旅内部路径只投影已知边；完整尺寸SVG与移动等价列表均先选点/高亮路线再显式确认，展示当前位置、知识层级、全部已知道路、预计时间、风险、阻断和已解锁快旅点；地点具备键盘操作与58px命中面。选择绑定Session及外层ProductRuntime事件基线，stale需重选；地图通过本次Promise按请求代次和Session/Action/目标/基线局部接收回执，换档不串反馈或提交锁。执行仍走唯一Action/Effect/Event链，普通单边与快旅原子结算不变；新增10项专属投影/UI反例，35项地图/旅行/任务/壳回归与桌面移动真实Playwright路径通过；无新持久化或三注册表登记 |
| TOW-G4-07 | DONE | 角色、等级、属性、技能和状态UI | G2-01～G2-05 | 单一披露安全投影只读组合冻结Release与当前Session，公开身份不含私密知识/来源键；角色页以实际初始等级解释世界化三属性自动成长和六项派生值，数值来源只显示基础/等级/属性名/装备名；满级、非1级开局、0资源和旧冷却投影安全。已学与锁定技能展示中文类型、目标、消耗、规则/当前冷却和可能来源，未发放任务不泄露标题，技能条件就绪不冒充正式Action可执行，被动不虚称生效；只显示当前激活状态。主角头像合同缺失时使用可访问占位且不误用NPC媒资；页面无业务Action，切页不写Projection/Event；7项专属投影/UI反例、4项壳集成和桌面/移动Playwright通过；无新持久化或三注册表登记 |
| TOW-G4-08 | DONE | 背包、物品详情、装备和比较UI | G2-06～G2-08 | 披露安全纯投影展示实际持有物、摘要、分类/搜索/排序/详情、安全来源、真实数值修正与关键保护；使用/装备/卸下/固定单件丢弃精确回到统一Action/Event/确认链，已装备实例排除于可移除数量；三槽比较显示旧/新/差值和资源调整；恢复品未满Condition、上限裁剪、物品Replay绑定及旧Release无drop兼容完整；出售只显示政策，真正交易留给G4-10；15项新专属回归、旧UI/壳集成和桌面/移动Playwright路径通过；无新持久化或三注册表登记 |
| TOW-G4-09 | DONE | 逐回合战斗UI | G2-22～G2-25 | Action v17、Progression v2与Combat v4闭合攻击、恢复、资源和状态技能，scalingAttribute、装备skillPower、被动与战斗状态共同进入唯一确定性结算；状态按目标自身行动计时并支持拒绝、刷新、叠层和上限，cooldownTurns明确不含施放回合，授权、Effect、Event、Replay冻结并复核完整结果。玩家战斗页取代活动战斗时的场景页，显式选择多敌目标，提供战斗、逃跑、技能、道具四组操作及不可用原因、资源/冷却/数量、生命/状态、实际日志、已落盘奖励、战前重试和复活；内部键与未发生奖励不泄漏。刷新可从Command/Effect账本恢复缺失系统后续，Director与战斗奖励使用稳定原因链且只结算一次；旧Action≤16、Progression v1、Combat≤3和旧durable生产Context继续兼容。相关运行回归73项、生产回归63项、玩家UI回归20项及移动端正式Release战斗Playwright通过 |
| TOW-G4-10 | DONE | 制作、商店和交易UI | G2-26、G2-27 | 披露安全投影仅展示已学配方、通用锁定占位与当前地点存活/当班服务商人；材料、产物、耗时、批量、货币、库存、整数价格、三档关系倍率及装备对比完整。制作/买入/卖出在本地摘要二次确认后，按当前Session及外层ProductRuntime基线重投影，再进入唯一Action/Event事务；安全回执重算提交时Authorization并精确复核Effect、summary、before/after，内部键和未分类诊断不进入玩家DOM。Store隔离基线漂移、换档、幂等重试和乱序请求；14项新回归、72项关联回归及真实Chromium“买材料→制作→卖出”落库闭环通过；无新持久化或三注册表登记 |
| TOW-G4-11 | DONE | 关系、百科、传闻、历程和成就UI | G2-20、G2-21、G2-28 | 生产侧闭合P7传闻→P8F Knowledge/Rumor/传播与确认Effect/3～6成就→Director→P9安全表现→P10/Runtime；Knowledge只能由同Stage或更晚的合法任务Reward/结局下游确认，重要故事不得借全局结局越过自身进度，每个Knowledge/成就Effect只允许一组独占RewardContract/领奖Action或精确结局Action，旧条件式发布保持原义。fresh Action v18按来源Stage order生成唯一主线根、严格主线前驱和重要故事的主线窗口/线内前驱；每个锁定任务只由系统`action.reveal.*`执行`locked → available → revealed`，P10从前置图拒绝断点、分叉和环。fresh Director v3把受治理传闻冻结到唯一地区/地点并唯一放入对应牌组，以牌组`rest`和全局休息Action保证传播入口可达，候选/授权/Replay均复核地点；Director v2重冻结时删除归一字段以保持历史字节和Hash。P8F与P9共用确定性场景容量公式并在127项处封顶；P9 fresh生产按Scene独立请求并以零Scene共享请求处理公共表现，最多127+1次，另保留1次明确片段修复授权；模型看不到其他Scene、未来目标、Source Claim、人物私密内容或未声明公开的P7规划字段，片段有durable恢复证据，已成功片段不会重复调用或计费，已返回的超额响应先持久原始响应与真实usage再阻断候选。P9完整作者聚合稿以Hash绑定幂等键并记录durable `source-snapshot`，governed/legacy均以零模型、零token和零费用走同一编译验收，同时保留duration/storage预算。共享账本逐attempt计费，重试仅预留同Run剩余额度，部分调用费用上界按实际调用比例分摊，未知结果保留预留。完整Build初始最多154次调用、总授权155次，token按156份独立权重、时长按100份独立权重分配，P8F/P9分别占12/19份token，P9占48份时长且输入/输出留有最大片段修复余量。玩家侧世界记录从当前Session Projection与连续Event派生：关系含当前位置人物、已揭示任务联系人和任务势力并区分在场/异地/缺席/死亡；百科只含已知地图、已持有物和已确认Knowledge；传闻初读与后续确认保留各自时间；历程只含可验证终态；成就只公开已获得条目。五标签具备键盘导航、搜索/分类/地图定位与明确空态，切档复位筛选；专属、关联运行/生产及正式Release双视口/刷新E2E通过；无新表、Schema、migration或AI写入口 |
| TOW-G4-12 | DONE | 保存、读档、分支列表、版本和设置UI | G1-09～G1-11 | 玩家保存中心统一提供存档、分支、版本与设置四页；正式Release最多20个命名手动档，自动档、战前档、里程碑和系统点独立轮转且只由系统维护，派生档时间按规范终态Event校准。读历史检查点必建同一不可变Release子分支并保留父线未来；当前分支可切换、修复或经确认删除，owner、世界分组、来源Hash、投影Head和检查点Hash均失败关闭。版本页区分当前固定Release、已核验同产品版本和两类兼容声明，只允许旧Release继续而不暗示迁移；Build Preview明确禁用正式保存和分支。字号、行距、高对比度、减少动效及预留音频偏好按冻结productKey浏览器本地保存，未知字段与敏感凭证拒绝。异步操作按Session和代次隔离，确认框支持焦点、Escape及返回触发器；15个关联回归文件81项、专项31项与正式Release双版本Chromium E2E通过，无新数据库表、Schema、AI写入口或WorldRelease回写 |
| TOW-G4-13 | DONE | 渐进式教程 | G4-01～G4-12 | vNext与legacy共用浏览器本地教程Coach，按稳定作品及Release/Preview通道隔离进度，正式游玩跨Release/Session延续；系统步骤与冻结作者步骤只有在当前页面、当前场景及当前可见Action真实披露后才可自动出现，每个Session/页面/Event周期最多一项，场景、Action、战斗或目标撤下即清理旧提示；支持明确完成、单项跳过、暂停/恢复、重看和显式重置，帮助列表保留真实支持能力且不执行Action。未知目标、超长/超量或非法作者内容失败关闭并只给安全兼容计数，暂未可用Action不误报；提示具备目标高亮/离屏定位、读屏播报、重看焦点、高对比和移动端长文内滚动。进度只写localStorage，不进入World、Release、Session、Event、Checkpoint、导出、提示词或凭证；15个关联回归文件83项、1项正式Release Chromium E2E、TypeScript/ESLint及独立P1/P2审计通过；无独立教学场景、新表、Schema、三注册表或AI写入口 |
| TOW-G4-14 | READY | 无模型、断网、错误、空状态、移动端与无障碍收口 | G4-01～G4-13 | loading/empty/recoverable/blocking齐全；键盘、读屏、地图列表和静音可玩 |
| TOW-G4-15 | QUEUED | 玩家端真实路径E2E | G4-01～G4-14 | 隔离数据下完成开场、任务、地图、战斗、成长、制作、存档和结局 |

阶段出口：一款不依赖开发面板的完整确定性文字开放世界客户端。

---

## 7. G5 · 创作者工作台与发布更新（12项）

阶段目标：创作者可以从来源生产、审查、修复、试玩、发布并更新游戏。

| ID | 状态 | 工作包 | 依赖 | 完成判据 |
|---|---|---|---|---|
| TOW-G5-01 | QUEUED | 独立产品创建入口与来源选择 | G3-02、G3-03 | 世界观/小说双入口、版本、Hash、能力和缺口可见 |
| TOW-G5-02 | QUEUED | 主Agent会谈与Brief确认 | G3-04 | 用户设定、模型理解、未决项、规模、边界、媒资和完成条件可编辑确认 |
| TOW-G5-03 | QUEUED | BYOK凭证、模型、预算和费用UI | G3-01、G5-02 | Key不落日志/Artifact；运行前估算、运行后实际用量和余额错误可见 |
| TOW-G5-04 | QUEUED | 生产计划、DAG、Run进度和恢复 | G3-01、G5-02、G5-03 | 依赖、并行组、步骤、尝试、暂停、重试、stale和checkpoint可见 |
| TOW-G5-05 | QUEUED | Artifact浏览和受治理内容表 | G3-05～G3-16 | 故事、地区、角色、任务、物品、敌人、商店、配方及引用可查 |
| TOW-G5-06 | QUEUED | 直接编辑与Agent修改双入口 | G5-05、G1-12 | 两类修改都先成候选，验证后adopt；不允许页面散写正式表 |
| TOW-G5-07 | QUEUED | 引用影响、stale、问题定位和局部修复 | G3-17、G5-06 | 修改上游时下游失效可见；修复有界，不默认全量重做 |
| TOW-G5-08 | QUEUED | 媒资需求、生成/导入、权利和绑定 | G3-17 | 程序地图、头像、背景达到必需覆盖；音频可选且有降级 |
| TOW-G5-09 | QUEUED | 质量门、灰盒试玩和问题回执 | G3-18、G2-28、G5-07 | 硬门、语义评测、豁免、隔离试玩和问题复现证据完整 |
| TOW-G5-10 | QUEUED | Build装配、发布和不可变ProductRelease | G5-08、G5-09 | 一次授权后可完成生产；发布前验证消费槽、Hash和终态Receipt |
| TOW-G5-11 | QUEUED | 新Release、兼容报告和存档迁移 | G1-09、G5-10 | 旧档留在旧Release；兼容时可预演迁移并保留原分支 |
| TOW-G5-12 | QUEUED | 工作台导入导出、删除和真实E2E | G5-01～G5-11、G1-12 | 从来源到发布更新全路径通过，刷新/失败/导入导出和删除不丢数据 |

阶段出口：创作者不需要手改JSON即可完成游戏生产和版本维护。

---

## 8. G6 · 运行时AI与有边界自由（10项）

阶段目标：AI增强表达和内容供给，但不能越过确定性规则或保存第二份游戏状态。

| ID | 状态 | 工作包 | 依赖 | 完成判据 |
|---|---|---|---|---|
| TOW-G6-01 | QUEUED | 运行时AI Skill、Contract和权限边界 | G1-12、G2-28、G3-01 | 每个Skill的reads/writes/model/schema/预算/失败策略已登记 |
| TOW-G6-02 | QUEUED | Context Manifest与按需上下文选择 | G6-01 | 只读当前场景、相关任务/人物/知识和必要摘要；无固定条数冒充检索 |
| TOW-G6-03 | QUEUED | 自然语言意图映射和风险确认 | G1-04、G4-03、G6-02 | 低风险唯一匹配直接执行；高风险/不可逆确认；多匹配让玩家选择 |
| TOW-G6-04 | QUEUED | NPC对白与角色知识边界 | G2-18、G2-20、G6-02 | 人格、态度和已知事实一致；无秘密泄露；失败使用安全模板 |
| TOW-G6-05 | QUEUED | 场景、战斗和任务结果演绎 | G1-11、G2-25、G6-02 | 只描述Receipt已发生结果，不额外创造物品、伤害、关系或推进 |
| TOW-G6-06 | QUEUED | 地区化模板任务文字包装 | G2-28、G3-11～G3-15、G6-02 | 代码先选合法槽位，AI只包装；失败可不发或使用预制变体 |
| TOW-G6-07 | QUEUED | 叙事导演建议和主线保护 | G2-28、G6-02 | AI只建议候选；代码控制密度、冷却、冲突、保护和Blank输出 |
| TOW-G6-08 | QUEUED | 对话摘要、玩家知识、角色知识和长期最小记忆 | G6-02、G6-04 | World Truth/Player Knowledge/Actor Knowledge隔离；小任务只留必要回执与指纹 |
| TOW-G6-09 | QUEUED | 模型失败、超时、预算、余额和断网降级 | G5-03、G6-01～G6-08 | 固定Action仍可玩；重试有界可见；未知结果不隐藏重发；成本可观测 |
| TOW-G6-10 | QUEUED | 运行时AI评测与E2E | G6-01～G6-09 | 越权、剧透、假推进、错误映射、长上下文、断网和高风险确认反例通过 |

阶段出口：自由输入自然可用，模型失败时游戏仍然完整可玩。

---

## 9. G7 · “盐脊”验收、发布更新与旧入口收口（15项）

阶段目标：用一款正式小型游戏证明整套架构真实可用，并完成旧体系退场。

| ID | 状态 | 工作包 | 依赖 | 完成判据 |
|---|---|---|---|---|
| TOW-G7-01 | QUEUED | 生产“盐脊”完整来源与Build内容 | G3-18、G5-10 | 来源证据、生产Run、Artifact、媒资和Release齐全 |
| TOW-G7-02 | QUEUED | 完成2地区、8～12地点和SVG节点地图 | G7-01 | 道路、探索、提前到达、2个快速旅行点和移动端列表可用 |
| TOW-G7-03 | QUEUED | 完成严格主线、两个结局和两类重要故事线 | G7-01 | 主线可达、结局条件不同；角色线及势力/地区线均可完整体验 |
| TOW-G7-04 | QUEUED | 完成普通任务、限时任务、模板任务和随机事件库存 | G7-01 | 支持3～5小时内容选择；重复、过期、放弃、重接和永久失败可见 |
| TOW-G7-05 | QUEUED | 完成1→5级成长、技能、物品、敌人、制作和经济目录 | G7-01 | 三属性、装备、材料、商店、配方、奖励和三种遭遇强度形成闭环 |
| TOW-G7-06 | QUEUED | 完成头像、场景背景和程序地图最低媒资 | G5-08、G7-01 | 必需槽覆盖、权利/来源、alt文本和文字降级通过 |
| TOW-G7-07 | QUEUED | 自动化17条完整玩家路径 | G4-15、G6-10、G7-02～G7-06 | 产品架构第31.1节全部路径在隔离数据中通过 |
| TOW-G7-08 | QUEUED | 单元、属性、不变量、集成和固定seed重放测试 | G2-28、G7-01 | 资源非负、所有权唯一、主线可达、幂等、重放Hash和Session隔离通过 |
| TOW-G7-09 | QUEUED | 长时世界演化、发牌和任务压力测试 | G6-10、G7-04 | 1,000批次有界；无任务洪水、跨区错误、主线误过期和无限Agent运行 |
| TOW-G7-10 | QUEUED | 性能、移动端、无障碍和大状态测试 | G4-14、G7-01 | 启动、地图、长任务日志、大背包、重放、IndexedDB和目标设备门通过 |
| TOW-G7-11 | QUEUED | AI叙事质量、重复、时长和成本校准 | G6-10、G7-01 | 主线/重要故事质量、模板差异、3～5小时库存、调用延迟和费用有数据证据 |
| TOW-G7-12 | QUEUED | 导入导出、删除、版本兼容和迁移测试 | G5-11、G5-12、G7-01 | 完整往返、引用重映射、旧档留存和兼容迁移正反例通过 |
| TOW-G7-13 | QUEUED | 真人完整游玩与问题分级 | G7-07～G7-12 | 真人直接游玩正式候选版到两个结局；记录体验、叙事、战斗、UI和成本问题 |
| TOW-G7-14 | QUEUED | 发布修复版并验证真实更新流程 | G7-13 | 问题经局部修复形成新Release；旧档继续或显式迁移；修复真实生效 |
| TOW-G7-15 | QUEUED | 下线旧编译器、Agent契约和旧UI入口并完成交付 | G7-14、G0-06 | 无双轨入口；全量CI/E2E通过；能力基线、已完成索引、用户文档和交接证据更新 |

阶段出口：至少一个正式Release由真人完整玩到两个结局，并通过新Release完成一次真实修复更新。

---

## 10. 后续能力池（不计入首版121项）

| ID | 状态 | 后续能力 | 进入条件 |
|---|---|---|---|
| TOW-L01 | LATER | 任务目标固定但接受表外新解法 | Action候选、预演、确认、回滚和专项Harness成熟 |
| TOW-L02 | LATER | 玩家即时创建任务、地点和新地区 | 动态内容版本、地图迁移和长期一致性验证成熟 |
| TOW-L03 | LATER | 关键NPC死亡后的替代主线 | 替代角色、线索、道具和可达性证明成熟 |
| TOW-L04 | LATER | 加入敌对势力与主线方向翻转 | 阵营身份、敌对、犯罪和多主线状态机成熟 |
| TOW-L05 | LATER | NPC个人亲密度和深层关系 | 当前道德/阵营/三档态度经过真人验证仍不足 |
| TOW-L06 | LATER | 友方NPC参战、队伍编成和同伴养成 | 单主角战斗、装备、AI和UI稳定 |
| TOW-L07 | LATER | 多难度、自动战斗和技能优先级 | 标准难度逐回合战斗完成平衡数据积累 |
| TOW-L08 | LATER | 命中、闪避、元素、抗性、词缀、强化和耐久 | 基础战斗与经济循环经过完整游戏验证 |
| TOW-L09 | LATER | 多货币、供需、通缉、司法和监禁 | 单货币与局部犯罪系统稳定 |
| TOW-L10 | LATER | 像素地图、WASD、碰撞、潜行和空间关卡 | SVG节点地图先证明内容与任务循环 |
| TOW-L11 | LATER | 同一Release多语言Artifact | 单语言术语表、文本版本和发布更新稳定 |
| TOW-L12 | LATER | 更接近无限自由的持续开放世界 | 首版有边界自由的安全性、成本和长期一致性达标 |

---

## 11. 单项完成定义

工作包只有同时满足适用项，才能标记 `DONE`：

- 产品边界、生产/运行阶段、数据owner和世界引用方向正确；
- 正式读取进入 `CONTEXT_SOURCES`，正式写入进入 `FIELD_REGISTRY / AdoptionSchema`；
- 新表进入 `PROJECT_TABLES` 并具有迁移、导入导出、删除和引用重映射；
- Schema、类型、服务、UI消费方和错误回执共同完成；
- 确定性规则不只存在Prompt里，AI正文不成为第二事实源；
- 正例、关键反例、刷新、失败恢复和幂等测试通过；
- 涉及真实路径时具有隔离E2E证据；
- 取代旧入口时旧入口同步删除或明确门控；
- 文档、能力基线和任务状态同步更新；
- `check:architecture`、`check:required-tables`、`check:ai-manual`、TypeScript、相关测试、build和`git diff --check`通过；
- 阶段/交付完成时运行完整 `npm run ci`，跨产品或真实数据路径按要求运行 `npm run ci:e2e`。

## 12. 开始开发时的第一批顺序

用户下达“开始开发”后，不同时铺开121项，按以下顺序启动：

1. `TOW-G0-04`：当前代码完整关联闭包审计；
2. `TOW-G0-05`：世界引擎冻结来源出口核验；
3. `TOW-G0-06`：复用/改造/删除矩阵；
4. `TOW-G0-07`：把5项剩余校准内容变成配置入口；
5. `TOW-G0-08`：盐脊Brief；
6. `TOW-G0-09`：生成G1首张功能开工卡；
7. `TOW-G0-10`：复核后进入 `TOW-G1-01`。

除非用户另行指定，第一段业务代码应以 `TOW-G1-01～G1-13` 的“人工最小包可重放纵切面”为交付单元，而不是先做某个孤立页面。

## 13. 变更记录

| 版本 | 日期 | 内容 |
|---|---|---|
| 1.1.84 | 2026-09-09 | 完成G4-13渐进式教程：vNext/legacy共用本机Coach，正式作品进度跨Release/Session、Preview独立；系统与作者提示按当前页面、选中场景、战斗就绪和可见Action真实披露，每周期至多一项，支持完成、跳过、暂停恢复、重看和重置。冻结作者内容经严格白名单与有界投影，未知/超长/超量内容只给兼容计数，未出现Action保持安静；提示补齐离屏目标定位、失效清理、读屏、焦点、高对比、层级和移动长文滚动。教程只写localStorage，不触及任何游戏状态、导出、提示词或凭证；15个关联回归文件83项、正式Release Chromium E2E、TypeScript/ESLint与独立审计通过。总进度82/121，业务功能72/111，下一项G4-14 |
| 1.1.83 | 2026-09-09 | 完成G4-12保存与设置中心：正式Release支持20个手动档、系统维护的自动/战前/里程碑档、历史检查点子分支、分支修复删除和固定Release继续；每个Session独立复核冻结来源，未核验记录只保留安全诊断，Preview禁止正式保存/分支，新版本只展示兼容声明且不提供迁移。玩家偏好按稳定productKey浏览器本地持久化，字号、行距、高对比度和减少动效已接入，音频仅保留未来设置并明确当前未接入；保存操作、成功回调和确认焦点均受Session/代次保护。15个关联回归文件81项、独立复审31项和双版本Chromium E2E通过；总进度81/121，业务功能71/111，下一项G4-13 |
| 1.1.82 | 2026-09-09 | G4-11最终语义收口：fresh Action v18把主线与重要故事的Stage顺序、开放窗口和系统揭示双Effect冻结成可重放前置图；Director v3把每条受治理传闻限定为唯一地区、地点和牌组，并以`rest`与全局休息Action保证抽牌入口可达，Director v2保持历史字节/Hash；Knowledge与成就落实同Stage或更晚的合法确认顺序和唯一Reward/Action owner。P9作者聚合稿以草稿Hash、`source-snapshot`和零模型直验进入同一Harness，duration/storage预算保留；已付费超额响应先落完整证据再停止后续分片。当前库存新增50项回归、1项Playwright并增强1项既有作者修订回归；完整CI的619个测试文件、3007项测试，以及正式Release桌面/390px刷新Playwright均通过。总进度80/121，业务功能70/111，下一项G4-12 |
| 1.1.81 | 2026-09-08 | G4-11审查收口：修复成就资格与授予同批导致Director永远不可匹配的问题，改由真实任务奖励或结局Action直接唯一授予并保留旧条件式包；严格复验Knowledge摘要、传播单地区/地点、未读条件和Stage完成来源。P8F/P9共用场景容量公式并在127项封顶；P9按Scene硬隔离为最多127项独立请求加一项零Scene共享请求，剔除未来目标、Source Claim和未声明公开的人物规划字段；每片有durable原始响应/候选/恢复证据，另保留一次片段修复预算。完整Build初始最多154次调用、总授权155次，token总权重156、时长总权重100，P8F/P9分别占12/19份token，P9占48份时长并为最大片段保留输入/输出余量。世界记录补无Actor任务势力、人物在场状态和传闻确认真实时间。总进度80/121，业务功能70/111，下一项G4-12 |
| 1.1.80 | 2026-09-08 | 完成G4-11关系、百科、传闻、历程与成就UI，同时补齐此前不存在的Knowledge生产编译闭环：P7受治理传闻经P8F形成唯一Knowledge/Rumor、地区传播、阶段门槛、任务/结局确认Effect和3～6个真实成就；P9以正规化最小公开材料写表现，传闻事实逐字段复制且SourceLedger证据、人物秘密、内部真相和未来目标不进入模型；P10、预检及运行包验证全链引用。玩家世界记录仅显示实际接触人物、已知事实、已读传闻、连续可验证历程和已获得成就；正式Release桌面、390px及刷新回放路径验证隐藏内容不泄露。旧Release保持兼容，无新表或Schema；总进度80/121，业务功能70/111，下一项G4-12 |
| 1.1.79 | 2026-09-08 | 完成G4-10制作、商店和交易UI：披露安全投影与专属响应式界面展示已学/锁定配方、材料/产物/批量/耗时、当前营业商店、买卖库存、货币、价格倍率、不可用原因及装备比较。数量和价格摘要先二次确认，后以外层ProductRuntime事件序列重验Session和Action；执行仍全部进入既有Crafting v2 / Economy v2 / Action / Effect / Event事务。回执根据提交时前态重算授权，复核summary及before/after后仅输出世界化变化，玩家壳将未分类底层诊断收口为固定公开指引；Store对stale、跨Session、重复命令和乱序完成隔离。14项新回归、72项关联回归和Chromium真实落库闭环通过；总进度79/121，业务功能69/111，下一项G4-11 |
| 1.1.78 | 2026-09-08 | 完成G4-09逐回合战斗UI与结构化战斗纵切面：Action v17、Progression v2、Combat v4把攻击、恢复、资源、状态、被动、属性缩放、装备skillPower、目标自身行动持续时间、叠层策略和不含施放回合的冷却全部收进确定性授权与Replay；活动战斗切换为专属响应式页面，提供显式多敌目标、战斗/逃跑/技能/道具、不可用解释、资源冷却、状态效果、真实日志、实际奖励、战前重试与复活。崩溃后从Command/Effect账本补跑系统后续，Director和胜利奖励幂等唯一；历史运行包与durable生产Context保持原语义。相关运行73项、生产63项、玩家UI20项及390px正式Release Playwright通过，architecture、required tables、AI manual、TypeScript、ESLint和diff检查通过；总进度78/121，业务功能68/111，下一项G4-10 |
| 1.1.77 | 2026-09-08 | 完成G4-08背包、物品详情、装备和比较UI：单一安全投影展示摘要、分类/搜索/排序、安全来源、用途、真实修正、关键保护、四类物品Action和三槽前后比较；旧原始背包/装备入口下线。P8F补固定单件必确认丢弃、恢复与装备Condition；可移除数量排除已装备实例，资源恢复按上限裁剪，Release解析和Replay共同复核玩家/物品/唯一Effect。出售仅显示资格不执行交易，页内回执不串功能或复现旧结果；15项新专属回归与真实桌面/移动Playwright通过；总进度77/121，业务功能67/111，下一项G4-09 |
| 1.1.76 | 2026-09-08 | 完成G4-07角色、成长、技能与状态UI：新增披露安全角色聚合投影和响应式只读角色页，以Release世界化显示名解释三属性、实际初始等级成长及六项派生来源；展示身份、等级经验、生命/技能资源、已学/锁定技能、公开解锁来源、规则/当前冷却和激活状态。隐藏任务来源、内部键、主角私密知识及NPC头像均不穿透；技能条件就绪不冒充正式Action可执行，被动不虚称生效；非1级、满级、0资源、旧战斗冷却及桌面/移动切页均有反例。同步把技能编译、成长属性、状态生命周期与冷却计数债挂入G4-09；总进度76/121，业务功能66/111，下一项G4-08 |
| 1.1.75 | 2026-09-08 | 完成G4-06玩家地图与旅行UI：披露安全聚合投影、完整SVG和移动等价列表统一呈现已知地点/道路、知识层级、路线风险与快旅点；选点只改UI，显式确认才进入正式Action/Event。修复全局SVG图标样式导致地图缩成16px及SVG节点无稳定命中面的真实浏览器问题；Session与外层事件基线冻结、stale重选、Promise回执精确归属、同Action异目标/基线拒绝和换档失效均有反例；新增10项专属回归并通过桌面/移动Playwright；总进度75/121，业务功能65/111，下一项G4-07 |
| 1.1.74 | 2026-09-08 | 完成G4-05完整任务日志：四类任务/历史及多维筛选、公开Stage/Objective、已知地点定位、奖励与已读事实、规范事件历史全部由权威Projection派生；日志不越权执行Scene动作。同步发布Action v16生命周期合同，闭合未开始/逐Stage放弃、原发布场景重接、限时放弃后过期、终态追踪和Director镜像；旧durable Context与v15兼容；总进度74/121，业务功能64/111，下一项G4-06 |
| 1.1.73 | 2026-09-08 | 完成G4-04 HUD与重要变化：权威Projection统一派生玩家、地点、时间天气和显式任务追踪；近期变化由同Session连续终态Event链有界重建，随机事件只表示已发生/已结算；初载/换档不重播历史，玩家回执与系统重要变化播报分流，暂态事件缺口不消费cursor；新增10项投影/UI回归；总进度73/121，业务功能63/111，下一项G4-05 |
| 1.1.72 | 2026-09-08 | G4-03最终运行竞态与旧包兼容收口：Action结果按完整请求代次与Session身份提交，切换后不串回执/错误/busy/刷新；Release与Preview场景统一标为冻结叙事；旧端点正文冲突时使用显式确定性兼容回退；Narrative v1/Action v14按稳定Action键收窄唯一交谈Actor；玩家入口24项、Action注册表13项，进度不变，下一项G4-04 |
| 1.1.71 | 2026-09-08 | G4-03兼容与恢复收口：新P9的actor-owned委托/收束落在owner常驻地点，历史v1 Context按旧Quest端点继续恢复，旧冻结包运行时归一；正式Release与显式Build Preview共享冻结场景消费规则；高风险确认强制使用整个运行状态事件基线，stale后刷新权威Projection；证据更新为G4场景/壳32项、玩家入口22项，进度不变，下一项G4-04 |
| 1.1.70 | 2026-09-07 | G4-03最终门控审计：Scene专属玩家Quest动作按Scene lifecycle精确收窄实例，补同定义active+revealed多轮任务与`observe + quest`兜底反例；通用use支持动作在Objective未激活时仍可由专用入口执行；高风险确认携带弹窗事件基线到执行器，拒绝跨标签页stale和旧DOM串Session；多敌战斗暂选首个存活目标；v15/v14场景均隐藏缺参数制作交易按钮；G4场景/壳31项、Action注册表12项、犯罪6项回归，进度不变，下一项G4-04 |
| 1.1.69 | 2026-09-07 | G4-03最终差异审查收口：Action注册表从冻结Actor对话场景和开战Effect恢复交谈/遭遇的唯一目标，避免同地点多NPC或多遭遇让正式Choice失效；场景投影把当前可用且从未归属任何P9场景的通用Action作为环境行动交给系统按钮，同时不把隐藏场景绑定Action泄露出来，正式生产中未写Scene的休息流程保持可玩；新增目标收窄、真实未绑定休息投影和正式Session执行回归，G4-03累计29项定向回归，进度不变，下一项G4-04 |
| 1.1.68 | 2026-09-07 | G4-03独立审查收口：修正P9把同场景多个Action条件并集误作整场景AND门槛的语义，Context v2只提升全Action交集，各Choice仍独立校验；Objective只绑定当地显式Actor需求，不再强制任务发布者在场；保留v1 Context旧语义的验签/恢复路径，并按Action交集、Actor场景引用与居所兼容归一无法从Narrative v2/Action v15版本号识别的旧P9包，同地或异地误注入owner均不吞场景；玩家投影删除内部purpose、知识边界与未发生结果文案，结算回执增加读屏live region；新增行动独立条件、旧包归一、零/多目标与战斗自由输入回归，总进度不变，下一项G4-04 |
| 1.1.67 | 2026-09-07 | 完成G4-03场景与三类输入：新增不持久化的P9场景投影，按当前地点、Condition、Quest实例/Stage/Objective及Actor在场存活门控任务委托、目标、收束、NPC对话和地点交互；NPC对白从统一关系投影选择差/一般/好三档，知识治理字段不穿透玩家视图；发布叙事、固定Choice、系统Action、受限自然输入和系统结算回执分层展示，三类可执行输入全部回到同一Action注册表并在正式Command/Event中保留source，高风险确认继续复核Session和事件基线；首版无模型时只精确匹配P9冻结例句，无匹配、多目标、无目标及战斗自由输入均不写状态，真正语义理解留给G6-03；Narrative v1/Action v14明确兼容降级；随机事件因当前合同只有发生历史、没有仍激活/失效证据而fail-closed并移交G4-04通知切面；新增场景投影、真实Store/IndexedDB交互和Playwright回归；总进度72/121，业务功能62/111，下一项G4-04 |
| 1.1.66 | 2026-09-07 | 完成G4-02响应式玩家壳：vNext和legacy统一进入同一纯展示壳，父入口只负责加载、Launcher和运行包分派；桌面固定左导航/中央主视图/右上下文三栏，窄屏把上下文变为可由Escape/遮罩/关闭键退出并恢复焦点的抽屉，移动端固定场景/地图/任务/角色/更多五项底栏；五页仅重排现有功能，Header、Release或Build Preview来源/运行包Hash、退出、战斗/全局Projection状态和返回场景入口不随页面切换；Session切换复位本地UI态并撤销旧确认，高风险确认和上下文抽屉均隔离背景、循环焦点且可由Escape退出；导航不写Event/Checkpoint/Projection；legacy继续保留tick、旅行、任务、Harness、分支和结局，缺失角色合同明确降级而不伪造；新增13项组件/集成回归及真实Playwright 1440/390双视口几何、确认层、抽屉与溢出验收；总进度71/121，业务功能61/111，下一项G4-03 |
| 1.1.65 | 2026-09-07 | 完成G4-01玩家入口：新增文字开放世界专属游戏库与Release详情，按稳定`productionKey`而非标题归并作品，组内以不可变版本号优先且可显式选择旧版；正式存档继续固定各自Release，Build Preview仅接受制作端显式handoff并标为非正式，不混入正式目录；Release卡展示公开主角、规模、来源/运行包/发布Hash，损坏Release保留诊断且禁止开档；普通进入不再自动打开最近存档，加载/选档失败清空旧投影并提供重试；删除经过确认和scope/世界分组owner校验，来源损坏时仍可级联清理Session私域而不删Release；三种文字游戏预览handoff按产品类型隔离；总进度70/121，业务功能60/111，下一项G4-02 |
| 1.1.64 | 2026-09-07 | G3-18独立审查收口但不虚增进度：P1按批保存精确来源Manifest并只采纳最新成功尝试；P8F/P9/V1/V2闭合结局Action、场景Choice和三类输入，Narrative v2与Action v15保留全部可玩正文；P10将完整槽清单与本次排产分离，未排产项明确`fallback-only`且音频0/4/9计数与Plan一致；V3核验物理Blob、Capability、任务/Provider回执及权利策略，IntegrationReport分层验Hash；QA不再无条件通过`rights.complete`，商业真实资产覆盖不足只到preview-ready；vNext-only、Hybrid、Legacy和Release→Session链回归通过；总进度仍为69/121，下一项G4-01 |
| 1.1.63 | 2026-09-07 | 完成G3-18并关闭G3阶段：共享durable scheduler和正式生产service现按文字开放世界产品选择专属26任务Plan与统一Executor，P0从作者授权Brief动态展开精确SourcePinUnit并以后写索引闭合；P1断点后的恢复实证不会重复计费调用，整条P0～P10、V1、V2、V3、QA链可完成；V3确定性验签并装配15个G2运行模块、兼容叙事壳、真实生成媒资与全部降级槽，形成带`textOpenWorldVNext`和可冻结媒资资产的ProductRuntimePackage；Build Preview已真实解析三件媒资并创建只含统一`textOpenWorld`投影的Session，旧混合包继续只读兼容；同时修复基础攻击键、表现模块版本、调度耗时整数及专属计划旧通用转码能力残留；真人时长证据仍留给发布门；总进度69/121，业务功能59/111，下一项G4-01 |
| 1.1.62 | 2026-09-07 | 完成G3-17系统收口、质量门与局部修复：补齐此前缺失的P2 PresentationProfile正式Skill/Context/Executor，代码冻结三类输入、四类战斗操作、18个UI消费槽和可降级表现策略；P10完整验签17件上游，生成15个运行模块配置、必需程序地图/NPC头像/地区背景媒资需求及全量占位降级，并把作者生产的内容库存时长与玩家单次可达时长分开计算；V1在任何模型评审前确定性检查Schema、Hash链、引用、主线首任务可解、预算与消费槽；V2平衡和语义评审分别检查6项与8项指标，低于70阻断、70～84形成明确问题，代码把每项问题绑定唯一新Build修复任务并计算传递stale闭包，已验收Artifact不可原地改写；真人时长校准仍作为后续发布门；总进度68/121，业务功能58/111，下一项G3-18 |
| 1.1.61 | 2026-09-07 | 完成G3-16 SceneScript/ChoiceContract/三类交互绑定：P9先在代码侧读取并验签10件已验收上游，再向模型交付任务、角色、地图、Director和Action的去重确定性投影，原子Context在实际112000 token任务预算内完整交付；覆盖全部任务委托/Objective/收束、NPC三档态度对话、地点交互、随机事件表现、传闻及每个地区任务模板3份文字变体；固定Choice精确继承Action Hash、可用Condition和确认策略，系统按钮/固定选项/自然语言候选共同进入P8F Action结果权威；战斗自然语言关闭，低置信度不执行，高风险二次确认，模型不能创建Action/Quest/地图或写状态；漏场景、自然语言歧义、知识/传闻缺口、越权字段及重算Hash篡改失败关闭；总进度67/121，业务功能57/111，下一项G3-17 |
| 1.1.60 | 2026-09-07 | 完成G3-15 QuestFinalize/EncounterFinalize：正式Skill和原子Context一次读取11件已验收Artifact，全链校验行Hash、内容Hash、产品实例与跨目录来源；模型只写任务/Objective描述、发牌类别/强度/权重和随机事件语义，代码确定性生成Quest、Stage、Objective、Condition、Effect、Action、奖励领取、战斗开始/结算、技能/道具、制作/商店、NPC交互、地图/旅行/快旅/复活及Director结算全部运行定义和双向引用；主线/重要故事保持等待与不可永久失败，普通任务支持放弃重接和限时过期；地区Director冻结固定任务、模板、随机事件、冷却、并发上限、高强度连续限制与空白牌，保护故事不进入发牌压力；同时修复生产调度器未向Context Gateway传递实际任务输入预算的旧上限，为不可切分JSON来源增加atomic失败关闭；在150次推荐总调用不变下，P8F调整为11次、表现轮廓调整为1次；总进度66/121，业务功能56/111，下一项G3-16 |
| 1.1.59 | 2026-09-07 | 完成G3-14 Map Interaction Catalog Lane及整个后半目录包：Context只读取已验收完整地图、地区生态、任务消费者和地点交互需求；模型只写交互语义并从候选类型/地点中选择，代码保持Region/Location/Edge/FastTravel完整拓扑，生成稳定Interaction键、每地点至少一个可点击入口和1000×700确定性SVG节点布局，固定完整地图Build、知识逐步揭示、普通/快速旅行推进时间、首版不中断且无旅行资源消耗、快旅到访解锁及复活点覆盖；提前到达只能看到地点常态，主线/重要故事不得由抵达自动启动；全部Action/Condition/Effect/Scene/Quest绑定保持unbound；漏项、越界、重复语义、断图、改写道路/坐标/快旅/到达触发及注入运行Action均失败关闭；总进度65/121，业务功能55/111，下一项G3-15 |
| 1.1.58 | 2026-09-07 | G3-14完成NPC Runtime Catalog Lane并将其显式接到Crafting/Economy之后：Context投影已验收Quest消费者和商店Actor预留，同时完整读取地区角色/势力需求；模型只写势力目标、道德方向、角色姓名/小传/演绎、普通日常和三档招呼语气，人物身份信息保持一个整体文本资产；代码固定Faction/Actor/Service/Schedule稳定键、主线/重要角色Agent维护与protected、普通角色rule-driven/mortal、四时段日程、道德/阵营加权三档态度、商店与普通功能服务替代者，替代者只继承功能不继承独特故事；全部角色/势力/商店预留、地区居民、关键保护和死亡替代精确闭合，对话/Action/Scene仍未绑定；漏项、同名、越界阵营、错误日程、越权保护字段及重算Hash篡改失败关闭；下一Lane为Map Interaction |
| 1.1.57 | 2026-09-07 | 启动G3-14并完成Crafting/Economy Catalog Lane：修正P8任务闭包，三个后半目录均读取QuestSkeleton以保留消费者语境；配方经济Context只读取同Build已验收玩法、地区、任务、需求和物品奖励目录，逐项兑现recipe/vendor需求并为每区提供基础配方与商店；模型只写地区化语义并从有来源非关键物品及合法地点中选取，代码固定稳定键、配方学习、制作数量/时长、单货币整数基点价格、普通无限/装备限量库存、商店Actor预留、物品来源/消耗投影和反套利；关键物品禁售、同物转换、类别错配、漏项/越界及重算Hash改价格/库存/数量/Action失败关闭；G3-14继续进行，下一Lane为NPC Runtime |
| 1.1.56 | 2026-09-07 | 完成G3-13全部Gameplay Catalog前半段：Item/Reward Lane从PlayerBuild、QuestSkeleton、Manifest、Progression和Encounter生成9个物品、28个任务/战斗奖励及5个敌人掉落表；主角初始物品键和装备位不可改写，关键物品不可丢弃出售，所有item/equipment/material/reward需求均精确兑现，每个物品有初始/任务奖励/地区掉落来源，每个任务与遭遇都有奖励，每个敌人有掉落；代码按主线时长精确分配1600经验达到5级并确定货币、装备加成、地区材料与掉落数量，模型只写语义和可选物品；全部Action/Effect/Condition/Quest运行绑定保持unbound，漏项、非法装备位、同名奖励、来源/预算不闭合及重算Hash篡改失败关闭；总进度64/121，业务功能54/111，下一项G3-14 |
| 1.1.55 | 2026-09-07 | G3-13完成Enemy/Encounter Catalog Lane，并修正三个玩法目录的输入闭包：Progression、Encounter、Item/Reward正式读取已验收QuestSkeleton，避免仅凭Manifest消费者键猜测任务类型、地区、地点与时长；遭遇Lane逐项兑现enemy/encounter需求并为每区生成基础遭遇，模型只设计敌人/遭遇语义、原型、地点候选序号和表现文本，代码固定验收1～5级数值、基础攻击策略、敌群、标准难度、可逃跑/重试复活、战斗Objective及地区覆盖，并为每个敌人/遭遇预留掉落和奖励；越界地点、漏需求、同质标题及重算Hash改数值/保护策略失败关闭；G3-13下一Lane为Item/Reward |
| 1.1.54 | 2026-09-07 | 启动G3-13并完成Progression/Skill Catalog Lane：新增只读已验收GameplayRuleset/PlayerBuild/QuestSkeleton/ContentRequirementManifest的Context、专属Skill与Executor；代码从主角两项技能预留、六个长期等级解锁点和全部skill需求形成精确Demand，固定20级平方经验曲线、按主副属性自动成长、稳定Skill/Status键、获得来源和主动攻击公式覆盖；模型只补语义与有界参数，所有Action/Effect/Condition/Quest绑定保持unbound，漏需求、改写初始技能、非法被动、公式缺失和重算Hash篡改失败关闭；G3-13保持进行中，下一Lane为Enemy/Encounter |
| 1.1.53 | 2026-09-07 | 完成G3-12 QuestSkeleton与ContentRequirementManifest：新增只读已验收Brief/体验/玩法/主线/重要故事/地区生态的Context、专属Skill与Executor；把7主线Stage、6重要故事Stage、6普通任务种子和4地区模板精确编译为23个任务骨架与可执行Objective，代码固定保护任务等待、普通/模板生命周期、非到达触发和全部运行绑定unbound；统一需求清单覆盖任务目标及地区角色/势力/地点交互，声明六类目录与QuestFinalize owner并保持目录unbound，同名冲突、来源遗漏、弱化保护、无敌人战斗和越权绑定失败关闭；总进度63/121，业务功能53/111，下一项G3-13 |
| 1.1.52 | 2026-09-07 | 完成G3-11 RegionNarrativePacks：新增只读已验收Brief/体验/来源/地图/主线/重要故事的Context、专属Skill与Executor；AI为每区建立差异化身份、矛盾/状态轴、全地点生活计划、重要Agent与普通规则NPC分层、势力需求，以及按Brief保底的6普通任务/4模板/12随机事件种子和传闻；代码固定全地区地点覆盖、重要owner唯一承接、稳定预留键、普通世界演化与主线/重要故事等待隔离、全部目录绑定unbound，漏覆盖/同质/供给不足/重算Hash篡改失败关闭；总进度62/121，业务功能52/111，下一项G3-12 |
| 1.1.51 | 2026-09-07 | 完成G3-10 SignificantThreads：新增只读已验收来源/故事/结局/承诺/地图/主线的Context、专属Skill与Executor；AI按Brief精确设计至少两种owner的重要故事线、每线多方冲突系统、3～6个可玩Stage、地区氛围和局部后果，代码固定稳定键、owner预留/地区绑定、主线揭示窗口、安全等待、不可放弃过期/永久失败/普通状态阻断、非地点触发及主线核心目标/可达性/结局不可改写；全部任务/场景/角色/势力/Condition/Effect绑定保持unbound并可重建复验；总进度61/121，业务功能51/111，下一项G3-11 |
| 1.1.50 | 2026-09-07 | 完成G3-09 MainlineThread：新增只读已验收故事/结局/承诺/地图/玩法/主角的Context、专属Skill与Executor；AI在Brief规模内编排Stage语义、空间落点、核心体验、保护与恢复需求，代码固定严格前后链、起点、StoryBeat全覆盖、Promise落点、多结局终段分流、90～120分钟时长和1→5级节奏，以及等待/不可放弃过期/不可永久失败/非地点触发/普通状态不阻断治理；Quest/Scene/Action/Condition/Reward保持unbound，逆序、未知地点、上游或重算Hash篡改失败关闭；总进度60/121，业务功能50/111，下一项G3-10 |
| 1.1.49 | 2026-09-07 | 完成G3-08 RegionSkeleton：新增只读已验收Brief/P1/体验/StoryArc的Context Source、专属Skill与Executor；AI把来源地点事实和所有故事空间需求编排为精确规模的地区、地点及道路语义，代码生成稳定键、全地点/全地区连通图、每区快旅复活点、渐进知识、固定旅行耗时和提前到达保护；下游主线、场景、任务、NPC、遭遇、商店与媒资保持unbound，伪造来源、空间需求漏覆盖、断图和重算Hash篡改失败关闭；总进度59/121，业务功能49/111，下一项G3-09 |
| 1.1.48 | 2026-09-07 | 完成G3-07 StoryArchitecture：新增只读已验收体验/主角/P1证据的Context Source、专属Skill与Executor；AI设计核心冲突、5～8个长程节拍、与Brief数量一致的多结局语义及4～12项叙事承诺，代码固定主线保护、阶段顺序、稳定键、来源/缺口权限、全结局核心目标达成和建立—回响—回收闭环；结局Condition与承诺Scene显式保持unbound等待后序绑定，新增完整生产链、错误顺序、伪造来源及重算Hash篡改反例；总进度58/121，业务功能48/111，下一项G3-08 |
| 1.1.47 | 2026-09-07 | 完成G3-06 PlayerBuild：新增只读已验收P2产物的Context Source、正式Skill与Executor；AI只补主角身份演绎、非职业玩法风格、主副属性选择和初始技能/物品语义，代码固定1级、12点属性预算、100货币、技能机制、物品数量及稳定预留键；产物在后续目录兑现前保持`reserved-unbound`并禁止冒充可运行PlayerDefinition；新增完整生产链、注册闭包、篡改和非法属性反例；总进度57/121，业务功能47/111，下一项G3-07 |
| 1.1.46 | 2026-09-07 | 完成G3-05 GameplayRulesetSkeleton：新增登记的P2规则Context、Skill与Executor，输入只来自同一Build已验收体验链和Ledger claim；模型只负责世界化显示语义，代码冻结三属性/20级/1→5验收跨度/自动成长、G2公式、标准难度四操作单人回合战斗、三装备位、单货币、确定性制作交易及当前模块版本；Effect词表改为与G2共享单一常量，并分离模型可提议、编译器专属和旧版只读操作，伪造claim、固定值、权限分区、上下文或Hash全部失败关闭；总进度56/121，业务功能46/111，下一项G3-06 |
| 1.1.45 | 2026-09-06 | 完成G3-04体验设计编译：新增登记的P2 Context Source、专属Skill与Executor，将作者已授权Product Brief、SourcePin及P1 Manifest/Ledger/Gap Report收口为一个全体字段Hash保护的输入；GameBrief由代码冻结主角模式、规模、主线/重要故事等待、有边界自由、三种输入、回合战斗、世界演化、媒资、成本和直接发布门，模型仅生成体验语义与主角叙事候选；来源型主角必须引用绑定所选角色来源单元的P1 claim，伪造claim、上下文、缺口、作者意图或固定边界失败关闭；三件Artifact绑定Brief、Pin、Ledger、context selection与各自basis hash；P1单批Gateway额度同步收口到WorldRelease 10万token读取上限；不新增表、不写世界引擎或Session，完整DAG仍未激活；总进度55/121，业务功能45/111，下一项G3-05 |
| 1.1.44 | 2026-09-06 | 完成G3-03来源整理证据链：新增登记Context Source与专属Skill/Executor，小说按产品私有冻结单元分批完整交付，WorldRelease通过Context Gateway按冻结资源坐标读取；SourceManifest逐单元记录实读/未读和交付Hash，SourceLedger强制每项模型事实绑定已读单元、逐字引文、UTF-16偏移和内容Hash，SourceGapReport由代码根据实读集与覆盖标签生成显式未读和关键内容缺口；三件Artifact与P0 SourcePin形成可复验Hash链，伪造引文、偏移、未读引用、来源漂移和非法缺口策略失败关闭；不写世界引擎、不增加业务表，仍保持专属DAG未整体激活；总进度54/121，业务功能44/111，下一项G3-04 |
| 1.1.43 | 2026-09-06 | 完成G3-02双来源SourcePin：WorldRelease以便携WorldReference、资源坐标及真实index读取证据锁定，小说从受控Work/大纲/规范章序完整复制并自动切成不超过20万字符的产品私有单元；40种Artifact Kind新增SourcePinUnit，P0索引+单元由唯一owner生产；版本、来源边界、Brief/开始授权、nonce Hash、rights、实际读取与Pin形成五段Hash链，原始nonce和可变小说行ID不落Artifact；相同Pin幂等，同Build静默换源、跨项目、越界、未明确rights及篡改均失败关闭；复用productBuildArtifacts完整生命周期，不增加表或AI旁路；总进度53/121，业务功能43/111，下一项G3-03 |
| 1.1.42 | 2026-09-06 | 完成G3-01产品生产合同：新增39种文字开放世界专属Build Artifact Kind及唯一owner定义；以26个任务冻结P0～P10、确定性预检、独立平衡/语义评审、G2包唯一装配与发布QA DAG，22个模型型durable Run分别覆盖来源、体验、Ruleset、表现、故事、地区、主角、任务、六类玩法目录和评审；完整Build按Brief有界分配调用，推荐上限150次、最低骨架22次，区域型Run可在单一预算内分批生产；P8目录并行且任务只在目录完成后最终化；每项Run显式声明上下文、候选写入、重试/非重试错误、超时、stale传播、验收门和终态回执；视觉/音频能力按Brief动态接在P10之后；专属Plan复用共享ProductProductionPlan/AgentRun/Artifact Store且在Skill和Executor齐备前不替换线上旧入口；总进度52/121，业务功能42/111，下一项G3-02 |
| 1.1.41 | 2026-09-06 | 完成G2-28地区导演闭环并关闭G2阶段：Director v2与Action v14冻结地区演化、触发牌组、任务密度、Blank/权重、等级/条件、来源冷却、结构指纹与强度限制；Session持有地区压力/游标、抽牌和来源历史、动态任务实例及玩家知识历程；玩家Action之后由唯一系统Action把地区演化、固定/模板任务、随机事件/任务升级、传闻与成就通过正式随机证据和原子Effect事件提交，资源事件只可并入安全预制Effect；主线等待玩家，不参与地区自动演化；旧Director v1可读，重试、刷新、重放、防篡改、中断恢复和受控运行上下文已覆盖；49个开放世界回归文件213项测试通过；总进度51/121，业务功能41/111，下一项G3-01 |
| 1.1.40 | 2026-09-06 | 完成G2-27确定性经济：Economy v2与Action v13冻结单货币、商人营业条件、交易类别、整数基点价格和无限/有限库存；价格复用三档关系投影并在构建期阻断无风险套利；专用TransactionAuthorization把货币、物品和Session有限库存作为单一原子事务结算，装备中物品不可出售，售回物进入商人有限库存；真实命令、Event、刷新与重放复核商人、物品、数量、价格和状态并拒绝篡改；Economy v1保持只读原义；48个开放世界回归文件207项测试通过；总进度50/121，业务功能40/111 |
| 1.1.39 | 2026-09-06 | 完成G2-26确定性制作：Crafting v2与Action v12把配方学习、地点/条件、材料与产物、单份耗时、100%成功、批量和事件单位上限冻结进Release；每个配方由唯一玩家craft Action和perform-crafting Effect执行，非默认配方必须有learn-recipe入口；Build拒绝关键/实例型材料、输入输出重叠、重复物品、单份产物及事件预算越界；玩家命令显式提交数量，CraftingAuthorization冻结材料/产物前后值与世界时间，在同一个EffectPlan中原子扣料、产出和推进时间，claim、命令幂等与完整Event重放阻止重复制作和授权篡改；旧Crafting v1保持只读原义；47个开放世界回归文件203项测试通过；总进度49/121，业务功能39/111 |
| 1.1.38 | 2026-09-06 | 完成G2-25确定性战斗结算：Combat v3与Action v11冻结`bounded-physical-v1`整数伤害算法、逐主动攻击技能倍率、伤害边界、万分制暴击上限和倍率，玩家派生值及敌人Release数值统一进入结算；每个目标的随机请求、seed抽样证据、攻防、公式参数、暴击与生命前后值随授权进入同一EffectPlan/Event，状态Effect与伤害原子提交；代码根据生命与敌人存活状态自动进入胜利或战败，终态清理冻结的临时战斗状态；胜利后由独立系统Action按遭遇RewardContract只结算一次，失败与逃跑不领奖；旧Action v10/Combat v2保持原语义可读可重放；46个开放世界回归文件199项测试通过；总进度48/121，业务功能38/111 |
| 1.1.37 | 2026-09-06 | 完成G2-24正式战斗行动闭环：Action v10把普攻、战斗技能、战斗道具、逃跑及敌方技能编译为双向校验的静态Action/`perform-combat-action` Effect表行；Session增加回合冷却和最后行动投影，玩家可用性统一校验已学技能、资源、条件、冷却、存活敌人目标和背包消耗品；玩家行动以`CombatActionAuthorization`通过共享ProductRuntime命令/Effect事件原子提交，之后敌人按Release冻结策略自动选招并结算回玩家下一回合，逃跑直接进入`escaped`终态；回放复核命令、Action、目标、Effect闭集及行动前状态，清空Head后结果一致；Action v9保持兼容；45个开放世界回归文件194项测试通过；总进度47/121，业务功能37/111 |
| 1.1.36 | 2026-09-06 | 完成G2-23正式战斗阶段机：Combat v2 Session保存稳定战斗/敌人实例、冻结先攻顺序、轮次、当前行动者和阶段；Action v9与Combat v2配对，以唯一系统`combat-state-action`、`settle-combat-state` Effect和状态快照授权，在共享ProductRuntime命令/Effect事件流内自动推进开战阶段并显式迁移行动完成、下一行动者、下一回合和胜利/战败/逃跑终态；Build、运行与Replay共同拒绝跨阶段、顺序漂移、禁逃、伪造授权及普通Action借用系统Effect；战前重试点、失败复活继续复用既有正式生命周期，旧Combat v1/Action v8投影保持可读可重放；44个开放世界回归文件188项测试通过；总进度46/121，业务功能36/111 |
| 1.1.35 | 2026-09-06 | 完成G2-22敌人与遭遇定义：Combat v2冻结唯一`standard`难度和1倍倍率、敌人等级/数值/主动技能策略/掉落/来源、遭遇有序敌人组/等级带/强度/地点与任务引用/逃跑/重试或复活/奖励和表现文本；Build拒绝不可执行策略、敌人数越界、奖励与掉落错配、逃跑或失败策略漂移及无入口遭遇；每个遭遇由唯一`start-combat` Action进入，战前只读目录可投影相对强度而不启动战斗；旧Combat v1确定性规范化且不猜测奖励所有权；43个开放世界回归文件182项测试通过；总进度45/121，业务功能35/111 |
| 1.1.34 | 2026-09-06 | 完成G2-21局部犯罪闭环：Action v8与Relationship v3冻结偷窃/欺骗/犯罪定义、固定目标地点、确定性成功条件、成败及目击分支；高风险确认后用犯罪授权把Outcome、原因和受限Effect原子写入ProductRuntime事件，失败也保留正式后果；Build及Replay拒绝刷道德、越界效果、普通Action借用、伪造目击和分支漂移，数值边界安全截断；旧Release成对降级兼容；42个开放世界回归文件174项测试通过；总进度44/121，业务功能34/111 |
| 1.1.33 | 2026-09-06 | 完成G2-20关系确定性投影：Relationship v2冻结阵营/无阵营道德解释和差/一般/好三档表现，Session只保存道德、完整阵营亲合度与已发生的预制故事修正；Actor、Condition、玩家关系页和AI上下文共用态度、原因、问候、互动策略与价格倍率；拒绝独立NPC亲密度、缺失阵营状态和未预制修正，Build保证关系条件不阻断主线；旧Relationship v1兼容；40个vNext套件171项回归通过；总进度43/121，业务功能33/111 |
| 1.1.32 | 2026-09-06 | 完成G2-19角色生命周期治理：Actor v3冻结四级死亡策略及逐服务连续性表，Action v7区分需确认的玩家攻击与正式系统剧情/事件结果；确定性代码拒绝关键角色死亡、story-only越权死亡、临时角色错误退场和死者复活；死者退出对话/日程/服务投影，通用服务按Build预制关系由备用角色接管，独特服务可永久消失，缺失替代、反向归属漂移、重复替代和替代链均在Build失败；旧Actor v1/v2和Action v1～v6保持兼容；38个vNext套件165项回归通过；总进度42/121，业务功能32/111 |
| 1.1.31 | 2026-09-06 | 完成G2-18角色运行闭环：Actor v2保留人物小传的叙事整体，只结构化四级运行成本、简单全时段日程及逐时段服务开闭；Action v6以可回放系统命令在天气之后、任务之前结算角色地点与活动，Session时间段游标保证同段剧情移动不被覆盖、跨段恢复冻结日程和中断补偿；商店目标由角色在场、地点、日程与vendor反向绑定共同决定；玩家UI和AI上下文复用同一披露安全角色投影，重要角色读取演绎准则，普通角色不加载小传或完整未来日程；旧Actor v1和旧InitialState保持兼容；37个vNext套件161项回归通过；总进度41/121，业务功能31/111 |
| 1.1.30 | 2026-09-06 | 完成G2-17统一时间天气闭环：TimeWeather v2冻结昼夜段、天气周期和每地区有界整数权重，Action v5用唯一系统天气Action/Effect结算，并要求所有普通Action声明耗时与成功`advance-time` Effect一致；跨周期后按Session seed生成地区级Random Event，天气授权与Effect Event冻结并重放复核世界分钟、周期、请求、抽取和变化；Session周期游标保证中断后补偿、同周期幂等及检查点分支不重抽；玩家HUD和AI玩家上下文复用同一第几天/时段/天气投影且不暴露内部分钟；旧TimeWeather v1及Action v1～v4保持只读兼容；35个vNext套件155项回归通过；总进度40/121，业务功能30/111 |
| 1.1.29 | 2026-09-06 | 完成G2-16快速旅行：Action v4冻结唯一动态快旅规则，Session只向已到访且已解锁、当前仍有开放路径的地点签发命令级授权，并冻结路线、基线时间和按普通路程比例计算的耗时；默认/奖励解锁都受“必须到访”状态不变量约束；单个跨地图与时间Effect原子结算且不产生行程中间态，事件重放复核完整授权，因此途中事件无法插入；玩家地图、等价列表、专用快旅列表和AI上下文共用同一Action投影；旧Action v1～v3保持只读兼容；33个vNext套件149项回归通过；总进度39/121，业务功能29/111 |
| 1.1.28 | 2026-09-06 | 完成G2-15普通旅行：Action v3按每条道路方向冻结旅行表行，严格绑定开始行程、冻结耗时和到达三段Effect；构建期/运行时双重拒绝非相邻目标、关闭道路、单向反走、耗时漂移及非旅行Action夹带；正式事件原子更新地点认知和世界分钟但不触发Scene/Quest；SVG节点、道路列表和AI上下文共用可执行路线，旧Action v1/v2保持只读兼容；同时补齐所有普通EffectPlan与命令成功/失败分支的重放绑定；31个vNext套件142项回归通过；总进度38/121，业务功能28/111 |
| 1.1.27 | 2026-09-06 | 完成G2-14披露安全地图：World v3逐地点认知、Presentation v2冻结/确定性回退布局、揭示与到访分层Effect，以及SVG与等价列表共用的玩家地图投影；未知地点和定义完全不进入UI/AI上下文，听说只显示名称；旧World v2 Release保留原始初态Hash并在开局迁移；30个vNext套件137项回归覆盖布局伪造、剧透与UI降级；总进度37/121，业务功能27/111 |
| 1.1.26 | 2026-09-06 | 完成G2-13地图定义与拓扑：World模块v2要求地区、地点和道路记录故事/玩法存在理由、冻结来源、提前到达表现、等级带、认知策略、风险及每区快旅归属；发布校验拒绝不可达地点、错误单行方向、悬空道路条件、跨区快旅和无来源/无用途地点；新增相邻连接、确定性最短时间路线和跨模块地点内容候选索引，路线规划绝不触发场景或任务；旧World v1规范化兼容；玩家页与AI玩家上下文读取同一地图投影；29个vNext套件132项回归通过；总进度36/121，业务功能26/111 |
| 1.1.25 | 2026-09-06 | 完成G2-12任务日志运行闭环：一个主追踪与最多3个钉选统一走玩家Action、实例授权、Effect Event和Replay；取消追踪不等于放弃；主线开局自动追踪；限时任务在揭示时登记绝对期限，由覆盖未开始及各Stage的系统Action自动过期；提供当前期限投影和从规范事件派生、可按实例查询的历史；HUD/任务卡/AI上下文使用同一状态；旧投影补齐追踪字段，Action v1旧Release保留原始初态Hash并在开局迁移；总进度35/121，业务功能25/111 |
| 1.1.24 | 2026-09-06 | 完成G2-11任务进度闭环：Quest模块升级v2并双向约束Objective完成Action、Stage系统迁移Action、任务RewardContract和领取Action；Objective完成、Stage推进/任务终结、奖励领取使用三类实例授权与独立Command/Effect Event，成功玩家行动后由确定性结算器按稳定顺序推进已满足Stage；必需目标、相邻Stage、多实例隔离、任务奖励归属和一次领取均在发布与重放时复验；旧Quest v1规范化兼容；任务卡展示当前阶段、目标、实例专属按钮和领奖状态；27个vNext套件122项回归、三项工程检查、TypeScript和build通过；总进度34/121，业务功能24/111 |
| 1.1.23 | 2026-09-06 | 完成G2-10任务生命周期治理：Release区分生成可用/玩家可见/接取/进行/暂停/五类终态；状态机冻结12种迁移意图、玩家与系统权限、主线/重要故事保护、普通任务失败/确认放弃/重接和实例期限；QuestTransition授权与命令实例目标进入EffectPlan、Event和Replay，阻断定义串线、伪造授权与普通Action夹带；UI提供中文状态、截止信息和二次确认，AI上下文不泄露未揭示任务；兼容旧vNext终态投影；28个文件117项专项回归、架构/表/AI手册/TypeScript/build通过；总进度33/121，业务功能23/111 |
| 1.1.22 | 2026-09-06 | 完成G2-09 Quest定义/实例边界：Release冻结四类任务的归属、地区、时间/生命周期、实例化与时长字段；Session为正式任务建立稳定单例，为Director模板提供多实例构造；任务实例保存来源Hash、阶段/目标快照和时间/奖励/结果引用；Action、UI与AI上下文切换为实例ID并阻断模板定义冒充实例；总进度32/121，业务功能22/111 |
| 1.1.21 | 2026-09-06 | 完成G2-08统一奖励与掉落：RewardContract预算/来源/Condition，版本化权重掉落和数量Effect映射，seed随机证据、唯一来源claim、跨域原子奖励、Reward授权重放及无授权掉落阻断；真实命令事件链和幂等重试通过；总进度31/121，业务功能21/111 |
| 1.1.20 | 2026-09-06 | 完成G2-07三装备位事务：Release装备Action/条件合同、Session具体实例占槽、同槽替换、未装备实例移除、唯一派生值回算、资源上限裁剪和真实事件重放；新增三槽候选及属性比较UI；总进度30/121，业务功能20/111 |
| 1.1.19 | 2026-09-06 | 完成G2-06受治理物品与库存账本：Release严格物品策略、堆叠/实例分账、稳定实例ID与正式claim来源、使用/丢弃/出售Action目标绑定、关键/唯一/数量/分区保护，以及恢复品资源条件；玩家UI和AI上下文改读统一库存投影；总进度29/121，业务功能19/111 |
| 1.1.18 | 2026-09-06 | 完成G2-05生命与恢复闭环：休息原子恢复并推进时间、生命0/战败不变量、普通行动封锁、已解锁复活点无额外代价恢复、战前自动检查点和保留父失败史的子分支重试；UI与AI上下文说明恢复差异，检查点用途随备份恢复；总进度28/121，业务功能18/111 |
| 1.1.17 | 2026-09-06 | 完成G2-04技能与状态治理：冻结主动/被动定义及初始/等级/任务来源，双向校验等级曲线和任务学习奖励，统一学习/资源/冷却/Condition可用性投影，状态与重复变更失败关闭，贯通玩家UI和AI上下文；战斗实际消耗/冷却明确留给G2-23/24统一事件流；总进度27/121，业务功能17/111 |
| 1.1.16 | 2026-09-06 | 完成G2-03连续20级成长曲线、跨级经验结算、自动属性/资源同步、满级封顶、漂移校验和共享等级进度投影，盐脊1→5级及重复claim反例通过；总进度26/121，业务功能16/111 |
| 1.1.15 | 2026-09-06 | 完成G2-02三语义属性和唯一派生值服务，统一初始Session、Condition、角色UI与AI上下文，提供数值来源明细及NaN/负值/暴击封顶/溢出/非法属性反例；总进度25/121，业务功能15/111 |
| 1.1.14 | 2026-09-06 | 完成G2-01统一主角定义编译器：四类来源冻结、WorldRelease资源证据/漂移隔离、身份与Build分层、非法初始构筑阻断、Release/Session/UI/AI上下文贯通；总进度24/121，业务功能14/111 |
| 1.1.13 | 2026-09-06 | 完成G1-13无AI纵切面协调器和真实vNext玩家入口，贯通ProductRelease、启动、Action、Feedback、保存、刷新重放与分支；G1 13/13全部完成，15个vNext回归文件共61项测试通过；总进度23/121，业务功能13/111 |
| 1.1.12 | 2026-09-06 | 完成G1-12 vNext玩家可见Context、隐藏信息隔离、AI/确定性写入分治、Canon与命令事件便携化、跨项目备份恢复/幂等重试及Session级联删除；总进度22/121，业务功能12/111 |
| 1.1.11 | 2026-09-06 | 完成G1-11统一Feedback Receipt、终态outcome/reason/degradation事件证据、pending成功隔离和逐命令TOCTOU来源复核；总进度21/121，业务功能11/111 |
| 1.1.10 | 2026-09-06 | 完成G1-10 vNext运行包接入主干ProductBuild/ProductRelease、确定性InitialState、正式Session及逐命令来源绑定；旧存档/子分支固定原ProductRelease；总进度20/121，业务功能10/111 |
| 1.1.9 | 2026-09-06 | 完成G1-09 vNext检查点、Hash/协议/重放诊断、runtime head修复和历史检查点子分支重基线；总进度19/121，业务功能9/111 |
| 1.1.8 | 2026-09-06 | 完成G1-08 vNext Session Projection、确定性初态、11域状态不变量、事件重建及Condition/Action权威上下文；总进度18/121，业务功能8/111 |
| 1.1.7 | 2026-09-06 | 完成G1-07命令/随机/Effect事件分类、顺序协议、规则版本、seed随机证据、结果批次指纹、原子追加与重放；总进度17/121，业务功能7/111 |
| 1.1.6 | 2026-09-06 | 完成G1-06类型化Effect DSL、静态引用、EffectPlan预演Hash、原子应用、跨域影响、幂等claim、保护对象和回执；总进度16/121，业务功能6/111 |
| 1.1.5 | 2026-09-06 | 完成G1-05九域类型化Condition DSL、静态引用、复杂度上限、fail-closed评估和Action接入；总进度15/121，业务功能5/111 |
| 1.1.4 | 2026-09-06 | 完成G1-04统一Action目录、跨模块消费者反查、可用性/合法目标/确认投影与三种输入解析；总进度14/121，业务功能4/111 |
| 1.1.3 | 2026-09-06 | 完成G1-03统一CommandEnvelope、事件幂等边界、重试复用与未知结果查询；总进度13/121，业务功能3/111 |
| 1.1.2 | 2026-09-06 | 完成G1-02的15个领域Module Schema、完整验收夹具、双向引用与跨模块反例验证；总进度12/121，业务功能2/111 |
| 1.1.1 | 2026-09-06 | 完成G1-01 TextOpenWorldRuntimePackage vNext包络和严格解析；总进度11/121，业务功能1/111 |
| 1.1.0 | 2026-09-06 | G0全部完成并通过27个相关回归测试及工程检查；用户明确启动完整产品开发，进入G1-01，总进度10/121 |
| 1.0.4 | 2026-09-06 | 完成G0-09全部G1/G2开工卡和风险台账；总进度更新为9/121 |
| 1.0.3 | 2026-09-06 | 完成G0-08“盐脊”纵向验收Brief；总进度更新为8/121 |
| 1.0.2 | 2026-09-06 | 完成G0-07首批校准配置；总进度更新为7/121，明确G1～G7业务功能分母为111 |
| 1.0.1 | 2026-09-06 | 完成G0-04代码关联闭包审计、G0-05新主干世界来源出口复用核验和G0-06现有能力处置矩阵；总进度更新为6/121 |
| 1.0.0 | 2026-09-06 | 按G0～G7拆分121个首版工作包和12个后续能力；建立状态、依赖、完成判据、进度口径与首批施工顺序 |
