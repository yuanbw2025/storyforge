# AI 行为说明书（自动生成 · 请勿手动编辑）

> 由 `scripts/generate-ai-manual.mjs` 从代码扫描生成。
> 修改 AI 行为后请运行 `npm run gen:ai-manual` 重新生成。CI 用 `npm run check:ai-manual` 校验一致性。
> 语义注解(每个动作的业务意图/坑)写在 `AI-FUNCTIONS-MANUAL.semantic.md`(手工维护)。

---

## 一、Prompt 模板清单（PromptModuleKey 事实源）

共 41 个 moduleKey。

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
| `story.generate` | — | — | — |
| `rules.generate` | — | — | — |
| `detail.scene` | — | — | — |
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
| `library.run` | — | — | — |

### 小说创作 Prompt 资产库

共 118 个独立资产。项目事实输入均按下表声明，并经 `assembleContext({ sourceKeys })` 装配。

| 资产 | 阶段 | 名称 | 输入绑定 | 输出契约 |
|---|---|---|---|---|
| `P00-A` | project-brief | 小说立项：创作任务简报与缺口诊断 | `raw_intent` ← manual<br/>`existing_materials` ← manual<br/>`explicit_constraints` ← source:creativeRules + source:userStyleProfile<br/>`length_mode` ← project:lengthMode<br/>`serialization_mode` ← project:serializationMode<br/>`genre_candidates` ← project:genres<br/>`target_readers` ← manual<br/>`delivery_form` ← manual | preview → 项目灵感或创作规则（审核后整理） |
| `P01-A` | ideation | 灵感阶段：混杂素材净化与原创灵感卡 | `materials` ← manual<br/>`author_direction` ← manual | preview → 项目灵感或创作规则（审核后整理） |
| `P02-A` | positioning | 定位阶段：题材、读者承诺与差异化 | `story_direction` ← source:storyCore<br/>`length_mode` ← project:lengthMode<br/>`delivery_mode` ← project:serializationMode<br/>`author_preferences` ← source:creativeRules + source:userStyleProfile<br/>`candidate_genres` ← project:genres | preview → 项目灵感或创作规则（审核后整理） |
| `P03-A` | story-core | 故事核心：概念筛选与前提压力测试 | `creative_brief` ← source:storyCore<br/>`genre_promise` ← source:storyCore<br/>`candidate_ideas` ← manual<br/>`author_nonnegotiables` ← source:creativeRules + source:userStyleProfile | preview → 故事核心（审核后整理） |
| `P04-A` | research | 研究问题树与最小考证计划 | `story_core` ← source:storyCore<br/>`time_place` ← source:locations + source:worldview<br/>`key_scenes` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`domains` ← manual<br/>`fictionalization` ← manual<br/>`existing_sources` ← manual | preview → 项目参考或真实与幻想规则（审核后整理） |
| `P04-B` | research | 来源冲突与事实边界裁决 | `question` ← source:storyCore<br/>`source_records` ← manual<br/>`story_use` ← source:storyCore | preview → 项目参考或真实与幻想规则（审核后整理） |
| `P04-C` | research | 事实转化为剧情条件 | `verified_facts` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`characters_goals` ← source:characters + source:characterRelations + source:stateCards<br/>`planned_scene` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`pov` ← source:characters + source:characterRelations + source:stateCards | preview → 项目参考或真实与幻想规则（审核后整理） |
| `P05-A` | worldbuilding | 叙事最小世界规格 | `story_core` ← source:storyCore<br/>`characters` ← source:characters + source:characterRelations + source:stateCards<br/>`genre_promise` ← source:storyCore<br/>`research_boundary` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`existing_world` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations | preview → 世界观、力量体系或设定词条（审核后拆分） |
| `P05-B` | worldbuilding | 地理—资源—社会—冲突因果链 | `world_material` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`story_needs` ← source:storyCore<br/>`fiction_rules` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations | preview → 世界观、力量体系或设定词条（审核后拆分） |
| `P05-C` | worldbuilding | 文化与日常生活纹理 | `society_rules` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`history` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`characters_positions` ← source:characters + source:characterRelations + source:stateCards | preview → 世界观、力量体系或设定词条（审核后拆分） |
| `P05-D` | worldbuilding | 世界观矛盾与漏洞审计 | `world_rules` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`world_details` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`plot_requirements` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 世界观、力量体系或设定词条（审核后拆分） |
| `P06-A` | character | 核心人物压力模型 | `story_core` ← source:storyCore<br/>`world_pressure` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`character` ← source:characters + source:characterRelations + source:stateCards<br/>`story_role` ← source:storyCore | preview → 角色档案或角色关系（审核后拆分） |
| `P06-B` | character | 对抗力量与反派正当性 | `protagonist` ← source:characters + source:characterRelations + source:stateCards<br/>`central_conflict` ← source:storyCore<br/>`world_rules` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`antagonist` ← source:characters + source:characterRelations + source:stateCards | preview → 角色档案或角色关系（审核后拆分） |
| `P06-C` | character | 配角网络与关系动力 | `core_characters` ← source:characters + source:characterRelations + source:stateCards<br/>`plot_lines` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`supporting_characters` ← source:characters + source:characterRelations + source:stateCards | preview → 角色档案或角色关系（审核后拆分） |
| `P06-D` | character | 人物弧与阶段状态 | `character_core` ← source:characters + source:characterRelations + source:stateCards<br/>`major_plot_turns` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`written_facts` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows | preview → 角色档案或角色关系（审核后拆分） |
| `P07-A` | plot | 目标—动机—冲突发动机 | `story_core` ← source:storyCore<br/>`characters` ← source:characters + source:characterRelations + source:stateCards<br/>`world_constraints` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`length_mode` ← project:lengthMode | preview → 故事线或大纲（审核后拆分） |
| `P07-B` | plot | 升级阶梯与尝试—失败循环 | `plot_engine` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`resources` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`turns` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 故事线或大纲（审核后拆分） |
| `P07-C` | plot | 信息释放与悬念管理 | `story_truth` ← source:storyCore<br/>`pov_plan` ← source:characters + source:characterRelations + source:stateCards<br/>`plot_turns` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 故事线或大纲（审核后拆分） |
| `P07-D` | plot | 复线编织与碰撞 | `main_plot` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`subplots` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`character_arcs` ← source:characters + source:characterRelations + source:stateCards<br/>`length_mode` ← project:lengthMode | preview → 故事线或大纲（审核后拆分） |
| `P08-A` | structure | 结构阶段：结构模型选择与全书转折 | `story_core` ← source:storyCore<br/>`character_arcs` ← source:characters + source:characterRelations + source:stateCards<br/>`world_and_constraints` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`genre_promise` ← source:storyCore<br/>`length_mode` ← project:lengthMode<br/>`delivery_mode` ← project:serializationMode<br/>`target_words` ← manual<br/>`known_ending` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 故事线或大纲（审核后拆分） |
| `P09L-A` | long-form | 全书阶段与卷级架构 | `story_core` ← source:storyCore<br/>`major_turns` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`character_arcs` ← source:characters + source:characterRelations + source:stateCards<br/>`plot_lines` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`target_length` ← manual<br/>`written_progress` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows | preview → 故事线或大纲（审核后拆分） |
| `P09L-B` | long-form | 卷级承诺—兑现账本 | `outline` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`genre_promise` ← source:storyCore<br/>`foreshadows` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 故事线或大纲（审核后拆分） |
| `P09L-C` | long-form | 长篇中段疲软诊断与重构 | `before_middle` ← source:chapterContent<br/>`middle` ← manual<br/>`after_middle` ← source:chapterContent<br/>`character_states` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows | preview → 故事线或大纲（审核后拆分） |
| `P09L-D` | long-form | 高潮阶梯与结局汇流 | `plots` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`promises` ← source:storyCore<br/>`character_arcs` ← source:characters + source:characterRelations + source:stateCards<br/>`ending` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 故事线或大纲（审核后拆分） |
| `P09S-A` | short-story | 短篇核心变化设计 | `idea` ← manual<br/>`target_words` ← manual<br/>`emotion_or_insight` ← manual<br/>`rules` ← source:creativeRules + source:userStyleProfile | preview → 故事线或大纲（审核后拆分） |
| `P09S-B` | short-story | 短篇压缩与人物合并 | `text` ← source:chapterContent<br/>`core_change` ← source:storyCore<br/>`target_words` ← manual | preview → 故事线或大纲（审核后拆分） |
| `P09S-C` | short-story | 开场进入点与叙事范围 | `events` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`pov` ← source:characters + source:characterRelations + source:stateCards<br/>`ending` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 故事线或大纲（审核后拆分） |
| `P09S-D` | short-story | 短篇结尾与余震 | `story` ← source:storyCore<br/>`core_change` ← source:storyCore<br/>`effect` ← manual | preview → 故事线或大纲（审核后拆分） |
| `P09R-A` | serialization | 阶段阅读回报规划 | `outline` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`genre_promise` ← source:storyCore<br/>`range` ← manual<br/>`parameters` ← manual | preview → 故事线或大纲（审核后拆分） |
| `P09R-B` | serialization | 章节断点设计 | `chapter` ← source:chapterContent<br/>`next` ← manual<br/>`reader_question` ← source:storyCore | preview → 故事线或大纲（审核后拆分） |
| `P09R-C` | serialization | 连载生产缓冲与卷级排期 | `update_goal` ← manual<br/>`capacity` ← manual<br/>`backlog` ← manual<br/>`revision_time` ← manual<br/>`constraints` ← source:creativeRules + source:userStyleProfile | preview → 故事线或大纲（审核后拆分） |
| `P09R-D` | serialization | 读者反馈去噪 | `feedback` ← manual<br/>`promise` ← source:storyCore<br/>`intent` ← manual<br/>`facts` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows | preview → 故事线或大纲（审核后拆分） |
| `P10-A` | chapter-planning | 章节任务单 | `volume_goal` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`chapter_outline` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`previous_actual` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`next_plan` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`states` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows | preview → 章纲或场景细纲（审核后整理） |
| `P10-B` | chapter-planning | 场景卡与变化证明 | `chapter_task` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`location` ← source:locations + source:worldview<br/>`participants` ← source:characters + source:characterRelations + source:stateCards | preview → 章纲或场景细纲（审核后整理） |
| `P10-C` | chapter-planning | 场景—反应—决定节奏选择 | `result` ← manual<br/>`state` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`pace` ← manual<br/>`next` ← manual | preview → 章纲或场景细纲（审核后整理） |
| `P10-D` | chapter-planning | 章节情绪节拍 | `scenes` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`baseline` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline + source:characters + source:characterRelations + source:stateCards + source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`target_arc` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 章纲或场景细纲（审核后整理） |
| `P10-E` | chapter-planning | 章节标题生成与筛选 | `summary` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`style` ← source:creativeRules + source:userStyleProfile<br/>`neighbors` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 章节标题候选 |
| `P11-A` | drafting | 首章草稿 | `brief` ← source:storyCore<br/>`core` ← source:storyCore<br/>`plan` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`characters` ← source:characters + source:characterRelations + source:stateCards<br/>`world` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`style` ← source:creativeRules + source:userStyleProfile<br/>`words` ← manual | adopt → `chapters.content` (replace) |
| `P11-B` | drafting | 按章场任务写正文 | `task` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`scenes` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`continuity` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`voices` ← source:characters + source:characterRelations + source:stateCards<br/>`rules` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:creativeRules + source:userStyleProfile<br/>`instruction` ← manual<br/>`words` ← manual | adopt → `chapters.content` (replace) |
| `P11-C` | drafting | 连续续写 | `text` ← source:chapterContent<br/>`handoff` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`next_task` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`continuity` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`style` ← source:creativeRules + source:userStyleProfile<br/>`words` ← manual | adopt → `chapters.content` (append) |
| `P11-D` | drafting | 对白与潜台词 | `goal` ← manual<br/>`participants` ← source:characters + source:characterRelations + source:stateCards<br/>`knowledge` ← source:characters + source:characterRelations + source:currentFacts<br/>`relationship` ← source:characters + source:characterRelations + source:stateCards<br/>`setting` ← source:locations + source:worldview | preview → 章节正文（预览后手动采用） |
| `P11-E` | drafting | 动作与空间连续性 | `goal` ← manual<br/>`space` ← source:locations + source:worldview<br/>`states` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`abilities` ← source:characters + source:characterRelations + source:stateCards<br/>`outcome` ← manual | preview → 章节正文（预览后手动采用） |
| `P11-F` | drafting | 描述、内心与转场配比 | `goal` ← manual<br/>`state` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`world` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`time` ← source:storyTimeline + source:historical<br/>`draft` ← source:chapterContent | preview → 章节正文（预览后手动采用） |
| `P12-A` | continuity | 章节记忆与结尾交接 | `title` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`text` ← source:chapterContent<br/>`previous` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows | preview → 连续性、状态、伏笔或年表（审核后拆分） |
| `P12-B` | continuity | 人物与关系状态差分 | `before` ← source:chapterContent<br/>`text` ← source:chapterContent | preview → 连续性、状态、伏笔或年表（审核后拆分） |
| `P12-C` | continuity | 时间线、地点与物品账本 | `timeline` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`items` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`text` ← source:chapterContent | preview → 连续性、状态、伏笔或年表（审核后拆分） |
| `P12-D` | continuity | 伏笔生命周期更新 | `ledger` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`text` ← source:chapterContent | preview → 连续性、状态、伏笔或年表（审核后拆分） |
| `P12-E` | continuity | 计划—正文对账 | `plan` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`text` ← source:chapterContent<br/>`next` ← manual | preview → 连续性、状态、伏笔或年表（审核后拆分） |
| `P12-F` | continuity | 跨章连续性审计 | `draft` ← source:chapterContent<br/>`context` ← source:chapterContent + source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline + source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows + source:characters + source:characterRelations + source:stateCards + source:creativeRules + source:userStyleProfile | preview → 连续性、状态、伏笔或年表（审核后拆分） |
| `P13-A` | developmental-editing | 全稿发展性诊断 | `brief` ← source:storyCore<br/>`promise` ← source:storyCore<br/>`outline` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`manuscript` ← source:chapterContent<br/>`questions` ← source:storyCore | preview → 修订清单（仅诊断，不直接写回） |
| `P13-B` | developmental-editing | 因果链与情节漏洞审计 | `plot` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`facts` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows | preview → 修订清单（仅诊断，不直接写回） |
| `P13-C` | developmental-editing | 人物弧漂移与角色功能重构 | `planned` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`actual` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`plot` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 修订清单（仅诊断，不直接写回） |
| `P13-D` | developmental-editing | 删改移补修订路线图 | `diagnosis` ← manual<br/>`map` ← manual<br/>`decisions` ← manual | preview → 修订清单（仅诊断，不直接写回） |
| `P13-E` | developmental-editing | 高潮与结局兑现审计 | `opening` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`ending` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`arcs` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 修订清单（仅诊断，不直接写回） |
| `P14-A` | line-editing | 场景级诊断与定向修订 | `scene` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`context` ← source:chapterContent + source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline + source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows + source:characters + source:characterRelations + source:stateCards + source:creativeRules + source:userStyleProfile<br/>`goal` ← manual<br/>`allowed` ← source:creativeRules + source:userStyleProfile | preview → 章节正文（预览后手动采用） |
| `P14-B` | line-editing | 对白去说明化与潜台词修订 | `scene` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`characters` ← source:characters + source:characterRelations + source:stateCards<br/>`relationship` ← source:characters + source:characterRelations + source:stateCards | preview → 章节正文（预览后手动采用） |
| `P14-C` | line-editing | 视角、叙事距离与知识边界 | `rule` ← source:creativeRules + source:userStyleProfile<br/>`context` ← source:chapterContent + source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline + source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows + source:characters + source:characterRelations + source:stateCards + source:creativeRules + source:userStyleProfile<br/>`text` ← source:chapterContent | preview → 章节正文（预览后手动采用） |
| `P14-D` | line-editing | 节奏、句群与信息密度 | `goal` ← manual<br/>`text` ← source:chapterContent | preview → 章节正文（预览后手动采用） |
| `P14-E` | line-editing | 展示、概述、解释与省略平衡 | `text` ← source:chapterContent<br/>`importance` ← manual<br/>`needs` ← manual | preview → 章节正文（预览后手动采用） |
| `P14-F` | line-editing | 保真润色、扩写与压缩 | `target` ← manual<br/>`style` ← source:creativeRules + source:userStyleProfile<br/>`text` ← source:chapterContent | preview → 章节正文（预览后手动采用） |
| `P15-A` | reader-validation | 首章盲读轨迹 | `reader` ← manual<br/>`chapter` ← source:chapterContent | preview → 修订清单（仅诊断，不直接写回） |
| `P15-B` | reader-validation | 体裁期待—兑现测试 | `contract` ← manual<br/>`text` ← source:chapterContent | preview → 修订清单（仅诊断，不直接写回） |
| `P15-C` | reader-validation | 多视角贝塔读者模拟 | `profiles` ← manual<br/>`questions` ← source:storyCore<br/>`text` ← source:chapterContent | preview → 修订清单（仅诊断，不直接写回） |
| `P15-D` | reader-validation | 悬念与问题链体验 | `text` ← source:chapterContent | preview → 修订清单（仅诊断，不直接写回） |
| `P15-E` | reader-validation | 修改后 A/B 体验对比 | `goal` ← manual<br/>`a` ← manual<br/>`b` ← manual | preview → 修订清单（仅诊断，不直接写回） |
| `P16-A` | packaging | 书名发散与筛选 | `core` ← source:storyCore<br/>`genre` ← project:genres<br/>`tone` ← manual<br/>`avoid` ← source:creativeRules + source:userStyleProfile | preview → 项目包装资料（预览后使用） |
| `P16-B` | packaging | 无剧透作品简介 | `core` ← source:storyCore<br/>`opening` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`promise` ← source:storyCore<br/>`boundary` ← source:creativeRules + source:userStyleProfile<br/>`limit` ← manual | preview → 项目包装资料（预览后使用） |
| `P16-C` | packaging | 完整剧情梗概 | `story` ← source:storyCore<br/>`length` ← manual<br/>`requirements` ← manual | preview → 项目包装资料（预览后使用） |
| `P16-D` | packaging | 标签、关键词与内容提示 | `facts` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`genre` ← project:genres<br/>`schema` ← manual | preview → 项目包装资料（预览后使用） |
| `P16-E` | packaging | 投稿说明/查询信素材 | `work` ← manual<br/>`author` ← manual<br/>`requirements` ← manual<br/>`comps` ← manual | preview → 项目包装资料（预览后使用） |
| `P17-A` | prompt-operations | Prompt 运行复盘与差异归因 | `metadata` ← manual<br/>`input` ← manual<br/>`output` ← manual<br/>`accepted` ← manual<br/>`feedback` ← manual | preview → Prompt 资产管理（仅预览） |
| `P17-B` | prompt-operations | Prompt 版本 A/B 评测设计 | `a` ← manual<br/>`b` ← manual<br/>`contract` ← manual<br/>`failures` ← manual | preview → Prompt 资产管理（仅预览） |
| `P17-C` | prompt-operations | 小说阶段 Prompt 生成器 | `stage` ← manual<br/>`task_type` ← manual<br/>`required` ← manual<br/>`optional` ← manual<br/>`target` ← manual<br/>`profiles` ← manual<br/>`risks` ← manual | preview → Prompt 资产管理（仅预览） |
| `P17-D` | prompt-operations | 全库语义查重与合并决策 | `assets` ← manual | preview → Prompt 资产管理（仅预览） |
| `P17-E` | prompt-operations | 发布前资产验收 | `asset` ← manual<br/>`tests` ← manual<br/>`provenance` ← manual | preview → Prompt 资产管理（仅预览） |
| `G-MYSTERY-A` | plot | 从谜底反推完整事实 | `concept` ← source:storyCore<br/>`world` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`characters` ← source:characters + source:characterRelations + source:stateCards | preview → 故事线或大纲（审核后拆分） |
| `G-MYSTERY-B` | plot | 公平线索矩阵 | `truth` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`outline` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`pov` ← source:characters + source:characterRelations + source:stateCards | preview → 故事线或大纲（审核后拆分） |
| `G-MYSTERY-C` | plot | 嫌疑人与红鲱鱼 | `truth` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`suspects` ← source:characters + source:characterRelations + source:stateCards<br/>`clues` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 故事线或大纲（审核后拆分） |
| `G-MYSTERY-D` | plot | 调查节拍与揭示顺序 | `material` ← source:storyCore + source:characters + source:characterRelations + source:stateCards + source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`investigator` ← source:characters + source:characterRelations + source:stateCards | preview → 故事线或大纲（审核后拆分） |
| `G-MYSTERY-E` | plot | 推理公平性审计 | `text` ← source:chapterContent<br/>`truth` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`clues` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 故事线或大纲（审核后拆分） |
| `G-HISTORY-A` | research | 史实锚点与虚构空间 | `time_place` ← source:locations + source:worldview<br/>`material` ← source:storyCore + source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`plan` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`mode` ← manual | preview → 项目参考或真实与幻想规则（审核后整理） |
| `G-HISTORY-B` | research | 时代生活与身份知识边界 | `context` ← source:storyCore + source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`identity` ← source:characters + source:characterRelations + source:stateCards<br/>`scene` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 项目参考或真实与幻想规则（审核后整理） |
| `G-HISTORY-C` | research | 历史人物与虚构人物共场 | `facts` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`fictional` ← manual<br/>`interaction` ← manual | preview → 项目参考或真实与幻想规则（审核后整理） |
| `G-HISTORY-D` | research | 时代错置与现代价值投射审计 | `text` ← source:chapterContent<br/>`rules` ← source:creativeRules + source:userStyleProfile | preview → 项目参考或真实与幻想规则（审核后整理） |
| `G-COMEDY-A` | plot | 喜剧发动机 | `characters` ← source:characters + source:characterRelations + source:stateCards<br/>`situation` ← manual<br/>`tone` ← manual | preview → 故事线或大纲（审核后拆分） |
| `G-COMEDY-B` | plot | 误会喜剧的公平信息 | `material` ← source:storyCore + source:characters + source:characterRelations + source:stateCards + source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`knowledge` ← source:characters + source:characterRelations + source:currentFacts | preview → 故事线或大纲（审核后拆分） |
| `G-COMEDY-C` | plot | 喜剧节奏与回调 | `text` ← source:chapterContent | preview → 故事线或大纲（审核后拆分） |
| `G-COMEDY-D` | plot | 喜剧边界与人物尊严审计 | `text` ← source:chapterContent<br/>`tone` ← manual | preview → 故事线或大纲（审核后拆分） |
| `G-FANTASY-A` | worldbuilding | 魔法/超自然规则与叙事边界 | `concept` ← source:storyCore<br/>`story` ← source:storyCore<br/>`rules` ← source:creativeRules + source:userStyleProfile | preview → 世界观、力量体系或设定词条（审核后拆分） |
| `G-FANTASY-B` | worldbuilding | 神话、宗教与仪式的社会功能 | `cosmology` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`factions` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations | preview → 世界观、力量体系或设定词条（审核后拆分） |
| `G-FANTASY-C` | worldbuilding | 奇观场景与因果功能 | `rules` ← source:creativeRules + source:userStyleProfile<br/>`goal` ← manual<br/>`pov` ← source:characters + source:characterRelations + source:stateCards | preview → 世界观、力量体系或设定词条（审核后拆分） |
| `G-FANTASY-D` | worldbuilding | 魔法漏洞与万能解法审计 | `rules` ← source:creativeRules + source:userStyleProfile<br/>`plot` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 世界观、力量体系或设定词条（审核后拆分） |
| `G-HORROR-A` | plot | 恐怖来源与边界 | `concept` ← source:storyCore<br/>`characters` ← source:characters + source:characterRelations + source:stateCards<br/>`boundaries` ← manual | preview → 故事线或大纲（审核后拆分） |
| `G-HORROR-B` | plot | 威胁显露与升级 | `rules` ← source:creativeRules + source:userStyleProfile<br/>`outline` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 故事线或大纲（审核后拆分） |
| `G-HORROR-C` | plot | 恐怖场景的主观感知 | `goal` ← manual<br/>`space` ← source:locations + source:worldview<br/>`threat` ← manual<br/>`pov` ← source:characters + source:characterRelations + source:stateCards | preview → 故事线或大纲（审核后拆分） |
| `G-HORROR-D` | plot | 揭示程度与结尾余悸 | `questions` ← source:storyCore<br/>`rules` ← source:creativeRules + source:userStyleProfile<br/>`ending` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 故事线或大纲（审核后拆分） |
| `G-PROGRESSION-A` | plot | 成长系统与边界 | `promise` ← source:storyCore<br/>`world` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`protagonist` ← source:characters + source:characterRelations + source:stateCards | preview → 故事线或大纲（审核后拆分） |
| `G-PROGRESSION-B` | plot | 资源经济与稀缺性 | `system` ← manual<br/>`economy` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations | preview → 故事线或大纲（审核后拆分） |
| `G-PROGRESSION-C` | plot | 挑战阶梯与能力证明 | `capabilities` ← source:characters + source:characterRelations + source:stateCards<br/>`goal` ← manual<br/>`stage` ← manual | preview → 故事线或大纲（审核后拆分） |
| `G-PROGRESSION-D` | plot | 训练、突破与奖励节拍 | `growth` ← manual<br/>`range` ← manual<br/>`serial` ← project:serializationMode | preview → 故事线或大纲（审核后拆分） |
| `G-PROGRESSION-E` | plot | 升级通胀与后期失控审计 | `history` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`future` ← manual | preview → 故事线或大纲（审核后拆分） |
| `G-ROMANCE-A` | character | 双主角关系发动机 | `characters` ← source:characters + source:characterRelations + source:stateCards<br/>`world` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`mode` ← manual | preview → 角色档案或角色关系（审核后拆分） |
| `G-ROMANCE-B` | character | 关系节拍与新平衡 | `engine` ← manual<br/>`plot` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`ending` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 角色档案或角色关系（审核后拆分） |
| `G-ROMANCE-C` | character | 可信阻力与冲突修复 | `outline` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`knowledge` ← source:characters + source:characterRelations + source:currentFacts | preview → 角色档案或角色关系（审核后拆分） |
| `G-ROMANCE-D` | character | 亲密场景的同意、脆弱与后果 | `state` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`goal` ← manual<br/>`boundary` ← source:creativeRules + source:userStyleProfile | preview → 角色档案或角色关系（审核后拆分） |
| `G-ROMANCE-E` | character | 关系高潮与乐观结局兑现 | `arc` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`ending` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 角色档案或角色关系（审核后拆分） |
| `G-LITERARY-A` | story-core | 日常处境中的结构压力 | `context` ← source:storyCore<br/>`characters` ← source:characters + source:characterRelations + source:stateCards<br/>`theme` ← source:storyCore | preview → 故事线或大纲（审核后拆分） |
| `G-LITERARY-B` | story-core | 弱情节/内在变化结构 | `material` ← source:storyCore<br/>`length` ← manual | preview → 故事线或大纲（审核后拆分） |
| `G-LITERARY-C` | story-core | 细节选择与避免苦难消费 | `text` ← source:chapterContent<br/>`context` ← source:storyCore | preview → 故事线或大纲（审核后拆分） |
| `G-LITERARY-D` | story-core | 开放结局与主题余义 | `arc` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`candidates` ← manual | preview → 故事线或大纲（审核后拆分） |
| `G-SCIFI-A` | worldbuilding | 核心新设定与最小改变 | `novum` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`science` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`story` ← source:storyCore | preview → 世界观、力量体系或设定词条（审核后拆分） |
| `G-SCIFI-B` | worldbuilding | 技术—制度—日常连锁推演 | `tech` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`timeline` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`baseline` ← source:storyCore + source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations | preview → 世界观、力量体系或设定词条（审核后拆分） |
| `G-SCIFI-C` | worldbuilding | 科学可信度与不确定性审计 | `claims` ← manual<br/>`rules` ← source:creativeRules + source:userStyleProfile<br/>`text` ← source:chapterContent | preview → 世界观、力量体系或设定词条（审核后拆分） |
| `G-SCIFI-D` | worldbuilding | 技术问题转化为人物冲突 | `tech` ← source:worldview + source:worldRules + source:powerSystem + source:codex + source:historical + source:locations<br/>`characters` ← source:characters + source:characterRelations + source:stateCards<br/>`theme` ← source:storyCore | preview → 世界观、力量体系或设定词条（审核后拆分） |
| `G-ENSEMBLE-A` | character | 群像中心与角色权重 | `concept` ← source:storyCore<br/>`characters` ← source:characters + source:characterRelations + source:stateCards<br/>`length` ← manual | preview → 角色档案或角色关系（审核后拆分） |
| `G-ENSEMBLE-B` | character | 多视角分配与切换 | `outline` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`povs` ← source:characters + source:characterRelations + source:stateCards<br/>`information` ← source:characters + source:characterRelations + source:currentFacts | preview → 角色档案或角色关系（审核后拆分） |
| `G-ENSEMBLE-C` | character | 信息拼图与视角偏差 | `facts` ← source:chapterContinuityHandoff + source:previousPlanReconciliation + source:recentChapterSummaries + source:currentFacts + source:stateCards + source:heldItems + source:itemLedger + source:storyTimeline + source:foreshadows<br/>`beliefs` ← source:characters + source:characterRelations + source:stateCards | preview → 角色档案或角色关系（审核后拆分） |
| `G-ENSEMBLE-D` | character | 群像汇流与离场审计 | `lines` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline<br/>`ending` ← source:existingVolumeOutlines + source:storyArcs + source:chapterOutline + source:detailedOutline | preview → 角色档案或角色关系（审核后拆分） |

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

共 50 个 category。
未分类调用: 0 个。动态 category 调用: 3 个。

| category | 触发文件 |
|---|---|
| `ai.restructure` | `src/lib/ai/restructure.ts:54` |
| `chapter.content` | `src/components/editor/ChapterEditor.tsx:494` |
| `chapter.content.batch` | `src/lib/ai/batch-detail-runner.ts:256` |
| `chapter.continue` | `src/components/editor/ChapterEditor.tsx:512` |
| `chapter.deai` | `src/components/editor/ChapterEditor.tsx:549` |
| `chapter.expand` | `src/components/editor/ChapterEditor.tsx:529` |
| `chapter.memory` | `src/components/editor/ChapterEditor.tsx:326` |
| `chapter.polish` | `src/components/editor/ChapterEditor.tsx:521` |
| `chapter.toolbar` | `src/components/editor/FloatingToolbar.tsx:105` |
| `character.generate` | `src/components/character/CharacterPanel.tsx:160` |
| `character.structure` | `src/lib/ai/parse-character-output.ts:80` |
| `character.supplement` | `src/components/character/CharacterSupplementAction.tsx:80` |
| `codex.extract` | `src/components/codex/CodexPanel.tsx:206` |
| `detail.scene` | `src/components/outline/DetailedOutlinePanel.tsx:151`<br/>`src/components/outline/ScenePanel.tsx:115`<br/>`src/lib/ai/batch-detail-runner.ts:109` |
| `emotion.beat` | `src/components/editor/EmotionBeatCard.tsx:66` |
| `foreshadow.structure` | `src/components/foreshadow/ForeshadowPanel.tsx:67` |
| `foreshadow.suggest` | `src/components/foreshadow/ForeshadowPanel.tsx:216` |
| `geography.concept-map` | `src/components/geography/GeographyPanel.tsx:127` |
| `geography.world-map` | `src/components/geography/WorldMapPanel.tsx:103` |
| `history.consult` | `src/components/history/useHistoryAI.ts:118` |
| `history.storm` | `src/components/history/useHistoryAI.ts:120` |
| `inspiration.reverse` | `src/components/project/InspirationPanel.tsx:107` |
| `inventory.extract` | `src/components/items/InventoryPanel.tsx:86` |
| `library.analysis` | `src/components/settings/prompt/PromptLibraryPanel.tsx:284` |
| `library.creation` | `src/components/settings/prompt/PromptLibraryPanel.tsx:278` |
| `library.extraction` | `src/components/settings/prompt/PromptLibraryPanel.tsx:280` |
| `library.review` | `src/components/settings/prompt/PromptLibraryPanel.tsx:282` |
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
| `review.revise` | `src/components/editor/ChapterEditor.tsx:564` |
| `rules.generate` | `src/components/rules/CreativeRulesPanel.tsx:80` |
| `scene.verify` | `src/components/scene/SceneVerifyPanel.tsx:81` |
| `story-arc.generate` | `src/components/outline/StoryArcPanel.tsx:84` |
| `story.generate` | `src/components/worldview/StoryCorePanel.tsx:193` |
| `story.timeline` | `src/components/timeline/StoryTimelinePanel.tsx:85` |
| `style.learn` | `src/components/style/StyleLearningPanel.tsx:79` |
| `world-group.expand` | `src/components/world-group/WorldGroupDetail.tsx:98` |
| `world-group.suggest` | `src/components/world-group/WorldGroupOverview.tsx:57` |
| `worldview.dimension` | `src/components/worldview/WorldviewHumanityPanel.tsx:252`<br/>`src/components/worldview/WorldviewNaturalPanel.tsx:281`<br/>`src/components/worldview/WorldviewOriginPanel.tsx:257` |
| `worldview.divine` | `src/components/worldview/WorldviewOriginPanel.tsx:356` |
| `worldview.divine.split` | `src/components/worldview/WorldviewOriginPanel.tsx:380` |

### 动态 category 调用

- `src/components/editor/ReviewPanel.tsx:130 · ai.start`
- `src/components/settings/NS0EvalPanel.tsx:50 · chat`
- `src/components/settings/prompt/WorkflowRunner.tsx:263 · ai.start`

---

生成时间基准:commit `921ab03`
