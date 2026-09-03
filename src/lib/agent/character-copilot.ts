import { useAIConfigStore } from '../../stores/ai-config'
import { buildCharacterPrompt } from '../ai/adapters/character-adapter'
import { chat, resolveRequestConfig } from '../ai/client'
import {
  MORAL_AXES,
  ORDER_AXES,
  ROLE_WEIGHTS,
} from '../character/character-axes'
import {
  CHARACTER_DIMENSIONS,
  type CharacterDimensionKey,
} from '../character/character-dimensions'
import { db } from '../db/schema'
import type {
  GenerationGateIssue,
  GenerationNode,
  PreparedGenerationNode,
} from '../generation/generation-node'
import { prepareGenerationNode } from '../generation/generation-node'
import { adopt } from '../registry/adopt'
import type { AdoptResult } from '../registry/types'
import type { AssembleContextResult } from '../registry/types'
import type {
  AIConfig,
  Character,
  CharacterMoralAxis,
  CharacterOrderAxis,
  CharacterRoleWeight,
  WorkspaceScope,
} from '../types'
import {
  readOwnedRows,
  resolveReadScopeLike,
  resolveScope,
  scopeTransactionTables,
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
import { parseStructuredOutputV1 } from './structured-output-pipeline'
import {
  renderFrozenPromptExecutionV1,
  type PromptExecutionEvidenceV1,
  type PromptExecutionOptionsV1,
} from './prompt-execution'
import type { ChatMessage } from '../types'

export const MAX_CHARACTER_CANDIDATE_CHARS = 40_000
const MAX_CHARACTER_NAME_CHARS = 80
const MAX_CHARACTER_SUMMARY_CHARS = 800
const MAX_CHARACTER_FIELD_CHARS = 6_000

export type CharacterCopilotCandidate = {
  name: string
  roleWeight: CharacterRoleWeight
  moralAxis: CharacterMoralAxis
  orderAxis: CharacterOrderAxis
  relationships: string
} & Record<CharacterDimensionKey, string>

export interface CharacterRosterSnapshot {
  serialized: string
  visibleNames: string[]
}

export interface CharacterCopilotInput {
  projectId: number
  scope?: WorkspaceScope
  projectName: string
  genres: string
  worldGroupId: number | null
  authorRequest: string
  inputGuidance: string
  assembled: AssembleContextResult
  worldContext: string
  characterContext: string
  contextSources: string[]
  snapshot: CharacterRosterSnapshot
  config: AIConfig
  generationOverrides?: { temperature?: number; maxTokens?: number }
  frozenPromptMessages?: ChatMessage[]
  promptExecutionEvidence?: PromptExecutionEvidenceV1
  routingCategory?: string
  signal?: AbortSignal
}

export interface PreparedCharacterCopilot {
  node: GenerationNode<CharacterCopilotInput, CharacterCopilotCandidate, AdoptResult>
  prepared: PreparedGenerationNode
  input: CharacterCopilotInput
  contextSources: string[]
  snapshot: CharacterRosterSnapshot
  contextEvidence: AgentContextEvidence
  modelIdentity: MasterCandidateModelIdentityV1
  promptExecutionEvidence?: PromptExecutionEvidenceV1
  contextGatewayExecution?: ContextGatewayExecutionV1
}

interface CharacterCopilotDependencies {
  runAI?: (
    messages: ReturnType<typeof buildCharacterPrompt>,
  ) => Promise<string>
  readCurrent?: () => Promise<CharacterRosterSnapshot>
  saveCharacter?: (candidate: CharacterCopilotCandidate) => Promise<AdoptResult>
}

export class CharacterCopilotStaleError extends Error {
  constructor() {
    super('角色主档已在候选生成后发生变化。为避免基于旧阵容写入，请重新生成候选。')
    this.name = 'CharacterCopilotStaleError'
  }
}

export class CharacterCopilotDuplicateError extends Error {
  constructor(name: string) {
    super(`当前世界已经存在名为“${name}”的可见角色，请修改候选姓名或拒绝后重新生成。`)
    this.name = 'CharacterCopilotDuplicateError'
  }
}

const CANDIDATE_FIELDS = [
  'name',
  'roleWeight',
  'moralAxis',
  'orderAxis',
  'relationships',
  ...CHARACTER_DIMENSIONS.map(dimension => dimension.key),
] as const
const CANDIDATE_FIELD_SET = new Set<string>(CANDIDATE_FIELDS)

function normalizeName(name: string): string {
  return name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
}

function isVisibleInScope(character: Character, worldGroupId: number | null): boolean {
  return Boolean(character.isCrossWorld)
    || (character.homeWorldGroupId ?? null) === worldGroupId
}

export async function readCharacterRosterSnapshot(
  projectId: number,
  worldGroupId: number | null,
  scope?: WorkspaceScope,
): Promise<CharacterRosterSnapshot> {
  const resolved = scope ?? await resolveReadScopeLike(projectId)
  const rows = await readOwnedRows<Character>(resolved, 'characters', { owner: 'world' })
  const serialized = JSON.stringify(
    rows
      .map(character => ({
        id: character.id ?? null,
        updatedAt: character.updatedAt,
        name: character.name,
        homeWorldGroupId: character.homeWorldGroupId ?? null,
        isCrossWorld: Boolean(character.isCrossWorld),
      }))
      .sort((left, right) => (left.id ?? 0) - (right.id ?? 0)),
  )
  return {
    serialized,
    visibleNames: rows
      .filter(character => isVisibleInScope(character, worldGroupId))
      .map(character => normalizeName(character.name)),
  }
}

function assertAuthorRequest(value: string): string {
  const request = value.trim()
  if (request.length < 2) throw new Error('请至少输入 2 个字符的角色要求。')
  if (request.length > 1000) throw new Error('单次角色要求不能超过 1000 个字符。')
  return request
}

function stringField(
  source: Record<string, unknown>,
  field: string,
  options: { required?: boolean; max?: number } = {},
): string {
  const raw = source[field]
  if (raw == null && !options.required) return ''
  if (typeof raw !== 'string') throw new Error(`角色候选字段 ${field} 必须是字符串。`)
  const value = raw.trim()
  if (options.required && !value) throw new Error(`角色候选缺少 ${field}。`)
  if (value.length > (options.max ?? MAX_CHARACTER_FIELD_CHARS)) {
    throw new Error(`角色候选字段 ${field} 超过长度上限。`)
  }
  return value
}

export function parseCharacterCandidateDraft(draft: string): CharacterCopilotCandidate {
  return parseStructuredOutputV1({
    raw: draft,
    contract: {
      version: 1,
      schemaId: 'character-candidate.v1',
      target: 'characters.add',
      root: 'object',
      maxChars: MAX_CHARACTER_CANDIDATE_CHARS,
      allowedRootFields: [...CANDIDATE_FIELDS],
      requiredRootFields: ['name', 'roleWeight', 'moralAxis', 'orderAxis', 'shortDescription'],
      unknownRootFieldMessage: '角色候选包含不允许的字段。',
    },
    parse: value => {
      const source = value as Record<string, unknown>
      const unknown = Object.keys(source).filter(field => !CANDIDATE_FIELD_SET.has(field))
      if (unknown.length) throw new Error(`角色候选包含不允许的字段：${unknown.join('、')}。`)

      const roleWeight = source.roleWeight
      const moralAxis = source.moralAxis
      const orderAxis = source.orderAxis
      if (!ROLE_WEIGHTS.includes(roleWeight as CharacterRoleWeight)) {
        throw new Error('roleWeight 只能是 main / secondary / npc / extra。')
      }
      if (!MORAL_AXES.includes(moralAxis as CharacterMoralAxis)) {
        throw new Error('moralAxis 只能是 good / neutral / evil。')
      }
      if (!ORDER_AXES.includes(orderAxis as CharacterOrderAxis)) {
        throw new Error('orderAxis 只能是 lawful / neutral / chaotic。')
      }

      const dimensions = Object.fromEntries(
        CHARACTER_DIMENSIONS.map(dimension => [
          dimension.key,
          stringField(source, dimension.key, {
            required: dimension.key === 'shortDescription',
            max: dimension.key === 'shortDescription'
              ? MAX_CHARACTER_SUMMARY_CHARS
              : MAX_CHARACTER_FIELD_CHARS,
          }),
        ]),
      ) as Record<CharacterDimensionKey, string>
      const result: CharacterCopilotCandidate = {
        name: stringField(source, 'name', { required: true, max: MAX_CHARACTER_NAME_CHARS }),
        roleWeight: roleWeight as CharacterRoleWeight,
        moralAxis: moralAxis as CharacterMoralAxis,
        orderAxis: orderAxis as CharacterOrderAxis,
        relationships: stringField(source, 'relationships'),
        ...dimensions,
      }
      if (JSON.stringify(result).length > MAX_CHARACTER_CANDIDATE_CHARS) {
        throw new Error(`角色候选超过 ${MAX_CHARACTER_CANDIDATE_CHARS} 字符。`)
      }
      return result
    },
  })
}

function structuredOutputContract(): string {
  const dimensionLines = CHARACTER_DIMENSIONS
    .map(dimension => `  "${dimension.key}": "${dimension.label}，没有内容时为空字符串"`)
    .join(',\n')
  return `本次必须只输出一个完整 JSON 对象，不要输出 Markdown、解释或额外字段：
{
  "name": "姓名",
  "roleWeight": "main | secondary | npc | extra",
  "moralAxis": "good | neutral | evil",
  "orderAxis": "lawful | neutral | chaotic",
  "relationships": "与已有角色的关系描述；不创建关系边",
${dimensionLines}
}
姓名与 shortDescription 必填。所有字段必须是字符串；三轴只能使用上面的英文枚举。`
}

function characterHardSystem(input: CharacterCopilotInput): string {
  return `${input.inputGuidance}\n\n${structuredOutputContract()}\n\n权限与作用域：本轮只生成一名新角色候选；不得修改世界观、故事核心、故事线、大纲、物品或任何已有角色。正式上下文是只读约束，候选必须等待作者确认后才可采纳。`
}

function buildCharacterCopilotPrompt(input: CharacterCopilotInput) {
  if (input.frozenPromptMessages) return input.frozenPromptMessages.map(message => ({ ...message }))
  const messages = buildCharacterPrompt(
    input.projectName,
    input.genres,
    input.worldContext,
    input.characterContext,
    input.authorRequest,
  )
  const contract = characterHardSystem(input)
  const systemIndex = messages.findIndex(message => message.role === 'system')
  if (systemIndex >= 0) {
    messages[systemIndex] = {
      ...messages[systemIndex],
      content: `${messages[systemIndex].content}\n\n${contract}`,
    }
  } else {
    messages.unshift({ role: 'system', content: contract })
  }
  return messages
}

function candidateIssues(
  output: CharacterCopilotCandidate,
  snapshot: CharacterRosterSnapshot,
): GenerationGateIssue[] {
  const issues: GenerationGateIssue[] = []
  let parsed: CharacterCopilotCandidate | null = null
  try {
    parsed = parseCharacterCandidateDraft(JSON.stringify(output))
  } catch (error) {
    issues.push({
      code: 'character-invalid-structure',
      message: error instanceof Error ? error.message : '角色候选结构无效。',
    })
  }
  if (parsed && snapshot.visibleNames.includes(normalizeName(parsed.name))) {
    issues.push({
      code: 'character-duplicate-name',
      message: `当前世界已经存在名为“${parsed.name}”的可见角色。`,
    })
  }
  return issues
}

export async function prepareCharacterCopilot(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  authorRequest: string
  skillId?: AgentSkillId
  /** 主 Agent 可把尚未写库的上游候选作为本轮显式证据传入，绝不冒充 Canon。 */
  supplementalContext?: string
  routingCategory?: string
  contextProfile?: AgentContextProfile
  /** 节点级 AI preset 的解析结果；未提供时沿用全局路由配置。 */
  configOverride?: AIConfig
  generationOverrides?: { temperature?: number; maxTokens?: number }
  promptExecution?: PromptExecutionOptionsV1
  contextCompressionRuntime?: AgentContextCompressionRuntimeV1
  signal?: AbortSignal
}): Promise<PreparedCharacterCopilot> {
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  if (project.enableMultiWorld && input.worldGroupId == null) {
    throw new Error('多世界项目必须先选择一个世界，才能生成角色。')
  }
  const worldGroupId = project.enableMultiWorld ? input.worldGroupId : null
  const readScope = input.scope ?? await resolveReadScopeLike(input.projectId)
  const scope = readScope
  const beforeRead = await readCharacterRosterSnapshot(input.projectId, worldGroupId, scope)
  const routingCategory = input.routingCategory ?? 'character.generate'
  const config = input.configOverride ?? resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: routingCategory },
  ).config
  const contextProfile = input.contextProfile ?? 'full'
  const skill = resolveAgentSkillV1('character', input.skillId)
  const authorRequest = assertAuthorRequest(input.authorRequest)
  const contextPolicy = resolveAgentContextPolicy(skill.contextTaskKind, contextProfile)
  const gatewayRequired = isContextGatewayRequiredForWriteTargetV1(skill, 'characters.name')
  if (gatewayRequired && !scope) {
    throw new Error('角色创建 Gateway required 入口需要稳定 WorkspaceScope，旧项目必须先完成所有权迁移。')
  }
  const contextGatewayExecution = gatewayRequired
    ? await executeContextGatewayV1({
        skill,
        scope: scope!,
        worldGroupId,
        budgetTokens: Math.min(contextPolicy.maxInputTokens, skill.contextGateway!.maxRetrievedTokens),
        query: [
          '创建一名与现有世界、故事核心、故事线和角色关系兼容但不重复的新角色。',
          '按任务选择相关种族、地点、力量体系和角色认知证据，不要围绕已有材料复述。',
          authorRequest,
        ].join('\n'),
        additionalReadsEnabled: false,
        signal: input.signal,
      })
    : undefined
  if (!contextGatewayExecution) {
    throw new Error('角色创建正式入口缺少 required Context Gateway。')
  }
  const assembled = assembleContextGatewayPacketV1(
    contextGatewayExecution,
    contextPolicy.maxInputTokens,
  )
  const afterRead = await readCharacterRosterSnapshot(input.projectId, worldGroupId, scope)
  if (beforeRead.serialized !== afterRead.serialized) throw new CharacterCopilotStaleError()

  const inputState = projectContextGatewayInputStateV1(skill, contextGatewayExecution, assembled)
  const contextEvidence = attachAgentContextInputStateV1(
    evidenceFromContextResult(contextProfile, assembled),
    inputState,
  )
  contextEvidence.inputStateSourceKeys = contextGatewayInputStateSourceKeysV1(skill, contextGatewayExecution)
  const inputGuidance = buildAgentSkillInputGuidanceV1(skill, inputState)
  const nodeInput: CharacterCopilotInput = {
    projectId: input.projectId,
    scope,
    projectName: project.name,
    genres: project.genres?.join('/') || project.genre || '',
    worldGroupId,
    authorRequest,
    inputGuidance,
    assembled,
    worldContext: [
      assembled.text,
      input.supplementalContext?.trim()
        ? `【本轮上游候选（尚未采纳，不属于 Canon）】\n${input.supplementalContext.trim()}`
        : '',
    ].filter(Boolean).join('\n\n'),
    characterContext: '',
    contextSources: assembled.included,
    snapshot: afterRead,
    config,
    generationOverrides: input.generationOverrides,
    routingCategory,
    signal: input.signal,
  }
  if (input.promptExecution) {
    const rendered = await renderFrozenPromptExecutionV1({
      options: input.promptExecution,
      context: {
        projectName: project.name,
        genres: nodeInput.genres,
        worldContext: nodeInput.worldContext || '（暂无）',
        existingCharacters: nodeInput.characterContext || '（暂无）',
        characters: nodeInput.characterContext || '（暂无）',
        userHint: '',
      },
      hardSystem: characterHardSystem(nodeInput),
      authorInstruction: authorRequest,
      additionalUserMessages: [
        `【Harness 登记的世界与故事上下文】\n${nodeInput.worldContext || '（暂无）'}`,
        `【Harness 登记的已有角色】\n${nodeInput.characterContext || '（暂无）'}`,
      ],
    })
    const generationOverrides = {
      maxTokens: 6_000,
      temperature: nodeInput.config.temperature,
      ...rendered.generationOverrides,
      ...input.generationOverrides,
    }
    if ((generationOverrides.maxTokens ?? 0) > skill.maxOutputTokens) {
      throw new Error(`Prompt 请求输出 ${generationOverrides.maxTokens} tokens，超过 Skill 上限 ${skill.maxOutputTokens}；已在模型调用前阻止。`)
    }
    nodeInput.frozenPromptMessages = rendered.messages
    nodeInput.promptExecutionEvidence = {
      ...rendered.evidence,
      effectiveTemperature: generationOverrides.temperature ?? null,
      effectiveMaxTokens: generationOverrides.maxTokens ?? null,
    }
    nodeInput.generationOverrides = generationOverrides
  }
  const node = createCharacterCopilotNode(nodeInput)
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    input: nodeInput,
    contextSources: nodeInput.contextSources,
    snapshot: afterRead,
    contextEvidence,
    modelIdentity: { provider: config.provider, model: config.model },
    promptExecutionEvidence: nodeInput.promptExecutionEvidence,
    contextGatewayExecution,
  }
}

/**
 * Phase 27.1-d 角色领域节点：只生成一个新角色候选，作者确认后才写角色主档。
 */
export function createCharacterCopilotNode(
  input: CharacterCopilotInput,
  dependencies: CharacterCopilotDependencies = {},
): GenerationNode<CharacterCopilotInput, CharacterCopilotCandidate, AdoptResult> {
  const readCurrent = dependencies.readCurrent
    ?? (() => readCharacterRosterSnapshot(input.projectId, input.worldGroupId, input.scope))
  const saveCharacter = dependencies.saveCharacter ?? (async candidate => {
    const workspaceScope = await resolveScope({ projectId: input.projectId, scope: input.scope })
    return db.transaction(
      'rw',
      scopeTransactionTables(db.characters, db.temporalFacts),
      async () => {
      // 将最终重复/过期检查与 adopt 写回锁进同一事务，避免多标签页在二者之间插入同名角色。
      const lockedCurrent = await readCharacterRosterSnapshot(input.projectId, input.worldGroupId, workspaceScope)
      if (lockedCurrent.serialized !== input.snapshot.serialized) {
        throw new CharacterCopilotStaleError()
      }
      if (lockedCurrent.visibleNames.includes(normalizeName(candidate.name))) {
        throw new CharacterCopilotDuplicateError(candidate.name)
      }
      return adopt({
        projectId: input.projectId,
        scope: workspaceScope,
        worldGroupId: input.worldGroupId,
        target: 'characters',
        mode: 'add',
        data: {
          ...candidate,
          isCrossWorld: false,
        },
      })
      },
    )
  })
  const runAI = dependencies.runAI ?? (messages => chat(messages, input.config, {
    category: input.routingCategory ?? 'character.generate',
    projectId: input.projectId,
    configOverrides: {
      maxTokens: input.generationOverrides?.maxTokens ?? 6000,
      ...(input.generationOverrides?.temperature != null
        ? { temperature: input.generationOverrides.temperature }
        : {}),
    },
    contextOverflowPolicy: 'reject',
  }, input.signal))

  return {
    id: `agent.chat-copilot.character:${input.projectId}:${input.worldGroupId ?? 'global'}:${input.snapshot.serialized.length}`,
    kind: 'character.generate',
    editableInput: true,
    assembleInput: buildCharacterCopilotPrompt,
    run: async messages => parseCharacterCandidateDraft(await runAI(messages)),
    gate: output => {
      const issues = candidateIssues(output, input.snapshot)
      return { status: issues.length ? 'blocked' : 'pass', issues }
    },
    adopt: async output => {
      const current = await readCurrent()
      if (current.serialized !== input.snapshot.serialized) {
        throw new CharacterCopilotStaleError()
      }
      const parsed = parseCharacterCandidateDraft(JSON.stringify(output))
      if (current.visibleNames.includes(normalizeName(parsed.name))) {
        throw new CharacterCopilotDuplicateError(parsed.name)
      }
      const result = await saveCharacter(parsed)
      if (
        result.written.length !== 1
        || result.unknown.length > 0
        || result.typeErrors.length > 0
        || result.fkErrors.length > 0
        || result.skipped.length > 0
      ) {
        throw new Error('角色候选未能经正式注册表新增一条完整主档。')
      }
      return result
    },
  }
}

/** 节点执行器与聊天副驾共用的正式角色采纳入口。 */
export async function adoptCharacterCopilotCandidate(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  snapshot: CharacterRosterSnapshot
  candidate: CharacterCopilotCandidate
}): Promise<AdoptResult> {
  const parsed = parseCharacterCandidateDraft(JSON.stringify(input.candidate))
  const workspaceScope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  return db.transaction(
    'rw',
    scopeTransactionTables(db.characters, db.temporalFacts),
    async () => {
      const current = await readCharacterRosterSnapshot(input.projectId, input.worldGroupId, workspaceScope)
      if (current.serialized !== input.snapshot.serialized) throw new CharacterCopilotStaleError()
      if (current.visibleNames.includes(normalizeName(parsed.name))) {
        throw new CharacterCopilotDuplicateError(parsed.name)
      }
      return adopt({
        projectId: input.projectId,
        scope: workspaceScope,
        worldGroupId: input.worldGroupId,
        target: 'characters',
        mode: 'add',
        data: {
          ...parsed,
          isCrossWorld: false,
        },
      })
    },
  )
}

/**
 * 分步骤角色面板与主 Agent 共用的任务合同入口。
 * Prompt 参数仍可见、可审计，但不再由组件直接拼接上下文或决定写回路径。
 */
export function formatCharacterGenerationRequestV1(input: {
  hint?: string
  parameterValues?: Record<string, unknown>
  systemOverride?: string | null
  userOverride?: string | null
}): string {
  const parts = [
    '生成一名新角色。只创建角色候选，不修改世界观、故事核心、故事线、大纲、物品或已有角色。',
  ]
  const hint = (input.hint ?? '').trim()
  if (hint) parts.push(`作者要求与本轮维度：${hint}`)
  const request = parts.join('\n')
  if (request.length > 8_000) {
    throw new Error('角色作者要求超过 8000 字符；没有截断，已在模型调用前阻止。')
  }
  return request
}
