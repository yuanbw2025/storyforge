import { CHARACTER_DIMENSIONS } from '../character/character-dimensions'
import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import {
  FIELD_BY_TARGET,
  STORY_CORE_GENERATABLE_FIELD_SPECS,
  WORLDVIEW_GENERATABLE_FIELD_SPECS,
} from '../registry/field-registry'
import { ADOPTION_EXTENSIONS } from '../registry/adoption-schema'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import {
  AGENT_CONTEXT_INPUT_HANDLINGS,
  AGENT_CONTEXT_INPUT_STATES,
  AGENT_CONTEXT_PROFILES,
  classifyAgentContextInputStateV1,
  type AgentContextEvidence,
  type AgentContextInputHandlingV1,
  type AgentContextInputStateEvidenceV1,
  type AgentContextInputStateV1,
  type AgentContextTaskKind,
} from './context-policy'
import {
  CONTEXT_RESOURCE_KINDS_V1,
  type AssembleContextSourceEvidence,
  type ContextResourceDepthV1,
  type ContextResourceKind,
} from '../registry/types'
import { AGENT_TOOL_BY_NAME } from './tool-registry'

export const DOMAIN_AGENT_IDS = ['world-origin', 'character', 'inspiration', 'outline', 'prose'] as const
export type DomainAgentId = typeof DOMAIN_AGENT_IDS[number]

export type AgentSkillExecutionModeV1 =
  | 'complete'
  | 'worldview-field'
  | 'world-suggest'
  | 'worldview-expand'
  | 'world-link-context'
  | 'constitution-extract'
  | 'codex-extract'
  | 'codex-enrich'
  | 'story-core'
  | 'creative-rules'
  | 'create'
  | 'supplement'
  | 'lifecycle'
  | 'relationships'
  | 'locations'
  | 'map-config'
  | 'history-consult'
  | 'history-storm'
  | 'reference-summary'
  | 'reference-characters'
  | 'reverse'
  | 'auto'
  | 'story-arcs'
  | 'foreshadow-suggestions'
  | 'storyline-progress'
  | 'character-driven'
  | 'character-revision'
  | 'impact-summary-regenerate'
  | 'volumes'
  | 'chapters'
  | 'details'
  | 'generate'
  | 'continue'
  | 'emotion-beats'
  | 'inventory-extraction'
  | 'story-timeline-extraction'
  | 'cultivation-progress-extraction'
  | 'style-learn'
  | 'selection-edit'
  | 'selection-check'
  | 'review'
  | 'revise'
  | 'organize'
  | 'memory'
  | 'consistency'
  | 'character-reply'
  | 'scene-director'
  | 'memory-curator'
  | 'character-interaction-production'
  | 'adventure-intent'
  | 'adventure-narrator'
  | 'simulation-briefing'
  | 'simulation-advisor'
  | 'simulation-narrator'
  | 'simulation-actor-suggestion'
  | 'open-world-expression'
  | 'open-world-narration'
  | 'ttrpg-gm-narrator'
  | 'ttrpg-gm-actor-intent'
  | 'ttrpg-player-intent'
  | 'game-production'
  | 'adaptation-brief'
  | 'adaptation-impact'
  | 'screenplay-plan'
  | 'screenplay-scenes'
  | 'comic-plan'
  | 'comic-storyboard'

export interface AgentSkillWriteTargetV1 {
  table: string
  fields: readonly string[]
  adoptionExtension?: string
}

export interface AgentSkillInputPolicyV1 {
  /** Sources whose actual data presence determines empty/partial/complete. */
  sourceKeys: readonly string[]
  states: Record<AgentContextInputStateV1, {
    handling: AgentContextInputHandlingV1
    /** Only the selected state's concise instruction is injected. */
    instruction: string
  }>
}

export interface AgentSkillContextCompressionPolicyV1 {
  version: 1
  sourceKeys: readonly string[]
  minimumOriginalTokens: number
  maxSourcesPerTask: number
  maxAttemptsPerSource: number
  maxAnchors: number
  maxOutputTokens: number
  maxFullTextFallbackTokens: number
  maxFullTextBudgetScale: number
}

export interface AgentSkillContextGatewayPolicyV1 {
  version: 1
  /** shadow is evidence-only; required makes V3 freshness an adoption precondition. */
  rollout: 'shadow' | 'required'
  /**
   * Optional canary boundary. When present, only these registered table.field
   * write targets require the Gateway/V3 adoption gate; the remaining targets
   * stay on the legacy path until their own phase gate passes.
   */
  requiredWriteTargets?: readonly string[]
  providerSourceKeys: readonly string[]
  allowedResourceKinds: readonly ContextResourceKind[]
  allowedDepths: readonly ContextResourceDepthV1[]
  maxReadCalls: number
  maxRetrievedTokens: number
  maxPlanningSteps: number
  maxPlanningModelTokens: number
  allowOriginalRead: boolean
  additionalReadToolNames: readonly string[]
}

export interface AgentSkillDefinitionV1 {
  version: 1
  id: string
  agentId: DomainAgentId
  defaultForAgent: boolean
  label: string
  owner: string
  promptVersion: string
  executionMode: AgentSkillExecutionModeV1
  contextTaskKind: AgentContextTaskKind
  /** Tool-backed sources are derived from the Tool Registry, never copied here. */
  readToolNames: readonly string[]
  /** Sources assembled directly by the domain copilot. */
  contextSourceKeys: readonly string[]
  /** Sources enabled only by an explicit runtime boundary, such as a POV character. */
  optionalContextSourceKeys: readonly string[]
  inputPolicy: AgentSkillInputPolicyV1
  contextCompression: AgentSkillContextCompressionPolicyV1
  /** Optional until each formal domain is migrated through its phase gate. */
  contextGateway?: AgentSkillContextGatewayPolicyV1
  maxOutputTokens: number
  writeTargets: readonly AgentSkillWriteTargetV1[]
  lastVerifiedAt: string
  regressionTests: readonly string[]
}

const OUTLINE_CONTEXT_SOURCE_KEYS = [
  'ragSelection',
] as const

const OUTLINE_CONTEXT_GATEWAY_POLICY = {
  version: 1,
  rollout: 'required',
  requiredWriteTargets: [
    'outlineNodes.parentId',
    'outlineNodes.type',
    'outlineNodes.title',
    'outlineNodes.summary',
    'outlineNodes.order',
  ],
  providerSourceKeys: ['ragSelection'],
  allowedResourceKinds: [
    'world', 'worldview-field', 'world-link', 'story-core-field',
    'character', 'character-relation', 'story-arc', 'storyline-progress',
    'outline-node', 'detailed-outline', 'narrative-blueprint', 'chapter',
    'foreshadow', 'location', 'codex-entry', 'fact', 'reference',
  ],
  allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
  maxReadCalls: 8,
  maxRetrievedTokens: 64_000,
  maxPlanningSteps: 8,
  maxPlanningModelTokens: 64_000,
  allowOriginalRead: true,
  additionalReadToolNames: [
    'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
  ],
} as const satisfies AgentSkillContextGatewayPolicyV1

const ADAPTATION_BRIEF_CONTEXT_SOURCE_KEYS = ['adaptation.sourceManifest', 'adaptation.sourceContent', 'characters', 'worldview', 'creativeRules'] as const
const ADAPTATION_PLAN_CONTEXT_SOURCE_KEYS = ['adaptation.sourceManifest', 'adaptation.sourceContent', 'adaptation.currentBrief', 'characters'] as const
const SCREENPLAY_SCENES_CONTEXT_SOURCE_KEYS = ['adaptation.sourceManifest', 'adaptation.sourceContent', 'adaptation.currentBrief', 'adaptation.currentPlan', 'characters'] as const
const COMIC_STORYBOARD_CONTEXT_SOURCE_KEYS = ['adaptation.sourceManifest', 'adaptation.sourceContent', 'adaptation.currentBrief', 'adaptation.currentPlan', 'comic.visualBible', 'characters'] as const

const STORY_CORE_CONTEXT_SOURCE_KEYS = [
  'projectStatus',
  'canonAssertions',
  'worldview',
  'storyCore',
  'powerSystem',
  'codex',
  'characters',
  'storyArcs',
  'existingVolumeOutlines',
] as const

const CREATIVE_RULES_CONTEXT_SOURCE_KEYS = [
  'projectStatus',
  'worldview',
  'storyCore',
  'creativeRules',
] as const

const WORLDVIEW_FIELD_CONTEXT_SOURCE_KEYS = [
  'projectStatus',
  'canonAssertions',
  'worldview',
  'storyCore',
  'powerSystem',
  'codex',
  'characters',
  'creativeRules',
  'worldRules',
  'historical',
  'storyArcs',
  'existingVolumeOutlines',
  'references',
] as const

const WORLDVIEW_EXPAND_CONTEXT_SOURCE_KEYS = [
  'manualText',
  'worldGroups',
  'storyCore',
  'worldview',
] as const

const WORLD_SUGGEST_CONTEXT_SOURCE_KEYS = [
  'manualText',
  'worldGroups',
  'storyCore',
] as const

const CONSTITUTION_EXTRACT_CONTEXT_SOURCE_KEYS = ['constitutionScanSources'] as const
const CODEX_EXTRACT_CONTEXT_SOURCE_KEYS = ['manualText', 'ragSelection'] as const
const CODEX_ENRICH_CONTEXT_SOURCE_KEYS = ['ragSelection'] as const
const CODEX_CANDIDATE_WRITE_FIELDS = [
  'categoryId', 'name', 'icon', 'summary', 'description', 'fields', 'refs', 'tags',
  'importance', 'origin', 'sourceEvidenceQuotes', 'sourceContentHash', 'producerRunId',
  'producerCandidateHash', 'order', 'worldGroupId',
] as const
const CULTIVATION_PROGRESS_EXTRACTION_CONTEXT_SOURCE_KEYS = [
  'chapterContent',
  'cultivationProgressExtractionBaseline',
] as const
const FORESHADOW_SUGGESTION_CONTEXT_SOURCE_KEYS = [
  'canonAssertions',
  'worldview',
  'storyCore',
  'powerSystem',
  'cultivationProgress',
  'codex',
  'characters',
  'creativeRules',
  'worldRules',
  'historical',
  'locations',
  'foreshadowSuggestionBaseline',
] as const
const HISTORY_AGENT_CONTEXT_SOURCE_KEYS = ['worldview', 'historyAgentBaseline'] as const
const REFERENCE_DERIVED_CONTEXT_SOURCE_KEYS = ['referenceDerivedBaseline'] as const

const CHARACTER_SUPPLEMENT_CONTEXT_SOURCE_KEYS = [
  'targetCharacter',
  'canonAssertions',
  'worldview',
  'storyCore',
  'powerSystem',
  'codex',
  'creativeRules',
  'worldRules',
  'locations',
] as const

const CHARACTER_SUPPLEMENT_OPTIONAL_CONTEXT_SOURCE_KEYS = [
  'characterFacts',
  'characterPassages',
] as const

const CHARACTER_RELATIONSHIP_CONTEXT_SOURCE_KEYS = [
  'characters',
  'characterRelations',
  'outlineSummaries',
  'writtenChapters',
] as const

const CHARACTER_RELATIONSHIP_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: ['characters', 'outlineSummaries', 'writtenChapters'],
  states: {
    empty: { handling: 'create-from-request', instruction: '没有足够的角色与剧情资料时返回空数组，不得编造关系。' },
    partial: { handling: 'reference-and-create', instruction: '只提取现有资料逐字支持的关系，不补写缺失剧情。' },
    complete: { handling: 'grounded-transform', instruction: '综合现有角色、关系、大纲与正文，输出可核对的关系候选。' },
  },
}

const REFERENCE_DERIVED_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: REFERENCE_DERIVED_CONTEXT_SOURCE_KEYS,
  states: {
    empty: { handling: 'require-upstream', instruction: '没有已完成的版本化分块分析时不得生成派生结果。' },
    partial: { handling: 'grounded-transform', instruction: '只整理已登记的分析维度或人物塑造文本，不补造来源内容。' },
    complete: { handling: 'grounded-transform', instruction: '严格压缩版本化分析证据，保持来源、维度和角色归并可核查。' },
  },
}

const CHARACTER_RELATIONSHIP_COMPRESSION_POLICY: AgentSkillContextCompressionPolicyV1 = {
  version: 1,
  sourceKeys: CHARACTER_RELATIONSHIP_CONTEXT_SOURCE_KEYS,
  minimumOriginalTokens: 700,
  maxSourcesPerTask: 4,
  maxAttemptsPerSource: 1,
  maxAnchors: 16,
  maxOutputTokens: 3_000,
  maxFullTextFallbackTokens: 12_000,
  maxFullTextBudgetScale: 1.5,
}

const WORLD_LOCATION_EXTRACTION_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: ['chapterContent'],
  states: {
    empty: { handling: 'require-upstream', instruction: '没有已写正文时不得提取重要地点。' },
    partial: { handling: 'grounded-transform', instruction: '只从当前已写正文明确出现的地点中提取候选。' },
    complete: { handling: 'grounded-transform', instruction: '综合全部已写章节去重，只保留有明确剧情作用的地点。' },
  },
}

const WORLD_LOCATION_EXTRACTION_COMPRESSION_POLICY = compressionPolicy(['chapterContent'])

const WORLD_MAP_CONTEXT_SOURCE_KEYS = ['worldview', 'geography', 'codex', 'locations'] as const
const WORLD_MAP_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: WORLD_MAP_CONTEXT_SOURCE_KEYS,
  states: {
    empty: { handling: 'create-from-request', instruction: '当前世界资料为空；只生成最小可用地图，不得声称引用作者设定。' },
    partial: { handling: 'reference-and-create', instruction: '锁定已有地理实体、名称与空间证据，只补足地图运行所需参数。' },
    complete: { handling: 'grounded-transform', instruction: '严格依据当前世界的世界观、地理、词条和重要地点生成可核查地图配置。' },
  },
}
const WORLD_MAP_COMPRESSION_POLICY = compressionPolicy(WORLD_MAP_CONTEXT_SOURCE_KEYS)

const PROSE_INVENTORY_EXTRACTION_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: ['chapterContent'],
  states: {
    empty: { handling: 'require-upstream', instruction: '没有所选章节正文时不得提取物品流水。' },
    partial: { handling: 'grounded-transform', instruction: '只记录所选正文中明确发生、持有人明确的物品变动。' },
    complete: { handling: 'grounded-transform', instruction: '逐章提取真实发生的物品变动，保持角色归属、方向和规范名称一致。' },
  },
}

const PROSE_INVENTORY_EXTRACTION_COMPRESSION_POLICY = compressionPolicy(['chapterContent'])

const PROSE_STORY_TIMELINE_EXTRACTION_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: ['chapterContent'],
  states: {
    empty: { handling: 'require-upstream', instruction: '没有已写正文时不得提取故事年表。' },
    partial: { handling: 'grounded-transform', instruction: '只记录正文中明确发生的剧情事件，不补写缺失时间或因果。' },
    complete: { handling: 'grounded-transform', instruction: '逐章提取正文明确发生的剧情大事，保持故事时间、重要度和章节归属可核对。' },
  },
}

const PROSE_STORY_TIMELINE_EXTRACTION_COMPRESSION_POLICY = compressionPolicy(['chapterContent', 'storyTimelineTarget'])

const PROSE_SELECTION_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: ['manualText'],
  states: {
    empty: { handling: 'require-author-input', instruction: '没有作者冻结的选中文字时不得执行局部编辑或查漏。' },
    partial: { handling: 'grounded-transform', instruction: '只处理作者冻结的选中文字，不推断或补写选区外正文。' },
    complete: { handling: 'grounded-transform', instruction: '只处理作者冻结的选中文字，不推断或补写选区外正文。' },
  },
}

const PROSE_SELECTION_COMPRESSION_POLICY = compressionPolicy(['manualText'])
const ADAPTATION_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: ['adaptation.sourceManifest', 'adaptation.sourceContent'],
  states: {
    empty: { handling: 'require-upstream', instruction: '没有冻结来源清单和授权来源内容时不得生成改编候选。' },
    partial: { handling: 'grounded-transform', instruction: '只依据实际交付的来源单元生成，并明确未覆盖内容，不得假装读过全书。' },
    complete: { handling: 'grounded-transform', instruction: '严格依据冻结来源、已确认改编约束和目标媒介合同生成可审查候选。' },
  },
}
const ADAPTATION_COMPRESSION_POLICY = compressionPolicy(['adaptation.sourceContent'])
const FORESHADOW_SUGGESTION_COMPRESSION_POLICY = compressionPolicy(FORESHADOW_SUGGESTION_CONTEXT_SOURCE_KEYS)
const HISTORY_AGENT_COMPRESSION_POLICY = compressionPolicy(HISTORY_AGENT_CONTEXT_SOURCE_KEYS)
const REFERENCE_DERIVED_COMPRESSION_POLICY = compressionPolicy(REFERENCE_DERIVED_CONTEXT_SOURCE_KEYS)

const HISTORY_AGENT_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: HISTORY_AGENT_CONTEXT_SOURCE_KEYS,
  states: {
    empty: { handling: 'require-author-input', instruction: '目标历史条目不存在时不得调用模型。' },
    partial: { handling: 'grounded-transform', instruction: '只依据已登记目标条目和可用世界观提供咨询，不补写缺失 Canon。' },
    complete: { handling: 'grounded-transform', instruction: '依据完整登记输入提供可审查建议，只写候选结果字段。' },
  },
}

const OUTLINE_STORY_ARC_CONTEXT_SOURCE_KEYS = [
  'projectStatus',
  'canonAssertions',
  'worldview',
  'storyCore',
  'characterDrivenPlan',
  'powerSystem',
  'cultivationProgress',
  'codex',
  'characters',
  'creativeRules',
  'worldRules',
  'historical',
  'locations',
  'storyArcs',
  'storylineProgress',
  'existingVolumeOutlines',
  'writtenChapterProgress',
] as const

const OUTLINE_STORYLINE_PROGRESS_CONTEXT_SOURCE_KEYS = [
  'projectStatus',
  'storyArcs',
  'storylineProgress',
  'chapterContent',
] as const

const OUTLINE_CHARACTER_DRIVEN_CONTEXT_SOURCE_KEYS = [
  'projectStatus',
  'canonAssertions',
  'worldview',
  'storyCore',
  'activeNarrativeBlueprint',
  'powerSystem',
  'cultivationProgress',
  'codex',
  'characters',
  'creativeRules',
  'worldRules',
  'historical',
  'locations',
  'storyArcs',
  'storylineProgress',
  'existingVolumeOutlines',
  'writtenChapterProgress',
] as const

const OUTLINE_CHARACTER_REVISION_CONTEXT_SOURCE_KEYS = [
  'manualText',
  'storyCore',
  'characters',
  'characterRelations',
  'storyArcs',
  'storylineProgress',
  'existingVolumeOutlines',
  'writtenChapterProgress',
  'currentFacts',
  'chapterContinuityHandoff',
  'previousPlanReconciliation',
  'recentChapterSummaries',
  'characterFacts',
  'characterPassages',
  'foreshadows',
  'canonAssertions',
  'worldRules',
  'codex',
] as const

export const OUTLINE_IMPACT_REGENERATION_CONTEXT_SOURCE_KEYS = [
  'chapterContent',
  'chapterOutline',
  'adjacentChapterOutlines',
  'canonAssertions',
  'storyCore',
  'characters',
  'storyArcs',
  'writtenChapterProgress',
  'consistencyReport',
] as const

export const OUTLINE_DETAIL_CONTEXT_SOURCE_KEYS = ['ragSelection'] as const

const PROSE_CONTEXT_SOURCE_KEYS = ['ragSelection'] as const

const PROSE_EMOTION_BEAT_CONTEXT_SOURCE_KEYS = [
  'chapterOutline',
  'detailedOutline',
  'previousChapterEnding',
  'worldview',
  'storyCore',
  'characters',
  'creativeRules',
] as const

export const PROSE_ORGANIZATION_CONTEXT_SOURCE_KEYS = [
  'chapterContent',
  'chapterOutline',
  'detailedOutline',
  'stateCards',
  'currentFacts',
  'characters',
  'characterRelations',
  'itemLedger',
  'foreshadows',
  'storyArcs',
  'storylineProgress',
  'canonAssertions',
  'characterKnowledge',
  'retrievedPassages',
] as const

export const PROSE_MEMORY_CONTEXT_SOURCE_KEYS = [
  'chapterContent',
  'chapterOutline',
  'detailedOutline',
  'chapterContinuityHandoff',
  'previousPlanReconciliation',
] as const

export const PROSE_CONSISTENCY_CONTEXT_SOURCE_KEYS = [
  'chapterContent',
  'characters',
  'heldItems',
] as const

const WORLD_FOUNDATION_INPUT_POLICY = {
  sourceKeys: ['worldview', 'powerSystem', 'codex'],
  states: {
    empty: {
      handling: 'create-from-request',
      instruction: '当前没有已填写的世界基础；只依据作者本轮要求创建候选，不得声称引用了既有设定。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '把已有世界字段视为约束，只补足缺失联系，不覆盖或擅改作者已填写内容。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格依据已填写的世界基础生成，并保持规则、术语与因果一致。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const STORY_CORE_INPUT_POLICY = {
  sourceKeys: ['worldview', 'storyCore'],
  states: {
    empty: {
      handling: 'create-from-request',
      instruction: '世界观与故事核心都为空；若已有角色、故事线或大纲，可把它们作为下游反推证据创建目标字段候选，否则只依据作者要求创建；任何反推都只是候选，不得冒充已确认设定。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '锁定已有世界观或故事核心字段，只补足当前目标字段；可用角色、故事线或大纲反推缺失联系，但不得覆盖作者已填写的其他字段，也不得把反推内容写入非目标字段。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格依据已填写世界观与故事核心生成目标字段，并用现有角色、故事线和大纲检查下游兼容性；下游证据不能覆盖已确认上游。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const CREATIVE_RULES_INPUT_POLICY = {
  sourceKeys: ['worldview', 'storyCore', 'creativeRules'],
  states: {
    empty: {
      handling: 'create-from-request',
      instruction: '世界观、故事核心和创作规则都为空；只依据项目概况与本轮目标创建单字段建议，不得声称引用了作者尚未填写的设定。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '锁定作者已经填写的世界、故事和其它创作规则，只补当前目标字段；缺失内容可以给出最小建议，不得顺手覆盖其它字段。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格依据已有世界观、故事核心和创作规则建议当前目标字段，并检查它与其它规则是否可共同执行。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const WORLDVIEW_FIELD_INPUT_POLICY = {
  sourceKeys: ['worldview', 'storyCore', 'characters', 'storyArcs'],
  states: {
    empty: {
      handling: 'create-from-request',
      instruction: '世界基座和下游故事资料都为空；只依据作者本轮要求创建目标字段候选，不得声称引用了既有设定。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '锁定已有世界字段；缺失上游可依据故事核心、角色、故事线或大纲反推，但只能写当前目标字段，推断不得冒充已确认设定。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格依据已有世界基座并用下游故事资料核对兼容性；下游证据不能覆盖已确认的世界设定。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const CHARACTER_INPUT_POLICY = {
  sourceKeys: ['worldview', 'powerSystem', 'codex', 'storyCore', 'characters', 'worldRules', 'historical'],
  states: {
    empty: {
      handling: 'create-from-request',
      instruction: '当前没有可用设定或角色主档；依据作者要求创建角色候选，并避免伪造既有关系。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '保留已有设定与角色约束，在空白处创建角色；不得复制已有角色或臆造已确认关系。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格依据现有世界与角色阵容创建互补角色，保持术语、能力边界和关系一致。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const CHARACTER_SUPPLEMENT_INPUT_POLICY = {
  sourceKeys: ['targetCharacter'],
  states: {
    empty: {
      handling: 'require-author-input',
      instruction: '目标角色不存在或不属于当前世界；停止补全，不得创建替代角色。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '锁定目标角色已有设定，只补全作者本次选择的字段；不得修改身份轴、关系或其它字段。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格依据目标角色完整设定补全作者本次选择的字段；若启用剧情证据，还必须服从已确认事实与正文表现。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const INSPIRATION_INPUT_POLICY = {
  sourceKeys: ['inspirationWorkspace'],
  states: {
    empty: {
      handling: 'require-author-input',
      instruction: '没有作者选择的灵感碎片时不得反推；要求作者先提供或选择灵感。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '以已选灵感为唯一作者种子，明确区分原始灵感与补全推断。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '完整保留已选灵感的核心意图，再将其结构化为可确认候选。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const OUTLINE_VOLUME_INPUT_POLICY = {
  sourceKeys: ['worldview', 'storyCore', 'characters', 'storyArcs'],
  states: {
    empty: {
      handling: 'create-from-request',
      instruction: '上游设定为空；仅按作者本轮要求创建最小可用卷纲候选，不把推断冒充 Canon。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '锁定已有上游设定，围绕缺失部分补足卷级结构，不得改写已确认事实。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格把已有世界、故事核心、角色与故事线编排为卷纲，不新增冲突前提。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const OUTLINE_STORY_ARC_INPUT_POLICY = {
  sourceKeys: ['worldview', 'storyCore', 'characters'],
  states: {
    empty: {
      handling: 'create-from-request',
      instruction: '上游世界、故事核心和角色均为空；只按作者本轮要求创建最小故事线候选，所有补全都不得冒充已确认设定。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '锁定已有上游内容并围绕缺失部分补足故事线；清楚区分作者事实与规划推断，不覆盖已确认设定。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格把已有世界、故事核心和角色目标编排为主线/支线，保持规则、动机、因果和阶段一致。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const OUTLINE_STORYLINE_PROGRESS_INPUT_POLICY = {
  sourceKeys: ['storyArcs', 'storylineProgress', 'chapterContent'],
  states: {
    empty: {
      handling: 'require-author-input',
      instruction: '缺少已登记故事线或目标章节正文时停止映射；不得凭空创建进度事实。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '只把正文逐字证据映射到已登记故事线；缺少的阶段或交汇不得臆造，疑似新线只能作为待确认候选。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格依据当前章节正文、已登记故事线及作者确认的历史进度，输出可核查的进度、交汇和疑似新线候选。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const OUTLINE_CHARACTER_DRIVEN_INPUT_POLICY = {
  sourceKeys: ['characterDrivenPlan', 'storyCore', 'characters', 'storyArcs'],
  states: {
    empty: {
      handling: 'require-author-input',
      instruction: '缺少可执行的角色弧光起点和终点时停止生成，先由作者选择角色并填写状态变化。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '锁定作者填写的角色弧光；以已有世界、故事核心和故事线为约束补足卷章编排，不得另起主线或改写角色终点。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格把作者填写的全部角色弧光编入既有主线/支线和卷章结构，并明确每章的因果、角色参与和弧光推进。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const OUTLINE_CHARACTER_REVISION_INPUT_POLICY = {
  sourceKeys: ['existingVolumeOutlines', 'writtenChapterProgress'],
  states: {
    empty: {
      handling: 'require-upstream',
      instruction: '当前没有可重规划的章节大纲；停止生成并要求作者先建立章纲。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '以现有章纲、作者保护边界和可用正文证据为准；证据缺失时只提出可审查建议，不把推断写成既成事实。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格依据已写进度、连续性交接、事实、角色和故事线分析影响；已写区只读，只有作者最终勾选的未来大纲 patch 可写。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const OUTLINE_IMPACT_REGENERATION_INPUT_POLICY = {
  sourceKeys: ['chapterContent', 'chapterOutline'],
  states: {
    empty: {
      handling: 'require-upstream',
      instruction: '缺少来源正文或目标后续章纲时停止重建，不得创建替代目标。',
    },
    partial: {
      handling: 'require-upstream',
      instruction: '来源正文与目标章纲必须同时存在；资料不完整时保持当前摘要并要求作者补齐。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格依据 H57 当前影响项与登记 Context 重建一个后续章纲摘要，只输出可确认候选，不改正文、事实或其它大纲字段。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const OUTLINE_CHAPTER_INPUT_POLICY = {
  sourceKeys: ['worldview', 'storyCore', 'characters', 'storyArcs', 'existingVolumeOutlines'],
  states: {
    empty: {
      handling: 'require-upstream',
      instruction: '缺少可展开的上游卷纲时停止生成，先完成或确认卷纲。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '以现有卷纲和已填写设定为边界补足章纲；缺失设定只能作为候选假设，不得冒充事实。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格依据卷纲与完整上游设定拆分章纲，保持剧情线、角色阶段和因果顺序。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const OUTLINE_DETAIL_INPUT_POLICY = {
  sourceKeys: [
    'chapterOutline',
    'storyArcs',
    'storylineProgress',
    'writtenChapterProgress',
    'activeNarrativeBlueprint',
  ],
  states: {
    empty: {
      handling: 'require-upstream',
      instruction: '缺少目标章纲时停止生成，先建立或确认该章的标题与摘要。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '以现有章纲和已填写设定为硬边界补足场景；未填写的世界或角色细节只能留作候选，不得冒充 Canon。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格依据章纲、故事核心、角色、相邻章和当前细纲拆分场景，避免重复已有场景并保持因果与信息边界。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const PROSE_INPUT_POLICY = {
  sourceKeys: [
    'chapterOutline',
    'detailedOutline',
    'storyArcs',
    'storylineProgress',
    'activeNarrativeBlueprint',
    'chapterContinuityHandoff',
    'characterKnowledge',
    'currentFacts',
    'consistencyDossier',
  ],
  states: {
    empty: {
      handling: 'require-upstream',
      instruction: '缺少章纲时不得直接生成正文，先完成或确认上游章纲。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '章纲和已有设定是硬边界；只在未规定处进行文学创作，不补写成新的已确认设定。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格落实章纲、细纲、故事核心和角色约束，同时遵守本章信息边界。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const PROSE_EMOTION_BEAT_INPUT_POLICY = {
  sourceKeys: ['chapterOutline', 'detailedOutline', 'storyCore', 'characters'],
  states: {
    empty: {
      handling: 'require-upstream',
      instruction: '缺少当前章纲时不得规划情感节拍，先完成或确认该章标题与摘要。',
    },
    partial: {
      handling: 'reference-and-create',
      instruction: '以现有章纲和已填写设定为硬边界规划节拍，未规定细节不得冒充已确认剧情。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格落实章纲、细纲、故事核心与角色约束，让 3–6 个节拍形成可执行的情感递进或反转。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

const PROSE_POST_ADOPTION_INPUT_POLICY = {
  sourceKeys: ['chapterContent'],
  states: {
    empty: {
      handling: 'require-author-input',
      instruction: '章节没有已采纳正文时不得生成章后交接或章节记忆。',
    },
    partial: {
      handling: 'grounded-transform',
      instruction: '只从当前已采纳正文抽取有逐字证据的变化，不把未完成片段补写成事实。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '严格依据当前已采纳正文抽取交接与记忆，计划和设定只能用于核对，不能冒充已发生事实。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1

function compressionPolicy(
  sourceKeys: readonly string[],
): AgentSkillContextCompressionPolicyV1 {
  return {
    version: 1,
    sourceKeys,
    minimumOriginalTokens: 1_600,
    maxSourcesPerTask: 1,
    maxAttemptsPerSource: 2,
    maxAnchors: 12,
    maxOutputTokens: 1_800,
    maxFullTextFallbackTokens: 12_000,
    maxFullTextBudgetScale: 2,
  }
}

const WORLD_COMPRESSION_POLICY = compressionPolicy(['worldview', 'powerSystem', 'codex'])
const STORY_CORE_COMPRESSION_POLICY = compressionPolicy([
  'worldview',
  'storyCore',
  'powerSystem',
  'codex',
  'characters',
  'storyArcs',
  'existingVolumeOutlines',
])
const CREATIVE_RULES_COMPRESSION_POLICY = compressionPolicy([
  'worldview',
  'storyCore',
  'creativeRules',
])
const WORLDVIEW_FIELD_COMPRESSION_POLICY = compressionPolicy([
  'worldview',
  'storyCore',
  'powerSystem',
  'codex',
  'characters',
  'historical',
  'storyArcs',
  'existingVolumeOutlines',
  'references',
])
const WORLDVIEW_EXPAND_COMPRESSION_POLICY = compressionPolicy([
  'manualText',
  'worldGroups',
  'storyCore',
  'worldview',
])
const WORLD_SUGGEST_COMPRESSION_POLICY = compressionPolicy([
  'manualText',
  'worldGroups',
  'storyCore',
])
const CONSTITUTION_EXTRACT_COMPRESSION_POLICY = compressionPolicy(['constitutionScanSources'])
const CODEX_EXTRACT_COMPRESSION_POLICY = compressionPolicy(CODEX_EXTRACT_CONTEXT_SOURCE_KEYS)
const CODEX_ENRICH_COMPRESSION_POLICY = compressionPolicy(CODEX_ENRICH_CONTEXT_SOURCE_KEYS)
const CULTIVATION_PROGRESS_EXTRACTION_COMPRESSION_POLICY = compressionPolicy(
  CULTIVATION_PROGRESS_EXTRACTION_CONTEXT_SOURCE_KEYS,
)
const CHARACTER_COMPRESSION_POLICY = compressionPolicy([
  'worldview',
  'powerSystem',
  'codex',
  'storyCore',
  'characters',
  'worldRules',
  'historical',
])
const CHARACTER_SUPPLEMENT_COMPRESSION_POLICY = compressionPolicy([
  'worldview',
  'storyCore',
  'powerSystem',
  'codex',
  'creativeRules',
  'worldRules',
  'locations',
  'characterFacts',
  'characterPassages',
])
const INSPIRATION_COMPRESSION_POLICY = compressionPolicy(['inspirationWorkspace'])
const OUTLINE_COMPRESSION_POLICY = compressionPolicy(['ragSelection'])
const OUTLINE_STORY_ARC_COMPRESSION_POLICY = compressionPolicy([
  'worldview',
  'storyCore',
  'characterDrivenPlan',
  'powerSystem',
  'codex',
  'characters',
  'historical',
  'storyArcs',
  'existingVolumeOutlines',
])
const OUTLINE_STORYLINE_PROGRESS_COMPRESSION_POLICY = compressionPolicy([
  'storyArcs',
  'storylineProgress',
  'chapterContent',
])
const OUTLINE_CHARACTER_DRIVEN_COMPRESSION_POLICY = compressionPolicy([
  'characterDrivenPlan',
  'worldview',
  'storyCore',
  'activeNarrativeBlueprint',
  'powerSystem',
  'codex',
  'characters',
  'historical',
  'storyArcs',
  'existingVolumeOutlines',
])
const OUTLINE_CHARACTER_REVISION_COMPRESSION_POLICY = compressionPolicy([
  'storyCore',
  'characters',
  'characterRelations',
  'storyArcs',
  'storylineProgress',
  'existingVolumeOutlines',
  'currentFacts',
  'chapterContinuityHandoff',
  'previousPlanReconciliation',
  'recentChapterSummaries',
  'characterFacts',
  'characterPassages',
  'foreshadows',
  'canonAssertions',
  'worldRules',
  'codex',
])
const OUTLINE_IMPACT_REGENERATION_COMPRESSION_POLICY = compressionPolicy(
  OUTLINE_IMPACT_REGENERATION_CONTEXT_SOURCE_KEYS,
)
const OUTLINE_DETAIL_COMPRESSION_POLICY = compressionPolicy(['ragSelection'])
const PROSE_COMPRESSION_POLICY = compressionPolicy(['ragSelection'])

const PROSE_CONTEXT_GATEWAY_POLICY = {
  version: 1 as const,
  rollout: 'required' as const,
  requiredWriteTargets: ['chapters.content', 'chapters.wordCount'],
  providerSourceKeys: ['ragSelection'],
  allowedResourceKinds: [
    'world', 'worldview-field', 'story-core-field', 'character',
    'character-relation', 'story-arc', 'storyline-progress', 'outline-node',
    'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry',
    'fact', 'reference', 'narrative-blueprint',
  ],
  allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
  maxReadCalls: 8,
  maxRetrievedTokens: 48_000,
  maxPlanningSteps: 6,
  maxPlanningModelTokens: 24_000,
  allowOriginalRead: true,
  additionalReadToolNames: [
    'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
  ],
} as const
const PROSE_EMOTION_BEAT_COMPRESSION_POLICY = compressionPolicy([
  'detailedOutline',
  'worldview',
  'storyCore',
  'characters',
])
const PROSE_ORGANIZATION_COMPRESSION_POLICY = compressionPolicy([
  'chapterOutline',
  'detailedOutline',
  'characters',
  'currentFacts',
  'retrievedPassages',
])
const PROSE_MEMORY_COMPRESSION_POLICY = compressionPolicy([
  'chapterOutline',
  'detailedOutline',
  'chapterContinuityHandoff',
  'previousPlanReconciliation',
])
const PROSE_CONSISTENCY_COMPRESSION_POLICY = compressionPolicy(['chapterContent'])
const INTERACTION_RUNTIME_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: ['interactionRuntime'],
  states: {
    empty: { handling: 'require-upstream', instruction: '缺少角色可见运行时上下文时停止，不得臆造场景、知识或记忆。' },
    partial: { handling: 'require-upstream', instruction: '角色运行时上下文不完整时停止，等待重新装配。' },
    complete: { handling: 'grounded-transform', instruction: '只能依据该角色可见的运行时上下文生成候选，不得读取其他角色私有视角。' },
  },
}
const INTERACTION_RUNTIME_COMPRESSION_POLICY = compressionPolicy(['interactionRuntime'])
const ADVENTURE_RUNTIME_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: ['adventureRuntime'],
  states: {
    empty: { handling: 'require-upstream', instruction: '缺少文字冒险运行时上下文时停止，不得臆造行动或结果。' },
    partial: { handling: 'require-upstream', instruction: '文字冒险运行时上下文不完整时停止，等待重新装配。' },
    complete: { handling: 'grounded-transform', instruction: '自由输入只能映射到登记的当前可执行行动；结果叙述只能改写已提交事件证据。' },
  },
}
const ADVENTURE_RUNTIME_COMPRESSION_POLICY = compressionPolicy(['adventureRuntime'])
const NARRATIVE_SIMULATION_RUNTIME_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: ['narrativeSimulationRuntime'],
  states: {
    empty: { handling: 'require-upstream', instruction: '缺少叙事模拟运行时上下文时停止，不得臆造局势、行动或结果。' },
    partial: { handling: 'require-upstream', instruction: '叙事模拟运行时上下文不完整时停止，等待重新装配。' },
    complete: { handling: 'grounded-transform', instruction: '只能依据玩家可见状态与正式事件证据生成表现候选，不得改写确定性结算。' },
  },
}
const NARRATIVE_SIMULATION_RUNTIME_COMPRESSION_POLICY = compressionPolicy(['narrativeSimulationRuntime'])
const OPEN_WORLD_RUNTIME_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: ['openWorldRuntime'],
  states: {
    empty: { handling: 'require-upstream', instruction: '缺少开放世界玩家视角时停止，不得臆造区域、人物、任务或事件。' },
    partial: { handling: 'require-upstream', instruction: '开放世界运行时上下文不完整时停止，等待重新装配。' },
    complete: { handling: 'grounded-transform', instruction: '只能润色已公开任务或叙述正式事件证据，不得改变确定性世界状态。' },
  },
}
const OPEN_WORLD_RUNTIME_COMPRESSION_POLICY = compressionPolicy(['openWorldRuntime'])
const TTRPG_GM_RUNTIME_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: ['ttrpgRuntime'],
  states: {
    empty: { handling: 'require-upstream', instruction: '缺少正式 TTRPG 主持人运行视角时停止，不得臆造场景、裁定或线索。' },
    partial: { handling: 'require-upstream', instruction: 'TTRPG 主持人运行视角不完整时停止，等待重新装配。' },
    complete: { handling: 'grounded-transform', instruction: '只能叙述已完成的正式 RulePack 行动，或为当前 GM 控制 NPC 从 availableActions 提出闭集行动意图；不得指定骰点、结果、资源变化、线索权限或场景事实。' },
  },
}
const TTRPG_GM_RUNTIME_COMPRESSION_POLICY = compressionPolicy(['ttrpgRuntime'])
const TTRPG_PLAYER_RUNTIME_INPUT_POLICY: AgentSkillInputPolicyV1 = {
  sourceKeys: ['ttrpgPlayerRuntime'],
  states: {
    empty: { handling: 'require-upstream', instruction: '缺少单角色 TTRPG 玩家视角时停止，不得从主持上下文或其他角色视角补全。' },
    partial: { handling: 'require-upstream', instruction: 'TTRPG 玩家视角不完整时停止，等待按同一角色重新装配。' },
    complete: { handling: 'grounded-transform', instruction: '只能从 availableActions 与玩家可见目标提出行动意图；不得生成骰点、结果、资源变化、线索或场景推进。' },
  },
}
const TTRPG_PLAYER_RUNTIME_COMPRESSION_POLICY = compressionPolicy(['ttrpgPlayerRuntime'])
const PROSE_STYLE_LEARNING_INPUT_POLICY = {
  sourceKeys: ['styleLearningBaseline'],
  states: {
    empty: {
      handling: 'require-author-input',
      instruction: '缺少合格章节或作者保存的改稿对照时停止学习，不得凭空生成文风画像。',
    },
    partial: {
      handling: 'grounded-transform',
      instruction: '只依据登记的有限章节样本或改稿对照提炼；证据不足的维度必须明确标注。',
    },
    complete: {
      handling: 'grounded-transform',
      instruction: '综合登记的章节样本、改稿对照与校准反馈，提炼具体可执行且不挪用剧情实体的文风画像。',
    },
  },
} as const satisfies AgentSkillInputPolicyV1
const PROSE_STYLE_LEARNING_COMPRESSION_POLICY = compressionPolicy(['styleLearningBaseline'])

function gameProductionInputPolicy(sourceKeys: readonly string[]): AgentSkillInputPolicyV1 {
  return {
    sourceKeys,
    states: {
      empty: { handling: 'require-upstream', instruction: '缺少登记的生产来源时停止，不得从组件状态或其他 Work 猜测。' },
      partial: { handling: 'require-upstream', instruction: '生产依赖不完整时停止并报告缺失 key，不得扩大读取范围。' },
      complete: { handling: 'grounded-transform', instruction: '只能基于已授权 Brief 和显式 Artifact 依赖生成候选；正式发布仍需整包 adoption。' },
    },
  }
}

export const AGENT_SKILLS = [
  {
    version: 1,
    id: 'world-origin.complete',
    agentId: 'world-origin',
    defaultForAgent: true,
    label: '世界来源补全',
    owner: 'world-foundation-agent',
    promptVersion: 'world-origin-copilot-v1',
    executionMode: 'complete',
    contextTaskKind: 'agent-world-origin',
    readToolNames: ['read_project_status', 'read_worldview'],
    contextSourceKeys: [],
    optionalContextSourceKeys: [],
    inputPolicy: WORLD_FOUNDATION_INPUT_POLICY,
    contextCompression: WORLD_COMPRESSION_POLICY,
    maxOutputTokens: 3_000,
    writeTargets: [{ table: 'worldviews', fields: ['worldOrigin'] }],
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-AGENT1-chat-copilot-world-origin', 'R-HARNESS2-master-terminal-verifier', 'R-HARNESS16-semantic-context-compression', 'R-HARNESS18-execution-version-freshness'],
  },
  {
    version: 1,
    id: 'world-origin.review',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: '世界来源证据型语义终验',
    owner: 'world-foundation-agent',
    promptVersion: 'world-origin-semantic-review-v1',
    executionMode: 'review',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: ['projectStatus', 'worldview', 'storyCore', 'powerSystem', 'codex', 'characters', 'storyArcs'],
    optionalContextSourceKeys: [],
    inputPolicy: WORLD_FOUNDATION_INPUT_POLICY,
    contextCompression: WORLD_COMPRESSION_POLICY,
    maxOutputTokens: 3_000,
    writeTargets: [],
    lastVerifiedAt: '2026-08-09',
    regressionTests: ['R-HARNESS27-master-candidate-semantic-review'],
  },
  {
    version: 1,
    id: 'world-origin.worldview-field',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: '世界基座单字段生成',
    owner: 'world-foundation-agent',
    promptVersion: 'worldview-field-copilot-v1',
    executionMode: 'worldview-field',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: WORLDVIEW_FIELD_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: WORLDVIEW_FIELD_INPUT_POLICY,
    contextCompression: WORLDVIEW_FIELD_COMPRESSION_POLICY,
    contextGateway: {
      version: 1,
      rollout: 'required',
      requiredWriteTargets: WORLDVIEW_GENERATABLE_FIELD_SPECS.map(spec => `worldviews.${spec.field}`),
      providerSourceKeys: ['ragSelection'],
      allowedResourceKinds: [
        'world', 'worldview-field', 'story-core-field', 'character',
        'character-relation', 'story-arc', 'storyline-progress', 'outline-node',
        'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry',
        'world-link', 'fact', 'reference', 'narrative-blueprint',
      ],
      allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
      maxReadCalls: 4,
      maxRetrievedTokens: 24_000,
      maxPlanningSteps: 5,
      maxPlanningModelTokens: 24_000,
      allowOriginalRead: true,
      additionalReadToolNames: [
        'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
      ],
    },
    maxOutputTokens: 6_000,
    writeTargets: [{
      table: 'worldviews',
      fields: WORLDVIEW_GENERATABLE_FIELD_SPECS.map(spec => spec.field),
    }],
    lastVerifiedAt: '2026-08-23',
    regressionTests: [
      'R-WE1-worldview-generatable-contract',
      'R-HARNESS32-worldview-field-agent',
      'R-HARNESS32-worldview-panels-ui',
      'R-RACE1-races-gateway-canary',
      'R-RACE2-races-mode-length-contract',
      'R-RACE3-worldview-candidate-review',
      'R-RACE4-races-fault-matrix',
    ],
  },
  {
    version: 1,
    id: 'world-origin.world-link-context',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: '世界通道上下文',
    owner: 'world-foundation-agent',
    promptVersion: 'world-link-context-v1',
    executionMode: 'world-link-context',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: WORLD_SUGGEST_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: {
      sourceKeys: WORLD_SUGGEST_CONTEXT_SOURCE_KEYS,
      states: {
        empty: { handling: 'create-from-request', instruction: '目标世界和通道是强制资源；缺失时停止，不得猜测相邻世界。' },
        partial: { handling: 'reference-and-create', instruction: '只沿指定通道展开一个相邻世界，并保留方向与进出约束。' },
        complete: { handling: 'grounded-transform', instruction: '严格依据目标世界和指定通道资源工作，不得跨第二跳读取。' },
      },
    },
    contextCompression: WORLD_SUGGEST_COMPRESSION_POLICY,
    contextGateway: {
      version: 1,
      rollout: 'required',
      requiredWriteTargets: [],
      providerSourceKeys: ['ragSelection'],
      allowedResourceKinds: [
        'world', 'world-link', 'worldview-field', 'story-core-field', 'character',
        'character-relation', 'story-arc', 'outline-node', 'chapter', 'fact', 'codex-entry',
      ],
      allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
      maxReadCalls: 3,
      maxRetrievedTokens: 16_000,
      maxPlanningSteps: 3,
      maxPlanningModelTokens: 12_000,
      allowOriginalRead: true,
      additionalReadToolNames: [
        'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
      ],
    },
    maxOutputTokens: 2_000,
    writeTargets: [],
    lastVerifiedAt: '2026-08-23',
    regressionTests: ['R-MW1-world-link-governance'],
  },
  {
    version: 1,
    id: 'world-origin.world-suggest',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: '多世界建议',
    owner: 'world-foundation-agent',
    promptVersion: 'world-suggest-v1',
    executionMode: 'world-suggest',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: WORLD_SUGGEST_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: {
      sourceKeys: WORLD_SUGGEST_CONTEXT_SOURCE_KEYS,
      states: {
        empty: { handling: 'create-from-request', instruction: '只依据作者本轮概念生成新世界候选，不得声称已有不存在的世界或故事核心。' },
        partial: { handling: 'reference-and-create', instruction: '锁定已有世界目录或故事核心，只建议尚不存在且有差异化的新世界。' },
        complete: { handling: 'grounded-transform', instruction: '严格依据当前世界目录和故事核心建议递进世界，不得改写已有世界。' },
      },
    },
    contextCompression: WORLD_SUGGEST_COMPRESSION_POLICY,
    maxOutputTokens: 4_000,
    writeTargets: [{
      table: 'worldGroups',
      fields: ['name', 'type', 'description', 'icon', 'order', 'entryCondition', 'powerRestriction', 'plannedChapterCount'],
    }],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS68-world-suggest-durable'],
  },
  {
    version: 1,
    id: 'world-origin.worldview-expand',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: '世界组七字段扩写',
    owner: 'world-foundation-agent',
    promptVersion: 'worldview-expand-v1',
    executionMode: 'worldview-expand',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: WORLDVIEW_EXPAND_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: {
      sourceKeys: WORLDVIEW_EXPAND_CONTEXT_SOURCE_KEYS,
      states: {
        empty: { handling: 'create-from-request', instruction: '只依据作者已保存的世界草稿创建七字段候选，不得声称引用了不存在的设定。' },
        partial: { handling: 'reference-and-create', instruction: '锁定已有世界观和故事核心，只补足本次七字段候选并保持其它世界差异化。' },
        complete: { handling: 'grounded-transform', instruction: '严格依据当前世界正式设定扩写七字段，禁止覆盖非目标字段或其它世界。' },
      },
    },
    contextCompression: WORLDVIEW_EXPAND_COMPRESSION_POLICY,
    maxOutputTokens: 8_000,
    writeTargets: [{
      table: 'worldviews',
      fields: ['worldOrigin', 'powerHierarchy', 'continentLayout', 'climateByRegion', 'historyLine', 'races', 'factionLayout'],
    }],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS67-worldview-expand-durable'],
  },
  {
    version: 1,
    id: 'world-origin.constitution-extract',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: '世界宪法设定断言抽取',
    owner: 'world-foundation-agent',
    promptVersion: 'constitution-extract-v1',
    executionMode: 'constitution-extract',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: CONSTITUTION_EXTRACT_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: {
      sourceKeys: CONSTITUTION_EXTRACT_CONTEXT_SOURCE_KEYS,
      states: {
        empty: { handling: 'require-upstream', instruction: '没有已登记非空设定源时不调用模型，不创造断言。' },
        partial: { handling: 'grounded-transform', instruction: '只从当前登记源、主题、主体和逐字证据闭集抽取候选。' },
        complete: { handling: 'grounded-transform', instruction: '只从完整登记闭集抽取候选，不确认或取代 Canon。' },
      },
    },
    contextCompression: CONSTITUTION_EXTRACT_COMPRESSION_POLICY,
    maxOutputTokens: 8_000,
    writeTargets: [{ table: 'temporalFacts', fields: [], adoptionExtension: 'fact-ledger' }],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS69-constitution-extraction-durable'],
  },
  {
    version: 1,
    id: 'world-origin.codex-extract',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: 'Codex 内容分块词条抽取',
    owner: 'world-foundation-agent',
    promptVersion: 'codex-extract-v1',
    executionMode: 'codex-extract',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: CODEX_EXTRACT_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: {
      sourceKeys: CODEX_EXTRACT_CONTEXT_SOURCE_KEYS,
      states: {
        empty: { handling: 'require-upstream', instruction: '缺少作者来源或登记分类基线时不调用模型。' },
        partial: { handling: 'require-upstream', instruction: '必须同时冻结作者来源、目标分类 schema 和同类既有词条。' },
        complete: { handling: 'grounded-transform', instruction: '只按当前分类字段闭集拆分可确认词条，不写入未选候选。' },
      },
    },
    contextCompression: CODEX_EXTRACT_COMPRESSION_POLICY,
    contextGateway: {
      version: 1,
      rollout: 'required',
      requiredWriteTargets: CODEX_CANDIDATE_WRITE_FIELDS.map(field => `codexEntries.${field}`),
      providerSourceKeys: ['ragSelection'],
      allowedResourceKinds: ['codex-entry'],
      allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
      maxReadCalls: 2,
      maxRetrievedTokens: 20_000,
      maxPlanningSteps: 2,
      maxPlanningModelTokens: 8_000,
      allowOriginalRead: true,
      additionalReadToolNames: [
        'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
      ],
    },
    maxOutputTokens: 4_000,
    writeTargets: [{
      table: 'codexEntries',
      fields: [...CODEX_CANDIDATE_WRITE_FIELDS],
    }],
    lastVerifiedAt: '2026-08-24',
    regressionTests: [
      'R-HARNESS70-codex-extraction-durable',
      'R-RACE5-codex-extraction-enrichment',
      'R-CODEX1-gateway-provenance',
    ],
  },
  {
    version: 1,
    id: 'world-origin.codex-enrich',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: 'Codex AI 新建词条建议',
    owner: 'world-foundation-agent',
    promptVersion: 'codex-enrich-v1',
    executionMode: 'codex-enrich',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: CODEX_ENRICH_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: {
      sourceKeys: CODEX_ENRICH_CONTEXT_SOURCE_KEYS,
      states: {
        empty: { handling: 'require-upstream', instruction: '缺少世界 Canon 或分类基线时不创建建议。' },
        partial: { handling: 'reference-and-create', instruction: '在已登记世界 Canon 范围内生成明确标记的 AI 新建建议。' },
        complete: { handling: 'reference-and-create', instruction: '结合完整上下文创建新词条建议，不自动改写任何 Canon。' },
      },
    },
    contextCompression: CODEX_ENRICH_COMPRESSION_POLICY,
    contextGateway: {
      version: 1,
      rollout: 'required',
      requiredWriteTargets: CODEX_CANDIDATE_WRITE_FIELDS.map(field => `codexEntries.${field}`),
      providerSourceKeys: ['ragSelection'],
      allowedResourceKinds: [
        'world', 'worldview-field', 'story-core-field', 'character', 'character-relation',
        'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'chapter',
        'foreshadow', 'location', 'codex-entry', 'fact', 'reference', 'narrative-blueprint',
      ],
      allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
      maxReadCalls: 4,
      maxRetrievedTokens: 32_000,
      maxPlanningSteps: 5,
      maxPlanningModelTokens: 24_000,
      allowOriginalRead: true,
      additionalReadToolNames: [
        'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
      ],
    },
    maxOutputTokens: 4_000,
    writeTargets: [{
      table: 'codexEntries',
      fields: [...CODEX_CANDIDATE_WRITE_FIELDS],
    }],
    lastVerifiedAt: '2026-08-24',
    regressionTests: ['R-RACE5-codex-extraction-enrichment', 'R-CODEX1-gateway-provenance'],
  },
  {
    version: 1,
    id: 'world-origin.story-core',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: '故事核心单字段生成',
    owner: 'world-foundation-agent',
    promptVersion: 'story-core-copilot-v1',
    executionMode: 'story-core',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: STORY_CORE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: STORY_CORE_INPUT_POLICY,
    contextCompression: STORY_CORE_COMPRESSION_POLICY,
    contextGateway: {
      version: 1,
      rollout: 'required',
      requiredWriteTargets: STORY_CORE_GENERATABLE_FIELD_SPECS.map(spec => `storyCores.${spec.field}`),
      providerSourceKeys: ['ragSelection'],
      allowedResourceKinds: [
        'world', 'worldview-field', 'story-core-field', 'character',
        'character-relation', 'story-arc', 'storyline-progress', 'outline-node',
        'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry',
        'world-link', 'fact', 'reference', 'narrative-blueprint',
      ],
      allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
      maxReadCalls: 4,
      maxRetrievedTokens: 24_000,
      maxPlanningSteps: 5,
      maxPlanningModelTokens: 24_000,
      allowOriginalRead: true,
      additionalReadToolNames: [
        'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
      ],
    },
    maxOutputTokens: 6_000,
    writeTargets: [{
      table: 'storyCores',
      fields: STORY_CORE_GENERATABLE_FIELD_SPECS.map(spec => spec.field),
    }],
    lastVerifiedAt: '2026-08-23',
    regressionTests: [
      'R-HARNESS31-story-core-agent',
      'R-HARNESS31-story-core-panel-ui',
    ],
  },
  {
    version: 1,
    id: 'world-origin.creative-rules',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: '创作规则单字段建议',
    owner: 'world-foundation-agent',
    promptVersion: 'creative-rules-copilot-v1',
    executionMode: 'creative-rules',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: CREATIVE_RULES_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: CREATIVE_RULES_INPUT_POLICY,
    contextCompression: CREATIVE_RULES_COMPRESSION_POLICY,
    maxOutputTokens: 4_000,
    writeTargets: [{
      table: 'creativeRules',
      fields: ['writingStyle', 'atmosphere', 'specialRequirements'],
    }],
    lastVerifiedAt: '2026-08-10',
    regressionTests: [
      'R-HARNESS39-creative-rules-agent',
      'R-HARNESS39-creative-rules-panel-ui',
    ],
  },
  {
    version: 1,
    id: 'character.create',
    agentId: 'character',
    defaultForAgent: true,
    label: '角色创建',
    owner: 'character-agent',
    promptVersion: 'character-copilot-v1',
    executionMode: 'create',
    contextTaskKind: 'agent-character',
    readToolNames: [],
    contextSourceKeys: [...CHARACTER_INPUT_POLICY.sourceKeys],
    optionalContextSourceKeys: [],
    inputPolicy: CHARACTER_INPUT_POLICY,
    contextCompression: CHARACTER_COMPRESSION_POLICY,
    contextGateway: {
      version: 1,
      rollout: 'required',
      requiredWriteTargets: ['characters.name'],
      providerSourceKeys: ['ragSelection'],
      allowedResourceKinds: [
        'world', 'worldview-field', 'story-core-field', 'character',
        'character-relation', 'story-arc', 'storyline-progress', 'outline-node',
        'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry',
        'world-link', 'fact', 'reference', 'narrative-blueprint',
      ],
      allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
      maxReadCalls: 5,
      maxRetrievedTokens: 32_000,
      maxPlanningSteps: 6,
      maxPlanningModelTokens: 32_000,
      allowOriginalRead: true,
      additionalReadToolNames: [
        'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
      ],
    },
    maxOutputTokens: 6_000,
    writeTargets: [{
      table: 'characters',
      fields: [
        'name',
        'roleWeight',
        'moralAxis',
        'orderAxis',
        'relationships',
        ...CHARACTER_DIMENSIONS.map(dimension => dimension.key),
      ],
    }],
    lastVerifiedAt: '2026-08-09',
    regressionTests: ['R-AGENT1-chat-copilot-character', 'R-HARNESS33-character-panel-ui', 'R-HARNESS2-master-terminal-verifier', 'R-HARNESS16-semantic-context-compression', 'R-HARNESS18-execution-version-freshness'],
  },
  {
    version: 1,
    id: 'world-origin.locations',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: '已写正文重要地点提取',
    owner: 'world-foundation-agent',
    promptVersion: 'location-extract-v1',
    executionMode: 'locations',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: ['chapterContent', 'locations'],
    optionalContextSourceKeys: [],
    inputPolicy: WORLD_LOCATION_EXTRACTION_INPUT_POLICY,
    contextCompression: WORLD_LOCATION_EXTRACTION_COMPRESSION_POLICY,
    maxOutputTokens: 4_000,
    writeTargets: [{
      table: 'importantLocations',
      fields: ['name', 'tags', 'description', 'significance', 'parentId', 'sortOrder'],
    }],
    lastVerifiedAt: '2026-08-13',
    regressionTests: ['R-HARNESS62-location-extraction-durable'],
  },
  {
    version: 1,
    id: 'world-origin.map-config',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: '世界地图配置生成',
    owner: 'world-foundation-agent',
    promptVersion: 'world-map-config-v1',
    executionMode: 'map-config',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: WORLD_MAP_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: WORLD_MAP_INPUT_POLICY,
    contextCompression: WORLD_MAP_COMPRESSION_POLICY,
    maxOutputTokens: 6_000,
    writeTargets: [{ table: 'worldNodes', fields: ['mapConfigJSON'] }],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS66-world-map-durable'],
  },
  {
    version: 1,
    id: 'world-origin.history-consult',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: '历史条目考据',
    owner: 'world-foundation-agent',
    promptVersion: 'history-consult-v1',
    executionMode: 'history-consult',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: HISTORY_AGENT_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: HISTORY_AGENT_INPUT_POLICY,
    contextCompression: HISTORY_AGENT_COMPRESSION_POLICY,
    maxOutputTokens: 5_000,
    writeTargets: [
      { table: 'historicalTimelineEvents', fields: ['aiConsult'] },
      { table: 'historicalKeywords', fields: ['aiConsult'] },
    ],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS73-history-agent-durable'],
  },
  {
    version: 1,
    id: 'world-origin.history-storm',
    agentId: 'world-origin',
    defaultForAgent: false,
    label: '历史条目头脑风暴',
    owner: 'world-foundation-agent',
    promptVersion: 'history-storm-v1',
    executionMode: 'history-storm',
    contextTaskKind: 'agent-world-origin',
    readToolNames: [],
    contextSourceKeys: HISTORY_AGENT_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: HISTORY_AGENT_INPUT_POLICY,
    contextCompression: HISTORY_AGENT_COMPRESSION_POLICY,
    maxOutputTokens: 5_000,
    writeTargets: [
      { table: 'historicalTimelineEvents', fields: ['aiBrainstorm'] },
      { table: 'historicalKeywords', fields: ['aiBrainstorm'] },
    ],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS73-history-agent-durable'],
  },
  {
    version: 1,
    id: 'character.supplement',
    agentId: 'character',
    defaultForAgent: false,
    label: '已有角色定向补全',
    owner: 'character-agent',
    promptVersion: 'character-supplement-copilot-v1',
    executionMode: 'supplement',
    contextTaskKind: 'agent-character',
    readToolNames: [],
    contextSourceKeys: CHARACTER_SUPPLEMENT_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: CHARACTER_SUPPLEMENT_OPTIONAL_CONTEXT_SOURCE_KEYS,
    inputPolicy: CHARACTER_SUPPLEMENT_INPUT_POLICY,
    contextCompression: CHARACTER_SUPPLEMENT_COMPRESSION_POLICY,
    contextGateway: {
      version: 1,
      rollout: 'required',
      requiredWriteTargets: CHARACTER_DIMENSIONS.map(dimension => `characters.${dimension.key}`),
      providerSourceKeys: ['ragSelection'],
      allowedResourceKinds: [
        'world', 'worldview-field', 'story-core-field', 'character',
        'character-relation', 'story-arc', 'storyline-progress', 'outline-node',
        'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry',
        'world-link', 'fact', 'reference', 'narrative-blueprint',
      ],
      allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
      maxReadCalls: 5,
      maxRetrievedTokens: 48_000,
      maxPlanningSteps: 6,
      maxPlanningModelTokens: 48_000,
      allowOriginalRead: true,
      additionalReadToolNames: [
        'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
      ],
    },
    maxOutputTokens: 8_000,
    writeTargets: [{
      table: 'characters',
      fields: CHARACTER_DIMENSIONS.map(dimension => dimension.key),
    }],
    lastVerifiedAt: '2026-08-09',
    regressionTests: ['R-HARNESS38-character-supplement-agent', 'R-HARNESS38-character-supplement-ui'],
  },
  {
    version: 1,
    id: 'character.lifecycle',
    agentId: 'character',
    defaultForAgent: false,
    label: '角色状态演化与退场',
    owner: 'character-agent',
    promptVersion: 'character-lifecycle-copilot-v1',
    executionMode: 'lifecycle',
    contextTaskKind: 'agent-character',
    readToolNames: [],
    contextSourceKeys: CHARACTER_SUPPLEMENT_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: CHARACTER_SUPPLEMENT_OPTIONAL_CONTEXT_SOURCE_KEYS,
    inputPolicy: CHARACTER_SUPPLEMENT_INPUT_POLICY,
    contextCompression: CHARACTER_SUPPLEMENT_COMPRESSION_POLICY,
    contextGateway: {
      version: 1,
      rollout: 'required',
      requiredWriteTargets: [
        'characters.narrativeStatus', 'characters.statusEvidenceChapterId',
        'characters.statusEvidenceStoryArcId', 'characters.statusReason',
        'characters.exitChapterId', 'characters.ending', 'characters.activeChapterRange',
        'characters.statusProducerContractHash', 'characters.statusProducerCandidateHash',
      ],
      providerSourceKeys: ['ragSelection'],
      allowedResourceKinds: [
        'world', 'worldview-field', 'story-core-field', 'character',
        'character-relation', 'story-arc', 'storyline-progress', 'outline-node',
        'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry',
        'world-link', 'fact', 'narrative-blueprint',
      ],
      allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
      maxReadCalls: 5,
      maxRetrievedTokens: 48_000,
      maxPlanningSteps: 6,
      maxPlanningModelTokens: 48_000,
      allowOriginalRead: true,
      additionalReadToolNames: [
        'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
      ],
    },
    maxOutputTokens: 4_000,
    writeTargets: [{
      table: 'characters',
      fields: [
        'narrativeStatus', 'statusEvidenceChapterId', 'statusEvidenceStoryArcId',
        'statusReason', 'exitChapterId', 'ending', 'activeChapterRange',
        'statusProducerContractHash', 'statusProducerCandidateHash',
      ],
    }],
    lastVerifiedAt: '2026-08-23',
    regressionTests: ['R-CHAR1-character-gateway-contract', 'R-CHAR1-character-lifecycle-ui'],
  },
  {
    version: 1,
    id: 'character.relationships',
    agentId: 'character',
    defaultForAgent: false,
    label: '角色关系证据提取',
    owner: 'character-agent',
    promptVersion: 'character-relationships-v1',
    executionMode: 'relationships',
    contextTaskKind: 'agent-character',
    readToolNames: [],
    contextSourceKeys: CHARACTER_RELATIONSHIP_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: CHARACTER_RELATIONSHIP_INPUT_POLICY,
    contextCompression: CHARACTER_RELATIONSHIP_COMPRESSION_POLICY,
    maxOutputTokens: 4_000,
    writeTargets: [
      { table: 'characterRelations', fields: ['fromCharacterId', 'toCharacterId', 'relationType', 'label', 'description', 'isBidirectional'] },
      { table: 'characters', fields: ['relationships'] },
    ],
    lastVerifiedAt: '2026-08-13',
    regressionTests: ['R-HARNESS60-character-relationship-durable'],
  },
  {
    version: 1,
    id: 'inspiration.reference-summary',
    agentId: 'inspiration',
    defaultForAgent: false,
    label: '参考分析全书总结',
    owner: 'inspiration-agent',
    promptVersion: 'reference-derived-v1',
    executionMode: 'reference-summary',
    contextTaskKind: 'agent-inspiration',
    readToolNames: [],
    contextSourceKeys: REFERENCE_DERIVED_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: REFERENCE_DERIVED_INPUT_POLICY,
    contextCompression: REFERENCE_DERIVED_COMPRESSION_POLICY,
    maxOutputTokens: 4_096,
    writeTargets: [
      { table: 'referenceAnalysisRuns', fields: ['analysisSummary'] },
      { table: 'references', fields: ['analysisSummary'], adoptionExtension: 'reference-analysis-reference-lifecycle' },
    ],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS74-reference-derived-durable'],
  },
  {
    version: 1,
    id: 'inspiration.reference-characters',
    agentId: 'inspiration',
    defaultForAgent: false,
    label: '参考分析角色卡聚合',
    owner: 'inspiration-agent',
    promptVersion: 'reference-derived-v1',
    executionMode: 'reference-characters',
    contextTaskKind: 'agent-inspiration',
    readToolNames: [],
    contextSourceKeys: REFERENCE_DERIVED_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: REFERENCE_DERIVED_INPUT_POLICY,
    contextCompression: REFERENCE_DERIVED_COMPRESSION_POLICY,
    maxOutputTokens: 4_096,
    writeTargets: [
      { table: 'referenceAnalysisRuns', fields: ['mergedCharacters'] },
      { table: 'references', fields: ['mergedCharacters'], adoptionExtension: 'reference-analysis-reference-lifecycle' },
    ],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS74-reference-derived-durable'],
  },
  {
    version: 1,
    id: 'inspiration.reverse',
    agentId: 'inspiration',
    defaultForAgent: true,
    label: '灵感反推',
    owner: 'inspiration-agent',
    promptVersion: 'inspiration-copilot-v1',
    executionMode: 'reverse',
    contextTaskKind: 'agent-inspiration',
    readToolNames: ['read_inspiration_workspace'],
    contextSourceKeys: [],
    optionalContextSourceKeys: [],
    inputPolicy: INSPIRATION_INPUT_POLICY,
    contextCompression: INSPIRATION_COMPRESSION_POLICY,
    maxOutputTokens: 8_000,
    writeTargets: [{ table: 'inspirationWorkspaces', fields: ['versions'] }],
    lastVerifiedAt: '2026-08-09',
    regressionTests: ['R-AGENT1-chat-copilot-inspiration', 'R-CM1-inspiration-fusion-ui', 'R-HARNESS34-inspiration-entry', 'R-HARNESS34-inspiration-panel-ui', 'R-HARNESS2-master-terminal-verifier', 'R-HARNESS16-semantic-context-compression', 'R-HARNESS18-execution-version-freshness'],
  },
  {
    version: 1,
    id: 'inspiration.review',
    agentId: 'inspiration',
    defaultForAgent: false,
    label: '灵感反推证据型语义终验',
    owner: 'inspiration-agent',
    promptVersion: 'inspiration-semantic-review-v1',
    executionMode: 'review',
    contextTaskKind: 'agent-inspiration',
    readToolNames: [],
    contextSourceKeys: ['inspirationWorkspace'],
    optionalContextSourceKeys: [],
    inputPolicy: INSPIRATION_INPUT_POLICY,
    contextCompression: INSPIRATION_COMPRESSION_POLICY,
    maxOutputTokens: 3_000,
    writeTargets: [],
    lastVerifiedAt: '2026-08-09',
    regressionTests: ['R-HARNESS27-master-candidate-semantic-review'],
  },
  {
    version: 1,
    id: 'outline.story-arcs',
    agentId: 'outline',
    defaultForAgent: false,
    label: '主线与支线编排',
    owner: 'outline-agent',
    promptVersion: 'story-arc-copilot-v8',
    executionMode: 'story-arcs',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: OUTLINE_STORY_ARC_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: OUTLINE_STORY_ARC_INPUT_POLICY,
    contextCompression: OUTLINE_STORY_ARC_COMPRESSION_POLICY,
    contextGateway: {
      version: 1,
      rollout: 'required',
      requiredWriteTargets: ['storyArcs.name', 'storyArcs.type', 'storyArcs.stages', 'storyArcs.description'],
      providerSourceKeys: ['ragSelection'],
      allowedResourceKinds: [
        'world', 'worldview-field', 'story-core-field', 'character',
        'character-relation', 'story-arc', 'storyline-progress', 'outline-node',
        'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry',
        'world-link', 'fact', 'reference', 'narrative-blueprint',
      ],
      allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
      maxReadCalls: 5,
      maxRetrievedTokens: 48_000,
      maxPlanningSteps: 6,
      maxPlanningModelTokens: 48_000,
      allowOriginalRead: true,
      additionalReadToolNames: [
        'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
      ],
    },
    maxOutputTokens: 10_000,
    writeTargets: [{
      table: 'storyArcs',
      fields: [
        'name', 'type', 'stages', 'description', 'origin', 'status',
        'sourceStoryCoreId', 'sourceStoryCoreRevision', 'sourceStoryCoreHash',
        'lastAlignedHash', 'producerRunId', 'producerCandidateHash',
      ],
    }],
    lastVerifiedAt: '2026-08-23',
    regressionTests: [
      'R-HARNESS30-story-arc-agent',
      'R-HARNESS30-story-arc-panel-ui',
    ],
  },
  {
    version: 1,
    id: 'outline.storyline-progress',
    agentId: 'outline',
    defaultForAgent: false,
    label: '章节故事线进度映射',
    owner: 'outline-agent',
    promptVersion: 'storyline-progress-copilot-v1',
    executionMode: 'storyline-progress',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: OUTLINE_STORYLINE_PROGRESS_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: OUTLINE_STORYLINE_PROGRESS_INPUT_POLICY,
    contextCompression: OUTLINE_STORYLINE_PROGRESS_COMPRESSION_POLICY,
    maxOutputTokens: 8_000,
    writeTargets: [
      { table: 'storylineProgress', fields: ['arcId', 'currentStageId', 'status', 'progressNote', 'lastActiveChapterId', 'lastActiveChapterTitle', 'involvedEntities', 'evidenceQuote'] },
      { table: 'storylineCrossings', fields: ['arcIdA', 'arcIdB', 'chapterId', 'chapterTitle', 'note', 'evidenceQuote'] },
      { table: 'storyArcs', fields: ['name', 'type', 'description', 'stages'] },
    ],
    lastVerifiedAt: '2026-08-10',
    regressionTests: ['R-HARNESS40-storyline-progress-agent', 'R-PHASE39-storyline-progress-ui'],
  },
  {
    version: 1,
    id: 'outline.character-driven',
    agentId: 'outline',
    defaultForAgent: false,
    label: '角色弧光卷章编排',
    owner: 'outline-agent',
    promptVersion: 'character-driven-copilot-v1',
    executionMode: 'character-driven',
    contextTaskKind: 'agent-outline',
    readToolNames: ['read_character_driven_plan'],
    contextSourceKeys: OUTLINE_CHARACTER_DRIVEN_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: OUTLINE_CHARACTER_DRIVEN_INPUT_POLICY,
    contextCompression: OUTLINE_CHARACTER_DRIVEN_COMPRESSION_POLICY,
    maxOutputTokens: 12_000,
    writeTargets: [{ table: 'characterDrivenPlans', fields: ['generatedVolumes', 'status'] }],
    lastVerifiedAt: '2026-08-09',
    regressionTests: [
      'R-HARNESS35-character-driven-agent',
      'R-HARNESS35-character-driven-panel-ui',
    ],
  },
  {
    version: 1,
    id: 'outline.character-revision',
    agentId: 'outline',
    defaultForAgent: false,
    label: '角色变更影响与中途重规划',
    owner: 'outline-agent',
    promptVersion: 'character-revision-copilot-v1',
    executionMode: 'character-revision',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: OUTLINE_CHARACTER_REVISION_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: OUTLINE_CHARACTER_REVISION_INPUT_POLICY,
    contextCompression: OUTLINE_CHARACTER_REVISION_COMPRESSION_POLICY,
    maxOutputTokens: 12_000,
    writeTargets: [
      { table: 'outlineNodes', fields: ['title', 'summary'] },
      { table: 'chapters', fields: ['title'] },
    ],
    lastVerifiedAt: '2026-08-09',
    regressionTests: [
      'R-HARNESS36-character-revision-agent',
      'R-HARNESS36-character-revision-panel-ui',
    ],
  },
  {
    version: 1,
    id: 'outline.impact-summary-regenerate',
    agentId: 'outline',
    defaultForAgent: false,
    label: '影响计划后续章纲摘要重建',
    owner: 'outline-agent',
    promptVersion: 'impact-outline-regeneration-v1',
    executionMode: 'impact-summary-regenerate',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: OUTLINE_IMPACT_REGENERATION_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: OUTLINE_IMPACT_REGENERATION_INPUT_POLICY,
    contextCompression: OUTLINE_IMPACT_REGENERATION_COMPRESSION_POLICY,
    maxOutputTokens: 2_000,
    writeTargets: [{ table: 'outlineNodes', fields: ['summary'] }],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS77-impact-outline-regeneration'],
  },
  {
    version: 1,
    id: 'outline.adaptation-brief',
    agentId: 'outline',
    defaultForAgent: false,
    label: '小说改编 Brief 候选',
    owner: 'outline-agent',
    promptVersion: 'adaptation-brief-v1',
    executionMode: 'adaptation-brief',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ADAPTATION_BRIEF_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: ADAPTATION_INPUT_POLICY,
    contextCompression: ADAPTATION_COMPRESSION_POLICY,
    maxOutputTokens: 6_000,
    writeTargets: [{ table: 'adaptationProjects', fields: ['brief'] }],
    lastVerifiedAt: '2026-08-22',
    regressionTests: ['R-ADAPTCORE1B-durable-candidates'],
  },
  {
    version: 1,
    id: 'outline.adaptation-impact',
    agentId: 'outline',
    defaultForAgent: false,
    label: '改编来源变化影响分析',
    owner: 'outline-agent',
    promptVersion: 'adaptation-impact-v1',
    executionMode: 'adaptation-impact',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ['adaptation.sourceManifest'],
    optionalContextSourceKeys: ['adaptation.currentBrief', 'adaptation.currentPlan', 'screenplay.currentScenes'],
    inputPolicy: { ...ADAPTATION_INPUT_POLICY, sourceKeys: ['adaptation.sourceManifest'] },
    contextCompression: compressionPolicy(['adaptation.sourceManifest']),
    maxOutputTokens: 4_000,
    writeTargets: [],
    lastVerifiedAt: '2026-08-22',
    regressionTests: ['R-ADAPTCORE1B-durable-candidates'],
  },
  {
    version: 1,
    id: 'outline.screenplay-plan',
    agentId: 'outline',
    defaultForAgent: false,
    label: '剧本幕集序列计划',
    owner: 'outline-agent',
    promptVersion: 'screenplay-plan-v1',
    executionMode: 'screenplay-plan',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ADAPTATION_PLAN_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: ADAPTATION_INPUT_POLICY,
    contextCompression: ADAPTATION_COMPRESSION_POLICY,
    maxOutputTokens: 8_000,
    writeTargets: [{ table: 'adaptationProjects', fields: ['plan'] }],
    lastVerifiedAt: '2026-08-22',
    regressionTests: ['R-ADAPTCORE1B-durable-candidates'],
  },
  {
    version: 1,
    id: 'prose.screenplay-scenes',
    agentId: 'prose',
    defaultForAgent: false,
    label: '正规剧本场景批次',
    owner: 'prose-agent',
    promptVersion: 'screenplay-scenes-v1',
    executionMode: 'screenplay-scenes',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: SCREENPLAY_SCENES_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: ADAPTATION_INPUT_POLICY,
    contextCompression: ADAPTATION_COMPRESSION_POLICY,
    maxOutputTokens: 14_000,
    writeTargets: [{ table: 'screenplayScenes', fields: ['planSectionKey', 'intExt', 'location', 'timeOfDay', 'summary', 'estimatedSeconds', 'sourceUnitIds', 'blocks'], adoptionExtension: 'screenplay-scene-lifecycle' }],
    lastVerifiedAt: '2026-08-22',
    regressionTests: ['R-ADAPTCORE1B-durable-candidates'],
  },
  {
    version: 1,
    id: 'outline.comic-plan',
    agentId: 'outline',
    defaultForAgent: false,
    label: '漫画章页节奏计划',
    owner: 'outline-agent',
    promptVersion: 'comic-plan-v1',
    executionMode: 'comic-plan',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ADAPTATION_PLAN_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: ADAPTATION_INPUT_POLICY,
    contextCompression: ADAPTATION_COMPRESSION_POLICY,
    maxOutputTokens: 8_000,
    writeTargets: [{ table: 'adaptationProjects', fields: ['plan'] }],
    lastVerifiedAt: '2026-08-22',
    regressionTests: ['R-COMIC1-complete-workflow'],
  },
  {
    version: 1,
    id: 'outline.comic-storyboard',
    agentId: 'outline',
    defaultForAgent: false,
    label: '漫画页格分镜批次',
    owner: 'outline-agent',
    promptVersion: 'comic-storyboard-v1',
    executionMode: 'comic-storyboard',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: COMIC_STORYBOARD_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: ADAPTATION_INPUT_POLICY,
    contextCompression: ADAPTATION_COMPRESSION_POLICY,
    maxOutputTokens: 18_000,
    writeTargets: [
      { table: 'comicPages', fields: ['summary'], adoptionExtension: 'comic-page-panel-lifecycle' },
      { table: 'comicPanels', fields: ['frame', 'shot', 'action', 'visualPrompt', 'negativePrompt', 'continuityRefs', 'lettering', 'sourceUnitIds'], adoptionExtension: 'comic-panel-lifecycle' },
    ],
    lastVerifiedAt: '2026-08-22',
    regressionTests: ['R-COMIC1-complete-workflow'],
  },
  {
    version: 1,
    id: 'outline.compose',
    agentId: 'outline',
    defaultForAgent: true,
    label: '卷章纲编排',
    owner: 'outline-agent',
    promptVersion: 'outline-copilot-v2',
    executionMode: 'auto',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: OUTLINE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: ['priorOutlineCandidate'],
    inputPolicy: OUTLINE_VOLUME_INPUT_POLICY,
    contextCompression: OUTLINE_COMPRESSION_POLICY,
    contextGateway: OUTLINE_CONTEXT_GATEWAY_POLICY,
    maxOutputTokens: 12_000,
    writeTargets: [{ table: 'outlineNodes', fields: ['parentId', 'type', 'title', 'summary', 'order'] }],
    lastVerifiedAt: '2026-08-24',
    regressionTests: ['R-WEH0-skill-runtime-contract', 'R-AGENT1-chat-copilot-outline', 'R-HARNESS11-outline-batch-durable', 'R-HARNESS16-semantic-context-compression', 'R-HARNESS18-execution-version-freshness'],
  },
  {
    version: 1,
    id: 'outline.volumes',
    agentId: 'outline',
    defaultForAgent: false,
    label: '卷纲编排',
    owner: 'outline-agent',
    promptVersion: 'outline-copilot-v2',
    executionMode: 'volumes',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: OUTLINE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: ['priorOutlineCandidate'],
    inputPolicy: OUTLINE_VOLUME_INPUT_POLICY,
    contextCompression: OUTLINE_COMPRESSION_POLICY,
    contextGateway: OUTLINE_CONTEXT_GATEWAY_POLICY,
    maxOutputTokens: 8_000,
    writeTargets: [{ table: 'outlineNodes', fields: ['parentId', 'type', 'title', 'summary', 'order'] }],
    lastVerifiedAt: '2026-08-24',
    regressionTests: ['R-WEH0-skill-runtime-contract', 'R-HARNESS14-workflow-classifier', 'R-AGENT1-chat-copilot-outline', 'R-HARNESS16-semantic-context-compression', 'R-HARNESS18-execution-version-freshness'],
  },
  {
    version: 1,
    id: 'outline.chapters',
    agentId: 'outline',
    defaultForAgent: false,
    label: '章纲编排',
    owner: 'outline-agent',
    promptVersion: 'outline-copilot-v2',
    executionMode: 'chapters',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: OUTLINE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: ['priorOutlineCandidate'],
    inputPolicy: OUTLINE_CHAPTER_INPUT_POLICY,
    contextCompression: OUTLINE_COMPRESSION_POLICY,
    contextGateway: OUTLINE_CONTEXT_GATEWAY_POLICY,
    maxOutputTokens: 12_000,
    writeTargets: [{ table: 'outlineNodes', fields: ['parentId', 'type', 'title', 'summary', 'order'] }],
    lastVerifiedAt: '2026-08-24',
    regressionTests: ['R-WEH0-skill-runtime-contract', 'R-HARNESS14-workflow-classifier', 'R-AGENT1-chat-copilot-outline', 'R-HARNESS16-semantic-context-compression', 'R-HARNESS18-execution-version-freshness'],
  },
  {
    version: 1,
    id: 'outline.details',
    agentId: 'outline',
    defaultForAgent: false,
    label: '单章场景细纲',
    owner: 'outline-agent',
    promptVersion: 'detailed-outline-copilot-v2',
    executionMode: 'details',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: OUTLINE_DETAIL_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: OUTLINE_DETAIL_INPUT_POLICY,
    contextCompression: OUTLINE_DETAIL_COMPRESSION_POLICY,
    contextGateway: {
      ...OUTLINE_CONTEXT_GATEWAY_POLICY,
      requiredWriteTargets: [
        'detailedOutlines.scenes',
        'detailedOutlines.openingHook',
        'detailedOutlines.endingCliffhanger',
        'detailedOutlines.sceneLocation',
        'detailedOutlines.appearingCharacterIds',
        'detailedOutlines.foreshadowIds',
        'detailedOutlines.emotionArc',
        'detailedOutlines.prohibitions',
        'detailedOutlines.lastUsedSummary',
      ],
    },
    maxOutputTokens: 8_000,
    writeTargets: [{
      table: 'detailedOutlines',
      fields: [
        'scenes',
        'openingHook',
        'endingCliffhanger',
        'sceneLocation',
        'appearingCharacterIds',
        'foreshadowIds',
        'emotionArc',
        'prohibitions',
        'lastUsedSummary',
      ],
    }],
    lastVerifiedAt: '2026-08-24',
    regressionTests: [
      'R-HARNESS8-detailed-outline-generation-durable',
      'R-HARNESS37-detailed-outline-entry',
    ],
  },
  {
    version: 1,
    id: 'prose.write',
    agentId: 'prose',
    defaultForAgent: true,
    label: '章节正文生成与续写',
    owner: 'prose-agent',
    promptVersion: 'prose-copilot-v1',
    executionMode: 'auto',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: PROSE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_INPUT_POLICY,
    contextCompression: PROSE_COMPRESSION_POLICY,
    contextGateway: PROSE_CONTEXT_GATEWAY_POLICY,
    maxOutputTokens: 16_000,
    writeTargets: [{ table: 'chapters', fields: ['content', 'wordCount'] }],
    lastVerifiedAt: '2026-08-24',
    regressionTests: ['R-WEH0-skill-runtime-contract', 'R-HARNESS7-prose-generation-durable', 'R-HARNESS9-information-boundary', 'R-HARNESS16-semantic-context-compression', 'R-HARNESS18-execution-version-freshness'],
  },
  {
    version: 1,
    id: 'prose.generate',
    agentId: 'prose',
    defaultForAgent: false,
    label: '章节正文生成',
    owner: 'prose-agent',
    promptVersion: 'prose-copilot-v2',
    executionMode: 'generate',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: PROSE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_INPUT_POLICY,
    contextCompression: PROSE_COMPRESSION_POLICY,
    contextGateway: PROSE_CONTEXT_GATEWAY_POLICY,
    maxOutputTokens: 16_000,
    writeTargets: [{ table: 'chapters', fields: ['content', 'wordCount'] }],
    lastVerifiedAt: '2026-08-24',
    regressionTests: ['R-WEH0-skill-runtime-contract', 'R-HARNESS14-workflow-classifier', 'R-HARNESS7-prose-generation-durable', 'R-HARNESS16-semantic-context-compression', 'R-HARNESS17-context-compression-eval', 'R-HARNESS18-execution-version-freshness'],
  },
  {
    version: 1,
    id: 'prose.continue',
    agentId: 'prose',
    defaultForAgent: false,
    label: '章节正文续写',
    owner: 'prose-agent',
    promptVersion: 'prose-copilot-v2',
    executionMode: 'continue',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: PROSE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_INPUT_POLICY,
    contextCompression: PROSE_COMPRESSION_POLICY,
    contextGateway: PROSE_CONTEXT_GATEWAY_POLICY,
    maxOutputTokens: 16_000,
    writeTargets: [{ table: 'chapters', fields: ['content', 'wordCount'] }],
    lastVerifiedAt: '2026-08-24',
    regressionTests: ['R-WEH0-skill-runtime-contract', 'R-HARNESS14-workflow-classifier', 'R-HARNESS7-prose-generation-durable', 'R-HARNESS16-semantic-context-compression', 'R-HARNESS18-execution-version-freshness'],
  },
  {
    version: 1,
    id: 'prose.emotion-beats',
    agentId: 'prose',
    defaultForAgent: false,
    label: '章节情感节拍规划',
    owner: 'prose-agent',
    promptVersion: 'prose-emotion-beats-v1',
    executionMode: 'emotion-beats',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: PROSE_EMOTION_BEAT_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_EMOTION_BEAT_INPUT_POLICY,
    contextCompression: PROSE_EMOTION_BEAT_COMPRESSION_POLICY,
    maxOutputTokens: 3_000,
    writeTargets: [{
      table: 'emotionBeatCards',
      fields: ['chapterId', 'chapterTitle', 'overallArc', 'beats', 'source'],
    }],
    lastVerifiedAt: '2026-08-13',
    regressionTests: ['R-HARNESS61-emotion-beat-durable'],
  },
  {
    version: 1,
    id: 'prose.inventory-extraction',
    agentId: 'prose',
    defaultForAgent: false,
    label: '已写正文物品流水提取',
    owner: 'prose-agent',
    promptVersion: 'inventory-extract-v1',
    executionMode: 'inventory-extraction',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['chapterContent', 'itemLedger', 'characters'],
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_INVENTORY_EXTRACTION_INPUT_POLICY,
    contextCompression: PROSE_INVENTORY_EXTRACTION_COMPRESSION_POLICY,
    maxOutputTokens: 4_000,
    writeTargets: [{
      table: 'itemLedger',
      fields: ['itemName', 'action', 'quantity', 'heldByName', 'characterId', 'chapterId', 'chapterTitle', 'note'],
    }],
    lastVerifiedAt: '2026-08-13',
    regressionTests: ['R-HARNESS63-inventory-extraction-durable'],
  },
  {
    version: 1,
    id: 'prose.story-timeline-extraction',
    agentId: 'prose',
    defaultForAgent: false,
    label: '已写正文故事年表提取',
    owner: 'prose-agent',
    promptVersion: 'story-timeline-extract-v1',
    executionMode: 'story-timeline-extraction',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['chapterContent'],
    optionalContextSourceKeys: ['storyTimelineTarget'],
    inputPolicy: PROSE_STORY_TIMELINE_EXTRACTION_INPUT_POLICY,
    contextCompression: PROSE_STORY_TIMELINE_EXTRACTION_COMPRESSION_POLICY,
    maxOutputTokens: 4_000,
    writeTargets: [{
      table: 'storyTimelineEvents',
      fields: ['title', 'storyTime', 'importance', 'description', 'chapterId', 'chapterTitle', 'order'],
    }],
    lastVerifiedAt: '2026-08-14',
    regressionTests: [
      'R-HARNESS64-story-timeline-extraction-durable',
      'R-HARNESS79-impact-story-timeline-regeneration',
    ],
  },
  {
    version: 1,
    id: 'prose.cultivation-progress-extraction',
    agentId: 'prose',
    defaultForAgent: false,
    label: '已写正文修炼进度提取',
    owner: 'prose-agent',
    promptVersion: 'cultivation-progress-extraction-v1',
    executionMode: 'cultivation-progress-extraction',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: CULTIVATION_PROGRESS_EXTRACTION_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_POST_ADOPTION_INPUT_POLICY,
    contextCompression: CULTIVATION_PROGRESS_EXTRACTION_COMPRESSION_POLICY,
    maxOutputTokens: 4_000,
    writeTargets: [{
      table: 'cultivationProgress',
      fields: [
        'worldGroupId', 'characterId', 'characterName', 'cultivationSystemId',
        'cultivationSystemName', 'stageId', 'stageName', 'transition',
        'sourceChapterId', 'sourceChapterTitle', 'sourceQuote', 'sourceOffset',
        'trigger', 'status',
      ],
      adoptionExtension: 'cultivation-progress-lifecycle',
    }],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS71-cultivation-progress-extraction-durable'],
  },
  {
    version: 1,
    id: 'outline.foreshadow-suggestions',
    agentId: 'outline',
    defaultForAgent: false,
    label: '伏笔规划建议',
    owner: 'outline-agent',
    promptVersion: 'foreshadow-suggestions-v1',
    executionMode: 'foreshadow-suggestions',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: FORESHADOW_SUGGESTION_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: {
      sourceKeys: FORESHADOW_SUGGESTION_CONTEXT_SOURCE_KEYS,
      states: {
        empty: { handling: 'create-from-request', instruction: '项目设定为空时只创建最小伏笔候选，不得声称引用了既有 Canon。' },
        partial: { handling: 'reference-and-create', instruction: '锁定已有世界、角色与伏笔，新增候选不得覆盖或重复作者记录。' },
        complete: { handling: 'grounded-transform', instruction: '依据完整登记上下文设计可埋设、可兑现且不重复的伏笔候选。' },
      },
    },
    contextCompression: FORESHADOW_SUGGESTION_COMPRESSION_POLICY,
    maxOutputTokens: 4_000,
    writeTargets: [{
      table: 'foreshadows',
      fields: ['name', 'type', 'status', 'description', 'plantChapterId', 'echoChapterIds', 'resolveChapterId', 'notes'],
    }],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS72-foreshadow-suggestions-durable'],
  },
  {
    version: 1,
    id: 'prose.style-learn',
    agentId: 'prose',
    defaultForAgent: false,
    label: '作者文风画像学习',
    owner: 'prose-agent',
    promptVersion: 'style-learning-agent-v1',
    executionMode: 'style-learn',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['styleLearningBaseline'],
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_STYLE_LEARNING_INPUT_POLICY,
    contextCompression: PROSE_STYLE_LEARNING_COMPRESSION_POLICY,
    maxOutputTokens: 4_000,
    writeTargets: [{
      table: 'userStyleProfiles',
      fields: ['profile', 'enabled', 'sourceChapterIds', 'sampleCount', 'sampleWords'],
    }],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS76-style-learning-durable'],
  },
  {
    version: 1,
    id: 'prose.selection-edit',
    agentId: 'prose',
    defaultForAgent: false,
    label: '正文局部保真编辑',
    owner: 'prose-agent',
    promptVersion: 'prose-selection-edit-v1',
    executionMode: 'selection-edit',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['manualText'],
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_SELECTION_INPUT_POLICY,
    contextCompression: PROSE_SELECTION_COMPRESSION_POLICY,
    maxOutputTokens: 8_000,
    writeTargets: [{ table: 'chapters', fields: ['content', 'wordCount'] }],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS65-selection-edit-durable'],
  },
  {
    version: 1,
    id: 'prose.selection-check',
    agentId: 'prose',
    defaultForAgent: false,
    label: '正文局部只读查漏',
    owner: 'prose-agent',
    promptVersion: 'prose-selection-check-v1',
    executionMode: 'selection-check',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['manualText'],
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_SELECTION_INPUT_POLICY,
    contextCompression: PROSE_SELECTION_COMPRESSION_POLICY,
    maxOutputTokens: 4_000,
    writeTargets: [],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS65-selection-edit-durable'],
  },
  {
    version: 1,
    id: 'prose.review',
    agentId: 'prose',
    defaultForAgent: false,
    label: '正文证据型语义评审',
    owner: 'prose-agent',
    promptVersion: 'prose-semantic-review-v2',
    executionMode: 'review',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: PROSE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_INPUT_POLICY,
    contextCompression: PROSE_COMPRESSION_POLICY,
    contextGateway: { ...PROSE_CONTEXT_GATEWAY_POLICY, requiredWriteTargets: [] },
    maxOutputTokens: 3_000,
    writeTargets: [],
    lastVerifiedAt: '2026-08-24',
    regressionTests: ['R-WEH0-skill-runtime-contract', 'R-HARNESS19-prose-semantic-review'],
  },
  {
    version: 1,
    id: 'prose.revise',
    agentId: 'prose',
    defaultForAgent: false,
    label: '正文证据定向修订',
    owner: 'prose-agent',
    promptVersion: 'prose-semantic-revision-v2',
    executionMode: 'revise',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: PROSE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_INPUT_POLICY,
    contextCompression: PROSE_COMPRESSION_POLICY,
    contextGateway: { ...PROSE_CONTEXT_GATEWAY_POLICY, requiredWriteTargets: [] },
    maxOutputTokens: 16_000,
    writeTargets: [],
    lastVerifiedAt: '2026-08-24',
    regressionTests: ['R-WEH0-skill-runtime-contract', 'R-HARNESS19-prose-semantic-review'],
  },
  {
    version: 1,
    id: 'prose.organize',
    agentId: 'prose',
    defaultForAgent: false,
    label: '章节七域证据整理',
    owner: 'prose-agent',
    promptVersion: 'chapter-organization-v2',
    executionMode: 'organize',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: PROSE_ORGANIZATION_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_POST_ADOPTION_INPUT_POLICY,
    contextCompression: PROSE_ORGANIZATION_COMPRESSION_POLICY,
    maxOutputTokens: 8_000,
    writeTargets: [
      { table: 'stateCards', fields: ['category', 'entityName', 'fields', 'lastChapterId'] },
      { table: 'temporalFacts', fields: [], adoptionExtension: 'fact-ledger' },
      { table: 'itemLedger', fields: ['itemName', 'action', 'quantity', 'heldByName', 'characterId', 'chapterId', 'chapterTitle', 'note'] },
      { table: 'storyTimelineEvents', fields: ['title', 'storyTime', 'importance', 'description', 'chapterId', 'chapterTitle', 'order'] },
      { table: 'characterRelations', fields: ['fromCharacterId', 'toCharacterId', 'relationType', 'label', 'description', 'isBidirectional'] },
      { table: 'foreshadows', fields: ['status', 'plantChapterId', 'echoChapterIds', 'resolveChapterId', 'notes'] },
      { table: 'storylineProgress', fields: ['arcId', 'currentStageId', 'status', 'progressNote', 'lastActiveChapterId', 'lastActiveChapterTitle', 'involvedEntities', 'evidenceQuote'] },
      { table: 'storylineCrossings', fields: ['arcIdA', 'arcIdB', 'chapterId', 'chapterTitle', 'note', 'evidenceQuote'] },
      { table: 'storyArcs', fields: ['name', 'type', 'description', 'stages'] },
    ],
    lastVerifiedAt: '2026-08-24',
    regressionTests: ['R-AGENT5-chapter-organization', 'R-HARNESS20-chapter-post-adoption-durable', 'R-PROGRESS1-post-adoption-policy'],
  },
  {
    version: 1,
    id: 'prose.memory',
    agentId: 'prose',
    defaultForAgent: false,
    label: '章节记忆与交接抽取',
    owner: 'prose-agent',
    promptVersion: 'chapter-memory-v1',
    executionMode: 'memory',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: PROSE_MEMORY_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_POST_ADOPTION_INPUT_POLICY,
    contextCompression: PROSE_MEMORY_COMPRESSION_POLICY,
    maxOutputTokens: 8_000,
    writeTargets: [{
      table: 'chapters',
      fields: ['summary', 'summarySourceTextHash', 'summaryTextNormalizationVersion', 'continuityHandoff', 'planReconciliation'],
    }],
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-NS1-T3-chapter-memory-task', 'R-HARNESS20-chapter-post-adoption-durable'],
  },
  {
    version: 1,
    id: 'prose.consistency',
    agentId: 'prose',
    defaultForAgent: false,
    label: '正文确定性一致性守卫',
    owner: 'prose-agent',
    promptVersion: 'chapter-consistency-guard-v1',
    executionMode: 'consistency',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: PROSE_CONSISTENCY_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: PROSE_POST_ADOPTION_INPUT_POLICY,
    contextCompression: PROSE_CONSISTENCY_COMPRESSION_POLICY,
    maxOutputTokens: 1,
    writeTargets: [],
    lastVerifiedAt: '2026-08-10',
    regressionTests: ['R-HARNESS41-consistency-post-adoption'],
  },
  {
    version: 1,
    id: 'character.interaction-reply',
    agentId: 'character',
    defaultForAgent: false,
    label: '角色互动回复候选',
    owner: 'character-agent',
    promptVersion: 'character-interaction-reply-v1',
    executionMode: 'character-reply',
    contextTaskKind: 'agent-character',
    readToolNames: [],
    contextSourceKeys: ['interactionRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: INTERACTION_RUNTIME_INPUT_POLICY,
    contextCompression: INTERACTION_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 2_000,
    writeTargets: [],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS-RUNTIME1-instance-ledger'],
  },
  {
    version: 1,
    id: 'prose.interaction-scene-director',
    agentId: 'prose',
    defaultForAgent: false,
    label: '互动场景导演候选',
    owner: 'prose-agent',
    promptVersion: 'character-interaction-scene-director-v1',
    executionMode: 'scene-director',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['interactionRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: INTERACTION_RUNTIME_INPUT_POLICY,
    contextCompression: INTERACTION_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 2_000,
    writeTargets: [],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS-RUNTIME1-instance-ledger'],
  },
  {
    version: 1,
    id: 'character.interaction-memory-curator',
    agentId: 'character',
    defaultForAgent: false,
    label: '角色互动记忆整理候选',
    owner: 'character-agent',
    promptVersion: 'character-interaction-memory-curator-v1',
    executionMode: 'memory-curator',
    contextTaskKind: 'agent-character',
    readToolNames: [],
    contextSourceKeys: ['interactionRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: INTERACTION_RUNTIME_INPUT_POLICY,
    contextCompression: INTERACTION_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 2_000,
    writeTargets: [],
    lastVerifiedAt: '2026-08-14',
    regressionTests: ['R-HARNESS-RUNTIME1-instance-ledger'],
  },
  {
    version: 1,
    id: 'prose.adventure-intent-parser',
    agentId: 'prose',
    defaultForAgent: false,
    label: '文字冒险自由输入映射',
    owner: 'prose-agent',
    promptVersion: 'text-adventure-intent-v1',
    executionMode: 'adventure-intent',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['adventureRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: ADVENTURE_RUNTIME_INPUT_POLICY,
    contextCompression: ADVENTURE_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 1_000,
    writeTargets: [],
    lastVerifiedAt: '2026-09-01',
    regressionTests: ['R-HARNESS-RUNTIME2-product-skills'],
  },
  {
    version: 1,
    id: 'prose.adventure-result-narrator',
    agentId: 'prose',
    defaultForAgent: false,
    label: '文字冒险结果叙述候选',
    owner: 'prose-agent',
    promptVersion: 'text-adventure-result-narrator-v1',
    executionMode: 'adventure-narrator',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['adventureRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: ADVENTURE_RUNTIME_INPUT_POLICY,
    contextCompression: ADVENTURE_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 2_000,
    writeTargets: [],
    lastVerifiedAt: '2026-09-01',
    regressionTests: ['R-HARNESS-RUNTIME2-product-skills'],
  },
  {
    version: 1,
    id: 'prose.simulation-turn-briefing',
    agentId: 'prose',
    defaultForAgent: false,
    label: '叙事模拟回合简报候选',
    owner: 'prose-agent',
    promptVersion: 'narrative-simulation-briefing-v1',
    executionMode: 'simulation-briefing',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['narrativeSimulationRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: NARRATIVE_SIMULATION_RUNTIME_INPUT_POLICY,
    contextCompression: NARRATIVE_SIMULATION_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 2_000,
    writeTargets: [],
    lastVerifiedAt: '2026-09-01',
    regressionTests: ['R-HARNESS-RUNTIME2-product-skills'],
  },
  {
    version: 1,
    id: 'prose.simulation-advisor-performance',
    agentId: 'prose',
    defaultForAgent: false,
    label: '叙事模拟顾问表演候选',
    owner: 'prose-agent',
    promptVersion: 'narrative-simulation-advisor-v1',
    executionMode: 'simulation-advisor',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['narrativeSimulationRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: NARRATIVE_SIMULATION_RUNTIME_INPUT_POLICY,
    contextCompression: NARRATIVE_SIMULATION_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 2_000,
    writeTargets: [],
    lastVerifiedAt: '2026-09-01',
    regressionTests: ['R-HARNESS-RUNTIME2-product-skills'],
  },
  {
    version: 1,
    id: 'prose.simulation-outcome-narrator',
    agentId: 'prose',
    defaultForAgent: false,
    label: '叙事模拟结果叙述候选',
    owner: 'prose-agent',
    promptVersion: 'narrative-simulation-outcome-v1',
    executionMode: 'simulation-narrator',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['narrativeSimulationRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: NARRATIVE_SIMULATION_RUNTIME_INPUT_POLICY,
    contextCompression: NARRATIVE_SIMULATION_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 2_000,
    writeTargets: [],
    lastVerifiedAt: '2026-09-01',
    regressionTests: ['R-HARNESS-RUNTIME2-product-skills'],
  },
  {
    version: 1,
    id: 'prose.simulation-actor-action-suggestion',
    agentId: 'prose',
    defaultForAgent: false,
    label: '叙事模拟主体行动建议候选',
    owner: 'prose-agent',
    promptVersion: 'narrative-simulation-actor-suggestion-v1',
    executionMode: 'simulation-actor-suggestion',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['narrativeSimulationRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: NARRATIVE_SIMULATION_RUNTIME_INPUT_POLICY,
    contextCompression: NARRATIVE_SIMULATION_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 2_000,
    writeTargets: [],
    lastVerifiedAt: '2026-09-01',
    regressionTests: ['R-HARNESS-RUNTIME2-product-skills'],
  },
  {
    version: 1,
    id: 'prose.open-world-quest-expression',
    agentId: 'prose',
    defaultForAgent: false,
    label: '开放世界任务表现候选',
    owner: 'prose-agent',
    promptVersion: 'text-open-world-quest-expression-v1',
    executionMode: 'open-world-expression',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['openWorldRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: OPEN_WORLD_RUNTIME_INPUT_POLICY,
    contextCompression: OPEN_WORLD_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 2_000,
    writeTargets: [],
    lastVerifiedAt: '2026-09-01',
    regressionTests: ['R-HARNESS-RUNTIME2-product-skills'],
  },
  {
    version: 1,
    id: 'prose.open-world-scene-narration',
    agentId: 'prose',
    defaultForAgent: false,
    label: '开放世界场景叙述候选',
    owner: 'prose-agent',
    promptVersion: 'text-open-world-scene-narration-v1',
    executionMode: 'open-world-narration',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['openWorldRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: OPEN_WORLD_RUNTIME_INPUT_POLICY,
    contextCompression: OPEN_WORLD_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 2_000,
    writeTargets: [],
    lastVerifiedAt: '2026-09-01',
    regressionTests: ['R-HARNESS-RUNTIME2-product-skills'],
  },
  {
    version: 1,
    id: 'prose.ttrpg-gm-narrator',
    agentId: 'prose',
    defaultForAgent: false,
    label: '可信 TTRPG 主持叙事候选',
    owner: 'prose-agent',
    promptVersion: 'ttrpg-gm-narrator-v1',
    executionMode: 'ttrpg-gm-narrator',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['ttrpgRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: TTRPG_GM_RUNTIME_INPUT_POLICY,
    contextCompression: TTRPG_GM_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 2_000,
    writeTargets: [],
    lastVerifiedAt: '2026-09-01',
    regressionTests: ['R-HARNESS-RUNTIME3-ttrpg-skills'],
  },
  {
    version: 1,
    id: 'prose.ttrpg-player-intent',
    agentId: 'prose',
    defaultForAgent: false,
    label: '隔离 TTRPG AI 玩家行动候选',
    owner: 'prose-agent',
    promptVersion: 'ttrpg-player-intent-v1',
    executionMode: 'ttrpg-player-intent',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['ttrpgPlayerRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: TTRPG_PLAYER_RUNTIME_INPUT_POLICY,
    contextCompression: TTRPG_PLAYER_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 1_200,
    writeTargets: [],
    lastVerifiedAt: '2026-09-01',
    regressionTests: ['R-HARNESS-RUNTIME3-ttrpg-skills'],
  },
  {
    version: 1,
    id: 'prose.ttrpg-gm-actor-intent',
    agentId: 'prose',
    defaultForAgent: false,
    label: '可信 TTRPG AI KP 角色行动候选',
    owner: 'prose-agent',
    promptVersion: 'ttrpg-gm-actor-intent-v1',
    executionMode: 'ttrpg-gm-actor-intent',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: ['ttrpgRuntime'],
    optionalContextSourceKeys: [],
    inputPolicy: TTRPG_GM_RUNTIME_INPUT_POLICY,
    contextCompression: TTRPG_GM_RUNTIME_COMPRESSION_POLICY,
    maxOutputTokens: 1_200,
    writeTargets: [],
    lastVerifiedAt: '2026-09-01',
    regressionTests: ['R-HARNESS-RUNTIME3-ttrpg-skills'],
  },
  {
    version: 1,
    id: 'game-production.consult.v1',
    agentId: 'outline',
    defaultForAgent: false,
    label: '游戏起点会谈建议',
    owner: 'outline-agent',
    promptVersion: 'game-production-consult-v1',
    executionMode: 'game-production',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ['game-production.consultation-source'],
    optionalContextSourceKeys: [],
    inputPolicy: gameProductionInputPolicy(['game-production.consultation-source']),
    contextCompression: compressionPolicy(['game-production.consultation-source']),
    contextGateway: {
      version: 1,
      rollout: 'required',
      requiredWriteTargets: ['gameProductionBriefs.userIntentSummary'],
      providerSourceKeys: ['worldRelease'],
      allowedResourceKinds: [...CONTEXT_RESOURCE_KINDS_V1],
      allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
      maxReadCalls: 200,
      maxRetrievedTokens: 100_000,
      maxPlanningSteps: 8,
      maxPlanningModelTokens: 24_000,
      allowOriginalRead: true,
      additionalReadToolNames: [
        'list_context_catalog',
        'search_context',
        'read_context_resource',
        'read_original_evidence',
      ],
    },
    maxOutputTokens: 4_000,
    writeTargets: [{
      table: 'gameProductionBriefs',
      fields: ['userIntentSummary'],
      adoptionExtension: 'game-production-briefs',
    }],
    lastVerifiedAt: '2026-08-21',
    regressionTests: ['R-GAMEPROD1B-consultation'],
  },
  {
    version: 1,
    id: 'game-production.ttrpg-campaign-proposals.v2',
    agentId: 'outline',
    defaultForAgent: false,
    label: '冻结世界 TTRPG 三战役提案候选',
    owner: 'outline-agent',
    promptVersion: 'ttrpg-campaign-proposals-v2',
    executionMode: 'game-production',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ['game-production.consultation-source'],
    optionalContextSourceKeys: [],
    inputPolicy: gameProductionInputPolicy(['game-production.consultation-source']),
    contextCompression: compressionPolicy(['game-production.consultation-source']),
    maxOutputTokens: 8_000,
    writeTargets: [],
    lastVerifiedAt: '2026-08-22',
    regressionTests: ['R-TTRPG3M-campaign-proposal-harness'],
  },
  {
    version: 1,
    id: 'game-production.brief-compile.v1',
    agentId: 'outline',
    defaultForAgent: false,
    label: '游戏生产 Brief 编译',
    owner: 'outline-agent',
    promptVersion: 'game-production-brief-v3',
    executionMode: 'game-production',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ['game-production.consultation-source'],
    optionalContextSourceKeys: [],
    inputPolicy: gameProductionInputPolicy(['game-production.consultation-source']),
    contextCompression: compressionPolicy(['game-production.consultation-source']),
    maxOutputTokens: 8_000,
    writeTargets: [{
      table: 'gameProductionBriefs',
      fields: ['briefJson'],
      adoptionExtension: 'game-production-briefs',
    }],
    lastVerifiedAt: '2026-08-21',
    regressionTests: ['R-GAMEPROD1B-consultation', 'R-GAMEPROD1B-commands'],
  },
  {
    version: 1,
    id: 'game-production.plan.v1',
    agentId: 'outline',
    defaultForAgent: false,
    label: '游戏生产 DAG 规划',
    owner: 'outline-agent',
    promptVersion: 'game-production-plan-v3',
    executionMode: 'game-production',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ['game-production.brief'],
    optionalContextSourceKeys: [],
    inputPolicy: gameProductionInputPolicy(['game-production.brief']),
    contextCompression: compressionPolicy(['game-production.brief']),
    maxOutputTokens: 12_000,
    writeTargets: [{ table: 'gameBuilds', fields: ['planJson'], adoptionExtension: 'game-production-builds' }],
    lastVerifiedAt: '2026-08-21',
    regressionTests: ['R-GAMEPROD1C-plan', 'R-GAMEPROD1D-scheduler'],
  },
  {
    version: 1,
    id: 'game-production.content.v1',
    agentId: 'outline',
    defaultForAgent: false,
    label: '游戏内容产物生成',
    owner: 'outline-agent',
    promptVersion: 'game-production-content-v1',
    executionMode: 'game-production',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ['game-production.brief'],
    optionalContextSourceKeys: ['game-production.artifact-inputs'],
    inputPolicy: gameProductionInputPolicy(['game-production.brief']),
    contextCompression: compressionPolicy(['game-production.brief', 'game-production.artifact-inputs']),
    maxOutputTokens: 16_000,
    writeTargets: [{ table: 'gameBuildArtifacts', fields: ['payloadJson'], adoptionExtension: 'game-production-artifacts' }],
    lastVerifiedAt: '2026-08-21',
    regressionTests: ['R-GAMEPROD1F-production-executor'],
  },
  {
    version: 1,
    id: 'game-production.media-requirements.v1',
    agentId: 'outline',
    defaultForAgent: false,
    label: '游戏媒资需求拆分',
    owner: 'outline-agent',
    promptVersion: 'game-production-media-requirements-v1',
    executionMode: 'game-production',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ['game-production.brief'],
    optionalContextSourceKeys: ['game-production.artifact-inputs'],
    inputPolicy: gameProductionInputPolicy(['game-production.brief']),
    contextCompression: compressionPolicy(['game-production.brief', 'game-production.artifact-inputs']),
    maxOutputTokens: 8_000,
    writeTargets: [{ table: 'gameBuildArtifacts', fields: ['metadataJson'], adoptionExtension: 'game-production-artifacts' }],
    lastVerifiedAt: '2026-08-21',
    regressionTests: ['R-GAMEPROD1F-production-executor'],
  },
  {
    version: 1,
    id: 'game-production.media-request.v1',
    agentId: 'outline',
    defaultForAgent: false,
    label: '游戏媒资请求',
    owner: 'outline-agent',
    promptVersion: 'game-production-media-request-v1',
    executionMode: 'game-production',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ['game-production.brief'],
    optionalContextSourceKeys: ['game-production.artifact-inputs'],
    inputPolicy: gameProductionInputPolicy(['game-production.brief']),
    contextCompression: compressionPolicy(['game-production.brief', 'game-production.artifact-inputs']),
    maxOutputTokens: 4_000,
    writeTargets: [{ table: 'gameBuildArtifacts', fields: [], adoptionExtension: 'game-production-artifacts' }],
    lastVerifiedAt: '2026-08-21',
    regressionTests: ['R-GAMEPROD1E-media-adapters', 'R-GAMEPROD1F-production-executor'],
  },
  {
    version: 1,
    id: 'game-production.integrate.v1',
    agentId: 'outline',
    defaultForAgent: false,
    label: '游戏包自动集成',
    owner: 'outline-agent',
    promptVersion: 'game-production-integrate-v1',
    executionMode: 'game-production',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ['game-production.brief'],
    optionalContextSourceKeys: ['game-production.artifact-inputs'],
    inputPolicy: gameProductionInputPolicy(['game-production.brief']),
    contextCompression: compressionPolicy(['game-production.brief', 'game-production.artifact-inputs']),
    maxOutputTokens: 6_000,
    writeTargets: [{ table: 'gameBuilds', fields: ['manifestJson', 'previewManifestJson'], adoptionExtension: 'game-production-builds' }],
    lastVerifiedAt: '2026-08-21',
    regressionTests: ['R-GAMEPROD1F-production-executor'],
  },
  {
    version: 1,
    id: 'game-production.quality-review.v1',
    agentId: 'outline',
    defaultForAgent: false,
    label: '游戏质量审查',
    owner: 'outline-agent',
    promptVersion: 'game-production-quality-v1',
    executionMode: 'game-production',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ['game-production.brief', 'game-production.quality-feedback'],
    optionalContextSourceKeys: [],
    inputPolicy: gameProductionInputPolicy(['game-production.brief', 'game-production.quality-feedback']),
    contextCompression: compressionPolicy(['game-production.brief', 'game-production.quality-feedback']),
    maxOutputTokens: 6_000,
    writeTargets: [{ table: 'gameBuilds', fields: ['qualityReportJson'], adoptionExtension: 'game-production-builds' }],
    lastVerifiedAt: '2026-08-21',
    regressionTests: ['R-GAMEPROD1F-production-executor'],
  },
  {
    version: 1,
    id: 'game-production.evolution-impact.v1',
    agentId: 'outline',
    defaultForAgent: false,
    label: '游戏持续演化影响分析',
    owner: 'outline-agent',
    promptVersion: 'game-production-evolution-v1',
    executionMode: 'game-production',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: ['game-production.evolution-base'],
    optionalContextSourceKeys: [],
    inputPolicy: gameProductionInputPolicy(['game-production.evolution-base']),
    contextCompression: compressionPolicy(['game-production.evolution-base']),
    maxOutputTokens: 8_000,
    writeTargets: [{ table: 'gameBuilds', fields: ['compatibilityJson'], adoptionExtension: 'game-production-builds' }],
    lastVerifiedAt: '2026-08-21',
    regressionTests: ['R-GAMEPROD1B-commands', 'R-GAMEPROD1D-scheduler', 'R-GAMEPROD1F-production-executor'],
  },
] as const satisfies readonly AgentSkillDefinitionV1[]

export type AgentSkillId = typeof AGENT_SKILLS[number]['id']
export const AGENT_SKILL_IDS: readonly AgentSkillId[] = AGENT_SKILLS.map(skill => skill.id)

export function resolveAgentSkillContextSourceKeysV1(
  skill: AgentSkillDefinitionV1,
  options: { includeOptional?: boolean; includeGatewayProviders?: boolean } = {},
): string[] {
  const toolSources = skill.readToolNames.flatMap(name => AGENT_TOOL_BY_NAME.get(name)?.sourceKeys ?? [])
  return [...new Set([
    ...toolSources,
    ...skill.contextSourceKeys,
    ...(options.includeOptional ? skill.optionalContextSourceKeys : []),
    ...(options.includeGatewayProviders ? skill.contextGateway?.providerSourceKeys ?? [] : []),
  ])]
}

export function resolveAgentSkillInputStateV1(
  skill: AgentSkillDefinitionV1,
  results: readonly {
    included: readonly string[]
    omitted: readonly string[]
    trimmed: readonly string[]
    sourceEvidence?: readonly AssembleContextSourceEvidence[]
    totalInputTokens: number
    inputBudget: number
  }[],
): AgentContextInputStateEvidenceV1 {
  return classifyAgentContextInputStateV1({
    consideredSourceKeys: skill.inputPolicy.sourceKeys,
    handling: {
      empty: skill.inputPolicy.states.empty.handling,
      partial: skill.inputPolicy.states.partial.handling,
      complete: skill.inputPolicy.states.complete.handling,
    },
    results,
  })
}

export function buildAgentSkillInputGuidanceV1(
  skill: AgentSkillDefinitionV1,
  state: AgentContextInputStateEvidenceV1,
): string {
  const policy = skill.inputPolicy.states[state.state]
  if (policy.handling !== state.handling) {
    throw new Error(`Agent Skill ${skill.id} 输入状态证据与处理策略不一致`)
  }
  const available = state.availableSourceKeys.length ? state.availableSourceKeys.join('、') : '无'
  const missing = state.missingSourceKeys.length ? state.missingSourceKeys.join('、') : '无'
  const degraded = [...new Set([...state.truncatedSourceKeys, ...state.trimmedSourceKeys])]
  return [
    `【Skill 输入策略：${state.state} / ${state.handling}】`,
    policy.instruction,
    `已有来源：${available}；缺失来源：${missing}。`,
    ...(degraded.length ? [`受预算影响的来源：${degraded.join('、')}；不得假装已看到其全文。`] : []),
  ].join('\n')
}

function assertUniqueStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${label} 必须是字符串数组`)
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} 不得重复`)
  return value
}

/** Durable candidate boundary validation; historical evidence may omit H15 fields. */
export function validateAgentSkillContextEvidenceV1(
  skill: AgentSkillDefinitionV1,
  evidence: AgentContextEvidence,
): void {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error(`Agent Skill ${skill.id} 上下文证据无效`)
  }
  if (!AGENT_CONTEXT_PROFILES.includes(evidence.profile)) {
    throw new Error(`Agent Skill ${skill.id} 上下文档位无效`)
  }
  const included = assertUniqueStringArray(evidence.included, '上下文 included')
  const omitted = assertUniqueStringArray(evidence.omitted, '上下文 omitted')
  const trimmed = assertUniqueStringArray(evidence.trimmed, '上下文 trimmed')
  const authorized = new Set(resolveAgentSkillContextSourceKeysV1(skill, {
    includeOptional: true,
    includeGatewayProviders: true,
  }))
  for (const key of [...included, ...omitted, ...trimmed]) {
    if (!authorized.has(key)) throw new Error(`Agent Skill ${skill.id} 上下文来源越权 ${key}`)
  }
  if (
    !Number.isInteger(evidence.estimatedInputTokens)
    || evidence.estimatedInputTokens < 0
    || !Number.isInteger(evidence.inputBudgetTokens)
    || evidence.inputBudgetTokens < 1
    || evidence.estimatedInputTokens > evidence.inputBudgetTokens
  ) throw new Error(`Agent Skill ${skill.id} 上下文 token 证据无效`)
  if (evidence.sourceEvidence) {
    const keys = new Set<string>()
    let deliveredTokens = 0
    for (const source of evidence.sourceEvidence) {
      if (keys.has(source.key)) throw new Error(`Agent Skill ${skill.id} 来源证据重复 ${source.key}`)
      keys.add(source.key)
      if (!authorized.has(source.key)) throw new Error(`Agent Skill ${skill.id} 来源证据越权 ${source.key}`)
      if (
        !Number.isInteger(source.originalTokens)
        || source.originalTokens < 0
        || !Number.isInteger(source.inputTokens)
        || source.inputTokens < 0
        || source.originalTokens < source.inputTokens
      ) throw new Error(`Agent Skill ${skill.id} 来源 ${source.key} token 证据无效`)
      if (source.originalCharacters !== undefined || source.inputCharacters !== undefined) {
        if (
          !Number.isInteger(source.originalCharacters)
          || source.originalCharacters! < 0
          || !Number.isInteger(source.inputCharacters)
          || source.inputCharacters! < 0
          || source.originalCharacters! < source.inputCharacters!
          || (source.delivery === 'full' && source.originalCharacters !== source.inputCharacters)
        ) throw new Error(`Agent Skill ${skill.id} 来源 ${source.key} 字符证据无效`)
      }
      if (source.status === 'included') {
        if (!included.includes(source.key) || source.delivery === 'none' || source.inputTokens < 1) {
          throw new Error(`Agent Skill ${skill.id} 来源 ${source.key} included 证据不一致`)
        }
        if (source.delivery === 'full' && source.originalTokens !== source.inputTokens) {
          throw new Error(`Agent Skill ${skill.id} 来源 ${source.key} full 证据不一致`)
        }
        if (source.delivery === 'truncated' && source.originalTokens <= source.inputTokens) {
          throw new Error(`Agent Skill ${skill.id} 来源 ${source.key} truncated 证据不一致`)
        }
        if (source.delivery === 'compressed' && source.originalTokens <= source.inputTokens) {
          throw new Error(`Agent Skill ${skill.id} 来源 ${source.key} compressed 证据不一致`)
        }
        deliveredTokens += source.inputTokens
      } else if (
        source.delivery !== 'none'
        || source.inputTokens !== 0
        || (source.status === 'omitted' && !omitted.includes(source.key))
        || (source.status === 'trimmed' && !trimmed.includes(source.key))
      ) {
        throw new Error(`Agent Skill ${skill.id} 来源 ${source.key} 未交付证据不一致`)
      }
      if (source.compression) {
        const compression = source.compression
        const validHash = (value: unknown): value is string => (
          typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
        )
        if (
          compression.version !== 1
          || compression.promptVersion !== 'agent-context-compression-v1'
          || !validHash(compression.sourceHash)
          || !Number.isInteger(compression.attempts)
          || compression.attempts < 0
          || compression.attempts > skill.contextCompression.maxAttemptsPerSource
          || !Number.isInteger(compression.targetTokens)
          || compression.targetTokens < 1
          || !Number.isInteger(compression.requiredAnchorCount)
          || compression.requiredAnchorCount < 1
          || !Number.isInteger(compression.coveredAnchorCount)
          || compression.coveredAnchorCount < 0
          || compression.coveredAnchorCount > compression.requiredAnchorCount
        ) throw new Error(`Agent Skill ${skill.id} 来源 ${source.key} 压缩证据无效`)
        if (!skill.contextCompression.sourceKeys.includes(source.key)) {
          throw new Error(`Agent Skill ${skill.id} 来源 ${source.key} 不允许压缩`)
        }
        if (compression.outcome === 'verified') {
          if (
            compression.fallback !== 'none'
            || !validHash(compression.artifactHash)
            || compression.coveredAnchorCount !== compression.requiredAnchorCount
            || (source.status === 'included' && source.delivery !== 'compressed')
          ) throw new Error(`Agent Skill ${skill.id} 来源 ${source.key} 已验证压缩证据不一致`)
        } else if (
          compression.outcome !== 'fallback'
          || compression.fallback === 'none'
          || compression.artifactHash !== undefined
          || !compression.failureCode?.trim()
          || (source.status === 'included'
            && compression.fallback === 'full-source'
            && source.delivery !== 'full')
          || (source.status === 'included'
            && compression.fallback === 'deterministic-truncation'
            && source.delivery !== 'truncated')
        ) throw new Error(`Agent Skill ${skill.id} 来源 ${source.key} 压缩回退证据不一致`)
      } else if (source.delivery === 'compressed') {
        throw new Error(`Agent Skill ${skill.id} 来源 ${source.key} 缺少压缩证据`)
      }
    }
    if (deliveredTokens !== evidence.estimatedInputTokens) {
      throw new Error(`Agent Skill ${skill.id} 来源 token 合计与上下文证据不一致`)
    }
  }
  if (evidence.inputState) {
    if (
      evidence.inputState.version !== 1
      || !AGENT_CONTEXT_INPUT_STATES.includes(evidence.inputState.state)
      || !AGENT_CONTEXT_INPUT_HANDLINGS.includes(evidence.inputState.handling)
    ) throw new Error(`Agent Skill ${skill.id} 输入状态证据无效`)
    const inputStateSourceKeys = evidence.inputStateSourceKeys === undefined
      ? undefined
      : assertUniqueStringArray(evidence.inputStateSourceKeys, 'inputStateSourceKeys')
    if (inputStateSourceKeys?.some(key => !skill.inputPolicy.sourceKeys.includes(key))) {
      throw new Error(`Agent Skill ${skill.id} inputStateSourceKeys 含未登记输入来源`)
    }
    const expected = resolveAgentSkillInputStateV1(skill, [{
      ...evidence,
      ...(inputStateSourceKeys ? {
        included: skill.inputPolicy.sourceKeys.filter(key => inputStateSourceKeys.includes(key)),
        omitted: skill.inputPolicy.sourceKeys.filter(key => !inputStateSourceKeys.includes(key)),
        trimmed: [],
      } : {}),
      totalInputTokens: evidence.estimatedInputTokens,
      inputBudget: evidence.inputBudgetTokens,
    }])
    if (JSON.stringify(expected) !== JSON.stringify(evidence.inputState)) {
      throw new Error(`Agent Skill ${skill.id} 输入状态证据与实际来源不一致`)
    }
  }
}

export function validateAgentSkillDefinitionsV1(
  definitions: readonly AgentSkillDefinitionV1[],
): void {
  const executionModesByAgent: Record<DomainAgentId, ReadonlySet<AgentSkillExecutionModeV1>> = {
    'world-origin': new Set(['complete', 'worldview-field', 'world-suggest', 'worldview-expand', 'world-link-context', 'constitution-extract', 'codex-extract', 'codex-enrich', 'story-core', 'creative-rules', 'locations', 'map-config', 'history-consult', 'history-storm', 'review']),
    character: new Set(['create', 'supplement', 'lifecycle', 'relationships', 'character-reply', 'memory-curator']),
    inspiration: new Set(['reference-summary', 'reference-characters', 'reverse', 'review']),
    outline: new Set(['auto', 'story-arcs', 'foreshadow-suggestions', 'storyline-progress', 'character-driven', 'character-revision', 'impact-summary-regenerate', 'volumes', 'chapters', 'details', 'adaptation-brief', 'adaptation-impact', 'screenplay-plan', 'comic-plan', 'comic-storyboard', 'character-interaction-production', 'game-production']),
    prose: new Set(['auto', 'generate', 'continue', 'emotion-beats', 'inventory-extraction', 'story-timeline-extraction', 'cultivation-progress-extraction', 'style-learn', 'selection-edit', 'selection-check', 'review', 'revise', 'organize', 'memory', 'consistency', 'scene-director', 'adventure-intent', 'adventure-narrator', 'simulation-briefing', 'simulation-advisor', 'simulation-narrator', 'simulation-actor-suggestion', 'open-world-expression', 'open-world-narration', 'screenplay-scenes', 'ttrpg-gm-narrator', 'ttrpg-gm-actor-intent', 'ttrpg-player-intent']),
  }
  const ids = new Set<string>()
  const defaultAgents = new Set<DomainAgentId>()
  for (const skill of definitions) {
    if (skill.version !== 1) throw new Error(`Agent Skill ${skill.id} 版本不受支持`)
    if (ids.has(skill.id)) throw new Error(`Agent Skill ID 重复：${skill.id}`)
    ids.add(skill.id)
    if (skill.defaultForAgent) {
      if (defaultAgents.has(skill.agentId)) throw new Error(`Agent ${skill.agentId} 存在多个默认 Skill`)
      defaultAgents.add(skill.agentId)
    }
    if (!skill.owner.trim()) throw new Error(`Agent Skill ${skill.id} 缺少 owner`)
    if (!/^[a-z0-9][a-z0-9.-]*-v\d+$/.test(skill.promptVersion)) {
      throw new Error(`Agent Skill ${skill.id} 的 promptVersion 无效`)
    }
    if (!executionModesByAgent[skill.agentId].has(skill.executionMode)) {
      throw new Error(`Agent Skill ${skill.id} 的执行模式与 Agent 不匹配`)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(skill.lastVerifiedAt)) {
      throw new Error(`Agent Skill ${skill.id} 的 lastVerifiedAt 无效`)
    }
    if (!Number.isInteger(skill.maxOutputTokens) || skill.maxOutputTokens < 1) {
      throw new Error(`Agent Skill ${skill.id} 的输出预算无效`)
    }
    if (skill.regressionTests.length === 0) throw new Error(`Agent Skill ${skill.id} 缺少回归证据`)
    for (const toolName of skill.readToolNames) {
      const tool = AGENT_TOOL_BY_NAME.get(toolName)
      if (!tool || tool.risk !== 'read') throw new Error(`Agent Skill ${skill.id} 引用了未知只读工具 ${toolName}`)
    }
    const authorizedSourceKeys = resolveAgentSkillContextSourceKeysV1(skill, { includeOptional: true })
    for (const sourceKey of authorizedSourceKeys) {
      if (!CONTEXT_SOURCE_BY_KEY.has(sourceKey)) {
        throw new Error(`Agent Skill ${skill.id} 引用了未登记上下文源 ${sourceKey}`)
      }
    }
    if (!skill.inputPolicy.sourceKeys.length) {
      throw new Error(`Agent Skill ${skill.id} 缺少输入状态来源`)
    }
    if (new Set(skill.inputPolicy.sourceKeys).size !== skill.inputPolicy.sourceKeys.length) {
      throw new Error(`Agent Skill ${skill.id} 的输入状态来源重复`)
    }
    for (const sourceKey of skill.inputPolicy.sourceKeys) {
      // A required Canon Gateway reads through its frozen provider source and
      // projects logical domain availability from exact SourceRefs. Those
      // logical keys classify empty/partial/complete input; they are not a
      // second, direct context-reading authority.
      const projectedByRequiredGateway = skill.contextGateway?.rollout === 'required'
        && skill.contextGateway.providerSourceKeys.includes('ragSelection')
        && CONTEXT_SOURCE_BY_KEY.has(sourceKey)
      if (!authorizedSourceKeys.includes(sourceKey) && !projectedByRequiredGateway) {
        throw new Error(`Agent Skill ${skill.id} 的输入状态来源未获读取授权 ${sourceKey}`)
      }
    }
    for (const state of ['empty', 'partial', 'complete'] as const) {
      const policy = skill.inputPolicy.states[state]
      if (!AGENT_CONTEXT_INPUT_HANDLINGS.includes(policy.handling)) {
        throw new Error(`Agent Skill ${skill.id} 的 ${state} 输入处理模式无效`)
      }
      if (!policy.instruction.trim() || policy.instruction.length > 400) {
        throw new Error(`Agent Skill ${skill.id} 的 ${state} 输入说明无效`)
      }
    }
    const compression = skill.contextCompression
    if (compression.version !== 1) throw new Error(`Agent Skill ${skill.id} 的压缩策略版本无效`)
    if (!compression.sourceKeys.length || new Set(compression.sourceKeys).size !== compression.sourceKeys.length) {
      throw new Error(`Agent Skill ${skill.id} 的压缩来源无效`)
    }
    for (const sourceKey of compression.sourceKeys) {
      if (!authorizedSourceKeys.includes(sourceKey)) {
        throw new Error(`Agent Skill ${skill.id} 的压缩来源未获读取授权 ${sourceKey}`)
      }
    }
    for (const [key, value] of Object.entries({
      minimumOriginalTokens: compression.minimumOriginalTokens,
      maxSourcesPerTask: compression.maxSourcesPerTask,
      maxAttemptsPerSource: compression.maxAttemptsPerSource,
      maxAnchors: compression.maxAnchors,
      maxOutputTokens: compression.maxOutputTokens,
      maxFullTextFallbackTokens: compression.maxFullTextFallbackTokens,
    })) {
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`Agent Skill ${skill.id} 的压缩策略 ${key} 无效`)
      }
    }
    if (!Number.isFinite(compression.maxFullTextBudgetScale) || compression.maxFullTextBudgetScale < 1) {
      throw new Error(`Agent Skill ${skill.id} 的全文回退比例无效`)
    }
    const gateway = skill.contextGateway
    if (gateway) {
      if (gateway.version !== 1 || !['shadow', 'required'].includes(gateway.rollout)) {
        throw new Error(`Agent Skill ${skill.id} 的 Context Gateway 版本或 rollout 无效`)
      }
      if (!gateway.providerSourceKeys.length
        || new Set(gateway.providerSourceKeys).size !== gateway.providerSourceKeys.length) {
        throw new Error(`Agent Skill ${skill.id} 的 Context Gateway provider source 无效`)
      }
      for (const sourceKey of gateway.providerSourceKeys) {
        if (!CONTEXT_SOURCE_BY_KEY.get(sourceKey)?.resources) {
          throw new Error(`Agent Skill ${skill.id} 的 Context Gateway source ${sourceKey} 未挂 Provider`)
        }
      }
      if (!gateway.allowedResourceKinds.length
        || gateway.allowedResourceKinds.some(kind => !CONTEXT_RESOURCE_KINDS_V1.includes(kind))) {
        throw new Error(`Agent Skill ${skill.id} 的 Context Gateway resource kind 无效`)
      }
      const depths: readonly ContextResourceDepthV1[] = ['index', 'summary', 'focused', 'full', 'original']
      if (!gateway.allowedDepths.length || gateway.allowedDepths.some(depth => !depths.includes(depth))
        || (gateway.allowedDepths.includes('original') && !gateway.allowOriginalRead)) {
        throw new Error(`Agent Skill ${skill.id} 的 Context Gateway depth 无效`)
      }
      for (const [key, value] of Object.entries({
        maxReadCalls: gateway.maxReadCalls,
        maxRetrievedTokens: gateway.maxRetrievedTokens,
        maxPlanningSteps: gateway.maxPlanningSteps,
        maxPlanningModelTokens: gateway.maxPlanningModelTokens,
      })) {
        if (!Number.isSafeInteger(value) || value < 1) {
          throw new Error(`Agent Skill ${skill.id} 的 Context Gateway ${key} 无效`)
        }
      }
      if (!gateway.additionalReadToolNames.length
        || new Set(gateway.additionalReadToolNames).size !== gateway.additionalReadToolNames.length) {
        throw new Error(`Agent Skill ${skill.id} 的 Context Gateway 追加读取工具无效`)
      }
      for (const toolName of gateway.additionalReadToolNames) {
        const tool = AGENT_TOOL_BY_NAME.get(toolName)
        if (!tool || tool.risk !== 'read' || ![
          'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
        ].includes(toolName)) {
          throw new Error(`Agent Skill ${skill.id} 的 Context Gateway 工具 ${toolName} 未登记`)
        }
      }
    }
    for (const target of skill.writeTargets) {
      if (!REGISTRY_BY_NAME.has(target.table)) {
        throw new Error(`Agent Skill ${skill.id} 引用了未登记表 ${target.table}`)
      }
      const registered = new Set((FIELD_BY_TARGET.get(target.table) ?? []).map(field => field.field))
      const extension = target.adoptionExtension
        ? ADOPTION_EXTENSIONS.find(item => item.id === target.adoptionExtension)
        : undefined
      if (target.adoptionExtension && (!extension || extension.target !== target.table)) {
        throw new Error(`Agent Skill ${skill.id} 引用了未登记或目标不匹配的采纳扩展 ${target.adoptionExtension}`)
      }
      if (target.fields.length === 0 && !target.adoptionExtension) {
        throw new Error(`Agent Skill ${skill.id} 的写目标 ${target.table} 未声明字段或采纳扩展`)
      }
      for (const field of target.fields) {
        if (!registered.has(field)) {
          throw new Error(`Agent Skill ${skill.id} 引用了未登记写字段 ${target.table}.${field}`)
        }
      }
    }
  }
  for (const agentId of DOMAIN_AGENT_IDS) {
    if (!defaultAgents.has(agentId)) throw new Error(`Agent ${agentId} 缺少默认 Skill`)
  }
}

validateAgentSkillDefinitionsV1(AGENT_SKILLS)

export const AGENT_SKILL_BY_ID: ReadonlyMap<string, AgentSkillDefinitionV1> = new Map(
  AGENT_SKILLS.map(skill => [skill.id, skill]),
)

export const DEFAULT_AGENT_SKILL_BY_AGENT: ReadonlyMap<DomainAgentId, AgentSkillDefinitionV1> = new Map(
  AGENT_SKILLS.filter(skill => skill.defaultForAgent).map(skill => [skill.agentId, skill]),
)

export function getDefaultAgentSkillV1(agentId: DomainAgentId): AgentSkillDefinitionV1 {
  const skill = DEFAULT_AGENT_SKILL_BY_AGENT.get(agentId)
  if (!skill) throw new Error(`Agent ${agentId} 缺少默认 Skill`)
  return skill
}

export function getAgentSkillV1(
  skillId: string,
  expectedAgentId?: DomainAgentId,
): AgentSkillDefinitionV1 {
  const skill = AGENT_SKILL_BY_ID.get(skillId)
  if (!skill) throw new Error(`未知 Agent Skill：${skillId}`)
  if (expectedAgentId && skill.agentId !== expectedAgentId) {
    throw new Error(`Agent Skill ${skillId} 不属于 Agent ${expectedAgentId}`)
  }
  return skill
}

export function resolveAgentSkillV1(
  agentId: DomainAgentId,
  skillId?: string,
): AgentSkillDefinitionV1 {
  return skillId ? getAgentSkillV1(skillId, agentId) : getDefaultAgentSkillV1(agentId)
}
