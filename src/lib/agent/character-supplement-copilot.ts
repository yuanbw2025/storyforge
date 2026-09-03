import { useAIConfigStore } from '../../stores/ai-config'
import { chat, resolveRequestConfig } from '../ai/client'
import { appendSimplifiedChineseOutputConstraint } from '../ai/adapters/prompt-guards'
import { CHARACTER_DIMENSIONS, type CharacterDimensionKey } from '../character/character-dimensions'
import { db } from '../db/schema'
import {
  prepareGenerationNode,
  type GenerationGateIssue,
  type GenerationNode,
  type PreparedGenerationNode,
} from '../generation/generation-node'
import { adopt } from '../registry/adopt'
import type { AssembleContextResult } from '../registry/types'
import type { AIConfig, Character, ChatMessage, WorkspaceScope } from '../types'
import {
  readOwnedRows,
  resolveReadScopeLike,
} from '../workspace/scope'
import {
  attachAgentContextInputStateV1,
  evidenceFromContextResult,
  resolveAgentContextPolicy,
  type AgentContextEvidence,
  type AgentContextProfile,
} from './context-policy'
import type { AgentContextCompressionRuntimeV1 } from './context-compression'
import {
  buildAgentSkillInputGuidanceV1,
  resolveAgentSkillV1,
  type AgentSkillId,
} from './skill-registry'
import {
  executeContextGatewayV1,
  type ContextGatewayExecutionV1,
} from '../context-gateway/execution'
import { isContextGatewayRequiredForWriteTargetV1 } from '../context-gateway/skill-policy'
import {
  assembleContextGatewayPacketV1,
  contextGatewayInputStateSourceKeysV1,
  projectContextGatewayInputStateV1,
} from './context-gateway-input'
import type { MasterCandidateModelIdentityV1 } from './master-candidate-semantic-review'
import { hashCanonicalValue } from './run/hash'
import { CANON_RESOURCE_PROVIDER_V1 } from '../context-gateway/canon-provider'
import { parseStructuredOutputV1 } from './structured-output-pipeline'

const MAX_CANDIDATE_CHARS = 240_000
const MAX_FIELD_CHARS = 20_000
const DIMENSION_KEYS = CHARACTER_DIMENSIONS.map(dimension => dimension.key)
const DIMENSION_KEY_SET = new Set<CharacterDimensionKey>(DIMENSION_KEYS)
const DIMENSION_ORDER = new Map(DIMENSION_KEYS.map((key, index) => [key, index]))

export interface CharacterSupplementTaskInputV1 {
  characterId: number
  dimensions: CharacterDimensionKey[]
  useEvidence: boolean
}

export interface CharacterSupplementCandidateV1 {
  version: 1
  patch: Partial<Record<CharacterDimensionKey, string>>
}

export interface CharacterSupplementSourceBindingV1 {
  key: string
  sourceHash: string
}

export interface CharacterSupplementCopilotSnapshotV1 {
  version: 1
  request: CharacterSupplementTaskInputV1
  sourceBindings: CharacterSupplementSourceBindingV1[]
  serialized: string
}

interface CharacterSupplementCopilotInputV1 {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  authorRequest: string
  inputGuidance: string
  assembled: AssembleContextResult
  snapshot: CharacterSupplementCopilotSnapshotV1
  characterName: string
  config: AIConfig
  routingCategory: string
  generationOverrides?: { temperature?: number; maxTokens?: number }
  signal?: AbortSignal
}

export interface PreparedCharacterSupplementCopilotV1 {
  node: GenerationNode<
    CharacterSupplementCopilotInputV1,
    CharacterSupplementCandidateV1,
    { characterId: number; fields: CharacterDimensionKey[] }
  >
  prepared: PreparedGenerationNode
  input: CharacterSupplementCopilotInputV1
  contextSources: string[]
  contextEvidence: AgentContextEvidence
  snapshot: CharacterSupplementCopilotSnapshotV1
  label: string
  modelIdentity: MasterCandidateModelIdentityV1
  contextGatewayExecution?: ContextGatewayExecutionV1
}

interface CharacterSupplementCopilotDependenciesV1 {
  runAI?: (messages: ChatMessage[]) => Promise<string>
  readCurrentSourceBindings?: () => Promise<CharacterSupplementSourceBindingV1[]>
}

export class CharacterSupplementCopilotStaleError extends Error {
  constructor() {
    super('角色或本次补全所依据的设定与剧情证据已经变化。为避免覆盖新内容，请重新生成。')
    this.name = 'CharacterSupplementCopilotStaleError'
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象。`)
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed)
  const missing = required.filter(key => !Object.prototype.hasOwnProperty.call(value, key))
  const unknown = Object.keys(value).filter(key => !allowedSet.has(key))
  if (missing.length) throw new Error(`${label} 缺少字段：${missing.join('、')}。`)
  if (unknown.length) throw new Error(`${label} 包含不允许的字段：${unknown.join('、')}。`)
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${label} 必须是正整数。`)
  return Number(value)
}

function requiredText(value: unknown, label: string, max = MAX_FIELD_CHARS): string {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串。`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} 不能为空。`)
  if (trimmed.length > max) throw new Error(`${label} 超过 ${max} 字符。`)
  return trimmed
}

export function parseCharacterSupplementTaskInputV1(value: unknown): CharacterSupplementTaskInputV1 {
  const source = record(value, '角色补全任务输入')
  exactKeys(source, ['characterId', 'dimensions', 'useEvidence'], ['characterId', 'dimensions', 'useEvidence'], '角色补全任务输入')
  if (!Array.isArray(source.dimensions) || source.dimensions.length < 1 || source.dimensions.length > DIMENSION_KEYS.length) {
    throw new Error(`角色补全任务 dimensions 必须是 1-${DIMENSION_KEYS.length} 项数组。`)
  }
  const dimensions = source.dimensions.map((value, index) => {
    if (typeof value !== 'string' || !DIMENSION_KEY_SET.has(value as CharacterDimensionKey)) {
      throw new Error(`角色补全任务 dimensions[${index}] 不是可补全字段。`)
    }
    return value as CharacterDimensionKey
  })
  if (new Set(dimensions).size !== dimensions.length) throw new Error('角色补全任务 dimensions 不得重复。')
  if (typeof source.useEvidence !== 'boolean') throw new Error('角色补全任务 useEvidence 必须是布尔值。')
  return {
    characterId: positiveInteger(source.characterId, '角色补全任务 characterId'),
    dimensions: [...dimensions].sort((left, right) => DIMENSION_ORDER.get(left)! - DIMENSION_ORDER.get(right)!),
    useEvidence: source.useEvidence,
  }
}

export function parseCharacterSupplementCandidateDraftV1(
  raw: string,
  request: CharacterSupplementTaskInputV1,
): CharacterSupplementCandidateV1 {
  const parsedRequest = parseCharacterSupplementTaskInputV1(request)
  return parseStructuredOutputV1({
    raw,
    contract: {
      version: 1,
      schemaId: 'character-supplement-candidate.v1',
      target: `character:${parsedRequest.characterId}:dimensions:${parsedRequest.dimensions.join(',')}`,
      root: 'object',
      maxChars: MAX_CANDIDATE_CHARS,
      allowedRootFields: ['version', 'patch'],
      requiredRootFields: ['version', 'patch'],
      unknownRootFieldMessage: '角色补全候选包含不允许的字段。',
    },
    parse: value => {
      const root = record(value, '角色补全候选')
      exactKeys(root, ['version', 'patch'], ['version', 'patch'], '角色补全候选')
      if (root.version !== 1) throw new Error('角色补全候选版本不受支持。')
      const patchSource = record(root.patch, '角色补全候选 patch')
      exactKeys(patchSource, parsedRequest.dimensions, parsedRequest.dimensions, '角色补全候选 patch')
      const patch: Partial<Record<CharacterDimensionKey, string>> = {}
      for (const dimension of parsedRequest.dimensions) {
        patch[dimension] = requiredText(patchSource[dimension], `角色补全候选 patch.${dimension}`)
      }
      return { version: 1, patch }
    },
  })
}

export function serializeCharacterSupplementCandidateV1(
  candidate: CharacterSupplementCandidateV1,
  request: CharacterSupplementTaskInputV1,
): string {
  const parsed = parseCharacterSupplementCandidateDraftV1(JSON.stringify(candidate), request)
  return JSON.stringify(parsed, null, 2)
}

async function gatewayDecisionHash(input: {
  resourceKey: string
  contentRevision: number | string
  contentHash: string
  policyRevision: number
  policyHash: string
  sourceRefs: unknown
}): Promise<string> {
  return hashCanonicalValue({
    version: 1,
    resourceKey: input.resourceKey,
    contentRevision: input.contentRevision,
    contentHash: input.contentHash,
    policyRevision: input.policyRevision,
    policyHash: input.policyHash,
    sourceRefs: input.sourceRefs,
  })
}

async function gatewaySourceBindings(
  execution: ContextGatewayExecutionV1,
): Promise<CharacterSupplementSourceBindingV1[]> {
  const decisions = [
    ...execution.retrievalTrace.mandatory,
    ...execution.retrievalTrace.autoSelected,
    ...execution.retrievalTrace.agentReads,
  ]
  return Promise.all([...decisions]
    .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey))
    .map(async decision => ({
      key: decision.resourceKey,
      sourceHash: await gatewayDecisionHash({
        resourceKey: decision.resourceKey,
        contentRevision: decision.revision,
        contentHash: decision.contentHash,
        policyRevision: decision.policyRevision ?? 0,
        policyHash: decision.policyHash ?? '',
        sourceRefs: decision.sourceRefs,
      }),
    })))
}

async function currentGatewaySourceBindings(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  expected: readonly CharacterSupplementSourceBindingV1[]
}): Promise<CharacterSupplementSourceBindingV1[]> {
  const wanted = new Set(input.expected.map(binding => binding.key))
  const found = new Map<string, CharacterSupplementSourceBindingV1>()
  let cursor: string | undefined
  do {
    const page = await CANON_RESOURCE_PROVIDER_V1.listMetadata({
      scope: {
        projectId: input.scope.projectId,
        worldId: input.scope.worldId,
        workId: input.scope.workId,
        worldGroupId: input.worldGroupId,
      },
      kinds: [...CANON_RESOURCE_PROVIDER_V1.kinds],
      limit: 100,
      cursor,
    })
    for (const descriptor of page.items) {
      if (!wanted.has(descriptor.resourceKey)) continue
      found.set(descriptor.resourceKey, {
        key: descriptor.resourceKey,
        sourceHash: await gatewayDecisionHash({
          resourceKey: descriptor.resourceKey,
          contentRevision: descriptor.contentRevision,
          contentHash: descriptor.contentHash,
          policyRevision: descriptor.policyRevision,
          policyHash: descriptor.policyHash,
          sourceRefs: descriptor.sourceRefs,
        }),
      })
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor && found.size < wanted.size)
  return input.expected.map(binding => found.get(binding.key) ?? { key: binding.key, sourceHash: 'missing' })
}

function buildSnapshot(
  request: CharacterSupplementTaskInputV1,
  bindings: CharacterSupplementSourceBindingV1[],
): CharacterSupplementCopilotSnapshotV1 {
  const body = { version: 1 as const, request, sourceBindings: bindings }
  return { ...body, serialized: JSON.stringify(body) }
}

function parseSnapshot(value: CharacterSupplementCopilotSnapshotV1): CharacterSupplementCopilotSnapshotV1 {
  const source = record(value, '角色补全快照')
  exactKeys(source, ['version', 'request', 'sourceBindings', 'serialized'], ['version', 'request', 'sourceBindings', 'serialized'], '角色补全快照')
  if (source.version !== 1 || typeof source.serialized !== 'string') throw new Error('角色补全快照版本或序列化证据无效。')
  const request = parseCharacterSupplementTaskInputV1(source.request)
  if (!Array.isArray(source.sourceBindings)) throw new Error('角色补全快照 sourceBindings 必须是数组。')
  const bindings = source.sourceBindings.map((item, index) => {
    const binding = record(item, `角色补全快照 sourceBindings[${index}]`)
    exactKeys(binding, ['key', 'sourceHash'], ['key', 'sourceHash'], `角色补全快照 sourceBindings[${index}]`)
    const key = requiredText(binding.key, `角色补全快照 sourceBindings[${index}].key`, 120)
    const sourceHash = requiredText(binding.sourceHash, `角色补全快照 sourceBindings[${index}].sourceHash`, 64)
    if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error('角色补全快照来源哈希无效。')
    return { key, sourceHash }
  })
  if (new Set(bindings.map(binding => binding.key)).size !== bindings.length) {
    throw new Error('角色补全快照来源不得重复。')
  }
  const parsed = buildSnapshot(request, bindings)
  if (parsed.serialized !== source.serialized) throw new Error('角色补全快照序列化证据不匹配。')
  return parsed
}

async function readTargetCharacter(
  projectId: number,
  scope: WorkspaceScope | undefined,
  worldGroupId: number | null,
  characterId: number,
): Promise<Character> {
  const readScope = scope ?? await resolveReadScopeLike(projectId)
  const rows = await readOwnedRows<Character>(readScope, 'characters', { owner: 'world' })
  const character = rows.find(row => row.id === characterId)
  if (!character) throw new Error('目标角色不存在或不属于当前世界。')
  if (
    worldGroupId != null
    && !character.isCrossWorld
    && (character.homeWorldGroupId ?? null) !== worldGroupId
  ) throw new Error('目标角色不属于本次执行世界。')
  return character
}

function buildMessages(input: CharacterSupplementCopilotInputV1): ChatMessage[] {
  const requested = input.snapshot.request.dimensions.map(key => {
    const dimension = CHARACTER_DIMENSIONS.find(item => item.key === key)!
    return `- ${key}（${dimension.label}）`
  }).join('\n')
  const jsonShape = Object.fromEntries(input.snapshot.request.dimensions.map(key => [key, '中文内容']))
  return appendSimplifiedChineseOutputConstraint([{
    role: 'system',
    content: [
      '你是 StoryForge Character Agent 的“已有角色定向补全”Skill。',
      '只补全作者本次选择的角色字段，不新建角色，不修改名字、角色轴、关系、正文或任何其它数据。',
      '目标角色已有设定和已确认上游设定是硬约束；不得用推断覆盖它们。',
      input.snapshot.request.useEvidence
        ? '已启用反向哺喂：剧情事实和正文表现是已经发生的证据，补全不得与之冲突。'
        : '未启用反向哺喂：不得声称读取或依据正文事实。',
      '每个请求字段必须返回一个具体、非空、可直接保存的中文字符串。',
      '只输出严格 JSON 对象，不要解释、Markdown 或额外字段。',
    ].join('\n'),
  }, {
    role: 'user',
    content: [
      input.inputGuidance,
      `【作者目标】\n${input.authorRequest}`,
      `【本次目标角色】${input.characterName}`,
      `【只允许补全的字段】\n${requested}`,
      `【正式上下文】\n${input.assembled.text || '（除目标角色外暂无其它设定）'}`,
      `【输出结构】\n${JSON.stringify({ version: 1, patch: jsonShape }, null, 2)}`,
    ].join('\n\n'),
  }])
}

function candidateIssues(
  candidate: CharacterSupplementCandidateV1,
  request: CharacterSupplementTaskInputV1,
): GenerationGateIssue[] {
  try {
    parseCharacterSupplementCandidateDraftV1(JSON.stringify(candidate), request)
    return []
  } catch (error) {
    return [{
      code: 'character-supplement-contract',
      message: error instanceof Error ? error.message : String(error),
    }]
  }
}

async function applyCandidate(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  snapshot: CharacterSupplementCopilotSnapshotV1
  draft: string
  readCurrentSourceBindings?: () => Promise<CharacterSupplementSourceBindingV1[]>
}): Promise<{ characterId: number; fields: CharacterDimensionKey[] }> {
  const snapshot = parseSnapshot(input.snapshot)
  const candidate = parseCharacterSupplementCandidateDraftV1(input.draft, snapshot.request)
  const currentBindings = input.readCurrentSourceBindings
    ? await input.readCurrentSourceBindings()
    : await (async () => {
        const resolved = input.scope ?? await resolveReadScopeLike(input.projectId)
        return currentGatewaySourceBindings({
          scope: resolved,
          worldGroupId: input.worldGroupId,
          expected: snapshot.sourceBindings,
        })
      })()
  if (JSON.stringify(currentBindings) !== JSON.stringify(snapshot.sourceBindings)) {
    throw new CharacterSupplementCopilotStaleError()
  }
  const result = await adopt({
    projectId: input.projectId,
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    target: 'characters',
    recordId: snapshot.request.characterId,
    mode: 'merge-diffs',
    data: candidate.patch,
  })
  if (result.unknown.length || result.typeErrors.length || result.fkErrors.length) {
    throw new Error('角色补全候选未能通过统一写回层。')
  }
  const character = await readTargetCharacter(
    input.projectId,
    input.scope,
    input.worldGroupId,
    snapshot.request.characterId,
  )
  const matches = snapshot.request.dimensions.every(key => character[key] === candidate.patch[key])
  if (!matches) throw new Error('角色补全写回后的正式数据与候选不一致。')
  return { characterId: snapshot.request.characterId, fields: snapshot.request.dimensions }
}

export async function adoptRestoredCharacterSupplementCandidateV1(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  snapshot: CharacterSupplementCopilotSnapshotV1
  draft: string
}) {
  return applyCandidate(input)
}

export async function characterSupplementCandidateMatchesBusinessStateV1(input: {
  scope: WorkspaceScope
  snapshot: CharacterSupplementCopilotSnapshotV1
  draft: string
}): Promise<boolean> {
  const snapshot = parseSnapshot(input.snapshot)
  const candidate = parseCharacterSupplementCandidateDraftV1(input.draft, snapshot.request)
  const character = (await readOwnedRows<Character>(input.scope, 'characters', { owner: 'world' }))
    .find(row => row.id === snapshot.request.characterId)
  return Boolean(character && snapshot.request.dimensions.every(key => character[key] === candidate.patch[key]))
}

export async function prepareCharacterSupplementCopilotV1(
  input: {
    projectId: number
    scope?: WorkspaceScope
    worldGroupId: number | null
    request: CharacterSupplementTaskInputV1
    authorRequest: string
    skillId?: AgentSkillId
    routingCategory?: string
    contextProfile?: AgentContextProfile
    configOverride?: AIConfig
    generationOverrides?: { temperature?: number; maxTokens?: number }
    contextCompressionRuntime?: AgentContextCompressionRuntimeV1
    signal?: AbortSignal
  },
  dependencies: CharacterSupplementCopilotDependenciesV1 = {},
): Promise<PreparedCharacterSupplementCopilotV1> {
  const request = parseCharacterSupplementTaskInputV1(input.request)
  const authorRequest = requiredText(input.authorRequest, '角色补全作者目标', 1_000)
  const skill = resolveAgentSkillV1('character', input.skillId ?? 'character.supplement')
  if (skill.executionMode !== 'supplement') {
    throw new Error('角色补全 Copilot 只接受 character.supplement Skill。')
  }
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  if (project.enableMultiWorld && input.worldGroupId == null) {
    throw new Error('多世界项目必须先确定目标角色所属世界。')
  }
  const readScope = input.scope ?? await resolveReadScopeLike(input.projectId)
  const scope = readScope
  const character = await readTargetCharacter(input.projectId, scope, input.worldGroupId, request.characterId)
  const routingCategory = input.routingCategory ?? 'agent.character.supplement'
  const config = input.configOverride ?? resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: routingCategory },
  ).config
  const contextProfile = input.contextProfile ?? 'balanced'
  const contextPolicy = resolveAgentContextPolicy(skill.contextTaskKind, contextProfile)
  const writeTarget = `characters.${request.dimensions[0]}`
  const gatewayRequired = isContextGatewayRequiredForWriteTargetV1(skill, writeTarget)
  if (gatewayRequired && !scope) {
    throw new Error('角色补全 Gateway required 入口需要稳定 WorkspaceScope，旧项目必须先完成所有权迁移。')
  }
  if (!character.ragDocumentId) {
    throw new Error('目标角色缺少 portable resource UID，必须先完成角色资料身份迁移。')
  }
  const targetResourceKey = `character:${character.ragDocumentId}`
  const contextGatewayExecution = gatewayRequired
    ? await executeContextGatewayV1({
        skill,
        scope: scope!,
        worldGroupId: project.enableMultiWorld ? input.worldGroupId : null,
        budgetTokens: Math.min(contextPolicy.maxInputTokens, skill.contextGateway!.maxRetrievedTokens),
        query: [
          `补全目标角色“${character.name}”的字段：${request.dimensions.join('、')}。`,
          '按关系选择其他角色、种族词条、地点、力量体系、故事线和世界设定。',
          request.useEvidence
            ? '允许读取与目标角色直接相关的已确认事实、认知事件和正文表现。'
            : '不读取正文表现；只依据角色与世界/故事规划资料。',
          authorRequest,
        ].join('\n'),
        mandatoryResourceKeys: [targetResourceKey],
        mandatoryFullResourceKeys: [targetResourceKey],
        targetResourceKeys: [targetResourceKey],
        entityKeys: [targetResourceKey],
        ...(request.useEvidence ? {} : {
          excludedResourceKinds: ['chapter', 'fact', 'foreshadow'] as const,
        }),
        additionalReadsEnabled: false,
        signal: input.signal,
      })
    : undefined
  if (!contextGatewayExecution) {
    throw new Error('角色补全正式入口缺少 required Context Gateway。')
  }
  const assembled = assembleContextGatewayPacketV1(
    contextGatewayExecution,
    contextPolicy.maxInputTokens,
  )
  const inputState = projectContextGatewayInputStateV1(skill, contextGatewayExecution, assembled)
  if (inputState.state === 'empty') throw new Error(inputState.handling === 'require-author-input'
    ? inputState.missingSourceKeys.includes('targetCharacter')
      ? '目标角色不存在或不属于当前世界。'
      : '角色补全缺少作者输入。'
    : '角色补全上下文不可用。')
  const bindings = await gatewaySourceBindings(contextGatewayExecution)
  const snapshot = buildSnapshot(request, bindings)
  const contextEvidence = attachAgentContextInputStateV1(
    evidenceFromContextResult(contextProfile, assembled),
    inputState,
  )
  contextEvidence.inputStateSourceKeys = contextGatewayInputStateSourceKeysV1(skill, contextGatewayExecution)
  const nodeInput: CharacterSupplementCopilotInputV1 = {
    projectId: input.projectId,
    scope,
    worldGroupId: project.enableMultiWorld ? input.worldGroupId : null,
    authorRequest,
    inputGuidance: buildAgentSkillInputGuidanceV1(skill, inputState),
    assembled,
    snapshot,
    characterName: character.name,
    config,
    routingCategory,
    generationOverrides: input.generationOverrides,
    signal: input.signal,
  }
  const node = createCharacterSupplementCopilotNodeV1(nodeInput, dependencies)
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    input: nodeInput,
    contextSources: contextEvidence.included,
    contextEvidence,
    snapshot,
    label: `补全角色“${character.name}”的 ${request.dimensions.length} 个字段`,
    modelIdentity: { provider: config.provider, model: config.model },
    contextGatewayExecution,
  }
}

export function createCharacterSupplementCopilotNodeV1(
  input: CharacterSupplementCopilotInputV1,
  dependencies: CharacterSupplementCopilotDependenciesV1 = {},
): PreparedCharacterSupplementCopilotV1['node'] {
  const runAI = dependencies.runAI ?? (messages => chat(messages, input.config, {
    category: input.routingCategory,
    projectId: input.projectId,
    configOverrides: {
      maxTokens: input.generationOverrides?.maxTokens ?? 8_000,
      temperature: input.generationOverrides?.temperature ?? 0.35,
    },
    contextOverflowPolicy: 'reject',
  }, input.signal))
  return {
    id: `agent.character.supplement:${input.projectId}:${input.snapshot.request.characterId}`,
    kind: 'character.supplement',
    editableInput: true,
    assembleInput: buildMessages,
    run: async messages => parseCharacterSupplementCandidateDraftV1(
      await runAI(messages),
      input.snapshot.request,
    ),
    gate: output => {
      const issues = candidateIssues(output, input.snapshot.request)
      return { status: issues.length ? 'blocked' : 'pass', issues }
    },
    adopt: output => applyCandidate({
      projectId: input.projectId,
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      snapshot: input.snapshot,
      draft: serializeCharacterSupplementCandidateV1(output, input.snapshot.request),
      readCurrentSourceBindings: dependencies.readCurrentSourceBindings,
    }),
  }
}
