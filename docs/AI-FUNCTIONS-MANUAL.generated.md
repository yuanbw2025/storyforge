# AI 行为说明书（自动生成 · 请勿手动编辑）

> 由 `scripts/generate-ai-manual.mjs` 从代码扫描生成。
> 修改 AI 行为后请运行 `npm run gen:ai-manual` 重新生成。CI 用 `npm run check:ai-manual` 校验一致性。
> 语义注解(每个动作的业务意图/坑)写在 `AI-FUNCTIONS-MANUAL.semantic.md`(手工维护)。

---

## 一、Prompt 模板清单（PromptModuleKey 事实源）

共 65 个唯一 moduleKey，210 条内置模板定义。

| moduleKey | 模板数 | 代表名称 | 说明 | 读取变量 |
|---|---:|---|---|---|
| `worldview.dimension` | 6 | 内置-世界观维度生成 | 为世界观的单个维度（地理/历史/社会/文化/经济/规则/摘要）生成内容。 | `projectName` `genres` `dimension` `worldContext` `worldRulesContext` `userHint` `isSummary` |
| `character.generate` | 6 | 内置-角色完整设计 | 基于世界观和已有角色，设计一个新角色的完整资料。 | `projectName` `genres` `worldContext` `existingCharacters` `userHint` |
| `character.dimension` | 1 | 内置-角色维度补全 | 为指定角色的某个维度（背景/性格/能力等）补充约 200-400 字的细节。 | `characterName` `characterInfo` `worldContext` `dimension` |
| `outline.volume` | 8 | 内置-卷级大纲生成 | 基于世界观与故事核心生成全书的卷级大纲。 | `projectName` `genres` `targetWordCount` `worldContext` `storyCore` `characterContext` `worldRulesContext` `existingVolumesContext` `userHint` |
| `outline.chapter` | 1 | 内置-章节大纲展开 | 将单卷展开为 15-25 章的章节大纲。 | `volumeTitle` `volumeSummary` `worldContext` `prevVolumeSummary` `characterContext` `worldRulesContext` `userHint` |
| `chapter.content` | 22 | 内置-长篇连载（默认） | 通用男频网文风格的章节正文生成，支持基调/节奏/字数三个可调参数。 | `chapterTitle` `chapterSummary` `worldContext` `characters` `previousChapterEnding` `worldRulesContext` `userHint` |
| `chapter.continue` | 6 | 内置-章节续写 | 从已有正文末尾继续往下写约 1000-2000 字。 | `chapterSummary` `worldContext` `existingContent` `userHint` |
| `chapter.memory` | 1 | 内置-章节连续性记忆 | 一次调用同时提取章节摘要、下一章承接 handoff 与计划正文对账；引文 offset 由系统回查，不信任模型位置。 | `chapterTitle` `chapterPlan` `nextChapterPlan` `chapterText` |
| `chapter.polish` | 1 | 内置-文本润色 | 按用户指令润色文本，保持原意不变。 | `instruction` `text` |
| `chapter.expand` | 1 | 内置-文本扩写 | 将文本扩展丰富，增加细节、心理与环境，情节走向不变。 | `userHint` `text` |
| `chapter.condense` | 1 | 内置-文本缩写 | 在保留事实、因果与人物立场的前提下压缩局部正文。 | `text` |
| `chapter.rewrite` | 1 | 内置-保真改写 | 以不同表达重写局部正文，同时保持故事事实和信息边界。 | `text` |
| `chapter.check` | 1 | 内置-局部正文查漏 | 检查局部正文中的可核对问题，只给报告，不生成替换稿。 | `text` |
| `chapter.de-ai` | 1 | 内置-去 AI 味改写 | 把 AI 味重的文本改写得更像真人写的。 | `text` |
| `foreshadow.generate` | 2 | 内置-伏笔建议 | 基于世界观、角色和已有伏笔，建议 3-5 个新伏笔。 | `projectName` `genres` `worldContext` `characters` `existingForeshadows` `hasNoForeshadows` |
| `geography.concept-map` | 1 | 内置-概念地图 SVG | 基于地点列表生成奇幻风格的 SVG 概念地图。 | `overview` `locationList` |
| `geography.image-map-prompt` | 1 | 内置-地图图像 Prompt | 生成 Midjourney/DALL-E/SD 的世界地图绘图 prompt。 | `imageStyle` `projectName` `locationNames` `locationTypes` |
| `worldview.generate` | 0 | — | — | — |
| `worldview.worldbuilding` | 12 | 小说内容-P05-A-叙事最小世界规格 | 世界观 · 世界观 · 叙事最小世界规格。 使用现有模板或工作流运行。 | `story_core` `characters` `genre_promise` `research_boundary` `existing_world` `userHint` |
| `story.generate` | 6 | 内置-故事核心生成 | 基于已有世界观和用户提示，生成故事的某个维度（一句话/概念/主题/核心冲突等）。 | `projectName` `genres` `dimension` `worldContext` `userHint` |
| `story.brief` | 1 | 小说内容-P00-A-小说立项：创作任务简报与缺口诊断 | 立项 · 立项 · 小说立项：创作任务简报与缺口诊断。 使用现有模板或工作流运行。 | `raw_intent` `existing_materials` `explicit_constraints` `length_mode` `serialization_mode` `genre_candidates` `target_readers` `delivery_form` `userHint` |
| `story.ideation` | 1 | 小说内容-P01-A-灵感阶段：混杂素材净化与原创灵感卡 | 灵感 · 灵感 · 灵感阶段：混杂素材净化与原创灵感卡。 使用现有模板或工作流运行。 | `materials` `author_direction` `userHint` |
| `story.positioning` | 1 | 小说内容-P02-A-定位阶段：题材、读者承诺与差异化 | 定位 · 定位 · 定位阶段：题材、读者承诺与差异化。 使用现有模板或工作流运行。 | `story_direction` `length_mode` `delivery_mode` `author_preferences` `candidate_genres` `userHint` |
| `story.core` | 5 | 小说内容-P03-A-故事核心：概念筛选与前提压力测试 | 故事核心 · 故事核心 · 故事核心：概念筛选与前提压力测试。 使用现有模板或工作流运行。 | `creative_brief` `genre_promise` `candidate_ideas` `author_nonnegotiables` `userHint` |
| `story.packaging` | 5 | 小说内容-P16-A-书名发散与筛选 | 包装 · 包装 · 书名发散与筛选。 使用现有模板或工作流运行。 | `core` `genre` `tone` `avoid` `userHint` |
| `rules.generate` | 1 | 内置-创作规则生成 | 基于项目类型和世界观，建议适配的创作规则（风格/视角/基调/禁忌等）。 | `projectName` `genres` `dimension` `worldContext` `storyCore` `userHint` |
| `research.method` | 7 | 小说内容-P04-A-研究问题树与最小考证计划 | 研究考证 · 研究考证 · 研究问题树与最小考证计划。 使用现有模板或工作流运行。 | `story_core` `time_place` `key_scenes` `domains` `fictionalization` `existing_sources` `userHint` |
| `prompt.operations` | 5 | 小说内容-P17-A-Prompt 运行复盘与差异归因 | Prompt 管理 · Prompt 管理 · Prompt 运行复盘与差异归因。 使用现有模板或工作流运行。 | `metadata` `input` `output` `accepted` `feedback` `userHint` |
| `detail.scene` | 1 | 内置-细纲场景生成 | 把单章大纲展开为若干场景（每个场景含人物 / 地点 / 冲突 / 节奏）。 | `chapterTitle` `chapterSummary` `worldContext` `characters` `previousChapterEnding` `userHint` |
| `detail.chapter-planning` | 5 | 小说内容-P10-A-章节任务单 | 章场规划 · 章场规划 · 章节任务单。 使用现有模板或工作流运行。 | `volume_goal` `chapter_outline` `previous_actual` `next_plan` `states` `userHint` |
| `character.design` | 13 | 小说内容-P06-A-核心人物压力模型 | 人物 · 人物 · 核心人物压力模型。 使用现有模板或工作流运行。 | `story_core` `world_pressure` `character` `story_role` `userHint` |
| `outline.plot` | 22 | 小说内容-P07-A-目标—动机—冲突发动机 | 剧情 · 剧情 · 目标—动机—冲突发动机。 使用现有模板或工作流运行。 | `story_core` `characters` `world_constraints` `length_mode` `userHint` |
| `outline.structure` | 1 | 小说内容-P08-A-结构阶段：结构模型选择与全书转折 | 结构 · 结构 · 结构阶段：结构模型选择与全书转折。 使用现有模板或工作流运行。 | `story_core` `character_arcs` `world_and_constraints` `genre_promise` `length_mode` `delivery_mode` `target_words` `known_ending` `userHint` |
| `outline.long-form` | 4 | 小说内容-P09L-A-全书阶段与卷级架构 | 长篇架构 · 长篇架构 · 全书阶段与卷级架构。 使用现有模板或工作流运行。 | `story_core` `major_turns` `character_arcs` `plot_lines` `target_length` `written_progress` `userHint` |
| `outline.short-story` | 4 | 小说内容-P09S-A-短篇核心变化设计 | 短篇架构 · 短篇架构 · 短篇核心变化设计。 使用现有模板或工作流运行。 | `idea` `target_words` `emotion_or_insight` `rules` `userHint` |
| `outline.serialization` | 4 | 小说内容-P09R-A-阶段阅读回报规划 | 连载架构 · 连载架构 · 阶段阅读回报规划。 使用现有模板或工作流运行。 | `outline` `genre_promise` `range` `parameters` `userHint` |
| `chapter.drafting` | 6 | 小说内容-P11-A-首章草稿 | 正文 · 正文 · 首章草稿。 使用现有模板或工作流运行。 | `brief` `core` `plan` `characters` `world` `style` `words` `userHint` |
| `chapter.continuity` | 6 | 小说内容-P12-A-章节记忆与结尾交接 | 连续性 · 连续性 · 章节记忆与结尾交接。 使用现有模板或工作流运行。 | `title` `text` `previous` `userHint` |
| `chapter.line-editing` | 0 | — | — | — |
| `review.developmental` | 5 | 小说内容-P13-A-全稿发展性诊断 | 宏观修订 · 宏观修订 · 全稿发展性诊断。 使用现有模板或工作流运行。 | `brief` `promise` `outline` `manuscript` `questions` `userHint` |
| `review.line-editing` | 6 | 小说内容-P14-A-场景级诊断与定向修订 | 语言修订 · 语言修订 · 场景级诊断与定向修订。 使用现有模板或工作流运行。 | `scene` `context` `goal` `allowed` `userHint` |
| `review.reader-validation` | 5 | 小说内容-P15-A-首章盲读轨迹 | 读者验证 · 读者验证 · 首章盲读轨迹。 使用现有模板或工作流运行。 | `reader` `chapter` `userHint` |
| `import.parse-character` | 1 | 内置-角色文档解析 | 从用户上传的角色设定文档中抽取结构化角色数据（JSON）。 | `rawDocument` |
| `import.parse-worldview` | 1 | 内置-世界观文档解析 | 从世界观设定文档中抽取结构化字段（JSON）。 | `rawDocument` |
| `import.parse-outline` | 1 | 内置-大纲文档解析 | 从大纲文档中抽取结构化卷/章节树（JSON 数组）。 | `rawDocument` |
| `import.parse-all` | 1 | 内置-智能统一解析 | 一次性从任意文档（设定文档或成品小说）中提取世界观 / 角色 / 大纲章节三类结构化数据。 | `rawDocument` |
| `import.parse-chunk` | 1 | 内置-分块解析（大文档流水线） | 针对百万字级小说，把原文切成多块后逐块抽取世界观 / 角色 / 大纲，可带已识别上下文。 | `chunkIndex` `totalChunks` `knownContext` `codexCategoryCatalog` `rawDocument` |
| `import.merge-characters` | 1 | 内置-角色跨块合并 | 检查分块导出的角色清单，判断哪些是同一人（别名 / 尊称 / 昵称）应合并。 | `characterList` |
| `relation.extract` | 1 | 内置-角色关系提取 | 从大纲摘要和章节正文中自动提取角色间的关系。 | `projectName` `characterList` `outlineSummary` `chapterContent` |
| `plot.character-driven` | 1 | 内置-角色驱动剧情 | 根据角色初始状态与目标状态，AI 生成中间情节推演（卷/章大纲结构）。 | `projectName` `genres` `worldContext` `storyCore` `existingOutline` `characterArcs` `userHint` `worldRulesContext` |
| `plot.character-revision` | 1 | 内置-角色变更影响分析 | 分析创作中途的角色变化，把已写区、过渡区和未写区分开，并输出可审查的大纲 patch。 | `revisionContext` |
| `inspiration.reverse` | 1 | 内置-灵感反推 | 用户写碎片想法，AI 反向生成世界观草稿、故事核心、初始角色卡。 | `projectName` `genres` `inspiration` `userHint` |
| `inspiration.reverse.multiworld` | 1 | 内置-多世界灵感反推 | 多世界题材：用户给出带有多个世界意图的灵感，AI 顺着思路反推故事主线 + 多个世界 + 角色。 | `projectName` `genres` `inspiration` `userHint` |
| `world-group.suggest` | 1 | 内置-AI建议世界 | 诸天流/无限流等多世界题材，根据故事概念和已有世界建议新的世界组。 | `projectName` `genres` `concept` `existingWorlds` `userHint` |
| `world-group.expand` | 1 | 内置-AI扩写世界 | 根据世界的草稿描述，扩展出完整的世界观设定。 | `worldName` `worldType` `draft` `otherWorlds` `storyCore` `userHint` |
| `inventory.extract` | 1 | 内置-物品栏提取 | 从章节正文提取各角色的物品获得/消耗事件，构建按角色归属的物品栏。 | `knownItemNames` `characterNames` `chapterTitle` `chapterText` |
| `codex.extract` | 1 | 内置-词条拆分提取 | 把整段世界观内容拆成当前分类下可确认写入的结构化词条。 | `categoryName` `fieldSchema` `existingEntries` `supplementTags` `sourceText` |
| `codex.enrich` | 1 | 内置-词条创意补全 | 根据已登记世界 Canon 为当前分类提出新词条建议。 | `baselineContext` `worldContext` `authorRequest` `supplementTags` |
| `location.extract` | 1 | 内置-重要地点提取 | 从已写正文中提取反复出现或推动剧情的重要地点候选。 | `existingEntries` `allowedTags` `sourceText` |
| `story-timeline.extract` | 1 | 内置-故事年表提取 | 从章节正文提取剧情大事，构建故事进程年表（区别于世界背景历史）。 | `chapterTitle` `chapterText` |
| `scene.verify` | 1 | 内置-场景考证 | 用户描述当前场景，AI 结合世界观/历史年表/世界规则给出符合背景的细节、时代错乱警示与情节灵感。 | `worldContext` `historyContext` `worldRulesContext` `scene` `sceneEra` `sceneLocation` |
| `history.consult` | 1 | 内置-历史考据 agent | 历史年表条目的考据 agent。挑剔但合作，绝不顺着作者的错误假设编造细节；尊重作者已声明的艺术改造/架空范围。 | `itemMeta` `finalText` `conceptNote` `consultPrompt` `worldContext` |
| `history.storm` | 1 | 内置-头脑风暴 agent | 历史年表条目的头脑风暴 agent。围绕作者已设定的方向发散可写素材，尊重作者声明的艺术改造范围。 | `itemMeta` `finalText` `conceptNote` `stormPrompt` `worldContext` |
| `style.learn` | 1 | 内置-文风学习 | 从用户已定稿/润色的章节中,总结出其个人写作文风画像,供后续章节生成参考。 | `sampleCount` `sampleWords` `samples` `revisionPairs` `calibrationFeedback` `userHint` |
| `style.calibrate` | 1 | 内置-文风互动校准 | 按现有文风画像和作者认可的改稿对照重写一段短文，供作者比较、反馈并沉淀新样本。 | `profile` `revisionPairs` `calibrationFeedback` `sourceText` |

## 二、上下文源清单（CONTEXT_SOURCES · AI 读什么）

共 82 个上下文源。assembleContext({ sourceKeys }) 按 key 装配。

| key | 标签 | 作用域 | 层级 | 预算(token) |
|---|---|---|---|---|
| `worldRelease` | 冻结世界版本资源 | manual | L0 | 100000 |
| `ttrpgRuntime` | 正式 TTRPG 主持人运行视角 | runtime | L0 | 10000 |
| `ttrpgPlayerRuntime` | 正式 TTRPG 单角色玩家运行视角 | runtime | L0 | 10000 |
| `game-production.consultation-source` | 游戏生产会谈来源 | project | L0 | 6000 |
| `game-production.brief` | 已授权游戏生产 Brief | project | L0 | 8000 |
| `game-production.artifact-inputs` | 游戏生产任务依赖 | project | L1 | 10000 |
| `game-production.quality-feedback` | 游戏生产质量反馈 | project | L1 | 6000 |
| `game-production.evolution-base` | 游戏持续演化基线 | project | L0 | 12000 |
| `adaptation.sourceManifest` | 改编来源清单 | project | L0 | 6000 |
| `adaptation.sourceContent` | 改编来源正文 | project | L0 | 24000 |
| `adaptation.currentBrief` | 已确认改编 Brief | project | L0 | 4000 |
| `adaptation.currentPlan` | 已确认改编计划 | project | L0 | 6000 |
| `screenplay.currentScenes` | 当前剧本场景 | project | L0 | 16000 |
| `comic.visualBible` | 漫画视觉圣经与视觉条目 | project | L0 | 12000 |
| `comic.currentPages` | 当前漫画页格 | project | L0 | 20000 |
| `adventureRuntime` | 文字冒险玩家视角 | runtime | L0 | 8000 |
| `narrativeSimulationRuntime` | 叙事模拟玩家视角 | runtime | L0 | 8000 |
| `openWorldRuntime` | 文字开放世界玩家视角 | runtime | L0 | 8000 |
| `interactionRuntime` | 角色互动单一视角 | runtime | L0 | 8000 |
| `simulationRuntime` | 冻结运行时状态 | runtime | L0 | 8000 |
| `projectStatus` | 项目概况 | project | L2 | 1200 |
| `worldGroups` | 世界组目录 | project | L2 | 1500 |
| `outlineTree` | 大纲树 | world | L2 | 6000 |
| `searchResults` | 项目内搜索结果 | world | L2 | 2200 |
| `ragSelection` | 作者选择的资料字段 | manual | L0 | 100000 |
| `manualText` | 用户指定内容 | manual | L0 | 100000 |
| `codexExtractionBaseline` | Codex 目标分类与既有词条闭集 | world | L0 | 8000 |
| `historyAgentBaseline` | 历史 Agent 正式输入基线 | world | L0 | 12000 |
| `referenceDerivedBaseline` | 参考分析派生 Agent 正式输入基线 | project | L0 | 36000 |
| `styleLearningBaseline` | 文风学习正式输入基线 | project | L0 | 28000 |
| `priorOutlineCandidate` | 同批次上一卷章纲候选 | runtime | L1 | 2400 |
| `chapterContent` | 章节正文 | chapter | L0 | 100000 |
| `cultivationProgressExtractionBaseline` | 修炼进度角色、体系 DAG 与既有事件闭集 | chapter | L0 | 30000 |
| `contextMemo` | 上下文快照 | project | L3 | 1500 |
| `chapterOutline` | 当前章节大纲 | node | L1 | 800 |
| `adjacentChapterOutlines` | 相邻章纲 | node | L1 | 1000 |
| `existingVolumeOutlines` | 已有卷大纲 | project | L1 | 2400 |
| `outlineSummaries` | 大纲标题与摘要（分析） | project | L2 | 6000 |
| `writtenChapters` | 已写章节正文（分析摘录） | project | L2 | 8000 |
| `writtenChapterProgress` | 本卷已写正文进度 | node | L1 | 3000 |
| `currentFacts` | 当前有效事实(事实账本投影) | chapter | L1 | 2000 |
| `canonAssertions` | 世界宪法(已确认设定断言) | world | L1 | 1800 |
| `constitutionScanSources` | 世界宪法扫描来源闭集 | project | L0 | 30000 |
| `characterKnowledge` | 角色认知边界(认知账本投影) | chapter | L1 | 1600 |
| `retrievedPassages` | 相关前文召回(NS-5 混合检索) | chapter | L2 | 2500 |
| `consistencyReport` | 一致性报告 | chapter | L1 | 1800 |
| `consistencyDossier` | 长期一致性档案 | chapter | L1 | 6000 |
| `detailedOutline` | 本章细纲(场景拆解) | node | L1 | 1500 |
| `previousChapterEnding` | 全局直接前驱原文尾部 | manual | L1 | 1800 |
| `chapterContinuityHandoff` | 全局直接前驱连续性交接 | chapter | L1 | 1600 |
| `previousPlanReconciliation` | 前章计划正文对账 | chapter | L1 | 1400 |
| `recentChapterSummaries` | 当前世界最近已验证摘要 | chapter | L1 | 2200 |
| `worldview` | 世界观 | world | L2 | 8000 |
| `geography` | 地理环境 | world | L2 | 3000 |
| `storyCore` | 故事核心 | project | L1 | 4000 |
| `activeNarrativeBlueprint` | 当前选定叙事蓝图 | project | L1 | 5000 |
| `characterDrivenPlan` | 角色驱动方案 | project | L1 | 5000 |
| `powerSystem` | 力量体系 | world | L2 | 4000 |
| `codex` | 设定词条 | world | L2 | 6000 |
| `characters` | 角色档案 | world | L2 | 8000 |
| `targetCharacter` | 本次目标角色完整设定 | world | L0 | 8000 |
| `creativeRules` | 创作规则 | project | L1 | 1000 |
| `worldRules` | 真实与幻想规则 | world | L1 | 1200 |
| `historical` | 历史时间线 | world | L2 | 1800 |
| `locations` | 重要地点 | project | L2 | 1200 |
| `foreshadows` | 伏笔状态 | chapter | L2 | 1200 |
| `foreshadowSuggestionBaseline` | 伏笔建议正式基线 | project | L0 | 8000 |
| `storyArcs` | 故事线 | project | L2 | 1500 |
| `storylineProgress` | 作者确认的故事线进度与交汇 | project | L1 | 1400 |
| `cultivationProgress` | 作者确认的正文修炼进度 | world | L1 | 1000 |
| `emotionBeats` | 情感节拍 | chapter | L1 | 1000 |
| `stateCards` | 状态卡 | project | L2 | 1800 |
| `itemLedger` | 物品流水 | project | L2 | 2400 |
| `heldItems` | 当前已持有物品 | chapter | L1 | 1000 |
| `storyTimeline` | 故事年表 | project | L2 | 2600 |
| `storyTimelineTarget` | 目标故事年表事件 | project | L1 | 600 |
| `characterRelations` | 角色关系 | project | L2 | 2200 |
| `references` | 引用手法 | project | L3 | 2000 |
| `userStyleProfile` | 我的文风 | project | L2 | 1800 |
| `inspirationWorkspace` | 增量灵感工作区 | project | L0 | 11000 |
| `characterFacts` | 该角色的剧情事实 | project | L1 | 1500 |
| `characterPassages` | 该角色的正文表现 | project | L1 | 2500 |

> 层级裁剪顺序:超预算时 L3 → L2 → L1 依次裁剪,L0 永不裁剪。

## 三、AI 可写字段（FIELD_REGISTRY · adopt 写什么）

AI 输出经 `adopt({ target, data })` 写回,只有这里登记的字段可写(别名自动归一)。

| 目标表 | 可写字段 |
|---|---|
| `adaptationProjects` | `brief` `plan` `visualBible` |
| `chapters` | `content` `continuityHandoff` `notes` `order` `outlineNodeId` `perspectiveCharacterId` `planReconciliation` `status` `summary` `summarySourceTextHash` `summaryTextNormalizationVersion` `title` `wordCount` |
| `characterDrivenPlans` | `generatedVolumes` `status` |
| `characterRelations` | `description` `fromCharacterId` `isBidirectional` `label` `relationType` `toCharacterId` |
| `characters` | `abilities` `activeChapterRange` `alignment` `appearance` `arc` `background` `cultivationStageId` `cultivationSystemId` `ending` `exitChapterId` `fears` `firstAppearChapterId` `firstAppearance` `goals` `habits` `homeWorldGroupId` `identity` `importantLocationId` `innerConflict` `isCrossWorld` `keyEvents` `location` `moralAxis` `motivation` `name` `narrativeStatus` `orderAxis` `personality` `powerLevel` `powerSystemId` `profile` `raceEntryId` `relationships` `role` `roleWeight` `shortDescription` `signatureItem` `speechStyle` `statusEvidenceChapterId` `statusEvidenceStoryArcId` `statusProducerCandidateHash` `statusProducerContractHash` `statusReason` `storyRole` `strengths` `values` `weaknesses` |
| `codexCategories` | `builtInKey` `domain` `fieldSchema` `hidden` `icon` `name` `order` `parentId` `worldGroupId` |
| `codexEntries` | `categoryId` `cultivationStageId` `cultivationSystemId` `description` `fields` `icon` `importance` `importantLocationId` `name` `order` `origin` `producerCandidateHash` `producerRunId` `refs` `sourceContentHash` `sourceEvidenceQuotes` `summary` `tags` `worldGroupId` |
| `comicPages` | `summary` |
| `comicPanels` | `action` `continuityRefs` `frame` `lettering` `negativePrompt` `shot` `sourceUnitIds` `visualPrompt` |
| `comicVisualSubjects` | `design` `label` `sourceUnitIds` |
| `creativeRules` | `atmosphere` `citedInsightIds` `citedReferenceIds` `consistencyRules` `narrativePOV` `prohibitions` `referenceWorksV2` `specialRequirements` `writingStyle` |
| `cultivationProgress` | `characterId` `characterName` `cultivationSystemId` `cultivationSystemName` `sourceChapterId` `sourceChapterTitle` `sourceOffset` `sourceQuote` `stageId` `stageName` `status` `transition` `trigger` `worldGroupId` |
| `cultivationSystems` | `description` `name` `stages` `worldGroupId` |
| `detailedOutlines` | `appearingCharacterIds` `emotionArc` `endingCliffhanger` `foreshadowIds` `lastUsedSummary` `openingHook` `outlineNodeId` `prohibitions` `sceneLocation` `scenes` |
| `emotionBeatCards` | `beats` `chapterId` `chapterTitle` `overallArc` `source` |
| `foreshadows` | `description` `echoChapterIds` `expectedResolveChapterId` `importance` `name` `notes` `plantChapterId` `resolveChapterId` `status` `timelinePosition` `type` `urgency` |
| `gameBuildArtifacts` | `metadataJson` `payloadJson` `qualityJson` `rightsJson` |
| `gameBuilds` | `compatibilityJson` `manifestJson` `planJson` `previewManifestJson` `qualityReportJson` |
| `gameProductionBriefs` | `briefJson` `userIntentSummary` |
| `gameRulePacks` | `contentHash` `rulePackJson` `ruleSystemId` `ruleSystemVersion` `status` `title` |
| `geographies` | `locations` `overview` `worldMapData` |
| `historicalKeywords` | `aiBrainstorm` `aiConsult` |
| `historicalTimelineEvents` | `aiBrainstorm` `aiConsult` |
| `histories` | `eraSystem` `events` `overview` |
| `importantLocations` | `description` `name` `parentId` `significance` `sortOrder` `tags` |
| `inspirationWorkspaces` | `fragments` `versions` |
| `itemLedger` | `action` `chapterId` `chapterTitle` `characterId` `heldByName` `itemName` `note` `quantity` |
| `knowledgeLedger` | `action` `belief` `characterId` `characterName` `factId` `knowledgeKey` `sourceChapterId` `sourceQuote` `sourceType` `statement` `status` `worldGroupId` |
| `outlineNodes` | `order` `parentId` `summary` `title` `type` `worldGroupId` |
| `powerSystems` | `description` `levels` `name` `rules` |
| `projects` | `creativeMode` `description` `enableMultiWorld` `genres` `name` `status` `targetWordCount` |
| `referenceAnalysisRuns` | `activatedAt` `analysisSummary` `completedAt` `completedChunks` `depth` `error` `expectedChunks` `fileHash` `mergedCharacters` `progress` `referenceId` `rightsConfirmed` `rightsDeclaredAt` `rightsNote` `sourceFilename` `sourceKind` `status` `totalChars` `usageScope` `version` |
| `referenceChunkAnalysis` | `analysisRunId` `characterCraft` `chunkIndex` `climaxDesign` `conflictEscalation` `dailyLife` `dialogueTechnique` `emotionalBeats` `endOffset` `foreshadowing` `historicalContext` `label` `languageCustoms` `materialCulture` `narrativeStyle` `openingTechnique` `otherTechniques` `pacingControl` `plotStructure` `proseStyle` `rawExcerpt` `referenceId` `socialInstitutions` `startOffset` `worldBuilding` |
| `references` | `analysisDepth` `analysisError` `analysisProgress` `analysisStatus` `analysisSummary` `fileHash` `genre` `importSessionId` `mergedCharacters` `totalChars` |
| `screenplayScenes` | `blocks` `estimatedSeconds` `intExt` `location` `planSectionKey` `sourceUnitIds` `summary` `timeOfDay` |
| `stateCards` | `category` `entityName` `fields` `lastChapterId` |
| `storyArcs` | `description` `lastAlignedHash` `name` `origin` `producerCandidateHash` `producerRunId` `sourceStoryCoreHash` `sourceStoryCoreId` `sourceStoryCoreRevision` `stages` `status` `type` |
| `storyTimelineEvents` | `chapterId` `chapterTitle` `description` `importance` `order` `storyTime` `title` |
| `storylineCrossings` | `arcIdA` `arcIdB` `chapterId` `chapterTitle` `evidenceQuote` `note` |
| `storylineProgress` | `arcId` `currentStageId` `evidenceQuote` `involvedEntities` `lastActiveChapterId` `lastActiveChapterTitle` `progressNote` `status` |
| `userStyleProfiles` | `enabled` `profile` `sampleCount` `sampleWords` `sourceChapterIds` |
| `works` | `description` `genres` `methodologyId` `status` `targetWordCount` `title` `writingStyleId` |
| `worldGroups` | `description` `entryCondition` `exitCondition` `icon` `name` `order` `plannedChapterCount` `powerRestriction` `takeawayRules` `type` |
| `worldNodes` | `mapConfigJSON` |
| `worldRulesProfiles` | `customNodes` `entries` `globalNote` |
| `worlds` | `description` `name` |
| `worldviews` | `culture` `economy` `geography` `history` `historyLine` `politicsEconomyCulture` `rules` `society` `worldEvents` |

### 领域写回扩展（不是第二套通用 adopt）

| ID | 目标表 | 领域策略注册表 | 唯一入口 | 复审日期 |
|---|---|---|---|---|
| `reference-analysis-run-lifecycle` | `referenceAnalysisRuns` | `REFERENCE_ANALYSIS_RUN_POLICY + ADOPTION_SCHEMAS + PROJECT_TABLES` | `src/lib/reference-analysis/lifecycle.ts`<br/>`src/lib/reference-analysis/legacy-bridge.ts` | 2027-01-01 |
| `reference-analysis-source-lifecycle` | `referenceAnalysisSources` | `REFERENCE_ANALYSIS_RUN_POLICY + PROJECT_TABLES` | `src/lib/reference-analysis/lifecycle.ts` | 2027-01-01 |
| `reference-analysis-chunk-lifecycle` | `referenceChunkAnalysis` | `REFERENCE_ANALYSIS_RUN_POLICY + ADOPTION_SCHEMAS + PROJECT_TABLES` | `src/lib/reference-analysis/lifecycle.ts`<br/>`src/lib/reference-analysis/legacy-bridge.ts` | 2027-01-01 |
| `reference-analysis-reference-lifecycle` | `references` | `REFERENCE_ANALYSIS_RUN_POLICY + PROJECT_TABLES refs` | `src/lib/reference-analysis/lifecycle.ts` | 2027-01-01 |
| `reference-analysis-citation-lifecycle` | `creativeRules` | `PROJECT_TABLES references refs` | `src/lib/reference-analysis/lifecycle.ts` | 2027-01-01 |
| `fact-ledger` | `temporalFacts` | `FACT_PREDICATE_REGISTRY` | `src/lib/fact-ledger/fact-ledger.ts`<br/>`src/lib/fact-ledger/human-readable-io.ts`<br/>`src/lib/fact-ledger/lifecycle.ts`<br/>`src/lib/fact-ledger/setting-assertions.ts`<br/>`src/lib/consistency/impact-analysis.ts`<br/>`src/lib/cultivation/lifecycle.ts`<br/>`src/lib/editor/entity-rename.ts` | 2027-01-01 |
| `character-merge-lifecycle` | `characters` | `PROJECT_TABLES refs + remapCharacterReferences + cultivation DAG validator` | `src/lib/import/character-merge.ts`<br/>`src/lib/codex/references.ts`<br/>`src/lib/cultivation/lifecycle.ts`<br/>`src/lib/cultivation/progress-lifecycle.ts` | 2027-01-01 |
| `knowledge-ledger` | `knowledgeLedger` | `KNOWLEDGE_ACTIONS + ADOPTION_SCHEMAS + PROJECT_TABLES` | `src/lib/knowledge-ledger/knowledge-ledger.ts`<br/>`src/lib/knowledge-ledger/lifecycle.ts` | 2027-01-01 |
| `storyline-progress-lifecycle` | `storylineProgress` | `ADOPTION_SCHEMAS + PROJECT_TABLES refs` | `src/lib/storyline/lifecycle.ts` | 2027-01-01 |
| `storyline-crossing-lifecycle` | `storylineCrossings` | `ADOPTION_SCHEMAS + PROJECT_TABLES refs` | `src/lib/storyline/lifecycle.ts` | 2027-01-01 |
| `story-arc-dynamic-lifecycle` | `storyArcs` | `PROJECT_TABLES refs` | `src/lib/storyline/lifecycle.ts` | 2027-01-01 |
| `cultivation-codex-reference-lifecycle` | `codexEntries` | `PROJECT_TABLES refs + cultivation DAG validator` | `src/lib/codex/references.ts`<br/>`src/lib/cultivation/lifecycle.ts`<br/>`src/lib/location/lifecycle.ts` | 2027-01-01 |
| `cultivation-progress-lifecycle` | `cultivationProgress` | `ADOPTION_SCHEMAS + PROJECT_TABLES + cultivation DAG validator + canonical chapter sequence` | `src/lib/cultivation/progress.ts`<br/>`src/lib/cultivation/progress-lifecycle.ts` | 2027-01-01 |
| `codex-category-scope-lifecycle` | `codexCategories` | `PROJECT_TABLES lifecycle` | `src/lib/registry/lifecycle.ts` | 2027-01-01 |
| `workspace-root-lifecycle` | `projects` | `PROJECT_TABLES + workspace identity + import trust + world lifecycle` | `src/lib/export/registry-import.ts`<br/>`src/lib/memory/workspace-projection.ts`<br/>`src/lib/product/world-package.ts`<br/>`src/lib/world-engine/lifecycle.ts`<br/>`src/lib/world-engine/ownership.ts`<br/>`src/lib/world-engine/releases.ts`<br/>`src/lib/world-engine/works.ts`<br/>`src/lib/world-engine/create-workspace.ts`<br/>`src/lib/world-engine/derivation.ts`<br/>`src/lib/world-engine/identity-classification.ts`<br/>`src/lib/adaptation/source-manifest.ts` | 2027-08-01 |
| `world-root-lifecycle` | `worlds` | `PROJECT_TABLES refs + world package trust + world release lifecycle` | `src/lib/product/world-package.ts`<br/>`src/lib/world-engine/lifecycle.ts`<br/>`src/lib/world-engine/ownership.ts`<br/>`src/lib/world-engine/releases.ts`<br/>`src/lib/world-engine/create-workspace.ts`<br/>`src/lib/world-engine/derivation.ts`<br/>`src/lib/world-engine/identity-classification.ts` | 2027-08-01 |
| `work-root-lifecycle` | `works` | `PROJECT_TABLES refs + WorkspaceScope + stable work code + narrative lifecycle` | `src/lib/memory/workspace-projection.ts`<br/>`src/lib/world-engine/lifecycle.ts`<br/>`src/lib/world-engine/ownership.ts`<br/>`src/lib/world-engine/works.ts`<br/>`src/lib/world-engine/create-workspace.ts`<br/>`src/lib/world-engine/derivation.ts`<br/>`src/lib/adaptation/source-manifest.ts`<br/>`src/lib/adaptation/completion.ts` | 2027-08-01 |
| `adaptation-root-lifecycle` | `adaptationProjects` | `PROJECT_TABLES + ADOPTION_SCHEMAS + adaptation state machine + source manifest CAS` | `src/lib/adaptation/source-manifest.ts`<br/>`src/lib/adaptation/completion.ts` | 2027-08-01 |
| `adaptation-source-manifest-lifecycle` | `adaptationSourceUnits` | `PROJECT_TABLES + immutable source manifest policy + canonical chapter sequence` | `src/lib/adaptation/source-manifest.ts` | 2027-08-01 |
| `screenplay-scene-lifecycle` | `screenplayScenes` | `PROJECT_TABLES + FIELD_REGISTRY + ADOPTION_SCHEMAS + screenplay block validator + adaptation freshness CAS` | `src/lib/screenplay/service.ts`<br/>`src/lib/screenplay/adoption.ts` | 2027-08-01 |
| `comic-page-panel-lifecycle` | `comicPages` | `PROJECT_TABLES + FIELD_REGISTRY + ADOPTION_SCHEMAS + comic geometry/lettering validator + adaptation freshness CAS` | `src/lib/comic/service.ts`<br/>`src/lib/comic/adoption.ts` | 2027-08-01 |
| `comic-panel-lifecycle` | `comicPanels` | `PROJECT_TABLES + FIELD_REGISTRY + ADOPTION_SCHEMAS + comic panel validator` | `src/lib/comic/service.ts`<br/>`src/lib/comic/adoption.ts`<br/>`src/lib/comic/media-service.ts` | 2027-08-01 |
| `comic-visual-subject-lifecycle` | `comicVisualSubjects` | `PROJECT_TABLES + FIELD_REGISTRY + ADOPTION_SCHEMAS + Work cast/source/asset stable-key validator` | `src/lib/comic/service.ts`<br/>`src/lib/comic/media-service.ts` | 2027-08-01 |
| `comic-media-asset-lifecycle` | `comicMediaAssets` | `PROJECT_TABLES + media capability registry + hash/rights/provider receipt + stable-key reference checks` | `src/lib/comic/media-service.ts`<br/>`src/lib/comic/service.ts` | 2027-08-01 |
| `media-blob-object-lifecycle` | `mediaBlobObjects` | `PROJECT_TABLES portable binary + GAME_PRODUCTION_MEDIA_OBJECT_POLICY + SHA-256/MIME/dimension checks + lease/reference-aware GC` | `src/lib/media/blob-store.ts`<br/>`src/lib/comic/media-service.ts`<br/>`src/lib/game-production/media-blob-store.ts`<br/>`src/lib/game-production/artifact-store.ts` | 2027-08-21 |
| `short-novel-outline-skeleton-lifecycle` | `outlineNodes` | `PROJECT_TABLES tree refs + WorkspaceScope + SHORT_NOVEL_WORKFLOW_OVERRIDES` | `src/lib/world-engine/create-workspace.ts` | 2027-08-01 |
| `chapter-delete-lifecycle` | `chapters` | `PROJECT_TABLES refs + WorkspaceScope + chapter deletion impact policy + short skeleton policy` | `src/lib/chapters/lifecycle.ts`<br/>`src/lib/world-engine/create-workspace.ts` | 2027-08-01 |
| `chapter-emotion-delete-lifecycle` | `emotionBeatCards` | `PROJECT_TABLES chapter refs` | `src/lib/chapters/lifecycle.ts` | 2027-08-01 |
| `game-production-roots` | `gameProductions` | `GAME_PRODUCTION_COMMAND_POLICY + GAME_PRODUCTION_ARTIFACT_POLICY + PROJECT_TABLES` | `src/lib/game-production/commands.ts`<br/>`src/lib/game-production/artifact-store.ts`<br/>`src/lib/game-production/media-blob-store.ts`<br/>`src/lib/game-production/vertical-slice.ts`<br/>`src/lib/game-production/adoption.ts`<br/>`src/lib/game-production/scheduler.ts` | 2027-08-21 |
| `game-production-briefs` | `gameProductionBriefs` | `GAME_PRODUCTION_COMMAND_POLICY + PROJECT_TABLES` | `src/lib/game-production/commands.ts`<br/>`src/lib/game-production/adoption.ts` | 2027-08-21 |
| `game-production-commands` | `gameProductionCommands` | `GAME_PRODUCTION_COMMAND_POLICY + PROJECT_TABLES` | `src/lib/game-production/commands.ts`<br/>`src/lib/game-production/adoption.ts` | 2027-08-21 |
| `game-production-builds` | `gameBuilds` | `GAME_PRODUCTION_COMMAND_POLICY + GAME_PRODUCTION_ARTIFACT_POLICY + GAME_QUALITY_GATE_RECEIPT_V1 + PROJECT_TABLES` | `src/lib/game-production/commands.ts`<br/>`src/lib/game-production/artifact-store.ts`<br/>`src/lib/game-production/vertical-slice.ts`<br/>`src/lib/game-production/adoption.ts`<br/>`src/lib/game-production/scheduler.ts`<br/>`src/lib/game-production/quality-receipts.ts` | 2027-08-21 |
| `game-production-artifacts` | `gameBuildArtifacts` | `GAME_PRODUCTION_ARTIFACT_POLICY + PROJECT_TABLES` | `src/lib/game-production/commands.ts`<br/>`src/lib/game-production/artifact-store.ts`<br/>`src/lib/game-production/adoption.ts`<br/>`src/lib/game-production/scheduler.ts` | 2027-08-21 |
| `game-production-release-adoption` | `gameReleases` | `GAME_PRODUCTION_PACKAGE_ADOPTION_V1 + GAME_DISTRIBUTION_BUNDLE_V1 + PROJECT_TABLES + product validators` | `src/lib/text-game/releases.ts`<br/>`src/lib/game-production/adoption.ts`<br/>`src/lib/game-platform/distribution-bundle.ts` | 2027-08-21 |
| `ttrpg-rule-pack-library` | `gameRulePacks` | `RULE_PACK_V1 parser + fixture verifier + immutable version identity + PROJECT_TABLES` | `src/lib/ttrpg/rule-pack-library.ts` | 2027-08-21 |

## 四、AI 调用点（消耗统计 category · 在哪触发)

共 41 个 category。
未分类调用: 0 个。动态 category 调用: 35 个。

| category | 触发文件 |
|---|---|
| `agent.orchestrator` | `src/lib/agent/orchestrator.ts:753` |
| `agent.orchestrator.replan` | `src/lib/agent/orchestrator.ts:840` |
| `agent.readonly` | `src/lib/agent/client-adapter.ts:118` |
| `authoring.ttrpg-campaign` | `src/lib/ttrpg/campaign-proposal-harness.ts:349` |
| `canon.setting.extract` | `src/lib/agent/run/constitution-extraction-durable.ts:508` |
| `chapter.content` | `src/lib/generation/chapter-generation-node.ts:23` |
| `chapter.continue` | `src/lib/generation/chapter-generation-node.ts:26` |
| `chapter.continuity` | `src/lib/node-authoring/domain-execution.ts:797`<br/>`src/lib/node-authoring/domain-execution.ts:861` |
| `chapter.deai` | `src/components/editor/ChapterEditor.tsx:1681` |
| `chapter.expand` | `src/components/editor/ChapterEditor.tsx:1659` |
| `chapter.polish` | `src/components/editor/ChapterEditor.tsx:1649` |
| `chapter.toolbar` | `src/lib/agent/run/selection-edit-durable.ts:567` |
| `cultivation.progress` | `src/lib/agent/run/cultivation-progress-extraction-durable.ts:558` |
| `detail.chapter-planning` | `src/lib/node-authoring/domain-execution.ts:616` |
| `emotion.beat` | `src/lib/agent/run/emotion-beat-durable.ts:396` |
| `foreshadow.suggest` | `src/lib/agent/run/foreshadow-suggestions-durable.ts:569` |
| `geography.concept-map` | `src/components/geography/GeographyPanel.tsx:127` |
| `geography.world-map` | `src/lib/agent/run/world-map-config-durable.ts:362` |
| `inventory.extract` | `src/lib/agent/run/inventory-extraction-durable.ts:943` |
| `location.extract` | `src/lib/agent/run/location-extraction-durable.ts:618` |
| `node.creation` | `src/lib/node-authoring/executor.ts:363` |
| `outline.chapter` | `src/lib/ai/batch-outline-runner.ts:198`<br/>`src/lib/outline/generation-node.ts:60` |
| `outline.impact-regenerate` | `src/lib/agent/run/impact-outline-regeneration-durable.ts:652` |
| `outline.volume` | `src/lib/outline/generation-node.ts:55` |
| `outline.workshop.collision` | `src/lib/outline/workshop.ts:452` |
| `outline.workshop.motivation` | `src/lib/outline/workshop.ts:447` |
| `outline.workshop.scan` | `src/lib/outline/workshop.ts:442` |
| `outline.workshop.scenes` | `src/lib/outline/workshop.ts:461` |
| `prompt.examples` | `src/components/settings/prompt/PromptExamplesEditor.tsx:108` |
| `relation.extract` | `src/lib/agent/run/character-relationship-durable.ts:286` |
| `review.anti-ai` | `src/components/editor/ReviewPanel.tsx:122` |
| `review.outline-workshop` | `src/lib/outline/workshop.ts:457` |
| `review.quality` | `src/components/editor/ReviewPanel.tsx:112` |
| `review.readability` | `src/components/editor/ReviewPanel.tsx:133` |
| `review.revise` | `src/components/editor/ChapterEditor.tsx:1709` |
| `runtime.ttrpg-player` | `src/lib/ttrpg/player-harness.ts:298` |
| `scene.verify` | `src/components/scene/SceneVerifyPanel.tsx:81` |
| `story.timeline` | `src/lib/agent/run/impact-story-timeline-regeneration-durable.ts:670`<br/>`src/lib/agent/run/story-timeline-extraction-durable.ts:758` |
| `style.learn` | `src/lib/agent/run/style-learning-durable.ts:493` |
| `world-group.expand` | `src/lib/agent/run/worldview-expand-durable.ts:476` |
| `world-group.suggest` | `src/lib/agent/run/world-suggest-durable.ts:614` |

### 动态 category 调用

- `src/components/editor/ReviewPanel.tsx:160 · ai.start`
- `src/lib/adventure/harness.ts:245 · chat`
- `src/lib/agent/character-copilot.ts:514 · chat`
- `src/lib/agent/character-driven-copilot.ts:504 · chat`
- `src/lib/agent/character-lifecycle-copilot.ts:449 · chat`
- `src/lib/agent/character-revision-copilot.ts:728 · chat`
- `src/lib/agent/character-supplement-copilot.ts:582 · chat`
- `src/lib/agent/context-compression.ts:333 · chat`
- `src/lib/agent/creative-rules-copilot.ts:439 · chat`
- `src/lib/agent/inspiration-copilot.ts:341 · chat`
- `src/lib/agent/master-candidate-semantic-review.ts:601 · chat`
- `src/lib/agent/outline-copilot.ts:494 · chat`
- `src/lib/agent/outline-copilot.ts:744 · chat`
- `src/lib/agent/prose-copilot.ts:652 · chat`
- `src/lib/agent/prose-copilot.ts:918 · chat`
- `src/lib/agent/run/adaptation-durable.ts:411 · chat`
- `src/lib/agent/run/codex-extraction-durable.ts:779 · chat`
- `src/lib/agent/run/history-agent-durable.ts:514 · chat`
- `src/lib/agent/run/reference-derived-durable.ts:506 · chat`
- `src/lib/agent/story-arc-copilot.ts:1584 · chat`
- `src/lib/agent/story-arc-copilot.ts:1636 · chat`
- `src/lib/agent/story-core-copilot.ts:556 · chat`
- `src/lib/agent/storyline-progress-copilot.ts:375 · chat`
- `src/lib/agent/world-origin-copilot.ts:255 · chat`
- `src/lib/agent/worldview-field-copilot.ts:889 · chat`
- `src/lib/character-interaction/harness.ts:396 · chat`
- `src/lib/evals/agent-harness/story-arc-main-path-browser.ts:99 · chat`
- `src/lib/evals/creative-reliability/browser.ts:88 · chat`
- `src/lib/game-production/capabilities.ts:158 · chat`
- `src/lib/generation/workflow-generation-node.ts:23 · ai.start`
- `src/lib/narrative-simulation/harness.ts:246 · chat`
- `src/lib/node-authoring/executor.ts:421 · chat`
- `src/lib/open-world/harness.ts:139 · chat`
- `src/lib/ttrpg/gm-actor-harness.ts:468 · chat`
- `src/lib/ttrpg/gm-harness.ts:545 · chat`

## 五、正式 AI 入口（FormalAIEntryBindingV1）

共 39 个操作级绑定。运行时按 entryId 校验 category 和 Skill；采纳权限不由文字说明决定。

| entryId | Skill | category | 边界 | 候选 | 采纳目标 | 调用方 |
|---|---|---|---|---|---|---|
| `prose.chapter.generate` | `prose.generate` | `chapter.content` | formal / durable-run | `chapter-draft` | `chapters` | `src/lib/generation/chapter-generation-node.ts` |
| `prose.chapter.continue` | `prose.continue` | `chapter.continue` | formal / durable-run | `chapter-continuation-draft` | `chapters` | `src/lib/generation/chapter-generation-node.ts` |
| `prose.selection.polish` | `prose.selection-edit` | `chapter.polish` | auxiliary / authoring-draft | `selection-polish-preview` | 禁止 | `src/components/editor/ChapterEditor.tsx` |
| `prose.selection.expand` | `prose.selection-edit` | `chapter.expand` | auxiliary / authoring-draft | `selection-expand-preview` | 禁止 | `src/components/editor/ChapterEditor.tsx` |
| `prose.selection.deai` | `prose.selection-edit` | `chapter.deai` | auxiliary / authoring-draft | `selection-rewrite-preview` | 禁止 | `src/components/editor/ChapterEditor.tsx` |
| `prose.chapter.revise` | `prose.revise` | `review.revise` | auxiliary / authoring-draft | `chapter-revision-preview` | 禁止 | `src/components/editor/ChapterEditor.tsx` |
| `prose.chapter.memory` | `prose.memory` | `chapter.memory` | formal / durable-run | `chapter-memory-candidate` | `chapters` | `src/components/editor/ChapterEditor.tsx` |
| `prose.chapter.organize` | `prose.organize` | `chapter.organize` | formal / durable-run | `chapter-organization-candidate` | `stateCards`<br/>`temporalFacts`<br/>`itemLedger`<br/>`storyTimelineEvents`<br/>`characterRelations`<br/>`foreshadows`<br/>`storylineProgress`<br/>`storylineCrossings`<br/>`storyArcs` | `src/components/editor/ChapterEditor.tsx` |
| `prose.review.quality` | `prose.review` | `review.quality` | auxiliary / read-only | `quality-review-report` | 禁止 | `src/components/editor/ReviewPanel.tsx` |
| `prose.review.anti-ai` | `prose.review` | `review.anti-ai` | auxiliary / read-only | `anti-ai-review-report` | 禁止 | `src/components/editor/ReviewPanel.tsx` |
| `prose.review.readability` | `prose.review` | `review.readability` | auxiliary / read-only | `readability-review-report` | 禁止 | `src/components/editor/ReviewPanel.tsx` |
| `prose.review.consistency` | `prose.review` | `review.consistency.fast`<br/>`review.consistency.deep` | auxiliary / durable-run | `consistency-audit-report` | 禁止 | `src/components/editor/ReviewPanel.tsx` |
| `world.map.concept` | `world-origin.map-config` | `geography.concept-map` | auxiliary / authoring-draft | `concept-map-svg` | 禁止 | `src/components/geography/GeographyPanel.tsx` |
| `world.setting.lookup.qa` | `world-origin.review` | `setting-qa` | auxiliary / read-only | `setting-qa-answer` | 禁止 | `src/components/editor/SettingLookupPanel.tsx` |
| `world.setting.lookup.extract` | `world-origin.codex-extract` | `setting-extract` | formal / authoring-draft | `setting-extraction-candidate` | `codexEntries` | `src/components/editor/SettingLookupPanel.tsx` |
| `outline.workshop.scan` | `outline.chapters` | `outline.workshop.scan` | formal / generation-node | `outline-workshop-scan` | 禁止 | `src/lib/outline/workshop.ts` |
| `outline.workshop.motivation` | `outline.chapters` | `outline.workshop.motivation` | formal / generation-node | `outline-workshop-motivation` | 禁止 | `src/lib/outline/workshop.ts` |
| `outline.workshop.collision` | `outline.chapters` | `outline.workshop.collision` | formal / generation-node | `outline-workshop-collision` | 禁止 | `src/lib/outline/workshop.ts` |
| `outline.workshop.quality` | `prose.review` | `review.outline-workshop` | auxiliary / read-only | `outline-workshop-quality-report` | 禁止 | `src/lib/outline/workshop.ts` |
| `outline.workshop.scenes` | `outline.chapters` | `outline.workshop.scenes` | formal / generation-node | `outline-workshop-scenes` | `outlineNodes` | `src/lib/outline/workshop.ts` |
| `outline.volume.generate` | `outline.volumes` | `outline.volume` | formal / durable-run | `volume-outline-candidate` | `outlineNodes` | `src/lib/outline/generation-node.ts` |
| `outline.chapter.generate` | `outline.chapters` | `outline.chapter` | formal / durable-run | `chapter-outline-candidate` | `outlineNodes` | `src/lib/outline/generation-node.ts` |
| `outline.chapter.review` | `outline.chapters` | `outline.review` | auxiliary / read-only | `outline-review-report` | 禁止 | `src/lib/outline/chapter-reviewer.ts` |
| `outline.chapter.rewrite` | `outline.chapters` | `outline.rewrite` | formal / authoring-draft | `outline-rewrite-candidate` | `outlineNodes` | `src/lib/outline/chapter-reviewer.ts` |
| `outline.chunked.generate` | `outline.chapters` | `outline.chunked-direction`<br/>`outline.chunked-chapters` | formal / authoring-draft | `chunked-outline-candidate` | `outlineNodes` | `src/lib/outline/chunked-generator.ts` |
| `outline.detail.scene` | `outline.details` | `detail.scene` | formal / durable-run | `detailed-outline-candidate` | `detailedOutlines` | `src/components/outline/useDetailedOutlineGenerationController.ts` |
| `outline.detail.enhance` | `outline.details` | `detail.enhance` | formal / durable-run | `detailed-outline-enhancement` | `detailedOutlines` | `src/components/outline/useDetailedOutlineGenerationController.ts` |
| `outline.detail.batch` | `outline.details` | `detail.enhance` | formal / durable-run | `detailed-outline-batch-candidate` | `detailedOutlines` | `src/lib/ai/batch-detail-runner.ts` |
| `world.scene.verify` | `world-origin.review` | `scene.verify` | auxiliary / read-only | `scene-verification-report` | 禁止 | `src/components/scene/SceneVerifyPanel.tsx` |
| `eval.context-compression` | `prose.review` | `eval.h17.compression`<br/>`eval.h17.generation` | evaluation / eval-only | `context-compression-eval-artifact` | 禁止 | `src/components/settings/HarnessEvalPanel.tsx` |
| `eval.long-consistency.verifier` | `prose.review` | `eval.h4.verifier` | evaluation / eval-only | `long-consistency-verdict` | 禁止 | `src/components/settings/HarnessEvalPanel.tsx` |
| `eval.long-consistency.adjudicator` | `prose.review` | `eval.h4.verifier` | evaluation / eval-only | `consistency-subtype-adjudication` | 禁止 | `src/components/settings/HarnessEvalPanel.tsx` |
| `eval.races-gateway.grader` | `prose.review` | `eval.race6.blind-grader` | evaluation / eval-only | `races-gateway-blind-grade` | 禁止 | `src/components/settings/RacesGatewayEvalPanel.tsx` |
| `prompt.examples.generate` | `inspiration.review` | `prompt.examples` | auxiliary / authoring-draft | `prompt-example-draft` | 禁止 | `src/components/settings/prompt/PromptExamplesEditor.tsx` |
| `prompt.workflow.step` | `inspiration.review` | `*` | experimental / experimental | `prompt-workflow-step-draft` | 禁止 | `src/lib/generation/workflow-generation-node.ts` |
| `simulation.npc.evolution` | `character.interaction-memory-curator` | `simulation.npc-evolution` | formal / simulation-runtime | `npc-evolution-candidate` | 禁止 | `src/components/simulation/SimulationRuntimePanel.tsx` |
| `simulation.ttrpg.gm` | `prose.interaction-scene-director` | `simulation.ttrpg-gm` | formal / simulation-runtime | `ttrpg-turn-candidate` | 禁止 | `src/components/simulation/SimulationRuntimePanel.tsx` |
| `simulation.ttrpg.encounter` | `prose.interaction-scene-director` | `simulation.ttrpg-encounter` | formal / simulation-runtime | `ttrpg-encounter-candidate` | 禁止 | `src/components/simulation/SimulationRuntimePanel.tsx` |
| `style.calibration.preview` | `prose.style-learn` | `style.calibrate` | auxiliary / authoring-draft | `style-calibration-preview` | 禁止 | `src/components/style/StyleCalibrationPanel.tsx` |

---

生成时间基准:commit `6b982863`
