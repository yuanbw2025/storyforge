# AI 行为说明书（自动生成 · 请勿手动编辑）

> 由 `scripts/generate-ai-manual.mjs` 从代码扫描生成。
> 修改 AI 行为后请运行 `npm run gen:ai-manual` 重新生成。CI 用 `npm run check:ai-manual` 校验一致性。
> 语义注解(每个动作的业务意图/坑)写在 `AI-FUNCTIONS-MANUAL.semantic.md`(手工维护)。

---

## 一、Prompt 模板清单（PromptModuleKey 事实源）

共 61 个 moduleKey。

| moduleKey | 名称 | 说明 | 读取变量 |
|---|---|---|---|
| `worldview.dimension` | — | — | — |
| `character.generate` | — | — | — |
| `character.dimension` | — | — | — |
| `outline.volume` | — | — | — |
| `outline.chapter` | — | — | — |
| `chapter.content` | — | — | — |
| `chapter.continue` | — | — | — |
| `chapter.memory` | — | — | — |
| `chapter.polish` | — | — | — |
| `chapter.expand` | — | — | — |
| `chapter.de-ai` | — | — | — |
| `foreshadow.generate` | — | — | — |
| `geography.concept-map` | — | — | — |
| `geography.image-map-prompt` | — | — | — |
| `worldview.generate` | — | — | — |
| `worldview.worldbuilding` | — | — | — |
| `story.generate` | — | — | — |
| `story.brief` | — | — | — |
| `story.ideation` | — | — | — |
| `story.positioning` | — | — | — |
| `story.core` | — | — | — |
| `story.packaging` | — | — | — |
| `rules.generate` | — | — | — |
| `research.method` | — | — | — |
| `prompt.operations` | — | — | — |
| `detail.scene` | — | — | — |
| `detail.chapter-planning` | — | — | — |
| `character.design` | — | — | — |
| `outline.plot` | — | — | — |
| `outline.structure` | — | — | — |
| `outline.long-form` | — | — | — |
| `outline.short-story` | — | — | — |
| `outline.serialization` | — | — | — |
| `chapter.drafting` | — | — | — |
| `chapter.continuity` | — | — | — |
| `chapter.line-editing` | — | — | — |
| `review.developmental` | — | — | — |
| `review.line-editing` | — | — | — |
| `review.reader-validation` | — | — | — |
| `import.parse-character` | — | — | — |
| `import.parse-worldview` | — | — | — |
| `import.parse-outline` | — | — | — |
| `import.parse-all` | — | — | — |
| `import.parse-chunk` | — | — | — |
| `import.merge-characters` | — | — | — |
| `relation.extract` | — | — | — |
| `plot.character-driven` | — | — | — |
| `inspiration.reverse` | — | — | — |
| `inspiration.reverse.multiworld` | — | — | — |
| `world-group.suggest` | — | — | — |
| `world-group.expand` | — | — | — |
| `inventory.extract` | — | — | — |
| `codex.extract` | — | — | — |
| `location.extract` | — | — | — |
| `codex.extract` | — | — | — |
| `location.extract` | — | — | — |
| `story-timeline.extract` | — | — | — |
| `scene.verify` | — | — | — |
| `history.consult` | — | — | — |
| `history.storm` | — | — | — |
| `style.learn` | — | — | — |

## 二、上下文源清单（CONTEXT_SOURCES · AI 读什么）

共 34 个上下文源。assembleContext({ sourceKeys }) 按 key 装配。

| key | 标签 | 作用域 | 层级 | 预算(token) |
|---|---|---|---|---|
| `manualText` | 用户指定内容 | manual | L0 | 100 |
| `chapterContent` | 章节正文 | chapter | L0 | 100 |
| `contextMemo` | 上下文快照 | project | L3 | 1500 |
| `chapterOutline` | 当前章节大纲 | node | L1 | 800 |
| `existingVolumeOutlines` | 已有卷大纲 | project | L1 | 2400 |
| `writtenChapterProgress` | 本卷已写正文进度 | node | L1 | 3000 |
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
| `historicalKeywords` | `aiBrainstorm` `aiConsult` |
| `historicalTimelineEvents` | `aiBrainstorm` `aiConsult` |
| `importantLocations` | `description` `name` `parentId` `significance` `sortOrder` `tags` |
| `itemLedger` | `action` `chapterId` `chapterTitle` `itemName` `note` `quantity` |
| `outlineNodes` | `order` `parentId` `summary` `title` `type` `worldGroupId` |
| `stateCards` | `category` `entityName` `fields` `lastChapterId` |
| `storyArcs` | `description` `name` `stages` `type` |
| `storyCores` | `centralConflict` `concept` `logline` `mainPlot` `plotPattern` `subPlots` `theme` |
| `storyTimelineEvents` | `chapterId` `chapterTitle` `description` `importance` `order` `storyTime` `title` |
| `worldviews` | `climateByRegion` `continentLayout` `culture` `divineDesign` `economy` `factionLayout` `geography` `history` `historyLine` `internalConflicts` `itemDesign` `mountainsRivers` `naturalResourceOverview` `naturalResources` `politicsEconomyCulture` `powerHierarchy` `races` `regionDimensions` `rules` `society` `worldDimensions` `worldEvents` `worldOrigin` `worldStructure` |

## 四、AI 调用点（消耗统计 category · 在哪触发)

共 46 个 category。
未分类调用: 0 个。动态 category 调用: 3 个。

| category | 触发文件 |
|---|---|
| `ai.restructure` | `src/lib/ai/restructure.ts:54` |
| `chapter.content` | `src/components/editor/ChapterEditor.tsx:489` |
| `chapter.content.batch` | `src/lib/ai/batch-detail-runner.ts:256` |
| `chapter.continue` | `src/components/editor/ChapterEditor.tsx:507` |
| `chapter.deai` | `src/components/editor/ChapterEditor.tsx:544` |
| `chapter.expand` | `src/components/editor/ChapterEditor.tsx:524` |
| `chapter.memory` | `src/components/editor/ChapterEditor.tsx:321` |
| `chapter.polish` | `src/components/editor/ChapterEditor.tsx:516` |
| `chapter.toolbar` | `src/components/editor/FloatingToolbar.tsx:105` |
| `character.generate` | `src/components/character/CharacterPanel.tsx:163` |
| `character.structure` | `src/lib/ai/parse-character-output.ts:80` |
| `character.supplement` | `src/components/character/CharacterSupplementAction.tsx:80` |
| `codex.extract` | `src/components/codex/CodexPanel.tsx:206` |
| `detail.scene` | `src/components/outline/DetailedOutlinePanel.tsx:163`<br/>`src/components/outline/ScenePanel.tsx:115`<br/>`src/lib/ai/batch-detail-runner.ts:109` |
| `emotion.beat` | `src/components/editor/EmotionBeatCard.tsx:66` |
| `foreshadow.structure` | `src/components/foreshadow/ForeshadowPanel.tsx:67` |
| `foreshadow.suggest` | `src/components/foreshadow/ForeshadowPanel.tsx:216` |
| `geography.concept-map` | `src/components/geography/GeographyPanel.tsx:127` |
| `geography.world-map` | `src/components/geography/WorldMapPanel.tsx:103` |
| `history.consult` | `src/components/history/useHistoryAI.ts:118` |
| `history.storm` | `src/components/history/useHistoryAI.ts:120` |
| `inspiration.reverse` | `src/components/project/InspirationPanel.tsx:107` |
| `inventory.extract` | `src/components/items/InventoryPanel.tsx:86` |
| `location.extract` | `src/components/location/LocationPanel.tsx:106` |
| `outline.chapter` | `src/components/outline/useOutlineGenerationController.ts:106`<br/>`src/lib/ai/batch-outline-runner.ts:123` |
| `outline.character-driven` | `src/components/outline/CharacterDrivenPlotPanel.tsx:113` |
| `outline.volume` | `src/components/outline/useOutlineGenerationController.ts:104` |
| `prompt.examples` | `src/components/settings/prompt/PromptExamplesEditor.tsx:108` |
| `reference.characters` | `src/components/project/AnalysisReportViewer.tsx:143` |
| `reference.summary` | `src/components/project/AnalysisReportViewer.tsx:112` |
| `relation.extract` | `src/components/relations/CharacterRelationPanel.tsx:98` |
| `review.anti-ai` | `src/components/editor/ReviewPanel.tsx:87` |
| `review.quality` | `src/components/editor/ReviewPanel.tsx:79` |
| `review.readability` | `src/components/editor/ReviewPanel.tsx:96` |
| `review.revise` | `src/components/editor/ChapterEditor.tsx:559` |
| `rules.generate` | `src/components/rules/CreativeRulesPanel.tsx:80` |
| `scene.verify` | `src/components/scene/SceneVerifyPanel.tsx:81` |
| `story-arc.generate` | `src/components/outline/StoryArcPanel.tsx:84` |
| `story.generate` | `src/components/worldview/StoryCorePanel.tsx:193` |
| `story.timeline` | `src/components/timeline/StoryTimelinePanel.tsx:85` |
| `style.learn` | `src/components/style/StyleLearningPanel.tsx:79` |
| `world-group.expand` | `src/components/world-group/WorldGroupDetail.tsx:98` |
| `world-group.suggest` | `src/components/world-group/WorldGroupOverview.tsx:57` |
| `worldview.dimension` | `src/components/worldview/WorldviewHumanityPanel.tsx:252`<br/>`src/components/worldview/WorldviewNaturalPanel.tsx:281`<br/>`src/components/worldview/WorldviewOriginPanel.tsx:287` |
| `worldview.divine` | `src/components/worldview/WorldviewOriginPanel.tsx:386` |
| `worldview.divine.split` | `src/components/worldview/WorldviewOriginPanel.tsx:410` |

### 动态 category 调用

- `src/components/editor/ReviewPanel.tsx:130 · ai.start`
- `src/components/settings/NS0EvalPanel.tsx:50 · chat`
- `src/components/settings/prompt/WorkflowRunner.tsx:269 · ai.start`

---

生成时间基准:commit `416338b`
