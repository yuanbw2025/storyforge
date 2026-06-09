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
  json('worldviews', 'divineDesign', ['divinity', '神明设定']),
  longtext('worldviews', 'worldStructure', ['structure', '世界结构']),
  longtext('worldviews', 'worldDimensions', ['dimensions', '世界尺寸']),
  longtext('worldviews', 'continentLayout', ['continent', 'layout', '地貌分布', '大陆分布']),
  longtext('worldviews', 'regionDimensions', ['区域面积']),
  longtext('worldviews', 'mountainsRivers', ['山川河流']),
  longtext('worldviews', 'climateByRegion', ['climate', '气候']),
  json('worldviews', 'naturalResources', ['resources', '自然资源']),
  longtext('worldviews', 'historyLine', ['history', 'worldHistory', '历史线']),
  longtext('worldviews', 'worldEvents', ['events', '大事记']),
  longtext('worldviews', 'races', ['species', '种族']),
  longtext('worldviews', 'factionLayout', ['factions', '势力分布']),
  longtext('worldviews', 'politicsEconomyCulture', ['politics', 'economyCulture', '政治经济文化']),
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
  enumeration('characters', 'alignment', ['good', 'evil'], { 正派: 'good', 反派: 'evil', 善: 'good', 恶: 'evil' }, ['阵营']),
  longtext('characters', 'shortDescription', ['description', 'summary', '简介', '一句话简介']),
  longtext('characters', 'appearance', ['外貌']),
  longtext('characters', 'personality', ['性格']),
  longtext('characters', 'background', ['背景', 'backgroundStory']),
  longtext('characters', 'motivation', ['动机']),
  longtext('characters', 'abilities', ['能力']),
  longtext('characters', 'relationships', ['关系']),
  longtext('characters', 'arc', ['角色弧光', '成长线']),
  text('characters', 'location', ['常驻地点']),
  text('characters', 'firstAppearance', ['首次出场']),
  longtext('characters', 'storyRole', ['作用', '角色作用']),
  longtext('characters', 'ending', ['结局']),
  num('characters', 'firstAppearChapterId'),
  text('characters', 'activeChapterRange'),
  num('characters', 'exitChapterId'),
  num('characters', 'homeWorldGroupId', ['worldGroupId', 'homeWorld']),
  bool('characters', 'isCrossWorld'),

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
  num('chapters', 'outlineNodeId'),
  num('chapters', 'wordCount'),
  enumeration('chapters', 'status', ['outline', 'draft', 'revised', 'polished', 'final'], chapterStatusAliases, ['状态']),
  num('chapters', 'order'),
  longtext('chapters', 'notes', ['笔记']),

  num('detailedOutlines', 'outlineNodeId'),
  json('detailedOutlines', 'scenes', ['场景']),
  longtext('detailedOutlines', 'openingHook'),
  longtext('detailedOutlines', 'endingCliffhanger'),
  text('detailedOutlines', 'sceneLocation'),
  arr('detailedOutlines', 'appearingCharacterIds'),
  arr('detailedOutlines', 'foreshadowIds'),
  enumeration('detailedOutlines', 'emotionArc', ['rising', 'falling', 'flat', 'wave', 'climax']),
  longtext('detailedOutlines', 'lastUsedSummary'),

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

  // codex
  text('codexCategories', 'name', ['分类名']),
  enumeration('codexCategories', 'domain', ['natural', 'humanity'], { 自然: 'natural', 自然环境: 'natural', 人文: 'humanity', 人文环境: 'humanity' }),
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
  num('codexEntries', 'order'),
  num('codexEntries', 'worldGroupId'),
]

export const FIELD_BY_TARGET: ReadonlyMap<string, FieldSpec[]> = new Map(
  Array.from(new Set(FIELD_REGISTRY.map(f => f.target))).map(target => [
    target,
    FIELD_REGISTRY.filter(f => f.target === target),
  ]),
)
