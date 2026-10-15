# AVG 工作包开工卡

> L2 · 版本：1.9.0 · 生效：2026-10-15 · 产品：AVG/Galgame · 上位条目：E-AVG-01。
> [产品契约](../products/AVG.md)裁决边界，[实施计划](AVG-IMPLEMENTATION-PLAN.md)裁决顺序。AVG-00 已设计交付，AVG-BASE-00A/00B 已分支验收，当前按作者指令先做系统/表现框架，02A1 确定性内核施工中，专业剧情生产后置；详见实施计划的当前状态。

## 0 所有代码包的共同交付约束

每包开工前更新真实基线/调用闭包和范围；按产品能力研发与作品生产分别记账。S2 定向 owner 为 AVG Work；S3 生产 owner 为同 Work 的 production/工件/产品媒资；正式会话只读冻结 ProductRelease，运行状态/私域归该 AVG 实例，不回写世界。

复用 Context Gateway、`CONTEXT_SOURCES`、`FIELD_REGISTRY/AdoptionSchema/adopt()`、`PROJECT_TABLES`、durable Harness、Production/Build/Release、Blob、session/events/checkpoint。表/字段没有增量也明确记录“复用”；不能用同一表为理由开放任意 schema/Skill 写域。

代码包至少完成定向测试、`check:architecture`、`check:required-tables`、`check:ai-manual`、TypeScript、build，交付单元运行 ci；真实 UI/API、数据生命周期/跨线在隔离浏览器数据跑 E2E。仅文档包不扩大为这些产品检查。每包提交前 diff/check，最终 head 的证据进入 PR；真实模型/图片/音频、人类和分发证据独立记录。

下列卡中的 target 类型/事件/源名称由 L3 实施登记，当前不是已存在符号。每包具有 bounded repair、原始响应/失败/unknown、stale 和刷新恢复；锁定不能覆盖版本失效。新正式入口取代旧入口时同时收口，旧 release 读取保留。

本文件保留原产品分组，新增两个校准组；计划列出 24 个施工/验证节点，近期领取增量，后置 optional/渠道/规模按冻结范围再展开明细。分组的共同读写/生命周期规则由子单元继承，子单元有各自依赖、输出与完成门；聚合包只有全部承诺子单元通过才完成。导演不再混在最早规则骨架中，最终剧本不再作为骨架前置。

| 施工范围 | 必须有的负责单元 | 首戏范围/后置条件 |
|---|---|---|
| 作者定向、来源与规范主体 | AVG-BASE-00B, AVG-01A | S2/开始/预算/设备/语言/视角均冻结，不需要先有最终剧本 |
| 故事、路线、正式规则与分场 | AVG-01A, AVG-02A1, AVG-01B | 本轮先骨架与固定文本验证；专业故事/分场后置，返修仍需新 revision |
| 舞台/导演与联合编译 | AVG-02A2 | 声明式能力与实际消费；不要求完整自动媒资工厂 |
| 对话、声音、存档、偏好与资源 | AVG-03A | 完整单会话与授权音频即可；性能、失败和真正恢复必验 |
| 物件/知识/消费 | AVG-02B1 | 第一批完整模块，不混装所有 optional 系统 |
| 热点/话题/消息/档案/辅助 | AVG-02B2 | 每个启用模块独立交付；未选者不阻塞首戏 |
| 作品跨周目进度/鉴赏 | AVG-03B + 所选 AVG-02B2 | 独立生命周期门，不能混入当前知识 |
| 实际参考/配音与制作岗位 | AVG-BASE-01/02, AVG-04A/B | 分项真实校准后扩大；导入/人工加工仍经统一采用，不冒充自动生成 |
| 编辑/问题/跨线返修 | AVG-05A/B | A 支撑第一场组装，B 用实际问题补全完整工作台 |
| 参照/成本/生成效果 | AVG-CAL-00/01, AVG-PILOT-01A/B, AVG-06 | 可用、可交付和接近商业参照分别取证 |
| 语言/设备/离线分发 | AVG-BASE-00B, AVG-03A, AVG-07 | 首批中文/冻结画幅设备；新增语言/平台要额外 typed 内容/配音/安装验证 |
| 第二配置/规模与高级表现 | 前包换来源/关闭模块探针 + AVG-08 | 小探针提前，大规模/高级模块依实测后置 |

## 1 AVG-00 · 正式设计与工作包

- **状态/生命周期**：本轮设计交付；产品研发，无 production/付费调用/玩家状态写入。
- **交付**：AVG.md、四份生产/系统/媒资/验收规格、目录及本计划/卡；权威、产品目录、能力基线和上下文路由一致。
- **注册表/数据**：只描述未来接缝；不新增物理表、AI Skill 或 schema migration。文档检查器只追加精确路径，不降低规则。
- **验收**：文档权威、本地链接/表格、唯一岗位/写域、工作包/依赖无环、代码路径和设计/当前状态边界；工作树只有设计/路由改动。
- **交接/非范围**：commit/PR 交付设计；产品继续 partial，不宣称自动生成、完整商业场景观察或可玩首戏已完成。

## 2 AVG-BASE-00 · 版本化承载与工件基础

- **状态/前置**：聚合包的 00A/00B 均已分支工程验收。00A code `7738a7e0` / PR #137；00B 协议 `274ccf84`、采用 `29371705` / PR #140，最终树 `aa44eae6` 完整 CI 794 文件 / 4,383 测试通过，定向 72 测试及隔离 AVG E2E 6 条通过。限定输出为私有协议和作者输入候选/正式采用/修订/恢复，专业 AI、实际规则/演出和 V2 运行留给各后续包；不表示已合并上线。产品研发，影响 S2/S3 的版本接缝；公共承载独立基础提交串行集成。

| 单元/前置 | 限定输出 | 独立完成门 |
|---|---|---|
| AVG-BASE-00A / AVG-00 | 公共 Package/Preview/Release Manifest V2、hash/嵌套来源/导入分派；AVG schema 尚未接入时拒绝未知模块 | V1 字节/hash 不变，两条真实调用链 codec/序列化/篡改/未知版本正反例；不要求未来玩家或新玩法已运行 |
| AVG-BASE-00B / AVG-BASE-00A | AVG Settings/Module/Presentation/Binding、最小专业工件 schema/key 与 typed adoption/消费者目录 | 只采用支持的候选，跨 Work/非法写域/stale 拒绝；备份 remap/缺省；未实现模块不能发布为可用 |
- **入口/闭包**：`authoring-contract.ts` 的 S2 parser → AVG requirement/adapter → typed artifact adoption → `runtime-package.ts/preview-manifest.ts` → AVG compiler/validator → release/preview/player。先核对严格 key/hash 和所有 caller。
- **交付**：Settings V2；AVG Module V1、Presentation V2、Binding V1；Package/Preview/Release Manifest V2 分派及嵌套导入/运行来源 codec；专业工件 schema/key/依赖及 consumer domain 的闭集；typed 采用与实际 hash 规则。实际共同需求来自 Build Preview 与 ProductRelease 冻结/运行，两条调用链分别验证，AVG 语义仍在产品 adapter。
- **读取/候选/正式写**：复用已冻结 Brief/SourcePlan/manifest；LLM 不增加调用。新 validator 限定 `productBuildArtifacts.payloadJson/metadataJson` schema/输出 key，采用服务写正式 revision，不接受 AI 自报版本/hash。
- **表/生命周期**：复用 avgAuthoringDrafts、production/build/artifact/release；仅版本扩展。登记 schema/导出导入兼容；若新增字段/索引必须通过注册表/迁移正反例，不以 JSON 免治理。
- **兼容**：V1 设置/包/preview/release/save 原字节/hash 仍可读；V2 不强制其他产品升级。新 manifest/导出/运行来源一起验证，拒绝包 V2 嵌入只能读 V1 的 envelope。runtime 只携带 portable key/版本/hash，不含 DB/Build/Release id 或凭据；V1→V2 草稿显式转换保留无声默认，未知版本/模块失败关闭。
- **正反例**：合法 V1/V2、导入 remap/备份往返；拒绝重复 key、非法 consumer、跨 Work、未知 module/version、篡改 hash、无法解析的旧包。其他实际包调用方回归，原 V1 媒资不被 orphan 新规则误拒。
- **完成/非范围**：A 只验公共承载，B 验 AVG 采用/序列化接缝；V2 的新玩法/播放器首次可玩由 02A2 + 03A 验收，不把该未来结果作为 A/B 的循环前置。typed fixture 不证明专业生成/物品 UI/真实配音；旧档/hash 反例失败先停。

## 3 AVG-BASE-01 · 实际参考与媒体传输

- **状态/前置**：按需排队；00A/00B 已分支验收。原 BASE-01 基线准备复用于系统优先分支，当前尚无新媒体实现/真实生成；参考传输不阻塞合法导入和播放器。S3 产品媒资输入/候选 owner 不变。
- **入口/闭包**：`product-media.ts/media-contracts.ts` → `media-adapters.ts/media-transport.ts` → Harness receipt → `media-blob-store.ts/artifact-store.ts` → adoption/binding。读取合法参考 Blob 和冻结媒体需求，不重读整个世界。
- **交付**：请求 V2 的 ReferenceInput、purpose/mask/crop、能力快照/费用上界、真实参考字节 hash/处理版本、async 查询/结果未知策略与 bounded attempt。共享升级须证明 AVG + 至少另一真实调用方需求，否则 AVG adapter 扩展。
- **注册表/采用**：参考/数据政策走登记 Context 投影；需求 metadata 与真实候选沿现行写口，权利/传输/hash 为系统证据；不新增第二素材库。
- **兼容/生命周期**：V1 无参考请求仍合法；原始/加工候选和 lineage 分离，导出只带正式必要 Blob，不带第三方参考/凭据；拒绝跨 owner/未授权参考。
- **正反例**：参考实际送入且 receipt 匹配；provider 不支持 purpose、错 MIME/hash/上限、丢参考、余额/4xx、刷新时未知 operation 不能二次收费。mock 只能验证技术路径；真实 smoke 必须另记实际路由/授权/成本。
- **非范围/停止**：不保证家族艺术一致性、不自动批量生成立绘，不选择未经实测的默认供应商；若设置了现金硬上限却无法验证，或无法验证引用权利/operation 状态时，停止对应调用；本次首轮作者未设现金/工时总上限，仍按有限批次记录费用及 unknown。

## 4 AVG-BASE-02 · voice 候选与传输合同

- **状态/前置**：QUEUED；BASE-01。S3 音频 owner 留在 AVG。
- **入口/闭包**：定稿 line/voice-plan → 媒体 gateway/能力路由 → 真实音频 Blob/技术检查 → typed voice adoption → dialogue binding。播放调度由 AVG-03 负责。
- **交付**：speaker/locale/textHash/performanceRevision/voice preset、支持的读音/演法参数、单句或真实对齐片段、actual duration/费用/权利/operation receipt；不依字数猜 timing。
- **注册表/生命周期**：voice-plan 只写工件 payload，provider 回执系统保存；现有九类 kind 和 Blob 复用，voice 生成 capability 新登记，不能将 sfx import/play 冒充 TTS。旧无声请求不启用配音。
- **正反例**：合法单句/对齐片段、改稿 stale、同文不同演法；错 speaker/locale/text、不可用 voice/style、空/坏/漏字 clip、未知费用/operation、无声音使用权拒绝。可观察者实际审听不是波形/时长检查替代。
- **非范围/停止**：不克隆第三方声音、不承诺全部句/语言/情绪可用；没有真实审听只报告技术 smoke，不通过艺术门。

## 5 AVG-01 · 专业内容与会谈

- **状态/前置**：LATER；AVG-01A 等 BASE-00B/CAL-00，AVG-01B 等 01A/02A1；两者均不阻塞当前系统/表现框架。S2/S3 分开，AVG Work owner 不变。

| 单元 | 限定输出 | 独立完成门 |
|---|---|---|
| AVG-01A | S2 会谈、监督/来源/故事/人物/路线意图的专业候选/采用 | 来源与知识/主体/路线闭合，抽象交互需求可供规则设计；不要求最终剧本/系统已完成 |
| AVG-01B | 消费 02A1 骨架的 scene-plan/script、dialogue-patch、content-review | 规则/知识约束真实进入输入与检查，表达不改事实；有界真实采样及采用/修稿证据，不把文学质量门延到 06 |
- **入口/闭包**：`Consultation.tsx/avg/consultation.ts` → 专用 S2 Skill/草稿；明确开始后 `plan.ts/scheduler.ts/production-executor.ts` → source/story/cast/route/scene/writer/editor/review → author adoption → AVG compiler。已有 outline 会谈不能升级为全套专业生产。
- **交付**：规格 01 的监督/来源/内容岗位及唯一核心 Skill/输出 schema，方法卡 M01～M03 的真实任务实现；M04 导演归 02A2。表达补丁与规范剧本分开 owner，最终场景消费规则骨架，不在本包声称已实现物理库存。
- **注册表**：新 Agent/Skill、`avg.content-inputs`、review 投影及 payload 写域；实际必读/禁止由 Gateway 校验。复用 productBuildArtifacts/候选/adoption，按 schema/key 限定写入，不散写 Canon/Work/会话。
- **恢复/兼容**：原始响应/候选/问题、repair 记账、刷新不重发；旧 S2 草稿可读，新生产路径就绪时收口旧通用生成入口。作者事实变更回上游，不让对白编辑偷改规则。
- **正反例**：不同人物声音、路线信息/回响、合法表达补丁；拒绝 source 伪造、私密泄漏、跨 scene/key、过期 base、编辑改事实/效果及 reviewer 自报人类采用。真实同预算采样与原始人工修改单独取证。
- **完成/非范围**：候选→作者采用→可消费内容 revision 及有界真实任务闭环；不以 schema 正例宣布文学成熟，也不把此包当可玩作品。

## 6 AVG-02A · 基础规则、导演与舞台

- **状态/前置**：当前主线；02A1 确定性内核等已验收 BASE-00B，02A2 等 02A1 与固定/已采用输入；专业故事/设计/导演 Agent 后置。产品研发；接正式作品时再验证 S3 候选和 AVG runtime。

| 单元 | 限定输出 | 独立完成门 |
|---|---|---|
| AVG-02A1 | 当前先做确定性 system-plan、类型化变量/知识/关系/选择和共享执行器模拟；专业设计岗位后置 | 两套配置、结构图与实际路径、类型/范围/身份/原子失败检查；正式采用和运行准入另验，不以只读预览关闭全包 |
| AVG-02A2 | 当前先做有限导演合同、编译/舞台/Cue/消费槽；专业导演岗位后置 | 固定/已采用文本和规则进 V2，实际规则/演出一致；合法导入可验工程，不等待专业故事/自动工厂 |
- **入口/闭包**：当前为固定原创规则/文本 → 严格 codec → 确定性 compiler/只读模拟 → 后续受治理采用/V2 runtime/舞台；专业岗位接入后再扩上下文和候选闭包。`narrative-blueprint.ts` 有限条件/效果与现有 Cue 基础复用。
- **交付**：类型化变量/知识/关系、选择/回响/结束、无环模块依赖和声明式 Cue；actor 身份/外观/构图/消费者；不可跳过/超时/打断规则。规则状态只由合法命令推进，导演无副作用。
- **注册表/生命周期**：本次纯内存内核无新增源/AI 字段/表，不读世界、不持久化；未来专业岗位须登记 `avg.system-inputs`/核心 Skill/独立写域，正式规则冻结在包，会话复用 events/checkpoint。consumer 目录由确定性编译生成。
- **正反例**：两种选择即时/后续差异、纯文字逻辑等价、事件重放；拒绝类型越界、未知操作、任意代码、未知角色/Beat、知识泄漏、Cue 偷写状态/无界等待；舞台/点击/选择 E2E 真正生效。
- **兼容/非范围**：V1 旧演出与存档回归；不默认引入 live AI、RPG 战斗/经营或可动角色。renderer 缺能力与关键知识冲突阻止对应 Build。

### 6.1 当前内核增量证据

分支 `feat/avg-system-presentation-framework-20261015`；实现位置为 `src/lib/avg/system-contract.ts` / `system-compiler.ts`。只读 headless 编译/模拟，不启用新玩家、专业 AI 或正式 system-plan 采用。当前定向 5 文件 / 52 测试通过（内核 10 项）；architecture、required-tables、ai-manual、source-reachability、文档、定向 lint、TypeScript、build、diff 检查通过。完整 CI 尚待共享槽位验证，当前不标记全包验收。两套工程配置均无商业素材/文学评测声明。整个 02A1 仍施工中，不能将内核通过写成全部正式生产已完成。

### 6.2 当前作者规则接缝

内核 `d99d56c5` / PR #143 之后，`feat/avg-rules-adoption-20261015` 接 `avg.system.plan` 的 `product-module` 作者候选、实际确认/校验证据和正式编译读取。只复用既有三注册表写口/表与命令；不启用专业设计 AI。规则候选@2 与其校验证据由系统生成/重验，旧工件候选@1 不变；pending 不得作为正式编译输入，修订失效闭包/备份/恢复/删除均验证。

定向 6 文件 / 57 测试及隔离 Chromium 7 条 E2E 通过；最终治理、类型、lint、构建、文档/统计和 diff 检查通过；完整 CI 待串行验证。此增量验证受控冻结 human-import 任务的 API 接缝，尚无新作者工作台或实际生产 planner；只有后续联合编译/播放器接入后才能完成整条用户路径。02A1 工程完成门为规则/模拟/作者采用及编译读取，待完整 CI 后独立验收；专业设计岗位后置，02A2/播放器不是本包的循环前置。

### 6.3 当前原生编译/玩家接缝

`feat/avg-runtime-framework-20261015` 承接 `00222d28` / PR #145。输入是已确认规则和逐场脚本，stage 是明确的演出草稿；输出原生 Package V2 候选。新增 `AvgRuntimeModuleV2`，旧 inert V1 模块/Package V1 保留原义。源 envelope、会话、事件、快照、分支、媒体 resolver、玩家和备份派生引擎支持已登记原生模块，无新表/迁移/AI 写域。旧非 AVG 调用保持产品收窄，拒绝跨产品来源。

当前定向 17 文件 / 109 测试与隔离 Chromium 8 条 E2E 通过，已验证台词/Cue/知识选择、Build/Release 存档和刷新/备份，观察了纯文本测试舞台截图。治理、类型/lint、构建、包体、文档/统计与 diff 检查通过；完整 CI 待共享串行槽位。新运行能力不表示已有新生产 planner、正式导演/媒资采用、物件/证据、完整声音协调或三线工作台；按 02B1/03A/05A 与媒体包继续施工。

## 7 AVG-02B · 可选交互与证据系统

- **状态/前置**：聚合包；AVG-02B1/02B2 均等 02A2，未依赖库存的模块不强等 02B1。物件首批和后续 optional 模块有独立交付，不用“首批完成”关闭整组。

| 单元 | 限定输出 | 独立完成门 |
|---|---|---|
| AVG-02B1 | 同会话物品/证据、查看/出示/知识、inventory/detail renderer | 唯一/重复/错目标/消费/可见性与真实存档反例；首戏可独立采用 |
| AVG-02B2 | 后续队列：热点/地点、话题、消息、档案/回顾/辅助按选用模块逐项细化/交付 | 开工时每模块有自己的范围/依赖、typed 状态/命令、消费者和正反例；输入/效果/恢复/隔离实测，未选不挡首戏，未实现不可启用 |
- **入口/闭包**：system-plan 正式目录 → 模块有限命令 → 同一 session/events/checkpoint → inventory/detail/hotspot/phone/archive renderer；上下文只给有权知识。对照规格 02 的行动目录，不照搬逆转裁判全部玩法。
- **交付**：定义/实例/数量或唯一、状态/目标/反馈、inspect/use/present 幂等；后续模块的投递/已读/合法回复、可访问热点、只读回顾、防剧透解锁与确定性辅助。
- **注册表/生命周期**：复用系统 Skill/字段和 runtime 表，不新建“所有游戏物品表”；模块类型及有效动作白名单进入 L3。当前知识不使用跨周目 progress；公开消费只发允许数据。
- **正反例**：同一信封图标→详情→出示→选择与保存恢复；拒绝双领、重复奖励、错对象、非法打开/消耗、未发现话题、重复消息、回放改当前事实、auto 代答。多个 Work/关闭模块/坏存档及键盘触屏真实 E2E。
- **完成/非范围**：按模块单独声明能力，Pilot 可消费第一批；第一批不代表所有可选模块完成。不包括装备/交易/合成、真实通讯、3D 检视/计时审判。

### 7.1 当前 AVG-02B1 增量

`feat/avg-inventory-20261015` 承接 `d5fba87f` / PR #146。系统规则显式 V2 + inventory-plan@1，旧规则 V1 与旧包/存档原义保留；有限物件/实例与知识视图、严格能力/媒体引用、唯一命令/replay、背包/详情/操作反馈已接入既有 player/store/事件/存档。无新表、AI 读写域或模型调用；作者输入仍经 pending/正式采用，新增命令适配器进入现行唯一写入边界。

定向 18 文件 / 122 测试通过，资源释放加固后 2 文件 / 22 项再次通过；隔离 Chromium 9 条 E2E 通过。覆盖唯一/错目标/重复/知识与持有者隔离、数量/状态转换、原子失败、刷新/真实存档/备份 remap/delete；原创 SVG 字节通过冻结目录/实际 Blob 绑定消费并在分支读档后重新解码，桌面/移动截图已复核。修复旧 URL 释放后的切换显示与预加载释放时序，反馈常驻面板底部。治理、类型/lint、构建/包体、文档/统计和 diff 检查通过；完整 CI 待共享串行槽位，当前不标记全包完成。正式三线工作台另记，不以固定夹具的 Preview 冻结关闭 05A 或总目标，不签商业美术质量。

## 8 AVG-03 · 阅读、声音、存档与玩家进度

- **状态/前置**：聚合包；AVG-03A 等 02A2，AVG-03B 等 03A。运行阶段，owner 为 AVG 实例/本地读者设置；播放不必等 voice provider。

| 单元 | 限定输出 | 独立完成门 |
|---|---|---|
| AVG-03A | 阅读/真实声音协调/历史/存档槽/偏好、资源加载与错误恢复 | 授权导入的真实 clip 完成等待/打断/回听/加载测试；设备/性能/配额/缺媒体与旧 V1 操作回归 |
| AVG-03B | 跨周目 progress、对应实际解锁和完整表生命周期 | profile/Work/版本隔离、迁移/往返/remap/delete/去重，读旧档不泄密；不挡单会话首戏 |
- **入口/闭包**：`AvgGamePlayer.tsx/StageAudio.tsx` ↔ `avg-game-player.ts/avg/runtime-commands.ts` ↔ session/events/checkpoint → source pin/media resolver。读取准确包和真实 clip，不发 runtime AI。
- **交付**：Text/Cue/Voice 完成屏障、过期回调隔离、manual/auto/已读 skip/assist 区分；实际 visit 历史/回听；用途音量/循环/后台/取消；安全边界存档槽、偏好持久化和跨周目进度。
- **注册表/生命周期**：会话状态继续现有表；若增加 avgPlayerProgress，先登记 Work/profile/portable product scope、引用 remap、迁移、导入导出、去重/delete。偏好复用本地设施，不双写 Project 或世界。
- **正反例**：实际 ended 后 auto、选择暂停、回听无效果、后台返回不叠播；缺声/无 autoplay 权限、快速换句旧 callback、改稿已读、损坏/错 hash/跨 Work save 拒绝；旧 V1 save、离线及新 profile 隔离 E2E。
- **非范围/停止**：不承诺跨 release 无条件旧档升级或逐毫秒音频恢复；导入音频可检验播放，不能证明自动 voice 生成或艺术质量。

## 9 AVG-04A · 视觉生产、家族与自动绑定

- **状态/前置**：QUEUED；BASE-01、02A2、CAL-00 对应视觉质量分项；固定/已采用输入即可，不等专业剧情。S3 媒资 owner 为 AVG 产品；确认的物件槽还需 02B1。
- **入口/闭包**：art/character/environment/prop/UI/key-art Skill → media requirements/参考 → 实际 provider/import → 加工/visual review → author adopt → typed stage/dialogue/inventory/detail/menu/gallery binding → Build。
- **注册表/工件**：`avg.media-inputs/avg.review-inputs`、岗位核心 Skill、media-brief/visual-bible/review schema 与闭集 key；需求 metadata、制作 payload 及实际 Blob 复用，rights/hash/费用/真实观察为系统/人类证据。
- **交付/正反例**：人物/地点/物件连续家族和小图/合成审查；接受合法同物件 icon/detail，拒绝错身份、变状态、泄密文字、假参考、wrong consumer、把所有 ui 当 overlay、非法宣传图入 runtime、stale family。
- **恢复/生命周期**：原图/加工 lineage、返修预算/拒绝与局部失效；导出正式必要 Blob，参考/商业素材不自动公开；旧 release 保留。
- **非范围/停止**：没有真实传输/字节/可观察者时不通过自动制作/艺术；不以单图好看替代完整场景，不引入研究限定的非商用代码作为默认生产线。

## 10 AVG-04B · 声音与配音生产

- **状态/前置**：QUEUED；BASE-02、02A2、CAL-00 对应音频质量分项；使用固定/已采用准确台词和演法，不等专业剧情。S3 产品音频 owner。
- **入口/闭包**：sound-director/voice-director → sound/voice-plan → 真实音乐/环境/SFX/voice → audio review/author listen → typed channel/line binding → AVG-03 的连续播放。
- **注册表/生命周期**：三个核心 Skill 及 media/review 投影；payload/需求与现有音频 Blob/adoption/rights 复用，不把 wave 检查写成听感通过；text/performance/preset 版本和原片段/裁段 lineage 保留。
- **交付/正反例**：关键对白真实 clip、准确读音/声线/演法/对齐、BGM/雨声/SFX 与混音；错句/漏词、speaker/locale 错、字数猜 timing、循环截断、旧文配音、不可听 reviewer 判通过均拒绝。
- **完成/非范围**：有观察范围/费用/废弃与返修的真实连续音频样本；实际播放/存档由 03 联验，不默认所有语言全量配音、不克隆未授权声音。

## 11 AVG-05 · 三线工作台与局部返修

- **状态/前置**：聚合包；AVG-05A 等 02A2/03A，AVG-05B 等 AVG-PILOT-01B。作者生产/修订，AVG Work owner。

| 单元 | 限定输出 | 独立完成门 |
|---|---|---|
| AVG-05A | 单场文本/规则/导演编辑、实际媒体导入/采用与联合预览、最小问题/修订入口 | 作者在准确 Build 改字/换图/检查分支，源版本/采用/失效生效；不依赖完整生成/批次 UI |
| AVG-05B | 完整三线/参考与 voice 管理、批次/锁定/差异、跨线最小返修和回执失效 | 用生成首戏的问题驱动 UI，改句/主体/规则的闭包、费用/刷新/旧档真实生效 |
- **入口/闭包**：现有 AVG 编辑/BuildInspector/revision service → 场景/工件差异/实际媒体 → registered candidate/adopt → dependency invalidation → new Build/preview → issue/review receipt。
- **交付**：内容/系统/媒资入口与联合预览、实际参考/候选/费用、锁定/拒绝/返修、准确位置问题单；作者改字/规则/图/演法时可看影响与重验范围。
- **注册表/生命周期**：不新建平行编辑 DB/AI 入口；新 UI 通过已有 registered services，review 只写问题工件。编辑器草稿不能绕过正式规则/资产采用，系统生成 lineage/失效清单。
- **体验岗位落点**：AVG-05B 登记 `avg-experience-reviewer / avg.experience-review.v1`，只读取准确 Build/实际路径与 `avg.review-inputs`，写 `avg.review.experience.<buildKey>` 问题工件；不写原剧情/规则/媒体、不自报人类试玩。05A/Pilot 的人类问题可先走同一合法问题入口，不要求该后置 Skill 已实现。
- **正反例**：改句→旧 voice stale、换表情→家族/合成重验且背景保留、改规则→路线/consumer 重验；拒绝锁定遮盖 stale、复制父 Build 质量/玩家回执；刷新继续候选/repair，旧 release/档不变，跨线隔离 E2E。
- **非范围**：不另建第四创意生产线、不自动发布、不过早扩完整作；不能只给问题单而未接实际返修消费。

## 12 AVG-PILOT-01 · 第一场完整戏

- **状态/前置**：聚合验证组；A 等 05A/02B1/CAL-00，B 等 A/04A/04B。具体作品生产，另冻世界/Brief/预算/开始；不是当前设计交付的一部分。

| 单元 | 限定输出 | 独立完成门 |
|---|---|---|
| AVG-PILOT-01A | 合法导入/组装的完整短戏 | 消费/规则/声音/存档/作者修改与完整反馈，不冒充自动生成；不等 03B/02B2/05B |
| AVG-PILOT-01B | 正式生成并绑定的同一戏 | 实际 Skill/参考/TTS/采用/连续艺术与成本；和 A 的准确 Build/hash/回执分开，不能借 A 的质量通过 |
- **入口/闭包**：正式 S2→S3 → 三线输入/候选→adopt→Build→完整试玩/存档→问题返修。雨夜档案室、两位成年人、一封信、一个决定与两个后续结果，按[首场景规格](../products/avg-production/04-QUALITY-REPAIR-AND-FIRST-SCENE.md)执行。
- **数据/证据**：现有生产/媒资/会话与 progress 生命周期；导入组装和生成并绑定两种模式分账，生成模式须实际 Skill/参考/TTS/费用/审听，不用旧《雾港》代替。
- **正反例**：知识/物件、各媒资 consumer、两次选择/回响、voice wait、失败/刷新/旧档及改稿/换图/改规则探针；作者和少量真实目标读者完整反馈，blocking 先修同一戏。
- **完成/非范围**：准确 3～5 分钟 Build 的工程、表达、作者与局部修订证据；未取得生成证据的模式不能通过自动生产门，也不宣称 15～30 分钟/商业验收。

## 13 AVG-06 · 切片、真实对照与独立玩家

- **状态/前置**：LATER；PILOT-01B/05B blocking 清零，所选模块全部就绪。产品质量校准与独立作品生产分账，复用所有既有表/Run/receipt，不新增旁路评测写口。
- **交付**：CAL-01 的 9 样本试验有收益后补另两类 Brief 的 18 样本，合计 27；15～30 分钟作品及两个真实结果、作者修改、对应经验的内容/美术/声音评审与至少 8 名目标读者试点。通关/4分不代替商业参照比较，未补九场/音频继续记缺口。
- **输入/正反例**：同源/同要求/总预算、所有 raw/拒绝/人工工时、不同 provider+model 才叫独立；统计原始 n/N、assist/退出和理解口述，不筛掉坏样本、机器人或同模型自评冒充玩家。
- **闭环验收**：准确版本问题→owner/最小返修→新 Build/后继 release→旧档复测；质量回执 stale 不借用。试点阈值按规格 04 冻结，不代表销量/统计证明。
- **停止/非范围**：预算耗尽、艺术关键项未知/失败或恢复反例未解停扩大；不是直接生产完整商业长篇。

## 14 AVG-07 · 玩家交付与指定分发

- **状态/前置**：LATER；06、实际用到的鉴赏/档案模块与冻结分发目标。release/外部分发生命周期，批准发布与渠道动作分别处理。
- **入口/闭包**：已验收 Build/SourceManifest → immutable release → 正式 Blob closure/导出 → 隔离安装/离线玩家 → save/profile/版本/资源 pin。复用既有 Release/export/import，不把作者备份当独立播放器。
- **交付**：封面/开始继续/必要内容提示、正确解锁的鉴赏/回顾、可用离线包与语言设备范围；按实际渠道准备 Demo/说明和当前权利/政策 evidence。
- **注册表/正反例**：PROJECT_TABLES 派生完整包/remap/delete；不包含凭据、作者设置、源世界全部秘密或未采用候选；缺 Blob/错 MIME/hash、锁定 CG、损坏/旧档及新版安装反例，浏览器/分发目标实测。
- **非范围**：不默认上传商店、公开发布或收款；distribution-ready 只对应准确渠道证据，不自动代表已销售/盈利。

## 15 AVG-08 · 通用性与规模

- **状态/前置**：LATER；06 已有可行质量/成本。第二题材/配置作品另冻来源/预算；高级表现不自动随包启用。
- **交付**：换世界/人物/物件/规则与至少线性/分支两类配置，复用同一生产体系；用真实长作品增量统计返修/上下文/媒体存储/加载和每分钟制作投入。
- **注册表/兼容**：仍使用 AVG 模块/表/消费者；新增小游戏/动作/视频/显式存档 migration 需专项版本、正反例和下游门，不建新的 AVG 产品身份/万能世界字段。
- **正反例/完成**：无首作 key/台词/角色特例也能正式生产/采用/发布/运行/维护；第二配置数据/规则/资产隔离，规模/经济按实测。失败回方法/粒度/能力瓶颈，不用硬编码或无限重试掩盖。
- **非范围**：不提前许诺全题材/全系统、零人工、商业长篇稳定产出或高级媒资效果。

## 16 AVG-CAL-00 · 参照、能力与投入冻结

- **状态/前置**：准备中；AVG-00。研发质量校准，准备输入与标准，不新建产品表/production，不执行付费调用或代替专业人士签字。
- **输入/交付**：从实际合法连续场景中冻结 reference/平台/版本/语言/时点、可观察图/音/操作和不适用项；首批功能、画幅/设备/语言/视角、效果等级、人工/费用政策、有限次数及停止条件形成 QualityProfile/CapabilityMatrix。作者 2026-10-14 已明确首轮总费用及修稿/修图/审听工时无上限，并授权使用 Agnes；该项不再待确认，每批有限资源/attempt 和全量费用/失败记录仍必需。对应规格 04 的分级目标，接口施工可并行，商业质量门不得空缺。
- **三注册表/所有权**：来源/数据只读归原 owner，商业媒资留在合法研究范围，不导入正式产品。未来 profile 由 AVG Brief/工件承载，必须通过 existing adoption；不以研究表手工修改作者数据。
- **验收/反例**：实际观察与未观察分开；拒绝 PV 代替整段、跨语言直接评对白、不同发行版混算、工程分数冒充艺术比较。缺少参照/专业观察者保留 unknown，不能宣称“比肩”。
- **非范围**：不购买/安装/发布商业游戏、不生成本作媒体；九场全面研究仍是扩展证据，本单元先冻结首戏真正使用的参照。

## 17 AVG-CAL-01 · 提前检验专业化收益

- **状态/前置**：LATER；CAL-00、01B 的最小专业内容路径；文学试验不阻塞系统与表现框架。图/音分项另等 BASE-01/02 的实际能力；一个分项通过不放行另一个 unknown 分项。
- **交付/读取**：先 1 Brief × 通用/专业/分离编辑三路径 × 每路径 3 样本；同来源/要求/预算，保留所有原始/拒绝/修改。参考家族与关键 voice 用小批次真实验收回执评身份/演法/人工/费用，在完整工厂前发现不可用路由。
- **调用/写域**：复用注册 Skill/Harness、媒体 gateway/候选/Blob/receipt；读取冻结输入投影。评测专用调用须在 AI 入口登记 evaluation 边界，不能从组件另发请求；不为了复评盲目重跑已经足够的 provider 验收样本。
- **验收/反例**：无 blocking，专业路径的选用须有质量/采用/人工或总投入的实际收益理由；若预算内无收益，修方法/粒度再测，不能机械启用全部 22 岗位。不同 provider+model 才叫独立模型，observer 不可观察则 unknown；未知成本不记零，坏样本不丢。
- **非范围/停止**：不是统计显著性或完整商业作品证明，不在本次设计复审中调用模型/生成图片/音频。未冻结单批资源/真实路由/观察者，或分项失败时停对应批量工作；作者已授权不设总上限不构成待确认事项。
