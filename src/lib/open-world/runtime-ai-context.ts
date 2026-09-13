import { estimateTokens } from '../ai/context-budget'
import { hashCanonicalValue } from '../agent/run/hash'
import {
  createContextManifestFromAssemblyV1,
  createContextManifestV2FromV1,
} from '../agent/run/context-manifest'
import { getAgentSkillV1 } from '../agent/skill-registry'
import {
  executeContextGatewayV1,
  type ContextGatewayExecutionV1,
} from '../context-gateway/execution'
import type { AssembleContextResult } from '../registry/types'
import type {
  AgentRunScopeV1,
  ContextManifestV2,
  WorkspaceScope,
} from '../types'
import {
  getTextOpenWorldRuntimeAISkillContractV1,
  type TextOpenWorldRuntimeAISkillIdV1,
} from './runtime-ai-contract'
import {
  loadTextOpenWorldRuntimeContextCatalogV1,
  textOpenWorldRuntimeContextEntityAnchorV1,
  type TextOpenWorldRuntimeContextResourceV1,
} from './runtime-ai-context-provider'
import type { TextOpenWorldDirectorTriggerV1 } from '../types'

export interface TextOpenWorldRuntimeAIContextRequestV1 {
  scope: WorkspaceScope
  contractScope: AgentRunScopeV1
  skillId: TextOpenWorldRuntimeAISkillIdV1
  objective: string
  targetActorKey?: string
  targetQuestInstanceKey?: string
  terminalCommandIds?: readonly string[]
  selectedTemplateKey?: string
  directorTrigger?: TextOpenWorldDirectorTriggerV1
  signal?: AbortSignal
}

export interface TextOpenWorldRuntimeAIContextSelectionV1 {
  version: 1
  skillId: TextOpenWorldRuntimeAISkillIdV1
  productRuntimeSessionId: number
  sequence: number
  stateHash: string
  visibilityHash: string
  runtimeSourceHash: string
  requestedLogicalSlices: string[]
  sliceCoverage: Array<{ logicalSlice: string; resourceKeys: string[] }>
  mandatoryResourceKeys: string[]
  allowedResourceKeys: string[]
  omittedResourceKeys: Array<{ resourceKey: string; reasonCode: string }>
  selectionHash: string
}

export interface TextOpenWorldRuntimeAIContextPreparationV1 {
  execution: ContextGatewayExecutionV1
  selection: TextOpenWorldRuntimeAIContextSelectionV1
}

function fail(message: string): never {
  throw new Error(`[text-open-world-runtime-ai-context] ${message}`)
}

function normalizedToken(value: string | undefined, label: string): string | undefined {
  if (value == null) return undefined
  const result = value.trim().normalize('NFC')
  if (!result || result.length > 200 || /\s/.test(result)) fail(`${label}无效`)
  return result
}

function normalizedTokens(values: readonly string[] | undefined, label: string): string[] {
  const result = [...new Set((values ?? []).map(value => normalizedToken(value, label)!))].sort()
  if (result.length > 64) fail(`${label}超过64项显式证据上限`)
  return result
}

function targetSpecificResourceAllowed(input: {
  resource: TextOpenWorldRuntimeContextResourceV1
  targetActorKey?: string
  targetQuestInstanceKey?: string
  terminalCommandIds: ReadonlySet<string>
  selectedTemplateKey?: string
  directorTrigger?: string
}): boolean {
  const key = input.resource.descriptor.resourceKey
  if (key.includes(':terminal-receipt:')) {
    return input.resource.targetKeys.some(target => input.terminalCommandIds.has(target))
  }
  if (key.includes(':template:')) {
    return input.selectedTemplateKey != null
      && input.resource.targetKeys.includes(input.selectedTemplateKey)
  }
  if (key.includes(':director-candidates:')) {
    return input.directorTrigger != null
      && input.resource.targetKeys.includes(input.directorTrigger)
  }
  if (key.includes(':actor:') || key.includes(':attitude:') || key.includes(':actor-knowledge:')) {
    return input.targetActorKey != null
      && input.resource.targetKeys.includes(input.targetActorKey)
  }
  if (key.includes(':quest:') && input.targetQuestInstanceKey != null) {
    return input.resource.targetKeys.includes(input.targetQuestInstanceKey)
  }
  return true
}

function isLongTailResource(resource: TextOpenWorldRuntimeContextResourceV1): boolean {
  const key = resource.descriptor.resourceKey
  return key.includes(':known-fact:') || key.includes(':quest:')
}

function assertCapabilityInputs(input: {
  skillId: TextOpenWorldRuntimeAISkillIdV1
  targetActorKey?: string
  terminalCommandIds: readonly string[]
  selectedTemplateKey?: string
  directorTrigger?: string
}): void {
  if (input.skillId === 'prose.text-open-world-runtime-dialogue' && !input.targetActorKey) {
    fail('NPC对白必须指定当前在场targetActorKey')
  }
  if (input.skillId === 'prose.text-open-world-runtime-expression' && !input.terminalCommandIds.length) {
    fail('结果演绎必须指定至少一个已提交terminalCommandId')
  }
  if (input.skillId === 'prose.text-open-world-runtime-quest-packaging' && !input.selectedTemplateKey) {
    fail('地区任务包装必须指定代码已选selectedTemplateKey')
  }
  if (input.skillId === 'prose.text-open-world-runtime-direction' && !input.directorTrigger) {
    fail('导演建议必须指定代码当前评估的directorTrigger')
  }
  if (input.skillId === 'prose.text-open-world-runtime-memory'
    && (!input.targetActorKey || !input.terminalCommandIds.length)) {
    fail('G6-02最小记忆上下文必须指定角色作用域与已关闭终态命令窗口')
  }
}

function assertExactRuntimeBoundary(input: {
  contractScope: AgentRunScopeV1
  productRuntimeSessionId: number
  sequence: number
  stateHash: string
  visibilityHash: string
  runtimeSourceHash: string
}): void {
  const runtime = input.contractScope.runtime
  if (!runtime
    || runtime.productRuntimeSessionId !== input.productRuntimeSessionId
    || runtime.baseSequence !== input.sequence
    || runtime.stateHash !== input.stateHash
    || runtime.visibilityHash !== input.visibilityHash
    || runtime.releaseHash !== input.runtimeSourceHash) {
    fail('RunContract的Release/Session/Sequence/State/Visibility边界与当前资源目录不一致')
  }
}

/**
 * Selects the exact per-Skill runtime packet through the shared Context
 * Gateway. It never calls a planning model: catalog pagination is complete,
 * long-tail facts/quests are ranked semantically, and every omission is
 * retained by the selector/retrieval trace instead of a hidden `slice(0,n)`.
 */
export async function prepareTextOpenWorldRuntimeAIContextV1(
  input: TextOpenWorldRuntimeAIContextRequestV1,
): Promise<TextOpenWorldRuntimeAIContextPreparationV1> {
  const objective = input.objective.trim().normalize('NFC')
  if (!objective || objective.length > 4_000) fail('objective无效')
  const runtime = input.contractScope.runtime ?? fail('RunContract缺少runtime边界')
  if (input.contractScope.projectId !== input.scope.projectId) fail('RunContract与WorkspaceScope项目不一致')
  const targetActorKey = normalizedToken(input.targetActorKey, 'targetActorKey')
  const targetQuestInstanceKey = normalizedToken(input.targetQuestInstanceKey, 'targetQuestInstanceKey')
  const terminalCommandIds = normalizedTokens(input.terminalCommandIds, 'terminalCommandIds')
  const selectedTemplateKey = normalizedToken(input.selectedTemplateKey, 'selectedTemplateKey')
  const directorTrigger = normalizedToken(input.directorTrigger, 'directorTrigger')
  assertCapabilityInputs({
    skillId: input.skillId,
    targetActorKey,
    terminalCommandIds,
    selectedTemplateKey,
    directorTrigger,
  })
  const registered = getTextOpenWorldRuntimeAISkillContractV1(input.skillId)
  const skill = getAgentSkillV1(input.skillId)
  const resourceScope = {
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    worldGroupId: input.contractScope.worldGroupId,
    productRuntimeSessionId: runtime.productRuntimeSessionId,
  }
  const catalog = await loadTextOpenWorldRuntimeContextCatalogV1(resourceScope)
  assertExactRuntimeBoundary({
    contractScope: input.contractScope,
    productRuntimeSessionId: catalog.session.id,
    sequence: catalog.sequence,
    stateHash: catalog.stateHash,
    visibilityHash: catalog.visibilityHash,
    runtimeSourceHash: catalog.runtimeSourceHash,
  })
  const requestedSlices = [...new Set(['runtime.boundary', ...registered.reads.logicalSlices])].sort()
  const terminalSet = new Set(terminalCommandIds)
  const eligible = catalog.resources.filter(resource => (
    resource.logicalSlices.some(slice => requestedSlices.includes(slice))
    && targetSpecificResourceAllowed({
      resource,
      targetActorKey,
      targetQuestInstanceKey,
      terminalCommandIds: terminalSet,
      selectedTemplateKey,
      directorTrigger,
    })
  ))
  const allowedResourceKeys = eligible.map(item => item.descriptor.resourceKey).sort()
  const mandatory = eligible.filter(resource => {
    if (!isLongTailResource(resource)) return true
    if (targetQuestInstanceKey && resource.targetKeys.includes(targetQuestInstanceKey)) return true
    if (targetActorKey && resource.targetKeys.includes(targetActorKey)) return true
    return false
  })
  const mandatoryResourceKeys = mandatory.map(item => item.descriptor.resourceKey).sort()
  const sliceCoverage = requestedSlices.map(logicalSlice => ({
    logicalSlice,
    resourceKeys: eligible
      .filter(resource => resource.logicalSlices.includes(logicalSlice))
      .map(resource => resource.descriptor.resourceKey)
      .sort(),
  }))
  const missing = sliceCoverage.filter(item => item.resourceKeys.length === 0)
  if (missing.length) fail(`逻辑读取片缺少授权资源:${missing.map(item => item.logicalSlice).join('、')}`)
  if (!allowedResourceKeys.length || !mandatoryResourceKeys.length) fail('当前Skill没有可执行的资源选择计划')
  const entityKeys = [
    targetActorKey,
    targetQuestInstanceKey,
    selectedTemplateKey,
    directorTrigger,
    ...terminalCommandIds,
  ].filter((value): value is string => !!value).map(textOpenWorldRuntimeContextEntityAnchorV1)
  const execution = await executeContextGatewayV1({
    skill,
    scope: input.scope,
    worldGroupId: input.contractScope.worldGroupId,
    query: [objective, targetActorKey, targetQuestInstanceKey, selectedTemplateKey, directorTrigger, ...terminalCommandIds]
      .filter(Boolean).join('\n'),
    budgetTokens: registered.budget.maxInputTokens,
    mandatoryResourceKeys,
    mandatoryFullResourceKeys: mandatoryResourceKeys,
    targetResourceKeys: mandatoryResourceKeys,
    entityKeys,
    resourceScope,
    allowedResourceKeys,
    additionalReadsEnabled: false,
    signal: input.signal,
  })
  const selectedKeys = new Set(execution.selector.selected.map(item => item.resourceKey))
  const deliveredCoverage = sliceCoverage.map(item => ({
    logicalSlice: item.logicalSlice,
    resourceKeys: item.resourceKeys.filter(key => selectedKeys.has(key)),
  }))
  const undelivered = deliveredCoverage.filter(item => item.resourceKeys.length === 0)
  if (undelivered.length) fail(`Context Packet未交付逻辑读取片:${undelivered.map(item => item.logicalSlice).join('、')}`)
  const selectionBody = {
    version: 1 as const,
    skillId: input.skillId,
    productRuntimeSessionId: catalog.session.id,
    sequence: catalog.sequence,
    stateHash: catalog.stateHash,
    visibilityHash: catalog.visibilityHash,
    runtimeSourceHash: catalog.runtimeSourceHash,
    requestedLogicalSlices: requestedSlices,
    sliceCoverage: deliveredCoverage,
    mandatoryResourceKeys,
    allowedResourceKeys,
    omittedResourceKeys: execution.selector.omitted.map(item => ({
      resourceKey: item.resourceKey,
      reasonCode: item.reasonCode,
    })),
  }
  return {
    execution,
    selection: {
      ...selectionBody,
      selectionHash: await hashCanonicalValue(selectionBody),
    },
  }
}

/** Builds the V2 base which G6-03..08 finalize as the shared exact V3
 * ContextManifest around the actual model boundary. */
export async function createTextOpenWorldRuntimeAIContextBaseManifestV2(input: {
  preparation: TextOpenWorldRuntimeAIContextPreparationV1
  scope: WorkspaceScope
  runId: number
  stepId: string
  attempt: number
}): Promise<ContextManifestV2> {
  const packet = input.preparation.execution.contextPacket
  const assembled: AssembleContextResult = {
    text: packet.content,
    segments: [{
      label: '文字开放世界按需运行时上下文',
      layer: 'L0',
      content: packet.content,
      tokens: packet.tokenCount,
      trimmable: false,
    }],
    included: ['openWorldRuntime'],
    omitted: [],
    trimmed: [],
    sourceEvidence: [{
      key: 'openWorldRuntime',
      status: 'included',
      delivery: 'full',
      sourceHash: packet.contentHash,
      originalCharacters: packet.content.length,
      inputCharacters: packet.content.length,
      originalTokens: packet.tokenCount,
      inputTokens: packet.tokenCount,
    }],
    totalInputTokens: packet.tokenCount,
    inputBudget: Math.max(packet.tokenCount, input.preparation.execution.selector.budgetTokens),
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
  }
  if (estimateTokens(assembled.text) !== packet.tokenCount) fail('Context Packet token证据不一致')
  const manifestV1 = await createContextManifestFromAssemblyV1({
    runId: input.runId,
    stepId: input.stepId,
    attempt: input.attempt,
    projectId: input.scope.projectId,
    worldGroupId: input.preparation.selection.productRuntimeSessionId > 0
      ? input.preparation.execution.session.scope.worldGroupId ?? null
      : null,
    declaredSourceKeys: ['openWorldRuntime'],
    assembled,
    readerVersion: TEXT_OPEN_WORLD_RUNTIME_CONTEXT_READER_VERSION_V1,
  })
  return createContextManifestV2FromV1({ manifest: manifestV1, scope: input.scope })
}

export const TEXT_OPEN_WORLD_RUNTIME_CONTEXT_READER_VERSION_V1 = 'text-open-world-runtime-context-gateway-v1' as const
