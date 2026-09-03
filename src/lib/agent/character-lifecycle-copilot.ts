import { useAIConfigStore } from '../../stores/ai-config'
import { chat, resolveRequestConfig } from '../ai/client'
import { appendSimplifiedChineseOutputConstraint } from '../ai/adapters/prompt-guards'
import {
  prepareGenerationNode,
  type GenerationNode,
  type PreparedGenerationNode,
} from '../generation/generation-node'
import { adopt } from '../registry/adopt'
import type { AssembleContextResult } from '../registry/types'
import type {
  AIConfig,
  Character,
  CharacterNarrativeStatus,
  ChatMessage,
  Chapter,
  StoryArc,
  WorkspaceScope,
} from '../types'
import { readOwnedRows, resolveReadScopeLike } from '../workspace/scope'
import { executeContextGatewayV1, type ContextGatewayExecutionV1 } from '../context-gateway/execution'
import { isContextGatewayRequiredForWriteTargetV1 } from '../context-gateway/skill-policy'
import {
  assembleContextGatewayPacketV1,
  contextGatewayInputStateSourceKeysV1,
  projectContextGatewayInputStateV1,
} from './context-gateway-input'
import {
  attachAgentContextInputStateV1,
  evidenceFromContextResult,
  resolveAgentContextPolicy,
  type AgentContextEvidence,
  type AgentContextProfile,
} from './context-policy'
import type { MasterCandidateModelIdentityV1 } from './master-candidate-semantic-review'
import {
  buildAgentSkillInputGuidanceV1,
  resolveAgentSkillV1,
  type AgentSkillId,
} from './skill-registry'
import { parseStructuredOutputV1 } from './structured-output-pipeline'

export const CHARACTER_NARRATIVE_STATUSES = [
  'planned', 'active', 'inactive', 'retired', 'deceased',
] as const satisfies readonly CharacterNarrativeStatus[]

export interface CharacterLifecycleTaskInputV1 {
  characterId: number
  targetStatus: CharacterNarrativeStatus
  evidenceChapterId: number | null
  evidenceStoryArcId: number | null
}

export interface CharacterLifecycleCandidateV1 {
  version: 1
  characterId: number
  fromStatus: CharacterNarrativeStatus
  targetStatus: CharacterNarrativeStatus
  reason: string
  ending: string
  activeChapterRange: string
}

interface CharacterLifecycleEvidenceSnapshotV1 {
  table: 'chapters' | 'storyArcs'
  id: number
  ragDocumentId: string
  updatedAt: number
}

export interface CharacterLifecycleSnapshotV1 {
  version: 1
  request: CharacterLifecycleTaskInputV1
  character: {
    id: number
    ragDocumentId: string
    updatedAt: number
    homeWorldGroupId: number | null
    isCrossWorld: boolean
    narrativeStatus: CharacterNarrativeStatus
    exitChapterId: number | null
    ending: string
    activeChapterRange: string
  }
  evidence: CharacterLifecycleEvidenceSnapshotV1[]
  serialized: string
}

interface CharacterLifecycleNodeInputV1 {
  projectId: number
  scope: WorkspaceScope
  worldGroupId: number | null
  authorRequest: string
  inputGuidance: string
  assembled: AssembleContextResult
  snapshot: CharacterLifecycleSnapshotV1
  characterName: string
  config: AIConfig
  routingCategory: string
  signal?: AbortSignal
}

export interface PreparedCharacterLifecycleCopilotV1 {
  node: GenerationNode<CharacterLifecycleNodeInputV1, CharacterLifecycleCandidateV1, { characterId: number; status: CharacterNarrativeStatus }>
  prepared: PreparedGenerationNode
  input: CharacterLifecycleNodeInputV1
  snapshot: CharacterLifecycleSnapshotV1
  contextSources: string[]
  contextEvidence: AgentContextEvidence
  label: string
  modelIdentity: MasterCandidateModelIdentityV1
  contextGatewayExecution: ContextGatewayExecutionV1
}

interface CharacterLifecycleDependenciesV1 {
  runAI?: (messages: ChatMessage[]) => Promise<string>
  readCurrentSnapshot?: () => Promise<CharacterLifecycleSnapshotV1>
}

export class CharacterLifecycleStaleError extends Error {
  constructor() {
    super('目标角色或绑定的章节/故事线证据已变化，请重新生成状态候选。')
    this.name = 'CharacterLifecycleStaleError'
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象。`)
  return value as Record<string, unknown>
}

function positiveId(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${label} 必须是正整数。`)
  return Number(value)
}

function nullableId(value: unknown, label: string): number | null {
  return value == null ? null : positiveId(value, label)
}

function status(value: unknown, label: string): CharacterNarrativeStatus {
  if (!CHARACTER_NARRATIVE_STATUSES.includes(value as CharacterNarrativeStatus)) {
    throw new Error(`${label} 不是支持的角色状态。`)
  }
  return value as CharacterNarrativeStatus
}

function text(value: unknown, label: string, options: { required?: boolean; max?: number } = {}): string {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串。`)
  const result = value.trim()
  if (options.required && !result) throw new Error(`${label} 不能为空。`)
  if (result.length > (options.max ?? 12_000)) throw new Error(`${label} 超过长度上限。`)
  return result
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed)
  const missing = allowed.filter(key => !Object.prototype.hasOwnProperty.call(value, key))
  const unknown = Object.keys(value).filter(key => !allowedSet.has(key))
  if (missing.length) throw new Error(`${label} 缺少字段：${missing.join('、')}。`)
  if (unknown.length) throw new Error(`${label} 包含不允许的字段：${unknown.join('、')}。`)
}

export function parseCharacterLifecycleTaskInputV1(value: unknown): CharacterLifecycleTaskInputV1 {
  const source = record(value, '角色生命周期任务')
  const keys = ['characterId', 'targetStatus', 'evidenceChapterId', 'evidenceStoryArcId'] as const
  exactKeys(source, keys, '角色生命周期任务')
  const result = {
    characterId: positiveId(source.characterId, 'characterId'),
    targetStatus: status(source.targetStatus, 'targetStatus'),
    evidenceChapterId: nullableId(source.evidenceChapterId, 'evidenceChapterId'),
    evidenceStoryArcId: nullableId(source.evidenceStoryArcId, 'evidenceStoryArcId'),
  }
  if (result.evidenceChapterId == null && result.evidenceStoryArcId == null) {
    throw new Error('角色状态变化必须绑定触发章节或故事线证据。')
  }
  return result
}

export function parseCharacterLifecycleCandidateV1(
  raw: string,
  snapshot: CharacterLifecycleSnapshotV1,
): CharacterLifecycleCandidateV1 {
  return parseStructuredOutputV1({
    raw,
    contract: {
      version: 1,
      schemaId: 'character-lifecycle-candidate.v1',
      target: `characters.${snapshot.character.id}.narrativeStatus`,
      root: 'object',
      maxChars: 40_000,
      allowedRootFields: ['version', 'characterId', 'fromStatus', 'targetStatus', 'reason', 'ending', 'activeChapterRange'],
      requiredRootFields: ['version', 'characterId', 'fromStatus', 'targetStatus', 'reason', 'ending', 'activeChapterRange'],
      unknownRootFieldMessage: '角色生命周期候选包含越权字段。',
    },
    parse: value => {
      const source = record(value, '角色生命周期候选')
      exactKeys(source, ['version', 'characterId', 'fromStatus', 'targetStatus', 'reason', 'ending', 'activeChapterRange'], '角色生命周期候选')
      if (source.version !== 1) throw new Error('角色生命周期候选版本无效。')
      const candidate: CharacterLifecycleCandidateV1 = {
        version: 1,
        characterId: positiveId(source.characterId, 'characterId'),
        fromStatus: status(source.fromStatus, 'fromStatus'),
        targetStatus: status(source.targetStatus, 'targetStatus'),
        reason: text(source.reason, 'reason', { required: true, max: 8_000 }),
        ending: text(source.ending, 'ending', { max: 12_000 }),
        activeChapterRange: text(source.activeChapterRange, 'activeChapterRange', { max: 2_000 }),
      }
      if (candidate.characterId !== snapshot.character.id
        || candidate.fromStatus !== snapshot.character.narrativeStatus
        || candidate.targetStatus !== snapshot.request.targetStatus) {
        throw new Error('角色生命周期候选改变了冻结目标、原状态或目标状态。')
      }
      return candidate
    },
  })
}

export function serializeCharacterLifecycleCandidateV1(
  candidate: CharacterLifecycleCandidateV1,
  snapshot: CharacterLifecycleSnapshotV1,
): string {
  return JSON.stringify(parseCharacterLifecycleCandidateV1(JSON.stringify(candidate), snapshot), null, 2)
}

function snapshotBody(input: Omit<CharacterLifecycleSnapshotV1, 'serialized'>) {
  return input
}

function makeSnapshot(input: Omit<CharacterLifecycleSnapshotV1, 'serialized'>): CharacterLifecycleSnapshotV1 {
  const body = snapshotBody(input)
  return { ...body, serialized: JSON.stringify(body) }
}

async function readSnapshot(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  request: CharacterLifecycleTaskInputV1
}): Promise<{ snapshot: CharacterLifecycleSnapshotV1; character: Character; mandatoryKeys: string[] }> {
  const characters = await readOwnedRows<Character>(input.scope, 'characters', { owner: 'world' })
  const character = characters.find(row => row.id === input.request.characterId)
  if (!character?.id || !character.ragDocumentId) throw new Error('目标角色不存在或缺少资料身份。')
  if (!character.isCrossWorld
    && (character.homeWorldGroupId ?? null) !== input.worldGroupId) {
    throw new Error('目标角色不属于当前世界，不能生成状态变化候选。')
  }
  const evidence: CharacterLifecycleEvidenceSnapshotV1[] = []
  const mandatoryKeys = [`character:${character.ragDocumentId}`]
  if (input.request.evidenceChapterId != null) {
    const chapter = (await readOwnedRows<Chapter>(input.scope, 'chapters', { owner: 'work' }))
      .find(row => row.id === input.request.evidenceChapterId)
    if (!chapter?.id || !chapter.ragDocumentId) throw new Error('触发章节不存在或缺少资料身份。')
    evidence.push({ table: 'chapters', id: chapter.id, ragDocumentId: chapter.ragDocumentId, updatedAt: chapter.updatedAt })
    mandatoryKeys.push(`chapter:${chapter.ragDocumentId}`)
  }
  if (input.request.evidenceStoryArcId != null) {
    const arc = (await readOwnedRows<StoryArc & { ragDocumentId?: string }>(input.scope, 'storyArcs', { owner: 'work' }))
      .find(row => row.id === input.request.evidenceStoryArcId)
    if (!arc?.id || !arc.ragDocumentId) throw new Error('触发故事线不存在或缺少资料身份。')
    evidence.push({ table: 'storyArcs', id: arc.id, ragDocumentId: arc.ragDocumentId, updatedAt: arc.updatedAt })
    mandatoryKeys.push(`story-arc:${arc.ragDocumentId}`)
  }
  return {
    character,
    mandatoryKeys,
    snapshot: makeSnapshot({
      version: 1,
      request: input.request,
      character: {
        id: character.id,
        ragDocumentId: character.ragDocumentId,
        updatedAt: character.updatedAt,
        homeWorldGroupId: character.homeWorldGroupId ?? null,
        isCrossWorld: Boolean(character.isCrossWorld),
        narrativeStatus: character.narrativeStatus ?? 'active',
        exitChapterId: character.exitChapterId ?? null,
        ending: character.ending ?? '',
        activeChapterRange: character.activeChapterRange ?? '',
      },
      evidence,
    }),
  }
}

function messages(input: CharacterLifecycleNodeInputV1): ChatMessage[] {
  return appendSimplifiedChineseOutputConstraint([{
    role: 'system',
    content: [
      '你是 StoryForge Character Agent 的角色状态演化 Skill。',
      '本轮只形成一个可编辑候选，不修改任何角色关系、物品、故事线、大纲、正文或其它角色。',
      '目标状态由作者冻结，不得自行更换。状态变化必须由绑定章节/故事线证据支撑。',
      '只输出严格 JSON，不要 Markdown 或解释。',
    ].join('\n'),
  }, {
    role: 'user',
    content: [
      input.inputGuidance,
      `【作者目标】${input.authorRequest}`,
      `【目标角色】${input.characterName}`,
      `【状态变化】${input.snapshot.character.narrativeStatus} → ${input.snapshot.request.targetStatus}`,
      `【正式上下文】\n${input.assembled.text}`,
      `【输出结构】\n${JSON.stringify({
        version: 1,
        characterId: input.snapshot.character.id,
        fromStatus: input.snapshot.character.narrativeStatus,
        targetStatus: input.snapshot.request.targetStatus,
        reason: '基于证据的具体理由',
        ending: '退场/死亡时的结局描述；其它状态可为空字符串',
        activeChapterRange: '可选的活跃章节范围',
      }, null, 2)}`,
    ].join('\n\n'),
  }])
}

async function adoptCandidate(input: {
  projectId: number
  scope: WorkspaceScope
  worldGroupId: number | null
  snapshot: CharacterLifecycleSnapshotV1
  candidate: CharacterLifecycleCandidateV1
  producerRunContractHash?: string | null
  producerCandidateHash?: string | null
}): Promise<{ characterId: number; status: CharacterNarrativeStatus }> {
  const current = (await readSnapshot({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    request: input.snapshot.request,
  })).snapshot
  if (current.serialized !== input.snapshot.serialized) throw new CharacterLifecycleStaleError()
  const candidate = parseCharacterLifecycleCandidateV1(JSON.stringify(input.candidate), input.snapshot)
  const departing = candidate.targetStatus === 'retired' || candidate.targetStatus === 'deceased'
  const result = await adopt({
    projectId: input.projectId,
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    target: 'characters',
    recordId: candidate.characterId,
    mode: 'merge-diffs',
    data: {
      narrativeStatus: candidate.targetStatus,
      statusEvidenceChapterId: input.snapshot.request.evidenceChapterId,
      statusEvidenceStoryArcId: input.snapshot.request.evidenceStoryArcId,
      statusReason: candidate.reason,
      statusProducerContractHash: input.producerRunContractHash ?? null,
      statusProducerCandidateHash: input.producerCandidateHash ?? null,
      ...(candidate.activeChapterRange ? { activeChapterRange: candidate.activeChapterRange } : {}),
      ...(departing ? {
        exitChapterId: input.snapshot.request.evidenceChapterId,
        ...(candidate.ending ? { ending: candidate.ending } : {}),
      } : {}),
    },
  })
  if (result.unknown.length || result.typeErrors.length || result.fkErrors.length) {
    throw new Error('角色状态候选未能通过统一写回层。')
  }
  return { characterId: candidate.characterId, status: candidate.targetStatus }
}

export async function adoptRestoredCharacterLifecycleCandidateV1(input: {
  projectId: number
  scope: WorkspaceScope
  worldGroupId: number | null
  snapshot: CharacterLifecycleSnapshotV1
  draft: string
  producerRunContractHash?: string | null
  producerCandidateHash?: string | null
}) {
  return adoptCandidate({
    ...input,
    candidate: parseCharacterLifecycleCandidateV1(input.draft, input.snapshot),
  })
}

export async function prepareCharacterLifecycleCopilotV1(
  input: {
    projectId: number
    scope?: WorkspaceScope
    worldGroupId: number | null
    request: CharacterLifecycleTaskInputV1
    authorRequest: string
    skillId?: AgentSkillId
    contextProfile?: AgentContextProfile
    configOverride?: AIConfig
    signal?: AbortSignal
  },
  dependencies: CharacterLifecycleDependenciesV1 = {},
): Promise<PreparedCharacterLifecycleCopilotV1> {
  const request = parseCharacterLifecycleTaskInputV1(input.request)
  const skill = resolveAgentSkillV1('character', input.skillId ?? 'character.lifecycle')
  if (skill.executionMode !== 'lifecycle') throw new Error('角色状态 Copilot 只接受 character.lifecycle Skill。')
  const readScope = input.scope ?? await resolveReadScopeLike(input.projectId)
  const before = await readSnapshot({ scope: readScope, worldGroupId: input.worldGroupId, request })
  if (before.snapshot.character.narrativeStatus === request.targetStatus) {
    throw new Error('目标角色已经处于该状态，无需生成变化候选。')
  }
  const authorRequest = text(input.authorRequest, '作者目标', { required: true, max: 1_000 })
  const routingCategory = 'agent.character.lifecycle'
  const config = input.configOverride ?? resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: routingCategory },
  ).config
  const contextProfile = input.contextProfile ?? 'balanced'
  const contextPolicy = resolveAgentContextPolicy(skill.contextTaskKind, contextProfile)
  if (!isContextGatewayRequiredForWriteTargetV1(skill, 'characters.narrativeStatus')) {
    throw new Error('角色状态正式入口未启用 required Context Gateway。')
  }
  const execution = await executeContextGatewayV1({
    skill,
    scope: readScope,
    worldGroupId: input.worldGroupId,
    query: `判断角色“${before.character.name}”从 ${before.snapshot.character.narrativeStatus} 变化为 ${request.targetStatus} 的具体表现和后果。\n${authorRequest}`,
    budgetTokens: Math.min(contextPolicy.maxInputTokens, skill.contextGateway!.maxRetrievedTokens),
    mandatoryResourceKeys: before.mandatoryKeys,
    mandatoryFullResourceKeys: [before.mandatoryKeys[0]!],
    targetResourceKeys: [before.mandatoryKeys[0]!],
    entityKeys: [before.mandatoryKeys[0]!],
    additionalReadsEnabled: false,
    signal: input.signal,
  })
  const assembled = assembleContextGatewayPacketV1(execution, contextPolicy.maxInputTokens)
  const after = await readSnapshot({ scope: readScope, worldGroupId: input.worldGroupId, request })
  if (before.snapshot.serialized !== after.snapshot.serialized) throw new CharacterLifecycleStaleError()
  const inputState = projectContextGatewayInputStateV1(skill, execution, assembled)
  const contextEvidence = attachAgentContextInputStateV1(
    evidenceFromContextResult(contextProfile, assembled),
    inputState,
  )
  contextEvidence.inputStateSourceKeys = contextGatewayInputStateSourceKeysV1(skill, execution)
  const nodeInput: CharacterLifecycleNodeInputV1 = {
    projectId: input.projectId,
    scope: readScope,
    worldGroupId: input.worldGroupId,
    authorRequest,
    inputGuidance: buildAgentSkillInputGuidanceV1(skill, inputState),
    assembled,
    snapshot: after.snapshot,
    characterName: after.character.name,
    config,
    routingCategory,
    signal: input.signal,
  }
  const node: GenerationNode<CharacterLifecycleNodeInputV1, CharacterLifecycleCandidateV1, { characterId: number; status: CharacterNarrativeStatus }> = {
    id: `agent.character.lifecycle:${input.projectId}:${request.characterId}`,
    kind: 'character.lifecycle',
    editableInput: true,
    assembleInput: messages,
    run: async prompt => parseCharacterLifecycleCandidateV1(
      await (dependencies.runAI ?? (messages => chat(messages, config, {
        category: routingCategory,
        projectId: input.projectId,
        configOverrides: { maxTokens: 4_000, temperature: 0.3 },
        contextOverflowPolicy: 'reject',
      }, input.signal)))(prompt),
      after.snapshot,
    ),
    gate: output => {
      try {
        parseCharacterLifecycleCandidateV1(JSON.stringify(output), after.snapshot)
        return { status: 'pass', issues: [] }
      } catch (error) {
        return { status: 'blocked', issues: [{ code: 'character-lifecycle-contract', message: error instanceof Error ? error.message : String(error) }] }
      }
    },
    adopt: output => adoptCandidate({
      projectId: input.projectId,
      scope: readScope,
      worldGroupId: input.worldGroupId,
      snapshot: after.snapshot,
      candidate: output,
    }),
  }
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    input: nodeInput,
    snapshot: after.snapshot,
    contextSources: assembled.included,
    contextEvidence,
    label: `角色“${after.character.name}”状态：${after.snapshot.character.narrativeStatus} → ${request.targetStatus}`,
    modelIdentity: { provider: config.provider, model: config.model },
    contextGatewayExecution: execution,
  }
}
