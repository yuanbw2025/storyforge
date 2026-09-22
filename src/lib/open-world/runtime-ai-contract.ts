import {
  createAgentSkillExecutionBindingV2,
} from '../agent/execution-binding'
import {
  freezeFormalAIEntryBindingV1,
  getFormalAIEntryBindingV1,
} from '../agent/formal-ai-entry'
import {
  getAgentSkillV1,
  type AgentSkillId,
} from '../agent/skill-registry'
import type {
  AgentRunContractV3,
  AgentRunScopeV1,
} from '../types/agent-run'

export const TEXT_OPEN_WORLD_RUNTIME_AI_CONTRACT_VERSION_V1 = 1 as const
export const TEXT_OPEN_WORLD_RUNTIME_AI_RUN_CONTRACT_BUILDER_ID_V1 = 'text-open-world-runtime-ai-contract-v1' as const
export const TEXT_OPEN_WORLD_RUNTIME_AI_VERIFIER_SET_V1 = 'text-open-world-runtime-ai-terminal-v1' as const

export const TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_IDS_V1 = [
  'prose.text-open-world-runtime-intent',
  'prose.text-open-world-runtime-dialogue',
  'prose.text-open-world-runtime-expression',
  'prose.text-open-world-runtime-quest-packaging',
  'prose.text-open-world-runtime-direction',
  'prose.text-open-world-runtime-memory',
] as const satisfies readonly AgentSkillId[]

export type TextOpenWorldRuntimeAISkillIdV1 = typeof TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_IDS_V1[number]

export type TextOpenWorldRuntimeAIFieldTypeV1 =
  | 'string'
  | 'string|null'
  | 'number'
  | 'boolean'
  | 'stable-key[]'
  | 'event-sequence[]'
  | 'json-scalar-record'
  | 'reference[]'

export interface TextOpenWorldRuntimeAICandidateFieldV1 {
  name: string
  type: TextOpenWorldRuntimeAIFieldTypeV1
  required: boolean
  constValue?: string
  enumValues?: readonly string[]
  minimum?: number
  maximum?: number
  maxLength?: number
  maxItems?: number
}

export interface TextOpenWorldRuntimeAICandidateSchemaV1 {
  schemaId: string
  version: 1
  transport: 'strict-json'
  additionalProperties: false
  fields: readonly TextOpenWorldRuntimeAICandidateFieldV1[]
}

export interface TextOpenWorldRuntimeAISkillContractV1 {
  version: 1
  productType: 'text-open-world'
  phase: 'runtime'
  availability: 'registered-not-yet-ui-routed' | 'player-ui-routed'
  capability:
    | 'intent'
    | 'dialogue'
    | 'expression'
    | 'quest-packaging'
    | 'direction'
    | 'memory'
  skillId: TextOpenWorldRuntimeAISkillIdV1
  formalEntryId: string
  promptVersion: string
  purpose: string
  reads: {
    contextSourceKeys: readonly ['openWorldRuntime']
    logicalSlices: readonly string[]
    forbiddenSlices: readonly string[]
    owner: 'product-runtime-session'
    contextManifestRequired: true
    freshnessBoundary: 'release-session-sequence-state-visibility'
  }
  writes: {
    formalStateWriteTargets: readonly []
    candidatePersistence: readonly ['agentRunEvents', 'agentRunCheckpoints']
    actionAuthority: 'deterministic-services-only'
    adoptAllowed: false
  }
  model: {
    selectionPolicy: 'global-runtime-task-routing'
    credentialPolicy: 'configured-byok-never-persist-in-run'
    providerAgnostic: true
    requiredCapabilities: readonly ['chat', 'strict-json']
    routeCategory: string
    minimumContextWindow: number
    temperatureMinimum: number
    temperatureMaximum: number
    freezeResolutionPerRun: true
  }
  candidateSchema: TextOpenWorldRuntimeAICandidateSchemaV1
  budget: {
    maxModelCalls: 1
    maxToolCalls: 0
    maxAttemptsPerStep: 1
    maxInputTokens: number
    maxOutputTokens: number
    maxDurationMs: number
    maxEstimatedCostUsd: number
  }
  failurePolicy: {
    providerUnavailable: 'deterministic-fallback'
    timeout: 'deterministic-fallback'
    budgetExceeded: 'skip-ai'
    protocolError: 'deterministic-fallback'
    staleInput: 'discard-candidate'
    unknownResult: 'do-not-resend-query-by-run'
    hiddenRetryAllowed: false
  }
}

const SHARED_FORBIDDEN_SLICES = [
  'source-original-text',
  'unrevealed-story-or-quest-content',
  'world-truth-not-known-by-player',
  'other-actor-private-knowledge',
  'provider-credential-or-endpoint-secret',
  'deterministic-random-seed-before-resolution',
] as const

function field(
  name: string,
  type: TextOpenWorldRuntimeAIFieldTypeV1,
  required = true,
  limits: Omit<TextOpenWorldRuntimeAICandidateFieldV1, 'name' | 'type' | 'required'> = {},
): TextOpenWorldRuntimeAICandidateFieldV1 {
  return { name, type, required, ...limits }
}

function schema(
  schemaId: string,
  fields: readonly TextOpenWorldRuntimeAICandidateFieldV1[],
): TextOpenWorldRuntimeAICandidateSchemaV1 {
  return { schemaId, version: 1, transport: 'strict-json', additionalProperties: false, fields }
}

function contract(input: Omit<TextOpenWorldRuntimeAISkillContractV1,
  'version' | 'productType' | 'phase' | 'availability' | 'reads' | 'writes' | 'model' | 'failurePolicy'
> & {
  availability?: TextOpenWorldRuntimeAISkillContractV1['availability']
  logicalSlices: readonly string[]
  routeCategory: string
  minimumContextWindow: number
  temperatureMaximum: number
}): TextOpenWorldRuntimeAISkillContractV1 {
  return {
    version: 1,
    productType: 'text-open-world',
    phase: 'runtime',
    availability: input.availability ?? 'registered-not-yet-ui-routed',
    capability: input.capability,
    skillId: input.skillId,
    formalEntryId: input.formalEntryId,
    promptVersion: input.promptVersion,
    purpose: input.purpose,
    reads: {
      contextSourceKeys: ['openWorldRuntime'],
      logicalSlices: input.logicalSlices,
      forbiddenSlices: SHARED_FORBIDDEN_SLICES,
      owner: 'product-runtime-session',
      contextManifestRequired: true,
      freshnessBoundary: 'release-session-sequence-state-visibility',
    },
    writes: {
      formalStateWriteTargets: [],
      candidatePersistence: ['agentRunEvents', 'agentRunCheckpoints'],
      actionAuthority: 'deterministic-services-only',
      adoptAllowed: false,
    },
    model: {
      selectionPolicy: 'global-runtime-task-routing',
      credentialPolicy: 'configured-byok-never-persist-in-run',
      providerAgnostic: true,
      requiredCapabilities: ['chat', 'strict-json'],
      routeCategory: input.routeCategory,
      minimumContextWindow: input.minimumContextWindow,
      temperatureMinimum: 0,
      temperatureMaximum: input.temperatureMaximum,
      freezeResolutionPerRun: true,
    },
    candidateSchema: input.candidateSchema,
    budget: input.budget,
    failurePolicy: {
      providerUnavailable: 'deterministic-fallback',
      timeout: 'deterministic-fallback',
      budgetExceeded: 'skip-ai',
      protocolError: 'deterministic-fallback',
      staleInput: 'discard-candidate',
      unknownResult: 'do-not-resend-query-by-run',
      hiddenRetryAllowed: false,
    },
  }
}

export const TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1 = [
  contract({
    capability: 'intent',
    skillId: 'prose.text-open-world-runtime-intent',
    formalEntryId: 'text-open-world.runtime.intent',
    promptVersion: 'text-open-world-runtime-intent-v2',
    availability: 'player-ui-routed',
    purpose: '把玩家自由文字分类并映射到当前已投影的Action或Choice候选，不创建任何新行动或结果。',
    logicalSlices: ['scene.current', 'actions.available', 'choices.available', 'player.known-facts', 'conversation.recent'],
    routeCategory: 'runtime.text-open-world.intent',
    minimumContextWindow: 16_000,
    temperatureMaximum: 0.3,
    candidateSchema: schema('storyforge.text-open-world.runtime-intent-candidate', [
      field('kind', 'string', true, { enumValues: ['dialogue-only', 'mapped-action', 'mapped-choice', 'unsupported'] }),
      field('confidence', 'number', true, { minimum: 0, maximum: 1 }),
      field('actionKeys', 'stable-key[]', true, { maxItems: 4 }),
      field('choiceKeys', 'stable-key[]', true, { maxItems: 4 }),
      field('extractedArguments', 'json-scalar-record', true),
      field('rationale', 'string', true, { maxLength: 1_000 }),
      field('requiresConfirmation', 'boolean'),
      field('boundaryExplanation', 'string|null', true, { maxLength: 1_000 }),
      field('replyText', 'string', true, { maxLength: 2_000 }),
    ]),
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxAttemptsPerStep: 1, maxInputTokens: 12_000, maxOutputTokens: 800, maxDurationMs: 30_000, maxEstimatedCostUsd: 0.08 },
  }),
  contract({
    capability: 'dialogue',
    skillId: 'prose.text-open-world-runtime-dialogue',
    formalEntryId: 'text-open-world.runtime.dialogue',
    promptVersion: 'text-open-world-runtime-dialogue-v3',
    availability: 'player-ui-routed',
    purpose: '基于当前在场NPC、三档态度和该角色实际知识生成只读对白候选。',
    logicalSlices: ['scene.current', 'actor.present-public-dossier', 'actor.knowledge', 'relationship.attitude', 'memory.actor-long-term', 'conversation.recent', 'actions.available', 'choices.available'],
    routeCategory: 'runtime.text-open-world.dialogue',
    minimumContextWindow: 24_000,
    temperatureMaximum: 0.7,
    candidateSchema: schema('storyforge.text-open-world.runtime-dialogue-candidate', [
      field('kind', 'string', true, { constValue: 'npc-dialogue' }),
      field('actorKey', 'string', true, { maxLength: 160 }),
      field('replyText', 'string', true, { maxLength: 4_000 }),
      field('tone', 'string', true, { enumValues: ['bad', 'neutral', 'good'] }),
      field('citedKnowledgeKeys', 'stable-key[]', true, { maxItems: 32 }),
      field('recommendedActionKeys', 'stable-key[]', true, { maxItems: 16 }),
      field('recommendedChoiceKeys', 'stable-key[]', true, { maxItems: 16 }),
      field('boundaryExplanation', 'string|null', true, { maxLength: 1_000 }),
    ]),
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxAttemptsPerStep: 1, maxInputTokens: 16_000, maxOutputTokens: 1_600, maxDurationMs: 40_000, maxEstimatedCostUsd: 0.16 },
  }),
  contract({
    capability: 'expression',
    skillId: 'prose.text-open-world-runtime-expression',
    formalEntryId: 'text-open-world.runtime.expression',
    promptVersion: 'text-open-world-runtime-expression-v2',
    availability: 'player-ui-routed',
    purpose: '只依据已提交Receipt和终态Event演绎场景、战斗、任务或系统结果。',
    logicalSlices: ['scene.current', 'events.terminal-receipts', 'player.visible-state', 'quests.related-visible', 'actors.present-public', 'time-weather.current'],
    routeCategory: 'runtime.text-open-world.expression',
    minimumContextWindow: 24_000,
    temperatureMaximum: 0.7,
    candidateSchema: schema('storyforge.text-open-world.runtime-expression-candidate', [
      field('kind', 'string', true, { enumValues: ['scene', 'combat', 'quest', 'system'] }),
      field('text', 'string', true, { maxLength: 6_000 }),
      field('dialogue', 'string', true, { maxLength: 4_000 }),
      field('evidenceEventSequences', 'event-sequence[]', true, { maxItems: 64 }),
      field('assertedReferences', 'reference[]', true, { maxItems: 64 }),
    ]),
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxAttemptsPerStep: 1, maxInputTokens: 16_000, maxOutputTokens: 2_000, maxDurationMs: 40_000, maxEstimatedCostUsd: 0.2 },
  }),
  contract({
    capability: 'quest-packaging',
    skillId: 'prose.text-open-world-runtime-quest-packaging',
    formalEntryId: 'text-open-world.runtime.quest-packaging',
    promptVersion: 'text-open-world-runtime-quest-packaging-v2',
    availability: 'player-ui-routed',
    purpose: '为代码已经选定的地区任务模板槽生成差异化文字包装，不创建任务定义、奖励或Effect。',
    logicalSlices: ['director.selected-template-slot', 'region.current-visible', 'player.growth-summary', 'quests.active-summary', 'quest-packaging.recent-fingerprints'],
    routeCategory: 'runtime.text-open-world.quest-packaging',
    minimumContextWindow: 24_000,
    temperatureMaximum: 0.8,
    candidateSchema: schema('storyforge.text-open-world.runtime-quest-packaging-candidate', [
      field('kind', 'string', true, { constValue: 'region-quest-packaging' }),
      field('templateKey', 'string', true, { maxLength: 160 }),
      field('regionKey', 'string', true, { maxLength: 160 }),
      field('title', 'string', true, { maxLength: 160 }),
      field('summary', 'string', true, { maxLength: 1_200 }),
      field('introText', 'string', true, { maxLength: 3_000 }),
      field('objectiveText', 'string', true, { maxLength: 1_000 }),
      field('resolutionText', 'string', true, { maxLength: 3_000 }),
      field('variantFingerprint', 'string', true, { maxLength: 160 }),
      field('referencedKeys', 'stable-key[]', true, { maxItems: 48 }),
    ]),
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxAttemptsPerStep: 1, maxInputTokens: 16_000, maxOutputTokens: 2_000, maxDurationMs: 45_000, maxEstimatedCostUsd: 0.2 },
  }),
  contract({
    capability: 'direction',
    skillId: 'prose.text-open-world-runtime-direction',
    formalEntryId: 'text-open-world.runtime.direction',
    promptVersion: 'text-open-world-runtime-direction-v2',
    availability: 'player-ui-routed',
    purpose: '在代码提供的合法候选闭集中提出发牌与节奏建议；代码仍决定Blank、密度、冷却、冲突和主线保护。',
    logicalSlices: ['director.legal-candidates', 'director.pacing-summary', 'quests.active-summary', 'region.current-state', 'mainline.protection-window', 'director.cooldowns-conflicts'],
    routeCategory: 'runtime.text-open-world.direction',
    minimumContextWindow: 16_000,
    temperatureMaximum: 0.4,
    candidateSchema: schema('storyforge.text-open-world.runtime-direction-candidate', [
      field('kind', 'string', true, { enumValues: ['blank', 'recommend'] }),
      field('candidateKey', 'string|null', true, { maxLength: 160 }),
      field('rationale', 'string', true, { maxLength: 1_200 }),
      field('pacingTags', 'stable-key[]', true, { maxItems: 16 }),
      field('conflictKeys', 'stable-key[]', true, { maxItems: 32 }),
      field('mainlineSafe', 'boolean'),
    ]),
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxAttemptsPerStep: 1, maxInputTokens: 12_000, maxOutputTokens: 1_200, maxDurationMs: 30_000, maxEstimatedCostUsd: 0.12 },
  }),
  contract({
    capability: 'memory',
    skillId: 'prose.text-open-world-runtime-memory',
    formalEntryId: 'text-open-world.runtime.memory',
    promptVersion: 'text-open-world-runtime-memory-v2',
    availability: 'player-ui-routed',
    purpose: '压缩已发生对话和终态事件的最小长期记忆候选，并保持World Truth、Player Knowledge与Actor Knowledge隔离。',
    logicalSlices: ['conversation.closed-window', 'events.terminal-receipts', 'player.known-facts', 'actor.scoped-knowledge', 'memory.player-long-term', 'memory.actor-long-term', 'story.open-visible-threads'],
    routeCategory: 'runtime.text-open-world.memory',
    minimumContextWindow: 24_000,
    temperatureMaximum: 0.3,
    candidateSchema: schema('storyforge.text-open-world.runtime-memory-candidate', [
      field('kind', 'string', true, { enumValues: ['dialogue-window', 'player-memory', 'actor-memory'] }),
      field('subjectKey', 'string|null', true, { maxLength: 160 }),
      field('summary', 'string', true, { maxLength: 4_000 }),
      field('coveredEventSequences', 'event-sequence[]', true, { maxItems: 128 }),
      field('playerKnowledgeKeys', 'stable-key[]', true, { maxItems: 64 }),
      field('actorKnowledgeKeys', 'stable-key[]', true, { maxItems: 64 }),
      field('openThreadKeys', 'stable-key[]', true, { maxItems: 32 }),
    ]),
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxAttemptsPerStep: 1, maxInputTokens: 16_000, maxOutputTokens: 1_600, maxDurationMs: 40_000, maxEstimatedCostUsd: 0.16 },
  }),
] as const satisfies readonly TextOpenWorldRuntimeAISkillContractV1[]

export const TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACT_BY_ID_V1: ReadonlyMap<
  TextOpenWorldRuntimeAISkillIdV1,
  TextOpenWorldRuntimeAISkillContractV1
> = new Map(TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1.map(item => [item.skillId, item]))

function fail(message: string): never {
  throw new Error(`[text-open-world-runtime-ai-contract] ${message}`)
}

export function validateTextOpenWorldRuntimeAISkillContractsV1(
  contracts: readonly TextOpenWorldRuntimeAISkillContractV1[],
): void {
  if (contracts.length !== TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_IDS_V1.length) fail('Skill合同数量不完整')
  const skillIds = new Set<string>()
  const capabilities = new Set<string>()
  const entryIds = new Set<string>()
  const schemaIds = new Set<string>()
  for (const item of contracts) {
    if (item.version !== 1 || item.productType !== 'text-open-world' || item.phase !== 'runtime') fail('产品阶段或版本无效')
    const expectedAvailability = 'player-ui-routed'
    if (item.availability !== expectedAvailability) fail(`${item.skillId} UI接入状态与已完成工作包不一致`)
    if (skillIds.has(item.skillId) || capabilities.has(item.capability) || entryIds.has(item.formalEntryId)) fail('Skill、能力或正式入口重复')
    skillIds.add(item.skillId); capabilities.add(item.capability); entryIds.add(item.formalEntryId)
    const skill = getAgentSkillV1(item.skillId)
    if (skill.promptVersion !== item.promptVersion || skill.maxOutputTokens !== item.budget.maxOutputTokens) fail(`${item.skillId} Prompt或输出预算未与Skill注册表同源`)
    if (skill.writeTargets.length !== 0 || item.writes.formalStateWriteTargets.length !== 0 || item.writes.adoptAllowed) fail(`${item.skillId} 不得获得正式状态写权限`)
    if (JSON.stringify(skill.contextSourceKeys) !== JSON.stringify(item.reads.contextSourceKeys)
      || skill.optionalContextSourceKeys.length !== 0 || skill.readToolNames.length !== 0) fail(`${item.skillId} 读取集合与Skill注册表不一致`)
    const gateway = skill.contextGateway
    if (!gateway || gateway.rollout !== 'required'
      || JSON.stringify(gateway.providerSourceKeys) !== JSON.stringify(item.reads.contextSourceKeys)
      || gateway.allowOriginalRead || gateway.allowedDepths.includes('original')) {
      fail(`${item.skillId} 未接入只读按需Context Gateway`)
    }
    if (!item.reads.logicalSlices.length || !item.reads.forbiddenSlices.length || !item.reads.contextManifestRequired) fail(`${item.skillId} 读取策略不完整`)
    if (!item.model.providerAgnostic || item.model.selectionPolicy !== 'global-runtime-task-routing'
      || item.model.credentialPolicy !== 'configured-byok-never-persist-in-run'
      || item.model.requiredCapabilities.join(',') !== 'chat,strict-json'
      || !item.model.freezeResolutionPerRun) fail(`${item.skillId} 模型选择或凭证边界无效`)
    if (item.model.minimumContextWindow < item.budget.maxInputTokens
      || item.model.temperatureMinimum < 0 || item.model.temperatureMaximum > 1
      || item.model.temperatureMinimum > item.model.temperatureMaximum) fail(`${item.skillId} 模型能力边界无效`)
    if (item.budget.maxModelCalls !== 1 || item.budget.maxToolCalls !== 0 || item.budget.maxAttemptsPerStep !== 1
      || !Number.isSafeInteger(item.budget.maxInputTokens) || item.budget.maxInputTokens < 1
      || !Number.isSafeInteger(item.budget.maxOutputTokens) || item.budget.maxOutputTokens < 1
      || !Number.isSafeInteger(item.budget.maxDurationMs) || item.budget.maxDurationMs < 1
      || !Number.isFinite(item.budget.maxEstimatedCostUsd) || item.budget.maxEstimatedCostUsd <= 0) fail(`${item.skillId} 预算无效`)
    if (item.failurePolicy.hiddenRetryAllowed || item.failurePolicy.unknownResult !== 'do-not-resend-query-by-run'
      || item.failurePolicy.staleInput !== 'discard-candidate') fail(`${item.skillId} 失败策略允许隐藏重发或过期采用`)
    const candidateSchema = item.candidateSchema
    if (candidateSchema.version !== 1 || candidateSchema.transport !== 'strict-json' || candidateSchema.additionalProperties !== false
      || !candidateSchema.schemaId.trim() || schemaIds.has(candidateSchema.schemaId) || !candidateSchema.fields.length) fail(`${item.skillId} 输出Schema无效`)
    schemaIds.add(candidateSchema.schemaId)
    const fieldNames = candidateSchema.fields.map(candidateField => candidateField.name)
    if (new Set(fieldNames).size !== fieldNames.length || !candidateSchema.fields.some(candidateField => candidateField.name === 'kind' && candidateField.required)) fail(`${item.skillId} 输出Schema字段闭集无效`)
    for (const candidateField of candidateSchema.fields) {
      if (!candidateField.name.trim()) fail(`${item.skillId} 输出Schema存在空字段`)
      if (candidateField.constValue && candidateField.enumValues) fail(`${item.skillId}.${candidateField.name} 不能同时声明const与enum`)
      if (candidateField.enumValues && (!candidateField.enumValues.length || new Set(candidateField.enumValues).size !== candidateField.enumValues.length)) fail(`${item.skillId}.${candidateField.name} 枚举无效`)
    }
    const entry = getFormalAIEntryBindingV1(item.formalEntryId)
    if (entry.skillId !== item.skillId || entry.executionBoundary !== 'product-runtime' || entry.entryKind !== 'formal'
      || entry.runContractBuilderId !== TEXT_OPEN_WORLD_RUNTIME_AI_RUN_CONTRACT_BUILDER_ID_V1
      || entry.adoptAllowed || entry.adoptionTargets.length !== 0
      || entry.categories.length !== 1 || entry.categories[0] !== item.model.routeCategory
      || entry.candidateKind !== candidateSchema.schemaId) fail(`${item.skillId} 正式AI入口与运行合同不一致`)
  }
  for (const skillId of TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_IDS_V1) if (!skillIds.has(skillId)) fail(`缺少Skill合同 ${skillId}`)
}

validateTextOpenWorldRuntimeAISkillContractsV1(TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1)

export function getTextOpenWorldRuntimeAISkillContractV1(
  skillId: TextOpenWorldRuntimeAISkillIdV1,
): TextOpenWorldRuntimeAISkillContractV1 {
  return TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACT_BY_ID_V1.get(skillId) ?? fail(`未登记Skill ${skillId}`)
}

function assertRuntimeScope(scope: AgentRunScopeV1): void {
  const runtime = scope.runtime
  if (!Number.isSafeInteger(scope.projectId) || scope.projectId < 1 || !runtime
    || !Number.isSafeInteger(runtime.productRuntimeSessionId) || runtime.productRuntimeSessionId < 1
    || !Number.isSafeInteger(runtime.baseSequence) || runtime.baseSequence < 0
    || !/^[a-f0-9]{64}$/.test(runtime.stateHash)
    || !/^[a-f0-9]{64}$/.test(runtime.visibilityHash)
    || !/^[a-f0-9]{64}$/.test(runtime.releaseHash)) fail('Run scope缺少精确Release/Session/Sequence/State/Visibility边界')
}

export async function createTextOpenWorldRuntimeAIRunContractV1(input: {
  skillId: TextOpenWorldRuntimeAISkillIdV1
  objective: string
  scope: AgentRunScopeV1
  runtimeBindingHash: string
}): Promise<AgentRunContractV3> {
  const objective = input.objective.trim()
  if (!objective || objective.length > 4_000) fail('objective无效')
  assertRuntimeScope(input.scope)
  if (!/^[a-f0-9]{64}$/.test(input.runtimeBindingHash)) fail('runtimeBindingHash无效')
  const registered = getTextOpenWorldRuntimeAISkillContractV1(input.skillId)
  const skill = getAgentSkillV1(registered.skillId)
  const [skillBinding, formalEntry] = await Promise.all([
    createAgentSkillExecutionBindingV2(skill),
    freezeFormalAIEntryBindingV1(registered.formalEntryId),
  ])
  return {
    version: 3,
    executionBoundary: 'product-runtime',
    objective,
    workflowKind: 'direct-generation',
    scope: structuredClone(input.scope),
    permissions: { contextSourceKeys: [...registered.reads.contextSourceKeys], writeTargets: [] },
    runtimeBindingHash: input.runtimeBindingHash,
    executionBindings: [{
      stepId: `text-open-world-runtime-ai:${registered.capability}`,
      ...skillBinding,
      formalEntry,
    }],
    budget: {
      maxModelCalls: registered.budget.maxModelCalls,
      maxToolCalls: registered.budget.maxToolCalls,
      maxInputTokens: registered.budget.maxInputTokens,
      maxOutputTokens: registered.budget.maxOutputTokens,
      maxAttemptsPerStep: registered.budget.maxAttemptsPerStep,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'runtime.schema', kind: 'output-present', required: true },
      { id: 'runtime.scope-fresh', kind: 'deterministic-check', required: true },
      { id: 'runtime.read-only', kind: 'post-state-matches', required: true },
      { id: 'runtime.fallback-declared', kind: 'deterministic-check', required: true },
    ],
    verificationPlan: [
      { id: 'runtime.protocol', kind: 'protocol', verifier: registered.candidateSchema.schemaId, criterionIds: ['runtime.schema'] },
      { id: 'runtime.freshness', kind: 'freshness', verifier: 'text-open-world-runtime-ai-freshness-v1', criterionIds: ['runtime.scope-fresh'] },
      { id: 'runtime.terminal', kind: 'terminal', verifier: TEXT_OPEN_WORLD_RUNTIME_AI_VERIFIER_SET_V1, criterionIds: ['runtime.schema', 'runtime.scope-fresh', 'runtime.read-only', 'runtime.fallback-declared'] },
    ],
    failurePolicy: {
      onProtocolError: 'fail',
      onVerificationFailure: 'fail',
      onStaleInput: 'pause-for-author',
    },
  }
}
