import { CHARACTER_DIMENSIONS } from '../character/character-dimensions'
import type { PromptModuleKey } from '../types/prompt'
import type {
  AuthoringNodeTemplate,
  AuthoringParameterDefinition,
  AuthoringPortDefinition,
  AuthoringSemantic,
  AuthoringWriteContract,
} from './contracts'

type FieldTemplateInput = {
  id: string
  label: string
  description: string
  category: string
  target: string
  field: string
  sourceKey: string
  semantic: AuthoringSemantic
  promptModuleKey: PromptModuleKey
  recommendedBefore?: string[]
  recommendedAfter?: string[]
}

const contextInput = (): AuthoringPortDefinition => ({
  id: 'context',
  label: '创作依据',
  semantic: 'any',
  cardinality: 'many',
  state: 'any',
  required: false,
  multiple: true,
  priority: 50,
  maxTokens: 12_000,
})

const optionalControl = (
  id: string,
  label: string,
  semantic: AuthoringSemantic,
): AuthoringPortDefinition => ({
  id,
  label,
  semantic,
  cardinality: 'one',
  state: 'control',
  required: false,
})

const generationInputs = (): AuthoringPortDefinition[] => [
  contextInput(),
  optionalControl('ai-profile', 'AI 配置', 'control.ai-profile'),
  optionalControl('prompt', 'Prompt 模板', 'control.prompt'),
  optionalControl('temperature', '温度', 'control.temperature'),
  optionalControl('max-tokens', '最大输出 Tokens', 'control.max-tokens'),
  optionalControl('word-count', '期望字数', 'control.word-count'),
  optionalControl('context-budget', '上下文预算', 'control.context-budget'),
  optionalControl('candidate-count', '候选数量', 'control.count'),
]

const candidateOutput = (
  semantic: AuthoringSemantic,
  cardinality: 'one' | 'many' = 'one',
): AuthoringPortDefinition => ({
  id: 'candidate',
  label: '候选内容',
  semantic,
  cardinality,
  state: 'candidate',
})

function fieldTemplate(input: FieldTemplateInput): AuthoringNodeTemplate {
  return {
    id: input.id,
    version: 1,
    label: input.label,
    description: input.description,
    category: input.category,
    class: 'content',
    capability: 'generate-field',
    inputs: generationInputs(),
    outputs: [candidateOutput(input.semantic)],
    reads: { sourceKeys: [input.sourceKey], allowExactFields: true },
    writes: { target: input.target, fields: [input.field], mode: 'replace' },
    promptModuleKey: input.promptModuleKey,
    recommendedBefore: input.recommendedBefore,
    recommendedAfter: input.recommendedAfter,
  }
}

function collectionTemplate(input: {
  id: string
  label: string
  description: string
  category: string
  semantic: AuthoringSemantic
  cardinality?: 'one' | 'many'
  sourceKeys: string[]
  writes?: AuthoringWriteContract
  promptModuleKey: PromptModuleKey
  extraInputs?: AuthoringPortDefinition[]
  parameters?: AuthoringParameterDefinition[]
  recommendedBefore?: string[]
  recommendedAfter?: string[]
}): AuthoringNodeTemplate {
  return {
    id: input.id,
    version: 1,
    label: input.label,
    description: input.description,
    category: input.category,
    class: 'content',
    capability: 'generate-collection',
    inputs: [...generationInputs(), ...(input.extraInputs ?? [])],
    outputs: [candidateOutput(input.semantic, input.cardinality)],
    reads: { sourceKeys: input.sourceKeys, allowExactFields: true },
    writes: input.writes,
    promptModuleKey: input.promptModuleKey,
    parameters: input.parameters,
    recommendedBefore: input.recommendedBefore,
    recommendedAfter: input.recommendedAfter,
  }
}

const WORLD_FIELDS: FieldTemplateInput[] = [
  { id: 'world.origin', label: '世界来源', description: '世界、文明或时代从何而来。', category: '世界观/起源', target: 'worldviews', field: 'worldOrigin', sourceKey: 'worldview', semantic: 'world.setting', promptModuleKey: 'worldview.dimension', recommendedAfter: ['story.concept', 'world.structure'] },
  { id: 'world.power', label: '力量体系', description: '力量来源、层级、规则与限制。', category: '世界观/起源', target: 'worldviews', field: 'powerHierarchy', sourceKey: 'worldview', semantic: 'world.rule', promptModuleKey: 'worldview.dimension' },
  { id: 'world.divinity', label: '神明与信仰', description: '神明、宗教、权柄与信仰边界。', category: '世界观/起源', target: 'worldviews', field: 'divineDesign', sourceKey: 'worldview', semantic: 'world.rule', promptModuleKey: 'worldview.dimension' },
  { id: 'world.structure', label: '世界结构', description: '星球、大陆、位面与空间层级。', category: '世界观/自然', target: 'worldviews', field: 'worldStructure', sourceKey: 'worldview', semantic: 'world.setting', promptModuleKey: 'worldview.dimension', recommendedAfter: ['world.dimensions', 'world.terrain'] },
  { id: 'world.dimensions', label: '疆域尺寸', description: '世界与核心区域的范围和尺度。', category: '世界观/自然', target: 'worldviews', field: 'worldDimensions', sourceKey: 'worldview', semantic: 'world.setting', promptModuleKey: 'worldview.dimension' },
  { id: 'world.terrain', label: '地貌分布', description: '大陆、山脉、平原和盆地的分布。', category: '世界观/自然', target: 'worldviews', field: 'continentLayout', sourceKey: 'worldview', semantic: 'world.location', promptModuleKey: 'worldview.dimension', recommendedAfter: ['world.waterways', 'world.climate', 'entity.location'] },
  { id: 'world.region-size', label: '行政区域与城池', description: '区域面积、行政层级与核心城池。', category: '世界观/人文', target: 'worldviews', field: 'regionDimensions', sourceKey: 'worldview', semantic: 'world.location', promptModuleKey: 'worldview.dimension' },
  { id: 'world.waterways', label: '山川水系', description: '山脉、河流、湖泊、运河和水路。', category: '世界观/自然', target: 'worldviews', field: 'mountainsRivers', sourceKey: 'worldview', semantic: 'world.location', promptModuleKey: 'worldview.dimension' },
  { id: 'world.climate', label: '气候环境', description: '区域气候、季节与自然灾害。', category: '世界观/自然', target: 'worldviews', field: 'climateByRegion', sourceKey: 'worldview', semantic: 'world.setting', promptModuleKey: 'worldview.dimension' },
  { id: 'world.resources-overview', label: '自然资源', description: '资源分布、丰饶程度与总体特点。', category: '世界观/自然', target: 'worldviews', field: 'naturalResourceOverview', sourceKey: 'worldview', semantic: 'world.setting', promptModuleKey: 'worldview.dimension' },
  { id: 'world.resources-detail', label: '自然资源细分', description: '异兽、作物、药材、矿产和特产。', category: '世界观/自然', target: 'worldviews', field: 'naturalResources', sourceKey: 'worldview', semantic: 'world.setting', promptModuleKey: 'worldview.dimension' },
  { id: 'world.history', label: '世界历史线', description: '王朝、文明、灾变与关键时代。', category: '世界观/历史', target: 'worldviews', field: 'historyLine', sourceKey: 'historical', semantic: 'world.history', promptModuleKey: 'worldview.dimension' },
  { id: 'world.events', label: '世界大事记', description: '对当前世界有长期影响的重大事件。', category: '世界观/历史', target: 'worldviews', field: 'worldEvents', sourceKey: 'historical', semantic: 'world.history', promptModuleKey: 'worldview.dimension' },
  { id: 'world.races', label: '种族与民族', description: '人群特征、历史、能力与关系。', category: '世界观/人文', target: 'worldviews', field: 'races', sourceKey: 'worldview', semantic: 'world.setting', promptModuleKey: 'worldview.dimension' },
  { id: 'world.factions', label: '势力分布', description: '国家、门派、组织和阵营格局。', category: '世界观/人文', target: 'worldviews', field: 'factionLayout', sourceKey: 'worldview', semantic: 'world.setting', promptModuleKey: 'worldview.dimension', recommendedAfter: ['story.conflict', 'character.profile'] },
  { id: 'world.politics', label: '政治制度', description: '政体、官制、法律、军事与外交。', category: '世界观/人文', target: 'worldviews', field: 'politicsOverview', sourceKey: 'worldview', semantic: 'world.setting', promptModuleKey: 'worldview.dimension' },
  { id: 'world.economy', label: '经济制度', description: '货币、税赋、贸易、产业和资源分配。', category: '世界观/人文', target: 'worldviews', field: 'economyOverview', sourceKey: 'worldview', semantic: 'world.setting', promptModuleKey: 'worldview.dimension' },
  { id: 'world.culture', label: '文化制度', description: '语言、教育、礼仪、节庆、艺术和禁忌。', category: '世界观/人文', target: 'worldviews', field: 'cultureOverview', sourceKey: 'worldview', semantic: 'world.setting', promptModuleKey: 'worldview.dimension' },
  { id: 'world.conflicts', label: '社会矛盾', description: '阶层、制度、族群与外部冲突。', category: '世界观/人文', target: 'worldviews', field: 'internalConflicts', sourceKey: 'worldview', semantic: 'story.conflict', promptModuleKey: 'worldview.dimension', recommendedAfter: ['story.conflict', 'story.main-plot'] },
  { id: 'world.items', label: '道具与器物体系', description: '武器、法器、工具和科技装备的规则。', category: '世界观/人文', target: 'worldviews', field: 'itemDesign', sourceKey: 'worldview', semantic: 'world.setting', promptModuleKey: 'worldview.dimension' },
]

const STORY_FIELDS: FieldTemplateInput[] = [
  { id: 'story.logline', label: '一句话故事', description: '用一句话概括主角、目标、阻力与结果方向。', category: '故事设计', target: 'storyCores', field: 'logline', sourceKey: 'storyCore', semantic: 'text', promptModuleKey: 'story.core' },
  { id: 'story.concept', label: '故事概念', description: '作品最核心的独特设定或反差。', category: '故事设计', target: 'storyCores', field: 'concept', sourceKey: 'storyCore', semantic: 'story.theme', promptModuleKey: 'story.core', recommendedBefore: ['world.origin'], recommendedAfter: ['story.theme', 'story.conflict'] },
  { id: 'story.theme', label: '故事主题', description: '作品要探讨的人性与价值命题。', category: '故事设计', target: 'storyCores', field: 'theme', sourceKey: 'storyCore', semantic: 'story.theme', promptModuleKey: 'story.core', recommendedAfter: ['story.conflict', 'outline.volume'] },
  { id: 'story.conflict', label: '核心冲突', description: '主角面对的外在和内在矛盾。', category: '故事设计', target: 'storyCores', field: 'centralConflict', sourceKey: 'storyCore', semantic: 'story.conflict', promptModuleKey: 'story.core', recommendedAfter: ['story.main-plot', 'character.profile'] },
  { id: 'story.pattern', label: '故事模式', description: '线性、多线、单元剧或其它结构方式。', category: '故事设计', target: 'storyCores', field: 'plotPattern', sourceKey: 'storyCore', semantic: 'story.arc', promptModuleKey: 'story.core' },
  { id: 'story.main-plot', label: '故事主线', description: '主要目标、阻碍、升级和结局方向。', category: '故事设计', target: 'storyCores', field: 'mainPlot', sourceKey: 'storyCore', semantic: 'story.arc', promptModuleKey: 'story.core', recommendedAfter: ['outline.volume'] },
  { id: 'story.sub-plots', label: '故事复线', description: '感情线、角色线、阵营线和暗线。', category: '故事设计', target: 'storyCores', field: 'subPlots', sourceKey: 'storyCore', semantic: 'story.arc', promptModuleKey: 'story.core', recommendedAfter: ['story.arc'] },
]

const CHARACTER_FIELD_TEMPLATES = CHARACTER_DIMENSIONS.map(dimension => fieldTemplate({
  id: `character.field.${dimension.key}`,
  label: dimension.label,
  description: `角色维度：${dimension.group}。`,
  category: `角色/${dimension.group}`,
  target: 'characters',
  field: dimension.key,
  sourceKey: 'characters',
  semantic: 'character.profile',
  promptModuleKey: 'character.dimension',
  recommendedBefore: ['character.profile'],
}))

const CONTENT_TEMPLATES: AuthoringNodeTemplate[] = [
  ...WORLD_FIELDS.map(fieldTemplate),
  ...STORY_FIELDS.map(fieldTemplate),
  ...CHARACTER_FIELD_TEMPLATES,
  collectionTemplate({
    id: 'character.profile',
    label: '角色档案',
    description: '创建或补全主要角色、次要角色、NPC 与路人。',
    category: '角色/主体',
    semantic: 'character.profile',
    sourceKeys: ['characters', 'worldview', 'storyCore'],
    writes: { target: 'characters', mode: 'add' },
    promptModuleKey: 'character.generate',
    parameters: [{ key: 'request', label: '生成要求', type: 'text', defaultValue: '' }],
    recommendedBefore: ['world.factions', 'story.conflict'],
    recommendedAfter: ['character.field.motivation', 'character.relation', 'outline.volume'],
  }),
  collectionTemplate({
    id: 'entity.location',
    label: '重要地点',
    description: '城市、区域、建筑、秘境或其它地点实体。',
    category: '世界观/地理实体',
    semantic: 'world.location',
    sourceKeys: ['locations', 'worldview'],
    writes: { target: 'importantLocations', mode: 'add' },
    promptModuleKey: 'worldview.worldbuilding',
  }),
  collectionTemplate({
    id: 'story.arc',
    label: '故事线',
    description: '主线、支线及其阶段。',
    category: '故事设计/故事线',
    semantic: 'story.arc',
    sourceKeys: ['storyArcs', 'storyCore', 'characters'],
    writes: { target: 'storyArcs', mode: 'add' },
    promptModuleKey: 'outline.plot',
    recommendedAfter: ['outline.volume'],
  }),
  collectionTemplate({
    id: 'character.relation',
    label: '角色关系',
    description: '两个角色之间的关系类型、描述与方向。',
    category: '角色/关系',
    semantic: 'character.relation',
    sourceKeys: ['characterRelations', 'characters'],
    writes: { target: 'characterRelations', mode: 'add' },
    promptModuleKey: 'relation.extract',
  }),
  collectionTemplate({
    id: 'outline.volume',
    label: '卷纲',
    description: '生成或维护全书卷级结构。',
    category: '大纲',
    semantic: 'outline.volume',
    cardinality: 'many',
    sourceKeys: ['worldview', 'storyCore', 'characters', 'storyArcs', 'existingVolumeOutlines'],
    writes: { target: 'outlineNodes', mode: 'add-many' },
    promptModuleKey: 'outline.volume',
    parameters: [{ key: 'request', label: '生成要求', type: 'text', defaultValue: '' }],
    extraInputs: [optionalControl('volume-count', '卷数', 'control.volume-count')],
    recommendedAfter: ['outline.chapter'],
  }),
  collectionTemplate({
    id: 'outline.chapter',
    label: '章节大纲',
    description: '为卷生成章节结构和章纲摘要。',
    category: '大纲',
    semantic: 'outline.chapter',
    cardinality: 'many',
    sourceKeys: ['worldview', 'storyCore', 'characters', 'storyArcs', 'existingVolumeOutlines'],
    writes: { target: 'outlineNodes', mode: 'add-many' },
    promptModuleKey: 'outline.chapter',
    parameters: [
      { key: 'request', label: '生成要求', type: 'text', defaultValue: '' },
      { key: 'volumeTitle', label: '所属卷标题', type: 'text', defaultValue: '' },
    ],
    extraInputs: [
      { id: 'volume', label: '所属卷候选', semantic: 'outline.volume', cardinality: 'many', state: 'any', required: true },
      optionalControl('chapter-count', '章节数', 'control.chapter-count'),
    ],
    recommendedAfter: ['outline.plan', 'chapter.prose'],
  }),
  collectionTemplate({
    id: 'outline.plan',
    label: '章节细纲',
    description: '场景、人物、伏笔、开篇钩子与结尾悬念。',
    category: '大纲/细纲',
    semantic: 'outline.plan',
    sourceKeys: ['chapterOutline', 'detailedOutline', 'characters', 'foreshadows'],
    writes: { target: 'detailedOutlines', mode: 'replace' },
    promptModuleKey: 'detail.chapter-planning',
    parameters: [
      { key: 'request', label: '生成要求', type: 'text', defaultValue: '' },
      { key: 'chapterTitle', label: '目标章节标题', type: 'text', defaultValue: '' },
    ],
    extraInputs: [{ id: 'chapter', label: '章节候选', semantic: 'outline.chapter', cardinality: 'many', state: 'any', required: true }],
    recommendedAfter: ['chapter.prose'],
  }),
  collectionTemplate({
    id: 'chapter.prose',
    label: '章节正文',
    description: '根据章纲和明确上游设定生成正文候选。',
    category: '正文',
    semantic: 'chapter.prose',
    sourceKeys: ['chapterOutline', 'detailedOutline', 'worldview', 'storyCore', 'characters', 'creativeRules', 'foreshadows', 'retrievedPassages'],
    writes: { target: 'chapters', fields: ['content'], mode: 'replace' },
    promptModuleKey: 'chapter.content',
    parameters: [
      { key: 'request', label: '生成要求', type: 'text', defaultValue: '' },
      { key: 'chapterTitle', label: '目标章节标题', type: 'text', defaultValue: '' },
    ],
    extraInputs: [{ id: 'plan', label: '章节计划', semantic: 'outline.plan', cardinality: 'one', state: 'any', required: false }],
    recommendedAfter: ['chapter.organize'],
  }),
  collectionTemplate({
    id: 'continuity.foreshadow',
    label: '伏笔',
    description: '设计、埋设、呼应和回收叙事承诺。',
    category: '连续性',
    semantic: 'continuity.foreshadow',
    sourceKeys: ['foreshadows', 'outlineTree', 'storyCore', 'chapterContent'],
    writes: { target: 'foreshadows', mode: 'add' },
    promptModuleKey: 'foreshadow.generate',
    parameters: [
      { key: 'request', label: '整理要求', type: 'text', defaultValue: '' },
      { key: 'chapterTitle', label: '目标章节标题', type: 'text', defaultValue: '' },
    ],
  }),
]

/**
 * FLOW-3D 连续性节点目录。
 *
 * 这些节点只描述编排契约；正文、事实账本、认知账本和事件流水仍由各自
 * 的既有 parser / adoption extension 写回，避免在节点层复制第二套 Canon。
 */
const CONTINUITY_TEMPLATES: AuthoringNodeTemplate[] = [
  collectionTemplate({
    id: 'continuity.storyline',
    label: '故事线',
    description: '登记主线、支线及其阶段，并观察章节对故事线的推进。',
    category: '连续性/故事线',
    semantic: 'story.arc',
    sourceKeys: ['storyArcs', 'storyCore', 'characters', 'outlineTree', 'chapterContent'],
    writes: { target: 'storyArcs', mode: 'add' },
    promptModuleKey: 'outline.plot',
    parameters: [
      { key: 'request', label: '故事线要求', type: 'text', defaultValue: '' },
      { key: 'chapterTitle', label: '参考章节标题', type: 'text', defaultValue: '' },
    ],
    recommendedAfter: ['outline.volume', 'chapter.organize'],
  }),
  collectionTemplate({
    id: 'continuity.location',
    label: '地点',
    description: '创建地点实体，补充地点关系和章节中的地理连续性。',
    category: '连续性/世界状态',
    semantic: 'continuity.location',
    sourceKeys: ['locations', 'worldview', 'chapterContent', 'outlineTree'],
    writes: { target: 'importantLocations', mode: 'add' },
    promptModuleKey: 'worldview.worldbuilding',
    parameters: [
      { key: 'request', label: '地点要求', type: 'text', defaultValue: '' },
      { key: 'chapterTitle', label: '参考章节标题', type: 'text', defaultValue: '' },
    ],
    recommendedAfter: ['world.terrain', 'chapter.organize'],
  }),
  collectionTemplate({
    id: 'continuity.state',
    label: '状态',
    description: '建立或更新角色、地点、物品和势力的状态卡。',
    category: '连续性/世界状态',
    semantic: 'continuity.state',
    sourceKeys: ['stateCards', 'currentFacts', 'characters', 'locations', 'chapterContent'],
    writes: { target: 'stateCards', mode: 'add' },
    promptModuleKey: 'chapter.continuity',
    parameters: [
      { key: 'request', label: '状态要求', type: 'text', defaultValue: '' },
      { key: 'chapterTitle', label: '参考章节标题', type: 'text', defaultValue: '' },
    ],
    recommendedAfter: ['character.profile', 'continuity.location', 'chapter.organize'],
  }),
  collectionTemplate({
    id: 'continuity.item',
    label: '物品流水',
    description: '记录角色获得、消耗和转移物品的事件，保留章节证据。',
    category: '连续性/世界状态',
    semantic: 'continuity.item',
    sourceKeys: ['itemLedger', 'characters', 'chapterContent', 'heldItems'],
    writes: { target: 'itemLedger', mode: 'add-many' },
    promptModuleKey: 'inventory.extract',
    parameters: [
      { key: 'request', label: '物品整理要求', type: 'text', defaultValue: '' },
      { key: 'chapterTitle', label: '目标章节标题', type: 'text', defaultValue: '' },
    ],
    recommendedAfter: ['chapter.prose', 'chapter.organize'],
  }),
  collectionTemplate({
    id: 'continuity.fact',
    label: '事实',
    description: '从正文抽取受控谓词事实，先作为候选等待作者确认。',
    category: '连续性/世界状态',
    semantic: 'continuity.fact',
    sourceKeys: ['currentFacts', 'canonAssertions', 'characters', 'locations', 'chapterContent'],
    promptModuleKey: 'chapter.continuity',
    parameters: [
      { key: 'request', label: '事实整理要求', type: 'text', defaultValue: '' },
      { key: 'chapterTitle', label: '目标章节标题', type: 'text', defaultValue: '' },
    ],
    recommendedAfter: ['chapter.prose', 'chapter.organize'],
  }),
  collectionTemplate({
    id: 'continuity.knowledge',
    label: '角色认知',
    description: '记录角色在章节中的获知、误知、遗忘和纠正。',
    category: '连续性/角色状态',
    semantic: 'continuity.knowledge',
    sourceKeys: ['characterKnowledge', 'currentFacts', 'characters', 'chapterContent'],
    writes: { target: 'knowledgeLedger', mode: 'add-many' },
    promptModuleKey: 'chapter.continuity',
    parameters: [
      { key: 'request', label: '认知整理要求', type: 'text', defaultValue: '' },
      { key: 'chapterTitle', label: '目标章节标题', type: 'text', defaultValue: '' },
    ],
    recommendedAfter: ['chapter.prose', 'chapter.organize'],
  }),
  collectionTemplate({
    id: 'continuity.timeline',
    label: '故事年表',
    description: '抽取改变剧情进程的关键事件并按章节保留来源。',
    category: '连续性/时间线',
    semantic: 'continuity.timeline',
    sourceKeys: ['storyTimeline', 'storyArcs', 'chapterContent', 'outlineTree'],
    writes: { target: 'storyTimelineEvents', mode: 'add-many' },
    promptModuleKey: 'story-timeline.extract',
    parameters: [
      { key: 'request', label: '年表整理要求', type: 'text', defaultValue: '' },
      { key: 'chapterTitle', label: '目标章节标题', type: 'text', defaultValue: '' },
    ],
    recommendedAfter: ['chapter.prose', 'chapter.organize'],
  }),
  {
    id: 'chapter.organize',
    version: 1,
    label: '整理本章',
    description: '从已确认正文一次生成状态、事实、物品、年表、关系和伏笔六域候选。',
    category: '连续性/写后整理',
    class: 'content',
    capability: 'generate-collection',
    inputs: [
      ...generationInputs(),
      { id: 'chapter', label: '目标章节', semantic: 'chapter.prose', cardinality: 'one', state: 'any', required: true },
    ],
    outputs: [{ id: 'candidate', label: '六域候选', semantic: 'continuity.report', cardinality: 'one', state: 'candidate' }],
    reads: {
      sourceKeys: [
        'chapterContent', 'stateCards', 'currentFacts', 'characters', 'itemLedger',
        'characterRelations', 'foreshadows', 'storyTimeline', 'storyArcs',
        'storylineProgress', 'characterKnowledge', 'previousChapterEnding',
        'chapterContinuityHandoff', 'recentChapterSummaries', 'consistencyDossier', 'retrievedPassages',
      ],
      allowExactFields: true,
    },
    promptModuleKey: 'chapter.continuity',
    parameters: [
      { key: 'chapterTitle', label: '目标章节标题', type: 'text', defaultValue: '' },
    ],
    recommendedAfter: ['continuity.state', 'continuity.fact', 'continuity.item', 'continuity.timeline', 'continuity.knowledge', 'continuity.foreshadow'],
  },
]

const CONTINUITY_CONTEXT_TEMPLATES: AuthoringNodeTemplate[] = [
  {
    id: 'context.previous-ending',
    version: 1,
    label: '前章结尾',
    description: '只读读取目标章节之前一章的正文尾部。',
    category: '连续性/只读上下文',
    class: 'content',
    capability: 'read-canon',
    inputs: [],
    outputs: [{ id: 'context', label: '前章结尾', semantic: 'text', cardinality: 'one', state: 'canon' }],
    reads: { sourceKeys: ['previousChapterEnding'] },
    parameters: [{ key: 'chapterTitle', label: '目标章节标题', type: 'text', defaultValue: '' }],
  },
  {
    id: 'context.handoff',
    version: 1,
    label: '连续性交接',
    description: '只读读取目标章节的前章 handoff 和计划对账。',
    category: '连续性/只读上下文',
    class: 'content',
    capability: 'read-canon',
    inputs: [],
    outputs: [{ id: 'context', label: '连续性交接', semantic: 'text', cardinality: 'one', state: 'canon' }],
    reads: { sourceKeys: ['chapterContinuityHandoff', 'previousPlanReconciliation'] },
    parameters: [{ key: 'chapterTitle', label: '目标章节标题', type: 'text', defaultValue: '' }],
  },
  {
    id: 'context.recent-summaries',
    version: 1,
    label: '最近摘要',
    description: '只读读取当前世界最近已验证的章节摘要。',
    category: '连续性/只读上下文',
    class: 'content',
    capability: 'read-canon',
    inputs: [],
    outputs: [{ id: 'context', label: '最近摘要', semantic: 'text', cardinality: 'many', state: 'canon' }],
    reads: { sourceKeys: ['recentChapterSummaries'] },
    parameters: [{ key: 'chapterTitle', label: '目标章节标题', type: 'text', defaultValue: '' }],
  },
  {
    id: 'context.related-passages',
    version: 1,
    label: '相关前文',
    description: '只读读取与目标章节相关的前文检索片段。',
    category: '连续性/只读上下文',
    class: 'content',
    capability: 'read-canon',
    inputs: [],
    outputs: [{ id: 'context', label: '相关前文', semantic: 'text', cardinality: 'many', state: 'canon' }],
    reads: { sourceKeys: ['retrievedPassages'] },
    parameters: [{ key: 'chapterTitle', label: '目标章节标题', type: 'text', defaultValue: '' }],
  },
  {
    id: 'context.consistency-report',
    version: 1,
    label: '一致性报告',
    description: '只读读取当前章节已有的一致性检查结果和影响提示。',
    category: '连续性/只读上下文',
    class: 'content',
    capability: 'read-canon',
    inputs: [],
    outputs: [{ id: 'context', label: '一致性报告', semantic: 'continuity.report', cardinality: 'many', state: 'canon' }],
    reads: { sourceKeys: ['consistencyReport'] },
    parameters: [{ key: 'chapterTitle', label: '目标章节标题', type: 'text', defaultValue: '' }],
  },
]

function controlTemplate(input: {
  id: string
  label: string
  description: string
  semantic: AuthoringSemantic
  parameter: AuthoringParameterDefinition
}): AuthoringNodeTemplate {
  return {
    id: input.id,
    version: 1,
    label: input.label,
    description: input.description,
    category: '执行控制',
    class: 'control',
    capability: 'manual-draft',
    inputs: [],
    outputs: [{ id: 'value', label: input.label, semantic: input.semantic, cardinality: 'one', state: 'control' }],
    parameters: [input.parameter],
  }
}

const CONTROL_TEMPLATES: AuthoringNodeTemplate[] = [
  controlTemplate({ id: 'control.ai-profile', label: 'AI 配置档案', description: '引用一个现有 AI preset，不保存 API Key。', semantic: 'control.ai-profile', parameter: { key: 'presetId', label: '配置档案', type: 'select', options: [], defaultValue: '' } }),
  controlTemplate({ id: 'control.prompt', label: 'Prompt 模板', description: '引用现有 Prompt 模板和本次补充说明。', semantic: 'control.prompt', parameter: { key: 'templateId', label: 'Prompt 模板', type: 'text', defaultValue: '' } }),
  controlTemplate({ id: 'control.temperature', label: '温度', description: '控制生成随机性，最终范围由 provider 归一。', semantic: 'control.temperature', parameter: { key: 'value', label: '温度', type: 'number', min: 0, max: 2, step: 0.1, defaultValue: 0.7 } }),
  controlTemplate({ id: 'control.max-tokens', label: '最大输出 Tokens', description: '限制模型单次最大输出。', semantic: 'control.max-tokens', parameter: { key: 'value', label: 'Tokens', type: 'number', min: 100, max: 128_000, step: 100, defaultValue: 6000 } }),
  controlTemplate({ id: 'control.word-count', label: '期望字数', description: '创作目标字数，不冒充精确 token 换算。', semantic: 'control.word-count', parameter: { key: 'value', label: '字数', type: 'number', min: 100, max: 100_000, step: 100, defaultValue: 3000 } }),
  controlTemplate({ id: 'control.context-budget', label: '上下文预算', description: '限制节点总输入预算。', semantic: 'control.context-budget', parameter: { key: 'value', label: 'Tokens', type: 'number', min: 1000, max: 256_000, step: 1000, defaultValue: 16_000 } }),
  controlTemplate({ id: 'control.candidate-count', label: '候选数量', description: '生成多个候选供作者比较。', semantic: 'control.count', parameter: { key: 'value', label: '数量', type: 'number', min: 1, max: 8, step: 1, defaultValue: 1 } }),
  controlTemplate({ id: 'control.volume-count', label: '卷数', description: '约束批量卷纲的目标数量。', semantic: 'control.volume-count', parameter: { key: 'value', label: '卷数', type: 'number', min: 1, max: 30, step: 1, defaultValue: 5 } }),
  controlTemplate({ id: 'control.chapter-count', label: '章节数', description: '约束批量章节的目标数量。', semantic: 'control.chapter-count', parameter: { key: 'value', label: '章节数', type: 'number', min: 1, max: 500, step: 1, defaultValue: 20 } }),
]

const PROCESSOR_TEMPLATES: AuthoringNodeTemplate[] = [
  {
    id: 'input.manual-text', version: 1, label: '自由文本', description: '作者要求、临时设定或任意文字。', category: '输入', class: 'content', capability: 'manual-draft', inputs: [], outputs: [{ id: 'text', label: '文字', semantic: 'text', cardinality: 'one', state: 'draft' }], parameters: [{ key: 'text', label: '作者输入', type: 'text', defaultValue: '' }],
  },
  {
    id: 'source.project-context', version: 1, label: '项目资料', description: '通过登记上下文或稳定字段键读取 Canon。', category: '输入', class: 'content', capability: 'read-canon', inputs: [], outputs: [{ id: 'context', label: '项目资料', semantic: 'any', cardinality: 'many', state: 'canon' }], reads: { sourceKeys: ['ragSelection'], allowExactFields: true },
  },
  {
    id: 'processor.compose', version: 1, label: '整理与合并', description: '按字段、优先级和模板组合上游内容。', category: '处理', class: 'processor', capability: 'transform', inputs: [contextInput()], outputs: [{ id: 'text', label: '整理结果', semantic: 'text', cardinality: 'one', state: 'draft' }], parameters: [{ key: 'template', label: '组合模板', type: 'text', defaultValue: '' }],
  },
  {
    id: 'processor.free-generation', version: 1, label: '自由创作', description: '按作者自由指令生成候选内容。', category: '处理', class: 'processor', capability: 'transform', inputs: generationInputs(), outputs: [candidateOutput('candidate')], promptModuleKey: 'prompt.operations', parameters: [{ key: 'instruction', label: '创作指令', type: 'text', defaultValue: '' }],
  },
  {
    id: 'processor.validate', version: 1, label: '内容校验', description: '执行空值、必含和禁用内容检查。', category: '处理', class: 'processor', capability: 'validate', inputs: [{ id: 'candidate', label: '待校验内容', semantic: 'any', cardinality: 'one', state: 'candidate', required: true }], outputs: [candidateOutput('candidate')], parameters: [{ key: 'requiredTerms', label: '必含内容', type: 'text' }, { key: 'forbiddenTerms', label: '禁用内容', type: 'text' }],
  },
  {
    id: 'output.review-adopt', version: 1, label: '预览与采纳', description: '查看差异并通过上游写契约确认采纳。', category: '输出', class: 'output', capability: 'adopt', inputs: [{ id: 'candidate', label: '候选内容', semantic: 'any', cardinality: 'one', state: 'candidate', required: true }], outputs: [{ id: 'adopted', label: '已确认内容', semantic: 'any', cardinality: 'one', state: 'canon' }],
  },
]

export const AUTHORING_NODE_CATALOG: readonly AuthoringNodeTemplate[] = Object.freeze([
  ...CONTENT_TEMPLATES,
  ...CONTINUITY_TEMPLATES,
  ...CONTINUITY_CONTEXT_TEMPLATES,
  ...CONTROL_TEMPLATES,
  ...PROCESSOR_TEMPLATES,
])

export const AUTHORING_NODE_BY_ID: ReadonlyMap<string, AuthoringNodeTemplate> = new Map(
  AUTHORING_NODE_CATALOG.map(template => [template.id, template] as const),
)

export const AUTHORING_NODE_CATEGORIES: readonly string[] = Object.freeze(
  Array.from(new Set(AUTHORING_NODE_CATALOG.map(template => template.category))),
)

export function authoringTemplatesForCategory(category: string): AuthoringNodeTemplate[] {
  return AUTHORING_NODE_CATALOG.filter(template => template.category === category)
}

export function defaultConfigForTemplate(template: AuthoringNodeTemplate): Record<string, unknown> {
  return Object.fromEntries((template.parameters ?? []).map(parameter => [
    parameter.key,
    parameter.defaultValue ?? (parameter.type === 'number' ? 0 : parameter.type === 'boolean' ? false : ''),
  ]))
}
