# AVG 媒资需求、真实生产与自动绑定

> L2 · 版本：1.1.0 · 生效：2026-10-13 · 受 [AVG 产品契约](../AVG.md)约束。
> 目标合同覆盖从用途/参考到实际字节及消费者；当前只有 Prompt/文本锚点的路径不能宣称参考生图或配音已实现。

## 1 需求先于生成

每项需求先声明给谁用、为何用、需要哪些事实与参考，再选择能力和生成/导入路径。通用 `ProductMediaKind` 的九类继续使用；同为 ui 的物品图标与菜单装饰不能因此具有同一消费者。

目标 `AvgMediaRequirementV1` 的逻辑字段：

| 字段组 | 必需语义 |
|---|---|
| identity | requirementKey/revision、familyKey、subjectKey、用途/消费者和准确上游工件 |
| purpose | mediaKind、消费 domain/slot、场景/句/状态/语言，required、允许 fallback 及其艺术影响 |
| content | 公开事实、情绪/行为/信息目的、必要细节、禁止变化和禁止泄露 |
| visual/audio brief | prompt/negative、尺寸/比例/alpha、安全区/锚点，或 duration/loop/channel/混音/配音版本 |
| references | 真实已授权参考的 asset/hash/revision、角色、使用目的和允许变化；非纯文本描述 |
| production policy | generate/import/reuse/edit、所需能力、数量/尝试上限、数据发送政策、权利与费用约束 |
| acceptance | 技术检查、家族一致性、实际消费者尺寸/连续场景、专业/作者审听查看要求 |

系统生成 owner、实际 hash/版本/成本/receipt。需求的 prompt 是生产输入，不能冒充候选图片、配音或已消费证据。

## 2 媒资家族与用途

| 家族 | 典型产物 | 消费者和连续性要求 |
|---|---|---|
| 人物基准参考 | 身份/服装/比例/配色、必要转面或特征基准 | reference-only；被后续生产实际消费，不能默认上舞台 |
| 角色立绘 | 同人同服装的姿态/表情/状态、必要差分与 alpha | stage actor；对齐锚点/尺度/轮廓，换表情不漂移身份 |
| 对话头像 | 指定裁切/朝向/表情与显示身份 | dialogue avatar；不是缩小整张立绘塞进任意框 |
| 物品/证据图标 | 可辨轮廓、状态和选中/不可用视觉 | inventory/case list；按冻结设备实际小尺寸查看 |
| 物件详情 | 与 icon 同物件的细节/可观察状态 | evidence detail；可读文字由合法 UI 数据，图不能发明真相 |
| 场景背景 | 同地点/机位的昼夜/天气/事件状态、角色站位空间 | stage background；地理/消失物与光源保持合法 |
| 关键 CG | 剧情动作关系、视角、人物/物件/环境组合 | stage CG 或 gallery；事后鉴赏按实际解锁 |
| UI/菜单装饰 | 框/面板/按钮皮肤、安全区、状态与主题 | menu/dialogue/inventory 的明确槽；可访问性文字由 UI |
| 地图/档案/关系板 | 正式地点/事实的可视结构与装饰 | archive/location/case-board；只投影当前允许信息 |
| BGM/变奏 | 主题、情绪转折、循环段与静默 | music channel；衔接和循环须在场景中审听 |
| 环境与 SFX | 连续环境、一次性动作/反馈、必要变体 | ambience/sfx channel；持续与瞬时不混，关键事件有准确触发 |
| 配音 | 定稿台词、人物/语言/演法对应 clip 或带可靠对齐的片段 | dialogue voice；实际音频、句匹配、读音/表演与连续对白 |
| 高级层/动作/视频 | 分层角色、特殊特效/视频等能力特定产物 | 后置明确 renderer/恢复合同；不在首场景默认采用 |

封面/商店宣传是 marketing 用途，可以复用授权且信息合法的主体，但不能自动加入 runtime 资产闭包。视觉参考也不因为“被生成器使用”而自动成为作品可公开内容。

家族先冻结主体基准及允许变化，再生产必需变体。每个候选记录 family/subject、参考版本及加工 lineage；作者改身份基准使相关变体 stale，不使无关地点背景全部重生。

## 3 真实参考与 provider 请求

目标 `ProductMediaRequestV2`/AVG 适配扩展保留 V1 文本路径，新增真实参考和 voice 所需类型化输入。公共字段必须有 AVG 与另一真实调用方需求证据；否则留在 AVG adapter，不能扩大中立世界协议。

每个 `ReferenceInput` 指定 assetRef、contentHash、MIME、字节/受控读取句柄、purpose（identity/pose/composition/style/detail）、crop/mask（如能力支持）、授权与数据分类。模型看到的文字“角色 A 基准图”不是参考传输成功。

运行前冻结 capability snapshot：provider/model/endpoint、支持的输入/用途/格式/尺寸/alpha/mask、数量与文件上限、async 状态/查询机制、计费上界、授权/数据政策及实际账号可用性。官方文档能力与当前账号可调用性分别取证。

传输回执保存实际送入参考的 hash/处理版本、参数、operationId、已知费用/用量和实际返回。provider 不支持某参考类型则拒绝或返回作者改路径；不丢参考继续文本生图后称身份受控。

结果未知时先查询既有 operation/receipt；无法判定则停在未知，禁止自动再发一笔。网络瞬断、有界重试、授权/余额/4xx 和单次计费分别按 Harness 处理。收费尝试、参考处理和废弃候选都计入成本；无价格/用量证据不记零。

研究中列出的参考生图/语音接口仅是技术候选，本设计不锁定供应商、报价或商用效果。[研究记录](../../audits/AVG-PROFESSIONAL-METHODS-20261013.md)中的非商用研究代码不能作为商业默认生产底座；外部服务的权利需按实际输入、账户/套餐和输出条款核验。

## 4 候选、加工与采用

生产阶段：需求冻结 → 主体参考确认 → 能力/预算/数据授权 → 真实生成/导入 → 字节检查 → 有界加工 → 单项/家族/合成评审 → 作者采用 → typed binding → Build 验收。

| 阶段 | 保存证据与失败处理 |
|---|---|
| 返回候选 | 原字节/hash、请求/Run/operation、技术 metadata、权利及成本；空字节/坏格式不转为成功 |
| 加工 | 裁切/缩放/alpha/音频裁段或响度处理的工具/参数、input/output hash；保留原候选，不原地覆盖 Blob |
| 技术审查 | 尺寸/MIME/alpha、可解码、声道/采样/时长/截断/循环；检查结果不等于艺术通过 |
| 专业审查 | 真实图/音与准确参考、身份/比例/轮廓、姿态/光线、读音/表演/混音、实际小尺寸与连续展示 |
| 作者采用 | 看/听准确候选及费用，接受或拒绝；采纳的是版本/hash，不是“以后自动生成的图片” |
| 复用 | 相同合法字节可共享 Blob；用途、可公开信息和绑定仍单独验证 |

图标目标尺寸由设备 Brief 冻结，可先以 32/48 px 为测试点；这只是拟定观察尺寸，不能宣称已达清晰度。立绘透明边缘、脚/视线锚点和文字安全区要在最终舞台中检查，不能只看单图大预览。

无 alpha 的候选只有声明允许背景或经合法处理后才能进入透明立绘用途。当前特定 provider 的抠图路径不自动适用于所有生成器、参考物件或图标。物品可读编号/邮戳/日期等由正式状态与 UI 文本呈现，不能让生图错字修改剧情。

缺观察能力的 reviewer 只能给技术/文本意见，艺术项为 unknown，转交可观察模型或人。身份漂移、知识泄漏、物件状态错误及关键配音错句是 blocking；不能用其他好图/高分抵消。

在完整工厂前，CAL-01 分别查看一个必要人物/物件家族和短对白的真实输入/输出、用/废率、修图/修音/审听与费用。不能只记参考接口“可调用”便扩大，也不能等所有专业岗位/编辑器完成才发现基本身份/演法不可用。若目标需专业人工画图/加工/录音，可作为明确授权的 import/edit 候选，记录实际工作/权利/费用并走同一 typed adopt；人工后的成绩与原始自动生成成绩分别报告。

## 5 配音生产合同与播放交接

配音需求以正式台词绑定：lineKey、speakerKey、locale、textRevision/hash、performanceRevision、voice preset/version、发音词典、言语行动/情绪原因、前后句及速度/停顿/强调边界。演法版本与文本版本分开：改字使旧音频 stale；同字不同演法生成新 clip，不能覆盖旧 release。

voice preset 保存合法来源、可用模型/语言与权利范围；不默认克隆演员、用户或第三方声音。配音主体与字节留在 AVG 产品层，世界只提供人物语义。旁白、别名、部分配音的范围必须在 Brief 中声明，未覆盖句按允许静音政策运行。

| 产物形式 | 采用条件 |
|---|---|
| 单句 clip | 实际音频与准确句/文本匹配；读音/演法/首尾/连续接话审听 |
| 多句/对话片段 | 有实际可验证的逐句 timing/边界和 speaker 对齐，或作者只按整个片段消费；不能根据字数猜切点 |
| 片段裁切 | 保留原音频与裁段工具/边界、真实对齐来源和输出 hash；切错/漏字/串人物拒绝 |
| SSML/情绪参数 | 仅发给该 model/voice/locale 确实支持的能力；不假定所有 voice 支持同一 style |

采用音频记录 duration、codec/声道、必要 timing、文本/演法/音色版本、技术/艺术/人类观察和成本。实际 audio ended/abort/error 交给播放协调器；播放开始回调不等于播放完成。

voice、music、ambience、sfx 分用途音量/混音；BGM/环境循环、一次性 SFX 叠加上限和对白可懂度在连续场景检查。换句、回听、快进、读档及离开播放器取消旧 playback generation；后台政策和失败结果见[系统规格](02-SYSTEMS-AND-RUNTIME.md)。无浏览器声音权限时显示必要操作，不默默等到超时。

## 6 typed 消费绑定与自动配置

目标 `AvgMediaBindingV1` 字段：bindingKey、requirementKey/revision、subjectKey/familyKey/variantKey、consumerDomain/consumerKey/slot、scene/line 或 event（适用时）、locale、state/visibility condition、layout/anchor、required/fallback、assetKey/blobHash、采用/处理/上游 revision。

`consumerDomain` 是 AVG 闭集：stage、dialogue、inventory、evidence、menu、gallery、archive、marketing、reference。各域有独立受校验的 consumerKey/slot，不用通用字符串打开任意组件。

| 示例需求 | 正确自动配置 | 必须拒绝的配置 |
|---|---|---|
| 信封 icon | inventory item 图标槽，状态/可见条件对应正式物件 | 当作 ui 一律 set-overlay，遮住整张舞台 |
| 信封 detail | evidence 详情槽，未开封可观察信息与公开文字 | 详情直接展示尚未获得的信中秘密 |
| 人物表情 | stage actor 指定主体/外观/锚点 | 只按图片数组顺序猜人物和左右站位 |
| 人物头像 | dialogue avatar 指定说话人/显示身份 | 把 reference-only 人物基准当成公开头像 |
| 背景/CG | 指定场景/事件、舞台槽、视角和导演时序 | 绑定不存在 Beat，或每张图都展示一遍假装覆盖 |
| 逐句 voice | 准确 line/text/演法/语言的 dialogue clip | 同 beatKey 但文本已改，仍沿用旧对白 |
| 菜单/鉴赏 | 合法 menu 槽或已解锁 gallery entry | 为消除 orphan 把宣传图/锁定 CG 强塞剧情 |

自动绑定读取已采用需求、目录、导演与实际候选，在确定性 service 生成可预览提案；作者确认后进入 Build。唯一正确映射可自动填充，冲突/缺口必须明确定位，不让模型在 release 阶段猜。自动配置不等于自动发布。

组装覆盖检查从实际 consumer catalog 出发，包括非舞台菜单/库存/详情/鉴赏；stage Cue 的 orphan 检查不能取代全消费覆盖。必需 slot 缺失、wrong kind/MIME、跨 Work、stale 参考/文本、冲突绑定或禁止信息阻止 Build；可选缺失有可见、已批准的 fallback。

reference/marketing 不纳入 runtime 必需闭包；runtime 只冻结实际需要且允许公开的 Blob。未解锁 gallery 的资源访问遵守展示/公开边界；本地离线包不能当作加密防剧透能力，分发时记录可提取边界。

## 7 局部返修与证据

| 修改 | 最小失效与重验范围 |
|---|---|
| 某句文字 | 同句的 voice/字幕/对齐与依赖该文本的演出；其余不相关 BGM/背景可保留 |
| 人物基准/服装 | 家族的相关立绘、头像、CG 与合成；不影响无关人物和地点 |
| 物件状态/公开事实 | 对应 icon/detail/特写、条件/可见 UI 与路线消费；不得只换图不改规则 |
| 背景机位 | 该场构图、站位/CG、热点坐标和文字区；角色身份基准可复用 |
| 音色/演法 | 对应 voice family/句段、混音及等待策略；文本不因换声音自动重写 |
| consumer/规则 | 重新校验绑定、覆盖与可见性；合法 Blob 可保留，但旧 Build 验收不复制 |

返修创建新需求/候选/hash，记录保留/拒绝、费用及原因；作者锁定项遇到冲突返回裁决，不能绕过 stale。旧 release、Blob 和旧档仍使用旧输入；修复版另行冻发布并复测旧档。

技术接入点：`src/lib/types/product-media.ts`、现行媒资 gateway/transport、`src/lib/product-production/production-executor.ts`、AVG adapter、Blob/import service 与 runtime validator。开工卡负责复核实际符号/调用方；不得将整个媒资系统改成 AVG 专属或在组件中另建生图/TTS 调用。
