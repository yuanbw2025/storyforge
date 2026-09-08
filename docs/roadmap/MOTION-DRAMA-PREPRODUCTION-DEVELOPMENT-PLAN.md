# 漫剧前期生产独立产品开发规划

> 版本：1.1.0 · 生效：2026-09-09 · 状态：已完成当前工程闭环
> 产品：`independent.motion-drama` · 用户名称：漫剧工坊
> 对应流程：一句话 → 小说 → 漫剧剧本 → 物料准备 → 分镜设计 → 分镜/视频生成提示词包
> 本文是该产品的唯一专项施工方案；实现状态仍以能力基线、schema、三注册表和自动测试为准。

## 1. 结论

StoryForge 需要建设一条新的、独立的“漫剧前期生产”产品线，但不重造小说、图片、音频或视频模型，也不把现有“小说转剧本”和“小说转页漫”强行改造成漫剧。

产品的核心价值不是再提供一个大文本框，而是把成熟行业流程固化为可编辑、可复用、可逐集推进的生产控制面：

1. 在同一个漫剧项目内承接一句话创意或已有小说；一句话模式复用现有小说生产能力，形成可编辑小说来源。
2. 一次完成系列定位、系列圣经、分集推进表和角色/服装/场景/道具/声音物料库。
3. 逐集完成“集纲 → 漫剧剧本 → 分镜 → 分镜图/关键帧 Prompt 与参考帧 → 视频 Prompt IR → 工具适配包”，每集独立确认和锁定。
4. 用户可查看、复制、修改、保存和恢复每一步提示词，但不能用提示词绕过数据作用域、输出 schema、版本、媒资权利和完成门。
5. 产品终点是可交给 Seedance、Runway、LTX 等外部工具的完整前期生产包，不包含视频生成、选片、剪辑、调色、混音和漫剧成片。

该流程不引入比赛字段、赛道、奖项、截止时间或针对某一比赛的评价标准。正常产品质量目标就是可用于专业创作和高质量成片生产。

## 2. 功能开工卡

- 产品：`independent.motion-drama`，归入 independent creation family。
- 产品阶段：独立产品的前期生产阶段；没有视频生成和成片运行阶段。
- 用户入口：Product Hub 创建“漫剧工坊”；可输入一句话、选择本地小说 Work，或粘贴导入不超过 25,000 字的小说正文；更长文本先进入长篇产品。
- 上游：一句话创意、已确认小说内容、导入文本、用户上传的参考图片/音频。
- 用户动作：建立原作、冻结来源、规划系列、建立并锁定物料、逐集编剧、分镜、审校和编译适配包。
- 输出交接物：系列圣经、分集推进表、漫剧剧本 AST、版本化物料库及参考媒资、逐镜分镜、provider-neutral Prompt IR、Seedance/Runway/LTX 适配包、不可变前期生产 Release。
- 数据 owner：MotionDrama Work；一句话生成的小说仍由其 Novel Work 拥有，漫剧只保存显式冻结的来源清单和 lineage。
- 世界引用：V1 不依赖 World，也不向世界引擎写入剧本、分镜、图片、声音或提示词包。
- 媒资 owner：MotionDrama Work/Release；共享 Blob 只保存字节，不改变产品 owner。
- 明确非范围：最终视频生成、候选视频选择、剪辑、转场合成、字幕渲染、调色、混音、成片导出、发布平台运营。

入口到结果：

```text
创建漫剧项目
→ 输入一句话并生成小说，或选择/导入已有小说
→ 作者确认并冻结小说来源
→ 系列定位、系列圣经与分集推进表
→ 角色/服装/场景/道具/声音物料定义、参考媒资生成或上传、作者锁定
→ 选择一集
→ 集纲与节拍
→ 漫剧剧本
→ 分镜设计
→ 连续性、可视化和生成可行性审查
→ 分镜图/首尾关键帧 Prompt 与参考帧候选
→ 通用 Image Prompt IR / Video Prompt IR
→ Seedance / Runway / LTX 适配包
→ 锁定本集并推进系列状态
→ 下一集
→ 发布逐集或整季前期生产包
```

完整流程图见 [MOTION-DRAMA-CONTENT-PRODUCTION-FLOW.md](./MOTION-DRAMA-CONTENT-PRODUCTION-FLOW.md)。

## 3. 为什么它必须是独立产品

### 3.1 不属于现有小说转剧本

现有 `independent.screenplay` 的终点是电影、剧集或短剧的 Screenplay AST 与 Fountain/FDX/PDF，明确不生产分镜和视听媒资。漫剧还需要画风圣经、角色参考、逐镜视觉动作、镜头时长、视频生成约束、音画关系和工具适配包，数据与完成门均不同。

### 3.2 不属于现有小说转漫画

现有 `independent.comic` 面向固定页漫画，核心是页、格、阅读顺序、气泡和印刷/屏幕版式。漫剧的最小生产单元是有时长和连续运动的 shot/video unit，不存在页格阅读顺序，也不能把静态 panel Prompt 直接当视频 Prompt。

### 3.3 与小说产品的关系

“一句话 → 小说”必须出现在同一条用户流程中，但内核复用现有小说能力：

- 用户选择“一句话开始”时，漫剧工坊在同页创建并驱动一个可见的 Novel Work；短体量复用短篇工作流，较大体量复用分步骤小说能力。
- 小说正文仍归 Novel Work 所有；作者确认后，漫剧产品通过现有 adaptation source manifest 冻结具体 Work、章节、revision、hash 和内容范围。
- 后续修改小说不会静默改变已冻结漫剧项目；用户必须显式“重新冻结来源”，受影响的系列/分集候选进入 stale。
- 用户选择已有小说或导入文本时直接进入同一来源冻结流程，不复制第二套来源协议。

这实现“用户体验上一条线、工程所有权上不混写”。

## 4. 目标用户和形态预设

V1 面向希望按集生产 AI 漫剧前期材料的个人作者与小团队。配置由具体项目拥有，不把某一规模写成全局真理。

建议提供三个可编辑预设：

| 预设 | 典型用途 | 默认结构 | 说明 |
|---|---|---|---|
| 竖屏连载 | 高频短集、连续追更 | 80 集、每集 60～120 秒、总剧本约 5～6 万字 | 只是常用起点，所有参数可改 |
| 中短系列 | 主题系列或平台连载 | 12～24 集、每集 2～5 分钟 | 强调单集闭环和季弧 |
| 漫剧短片 | 一次性完整故事 | 1～6 集、总时长 3～15 分钟 | 强调完整起承转合 |

每个项目至少保存：画幅、目标时长、集数、受众、内容边界、叙事密度、对白/旁白比例、视觉形态、动效复杂度、音频要求、目标工具和成本偏好。

## 5. 用户可见生产阶段

工作台采用一条左侧步骤导航和一个当前步骤编辑区，不显示“复杂 Harness”或后台工程术语。

### 阶段 A：来源与小说

1. 创意输入：一句话、题材、受众、情绪承诺、禁区和目标体量。
2. 小说设计：核心冲突、人物欲望、故事引擎、关键转折、结局方向。
3. 小说计划：章节或故事段落任务。
4. 小说正文：分段/分章生成、作者编辑和质量审查。
5. 来源冻结：显示来源范围、字数、revision、hash 和下游 stale 影响，作者确认后进入系列策划。

已有小说模式从第 5 步开始；导入文本先建立来源 Work，再冻结。

### 阶段 B：系列策划（通常一次完成，后续版本化修改）

1. 漫剧定位：logline、核心卖点、受众、情绪曲线、视觉形态和生产约束。
2. 系列圣经：世界规则、人物弧、关系、主支线、主题、禁止漂移项。
3. 分集推进表：每集 hook、目标、阻力、升级、揭示、回报、尾钩和跨集状态变更。
4. 全局审查：因果完整、信息揭示顺序、人物弧覆盖、重复情节和注水检测。

### 阶段 C：物料库（主体一次建立，按版本修订）

1. 视觉风格圣经。
2. 角色身份与角色图板。
3. 角色服装套装与剧情状态。
4. 场景空间、环境图板与时段变化。
5. 关键道具外观、尺度、持有状态和叙事用途。
6. 声音圣经：角色音色/语速/情绪边界/读音，环境声、音效、音乐母题。
7. 参考媒资：生成或上传候选，作者选择后锁定为稳定版本。

物料默认跨集复用。修改已锁定物料必须产生新版本；系统列出会受影响的未锁定集，不静默重写已经发布的旧集。

### 阶段 D：逐集生产循环

1. 选择目标集并载入上一集退出状态、未回收线索和本集计划。
2. 生成/编辑集纲和节拍。
3. 生成/编辑漫剧剧本。
4. 剧本审查和定点修订。
5. 生成/编辑逐镜分镜。
6. 分镜连续性与生成可行性审查。
7. 编译分镜图/首帧/尾帧 Image Prompt IR；可导出 Prompt，也可使用已配置图片 provider 生成候选并由作者选择参考帧。
8. 从已确认 shot、精确物料版本和所选参考帧编译 Video Prompt IR。
9. 编译目标工具适配包并预览最终文本、引用映射和缺失物料。
10. 作者锁定本集，系统冻结退出状态并推进下一集。

### 阶段 E：发布与导出

- 单集包：一集剧本、分镜、引用物料和一个或多个工具适配包。
- 整季包：系列圣经、全部物料版本、分集推进表、已锁定单集和清单校验。
- 缺少实际参考媒资时可导出 `prompt-only` 包，但不能标为 `reference-ready`。

## 6. 漫剧剧本合同

漫剧剧本不是小说摘要，也不是把现有电影剧本缩短。内部保存结构化 AST，至少包含：

- 集编号、标题、预计时长、开场 hook、核心情绪、集尾钩子；
- 场次标题、时空、场景目标、进入/退出状态、预计时长；
- 可见动作、人物表演、对白、旁白、屏幕文字、音效、音乐和转场意图；
- 来源事实/改编决定、分集节拍和跨集状态引用；
- 哪些内心活动已被转为动作、表情、构图、对白或旁白；
- 生产复杂度标签：单人/多人、复杂肢体、交互、特效、拥挤场景、口型要求。

建议的单集节奏字段为：`hook → setup → pressure → turn → payoff → cliffhanger`。预设可以不同，但每集必须说明变化发生在哪里，不能只靠结尾一句悬念冒充推进。

## 7. 分镜与视频单元合同

`MotionDramaShotV1` 是一次可审查的镜头叙事意图，不等同于漫画格，也不直接等于某个 provider 的一次请求。至少包含：

- 稳定 shot key、episode/scene/order、目标时长和时间段；
- 叙事功能、起始状态、核心变化、结束状态；
- 角色/服装/场景/道具/声音的精确版本引用；
- 主体动作、表演、视线、站位、空间关系；
- 景别、角度、构图、镜头运动、节奏、焦点和转场出口；
- 光线、色彩、天气、动效层和风格；
- 对白/旁白/音效/音乐的时间与口型需求；
- 首帧、尾帧、参考图/视频/音频角色；
- 连续性入口/出口与禁止漂移项；
- 生成风险和可降级建议。

确定性规则：

1. 一个 shot 只允许一个主要叙事变化和一个主要镜头意图；多动作必须有明确时间序列。
2. 时长预算必须覆盖动作、对白和镜头运动，超出则拆 shot 或调整表演。
3. 所有稳定引用必须解析到已锁定或明确允许使用的资产版本。
4. 人物衣着、伤势、道具持有、左右位置、时间与光线的出入状态必须闭合。
5. 供应商限制不写入核心 shot schema，而由版本化 capability profile 校验和适配。

### 7.1 分镜参考帧

每个 shot 可以有 `start | key | end` 三类参考帧。系统先从 shot 和精确物料版本编译 Image Prompt IR，再允许用户：

- 复制 Prompt 到外部图片工具；
- 使用 StoryForge 已配置的图片 provider 生成候选；
- 上传已有分镜图、构图草图或首尾帧；
- 逐帧选择、拒绝、换版并记录内容 hash；
- 将所选帧以明确用途交给视频 Prompt 编译器。

未生成参考帧时仍可形成 `prompt-only` 包；需要图生视频、首尾帧或严格构图锚点的 shot，在缺少已选参考帧时不能标为 `reference-ready`。

## 8. 通用 Prompt IR 与工具适配

### 8.1 为什么先做 Prompt IR

Seedance、Runway、LTX 的输入方式和限制会变化。如果业务表直接保存 `@图片1` 或某个模型当前参数，供应商升级会使历史内容失效。因此核心保存两种 provider-neutral IR：

```text
Image Prompt IR
= 帧用途 + 主体与精确物料版本 + 场景/构图/姿态/表情
+ 光线/色彩/风格 + 画幅/安全区 + 禁止漂移项

Video Prompt IR
= 叙事目的 + 时长/时间轴 + 主体与精确物料版本
+ 所选首帧/关键帧/尾帧 + 动作/表演 + 镜头 + 环境运动
+ 对白/声音 + 连续性入口/出口 + 禁止漂移项
```

IR 是正式产品内容；工具适配包是从 IR 和 capability profile 确定性编译出的派生物。分镜图 Prompt 和视频 Prompt 分开，避免静态构图描述与动态运动描述互相争抢模型注意力。

### 8.2 Seedance 适配器

- 将已锁定图片、视频、音频分配为明确引用槽位并生成人类可读映射表。
- 在 prompt 中说明每个引用负责人物身份、服装、场景、道具、声音、构图、运动或首尾帧中的哪一项。
- 有多段动作时编译为时间戳段，检查段落总时长、角色站位和动作顺序。
- capability profile 记录当前模型的参考数量、时长、画幅、音频、首尾帧和编辑能力；上限不硬编码到领域模型。

### 8.3 Runway 适配器

- 区分 text-to-video 与 image-to-video；后者的文本重点编译为主体动作、环境运动、镜头运动、时序、方向和速度。
- 使用角色/场景 reference plate，避免在每个 prompt 中重复一整段容易漂移的身份描述。
- 根据当前模型时长拆分 video unit，并为接续镜头输出尾帧衔接说明。

### 8.4 LTX 适配器

- 把角色、地点、道具映射为 Elements，把分镜映射为 shots/storyboard。
- 输出镜头、关键帧、参考媒资和声音设计字段；保留系列资产稳定 key。
- LTX 导出属于适配包，不把 LTX 的内部术语升级为 StoryForge 核心领域对象。

官方资料说明了这条抽象的必要性：Seedance 2.5 强调多模态引用和时间戳控制；Runway 将输入图作为构图/主体/光线/风格锚点，并建议视频文本集中描述运动；LTX 以 Characters、Objects、Locations 等 Elements 维持跨镜一致性。供应商能力会变化，实施时必须以 adapter capability profile 重新验证。

## 9. 物料库设计

### 9.1 稳定身份与版本

建议 stable key：

```text
character.lin-xia
costume.lin-xia.daily
location.old-apartment.living-room
prop.will-envelope
voice.lin-xia
soundmotif.family-secret
```

用户可见版本示例：`角色·林夏 v2`、`服装·林夏·日常 v1`。一次修改产生新版本，不覆盖旧版本。

### 9.2 各类物料的最低交付

| 类型 | 文本定义 | Prompt | 参考材料 | 锁定检查 |
|---|---|---|---|---|
| 风格 | 画风、线条、材质、色板、光影、镜头语言、禁止项 | 风格板生成 Prompt | moodboard/style reference | 不含冲突风格和受限模仿 |
| 角色 | 面部、体型、年龄感、发型、识别特征、表演边界 | 正面/侧面/背面/半身/表情板 Prompt | 多角度 character plate | 中性光线、无场景污染、身份一致 |
| 服装 | 版型、材质、色彩、配件、剧情适用状态 | outfit sheet Prompt | 服装板/穿着参考 | 与角色和时代匹配 |
| 场景 | 空间拓扑、出入口、关键物、时段、光源 | environment plate Prompt | 多角度环境板 | 空间可连续、比例稳定 |
| 道具 | 外形、材质、尺度、细节、持有人、状态 | prop turnaround Prompt | 多角度/细节图 | 尺度、文字和剧情状态稳定 |
| 声音 | 音色、语速、口音、情绪范围、读音、音乐母题、环境声 | 试听台词/声音生成 Prompt | 上传或生成的试听音频 | 权利、可用性、音量/格式元数据 |

参考媒资允许三种来源：用户上传、StoryForge 已配置 provider 生成、已有项目媒资导入。所有候选保留 origin、provider/model、prompt hash、reference hashes、权利说明和内容 hash；作者选择后才进入正式物料版本。

### 9.3 物料更新影响

- 新版本只默认影响尚未锁定的未来集。
- 已锁定或已发布集继续引用旧版本，保持可复现。
- 用户可显式批量迁移未来集；系统先显示受影响 shots/prompt packs，再提交。
- 删除资产前检查 Release 强引用和未来集绑定；有强引用时拒绝物理删除，只允许归档。

## 10. Prompt/Skill 目录

V1 不建立一个万能 Agent。用户面对“漫剧制作助手”，内部按职责拆成有限 Skill；能用确定性代码完成的编译、校验和版本工作不交给模型。

| 步骤 ID | Skill/角色 | 输入 | 候选输出 | 人工闸门 |
|---|---|---|---|---|
| `motion-drama.story-brief` | 故事策划 | 一句话与约束 | 小说 Brief | 确认承诺 |
| `motion-drama.novel-architecture` | 小说架构师 | Brief | 故事设计/章节计划 | 确认结构 |
| `motion-drama.novel-draft` | 小说作者 | 章节任务和连续性 | 章节正文 | 逐章确认 |
| `motion-drama.novel-review` | 小说编辑 | 冻结前全文 | 问题清单 | 选择修订 |
| `motion-drama.series-positioning` | 漫剧策划 | 小说来源与产品设置 | 漫剧定位 | 确认定位 |
| `motion-drama.series-bible` | 系列统筹 | 来源、定位 | 系列圣经 | 确认正典 |
| `motion-drama.episode-grid` | 系列编剧 | 系列圣经 | 分集推进表 | 确认分集 |
| `motion-drama.asset-director` | 美术/声音统筹 | 圣经、分集需求 | 物料定义与覆盖表 | 确认需求 |
| `motion-drama.asset-prompt` | 视觉/声音提示词设计 | 单项物料定义 | 物料 Prompt 候选 | 生成前确认 |
| `motion-drama.episode-beats` | 分集编剧 | 本集任务与连续性 | 集纲/节拍 | 确认本集结构 |
| `motion-drama.episode-script` | 漫剧编剧 | 集纲与物料目录 | 剧本 AST | 确认剧本 |
| `motion-drama.script-review` | 剧本编辑 | 剧本、来源和时长 | 定位问题 | 选择修订 |
| `motion-drama.storyboard` | 分镜导演 | 已确认剧本 | shots | 确认分镜 |
| `motion-drama.storyboard-review` | 连续性/生成监修 | shots 与物料版本 | 定位问题 | 选择修订 |
| `motion-drama.frame-prompt-ir` | 分镜图提示词设计 | 已确认 shots 与物料版本 | Image Prompt IR | 确认构图与参考帧需求 |
| `motion-drama.video-prompt-ir` | 视频提示词设计 | shot、物料和所选参考帧 | Video Prompt IR | 确认运动与音画语义 |
| `motion-drama.targeted-rewrite` | 定点修订 | 指定 issue/对象 | 局部候选 | 复审后确认 |

以下由代码确定性完成，不建立生成 Agent：

- 来源和引用解析；
- 物料/分镜/对白时长/状态连续性检查；
- Image/Video Prompt IR 到图片工具及 Seedance/Runway/LTX 的适配编译；
- schema、stable key、版本、hash、stale、导出和 Release pinning；
- 完成门和不可变清单。

## 11. 提示词库产品设计

### 11.1 两层事实

- 内置目录 `MOTION_DRAMA_PROMPT_CATALOG_V1`：固定步骤 ID、模板版本、职业角色、变量、输出 schema、默认提示词和示例。
- Work 专属覆盖 `MotionDramaPromptOverrideV1`：只保存作者修改的语义指令，不复制权限和 schema。

解析优先级：`本集覆盖 > 当前漫剧 Work 默认覆盖 > 内置模板`。

### 11.2 用户功能

每一步支持：

- 查看默认 Prompt 和最终解析 Prompt；
- 复制为自定义版本；
- 编辑 system/user 语义说明和示例；
- 查看可用变量、必需变量和示例值；
- 保存为本项目默认或仅本集使用；
- 与默认版本比较、恢复默认；
- 预览完整输入，但敏感 Key 和超长来源按清单/摘要显示；
- 显示模板 version/hash，并在运行回执中冻结。

### 11.3 不允许覆盖的硬边界

用户 Prompt 不得改变：

- 当前产品、Work、episode 和 source manifest 作用域；
- `CONTEXT_SOURCES` 允许读取范围；
- 输出 schema、stable key 规则和目标表；
- 最大调用/repair 次数、权限、预算、状态机；
- `FIELD_REGISTRY` / Adoption 和媒资作者确认门；
- 权利、引用、时长、provider capability 和 Release 完成门。

## 12. 轻量运行设计

不新建一套复杂的常驻 Harness，也不让一个 Agent 连续跑完 80 集。每次点击“生成/审查/定点修订”只启动一个有界步骤 run。

用户只看到：

```text
未开始 → 生成中 → 待确认 → 已确认
              ↘ 失败
已确认的上游变化 → 当前候选已过期
```

底层复用现有 `agentRuns`、事件、artifact、Context Manifest 和 CreativeArtifact/Adoption 机制，保留最小可靠性：

1. 冻结 product/work/episode/step、输入 revision、source/asset/prompt hash。
2. 只装配该步骤登记的上下文。
3. 保留原始响应，结构校验失败时最多一次定点 repair。
4. 候选由作者预览、编辑、确认或拒绝；确认后才正式写入。
5. 网络结果未知、余额/权限、非重试错误和 stale 不自动重发。
6. 刷新后可恢复当前步骤和候选，不恢复一个隐藏的长程自治任务。

每集单独推进，失败只影响本集当前步骤；物料库和已锁定集不受影响。

## 13. 拟议数据模型与三注册表

### 13.1 领域表

| 表 | owner | 责任 |
|---|---|---|
| `motionDramaProductions` | Work | 根记录、来源 lineage、设置、当前集、revision、release |
| `motionDramaSeriesBibles` | Work | 定位、故事引擎、人物弧、关系、主支线、风格与锁定规则 |
| `motionDramaEpisodes` | Work | 分集计划、集纲、进入/退出状态、阶段和 revision |
| `motionDramaScriptScenes` | Work/Episode | 漫剧剧本 AST 的场次、动作、对白、声音和来源 |
| `motionDramaAssetSubjects` | Work | 角色/服装/场景/道具/声音的稳定身份与禁止漂移项 |
| `motionDramaAssetVersions` | Work/Subject | 物料版本、Prompt、参考 blob、来源/权利/选择状态 |
| `motionDramaAssetBindings` | Work/Episode/Shot | 使用哪一个精确物料版本 |
| `motionDramaShots` | Work/Episode | 逐镜时长、表演、镜头、音画、连续性和风险 |
| `motionDramaShotReferences` | Work/Episode/Shot | start/key/end 分镜参考帧、候选选择、Prompt/Blob/hash/权利 |
| `motionDramaPromptOverrides` | Work/Episode | 步骤 Prompt 的 Work 默认/本集覆盖 |
| `motionDramaPromptPacks` | Work/Episode | Prompt IR、adapter/version、引用映射、派生文本和 hash |
| `motionDramaReviewIssues` | Work/Episode | 系列、剧本、物料、分镜、提示词问题及解决状态 |

共享复用：`works`、`adaptationSourceUnits`、`adaptationSourceFacts`、`adaptationCausalEdges`、`adaptationDecisions`、`mediaBlobObjects`、`agentRuns`、`agentRunEvents`、`agentRunArtifacts`、`creationReleases`、`creationReleaseAssets`。

不复用 `screenplayScenes`、`comicPages`、`comicPanels`、`comicVisualSubjects` 或上层产品 `productMediaAssets` 作为漫剧正式表。

### 13.2 Context Sources（拟新增）

- `motionDrama.sourceManifest`
- `motionDrama.sourceFacts`
- `motionDrama.seriesBible`
- `motionDrama.episodeGrid`
- `motionDrama.currentEpisode`
- `motionDrama.priorEpisodeState`
- `motionDrama.assetCatalog`
- `motionDrama.currentScript`
- `motionDrama.currentShots`
- `motionDrama.currentShotReferences`
- `motionDrama.reviewIssues`

reader 必须验证 project/world/work/production/episode/manifest/asset version 作用域；跨 Work 或旧 manifest 读取直接拒绝。

### 13.3 Field/Adoption（拟新增）

系列定位、系列圣经、分集计划、集纲、剧本 scene、物料定义、物料 Prompt、shot、Prompt IR 和 review issue 分别登记。作者选择的图片/音频候选通过产品专用 adoption extension 绑定到物料版本；模型不得自动锁定参考媒资。

### 13.4 PROJECT_TABLES 与生命周期

所有新增表先登记 `PROJECT_TABLES`，再接 UI/service。必须覆盖：

- 项目备份/导入的 ID 重映射；
- Work 删除级联和来源 Work 删除后的 detached/frozen 读取；
- Release → asset version → blob 强引用；
- 未选候选 GC 与已发布媒资保护；
- episode/shot/subject 引用冲突和损坏记录；
- 当前 schema、受支持旧 schema、事务失败和重复导入。

### 13.5 Release

扩展 `CreationProductKindV1` 为 `motion-drama`，使用产品专用闭集 manifest：

- `episode-preproduction`：冻结单集剧本、shots、精确物料版本、Prompt IR、全部 adapter packs 和验证回执。
- `series-preproduction`：聚合系列圣经、分集表、物料库及所选单集 release 的强引用。

`prompt-only` / `reference-ready` 是完成级别，不是两个产品。后者要求所有必需参考媒资存在、可解码、权利元数据和 hash 完整。

## 14. 工作台信息架构

```text
漫剧工坊
├─ 0 项目设置
├─ 1 原作小说
├─ 2 系列策划
├─ 3 分集推进
├─ 4 物料库
│  ├─ 风格
│  ├─ 角色
│  ├─ 服装
│  ├─ 场景
│  ├─ 道具
│  └─ 声音
├─ 5 单集工作台
│  ├─ 集纲
│  ├─ 剧本
│  ├─ 分镜
│  ├─ 分镜图/关键帧
│  ├─ Image / Video Prompt IR
│  └─ 工具适配包
├─ 6 质量审查
├─ 7 提示词库
└─ 8 发布与导出
```

单集工作台是高频主界面：顶部选择集数并显示上一集退出状态、本集完成度和物料缺口；中部在集纲/剧本/分镜/Prompt 之间切换；右侧只显示当前对象的引用、问题和提示词设置。避免把 80 集所有正文和所有物料一次性铺开。

## 15. 质量门和验收标准

### 15.1 系列层

- 核心故事引擎能持续产生变化，不靠重复误会或机械打脸填集数。
- 每集推进表拥有新信息、人物选择或不可逆状态变化。
- 主线、支线、人物弧、伏笔投放和回收可追踪；结局与前置因果闭合。
- 80 集规模夹具能按单集读取，不能把全量正文塞入每次调用。

### 15.2 物料层

- 所有常驻角色、关键服装、复用场景、关键道具和声音身份有 stable key。
- 参考 plate 覆盖实际镜头需要的角度、构图或状态；候选由作者实际查看/试听并确认。
- 已锁定版本不被覆盖；跨集绑定可解析，权利和内容 hash 完整。
- 缺图片/音频参考时明确显示 `prompt-only`，不假称 reference-ready。

### 15.3 单集剧本层

- 开场迅速建立问题，本集目标/阻力/升级/转折/回报/尾钩明确。
- 心理叙述已可视化或明确标为旁白；对白有行动目的且不是信息复述。
- 时长估算、场次和对白容量可执行；与上一集退出状态和系列正典一致。
- 审查问题定位到 episode/scene/beat/source，不做无依据泛评。

### 15.4 分镜层

- 每个 shot 有清晰叙事功能、可观察变化、可执行动作和合理时长。
- 景别、视线、轴线、站位、动作衔接、人物/服装/道具状态和音画关系连续。
- 复杂交互、多角色、口型和连续运动被标记风险，并提供拆镜或降级建议。
- 分镜覆盖全部必要对白、动作、揭示与转折，没有“剧本有、镜头无”。
- 需要参考帧的 shot 已声明 start/key/end 用途；参考帧构图、角色/服装/场景/道具版本与 shot 一致。

### 15.5 Prompt 包层

- 每个物料和参考帧槽位都能解析到精确资产版本，引用用途无歧义。
- 时间段总和、动作顺序、对白长度和镜头时长一致。
- Prompt 没有互相冲突的构图、动作、镜头和风格指令。
- adapter 输出满足当前 capability profile；超限必须拆分或阻断，不静默丢引用。
- IR、适配文本、引用映射和导出 manifest 可由相同输入确定性重建。

发布硬门：确定性 blocker 为 0、必需人工闸门已确认、候选不 stale、来源/物料/Prompt/adapter 版本已冻结。文学和视觉评分用于复审与比较，不能让模型给自己打分后自动放行。

## 16. 样例、评测与测试矩阵

### 16.1 原创验收样例

- `MD-SERIES-80`：80 集竖屏连载，验证单集渐进读取、主线推进、伏笔和 5～6 万字剧本目标。
- `MD-ASSET-VERSION`：主角中途换装、受伤、关键道具易手，验证旧集不漂移、未来集迁移。
- `MD-TWO-PERSON-DIALOGUE`：双人近景对白和视线/轴线，验证口型、停顿和反应镜头。
- `MD-ACTION-RISK`：多人复杂动作，验证生成风险识别和拆镜降级。
- `MD-SOUND`：角色音色、环境声、音效和音乐母题跨 3 集复用。
- `MD-FRAME-REFERENCE`：同一 shot 生成首帧/关键帧/尾帧 Prompt、候选与选择，验证静态构图和动态意图分离。
- `MD-ADAPTERS`：同一 Video Prompt IR 编译 Seedance/Runway/LTX，验证引用、时长和术语差异。

### 16.2 必测闭环

- 一句话 → 小说 Work → 来源冻结 → 系列圣经 → 物料 → 一集剧本 → 分镜 → 分镜图 Prompt/参考帧 → 三种视频适配包 → episode Release 的隔离浏览器 E2E。
- 已有小说/导入文本两条入口与一句话入口汇合到相同 source manifest。
- 所有 AI 结果确认前正式表零写入；拒绝、编辑、stale 和定点 repair 可恢复。
- 刷新、断网、provider 4xx、结果未知、重复点击和预算不足不造成重复写入或隐藏重试。
- 80 集索引/上下文预算/列表性能；当前调用只读所需集、相邻状态和必要物料。
- 物料上传/生成/选择/换版/归档/删除、Blob GC 和 Release 强引用正反例。
- schema 升级、项目备份/导入、ID 冲突、源 Work 删除、MotionDrama Work 删除和旧包回读。
- adapter capability 变化、缺引用、超时长、超参考数量、无法支持音频/首尾帧时的拆分或阻断。
- 导出包清单、文件 hash、字符编码、中文文件名和 Markdown/JSON/CSV 可读性。

### 16.3 真实质量验收

工程完成不等于内容质量完成。发布前至少用两个原创系列样例，各完成连续 3 集的人工评审，并把一组有代表性的 Prompt 包实际投喂至少一种外部工具做盲看：

- 故事推进、人物一致性、镜头可执行性、参考材料有效性；
- Prompt 一次成功率、平均返工次数、引用丢失率、跨镜漂移、动作/口型/音画问题；
- 记录 provider/model/version、输入包 hash 和人工结论，不提交 API Key 或外部生成的受限内容。

这一步验证适配质量，但最终视频仍不属于 StoryForge Release。

## 17. 实施分包与顺序

当前规划分支：`feat/motion-drama-preproduction`，基于 `origin/main` 的 `dc2e60cc76583a5b319597881b3be5b82c825ec9`。评审阶段只新增规划文件，不修改共享热点。

评审通过后建议仍在这一个漫剧专属分支串行施工，不拆成与本产品并行的多个功能分支：

1. **MD-00 产品契约与共享热点**：总纲产品地图、`docs/products/` 契约、能力基线/路线图待办、产品目录、WorkKind/AdaptationMedium/Release kind 的边界决定。
2. **MD-01 Schema 与生命周期**：领域类型、schema 迁移、`PROJECT_TABLES`、导入导出/删除/重映射/Blob 强引用测试。
3. **MD-02 来源与系列策划**：一句话/已有小说/导入入口、来源冻结、系列圣经、分集推进表、对应 Context/Field/Skill。
4. **MD-03 提示词库与轻量步骤运行**：内置目录、Work/episode 覆盖、预览/回退、run/candidate/confirm/stale。
5. **MD-04 物料库**：六类物料、参考媒资候选、版本锁定、影响分析、上传/生成能力协商。
6. **MD-05 单集剧本**：集纲、剧本 AST、审查、定点修订和上一集/本集状态交接。
7. **MD-06 分镜、参考帧与 Prompt IR**：shot 结构、时长/连续性/生成风险校验、Image Prompt IR、分镜图/首尾帧候选选择和 Video Prompt IR。
8. **MD-07 工具适配与导出**：Seedance/Runway/LTX capability profiles、适配包、单集/整季 Release 和 ZIP 导出。
9. **MD-08 产品体验与封板**：完整工作台、空态/错误/恢复/移动端、真实样例、质量评测、`npm run ci` 和 `npm run ci:e2e`。

每个分包先做定向测试；代码提交前至少运行架构门、required tables、AI manual、TypeScript、相关测试和 build；交付单元运行完整 CI，纵切面运行隔离 E2E。

## 18. 停止条件与风险

遇到以下情况停止扩大实现并回到契约评审：

- 为了复用现有功能必须让漫剧直接写入小说/剧本/漫画的正式 owner 表；
- 新表未能完整进入 `PROJECT_TABLES` 生命周期；
- Prompt 自定义能绕过 schema、作用域、媒资确认或 Release 门；
- provider 不支持所需参考输入，却只能靠 Prompt 假称已引用；
- 一次生成覆盖多集、错误时无法定位或恢复到具体 episode/step；
- 物料换版会静默改变已锁定或已发布集；
- 缺少实际图片/声音却把产物标为 reference-ready；
- UI 或文档把视频生成/成片误列为本产品已交付能力。

## 19. 本轮评审需要确认的五个判断

1. 产品边界是否正确：终点停在“分镜/视频生成提示词包 + 完整参考物料”，不包含漫剧成片。
2. 一句话入口是否正确：用户在漫剧工坊同页完成，但小说 owner 和来源冻结仍遵守现有小说产品边界。
3. 生产节奏是否正确：系列与物料一次建立，逐集完成剧本、分镜、参考帧和 Prompt 包并锁定，不用一个长任务跑完整季。
4. 提示词自由度是否正确：每步可编辑、可覆盖、可恢复，但 schema、上下文、权限、版本和完成门不可编辑。
5. 工具适配是否正确：核心保存通用 Prompt IR，Seedance/Runway/LTX 只是版本化编译器，而不是三套业务数据。

这五点确认后，才把本稿升级为现行专项方案并开始 MD-00。

## 20. 研究依据（仅支持流程设计）

- [ByteDance Seed：Seedance 2.5 多模态引用、时间戳控制与专业编辑](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5)
- [Runway：Image-to-Video Prompting Guide](https://help.runwayml.com/hc/en-us/articles/48324313115155-Image-to-Video-Prompting-Guide)
- [Runway：How to create longer videos and films](https://help.runwayml.com/hc/en-us/articles/26871350018835-How-to-create-longer-videos-and-films)
- [Runway：Creating with Gen-4 Image References](https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References)
- [LTX Studio：script、storyboard、Elements、camera、keyframes、references 与 sound design](https://website.ltx.studio/)
- [BytePlus LAS：Seedance 2.x multimodal video generation API](https://docs.byteplus.com/en/docs/byteplus_las/video_gen_enhanced)

这些资料会随供应商更新。正式适配以实现当日的官方 capability profile 和真实输入验证为准，不把当前产品宣传或参数上限固化为 StoryForge 永久契约。
