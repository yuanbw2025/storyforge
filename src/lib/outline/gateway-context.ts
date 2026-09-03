import { db } from '../db/schema'
import { executeContextGatewayV1, type ContextGatewayExecutionV1 } from '../context-gateway/execution'
import { assembleContextGatewayPacketV1 } from '../agent/context-gateway-input'
import { resolveAgentContextPolicy, type AgentContextProfile } from '../agent/context-policy'
import { resolveAgentSkillV1, type AgentSkillId } from '../agent/skill-registry'
import { STORY_INTENT_FIELDS_V1 } from '../storyline/intent-projection'
import { assembleContext } from '../registry/assemble-context'
import type { AssembleContextResult } from '../registry/types'
import type { AIConfig, OutlineNode, WorkspaceScope } from '../types'
import { parseStages } from '../types/story-arc'
import { readOwnedRows, resolveScope } from '../workspace/scope'
import type { OutlineGenerationRequest } from './generation-request'
import { assertOutlineRequestTargetsUnwrittenFutureV1 } from './future-boundary'

type StableRow = {
  id?: number
  ragDocumentId?: string
  worldGroupId?: number | null
  updatedAt?: number
  [key: string]: unknown
}

export interface OutlineGatewayAssemblyV1 extends AssembleContextResult {
  contextGatewayExecution: ContextGatewayExecutionV1
}

function outlineSkillId(request: OutlineGenerationRequest): AgentSkillId {
  return request.kind === 'volumes' || request.kind === 'single-volume'
    ? 'outline.volumes'
    : 'outline.chapters'
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function inWorld(row: StableRow, worldGroupId: number | null): boolean {
  return (row.worldGroupId ?? null) === worldGroupId
}

function originalKeysForOutlineNode(row: OutlineNode & StableRow | null): string[] {
  if (!row?.ragDocumentId) return []
  return ['title', 'summary']
    .filter(field => typeof row[field] === 'string' && String(row[field]).trim())
    .map(field => `outline-node:${row.ragDocumentId}:field:${field}`)
}

function combineAssembly(
  gateway: AssembleContextResult,
  prior: AssembleContextResult | null,
  execution: ContextGatewayExecutionV1,
  inputBudget: number,
): OutlineGatewayAssemblyV1 {
  const totalInputTokens = gateway.totalInputTokens + (prior?.totalInputTokens ?? 0)
  if (totalInputTokens > inputBudget) {
    throw new Error(`大纲 Gateway 与显式续接候选合计 ${totalInputTokens} tokens，超过冻结输入预算 ${inputBudget}。`)
  }
  const text = [gateway.text, prior?.text ?? ''].filter(value => value.trim()).join('\n\n')
  return {
    text,
    segments: [...gateway.segments, ...(prior?.segments ?? [])],
    included: [...gateway.included, ...(prior?.included ?? [])],
    omitted: [...gateway.omitted, ...(prior?.omitted ?? [])],
    trimmed: [...gateway.trimmed, ...(prior?.trimmed ?? [])],
    sourceEvidence: [
      ...(gateway.sourceEvidence ?? []),
      ...(prior?.sourceEvidence ?? []),
    ],
    totalInputTokens,
    inputBudget,
    overBudgetBeforeTrim: gateway.overBudgetBeforeTrim || (prior?.overBudgetBeforeTrim ?? false),
    overBudgetAfterTrim: false,
    contextGatewayExecution: execution,
  }
}

export function outlineGatewayExecutionFromAssemblyV1(
  assembled: AssembleContextResult,
): ContextGatewayExecutionV1 | null {
  const execution = (assembled as Partial<OutlineGatewayAssemblyV1>).contextGatewayExecution
  return execution?.version === 'context-gateway-execution-v1' ? execution : null
}

/**
 * OUTLINE-1 shared authority for UI Harness and Master outline Agent.
 * Every deterministic key is derived from PROJECT_TABLE resource identities;
 * callers only provide the target request and optional explicit batch predecessor.
 */
export async function prepareOutlineGatewayAssemblyV1(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  request: OutlineGenerationRequest
  authorRequest: string
  config: AIConfig
  contextProfile?: AgentContextProfile
  priorOutlineCandidateText?: string
  signal?: AbortSignal
}): Promise<OutlineGatewayAssemblyV1> {
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  await assertOutlineRequestTargetsUnwrittenFutureV1({
    scope,
    worldGroupId: input.worldGroupId,
    request: input.request,
  })
  const skill = resolveAgentSkillV1('outline', outlineSkillId(input.request))
  if (skill.contextGateway?.rollout !== 'required') {
    throw new Error(`${skill.id} 尚未进入 required Context Gateway。`)
  }
  const policy = resolveAgentContextPolicy(skill.contextTaskKind, input.contextProfile ?? 'full')
  const inputBudget = Math.min(policy.maxInputTokens, skill.contextGateway.maxRetrievedTokens)
  const priorText = input.priorOutlineCandidateText?.trim() ?? ''
  const prior = priorText
    ? await assembleContext({
        projectId: input.projectId,
        scope,
        worldGroupId: input.worldGroupId,
        priorOutlineCandidateText: priorText,
        provider: input.config.provider,
        model: input.config.model,
        sourceKeys: ['priorOutlineCandidate'],
        inputBudgetTokens: inputBudget,
      })
    : null
  const gatewayBudget = Math.max(1, inputBudget - (prior?.totalInputTokens ?? 0))

  const [storyCores, arcs, outlines, chapters, modules, narrativeNodes, beats, choices, work] = await Promise.all([
    readOwnedRows<StableRow>(scope, 'storyCores', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'storyArcs', { owner: 'work' }),
    readOwnedRows<OutlineNode & StableRow>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'narrativeModules', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'narrativeNodes', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'narrativeBeats', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'narrativeChoices', { owner: 'work' }),
    db.works.get(scope.workId),
  ])
  const currentIntent = storyCores.filter(row => inWorld(row, input.worldGroupId)).sort((left, right) => (
    Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0)
  ))[0]
  const intentOriginalKeys = currentIntent?.ragDocumentId
    ? STORY_INTENT_FIELDS_V1
        .filter(field => typeof currentIntent[field] === 'string' && String(currentIntent[field]).trim())
        .map(field => `story-core-field:${currentIntent.ragDocumentId}:field:${field}`)
    : []

  const currentArcs = arcs.filter(row => inWorld(row, input.worldGroupId) && row.ragDocumentId)
  const arcRecordKeys = currentArcs.map(row => `story-arc:${row.ragDocumentId}`)
  const arcStagesOriginalKeys = currentArcs
    .filter(row => typeof row.stages === 'string' && row.stages.trim())
    .map(row => `story-arc:${row.ragDocumentId}:field:stages`)
  const stageKeys = currentArcs.flatMap(row => (
    typeof row.stages === 'string'
      ? parseStages(row.stages).map(stage => `story-arc:${row.ragDocumentId}:stage:${encodeURIComponent(stage.id)}`)
      : []
  ))

  const singleChapterId = input.request.kind === 'single-chapter'
    ? input.request.chapterId
    : null
  const targetParentId = input.request.kind === 'chapters' || input.request.kind === 'single-volume'
    ? input.request.volumeId
    : singleChapterId != null
      ? outlines.find(row => row.id === singleChapterId)?.parentId ?? null
      : null
  const targetParent = targetParentId == null
    ? null
    : outlines.find(row => row.id === targetParentId && inWorld(row, input.worldGroupId)) ?? null
  if (targetParentId != null && !targetParent?.ragDocumentId) {
    throw new Error('大纲目标父节点缺少稳定资源身份，不能开始正式生成。')
  }
  const parentRecordKeys = targetParent?.ragDocumentId
    ? [`outline-node:${targetParent.ragDocumentId}`]
    : []
  const parentOriginalKeys = originalKeysForOutlineNode(targetParent)
  const targetNodeId = input.request.kind === 'single-chapter'
    ? input.request.chapterId
    : input.request.kind === 'single-volume'
      ? input.request.volumeId
      : null
  const targetNode = targetNodeId == null
    ? null
    : outlines.find(row => row.id === targetNodeId && inWorld(row, input.worldGroupId)) ?? null
  if (targetNodeId != null && !targetNode?.ragDocumentId) {
    throw new Error('大纲定点生成目标缺少稳定资源身份，不能开始正式生成。')
  }
  const targetNodeRecordKeys = targetNode?.ragDocumentId
    ? [`outline-node:${targetNode.ragDocumentId}`]
    : []
  const targetNodeOriginalKeys = originalKeysForOutlineNode(targetNode)

  const outlineById = new Map(outlines.flatMap(row => row.id == null ? [] : [[row.id, row]]))
  const writtenBoundaryKeys = chapters.flatMap(chapter => {
    const outlineNode = typeof chapter.outlineNodeId === 'number'
      ? outlineById.get(chapter.outlineNodeId)
      : undefined
    return chapter.ragDocumentId
      && typeof chapter.content === 'string'
      && chapter.content.trim()
      && outlineNode
      && inWorld(outlineNode, input.worldGroupId)
      ? [`chapter:${chapter.ragDocumentId}:written-boundary`]
      : []
  })

  const activeModuleId = work?.activeNarrativeModuleId ?? null
  const activeModule = activeModuleId == null
    ? null
    : modules.find(row => row.id === activeModuleId) ?? null
  if (activeModuleId != null && !activeModule?.ragDocumentId) {
    throw new Error('当前激活叙事蓝图缺少稳定资源身份，不能开始正式生成。')
  }
  const blueprintKeys = activeModule?.ragDocumentId
    ? [
        `narrative-blueprint:${activeModule.ragDocumentId}`,
        ...narrativeNodes.filter(row => row.moduleId === activeModuleId && row.ragDocumentId)
          .map(row => `narrative-blueprint:${row.ragDocumentId}`),
        ...beats.filter(row => row.moduleId === activeModuleId && row.ragDocumentId)
          .map(row => `narrative-blueprint:${row.ragDocumentId}`),
        ...choices.filter(row => row.moduleId === activeModuleId && row.ragDocumentId)
          .map(row => `narrative-blueprint:${row.ragDocumentId}`),
      ]
    : []

  const mandatoryOriginalResourceKeys = unique([
    ...intentOriginalKeys,
    ...arcStagesOriginalKeys,
    ...parentOriginalKeys,
    ...targetNodeOriginalKeys,
  ])
  const mandatoryFullResourceKeys = unique([
    ...arcRecordKeys,
    ...stageKeys,
    ...parentRecordKeys,
    ...targetNodeRecordKeys,
    ...writtenBoundaryKeys,
    ...blueprintKeys,
  ])
  const mandatoryResourceKeys = unique([
    ...mandatoryOriginalResourceKeys,
    ...mandatoryFullResourceKeys,
  ])
  const targetResourceKeys = unique([
    ...parentRecordKeys,
    ...targetNodeRecordKeys,
    ...arcRecordKeys,
    ...intentOriginalKeys,
  ])
  const execution = await executeContextGatewayV1({
    skill,
    scope,
    worldGroupId: input.worldGroupId,
    query: [
      input.authorRequest,
      input.request.kind === 'volumes' || input.request.kind === 'single-volume'
        ? '规划未写未来卷纲，保持故事意图、主支线阶段、叙事蓝图和已写正文保护边界。'
        : '把目标卷拆分为未写未来章纲，保持主支线阶段、叙事蓝图和已写正文保护边界。',
    ].join('\n'),
    budgetTokens: gatewayBudget,
    ...(mandatoryResourceKeys.length ? {
      mandatoryResourceKeys,
      mandatoryFullResourceKeys,
      mandatoryOriginalResourceKeys,
      targetResourceKeys,
    } : {}),
    additionalReadsEnabled: false,
    signal: input.signal,
  })
  return combineAssembly(
    assembleContextGatewayPacketV1(execution, gatewayBudget),
    prior,
    execution,
    inputBudget,
  )
}
