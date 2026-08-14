/**
 * FIELD_REGISTRY(Phase 1.2a) · AI/结构化采纳允许写入的字段单一事实源。
 *
 * 本任务只新增写回层,不迁移现有调用方。1.2b 才把面板/store 写回切到 adopt()。
 */
import type { FieldSpec } from './types'

const roleAliases: Record<string, string> = {
  主角: 'protagonist',
  男主: 'protagonist',
  女主: 'protagonist',
  主人公: 'protagonist',
  反派: 'antagonist',
  大反派: 'antagonist',
  配角: 'supporting',
  重要配角: 'supporting',
  次要: 'minor',
  次要角色: 'minor',
  NPC: 'npc',
  npc: 'npc',
  路人: 'extra',
  龙套: 'extra',
}

const roleWeightAliases: Record<string, string> = {
  主要: 'main',
  主要角色: 'main',
  核心角色: 'main',
  主角: 'main',
  反派: 'main',
  重要配角: 'main',
  次要: 'secondary',
  次要角色: 'secondary',
  NPC: 'npc',
  npc: 'npc',
  路人: 'extra',
  龙套: 'extra',
}

const chapterStatusAliases: Record<string, string> = {
  大纲: 'outline',
  草稿: 'draft',
  初稿: 'draft',
  已修改: 'revised',
  修改: 'revised',
  润色: 'polished',
  已润色: 'polished',
  定稿: 'final',
}

const foreshadowStatusAliases: Record<string, string> = {
  计划中: 'planned',
  已埋设: 'planted',
  已呼应: 'echoed',
  已回收: 'resolved',
  回收: 'resolved',
}

const foreshadowTypeAliases: Record<string, string> = {
  契诃夫之枪: 'chekhov',
  预言: 'prophecy',
  预言暗示: 'prophecy',
  象征: 'symbol',
  角色伏笔: 'character',
  对话伏笔: 'dialogue',
  环境伏笔: 'environment',
  时间线伏笔: 'timeline',
  红鲱鱼: 'red-herring',
  平行伏笔: 'parallel',
  回调: 'callback',
}

const trimString = (val: unknown): unknown =>
  typeof val === 'string' ? val.trim() : val

function text(target: string, field: string, aliases?: string[]): FieldSpec {
  return { target, field, type: 'string', aliases, sanitize: trimString }
}

function longtext(target: string, field: string, aliases?: string[]): FieldSpec {
  return { target, field, type: 'longtext', aliases, sanitize: trimString }
}

function num(target: string, field: string, aliases?: string[]): FieldSpec {
  return { target, field, type: 'number', aliases }
}

function bool(target: string, field: string, aliases?: string[]): FieldSpec {
  return { target, field, type: 'boolean', aliases }
}

function json(target: string, field: string, aliases?: string[]): FieldSpec {
  return { target, field, type: 'json', aliases }
}

/** IndexedDB 原生对象字段（区别于以 JSON string 存储的 json 字段）。 */
function object(target: string, field: string, aliases?: string[]): FieldSpec {
  return { target, field, type: 'object', aliases }
}

function arr(target: string, field: string, aliases?: string[]): FieldSpec {
  return { target, field, type: 'array', aliases }
}

function enumeration(
  target: string,
  field: string,
  enums: string[],
  enumAliasMap?: Record<string, string>,
  aliases?: string[],
): FieldSpec {
  return { target, field, type: 'enum', enums, enumAliasMap, aliases, sanitize: trimString }
}

export const FIELD_REGISTRY: FieldSpec[] = [
  // HARNESS-68: AI may propose new World-owned worldGroups only through the
  // registered collection adoption boundary. Owner IDs and timestamps are stamped.
  text('worldGroups', 'name', ['世界名称']),
  enumeration('worldGroups', 'type', ['traversal', 'instance', 'parallel', 'ascension', 'custom']),
  longtext('worldGroups', 'description', ['世界描述']),
  text('worldGroups', 'icon', ['世界图标']),
  num('worldGroups', 'order', ['世界顺序']),
  longtext('worldGroups', 'entryCondition', ['进入条件']),
  longtext('worldGroups', 'powerRestriction', ['能力限制']),
  num('worldGroups', 'plannedChapterCount', ['预计章节数']),

  // worldviews: legacy free-text fields still used by existing panels.
  longtext('worldviews', 'geography', ['地理']),
  longtext('worldviews', 'history', ['旧历史']),
  longtext('worldviews', 'society', ['社会']),
  longtext('worldviews', 'culture', ['文化']),
  json('worldviews', 'economy', ['货币体系', '经济']),
  longtext('worldviews', 'rules', ['旧世界规则']),

  // worldviews: v3 结构字段。summary 作为 AI 反推别名归一到 worldOrigin。
  longtext('worldviews', 'worldOrigin', ['summary', 'origin', 'worldSummary', '世界来源', '世界起源']),
  longtext('worldviews', 'powerHierarchy', ['powerSystem', 'power', '力量体系']),
  object('worldviews', 'divineDesign', ['divinity', '神明设定']),
  longtext('worldviews', 'worldStructure', ['structure', '世界结构']),
  longtext('worldviews', 'worldDimensions', ['dimensions', '世界尺寸']),
  longtext('worldviews', 'continentLayout', ['continent', 'layout', '地貌分布', '大陆分布']),
  longtext('worldviews', 'regionDimensions', ['区域面积']),
  longtext('worldviews', 'mountainsRivers', ['山川河流']),
  longtext('worldviews', 'climateByRegion', ['climate', '气候']),
  longtext('worldviews', 'naturalResourceOverview', ['自然资源概述', '自然资源全貌']),
  object('worldviews', 'naturalResources', ['resources', '自然资源']),
  longtext('worldviews', 'historyLine', ['history', 'worldHistory', '历史线']),
  longtext('worldviews', 'worldEvents', ['events', '大事记']),
  longtext('worldviews', 'races', ['species', '种族']),
  longtext('worldviews', 'factionLayout', ['factions', '势力分布']),
  longtext('worldviews', 'politicsEconomyCulture', ['politics', 'economyCulture', '政治经济文化']),
  longtext('worldviews', 'politicsOverview', ['政治概述', '政治制度概述']),
  longtext('worldviews', 'economyOverview', ['经济概述', '经济制度概述']),
  longtext('worldviews', 'cultureOverview', ['文化概述', '文化制度概述']),
  longtext('worldviews', 'internalConflicts', ['conflicts', '内部矛盾']),
  longtext('worldviews', 'itemDesign', ['items', 'artifactDesign', '道具设计']),

  // storyCores: storyLines 作为旧字段别名归一到 mainPlot。
  longtext('storyCores', 'theme', ['主题']),
  longtext('storyCores', 'centralConflict', ['conflict', '核心冲突']),
  longtext('storyCores', 'plotPattern', ['pattern', '情节模式']),
  longtext('storyCores', 'logline', ['一句话故事']),
  longtext('storyCores', 'concept', ['故事概念']),
  longtext('storyCores', 'mainPlot', ['storyLines', 'plot', '主线', '故事主线']),
  longtext('storyCores', 'subPlots', ['subplots', '复线']),

  // characters
  text('characters', 'name', ['姓名', '角色名']),
  enumeration(
    'characters',
    'role',
    ['protagonist', 'antagonist', 'supporting', 'minor', 'npc', 'extra'],
    roleAliases,
    ['定位', '角色定位'],
  ),
  enumeration(
    'characters',
    'roleWeight',
    ['main', 'secondary', 'npc', 'extra'],
    roleWeightAliases,
    ['戏份', '戏份权重', '角色权重'],
  ),
  enumeration(
    'characters',
    'moralAxis',
    ['good', 'neutral', 'evil'],
    {
      善: 'good', 善良: 'good', 正派: 'good',
      中: 'neutral', 中立: 'neutral', 绝对中立: 'neutral',
      恶: 'evil', 邪恶: 'evil', 反派: 'evil',
    },
    ['道德轴', '善恶轴'],
  ),
  enumeration(
    'characters',
    'orderAxis',
    ['lawful', 'neutral', 'chaotic'],
    {
      守序: 'lawful', 秩序: 'lawful',
      中立: 'neutral', 绝对中立: 'neutral',
      混乱: 'chaotic',
    },
    ['秩序轴', '守序混乱轴'],
  ),
  enumeration('characters', 'alignment', ['good', 'evil'], { 正派: 'good', 反派: 'evil', 善: 'good', 恶: 'evil' }, ['阵营']),
  longtext('characters', 'shortDescription', ['description', 'summary', '简介', '一句话简介']),
  longtext('characters', 'appearance', ['外貌']),
  longtext('characters', 'personality', ['性格']),
  longtext('characters', 'background', ['背景', 'backgroundStory']),
  longtext('characters', 'motivation', ['动机']),
  longtext('characters', 'abilities', ['能力']),
  longtext('characters', 'relationships', ['关系']),
  longtext('characters', 'arc', ['角色弧光', '成长线']),
  // 扩展角色维度（CHARACTER_DIMENSIONS 描述符的写权威；AI 输出经 adopt() 写回）
  longtext('characters', 'identity', ['身份', '职业', '势力', '势力归属']),
  text('characters', 'profile', ['年龄性别', '基础信息', '年龄', '性别', '种族']),
  longtext('characters', 'values', ['价值观', '信念']),
  longtext('characters', 'strengths', ['优点', '长处']),
  longtext('characters', 'weaknesses', ['缺点', '弱点', '性格弱点']),
  longtext('characters', 'fears', ['恐惧', '软肋', '逆鳞']),
  longtext('characters', 'goals', ['目标', '短期目标', '长期目标']),
  longtext('characters', 'innerConflict', ['核心矛盾', '内心冲突']),
  longtext('characters', 'keyEvents', ['关键经历', '转折事件', '重要经历']),
  text('characters', 'powerLevel', ['实力定位', '境界', '等级', '战力']),
  longtext('characters', 'speechStyle', ['语言风格', '口头禅', '说话方式']),
  longtext('characters', 'habits', ['习惯', '小动作', '癖好']),
  text('characters', 'signatureItem', ['标志性物品', '形象符号', '标志物']),
  text('characters', 'location', ['常驻地点']),
  text('characters', 'firstAppearance', ['首次出场']),
  longtext('characters', 'storyRole', ['作用', '角色作用']),
  longtext('characters', 'ending', ['结局']),
  num('characters', 'firstAppearChapterId'),
  text('characters', 'activeChapterRange'),
  num('characters', 'exitChapterId'),
  num('characters', 'homeWorldGroupId', ['worldGroupId', 'homeWorld']),
  bool('characters', 'isCrossWorld'),
  num('characters', 'raceEntryId', ['种族词条ID']),
  num('characters', 'cultivationSystemId', ['修炼体系ID', '主修体系ID']),
  text('characters', 'cultivationStageId', ['境界ID', '当前境界ID']),

  // characterRelations：AI 提取只能在作者确认后经 adopt() 写入。
  num('characterRelations', 'fromCharacterId', ['起点角色ID']),
  num('characterRelations', 'toCharacterId', ['终点角色ID']),
  enumeration(
    'characterRelations',
    'relationType',
    ['family', 'lover', 'friend', 'rival', 'enemy', 'master', 'student', 'ally', 'subordinate', 'other'],
  ),
  text('characterRelations', 'label', ['关系名']),
  longtext('characterRelations', 'description', ['关系描述']),
  bool('characterRelations', 'isBidirectional', ['双向关系']),

  // creativeRules
  longtext('creativeRules', 'writingStyle', ['style', '文风']),
  enumeration(
    'creativeRules',
    'narrativePOV',
    ['first-person', 'third-limited', 'third-omniscient', 'multi-pov'],
    { 第一人称: 'first-person', 第三人称有限: 'third-limited', 第三人称全知: 'third-omniscient', 多视角: 'multi-pov' },
    ['pov', '叙事视角'],
  ),
  longtext('creativeRules', 'atmosphere', ['toneAndMood', 'tone', '氛围', '基调']),
  json('creativeRules', 'prohibitions', ['禁止事项']),
  json('creativeRules', 'consistencyRules', ['一致性规则']),
  longtext('creativeRules', 'specialRequirements', ['特殊要求']),
  json('creativeRules', 'referenceWorksV2', ['referenceWorks', '参考作品']),
  json('creativeRules', 'citedReferenceIds'),
  json('creativeRules', 'citedInsightIds'),

  // outline / chapters / detailed outline
  text('outlineNodes', 'title', ['标题']),
  longtext('outlineNodes', 'summary', ['摘要']),
  enumeration('outlineNodes', 'type', ['volume', 'arc', 'storyBlock', 'chapter'], undefined, ['节点类型']),
  num('outlineNodes', 'parentId'),
  num('outlineNodes', 'order'),
  num('outlineNodes', 'worldGroupId'),

  text('chapters', 'title', ['标题']),
  longtext('chapters', 'content', ['正文']),
  longtext('chapters', 'summary', ['章节摘要']),
  object('chapters', 'continuityHandoff', ['章节交接记忆', '连续性交接']),
  object('chapters', 'planReconciliation', ['计划正文对账', '实际进展约束']),
  text('chapters', 'summarySourceTextHash'),
  text('chapters', 'summaryTextNormalizationVersion'),
  num('chapters', 'outlineNodeId'),
  num('chapters', 'wordCount'),
  enumeration('chapters', 'status', ['outline', 'draft', 'revised', 'polished', 'final'], chapterStatusAliases, ['状态']),
  num('chapters', 'order'),
  num('chapters', 'perspectiveCharacterId', ['叙事视角角色']),
  longtext('chapters', 'notes', ['笔记']),

  num('detailedOutlines', 'outlineNodeId'),
  // scenes 必须是数组语义：`json` 会被 adopt() JSON.stringify 成字符串 → 渲染端 .map/.reduce 崩溃（CF-2）。
  arr('detailedOutlines', 'scenes', ['场景']),
  longtext('detailedOutlines', 'openingHook'),
  longtext('detailedOutlines', 'endingCliffhanger'),
  text('detailedOutlines', 'sceneLocation'),
  arr('detailedOutlines', 'appearingCharacterIds'),
  arr('detailedOutlines', 'foreshadowIds'),
  enumeration('detailedOutlines', 'emotionArc', ['rising', 'falling', 'flat', 'wave', 'climax']),
  arr('detailedOutlines', 'prohibitions'),
  longtext('detailedOutlines', 'lastUsedSummary'),

  // AI 情感节拍候选确认后经 adopt() 定点更新当前章节卡。
  num('emotionBeatCards', 'chapterId'),
  text('emotionBeatCards', 'chapterTitle'),
  longtext('emotionBeatCards', 'overallArc'),
  json('emotionBeatCards', 'beats'),
  enumeration('emotionBeatCards', 'source', ['ai', 'manual']),

  // foreshadows / story arcs
  text('foreshadows', 'name', ['伏笔名']),
  enumeration('foreshadows', 'type', ['chekhov', 'prophecy', 'symbol', 'character', 'dialogue', 'environment', 'timeline', 'red-herring', 'parallel', 'callback'], foreshadowTypeAliases),
  enumeration('foreshadows', 'status', ['planned', 'planted', 'echoed', 'resolved'], foreshadowStatusAliases),
  longtext('foreshadows', 'description', ['描述']),
  num('foreshadows', 'plantChapterId'),
  json('foreshadows', 'echoChapterIds'),
  num('foreshadows', 'resolveChapterId'),
  longtext('foreshadows', 'notes', ['备注']),
  num('foreshadows', 'timelinePosition'),
  num('foreshadows', 'expectedResolveChapterId'),
  num('foreshadows', 'importance'),
  enumeration('foreshadows', 'urgency', ['low', 'medium', 'high', 'critical']),

  text('storyArcs', 'name', ['故事线名']),
  enumeration('storyArcs', 'type', ['main', 'sub'], { 主线: 'main', 支线: 'sub', 复线: 'sub' }),
  json('storyArcs', 'stages', ['阶段']),
  longtext('storyArcs', 'description', ['描述']),

  // Phase 39：作者确认的动态故事线投影与交汇
  num('storylineProgress', 'arcId', ['故事线ID']),
  text('storylineProgress', 'currentStageId', ['当前阶段ID']),
  enumeration('storylineProgress', 'status', ['dormant', 'active', 'climax', 'resolved', 'abandoned'], {
    休眠: 'dormant',
    活跃: 'active',
    高潮: 'climax',
    已解决: 'resolved',
    已完成: 'resolved',
    已放弃: 'abandoned',
  }),
  longtext('storylineProgress', 'progressNote', ['进度说明']),
  num('storylineProgress', 'lastActiveChapterId', ['最近活跃章节ID']),
  text('storylineProgress', 'lastActiveChapterTitle', ['最近活跃章节']),
  json('storylineProgress', 'involvedEntities', ['涉及实体']),
  longtext('storylineProgress', 'evidenceQuote', ['正文证据']),

  num('storylineCrossings', 'arcIdA', ['故事线A']),
  num('storylineCrossings', 'arcIdB', ['故事线B']),
  num('storylineCrossings', 'chapterId', ['章节ID']),
  text('storylineCrossings', 'chapterTitle', ['章节标题']),
  longtext('storylineCrossings', 'note', ['交汇说明']),
  longtext('storylineCrossings', 'evidenceQuote', ['正文证据']),

  // codex
  text('codexCategories', 'name', ['分类名']),
  enumeration('codexCategories', 'domain', ['natural', 'humanity', 'origin'], { 自然: 'natural', 自然环境: 'natural', 人文: 'humanity', 人文环境: 'humanity', 起源: 'origin', 世界起源: 'origin' }),
  num('codexCategories', 'parentId'),
  text('codexCategories', 'icon'),
  text('codexCategories', 'builtInKey'),
  json('codexCategories', 'fieldSchema'),
  bool('codexCategories', 'hidden'),
  num('codexCategories', 'order'),
  num('codexCategories', 'worldGroupId'),

  text('codexEntries', 'name', ['词条名']),
  num('codexEntries', 'categoryId'),
  text('codexEntries', 'icon'),
  longtext('codexEntries', 'summary', ['简介']),
  longtext('codexEntries', 'description', ['描述']),
  json('codexEntries', 'fields', ['字段']),
  json('codexEntries', 'refs', ['引用']),
  json('codexEntries', 'tags', ['标签']),
  num('codexEntries', 'importance', ['重要度']),
  num('codexEntries', 'cultivationSystemId', ['修炼体系ID']),
  text('codexEntries', 'cultivationStageId', ['境界ID', '当前境界ID']),
  num('codexEntries', 'importantLocationId', ['重要地点ID', '空间地点ID']),
  num('codexEntries', 'order'),
  num('codexEntries', 'worldGroupId'),

  // WORLD-1 / Phase 37 cultivationSystems
  text('cultivationSystems', 'name', ['体系名', '修炼体系']),
  longtext('cultivationSystems', 'description', ['体系描述']),
  json('cultivationSystems', 'stages', ['境界阶梯', '境界图谱']),
  num('cultivationSystems', 'worldGroupId'),

  // WORLD-1 / Phase 34 cultivationProgress
  num('cultivationProgress', 'worldGroupId'),
  num('cultivationProgress', 'characterId', ['角色ID']),
  text('cultivationProgress', 'characterName', ['角色名']),
  num('cultivationProgress', 'cultivationSystemId', ['修炼体系ID']),
  text('cultivationProgress', 'cultivationSystemName', ['修炼体系名']),
  text('cultivationProgress', 'stageId', ['境界ID']),
  text('cultivationProgress', 'stageName', ['境界名']),
  enumeration('cultivationProgress', 'transition', ['enter', 'advance', 'regress', 'switch'], {
    初次确认: 'enter',
    突破: 'advance',
    倒退: 'regress',
    改道: 'switch',
  }),
  num('cultivationProgress', 'sourceChapterId', ['来源章节ID']),
  text('cultivationProgress', 'sourceChapterTitle', ['来源章节']),
  longtext('cultivationProgress', 'sourceQuote', ['正文证据', '逐字引文']),
  num('cultivationProgress', 'sourceOffset', ['正文位置']),
  longtext('cultivationProgress', 'trigger', ['突破触发', '变化原因']),
  enumeration('cultivationProgress', 'status', ['confirmed', 'stale', 'source-missing']),

  // importantLocations / downstream extraction products
  text('importantLocations', 'name', ['地点名']),
  json('importantLocations', 'tags', ['地点标签']),
  longtext('importantLocations', 'description', ['地点描述']),
  longtext('importantLocations', 'significance', ['剧情重要性']),
  num('importantLocations', 'parentId'),
  num('importantLocations', 'sortOrder'),

  // HARNESS-66: AI map configurations may update one existing world node only.
  json('worldNodes', 'mapConfigJSON', ['地图配置']),

  text('itemLedger', 'itemName', ['物品名']),
  enumeration('itemLedger', 'action', ['gain', 'consume'], { 获得: 'gain', 消耗: 'consume', 失去: 'consume' }),
  num('itemLedger', 'quantity', ['数量']),
  text('itemLedger', 'heldByName', ['持有人', '归属', '持有者', '持有角色']),
  num('itemLedger', 'characterId', ['角色ID', '绑定角色']),
  num('itemLedger', 'chapterId'),
  text('itemLedger', 'chapterTitle', ['章节标题']),
  longtext('itemLedger', 'note', ['备注']),

  // CONSISTENCY-2 角色认知事件账本
  num('knowledgeLedger', 'worldGroupId'),
  num('knowledgeLedger', 'characterId', ['角色ID']),
  text('knowledgeLedger', 'characterName', ['角色名']),
  text('knowledgeLedger', 'knowledgeKey', ['知识Key', '知识键']),
  longtext('knowledgeLedger', 'statement', ['知识命题', '事实内容']),
  num('knowledgeLedger', 'factId', ['关联事实ID']),
  enumeration('knowledgeLedger', 'action', ['learn', 'mislearn', 'forget', 'correct'], {
    获知: 'learn',
    学会: 'learn',
    误认: 'mislearn',
    误以为: 'mislearn',
    遗忘: 'forget',
    忘记: 'forget',
    纠正: 'correct',
  }),
  longtext('knowledgeLedger', 'belief', ['错误认知', '相信内容']),
  enumeration('knowledgeLedger', 'sourceType', ['chapter', 'manual', 'import'], {
    章节: 'chapter',
    手动: 'manual',
    导入: 'import',
  }),
  num('knowledgeLedger', 'sourceChapterId', ['来源章节ID']),
  longtext('knowledgeLedger', 'sourceQuote', ['来源引文', '证据']),
  enumeration('knowledgeLedger', 'status', ['candidate', 'confirmed', 'rejected', 'source-missing', 'invalid-range']),

  text('storyTimelineEvents', 'title', ['事件标题']),
  text('storyTimelineEvents', 'storyTime', ['故事时间']),
  num('storyTimelineEvents', 'importance', ['重要度']),
  longtext('storyTimelineEvents', 'description', ['事件描述']),
  num('storyTimelineEvents', 'chapterId'),
  text('storyTimelineEvents', 'chapterTitle', ['章节标题']),
  num('storyTimelineEvents', 'order'),

  // reference analysis (AI output must use adopt; child rows are scoped through referenceId)
  text('references', 'genre'),
  num('references', 'totalChars'),
  text('references', 'fileHash'),
  num('references', 'importSessionId'),
  enumeration('references', 'analysisDepth', ['quick', 'deep']),
  enumeration('references', 'analysisStatus', ['none', 'pending', 'analyzing', 'done', 'failed']),
  num('references', 'analysisProgress'),
  longtext('references', 'analysisError'),
  longtext('references', 'analysisSummary'),
  longtext('references', 'mergedCharacters'),

  // IDEA-1 reference analysis versions. Source declaration is immutable per run;
  // AI-derived status/summary updates still pass through adopt().
  num('referenceAnalysisRuns', 'referenceId'),
  num('referenceAnalysisRuns', 'version'),
  enumeration('referenceAnalysisRuns', 'status', ['analyzing', 'ready', 'active', 'superseded', 'failed', 'cancelled']),
  enumeration('referenceAnalysisRuns', 'depth', ['quick', 'deep']),
  text('referenceAnalysisRuns', 'sourceFilename'),
  text('referenceAnalysisRuns', 'fileHash'),
  num('referenceAnalysisRuns', 'totalChars'),
  enumeration('referenceAnalysisRuns', 'sourceKind', ['own-work', 'authorized', 'public-domain', 'research', 'unknown']),
  enumeration('referenceAnalysisRuns', 'usageScope', ['analysis-only', 'creative-reference', 'continuation-authorized']),
  longtext('referenceAnalysisRuns', 'rightsNote'),
  bool('referenceAnalysisRuns', 'rightsConfirmed'),
  num('referenceAnalysisRuns', 'rightsDeclaredAt'),
  num('referenceAnalysisRuns', 'expectedChunks'),
  num('referenceAnalysisRuns', 'completedChunks'),
  num('referenceAnalysisRuns', 'progress'),
  longtext('referenceAnalysisRuns', 'error'),
  longtext('referenceAnalysisRuns', 'analysisSummary'),
  longtext('referenceAnalysisRuns', 'mergedCharacters'),
  num('referenceAnalysisRuns', 'completedAt'),
  num('referenceAnalysisRuns', 'activatedAt'),

  // CM-1 incremental inspiration workspace (bounded JSON strings)
  json('inspirationWorkspaces', 'fragments'),
  json('inspirationWorkspaces', 'versions'),

  // STORY-1: AI 只能定点更新既有角色驱动方案的候选结果，不能创建或改写方案输入。
  json('characterDrivenPlans', 'generatedVolumes'),
  enumeration('characterDrivenPlans', 'status', ['draft', 'generated', 'adopted']),

  num('referenceChunkAnalysis', 'referenceId'),
  num('referenceChunkAnalysis', 'analysisRunId'),
  num('referenceChunkAnalysis', 'chunkIndex'),
  text('referenceChunkAnalysis', 'label'),
  num('referenceChunkAnalysis', 'startOffset'),
  num('referenceChunkAnalysis', 'endOffset'),
  longtext('referenceChunkAnalysis', 'narrativeStyle'),
  longtext('referenceChunkAnalysis', 'openingTechnique'),
  longtext('referenceChunkAnalysis', 'plotStructure'),
  longtext('referenceChunkAnalysis', 'pacingControl'),
  longtext('referenceChunkAnalysis', 'climaxDesign'),
  longtext('referenceChunkAnalysis', 'conflictEscalation'),
  longtext('referenceChunkAnalysis', 'characterCraft'),
  longtext('referenceChunkAnalysis', 'dialogueTechnique'),
  longtext('referenceChunkAnalysis', 'proseStyle'),
  longtext('referenceChunkAnalysis', 'emotionalBeats'),
  longtext('referenceChunkAnalysis', 'foreshadowing'),
  longtext('referenceChunkAnalysis', 'worldBuilding'),
  longtext('referenceChunkAnalysis', 'otherTechniques'),
  longtext('referenceChunkAnalysis', 'historicalContext'),
  longtext('referenceChunkAnalysis', 'socialInstitutions'),
  longtext('referenceChunkAnalysis', 'dailyLife'),
  longtext('referenceChunkAnalysis', 'materialCulture'),
  longtext('referenceChunkAnalysis', 'languageCustoms'),
  longtext('referenceChunkAnalysis', 'rawExcerpt'),

  // historical dual-agent results (recordId-only adoption; see ADOPTION_SCHEMAS)
  longtext('historicalTimelineEvents', 'aiConsult'),
  longtext('historicalTimelineEvents', 'aiBrainstorm'),
  longtext('historicalKeywords', 'aiConsult'),
  longtext('historicalKeywords', 'aiBrainstorm'),

  // HARNESS-76: durable style learning may replace only the generated profile
  // and its deterministic sampling receipt. Revision pairs and calibration
  // feedback remain explicit author actions outside this AI write boundary.
  longtext('userStyleProfiles', 'profile'),
  bool('userStyleProfiles', 'enabled'),
  json('userStyleProfiles', 'sourceChapterIds'),
  num('userStyleProfiles', 'sampleCount'),
  num('userStyleProfiles', 'sampleWords'),

  enumeration('stateCards', 'category', ['character', 'location', 'item', 'faction', 'event']),
  text('stateCards', 'entityName', ['角色名', '实体名']),
  json('stateCards', 'fields', ['状态字段']),
  num('stateCards', 'lastChapterId'),
]

export const FIELD_BY_TARGET: ReadonlyMap<string, FieldSpec[]> = new Map(
  Array.from(new Set(FIELD_REGISTRY.map(f => f.target))).map(target => [
    target,
    FIELD_REGISTRY.filter(f => f.target === target),
  ]),
)
