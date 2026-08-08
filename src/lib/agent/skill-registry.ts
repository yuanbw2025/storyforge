import { CHARACTER_DIMENSIONS } from '../character/character-dimensions'
import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import type { AgentContextTaskKind } from './context-policy'
import { AGENT_TOOL_BY_NAME } from './tool-registry'

export const DOMAIN_AGENT_IDS = ['world-origin', 'character', 'inspiration', 'outline', 'prose'] as const
export type DomainAgentId = typeof DOMAIN_AGENT_IDS[number]

export interface AgentSkillWriteTargetV1 {
  table: string
  fields: readonly string[]
}

export interface AgentSkillDefinitionV1 {
  version: 1
  id: string
  agentId: DomainAgentId
  defaultForAgent: boolean
  label: string
  owner: string
  contextTaskKind: AgentContextTaskKind
  /** Tool-backed sources are derived from the Tool Registry, never copied here. */
  readToolNames: readonly string[]
  /** Sources assembled directly by the domain copilot. */
  contextSourceKeys: readonly string[]
  /** Sources enabled only by an explicit runtime boundary, such as a POV character. */
  optionalContextSourceKeys: readonly string[]
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

export const AGENT_SKILLS = [
  {
    version: 1,
    id: 'world-origin.complete',
    agentId: 'world-origin',
    defaultForAgent: true,
    label: '世界来源补全',
    owner: 'world-foundation-agent',
    contextTaskKind: 'agent-world-origin',
    readToolNames: ['read_project_status', 'read_worldview'],
    contextSourceKeys: [],
    optionalContextSourceKeys: [],
    maxOutputTokens: 3_000,
    writeTargets: [{ table: 'worldviews', fields: ['worldOrigin'] }],
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-AGENT1-chat-copilot-world-origin', 'R-HARNESS2-master-terminal-verifier'],
  },
  {
    version: 1,
    id: 'character.create',
    agentId: 'character',
    defaultForAgent: true,
    label: '角色创建',
    owner: 'character-agent',
    contextTaskKind: 'agent-character',
    readToolNames: ['read_worldview', 'read_characters'],
    contextSourceKeys: [],
    optionalContextSourceKeys: [],
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
    regressionTests: ['R-AGENT1-chat-copilot-character', 'R-HARNESS2-master-terminal-verifier'],
  },
  {
    version: 1,
    id: 'inspiration.reverse',
    agentId: 'inspiration',
    defaultForAgent: true,
    label: '灵感反推',
    owner: 'inspiration-agent',
    contextTaskKind: 'agent-inspiration',
    readToolNames: ['read_inspiration_workspace'],
    contextSourceKeys: [],
    optionalContextSourceKeys: [],
    maxOutputTokens: 8_000,
    writeTargets: [{ table: 'inspirationWorkspaces', fields: ['versions'] }],
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-AGENT1-chat-copilot-inspiration', 'R-HARNESS2-master-terminal-verifier'],
  },
  {
    version: 1,
    id: 'outline.compose',
    agentId: 'outline',
    defaultForAgent: true,
    label: '卷章纲编排',
    owner: 'outline-agent',
    contextTaskKind: 'agent-outline',
    readToolNames: [],
    contextSourceKeys: OUTLINE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: [],
    maxOutputTokens: 12_000,
    writeTargets: [{ table: 'outlineNodes', fields: ['title', 'summary'] }],
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-AGENT1-chat-copilot-outline', 'R-HARNESS11-outline-batch-durable'],
  },
  {
    version: 1,
    id: 'prose.write',
    agentId: 'prose',
    defaultForAgent: true,
    label: '章节正文生成与续写',
    owner: 'prose-agent',
    contextTaskKind: 'agent-prose',
    readToolNames: [],
    contextSourceKeys: PROSE_CONTEXT_SOURCE_KEYS,
    optionalContextSourceKeys: ['characterKnowledge'],
    maxOutputTokens: 16_000,
    writeTargets: [{ table: 'chapters', fields: ['content'] }],
    lastVerifiedAt: '2026-08-08',
    regressionTests: ['R-HARNESS7-prose-generation-durable', 'R-HARNESS9-information-boundary'],
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

export function validateAgentSkillDefinitionsV1(
  definitions: readonly AgentSkillDefinitionV1[],
): void {
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
    for (const sourceKey of resolveAgentSkillContextSourceKeysV1(skill, { includeOptional: true })) {
      if (!CONTEXT_SOURCE_BY_KEY.has(sourceKey)) {
        throw new Error(`Agent Skill ${skill.id} 引用了未登记上下文源 ${sourceKey}`)
      }
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
