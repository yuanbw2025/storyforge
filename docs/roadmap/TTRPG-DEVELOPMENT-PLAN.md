# 跑团开发与施工方案

> 现行版本：2.1.0 · 生效：2026-10-12 · 权威层级：L2
> 唯一仓库入口：`docs/roadmap/TTRPG-DEVELOPMENT-PLAN.md`
> 对应产品：`ttrpg` · 契约：`docs/products/TTRPG-AI-KP.md` 1.1.0
> 修订基线：`origin/main@f93a01e35788cd59a46db1ce0cd518f92b5c60d8`；执行者开工时须重新 fetch 并核对漂移。
> 状态：设计与施工契约；本次没有实现 `open` 功能，没有增加表、运行事件或模型调用。`E-TTRPG-OPEN-01/02` 仍为 `missing`。
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

### 23.4 已核对状态与验证范围

- 当前 schema 为 **v11**，`STORYFORGE_STORES_V10` 已固定，v11 包含插件扩展表；备份/导出当前版本为 v15（来源 `src/lib/export/backup-trust.ts`、`registry-export.ts`）。原稿 v10/123 表及 P8 的 10→11 已过期。本轮不改变 schema 或备份版本。
- 当前 6 个跑团运行读源为 `ttrpgRuntime`、`ttrpgPrivateGuidance`、`ttrpgDirector`、`ttrpgPublicNarration`、`ttrpgNpcRuntime`、`ttrpgPlayerRuntime`；新源必须正式登记，不能因为文档出现名称就读取。
- 《雾港：最后一盏灯》是已有 scripted 验证作品，记录见 `examples/ttrpg/fog-harbor/production-status.md`；已有真实生成/作者修订与 UI 试玩证据不等于独立玩家验收或公共多人服务。
- 2026-10-12 评审复跑既有跑团及 Creator SDK/Harness 回归：23 文件、80 项全通过；当时检出分支的上述跑团文件与 fetched `origin/main@f93a01e3` 一致。这是旧能力回归基线，**不是 open 验收**，没有在本轮重新运行真实 provider/真人长局/全量 CI/E2E。
- 当前没有本方案 `openRun`、`worldTurn`、Oracle、会话事实门与 `R-TTRPGOPEN*` 实现。不得因文档合入修改为 implemented/partial。

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
