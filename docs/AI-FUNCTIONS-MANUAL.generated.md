# AI 行为说明书（自动生成 · 请勿手动编辑）

> 由 `scripts/generate-ai-manual.mjs` 从代码扫描生成。
> 修改 AI 行为后请运行 `npm run gen:ai-manual` 重新生成。CI 用 `npm run check:ai-manual` 校验一致性。
> 语义注解(每个动作的业务意图/坑)写在 `AI-FUNCTIONS-MANUAL.semantic.md`(手工维护)。

---

## 一、Prompt 模板清单（PromptModuleKey 事实源）

共 40 个 moduleKey。

| moduleKey | 名称 | 说明 | 读取变量 |
|---|---|---|---|
| `worldview.dimension` | 内置-世界观维度生成 | 为世界观的单个维度（地理/历史/社会/文化/经济/规则/摘要）生成内容。 | `projectName` `genres` `dimension` `worldContext` `worldRulesContext` `userHint` `isSummary` |
| `character.generate` | 内置-角色完整设计 | 基于世界观和已有角色，设计一个新角色的完整资料。 | `projectName` `genres` `worldContext` `existingCharacters` `userHint` |
| `character.dimension` | 内置-角色维度补全 | 为指定角色的某个维度（背景/性格/能力等）补充约 200-400 字的细节。 | `characterName` `characterInfo` `worldContext` `dimension` |
| `outline.volume` | 内置-卷级大纲生成 | 基于世界观与故事核心生成全书的卷级大纲。 | `projectName` `genres` `targetWordCount` `worldContext` `storyCore` `characterContext` `worldRulesContext` `existingVolumesContext` `userHint` |
| `outline.chapter` | 内置-章节大纲展开 | 将单卷展开为 15-25 章的章节大纲。 | `volumeTitle` `volumeSummary` `worldContext` `prevVolumeSummary` `characterContext` `worldRulesContext` `userHint` |
| `chapter.content` | 内置-长篇连载（默认） | 通用男频网文风格的章节正文生成，支持基调/节奏/字数三个可调参数。 | `chapterTitle` `chapterSummary` `worldContext` `characters` `previousChapterEnding` `worldRulesContext` `userHint` |
| `chapter.continue` | 内置-章节续写 | 从已有正文末尾继续往下写约 1000-2000 字。 | `chapterSummary` `worldContext` `existingContent` `userHint` |
| `chapter.memory` | 内置-章节连续性记忆 | 一次调用同时提取章节摘要、下一章承接 handoff 与计划正文对账；引文 offset 由系统回查，不信任模型位置。 | `chapterTitle` `chapterPlan` `nextChapterPlan` `chapterText` |
| `chapter.polish` | 内置-文本润色 | 按用户指令润色文本，保持原意不变。 | `instruction` `text` |
| `chapter.expand` | 内置-文本扩写 | 将文本扩展丰富，增加细节、心理与环境，情节走向不变。 | `userHint` `text` |
| `chapter.de-ai` | 内置-去 AI 味改写 | 把 AI 味重的文本改写得更像真人写的。 | `text` |
| `foreshadow.generate` | 内置-伏笔建议 | 基于世界观、角色和已有伏笔，建议 3-5 个新伏笔。 | `projectName` `genres` `worldContext` `characters` `existingForeshadows` `hasNoForeshadows` |
| `geography.concept-map` | 内置-概念地图 SVG | 基于地点列表生成奇幻风格的 SVG 概念地图。 | `overview` `locationList` |
| `geography.image-map-prompt` | 内置-地图图像 Prompt | 生成 Midjourney/DALL-E/SD 的世界地图绘图 prompt。 | `imageStyle` `projectName` `locationNames` `locationTypes` |
| `worldview.generate` | — | — | — |
| `story.generate` | 内置-故事核心生成 | 基于已有世界观和用户提示，生成故事的某个维度（一句话/概念/主题/核心冲突等）。 | `projectName` `genres` `dimension` `worldContext` `userHint` |
| `rules.generate` | 内置-创作规则生成 | 基于项目类型和世界观，建议适配的创作规则（风格/视角/基调/禁忌等）。 | `projectName` `genres` `dimension` `worldContext` `storyCore` `userHint` |
| `detail.scene` | 内置-细纲场景生成 | 把单章大纲展开为若干场景（每个场景含人物 / 地点 / 冲突 / 节奏）。 | `chapterTitle` `chapterSummary` `worldContext` `characters` `previousChapterEnding` `userHint` |
| `import.parse-character` | 内置-角色文档解析 | 从用户上传的角色设定文档中抽取结构化角色数据（JSON）。 | `rawDocument` |
| `import.parse-worldview` | 内置-世界观文档解析 | 从世界观设定文档中抽取结构化字段（JSON）。 | `rawDocument` |
| `import.parse-outline` | 内置-大纲文档解析 | 从大纲文档中抽取结构化卷/章节树（JSON 数组）。 | `rawDocument` |
| `import.parse-all` | 内置-智能统一解析 | 一次性从任意文档（设定文档或成品小说）中提取世界观 / 角色 / 大纲章节三类结构化数据。 | `rawDocument` |
| `import.parse-chunk` | 内置-分块解析（大文档流水线） | 针对百万字级小说，把原文切成多块后逐块抽取世界观 / 角色 / 大纲，可带已识别上下文。 | `chunkIndex` `totalChunks` `knownContext` `rawDocument` |
| `import.merge-characters` | 内置-角色跨块合并 | 检查分块导出的角色清单，判断哪些是同一人（别名 / 尊称 / 昵称）应合并。 | `characterList` |
| `relation.extract` | 内置-角色关系提取 | 从大纲摘要和章节正文中自动提取角色间的关系。 | `projectName` `characterList` `outlineSummary` `chapterContent` |
| `plot.character-driven` | 内置-角色驱动剧情 | 根据角色初始状态与目标状态，AI 生成中间情节推演（卷/章大纲结构）。 | `projectName` `genres` `worldContext` `storyCore` `existingOutline` `characterArcs` `userHint` `worldRulesContext` |
| `inspiration.reverse` | 内置-灵感反推 | 用户写碎片想法，AI 反向生成世界观草稿、故事核心、初始角色卡。 | `projectName` `genres` `inspiration` `userHint` |
| `inspiration.reverse.multiworld` | 内置-多世界灵感反推 | 多世界题材：用户给出带有多个世界意图的灵感，AI 顺着思路反推故事主线 + 多个世界 + 角色。 | `projectName` `genres` `inspiration` `userHint` |
| `world-group.suggest` | 内置-AI建议世界 | 诸天流/无限流等多世界题材，根据故事概念和已有世界建议新的世界组。 | `projectName` `genres` `concept` `existingWorlds` `userHint` |
| `world-group.expand` | 内置-AI扩写世界 | 根据世界的草稿描述，扩展出完整的世界观设定。 | `worldName` `worldType` `draft` `otherWorlds` `storyCore` `userHint` |
| `inventory.extract` | 内置-物品栏提取 | 从章节正文提取主角的物品获得/消耗事件，构建游戏包裹式物品栏。 | `knownItemNames` `chapterTitle` `chapterText` |
| `codex.extract` | 内置-词条拆分提取 | 把整段世界观内容拆成当前分类下可确认写入的结构化词条。 | `categoryName` `fieldSchema` `existingEntries` `supplementTags` `sourceText` |
| `location.extract` | 内置-重要地点提取 | 从已写正文中提取反复出现或推动剧情的重要地点候选。 | `existingEntries` `allowedTags` `sourceText` |
| `codex.extract` | 内置-词条拆分提取 | 把整段世界观内容拆成当前分类下可确认写入的结构化词条。 | `categoryName` `fieldSchema` `existingEntries` `supplementTags` `sourceText` |
| `location.extract` | 内置-重要地点提取 | 从已写正文中提取反复出现或推动剧情的重要地点候选。 | `existingEntries` `allowedTags` `sourceText` |
| `story-timeline.extract` | 内置-故事年表提取 | 从章节正文提取剧情大事，构建故事进程年表（区别于世界背景历史）。 | `chapterTitle` `chapterText` |
| `scene.verify` | 内置-场景考证 | 用户描述当前场景，AI 结合世界观/历史年表/世界规则给出符合背景的细节、时代错乱警示与情节灵感。 | `worldContext` `historyContext` `worldRulesContext` `scene` `sceneEra` `sceneLocation` |
| `history.consult` | 内置-历史考据 agent | 历史年表条目的考据 agent。挑剔但合作，绝不顺着作者的错误假设编造细节；尊重作者已声明的艺术改造/架空范围。 | `itemMeta` `finalText` `conceptNote` `consultPrompt` `worldContext` |
| `history.storm` | 内置-头脑风暴 agent | 历史年表条目的头脑风暴 agent。围绕作者已设定的方向发散可写素材，尊重作者声明的艺术改造范围。 | `itemMeta` `finalText` `conceptNote` `stormPrompt` `worldContext` |
| `style.learn` | 内置-文风学习 | 从用户已定稿/润色的章节中,总结出其个人写作文风画像,供后续章节生成参考。 | `sampleCount` `sampleWords` `samples` `userHint` |

## 二、上下文源清单（CONTEXT_SOURCES · AI 读什么）

共 33 个上下文源。assembleContext({ sourceKeys }) 按 key 装配。

| key | 标签 | 作用域 | 层级 | 预算(token) |
|---|---|---|---|---|
| `manualText` | 用户指定内容 | manual | L0 | 100 |
| `chapterContent` | 章节正文 | chapter | L0 | 100 |
| `contextMemo` | 上下文快照 | project | L3 | 1500 |
| `chapterOutline` | 当前章节大纲 | node | L1 | 800 |
| `existingVolumeOutlines` | 已有卷大纲 | project | L1 | 2400 |
| `currentFacts` | 当前有效事实(事实账本投影) | chapter | L1 | 2000 |
| `retrievedPassages` | 相关前文召回(NS-5 混合检索) | chapter | L2 | 2500 |
| `detailedOutline` | 本章细纲(场景拆解) | node | L1 | 1500 |
| `previousChapterEnding` | 全局直接前驱原文尾部 | manual | L1 | 1800 |
| `chapterContinuityHandoff` | 全局直接前驱连续性交接 | chapter | L1 | 1600 |
| `previousPlanReconciliation` | 前章计划正文对账 | chapter | L1 | 1400 |
| `recentChapterSummaries` | 当前世界最近已验证摘要 | chapter | L1 | 2200 |
| `worldview` | 世界观 | world | L2 | 8000 |
| `storyCore` | 故事核心 | project | L1 | 4000 |
| `powerSystem` | 力量体系 | world | L2 | 4000 |
| `codex` | 设定词条 | world | L2 | 6000 |
| `characters` | 角色档案 | world | L2 | 8000 |
| `creativeRules` | 创作规则 | project | L1 | 1000 |
| `worldRules` | 真实与幻想规则 | world | L1 | 1200 |
| `historical` | 历史时间线 | world | L2 | 1800 |
| `locations` | 重要地点 | project | L2 | 1200 |
| `foreshadows` | 伏笔状态 | chapter | L2 | 1200 |
| `storyArcs` | 故事线 | project | L2 | 1500 |
| `emotionBeats` | 情感节拍 | chapter | L1 | 1000 |
| `stateCards` | 状态卡 | project | L2 | 1800 |
| `itemLedger` | 物品流水 | project | L2 | 2400 |
| `heldItems` | 当前已持有物品 | chapter | L1 | 1000 |
| `storyTimeline` | 故事年表 | project | L2 | 2600 |
| `characterRelations` | 角色关系 | project | L2 | 2200 |
| `references` | 引用手法 | project | L3 | 2000 |
| `userStyleProfile` | 我的文风 | project | L2 | 700 |
| `characterFacts` | 该角色的剧情事实 | project | L1 | 1500 |
| `characterPassages` | 该角色的正文表现 | project | L1 | 2500 |

> 层级裁剪顺序:超预算时 L3 → L2 → L1 依次裁剪,L0 永不裁剪。

## 三、AI 可写字段（FIELD_REGISTRY · adopt 写什么）

AI 输出经 `adopt({ target, data })` 写回,只有这里登记的字段可写(别名自动归一)。

| 目标表 | 可写字段 |
|---|---|
| `chapters` | `content` `continuityHandoff` `notes` `order` `outlineNodeId` `planReconciliation` `status` `summary` `summarySourceTextHash` `summaryTextNormalizationVersion` `title` `wordCount` |
| `characters` | `abilities` `activeChapterRange` `alignment` `appearance` `arc` `background` `ending` `exitChapterId` `fears` `firstAppearChapterId` `firstAppearance` `goals` `habits` `homeWorldGroupId` `identity` `innerConflict` `isCrossWorld` `keyEvents` `location` `moralAxis` `motivation` `name` `orderAxis` `personality` `powerLevel` `profile` `relationships` `role` `roleWeight` `shortDescription` `signatureItem` `speechStyle` `storyRole` `strengths` `values` `weaknesses` |
| `codexCategories` | `builtInKey` `domain` `fieldSchema` `hidden` `icon` `name` `order` `parentId` `worldGroupId` |
| `codexEntries` | `categoryId` `description` `fields` `icon` `importance` `name` `order` `refs` `summary` `tags` `worldGroupId` |
| `creativeRules` | `atmosphere` `citedInsightIds` `citedReferenceIds` `consistencyRules` `narrativePOV` `prohibitions` `referenceWorksV2` `specialRequirements` `writingStyle` |
| `detailedOutlines` | `appearingCharacterIds` `emotionArc` `endingCliffhanger` `foreshadowIds` `lastUsedSummary` `openingHook` `outlineNodeId` `sceneLocation` `scenes` |
| `foreshadows` | `description` `echoChapterIds` `expectedResolveChapterId` `importance` `name` `notes` `plantChapterId` `resolveChapterId` `status` `timelinePosition` `type` `urgency` |
| `importantLocations` | `description` `name` `parentId` `significance` `sortOrder` `tags` |
| `itemLedger` | `action` `chapterId` `chapterTitle` `itemName` `note` `quantity` |
| `outlineNodes` | `order` `parentId` `summary` `title` `type` `worldGroupId` |
| `stateCards` | `category` `entityName` `fields` `lastChapterId` |
| `storyArcs` | `description` `name` `stages` `type` |
| `storyCores` | `centralConflict` `concept` `logline` `mainPlot` `plotPattern` `subPlots` `theme` |
| `storyTimelineEvents` | `chapterId` `chapterTitle` `description` `importance` `order` `storyTime` `title` |
| `worldviews` | `climateByRegion` `continentLayout` `culture` `divineDesign` `economy` `factionLayout` `geography` `history` `historyLine` `internalConflicts` `itemDesign` `mountainsRivers` `naturalResourceOverview` `naturalResources` `politicsEconomyCulture` `powerHierarchy` `races` `regionDimensions` `rules` `society` `worldDimensions` `worldEvents` `worldOrigin` `worldStructure` |

## 四、AI 调用点（消耗统计 category · 在哪触发)

共 44 个 category。
未分类调用: 0 个。动态 category 调用: 3 个。

| category | 触发文件 |
|---|---|
| `ai.restructure` | `src/lib/ai/restructure.ts:53` |
| `chapter.content` | `src/components/editor/ChapterEditor.tsx:453` |
| `chapter.content.batch` | `src/lib/ai/batch-detail-runner.ts:256` |
| `chapter.continue` | `src/components/editor/ChapterEditor.tsx:471` |
| `chapter.deai` | `src/components/editor/ChapterEditor.tsx:508` |
| `chapter.expand` | `src/components/editor/ChapterEditor.tsx:488` |
| `chapter.memory` | `src/components/editor/ChapterEditor.tsx:285` |
| `chapter.polish` | `src/components/editor/ChapterEditor.tsx:480` |
| `chapter.toolbar` | `src/components/editor/FloatingToolbar.tsx:105` |
| `character.generate` | `src/components/character/CharacterPanel.tsx:163` |
| `character.structure` | `src/lib/ai/parse-character-output.ts:80` |
| `character.supplement` | `src/components/character/CharacterSupplementAction.tsx:80` |
| `codex.extract` | `src/components/codex/CodexPanel.tsx:205` |
| `detail.scene` | `src/components/outline/DetailedOutlinePanel.tsx:163`<br/>`src/components/outline/ScenePanel.tsx:115`<br/>`src/lib/ai/batch-detail-runner.ts:109` |
| `emotion.beat` | `src/components/editor/EmotionBeatCard.tsx:66` |
| `foreshadow.structure` | `src/components/foreshadow/ForeshadowPanel.tsx:67` |
| `foreshadow.suggest` | `src/components/foreshadow/ForeshadowPanel.tsx:216` |
| `geography.concept-map` | `src/components/geography/GeographyPanel.tsx:127` |
| `geography.world-map` | `src/components/geography/WorldMapPanel.tsx:103` |
| `inspiration.reverse` | `src/components/project/InspirationPanel.tsx:107` |
| `inventory.extract` | `src/components/items/InventoryPanel.tsx:85` |
| `location.extract` | `src/components/location/LocationPanel.tsx:105` |
| `outline.chapter` | `src/components/outline/OutlinePanel.tsx:378`<br/>`src/lib/ai/batch-outline-runner.ts:123` |
| `outline.character-driven` | `src/components/outline/CharacterDrivenPlotPanel.tsx:113` |
| `outline.volume` | `src/components/outline/OutlinePanel.tsx:330` |
| `prompt.examples` | `src/components/settings/prompt/PromptExamplesEditor.tsx:106` |
| `reference.characters` | `src/components/project/AnalysisReportViewer.tsx:139` |
| `reference.summary` | `src/components/project/AnalysisReportViewer.tsx:110` |
| `relation.extract` | `src/components/relations/CharacterRelationPanel.tsx:73` |
| `review.anti-ai` | `src/components/editor/ReviewPanel.tsx:87` |
| `review.quality` | `src/components/editor/ReviewPanel.tsx:79` |
| `review.readability` | `src/components/editor/ReviewPanel.tsx:96` |
| `review.revise` | `src/components/editor/ChapterEditor.tsx:523` |
| `rules.generate` | `src/components/rules/CreativeRulesPanel.tsx:80` |
| `scene.verify` | `src/components/scene/SceneVerifyPanel.tsx:81` |
| `story-arc.generate` | `src/components/outline/StoryArcPanel.tsx:84` |
| `story.generate` | `src/components/worldview/StoryCorePanel.tsx:193` |
| `story.timeline` | `src/components/timeline/StoryTimelinePanel.tsx:84` |
| `style.learn` | `src/components/style/StyleLearningPanel.tsx:77` |
| `world-group.expand` | `src/components/world-group/WorldGroupDetail.tsx:98` |
| `world-group.suggest` | `src/components/world-group/WorldGroupOverview.tsx:57` |
| `worldview.dimension` | `src/components/worldview/WorldviewHumanityPanel.tsx:252`<br/>`src/components/worldview/WorldviewNaturalPanel.tsx:282`<br/>`src/components/worldview/WorldviewOriginPanel.tsx:287` |
| `worldview.divine` | `src/components/worldview/WorldviewOriginPanel.tsx:386` |
| `worldview.divine.split` | `src/components/worldview/WorldviewOriginPanel.tsx:410` |

### 动态 category 调用

- `src/components/editor/ReviewPanel.tsx:130 · ai.start`
- `src/components/settings/NS0EvalPanel.tsx:50 · chat`
- `src/components/settings/prompt/WorkflowRunner.tsx:273 · ai.start`

---

生成时间基准:commit `3e421eb`
