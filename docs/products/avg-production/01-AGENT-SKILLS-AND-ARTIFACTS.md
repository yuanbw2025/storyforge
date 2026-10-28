# AVG 专业岗位、工件与生产图

> L2 · 版本：1.12.0 · 生效：2026-10-19 · 受 [AVG 产品契约](../AVG.md)约束。
> 22 岗位/Skill 是目标合同；BASE-00B 已登记首批八种 schema、输出 key、关闭的专业 AI 写口和作者输入采用接缝，实际验证状态见实施计划。未登记的专业 Skill 尚不可调用，schema 或作者输入采用不等于岗位实现。

当前声音合同/任务图与`avg.sound-plan.v1`、技术`avg.sound-request.v1`已完成登记基础工程验收，使用受保护的`product-production.avg-sound-planning-inputs`；已连接准确策划/编译投影、模型原始响应及作者计划采用，实际音频producer、观察和选音未接通，所有正式声音开始入口继续关闭。登记不等于产生过正式Run，见[工作包§10.4](../../roadmap/AVG-WORK-PACKAGE-CARDS.md#104-正式声音制作合同任务图与登记投影基础工程验收执行仍关闭)。

## 1 主助手、岗位与确定性职责

用户面对一个 AVG 制作助手，内部按实际任务调度独立岗位；岗位不要求常驻。每个生产岗位有一个核心 Skill、唯一候选写域与明确上游，不能将所有岗位挂在 `outline` 下再称专业团队。

现有 `avg.consult.v1` 继续只承担 S2 会谈。升级为 `avg-authoring-consultant / avg.consult.v2` 时保留旧草稿读取、切换新入口并下线旧生成路由；该岗位只产生方向草稿，作者命令更新 S2 revision，不在未开始时创建正式 Build 工件。

正式 S3 岗位表中的 key 模板由计划编译器实例化为闭集；模型不能任意选择另一个 Work、scene 或输出 key。所有内容/系统/制作 Brief 写 `payloadJson`，媒资需求候选按登记 schema 写 `metadataJson`；review 只写问题工件，不写生产对象。

| Agent ID / 核心 Skill ID | 输入工件与读取重点 | 独占输出 key | 方法和禁止项 |
|---|---|---|---|
| avg-production-director / avg.production-supervision.v1 | 已确认 Brief/SourcePlan、能力和问题 | avg.governance.production-plan | 制作范围/岗位/质量基准/预算建议；不扩大授权或自报通过 |
| avg-source-editor / avg.source-adaptation.v1 | 冻结来源、需求目录和证据 | avg.governance.source-audit | 必需事实、缺口、改编/私域补充与禁止披露；不替系统生成 SourceManifest |
| avg-story-architect / avg.story-design.v1 | 来源审计、体验与约束 | avg.content.story-bible | 欲望/冲突/代价、主题、因果与回收；不代写全部分场 |
| avg-cast-director / avg.cast-bible.v1 | 故事、来源人物及允许补充 | avg.content.cast-bible | 人物行为、关系弧、声音/知识、稳定主体；不回写世界 |
| avg-route-designer / avg.route-reveal-plan.v1 | 故事/人物、线性或分支范围 | avg.content.route-plan | 结局回推、分叉/汇流、信息和选择回响；不执行变量效果 |
| avg-scene-designer / avg.scene-plan.v1 | 路线、人物、系统骨架 | avg.content.scene-plan | 逐场目标/阻碍/策略/变化、资源需求；不扩大已冻预算 |
| avg-scene-writer / avg.scene-script.v1 | 指定场景、角色声音、相邻状态 | avg.content.scene-script.<sceneKey> | 具体动作与可读对白/选择；不改规则和人物所知 |
| avg-dialogue-editor / avg.dialogue-pass.v1 | 准确剧本、声音锚点、场景目的 | avg.content.dialogue-patch.<sceneKey> | 潜台词、回应/自然度、删重复；只改批准的表达字段 |
| avg-continuity-editor / avg.content-review.v1 | 剧本、来源、路线/知识和执行投影 | avg.review.content.<sceneKey> | 事实/动机/因果/知识/回收问题；不写剧本或自审同一 Run |
| avg-system-designer / avg.system-plan.v1 | 选用模块、路线意图、主体目录 | avg.system.plan | 类型/条件/效果/物品/知识/消费需求；只产候选，不生成任意代码 |
| avg-performance-director / avg.scene-direction.v1 | 被接受剧本、规则/槽、画面声音方向 | avg.system.direction.<sceneKey> | 注意目标、空间、焦点、时序和打断；不改剧情状态 |
| avg-art-director / avg.visual-bible.v1 | Brief、人物/场景和导演需求 | avg.media.visual-bible | 视觉基准/画布/空间/风格/复用和允许变化 |
| avg-character-designer / avg.character-assets.v1 | 视觉基准、主体与外观槽 | avg.media.character-brief.<subjectKey> | 身份、服装/姿态/表情、锚点；提交真实参考任务，不以 Prompt 代替图片 |
| avg-environment-designer / avg.environment-assets.v1 | 地点/镜头/光照与站位 | avg.media.environment-brief.<subjectKey> | 同地点/视角/天气变体，避免任意换场 |
| avg-prop-designer / avg.prop-assets.v1 | 正式物件状态、公开细节与消费者 | avg.media.prop-brief.<subjectKey> | 同物件 icon/detail/特写、可读细节；不从图像创建案件真相 |
| avg-ui-art-designer / avg.ui-assets.v1 | 正式 UI 槽、主题/设备/安全区 | avg.media.ui-brief.<consumerKey> | 控件皮肤/装饰/状态和缩放；文字由 UI，不能发任意网页代码 |
| avg-key-art-designer / avg.key-art-plan.v1 | 剧本、人物/物件参考与导演 | avg.media.key-art-brief.<requirementKey> | CG/封面的动作关系与构图，区分舞台/宣传消费者 |
| avg-sound-director / avg.sound-plan.v1 | 情绪拍、环境/事件、声音预算 | avg.media.sound-plan | BGM/变奏、环境/SFX 进出、循环/静默与混音用途 |
| avg-voice-director / avg.voice-performance.v1 | 定稿句/说话人/语言、潜台词 | avg.media.voice-plan.<sceneKey> | 读音、言语行动、上下句、音色/片段制作包；不改台词 |
| avg-visual-reviewer / avg.visual-review.v1 | 真实图、基准、连续合成及用途 | avg.review.visual.<requirementKey> | 身份/比例/动作/空间/信息/文字区；未收到图不得判达标 |
| avg-audio-reviewer / avg.audio-review.v1 | 真实音频、制作包及场景混音 | avg.review.audio.<requirementKey> | 读音、演法/衔接、噪音/截断/循环；不能观察音频时记未知 |
| avg-experience-reviewer / avg.experience-review.v1 | 准确 Build、实际路径/状态/媒体、问题 | avg.review.experience.<buildKey> | 跨线意图、可理解性和操作问题；不代替真实玩家回执 |

哈希/稳定 ID、角色来源映射、SourcePlan 权限、模型路由、预算/重试、parser/规则编译、Blob/绑定、事务、事件/检查点、stale、发布/导出均由确定性服务负责，不建立生成这些事实的 Agent。

### 1.1 岗位启用与最小专业路径

22 岗位是长期能力目录，不是每个作品都调用 22 个 Agent 的默认套餐。01A 先来源/制作与故事/人物/路线；02A1 再系统骨架；01B 才场景/写作/表达/连续性；02A2 才导演/最终编译。按任务多批使用，保持唯一核心 Skill/写域；作者直接提供合法工件时仍通过同一验证/采用，不为凑岗位数再生成一次。

角色/环境/道具/UI/关键画面、声音/配音等岗位只在存在对应需求时启用，review 只覆盖真实存在且可观察的输入。线性作品的 route Skill 管理揭示/结束而非强添分支；无声范围不开 voice 岗位；未选物件不启用 prop 工厂。所需评审不能因省调用被静默跳过。

CAL-00 冻结启用清单/预算，CAL-01 提前测试最小专业路径的收益。若分离编辑提高措辞却损坏人物/事实，或相同预算下采用/人工/质量没有收益，先修方法/任务粒度，不能机械增加 Agent。专业方向、Prompt、模型、实际样本和人工采用共同决定效果；岗位名称不证明专业水平。

## 2 工件最小 schema 与 ownership

所有工件复用现行候选容器和 `product-production-artifacts` adoption extension，增加 AVG 类型化 payload/metadata validator。公共 envelope 由系统添加：Work/production/build、artifact key/revision、schema/version、producer/Skill/Prompt、输入引用/hash、实际 Context Manifest、候选/采用/拒绝/stale、Run/attempt 和预算证据。模型只返回本 schema 的语义 payload，不自报真实 hash、授权、模型版本、质量通过或发布 lineage。

BASE-00B 的确定性作者输入先绑定已冻结 human-import 任务，只写 pending；作者通过 `adopt-avg-artifact` 命令确认后，才保存正式 revision 和事务回执。此路径无 provider/模型 Run，标为 author-import；不伪造 Context Manifest、专业岗位或人工艺术质量通过。来源引用暂限 SourcePlan 的初始资源，进一步读取与专业 AI producer 的真实 manifest/receipt 由 01A/01B 登记。刷新和备份后仍检查同一 hash/版本/上游，不能用 schema 正例或自报 authorAccepted 绕过命令确认。

| payload schema（统一前缀 storyforge.avg，version 1） | 必需内容 | 确定性检查 |
|---|---|---|
| production-plan | 作品目标、岗位/工件需求、依赖建议、基准/预算及停止点 | 工件/岗位闭集、需求在 Brief 内、计划无环；正式 DAG 由代码冻结 |
| source-audit | 事实/证据引用、必需缺口、产品补充与待确认项、知识/披露边界 | 引用来自实际 manifest，补充有作者授权，不能伪装源世界事实 |
| story-bible | 承诺/主题、核心因果、角色欲望/代价、不变量、回收与结局意图 | 主体/来源/约束引用、规模和上游版本 |
| cast-bible | characterKey、sourceRef 或产品新增依据、行动/声音、关系弧、knowledge refs、显示身份 | 稳定主体、唯一来源映射、公开/私密字段投影 |
| route-plan | route/scene/choice/ending keys、信息获得、分叉/汇流、即时/延迟回响 | 引用闭合、结局条件需求及可达性；线性不虚构分支 |
| scene-plan | sceneKey/location/cast、进入/离开状态、目标/阻碍/策略/变化、拍/选择意图及消费需求 | 来源/人物知识、前后交接、主体/需求在范围内 |
| scene-script | sceneKey、稳定 beat/line keys、speaker/显示名、文本、choice 文案及动作/信息引用 | ID/说话人/版本、规则写入隔离；知识硬约束和可读长度警告 |
| dialogue-patch | base script hash、line/field、旧值 hash、新文本、理由及不可改项 | 只准表达字段，稳定身份/事实/规则不改；通过作者采用生成新脚本 revision |
| system-plan | 模块/版本、变量、有限行动/条件/效果、目录、知识/解锁及消费槽 | 类型/范围、合法转换、scope、回放、目标引用、模块依赖无环 |
| scene-direction | scene/beat、焦点/布局、声明式动作、真实事件依赖、等待/打断/恢复、需求 refs | renderer 能力、Cue/事件闭集、时长边界、有限等待，不含规则副作用 |
| visual-bible / media-brief | 主体/用途/消费者、基准与参考、允许变化、画布/锚点、必要/降级、制作方式 | 有正式主体/槽、参考 owner/version、能力/预算和公开信息 |
| sound-plan / voice-plan | 消费拍/事件、文本/演法版本、人物/音色/语言、读音/上下句、循环/混音/片段用途 | 精确文本、合法 speaker、支持的参数、片段/事件覆盖 |
| review-issues | 输入版本、位置/证据、severity/owner、允许修改、影响与重验条件、未观察项 | 位置有效、review Run 分离、blocking 不能平均掉，不能伪造观察/人类身份 |

当前实验图片批次可显式冻结 `visualReviewPolicy=author-visual-v1`，复用 `avg.review.visual.<requirementKey>` / `review-issues` 保存作者观察。其可选严格 `visualEvidence` 绑定原图 hash、按顺序的参考 hash、五个固定观察项及本次依据；缺省时旧 review JSON/hash 保持。未知和 blocking 记录可以单独确认，但不能授权选图；缺少图像基准不能声明身份/连续性通过。问题位置和返修范围限定在本项输入，修改经原作者候选/命令确认并级联失效选择和演出；执行已消费后须新 Build。这是作者输入，不开放保留的专业 AI reviewer 写口或创建独立模型/商业艺术回执，详见[媒资规格 §4.1](03-MEDIA-PRODUCTION-AND-BINDING.md#41-当前作者视觉观察与问题交接)。

实际图片/音频是 provider/import 的不可变候选，拥有字节、技术元数据、权利、成本/传输与处理 lineage；它们不是上述 LLM payload 的替代品。物理 schema、Artifact kind 和 key pattern 由 AVG-BASE-00 登记，不能因此表出现名称便绕过 L3。

脚本是 scene-writer 拥有的规范语义工件；dialogue-editor 拥有补丁而非第二套脚本。确定性采用服务验证 base/权限并应用作者接受的补丁，生成脚本新 revision 与 derived lineage，writer 后续只能读取该正式 revision。

### 2.1 专业视觉语义与需求编译基础（施工中）

`visual-bible` 与三类 `media-brief` 已增加严格语义 codec：视觉基准给出媒介/绘制/配色/光照/构图和主体保持项/允许变化，人物、地点、物件方案只为本次闭集需求提出画面描述、约束和逻辑参考选择。主体方案必须对应其岗位和准确输出 key；不能借 UI/key-art 等未实现岗位写入，也不接收模型自报的 owner、hash、许可、模型或采用证明。

独立的 `visual-planning-scope` 是作者/系统准备输入，保存准确规则/文本/画幅来源 hash、1～8 个主体/消费槽/尺寸/asset key 模板、必需细节/禁画与本项允许/必需参考目录。确定性编译复用现行图片批次/真实槽声明校验，保留作者约束和准确参考描述，输出可重算的语义提案与输入 hash；篡改后自行重算 batchHash 也不能通过对原输入的重编译核验。此处的参考目录是 metadata，不能证明实际字节、所有权或外发许可已核实。

同一较完整视觉基准可在更小后续批次中只读复用；基准最多描述 128 个当前系统已声明的主体，编译只消费本批已选主体，媒资 Brief 仍严格覆盖本批需求，未选方向不增发图片或扩展参考授权。128 是 codec 存储上界，不承诺单次模型处理规模；实际调用仍须遵守 Gateway、token/输出和任务预算。

后继基础增量登记四个独立 AVG 美术/人物/场景/物件 Agent 的唯一核心 Skill，不进入长篇主助手的 DOMAIN_AGENT_IDS；均只读 `product-production.avg-visual-planning-inputs`，只允许既有 payload 候选写域。核心方法包含具体步骤、原创正反例和语义输出合同，尚未通过实际模型证明专业效果。登记不等于调用就绪。

下一私有合同 `storyforge.avg.visual-planning-brief/version=4` 放在通用 V3 Brief 的 AVG 专属 `avgVisualPlanning` 字段，与旧 avgAssembly/avgRevision 互斥；通用 Brief 仍为 V3，旧 AVG V1/V2/V3 不改写。固定 Plan 区分原始方案接收、作者正式方向/主体方案采用、确定性需求编译、图片及原有评审/组装；模型任务不能直接产出正式视觉方向 key。预算按同一有限拓扑派生，最多一次尝试，费用未知保持 null。

新登记 reader 通过当前 Work/Build、完整 Brief/固定 Plan、实际作者开始/来源计划和规则/脚本采用证据校验准确来源；模型只收到本次主体的公开名称、作者明确用途/造型约束和本项逻辑参考元数据。完整脚本、物件真相、规则状态及原图不默认外发；主体设计只取得对应已采用方向投影，metadata-only 不得声称看过参考图。当前后端增量已通过实际 S2/开始、共享 Harness 子 Run、解析前原响应、严格原始方案 producer、作者候选/采用和确定性需求工件的受控正向路径。作者候选 V6 保留 model-proposal 来源、准确原方案和是否修订；收到原始方案不能直接得到正式方向。参考在交付 metadata 前核验同 Work、实际字节/hash 与许可声明。图片消费与工作台仍待接，保存/开始和通用 dispatch 的生产就绪门继续为 false，不能启动新 V4 生产；历史只读核验不恢复采用或调用权，原 generic 专业写口仍关闭。实际 provider 调用为 0。详见[工作包 §9.5](../../roadmap/AVG-WORK-PACKAGE-CARDS.md#95-avg-04a5-专业视觉方案与需求编译施工中)。

原图后端检查点增加独立技术操作岗 `avg-image-operator / avg.compiled-image-request.v1`，不进入长篇 DOMAIN 列表，也不代替美术/人物/场景/物件岗位的语义判断。它只消费同一当前 V4 Build 中严格 producer 接收、由准确作者采用输入重编译核验的需求；仍使用既有图片 SDK/传输、解析前响应、Blob 与 sealed producer 写口。旧 V2/V3 请求构造和原图校验只抽取共用纯函数，原 JSON/hash 含义保持。后继当前增量已复用同一作者命令接上当前 building 版本的原图观察、问题/修订、选用、消费槽草稿与演出采用；这不增加 Agent/Skill、表或 AI 写域，作者记录不等同于专业 reviewer。集成/冻结 Preview、工作台与新原生纵切面仍待接，就绪门继续 false。
## 3 三线依赖 DAG

```mermaid
flowchart TD
  I[冻结交接与能力预算] --> G[制作监督和来源审计]
  G --> S[故事与人物]
  G --> V[视觉声音方向]
  S --> R[路线 揭示与选择意图]
  R --> Y[系统规则骨架]
  R --> P[场景计划]
  Y --> P
  P --> W[分场脚本与对白补丁]
  W --> C[内容审校和作者采用]
  C --> D[导演与消费槽]
  Y --> D
  V --> D
  D --> M[角色 物件 场景 CG UI需求]
  C --> T[配音制作包]
  V --> M
  V --> T
  M --> A[真实视觉制作与评审采用]
  T --> O[真实声音制作与评审采用]
  D --> B[确定性组装]
  A --> B
  O --> B
  B --> Q[联合体验与修订]
```

视觉/声音方向可早期并行；最终生成等待稳定主体和消费者。配音等待正式文本；content review 先检查候选与规则模拟投影，Build 形成后再检查实际展示/知识/消息状态。来源缺口涉及关键事实时停在缺口，返回作者裁决/S2 重新冻结，不能让后续图像或导演填事实。

## 4 Run、上下文和有界执行

每任务冻结具体 key/scene/主体、输入 Artifact revision/hash、WorldReference/SourcePlan、purpose/允许来源、能力、provider/model、输出 schema/大小、调用/token/时间/现金或可验证费用上界、尝试数及终止策略。每批调用/token/时长/attempt 必须有具体值，不能以“自动优化”开启无界重试；总现金/人工上限允许作者显式不设，本次首轮已取得该授权。未知费用不是零；若作者设置现金硬上限而系统无法验证，停止收费调用。无总上限也须记录真实费用/unknown 和全部失败、废弃及人工投入。

模型先看目录/相关摘要，再渐进读取当前工件、相邻进入/退出状态、角色/路线或必要原文；必读/禁止由 Gateway 校验。固定前 N 条不作为来源策略；最终 token 裁剪不能删除必读约束后继续运行。

目标 Context Sources（待登记）：`avg.content-inputs`、`avg.system-inputs`、`avg.media-inputs`、`avg.review-inputs`。它们对既有 brief/artifact-inputs 做按用途/版本/权限的产品投影，不形成第二套上下文装配器。媒资 provider 只取得已确认视觉/声音资料及用途需要的信息；不默认发送完整人物秘密或源作品。

任务粒度为指定场景、主体家族、需求或评审包；一个 Skill 可以多批使用，但每批有独立 input closure/Run。并发只允许没有冲突的写域和已满足前置，最终 fan-in 对准同一 Build 输入集。

原始响应、候选、事件、checkpoint、repair 和终态 receipt 持久化；刷新继续已知 Run，不暗重发。结果未知、余额/授权问题、非重试型 4xx、stale 或预算不足必须停在可见状态。结构 repair 和创作重写分别记账；同 Skill 的有界新 attempt 不变成无限“审稿循环”。

## 5 方法卡、审校与采用

核心方法采用[专业方法研究 M01～M07](../../audits/AVG-PROFESSIONAL-METHODS-20261013.md)：当下有效的日常行为及后场回响、行动代价与路线价值、言语行动/潜台词、叙事视角与镜头语法、连续资产家族、表演/混音，以及按实际 Build 反查问题。

每个 Skill 发布时必须携带输入/输出 schema、具体方法步骤、至少一个原创正例和一个会被拒绝/返修的反例、rubric、上下文空/缺失策略、预算、stale/修复和真实评测入口。方法、Prompt、schema 和 compiler 分别版本化；修改方法不追写旧 Run 结果。

producer 与 reviewer 分离 Run/职责。若宣称独立模型评审，须使用不同 `provider + model` 并保存真实路由；同模型的独立 Run 只能叫辅助审校。文学/艺术意见仍需作者及目标玩家，schema 通过不证明表达成熟。

review 输出问题单，作者可以接受、退回或说明不采纳；blocking 不能用平均分抵消。高影响事实/关系/路线变更返回相应 owner，表达补丁不能偷改上游；模型给出“通过”不创建正式质量或人类 receipt。

注册与采用顺序：Agent/Skill → Context Source/输入政策 → FIELD_REGISTRY/schema/写域 → adoption extension/parser → 任务/Artifact key 与生命周期 → 正反例/恢复 → 真实任务校准。不要先在组件中自由调用模型，再补一张岗位表。

后继 Preview 后端现复用既有确定性组装、质量任务和共享终态，不新增模型岗或正式写域。V4 的生产读取、组装读取与冻结只读核验有不同阶段约束；冻结证明不能构造新图片请求。进入 integrating 后只能复核原已接收、producer/输入/完整工件一致的方案与原图，不接收新候选。完整终态核验纳入方向/主体的作者回执及原始输入、响应和编译证明，轻量 Preview manifest 读取不冒充这项核验。导入后通过现有零调用证明复验入口显式复验已冻结 V4 完成前缀；原始证据损坏不能重封存 root，复验不恢复采用或调用权。工作台、新 V4 原生路径和发布闭包尚未交付，就绪门仍 false；专业/艺术/真实账号与工程结果继续分开，见工作包 §9.5。

专业工作台后继增量复用公共 S2 准备/明确开始与既有作者命令，首接场景背景：已保存规则/固定文本和用途约束 → 原岗位 Run → 可编辑的视觉基准/地点方案 → 待确认版本 → 准确版本采用 → 原图片消费/Preview。`VITE_STORYFORGE_AVG_MEDIA_PRODUCTION=1` 与独立的 `VITE_STORYFORGE_AVG_VISUAL_PLANNING=1` 同时显式启用才允许此实验执行；默认关闭，读取不能变成调用。退回明确停止整批，用既有 pause/stop 留存准确原方案和作者依据，不伪造 canonical 采用或隐形创作重试。已完成方案/原图复核使用实际旧绑定，无当前凭据仍可确定性组装；还有未发送岗位时必须解析并匹配当前冻结路由。当前新 UI/原生证据与历史 57 项兼容证据分别记账，尚不签专业家族、艺术或整包完成。
