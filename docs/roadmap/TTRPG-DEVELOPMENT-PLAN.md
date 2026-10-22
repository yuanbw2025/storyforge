# 跑团开发与施工方案

> 现行版本：2.1.0 · 生效：2026-10-12 · 权威层级：L2
> 唯一仓库入口：`docs/roadmap/TTRPG-DEVELOPMENT-PLAN.md`
> 对应产品：`ttrpg` · 契约：`docs/products/TTRPG-AI-KP.md` 1.1.0
> 修订基线：`origin/main@f93a01e35788cd59a46db1ce0cd518f92b5c60d8`；执行者开工时须重新 fetch 并核对漂移。
> 状态：设计与分阶段施工契约；2026-10-13 已接手版本兼容及内部运行草稿，最新开发边界和验证见 §35。公开 `open` 入口尚未开放，`E-TTRPG-OPEN-01/02` 仍为 `missing`。
> WPS 同步对象：[跑团开发与施工方案.md](https://www.kdocs.cn/l/cdcofiCL3Aq3)。WPS 是本文件的工作副本；是否进入主干以 Git 合入证据为准。

## 现行入口、保留规则与阅读顺序

本次按需求保留 2.0.0 原稿全文及其 D0–D17、B1–B7，新增 §23–§34。原稿作为同一文件末尾的完整保留块，不删段落、不改写旧决策、不创建第二份竞争施工方案。原稿 UTF-8 为 189,753 字节，SHA-1 为 `63778aa3f5f11487964d869b448d472ec51bfd75`；保留块边界由 HTML 注释标记，可独立复算。只保留原稿，不保留原错误的施工效力。

裁决顺序：L0/L1 → 本版本 §23–§34 → 与修订不冲突的原稿 §0–§22。原稿中的“字段照抄”“八层即可”“schema 10→11”“只按 §15 顺序”“先解析再补兼容字段”等不得覆盖本版本的明确替代。修订索引见 §24；原稿的已存在/数量/行号均是 2026-10-09 快照，不能直接当作当前事实。模型选型 §34.2 是有日期的交接建议，不是运行模型配置或产品能力认证。

首次接手先读 §23、§24、§31、§32，再按当前施工单元阅读 §25–§30及原稿相关节。不要把末尾原稿的 2.0.0 版本头误认为现行版本。此文件足以解释任务背景，但不免除按路径核对实际源码；发现漂移时保留证据并增量更新基线，不能机械执行旧行号。

## 23. 首次接手：必要项目信息与当前能力

### 23.1 项目与产品边界

- 项目仓库：[yuanbw2025/StoryForge](https://github.com/yuanbw2025/StoryForge)。技术栈为 React、TypeScript、Vite、Dexie/IndexedDB；用户手稿与多数运行数据存于浏览器。换端口、域名、浏览器配置或工作树不会自动搬运这些数据。
- StoryForge 包含独立长篇/节点、短篇、剧本、漫画、漫剧前期生产，世界引擎，以及跑团、角色聊天、AI 小镇、文字冒险、AVG、文字开放世界。跑团不能借接入相似机制合并其他产品或接管它们的数据。
- 本任务属于**产品能力研发**。未来作者使用它制作某个跑团作品属于**具体作品生产**，两者的应用版本、完成证据和 ProductRelease 不同。
- 跑团作品只走 `S1 世界封存 → S2 产品定向 → S3 产品执行`。S1 提供冻结 WorldRelease；S2 在跑团内保存设置、选择来源、确认 Brief/SourcePlan 与明确开始授权；S3 分别完成生产、验收、发布、运行与私域演化。保存草稿或讨论方案不等于授权生成。
- Work 拥有跑团作品及作者配置；Production/Build 拥有制作轮次与产物；ProductRelease 拥有不可变作品版本和发布媒资；ProductRuntimeSession 拥有团局、运行中新事实/知识/记忆/媒资。WorldRelease 只读，不接收自动运行回写。
- Project 是 LocalWorkspace 壳，不保存作品标题等叙事字段镜像，不因导入展开旧 Project 数据。运行必须绑定准确不可变 ProductRelease；Build Preview 仅沿既有显式预览路径，不冒充正式发布。
- `open` 是新作品的目标标准格式；`scripted` 保留已交付内容与存档。`open` 首期使用 AI KP；既有 scripted 的 human/ai/hybrid 主持兼容能力不因“AI 主持是目标”被删除。`productType` 始终是 `ttrpg`。
- 半成品默认隐藏并标明实验性；阶段已合入不等于公开入口已开放。公共联网权限隔离、外部模组再分发、账户/云同步及商业运营仍按总纲后置。

### 23.2 开工必读与权威

先读取 `AGENTS.md` 和 `docs/CONTEXT-ROUTING.md`；按本任务定位读取总纲 §6/§7/§12、`docs/products/UPPER-PRODUCTS.md`、`docs/products/TTRPG-AI-KP.md`、`docs/roadmap/CAPABILITY-BASELINE.md` 的跑团行。实现时按所触及的读写、表、恢复与 PR 范围再读 `docs/DATA-GOVERNANCE.md`、`docs/HARNESS-QUALITY-STANDARD.md`、`docs/ENGINEERING-QUALITY-STANDARD.md`、`docs/COLLAB-WORKFLOW.md`。全部以 `docs/DOCUMENT-AUTHORITY.md` 的现行白名单为准；WPS 归档、聊天记忆和过去任务标题不是额外权威。

三项单一事实源是：

| 事项 | 唯一入口 | 接手者必须检查 |
|---|---|---|
| AI 读取 | `src/lib/registry/context-sources.ts` 的 `CONTEXT_SOURCES`、`assembleContext()` 与 Context Gateway | Skill 必需/选读、角色可见性、版本、预算、Context Manifest；不能在组件或 Skill 私拼 Prompt |
| 正式 AI 写回 | `src/lib/registry/field-registry.ts`、AdoptionSchema、`adopt()`；产品运行委托沿登记的候选/命令/Harness 契约 | 作者字段候选与有限运行委托不同；运行命令的现有治理不是新作者字段可跳过 Adoption 的许可 |
| 表生命周期 | `src/lib/registry/project-tables.ts` 的 `PROJECT_TABLES` | owner、外键、删除、导出、导入、重映射、分支及恢复；不能手写第二份表清单 |

正式模型输入留 manifest，原始响应先持久保存，输出成为候选，版本/作用域/权限/规则/信息边界通过后提交，最后留 post-state 和 terminal receipt。安全暂停、未知结果、授权/余额错误、非重试 4xx 与 stale 不得隐藏重发。确定性约束必须由代码检查。

### 23.3 当前实际链路与可复用设施

| 入口/领域 | 当前文件或稳定符号 | 已有能力与新实现必须保留的边界 |
|---|---|---|
| 作者入口 | `src/pages/TtrpgPage.tsx`；`/ttrpg/:pageId?` | 真实作品库、九步配置、来源选择、提案比较、制作检查发布、团局；无世界可先保存 S2 |
| 玩家入口 | `TtrpgCommunityPage.tsx`、`TtrpgSessionPage.tsx`；`/play`、`/play/session/:sessionId` | 已有作品安装、席位选择、私密交接、游玩、存档与分支；部署可能带 Vite base，不能硬编码域名 |
| 作者配置 | `authoring-contract.ts`、`authoring-settings.ts`、`authoring-service.ts` | `ttrpgAuthoringDrafts.settingsJson` 有闭集解析；新增格式及作者素材必须延伸实际保存/读取/Brief 编译链 |
| Brief/提案 | `production-brief.ts`、`campaign-proposal.ts`、`campaign-proposal-harness.ts` | 当前 Brief V2、冻结规则、席位、作者确认与提案锁定；新格式需显式 schema/锁定分流 |
| 来源 | `src/lib/product/world-requirement-adapters.ts`、`src/lib/product-production/world-source.ts`、`src/lib/context-gateway/world-release-client.ts` | 已有 TTRPG adapter、中立资源读取、来源目录/快照与冻结 SourcePlan；不能直接读物理世界表 |
| 生产 | `src/lib/product-production/plan.ts`、`production-executor.ts`；`ttrpg/scenario-prompt.ts`、`scenario-authoring.ts`、`production-compiler.ts` | 当前从闭合 narrative 图与场景模组生成 Campaign；需要 open 专属候选/编译分流，不能只改运行时 |
| 发布/分发 | `src/lib/product-production/runtime-package.ts`、`product-quality.ts`、`src/lib/product/releases.ts`；`ttrpg/creator-sdk.ts` | 不可变 manifest/hash/lineage、发布门、数据包信任与独立安装；旧包内容与身份必须不变 |
| 规则/账本 | `rule-pack.ts`、`resolution.ts`、`dice.ts`、`effect-plan.ts`、`effect-runtime.ts`、`item-ledger.ts`、`ability-ledger.ts`、`action-economy.ts` | 四套内置规则、确定性检定、骰子复算、资源/物品/能力/关系账本；新行动准入与现有算法须分开处理 |
| 命令与回放 | `runtime-commands.ts` 的 `appendFormalTtrpgCommand`、`runtime-event-reducer.ts`；`src/lib/product/runtime-core.ts` | 单事件原子提交、commandId 幂等、baseSequence/baseStateHash、runtime head、checkpoint；多事件后续处理需新增可恢复契约 |
| AI 主持 | `kp-coordinator.ts`、`player-coordinator.ts`、`decision-harness.ts` 及 gm/player/director harness | 有界主持循环、候选 checkpoint、确认、stale、终态；本轮需补原始响应与持续预算等缺口，不能宣布已有 Harness 无缺口 |
| 信息 | `viewer-projection.ts`、gm/npc/player/narrator/director context、`private-guidance.ts` | 不同角色投影、私密指引、受控揭示；新版事实/知识/Oracle/局势都要接相同接收者边界 |
| 分支 | `runtime-branch.ts`、`src/lib/product/runtime-product-adapters.ts`、runtime core 的分支入口 | 当前子分支以切点状态为 initialState 且事件序号从零开始；新状态必须有血缘处理，不可假定父事件都在子事件表 |

上述跑团域文件均在 `src/lib/ttrpg/`；组件在 `src/components/ttrpg/`，玩家 store 为 `src/stores/ttrpg-runtime-player.ts`。不要向体积很大的 `TtrpgCampaignGuide.tsx` 继续堆新面板；复用既有组件和领域服务，新增面板独立文件。

### 23.4 2026-10-12 评审基线与验证范围

- 当前 P8 开发分支为 **schema v12 /129 表 /备份 v16**，保留完整 v14/v15 明确转换。人工记忆 E15、只读本人档案、分支切点与稳定来源已接入引擎，玩家/真人主持可在冒险记忆界面确认与分享（§35.55–§35.56）；模型记忆来源与角色/KP 的正式召回已接通（§35.59–§35.60）；阶段复盘来源、正式摘要候选、模型 V2 明确确认/终验与主动复盘桌面已接通（§35.62–§35.66）；已接通基于正式发布团局的世界补丁审阅/导出与文件回读（§35.67）；真实长局验收继续实施。
- 当前 6 个跑团运行读源为 `ttrpgRuntime`、`ttrpgPrivateGuidance`、`ttrpgDirector`、`ttrpgPublicNarration`、`ttrpgNpcRuntime`、`ttrpgPlayerRuntime`；新源必须正式登记，不能因为文档出现名称就读取。
- 《雾港：最后一盏灯》是已有 scripted 验证作品，记录见 `examples/ttrpg/fog-harbor/production-status.md`；已有真实生成/作者修订与 UI 试玩证据不等于独立玩家验收或公共多人服务。
- 2026-10-12 评审复跑既有跑团及 Creator SDK/Harness 回归：23 文件、80 项全通过；当时检出分支的上述跑团文件与 fetched `origin/main@f93a01e3` 一致。这是旧能力回归基线，**不是 open 验收**，没有在本轮重新运行真实 provider/真人长局/全量 CI/E2E。
- 2026-10-12 评审时没有本方案 `openRun`、`worldTurn`、Oracle、会话事实门与 `R-TTRPGOPEN*` 实现。2026-10-13 接手代码的实际范围另见 §35；文档合入及未集成的纯模块均不得使能力条目改为 implemented/partial。

## 24. 2.0.0 修订索引：逐项替代与施工效力

下表是明确的纠正记录；执行者不能同时实现两列冲突契约。

| 原稿位置 | 发现的设计问题 | 2.1.0 生效替代 |
|---|---|---|
| §3.5、§5.1/5.2 的 V1 原位加字段 | 发布包闭集及校验顺序无法仅靠补字段保证旧 hash；缺少新协议准入 | §25/§28：原始格式保持闭集，新 Campaign/RulePack 使用显式 V2，运行机械投影不参与身份计算 |
| §3.1“规则行动沿原名直接复用”、§7 八层 | `resolveTtrpgRuleAction`、分类器、主持循环仍强依赖 scene/行动经济；共享 narrative 图也强制结局 | §26/§30：复用结算算法，新增 open 准入/调度；将 S2/DAG/共享 narrative 校验/安装/初始状态都加入分流闭包 |
| §5.5/5.6 F1 与 §5.10 | 初始位置/持有者/关系等被冻结为永不变化，阻断正常游玩；索引编译规则不明 | §25.3/§27.1：不变量、初始状态、可变运行权威分开；语义抽取候选与确定性编译分开 |
| §5.6/5.8、§8 G1/G2 | 发现数组没有接收者；已解决局势的知识会丢失；出路未先按 viewer 过滤 | §27.2/§29：独立角色知识权威与可追溯 discovery；局势结束不失忆；门按当前需要回应的真人投影判定 |
| §5.12、§6 E2/E3 | 队友意图不能由真人批准；缺少撤销/拒绝、候选证明及确认后的执行状态 | §26.2：行动者/批准者分离，绑定哈希、授权窗口、源版本；显式拒绝/撤销及执行回执 |
| §5.4/5.11、§9.4、§16 | 每个队友行动推进时间又清零其额度；预算按时间归零，可连续重开主持 | §26.3：世界时间与主持 epoch 分开；每个 epoch 每名队友最多一次，每个动作有冻结耗时；预算持久累计 |
| §6 E8/E10/E11/循环时序 | reducer 被描述为触发命令/写表；多事件链中断无后续待办；达上限重复奖励风险 | §26.4：reducer 纯同步；确定性 operation receipts/outbox 投影由协调器执行；阈值跨越和源因果幂等 |
| §6.4/§14.3 | 父事件序号在子分支不再可寻址；只比较数字不足以处理来源、seed 和记忆 | §28.3：`sessionKey + sequence` 来源、切点继承证据、稳定新 key；不篡改父历史，不复制切点后的候选 |
| §8、§15 P6b | 门恢复缺乏具体命令，正常阶段收束会触发无出路；四门可前期空置 | §29/§31：门与 owner 模块一起实现，终态/收束先分流；默认关闭公开入口直至联合验收 |
| §9、§10/§16 P7 | 首期先拼大上下文，后补预算；“全部硬约束机器化”会被误解为自然语言绝对保密证明 | §27.3/§29：首期即登记/渐进读取/持久预算/保留原文；结构门与真人语义评测分开 |
| §11.4/§14.2/14.3 | settingsJson 不是开放 JSON 容器；作者新字段/候选与 runtime 委托混用 | §25.2/§30：明确 Settings/Brief/Artifact 写入 owner；人工保存与正式 AI 采纳分别治理 |
| §13/§15/§18 | fixture 可开局不能证明正常作者能生产；30 轮、媒资和产品整体验收混在一起 | §31/§32：地基、正常生产、合作切片、长局与产品完成分别验收 |
| §14/§20 的版本、删除、验证要求 | schema 已前进；旧云副本不可覆盖新主干；删除违背本次保留要求；纯文档不该跑产品 CI | §28.4/§32.4：以最新 merge 基线增量迁移；保留原稿与废弃归档；本轮只做文档直接检查 |

## 25. 冻结内容、作者输入与规则接口的版本化契约

### 25.1 协议升级，原始内容与运行视图分离

1. 现有 Campaign V1、RulePack V1、ProductRuntimePackage/Release V1 与 runtime protocol 1 保持原始 schema、解析和序列化规则。禁止把未知字段一律放行、去掉 `exact()`、给旧 JSON 加字段后重算 hash，或静默修改已 validated 的规则行。
2. 新 open 内容采用 `TtrpgCampaignContentV2`（schema 名沿用、`version: 2`）、`RulePackV2`（`version: 2`）。新解析器必须闭集校验；原稿 §5 的新增业务字段语义除本版替代外保留。V1 缺 `runFormat` 只在**已验证原始包的内存视图**里解释为 scripted，不修改 `parseTtrpgCampaignContentV1` 的返回值或旧 payload。
3. ttrpg 内容块的 `compatibility.runtimeProtocol`、`minimumPlayerVersion` 对 open 都为 2；旧包保持 1。共同 ProductRelease 外层身份 schema 不因一个产品加功能随意升版。Creator SDK 的包版本/能力范围须显式扩展以表达 ttrpg protocol 2，旧播放器必须拒绝而非误装 open 包，旧 protocol 1 包继续可安装。新 scripted 仍可沿现有 V1 作者路径发行；不得强制迁移旧作品。
4. 现有规则算法若内部调用 V1 parser，使用唯一 `projectTtrpgRulePackMechanicalCoreV1` 把**已验证 V2**的共同机械字段投影为旧机械接口。Oracle/事实策略留在冻结 V2；机械投影不是第二套规则包，不落表、不改变来源 hash。保持算法等值正反例，不复制 resolution/dice/effect 逻辑。
5. 不再强制所有新导出面与原稿 §3.5 列表完全相同：本版新增的版本解析、operation、knowledge、branch 与 authoring API 必须在所属 PR 开工卡列出。符号仅为本方案新增设计，开工前用 rg 确认命名与调用方。

### 25.2 S2 Settings、Brief 与生产候选

`ttrpgAuthoringDrafts` 继续作为草稿表。新增 `TtrpgAuthoringSettingsV2` 和 open 专属 Brief V3，以显式 `schema/version` 区分已有无版本 settings JSON 与旧 Brief V2。旧 settings 读取为只读兼容视图，缺失格式解释 scripted；只有作者保存才生成新 revision，保留冻结 Production 旧 Brief。不得在读操作中改写旧行。

Settings V2 必须包含 `runFormat`、`wizard`、`openingSituation`、`playerRole`、`qualityProfile` 与 `openAuthoring`；scripted 的 openAuthoring 为 null。openAuthoring 使用下列固定键（允许未完成草稿为空，正式 Brief 必须通过发布要求）：

| 字段 | 内容和约束 |
|---|---|
| `factPolicy` | 不变量/初始状态/产品私域补充候选与作者确认状态，保存来源 resource/field/hash；不读可变世界草稿 |
| `situationTemplates` / `openingSituationKeys` | 作者局势模板及开局选择；延续 S1–S10，加入 §27 的可读 evidence 与类型化 driver 引用 |
| `effectPlanTemplates` | 原稿计划模板加 §26 的参数绑定定义；不接受 UI 任意传入正式计划 |
| `pressure` | clocks/fronts、征兆、触发与耗时策略；不能保存另一套运行时 clock 值 |
| `companionPolicy` | 预授权行动、真人批准席位关系、队友范围及安全底线；不是全局万能权限表 |
| `stageClosurePolicy` | 可满足触发、最大回合、收束与继续策略；不自动以达到最大值杀死玩家角色 |
| `dynamicEntityTemplates` | 可物化角色/地点/物品的冻结模板与机械授权；默认 []，未授权类别不得物化 |
| `runtimePolicy` | 有限运行 AI、调用/输出/token/费用预算、失败与未知结果恢复、输出模式 |

正式 Brief V3 必须冻结 Settings revision、format、规则 V2/hash、WorldReference、上述制作要求、SourcePlan 及开始授权。每次生产/返修的新目标或世界/权限变化回 S2；只修同一冻结目标的内容可走既有受治理局部返修。规则 Oracle 表由作者确认的新规则版本提供，不在会话里改规则。

作者面板写上述 Settings 经领域服务、revision/stale、作用域和生命周期；AI 作者候选使用产品生产 Artifact/已登记采纳入口。若新增真实 AI target 字段，先更新 FIELD_REGISTRY/AdoptionSchema，不可用“runtime 不走通用 adopt”豁免作者编辑。运行模型仍采用登记的有限委托、候选哈希与具名命令，不拥有任意写数据库权限。

### 25.3 事实索引与三种权威

冻结索引条目以 `subjectRef + predicateKey` 定位，新增 `authority: 'invariant' | 'initial-state'`、`owner: 'semantic-fact' | 'entity' | 'inventory' | 'social-ledger'`、`knownByActorKeys`、`sourceFieldRefs`。字段来源必须包含 resourceKey、字段路径、源 contentHash。private 必须有明确非空接收角色映射；仅“能追溯到角色资源”不构成受众授权。

- invariant 表达不可变语义限制，例如规则禁令和不可改写的历史；F1 只检查这一类。`canonInvariantPredicates` 不得指向已声明可演化的机械初值，类型冲突在制作期拒绝。
- initial-state 表达开局位置、资源、关系或身份状态；经 owner adapter 建立 session 初始状态。运行时按既有实体/库存/关系账本修改，不在冻结索引与会话事实中各保存一个“最终值”。
- 叙事会话事实归 session，只覆盖 factPolicy 明确许可的槽位；其 mechanicalRef 只能引用已提交的权威结算，不能靠 canonicalValue 改位置、物品、余额或死亡。`destroyed=true` 与语义“此资源身份存在”不能沿原稿跨谓词表直接判冲突；状态存在/销毁与语义身份是不同 owner。

受控十二谓词仍作为首期集合，但在 RulePack V2 加显式 `factPolicy`：每项包含 predicateKey、值类型、cardinality（one/many）、允许事实 kind、互斥关系、权威映射与是否允许新主体。`knows/owes/promised` 等多值谓词不能按单个 subject/predicate 覆盖所有对象；稳定比较键必须含 objectRef。没有对应 owner/值类型的模板在解析期拒绝。

索引编译不得把任意自然语言确定性转换成“绝对事实”。结构化字段按声明映射；自然语言经登记生产 Skill 产出事实候选，保留具体原文证据，作者确认后才能编译。纯 compiler 只校验、排序、寻址与 hash；对无法判定的冲突明确提出候选/作者问题，不伪造完成。索引属于跑团发布内容，来源语义不增加世界引擎固定 payload。F2 在候选拟提交后的只读快照求值；F3 只检查正确 owner 与已生效叙事槽位。

### 25.4 角色、地点、动态实体与效果绑定

open 初始化由冻结发布内容的 entity bindings 建立角色、地点与所持物品，不能依赖遍历 `campaign.scenes` 来创建地点；也不能用空场景当虚拟大地图。RulePack 的职业/技能/资源、NPC 动机/观察和角色卡沿既有类型及账本。

动态实体先是有来源的候选描述，只有 `ttrpg.open.entity.materialized` 事件可创建机械实体。命令须验证冻结 `dynamicEntityTemplates` 的 templateKey、kind、参数、名称长度、数量上限、来源受众与内核分配 entityKey；NPC 用冻结角色模板生成合法卡，不由模型自由创造属性/行动。默认禁止新增可玩真人席位、改规则或创造世界不变量。没有模板时 Oracle `maxNewEntities` 必须为 0；最多 3 的允许范围仍保留。该事件通过同一 operation 链，不新增表。叙事实体与机械实体映射由 session 唯一管理；不得让一个事实 key 自动被当成可战斗 NPC。

效果模板的 targetRef 可用冻结参数槽，但槽定义必须声明 allowed entity kind/来源集合/是否必填，绑定后生成完整 `TtrpgEffectPlanV2`。`plan.sourceEventId` 沿既有 `event.<n>` 格式引用**当前 session 已提交事件**；内核同时保存血缘 sourceRef。前置 commandId 与提交结果序号不得互相混用。Oracle、压力或局势结果可作为非 actionSequence 来源，但必须验证对应源事件、模板授权和 outcome；不能为了复用入口伪造规则行动。

open 禁用旧故事时钟，原稿 E8 作为压力 clock 的唯一增量 owner。现有 `clue.discover` 依赖旧 clueCatalog，不能直接用于 open：增加类型化 knowledge-discovery 效果/命令并沿统一知识 owner 提交，不能把 open evidence 偷塞回旧 catalog。location.set 等机械效果必须命中已物化地点。

### 25.5 新接口最小闭集与数值约束

以下类型是**待实现的设计**，不声称存在导出。字段最终定义与解析必须同批进入代码、回归及AI Manual；不能让接手模型补猜隐藏的执行字段。所有 key 沿当前 KEY 正则，text 沿已有长度合同，数组/数值超界在提交前拒绝，不隐式截断。

```ts
interface TtrpgOpenGenericCheckV1 {
  checkKey: string
  title: string
  actorAttributeKey: string
  diceModelKey: string
  difficulty: number
  preconditions: TtrpgPredicateV1[]
  targetKinds: Array<'self' | 'actor' | 'location' | 'item'>
  effectPlanByDegree: Record<TtrpgDegreeV2, string | null>
  riskFactRefs: string[]
  resourceCosts: Array<{ resourceKey: string; amount: number }>
  timeCostWorldTurns: number
  audience: TtrpgEffectAudienceV2
  sourceRefs: string[]
}
```

actorAttributeKey/diceModelKey 必须命中冻结 RulePack，difficulty 必须能被该骰模型/结算模式合法接受；不支持的骰模型/模式组合在发布期拒绝。effectPlanByDegree 恰含既有七档（critical-success/extreme-success/hard-success/success/partial-success/failure/critical-failure），没有的模板为 null；任何非 null 都命中授权效果模板。preconditions ≤32、targetKinds 非空且不重复、resourceCosts ≤16且amount为0..1,000,000整数、timeCost为0..10整数、sourceRefs非空。首期采用固定 difficulty 的冻结检定定义；更复杂难度表达留到规则版本升级，不让模型自由拟一个数。

初始实体绑定闭集为 bindingKey、sourceResourceRef（可为null，仅产品私域）、kind、templateKey、initialLocationRef（可null）、initialInventoryRefs、sourceFieldRefs、audience、knownByActorKeys；location 可以无初始位置，actor 的初始地点必须可解析。单包角色/地点/物品绑定上限各1000；运行新机械实体单局上限100且每次Oracle最多3，类别/属性由冻结模板给定。超限明确拒绝并留作者诊断，不另建临时实体表。

effect template 参数槽闭集为 parameterKey、entityKinds、allowedRefs、allowDynamicFromTemplateKeys、required；两种允许来源至少一项非空，绑定key必须等于声明槽集合（缺可选项用null），不能混入世界草稿/其他session。计划pending-choice只能由冻结 alternatives 提议，不立即提交；沿现有pending-effect-choice权限与账本扩展**来源类型**使Oracle/局势可绑定真实已提交事件，不伪造actionSequence。批准/拒绝后只提交一个合法选项，重复结果返回既有回执，选择所需真人身份继续受§26.2约束。

Session Zero 的 approvalBindings 每项闭集为 companionActorKey、approverSeatKeys、partyResourceApprovalAllowed；角色在当前AI/hybrid队友集合，approverSeatKeys为非空真人human/hybrid claimed席位且已接受桌面约定。授权revision改变使未执行计划stale。其他真人秘密/资源仍逐角色批准，partyResourceApprovalAllowed不授权处理个人秘密。

open stage 状态闭集为 actionable、closure-ready、closed、paused；四门把合法closed/paused记为not-applicable且留证据，不以空局势判失败。恢复/继续命令必须验证新openingSituation与同一阶段版本，不能把phase bool当授权。

## 26. 自由行动、授权窗口与可恢复结算

### 26.1 从输入到冻结行动计划

复用现有自由输入入口，但旧 `intentKey` 入参及 submittedBy 不能静默改语义：scripted 仍走原协议；open 的 intentKey/inputRevision 由内核计算，客户端只给原文、澄清线程与当前 envelope。先验安全/权限/禁写范围检查在路由之前执行，不能把 rejected 放到所有可执行路由之后才检查。

模型只解析语义并建议绑定；最终裁定路由、资源、代价、重大确认、耗时都来自冻结规则和权威状态。Preview 必须增加 planHash、intentCandidateHash、resolutionBinding、affectedActorKeys、timeCostWorldTurns；不接受模型把 `irreversible=false` 当唯一安全证明。binding 闭集为：

| route | 正式计划必须携带 | 权威依据 |
|---|---|---|
| existing-action | actionKey、actor/target binding、规则版本、检定与效果来源 | 角色授予/物品授予、在场/位置、行动前置、open 授权窗口；结算算法复用 |
| generic-check | 冻结 checkKey、属性/技能映射、difficulty 来源、骰模型、成功/失败模板、风险和资源 | RulePack V2 的声明式 genericChecks；不存在通用检定定义则不能臆造检定 |
| oracle | oracleKey、问题、档位来源、结果→解释→可提交事实/后果的允许范围 | 冻结 Oracle 表与内核状态映射；随机结果不能替代玩家重大选择 |
| no-roll | frozen interactionKind、允许效果模板/叙事回执、耗时 | 纯桌外对白/规则询问为 0；游戏内互动/移动/观察由声明的时间策略确定 |
| needs-clarification / rejected | 缺失项/拒绝原因/可见替代方向 | 不结算、不扣资源、不推进世界时间；同线程追问 ≤3 |

genericChecks 与 Oracle 的 social tier mappings 必须进入 RulePack V2 闭集：社会余额映射采用冻结数值区间，每个范围有明确开闭边界且不重叠；无匹配取 defaultTierKey。原稿“分段写在内容里”不能只是一段不可执行文本。

意图模型的 runId、candidateHash、manifestHash、输入 revision、releaseHash、ruleHash、visibilityHash、baseStateHash 和 Skill binding 必须由既有授权 checkpoint 证明。`openIntent` 类型合法不等于允许提交。模型输出原文先持久保存再 parse；错误/stale 候选可查看而不可提交。规则内自动裁定不需要作者逐次点击，但不得绕过 Session Zero 和玩家控制权。

### 26.2 确认、拒绝和执行状态

原稿 E3 替换为确认 `TtrpgOpenConfirmationV1`，必要字段：intentKey、planHash、candidateHash、releaseHash、authorizationEpochKey、actingActorKey、approverSeatKey、approverActorKey、viewerKey、decision（approve/reject）、approvedRiskHash。preview 在等待期间持久保存；确认的是同一冻结计划，不是任意后续文本。

- 真人角色自己的意图：对应 claimed 的 human/hybrid 席位确认；不能让 AI 假扮真人。
- AI 队友：Session Zero 中由真人显式授权的 `approvalBindings` 指定每个 companionActorKey 的 approverSeatKeys，至少一个；批准者是这些席位之一，且当前由真人控制、已接受桌面约定。AI 行动者与真人批准者允许不同，但其他角色的秘密不能因此自动披露。
- 涉及其他真人的私密资源、秘密或不可逆角色变化：每个受影响真人单独授权；队伍公共资源由冻结的 party approver 关系处理。首期一真人可简化席位数，不能放松作用域。
- AI 队友永远不能作为需真人批准行为的批准者。reject/withdraw/stale 后不能执行；新增 `ttrpg.open.intent.disposed` 记录拒绝/撤销，不能仅从 pending 数组删掉。
- 意图状态闭集：previewed → awaiting-confirmation / ready / clarification / rejected；ready → executing → resolved；等待期间可 withdrawn/stale。确认会增加事件序号，后续按最新 envelope 执行，但 planHash 与授权仍必须一致。
- 开始执行前重新校验关键状态/受众/代价；关键变化使计划 stale 并重新预检，不能把旧确认自动挪给新计划。重大四类底线保持不变。

### 26.3 世界时间与主持 epoch

保留 `worldTurn` 作为游戏内时间单位，事件序号仅用于存储顺序。新增可回放的 `openRun.coordination`，包含 activeEpoch、epochs 中的调用/行动额度、reserved/in-flight/known/unknown 请求状态和停机原因。epoch 是授权/预算处理单元，不是第二个世界时钟。

一个 epoch 由真人明确“提交行动”或“继续主持/时间流逝”的调用授权启动，包含该输入的意图解析/澄清/预检、等待确认和后续执行；启动授权不等于确认剧情代价，也不推进时间。查看资料、展示已有E2预检、刷新与内部重试不启动新付费循环；澄清回复留在同一epoch预算，预算不足即停止。起止事件为 `ttrpg.open.epoch.started` / `ttrpg.open.epoch.closed`，绑定触发输入 revision、Session Zero revision 与预算。一个 epoch 每名 AI 队友成功执行最多 1 次，真人重新授权后才新开；worldTurn 增加不清零该额度。活动 epoch 未完成时不能以刷新、重复按钮或新 commandId 绕过预算；navigator.locks 只是并发辅助手段，最终以事务/状态版本拒绝竞争。

行动耗时来自冻结 timePolicy：默认规则行动/generic check/no-roll 游戏内行动 1 worldTurn，桌外/查看/规则问答/预检/Oracle 咨询 0；单次计划允许 0..10 的规则显式覆盖。队友数会带来真实多次行动耗时，不能把每名队友的“一轮”解释成整队的一轮。需要整队同一时段的行动由同一个有界 group plan 固定结算，再一次推进对应耗时；不在本期擅自增加同时行动第二套权威。

原稿“队友数 + 4”（2–3 队友为 6–7 调用）改为**每 epoch 总调用上限**，包含实际 provider 请求及 repair；可用预算不足则保留待办并显式终止/请求用户继续。既有 maxAiActions 继续作为动作额外上限。费用有 provider 回执则记实际，未知保持 null；人工再次授权记录新预算，不删除旧费用。Oracle ≤2 次按 worldTurn 仍生效，同时受 epoch 限制；不能靠 E7 清零模型调用预算。

推进时间只发生在执行成功后的 E7；`byEventSequence` 必须命中本 session 的已结算游戏内行动/收束/显式时间流逝事件，并验证其 timeCost 与已消费 operation，不仅验证字符串 reason。长耗时按连续世界时间 tick 处理，保存进度；同来源不可重复推进。Clock autoAdvance 在每个时间 tick 只求值一次，非游戏内输入不推进。

### 26.4 多事件 operation 与 reducer 纯函数

`openRun.operations` 由事件派生，不新建表，保存 `operationKey`、rootCommandId、input/planHash、authorizationEpochKey、phase、status、plannedSteps、completedStepKeys、pendingEffects、resultEventRefs、timeCost 与 failure/unknown 证据。单事件仍沿 `appendFormalTtrpgCommand` 原子写 event/runtime head；多事件采用可恢复处理链，不能假装整体天然事务化。

新事件命名空间闭集新增：`ttrpg.open.operation.started`、`ttrpg.open.operation.step.completed`、`ttrpg.open.operation.completed`。所有权威业务事件携带 operationKey、stepKey、causeRef 与 frozenPlanHash，幂等 key 为 `op.<operationKey>.<stepKey>`；同 key 同计划返回原事件，同 key 不同计划拒绝。step.completed 只能引用真实已提交业务事件/账本回执，不能由模型宣布完成；最终 completed 验证全部必需 step 已完成且状态一致。

处理顺序固定：输入/授权 → 裁定回执 → 机械效果/事实与知识 → 耗时 → 压力 → 局势 → 阶段终态与四门 → 按受众叙述 → epoch 交接。每个必需步骤在 started 时确定，条件新增步骤由受控事件推导并留因果。未知 provider 结果进入 unknown，阻断相应重发；用户只读查看/导出已提交状态仍可用，业务行动等待恢复完成。candidate 已持久化时续用而非重调模型。

reducer 必须纯同步：不调用 DB/模型/具名命令，不发新事件、不执行 WebCrypto、不读当前时间。压力完成效果、front 升级局势、后果链、G1/G2 恢复等只生成或改变派生 pending steps，由协调器在 reducer 外提交。事件 payload 带已验证的冻结片段/受众/模板绑定供离线重放；回放不从可变行再取定义。

`clock-complete` 仅当 `valueBefore < maximum && valueAfter >= maximum` 产生一次完成后果/chaos，已满时钟的重复 tick 不再奖励。失败检定、Oracle 否定、front/clock 完成、阶段收束分别以 causeRef/tickKey 消费一次；跨事件链恢复不重复推进，不只依赖每次变化的 baseSequence。

拒绝日志与业务失败区分：被拒绝命令不执行部分效果；记录诊断走作者态 E18，safe pause 状态下允许只读诊断/保存失败证据，不因日志写失败自动再执行原动作。operation 断点后续可重放，但可生成新确定性事件的恢复发生在协调器，不能在“读状态”中隐式写库。

### 26.5 2.1.0 事件增量与状态写入责任

原稿E1–E18仍按本版修订后的payload/guard实施（未进入代码，不需要兼容“从未发布的旧设计事件”）；新业务事件不是全局任意字符串。下表事件均须在权威event types、FormalTtrpgEventType、具名命令、parser/reducer、branch投影、AI授权与回归中登记，未完成单元默认拒绝。

| 事件 | 唯一命令（待新增） | 状态/验证责任 | 交付 |
|---|---|---|---|
| `ttrpg.open.operation.started` | `startTtrpgOpenOperationV1` | 保存冻结plan/steps及root授权；每epoch同时最多1个executing operation | P2b |
| `ttrpg.open.operation.step.completed` | `completeTtrpgOpenOperationStepV1` | 引用真实业务事件/效果，更新completedStepKeys；单operation总steps≤4096、同step不能换plan，超限拒绝计划而非截断后果 | P2b |
| `ttrpg.open.operation.completed` | `completeTtrpgOpenOperationV1` | 全部必需step有receipt才终结；业务后果/时间不在此重做 | P2b |
| `ttrpg.open.epoch.started` | `startTtrpgOpenEpochV1` | 真人授权/触发revision/预算；同session同时最多1个active epoch | P2b |
| `ttrpg.open.epoch.closed` | `closeTtrpgOpenEpochV1` | 必需operation完成或有明确paused/unknown终态；不删除历史预算 | P2b |
| `ttrpg.open.call.reserved` | `reserveTtrpgOpenModelCallV1` | requestKey/Skill/inputManifestHash/预算在provider请求前持久化，剩余额度不足零发送 | P2c |
| `ttrpg.open.call.dispatched` | `dispatchTtrpgOpenModelCallV1` | 同request合法reservation才标dispatched；在外部请求前持久化，之后中断且无结果记unknown，不能由读状态自动发请求 | P2c |
| `ttrpg.open.call.finished` | `finishTtrpgOpenModelCallV1` | 记录原始响应artifact引用/实际或未知用量、attempt、succeeded/failed/unknown；只有同request的终态可闭合reservation | P2c |
| `ttrpg.open.intent.disposed` | `disposeTtrpgOpenIntentV1` | reject/withdraw/stale及身份/理由；不消费玩家资源 | P3（原E2/E3同批） |
| `ttrpg.open.knowledge.discovered` | `discoverTtrpgOpenKnowledgeV1` | 来源、发现策略/结果、接收者；只能增加当次获授权知识 | P4 |
| `ttrpg.open.knowledge.shared` | `shareTtrpgOpenKnowledgeV1` | 来源/公开字段/传播授权，不让信念成为客观事实 | P4 |
| `ttrpg.open.oracle.reviewed` | `reviewTtrpgOpenOracleCandidateV1` | 当前真人完整确认解释与全部提案；同事务通过 F1–F4 采用选中事实并保留逐项弃用原因；原文/候选/来源/窗口/批次 hash 和完整终态绑定，不自动推进时间或改世界 | P4 |
| `ttrpg.open.entity.materialized` | `materializeTtrpgOpenEntityV1` | 合法模板/数量/owner/内核key；同期更新entity与fact绑定，无半物化 | P4 |
| `ttrpg.open.source.inherited` | `inheritTtrpgOpenSourceV1` | 冻结祖先来源回执，使后续子effect有真实本地因果；不复制父事件身份 | P2c |

requestKey与operationKey均包含稳定sessionKey/epochKey，最大200字符；超长用canonical hash压缩，不能用短数字seq跨分支复用。call.reserved不自动证明已发送：由call.dispatched区分prepared/dispatched并保存providerRequestId（无返回为null），只读恢复无法区分dispatch结果时标unknown，绝不隐藏重发。原始响应artifact沿现有受治理run工件/存储入口，不能把API key或完整provider配置放进payload。每个reservation都计入epoch的硬请求额度，repair也先reserve；失败释放未消费token预算时保留已计请求数和真实费用。只有意图解析/队友生成所需的一次模型调用：队友Skill直接给结构化意图，再由纯函数预检，不为每名队友额外再调一次open-intent突破总预算。

authority更细说明：operations只管理结算进度、不复制资源值；coordination只管理授权/调用额度、不复制世界时间；knowledge只管理接收者已知内容、不改客观世界；entities/库存/social账本继续各管机械状态。新状态与引用的序列化/解析由§28管理，旧scripted不新增这些owner。

## 27. 会话事实、角色知识和信息边界

### 27.1 事实与信念

F1/F2/F3/F4 的存在保留，应用范围按 §25.3。supersedes 必须指向同一 session 血缘中的生效事实、相同槽位/对象与可变 scope；退休旧事实和写新事实在同一正式事件的确定性 transition 中完成，不能分两步留下短暂双权威。原稿独立 E6 只用于明确撤销叙事事实，并记录原因/授权，不能退休 invariant 或删除机械账本。

观察、传闻和信念属于角色 observation/记忆，不成为规则裁定事实。模型的 `declaredAssumptions` 不能直接写 exists/located-at 等客观状态。NPC belief 可以错误，但要引用所见/所闻来源和 observer，不能为了让其“知道”而向上下文发送 GM 真相。

F4 对结构化来源和实际授权依赖做密级检查；sourceRefs 由解析器结合真实 manifest、结果回执和内核模板构造/核对，不能只信模型自报。合法 reveal/discovery 必须精确绑定来源、公开字段、接收 actor/viewer 与授权，不是一个“有 reveal 事件即可解密所有内容”的总开关。private 合并来源按接收者交集检查；交集为空不能随意创建 party 事实。

### 27.2 可持续、按角色的 evidence / knowledge

局势 evidence 每项新增可读 `title`、`description`、`sourceFactRefs`、`sourceResourceRefs`、`discoveryPolicy`；description 为发现后可见内容，未揭示真相另留受限事实。discoverableBy 的 action/check 必须是真实路径绑定，不是随便执行同名行动就揭示；policy 包含前置谓词、失败前进/代价模板、允许受众与是否需要玩家确认。driverRef 改为类型化 driverBinding，world-event/player-commitment 也必须有冻结索引或正式会话事件，不能只校验 fronts/characters。

新增唯一派生 owner `openRun.knowledge`：

```ts
interface TtrpgOpenKnowledgeEntryV1 {
  knowledgeKey: string
  evidenceRef: string
  sourceFactRefs: string[]
  sourceResourceRefs: string[]
  acquisitionRef: { sessionKey: string; sequence: number }
  audience: 'public' | 'party' | 'private' | 'gm-only'
  recipientActorKeys: string[]
  publicFieldsHash: string
  reliability: 'observed' | 'hearsay' | 'belief'
}
```

写入唯一入口为 `ttrpg.open.knowledge.discovered`；合法传播走 `ttrpg.open.knowledge.shared`，都绑定真实来源、step/cause 与确定性接收者集合。party 是当次已获授权的席位集合，不因后来新席位加入自动暴露历史秘密；加入席位的历史授予须显式产生 knowledge.shared。spectator 只读 public，若沿旧 scripted 既有 spectator 行为则保持原样。

实例 `discoveredEvidenceRefs` 可以作为从 knowledge 派生的便利索引，但不能作为谁知道的最终权威。`evidence-known-by` 查询该 actor 的知识与可靠性，不依赖“实例仍 active”。解决/到期/替代局势不删除知识；private 发现不能让全队自动过 G2。新 knowledge 与当前 actor/entity、事实、operation、血缘引用保持闭合。

### 27.3 首期上下文与自然语言边界

原稿六个新增读源按 owner 阶段登记，另加 `ttrpgOpenAuthority`（冻结格式/规则机械视图/角色授权窗口/operation）和 `ttrpgOpenKnowledge`（当前接收者知识）；source keys、reads、预算、权限及 AI Entry Registry 随实际实现登记。作者事实抽取/局势制作源归 authoring/production，不借用 session-only 读源。

首期就用 Context Gateway 的 describe/search/read 和按来源的 manifest、最低充分性与完整 JSON；不可降级规则/权威字段超预算时零 provider 请求。活跃局势/已知知识/相关长尾原文按目录选择，不能先拼全局 5,000 条事实再截固定前缀。P7 提供 trigger/预算 UI 和更细策略，不是首期预算安全的开工条件。

open-intent 读当前玩家授权视图，companion/NPC 读各自观察与知识，public KP 叙述读正式结果的目标受众投影；GM 计划可以读受限内容，但其完整文本不直接作为 public narrator 输入。角色私密指导不泄露给其他席位或公开战报。原始响应、诊断、gates、未投征兆的 stage 内部数值及计数不进入玩家输出。

Schema/引用/受众/版本/权限可机器验证；“一句话完全不暗示秘密”“文案一定充分支持推理”没有绝对确定性判定器。保留最小信息输入、字段允许范围、补充字符串检查、坏样本和真实模型评测，不能把 F4 或禁词检查宣传为自然语言绝对保密证明。即兴文字若带新事实，先正规化/校验/提交，再叙述，不把未经提交的候选称为已经发生。

## 28. 旧包、旧档、分支与数据生命周期

### 28.1 发布与预览的校验顺序

当前 `verifyProductReleaseManifestV1` 先解析 RuntimePackage，再对解析结果算 packageHash/规则 contentHash。新增兼容字段若在这个阶段注入会改变旧身份。新版入口必须区分：原始结构解析（保持旧字节语义与旧规范化）、原始包/规则/identity/lineage 校验、已验证运行视图构造。

返回结果保留 rawManifest/rawRuntimePackage、validated hashes 和 runtimeView；校验身份只读原始格式对应的 canonical value，不以物理字节 hash 替代项目已有 canonical hash 算法。运行补齐字段不能参与 packageHash、contentHash 或 releaseIdentityHash，也不能把“字段未知”当 legacy。缺一部分 V2 字段的混合包一律拒绝，只有完整旧格式可进入旧投影。

相同流程覆盖正式 Release、Build Preview、社区/Creator 安装、导入导出、规则库读取、house-rule overlay、模型 Prompt 使用和 initialState 对比。旧 session 的 source identity 不改；新 reader 为旧包创建内存视图，不更新数据库。旧 writer/新 writer、错误版本/错误 hash/损坏新字段/错产品都要反例。V2 mechanicalCore 与原定义等值但不被当 validated 原始包重新发布。

### 28.2 状态和存档格式

`parseTtrpgProductState` 当前为字段闭集；新增 openRun、knowledge、coordination、operations 必须增加明确状态版本与解析分支。旧状态无新字段时按旧版本解析，保持旧 stateJson/hash、initialStateJson、checkpoint 和 runtime head 原值；运行视图提供 null/空值，不在刷新时自动持久写补齐。新增事件生成的新状态使用新格式，不能重算旧 checkpoint 哈希伪装同一检查点。

事实/知识/局势/时间/压力/operation/epoch 的容器由 E1 初始化并事件派生；对 old scripted 的新专属事件明确拒绝。后置阶段事件不能因为占位出现在 event-types 就被视为已启用，能力 gate、parser/commit/reducer 都验证 phase/协议。事件闭集依然先登记 PRODUCT_RUNTIME_EVENT_TYPES 再更新模块 Extract，不能扩全产品任意事件名。

### 28.3 分支来源与随机复算

当前 runtime core 在切点派生父状态，调用 product rebase，再把子分支 lastSequence 置 0，继承值放进 initialState。新增跑团 rebase hook 必须纳入 `runtime-product-adapters.ts`，不能只克隆 side tables。

所有新来源引用统一 `{ sessionKey, sequence }`，sessionKey 是 session 稳定 portable 身份，序号必须真实存在于该 session 或被冻结的 ancestor evidence。operation/action/Oracle/fact/knowledge/memory 的新 key 包含 sessionKey；不能用 `${subject}.${predicate}.${baseSequence}` 在子分支制造重名。既有 scripted key 不改。

分支继承清单冻结父 sessionKey、切点 sequence/hash、release/runtimeSourceHash、合法源事件摘要与 hash；只继承切点内已提交结果。父范围的来源继续标为父来源，子新事件从 1 开始。需要提交新 effect 时先产生子 session 的因果继承回执，`sourceEventId` 指这个真实子事件，receipt.sourceRef 指父来源，不能把父 n 伪装成子 n。新 receipt 包含随机源 sessionKey/seedCommitment，父 Oracle 用父 seed 复算，新分支新 Oracle 用子 seed；读档不隐式重掷。

pending intents/模型请求/未完成 operation 在创建分支时必须显式处置：默认继承已提交后果，取消父授权窗口与未提交候选；子分支通过恢复规划生成仅剩的确定性待办或等待真人重新授权。未知模型结果不被子分支自动重发；新语义计划须重新预检。父分支继续可读可运行且数据不改。

knowledge 继承切点内授予；局势保留终态快照与已知引用，不只保存 resolved 的 key；cooldown、telegraphWorldTurns、worldTime 和已消费因果按切点一致继承。记忆 toEventSequence 超过切点的**跨切点区间**也不得克隆或召回，不只检查 fromEventSequence。子分支删除/备份重映射不得破坏父来源证据；祖先被删除时保留冻结来源证据或者阻止不可恢复的级联，依 PROJECT_TABLES 所声明策略测试。

### 28.4 表、schema 与恢复

首期仍零新表，复用作者草稿、agent runs/checkpoints、product runtime events/session/checkpoints、席位、媒资表；在 PROJECT_TABLES 的 JSON 引用 remap 范围中登记真正保存的 session/World/Work/production ID 与 portable sourceRefs，不私藏可重映射数字。规则包与作者草稿新增版本仍沿各自 owner，不改 Project/World。

P8 若新增叙事记忆表，必须基于当次最新 schema N 固定 STORES_VN 后加 N+1。当前是 v11，所以在无其他迁移时下一版为 v12；**不得照抄原稿 10→11 或再次创建已有 STORES_V10**。迁移保持支持窗口、半提交失败、旧记录保留、备份往返/引用重映射、session 删除/分支克隆/祖先依赖全生命周期。世界补丁只导出作者审阅候选；升级世界必须显式创作/确认新版本，不追写旧 WorldRelease。

## 29. 质量门、恢复与开放条件

### 29.1 首期必须有的结构门

- G4 随事实 owner 实现；G3 随压力实现；G1/G2 随局势实现，联合验收在 P6b。不能在 P3 的玩家桌面开放后把四门留为空实现。所有结果有角色/epoch/评估依据 hash 与受众范围，只有作者态看到完整诊断。
- 先判阶段状态。阶段已可合法收束或 safety pause 时，不把“active 局势为空”当意外死锁；阶段继续必须显式激活合法局势后才回 actionable。超过 maximumWorldTurns 暂停进一步耗时行动、提供安全收束/存档，不自动宣布某个剧情结局。
- G1：对本次需要回应的真人先投影可见局势与介入点，再检查至少一个当前可用方法；不能用他人 private 点充数。G2 同一投影检查证据/障碍依赖覆盖与可形成假设，可靠性为 belief/hearsay 的传闻不是客观通过条件。
- 新四门结果闭集为 `applicability: 'applicable' | 'not-applicable'`、`passed: boolean | null`、`evidence: string[]`、viewer/阶段/评估依据。not-applicable 必须 passed=null且有真实closed/paused依据，不累加失败、不冒充passed；新阶段开始按阶段revision重置连续失败计数，旧阶段诊断保留。原稿的仅passed布尔结果在本方案未实现前由此替代。
- G3 只检查未击败 front 的未完成下一阶段，先投 party/public 征兆并满 minLeadWorldTurns 才升级；G4 对不变量及正确槽位做拟提交/当前生效校验，增量结果必须等价全量。
- 模板结构 S1–S10 的下限是首期调查/合作局势的内容合同，不要求纯对白、安全讨论和每个世界动态都先制造两个障碍、两条 evidence。新玩法需新局势合同/版本，不能靠占位填充通过门。

### 29.2 有界恢复必须是真实命令

G1 无出口时最多尝试一个当前合法 queued 模板；G2 最多揭示一条允许失败前进的非必需 evidence，或由 NPC 发出受众允许的 hearsay（后者供玩家参考，不直接把客观门翻绿）。两种恢复都通过 operation 下的具名 activate/discovery/observation 命令产生真实事件，不直接变更 gate bool。单次失败最多一次局部恢复，重新求值仍失败则停止本 epoch，保留原因；同一 gate 连续 3 次未恢复才请求作者审阅。主动修复不扣玩家角色资源，剧情裁定的已确认代价另按规则处理。

队列 FIFO 释放、cooldown、有效前提、容量上限保持原稿规则；拒绝项须给定位 evidence。清空/终结局势产生合法 stage-close 分支，不能自动造一条“解决所有问题”的假线索。front defeated 后不会继续升级。public narrator 未读受限块，玩家界面不显示隐藏数量；失败日志留作者态，不把错误细节混入剧情。

### 29.3 发布门与共享叙事图

scripted 八个旧门的判定和证据字符串保留。open 不再依赖 `product.narrative.play-loop` 的 choices 下限，不再通过制造假 choice/ending 节点满足共享门；由 `product.ttrpg.open-play-loop` 检查初始位置/角色/合法规则行动或 interaction、可见开局局势、自由输入计划及可恢复运行合同。

共同 runtimePackage 仍可保留 narrative 容器作为版本化开场说明/只读叙事素材，但 open 内容采用专属 `validateTtrpgOpenNarrativeEnvelopeV1`：节点/beat/key/source/speaker/闭集/长度均检查，允许无 ending 和无 choices，不运行闭合可达性/死路判定；generic narrative navigation/effects 对 open 禁用。`validateNarrativeContentGraph` 的默认旧行为不能被全局放宽；其它五个产品保持原契约。

open 发布还须通过规则/Oracle测试、作者局势/压力/不变量/确认、收束/效果计划/clock 单一权威及来源、知识/受众、实体/模板绑定、协议兼容和运行 AI 预算合同门。Oracle 复算与征兆前置的 100% 结构要求保留；事实矛盾/可继续率先测基线，不卡一个捏造的商业阈值。

正式发布前确认该 Build 必需媒资及允许降级闭合；首期可以文本为主，但已有地图/头像/handout 的 owner、来源、许可、Blob 强引用与安装/恢复不能退化。真实图像/音频质量、public多人隔离与商业 readiness 均保留独立验收状态。

## 30. 正常作者生产链与完整用户流程

### 30.1 制作任务与产物

新格式在现有 product-production Harness 内增加跑团专属任务和候选，不复制生产服务/DB/导入导出系统；不得改变其他产品任务含义。任务名为本版固定设计 ID，Skill/AI entry/source 在实际施工时先登记。

| 任务/产物 key | 上游与职责 | 写入与准入 |
|---|---|---|
| `ttrpg.open.source-facts` | 冻结 WorldReference/SourcePlan → 结构化来源候选、invariant/initial-state/私域补充清单 | 保留原文/字段证据与 manifest；作者确认后编译 index |
| `ttrpg.open.rule-system` | 已确认 Brief/规则版本 → 规则机械绑定、genericChecks、Oracle/fact policy、角色合法构建与耗时 | 不改原 validated 规则；选择/审查新版本，夹具完整 |
| `ttrpg.open.situation-layer` | 来源事实/规则/作者锁定目标 → NPC 动机、局势模板、压力、征兆、知识发现路径、效果绑定和阶段策略 | 独立 CreativeArtifact/生产候选，引用上游版本；不造固定结局 |
| `ttrpg.open.media-plan` | 内容与角色/地点标签 → 必需/可选媒资需求及 slot manifest | 复用已有产品媒资任务、Blob、许可/受众；素材生成可独立失败与返修 |
| `ttrpg.open.integration` | 所有作者采纳产物 + 系统/媒资结果 → 确定性 Campaign V2/RuntimePackage/Build | 不生成新剧情、不补猜缺字段；任何输入 stale 使下游待重建 |
| `ttrpg.open.quality` | 集成 Build → 静态门、最小可玩演练、质量 receipts | 定位真实产物/字段/绑定；失败沿原生产 repair 路径，不绕发布门 |

现有 `content.narrative → content.product-module/ttrpgScenario` 对 scripted 保持原样；open 不把这两任务的闭合场景 Prompt 偷换成局势。新增专属 artifact 进入当前计划/编译/发布，`sourceCatalog` 需要完整已授权 resources 而不只 name/description 摘要。上下游 hash/作者锁定/版本来源进入实际 Build provenance 和 release lineage。

### 30.2 作者编辑、返修与发布

作者可逐字段或结构化编辑事实候选、局势/压力/Oracle、角色卡/映射、效果模板、开始位置及发现策略；保存即增加 revision、更新治理状态，关键改动使相关候选/Build stale。UI 必须提供当前版本、来源、变更与校验错误；不能把首次开团变成开发者手工 JSON 修补。

原稿三专用作者面板保留；玩家与作者路径分开，作者权限也不被自动带到玩家路由。首期普通作者必须能从界面完成冻结/检查/发布，导出/安装/继续沿既有链路。通用逐字段所有产物编辑可渐进扩展，但本期 open 正式素材不能只有只读页面和重新全量生成一个按钮。

用户流程：选择/创建跑团 Work → 保存 S2 设置 → 选准确世界版本 → 主 Agent 讨论并确认来源补充/规则/局势方向 → 冻结 Brief/SourcePlan 与明确开始 → 生成候选 → 作者审查/编辑/采纳 → 集成与检查 → 可玩 Preview → 发布 → 席位/角色选择与 Session Zero → AI KP + 真人 + 队友游玩 → 显式阶段收束/暂停 → 保存/继续/分支。正常界面生产的作品与 fixture 分别验证，不以 fixture-only 进入公共目录。

## 31. 修订后的施工单元、依赖与交付物

保持 P1–P10 的主题与追溯 ID，拆开过大的 P2，并将质量/恢复提前到 owner 所在模块。原稿 §15 为历史拆分，本表决定当前施工。一个 PR 一个可解释增量；产品能力阶段合入不自动打开 public open 入口。

| 单元 | 必须完成的内容 | 依赖与退出条件 |
|---|---|---|
| P1 文档契约 | 本版、产品契约、能力基线、文档白名单及检查器、上下文路由/路线图链接，WPS 同步 | 纯文档直接检查；保留原稿/决策；open 仍 missing。合入证据单独记录 |
| P2a 版本与兼容 | Campaign/RulePack/Settings/Brief 新版本；raw/view 分离；protocol2/SDK/预览/安装分流；旧状态读取 | P1；旧包/旧档/旧规则哈希不变，混合格式拒绝，scripted 原回归不改断言 |
| P2b 规则准入与结算地基 | open 位置/实体/调度、genericChecks、授权绑定、epoch/operation、E1/E7、pending 续接和纯 reducer | P2a；无 scene 可用冻结规则完成一次行动，逐边界故障恢复不重复后果；不调用模型也能确定性验证 |
| P2c 来源/知识契约 | index authority/来源映射、生产事实候选确认、角色知识/受众、branch sourceRef、最低上下文/原始响应保存 | P2b；来源/知情/分支/预算反例；不变量不变但合法机械初值可演化 |
| P2d 作者生产最小链 | S2 与专属 DAG/Artifact/编辑/compile/quality；手写作者素材 fixture 与正常作者输入路径；模板解析/实例门 | P2c；正常界面可制作/检查/发布新格式；若 P4/P5 尚未完成只能标内部地基 Preview，不宣传合作切片完成 |
| P4 Oracle/事实 | 原稿 Oracle 确定性、权重拒绝采样/复算、F1–F4、模板绑定、事实/知识权威和 G4 | P2d；Oracle outcome 被下一轮真实引用；复算 100%；防越权与合法揭示反例 |
| P5 压力 | E8/E9/E10/E12、因果消费/完成一次、time ticks/预警/defeat；G3；作者编辑 | P4；征兆前置 100%，达满后恢复不重复奖励，多队友耗时规则可解释 |
| P6a 局势 | 激活/维护/终态/后果链、FIFO/cooldown、知识持续、恢复命令；G1/G2 | P5；门按各真人投影，终态知识保留，队列与阶段合法收束无死锁 |
| P3 合作切片 | 自由意图/风险预检/真人批准、AI KP/2–3 队友/玩家桌面、epoch预算与operation恢复 | P6a；§32.2 全表，不靠人工改运行数据；仅内部体验证据，public gate 仍受 P6b |
| P6b 联合验收/收束 | stage-close、四门联合、作者诊断、secret E2E、完整分支与故障闭包、正常生产真实模型/真人短局 | P3；首期 K1–K7 都有效，才允许开放标准入口并把 OPEN-01 改 partial；不得称产品全部完成 |
| P7 上下文体验 | 条件 trigger、分层预算优化、来源/注入/降级检视；E14 | P6b；首期原有完整性/预算不变，增量策略有可复算 receipts |
| P8 长局记忆/补丁 | 唯一治理记忆表、按 observer/reliability/lineage 召回、最新 schema 增量、世界补丁导出作者审阅 | P7；跨切点/删除/备份/未知结果恢复；真实 30+ worldTurn 证据；不自动回写 |
| P9 局势生成 | session-owned 模板候选、授权 scope、版本快照/事件/解析、A1–A3、冷却与多样性 | P8；不是修改发行包的模板；实际 schema/来源/预算在该阶段先冻结再实现；不得提前启用未定义的生成入口 |
| P10 音频/完整媒资 | owner/受众/许可、四通道与异步状态、缓存/预取/降级/回放、导出安装 | P6b 后按明确依赖接入；不得与正在修改的记忆/协议热点并写；音频失败不回滚结算 |

实际首期顺序：P1 → P2a → P2b → P2c → P2d → P4 → P5 → P6a → P3 → P6b。P7/P8 有明确先后；P9 依赖 P8；P10 可在其 own schema/协议依赖冻结后单独进行，不能照原稿“P7–P10 任意并行”。同一共享热点必须先独立基础提交、串行整合，Git 无冲突不等于语义兼容。

每个代码单元开工卡必须列：产品/研发或作品生产、S2/S3、入口与用户结果、读源、候选/正式写入、表/JSON remap、世界/媒资 owner、版本与旧入口、调用方/下游、正反例/恢复/验收。阶段接受的具体类型与事件必须闭集且反例完成后才能进入后续；不能因为本文件已有字段名便让模型自己补权限或 owner。

## 32. 验收矩阵、产品完成边界与本轮验证

### 32.1 代码阶段新增的关键反例

原稿 §13 的所有适用用例保留，再补下列专项；文件名属于计划，不是当前存在的测试。首期新增回归统一位于 `tests/regression/R-TTRPGOPEN*-*.test.ts(x)`，不建另一套 tests/unit。

| 测试主题 | 最低必须覆盖 |
|---|---|
| authoring-format / production-path | Settings/Brief 保存刷新、来源/作者确认/开始分别生效；正常界面产出 open，scripted 旧 DAG/锁定不变 |
| narrative-envelope | 无结局/无假 choices 的 open 可验证；其他产品与 scripted 仍拒绝缺结局；generic navigation 不能进 open |
| open-rule-admission | scene=null 的行动合法，非法位置/未授予/不在窗口/无目标拒绝；通用检定不能自造 difficulty/effect |
| actor-approval | 真人批准其 AI 队友；其他真人/AI/未授权 viewer 拒绝；hybrid/多受影响真人；拒绝/撤销/旧 plan stale |
| frozen-authority | invariant 冲突拒绝；初始位置变化/物品转交/社会余额变化合法；自然语言未确认候选不得成为冻结事实 |
| knowledge-discovery | private 发现不让别人获知；合法分享；局势终结后仍知道；新席位不自动获历史秘密；spectator 投影 |
| epoch-budget | 队友执行时间推进但次数不清零；刷新/重复继续不重开预算；repair 计入调用；unknown 阻断重发 |
| operation-recovery | 每个业务事件/后续效果/时间tick/压力/局势/叙述之间注入失败并刷新；重复恢复等价一次完整执行；真实头/step receipt |
| pressure-once | 每个因果只消费一次；满钟重复tick不重复chaos/奖励；暂停/规则询问不推进；无征兆升级不可达 |
| branch-source-lineage | 父/子相同数字序号不混淆；事实/知识/Oracle seed 正确；无后切点数据；未提交候选失效；world hash不变 |
| legacy-raw-state | 旧包/规则/preview/安装/导出/initialState/head/checkpoint 的原hash不变；混合V1/V2及坏hash拒绝 |
| evidence-retention | parse失败前已有原始响应、输入manifest与attempt；未知结果/余额/授权/stale不隐藏重试；恢复候选不二次消费 |
| gate-viewer-and-closure | 他人private出口不使本人G1通过；G2按知识可靠性；合法阶段收束不误死锁；恢复命令是真实事件 |
| entity-effect-materialization | 无模板不能生成机械NPC/地点/物品；合法模板创建后参与规则；效果参数越界/双owner拒绝 |
| lifecycle | 新JSON/side table引用随备份/导入/删除/分支正确重映射；隔离项目A操作不影响B；半提交恢复 |

### 32.2 首期联合用户验收

使用**正常作者生产的作品**，fixture 单独做工程反例。至少 1 真人 + 2–3 AI 队友：选择世界与规则 → 保存/讨论 S2 → 明确开始 → 生产 → 编辑一处候选并局部返修 → 检查/Preview → 发布 → Session Zero → 非按钮行动 → 可理解风险/批准或拒绝 → 规则/通用检定/Oracle 至少覆盖相关路径 → 非玩家介入触发的世界变化及征兆 → 队友有根据的协作 → 下一轮事实/资源/知识持续 → 刷新/失败继续/存档分支 → 阶段收束/续团。

必须留实际 release/sourcePlan/manifest/候选/operation/epoch/效果/时间/knowledge/lineage/receipt。真人至少主动改变一次建议、队友实际执行一次协作、世界一次未由玩家直接介入的变化；不能在浏览器开发工具里修改运行数据。真人短局、真实provider质量与隔离模型E2E分别标明，不互相替代。

### 32.3 长局与产品整体验收

原稿连续 30+ worldTurn 的真实模型长局、Oracle复算/征兆前置100%、事实矛盾和需作者介入基线、回退恢复与一次补丁审阅继续是 OPEN-02 的验收证据。通过后按指标更新能力条目，不凭“用最强模型”跳过。

跑团整个产品完成还须覆盖作者制作/素材修订、角色卡与规则映射、必需媒资与许可、发布/分发/安装、旧档兼容、继续/成长与首批作品的真人体验。公共多人、外部模组导入、商业运营仍独立立项；不能为了“做完善”把范围无限扩到平台，也不能只做 open runtime 就宣布所有缺口已关闭。

### 32.4 本轮文档与未来代码的验证区别

本轮只改施工文档、产品契约、基线/路线图/路由与文档检查器白名单，验证 `npm run check:docs`、`npm run check:roadmap`、`git diff --check`、引用/版本/状态一致性、原稿完整性及 WPS 版本/内容回读。不要为此次文档交付运行完整 CI、coverage、构建、产品 E2E 或修理其他产品。修改检查器仅为登记本文件，不放松任何现有规则。

未来代码阶段仍按 AGENTS：定向正反例 → architecture/required-tables/ai-manual/相关AI登记/TypeScript/相关测试/build → 交付 `npm run ci`；UI/数据恢复/跨产品纵切面运行隔离 `npm run ci:e2e`。旧跑团回归与 4 个既有 ttrpg E2E 保持适用断言不变；新协议新测试不能靠修改旧预期翻绿。上游审计外部阻塞单独报告，不能伪称全绿。

## 33. §21/§22 的追加决策与纠正记录

以下是原 §21 的续记，D0–D17 原文在保留块中完整不动。选择推翻原规则的地方在此明确说明，非被覆盖内容继续有效。

| ID | 问题与备选 | 选择、理由和否决 | 关联 |
|---|---|---|---|
| D18 | V1原位补字段 / 新内容版本+运行投影 | 选版本化V2；保留旧closed schema/hash，否决在解析结果中补字段再验身份 | §25.1/§28.1；修订原D9/D10的衔接但保留显式格式/骰子复用 |
| D19 | 去scene守卫 / 把准入与结算分开 | 选open准入+既有机械算法；否决直接删guard或造假scene，防止越权行动 | §26.1；原§3.1/§7补充 |
| D20 | 世界初值永不变 / 不变量与初值分开 | 选三权威；冻结来源不变但角色可以移动/交换/成长，否决把正常状态变化当Canon矛盾 | §25.3；细化D4/D17 |
| D21 | 确认者必须等于行动者 / 显式授权批准关系 | 选actingActor+approverSeat；仅授权真人批准具体计划，否决AI自批或任意真人代批 | §26.2；替代E3拒绝条件 |
| D22 | 所有预算随worldTurn归零 / 主持epoch独立计费授权 | 选持久epoch；游戏时间不是预算开关，否决通过队友行动/刷新绕额度 | §26.3；替代原§9.4/§16 |
| D23 | 回放等于完整恢复 / operation保存待办及回执 | 选可恢复处理链；reducer纯同步，否决reducer发命令、刷新隐藏重做模型 | §26.4；补充D7 |
| D24 | 实例共享发现数组 / session角色知识权威 | 选knowledge；private与局势终结有确定行为，否决只记录全局已发现 | §27.2；细化D11 |
| D25 | 引用裸序号 / sessionKey+序号及冻结祖先证据 | 选血缘来源；子序号归零不混父来源，否决重标父事件为子事件或丢引用 | §28.3 |
| D26 | P3前无质量门 / 门随owner并联合封板 | 选随模块实现；收束与死锁区分，否决向玩家开放没有基本门的open | §29/§31 |
| D27 | 假ending/choice满足共享图 / open专属只读叙事容器校验 | 选产品分流；保留其他产品图约束，否决全局放宽或假结局 | §29.3；补充D8 |
| D28 | 从文本自动推出硬事实 / 来源候选确认后编译 | 选字段映射+候选确认，否决无证据推断；结构/语义各有验收 | §25.3/§27.3；保留D13但限制其能力声明 |
| D29 | fixture发布即用户路径完成 / 正常作者生产独立验收 | 选两条证据；DAG/Prompt/编辑/返修都必须实际接入，否决后端手写包代替产品 | §30/§32 |
| D30 | 复制旧schema 10→11 / 最新基线N→N+1 | 选串行增量迁移；当前11已含插件表，否决重定义已发布版本 | §28.4；更新D7的数字快照 |
| D31 | 所有Skill输出只有hash / 原始响应先持久化 | 选复用Harness并补缺口；解析错误和unknown可查，否决“注册即充分可恢复” | §26.1/§32.1 |
| D32 | 任意JSON入作者草稿 / 版本化Settings/Brief与真实target | 选闭集、revision及治理采纳，否决把runtime豁免带到作者AI写回 | §25.2/§30 |
| D33 | 原稿删旧文件 / 按用户要求完整保留并撤施工效力 | 选同文件原样保留与明确修订优先级，否决删除WPS旧归档或覆盖其他产品新版文档 | 本入口/§24 |
| D34 | 名称出现就默认阶段启用 / 实现证据与能力gate | 选显式阶段准入、原始协议验证、未完成默认隐藏；未来生成/音频先补各自schema再开入口 | §28.2/§31 |

以下是原 §22 的续记，B1–B7 不改写：

- B8：把“八层分流”当完整闭包，漏了S2、生产任务/Prompt、共享 narrative 强制结局、安装/初始状态与存档解析；纠正为 §23/§30 的实际调用链。
- B9：把旧規则行动可复用误读为可直接无scene调用；当前 guard 验证场景、授予、席位和行动经济；纠正为准入适配后复用算法。
- B10：把原始世界初值冻结等同所有运行状态不得变化；纠正不变量、initial-state与唯一机械owner。
- B11：用“同角色且真人”实现所有确认，导致AI队友无法被批准；纠正明确acting/approver授权关系。
- B12：用worldTurn兼做每队友额度与调用预算归零点，连续AI行动实际可重置额度；纠正持久epoch。
- B13：只有已发生事件可回放，却未保存未完成后续步骤；纠正为operation/因果消费/恢复回执，reducer不做外部副作用。
- B14：认为发现引用是全队已知且依赖active局势；纠正知识按接收者持续保存、合法传播。
- B15：只按序号处理分支/记忆，忽略子序号归零、祖先/seed与跨切点摘要；纠正血缘与全区间边界。
- B16：原稿基线/schema/表数量来自旧快照；当前schema11，STORES_V10已存在。当前数字不作为长期硬编码契约。
- B17：把闭集/禁词/F4当自然语言绝对正确证明；纠正结构门、最小视图和真实语义评测分工。
- B18：宣称首期可玩时只验证fixture，未验证作者真实生成/修订/发布；纠正正常生产链和作品/产品两种生命周期验收。
- B19：为文档登记要求产品完整CI，或依据原稿删除历史记录；纠正本轮纯文档直接验证与原文保留。

## 34. 模型接手说明与选型建议

### 34.1 可直接交给新模型的开工指令

```text
你接手 StoryForge 的跑团产品研发，不是制作一份临时demo，也不是重做全项目。
从仓库读取 AGENTS.md、docs/CONTEXT-ROUTING.md，然后读取现行
docs/roadmap/TTRPG-DEVELOPMENT-PLAN.md 的版本头、§23–§34及当前单元相关原稿。
2.1.0 修订优先于末尾完整保留的2.0.0；不要只执行旧§15或假定聊天背景。
先 git status、fetch origin，确认任务分支与主干，保护其他工作树/浏览器数据。
如果main尚未包含P1，先取得origin/feat/ttrpg-plan-20261012中的文档提交；
不要从不包含现行契约的main盲目施工。P1合入后再统一从最新main建立产品分支。
逐项核对当前能力、schema、旧作品/包/档和前置单元，不按原稿旧行号照搬。
选§31中第一个未完成且前置已满足的单元，只在独立feat/fix/refactor分支施工。
先提交开工卡：入口→读源→候选/正式命令→表与生命周期→下游→正反例。
保留ttrpg产品身份、Work/Release/session owner及只读WorldRelease；不借其他产品合流。
复用现有规则/骰子/账本/Harness/生产服务；新作者候选先登记真实target，运行委托也需可验证授权。
首期零新表；新格式默认隐藏，旧scripted测试和真实发布包/存档不改身份。
按§32做定向、兼容、故障恢复与适用CI/E2E；真实API须用户当前授权与明确预算，fixture不能当真人证据。
报告本单元完成/未完成/阻塞、实际命令结果、分支commit/PR及下一个准入单元。
不要为了测试通过删除约束、改旧测试预期、隐藏重试或把设计文档状态翻绿。
先把一个单元做成可review、可恢复、可验收的增量，不一次执行完所有P阶段。
```

### 34.2 2026-10-12 开发模型建议（有日期的辅助信息）

这是结合本任务风险和官方模型定位的**选型推断**，没有在 StoryForge 上进行同一任务多模型 A/B 实测；不宣称确定的胜率、成本或绝不返工。用户需要的是能在完整仓库中读文件、修改代码、运行测试、查看Git与保留上下文的coding agent环境，单独聊天模型输出代码片段不足以完成任务。实际账户/地区/客户端可用性以当次模型目录为准。

| 模型/环境 | 本任务建议用途 | 起点与限制 |
|---|---|---|
| GPT-6.1 Sol / Codex | 契约已确定后的主要施工：P2至P6、跨文件实现与验证 | high 起步；协议/分支疑难可提高effort。官方将其定位复杂coding/agent工作；不是把一次长上下文塞满就免读关联 |
| GPT-6 Astra / Codex | 地基权限/状态权威/迁移/恢复与关键反例独立审查 | high 起步，明确难例才xhigh；不默认max/ultra。不能代替人类裁决产品语义 |
| Claude Opus 5.5 / Claude Code | 完整施工替代、复杂代码迁移与独立代码审查 | 适合承担高风险阶段；从明确单元/验证合同开始，不用榜单保证本仓验收 |
| Claude Sonnet 5.5 / Claude Code | 清晰局部实现、作者/玩家UI、后续Bug与回归补齐 | 复杂协议/血缘/数据问题升级Opus或独立强模型复核 |
| Gemini 3.8 Flash / Gemini CLI或可读仓库agent；3.1 Pro preview | 实施备选、长仓库阅读、界面与第二视角审查 | 官方模型目录区分稳定Flash和preview Pro；首选先做同一小单元实测，不把“Pro”名称或token窗口当正确性 |
| Kimi K3 / 可读写仓库的Kimi工具 | 中文需求/代码关联阅读、局势作者面与阶段实现备选 | 官方旗舰面向长程coding；先以P2a兼容反例或局部UI单元检验，不默认承担未验证的数据迁移 |
| GLM-5.3 / ZCode | 国内工具环境下的完整施工候选、明确阶段实现 | 官方ZCode围绕该模型的长程coding工作流；同样必须跑本仓验收和独立复核 |
| DeepSeek（官方API模型名 `deepseek-flash`）/ 支持仓库工具的agent | 有明确契约的局部实现与测试、成本敏感的备选 | 官方文档有Codex/agent集成；底层版本以当次目录为准，先小单元试跑再决定是否承担地基，别把旧API别名当独立模型版本 |

具体选择：已有 Codex 环境可用 GPT-6.1 Sol high 做主施工，Astra high 或 Opus 5.5 做独立审查；偏好 Claude Code 可由 Opus 5.5 承担地基/恢复，Sonnet 5.5 承担已确定的局部实现。采用国产模型可先选GLM-5.3/ZCode或Kimi K3，以同一个受控小单元评估一次就决定，不反复让不同模型重做全方案。机械格式/lint小修可用轻量模型，但不能把P2、schema、导入导出/分支恢复整体降档。

官方来源（2026-10-12读取，厂商能力声明与本项目验收不同）：[OpenAI Models](https://learn.chatgpt.com/docs/models)、[Claude Opus 5.5](https://www.anthropic.com/claude-opus-5-5)、[Claude Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5)、[Gemini模型目录](https://ai.google.dev/gemini-api/docs/models)、[Moonshot模型](https://www.moonshot.ai/en)、[GLM-5.3/ZCode](https://zcode.z.ai/en/docs/welcome)、[DeepSeek API](https://api-docs.deepseek.com/)。这里不配置项目生成模型、不创建API key、不改变本机agent设置。

---

## 完整保留：2.0.0 原稿与原决策记录

以下内容逐字保留，仅与 §23–§34 不冲突的条款继续生效。原稿中的版本头、旧基线、待执行状态、删除要求和PR顺序是保留的历史内容，不覆盖现行修订。

<!-- ttrpg-plan-original-v2.0:start -->
# 跑团开发与施工方案

> 版本：2.0.0 · 生效：2026-10-10 · 权威层级：L2
> 仓库落点：`docs/roadmap/TTRPG-DEVELOPMENT-PLAN.md`
> 对应产品：`ttrpg` · 产品契约：`docs/products/TTRPG-AI-KP.md` · 能力基线：`docs/roadmap/CAPABILITY-BASELINE.md`
> 取代：`docs/roadmap/TTRPG-SANDBOX-DEVELOPMENT-PLAN.md`（1.1.0，未跟踪状态，不得提交）与本文件夹内 `跑团沙盒开发与施工方案.md`。同一主题只保留本文件一个现行入口。
> 代码基线：`main@d4201712fe7ebf479c05f1bfba4beb17da1333ca`（2026-10-09 09:08:22Z）。本文引用的全部路径、导出符号与字段名均在该提交上核对过；§3 列出核对结果。
> 2.0.0 相对 1.1.0 的变更：①术语改名，产品形态统一称「跑团」，取消「沙盒即兴」说法；②运行格式字段定名 `runFormat: 'open' | 'scripted'`，取代 `playMode: 'sandbox' | 'module'`；③把压力自驱与作者预设局势纳入首期；④按实测修正 1.1.0 中 11 处路径/符号错误（§3.4）；⑤新增 §20 文档同步改法，给出契约、能力基线、文档权威清单的确切修订内容。

## 0. 本文怎么用

本文是跑团产品的唯一施工依据，面向直接写代码的执行者（人或 Agent）。使用规则：

1. **先读 §1–§3**。不接受「跑团就是剧本杀式闭合流程」的理解；不接受在未核对 §3 代码事实的情况下动手。
2. **按 §15 的 PR 顺序施工**，每个 PR 的交付物、准入条件和验收测试都在该节列明。
3. **§5 的类型定义是契约**。字段名、枚举值、可空性照抄，不自行增删。所有新增类型用 `exact()` 做闭集校验，字段不精确即抛错——这是现有 `src/lib/ttrpg/campaign.ts:23` 与 `src/lib/ttrpg/rule-pack.ts:799` 的既定做法。
4. **凡出现「合理」「适量」「视情况」而没有对应字段、谓词、阈值或布尔条件的地方，视为未完成设计，不得进入施工。**
5. **§21 设计决策、§22 判断偏差与 §1–§20 同等约束力**。推翻某条决策需在 §21 追加新记录并说明理由，不得直接改写旧记录。

| 读者 | 直接读 |
|---|---|
| 评审与决策 | §1 产品定义、§2 范围、§15 施工节奏、§17 风险 |
| 规则与运行时开发 | §3 基线、§5 数据契约、§6 事件与状态机（含 §6.6 命令入口）、§7 分流矩阵、§14 schema |
| Agent / Prompt 开发 | §9 Skill 层、§10 上下文、§16 预算 |
| 前端与交互 | §11 UI |
| 内容与作者工具 | §12 首批内容池、§5.7 压力、§5.8 局势 |
| QA | §8 质量门、§13 测试矩阵、§6.5 失败日志、§18 完成证据 |
| 数据治理 | §14 三注册表与 schema |
| 文档维护 | §20 需要同步修订的文档 |

## 1. 产品定义与术语

### 1.1 跑团是什么

跑团是由主持人（KP/GM）运行一个世界的游玩形态。主持人做三件事：

1. **维持世界运行**：世界按自身规则演化，不以玩家触发为前提。
2. **保持角色状态**：数值、资源、位置、持有物、关系、已知信息在全程保持一致且可追溯。
3. **按角色行动演化故事**：玩家可声明任何行动，主持人在规则与信息边界内合法裁定，结果成为后续事实。

本产品的目标是让 AI 担任这个主持人。这是跑团的**唯一**运行方式，不是某种可选模式。

### 1.2 改名决定与术语表

1.1.0 把上述形态称为「沙盒即兴」（`playMode='sandbox'`），把现有的闭合场景图实现称为「冻结模组局」（`playMode='module'`）。该命名有两个问题：

- 「沙盒」在跑团语境里指「无主线、玩家自定目标」的一种玩法，范围窄于本产品要做的事；
- 「模组」被错误等同于闭合流程。真实的跑团模组同样是「作者准备局势与素材」，玩家照样自由行动。现有实现之所以像剧本杀，是因为它把模组实现成了闭合场景图加固定结局，这是实现方式的限制，不是模组的定义。

因此 2.0.0 统一术语：

| 2.0.0 术语 | 含义 | 1.1.0 旧称 |
|---|---|---|
| 跑团 | 本产品形态本身，即 §1.1 的三件事 | 沙盒即兴 / sandbox |
| `runFormat: 'open'` | 跑团的标准运行格式：作者冻结世界引用、局势层与规则，运行时生成局势、裁定未预写行动、累积会话事实，无闭合结局 | `playMode: 'sandbox'` |
| `runFormat: 'scripted'` | 兼容运行格式：闭合场景图 + 闭合结局集合，保留既有穷举可达性校验。仅为不回归已交付作品（《雾港：最后一盏灯》）而存在 | `playMode: 'module'` |
| 作者局势层 | 作者在发布前冻结的 fronts、clocks、canon 谓词、NPC 动机、开局局势、Session Zero | 同名 |
| 会话事实层 | 运行时由 Oracle、AI 即兴、玩家声明或规则结算产生的新事实，归 session | 同名 |
| Oracle | 规则内核授权的随机裁定机制，用于规则未覆盖处 | 同名 |

**强制约束**：代码标识统一使用 `runFormat`、`'open'`、`'scripted'`。不得新增 `playMode` 标识，也不得把 `sandbox`、`module` 用作运行格式标识。`sandbox` 一词在代码中只允许继续存在于 §3.3 所述的既有战役结构枚举中，二者含义不同、不得互相复用。产品界面与面向用户的文案只说「跑团」，不出现「沙盒」。

注意：仓库中已存在 `situationalModifier`（`submitTtrpgActionIntentV2` 的参数）与其他产品的 `openingSituation*` 字段，与本方案的 `situationTemplates` / `situations` 不同语义、不得混用。新增标识一律带 `Ttrpg` 前缀或 `open` 限定词。

### 1.3 `open` 与 `scripted` 的关系

```text
scripted（兼容格式，不再扩展）
  冻结 CampaignPack 的闭合场景图 → 穷举可达性校验 → 闭合结局集合

open（标准格式，本方案主线）
  冻结世界事实 + 作者局势层（fronts / clocks / NPC 动机 / 开局局势）
    → 运行时生成局势 + Oracle 裁定未预写处
    → 会话事实层累积
    → 无闭合结局集合，以阶段收束代替
```

二者共用规则内核、骰子、信息边界、事件流、媒资与发布链路，只在内容解析、发布校验、生产编译、发布质量门、运行初始化、命令路由、上下文投影和完成语义**八层**分流（§7.1）。`scripted` 的现有行为**必须零回归**。

### 1.4 边界

- 全部改动留在 `src/lib/ttrpg/`、`src/components/ttrpg/`、`src/pages` 的跑团入口、`src/stores` 的跑团 store。
- 不借用角色聊天、AI 小镇、文字开放世界、文字冒险、AVG 的产品逻辑与运行面。能力相似不等于产品可合并（§22 B3）。
- 确需共用的通用机制走中立共享设施，并作为独立基础增量单独审查（`src/lib/product/`、`src/lib/product-production/`、`src/lib/registry/`、`src/lib/db/`）。
- 数据 owner：跑团 Work / ProductRelease / ProductRuntimeSession。世界引擎只提供不可变语义，运行不回写 `WorldRelease`。
- 媒资 owner：发布媒资绑定 ProductRelease，运行中新生成媒资绑定 ProductRuntimeSession。
- 非范围见 §19。

## 2. 两条目标线与首期范围

### 2.1 两条同时生效的目标线

本方案不是「先做临时 MVP，将来重做跑团」，也不是「把全部能力做完才有可玩交付」。施工必须同时维护两条线：

| 目标线 | 当前要求 | 完成判据 |
|---|---|---|
| 完整架构线 | 现在就建立可扩展的状态、事件、权限、事实、局势、压力、回放、分支与发布边界；后续能力必须接入同一套运行模型 | 新增能力不另建第二套 session、事实权威、AI 上下文或存档体系；`open` 与 `scripted` 可独立分流且互不回归 |
| 首期体验线 | 在完整架构上先开放一个小而完整的「真人玩家 + AI KP + AI 队友」合作跑团切片，且世界会自己动 | 玩家能进入一局 `open` 跑团，用自然语言提出行动，获得风险说明，完成规则或 Oracle 裁定，看到 AI 队友协作、压力推进与征兆，并刷新、存档、继续和分支恢复 |

首期允许限制世界规模、局势模板数量和 Oracle 类型，但**不得**退回只支持静态场景按钮的临时路径。它必须使用本方案规定的意图协议、worldTurn、事实来源、事件回放和信息投影协议。

### 2.2 首期必须包含的七件事

1 名真人 + 2–3 名 AI 队友 + AI KP，在一个 `open` 跑团中完成一段连续合作局。首期范围由下表定义，少一项即视为首期未完成。能力编号用 `K` 前缀，以免与 §5.6 的事实门 F1–F4 混淆：

| # | 能力 | 对应 §1.1 的哪件事 | 最小实现 |
|---|---|---|---|
| K1 | 自由行动意图与风险预检 | 按行动演化故事 | 自然语言 → 目标/方法/对象 → 风险、代价、不可逆性 → 玩家确认 |
| K2 | 裁定路由 | 按行动演化故事 | 规则内行动 / 通用检定 / 受限 Oracle / 无需裁定 四条路径 |
| K3 | 会话事实层 | 保持角色状态 | 新事实落账、四门校验、按受众投影、可被下一轮引用 |
| K4 | 压力自驱 | 维持世界运行 | clocks 按 worldTurn 自行推进；fronts 升级前必须先投征兆 |
| K5 | 作者预设局势 | 维持世界运行 | 作者在 CampaignPack 中冻结至少 1 个开局局势；运行时可消解，可因压力升级而产生新局势实例 |
| K6 | AI 队友协作 | 按行动演化故事 | 队友按自身目标与观察提出行动，走同一意图/预检/结算链，不替玩家做重大决定 |
| K7 | 回放与恢复 | 保持角色状态 | 刷新、继续、检查点分支后，玩家可见状态与 AI 队友记忆同分支一致 |

**K4、K5 是 2.0.0 相对 1.1.0 扩大的首期范围**。理由：「世界会自己动」是 §1.1 的第一件事，缺它的切片不能称为跑团。1.1.0 把压力与局势排在首期之后，是范围划分错误。

首期的局势实例化路径限定为 §5.8 运行时约束 1 的全部三条（开局、front 升级、后果链），但**模板一律来自作者冻结内容**；完全由模型生成新模板（含反套路检查）留到 P9。

### 2.3 首期不承诺的内容

完整媒资与音频、公共多人服务、任意外部规则书、模型自由生成局势模板、长局 30 个 worldTurn 以上证据、世界补丁导出审阅，以及面向全部 Build 产物的通用逐字段可视化编辑器（§11.4 的局势模板、Oracle 表、局势层三个**专用**作者面板属首期范围，不受此条限制）。这些能力的 owner、事件入口、权限和扩展点必须在首期架构中预留（§5、§6），但不在首期交付。

### 2.4 首期玩家路径

```text
选择世界与 runFormat='open' → 配置规则包、席位、安全边界
→ 冻结 Brief / SourcePlan / 明确开始授权 → 生产 → 检查 → 发布 ProductRelease
→ 选择玩家角色与 2–3 名 AI 队友 → Session Zero（村规、安全工具、AI 授权范围）
→ AI KP 描述当前世界、已知线索与活跃局势
→ 玩家用自然语言提出目标与方法
→ 系统解析意图并展示风险、代价、不可逆性
→ 玩家确认；规则行动 / 通用检定 / 受限 Oracle / 无需裁定 四选一
→ 权威结算资源、位置、线索、关系或会话事实
→ worldTurn 推进 → clocks 自驱 → 征兆投放 → front 升级（有征兆才允许）
→ 局势维护（实例化 / 消解）
→ AI 队友按自身目标、所知信息和轮次行动
→ KP 依据正式结果继续叙述
→ 存档、刷新、继续或从检查点创建分支
```

## 3. 当前代码基线（已核对事实）

本节是 2026-10-09 在 `main@d4201712` 上逐项核对的结果。施工前必须以本节为准，不得沿用 1.1.0 的描述。

### 3.1 可直接复用，不重写

| 领域 | 位置 | 复用点（已核对） |
|---|---|---|
| 规则包 | `src/lib/ttrpg/rule-pack.ts`、`rule-pack-library.ts` | `parseRulePackV1`（:789）对 `RulePackV1` 做 `exact()` 闭集校验，顶层 **21** 个字段（:799 列表与 `types/ttrpg-product.ts:714` 接口一致）；`FrozenRulePackV1 = { content, contentHash }`；`validated` 状态要求 `license.commercialUse` 与非空 `attribution`（`rule-pack-library.ts:20`） |
| 内置规则 | `storyforge-rule-pack.ts`、`rank-lite-rule-pack.ts`、`d20-fantasy-rule-pack.ts`、`d100-investigation-rule-pack.ts` | 四套可直接挂 Oracle 表 |
| 骰子 | `src/lib/ttrpg/dice.ts` | `sampleTtrpgDiceWithSha256V2`（:105，返回 `{ dice, trace }`）、`sampleTtrpgDiceFromUint32V2`（:56）、`TtrpgDiceRollTraceV2`（`types/ttrpg-product.ts:62`，字段恰为 `algorithm`/`sides`/`requestedDice`/`consumedSamples`/`rejectedSamples`）、uint32 拒绝采样 |
| 确定性掷骰入口 | `src/lib/ttrpg/rule-pack.ts:1713` | `resolveRulePackDiceModelV1({ rulePack, diceModelKey, seed, nonce, modifier? })` → `RuleDiceResolutionV1`，含 `dice`、`keptDice`、`total`、`rollTrace`、`seedCommitment`、`nonce`、`proofHash`、`diceModelKey`、`modifier` |
| 掷骰复算 | `src/lib/ttrpg/rule-pack.ts:1729` | `verifyRulePackDiceResolutionV2` 已存在：比对 `seedCommitment`、`nonce`，并用 `hashProductProductionValueV2` 比对重算结果。**Oracle 复算直接复用它，不新造复算器** |
| 裁定 | `src/lib/ttrpg/resolution.ts` | `resolveTtrpgResolutionV2`、`TtrpgDegreeV2`、对抗检定 |
| 规则行动提交 | `src/lib/ttrpg/runtime-commands.ts:2869` | `resolveTtrpgRuleAction`（既有命名，未带版本后缀，沿用原名调用，不改签名） |
| 效果计划提交 | `src/lib/ttrpg/runtime-commands.ts:1734` | `commitTtrpgEffectPlanV2`（E8 的 `onCompleteEffectPlanRef`、局势后果、front 升级效果都经它提交，不在 `open` 事件内直接结算） |
| 结算 | `effect-plan.ts`、`effect-runtime.ts`、`item-ledger.ts`、`ability-ledger.ts`、`action-economy.ts`、`advancement.ts` | `idempotencyKey` 幂等；`TtrpgEffectPlanV2`（`types/ttrpg-product.ts:241`，含 `planKey`/`degree`/`ruleRef`/`reason`/`audience`/`idempotencyKey`/`status`/`effects`/`sourceEventId`）；`TtrpgDegreeV2`（:70）、`TtrpgEffectAudienceV2`（:142）、`TtrpgEffectPrimitiveV2`（:145）；`TtrpgEffectLedgerStateV2`（:289）共 9 字段：`schema`、`version`、`appliedIdempotencyKeys`、`advancementBalances`、`socialBalances`、`storyClocks`、`storyFacts`、`pendingChoices`、`entries` |
| 故事时钟（既有，仅 `scripted` 使用） | `effect-runtime.ts:325` 起 `clock.advance` 分支 | 键为 `${targetRef}:${storyKey}`；校验 `clockCatalog` 是否含该 clock；自动夹到 `clock.maximum`；达上限时写 `storyFacts['clock-complete:<clockKey>']`。**`open` 下禁用该效果**，压力时钟改由 E8 推进，见 §5.7 硬约束 7 |
| 事件溯源 | `runtime-event-reducer.ts`（`applyTtrpgRuntimeEventV1`，:46）、`runtime-state.ts`、`runtime-branch.ts`（`cloneTtrpgRuntimeBranchExtensionsV1`，:15）；共享回放在 `src/lib/product/runtime-core.ts` | 相同 `commandId` 且内容一致返回既有事件。共享入口在 `src/lib/product/runtime-product-adapters.ts:93`：`event.type.startsWith('ttrpg.')` 时派发到跑团 reducer |
| 事件类型闭集 | `src/lib/types/product-runtime.ts:1155` `PRODUCT_RUNTIME_EVENT_TYPES`（当前含 29 个 `ttrpg.*` 条目）；`ProductRuntimeEventType` 由其派生（:1290） | **这是唯一权威闭集。** `runtime-commands.ts:28` 的 `FormalTtrpgEventType` 只是 `Extract<ProductRuntimeEventType, …>` 的模块私有过滤器（未 export，26 项）。新增事件必须先加入 `PRODUCT_RUNTIME_EVENT_TYPES`，再加入该 Extract 列表 |
| 运行时状态 | `src/lib/types/product-runtime.ts:226` `TtrpgRuntimeProductStateV1` | 含 `sessionZero`、`safety`、`sceneKeys`、`clueCatalog`、`clockCatalog`、`actionEconomy`、`inventory`、`effectLedger`、`endingCatalog`、`ending`、`tabletop`、`media` 等；**无** `openRun` |
| 自由文本入口 | `src/lib/ttrpg/runtime-commands.ts:2260` | `submitTtrpgActionIntentV2` 已接收 `rawInput`（≤10000 字符）、可选 `actionKey`/`targetKey`/`goal`/`method`（后两者 ≤2000）、`difficulty`/`situationalModifier`/`rollVisibility`、`submittedBy: { role, viewerKey }`；并核对 `baseSequence`/`baseStateHash` |
| 意图分类 | `src/lib/ttrpg/runtime-commands.ts:2026` | `classifyTtrpgSubmittedIntentV2` 已存在 |
| 冻结运行源 | `src/lib/ttrpg/runtime-commands.ts:57` `verifyFormalTtrpgSource`（**模块私有，未 export**，内部调用点 :196/:779/:2325）；`runtime-content.ts` `loadTtrpgRuntimeContentV1`（已 export） | session 必须有唯一冻结运行源（Release 或 Build Preview 二者之一），`packageHash === session.runtimeSourceHash`。`open` 命令需要同样校验时，应在该文件内复用该私有函数或将其提取为导出函数（提取属共享热点，单独成 commit） |
| 完成命令 | `src/lib/ttrpg/runtime-commands.ts:4198` | `completeTtrpgCampaignEnding`（`scripted` 专用，`open` 不复用） |
| 夹具判定 | `src/lib/ttrpg/campaign.ts:665` | `isTtrpgFixtureCampaignV1`（按 `tags` 含 `fixture-only` 判定） |
| 信息边界 | `information-boundary.ts:2`（`assertTtrpgNoRestrictedTextV1`，NFKC 归一 + 去标点后匹配）、`viewer-projection.ts:17`（`TtrpgViewerRoleV1 = 'player' \| 'gm' \| 'spectator'`）、`private-guidance.ts` | 按接收者投影、私密指引、禁词检查；`TtrpgRuntimeMediaAudienceV1 = 'public' \| 'party' \| 'private' \| 'gm-only'` |
| 主持调度 | `kp-coordinator.ts:33` `runTtrpgKpCycleV1` | 阶段 `TtrpgKpPhaseV1`（:15）= `'opening' \| 'directing' \| 'narrating' \| 'npc' \| 'companion'`；`maxAiActions` 1–8 默认 4（:45）；循环守卫 `3 * maximum + 6`（:54）；终态含 `ended`/`paused`/`setup-required`/`human-response`/`choice`/`human-turn`/`vacant`/`confirmation`/`budget-limit`/`busy`；用 `navigator.locks.request` 加会话锁（:120） |
| AI 队友回合 | `player-coordinator.ts:52` `coordinateTtrpgAiPlayerEpochV1`；`runtime-commands.ts:3564` `commitTtrpgPlayerActionFromHarnessV1` | AI PC 已产出自由形式意图候选，经 checkpoint + `candidateHash` 提交；`hybrid` 席位需真人确认 |
| 候选协议 | `decision-harness.ts:42` `TtrpgDecisionProtocolV1`、`:18` `TtrpgDecisionCandidateV1` | 仅 `SyntaxError` 允许一次修复重试（:142）；语义/越权错误不重试；`createContextManifestFromAssemblyV1`（:120）记录 manifest |
| 上下文完整性 | `prompt-context.ts:13` `assertTtrpgCompleteContextV1` | 被预算截断的上下文不得发送 |
| 角色分层上下文 | `gm-context.ts`、`narrator-context.ts`、`npc-context.ts`、`player-context.ts`、`director-context.ts`、`private-guidance.ts` | 六个已登记读源的实现分布在这六个文件中（§10.1） |
| 内容契约 | `campaign.ts`、`src/lib/types/ttrpg-product.ts:1052` | `TtrpgCampaignContentV1` 顶层 30 字段，与 `campaign.ts:132` 的 `rootFields` 列表一一对应；已含 `bible`（含 `canonInvariants: string[]`）、`clocks`、`fronts`、`secrets`、`informationPolicy`、`sessionZero` |
| 生产与发布 | `production-compiler.ts`（`sourceCatalog` 入参见 :107）、`src/lib/product-production/product-quality.ts`、`runtime-package.ts`、`src/lib/product/releases.ts`、`runtime-instances.ts` | Production → Build → ProductRelease → ProductRuntimeSession 全链 |
| 世界出口 | `src/lib/product/world-requirement-adapters.ts:157` | `TTRPG_WORLD_REQUIREMENT_ADAPTER_V1` 已存在并登记在适配器表（:168） |
| 创作者包 | `creator-sdk.ts` | ECDSA-P256-SHA256 签名、trust manifest、install receipt、data-only、16MB 上限、`compatibility.maximumRuntimeProtocol` 当前为 1 |
| 媒资 | `media-contract.ts`、`runtime-media.ts` | slots + audience + `runtimePolicy`、队列与 lease、按受众过滤、prompt 不外泄 |
| 桌面 | `tabletop.ts` | 网格测距 |
| 联机 | `src/lib/online/room-authority.ts`、`room-gateway.ts`、`realtime-hub.ts`、`verifiable-dice.ts`、`transactional-persistence.ts` | 权威房间与可验证骰代码就绪，缺部署 |

### 3.2 跑团域缺口（`open` 必须新建）

| 缺口 | 核对结果 |
|---|---|
| 运行格式字段 | `src/` 内不存在名为 `playMode`、`runFormat`、`oracle`、`worldTurn`、`telegraph` 的标识，也不存在名为 `situation` 的标识。注意已存在同根词：`situationalModifier`（跑团检定参数，71 处）与其他产品的 `openingSituation*`（100 处），与本方案语义无关 |
| 游戏时间 | 只有全局事件序号（`ProductRuntimeState.lastSequence`，`product-runtime.ts:1117`）与战斗内 `actionEconomy.round`（:196），没有游戏回合计数 |
| 冻结事实索引 | 世界数据仅在生产编译期以 `sourceCatalog` 形态进入；运行时无可查询谓词索引 |
| 关系权威 | 关系散落在实体 `attributes` 与 `effectLedger.socialBalances`，没有「关系等级」的单一 owner。**本方案不新建关系等级 owner**：凡需要「关系层级」的地方（如 `oracle.yesno.npc-cooperates` 档位映射、`relationship` 类谓词）一律读 `effectLedger.socialBalances` 的数值，并由规则包声明显式数值分段（§12.1）。谓词集合中因此不提供 `relationship-tier`，只提供 `resource-at-least` 式的数值比较 |
| 效果计划引用 | `TtrpgEffectPlanV2` 是运行期结构，CampaignPack 中**没有**可被 `effectPlanRef` 指向的冻结计划容器，须新增 `effectPlanTemplates`（§5.1） |
| 会话事实层 | 只有 `effectLedger.storyFacts: Record<string, string \| number \| boolean \| null>`，没有来源、受众、supersede、矛盾校验 |
| 压力自驱 | `TtrpgCampaignClockV1.advanceTriggers[]` 只有 `sceneKey`/`actionKey` 两种触发，没有状态谓词与自驱；`TtrpgCampaignFrontV1` 只有 `escalation: string[]` 与 `defeatConditions: string[]` 两个文本数组，没有结构化升级阶段与征兆 |
| 单元测试目录 | **不存在 `tests/unit/`**。现行惯例是 `tests/regression/R-<区域><序号>-<名称>.test.ts`。跑团相关回归共 23 个文件：21 个 `R-TTRPG*`，另有 `R-CREATORSDK1-ttrpg-package.test.ts` 与 `R-HARNESS-RUNTIME3-ttrpg-skills.test.ts`（后者是现有 5 个 Skill 中 3 个的 `regressionTests` 目标）。`tests/e2e/` 现有 4 个 `ttrpg-*.spec.ts`。`vitest.config.ts:28` 的 include 为 `tests/**/*.test.ts(x)` 与 `src/**/*.test.ts(x)` |
| 既有事实谓词注册表 | `src/lib/registry/fact-predicate-registry.ts` 的 `FACT_PREDICATE_REGISTRY` 服务长篇 Canon，当前零跑团引用。**本方案的受控谓词表（§5.6）与它互不干涉**：跑团谓词随规则包冻结、作用于 session，不注册进该表，也不读它。若未来要统一，须单独立项 |

### 3.3 `scripted` 的硬性闭合约束（分流必须覆盖）

以下代码当前**无条件**要求闭合场景图与结局，`open` 要能发布就必须按 `runFormat` 分流，仅改 `campaign.ts` 不足：

| 位置 | 约束 |
|---|---|
| `campaign.ts:121` `parseTtrpgCampaignContentV1` | 顶层 `exact()` 字段表（:132 起 30 项）写死；新增字段必须同步该表 |
| `campaign.ts:574` `validateTtrpgCampaignForPublicationV1` | 从 `openingSceneKey` BFS 求 `reachableSceneKeys`；`unreachableSceneKeys`、`unreachableEndingKeys`、`deadEndSceneKeys` 非空即 `errors`；五个 counterexample（`direct`/`failed-checks`/`missed-first-path`/`npc-unavailable`/`split-party`）任一不过即 `errors` |
| `src/lib/product-production/product-quality.ts:52` | `product.narrative.endings` 对 `ttrpg` 要求 `endingCount >= 2` |
| 同文件 :57 起 | 6 个跑团门：`product.ttrpg.rules`、`product.ttrpg.campaign-loop`（场景/结局/任务/玩家数下限）、`product.ttrpg.clue-redundancy`（必需线索 ≥1 且每条 ≥2 条发现路径）、`product.ttrpg.safety-and-tabletop`（同意清单 ≥3、暂停信号、tabletop 非空且每个场景都有地图）、`product.ttrpg.campaign-bible-and-pressure`（bible 且 clocks/fronts/secrets 均 >0）、`product.ttrpg.counterexample-replay` |
| `runtime.ts:29` `createInitialTtrpgProductStateV1` | 以 `openingSceneKey`、静态 scene/clue/ending catalog 建初始状态 |
| 战役结构枚举 | `campaign-proposal.ts:52` 与 `authoring-contract.ts` 的 `linear \| branching \| node-based \| sandbox` 只表示战役结构，**不进入** `TtrpgCampaignContentV1`，与 `runFormat` 无关，不得复用或覆盖 |

### 3.4 1.1.0 中需要修正的描述

施工时按右列为准：

| # | 1.1.0 的说法 | 实测 |
|---|---|---|
| 1 | `runtime-instances.ts` 在跑团域 | 在 `src/lib/product/runtime-instances.ts` |
| 2 | `product-quality.ts` 在跑团域 | 在 `src/lib/product-production/product-quality.ts` |
| 3 | 新增测试放 `tests/unit/ttrpg/` | 无 `tests/unit/`；统一用 `tests/regression/R-*.test.ts` |
| 4 | `TtrpgDiceRollTraceV2` 不记录实际骰值，需另造 Oracle 复算回执 | 实际骰值由 `RuleDiceResolutionV1.dice/keptDice` 记录并进事件 payload；`verifyRulePackDiceResolutionV2` 已是复算器。Oracle 回执只需补 Oracle 侧参数（§5.9） |
| 5 | 需要新建「自由行动入口」 | `submitTtrpgActionIntentV2` 已接收自由文本，扩展它即可 |
| 6 | 跑团缺少 world requirement adapter | `TTRPG_WORLD_REQUIREMENT_ADAPTER_V1` 已存在 |
| 7 | `campaign.ts` 的 `clocks[].advanceTriggers[].condition` 字段已存在 | 不存在，须新增 |
| 8 | `fronts[].escalationStages`、`telegraph`、`defeatPredicates` 为「扩展」 | 均为全新字段 |
| 9 | schema 版本 10 → 11 为本方案必需 | 首期不需要新表（§14.3），schema 保持 10；记忆表留到后续阶段再升版 |
| 10 | `FIELD_REGISTRY` 需为跑团新增字段 | 首期运行时候选不走通用 `adopt()`，不新增字段（§14.2） |
| 11 | 契约已升到 1.1.0、基线已加 SBX 条目、权威清单已登记 | `main` 上契约仍为 1.0.1、基线 2.2.1、文档权威 2.4.0，三者均无跑团新形态内容。§20 给出确切改法 |
| 12 | 事件只需加入 `FormalTtrpgEventType` | 该类型是模块私有 `Extract`；权威闭集是 `product-runtime.ts:1155` 的 `PRODUCT_RUNTIME_EVENT_TYPES`，必须先加那里 |
| 13 | `verifyFormalTtrpgSource` 可直接复用 | 它未 export，仅 `runtime-commands.ts` 内部可用 |
| 14 | `RulePackV1` 顶层 22 字段 | 实为 21 字段；加 `oracles` 后为 22 |
| 15 | `sampleTtrpgDiceWithSha256V2` 在 `dice.ts:60` | 实为 `:105`；`:56` 是另一个函数 `sampleTtrpgDiceFromUint32V2` |

### 3.5 本方案新增模块

```text
src/lib/ttrpg/
├─ run-format.ts          runFormat 判定、分流守卫、旧包兼容投影
├─ world-time.ts          worldTurn 推进规则与非游戏内行动判定
├─ frozen-facts.ts        WorldRelease → 冻结谓词索引的确定性编译与读取
├─ predicate.ts           TtrpgPredicateV1 纯函数求值器
├─ open-intent.ts         自然语言目标/方法/风险预检与裁定路由
├─ session-facts.ts       会话事实层：落账、四门校验、supersede、补丁候选
├─ oracle.ts              Oracle 裁定：是否/含义/事件表、混乱因子、回执
├─ pressure-runtime.ts    clocks/fronts 自驱、征兆投放、defeat 判定
├─ situation-engine.ts    局势实例化、介入点、消解与后果传播
├─ open-gates.ts          open 四门运行时质量门、发布期静态门、失败日志
├─ context-trigger.ts     运行时条件注入（P7）
├─ context-budget.ts      确定性预算装配与回执（P7）
└─ narrative-memory.ts    记忆分层、相关性召回、回退重算（P8）
```

每个模块的导出与调用方（**实现时以此为契约，不得增删导出面**）：

| 模块 | 导出 | 调用方 | 阶段 |
|---|---|---|---|
| `run-format.ts` | `resolveTtrpgRunFormatV1`、`assertTtrpgOpenOnlyV1`、`assertTtrpgScriptedOnlyV1`、`projectLegacyTtrpgCampaignV1`、`projectLegacyTtrpgRulePackV1` | `campaign.ts`、`runtime.ts`、`runtime-commands.ts`、`production-compiler.ts`、`product-quality.ts`、各 context 模块 | P2 |
| `world-time.ts` | `canAdvanceTtrpgWorldTurnV1`、`advanceTtrpgWorldTimeV1` | 仅 `runtime-event-reducer.ts` | P2 |
| `frozen-facts.ts` | `compileTtrpgFrozenWorldPredicateIndexV1`、`parseTtrpgFrozenWorldPredicateIndexV1`、`lookupTtrpgFrozenWorldPredicateV1` | `production-compiler.ts`（编译期）、`predicate.ts`、`session-facts.ts` | P2 |
| `predicate.ts` | `parseTtrpgPredicateV1`、`evaluateTtrpgPredicateV1` | `campaign.ts`、`pressure-runtime.ts`、`situation-engine.ts`、`session-facts.ts`、`open-gates.ts`、`open-intent.ts` | P2 |
| `open-intent.ts` | `parseTtrpgOpenIntentV1`、`routeTtrpgOpenIntentV1` | `runtime-commands.ts`（`submitTtrpgActionIntentV2` 扩展） | P3 |
| `session-facts.ts` | `parseTtrpgSessionFactV1`、`assertTtrpgSessionFactGatesV1`、`projectTtrpgSessionFactsV1`、`buildTtrpgWorldPatchCandidateV1`(P8) | `runtime-event-reducer.ts`、`open-gates.ts`、各 context 模块 | P4 / P8 |
| `oracle.ts` | `parseTtrpgOracleTableV1`、`selectTtrpgOracleEntryIndexV1`、`resolveTtrpgOracleV1`、`verifyTtrpgOracleOutcomeV1`、`advanceTtrpgChaosV1` | `rule-pack.ts`（解析）、`runtime-commands.ts`、`runtime-event-reducer.ts` | P2（`parseTtrpgOracleTableV1`，`rule-pack.ts` 的 `oracles` 字段需要它）/ P4（其余） |
| `pressure-runtime.ts` | `evaluateTtrpgPressureTickV1`、`assertTtrpgTelegraphLeadV1` | `runtime-commands.ts`（主持循环 ⑨）、`runtime-event-reducer.ts`（E10 守卫） | P5 |
| `situation-engine.ts` | `parseTtrpgSituationTemplateV1`、`instantiateTtrpgSituationV1`、`evaluateTtrpgSituationProgressV1`、`evaluateTtrpgSituationMaintenanceV1`、`assertTtrpgSituationInstanceGatesV1` | `campaign.ts`、`runtime-commands.ts`（⑩）、`runtime-event-reducer.ts` | P2（解析、实例化与实例门）/ P6a（进展与维护） |
| `open-gates.ts` | `evaluateTtrpgOpenRuntimeGatesV1`、`assertTtrpgOpenPublicationGatesV1`、`recordTtrpgOpenFailureV1`、`parseTtrpgOpenFailureLogV1` | 运行时门由主持循环 ⑪ 调用并经 E17 提交；发布门由 `campaign.ts`（`validateTtrpgCampaignForPublicationV1` 的 `open` 分支）与 `product-quality.ts` 共同调用；失败日志经 E18 提交 | P2（发布门与失败日志）/ P6b（运行时四门） |
| `context-trigger.ts` | `parseTtrpgContextTriggerV1`、`selectTtrpgContextInjectionsV1` | `prompt-context.ts` | P7 |
| `context-budget.ts` | `assembleTtrpgContextWithBudgetV1`、`parseTtrpgContextBudgetReceiptV1` | `prompt-context.ts`、各 Skill harness | P7 |
| `narrative-memory.ts` | `parseTtrpgNarrativeMemoryV1`、`recordTtrpgNarrativeMemoryV1`、`recallTtrpgNarrativeMemoryV1`、`markTtrpgNarrativeMemoryStaleV1` | `runtime-event-reducer.ts`、`runtime-branch.ts`、`ttrpgOpenMemory` 读源 | P8 |

**`situation-engine.ts` 的解析器与实例门必须在 P2 交付**，因为 P2 的开局局势实例化（E1 + E11）就要通过门；局势维护（到期、消解、后果链）在 P6。

模块关系：

```text
玩家输入 ──┐
           ├─→ open-intent ──→ predicate（前置校验）
AI 队友 ───┘                        │
                                    ├──→ oracle（未预写处裁定）
                                    └──→ resolution + dice（既有，规则内检定）
                                                 │
                                                 ▼
                                   effect-plan / effect-runtime（既有，权威提交）
                                                 │
                               ┌─────────────────┼─────────────────┐
                               ▼                 ▼                 ▼
                       session-facts      pressure-runtime    situation-engine
                               │                 │                 │
                               └────────→ open-gates ←─────────────┘
                                                 │
                                                 ▼
                              viewer-projection（既有）→ 按受众表达 → 媒资派发
```

**数据落点原则：优先用事件 + 派生状态，不轻易新增表。** 首期零新表。机械状态继续归既有账本；会话事实不得与物品、位置、时钟、成长账本形成第二套权威（§5.10）。

## 4. 三层事实与权威分层

跑团的一致性建立在「谁对哪类状态有最终话语权」上。全部事实分三层，上位层不可被下位层覆盖：

| 层 | 内容 | 来源 | 可变性 |
|---|---|---|---|
| L1 冻结世界事实 | 来自 `WorldRelease` 的世界设定，经 `TtrpgFrozenWorldPredicateIndexV1` 编译为可查询谓词 | 发布时冻结 | 运行期只读，唯一上位权威 |
| L2 作者局势层 | CampaignPack 的 `fronts`、`clocks`、`canonInvariantPredicates`、`situationTemplates`、`openingSituationKeys`、`effectPlanTemplates`、`sessionZero`；RulePack 的 `oracles` | 发布时冻结 | 运行期只读 |
| L3 会话即兴层 | 运行时由 Oracle、AI 即兴、玩家声明或规则结算产生的新事实 | `ttrpg.fact.asserted` 事件 | 可新增、可 supersede、可因回退失效；**不回写 WorldRelease** |

一局结束可导出世界补丁候选，**仅作为作者审阅入口**，须作者显式确认后才可升级为新的世界版本内容。导出功能不在首期。

模型输出在任何层都只能先成为候选，经作用域、规则、版本和信息边界校验后由内核提交。这是上位约束，不得放宽。

## 5. 数据契约

所有新增类型沿用既有命名风格：`Ttrpg` 前缀 + `V1` 后缀，字段 camelCase，key 类字段遵循既有正则 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`（`campaign.ts:12` 的 `KEY`），解析函数用 `exact()` 做闭集校验，字段不精确即抛错。

### 5.1 `runFormat` 与 CampaignPack 扩展

`TtrpgCampaignContentV1` 新增 7 个字段，顶层字段数 30 → 37。`campaign.ts:132` 的 `rootFields` 表必须同步加入这 7 项，否则 `exact()` 直接抛错。

全部新字段与 `runFormat` 条件约束由 `parseTtrpgCampaignContentV1` 强制，失败抛 `[ttrpg-campaign] <字段> …`；局势模板的 S1–S10 由 `parseTtrpgSituationTemplateV1` 强制；跨字段的发布期门（§8.3）由 `open-gates.ts` 的 `assertTtrpgOpenPublicationGatesV1` 强制。

```ts
// 新增顶层字段
runFormat: 'open' | 'scripted'

/** open 必填非空；scripted 必须为 []。可机器求值的世界/战役不变量。 */
canonInvariantPredicates: TtrpgPredicateV1[]

/** open 必填非空；scripted 必须为 []。作者冻结的局势模板。 */
situationTemplates: TtrpgSituationTemplateV1[]

/** open 必填非空且全部命中 situationTemplates；scripted 必须为 []。 */
openingSituationKeys: string[]

/**
 * open 必填非空；scripted 必须为 []。
 * 作者冻结的效果计划模板，是所有 effectPlanRef 的唯一解析目标。
 * 运行期由内核物化为 TtrpgEffectPlanV2：补 sourceEventId=事件 id、
 * idempotencyKey=commandId、status 按是否含 pendingChoice 决定。
 */
effectPlanTemplates: Array<{
  planKey: string                  // effectPlanRef 指向它
  degree: TtrpgDegreeV2
  ruleRef: string
  reason: string
  audience: TtrpgEffectAudienceV2
  effects: TtrpgEffectPrimitiveV2[]
}>

/** open 必填；scripted 必须为 null。AI 队友席位与授权配置。 */
companionPolicy: {
  minimumCompanions: number        // open 时 2..5
  maximumCompanions: number        // >= minimumCompanions，且 <= 5
  /** Session Zero 预授权可由 AI 队友自行执行的行动类别 */
  preauthorizedActionKinds: Array<'observe' | 'talk' | 'assist' | 'move' | 'low-risk-check'>
  /**
   * 需要玩家确认才能执行的类别。
   * 四项全部是底线，作者只能保留或扩展，不能删减——解析时必须四项齐备。
   */
  confirmationRequiredKinds: Array<'irreversible' | 'resource-spend' | 'party-relation-change' | 'secret-reveal'>
} | null

/** open 必填；scripted 必须为 null。阶段收束策略，代替闭合结局。 */
stageClosurePolicy: {
  /** 达到任一条件可进入阶段收束 */
  triggers: Array<{
    triggerKey: string
    predicate: TtrpgPredicateV1
    summaryPrompt: string
  }>
  /** 单局 worldTurn 上限；达到即强制可收束，防止无限局 */
  maximumWorldTurns: number        // 10..1000
} | null
```

`TtrpgDegreeV2`、`TtrpgEffectAudienceV2`、`TtrpgEffectPrimitiveV2` 是既有类型（`src/lib/types/ttrpg-product.ts`），直接复用。

`scripted` 的既有字段语义完全不变。`open` 的 `scenes`、`clues`、`quests`、`endings`、`openingSceneKey` 的处理见 §7.1。

**兼容性**：`campaign.ts` 读取旧 CampaignPack（无这 7 个顶层字段，且 `clocks`/`fronts` 也缺 §5.7 的新增字段）时，**不得**改写已发布内容。按 §7.4 的旧包兼容投影在内存中补齐全部缺失字段，并保留原始序列化内容用于哈希校验。**兼容投影必须发生在哈希校验之后，绝不参与哈希计算。**

### 5.2 RulePack 的 `oracles` 扩展

`RulePackV1` 新增一个顶层字段 `oracles`，`rule-pack.ts:799` 的 `exact()` 列表同步新增。

```ts
oracles: TtrpgOracleTableV1[]

export interface TtrpgOracleTableV1 {
  oracleKey: string
  title: string
  kind: 'yes-no' | 'meaning' | 'event'
  diceModelKey: string                      // 必须命中 rulePack.diceModels
  audience: 'gm-only' | 'party' | 'public'
  chaosCoupled: boolean
  /** kind='yes-no' 必填非空，其余必须为 null */
  likelihood: {
    tiers: Array<{
      tierKey: string
      label: string
      yesAtOrAbove: number                  // 骰值阈值，含
      yesButBand: number                    // 阈值之上 N 点落入 yes-but，0 表示不启用
      noButBand: number                     // 阈值之下 N 点落入 no-but，0 表示不启用
    }>
    defaultTierKey: string                  // 必须命中 tiers
  } | null
  /** kind='meaning' | 'event' 必填且 ≥4 条，其余必须为 null */
  entries: Array<{
    entryKey: string
    weight: number                          // 1..1000 整数
    text: string
    tags: string[]                          // 供局势与条件注入检索
  }> | null
  /** 解释约束：由内核强制，不是提示词建议 */
  interpretation: {
    mustRespect: string[]
    forbiddenScopes: Array<'world-fact' | 'rule-change' | 'player-decision' | 'retcon'>
    maxNewEntities: number                  // 0..3
  }
  /** 必填且 ≥1 条。发布门 product.ttrpg.rules 检查它，夹具保证确定性 */
  tests: Array<{
    testKey: string
    seed: string
    nonce: string
    chaosValue: number | null               // chaosCoupled=false 时必须为 null
    likelihoodTierKey: string | null        // kind='yes-no' 时必填
    expectedRawResult: 'yes' | 'yes-but' | 'no-but' | 'no' | null  // kind='yes-no' 时必填
    expectedEntryKey: string | null         // kind='meaning'|'event' 时必填
  }>
  sourceRefs: string[]
}
```

**哈希兼容硬约束**：既有 `ttrpgRulePacks` 行的 `rulePackJson` 不含 `oracles`。读取旧包时必须①先按原始序列化内容验证既有 `contentHash`，②再在内存中生成 `oracles: []` 的运行投影（`projectLegacyTtrpgRulePackV1`）。**不得静默重算或改写已标 `validated` 的规则包**。`open` 跑团需要的 Oracle 表由作者确认后生成新版本规则包与新 Release。该行为必须有正反例回归（§13）。

### 5.3 谓词

跨模块共用。局势、clock 触发、front 击败、canon 不变量、质量门都引用它。共 17 个 op（14 个叶子 + 3 个组合）。

```ts
export type TtrpgPredicateV1 =
  | { op: 'world-fact', subjectRef: string, predicateKey: string, value?: string | number | boolean }
  | { op: 'session-fact', subjectRef: string, predicateKey: string, value?: string | number | boolean }
  | { op: 'evidence-known-by', clueRef: string, actorKey: string }
  | { op: 'clock-at-least', clockKey: string, value: number }
  | { op: 'story-fact', factKey: string, expected: string | number | boolean | null }
  | { op: 'actor-at', actorKey: string, locationRef: string }
  | { op: 'item-held', actorKey: string, itemKey: string }
  | { op: 'ability-available', actorKey: string, abilityKey: string }
  | { op: 'resource-at-least', actorKey: string, resourceKey: string, value: number }
  | { op: 'social-balance-at-least', balanceKey: string, value: number }
  | { op: 'chaos-at-least', value: number }
  | { op: 'world-turn-at-least', value: number }
  | { op: 'situation-active', templateKey: string }
  | { op: 'front-stage-at-least', frontKey: string, stageKey: string }
  | { op: 'all', of: TtrpgPredicateV1[] }
  | { op: 'any', of: TtrpgPredicateV1[] }
  | { op: 'not', of: TtrpgPredicateV1 }
```

**硬约束**：

1. 求值必须是纯函数，只读冻结快照与派生状态，不得有副作用、不得调用模型、不得读数据库。
2. 嵌套深度上限 8，`of` 数组长度上限 32；超限解析即失败。
3. 引用不存在的对象时求值结果不是 `false`，而是抛出 `predicate-unresolvable`，由调用方按 §6.5 记失败日志。这是为了让「作者写错 key」与「条件当前不满足」可区分。
4. `op: 'story-fact'` 读 `effectLedger.storyFacts`，`op: 'session-fact'` 读会话事实层。二者是不同层，不互为别名。
5. `op: 'clock-at-least'` 读 `openRun.pressure.clocks[clockKey].value`。`open` 下不存在其他时钟（§5.7 硬约束 7），因此本 op 是唯一的时钟判定入口。`op: 'story-fact'` 读 `effectLedger.storyFacts`，用于效果账本写下的布尔/数值标记，与时钟无关。
6. `op: 'situation-active'` 用 `templateKey`（不是运行时生成的 `situationKey`），判定为「`situations.active` 中存在某实例其 `templateKey` 相等」。这样作者写的谓词才可能命中。
7. `op: 'evidence-known-by'` 判定 `clueRef` 是否对该 actor 已知：该 ref 出现在某活跃实例的 `discoveredEvidenceRefs` 中，或其模板中该 evidence 的 `audience` 为 `party`（evidence 的受众闭集只有 `gm-only`/`party`/`private`，无 `public`），或 `audience='private'` 且 `actorKey` 在其 `knownByActorKeys` 中。**`open` 不使用 `campaign.clues` / `clueCatalog`**（二者为空），因此不提供 `clue-known-by`。
8. `op: 'front-stage-at-least'` 的 stage 顺序 = `escalationStages` 的**数组下标**。解析期强制：`stageKey` 在同一 front 内唯一，且数组按 `atClockValue` 非递减排列；否则解析失败。判定为「`currentStageKey` 的下标 >= 目标 `stageKey` 的下标」，`currentStageKey=null` 视为下标 -1。
9. **不提供 `relationship-tier`**。关系强弱一律用 `social-balance-at-least` 读 `effectLedger.socialBalances`，数值分段由规则包或内容声明（§3.2 关系权威行）。
10. 序列化为可读字符串时固定格式 `op:<op>:<主键字段>`（如 `op:item-held:actor.lin/item.key`），用于 `unsatisfiedPredicates` 与失败日志。

实现落点见 §3.5。`evaluateTtrpgPredicateV1(predicate, context)` 的 `context` 只接受已派生的只读快照，签名中不得出现 `db`。

### 5.4 游戏时间

`eventSequence` 只用于事件排序、回放和审计；征兆提前轮次、idle 推进和玩家可继续率使用独立的 `worldTurn`。

```ts
export interface TtrpgWorldTimeV1 {
  worldTurn: number
  lastAdvancedByEventSequence: number
  lastAdvanceReason: 'player-resolution' | 'companion-resolution' | 'front-tick' | 'stage-close' | null
}
```

**可推进 `worldTurn` 的事件**（白名单，其余一律不推进）：

- 已确认并完成结算的玩家游戏内行动
- 已确认并完成结算的 AI 队友行动
- 明确的阶段收束结算
- KP 显式的「时间流逝」结算（走 front-tick，需带 effectPlan 或 clock 推进）

**明确不推进**：查看背包、阅读手记、规则询问、安全暂停、媒资加载、上下文装配、记忆摘要、回退、读档、分支创建、Oracle 咨询本身、意图预检与澄清。

实现落点见 §3.5。reducer 只允许通过 `advanceTtrpgWorldTimeV1` 改 `worldTurn`。

### 5.5 冻结事实索引

发布时在 `production-compiler.ts` 内编译：由 `TTRPG_WORLD_REQUIREMENT_ADAPTER_V1`（`src/lib/product/world-requirement-adapters.ts:157`）声明的读取范围出发，经已冻结的 SourcePlan 取到世界资源，再调 `compileTtrpgFrozenWorldPredicateIndexV1` 生成只读索引，并把 `indexHash` 纳入 runtime package。**编译只在发布期发生，运行期只读。**

```ts
export interface TtrpgFrozenWorldPredicateIndexV1 {
  worldReleaseHash: string
  indexHash: string
  entries: Array<{
    subjectRef: string
    predicateKey: string                     // 取自 §5.6 的受控谓词表
    canonicalValue: string | number | boolean
    audience: 'gm-only' | 'party' | 'private' | 'public'
    sourceResourceRefs: string[]
  }>
}
```

**硬约束**：

1. 事实门 F1、谓词求值、上下文装配和世界补丁审阅只读这个索引与 session 的权威状态。**不得让模型从自然语言世界资料临时推断冻结事实。**
2. 旧 Release 先验证原始 `packageHash`，再生成仅供运行时使用的兼容投影（空索引），不得静默重算旧 Release 身份。
3. 索引条目上限 20000；超限时编译失败并提示作者收窄 SourcePlan。
4. `audience='private'` 的条目必须在 `sourceResourceRefs` 中可追溯到具体角色资源，否则编译失败。
5. `indexHash = hashProductProductionValueV2({ worldReleaseHash, entries })`，`entries` 先按 `subjectRef` 再按 `predicateKey` 升序排序后参与哈希，保证可复算。

实现落点见 §3.5。

### 5.6 会话事实层

```ts
export type TtrpgFactLayerV1 = 'world' | 'authored' | 'session'

export interface TtrpgSessionFactV1 {
  factKey: string                           // 由内核分配，见下
  layer: Extract<TtrpgFactLayerV1, 'session'>
  kind: 'entity' | 'relation' | 'state' | 'event-truth' | 'location' | 'item'
  subjectRef: string                        // 世界资源 UID、campaign key 或本层既有 factKey
  predicateKey: string                      // 受控谓词表，见下
  canonicalValue: string | number | boolean // 参与互斥比较的唯一归一值
  detail: string                            // 人类可读补充，不参与比较
  origin: 'oracle' | 'ai-improv' | 'player-declared' | 'rule-outcome'
  originEventSequence: number
  originRef: string | null                  // oracle 事件序号 / effectPlan idempotencyKey
  sourceFactRefs: string[]                  // 密级继承与合法揭示的显式来源
  sourceEventRefs: string[]                 // 产生该事实的事件或授权事件
  audience: 'gm-only' | 'party' | 'private' | 'public'
  knownBy: string[]                         // actorKey 列表；audience='private' 时不得为空
  supersedes: string | null
  supersedeReason: string | null
  retired: boolean
  retiredAtSequence: number | null
}
```

`audience` 沿用既有闭集 `TtrpgRuntimeMediaAudienceV1`，不新造词；投影层继续映射为 `actor:${actorKey}`。

**命名只有两种，不得出现第三种**：顶层事实与记忆用 `knownBy`（`TtrpgSessionFactV1`、`TtrpgNarrativeMemoryV1`）；与 `visibleTo` / `audience` 同层出现的内嵌对象用 `knownByActorKeys`（局势模板的 `interventionPoints` / `evidence`、`TtrpgContextTriggerV1`）。语义相同，都投影为 `actor:${actorKey}`。

**`factKey` 由内核分配，不由模型给定**：`factKey = \`fact.${subjectRef}.${predicateKey}.${baseSequence}\``（**用提交命令时的 `baseSequence`**，与 §6.1 的 `<seq>` 口径一致，这样 `commandId` 可在提交前算出），超长时对 `subjectRef` 取其 sha256 前 16 位。`originEventSequence` 是事件落账后由 reducer 回填的审计字段，**不参与 key 构造**。模型候选中若携带 `factKey` 一律忽略。

**受控谓词表**（随规则包冻结，首批 12 项）：`exists`、`located-at`、`owns`、`knows`、`allied-with`、`hostile-to`、`owes`、`promised`、`damaged`、`destroyed`、`blocked`、`open`。受控表的目的是让矛盾校验可机器判定，而不是比较自由文本。**表外谓词一律在解析期拒绝，失败类别 `predicate-unresolvable`。**

**提交前四门（硬条件，任一不通过即拒绝提交）**

| 门 | 判定 | 失败处理 |
|---|---|---|
| F1 与冻结世界事实不矛盾 | 按 §5.6.1 互斥表比较同一 `subjectRef` + `predicateKey` 的 `canonicalValue` 与 `TtrpgFrozenWorldPredicateIndexV1` 条目 | 拒绝，返回冲突的世界资源 UID 与 `worldReleaseHash` |
| F2 与作者局势层不矛盾 | 只对 `canonInvariantPredicates` 求值。既有 `bible.canonInvariants: string[]` 仍只供模型阅读，**不参与本门** | 拒绝，返回违反的谓词 |
| F3 与本层已生效事实不矛盾 | 同互斥表，除非显式 `supersedes` 且给出 `supersedeReason` | 拒绝，或要求补 supersede |
| F4 密级不降级 | `sourceFactRefs` / `sourceEventRefs` 必须全部可解析；新事实密级不得低于显式来源的最高密级，按下方格与 `knownBy` 子集规则判定。未声明或无法解析来源默认拒绝 | 拒绝，返回被泄露的来源或缺失来源 |

F4 防止经由「新事实」间接泄露 GM 真相。判定规则（可机器求值，不留解释空间）：

**密级格（偏序，数值越大越严）**：`public = 0` < `party = 1` < `private = 2` < `gm-only = 3`。

1. 取全部显式来源（`sourceFactRefs` 指向的事实 + `sourceEventRefs` 指向事件所携带事实）的密级，求最大值 `maxSource`。
2. 新事实密级必须 `>= maxSource`。
3. **`private` 另加 `knownBy` 子集规则**：当 `maxSource` 与新事实都是 `private` 时，新事实的 `knownBy` 必须是全部 `private` 来源 `knownBy` 的**交集的子集**。扩大知情范围即视为降级，拒绝。
4. 当 `maxSource` 为 `private` 而新事实为 `gm-only` 时允许（升级）。当 `maxSource` 为 `party` 而新事实为 `private` 时允许，但 `knownBy` 必须非空。
5. 唯一例外：存在合法 reveal/discovery 事件时，密级按该事件显式声明的受众传播，且该事件 id 必须出现在 `sourceEventRefs` 中。

#### 5.6.1 互斥表

`detail` 不参与比较，只比较 `canonicalValue`。首批互斥关系：

| 谓词 | 互斥规则 |
|---|---|
| `exists` | 同一 `subjectRef` 不能同时有 `true` 与 `false` |
| `located-at` | 同一主体只能有一个未退役的地点 |
| `owns` | 同一可转移物品只能有一个未退役的持有者 |
| `destroyed` / `open` / `blocked` | 同主体的相反状态互斥（`destroyed=true` 与 `exists=true` 互斥；`open=true` 与 `blocked=true` 互斥） |
| `allied-with` / `hostile-to` | 同一对主体的两个关系互斥 |

`knows`、`owes`、`promised`、`damaged` 首批**没有**自动互斥规则：只验证引用存在、受众不降级和显式 `supersedes`，不能因为两段文本不同就判 F1/F3 失败。

**优先级（不得颠倒）**：①`predicateKey` 不在 12 项受控表内 → 解析期拒绝，类别 `predicate-unresolvable`；②在受控表内且上表有互斥定义 → 按互斥规则判 F1/F3；③在受控表内但上表无互斥定义（即上列四项）→ F1/F3 自动通过，只跑引用存在与 F4。不存在「受控表内却无法归类」的第四种情况。

#### 5.6.2 世界补丁候选（后续阶段）

```ts
export interface TtrpgWorldPatchCandidateV1 {
  sessionId: number
  worldReleaseHash: string
  fromEventSequence: number
  toEventSequence: number
  facts: TtrpgSessionFactV1[]               // 默认排除 retired 与 gm-only
  includeGmOnly: boolean                    // 作者显式勾选才为 true
  conflicts: Array<{ factKey: string, against: string, reason: string }>
  exportedAt: number
}
```

导出只是作者审阅入口，**不自动写入 WorldRelease**。实现落点见 §3.5（`buildTtrpgWorldPatchCandidateV1`，P8）。

### 5.7 压力：clocks 与 fronts 自驱

扩展 `campaign.ts` 既有字段，不新建并行结构。**字段定义与解析约束属 P2**（发布门 `product.ttrpg.open-pressure` 与 `front-stage-at-least` 的解析规则都要在 P2 测试）；运行时行为（自驱、征兆投放、升级、击败）属 P5。

```ts
// TtrpgCampaignClockV1 新增 2 个字段
export interface TtrpgCampaignClockV1 {
  clockKey: string
  title: string
  description: string
  initialValue: number
  maximum: number
  advanceTriggers: Array<{
    triggerKey: string
    sceneKey: string | null                 // open 必须为 null
    actionKey: string | null
    condition: TtrpgPredicateV1 | null      // 新增；scripted 必须为 null
    /** 推进量，必须 >= 1 */
    amount: number
    reason: string
  }>  // 解析硬约束：open 下每项必须 actionKey 与 condition 至少一个非 null，否则该触发永不可能命中，解析失败
  autoAdvance: {                            // 新增；scripted 必须全为 0
    onFailedCheck: number                   // 0..4
    onIdleWorldTurns: number                // 0..8；连续 N 个 worldTurn 无本钟推进则 +1
    onOracleNo: number                      // 0..4
    onStageClose: number                    // 0..4
  }
  onComplete: string
  onCompleteEffectPlanRef: string | null    // 新增；scripted 必须为 null
  visibility: 'gm-only' | 'party' | 'public'
  sourceRefs: string[]
}

// TtrpgCampaignFrontV1 新增 3 个字段
export interface TtrpgCampaignFrontV1 {
  frontKey: string
  title: string
  goal: string
  participantKeys: string[]
  clockKeys: string[]
  escalation: string[]                      // 既有：升级路径文本，仅供阅读
  escalationStages: Array<{                 // 新增；open 必填非空，scripted 必须为 []
    stageKey: string
    clockKey: string                        // 必须命中本 front 的 clockKeys
    atClockValue: number
    effectPlanRef: string | null
    newSituationTemplateKey: string | null  // 升级可直接实例化局势
  }>
  telegraph: Array<{                        // 新增；open 必填且每个 stageKey 至少 1 条；scripted 必须为 []
    telegraphKey: string
    beforeStageKey: string                  // 必须命中 escalationStages
    signalText: string
    audience: 'party' | 'public'            // 征兆必须对 party 可见，不允许 gm-only
    mediaSlotKey: string | null
    minLeadWorldTurns: number               // 1..10
  }>
  defeatConditions: string[]                // 既有文本
  defeatPredicates: TtrpgPredicateV1[]      // 新增；open 必填非空；scripted 必须为 []
  sourceRefs: string[]
}
```

**硬约束**

1. `open` 的 campaign 校验：任一 `escalationStages` 项若无对应 `telegraph`，解析直接失败。`stageKey` 在同一 front 内必须唯一，且数组必须按 `atClockValue` 非递减排列——数组下标即 stage 的严格顺序，`front-stage-at-least` 依赖它。
2. 升级执行前，内核检查该 stage 的 `telegraph` 中**至少一条**已投放（`telegraphWorldTurns` 以 `telegraphKey` 为键）、且 `currentWorldTurn - telegraphWorldTurns[telegraphKey] >= 该条的 minLeadWorldTurns`、且其 `audience` 为 `party`/`public`；未满足则本轮只投征兆、不升级。该检查由 **E10 `ttrpg.front.advanced` 的 reducer** 执行（§6.2），**不得只写进提示词**。
3. `autoAdvance` 只在 `worldTurn` 推进时求值一次；§5.4 列出的非游戏内行动不触发。
4. `defeatPredicates` 全部满足时产出 `ttrpg.front.defeated`（E12），并执行对应收束。
5. `onIdleWorldTurns` 的「idle」按单个 clock 计算，不是全局：某钟自上次推进以来经过的 `worldTurn` 数（`worldTurn - clocks[k].lastAdvancedWorldTurn`）。
6. `onCompleteEffectPlanRef`、`escalationStages[].effectPlanRef` 必须命中 `effectPlanTemplates[].planKey`，否则解析失败。
7. **`open` 下不使用故事时钟**：`effectPlanTemplates` 的 `effects` 中禁止出现 `operation === 'clock.advance'`。理由：`open` 的 `clockCatalog` 只由 `campaign.clocks` 编译（§7.1），而既有 `effect-runtime.ts:325` 的 `clock.advance` 会校验 `clockCatalog`，因此指向压力时钟会造成双权威、指向其他 key 会在提交期直接失败。压力时钟一律由 E8 推进。由发布门 `product.ttrpg.open-clock-disjoint` 机器校验（解析期也可提前拒绝）。

实现落点见 §3.5。

### 5.8 局势

局势是 `open` 跑团的内容单位，取代预写场景图。作者冻结**模板**，运行时产生**实例**。

```ts
export type TtrpgMotiveV1 =
  | 'knowledge' | 'protection' | 'reputation' | 'wealth'
  | 'ability' | 'equipment' | 'conquest' | 'serenity' | 'comfort'

/** 作者冻结在 CampaignPack 中 */
export interface TtrpgSituationTemplateV1 {
  templateKey: string
  title: string
  motive: TtrpgMotiveV1
  driverKind: 'npc' | 'front' | 'world-event' | 'player-commitment'
  driverRef: string                          // NPC characterKey / frontKey / 世界事件 key
  driverGoal: string
  driverBeliefs: Array<{
    factRef: string | null                   // 至少一条非空且可解析
    belief: string
    isMistaken: boolean
  }>
  preconditions: TtrpgPredicateV1[]
  obstacles: Array<{
    obstacleKey: string
    kind: 'physical' | 'social' | 'informational' | 'resource' | 'legal'
    ref: string | null
    predicate: TtrpgPredicateV1              // 何时算被克服
    dependsOn: string[]                      // 因果依赖，构成有向无环图
  }>
  interventionPoints: Array<{
    pointKey: string
    visibleTo: 'party' | 'private' | 'public'
    knownByActorKeys: string[]               // visibleTo='private' 时必填非空
    affordanceHint: string                   // 玩家能看出「这里可以做点什么」
    requiresPredicate: TtrpgPredicateV1 | null
    suggestedActionKeys: string[]            // 必须命中 rulePack.actions
    /** 该介入点针对哪些障碍：构成 interventionPoint → obstacle 的显式边，G2 用它求可达 */
    targetsObstacleKeys: string[]            // 必填非空，全部命中本模板 obstacles
  }>
  evidence: Array<{
    clueRef: string
    discoverableBy: string[]                 // checkKey 或 actionKey
    /** 该证据覆盖哪些障碍：构成 evidence → obstacle 的显式边，G2 用它求可达 */
    coversObstacleKeys: string[]
    audience: 'gm-only' | 'party' | 'private'
    knownByActorKeys: string[]               // audience='private' 时必填非空
    isRequired: boolean
  }>
  /**
   * 必填且非空，至少 2 条。回答「为什么是现在」。
   * 每条必须是 §8.2 I2 的四种 ref 形式之一；实例化时原样复制到实例的 whyNowRefs，
   * 由 I2 在实例化当刻校验「至少一条对当前玩家可解析」。
   */
  whyNowRefs: string[]
  noInterventionOutcome: {                   // 必填：玩家不介入会怎样
    afterWorldTurns: number                  // 1..50
    description: string
    effectPlanRef: string | null
    advancesClockKeys: string[]              // 与 effectPlanRef 不得同时为空/空数组
  }
  consequences: Array<{
    scope: 'actor' | 'faction' | 'location' | 'world-state' | 'party-identity'
    ref: string
    effectPlanRef: string
    /** 非 null 时，该后果触发后实例化此模板（运行时路径 3） */
    nextSituationTemplateKey: string | null
    audience: 'gm-only' | 'party' | 'public'
  }>
  sourceRefs: string[]
}

/** 运行时实例，由事件派生，不落表 */
export interface TtrpgSituationInstanceV1 {
  situationKey: string                       // `${templateKey}.${activatedAtSequence}`，见下方「序号口径」
  templateKey: string
  status: 'active' | 'resolved' | 'expired'
  activatedAtSequence: number
  activatedAtWorldTurn: number
  activationReason: 'opening' | 'front-escalation' | 'consequence'
  /** 从模板原样复制；I2 要求至少一条可被当前玩家投影解析 */
  whyNowRefs: string[]
  /** 已被克服的障碍。由 E11 `progressed` 累积；G2 的前驱覆盖判定读它（§8.1）。resolved 的判定仍以 `obstacles[].predicate` 重新求值为准（§5.8 运行时约束 6） */
  satisfiedObstacleKeys: string[]
  discoveredEvidenceRefs: string[]
  noInterventionDueWorldTurn: number
  resolvedAtSequence: number | null
  resolutionKind: 'intervened' | 'no-intervention' | 'front-defeated' | 'superseded' | null
}
```

**模板解析硬约束（`open` 的 campaign 校验，由 `parseTtrpgSituationTemplateV1` 强制）**

| # | 约束 |
|---|---|
| S1 | `obstacles` 至少 2 条；`dependsOn` 必须至少存在一条非空边，且全图无环 |
| S2 | `driverBeliefs[].factRef` 至少一条非空，且能解析到冻结事实索引、`canonInvariantPredicates` 引用或本 campaign 的 key |
| S3 | `interventionPoints` 至少 2 个；`suggestedActionKeys` 全部命中 `rulePack.actions`；`targetsObstacleKeys` 非空且全部命中本模板 `obstacles[].obstacleKey` |
| S4 | `evidence` 至少 2 条，且至少 1 条 `isRequired=false`；每条 `coversObstacleKeys` 全部命中本模板 `obstacles[].obstacleKey` |
| S5 | `noInterventionOutcome.effectPlanRef` 与 `advancesClockKeys` 不得同时为空 |
| S6 | `driverKind='front'` 时 `driverRef` 必须命中 `fronts[].frontKey`；`'npc'` 时必须命中 `characterTemplates[].characterKey` 且该模板 `role` 不是 `player` |
| S7 | 所有 `visibleTo='private'` / `audience='private'` 项的 `knownByActorKeys` 非空且命中 `characterTemplates` |
| S8 | 所有 `effectPlanRef`、`nextSituationTemplateKey` 均可解析（前者命中 `effectPlanTemplates[].planKey`，后者命中 `situationTemplates[].templateKey`） |
| S9 | `whyNowRefs` 至少 2 条，且每条形如 §8.2 I2 的四种 ref 之一（前缀必须是 `world:` / `session:` / `clock:` / `telegraph:`，`clock:` 的 key 必须命中 `campaign.clocks`，`telegraph:` 的 key 必须命中某 front 的 `telegraph`） |
| S10 | `evidence[].clueRef` 在全部 `situationTemplates` 范围内唯一；`open` 下它是证据的**唯一命名空间**（`campaign.clues` 为 `[]`，不参与） |

> 注意：这里的 S1–S10 是局势模板门编号，与架构阶段 `S1 世界封存 / S2 产品定向 / S3 产品执行` 无关，两套编号不得互相引用。

**运行时约束**

1. 实例化只能由三条路径产生，首期三条全部支持：`openingSituationKeys`（`activationReason='opening'`）、`escalationStages[].newSituationTemplateKey`（`'front-escalation'`）、`consequences[].nextSituationTemplateKey`（`'consequence'`）。**模板一律取自作者冻结内容；首期不接受模型生成新模板。**
2. 同一 `templateKey` 同时活跃的实例数上限 1；重复实例化返回既有实例，不产生新事件。消解后需满足 I7 冷却（≥3 个 worldTurn）才可再次实例化。
3. 活跃实例总数上限 5。超限时发 E11 `transition='queued'`，把模板 key 按**先进先出**追加到 `situations.queuedTemplateKeys`，不丢弃，同时记 `situation-capacity` 日志（E18）。任一实例离开 `active` 时，从队首依次尝试实例化（仍需过实例门），处置规则：I1/I2/I3/I4 不过 → **丢弃**该项并记 `situation-rejected`；I5 不过（同模板已活跃）→ **丢弃**该项，不记日志；I6/I7 不过 → **保留在队列原位**并记 `situation-capacity`。单次释放最多成功实例化 1 个。
4. 实例进入 `active` 前必须通过 §8.2 的实例门，**开局实例也不例外**：E1 之后由 E11 逐个提交开局实例，不得绕过。
5. `noInterventionDueWorldTurn = activatedAtWorldTurn + noInterventionOutcome.afterWorldTurns`。到期且未消解时，执行 `noInterventionOutcome`，并把实例置 `status='expired'`、`resolutionKind='no-intervention'`。
6. 其余终态：玩家介入导致全部 `obstacles[].predicate` 满足 → `status='resolved'`、`resolutionKind='intervened'`；驱动 front 被击败（E12）→ `status='resolved'`、`resolutionKind='front-defeated'`；被后续模板取代 → `status='resolved'`、`resolutionKind='superseded'`。四种终态都经 E11 的 `transition='resolved'` 或 `'expired'` 提交。
7. **序号口径（与 §6.1 的 `<seq>` 一致）**：`activatedAtSequence` 取**提交该 E11 命令时的 `baseSequence`**，不是结果事件的 `eventSequence`。否则 `situationKey` 与由它派生的 `commandId` 无法在提交前计算，幂等永远不命中。
8. **`transition='queued'` 的 key 形式**：此时没有实例，`situationKey` 固定为 `queued.${templateKey}.${baseSequence}`，`instance` 必须为 `null`。

实现落点见 §3.5。

### 5.9 Oracle 与混乱因子

```ts
export interface TtrpgChaosStateV1 {
  value: number                              // 1..9
  lastChangedAtSequence: number
}
```

`advanceOn` / `recedeOn` **不是运行时字段**：触发集合是本方案固定的常量，不由作者配置，因此不进状态树（否则它们没有写入事件、无法重放）。常量定义：

```ts
export const TTRPG_CHAOS_ADVANCE_TRIGGERS_V1 =
  ['failed-check', 'front-advanced', 'clock-complete', 'player-retreat'] as const
export const TTRPG_CHAOS_RECEDE_TRIGGERS_V1 =
  ['situation-resolved', 'front-defeated', 'stage-closed'] as const
```

```ts
export interface TtrpgOracleOutcomeV1 {
  oracleKey: string
  question: string                           // 规范化后的问题文本
  askedBy: 'gm' | `player:${string}` | `companion:${string}`
  likelihoodTierKey: string | null
  chaosValueAtRoll: number | null
  rawResult: 'yes' | 'yes-but' | 'no-but' | 'no' | { entryKey: string }
  finalized: true                            // Oracle 无待确认态，提交即定
  interpretationCandidateId: string | null   // 解释走候选链，结果本身不可改
}

/** 复算回执。骰子部分直接复用既有 RuleDiceResolutionV1。 */
export interface TtrpgOracleRollReceiptV1 {
  rulePackContentHash: string
  oracleKey: string
  commandId: string
  eventSequence: number
  diceModelKey: string
  nonce: string                              // 固定格式见下
  diceResolution: RuleDiceResolutionV1       // 含 dice/keptDice/total/rollTrace/seedCommitment/proofHash
  /** 掷骰时的 chaos 快照。E4 不改 chaos，因此两者必然相等，保留二字段只为回执自描述 */
  chaosBefore: number | null
  chaosAfter: number | null
  likelihoodTierKey: string | null
  /** kind='meaning'|'event' 必填，其余为 null。词条选择的独立复算材料 */
  entrySelection: {
    nonce: string                            // `${nonce}:entry`
    weightTotal: number
    consumedSamples: number
    rejectedSamples: number
    index: number                            // 0..weightTotal-1
  } | null
  selectedEntryKey: string | null
  receiptHash: string                        // hashProductProductionValueV2(本结构去掉 receiptHash)
}
```

**nonce 格式（固定，不得变更）**：`oracle:${oracleKey}:${commandId}`。`seed` 取 `session.seed`，与既有检定一致。

**复算方式**：`verifyTtrpgOracleOutcomeV1` 必须①用 `verifyRulePackDiceResolutionV2` 校验 `diceResolution`；②用冻结 RulePack 按下列算法重新推出 `rawResult`（`meaning`/`event` 另需重算 `entrySelection`）；③比对 `receiptHash`。三步缺一不得宣称可复算。

**档位来源（不由模型决定）**：`likelihoodTierKey` 必须在掷骰**之前**确定并写入回执。来源优先级固定：①命令显式携带且命中 `likelihood.tiers`；②内核按状态映射规则得出（如 `oracle.yesno.npc-cooperates` 读 `socialBalances` 分段）；③否则取 `defaultTierKey`。模型候选中的档位建议只能作为①的入参之一，由内核校验后采用；校验不过即回落到③。

**判定算法（确定性，不得改）**

- `kind='yes-no'`：设 `t = diceResolution.total`、`a = effectiveThreshold`（见下）、`yb = tier.yesButBand`、`nb = tier.noButBand`。
  - `t >= a + yb` → `yes`
  - `a <= t < a + yb` → `yes-but`（`yb=0` 时此区间为空）
  - `a - nb <= t < a` → `no-but`（`nb=0` 时为空）
  - 否则 → `no`
- `kind='meaning' | 'event'`：**不使用 `total`**。骰值总和分布不均且取值过少（2d6 只有 2..12 共 11 个值），无法表达 1..1000 的权重。改用独立的均匀采样：
  1. `entries` 按 `entryKey` 升序排序，累加 `weight` 得区间，`W = Σweight`（上限 100000）。
  2. 调 `selectTtrpgOracleEntryIndexV1({ seed, nonce: \`${nonce}:entry\`, weightTotal: W })` 得 `index`。
  3. `index` 落入哪个累加区间就选该 `entryKey`。
- `selectTtrpgOracleEntryIndexV1` 的算法（在 `oracle.ts` 实现，`resolveTtrpgOracleV1` 与 `verifyTtrpgOracleOutcomeV1` 共用同一函数，**不得各写一份**）：
  1. 按 `blockIndex = 0,1,2...` 对 `${seed}:${nonce}:${blockIndex}` 做 SHA-256，取摘要的大端 uint32 序列。与 `sampleTtrpgDiceWithSha256V2`（`dice.ts:105`）完全同构。
  2. `acceptedRange = Math.floor(0x1_0000_0000 / weightTotal) * weightTotal`。样本 `< acceptedRange` 则接受，`index = sample % weightTotal`；否则计入 `rejectedSamples` 并取下一个。**拒绝采样是为了消除取模偏差，不得省略。**
  3. 返回 `{ index, consumedSamples, rejectedSamples }`，全部写入 `entrySelection` 供复算。
  - 不复用 `mapUint32ToTtrpgDieV2`：该函数的 `assertTtrpgDieSidesV2` 把范围限制在 2..100，容纳不下权重总和。
- `chaosCoupled=true` 时 `effectiveThreshold = clamp(tier.yesAtOrAbove + (chaosValueAtRoll - 5), minTotal, maxTotal)`，`minTotal`/`maxTotal` 取该 diceModel 加修正后的可能取值范围；`chaosCoupled=false` 时 `effectiveThreshold = tier.yesAtOrAbove`。

**混乱因子的初值与步长（固定常量）**

- 初值 `value = 5`（1..9 的中位），由 E1 写入。
- 命中 advance 触发 → `value = min(9, value + 1)`；命中 recede 触发 → `value = max(1, value - 1)`。
- **同一事件最多变动 1。** 一个逻辑事实同时满足多个触发时（典型：front 被击败导致其驱动的局势消解），只按产生该变动的那一个事件计一次：以 E12 为准，E11 的 `resolutionKind='front-defeated'` 分支不再动 chaos。
- 触发与事件的对应关系（reducer 必须按此更新，且每次更新都要刷新 `lastChangedAtSequence`）：

| 触发 | 方向 | 产生它的事件 |
|---|---|---|
| `failed-check` | advance | 既有 `ttrpg.check.resolved` / `ttrpg.rule.action.resolved`（二者均已在 `PRODUCT_RUNTIME_EVENT_TYPES` 中）里 `degree` 为失败档 |
| `front-advanced` | advance | E10 |
| `clock-complete` | advance | E8 且 `valueAfter >= maximum` |
| `player-retreat` | advance | E2 的 `route='no-roll'`、`preview.isRetreat === true` 且 `requiresConfirmation === false`（需确认的撤退意图要等 E3 确认后由 E3 触发；未确认的意图不改 chaos） |
| `situation-resolved` | recede | E11 且 `transition='resolved'` 且 `resolutionKind === 'intervened'` |
| `front-defeated` | recede | E12 |
| `stage-closed` | recede | E13 |

E4（Oracle 咨询）本身**不改 chaos**：Oracle 的否定结果经 `autoAdvance.onOracleNo` → E8 影响时钟，再由 `clock-complete` 间接影响 chaos。

**硬约束**

1. 掷骰必须经 `resolveRulePackDiceModelV1`，不得自行实现随机。
2. 同一 `commandId` 的相同 Oracle 命令幂等返回，不得重掷。要得到另一次结果必须新建 `commandId`（见 §6.1 的 `attempt` 规则），并在事件 payload 携带 `previousOracleEventSequence`；两次结果都留在事件流中。
3. `rawResult` 一经提交即为本局事实输入。解释文本可重生成，但新解释使用新的候选与事件，不覆盖 `rawResult`。
4. `audience='gm-only'` 的 Oracle 结果与解释不得出现在任何面向玩家的投影中。
5. `interpretation.forbiddenScopes` 由内核强制：解释候选若试图改规则、改世界事实、代替玩家决定或追溯改写已发生事实，提交被拒。
6. Oracle 咨询本身不推进 `worldTurn`。
7. **双词表建模为两张独立 Oracle 表、两次 E4 事件**（如 `oracle.meaning.action-detail` + `oracle.meaning.theme-detail`），不在单个 `rawResult` 里放两个词条。KP 叙述把两个结果合并解释。

实现落点见 §3.5。

### 5.10 状态权威矩阵

**这是本方案最重要的一致性约束。** 任何会改变数值、物品、位置、关系余额或死亡状态的结果，必须先经过既有效果账本或明确注册的新 owner；不得仅写 `TtrpgSessionFactV1`。

| 状态类别 | 唯一权威 | 会话事实层的关系 |
|---|---|---|
| 数值、消耗、物品、能力、成长 | 既有 `effect-runtime` 与对应 ledger | 只记录来源和叙事引用，不复制数值 |
| 位置、持有者、关系余额 | 既有实体状态、`effectLedger.socialBalances` | 只能在明确授权的动态实体范围内提供断言 |
| 压力时钟值（`campaign.clocks` 声明的时钟） | **`openRun.pressure.clocks`**，由 E8 独占写入 | 会话事实不得对时钟值提供断言 |
| 故事时钟 `effectLedger.storyClocks` | 既有效果账本，键 `${targetRef}:${storyKey}` | **`open` 下不使用**：效果计划模板禁止 `clock.advance`（§5.7 硬约束 7）。该状态只在 `scripted` 下存在，因此不存在双权威 |
| 故事标记 | `effectLedger.storyFacts` | 不同层；`op:'story-fact'` 与 `op:'session-fact'` 不互为别名 |
| 世界设定与不可变来源 | `TtrpgFrozenWorldPredicateIndexV1` | 只读，不被 session 覆盖 |
| 局势、征兆、会话中新实体与叙事事实 | 跑团 reducer 派生状态与 `session-facts` | 必须有来源事件、受众和 supersede 语义 |
| NPC / AI 队友信念、传闻、记忆 | 各角色 observation / narrative memory | **不得作为规则裁定依据** |

**禁止**同时让 `effectLedger.storyFacts` 与会话事实对同一个可裁定状态各自拥有最终值。实现时必须有一条回归用例覆盖这种双写尝试并拒绝它。

### 5.11 跑团运行时状态树

挂在既有 `TtrpgRuntimeProductStateV1`（`src/lib/types/product-runtime.ts:226`）下新增一个可空字段，由事件派生，不单独落表。`scripted` 时为 `null`。

```ts
// TtrpgRuntimeProductStateV1 新增
openRun: TtrpgOpenRunStateV1 | null

export interface TtrpgOpenRunStateV1 {
  runFormat: 'open'
  worldTime: TtrpgWorldTimeV1
  frozenFactIndexHash: string
  chaos: TtrpgChaosStateV1
  facts: {
    bySubject: Record<string, TtrpgSessionFactV1[]>
    retiredKeys: string[]
    lastAssertedSequence: number
  }
  situations: {
    active: Record<string, TtrpgSituationInstanceV1>
    resolved: string[]
    queuedTemplateKeys: string[]
    /** I7 冷却：键为 templateKey，值为可再次实例化的最早 worldTurn。E11 在 resolved/expired 时写入 */
    cooldownUntilWorldTurn: Record<string, number>
  }
  pressure: {
    /**
     * 压力时钟。键为 campaign 的 `clockKey`。
     * 这是 `open` 下时钟值的唯一权威，由 E8 独占写入。
     * `open` 禁用 `effectLedger.storyClocks`（见 §5.7 硬约束 7 与发布门 product.ttrpg.open-clock-disjoint），
     * 因此不存在双权威。
     */
    clocks: Record<string, { value: number, lastAdvancedSequence: number, lastAdvancedWorldTurn: number }>
    fronts: Record<string, {
      currentStageKey: string | null
      telegraphedStageKeys: string[]
      /** 键为 telegraphKey（不是 stageKey），值为该征兆投放时的 worldTurn */
      telegraphWorldTurns: Record<string, number>
      defeated: boolean
    }>
  }
  oracle: {
    consultedCount: number
    lastConsultSequence: number
    byKey: Record<string, number>
    consultedThisWorldTurn: number
  }
  intents: {
    /** 等待玩家确认的预检，键为 intentKey */
    pendingConfirmation: Record<string, TtrpgOpenIntentPreviewV1>
    /**
     * 澄清线程计数。键为 `clarificationThreadKey`（= 首个 intentKey），
     * 不能用 intentKey——后者含 baseSequence，每次重提都变，计数永远到不了 2。
     * E2 在 route='needs-clarification' 时递增；任何非 needs-clarification 的 route 把该键清零。
     */
    clarificationCounts: Record<string, number>
    lastResolvedIntentKey: string | null
  }
  companions: Record<string, {
    actorKey: string
    goalSummary: string
    lastActedWorldTurn: number
    consecutiveActions: number
  }>
  gates: {
    lastEvaluatedSequence: number
    results: Record<TtrpgOpenGateKeyV1, { passed: boolean, evidence: string[] }>
    /** 连续失败计数；达 3 触发 request-author-review，任一次通过即归零 */
    consecutiveFailures: Record<TtrpgOpenGateKeyV1, number>
  }
  /** 失败日志环形缓冲，上限 200 条，超出丢弃最旧 */
  failures: TtrpgOpenFailureLogV1[]
  stage: {
    index: number
    closedStageSummaries: Array<{ stageIndex: number, atWorldTurn: number, summary: string }>
  }
}

export type TtrpgOpenGateKeyV1 =
  | 'exit-exists' | 'hypothesis-formable' | 'telegraph-complete' | 'facts-consistent'
```

**硬约束**：`openRun` 的每个字段都必须能由事件流重放得到，且只能由下列事件写入：

| 字段 | 唯一写入事件 |
|---|---|
| `worldTime` | E1（初始化 `worldTurn=0`）；E7（经 `advanceTtrpgWorldTimeV1` 递增，是唯一的递增者） |
| `frozenFactIndexHash`、`runFormat` | E1（之后不变） |
| `chaos` | E1（初始化为 5，P2）；E2/E3/E8/E10/E11/E12/E13 与失败档检定事件按 §5.9 更新（规则随 P4 落地，见 §6.6）。**E4 不改 chaos** |
| `facts` | E1（初始化为空容器）；E5、E6 |
| `situations` | E1（初始化为空容器）；E11（含 `activated` / `queued` / `resolved` / `expired` 四种写入） |
| `pressure.clocks` | E1（按 `initialValue` 建档，含 `value`）；E8（唯一的增量写入者）。E10/E12/E13 要推进时钟必须发 E8，不得直接改 |
| `pressure.fronts` | E1（为每个 front 建档：`currentStageKey=null`、无征兆、未击败）；E9、E10、E12 |
| `oracle` | E1（初始化为空容器）；E4（计数）；E7（`consultedThisWorldTurn = 0`） |
| `intents` | E1（初始化为空容器）；E2、E3 |
| `companions` | E1（建档）；既有 `ttrpg.check.resolved` / `ttrpg.rule.action.resolved`（actor 为队友时 `consecutiveActions += 1`、刷新 `lastActedWorldTurn`）；E7（全部归零） |
| `gates` | E1（`lastEvaluatedSequence=0`，`results` 与 `consecutiveFailures` 的四个 key 全部初始化为 `{passed:false,evidence:['not-evaluated']}` 与 `0`——不用 `Partial`，保持闭集完整）；E17 |
| `failures` | E1（置空）；E18 |
| `stage` | E1（`index=0`、摘要为空）；E13 |

reducer 之外不得有任何代码直接写 `openRun`。`runFormat='scripted'` 的 session 中该字段恒为 `null`，任何读取它的代码必须先判空。

### 5.12 自由行动意图

玩家或 AI 队友的输入先形成候选意图，不直接当成事实。

```ts
export interface TtrpgOpenIntentV1 {
  /**
   * = `${actorKey}.${baseSequence}.${inputRevision.slice(0, 16)}`，由内核计算，不取模型给定值。
   * 必须含 baseSequence：否则玩家在同一局里重复输入同一句话会生成同一个 commandId，
   * 而 baseSequence 已变，按 §6.1 的幂等规则会被当成「同 commandId 内容不同」而拒绝。
   */
  intentKey: string
  /**
   * 澄清线程 id。首次提交时等于本次 intentKey；玩家回答追问后再次提交时，
   * 必须由客户端带回上一次的值，使澄清次数可累计（§16 的 ≤3 次上限）。
   */
  clarificationThreadKey: string
  actorKey: string
  goal: string                               // ≤2000
  method: string | null                      // ≤2000
  targetRefs: string[]                       // ≤16
  declaredResources: string[]                // ≤16，玩家声称要动用的物品/能力/资源
  declaredAssumptions: string[]              // ≤8，玩家以为成立但未证实的前提
  requestedOutcome: string | null            // ≤500
  source: 'player' | `companion:${string}` | 'gm'
  /** = hashProductProductionValueV2(rawInput)，由内核计算 */
  inputRevision: string
}

export interface TtrpgOpenIntentPreviewV1 {
  intentKey: string
  route: 'existing-action' | 'generic-check' | 'oracle' | 'no-roll' | 'needs-clarification' | 'rejected'
  routeDetail: {
    actionKey: string | null
    checkKey: string | null
    oracleKey: string | null
  }
  /** 行动类别，与 companionPolicy 的两个列表对接；无法归类时为 'other'，'other' 一律要求确认 */
  actionKind: 'observe' | 'talk' | 'assist' | 'move' | 'low-risk-check' | 'other'
  /** 是否为撤退类行动，供混乱因子 player-retreat 触发使用 */
  isRetreat: boolean
  riskSummary: string[]                      // 角色可判断范围内的风险，≤5 条
  possibleCosts: string[]                    // ≤5 条
  irreversible: boolean
  /** 不满足的前置条件，格式按 §5.3 硬约束 10 的 `op:<op>:<主键字段>` */
  unsatisfiedPredicates: string[]
  missingFields: Array<'goal' | 'method' | 'targetRefs'>
  requiresConfirmation: boolean
  confirmationReasonKinds: Array<'irreversible' | 'resource-spend' | 'party-relation-change' | 'secret-reveal'>
}
```

**路由顺序（固定，不得调整）**

1. 能映射到当前规则包行动且满足前置条件 → `existing-action`，走既有 `resolveTtrpgRuleAction` / `resolution` / `dice` / `effect-plan`。
2. 规则包无专用行动，但目标与方法可归入声明式通用检定 → `generic-check`，仍由规则内核结算。
3. 结果依赖未冻结事实、且无法由规则检定解决 → `oracle`（受限）。
4. 纯对白、观察、已由权威状态确定的动作 → `no-roll`，但仍记录输入与叙事结果。
5. 缺少目标、方法，或玩家无法确认代价 → `needs-clarification`，**不推进 `worldTurn`**，不消耗资源。
6. 越界请求（要求改规则、改世界事实、代替他人决定） → `rejected`。

**确认是独立状态。** 下列四类**无条件**要求确认，且**不得由模型或 AI 队友代替确认**：`irreversible=true`；消耗玩家声明之外的资源（`resource-spend`）；改变队伍关系（`party-relation-change`）；会暴露某角色的秘密（`secret-reveal`）。`companionPolicy.confirmationRequiredKinds` 只能在这四类之上扩展，不能删减——这也是发布门 `product.ttrpg.safety-and-companions` 检查四项齐备的原因。`actionKind='other'` 同样要求确认。未确认的意图不推进 `worldTurn`、不产生结算。

`actionKey` 仍是 `scripted` 的合法入口，但**不得**成为 `open` 自由行动的唯一入口。

**实现方式**：扩展既有 `submitTtrpgActionIntentV2`，不新开命令。新增可选入参 `openIntent?: Omit<TtrpgOpenIntentV1, 'intentKey' | 'inputRevision' | 'clarificationThreadKey'> & { clarificationThreadKey?: string }` 与 `confirmationOf?: string`。`intentKey` 与 `inputRevision` 由命令内部计算；`clarificationThreadKey` 缺省时取本次计算出的 `intentKey`（即首次提交自成一条线程），客户端在回答追问后必须带回上一次的值。`runFormat='scripted'` 时传入 `openIntent` 即拒绝；`runFormat='open'` 时 `rawInput` 仍必填（作为原始输入证据）。

实现落点见 §3.5。`routeTtrpgOpenIntentV1` 是纯函数：输入意图与只读状态快照，输出 preview。

### 5.13 后续阶段的数据契约（接口先定，实现后置）

以下三项首期不实现，但**类型与事件入口必须在首期一并冻结**，避免后续阶段反过来改地基。

**运行时条件注入**（阶段 P7）

```ts
export interface TtrpgContextTriggerV1 {
  triggerKey: string
  logic: 'text-match' | 'predicate' | 'both' | 'always'
  textPatterns: string[]                     // 归一化后整词匹配；中文整词匹配默认关闭
  predicate: TtrpgPredicateV1 | null
  audience: 'gm-only' | 'party' | 'private' | 'public'
  knownByActorKeys: string[]
  injectText: string
  group: string | null                       // 同 group 互斥，只注入优先级最高的一条
  priority: number                           // 0..100
  timing: {
    stickyWorldTurns: number                 // 命中后持续注入 N 轮
    cooldownWorldTurns: number
    delayWorldTurns: number
  }
  sourceRefs: string[]
}
```

**确定性上下文预算**（阶段 P7）

```ts
export interface TtrpgContextBudgetReceiptV1 {
  tiers: Array<{
    tierKey: 'rules' | 'authority-state' | 'active-situations' | 'known-facts'
      | 'recent-events' | 'memory-summary' | 'dynamic-injection' | 'flavor'
    demotable: boolean
    includedTokens: number
    demoted: boolean
    demoteReason: string | null
  }>
  totalTokens: number
  budgetTokens: number
  overflowHandled: boolean
}
```

不可降级层固定为 `rules` 与 `authority-state`。超预算时按 `flavor` → `dynamic-injection` → `memory-summary` → `recent-events` → `known-facts` → `active-situations` 顺序降级；若降完仍超预算，终态为失败而不是发送被截断的上下文（沿用 `assertTtrpgCompleteContextV1`）。

**叙事记忆**（阶段 P8，唯一计划新增的表）

```ts
export interface TtrpgNarrativeMemoryV1 {
  id?: number
  projectId: number
  worldGroupId: number
  worldId: number
  workId: number
  sessionId: number
  revisionKey: string
  observerKey: string | null                 // reliability 为 hearsay/belief 时必填
  reliability: 'observed' | 'hearsay' | 'belief'
  audience: 'gm-only' | 'party' | 'private' | 'public'
  knownBy: string[]
  summary: string
  fromEventSequence: number
  toEventSequence: number
  sourceSessionId: number | null
  derivedFromHash: string
  stale: boolean
  updatedAt: number
}
```

字段与 §14.3 的 Dexie 索引字符串一一对应。`reliability='belief'` 的记忆**不得作为规则裁定依据**，只能进角色上下文。

## 6. 事件与状态机

### 6.1 事件总则

全部走 `applyTtrpgRuntimeEventV1`（`runtime-event-reducer.ts:46`）的 `ttrpg.` 命名空间。类型注册必须两处同改：**先**加入 `src/lib/types/product-runtime.ts:1155` 的 `PRODUCT_RUNTIME_EVENT_TYPES`（唯一权威闭集），**再**加入 `runtime-commands.ts:28` 的 `FormalTtrpgEventType`（模块私有 `Extract` 过滤器）。只改后者不会通过类型检查。

幂等沿用既有做法：同一 `commandId` 且 `type`、`baseSequence`、`baseStateHash`、意图内容一致时返回既有事件；任一不同则拒绝。每个事件 payload 必须带 `commandId` 字段且等于 `event.commandId`，不等即拒绝。**不得把合法重放实现成无条件抛错。**

**`commandId` 规则中的 `<seq>` 一律指命令提交时携带的 `baseSequence`**（客户端在提交前已知），**不是结果事件的 `eventSequence`**。否则 key 无法在提交前计算，幂等永远不会命中。需要对同一基序号重复动作（典型是重掷 Oracle）时，必须显式递增 `attempt` 并写进 key：`oracle.<oracleKey>.<baseSequence>.<attempt>`，`attempt` 从 1 开始。

### 6.2 新增事件清单

首期（P2–P6）交付 E1–E13、E17、E18；E14–E16 在 P7/P8/P10 交付，但类型与 reducer 分支占位必须在 P2 一并定义，分支内抛「阶段未启用」而非留空。

**Session Zero 完成的判定条件**（E1/E4 的拒绝条件引用它）：既有 `ttrpg.session-zero.completed` 事件已写入，即 `state.ttrpg.product.sessionZero.completed === true` 且 `completedAtSequence !== null`。该事件由既有 `completeTtrpgSessionZero`（`runtime-commands.ts:756`）产生，本方案不新增。

| # | 事件类型 | actorKey | commandId 规则 | 关键 payload | reducer 行为 | 拒绝条件 |
|---|---|---|---|---|---|---|
| E1 | `ttrpg.open.run.started` | `gm` | `open.start.<sessionId>` | `commandId`、`runFormat`、`frozenFactIndexHash`、`companionActorKeys`、`openingSituationKeys` | 初始化 `openRun`：`worldTurn=0`、`chaos.value=5`、每个 `campaign.clocks` 建档且 `value = initialValue`、fronts 建档、companions 建档、gates/failures/stage 置空 | 非 `open`；Session Zero 未完成；`openRun` 已存在 |
| E2 | `ttrpg.open.intent.previewed` | `gm` | `intent.pre.<intentKey>` | `commandId`、`intent: TtrpgOpenIntentV1`、`preview: TtrpgOpenIntentPreviewV1` | `requiresConfirmation` 时写 `intents.pendingConfirmation`；`route='needs-clarification'` 时 `clarificationCounts[clarificationThreadKey] += 1`，其余 route 一律把该键清零；`isRetreat && route='no-roll' && requiresConfirmation === false` 时按 §5.9 推进 chaos（需确认的留给 E3，避免重复变动） | 意图字段非法；`route='rejected'` 却写入 `pendingConfirmation`；`clarificationCounts[clarificationThreadKey]` 已达 3 却仍返回 `needs-clarification` |
| E3 | `ttrpg.open.intent.confirmed` | `player:*` | `intent.ok.<intentKey>` | `commandId`、`intentKey`、`confirmedBy: { viewerKey, actorKey }` | 移出 pending，允许后续结算；若该意图 `isRetreat && route='no-roll'`，按 §5.9 推进 chaos（`player-retreat`） | 无对应 pending；`confirmedBy.actorKey` 不是该意图的 actor；该席位 `controller !== 'human'`（即队友或模型代替真人确认） |
| E4 | `ttrpg.oracle.consulted` | `gm`、`player:*` 或 `companion:*` | `oracle.<oracleKey>.<seq>.<attempt>` | `commandId`、`outcome: TtrpgOracleOutcomeV1`、`rollReceipt: TtrpgOracleRollReceiptV1`、`previousOracleEventSequence` | 写 `oracle.byKey`/`consultedCount`/`consultedThisWorldTurn`；**不改 chaos**（§5.9） | Session Zero 未完成；`oracleKey` 不在冻结规则包；回执复算失败；`consultedThisWorldTurn >= 2`；同 commandId 内容不同 |
| E5 | `ttrpg.fact.asserted` | `gm` | `fact.<factKey>.<seq>` | `commandId`、`fact: TtrpgSessionFactV1`、`gateResults` | 写 `facts.bySubject` | F1–F4 任一不通过；`origin='oracle'` 但 `originRef` 不指向已存在的 E4；谓词不在受控表 |
| E6 | `ttrpg.fact.retired` | `gm` | `fact.retire.<factKey>.<seq>` | `commandId`、`factKey`、`reason` | 标 retired，移入 `retiredKeys` | 事实不存在；已 retired |
| E7 | `ttrpg.world-turn.advanced` | `gm` | `turn.<worldTurn>`（`<worldTurn>` 取**推进后**的值，即 `当前 worldTurn + 1`） | `commandId`、`reason`、`byEventSequence` | `worldTurn += 1`；`oracle.consultedThisWorldTurn = 0`；全部 `companions[*].consecutiveActions = 0` | `reason` 不在 §5.4 白名单；同一 `byEventSequence` 重复推进 |
| E8 | `ttrpg.clock.ticked` | `gm` | `clock.<clockKey>.<seq>` | `commandId`、`clockKey`、`delta`、`triggerSource`、`triggerKey`、`valueBefore`、`valueAfter`、`atWorldTurn` | 写 `pressure.clocks[clockKey]`：`value = min(maximum, valueBefore + delta)`、刷新 `lastAdvancedSequence`/`lastAdvancedWorldTurn`；`valueAfter >= maximum` 时按 §5.9 推进 chaos，并把 `onCompleteEffectPlanRef` 作为独立 EffectPlan 提交（经既有 `commitTtrpgEffectPlanV2`，不在本事件内结算） | `clockKey` 不在冻结 `campaign.clocks`；`triggerSource` 不在闭集 `'author-trigger' \| 'auto-failed-check' \| 'auto-idle' \| 'auto-oracle-no' \| 'auto-stage-close' \| 'escalation' \| 'situation-outcome'`；`delta <= 0`；`valueBefore` 与当前状态不一致；`valueAfter !== min(maximum, valueBefore + delta)` |
| E9 | `ttrpg.front.telegraphed` | `gm` | `front.tg.<telegraphKey>.<seq>` | `commandId`、`frontKey`、`telegraphKey`、`audience`、`telegraphWorldTurn` | 记录序号与 worldTurn | `audience` 非 `party`/`public`；`telegraphKey` 不在冻结 front |
| E10 | `ttrpg.front.advanced` | `gm` | `front.adv.<frontKey>.<stageKey>` | `commandId`、`frontKey`、`stageKey`、`effectPlanRef`、`telegraphEvidence` | 更新 `currentStageKey`；按 §5.9 推进 chaos；`newSituationTemplateKey` 非空时触发 E11 实例化 | **对应 telegraph 未投放，或 `currentWorldTurn - telegraphWorldTurn < minLeadWorldTurns`**；clock 未达 `atClockValue` |
| E11 | `ttrpg.situation.changed` | `gm` | `sit.<situationKey>.<seq>` | `commandId`、`situationKey`、`templateKey`、`transition: 'activated' \| 'queued' \| 'progressed' \| 'resolved' \| 'expired'`、`instance`（`queued` 时为 `null`）、`discoveredEvidenceRefs`/`satisfiedObstacleKeys`（仅 `progressed`）、`gateResults` | `activated` → 写入 `situations.active` 且 `instance.status='active'`；`queued` → 把 `templateKey` FIFO 追加到 `situations.queuedTemplateKeys`（已在队列中则不重复追加），不创建实例；`progressed` → 把 payload 的两个数组并入该活跃实例的 `discoveredEvidenceRefs` / `satisfiedObstacleKeys`（并集，不删除）；`resolved`/`expired` → 移入 `resolved`、按 §5.8 运行时约束 5/6 写 `status`+`resolutionKind`、写 `cooldownUntilWorldTurn[templateKey] = worldTurn + 3`，随后 FIFO 取 `queuedTemplateKeys` 首项重试；`resolved` 且 `resolutionKind === 'intervened'` 时按 §5.9 回落 chaos（`front-defeated` 由 E12 负责，本事件不重复变动） | `transition='activated'` 但实例门 I1–I7 任一不通过；`transition='queued'` 但 I1–I4 中有不通过项（应丢弃而非入队）、I5 不通过（同模板已活跃，应直接返回既有实例）、或 I6/I7 其实都通过（应直接 activate）；`transition='progressed'`/`'resolved'`/`'expired'` 但实例不在 active；`progressed` 的 ref 不在该模板的 `evidence`/`obstacles` 内；`queued` 时携带非 null `instance` |
| E12 | `ttrpg.front.defeated` | `gm` | `front.def.<frontKey>.<seq>` | `commandId`、`frontKey`、`satisfiedPredicates` | 标 defeated；按 §5.9 回落 chaos（本局唯一一次）；该 front 驱动的活跃实例经 E11 置 `resolutionKind='front-defeated'`，E11 分支不再动 chaos | `defeatPredicates` 未全部满足 |
| E13 | `ttrpg.open.stage.closed` | `gm` | `stage.<index>.<seq>` | `commandId`、`stageIndex`、`triggerKey`、`summary` | 写 `stage.closedStageSummaries`，`index += 1`；按 §5.9 回落 chaos；按 `autoAdvance.onStageClose` 需要推进的时钟**另发 E8**，本事件不直接改 clocks | 无 trigger 满足且未达 `maximumWorldTurns` |
| E17 | `ttrpg.open.gates.evaluated` | `gm` | `gates.<seq>` | `commandId`、`results: Record<TtrpgOpenGateKeyV1, { passed, evidence }>` | 写 `gates.results`、`lastEvaluatedSequence`；逐门更新 `consecutiveFailures`（失败 +1，通过归零） | 结果缺门；`evidence` 为空而 `passed=false` |
| E18 | `ttrpg.open.failure.logged` | `gm` | `fail.<category>.<seq>.<n>`（`<n>` 为同一 `<category>` 在同一 `baseSequence` 下的第几次，从 1 开始） | `commandId`、`log: TtrpgOpenFailureLogV1` | 追加到 `failures` 环形缓冲（上限 200，超出丢最旧）；不改业务状态 | `category` 不在闭集；`violatedRule` 为空 |
| E14 | `ttrpg.context.assembled` | `gm` | `ctx.<seq>` | `commandId`、`receipt: TtrpgContextBudgetReceiptV1` | 只记录，不改业务状态 | 不可降级层被降级 |
| E15 | `ttrpg.memory.recorded` | `gm` | `memory.<revisionKey>.<seq>` | `commandId`、`memory`、`revisionKey`、`sourceLineageHash` | 同一事务内写事件、记忆行、索引与 runtime head | 区间/血缘越界；唯一 revision 冲突；`hearsay`/`belief` 缺 `observerKey` |
| E16 | `ttrpg.audio.cue.applied` | `gm` | `audio.<slotKey>.<seq>` | `commandId`、`slotKey`、`channel`、`action`、`fade` | 更新音频状态投影 | audience 越界 |

E14–E16 属后续阶段（P7/P8/P10）。E17、E18 属首期：E17 在 P6b 随四门交付，E18 在 P2 随发布门与失败日志交付。

E10 的拒绝条件是本方案最关键的机器约束：**没有征兆就不能升级**，由 reducer 强制而不是靠提示词。

### 6.3 主持循环时序

```text
玩家输入
 ①输入分类        → 对白 / 行动 / 规则询问 / 桌外讨论（沿用 classifyTtrpgSubmittedIntentV2）
 ②意图解析        → Skill `prose.ttrpg-open-intent` 产出 TtrpgOpenIntentV1 候选
 ③行动预检        → route、风险、代价、不可逆性、缺失参数（E2）
                     ✗ needs-clarification → 追问，不推进 worldTurn
 ④玩家确认        → requiresConfirmation 时等待 E3；未确认不进入 ⑤
 ⑤前置校验        → 谓词求值（物品在否、关系够否、位置可达否）
                     ✗ → 返回原因 + 至少一条替代方向，不推进时间
 ⑥裁定路由        → existing-action / generic-check → resolution + dice（既有）
                     oracle → E4
                     no-roll → 直接记录
 ⑦权威提交        → effect-plan / effect-runtime（既有）
                     新事实 → session-facts 四门（E5）
 ⑧worldTurn 推进   → 仅已确认且完成的游戏内行动（E7）
 ⑨压力结算        → clocks 自驱（E8）→ 征兆（E9）→ 升级（E10）→ 击败（E12）
 ⑩局势维护        → 实例化 / 消解 / 到期（E11）
 ⑪四门求值        → open-gates（§8.1）→ E17
 ⑫AI 队友行动      → 授权窗口内逐个提出候选，经同一 ②–⑩ 链路
 ⑬上下文装配      → context-trigger → context-budget（E14，后续阶段）
 ⑭按受众表达      → viewer-projection，分别产出 KP / 各玩家 / 公开视图
 ⑮媒资派发        → 异步，失败降级（E16，后续阶段）
 ⑯阶段收束判定    → stageClosurePolicy（E13）
 ⑰记忆归档        → 达阈值时生成区间摘要（E15，后续阶段）
```

**阻塞关系**：③④⑤⑥⑦⑧⑨⑩⑪为同步阻塞，必须在 ⑭表达之前完成。⑫遵守 `maxAiActions` 上限并在真人决定前让出控制权。⑮异步且失败不回滚。⑩⑰可延后到轮末批量处理。

**四门求值时机固定在 ⑪**：压力与局势结算之后、表达之前。

### 6.4 回放与回退语义

| 操作 | 事实层 | 压力 | 局势 | Oracle | 记忆 | 媒资 |
|---|---|---|---|---|---|---|
| 刷新页面 | 由事件重放 | 不变 | 不变 | 不变 | 不变 | 重新拉取或降级 |
| 读档到 checkpoint | `originEventSequence > cp` 的事实自动失效 | clocks/fronts 回到该序号状态，`telegraphWorldTurns` 同步回退 | 活跃实例按序号回退；`noInterventionDueWorldTurn` 重算 | 该序号后的结果不再生效，事件记录保留 | `fromEventSequence > cp` 失效；`derivedFromHash` 不匹配标 stale | 运行时请求取消，发布媒资不变 |
| 创建分支 | 继承父状态后独立 | 同 | 同 | 同 | 分支只克隆切点内记录 | 同 |
| 回退后重掷 Oracle | — | — | — | 新 `commandId`，新结果；两次都在事件流可查 | — | — |

**约束**：回退不得只删聊天记录。任何回退必须同步回退事实、压力、局势、worldTurn 与依赖它们的一切派生状态；回退后 `open-gates` 必须重新求值。`worldTurn` 由事件重放得出，不单独存快照。

### 6.5 失败日志

```ts
export interface TtrpgOpenFailureLogV1 {
  sessionId: number
  atSequence: number
  atWorldTurn: number
  category:
    | 'fact-conflict'            // F1–F4
    | 'gate-failed'              // 四门
    | 'situation-rejected'       // 实例门
    | 'situation-capacity'       // 活跃上限
    | 'telegraph-missing'        // E10 被拒
    | 'oracle-scope-violation'   // 解释越界
    | 'oracle-budget'            // 本轮咨询超限
    | 'intent-unclear'           // needs-clarification 达上限
    | 'predicate-unresolvable'   // 谓词引用不存在的对象，或 predicateKey 不在受控表内
    | 'budget-overflow'          // 不可降级层被挤
    | 'media-degraded'           // 非阻塞，仅记录
  violatedRule: string           // 具体门/约束标识，如 'F4' | 'gate.exit-exists' | 'S1'
  relatedRefs: {
    factKeys: string[]
    situationKeys: string[]
    frontKeys: string[]
    triggerKeys: string[]
    oracleKeys: string[]
    slotKeys: string[]
  }
  evidence: string[]             // 可读冲突说明，含被引用的 release/index hash
  recovery: 'reject-candidate' | 'regenerate-local' | 'request-author-review'
    | 'degrade-to-fallback' | 'pause-session'
  recoveryAttempt: number
  recoveryMaxAttempts: number
}
```

**约束**：所有重试必须有上限；达到上限后进入下一级恢复策略或安全暂停，不允许「不断重试直到成功」。`category='media-degraded'` 不消耗玩家资源也不计入失败率。安全暂停、内容修订与技术错误纠正不消耗玩家游戏资源（沿用契约既有条款）。

**存储与读取**：失败日志经 E18 写入 `openRun.failures` 环形缓冲（上限 200 条），由 `recordTtrpgOpenFailureV1` 构造。作者态通过 `ttrpgOpenGateResults` 读源查看（§10.2），**不进任何玩家投影**，不落新表。

### 6.6 命令入口清单

每个新事件都必须有一个具名命令作为唯一提交入口，全部放在 `src/lib/ttrpg/runtime-commands.ts`，签名统一为 `input: FormalTtrpgCommandEnvelope & { ... }`，返回 `Promise<ProductRuntimeEvent>`。**不得由 UI 或 store 直接写事件表。**

| 事件 | 命令 | 阶段 |
|---|---|---|
| E1 | `startTtrpgOpenRunV1` | P2 |
| E2 / E3 | 扩展既有 `submitTtrpgActionIntentV2`（`openIntent` / `confirmationOf` 两个可选入参，§5.12） | P3 |
| E4 | `consultTtrpgOracleV1` | P4 |
| E5 / E6 | `assertTtrpgSessionFactV1` / `retireTtrpgSessionFactV1` | P4 |
| E7 | `advanceTtrpgWorldTurnV1` | P2 |
| E8 | `tickTtrpgClockV1` | P5 |
| E9 / E10 / E12 | `telegraphTtrpgFrontV1` / `advanceTtrpgFrontV1` / `defeatTtrpgFrontV1` | P5 |
| E11 | `changeTtrpgSituationV1`（`transition` 为入参） | P2（`activated`/`queued`）/ P6a（`progressed`/`resolved`/`expired`） |
| E13 | `closeTtrpgOpenStageV1` | P6b |
| E17 | `evaluateTtrpgOpenGatesV1` | P6b |
| E18 | `recordTtrpgOpenFailureV1`（与 `open-gates.ts` 的同名导出同一函数，由它构造 log 后提交） | P2 |
| E14 / E15 / E16 | `recordTtrpgContextAssemblyV1` / `recordTtrpgNarrativeMemoryV1` / `applyTtrpgAudioCueV1` | P7 / P8 / P10 |

**挂在既有事件上的 `openRun` 写入**（不新增命令，只在既有命令的 reducer 分支里补逻辑）：

| 既有事件 | 补写什么 | 阶段 |
|---|---|---|
| `ttrpg.check.resolved`、`ttrpg.rule.action.resolved` | 失败档时按 §5.9 推进 chaos | P4（与 chaos 规则同批，避免 P2 先写一半） |
| 同上 | actor 为 AI 队友时 `companions[].consecutiveActions += 1`、刷新 `lastActedWorldTurn` | P3 |

P2 只实装 `openRun.chaos` 的容器与初值；chaos 的推进/回落规则随 P4 一起落地，P2 的回归只断言初值为 5。

## 7. 生产到运行的 `runFormat` 分流

`open` 不是把 `scenes`、`endings` 设为空后绕过校验。以下**八层**必须逐项有 `runFormat` 分支。**仅修改 `campaign.ts` 不得宣称 `open` 可开局。**

### 7.1 分流矩阵

| 层 | 文件 | `scripted` | `open` | 共同约束 |
|---|---|---|---|---|
| 内容解析 | `campaign.ts` | 现有 30 字段 + 新 7 字段按 §5.1 的 `scripted` 取值约束 | 新 7 字段必填且非空；`scenes`/`clues`/`quests`/`endings`/`handouts`/`advancementMilestones` 允许为 `[]`，`openingSceneKey` 必须为固定常量 `'open-run'`，`tabletop` 允许为 `null` | `exact()` 闭集；key 正则 |
| 发布校验 | `campaign.ts` `validateTtrpgCampaignForPublicationV1` | 保留 BFS 可达性、`deadEndSceneKeys`、`unreachableEndingKeys` 与五类 counterexample，**完全不动** | 直接返回 `structural` 全空 + `valid` 由 `assertTtrpgOpenPublicationGatesV1` 决定（§8.3） | 失败可定位到 key |
| 生产编译 | `production-compiler.ts` | 从 narrative 编译闭合 scenes / clues / endings | 编译世界引用、作者局势层、冻结事实索引、效果计划模板、AI 队友配置、阶段收束策略；**不伪造闭合结局** | 产物有版本、来源与 hash |
| 发布质量门 | `src/lib/product-production/product-quality.ts` | 现有 6 个跑团门 + `product.narrative.endings >= 2`，判定与证据字符串完全不变 | 按 §8.3 的逐门表求值 | 失败可定位，不以模型文本替代 |
| 运行初始化 | `runtime.ts` `createInitialTtrpgProductStateV1` | `openingSceneKey`、静态 scene/clue/ending catalog，`openRun=null` | `openRun` 由 E1 初始化；初始状态中 `sceneKeys=[]`、`openedSceneKeys=[]`、`clueCatalog=[]`、`endingCatalog=[]`、`ending=null`、`clockCatalog` 仍从 `clocks` 编译（压力需要）、`scene=null` | 都绑定不可变 ProductRelease |
| 命令路由 | `runtime-commands.ts` | 当前 scene 的 `actionKeys` 与 `nextSceneKeys` | 意图 → 预检 → 确认 → 规则/Oracle/直接结算；局势切换**不伪装成** scene navigation。`openTtrpgCampaignScene`、`discoverTtrpgClue`、`completeTtrpgCampaignEnding` 三个命令在 `open` 下必须先调 `assertTtrpgScriptedOnlyV1` 并拒绝 | 事件幂等、状态 hash、权限校验 |
| 上下文投影 | `gm-context.ts`、`npc-context.ts`、`player-context.ts`、`narrator-context.ts`、`director-context.ts`、`private-guidance.ts`、`viewer-projection.ts` | scene / clue / ending 投影 | 活跃局势、已知事实、队友观察、压力征兆、worldTurn、阶段状态 | audience 过滤一致 |
| 完成语义 | `runtime-commands.ts` | `completeTtrpgCampaignEnding` 选择结局并复盘 | 阶段收束（E13）/ 暂停 / 继续 /（P8）补丁候选导出 | 不自动回写 WorldRelease |

### 7.2 为什么 `open` 仍要发布包

`open` 没有闭合场景图，但仍必须发布为不可变 ProductRelease，session 绑定 `runtimeSourceHash`。理由：正式命令提交会核对冻结运行源（`verifyFormalTtrpgSource`，`runtime-commands.ts:57`，模块私有）。没有发布包，新增事件没有可校验的 session，也无法保证回放一致。

社区分发的 `bundleHash` 只负责安装前完整性校验，不作为 session 的运行绑定键。

### 7.3 发布格式分流的实现守卫

`src/lib/ttrpg/run-format.ts` 必须导出：

```ts
export function resolveTtrpgRunFormatV1(campaign: TtrpgCampaignContentV1 | unknown): 'open' | 'scripted'
export function assertTtrpgOpenOnlyV1(runFormat: string, operation: string): void   // 非 open 即抛
export function assertTtrpgScriptedOnlyV1(runFormat: string, operation: string): void
export function projectLegacyTtrpgCampaignV1(raw: unknown): { campaign: TtrpgCampaignContentV1, wasLegacy: boolean }
export function projectLegacyTtrpgRulePackV1(raw: unknown): { rulePack: RulePackV1, wasLegacy: boolean }
```

所有 `open` 专属命令与 reducer 分支的第一行必须调用 `assertTtrpgOpenOnlyV1`。所有 `scripted` 专属路径（`openTtrpgCampaignScene`、`discoverTtrpgClue`、`completeTtrpgCampaignEnding`）必须调用 `assertTtrpgScriptedOnlyV1`。**禁止用 `if (campaign.scenes.length === 0)` 这类间接推断代替显式判定**（§21 D9）。

### 7.4 旧包兼容

| 对象 | 处理 |
|---|---|
| 旧 CampaignPack（无新字段） | `projectLegacyTtrpgCampaignV1` 在内存补齐**全部**新字段：①顶层 `runFormat='scripted'`、四个空数组（`canonInvariantPredicates`/`situationTemplates`/`openingSituationKeys`/`effectPlanTemplates`）、两个 `null`（`companionPolicy`/`stageClosurePolicy`）；②每个 `clocks[]` 补 `autoAdvance={onFailedCheck:0,onIdleWorldTurns:0,onOracleNo:0,onStageClose:0}`、`onCompleteEffectPlanRef=null`，每个 `advanceTriggers[]` 补 `condition=null`；③每个 `fronts[]` 补 `escalationStages=[]`、`telegraph=[]`、`defeatPredicates=[]`。原始 JSON 字节保留用于哈希校验，不改写记录 |
| 旧 RulePack（无 `oracles`） | `projectLegacyTtrpgRulePackV1`：先按原始序列化内容验 `contentHash`，再在内存补 `oracles: []` |
| 已开局 session | 不受影响。session 绑定 ProductRelease 及其 `runtimeSourceHash`；内容更新只影响新开局 |
| 升级为 `open` | 必须由作者显式迁移并产生新版本与新 Release，不允许原地转换 |

**兼容投影一律发生在哈希校验之后**，绝不参与哈希计算。每一条都必须有正反例回归：既有跑团回归全绿，且「旧包哈希不变」有专项断言。

## 8. 质量门

### 8.1 `open` 运行时四门

替代穷举可达性。求值时机固定在主持循环 ⑪，结果经 E17 提交。门 key 为 `TtrpgOpenGateKeyV1`。

**证据图的显式定义**（G2 依赖它）：节点有三类——`evidence[].clueRef`、`obstacles[].obstacleKey`、`interventionPoints[].pointKey`；边有三类——`evidence[].coversObstacleKeys` 给出「证据 → 障碍」，`obstacles[].dependsOn` 给出「障碍 → 障碍」，`interventionPoints[].targetsObstacleKeys` 给出「介入点 → 障碍」。某 `interventionPoint` 视为**可形成假设**，当且仅当：①它的 `requiresPredicate` 为 `null` 或可满足；②它 `targetsObstacleKeys` 中每个障碍的全部 `dependsOn` 传递前驱，都已被覆盖——「已被覆盖」= 该前驱在实例的 `satisfiedObstacleKeys` 中，或存在某条玩家已知 evidence 的 `coversObstacleKeys` 含该前驱。「玩家已知」= 已进入该实例的 `discoveredEvidenceRefs`，或该 evidence 的 `audience='party'`，或 `audience='private'` 且当前玩家在其 `knownByActorKeys` 中。全部为集合运算与图可达，无自由文本参与。

| 门 | key | 判定方式（可机器求值） | 失败处理 |
|---|---|---|---|
| G1 出路存在 | `exit-exists` | 活跃局势中至少一个 `interventionPoint` 的 `requiresPredicate` 为 `null` 或当前可满足 | 活跃数 <5 时从 `queuedTemplateKeys` 取队首实例化；活跃数已满则改为揭示一条 `isRequired=false` 的 evidence（与 G2 同一手段）；连续失败 3 轮（`consecutiveFailures >= 3`）则 `request-author-review` |
| G2 假设可形成 | `hypothesis-formable` | 至少一个活跃局势的 `interventionPoint` 按上述定义**可形成假设** | 揭示一条 `isRequired=false` 的 evidence，或通过 NPC 传闻给线索 |
| G3 征兆齐备 | `telegraph-complete` | 对每个 `escalationStage`，若 `pressure.clocks[stage.clockKey].value >= stage.atClockValue - 1`（「即将达」的精确定义），则该 stage 的 `telegraph` 中**至少一条**已投放且 `worldTurn - telegraphWorldTurns[telegraphKey] >= 该条的 minLeadWorldTurns` | 阻止升级，本轮只投征兆 |
| G4 事实无矛盾 | `facts-consistent` | 对全部未退役会话事实重跑 F1–F3。**F4 是提交期密级门，不属矛盾门，不在本门求值** | 拒绝提交冲突事实，返回冲突位置 |

**四门全部机器判定，不允许以「人工评审」替代。** G4 的全量重跑在事实数 >500 时改为增量校验（只校验本轮新增事实及与其同 `subjectRef`+`predicateKey` 的事实），该优化必须有与全量结果的等价性测试。

### 8.2 局势实例门

局势实例进入 `active` 前必须通过，**开局实例也不例外**。首期只保留可机器判定的项。

| 项 | 判定 |
|---|---|
| I1 前提成立 | `preconditions` 全部可满足 |
| I2 时机可引用 | `whyNowRefs` 至少一条可解析。可解析的 ref 只有四种形式，其余一律视为不可解析：①`world:<subjectRef>:<predicateKey>` 命中冻结事实索引且 `audience` 对当前玩家可见；②`session:<factKey>` 命中未退役会话事实且对当前玩家可见；③`clock:<clockKey>` 命中 `pressure.clocks` 且该 clock 的 `visibility` 为 `party`/`public`；④`telegraph:<telegraphKey>` 命中已投放征兆 |
| I3 引用闭合 | `driverRef`（命中 fronts/characterTemplates）、`suggestedActionKeys`（命中 `rulePack.actions`）、`clueRef`（命中本模板 `evidence[].clueRef`，即 S10 的全局唯一命名空间）、`effectPlanRef`（命中 `effectPlanTemplates[].planKey`）、`nextSituationTemplateKey`（命中 `situationTemplates[].templateKey`）全部可解析 |
| I4 不介入有后果 | `noInterventionOutcome.effectPlanRef` 或 `advancesClockKeys` 非空 |
| I5 不重复 | 同 `templateKey` 无活跃实例 |
| I6 容量 | 活跃实例数 < 5 |
| I7 冷却 | `situations.cooldownUntilWorldTurn[templateKey]` 不存在，或 `worldTurn >= cooldownUntilWorldTurn[templateKey]`。E11 在实例离开 `active` 时写 `cooldownUntilWorldTurn[templateKey] = 当前 worldTurn + 3` |

任一不通过即不进入玩家可见池。处置与 §5.8 运行时约束 3 完全一致：I1/I2/I3/I4 失败记 `situation-rejected`（E18）并丢弃该次请求；I6/I7 失败发 E11 `transition='queued'` 入队并记 `situation-capacity`（E18）；I5 失败（同模板已活跃）直接返回既有实例，不发任何事件、不入队。

**反套路检查（P9，模型自由生成局势模板时启用）**

| 项 | 判定 |
|---|---|
| A1 非同构 | 取最近 8 个未拒绝局势。动机相同，且障碍 `kind` 多重集与介入点 `suggestedActionKeys` 多重集的**加权 Jaccard** 相似度都 ≥0.80 即拒绝。加权 Jaccard 定义为 `Σ min(countA(x), countB(x)) / Σ max(countA(x), countB(x))`，x 取两个多重集元素的并集。阈值是常量，不留「视情况」 |
| A2 有因果依赖 | `obstacles[].dependsOn` 至少一条非空边且无环（同 S1） |
| A3 有个性化引用 | 至少一条引用指向玩家先前选择、身份或承诺的事实 key |

文本是否「充分支持目标」没有判定器，**不设为硬门**，只进真实模型评测（§13.4）。

### 8.3 `open` 发布期静态门

门 id 沿用 `product.ttrpg.*` 前缀，便于 `productQualityGateReceipts` 复用。

| 门 id | 判定 |
|---|---|
| `product.ttrpg.rules` | 与 `scripted` 相同：`rulePack.tests.length >= 1` 且 `license.commercialUse`；**额外**要求 `oracles.length >= 1` 且每张表至少一条 `tests` 夹具 |
| `product.ttrpg.open-situation-layer` | `situationTemplates.length >= 3`；`openingSituationKeys.length >= 1` 且全部命中；所有模板通过 S1–S10 |
| `product.ttrpg.open-pressure` | `clocks.length >= 1`；`fronts.length >= 1`；每个 front 的 `escalationStages.length >= 1`、`telegraph` 覆盖全部 stage、`defeatPredicates.length >= 1` |
| `product.ttrpg.open-canon` | `canonInvariantPredicates.length >= 1` 且全部可解析到冻结事实索引或 campaign key |
| `product.ttrpg.safety-and-companions` | `sessionZero.consentChecklist.length >= 3` 且 `pauseSignal` 非空；`companionPolicy` 非空；`confirmationRequiredKinds` **四项齐备**（`irreversible`/`resource-spend`/`party-relation-change`/`secret-reveal`）；`minimumCompanions >= 2`；`characterTemplates` 中 `role='player'` 的数量 ≥ `companionPolicy.minimumCompanions + 1` |
| `product.ttrpg.open-closure` | `stageClosurePolicy` 非空；`triggers.length >= 1` 且谓词可解析；`maximumWorldTurns` 在 10..1000 |
| `product.ttrpg.open-effect-plans` | `effectPlanTemplates.length >= 1`；`planKey` 唯一；全部 `effectPlanRef` 引用可解析；每个模板的 `effects` 非空 |
| `product.ttrpg.open-clock-disjoint` | `effectPlanTemplates` 的任何 `effects` 项都不是 `operation === 'clock.advance'`（§5.7 硬约束 7） |

**逐门求值表（`product-quality.ts` 必须按此分流，不留隐式行为）**

| 门 id | `scripted` | `open` |
|---|---|---|
| `product.narrative.play-loop` | 求值（不变） | 求值（不变，`open` 的 narrative 仍有非结局节点与选择） |
| `product.narrative.endings` | 求值（`>= 2`） | **跳过** |
| `product.ttrpg.rules` | 求值（不变） | 求值（**加强**：另需 `oracles.length >= 1` 且每张表 `tests.length >= 1`） |
| `product.ttrpg.campaign-loop` | 求值（不变） | **跳过** |
| `product.ttrpg.clue-redundancy` | 求值（不变） | **跳过** |
| `product.ttrpg.counterexample-replay` | 求值（不变） | **跳过** |
| `product.ttrpg.campaign-bible-and-pressure` | 求值（不变：bible 且 clocks/fronts/secrets 均 >0） | **跳过**，由 `product.ttrpg.open-pressure` 取代（后者要求更严） |
| `product.ttrpg.safety-and-tabletop` | 求值（不变） | **跳过**，由 `product.ttrpg.safety-and-companions` 取代 |
| `product.ttrpg.open-situation-layer` | 跳过 | 求值 |
| `product.ttrpg.open-pressure` | 跳过 | 求值 |
| `product.ttrpg.open-canon` | 跳过 | 求值 |
| `product.ttrpg.safety-and-companions` | 跳过 | 求值 |
| `product.ttrpg.open-closure` | 跳过 | 求值 |
| `product.ttrpg.open-effect-plans` | 跳过 | 求值 |
| `product.ttrpg.open-clock-disjoint` | 跳过 | 求值 |

`scripted` 一侧的 8 个门判定逻辑与证据字符串**完全不变**，只在外层加 `runFormat === 'scripted'` 条件。`open` 一侧共求值 9 个门（2 个共享 + 7 个专属）。

## 9. Agent / Skill / Prompt 层

按 `docs/HARNESS-QUALITY-STANDARD.md`，每个 Skill 必须声明读写权限、候选与采纳链、失败恢复与证据留存。

### 9.1 Skill 清单

现有 5 个跑团 Skill（`src/lib/agent/skill-registry.ts:3487` 起）：`prose.ttrpg-private-guidance`、`prose.ttrpg-director`、`prose.ttrpg-gm-narrator`、`prose.ttrpg-player-intent`、`prose.ttrpg-gm-actor-intent`。它们服务 `scripted`，**语义不得被静默扩展到 `open`**。

本方案新增 8 个 Skill。首期（P3–P5）交付 6 个，`situation-propose` 与 `open-brief` 随 P9/P8 交付。

| Skill id | promptVersion | 阶段 | 职责 | 可读 | 可写 | 产出 | 不允许 | regressionTests |
|---|---|---|---|---|---|---|---|---|
| `prose.ttrpg-open-intent` | `ttrpg-open-intent-v1` | P3 | 玩家/队友自然语言 → 目标、方法、对象、风险预检 | 当前玩家投影、规则行动、权威状态、Session Zero | 无 | `TtrpgOpenIntentV1` + `TtrpgOpenIntentPreviewV1` 候选 | 直接提交行动、替玩家确认重大代价、改权威状态 | `R-TTRPGOPEN4-intent-route` |
| `prose.ttrpg-open-companion` | `ttrpg-open-companion-v1` | P3 | AI 队友基于自身目标、观察与授权提出行动 | 角色观察、已知事实、活跃局势、队伍公开状态 | 无 | 队友行动候选（同样是 `TtrpgOpenIntentV1`） | 读 GM-only 真相、替玩家决定重大行动、绕过意图路由 | `R-TTRPGOPEN4-companion-bounds` |
| `prose.ttrpg-open-kp` | `ttrpg-open-kp-v1` | P3 | 根据已提交结果生成 KP 叙述、下一步提示与局势简报 | 权威回执、受众投影、活跃局势、压力征兆 | 无 | 叙述候选 + 局势简报候选 | 改写结果、增加未授权事实、泄露不可见内容 | `R-TTRPGOPEN7-projection-leak` |
| `prose.ttrpg-oracle-interpret` | `ttrpg-oracle-interpret-v1` | P4 | 把 Oracle 原始结果解释为具体情境 | 本轮上下文、`interpretation.mustRespect`、冻结事实 | 无 | 解释候选 | 改 `rawResult`、超过 `maxNewEntities`、触及 `forbiddenScopes` | `R-TTRPGOPEN2-oracle-scope` |
| `prose.ttrpg-fact-normalize` | `ttrpg-fact-normalize-v1` | P4 | 自由叙述归一到受控谓词 | Oracle 解释候选、规则结算回执、受控谓词表（P3 起另接 KP 叙述候选） | 无 | `TtrpgSessionFactV1` 候选（不含 `factKey`） | 创造受控表外的谓词、自行指定 `factKey` | `R-TTRPGOPEN3-fact-gates` |
| `prose.ttrpg-telegraph` | `ttrpg-telegraph-v1` | P5 | 为即将升级的 front 生成征兆文本 | front、stage、party 可知信息 | 无 | 征兆文本候选 | 泄露 stage 的具体机制与数值 | `R-TTRPGOPEN5-telegraph-required` |
| `prose.ttrpg-open-brief` | `ttrpg-open-brief-v1` | P8 | 阶段复盘摘要（局势简报归 `open-kp`，不重复） | 已揭示内容、party 视图、记忆摘要 | 无 | 复盘候选 | 引用未揭示秘密 | `R-TTRPGOPEN8-stage-closure` |
| `prose.ttrpg-situation-propose` | `ttrpg-situation-propose-v1` | P9 | 从动机与状态生成局势模板候选 | 权威状态、fronts、NPC 动机、已揭示线索 | 无 | 局势模板候选 | 直接写状态、把玩家不可知信息当 `affordanceHint` | `R-TTRPGOPEN10-situation-antipattern` |

**共同约束**

1. 所有 Skill 只产出候选，经作用域、规则、版本、信息边界校验后由内核提交。
2. 任何 Skill 都不能直接改数值、物品、关系、死亡状态——这些只能经 `effect-plan` / 账本。
3. Skill 输入上下文由注册读源与（P7 起）预算装配器统一产出，Skill 不自行拼接上下文。
4. 输出必须可解析为受限结构；无法解析时沿用 `TtrpgDecisionProtocolV1` 语义：首次 `SyntaxError` 允许一次修复重试，其余按失败处理，**不默认成功**。
5. 每次调用留存：约定、实际输入 revision、候选、版本、检查点、结果回执，连接到作品数据。
6. `regressionTests` 字段按上表填写，不得留空。

### 9.2 候选与采纳链

```text
Skill 输出候选
→ 结构校验（schema / 枚举 / 引用存在性）
→ 作用域校验（是否越权写、是否触及 forbiddenScopes）
→ 规则校验（谓词可求值、effectPlan 合法）
→ 信息边界校验（audience 不降级、不引用接收者未知信息）
→ 采纳（写事件）或 拒绝（写 §6.5 失败日志）
```

Session Zero 预授权范围内的 AI 行动不逐次要求作者采纳；**混合席位、重大且含义不清的玩家代价、越界请求必须由相应玩家确认**。

### 9.3 Prompt 模板与 AI 手册

每个新 Skill 至少提供一条内置模板，并在 `docs/AI-FUNCTIONS-MANUAL.semantic.md` 补语义注解（`docs/AI-FUNCTIONS-MANUAL.generated.md` 由代码生成，不手改）。`npm run check:ai-manual` 与 `npm run check:ai-entry-registry` 必须通过。

P3 可复用现有 `prose.ttrpg-gm-narrator`、`prose.ttrpg-player-intent`、`prose.ttrpg-gm-actor-intent` 的 harness 与权限策略实现，但必须新增独立 Skill 条目，不得静默改变既有 `scripted` 行为。

### 9.4 AI 队友行动边界

沿用 `kp-coordinator.ts` 的既有机制并加四条 `open` 专属约束：

1. 单个队友在同一 `worldTurn` 内连续行动数上限 1（`companions[].consecutiveActions`，由 E7 归零）。
2. 队友行动按 `TtrpgOpenIntentPreviewV1.actionKind` 分流：`actionKind` 在 `companionPolicy.preauthorizedActionKinds` 内且 `requiresConfirmation=false` 时自动执行；否则产生建议并等待玩家确认，终态走 `kp-coordinator` 的 `confirmation`。
3. `actionKind='other'`、`irreversible=true`，或命中 `confirmationRequiredKinds` 任一类，一律要求确认。
4. 队友不得作为 E3 的确认者去确认真人角色的意图。reducer 按 `confirmedBy.actorKey` 与席位 `controller === 'human'` 校验。

## 10. 上下文读源与预算

### 10.1 现有读源

`src/lib/registry/context-sources.ts:1856` 起已登记 6 个跑团读源，全部 `scope:'runtime'`、`layer:'L0'`、`ownerFrom:'work'`、`protectedFromTrim:true`、`requiresProductRuntimeSessionId:true`：

| sourceKey | budgetTokens | 实现 |
|---|---|---|
| `ttrpgRuntime` | 10000 | `readTtrpgGmRuntimeContextV1`（`gm-context.ts`） |
| `ttrpgPrivateGuidance` | 8000 | `private-guidance.ts` |
| `ttrpgDirector` | 12000 | `director-context.ts` |
| `ttrpgPublicNarration` | 10000 | `narrator-context.ts` |
| `ttrpgNpcRuntime` | 10000 | `npc-context.ts` |
| `ttrpgPlayerRuntime` | 10000 | `player-context.ts`，`enabled` 要求 `ttrpgPlayerActorKey` |

### 10.2 新增读源

| sourceKey | budgetTokens | 提供内容 | 读取者 | audience 过滤 | 阶段 |
|---|---|---|---|---|---|
| `ttrpgOpenFacts` | 10000 | 会话事实层 | KP、玩家、队友、NPC | 按 `audience` / `knownBy` | P4 |
| `ttrpgOpenOracleHistory` | 6000 | Oracle 咨询与公开结果 | KP、玩家、队友 | `gm-only` 结果仅进 KP | P4 |
| `ttrpgOpenPressure` | 6000 | clocks/fronts 当前值、已投征兆、worldTurn | KP、玩家、队友 | 按 `visibility`；未投征兆的 stage 不出现 | P5 |
| `ttrpgOpenSituations` | 10000 | 活跃局势与介入点 | KP、玩家、队友 | 按 `visibleTo` / `knownByActorKeys` | P6a |
| `ttrpgOpenGateResults` | 4000 | 四门结果与失败日志 | 仅作者/测试态 | **不进任何玩家上下文** | P6b |
| `ttrpgOpenMemory` | 8000 | 按 observer 过滤的记忆召回 | KP、队友、NPC | 按 `knownBy`，排除 stale | P8 |

**硬约束**

1. 新读源必须登记在 `CONTEXT_SOURCES`，由 `npm run check:agent-context` 与 `npm run check:architecture` 守门。
2. P3 的三个 Skill **不得**绕过读源直接从运行状态拼 Prompt。P3 先行时，局势相关内容由 `ttrpgOpenSituations` 提供；P6a 先于 P3 合入，因此 P3 不会遇到该读源缺失的情况（§15.1）。
3. `ttrpgOpenGateResults` 的 `enabled` 必须显式要求作者态标志，禁止默认开启。
4. 玩家态投影不得暴露 `gm-only` 块的存在与计数。

### 10.3 信息边界

沿用既有四档 audience 与 `viewer-projection.ts`。`open` 新增三条：

1. 会话即兴事实不得降低其来源事实的密级（F4）。
2. 角色信念与传闻不得作为规则裁定依据；`reliability='belief'` 的记忆只进上下文、不进谓词求值。
3. 征兆必须对 party 可见（`audience` 限 `party`/`public`），否则 E9 拒绝——否则「升级前有预警」这条承诺在玩家侧不成立。

字符串检查（`assertTtrpgNoRestrictedTextV1`）是补充防线，不是语义绝对保密证明。角色上下文首先排除其未获知的信息。**合法揭示与禁止泄密必须同时有测试。**

## 11. UI 与交互

沿用「玩家不需要操作开发者或人类 GM 管理面板」的契约要求。涉及文件：`src/components/ttrpg/TtrpgPlayTable.tsx`（玩家桌面）、`TtrpgProductionWizard.tsx`（配置）、`TtrpgRuntimePanel.tsx`、`src/stores/ttrpg-runtime-player.ts`。

`TtrpgCampaignGuide.tsx` 当前约 6400 行、305KB。**禁止**把 `open` 的新面板继续堆进该文件；新增组件独立成文件。

### 11.1 玩家态新增

| 位置 | 内容 | 约束 |
|---|---|---|
| 行动区 | 自由输入 + 推荐行动（来自活跃局势的 `interventionPoints`，按 `visibleTo` 过滤） | 推荐行动是低成本入口，不替代自由输入 |
| 行动预检 | 提交前显示角色能判断的风险、可能消耗、是否不可逆 | 只显示角色可知范围；不显示隐藏难度数值；高代价/不可逆需二次确认 |
| 局势简报 | 三项固定结构：当前最明显的可行动线索、已知但未解释的异常、不行动的潜在代价 | 不默认输出完整地图与全部历史 |
| 世界动态 | 传闻、区域变化通报、NPC 主动上门、已投征兆 | 仅 party/public 可见内容 |
| 时间与压力 | 当前 `worldTurn`、party 可见 clocks 的值与上限 | `visibility='gm-only'` 的 clock 不显示，且不暴露其存在 |

### 11.2 AI 队友面板

| 位置 | 内容 | 约束 |
|---|---|---|
| 队友状态 | 每名队友的目标摘要、当前观察、关系态度、可用能力 | 只显示玩家有权知道的投影；不显示内部提示词 |
| 队友建议 | 「我建议调查/交涉/撤退」及理由 | 先形成意图候选；不得直接替玩家角色提交重大行动 |
| 队友行动 | 在授权窗口内自动执行低风险行动 | 复用同一预检、结算、worldTurn 与事件链；遇玩家重大决定立即让出 |
| KP 交接 | KP 说明队友行动结果及对玩家的影响 | 叙述只能引用已提交回执，不得把候选当事实 |

### 11.3 默认输出结构

防止「后台演化了但玩家感受不到」。

```text
地点：旧渡口              世界回合：7    当前压力：潮汛将至（3/4）
当前目标：确认失踪船员是否来过
已知线索：
- 码头东侧有新鲜泥痕
- 守夜人说昨晚听见金属碰撞声
新出现的情况：
- 商会的人今早开始搬运货物（传闻）
可尝试的方向：
1. 检查泥痕   2. 询问守夜人   3. 沿河追踪   4. 查看调查手记
（也可以直接描述你想做的任何事）
```

### 11.4 作者态

| 面板 | 内容 | 阶段 |
|---|---|---|
| 局势模板编辑 | 模板字段、S1–S10 即时校验、动机分布视图、效果计划模板编辑 | P2 |
| Oracle 表编辑 | 表定义、档位、词条权重、`interpretation` 约束、`tests` 夹具；带夹具运行按钮 | P4 |
| 局势层编辑 | fronts / clocks / escalationStages / telegraph（telegraph 缺失时阻止发布） | P5 |
| 四门与失败日志 | 按 §6.5 分类展示，可定位到具体 key；读 `ttrpgOpenGateResults` | P6b |
| KP 上下文检视器 | 本轮注入了哪些块、来源、token 占用、命中的 triggerKey、被降级的块及原因 | P7 |
| 世界补丁审阅 | 本局即兴事实、来源、与冻结事实的冲突、勾选升级 | P8 |

**硬约束**：玩家态不得暴露 `gm-only` 块的存在与计数。作者态与玩家态必须是不同路由，不靠条件渲染混在同一面板。

### 11.5 无障碍与输入容错

四种可切换输出模式：完整叙事、行动摘要、低阅读负担（短句、单意图段落、少隐喻）、屏幕朗读（稳定标题层级、角色/动作/结果标签、不依赖颜色）。

输入容错：同义表达归一化（「查看泥痕 / 检查脚印 / 仔细观察」进同一意图）；缺参数时只追问缺失项。

**约束**：关键任务方向不得只靠颜色传达；安全暂停与技术纠错不消耗玩家资源。

## 12. 首批内容池

内容池承担规则验证作用，但每项都必须具备足以让内核判定的数据条件，不是占位文本。首批挂在 `storyforge-rule-pack.ts`（2d6）与 `d100-investigation-rule-pack.ts` 两套规则包上。

### 12.1 Oracle 表（≥6 张）

| oracleKey | kind | 用途 | 关键配置 |
|---|---|---|---|
| `oracle.yesno.general` | yes-no | 通用是否裁定 | 5 档，`yesButBand=1`、`noButBand=1`，`chaosCoupled=true` |
| `oracle.yesno.npc-cooperates` | yes-no | NPC 是否配合 | 档位由内核按 `effectLedger.socialBalances` 的显式数值分段映射（如 `<-3 → unlikely`、`-3..2 → even`、`>2 → likely`），分段写在内容里；`maxNewEntities=0` |
| `oracle.meaning.action-detail` | meaning | 动作词表 | ≥20 词条 |
| `oracle.meaning.theme-detail` | meaning | 主题词表 | ≥20 词条；与上表配对使用时由 KP 连续掷两张表、产生两次 E4，再合并解释 |
| `oracle.event.complication` | event | 随机并发情况 | ≥12 词条，带 tags 供局势检索 |
| `oracle.event.npc-reaction` | event | NPC 反应倾向 | 词条绑定 `TtrpgMotiveV1` |
| `oracle.meaning.discovery-detail` | meaning | 调查发现的具体细节 | `forbiddenScopes` 含 `world-fact` |

每张表的 `tests` 至少 1 条，合计覆盖各档位与权重边界。夹具断言确定性：相同 `seed` + `nonce`（+ `chaosValue`）得到相同 `rawResult` / `entryKey`。

**阶段归属**：P2 的 fixture 需要其中 ≥2 张表（只用到 `parseTtrpgOracleTableV1` 与发布门，不需要裁定逻辑）；全部 6 张及其夹具运行随 P4 交付。

### 12.2 征兆库（每个 escalationStage ≥1 条）

征兆必须是「玩家能观察到、但不暴露机制」的描述。三类模板：

- 环境类：物理痕迹、人员流动、物资变化
- 社会类：传闻、态度转变、NPC 行为异常
- 直接类：警告、通知、公开动作

### 12.3 局势模板（≥8 个，覆盖 ≥6 种动机；P2 的 fixture 需要其中 ≥3 个，其余随内容建设补齐）

| templateKey | motive | driverKind | 要求 |
|---|---|---|---|
| `sit.evidence-removal` | protection | front | 对手转移物证，含时限压力 |
| `sit.information-trade` | knowledge | npc | 信息交换，多条获取路径 |
| `sit.debt-collection` | wealth | npc | 玩家承诺到期，考验 `player-commitment` 驱动 |
| `sit.faction-pressure` | conquest | front | 势力扩张，影响区域可达性 |
| `sit.rescue-window` | protection | world-event | 有限时窗，失败转化为新局势 |
| `sit.reputation-test` | reputation | npc | 队伍身份影响可用选项 |
| `sit.supply-crisis` | comfort | world-event | 资源压力，建立关系可缓解 |
| `sit.witness-silencing` | serenity | front | 知情者被迫沉默，考验信息边界 |

每个模板必须通过 S1–S10（含 ≥2 条 `whyNowRefs` 与全局唯一的 `clueRef`）。首期 fixture 作品至少启用其中 3 个，含 1 个 `openingSituationKeys`。

### 12.4 首期 fixture 作品

**该 fixture 是 P2 的交付物**（P2 的验收条件是它能发布并开局），P3 在它之上追加合作局验收。内容如下：1 个世界引用、1 套规则包（含 ≥2 张 Oracle 表且各带 `tests`）、≥3 个局势模板、1 个开局局势、≥1 个 front（含 ≥1 个 stage 与对应征兆）、≥2 个 clock、≥1 个效果计划模板、4 名可玩角色（1 玩家 + 3 队友）、完整 Session Zero、`companionPolicy`（`minimumCompanions=2`、四类确认齐备）、`stageClosurePolicy`。

fixture 必须打 `fixture-only` 标签（沿用 `isTtrpgFixtureCampaignV1`，`campaign.ts:665`），不进首发目录。

## 13. 测试矩阵

以下全部为本方案计划新增的测试，当前目录中不存在。**沿用既有惯例 `tests/regression/R-<区域><序号>-<名称>.test.ts`，不新建 `tests/unit/`**（§3.2）。

编号中的数字是**阶段分组标记**，不是单文件序号：`R-TTRPGOPEN1-*` 属 P2，`2` 属 Oracle，`3` 属事实层，`4` 属意图与队友，`5` 属压力，`6` 属局势与四门，`7` 属回放与投影，`8` 属阶段收束，`9` 属跨阶段专项，`10` 属 P9/P10。同一分组下可有多个文件。

### 13.1 回归测试

| 编号 | 覆盖 | 阶段 |
|---|---|---|
| `R-TTRPGOPEN1-run-format` | `runFormat` 分流：`open` campaign 可解析/发布/开局；`scripted` 五类 counterexample 与八门行为逐项不变；交叉传参被拒；`open` 下调 `openTtrpgCampaignScene`/`discoverTtrpgClue`/`completeTtrpgCampaignEnding` 被拒 | P2 |
| `R-TTRPGOPEN1-legacy-pack` | 旧 CampaignPack / RulePack 兼容投影；`contentHash`、`packageHash` 均不变；已开局 session 不受影响 | P2 |
| `R-TTRPGOPEN1-world-turn` | 白名单事件推进 `worldTurn`；查看背包/手记/规则询问/安全暂停/读档/分支/Oracle 咨询均不推进；同 `byEventSequence` 重复推进被拒；E7 归零 `consultedThisWorldTurn` 与 `consecutiveActions` | P2 |
| `R-TTRPGOPEN1-frozen-facts` | 冻结索引编译确定性、`indexHash` 稳定且与排序无关、20000 条上限、`private` 条目可追溯；旧 Release 得到空索引投影 | P2 |
| `R-TTRPGOPEN1-predicate` | 17 个 op 各正反例；深度/长度上限；引用不存在对象抛 `predicate-unresolvable` 而非返回 false；求值无副作用 | P2 |
| `R-TTRPGOPEN1-publication-gates` | `open` 侧 9 个求值门各正反例（含 `product.narrative.play-loop`）；`scripted` 侧 8 个门判定与证据字符串逐字不变 | P2 |
| `R-TTRPGOPEN1-situation-instance-gates` | S1–S10 各正反例；I1–I7 各正反例（I7 用构造好的 `cooldownUntilWorldTurn` 快照做纯函数断言）；开局实例也必须过门；容量满时发 `queued` 并 FIFO 入队；`situation-active` 按 templateKey 命中；`front-stage-at-least` 按数组下标比较。出队与冷却写入属 P6a，见 `R-TTRPGOPEN6-situation-maintenance` | P2 |
| `R-TTRPGOPEN1-failure-log` | E18 环形缓冲上限 200、超出丢最旧；`category` 闭集；失败日志不进玩家投影 | P2 |
| `R-TTRPGOPEN2-oracle-determinism` | 各 kind 解析、档位边界、`selectTtrpgOracleEntryIndexV1` 的权重分布与拒绝采样、chaos 耦合与夹紧、夹具运行；`verifyTtrpgOracleOutcomeV1` 三步复算 100% 通过 | P4 |
| `R-TTRPGOPEN2-oracle-idempotent` | 同 `commandId` 内容相同返回原事件；内容不同被拒；新 `commandId` 的两次结果都在事件流且携带 `previousOracleEventSequence` | P4 |
| `R-TTRPGOPEN2-oracle-scope` | 解释试图改规则 / 改世界事实 / 代替玩家决定 / 追溯改写，四类均被拒；超 `maxNewEntities` 被拒 | P4 |
| `R-TTRPGOPEN3-fact-gates` | F1–F4 各正反例；互斥表逐谓词；`knows`/`owes`/`promised`/`damaged` 不因文本不同判冲突；supersede 正反例 | P4 |
| `R-TTRPGOPEN3-fact-secrecy` | 引用 `gm-only` 来源的新事实不能标 party/private/public；合法 reveal 后可按事件受众传播；来源不可解析默认拒绝 | P4 |
| `R-TTRPGOPEN3-authority-conflict` | 试图仅用会话事实改数值/物品/位置/关系余额被拒；`storyFacts` 与会话事实双写同一可裁定状态被拒 | P4 |
| `R-TTRPGOPEN4-intent-route` | 六条路由各正例；`needs-clarification` 不推进 worldTurn、不耗资源；`rejected` 不写 pending | P3 |
| `R-TTRPGOPEN4-intent-confirm` | `requiresConfirmation` 四类触发；未确认不结算；模型/队友代替真人确认被拒；确认者席位校验 | P3 |
| `R-TTRPGOPEN4-companion-bounds` | 队友同一 worldTurn 连续行动上限 1；预授权类别自动执行、需确认类别等待；队友不读 gm-only | P3 |
| `R-TTRPGOPEN5-telegraph-required` | 无征兆升级路径在事件层不可达；`minLeadWorldTurns` 边界（恰好满足 / 差 1 轮）；征兆 `audience=gm-only` 被拒 | P5 |
| `R-TTRPGOPEN5-clock-autoadvance` | `onFailedCheck`/`onIdleWorldTurns`/`onOracleNo`/`onStageClose` 各触发；idle 按单钟计算；越界被拒 | P5 |
| `R-TTRPGOPEN5-front-defeat` | `defeatPredicates` 全满足才产出 defeated；部分满足被拒 | P5 |
| `R-TTRPGOPEN6-situation-maintenance` | `noInterventionOutcome` 到期执行并置 `expired`；四种终态与 `resolutionKind` 对应；`progressed` 并集写入 `discoveredEvidenceRefs`/`satisfiedObstacleKeys` 且不删除；后果链实例化；容量释放后 FIFO 出队与冷却互动 | P6a |
| `R-TTRPGOPEN6-open-gates` | G1–G4 各正反例；G2 证据图边定义；G3「即将达」边界（差 1 与差 2）；G4 增量校验与全量校验等价；E17 结果与 `consecutiveFailures`；连续失败 3 轮触发 `request-author-review` | P6b |
| `R-TTRPGOPEN7-replay-rollback` | 读档后事实/压力/局势/worldTurn/chaos 同步回退；`telegraphWorldTurns` 回退；回退后四门重新求值；分支独立演化 | P2（基础）+ P6b（全量） |
| `R-TTRPGOPEN7-projection-leak` | 玩家态不暴露 gm-only 事实/局势/clock/失败日志的存在与计数；NPC 不接收 GM 全文；队友投影按 `knownBy` | P3 |
| `R-TTRPGOPEN8-stage-closure` | trigger 满足时可收束；`maximumWorldTurns` 强制可收束；收束不自动回写 WorldRelease | P6b |
| `R-TTRPGOPEN9-world-no-writeback` | 整局运行结束后 `WorldRelease` 内容哈希不变 | P2 |
| `R-TTRPGOPEN9-budget-protected` | 超预算时两个不可降级层完整；降级顺序正确；降完仍超预算时终态为失败 | P7 |
| `R-TTRPGOPEN9-memory-rollback` | 回退/分支后越界记忆标 stale 且不可召回；子分支只克隆切点内行；`belief` 不可作裁定依据 | P8 |
| `R-TTRPGOPEN10-situation-antipattern` | A1 加权 Jaccard 阈值边界（0.79 保留 / 0.80 拒绝）；A2 环检测；A3 个性化引用；拒绝原因含比较对象 | P9 |
| `R-TTRPGOPEN10-audio-nonblocking` | 音频缺失不阻塞主持循环、不回滚结算、不消耗资源；读档后音频状态由事件重建 | P10 |

### 13.2 E2E

| 文件 | 场景 | 阶段 |
|---|---|---|
| `tests/e2e/ttrpg-open-session.spec.ts` | 开局 → 玩家自由行动 → 预检确认 → 规则结算 → 队友协作 → 压力推进与征兆 → 局势消解 → 存档分支恢复 | P3 建立，P6a 已提供局势数据，P6b 补四门断言 |
| `tests/e2e/ttrpg-open-oracle.spec.ts` | 玩家提出未预写行动 → Oracle 裁定 → 事实落账 → 后续轮次引用该事实 | P4 |
| `tests/e2e/ttrpg-open-secrecy.spec.ts` | 三席位各自私密信息互不可见；公开战报隐去未揭示秘密 | P6b |

既有 `tests/e2e/ttrpg-ai-kp-play.spec.ts`、`ttrpg-authoring-ui.spec.ts`、`ttrpg-community-recovery.spec.ts`、`ttrpg-production-journey.spec.ts` 必须保持全绿且**不修改断言**。P2 的 e2e 验收即「这四份原样通过」，不新增复跑用的 spec。

### 13.3 首期体验线验收

完整架构未全部实现时，首期切片仍必须验证真实玩家效果，不是只验证模块可导入。使用 §12.4 的 fixture，走正式 ProductRelease / session 与完整事件链。

**本表是首期体验线最后一个 PR（P3）的验收条件**（P6b 是首期整体的最后一个 PR）；在 P6a 之前只能逐行部分满足，不构成提前通过。

| 步骤 | 玩家可见结果 | 必须留下的确定性证据 |
|---|---|---|
| 开局 | 玩家选 1 个角色，看到 2–3 名队友的身份、目标摘要与合作授权 | E1 事件、席位记录、`ttrpg.session-zero.completed` |
| 开局局势 | 玩家看到至少 1 个活跃局势及其可见介入点 | E11 `transition='activated'`、实例门 I1–I7 结果 |
| KP 开场 | KP 描述局势、已知线索、可行动方向，不泄露 gm-only 真相 | party 投影、KP input manifest |
| 自由行动 | 玩家输入推荐按钮之外的目标/方法 | `TtrpgOpenIntentV1`、`inputRevision`、E2 |
| 预检确认 | 玩家看到可理解的风险、可能代价与不可逆提示；重大代价需确认 | E2 preview、E3 confirmation；未确认不推进 worldTurn |
| 规则裁定 | 已覆盖行动走既有规则；未覆盖且确需不确定性时走受限 Oracle | resolution / E4 回执、`commandId`、release/index hash |
| 世界自驱 | 玩家至少看到一次「不是我触发的」变化：clock 推进或征兆投放 | E7/E8/E9 事件链，征兆 `telegraphWorldTurn` |
| 合作行动 | 队友根据自身观察与目标提出行动，但不替玩家做重大决定 | 队友意图、`actionKind`、audience 投影、授权窗口 |
| 后果延续 | 资源、位置、线索、关系、压力或会话事实在下一轮可被正确引用 | 权威账本 / E5、下一轮 context manifest |
| 恢复 | 刷新、继续、检查点分支后，玩家可见状态与队友记忆同分支一致 | replay hash、lineage、stale/clone 证据 |

**最低真人验收**：至少完成一段连续合作局，其中玩家主动提出一次非按钮行动、拒绝或改变一次建议、队友完成至少一次有依据的协作行动、世界发生至少一次非玩家触发的变化，且**没有人工修改运行数据**。该切片通过后才进入 30 轮长局与模型自由生成局势的评测。

### 13.4 真实模型评测口径

工程回归不得冒充真人试玩。`open` 另需四项指标：

| 指标 | 定义 | 初始目标 |
|---|---|---|
| Oracle 复算通过率 | 抽样 `rollReceipt` 重算与记录一致的比例 | **100%，结构性要求**，低于即视为实现缺陷 |
| 征兆前置率 | escalation 中有合规前置征兆的比例 | **100%，结构性要求** |
| 事实矛盾率 | 每 100 轮中被 F1–F4 拒绝的提交次数 | 记录基线，不预设达标线 |
| 玩家可继续率 | 四门连续失败导致需作者介入的轮次占比 | 记录基线 |

## 14. 三注册表与 schema

按 `docs/DATA-GOVERNANCE.md`，新增读源、Skill、事件、候选或表必须先登记并定义 owner、删除、备份、引用重映射、版本与恢复。

### 14.1 CONTEXT_SOURCES

新增 6 个 sourceKey，见 §10.2。登记位置 `src/lib/registry/context-sources.ts`，条目结构照抄既有跑团条目（`key`/`label`/`scope:'runtime'`/`layer:'L0'`/`ownerFrom:'work'`/`budgetTokens`/`protectedFromTrim:true`/`requiresProductRuntimeSessionId:true`/`read`）。

`ttrpgOpenGateResults` 额外需要 `enabled` 判定作者态。

### 14.2 FIELD_REGISTRY / AdoptionSchema

**首期不新增字段。** 理由：`open` 的运行时候选不走通用 `adopt()`，正式结果分别由意图、命令与事件 reducer 提交。

| 候选 | 写入面 | 是否进 `FIELD_REGISTRY` | 约束 |
|---|---|---|---|
| `TtrpgOpenIntentV1` / preview | command candidate + E2 | 否；登记在 Skill contract、事件 schema 与 `runtime-commands.ts` | 不直接改状态；确认前不推进 worldTurn |
| 队友行动候选 | command candidate，最终进既有规则/Oracle/EffectPlan 链 | 否；登记在 Skill contract 与事件 schema | 不替玩家确认重大行动 |
| KP 叙述候选 | narration candidate / runtime event | 否；登记在 Skill contract 与 audience projection | 不得改写权威回执 |
| Oracle 解释、征兆文本、事实候选、局势候选、记忆摘要、简报 | 运行时事件 payload 或作者态候选 | 默认否 | 若未来要作为作者可编辑 Build/Brief 字段采纳，**必须先选定真实 target 字段**，再新增 `FIELD_REGISTRY` 与 `AdoptionSchema` 条目。不得用占位 target 冒充已登记字段 |

当前 `FIELD_REGISTRY` 仍只包含既有 `ttrpgRulePacks` 字段，不得因本方案文本而翻绿。

### 14.3 PROJECT_TABLES 与 schema

**首期零新表，`STORYFORGE_SCHEMA_VERSION` 保持 10。**

- AI 队友席位复用 `ttrpgSessionParticipants`（`src/lib/db/schema.ts:223`）。
- 会话事实、意图、Oracle、压力、局势、worldTurn、四门结果、失败日志全部由 `productRuntimeEvents` 派生，经 `applyTtrpgRuntimeEventV1` 投影到 `openRun`。
- 媒资请求复用 `ttrpgRuntimeAssetRequests`。
- 作者草稿复用 `ttrpgAuthoringDrafts`（`schema.ts:287`）。新增的 7 个 campaign 字段与 `oracles` 作为草稿 JSON 的内容，不需要新列。

唯一计划新增的表是 P8 的叙事记忆表。届时：

| 表 | owner | 删除 | 备份 | 引用重映射 | 恢复 |
|---|---|---|---|---|---|
| `ttrpgNarrativeMemories` | `project` 表，domain owner 为 `ProductRuntimeSession` | 随 session 级联删除 | 随工作区备份导出 | sessionId / worldId 重映射；分支只克隆切点内记录 | 旧行不原地改写；失效靠 `stale`，重算靠新的 `ttrpg.memory.recorded` 事件 |

P8 的 schema 变更：

- `STORYFORGE_SCHEMA_VERSION`：10 → 11，性质为**只加表**，不改既有表索引语义，不改写既有记录。
- 新增 store 定义（字段与 §5.13 的 `TtrpgNarrativeMemoryV1` 一一对应）：

```ts
ttrpgNarrativeMemories:
  '++id, projectId, worldGroupId, worldId, workId, sessionId, &[sessionId+revisionKey], [sessionId+reliability], [sessionId+stale], sourceSessionId, fromEventSequence, toEventSequence, derivedFromHash, updatedAt'
```

- `src/lib/db/schema.ts` 的改法必须精确，否则会悄悄改变已发布 v10 的内容：
  1. 新增 `export const STORYFORGE_STORES_V10 = { ...STORYFORGE_STORES_V9, chatAuthoringDrafts: '...' }`，内容**等于当前 `STORYFORGE_STORES` 的快照**（即含 `chatAuthoringDrafts`）。
  2. 把构造器中 `this.version(STORYFORGE_SCHEMA_VERSION).stores(STORYFORGE_STORES)` 这一行改为 `this.version(10).stores(STORYFORGE_STORES_V10)`，**把 v10 钉死到快照常量上**。
  3. 新的 `STORYFORGE_STORES = { ...STORYFORGE_STORES_V10, ttrpgNarrativeMemories: '...' }`。
  4. 追加 `this.version(STORYFORGE_SCHEMA_VERSION).stores(STORYFORGE_STORES)`（此时为 11）。
  5. 保留既有 `version(8)`、`version(9)` 的 `chatAuthoringDrafts` 手工拼接写法，不要「顺手整理」。
- `src/lib/db/ensure-schema.ts` 的 `REQUIRED_TABLES`（当前 123 项）同步新增；`npm run check:required-tables` 必须通过（该脚本比对 `ensure-schema.ts` 与 `schema.ts`，两边不一致即失败）。
- `src/lib/registry/project-tables.ts`（当前 123 项注册，与 `REQUIRED_TABLES` 完全一致）新增注册项，含删除级联、导出、引用重映射与分支克隆。
- `runtime-branch.ts` 的 `cloneTtrpgRuntimeBranchExtensionsV1` 新增该表的克隆：只克隆 `toEventSequence <= throughSequence` 的行，并把子分支上失效的行标为不可引用。

**在实际登记前，该表不得被任何 runtime 读取。** P2–P7 只允许事件回放与内存投影，避免先产生一张未治理的「临时记忆表」。

### 14.4 事件类型登记

新增 18 个事件类型（E1–E18）必须**两处同改**：

1. `src/lib/types/product-runtime.ts:1155` 的 `PRODUCT_RUNTIME_EVENT_TYPES`（权威闭集，当前含 29 个 `ttrpg.*`）。
2. `src/lib/ttrpg/runtime-commands.ts:28` 的 `FormalTtrpgEventType`（模块私有 `Extract` 过滤器，当前 26 项）。

只改第 2 处不会通过类型检查。`applyTtrpgRuntimeEventV1` 的 `switch` 必须有对应 `case`；未启用阶段的事件抛明确错误（如 `[ttrpg] 事件 X 所属阶段未启用`），不得 fall through 到 default 的「未知事件类型」。

### 14.5 CI 闸门

每个 PR 必须 `npm run ci` 全绿。与本方案相关的检查器：

| 命令 | 守什么 |
|---|---|
| `check:required-tables` | `ensure-schema.ts` 的 `REQUIRED_TABLES` 与 `schema.ts` 一致 |
| `check:architecture` | `CONTEXT_SOURCES`、`FIELD_REGISTRY`、产品隔离、WorldRelease provider 使用、上层产品不直读运行表 |
| `check:ai-manual` | AI 手册由代码生成且与注册表一致 |
| `check:ai-entry-registry` | 所有正式 AI 入口已声明边界 |
| `check:agent-context` | Skill 的上下文读取均来自已登记读源 |
| `check:docs` | 文档权威白名单内文件存在、无失效链接 |
| `check:roadmap` | 路线图条目与状态 |
| `npx tsc --noEmit`、`lint`、`test:coverage`、`build`、`check:bundle-size` | 类型、风格、覆盖率、构建、包体积 |

**`check:docs` 会因为引用不存在的文件而失败。** 因此 §20 的文档改动必须与代码 PR 同批提交，不能先写文档引用再补文件。

## 15. 分阶段施工

### 15.1 依赖顺序

```text
P1 文档修订（阻塞全部，§20）
 └─ P2 地基：runFormat 八层分流、worldTurn、冻结事实索引、谓词、状态权威、
          事件闭集与全部 reducer 分支占位、旧包兼容、发布门、失败日志、
          局势模板解析与实例门、open 可发布可开局（含开局局势）
       ├─ P4 Oracle + 会话事实层
       ├─ P5 压力自驱（clocks/fronts/征兆/升级/击败）
       └─ P6a 局势运行时（实例维护、后果链、ttrpgOpenSituations 读源）
                 ↓
            P3 合作切片（意图预检 + AI KP + 2–3 队友 + 玩家桌面）
                 ↓
            首期体验线交付（K1–K7 全部可用，§13.3 全表通过）
                 ↓
            P6b 四门 + 阶段收束（E13/E17、作者态面板、秘密团 e2e）
                 ↓
P7 条件注入 + 上下文预算
P8 记忆分层 + 世界补丁导出 + schema v11
P9 模型自由生成局势模板 + 反套路检查
P10 音频媒资扩展
P11 外部模组导入 / P12 联机部署（单独立项，不在本方案内）
```

**P2 必须先于所有运行时能力。** 没有分流、唯一状态权威、冻结事实索引、谓词与 worldTurn，后续模块会各自接入不同的临时语义。P2 还必须交付局势**模板解析器与实例门**，因为 P2 的开局局势实例化就要过门。

**P4、P5、P6a 必须在 P3 之前完成。** 理由：Oracle 掷出的结果没有落账层就只是一次性文本；压力不自驱世界就不会动；而 P3 的玩家桌面要显示「推荐行动」与「局势简报」，其数据来自活跃局势与 `ttrpgOpenSituations` 读源。P3 是把这些接成一段真实可玩体验。

**P6b 放在 P3 之后**：四门与阶段收束是质量保障与长局能力，不是首期可玩性的前置条件；把它们后置可以让首期更早拿到真实体验证据。但 P6b 必须在宣布「首期完成」之前合入——`open` 没有四门就不能对外开放。

### 15.2 PR 清单

分支命名沿用 `docs/COLLAB-WORKFLOW.md`。

| PR | 分支 | 内容 | 验收 |
|---|---|---|---|
| P1 | `docs/ttrpg-plan-2.0` | §20 全部文档修订：契约升 1.1.0、能力基线新增两行并修订 E-TTRPG-01 缺口列、文档权威白名单登记本方案、删除未跟踪的旧方案文件 | `check:docs`、`check:roadmap` 通过；能力基线新条目状态为 `missing` |
| P2 | `feat/ttrpg-open-foundation` | `run-format.ts`、`world-time.ts`、`frozen-facts.ts`、`predicate.ts`、`situation-engine.ts`（解析器 + 实例化 + 实例门）、`open-gates.ts`（发布门 + 失败日志）、`oracle.ts` 的 `parseTtrpgOracleTableV1`；campaign 7 字段；RulePack `oracles` 字段与哈希兼容；`PRODUCT_RUNTIME_EVENT_TYPES` + `FormalTtrpgEventType` 全量扩展与 reducer 分支占位；§5.7 的 clocks/fronts 新增字段与其解析约束（clock 的 `autoAdvance`、`onCompleteEffectPlanRef`、`advanceTriggers[].condition`，front 的 `escalationStages`、`telegraph`、`defeatPredicates`；P2 的发布门与谓词测试依赖它们）；E1/E7/E18 实装，E11 的 `activated`/`queued` 实装（`progressed`/`resolved`/`expired` 留 P6a）；八层分流；`openRun` 状态树；旧包兼容投影；局势模板与效果计划模板作者态编辑 | `scripted` 零回归（21 个 `R-TTRPG*` + `R-CREATORSDK1-ttrpg-package` + `R-HARNESS-RUNTIME3-ttrpg-skills` + 4 个既有 e2e 全绿且断言未改）；`open` fixture 能发布、开局（含开局局势过门）、通过既有 `resolveTtrpgRuleAction` 完成一次规则行动并由 E7 推进 worldTurn（这是 P2 唯一的 worldTurn 生产者，其余 reason 随 P3/P5/P6b 启用）、回放、分支恢复；`R-TTRPGOPEN1-*`（8 份）、`R-TTRPGOPEN9-world-no-writeback`、`R-TTRPGOPEN7-replay-rollback`（基础） |
| P4 | `feat/ttrpg-open-oracle-facts` | `oracle.ts` 其余部分（`selectTtrpgOracleEntryIndexV1`、`resolveTtrpgOracleV1`、`verifyTtrpgOracleOutcomeV1`、`advanceTtrpgChaosV1`）、`session-facts.ts`；E4/E5/E6；Oracle 回执与复算；F1–F4；受控谓词表；读源 `ttrpgOpenFacts`、`ttrpgOpenOracleHistory`；Skill `oracle-interpret`、`fact-normalize`；作者态 Oracle 表编辑与夹具运行 | `R-TTRPGOPEN2-*`、`R-TTRPGOPEN3-*`；`ttrpg-open-oracle.spec.ts`；复算通过率 100% |
| P5 | `feat/ttrpg-open-pressure` | `pressure-runtime.ts`（压力运行时行为；字段与解析约束已在 P2 落地）；E8/E9/E10/E12；读源 `ttrpgOpenPressure`；Skill `telegraph`；作者态局势层编辑 | `R-TTRPGOPEN5-*`；征兆前置率 100% |
| P6a | `feat/ttrpg-open-situation-runtime` | 局势实例维护（到期、四种终态、后果链、FIFO 队列）；读源 `ttrpgOpenSituations` | `R-TTRPGOPEN6-situation-maintenance` |
| P3 | `feat/ttrpg-open-coop` | `open-intent.ts`；扩展 `submitTtrpgActionIntentV2`；E2/E3；Skill `open-intent`、`open-companion`、`open-kp`；玩家桌面（行动区、预检、局势简报、世界动态、时间与压力）与队友面板；KP 循环接入 | `R-TTRPGOPEN4-*`、`R-TTRPGOPEN7-projection-leak`；`ttrpg-open-session.spec.ts`；**§13.3 全表通过** |
| P6b | `feat/ttrpg-open-gates` | 运行时四门、E13/E17；作者态四门与失败日志面板（读 `ttrpgOpenGateResults`） | `R-TTRPGOPEN6-open-gates`、`R-TTRPGOPEN8-*`、`R-TTRPGOPEN7-replay-rollback` 全量；`ttrpg-open-secrecy.spec.ts` |
| P7 | `feat/ttrpg-open-context` | `context-trigger.ts`、`context-budget.ts`；E14；`prompt-context.ts` 接入预算装配；KP 上下文检视器 | `R-TTRPGOPEN9-budget-protected` |
| P8 | `feat/ttrpg-open-memory` | `narrative-memory.ts`；schema v11 与 `ttrpgNarrativeMemories` 全生命周期；E15；读源 `ttrpgOpenMemory`；Skill `open-brief`；世界补丁候选导出与作者审阅 | `R-TTRPGOPEN9-memory-rollback`；迁移与半提交故障回归；备份往返 |
| P9 | `feat/ttrpg-open-generation` | Skill `situation-propose`；反套路 A1–A3；生成冷却与同质化拒绝 | `R-TTRPGOPEN10-situation-antipattern` |
| P10 | `feat/ttrpg-open-audio` | 音频四通道、`voiceTimeline`、音频预算；E16 | `R-TTRPGOPEN10-audio-nonblocking` |

表中编号表示拆分归属，不代表合并顺序。**实际依赖顺序是 P1 → P2 → P4 → P5 → P6a → P3 → P6b**，之后 P7–P10 可按需并行。

### 15.3 每个 PR 的准入

1. `npm run ci` 全绿。
2. 新增事件 / 表 / Skill / 读源已在对应注册表登记（事件要两处同改，见 §14.4）。
3. **新增硬约束必须有反例测试，不能只有正例。**
4. 不改其他产品的运行面；共享设施改动（`src/lib/types/product-runtime.ts`、`src/lib/registry/*`、`src/lib/db/*`）单独成 commit 并在同一 PR 内可独立审查。
5. 能力基线不因本 PR 自动翻绿；状态更新必须附真实证据。
6. `scripted` 路径的既有测试断言不得修改。
7. 涉及真实 UI 的 PR 需在隔离浏览器数据中运行 `npm run ci:e2e`。
8. 新增面板不得写入 `TtrpgCampaignGuide.tsx`（当前 6429 行 / 305,796 字节），必须独立成文件。

## 16. 预算、性能与成本

`open` 比 `scripted` 更容易失控，必须预设上限并在回执中可见。

| 项 | 预算 | 超限处理 |
|---|---|---|
| 每 worldTurn 模型调用次数 | 固定公式 `队友数 + 4`：意图解析 1、KP 叙述（含局势简报）1、每名队友各 1，加上两个按需槽位（①Oracle 解释至多 1 次，即便掷了 2 次 Oracle；②征兆文本与事实归一共用 1 个槽位）。2–3 名队友即上限 6–7 次。与 `kp-coordinator` 的 `maxAiActions` 默认 4 不冲突——后者限制的是 AI 连续**行动**数，不是模型调用数 | 降级顺序：①征兆文本改用 §12.2 的模板而非模型；②事实归一延后到轮末批量；③第 2 次 Oracle 解释复用第 1 次的框架不再调模型；④合并 KP 叙述与队友反应为一次调用 |
| 每 worldTurn Oracle 咨询 | ≤2 次掷骰（`oracle.consultedThisWorldTurn`），**硬上限，不可覆盖**；其中至多 1 次产生模型解释调用 | 第 3 次掷骰直接拒绝（E4 拒绝条件）并记 `oracle-budget` 日志；玩家可等到下一 worldTurn 再问 |
| 活跃局势数 | ≤5 | 模板 key FIFO 入队，不新实例化 |
| 局势实例化冷却 | 同一 `templateKey` 消解后至少 3 个 worldTurn 才可再实例化 | 复用既有或选其他模板 |
| 会话事实总数 | 单局 ≤5000；G4 在 >500 时切增量校验 | 超限拒绝新事实并提示收束阶段 |
| 意图澄清轮次 | 同一 `clarificationThreadKey` 累计 `needs-clarification` ≤3 次（`intents.clarificationCounts`） | 第 4 次返回 `rejected` 并记 `intent-unclear` |
| 记忆摘要（P8） | 每 10 个 worldTurn 或自上次摘要起累积 ≥200 个事件，取先到者 | 延后到轮末，不阻塞主持 |
| 媒资（P10） | 沿用既有 `runtimePolicy`；音频另设每请求 ≤2000 字符、每 worldTurn ≤3 个请求 | 降级到 `fallbackText` |
| 上下文 token（P7） | 由 §5.13 预算控制 | 按固定顺序降级并进回执；降完仍超则失败 |

**成本口径**：记录整轮与整场调用、tokens、耗时、已知费用、失败恢复与人工干预。供应商未回传价格时保持未知，不以单次回复成绩代替整场质量，不编造单局成本。

## 17. 风险与回退

| 风险 | 征兆 | 回退路径 |
|---|---|---|
| 长局一致性撑不住 | 事实矛盾率随时长上升、玩家频繁纠正 | 收窄即兴范围：Oracle 仅处理边缘裁定，主干回到作者局势层 |
| 局势同质化 | 玩家反馈雷同（P9 后看 A1 拒绝率） | 提高作者局势层占比，生成器只做变体；扩充模板库 |
| 四门频繁失败导致卡顿 | `request-author-review` 占比高 | 放宽 G2（允许 NPC 主动给线索）、提高 `isRequired=false` evidence 密度 |
| 成本与延迟超预期 | 每轮调用或耗时越界 | 降 Oracle 频次、合并 Skill 调用、压缩动态层 |
| 玩家感受不到世界演化 | 征兆投放了但玩家未注意 | 强化 §11.1 世界动态区与压力显示；提高 `minLeadWorldTurns` 与重复提示 |
| 秘密经由即兴事实泄露 | F4 拒绝率异常低（说明校验未生效） | 补 F4 反例测试；收紧 `knownBy` 默认值 |
| `scripted` 被意外破坏 | 既有跑团回归或 e2e 变红 | 立刻回滚该 PR；分流守卫改为显式白名单而非条件推断 |
| 旧包哈希漂移 | 旧 Release 校验失败 | 回滚；兼容投影必须在验签之后、绝不参与哈希计算 |
| 作者供给起不来 | 作者留存低、局势模板少 | 转官方精品世界路线，按世界而非按模组分发 |
| 音频授权风险 | 生成输入含受限实体 | 提交前禁用词与实体校验；商用凭据记入媒资元数据 |

## 18. 完成证据口径

沿用契约既有口径，不放宽：

- 区分结构/工程测试、真实模型评测、真人试玩。**自动回归不得冒充真人试玩。**
- 记录整轮与整场调用、tokens、耗时、已知费用、失败恢复与人工干预；未知价格保持未知。
- 没有部署证明不得宣传公共多人服务完成。
- `commercialReady` 与产品完成证明不得因本方案分支回归通过而开启。
- 首发目录只有在真实发布包、原创素材许可、完整试玩和脱敏证据就绪后才加入作品条目。
- 导出不得包含 API Key、账户身份或私人测试聊天。

`open` 新增：

- 四项指标（§13.4）需在真实 provider 下记录。其中 Oracle 复算通过率与征兆前置率属**结构性要求，低于 100% 即视为实现缺陷而非调优空间**。
- **长局证据**：至少一局连续 30 个 worldTurn 以上的真实模型试玩记录，含四项指标、回退与恢复记录，以及一次世界补丁导出与作者审阅结果。该证据是 `E-TTRPG-OPEN-02` 翻绿的唯一依据。
- 首期合作切片通过 §13.3 不等于跑团完成，只能描述为「完整架构上的第一段用户体验证据」。`E-TTRPG-OPEN-01` 只有在 P2–P6b 全部合入且四门生效后才可从 `missing` 改为 `partial`。

## 19. 不在本方案内

- 战棋深化：视线、光照、战斗自动化、地形遮蔽
- 多外部规则书完整兼容（CoC / DnD 等规则书正文不内置分发）
- 跨产品世界共演；任何需要修改角色聊天、AI 小镇、文字冒险、AVG、文字开放世界运行面的改动
- 公共多人服务的运营承诺与 SLA
- 模型自训练、角色 LoRA 训练
- 社区交易、创作者分成、全平台商业服务
- 外部模组与角色卡的商用再分发（导入件强制 `local-only`）
- 可执行脚本规则（见 §21 D3）
- 外部模组导入（P11）与联机部署（P12）单独立项

## 20. 需要同步修订的文档（P1 交付物）

**`main` 上的现状**：产品契约 `docs/products/TTRPG-AI-KP.md` 为 1.0.1（2026-09-10），能力基线 `docs/roadmap/CAPABILITY-BASELINE.md` 为 2.2.1（2026-09-25），文档权威 `docs/DOCUMENT-AUTHORITY.md` 为 2.4.0（2026-09-29）。三者**都没有**跑团新形态内容。本文件夹内交接的三份文档副本是基于更旧版本（权威 1.8.0、基线 2.0.1）改出来的，**不得直接覆盖 main**，否则会丢掉文字开放世界等其他产品的更新。

### 20.1 `docs/products/TTRPG-AI-KP.md`：1.0.1 → 1.1.0

在当前 1.0.1 正文上做以下**增量**修改，不整篇替换：

| # | 位置 | 修改 |
|---|---|---|
| C1 | 版本头 | 版本 1.1.0，生效 2026-10-10；变更说明写：新增 `runFormat` 两种运行格式、三层事实模型、Oracle 裁定权威、征兆前置约束与 `open` 质量门口径；施工方案见 `docs/roadmap/TTRPG-DEVELOPMENT-PLAN.md` |
| C2 | 产品结果 | 「在冻结规则与模组下」改为「在冻结规则、冻结世界事实与作者局势层下」；新增一段说明两种 `runFormat`（`open` 为标准格式，`scripted` 为兼容格式），并明确二者共用规则内核、骰子、信息边界、事件流、媒资与发布链路 |
| C3 | 产品结果 | 补充三层事实定义（§4），明确会话即兴层归 session、不回写 `WorldRelease`；世界补丁候选只能由作者显式审阅后升级 |
| C4 | 角色与权威 | 区分「修改发布包」（禁止）与「在 session 事实层新增事实」（允许，须留来源、可见性与证据事件）；新增 Oracle 条款：属规则内核授权的随机裁定，表由规则包定义并冻结，掷骰由内核执行且可复算，结果一经提交即为本局事实、不可反悔；解释文本可重生成但不得改结果、改规则、追溯改写或代替玩家决定 |
| C5 | 主持循环 | 新增：`open` 没有预设场景集合，场景切换等价于局势切换；压力自驱条款——clocks 与 fronts 按自身规则推进，不以玩家触发为前提；任一 front 升级前必须先投放对队伍可见的征兆并满足声明的提前轮次 |
| C6 | 模组、角色与媒资 | 穷举式可达性校验按 `runFormat` 分流：`scripted` 保留，`open` 改用运行时四门（出路存在、假设可形成、征兆齐备、事实无矛盾），四门必须可机器判定，不得以人工评审替代 |
| C7 | 完成证据 | 新增 `open` 长局证据口径：Oracle 复算通过率与征兆前置率为结构性 100% 要求；事实矛盾率与玩家可继续率记录基线 |
| C8 | 当前实现边界 | 新增一段：`open` 形态目前只有本契约与施工方案的设计约束，尚无实现与证据；Oracle、会话即兴事实层、压力自驱、局势、运行时条件注入、确定性上下文预算、记忆分层与四门全部为未完成项；能力基线相应条目保持未完成，不得因设计文档合入而翻绿。首期合作切片不得被描述为跑团完成。规则询问的建议性定位在两种格式下都不变；Oracle 的约束力裁定与规则询问是两件事，不得互相顶替 |

**术语**：契约全文不使用「沙盒」，统一用「跑团」与 `runFormat`。

### 20.2 `docs/roadmap/CAPABILITY-BASELINE.md`：2.2.1 → 2.3.0

在 `## E · 上层垂直产品` 表中，`E-TTRPG-01` 行（当前为该节第一行）**之后**插入两行，不改动其他产品行：

```markdown
| E-TTRPG-OPEN-01 | missing | 跑团标准运行格式（`runFormat='open'`）只有产品契约 1.1.0 与 `docs/roadmap/TTRPG-DEVELOPMENT-PLAN.md` 2.0.0 的设计约束，无实现与证据。运行格式分流、worldTurn、冻结事实索引、谓词求值、Oracle 裁定、会话即兴事实层、压力自驱与征兆前置、局势模板与实例、运行时四门、条件注入、确定性上下文预算、记忆分层全部未开工 | 按方案 P2 地基 → P4 Oracle/事实 → P5 压力 → P6a 局势运行时 → P3 合作切片 → P6b 四门与阶段收束顺序实施。`open` 仍绑定 ProductRelease，只免除闭合场景图与闭合结局；`runFormat='scripted'` 的既有穷举可达性校验不得改动；设计文档修订不得使本条翻绿 |
| E-TTRPG-OPEN-02 | missing | 跑团长局证据口径已在契约 1.1.0 确立（Oracle 复算通过率、征兆前置率、事实矛盾率、玩家可继续率），尚无任何真实 provider 记录 | 需连续 30 个 worldTurn 以上真实长局记录，含回退恢复与一次世界补丁导出审阅；工程回归不得替代 |
```

同时修改 `E-TTRPG-01` 行的缺口列：在现有文字「逐字段产物编辑、完整媒资、公共服务权限隔离、真实多人体验及产品整体验收尚未封板」末尾追加「；跑团标准运行格式见 E-TTRPG-OPEN-01，本行只描述既有 `scripted` 形态」。该行的状态保持 `partial`，事实列不动。

### 20.3 `docs/DOCUMENT-AUTHORITY.md`：2.4.0 → 2.5.0

在 `### 2.2 产品与计划` 的现行白名单中新增一行：

```markdown
- `docs/roadmap/TTRPG-DEVELOPMENT-PLAN.md`：跑团唯一专项施工方案，当前 2.0.0；对应产品契约 `docs/products/TTRPG-AI-KP.md` 1.1.0。设计约束生效，不代表任何条目已实现。
```

在文末复审记录追加一段，说明本次复审内容：统一跑团术语、确立 `runFormat` 两形态、登记唯一专项方案入口；未改变总纲的产品边界与 `productType` 闭集。

### 20.4 需要删除的文件

- `docs/roadmap/TTRPG-SANDBOX-DEVELOPMENT-PLAN.md`（未跟踪，**不得提交**，直接删除）。
- 本文件夹内 `跑团沙盒开发与施工方案.md`（已被本文取代）。

一个主题只能有一个现行入口（`docs/DOCUMENT-AUTHORITY.md` §5 防污染规则）。

### 20.5 文档改动顺序

P1 的提交顺序必须是：先加 `docs/roadmap/TTRPG-DEVELOPMENT-PLAN.md`，再改 `DOCUMENT-AUTHORITY.md` 登记它，再改契约与基线，最后删除旧方案文件。否则 `npm run check:docs` 会因引用不存在的文件或存在未登记文档而失败。

## 21. 设计决策记录

每条格式：问题 → 可选方案 → 选择 → 理由 → 否决原因 → 关联章节。目的是让后续开发者知道「为什么是这样」，避免把已被否决的方案当新想法重做。

### D0 术语与运行格式命名（2.0.0 新增）

- 问题：本产品形态应当叫什么？是否沿用 1.1.0 的「沙盒即兴 / `playMode='sandbox'`」？
- 可选：A 沿用「沙盒」；B 统一叫「跑团」，运行格式用 `runFormat: 'open' | 'scripted'`；C 叫「开放世界跑团」。
- **选择 B**。
- 理由：「沙盒」在跑团语境指「无主线、玩家自定目标」的一种窄玩法，而本产品要做的是跑团本身（维持世界运行、保持角色状态、按行动演化故事）。「模组」也被 1.1.0 错误等同于闭合流程——真实模组同样是准备局势，闭合场景图只是现有实现的限制。沿用旧名会让后续开发者以为这是两种产品，或以为闭合流程才是「正常跑团」。
- 否决 A：名实不符，且会把「跑团」这个词让给剧本杀式实现。否决 C：冗长，且「开放世界」有另一套行业含义。
- 关联：§1.2、§1.3、§7.3。

### D0.1 首期范围包含压力与局势（2.0.0 新增）

- 问题：首期切片要不要包含压力自驱与作者预设局势？
- 可选：A 按 1.1.0，首期只做意图 + Oracle + 事实 + 队友，压力与局势留到后续；B 把压力自驱与作者预设局势纳入首期。
- **选择 B**。
- 理由：「世界会自己动」是跑团定义的第一条。没有它的切片是「AI 陪你对话并掷骰」，不是跑团，无法验证产品假设。作者预设局势比模型生成局势简单得多（只需实例化 + 实例门，不需要反套路检查），成本可控。
- 否决 A：首期交付物无法回答「这是不是跑团」这个核心问题。
- 关联：§2.2 K4/K5、§15.1。

### D1 跑团与两种运行格式的产品关系

- 问题：`open` 要不要成为独立产品？
- 可选：A 新建 `productType`；B 同一产品内用 `runFormat` 分流；C 只做 `open`、删除闭合格式。
- **选择 B**。
- 理由：架构以 `productType` 冻结产品身份并按其隔离工作台、Build、Release、Session；新增身份会改动闭集与跨产品门控，属共享热点。两种格式共用规则内核、骰子、信息边界、事件流、媒资与发布链路，分流成本远低于复制一套。
- 否决 A：代价是改 `productType` 闭集与产品目录，影响面超出跑团边界。否决 C：会破坏已交付的《雾港：最后一盏灯》，且闭合格式承担新手教学与「世界入口章节」职能。
- 关联：§1.3、§7、§8。

### D2 Oracle 结果的可逆性

- 问题：Oracle 掷出的结果允不允许重掷覆盖？
- 可选：A 允许 KP 重掷取更好结果；B 结果不可反悔，解释可重生成；C 结果为建议，玩家确认后才生效。
- **选择 B**。
- 理由：跑团的一致性全靠「即兴产生的东西也是事实」。若结果可覆盖，Oracle 退化为随机风味的自由叙事，长局必然失忆与自相矛盾。解释文本与结果分离，既保留表达自由又锁住事实。
- 否决 A：等于没有裁定。否决 C：与既有「规则询问是建议」条款混淆，且会让每次 Oracle 都变成确认弹窗，严重拖慢节奏。
- 关联：§5.9 硬约束 2–3、§6.2 E4。

### D3 规则表达力的实现路径

- 问题：`data-only` 的创作者包无法表达链式规则（如理智检定成功也掉值、疯狂表触发），怎么补？
- 可选：A 开放可执行脚本；B 保留 data-only，补完声明式算子（trigger / predicate / table / chain）；C 把这类规则硬编码进内置规则包。
- **选择 B**。
- 理由：`creator-sdk.ts` 的 `permissions: []` 与 `executableCode: false` 是安全基线，开放脚本会使签名与熔断机制失去意义。声明式算子加白名单 + 夹具准入，既保留表达力又保持可验证。
- 否决 A：安全代价过大。否决 C：第三方规则包永远无法表达同等复杂度，等于放弃自定义规则。
- 补充：受限沙箱（WASM/QuickJS，无网络无存储限步数）不在本方案范围。`creator-sdk.ts` 已有 `compatibility.maximumRuntimeProtocol`，当前与 `minimumRuntimeProtocol` 同为 1。将来若启用脚本，应先单独修订创作者包契约并提升该上限；**本方案不得把它描述成已经预留了脚本能力**。
- 关联：§5.3、§19。

### D4 即兴事实的归属

- 问题：运行时产生的新 NPC、新地点、新事实放哪里？
- 可选：A 直接写 `WorldRelease`；B 只存聊天记录不落账；C 第三层会话事实层，归 session，可导出补丁候选供作者审阅。
- **选择 C**。
- 理由：A 违反「运行结果不得自动回写世界引擎」的架构红线，且会让一局游戏污染其他产品引用的共享世界。B 的代价是事实随上下文漂移。C 让世界「因为被玩而长大」，但升级权始终在作者手里。
- 否决 A：架构红线。否决 B：跑团的核心诉求就是即兴也要算数。
- 关联：§4、§5.6、§6.4。

### D5 征兆前置的强制位置

- 问题：「威胁升级前必须先给征兆」写在哪？
- 可选：A 写进提示词；B 写进文档靠人工评审；C 由 reducer 在事件层强制，无征兆即拒绝升级。
- **选择 C**。
- 理由：架构规定「可验证的 schema、事务、作用域、版本、权限、预算和状态机不得只写进提示词」。征兆前置是可判定条件（看 `telegraphWorldTurns` 与 `minLeadWorldTurns`），必须机器强制。
- 否决 A/B：模型会漏，评审会累，且无法回归测试。
- 关联：§5.7 硬约束 1–2、§6.2 E10、`R-TTRPGOPEN5-telegraph-required`。

### D6 记忆与事实的检索方式

- 问题：长局记忆用不用向量召回？
- 可选：A 统一向量记忆；B 事实走权威状态，向量只服务传闻与信念；C 不做检索，只做摘要。
- **选择 B**。
- 理由：成熟 AI 主持产品公开承认长期记忆的语义检索「不如结构化检索可靠」，且会按使用频次挤掉旧记忆。本项目已有权威状态与事件流，事实没有理由退回概率召回。
- 否决 A：会把「钥匙在谁手上」变成概率问题。否决 C：长局无法回顾。
- 关联：§5.13、§6.4、§14.3。

### D7 新增表的数量

- 问题：多个新子系统要不要各自建表？
- 可选：A 每个子系统一张表；B 全部事件派生，零新表；C 只给需要索引检索的建表。
- **选择 C**，首期零新表，仅 P8 新增 `ttrpgNarrativeMemories`。
- 理由：既有运行时状态由 reducer 派生，复用这条路径可自动获得回放、回退、幂等与分支语义。记忆需要按 reliability、stale、序号区间检索，走表更合理。
- 否决 A：违反「新表先登记」的治理成本（当前 123 张 required/project tables）。否决 B：记忆检索会退化为全量扫描。
- 关联：§3.5 落点原则、§14.3。

### D8 既有穷举校验的处置

- 问题：`reachableSceneKeys` / `unreachableEndingKeys` 那套校验在 `open` 失效，怎么办？
- 可选：A 删除改为四门；B 按 `runFormat` 分流，`scripted` 保留原校验；C 强行让 `open` 也闭合场景图。
- **选择 B**。
- 理由：《雾港》及后续 `scripted` 作品依赖这套校验，删除会造成回归。`open` 没有闭合场景图，强行闭合等于退回闭合格式。
- 否决 A：破坏已交付作品。否决 C：与产品目标冲突。
- 关联：§7.1、§8.1、§8.3。

### D9 分流守卫用显式判定而非内容推断

- 问题：如何判断一个 campaign 走哪条路径？
- 可选：A 用 `scenes.length === 0` 之类的内容特征推断；B 显式 `runFormat` 字段 + `assertTtrpgOpenOnlyV1` / `assertTtrpgScriptedOnlyV1` 守卫。
- **选择 B**。
- 理由：内容推断会在边界情况（作者误删场景、空数组的旧包）上静默走错分支，且无法被反例测试覆盖。显式字段 + 守卫让每条路径的入口可被断言。
- 否决 A：错误模式是「静默走错」，排查成本极高。
- 关联：§7.3。

### D10 Oracle 复算复用既有骰子复算器

- 问题：Oracle 的可复算回执要不要新造一套？
- 可选：A 新造 `materialDerivation` 与 `consumedDice` 字段自成体系；B 复用 `RuleDiceResolutionV1` 与 `verifyRulePackDiceResolutionV2`，只补 Oracle 侧参数。
- **选择 B**。
- 理由：1.1.0 认为 `TtrpgDiceRollTraceV2` 不记录实际骰值因此需要另造回执。实测该判断错误：实际骰值由 `RuleDiceResolutionV1.dice/keptDice` 记录，且 `verifyRulePackDiceResolutionV2` 已是完整复算器（含 `seedCommitment` 与哈希比对）。另造一套会产生两条随机路径，二者漂移时无法判定哪个是权威。
- 否决 A：重复实现，且与既有检定的可验证骰机制不一致。
- 关联：§5.9、§3.4 第 4 条。

### D11 密级沿用既有闭集

- 问题：新增对象用什么密级词？
- 可选：A 新建 `gm-only` 与 `private:${actor}` 联合类型；B 沿用媒资、时钟、秘密和投影已使用的闭集。
- **选择 B**。主持专属统一 `gm-only`；角色私密用既有 `private`，具体接收者放 `knownBy`，投影层继续映射 `actor:${actorKey}`。
- 理由：`exact()` 与 `viewer-projection.ts` 已按既有词拒绝未知值。新词会让 F4 无法和旧秘密比较。
- 否决 A：同一语义两套词，密级不降级无法跨旧数据判定。
- 关联：§5.6、`TtrpgRuntimeMediaAudienceV1`。

### D12 `open` 开局仍走发布包

- 问题：`open` 没有闭合场景图，还要不要 CampaignPack 与 ProductRelease？
- 可选：A 直接从世界和会话开局；B 发布瘦 CampaignPack，绑定不可变 ProductRelease。
- **选择 B**。瘦包可以没有闭合场景图与结局，但必须冻结 fronts、clocks、canon 谓词、局势模板与 Session Zero；Oracle 表冻结在 RulePack。
- 理由：正式命令提交会核对冻结运行源（`verifyFormalTtrpgSource`）。没有发布包，新增事件没有可校验的 session，回放一致性无从保证。
- 否决 A：绕过总纲规定的 `S3 产品执行`阶段闸门（见 `docs/PROJECT-MASTER-CHARTER.md`），与「正式运行必须绑定不可变 ProductRelease」冲突。注意此处的 S3 指架构阶段，与 §5.8 的局势模板门 S3 无关。
- 关联：§7.2。

### D13 硬门只保留纯函数判定

- 问题：局势是否「像同一件事」、文本是否「充分支持目标」能否交给模型判断？
- 可选：A 把语义支持与同构相似度留作模型或人工判断并设为硬门；B 硬门只保留引用可解析、集合相似度与无环依赖，语义质量另作评测。
- **选择 B**。实例门 I1–I7 全部纯函数；反套路 A1 用最近 8 个局势的加权 Jaccard ≥0.80；A2/A3 改为必填且可解析的引用，不判断自然语言是否充分。
- 理由：硬门必须可回归。文本支持关系没有判定器。
- 否决 A：违反本方案的可机器判定要求。
- 关联：§8.2、§13.4。

### D14 谓词引用失败不等于条件不满足

- 问题：谓词引用了不存在的 key，求值返回什么？
- 可选：A 返回 `false`；B 抛 `predicate-unresolvable`。
- **选择 B**。
- 理由：返回 `false` 会让「作者写错 key」和「条件当前不满足」不可区分，作者改不动内容，四门也会给出误导性结论。
- 否决 A：错误被静默吞掉。
- 关联：§5.3 硬约束 3、§6.5。

### D15 媒资与分发包的关系

- 问题：媒资继续打进分发 JSON 还是分离？
- 可选：A 继续随包；B 内容寻址 + manifest 引用 + 按需预取。
- **选择 B**。
- 理由：既有分发 JSON 已经很大——`public/games/fog-harbor/game.json` 与 `public/prototypes/tidewake-town/release.storyforge-product.json` 都是仅含数据的大文件（本方案撰写用的源码快照未包含 `public/`，确切字节数需在完整检出上实测）。加入音频必然失控。成熟 VTT 的冒险文档同样不打包媒体、只存路径引用。音频按字符计费与图像按张计费不同，必须独立预算。
- 否决 A：体积与加载不可控，且媒资替换会牵动分发身份。
- 关联：§16、§15.2 P10。

### D16 供给瓶颈的判断

- 问题：冷启动的瓶颈是模组数量吗？
- 原判断：是，应优先做外部导入扩大模组供给。
- **修正后**：不是。一个好世界可支撑长期游玩，瓶颈是「世界可玩性密度」与「AI 能否撑住长局」。
- 理由：闭合格式作品是消耗型内容（跑完即消耗），`open` 是可重复利用的世界。
- 影响：外部导入从 P0/P1 降到 P11；新增可玩性密度作者工具（§11.4）与长局证据口径（§18）。
- 关联：§15.1、§17「作者供给起不来」行。

### D17 关系层级不新建 owner（2.0.0 新增）

- 问题：`open` 需要「关系层级」参与裁定（如 NPC 是否配合），而仓库里关系散落在实体属性与 `effectLedger.socialBalances`，没有单一 owner。要不要新建一个关系层级 owner？
- 可选：A 新建 `relationshipTiers` 状态与 `relationship-tier` 谓词；B 统一读 `socialBalances` 数值，分段由内容声明。
- **选择 B**。
- 理由：§5.10 禁止同一可裁定状态有两个权威。新建 owner 等于再造一套关系真相，与既有 `socialBalances` 必然漂移。数值 + 内容声明的分段同样可机器判定，且不引入新权威。
- 否决 A：双权威风险，且需要新的回退、分支与备份语义。
- 关联：§3.2 关系权威行、§5.3 硬约束 9、§12.1 `oracle.yesno.npc-cooperates`。

## 22. 判断偏差与纠正记录

只记录**影响过设计方向**的判断偏差，用于防止后续重犯。非设计类的过程失误不记入。

### B1 把跑团描述成接近固定流程的形态

- 偏差：早期把「闭合场景图作品」的流程当成跑团全貌，读起来接近剧本杀——固定场景、固定线索、固定结局分级。
- 纠正：跑团的内容单位是**局势准备**而非流程脚本。玩家可声明任何行动，由主持裁定；骰子参与决定结果，同一本两次跑法不同；结局可能完全偏离作者设想。「准备局势而非情节」与三线索法则存在的理由正是「玩家一定不按预想走」。
- 影响：把「玩家想做什么都能做」写成底线约束——玩家提出未预写方案时必须能合法裁定，拒绝任务与撤退后世界仍成立。
- 落点：§1.1、§5.8、§5.12。

### B2 擅自假定目标形态是一次性模组

- 偏差：在需求方未表态前，判定产品方向是一次性闭合模组，并据此给出「优先做外部导入扩大供给」的结论。
- 误判依据：`examples/ttrpg/fog-harbor` 是唯一真实可玩作品且为闭合本；分发形态是冻结 `bundleHash` 的成品包；`campaign.ts` 的可达性校验是穷举式的，而穷举只在闭合场景图下成立。
- 漏掉的反证：`campaign.ts` 已有 `fronts`（含 `escalation` 与 `defeatConditions`）与 `clocks`，这两者是长期演化工具，一次性本不需要；`advancement.ts` + `ability-ledger.ts` 的角色成长货币；`continuity.ts` / `continuity-state.ts` 的命名本身；`runtime-branch.ts` 的分支管理；世界引擎的版本化复用架构。
- 纠正：雾港是**打通全链路的验证载体，不是产品形态的定义**。
- 教训：把「唯一已交付的样例」当作「目标形态」，是一类系统性推理错误。判断产品方向前应先清点那些「只有目标形态才需要」的既有设施。

### B3 把跑团与其他产品混为一谈

- 偏差：曾提出「跑团 = 跑团 + AI 小镇 + 文字开放世界三层合流」，理由是小镇有离线时间补算、开放世界有区域变化传播，与所需的世界演化能力相似。
- 纠正：这违反架构明文——`productType` 冻结产品身份，工作台、查询、Build、Release、Session 按身份隔离。能力相似不等于产品可合并。
- 影响：全部新增模块落在 `src/lib/ttrpg/`；确需共用的通用机制走中立共享设施 + 独立基础增量单独审查 + 登记 owner。
- 落点：§1.4、§3.5、§15.3 准入第 4 条、§19。

### B4 以「缺商业证据」否定设计可行性

- 偏差：在评估阶段以「尚无留存与付费数据」为由，判断该方向不宜推进。
- 纠正：这是用后置阶段的标准衡量前置阶段。pre-revenue 阶段应评估的是「最大不确定性是什么、多久能验证、失败如何收场」，而非既有商业数据。
- 影响：§17 风险表每一行都附回退路径；§18 要求区分结构测试、真实模型评测与真人试玩，并把四项指标作为待取得的证据而非准入门槛。
- 教训：技术方案不以商业数据为前提，但必须自带「如何被证伪」的设计。

### B5 术语选择脱离目标用户的语言（2.0.0 新增）

- 偏差：1.1.0 用「沙盒即兴」命名本产品形态，用「模组局」命名闭合格式实现。需求方读到后无法把「沙盒」与自己想做的东西对应起来，且「模组」被误解为闭合流程的同义词。
- 纠正：产品形态的命名必须用目标用户已有的词。本形态就叫跑团；运行格式差异用中性技术词 `open` / `scripted` 表达，不借用有既定玩法含义的术语。
- 影响：§1.2 全量改名；§7.3 要求显式字段与守卫，禁止内容推断。
- 教训：给已有名字的东西另起新名，会在团队内制造「这是两个产品」的错觉，并把原有名字让给劣化实现。

### B6 把方案文档的修订当成代码进度（2.0.0 新增）

- 偏差：1.1.0 的 §2.3「第 0 号任务（已完成）」声明契约已升 1.1.0、能力基线已新增两行、文档权威已登记方案文件。实测 `main@d4201712` 上三者均未发生。
- 纠正：文档修订只有合入 `main` 才算完成。方案文档内部声明「已完成」不构成证据。
- 影响：§20 改为列出**待执行**的确切改法，并明确当前 `main` 版本号；§15.2 把文档修订列为 P1 这个独立 PR，验收条件是检查器通过。
- 教训：在同一份文档里既描述计划又宣布完成，会让后续读者无法区分两者。所有「已完成」声明必须指向可验证的外部证据。

### B7 用「同根词不存在」证明命名安全（2.0.0 新增）

- 偏差：1.1.0 声称「全仓 `src/` 内不存在 `situation` 等标识」。实测 `situationalModifier` 有 71 处（就在要扩展的 `submitTtrpgActionIntentV2` 参数里），其他产品的 `openingSituation*` 有 100 处。
- 纠正：命名冲突检查必须区分「同名标识」与「同根词」。前者是冲突，后者只是需要避免混淆的邻居。
- 影响：§1.2 补充同根词清单；§3.2 改为精确表述。
- 教训：「grep 没有结果」要先确认 grep 的是什么。粗略的否定陈述会在后续被当作既定事实引用。

---

> 本方案的全部硬约束都要求可机器判定。凡出现「合理」「适量」「视情况」而没有对应字段、谓词、阈值或布尔条件的地方，视为未完成设计，不得进入施工。
>
> §20–§22 与 §1–§19 具有同等约束力：修改任何设计前，先确认它是否推翻已记录的决策（§21）或重犯已记录的偏差（§22）。推翻决策需在 §21 追加新记录并说明理由，不得直接改写旧记录。
>
> 本方案基于 `main@d4201712` 的只读源码快照撰写，该快照不含 `.git`、`node_modules` 与 `public/`，撰写环境无法执行 `npm run ci`。§3 的代码事实经逐项核对；标注为「需在完整检出上实测」的少数数字除外。凡本方案与实际代码不一致，以代码为准并在 §22 追加纠正记录。

<!-- ttrpg-plan-original-v2.0:end -->

## 35. 2026-10-13 接手开发与进度

### 35.1 用户可查看的五步计划

| 步骤 | 用户结果 | 当前状态 |
|---|---|---|
| 1. 接手与版本兼容 | 核验交接包、保留原成果、修复类型及新旧格式串线，使现有作品继续可用 | 本次接手修复与基线验收完成：全项目 CI 通过，旧跑团隔离浏览器回归 9 项通过；不代表 open 产品或全部 P2a 用户流程完成 |
| 2. 规则行动与恢复 | 无场景的真实团局可完成一次规则行动，刷新/中断后不重复效果或耗时 | 进行中：Session Zero/epoch、初始机械状态、规则裁定/后果/因果耗时与待选恢复已实现；必需后续 owner 与跨阶段合作链待接入 |
| 3. 世界信息与作者制作 | 来源/角色知识有边界，作者能正常制作、检查和发布 open 作品 | 进行中：P2c 的机械初值/当前谓词、知识容器/投影、真实世界字段来源校验已接入；正式发现/传播、来源血缘/模型调用、P2d 正常作者端端到端路径继续实施 |
| 4. 连续合作体验 | Oracle、压力、局势、AI KP 与 2–3 队友接入同一正式行动链 | 按 P4 → P5 → P6a → P3 顺序；保留的纯模块不算正式接入 |
| 5. 联合验收 | 正常生产、连续合作、秘密边界、回放/分支/恢复和旧作品兼容同时成立 | P6b 后才可开放标准入口；P7–P10 按前置继续，真人/真实模型证据独立记录 |

每次进度以“正在做哪一步、已验证什么、还有什么未完成”汇报，不用文件数量或静态测试推算完成百分比。工程自动化不代替玩家与真实模型验收。

### 35.2 本次接手边界与证据

- 输入为用户提供的 `StoryForge-TTRPG-Standalone-v2.1.0-开发交接包-20261013.zip`。将交接记录视为待复核证据，不执行其中与当前仓库流程冲突的远程/本地指令。当前用户授权在现行项目接续研发。
- 在独立 `feat/ttrpg-handoff-20261013` 工作树，基于 fetched `origin/main@45c541e9` 整合 P1 文档，保护原工作树的 AVG 研究分支。依据原包 BASELINE/FILE-MANIFEST 和返回的 changes 清单逐文件验真；23 个修改、62 个新增与完整源码及差异副本一致。排除生成缓存 `tsconfig.tsbuildinfo`，保留原归档；当前主干的架构统计通过生成器重建，不覆盖成旧统计。
- 首次复现：相关 5 文件 176 项中 175 项通过、1 项 S9 引用失败；TypeScript 报告 protocol 1/2 进入旧调用链的问题。交接所述历史通过不作为当前工作树的最终证据。
- 收口：默认运行源读取仍为严格 V1，protocol 2 必须显式选择；不把 open 内容强制转成 V1。源于冻结世界的 whyNow 引用统一为 `world:<subjectRef>:<predicateKey>`，静态解析与运行时使用同一契约。
- open 子状态显式登记 schema/version/runFormat；共用机械字段、Session Zero、安全、账本与索引通过严格校验，只有明确 open 版本允许无场景/任务/闭合结局/成长里程碑。V1 解析和历史身份不变。世界时间前进不清零队友/Oracle 额度；完整 epoch/operation 授权与预算仍属于 P2b 的未完成范围。
- 旧场景命令不能写入 open，open 命令不能写入 scripted；未交付的 open 分支血缘在重映射前明确拒绝。继续保留后续纯模块及其测试，通过 `open-prototypes.ts` 的离线评估边界独立调用，不进入玩家路由、正式写回、provider 或能力完成证明。
- 当前不新增表、不变更 schema/备份版本，不新增模型调用/正式 AI 读写源，不回写 WorldRelease，不发布或部署。`E-TTRPG-OPEN-01/02` 仍为 `missing`，源码中存在模块不改变此状态。

### 35.3 接手修复提交 `200e9984` 的验证

2026-10-13，在 `feat/ttrpg-handoff-20261013` 的接手修复代码上完成：

| 检查 | 本次结果与适用范围 |
|---|---|
| `npm run ci` | 退出码 0；三注册表相关检查、架构/源码可达性/文档等治理门、lint、TypeScript、覆盖率、生产 build 与 bundle-size 均通过；依赖审计 0 vulnerabilities |
| 全项目回归 | 816 个测试文件、4559 项通过；整体 statement/line 88.16%、branch 74.50%、function 86.80%，原覆盖率门未放宽 |
| 跑团隔离浏览器回归 | `PLAYWRIGHT_PORT=4297 PLAYWRIGHT_USE_SYSTEM_CHROME=1 npm run ci:e2e -- -- tests/e2e/ttrpg-authoring-ui.spec.ts tests/e2e/ttrpg-production-journey.spec.ts tests/e2e/ttrpg-ai-kp-play.spec.ts tests/e2e/ttrpg-community-recovery.spec.ts --project=chromium`：9 项通过；覆盖既有 scripted 制作、开团、AI 回合、私密投影、刷新和检查点恢复；使用隔离浏览器与受控 provider，不访问作者现有浏览器数据 |
| 保留与提交检查 | 2.0.0 原稿保留块仍为 189,753 字节，SHA-1 `63778aa3f5f11487964d869b448d472ec51bfd75`；`git diff --check` 通过 |

这些结果证明该接手提交与现有工程基线相容，不证明新版正常作者生产、open 规则行动、真实模型、真人合作或公共服务已验收。该提交中的 P2b 仍为内部草稿；后续增量必须单独留下证据，不能沿用该提交的通过记录。

### 35.4 P2b 授权与初始状态增量

- 用户已明确开启持续目标，直到完成本方案。继续在现有独立产品分支施工，不把原包中的“已完成”记录视作新的验收证明。
- open 子状态增加稳定 portable `sessionKey`、冻结 `epochBudget` 和 `authorization`。旧 scripted JSON、解析字段闭集和历史哈希不变；这些是尚未公开的新格式内部字段，不对旧 JSON 补字段或重算身份。
- 初始实体实际装入冻结属性、衍生数值、资源上限和库存；共用已有机械编译与物品账本，不复制机械算法。安装边界对新格式逐项核对完整实体、库存、能力与产品身份，拒绝仅“类型一致”的篡改状态。
- `completeTtrpgOpenSessionZeroV1` 校验活动人数、已 claimed 真人、AI 身份披露、每名 AI/hybrid 队友的真人批准关系。授权回执、正式事件、参与席位接受/revision 与 runtime head 在既有单事务内落库；事务失败不留下半完成接受状态。旧 Session Zero 入口不代替新版真人授权。hybrid 席位具有真人认领策略和显式 AI profile。
- `startTtrpgOpenRunV1` 仅在有效授权后运行；`startTtrpgOpenEpochV1` 冻结真实触发输入 revision、授权 hash、Session Zero revision 和预算。一个团局只允许一个 active epoch；查看与刷新不产生新 epoch；同 commandId 同输入返回原回执，换输入拒绝。
- Session Zero 授权和 epoch 的起止来源使用 `{sessionKey, sequence}`，拒绝同序号的跨团局授权；内核生成 key，超长身份按 canonical hash 压缩。`closeTtrpgOpenEpochV1` 当前只关闭未执行业务的取消窗口，不以取消冒充操作结算完成；历史预算与授权证据保留。
- 新格式安全状态只能由当前已确认真人席位修改；AI 不能恢复真人暂停。暂停状态仍允许记录失败诊断和撤销空授权窗口。正式命令和纯 reducer 均拒绝没有已结算 operation 因果的直接世界 tick；后续在同一事件入口交付合法耗时推进。
- 此单元无新表、无 schema/备份升级、无新正式 AI 来源/写回或模型请求；WorldRelease 只读，公开 open 玩家入口仍关闭。P2b 规则行动/operation、模型请求 reservation、来源知识、作者生产与合作体验继续按 §31 推进。

本次增量定向回归 2 文件、22 项通过（其中新版授权/epoch 16 项）；引入安全控制前后的既有跑团回归及 9 个浏览器旧路径保持通过，新版授权 API 在真实 IndexedDB 中的双标签竞争、刷新、暂停/恢复、取消和纯回放通过，并在加入 qualified Session Zero sourceRef 后单独复跑通过。后续补齐初始库存正反例后定向回归仍通过。全项目 CI 待本增量最终回执，未结束的检查不记为通过。

### 35.5 P2b 规则结算与因果恢复增量

- `open-rule-plan.ts` 在正式业务前冻结规则/来源/授权/机械状态 hash、位置、能力与物品授予、目标、资源及次数、七档后果参数、耗时和受影响真人批准集合。generic check 的难度与费用来自冻结定义，客户端不得增设难度。共享池由 V2 冻结行动的 maximum/cost/reset 定义初始化；同池定义必须一致，缺失或超出容量拒绝发布。V1 解析策略不变。
- 正式 journal 只保存计划、审批、进度及真实来源；E4 裁定回执保存实际骰子与机械结果作为审计依据。资源/条件/能力/共享池仍由既有实体和机械账本拥有，后续 `effects.applied` 一次写入；复用 scripted 的机械结算算法，保留旧骰子 nonce、旧回执形状和断言。
- operation 按 rule → mechanics → 可选 effect → 冻结 time ticks 顺序恢复。每个步骤业务事件与步骤完成回执分开保存，回执必须引用已经提交的真实业务事件；内核生成 qualified step key，重复恢复返回原事件，不重掷、不重扣资源、不重复计时。尚未接入的 pressure/situations/terminal/gates/narration/handoff 保留必需步骤，恢复返回 awaiting-owner，不能用空成功回执结束 operation。
- E7 的事件 sequence 排序存储，独立 causeRef/byEventSequence 引用真实 E4；耗时 0 不产 tick，耗时 N 顺序产生 N 个 tick。open 共用能力的 cooldownRounds 与条件的 defaultDurationRounds 分别按 worldTurn 与真实 tick 计算，兼容 round 保持 0；scripted 原回合逻辑不变。每个 tick 只重置 Oracle 的 consultedThisWorldTurn，epoch 级 AI 行动和模型预算不清零。
- 冻结后果的 alternatives 持久保存并等待该角色的真人批准者选择；AI 不能自选/代批。当前 E3 为确定性内核规则计划的确认/后果选择变体，P3 的模型语义意图、candidate/run/manifest/visibility 证明仍待正式 Harness 接入，不伪造这些证据。
- `disposeTtrpgOpenIntentV1` 保留撤销事件，仅可撤销尚未提交业务的本人计划；允许安全暂停时撤销，不消费资源。已经提交 E4 的计划必须继续恢复，不能抹去骰子。安全 pause/resume 的审计字段不改变机械基线，暂停阻止执行、恢复继续原结果；其他机械变化仍使计划 stale。
- 此增量未新增表、schema/备份版本、正式模型调用或公共玩家入口。来源知识、作者端生产、Oracle/事实/压力/局势与合作链继续按 §31 施工，能力基线保持未完成。定向跑团回归 51 文件、389 项通过；浏览器旧流程 9 项加 open 授权/规则恢复 2 项共 11 项通过。全项目 CI 以本增量最终回执为准，未完成的检查不记为通过。

本增量最终工程回执：`npm run ci` 通过（818 测试文件、4,596 项测试；覆盖率、构建、依赖审计及全部工程闸门通过），`npm run ci:e2e` 跑团定向 11 项通过。检查期间源码指纹一致。以上仅证明本增量工程与隔离浏览器路径，不代表正常 open 作者生产、完整行动后续 owner、真实模型或真人合作验收。

### 35.6 P2c 来源权威与角色知识增量（施工中）

- `open-fact-authority.ts` 由冻结 initial-state 条目建立既有机械 owner 的开局值。位置/物品持有分别校验实体绑定和库存；位置的物理 open/blocked/damaged 存实体属性，destroyed 使用 lifecycleStatus；角色 damaged 由现有 HP 求值且初值不得与冻结角色卡冲突；物品损伤与位置委托现有耐久/库存/持有人位置，不建立镜像值。社会关系使用现有 `subject:relationship:object` 有符号余额（正为 allied、负为 hostile），债务使用 `subject:debt:object`；相互矛盾的初值拒绝。
- 正式 open 的 world-fact 谓词读当前 owner 投影，冻结语义 invariant 与发布索引/来源 hash 不变。初始位置、持有或耐久不会在行动后仍作为“最终值”裁定。知识也进入准入基线；确认事件不使计划过期，但实际准入知识变化使旧计划 stale。
- `openRun.knowledge` 有严格来源/接收者/密级/可靠性/字段 hash 解析与初始化。角色知识不依赖局势仍 active，也不以模板的 party 标记表示已经发现；只有 observed 授予可过客观 evidence 门，hearsay/belief 保留标签供阅读。历史 party 授予不自动扩展给后来角色，公开投影排除 private/gm-only。正式 discovery/share 写入仍属于后续 P4，当前容器保持空初始化，不伪造发现事件。
- 规则目标与效果绑定验证行动者自己的冻结受众、活动实体和已选真人名单，不能借真人批准者的秘密替 AI 队友获得知情。复合能力 stateKey 从真实 actor/ability 身份校验，允许两个合法长 key 的组合，拒绝混合身份。
- open Brief 的准备/保存/开始复用中立世界网关与冻结 SourcePlan 权限，读取实际冻结资源，核对 sourceFieldRefs 的资源 hash 和真实字段路径，最后复验 WorldRelease 身份。读取权限、hash 或路径不合法时不保存 Brief、不开始 Build；正常作者测试使用实际世界字段，不用编造字段来源充数。这是可追溯性校验，不宣称自然语言推断的事实绝对正确；作者确认仍独立保留。
- `coordination.calls` 的版本化生命周期及纯预算约束已接入解析，区分 prepared/dispatched/succeeded/failed/unknown、原始响应工件 hash、实际/估算/未知用量。未知派发结果保留预算并拒绝新请求；失败不抹去请求次数或费用，实际超额也须保留证据而后停止。请求摘要由真实回执派生，导入时拒绝隐藏 pending 的伪造汇总。
- `reserveTtrpgOpenModelCallV1` / `dispatchTtrpgOpenModelCallV1` / `finishTtrpgOpenModelCallV1` 已接入具名事件和纯 reducer。预留要求冻结策略启用 AI、当前真人 epoch、同一实例/角色的真实 Run、已登记 `prose.ttrpg-open-intent` Skill、完整实际 Context Manifest、同 attempt 的原始请求和模型请求绑定；输入/输出/调用/费用同时受 Run、Skill 与 epoch 限制。Run、事件与 exact 工件在运行事件事务内再次比较，不能用手填 hash 替代证据。调用 payload 只保存稳定角色、session/epoch 引用和 hash，不保存本机 runId、provider 配置或密钥。
- 派发返回 `{ event, sendAuthorized }`，只有首次成功事务返回一次性 `sendAuthorized: true`；重放和并发竞争者只拿到历史回执，不能再次发送。派发前复验授权/角色视图/机械准入 hash；派发后中断且无响应记 unknown，读状态不触发请求。成功/有响应失败先通过现有受治理 exact artifact 入口保存原始响应，并要求同 attempt 的模型响应事件。终态可在安全暂停或机械输入过期后保存已产生费用，但不能采纳旧输出或执行行动。正式 provider 执行器和候选采纳仍待接通，目前这些测试未发送真实模型请求。
- `loadTtrpgOpenPlayerContextV1` 只读取一个已确认玩家的资料，核对当前席位/同意策略与跨来源读取期间的状态。其他角色仅有可见的同地身份，未读取 GM profile 或其他玩家秘密；开局观察明确标为 release 时点，不以隐藏 NPC 的当前状态覆盖角色记忆。知识字段 hash 必须仍对应冻结可读字段。
- `ttrpgOpenAuthority` / `ttrpgOpenKnowledge` 已登记 CONTEXT_SOURCES 和 AI Manual，分别提供完整角色契约、自己的能力账本、必读规则目录、逐条获授行动/可见 generic check、开局观察及知识资源。规则目录不泄露 GM 后果模板或隐藏前置谓词；能力可用性读当前次数、冷却、共享池、条件和资源，查询不扣账。Context Gateway 使用固定 instance/World/Work/稳定 runtimeActorKey 和内核资源 allow-list，拒绝无明确资源边界的宽读。JSON 只能 full 读取，超预算拒绝而非截断；原始 runtime head/其他角色原文不可读取。metadata cursor 绑定角色、状态与查询，缓存每次先重新验证源/权限，返回副本避免调用方污染。登记来源和候选 Skill 不代表完整 AI 跑团交付。
- 规则计划冻结 rollVisibility 并遵守现有暗骰策略，generic 的 gm/actor 受众保守使用 gm-only；不会把暗骰强制公开。location.set 已作为既有实体 owner 的机械效果接入同一幂等结算链，value 必须等于已冻结合法地点 storyKey；其他未交付 story/knowledge 效果仍保留待办，不写入旧故事账本充数。
- 本增量无新增表、schema/备份版本或公开玩家入口。P2c 尚需完整来源血缘/切点与剩余结算、正式 provider 执行器/候选链和实际 Gateway 运行清单的贯通；P2d 及后续 Oracle/压力/局势/合作/四门和 P7–P10 仍按 §31 完成。`bdda6ee6` 的全 CI/11 项 E2E 回执仅属于上一提交，不能用于宣布本增量全项目验证通过。

本段定向证据：接入工作树后的跑团回归 56 文件、408 项通过；加入真实来源校验及伪造 hash/path/permission 零写入反例后，作者路径 33 项通过。全项目 CI 与本段最终浏览器验证待最终稳定快照，不记为已通过。

### 35.7 P2c 分支来源与剩余结算增量（独立候选，尚未集成）

- 当前产品研发仍处于跑团 S3 内核地基：入口是明确创建分支，owner 为子 Instance；世界、规则包与产品冻结来源保持只读。复用 runtime 的已验证准备/插入边界，在单一事务中复验父行、真实切点事件及冻结来源，插入子实例并复制参与者/既有扩展；任一复制失败整体回滚，不留下可运行半分支。
- 普通 V2 运行态不新增序列化字段；子分支才持有闭集 `branchLineage`。祖先证据冻结 sessionKey、切点/hash、来源、游戏随机种子及 commitment、连续事件摘要/hash和历史运行快照；真实父事件继续使用父限定引用。删除物理父实例后的 setNull 不删除冻结证据；备份导入只重映射物理定位，保留稳定来源身份。
- 子分支保留切点内实体、库存、能力、知识、压力与游戏时间；旧授权/epoch/模型请求留在只读祖先快照，不成为子分支活动权限。重新确认 Session Zero 后才能启动新窗口，未知请求不自动重发；已运行分支不能借开局角色创建器重写继承机械状态。只有本地事件排序边界重新建立，worldTurn 不归零。
- `inheritTtrpgOpenSourceV1` 在新真人窗口下提交真实 `ttrpg.open.source.inherited` 回执；重复命令仅返回原回执，不掷骰或施加效果。该回执表示来源继承，不能单独宣布恢复完成或替代受影响真人的确认。
- `startTtrpgOpenInheritedOperationV1` 复用祖先原裁定，绑定当前授权与明确的剩余业务前缀。父业务已提交而步骤回执缺失时也视为已发生，不能重复扣账或推进时间。新增效果与 E7 引用真实子继承事件；裁定仍标记原随机来源及原结果，不伪装为子分支新骰点。后果已选项随风险重新确认，尚未选择的继续等待真人；拒绝保留审计记录，只有新显式 epoch 可重试。
- 机械/后果/时间的恢复已接回同一 operation 协调器；父分支保持不变，二次分支继续保留原随机来源。压力及后续 owner 尚未接入时诚实停止在 `awaiting-owner`，新意图/行动不能绕过继承待办。本增量不宣称完整 AI、作者界面、Oracle/压力/局势或公共 open 玩家已经交付。

独立候选验证：65 文件、499 项跑团与 Context Gateway 回归通过，含 19 项分支/切点/二次分支/选择/拒绝/备份往返测试；TypeScript、改动文件 lint、三注册表架构、128 表生命周期登记、源码可达性及 AI Manual 一致性检查通过。浏览器和整仓 CI 尚须随候选最终快照完成；上一单元全 CI 正在本机共享队列中串行等待，不能据此记为通过或替代本候选验证。


### 35.8 P2c 正式角色输入与候选回执（独立候选，尚未集成）

当前接通的是内部意图服务。真人 epoch 输入、角色读取权限、机械状态与明确 provider/model 绑定后，Context Gateway 按真实目录闭集渐进读取，完整 JSON 不截断。发送前保存 selector/packet/实际来源原文、完整请求及 V2 输入 manifest；V3 Run 冻结 Skill 与正式入口。派发事务重读当前权限和所选资源，并验证全部工件的真实字节回执，只有首次提交获得一次发送许可。响应后才生成完整 V3 Context Manifest，不伪造提前完成的模型回执。

模型只输出目标、方法、可见目标/资源、声明假设与期待结果；系统补充既有 `TtrpgOpenIntentV1` 的身份、来源和输入版本。模型不能自造新路由、难度、效果或授权。响应原文先保存、实际 token 用量先记账，再生成 CreativeArtifact 和持久化候选；坏 JSON、越权引用保留原文并进入人工修订，本单元不自动重试。未知外部结果保留预算并终止该 Run，竞争执行器、刷新或重读不产生第二次请求。生成期间权限、机械状态或窗口变化时阻止候选采用。provider 不提供真实账单金额时保持 null，使用预留额度和显式提示，不把价格估算写成实际收费。

15 项新定向测试已通过：真实 Gateway 输入、字节缺失、暂停、完整 V3 回执、原文保留、候选回读、坏输出、隐藏引用、生成期间 stale、未知结果、并发单次发送和模型身份不匹配。测试只使用显式隔离模拟 transport；真实 provider、真人短局、公共界面、候选确认/规则路由以及 P2d 正常作者制作仍待完成。全量 CI 与浏览器证据须分别属于最终快照，不以此单元的定向测试代替 OPEN-01/02。


### 35.9 工具 schema 版本绑定复验

P2c 冻结快照的整仓 CI 跑完 827 文件、4648 项测试：4647 项通过，`R-HARNESS18-execution-version-freshness` 的真实工具 schema hash 校验失败。因此该次 CI 明确记为失败。实测工具快照 SHA-256 为 `3e56e3ab40a630f0d39f22072e8423688b880b050d3fdcdb591bdc76c0fcb46a`；从快照删去新增 `ttrpgOpenAuthority` / `ttrpgOpenKnowledge` 两个注册源后恰好恢复旧哈希，证明失败由注册源闭集扩展引起。工具 schema 版本按已有约束升级为 `agent-read-tools-v7`，架构门同步锁定真实新哈希，未放松校验。修复后的版本绑定及模型请求账本 16 项定向测试通过；完整 CI 仍须属于修复后快照，未通过前不提交该交付单元。


### 35.10 2026-10-14 真人意图确认与规则准入（独立候选，尚未集成）

`startTtrpgOpenIntentCandidateOperationV1` 只接受真人明确确认的真实候选 hash。提交前回读候选原文、完整 Gateway 回执、同一角色与窗口的成功请求，并把 Run、事件及全部原始工件纳入同一提交事务的 CAS；过期机械状态、权限、窗口、坏输出和已删证据不能生成操作。代码按既有意图路由匹配当前角色已获准读取的规则，仍由同一规则准入构造冻结 plan。多目标不静默截断；后果参数不能引用当前角色不可见对象。Oracle、免掷骰和澄清路径的 owner 未接入时明确拒绝此规则入口，保留候选供后续流程处理。

真人确认意图只创建 `awaiting-approval` 操作，不掷骰、扣资源或推进时间；受影响真人仍须单独确认冻结风险。相同候选的重复确认返回原事件，不创建第二个操作。只有候选来源操作新增闭集 `intentEvidence`，引用真实终态请求和输入/原文 hash；普通操作序列化不增加字段。状态解析和离线回放校验该来源；分支把它保留在祖先真实操作中，子恢复只继承已提交业务，不能克隆旧模型调用或重新掷骰。

6 项新增反例/主路测试通过，覆盖重复确认、风险审批未绕过、坏输出、暂停后的 stale、替换 hash/其他 viewer、候选字节缺失及候选来源分支恢复；既有 23 项规则操作和 11 项分支恢复测试继续通过。输入/transport 另新增忽略 AbortSignal 时仍能退出，以及非重试型4xx阻断同窗口新请求；本单元合计23项新测试。正式调用现在先保存角色原文再形成 CreativeArtifact，但作者生产 UI、候选修订与完整 Harness 终态、Oracle/免掷骰/压力/局势及公共 open 路径仍未交付。真实模型、玩家验收与最终快照全 CI/E2E 均独立记录。


### 35.11 P2d 制作预算、专属 DAG 与真实保存/开始（施工中）

保留已交付的独立 `storyforge.ttrpg-production-brief` V3 内容/开始交接契约原语义；正常制作新增共同 ProductProductionBrief V3 的闭集 `ttrpgOpen` 专项，不能与旧 `ttrpg` 同时存在。该共同合同冻结制作预算、能力、许可/降级与完成要求；不得用运行 epoch 预算代替制作预算。同步/异步解析职责分开：同步形状解析不声明来源/hash已验证，保存、计划和开始前仍校验实际 RulePack、WorldReference、SourcePlan 及真实来源字段。

六个固定 open task ID 接入现有 plan 工厂与解析器：source-facts、rule-system、situation-layer、media-plan、integration、quality。来源/规则/局势新增专属 Skill，媒资需求沿原 Skill 职责复用，集成/质量采用确定性任务；旧 content.narrative/content.product-module 的 scripted DAG 不变。计划不带假 choice/ending，明确上游产物、真实依赖回执、预算和 terminal join；混合格式、损坏规则、方向/世界不一致以及篡改任务预算不能进入计划。

预算化 open envelope 已经通过现有 save-brief-revision 和 authorize-start 保存并创建真实 Build，保存与开始均验证当前 Production key 和实际世界来源。导出/导入后原 Brief 字节/hash 保持不变，SourcePlan 的本地定位按 PROJECT_TABLES 重映射；开始时使用经验证的定位覆盖，不能改写已确认内容来适应新主键。相同开始命令回放不新建第二个 Build。

6 项新计划/合同/保存/开始/真实备份往返测试通过，既有33项 authoring-version及5项共同plan测试保持适用。当前只接通计划与授权地基，实际 source-facts/rule-system/situation-layer 执行器、共同媒资生成任务拓扑、作者编辑/检查/Preview/发布 UI 和正式 open 联合验收仍待继续。需要必需图像/音频能力时，当前计划不能把媒资需求任务冒充生成能力；缺少对应任务仍受共同能力覆盖门阻止。


### 35.12 P2d 实际产物编译、人工确认与 open 内容质量门（独立候选，施工中）

本增量属于跑团作品生产 S3；Work/Production 拥有制作候选、采纳工件和运行包，世界仍是只读冻结来源。三个新模型任务输出闭集 source-facts/rule-system/situation-layer 工件；制作身份、hash、来源定位与设计血缘由系统生成。来源事实和角色数值的模型输出不能自行宣称作者确认：保留已收到原文和真实用量，在当前任务进入人工修订恢复，只有明确 author-edit 回执才可继续下游。来源专属任务要求作者所选资源的 full 读取，预算不足阻止请求，不能用摘要伪装字段证据。

确定性编译读取当前 Build 已采纳的真实 row，复验作用域、原文/hash、冻结 Brief/SourcePlan、世界字段来源、角色席位与控制权、已确认事实/数值和冻结队友/阶段/运行策略；实体绑定的独立来源也必须验真。导入后的实际 SourcePlan 定位覆盖只参与读取，不改写原 Brief 字节。产物为 Campaign V2/open 与协议 2 RuntimePackage，叙事壳仅保留真实开局文字，不编造 choices/endings 或场景图。旧设计血缘继续原样解析；新 open 设计血缘记录实际 Brief、SourcePlan 和三个采纳产物 hash，不虚构两三份设计提案或结局归属。

open QA 复验独立 RulePack/Campaign 与 runtime 原文一致，并组合既有九项 open 出版内容门和共同完成合同；开放叙事壳按自己的引用/只读检查，不要求固定结局。该报告证明内容结构和来源一致性，不能替代真实模型、长局、人类游玩或商业验收，也不改变实验入口开放状态。媒资规划已接回既有需求解析；共同生成任务/采纳与实际素材尚待接入，有非空媒资需求时集成明确阻断，不能把规划当作生成结果。

本单元新增编译5项、执行器7项，另既有6项 open 内容门及6项制作合同/保存/开始/备份往返测试通过；执行器测试覆盖当前 Build 采纳、stale/跨域/原文损坏、协议 1 拒读、不完整内容拒绝、九门联合通过、导入定位、模型自报确认拒绝以及零追加调用的人工修订。测试使用隔离数据与显式模拟 transport，尚非正常 UI 全流程或真实模型验收。整仓最终快照 CI/E2E、正常 open 作者入口、共同媒资任务、Preview/发布的协议 2 消费者与完整运行 owner 后续继续。


### 35.13 P2d 新建 open 作者路径、真实调度器确认恢复与协议 2 Preview（独立候选，施工中）

正常 prepareTtrpgBrief 现在按当前 Settings 格式分流。open 分支直接从新跑团 Work、该 Work 的 validated RulePack V2 和显式选择的冻结世界生成共同制作预算草稿，建立自己的 intent/SourcePlan/预算化 Brief；不要求曾经创建 scripted Production，也不借用旧规则数值或结局设计。共同草稿仍只在内存中，补入已验证 open 内容后才允许 governed save；准备不产生开始授权或 Build。已有未开始且来源相同的制作可新增方案修订，旧 Brief 字节保留；有 Build 或来源不同则保留历史并建立新制作。未确认策略、旧版规则和 stale 草稿在创建制作记录前拒绝。旧 scripted 编译与共同产品草稿的最终解析行为保持原合同。

四个新制作模型任务按精确 task/Skill/product/mode 登记既有人工修订权限，确定性集成/QA 不能使用人工 JSON 绕过自己的门。真人 resolve-blocker 的确认复用共同 durable Run/候选/采纳链；人工修订不发出第二次模型调用。新建 Work 的实际调度器纵切面已经覆盖来源事实确认、规则数值确认、局势、媒资规划、集成、九门 QA、root 终态、冻结 Preview 和协议 2 Instance 初始化，使用隔离模拟 transport 而非真实供应商。

terminal join 明确识别 open/legacy 制作格式并复验包协议匹配，Preview 使用既有协议 2 重载生成/验真；resolveProductRuntimeSource 新增显式协议 2 读取，默认协议 1 消费者继续拒绝 open。媒资 resolver 只声明自己实际使用的 presentation/binding 字段，不扩张机械权限。兼容性报告加入 open 的真实规则、战役和来源语义；规则、压力、可见性或其他战役合同变化保守标记 breaking/pin-old-save，不能当作无关表现变化或静默迁移。

3 项 fresh-authoring、1 项实际调度器纵切面和4项 open 兼容性测试通过；既有33项作者版本、7项共同会谈、26项恢复 UI 和3项共同兼容性测试保持通过。编译/执行器/计划等前段证据见35.12，尚无整个最新候选的全 CI 或真实浏览器通过声明。新增浏览器测试覆盖两次人工确认间的刷新、计费调用不重复、最终 Preview 指针和 Instance 刷新回读，待串行队列执行。

本阶段仍未开放公开 open 玩家，也未完成真实模型/人类游玩/商业验收。作者结构化方案编辑体验、共同媒资生成与采纳、正式发布/分发消费者，以及 P4–P10 运行 owner 继续施工；当前无媒资需求路径通过不代表有媒资生产已经交付。

协议 2 来源补充：新编译产物的 sourceWorld.bundleHash 按实际核验过的事实/实体字段引用、可移植 WorldReference 和冻结 SourcePlan hash 计算 source-evidence bundle 身份；不把 releaseHash 直接冒充 bundleHash，也不宣称已经读取一个固定全世界 payload。继承的旧字段/旧内容保持原样；新计算不包含本地物理定位。编译5项、执行器7项和实际调度器1项在此修正后继续通过。该修正晚于 p2d-combined-validation-4sy03rcb 快照，必须单独纳入最终验证，不能拿那个快照的回执宣布最新工作树已验证。


### 35.14 P2d 作者审查与共同媒资接线（独立候选，施工中）

开放方案审查页显示实际冻结的开场、席位、运行边界和制作预算，只提供转入制作页，不生成旧式虚构提案或代替开始授权。角色/战役检查页显式使用协议 2 读取，并显示局势、压力时钟、冻结事实与阶段闭合；旧剧本提案和场景路径保留。两项隔离 React/IndexedDB 测试通过，覆盖未授权不创建 Build、已生产协议 2 内容显示、坏 Preview hash 拒绝。

图片/音频 bundle 任务构造器从共同计划抽出，旧通用产品继续使用相同任务、预算、Skill和产物名，文字冒险专属链不变；open 计划使用自己的规则/局势/需求输入和确定性集成，追加真实媒体生成任务及依赖回执，按新增任务数重新分配时间/存储/金额预算。新增规划覆盖测试与既有五项共同计划测试通过，不能把媒资规划当作生成能力。

open 媒资规划使用已采纳角色的真实 identity 与明确 slotKey；规划、生成和集成均拒绝改换槽位、角色、尺寸或虚构节拍。集成回读当前 Build/epoch/作用域的已采纳媒体行、消费的冻结需求、真实 Blob hash/大小/尺寸和权利快照，再绑定准确槽位；没有“找第一个兼容槽”的回退。模型或物料自报预绑定素材没有真实文件证据时拒绝。生成图片不自动变成公开叙事 cue；运行受众/时机仍需 P10 消费者治理。共同程序化 SVG 只在逐字复现登记的确定性渲染器结果时受信，不能冒充商业图片验收。

执行器9项定向测试通过，新增真实共同生成器→Blob→槽位→QA覆盖及损坏字节/虚构绑定反例；该媒体纵切面目前是明确的程序化 prototype 图片。音频任务已接到共同执行器但还需实际音乐/音效纵切面；配音尚缺定稿脚本/真实配音能力，明确拒绝用音乐或音效充数，仍属后续 P10。完整作者结构化编辑/素材采用与返修/正式发布消费者、真实图音生成质量、公共 open UI 和 P4–P10 仍未完成。

整仓首次 combined 快照校验失败于 ARCHITECTURE 自动项目统计漂移，未运行到全测试/构建/E2E；该失败回执已保留。更新真实统计后须以包含本段和来源 evidence-bundle 修正的新快照重新验证，不以包装进程的退出码代替阶段回执。

### 35.15 2026-10-14 生产媒资纵切面与完整上下文预算（独立候选，尚未集成）

共同音效生成器已通过真实 WAV Blob、RIFF 字节、时长、精确槽位绑定与 QA 覆盖的纵切面，执行器共10项定向测试通过。完整生产协调器在无图片和带一张真实归属图片两种配置下均完成两次真人复核、采纳、集成、QA、固定 protocol 2 预览与实例读取，共2项测试通过；模型 transport 为明确的隔离模拟，图片/音效仍为程序化 prototype，不等同真实模型质量或真人跑团验收。

open 媒资任务与来源专员同样读取完整冻结上下文，原预算均分导致人工修订后的必读来源超预算，现按实际上下文任务数分配输入额度。新 S2 草案建议每任务至少48000输入 token，作者在开始前看到并确认总额；已有授权预算不增加、不截断必读资源、不自动重发请求，预算不足仍明确停止。最终整仓 CI 与浏览器验证须属于本次最新冻结快照。

### 35.16 2026-10-14 P4 正式 Oracle 原始裁定与角色历史（独立候选，尚未集成）

`consultTtrpgOracleV1` 现通过同一正式命令事务读取冻结 protocol 2 来源与当前真人席位，绑定本人 active epoch、明确问题、冻结 Oracle/档位、真实 seed/commandId/事件 sequence。内核生成并完整复算原始骰子、词条采样及结果后提交 E4；不增加游戏时间，不改 chaos，不产生机械实体、事实、解释或模型调用。同 commandId 同输入返回原事件，换问题拒绝；同 worldTurn 最多两次，关闭/重开 epoch、刷新、分支均不重置额度。有未确认/未完成行动或祖先结算时不得插入咨询。真人只能提交自己的角色或明确批准的 AI 队友咨询；`gm-only` 咨询需要真人 GM 席位。

真实结果保存在既有 runtime 的可选 `oracleReceipts` 日志中，旧无日志 JSON 形状保留；严格解析冻结规则、原始结果、Dice/词条回执、受众、前序来源、epoch 和额度。分支保留真实父结果和 qualified session/sequence，需重新同意和新窗口才能添加结果，不能换父结果或由子 seed 复算父骰子。删除父会话、项目备份往返和作用域重映射后仍可读取祖先证据。Oracle 历史不能直接作为规则事实。

新增注册源 `ttrpgOpenOracleHistory` 通过角色专属 provider 完整读取 party/public 历史，排除 GM-only 问题/结果、seed、骰子证明、完整规则表及其他角色私事；强制 POV、资源 allow-list 和原文禁读。新增 source 闭集的真实工具 schema hash 是 `2b610dca5ceba52c16cdb6380c135a5ba514f932e8432919ec3a9e25a57038ee`，版本升级为 `agent-read-tools-v8`，架构门与真实 hash 校验一起升级。现行意图 Skill 仍只读原有两个来源，未擅自扩大其权限。

9项 Oracle 实际 DB/事务/回放/预算/隐藏结果/分支/备份/provider 测试及既有角色读取、版本绑定联合21项测试通过。前一次扩展分支/operation联合回归有1项测试调用缺少真实安全操作 viewerKey 的失败，已修正测试并复验，不放松安全授权。无正式模型解释、会话事实提交/传播、压力结算、Oracle 表编辑与公开玩家入口；这些仍继续实施。P2d 冻结快照与本段之后的 P4 代码分别验证，不能将旧快照未来的 CI 结果归给本增量。

后续复验：全部跑团、Context Gateway 与 R-HARNESS18 联合82文件579项通过。角色读取及后续 Oracle 提交现在还按实际冻结来源和原始父/子 seed 复算完整历史；这一新增检查后的相关27项通过。再补同命令并发单次落账、错误 seed 与篡改 proofHash 反例，Oracle 专项共10项通过。TypeScript 与定向 lint 通过。已增加原生 IndexedDB 浏览器刷新/重复/分支/额度测试，尚待共享串行验证；该测试是隔离 API 路径，不代表公共玩家 UI 或真实模型验收。

### 35.17 2026-10-14 P4 会话事实正式事务、原子替代与角色读取（独立候选，尚未集成）

本单元属于跑团产品研发的 S3 运行 owner：只读冻结世界/规则/实体绑定，在已有 ProductRuntimeSession 与事件表中保存可选 `factLedger`，不新增表，不改 WorldRelease、机械实体/位置/库存/关系 owner，也不把叙事事实当成知识发现。

`commitTtrpgOpenOracleFactV1` 当前是明确的真人 GM 确认入口。候选 hash 绑定实际 Oracle 的 qualified sourceRef、输入字节、运行源、viewer 和确认基线；同一正式事务重读来源/当前席位/本人 epoch、复算 Oracle、校验事实账本，再执行 F1–F4。模型不能凭输出 JSON 使用此入口自批。新事实的身份、origin/sourceEventRefs、创建事件与来源基础由系统生成；来源基础按实际冻结索引、十二谓词策略、实体绑定和不变量生成。拒绝未知主体/来源、机械 owner、占用世界不变量、Oracle 替玩家作决定或虚构玩家知识、越权接收者、暂停/过期/待结算状态。

账本保留不可变原记录，显式退休另留真实事件。`supersedes` 必须同槽位、带原因和旧事实来源，在一条 E5 事件中新增并退休；替代某一条不能绕过其他仍活动的矛盾记录。E6 只能撤回活动的会话事实。同 commandId 重复确认/撤回回读原事件。回放重跑门，分支保留精确祖先事实、Oracle seed、来源和授权，子分支退休不修改父分支；备份/导入重映射保持原字节证据。现有多值谓词保留 objectRef 比较；相同对象的布尔 knows 相反值会冲突，不把不同知识/承诺的自然语言文本一律判冲突。

当前事实已进入统一谓词与机械准入状态 hash，退休事实不满足条件；读取和后续提交按实际来源基础/候选 hash/原始 Oracle 复算，并复验当前生效事实。新注册源 `ttrpgOpenFacts` 用角色 provider 完整读取自己的活动事实，排除 GM-only、其他角色 private、已退休事实、内部基础和确认回执，禁止原始 head 读取；旧 party 接收者不随后来角色自动扩大。祖先 party Oracle 历史也按原授权角色投影。工具 schema 升级 `agent-read-tools-v9`，真实 hash `ed355791a71be27c372d0764af8fcc1991bf9ebadd73e98437165ce188890105` 与架构门绑定。

10项新事实事务/反例/分支/备份/角色 provider 测试通过；事实门、秘密与版本绑定联合27项通过；来源复核后的事实/Oracle/分支联合28项通过。新增原生 IndexedDB 刷新/同候选重复确认/私域视图/撤回/世界不回写浏览器测试尚待运行。当前没有 AI 解释/归一化候选的正式 Harness 采用、knowledge discovery/share 或公开作者/玩家入口；现行意图 Skill 没有因此扩大来源权限。此记录不是 P4 或产品完成证明，正式 AI 与知识 owner 继续施工，整仓和浏览器验证须对应最终冻结快照。

### 35.18 2026-10-14 P4 明确发现路径、代价与来源传播（独立候选，尚未集成）

规则请求新增可选 `discovery`，冻结具体 active 局势、介入点、evidence、真实 action/check 路径与后果绑定；原无此字段的请求/计划/步骤 JSON 保留。新知识步骤位于效果之后、游戏时间之前，不因执行同名行动自动发现所有线索。前置谓词、可见介入点、实际接收者、冻结内容与公开字段 hash 均在系统校验。发现计划保存准确 protocol 2 内容快照，以支持离线回放；这是本阶段的正确性实现，长局空间与读取优化仍属后续工作。

`discoverTtrpgOpenKnowledgeV1` 引用真实本地规则回执或显式祖先继承回执。成功才授予；失败必须有作者冻结的 fail-forward 模板才授予。代价/失败前进沿既有效果内核支付，并与 observed 知识和因果步骤在一条 E 事件内原子提交；不能扣费后丢失授予，不能重复恢复再扣费。目标和接收者纳入真人批准关系，AI 不能自批。未知/缺少独立选择的后果明确保留待办，不默认选第一项。纯 reducer 重算完整结算，拒绝改结果、换接收者、缺真实因果或跳步骤。原 `clueCatalog`、世界和 scripted 路径不接收这些记录。

`shareTtrpgOpenKnowledgeV1` 需要当前真人或实际 AI 队友批准关系、本人窗口、已有来源、完整内容/接收者确认 hash。只传播冻结的 title/description 等公开字段，不发送 GM truth/profile；接收者得到 hearsay（belief 保持 belief），不伪造 observed，也不通过本人发现的规则门。私信约定由真实冻结发现来源派生，传播链追溯原发现；没有合法源/字段、冒充未知角色、暂停或过期均拒绝。分享不推进 worldTurn、不改原私人授予，不自动扩展到新席位。传播回执可在删除父团局后随祖先 capsule 保留，备份重映射不更换事实源。

8项新实际事务/发现/失败/扣费/分享/角色/分支/备份反例通过，与 operation/branch/R18 联合46项通过；追加真实发现来源检查后的角色/提供者联合16项通过。TypeScript、定向 lint、架构/表/AI Manual 门通过。首批测试误用了过高难度与错误效果字段，已改用内核实际支持的定义；通用难度解析同时约束到实际内核范围，未放松校验。尚待原生浏览器、最终整仓 CI、作者发现路径配置与 AI 解释/归一化真实候选；压力及后续 owner 仍暂停在真实 `awaiting-owner`，不以本单元代替 P4/P3/P6 或产品完成。

### 35.19 2026-10-14 P4 正式 Oracle 解释候选与明确事实确认（独立候选，尚未集成）

本单元继续跑团 S3 运行能力研发。新增封闭目的 `oracle-interpret`、Skill `prose.ttrpg-open-oracle-interpret` 与正式入口 `ttrpg.open.oracle-interpret`，复用同一 Run、Context Gateway、模型请求账本和一次派发 Harness；既有玩家意图仍限定原有两个来源和玩家视角。新增注册源 `ttrpgOpenGmOracleInput` 只提供真实咨询及其受众可用事实/实体、冻结事实策略与解释边界；输入选择必须完整读取约束和指定 qualified Oracle 两项，不发送 unrelated GM profile、seed、Dice proof 或玩家全量私事。正式输出没有机械/世界写权限。

请求绑定实际咨询、当前世界轮、真人输入窗口、确切模型身份与硬预算。每个 worldTurn 最多预留一次模型 Oracle 解释；失败、取消、未知结果、重开 epoch 和派生分支都不能重新占用该槽位。槽位作为可选字段加入真实调用回执，旧意图回执 JSON 保持原形。运行契约、实际输入工件和回放均校验同一咨询，分支通过冻结祖先证据保留已消费槽位。

响应先保存完整原文及用量回执，再解析为解释和至多三个事实提案的 CreativeArtifact；非法字段、未读取来源/主体、机械 owner、玩家决策与密级扩大进入人工修订，生成中授权变化进入 blocked。候选可不依赖最后 checkpoint 从真实工件与 V3 Manifest 恢复；并发执行器仅一次发送，结果未知不隐式重发。正式入口保持可机器检查的 entryId/category 字面量绑定。

`commitTtrpgOpenOracleCandidateFactV1` 需要真人明确选择一个提案并确认当前候选 hash。真人 GM 模式由主持席确认；AI GM 模式由 Session Zero 的原真人确认者批准，AI 不能自批。正式事务重读当前授权/来源、完整原文、Run/Manifest/候选证明、读取权限和机械基线，再沿相同 F1–F4/事实 owner 写入一条 E5。系统生成 factKey 与来源，账本另保留实际模型请求/原文/候选/所选提案的证明；重复按钮回读同一事实事件，不重复采用。其他提案不会自动采用；状态变化后继续确认会拒绝 stale，需要明确复核。批量采用、独立事实归一 Skill、AI GM 模式下的撤回工作流、作者 Oracle/发现配置、chaos 规则和压力等仍须继续完成。

Oracle 专项11项与既有事实/意图确认闭环29项定向验证通过，后续原文缺失/暂停/未授权反例和整组回归仍在验证。架构、正式 AI 入口、来源可达性门已通过；类型/lint、最终整仓 CI 与新增原生浏览器候选刷新/采用路径必须对应最终冻结快照，尚不能报告通过。现有 Oracle 受众仍是 public/party/gm-only；不以测试擅自新增 private Oracle。工具 schema 版本 `agent-read-tools-v10` 的实际 hash 为 `2eee59474b6f9c4ec0f8c42e1e9cc57dc01d24263f1e7cb6b479361bf30160a5`。本记录不是 P4、公开产品、真实模型或真人跑团验收完成证明。

### 35.20 2026-10-14 P4 事实采用后的模型终态与撤回恢复（独立候选，尚未集成）

上一单元最终跑团/Gateway/版本绑定联合86文件614项回归通过，类型、定向 lint、架构、表与正式 AI 门通过；冻结快照已等待整仓 CI 和11组原生浏览器验证。该快照不含本节新增终态恢复，不能把其未来结果归给本节。

`reconcileTtrpgOpenOracleFactRunV1` 只恢复已经存在的真实 E5：核验唯一事实、原始模型/候选/真人确认、实际事件字节和事件前缀重放状态，再依次保存确认、Instance 采用、步骤成功、终验开始、可回读完整验证工件与终态 hash。终验引用确切 E5 的 qualified 来源和命令，postStateHash 来自实际提交时状态，不用之后可变 head 冒充当时结果。未确认事实不能直接签发成功；已保存采用或回执不能换到其他事实。恢复没有模型调用、规则裁定、世界或事实写入。并发只对实际 journal/artifact CAS 冲突作有界重读，其他失败直接保留证据并返回。

模型事实确认 API 在 E5 成功后调用此恢复入口。若事实已提交而回执未完成，返回明确的 `oracle-fact-committed-receipt-pending` 及真实事件定位；不把已提交事实当成回滚失败。刷新后可恢复缺失回执；同事实重复确认仍回读原 E5，完成 Run 不再追加第二个终态。完整回执工件可校验 hash，并绑定真实原文、候选、Manifest、提交后状态与结构验收项；它不代表外部模型质量或真人跑团验收。

AI GM 模式中，Session Zero 原真人确认者可以明确撤回已经采用的模型事实；真人 GM 模式和普通手动事实保留原权限。撤回只新增 E6，原事实、Oracle 和模型终态证明不删除，恢复终态回执不复活退休事实。模型仍不能自批或撤回。

终态/撤回与旧事实及意图 Harness 联合3文件42项定向测试通过：六处真实写入中断、并发恢复、无 E5 拒绝、回执前中断、原文缺失/权限/暂停和撤回不复活。类型检查通过；定向 lint 的测试换行错误已修复复验。新增原生浏览器断言还需在本增量最终快照运行。批量提案采用/明确处置、独立事实归一、作者 Oracle/发现配置、代价选择、chaos、压力及后续完整主持链仍在施工，产品目标保持完整。

后续复验：包含终态恢复和撤回的跑团、Context Gateway、真实执行版本绑定联合86文件623项通过。当前源码的 TypeScript、定向 lint、架构、128表、正式 AI 入口、来源可达性和原文保留检查通过；这仍不是整仓 CI、原生浏览器或完整产品完成证据。

### 35.21 2026-10-14 P4 完整解释审阅与原子批次（独立候选，尚未集成）

新增 `reviewTtrpgOpenOracleCandidateV1` 与闭集事件 `ttrpg.open.oracle.reviewed`，在同一正式事务完整处置指定解释中的全部提案。每个索引恰好出现一次，采用或带原因弃用；不能漏选、重复、夹带修改后的提案或确认一条后隐式丢弃其他条。系统保存完整解释、原提案、选择/原因、真实 Oracle/模型/原文/Manifest/真人窗口和确认基线。完整选择 hash 与 adoptedFactKeys 由系统按当前真实来源生成。

所有选中事实一次通过共享事实 writer 与 F1–F4 后提交；其中任何条目不合法即整批零写入。每条事实绑定同一真实批次事件，并以提案索引区分稳定身份；同主体/谓词的两个合法多值事实不会碰撞。原 E5 单条字节、旧无审阅 JSON 与事实身份公式保持原形；批次仅为现有 session owner 增加可选审阅日志/证明，没有新表、世界写入、机械改动、知识授予或耗时。替代仍在同事务原子退休，不能绕过其他活动冲突。

全部事实弃用时可以只接受叙述，明确保留每条原因，不伪造空事实账本。拒绝整份解释必须带原因且弃用所有事实；durable Run 保存真实拒绝证明并终结为 failed，不能记作采用或验证完成。接受解释的终验引用真实审阅事件与事件前缀的 post-state，复用可回读完整回执。已完整处置后不能从旧单条 API 采用被弃用提案，也不能换另一组选择重写原确认；重复同选择回读原事件，回执中断仅恢复回执。

回放检查完整集合、候选/选择/原文调用/接收者/密级/来源/原子退休；现行读取验证实际审阅 hash。分支沿 qualified 来源保留原审阅、全部批次事实和原审批，子分支只在新 Session Zero/窗口后明确退休自己的会话视图；备份重映射保留证明，不借新席位扩大旧 party 授予。9项新实际 DB/原子反例/重复/完整拒绝/回放/分支/备份测试通过；旧事实、终态恢复与分支联合40项通过。首轮新增字段曾误入字段名清单，已修复严格解析；重复选择的提示现在在产生事实编号前明确拒绝，没有放松约束。新增原生浏览器完整审阅刷新/回执路径尚待本增量最终验证。

623项与本节之前的冻结快照分开记账；本增量仍需最终整组回归、整仓 CI 和浏览器检查。独立事实归一 Skill、作者配置、代价选择、chaos/压力/局势、AI 主持队友、完整 UI/发布分发和真人/真实模型长局仍继续实施，不以批次闭环代替产品完成。

后续整组复验：跑团、Context Gateway 与真实执行版本绑定87文件632项通过。源码 TypeScript、定向 lint、架构、128表、正式 AI 入口和来源可达性检查通过；原生浏览器与整仓 CI 仍须对应包含本节代码的最终冻结快照。

### 35.22 2026-10-14 P4 独立事实归一、来源及请求权限（独立候选，尚未集成）

新增正式 Skill `prose.ttrpg-open-fact-normalize`、入口 `ttrpg.open.fact-normalize` 与独立执行目的，复用既有唯一请求账本、Run/Context Gateway、raw-before-parse、候选和审阅/终态恢复。原稿 `prose.ttrpg-fact-normalize` 的职责由该现行标识承接；本单元当前接入真实已确认 Oracle 解释，规则/KP 回执的归一接入随其正式 owner 实施，不用未产生的回执作来源。

已接受的原始解释作为注册 GM provider 的独立资源，只在当前授权目的选择时读取。归一必须完整读取三项：冻结规则/事实契约、原始 Oracle、指定已接受解释；拒绝不存在、被拒绝、嵌套归一或未来来源。实际 sourceRef/hash、原始 Oracle 和目的绑定 Run、输入工件、Manifest 与真实回执。原始 Oracle 输入仍只选择原有两项，玩家意图的两个来源权限不扩大。没有新表、世界写回或 provider 配置/密钥持久化。

模型只能输出 `{facts:[]}`，使用受控谓词和实际已读主体/来源，不改解释文本、规则、机械或玩家决定。解释由已确认来源确定性复制到候选，未知/越权输出保留原文进入人工修订。弃用事实按主体/谓词/对象/值的语义槽比较，换文字或 kind 不能复活原来被明确弃用的主张；回放也重验已确认解释和这一约束。输出只成为候选，真人另行完整审阅后才沿相同 F1–F4 采用，归一链及原始审阅分别保留真实来源与终态。

每个 worldTurn 的征兆/事实归一辅助槽最多预留一次，失败、未知结果、刷新、新 epoch 或分支都不清零；征兆模型入口尚未启用，后续必须使用同一槽，不能另造额度。运行时调用新增可选 `supportSlot` 和归一来源，旧调用/候选/审阅/事实 JSON 不加默认字段。实际输入验证同时核对原始 Oracle 与已接受解释，不以客户端手填 hash 作为来源证明。

生成前和正式请求事务还核对真实请求者：人工 GM 模式只有主持席可请求 GM 解释/归一；AI GM 模式由 Session Zero 的原真人确认者授权。玩家意图只能为本人角色或明确绑定的 AI/hybrid 队友请求，不允许读取或代理其他真人私域候选。终态费用记录仍可在暂停后保存，新增权限检查不暗中重发模型。

归一/旧 Oracle 审阅/旧意图 Harness 联合51项通过；请求权限、账本及输入联合30项通过，含人工主持模式普通玩家不能请求 GM 私域、GM 不能代理其他真人意图、辅助槽不重置、未知结果不重发和真实备份链。类型与定向 lint 通过，正式 AI 入口51条/55调用点闭合；新增原生隔离浏览器“确认文本→归一→刷新→另行采用”测试尚待最终冻结快照。整组、整仓、浏览器和外部真人/模型验收分别记录，不能把旧632项快照结果归给本增量。

作者规则/Oracle/知识配置、发现代价选择、chaos、压力/局势、完整 AI 主持队友循环、长局记忆、扩展、媒资、公开 UI 与发布分发仍继续施工，完整产品目标不变。

后续整组复验：包含独立归一和生成前权限检查的跑团、Context Gateway、执行版本绑定88文件643项通过。最终整仓和13组原生浏览器验证仍需匹配本增量的冻结快照，不作为已通过报告。

### 35.23 2026-10-14 P4 知识发现的真人代价选择（独立候选，尚未集成）

- 产品研发 / TTRPG open / S3 团局执行。数据 owner 仍为 ProductRuntimeSession 的 operation 与既有事件；不新增表、不调用模型、不回写 WorldRelease、不改变媒资 owner。入口为 `selectTtrpgOpenDiscoveryEffectV1`，交接物为实际选择事件及单次知识/代价结算。
- 在真实规则结果确定后，仅启用冻结的 cost 与本次失败适用的 fail-forward 模板。各有 alternatives 时分别要求操作行动者的已登记真人批准者明确选择；所有可能受影响的玩家及接收者仍先按冻结计划完成批准。不存在、提前、无关、已选择或错误权限的选择均拒绝，不能默认采用第一个选项。
- `discoveryChoices` 是可选追加字段；旧 operation/继承 JSON 缺少该字段时保持原字节结构。选择通过既有 `ttrpg.open.intent.confirmed` 的封闭 `knowledge-choice` 分支记录，含 template/alternative、冻结计划、riskHash、真人席位与本地来源。每个模板使用确定性命令 key；重复相同请求返回原事件，变更重试拒绝。
- coordinator 返回明确的 `awaiting-choice` 与未选择 templateKeys；选择记录本身不扣费、不授予知识、不消耗世界时间。只有全部适用模板已选择后，知识 owner 以既有效果内核原子结算所选 primitives 与明确接收者的知识；检定不重掷，代价不重复执行。
- 刷新保留真实选择事件。子分支保留祖先选择内容，在新 Session Zero 与受影响角色批准后绑定本地批准来源；未选择的模板仍等待真人。恢复批准同时修复原 AI 接收者被误当成真人自批的缺口：根据冻结祖先控制权核对新的明确真人批准关系，原真人代价不得换为 AI 自批。
- 回归发现继承 operation 可选字段序列化顺序不一致会触发事务状态校验；已统一 parser 与事件追加顺序，保留实际 CAS 校验。四个相关回归文件 50 项通过，覆盖未选择零扣费、两独立模板、失败前进、错误 viewer/risk/key、篡改与重试、暂停、刷新、选前/选后分支、完整事件重放及项目备份。新增原生隔离 IndexedDB 浏览器路径待全量验证队列执行。
- 此单元仅完成知识发现代价的内核路径。公开作者配置/玩家选择 UI、压力/局势/KP/门控后续 owner、真实 provider 与真人长局验收仍未完成；不得把本节或自动测试结果解释为整个 open 产品已完成或已发布。

### 35.24 2026-10-14 P5 压力事件、提前征兆与逐轮依据（独立候选，尚未集成）

- 产品研发 / TTRPG open / S3 团局执行。压力真值仍由 ProductRuntimeSession 的 clocks/fronts 与真实事件派生；可选 pressureCycles/pressureSignals 只保存冻结来源、待办与实际回执，不新增表、不调用模型、不写 WorldRelease 或媒资 owner。旧 scripted 入口继续拒绝 open 内容。
- 决策解释：§26.4 的“Oracle 否定按 cause 消费”指压力触发，不增加第八个混乱触发。§5.9 的七触发继续有效；E4 自身不改 chaos，真实 no/no-but 只经冻结 onOracleNo 驱动 E8，跨越 clock maximum 才产生一次 clock-complete 混乱增长。此解释不改原稿。
- 新规则事件带可选明确 recordChaos 标志，失败档经同一固定混乱函数增长一次；旧事件没有标志时保持原回放状态。新耗时事件带 recordPressureTurn，记录实际每轮条件、tickIndex/worldTurn 与来源；旧事件不补造记录。压力 author-trigger 在多轮中用实际逐轮条件计算能力可用性，不能用最终消失状态回推。修复 ability-available 引用存在性与当前可用性被混为一谈的缺口：冻结能力存在但暂不可用应返回 false，而不是“未知引用”。
- advanceTtrpgOpenPressureV1 与显式 resumeTtrpgOpenPressureV1 只接真实规则、机械/知识及耗时回执。计划冻结全量耗时轮次与尚未消费的实际 Oracle；E8 逐个消费已冻结 tick，仅跨越上限时创建一次后果并改变混乱。相同确定性命令重试返回原事件；不同当前待办、来源或权限拒绝。
- E9 使用冻结作者征兆文本和捕获的接收者。telegraphTtrpgOpenFrontV1 支持在真实主持窗口、行动之前明确发布，真人 GM 或 AI GM 模式 Session Zero 确认者才有权限，禁止回填时间。E10 复用严格顺序/真实阈值/最短提前轮次检查；E12 只在冻结 defeatPredicates 全部满足时执行，单次回落混乱。玩家注册读源只投影已发布征兆文本、受众、时间和来源，不泄露隐藏 front/stage/clock 数据。
- cycles 保留真实 tick/front 来源与明确 effect/situation 后果待办。子分支沿冻结祖先计划接续已提交前缀；当前窗口重新授权，但不重复父 tick、规则或费用。继承 parser 检查真实祖先切点、逐轮记录与 exact plan；项目备份往返后通过实际冻结来源校验继续未完成周期。新字段在提交后规范序列化，事务 CAS 比较未放宽。
- 当前压力命令是显式内核入口。普通 operation coordinator 仍在 pressure 位置显示等待 owner，尚未自动接入：压力效果的真人参数/选项批准、效果提交、局势新实例/击败清理 owner 仍待完成；有这些待办时返回 awaiting-consequence，不得空过或宣称完成。阶段收束触发/作者编辑/玩家 UI、AI KP/队友、完整门控及长局验收亦未完成。该边界是施工状态，不是缩减产品目标。
- 专项验证覆盖逐轮 idle/真实失败/真实否定 Oracle、真正提前征兆、升级与击败、上限完成一次、待办阻断、精确重试、篡改拒绝、逐轮能力状态、旧事件兼容、刷新、祖先切点与真实导入恢复。新增原生隔离 IndexedDB 浏览器路径待全量 CI/E2E；实际最新测试与队列证据记录于开发检查点，不把之前快照的通过结果归给本次代码。原稿与既有决策保留。

### 35.25 2026-10-14 P5 压力后果的真人审批、支付与恢复（独立候选，尚未集成）

- 延续 §35.24 的 TTRPG open / 产品研发 / S3 运行边界。新增两个封闭事件 `ttrpg.open.pressure.effect.confirmed` / `ttrpg.open.pressure.effect.applied`，仍在既有 RuntimeSession/event owner 内派生；不新增表、不调用模型、不写世界或媒资。旧 pressure work 没有 effectReviews 时保持原 JSON 形状。
- 主持人先用只读 prepare 确认当前冻结模板、明确选项、全部参数槽、实际状态与授权，propose 以风险 hash 冻结修订，并明确提交 GM 批准。受影响者根据所选实际 effects 分别确认：真人角色由其 claimed 席位批准，AI 角色按 Session Zero 真实真人批准关系确认；GM 同意不替代真人角色对自身代价的同意，也不允许 AI 自批。确认命令只引用修订/风险，不要求普通玩家读取主持人全部输入。
- `readTtrpgOpenPressureEffectApprovalViewV1` 只给有权确认的席位返回自身或明确授权角色的具体 effects、修订、风险和可确认状态；不返回 GM mechanicalStateJson、完整绑定或其他角色效果。准备完整提案只允许真人 GM 或 AI GM 模式 Session Zero 确认者。所有正式命令仍校验实际参与者、当前 epoch、不可变运行源和首个未完成工作项。
- 每个修订保留 actual requiredApprovals、实际人/席位/viewer/事件来源及 approve/reject。拒绝不支付、不删除历史。授权窗口、分支或受治理状态改变后必须显式新修订并重新批准，旧修订标 stale；不得把父分支批准自动当成新授权。当前仍可执行的提案不能被另一个选项静默替换。
- 全部真人批准后，显式 pressure coordinator 使用既有效果内核提交已选择 primitives。内核需要本地事件来源，故使用本分支实际最终真人确认事件作为 EffectPlan sourceEventId；原 clock/front 触发仍通过 qualified work.causeRef 保留，二者不混为同一个来源。plan/idempotency 使用唯一确定性正式命令 key，真实完成事件才写 work.completedRef；恢复不重付或重放原 tick。
- 专项测试暴露现有 resource.spend 的截断语义：资源不足时内核会夹到零。保持旧产品内核行为，在压力 owner 校验实际 before/after 收据必须支付完整绝对金额；不足时整个正式事务拒绝，不写部分 effects 或完成回执。已批准但无法支付的方案可由真人显式重选新修订，系统按实际支付验证将旧修订标 unpayable；不伪造人为拒绝或恢复成功。
- 当前机械/条件/库存等受支持效果可真实结算；知识和尚未接入的 story owner 不允许从压力效果直接代写。局势激活、击败清理、阶段收束与主 operation coordinator 接入仍待完成，不把压力完成当成整个 operation/product 完成。
- 全量 CI 前一份冻结代码出现 11 个失败：3 项正式入口测试仍断言旧 48/52 数量，已按真实新增三入口修订为 51/55，并明确验证唯一 Harness、候选类型及禁止模型自采纳。其余失败所在的文字游戏/生产路径进行了隔离定向重查：24 项通过、161 项未运行；未修改这些产品实现，也未以重查结果代替全量 CI。后续全量 CI/E2E 针对本次新冻结输入重验。
- 新原生隔离 IndexedDB 路径覆盖明确选项 → 刷新 → 真人自身效果视图/批准 → 再刷新 → 单次支付和真实回执；它不代表公开 UI、真实 provider、真人长局或产品发布验收。原稿与旧决策保留，最新检查与源码指纹写入开发检查点。

### 35.26 2026-10-14 P6a 威胁后果到局势实例与终态（独立候选，尚未集成）

- 延续 TTRPG open / 产品研发 / S3 执行边界。新增闭集事件 `ttrpg.open.pressure.situation.completed`，依旧由既有 RuntimeSession/event owner 保存；压力 work 可选 situationAction 区分 activate 与 resolve-front-defeated，后者明确 situationKey/frontKey，不靠 workKey 文本猜对象。新威胁事件带明确记录标志，旧事件无标志时不改变原回放形状。
- 激活必须引用真实 E10 后果与冻结模板。复用 I1–I7、当前受影响角色投影、容量和冷却：通过时创建内核生成的本局势身份；相同模板已有 active/queued 时引用实际既有实例，不清空原进度或知识；只有容量或冷却阻挡时进入真实 FIFO 队列，不伪造第六个 active。其他门不通过时保留待办并拒绝事务，不丢弃后果或虚构实例。
- I2 的逐角色理由投影使用实际公开征兆记录及捕获接收者，也尊重旧 party 事实的 knownBy；隐藏时钟和 GM-only 事实不作为玩家可解析理由。I1 的真实谓词状态不变，不能只把所有私密内容删掉来取得通过。
- E12 清理仅接实际已击败 front，核对精确实例及冻结 driver；active 和 queued 均纳入有类型的清理待办。实例终态追加到可选 situations.history，保留来源、原 whyNow/发现/障碍、处置序号及 resolutionKind，进入真实冷却；角色 knowledge 不删除。front-defeated 的 E11 不重复回落 chaos，E12 已完成该变化。历史切点与备份维持 qualified 原处置证据。
- 显式 pressure coordinator 现在可以消费局势待办并记录真实完成来源，再继续压力回执。前一版笼统旧 changeTtrpgSituationV1 收口为真实开始授权下、零轮次/无操作/非分支的冻结 opening 清单初始化；前兆升级和后果不能再从旧入口伪造。新开局事件附冻结 admission 与真实当前角色权限，reducer 重验门与队列；老事件没有 admission 时原回放仍保留。
- 定向路径包括实际升级激活、公开征兆支持 I2/隐藏时钟不泄漏、重复实例、五个 active 后排队、未满足 I1 拒绝、真正 front 击败、知识持续、无重复混乱/耗时、错误 viewer/篡改结果、未完成/已完成分支及实际备份往返。新增原生隔离 IndexedDB 激活/清理刷新路径待完整 CI/E2E；当前专项与相关回归通过结果写入开发检查点。
- 此单元完成压力待办与局势的衔接。日常局势 progressed/resolved/expired、无介入时钟与后果链、真正队列续启、阶段与四门、主 operation coordinator 的完整接入，以及 per-turn 后果插入、AI KP/队友和公开 UI/长局验收仍待后续单元；不以一次压力回执代替全部运行阶段完成。原稿与此前决策保留。

本轮扩大回归发现并修复既有请求账本的竞争读取问题：同一已准备请求的另一个执行者取得唯一派发权时，读取头可能变化。现在使用明确的 read-conflict 类型；只有同一个确定性派发命令已经真实提交且 type/base/intent 完全一致，才回读原事件并返回 sendAuthorized=false。无真实同命令回执时仍拒绝，不重调模型、不重派命令、不放宽 stale/权限检查。可控并发正例与无回执反例均走真实 IndexedDB 事件，避免仅依赖偶发竞态。


### 35.27 P6a 候选施工进展：实际局势维护、后果与 FIFO 恢复（2026-10-15）

本节追加现行候选实现及边界，保留原方案、既有决策与历史条目。产品为跑团 open；生命周期为产品研发，运行数据处于 S3 产品执行。冻结 ProductRelease / WorldReference 只读；局势、知识、后果和运行事件由团局拥有，不写回世界或作者源。交接物是正式事件、可恢复周期及其真实回执，复用既有 runtime 表和 PROJECT_TABLES 生命周期；本增量无新 AI 调用、AI 可写字段或媒资。

- 威胁派生局势遇 I1–I5 拒绝时，新命令保存真实拒绝原因与处置回执，不创建实例，不让已裁决的待办永久阻塞。旧事件没有 `recordRejection` 时保留原拒绝行为；同模板 active/queued 返回现有实例。
- `open-situation-cycle.ts` / reducer / coordinator 冻结该次真实裁定、内容、来源和 active 清单，逐项重算障碍 predicate；不接受模型或调用者宣称“已完成”。真实介入与到期保存原实例的终态、已发现证据、全局知识及三轮冷却。只有 `intervened` 回落 chaos；到期不凭空增加 chaos，front-defeated 仍由 E12 计一次。
- 到期后 `advancesClockKeys` 每项生成一次明确的 `situation-outcome` 待办，每个引用推进 1 格，达到 maximum 后不再推进。跨满格才改变 chaos 并追加该时钟的真实 onComplete 效果；这是当前数组缺少 delta 字段时的确定性施工口径，未来可通过版本化契约扩展。该推进不额外支付世界时间。
- 局势后果复用已有冻结 EffectPlan、参数与选项校验、真人 GM/受影响角色批准、精确资源支付和效果账本。保存的周期属于局势，不伪造压力周期；批准状态变化、旧分支批准或支付不足均不得自动完成。正式结束先保留待执行后果；需要批准时只返回待办，不能写假的完成回执。
- `consequences[].nextSituationTemplateKey` 必须在相应前序效果完成后通过实际 I1–I7 才准入；同模板去重、容量/冷却排队、条件拒绝均留真实结果。新实例不加入本次已冻结维护清单，避免同轮立即被再次维护。
- 每个实际释放名额最多让一个 FIFO 保留项成功入场。I1–I4 拒绝并记录原因；I5 去重；I6/I7 保留原位。候选运行态保留带身份的 queued reservation 以兼容既有事件，但排队项不是活跃局势、不会到期。冷却保留后，后续真实维护窗口按当前空位重试，不要求凭空再结束一个实例；每个空位也最多激活一个。真正入场时重置 `activatedAtSequence`、`activatedAtWorldTurn` 和期限，保留身份用于追踪。§5.8 原 template-only 队列记述继续保留为设计历史，以本节实现适配口径裁决当前候选。
- 所有动作显式触发；读状态、刷新页面不会执行命令。周期绑定原始真实规则因果，子分支续作保留已提交维护/时钟/效果前缀，尚未执行的效果必须取得本分支新批准。备份由既有运行态/事件生命周期保存，不新增私有表清单。

验证材料包括实际 API + 隔离 IndexedDB 的维护、到期、FIFO、拒绝、真实代价/后续局势和分支切点回归，以及 `ttrpg-open-situation-maintenance.spec.ts` 原生浏览器恢复用例。测试以实际通过回执为准，新增用例存在不等于已执行。全工程 CI、浏览器批次、真实模型、作者完整操作和真人长局验收分别记录。当前仍未交付完整 open 产品：通用主操作协调器、逐耗时轮次的压力/后果交错、终态/阶段/Gates/叙述/交棒、AI KP/队友完整流程及 P7–P10 仍需后续施工；不得将本节当作整产品完成证明。


### 35.28 候选施工进展：真实终态、各真人四门与显式阶段收束（2026-10-15）

产品/生命周期/owner 仍按 §35.27：跑团产品研发，运行数据处于 S3、团局所有；只读不可变发布内容，不写回世界/作者作品，不新增表、AI 调用或 AI 可写字段。此增量把 §29 的结构校验接入实际 owner，P3 合作切片与 P6b 真人/真实模型联合验收继续保留为未完成。

1. 正式 `ttrpg.open.terminal.evaluated` 绑定本操作真实原始裁定、冻结内容与来源、当前世界时间/阶段/安全状态，区分可行动、可收束、最大轮次暂停、安全暂停和已关闭。只记录分类，不宣布剧情结局。恢复与分支引用原已提交判定，不伪造重新计算的过去。
2. 新生成 RulePlan 的可选 `stageTimeLimit` 冻结真实阶段起点与作者最大世界轮次；已达上限或整个已知耗时会跨上限时，在新计划/操作/耗时业务前拒绝，不先扣效果再截断。旧计划无该字段时不补写/重算历史。字段随原计划哈希与恢复契约保存，未改变旧 scripted。
3. `ttrpg.open.gates.evaluated` 对实际已确认并已认领的各真人席位分别检查 G1–G4。G1 不借他人 private 出口；G2 只把实际 observed 知识当作客观前驱覆盖，GM-only/他人 private/传闻不因全局实例发现数组而变为本人知识。G3 使用实际已投放且该接收者可见的征兆和 lead；G4 使用当前生效事实。结果保存 viewer/actor/epoch/stage/依据、适用性、证据和连续失败；旧纯门辅助函数的 actor 标签在 durable adapter 中转换为真实 viewer。没有实际状态变化不重复累计失败，不让空回执翻绿。
4. Gate join 只接受本窗口当前依据且全部真实真人投影通过的评估；失败返回显式待恢复。正式恢复命令仍须按 §29.2 执行，不以提示文字或改布尔值代替；本增量不宣称有界恢复已全部实现。可合法收束/最大轮次时先提供显式阶段收束，避免空 active 误判死锁。阶段真正关闭后四门为 not-applicable/passed=null，保留诊断而不冒充 passed。
5. `closeTtrpgOpenStageV1` 接入已登记 E13，只允许当前真人 GM 或 AI-GM 的真实 Session Zero 人类 owner 明确确认；摘要作为 GM-only 人工阶段记录保存，不自动公开，也不当作模型叙述/记忆候选。阶段/chaos 仅改变一次。时钟的冻结 `autoAdvance.onStageClose` 由独立 `stage.clock.advanced` 事件结算；跨满格才改变 chaos 并添加实际 onComplete 效果，已满不重复奖励，不额外耗时。
6. 阶段完成效果复用同一参数/选项/真实受影响者批准/精确支付/账本内核，保存在实际 stageClosures owner，不伪造压力或局势周期。尚有时钟/效果时不得结束阶段结算或 Gate join。当前分支新批准与旧修订记录并存。已关闭的子分支仅能在新 Session Zero 和 continue-host 授权后续作冻结的 terminal/gates/narration/handoff 后缀，不重新开放规则/耗时/模型预留与发送；未来 KP 关闭叙述须另有明确只读目的合同。收束起源与祖先时钟/效果来源按实际封存记录验证。

验证路径为真实 API、隔离 IndexedDB、父子切点/备份/回放、参数反例；新增原生浏览器 `ttrpg-open-runtime-checks.spec.ts` 检查刷新后的真实分类、私密出口拒绝和独立阶段时钟/N/A。以实际测试/CI/浏览器回执判断完成，不以用例存在判断通过。尚未接入通用 operation 主协调器、逐耗时轮次的压力/后果交错、G1/G2 有界恢复、KP 叙述和交棒，也未开放 public open 或宣称完整产品/真人模型验收。


### 35.29 候选施工进展：独立 AI 队友、实际结算后的 KP 与有限交接（2026-10-15）

产品为跑团 open，生命周期为产品研发；实现作用于 S3 团局。冻结世界/发布内容只读，规则、知识、叙述、请求和回执归原有 session/run 表；没有新表、世界回写或新作者字段。保留本文件全部原内容和决策记录。此节是独立候选进展，尚未集成到 PR 当前提交，也不是公开 open、真实 provider 或真人试玩验收。

- 正式入口增加 `ttrpg.open.companion` 与 `ttrpg.open.kp`，复用唯一 Harness、原文优先持久化、真实派发许可、费用未知保留 null、Context Manifest 与 CreativeArtifact。队友使用自己的目标、秘密与观察，不复制真人 epoch 私密输入，也不接收其他角色秘密；同角色同 epoch 只提议一次，未知结果/拒绝仍停下。
- KP 只能接在实际规则、压力、局势、终态和各真人四门结算之后。独立登记的 `ttrpgOpenKpInput` 只包含当前接收者投影的共同可见交集和真实公开结果；GM Oracle 真相及私人意图不进入此输入。每段必须引用实际交付来源 key；当前仅处理叙述，不允许通过 prose 创建事实、资源、知识或时间。来源引用是结构证据，仍须真人检查表达的语义准确性。
- 叙述候选显式确认后，实际事件与独立 durable Run 采用、post-state、终态回执相连。候选可在刷新后回读；已提交但回执未完成会明确报告并允许补齐回执，不能重发模型或重写团局叙述。
- Session Zero 队友预授权保存其原真人授权来源，明确区别于逐次真人批准。当前自动范围保守限定为 AI 控制、同意、冻结策略允许、无资源消耗/规则效果/模板后果/他人影响的现有行动；hybrid、代价、不可逆或风险不清均继续走实际真人确认。该范围尚未覆盖全部低风险通用检定。
- `resumeTtrpgOpenPlayV1` 串联真实规则结算、压力、局势、终态/四门、叙述与 handoff；选择、后果批准、阶段收束、质量门恢复和 KP 生成/确认都返回明确待办。旧 foundation helper 的有限语义保留，不冒充完整入口。handoff 仅提出下一可行动 AI；不发送模型、不代替真人/hybrid、不重开 epoch、不推进世界时间。保留至少队友提议和 KP 两次请求额度；未知请求、安全暂停、阶段关闭、分支恢复或预算不足即交回控制。
- Context Gateway 工具新增来源，实际冻结工具 schema 更新为 `agent-read-tools-v11`，hash 为 `86389db42475a48c9f287d526ae8dedc4162ee44074e42051b59983690ffcef5`；此前的 v10 证据原样保留，旧工具绑定不得当作当前输入。正式注册表当前为 53 bindings / 57 calls，formal 30。

验证已包含独立角色来源/私密反例、候选原文、重复确认、无代价预授权与有代价拒绝，以及隔离 IndexedDB 中同一原始 epoch 内真人行动加两名 AI 的真实规则/知识/压力/局势/门/KP/交接与全事件回放。连续切片使用确定性模拟 provider，不能冒充真实模型或玩家体验；首次运行约 59 秒，尚不作为性能达标证据。新增原生浏览器用例覆盖 KP 候选刷新回读/采用/重复恢复，是否通过以最终冻结快照回执为准。当前直接检查与最终整仓 CI、浏览器验证分别记录，不以新增用例或先前快照的通过替代当前验证。

仍需完成：玩家可用的 open 桌面与主入口收口、有限委托下的持续主持交互、逐耗时轮次压力/后果交错、G1/G2 有界恢复、长局记忆/扩展/运行媒资、生产到游玩全路径、真实模型与真人联合验收。自动 KP 当前还需要显式候选确认；预算耗尽后的人工叙述/恢复路径也不能省略。public open 继续默认隐藏。

本单元当次证据：4 个定向文件 25 项全部通过；另增 KP 叙述分支与项目备份往返 1 项独立通过（子分支没有继承模型请求权）。架构、表生命周期、AI 手册/入口、来源可达性、文档/路线图/指标、Agent 上下文/新鲜度、TypeScript、全仓 lint 和 diff 共 13 项直接检查通过。完整 CI、构建及新增原生浏览器仍待最终冻结快照串行回执，不能据此提交或报告产品完成。


### 35.30 候选施工进展：开放跑团玩家桌面、身份与拒绝恢复（2026-10-15）

产品/生命周期仍为跑团产品研发，界面操作 S3 团局。世界/发布内容只读；角色同意、行动、拒绝、知识、叙述、安全暂停与回执分别沿现有 participants / session events / durable Run owner 保存，无新表或作者字段。原方案和所有历史条目继续保留。本节只说明开发预览增量，不开放 public open，不替代完整合作、真实模型、长局或真人验收。

- 旧 `TtrpgPlayTable` 按已存运行格式分派：scripted 保持原播放器；open 不能送入 scripted loader/KP。新 `TtrpgOpenPlayTable` 仅在显式开发预览开关 `VITE_ENABLE_TTRPG_OPEN_PREVIEW=1` 下显示，默认仍返回尚未开放提示；正常公开 open 入口/作品发布门没有开放。
- 桌面通过 `open-table-service` 核对实际 scope、不可变来源、当前 Session Zero/席位及读取 head；身份确认前只显示公共开团信息和席位名称。真人亲自认领及确认同意，开团展示冻结 checklist/lines/veils/暂停信号；不替其他真人确认，不改变冻结控制权。开局使用稳定命令及实际 I1–I7，由内核决定 active/queued；刷新/重复开始不重复激活开局。
- 玩家可查看自己的角色/秘密、真正已获知的线索和可见介入方向、共同或明确授予自己的叙述及征兆。换人同步清空私密界面和输入；刷新重新要求身份确认。拒绝 AI 角色建议不妨碍真人读取本人角色；共同 KP 叙述另取经本桌主持授权的共同投影，排除 self/profile/背包/角色卡，不能借此给角色 AI 私域读取权限。去掉此前临时候选视图中重复的 `self.profile` 别名，保留既有唯一 `self.playerProfile`；旧 Run 输入工件不改写，旧准备输入继续由 stale 检查裁决。
- 正常预览界面已连接持久候选回读、明确意图确认、冻结风险/代价确认、已授权队友范围检查、真实 owner 链恢复、KP 叙述生成/确认、下一队友提议、本人明确结束主持窗口、保存与安全暂停/恢复。不会通过渲染或刷新调用模型、重开 epoch 或执行行动。首次模型调用费用上限由玩家明确填写，未知实际费用不伪称已知账单。
- 放弃尚未进入规则行动的意图以新正式事件 `ttrpg.open.intent.rejected` 原子绑定当前真人、原请求、候选 hash 和真实终态证据，写入原调用的可选拒绝来源。之后不得再采用；不回退请求次数、费用、已保存原文或世界时间。durable 人工拒绝与终态回执可有界恢复，界面显示未补齐的回执并提供恢复按钮。已进入规则确认的操作走原拒绝/撤销契约，不能倒退成未采用候选。新字段缺省不影响旧状态，调用原身份/hash 不被拒绝标记重写。
- UI 风险说明目前覆盖既有无模板行动及其固定资源消耗/可能数值变化；存在模板后果、通用检定代价或有限次数等详细审查需要时暂不开放粗略批准。完整后果/选项/绑定、阶段收束与 G1/G2 修复表单、人工 KP/预算耗尽恢复和连续自动主持交互仍待补齐，不能据此宣称完整玩家产品。

当次证据：身份/显示权限、开团/幂等/回放、拒绝合法/无效候选、拒绝回执中断恢复有实际隔离 DB 回归；共享工具 hash 也需随当前检查。新增 `ttrpg-open-player-table.spec.ts` 在显式预览开关、隔离原生 Chrome 中实际点击身份→意图确认→风险确认→结算→KP 候选确认→交接，验证暂停/恢复、换人清空，以及另一角色秘密/真人私密输入不出现；桌面与移动截图已实看修正配色。此流程的模型输出为确定性 fixture，尚非真实 provider 或真人试玩。完整工程门与最终冻结 CI/构建/旧播放器回归分别记录；未通过的项不因用例存在而视为通过。


本单元工程复查发现并保留了真实失败：最初跑团 runtime chunk 约 2291 KiB，超过原有 600 KiB / gzip 180 KiB 标准。原因包含纯运行解析器经 KP 身份/叙述解析导入了实际候选读取与 AI 上下文链。已把纯 binding / narration schema 独立，模型目的的实际上下文读取改为按需加载；再按真实静态依赖方向把 leaf state、open state 强连通分量与事件 adapters 分组，避免先前试拆时的循环 chunk。没有提高或豁免任何预算，所有 chunk 继续走原检查器。新增回归沿实际静态 import/export 闭包检查：回放不得加载候选/模型/生产读取器，全部纯模块必须归组且不能反向依赖。最终构建、浏览器模块加载与完整 CI 以最终快照证据为准。

本单元最终当次证据：相关 9 文件 43 项全部通过；13 项直接检查、完整本地 build、原体积预算通过。拆分后的规则包约 state 467 KiB、open 114 KiB、adapters 124 KiB（以构建文件实际字节为准），未产生循环 chunk 提示；真实 Chrome 对实际生产构建包正反两种顺序加载均无初始化异常，该探针仅证明模块加载，不冒充生产 UI 全路径。拆包后隔离 Chrome 玩家桌面完整定向用例再次通过，含手机尺寸、安全暂停/恢复和换人清空。完整整仓 CI 与其余原生旧路径仍待最终冻结快照串行回执，尚未提交/合入主干或完成产品验收。


### 35.31 候选施工进展：人工叙述、原请求取消与回执恢复（2026-10-15）

边界仍为跑团 open 产品研发，S3 团局 owner。世界与发布版本只读；复用原 `narrations` 单一账本和原 Agent/runtime 表，不增加表、AI 写回字段、Skill 或上下文来源。人工补写是当前真人主持的明确操作，不冒充模型候选、输入 manifest 或生成证据。旧模型叙述 JSON 形状不变，scripted 不自动转为 open。

- `narrations` 增加闭集的 human 分支：`sourceKind='human'`，绑定真实规则来源、当前操作/计划、接收者、原 Session Zero、补写原因、公开可见结果和已支付时间。只引用实际 `action.receipt`，不写机械、事实、知识、World 或作者源。真人 GM，或 AI GM 桌中真正完成 Session Zero 的真人可补写；该权限独立于对 AI 私域读取的同意。非主持玩家不能冒充，读取/输出只走本人投影和真实接收者。
- 原 owner 链、质量检查和授权窗口仍须完成，才能补写一次叙述；人工与模型采用竞争只有一份正式结果。已经提交的叙述不能再次生成、采用或改写。公开结算沿既有结果一致性检查器阻止明确颠倒成败/抹除代价；这不是完整语义正确性证明。隐藏裁定不通过错误信息向无权玩家泄露结果。
- 人工补写不清零原调用、预留额度、未知状态、原始响应或费用。未知调用后的交接仍返回 model-recovery；真人可以明确停止已闭合业务的窗口，原未知记录继续保留，而不是隐藏重发同一叙述。仍有 prepared/dispatched 请求时禁止并行替换。真正尚未派发的请求可显式取消：实际 call.finished、零用量、计数槽仍保留、Run 取消终态都留证；已派发/未知结果不能伪装成取消零费用。
- 替换已保存但不可用的 KP 候选后，原模型 Run 保存人工事件关联证据、实际拒绝及失败终态；未知或已停止 Run 保留原终态。回执写入中断时先保留已提交人工叙述，明确报 pending 并提供有界恢复，不重写正文/不重发模型。桌面同时提供原 KP 采用、人工替换和未发送请求取消的停止/采用回执补齐。
- 预览界面增加明确人工稿、补写原因、原请求取消、来源标注和未知状态说明；新 AI 请求在额度为零或该叙述已保存时不开放。确定性后缀结算可继续，不借此调用模型。模型预算字段已改为“预算预留”，不声称未知费用是零，也不冒称能限制供应方账单。

当次验证包含真实隔离 DB 事件/回放、不改变原机械与世界时间、请求未知保留、prepared 取消、无效候选替换、回执中断/恢复、人工/模型并发单赢家、主持权限，以及分支/项目备份保留 human 来源且不带入活跃模型权限。新增原生 `ttrpg-open-human-narration.spec.ts` 实际点击预算耗尽/无效模型结果→人工稿→后缀交接→刷新回读；使用确定性模拟 provider，不能替代真实模型/真人验收。复杂后果和绑定/选项、阶段收束与 G1/G2 修复 UI、正式连续委托、长局/媒资与全路径联合验收仍未完成。公共 open 默认继续隐藏，最终 CI/构建/回归分别记证，不以新增用例视为通过。

### 35.32 候选施工进展：具体风险、代价选择与当前角色状态（2026-10-15）

开工卡：跑团 open 产品能力研发，S3 玩家运行桌面；输入为既有冻结 ProductRelease、Session Zero、operation/plan/risk 与本人角色投影，输出为真人审阅和既有确认事件。状态仍归跑团 runtime/event 所有，候选与模型证据仍归现有 Harness；世界只读，媒资 owner 不变。本单元不增加模型入口、上下文源、可采纳字段或表，不改 schema、原模型协议和 scripted。

- `open-table-risk.ts` 只供真人桌面使用，从实际冻结计划投影行动资源与能力消耗、伤害骰/修正、状态、已绑定后果对象、具体数值和全部可选后果；不把完整规则计划或主持资料传给界面。替代项沿既有结算语义执行一项，不叠加模板基础项；知识发现代价按真实发现策略标注触发条件，不把代价模板自身的 degree 误当成触发条件。
- 风险可完整展示时开放真人确认；受影响真人仍各自确认，AI 队友只保留原 Session Zero 批准关系，不能用行动发起者替代另一个真人。未公开对象、GM-only 模板和暂未完整展示的效果族继续明确阻止盲目批准；当前完整展示覆盖 numeric/condition、无额外时钟绑定的 ability 和可识别 item，story/social/knowledge/advancement 的专门审阅仍待补齐。拒绝路径保持可用。
- 行动与发现后果选择接入原 `ttrpg.open.intent.confirmed` 的 effect-choice / knowledge-choice。只显示当前步骤真实适用的冻结选项，由确有批准权的真人选择。服务和正式命令同时核验原 plan/risk、模板、选项、身份和当前状态；同一已保存选择可幂等重试，改变选择拒绝。选择事件不支付、不推进世界时间，原 owner 继续结算后才应用一次。
- 保密骰点不通过结果依赖的选项可用性暴露给玩家；此时明确提示交给主持人，尚未声称完成该主持审阅界面。未公开模板的原因、参数内容和选项文案不进入玩家风险投影。可见性检查和原始来源约束仍由系统承担，文案不作为绝对语义保密证明。
- “我的当前状态”读取本人实时资源、状态持续轮次、能力次数/冷却、物品数量/充能/耐久；不以冻结初始角色卡冒充当前值。未辨识物品不在界面暴露定义名称，零数量不当作持有物品。身份切换仍清空原玩家私密内容。

本单元新增隔离 DB 回归覆盖费用/参数/全选项预览零支付、实际选择与重试/换选拒绝、错误 viewer/risk/选项、独立受影响真人确认、保密骰点的选项边界、刷新/事件回放与实时资源。原生 `ttrpg-open-table-risk.spec.ts` 使用公开裁定和显式失败前进策略，实际点击风险批准→代价选择→继续结算→刷新，验证准确扣账/知识写入且没有模型调用；它是工程 fixture，不是正常作者生产或真实模型/玩家验收。同期既有玩家桌面与人工叙述原生路径通过。后续阶段收束、压力/局势后果参数编辑、G1/G2 修复、保密主持审阅、正式连续委托及 P7–P10 仍待完成；公共 open 入口继续默认隐藏。最终冻结快照 CI、工程门和原生回归分别留证，尚未据此更新产品完成门。


### 35.33 候选施工进展：主持后果审查与明确阶段收束（2026-10-15）

开工卡：跑团 open 产品能力研发、S3 运行桌面；输入为冻结 ProductRelease、真实 operation/rule/cycle/work 和 Session Zero 权限，输出沿既有 pressure/situations/stage 确认事件与原 owner 结算。只扩展真人读视图和交互，不新增 AI 入口、上下文源、Field、表或 schema，不回写 World，不改变媒资 owner 或 scripted。

- 新增主持审查面板，复用三个已有后果 owner 的 prepare/propose/confirm；不另建后果状态机或支付入口。依据当前真实规则来源、步骤和首个未完成工作项定位，按冻结参数范围和活动实体枚举可选对象；参数和替代方案不默认选择第一项。
- 普通玩家读取不包含主持原因、全量绑定、机械快照或私密阶段记录。实际主持人明确确认身份职责并点击进入后才读取私密视图；关闭、换人或实际进度序号变化立即清空私密面板和预检稿。预检只显示具体后果及仍需确认的角色，不写业务、不支付；实际头改变时必须重新预检。
- “确认主持裁定并提交相关玩家”仅写真实 GM 批准；每个受影响真人另行确认自己的具体后果。AI 玩家仍按原 Session Zero 批准绑定；hybrid 的真人席位不能由发起者代批。批准与拒绝均引用真实修订/risk；拒绝、stale 或不可支付后的后续修订保留旧记录。正式支付和后续推进继续由原协调器执行，不在界面中直接扣账。
- 确认命令沿同一确定性 key 幂等；已结算后的同一批准可重读原事件，改变决定不覆盖历史。服务重新校验 owner 闭集、作用域、当前权限和可信命令封套；外部额外字段不能覆盖系统生成的计划或命令身份。
- 到达实际 gates 步骤后，主持可显式读取收束条件、填写仅主持可见的阶段记录并确认收束。原 E13 保存 summary 的 gm-only 属性；时钟、完成效果和 N/A 门仍各自留真实回执，不额外推进 worldTurn。尚未满足条件不能强行收束，重试不能修改既存总结。
- 阶段关闭后保留完成剩余后果/叙述和保存进度入口，阻止新意图/队友建议消耗请求额度；KP 可以完成本次已结算叙述。这里没有伪造下一阶段开始或自动续团。人工 GM 的真实权限已接通服务级审查路径；当前玩家桌面的可见主持入口服务于 AI GM 桌的实际 Session Zero 真人，独立 GM 席位的完整界面仍待补齐。
- 原冻结风险展示和新后果面板共用同一个具体效果格式器。未辨识物品在玩家后果中保持未辨识称谓；主持才可见其定义名称。尚不能完整呈现给该玩家的效果继续明确阻止盲目批准；特定 social/advancement 与隐藏结果的完整知情审查仍待补齐，不以主持预览代替当事人同意。

当前新增隔离 DB 回归验证真实压力支付、局势 owner、阶段收束/时钟后果、独立真人批准/拒绝及新修订、人工 GM 权限、同一批准重试/换决定拒绝、刷新与全事件回放。最初的测试准备曾让“阶段完成效果”在压力阶段先触发，已改成真实阶段 tick 才达满；多人准备也改为不替另一个真人批准前置发现。工作流用例沿既有长流程规范采用 30 秒测试上限，断言未放松。

新增原生浏览器两条实际 UI 路径（显式进入主持审查→参数/方案→预检→提交→个人同意→扣账/刷新；合法收束→私密总结→剩余结算/刷新）通过，并与既有人工叙述、玩家桌面和风险选择合计 5 条通过；截图已实际检查。全部属于隔离工程 fixture，没有真实 provider 或真人试玩。最终检查/构建和冻结 CI 单独留证，公共 open 入口保持默认隐藏；G1/G2 修复、保密裁定的主持/玩家交接、正式连续委托、独立 GM 桌面及后续长局/记忆/扩展/媒资继续施工。


### 35.34 候选施工进展：真实有界修复、停止授权与知识来源闭包（2026-10-15）

开工卡：跑团 open 产品研发、S3 运行。使用实际冻结来源、operation、当前真人评估及其 basis/sourceRef；修复只走局势与知识 owner，停止只撤销本轮运行授权。新增可选 `openRun.gateRecoveries` 及两个正式事件 `ttrpg.open.gates.recovered` / `ttrpg.open.gates.recovery-stopped`；没有新表/schema、AI 字段或模型调用，不改 World/媒资 owner。缺少新字段的旧 open JSON 保持原结构，scripted 路由不扩展。

- 按真实原 epoch 发起人的失败条件优先，再按稳定角色身份与四门顺序选定本次处理对象；不依赖席位插入顺序。修复请求绑定原评估 sourceRef、basis hash、角色和门，状态改变必须重读；同一操作窗口只有一次局部尝试，不借重试、另一个真人或新的 commandId 追加机会。
- G1 仅尝试实际 FIFO 首项，复用从正常维护中抽出的唯一队列准入 owner；容量、冷却、重复、当前前提、来源和拒绝定位继续生效。不跳过首项、不创造空位，也不把仍 queued 的模板说成 active。正常局势维护沿同一 owner，实际截止时间只从真正激活开始。
- G2 只从当前真实 active 局势选一条尚未观察、非必需、允许失败前进、满足当前前提且接收者被原策略允许的冻结 evidence。由需要该线索的真人亲自请求，主持不能代作其知情确认；没有合法候选就保留无可用修复，不造万能线索。G3/G4 不靠伪造征兆或事实转绿，缺少本地修复时同样保留失败。
- 追加契约解释：仅此主动修复路径把原允许范围内的 evidence 收窄交付给当次请求者，记录为 private、单个实际 actor、observed；保留相同公开字段、source facts/resources 与真实 acquisitionRef/hash。不会自动扩散至其他真人或 AI，也不改变普通 discovery 的冻结受众语义。普通分享仍须实际来源和确认，只形成 hearsay，不让他人 G2 冒充客观通过。主动修复不运行原失败前进效果模板，不扣玩家资源、不加治疗或物品、不推进 worldTurn；剧情行动已确认的正常代价仍由原路径结算。
- 新观察有独立 gate-recovery 来源类型，角色上下文、原来源追溯和后续传播均识别真实恢复回执与冻结终态内容，不伪造成一份机械 discovery plan 或模型候选。字段 hash 由确定性系统从真实冻结字段计算，角色读取继续复验；恢复回执本身不能代替实际知识 owner 记录。
- 仍失败时，原协调器重新求值后提交具名停止事件，关闭原 epoch、保留调用用量/费用与已提交规则业务。原 operation 留在 gates 待办，不冒称完成、不回滚已付后果；父团局不能以新窗口绕过。保存、只读和显式授权的分支恢复仍可用，祖先恢复记录不能充当子分支新权限或第二次授予。
- 真实连续失败次数沿现有评估证据递增；同一状态的反复读取/继续不计数。第三次真实失败才请求作者审阅，第一次停止不伪称已到该阈值。三个实际授权世代的回归验证了该边界，完整作者诊断界面仍待接通。
- 新 receipt 的来源/唯一性、失败评估、知识关联与停止窗口均纳入解析和祖先 cutpoint 复验；恢复前/恢复后分支、项目导出导入和完整事件回放留独立证据。新纯模块登记在实际 replay chunk 分组中，纯 reducer 不访问 DB/模型/WebCrypto，也不在只读状态中偷偷修复。

当次工程路径覆盖：补充观察后真实 G2 通过、无候选/对别人私密时停止、错误 viewer/评估/风险与伪造结果、暂停零写入、FIFO 容量仍满时保留预约、三个真实失败世代、多真人不共享 private 观察、分支/备份与来源闭包。最初的新知识读取被原“仅机械发现来源”校验正确拒绝，已增加真实恢复来源分支；没有放松原发现链校验。队列测试改为五个合法开局局势占满容量，由真实威胁升级产生第六个队列预约，未提高开局上限。多人界面发现席位排序会优先交给别人的问题后，已改为原窗口发起人优先。

原生三条隔离浏览器路径已验证：实际点击一次修复→观察可见并继续；无合法观察→停止/刷新不重复；多人仅请求者获得观察、另一真人仍失败并停止且看不到对方内容。使用工程 fixture，不是作者正常生产、真实 provider 或真人试玩。检查器、构建、包体、旧队列/知识及最终快照 CI 分别留证；公共 open 入口仍默认隐藏。完整作者诊断、独立 GM 桌面、保密结果交接、正式连续委托/自由对话、逐 worldTurn 后果交织与 P7–P10 继续实施，产品完成门未更新。


本单元还收口隔离测试缓存：测试服务器使用本工作区的 `.vite-e2e-cache`，避免改写共享依赖缓存；该目录登记为生成物，不进入 Git、交接快照或源码 lint。仅忽略这一专用生成目录，正常源码/测试检查和原包体阈值保持原规则。初次全 lint 把该生成目录中的供应商预编译代码当源码而失败，原日志保留；修正后以最终直接检查为准。


### 35.35 候选施工进展：作者试玩诊断、修订交接与正式发布读取（2026-10-15）

开工卡：跑团 open 产品研发；S3 运行证据显式交给原作品作者，后续经既有生产修订入口创建新轮次。生产、Build、Release、运行及媒资 owner 均沿现行契约，世界仅引用冻结版本。本单元没有新增表、schema、AI 上下文源或可采纳字段，没有诊断触发的模型调用、游戏推进、世界回写或自动修订。保留此前所有正文与决策记录。

- 作者“战役与场景”页增加显式读取本作品试玩、读取诊断、导出 JSON 和加入修订要求。先验证 Work 范围内真实 Production/Build 历史，再验证存档唯一冻结来源；真人主持席位或调用者传入的作者标记均不充当作品归属。发布存档还须匹配已发布 Build、发布指针、productionKey、buildNumber、manifest hash、root terminal receipt 和实际 package/source hash。带安装来源的发行副本不获得完整作者诊断。
- 诊断投影保留具体制作版本、Brief/世界/规则/运行来源 hash、真实 sessionKey/序号/state hash、世界回合/阶段/安全状态、各真人最近质量门、全部检查历史、连续失败/作者复核条件、实际有限恢复与停止来源、待办步骤和已提交步骤。不同父子存档按真实追加顺序取最近记录；来源始终携带 sessionKey，不能用父存档的大序号压过子存档的新记录。
- 不导出原始输入、角色私密档案、模型消息/响应、种子、provider 配置或完整 evaluationBasisJson；也不复制恢复观察正文。作者只得到该诊断用途的证据投影。完整作者诊断组件仅从作者 Inspector 导入，玩家桌面不获得作者报告或其读取入口。
- 导出及加入修订前重新校验来源和最新状态，与已显示诊断的确定性 receipt 对比。记录已变化时要求重读，不静默交付一份作者未看过的新诊断。切换作品或存档清除诊断并拒绝迟到响应。
- 修订摘要包含实际来源、阻塞依据和停止证据，最多一万字，截短时明确提示完整 JSON。与作者已有要求追加合并，不覆盖原稿；超过上限保留原稿并提示整理。点击“加入修订要求”只填草稿，原“创建修订轮次”仍须作者明确点击，后续制作授权沿原链路。原发布、Build 和试玩存档保持原版本。
- 正式发布实测发现：统一来源链已有 protocol-2 读取，但 `assertProductReleaseUnchanged` 的旧版默认读取会提前拦住 open 规则包。增加显式 protocol-2 校验参数，并在统一来源、实例准备及正式跑团命令中传递；保留旧版默认读取约束，不放宽 hash/manifest/来源一致性校验。新增正式发布实例创建、Session Zero、开始运行及作者来源复验的回归，避免只验证制作预览。

已完成针对作者归属、跨作品/产品、损坏来源、发布源/安装副本、过期导出与修订、有限恢复/停止、父子来源及只读零推进的隔离回归。实际原生浏览器验证正常作者生产 fixture → 试玩 → 作者页面 → JSON 下载 → 保留已有修订要求 → 明确创建新轮次，并核对旧 Build 与存档不变；模型传输是明确模拟，不是实际 provider 或真人试玩验收。最终工程检查、相关旧链路回归和冻结整仓验收分别留证，未通过的阶段不得宣称完成。公共 open 入口仍默认隐藏。

仍待实施/验收：独立真人 GM 桌面、保密结果的玩家知情审查、正式连续委托/自由对话、逐 worldTurn 后果交织，以及 P7 渐进上下文、P8 长记忆与世界补丁候选、P9 运行扩展、P10 媒资与 30+ 回合长局；真实作者/模型/真人路径及完整工程闸门仍独立。原产品完成门和历史失败证据不变。

本单元边界补记：上述正式发布回归验证的是已冻结、具备真实 manifest/lineage/hash 的发布实例读取与运行，不代表普通作者发布采用链已通过。本次追溯还发现 adoption 的 Preview/Release 读取仍有旧版入口，下一单元须补正常制作 → 作者采用 → 发布 → 试玩闭环；不得用测试合成发布替代这项验收。


### 35.36 候选施工进展：正常作者发布、原始生产来源与跨库备份（2026-10-15）

开工卡：跑团 open 产品研发；S3 作品生产、作者采用、不可变发布及正式游玩。Work/Production/Build/Release/session、原 Artifact producer、世界冻结引用与媒资 owner 各归现行链。作者采用继续显式授权；新修订不改旧发布或存档。共享热点的变更须按基础提交串行集成，不据 Git 无冲突宣称架构兼容。没有新表或索引、AI 字段、模型旁路、世界回写或默默发送。

- 从普通新建作者草稿、两次内容复核及真实 Harness/root/quality 产物起测，复现采用入口用旧读取器拒绝新版规则包；采用、父版本及最终发布均改用显式 protocol-2，内部类型表达真实版本联合，不把 open 强转成旧包。新 open release 谱系使用 protocolVersion=2；旧默认读取、Creator 专属授权及社区旧格式边界保留。
- 发布复验发现同一 Build 的作者复核会产生跨 epoch carry。不可变 Artifact 保留原 producer/input；当前 synthetic Run、零用量账本、执行身份、依赖和回执单独证明本轮复用，不能把当前复用 Run 伪装成原字节生成者。跑团接入严格 Artifact store 的接受、同 Build 和跨 Build owner；其他产品的持久化路由不随之切换。
- ensurePlan 的 carry 在最终 Plan 提交前发生。跑团的 pending Plan 只能绑定实际授权 Brief、当前 Build/epoch 和确定性 hash；事务重查 Brief、Build、全部 Artifact、父运行/事件/检查点及物理字节。carry 已提交而 Plan 提交失败时，重入只识别真实已有 ref，不重新生成或丢内容。来源链逐层复验原候选/生产者，保持有界，不抹去历史失败。
- 完整备份原先同时暴露当前 Run 与历史 producer 失效、原 Context Manifest 的旧本地 scope fingerprint、Brief 历史编号与当前 WorldReference 定位不一致。导入恢复现在分别复验原候选/账本、历史生产者、当前复用和 root，不调用模型；来源聚合仍须独立验证当前冻结世界、权限和必读。
- 增加可选 `agentRuns.portableWorldContextBindingsJson`，仅保存 manifest hash、原 fingerprint、世界 UID/hash 和证明 hash。导出时从实际 provider、exact manifest 和真实 source refs 生成，随原注册表行搬运且没有需重映射的本地主键。导入验证精确字段/预算/hash；必须有真实导入失效与显式本地复验事件，当前 SourcePlan 的 UID/hash 及实际资源版本/字段/内容一致，才可引用原读取。原 Context Manifest、原 fingerprint、原 Brief 字节/hash 全部不改，不声称发生新读取。数据治理与跑团产品契约已同步。
- 原 Brief 内本地编号为历史输入，活跃定位使用 Brief 行已重映射的 `sourceWorldReleaseId`；SourcePlan、行级世界 hash 和原 Brief 世界 hash 必须一致。缺失便携证明的旧备份可继续保存/只读，但不补造发布来源。换世界、改权限、篡改证明、仅复制证明而没有真实导入及复验均不得转绿。

本轮隔离回归验证：正常第一版采用/发布和正式源实例、第二版父谱系/旧存档不变、额外暂停恢复零模型增量、carry 提交后 Plan 失败再入、原 producer/input/parent proof/synthetic ledger 篡改拒绝、备份恢复后发布、两次清空数据库并制造不同本地编号后迁移、缺失/损坏/换世界证明及活跃 Run 复制证明拒绝。初次旧读取、carry/ledger 错误、未持久化 Plan、历史本地 scope 与旧 Brief 定位等失败日志保留，没有放宽来源或硬门来让测试通过。

原生浏览器已通过实际作者发布按钮 → 正式版本开新团 → 本人身份/安全约定 → 开始冒险 → 刷新恢复。初次浏览器在源码仍变化且只有 5 秒观察预算时未完成导航；后续以冻结工作区重跑通过，不把观察超时当成发布失败或重发模型。生产传输是明确工程模拟，仍不是实际 provider 或真人试玩。最新相关回归、构建、包体、冻结快照与整仓验收分别留证。

另：前一份 human-narration 冻结输入 e41803aca4bc0bab89a5be71f72f74dd035878a8f5c3dab87c14d2feef8f9597 的九阶段串行验收已全部通过（整仓 CI、构建块初始化与原生 E2E 分开），但它不包含本节新增源码。风险单元原等待任务仍按实际队列状态处理，不把旧快照成功当成本轮成功。

完整目标继续：独立真人 GM 桌面、保密结果知情审查、正式连续委托/自由对话、逐 worldTurn 后果交织、P7–P10 渐进上下文/长记忆/运行扩展/媒资及长局，以及真实作者/provider/真人验收。open 社区原型导出旧格式尚未升级；跨 Build 长链、不同媒资组合及成熟度证据仍按后续实际验证收口，不声称本节已覆盖全部交付门。

补充原生验收：已在独立浏览器上下文中实际导出/导入完整备份，制造不同本地编号后，点击“复验导入生产证明”再发布；原浏览器仍未发布。原生首次复现 PrematureCommitError，定位为冷加载便携证明模块发生在 IndexedDB 保活范围之外，现把动态加载与校验整个等待纳入 Dexie.waitFor；原生重跑通过，未靠假 IndexedDB 结果宣称恢复完成。截图已检查。


### 35.37 候选施工进展：已发布备份继续修订与 open 跨制作版本复用（2026-10-15）

本单元沿跑团 S3 作者生产、发布和私域存档生命周期补齐恢复后的修订，owner 仍为原作品；冻结世界仅显式只读引用，媒资仍归跑团作品，不新增表或 AI 正式写入入口。保留前文决策与验收限制。

- 完整备份导出/导入显式读取 protocol-2 发布；旧文字开放世界存档迁移仍在独立 legacy parser 边界处理。复验已发布制作版本时校验完整封存包络和成果集合，并保留其发布状态及原字节。
- 新修订校验当前映射后的来源行、冻结世界 hash、嵌套来源合同，只在新 Brief 采用当前机器的定位。原 Brief 与 SourcePlan 字节/hash、原发布及存档保持不变。
- open 任务接入实际修订影响范围，视觉修订复用已确认来源事实/规则/局势；完整作者输入、来源版本、执行语义、原始与本轮复用记录均须闭合。仅本地来源定位可规范化比较，世界 UID/hash 与语义输入不可放宽。
- 初始跨制作版本复用在当前授权 Brief 与待提交 Plan 上验证，写入前比对已读来源、目标、完整父证明及账本原记录；损坏或并发变化必须零采用。连续父链有循环与深度保护。通用 scripted/其他产品的现行路径保留。

该单元的定向回归、原生浏览器和最终检查证据随本节后续补录。明确模拟模型传输的自动化不代表真实 provider、玩家或完整产品验收。完整范围仍包括独立真人 GM 桌面、保密结果知情审查、委托与对话、逐 worldTurn 后果交织、P7–P10、社区分发和真实长局验收；默认开放入口仍隐藏。

本单元隔离工程证据：8 个相关回归文件共 169 个不同用例通过（新增 11 例包括恢复后预览/已发布两类修订、连续三版与再次跨库备份、来源定位/世界 hash/嵌套引用反例，以及原始 producer、reuse key、Brief 绑定、改变输入、影响范围五类零采用反例）；2 条实际浏览器流程通过，分别从已发布备份在独立浏览器还原、复验、经内容页或媒资页显式创建修订后再次发布，旧发布/Build/存档精确保持。视觉修订以实际账本证明只执行 1 次模型规划；该模型传输是明确模拟。最终直接检查 13 项与生产构建通过，包大小闸门和实际产物模块初始化单独留证，初始化不等同 UI 游玩。最新全量 CI/原生集合须在冻结输入上串行完成，未用旧快照通过代替本单元验收。


### 35.38 候选施工进展：独立真人 GM 席位与主持桌面（2026-10-15）

本单元属于跑团 S3 正式运行的候选 UI 与授权适配，数据 owner 仍为原跑团作品及当前 session，冻结世界只读，媒资 owner 不变。读取既有不可变 ProductRelease/运行事件/席位/Agent 账本，写入既有 Session Zero、开局、暂停、后果审查、叙述和恢复命令；不新增表、事件格式、模型入口、上下文源或 AI 正式写入字段。三注册表及生命周期沿现行 owner 执行。

- 增加独立真人主持身份入口和桌面，GM 不再经过玩家 actor 私密投影。开团前分别认领、安全确认，所有真人确认后才可开始；GM 拒绝 AI 建议不影响真人主持权。
- 展示当前局势、实际待处理行动、主持专用的真实规则结果、既定批准范围、后果/阶段审查和全队叙述。返回身份选择及刷新清除主持视图；读取有状态/席位 stale 校验，不返回玩家档案、原始输入、模型消息、seed 或完整 Plan。
- 暂停、检查点、真人叙述及本人回执修复复用原命令和账本，不建立第二套主持或结算引擎。仍由原 epoch 启动者继续其行动；GM 不代签真人玩家，也不扩张队友批准关系。原玩家及 scripted 入口保留。

定向回归、原生浏览器和最终工程证据在本节后续补录。保密骰点的 GM 投影不是玩家知情确认功能；该流程与连续委托/自由对话、逐 worldTurn 后果、P7–P10、社区分发及真实 provider/真人长局验收仍需完成。开放入口默认隐藏；本节不能作为完整产品通过证明。

本单元工程证据：7 个定向回归文件最终 38 例通过，覆盖独立主持开团与原角色隐私、拒绝 AI 建议的真人权限、不能代签、stale/AI GM 身份拒绝、真实叙述/暂停/事件重放，以及原玩家桌面、风险后果和有界修复。3 条实际浏览器路径通过：真人 GM 分席位等待玩家确认后开团并刷新恢复；为另一位玩家的实际行动保存叙述，刷新、交回玩家并完成原结算；原 AI GM 模式的真人补写叙述路径。测试来源为明确的内部协议 fixture，不能替代正常作者生产、真实 provider 或真人长局验收。截图已检查。最终 13 项直接检查和生产构建通过，构建体积与产物模块初始化另留证；第一次 lint 的 ref 清理告警通过正确赋值写法修复，未关闭规则。最新输入须单独进入全量串行 CI/原生集合验证，原快照通过不能替代本单元。


### 35.39 候选施工进展：保密裁定后的主持告知与本人选择（2026-10-15）

本单元属于跑团 S3 session 的人类确认链，不新增模型入口或 AI 可写字段。复用原世界引用、ProductRelease、正式事件、operation、actor approval、效果/发现结算 owner；`PROJECT_TABLES` 既有运行表携带可选 JSON 证据、完整备份、删除与分支，记录不含本地 DB 编号。原 scripted、旧 V2 内容/初始状态/历史哈希与旧事件不改写。

- 独立真人 GM 或 AI GM 模式的实际 Session Zero 确认者，先显式读取保密后果，再核对系统从真实裁定和冻结模板派生的必要代价，最后确认追加告知。普通玩家读取不获得主持审查列表、骰点、成功等级、主持私密理由或机械依据全文。
- 告知记录绑定 kind/template、plan/risk、当前 epoch、真实限定来源和机械依据；预览 hash 在提交前再次验证，已保存 hash 在读取/选择 owner 异步验证，纯回放核验实际来源/语义。不能描述的后果阻断，不伪造免费选项。
- 玩家使用当前告知版本亲自选择，权限仍按原 allowedSeatKeys；主持不能代签或自造费用，metadata 提交不扣费、不授予知识、不重掷。费用/知识仍由原唯一业务账本生效，重复确认/恢复幂等。
- 新 operation 的可选告知历史为空时标记当前策略；旧记录不新增空字段，历史读取/回放形状不变。当前命令处理旧未完成操作仍要求告知；父分支告知不能替代子分支的新授权/确认，备份保留真实来源。
- 从 adapter 层抽出原有的确定性发现后果选择函数供回放与审查共同使用，纯模块分组维持无环，未引入另一套规则裁定或隐藏结果放宽。

验证证据在下方补录。该单元不等于所有隐藏初始风险、任意效果组合或完整跑团产品通过；不能展示的风险仍阻断。连续委托/对话、逐 worldTurn 后果、P7–P10、发行与真实作者/provider/真人长局验收继续保留，默认预览边界不变。

本单元定向工程证据：12 个相关回归文件共 110 个不同用例通过，覆盖新告知 7 例（真人 GM/AI GM 的实际人工确认者、主行动/发现两种选择、只告知必要后果、无费用预览、一次扣费、伪造/错 hash/代签/状态变化拒绝、真实分支重新告知、完整备份与旧记录形状），并复跑旧发现选择、操作/分支恢复、角色知识、作者版本、原玩家/主持桌面、纯回放分组及全量数据往返。受新告知合同影响的旧 fixture 显式增加真实人工告知再选择，未把冻结保密规则改成公开来通过测试。

7 条实际浏览器用例通过：新真人 GM 与 AI GM 人工确认者两条告知→身份交接/刷新→本人选择→一次结算；原真人主持两条与公开代价选择一条；旧知识发现与选择恢复两条。浏览器首次在写入回执完成前刷新而未观察到持久化，现主持桌面明确展示真实已保存告知回执，验收等待该回执后刷新并成功恢复。新旧用例均为内部协议 fixture；没有调用真实模型或证明正常作者、真人、长局或商业验收。最终 13 项直接检查与生产构建通过，纯模块无环与预算阈值保持；产物模块双顺序初始化单独留证，初始化不等于 UI 游玩。完整 CI 和原生集合仍须在最新冻结输入上串行完成。


### 35.40 候选施工进展：人工规则选择与提交中断恢复（2026-10-15）

本单元属于跑团 S3 的产品能力研发，数据 owner 为原作品/session，世界与媒资 owner 不变。读取当前真实角色投影、冻结规则及 ProductRelease，写入原 epoch/operation/risk/结算命令；不新增模型入口、表或 AI 可写字段，继承既有 `PROJECT_TABLES` 备份、删除及分支生命周期。

- 新增人工规则目录和桌面入口，玩家未同意 AI 建议也可选能力/通用检定、合法目标及明确绑定参数。发现只展示本人有权看到的介入提示，不发送秘密线索正文或主持模板。目录绑定真实进度、viewer 和 runtime 来源，状态变化要求重新读取。
- 原 epoch 可选保存规范化人工请求及 hash；授权落盘前用原内核预检全部规则，不另建规则引擎。人工授权只能对应原请求和一个 operation，不能用于 AI 意图/队友提案或继承结算；KP 如需模型，仍按既有许可独立检查。
- 授权成功、operation 提交失败时显示明确恢复入口；刷新、完整备份与重复恢复沿原身份和稳定 commandId 续接。错角色、错 hash、换请求、stale、非法目标或绑定拒绝，验证前不制造空授权。旧 epoch 不补写新空字段。
- 正常作者链暴露并修复原有发现名单解析问题：party/public 空名单在发现计划上冻结本桌授权成员；显式子集不扩大，private 不补隐式成员。冻结发行字节与历史不改写。

定向回归、原生浏览器与最终直接检查结果在下方补录。首条浏览器路径沿正常新建作者草稿、两次内容复核、正式发布和 release-bound 开局，人工 GM 与拒绝 AI 建议的玩家完成行动、风险确认、主持叙述及刷新，运行模型调用为零；作者生产传输明确模拟。另一条路径制造真实 operation 写入失败，刷新后恢复原授权。上述工程证据不代替真实 provider/独立玩家验收；完整范围与默认隐藏边界保持，后续继续委托/对话、逐 worldTurn 后果交织、P7–P10、社区分发及长局验收。

本单元工程证据：10 个相关回归文件共 78 个不同用例通过，包含人工入口 8 例、旧操作恢复/原玩家桌面/纯回放、正常作者准备/编译/发布，以及知识发现和保密代价选择。新例覆盖能力与通用检定、拒绝 AI 建议仍可操作、重复提交、真实写入中断、完整备份恢复、未扩大名单、错 hash/角色/目标/绑定/stale 与换请求的拒绝。两条原生浏览器路径通过，正常作者链使用明确模拟传输，运行调用账本为空；截图确认手动表单实际呈现。13 项直接检查和生产构建通过，体积闸门与构建模块初始化另留证；全量 CI/原生集合继续以本单元最新冻结输入串行验收，未把其他快照的成功归给本单元。


### 35.41 候选施工进展：多轮行动的逐轮压力与局势后果（2026-10-15）

本单元沿跑团 S3 session 规则与结算生命周期研发，world/媒资 owner、不可变 ProductRelease 和三注册表保持既有边界。读取冻结规则、真实时间/裁定/后果及角色授权，写入既有事件和 operation/pressure/situation 账本，不增加模型入口、表或正式 AI 写入字段。

- 新建耗时大于一轮的 operation 显式使用 `per-world-turn-v1`：原单次裁定/主效果/发现之后，按 `time.N → pressure.N → situations.N` 完成本轮，再推进下一轮；原终态/四门/叙述/交棒保持最后执行。所有直接命令也检查冻结顺序，不能跳到第二轮；模型和行动预算不随 tick 重置。
- 每轮周期可选保存 `operationStepKey`，唯一性为真实规则来源加 owner 步骤，周期、命令和桌面后果匹配当前实际步骤。压力只规划当前已支付轮次；第一轮作用于角色的实际状态会影响第二轮而后按真实持续时间过期。需要确认的后果阻断下一次时间支付，沿原确认/一次性效果入口处理。
- 继承操作复制原结算版本和完整业务前缀，沿真实祖先裁定/时间/后果继续；新子局势周期的祖先来源验证同时要求本地继承回执与原切点证据。完整备份及重放保留稳定键，不含新增本地 DB 编号。
- 旧 operation 没有新属性时维持原步骤/JSON/hash 形状和批处理周期。旧存档 fixture 从修改前已冻结源码实际生成，再由当前导入/正式 owner/纯回放验证，未用当前 builder 冒充历史格式。
- 修复重复局势维护将已满足障碍再次加入而报错的问题：合并结果取集合，调用者输入自身的重复项仍拒绝。原脚本式和规则/权限边界不放宽。

当前代码为候选实现，已执行的逐项工程证据在后续补录；不得把部分测试或新文件存在视为全产品完成。新增浏览器使用隔离 IndexedDB 和真实规则/正式事件 API，作者/玩家/真实模型验收继续分别保留。P7–P10、正式连续委托/自由对话、社区分发、长局与真实作者/provider/独立玩家目标仍须完成，公开入口默认隐藏。

本单元工程证据：13 个相关回归文件共 135 个不同用例通过，包含逐轮结算 4 例（不能提前支付下一轮/伪造周期步骤、第一轮真实条件影响下一轮、父子分支与完整备份、修改前冻结源码生成的真实旧存档），原压力/后果、局势维护、操作/分支恢复、阶段/四门/有界修复、原手动行动及纯回放边界。已修复旧断言对整批步骤和轮次的假设，风险确认与失败反例保留；压力独立 fixture 明确把无关局势终态置于该测试窗口外，综合后果仍由专门用例通过真实确认执行。征兆不足 fixture 显式使用两轮提前期，不能借新版第一轮真实征兆伪装成原来的无提前失败。

6 个浏览器文件共 12 个不同用例通过，新增逐轮路径使用真实 IndexedDB/正式事件与主游玩协调器：第一轮后果刷新保留，实际确认后再推进，临时能力仅在第二轮有效；另复跑压力/费用、局势计划/到期/确认/FIFO、升级/击败清理，以及行动/私密/最大时限分类。它们是内部协议与隔离浏览器证据，不是实际玩家或真实 provider 验收。13 项直接检查、生产构建及体积闸门通过；纯模块产物初始化单独留证且不宣称 UI 游玩。完整 CI/原生集合仍在最新冻结输入上串行验收。多轮流程真实包含更多持久事件，相关长用例使用有界 60–120 秒单例预算；保留执行耗时，不用跳过逐轮 owner 来维持旧短时间断言，长局性能仍需 P7/P8 的实际验证。


### 35.42 候选施工进展：零耗时真人讨论与规则询问账本（2026-10-15）

本单元属于跑团 S3 的人类沟通链研发，owner 仍为原作品/session。冻结 RulePack 已声明 `outOfCharacter=0`、`rulesQuestion=0`，本单元按该策略保存讨论，不以自然语言生成机械结果。世界与媒资 owner 不变，既有 `PROJECT_TABLES` 运行事件/状态负责完整备份、删除和分支；不新增表、正式模型入口、上下文源或 AI 可写字段。

- 真人玩家、独立 GM 及 AI GM 模式实际人工主持者可发送桌外讨论/规则询问；暂停时仍允许沟通，不推进时间、重置预算、消费资源、打开 epoch 或改变风险确认。已批准的原规则行动可继续执行。
- 全队或主持私密受众由发送者明确选择，并冻结为本次真实 human/hybrid claimed 席位的 viewer。只有实际人工主持可回复其有权读取的原问题，回复严格继承问题受众；不能用回复扩散私密内容，另一位真实玩家的投影也不能看到问题或答复。
- 新正式事件 `ttrpg.open.table-message.posted` 引入可选 `openRun.tableMessages`，旧序列化形状不变。记录绑定作者/实际授权版本/源事件/稳定键，规范请求与幂等回执使重复点击和恢复不复制记录，改变同一提交拒绝。分支/备份保留真实切点，祖先记录必须精确匹配，重复源事件或伪造受众拒绝。
- 独立人类读取服务在授权、scope 和当前进度校验后分页返回，隐藏消息不能作为另一位玩家的游标。消息不进入既有模型角色/上下文投影，不能自动成为事实、知识或规则。界面使用普通文字渲染，身份切换清空私密视图；同一身份的父页面刷新保持讨论组件稳定，避免保存后表单卸载。

工程证据在后续补录。本单元完成真人桌外/规则询问的正式保存与答复；不把它称为完整游戏内 no-roll 或 AI 对话。后续需为游戏内互动冻结 kind/作用域/效果/耗时，接入正式候选、权限与生产；AI 规则答复亦须登记来源/Skill/授权与 Harness，连续委托及 P7–P10、发行、真实 provider/玩家验收继续保留。

本单元工程证据：5 个相关回归文件共 26 个不同用例通过，包括新讨论 9 例、原角色/真人主持桌面、手动规则行动与纯回放边界。新例覆盖独立真人 GM 与 AI GM 的实际人工主持者、另一位真实玩家不可见的私密问答、模型视图无消息正文、精确重试/改写拒绝、暂停时不推进时间、已确认行动不失效、伪造作者/受众/源事件/类型/stale 拒绝、真实分支/完整备份与分页隐藏游标。旧状态不引入空消息字段。

两条实际浏览器流程通过：玩家私密询问→交接给另一位真实玩家验证不可见→真人主持答复→刷新重新确认原玩家后读取答复，分别覆盖独立 GM 与 AI GM 的人工确认者；世界轮次、epochs、模型调用保持零。初次浏览器复现保存后父刷新卸载表单，现讨论组件按已确认身份和运行状态独立保活，身份切换仍卸载，复验与稳定截图均通过。类型检查曾发现 JSX 的 unknown 条件值，现显式转为 boolean，未关闭检查。最终 13 项直接检查、生产构建、体积门及产物模块初始化通过；后者不宣称 UI 游玩。完整 CI/原生集合继续在最新冻结输入上串行验收，不把其他快照或模拟角色当成真实 provider/独立玩家验收。

### 35.43 候选施工进展：冻结游戏内无检定互动（2026-10-15）

开工卡：跑团产品能力研发，S2 作者确认规则、S3 制作与运行。规则、角色、互动后果与运行状态仍由原跑团 Work/Build/Release/session 持有；冻结世界只读，媒资 owner 不变。作者输入仍走 `ttrpgRulePacks` / Brief，模型仍只读已登记的 `ttrpgOpenAuthority` 并生成候选；实际写入沿原 operation、规则与效果 owner。没有新表、schema、正式模型入口或新的 AI 可写字段，既有注册表负责备份、导入、删除和分支。

- RulePack V2 可选 `interactionBindings` 定义 `interactionKey/kind/title/actionKey/effectPlanRef/preconditions/timeCostWorldTurns`。kind 闭集为 dialogue、observe、move、assist、retreat，耗时 0～10。必须绑定实际获准、无 check/随机 damage 的现有行动；原费用、状态与能力次数仍有效。移动/撤退须引用 success 效果模板，每个方案实际对行动者执行 `location.set`，不以文字伪造移动。撤退由真人发起，实际裁定只增加一次混乱值。
- 正式请求仍是原 `existing-action` 加可选 `interactionKey`，计划冻结完整绑定。已绑定的底层行动不能省略互动标识，从而绕过前置条件、耗时或后果。手动目录按互动列出合法参数；AI 候选的 method 精确指定当前角色可见的 interactionKey，系统按真实授予/条件复验后进入同一计划。仅凭“观察”“移动”等自然语言关键词不会执行未定义规则。
- 游戏内互动与桌外讨论分别沿各自 owner 保存。无检定不等于免费、不耗时或自动获得信息：观察只有绑定真实局势/介入点/发现路径才写入知识，接收者依原规则冻结；普通对白不创造会话事实。AI 后续叙述仍需原独立授权和 Harness，互动不授予额外模型权限。
- 原行动与互动后果用实际纯机械/效果解释器做隔离预检，不保存模拟回执。合计费用无法支付时，在人工授权/操作创建前拒绝；有可付选项时保留选择，不默认第一项。真人选中无法支付的方案时零写入，仍可选择合法方案。混合目标同样检查，错误不包含另一角色余额。实际效果提交和纯回放再次核验，保留一次性支付与原因果。
- 角色投影只给获准互动的 key、类型、名称、耗时和可用状态，不给隐藏前置谓词或效果模板。互动目录是现有 Authority provider 的必读资源；该 provider 版本升至 v2，玩家/队友 Prompt 升至 v2。局势制作 Prompt 升至 v2，要求补齐作者已冻结的 effectPlanRef 并由编译/发布解析器校验。既有通用只读工具声明未改，工具 schema hash 不随任意读取内容变更；历史候选/来源证据不批量重写。
- 作者在现行“规则与村规”页面选择规则文件，检查名称、版本与互动后明确保存。复用既有规则 owner、作用域、fixture 和权利校验；同身份/版本的不同内容拒绝替换，须使用新版本。保存规则不等于保存配置或授权制作，Brief 页面展示真正冻结的互动，制作继续保留来源与数值两次人工复核。

旧 RulePack、请求、计划没有上述可选字段时保持原序列化形状，scripted 不转换。当前本地回归覆盖五种互动、合计费用、不可付选项/改选、混合目标、发现接收者、AI 候选和队友预授权、幂等/回放及完整备份。原生浏览器验证移动/撤退的真实参数、确认、耗时、位置与刷新；作者规则导入→配置→Brief→两次作者复核→实际 Build 使用明确模拟模型传输。初次 author fixture 沿用了旧规则身份的角色卡，被现行校验拒绝；现 fixture 从本次冻结规则重建角色卡，没有放宽产品校验。

工程门与最终冻结输入 CI 分别留证。本单元不构成真实 provider、独立玩家或长局验收，也不实现任意自然语言连续对话。正式连续委托、AI 规则答复、P7 渐进上下文、P8 长记忆与补丁候选、P9 扩展、P10 媒资和 30+ 回合、发行/社区及完整产品交付继续实施；公共 open 入口维持默认隐藏。

本地工程结果：11 个相关回归文件共 63 个不同用例通过；隐私提示与撤退回放补查后，相关 22 例再次通过，不重复计数。3 条隔离浏览器路径通过，作者导入同时实测拒绝覆盖已验证规则；13 项直接检查、生产构建、原共享体积门和真实构建模块正反加载均通过。构建初始化探针只证明模块可加载，不作为玩法验收。最终快照的完整 CI 仍以独立串行回执为准，不能借用先前人工行动快照已通过的结果。

### 35.44 施工中：连续主持的有限委托与请求绑定（2026-10-15）

本单元是后续自动主持协调器的授权基础，尚未开放连续主持按钮。产品研发位于跑团 S3，owner 是现有 session；不改世界、媒资、表/schema 或模型写入字段。原 epoch 继续持有唯一硬预算，新的可选 `hostingDelegation` 只记录原真人对这一个窗口的明确委托，缺少字段的旧状态保持原形状。两个正式事件 `ttrpg.open.hosting.delegated` / `ttrpg.open.hosting.stopped` 分别保存授权与停止。

- 委托者必须是当前窗口的原真人、当前桌的真实人工主持，且作品策略及 Session Zero 允许 AI 主持。固定能力仅包含队友提案、原 Session Zero 预授权范围内的安全队友行动和共同视角 KP 叙述；不包括替真人决定、规则改写、Oracle/事实采用或额外知情权限。人工行动专用 epoch 不可升级为此委托。
- 来源绑定真实 Session Zero 与本次委托事件；每次调用预留上限不超过原 epoch 预算。重复相同决定返回原回执，修改同一提交或停止后原窗口重授拒绝；新窗口不继承旧委托。停止可以发生在暂停或未知请求期间，不更改已完成行动、时间、实际用量、未知余额或原调用记录。
- 受委托模型请求可选携带 `hostingDelegationRef`。该字段进入真实 RunContract 的 runtimeBindingHash、原请求账本与事件回放；仅 companion/KP 用途可用。准备与正式预留检查当前权限、原预算、每次调用预留和已有请求；派发再次核验仍有效的同一委托。撤销后不能获得新 send permit，已经派发的实际结果仍保存用量；迟到候选因委托已失效而阻止采用。旧请求没有字段时不重写其 contract/hash。

当前工程反例覆盖授权/幂等、越权/超预算/错误窗口、人工授权不可升级、暂停撤销、真实未知传输回执保留、完整备份、伪造能力/来源拒绝、窗口隔离，以及真正 prepared Run 在撤销后零发送、in-flight 撤销后保留真实用量并阻止迟到候选。后续仍须完成协调器、队友系统提案与安全准入、KP 委托采用来源、用户停止/恢复界面及完整联合验收；本节不表示连续合作体验已完成。完整目标与 P7–P10、真实模型/玩家验收保持。

### 35.45 施工中：真实系统提案与 KP 委托采用（2026-10-15）

本单元承接 §35.44 的原窗口委托，仍是跑团 S3 运行研发；无新表、schema、模型入口、上下文源或 AI 字段。共享规则、候选、效果、epoch、Run 与三注册表 owner 不变，不回写冻结世界。下列 API 已接入，连续主持协调器和按钮仍未开放。

- 新 `startTtrpgOpenDelegatedCompanionOperationV1` 与原显式真人确认入口分开，共用实际规则准入。系统事件记录 `decision=delegate-proposal`，operation 的原 `intentEvidence` 可选保存真实 `hostingDelegationRef`，不能写成真人逐条 `start`。必须来自仍有效委托下的同角色、同 epoch、同真实 companion 请求及其原始候选；不能借用未绑定请求、其他角色或旧窗口。
- 系统提案只创建等待审查的计划，不支付、不掷骰、不推进时间，也不自动补真人批准。安全行动复用原 Session Zero 预授权检查；预授权回执和 intent 可选记录同一委托来源，正式命令及纯回放都再次验证。含费用、随机裁定、其他影响或不满足预授权条件的提案保持待真人处理；提案后撤销委托也不能自动执行。真人仍可按原明确确认流程审查保留提案，停止自动继续不伪造或替代该决定。
- 新 `acceptTtrpgOpenDelegatedKpNarrationV1` 与真人逐条采用入口共用原叙述验证和 durable 终验。模型请求、共同视角、已完成裁定、候选/hash、接收者及同一委托必须真实匹配；已撤销或未绑定的请求不能借委托采用。正式叙述回执可选保存委托来源，原规则事实、知识、资源与时间不变；重复采用返回原事件。
- 委托采用的终验工件保存 `decisionAuthority={kind:runtime-delegation,sourceRef}`，增加对应实际来源的验收证据，采用 hash 绑定正式回执。共享 Harness 的通用 adopt 状态不携带虚构真人身份；作者复核专用的 reviewItemId/reviewDecision/note 不作系统决定用途。初次测试因错误单填该 note 被共享 schema 拒绝，现保留共享合同，用跑团 receipt 与终验工件记录真实来源；没有放松检查或补造作者复核。停止后恢复既有终验只复验原提交，不重发、不重新授予委托。
- 旧请求、真人入口、operation intentEvidence、预授权和模型叙述缺少新字段时保持旧序列化形状和原确认行为。完整备份保留稳定来源与真正生产/采用链，不引入新本地主键重映射。

本轮 9 个相关回归文件共 76 个不同用例通过，覆盖原模型 Harness/规则恢复、两套新采用路径、撤销、借用/伪造来源拒绝、风险回交、重复恢复、事件回放和完整备份。两条原生浏览器路径通过：一次委托跨刷新完成原真人行动和两名不同 AI 队友的三次结算、三次 KP 叙述；所有五次真实模拟请求绑定同一委托、共用一个 epoch，最后按原预算交棒。另一条旧式 KP 保存/刷新/逐条采用流程仍通过。这里的 provider 是明确模拟传输，实际 IndexedDB/契约/事件/账本有效，但不代表正常作者作品的真实模型或独立玩家验收。

后续必要工作仍包括自动协调器、停止/恢复交互，以及“原响应已成功记账、候选/Manifest 尚未落完”的无二次调用恢复。当前 Harness 对非 prepared 请求不再发送是正确边界，但不能用该边界掩盖成功响应到候选之间的待恢复断点。完整 CI 在后续冻结输入上单独验收；P7–P10、发行与真实长局完成门保持不变。


### 35.46 施工中：已成功响应的无传输恢复（2026-10-15）

本单元继续跑团 S3 运行研发；实例拥有调用用量、原始响应、候选、Manifest 与检查点，世界与媒资 owner 不变。复用现有 Run/Context Gateway/PROJECT_TABLES 生命周期，不新增表、迁移、上下文源、AI 写字段或模型入口。原决策与 §35.45 的剩余事项原文保留，以下补足成功响应到候选之间的断点。

- `recoverTtrpgOpenRuntimeCandidateV1` 只处理账本已成功、实际原始响应与原用量可回读的请求。读取原实例、Run Contract、冻结 Skill、viewer、epoch、原输入/来源、raw hash；恢复入口不接受模型配置或传输适配器，不派发、不新建请求、不补预算、不把 unknown 当成功。普通行动、队友、Oracle、事实归一和 KP 共用原语义物化逻辑。
- 正常传输与恢复共用同一候选落盘尾部；已存在的候选工件按原字节/hash 复用，不重写已有告警、取消或 stale 结果。尚无候选时从原响应和冻结输入创建，恢复时观察不到的延迟保持 null；沿用原 provider/estimated 用量来源，不把 token 或模型价格估算当实际账单。暂停、权限/状态变化、主持委托撤销使新物化候选受阻；既有候选的实际采用仍必须经过原即时权限与规则检查。
- 每个部分落盘位置分别恢复：候选工件、尚未组装的最终 Manifest 工件、已 `context.assembled`、已 `candidate.persisted` 和缺失检查点。已有 Manifest 只回读校验，不重复 finalize；候选与 Manifest 不一致、候选分叉、原字节缺失/损坏或角色不匹配时拒绝。有限重试仅覆盖本地证据 sequence CAS 冲突，不能因此重发模型。共享 Context Gateway 的唯一 finalize 合同保持原样。
- 玩家桌读取保持只读：同一玩家、当前窗口内尚无完整候选的成功响应投影为“恢复已保存的回复”。玩家明确恢复后显示原待确认候选，不能自动采取行动或采用叙述；恢复前阻止界面开启新的模型请求或结束窗口。错误、未知、已派发的请求继续使用原状态与人工处理路径。

恢复回归覆盖五个真实持久化边界后的模拟中断、并发 CAS、原用量与候选保留、暂停/撤销、原字节篡改与候选分叉拒绝、只读投影及显式恢复。原生浏览器使用明确模拟的 provider 响应和真实命令/IndexedDB/玩家界面，刷新后恢复并再次刷新读取；没有增加模型请求，也没有自动确认。真实模型、独立玩家和长局验收仍未完成。连续主持协调器、开始/停止/恢复委托界面和 P7–P10 按原完整目标继续，不因本节缩减。

工程证据：11 个相关回归文件共 95 个不同用例通过（首轮 94 个包含恢复 13 个，补充并发收敛后恢复 14 个再次全部通过，不重复计数）；现行来源下两条原生浏览器路径通过，覆盖旧玩家桌确认/结算/叙述/交棒以及新增成功回复的刷新恢复。13 项直接检查、类型/静态检查、构建与包体预算通过，实际构建的三个回放模块正反初始化通过；模块探针不作为玩法验收。完整 CI 和继承纵切面仍在冻结来源上单独排队验收。


### 35.47 施工中：本轮连续主持协调器与显式停止（2026-10-15）

本单元继续跑团 S3.4 运行能力研发，复用原实例、冻结 ProductRelease/Build、Session Zero、epoch、operation、候选和 Run 终验；所有世界引用与媒资 owner 不变。无新表、schema、上下文源、AI 字段或模型入口。原有 §35.44–35.46 的决策与过程记录原文保留。

- `resumeTtrpgOpenHostingV1` 只推进原窗口的真实有效委托，以现有账本和 owner 作为唯一状态机。每次明确调用最多 64 次外层推进；不在读取桌面、刷新或重新认领角色时自行运行。已批准的人类行动可沿原确定性结算继续；系统队友建议只走原委托提案入口，安全执行必须经过原 Session Zero 检查，KP 只采用实际已结算、共同可见资料的原候选。不增加新的玩家决定、Oracle/事实采用或世界写入。
- 原请求逐项恢复：`prepared` 只执行原 Run/request 的原配置约束请求；`dispatched` 等待，unknown/denial 交回核对；`succeeded` 先沿 §35.46 恢复原始响应和候选。已有其他明确人工候选不借委托自动采用。失败、拒绝、超预算或无法机械路由的结果保留，不能静默换人、换模型或新建替代请求。
- 原叙述已提交但 Run 终验未齐时，先恢复其确切 receipt；原 operation 的人类风险、参数、后果选择、私域审查、阶段收束和四门修复仍为停点。原预算与 AI 行动次数耗尽后交回真人，不自动关闭/重开 epoch，不扩大授权。已有安全计划按原结算推进，阶段关闭后仍可完成必要的已结算叙述。
- 所有确定性 owner 协调器传递可选的 `hostingDelegationRef`，正式命令的共同 operation caller 在真实提交处再次验证原委托。撤销发生在某次业务结果已经提交之后，不回滚该业务结果；后续自动提交被阻止，原 journal 留待真人恢复。旧人工调用不传新字段时沿原路径，旧事件/存档字节不改。
- 玩家桌显示明确的有限委托、每次调用预留上限、继续和停止。首次委托先保存真实事件、刷新其回执，再进入自动推进，使处理中仍有可用停止按钮。停止先持久化原委托撤销，回读确认后才中断本机等待，再补齐取消回执与未启动提案处置。只取消本委托确实未发送的请求，仍占用原计数；已派发/未知费用不清除。仅撤销无任何实际业务引用、无新人工批准、未继承的系统提案；已部分结算的计划和人工批准保留。停止决定失败时明确报告，不冒充已经停止。
- 本轮“继续”只复用仍有效的原委托；暂停或刷新后需显式点击，不自动启动。已正式停止的委托不可重新授予同一 epoch。新自动主持须由真人处理/结束原窗口并明确开始下一轮，不能借恢复重置预算。正常手工行动、候选逐条采用和独立真人 GM 路径保留。

工程验证推进中：本轮协调器专项已验证原行动加两名队友、三次 KP 叙述、风险回交、已准备/已派发/未知/成功断点、并发发送许可、停止后迟到响应、原规则已提交后停止及只读刷新；继承回归覆盖旧授权、候选、手动/私域/回放与结算。原生界面用本地拦截的模拟模型响应验证连续推进与处理中的停止，不读取真实凭据；正常作者生产到发布和开团的连接路径继续验收。自动测试、模拟传输、模块探针、完整 CI、真实模型和独立玩家/长局验收分别记证，不互相替代。P7–P10、规则问答、发行与完整验收目标保持。

同契约并发补充：相同冻结契约允许属于不同真实 Run，不能以 contractHash 的第一条匹配记录代替请求身份。共用只读解析器在遇到重合契约时核对实际 model.requested 与原输入 Manifest/Run 证据；桌面候选、取消、终验恢复和主持协调器使用同一选择结果。缺失或不能唯一定位时停止，绝不补造替代请求。回归通过真实并发准备重现“较早 Run 失败、较晚 Run 获得原请求”的场景，并核验完整备份/恢复后的桌面仍找到原计划与委托。

本轮工程证据：现行来源的 10 个相关回归文件共 81 个不同用例通过，其中协调器 13 个；重复执行的子集不累计计数。三条原生界面路径通过：一次委托完成原行动与两名队友、请求处理中先保存停止再进入未知结果、生产服务及两次作者复核 fixture → 本地正式发布 → 玩家分别同意安全约定与 AI 建议 → 确认本人风险 → 一次委托完成三次结算/叙述 → 刷新恢复。所有文本生成和网络响应均明确模拟，没有真实 provider 或独立玩家参与。

13 项直接检查、类型与静态检查通过；默认构建和隔离启用 open 预览的构建均通过各自包体预算。预览产物确认包含真正的请求/Manifest 完整性解析代码，实际构建的 state/open/adapters 模块正反初始化通过，模块探针仍仅为初始化证据。默认公开入口的实验性隐藏保持，完整 CI 继续在冻结来源上单独验收。测试曾因模拟 token 回执超出实际输入预留（2200 对 931）正确受阻、首次作者场景缺少玩家 AI 同意、以及模拟生产回复使用了另一套有后果的局势而回交真人；只修正明确模拟输入和测试场景，没有放松真实预算、同意或后果审查。


### 35.48 P7 正式情境筛选、分层预算与实际读取检视（2026-10-15）

本单元是跑团 open 产品能力研发，属于 S3 运行与既有 S2/生产交接的可选冻结策略；原作品/session 拥有作者指引、生产、运行证据及媒资，世界版本继续只读。三个新增上下文源仍由 CONTEXT_SOURCES 与 Context Gateway 收口，候选/采纳、PROJECT_TABLES 与已有 Run/工件生命周期不变，无新表、schema、AI 可写字段或模型调用入口。原文及 §35.47 之前的全部决策保留。

- 作者可在现有 openAuthoring 明确提供可选 contextPolicy，冻结上限、消费者、条件、接收范围、分组优先级、计时及 CJK 短语选择。缺省不展开新字段；编译器拒绝模型替作者新增、删除或改写策略。引用角色与谓词仍过现行冻结交叉引用校验。中文短语默认关闭，显式启用后按稳定 NFKC/Unicode 小写/空白规范匹配；拉丁文本保留整词边界。
- 新登记 ttrpgOpenActorContext、ttrpgOpenPartyContext、ttrpgOpenGmContext。按真实角色/共同接收者/GM 助手分离，先过滤权限再列目录；私密共同指引要求所有本次接收者均在授权集合中。GM-only 指引不能进入角色/公开 KP，party/public Oracle 咨询也不能借 GM 身份带入更高密级指引。sourceRefs 是已有来源类别依赖，不是假定某事实已读取；实际 provenance 指向冻结 Build/Release 字段与真实 runtime head。
- 正式 intent/companion/KP/Oracle/fact-normalize 均进入新筛选。条件只使用对应消费者的现行只读投影；未知条件包括 NOT/ANY/ALL 均不能间接命中，sticky 也不能越过当前权限。未提供可读投影的幕后时钟、社会余额、局势等条件目前关闭匹配，禁止把全量 state 填入模型或条件计算冒充支持。规则、知识、事实和玩家决定权不来自指引或历史叙述。
- KP 的共同知识由必读大包拆为真实条目，authority 的预警拆为选读；旧精确 resourceKey 继续可读。规则目录和当前权限保护，相关可选规则先由现行 Selector 选择，再按八层预算整层降级；token 与最大读取次数均有硬预算，规则/权限超限时零模型请求。最终文本只来自 Gateway 完整 JSON read，预算算法中的元数据占位字符串不发送给模型。KP 仅能引用本次真实交付的 action/来源条目。
- 延迟/持续/冷却从真实派发且保留了原始请求的记录重建，未发送取消不消耗计时，未知派发保守计入；持续期间的再读取不会无限延长原持续锚点。补上 sticky=0 不得绕过同轮 cooldown 的反例。计时按消费者、角色、接收集合、咨询密级、冻结来源及策略 hash 分域。
- E14 的记录函数 recordTtrpgContextAssemblyV1 已接入。实现裁定：沿既有 instance Harness 的 evidence.artifact.recorded 保存带 eventType=ttrpg.context.assembled 的输入诊断工件，绑定真实 requestHash、Run/attempt、Manifest、预算与实际条目，不另造可由客户端任意注入的产品 runtime 事件，也不因诊断递增游戏进度。此处替代原稿 E14 独立 product-event 的物理形式，保留“只记录、不改业务”的语义；旧 E14 表与历史设计仍原文保留。reserve/dispatch 复算筛选，finish 核对原始保留字节；伪造复制 hash 不足以通过。
- 来源可选 openReadSession 是 owner 创建的单次只读视图；共享 Gateway 只在显式执行边界使用，来源 ID/版本/种类不可替换，离开读取前必须复验 freshness。独立读取仍按当前权限验证。曾尝试把全部异步读取包进大只读事务，定向探针复现挂起，已移除该方案并保存失败日志；当前实现没有跨请求持久缓存或读取期间的写事务。
- 玩家桌面提供“查看最近一次上下文记录”，核对本人原请求/读取证据后展示层级、实际正文 token、预算及注入数量；刷新可读，身份切换清空，不展示另一人的指引或原文，也不推进游戏。作者方案复核页展示显式策略，制作 Prompt 要求原样保留。

工程证据：P7 权限/策略/实际请求/计时/预算/回执篡改、旧冻结 prepared 请求与当前 Skill 兼容、共享 Gateway、编译及确定性 replay 定向检查分别通过；原生浏览器验证真实记录读取/刷新/身份隔离/零业务写入，连续主持原三人协作与作者生产到发布路径仍通过。停止中的请求用有界 30 秒等待真实发送，停止按钮在准备期间即保持可用；原 5 秒等待不足已保留失败证据。传输为显式模拟，均不代表真实 provider、玩家或 30+ 回合验收。默认 open 入口继续隐藏，最终冻结输入的完整 CI/原生集合另行留证。

新增必须继续处理的反例：现代 prepared Run 通过完整项目备份导入且本地编号发生重映射时，现共享 ledger 会重绑 Run contract，而 runtime 中原 call 仍引用原 contract hash，二者无法安全对应。旧编号恰好一致的 golden 备份可以派发/完成，不能据此宣称跨电脑任意编号恢复通过。碰撞用例确认原 E14/输入工件仍在、原项目不变、零 provider 发送；当前以失败关闭保留证据，恢复链尚未闭合。该项需独立共享基础修复与联合回归，不能以重发或创建替代 Run 绕过。更完整的来源/触发明细体验与可读条件覆盖继续收口；P8 受治理长记忆/世界补丁候选、P9 扩展、P10 媒资与长局，以及 AI 规则答复、分发和真实验收仍属完整目标。


### 35.49 完整备份的原始运行证明与未发送请求恢复（2026-10-15）

本单元继续跑团 open S3 能力研发，并修复共享完整备份/导入的证据交接。世界版本和游戏机械、媒资 owner 不变；既有 agentRuns 增加可选 opaque portableRuntimeOriginJson，随 PROJECT_TABLES 的原生命周期搬运，无新表、索引、schema、模型入口或 AI 可写字段。原数字只作为已冻结历史字节中的身份，不是当前数据库外键，不执行 remap，不按它们查询其他工作区。

完整工作区备份在物理编号转换前，从实际 Run/契约、连续事件、原始输入及工件回执冻结有界来源记录。原契约/事件/raw response/Context Manifest 不重写，重复导入继续保留同一原始证明。导入验证闭集契约、真实事件前缀、工件原文/hash/字节数、原 Manifest 与工作区/World/Work/Run 身份及当前实例 owner；只允许当前契约的 Project/Instance 两个本地定位变化，写权限、Skill、目的、预算和其他内容不得变化。Workspace UID 冲突时现行导入规则生成新 UID，旧 UID 仍须匹配原输入的 UID；不能因为数字恰好相同而接受错误身份。缺证明的旧备份保持可导入与只读，不补造来源。合法裁剪 tombstone 可继续搬运和查看档案，缺失原文不能取得运行恢复资格。导出期间 Run 改变则明确要求重新导出，不能拼接不同切点。

此证明只定位历史 owner，不能单独授权模型发送、候选采纳或修改用量。本轮完成的正式恢复路径为：当前请求拥有者明确取消导出切点确实未派发的 prepared 请求 → 保存零发送/零用量终态与原 counted slot → 关闭或继续处理原窗口 → 当前玩家重新授权真正的新请求。原请求、原输入/证明和源项目保留，当前 Run 的取消写入中断后，玩家界面可补齐原回执，重复点击不重复记账。备用完成分支严格限于 prepared、无 dispatchRef、无 providerRequestId、cancelled-before-dispatch、无响应和零用量；已派发、未知、成功或伪造供应方回执不能沿此路径处理。旧 Run/hash 不作为发送或采用的通用 alias。

玩家可显式查看本人导入前的上下文记录，界面标注其为历史记录；取消和新的模型请求都需要明确点击。原生隔离浏览器已验证本地编号实际不同的导入、历史记录/刷新、明确取消、原项目不变与仅一次新授权发送，以及未知请求仍可见、无未发送取消捷径/零自动发送。供应方传输为明确模拟，不代表真实模型或玩家验收。

联动修复：世界封存的 caller-owned snapshot 只保留已有上层生产/运行证明，不进入这些 owner 生成新搬运证明；完整工作区备份仍生成并验证。这样世界语义冻结不等待上层运行账本，已有 opaque 记录保持原样。曾复现把含 DB 读取的整个恢复验证放进 Dexie.waitFor 导致挂起，已移除；当前仅对模块加载和单个纯 hash 保活，exact artifact 读取在现有事务中单独等待摘要。调用者拥有的世界快照正反例及真实导入均回归，失败探针原样留证。

工程证据分别记录：原始证明/编号及 UID 冲突/两次搬运/独立源/取消幂等及断点/合法裁剪/当前玩家/旧备份/事件与权限篡改/已发送与未知请求专项；共享实例账本、exact artifact、完整导出、原响应恢复、玩家服务与世界快照关联回归；最终冻结代码的完整 CI/E2E 另行验收。本轮仍不实现跨作用域直接复活旧 AI 候选或已付费响应采用；后者须明确复验/人工接手，未知外部结果继续保留并核对。P7 更完整检视与可读条件、P8 长记忆/世界补丁候选、P9 扩展、P10 媒资与 30+ 回合、AI 规则答复/分发及真实验收继续按完整目标施工，公开 open 入口仍默认隐藏。


### 35.50 导入后原始回答的只读复核与人工接手（2026-10-15）

本单元为跑团 open S3 能力研发，承接 §35.49。数据仍归原 ProductRuntimeSession 和 durable Run，世界引用及媒资 owner 不变；交接物是原回答的历史只读视图与已有人工行动流程。读取实际 Instance/冻结来源、当前席位与授权、原 Run 证明、原 model.requested/model.responded、同 attempt raw-response 工件及真实 call.finished；不调用模型，不建立新表、AI 入口或可写字段，不生成替代 AI 请求/候选/用量。CONTEXT_SOURCES、FIELD_REGISTRY 和 PROJECT_TABLES 的原职责及数据生命周期保持，不另开数据库或导入入口。

玩家和真人主持桌面只列本人原始成功调用的元数据；明确打开后才回读原回答及原用量。需当前仍拥有本人角色、队友审批或真人主持权限，历史身份不能恢复已失去的权限；人类只读权限不依赖再次授权模型发送。打开前后核对运行、原始工件、当前参与者和团局版本，异步期间发生变化则要求重新打开。原文按纯文本展示，身份/实例/团局切换时关闭已展开内容。原文缺失、合法裁剪、损坏、错误原 Run/请求、来源不明、未发送或未知结果不能冒充成功回答。实际费用无供应方回执时明确显示未知，不用 token 记录推定已扣款金额。

已收到回答但候选整理中断时，原文仍可复核；完整候选的原字节亦不被重写或自动采纳。所有带导入历史证明的旧 portable:false 候选，即使本地 Run/Project/Instance 数字偶然一致，也不能沿普通候选读取/恢复路径取得当前执行资格。此前已经采用或放弃的记录保持原样，后续明确拒绝不抹掉原成功响应；历史视图不会新增采用记录。

本轮打通的人工接手是：当前玩家复核原回答 → 明确结束原授权窗口 → 在既有“按规则手动行动”选择当前冻结规则与合法对象、亲自编辑说明 → 新人工授权与风险提案 → 本人确认后由原规则内核结算。查看本身与待确认提案均不改变角色机械状态；不重发模型，不重记旧调用用量，不替代来源证明。原项目和原回答完整保留。KP 人工叙述继续使用既有主持入口；涉及导入旧 KP Run 的替代终验回执，以及跨作用域重新验证并采用旧 AI 候选，仍须后续专门收口，不能把本轮只读恢复等同于它们已完成。

验证分层：专项验证正常/整理中断、只读无写入、重复查看、原文纯文本、跨项目/请求/Run/玩家拒绝、数字一致但 UID 冲突、参与者读取中变化、原文损坏/缺失/终态事件篡改、原候选已拒绝及新的人工风险提案。原生隔离浏览器验证导入原回复→刷新→再打开→结束旧窗口→手动规则提案，零网络模型请求，原项目不变。正常原响应恢复、人工行动、玩家与真人主持关联回归独立记录。完整冻结版本的 CI/E2E、真实 provider、独立玩家和 30+ 回合验收仍分别留证；P7后续与P8–P10、规则答复/分发等完整目标继续。


### 35.51 导入后真人叙述的停止回执与显式修复（2026-10-15）

本单元继续 open S3 研发，补齐 §35.50 留待收口的“旧 KP 人工替代终验”。原实例、原规则与冻结来源、媒资及世界 owner 均不变。真人先经现行正式命令保存本人的叙述；该实际 runtime 事件及 previousRequests 是停止原 KP Run 的唯一业务依据。不得创建替代模型请求、采用旧 AI 候选、清零原用量或把未知结果写为失败零成本。复用既有 Run/事件/工件、参与者和导入证明，不增表、schema、AI 入口或 AI 可写字段。

停止回执按真实 model.requested、输入 Manifest 和历史原始证明选择唯一 Run，不取相同 contractHash 的第一条记录，也不把旧 hash 建成发送/采用 alias。当前仍须是原叙述拥有者和合法真人主持；核对原叙述实际事件、原 KP 的目的/操作/请求及终态引用。每步使用原 Run 的 sequence CAS，争用有界可见。恢复只补原叙述的回执，不改已保存正文与机械结算。

导入已对含 portable:false 检查点的完整候选追加 run.cancelled 时，保留这一原终态，不改写为新的 failed。成功回答、候选/Manifest 已保存但检查点尚未写入的断点，原始证明足以定位后，可由已正式保存的真人替代叙述记录停止依据；若原账本实际已有同 attempt candidate.persisted，可闭合原候选的 reject，再停止原 Run。这里的拒绝仅结束旧候选，不能授权 adopt。原替代依据包含稳定人工 sourceRef、原请求/响应 hash，以及导入时的 originHash；后续只在当前 Run 追加事件，不重写历史候选、来源证明或输入。

“人工叙述保存成功、停止回执写入中断”必须在玩家和真人主持桌面可见，刷新和再次完整备份/导入后可显式补齐，重复操作不重复叙述/调用/用量。停止依据的工件也须按原 hash/原文回读，不能仅凭一条 artifact.recorded 事件宣称完成。缺少或损坏原证据时，保存过的人类叙述继续可见，并保留待修复状态；明确修复重新核对证据并报告原因。相同实例中不相干的历史请求，不因另一个请求原文已裁剪而失去 owner 定位资格；先匹配其原契约/请求，再读取该请求的原始工件。

专项覆盖完整旧检查点、候选检查点中断、回答整理中断、未知结果、未发送拒绝覆盖、替代依据写入中断、二次完整导入、原文缺失、原源不变、原用量/随机/机械/事实/知识/时间不变、幂等与真实事件回放。原生隔离路径验证导入后真人补写，以及证据缺失→保存正文→刷新→找回原证据→补齐回执→完成原行动，无新网络模型请求。完整累计 CI/E2E 与真实 provider/独立玩家/长局验收分别记证；P7 后续和 P8–P10、规则答复/分发等全目标仍继续，不因本单元恢复闭合而宣布产品完成。


### 35.52 当前项目 4.0 基线的联合集成与产品边界（2026-10-15）

本单元继续 open S3 产品研发与项目集成。独立交接包的应用基线 3.9.1 仍是历史事实；当前组合基于正式 TTRPG 分支 2bda43a 与 main a27ea30e，项目应用版本为 4.0.0。TTRPG 内容协议仍按既有 V1 scripted/V2 open 分读，不因应用版本变化重写旧包；schema v11、128 表保持，记忆阶段不在本次提前迁移。

当前归并保留主线其他产品的更新，并延续既有 World/Work/production/build/release/session owner、冻结世界引用与产品媒资归属。完整 ledger 导出同时保留主线按 Run 分桶的性能约束与本方案的导入前来源证明；caller-owned 世界快照不得生成上层新证明。生产 Plan 同时承接文字冒险内容修订协议与跑团 open DAG，不能用一个产品的实现替换另一个。

共享恢复继续用原 Run 冻结的 Skill/执行身份核验旧结果，不能用今天的 Skill 重解释历史调用。导入恢复对文字冒险、文字开放世界与跑团都检查实际文本/媒资内容、作用域、原 Manifest 与封存包 hash；重复输出 key 不可冒充完整任务。跑团须另外复验被沿用的原始 producer，不改原始字节来源。文字冒险视觉合同保留其已验证的独立素材继承路径，跨 epoch 只处理其余 epochCarryKeys；跑团 pendingPlan 参数只在跑团传递。

跑团原先新增的“已发布 Build 整体 envelope 只读复验”约束现限定为 ttrpg。其他产品按各自现行本地 receipt 重绑生命周期执行，仍受共享 manifest/package/preview/quality 不可变校验。不能把跑团的私有生命周期条件扩展到所有产品，也不能为消除冲突而删除共享的字节校验或主线已有恢复保护。

联合验证必须区分：原独立包冻结验证、当前 main 组合的类型/注册表/文档/定向正反例、当前组合的默认/preview 构建及真实页面路径、完整 CI/E2E、真实 provider/独立玩家/长局。原独立冻结结果不能替代当前组合验收。文字冒险已发布作品的完整备份恢复与文字开放世界全 DAG 恢复作为共享接口反例；跑团验证作者生产/素材继承/导入来源与 runtime 接手，并继续保留旧 scripted 路径。先形成可复核的集成分支与验证，再继续 P7 剩余检视/条件、P8–P10、规则答复/分发和真实验收；公开 open 入口继续默认隐藏，未据此发布或部署。


### 35.53 P7 实际资料与触发依据检视（2026-10-15）

跑团 open S3 运行能力研发。入口为玩家桌面的“查看最近一次上下文记录”，实例拥有原请求、输入 Manifest 与读取证据；世界/媒资 owner 不变。本单元没有新增模型读取、AI 写入、表或 schema，复用原 Context Gateway/Run 精确回读与完整备份生命周期。

原记录经过真实 Run、原请求字节和实际 source-snapshot 核对后，逐条展示实际交付资料的类别、登记来源、正文 token 与冻结作品/授权读取来源，另列实际采用指引的文字/可见条件/同时满足/固定/持续期依据，以及正文预算与读取条数上限导致的层级省略。只从原回执投影，不重新执行触发器，不获取当前全量目录或省略资料；不向玩家输出作者私有键、指引正文、其他 POV 的名称、原资源标识。

刷新保持原证据，切换真人身份清空；跨电脑完整导入可检视原始回执，但检视不恢复发送权限或授予新模型请求。零业务写入、不推进时间。条件求值继续仅使用本次接收场景已经允许的投影，未读/隐藏操作数含 NOT/ANY 均保持 unknown 并跳过，不能借触发与否探测秘密。更完整的可读条件覆盖、P8–P10 与完整真实验收仍按原目标继续。

本单元定向正反例 4 条通过，覆盖实际条目/预算省略、刷新/身份隔离、跨工作区导入与原工件篡改拒绝。原生浏览器 1 条通过，实际展开资料与触发详情并刷新/换人，确认游戏状态不变；使用工程 fixture，没有真实 provider/独立玩家参与。最终直接检查、构建与累计 CI 分别留证，未据此公开入口或部署。


### 35.54 P8 唯一记忆表的治理基础施工（2026-10-15）

产品为跑团，生命周期为 S3 运行能力研发；实例拥有记忆，世界版本只读，媒资 owner 不变。此次先建立共享迁移/备份基础，再接产品事件、候选采用与召回。前文旧快照数字保留为历史，不得照搬原稿10→11重复创建表。

- 原基线记录：- 当前 schema 为 **v11**，`STORYFORGE_STORES_V10` 已固定，v11 包含插件扩展表；备份/导出当前版本为 v15（来源 `src/lib/export/backup-trust.ts`、`registry-export.ts`）。原稿 v10/123 表及 P8 的 10→11 已过期。本轮不改变 schema 或备份版本。
- 当前增量固定 v11 全部128张表的原定义，v12只新增唯一记忆表，注册 PROJECT_TABLES/REQUIRED_TABLES；原稿 `worldGroupId:number` 改为与现行实例一致的 `number|null`。无新 AI 读写入口，FIELD_REGISTRY/CONTEXT_SOURCES 不以空登记宣称功能已可用。
- 便携备份 v16。完整 v14/v15 先按其真实表集核验，再只补后续新增空表；不得夹带未来表或吞掉缺失旧表。新表按真实实例、World/Work 与原实例引用转换编号，闭集字段与 observer/reliability、区间、未来事件、重复版本和作用域反例拒绝。原始 hash 和私密边界不改写。
- 当前仍是存储治理基础，正式 memory recorded 事件、CreativeArtifact 候选/作者 adopt、按 observer/reliability 的渐进召回、分支切点与祖先保留/删除后稳定来源核验，以及世界补丁候选导出仍须完成。`sourceSessionId` 的本地引用清理不能代替稳定证据，也不能把导入结构校验冒充事实采用。未接通上述合同前不启用正式记忆读写；不发布、不部署、不改变 open 默认隐藏。

工程证据以本单元最终回执为准，不沿用 P7 快照 CI。迁移验证必须包含原稿/插件保留和真实 IndexedDB 建表失败的原子回滚、重试；备份验证包含当前非空记忆与旧版空转换的正反例。此前 DATA-GOVERNANCE §7 的 v4 描述已按当前分支更新，旧 Work-owned 与纯加表决策仍保留。


P8 基础联测补充：共享账本在明确 `freezeContextEvidence:false` 的数据型重导出中，不再要求原 Run 的物理编号映射，也不生成或升级原来源证明；默认真实工作区导出仍须匹配原 Run 映射才可冻结新证据。主线多 Run 线性分桶回归原先只传便携映射，现明确走数据型协议，并追加“要求冻结但没有原映射仍拒绝”的反例。保留乱序数组身份、线性键读取上限及 worldGroup 损坏检查。此兼容问题由联合测试发现，原失败证据保留，修复与 P8 表迁移分为独立基础提交；不能借数据型转换取得任何发送或采用权限。


### 35.55 P8 人工记忆确认与稳定事件区间（2026-10-15）

本单元是跑团 open S3 运行研发。ProductRuntimeSession 拥有记录、确认回执和唯一记忆投影，WorldRelease 与媒资 owner 不变。新增人工领域命令 `recordTtrpgOpenNarrativeMemoryV1` 与本人档案读取 `readTtrpgOpenNarrativeMemoriesV1`，复用真实冻结来源、Session Zero/席位同意、事件回放和三注册表生命周期。当前是引擎/API 增量；用户界面、AI 候选/adopt、注册上下文召回、世界补丁和完整长局继续开发，公共 open 入口仍默认隐藏。

- E15 使用原计划名称 `ttrpg.memory.recorded`，同步登记权威事件闭集与 FormalTtrpgEventType。payload 包含 commandId、memory、sourceLineageHash 与原意图；memory 是闭集的可搬运确认回执，包含 draft、原始来源、实际作者/接收者和原区间。事件、记忆行和 runtime head 在同一事务提交。相同 commandId/基线/意图重试返回原事件，改变同一确认或覆盖已有版本拒绝。规则、资源、时间、事实、知识和 AI 用量保持原状态。
- 个人观察/传闻/信念由实际真人本人确认；共享或主持记录由实际人工主持确认，保留本桌记录同意。private 由原观察者明确选择当次知悉角色；只向本人选择的合法同桌角色/主持展示，保留原观察者与可信度。将其他角色列为观察者、借 GM 代写玩家内心、越界接收者或隐式分享拒绝。party 接收者冻结为当次真实活动角色。人工读取不依赖 AI 建议权限，也不授予模型读取该表的权限。
- 来源用稳定 sessionKey+sequence、确认事件、sourceLineageHash、冻结 runtimeSourceHash 与实际完整源事件区间绑定。区间最多1000个完整事件，超过时明确拆分，不默默裁剪。确认前完整重放真实事件并核对当前基线，再计算区间 hash；事务内比对完整原前缀，包含摘要区间之前的授权事件，防止中途改变；没有网络/散列等待跨越写事务。sourceSessionId 只作本地定位，清空后仍以原稳定证明核验来源。
- 已登记的 envelope.sessionId 是唯一会在便携导入中改写的运行 payload 定位。记录同时保留原语义摘要与将该定位归零后的摘要，其余正文、密级与语义都继续验签；错误实例定位拒绝。祖先仅在存在记忆时增添可选便携摘要，旧无记忆祖先和旧状态保持原序列化形状及 hash。
- 分支以真实回放切点中的已确认回执复制记忆，校验原表与回执，排除“区间已结束但尚未确认”的未来笔记。原父子事件坐标不混用；父团局删除后由封存祖先的事件摘要与确认回执验证，支持多代分支与反复完整导入。分支事务所需实例表从 PROJECT_TABLES owner 派生，表写失败回滚整个子团局及席位复制。旧 scripted 分支继续原解析路径。
- 新备份验证在写库前回放有关实例，核对真实 E15、源事件/祖先、记忆行、唯一版本及完整投影。仅结构有效的行不能作为已确认记忆导入；缺原证明、篡改正文/可信度/区间、错误 owner 或来源定位均拒绝，原项目保留。
- 原型 `isTtrpgNarrativeMemoryRuleEligibleV1` 原先仅排除 belief，允许观察/传闻摘要作为规则输入；现统一保持摘要为叙事参考。规则裁定继续读取原始知识/事实台账，摘要保留观察者、可信度和时间标签供角色参考，不产生新的事实或证据授权。原型旧判断保留在 Git 历史，本节为现行裁决。

三注册表边界：PROJECT_TABLES 继续派生导出/导入/删除/重映射；ADOPTION_EXTENSIONS 登记人工确认与分支领域写入口；当前没有新增模型可写字段、Prompt、Skill 或 CONTEXT_SOURCES，正式 AI 路径必须在下一单元先登记 summary 候选/adopt 与 consumer-scoped 读取，不能把人工命令当作模型写回旁路。

工程证据以最终日志/回执为准。已完成源区间/幂等/原业务不变、本人隐私、存储失败及提交期间来源变化回滚、切点前后、多代父子坐标、祖先删除、重复完整导入与篡改拒绝的定向测试；真实浏览器/API 使用隔离 IndexedDB 验证实际事务失败/重试、私密隔离、刷新、分支与两次完整导入，无模型请求。它们不等于真实模型、作者/玩家界面或完整产品验收。完整 CI/E2E 仍须对应当前冻结 head，旧 P7/存储基础快照不能代替本单元。

纯模块 `recordTtrpgNarrativeMemoryV1` 保留为离线内存评估，正式写入使用本节的 `recordTtrpgOpenNarrativeMemoryV1`。纯模块旧 `sourceLineageHash` 形参是 `derivedFromHash` 的兼容别名；正式回执分别保存稳定祖先链 hash 与确切事件区间 hash，不能混用。


### 35.56 P8 玩家与真人主持的冒险记忆桌面（2026-10-15）

继续跑团 open S3 运行能力研发，owner 与 §35.55 一致。玩家和真人主持确认身份后，可在“冒险记忆”查看本身份允许的记录，手写亲历、传闻或推测，明确本团事件区间与公开/全队/指定角色/主持范围。本人始终保留原观察者，不能借界面替另一角色定义记忆；共同桌面记录只有真人主持可确认。

桌面读取先验证冻结来源、实际席位、原确认事件和唯一投影，再返回本身份可见的正文、原可靠性与接收者。切换身份卸载旧视图与未提交文字，异步回读有序号保护；主持身份也不因此获得其他角色私记。这个人工读取器含真实人类主持权限，不能用于模型角色召回。

保存沿具名领域服务进入原 E15 原子命令。首次确认锁定本人提交标识、所见基线与完整草稿，失败后保留同一提交可明确重试；变更进度或文字须明确重新准备，不隐式改基线或重复保存。错误作用域、附加模型来源字段、越界范围或失效授权拒绝。保存不推进世界时间、不发模型请求、不改变事实/知识/规则结果。页面仍在原实验性 open 桌面内，未新增公开入口。

工程验证包含真实表写失败→原事务回滚→界面同提交重试、玩家私密/指定分享、未保存文字随身份交接清空、主持私记/全队记录、刷新恢复；另有领域服务的准确重试/篡改/跨作用域/模型来源拒绝反例。使用隔离 IndexedDB 与明确工程夹具，不代替真实作者、模型、独立玩家或长局验收。AI 摘要 CreativeArtifact 候选、正式采用与 consumer-scoped 注册召回、世界补丁/P9/P10 继续施工，原产品完成门保持。

累计检查联动补充：全表备份安全网现在通过真实 open 授权与 E15 种下非空记忆，不能用孤立行冒充已确认记忆；P7 归一化测试逐条核对原 Oracle/已接受解释/权限合同与情境合同的准确资源，替代过时的三个资源假设。漫剧的 v11 最低兼容约束允许后续纯加表升级。Gateway 工具的 Provider 读源来自注册表，新增 P7 来源已实际改变工具 schema；共享基础单独冻结 `agent-read-tools-v12` 及真实规范 hash，新合同用现行版本，旧 V2 冻结定义仍按原完整性验证。旧失败日志保留，后续完整 CI 不能用单独修复用例代替。


### 35.57 冻结规则内容的纯解析复用与回放开销（2026-10-15）

继续跑团 S3 长局能力研发，实例/世界/媒资 owner 及三注册表权限不变。覆盖率长流程出现超时后，以真实隔离 fork 和 CPU 采样定位压力/局势读取中的重复整包解析；十轮路径有大量相同冻结内容重复校验。保留原时限及失败日志，不通过放宽时限或减少回放/授权检查处理。

结构解析只按实际输入的完整数据属性快照、来源世界 hash 和协议建立有界缓存，最多8项、单份输入预算有界；不是按调用者声明的 contentHash 或可变对象身份放行。访问器、符号、隐藏字段、稀疏数组、特殊对象等不进入缓存，沿原解析器裁决；快照与缓存键来自同一次读取，拒绝在检查中改变输入后污染旧键。外部 source/RulePack/index hash、实际世界版本和权限复验保持原调用链，解析复用不授予任何读取、写入或采用权限。

普通内容解析仍返回独立可修改副本。压力和局势封存字段使用独立只读解析入口：只有系统自己完成结构校验、复制并逐层冻结的结果，才能通过内部弱引用复用；外部自行 freeze 的对象不具备该证明。克隆或实际字段变化会重新按完整内容检查。运行状态、循环进度、资源、事实、知识与候选继续每次求值，未缓存或跳过；冻结内容的 JSON 形状及事件序号不变，无 schema/迁移/备份版本变化。

回放构建分组补齐记忆契约/事件摘要/证明/reducer 与纯解析模块，保持 state→open→adapters 的单向依赖及既有包体预算。针对可变副本、实际内容变化、错误世界/协议、结构反例、缓存淘汰、输入变化、负零、深层只读和实际 hash 拒绝验证；压力/局势/KP 长流程仍按原覆盖率时限复核，结果以本轮最终日志为准。完整当前 head 的 CI/E2E、真实模型与独立玩家长局仍须分别通过，不能以性能专项代替完整验收。


### 35.58 测试事务调度的有界保留（2026-10-15）

隔离覆盖率诊断确认 fake-indexeddb 6.2.5 的已结束事务留存会拖慢原合作流程。测试 setup 采用锁定版本及内部形状检查的辅助器，仅稳定移除 `finished` 调度条目，保留其余事务与顺序，支持恢复原 Factory 方法，不改共享依赖文件或生产数据库。未放宽超时、减少参与者/轮次/断言，未删除运行事件或业务回执。

公开 IDB 的串行/并发、显式 commit、abort/约束错误回滚、升级阻塞、删除重建、恢复/借用/重复安装与形状反例共14项通过；与原主持、KP、压力用例在实际 CI 覆盖率模式联合48项通过。专项覆盖率不是全仓覆盖率验收，完整 CI 与外部体验仍按原门执行。

### 35.59 P8 模型记忆来源的独立权限基础（2026-10-15）

继续跑团 S3 产品能力研发。团局持有唯一记忆表、E15 与原确认来源；世界引用和媒资 owner 不变，无新增表、迁移或 AI 可写字段。人工桌面与模型来源共用可信读取证据：从实际事件回放，核对确认回执、完整来源区间、祖先证明及唯一表投影；读取结束复核原事件、原行、实际席位、冻结来源与状态。自行修改并重算缓存 head 不会取得记忆权限。

注册 `ttrpgOpenMemory`（活动玩家/队友）与 `ttrpgOpenPartyMemory`（共同叙述），先验证当前开团、冻结作品模型许可及实际席位/同意，再过滤目录、搜索正文、计数与游标。角色只读明确接收范围，GM 私记不会随真人主持身份进入角色模型；共同叙述只有在每名当前接收者均获准时才可读指定分享/旧全队记忆。NPC 尚无独立授权合同，不借玩家角色入口读取。

记忆逐条保留观察者、亲历/传闻/推测、原接收者、稳定来源、祖先标记与世界轮次，权威固定为 `derived-summary`，不授予规则或知识权威。正文按完整 JSON 原子读取，预算不足拒绝，禁止原始 head；搜索可命中摘要后段，不能以目录短摘要裁掉相关性。新来源可与现有角色/KP 来源组成同一冻结 Gateway 读取会话；阶段记忆允许在未进入结算叙述时单独检索。

注册表实际改变 Gateway 工具来源，现行工具冻结为 `agent-read-tools-v13`，规范 hash 为 `d2bc29573468ed03e0be09af4076bbc17e321a33899d5456dcd47803a73b423f`。本基础提交尚不向既有 Skill 增加记忆授权，不改已准备/已派发调用的历史来源；实际模型召回、摘要候选/采用与世界补丁在后续产品提交接通。新来源边界、跨身份/作用域/查询游标、真实行/事件/缓存篡改、旧合同恢复、分支切点和备份重映射均做独立反例验证；公开入口和真实长局验收门保持。


### 35.60 P8 正式请求中的按需记忆召回（2026-10-15）

在 §35.59 已验证的来源基础上，新建的玩家意图/队友 Skill 升为 v4、KP 叙述 Skill 升为 v3，明确登记各自角色/共同记忆源、输入合同和完整 Gateway 权限。Oracle/事实归一没有新增记忆授权。读取只选择允许的元数据资源，正文仍经 Gateway、实际源快照和 Context Manifest 交付，不在组件或 Prompt 中拼接记忆表。

按当前输入在已过滤的记忆目录进行有界词语查询，检索覆盖正文后段；查询工作量是检索保护，不作为历史正文截断。命中仅影响现有选择器排名，最终来源描述、正文与 hash 仍是真实资源。记忆先受独立预算和完整资源选择限制，再进入八层预算的 `memory-summary` 层；单条超长记忆可整条省略，小条相关记录与不可降级规则保留。不会把所有历史记忆镜像到 Prompt，也不会因记忆过长截断 JSON。保留原观察者/可靠性的明确模型指令不代替确定性权限和来源校验。

旧基础、P7、P8 三代冻结来源分别按准确白名单验证，不为已准备/派发请求添加新权限。使用 §35.59 提交生成并压缩保存的真实 P7 运行快照，在相同本地持久身份的应用更新场景继续原请求，保留原 Skill、原请求与三项来源；备份导入仍走原历史复核/人工接手约束，不能通过测试或运行接口删除 portable origin 来绕过。

工程回归检查实际角色消息、队友明确分享、真实结算后的 KP 全队交集、长摘要后段、整条预算省略、一次原始回答/候选回执、规则/知识/记忆表不被召回改写，以及两代旧请求的恢复。隔离浏览器路径使用原生 IndexedDB、原确认事件、正式输入与一次明确工程响应，刷新仍保留原记忆；这不是外部模型或玩家体验验收。AI 阶段复盘摘要候选/采用、作者世界补丁审阅、P9/P10 及原真实联合验收门继续施工。


### 35.61 与当前 4.0.1 项目基线联合（2026-10-15）

按现行协作流程获取并正常合入 `origin/main@e8ce0a0d`。保留主线的本地故障摘要、显式反馈与启动/便携分发诊断，应用版本随主线为 4.0.1，未替代或回退本分支的 schema v12/129 表、备份 v16、冻结工具 v13 和跑团权限。唯一文本冲突位于自动工程指标区，使用原生成器从联合源码重建，不手工取一侧旧数量。代码、依赖声明、其他产品与用户现有数据不删改。这个开发分支同步不代表合入 main、部署或完成联合验收；当前提交的完整 CI/E2E 及真实长局门分别保留。


### 35.62 P8 阶段复盘的共同来源基础（2026-10-16）

继续跑团 open S3 产品研发，团局/冻结世界/媒资 owner 不变，无新表或正式可写字段。注册 `ttrpgOpenBriefInput`，为后续 `open-brief` 提供独立于当前 KP 结算叙述操作的真实阶段资料；现有 Skill 没有因此获得新来源，也尚未新开模型请求或允许复盘保存。

读取从真实事件回放和当前本桌同意开始，复用每名活动玩家的既有投影，逐条求共同交集。冻结初始观察保持 release-time，会话事实保持实际已确认来源，知识保留亲历/传闻/信念原标记，保存叙述仅标为 narrated 及原人类/模型来源。主持阶段收束私记、时钟/效果计划、私人发现、人物私密资料、原响应和 raw head 不进入目录与正文；未知观察者不补造为某个玩家。原记忆仍经已登记的共同记忆源读取。

阶段语义正文与实际读取序号分别保存：授权 epoch、E14 与模型请求记账推进读取证据，但不改写同一游戏状态的复盘正文，避免请求刚完成预留就因自己的记账而 stale。真实资料/进度/接收者变化则使读取会话和游标失效。角色、共同叙述、复盘共用具名读取标识函数，保留既有 actor/KP 指纹；共同记忆与复盘可组成同一个冻结 Gateway 会话，阶段读取不伪造 KP 操作。

工具声明由注册表实际重算为 `agent-read-tools-v14`，hash 为 `1c0d4e982829684db8336c4ad438da9ee89e35b6c760cf1a9e0cb50503d6bddd`；不改旧冻结绑定。共同资料仍是渐进目录和独立完整 JSON 资源，过小预算拒绝，禁止原始读取。下一步接入明确复盘授权窗口、正式 Skill/Harness、CreativeArtifact 与保留模型来源的确认回执，不以这个读取基础冒充 AI 摘要/采用或 P8 完成。


### 35.63 P8 复盘的专用授权与引用输出合同（2026-10-16）

继续同一 S3 运行能力，复盘请求明确使用 `request-brief` 被动窗口，保留唯一 active epoch、真实真人主持与本桌记录同意、原输入、原预算及事件来源。该窗口最多一次模型请求，AI 行动额度为零；普通玩家意图/KP/队友不能借用复盘窗口，复盘也不能借用普通行动窗口。行动计划/操作、Oracle、人工行动与主持委托在命令、解析和回放边界收口。阶段实际完成后可在 closed 状态请求复盘，不重开阶段或推进时间；未完成行动/继承恢复、未决原请求及未获冻结 AI 许可则拒绝。旧两种窗口与原冻结预算按原值验证。

复盘输出闭集为带引用的段落，限制完整段落/总正文预算，不截断为有效 JSON。来源归属仅从本次实际完整读取生成，目录项、其他 Provider、未交付条目、重复引用/冲突身份、接收者不完整或要求额外权威的资源均拒绝；模型不能输出或重标观察者、亲历/传闻/信念、作者来源和规则权威。来源正文 hash、原来源坐标与人类/模型来源单独保留，阶段/冻结初始观察/知识/会话事实/保存叙述/记忆分别按真实类别验证。200字符的合法记忆版本身份仍完整可引用，不能通过裁剪混淆身份。

这些合同为正式 Skill/Harness 和确认写入提供前置边界，尚未登记新复盘模型入口或允许模型记忆采用；不是 AI 复盘功能完成声明。后续生成须使用真实 CreativeArtifact/原始响应/Manifest，并新增明确模型来源的 E15 确认和终态恢复，不能走人工记忆接口重新标记。


### 35.64 P8 正式阶段复盘候选与原请求恢复（2026-10-16）

继续跑团 S3 运行能力研发。`prose.ttrpg-open-brief` / `ttrpg.open.brief` 只在真人主持主动开启的 `request-brief` 窗口运行，准确读取 `ttrpgOpenBriefInput` 与 `ttrpgOpenPartyMemory`，不借用行动/KP/Oracle 权限，不创建规则、事实、知识或世界写入。保留原有 scripted 与冻结的历史来源代际；新复盘只接受这一准确来源组合。

复用现行输入、Context Gateway、durable Run、原始响应、CreativeArtifact 与候选恢复。可选共同资料通过登记 Provider 的受限元数据检索、原有 selector 与分层预算选择，引用目录由实际完整读取字节派生；引用 hash、原观察者、可靠性和来源进入候选。复盘不消费作者情境 trigger 的时机/冷却，自己的 domainHash 与 KP 分开。请求中明确当前共同快照不是完整事件实录，发行时观察不是现状，叙述/记忆不是已确认事实。

回答先保留原始字节，再检查闭集段落与实际引用。无效引用保留需修订候选，不自动重发；候选证明再次从原始完整来源与原回答派生，不能拿自己填写的引用标签证明自己。已准备请求可刷新后继续；成功、失败或结果未知的请求不能再次派发；原输入、来源、权限或预算变化在实际发送前拒绝。导入的历史请求仍不能获得新发送/采用权，历史原回答标签增加“阶段复盘”。

本单元交付正式生成与候选引擎，尚无模型记忆 E15 确认、终验或用户操作面板；不通过人工记忆 API 重标模型来源。工程适配器的自动测试与隔离浏览器证明请求/候选链，不是外部模型、真人短局或30+ worldTurn 验收，P8其余部分/P9/P10及原联合完成门继续实施。


### 35.65 P8 模型复盘记忆的明确确认与可恢复终验（2026-10-16）

继续同一跑团 S3 运行能力。`acceptTtrpgOpenBriefMemoryV1` 经登记的专属领域采用边界确认原正式候选，人工手写记忆接口仍只接受原 V1 human-authored 合同。模型确认使用明确的 V2 model-reviewed E15，保留原 request/epoch、Run Contract、输入 Manifest、原始回答、候选 hash、逐段引用和实际完整来源的观察者/可靠性。复盘本身按主持转述（gm/hearsay/party）保存，同时保留每个原来源的性质，不能将英雄的 belief 或旧叙述升级为客观事实。后续复盘再引用模型记忆时，继承有界、去重且不递归嵌套的原始来源列表，继续保留最初的观察者与可靠性；超预算仍整条省略，不截断来源身份。

确认前从实际保留的回答与完整来源重新推导候选证明，并用原情境选择合同复核当前来源；权限、全桌记录同意、活动被动窗口、原输入/接收者/当前资料或候选拒绝变化会使确认失效。E15、唯一记忆行与运行 head 在原领域事务中一起追加，原始模型/事件证据在事务中复核；任何物化失败全部回滚。同一候选的确定性提交身份只能对应一次 E15，重试返回原事件并补终验，不再次发送或写记忆。终验复用 KP 的共享 durable 采用/验证收据流程，KP 原引用/委托/哈希保持不变；已提交但回执中断明确报告待恢复。

V2 来源区间完整覆盖原请求快照前缀，从第1个实际事件到冻结输入基线，以有序可搬运事件链根压缩记录，不使用“最后1000条”冒充完整来源。校验对每个 origin 的实际完整前缀重算一次；原 V1 手写记忆保留完整逐事件证据与1000条上限。该链根证明来源连续与未变化，并不表示模型读过全部事件原文；模型仍只使用 Manifest 明确交付的共同快照/按需完整条目。备份只归一原有登记 envelope 实例定位，任何语义、顺序、缺项或来源变化拒绝。

唯一记忆表、schema v12和现行备份格式继续复用，无新表和新媒资 owner。召回的 V2 正文明确携带 model-reviewed、原段落/来源标记与模型原始出处，供下一正式输入读取；人工 V1 来源字节不变。分支按确认切点复制，保留实际祖先证明，删除祖先与多次物理 ID 重映射后仍能读取原记忆。分支保留专用被动预算，但继续要求在新分支重新确认 Session Zero，不能沿用祖先授权直接行动。

当前为引擎/API 交付，用户主动请求/审阅/保存/拒绝/恢复界面继续实施。工程适配器、合成超过1000事件的来源校验和隔离浏览器验证，不替代真实30+ worldTurn、真实 provider、真人体验及产品整体完成门；作者世界补丁审阅/导出、P9/P10继续施工。


### 35.66 P8 主动复盘、明确审阅与记忆保存桌面（2026-10-16）

继续同一 S3 运行能力，正式复盘面板接入原真人主持桌面和 AI-GM 下承担主持职责的真人桌面；其他玩家不获得主持复盘面板或其未提交文字。面板沿实际当前身份挂载，交接后清空未提交要求；读取/刷新只回读原请求、候选和回执，不发送、不修复、不采纳。手写记忆与 AI复盘标明来源，原有私记与明确分享流程保持。

用户明确填写复盘要求与调用预留上限后，才创建原专用被动窗口和正式请求。可继续原来尚未发送的请求、明确取消未发送请求、查看每段实际来源/原可靠性和原回复、确认当前版本、放弃或补齐已保存记忆的终验回执，再明确结束本次复盘。未知结果只保留原记录和核对提示，不提供重发按钮；主动停止在原账本留下实际终态。生成/保存/结束分别有实际持久化回读，不把一次点击等同于完成。

面板的展开状态在进度更新后保留，避免成功候选在刷新时被折叠隐藏。普通行动/连续主持在被动复盘期间不能借用其入口或额度，复盘状态与失败请求由自己的面板展示；不把其错误标为行动建议。阶段已收束的底层复盘许可保留，不重新推进游戏时间或写世界。模型格式错误使用复盘专属反馈，原始响应继续保留供审阅。

记忆表沿用唯一领域扩展行，人工 V1 与模型 V2 分别受原手写来源/正式候选证明约束；保留原扩展 ID，模型不取得人工旁路权限。完整桌面启动发现并修正重复 target 登记，启动 `validateRegistry()` 的唯一性门保留，并在本单元定向回归直接执行；架构静态检查或纯 API 测试不能替代真正启动。

验证覆盖真实桌面上的主动请求（隔离模拟 endpoint）、来源标签、刷新不发送、保存终验中断/补齐、放弃、取消、主动停止及身份交接，连同原人工记忆桌面回归和手机宽度检查。fixture/模拟 endpoint 不是外部模型或独立真人/30+worldTurn验收；公共 open 入口仍为开发预览并默认隐藏。世界补丁审阅/导出、P9/P10、完整联合 CI/E2E与原实体验收门继续实施。


### 35.67 P8 已确认事实的世界补丁审阅与可搬运导出（2026-10-16）

本增量是跑团 open 的 S3 产品能力研发。ProductRuntimeSession 拥有会话事实及其派生审阅文件；WorldRelease 保持只读，媒资 owner 不变。原稿 §5.6.2 的数值 sessionId 草案由有版本的 `storyforge.ttrpg-world-patch-review` V1 取代：冻结实际 WorldReference、ProductRelease UID/身份、SourcePlan/SourceManifest/开始确认/发行 lineage/Build hash，保留 sessionKey、祖先切点/封存 hash、原确认和 Oracle 的限定来源、原事实与确认 hash。物理本地 ID 不进入文件；世界 locator 固定为 0，不以标题或本地行号重新制造来源。

真人主持桌面提供逐条选择、私人事实与 GM 秘密的独立明确勾选、冲突/差异与原依据，以及 JSON 下载和文件回读。默认只列全队可见且未退休的权威事实；玩家、AI 主持的开团确认者、真人 GM 各自沿实际 Session Zero/claimed 席位读取。房主/确认者不继承 GM 真相权限；只有真人 GM 能明确加入 GM 秘密。会话记忆、信念、未采用模型提案和 Oracle 原始解释不会冒充事实。未勾选事实保留 pending 决策，不代表世界采纳。

导出复用原事实账本、事件回放、冻结来源核验与现有注册生命周期，不新增 AI 入口、上下文源、可写字段或数据表。每次提交前重新核对可见范围、当前进度、原事件与来源；变化要求重新读取/选择。分支使用限定到 session 的原坐标，父会话删除和备份重映射后继续核对祖先封存。初始状态差异与不变量冲突沿现有事实谓词比较函数生成，保留对照，不在导出时改写或放宽运行事实门。

正式补丁导出要求团局实际绑定已发布 ProductRelease 的完整来源合同。制作预览明确提示先完成作者审查与发布，再从该发布版本开局；不合成预览缺失的 SourceManifest/发行证明。文件按闭集 schema、版本、选择、受众、来源切点、原确认与内容 hash 回读；独立文件只能证明内部完整性，不能认证发送人、外部事实真伪或授予世界写权限。可另与可信冻结来源做严格比对。后续世界变更仍须世界作者显式创作、经普通候选/采纳路径形成新版本；导出或回读没有任何世界/团局写入。

定向回归覆盖真实冻结世界、正常生产与作者确认/发布链（明确工程模型适配器）、权限/跨项目/私密勾选、退休与记忆排除、pending、原记录与文件篡改、stale、分支父删除及完整备份重映射。隔离浏览器覆盖实际下载字节、回读、秘密范围、刷新和身份交接；工程适配器不代表真实 provider、独立真人或30+ worldTurn验收。全量检查与原联合验收保持独立，P9/P10和真实长局继续实施。


### 35.68 P9 局势候选的闭集合约与真实来源预检（2026-10-16）

本单元属于跑团 open S3 产品研发，先冻结 session-owned 局势候选的系统身份、来源、权限与静态预检合同，不启用模型生成或采用入口。WorldRelease、ProductRelease、冻结作者模板与媒资 owner 不变。`storyforge.ttrpg-open-situation-proposal` V1 只接收模板正文和 `personalizationSourceKeys`；没有模型可填的 templateKey、授权/采纳标记或来源证明。系统按真实 sessionKey 与 proposalKey 分配稳定模板 key；新 evidence key 必须处于该候选的独立命名空间。

预检基础沿真实来源、Session Zero/claimed 身份、事件回放、Oracle 复算和事实账本核验读取，只向当前真人 GM 提供私域预检。兼任主持和普通玩家不能因此获得 GM 资料；人类 GM 的确定性预检不依赖 AI advice 权限，也不授予模型读取权限。当前没有新增 CONTEXT_SOURCES、Skill、AI入口或写回扩展，正式模型输入必须在后续独立来源/授权单元登记后接入。

基础绑定实际 runtime/world/rule、授权与机械状态、分支封存、当前世界轮次、未退休会话事实和真实局势激活历史。个性化目录来自冻结玩家身份，或真实批准且已经完成的真人行动选择；未完成行动、模型提案、NPC 代玩家许诺和自然语言承诺推断均不成为已确认玩家承诺。来源记录保留原 actor、sourceRef 和 contentHash；A3 只能引用系统核验目录，不接收模型自造的个性化 proof。祖先历史按真实原分支及激活序号排序，父删除后仍保持原坐标。

复用原 S1–S10、A1–A3、加权 Jaccard 0.80/最近8/冷却3轮的检查实现，不复制第二套比较器。新增 session-only 引用预检只把已确认会话事实加入允许引用的目录，不把它们塞进冻结事实索引、world predicate 槽或世界来源。原 frozen campaign 验证入口仍拒绝 session whyNow/evidence 来源；会话专用入口核对真实 session source、作用域和来源密级，新线索不得降低密级或扩大 private 接收者。任意规则、角色、效果、后果或原模板覆盖都被拒绝。

预检返回 proposal/basis hash、真实个性化来源、逐项 A1/A2/A3/冷却结果和拒绝原因，明确 `outputIsCandidate=true`、`grantsAcceptance=false`。即使结构检查通过，也不创建 Run、不记录接受事件、不激活局势、不调用模型、不写数据 owner；源进度变化须重新读取。不能把既有比较器中的 accepted 布尔解释为领域采用回执。

该基础保留原冻结内容/旧档哈希与默认隐藏边界。后续仍须完成注册来源、正式生成窗口和调用预算、CreativeArtifact/原始响应/Harness、明确审阅与可恢复采用事件，以及所有 runtime catalog/门/知识/压力/投影的实际接入；不能只改模板列表或以当前预检宣称 P9 完成。P8/P9 原真实模型/真人/长局验收门保持。


### 35.69 P9 生成资料与一次性请求授权基础（2026-10-16）

本单元先固定跑团 open S3 的局势生成读取与请求合同，再接入代码。团局拥有请求、来源清单及未来候选；冻结世界/发行包/作者模板与媒资 owner 不变。新增 `request-situation` 被动窗口：由当前真人 GM 或 AI GM 模式的开团真人确认者明确请求，要求本桌记录同意、GM AI advice/身份披露、阶段进行中、未暂停且无待结算行动/继承恢复/原请求。冻结最多一次模型调用、零 AI 行动，不给 Oracle、普通行动、复盘、主持连续委托或世界写入权限；新请求不能借用其他窗口。原 `request-brief` 继续独立且可在阶段结束后使用。

新增精确注册源 `ttrpgOpenSituationInput`，仅供明确 GM 模型视角，在真实当前生成窗口和 AI 读取授权下列目录/检索/读取，整条 JSON 读取且禁止 original/head 原文。先过作用域/席位/同意/窗口检查，再产生元数据、计数、游标和缓存；不把兼任主持理解为人类 GM 读权。人类私域预检仍只允许真人 GM，当前窗口仅授权起草候选，不授权采纳；AI GM 模式下的安全审阅投影和最终采用合同须后续单独接入，不能向兼任主持输出 GM 原文。

模型资料采用合同/系统分配身份、当前阶段与机械状态投影、准确允许引用目录和可选完整资源：冻结规则/行动/效果/实体绑定、当前权威事实、NPC/威胁与实际局势历史、真实玩家身份或已完成选择。保留发行时资料与当前事实、原观察/私域和来源证明；不发送整个 campaign/RuntimePackage 或原始 head，不将记忆/传闻/NPC许诺变成玩家承诺。描述符不是完整阅读证明；后续正式候选/Harness 必须以实际完整交付资源及 Manifest 核对引用，不能只凭目录或模型自填来源。

系统按真实 session 与生成窗口分配模板命名空间。语义资源字节不含本次 E14 记账序号/调用计数，读取证据仍保留真实序号、state/source hash；源、同意或阶段变动使读取会话 stale。新注册源实际改变工具枚举，交付前须重算并冻结新的 tool schema version/hash；旧 Skill/Run/来源授权及历史原请求按原合同保留，不因新源扩权。此基础尚无新 Skill/正式派发、CreativeArtifact/采用事件或用户生成面板，不等于 P9 完成。

实现后的权限入口同时在命令预检和离线重放使用事件闭集：生成期间允许请求记账、安全控制、桌外交流和明确结束，拒绝事实改写、征兆发布、世界时间/行动结算与其他主持权限。玩家桌面显示局势拟定状态，原请求者可在安全控制区取消；取消不受行动区禁用影响。分支不继承父团活动窗口，须重新确认和请求；完整备份重映射保留已经确认的资料含义，旧正式 Run 仍遵守历史恢复限制。

本次实际工具枚举冻结为 agent-read-tools-v15，hash 332627dddbd61caf7a873933d8a8428a99884d7260b9995da8698e674bb16cf1，共146个上下文源；未新增写字段、表、领域采用扩展或正式 AI 入口。真实 v14 已准备请求在新增源后仍按原冻结权限完成，未追加新源。生成输入的同质化阈值、最近历史数和冷却长度直接复用确定性内核常量；发行初值旁单列来自实际机械账本/已确认会话事实的当前值，角色状态、库存和能力用量保留其实际 owner。

### 35.70 P9 正式生成与私域候选合同（2026-10-16）

继续跑团 open S3 产品研发，ProductRuntimeSession/关联 durable Run 拥有本次请求和待审候选；世界、发行包、作者模板与媒资 owner 不变。正式目的固定为 `prose.ttrpg-open-situation-propose` / `ttrpg.open.situation-propose`，仅授予 `ttrpgOpenSituationInput`，沿用真实 `request-situation` 一次调用、零行动窗口。复用现行 Gateway、原请求/原始响应/Manifest、CreativeArtifact 与取消、未知结果、恢复、候选终验链；不进入 Oracle 回退，不扩充旧 Skill/Run 的来源或写权限。此单元没有领域采用写权限、生成模板采用事件或激活权。

模型输入提供完整闭集输出结构/谓词语法及实际内核阈值，要求系统分配模板/线索命名空间、真实个性化来源和可验证 DAG。内核用真实当次语义 basis 做确定性预检；另以实际完整交付资源校验全部外部引用。目录/自填来源键不是正文阅读证明，冻结抽取内容中的世界来源引用仅是溯源，不能冒充已读世界原文。独立保留确定性验证 basis 的内部工件，并绑定原调用 admission hash；该工件不计作模型已交付资料，不得手拼进模型消息。阶段、授权、来源或机械状态变化使候选受阻；原始文本须先保存，失效/无效/超预算候选不得借恢复重发。

GM 模型原始输入、回答和私域候选不能通过通用人类读取/恢复接口泄漏给 AI GM 模式的兼任主持。正式生成/专属恢复仅返回固定结构的状态、原请求/候选身份，不返回原文、标题、引用目录、具体私密错误或完整 prepared 消息。真人 GM 可经当前真实席位校验读取原私域候选；内部请求执行与终验使用独立的内核读取接口，该接口不接通玩家 UI/API。当前兼任主持仅授权起草；后续私域采用委托与安全确认投影另行固定，不能从生成请求或模型回答推导。

验证须覆盖真实 prepare→dispatch→保留 raw→候选与原请求恢复、自己的 E14 不改变语义资料、完整交付/缺少正文/伪造来源、未交付模板样例时仍有完整结构、秘密投影、错误/超预算/stale/unknown/未发取消/重复发送/终验中断、分支/导入历史与旧 v14 冻结权限。全量与真实 provider/真人长局验收仍分别留证，不把私域候选生成视作采用、运行或 P9 完成。

本单元的完整结构不依赖模型读到既有模板样例；冻结模组仍保留现行最低模板要求，不开放空模组绕过发布校验。当前场景/开局局势的真实规则、事实、实体和效果依赖由同一纯引用规划器收口为必读资料，玩家实际身份与当前位置事实也保持必读；其余资源仍按来源检索和完整预算选择。内部验证快照不进入模型消息。

结束生成窗口的持久事件同时作为运行收尾授权：已产生的候选运行追加明确取消终态，未发送原请求先零发送取消，未知结果和已付响应保留。终态保存中断时显示专属补齐入口，只补原回执；源窗口已关闭后不得借恢复重新生成待采用状态。新目的的本地准备若未形成任何持久调用，准备失败会终止原 Run，避免留下不可见悬挂任务。后续采用单元必须以实际领域采用回执处理“采用已提交但 Run 终验未补齐”与停止之间的竞争，不能仅凭 Run 确认标志推断是否已采用。

私域候选的标题、介入提示、证据描述和后果文字即使标注 party/public，也不能直接作为玩家文本；它们来自 GM 私域模型输入。下一单元需先固定公共资料派生/明确披露授权与投影，再接入正式运行，防止从私域自由文本泄露与引用无关的秘密。后续会话目录还须兼容已有 F13 合法物化实体的真实身份/来源，不能因其不在原冻结 entityBindings 中就把合法运行对象永久排除在生成之外；该扩展须沿现有实体 owner/回执实现，模型本身仍不能声明机械实体或规则。

正式入口回归同时核验现行七个跑团目的都只输出候选，保留旧冻结注册表的严格解析。纯记忆回执/模型记忆/复盘合同及记忆前缀证明进入实际纯回放叶子分组；同一静态闭包检查与双顺序实际构建模块初始化继续约束边界，不放宽包体预算。


### 35.71 P9 会话采用目录、披露与真实运行闭包（2026-10-16，引擎/API；界面实施中）

继续跑团 open S3 产品能力研发。ProductRuntimeSession 拥有不可变的已采用局势及领域回执，关联原始 Run/回答/Manifest/CreativeArtifact、当次来源和明确确认身份；不修改作者模组、冻结世界、发行包或媒资。既有 PROJECT_TABLES 继续覆盖运行头/事件的备份、删除、导入与重映射，原状态没有新字段时保持原 JSON/hash；采用只走具名领域命令、CAS、正式事件及确定性 reducer，不开放模型直接写表。

当前先接通真人 GM 审阅：须实际认领 GM、核验当前来源/窗口/同意/安全、复核原始完整交付和候选、重新执行 A1–A3/冷却及全部引用，并明确确认该精确模板的玩家标题/提示和按发现条件披露的正文。披露绑定不可变模板及原候选哈希；模型写 party/public 不代替人类披露。兼任主持的生成授权继续不授予私域读取或采用；AI GM 的受限采用委托与公共资料派生须另有显式合同和真实证据后再接通。

唯一纯会话目录合并只读冻结模板与已采用模板，为运行查找、引用校验、实例门/FIFO/冷却/历史、维护/后果/压力/击败清理、知识发现/分享/哈希、终态门/恢复和各视角上下文提供统一解析。组合只作为临时校验视图，不能存入或哈希为原 Campaign/RuntimePackage。既有冻结周期的结构保持；生成模板在新周期中须有真实不可变来源，不能靠模型自行提供定义。合法 F13 物化实体须按真实实体/事实 owner 及原回执加入可引用目录，不能重新造实体或规则。

采用事件只保存定义与审阅/披露回执，不推进世界时间、行动、事实、知识或立即激活。生成局势的准入另走具名、明确的本桌命令和真实 I1–I7 门；接受与激活保持可辨认回执。原候选 once-only，领域采用已提交但 Run 终验中断时只补原回执；结束窗口必须先识别真实领域采用，不能因尚无 Run 确认而取消已采用内容。分支只继承切点前已确认定义及原始 session 坐标，未采用候选与原请求不获得新权威；父删除与完整备份后仍可核验。

验收覆盖正式生成→真人复核/披露→一次采用→实际准入→真实线索发现/下一轮知识与维护后果，拒绝无披露、兼任主持越权、篡改/跨作用域/stale、双采用、Stop/采用终验竞争，并验证刷新、切点前后分支、父删除、完整备份重映射和原发行包字节不变。用户请求/审阅/放弃/确认/恢复界面及 AI GM 委托仍需各自完整路径；纯合同或目录不构成 P9 完成，P10和原真实供应方/独立玩家/30+worldTurn完成门继续保留。


本单元新增准入理由 `session-generation`，只由实际真人 GM 在无活动调用窗口、无待结算操作/继承任务且安全有效时明确启用已确认定义；不是新付费循环，也不代行玩家行动/推进时间。原开局、压力和后果三个 owner 仍只能提交各自原有理由。生成期间禁止准入。局势/压力周期仅新增按实际 active/queued 及下一局势依赖选择的不可变采用引用（templateKey/receiptHash），原 frozenContent/contentHash 不变；创建时与真实目录对照，回放/分支解析继续核验原采用。发现计划只为所用的生成局势冻结一个原采用回执；该快照必须与实际目录严格相等，不能用自填模板获得知识或效果。


采用同时冻结现行便携 Run-origin 合同/事件原文，原物理定位只作为不可执行的历史字符串保存，不参与当前 ID 重映射；原工件继续由工作区 owner 的 agentRunArtifacts/PROJECT_TABLES 保留。采用回执从原事件提取闭集精确 artifactKind/contentHash 引用；PROJECT_TABLES 为团局初态、运行头和该类型采用事件登记引用根，统一工件回收及 Run 删除据此派生事务范围。任何仍有已确认 owner 的工件均不得自动回收或显式裁剪，损坏引用中止清理；保留引用不产生读取或调用权限。真人 GM 的专属审计读取按原事件中的精确哈希重读原回答、候选、Manifest、完整资料和内核快照，重建实际来源/预检证明。父团局删除与完整导入后仍可审阅；兼任主持仍不得读取，历史工件不能恢复发送/采用权限。新表与第二套 Run/工件存储均不引入。


会话事实退休后保留已采用定义的历史引用与原始采用证明；当前事实正文仍不进入新生成资料。内部 basis 仅在确有已采用模板及退休事实时保留只供校验的退休目录，使旧定义可解析；新候选的事实键/谓词/whyNow 必须拒绝退休引用。必读规划遇到真实已采用定义的历史引用时读取该定义本身并标明历史含义，不把其当作当前事实正文或新的阅读证据。


本单元的18项采用/保留与79项现有调用方回归已通过，退休用例另扩展到下一次正式生成与实际采用：旧定义仅保留历史引用，新候选在预检和事件 reducer 共用当前事实约束。两条隔离浏览器路径通过，覆盖模拟正式调用、真人 GM API 披露采用、结束窗口与独立启用，以及实际玩家桌面的新线索发现/私密标记隔离；当前尚无局势生成审阅面板。局势引擎/API 的工程验证不代替完整 CI/E2E、真实 provider、独立真人及长局验收。

### 35.72 P9 主动请求、精确披露与局势操作面板（2026-10-16，实施中）

跑团 open S3 产品能力研发。本单元把已交付的正式生成、候选、采用、终验和独立准入接入真实主持/玩家桌面；团局和原 Run 继续拥有候选及回执，冻结世界、发行包、作者模板与媒资 owner 不变。读取复用登记的 ttrpgOpenSituationInput、原 Manifest/工件和角色授权，写入复用既有具名命令与 PROJECT_TABLES，不新增模型直接写入、通用表、schema、Skill 或第二套请求。

页面读取和刷新只展示实际进度，不自动发送、恢复、采用或补齐。请求仅由当前真人主持明确发起，保留独立一次调用/零行动窗口与预算；只能显式继续原未发送请求，未知结果不重发，已保存回答恢复不调用模型。原 Run 必须由本团局/契约/真实调用唯一定位；导入和分支历史不能恢复发送/采用权。普通玩家不获得主持面板，兼任主持仅有固定请求状态，私域候选、原文、诊断、来源和已采用完整目录只允许实际真人 GM。

真人 GM 必须看到精确模板的玩家标题、提示、线索正文、接收者和发现条件，再明确勾选本版本的披露确认。确认绑定候选和模板哈希，刷新、版本或身份切换后勾选失效；无效/过期候选不得保存。采用定义、补齐已提交采用的终验、结束生成窗口和独立启用分别可见；启用仍受原 I1–I7/FIFO、安全和无待结算业务约束，不代行玩家行动。放弃先以绑定原候选的明确关闭决定和采用事务竞争，实际采用先提交时不得改写为放弃；未采用 Run 继续由原停止清理收尾，不制造采用/取消的双重事实。

组件按作用域、团局与身份隔离草稿，交接卸载时清除私域状态并中止本机等待；自身请求记账引起的序号刷新不能意外撤销在途调用。停止、未发送取消、停止收尾与采用终验中断均有明确恢复入口。验收覆盖实际点击请求→审阅/披露→采用→终验补齐→结束→启用、刷新零重发、放弃与竞争、无效回答、取消/停止、跨身份秘密与草稿隔离及手机宽度；工程模拟 endpoint 不代替真实 provider、独立真人或长局验收，AI GM受限委托和P9/P10其余完成门继续保留。

发送记账后硬刷新不得把团局永久锁在 dispatched。当前本人可明确恢复原回执，操作不得获得发送许可：若原 Run 已有同 attempt 的唯一逐字回答，按原 prompt/raw 恢复缺失的 model.responded/调用成功回执，再由原候选恢复器继续；丢失的用量只标 estimated，实际费用保持未知，不伪造 provider 账单。没有回答时只能明确选择结束等待并记为 unknown，保留原预留与可能费用，不声称零发送或取消了供应方请求。该决定与实际响应通过原 Run/领域证据 CAS 竞争；已经观察到的回答不得降格为未知，晚到发送者也不得覆盖既有终态。导入历史、其他席位、其他用途、缺少原始证明或多个不同回答不得借此恢复执行权；读页面不能自动做上述修复。

当前已有6项桌面服务回归与45项调用/恢复相关回归通过；8条界面兼容路径、修订后的4条桌面路径及新增2条原请求恢复路径分别通过，合计10条不同浏览器路径。新恢复用例涵盖原文保存前后 cutpoint、多个回答、篡改、跨作用域/席位、导入历史和晚到执行者；旧意图/回复恢复路径仍通过。手机390像素的实际视口已检查；模拟 endpoint 与工程 dispatch cutpoint不替代真实供应方或真人长局验收。完整最终工程检查、冻结提交的CI/E2E与AI GM受限采用合同仍分别留证。

### 35.73 P9 AI 主持的共同资料生成与本次采用授权（2026-10-16，共同资料与合同基础已实施，有界采用待接）

继续跑团 open S3 产品能力研发，团局/原 Run 拥有新定义及回执，WorldRelease、发行包、作者模板与媒资 owner 不变。先完成共同资料投影、合法引用目录与闭集授权合同，再登记独立正式来源/Skill/入口及冻结工具版本，最后接有界采用与实际准入；共享注册表和工具合同先作为独立基础提交串行整合。本节是施工约束，当前不授予新运行权限。

共同资料按本次实际已授权玩家集合求交集，复用现有角色/共同复盘读取与真实作用域、来源、权限和 read stamp。可读取共同的发行时观察、当前确认事实、已知线索、公开征兆、可见实体和可安全提供的冻结规则；必须保留初始值/当前值、亲历/转述/推测/叙述等区别。只有真实共同可读且足以支撑引用的完整投影进入模型，目录或内部全量内核快照不能充当已交付正文。公开文字依据与可执行条件分别校验：发行时初值、旧观察或公开征兆不证明当前隐蔽 owner 槽值；自动候选只能采用有本次共同资料证明的机械条件，不能借准入、预检或错误响应试探隐藏状态。GM/NPC 私域档案、其他角色私事、旧私域候选/回答、隐藏事实/线索及未同意公开的原行动输入不得进入请求、目录、检索、预算候选、缓存、错误或玩家审阅文本。公开生成有独立冻结来源权限，旧私域目的和旧候选不由新授权扩权。

起草仍为一次调用、零角色行动的独立窗口。本人明确声明本次自然语言要求可作为共同局势素材，并选择仅针对这一次请求的拟定/采用授权；该共享声明、输入哈希、实际席位/修订、接收者集合、来源计划/模式、窗口与预算形成系统冻结证明，模型不能自填。普通生成请求、Session Zero、管理身份或提示词不能代替此次授权。新候选仍先保存 raw、Manifest、CreativeArtifact 与完整交付证明，经 A1–A3、引用、冷却、安全、当前来源/权限和原授权范围的确定性检查后，才能由具名领域命令提交；不修改规则、机械实体、事实、知识、玩家决定或世界。

系统采用明确标记为“本次授权下的 AI 主持采用”，不能伪装成人工逐字审阅；保留原始 Skill/Run/回答/实际来源和委托链。采用定义、原终验、关闭原窗口与准入分别有可重放证据，任何部分中断只补原缺失步骤；不增加付费循环或回补预算。准入沿原 I1–I7/FIFO/容量/冷却，拒绝或排队不冒充启用。取消、安全暂停、席位/共同接收者或来源变化后不得继续采用或启用；导入/分支历史不能继承活的发送或委托权限，已确认定义及原证据按原切点保留。无此次授权时继续沿已实现的真人 GM 精确披露路径。

基础退出需有共同与私域 canary、全体/分队/新席位交集、完整正文/目录区分、已退休事实与原始权限、跨作用域/用途/版本、无授权/旧私域候选重标拒绝、预算与一次发送的正反例；后续须证明真实模型链→本次有界采用→关闭→实际准入→玩家发现/维护，以及中断/Stop/late executor、切点/删除/完整导入和原发行字节不变。该增量及工程模拟不能替代 P9/P10其余交付、真实 provider、独立真人、30+worldTurn与原联合完成门。

本节已落地的基础仅包含：复用角色读取器的全体实际接收者交集、独立 `ttrpgOpenPublicSituationInput` 来源及只读 Skill、完整来源 JSON/结构语法、明确的条件允许范围与闭集请求证据合同。初始机械观察仍保留发行时标记；当前条件只允许有共同证据的不变量、未退休会话事实、可见时钟、亲历线索与世界时间。分队不制造共同位置，新接收者不继承旧线索，规则定义不输出各角色私域状态或可用性。目录、检索、缓存和错误不输出隐藏 front、效果、旧局势或私人档案。共享输入字节、哈希、本人选择、作用域、席位修订、原窗口、接收者与一次调用/零行动限制均有独立合同，但其解析和哈希不是活授权。

工具声明增至 v16，仅新增来源键；v15 原 Skill、Run 绑定和私域权限保持冻结，并有从真实旧提交生成的隔离 prepared 请求继续执行回归。旧复盘复用新共同读取器，保留原资源语义和权限。当前没有新增正式公开模型调用入口、运行授权事件、自动采用或自动启用界面；这些须接原 Harness 和确定性领域命令后另行验证，不能用本次只读基础宣称 AI 主持采用完成。应用/schema/表/备份版本和世界/媒资 owner 均不变。

### 35.74 P9 共同资料请求与原 Run 授权闭包（2026-10-16，原请求与候选已接；有界采用待接）

继续跑团 open S3 产品能力研发，复用 §35.73 已登记来源及只读 Skill。下一增量先接明确共享本次输入、独立一次调用/零行动窗口、原本地 Run 与正式入口，再接完整来源交付和候选；采用/关闭/独立准入继续使用领域事件和原预算，不能由注册来源或解析合同直接获得权限。WorldRelease、发行包、作者模板、机械实体、事实、知识与媒资 owner 不变。

原 Run 必须在请求授权中有确定身份；不能先落一个可执行委托，再允许导入历史凭该委托创建新 Run。即使新数据库恰好复用了相同数字 ID，portable/imported 原记录也只能审计，不能取得发送或采用权。优先复用同一 durable Run 的创建、授权、实际输入保存及一次派发，明确每个中断切点的恢复与收尾；不得为了恢复另建付费请求。用户本次共享文字须作为实际登记来源完整进入 Gateway/Manifest，保留实际发送字节与哈希，禁止作为额外私域提示词绕过来源。

新正式用途与旧私域局势、复盘、Oracle、行动和有限队友主持分别闭合。需要真实公共引用适配器证明模型实际读到的完整投影，而不是复用 GM 全量正文的交付断言；内部确定性内核可保留独立证据，但其私域值不得进入模型、目录、预算候选、缓存、错误或玩家正文。实际完整发送消息（包含客户端附加提示层）须有私域 canary 证明。来源/接收者/席位/安全或预算变化阻止新派发和采用；已观察回答的原收尾不伪造为未发送或零费用。

实施进展（当前增量尚待最终工程交付）：本次共享文字保留空白与非 NFC 字节，先创建同一个本地只读 Run、冻结 Skill/正式入口及预算，再保存领域授权。共同输入作为必读来源进入 Gateway 和 Manifest；准备中断后复用原模型绑定与工件补预留，不能创建第二次调用。新增共同身份只证明当前实际选择的玩家角色键，不带人物档案、私密选择或承诺；本次候选命名空间由系统分配并实际交付。发送前检查实际共同资料能否满足局势合同，不用内核隐藏资料弥补缺失材料或付费试错。

共同引用使用独立适配器逐条核对实际完整投影和资源哈希，明确区别规则定义、可见时钟、发行观察、当前会话事实、已观察线索及冻结抽取溯源。效果、前线、后续模板、私域状态和虚构承诺均拒绝；所有谓词分支先过共同允许范围，再进入完整内部状态的 S1–S10、A1–A3/冷却检查。完整内核工件单独绑定原请求哈希，不进入模型消息、目录或玩家正文。新候选使用独立 schema，不重标原私域局势候选。玩家兼任主持只收到不含原文的状态；共同输入不表示其自动取得尚未披露的新局势正文。

正式模型入口已接同一 Run 的一次实际发送、原文先保存、CreativeArtifact 与完整候选 Manifest，客户端拒绝静默裁剪与变更冻结模型。补账只恢复原回答或原候选回执；明确结束窗口先保存领域关闭，再可重试原 Run 终验清理，覆盖尚未准备或预留的 Run。未发送记录才记零用量；结束已发送等待保留未知结果/费用，晚到响应不恢复委托或制造新请求。导入封存新增只供审计的 preparation-origin V2，覆盖没有 model.requested 或调用预留的原 Run；旧 V1 调用来源字节与原恢复边界保持有效，恰好复用物理 ID 也不能复活新权限。

导入纯重放按稳定团局及原契约保存的身份关联核对，不能拿不可改写的原授权物理编号与导入后的新编号比较；新发送与采用仍须严格核对当前作用域、原本地 Run 和实时授权。已证明从未发送的导入预留只可沿原 V1 历史核对路径取消记账并明确结束窗口，不能取得新的发送或采用许可。

定向验证已覆盖正常/刷新、原授权提交失败、准备/回答/领域回执/候选/终验中断、用途与作用域反例、明确 Stop、未知与晚到响应及原私域兼容；最终原生浏览器、构建和完整 CI 以对应冻结源码回执为准。完整 HTTP 请求的工程测试穿过正式入口和实际聊天客户端，只拦截网络响应，核对实际消息无私域 canary；不是真实 provider、真人或长局证据。本次尚未实现 AI 主持一次采用、独立准入及其公开操作面板；原共享声明和 draft-only 记录不会自行产生采用权。P9/P10及真实 provider、独立真人和长局联合门保持未完成，开放入口仍默认隐藏。

本单元最终定向联合回归 10 文件/93 项通过，隔离原生浏览器 8 条路径通过（包含旧局势面板的真实展开/取消和主持刷新恢复）。TypeScript、定向 lint、三注册表/入口/文档检查、生产构建、包体预算与实际三个构建回放模块双顺序加载通过。先前冻结版本的完整开放预览回归暴露过时的折叠面板操作与恢复等待，本单元保留原失败证据并沿现行页面修正用例，未删断言或跳过路径；当前冻结提交的整仓 CI、默认全量 E2E 和开放预览全量回执继续串行安排，不能用定向通过替代全量通过。

### 35.75 P9 本次授权下的 AI 主持采用与独立准入（2026-10-16，引擎与公开操作界面已接，整体验收待完成）

产品为跑团 open，属于 S3 产品能力研发；团局拥有采用定义与运行回执，原 Run 拥有完整请求/回答/候选/终验。世界、作品、发行包、作者模板及媒资 owner 不变。读源继续为已登记的共同来源，正式 Skill 保持只读；有限运行采用使用原人类明确委托与具名领域命令，不扩成作者字段写入权限。不增表或复制生命周期：采用仍由 productRuntimeEvents 的既有注册根及 runtimeHead/checkpoint、分支快照保存，原逐字证据沿 PROJECT_TABLES 的 receipt.artifactRefs 保留。

保留 human-gm-reviewed 的 V1 字节合同，新增明确区分的 V2 AI 主持本次采用回执。V2 必须保存原授权、原本地 Run、原候选与实际交付/原文引用；只能用于本次 adopt-this-one-candidate 委托、当前 AI GM 与原主持席位，不能冒充人类逐字审阅。draft-only、原私域候选、导入 Run、失效权限/来源/安全或未通过确定性检查的候选一律不能采用。所有模型引用先经共同正文证明，再复核当前 S1–S10、A1–A3/冷却；不得读取私域值来扩展候选条件或拼接追加模型提示。

采用、原 Run 终验、结束窗口与单独启用分别留真实事件/回执。中断只补原缺失步骤，不创建请求、不补预算；采用提交先于 Stop 时保留既成采用，Stop 先提交则不再采用。已采用定义经当前真人主持明确启用，继续复用 I1–I7、FIFO、容量/冷却和无待结算业务约束；导入与分支只能保留已确认历史定义，不继承旧 AI 委托，新的人工启用单独核对当前权限。AI 主持界面必须明确共享及一次采用选择、显示不泄露尚未发现正文的进度与可恢复收尾，旧真人 GM 私域审阅和历史请求保持可恢复。

退出需覆盖原生成→本次采用→终验→关闭→实际准入→玩家发现/维护；每个切点、双执行器/Stop 竞争、未知/晚到、draft-only/跨用途/跨项目/旧候选重标、切点前后/原 Run 与父会话删除、重复完整导入及证据保留。定向回归和模拟传输的工程浏览器证明不替代当前 head 全量 CI/E2E、真实 provider、独立真人、长局及 P9/P10 其余目标。

本增量实现 V2 本次委托采用回执、原候选完整交付与当前预检、一次领域提交、原 Run 终验修复及独立人工准入；V1 真人 GM 披露回执和旧私域候选保持原用途。两个版本都核对原 Skill，不能重新计算哈希后把 AI 委托改称真人审阅。正常共同请求在原授权下保存候选、采用、补齐终验并结束窗口，启用始终是另外一次明确操作；检查未通过、Stop 或授权/来源变化不自动采用。结束窗口和安全暂停之后，只能修复已经实际提交的原采用回执，不重新授权、调用模型或写入第二份定义。

共同生成的 `party/public` 标记不能扩大本次输入的原接收者范围。定义字节保持原样，系统在提示、人工行动目录、发现计划、知识结算和质量门/恢复处施加原接收者上限；新席位不能靠标题、公开标签或发现路径自动获得旧资料。真实发现仍需规则行动与确认，生成不直接授予知识。之后作者明确分享已经发现的线索是独立传播事件，接收者得到转述而非亲历；限制不拦截这种有来源的后续分享。

AI 主持下的玩家主持桌新增“用共同资料拟定新局势”：共享本次输入、委托采用本次一个候选均默认未选；输入、预算或模型变化后重新确认。刷新只读，原授权/未发送请求可明确继续；已保存回答、候选、采用终验及关闭中断分别恢复。尚未公开的候选目标、线索正文、原始回答和内部内核不交给玩家主持；历史核验只返回安全元数据且不恢复发送/采用权限。旧私域入口对 AI 主持停止接收新请求，原私域窗口与原真人 GM 的逐字审阅/放弃/终验修复仍保留。

定向工程验证覆盖 10 个回归文件共 74 项，包括存储回滚、双执行器与 Stop 竞争、非本次委托/跨用途拒绝、实际准入/发现/维护、晚加入角色和明确分享、切点前后分支、父团局/原 Run 删除、两次完整备份导入与保留根。10 项隔离原生浏览器用例通过，覆盖实际正式 HTTP 客户端（网络响应为工程模拟）、公开请求/单独启用/刷新与停止、旧私域请求及真人 GM 审阅兼容。定向架构/必需表/AI Manual/来源可达/正式入口/文档/上下文/路线图/类型/lint 检查、构建和体积门通过；实时指标用官方生成器刷新。本增量的最终冻结提交仍需完整 CI、默认与 open 预览 E2E 结果，不能引用旧 head 结果代替；真实 provider、独立真人、30+worldTurn、P9 剩余纵切面与 P10 继续未完成，open 入口仍默认隐藏。

### 35.76 运行实体物化与局势引用闭包（2026-10-16，基线核对与实施约束）

产品为跑团 open、S3 产品能力研发。运行实体、机械 owner 与来源回执属于团局；冻结世界、角色模板、规则、发行包和媒资 owner 不变。入口应为既有正式运行协调链中的明确请求/候选和授权，交付物为确定性内核分配身份的实体实例、同事务机械初始化与可重放来源；生成局势只引用已成立实例，不创建实例。

本单元开工核对发现：`dynamicEntityTemplates` 已有作者/内容解析及静态准入，但现行源码没有 `materializeTtrpgOpenEntityV1`、`ttrpg.open.entity.materialized` 的正式命令、领域事件或运行回执。§35.70/§35.71 所述“已有 F13 合法物化实体”不能作为当前能力证据；保留历史文字，施工以本次核对为准。必须先实现方案 §25/F13 对应 owner 与实际创建路径，再扩展局势引用目录，不能用临时绑定、修改发行内容、手工写运行 head 或仅生成描述来假装实例已存在。

新物化合同须有冻结模板身份、实际源/受众与接收者、原授权和 operation/Oracle 因果、确定性实例身份、数量/名称/参数上限、机械初始化及领域提交证据。NPC 只实例化已授权的冻结 NPC 模板和合法卡，物品复用冻结定义，地点按冻结模板建立；不得新增可玩真人席位、扩展规则或创建世界不变量。当前语义事实、记忆和局势候选本身都不授予机械创建权。

保留原内容/事实 basis/Run 的字节合同。会话实例引用需来自已提交领域回执，明确区分历史身份解析与当前可用性；角色位置、物品 owner/耐久/能力等仍由原机械 owner 管理，不能再建一份可写影子状态。只读运行目录供规则目标、事实校验、局势预检/准入、发现/维护、各视角与上下文适配器共同使用，不回存为原 Campaign 或发行包。正式 AI 来源/输出若有扩展，先冻结版本与三注册表闭包，旧请求和候选继续按原权限恢复。

退出须覆盖模板→明确候选/授权→原 operation→实际创建→规则真实作用→局势引用/发现，数量与作用域反例、无模板/无授权/未提交候选拒绝、存储失败全回滚、并发/刷新/恢复不重复创建、原发行字节不变、父删除/分支切点/完整备份重映射与受众边界。已接人类原咨询提案、全部受影响者确认、内核步骤身份与 F13 原子提交的引擎/API；提案/确认不创建实体，拒绝或暂停后的明确放弃可收尾。NPC、地点、物品与 NPC 初始装备沿原机械/库存/能力 owner 一次性建立，装备同计 Oracle 配额；原世界和发行包不变。实体计划保留与实际冻结来源一致的规范 JSON 证据，不作为作者可写内容或玩家读取面；恢复使用原定义，受众/模板/规则不能靠重算计划 hash 偷换。单一只读实例目录已接基本玩家投影、真实规则目标与效果参数授权，动态权限只认已提交 F13 来源，不认可变 attributes.templateKey。切点仅继承已创建实例，不继承待确认计划。

人工操作界面已接玩家桌与真人主持桌：明确开始咨询、选择表与可能性、保存原结果、按模板组成清单、保存提案、逐个受影响者审阅/同意/拒绝、原主持明确创建、暂停后放弃与独立结束窗口。读取和刷新不咨询、不发模型请求、不创建实体。参与者只收到必要的本人成本/库存投影；所有桌面变更入口也只返回安全提交序号，不返回含 GM 来源的原领域事件。新增库存必须对实际受影响角色可见；看到 NPC 不等于观察其私有初始装备，装备继续由原 NPC 库存管理，未获得独立披露来源前只允许 GM 读取。人工行动授权或仍有效的自动主持委托不能被挪作实体创建窗口。待确认计划同时在正式请求准备入口拒绝无关模型任务，拦截发生在创建 Run、来源工件和预留之前；不能只依赖稍后的领域预留失败。

14 个定向回归文件 87 项通过，覆盖实体与原玩家视角、规则权限、手动行动、风险/后果、分支、公开局势桌面及接收者边界；新增更强的导入后实际桌面读取另行通过。实体专项覆盖原计划/模板限制、原子提交/回滚、全部批准、暂停放弃、内核幂等/竞争、真实规则改变新 NPC 资源、装备配额、参数权限伪装、实际冻结定义替换、分支/父删除/备份和新席位边界。桌面隐私及装备读取的最后收口 15 项复验通过，准备窗口与明确停止原自动主持另分别通过；旧私域来源追踪用例修正了过期的错误措辞断言，并加强无私域 canary/无状态改变核对，保留原失败记录。类型、定向 lint、架构/表/AI Manual/来源/入口/文档/上下文检查通过。本单元冻结源码的默认生产构建与体积门已通过；3 个实体专项文件最终 27 项通过，覆盖真人 GM 与玩家主持两条权限路径。源码保存在独立开发提交；实际构建模块、浏览器点击/IndexedDB 路径与完整 CI 尚待，按冻结源码和最终提交分别记录，不以构建通过代替运行验收。正式 AI 实体提案、事实/局势生成的版本化实例引用适配及之后明确观察/披露仍须继续。不得据此宣称 F13/P9 或整体跑团已完成。

### 35.77 正式实体候选的分范围来源与旧请求兼容（2026-10-16，先行只读基础）

跑团 open 的 S3 产品能力研发，沿用 §35.76 的团局实体、机械 owner 与 F13 提交；世界、发行包、作者模板和媒资 owner 不变。实体单元保存为 `7d06cfe7`，后续分支通过 `11cda70e` 普通合入主线 `8af54f30` 的客户端/依赖与文档增量，保留两边缓存隔离、客户端配置和导出流程，指标由官方生成器重建。整合树的 48 项跑团回归、类型/架构/表/AI Manual/入口/来源/文档检查、生产构建和体积门已通过；浏览器及最终整合提交全量 CI/E2E 继续单独验证。

新增只读登记源 `ttrpgOpenEntityInput`，当前尚无正式实体请求 Skill、付费入口、模型候选或模型实体采用命令。来源只读取当前实际真人主持的非被动原窗口和真实 Oracle；原始骰证、seed、整份规则/战役、NPC 私密档案、前线目标、玩家私密档案与记忆不进入资料包。冻结模板是定义，不冒充已存在实例；已有地点/库存持有人来自唯一只读实体目录与真实机械 owner。模板实例余额、初始装备成本与本次 Oracle 剩余额度由系统计算，未创建提案不占用额度。

每条原咨询分别提供公开、当前队伍、实际私密接收者组或真人 GM 的资源分区。私密组来自本人的单人范围及冻结模板已声明的组；真人 GM 可处理其有权审阅的组。某分区只能读全体分区接收者有权读的模板与地点/库存身份，GM-only 咨询仅能进入 GM-only 分区；新增玩家库存仍必须让实际持有人获得本次披露。记录同意按实际参与读取的范围核验，GM 内部资料不因无关玩家拒绝叙事记录而整桌失效。标题、摘要和目录使用通用标签与不透明标识，私密正文只在完整读取对应资源时返回；固定只读会话在安全、权限或实际状态变化后失效。

资源拆为共同边界、原咨询/分区、完整模板、合法地点/库存身份，供后续冻结 SourcePlan 精确选择，不把整个运行状态拼入提示词，也不以固定条数偷偷裁剪。后续正式候选须证明实际完整交付的同一 Oracle、单一分区及所用模板/位置资源；来源声明、资源目录或模型自报引用均不授予采用权限。当前新增来源不扩大任何已有 Skill/Run 的读取授权；工具声明升级至 v17，仅增加该来源键，v16 原工具声明和真实待发送 Oracle 请求另以原始夹具保留并执行兼容回归。 实际登记源由 148 增至 149；旧架构指标按换行匹配漏计同一行声明的 extensionRecords，本次复用现有 AST 数组计数器，官方生成结果与 AI Manual 对齐。

正式实体提案后续须独立接登记 Skill/入口、同一 durable Run 的一次派发、先保存原回答、CreativeArtifact 和精确来源证明。AI 来源必须使用新版本计划/回执保存原候选、原 Skill/Run、原咨询及实际披露分区；所有提案对象受本次分区接收者上限约束，不能把 GM/private 资料复制到较宽的 party/public 对象。**不得把模型结果转交既有 `human-oracle-proposal` V1 入口冒充人工原创，也不得凭来源分区直接调用 F13 创建。** 原主持及每个受影响角色仍须确认本版本，原内核再原子物化。旧 V1 人工合同、旧事实 basis、旧候选和旧请求保持原字节与权限。

后续验证还须补齐：完整来源→正式请求→模型候选→明确采用计划→逐人确认→F13→规则真实作用，跨分区混读/降密、实际 HTTP 消息 canary、未知结果/停止/晚到、每个恢复切点、导入 Run 不获新请求/采用权、候选证据保留、真实玩家界面及最新提交全量闸门。当前只读基础的测试、构建和注册表检查不等于正式 AI 实体提案、F13/P9 或产品完成；事实/局势的版本化实例引用、后续明确观察/传播与 P10 继续实施。

本先行基础的工具/来源兼容回归 6 文件 56 项通过，实体与来源最终联合回归 4 文件 35 项通过（来源 8 项在两组中重合）；类型、定向 lint、架构、表、AI Manual、入口、来源可达、文档/路线图/上下文/指标、生产构建和体积门通过。现有全部 Skill 的实际解析来源均未新增本 source 权限。当前仍无实体正式模型调用或模型采用，原生浏览器与最新 head 全量 CI/E2E 不在上述通过范围内。

### 35.78 开放预览的持续浏览器验证（2026-10-17，工作流待执行）

现行 GitHub 默认浏览器任务未开启 open 预览标志，带该标志的界面用例会在默认矩阵中跳过。新增独立、按跑团及共享底座路径触发的预览工作流，在隔离运行器中设置 `VITE_ENABLE_TTRPG_OPEN_PREVIEW=1`，以单 worker 执行全部 `ttrpg-open-*` 与记忆回执用例；该环境变量只作用于预览测试任务。默认 CI 继续自己的验证范围。

17 处手工截图从原机器绝对路径迁入各用例的 `test.info().outputPath()`，覆盖 15 个用例文件，避免跨电脑/运行器的目录权限失败与不同执行器覆盖截图。截图及失败 trace/video 随测试产物保留七天。工作流 YAML、精确用例选择与静态清单已经核对，共收集 52 文件/93 项；收集与语法通过不等于这 93 项已执行通过，须等待当前提交的实际 CI 回执。该任务使用工程夹具和模拟传输，不产生真实模型、独立真人或长局验收结论。

### 35.79 单一范围的正式实体请求与候选（2026-10-17，候选/API 已接，模型采用尚未接通）

继续跑团 open S3 产品能力研发，团局拥有请求、候选和未来实例；冻结世界、发行包、模板、机械及媒资 owner 不变。复用既有 durable Harness、CreativeArtifact 和调用账本，不新增表、AI 可写作者字段或上下文来源。登记独立 `prose.ttrpg-open-entity-propose`、正式入口 `ttrpg.open.entity-propose` 与闭集用途 `entity-proposal`；只允许 `ttrpgOpenEntityInput`，不扩权原 Skill 或旧请求。

明确请求固定原 Oracle、一个完整披露分区、所选模板、合法地点/库存持有人及原窗口 `inputRevision`。系统回读真实目录核对选择，将准确资源全部标为必读并完整交付 Gateway；预算不足即拒绝，不删必读条目或混读其他分区。原咨询窗口的输入字节/修订保持不变，新选择另入模型调用绑定；人工行动授权或仍有效的自动主持委托均不能借用。模型消息只含固定系统指令与本次登记资料，不把窗口其它用途的原自由文本附入较公开请求。

正式 Run 冻结 Skill、入口、实际消息、模型和预算；原调用记录精确选择。发送前重验实际完整读取、消息、当前范围、窗口和机械状态；只派发一次。先保存原回答及用量，再解析闭集 `proposals`，形成独立模型来源候选，检查所用模板/位置均已完整交付、名称/参数/类别合法、模板余额与含 NPC 装备的 Oracle 总量。模型不能给出实体 ID、机械覆盖或受众/确认/授权字段。原回答、Manifest、候选工件、检查问题及 checkpoint 均保留；读取、刷新和原回答恢复不发送模型、不创建实体、不消耗物品、不推进游戏时间。

新增原实体回答的明确回执修复及放弃/停止 API，复用原回答修复内核，不复制模型发送入口。回答正文、模型回执、调用终态或候选回执中断时只修复准确原 Run；结果未知保留未知费用，不伪造零用量或重发。明确放弃本提案并结束原咨询窗口后，先保存窗口关闭回执，再有界补齐 Run 取消；等待中的请求须先修复真实回答或由本人明确记未知，晚到回答不能复活终态。导入后的原 Run 只保留证据，不获得新发送、可执行候选或旧原文桌面的旁路读取权限。

候选/API 是本单元边界，尚未提供玩家桌面 AI 起草按钮或模型实体采用/F13 提交。后续必须建立版本化模型来源计划/回执，逐项复验原回答、真实交付与本次范围接收者上限，保留原主持和每个受影响真人确认，再沿既有机械 owner 原子创建。不得把本候选转成 `human-oracle-proposal` V1 或直接复用 V1 人工原创准入。事实/P9 的版本化实例引用、后续观察传播、P10 与真实 provider/独立真人/长局验收继续实施；模拟 HTTP 和工程测试不代表这些工作完成。

本单元 9 个相关回归文件 74 项通过，另行的公开/GM-only/明确第二次请求与分支范围文件 3 项通过，共 77 项；包括真实客户端的模拟 HTTP 消息、准确原回答、错误输出、取消/未知/晚到、原回执三个中断切点、关闭后清理及完整备份导入。类型、定向零 warning lint、架构/表/AI Manual/入口/来源可达/文档/路线图/上下文/指标检查、生产构建和体积门通过。构建后的三个实际跑团模块在隔离原生浏览器中按正反顺序导入，均无初始化错误；这是模块初始化检查，不是玩家操作验收。本提交全量 CI/E2E 继续单独验证，旧工具协议真实请求夹具仍保持原合同与读取权限。

### 35.80 原生预览反馈与桌面并发回读（2026-10-17，修复验证中）

`680a031b` 的独立开放预览在真实 GitHub Chromium 运行器执行 93 项，82 项通过、11 项失败，原始回执及失败 trace 保留。失败索引包含一个过时的共同来源必读数量断言、数个提交/身份切换后仍在回读时到达默认五秒断言，以及自动主持第五次真实模拟 HTTP 回答几乎达到原 120 秒等待边界。它们不能被记成全量通过；完整默认 CI 与本机冻结验证仍各自跟踪。

玩家/真人主持桌面只对有类型的读取进度冲突有界重读，最多三次，不重放前面的领域操作、模型调用或预算预留。权限/身份拒绝直接停止，身份交接或旧读取代次失效时不渲染旧结果；持续冲突保留明确重新读取入口。独立实体模型请求不混入普通行动建议列表，也不能借用旧行动上下文检查入口；原分区的候选及来源继续走独立读取权限。

开放预览在共享 CI 运行器使用 20 秒断言预算，其他浏览器验证维持既有预算；自动主持的多请求用例单独使用有界的 CI 等待，状态/次数/资源/停止顺序和刷新后的相等性断言保持。共同来源用例改为核对完整五项必读资源身份，不再只锁一个旧数量。停止主持的即时检查核对真实停止状态，随后仍检查正式停止早于请求终态、刷新后原停止权限及不重发。

修复的玩家实际界面/领域读取与实体请求隔离回归 3 文件 12 项通过；原生浏览器对共同来源完整回读、暂停失效和实际线索代价扣减 2 文件 3 项通过，随后对摘要/后果/自动主持/人工叙述/人工行动/私密选择/局势采用/F13 的 8 文件 18 项全部通过。两轮源码逐文件 hash 均不变，使用隔离浏览器及现有工作树冻结字节，未复制新的整仓验证副本。这是 21 项定向原生复验，不是最新提交的完整 CI/E2E，也不改变云端旧提交 82/11 的真实回执；模型实体采用与后续实例引用尚未交付。

### 35.81 模型实体候选采用为待确认计划（2026-10-17，API 增量验证中）

沿用跑团 open 的 S3、团局实体与机械 owner，不新增表、作者可写字段、上下文源或媒资 owner。`a782cea7` 先登记模型实体计划在原事件、当前状态及祖先切点中的精确工件保留根，根与清理回归 10 项及必需工程检查通过；保留只授予证据生命周期，不授予模型读取、发送或采用权。旧 V1 人工实体合同、事件和字节顺序保持，新模型候选通过独立 `ttrpg.open.entity.model-proposed` 与 V2 计划保存原成功调用、单一范围选择、精确候选、原始回答/实际交付证据及可保留 Run 来源。

本次原真人主持明确审阅精确候选后，系统复验原回答、完整资料、当前来源/规则/机械状态和原咨询窗口，才保存待确认计划；空提案、检查失败、未审阅、其它用途/身份、停止后或导入 Run 均不获新采用权。计划的每个对象使用本次请求的准确接收者上限，即便冻结模板允许较广披露也不能扩大。采用终验只证明待确认计划已保存，不代表对象已创建；仍需原主持及每个受影响真人分别确认，再明确沿 F13 原子创建。桌面只显示安全的 AI/人工来源标记及本人影响，不返回内部模型证明或隐藏资料。

计划保存和原 Run 终验分开恢复：领域提交实际成功后，暂停、放弃计划或关闭窗口均不抹去原采用；原回执可有界补齐，不重发、不重建计划、不创建对象，也不能被 Stop 改记为放弃请求。父团局/原 Run 删除、分支与完整备份保留原语义身份及精确证据；子分支不继承待确认计划或新请求权限。

本增量首轮 5 文件 48 项通过，涵盖上述采用/确认/创建、私密与 GM-only、存储回滚、五个终验切点、Stop 竞争及两次完整导入。实际 AI 请求/审阅按钮尚未接入桌面，模型起草仍通过独立 API；两项原生浏览器 API→真人确认/创建及备份复验正在准备，不能据此宣称完整实体用户路径、F13/P9 或产品完成。旧 `680a031b` 默认云端回归实际为 5517 通过、6 失败（3 个过期入口数量断言、1 个回放构建分组缺项、2 个 120 秒长协作超时），构建与默认浏览器后续门未执行；当前增量还须通过修正后的静态回放依赖、体积与最终完整 CI/E2E，不引用旧提交结果替代。

纯回放的计划/窗口/身份检查与异步 Run 校验分文件，按实际静态依赖登记 state→open→adapter 构建分组，不通过扩大体积预算掩盖误入的模型/生产读取器。正式入口回归核对当前 57 个绑定及新增共同局势/实体的独立候选，旧闭集仍能严格解析。两项长协作在本机隔离覆盖率计时复验中均完成，分别约 111/108 秒；这里只执行两项，另 20 项未选，且该计时诊断不代表完整覆盖率门。仅这两个用例在 CI 下采用 240 秒上限，本地保留 120 秒；调用次数、实际三轮结算、队友授权、原预算和重放相等性断言保持，完整 CI 仍须按仓库原覆盖率门执行。

最终整合的 15 个定向文件共 109 项通过，包含模型/人工实体、原请求与作用域、共同局势旧调用、桌面读取、正式入口和纯回放依赖。架构、必需表、AI Manual、正式入口、来源可达、文档/路线图/上下文/指标、全仓 lint、类型、生产构建与原体积门均通过。实际构建的三个跑团模块在两个独立原生浏览器上下文按正反顺序导入均无初始化错误；这仍是模块检查，不能代替待执行的模型实体界面及最终 head 全量 CI/E2E。

后续冻结提交 `fef6b766` 的 6 项原生浏览器测试通过，包括两项 API 准备模型计划→真人界面确认/创建和备份读取，以及四项既有人工作用路径；来源文件前后指纹一致。该提交的云端开放预览测试 95 项全部通过（运行 `38943675857`），全仓 CI 尚在执行。上述证据属于该提交及明确工程传输，不代表后续实体 AI 请求界面或真实 provider/真人/长局完成。

### 35.82 实体 AI 起草、精确审阅与停止恢复桌面（2026-10-17，实施验证中）

产品为跑团 open，生命周期为产品研发，位置为 S3；原团局拥有请求、候选、待确认计划、实例和回执，冻结世界、发行包、模板及媒资 owner 保持。输入是本次已保存的 Oracle 结果、明确范围及作者冻结模板/实际可用引用；输出先为 CreativeArtifact 候选，再经本次原真人主持单独审阅成为 V2 模型来源计划。沿用既有 `ttrpgOpenEntityInput`、正式 Skill/Harness、原 Run/工件和 F13，不增表、字段写权或模型入口。

开发预览中的“本局新人物、地点与物品”复用原咨询结果选择，同时保留人工提案。真人明确选一个范围、1–32 个模板、0–64 个实际地点/持有人及本次预留上限，勾选授权后才发送。目录、候选、历史状态及刷新均只读；模型只收登记来源实际交付的资料，不收旧窗口自由输入或未选分区。按原候选准确版本再次勾选审阅后才保存待确认计划，再由原主持和各受影响真人分别确认，最后明确创建；请求、采用和各项确认均不创建对象或推进时间。

准备原请求后即可显式停止。系统先保存未知/原回答/实际费用及原咨询结束证据，再中止本机等待；不声称供应方已取消或实际费用为零。未发送原请求只能沿原身份/模型继续；成功回答、候选、采用及停止收尾有独立本地补回执入口，不新增发送。结束同次咨询会收尾所有未采用的本地草稿，已采用计划不改记为放弃。原 Run 已删除或导入的请求仅保留历史元数据，不制造替代权限；已完成原回答且没有在途调用时，原真人仍可明确结束当前咨询并保留费用。身份交接立即清除原视角候选、未确认文字和本机等待，不通过兼任主持显示私密正文。

首轮服务和实际 React 组件 10 项专项通过，覆盖只读、请求顺序、模型身份、分别审阅、实际未知/晚到、四个回执断点、批量结束草稿、原 Run 删除/完整导入、stale、预算及跨真人私密隔离。实际 HTTP 浏览器主路径、处理中停止、刷新补回执、手机布局及当前完整 CI/E2E继续按冻结源码验证；工程模拟不替代真实 provider、独立真人、30+worldTurn、P9 版本化实例引用/后续明确观察传播及 P10 的剩余目标。公开 open 继续默认隐藏。

提交前整合的 10 个定向文件共 63 项通过，覆盖新增桌面/组件和既有人工创建、模型采用、Harness、范围、玩家服务/组件及纯回放。架构、必需表、AI Manual、正式入口、来源可达、文档、路线图、上下文、指标、全仓 lint、类型、生产构建及原体积门全部通过；本节新增的四项真实 HTTP 客户端/原生界面用例仍须执行，不把旧提交的云端通过结果归于新界面。

`fef6b766` 的全仓云端回归最终为 939 个文件中 938 通过、1 失败，共 5,556 项通过、2 项失败；两项均是 `R-TTRPGIMPORT1` 仍匹配旧的身份错误文案，实际入口已更早明确拒绝导入请求的新发送。后续修正准确拒绝断言，并追加拒绝前后团局与原 Run 均不改变的核对，16 项导入来源专项通过。该全仓运行在覆盖率测试步骤失败，后续构建/默认浏览器门未执行，不能记为完整 CI 通过。

### 35.83 已创建实例的语义事实引用（2026-10-17，引擎/API 验证中）

产品为跑团 open，位置为 S3，生命周期为产品研发。事实继续由原会话事实账本和 `ttrpg.fact.asserted` 事件拥有，机械实体、库存、社会余额、世界和媒资 owner 不变。没有新表、AI 写字段、上下文源或新模型入口。本单元先提供独立的当前真人 GM 确认 API `commitTtrpgOpenOracleRuntimeEntityFactV1`，显式选择 `committed-runtime-entities-v1` 后才可引用真实 F13 实例；旧 V1 冻结引用 API、模型候选和已保存请求不获得新的引用权。

原事实 basis 保持冻结世界/规则/实体绑定字节，不追加运行实例或改写旧记录。仅新确认条目带版本化 `runtimeEntityReferences` 子合同，保存所用实例的原 operation/plan hash、实际创建 sourceRef、冻结来源/规则和准确受众/接收者；正文及当前属性不提供身份授权。准备时复验实际 F13 来源与实体 owner；回放和读取按真实已创建 journal 逐项对应，候选/待确认计划、别团实例、未知实体、伪造或重算 hash 的扩大披露均不能通过。NPC 初始装备引用同样来自原创建证据，并保持 GM-only，不借知道 NPC 取得装备知识。

新事实仍须原 Oracle、准确真人/候选/基线及现行语义事实策略；不得替玩家承诺或知识授予，也不能越过实体、库存和社会余额的机械 owner。引用只证明历史身份，不断言实体当前存活、在场或可行动；实际规则条件继续读取唯一机械状态。新确认路径在首次引入事实账本时按现行解析顺序保存，避免 F13 可选字段先出现引起 head 字节/hash 不一致；旧事实事件的历史字节规则保持。

首轮 4 文件 25 项通过，覆盖实际提交/幂等/谓词消费、私密接收者、机械与未知引用拒绝、事务回滚、重算证据攻击、父删除/前后切点和两次完整备份；NPC 装备反例及扩大关联回归继续验证。当前是引擎/API 增量，没有新增事实操作面板，也未扩大旧模型消息/候选；局势生成的版本化实例目录、实际采用/准入/发现消费和后续明确观察传播继续施工。最新整合提交完整 CI/E2E、真实 provider、独立真人、30+worldTurn 及 P10 仍须分别完成，公开 open 继续默认隐藏。

后续整合的 8 文件 68 项全部通过，新增装备事实保留 GM-only/库存 owner，关联验证旧事实与私密门、实体创建、世界补丁、纯回放及导入历史。15 项工程步骤（官方指标生成及架构、表、AI Manual、入口、来源、文档/路线图/上下文/指标、全仓 lint、类型、生产构建、原体积、diff）通过；新增原生 API 测试另经 lint/类型检查，待与实体桌面一并冻结运行。前一 `bfc11754` 原生桌面首轮实际为旧路径 6 项通过、新界面 4 项在范围选项尚未渲染时因测试的否定数量等待而失败，源码指纹未变；已改为等待准确范围选项，并使用真实玩家交接按钮，复验结果另记，不抹去首轮失败。

组合反例进一步确认：F13 后首次保存关于原冻结角色的 V1 事实，以及原模型 Oracle 完整批次，也可能以不同顺序追加可选字段。新写入的逐条事实和 Oracle 批次事件显式带 `stateLayoutVersion: 1`，仅据此选择现行解析顺序保存；缺失该标记的历史事件继续原顺序回放，不在读取、导入或旧 reducer 分支中悄悄重排。布局元数据不改变候选、确认、引用或模型权限。原 runtime-reference 条目沿其既有版本化 discriminator 保持同一布局。新增两个实际反例加旧事实、完整 Oracle 采用/拒绝/回执/分支和纯回放共 4 文件 33 项通过。

### 35.84 已创建实例参与新局势的版本化引用（2026-10-17，纵切面验证中）

本单元属于跑团 open 产品研发、S3 运行私域。实例由既有机械实体、库存和 F13 journal 拥有，局势定义/采用由本局会话和原 Harness 拥有；世界、作者 Campaign、冻结规则与媒资 owner 不变。继续使用登记来源 `ttrpgOpenSituationInput` / `ttrpgOpenPublicSituationInput`、原 Skill/正式入口/候选和运行事件，无新表、作者 AI 写字段或第二套模型/DB 入口。

新增版本化 `runtimeEntityReferencePolicy` / `runtimeEntityReferences` 子合同；缺失标记的旧窗口、共享请求、来源、Manifest 和采用回执保持原格式与权限。新窗口须在明确开始时冻结原实际创建 sourceRef、operation/plan hash、来源/规则及准确受众/接收者；新快照 hash 是完整性证据，实际身份仍须与先前 F13 journal 和冻结内容逐项相符。不得以候选、未来创建、可变属性、重算 hash、别团或其他用途恢复引用权。原 Campaign 的 `characterTemplates` 和 `entityBindings` 不追加伪造运行条目；内核使用独立只读身份映射解析实际 NPC、地点与物品，实例身份不证明当前存活、在场、库存或行动许可。

真人 GM 新请求可明确选择本局已创建对象，来源合同/目录及 reader 升为有标记的新版本；所用实例正文、原冻结模板、NPC/物品定义和身份快照须实际完整交付并写入引用证明。共同资料新请求只选择当前全体玩家均保留原权限的实例；模型只接收身份、名称、原来源和知情范围，不交付私密地点、NPC 档案、装备、完整模板或当前机械状态。共同模型仍受原谓词 allowlist 限制，不能把对象身份变成位置、持有或资源事实。UI 选项默认关闭，共同选择变化清除共享/一次采用勾选；继续原请求使用其原冻结策略。

新采用回执保留这次原快照，仍区分真人 GM 审阅 V1 与 AI 主持本次明确委托 V2。旧历史身份仅供验证旧定义，不能供下一候选借用；新候选先按本次当前身份校验，再用原采用历史闭合完整目录。实际启用、I1–I7、玩家行动、线索发现和后续维护消费原已采用定义，不自动授予知识、结算机制或推动时间。失败回滚保留原头；领域提交后终验中断、明确结束、原 Run/父会话删除、分支与完整备份只恢复准确历史，不恢复新发送/采用权。

首轮实际引擎链 5 项通过，覆盖完整登记来源→候选→明确采用→独立启用→玩家发现/维护，以及真实采用存储回滚、终验中断后停止与零重发修复、旧窗口拒绝新引用、前后切点/父与 Run 删除/完整导入；独立身份快照 4 项通过。此前相关 5 文件 28 项通过；扩大关联回归、最终静态/构建/原生浏览器及当前 head 全量闸门分别留证，不将旧提交结果计作本单元通过。实际 HTTP/UI 新用例已编写，尚待冻结运行；真实 provider、独立真人、30+worldTurn、明确观察传播、新事实 UI/模型路径与 P10 继续未完成。

上一提交 `b86b2d95` 的 open 预览云端实际为 98 项通过、2 项失败；`8ec28099` 定向原生复验为 9 项通过、2 项失败，源码指纹未变化。两组失败均是实体桌面测试在点击“结束”后未等待异步持久化便断言 epoch 已关闭；已改成等待实际状态，待复验，不记为通过或抹去原失败证据。默认完整 CI 结果另行记录。

扩大关联的 14 个回归文件共 110 项通过，覆盖完整来源与 Gateway/Harness、原共享授权与一次采用、late seat fence/传播、旧 v14 准备请求、原 Run/导入来源和纯回放分组。17 项工程步骤通过，包含官方实时指标生成、架构/表/AI Manual/正式入口/可达性/文档/路线图/上下文/指标、全仓 lint、严格类型、生产构建和原体积门。此证据不含本单元尚待执行的实际界面/HTTP浏览器、完整 CI/E2E或真实 provider/真人验收。

后续补强的实例纵切面 8 项全部通过：共同模型生成的实际新 NPC 局势也经过玩家规则行动、风险确认、知识结算、两轮时间与局势维护，三名原接收者分别读取真实发现；不是仅测采用/激活。新增实际原请求的三种恶意响应分别尝试未读取的私密地点、NPC 装备和只凭身份断言当前位置，均保存原回答并以 `blocked` 阻止采用；玩家主持状态不含私密引用，机械状态、时间和知识不变。首轮反例因测试误期望 `manual-repair` 而失败，已按实际阻止状态修正，未放宽产品校验。新增工作只补测试与证据，产品源码相对 `4d30382c` 未改变；该提交冻结的原生与完整 CI/E2E结果仍须单独收集。

冻结提交 `4d30382c` 的 open 预览云端运行 `38959172774` 实际 102 项全部通过（39.4 分钟），包含实际实例/局势 HTTP 界面和前述关闭窗口等待修复；发行包构建 `38959172765` 也通过。该结果不含之后的人类事实工作台或补强的三种恶意响应回归；默认完整 CI、原生串行验证及最新 head 的结果仍独立收集。

### 35.85 真人 GM 事实审阅与确认界面（2026-10-17，开发预览验证中）

本单元属于跑团 open、产品研发、S3 运行私域。入口为独立真人主持桌面板，交付为原 Oracle 依据下的手写事实审阅、明确确认、替代和退休记录。会话事实仍由 `ttrpg.fact.asserted` / `ttrpg.fact.retired` 及原唯一账本拥有；原 `commitTtrpgOpenOracleFactV1`、显式运行引用 API 和退休 API 保持权限。复用原验证器做预览和实际提交，不复制字段门或写表；不增加 AI 来源/写字段、表、模型调用、世界或媒资写回。

原冻结引用为默认，只有明确选择已创建对象才使用 `committed-runtime-entities-v1`。准备审阅须冻结准确作用域、本人、团局、来源、原 Oracle、参考策略、原命令/基线和事实候选 hash；同时展示真实名称、谓词/值、全文、来源、受众与准确接收者。手写候选仅在本页内存中待审，不伪装为模型产物；刷新/身份交接清空未确认内容，编辑或状态变化须重审。明确确认只提交原版本，存储失败保留原命令供核对/幂等重试，不隐式重新准备或确认。

只读历史保留活动/退休状态与真实来源；替代保留旧事实来源和理由，退休不删除历史。玩家和 AI 主持兼任主持不读取此私域面板；暂停、被动局势/复盘窗口、待确认实体、行动/祖先结算或未决模型请求期间不得准备新事实。独立咨询控件只调用原开始、Oracle 和关闭命令，读取不创建窗口；有模型请求时沿原请求面板收尾，不能借新关闭按钮遗漏其恢复记录。

退出需证明真实 V1/运行引用确认、精确审阅、实际谓词消费、取代/退休、零模型发送、存储回滚与幂等/stale、对受众/玩家决定/机械 owner 的拒绝、身份交接和完整备份；服务、实际组件及隔离原生 UI 分别留证，最新完整 CI/E2E、真实 provider/真人长局、后续观察传播、事实模型新协议与 P10 仍独立完成。

当前已接入独立主持面板与原命令的共享预检；原退休构造仅抽取复用，旧 payload/权限保持。准备/提交均重核真实席位和准确作用域，审阅显示内容由实际来源重新生成，重新计算摘要也不能伪造无害标签掩盖其它操作。未知原请求仅阻塞其当前窗口，不能因保留一条已明确结束的历史未知回执而锁住以后的人类事实确认。服务及实际 React 组件首轮合计 12 项通过，涵盖确切审阅、原命令存储/返回断点、晚到准备结果、私密接收者、被动/待确认窗口、原机械状态和分支/删除/完整导入。两个原生 UI 场景已编写，覆盖刷新清除待审、存储回滚重试、替代/退休/备份、手机宽度、无模板/无模型配置咨询和玩家交接，尚待冻结执行。最终静态、关联回归、构建与当前 head 全量 CI/E2E另行记录，不以现有 12 项代替。

扩大关联的 8 个回归文件共 61 项通过，覆盖原事实账本、运行实例事实、原 Oracle 审阅、实体桌面、纯回放边界及局势采用。17 项工程步骤通过：官方指标生成、架构/表/AI Manual/正式入口/可达性/文档/路线图/上下文/指标检查、全仓 lint、严格类型、生产构建、原体积门及 diff 检查。原生 UI 与当前提交完整 CI/E2E尚待执行，不以这些结果代替真实 provider、独立真人或长局验收。

后续界面核对修正“允许运行对象”选项的含义：勾选只扩大本次可选范围；实际仍只选冻结对象时继续走原 V1，不要求虚构一个运行创建证明。未知或未创建对象仍由原验证器拒绝，未勾选仍不能引用运行对象。审阅与记录中的布尔值统一显示“成立/不成立”。新增实际服务反例后两个服务/组件文件合计 13 项通过；原生无模板路径同时补上勾选后仍确认冻结对象的场景，尚待执行。

上述界面修正后的 8 文件 62 项关联回归与同一组 17 项工程步骤全部通过；新原生路径及最新完整 CI/E2E仍待结果。已排队的原生工作树冻结在 `2006b9b8`，不含这次选项语义与中文取值修正，后续不得把它的结果标为最新 head 的全量验收。

### 35.86 真人 GM 的版本化 Oracle 实例事实候选（2026-10-17，引擎/API与操作界面验证中）

本单元继续跑团 open S3 产品研发，入口为真人 GM 事实桌面的明确模型请求，交付为按本次原 Oracle 和实际实例来源生成、逐项审阅、单次确认的事实候选。团局事实/Oracle 及原 Run 仍是唯一 owner；复用登记的 Oracle 来源、只读 Skill、Gateway/Manifest、原模型调用和事实事件，不增表、作者可写字段、机械/世界或媒资写回。

新窗口以已保存的准确 Oracle 为依据，明确冻结独立版本化实例策略及输入修订。策略只允许该 Oracle 目的，绑定真实先前 F13 身份、原模板、来源和准确接收者：公开咨询只读公开实例，全队咨询只读全体当前玩家均有原权限的公开/全队实例，主持私域咨询才可包含私密/主持对象。知道 NPC 不透露装备；身份、名称和原创建证据不授予当前位置、库存或规则能力。策略全文不得把主持全部对象带入公开/全队模型输入。无原创建证据、相同 hash、自报引用或模型提及均不足以授权。

旧 Oracle/事实归一 V1 及原已准备请求保持原字节与冻结权限；新策略须走明确的新准备版本，不能使旧入口自动扩权。新调用把同一策略、真实 Oracle、Skill/Run、模型身份、预算、实际完整正文和 Manifest 绑定；模型回答先为候选。真人审阅准确解释及全部提案并逐项采用/弃用，内部只从原新版本调用与实际 F13 推导运行事实证明，不能转作人类原创。仅用冻结对象的提案继续沿原事实基础；单条、批次和回放都验证新模型来源，旧模型仍无运行引用权。机械 owner、玩家决定、知情范围和 F1–F4 保持。

刷新/读取不发送，继续/停止/未知结果/终验修复沿原请求；导入或删除原 Run 不产生替代执行权。反例需覆盖公开/全队秘密隔离、旧请求兼容、未创建/跨团/未来/不同 Oracle 或用途、真实交付篡改、暂停/stale/待处理业务、原子批次回滚和幂等、切点/父删除/完整备份及原实例/冻结来源不变。新版事实归一仍须另行保留原已接受解释和弃用决定，不能隐式升级 V1；明确观察传播、P10、最新全量闸门及真实 provider/独立真人/30+worldTurn继续独立完成。

当前只完成共享身份 owner 内的纯合同/来源匹配基础，未接入新窗口、登记来源读取、模型请求、候选确认或界面，旧模型权限保持原状。新策略保存原 Oracle、本次接收者和实际创建切点，精确求值公开/全队交集/主持私域，后续 F13 不加入旧策略；原局势的相同 journal 投影抽取复用，结果不变。6 项实际创建/咨询的合同测试及扩大 4 文件 22 项回归通过，含公开/全队恶意扩大到实际私密地点/装备、重新计算 hash、未创建对象、不同目的/咨询/版本、未来切点及原实例局势兼容；同组 17 项工程检查、类型、构建与原体积门通过。这些证据仅证明合同基础，不代表新版模型事实路径或最新全量 CI/E2E已完成。

后续引擎/API 接入更新上述先行基础状态：普通 `continue-host` 仅在明确携带独立 Oracle 实例策略时形成固定输入、一次调用、零行动的专用窗口；不能借作额外咨询、实体计划、其他模型目的或人类原创确认。正式 V2 准备才可使用该策略，旧 V1/事实归一入口提前拒绝借用，新 Skill 的新准备绑定 v3，原冻结请求继续使用原绑定。窗口、原 Oracle、接收者、完整创建快照、Run 和请求摘要逐项匹配。

完整创建策略只留在内部授权与原调用证明中。实际模型正文只交付版本化身份范围与准确名称、种类、受众/接收者及原创建来源；不交付内部模板 key、操作 key、计划 hash、NPC 档案或当前机械属性。登记来源和 Context Manifest 必须完整交付同一投影，目录、自报 hash 或旧正文均不能代替。模型事实始终保留原候选来源，真人逐项审阅后由原批次/单条命令生成与该调用匹配的 F13 叶证明；仅冻结对象的提案不伪造运行引用。新批次回放同时校验实际实体 journal，不改原事实 basis。

新协议同时收紧登记的作者指引/历史叙述来源：先按原咨询受众过滤目录，再用同一纯规则选择指引；公开只读公开指引，全队不能读主持/私人指引，主持私域仍不取得其他玩家的私人指引。全队叙述保留原 party 受众与准确接收者，不进入公开咨询。新目录/正文的权限修订及选择域绑定原 Oracle 与实例快照，旧请求无策略时保留原字节。实际冻结作品的公开/全队/主持指引及真实行动、征兆、发现、门检查、人工叙述后的公开/全队咨询均已补反例；不使用伪造历史或跳过原规则门的夹具。

取消、原回答补回执、明确未知结果、结束及停止回执继续沿原请求和 Run；实体与实例事实共享原草稿收尾内核，原实体导出名称、决定和回执字节保留。已确认事实不能改记为放弃，结束决定先保存再收尾；未知结果/费用不清零，晚到执行者不覆盖终态，实际回答只按原字节恢复。当前 12 项模型纵切面、5 项原请求恢复与 5 项真实指引/叙述范围回归通过；扩大 18 文件 137 项通过，包含旧 Oracle/归一、原 v16 已准备请求的原字节续用、实体桌面/采用、人工事实界面、局势恢复和纯回放。17 项工程步骤、严格类型、全仓 lint、生产构建及原体积门通过，证据文档另作定向核对，未降低阈值。两个原生 HTTP/API 用例已编写、尚待冻结执行；操作界面、新版归一/AI 主持共同事实路径、最新完整 CI/E2E和真实外部验收继续未完成。

上一工作台提交 `3f5b296e` 的 open 云端运行 `38964604726` 实际 104 项全部通过（32.2 分钟），包含人类事实桌面的两条实际 UI 路径及原 102 项；发行包 `38964604711` 通过。这不是本节新模型协议的浏览器或完整 CI结果。

操作界面后续接入更新上述 API 提交时的“界面待接”状态：真人 GM 的独立面板只列符合原 Oracle 范围的实际已创建对象，默认不选择咨询或发送同意。新请求明确绑定本次目录快照、原咨询、准确接收者、模型配置与预留上限，其他活动窗口先结束；来源/进度/费用变化在开始原窗口前拒绝。原窗口已保存而本地 Run 准备失败时，只能明确结束该空窗口；读取不自动补发。正式 V2 生成复用原入口，在原准备回执后提供可停止的准确请求身份；旧 V1/冻结请求无此回调时不改变正文与权限。

候选全文显示原解释、每条事实的主体/含义/取值、依据、受众、接收者与替代理由，解释和逐项决定均默认未选择。主持明确接受/拒绝解释、逐条采用/弃用并填写必要理由后，再另行确认本版本；编辑决定须重审。原命令返回中断或暂时无法读取，不丢准确确认选择；只有实际尚未提交的候选可以明确返回重审，已确认/拒绝记录保留原选择。确认、原回执修复、停止和结束分别调用原 owner。模型候选确认后不自动结束窗口；停止先保存原未知/回答及结束决定，再中止本机等待。已确认记录不能转为放弃；导入或缺少原本地 Run 仅保留历史状态，不创造继续/确认/修复权。

新面板在同一组件内按项目/作品/团局/真人身份立即遮蔽旧私域内容，旧异步读取和晚到结果不能落入新身份。事实与模型桌面复用同一真人 GM 来源核对；模型桌面与原实体桌面复用原本地 Run 的精确定位。没有新增表、字段、来源 key、模型入口、世界或机械写回。8 项实际服务与 5 项实际 React 组件测试、扩大 20 文件 150 项回归通过；最后命名调整后的 5 项组件回归也通过。17 项工程步骤、全仓 lint、严格类型、生产构建及原体积门通过，未增加检查豁免。四条实际 HTTP/UI/刷新/回滚/停止/备份及原准备请求续用的浏览器用例已编写、待冻结执行，完整闸门继续按真实回执验收，不能用界面接入冒充已通过原生浏览器或整体验收。

回执补强另经工作台实际命令覆盖四个正向断点：原回答已观察但 `model.responded` 未落账、候选检查点未保存、事实已提交但确认终验中断、窗口已关闭但本地停止回执中断。恢复按钮只补同一 Run/请求的缺失记录，不再次发送、不改已确认或弃用的决定，不重复事实、对象或原咨询；补强后该服务文件共 12 项通过。该后续仅增加回归与说明，产品实现与前述 17 项检查对应的实现相同。

API 提交 `077cc0d2` 的 open 云端运行 `38974221103` 实际 106 项全部通过（26.5 分钟），包含该版本两条真实 HTTP/API 路径和前述 104 项；发行包 `38974221157` 通过，完整 CI仍待终态。此结果不包含后续新模型事实面板的四条 UI 用例。更早的 `4d30382c` 本机冻结原生 18 项通过，`npm run ci` 实际 944 文件 5587 项及原构建/体积门通过；独立默认 E2E另行运行，不把旧版本结果记为当前 head 全量完成。

后续实际回执：`c42cb04f` 的 open 云端运行 `38977449855` 实际 110 项全部通过（25.4 分钟），包含上述四条模型事实面板 UI/HTTP 路径；发行包 `38977449901` 通过，完整 CI `38977449899` 仍待终态。`4d30382c` 的本机默认 E2E 实际 287 项通过、78 项按默认开关跳过（50.9 分钟），与原生 18 项、完整 CI 5587 项共同完成该旧冻结版本的三步验证，tracked 来源未变化。各结果不替代后续归一版本或真实 provider/真人长局验收。

### 35.87 已接受解释的版本化实例事实归一（2026-10-17，引擎/API与操作界面验证中）

本单元继续跑团 open S3 产品研发，入口为当前真人 GM 明确选择已接受的原解释，再授权一次事实归一；交付仍是原解释不变、逐项审阅后才可确认的事实候选。原 Oracle、解释审阅、事实及原 Run 仍归本局，世界、产品发行包、机械状态、玩家决定和媒资 owner 不变。复用既有事实归一 Skill/登记来源/模型入口、辅助槽、候选、审阅/终验及生命周期，不新增表、字段或来源 key。

新归一必须走明确的新准备版本和独立、固定输入、一次调用/零行动的被动窗口，绑定真实已接受、非归一的原审阅及其 hash、原咨询和原模型实例读取策略。原审阅必须确实来自已成功的新 Oracle 实例调用，完整原创建快照逐项对应实际先前 F13；后续创建对象不加入原范围。拒绝解释、嵌套归一、其他咨询/用途、未知/未来切点及重算 hash 的自报策略均不能提供来源权。仅冻结对象的旧归一继续原 V1，不能靠本次新实例存在、旧来源文本或旧冻结 Skill 自动扩权。

策略必须保留原审阅的完整解释与采用/弃用决定。新模型只能整理事实，解释逐字沿原审阅，不重新解释 Oracle，不复活原已弃用的同一语义元组。当前受众与准确接收者另行核对：原全队解释只允许原接收者的当前子集读取，新加入角色不得自动接收旧全队解释；原公开解释可由本次实际接收者读取；主持私域继续只允许当前真人 GM，兼任主持不取得私域权限。原完整创建策略和原接收者保持不可变，新的最小读取投影由系统确定性派生，不能改写原策略来伪装权限。

策略基础仅作纯来源匹配，不授予读取、派发或确认权。正式接入时，登记来源须实际完整交付同一版本的身份/名称/创建来源、原已接受解释及真实弃用提案；模板、计划、NPC 档案及机械属性不进入正文。作者指引与历史叙述遵守同一新归一范围。Skill/Run、辅助槽、Manifest、模型身份、预算、原回答和候选均绑定原新请求，旧正文或目录不能代替真实交付。原已接收/弃用解释在分支、父删除或完整备份中仍是可审计历史；基于其新授权的派生请求与旧 Run 的执行权分别核验，不能制造替代旧执行或以本地 ID 重映射冒充原调用。

真人逐项审阅与明确确认仍由原事实 owner 执行，模型来源和归一来源保留；仅冻结对象的事实沿原基础，运行对象叶证明只能来自同一新调用实际读取的原创建证据。原辅助槽对本世界轮次及祖先全部预留计数，取消、失败、换窗口或分支不返还次数。读取、继续、原回执修复、未知结果、停止与结束沿原请求分别处理，不在接受原解释后自动发起付费归一。正反例、旧 V1/已准备字节、准确接收者变化、实际正文篡改、真实回滚/幂等、四类回执断点、分支/导入与原生 UI/HTTP及最新全量闸门须分别完成；当前没有新归一模型或界面验收证据。

当前先行实现仅为共享身份 owner 中的闭合策略、来源匹配及摘要校验：绑定真实已接受解释、原成功实例调用、原 Epoch 和原 F13 范围，当前全队接收者只能收窄，原读取策略不改写。分支须先完成新的 Session Zero；祖先原审阅只能经真实切点事件读取，尚未接受解释的更早切点不能借用。父删除和完整导入后，原解释/弃用决定、原回答及创建证明保留；纯策略不恢复原 Run 执行权。祖先来源判断下沉到既有 SourceRef owner，旧分支模块保留原导出，函数语义和原分块预算不变；不增加构建组例外。7 项实际创建/调用/审阅的基础测试及扩大 6 文件 46 项回归通过，含旧 V1 归一、原 v16 已准备请求、运行事实生命周期和纯回放边界；同组 17 项工程步骤、全仓 lint、严格类型、生产构建及原体积门通过。该结果不表示新归一窗口、登记正文、模型请求、候选确认或操作界面已经接入。

后续引擎/API 接入更新上述先行基础状态：新的固定输入、一次调用/零行动被动窗口单独绑定 `normalizationRuntimeReferencePolicy`，只接受明确的归一 V2 准备和原已接受解释；旧 V1、Oracle V2、其他目的或手动原创事实不能借用。原事实归一 Skill 的新准备冻结 v3，旧已准备请求继续原冻结 Skill/正文。新调用的原解释、hash、Oracle、实际 F13 身份、准确接收者、辅助槽和原窗口逐项匹配；回放使用原已验证窗口的接收者，新读取使用当前真实 Session Zero，后来的名单不能反向改写旧账。

新的 V1 准备若选择新版实例解释，即便处于普通旧窗口，也须在创建 Run 前拒绝并要求明确 V2。此前已经保存的 V1 请求保留原冻结来源与语法，不能因此获得运行对象叶证明。兼容夹具从未改动的旧提交 `4d30382c` 和 `21430dd7` 实际准备后捕获，分别保留普通原解释和新版实例解释对应的旧归一 v2 Skill、完整 Run/正文与原接收者；续用校验不得以现行 Skill 重建旧请求。

登记来源必须完整交付同一原咨询、原解释及弃用提案，实际请求只带原创建身份/名称/受众和来源，不带模板、计划、NPC 档案或当前机械状态。当前接收者投影与原完整策略分别保存；作者指引和历史叙述也受本次归一密级约束。原弃用提案若含本次范围不能读取的更窄私域内容，整次新归一拒绝；不得删掉弃用决定继续，也不得把私域提案带入公开/全队请求。实际三份来源正文、冻结 Skill、Manifest 与 Run 在准备、派发、确认和修复时核对，单独 hash/目录或伪造正文不能提供权限。

模型仍只输出事实，解释沿原已接受文本；完整审阅或单条明确确认继续同一事实 owner，保留归一来源和原模型来源。仅冻结对象保持原 basis，运行对象叶证明仅来自这次实际读取的原创建范围。分支和完整导入可在新授权后基于可审计历史派生一个新请求，但不能恢复旧 Run 执行权；每世界轮辅助槽对祖先及全部预留计数，取消、失败、换窗口不返还次数。原请求停止、已观察回答修复、明确未知结果、确认终验与关闭后本地停止回执复用既有内核；已确认结果不能改记为放弃，晚到回答不覆盖已保存终态。操作界面、原生浏览器与最新完整闸门继续分别验收。

当前引擎验证：归一的 11 项请求/确认纵切面、4 项真实授权/分支/备份生命周期、6 项原请求恢复、4 项实际指引范围，以及 9 项合同/旧准备兼容回归通过；扩大 14 文件 110 项全部通过，包含旧 V1 归一、原 v16 请求、原 Oracle/实体服务与 React 界面。实际四人缩为三人保留原四人策略；新加入席位不能读取旧全队解释，公开解释可以在新授权后交付，已归一的旧全队事实不会因后续入席自动公开。实际切断回答、候选、确认和停止回执后只补原记录，三份完整来源正文损坏时确认回滚，恢复原字节后才可确认。17 项工程步骤、全仓 lint、严格类型、生产构建与原体积门通过；最后的夹具、类型与文档另经 6 项定向检查。两条真实客户端/替换 HTTP 的 API 浏览器用例已编写、待冻结执行，尚未记为本版本原生或完整 CI/E2E通过；新归一操作界面及真实 provider/独立真人/长局验收继续未完成。

后续操作界面接入更新上述“界面待接”状态：真人 GM 独立的“事实整理”面板明确选原已接受解释，先展示完整原解释、原弃用提案/原因、原创建对象及本次准确范围，再勾选一次模型请求与预留上限。未选择或未同意不发送，接受原 Oracle 不会自动触发整理；来源 hash、进度、范围、费用或模型变化时重新核对。当前或真实祖先的已接受原解释可作为新授权来源；已归一、拒绝解释和不满足当前范围的历史不进入可选来源，原记录保留，完整性错误须拒绝读取。缺少旧本地 Run 不等于恢复其执行权。

原 Oracle 与新事实整理在同一跑团语义工作台内核中共享原请求定位、候选投影、逐项审阅、准确返回断点重试和原回执修复；用途为明确闭集，旧 Oracle 的导出、决定、命令与回执沿原路径。整理沿用原解释，接受/拒绝的是本次整理结果，不撤销原接受或改变原弃用。确认不会自动结束窗口；已确认不能改记为放弃，空窗口、原准备续用、已观察回答修复、未知费用/停止、关闭后终验分别按原 owner 处理。界面在相同组件的身份或用途切换时立即遮蔽旧数据，旧异步读取和晚到结果不进入新身份/用途；未完成操作期间不能切换原请求。新界面继续受既有开发预览开关约束，不新增表、字段、来源、模型入口、机械/世界或媒资写回。

界面接入验证：13 项实际服务测试、6 项实际 React 测试通过，扩大 6 文件 49 项回归通过，包含旧 Oracle 工作台、原准备字节和真实分支/完整导入。测试覆盖当前本人授权、原已接受文本与弃用决定可见、一次请求同意重置、候选待确认、原子冲突/重审、准确提交返回断点与暂时读取失败、Stop/晚到回答、身份和用途切换、父删除后基于祖先原解释的新整理。四条新增真实 UI/客户端/替换 HTTP 浏览器用例已编写，原生、最新全量 CI/E2E与外部验收仍待独立回执。当前 17 项工程步骤、严格类型、全仓 lint、生产构建与原体积门通过；UTC 跨日触发的 11 个旧运行 Skill 验证日期过期，另由其登记的两文件 8 项工程回归重新核验后单独更新日期，45 天门限与 Prompt/权限/运行行为不变，该记录不代表真实模型验收。

后续引擎实际回执：`6486f35a` 的 open 云端运行 `38983292799` 实际 112 项全部通过（27.7 分钟），包含两条新归一 API/客户端/替换 HTTP 路径；发行包 `38983292815` 通过，完整 CI `38983292785` 仍待终态。这是操作界面接入之前的引擎版本证据，不能替代新增四条整理工作台的实际页面验收。界面最后的文案和证据更新另经 9 项定向检查通过。

### 35.88 AI 主持的共同 Oracle 事实来源（2026-10-17，只读基础施工中）

本单元仍为跑团 open S3 产品研发。入口目标是在 AI 主持桌，由当前真实人工主持明确选择全体本次活动角色均可读的原 Oracle，再单独授权一次解释/事实候选，并由原真人确认者逐项审阅。团局与原 Run 拥有候选、事实和回执；冻结世界、发行包、机械与媒资 owner 不变。原真人 GM 私域事实/整理入口保持原合同，不能通过换标签或把玩家主持当作 GM 复用其私域来源。

先建立独立登记的 `ttrpgOpenCommonOracleInput` 只读基础：复用原事件/来源/授权读取和所有实际玩家（含 AI 队友）的投影，求原 Oracle 历史的真实交集；旧共同局势/复盘返回字节不变。只提供公共或所有当前接收者均有权读取的全队原问题/最终结果、准确原来源、冻结解释限制、允许的语义谓词、共同冻结观察和当前已确认事实，以及明确范围的冻结对象/已创建实例身份。公开 Oracle 不读取全队文字，全队 Oracle 不借本次交集扩大原接收者；新席位不自动获得旧全队结果、事实或实例。发行时机械初值保留 release-time 标记，不能当作当前值；已退休事实不入来源。NPC 私密档案、玩家个人档案、原始头/种子/骰点证明、装备/机械状态、模板全文、未确认候选/旧私域回答、记忆与传闻不进入此来源。实例只提供原创建身份、名称、来源和知情范围，装备不随 NPC 身份公开。

来源目录、检索、全文、hash、原冻结来源与实际头证明使用同一准确范围。正文须完整读取，禁止原始读取、截断、跨角色/项目借用；固定目录在来源、进度、席位、同意或安全状态变化后失效，内部验证错误不向共同读者泄露私域说明。本基础不新增表、AI 写字段或模型入口，不赋予任何既有 Skill 新来源权限；只读不咨询、不预留、不创建 Run、不生成或确认事实。工具声明须以单独版本记录唯一新来源增量，旧已准备请求保持原来源和工具合同。

后续模型接线须冻结单个准确 Oracle、全体接收者、完整交付及一次调用/零行动预算，由当前真实人工主持另行同意；新候选必须有独立用途/Skill/来源证明，不能重标旧 GM 私域候选。确认仍由现有事实 owner 和实际真人逐项决定，不引入 AI 自动事实采用。候选、确认、停止/未知费用、恢复、切点/父删除/完整备份及真实 UI、最新全量闸门与外部模型/真人长局分别验收；本只读基础不代表该用户流程完成。

当前只读基础验证：8 项专项通过，覆盖实际 AI 主持/Oracle/F13、NPC 与其私有装备分离、公开范围、真实确认/私人/退休事实、实际新席位、父团局删除和完整备份、目录/全文/预算/禁止原读、暂停与并发读取。9 文件 57 项关联回归通过，保留旧共同局势输入及 v15/v16/v17 实际已准备请求的原权限和字节续用。工具升级为 `agent-read-tools-v18`，实际 snapshot hash `633a1385e92901aa1bba03f99abe413a68161577954917bd4073394fad9fdc18`；去除唯一新来源后准确恢复 v17 hash，所有旧 Skill 均未取得新来源。17 项工程步骤、全仓零 warning lint、严格类型、生产构建及原体积门通过；AI Manual/实时指标由官方生成器刷新。首轮测试误把最小化待审 UI 投影当成原实体计划，已改从真实 F13 计划读取键再复验，未扩大领域权限。本基础尚无新模型请求/候选/事实采用或用户界面，不计为该路径及最新整仓验收完成。

单次请求证据基础继续在同一 owner 内冻结：`common-oracle-fact-candidate` 只接受明确请求本次一个候选的决定，绑定真实源团局键、发行/规则 hash、Session Zero 修订、具名真人席位修订、原读取切点、单个 Oracle 与实际完整输入 hash、全体准确接收者、同一实例策略、模型和一次调用/零行动预算。逐条真人审阅标记固定为 true，不接受旧局势的一次自动采用决定。证据使用稳定团局来源，不向运行 JSON 引入本地项目/作品/Run 编号，也不增加新的状态字段。

实际来源匹配同时检查目录与完整正文、完整来源投影 hash、规则、全体角色及原实例正文；仅改 hash、替换或删去实例范围、借未来咨询/创建证据、改变模型/预算或增加自动采用能力均不能沿原证据混用。来源未变的后续桌外讨论可以保持相同来源证明，但这不代表取得原窗口或任何新执行权；正式命令仍须另行复验当前本人、原切点、一次预算、同意、准备/派发与提交权限。本阶段只提供闭集解析、来源匹配和 hash，仍没有新请求入口、Run、模型候选或事实确认。

请求证据专项 6 项通过，扩大 10 文件 63 项全部通过；17 项工程步骤、全仓 lint、严格类型、生产构建及原体积门通过。覆盖准确公共/全队正文、私域/扩权/无同意/未来来源拒绝、篡改目录或正文、损坏及重新计算的实例 hash、改变来源目录和仅发生桌外讨论的区别；构造和匹配前后零新 Run、零新窗口/事实写入。首轮有一条测试预期的错误措辞过窄，实际损坏快照已被拒绝，修正断言后复验通过，领域拒绝逻辑未改变。正式模型链、真人逐项确认界面及当前 head 全量验收继续未完成。

后续实际回执：界面版本 `9c41c2ac` 的 open 云端运行 `38986075030` 实际 116 项全部通过（47.2 分钟），包含四条新事实整理 UI/客户端/替换 HTTP 路径；实际手机截图已检查，发行包 `38986075044` 通过，完整 CI `38986074995` 仍待终态。共同来源/请求基础 `08340576` 已推至草稿 PR；该提交的生产 dist 在全新 Chrome 资料中按两个导入顺序实际加载，并完整读取两个合成团局来源资源，逐字匹配真实领域夹具，零新增事件/Run且无页面错误。后者是生产模块与只读来源验证，不计为新模型链、界面或全量 E2E。该提交云端三项运行和本机 `9c41c2ac` 冻结原生→CI→默认 E2E 队列继续分别收取回执。

### 35.89 AI 主持共同事实窗口的本人授权与生命周期（2026-10-17，施工中）

本单元继续跑团 open S3 产品研发，当前真实人工主持在 AI 主持桌明确选择原共同 Oracle 与本次完整来源，再授权一次候选窗口。团局拥有可恢复窗口及后续事实，原本地 Run 将拥有正式模型证据；世界、发行包、机械、玩家选择与媒资 owner 不变。入口、身份、实际参与者/同意、读取切点、原咨询/完整正文、全体接收者、实例来源、模型和预算均须由确定性系统在提交前复核。复用原 epoch、事件 CAS、预算和关闭，不新增表；纯请求 basis 不含本地编号，外层授权记录原 Run 与逐字合同作为不可重绑的来源证明，以明确可选的 `commonOracle` 证据冻结新窗口，旧缺省序列化形状保持。

该窗口只允许本次共同解释 Skill 的一次调用、零角色行动，以及原候选的真人逐项审阅和安全/停止/结束；不能挪作原 GM 私域解释/归一、实体或局势生成、连续主持、额外 Oracle 或行动授权。每次准备须先检查用途，再读取其他目的的资料。闭集请求证据与来源 hash 仍不代替实际本人/席位/阶段/安全授权，也不代替未完成行动、继承恢复、实体计划、未知费用和辅助额度的检查。公开/全队原结果不能因新席位或分支被扩大，原始来源和已确认历史不改写。

独立登记共同解释 Skill 与正式入口，只读本次共同来源、不写作者字段。实际授权前先创建单个原本地 governed Run、原 step 和准确授权工件，再在同一正式事务核验原 Run/事件/工件后提交被动窗口；Run、epoch 与请求身份由原切点、授权和 basis 派生，避免相互 hash 循环。原本地 ID 与逐字合同只作不可变来源证明，导入不重映射成新执行权，纯 basis 继续无本地编号。授权提交前回滚保留可见失败 Run，同一旧操作不能悄悄另建；提交成功但返回中断保留原 Run，准确重试只返回原窗口回执。

先保存空窗口结束决定，再终止其原本地 Run；暂停后仍可明确收尾，停止回执中断只补原回执。缺失、导入或外域的原 Run 不能重建或执行；当前本人可结束本桌零正式调用的旧窗口，且不修改原团局或异域 Run，再以新的明确决定授权新的本地请求。有正式调用即不能使用空窗口收尾。切点、分支与完整备份保留原来源；子团完成新的 Session Zero 后才能基于可读历史另行授权，父团删除不继承原执行权。

当前完成本人授权、只读/准确重试、空窗口收尾及原 Run 来源隔离的 9 项专项，扩大 15 文件 110 项全部通过，含旧 GM 读取前拒绝、实际存储回滚、授权提交返回中断、暂停后关闭/停止回执中断、准确工件损坏、原 Run 删除、完整备份/导入和父删除/前后切点。独立用途/Skill/入口、call marker 和预算仅作为后续共享 Harness 接线基础；尚无公开模型准备/发送、候选或逐项确认 API/界面。正式交付、回答、候选及确认继续施工，只有其闭包验证完成后才称本用户流程可用。公开 open 入口维持开发预览，本单元及工程模拟不构成真实 provider、独立真人或整体产品验收。

最后调整后的同组 15 文件 110 项复验通过，17 项工程步骤全部通过，含官方指标、架构/表/AI Manual/入口/来源、文档与上下文治理、全仓零 warning lint、严格类型、生产构建及原体积门。原 Run 权威与事件/工件在正式事务中一起复核；旧请求未增加共同来源或重新构建正文。当前单元仍需生产模块加载及后续正式模型/确认和最新整仓验收，各证据分别记录。

本人授权基础已提交为 `c1f635f5`；该提交的实际生产构建在全新 Chrome 资料中按两种顺序加载共同来源与正式 runtime API 模块，均无页面错误。前版界面 `9c41c2ac` 的本机冻结原生浏览器 32 项实际全部通过（7.1 分钟），来源指纹未变；随后完整 CI 和默认 E2E继续运行。此项不替代共同模型的新原生/API 或当前 head 全量验收。

### 35.90 AI 主持共同事实的原请求、候选与逐项确认（2026-10-17，引擎/API施工中）

本单元继续跑团 open S3 产品研发，入口为前节当前真人主持明确授权的单个原共同 Oracle；交付为独立共同解释候选、逐条决定、实际事实与原 Run 终验。团局、原本地 Run 和既有事实 owner 分别保存状态、模型证据和确认，世界、产品发行、机械、玩家决定与媒资 owner 不变。复用共享准备、Gateway、单次派发、CreativeArtifact、事实审阅/确认及恢复内核，新增共同目的的闭集适配，不增加表、来源 key、作者 AI 字段或第二套运输/DB写入口。原 GM 私域请求与旧已准备请求保留原协议。

共同准备只能续用已授权的原本地 Run、原冻结 Skill/正式入口、原模型与预算，无自由附加输入。只选原共同合同和单个准确 Oracle 的两份完整登记正文，禁止其他来源、目录代替正文、截断或隐式追加记忆/GM 指引；共同合同由同一纯构造器生成与核验，正文序列化不变。完整交付须匹配原规则、准确全部接收者、原 Oracle 正文 hash 与原最小实例身份；内部完整 F13 策略及原授权工件不进入模型消息。准备、预留、派发和候选证据均保留同一个 original Run。预留回滚或提交返回中断后，只修复原准确请求和回执，不重建正文、Run 或另加模型绑定。

独立 `storyforge.ttrpg-open-common-oracle-candidate` 不接受重标的 GM 候选。原始回答先持久化，再解析共同解释及最多三项事实；完整共同范围须与原咨询一致，公开接收者为空，全队准确包含本次全部角色。复用同一语义校验器检查合法主体、实际事实来源、谓词 owner、密级和实例身份，但各来源协议独立校验；共享校验不把共同正文包装为 GM 来源。不支持的机械、秘密、玩家新知识/承诺、未知对象或格式保留原回答并阻止确认。候选和刷新均不写事实、机械或时间。

人工接口只返回请求定位、共同候选或实际保存序号，内部预留事件、完整 F13 策略与全量事实基础留在引擎。共同逐项审阅与单条确认分别使用 `reviewTtrpgOpenCommonOracleCandidateV1`、`commitTtrpgOpenCommonOracleCandidateFactV1`；旧 GM 确认入口在读取私域资料前拒绝共同目的，统一事实写入仍只走同一内核。实际真人可完整逐条审阅，也可明确选择一个原提案确认；采用/弃用和理由留在原事实 owner。共同确认复核原本人、席位修订、全体接收者、原 Run/原工件、完整共同来源及当前机械基线，绝不读取 GM 私域来源；实际实例叶证明仍来自同一调用交付的原 F13。多条完整审阅原子提交或全部回滚，已确认不得改记为放弃。终验使用共同协议自己的 criterion，并保留事实及审阅原事件、响应、Manifest、候选和 receipt；已保存确认的重试只补原回执。

明确收尾区分空窗口、已预留未发送、回答待审、结果未知及已审阅。共同未发送取消沿共享账本先保存零发送/费用回执，再保存窗口关闭，最后终止原本地 Run；旧通用取消保持旧协议，共同请求不能借其顺序。已发送只能修复原已观察回答，或由本人明确保存未知结果与费用后结束等待；晚到回答不能覆盖终态。审阅完成后另行结束窗口，先补原终验，不能撤销既有决定；停止回执中断可在同一 Run 修复。取消、失败、换窗口或分支均不返还原 worldTurn 解释槽。

当前确认前后切点、子团新 Session Zero、父删除和完整备份保留原事实/来源及共同授权历史；子团或导入不能执行、停止或清理原本地 Run，也不能重用旧发送许可。历史事实可作为新团局共同来源，旧接收者边界继续有效。共同模型不接入旧导入原文桌面，也不隐式开启已接受共同解释的再次付费事实整理；这些路径须有独立协议后续接入。

当前先行验证：共同准备 6 项、模型/逐条确认 4 项、原请求恢复/停止 4 项及实际确认切点/父删除/完整备份 1 项通过。新增空白数据库导入复用了项目、团局和 Run 的全部物理编号，检出仅凭原 Run ID/合同仍不足以证明本地权限；授权现在先保存带 `portable:false` 的原 Harness 检查点，每次准备/派发/确认使用现有实例 owner 的严格检查点 reader。审阅时可使用同一已持久候选的后继检查点。通用导入按原机制终止此本地执行权，准确旧来源与窗口历史保留，空复制窗口可由本人结束后明确授权新请求。无新表、schema 或另一套导入写入器。修正后 5 文件 25 项全部通过，覆盖检查点损坏、同编号导入以及原共同模型、确认、恢复和生命周期。

此前扩大 27 文件 208 项与 17 项工程步骤均通过；检查点修正后的扩大回归与工程门继续复验。模型测试使用明确工程适配器，不计为真实 provider；三条公开/全队及空白库同编号导入的真实 API 浏览器用例已编写，尚待冻结原生执行。已预留/已发送共同请求在导入后的只读归档与本桌收尾入口、共同事实操作界面、当前 head 全量 CI/E2E，以及真实模型、独立真人和 30+ worldTurn 验收仍继续施工。

最终含检查点与人工接口隔离的 27 文件 209 项关联回归全部通过；17 项工程步骤、全仓零 warning lint、严格类型、生产构建和原体积门全部通过。公共返回值明确测试不包含完整 F13、私密模板/事实基础或预留事件，旧 GM 确认入口拒绝共同候选；共享旧 Oracle、归一、实体、公共局势与实际旧准备字节回归保留。此前共同来源基础 `08340576` 的云端 open 运行 `38990362943` 实际 116 项通过（46.8 分钟），发行包 `38990363006` 通过；该旧版本结果不替代本单元三个新 API 浏览器路径或最新整仓验收。

### 35.91 无法继续执行的共同请求：本人归档与本桌收尾（2026-10-17，施工中）

本单元继续跑团 open S3 产品研发；入口为当前原真人主持明确归档导入或原 Run 缺失的本桌共同请求。团局拥有归档决定、调用费用与窗口，原 Run、原模型证据和已确认事实保持各自 owner；交付为原事件系统中的版本化人工归档回执。世界、冻结发行包、机械、时间、玩家决定与媒资不变。复用正式事件事务、调用账本与 epoch.closed，新增可选归档协议，旧关闭事件和旧状态字节保持；不新增表、AI 来源、作者 AI 写字段或通用写入口。

只有准确本桌、原窗口、原请求及原本人/席位修订/全体接收者可归档；暂停后仍允许本人收尾。确定性读取区分准确原本地 Run、带唯一完整 V1 来源的导入副本和原 Run 不可用。正常原本地 Run 必须走原恢复、审阅或停止；损坏、歧义来源不能伪装为缺失。归档只读取导入证据，不恢复发送、解析或确认权限，不重建 Run，不写来源团局或任何 Run。归档资格、实际 Run/事件/工件与团局基线在同一正式事务再次核验，竞争变化立即拒绝，不隐藏重试。

未派发的请求按原协议保存 cancelled-before-dispatch 与零发送费用。已派发且导入证据保留唯一完整回答时，保留真实原响应 hash、估算用量与未知实际费用，只闭合运输观察；不能伪造 model.responded、候选或 Harness 成功。没有可核验回答的已派发请求保存未知结果与未知费用，继续保留保守预算；不能声称从未回答。已有 succeeded/failed/unknown 终态逐字保留，不降级已知回答，不清零原费用。已采用/弃用、单条确认、事实、原始来源与原解释槽全部保留。版本化归档回执与原请求终态、关闭窗口原子提交，准确重试返回原回执，晚到回答不能覆盖。

验证覆盖导入与原 Run 删除、相同物理编号、未发送/未知/保留回答/候选与既有审阅、暂停与错误本人、正常原 Run 拒绝、实际存储回滚、来源竞争、准确重试、备份往返与分支。该人工归档不代表真实 provider、独立真人、长局或整体产品验收；共同操作界面和当前整仓验收继续施工。

引擎/API 已接入：归档专项 11 项通过，含实际源记录恢复竞争、存储回滚、提交返回中断、同编号导入、原 Run 正式删除后的晚到回答、审阅终验反例及前后切点/父删除/备份。扩大 28 文件 219 项通过；事务内资格核验最终收口为既有 evidence 模块的静态数据库读，调整后 3 文件 19 项复验通过。最终 17 项工程步骤、零 warning lint、严格类型、生产构建及原体积门通过。新增一条原生 API 归档/刷新/完整备份用例，当前共同原生组将为 36 项，冻结执行、最新整仓 CI/E2E 与共同操作界面仍待完成；这些工程证据不构成整体产品验收。

### 35.92 AI 主持桌面的共同事实操作（2026-10-17，施工中）

本单元继续跑团 open S3 产品研发，入口为 AI 主持桌当前原真人主持的共同事实面板。只读展示原公开/全队咨询、完整共同范围与本次可读身份；明确一次模型/预算授权后沿同一原 Run 准备与发送，候选解释及每项事实均默认未决定，完整审阅并另行确认才保存。交付为共同面板及最小人工桌面适配器；团局、原 Run、事实、世界、冻结发行与媒资 owner 延续前节，不增加表、AI 来源、作者字段或运输/DB 写入口。

读取、刷新、打开面板和身份交接不发起模型、修复回执或确认。只从登记共同来源列可选资料，不能借真人 GM 工作台读取私域。当前原请求与已保存审阅分别投影；确认后不重建已经变化的共同来源来读取原决定。原本人、席位修订与准确全体接收者逐次核验；交接时清空候选、未保存选择与错误，晚到结果不能跨身份显示。输出仅包含共同内容、必要控制状态和实际保存序号，不返回完整模板、F13 策略、全量事实基础或内部预留事件。

未发送原请求可按原模型和预算明确继续；已观察回答只补原回执，未观察的已发送请求明确记未知后结束等待，再中止本机请求。已审阅记录先补原终验再另行关闭；导入/原 Run 不可用时使用前节独立归档。空授权窗口、已预留、已发送、候选待审、已确认及已关闭历史分别显示，不自动恢复任何发送许可；失败后保留原准确决定供核对重试，不能默认替换为新请求。验证包含真实桌面/移动界面、刷新、身份交接、存储/返回中断、明确停止、同编号导入和备份，以及旧 GM 工作台与旧请求兼容。真实模型、独立真人及长局验收保持独立。

共同界面从同一次调用的完整冻结交付投影原依据，不以当前共同事实重建。导入的原共同回答只在唯一 V1 来源、同一原 Run/合同/请求、准确共同正文和原响应字节全部核验后作为只读文字显示；不接入旧 GM 原文桌面，不把导入文字重新包装为可确认候选。缺失、矛盾或损坏的原工件关闭相应审阅/展示，原决定与记录保留。

当前代码已接入共同事实桌面：扩大 35 文件 272 项通过，旧玩家与 scripted 桌面 2 文件 6 项通过；最终桌面/界面 2 文件 14 项通过，含暂停后直接收尾已观察回答、单条确认与实际事实事件损坏反例。最后 owner 核验调整后的 17 项工程步骤、全仓零 warning lint、严格类型、生产构建及原体积门通过；默认隐藏构建与开启预览的生产构建均通过原体积门。新编写 5 条原生浏览器路径覆盖公开/全队真实客户端替换 HTTP、刷新待审、准确审阅回滚/重试、移动端、明确停止及导入只读/归档；冻结执行与当前 head 全量验收仍待完成，不能计为真实 provider 或独立真人证据。

### 35.93 P10 音频的固定接收者与分层回放基础（2026-10-17，纯契约，正式接入前）

本单元为跑团 open 产品研发、S3 团局展示能力。入口目标是已结算内容后的明确音频控制；世界仍只提供冻结语义，发行媒资与运行媒资分别由 ProductRelease 和 ProductRuntimeSession 拥有，共享媒资/Blob 设施不接管 owner。当前交付仅是纯音频范围与回放基础，不启用 E16、播放 UI、provider、生成请求或新持久状态。无新表、AI 来源、作者 AI 写字段或世界写回。原音频规划器与 scripted 行为保留。

`open-audio-scope.ts` 将原 Session Zero、实际发起真人、受众和准确接收席位冻结在独立版本化 envelope 中；party 包含当次活动 AI 席位，但不赋予 AI 音频监听权限。后来新席位、换 viewer 或将原 AI 席位转交真人不能自动继承旧 party/private 监听权。AI 主持模式的真人兜底只能明确创建共同范围；GM-only/private 必须是实际真人 GM。公开音频要求接收席位的公开分享同意，私密目标只能是实际活动角色。准确原授权须由正式 owner 重新派生比对；解析成功、自报接收者、hash 或主持身份本身均不是历史来源证明。

听众投影先按原接收者过滤，再在公开、全队、私密及 GM 通道层回放。私密播放或停止不会挤掉其他听众的共同音频；结束私密覆盖后恢复仍在播放的共同层。旧槽的停止不能停止其替代槽。四通道独立，输出只包含当前可听内容，不返回隐藏事件计数/序号。纯投影按已核验的真实血缘顺序接收事件，允许子团局序号从头开始，但不改写原来源或原事件；未来正式 reader 必须先验证该顺序及祖先切点，不能将本工具当作来源校验器。

下一接入单元必须同时闭合：原正式事件事务和 E16 准入、结算后因果、不可变媒资版本/真实 Blob/hash/owner/来源许可、受众约束下的异步请求与保守预算、失败文字降级、缓存/预取/停止、刷新/分支/备份/导出安装及实际播放界面。音频失败不得回滚规则或消耗角色资源。既有 `open-audio-runtime.ts` 的每请求 2000 字符、每 worldTurn 三次上限须按持久调用历史累计，不能每次重新规划清零。仅有 assetKey 或声明 ready 不足以播放；未完成这条实际链路前不得将本节称为 P10 已交付。

范围基础 8 项、既有音频规划/回放 5 项及正式入口 10 项通过；扩大共同 Oracle、真实桌面和纯回放关联共 14 文件 91 项通过。17 项工程步骤通过，后续改动文件 lint 与全量严格类型复验通过；默认与开启预览的生产构建及原体积门通过。较早共同引擎云端完整 CI 检出三处仍使用新增入口前数量的回归断言，当前已更新准确数量、保留旧冻结注册表的实际历史集合，并补共同入口与私域 category 错配反例；不调整正式权限。未启动的旧版本两组本机队列保留“已被后继替代、未执行”记录，后继仍执行全部 41 条浏览器路径和完整 CI/E2E。当前 head 的完整结果、真实音频/模型与真人验收仍分别等待，不将本基础的测试计为正式播放完成。

### 35.94 P10 手动音轨：正式确认、实际文件与本机播放（2026-10-17，开发预览）

本单元为跑团 open 产品研发、S3 运行展示。入口为玩家桌与主持桌的“本机音频”：主持明确提供文件、核对已完成行动的已确认叙述及接收范围，再单独确认 E16；每位听众另行开启本机音频并用原生控件播放。世界只读、冻结发行内容不变；文件由当前 ProductRuntimeSession 拥有，不把运行媒资写回 WorldRelease、ProductRelease 或作者作品。复用现有 ProductMediaAsset、ProductMediaBlob、MediaBlobObject 和事件/快照 owner，无新表、schema、AI 来源、模型调用或作者 AI 写字段。未带音频字段的旧存档保留原字节语义，scripted 不接受本增量的 E16。

`open-audio-contract/media/proof/reducer/service` 接入既有正式命令事务。每次播放必须绑定实际已完成 operation、原叙述 businessRef、当前授权与基线、唯一内核命令/槽位以及不可变的媒资版本快照；仅解析成功或重算 hash 不能替代原事件与祖先切点。真人 GM 可控制全队/公开/指定角色/仅主持，AI 主持的真人兜底仅可明确控制共同范围。公开配音不开放；配音字幕必须是原已确认叙述全文，接收者不得超出原叙述。手动字幕以整段时长对齐，上传者须试听核对，不声称自动转录或逐字语音校准。

明确“保存文件并核对音轨”后才读取实际文件、识别 WAV/MP3/OGG、计算 hash 并经共享媒资入口保存；来源和许可须非空，但属于上传者声明，不等于已完成商业授权核验。文件大小上限 100 MiB。待确认上传凭证及审阅授权只在本进程内存在，复制、刷新、导入或换身份不能复活未保存的确认。返回重新核对不删除已明确保存的作者文件。确认事务复验当前完整事件重放、实际席位、来源、三层物理绑定和已读元数据/IndexedDB 字节；变化时回滚。OPFS 沿共享不可变对象记录作 CAS，实际文件读取再次验 hash，不在 IndexedDB 事务中读取外部文件。原确认的存储失败与已提交但返回中断分别保留原幂等身份，不重建事件或复制文件。公开返回仅含确认序号；玩家投影不返回文件名、来源或许可，这些媒资也不进入角色/共同复盘 AI 输入。

监听先过原准确接收者过滤，再进行四通道分层回放；不因新席位或原 AI 席位被真人接手而扩大旧私密音频权限。停止指向原准确播放槽，并保持原接收者边界；撤销新的公开分享同意或原角色不再活动，不妨碍有原读取权的当前真人主持明确停止旧音轨，因为停止不授予新文件或叙述。暂停时拒绝新播放；本机静音不依赖规则/请求状态。音频控制不结算规则、不计费、不推进 worldTurn、不授予知识或改写实体。

实际 Blob 读取须符合当前可听槽位、owner、版本、内容 hash、格式与绑定；缺失、损坏、浏览器解码失败或配音实际时长不符时保留文字。默认关闭、刷新不自动播放；身份交接、卸载和暂停会暂停并释放原音频元素/URL，晚到文件不能跨身份显示。普通序号刷新不重启未改变的音轨。当前只缓存最多四个可听 Blob URL，原生控件播放、音乐/环境声循环；界面使用立即切换（fade=0），没有自动跟随叙述播放、混音淡入淡出、预取、断点续播或字幕播放同步。

分支仅复制切点前真实 E16 引用的准确版本，排除切点后及未确认上传；共享媒资 writer 在同一分支事务内为子团局建立独立强绑定，物理 Blob 去重保留。缺少原准确版本、强绑定或 ready 物理对象记录时整个分支回滚。分支事务只复制对象记录的强绑定，不重复物化文件；实际播放和便携备份仍分别由共享 reader 校验文件字节，播放失败保留文字。父团局删除与垃圾回收不能删除子团局仍引用的文件；完整备份通过既有表生命周期重映射绑定，历史播放许可保留，未确认上传授权及本机开启状态不随备份传播。

首轮四文件 30 项专项通过，扩大共享媒资/分支/旧图媒资/纯回放等关联回归 12 文件 69 项通过；后续最终 StrictMode 组件 6 项与实际回放依赖 4 项通过，补齐 A→B→A 旧审阅晚到及旧确认刷新覆盖新身份读取的反例。覆盖实际 E16/幂等、事务回滚与提交返回丢失、四通道/精确停止、AI 主持兜底、受众与配音反例、元数据竞争、玩家及 AI 输入隔离、切点/父删除/完整备份和文字降级。17 项工程步骤、后续改动组件/测试的零告警 lint、严格类型、默认生产构建及原体积门通过。新增回放模块沿原依赖分组，音频契约置于既有 open 分块，不抬高原预算。预览生产构建、真实浏览器上传/解码/播放及移动端和最新提交完整 CI/E2E 分别留证，未返回结果不计为通过。

后续仍须完成发行拥有的音频生产/编译/发布/导出安装；受治理的异步供应方请求、未知结果与停止恢复；按持久历史累计的每请求 2000 字符与每 worldTurn 三次预算；实际渐变/预取/同步及语音质量。手动提供的现成文件不伪装成生成请求，也不消耗供应方调用预算。本单元不代表 P10 或产品完成，真实 provider、独立真人、30+ worldTurn 和原联合完成门继续保留；公开 open 入口仍默认隐藏。


### 35.95 P10 本机字幕、位置恢复与播放渐入（2026-10-17，开发预览）

本增量仍为跑团 open 产品研发、S3 本机展示，沿 §35.94 的正式事件、准确接收者与实际 Blob reader。入口为已核对音轨的本机控件；数据、世界和媒资 owner 不变，无新表、schema、AI 来源、AI 写字段、模型调用或新后台任务。本机播放状态不进入团局事件、世界、发行包或完整备份；语音供应方的选择/凭据与后续生成预算另行完成。

`TtrpgOpenAudioPlayer` 只消费当前本人可读的音轨 DTO 和核验后的 Blob URL。配音高亮按实际媒体 currentTime 与原 voiceTimeline 查找；空档、时间轴结束或无有效标记时保留完整原文，不补造逐字时间。整段人工时间轴只高亮原整段，不能被称为逐字对齐。显示最多前文、当前标记、后文三段文本，避免每个字创建节点；播放时以一条可取消动画帧读取实际时间，暂停/静音/失败/卸载时停止。字幕跳转只 seek、不调用 play；自动跟随只滚动字幕盒内部，不滚动整页，不对跨多行的整段大标记猜测具体字位置。

本次身份访问内最多保留八个 clipKey/hash 的暂停位置，不保存文件或读取许可。静音前先记录实际位置并立即暂停、卸载媒体与释放 URL；重新开启仍须沿当前原权限读取真实文件，在元数据可用后仅定位原位置，播放由听众另行选择。字幕跳转和位置恢复不写游戏进度。浏览器刷新、身份交接及返回原身份均清空位置；原 AI 席位接手者、后来身份或导入者不得继承本机开启与位置。普通团局读取保留未改变音轨，不因 DTO 换对象而暂停。

主持上传非语音文件时可明确选择 0/1/3 秒播放渐入，审阅时展示准确时长，仍经原 E16 请求保存。客户端只在实际 play 事件后从零渐入到原生音量；用户操作原生音量立即接管，不被后续帧覆盖。暂停或本机静音立即停止并取消渐入，不做延迟消音；配音上传默认零渐入。这里不实现新旧音轨交叉渐变、停止渐出、自动跟随播放、跨刷新续播或未来/隐藏音轨预取，原字段的其余能力不能据此称为全部可用。

首轮五文件 38 项专项通过，包括原 E16/权限/生命周期，字幕 Unicode 边界/时间空档/实际媒体时间、跳转零播放、渐入及原生音量接管、静音与身份位置隔离。新增和加强的原生浏览器用例保留原上传/刷新/备份/降级路径，补真实音量采样、静音位置恢复、长字幕 seek 与内部滚动；尚待冻结执行，合成静音 WAV/声明时间轴不是供应方配音质量或独立真人验收。17 项工程步骤及后续六项类型/lint/默认构建/原体积门/指标/diff 复验通过，后续七项真实桌面组件与五项本机控件回归通过。预览生产构建、45 项定向原生及当前整合 CI/E2E 分别留证，未返回的结果不计为通过；P10 生成/发行/累计预算、P9 后续观察传播、真实 provider/独立真人/30+worldTurn 与公开开放门继续未完成。


### 35.96 P9 后续观察中的实例识别与明确传播（2026-10-17，开发预览）

本增量属于跑团产品研发的 S3 运行知识层。实际游戏知识仍由原 `openRun.knowledge` 拥有；显式分享复用 `knowledgeShares` 和正式运行事件，不新增世界写回、平行身份账本、数据库表或模型调用。原 F13 身份/接收范围、装备账本、能力与规则 owner 不变。已有 V1 知识与分享记录保留原格式；新增的可选 `identityGrant` 自带独立 schema/version，旧分享不会隐式携带它。

补齐的缺口是：线索正文不能证明玩家识别了哪个实际运行实例。新增真人核对将原真实 `observed` 知识绑定到指定已创建实例，保留准确原知识、原创建、原名称、规则/运行来源、原审阅摘要、原真人及窗口证据。实例必须在原实际观察前已经创建，不能拿旧线索补认后来创建的对象；分支之间按真实祖先顺序及各自事件序号比较，不能跨团局直接比较数字。真人主持可明确确认原实际观察者识别了哪些对象；玩家仅能为本人已观察的线索绑定其原已知身份，不能靠填写名字或猜测隐藏 ID 取得新身份。识别记录不增加规则谓词的发现权限。

明确传播只可选择原已识别身份的子集，继续使用原角色/真人批准关系、私信约定、当前准确接收者与公开同意校验；不得冒充其他真人。接收者获得带来源的 `hearsay`，不能成为本人 `observed` 或满足发现门。原知识和原实例范围保持原记录；新认识 NPC 不等于知道其装备，知道名称也不等于取得位置、能力或物品操作权。姓名取自原实际 F13 提案或原装备定义，不取可变运行属性。

主持和玩家桌面新增“观察与身份知识”：可读取本人当前有权查看的最小名称/可靠性/线索投影；在本次本人有效窗口、原结算及待办完成后，选择原观察或原识别记录、对象与指定角色，逐项核对后单独保存。当前操作界面提供指定角色的私密核对与分享，API 的其他受众仍须逐项权限校验。不能读取的隐藏对象不以禁用选项或数量出现。核对和读取均不发起模型请求、不消耗行动或推进世界时间。待确认权限仅存在于本机当前页面，复制、刷新或导入不恢复执行权；存储失败保留原审阅供准确重试，已提交但返回丢失可读取原同一回执。

正式写入核对当前参与者、冻结内容和原事件回放，事务绑定真实事件证据；新事件在纯回放中重新推导身份、接收者和传播可靠性。读取与分支切点校验原知识 hash、审阅 hash、实际创建名及正式事件；祖先凭准确原事件 payload hash 和切点快照继续核验，父删除后不依赖父行。完整项目备份保留逻辑来源与原传播链。界面在工作区/团局/真人身份交接、返回同一身份的新访问及进度换版时遮蔽旧投影，晚到读取或审阅不能恢复旧私域内容。

验证按实际回执分别记录：7 项真实领域/存储服务测试和 5 项 React 交接/确认测试；相关扩大回归的先行 6 文件 50 项通过。新增两条真实浏览器用例覆盖实际界面确认、存储回滚、身份隔离、分支/父删除/完整备份与窄屏，尚待冻结执行。严格类型、构建、整合 CI/E2E 与最新源码指纹各自验收，先前提交的通过不能代替本增量。该增量不表示 P9 或整体产品完成：让模型按新增身份知识读取/选择对象，需要后续明确版本的来源策略、工具/候选及规则权限校验；旧 V1 AI 输入与实例读取政策继续原字节和权限。长局、真实供应方、独立真人和其他路线图完成门继续分别保留。


### 35.97 P9 角色模型读取已识别身份（2026-10-17，共享读取基础）

本增量仍在跑团 S3 运行知识 owner 内。新增登记的只读来源 `ttrpgOpenLearnedIdentities`，经当前玩家 POV、真实开团/参与者同意、冻结作品和原事件回放校验后，输出原已创建实例的姓名、类别、本人知识回执、线索标题及可靠性。原 F13 模板、计划、NPC 私密档案、装备/库存、位置和当前机械状态不进入该来源；姓名也不授予规则目标、资源或发现门权限。没有新增表、AI 可写字段、世界回写或供应方实现。

同一身份的全部知识仍保存在原账本；模型投影只选择实际可读取记录中可靠性最强、同级最近的一份原回执。跨祖先按真实血缘顺序比较，不比较不同团局的裸事件序号。本人观察过某线索，不等于本人识别了该人物：身份只由他人转述时仍为 `hearsay`。界面中的原观察、识别与分享记录不因模型投影选择而删除或改写。

新玩家意图与 AI 队友请求使用冻结 Skill v5，并准确声明五份原有/新增来源；新来源通过 Context Gateway 的 `describe/search/read`、明确 allow-list、完整 JSON 和 Manifest 交付。用户明确提及的已知姓名要求交付对应完整记录，预算不够时在派发前失败；没有从姓名推断实例或切碎原回执。每份来源沿用原角色读取凭证，不能以另一套 fingerprint 绕过共同快照检查。新来源的每次 pinned read 由原 owner 检查当前来源、事件、身份与记录；复制元数据或自算 hash 不构成读取权。

旧来源 `ttrpgOpenKnowledge` 的合法正文与 Provider 版本保持原协议，含新识别记录时补核其真实正式事件。旧冻结 Run 的两/三/四来源权限分别保留，不给历史请求补新来源；实际旧 P7 准备请求仍通过原 Skill 和原读取工件继续。GM Oracle、共同事实、KP/复盘和局势消费者当前没有这份新来源，不能借玩家的私域身份知识扩权。API 函数名 V1 不替代 Run 内冻结的 Skill/来源代际判断。

实际新请求的原消息/来源/Manifest/原回答与候选沿原 durable Harness 保存。模型可以把已知姓名用于意图说明，`targetRefs` 和 `declaredResources` 继续只由原角色权限来源推导，读到姓名后仍不能把隐藏实例当作获准行动目标。误用目标在候选层成为需要修订的结果，不能启动 operation。原实例名和知识来源仅在同一次读取内建立索引，避免为每条知识重复扫描和解码 F13；跨请求不缓存授权。

先行相关 6 文件 38 项、原知识/界面/纯回放 3 文件 16 项通过；最终新来源 10 项覆盖真实玩家/队友请求、原可靠性、共享线索与个人识别区别、pinned 作用域与席位漂移、真实缓存恢复/伪造接收范围拒绝、分支/父删除/完整备份。新增真实浏览器客户端 HTTP 用例验证既有玩家界面的登记正文、一次发送、原候选刷新续用，待冻结执行。严格类型、全仓检查、默认/预览构建与最新整合 CI/E2E 分别依实际源码回执验收。工程适配器和替换 HTTP 不是真实模型质量或真人验收。

下一步继续明确共同消费者的交集读取、物理可见/可行动范围与纯姓名的分离，以及长局性能和余下 P10；该来源不表示 P9、长局或整体产品已经完成。

### 35.98 P9 全队身份交集与共同叙述引用（2026-10-17，共享读取基础）

在 §35.97 的本人身份 owner 上新增独立只读来源 `ttrpgOpenCommonIdentities`，只向 KP/阶段复盘消费者交付全体当前选定角色（含 AI）的共同身份。读取沿同一真实事件、冻结内容和当前参与者授权核验，不按请求者指定子集取交集，不授予 GM Oracle、共同事实或局势消费者私域权限。没有增加表、AI 正式写字段、规则权限、世界或音频写入。

每名角色先从本人真实可读的识别记录中选可靠性最强、同级最近的一份；共同可靠性再取这些原记录中的最弱一级。人人已识别才有共同姓名；有人仅获转述时共同身份仍为 `hearsay`，共享线索的原观察不替代个人身份识别。后续真人核对产生真实亲历识别后才可提升；新分支以新 Session Zero 的实际队员重新计算。共同读取受本桌日志同意约束，不借此开启个人 AI 建议权限。

模型正文仅含原身份 key、类别、姓名、共同可靠性与引用身份。私域知识 key、原获得记录、线索标题、原 F13 计划、档案、位置、装备和当前数值不进入共同来源。它不改变原创建密级、不授予行动目标或发现门，也不创建第二套知识账本。角色与共同投影复用同一次读取内的原识别选择算法，跨请求不缓存授权。

新 KP Skill v4 使用四份准确来源；新阶段复盘 Skill v2 使用三份。旧 KP 一/二/三来源和旧复盘两来源仍按原冻结权限继续，不给历史请求补新来源，原 KP v1/v2 与复盘 v1 正文保持原协议。新增共同身份合同与条目单独闭集验证：只有本次准确完整交付的 `identity.<原实例 key>` 可引用；缺合同、遗漏当前队员、冒用个人来源、未交付条目或杜撰引用均拒绝。姓名被明确提及时要求完整读取，预算不足在派发前停止。

复盘候选按实际交付正文生成 `known-identity` 来源标记；保持共同原可靠性，个人观察者和私密来源字段为空。真人单独确认后才保存原 E15 模型复盘记忆，仍是主持报告的 `hearsay`，不授予新知识、规则效果或世界修改。后续记忆读取保留并展开原身份标记，不把多代摘要升级为亲历。审阅界面明确显示“全队共同身份”和原可靠性。

Agent 工具声明同步升级 `agent-read-tools-v19`，真实 snapshot hash `4efc0b11ea06cac242c56c3648ff2d4627ed238f51e029044a18e53717a09545`；只移除两份新增身份来源即准确恢复 v18。较早个人来源提交漏更全局声明的检查失败保留，不能当作通过；新声明和旧代际还原分别回归。

扩围回归同时检查共同读取成本。每次共同投影只建立一份原冻结作品/运行/来源核验基础，再按全体实际角色各自权限投影并取交集；不对外提供私域批量视图或允许调用者传入授权基础。角色投影、原 KP v1/v2 字节和读取结束时的头状态/席位复核保持原契约。相同真实初态和完整事件原字节可复用纯确定性回放结果：只保留最近一份、按序列化内容计最多 32 MiB，返回独立副本；初态、任何事件字段或原正文改变立即重新回放，错误继续抛出。每次 owner 仍读取和核验实际来源、事件、当前参与者、知识/记忆原证据；当前授权判定、发送权、回调和人工确认票据从不缓存。先前合作超时原日志保留，不提高超时或体积门槛换取通过。

云端 `fc97628a` 的玩家界面失败保留原错误页与日志：同一线索的真实观察及后续转述以同名、不同可靠性全文进入网关，被 `same-name-different-canon` 拒绝。新本人身份代际的读取计划按真实 `evidenceRef` 选择本人原可靠性最高的一项；同级正文一致时保留原首项。原全部知识、旧目录与 V1 正文均保留，旧冻结代际不自动换计划；不同线索身份的同名冲突继续由原网关拒绝。已观察线索与听来的人物姓名仍分别保留 `observed` 和 `hearsay`，不能把前者当作本人识别人名。实际新 Harness 反例已复验，替换 HTTP 的完整客户端复验另按冻结原生管线执行，不凭修复推定通过。

定向领域、实际 Harness 候选/采用、后续记忆来源、新分支同意、pinned 读取、父删除与完整备份分别验收；新增浏览器用例从原主持复盘界面通过替换 HTTP 发送，核对原来源、一次发送、刷新后单独保存和窄屏。各项通过与待执行状态以对应源码冻结回执为准；客户端替换 HTTP 不代表真实供应方质量或独立真人验收。长局、规则内物理可见/可行动范围、供应方音频及整体产品完成门继续独立。

本单元先行关联回归 15 文件 / 117 项通过，并保存准确源码指纹。云端重复线索修复后，新增/复验本人知识、队友、旧请求、情境与网关的 8 文件 / 56 项全部通过；同一线索实际目录仍保留观察与转述两份原正文，新玩家 Run 只完整读取原观察条目并另读转述姓名。与先行证据的源码差异单独核对，不能把较早整仓结果当作最新验收。完整合作回合的诊断复验在原 120 秒门槛内完成（70.8 秒），冻结基础版本 `fd9bb117` 的本机原生 47 项与完整 CI 975 文件 / 5811 项通过、默认 E2E 继续按原冻结源码执行；最新 52 条原生、整仓 CI 和默认 E2E 均须按最新源码另验，P9/P10 与整体产品仍未完成。

### 35.99 P10 本机切换的过渡读取依据（2026-10-17，只读基础，播放控制器待接）

产品为开放跑团，生命周期为产品研发，位置为 S3 本机呈现；团局及音频媒资仍由原跑团 session owner 持有。本增量在原 E16 正式音轨和 §35.94/§35.95 的实际文件读取上，提供同一本人本机原样读取之间的过渡依据；不增加表、字段、模型调用、供应方请求、规则权限或世界写入，不提供读取历史文件的新入口。服务本身不证明访问连续或节点正在播放，这两项仍由后续本机控制器校验。

纯回放沿原固定接收者及受众分层，额外投影每通道最后一次实际改变可听槽位的原控制来源、动作、渐变时长及前后槽位。隐藏事件、未改变当前可听层的操作和针对旧槽位的过时停止，不能借此停止或切换另一音轨。原 `projectTtrpgOpenScopedAudioV1()` 返回字段和旧调用行为保持不变；这一纯投影自身不证明事件真实、文件许可或播放授权。

正式只读服务先核验真实来源、当前席位、原音频事件和当前头，再只承认服务原样签发的同作用域/团局/本人、同来源和授权修订的前后两份视图。复制、导入、刷新、修改 DTO、逆序或跨身份复用均不能恢复内存中的读取依据。调用者还须提交原视图中、由这名听众通过当前文件读取实际取得的原 Blob 对象；仅有 clip key、复制的相同字节或另一席位读取的同一资产均拒绝。异步 IDB 等待前即固定作用域、身份、准确原引用与 clip key，不能把读取中的可变参数改成另一文件的证明。

前后视图必须跨越本次团局真实新控制事件；祖先历史本身不触发新过渡。原文件的当前 owner、版本、hash、实际字节、物理对象和准确强绑定重新核验，旧版本缺失或损坏只取消它的过渡资格；已核验的新当前音轨仍可正常读取。读取结束再次核对原进度与安全状态；stale、安全暂停、来源或席位变化均拒绝。结果仅含原控制引用和准确前后 clip key 等有限信息，没有旧文件、URL、许可正文或私域文本，也不附带写入或自动播放权。

原请求 `fade` 的 0–60000 ms 契约不变；本机旧节点的过渡上限独立封顶 3000 ms，并保留原请求时长供核对。原素材复用/停止的准备 API 可显式覆盖渐变时长，缺省时仍保留旧行为，仍须原审阅和确认事务。本增量没有接入新的播放选择器，也没有实现交叉渐变、停止渐出或自动跟随。下一控制器必须另外证明旧节点确在播放且仍属本次访问、听众明确选择跟随、新当前文件实际读取成功、失败和晚到回调有界；本机静音、身份交接、安全暂停、权限失效和卸载必须立即暂停并释放，不能等待淡出。不能仅凭过渡元数据延长旧文件播放或预取未来/隐藏音轨。

专项覆盖真实替换与停止、原 60 秒请求/3 秒本机上限、过时停止、GM 隐藏轨、篡改/复制/他人读取/参数竞争、旧强绑定删除、安全暂停、切点分支/父删除及完整备份导入。当前基础版本 `fd9bb117` 的 47 项本机原生、完整 CI 和默认 E2E 已按其冻结源码全部通过；`721044bd` 的新共同身份版本仍单独排队/执行，旧版通过不代替本增量或最新源码的整体验收。P10 播放控制器、生成/发行/持久累计预算，及真实 provider、独立真人和 30+ worldTurn 联合完成门继续保留。

本增量 7 个关联回归文件 / 49 项通过，准确源码运行前后无变化；原运行/界面/本机控件、非阻塞与纯回放边界全部保留。15 项工程检查通过，含三注册表、AI 入口、来源可达、现行文档、严格类型、全量 lint、默认生产构建、原体积门与 diff。预览构建及最新冻结整仓/浏览器结果仍另按准确提交留证；这些工程检查不构成渐变已经播放或独立真人验收。

### 35.100 P10 本机背景跟随、交叉衔接与停止渐出（2026-10-17，界面开发预览，原生验收待执行）

产品、S3 呈现位置、团局/媒资 owner 及世界只读边界沿 §35.99 不变。本单元接入实际本机播放控制器，不创建第二套音频账本或写入入口；原 E16 审阅/确认、精确物理文件与固定接收者仍是唯一依据。模型、供应方、发行包、世界、规则资源与时间均不由本机播放器修改。

“跟随正在播放的背景音乐与环境声切换”仅作用于本机本次身份，默认关闭；首次开启音频、单纯勾选跟随、刷新和身份交接均不播放。只有本人已手动播放、尚未暂停/结束且可听的原节点，经真实前后视图、原 Blob、原新控制和当前 owner/文件复核后，才能尝试一次准确新当前轨的播放。音乐与环境声可跟随；配音及音效保持手动播放，配音正式停止仍为零渐出。新文件来自当前准入轨，不读取未来或隐藏轨，也不以目录元数据预取文件。

切换时将已经在播的原节点交给有界控制器持有，原 React 节点退出可视界面不触发新的播放或历史文件重读。每通道最多一个退出节点，加上最多四个当前轨，临时最多八个 Blob URL；完成后先暂停、卸载原 src，再释放 URL。新轨须由原文件读取实际取得，并以浏览器 `play()` Promise 和真实 transport 状态确认；成功才进行双轨音量衔接，目标音量沿用原听众当前音量。原节点正在渐入时交接保留其实际当前增益，不跳回满音量；用户调整新轨原生音量或静音时立即结束旧轨衔接，后续帧不能覆盖其选择。

读刷新与衔接共用最多三秒期限，不因来源复核、文件加载或待决 play 延长。正式控制 `fade=0` 仍可提供准确“立即切换”依据：旧文件立即暂停释放，明确开启跟随的听众才有一次新轨尝试，等待新文件不延长旧播放。正时长在原请求和剩余期限内衔接；帧与独立定时器共同结束旧轨，页面进入后台也立即结束衔接。慢读到期停止本机音频，须由听众再次开启；加载、解码、拒播、超时、旧节点结束或已暂停时结束对应衔接，不重试或晚到补播。当前新文件保留手动控件和文字，拒播不会删除它或改变已保存行动。

主持可在原停止审阅前为非配音轨选择立即/最多一秒/最多三秒渐出，审阅显示准确本机上限，确认仍走原 E16。未开启跟随也可按正式停止淡出已经在播的旧轨；停止私域覆盖轨而显露底层轨，不等于开启新轨播放。过时停止、无实际槽位变化、隐藏事件、无权原 Blob 或不再有效的旧强绑定均不产生衔接。本机静音、身份/团局/作用域交接、安全暂停、授权修订变化、读取失败和卸载立即暂停并释放全部当前及退出节点；不等待淡出。StrictMode 临时挂载不消耗一次播放；未决 play 在身份离开后即取消，旧身份的晚到文件或 Promise 不能重新开启音频、改写新界面或恢复原勾选。

先行 8 文件 / 62 项关联回归通过，包含模拟原生 transport 的实际组件切换/双增益、原生音量接管、正式停止/安全暂停、默认不跟随、拒播手动恢复、未决 play 身份交接、零渐变读取、硬期限与后台结束；最终源码与构建仍分别留证。原生测试枚举为 17 文件 / 56 条，原 52 条全部保留，新增实际解码节点的交叉音量与 URL 释放、正式停止/立即静音、默认手动/拒播、双节点身份交接四条。枚举不计执行通过，模拟 transport、静音 WAV 和浏览器工程路径也不代表供应方语音质量或独立真人验收。P10 受治理的生成/发行与持久累计预算、P9 物理可行动范围、长局与原联合完成门继续独立。

### 35.101 玩家意图的声明假设候选合同修复（2026-10-17）

冻结 `1c1c0733` 的本机原生管线实际执行 52 条，51 通过、1 失败，运行前后源码无变化；因原生步骤失败，后续完整 CI 和默认 E2E 未执行，不能计通过。原失败页面、视频与 trace 保留：已交付本人转述身份的玩家请求只发送一次，但非空 `declaredAssumptions` 被封装成缺少既有必需字段的 CreativeArtifact 假设，原七字段守卫正确拒绝，界面未出现待确认意图。此结果不属于 P10 新界面的播放证据。

修复限定在原跑团 Intent/Companion Harness 的候选封装：采用现有 `parseCreativeAssumptionV1()` 验证完整 version/id/text/derivedFrom/confidence/conflictsWith/status，每项只标注原回答 hash 与准确数组位置、低置信度和 provisional。它仍是角色声明的未核实假设，不成为已知事实、机械效果或作者确认。空数组和其他用途的原产物结构保持不变，不放宽全局创作产物合同、不增读来源或补造历史采用权。

单项超过原 CreativeArtifact 的 2000 字符上限时，在原协议修复处理内拒绝采用意图，保留完整原回答、用量、原请求与修复候选；不截断、不提升限制、不再次派发。回归覆盖非空假设的完整合同、刷新原候选零重发、超长原文保留，以及真人确认意图进入独立规则风险审批后原假设仍 provisional。原生身份用例保留非空回答与原全部断言，须随最新冻结源码复验；旧 51/52 与工程回归不能作为修复后浏览器通过的证明。

最终联合 13 文件 / 98 项关联回归通过，运行前后准确源码无变化；新增当前原 Blob 与原样视图的作用域/席位/来源/授权修订一致性检查，拒绝把另一读取授权带入自动跟随。音频、候选原合同、玩家准入、队友与委托回归共同保留。15 项必需工程检查通过，包括三注册表、AI 入口、来源、文档、类型、lint、默认构建及原体积门（最大 590.7 KiB）；实时指标漂移由官方生成器刷新，没有调整测试或体积限制。最终整仓 CI、默认 E2E 和新增原生播放结果仍按最新冻结提交另验，当前工程回归不代替它们。

### 35.102 P10 原生播放发现后的连接节点保留（2026-10-17，修复已接，原生复验待执行）

冻结 `c9f70ceb` 的首轮原生实际 53/56、源码无变化；正时长双轨衔接、正式停止渐出及双节点交接三条没有观测到原节点持续播放/音量衔接。原 52 条均通过，包含此前非空声明假设的玩家真实 HTTP/刷新候选用例；新增默认手动/拒播恢复也通过。因三条失败，后续整仓 CI/默认 E2E 未执行。模拟 transport 的组件结果不足以证明浏览器行为，原失败截图、视频、trace、源码快照和全部断言保留，三秒期限及拒播降级门不变。§35.100 的首轮节点退出渲染策略据此调整，不能把早先工程通过当作这三条已经可用。

退出轨在同一身份内继续由原 React key、原 Player、原 src 与已在播 DOM 节点承接；仅隐藏其界面，不从文档移除、不创建副本或再调用旧轨 play。结束时仍由原有界控制器先暂停/卸载，再释放 URL 并移除保留节点。展示序列保持所有既有媒体节点的相对 DOM 顺序，新轨追加，避免一次通道切换移动另一在播节点。零渐变不保留旧节点；到期、静音、安全/授权/身份变化与卸载仍立即清除当前和退出节点，晚到回调不恢复旧访问。

原生测试按可见当前轨与隐藏退出轨分别检查：必须实际观测双轨可听增益和在播状态，正式停止及身份交接须发生在原节点仍播放时。另增加环境声切换、背景音乐节点不暂停/不重启的交叉通道反例；失败附带有限原生 transport/增益/释放状态，便于按实际证据裁决。保留原所有用例和音量/暂停/URL/规则状态断言，仅将退出节点的 DOM 所在位置改为本策略要求。当前组件与控制器 19 项专项已通过，最终冻结原生及整仓验收另行执行，完整 P10 和产品完成门继续保留。

连接节点修复后，联合 13 文件 / 98 项回归再次通过，运行前后源码无变化；15 项必需工程检查及默认构建/原体积门通过。最新原生枚举为 17 文件 / 57 条，原 52 条全部保留并覆盖五条播放增量；枚举仍不计执行，新冻结原生、完整 CI 和默认 E2E 结果按准确提交独立留证。

同一当前头的重复读取仍是只读动作，不取消已在进行的退出轨期限、不重启或再次调用播放。只有观察到新头才替换先前衔接；读取失败、超时、安全/授权变化仍按原规则立即停止。组件回归核对重复读取完成后旧轨仍在播且总播放调用不增加；原生正例补读取按钮点击时原节点仍在播的断言，既有双增益和释放断言保留。

### 35.103 免费本机中文配音的选型与接入边界（2026-10-17，许可/体积核查，尚未安装或生成）

用户明确没有 OpenAI 密钥或付费语音供应方，要求优先使用免费、MIT、可商用复用的工具。此决定替代此前待答复的付费语音凭据选择；不再以付费账户作为配音前提。本单元是跑团产品能力研发，落在 S3 的运行叙述媒资生产；世界只读冻结引用不变，已确认叙述仍归原团局，生成文件及采用记录归跑团媒资 owner，不写世界或机械状态。

首选验证 [MeloTTS 官方代码](https://github.com/myshell-ai/MeloTTS/tree/209145371cff8fc3bd60d7be902ea69cbdb7965a) 与 [官方中文模型](https://huggingface.co/myshell-ai/MeloTTS-Chinese/tree/af5d207a364ea4208c6f589c89f57f88414bdd16)：二者分别标注 MIT，提供内置中文音色，官方声明支持中英混读和 CPU 推理。这是选型依据，尚未证明本机速度、中文效果或所有原安装依赖可直接采用。代码固定 `209145371cff8fc3bd60d7be902ea69cbdb7965a`，语音模型固定 `af5d207a364ea4208c6f589c89f57f88414bdd16`，文件大小和大文件 SHA-256 见 `scripts/ttrpg-local-tts/selection.json`。

中文 checkpoint 为 207,770,124 字节，原中文路径还需 [多语 BERT 文本编码模型](https://huggingface.co/google-bert/bert-base-multilingual-uncased/tree/7cbf9a625e29989f6b9c6c2fa68234c304f7e38f)。该依赖独立标注 Apache-2.0，不能称整个链条均为 MIT；两组准入模型文件合计 882,608,084 字节，Python/张量运行库另计，4 GiB 是安装前暂定预算而非实测占用。只允许单份共享缓存，不把模型、虚拟环境或下载副本塞进仓库/交接包；安装前检查预算和剩余空间，推理阶段只读已校验本地文件，不临时拉取其他模型。

不整包安装上游 `requirements.txt`：其中 `pykakasi==2.2.1` 的发布元数据标注 GPLv3、`Unidecode==1.3.7` 标注 GPL，日文前端还引入未准入的 `num2words`。先冻结中文所需最小依赖及逐项许可；如需裁剪或改写入口，保留原 MIT 声明并以实际源码/依赖扫描证明未带入这些包，不能只从安装列表删除却继续导入。第三方组件原许可分别保留，不把 MIT 标签当作第三方权利无争议的保证。首批采用模型内置音色，不导入来源不明的录音或音色包。[官方 Chatterbox](https://github.com/resemble-ai/chatterbox) 保留为后续备选，其中文多语路径所需主要模型文件体积明显更大，本轮不预先下载。

`node scripts/ttrpg-local-tts/audit.mjs` 仅核对固定代码许可与模型公开元数据，读取本地可用空间，输出选型审核结果；不安装依赖、不下载权重、不调用模型、不读取作者项目、不写数据库。使用系统证书和代理的 Node 24 环境可加 `--use-system-ca --use-env-proxy`；不得关闭 TLS 校验。输出必须继续标记 `installReady:false` / `generationReady:false`，直至后续独立门实际完成。元数据审核通过不代表中文配音已经可用。

后续正式路径为：当前主持选择原已确认且本人可读的叙述 → 冻结准确文本/hash、团局/身份/来源版本和接收者 → 明确提交有界本机生成请求 → 原文优先留证及恢复状态 → 临时语音候选/实际时长与试听 → 另行确认原 E16/文件采用。生成不自动播放，不扩大原接收者，不用口音/情绪提示改写原文，不伪造逐字时间轴。未知结果、取消、安全暂停、身份交接、刷新与 stale 均不能隐藏重发；免费也须限制文本长度、累计任务/时长、并发与缓存。正式模型入口、来源注册、候选/确认、持久请求和完整媒资生命周期须先接现有治理底座并验证，再接产品按钮。

待验收：最小依赖及许可证、离线中文真实生成、CPU/内存/磁盘实测、原文完整性与长句/数字/中英处理、试听质量，以及实际 UI 的取消/刷新/未知结果/权限与采用链。当前没有安装权重或运行语音推理，不能称 P10 配音、P10 整体或跑团产品完成；既有人工上传、默认隐藏及其他联合完成门保留。

### 35.104 固定台词的有限离线音频评测入口（2026-10-17，治理基础）

在原唯一 AI 入口注册表的可选有限 transport 扩展中登记 `ttrpg.local-voice.eval`，边界固定为 `offline-fixture-audio-eval`、`adoptAllowed:false`，唯一调用者为 `scripts/ttrpg-local-tts/evaluate.mjs`。原正式 58 个 creative binding/62 个调用、旧冻结注册表和长篇语音边界保留；本入口不能调用正式创作执行器或获得作者/团局字段写权。新边界仅允许本工具目录的实际脚本，原语音边界继续只允许原 `src/` 调用者；原 AST 检查器核对真实调用处的字面量 entryId/caller，不以新协议放松旧入口。

`--check-only --case narration-zh` 读取固定四条开发台词与 SHA-256 合同，核对精确格式、唯一 case、最多 300 字/60 秒/120 秒执行期限；不读模型或作者项目，不生成、不采纳、不播放。原文/提示词/项目路径参数、未知或重复 case 参数、台词字节变化、采纳扩权及伪造调用方均拒绝。中文常规、中文数字与长句用于后续真实 CPU 评测；中英混合拒绝用例明确保留，中文精简阶段不能静默删掉英文、替换原叙述或冒充完整中英支持。

这是产品研发的固定 fixture 评测基础，输出不属于任何 Work/Build/Release/RuntimeSession，既无产品上下文源和数据库写回，也不新建表或世界引用。实际生成须继续使用固定本地模型、受限资源、独立评测目录与原始结果/终态回执；引擎未接时普通执行明确拒绝。正式团局配音仍按 §35.103 另接原已确认叙述、来源/接收者、候选、独立确认及持久异步生命周期，不能用本评测入口绕行。当前四文件 40 项入口/注册表/长篇语音关联回归通过，真实模型、音色质量和最新整合闸门分别留证。

### 35.105 固定版本的离线 CPU 语音评测工具（2026-10-17，代码已接，真实生成待执行）

沿 §35.104 的原有限入口补安装和执行工具，操作见 `scripts/ttrpg-local-tts/README.md`。`prepare.py` 只安装同目录固定平台 profile，不接受外部 profile/模型/仓库参数；macOS ARM64/Python 3.12 独立目录保存 41 个版本及文件 SHA-256 固定的运行包、15 个 MIT 内核/字典/许可文件及原两组模型文件。源码、模型配置与权重均校验准确版本/字节；安装有 4 GiB 预算、8 GiB 剩余空间底线、原始步骤与回执，中断文件保留并可明确续传，不隐式重新下载完整模型。原上游多语言包不安装。

中文前端保留原源码与 MIT 声明，另生成导数并记录每个原/新哈希与引擎版本：禁用未用的全语言特征分派与英文前端，tokenizer 只读原本地 encoder，特征由自己的 CPU 路径读取；内核在分配时序矩阵/解码前拒绝预测超过 60 秒的长度，不裁断叙述。MeloTTS 原 CPU 路径会在部分 Mac 上改变输入 device，本工具统一保持模型和输入在 CPU。加载使用 `weights_only=True` / `trust_remote_code=False` / `local_files_only=True`；不能因兼容失败放开任意 pickle 或远程代码。模型、运行库、源码和许可证分别保留来源；BERT、张量库和 tqdm 等继续按各自 Apache/BSD/MIT/MPL 等许可，不能把整个链条称为 MIT。

执行仍只接受原固定 case。主进程先保存运行意图、fixture/profile/源码 hash 和独立目录，单次子进程读本地固定原文；两线程、120 秒、60 秒音频、1 MiB 原进程输出上限，推理阶段禁止网络。运行锁隔离并发；取消/超时/失败/未知结果保留原输出和回执，不自动重发；晚到或源码变化不能计为本次成功。输出是开发评测文件，不导入作者数据库、不获得 E16 或播放权限。

实际 WAV、原始台词和归一文本、文件 hash、采样/时长、增益/RMS、真实耗时与峰值内存分别留证；主进程重新核对 PCM、格式、非静音、削波、原文/profile/fixture 和精确结果字段。中英不支持的固定反例必须明确零模型调用拒绝，不能删去英文后生成；任何结果都保留真人听感 `unproven`。中文数字目前先覆盖原中文台词，阿拉伯数字/中英与正式较长叙述仍需扩展和实际验收，不能据本评测缩小完整产品范围。

四文件 41 项入口/注册表/长篇语音关联回归通过，新增实际结果边界的合成 PCM 正反例，明确它们不是语音效果证据。13 个固定上游 Python 内核的字节校验、派生语法与关键拒绝位置已核对；41 个固定运行包已实际安装并核对版本/独立目录及零额外包，包依赖检查通过。本机完整内核/权重准备仍在进行，尚无真实模型输出、速度或听感通过结论。最终源码工程门、首次真实离线生成、最新完整 CI/E2E 与正式团局候选/异步/预算/发行链继续独立留证。

### 35.106 原生播放修复验收与本机缓存隔离（2026-10-17）

冻结 `3271dc7102e29d9132591dea8d6e1530c0a2e7e4` 实际执行原 17 文件 / 57 条原生浏览器用例，全部通过（12.3 分钟），运行前后源码无变化。包含原全部 52 条，以及背景双轨增益/实际解码/旧 URL 释放、正式停止与立即静音、默认手动/拒播、双节点身份交接和交叉通道不重启。此前 `c9f70ceb` 三条正时长失败保留原证据；本次通过证明连接节点、相对 DOM 顺序和同头只读修复的这些原生路径，不能回填旧失败或称语音质量已验收。该冻结完整 CI 和默认 E2E 按真实步骤继续，未返回不计通过。

后继 `6a481673` 的离线语音工具代码已通过 41 项关联回归、15 项必需工程检查及干净默认/预览构建和原体积门；当前全部浏览器源文件/断言与 `3271dc71` 相同，但新增有限入口的最新整合仍在另一份复用的干净 checkout 单独排队。运行中的原管线不切换源码，不创建额外仓库或 node_modules 副本。工具的 Hugging Face 缓存目录进一步固定在本次本机运行库下，避免依赖用户全局模型缓存或凭据路径；原禁网、本地文件和来源 hash 限制保留。中文权重已按原 SHA-256 完整核验，文本编码权重中断后按原断点续传，尚未运行模型。正式团局配音和全部产品完成门不因原生播放通过而关闭。

### 35.107 模型文件断点传输的实际修复（2026-10-17）

中文 checkpoint 已完整核验；编码模型部分文件在 `502,773,791` 字节时实际遇到 curl 92，安装监督器按原边界停止并保留原目录/历史，没有自动重试未知错误。[curl 官方错误码](https://curl.se/libcurl/c/libcurl-errors.html) 将 92 定义为 HTTP/2 流错误。本轮下载器固定 HTTP/1.1 后沿原字节断点继续，保留 TLS、准确原文件/hash、600 秒单次下载上限与原磁盘底线；不删除有效断点、不重装已核验运行包、不增加模型推理次数。

每次实际传输另记协议、原断点、实际字节进度、退出码和本地错误日志，stderr 最多 64 KiB。传输日志可能带本机代理诊断，仅本机保留，不外发到仓库/交接包；完成后仍须校验全部准确文件再允许推理。下载失败不改为静音文件、随机权重、其他模型或付费语音回退，原失败不被补写成通过。

### 35.108 免费中文内核的首次真实离线生成与协议回归修复（2026-10-17）

§35.107 的准确模型/源码文件和 41 个独立运行包已完成安装及核验。固定台词第一次实际调用本机 CPU 内核，输出由主进程按原合同复核；三段真实 PCM WAV 与原始进程输出、原文/归一文本、来源/文件哈希及终态回执均留在本机评测目录。没有调用付费 API、读取作者项目、自动采用或自动播放。

| 固定用例 | 实际音频 | 实测进程内耗时 | 实测峰值 RSS | 本次结果 |
|---|---|---|---|---|
| narration-zh 中文旁白 | 4.261 秒 | 39.55 秒，首次冷启动 | 2.19 GB | 原文、WAV、非静音及完整性复核通过 |
| numbers-zh 中文数字 | 5.050 秒 | 7.79 秒 | 2.17 GB | 原中文数字完整保留；不代表阿拉伯数字已验收 |
| long-zh 中文长段落 | 13.560 秒 | 9.43 秒 | 3.42 GB | 原段落完整生成，未截断 |
| mixed-script-rejection 中英混合 | 无 | 不调用模型 | 不加载模型 | 按原合同明确拒绝；未静默删词 |

以上为本机 macOS ARM64、CPU 两线程的有限固定输入实测，不能推出其他设备性能或独立听感通过；推理网络禁用，真人听感继续为 `unproven`。正式团局的原已确认叙述、候选试听/确认、持久异步请求、累计预算、完整语言/长文本与发行链仍须落实，P10 不因此结束。

冻结 `6a481673` 再次执行原 17 文件 / 57 条专项原生用例全部通过，源码未变化。较早 `3271dc71` 的全量 CI 实际为 980 文件 / 5856 项通过、1 项历史工具协议断言失败，后续默认 E2E 未执行；保留失败记录。本轮追溯到工具 v19 已登记的共同身份与此前本人身份来源：旧 v15→v16 差异断言遗漏了这两个后续增量。仅将它们从历史差异计算中明确排除，保留原历史哈希、当前完整协议哈希、旧请求续用和各 Skill 权限反例；不改变正式工具声明、来源权限、领域代码或原生断言。最新全量 CI/E2E 另以修复后的冻结版本留证。

### 35.109 固定数字、换段与精确朗读归一合同（2026-10-17）

沿原有限开发入口将固定 fixture/合同独立升级为 v2：原四个用例的 ID、原文和预期不变，新增真实阿拉伯数字与原文 `\n\n` 换段；每个音频用例增加固定的 `expectedNormalizedText`。子进程在加载语音/编码权重前要求转换结果完全相等，主进程再核对原始文本、同一精确归一文本及真实 PCM；仅有非空字符串或非静音文件不足以通过。不引入任意文本参数、项目读取、正式模型入口/字段/表、自动采用或播放。

分段用例最初两次在精确归一检查处失败，原进程输出和失败回执均保留；没有生成替代音频。核对已固定上游的四个纯预处理 AST 节点后，确认原规则会先把换行映射为句点，再处理空白；不能把它误写为删除换段或转为空格。修正固定预期后，原始文本仍含双换行，实际朗读文本独立保留。阿拉伯数字的 `8点20分`、`3次`、`12枚` 转换结果与原中文数字用例完全一致，不据此宣称任意数字、日期和单位都已通过。

同一冻结候选源码实际执行六个用例，前后源码差异为空：五段音频通过全部原结果复核，中英反例明确零模型调用拒绝。阿拉伯数字音频 5.050 秒、执行 5.77 秒；分段音频 4.435 秒、执行 5.76 秒；长段落音频 13.560 秒、执行 8.38 秒。本机原独立运行库/模型 profile、41 个运行包、准确权重和约 1.9 GiB 安装目录直接复用，无新增模型或 node_modules 副本。新增归一文本删改反例与固定输入边界回归；听感仍未验收，正式团局的异步请求、原叙述来源、候选/确认、累计预算和生产/发行继续按原 P10 完整目标施工。

### 35.110 云端原生首帧时序暴露的渐出范围修复（2026-10-17）

`6189b8ef` 的云端预览实际 138 条路径中 137 条通过，正式停止渐出在原测试及重试都未观测到中间增益；本机 `6a481673` 的 57 条专项通过不能替代这个云端失败。原截图、视频、trace 和原生状态保留。trace 直接记录首帧设置音量 `1.00257` / `1.00211` 导致的 `IndexSizeError`；原节点随后已释放、没有音量样本，确认保存到当前轨移除约 1.7 秒，不是三秒期限被放宽或等待结束后未采样。

原因是 rAF 时间戳对应帧起点，首个回调可能早于渐出启动时读取的 `performance.now()`。旧渐出只约束计算结果的下限，负进度会把原音量放大到 1 以上，或把较低音量反向提高。新增两项确定性反例分别从 1 和 0.4 音量复现：修复前一项抛出相同范围异常、另一项错误升至 0.4032；其余八项原过渡回归仍通过。修复将进度两端限制在 `[0,1]`，首帧保持原音量，后续正常递减；两反例及原八项复验全部通过。

本改动只修正本机展示数学，原媒体/受众/来源/身份检查、三秒总期限、实际在播/增益/URL 释放断言、暂停与静音立即取消均保留。无新表、AI 来源/写字段、生成调用或领域事件。最新完整关联检查、干净预览构建、原生与整仓 CI/E2E 继续按修复后的准确冻结提交留证，未执行不计通过。

### 35.111 正式配音前的原已确认叙述合同与本人审阅（2026-10-17）

仍属跑团 open、S3 产品能力研发。输入只取实际已完成 operation 的原已确认叙述，输出是跑团拥有的只读 `TtrpgOpenVoiceScriptV1`：当前 sessionKey/runtimeSourceHash、原叙述 sourceRef/完整结算 binding、当前准确接收者快照和全文。世界与冻结发行包 owner 不变，没有新媒资、发布物或世界写入。

`open-audio-contract` 的 `createTtrpgOpenVoiceScriptV1` 统一现有人工语音文件与后续生成的文字/受众规则。原文沿已确认段落以双 LF 连接，源合同不再次 trim、NFC 或改写数字；上限由原 KP 的 16000 正文与最多八段共同推导，包含段落分隔符。超过单次生成 2000 字符的原叙述仍完整保留，不借来源读取截断全文或绕开后续请求预算。公开配音继续关闭，私域仅真人 GM，AI 主持的真人兜底只保留原共同范围。人工 E16 文件仍取相同全文并核对原时间轴/实际素材；音轨回执形状和采用路径保持。

`prepareTtrpgOpenVoiceScriptV1` 在明确的“核对原叙述”决定下读取原 owner、事件、不可变来源、授权与文件回执，再保存文字/完整脚本 SHA-256 和本人本次审阅对象。`readTtrpgOpenReviewedVoiceScriptV1` 每次重新核对实际来源、授权和接收者；复制、改字段/重算 hash、跨 viewer/实例以及读取期间变更均不能冒用原对象。普通讨论推进序号不使不可变原文失效；安全暂停、真实参与行漂移、伪造的自哈希缓存头仍拒绝读取。新分支必须先完成自己的 Session Zero，再从原祖先结算中明确核对；父删除及完整备份后原文与命名空间保留，本人审阅对象不随备份传递。

共享 `open-audio-read-state` 复用原人类读取和回放/来源/媒资核验，只读脚本 API 统一从原 `open-audio-service` 导出，不另建 DB 入口、候选表或读权限缓存。当前审阅明确 `generationAllowed:false` / `adoptionAllowed:false`，不派发模型、创建 Run/Blob 或提交 E16；三注册表和 schema 没有新增项。正式模型单元仍须先登记原文来源与实际语音入口、durable request/原始输出、累计预算与候选确认，再接产品按钮，不能把这个只读审阅当成调用授权，也不能借固定 fixture 入口传入作者文本。模型只接收准确朗读原文，身份和接收者快照由确定性系统核验。

定向验证覆盖原文/换段/组合字符、拒绝附加指令与伪造授权、超过单请求的完整来源、现有语音文件一致性、公共/私域/AI 兜底、异步输入/审阅变更、真实讨论后复核与暂停、参与行漂移和实际存储 canary、自哈希缓存、分支/父删除/完整备份。正式异步任务、试听/确认、完整中英/长文本、发行及整体联合门保持原范围继续施工。


### 35.112 原文配音意图的持久预留、累计预算与未发送取消（2026-10-17）

本单元仍属跑团 open、S3 产品能力研发。输入为 §35.111 本人真实审阅的完整原叙述与明确选定的原文范围；输出是团局拥有的配音意图、原始输入工件和零模型 Run。沿用冻结 ProductRelease/Build、ProductRuntimeSession 与既有表生命周期，不读取或回写世界，不生成媒资。

`reserveTtrpgOpenVoiceRequestV1` 需要独立决定 `reserve-this-original-voice-part`，再次核对本人审阅、原事件/源版本/接收者、当前空闲且未暂停的结算。全文保持原字节，片段按明确 UTF-16 offset/length 定位、最多 2000 字符，不越界或拆开代理对，不自动裁剪全文。片段不代表已经实现整段长文的分段合成或时间轴。每次准备另冻 preparationKey；原输入、全文/片段 hash、读取基线、requestKey 和 RunContractHash 一起进入 `ttrpg.audio.voice.reserved`。相同 submission 不能被不同准备、重算 hash 或并发点击替换；孤立准备留失败终态，已提交的准确原请求优先于中断返回。

`voiceRequests` 只在第一条真实事件后出现，旧状态不补空数组。每世界轮累计最多 3 次、6000 字符，已取消预留仍计入；刷新、新 Run、备份和分支切点都不能清空原额度。请求不进入行动/Oracle/实体的机械依据，不阻止桌面交流或新叙事窗口，不修改角色、资源、知识、骰点或世界时间。主机只读 API 返回本人有原准确接收权限的记录，其他玩家不获得私域请求/预算目录。

每个意图复用原 Instance-owned Run、append-only 事件及 `source-snapshot`。此 Run 的模型预算、输入/输出 token 均为零，`contextSourceKeys`/`writeTargets` 为空，没有 Skill、模型或采用权限；工具预算为原零模型工具合同的最低 1，当前不调用任何工具。未发送取消需要明确 `cancel-this-unsent-voice-request`，核验原本地 Run/完整输入/事件及无模型、工具或子任务证据，事务重核 Run 集合、原事件、真实头与参与行。暂停或后续事实/局势/实体窗口允许这类纯收尾，不能借此发起配音或行动；重复取消只恢复同一条回执和原 Run 终态。

`PROJECT_TABLES.exactArtifactRoots` 登记请求事件、当前/初始状态和祖先快照的输入引用，父团局/Run 删除后，分支仍保留完整证据并拒绝显式裁剪。备份另以原 Run 归档 v3 `voice-intent-only` 保留历史契约/事件，严格拒绝模型或工具调用；该阶段只供 archive 读取，不能伪装 v1 正式请求。导入、原 Run 缺失或祖先请求不恢复本机执行/取消权；新请求须本人重新核对原文并使用新 submission，仍累计旧预算。

**当前交付是请求预留 API，不是正式合成按钮。** 未新增 AI 来源、Field/Adoption 或供应方入口；固定免费离线评测入口和 `productInvocationAllowed:false` 保持。后续正式本机执行必须先完成本意图的确定性提交验证/终态 receipt，再以独立受治理的 lineage Run 冻结实际产品语音 profile、登记的准确片段来源/Context Manifest 与传输；不以活动 ownership 子 Run 绕过现有父子契约。发送、取消请求、已确认停止和 unknown/迟到结果仍须独立持久事件，未知不得重发，原始输出先成为候选、本人试听/核对后才走 E16，不能把当前取消回执套用于已发送任务。

定向回归覆盖原文/长来源精确片段、代理对反例、累计额度及取消幂等、暂停/后续局势窗口、本人目录隔离、并发、缓存 canary 回放恢复、分支/父删除/显式裁剪/备份、导入归档防冒用，以及经注入模型传输实际采用的 KP 叙述来源。另新增隔离原生浏览器的 IndexedDB 刷新/取消验证用例；结果按冻结提交单独记录，不把用例存在视为已通过。当前最新提交的完整 CI/E2E、真人试听、真实叙事供应方、30+ worldTurn、完整中英/长文本、正式合成/发行与产品联合验收继续未完成。


### 35.113 配音意图的真实终验与注册原文来源（2026-10-18）

仍为跑团 open 的 S3 产品能力研发。§35.112 的零模型 Run 只负责“本人原文配音意图已记账”，不能一直借活动父 Run 等待语音，更不能伪造模型上下文完成它。本单元完成其真实事件前缀回放、实际 post-state hash、准确输入工件与唯一终验回执，随后才可沿现有 completed-parent lineage 另建语音执行 Run。世界、发行包、媒资 owner 和原请求额度不变。

共享 V1 `VerificationReceipt` 以可选 `zeroModelCommit` 保存原 canonical 合同及非空输入工件引用。只有合同模型/输入/输出预算为零，Context/Skill/写回权限为空，且没有候选、采用、语义评审时，才允许空 Context Manifest 数组；创建及完整性核验都要求嵌入合同 hash 匹配原回执合同 hash。普通模型回执仍要求原非空 Context Manifest，旧结构/hash 不变；freshness 另比对该显式扩展，旧消费者不能把不认识的零模型证明当成普通模型回执。

预留正式提交后，`finishTtrpgOpenVoiceIntentForKernelV1` 从真实事件前缀回读本次预留后状态，保留固定原事件时间、post-state/输入证据，依次恢复 step.succeeded、verification.started、终验工件与 verification.accepted。只对账本竞争做有限恢复，不调用模型、工具、候选或运行规则。原提交赢过返回中断；显式 `recoverTtrpgOpenVoiceIntentV1` 可补同一条证明。已完成的“意图已记录”不因后来取消朗读而改写；取消只更新原团局取消事件，仍保留额度。旧尚未完成且无执行子任务的意图也保留原取消方式；存在执行子任务时不把它猜测为未发送，后续取消/unknown 必须由执行链确认。

新 `CONTEXT_SOURCES.ttrpgOpenVoiceText` 只接受准确 viewer/requestKey/intentReceiptHash，重查本地原 Run、实际记账证明、不可变原文、当前空闲/安全状态与准确接收者，再返回预留原文范围的字节。它是单一 protected/atomic 来源；`assembleContext` 不加标题、不 trim、不重写数字/换段，不足预算直接拒绝而非剪裁。源的 provenance 为 runtime；不建立角色资源目录，不扩展现有 Skill 或 Gateway 工具枚举。读取本身严格只读，未完成记账须另行明确恢复，不借模型来源读取补写 Run。导入、取消、错误证明、跨 viewer/作用域、暂停和字节/受众变化均拒绝。

定向验证覆盖普通 V1 兼容、零模型证明防冒用、完整合同 hash/freshness、真实 post-state 与原字节装配、原子预算、暂停/取消/导入隔离，以及三个账本阶段各自写前/返回后中断的六条实际恢复路径。另用真实泛型 Run API 验证唯一 completed-parent lineage：错误证明和重复 relation 不能建执行 Run，合法子 Run 可读取原片段，取消不能借父记账记录跳过子任务。该测试不发送语音模型。原隔离原生刷新用例补充从 IndexedDB 终态证明读取注册原文，原断言保留；执行结果仍按干净提交单独验证。

**当前尚未接通正式本机语音合成。** 已完成的是实际执行前所需的终验与准确来源；免费产品语音 profile/传输、朗读归一的可核对证据、持久发送/停止/unknown、原始音频候选与真实片段时序、试听/E16、发行与完整中英长文本继续施工。固定离线评测入口与 `productInvocationAllowed:false` 没有更改，不能借新来源或完成的意图 Run 绕过它。最新提交完整 CI/E2E、独立真人/真实叙事模型/30+ worldTurn 及 P9/P10 整体验收继续独立。

后续产品前端的纯 CPU 核对另发现：当前固定 Melo 归一规则会将 `编号001` 转成 `编号一`，去掉时间冒号、骰式加号或超出其中文字集的字。此项只执行固定源码的文字函数，没有加载或调用语音模型；§35.109 的八点/换段样例不能外推为任意数字、日期、骰式或姓名均正确。正式接入应先用原只读审阅做确定性的读法预览/不支持拒绝，确认后再预留预算并冻结实际变换版本和结果。原叙述与完整输入保持，不以静默替换/删除修正这些问题；Melo 未提供的逐字时间戳也不能补造。

### 35.114 免费本机配音的原文读法预检（2026-10-18，产品接入准备）

仍为跑团 open、S3 产品能力研发。团局继续拥有原已确认叙述、来源及受众；世界和发行包只读，媒资 owner 不变。此单元没有模型调用、新表/schema、AI 可写字段、上下文权限或运行事件。原已登记 `ttrpgOpenVoiceText`、原文意图/额度和固定评测边界均保持；当前预检不产生音频或请求预留。

独立 `reading-profile.json` 固定同一份安装的资产 profile hash、准确 MIT 上游前端源码 hash 和 cn2an 0.5.24。`reading-preview.mjs` / `reading_frontend.py` 只执行原源码中的四个文字归一定义，禁止网络，实际断言进程未导入 torch、transformers 或 melo，不初始化 tokenizer 或模型。保留原 `runtime-profile.json` 的 `productInvocationAllowed:false`，不借固定台词评测通道传入作者文字。安装、权重、依赖及其许可不复制、不重新下载。

预检保留完整原片段、原 UTF-16 字符位置和 hash，单次原文最多 2000，展开读法独立最多 4000，最多 64 个明确读法选择；10 秒期限、64 KiB 有界输入/输出和取消只作用于这次 CPU 检查，不自动重发。编号/前导零、带符号的数字、日期/时间、骰式、混合英文或不支持字符先成为 `needs-reading-choice`，归一文字为空；不能把上游已丢字的结果显示为可朗读。问题坐标明确属于展开后的 `readingText`，问题过多时保留实际总数、展示前 64 条，完整原文字保持。

人可为原范围明确指定读法，例如 `001 → 零零一`、`2d6+3 → 两枚六面骰，加三` 或姓名读音。范围必须有序、不重叠、非空且不能拆开 UTF-16 字符；这些选择独立保存，不改写原叙述。重新预检通过后展示实际前端的完整归一文本与 hash，仍仅为 `ready-for-reading-review`，没有生成/采用权。未来发音效果还须真实音频试听，字面读法一致不能替代音质与多音字验收。

`prepareTtrpgOpenVoiceReadingReviewV1` / `readTtrpgOpenReviewedVoiceReadingV1` 复用本人真实原文审阅与现行音频 owner 校验。序列化前端 JSON 仅是待核对资料，本身不证明来源或执行权；服务核对准确原片段、profile、选择、归一 hash、当前身份/受众，期间及再次读取都重查原 owner。跨 viewer、伪造/变更审阅、片段不符、安全暂停或原授权变化拒绝；不补写 Run、消费额度或推进世界时间。正式请求之后必须冻结这份原文/读法/profile/预览证据，由真正语音 worker 再次复算后才能发送，旧无读法意图不能因此自动升级为可执行。

本机实际固定前端已验证：普通中文/阿拉伯数字/换段保持原文并返回准确读法；编号、骰式及生僻字先阻断，显式选择后返回 `零零一`、`两枚六面骰,加三` 和明确姓名读音，均无模型加载。定向检查覆盖原范围、补充字符、不重叠/空选择、独立预算、有界问题总数、前后 hash/版本/权限、实际本人来源与暂停；结果按当前源码另行留证。语音产品 profile、桥接 UI、确认后持久请求、执行/停止/unknown、真实音频候选与 E16，以及完整 P9/P10、独立真人/真实叙事模型/30+ worldTurn 验收继续未完成。

### 35.115 原请求中的明确读法确认与可搬运版本说明（2026-10-18，配音执行前）

继续跑团 open、S3 产品能力研发。ProductRuntimeSession 拥有原已确认叙述、预留及读法，世界/发行包只读、媒资 owner 不变；此单元仍不生成语音。没有新表、schema、模型入口、AI 可写字段或上下文权限，沿原请求、零模型 Run、事件和 exact source-snapshot 生命周期保存，不建立第二份配音预算或独立任务表。

`reserveTtrpgOpenVoiceRequestV1` 可显式传入本人原读法审阅及 `confirm-this-exact-local-voice-reading`。函数在任何异步读取前固定该次确认、原范围和 submission；随后复核原文/受众/身份、完全相同的片段、原预检与完整归一文字，待解决读法、复制审阅、错误决定或过时授权不能创建 Run 或消费额度。此确认只把准确读法记入原预留，不授予模型调用、候选采用或播放。

新请求可选 `reading` 使用独立闭集的 `storyforge.ttrpg-open-confirmed-voice-reading` V1：原片段 hash、明确选择、完整归一文字及 hash、预检 hash、明确确认决定，以及**完整读法 profile 描述及其 hash**。描述保留原 profile/资产 profile 身份、资产及 normalizer hash、数字前端版本、固定资源边界与零模型/采用权限，不包含本机路径或物理 ID；换电脑审阅不依赖旧分支仍存在。V1 原范围/展开/选择预算作为版本常量，不能由今天的安装配置重解释历史。

缺少 `reading` 的旧请求、原输入工件和 hash 保持原字节，不填默认读法或自动升级。历史读取独立核对原完整 profile 描述、原文、归一字节与预检 hash；未知旧 profile 可保留为历史，但不能进入当前前端或取得执行权。当前读取资料若自行增加模型/采用权限、改预算或外部脚本路径，即使重算自己的 hash 也不准入。

冻结记录连同原文进入唯一原始输入；Run 的 runtimeBindingHash、真实提交 post-state、原预留事件和终验共同绑定读法。`ttrpgOpenVoiceText` 仍返回准确原文，绝不把朗读变换冒充原叙述。分支切点、父删除和完整备份保留读法及工件根，累计额度仍按原文计数、取消不返还；导入不恢复本机审阅能力或执行权。返回中断只恢复同一条原终验和读法，不创建替代请求。

定向用例覆盖明确确认、旧输入兼容、未解决/克隆/错范围/暂停、哈希和权限反例、调用后的参数变化、分支/父删除/工件裁剪/备份，以及实际终验返回中断。真实回放依赖图把新纯合同模块显式纳入原 open 构建分组，不加载模型/生产读取者，仍受原无环和体积门约束；冻结 E2E 工作区显式携带浏览器真正导入的归一描述文件，不复制语音执行器。另新增真实 IndexedDB 刷新用例，保留原全部原生断言；用例存在不代表已经执行。语音执行 Run、真正的 product profile/传输/确认停止/unknown、真实片段时序、候选试听与 E16 仍按原范围继续，不把读法确认或零模型父 Run 当成语音已生成。


### 35.116 本机配音的唯一执行谱系与原始返回（2026-10-18，内部桥接边界）

继续跑团 open 的 S3 产品能力研发。原叙述、原意图、执行 Run 与运行媒资归 ProductRuntimeSession，世界和发行包只读；不增加表、schema、正式 AI 可写字段或第二套请求额度。独立 `prose.ttrpg-open-local-voice` Skill 只读原 `ttrpgOpenVoiceText`，无工具、Gateway 规划或写回权限，来源仍须完整原子交付，不运行压缩模型。正式入口 `ttrpg.open.local-voice` 显式冻结 `outputModality:'audio'`，使用独立的冻结非文本执行器；旧文本绑定不补字段、不改变原 hash，音频不能借用 Chat 或流式文本通道。

本人明确准备后，原已完成零模型意图的准确终验回执及真实验证工件形成唯一 completed-parent lineage；并发点击和返回中断仅恢复此关系，不能另建子 Run 或重新预留原额度。执行输入分别保留原准确片段与来源/受众、原意图工件/回执、原确认读法和完整产品 profile。实际 Context Manifest 来自注册源装配，哈希指向原文，不能把归一文字冒充原叙述。准备步骤、输入、Manifest 和装配事件分别持久化；普通读取不代替修复，不会记录模型已发送或音频已生成。

`product-profile.json` 独立引用现有已核验资产版本，保留原评测 profile 的 `productInvocationAllowed:false` 和零模型读法 profile。产品描述冻结原文 2000、展开读法 4000 个 UTF-16 单元、每段 200、最多 64 段、最多各 64 次语音推理和文本编码、900 秒、现有 100 MiB 文件上限、CPU 两线程、30 分钟整次期限、禁网络/自动重试/自动采用以及 worker 必须复算读法。上限是保护合同，尚未证明所有边界输入都可生成或听感可用。通用合同的文本输入估算和最多一个文本输出 token 只是来源/封装窗口上界；实际语音/编码模型次数、字符、样本、字节与耗时须另留真实证据，不填造实际 token 或费用。

内部派发动作要求准确本机 transport/profile、原准备和冻结入口，先按唯一子 Run 的准确 input hash 持久记录 `model.requested`，再进入传输。冻结绑定的异步核验之后、真正调用传输前再次检查原 owner、暂停/同意状态和取消信号；核验期间发生暂停不能发送。竞争者、刷新和重复继续均不调用传输；记账返回丢失也不能推断未发送。传输原始返回先完整持久留存，再记录响应，尚不解析为通过的音频候选。异常保留原 job、可见暂停和未知边界，不自动返还额度、重建或重发；已有子任务的意图也不能沿旧“未发送取消”跳过真实执行状态。读取、人工测试或原始返回本身不授予播放、媒资采用、E16 或世界时间变化。

当前仍缺实际离线产品 worker、桥接/UI、读法复算后的真实音频、严格音频候选与真实片段/样本时序、试听及独立 E16 确认。工程注入传输不算真实 Melo 产品调用，旧固定台词音频也不算本产品执行完成。后续按原范围继续完成 unknown 查询/确认停止/迟到结果、媒资发行/安装及完整中英长文本，再分别完成真实 provider、独立真人、30+ worldTurn 与 P9/P10 联合验收；此单元不改变公开入口和整体验收状态。

### 35.117 原请求的免费离线 worker 与本机传输（2026-10-18，真实模型验收待执行）

本单元继续跑团 S3 产品研发，沿原 ProductRuntimeSession 的意图、执行 Run 和媒资 owner，不增加表、schema、世界读取或 AI 可写字段。内部明确动作 `generateTtrpgOpenLocalVoiceV1` 复用已预留且确认读法的原请求，正式音频入口仍只有 `ttrpg.open.local-voice`；没有借固定台词评测或零模型预检扩大调用权限。桌面合成按钮、候选试听和独立 E16 确认尚未开放。

独立产品描述升级为 V2；完整 V1 另留 `product-profile-v1.json` 供历史解释，不把旧描述改成新权限。V2 冻结实际产品 worker、Node 任务/协议、本机传输、领域执行器以及复用的内核核验/读法源码九项 SHA-256。维护时用 `pin-product-profile.mjs` 明确重建，再用 `--check` 核对；执行前和 worker 关键边界检查真实源码，变更后不能继续冒充原冻结版本。旧任务凭原输入的完整 hash 仍可查询和请求停止，新启动须通过当前完整合同；历史版本不能被静默升级或重发。

本机服务仅在操作者明确配置运行库目录时启用，限制 loopback、准确 Host、同源和专用请求头；静态站点不提供该进程服务。创建/查询/刷新均不启动模型，也没有后台自动泵队列。客户端等待空闲后，在唯一一次 `/start` 前重新读取原注册来源、本人和当前授权；完整输入 hash 不同即停止。创建、启动前永久 claim、输入、租约、原进程输出、逐段调用记录、部分 WAV 和终态都留原目录；启动返回丢失、未知或竞争失败不会补发。单一运行槽同时尊重已有安装/评测锁；不得复制模型或依赖来绕过等待。

运行中每两秒复验原来源和授权，再续约十秒租约；浏览器中断、服务重启、网络丢失或授权撤销都不会获得无限孤儿执行权。Node 与 worker 分别以单调时间检查，系统时钟回拨不能延长同一租约，已到期租约不能被迟到续约复活。停止请求与真实停止确认分开：本服务只向自己实际持有的子进程组发信号，重启后不凭旧 PID 杀进程；未知任务写入停止请求，由原 worker 看门狗处理。容量释放要求实际子进程关闭，或准确 worker 启动身份已观测消失并且进程检查无引用；丢失控制器 PID 本身不足以释放槽位。完整迟到结果保留为原始输出，不伪装为“已确认停止”。

实际 worker 先在零模型前端复算完整已确认读法，再按最多 200 个 UTF-16 单元分段，覆盖全部准确归一文字，不能截断、静默删词或补造静音。复用同一份已核验 MIT 中文内核/权重及独立 Apache-2.0 编码模型，CPU 两线程、禁网络和嵌套进程。每段推理前限制预测帧数，最多 60 秒；整次原有 64 段/各 64 次模型调用、900 秒、100 MiB 和 30 分钟上限不放宽。原始文件为 44.1 kHz 单声道 PCM16 WAV，逐段记录真实归一文字偏移、样本偏移/数量、增益，以及真实编码/语音调用开始与完成；这是段落样本时序，不能标成逐字对齐。接收端重新核对完整覆盖、文件 hash、WAV 物理长度和真实 PCM 能量，不接受自报通过或静音伪造。

HTTP 状态响应限制 64 KiB /15 秒，原始响应另受实际文件上限的 Base64 封装预算和 120 秒读取期限；所有响应还受原整次期限限制。超时、取消、协议失败与未知返回均保留同一 job，不能返还原额度或偷偷重试。普通 E2E 快照只带 Vite 所需 Node 导入和元数据，显式移除运行库环境变量，不拷贝 Python 推理器/权重，也不因测试探测调用真实模型。

已增加原注册来源输入与实际 Node 协议的跨端核验、取消/迟到/升级/租约/物理 PCM/传输反例；合成 PCM 和注入进程仍只算协议工程证据。另增显式 opt-in 的真实浏览器 IndexedDB → 正式 Run → 同源 HTTP → 固定 CPU worker → 原始工件验收，必须在明确运行库和独立数据中实际执行后才可报告通过；它也不替代正常作者 UI 或独立真人试听。原始结果还不是 CreativeArtifact 候选或正式音轨：paused/unknown Run 的明确证据恢复、完整候选验证/试听/采用、E16、媒资发行安装、中英长文本和整体验收继续按原范围施工。

### 35.118 原本机任务的停止屏障与原始结果恢复（2026-10-18，服务端协议）

继续跑团 S3 的同一运行 owner 与原任务，不新增模型入口、表、schema 或额度。Node 停止接口先持久保存准确 jobKey/input hash 的停止屏障，再查任务；即使停止先于创建或碰到尚未写完的任务，也不会因“文件未找到”丢失意图。缺失任务只报告停止已请求、后续启动被阻止，不报告 worker 确实结束。后到创建沿原输入封存未启动取消；跨控制器在永久启动 claim 后、实际 spawn 前的停止也阻止启动。已发出停止的任务不能靠另一个控制器续约；真正持有子进程的控制器在收到实际关闭后确认，完整迟到结果继续保留。

新增显式 `recover-raw` 动作，仅检查原任务，不能创建、启动或重发。已有观察到成功关闭的完整结果直接沿原证据读取；结果未知时，必须核对准确永久 claim、worker 启动 nonce/input hash，并实际观察原控制器和 worker 的进程身份均已消失且无相关 worker，再重新验证完整结果、WAV 和物理样本。缺失启动证据、仍活着/无法核实的进程、损坏文件和已知失败终态均保留原状。成功恢复的证据种类是 `verified-result-worker-absent`，不捏造退出码 0，也不把它叫作原已观察成功关闭；普通 GET 不执行这次恢复。

原 V2 完整描述保留为 `product-profile-v2.json`。V2 线协议和物理上限不变，具体实现修订继续由完整描述/hash 区分。读取旧完整结果时使用其原输入中的实现 hash，只接受同一受支持的 V2 物理合同与固定来源路径格式；旧输入仍不能借读取启动当前代码，修改物理预算也不能蒙混通过。原始返回新增明确完成证据类别，始终保持 `candidateAccepted:false`、`adoptionAllowed:false`；旧 raw 工件保持原字节，不回填新字段。

传输拒绝无效 UTF-8，不用替换字符改写原始返回，原始 BOM 也不被静默裁去。stdout/stderr 共用原 64 KiB 诊断总预算，超限保留准确前缀并请求停止，实际子进程关闭前不确认。控制及锁历史子目录要求当前 UID 的真实目录，未知符号链接保留并拒绝写入；不改全局清理保护或扩大退休目录白名单。

本节是服务端控制/证据协议增量。本人原 Run/来源的查询门、停止的持久 Run 屏障、paused 检查点恢复和原始返回记账仍须接入，之后再做严格候选、试听与独立采用/E16；不能把直接读取本机 JSON 当作这些步骤已完成。旧冻结的真实模型/全 CI/浏览器队列继续保持原源码，当前新增协议测试不替代真实模型、正常作者界面、独立真人或完整长局验收。

### 35.119 取消与原语音子任务创建的原子边界（2026-10-18）

已复现原有竞争：本人未发送取消先提交，准备流程仍可在随后创建一个 running 子任务，再因来源过期报错；零模型父意图保持 completed 的历史本来正确，但取消记录与新子任务矛盾，使请求列表无法正常读取。复现未调用模型，原失败证据保留。

共享 Harness 先以独立基础提交提供可选的 Instance owner 全记录 hash 前置条件，在既有创建事务内校验，旧调用、原合同/hash 与备份身份不变。跑团随后只在创建原唯一子任务时提交刚刚核验的实例快照：取消或实例更新先提交则整次创建拒绝，不留下 Run 或事件，也不重读来源后偷偷重试；子任务先创建时，原取消命令继续通过既有事务见证拒绝“未发送取消”，应使用后续执行停止流程。派发前的来源、身份及授权复验保持。

定向回归同时检查取消先胜、原 completed 父意图、无子任务/模型事件以及请求列表仍可读；并发准备、各记账返回中断、导入/分支和原额度沿既有测试验证。产品实现 pin 随源码更新，物理预算、世界/媒资 owner、三注册表、schema 与已有存档不变。该修复不宣称本人查询/停止屏障、paused 原始返回恢复、候选试听与 E16 已接通，整体验收仍按原范围继续。

### 35.120 原语音任务的本人只读查询（2026-10-18）

新增内部 `readTtrpgOpenLocalVoiceJobV1`，沿已完成的本人零模型意图、唯一原本机子任务及准确 source-snapshot 读取 job 身份。查询不调用准备、当前产品输入构建器或 Context 生成来源，不创建/修复 Run、检查点、预留、模型事件或媒资；完整来源、原确认读法、父回执/工件和冻结 profile 的 hash 都从原记录核验，代码升级不会把旧任务改绑到当前实现。

查询前核对原接收者完整 seat/viewer/actor/role/controller 元组，响应后再核对实际 owner、原始记录和当前进度。本人可在玩法暂停时查看元数据，但暂停不授予生成或新播放权限。导入/祖先历史、错误 owner、损坏或缺失的原输入均拒绝访问本机 job；控制专用的较低权限定位只返回原 job/input 标识，即使已有输入，也不读取或返回该输入正文及音频读取身份。

本机元数据仅通过固定同源 GET，沿原有字节/期限/UTF-8 上限接收闭集字段，冻结发送前的 job/input/profile 身份，拒绝响应换绑或矛盾状态。缺失任务、请求停止、真实确认停止、结果未知和完整迟到结果分开；backend `canStart` 只表示槽位条件，领域返回始终保持 `generationAllowed:false`、`adoptionAllowed:false`、不自动重试。读取文件存在或 backend generated 不会把原 Run、候选或采用标成已完成。

本节交付只读领域入口及其工程回归，尚未接入正常作者操作界面。停止的持久 Run 屏障、paused 原始返回记账恢复、严格候选/试听、独立采用与 E16 仍按原计划继续，不以查询或注入的元数据响应替代真实模型、真人和完整 CI/E2E 的当前提交验收。

### 35.121 原本机配音的持久停止屏障（2026-10-18）

本人明确停止时，先核验原完成意图与唯一原子任务，持久创建绑定原 job/input 的已见证检查点，再暂停运行记账并 POST 原本机取消端点。准备尚未写完输入也可停止，不重新预留、补写来源或读取音频；取消和刷新不返还额度，父意图仍保留原 completed 历史。并发/重复停止复用原屏障，记账返回或 HTTP 返回中断都不触发自动重试。

推理权限检查位于已 pin 的执行源码内：准备、派发、异步正式入口核验后的实际调用，以及实际启动/租约回调都核查历史控制证据。它逐一验证检查点与真实事件前缀，缺失/损坏的已见证正文不能当作“没有屏障”；后来的普通检查点或 generic recovering→running 也不能抹去原停止或仅取回原始证据的屏障。恢复期间已有仅取回证据屏障时，停止不会覆盖其最新检查点；若 recovering 缺少产品控制证明，则保留原恢复状态并拒绝扩大动作，不伪称停止成功。

核验时暴露的通用 Instance 检查点事务缺口先以独立共享基础修复：核验、恢复开始/完成显式传入准确实例 owner，原 Work 事务与旧 hash 不变。停止后 Run 暂停记账与实际进程关闭分开：缺失任务仅证明请求阻止后续启动，真实关闭只沿本机既有进程证据返回；不凭停止请求把 Run、候选或采用改成完成。已结束/未知/迟到结果仍需检查同一原任务，禁止重发模型。

控制载荷里的 jobKey 是外部原任务的历史标识，备份保留原字符串，不能重映射成新执行权。导入/祖先任务在访问本机前拒绝，原 session 删除继续沿 PROJECT_TABLES 删除其 Run/检查点。当前是内部领域/传输增量；正常作者界面、paused 原始返回记账恢复、严格候选、真实片段时序、试听及独立采用/E16 仍继续施工。新增浏览器用例使用真实 IndexedDB 与零 worker HTTP 夹具，需在准确冻结源码上实际执行后才可记通过；它不替代实际语音模型或真人验收。

### 35.122 原本机配音的准确原始返回与 paused 记账恢复（2026-10-18）

本单元属于跑团产品能力研发、S3.4 运行媒资候选前的证据恢复。入口为本人明确的 `recoverTtrpgOpenLocalVoiceRawV1`，输入是原 request/session 身份，输出只含原 Run/job/input/Manifest/原始正文 hash 与记账状态，不包含可采用候选。WorldRelease 仍只读，媒资仍归跑团实例；没有新表、字段采用权或新的模型调用。复用 `ttrpgOpenVoiceText` 的原 Manifest、Instance Harness，以及 PROJECT_TABLES 已登记的 Run/事件/检查点/内容寻址工件生命周期，不能绕过原作者与接收者授权。

恢复前读取原完成意图、唯一执行子 Run、原准确输入和冻结正式入口，用原存储 profile 及完整接收身份核验；不调用当前输入构建器、上下文组装器、供应方探测或生成端点。只允许已有唯一 `model.requested` 的原步骤/attempt，准确 Manifest 必须仍可读、完整并绑定原作用域、全部原文与原 context 事件。已知 failed/cancelled、未经派发、导入或祖先历史在访问本机前拒绝；当前授权在 HTTP 返回后及每次记账前重新核验。游戏暂停不妨碍本人合法取回证据，但不授予新推理权。

已有准确 raw 工件时直接复用原字节；没有时只显式 POST 同一原 job 的 `/recover-raw` 一次。HTTP 不明保持不明，不自动重试、创建任务、启动/续约模型、预留新额度或生成候选。返回先按独立字节/时间上限完整读取和 hash，不在持久保存前解析成音频候选；BOM、空白和非法音频正文也保留原状，后续另行校验。缺失、损坏、被裁剪的已见证 raw，或已有响应事件缺少准确原正文时，不从本机重新取回覆盖证据。

paused/中断恢复先持久保存 `recover-original-raw-only` 检查点，绑定原 job/input 和准确 raw hash，再沿显式实例 owner 完成同一检查点恢复，补齐原 raw 工件及唯一 `model.responded`。检查点、恢复开始/完成、raw 写入与响应事件的真实提交返回中断均可明确继续；竞争只作有界序号重读，不重取 HTTP 或重发模型。历史控制屏障持续阻止推理，停止与恢复交织不覆盖正在恢复的原检查点，冲突 hash 保留并拒绝。返回 `raw-response-recorded` 不表示 Run 终验、候选、采用或音频质量已完成。

实现中复现并修复一个准确恢复问题：原 raw 包络曾把实时 `cancellationRequested` 混入正文，后来请求停止会改变同一返回的 hash。现在在首次交付前以独占、仅当前 UID 的小型回执固定 job/input/launch/result/audio/完成类别和首次停止标志；每次重读仍实际核验原结果与 WAV，回执损坏时保留并拒绝。结果对象键顺序固定，不另存音频或 base64 副本。raw 中的停止标志只描述首次交付，当前停止/物理关闭状态继续从 GET 状态读取；已有工件不补字段、不重写。产品 V2 线合同和物理预算保持，实际实现 hash 随修改更新。

定向回归覆盖五处真实提交后的返回丢失、并发、原接收权限撤销、游戏暂停、旧 profile、缺失/损坏/裁剪证据、已知终态和备份/分支/原 session 删除；原始返回夹具明确不是有效音频。新增原生用例覆盖真实 IndexedDB、HTTP、刷新后同一请求恢复及再次读取零 HTTP；在准确冻结提交上执行前只记收集，不冒充通过。原有真实 worker、完整 CI 和默认 E2E 保持原进程及队列，不能用本单元的注入传输替代。正常合成/恢复界面、严格音频候选、真实样本时序、试听、独立采用/E16、真实模型与真人/长局整体验收继续按原目标施工。

### 35.123 原配音返回的物理校验与待确认候选（2026-10-18）

本单元继续属于跑团产品能力研发、S3.4，唯一 owner 为原团局。`prepareTtrpgOpenVoiceCandidateV1` 要求本人明确审阅原已派发、已留存 raw 和单次响应事件；只读入口 `readTtrpgOpenVoiceCandidateV1` 不填补缺口。沿原意图/唯一执行子 Run、完整接收身份、准确 Manifest 和历史 profile 读取，不调用 HTTP、上下文组装、生成、修复模型或新预留。没有新表、schema、世界写回或 AI 字段采纳权限；候选复用 exact `source-snapshot` 工件和 Instance Run/检查点生命周期。

共享音频引用合同先独立提交：`CreativeAudioArtifactV1` 不把大音频截断或塞进文本 V1，固定原输入/Manifest/raw hash、音频小描述、问题和一个原请求身份。一次任务可以分段调用编码器/语音模型，原请求不冒充一次物理调用或文本 token；真正物理用量保留在产品原结果与验证快照。纯合同解析不证明真实字节、权限或真人听感，`humanListening:'unproven'`、禁止自动采用/重试持续保持；原文本 V1 字节不变，文本采用判断拒绝音频合同。

浏览器结果适配器对冻结的 V2 物理合同与原实现描述核对原 job/input/profile/来源/读法/预检 hash，限定完整 UTF-8/封装/base64 预算及规范编码，实际解码后验证 RIFF/WAVE、单声道 s16le、采样率、完整长度/hash、样本总数和时长。逐段原归一文字 hash 与 UTF-16 范围、真实样本范围必须连续完整；每段/总时长、调用上限、增益、实际编码/合成次数和 PCM 能量/峰值均核对。历史实现 hash 可读，不升级成当前执行权；注入测试 worker、未知完成类别、截断、额外权限及伪造 metrics/usage 不能成为可用候选。

候选只存原大工件引用和小型物理核验快照；sample/归一读法时序明确 `wordAlignmentProvided:false`，不假造原文逐字/逐词标记，也不接入现有 E16 时间轴。坏 raw 保留并产生阻断问题，候选不携带假的音频、用量或试听；原证据丢失/损坏/裁剪属于证据失败，不能通过重建候选覆盖。相同 raw/input 的候选 body/hash 固定，保存正文、`candidate.persisted` 和绑定准确 candidate/input/raw 的专属检查点逐步幂等补齐；无关 generic 检查点不能代替完成。异步校验后重查原权限，备份保留原正文/hash，导入及祖先历史不取得当前审阅执行权，原 session 删除沿现有注册生命周期处理。

候选待确认后，原 raw 查询/恢复只复用已有正文和响应，不访问 HTTP 或增添恢复事件；缺失正文的异常待确认状态拒绝。配音审阅不改角色、世界时间、额度、既有媒资或正式发行。定向用合成 PCM 对照独立 Node 物理校验器，并覆盖实际提交后返回丢失、并发、权限撤销、原证据失败与跨端生命周期；这些不计作真实模型或真人听感。原生 HTTP/刷新用例延伸到阻断候选保存，当前只按实际收集/执行结果记录。正常作者界面、真实候选试听及独立确认、正式媒资采用/E16、发行安装、当前精确提交的完整 CI/E2E 和整体验收仍继续实施。

### 35.124 原文读法、唯一生成与本次候选试听界面（2026-10-18）

仍为跑团产品能力研发、S3.4，原 ProductRuntimeSession 拥有意图、唯一执行 Run、候选和本次私有试听。现有实验性 open 主持桌面的音频面板增加“免费本机配音”：选择已确认叙述及原接收范围，显示完整原文，明确选择最多 2000 UTF-16 单位的片段，再核对实际中文前端的归一读法；长原文不静默取前缀，姓名、骰式、编号等读法选择只指向准确完整字符范围，不改写原叙述。必须明确确认原文、读法和范围，才沿原请求预留、唯一子 Run 与登记音频入口生成；没有另建 AI 调用、预算、表、schema、世界读取或 Field/Adoption 通道。

`previewTtrpgOpenVoiceReadingV1` 先重查实际本人原文审阅并验证片段和读法预算，仅向 loopback 同源 `reading-preview` 明确发送一次有界 CPU 请求。桥接复用原离线运行库和既有十秒预检，不加载语音权重；单槽位拒绝重叠，不排队、不重试。非法 UTF-8、BOM、额外指令、超预算、附加权限和替换来源拒绝；连接关闭或服务关闭只取消本次预检，返回仍经两端原文/hash/profile/读法复核。返回前再查原身份与安全状态；失败不能变成可用审阅或语音执行权。原 V2 物理预算保持，桥接实现 hash 随源码更新；原任务恢复与试听继续读取其历史 profile，不升级执行权。

界面从原持久记录提供预留回执恢复、未发送取消、原子任务准备/生成、准确状态查询、停止、原始返回恢复及原候选审阅。停止入口独立于生成等待：准备期间取消本次继续，派发后先调用原持久停止屏障，再结束本地等待，不能把结束等待说成进程已经关闭。普通读取、刷新、核对状态和候选不会触发生成；unknown 保留原任务，取消不返还原额度，导入/祖先只显示历史。所有操作继续由领域层核验，界面的“意图已完成”等小型状态不承担执行授权。

候选试听要求明确绑定准确 candidate hash，重新验证原 raw/input/Manifest、完整接收身份、历史物理合同、实际 WAV 与专属候选检查点。原结果通过时才产生内存 Blob，无 Blob 导入、媒资行、E16 或采用回执；坏结果、被裁剪/损坏/导入/祖先/暂停或身份漂移均不授予播放。准备与挂载之间再次核验原工件及账本，不重复解码 PCM，不在候选 JSON 或数据库另存 base64。当前值由不可复制的本人内存凭据约束，观察原 Run、原工件、事件、检查点、参与行、冻结来源与安全状态；原证据失效即结束本次生命周期，不能重新订阅旧值。

播放默认关闭，须先开启本机音频、明确准备该候选，再手动使用原生播放控件。每次身份只保留一个候选 URL/观察器；静音、关闭、后台、交接、权限/证据失效立即暂停、移除 src、撤销 URL，迟到返回不能在静音后重新开启。实际文件时长必须匹配样本时钟，显示原文、归一读法及真实片段高亮/跳转，不伪造逐字或逐词对齐。普通无害讨论可保留同一试听，不自动播放；刷新清空试听但保留原请求与候选。

定向验证使用真实隔离 IndexedDB/Run/React 控件、loopback HTTP 和明确的合成 PCM，分别覆盖原确认到单次派发、独立停止、读法传输/来源复验、准备到挂载的证据缺口、实际原证据删除、暂停/参与行漂移、迟到结果、静音/后台与手动播放边界。新增原生浏览器用例从正常主持控件运行，核对真正 WAV 解码/播放、刷新原候选和身份交接；在准确源码上实际执行前仅记用例已收集。独立真人听感、真实当前 CPU worker、正式采用/许可与 E16 时间轴版本、原 Run 终验及采用后证据保留、发行安装、完整中英/长文本与当前完整 CI/E2E/P9/P10 联合验收仍需完成，不能以此内部试听界面宣布产品完成。


### 35.125 生成配音的原文片段、准确读法与版本化样本时钟（2026-10-18，采用前置合同）

继续跑团 open、S3.4 产品能力研发。输入仍为本人准确原请求、已确认读法及原 raw/candidate，团局拥有本次时序，世界/发行包只读。没有新增模型调用、AI 可写字段、表、schema 或第二套请求额度。本节先补正式采用所必需的诚实时序；生成媒资采用、独立听感/权利确认、E16 与原执行 Run 终验仍须沿后续明确动作实现，不能用试听或解析成功代替。

`open-voice-timeline-contract` 的 `storyforge.ttrpg-open-generated-voice-timeline` V1 分别保留完整原叙述的准确 hash/UTF-16 长度、本次原文片段的 offset/length/hash、完整归一朗读文字及其 hash，以及真实 `normalized-reading-segments` 样本时钟。原文与读法不互相替换；完整原文仍是未来接受音轨的文字降级来源，所选片段不能冒充整篇。数字归一、姓名读法或中英混读导致长度不同，不得插值成原文逐字/逐词时间。`wordAlignmentProvided:false` 固定；时间位置使用原样本范围，不四舍五入成毫秒后再猜边界。

V1 的原文 16014、原片段 2000、归一读法 4000、每段 200/最多 64 段、44100 Hz、每段 60 秒/整次 900 秒等上限作为历史合同常量，不跟随今天安装配置改变。闭集解析核对文字/样本连续完整覆盖、准确索引、增益、范围、整数上限和 UTF-16 完整字符边界；异步核验再核对完整原文、原片段、归一文字及每个实际片段 hash，与 WAV 声明的样本数/物理字节/准确时长相符。所有输入在首次 await 前固定，调用者不能在 hash 计算期间替换时序或媒资声明。此合同本身不证明物理 PCM、本人权限、试听、许可或采用；这些继续由原物理校验、owner 与后续正式命令负责。

原返回校验复用相同样本时钟校验，但其返回及已留存候选的 JSON 形状/hash 不加字段。独立版本合同只进入本次内存试听；原 char/word 时间轴、人工上传、既有 E16 和 scripted 解析入口不接受新混合格式，旧字节不迁移、不补默认值。后续必须明确扩展 generated 来源及完整事件/回放/分支/备份/播放闭包，不能伪装人工上传票据或把新合同塞进旧 marks。

现有正常主持试听展示完整原已确认叙述，并标出本次配音范围；归一读法另按真实样本片段高亮，播放结束后可以返回末段开头，定位仍不调用 play。原证据撤销、静音、后台与身份交接生命周期不变。本单元的反例包括长原文只选非前缀片段、读法长度变化、源/段/样本 hash 与预算、UTF-16 边界、异步输入替换、结束后定位、旧格式精确兼容，以及正常主持生成/刷新/交接。合成读法与 PCM 的工程结果不代表当前 CPU 语音质量或独立真人验收，后续完整 CI/E2E 和整体验收按实际终态分别留证。


### 35.126 已核对配音的独立来源快照与完整证据保留（2026-10-18，采用前置）

继续跑团 open、S3.4 产品能力研发。先以独立共享基础提交登记 `audioReceipts[].generated.artifactRefs` 的未来正式拥有者路径：团局初始/当前状态、祖先切点、音轨事件和状态检查点；与既有媒资保留根共同防止源 Run 或媒资行删除后误裁剪。路径不存在时不补字段、不改旧 hash；损坏引用使清理事务回滚。当前这项登记只证明元数据保留闭包，不把不完整的回执 fixture 当成有效 E16，也不新增表、schema、默认值或 AI 权限。

原通用文本 Run 归档拒绝配音执行的 completed-parent 谱系，不能让配音假装成旧文本 purpose。新增独立 `storyforge.ttrpg-open-voice-source-evidence` V1，通过明确的 `freeze-this-original-voice-source-evidence` 动作保存准确原意图、父/子契约与真实事件前缀、原候选正文引用、原专属检查点的 V1 hash 描述/恢复载荷，以及全部原始工件引用。必须先从本人当前准确候选完成原物理校验；坏结果、错误候选、缺失专属检查点、过时接收身份、导入/祖先历史和当前安全暂停都不能创建新来源。来源快照不读取新上下文、不发起模型/HTTP、不改变额度、世界、规则或运行状态。

快照复用既有 `source-snapshot` 工件及原 Run，但不占据原候选步骤的唯一正文槽位；相同原候选只记录一个无 step 的来源快照，原候选 JSON/hash 与检查点保留。有界原账本 CAS 解决并发；返回中断后读取已提交的同一快照，不能复制工件、替换前缀或重新生成。重新核对原候选保留证据时，只检查原正文/输入/Manifest/原始返回 hash、原谱系和专属检查点，不重复解码 PCM；试听的准备到观察器间隙仍另外核对完整账本与安全状态。

快照最多 1 MiB，最多 4096 条历史事件及 63 个原工件引用，另加快照自身形成有界平铺保留根；超限拒绝，不裁剪原文或历史。读取仅在具体拥有者已经允许访问后由内部历史读取器使用本项目准确 hash；核对规范 JSON、父子契约/终态/谱系、冻结只读音频入口、原意图及父终验、准确输入、唯一派发/返回和实际 Manifest、候选正文/hash，以及可由事件前缀重放复算的原专属检查点。原文本、原片段和归一读法/样本时序继续各自保留，不把历史物理 ID 重映射成新执行授权，也不依赖旧分支或当前安装描述解释历史。

历史读取明确返回 `archiveOnly:true`、`generationAllowed:false`、`adoptionAllowed:false`、`humanListening:'unproven'`、`physicalAudioRechecked:false`。它核对历史正文 hash 与谱系，不能冒充重新扫描物理 PCM、真实 worker 质量、试听或采用。来源快照写入及只读恢复不导入媒资、不创建 E16、不签发执行终态；后续正式采用仍须独立听感/权利确认、真实文件/受众/采用事务、原运行终验与逐边界恢复。若为生命周期工程验证明确导入未采用的 fixture 文件，该文件只持有证据保留根，不能因此进入音轨或获得播放权。

专项工程反例覆盖同一前缀幂等/并发、实际工件保存后返回丢失、坏候选/缺失检查点、重新计算外层 hash 后仍拒绝坏根/检查点/代际/附加权限，以及源父子 Run 删除与完整项目备份后的同字节历史可读性。正常主持长文片段的原生用例另外保留 UI 生成/解码/刷新/身份交接，再明确验证本节 API 的未采用素材保留、删除和备份；合成 PCM 不计真实模型或独立真人验收。当前精确源码的工程/原生结果按实际终态分别记录，整个产品及生成音轨的正式采用仍未完成。


### 35.127 原音频本人审阅与只读生成任务终验（2026-10-18，P10）

- **产品边界**：跑团 open / 产品能力研发 / S3 运行媒资；owner 为原 ProductRuntimeSession。世界与产品发布只读。沿原输入、Context Manifest、raw、候选和来源快照核验；不新增模型调用、AI 字段写权、表、schema 或运行事件，不改 scripted 或原音频候选的 hash/`adoptionAllowed:false`/`humanListening:unproven`。
- **两件独立的事**：本人可明确声明亲自听过这条原音频、认为音质与读法适合本桌，保存闭合 V1 `storyforge.ttrpg-open-voice-quality-review`。这是本人声明，独立真人听感验收仍为 `unproven`；不包含许可、用途或正式音轨采用。后续 E16 须另行确认权利与用途，不能借生成终态自动加入音轨。
- **真实原证据**：首次审阅必须是当前有效本人、原席位/接收者、待确认的实际候选；先按 §35.126 完整校验实际 PCM 并保留原父子来源快照，再固定候选/音频/全文/归一读法 hash、审阅人、实际只读 runtime 前缀/状态 hash 与声明时间。时间戳显式使用安全整数范围；不套用普通数值的默认上限。初次暂停、错误候选、阻断音频、不同本人均不得新建声明。
- **原任务收尾**：本人声明是独立无 step 的 source-snapshot，避免占用唯一原候选位置。复用 `confirmation.recorded` 的通用复核标记，并绑定准确声明工件；随后完成原步骤、开始原冻结 verifier 的终验，保存真实普通 VerificationReceipt/终验工件，最后观察 `verification.accepted`。保留实际原 Manifest/候选及声明当时真实只读 post-state，`adoptionEventIds=[]`，不使用零模型回执，不制造 `runtime.candidate.adopted`，不把未来 E16 post-state 写入原只读生成合同。
- **中断恢复**：每次动作在首次 await 前固定输入；实际原账本 CAS 有界竞争。声明、通用确认、步骤、终验开始、终验工件或终态已提交但返回丢失时，只沿原事实补齐，不重发模型、不新增同义声明或音轨。已有有效本人声明可以在游戏暂停期间补齐只读生成回执，不能在暂停期间创建新声明；Run 自身的暂停/失败/取消不被自动复活。读接口不代替修复，完成状态须有准确声明、步骤、终验正文、真实事件顺序和原终态 hash。
- **正常界面**：准备准确原候选试听后，用户明确勾选本人试听确认，才可保存声明。保存前结束本机试听、撤销 URL；刷新后核对原候选可读取既有审阅，返回未知不自动再次确认。已有未完成审阅提供明确补齐入口。声音播放、勾选、生成终态和音轨采用分开记录；前端不输出独立真人验收通过。
- **验证范围**：实际隔离 Run/事件与合成 PCM 回归覆盖不写运行/媒资、原候选字节保持、并发确认、各真实提交点丢失返回、暂停恢复、父前缀变化与闭合声明；React/原生浏览器覆盖正常确认和刷新回读。首轮时间戳范围失败日志保留，最终结果以对应冻结源码的检查/浏览器回执为准，未跑完不得写为通过。旧完整 CI、默认 E2E 和远程运行只证明各自 head；新 head 仍须完成风险相称的检查。
- **继续施工**：本单元只关闭原生成合同。后续 V2 E16 必须保存实际已观察的完成事件尾部与终验/声明准确引用，用已有运行/媒资根保留全部正文；原 Run 删除、分支和完整备份后再验证已采用音轨。当前还不能据此宣称生成音轨采用/恢复、独立真人听感、真实模型长局或整产品验收完成。远程 422 主持回读超时与当前本机复跑通过分别保留，慢读根因尚未定论。


### 35.128 正常作者流程的 CI 主持等待边界（2026-10-18，追加证据）

- 已发布 422 的远程预览实际为 143 passed /1 failed /1 skipped，不能计为通过。失败 trace 保留全部六次实际 fixture HTTP 请求；预算交还画面的快照在委托后 120307ms、原 120000ms 等待截止后约239ms 取得，并正在读取新进度。该快照不能证明永久卡死，也不能证明之后的回读必然完成。当前 5bb 同路径本机单独复跑实际通过，107s、无重试/跳过/源码变化，不能覆盖远程失败。
- 作者发布用例原来固定等待120s，而同文件的相邻主持用例在CI明确允许180s。仅把前者对齐为CI180s、本机120s，保持有限等待；未修改产品预算、接口或游戏规则。仍须实际验证三个 completed operation、三条叙述、worldTurn3、六次原调用和刷新后不重发，不删断言或将未知状态当成功。
- 此等待调整与 §35.127 的生成任务审阅分别留证。最终检查由完整关联回归/工程闸门的相同产品源码、明确测试/文档差异，以及实际原生浏览器结果共同证明；远程新运行未结束前继续保留未完成状态，不取消仍在运行的旧任务。


### 35.129 终验原返回与辅助 raw 的身份区分（2026-10-18，提交前反例修正）

实际保存 API 在同一原语音子任务另存的无 step 辅助 raw 可以合法保留，但不能按引用排序抢占真正模型返回。专项反例已复现该问题：终验现在核对原步骤唯一实际 model.requested / model.responded，并引用实际 responded.outputHash；原候选、原始返回和辅助工件均保持原正文，不增加调用或音轨。最终证据须包含这条新增反例及相同源码的工程、正常界面与作者流程验证，先前通过的数量不得相加冒充全部重跑。


### 35.130 原生成完成记录与冻结身份结算（2026-10-18，P10）

- **依赖与 owner**：共享基础先独立提交 `4e367132`，只增加使用冻结逻辑身份的历史结算投影，在线路径沿用同一算法和原身份读取。跑团再接入 S3 运行媒资的实际完成记录；ProductRuntimeSession 仍拥有运行与音频，世界和发布版本只读，不新增表、schema、模型调用或 AI 写权限。
- **闭合交接物**：`storyforge.ttrpg-open-voice-generation-completion` V1 保存准确来源快照、候选、本人声明、终验工件与普通 receipt hash，以及有界规范 JSON 形式的原完成事件尾部。切点是实际 `verification.accepted` 后同事务写入的 `memory.settlement.recorded`，不预测未来事件，不以可变最新尾部定义完成身份，不创建替代 Run 或重新打开原生成任务。
- **同一验收权威**：在线收尾与历史核验调用同一只读生成终验工厂，保留原字段与 hash 语义，仍按唯一实际 model.requested/model.responded 选取 raw，保留辅助工件。离线核验完整来源前缀、真实本人声明、原候选/Manifest/原始返回、确认/步骤/终验顺序、实际工件字节及父子终态记忆结算。原创建时间取自真实创建事件；World/Work code 取自已验证原 Manifest，不能改用备份导入后的身份。
- **保留与权限**：完成引用是来源快照全部准确根加已观察尾部的实际工件根，排序去重并遵守现有 64 项预算；超限拒绝，不裁掉证据。捕获只读且先要求准确本机原任务和当前本人；内部历史读者须已拥有相应保留引用。完整备份后可以核验旧完成事实，归档不授予新执行/本人确认/音轨采用权限，不宣称离线重新验证了 PCM 或重放了审阅时的 runtime post-state；独立真人听感仍为 unproven。
- **验证范围与继续施工**：新增隔离真实 Run/事件和合成 PCM 回归覆盖无副作用重复读取、未审阅/错本人拒绝、坏顺序/截断/伪造结算、重算 hash 的坏终验、双方 Run 删除和完整备份导入；正常浏览器流程在本人声明后另用明确未采用的 fixture 媒资持有准确根，验证相同删除/导入。它们是来源生命周期工程证据，尚非正式生成 E16、真实 CPU 声音质量或真人验收。首轮类型检查发现当前 ES 库不支持 Array.at，改用数组索引，不扩大编译目标；具体最终结果以冻结源码回执为准。后续仍须接通 V2 E16、独立权利声明与准备文件恢复、唯一采用事务、分支/已采用播放、拒绝/暂停恢复、真实供应方和长局/安装验收。


### 35.131 生成配音的使用权、正式音轨与恢复（2026-10-18，P10）

- **边界**：跑团 open / 产品能力研发 / S3 运行媒资；ProductRuntimeSession 拥有原请求、候选、准备文件与正式音轨。WorldRelease、ProductRelease/Build 只读，音频不推进 worldTurn 或规则结算。复用既有上下文源、候选、原生成终验、完整来源、ProductMediaAsset/Blob 和正式 E16 事务；不增加模型调用、AI 写字段、表或 IndexedDB schema，不将完成的生成 Run 改造成采用 Run。
- **显式版本**：新增闭合 AudioRequest/AudioReceipt/ScopedAudio V2，单一分派器按明确版本读取；保留显式 V1 解析、人工上传、char/word 时间轴及 scripted 路径。V2 仅接受生成配音或其保留重播，旧 `voiceTimeline` 必须为 null，真实归一读法/PCM 样本时钟单独保存并严格绑定。未知版本或字段拒绝，不能以旧 upload 来源或伪造逐字时间轴回退。既有 V1 精确停止可停止 V2 原音轨，重播 V2 继续保留原生成来源。
- **独立人类动作**：先保存 §35.127 的本人试听声明及原任务普通终验，再单独填写音轨名称、来源、许可并明确确认有权在原接收范围使用。准备文件和最终“加入本局音轨”是两步；读取、刷新、勾选或准备文件本身不提交 E16。使用权声明是用户声明，不是独立听感或第三方许可认证。当前范围沿用原准确非公开接收者，不自动扩大披露。
- **准备文件与刷新**：同一候选、原本人/接收范围、准确完成来源和元数据选择派生确定性 choice/asset key。使用既有 ProductMediaAsset 原子保存元数据、真实 WAV 和完整准确工件根，不创建额外采用日记、替代 Run 或向已完成原 Run 追加许可。相同选择复用原文件，另一元数据选择可形成另一未采用文件且物理内容寻址复用。刷新后可读取已准备文件；临时许可和勾选失效，须显式重新核对使用权才能取得新的本机确认。媒体行和归档本身不获得首次采用权。
- **首次正式采用**：再次核对原本机唯一父子 Run、本人声明/完成记录、真实 PCM 和实际检查点，拒绝导入/祖先/已删除原任务的首次采用。准确 Run、事件、工件、检查点、原 Run 集合、当前参与者/同意、运行基线和真实媒体强绑定在既有正式事务内重验，模块加载与哈希在事务外完成。元数据或同字节 WAV 不能替换来源，媒体准确根必须等于完整完成来源根，仍受 64 项预算约束。
- **幂等与竞争**：实际 E16 保存来源快照、本人声明、原终验/记忆结算完成尾部、真实时间轴、用户使用权声明和准确媒体版本；不向原生成任务伪造 `runtime.candidate.adopted`，不使用零模型采用回执。同一原候选/接收范围只能有一个首次采用赢家，改名称或许可不能重复加入；失败方已准备文件保留。已提交后返回丢失时，先核验实际既有音轨，再考虑原任务/暂停/试听要求；相同元数据只回读已提交事实，不同选择明确冲突，不能悄悄继承别人的许可选择。
- **播放、角色与生命周期**：完整原文继续作为回退文字，实际朗读片段与归一读法分别展示，高亮/跳转只依据真实样本片段。默认不自动启用本机音频或播放。已采用音轨可在原父子任务删除、父团局删除、分支明确更新 Session Zero、完整备份/导入后回读；新接手席位不自动获得原私域文件，重播不扩大接收者。现有三注册表已登记当前/祖先初始状态、head、E16、检查点和媒资准确根，生命周期继续由现行表注册派生；备份仍用现行 v16，显式 V1 读取拒绝新 V2，不静默降级或丢弃字段。元数据/许可不进入玩家或公共回顾的 AI 上下文。
- **验证与失败保留**：隔离真实 Run/媒体/E16 与合成 PCM 回归覆盖准备不采用、唯一提交、复制票据拒绝、原任务先删除、真实提交后丢失返回、暂停后精确停止/重播、分支/备份、并发选择及提交前 Run/检查点/同意变化。浏览器覆盖正常界面、准备后刷新、重新核对权利、实际 WAV 解码、真实片段读法高亮及已采用媒体生命周期。首轮多片段 fixture 错将 210 字归一读法放进一个片段，超过既定 200 字上限；实际候选被阻断，失败 trace/截图/raw 保留。只修正 fixture 的真实片段/样本范围、逐段 hash 与调用次数，并先运行官方验证器；产品校验和上限不放宽。具体最终结果以对应源码回执为准，不把不同快照或重复测试数量相加。
- **真实声音与继续施工**：新增明确 opt-in 的正常主持界面真实离线中文 CPU 验收，默认 CI 不调用真实模型；实际工作须走共享串行队列及原物理槽位，不复制模型或整份源码。该路径保留真实原回答、原 worker 终态与 WAV，保持本人听感/使用权未确认，供独立真人核对，不能自动勾选来冒充验收。真实运行尚须以实际结果为准；原暂停审阅的明确恢复、耐久拒绝、独立真人听感、真实叙事 provider 的 30+ worldTurn、正常作者/独立玩家、发行/安装/续团、当前完整 CI/default E2E 及 P9/P10 联合验收继续完成。

### 35.132 原配音的审阅恢复与明确拒绝（2026-10-18，P10，施工中）

- **边界与复用**：产品能力研发 / 跑团 open / S3 运行媒资；ProductRuntimeSession 及原生父子 Run 拥有请求和审阅。WorldRelease、ProductRelease/Build 只读。复用原注册来源、CreativeAudioArtifact、准确源快照、既有 Harness confirmation / checkpoint / recovery / failed 事件与表生命周期；不新增表、schema、模型调用、AI 写字段、音轨或替代 Run。原正向 V1 声明、完成/音轨 V2 及 scripted 数据保持原语义。
- **明确恢复审阅**：本人主动选择恢复准确原候选，要求本局有效身份、原本机唯一父子谱系、完整原返回/物理候选、专属检查点和当前有效安全状态。沿当前原 Run 的最新已核验检查点恢复待确认或已有本人声明的待收尾状态，全部停止/仅取回屏障继续存在；必要时先用已有停止控制封住未来推理，不发 HTTP 停止或重新生成，不宣称新观察到后台进程关闭。失败、取消、导入、祖先或证据不全不获得恢复权；恢复本身不代表试听、使用权或采用。
- **耐久拒绝**：本人对准确原音频明确声明不适合本桌，并留原因、原来源、候选/音频/读法 hash、实际只读运行依据与本人席位。使用独立闭合拒绝工件，不能把正向 V1 的 acceptable-to-me 改义。正向接受与负向拒绝竞争时，原账本 CAS 只容许一个审阅决定；拒绝保存后沿原候选记录 reject 并非重试型失败，原始回答、WAV 和源快照保留，不返还预算、不自动重新生成。读取及已保存后返回丢失的明确收尾不制造新试听声明、成功终验或采用权。
- **实际界面**：提供明确的继续原审阅、拒绝本条配音、读取原决定和补齐原拒绝回执；刷新后回读实际决定。安全暂停先恢复游戏的安全状态，不能用审阅按钮绕过；新生成必须仍是独立且有额度的新授权请求。本人声明继续不等于独立真人听感或整产品验收。
- **待验收**：原任务 paused/recovering 的逐边界丢失返回、真实停止屏障保持、失败/取消/导入/换席/检查点缺失反例，接受/拒绝竞争与拒绝后禁止采用/发送，正常界面刷新与原始音频保留。最终以相同源码的定向、构建、原生和完整验证证据为准，当前条目不预报完成。

- **原生恢复证据与边界补充**：已通过一次隔离正常主持界面的原生验证：原文/读法→唯一生成→明确停止原任务→继续原审阅→手动实际 WAV 解码/播放→本人负向声明与原因→原 Run 非重试型失败→刷新读取同一决定；未产生媒资或 E16，原始返回与游戏内时间/实体保持，HTTP 创建/启动/取回/停止均为各自原一次动作。该验证使用合成语音与自动声明，不是实际 CPU 或真人听感验收。实际类型及接口增量检查通过，最终相同源码的兼容、构建和原生矩阵继续收口。
- **不扩大恢复权**：whole Run 已 failed/cancelled/completed 不进入恢复；仅有实际已保存拒绝声明和 reject 确认、但 whole Run 在收尾前暂停时，才恢复同一拒绝的失败收尾。正向已保存声明亦只补同一原终验。技术上 blocked 的原返回不能冒充已经亲耳试听的负向声明。拒绝动作本身不删除原数据，后续仍遵循既有显式删除/备份生命周期；导入和祖先只保留历史，不取得本机恢复、推理或首次采用权。

### 35.133 正常作者入口与开放设计草稿（2026-10-18，S2，开发预览）

- **实际缺口与产品边界**：旧页面的新建入口只建立 legacy/scripted 草稿，开放生产回归由测试 helper 先填完整 Settings；原页面也没有 openAuthoring 编辑入口。本单元接通跑团产品研发的 S2 正常作者输入，owner 为 Work 和既有 ttrpgAuthoringDrafts；世界版本显式选择并只读，规则沿本作品的 RulePack V2 导入/保存，交接仍是现行冻结 Brief/SourcePlan 和独立开始授权。媒资、运行实例、模型执行、三注册表、表及 schema 无新增。
- **明确新建与旧格式**：仅在原 open 预览开关启用时显示新建开放跑团。新草稿采用现行 Settings V2、一个真人与两个 AI 席位、零预写场景/结局和待选开放规则；这些仅是可编辑起点，不代表规则/世界已确认或开始生成。旧作品不因查询参数或新默认值转换格式，旧 Settings/Brief/Release/hash 的原解析与内容保持。
- **完整设计输入**：在战役愿景页导入或编辑既有 openAuthoring 对象；最多 4 MiB UTF-8，沿原闭集 parser 拒绝未知字段、错误版本形状和越界策略。预览候选与原草稿分开，明确应用才进入父草稿；保存继续走 saveTtrpgDraft 的 Work 作用域和 revision。运行预算、AI 开关、阶段上限、局势标题/目标和开局选择可直接编辑；复杂条件、压力、后果、审批绑定及可选上下文策略通过完整设计编辑保留，不裁剪未展示字段。
- **本人确认与来源**：文件中的 authorConfirmed 不能继承为本人的确认；所有导入事实先归未确认，再按准确 factKey 逐条选择。未确认内容可保存草稿，正式 Brief 仍受原完整性与实际冻结世界来源检查。已保存的部分审阅可明确继续，保留原已确认且未变的事实选择。导入的参考字符串、许可或声明不产生新的世界事实、权限、运行授权或模型证据。
- **编辑与失败恢复**：未应用文字/文件注册原 pending-edit barrier，页面保存、切页和编译前统一检查；坏 JSON、预算越界及 stale 保留原草稿和待修改文字。文件按组件存活、当前 Work、操作代际和原草稿字节核对，晚到读取及另一作品不得覆盖；主动放弃才解除该缓冲。应用后刷新从原正式草稿恢复，不建立第二份持久配置。原制作/开始授权及旧冻结记录不被本次编辑覆盖。
- **验证证据**：首轮 8 项领域/真实草稿、5 项 React 编辑边界和类型检查通过；一次实际隔离浏览器从空白作品完成新建、导入/明确应用、保存/刷新、选择冻结世界、导入规则及冻结真实开放 Brief，保持零 Build/Run/模型调用，并核对旧作品格式。该路径使用设计/规则夹具及内置世界，不能替代正常真实模型制作、独立作者或玩家验收；最终兼容/构建/原生矩阵与完整 CI 继续按准确源码留证。
- **继续施工**：本单元提供手工与文件设计路径，完整 S2 的模型辅助起草/修订、正常作者的真实生产/确认/发布、真实叙事 provider 连续 30+worldTurn、独立玩家/听感、发行安装/续团以及 P9/P10 联合验收仍须完成；不得把设计导入或冻结 Brief 当作可玩作品或整体完成。原共享全量验证队列与其冻结根保持，不能为本单元改写、取消或抢先复用。

### 35.134 作者草稿的原编辑版本与冲突恢复（2026-10-19，S2，开发预览）

- **真实问题**：两个实际浏览器窗口分别编辑同一开放或旧格式作品时，dirty 表单保留旧设置，但页面保存使用 liveQuery 已刷新的 revision，绕过领域服务原有 CAS，导致另一窗口的新配置和 Work 名称被覆盖。两种格式均已在隔离数据中复现；首轮失败记录及原始 before/after、截图和 trace 保留，不能把该失败算作通过。
- **原版本与作用域**：表单记录实际载入的 Work scope 和 revision；保存、自动跨页保存及制作前保存继续调用原 saveTtrpgDraft，以此原编辑版本核对，不借用刷新后的版本号。成功保存先接纳真实返回的草稿，再解除 dirty，防止旧订阅行重新填回旧表单。另一窗口正常保存且本窗口未编辑时，仍按原 liveQuery 更新。浏览器后退切换到另一 Work 时，未保存内容不能写入目标作品；冲突尚未处理时禁止新建按钮静默清空它。
- **本人恢复**：冲突时保留本窗口设置和名称，展示下载修改副本及载入最新方案。下载包含原 scope、编辑基线、名称与完整设置，用于人工比对，不冒充注册表派生的完整作品备份或可自动安装的作品包。载入最新方案先检查原 pending-edit barrier，再由本人明确确认替换；取消或读取失败保留当前内容。未应用的设计文字不能被下载或载入操作悄悄略过。载入后可对照副本重新编辑并正常保存，不自动合并两份作者决定。
- **边界与证据**：Work/ttrpgAuthoringDrafts owner、领域事务、旧格式原内容和正式 Brief/SourcePlan/开始授权保持；没有新 AI 调用、读源/写字段、表、schema、世界写回或媒资变更。3 条初步实际浏览器路径通过：两种格式的两窗口冲突、精确保留新旧内容、自动切页拒绝、真实下载、取消/确认载入、人工比对后二次保存，以及后退跨 Work 的格式/作用域保护；其中开放设计原始缓冲仍受既有 barrier。测试使用人工输入且保持零模型调用，不替代独立作者/玩家验收。最终工程/兼容矩阵与全量 CI 按准确源码另记，原共享队列及冻结根不变。
- **后续完整目标**：继续第一方开放规则 V2 的正常选择、S2 模型辅助设计、正常作者真实生产/审查/发布、真实 provider 连续30+worldTurn、独立玩家/听感、分发安装续团与 P9/P10 联合验收。另须继续核对浏览器历史导航对未应用原始编辑缓冲的保护；本单元不将其宣称已覆盖。原方案、决策与所有失败证据保留，整体仍未完成。

### 35.135 原配音完成与续租的竞争（2026-10-19，S3，开发预览）

- **真实证据**：f5400 的正常主持界面实测已真实生成一次1.370秒中文音频，原worker观察到code0终态；最后一次GET仍为running，随后lease请求到达时活动项已移除，服务端409使传输进入未知并请求停止，未读取raw、未显示候选。该次真实UI失败、原任务、WAV/结果、网络trace和取消记录全部保留，不改写为通过。模型生成完成与正常界面完成分别记录。
- **准确完成状态**：原同源lease接口仍要求准确jobKey/input hash；只有原记录已证明成功关闭或已显式核验完整结果且原进程消失，才可在活动项消失后返回已有generated投影。此分支不写租约、不扩展期限、不创建/启动/取消任务，也不改原完成记录；不把不存在的进程续租成功。原结果仍须经过raw的完整来源/hash/WAV/PCM验证和现行候选检查。损坏音频不能靠元数据进入候选。
- **保留控制边界**：停止、过期、失败、未知、未证明generated、错误输入和仍运行的他人任务不得借此复活或释放资源。正在执行的原任务仍沿十秒租约、两秒复验和单调时间规则；原开始、停止屏障、实际终态、额度与独立本人试听/权利/采用保持。无隐藏4xx重发、无额外生成、无新AI入口/读源/写字段/表/schema或世界/媒资owner变化。
- **固定版本与原结果**：维护脚本只重建当前实现pin，V1/V2历史描述、线协议、全部物理预算和共享模型安装保持；旧完整结果继续用原输入中的实现hash验证，旧输入不获当前启动权。已用新实现纯核验该次真实原WAV及结果，通过完整物理验证且原input/result/job/cancel/WAV字节全未修改；这不等于原UI已恢复、本人已听或已采用。真实UI用例在候选未出现时也留原Run/attempt/raw证据，保留原断言和零自动重试。
- **验证与继续**：先确定性复现原成功关闭后的续租失败，再覆盖实际HTTP在GET与lease间关闭、准确原raw、一次start/零cancel、新旧实现输出、损坏PCM、停止/到期/未知及浏览器同一原请求读取。协议夹具明确为注入测试，不冒充真实CPU。最终兼容/构建/原生矩阵按准确源码另记；新正常界面真实CPU复验只在原full CI/default E2E真实终态并确认原driver/wrapper退出后，沿既有串行与物理槽进行一次，不重启或重复原未知请求。整体P1–P10、真实正常作者/叙事provider30+worldTurn、独立真人、发行安装续团与P9/P10联合验收仍未完成。

### 35.136 开放规则的正常选择、重载与第一方内置规则（2026-10-19，P2d，施工中）

- **边界与复用**：跑团产品能力研发 / S2 产品定向。复用 Work 所属 `ttrpgRulePacks`、原作用域/内容 hash/不可变版本校验及 `ttrpgAuthoringDrafts` 的显式保存与 CAS；来源仍是只读冻结 WorldRelease，媒资 owner 不变。本单元没有 AI 调用、候选写回、新读源/字段/表/schema 或第二条制作入口，正式 Brief、确认、开始、SourcePlan 和 Harness 继续沿原链路。
- **已复现问题与修复**：正常界面导入 V2、确认并保存后，真实规则行和配置都保留，但刷新后的向导只列 V1，已选规则从下拉框消失。现在按真实作品作用域与 open/scripted 格式调用原对应列表；旧作品、旧格式的迟到结果不进入新列表，初始查询迟到也不能覆盖刚明确保存的规则。读取失败可见；缺失/不兼容的原 ID 保留为不可用选项，原旧格式选择保留并提示显式改选，读取不悄悄重写 settings 或选择另一作品规则。scripted 的四种内置规则及原 V1 列表保持。
- **第一方规则与原版本**：`StoryForge 开放叙事 2d6` 使用 `storyforge.narrative@3.0.0`，由原 2d6 规则克隆并扩展三个实际机械 check，V2 明确绑定体魄、心智、风度。沿用原资源、行动、骰子、检定内核、机械 fixtures 与 StoryForge 第一方内容许可，不把该内容许可改称 MIT；旧 `2.0.0` 内容、已验证行和存档不升级或覆盖。同版本不同内容沿原不可变门拒绝。
- **可解释的默认能力**：通用检定耗时一轮，只产生原检定结果，没有虚构世界事实、战役危险、奖励或效果计划。具体风险与后果仍须作者冻结局势及合法计划承接。新增受限 d6 是/否问答：均等阈值4、较可能3、较不可能5；阈值格为“是但有条件”、前一格为“否但有转机”。六条固定种子/nonce 例证覆盖四种结果及三种可能性，使用原确定性内核复算，不在运行时生成自己的期望值。问答不耗时、不接管玩家决定、不回改世界/规则/过去、不自行创建新实体；十二种事实策略继续尊重语义、实体、物品与关系各自 owner。
- **正常作者动作**：作品保存后，在“规则与村规”中预览内置规则或导入文件，展开说明核对，再明确“确认并使用这份规则”。预览不写规则行或发起制作；确认只保存本作品规则并选中，仍需保存制作配置和生成审查方案。支持重载、重新选择与完全相同规则的重复确认；已有文件导入路径保留，先前文件的迟到读取不能覆盖后来准备的内置候选。
- **验证与保留**：先用实际隔离浏览器保留原刷新缺选项的失败、原数据库附件、trace与截图；另两次测试编写中的定位/等待错误独立保留。规则内核与库测试覆盖原字节、机械绑定、固定 Oracle 例证、越权、同版本冲突及跨作品隔离；UI 覆盖格式/作用域迟到、读取失败和显式保存。首轮内置规则浏览器用例因未填写必需开场/玩家身份被原 Brief 门拒绝，保留失败并补齐正常用户输入，不放宽正式门。最终测试与工程检查以当前源码回执为准，不累加不同快照成绩。此处完成不表示真实 AI 正常作者生产、独立玩家、30+ worldTurn、发行安装续团、本人配音听感/权利或完整 P1–P10 已验收；原冻结 CI/default E2E 与真实 CPU 修复后复验继续按原串行队列处理。

### 35.137 回放分组闭包与冻结内容缓存的实测修复（2026-10-19，P9/P10，施工中）

- **实际失败与边界**：原 f5400 冻结全量 CI 的 6240 项测试中，6238 通过、2 项失败；随后仍沿原队列继续默认 E2E，不能将该轮记为成功或因首个失败停止其它有效验证。两项分别为音频模块漏入回放构建分组，以及真实十轮压力/威胁击败测试超过原 60000ms。当前分支原测试重新运行，压力等15项通过、分组1项仍失败；压力单例耗时41680ms。此增量为跑团 S3 纯解析/回放与构建修复，保留 RuntimeSession/event owner、冻结世界/产品、协议、注册表和正式授权/效果；没有 AI 调用、数据写回或共享 schema 变动。
- **实际分组闭包**：按现有实际静态依赖扫描定位四个遗漏：完成/样本时间轴合同为叶子，准确音频收据/生成音频合同为 open 依赖层。只补原 `TTRPG_REPLAY_CHUNK_MODULES` 对应项，不改变公共入口、分组层级、禁止读模型/生产器的门或任何共享体积预算；原扫描继续检查所有实际模块，而非仅断言新增文件名。
- **先采样再修复**：相同原压力用例的实际 CPU profile 中，冻结内容快照构建占约19.25秒，其中递归 visit 自耗时17.71秒；单独测试采样32.645秒。这说明本地通过并未消除全量超时风险。保留原整套失败、当前基线、采样配置/日志/完整原 CPU profile，不增加测试时限、并发或隐藏重试。
- **精确快照复用**：仍逐项检查真实自有描述符、JSON 类型、符号/隐藏/访问器、数组连续性、原型、环、深度、节点和字符上限，保留属性顺序及 `-0`。将原相同 key 的 token 只连接一次，命中时不再构造每个节点的拷贝；仅在缓存未命中时，从该次已捕获的精确 key 通过 JSON.parse 重建快照再调用原闭合解析器，绝不重读可能变化的原对象。原世界 hash/玩家版本隔离、V2 专属缓存、8项 LRU、深冻结私有身份快路、作者独立可变副本及独立真实内容 hash 验证保持；外部冻结、声称 hash 或可变对象身份均不能获得跳检权。`__proto__` 为普通自有数据，不能污染原型。
- **定向证据与继续**：原访问器零读取、描述符检查中变化、隐藏/symbol/undefined、负零、不变量 hash、作者副本、外部冻结、淘汰测试保持；补充特殊字符/未配对代理字符/null 原型与原型命名额外字段反例。与原分组门共14项先通过。同一个原压力采样单例变为23.700秒，递归自耗时约7.71秒；这是该次有限采样，不作为跨机器性能保证或全量覆盖率通过。后续按同一源码完成关联回归、类型/构建/体积和隔离真实回放路径；最新完整 CI/default E2E 与正常界面真实 CPU 仍须等原任务真实终态并核实原 driver/wrapper 退出后沿既有串行槽运行。完整 P1–P10、真实正常作者与叙事 provider30+worldTurn、独立玩家/听感/权利、发行安装续团继续按原验收矩阵完成。

### 35.138 正常作者辅助设计的草稿合同与来源基础（2026-10-19，P2d，施工中）

- **实际缺口与施工顺序**：当前 open 正式 Brief 要求已完成局势/开局及本桌策略，既有三战役提案 Harness/UI 只服务 scripted；开放编辑器只有部分字段与高级 JSON 导入，作者仍无法正常请模型起草完整设计。不得靠占位局势、放宽正式 Brief/发布门或把模型 JSON 伪装成人工导入来打通。按“明确请求/冻结来源 → 原 Harness/CreativeArtifact → 三候选比较与分区组合 → 作者确认及原 adopt → 正式 Brief/SourcePlan/开始/生产”补齐；本单元仅交付前置合同和只读来源 API，模型/采纳/界面尚未接入，不把它称为完整辅助设计体验。
- **边界**：跑团产品能力研发 / S2 产品定向；已有 Work/ttrpgAuthoringDrafts 与规则库拥有草稿，世界版本只读，S3 Build/Release/Session/媒资 owner 保持。此基础没有 AI 调用或正式写回、Run/Production/Build 创建、新表/schema或现有数据迁移。内部无界面 API 单独登记为有理由的 headless 源码入口；后续必须先登记 Context/Skill/AI入口及 Field/Adoption 的唯一受治理写回，才能发起模型调用，不把临时合同变成另一套 AI/DB 体系。
- **闭合三方案**：请求显式声明指令及可改分区。输出必须恰好三项稳定 key/名称/方向/patch，只能提供请求中的局势、开局、后果、压力、动态模板和新增事实；不能夹带世界/规则/owner/hash、运行预算、队友/阶段/上下文策略。已有事实及确认状态、未请求分区和策略来自捕获草稿；新增事实另列，不能替换旧 key 或自带确认标记，合成后统一为未确认。按分区选择不同候选后重新走原类型解析/本地开局引用校验；这不是采纳或发布。拒绝完全相同或只换标题的三项，真实语义差异仍须作者评审，不能用结构签名冒充创意质量验收。
- **实际读取与权限**：候选中的世界来源只允许来自实际 Context Manifest 读取集合，不能把 SourcePlan 的允许目录误当已经读取；新增事实保留具体资源/字段/hash，后续沿原来源证明及独立作者事实确认。纯合同不授予字段真实、角色/实体绑定或全 Campaign 闭包；这些继续由源验证和原 S3 编译/发布门承担。回答上限120000字符与现有 CreativeArtifact 边界一致，过长不截断成看似完整的候选。
- **空白设计的只读来源准备**：复用保存过的真实开放设置、validated RulePack V2、已选冻结 WorldReference、明确保存的出口范围及原 TTRPG requirement adapter/SourcePlan。没有局势也可准备设计读取，不要求先伪造正式 Brief；已有开场/玩家身份、本桌策略和规则选择仍需明确。拒绝未保存出口、旧规则、未封存村规、跨作品/过期设置；只读创建独立 S2 来源合同，不创建正式 Production 或调用模型。完整快照深冻结，basis hash 按真实内容生成；SourcePlan 的 createdAt 记录本次实际准备时刻，重新准备可产生新的 plan/basis hash，不把旧草稿更新时间伪称为本次来源计划创建时间；刷新验证比较实际来源、权限、规则与草稿内容。完成准备和后续使用前均重验当前草稿/规则字节、作品类型与真实世界版本。
- **基础验证与后续**：定向合同覆盖预算/身份注入、旧事实保护、新事实未确认、未读资源、三方案闭集、只换标题、分区保留/组合错误及大小/版本；真实隔离 DB 覆盖空白局势、所有表零变动、出口选择、源版本/作用域和检查期间并发变化，并保留正式 Brief 对不完整设计的拒绝。浏览器检验原生存储与刷新后的同一基线/来源/规则，不声称正常模型生产。最终当前源码的工程/浏览器回执另记。本单元之后继续原 durable Run/raw/恢复/候选/明确采纳、S2正常界面与事实评审；P1–P10、真实正常生产、provider30+worldTurn、独立玩家/听感及发行安装续团的完整目标保持。


### 35.139 作者设计的登记来源、原始回答与可恢复候选（2026-10-19，P2d，施工中）

- **交付边界**：继续正常作者辅助设计的原目标，先接入 S2 内部候选 API；尚未提供正常作者三方案界面或正式草稿采纳。当前 Skill/AI 入口明确无写目标、adoptAllowed=false；不能用旧人工 JSON 导入路径代替待实现的 Field/Adoption 写回，也不能把本节视为完整作者功能或 P1–P10 已完成。Work/世界/规则/Production/Build/Release/runtime/媒资 owner 不变。
- **唯一读源与恢复依据**：新增登记的原子读源 `ttrpg.open.authoring-design`，只有显式给出版本时启用，普通上下文装配不会默认读取它；调用者只能给准确保存的 Work scope 与 revision，不能塞入来源正文。完整交付原设置、真实已验证 V2 规则、冻结世界引用及原 SourcePlan；预算不足直接拒绝，不截断结构。快照补充原草稿行/规则行 hash 和明确选择的出口集合。重读历史快照时按其原创建时刻重建验证，不能把今天新建的 planHash 当作旧来源过期的判断；同 revision 行字节被修改也能发现。
- **实际世界读取**：复用 `worldRelease` Context Gateway；原 adapter 权限还须与作者显式选定出口取交集。必读或原设计保留的来源不在交集时先停下，要求作者明确调整出口；不自动扩大目录。保留设计/事实所需来源做必读，来源正文及实际资源 key 留原 Manifest/预检/读取证据；没有额外模型选择调用。静态输出格式说明取自现行类型定义，格式说明不作为真实世界来源或权限。
- **原 Run 与一次发送**：新正式入口冻结 Skill/入口/原草稿及来源/作者请求/完整 messages/模型身份，原 Work-owned agentRuns 保存全部历史，不增加会谈表或复制草稿数据。每次明确请求最多一个模型调用、无自动修复；Run 原生分配 ID 的顺序限制早先未处理或与当前重叠的请求，且发送前原子追加实际 model.requested 事件。恢复入口没有模型配置和发送逻辑，不因刷新或重读候选发第二次请求。已观测的非重试型 4xx（408 除外）为可见失败；未知结果保留暂停和原检查点，不将未知当作未发送。
- **回答先保存与候选**：原始响应完整进入 exact raw artifact 后才解析三份请求分区，CreativeArtifact 记录结构结果、调用/用量与问题；协议错误、已观测的非法 provider 用量或超过冻结输入/输出预算的回答保留为 blocked 候选，不能截成看似可用设计或继续采纳。保存来源 Manifest、候选及原检查点。原回答已保存但后续元数据或候选步骤失败时，只从原回答恢复；缺失原延迟不伪造观测值，明确为未知。候选记录、来源回执和原始回答必须一致；跨 Work、显式 stale 或冲突拒绝。另一窗口后来保存草稿时，旧候选保留原基线、标记只可参考，不悄悄替换成新草稿。
- **证据与后续**：定向验证使用真实本地冻结世界/规则服务、隔离 DB、注入回答或本地 HTTP 夹具；验证原始回答先存、一次发送、协议失败、未知结果、元数据失败恢复、重叠请求和跨作品/过期基线。浏览器与最终工程检查按本次准确源码另留回执，不把模拟 HTTP 当真实叙事 provider。当前候选仍是本地 portable=false 的原证据，不宣称跨安装自动采纳。下一步继续 Field/Adoption 的受治理 settingsJson、原始候选证明/明确确认/原子 CAS/提交后回执与恢复，以及正常三方向比较、分区组合、事实与队友批准绑定审查界面；随后沿原正式 Brief/开始/生产/审查/发布/运行与完整验收继续，不放宽任何正式门。


### 35.140 设计候选的正式采纳、原子状态与终验恢复（2026-10-19，P2d，施工中）

- **边界与顺序**：此增量先交付 S2 采纳领域服务和三注册表治理，作为下一步正常作者三方案界面的串行基础；界面尚未接通，不宣称正常作者体验已经完成。Work/ttrpgAuthoringDrafts 仍是唯一设置 owner，世界只读，正式 Brief/SourcePlan/明确开始/S3 编译发布门保持，未创建 Production/Build 或第二份可编辑草稿。运行后果、媒资和其他产品的 owner 不变。
- **唯一字段与旧权限**：FIELD_REGISTRY 只新增现有 `settingsJson`，AdoptionSchema 为 recordOnly 专属 writePolicy，原人工作者服务通过明确生命周期扩展保留。新生成请求冻结 author-confirmed 写集合及正式入口的 adoptionTargets；此前 writeTargets=[]、adoptAllowed=false 的原 Run 不因 live 注册表变化获得权限。采纳核对原 Run 自己的冻结权限，不能用当前注册表或一个候选 hash 代替授权。
- **真实候选与本人选择**：核对原始 raw、CreativeArtifact 可采用状态、三方案重新解析、实际 Manifest 的资源集合/回答/候选，以及当前草稿/规则行 hash 和冻结世界。仅按本人选择的请求分区合成设置；未请求字段、旧事实及确认状态、预算/队友/阶段/上下文策略保持。新增事实只对明确勾选且属于本次所选方案的 key 置为确认，未勾选保留待确认；所有所选事实先验证真实世界资源 hash/字段路径。该验证证明来源，不代替作者判断自然语言含义，也不授予运行机械或世界改写权。
- **受治理写回**：专属 policy 不接受普通 JSON 直写。只有来源/候选/本人确认通过后，领域服务在实际 IndexedDB 事务内发放私有 payload 对象与同事务能力；adopt 必须匹配准确字段/字节、scope、记录及原 revision，不能伪造或跨事务复用。随后委托原 saveTtrpgDraft，保留当时真实 Work 名称，模型提案标题不能重命名作品。
- **原子证据与恢复**：沿原 Run mutation lock，在事务内重验原草稿/规则行与中立世界身份 CAS；草稿、本人 confirmation/adoption、唯一目标 revision 与原 post-state 检查点一起提交。复用 createAgentRunCheckpointInTransactionV1，不新增表、工件写入器或平行持久层。去掉对已自行保活摘要函数的额外 Dexie.waitFor，避免嵌套等待使事务提前提交；首轮失败保留，后续故障注入须证明所有写入一起回滚。终验失败返回“内容已保存、回执待补”；只按原已提交状态补回执，不能重复保存设置、重新请求模型或覆盖后来的人工作品修改。相同选择幂等，另一组选择不能重用已提交 Run 改写作品。
- **历史、结束与备份**：候选可明确拒绝并结束；未知暂停请求需要本人另行核对确认，运行中的请求不能被误认为已结束，已写入的设计只能补回执。Run/raw/检查点沿原 PROJECT_TABLES 生命周期保存，普通 JSON 不能绕过采纳。完整备份保留待采用候选的原始回答及已采用的真实草稿、规则重映射；本地 portable=false 候选在另一安装中只保留历史参考，导入不自动获得采纳权，不重写原证据 hash/编号。
- **验证与后续**：定向验证覆盖真实保存服务的成功采纳、原设置与 Work 名称保护、泛化 adopt 拒绝、旧权限、不同作品/版本/最后时刻人工作者变化、事务失败回滚、两次/并发确认只写一次、新事实显式确认/待确认/伪造来源、提交后失败与后续人工修改、候选结束及完整备份往返。原生浏览器以本地模拟 HTTP 回答验证真实注册调用器、两页并发、刷新与原回执恢复；这些不等于真实叙事 provider 或正常作者界面/独立用户验收。最终工程及浏览器回执按同一源码另留。下一步接正常三方向比较、分区组合、事实和队友批准绑定界面、冲突/未知结果处理，再继续原真实生产、30+worldTurn、发行安装续团与完整 P1–P10 验收。


### 35.141 正常作者的三方向比较、明确采纳与历史恢复（2026-10-19，P2d，开发预览）

本单元为跑团 open 产品能力研发，位于 S2；入口是已有 `/ttrpg/vision` 战役愿景，仍由 `VITE_ENABLE_TTRPG_OPEN_PREVIEW` 控制。输入为当前 Work 的已保存草稿、开放规则、明确保存的世界出口及本桌边界。输出为同一 durable Run 的原回答与 CreativeArtifact，以及作者明确选择后经原 `adopt()` / `saveTtrpgDraft()` 保存的同一草稿；不是正式开始、Production、Build 或世界修改。世界仍只读，媒资 owner 和生命周期不变。复用 §35.138–140 的 Context/Field/Adoption/PROJECT_TABLES 登记，不加表、schema、平行会谈存储或第二条 AI 写入路径。

`TtrpgOpenDesignAssistant` 从原 Run 历史读取状态，明确请求一次三个方向；支持整套选择与已请求分区混合，显示局势目标、介入、不介入变化、障碍/后果/线索、压力升级、效果与完整条件来源。混合仍由原类型合同检查，不把结构差异当作创作质量。新增事实默认未确认，显示原字段来源，只在本人逐条勾选后记录确认；换供体清除原勾选。未选事实供体、旧事实、规则授权和运行预算不能借模型回答改写。原回答可查看和下载，页面没有把 AI JSON 转手交给人工导入的写入捷径。

发请求前复用已有待编辑协调器并保存当前人工表单，随后重读真实 revision；已选世界出口尚未明确保存时，在创建 Run 和发送前拒绝。采纳前须无未保存人工修改，实际提交仍受 §35.140 原行/世界 CAS、私有同事务凭据与 post-state 回读约束。页面本地组合/要求尚未处理时挡住内部导航与退出；自身明确操作只豁免其同步一次预检，不能让另一次导航借用。候选始终显示原要求；新要求尚未发送时不能确认旧候选。切换 Work 或卸载后丢弃迟到 UI 回调，并只停止本机等待；不声称取消服务端处理。

刷新只读原记录，未知结果没有自动重发或自动采纳。显式恢复仅解析已保存原回答；结束未知等待另需本人确认原服务可能已处理。明确不采用时原 Run 结束，原回答、可读候选和全部证据仍保留。旧只读冻结请求仅供参考，不随当前注册表取得写权。已经提交的设计显示原目标 revision；补回执不再次保存草稿。采纳后的页面从当前数据库重载，不能用历史 receipt 覆盖后来人工修改或另一作品。普通导入导出与作者 JSON 编辑仍分别使用原有入口和确认边界。

工程验证覆盖真实隔离 IndexedDB/Run/React、原待编辑协调器、三方向读取、明确采纳、过时/未保存保护、未知结果独立确认、已提交历史回读，以及正常浏览器控件的单次 HTTP、分区/事实选择、供体确认失效、人工修改、刷新和移动宽度。HTTP 回答与已存来源属于隔离工程夹具，不能作为真实供应方创作质量、正常作者独立验收或完整产品完成。原 P1–P10、真实模型与正常生产/发布/玩家长局、队友批准绑定、配音听感与权利、发行安装续团及原完整 CI/E2E 继续按真实终态验收；不替代或取消已入队的冻结验证。


### 35.142 规则保存与刷新验证的真实完成边界（2026-10-19，P2d，验证修正）

上一版远程开发预览在已选规则保存后立即刷新时，两次均读到空选择。保留该失败及完整原报告；原 trace 证明测试在点击事件返回约 1.8ms 后开始 reload，未等待页面异步保存完成。此证据提示验证的时序竞争，不能直接宣布产品数据丢失或已修复。测试现在先等原页面明确的“制作配置已保存”，再回读实际草稿 canonical `savedRulePackId`、经原解析器恢复的 Settings 选择及同 project/world/Work 的规则记录，然后刷新并保留原选择/规则可用/正式 Brief 全部断言。没有延长超时、增加重试、关闭原用例或修改产品保存、权限、数据与世界边界。本地验证与后续远程新 head 的实际结果分别记录，旧失败不改写成成功。


### 35.143 新建作品列表迟到期间的导航身份（2026-10-19，P2d，实际浏览器反例）

在 §35.142 的浏览器验证中，新建草稿已经提交并导航到带 project/work 的地址，但 liveQuery 作品行还未回读；立即进入规则页时，原 path 只从 row 构造地址，把尚在加载的真实定位丢掉，导致规则导入入口缺失。失败原报告保留，不能把它误报为规则内容或采用失败。现在无 row 时沿用当前明确 URL 的 project/work；没有行不代表可以建立另一作品。等待载入期间配置表单禁用，避免显示的暂时默认值成为输入。实际作品载入后仍用原 scope/revision 与保存校验；不借此证明该作品存在或获得写权。测试刻意扣住真实新 Work 的列表投影，正常保存后立即导航，核对 project/work 完整保留、表单暂禁用，放行读取后从正常规则导入继续，再检查实际保存、刷新和原 Brief。补跑旧 open/scripted 多窗口及浏览器 Back 反例；不覆盖作者数据、不创建第二份草稿或更改旧格式。

加载期间原 production 路由指针同样保留，不能偷偷换成另一次制作；该未核实指针本身不授予访问或写入权限。禁用验证检查真实继承 fieldset 禁用状态的输入框，而非浏览器自动化并不识别的 fieldset enabled 谓词；保留该定位断言失败记录，原实际输入禁用状态不放宽。


### 35.144 显式席位角色预留与队友批准的制作桥接（2026-10-19，P2d，串行合同基础）

本单元继续跑团 open 产品能力研发，输入仍为 Work-owned S2 Settings/本桌边界，世界只读，媒资与运行不变。正常席位只有 seatKey；最终批准关系必须引用实际 characterKey，模型又不能改作者冻结的 companionPolicy。不能通过让模型挑批准者、捏造已存在角色或放宽 Campaign 门解决。先增加明确启用的 `authoringSeatPlan` V1，作为原 open Settings V2 内的可选版本化扩展；不新建表、actor 仓储或权限表，不往旧 Settings/Brief 补默认字段，不解释旧 opaque key 的新含义。原 scripted 与不含扩展的旧 open 继续原协议，旧 JSON、hash 和发布存档保持。

预留计划只保存玩家席位与未来逻辑角色标识、当时控制者的快照；没有实际角色行、车卡数值、模型额度、真人 claim 或运行批准权。所有标识是可随作品备份的逻辑 key，不是数据库行 ID。队友批准仍仅由原 companionPolicy 保存；预留计划不复制第二份 approver 配置。纯 proposal 只提出角色标识，可在作者明确重建时保留原席位的已有 key；它不挑选或授予批准者。正常批准界面仍待下一串行单元接入，不把该内部合同当作用户流程完成。

Settings 草稿只检查版本和闭集，允许作者保存尚待核对的席位修改；新设计来源和正式 Brief 在越界前必须将预留与当前玩家席位、控制者、队友数量及原批准关系逐项对上。计划须覆盖全部玩家，AI 队友只能由明确 human 席位批准；自批、未知/旁观/空缺/AI 批准人和遗漏队友沿原验证器拒绝。角色/控制者改变使原预留待核对，不自动补批准人或偷偷换 actor。Session Zero 仍需核验真实参与者、席位 claim 和本次同意，预留不能替代它。

正式 rule-system 候选解析从原冻结 Brief 取得该计划，对实际角色模板的 seatKey/characterKey/controller 逐个核对；最终 compiler 再独立核对。少角色、换人、交换同类 AI 席位、改控制者或把玩家预留给 NPC 都拒绝。提示词只说明已冻结身份，不承担权限约束。角色数值仍须原作者独立确认；新增预留不设置 attributeMappings.authorConfirmed。原作者设计的分区写回只更换明确请求部分，受治理 settingsJson 采纳必须完整保留来源中该人工计划。

生命周期继续由原 ttrpgAuthoringDrafts/PROJECT_TABLES、Settings codec、原保存/备份/导入/删除和生产 Artifact 链路承担；逻辑角色 key 跨复制保留，物理规则 ID 照旧 remap。测试覆盖旧缺省字节、闭集/版本/重复 key、stale 席位、人类批准反例、原来源与受治理采纳、Work 隔离、备份删除、旧 Brief 不变、实际候选解析和最终编译。原生产旅程增加显式计划案例：故意交换两个 AI 角色的席位，原预算内修复仍错误时可见停止，刷新不多发；本人明确修正实际角色后沿原流程生成 Preview。该模型传输为工程夹具；正常 UI、真实 provider、独立作者/玩家及原完整 P1–P10/发行/配音验收继续，不能把合同或 Preview 视为整体验收。


### 35.145 正常席位批准配置与未保存副本恢复（2026-10-19，P2d，开发预览）

本单元为跑团产品能力研发的 S2 正常作者配置。入口沿既有“主持与席位”页，Work/ttrpgAuthoringDrafts 拥有设置；交接继续沿原保存、冻结 Brief/SourcePlan、明确开始、生产候选和最终编译。只读世界版本、S3 Production/Build/Release/Session、媒资 owner 和三注册表保持原职责，无新增表/schema、模型请求、运行许可或角色数据仓。

作者明确提出预留后，新角色取得独立逻辑 UUID；每名 AI 队友的真人批准席位和队伍公共资源批准分别选择，默认不勾选。数量沿原 companionPolicy 的最少/最多 2–5 边界，低风险预授权及四类重大确认规则原样保留。先核对，再应用到本窗口表单，最后原“保存制作方案”实际成功后生效。数值映射、真实玩家认领、Session Zero 和本次运行同意仍需各自确认。

旧无计划方案默认保持原字节与不透明角色标识。已有批准关系时必须逐席手动对应原标识；即使尚无批准关系，作者也可显式选择沿用已有设计角色。不能按姓名或顺序推断；新预留不会自动改写设计中旧 actor 引用。显式复核已有计划时保留同一席位身份，失效真人批准人须本人移除；移除旧预留或原 AI 批准关系要额外核对。原席位、控制者、原批准策略、作用域或原编辑 revision 变化均阻止旧提案应用；不会借用 liveQuery 的新 revision 覆盖旧表单。

为保存仅存在于 UI 的独特 UUID/选择，窗口内最多保留一份有明确 owner 的易失暂存副本。它不写 localStorage/IndexedDB、不进入模型来源/备份、也不自行保存 Settings。沿原 pending-edit coordinator 保留屏障，SPA 卸载后仍保留副本和屏障；浏览器 Back/跨作品/跨产品后可从原跑团作品库恢复、下载比对或本人明确清除。应用后只有匹配的活动原作品表单可通过屏障，未保存时卸载再回来须本人重新应用同一副本。只有真实更新 revision 且实际保存内容完全匹配才清除暂存副本；失败、stale、其他作品或不同内容不会清除。暂时无效的人工表单只阻止正式操作，不使页面崩溃。关闭/刷新文档前提示保存或下载；不承诺易失副本可跨进程恢复。清除暂存副本的确认明确说明已应用表单仍保留，避免把清除缓冲误作删除已保存作品。

验证覆盖正常新 UUID 的本人选择、保存/刷新、原版本和作用域、旧标识显式对应、未应用/已应用副本的浏览器历史与完整 SPA 卸载恢复。新生产工程路径使用真实 UI 生成的 UUID，再由作者通过原设计编辑器调整旧 actor 引用，原界面冻结 Brief；隔离模型传输仅适配产出 fixture，实际 System 候选、原事实/数值人工审查、最终编译、实体和效果引用均消费相同新标识，冻结 Brief 字节不改。该路径不是实际叙事 provider、真人听感/使用权或整体产品验收。原共享全量/真实 CPU 配音验证保持同一已启动消费者及冻结根，不能由本单元定向验证替代。原完整 P1–P10、正常实际模型生产发布、30+worldTurn、独立玩家、配音和发行验收继续。


### 35.146 新作品保存与路由发布之间的身份交接（2026-10-19，P2d，真实入口反例）

在隔离的真实作者准备中，本机订阅登录和配置已核对，但新建开放作品保存后立即进入规则页时，刚写入的 project/work 地址被旧渲染闭包改回无作品的 `format=open` 地址，规则准备入口随之缺失。此次尚未发送任何模型请求；保留原独立浏览器、History、截图与回执，不以重新建作品或跳过正常入口掩盖。§35.143 只处理新 URL 已到达组件但列表投影迟到，不能覆盖本次 BrowserRouter 的 transition 尚未把新 URL 发布到组件的窗口。

继续 S2 产品研发及原 Work-owned 保存链，临时保留原 createTtrpgDraft 实际成功返回的作品定位，且只在浏览器当前地址仍精确属于该新作品时桥接导航；未加载的行不因定位而获得读写或模型权限。原表单在交接期间保持原输入且禁用再保存，加载后的真实行/原编辑 revision 仍决定后续权限。实际原行载入或明确新建另一作品后结束交接；其他地址、Back 和跨作品不继承定位。同步在途标记阻止同一窗口异步保存开始后的重入，不新增数据源、表、schema、确认状态或开始授权；正式来源、Brief、世界、媒资及旧 scripted owner 保持。

确定性浏览器反例只暂停新查询参数向 React 渲染的发布，原领域保存和浏览器地址更新真实执行，再点击原规则导航；不伪造 URL 或写数据库。在旧实现上 scripted/open 均真实丢失 project，在修正后逐一保留同一 project/work、原标题、加载期禁用及唯一作品，实际开放规则入口可用，模型/Build 数仍为零。继续回归原列表迟到、保存/刷新、两窗冲突、Back、正常作者、批准配置、发布和备份。工程检查与本机真实模型请求分开记录；本节不宣称真实设计已发送、原完整 P1–P10 或产品验收完成。原物理共享完整验证消费者和所有原始资料保持。


### 35.147 空白设计的事实依赖与已知容量预检（2026-10-19，P2d，真实作者起草反例）

正常作者验证已在同一隔离作品中，通过原控件完成第一方规则、角色预留/真人批准与世界出口。先前本机通道的保守 32K 容量在发送前拒绝全文，原零发送请求经正常界面明确结束且保留。随后仅在隔离配置通过原高级设置显式采用已核实模型可容纳的 64K 输入窗口，保留全部世界、规则、四个请求分区与硬门；实际使用本机订阅 GPT-6.1-Sol 发送一次，收到 42,760 字符原始 JSON（输入38,483/output13,028，179,074ms，费用未知）。原回答先存，三方向各两局势全部将 driverBeliefs.factRef 留空，被既有“缺信念来源”门阻止，原草稿未改、Production/Build 为零。此处记录真实一次失败验证，不代表三候选、正式生产或产品验收通过；原 raw、使用量、运行与失败证据保留。

该反例揭示默认空白请求只有局势/开局/后果/压力，未请求事实候选，却没有既有事实或设计引用可支撑局势信念。继续 S2 产品研发，复用既有事实候选/来源验证与作者确认，不放宽局势来源门或给占位 fact key。真正空白设计（factPolicy 与 situationTemplates 均为空）的初始可见选择现在包含“新增世界事实”；作者已编辑要求/勾选后，不因迟到基线覆盖选择。若仍要求空白局势却取消事实分区，界面说明并阻止；API 在完整已保存来源准备后、世界渐进读取/Run/发送前同样拒绝。仅修改压力的请求及已有作者设计/事实沿原路径；已有引用的最终真实性和完整 Campaign 闭包仍由原生产、来源与运行门承担，不能把本预检当作正式事实已存在的证明。

新输出说明明确至少一条非空信念事实引用、事实与已读字段/hash、障碍依赖、证据可选性、发现路径闭包、whyNow、不介入后果及时钟/升级/征兆结构；这些始终由既有解析器和后续引用校验执行。新事实只提出候选，不含 authorConfirmed；组合仍默认 false，只有原逐条勾选与登记 adopt 保存才写确认。原批准关系、策略、数值审查、开始授权与世界只读边界保持。

正式连接的容量预检复用共享客户端的同一纯预算计算，只作完整请求可容纳性断言，不采用其裁剪副本；原始估计与可用容量在错误中分开显示。已知容量不足在建立 Run/事件或发送之前停止，避免把本地拒绝呈为未知已发送；真正已发送或未知请求的保留、暂停、原回答恢复与不得自动重发继续不变。新源/字段/表/schema/运行权限均无增加，旧冻结请求的消息、来源、写权、原 raw 和 blocked 状态不随新提示词改写。当前工程与隔离 HTTP/原生 UI 验证分别记录；后续真实新请求须本人明确结束原 blocked 请求再发起，原一次响应不覆写。完整 P1–P10、真实 S3 制作修订发布、长局、独立玩家、配音和发行验收继续。

### 35.148 S2 实际世界读取的逐资源引用锚点（2026-10-19，施工记录）

- 真实同一 Work 的新 Run3 已一次完成返回，原文/用量/冻结请求保留。模型明确指出：正文已交付，但缺实际资源的 `contentHash`，不能合法构造事实，因此返回三个空 patch；原重复设计守卫阻止采纳，草稿与世界未改。只读审计确认实际20项读取的原资源 hash 均留在 Gateway trace/source refs，却未进入实际 messages；此前工程夹具在请求外查询 descriptor，掩盖了这个交付缺口。
- 产品能力边界：仅跑团 S2 作者设计，复用登记的准确草稿、`worldRelease` Gateway、SourcePlan、原 CreativeArtifact 与 Field/Adoption；不新增读取、表/schema、运行批准、来源权限或平行存储。世界引用和媒资 owner 保持。
- 在原 Gateway 已验证读取上确定性生成本产品的模型视图，逐资源明确 `resourceKey/contentHash/depth/readContent`，保留实际正文的原字符串。原资源 hash 与 release/coordinate/packet/摘要正文 hash 明确区分；full/original 正文须再次匹配原资源 hash，trace 与实际 snapshot 一一闭合，未知或不完整即发送前拒绝。摘要保留实际深度，不能冒充完整字段。原 ContextPacket 和 trace 照常原样留证，实际投递视图 hash/预算进入原装配与精确 request evidence。
- 修正工程正例：事实字段引用只能由发送给模型的实际 messages 得到，不能在模拟响应中额外读 descriptor；独立原 provenance 和原正常采用仍校验真实字段/hash与本人确认，旧冻结请求按原 messages 恢复，不补字段、不再发。无默认采用或虚构 AI 本人确认。
- 验证和交付按本单元实际检查/原生/模型回执分别记录。新请求必须经正常 UI 明确结束旧 blocked Run3 后才可独立发起，不借自动 repair/retry 覆盖原回答。最新全量 CI 的原33086消费者仍独立执行，已见配音 UI 等待失败留证；定向通过不能推定整体、独立真人、听感/权利、30+回合或发行验收。

### 35.149 S2 开放效果格式与新请求输出容量（2026-10-19，施工记录）

- 原同一真实 Work 的 Run4 一次返回已保存，18项世界资源准确锚点已实际交付。原冻结输出16000而实际20045，候选保持 blocked；只读原结构解析还拒绝 `story.clock.advance`。原 open 效果类型却直接包含通用效果的该操作，格式与校验不一致；不能用扩大旧预算、删除原回答字段或开放错误 owner 的操作来采用。
- 本单元为跑团产品能力研发的 S2 作者设计。Work 草稿、登记来源/Gateway、原 CreativeArtifact/Field/Adoption、Run 及 SourcePlan 保持；世界只读、媒资 owner 不变，不新增表/schema/运行权或平行存储。先串行登记同一设计链的16000/24000 Skill与正式入口配置，保持较小配置及原合同预算守卫；通用/scripted 效果与运行保持，open 类型收窄到现行解析器允许的 story 子集，与知识/压力各自 owner 对齐。
- 仅未来明确新请求：包含局势的三方向输出验收上限24000，其余分区保留16000；输入64000、一次模型请求、无自动 repair/retry 继续。实际选择进入原配置覆盖、冻结 contract 与消息，连接容量不足在 Run 前停止。恢复以各自原合同的预算留证，不依据新 live 上限改写旧16K判定或旧 hash。
- 模型格式复用同一开放 story 操作常量与明确收窄类型，使用紧凑 JSON，保持必要结构/真实来源/质量要求，不截断输入或输出。界面区分下一次请求的容量与历史请求本身冻结上限，帮助本人判断调用规模。
- 正反例须覆盖新完整请求20K输出、较小请求超16K、原16K冻结恢复不重发、类型与原 parser 一致、通用/scripted clock/clue仍有效、open同操作仍拒绝及原 pressure/knowledge 正例；完整来源、本人逐条确认/采用、生命周期及原生主路径继续验证。实际新请求需检查/提交后，经原同一隔离作品界面结束旧 blocked Run4，再本人明确发起。原完整P1–P10、物理full33086和新66云端验证继续分别留证，均不得由局部通过替代。

- 同一原回答还虚构 `rules.fail-forward/rules.open-checks`。新冻结 Prompt v2 从已登记准确 RulePack 明确交付合法规则键闭集，并在新候选解析、组合与原采用服务确定性核对本次所选后果分区；旧冻结 Prompt v1 缺省仍保持原 S3 延后验证语义，不补字段或改旧 hash。只读格式化器继续展示原规则内核与开放模板两类输入，其运行逻辑及不明 owner 的保守显示保持。

### 35.150 S2 后果计划两种形式的准确格式说明（2026-10-19，施工记录）

- 前一单元已提交 `dbef3c2b`；33文件408项关联回归、17项其余检查、24条隔离原生浏览器路径通过，4004源码无漂移。这些仍是局部工程证据。随后同一隔离作品的明确新 Run5 实际仅调用1次，输入42773/输出18429，输出未超过新24000上限，18项逐资源来源与规则闭集交付已核对；实际回答仍被原 parser 拒绝。原始回答、使用量、旧候选与冻结权限保留，草稿/世界/Production/Build 未改。
- 本单元仍是跑团产品能力研发的 S2 作者格式说明，不改变作品/世界/媒资 owner、登记来源、三注册表写权、预算、采纳或运行。模型给6个成功模板同时填写非空 `effects` 与单个 `alternatives`；原 parser 要求直接后果或至少两个备选严格二选一，而原 TypeScript 仅展示两个普通数组、没有说明互斥与数量。只读内存对照用于定位遗漏，不是新回答、正式候选或采用依据，原 Run5 始终 blocked。
- 未来明确请求使用冻结 Prompt v3：两个数组字段均保留；直接后果含1–100项 `effects` 且 `alternatives=[]`；玩家选择计划 `effects=[]` 且2–20个备选，各备选含1–100项后果。提示词和同仓格式注释说明原有约束，不改变 parser、自动清理回答、替作者选择或放宽门槛。
- 恢复明确兼容原冻结 v1/v2：v1 的原分期规则验证、v2 的准确规则闭集及各自原始回答/合同/候选 hash 保持，未知版本继续在 Run/发送前停止；新较小16000与完整24000配置的来源/权限保持一致。关联正反例覆盖合法直接/双备选、同时填写/单备选/两者空/备选空、旧v2 blocked候选在live v3下恢复且0额外调用；实际模型验收另行记录，不由格式测试代替。
- 后续 S3 正式输入只读检查还发现：普通 Gateway packet 正文缺逐资源 key/hash 配对，来源事实与实体映射却要求准确字段/hash；发正式制作请求前须补齐产品范围的实际交付证据并保留冻结兼容。该问题尚未在本单元实现。原P1–P10、同一物理全量消费者、配音界面失败与真人试听/使用权等仍分别待收口。

### 35.151 浏览器中断后的原本机请求引用底座（2026-10-19，施工记录）

- 本单元为共享工程底座的串行小提交，服务跑团产品能力研发中 S2 作者设计的失败恢复。Work、原 Run、原回答和 CreativeArtifact/作者采用保持各自 owner；世界只读，媒资与运行权不变，不新增表、AI 来源、正式调用入口或写权。先验证传输元数据，再由跑团原 Harness 接入，不能把钩子存在当作产品恢复已经完成。
- 原同一隔离作品的真实 Run6 仅1次请求，服务已完成，输入42929/输出15617；三个设计通过当前原 parser 的只读结构校验，逐字段引用核对无问题，原冻结消息与原服务请求 hash 精确相符。真实中断后浏览器 Run 仍 running，原 raw 事件为0，未形成候选/采用；原草稿、世界与 Production/Build 未改。服务原答复、使用量、全 journal 和只读诊断另行保留，不重发、不把外部对照伪装为已落账候选。
- 未来选择接入的调用方在原模型 POST 前等待保存准确 UUID/model/请求字节摘要。保存失败或期间取消均0 POST；请求消息/schema 在该等待期间也不能被外部编辑改变。共享客户端只冻结元数据，产品 Harness 仍负责原 Run 内的私有证据与 CAS。
- 单条/列表回执只读提供原请求 hash 与固定算法。绑定读取只做同一 UUID 的 GET，并校验 model/hash/算法/基本格式，失败或未知时不重发、不取消、不直接生成候选。现有同源/回环、凭据隔离、原32项队列、权限、原始答复、订阅未知成本与既有 API 提供商路径保持。
- 旧 Run6 未预存引用的问题继续保留为明确断点；不可仅凭输入相似就自动认领服务记录。底座测试应覆盖精确发送字节、持久化先于发送、失败/取消0 POST、跨服务重启原回执/usage不变、错误/缺失绑定拒绝及普通客户端兼容。后续跑团接入还须验证正式 Run/raw/候选/冻结权限/原采用链及真实恢复，原P1–P10与听感/使用权/独立真人/长局/发行验收仍未完成。

- 同一底座同时补齐传输回执的交接生命周期：选择持久化钩子的准确请求带 `until-owner-ack-v1`，未交接的原回执不按24小时/100项窗口淘汰；最多持有32项，满时阻止新持久请求，不删除旧答复。原 owner 保存准确原文或失败证据后，才可用原 UUID/model/请求 hash/原文 hash 明确交接，活动或错配回执继续保留，unknown 不升级为完成。普通调用的历史语义不变；这是有界私有传输 spool，不是第二套作品或世界数据。

### 35.152 同步主干共享注册表与人工编辑契约（2026-10-19，施工记录）

- 在独立跑团分支正常合入 `origin/main@a45cb1db`（长篇入口收口 PR165），不改主检出或生产 main。主干两条旧设定查询 AI 入口撤下、旧材料只读归属核对和登记字段人工替换保持；跑团作者配置、世界只读、原始答复/候选/冻结权限与媒资 owner 保持。共享回执底座先前已单独提交 `7338dd9e`，消费接入仍待后续。
- 正式入口行严格等于此前跑团分支剔除主干明确退休的2行；原 limited transports 完整保留。合并后机验59 bindings/63 calls（formal37/auxiliary15/evaluation6/experimental1），不回退到主干尚不含跑团扩展的46行，也不恢复已退休入口。全部 Skill 的非验证日期内容与跑团分支逐字一致，仅11个既有运行 Skill 采用主干验证日期，不改旧冻结记录。
- 主干的 `preserveAuthorText` 只用于已登记人工替换字段，不能绕过跑团 settingsJson 的原模型候选与专用采纳事务。原 TTRPG 回归增加该反例；主干人工编辑正例、作用域/快照/撤销、旧问答归属和实验工作流保留路径一并验证。原 schema v12/129表不被较旧主干指标回退，官方生成器从组合树重算指标/AI手册。
- 原文与此前决策继续保留。合并验证不替代真实跑团恢复、S3制作/修订/发布、30+worldTurn、独立真人、配音听感/权利与发行验收，原P1–P10保持。


### 35.153 S2 原本机回执接回原候选链与空闲执行者保护（2026-10-19）

本单元仍是跑团 open 产品能力研发的 S2；Work 拥有原 AgentRun、来源快照、原始回答与 CreativeArtifact，作者确认后才通过既有专用采纳事务写 `ttrpgAuthoringDrafts.settingsJson`。同一冻结 SourcePlan / Gateway、三注册表、模型预算和权限保持；无新表、源、正式入口、世界写回、音轨采用或生产授权。

新 Codex 设计请求在唯一 POST 前等待原 Run 保存私有 `portable:false` 引用：请求 ID、模型、准确 wire hash/算法，以及原请求工件 hash 与逻辑 binding hash。持久化失败或已取消时不发送。恢复由本人明确点击触发，只按同一 ID GET，先核对作品、原冻结 messages/模型/保留策略和发送事件；导入副本、其他 Work 与旧无引用请求不得自动关联本机记录。原始字节及真实用量落回原 Run 后，才交接本机保留副本并进入原解析、候选、检查点与本人采纳链。交接暂不可用时作品已保存的回答仍可核对，本机副本保留且页面显示待核对；刷新不自动请求、修复或推理。恢复缺失延迟记为未知，不以 0ms 冒充测量。

accepted/running 不当作成功；unknown/failed/cancelled 的原终态、错误、用量及部分字节留存，不能因结构正确而成为成功候选。原冻结预算、规则引用、来源 stale 和专用采纳检查继续生效。复用节点作者执行者的 Web Locks 模式，生成、明确恢复和结束未知等待共用跑团作品执行者；活跃页面仍持有执行权时另一页面不能领取或结束。Run store 原逐事件 CAS 不替换、不嵌套其非重入锁。已保存候选的并发一致确认仍由原采纳事务仲裁。

旧实际 Run6 保留外部核对证据，没有伪造发送前引用或自动搬入候选；刷新留下 running 的旧请求，在已核对原记录、本人勾选结束未知等待、且当前页面可证明执行者空闲后可明确结束。本单元的浏览器与回归使用隔离 fixture；原真实请求的字节、用量、SHA、历史失败与 frozen CI 回执均保留。完整实际 S2/S3、长局与全量验收仍继续。

补充核对了“在空数据库还原、project/world/work/run 数字编号恰好与原记录相同”的反例：仅比较本地主键不足以拒绝副本。新准备及候选检查点明确 `portable:false`，复用原导入账本的 `project-import-nonportable-checkpoint` 结束语义；导入 stale/cancel 标记在本机引用核验时阻断，不能 GET 或 ACK 原服务，即使全部数字 ID 相同。原始引用/回答/检查点仍随备份完整保留，不修改旧实际 Run6 的 hash、检查点或权限。该反例已先复现缺口，再以正式导入路径验证；没有另建浏览器身份表或会谈仓储。

### 35.154 用户旁白反馈、开局前试听与个人语速（2026-10-19）

用户已对固定 13.56 秒中文小样反馈“听感可以，但语速略快”，并要求进入游戏前试听、选择语速和音色。这是该小样的听感反馈，不改写任何团局音轨采用、发布或整产品验收状态。

新增开局前与游戏内可回访的“旁白试听与选择”，默认 0.90 倍，提供 0.75–1.25 倍的明确档位，保持音高。偏好只存在当前浏览器的单一版本化播放设置，不进入作品、世界、ProductRelease、runtime reducer、媒资原件或语音生成合同；当前旁白、已审阅候选试听与固定试听共用同一设置，背景/环境/音效仍用各自原播放速度。字幕定位继续读取原音频 currentTime 和真实 sample clock，原 WAV、duration/hash 与读法不重算。选择/保存/刷新均不自动播放或发起合成，身份交接、隐藏、卸载或安全暂停停止试听。

试听素材为固定原创公共例文、原已留证 WAV，按需加载约 1.20 MB，不包含玩家资料和本局文本，不增加模型、权重或 Python 依赖副本；来源、SHA 与第三方标注见 `src/assets/ttrpg/README.md`。已核实当前安装的 Melo 中文模型 `spk2id` 只有 `ZH` 一种基础声线，因此本轮先落实语速与真实试听，音色界面明确当前声线，不把未接入声线列成可用选项。已向用户询问更偏好“不同旁白声线”还是“同声线风格”；多音色为后续待完成项，需按反馈核对免费方案、许可、声音来源与实际效果后接入。

本次同时修正配音 UI 验证 fixture 的旧异步回调：原回调在 await 前复制 props，重挂载后可能把旧 registerStop 和 enabled 写回新 root。用原回调与受控延迟独立复现后，增加 fixture visit/root 核对并在读取完成后取当前 props；不扩长测试等待、不改产品生命周期来迎合 fixture。原全量失败记录保留，定向通过不冒充全量问题已经关闭。

### 35.155 真实不同旁白声线的固定中文准入评测（2026-10-19）

用户明确选择“不同旁白声线，例如沉稳男声、柔和女声”。本单元为跑团产品能力研发，目标是开局前本人试听、选择并用于实际旁白；选择不能只改变试听标签。S3 生产/运行的原已确认叙述、准确接收者、语音候选/本人试听/E16 媒资采用仍由跑团原 owner 管理，世界引用和冻结版本不变。听众个人偏好不授予读取别人的音轨、重新生成、采用或改写原媒资的权限。

先登记独立有限入口 `ttrpg.local-voice.timbre-eval`：只接收 SHA 固定的原公共合成中文 WAV，与 OpenVoice V2 官方预置向量做最多十次离线转换；不接受作者原文、项目路径、任意参考人声或网络推理。复用现有 Melo 的 Python/torch/numpy 环境，不安装完整上游依赖、不复制环境；增加约 131.34 MB 的单份权重、固定原代码、MIT 声明及 hash。原有 Melo 评测和正式产品 V1/V2 profile、历史请求与 hash 均不改写。

代码和模型分别按官方 MIT 版本钉住，最小转换只导入纯 torch 模块，保留原文件及许可；官方可选水印模型不加载，也不移除原素材的水印。公共音频的原始 PCM/hash 保留，采样转换明确采用低通与精确二倍抽取，不做变速、变调、文本裁剪或声线命名推断。候选逐个记录原输入、预置向量、实际调用、PCM/hash/时长与失败日志，执行前后重验；超时或失败保留原物，不自动重试。试听质量与男女/风格称谓须用真实样本另核对，数学不同、非静音和 MIT 标签均不能当作中文听感或无第三方争议的保证。

当前先实施固定准入评测，未把多个声线列为产品可用选项。后续接入须冻结独立的新产品 profile 与真实转换调用预算，或沿原媒资 owner 准备可选择的已核对版本；不能用当前个人播放设置把旧已派发请求静默换引擎，也不能产生仅试听有效、实际旁白无效的选择。`CONTEXT_SOURCES`/`FIELD_REGISTRY`/`PROJECT_TABLES` 本步无新增读写或表；有限入口只产生本机评测证据，不写作品、Run、世界或团局媒资。

实际首轮准入已生成十种候选：十次转换共 32.62 秒墙钟、49.90 秒 CPU，最大 RSS 约 1.86 GB；无网络推理或依赖安装。各声线均保持同一 13.56 秒中文原文，真实 PCM/hash、样本数、时长、能量及逐次调用日志已复核。声学比较显示差异，但音高不能单独证明性别或中文听感；先以候选 A/B 交付较低/较高声线供本人试听，另保留十种完整对比。自包含试听页已在隔离 Chrome 核验原声与十种候选全部解码、0.90 倍默认、保持音高、切换停止与零外部请求。此证据只证明固定样本和可运行的免费候选内核，不代表游戏内多声线已接通、独立真人已接受或产品已完成。

### 35.156 关闭观察页面后，验证原执行权真实释放（2026-10-19）

33776 云端预览实际结果为 167 通过、2 跳过、1 失败；失败的原 ID 恢复用例在两次现场均停留“另一份设计请求仍在本机页面执行或恢复”，尚未进入回执读取/候选解析。原 trace 显示 `page.close()` 返回后约 4ms 就开始下一次恢复点击（实际鼠标动作约在返回后 30ms）；`page.close()` 返回不能作为另一个 renderer 已观察到 Web Locks 释放的证明。保留原失败日志、两次截图、trace、视频与状态，不以本机先前定向通过覆盖。

用例在关闭后先通过浏览器原生只读 `navigator.locks.query()`，等待同一作品执行者实际不再 held，再执行原唯一恢复点击，另记录关闭瞬间的真实持有状态。保留另一活跃页不能领取的反例、同一 ID/准确 hash/raw/用量、一次推理、零新增取消、独立采用及刷新全部断言；不延长超时、不轮询恢复按钮、不重发模型、不释放或绕过产品锁。此为测试前置条件的明确同步；当前产品源码与其忙碌拒绝继续保留，修正后的定向/云端结果仍分别核验。

修正后的本机隔离 Chrome 已执行该文件全部七项用例，零跳过、重试、flaky 或源码漂移；原请求一次推理、零取消、一次交接，候选恢复未改草稿，独立采用后 revision 才由 4 变为 5。本次关闭瞬间观测为已释放，不把本机结果推断为云端时序已复验；原云端失败继续保留，须在新提交重新运行预览检查后再判断。

### 35.157 用户否决当前 A/B 声线，扩大原生中文多声线选型（2026-10-19）

用户对 OpenVoice 预置转换 A/B 的实际反馈为“区别不明显，且听感需要改善”，并要求广泛搜索开源工具及核对商业风险。此反馈明确否决把当前 A/B 当作可用的沉稳男声/柔和女声；原真实样本、调用、许可及验证记录继续保留，§35.155 的技术执行通过不等于听感准入。此前对原 Melo 中文样本“听感可以”的反馈仍仅适用于原样本。后续优先原生中文不同说话人的 TTS，不继续用预置转换差异或音高数值代替人物声线质量。

以下按官方仓库 LICENSE、实际权重模型卡及来源说明分别核对；此处的许可事实以 2026-10-19 核对版本为准，不以开源标签、包装器许可证或社区音色包名称代替权重及声音来源授权。搜索覆盖十余个项目；候选的质量/性能尚未在本机验证，不能把官方演示或基准当作本产品效果。

| 候选及官方来源 | 代码 / 指定权重许可 | 对本产品的判断 |
|---|---|---|
| [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) / [0.6B CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice) | Apache-2.0 / Apache-2.0 | 优先实测。官方列出九种预置，其中 Uncle_Fu 为低沉醇厚男性、Serena 为温柔女性，直接对应需求；先用官方原生中文预置，不导入外部参考人声。原生权重及音频 tokenizer 两个文件合计约 2.49GB，依赖和本机性能另核对。 |
| [Kokoro](https://github.com/hexgrad/kokoro) / [82M v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) | Apache-2.0 / Apache-2.0 | 与 Qwen 比较。该版本有一百位中文说话人，官方说明中文数据由龙猫数据以宽松许可提供；这是发布方的来源声明，未取得独立的授权合同。主权重 327,247,856 字节，选少量官方男女向量试音，不下载整个声线库或旧版混用音色。 |
| [Chatterbox](https://github.com/resemble-ai/chatterbox) / [官方模型](https://huggingface.co/ResembleAI/chatterbox)及普通话专版 | MIT / MIT | 保留为 MIT 候选，官方支持中文并提供多语种/普通话版本。不同声音的参考音频路径必须另核声音来源授权，不能用代码/权重 MIT 声称随机参考人声可商用；保留其原水印。先核对最小选定文件，仓库 usedStorage 不是安装量。 |
| [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) / [官方权重](https://huggingface.co/lj1995/GPT-SoVITS) | MIT / 模型卡 MIT | 保留为 MIT 候选。零/少样本路线依赖参考声音，不能直接采用来历不明的角色、演员或社区音色包；依赖、具体版本权重与参考素材须分别准入。 |
| [VoxCPM2](https://github.com/OpenBMB/VoxCPM) / [官方权重](https://huggingface.co/openbmb/VoxCPM2) | Apache-2.0 / Apache-2.0 | 可从文字描述设计新声音而不提供参考人声，适合作为更自然声线的后续候选；2B 参数，Mac 支持、资源占用和稳定性待实测，关闭其默认坏例自动重试，不照抄 CUDA 的性能到本机。 |
| [MOSS-TTS / VoiceGenerator](https://github.com/OpenMOSS/MOSS-TTS)及[MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS-Nano) | 官方代码与已核对模型卡 Apache-2.0 | 分别提供描述式声音设计和小型 CPU 路线，列入第二批；不能把大模型声音设计和 Nano 当成同一能力，具体声音来源、依赖及选定权重再核对。 |
| [CosyVoice](https://github.com/QwenAudio/CosyVoice) / [300M-SFT](https://huggingface.co/FunAudioLLM/CosyVoice-300M-SFT) | Apache-2.0 / Apache-2.0 | 原生语音备选。固定声线与新版本参考声音流程分别核对，不能默认仓库全部附带素材均有产品发行所需权利；本机完整依赖和时延待测。 |
| [F5-TTS 官方权重](https://huggingface.co/SWivid/F5-TTS)、[Spark-TTS-0.5B](https://huggingface.co/SparkAudio/Spark-TTS-0.5B)、[ChatTTS](https://huggingface.co/2Noise/ChatTTS)、[Fish S1-mini](https://huggingface.co/fishaudio/s1-mini) | 所列权重分别 CC-BY-NC-4.0 / CC-BY-NC-SA-4.0 / CC-BY-NC-4.0 / CC-BY-NC-SA-4.0 | 排除这些有非商用限制的官方权重作为本产品免费商用依赖；F5 代码 MIT 不改变其权重限制。此决定不泛化到所有第三方模型或 Fish 的其他版本。 |
| [Fish S2-Pro](https://huggingface.co/fishaudio/s2-pro)及[当前代码许可](https://github.com/fishaudio/fish-speech/blob/main/LICENSE) | 指定权重 Fish Audio Research License；当前代码是另有门槛的 Community License | 不作直接准入。已发现代码和权重分别适用不同许可，当前代码还有营业额/托管服务等条款；不能称为通用 Apache/MIT 免费商用。 |
| [IndexTTS](https://github.com/index-tts/index-tts/blob/main/LICENSE)、[VibeVoice-Realtime](https://huggingface.co/microsoft/VibeVoice-Realtime-0.5B) | 前者为定制模型使用协议；后者 MIT 标签与模型卡研究用途表述并存 | 暂不直接集成，需逐版本明确条款及用途。不能把定制协议等同于禁止所有商用，也不能把 MIT 标签当作其他用途表述已经消失。 |
| [Piper](https://github.com/OHF-Voice/piper1-gpl)与[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | 当前 Piper 代码 GPL-3.0、声线另有许可；sherpa-onnx 代码 Apache-2.0 | 运行工具不等于新的声线或权重授权。Piper 不作为本轮直接打包的 MIT 方案；sherpa 可用于已核对模型的轻量运行评估，仍须追溯原权重。 |

下一步先核对 Qwen CustomVoice 与 Kokoro v1.1-zh 的最小代码/依赖和精确文件清单，串行生成同一公共原创中文段落的真实男女声对比，再依据中文清晰度、声线区分、长句韵律、开头结尾完整度和本机时延选择。只下载当前验证必需的一份权重，不批量安装全部候选或复制现有环境；不同候选的隔离依赖不能覆盖现有 Melo 已验证环境。MIT 与 Apache-2.0 均需保留适用许可/声明，声音素材和人格授权独立核对，不承诺绝对没有第三方争议。正式接入继续沿原文本、读法、接收者、Run、候选与媒资 owner，不改世界、旧音轨或旧请求合同。


### 35.158 原生中文四说话人真实试音与准确权重兼容（2026-10-19）

本单元是跑团 P10 语音能力研发中的公开固定台词评测，不是作者 S2 定向、S3 作品生产或运行媒资采用。入口只读原公开中文段落、固定官方模型和原生说话人向量；交付四个真实 PCM、调用/资产证据与独立离线试听页。有限 AI 入口 `ttrpg.local-voice.native-fixture-eval` 不读 `CONTEXT_SOURCES` 的作者数据，不写 `FIELD_REGISTRY` / Adoption 或 `PROJECT_TABLES`，不创建正式 Run/候选/媒资。后续正式接入仍须由新版本 product profile 冻结准确所选声线，沿原读法、本人接收者、唯一子 Run、候选试听与 E16；本机试听页选择不能冒充游戏已生效。

采用 [Kokoro 官方中文 v1.1](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) `01e7505bd6a7a2ac4975463114c3a7650a9f7218`，仅一份主权重与四个官方原生向量 `zm_010 / zf_001 / zm_011 / zf_017`，全部必要模型文件共 329,353,685 字节。代码 Kokoro `dfb907a02bba8152ca444717ca5d78747ccb4bec`、Misaki `fba1236595f2d2bf21d414ba6e57d25256afada3` 均为 Apache-2.0，保留原源码、导数、许可与上游 StyleTTS2 MIT 声明；官方权重卡为 Apache-2.0。中文训练来源为发布方的龙猫数据授权声明，未独立取得其底层合同，不把这些证据扩张为绝无第三方争议的保证。

复用原 Melo 的现有 Python/Torch 与准确包版本；只在候选私有目录读取两个额外 MIT wheel（loguru、addict），未安装进原环境，未创建第二份 Python/Torch。完整 KPipeline/英文语言栈、未用 attr 导入与 `pypinyin_dict.large_pinyin` 不加载。额外审查发现 [phrase-pinyin-data 官方说明](https://github.com/mozillazg/phrase-pinyin-data) 中 large_pinyin 混合汉典、CC-CEDICT 等来源，因此不以顶层 MIT 包标签概括其全部底层数据权利；已下载的小词典包仅留为未执行审查材料，不解包或导入。固定公开台词使用已核对的原 pypinyin 与中文音素前端，不宣称任意人名、多音字、数字/中英混读已解决。

下载单次超时保留原 102,707,208 字节前缀和失败回执；在原准备进程确已结束后，以有界 Range 续传，核对每个 Content-Range、前缀/分段哈希与完整原权重 SHA-256，不再下载一套模型。首次本机评测在严格加载阶段发现最新版源码为 ONNX 导出新增 affine InstanceNorm 参数，原权重没有这些参数；该次实际语音推理为零，失败原日志与完整源码身份保留。已将导数准确恢复为与原权重对应的非 affine eager 结构，仍要求全部组件/权重完整 `strict=True`，不通过接受缺失权重、随机补参或不安全 pickle 绕过。

显式新评测 `run-93f73306-6099-40d0-bd7c-e639290061c3` 在 CPU 两线程、禁网络/子进程下实际完成四次原生语音推理，完整台词不截断、未知音素不丢弃、无外部人物参考录音。统一模型语速 0.9，24 kHz 单声道 PCM；四段分别 18.600 / 18.425 / 18.200 / 19.700 秒，整次 24.13 秒、峰值 RSS 3,873,554,432 字节。逐次请求/返回、原文/音素覆盖、实际 PCM 能量/时长/文件哈希和末次资产/源码核验均通过；这不是 ASR、逐字对齐、语义听感或其他设备性能证明。原 Melo 长段落音频 SHA-256 未变化。

四段新候选已独立交付试听；听感仍待用户反馈，不能把技术执行通过写成已达到“沉稳男声、柔和女声”。原生四声线入口另受原共享物理 `.eval.lock` 与候选锁约束，保留已有/未知任务；四次调用、CPU 两线程、240 秒整次/60 秒单段上限，保留失败/部分结果，不自动重试、播放或采用。静态/协议回归覆盖不可升级为正式入口、任意/参考人声输入拒绝、损坏/静音/错采样 WAV、物理槽位占用及启动失败只释放自身 claim。完整 CI、实际游戏内所选声线一致性、独立真人与发行准入仍待后续验证。

另已核对 Qwen 官方源码 `022e286b98fbec7e1e916cb940cdf532cd9f488e`：0.6B CustomVoice 显式清空 instruct，故只评估原生预置说话人，不承诺指令式情绪/音色控制。其官方依赖要求 Transformers 4.57.3，与现有 5.20.1 不同，不覆盖原环境安装。新增 [MLX Audio](https://github.com/Blaizzy/mlx-audio) 作为 Apple Silicon 运行备选：运行器为 MIT，[社区转换的 Qwen 8bit](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit) 标注 Apache-2.0；它不是新的声线授权，仍须核对准确源权重、转换代码、所有必要文件与最小依赖，尚未下载/推理或准入产品。


### 35.159 玩家身份回归按真实角色控件等待，不误选旁白语速（2026-10-19）

旧 `33776b0d` 云端完整 CI 已实际结束：6488 项通过、1 项失败（1035 文件通过、1 文件失败），失败为 `R-TTRPGOPEN3-player-table-ui.test.tsx` 在确认身份前对缺失按钮调用 click；原运行与失败日志保留，不再标为进行中。当前 `e170615f` 的同一文件定向复现同样为 3 通过/1 失败，不能将先前其他用例通过扩张为整套 CI 通过。

根因是新增公共旁白试听后，旧测试按首个 select 等待、再给它写入 viewerKey，实际命中旁白语速；该控件可先于异步角色读取出现。测试现按 `select[aria-label="我的角色"]` 定位原角色控件，同文件的恢复与交接检查同步收口。身份用例以受控 Promise 暂缓首次真实表读取，明确核对公共语速已出现、角色与身份确认入口尚未出现、双方秘密未显示，再释放原读取、选择本人角色并检查确认按钮启用。原本人秘密/他人秘密、交接后清空私密状态、显示冲突有界重读与权限拒绝断言全部保留；没有延长等待、放宽产品身份保护或增加模型调用。修正后的同一文件四项定向检查通过，当前提交完整 CI/原生及产品验收仍须独立重验。


### 35.160 Qwen 原生预置的有界评测准入（施工中，2026-10-19）

继续 P10 语音产品能力研发，在原有限 `ttrpg.local-voice.native-fixture-eval` 增加闭合 `--engine kokoro|qwen`，默认原 Kokoro profile/worker 不变。Qwen 固定同一公开原创中文与 Uncle_Fu / Serena 两个原生说话人；不接收作者文本、参考人声、模型路径或自定义指令，不新增正式 AI 绑定、Context/Field/表或产品媒资 owner。预游戏声线与正式生成的版本化接入仍是后续单元，不把评测 CLI 当作产品入口。

已核对准确 MLX Audio 代码 `1865f49c`（MIT）和社区 Qwen CustomVoice 8bit 模型 `049ef77f`（Apache-2.0 模型卡），完整必要模型文件 1,973,575,388 字节。该社区模型声明由 MLX Audio 0.3.0 转换自官方 Qwen，但未给出原权重 commit attestation，保留此证据限度。音频 tokenizer 文件 SHA 与已核对官方权重完全一致，可从对应官方精确 pin 取得同字节文件，逐次真实下载来源另留证。私有两个 MLX/Metal wheel 不写入原 Python/Torch；MIT 运行库、Apple lm、Kyutai Mimi 源码及 Apache-2.0 metal_cpp/Qwen 声明分别保留，不概括为全链 MIT。Mac Metal 设备探测已通过，未调用神经模型，不能据此声称 Qwen 性能或音质已验证。

准确导数移除会连带导入无关 codec 的两个 initializer；显式按原索引/量化描述完整严格加载主模型与所用 decoder，不调用原会吞掉加载错误并使用 strict=False 的 post-load hook，不实例化参考 encoder。文本 tokenizer 仅本地读取、禁止远程代码、固定中文 encode/decode 往返一致；原生生成必须在 512 个 codec token 内实际观察 EOS，不能把上限耗尽当成功。整次 300 秒、两次完整语音生成、每段 60 秒、Metal 6 GiB 分配目标与实际峰值准入阈值（不是操作系统硬上限，修正见 §35.161）、共用原物理槽位，原失败/部分证据保留，不自动重试、播放或采用。0.6B instruct 明确禁用，试听速度是独立播放偏好，不伪装为新的音色。

静态与协议回归已覆盖默认旧路径、Qwen 准确两预置、同一公开台词、未知/路径式/重复引擎与任意/参考人声输入拒绝、两引擎对原物理槽位的共同互斥，以及原 WAV 校验。当前权重仍在有界准备，真实生成、浏览器试听、独立真人反馈与完整产品接入尚未证明；原 Kokoro 真实四声线与 OpenVoice A/B 否定反馈继续分别保留。


### 35.161 Qwen 实际峰值反例、低峰值分块解码与双原生声线实测（2026-10-19）

§35.160 的首轮真实公开台词评测 `run-c749c8f4-65b3-4d3d-a7dc-9825a7002d9e` 生成了完整男声/女声，原进程将 PCM/调用检查记为通过。但随后资源复核发现实际 Metal 累计峰值 7,296,809,999 字节，大于描述中的 6 GiB（6,442,450,944 字节）；[MLX 准确 API 文档](https://ml-explore.github.io/mlx/build/html/python/_autosummary/mlx.core.set_memory_limit.html) 明确分配设置只是一项指导。此反例保留原所有数据与通过回执，另记资源准入失败，不能借原状态声称 6 GiB 已被执行。历史 profile 独立保留为 `qwen-native-eval-profile-v1.json`，原公开试听和失败记录不重写为当前成功。

当前评测 profile V2 不扩大原阈值：保留 6 GiB 分配目标与实测累计峰值准入，准确解码导数将 300-token 分块改为 100-token（沿上游 streaming_decode 默认规模），保留原 25-token 左上下文，逐块立即求值并释放无用缓存。主模型/codec 加载后、每个自回归步和解码块、每条音频及整次结尾都读取未重置的真实峰值，超阈值立即拒绝继续或接受结果；Node 接收端单独拒绝旧式/缺失、非整数或超限回执。此机制不冒充 OS 硬限额，单个原生操作期间的瞬时分配仍由系统管理；本产品只接受最终已观测峰值达标的评测。正反例显式包含首轮实际 7,296,809,999 字节值，不能让 `status=passed` 绕过资源拒绝。

显式新评测 `run-b2030b30-881d-48c5-a6bc-3e7ca1619fc5` 使用同一份原模型、原公开文本和两个官方预置，不下载或复制第二套权重，不改共享 Python/Torch。两次真实 Metal 生成、575 次资源观测完成：Uncle_Fu 为 318 个 codec token、25.360 秒 PCM；Serena 为 239 个、19.040 秒，均真正观察 EOS。整次 28.02 秒，进程 RSS 峰值 2,929,377,280 字节，Metal 累计峰值 5,631,002,983 字节，低于原 6 GiB 准入阈值。严格原文 token 往返、索引/量化/完整 decoder 权重、真实 PCM/哈希/样本长度及最终资产/源码核验通过；没有丢弃台词、截短结果、伪造逐字对齐或通过升降调制造新声线。不同分块不承诺与历史 PCM 逐字节相同，韵律和边界听感另验收。

新两段 WAV 与自包含离线试听页已经交付，浏览器核对原生解码/播放、0.90 默认倍速和 0.80 调整保持音高、切换暂停、明确暂停及零外部请求。它们仍是未取得真人听感准入的候选，不替换旧音轨、不把试听页选项写入游戏，不升级原请求或发行。原 Kokoro 四候选与被否决的 OpenVoice A/B 继续保留；未来正式所选声线须进入原版本化 profile/唯一子 Run、原文/读法/接收者、候选/独立采用/E16 owner。整个 P1–P10、真实 S3 生产/发布、长局/独立真人/使用权及发行联合验收仍未完成。


### 35.162 合法零号音频码与完整 PCM 时序核对（2026-10-19）

复核 §35.161 实际 V2 返回时，发现 Uncle_Fu 的 318 个 codec token 仅有 608640 PCM 样本，Serena 的 239 个仅有 456960，均比完整 1920 样本/码少一个码。V2 仅证明当时截短 PCM 的格式、资源和自身哈希自洽，不能继续作为完整音频帧覆盖证据；原资源通过、源码、WAV 和试听历史均保留，另记完整时序失败。[准确官方 Qwen 12Hz decoder](https://github.com/QwenLM/Qwen3-TTS/blob/022e286b98fbec7e1e916cb940cdf532cd9f488e/qwen_tts/core/tokenizer_12hz/modeling_qwen3_tts_tokenizer_v2.py#L1012) 使用 `>-1` 计有效帧、`-1` 作 padding；MLX 移植的 `>0` 将合法 0 码排除，造成末尾少 80ms。原 §35.161 的完整时序判断据此修正，不以文件格式通过掩盖上游错误。

V3 保留 V2 的 100-token eager 解码、25-token 左上下文、6 GiB 实际峰值准入和原世界/产品/媒资 owner，仅修正为官方 padding 语义，并把有效长度 mask 转为 signed int32，避免原生 uint32 与负一比较溢出。首次直接套用 `>-1` 的新评测在一条已请求调用的解码阶段发生明确 dtype 错误，原调用/异常/源码保留，无音频被接纳；已用无模型微型张量反例核对 unsigned 零码保留、signed 负 padding 排除，再明确开始新固定试音。worker 与 Node 独立要求实际 PCM 样本数等于单条无 padding 的 `codecTokens × 1920`，EOS 必须为真；回归含实际旧 318/608640 反例，不接受仅改元数据、伪造 EOS 或补静音。

新实际评测 `run-f73e40a7-8f25-4c8e-9884-231ffc1fd91a` 完成同一原中文、两原生声线的两次生成：Uncle_Fu 318 个码 / 610560 样本 / 25.440 秒，Serena 239 个码 / 458880 样本 / 19.120 秒，均真实 EOS。整次 40.08 秒，575 次资源观测、实际 Metal 峰值 5,631,002,983 字节，维持原 6 GiB 准入，不重置峰值、放宽预算或另下模型。末次严格索引/decoder、完整原文 token 往返、PCM/文件哈希、真实样本计时、源码和资产核验通过；这些不是语义 ASR、逐字时间轴或真人听感证明。

新完整样本已另存独立 WAV 与离线试听页，旧 V1/V2、失败和决策不覆盖。用户已明确反馈“更倾向 Qwen 这组”，据此确定 Uncle_Fu / Serena 为主要接入方向，停止扩大声线比较；此反馈是组别偏好，不代替单条正式音轨试听、使用权确认、独立采用或产品终验。下一单元沿原受治理生成与媒资链落实开局试听、声线和语速选择，准确声线只在明确创建新执行时冻结，历史请求和音轨保留原合同。原完整 P1–P10、当前 CI/实际作者生产、长局及独立真人联合验收继续完成。


### 35.163 开局 Qwen 双声线试听与浏览器偏好（2026-10-19）

本单元属于 P10 跑团产品能力研发，位于 S3 团局进入前和桌面的个人试听表现层。复用既有 `TtrpgNarrationListeningSettings` 与本机播放偏好；公开原文/WAV 属应用固定示例，不读世界、作品、身份或团局秘密，不新增 Context/Field/表或模型入口，不创建 Run、候选、采用或 E16。实际团局媒资仍由原 ProductRuntimeSession 拥有，旧 Melo 样本、音轨、请求与原版本合同保留。

用户组别偏好已落实为原生 Uncle_Fu / Serena 两个真实样本，标签为沉稳男声、柔和女声，不通过升降调模拟。打包的是 §35.162 完整时序核对后的原 WAV（约 2.14 MB），不含模型或 Python 运行库；准确模型/来源/音频哈希与适用许可保留在素材目录。默认 0.90 倍保持音高、可选 0.75–1.25 倍。声线和速度分别保存，旧仅保存速度的浏览器设置仍可读取；未知声线不能变成任意 URL 或人声输入，写入失败可见且不假称保存成功。

明确切换或跨标签收到不同声线时先停止旧 audio，再创建新的未播放元素；刷新、保存、隐藏、安全暂停和卸载均不自动播放或合成。速率调整不暂停当前试听，新音源仍使用保存的速率。此界面当前明确称“试听声线”：正式合成仍使用旧产品 profile，下一单元须沿原唯一子 Run 冻结所选 Qwen 说话人，并贯通真实生成/候选/独立试听与采用；不能凭这里的试听选择宣称正式生成已换声。

本机相关回归和隔离真实 Chrome 路径已核对两段准确 WAV 哈希、25.440/19.120 秒解码播放、0.8 倍保持音高、切换停止、刷新/跨标签保存且不自动播放。该路径未产生推理 POST，团局前后字节相同；这是固定示例/交互验证，不是新的真人音轨验收或正式 Qwen 运行验收。当前源码的最终闸门与完整 CI 分别记录，不把历史云端结果移作当前证明。


### 35.164 所选 Qwen 声线进入原受治理配音链（施工中，2026-10-19）

继续 P10 产品能力研发：S3 运行时配音只读已确认的原叙述与读法，ProductRuntimeSession 保留 Run、候选、媒资和 E16 owner，世界不回写。不新增 Context/Field/表/schema 或正式 AI 入口；复用 `ttrpg.open.local-voice` / `ttrpgOpenVoiceText`、原完成意图的唯一子 Run、完整原始响应、CreativeAudioArtifact、本人试听/质量审阅与独立采用。预置公开试听不授予这些权限，玩家修改收听偏好也不获得主持者的生成权。

新任务在明确点击生成前同步捕获当前浏览器的 Uncle_Fu / Serena 选择；另保留 `melo.zh` 基础中文旁白选项，旧 API 未指定声线时保持 Melo。只读检查所选本机执行器可用性后才预留新意图，不可用时不消耗团局的配音预留额度；检查后预留发生失败/未知时仍按原记录核对，不宣称未预留。用户在异步检查/预留期间改变偏好不改变已经点击的选择。新执行把准确所选 profile/hash 放入原 source-snapshot/runtimeBinding；已有子 Run 从原准确工件重验来源、读法与声线，不从新偏好或当前 pin 重建。若刚创建子 Run 就丢失返回、正文尚未写入，只允许当前闭合 profile 完整输入恰好匹配原 contract hash 的唯一版本补齐记账，不能借此升级旧任务。候选显示自己的原声线，避免后续偏好被误读为当前音轨。

Qwen 使用独立 product profile V3（各自 `qwen-mlx-uncle_fu-product-v1` / `qwen-mlx-serena-product-v1`）、原执行输入 V1、原始结果 V2 和明确的生成时间轴 V2 / 24 kHz；Melo 原 profile V1/V2 文件、结果 V1、时间轴 V1 / 44.1 kHz 保持原语义。通用媒资/E16 只读取这两个明确嵌套版本，不把 V1 采样率放宽为任意值。旧实现可按原 hash 查询/停止/取回结果和读取音轨，但当前执行器不能因读取就获得旧任务重发权。

本机 worker 仍只有原 durable 启动入口；按闭合 engine 选择严格 Qwen loader，不借固定台词评测入口读取作者文字。复用已核对的同一份模型/私有 MLX 覆盖层和原 Python，不下载第二套权重或新建环境。原评测 owner 文件保留，明确资产核验另留仅资产用途的 product admission（零模型调用、使用权/真人听感未证），不能把原试音许可或组别偏好当正式采用。准确代码/权重/许可仍按 §35.160–§35.162，社区转换来源说明不扩大为独立权利保证；当前 MLX 实测为本机 Mac 路径，其他平台与发行安装另验。

原 shared 物理槽位与 Qwen candidate 槽位同时互斥，安装锁/未知原任务保留；不可用引擎在创建物理 job 前拒绝。永久启动 claim、真实 PID/终态、授权租约、明确停止、迟到与原始结果恢复沿原链保留，仅归还自己已核实的 claim。worker 复算完整确认读法，Qwen 每段最多 100 个 UTF-16 单位、每次最多 512 个 codec token 且必须实际 EOS；最多 64 次完整语音调用、零独立文本编码模型调用。原音频/时限/诊断/磁盘预算继续生效；Metal 仍为 6 GiB 分配指导加逐步实际累计峰值准入，不称 OS 硬上限。CPU 数学库请求两线程，实际神经推理为 Metal；不声称整个进程被 OS 限为两线程。Node 与浏览器独立核对准确说话人、资产 hash、原文/读法/样本、原生码数乘 1920、EOS、真实资源和实际调用，保留合法零码，不补静音或伪造逐字对齐。

已完成首轮正常主持界面的两条真实 Qwen 生成/候选/手动解码路径，零跳过/重试/flaky/源码漂移：原文“湖畔灯火。”与已确认读法“湖畔灯火.”，Uncle_Fu 44 个码 / 84480 样本 / 3.520 秒，Serena 22 / 42240 / 1.760 秒；每条恰好一次语音调用、零独立编码调用。实际 worker 为 observed-child-close / code 0，耗时 10729 / 6838 ms，Metal 峰值 4,268,931,927 / 3,160,125,347 字节，均低于原阈值。完整原输入、raw、WAV、原终态与浏览器证据保留。这是隔离工程团局的真实本机生成与播放，不是正常作者作品生产、独立真人听感或音轨采用；未自动勾选质量/使用权或提交 E16。

原准备/时序/worker 78 项兼容检查与新声线冻结、丢失创建返回、资源/帧反例、本机双槽位和不可用引擎、UI 异步偏好变化等定向检查已分别通过。合成 PCM 工程用例另核对 Qwen 24 kHz 候选到独立 E16、分支接收者、父 Run/Session 删除、证据保留、完整备份/导入与旧 Melo 共存；它们不能冒充实际真人采用。最终源码工程门、原生 UI/完整 CI 与原 P1–P10 联合验收继续分别完成；不得将历史定向通过移作当前全量结果。

可选 Qwen 缓存的缺失/损坏准入文件曾使整个本机 bridge 初始化失败，已以零推理反例复现后修正：该引擎单独保持不可用，Melo 元数据与历史原始结果仍可读取，不自动替换声音；每次可用性检查重读原准入证据，失效后不再宣传旧缓存可用。未知或归属不明的物理 claim 继续保留，不能用缓存故障推断原任务已经结束。

### 35.165 S3 逐资源来源与完整嵌套输出的版本基础（2026-10-19，接入前）

继续 P2d 的产品能力研发，位置为 S3 制作。入口仍是作者明确授权的原 Brief/SourcePlan 和既有生产 Harness；Work、Production/Build、候选与作者采用 owner 不变，世界版本只读，媒资继续归原产品。此次不新增 Context/Field/表/schema/AI 调用入口，不改变其他产品或 scripted 制作，也不生成新的实际作品。

当前 S3 模型请求只拼接 Gateway 的通用正文；逐资源 key、原资源 hash、读取 depth 与准确正文另存在证据中，模型无法可靠填写 sourceFieldRefs。原输出说明只列顶层字段，完整角色卡、局势、后果、压力和媒资等嵌套格式不足。先登记三个显式 `.v2` 制作 Skill 和对应提示词版本，权限、候选目标与模型额度保持原闭集；旧 `.v1` Skill、Plan/Run、原提示词与未知结果保持原身份，不在恢复时静默升级。

S2 已验证的逐资源投影抽为跑团自己的纯函数：只核对已完成的实际读取，不查询目录或扩大选择。重复/缺失读取、错误原 hash、来源锚点不一致、full/original 正文改动均拒绝；summary 等仍标真实深度，原资源 hash 不冒充摘要字节 hash。S2 序列化正文保持原字节，新 S3 使用独立版本化投影；原 ContextPacket、trace 和 sourceSnapshots 仍由 Harness 保留。

完整格式说明从同仓库现行类型提取，只交付本任务需要的根对象及其嵌套定义；原闭集解析器、来源/规则验证、人工事实与数值确认继续裁决，不把格式文档或模型自报 gates 当采纳。工程反例用解析器接受的独立 JSON 再对实际发送的类型文档作 TypeScript 完整检查，避免遗漏引用类型；多余字段、来源篡改和旧/新绑定隔离均单独检查。

本基础提交暂不把新 Skill 接入正常生产 Plan。后续消费者须在原调度器把准确投影送入模型，计算实际正文 hash/token，并将完整新 system/格式说明开销计入原冻结输入预算；超额明确失败，不裁掉必读来源或放宽预算。实际 wire、preflight、binding、预算、篡改、旧 Plan/未知请求恢复和作者采用链通过后，才可继续真实 S3 制作。工程检查、真实作者生产、独立真人/长局与完整产品验收分别留证，原 P1–P10 目标继续。

### 35.166 S3 实际逐资源交付、完整格式与原任务预算（2026-10-19，开发预览）

消费 §35.165 已验证的独立基础提交。新建 open 制作 Plan 的来源事实、规则角色、局势压力三个任务使用各自 `.v2` Skill；任务 key、V1 候选内容 schema、原候选/作者复核与生产发布 owner 保持。媒资规划、确定性集成、scripted 和其他产品仍走原路径。闭集解析器和三注册表继续裁决，没有新表、字段权限、数据迁移或世界回写。

新调度器只对准确匹配的新任务/Skill 组合投影实际世界读取，发送逐项 resourceKey、原 contentHash、真实 depth 与完整 readContent。既有登记 Brief、已采纳上游与修复意见仍按原精确上下文链交付；不丢必读内容、改取新世界版本或以名称摘要代替原字段。原 ContextPacket、完整 retrievalTrace 和准确 sourceSnapshots 在发送前一并保存；rendered-request 包含本次实际 system、正文、输出上限和相应文本请求 hash，后续仍走原 Gateway Manifest、候选、checkpoint、receipt、人工复核与专用采用。

静态格式说明按任务提供完整嵌套类型：事实字段证据、完整角色卡/机械映射/私域、局势/后果/压力/接收者、metadata/地图/媒资。新局势输出明确排除 factPolicy，不重复交付该禁写分区的类型；其余根字段和嵌套定义全部保留。格式来自同仓库类型，保留有语义的类型换行，只清理静态空白/注释并精简重复模型说明，不处理作者数据或世界正文。文案仍要求中文，ASCII key 保持稳定。实际返回继续由原闭集解析和作者授权验证，模型自报 gates 不构成系统或人工通过。

原 Manifest 的来源 token 合计不改成整段请求计数：两者有标签/分隔符差异，初次混用曾被现行完整性门拒绝，失败保留。新请求另用既有 estimateTokens 对完整实际正文和 system 作预算估算，计入格式/引用锚点开销；这是发送前估计，真实 provider 用量另记。输入须同时满足原 Plan 与原尝试剩余额度，实际输出上限也收窄到登记 Skill、原 Plan 和剩余输出额度的最小值。已用调用/token 不因重试清零；用尽或超额在 provider 边界前明确阻断，不扩预算、删字段、裁来源或隐藏重发。曾实测完整格式超过 48000 输入上限，原门正确阻断；修正只精简静态说明，原授权不变。

旧冻结 Plan 按完整历史一代精确读取，不原位重写 JSON/hash；混代、调换 Skill 或篡改预算均拒绝。已存在 Build 的暂停/作者复核后新 epoch 从同一原 Plan 派生，保留原 Skill 和提示词；冻结 Plan 缺失/损坏停止恢复，不重建为新版。新作者制作轮次才选择新合同，跨 Build 的复用仍核对原 producer、execution identity 与完整依赖，旧未知结果保留账本占用且不自动重发或升级。

已完成旧/新整条制作、两处作者复核、实际 provider 文本与发送前证据逐值核对、来源篡改/缺失/重复、静态格式预算、原未知结果与损坏冻结 Plan 等定向反例。额外复现过第二次有界修复仍请求完整输出额度的旧行为，现对新合同按原剩余额度收窄并留实际 wire 断言。最终组合工程门、发布/备份/原生浏览器及完整 CI 结果单独记录；本增量仍不是新真实模型作品、连续长局、独立真人或产品整体验收。原 P1–P10 目标继续。

### 35.167 新制作岗位的静态注册收口（2026-10-19，完整 CI 阻塞修复）

本单元属于跑团产品研发的 S3 制作基础，不触发作品生成；Work、Production/Build、候选、作者采用和媒资 owner 不变，WorldRelease 仍只读，三注册表权限与表生命周期没有新增。先独立收口注册表，后续未知超时和结算修复单独施工。

当前完整 CI 在 `check:agent-freshness` 检出三个新版制作岗位的 id/promptVersion 不是字面量；此前定向门未覆盖该静态检查。这不是运行时绑定变化或上游审计问题。将注册表中的六个属性改写为与已发布绑定映射逐值相等的字符串，并去除只用于该间接读取的导入；不改检查器、不放宽门，也不修改原 Skill/Plan/prompt 或历史原文身份。

既有完整格式/来源投影、作者设计预检和 Skill 注册表回归仍需通过；同时补跑真实 `check:agent-freshness` 及提交前工程门。旧完整 CI 失败保留，修复后的定向门不冒称完整 CI 或真实产品验收通过。原 P1–P10 及真实 S3、长局、独立真人/媒资权利与发行验收继续。

### 35.168 制作超时、未知用量与明确结算的共同基础（2026-10-19，开发预览施工）

本单元由真实跑团 S3 制作中的超时重发暴露，先串行修复共享生产调度与原制作台。产品研发与具体作品生产仍分离；Work、Production/Build、候选和媒资 owner 保持，WorldRelease 只读。复用登记的 Brief/上游/修复上下文、原候选采纳目标与 PROJECT_TABLES 生命周期，不新增表/schema、上下文来源、字段权限或正式 AI 入口。

到达任务时限或终止本机等待，不能证明供应商没有处理或未消耗额度。存在付费调用可能且没有真实用量时，原任务保留未知预留并进入明确恢复边界，不以普通 transient 超时自动重发；旧 task-timeout 也不重新领取调用。只读投影显示受阻，实际调度恢复将旧的失败 step 追加为真实 Run 失败终态，并从原 contract/parent/step 留下 Run、attempt、epoch 与 Plan 归属，不改旧事件、Plan/prompt/预算或补造 provider 原请求。

制作台、service 和具名命令共享结算分类：既有 unknown-result/已观察响应，以及内部 task/provider-result-unknown 均进入原明确结算路径；旧超时依据原账本是否确有未知付费占用判断，已知用量和零调用的确定性超时不能被错当新费用。损坏证据不能被解释为免费。普通 retry、换能力或零调用作者修订均不得跳过原未知请求结算；处置必须准确绑定失败 Run/attempt/epoch，不能借用别的来源。真实用量优先；没有真实用量时仅保留作者明确核对未计费或按冻结预留上限记账两种原有选择，不隐式选中、不提高预算，刷新不再次调用。

结算后的明确继续沿新控制 epoch 及原版本 Plan 执行，原已消费/未知占用、原文与失败历史保留。候选检查点、原文恢复、作者采用和模型重试是不同动作；部分或取消回答不能转成成功候选。本基础不改变冻结的任务时限、输入估算器、S3 本机原请求绑定或作者逐项确认界面，这些仍按真实制作证据继续补齐。要求新/旧超时、进程中断、无选择/错身份拒绝、明确结算继续、用量优先与既有恢复 UI 的正反例；定向通过不等于整产品或独立真人验收。原 P1–P10 继续。

### 35.169 S3 本机请求的发送前归属与明确查询（2026-10-19，开发预览施工）

产品仍为跑团研发，S3 制作的原 Work/Production/Build/任务 Run 负责请求和回答；世界只读，媒资 owner 不变。本单元沿原已授权 Brief、Plan、Skill、Context Gateway、候选与生命周期，不新增生成入口、表/schema 或写回权限。仅为新的实际本机文本请求增加传输保留与准确归属，原 Prompt/Plan/时限和旧无绑定请求不被改写。

本机生成前必须将真实 requestId/model/准确 wire hash 与本次 Work、Build、Run、attempt、epoch、Plan、原输入身份一起保存到该 Run 的精确来源证据；存储失败、重复引用、归属/能力变化或过期时不得发送。新回执约定保留到 owner 已保存准确完整原文和响应元数据之后，再尝试交接 ACK；ACK 失败保留本机副本，不伪造采用。结果未知、失败或部分回答不签收成成功候选。非本机提供商、注入测试执行器与其他产品不默默启用本路径。

原制作台提供显式查询同一请求的动作，只读原 ID，不新建 Run、不发送生成、不结算旧占用、不重试或自动采用。历史无发送前绑定、导入后的重绑定副本和跨作品引用不能按正文/hash 搜索补关联；原失败终态不能被追加成成功。原 owner 已保存的完整回答可在本机服务不可用时只读展示；尚未交接的终态回答仍由原本机保留。查询与作者明确修订/原结算继续是不同动作。本单元的只读展示不代表未知任务已恢复成可发布候选；零调用的候选交接、输入预算、新执行时限及逐项审阅仍需后续闭环。要求单次 POST 前持久化、存储失败无 POST、准确回执/原文先于 ACK、查询零生成、旧/导入/错身份拒绝和失败部分回答反例。

### 35.170A 任务输入与完整请求估算的登记基础（2026-10-20，开发预览施工）

本基础增量属于跑团产品研发的 S3 作者制作，沿 Work/Production/Build owner，冻结世界只读、媒资仍属产品。先独立登记任务 Brief/已采纳媒资投影与新版 Skill；完整请求测量留给实际消费增量。写目标沿原字段，不新增表或扩大写权。每个读取器独立校验原作品/Build/任务/完整 Brief hash 与闭合 Plan，不依赖并行读取替它核对。

登记本身不选择新版执行计划。当前正常制作仍走既有整代 Plan、提示词、预算与时限，旧未知请求、原文和占用全部保留。消费新输入与新时限须由后续独立增量沿原冻结/候选/作者确认/发布路径落地，并验证新旧完整生命周期；不能以源已登记或纯合同测试宣称新制作流程完成。估算方法与显式4096输入余量只作发送前保守保护，不冒充供应商实算。

### 35.170 按任务输入、完整请求测量与新执行时限（2026-10-20，开发预览施工）

本单元仍是 TTRPG 产品研发的 S3 作者制作，沿 Work/Production/Build、候选、发布与团局自己的 owner；世界版本只读，媒资仍由产品拥有。新增登记的任务 Brief 投影和已采纳媒资输入，写目标及 PROJECT_TABLES 不增表或改权限；正式调用仍为原 durable 生产路径。原完整 Brief/SourcePlan、权限/必读约束、世界资源正文和各次 Context Manifest/实际来源清单继续保存。

新版是闭合的 Skill/Plan 输入与时限代，不对旧 V1/V2 的绑定、提示词、预算、180000ms 或未知请求换代，也不重建损坏/混代计划。新内容任务按其真正用途取得已确认事实、完整冻结规则或作者局势输入，来源和上游正文不以摘要代替；省略的重复编排元数据不能被当成授权。媒资规划只读取登记的已采纳视觉圣经、槽位和身份锚点及原 artifact hash/receipt，不把完整角色私域/秘密包发给它，也不伪造新增世界读取。产品发布的来源清单仍须闭合前三项真实内容读取或其正式复用 lineage。

当明确授权的图片/音乐/音效/配音数量与媒资种类均为空时，新代用确定性步骤校验已采纳槽位确实无生产需求，再产生原 schema 的空规划，模型调用为零；任何必需槽位或预算不符仍阻断。该 kernel 不调用 assembleContext 的空数组默认全源路径，声明零模型上下文并只消费有哈希归属的结构化依赖，保存准确的纯计算输入证据，不伪造非空 Context Manifest 或放宽共用 schema。非空媒资保留独立模型候选、数量/身份/密级、权利与作者验收链，不把文字范围当作整个媒资目标完成。

新版完整 system/user 包装单独按显式保守方法估算，并留4096输入余量；Manifest 来源估算合计与完整请求估算分别记录，均不冒充 provider 实算或隐藏输入保证。新输入按9/12/15分配给来源/规则/局势，非空媒资规划3份、每个实际媒资通道8份（含原完整 Brief 与结构化物料的确定性读取）；输出按1/2/2及非空媒资1份分配，新的规则/局势岗位上限24000。所有分配仍受原 Brief 合计、真实已消费和原尝试剩余额度约束，不能用重试重新获得预算，超额停止而不裁必读内容。新模型等待上限取原任务时长与600000ms较小值，旧计划保持原时限；超时、原请求绑定与明确结算继续沿前两单元。

要求整代新旧兼容/混代拒绝、准确原 hash/作用域/权限、全文与完整格式、真实消息包装及剩余预算、媒资派生输入/来源复用闭包、零媒资0调用且不忽略必需槽位、原请求未知结算/刷新恢复、隔离作者复核/发布/备份及真实 S3。本单元的源码落地与验证按各自实际证据记录，不能以候选回归替代完整验收；完整 CI、30+真实世界回合、独立真人、音轨权利及发行安装仍属原 P1–P10。

### 35.171 来源事实与角色属性的逐项作者审阅（2026-10-20，开发预览施工）

本单元属于跑团产品研发的 S3 作者制作，复用 Work/Production/Build、原任务 Run 和现有 `authorDraftJson → resolve-blocker/author-edit → 校验/候选/采用`；不增加确认表、推理入口或采用权限，世界和产品媒资 owner 不变。制作台可读取当前任务的完整待确认稿，显示事实的值、作用范围、来源字段/原 hash，以及角色属性的数值、推导依据和完整角色卡，逐项勾选后仍由原“修正后继续制作”提交。高级完整 JSON 与逐项视图编辑同一份暂存修订，不各存确认状态；未提交选择在刷新后需重新核对。

读取前后核对真实作品、Build、Plan、epoch、Run、attempt 与作者命令修订。只接受当前完整 `task-draft-rejected` 回答的准确原文；相同字节的重复记录可去重，不同原文不自动选新。超时、未知、取消、部分、跨作品和 stale 不能借此取得候选身份。模型自称的确认不生效：事实只保留与原 Brief 完全相同的已确认项，新角色映射全部待本人确认；此规则与正式 executor 共用纯函数。读取和勾选不发模型、不结算、不采用，原回答和历史继续保留。页面在作品、Build、任务或尝试切换时清除未提交修订，迟到读取不能覆盖别的作品或作者正在编辑的内容。

验证需覆盖原始证据不变、作用域/尝试/版本拒绝、未知回答拒绝、冲突与迟到响应、模型确认归零、分页准确索引、原高级修订/未知结算兼容，以及隔离浏览器从真实作者控件逐项确认到发布的完整路径。模拟供应商仅证明流程与数据约束；真实制作、真人体验及完整产品验收仍按原目标单独验证。

### 35.172 原完整回答的独立保留基础（2026-10-20，开发预览施工）

本基础单元属于跑团产品研发的 S3 作者恢复。原任务 Run 已结束后，禁止追加证据、重开旧 Run 或按相似正文补造本机请求。只有发送前已有准确绑定、当前失败尝试、完整 dispatched/completed 原回执可显式保留到独立的纯工具 Run；它仍由同一 Work/Build 拥有，使用现有零模型、零输入输出 token、无上下文源/采用写权的工具契约。原请求和完整原文通过原精确 Artifact 存储及 checkpoint 留存，先存原文和响应元数据，再尝试同一原 ID 的 ACK；不产生新的推理请求。

同一原输入只保留一个交接 owner；真实浏览器锁排除并发页面，逐事件 sequence CAS 继续生效。存储失败不释放原服务保留，明确重试续用原交接 Run；ACK 意图已保存而结果丢失时不隐藏重发，标记未知交接状态并保留已保存原文。完成后的同一回执可离线重放，损坏证据不回退为新请求。未完成、取消、部分、跨作品、旧尝试、过期 Build 或导入后的本机引用均不认领；作者备份仍保存原字节，不能把导入当作原本机绑定。

本基础不创建 CreativeArtifact、不采用、不修改原账本或真实费用，也不把模型确认升级为作者确认。原失败终态和未知用量占用完整保留，返回 candidateReady=false。其后仍须沿既有作者修订/候选/采用路径加入严格的保留来源证明、原实际用量或明确处置、逐项审阅及发布来源闭包；基础保留成功不代表候选交接或原 P1–P10 已完成。表与 PROJECT_TABLES 生命周期不新增，世界及产品媒资 owner 不变。

### 35.173 原完整回执的独立用量核对（2026-10-20，开发预览施工）

本单元仍为跑团产品研发的 S3 作者恢复。沿既有 Work/Production/Build 和精确原尝试账本增加闭集命令 `book-original-response`，只接受原作者版本、Build/Plan/epoch/task/Run/attempt 与独立保留 Run 的准确终验 hash。命令自行离线复验完整原文、原请求及来源证明，不接受客户端传入实际用量，不请求本机服务、不创建 Run、不生成候选、不采用，也不推进 epoch 或自动开始制作。核对用的真实原始证据与待确认材料不是正式内容写权。

原回执有可靠 token 用量时只核记原请求的一次物理调用和真实输入/输出；费用未上报保留 null，不当作免费。时长采用原步骤开始到原失败/取消的已观测跨度，明确不是本机推理时长或之后的空闲等待；未核对原产品产物存储时拒绝记零。已知费用或既有人工/系统处置不能被新结果覆盖。原回执缺少用量时，只能由作者明确沿已有冻结预留上限处置，不能因为回答已经完成而声明未计费。保守上限与观测到的一次物理请求分别留证，不能混成两次实际调用。

账本、原失败中的结构化核对记录和命令回执在原作用域事务中提交，原未知预留完整保存在核对记录中。提交前再次核对 Production/Build、两个终态 Run、精确原文/来源工件及原任务产品工件集合；变化则拒绝，存储失败全部回滚。同命令离线重放原回执，同原证明的新命令不重复计费或改写首份核对记录，并发命令只允许原修订的一项提交。

真实用量超过旧任务或 Build 授权时，费用事实仍应保存，返回“已记账但旧授权不可继续”，保留失败来源并阻止重试/作者修订/更换能力沿旧授权继续；不得回滚真实花费、提升旧上限或隐藏重发。需要继续时走明确新 Brief 的既有授权流程。备份保留原文、已核用量和不可搬运的原本机证明历史；编号重映射不能把它变成本机请求权，导入的待核对证明不得新认领或二次记账。

此单元只闭合原费用核对，仍保持待作者恢复阶段；原回答逐项审阅、严格来源证明随作者修订进入原候选/采用与发布来源清单，以及接受后搬运生命周期，须由后续消费者完成验证。不能以本单元的模拟传输回归、类型检查或记账成功宣布候选交接/真人/完整 P1–P10 完成。世界只读、媒资 owner、三注册表与既有表生命周期不新增权限或表。

### 35.174 原完整回答进入明确作者修订的来源证明（2026-10-20，开发预览施工）

本单元属于跑团产品研发的 S3 作者恢复，在独立保留与原用量核对之后，扩展现有 `resolve-blocker/author-edit` 的闭集来源引用，仅允许原保留 Run ID 和准确终验 hash；不接收客户端提供的来源正文、实际用量或证明状态。后端独立核对当前 Work/Production/Build、冻结 Brief/Plan 正文、失败 Run/attempt/epoch、完整原文、原记账成功回执和原预留处置。来源仍只属于当前失败任务，不扩大上下文源、字段采用权限或表生命周期，也不改世界、旧失败终态或原回答。调度器按需载入来源校验模块，避免经作者 service 形成静态循环依赖；包体限制保持原值。

后端冻结原请求/保留终态、原文 hash、实际证据引用、原记账回执、原用量与本次作者命令/修订稿 hash，事务提交前再次核对真实 owner、Run、工件和命令回执。完整原模型回答与作者修订稿分开留证：来源证明不会把模型自称的确认变成作者确认；修订仍经过原任务完整解析、质量闸门、原生产候选、产品采用与原发布路径。只有明确作者继续才推进执行；这项文本任务修订本身不再发起模型，已授权的下游任务仍按原计划单独执行。

原用量必须先独立核对且旧授权可继续。初次提交准确原回答来源时不再要求作者重复选择“未计费/预留上限”，也不能与另一项未知费用处置混用；原实际或明确上限记录不再计一次。原账本已消费与原作者命令保持。作者修订未通过时，只有导致当前失败 epoch/任务的那条明确成功作者命令，才能把已冻结来源传到下一次明确作者修订，逐次保存前一来源 hash；不得按相似原文、任意历史任务或最新记录猜来源。

执行时再次核对已提交作者命令、修订稿、原证据与原账本，纯读取原工件，不查询本机服务或重开旧 Run。原来源证明及作者稿进入新任务 Run 的准确 source-snapshot，正式产物保留来源/原文/保留终验 hash；原模型文本不伪装为新模型响应。世界来源仍由本次正式 Gateway/Context Manifest 和既有发布来源清单产生，原文本证明不能替代必读世界或把一次模型回答当作世界授权。

本机证明明确不可搬运为执行权限。作品备份保存原文、证明、命令、已核用量和正式内容；导入的待执行证明不能继承原电脑请求或修订执行权。已接受材料的内容与原证明历史可保留，后续发布与恢复必须继续经过现行产品来源复验。要求零额外模型的原候选/采用路径、修订退回后来源不丢失、作用域与 Plan/hash 拒绝、事务回滚/重放、真实备份导入及旧制作/恢复兼容。模拟传输单测不证明真实浏览器、provider、发布/安装续团、独立真人或整个 P1–P10 完成；正常作者控件消费者仍须单独落地和验收。

### 35.175 正常作者界面的完整原回答恢复（2026-10-20，开发预览施工）

本单元属于跑团产品研发的 S3 作者恢复，只消费前述原回答保留、独立用量核对与作者修订来源契约。普通已知失败稿继续使用原逐项审阅入口；迟到完整回答或未知费用的当前任务才显示恢复操作，保留原只读请求查询供排查历史。原 Work/Production/Build、冻结世界、产品媒资、三注册表与原采用权限不变。

恢复操作按三次明确动作进行：读取并保留准确完整原回答、核对并记入原用量、把原回答载入现有修订稿；不因为查询、刷新、记账或载入就开始生成或提交内容。缺少可靠原 token 用量时须本人明确选择已有冻结预留上限，不提供将已完成请求声明免费的选项。实际超旧授权的费用仍保存，界面显示不可继续，不能靠旧费用单选项绕过。已核费用不重复要求作者再猜一次；最终作者提交仍由后端独立复验原证明和额度。

载入完整模型回答沿与正式 executor 共用的事实/角色映射归一化，不把模型自称的确认当成本人确认。恢复面板与高级修订、逐项事实和属性审阅编辑同一个 `authorDraftJson`；已手写的完整修订可明确关联原回答并保持原字节，迟到读取不覆盖正在编辑的稿件。最后仍点击原“修正后继续制作”，闭集来源引用只随本任务作者修订发送，不能混入另一项未知费用或更换能力处置。

修订稿及暂存来源指针绑定 Work/Build/Plan/epoch/任务/Run/attempt；切换实际 owner 时清空，补齐初次异步进度不误清空。面板本身有同步在途锁防止连点，迟到回调核对当前 owner 和稿件值。记账后仅从准确当前作品重读状态，不以旧 scope 的全局刷新覆盖另一作品。原累计模型次数刚好用尽时，仅准确已核证明的零模型作者修订可继续进入校验，不扩大旧模型预算或允许超限生产。

作者修订被退回后，原逐项审阅器可重读该失败任务的准确作者 source-snapshot：必须核对成功作者命令、来源证明、当前失败 Run/attempt/Plan 和作者稿 hash，保持已由本人确认的字段，不再当作新模型稿归零。缺证、导入待执行引用、历史或冲突原文不获得这个读取权限。正式发布、SourceManifest 闭包、完整备份导入复验、原生浏览器及真实 S3/30+回合/独立真人/媒资权利/发行续团仍按各自实际证据验收，不能用组件或模拟后端测试代替。


### 35.176 已发布备份的原始 RootV2 与编号冲突（2026-10-20，开发预览施工）

实际正常作者流程已到发布、试玩入口及 SourceManifest 聚合；随后在保留原项目的同库备份导入中发现原 root seal 包含本地 Run 编号，重映射后旧发布校验错误拒绝。 未修改的 0a9e 基线复现了相同缺陷，不能以只填充 World/Work、没有 Run 冲突的旧往返用例代替此反例。原失败日志、trace、截图和原费用记录保留。

共享修复不修改旧 RootV2 算法或已有 hash；只提取其既有完整 preimage 工厂。完整备份 owner 首次从当前真正发布 root、Build 和匹配的不可变 Release 冻结原 preimage，沿既有 AgentRun 可选历史字段保存。只在严格完成前缀及真实导入失效事件之后，核对 Artifact 的原文/元数据/质量/权利完整 envelope、全部终端指针，以及从 PROJECT_TABLES 读取的 Run 引用双射。预算中的历史失败、用量、费用和处置不裁剪；当前引用仍须实际属于原 Work/Build/任务/epoch/attempt。

本地复验使用专用 verifier 和原 Harness 的终态记忆结算，保留原已发布 Build、Production、Release 及原 hash。跨 Build 读取/复用使用同一严格关联；普通未发布 Build、其他产品、legacy V1 和旧无证明备份的边界保持。连续导入可复验且不重复生成或记费，退休旧 root 不替当前预算 root 签发。不得仅删除旧守卫、忽略历史成本，或复制一份证明绕过真实导入来源。

验证要求包括真实编号碰撞、重复导入/幂等复验、恢复后连续作者修订和父版本复用，以及费用/token/attempt/处置/别名/跨 Build/原文/metadata/rights/证明损坏等反例；正式媒体仍须原 Blob/权利验证。该共享单元和原回答 capture→独立记账→作者候选→普通 UI 的四阶段候选须按真实版本串行落地与复验。保存于任务验证区的 RAM 候选不代表分支已落地；正常浏览器使用明确模拟传输，不冒充真实 provider、独立真人或完整产品验收。完整原目标 P1–P10 和默认隐藏入口边界继续保留。

恢复后的作者续开发回归同时覆盖清空数据库与保留原项目两种路径：实际 Run 编号冲突后复验、内容/视觉修订、连续发布至第三版，再保留两份历史进行下一次备份导入。原两个执行 profile、旧反例与所有原断言保留；新增条件明确断言编号真的变化，并核对原项目发布与数据不变。隔离 fixture 不能替代真实模型、独立真人或实际发行安装验收。

原回答接回的长期 E2E 同时覆盖正常 capture/独立记账/事实和角色逐项审阅/发布，再经实际服务完成导入后的零调用视觉修订、第二版发布和第二次编号冲突导入。完整原文与权利、旧发布及预算记录须保持；三次模型 HTTP 均为明确拦截模拟，后续修订零新增模型请求，不代表真人或真实 provider 验收。用例随现有 ttrpg-open 预览 CI glob 执行，公开入口默认关闭。

补齐导入 root 复验的真实中断边界：若专用 verification.started 已提交而返回丢失，或 verification.accepted 尚未写入，恢复须重新校验原 preimage、发行/作用域与完整预算/Artifact，再完成同一个验证；不得重发 start、重跑生产或改旧发布。accepted 的原子终态/记忆结算返回丢失时只读重入。错误 verifier、费用变化或原证明缺失仍拒绝。已开始但未完成的验证可原样备份并在再次编号冲突导入后显式续验，不补造执行权限。

### 35.177 完整作者任务投影的原子读取上限（2026-10-20，开发预览施工）

真实隔离作品在新的 S3 局势任务中，完整作者方案投影估算为12069 tokens，却被新登记来源的8000单源上限阻断；该任务仍有冻结预算且尚未发送模型。这是新 V3 来源的容量不匹配，不能通过裁剪规则/作者局势、修改旧 Plan 或省略必读资料掩盖。修复只把 `product-production.ttrpg-open-task-brief` 的显式单源上限调整为100000，保持 atomic/protected、准确作用域/原 Brief 与 Plan/hash 复验。它与既有完整作者来源采用相同有界容量；实际交付仍取该上限和原任务准确输入预算的较小值，整个请求还要通过完整消息、模型窗口和真实剩余额度检查。

不新增来源键、AI 权限、读取内容或表/schema，不改变投影正文、冻结 Brief、世界版本、原始回答或既有来源哈希。其他来源，尤其旧 V1/V2 使用的通用 Brief 来源，其登记及执行代保持；修复不能给历史无绑定、导入副本或已失败请求补造调用权。实际局势调用须由作者沿现有明确继续/新尝试入口启动，前两步已采用内容沿原谱系复用，不能因此重新生成或把历史成本清零。

回归须以真实注册读取和合法授权的 V3 Build 覆盖：大于8000的完整作者内容按原字节交付；任务输入仅8000时仍在裁剪/模型前拒绝；即便调用方给更大总窗口，超过100000的单源也拒绝；错误作用域、损坏 Plan/hash、原子保护和旧来源保持。真实来源12069的故障与后续候选/分支工程验证分别记录，模拟内核不冒充真实模型，真实模型亦不冒充独立真人或完整 P1–P10。共享注册表、生成 AI Manual、必要文档与回归先独立提交，再串行集成跑团预算界面。

### 35.178 停止旧轮次后的下一轮预算修订（2026-10-20，开发预览施工）

本单元属于跑团产品能力研发，位置为 S3 制作恢复；Work/Production 继续拥有作者方案和制作谱系，Build 拥有原冻结计划、原文及用量记录。入口是现有制作台：作者先明确“停止”并保留旧轮次，随后只对下一份 Brief 核对文本调用次数、输入和输出总上限。沿用既有作用域读取、Brief 解析/哈希、预算账本校验、Plan 工厂和 save-brief-revision 命令；不新增表、schema、AI 来源或正式写入字段，不取得世界写回或产品媒资所有权。

“核对新预算”只读检查准确 Work/Production/Build/epoch、当前方案、原账本和失败字节，展示按现行新执行代计算的逐任务预览。修改任何输入都使旧预览失效；错误或迟到的核对不得保留旧保存权限。只有明确“保存为新制作方案”才新增同一 Production 的 Brief；媒资要求、世界版本、来源计划、角色、规则和费用策略沿用原内容。保存和预览均不新建 Build/Run、不结算费用、不发模型、不采用材料或自动开始。原世界、旧 Build/Plan、原回答、历史 Run 和未知用量占用保留。

保存成功后，作者通过原有“作者授权并开始自动制作”另行开始新 Build，才冻结当前整代 Plan/Skill/时限；旧 V1/V2 不原地换代或扩大冻结预算。旧 Brief 可由既有开始命令标记 superseded，其原内容和哈希保留。新上限仍须通过完整请求、模型能力、真实已消耗与剩余额度检查，不承诺输入能够任意容纳、不把历史未知占用解释为零次或免费。保存返回丢失须复用原命令标识及准确 payload，不能自动重试生成；更换作品、状态变化或并发修订时拒绝迟到提交。

验证覆盖新旧/空/历史 V1 账本、两个未知占用保留、错作用域/损坏/过期状态拒绝、保存重放与并发、界面核对/保存明确分离及切换作品的迟到返回。隔离原生浏览器还须覆盖旧 V2 停止→零调用预算预览与保存→单独授权新 V3→事实/角色逐项审阅→正式发布，核对旧行、原文与世界不变。明确模拟传输不替代真实 S3 制作、独立真人、30+真实世界回合、单条音轨权利或发行安装验收；完整 P1–P10 与默认隐藏边界继续。

### 35.179 未发布原稿返修的命令与证明基础（2026-10-20，开发预览施工）

真实隔离作品已采用局势稿，但素材规划在三名视觉角色的空表情基线处失败。确定性任务正确拒绝非法输入，不能通过放宽素材解析器或允许手填内核输出绕过。当前单元属于 S3 产品能力研发：作者先明确暂停当前未发布 Build，再用独立的 `resume.ttrpgContentRevision` 修订已采用的来源事实、规则角色或局势稿。它与文字冒险的修订权限分别解析；一次命令只能指定一个产品和一份原稿，不能取得世界写回权或其他产品的内容权限。

命令绑定准确 Work/Production/Build、暂停 epoch、原 Plan hash、原稿 key/version/contentHash、完整作者 JSON 和说明。原冻结 Brief 与整个 V1/V2/V3 执行代、预算及任务关系仍须通过原解析器；本单元不扩大历史限额或替换任务 Skill。原稿必须是同一 Build 当前 Plan epoch 唯一的已采用或携带版本；跨 Build、已发布、错作用域、过期版本、确定性岗位、坏 JSON 或缺失生产证据均拒绝。沿用 Artifact store 的实际候选 checkpoint、Run/event/receipt 与同 Build 携带谱系验证，并在命令事务内复验完整原始读取集，不能仅凭 payload 哈希把本地改写行当作合法原稿。

提交只记录恢复授权，沿既有新 epoch、修复反馈、候选和 adopt 链生成新版本；原内容、原始回答、旧费用、权利与历史保留。旧稿可由既有生命周期标记 invalid，其内容不覆盖。依赖失效使用原任务图的闭包：局势返修重新执行素材规划、集成和质量核对；返修事实或规则还会使实际依赖的后续模型岗位重做，费用仍受原剩余额度约束。修复 JSON 仅提供给准确目标岗位，不流入兄弟任务或媒资上下文。暂停中的未知供应商占用仍按原逐项结算机制处理，返修本身不授予免费或未计费结论。

重复命令、并发竞争与返回丢失沿既有 receipt/hash/CAS 重放，不能多修订一次；读取证明期间另一连接完成同一命令时，仅可由命令事务核对并返回原回执。完整备份保留修订历史及稳定 key/version/hash，不增加表、schema、字段权限或上下文源；导入后的未复验 Run 不恢复执行权。共享命令/证明基础先串行验证，正常界面的载入、影响预览、明确提交及原生浏览器验收随后接入。本单元的模拟三岗位制作、正式发布及导入反例不替代真实作品的返修读回、真人体验、30+真实回合、音轨权利或完整产品验收；默认隐藏和 E-TTRPG-OPEN-01/02 状态保持。

### 35.180 正常作者返修、影响预览与本地失败用量（2026-10-20，开发预览施工）

沿 §35.179 的同 Build 修订命令，在现有制作台先明确暂停，再选择并载入准确已采用原稿。载入只读验证完整原稿来源；原版本另行保留展示。来源事实、规则角色复用既有逐项审阅控件与同一份完整 JSON，已载入的返修模式不调用“本任务待审稿”的失败任务读取器。局势稿提供视觉角色表情标识、描述和显式新增基线，其他字段仍可在高级 JSON 中修改；不自动补角色知识、权利或确认标记。局势返修核对还用已验证的原规则角色检查视觉圣经和媒资清单，空表情等错误在恢复命令前可见。

作者填写返修说明后，明确“核对返修与影响”。预览使用原任务依赖闭包，区分本次零模型作者稿、后续可能重新调用的模型岗位和确定性核对；保留原完整计划及剩余额度检查。核对不新建 Run/候选或改变 DB；修改原稿、说明或选择使旧预览失效。只有“提交返修并继续制作”才执行准确命令，并由既有自动制作继续。旧 Work 返回、迟到读取/核对、同 tick 重复提交均隔离；提交返回丢失只可明确重放同一命令，不自动重发或新建另一次修订。暂停中的在途供应商占用继续走原明确费用入口，不能通过此面板推断未计费。

原生浏览器首轮已走通返修和发布，但完整备份复验被旧失败尝试的 `usageKnown=false/usage=null` 正确阻断，记录不抹除。针对新执行，三个正式纯本地跑团分支（空媒资校验、集成、质量）在抛错前附上已知零供应商用量及实测本地时长，保留原异常分类；不把此包装应用于模型岗位。通用 preflight 仅在完整事件中没有任何 model/tool dispatch 时报告零用量，有发送/响应证据仍保留原未知或实际用量。没有放宽导入或未知结果校验，也没有反向重写历史账本。

修正后，隔离原生 Chrome/IndexedDB 已完成正常暂停、载入、填写表情、影响预览、返修继续、正式发布及编号冲突的完整备份复验；本次返修零模型传输，初始三份输出明确为内部模拟。旧真实验证作品的历史未发送 preflight/本地失败另须逐条原 Run/事件/合同证明核对，不能凭新代码或预算为零补造旧实际用量。正式代码的定向、类型、构建和完整最终 CI 分别记录；真实作品、真人验收、长期模型质量与音轨使用权继续独立，不据这一浏览器用例宣称完整产品完成。

### 35.181 同步现行主干与工具声明的精确兼容（2026-10-20，集成验证中）

原稿返修的两个提交完成后，主干新增长篇质量链和共享来源/CI 改动，本分支先与 `667639539a1f3f78772536c588ab18ada001c7c8` 串行集成，再继续真实作品历史本地失败核对。保留跑团原来源冻结和 provider read-session 守卫，同时接受主干的 Canon 记录/后代排除；两者均只能缩小原允许范围。文本 stream 同时保留跑团音频入口隔离与主干已冻结模型解析的传递，不以一边覆盖另一边。三注册表、文档白名单和产品路由保留双方现行内容，生成手册和指标使用官方脚本重建。

主干新增 `workAuthoringIntent`，使完整工具声明确有变化：新执行冻结 `agent-read-tools-v20` 与实际 snapshot hash；从合并后的完整声明只移除该新来源，仍精确得到原跑团 v19 的 `4efc0b11…` 哈希，原各阶段的历史子集哈希也继续校验。旧运行合同、原稿、预算与已发布身份不重写；新全局来源枚举不授予既有跑团 Skill 读取作者意图的额外权限。合并后保留主干已登记的新长篇质量/复核入口及其明确退休的旧入口，跑团入口全部保留；正式入口按实际 AST 核对为60登记/64调用，不能沿用任一侧的旧数量掩盖丢项。

主干的独立 coverage 目录和每文件新进程执行方式按原提交接入，不改本聊天的验证队列、资源保护或退休清理配置，也不重启原 b1 已结束的失败作业。4ace 提交的147项回归与3条原生流程证据保留为该准确提交的结果；合并树须重新进行相关共享、长篇来源与跑团验证、必要构建及原生回归，最终完整 CI 仍单独运行。真实作品的两条旧本地未知记录、正常作者返修读回、长局与独立真人/音轨/发行验收继续未完成；原用户数据、原完整备份和原实际模型回答保持。

### 35.182 旧未发送失败的独立证据核对基础（2026-10-20，开发预览施工）

本单元属于跑团 S3 制作能力研发：Work/Production/Build 继续拥有制作、原回答与媒资；世界仅引用冻结版本。复用现有命令、Run 事件、原始工件和预算账本，不新增表、AI 读取源或候选写入权限。入口限定为作者明确暂停、尚未发布的当前轮次；先证明当前已采用原稿及完整生产谱系，导入待恢复副本不能借旧失败 Run 获得本机执行权。

新增独立 `book-local-no-dispatch` 命令，绑定准确版本、账本、原稿和全部有界证明。只接受两类闭合证据：正式模型岗位在发送前的确定预检失败，或严格零模型、零上下文/写权限的空媒资本地核验失败。核对原合同、唯一尝试、真实终态父 Run、完整事件/检查点和原始输入/失败资料；输入使用原调度器的准确复合哈希，包含原 null 元数据。出现供应商发送/响应、工具调用、候选、缺失/损坏资料、归属不明或非终态就保留未知记录，不能凭任务名称或暂停推断免费。

读取/准备没有写入或模型请求。作者另行确认后，仅把已证实未发送的准确旧条目结算为零供应商用量与原事件本地时长；回执保留原未知条目投影、原账本哈希、证据哈希及处置。历史 Run、原文、已知费用、状态、epoch、Plan、Brief 和预算均不改写；仍须另行正常返修/继续。命令与回执仅序列化稳定身份和哈希，不嵌入待重映射的本地 Run 编号；事务前准备、事务内完整读取集重验、回执原子提交与同命令中断重放沿原设施。发布后的完整备份与编号冲突恢复须保留此原始核对凭据。

本单元先串行提交共享命令/账本基础，再接正常作者界面。隔离回归包含真实预检与本地失败事件、保留旧未知值的明确核对、已发送反例、资料变化/CAS、竞争与事务回滚，以及返修→发布→完整备份的闭环；它们不代表原真实作品已经处理，也不替代当前整体验收、最终完整 CI、长局、独立真人/音轨及发行检查。

### 35.183 正常制作台的旧未发送记录核对（2026-10-20，开发预览施工）

在 §35.182 已单独提交并通过准确源树122项相关回归及类型/必要检查/构建后，原“返修已采用原稿”面板承接独立核对入口。发现旧失败未报告用量时，仍可明确载入并只读查看准确原稿；编辑、返修预览与提交先锁定。作者点击“核对旧失败记录”才读取完整原证据并显示岗位、发送前预检/本地素材校验类别和实际本地耗时，读取不记账、不请求模型。证据不闭合就显示失败并保留未知值，不提供默认费用结论。

另行“确认关闭未发送记录”只提交已核对的稳定命令，准确回执返回后刷新原制作状态，保持暂停；作者重新载入原稿，再单独返修。提交返回中断保留同一命令供明确重放，不自动重发；切换 Work、旧异步返回、重复点击、证据与账本变化继续由原 owner、读取集与事务回执保护。真正供应商在途/未知响应仍走原费用入口，不能用本地核对绕过。本界面不增加制作授权、采用或发布权，原真实作者数据处置、完整 CI、长局与产品验收仍分别继续。

### 35.184 返修影响与执行版本漂移的共同授权（2026-10-20，开发预览施工）

真实旧作品暴露了预览缺口：内容依赖图显示局势作者稿之后仅有本地岗位，但原来源/规则生产者仍冻结旧工具声明；共享调度器按已有执行新鲜度规则使这些上游失效。保护在新的供应商 POST 转发前拦截，原回答、旧核对回执和失败备份保留；此次请求已有 `model.requested`，不能借 §35.182 的本地未发送核对抹去，后续仍须准确本机原请求证明与正常费用处置。该结果不是已发布或真实 S3 完成证据。

修复先串行增加共同影响核对基础：复用原执行绑定漂移验证器和依赖闭包，核对内容返修及执行漂移的完整岗位；影响 Hash 同时冻结原 Plan、源 epoch、准确目标、岗位执行方式和各岗位当前 Skill/Prompt/Tool 绑定。`ttrpgContentRevision.expectedImpactHash` 为向后兼容的可选字段，旧命令原哈希不变；旧无此字段的命令不得增加依赖闭包之外的漂移岗位，新命令的 Hash 变化必须重新核对。原执行新鲜度约束不放宽，历史生产者不获得新执行权限。

命令准备与事务提交复验原制作、相关 Build/产物、Run/事件/检查点及当前绑定读取集；调度器在携带、失效或新岗位开始之前，再按真实新计划核对同一影响及准确失效集合。预览后或提交后升级、证据改变、额外上游失效均先停止，不能把额外模型调用隐藏在原零调用预览里。本基础不新增表、AI 源/写权限或本地 ID 便携字段；正常界面再作为独立消费增量接入共同计算并展示实际模型岗位。原真实作品恢复、最终完整 CI、长局及独立验收继续未完成。

上游重新生产的授权边界：影响 Hash 不授予延后原修订稿的权限。若额外上游须先生成/审阅，其输入和故障状态可能改变，因此即使 Hash 准确也保持当前轮次暂停，要求保留旧轮次后明确开始新一轮制作；不在旧局部返修里自动重跑祖先。没有额外上游的作者稿仍先被解析/采用，后续岗位沿原明确范围执行。正常界面应显示检测到的上游及不可提交原因，不把被阻止的预览包装成成功修订。

### 35.185 返修界面的准确影响与旧上游阻塞（2026-10-20，开发预览施工）

共同影响/新鲜度与上游顺序边界分别提交后，正常返修服务改用同一漂移验证器与依赖闭包准备影响，支持的返修命令冻结 `expectedImpactHash`。提交前再核对真实影响、显示的岗位与命令；预览后执行版本、来源或影响改变，就要求重新预览。中断后仍只重放原准确命令，不因新视图或新版本自动增加任务。

检测到旧上游版本需要先重新制作时，预览明确列出涉及的岗位及不可提交原因，保留原稿和暂停状态，隐藏提交返修按钮。后端同样拒绝，即使调用方持有准确影响 Hash 也不能绕过。作者可先停止保留旧轮次，再核对下一轮方案并单独授权开始；新轮次的调用以其方案和预算为准。版本一致的局部返修继续显示作者稿零模型及后续可能调用的准确岗位，仍走原候选、采纳和发布链。

原真实作品的旧两条未发送失败已单独核对、保留原未知值与回执。之前已提交旧版返修后产生的来源任务未知状态仍保留；本修复不反向改写它，不能把发送事件当本地校验关闭。原本机 GET 与明确费用处置、后续真实制作/发布、当前完整 CI、长局和独立验收继续待完成，公开入口保持开发预览默认隐藏。

### 35.186 作者修订的零供应商预算预留（2026-10-20，开发预览施工）

本单元属于跑团产品能力研发，修复 S3 当前未发布 Build 的作者修订；实际作品、候选、发布与会话仍归跑团 Work，冻结世界只读。沿用已登记正式岗位、Context Gateway、候选采纳与原表生命周期，不新增 AI 入口、可写字段或表。

正常作者修订和暂停后返修均不发送文本模型请求。调度器先核对原成功作者命令、准确草稿、Build、epoch 与回执，再只对本次准确 claimed Run/attempt/inputHash 使用零模型、零输入/输出 tokens、零媒资供应商预留；本地耗时与存储仍受原任务约束。其他在途任务、旧已知用量、未知请求预留和整轮上限照常计算，不提高预算或重写历史账。普通重试继续保留完整模型预算。

真实作者路径已发现：第五次实际 Build2 调用完整回答保留后，累计已知输出 40584，作者修订仍被按模型预留 24000 计入 60000 上限。此发现不代表模型再次发送或新费用；新的修复须以接近上限的普通作者修订及上游返修正例、普通重试/历史超限/伪造回执反例验证，再回到同一隔离作者作品继续。原回答、真实用量、旧失败、备份、冻结来源及发布门保留。完整 CI、真实连续游玩、独立真人体验与素材权利仍分别验收，不能以本单元通过宣布整体完成。

### 35.187 原真实模型作品的作者修订、发布与开团（2026-10-20，开发预览证据）

准确 `30eabf02` 在原隔离作品的原 Brief2/Build2 完成 S3 六项 durable task、装配、质量硬门与原子发布，并从该不可变 Release 创建独立 session。保留五次实际模型完整原文，合计输入213706、输出40584；供应商价格未报告，保持未知。最后的来源初值映射、角色来源/实体键、局势模板和零媒资元数据均通过正常界面代理作者审阅后进入候选/采纳；该修订阶段新增供应商调用0。冻结世界、旧 Build1 和 Run12 完整证据逐字节不变，完整备份已核对。

该结果证明有真实模型来源的正常制作、修订与本地发布路径；不能代表独立真人验收、素材商业权利、实际音轨采用或连续30轮游玩。新团局开局显示 Qwen 双声线与语速设置，仍默认隐藏为开发预览，未部署公开入口。

### 35.188 新运行请求按实际岗位收紧输出预留（2026-10-20，开发预览施工）

真实发布版本第一次提出行动时，战役运行上限2000被直接传给登记上限1200的意图 Skill，发送前校验拒绝，实际供应商请求0、Run候选0。修复只作用于本人桌面新意图/队友/KP请求与本轮已授权有限主持的新请求：按正式目的注册映射，取冻结战役上限与当前岗位登记上限的较小值，随后按既有合同冻结。更低的战役上限保持；已有 prepared/dispatched 请求继续使用原 Run 的冻结 Skill/预算，不重写或重发。整轮调用、token、金额、批准、候选与事实/时间结算门保持。

通过真实输入准备、派发、原文和候选链验证2000→1200与800→800，并在同一有限主持中验证三个KP请求2000、两个队友请求1200，保留三次实际规则结算和原授权边界。实际模型、浏览器路径与最终全量CI分别补证，不以内部传输fixture代替。

### 35.189 作者输入退稿后的只读恢复与额度说明（2026-10-20，开发预览施工）

普通作者修订因剩余确认项被退回时，原完整输入已经保存在当前失败 Run，却没有模型回答或原回答来源证明。制作台现在只从当前 Work/Build/Plan/epoch/Run/attempt 的准确终态证据重读该输入；不同稿冲突、范围变化、读取期间 Run 变化及有模型派发的路径拒绝回退。输入恢复只限来源事实与规则角色，不冒充模型输出、原回答来源证明、采纳或用量核对。重读的普通输入按原规则归零未经独立证明的事实/属性确认，作者重新逐项核对；原有带准确来源证明的作者稿继续按原证明规则读取。

同时将制作进度卡说明为模型、媒资调用、费用及存储的“额度占用”，明确包含已知用量与未确认请求预留，用于判断能否继续；不把预留显示成已发生的物理调用、已生成媒资或磁盘释放。投影、账本与旧费用不变。手动更新修订稿后清除旧载入错误，迟到返回仍保留当前稿并报告冲突。

验证以普通作者来源/角色退稿后冷重开数据库的只读恢复、原来源证明与未知/跨作用域反例，以及正常界面部分确认提交→退回→刷新→重读→再次确认→发布为准。后者仍只允许原三次明确模拟传输，新增作者恢复为零模型；真实模型、独立真人、权利及最终完整CI保持独立边界。

### 35.190 真实运行的输入预留反例与新请求估算（2026-10-20，开发预览施工）

准确0c99f468在原发布团局明确结束旧窗口后，另一条新行动实际收到完整回答，10206输入/375输出，价格未知；原输入预留8065不足，原文、实际用量与受阻候选完整保留，再经正常界面明确放弃。旧两条未知请求及其预留不变。随后正常手动规则经过风险确认、结算、时间与压力推进到worldTurn1，产生征兆；三个局势同时结束后无法满足继续条件，一次有限修复后停止，保留进度待审查。两者分别是输入估算与实际内容的反例，不代表连续游玩、真人或完整产品验收通过。

新请求复用已有跑团制作文本估算器，对完整JSON消息按保守字符权重计量并预留4096包装token，完整请求证据同时冻结估算版本。准备、事务发送前复验及原准备恢复使用同一方法；缺少provider用量时，新请求的估计值不提前释放这份保守输入预留。V1/V2裸消息数组、旧原文与无标记请求继续按原字节公式，旧已准备/发送/完成请求不补加新预算或重新计费。剩余窗口、共享咨询的准确冻结输入上限、原实际用量超限阻断、未知预留及禁止隐藏重发均保持；预留是近似保护，不能保证供应方实际用量。

新共同局势授权在原作品已设定的窗口总额度内，扣除本次输出与原2000余量后冻结输入上限，避免额外写死16000而拒绝仍有容量的完整JSON请求；不增加原窗口总量、调用次数或行动权限。旧命令重放与准备恢复仍使用原授权和Run上限。正常流程夹具在冻结作品前显式提供足够额度，原小预算拒绝与超限反例保留，不修改生产默认或旧压缩快照。历史v15工具兼容从真实前驱快照核对原版本/hash及合同，不从当前v20注册表删几个名称来伪造历史声明。

阻断候选展示原确定性阻断原因，便于区分预算与格式问题。对密集JSON的已知token回执、发送前无容量拒绝、真实超限仍受阻、版本篡改、旧预算与冷恢复分别验证，并继续核对共同事实、局势、队友和备份调用方。0c99的本地全量CI在尚未启动任何测试时撤下排队以修复真实反例，原退出143及零子进程证据保留；其他正在运行的验证不受影响，最终交付源码仍须完整CI。

0c99的远端开放预览批次实际为171通过、3失败、4跳过，失败日志、截图与trace已保留。Melo原生WAV夹具须明确选择Melo声线，不能拿旧profile冒充Qwen默认；无媒资V3修订须核对真实确定性Plan与零模型账本，不能沿用旧版“一次媒资模型”断言。作者审阅批次在首个HTTP请求前记录了Aborted，不能仅凭审阅壳出现视作模型已经返回；等待准确请求的断言保留，取消来源仍须复现调查。此前本地两条通过不能覆盖这批远端失败。为合并检查这些反例，135文件消费者批次亦在尚未获得执行槽、零测试子进程时明确撤下，退出143且源码无漂移；后续重新冻结、定向检查和完整CI分别留证，不停止其他正在运行的验证。


### 35.191 本机配音的客户端传输与精确资源交付（2026-10-20，开发候选）

本单元是共享分发底座的产品能力研发，承接跑团 P10 的 S3 媒资执行需求；不生产具体作品，不改冻结世界。Work/Production/Release/session 与原配音媒资 owner 不变；沿既有 `ttrpg.open.local-voice` Run、原文、读法、候选与采用链，不新增三注册表项、表、schema 或权限。共享底座独立集成，不能把开发服务可生成旁白等同于正式安装包可用。

原 `createPortableServer()` 只挂本机 Codex，Electron/便携包也未包含配音脚本；Vite 能运行不能证明安装版可用。现将原语音 bridge 懒加载到专用同源路由，和 Codex 各自持有中间件。未配置或初始化失败明确返回 JSON 不可用结果，普通编辑器仍可启动；严格 loopback、同源、自定义请求头保持。浏览器不能选择辅助程序路径，初始化不启动推理、不自动重试。服务退出沿原 bridge 停止其拥有的任务。

打包闭包从三个当前 profile 的 implementation.sources 派生并逐项核对 SHA-256，补足原实现读取的描述、登记证明、README 和许可。便携版保持精确相对路径；Electron 使用 resources/local-tts 的独立物理目录，使 Python 能访问 worker 及原完整实现核验文件。无需作者仓库、Git 或 npm；不复制运行库、模型、任务、浏览器数据或私人路径，不修改原 profile 来迁就漏打包。新旧生成与原任务查询/停止仍由既有版本规则区分。

定向工程检查使用独立复制目录及合成运行库，核对三声线描述、真实便携复制函数和 Electron 资源映射、未配置启动、同源/跨站拒绝、等待任务幂等、取消后不得重启及坏源码拒绝；模型调用为零。便携包 smoke 另用包内 Node 复核原 profile。固定运行库目前只在 macOS Apple Silicon 验证；安装后真实 Qwen 生成、听感与权利/采用、其他设备、完整 CI 和原 P1–P10 整体验收继续独立留证。本单元不宣布正式发行或公开 open 入口。


### 35.192 待开始新版本的 Work 运行预算修订（2026-10-20，开发候选）

本单元属于跑团 S2 产品能力研发。作者在已有运行设置控件修改本作品的六项额度或 AI 启用状态，沿原 Work 草稿 CAS 保存，再点击“生成或更新审查方案”。已有发布基线、尚未开始的同一 Production 演化 Brief 可形成新 revision；不再因已经存在旧 Build 就另建 Production。沿真实保存的 Settings revision 构建内容，保留已核对的规则、精确世界/SourcePlan、制作额度、发布基线和演化目标，实际运行预算变化追加 runtime 影响范围。正式开始仍是另一条作者命令。

只在当前待开始 Brief、准确 Release、已发布 Build 和同 Work/World 的完整谱系一致时修订；核对原 Brief/hash、原发布包/hash 与实际 provenance。预算允许项与现有可见控件一致：启用、调用数、AI 行动数、单次输出、授权总 tokens、费用、有限修复次数。其他内容、来源、规则和失败/未知结果语义不随预算请求改变；不兼容修改明确退回，作者已保存的配置保留。旧发布包、旧 Build、历史 Brief/Run、原回答、费用与团局不重写，不增加 AI 读取源、AI 可写字段、表、schema 或模型调用。

在同一只读数据库事务核对草稿、Production、Brief 与 Build，来源准备前捕获原 stateRevision 与 Brief parent，保存复用时使用原 CAS 基础；已开始的 open 初轮明确退回，不静默另建 Production；并发作者开始不能把较新状态借作本次保存权限。原未开始首轮方案同样使用捕获状态。来源、规则及 Work 草稿仍执行原有 stale 核对，保存后才更新草稿 preparedRevision；保存失败不自动创建另一个制作意图或开始新轮次。

回归覆盖正常保存到同 Production、真实 Settings revision、六项可见额度、原规则与 SourcePlan、独立开始、旧记录保持、其他配置拒绝、跨 owner/坏基线/换源，以及发布后待开始和首轮方案的并发开始反例。新增隔离浏览器用例通过正常 S2 保存/更新、刷新、核对与独立开始验证准确 Brief 绑定；其开始后的传输为明确失败夹具，只证明预算与启动边界，不代表新一轮生产、真实模型或真人游戏通过。当前仅语法、架构与 AI 文档检查通过，定向回归、浏览器和最终完整 CI 另行留证。


### 35.193 执行器入口取消的确定零调用证据（2026-10-20，共享基础候选）

本单元修复现有共享制作执行器的 S3 用量记账边界；跑团及其他仍使用该执行器的产品沿原 owner、Run、BudgetLedger 和生命周期，不增加表、schema、AI 上下文源或可写字段。调度器可能已经记录逻辑 requested 边界，而执行器入口发现原信号已取消，此时尚未进入本次任务的模型或媒资发送。该入口原本只抛 AbortError，调度器因缺少确定用量而保留未知占用。

现在仅在执行器第一条取消分支附上原调度器已支持的不可变 productProductionUsage 零调用/零 tokens/零媒资/零费用证据，保持原 AbortError 分类和停止行为。进入执行器后发生的错误不经过该分支；已经发送、结果未知、超时、旧用量和历史回执沿原规则保留，不因取消名称或缺少浏览器请求被改写为零。没有新增自动重试、恢复授权或免费结论。

工程用例使用隔离 IndexedDB 与现有真实调度器/执行器，在逻辑 requested 后、执行器入口前明确取消，核对唯一失败 attempt、确定零用量及零传输；反例在传输函数已进入后抛取消，继续保留未知占用，并核对另一 Work 的零调用取消不修改先前未知 Run、账本和原资料。这些夹具没有实际供应商调用，不证明真实生产或作者审查页异常取消的原因已修复；原取消调用栈诊断与完整产品验收继续独立执行。


### 35.194 制作向导异步加载的取消边界与阶段核对（2026-10-21，开发候选）

本单元属于跑团 S2/S3 制作界面的产品能力修复。制作台继续拥有原任务控制器；世界版本、作品、Brief、Build、Run、媒资 owner 与发布交接物不变，不增加上下文源、AI 写入字段、数据表或迁移。原作者审查回归在首个夹具 HTTP 发送前取消；隔离浏览器诊断捕获到制作台 effect 被断开时发送 `product-production-studio-unmounted`，随后传递到任务执行器。该调用栈证明取消来源，截断栈本身不用于断言所有 React 内部调度原因。

`TtrpgProductionWizard` 是制作台中缺少局部加载边界的 lazy 子组件。为向导与其关联的规则确认控件增加同一个局部 Suspense，使向导加载局限于自己的区域，避免把保管在途任务的制作台交给外层 Suspense 隐藏。真正退出时的控制器清理、作者暂停/停止、预算和未知结果处理保持原语义，不通过移除取消或增加重发来绕过故障。

原作者审查浏览器用例未经修改即可通过：三次夹具请求、三个显式作者修订、刷新后的输入恢复、编译及原子发布均按原断言验证，零 skip、零 retry、零 flaky，源文件指纹无漂移。该证据为隔离 IndexedDB 与 HTTP 夹具的工程结果，不代表真人体验或真实供应商质量通过。证据为 `author-review-local-loading-boundary-v2.json`；第一次验证配置未找到用例的记录单独保留，不计为产品测试。

截至本次核对，§35.191 的客户端检查/类型/构建已通过；§35.192 的 108 项定向回归、1 项正常 S2 浏览器用例和构建已通过；§35.193 的 244 项定向回归、类型与构建已通过，分别绑定各自冻结源码。§35.190 的后续运行预算批次仍有 49 项失败，尚未收口。以上均不代表最终当前提交的完整 CI 通过。原 P1–P10 目标仍未完成：正常作者新版本的局势条件修订、真实短局合作与收束、30+ worldTurn、安装后本机配音及完整分发、旧数据兼容、最终文档/WPS 同步与交付仍须分别完成。


### 35.195 共同局势授权的冻结预算准入与开局试听核对（2026-10-21，开发候选）

本单元继续跑团 S3 产品能力研发，沿用原共同局势命令、原本地 Run、共享输入工件、epoch 与账本；不增加世界写回、表、schema、AI 读源或可写字段。§35.190 的后续 49 项失败定位到正式命令入口遗留的固定 16000 输入上限，与准备授权时使用的冻结总额度不一致。入口改为读取同一发行包的窗口预算，校验输入与输出之和不超过原总 tokens、输出不超过原单次上限、费用不超过原窗口上限；同一已核对预算用于创建 epoch。作者设置、一次调用约束和历史授权/原包字节不变，不以放宽作品额度通过回归。

新反例分别替换输入总额、输出上限与费用上限，要求在提交窗口和预留调用之前拒绝，保留唯一未发送 Run 的失败证据且不创建 model.requested。首批两个预算文件与三个共享制作 UI 文件合计 55 项已通过；完整相关批次、最终类型/构建和完整 CI 另行留证。

进一步读取真实 UI 后确认，旁白试听组件已在玩家身份确认与开始冒险之前渲染，真人主持开团前也使用同一浏览器偏好；先前仅按调用组件名称推测缺少开局入口并不充分。此次补足验证：从未完成 Session Zero、未授权且无 openRun 的隔离团局开始，试听实际男/女声文件、调整语速、刷新与跨标签切换不得改变团局或发送推理；随后由用户分别确认身份和开团，核对原选择沿用且不自动播放。不新增第二套设置或把试听视为游戏授权、音轨采用和真人验收；安装后真实生成与长局验收仍独立进行。


### 35.196 预算/开局验证结果与真实待开始方案（2026-10-21，开发候选）

§35.195 的当前源码已通过架构、表、AI 文档与入口登记、TypeScript、34 个文件的 239 项定向回归、3 项隔离浏览器用例、构建与 diff 检查，源码指纹无漂移。浏览器覆盖未开团试听/选择后独立开始、发布后待开始的预算保存/刷新/独立开始，以及原作者三次请求审查与原子发布，均零跳过、零重试、零 flaky。原 49 项预算失败已在该相关批次消除；最终提交的完整 CI 与整体验收继续独立留证。

真实作者示例也通过正常 S2 页面将原待开始演化方案保存为 Brief revision 4，仍属同一 Production、原 Release 1 与原 SourcePlan。新运行 token 总额为 200000，原 6 次调用、2 次 AI 行动、2000 单次输出和费用上限 1 保持原值；没有创建新 Build、开始制作或发送模型调用。实际 Settings 来源 revision 11，保存 prepared 状态后 Work 草稿 revision/preparedRevision 为 12，沿原准备流程递增，不以草稿后续计数替换 Brief 的真实来源版本。

已用原始行、完整回放/Run 快照、原历史 Brief 与发布包的导出字节及新完整备份核对旧记录保持；旧团局仍在原 sequence 54/worldTurn 1。回读使用与备份一致的 JSON 序列化边界，并按 revision 对齐历史行，导出时间戳仅作为非持久化导出元数据处理。失败的只读检查与原备份均保留；未通过重存设置或重建方案处理检查器假设。当前恢复点为 `real-author-pending-budget-v23-receipt.json` 及其 final-state，最新备份沿该回执准确路径读取。六项局势条件的作者修订尚未进入新 Build 或新发行包。

旧远程 0c99 全仓测试另有两个失败：公开来源 v15 哈希校验与语音评测测试的全局正式入口数量断言。前者保留原哈希字节后已在上述相关批次通过；后者改为核对移除有限传输前后正式入口逐项完全相同、评测 ID 不在正式入口中，原伪造权限/调用方/绑定反例保留，不把其他正式入口的合法增加当作评测扩权。此项修订的检查及最新提交全量 CI 另行留证，不以旧远程结果替代。

语音评测权限反例共 11 项及最终 TypeScript、文档/路线图检查已通过；项目实时事实由官方 `gen:project-metrics` 重建后核对通过。另按旧远程全仓 6980 项实际耗时 14603.45 秒修正可选交付工作流：仅 CLI job 总时限由 150 分钟调整为 360 分钟，保留原完整命令、逐项测试超时、覆盖率门槛与浏览器 job 时限。该共享 CI 配置作为独立基础提交交付，结果仍须以新 head 的实际完成记录裁决。

### 35.197 作者返修核对与原始输入快照（2026-10-21，开发候选）

本单元修复跑团 S3 已采用原稿的返修提交，属于产品能力研发；沿用原 Work、Production、Build、候选与发布 owner，只读冻结世界，不新增模型调用、表、字段注册或迁移。真实作者界面中，末尾带换行的 JSON 能通过影响预览，但提交时没有效果：命令解析器按原契约去除首尾空白并规范化 NFC，界面却把规范化命令与原始输入直接比较。

核对时现保存原始稿件、说明和所选原稿的内存快照；提交只用该快照判断作者是否修改过已核对输入，后端继续验证原规范化命令、hash、owner、状态版本、影响范围与授权。任何输入修改（包括仅新增换行）仍须重新核对；不裁剪编辑器原稿，不绕过上游版本变化或未知用量阻断，不重发模型请求。回归使用真实命令解析器，覆盖粘贴换行、说明首尾空白、分解 Unicode、修改后重新核对以及原返回中断/重复点击/切换 Work 等保护；相关 4 个文件 27 项通过。该结果仍须与真实界面复验、最终提交完整 CI 和产品整体验收分别留证。

随后在原隔离作者记录的 Brief r4 / Build #3 通过正常界面复验：原样粘贴带末尾换行的六处局势条件修订，提交后继续执行且没有新增模型调用。编译器先正确拦截原稿中的旧运行预算；作者另行核对并仅将该预算与已确认 Brief r4 对齐，再经过 6/6 制作步骤、原子发布和刷新，得到本地 ProductRelease v2。实际发布包已核对六处条件及运行预算；旧 Build #1/#2、Release v1、原团局、旧模型原文/事件/checkpoint 均保留，旧稿仅追加失效状态而未改写内容。架构、表、AI 登记、文档、lint、TypeScript、构建与 diff 已通过；这份作者路径证据不代替真人短局、30+ worldTurn、安装配音或最终提交完整 CI。

### 35.198 客户端检出字节与 Mac 编译内存（2026-10-21，共享分发候选）

本单元修复共享分发底座对 P10 本机配音资源的交付，不改变作品、团局、世界、媒资 owner、运行配置或模型权限。实际 Windows CI 在资源闭包校验处失败；只读模拟 `core.autocrlf=true` 的 Git 检出过滤确认，13 个已固定实现文件均会被转换为 CRLF 而与原 SHA-256 不符。现仅为这 13 个文件登记 LF 检出，保留原批处理脚本 CRLF 约定、模型 profile/pin 与运行时逐字节校验，不规范化哈希输入或接受多个摘要来放宽保护。

同一提交的两种 Mac 客户端构建均在 `tsc -b` 记录了 V8 heap out of memory；仅当前 Mac 编译步骤设置 4096 MiB Node 堆上限，安装、启动和运行进程不继承这一步骤级设置。Git 过滤后的精确字节、分发/客户端检查与最终提交的真实跨平台构建分别留证；该修复不证明 Windows 有本地 MLX 运行库、安装后配音已生成或完整产品已验收。

本地复验确认 13 个文件在 Windows Git 过滤后均与原摘要相同，批处理脚本仍为 CRLF；原客户端命令的 17 项 Node 检查、5 个文件 19 项客户端回归均通过，零跳过、零取消。架构、表、AI 登记、文档、路线图、生成指标与 diff 检查通过；此前通过类型、lint、构建和真实作者界面验证的全部应用/测试/构建输入保持相同。新提交的真实跨平台 CI 与完整交付 CI 仍待完成。

### 35.199 发布版本的真实自由行动与澄清缺口（2026-10-21，继续施工）

以 §35.197 的实际本地 Release v2 正常开新团，旧 Release v1 / 团局 #1 保持原样。开团前选择 Serena 与 0.85 倍语速并刷新，选择保留；身份确认、开团和上述设置均未发送模型请求。新团通过正式模型与原候选链完成自由行动解析、风险确认、确定性结算和 KP 叙述采用，推进到 worldTurn 1。重复点击继续结算时，整个持久状态不变；三条局势仍为 active，不再在第一轮提前全部结束。

本轮实际调用意图、KP、第一位 AI 队友三个岗位，均保存了原请求、原文与供应商用量并按原 owner 回读一致；费用未回传，不能据此记为免费或清除预留。队友提出护援，但 `method=null` 且未确定目标；这是意图提示词允许、路由器明确识别的 needs-clarification。当前桌面仍给出普通确认按钮，随后规则操作入口抛出需要澄清/其他裁定 owner 的错误，没有提供可继续的澄清流程。原候选和预算保留，本轮有限主持在无在途调用时停止，团局停在这一可恢复审查点。

后续必须补齐正式澄清路径，不能只改提示词强迫模型填写方法、篡改原候选/hash、把缺目标当作现有规则行动，或丢弃原回复后隐藏重发。沿同一团局、冻结发布版本与原 epoch 处理原线程，明确 AI 行动者与真人批准者；同线程追问不超过三次，澄清本身不掷骰、不扣角色资源、不推进世界时间。复用原注册上下文、候选/人工决定、durable run 和命令回执；若需要新模型请求，必须计入原剩余额度并冻结真实输入。澄清后的规则、Oracle、无检定互动仍分别由对应 owner 复验，不得用这一条规则路径宣称六路全部完成。该真实路径仅证明上述局部行为，完整合作短局、30+ worldTurn、真人体验和安装配音继续独立验收。

### 35.200 原候选的人工澄清与明确确认（2026-10-21，原团局复验待完成）

本单元属于跑团产品研发，落在 S3 团局运行；原冻结世界、ProductRelease、作者内容与媒资 owner 不变。桌面识别含糊意图，提供双方可见的冻结规则、目标、后果参数及线索路径；真人明确补充行动说明和期望结果后，单独保存 `ttrpg.open.intent.clarified` 回执。每次记录绑定原候选、线程、AI 行动者、真人批准者、窗口与完整规则请求，最多三次；比较原次数防止并发覆盖，命令回执支持重复提交。原模型输出、用量和费用预留不改写，不新增模型请求。

保存补充后展示已保存的内容；执行必须携带准确的当前澄清哈希，编辑时不能确认未保存版本。风险批准和实际结算继续走原 operation，不由澄清代替；隐私目标、其他身份、旧版本、暂停、已采用候选及第四次补充均拒绝。数据沿既有事件、快照、备份和分支祖先证据保存，无新增表、schema、AI 写入字段或上下文权限；旧记录不存在的新字段不自动补空值，保留旧哈希形状。

原规则请求和线索请求解析器逐字迁入纯契约模块，旧导出入口及校验语义保留；回放不能静态加载模型或生产读取器。基础机械模块独立成包，各层依赖继续由实际静态闭包检查，沿用原体积预算。172 项相关回归已经通过，包含身份隔离、三次上限、重复确认、保存失败后重试、纯回放、备份导入及分支恢复；打包调整后的四项依赖闭包检查、构建和体积检查也通过。原待处理队友候选的正常界面接续仍须实际验证，本条不代表 Oracle 全路径、完整合作短局、30+ worldTurn、真人或安装配音验收完成。

### 35.201 原团局的实际澄清接续与风险审查缺口（2026-10-21，继续施工）

实际接续先发现：已选择线索路径的后果模板即使没有参数，也必须提交该模板的空绑定记录。界面此前只从参数生成绑定，遗漏空模板；内核正确拒绝，原团局、候选和费用记录全部不变。现按冻结目录完整生成规则及线索模板绑定，不放宽完整性校验；新增无参数规则与线索两类回归，并通过 19 项相关检查及架构、表、AI 登记、文档、lint、类型、构建和原体积预算。

随后在同一实际 Release v2 / 团局 #2，使用原队友回复明确保存人工补充，选择调查与已共同可见的线索路径。刷新后补充次数、内容、完整规则请求和哈希仍一致；普通确认沿原候选进入待风险批准的 operation。原真人行动、旧团局、11 类作者/原始模型证据表和全部原运行事件保持一致，仅追加澄清与正式行动开始两个事件。未新增模型请求，尚未掷骰、扣角色资源或推进世界时间；这段受控复验不等于独立真人体验。

当前真实待批准行动又暴露出显示与授权的缺口：玩家风险投影将 AI 行动者及失败前进后果遮蔽为待主持审查，两名有权确认角色的批准按钮均禁用，但该玩家桌面没有此阶段可用的有限审查入口。必须沿原计划、风险哈希和原批准席位补齐合规告知/审查，保留保密裁定与角色秘密边界；不能用直接命令绕过界面审查、把整份 GM 资料交给玩家、撤销真实行动后另造成功用例，或把此处称为队友已完成协作。原待批准状态和备份保留，后续从这里继续。

### 35.202 本桌身份与知识授予风险显示、原队友接续（2026-10-21，继续施工）

§35.201 的风险缺口经核对分为两项显示遗漏：开团与席位页已公开选中角色的名称，风险投影却只识别实体可见性，因而把队友自己承受的数值/状态代价遮蔽；知识授予也没有可用的人类后果描述。现仅复用已公开的冻结角色名称，并显示线索授予的对象与类别；不读取或展示线索身份、正文、角色档案、位置、库存、私密理由与保密骰点。GM 专用模板及未知后果仍阻断盲批，未新增表、事件、AI 权限或既有计划/风险哈希字段。32 项风险、隐私、逐角色批准、保密选择、澄清与回放检查，以及架构、表、AI 登记、文档、lint、类型、构建和原体积预算均通过。

同一实际 Release v2 / 团局 #2 沿原待批准行动，由原真人批准席位分别确认两名受影响角色，再完成规则、知识、时间、压力、局势、质量门及 KP 叙述采用和交接，推进到 worldTurn 2。原候选、人工澄清、计划和风险哈希未替换；重复继续时整个持久状态一致，旧团局、原真人行动和作者来源保持原样，原事件、模型原文与 checkpoint 全部保留。新的 KP 岗位与第二名队友岗位各请求一次，原 owner、原文和用量均回读一致，费用未知仍保留为未知；不把原文来源验证称为独立真人体验。

第二名队友明确选择调查自身当前的集市，语义候选保存了准确地点引用；确认时语义入口把它直接当作机械目标，触发原规则对场景行动必须使用当前场景范围的拒绝。原第二份队友回复和预算保留，失败前后进度一致，尚未创建第三个行动。下一步在语义到规则的适配层核对并规范化准确当前场景；其他地点、角色和多目标不得被静默丢弃，原内核目标校验不放宽。另须审查已记录的明确规则方法被目标文字抢占问题。当前 KP 原回复仅一句未公开结果说明，其叙事体验也尚未验收；完整两队友短局、30+ worldTurn、语义 Run 终态闭合、安装配音与最终交付仍待完成。

### 35.203 原语义地点与当前场景规则的无损适配（2026-10-21，开发候选）

沿 §35.202 原第二名队友的确切回复修复 S3 会话适配层。普通候选与人工补充复用同一目标解析：冻结规则为场景行动时，空引用沿用旧请求；唯一地点引用必须准确等于行动者当前机械位置，才转换为内核要求的空机械目标，并在原行动证据或人工澄清中保留 `sceneScope`。其他地点、角色、未知或多目标均不能通过删除引用执行；无效场景候选提供同一有界人工澄清入口。明确地点的人工补充还须在双方可识别范围内。

场景证据绑定原候选、原请求与规则，纯回放在澄清和行动开始事件检查实际位置，队友预授权另核对原语义范围与已冻结计划。后续合法位置变化不反向否定历史证据。旧纯路由、规则内核的场景目标校验、旧无可选字段的记录形状及风险批准保持；不新增模型调用、上下文权限、正式 AI 可写字段、表或 schema。范围通过现有事件、快照、备份和分支来源保留。

15 个相关文件的 100 项回归通过，覆盖原地点保留、未批准不结算、目标错误拒绝、人工补充、事件位置校验、完整回放、备份导入、队友预授权与旧分支恢复。架构、表、AI 登记、来源、文档、lint、类型、构建、原体积预算和 diff 检查通过。一次同批旧恢复用例超时后单独复跑通过，最终相关批次零失败；全部原报告保留，最终完整 CI 仍独立留证。

同一实际 Release v2 / 团局 #2 的原第二位队友候选经正常桌面确认，先保存准确地点范围，再由原批准席位明确确认该角色风险；两个步骤均未结算或调用模型。随后原规则、时间、压力、局势及质量门结算至 worldTurn 3，重复继续时整个持久状态一致。沿本轮最后一次模型额度取得并核对原 KP 回复后，采用叙述、完成交接并明确关闭原 epoch；刷新后整个持久状态一致，完整备份已保存。旧团局、前两次已完成行动、原五次调用的原文/用量/预留、作者七类来源表及所有原事件/工件/checkpoint 均保持，当前源码和浏览器验证进程已正常收尾。

该接续证明原三次行动可完成，不等于完整短局体验通过。实际 KP 仍仅返回笼统的未公开结果说明，须改善共同可见资料的可用表达，不能补入私有线索。原三个语义 Run 在行动完成和 epoch 关闭后仍为 awaiting_confirmation，需先核对原 Run 合同与终态衔接；明确规则方法被目标文字抢占的问题也仍保留。完整阶段收束、30+ worldTurn、独立真人体验、安装配音、最终 CI/WPS 与交付均未完成。

### 35.204 原意图提案的生成终态与明确回执恢复（2026-10-21，开发候选）

核对原意图/队友 Run 合同，其目标是提出单角色行动候选，不拥有规则、资源、时间或世界事实的写入权。现沿同一 S3 会话准入，在实际 operation.started 提交后补齐生成任务的采用和终验事件；该终态只证明提案已进入独立风险审查。风险批准、拒绝、实际结算及主持交接继续由原 operation 拥有，不因生成任务结束而自动执行。

复用既有 Instance-owned runtime adoption finalizer、事件锁、有限 CAS、验证工件和终态 receipt。先验证同一 scope/session/request/Run/candidate/raw/manifest/actor/epoch，核对真实准入事件与原冻结计划、完整人工补充哈希及有限委托；回放至准入之前核对原机械状态，再派生准入后的准确状态及采用哈希。不改原合同、不新建模型、不直接改 Run 状态、不新增表、schema、AI 读源或写权限。

域事件已保存但终验写入中断时，正常桌面显示对应角色的待补齐提案回执。明确补齐只恢复同一已发生准入；不重开已关闭窗口，不解除安全暂停，不新增批准、后果、时间或用量。部分 Run 事件已写入时继续原有限状态机，重复恢复不重复确认、采用或工件。只有原当前真人和原本地 owner 可恢复；导入候选继续只读，子分支保留祖先原证据而不克隆或采用祖先活动模型请求。源码回归、真实三个旧 Run 的界面接续及最终完整 CI 分别留证，不能视为完整短局或长局已通过。

本单元准确源码通过 18 个文件的 131 项相关回归及架构、表、AI 登记、来源、文档、lint、类型、构建、原体积预算和 diff 检查。实际原团局在已关闭 epoch 的 sequence 120/worldTurn 3，通过原玩家桌面分别补齐 Run 87/89/91，三者均取得可复算的终态回执；未发送模型。整个运行状态、事件、原调用用量/费用、旧团局及作者七类来源表保持，所有原工件、事件和 checkpoint 保留。刷新后持久状态一致，完整备份已保存，浏览器与验证服务正常关闭；终验工件逐一核对原合同、候选、原准入事件与实际 context.assembled manifest。便携备份的重映射合同不与本机原合同混为同一哈希，输入证据 manifest 也不冒充 assembled-context manifest。

已另行只读核对实际 KP 请求：交付的当前行动资料只有未公开结果及耗时，行动者为空，共同角色列表为空，也没有本次实际规则行动的明确身份。真实回复连续给出笼统说明，叙述体验仍未通过。下一步复用已公开的选中角色身份和共同可读的冻结规则补足合法表达依据，继续排除角色私档、私有线索、保密骰点与未共同获知的意图；原模型回复、manifest 和调用记录保留。原 P1–P10、完整阶段收束、30+ worldTurn、独立真人、安装配音、最终 CI/WPS 和交付继续开放。
