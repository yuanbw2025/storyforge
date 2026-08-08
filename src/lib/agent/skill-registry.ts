import { CHARACTER_DIMENSIONS } from '../character/character-dimensions'
import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import { FIELD_BY_TARGET } from '../registry/field-registry'
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
import type { AssembleContextSourceEvidence } from '../registry/types'
import { AGENT_TOOL_BY_NAME } from './tool-registry'

export const DOMAIN_AGENT_IDS = ['world-origin', 'character', 'inspiration', 'outline', 'prose'] as const
export type DomainAgentId = typeof DOMAIN_AGENT_IDS[number]

export type AgentSkillExecutionModeV1 =
  | 'complete'
  | 'create'
  | 'reverse'
  | 'auto'
  | 'volumes'
  | 'chapters'
  | 'generate'
  | 'continue'

export interface AgentSkillWriteTargetV1 {
  table: string
  fields: readonly string[]
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

export interface AgentSkillDefinitionV1 {
  version: 1
  id: string
  agentId: DomainAgentId
  defaultForAgent: boolean
  label: string
  owner: string
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
  maxOutputTokens: number
  writeTargets: readonly AgentSkillWriteTargetV1[]
  lastVerifiedAt: string
  regressionTests: readonly string[]
}

const OUTLINE_CONTEXT_SOURCE_KEYS = [
  'canonAssertions',
  'worldview',
  'storyCore',
  'activeNarrativeBlueprint',
  'characterDrivenPlan',
  'powerSystem',
  'cultivationProgress',
  'codex',
  'characters',
  'creativeRules',
  'worldRules',
  'historical',
  'locations',
  'foreshadows',
  'storyArcs',
  'storylineProgress',
  'existingVolumeOutlines',
  'writtenChapterProgress',
] as const

const PROSE_CONTEXT_SOURCE_KEYS = [
  'contextMemo',
  'chapterOutline',
  'detailedOutline',
  'chapterContinuityHandoff',
  'previousPlanReconciliation',
  'previousChapterEnding',
  'recentChapterSummaries',
  'worldview',
  'storyCore',
  'activeNarrativeBlueprint',
  'characterDrivenPlan',
  'powerSystem',
  'cultivationProgress',
  'codex',
  'characters',
  'creativeRules',
  'worldRules',
  'historical',
  'locations',
  'foreshadows',
  'storyArcs',
  'storylineProgress',
  'emotionBeats',
  'stateCards',
  'currentFacts',
  'canonAssertions',
  'heldItems',
  'retrievedPassages',
  'references',
  'userStyleProfile',
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

const CHARACTER_INPUT_POLICY = {
  sourceKeys: ['worldview', 'powerSystem', 'codex', 'characters'],
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

const PROSE_INPUT_POLICY = {
  sourceKeys: ['chapterOutline', 'detailedOutline', 'storyCore', 'characters'],
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
const CHARACTER_COMPRESSION_POLICY = compressionPolicy(['worldview', 'powerSystem', 'codex', 'characters'])
const INSPIRATION_COMPRESSION_POLICY = compressionPolicy(['inspirationWorkspace'])
const OUTLINE_COMPRESSION_POLICY = compressionPolicy([
  'worldview',
  'storyCore',
  'activeNarrativeBlueprint',
  'characterDrivenPlan',
  'powerSystem',
  'codex',
  'characters',
  'historical',
  'storyArcs',
  'existingVolumeOutlines',
])
const PROSE_COMPRESSION_POLICY = compressionPolicy([
  'worldview',
  'storyCore',
  'activeNarrativeBlueprint',
  'characterDrivenPlan',
  'powerSystem',
  'codex',
  'characters',
  'historical',
  'storyArcs',
  'references',
])

export const AGENT_SKILLS = [
  {
    version: 1,
    id: 'world-origin.complete',
    agentId: 'world-origin',
    defaultForAgent: true,
    label: '世界来源补全',
    owner: 'world-foundation-agent',
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
    regressionTests: ['R-AGENT1-chat-copilot-world-origin', 'R-HARNESS2-master-terminal-verifier', 'R-HARNESS16-semantic-context-compression'],
  },
  {
    version: 1,
    id: 'character.create',
    agentId: 'character',
    defaultForAgent: true,
    label: '角色创建',
    owner: 'character-agent',
    executionMode: 'create',
    contextTaskKind: 'agent-character',
    readToolNames: ['read_worldview', 'read_characters'],
    contextSourceKeys: [],
    optionalContextSourceKeys: [],
    inputPolicy: CHARACTER_INPUT_POLICY,
    contextCompression: CHARACTER_COMPRESSION_POLICY,
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
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-AGENT1-chat-copilot-character', 'R-HARNESS2-master-terminal-verifier', 'R-HARNESS16-semantic-context-compression'],
  },
  {
    version: 1,
    id: 'inspiration.reverse',
    agentId: 'inspiration',
    defaultForAgent: true,
    label: '灵感反推',
    owner: 'inspiration-agent',
    executionMode: 'reverse',
    contextTaskKind: 'agent-inspiration',
    readToolNames: ['read_inspiration_workspace'],
    contextSourceKeys: [],
    optionalContextSourceKeys: [],
    inputPolicy: INSPIRATION_INPUT_POLICY,
    contextCompression: INSPIRATION_COMPRESSION_POLICY,
    maxOutputTokens: 8_000,
    writeTargets: [{ table: 'inspirationWorkspaces', fields: ['versions'] }],
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-AGENT1-chat-copilot-inspiration', 'R-HARNESS2-master-terminal-verifier', 'R-HARNESS16-semantic-context-compression'],
  },
  {
    version: 1,
    id: 'outline.compose',
    agentId: 'outline',
    defaultForAgent: true,
    label: '卷章纲编排',
    owner: 'outline-agent',
    executionMode: 'auto',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: OUTLINE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: OUTLINE_VOLUME_INPUT_POLICY,
    contextCompression: OUTLINE_COMPRESSION_POLICY,
    maxOutputTokens: 12_000,
    writeTargets: [{ table: 'outlineNodes', fields: ['title', 'summary'] }],
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-AGENT1-chat-copilot-outline', 'R-HARNESS11-outline-batch-durable', 'R-HARNESS16-semantic-context-compression'],
  },
  {
    version: 1,
    id: 'outline.volumes',
    agentId: 'outline',
    defaultForAgent: false,
    label: '卷纲编排',
    owner: 'outline-agent',
    executionMode: 'volumes',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: OUTLINE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: OUTLINE_VOLUME_INPUT_POLICY,
    contextCompression: OUTLINE_COMPRESSION_POLICY,
    maxOutputTokens: 8_000,
    writeTargets: [{ table: 'outlineNodes', fields: ['title', 'summary'] }],
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-HARNESS14-workflow-classifier', 'R-AGENT1-chat-copilot-outline', 'R-HARNESS16-semantic-context-compression'],
  },
  {
    version: 1,
    id: 'outline.chapters',
    agentId: 'outline',
    defaultForAgent: false,
    label: '章纲编排',
    owner: 'outline-agent',
    executionMode: 'chapters',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: OUTLINE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    inputPolicy: OUTLINE_CHAPTER_INPUT_POLICY,
    contextCompression: OUTLINE_COMPRESSION_POLICY,
    maxOutputTokens: 12_000,
    writeTargets: [{ table: 'outlineNodes', fields: ['title', 'summary'] }],
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-HARNESS14-workflow-classifier', 'R-AGENT1-chat-copilot-outline', 'R-HARNESS16-semantic-context-compression'],
  },
  {
    version: 1,
    id: 'prose.write',
    agentId: 'prose',
    defaultForAgent: true,
    label: '章节正文生成与续写',
    owner: 'prose-agent',
    executionMode: 'auto',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: PROSE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: ['characterKnowledge'],
    inputPolicy: PROSE_INPUT_POLICY,
    contextCompression: PROSE_COMPRESSION_POLICY,
    maxOutputTokens: 16_000,
    writeTargets: [{ table: 'chapters', fields: ['content'] }],
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-HARNESS7-prose-generation-durable', 'R-HARNESS9-information-boundary', 'R-HARNESS16-semantic-context-compression'],
  },
  {
    version: 1,
    id: 'prose.generate',
    agentId: 'prose',
    defaultForAgent: false,
    label: '章节正文生成',
    owner: 'prose-agent',
    executionMode: 'generate',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: PROSE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: ['characterKnowledge'],
    inputPolicy: PROSE_INPUT_POLICY,
    contextCompression: PROSE_COMPRESSION_POLICY,
    maxOutputTokens: 16_000,
    writeTargets: [{ table: 'chapters', fields: ['content'] }],
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-HARNESS14-workflow-classifier', 'R-HARNESS7-prose-generation-durable', 'R-HARNESS16-semantic-context-compression'],
  },
  {
    version: 1,
    id: 'prose.continue',
    agentId: 'prose',
    defaultForAgent: false,
    label: '章节正文续写',
    owner: 'prose-agent',
    executionMode: 'continue',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: PROSE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: ['characterKnowledge'],
    inputPolicy: PROSE_INPUT_POLICY,
    contextCompression: PROSE_COMPRESSION_POLICY,
    maxOutputTokens: 16_000,
    writeTargets: [{ table: 'chapters', fields: ['content'] }],
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-HARNESS14-workflow-classifier', 'R-HARNESS7-prose-generation-durable', 'R-HARNESS16-semantic-context-compression'],
  },
] as const satisfies readonly AgentSkillDefinitionV1[]

export type AgentSkillId = typeof AGENT_SKILLS[number]['id']
export const AGENT_SKILL_IDS: readonly AgentSkillId[] = AGENT_SKILLS.map(skill => skill.id)

export function resolveAgentSkillContextSourceKeysV1(
  skill: AgentSkillDefinitionV1,
  options: { includeOptional?: boolean } = {},
): string[] {
  const toolSources = skill.readToolNames.flatMap(name => AGENT_TOOL_BY_NAME.get(name)?.sourceKeys ?? [])
  return [...new Set([
    ...toolSources,
    ...skill.contextSourceKeys,
    ...(options.includeOptional ? skill.optionalContextSourceKeys : []),
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
  const authorized = new Set(resolveAgentSkillContextSourceKeysV1(skill, { includeOptional: true }))
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
    const expected = resolveAgentSkillInputStateV1(skill, [{
      ...evidence,
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
    'world-origin': new Set(['complete']),
    character: new Set(['create']),
    inspiration: new Set(['reverse']),
    outline: new Set(['auto', 'volumes', 'chapters']),
    prose: new Set(['auto', 'generate', 'continue']),
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
      if (!authorizedSourceKeys.includes(sourceKey)) {
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
    for (const target of skill.writeTargets) {
      if (!REGISTRY_BY_NAME.has(target.table)) {
        throw new Error(`Agent Skill ${skill.id} 引用了未登记表 ${target.table}`)
      }
      const registered = new Set((FIELD_BY_TARGET.get(target.table) ?? []).map(field => field.field))
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
