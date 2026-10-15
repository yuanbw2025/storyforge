# AVG 游戏系统、演出与恢复协议

> L2 · 版本：1.5.0 · 生效：2026-10-15 · 受 [AVG 产品契约](../AVG.md)约束。
> 目标协议与当前原生增量分开记账；旧 V1 底座不因此自动拥有新物件、消息或完整语音协调能力。

## 0 当前研发顺序与规则接缝

系统/表现框架先于专业剧情生产施工。AVG-02A1 的确定性内核提供 `AvgSystemPlanV1` / `storyforge.avg.system-plan@1`：characters、类型化 variables、带 holder 的 knowledge、按角色/维度的 relationships、entrySceneKey、scenes、actions。可使用固定原创场景独立编译和模拟；完整剧情、专业 system-designer/performance-director、AI 采用与实际 V2 玩家仍分别验收。

状态路径由身份确定性生成：`avg.variables.<key>`、`avg.knowledge.<holderKey>.<factKey>`、`avg.relationships.<characterKey>.<dimensionKey>`。路径段只接受安全标识，不允许点号层级注入或原型属性；`player` 为玩家知识保留身份。只接受已声明槽位与匹配类型的条件/效果，必需状态不能 unset。boolean、数值范围/整数、枚举和字符串长度均由代码检查；关系有界，知识逐持有人保存。

规则 compiler 输出既有 Frozen Narrative，条件/效果及转移复用共享确定性执行器；不复制状态机。`simulateAvgSystemPlanV1` 最多执行 1,000 个明确行动，并限制状态槽数 × 逐效果/路径检查总工作量为 1,000,000，返回准确规则/内容 hash、实际逐步状态和结束标记；越界或非法目标整次失败，输入和此前预览不变。图检查是结构校验，不替代条件可满足性、全路径覆盖或真实游玩。空 Beat 的规则预览不构成可玩包，不能用于绕过正式会话源验证。

纯编译内核不访问 DB/世界/模型。system-plan 是唯一规则类型来源，专业工件 codec 已可解析它，但这不授权专业 AI 写入：作者输入仅在已冻结的 `human-import` 任务中，以 `avg.system.plan` / `product-module` 暂存，再由实际 `adopt-avg-artifact` 命令确认。通用 AI/Artifact 写口继续拒绝新专业工件。已验收 `AvgRuntimeModuleV1` 的空状态/行动语义不被悄悄改写；实际接入规则须明确模块版本、严格分派与正反例，再开对应玩家能力。

### 0.1 作者规则候选与编译输入

作者规则候选采用 `storyforge.avg.author-candidate@2`，只给 system-plan 增加系统实际生成的 `storyforge.avg.system-validation@1`；其他作者工件继续原 candidate@1 字节/哈希语义，不升级旧记录。验证证据包含 compilerVersion、planHash、contentHash、initialStateHash，coverage 固定为 `structure-and-entry`。它只证明结构图与入口状态检查，不能自报全路径、可玩、专业内容或商业质量通过。

暂存前验证图、类型/范围和入口；确认事务内重新执行并重建候选哈希、来源/上游/基线与校验证据，不信任调用方自报的校验 JSON。校验仅执行纯数据与哈希，使用单个事务存活等待包裹、内部不访问 DB，避免嵌套 crypto 等待形成自依赖。篡改或错误版本拒绝，命令失败留实际回执；相同命令幂等，规则变更使实际依赖旧 revision 的脚本/工件失效，旧 payload 保留。

`readAvgSystemPlanForCompilationV1` 只为当前活动 Build 返回有作者确认回执的唯一正式规则 revision，校验 Work/Production/明确开始/Brief/SourcePlan/Plan、Build revision/epoch、内容 hash、作者命令和实际校验证据。返回准确规则/工件版本/哈希/回执，候选不能通过此入口进入正式编译。API 接缝与受控任务夹具不表示当前工作台已提供规则输入按钮；生产计划/工作台入口仍待接入；原生编译与玩家接缝见下节，分别保留其验收边界。

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
| enabled capabilities | narrative / presentation / avg.rules；规则 V2 再声明 avg.inventory | 与 Package 声明精确一致，未知/未支持可选模块拒绝 |

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

## 7 渲染消费与技术验收

stage、dialogue avatar/voice、inventory、evidence detail、menu、gallery、archive 都声明自己的 consumer contract。renderer 只接收冻结且当前有权可见的数据；未知 consumer/kind、跨作品资产、遗漏必需图或旧文本配音均拒绝进入新 Build。打开详情失败不会改变库存或知识。

验收证据须包含：有限规则正反例、路径/结局可达、事件重放等于 checkpoint、幂等/过期命令、句/声音打断、隐私/知识投影、各消费槽实际显示及真实保存恢复。无图/静音只证明允许的降级路径，不证明有声视听效果。

当前接入点：`src/lib/avg/authoring-contract.ts`、`src/lib/types/avg.ts`、`src/lib/types/narrative-blueprint.ts`、`src/lib/types/product-release.ts`、`src/lib/product-production/product-adapters.ts`、`src/stores/avg-game-player.ts`、`src/components/text-game/AvgGamePlayer.tsx`、`src/components/avg/StageAudio.tsx`。路径存在性和具体调用方由工作包开工时复核；共享类型改变先经 AVG-BASE-00，不另建发布/runtime 框架。

## 8 性能、资源、设备与语言边界

现行 player 向 resolver 传全部资产，默认压缩字节预算为 64 MiB；这不等于解码图像/音频、DOM 或总 RAM 都受同一上限。商业候选不能靠增大这个数加载全作。03A 提供按当前场景/合法相邻路径的有限预加载、必需资源 pin、旧 object URL/Audio 释放及有界 cache；画廊/未选路线按用途加载，异步旧结果不能覆盖新位置。

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
