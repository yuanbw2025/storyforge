# 10 · 媒资质量与三向绑定方案

> 层级：L2 · 版本：1.4.0 · 生效：2026-09-11
> 性质：文字冒险媒资需求、生产结果、运行引用和独立审图的正式施工合同。

## 1. 目标与边界

本能力属于独立 `text-adventure` 的生产、Build 装配和发布质量阶段。它只读取当前 Build 已冻结的 `media.requirements`、`media.visual-bible`、作者锚点决定和逐项媒资 Artifact；产出 Build-local `media.audit` 证据并约束 RuntimePackage。所有媒资、审计和回执归具体文字冒险产品实例，不进入 WorldRelease，也不与 AVG 的连续舞台演出、立绘站位或时间轴合同混用。

“生成过一张图”不等于“这张图满足需求”，而“Build 里有一张图”也不等于“玩家实际看到的就是它”。正式质量链必须分别证明：

1. 每个冻结需求都有且只有一个当前 Build 结果，或一个明确、合法的纯文字降级结果。
2. 实际图片的用途、稳定 assetKey、mediaKind、尺寸、内容 hash、来源和权利与冻结需求一致。
3. RuntimePackage 只引用已经审计通过的图片；降级项没有 Blob，也不能伪装成媒资覆盖。
4. Preview 在真实浏览器中读取冻结 Blob、核对 hash/MIME/字节并完成图片解码和规格验证。
5. 视觉语义和审美质量由独立审图岗位或真人审查确认，不能由生成图片的 Art Director 自评，也不能由“文件能解码”冒充。

## 2. 确定性三向审计

`media.audit` 是 `integration.package` 的强制前置任务。它逐项比对 `media.requirements.visual[]` 与同 key 的已验收 Artifact：

- `fulfilled`：必须是 `storyforge.generated-media-artifact`、包含与冻结需求逐字段等价的 request、Build-local assetKey、正确 mediaKind、非空 Blob、图片 MIME、精确尺寸、来源、许可和完整权利证据。
- `text-fallback`：仅在 Brief 明确 `allowTextOnly` 且 Provider 已达到有界重试上限后允许；必须是 `storyforge.omitted-media-artifact`、无 Blob/MIME/mediaKind、原因码固定、权利安全，不得计入实际图片或媒资覆盖。

审计报告固定 Build number、requirements hash、visual-bible hash、每项 requirement hash、Artifact content hash 与处理状态。缺项、重复项、旧 Build assetKey、篡改 request、错误类型/尺寸、空来源、权利不足或擅自降级都会阻断装配。图片作者替换仍使用相同需求合同，所以同样必须通过审计。

`integration.package` 只在审计通过后装配图片，并把审计 hash 固定进运行定义。既有 package parser、产品质量门和 adoption 校验继续验证“Artifact → Runtime asset → presentation 引用”；Preview 的媒资运行校验继续验证“Runtime asset → Blob 字节 → 浏览器可解码对象”。因此证据链是：

`冻结需求 → media.audit → Build Artifact → RuntimePackage asset/presentation → Blob → 浏览器解码回执`

含图商业候选还必须满足共享的最低视觉构成合同，而不是只达到图片总数。关键插图档的 12 个唯一
编辑职责固定覆盖：封面/开场、主角锚点、区域地图、三幕各一次关键转折、第二大区环境锚点、两件
不同关键物品、两名不同 NPC 锚点和结局后果。Art Director 的冻结槽位与最终 RuntimePackage
推荐质量门共同读取同一合同，并同时核对 `sceneTag + mediaKind`；十二张泛图、重复封面、把地图换成
普通背景或用同一人物立绘凑数，即使文件、数量和权利全部合法，也不得通过社区推荐质量门。

## 3. 独立审图岗位

确定性审计只能证明合同与技术质量，不能判断人物是否画错、画风是否漂移、构图是否服务当前剧情、插图是否剧透或是否有明显生成缺陷。专业生产团队必须新增独立 `text-adventure-visual-qa-director`，且只拥有一个版本化 `visual-quality-review.v1` Skill；Art Director 继续只产出视觉圣经和需求，Provider 只生产媒资，两者都无权给自己的作品签署审美通过。

独立审图必须读取经过登记的图片多模态输入、视觉圣经、对应需求、角色锚点和最小剧情上下文，逐项产出：身份/服饰/年龄/关键特征一致性、场景/时间/氛围、风格/色板、构图/可读性、剧透风险、文字水印、畸形/伪影、内容安全、替代文本和建议 owner。它只能生成问题候选和 `accept / revise / replace / human-review` 建议，不能改 Blob、需求、角色事实、权利或 Build 状态。

在正式多模态 Provider 能力、请求协议、Context Source、预算和回执登记完成前，不得用把图片 URL 写进纯文本 prompt 的方式伪造自动审图。商业候选若缺少独立自动审图，必须停在真人逐图确认；prototype 可以继续预览，但必须明确标注“尚未完成视觉语义审查”。

含图 Build 在作者视觉锚点闸门之前必须先执行一次真实图片输入预检。预检复用 Visual QA Director 的唯一 Skill，但使用独立 task kind；它在同一模型调用中发送一张系统生成的有效 PNG，从八个高区分标准色中按当前 Build/epoch/Plan/idempotency/capability identity 隐藏抽取并排列四个象限。Prompt 只给允许标签和返回字段，不能泄露实际颜色集合或顺序；执行器必须按隐藏期望逐位核对。盲猜通过概率最多为 `1/1680`。预检只消耗一次文本模型调用、不得调用图片生成 Provider；失败、看不到图片、回显 prompt、错误顺序或 binding 漂移均停在锚点确认之前，因此十二次付费出图调用保持为零。

## 4. 修复与依赖传播

审图问题必须指向具体 assetKey、需求字段、证据和建议 owner：

- 需求或视觉圣经错误：回到 Art Director 或确定性视觉圣经编译，所有受影响图片 stale。
- 单图执行偏差：使用 `regenerate` 派生新 Build，只重跑该图片和下游审计/装配/QA。
- 作者逐图退回：失败 gate receipt、完整 evidence、旧图片 content hash 与作者原文意见必须冻结为 `media.repair-feedback`；重生成任务把它作为强制输入，并在原始需求、视觉圣经和角色锚点之上执行定向修复。未冻结退回回执、回执不属于父 Build、图片 hash 已变化或备注被替换时拒绝创建子 Build。
- 作者采用自有素材：使用 `upload-replacement`，先验证字节、尺寸和权利，再走同一审计链。
- 跨图片角色/风格系统性漂移：不得逐张掩盖；必须提升到视觉圣经 revision，并重新确认主要角色锚点。

任何修复都不能原地覆盖已验收或已发布 Artifact。新 Build 必须重新生成 `media.audit`、RuntimePackage、自动游玩、质量报告和 Preview 媒资回执。

## 5. UI 与验收

工作台至少展示需求数、实际图片数、纯文字降级数、技术审计状态、独立审图状态、真人确认状态、来源/权利和当前 Build lineage。每张图片必须按原始宽高比完整显示，禁止用固定 `16:9 object-cover` 裁切人物；作者可打开全屏原图或在新窗口检查。单图卡必须同时展示职责/mediaKind、场景/beat、请求与实际尺寸、altText、角色锚点、硬约束，以及 Visual QA verdict、五项评分和逐条 issues。作者必须能从问题直接跳到对应图片并选择按冻结作者意见重生成、上传替换、锁定或返回需求层修订。

自动测试必须包含：完整匹配、缺项、重复项、篡改 request、错误 assetKey/mediaKind/MIME/尺寸、损坏 Blob、空权利、合法文字降级、商业候选禁止降级、作者替换后重新审计、Runtime 漏引用/错引用、导出导入 hash 等价与真实浏览器解码。独立多模态审图还需准备人物错位、风格漂移、剧透、伪文字和明显畸形的正反例图集，不得只断言模型返回了 JSON。

## 6. 当前施工状态

已实现确定性 `media.audit`、合法纯文字降级审计、RuntimePackage 审计 hash 绑定和发布硬门；既有 adoption 与浏览器媒资校验继续承担运行引用和物理字节验证。独立 Visual QA Director、受治理多模态图片输入、付费出图前隐藏挑战预检、逐项 key/hash 审查工件，以及作者逐图接受/退回的不可变质量回执均已接入正式生产与发布链。

专用六图评测夹具现已覆盖干净对照、人物错位、风格漂移、结局剧透、伪文字和明显畸形；评分器要求所有缺陷图都不得 `accept`、必需问题类别全部检出、干净对照不得出现 blocking 误报。隔离浏览器 E2E 已走通“作者退回 → 失败回执 → 真实 PNG 上传 → 不可变子 Build → 重新装配 → 新 hash 全部接受”，并修复未修改图片沿用父 Build `assetKey` 导致子 Build 审计必然失败的问题。真实旗舰仍必须用其自身 Provider 产物再次完成三层审查，开发夹具不能替代内容验收。
