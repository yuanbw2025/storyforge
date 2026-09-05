# Phase C 独立创作产品专业开发总索引

> 版本：1.1.0 · 生效：2026-09-06 · 权威层级：L2
> 对应总纲：§4.3～§4.5、阶段 C
> 性质：三个独立产品的共同边界、研究索引和集成顺序；不能替代任一产品的专项施工方案。当前事实仍以 `CAPABILITY-BASELINE.md`、schema、三注册表和测试为准。

## 0. 三份独立施工方案

三个功能分别开发、分别验收，施工时必须只使用对应专项方案：

1. [短篇小说独立产品开发设计](./SHORT-NOVEL-DEVELOPMENT-PLAN.md)
2. [小说转剧本独立产品开发设计](./NOVEL-TO-SCREENPLAY-DEVELOPMENT-PLAN.md)
3. [小说转漫画独立产品开发设计](./NOVEL-TO-COMIC-DEVELOPMENT-PLAN.md)

共同边界与分支拓扑经过[独立创作三方案审查](./INDEPENDENT-CREATION-PLAN-AUDIT.md)。本文件中的跨产品说明用于裁决共享基础设施；专项数据、Skill、UI、完成条件和验收以对应方案为准。

## 1. 目标与裁决

本计划把短篇小说、小说转剧本和小说转漫画从“已有局部能力”推进为三个可独立创建、恢复、审校、封存和导出的产品。三个产品不依赖世界引擎；世界引擎不保存它们的生产状态或媒资。

本轮采用以下裁决：

1. 不用一个万能提示词或一次模型调用生成完整作品。
2. 一个 Skill 只完成一种有明确 schema 的创作转换；产品 Agent 只负责编排 Skill、人工闸门、预算、恢复和终态验证。
3. 来源阅读、改编判断、结构规划、正文/场次/页格生产、批评、局部修订和格式验证分开。
4. 创作判断由模型与作者完成；格式、引用、作用域、版本、hash、布局边界和发布完整性由代码验证。
5. 每个正式模型产物先成为候选，作者确认后才进入正式产品数据；批评结果不能绕过作者自动改写已审定内容。
6. 长小说按冻结来源单元分批读取，先形成可追溯事实和因果结构，再按目标片段检索原文，不把整部小说和全部历史反复塞入 Prompt。
7. 剧本和漫画共享最小的 adaptation 来源分析契约，但不共享场次、页格、审校问题或成品版本内容。
8. 当前 `feat/independent-creation-closure` 只承担本计划与必要共享底座。共享底座稳定后，短篇、剧本和漫画分别进入产品分支。

## 2. 研究依据及其工程含义

### 2.1 小说转剧本

- Sundance 的专业改编课程依次处理原作核心、主题、人物欲望、故事引擎、赌注、结构和初稿。这要求 StoryForge 在正式场次之前保存“为什么这样改”的编辑判断，而非只保存摘要。
- Screen Australia 把 scene breakdown 定义为逐场结构骨架；treatment 可以描述动机和内心，但剧本必须让这些内容从可见、可听的行为中成立。因此 `SceneCard` 与最终 `ScreenplayScene` 必须是两种产物。
- Academy 明确说明专业剧本存在细微格式差异，但整体遵循共同形态。StoryForge 应保存中立 Screenplay AST，再用可版本化格式画像渲染，不能把某个 PDF 外观当成唯一真相。
- BBC 的电视剧本格式示例要求场景标题明确内外景、地点和时间，动作只写屏幕上发生的事情，人物 cue 保持一致。这些可以成为确定性 lint 和专业审校规则。
- Fountain 是适合创作和交换的纯文本格式，但其官方边界不包含锁页、修订色页等制作期能力。因此 V1 支持 Fountain/FDX/PDF 创作交付，不宣称完整 production draft 管理。
- R² 小说转剧本研究采用 Reader/Rewriter、章节滑窗、人物/事件提取、因果图、逐场大纲和幻觉感知修订。工程上对应“来源分析 → 因果结构 → 场景卡 → 场次 → 基于证据的批评/修订”。
- Google DeepMind Dramatron 的行业评测支持分层 Prompt chaining 和人机共创，同时记录了完整自动写作可能公式化、专业作者仍需重写。产品必须突出作者选择、分支方案和局部重写，而不是“一键成片”。

### 2.2 小说转漫画

- Dark Horse 的漫画脚本指南按页和格组织，要求格描述、对白、旁白和拟声按最终阅读顺序提供；其英文参考上限约为每气泡 25 词、每格 50 词。V1 将其作为英语参考画像，不机械换算为中文字数，中文容量由实际字体和气泡几何计算。
- 视觉叙事研究表明，叙事结构、格内取景和页面布局共同决定理解；复杂排布会造成跳格或阅读顺序歧义。页格规划必须独立于生图，阅读方向和布局可由代码验证。
- 连续图像研究反复把角色身份、背景和跨帧一致性列为独立问题。Narrative Graph Prompting、StoryGPT-V 和 Make-a-Story 分别采用稳定实体图、角色增强表示或视觉记忆；这说明单纯重复角色文字描述不足以成为“人物一致性”。
- Clip Studio 的现行文档区分画布、裁切线、出血和内框。StoryForge 的正式漫画导出必须拥有 trim、bleed、safe area 和目标分辨率，不能只导出若干等大图片。
- 漫画文字应由本地排字层生成，保持可编辑、可测量和可重新布局；图片模型收到的请求默认禁止文字、气泡和水印。

### 2.3 长程生成与人工参与

- 长文本生成研究普遍支持先规划再写、层级大纲、动态记忆和独立批评。StoryForge 采用这些共同结论，但不照搬研究项目的私有数据集或模型实现。
- 专业评价不能只用另一个模型给总分。必须结合 schema/格式确定性检查、来源证据覆盖、故障注入、作者盲评和真实 UI 路径。

上述资料只提供方法和格式依据，不改变 StoryForge 的产品 owner、三注册表、候选采纳和 durable Harness 规则。

## 3. 当前能力基线与关键缺口

| 领域 | 当前可复用 | 施工缺口 |
|---|---|---|
| 共用来源 | source selection、manifest version/hash、source unit、freshness/resync | 没有批量事实账本、人物状态、事件因果图和逐项改编决策 |
| durable AI | Brief、Plan、剧本场次、漫画 storyboard 候选；checkpoint、stale、receipt | 每种产物单次调用；没有独立 grounding critic、专业 review 和定点 rewrite |
| 短篇 | 独立 Work/profile、5,000～25,000 字、3～8 章骨架、`ShortNovelProductionV1`、六个专属 Skill、durable run、审校/定向重写、不可变发布与 Markdown/TXT/JSON 导出 | 工程闭环已完成；后续只做真实文学质量和 provider 表现增量评测 |
| 剧本 | target spec、scene AST、场次编辑/锁定、Fountain/FDX/打印 HTML | 普通创建入口缺失；Plan 过薄；没有 scene card、因果审校、不可变成品版本和完整 E2E |
| 漫画 | page/panel、visual subject、media/blob、候选选择、SVG/PNG/WebP/CBZ | provider 无参考图/seed/inpainting；故事板与漫画脚本未分开；阅读顺序、气泡和一致性质量门不足 |
| 发布 | Work/adaptation 可以标记 complete | complete 只改变可变状态；没有独立创作不可变 release 和漫画媒资固定清单 |

当前五个 adaptation Skill 保留为迁移入口，但必须拆分或升级；旧 ID 只有在新语义严格兼容时才继续使用，不能悄悄改变已保存 Run Contract 的含义。

## 4. V1 产品范围

### 4.1 短篇小说 V1

- 语言：现有中文主路径。
- 规模：5,000～25,000 字，默认 3～8 章；超出时提示显式转成长篇，不自动变更产品类型。
- 产物：创作 Brief、故事结构、场景/章节卡、正文、审校问题、不可变成品版本。
- 导出：Markdown、TXT、JSON 归档包；暂不以 EPUB 排版作为完成条件。

### 4.2 小说转剧本 V1

- 类型：电影、分集剧、短剧；三者使用不同目标画像和时长/集数规则。
- 语言：`zh-CN` 主路径。
- 内部格式：中立 Screenplay AST。
- 导出：Fountain、FDX、PDF/打印 HTML。
- 非范围：锁页、修订色页、制片分解、预算排期、拍摄通告和协同审阅。

### 4.3 小说转漫画 V1

- 形态：固定页漫画，支持 LTR/RTL；Webtoon 需要独立布局与滚动节奏合同，V1 不伪装支持。
- 输出：漫画脚本、页节奏、页格分镜、视觉圣经、设定图、格图、本地排字、PNG/WebP/CBZ/PDF。
- 生图成熟度分两级：
  - `storyboard-ready`：脚本、页格、占位图和排字完整，可不依赖高级图片 provider。
  - `visual-release-ready`：参考图实际传入、媒资权利明确、人物/场景一致性通过、全部格有已选成图。
- 缺少 provider 能力时只允许达到 `storyboard-ready`，不能显示正式视觉完成。

## 5. 数据 owner 与核心产物

### 5.1 共用 adaptation 产物

以下数据由目标 screenplay/comic Work 拥有，source Work 只被版本化引用：

| 产物 | 建议存储 | 用途 |
|---|---|---|
| `AdaptationSourceFactV1` | 新表 `adaptationSourceFacts` | 事件、人物状态、关系、地点、时间、物件、主题母题；绑定 manifest 和 sourceUnitKeys |
| `AdaptationCausalEdgeV1` | 新表 `adaptationCausalEdges` | 事件间 cause/enables/motivates/reveals/prevents 关系及证据 |
| `AdaptationDecisionV1` | 新表 `adaptationDecisions` | keep/cut/merge/reorder/externalize/add，含理由、影响目标和作者状态 |
| `AdaptationBriefV2` | `adaptationProjects.brief` | 目标媒介、核心、受众、限制、自由度、禁改项和未决问题 |

事实与边不能只塞进一个大 JSON：长小说需要分块增量写入、按 sourceUnitKey 查询、局部 stale 和导入重映射。三张新表必须进入 `PROJECT_TABLES`，由 Work owner 决定导出、删除和引用生命周期。

### 5.2 产品专用产物

- 短篇：`ShortNovelProductionV1`，保存阶段、Brief、结构版本、完成条件和当前 release。
- 剧本：`ScreenplayBeatV1`、`ScreenplaySceneCardV1`、现有 `ScreenplayScene`。
- 漫画：`ComicScriptBeatV1`、`ComicPagePlanV1`、现有 page/panel/visual subject/media。
- 审校问题优先作为产品专用候选和 run checkpoint 保存；只有需要跨 run 分派、解决和发布证明时，才分别增加 screenplay/comic review 表，不建设万能 issue 表。

### 5.3 独立创作 Release

新增 `creationReleases`，仅服务 `short-novel | screenplay | comic`：

- append-only；同一 Work 版本号单调递增；旧版本永不被 reopen 修改。
- 保存产品类型、Work、父版本、来源 manifest hash、主要产物 hash、Skill/Prompt 版本、验证 receipt 和作者确认时间。
- 短篇 manifest 固定结构和有序章节正文。
- 剧本 manifest 固定 Brief、决策、beat、scene card 和 Screenplay AST。
- 漫画 manifest 固定 Brief、决策、脚本、页格、视觉圣经、排字以及已选媒资内容 hash。
- 漫画通过 `creationReleaseAssets` 固定 release 到 blob 的强引用；删除草稿候选不能破坏已发布版本。
- 该表不能复用上层运行产品的 `ProductRelease`；后者包含 WorldRelease/runtime 语义，owner 和用途不同。

## 6. Agent、Skill 与 Harness 分工

### 6.1 定义

- **Skill**：一个有严格输入、上下文白名单、输出 schema、写入目标和 verifier 的单步转换。
- **Product Agent**：根据产品状态编排多个 Skill，安排人工确认、预算、并发、暂停、恢复和局部重跑。
- **Validator/Renderer**：纯代码工具；不得由 Prompt 承担数据库 ID、格式合法性、布局碰撞或 hash 验证。
- **Critic Skill**：只产生带定位和证据的问题候选；不直接重写正式内容。
- **Rewrite Skill**：只处理作者选中的 issue 和目标 stable key；不得顺手改写无关内容。

### 6.2 Run 共同规则

每个阶段写入 Run Contract：

- 输入 source manifest、上游 artifact hash、选定 stable keys 和作者指令。
- 最大模型调用、最大输入/输出、每步最大 repair 次数和总成本预算。
- `model.requested` 后结果未知不得自动重发。
- schema/protocol repair 最多 2 次并记录可见事件；语义批评最多 2 轮，继续修改需要作者选择。
- 任一上游正式内容变化，只 stale 依赖它的下游，不抹掉旧候选或 release。
- 每次采纳保存 candidate hash、author payload hash、post-state hash 和 verification receipt。

## 7. 长小说来源阅读管线

```text
冻结 source manifest
  → 按章节/子树建立 chunk plan
  → 分块提取事实、人物状态和事件
  → grounding critic 回查相应原文
  → 合并同一实体与重复事件
  → 构造时间线和因果边
  → 作者解决高影响歧义
  → 形成可供改编检索的 Source Analysis v1
```

### 7.1 Chunk 规则

- chunk 边界优先使用章节和场景自然边界；相邻 chunk 带小范围重叠，只用于识别跨边界事件。
- 每个事实必须有稳定 key、类别、陈述、sourceUnitKeys、证据摘要、确定性 `observed | inferred | disputed`。
- `observed` 不得包含来源未出现的因果解释；推断必须标为 `inferred` 并说明依据。
- 合并器只能合并同实体同事件，不能为了简化而删除冲突；冲突进入 unresolved 列表。
- 生成场次或页格时读取相关原文、相关事实、相邻事件和上游计划，不读取全部提取结果。

### 7.2 来源充分性

只有大纲没有正文时允许创建 `outline-only` 分析，但 UI、candidate 和 release 必须显示覆盖等级；不能把大纲推断写成“来自原文的事实”。

## 8. 短篇小说专业管线

```text
ShortNovelProductionAgentV1
  → short.intent-brief
  → short.story-design
  → short.scene-plan
  → short.chapter-draft（逐章）
  → short.continuity-review
  → short.targeted-rewrite
  → deterministic completion check
  → CreationRelease
```

| Skill ID | 主要输入 | 候选输出 | 正式写入/闸门 |
|---|---|---|---|
| `short.intent-brief` | 作者意图、题材、目标字数、禁区 | 核心变化、主导情绪、视角、承诺、必须保留 | `shortNovelProductions.brief`；作者确认 |
| `short.story-design` | Brief、可选人物/设定 | 开端压力、升级、不可逆转折、高潮选择、余韵 | 产品结构字段；作者确认 |
| `short.scene-plan` | 已确认设计 | 3～8 个 scene/章节卡，含目标、冲突、转折和字数预算 | 复用 outline/chapter，但写入登记 extension |
| `short.chapter-draft` | 单章卡、相邻卡、近程正文、必要事实 | 单章正文候选 | 现有 chapter candidate/adopt；逐章确认 |
| `short.continuity-review` | 全局结构、正文摘要、关键原文 | 问题列表 | 只读 critic；作者选择 |
| `short.targeted-rewrite` | issue、目标段落、局部上下文 | patch 候选 | 只修改指定章节/段落 |

短篇完成条件：目标字数范围有效、结构和章节无缺口、无未解决 critical issue、无 stale 候选、作者确认最终版本；界面不显示长篇的百万字规模管理模块。

## 9. 小说转剧本专业管线

```text
ScreenplayAdaptationAgentV1
  → adaptation.source-inventory（分块）
  → adaptation.grounding-review（分块/合并后）
  → adaptation.causal-graph
  → adaptation.editorial-brief
  → screenplay.character-arc
  → screenplay.beat-sheet
  → screenplay.scene-breakdown
  → screenplay.scene-draft（按 1～5 场批次）
  → screenplay.source-continuity-review
  → screenplay.targeted-rewrite
  → deterministic format/render verification
  → CreationRelease
```

### 9.1 Skill 目录

| Skill ID | 职责 | 关键输出 | 人工闸门 |
|---|---|---|---|
| `adaptation.source-inventory` | 从一个 chunk 提取人物、事件、地点、时间和母题 | SourceFact 批次 | 无；需 grounding 通过 |
| `adaptation.grounding-review` | 用对应原文检查遗漏、错误归因和幻觉 | issue + corrected patch candidate | 高影响冲突需作者裁决 |
| `adaptation.causal-graph` | 连接关键事件，区分时序和因果 | event nodes + causal edges | 作者确认主线与被舍弃支线 |
| `adaptation.editorial-brief` | 决定原作核心和改编自由度 | Brief V2 + decision seeds | 必须确认 |
| `screenplay.character-arc` | 设计主角/对手欲望、策略、赌注、变化 | character arc cards | 主要人物必须确认 |
| `screenplay.beat-sheet` | 按电影/剧集/短剧画像分配幕、集、序列和时长 | beats + source/decision keys | 必须确认 |
| `screenplay.scene-breakdown` | 将 beat 拆为逐场可执行卡 | SceneCard | 批量确认/编辑 |
| `screenplay.scene-draft` | 将 SceneCard 写为 Screenplay AST | 1～5 场候选 | 批次采纳 |
| `screenplay.source-continuity-review` | 检查忠实度、因果、人物知识、连续性和可拍性 | 定位到 scene/block 的 issues | 作者选择修复项 |
| `screenplay.targeted-rewrite` | 修复选定问题 | scene/block patch | 采纳前 diff |

### 9.2 SceneCard 最小字段

- `stableKey`、`beatKey`、episode/order、sourceUnitKeys、decisionKeys。
- 场景功能、人物目标、阻碍、策略、转折、进入/退出状态。
- INT/EXT、地点、时间、出场角色、关键道具。
- 必须外化的内心活动及允许手段：行为、潜台词、视觉母题、声音、有限旁白。
- 预计秒数和对白密度预算。
- 与前后场的 continuity handoff。

### 9.3 格式与专业规则

Screenplay AST 保持现有 action/character/parenthetical/dialogue/transition/shot/note，并增加 validator，而不是增加自由文本格式字段：

- scene heading 必须具备内外景、地点和时间；人物 cue 在同一作品中保持稳定。
- action 只写可见/可听内容；大段背景、心理解释或小说式修辞产生 review issue。
- character 后才能出现 parenthetical/dialogue；parenthetical 不悬空；空对白和孤立 cue 为 error。
- transition、shot 和 parenthetical 的使用频度是 warning，不由代码直接删除。
- 电影和分集剧分别计算页数/时长画像；“一页约一分钟”只作为估算，不成为硬性真理。
- Fountain round-trip、FDX XML parse、PDF/打印分页和 Unicode 字体必须有自动测试。

## 10. 小说转漫画专业管线

```text
ComicAdaptationAgentV1
  → adaptation 来源分析与 Brief
  → comic.script-adaptation
  → comic.page-rhythm
  → comic.panelization
  → comic.visual-bible
  → comic.subject-sheet-production
  → comic.render-spec
  → media generation / upload / candidate selection
  → comic.visual-consistency-review
  → comic.lettering-layout
  → comic.page-qa + targeted repair
  → storyboard release 或 visual release
```

### 10.1 Skill 目录

| Skill ID | 职责 | 关键输出 | 人工闸门 |
|---|---|---|---|
| `comic.script-adaptation` | 把因果结构改写成漫画脚本节拍 | 场景/节拍、视觉动作、对白意图 | 作者确认脚本 |
| `comic.page-rhythm` | 分配章节、页、翻页揭示、停顿和高潮 | PagePlan | 作者确认分页 |
| `comic.panelization` | 把页面拆成可绘制的单一时刻 | panel function、shot、visible moment、lettering intent | 批量确认 |
| `comic.visual-bible` | 固定全局风格和禁用项 | GlobalVisualBible V2 | 必须确认 |
| `comic.subject-design` | 固定角色、地点、道具的稳定属性和状态变体 | VisualSubject candidates | 每个主要 subject 确认 |
| `comic.render-spec` | 从 panel + subject state 组装 provider-neutral 请求 | RenderSpec，不直接写最终图片 Prompt | 无；确定性预检 |
| `comic.visual-consistency-review` | 对照设定图、相邻格和脚本检查候选图 | identity/style/state/composition issues | 作者选图或重做 |
| `comic.lettering-suggest` | 为已确认构图建议气泡/旁白/拟声位置 | lettering candidate | 作者确认；代码排版 |
| `comic.page-qa` | 检查阅读顺序、文字负担、遮挡、出血和完整性 | 页级 issues/receipt | critical 必须修复 |
| `comic.targeted-repair` | 只修复指定格、subject 或排字项 | 新候选或 patch | 不覆盖旧候选 |

### 10.2 Panel 最小语义

- 每格只定义一个占主导的可见时刻；“先做 A 再做 B”应拆格或明确 B 只是残留状态。
- `narrativeFunction` 使用 establish/setup/escalate/peak/reaction/release/transition 等可读标签；它是规划辅助，不把单一漫画理论当成硬格式。
- 保存画面主体、动作、表情、镜头、构图、前后状态、sourceUnitKeys、decisionKeys。
- 对白先保存 speaker、intent、text、readingOrder；气泡 frame 是布局结果，不由脚本 Skill 猜最终坐标。
- 页面必须保存 readingDirection、pageTurnIntent、safe area、trim 和 bleed。

### 10.3 视觉一致性

视觉一致性采用结构化锚点，不等于“Prompt 尽量写一样”：

- subject 具有稳定 key、基础外貌、轮廓、面部、发型、服装、色板、材质、标志和 prohibited changes。
- 可变状态单独版本化，例如衣服损坏、携带道具、伤势、时间和光照；panel 引用明确的 subject state。
- provider request 保存实际发送的参考图 hash、模型、能力快照、seed/inpaint 参数和 request hash。
- provider 不支持参考图时，必须由作者显式选择 `limited-consistency`；此模式不能通过 visual release gate。
- 多模态 critic 输出定位到 subject attribute 的问题，不输出“整体不太像”这类不可执行意见。
- 自动相似度只作为筛查信号；主要角色正式版本仍需作者选图确认。

### 10.4 排字、阅读顺序与印刷

- 图片层和文字层分离；文字可编辑、可重新测量和可本地化。
- LTR/RTL 分别生成预期 panel/balloon 顺序；阻塞式布局、交叉 tail、气泡遮挡脸或关键动作进入 QA。
- 中文容量使用实际 font metrics、行距、字向和 frame 计算；不截断文本适配气泡。
- overflow、重叠、越 safe area、tail 无说话人、阅读顺序歧义在正式 visual release 中是 error；作者 override 必须留下带理由的 receipt，且 UI 不显示无警告绿标。
- 输出检查页面尺寸、DPI、trim、bleed、色彩模式、页序和 CBZ manifest；导出读取 release 固定资产，不读取当前草稿选择。

## 11. Prompt Spec

### 11.1 所有正式 Prompt 的固定结构

每个 `promptVersion` 由以下区块按稳定顺序生成：

1. **Role**：具体职业和当前阶段，例如“改编编辑”“场景编剧”“漫画分镜师”，不用万能“创作大师”。
2. **Truth boundary**：只能使用登记上下文；摘要不是原文；观察、推断和新增必须区分。
3. **Objective**：本次只产生一种 artifact，并说明它不负责的下游工作。
4. **Upstream contracts**：列出 source manifest、Brief、事实、计划和目标 stable keys/hash。
5. **Craft rules**：只放当前阶段真正需要的专业规则。
6. **Author constraints**：must keep、forbidden、自由度、目标规格和本次附加要求。
7. **Output schema**：闭集字段、枚举、数量和引用规则。
8. **Evidence rules**：每项来源引用与允许新增的标记方法。
9. **Failure mode**：证据不足时返回 unresolved issue，禁止用虚构补齐。
10. **Silent checklist**：模型在输出前自检，但不得输出隐藏推理过程；真正验收仍由独立 verifier 完成。

### 11.2 来源事实提取 Prompt 蓝图

```text
ROLE: 你是来源分析编辑，只提取当前 source chunk 可支持的事实。
OBJECTIVE: 生成 AdaptationSourceFactV1[]；不做改编、不写场景、不评价文风。
TRUTH: observed 必须能由 sourceUnitKeys 支持；解释性判断标 inferred；冲突标 disputed。
IDENTITY: 沿用已有 entityKey；无法确认是否同一实体时创建 unresolvedLink，不擅自合并。
OUTPUT: 严格 JSON；stableKey 可移植；不得输出数据库数字 ID；每项包含类别、陈述、时间锚点、参与实体、sourceUnitKeys 和 certainty。
FAIL: 本段没有目标事实时返回空数组；不得为了满足数量制造事件。
```

### 11.3 剧本场景写作 Prompt 蓝图

```text
ROLE: 你是场景编剧，只写选定 SceneCard 对应的 Screenplay AST。
OBJECTIVE: 实现场景目标、阻碍和转折；不得改变已确认 beat 或偷偷解决后续冲突。
SOURCE: 使用本场 sourceUnitKeys、事实、decision keys、人物弧及前后场 handoff。
CINEMATIC: action 只包含观众可见或可听内容；将内心活动转为行为、潜台词、声音或 Brief 允许的旁白。
DIALOGUE: 保持人物词汇、策略和潜台词差异；避免用对白复述双方已知信息。
FORMAT: 严格输出 scene schema；character → optional parenthetical → dialogue；不得用空块模拟排版。
EVIDENCE: 新增桥接内容必须引用 allowed-addition decision；证据不足返回 issue，不编造原作事实。
```

### 11.4 漫画页格规划 Prompt 蓝图

```text
ROLE: 你是漫画脚本与分镜规划师；当前只做页格叙事，不生成图片 Prompt。
OBJECTIVE: 把已确认 ComicScriptBeat 分配到页面和格，形成清晰节奏、翻页和阅读顺序。
MOMENT: 每格一个主导可见时刻；需要时间推进时拆格或通过明确的视觉省略表达。
PAGE: 尊重 readingDirection、目标格数、pageTurnIntent、高潮与停顿；先保证可读，再考虑复杂版式。
LETTERING: 输出说话人、文本、类型和顺序，不猜最终字体坐标；控制文字负担并保留画面空间。
CONTINUITY: 每个角色、地点、道具引用稳定 subject/state key；不得只复制自然语言外貌。
OUTPUT: 严格 JSON；sourceUnitKeys 和 decisionKeys 必须存在于允许集合。
```

### 11.5 视觉一致性批评 Prompt 蓝图

```text
ROLE: 你是视觉连续性审校，不负责重新创作画面。
INPUT: 候选图、subject reference、相邻已选格、PanelSpec 和允许变化状态。
CHECK: identity、silhouette、face、hair/costume、prop、location、time/lighting、style、shot/composition、script semantics。
OUTPUT: issues[]；每项包含 severity、panelKey、subjectKey、attribute、expected、observed、evidenceAssetKeys、repairScope。
RULE: 只报告可定位差异；不要以单一审美偏好否决作者允许的风格变化。
FAIL: 无法看清或 provider 不支持图像输入时返回 unverifiable，不得假装通过。
```

### 11.6 Prompt 版本与评测

- Prompt 不在组件中拼接；模板和输出 schema 与 Skill 同版本登记。
- 修改 craft rule、输入字段或输出语义必须升级 `promptVersion` 并跑 golden/negative eval。
- 只改错字且不影响语义时可保留版本，但仍需生成手册一致性检查。
- 生产 Prompt 不内嵌受版权保护的完整专业剧本或漫画页作为 few-shot；测试语料使用原创、合成或明确允许的短片段。

## 12. Context 与 Adoption 设计

### 12.1 新 Context Sources

计划登记：

- `adaptation.sourceFacts`
- `adaptation.causalGraph`
- `adaptation.decisions`
- `adaptation.unresolvedQuestions`
- `short.currentBrief`
- `short.currentStructure`
- `screenplay.characterArcs`
- `screenplay.beatSheet`
- `screenplay.sceneCards`
- `screenplay.neighborSceneState`
- `comic.scriptBeats`
- `comic.pagePlans`
- `comic.subjectStates`
- `comic.neighborPanels`
- `comic.selectedReferences`

每个 Skill 只声明实际需要的 keys；`selectedPlanSectionKeys` 继续用于缩小场次/页格批次。Context Gateway 对原文、事实、相邻状态和远距回查分别预算，不使用固定“最近 N 条”代替语义选择。

### 12.2 新 Write Targets

- 来源分析只写 adaptation facts/edges；不能写 screenplayScenes 或 comicPanels。
- 编辑 Brief 只写 Brief/decision candidate。
- 剧本结构 Skill 只写 beats/cards；场景 Skill 才能写 scene candidate。
- 漫画脚本、分页、页格、visual subject、媒资和排字分别登记。
- critic 默认为只读；review issue 若采纳为正式产品状态，需要独立字段或表和明确 adoption extension。
- release 只能由确定性发布 service 写入，任何生成 Skill 都没有 release 写权限。

## 13. 产品 UI 与人工闸门

### 13.1 共用创建入口

Product Hub 增加“小说转剧本”和“小说转漫画”：

1. 选择本地小说 Work。
2. 选择整部、章节范围、明确章节或大纲子树。
3. 预览字数、覆盖等级、缺失正文和冻结后的 source units。
4. 配置目标规格和预算。
5. 确认后原子创建目标 Work、AdaptationProject 和 manifest。

世界页面不增加改编入口；改编源是作者选择的小说，不是可变世界草稿。

### 13.2 工作台体验

- 顶部显示阶段、当前来源版本、已完成/待确认/已 stale 数量和成本预算。
- 作者默认编辑结构化表单，不要求直接编辑大段 JSON；高级诊断可查看 JSON 和 hash。
- 每阶段支持：生成候选、比较、编辑、采纳、拒绝、查看来源、重新运行和恢复。
- 下游已有内容时修改上游，先显示影响范围；作者选择保留旧版本、局部重算或新建分支方案。
- 失败不会清空已确认产物；刷新后恢复到最后可验证 checkpoint。

### 13.3 必须人工确认的节点

- 来源范围和目标规格。
- Adaptation Brief/短篇 Brief。
- 主线取舍、改编决策和主要人物弧。
- 剧本 beat sheet / 漫画脚本与分页。
- 漫画视觉圣经和主要 subject 设定图。
- 最终 release；任何 Agent 无权自动发布。

## 14. 验证器与质量门

### 14.1 剧本确定性验证

- 所有 scene/card/beat stable key 唯一且引用存在。
- scene numbering、episode、order 和 plan coverage 连续。
- block 状态机合法；无孤立 dialogue/parenthetical、空 cue 或非法 extension。
- scene heading 完整；source/decision coverage 满足目标 profile。
- Fountain 解析回读保持场景和块顺序；FDX 是合法 XML 且可回读核心元素。
- render 不丢中文、分页不截断标题页或将 parenthetical 单独留在页尾。

### 14.2 漫画确定性验证

- 页、格、panel/balloon 顺序与 readingDirection 一致且无非法重叠。
- trim、bleed、safe area 和目标输出像素有效。
- lettering 通过真实字体测量；无溢出、相互遮挡、越界和无效 tail。
- 每个 continuity ref、subject state、selected asset 和 blob hash 可解析且属于当前 Work。
- visual release 所有主要 subject 有已选参考图，provider receipt 证明参考图实际发送。
- PNG/WebP/CBZ/PDF 页数、顺序、尺寸、色彩模式和 manifest 一致。

### 14.3 AI/人工质量量表

每项 1～5 分；AI 评测只作辅助，最终产品门包含至少一次作者或盲评者评分：

| 剧本维度 | 漫画维度 |
|---|---|
| 来源忠实与新增透明度 | 来源忠实与新增透明度 |
| 因果和结构完整性 | 视觉叙事与页格节奏 |
| 人物欲望、声音和弧线 | 角色/场景/道具连续性 |
| 场景目标、冲突和转折 | 构图、动作与格间可理解性 |
| 可见/可听的电影化表达 | 阅读顺序、翻页和留白 |
| 对白、潜台词和节奏 | 对白、气泡、拟声与画面平衡 |
| 格式可读性和连续性 | 媒资质量、排字和成品完整性 |

进入正式 release 的最低门：无 critical/error；关键来源事实 precision 不低于 0.98；must-keep 覆盖 100%；来源映射 100%；人工量表平均不低于 4.0 且单项不低于 3.5。若样本表明阈值不合理，必须通过版本化 eval 方案调整，不能在单次发布时临时放宽。

## 15. 样例与评测集

所有常驻仓库的样例必须原创或合成，避免把受版权保护的小说、剧本或漫画整段提交到仓库。

| Fixture | 内容 | 主要验证 |
|---|---|---|
| `IC-GOLDEN-01` | 《凌晨一点十七分》约 12,000 字、4 章、封闭车站悬疑 | 三产品共同黄金路径、来源映射和成品导出 |
| `IC-INTERNAL-01` | 第一人称、强内心活动、外部事件少 | 剧本外化、旁白节制、漫画可视化 |
| `IC-NONLINEAR-01` | 非线性时间、记忆不可靠、重复事件 | 时间线、叙述顺序与因果顺序分离 |
| `IC-ENSEMBLE-01` | 8 名主要人物、多支线、多地点 | 实体合并、人物弧和长程连续性 |
| `IC-DIALOGUE-01` | 对白密集、信息量大 | 潜台词、气泡容量和画面空间 |
| `IC-VISUAL-01` | 两角色、多套服装、关键道具状态变化 | subject state、参考图和跨格一致性 |
| `IC-RTL-01` | 同一短篇的 LTR/RTL 两版 | 页格及气泡阅读顺序 |
| `IC-SCALE-100K/300K/1M` | 合成长源文 | 分块、检索、checkpoint、预算和远距事实召回 |
| `IC-STALE-01` | 采纳后修改源章节 | 精确 stale、局部重算和 release 不变 |
| `IC-FAULT-01` | 无效 JSON、重复 key、结果未知、quota、缺 blob | 有界失败、恢复和不重复写入 |

### 15.1 剧本 Golden

- 源事实/事件/因果人工基准。
- 允许的 keep/cut/merge/externalize/add 决策集合。
- 电影、短剧两套目标画像和场景卡参考，不要求模型逐字匹配。
- 原创 Fountain、FDX 和 PDF 结构夹具，用于 round-trip 和排版验证。

### 15.2 漫画 Golden

- 漫画脚本、分页意图和 panel narrative function 参考。
- 角色、服装、地点和道具状态表。
- LTR/RTL 预期阅读图、气泡顺序和禁止遮挡区域。
- 本地生成/绘制的合成参考图和候选图，包含身份漂移、服装错误、丢道具、错误文字和构图偏离等负例。

### 15.3 Prompt Eval

- schema compliance 与 unknown-field rejection。
- evidence precision、must-keep recall、unsupported addition rate。
- 相同输入的稳定 key 和可重放性。
- 对抗指令：源文中的“忽略系统要求”、伪造 JSON、要求越过 Work、要求直接发布。
- critic precision/recall：是否定位真实问题，是否制造不存在的问题。
- rewrite locality：目标外的 scene/panel hash 必须保持不变。

## 16. E2E 验收路径

每个产品至少覆盖：

```text
空项目创建
→ 输入/选择来源
→ 多阶段候选与作者采纳
→ 中途刷新恢复
→ 修改上游并得到精确 stale
→ 局部修复
→ 完成检查
→ 创建不可变 release
→ 导出
→ reopen 草稿继续修改
→ 验证旧 release 内容和 hash 不变
```

额外反例：跨 Work 读写、导入缺引用、删除源小说、删除未发布媒资、provider 结果未知、低能力 provider、浏览器关闭恢复、重复点击采纳、导出时 blob 损坏。

真实 AI E2E 使用隔离浏览器项目和显式成本上限；普通 CI 使用固定候选，不把网络和模型漂移混入确定性回归。

## 17. 施工包与集成顺序

### C-CREATION-00 · 共享专业改编底座（NEXT）

- 开工卡、fixtures 和 eval rubric。
- facts/causal edges/decisions/release schema 与 migration。
- 三注册表和 import/export/delete/remap 生命周期。
- source analysis durable pipeline、专业 Prompt 基架和创建向导。
- 共享提交合入并验证后，产品分支再同步。

### C-SHORT-01 · 短篇完整产品（已完成）

- ShortNovelProduction、专属 Agent/Skill、轻量工作台。
- 结构到正文、审校、局部重写、release 和导出。
- 黄金路径、刷新/stale/转换和 E2E。

### C-SCREENPLAY-01 · 小说转剧本完整产品

- arc/beat/scene card/scene draft/review/rewrite。
- 电影、分集剧、短剧目标画像。
- Fountain/FDX/PDF 从 release 导出。
- 12K 黄金样例、100K+ 来源规模门和真实 AI 纵切面。

### C-COMIC-01A · 漫画脚本与页面里程碑

- comic script、page rhythm、panelization、视觉圣经和本地排字。
- 无真实生图也能完成 storyboard release。
- LTR/RTL、页面安全区、CBZ/PDF 和 UI E2E。

### C-COMIC-01B · 漫画视觉生产里程碑

- provider capability negotiation、实际参考图传输、候选和局部修复。
- subject state、多模态一致性检查、权利和 release asset pinning。
- 只有通过真实 provider 和人物连续性验收后，产品成熟度才可提升。

### 集成纪律

1. `feat/independent-creation-closure` 只完成三份方案、审查和必要的 C-CREATION-00 设计。
2. `feat/independent-creation-integration` 是本地串行集成分支，不在其中直接开发产品。
3. 三个产品分别使用独立 worktree 和唯一功能分支：`feat/shortform-production`、`feat/screenplay-production`、`feat/comic-production`。
4. 每个产品分支从当时已审定的集成基线创建；不得从另一个仍有未合并或未提交改动的产品 worktree 拉出。
5. schema、三注册表、公共 adaptation contracts 不由多个产品分支各自发明；第二个真实调用方出现前先形成独立 foundation 提交并合入集成基线。
6. 合入顺序：规划/共享底座 → 短篇 → 剧本 → 漫画脚本/排版 → 漫画真实媒资。
7. 漫画脚本与视觉生产是一个漫画产品分支内的两个里程碑，不构成第四个产品。
8. 每个产品达到自己的完成判据才调整自身成熟度，不能因共享底座或兄弟产品完成而整体宣称完成。

## 18. 每包验证闸门

定向阶段：

- contract/assertion、registry、adoption、stale、transaction、scope、migration 和 renderer 单测。
- fixture eval、negative eval、fault injection 和目标 UI 组件测试。

提交前：

```bash
npm run check:architecture
npm run check:required-tables
npm run check:ai-manual
npm run check:ai-entry-registry
npx tsc --noEmit
npm test -- <affected tests>
npm run build
git diff --check
```

交付：

```bash
npm run ci
npm run ci:e2e
```

真实 provider 验收单独保存模型、能力快照、输入 hash、输出 hash、成本和人工评分；网络或余额阻塞不能降低其余确定性门。

## 19. 明确非范围与停止条件

非范围：

- 不修改世界引擎为短篇/剧本/漫画保存生产数据或媒资。
- 不把剧本场次复用为小说章节，不把漫画 panel 复用为上层产品 scene。
- 不开发拍摄制片、多人实时协同、出版平台、在线市场或 DRM。
- 不训练自有基础模型；先使用 provider-neutral contract 验证产品流程。
- 不因图片模型能出单图就宣称漫画一致性完成。

出现以下情况停止扩大改动并请求产品决策：

- 需要改变三产品 owner 或总纲边界。
- 真实作者样例显示电影、短剧或页漫需要互相冲突的数据模型。
- schema 迁移可能丢失现有用户数据。
- provider 无法证明商业使用/再分发权利却要求正式发布。
- 关键来源映射、旧 release 不变性或漫画媒资完整性反例失败。

## 20. 研究来源

访问日期均为 2026-09-06：

1. [Sundance Collab · Writing Screenplay Adaptations](https://collab.sundance.org/catalog/Writing-Screenplay-Adaptations)
2. [Screen Australia · Story Documents: Drama](https://www.screenaustralia.gov.au/getmedia/133af42b-7abe-4ebc-a164-799c1c7a4614/Story-Documents-Drama.pdf)
3. [Academy Nicholl · Screenwriting Resources](https://www.oscars.org/nicholl/screenwriting-resources)
4. [BBC Writersroom · Screenplay Format for TV Shows](https://downloads.bbc.co.uk/writersroom/scripts/screenplaytv.pdf)
5. [Final Draft · Screenplay Formatting and Elements](https://www.finaldraft.com/learn/screenplay-formatting-elements/)
6. [Fountain Syntax](https://fountain.io/syntax/)
7. [R²: A LLM Based Novel-to-Screenplay Generation Framework with Causal Plot Graphs](https://arxiv.org/abs/2503.15655)
8. [Google DeepMind · Co-Writing Screenplays and Theatre Scripts with Language Models](https://deepmind.google/research/publications/13609/)
9. [IBSEN: Director-Actor Agent Collaboration for Drama Script Generation](https://aclanthology.org/2024.acl-long.88/)
10. [Dark Horse · Script Format and Specifications](https://images.darkhorse.com/darkhorse08/company/submissions/scriptguide.pdf)
11. [Visual Narrative Structure](https://onlinelibrary.wiley.com/doi/10.1111/cogs.12016)
12. [The Architecture of Visual Narrative Comprehension](https://pmc.ncbi.nlm.nih.gov/articles/PMC4076615/)
13. [Navigating Comics: Reading Comic Page Layouts](https://doi.org/10.3389/fpsyg.2013.00186)
14. [Narrative Graph Prompting for Visually Consistent Storytelling](https://openaccess.thecvf.com/content/ICCV2025W/AISTORY/html/Shin_Generating_Visually_Consistent_Images_for_Storytelling_via_Narrative_Graph_Prompting_ICCVW_2025_paper.html)
15. [StoryGPT-V: Consistent Story Visualizers](https://openaccess.thecvf.com/content/CVPR2025/html/Shen_StoryGPT-V_Large_Language_Models_as_Consistent_Story_Visualizers_CVPR_2025_paper.html)
16. [Make-a-Story: Visual Memory Conditioned Consistent Story Generation](https://openaccess.thecvf.com/content/CVPR2023/html/Rahman_Make-a-Story_Visual_Memory_Conditioned_Consistent_Story_Generation_CVPR_2023_paper.html)
17. [Clip Studio Paint · Creating a New Canvas](https://help.clip-studio.com/en-us/manual_en/210_file/Creating_a_New_Canvas.htm)
18. [Content Planning for Neural Story Generation](https://aclanthology.org/2020.emnlp-main.351/)
19. [Plan, Write, and Revise](https://aclanthology.org/N19-4016/)

## 21. 计划完成定义

本计划完成不等于三个产品已经完成。它的完成证据是：产品边界、V1 范围、Agent/Skill DAG、数据 owner、Prompt Spec、确定性验证、样例、质量量表、生命周期、施工包和停止条件均已明确，并已进入现行文档路由。后续任何施工若偏离本计划，必须先更新产品契约或本计划并说明原因，不能靠代码造成既成事实。
