# AVG 游戏系统、演出与恢复协议

> L2 · 版本：1.19.0 · 生效：2026-10-22 · 受 [AVG 产品契约](../AVG.md)约束。
> 目标协议与当前原生增量分开记账；旧 V1 底座不因此自动拥有新物件、消息或完整语音协调能力。

## 0 当前研发顺序与规则接缝

系统/表现框架先于专业剧情生产施工。AVG-02A1 的确定性内核提供 `AvgSystemPlanV1` / `storyforge.avg.system-plan@1`：characters、类型化 variables、带 holder 的 knowledge、按角色/维度的 relationships、entrySceneKey、scenes、actions。可使用固定原创场景独立编译和模拟；完整剧情、专业 system-designer/performance-director、AI 采用与实际 V2 玩家仍分别验收。

状态路径由身份确定性生成：`avg.variables.<key>`、`avg.knowledge.<holderKey>.<factKey>`、`avg.relationships.<characterKey>.<dimensionKey>`。路径段只接受安全标识，不允许点号层级注入或原型属性；`player` 为玩家知识保留身份。只接受已声明槽位与匹配类型的条件/效果，必需状态不能 unset。boolean、数值范围/整数、枚举和字符串长度均由代码检查；关系有界，知识逐持有人保存。

规则 compiler 输出既有 Frozen Narrative，条件/效果及转移复用共享确定性执行器；不复制状态机。`simulateAvgSystemPlanV1` 最多执行 1,000 个明确行动，并限制状态槽数 × 逐效果/路径检查总工作量为 1,000,000，返回准确规则/内容 hash、实际逐步状态和结束标记；越界或非法目标整次失败，输入和此前预览不变。图检查是结构校验，不替代条件可满足性、全路径覆盖或真实游玩。空 Beat 的规则预览不构成可玩包，不能用于绕过正式会话源验证。

纯编译内核不访问 DB/世界/模型。system-plan 是唯一规则类型来源，专业工件 codec 已可解析它，但这不授权专业 AI 写入：作者输入仅在已冻结的 `human-import` 任务中，以 `avg.system.plan` / `product-module` 暂存，再由实际 `adopt-avg-artifact` 命令确认。通用 AI/Artifact 写口继续拒绝新专业工件。已验收 `AvgRuntimeModuleV1` 的空状态/行动语义不被悄悄改写；实际接入规则须明确模块版本、严格分派与正反例，再开对应玩家能力。

### 0.1 作者规则候选与编译输入

作者规则候选采用 `storyforge.avg.author-candidate@2`，只给 system-plan 增加系统实际生成的 `storyforge.avg.system-validation@1`；演出组装使用下述显式 candidate@3；其他作者工件继续原 candidate@1 字节/哈希语义，不升级旧记录。验证证据包含 compilerVersion、planHash、contentHash、initialStateHash，coverage 固定为 `structure-and-entry`。它只证明结构图与入口状态检查，不能自报全路径、可玩、专业内容或商业质量通过。

暂存前验证图、类型/范围和入口；确认事务内重新执行并重建候选哈希、来源/上游/基线与校验证据，不信任调用方自报的校验 JSON。校验仅执行纯数据与哈希，使用单个事务存活等待包裹、内部不访问 DB，避免嵌套 crypto 等待形成自依赖。篡改或错误版本拒绝，命令失败留实际回执；相同命令幂等，规则变更使实际依赖旧 revision 的脚本/工件失效，旧 payload 保留。

`readAvgSystemPlanForCompilationV1` 只为当前活动 Build 返回有作者确认回执的唯一正式规则 revision，校验 Work/Production/明确开始/Brief/SourcePlan/Plan、Build revision/epoch、内容 hash、作者命令和实际校验证据。返回准确规则/工件版本/哈希/回执，候选不能通过此入口进入正式编译。该 API 本身不开始生产；实际规则候选/确认、固定生产计划和工作台见 §0.3，分别保留其验收边界。

### 0.2 作者演出组装与可移植编辑草稿

`storyforge.avg.author-workspace@1` 复用 `avgAuthoringDrafts.editorJson`，保存规则、规范场景脚本和 `storyforge.avg.author-stage@1`（aspectRatio、现行 Cue/冻结资产目录、可选 reading-plan），basePreviewHash 仅作修订基线。保存只改作者草稿，不开始生产、不正式采用；旧 V1 草稿与新草稿相互保护，不能由另一个编辑入口静默覆盖。协议严格拒绝未知字段/版本，JSON 不含 Build/Blob/Work 本地 ID；实际媒体仍由既有 `avgDraftMedia → mediaBlobObjects` 生命周期管理。

演出输入为冻结 `human-import` 输出 `avg.author.stage / presentation`，依赖当前正式规则及全部场景脚本。它是作者组装合同，不宣称已启用专业 performance-director Skill。暂存产生 candidate@3，附系统实际重算的 `assembly-validation@1.moduleHash`；确认事务重新检查当前 Build/Plan/开始回执、所有上游 revision/hash、规则/文本/Cue/准确语音绑定和真实 Work 媒体。该 hash 证明此组装模块的确定性闭合，不是正式 Preview/Release 哈希，不代表听感/美术或商业质量。通用 AI/Artifact 写入口保持关闭。

`importAvgMediaForAssemblyV1` 从输入快照验证 MIME 签名与种类，使用真实浏览器解码得到尺寸/时长，并释放临时 URL；解码成功后才存储 Blob，并在同一事务复核 ready/owner/hash/元数据和创建 AVG 媒体引用；失败不确认悬空引用，单文件 32 MiB、解码等待 15 秒、音频最长 600 秒。当前作者组装最多 128 项/64 MiB，和实际播放器预加载边界一致；更大作品须在有界场景 cache 交付后另验，不能绕过此门。导入没有生成服务调用，也没有把素材提前采用。stage 确认必须逐个匹配已导入的完整不可变元数据、来源与授权，再从当前 Work 的物理 Blob 验证大小、MIME、hash，并在暂存/确认/正式编译读取时实际解码重查尺寸与时长（1ms 容差）；即使备份中的导入元数据与候选一起被改写也不能跳过。单次组装校验最多 60 秒，不能只给自报文件名/hash/尺寸。OPFS I/O/哈希使用单个纯读取事务存活等待。

`compileAdoptedAvgBuildV2` 只读取有真实作者确认回执的规则、脚本和演出，重新校验依赖和实际媒体，返回待组装运行包及来源证据。上游变更会使已采用演出失效，旧候选也不能借新 revision 确认；旧 payload 保留。备份只重映射既有媒体表的物理引用，portable 编辑/候选/回执字节不变。该编译器本身不直接冻结 Preview、不复制生产调度器；实际工作台/planner 见 §0.3，本地原型版本见 §0.6，完整 05A 继续施工。

### 0.3 作者系统工作台与真实制作计划

`AssemblyWorkbench` 是显式打开的实验入口；保存了 native author-workspace 的 AVG 才继续进入该工作台，旧 V1 编辑器不自动转换。AVG Work 拥有规则、规范脚本、演出及导入媒资；版本化世界只读，运行/物件/阅读状态归会话。编辑草稿经既有 CAS 保存，内部页面切换先等待保存；高级 JSON 必须先应用或撤销。两套原创工程配置分别验证物件/知识分支和线性开关；文本没有文学质量声明。

`storyforge.avg.assembly-brief@1` 冻结标题、1～96 个场景、至多 128 项媒资及准确父包 hash。准备方案仅产生可复核 Brief/SourcePlan，明确开始后才创建实际 Build、Plan 和根 Run；不要求模型 Key，也不调用生成服务。原生方案禁止付费预算/专业 Skill/替换 DAG：作者确认规则→逐场脚本→演出，确定性集成→技术 QA。每次候选独立保存并查看准确 payload，确认绑定候选 hash 和当下上游，不自动采用草稿。

全部作者输入齐备后，调度器原子锁定输入并进入 integrating，之后禁止再编辑当前 Build 输入；实际任务生成 accepted runtime.package/媒体 Artifact、子回执及根终态回执，才冻结真实 Preview V2。集成及 QA 均重验已采用来源、物理媒体与包一致性；相同字节的 BGM/voice 仍分别匹配完整元数据和用途。QA 仅验证六项技术门，媒体覆盖按实际 Cue/配音/物件消费者计算，未绑定素材明确提示；`releaseReady:false` 不签发艺术、专业人声或正式发布通过。

媒资页实际解码导入、显示来源/授权/尺寸/时长，选择用途可绑定场景或物件；替换保持原 Cue 时机与语音的原文本 revision，过期配音须作者重新绑定。历史文件仍留在作品中。共享失败候选清理由 PROJECT_TABLES 派生全部 mediaRef，并在同一事务检查，不能删除仍由 avgDraftMedia 等注册引用持有的 Blob。

从冻结预览修订时，新 Brief 与旧 Build 可以同时存在：旧 Plan 必须按该 Build 的已授权 Brief 读取，不能用待确认的新场景/媒资域重解释。新版重新开始和逐项确认；旧预览及会话不变，任意原生包变更采用 pin-old-save。失败/停止记录与原始输入保留，明确停止并保留后可准备新 Build；不自动重试收费调用或覆盖旧终态。刷新后可继续待确认输入/未完成确定性任务。完整备份继续使用已有表、Blob 和引用重映射，无新增表、迁移、AI 读写域。

工作台已验证真实制作根回执、图/音消费、物件出示、快速存档、刷新、新图修订和两套配置。 night/day Cue 同时作用于纯文字舞台底色和媒体层滤镜，校准不仅检查 data-tone，也检查真实渲染样式。场景资源见 §0.4～0.5，本地原型版本接入见 §0.6；完整设备/可访问性和长作品性能继续验收，03A/05A 与整体目标仍未关闭。

### 0.4 场景资源窗口的共享底座

`ProductMediaResolverV1.preload` 增加显式可选 `retainOnlyRequested`；默认调用仍保留既有目录 URL。窗口模式按所请求的有序清单及字节上限保留 URL，超额/未知资源返回失败，移出窗口的 URL 撤销、Build 原始字节缓存清理；空窗口可显式释放。不会修改物理 Blob、媒体引用或作品/世界/存档。读取、预载和窗口替换串行，退出停止新 URL 并等待在途读取后释放租约；在 DB 等待前捕获原释放屏障，避免旧读操作等待自身释放而死锁。

此底座在独立 avg-scene-resources-20261015 树施工，不修改已冻结 PR #152。真实 scoped artifact/blob 单元验证 URL 撤销、容量、物理损坏重读及并发退出；浏览器已回归工作台/旧 V1/声音，该基础提交本身未启用原生 AVG 场景选择器；产品接入见 §0.5。当前 128 项/64 MiB 作品上限不因此扩大，局部窗口不得冒充整包媒体或正式 Release 质量验收。

### 0.5 当前舞台、物件与历史回听的资源窗口

原生 V2 播放器通过 `selectAvgSceneMediaWindowV1` 选择当前句配音、当前场景 Cue/逐句声音、实际时钟投影中仍在使用的背景/立绘/CG/叠加图与持续声音；不预载无关场景。物件面板只加入已持有且已公开的投影图片，未知详情不进入窗口；历史面板只按作者已读记录的实际 assetKey 加载选中的回听片段。静音不伪造 native voice 完成回执，仍保留其真实传输；图片关闭释放图像窗口。旧 V1 保持原目录预载路径。 全局 Enter/Space 阅读快捷键不拦截菜单、按钮、链接等控件的原生按键；设置打开时不推进正文。

窗口变化复用既有 scoped resolver 的显式容量模式，退出窗口时撤销 URL 并清理已完成原始字节缓存；不删除物理媒体/引用，不改变规则、阅读历史、世界或存档。持续 BGM/保留的舞台资产不会仅因场景切换而换 URL。结果同时绑定 resolver 实例和 session，异步返回还需核对当前源；旧会话结果不能发布到新会话。历史面板按 session 重建，关闭/停止回听会撤出其临时资源。排队后立即退出的旧 preload 保持逐资源失败结果，新调用已释放 resolver 才拒绝。

当前缺失资源显示可见重试入口，只重读有权访问的原冻结引用；不会修复、重新标记或生成损坏字节。物理损坏保持 corrupt/失败，只有存储真实恢复到有效状态后再重试才可消费。加载/降级使用可读提示，不向玩家显示资源 key。此局部窗口不能签整个 Build 的 media-runtime 质量通过；原生完整技术/发布验收必须另有全目录与准确版本证据。

实际浏览器探针使用 7 项原创 PNG/SVG/PCM 测试媒资：场景常态保留 3 个 URL、打开已公开物件详情最多 5 个，移出场景/关闭物件/停止回听后实际 fetch 旧 Blob URL 失败；重读历史产生新 URL 且不改运行投影，持续 BGM URL 不变，刷新重新读取正确源。未进入的损坏场景图只在进入后报错，测试恢复已验证的字节/ready 状态后可通过 UI 重试。已查看实际第二场景截图；这些是工程图/非人声，不能签商业艺术质量。03A 完整设备/可访问性/长作品和正式 Release 联合验收继续推进。

### 0.6 原生本地原型版本与全目录验收

原生作者组装仅按 `prototype` 成熟度接入既有 ProductRelease，保存前必须满足冻结 QA 的六项技术门、实际消费者媒资覆盖、作者明确确认的当前 Build 完整试玩路线，以及有媒资时整个冻结目录的实际浏览器解码。Frozen QA 的 `releaseReady:false` 不改写；后试玩的 `release-ready` 是按准确版本/hash 和真实回执派生的就绪状态，不签艺术、专业配音或商业成熟度。旧 V1/商业候选与社区分发规则继续各自校验；原生本地原型没有获得社区/商店分发验收。

全目录验证使用独立 scoped resolver，每批至多两项，撤销前批 URL/临时缓存；汇总并排序整个目录后才写同一媒体运行回执。局部场景窗口、前半批成功或取消操作不能签全包通过；坏字节保留失败，实际存储恢复后再显式重验。工作台选择准确完整试玩存档、确认路线、核验全目录、准备版本并最终确认，提交绑定所查看的 adoption intent；新回执/状态变化会使旧版本确认失效。

发布重验作者原始候选、采用命令、准确依赖/Plan/Brief/SourcePlan 与零调用任务的实际子 Run/ledger/根终态；作者工件不伪造成模型 producer。采用命令进入发布事务的原子 CAS。确定性集成任务经现有世界 Gateway 留下真实 ContextManifest，发布聚合 SourceManifest；不以手工文字或空来源清单替代。不可变 V2 Release 继续使用既有谱系、媒体 owner 和生命周期；独立新档从该 Release 初态开始。后继 Build/Release 不改旧字节或旧存档，不宣称跨版本迁移。

当前发布专项 5 项回归通过，覆盖无媒资版本/备份恢复、未完成路线、来源回执篡改、并发采用快照、新试玩回执使旧确认失效、后继版本留旧档；正式 `ci:e2e` 入口的隔离 Chromium 工作台/旧 V1/原生/阅读/物件/资源与本地原型共 23 条通过，其中新增 3 条使用四项真实 PNG/PCM，覆盖完整解码、同字节不同用途、保存版本、新档刷新、带媒资备份 remap/delete、损坏未来场景与实际存储恢复、取消不写半包回执。截图已复核；仅为原创工程图/非人声，未进行模型生成、专业审听或商业艺术验收。共享发布接缝先拆为 aaecc5ff，再接 AVG 工作台；无新表、迁移或 AI 读写域。完整 CI 和框架总验收另行记账。

### 0.7 可选模块、异步来源与当前 Cue 身份

`module-capabilities.ts` 是同一份 S2 模块名称与原生准入目录，逐项声明依赖、动作、消费者、状态 owner 和恢复策略。S2 名称只表达作者意图，不赋予执行能力；原生 Package 的能力仍由严格 payload 确定，字节/顺序不变。工作台的能力列表只读、由当前有效草稿推导，冻结旧版本另行读取，不能把新草稿的开关写回旧档。

| 模块 | 当前准入及状态归属 |
|---|---|
| 对话与选择 | native，必要基础；会话 events/checkpoint |
| 物品 | native，仅 system-plan V2 实际配置；会话 |
| 证据与出示 | native，依赖物品和实际证据/出示规则；会话 |
| 热点/地点、话题/关键词、消息/手机、档案、提示/辅助 | planned/禁用；各自后续独立 schema/命令，预定会话归属，不创建空状态/表 |
| 鉴赏、跨周目进度 | planned/禁用；预定 AVG Work profile，鉴赏依赖进度；未实现前不可从任意布尔值或备份启用 |

玩家异步库/详情/动作以完整 scope、worldGroup、owner/view 请求代号隔离；清源立即释放旧 resolver/舞台投影，过期响应与错误不能覆盖新来源。旧声道观察绑定 expectedSessionId，不写新会话；已开始的合法旧操作可完成于原会话，但不把 UI 切回旧 owner。URL 只确认当前已解析 session，刷新恢复准确分支；非法外部存档地址失败可见，不悄悄选另一个存档。

瞬时 flash/shake/transition 只消费当前实际 Cue，身份含 session/visit/line/cue；不从历史 lastTransition 再触发。动画各用声明时长（零时长采用有限缺省），震屏使用独立 translate 保留 camera transform；camera/tone/actor 各用对应 Cue 时长，不受 wait 或其他角色拖长。菜单/设置/后台暂停活动动画及原生无 reading 的 Cue 时钟，已结束不因恢复重播；减少动态取消且不补播当前 Cue，切偏好保留已显示文字。此为工程表现合同，不能据动画 API 或截图推断商业美术质量。

原生舞台的 CSS 插值另由 `useStageCssPause` 控制：相机、色调、角色移动和图片入场在菜单/设置/后台期间一起暂停。只认领实际运行中的 CSSAnimation/CSSTransition，恢复自己暂停且仍连接的效果；已结束/脱离舞台的不重播，不接管 NativeVisualCue 的独立 Web Animation。菜单内重新打开图片产生的新入场也须暂停；不增加持久字段，V1 控制保留。

当前共享修复 `91cf2c9c` 与本增量一起进行最终框架验收。已加载网页的暂时断网会话可用现有本地存储继续选择/存档/分支；此证据不覆盖冷启动离线应用壳、PWA 安装或商店分发。完整设备/长作品与真实 TTS/美术质量另按目标范围验收。

### 0.8 非配音模式的一次性声音与静音恢复

完成性审查用真实导入/作者采用的 PCM 复现了先前 29 条浏览器路径未覆盖的组合：未启用 reading 时同 clip 的后续 SFX Cue 不重播、已结束片段因关闭菜单而重播、静音卸载当前音乐而使恢复重新建源。已补原生 sfx/非 reading voice Cue 的 session/visit/line/cue 身份与当前 Cue 过滤；reading 的规范逐句配音仍由 NativeVoice 独立控制，不混成两路声音。

StageAudio 的菜单/后台恢复不对已 ended 的非循环片段再次 play；明确的新 Cue 或历史回听的新 generation 仍可重新播放。静音只把当前声道音量降为零，保留当前 transport/source/播放位置；有界窗口继续 pin 舞台当前声道与规范配音，未进入的普通声音可保持不加载，stop/离场按原窗口撤回。音乐/环境的持续性和音效/旧 voice Cue 的一次性分开，不增加持久播放表或伪造结束事件。配音失败后的“静音继续”也明确绑定原 session，不能借迟到按钮确认新的存档。

此增量通过已有 AVG 产品 renderer/临时资源选择实现，Work/会话/偏好 owner 与 V1 包/存档字节不变，无新表、迁移或 AI 调用。实际正反例、整个 AVG 浏览器及最终 CI 结果按实施计划 §2.13 记账；PCM 是工程音而非真实人声或审听质量证明。

## 1 模块边界与版本

00B 的 `AvgRuntimeModuleV1` 是不可玩的私有承载，空状态/行动/Cue 仍保持原义。原生可执行模块使用 **`AvgRuntimeModuleV2`**，Package/Preview/Release 的 envelope 仍为真实 V2，禁止转换为带伪造 `version:1` 的旧包。

| 当前原生字段 | 类型/职责 | 冻结约束 |
|---|---|---|
| schema / version | `storyforge.avg.runtime-module` / 2 | 精确版本分派，旧 inert 模块不自动启用 |
| systemPlan | `AvgSystemPlanV1` / 显式 V2 inventory | 确定性生成规则图/初值，范围与身份引用闭合 |
| lines | scene/line/speaker/text/revision/locale | 一句一 Beat，脚本 revision 真实进入 textRevision；每场含规范句 |
| choices | choiceKey / text | 表达文本归脚本，行动身份与规则后果独立；仅改措辞不会改结果 |
| aspectRatio | 16:9 / 4:3 | 原生字段，不偷塞入剧情变量 |
| stage | 既有 Cue protocol 1 + 冻结 assets | 复用同一 renderer/解析器；未知 Cue 字段/缺资源/错误用途拒绝 |
| enabled capabilities | narrative / presentation / avg.rules；规则 V2 再声明 avg.inventory，显式 reading 再声明 avg.reading | 与 Package 声明精确一致，未知/未支持可选模块拒绝 |

`avgModuleNarrativeV2` 从规则和规范文本派生共享 Frozen Narrative，包解析时与 narrative/初值逐项比对。规则不从台词或图案猜结果，导演 Cue 不能写规则。当前消费现有 Cue/资产键，以及下文物件 icon/detail 的严格资产引用；00B 的通用消费者/媒资家族绑定 DTO 不因此自动生效，其余消费槽/自动媒资工厂继续另验。

`compileConfirmedAvgBuildV2` 原子读取当前活动 Build 的已确认规则和全部场景脚本，验证脚本实际依赖当前规则 revision、作者命令与源/版本/hash。输入的产品 key 必须匹配 Production；输出为规范包候选，stage 参数仍是明确的演出草稿。实际导演/媒资采用、生产 planner、durable 根回执及正式冻结由后续生产集成器完成，不从编译器签发 Preview/Release。

原生会话增加可选 `avgRules: storyforge.avg.rules-state@1` 冻结规则，规则变量仍在共享 narrative 投影中。旧来源省略该字段，保留原 JSON/哈希；新会话从包生成准确初值，事件重放和实时选择执行同一逐效果范围/类型检查，失败无半个事件。原生来源标记 packageVersion:2；读取时复核初始快照并从事件重放，不信任被重新计算哈希的派生 head。非法/被删除的规则、错源或跨 owner 的备份在导入写入前拒绝。

Preview V2 的媒体绑定只有在原生可执行目录中才开放：每个资产恰有一个 artifactKey/blobHash，目录/MIME/内容 hash 和物理 resolver 的 owner 检查继续复用。旧 inert V2 仍只准空绑定。原生 Build 与 Release、同来源分支/存档、备份重映射与删除接入现有入口；跨 Release 的 AVG 迁移尚未声明，不借文字开放世界迁移协议放行。

共享包/Preview/Release Manifest V2 只增加承载和版本分派，AVG 语义保留在 AVG 模块。包内引用使用 portable 语义 key/版本/hash，不带 Dexie id、作者凭据、二进制字节或 Build/Release id；内部 producer/Run/数据库 owner 证据不复制进 runtime 模块。legacy V1 走原有受限读取路径，不伪造新模块、物品状态或逐句语音完成事件；旧字节/hash 不重写。

必需模块缺失阻止 Build；可选模块只在作者明确移出 Brief 或接受降级后重新编译。启用了库存却没有可用 inventory renderer，不属于纯文字降级。

## 2 规范身份、状态和执行

一条可独立显示/配音的句以稳定 `lineKey` 标识；现有一 Beat 一句时直接使用 `beatKey`，不再维护两个不同身份。多句 Beat 必须显式拆分/映射，不能用数组序号作长期语音或存档身份。

句数据至少包括 scene/line、speakerKey 或 narrator、displayName policy、locale、text、textRevision/hash、可公开知识范围及内容引用。匿名、别名、身份揭示只影响显示投影；实际角色身份和此前已读事件保持可追踪。

当前会话投影至少包含：当前位置/访问序号、已选行动、变量、角色/玩家知识、关系、物品实例、话题、消息、热点、结束/路线状态及可恢复演出状态。复用同一 `productRuntimeSessions/events/checkpoints`，不借用跑团或文字冒险表。

| 状态域 | 合同 | 正反例 |
|---|---|---|
| 变量 | boolean、bounded number、enum 或 bounded string；初值、范围和作用域冻结 | 无声明值/越界 increment 拒绝；不能把无限 JSON 塞入变量 |
| 条件 | 复用现有有限谓词并补充类型化 AVG 引用 | 检查值类型/目录；未知操作和跨 Work 引用拒绝 |
| 效果 | 合法 set/increment/unset 与模块专用操作 | unset 只允许可选字段；原子应用全部效果，失败不留下半个库存 |
| 知识 | factKey、holder、获得事件、可见范围 | 玩家知道邮戳不等于角色知道；看图不自动知道信封内容 |
| 关系 | dimensionKey、范围、依据事件、显示策略 | 选择可改变信任；不将“持有证物”写成好感数值 |
| 选择/路线 | choiceKey、合法选项、条件、代价、即时反馈、后续消费与结局 | 汇流保留已发生后果；禁用选项须解释或按作品政策隐藏 |

每个命令冻结 commandId、session/release、expected event sequence、actor/target 和合法 actionKey；验证后原子追加事件并更新投影。相同 commandId 不重复消费物品或加关系；过期序号返回冲突，由客户端刷新，不能猜测重做。

事件保存实际行动、版本、前后差异和原因，规则重放与 checkpoint 恢复一致。任意文本回听、舞台重绘或打开菜单均无规则副作用。禁止模型修改会话事实、条件计算和“为方便体验”解锁未知信息。

## 3 对话推进、历史与语音协调

目标阅读状态机：`entering → revealing → waiting → settled → next/choice/ending`。cue、文本、voice 观察事件携带 line/visit、playback generation，过期回调不能完成新句。实际停留时间取运行观测，不由文本长度假装语音时长。

| 操作/屏障 | 规定 |
|---|---|
| 手动推进 | 第一次点击显全文；文本已显且强制 Cue 完成后才可下一句。是否同时打断配音由作者/玩家明确策略决定 |
| 自动阅读 | 等待 TextComplete、必需 CueComplete，以及启用 voice 时的 VoiceEnded 或声明的失败/允许中断结果，再等待配置阅读余量 |
| 无声/播放失败 | 记录具体 clip/error；按声明可继续或暂停提示。不能无限等待不存在的 ended；不能伪报已听完 |
| 已读快进 | 只经过当前 release/text 版本已实际读过的句；停止于未读、选择、需输入模块、结局或不可跳过屏障 |
| 跳过未读 | 默认关闭；作者允许且玩家显式开启才可用，不写“完整阅读”回执 |
| 自动答题/故事辅助 | 独立开关及作者冻结路径；显示提示或确定性执行已声明行动，记录 assistUsed；自动阅读不选答案 |
| 菜单/窗口后台 | 退出、加载、换句、失焦按策略取消/暂停旧音频与计时；回来只恢复合法当前位置，禁止多份音频重叠 |
| 文本历史 | 按实际事件顺序和 visit 序号记录正文版本、说话人显示、所选行动及配音引用；重复访问保留重复记录，不按 readBeatKeys 去重/排序 |
| 回听 | 打开当前历史条目的真实 clip，不执行 Cue/效果，不改变剧情位置或伪造新阅读事件 |

auto delay、快进速度、音量等是偏好；剧情规定的不可跳过演出是包规则。字幕先显示合法文本，不能因声音语言缺失而读另一语言的未知内容。声音同步合同见[媒资规格](03-MEDIA-PRODUCTION-AND-BINDING.md)。

### 3.1 当前原生阅读/播放增量

`AvgRuntimeModuleV2.reading` 是显式可选的 `storyforge.avg.reading-plan@1`；缺省省略字段/能力，不升级旧 V1 或既有无 reading 的原生包。它冻结手动 wait/interrupt、失败 pause/continue、有界最大等待、默认阅读余量，以及 line/asset/text/textRevision/speaker/locale 的准确逐句绑定。编译拒绝旧文本/版本/人物/语言、缺音频、错误 kind/MIME/时长，以及同一句同时走旧 voice Cue 的双重播放。一次性 SFX 不准循环，持续环境声音使用自己的声道。当前 reading 参数仍为明确组装草稿，正式声音采用/生产集成不从此 codec 自动获得授权。

会话仅在该能力启用时增加 `avgReading: storyforge.avg.reading-state@1`，保存冻结阅读计划/句目录、当前播放请求/结果与有序历史；来源/初值/备份继续校验实际不可变包，缺失或替换阅读状态拒绝。旧 JSON 缺省不增加字段；无新表/迁移、Context Source、AI 写域或模型调用。

`commitAvgVoiceCommandV1` 是新的受治理 CAS 命令。start 只记录播放请求；generation 由系统单调递增，不能由旧 DOM 回调重用。observe 分别记录 ended、failed 或作者允许的 interrupted，以及真实媒体 currentTime 观察得到的 playedMs/原因。过期句/visit/generation、越权打断、已终结回调和通用 append 绕过均拒绝，不留半个事件。它证明传输结果，不证明听见了声音、配音内容正确或艺术质量通过。自动阅读等规范句文本、显式 Cue 等待和合法 voice 结果；后端到句命令也执行声音屏障，不能只靠 UI 计时。

播放控制器按 session/visit/line 取消旧 generation，菜单/后台暂停实际 Audio 与活动等待时钟；恢复继续当前位置，读档中断则新 generation 从句首开始，已完成声音不因刷新重播。play() 权限失败、解码错误、资源缺失和最大活动等待超时是具体失败，按计划暂停或允许继续；重试产生新 generation，静音继续/手动推进只有作者允许时写 interrupted，不能冒充 ended。各个显式 SFX Cue 使用独立播放身份，同一 clip 的后续 Cue 可重播；已结算的历史 SFX 不随旧档无条件重放。音乐/环境仍从持续舞台目标恢复。

文本历史按实际结算的 line 和 choice 追加，保留 visit、规范文本/版本、当时说话人、音频引用/结果/播放位置；重复访问不去重。历史随 checkpoint/分支/备份恢复，当前版本有 100,000 条显式保护上限。回听只加载已读条目的真实 clip，不调用规则、Cue 或阅读命令；菜单退出即取消回听。读者设置使用浏览器独立偏好键，分别保存主音量/音乐/环境/音效/配音、文字速度/图像/减少动态/静音和阅读余量；自动播放/快进不持久启动，不写 Work/Project 或世界。

当前技术验证使用原创 PCM 校准音及有意损坏的测试字节，真实浏览器解码/ended/暂停/重试/超时，不能冒充专业人声、TTS、连续混音或长作品性能验收。按场景有界资源 cache、完整可访问性/设备与整作规模、正式作者工作台、实际声音生产/采用仍需后续工作，不因本增量关闭整个 03A 或框架目标。

## 4 舞台与声明式导演

导演消费已采用脚本与系统规则，输出注意目标/景别/空间、角色/外观、背景/CG、光影、转场、镜头、声音/静默和等待依赖；不能修改台词事实、知识或分支后果。

`ActorPlacement` 目标字段：actorKey、appearance/pose/expression variant、assetBinding、anchor、crop/safe region、position/scale、facing、layer/coordinate space、visible、transition。坐标/层域和朝向白名单冻结；缺少组件能力时采用作者允许的完整 PNG 替代，不能声称已实现可动角色。

Cue 必须来自 renderer 支持的有限目录，带 cueKey、line/event 引用、起止/等待、最大时长、打断及恢复语义。可复用现有 Cue 的功能，但新增语义须新版本 parser/编译测试；模型不能嵌入任意动画/网页代码。

短动画、相机移动和一次性声音恢复到约定安全边界；持续背景/角色/BGM/环境有状态快照。voice/SFX 不默认从中途毫秒重播；保存和恢复粒度在下一节明确。纯文字预览执行相同规则而省略允许的表现，不能跳过必须观察的行动条件。

## 5 物品、证据与其他可选系统

### 5.1 物件定义与实例

物件定义最小字段：itemKey、公开名称/描述、category、unique/stack policy、合法状态、owner policy、可见/可查看条件、actions、icon/detail/剧情特写 consumer refs；实例保存 instanceKey、definitionKey、holder、quantity 或唯一存在、state、获得/变化事件。未开封/已开封是正式状态，不从不同图案猜状态。

| 命令目标语义 | 校验和结果 |
|---|---|
| gain / transfer | 合法来源/目标、唯一/数量上限和权利；不重复发唯一信封 |
| inspect | 当前允许查看的描述/细节，记录检查及明确的知识变化；重复检查不会重复奖励 |
| use | 目标类型、位置/状态/前置、消耗规则、效果和反馈；不默认所有物品都会消耗 |
| present | 指定人物/问题/证据槽、合法回应和结果；出示证物默认不等于丢弃，消耗须明确写入规则 |
| change-state / remove | 定义中的合法转换、数量及来源；非合法转换拒绝 |

inventory 列表消费 icon，证据详情消费 detail，剧情特写消费 CG/stage binding。遮掩的姓名/日期等来自公开 UI 字段与当前知识，不直接把生图文字当案件事实。物件拥有者、玩家已知内容与物件真实秘密分别保存/投影。

### 5.1.1 当前原生物件增量

`AvgSystemPlanV2` 明确增加 `storyforge.avg.inventory-plan@1`，旧 system-plan@1 的严格 parser、字节和能力不变。只有嵌套规则 V2 的原生 Package V2 声明 `avg.inventory`，definition.rulesetVersion 与规则版本精确匹配；未知版本/未声明能力拒绝。仍由冻结 human-import 任务暂存/正式确认 `avg.system.plan`，不启用专业 AI。会话规则 envelope@1 按嵌套 plan 的真实版本分派。

本轮采用有限实例模型：定义声明 unique/stack 上限、合法状态/转换、公开视图/有条件变体与 icon/detail 引用；每个实例有稳定 key、holder/quantity/state/inspected。唯一物件只能声明一个实例；holder 为 player、已声明人物或 `@none`，后者与零数量必须成对。不支持运行时任意生成实例、隐式合并堆叠或从图案推测知识。状态在 `avg.inventory.instances.<key>.*`，一次操作证据在 `avg.inventory.actions.<key>.performed`；无独立物品表。

有限物件操作声明 verb、准确 target、适用场景、visible/enabled、once、effects 和 feedback；代码校验 gain/transfer/change-state/remove 的实际后果。inspect 只能首次获得奖励、不能顺便改变持有物件；重新打开详情为只读。present/use 仅执行明确效果，出示不会自动消耗。所有 effects 仍复用共享 set/increment/unset 和类型槽检查；逐效果检查范围/合法状态转换，整批结束检查 holder/quantity 一致性，配对的数量/持有人写入只有一个原子提交。

`commitAvgInventoryActionV1` 是唯一新增持久命令：验证实际冻结来源、active 会话、CAS 基线、操作/目标和命令身份；相同命令幂等，重复奖励/错目标/过期基线/非法后果不追加事件。`avg.inventory.action.committed` 在同一产品 adapter 重放，随后重算剧情选择；不进入场景、不伪造剧情选择历史、不重复入场/Cue。脚本/规则不能自行写 inspected/performed 系统证据。

玩家投影仅返回当前持有且可见的物件；首次匹配的公开变体决定名称/描述/媒体。未知描述、他人持有物件、隐藏变体和回应正文不出现在 inventory API/UI 中；冻结本地包本身不是加密的防剧透容器。图标复用 `ui` 媒资 kind，详情复用 `ui/cg`，两者必须存在于实际冻结目录，Blob/hash/owner/Preview 物理绑定沿现有 resolver。显示图片不改变任何知识。切换分支时只有 resolver 与其 source session 已就绪才预加载，响应按 resolver 身份重新消费；取消的旧请求不签运行测量，释放中不新建 URL。

背包菜单只在存在可用物件投影时出现；旧来源缺省隐藏。列表/详情、操作原因/回应、键盘按钮与移动布局复用玩家面板，打开面板暂停自动/快进推进。物件、知识和操作证据随现有 checkpoint/分支/备份/重映射/删除恢复；不建第二存档体系。真实图像技术验证使用原创固定 SVG 几何与隔离 Blob，不作为商业美术或自动生图能力证据。

### 5.2 其他模块

| 模块 | 目录/状态 | 有限行动与反馈 |
|---|---|---|
| 热点/地点 | locationKey、region/label、可见/可用条件、已检查、目标消费槽 | inspect/move；键盘可选列表与触屏同结果；区域失效不能继续点击旧对象 |
| 话题/关键词 | topicKey、discover/known、合法人物或思考对象、已用状态 | ask/think；回应引用正式场景/效果，未知关键词不能泄露回答 |
| 消息/手机 | thread/messageKey、发件显示、已投递/已读、合法回复/期限和影响 | open/reply；投递由冻结事件触发，重载不重复投递；不引入真实通讯 |
| 档案/鉴赏 | entryKey、文本/图/音消费者、解锁事件和防剧透条件 | read/replay，只读隔离；未解锁项不返回隐藏 payload/媒体 |
| 路线回顾 | 已体验节点/结果、可展示标签、允许重访方式 | 回放用独立只读投影；重开游玩则明确创建新会话 |
| 提示/辅助 | hintKey、分层提示、使用/重试政策、正式 solutionAction refs | reveal/assist；不调用模型临时解题；模式切换有事件和进度标记 |

菜单组件只有对应模块启用、包里引用闭合并存在可用数据时出现。小游戏/计时审判/3D 物件检视需要后置专项能力，不能用上述按钮和一张静图宣称支持。

## 6 存档、跨周目进度与偏好

存档身份 pin 到准确 ProductRelease 或受治理 Build Preview 的 package/hash，不只保存 sceneKey。槽是同一 checkpoint 的用户标签/缩略图/时间/位置引用；自动、手动、快速操作复用 checkpoint API，不能各建一套状态。

| 保存域 | 保存/恢复策略 |
|---|---|
| 当前剧情 | 位置/visit、选择、变量、知识、关系、物件、消息、热点和结局，同一事务 checkpoint |
| 持续表现 | 背景/角色/合法变体、镜头稳定状态、BGM/环境目标；恢复前取消旧 transport/playback |
| 阅读位置 | 安全句/Beat 边界和显示状态；存档请求遇到未提交效果先结算或明确等待，不捕获半个事务 |
| 一次性媒体 | 不保存 DOM/Audio 对象；目标按声明从句首恢复 voice，或保持已完成状态；SFX/动画不无条件重复 |
| 作品进度 | `avgPlayerProgress` 的已读/结局/鉴赏是跨周目域；从真实事件派生，读旧档不抹除已解锁，也不把解锁变成角色知识 |
| 玩家偏好 | voice/BGM/SFX 音量、文字速度、auto/skip、减少动态、语言；在应用本地设置单独持久化 |

目标跨周目作用域是 Work + 本地 profileKey + portable productKey，记录语义 key/version、实际 release 与事件来源。产品版本之间仅合并经兼容检查的已读/解锁；改过正文的句不沿用旧“已读”。导入到新 Work 按注册表 remap；默认不混入另一读者的进度，进度导出/清理须明确选项与隔离验证。

加载验证 owner、package/hash、codec、checkpoint 完整性和资产闭包；失败保留原档并说明缺口。缺媒体按作品声明降级，损坏规则状态不“尽量恢复”。V1 存档继续绑定 V1；没有受审的显式 migration 就不能给 V2 使用或静默升级。

回退/重访单独声明政策：首批只从合法 checkpoint 创建新分支会话，不把历史回听或直接跳 scene 当作状态回退。可选路线图任意跳转、逐句 rollback 和跨 release migration 后置，需明确物件/知识/消息/解锁与一次性声音的语义。旧 V1 的正常新游戏/继续/保存/分支恢复仍回归，禁止改写旧包不意味着禁用这些操作。

线性、分支及启用物件的会话分别回归：选择前后、出示前后、消息投递前后、重复检查、auto/快进/后台切换、失败恢复、刷新及离线资源缺失。解锁导入、删除一个 Work 和多个 profile 的反例属于数据生命周期验收。

### 6.0 原生一次性音频的持久播放回执（定向/原生验收，完整整合 CI 待验）

九媒资实际浏览器组合揭示：仅检查当前 DOM 的 ended 无法跨刷新保留完成结果，SFX 与非循环环境音会重播。原生 V2 在既有 presentation 中增加可省略的 onceAudio 回执；旧包、旧初态和无回执状态的序列化不变，不新增表、迁移或 AI 写域。持久事件仍归 AVG instance，通过专用 CAS 命令追加；Work/世界、冻结规则、媒体字节和 Release 不变。

回执绑定冻结 cue/beat、实际 visit、音频 key/hash、声道和单调 generation。先持久 requested 再启动实际播放，真实 ended/失败才结算；替换同声道将旧请求标为 superseded，不声称听完。已结束、失败或已替换不自动重发；刷新遗留 requested 明确显示结果未知，只有读者点击重播才发新 generation，不能据此宣称物理播放恰好一次。循环 BGM/环境继续采用原目标恢复，逐句 voice 沿用 reading 协议；历史回听只读。非循环 BGM/环境播放可跨句；SFX/旧 voice Cue 保持当前句调度边界，回调校验原 session/generation，过期、已终结、错 asset/hash、通用事件旁路一律拒绝。

回执只保留最近一次触发时实际 visit 的各 Cue 及每声道最后一项，最多该冻结舞台 Cue 数加四；完整历史保留在现有事件。不同 Cue 引用同一片段、合法重访和新游戏仍可触发；菜单/静音保留当前 transport。checkpoint、分支脱离父档、完整备份/remap/delete 复用三个运行表的注册生命周期，payload 不嵌入本机 owner ID。正式新游戏不准预置回执，分支必须有原事件来源证明。验收保留原真实刷新断言，不以放宽测试签收。

本轮新增7项包含在12文件78项关联回归中，不重复计数；16项工程检查通过。真实Chromium新增4项与原有15项共19条不同路径首遍通过：100毫秒SFX/非循环环境音结束后刷新保持回执且零重播，未知请求明确恢复、真实解码失败/新generation、原阅读/菜单/静音/声音Cue/规则与存档兼容。只读帧证据同时捕获SFX0.032秒、BGM0.049408秒、环境0.013343秒、voice0.049418秒，四条真实playhead均在各自时长内；没有改变音频、伪造ended或拉长旧时限。额外并发用例首轮只记录playing起点和ended终点，未采到中段而失败，原报告/trace保留；只补有界只读帧采样后新增4项全过，产品字节与原15项及78项通过时相同。完整九媒资整合、准确源码完整CI和艺术/专业审听仍另验。

### 6.1 分支脱离父存档后的来源记录

父存档定位引用可按既有生命周期删除/置空，不能兼任分支起点的唯一语义证据。原生 AVG 分支在产品会话自身的 `canonSnapshotJson.avgBranchOrigin` 保存 `storyforge.avg.branch-origin@1`：准确 runtimeSourceHash、分支初态 hash、父初态 hash、父事件前缀 hash、分叉事件序号和规范回执 hash；不含本地父 id、凭据、媒体或世界写回。它是本地完整性与来源绑定记录，不是第三方签名或真人试玩证明。新游戏仍按 release/preview 的入口状态严格校验，不从调用方声明的分支标签跳过。

正式分支 API 根据真实父状态/事件物化初态并生成记录；读取、导出、导入共同重验 schema/hash、零序号初态及冻结来源，再允许原生分支起点。已有且仍保有父引用的原生分支，在删除父档的同一事务内，以真实父初态及事件前缀重建并比对，再补记录并置空定位引用；不猜测早已丢失全部来源证据的孤儿初态。无新表/迁移，旧 V1 和其他产品的删除语义不变；旧分支无该字段且父引用仍有效时继续兼容。删除后子档仍须独立可读、可备份/重映射并可再分支，损坏记录或错源必须拒绝且不破坏父/子数据。

隔离回归 8 项通过：真实阅读/选择后删除父档、再次分支、两轮备份 remap、旧原生分支补记录、三类篡改在读/导出/导入拒绝、父删除原子回滚、新游戏不能预置历史或带分支标记。共享运行/冻结来源、旧 AVG 自循环和文字开放世界来源另 4 文件/16 项通过；真实作者媒资 Preview 的快速存档→分支→刷新→切回原档→删除原档→重新选择子档浏览器路径通过。完整集成 CI 另记，不能据定向证据签整体框架完成。

## 7 渲染消费与技术验收

stage、dialogue avatar/voice、inventory、evidence detail、menu、gallery、archive 都声明自己的 consumer contract。renderer 只接收冻结且当前有权可见的数据；未知 consumer/kind、跨作品资产、遗漏必需图或旧文本配音均拒绝进入新 Build。打开详情失败不会改变库存或知识。

验收证据须包含：有限规则正反例、路径/结局可达、事件重放等于 checkpoint、幂等/过期命令、句/声音打断、隐私/知识投影、各消费槽实际显示及真实保存恢复。无图/静音只证明允许的降级路径，不证明有声视听效果。

当前接入点：`src/lib/avg/authoring-contract.ts`、`src/lib/types/avg.ts`、`src/lib/types/narrative-blueprint.ts`、`src/lib/types/product-release.ts`、`src/lib/product-production/product-adapters.ts`、`src/stores/avg-game-player.ts`、`src/components/text-game/AvgGamePlayer.tsx`、`src/components/avg/StageAudio.tsx`。路径存在性和具体调用方由工作包开工时复核；共享类型改变先经 AVG-BASE-00，不另建发布/runtime 框架。

## 8 性能、资源、设备与语言边界

原生 V2 player 已使用 §0.5 的当前场景/实际舞台/公开物件/已选回听窗口，静音按 §0.8 保留当前传输源；旧 V1 仍走原目录路径。resolver 的默认编码字节预算为 64 MiB，窗口替换实际回收旧 object URL/原始字节 cache；这不等于解码图像/音频、DOM 或总 RAM 都受同一上限。商业候选不能靠增大该数加载全作。未选路线/未来模块按用途加载，异步旧结果不能覆盖新位置；未实测的峰值 RAM、完整设备、长作品和冷启动离线壳继续保持未验收。

| 项目 | 设计验收 |
|---|---|
| 设备/性能 | CAL-00 冻结真实硬件/OS/browser、画幅/语言/资源大小、cold/warm 条件与数值上限；首戏暂定本地冷启动 ≤5s、已就绪资源下操作确认 p95≤100ms，排除作者声明的阅读/Cue 等待；实际测量后保留 pass/fail/unknown |
| 内存/资源 | 分别记录编码 cache 上限、解码规模/实际可测峰值、重进场/连续换图/回听时释放；未测 RAM 不宣称低内存，不能只验单张 PNG |
| 存储/配额 | 导入/生产前检查必要 Blob 闭包与可用空间；配额失败不删除旧档/已采用资产、不留半包正式 release，保留重试/清理说明 |
| UI/输入 | 键盘/触屏/focus/关闭菜单/静音/减少动态、安全区/长句/字号、窗口 resize 和背景切换；实际目标设备各测，不由 desktop E2E 代证全部设备 |
| 本地化 | 首批 zh-CN；未来 text/voice locale 分开冻结，稳定 line 关联 locale 文本/hash/读音/clip、姓名/字体及 fallback；缺/旧翻译不可静默串到另一语言 |
| 离线/故障 | 本地包真实缺 Blob/解码失败/慢加载/声音权限/刷新/离线安装；显示有限结果，不用永久 loading 或隐藏模型请求恢复 |

数值是拟定 Pilot 工程目标，不是已达成绩或全设备承诺，最终条件由对应 Brief/CAL-00 冻结。02A2 声明布局/消费能力，03A 负责加载/运行与观测，07 负责实际交付环境；新增语言制作/高级 renderer 需独立 typed schema/权限/回归，不在 Settings 中选上就算支持。

接口取舍参考 [Naninovel 1.21 资源/内存政策](https://naninovel.com/guide/resource-providers)与 [Ren'Py 8.5.4 保存/回退文档](https://www.renpy.org/doc/html/save_load_rollback.html)（2026-10-13 核对）：本方案采用按消费者/场景控制资源及明确恢复边界；不引入这两套引擎，也不推定它们或 StoryForge 跨版本档案必然兼容。


多声道同时未确认或失败时，播放器在统一有界恢复区按音乐/环境音/音效/配音分别标名并提供独立按钮，菜单/设置保持可操作；只读恢复提示不改变generation或播放结果。每次明确重播仍校验当前instance及准确Cue/visit，不静默重发其他声道。详见工作包§9.28；该表现修复已完成独立工程/原生/双视口截图验收，九媒资整合与准确源码完整CI继续另验。

R2的16项工程和新6/旧19共25条原生均通过，但实际390px截图复查发现第二张恢复卡被声明比例的舞台裁切。保留该轮源码、截图和报告，不把自动化全绿当作视觉通过；恢复区现移到完整播放器main、位于舞台裁剪层之外，保留原舞台比例和音频命令，新增自动滚动前的两按钮中心真实命中检查。修订后仍须重新通过工程、双视口与旧路径，并实际复查截图。

R3修订后，16项工程与新增6/原有19共25条真实浏览器路径首遍通过，无flaky/跳过，所有阶段源码稳定。实际复查1280×720及390×844截图：两声道卡片与按钮完整显示，顶部历史/设置可达；两个按钮在自动滚动前均通过elementFromPoint实际命中，分别重播只递增本声道generation。生产变更仅声道标名、恢复区位置/布局；底层命令/store/runtime协议与§9.27的78项已验字节完全一致，未声称重跑78项。新增模型调用0。该包局部验收通过；准确九媒资完整路线、同一成功导出关闭工厂恢复、报告门和最终完整CI尚待整合，艺术/真实审听/商业验收仍独立。

组合R4的元数据12项、工程16项、辅助2条、完整九媒资制作与同一成功末尾导出关闭恢复各1条、实际报告/hash门均首遍通过且源码稳定；但390px实图复查发现同时启用制作台返回及物件后的10项工具栏左侧被裁，原scrollWidth检查漏掉负坐标。成功备份及全部R4证据保留，不把自动化全绿签成视觉通过。新320/390两条小流程在原CSS上均准确失败（含原CI重试），随后仅让窄屏工具栏按现有按钮尺寸换行；新增每个控件自动滚动前的完整边界/真实中心命中、真实物件/历史操作，并把同一检查接入制作与关闭恢复例。原运行/音频/媒资/采用/数据库字节和所有既有断言/重试/时限不改。后继R5需先验4条小流程/截图，再验准确整合九媒资、同备份关闭恢复、报告门及完整CI；不代签艺术/实际听感/商业品质。

组合R5分支验收（2026-10-22收口，原准确源码91ae2ef3）：4条辅助/320与390px流程、12项报告门回归、16项工程门，以及完整同Work九媒资制作、同一成功末尾导出的五工厂关闭/无Key恢复和实际报告/hash门均已通过；各阶段源码稳定，无flaky/跳过。实际窄屏截图已复查，工具栏十项边界与真实中心命中保持；原R4裁切与其他失败、原重试和时限全部保留。唯一产品变化是窄屏工具栏换行，原运行/音频/媒资/采用/数据库逻辑不变。原14项WIP已按原暂存/未暂存补丁及完整源码hash恢复，全部stash/备份继续保留；本次仅更新验收文字，CI/生产/测试字节与原已验树相同。该包交付受控九媒资路线和CI报告门，不代表当前新前景/音频加工版本或真实美术/审听通过；最新共同版本串行整合与最终准确源码完整CI继续后继，未合入主干或部署。

2026-10-22文档收口还需如实报告既有Skill时效失败：36项已超过45天；共同版本已完成其登记的113项回归复验，但本包不借此改写旧Skill日期。此历史包的16项工程通过仅归原日期/准确源码，当前时效与最终CI仍须共同基线独立收口。
