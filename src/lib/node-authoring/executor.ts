import { estimateTokens } from '../ai/context-budget'
import { chat } from '../ai/client'
import { useAIConfigStore } from '../../stores/ai-config'
import {
  isCreativeReliabilityRuntimeEnabledV1,
  parseCreativeArtifactV1,
  resolveCreativeQualityPolicyV1,
} from '../agent/creative-reliability'
import { db } from '../db/schema'
import { adopt } from '../registry/adopt'
import type { NodeFlow, NodeRunRecord, WorkspaceScope } from '../types'
import { AUTHORING_NODE_BY_ID } from './catalog'
import {
  hashAuthoringText,
  readAuthoringCanonBinding,
  readAuthoringTargetFingerprint,
  resolveAuthoringBoundRecordId,
} from './bindings'
import { validateAuthoringGraph, topologicalAuthoringOrder } from './graph'
import { parseAuthoringGraph } from './graph-codec'
import type {
  AuthoringCandidate,
  AuthoringCandidateDomain,
  AuthoringInputEnvelope,
  AuthoringNodeGraph,
  AuthoringNodeInstance,
  AuthoringRunSignature,
} from './contracts'
import { safeAuthoringGraphJson } from './contracts'
import { adoptDomainCandidate, executeDomainNode } from './domain-execution'
import { authoringDomainActionBindingV1 } from './domain-action-registry'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, stampNewRecord } from '../world-engine/scope'

export interface AuthoringRunSnapshot {
  nodeId: string
  nodeTitle: string
  config: Record<string, unknown>
  inputs: AuthoringInputEnvelope[]
  totalTokens: number
  sourceKeys?: string[]
  sourceHash?: string
  sourceEvidence?: {
    included: string[]
    omitted: string[]
    trimmed: string[]
    missing: string[]
  }
}

export type AuthoringRunSnapshotMap = Record<string, AuthoringRunSnapshot>
export type AuthoringCandidateMap = Record<string, AuthoringCandidate>

export interface AuthoringRunUpdate {
  run: NodeRunRecord
  snapshots: AuthoringRunSnapshotMap
  candidates: AuthoringCandidateMap
}

export interface AuthoringExecutionPlan {
  version: 1
  graphHash: string
  targetNodeId: string | null
  orderedNodeIds: string[]
  completedNodeIds: string[]
  pendingNodeIds: string[]
  estimatedAiCalls: number
  estimatedMaxAiCalls: number
  estimatedMaxOutputTokens: number
  createdAt: number
}

function stringConfig(node: AuthoringNodeInstance, key: string, fallback = ''): string {
  const value = node.config[key]
  return typeof value === 'string' ? value : fallback
}

function numberConfig(node: AuthoringNodeInstance, key: string, fallback: number): number {
  const value = node.config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function arrayConfig(node: AuthoringNodeInstance, key: string): string[] {
  const value = node.config[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function incomingFor(
  graph: AuthoringNodeGraph,
  node: AuthoringNodeInstance,
  candidates: AuthoringCandidateMap,
): AuthoringInputEnvelope[] {
  const sourceById = new Map(graph.nodes.map(item => [item.id, item]))
  const targetPorts = new Map(node.inputs.map(port => [port.id, port]))
  return graph.edges
    .filter(edge => edge.targetNodeId === node.id)
    .map(edge => {
      const source = sourceById.get(edge.sourceNodeId)
      const targetPort = targetPorts.get(edge.targetPortId)
      const result = candidates[edge.sourceNodeId]
      const content = result?.output ?? ''
      return {
        sourceNodeId: edge.sourceNodeId,
        sourcePortId: edge.sourcePortId,
        targetPortId: edge.targetPortId,
        semantic: source?.outputs.find(port => port.id === edge.sourcePortId)?.semantic ?? 'any',
        cardinality: source?.outputs.find(port => port.id === edge.sourcePortId)?.cardinality ?? 'one',
        state: source?.outputs.find(port => port.id === edge.sourcePortId)?.state ?? 'any',
        content,
        sourceHash: hashAuthoringText(content),
        tokens: estimateTokens(content),
        ...(edge.mapping?.maxTokens ? { trimmed: [] } : {}),
        ...(targetPort?.maxTokens ? { tokens: Math.min(estimateTokens(content), targetPort.maxTokens) } : {}),
      } satisfies AuthoringInputEnvelope
    })
    .sort((left, right) => right.tokens - left.tokens)
}

function composeInputs(inputs: AuthoringInputEnvelope[]): string {
  return inputs
    .filter(input => input.content.trim())
    .map(input => `【${input.targetPortId}｜${input.semantic}】\n${input.content}`)
    .join('\n\n')
}

function inputSignature(inputs: AuthoringInputEnvelope[]): string {
  return hashAuthoringText(inputs.map(input => `${input.sourceNodeId}:${input.targetPortId}:${input.content}`).join('\n'))
}

function requestedAIConfig(node: AuthoringNodeInstance, inputs: AuthoringInputEnvelope[] = []) {
  const state = useAIConfigStore.getState()
  const presetId = inputControl(inputs, 'control.ai-profile')
    || stringConfig(node, 'aiPresetId')
    || stringConfig(node, 'presetId')
    || stringConfig(node, 'ai-profile')
  const preset = presetId ? state.presets.find(item => item.id === presetId) : undefined
  if (!preset) return state.config
  return {
    ...state.config,
    ...preset.config,
    apiKey: preset.config.apiKey || state.config.apiKey,
  }
}

function inputControl(inputs: AuthoringInputEnvelope[], semantic: string): string | undefined {
  return inputs.find(input => input.semantic === semantic)?.content.trim() || undefined
}

function controlNumber(inputs: AuthoringInputEnvelope[], semantic: string, fallback: number): number {
  const value = Number(inputControl(inputs, semantic))
  return Number.isFinite(value) ? value : fallback
}

function graphControlNumber(
  graph: AuthoringNodeGraph,
  node: AuthoringNodeInstance,
  semantic: string,
  fallback: number,
): number {
  const edge = graph.edges.find(item => item.targetNodeId === node.id && (
    graph.nodes.find(source => source.id === item.sourceNodeId)
      ?.outputs.find(port => port.id === item.sourcePortId)?.semantic === semantic
  ))
  const source = edge ? graph.nodes.find(item => item.id === edge.sourceNodeId) : undefined
  const value = Number(source?.config.value)
  return Number.isFinite(value) ? value : fallback
}

export function buildAuthoringExecutionPlan(input: {
  graph: AuthoringNodeGraph
  targetNodeId?: string | null
  runNodeIds?: ReadonlySet<string>
}): AuthoringExecutionPlan {
  const allOrdered = topologicalAuthoringOrder(input.graph, input.targetNodeId)
  const ordered = input.runNodeIds
    ? allOrdered.filter(node => input.runNodeIds?.has(node.id))
    : allOrdered
  let estimatedAiCalls = 0
  let estimatedMaxAiCalls = 0
  let estimatedMaxOutputTokens = 0
  const aiState = useAIConfigStore.getState()
  const defaultMaxTokens = aiState.config.maxTokens > 0 ? aiState.config.maxTokens : 16_000
  const reliabilityEnabled = isCreativeReliabilityRuntimeEnabledV1()
  const reliabilityPolicy = resolveCreativeQualityPolicyV1(aiState.creativeQualityMode)
  for (const node of ordered) {
    const template = AUTHORING_NODE_BY_ID.get(node.templateId)
    const usesAI = template?.capability === 'generate-field'
      || template?.capability === 'generate-collection'
      || node.templateId === 'processor.free-generation'
    if (!usesAI) continue
    const count = Math.min(8, Math.max(1, Math.round(graphControlNumber(
      input.graph,
      node,
      'control.count',
      numberConfig(node, 'candidateCount', 1),
    ))))
    const requestedMaxTokens = graphControlNumber(
      input.graph,
      node,
      'control.max-tokens',
      numberConfig(node, 'maxTokens', defaultMaxTokens),
    )
    const maxTokens = requestedMaxTokens > 0
      ? Math.max(100, Math.round(requestedMaxTokens))
      : 16_000
    const canRepairOnce = reliabilityEnabled
      && reliabilityPolicy.allowAutomaticRepair
      && (node.templateId === 'outline.volume'
        || node.templateId === 'outline.chapter'
        || node.templateId === 'chapter.prose')
    const maxCalls = canRepairOnce ? count * 2 : count
    estimatedAiCalls += count
    estimatedMaxAiCalls += maxCalls
    estimatedMaxOutputTokens += maxCalls * maxTokens
  }
  const orderedNodeIds = ordered.map(node => node.id)
  return {
    version: 1,
    graphHash: hashAuthoringText(JSON.stringify(input.graph)),
    targetNodeId: input.targetNodeId ?? null,
    orderedNodeIds,
    completedNodeIds: [],
    pendingNodeIds: [...orderedNodeIds],
    estimatedAiCalls,
    estimatedMaxAiCalls,
    estimatedMaxOutputTokens,
    createdAt: Date.now(),
  }
}

export function parseAuthoringExecutionPlan(value: string | null | undefined): AuthoringExecutionPlan | null {
  if (!value?.trim()) return null
  try {
    const parsed = JSON.parse(value) as Partial<AuthoringExecutionPlan>
    if (
      parsed.version !== 1
      || typeof parsed.graphHash !== 'string'
      || !Array.isArray(parsed.orderedNodeIds)
      || !Array.isArray(parsed.completedNodeIds)
      || !Array.isArray(parsed.pendingNodeIds)
    ) return null
    const estimatedAiCalls = Number.isInteger(parsed.estimatedAiCalls) && (parsed.estimatedAiCalls ?? -1) >= 0
      ? parsed.estimatedAiCalls!
      : 0
    const estimatedMaxAiCalls = Number.isInteger(parsed.estimatedMaxAiCalls)
      && (parsed.estimatedMaxAiCalls ?? -1) >= estimatedAiCalls
      ? parsed.estimatedMaxAiCalls!
      : estimatedAiCalls
    return {
      ...(parsed as AuthoringExecutionPlan),
      estimatedAiCalls,
      estimatedMaxAiCalls,
    }
  } catch {
    return null
  }
}

function parseRunMaps(run: NodeRunRecord): {
  snapshots: AuthoringRunSnapshotMap
  candidates: AuthoringCandidateMap
} {
  try {
    const snapshots = JSON.parse(run.inputSnapshotsJson || '{}') as AuthoringRunSnapshotMap
    const candidates = JSON.parse(run.nodeResultsJson || '{}') as AuthoringCandidateMap
    for (const [nodeId, candidate] of Object.entries(candidates)) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new Error(`节点 ${nodeId} 的候选记录无效。`)
      }
      if (candidate.creativeArtifacts !== undefined) {
        if (!Array.isArray(candidate.creativeArtifacts) || candidate.creativeArtifacts.length > 8) {
          throw new Error(`节点 ${nodeId} 的创作产物证据无效。`)
        }
        candidate.creativeArtifacts = candidate.creativeArtifacts.map(item => parseCreativeArtifactV1(item))
      }
    }
    return { snapshots, candidates }
  } catch {
    throw new Error('节点运行记录损坏，不能作为恢复或重跑基线。')
  }
}

async function executeNode(input: {
  node: AuthoringNodeInstance
  inputs: AuthoringInputEnvelope[]
  projectId: number
  scope: WorkspaceScope
  worldGroupId: number | null
  signal?: AbortSignal
}): Promise<{
  output: string
  variants?: string[]
  sourceKeys?: string[]
  sourceHash?: string
  sourceEvidence?: AuthoringRunSnapshot['sourceEvidence']
  semantic: AuthoringCandidate['semantic']
  domain?: AuthoringCandidateDomain
  creativeArtifacts?: AuthoringCandidate['creativeArtifacts']
}> {
  const template = AUTHORING_NODE_BY_ID.get(input.node.templateId)
  if (!template) throw new Error(`节点模板不存在：${input.node.templateId}`)
  const { node, inputs } = input
  if (node.binding?.mode === 'live' && node.binding.ref) {
    const binding = await readAuthoringCanonBinding({
      node,
      projectId: input.projectId,
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      contextBudget: numberConfig(node, 'contextBudget', 12_000),
    })
    if (binding.missing.length) throw new Error(`绑定来源已不存在：${binding.missing.join('、')}`)
    return {
      output: binding.content,
      sourceKeys: binding.sourceKeys,
      sourceHash: binding.sourceHash,
      sourceEvidence: binding,
      semantic: node.outputs[0]?.semantic ?? template.outputs[0]?.semantic ?? 'any',
    }
  }
  if (node.templateId === 'input.manual-text') {
    return { output: stringConfig(node, 'text'), semantic: 'text' }
  }
  if (template.capability === 'read-canon') {
    const configuredSourceKeys = arrayConfig(node, 'sourceKeys')
    const sourceKeys = configuredSourceKeys.length
      ? arrayConfig(node, 'sourceKeys')
      : template.reads?.sourceKeys ?? []
    if (!sourceKeys.length) throw new Error('项目资料节点尚未选择资料来源。')
    if (sourceKeys.includes('ragSelection') && !arrayConfig(node, 'ragEntryKeys').length) {
      throw new Error('项目资料节点选择了精确资料，但尚未绑定任何资料字段。')
    }
    const binding = await readAuthoringCanonBinding({
      node,
      projectId: input.projectId,
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      contextBudget: numberConfig(node, 'contextBudget', 12_000),
    })
    return {
      output: binding.content,
      sourceKeys,
      sourceHash: binding.sourceHash,
      sourceEvidence: binding,
      semantic: 'world.setting',
    }
  }
  if (template.capability === 'transform') {
    if (node.templateId === 'processor.compose') {
      const templateText = stringConfig(node, 'template')
      return {
        output: templateText.trim()
          ? inputs.reduce((text, item) => text.split(`{{${item.targetPortId}}}`).join(item.content), templateText)
          : composeInputs(inputs),
        semantic: 'text',
      }
    }
    const instruction = stringConfig(node, 'instruction').trim()
    if (!instruction) throw new Error('自由创作节点缺少创作指令。')
    const aiConfig = requestedAIConfig(node, inputs)
    const promptTemplate = inputControl(inputs, 'control.prompt')
    const generationCount = Math.min(8, Math.max(1, Math.round(controlNumber(inputs, 'control.count', numberConfig(node, 'candidateCount', 1)))))
    const variants: string[] = []
    for (let index = 0; index < generationCount; index += 1) {
      const result = await chat([
        { role: 'system', content: stringConfig(node, 'systemPrompt', '你是 StoryForge 的创作节点，只能使用作者提供的材料。') },
        { role: 'user', content: `${promptTemplate ? `【Prompt 模板补充】\n${promptTemplate}\n\n` : ''}【作者指令】\n${instruction}\n\n【节点输入】\n${composeInputs(inputs) || '（无上游输入）'}${generationCount > 1 ? `\n\n【候选序号】\n${index + 1}/${generationCount}` : ''}` },
      ], aiConfig, {
      category: 'node.creation',
      projectId: input.projectId,
      configOverrides: {
        temperature: controlNumber(inputs, 'control.temperature', numberConfig(node, 'temperature', aiConfig.temperature)),
        maxTokens: controlNumber(inputs, 'control.max-tokens', numberConfig(node, 'maxTokens', aiConfig.maxTokens)),
      },
      contextOverflowPolicy: 'reject',
      }, input.signal)
      variants.push(result.trim())
    }
    return { output: variants.join('\n\n--- 候选分隔 ---\n\n'), variants, semantic: 'candidate' }
  }
  if (template.capability === 'generate-field' || template.capability === 'generate-collection') {
    const actionBinding = authoringDomainActionBindingV1(template)
    const aiState = useAIConfigStore.getState()
    const domain = await executeDomainNode({
      node,
      inputs,
      projectId: input.projectId,
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      aiConfig: requestedAIConfig(node, inputs),
      creativeReliability: {
        enabled: isCreativeReliabilityRuntimeEnabledV1(),
        qualityMode: aiState.creativeQualityMode,
        budgetProfile: aiState.agentTeamBudgetProfile,
      },
      signal: input.signal,
    })
    if (domain) return domain
    if (actionBinding?.mode === 'formal-domain-action') {
      throw new Error(`节点 ${template.label} 已登记正式领域动作，但执行器没有返回领域候选；已阻止回退到通用生成。`)
    }
    const sourceKeys = template.reads?.sourceKeys ?? []
    const upstream = composeInputs(inputs.filter(item => item.state !== 'control'))
    const binding = !upstream && sourceKeys.length
      ? await readAuthoringCanonBinding({
          node,
          projectId: input.projectId,
          scope: input.scope,
          worldGroupId: input.worldGroupId,
          contextBudget: numberConfig(node, 'contextBudget', 16_000),
        })
      : null
    const assembled = upstream || binding?.content || ''
    const controlNotes = inputs
      .filter(item => item.state === 'control')
      .map(item => `${item.semantic}=${item.content}`)
      .join('\n')
    const aiConfig = requestedAIConfig(node, inputs)
    const promptTemplate = inputControl(inputs, 'control.prompt')
    const generationCount = Math.min(8, Math.max(1, Math.round(controlNumber(inputs, 'control.count', numberConfig(node, 'candidateCount', 1)))))
    const variants: string[] = []
    for (let index = 0; index < generationCount; index += 1) {
      const result = await chat([
        {
          role: 'system',
          content: `你是 StoryForge 的“${template.label}”节点。严格依据输入材料完成任务，不要把未提供的事实当作 Canon。输出应适合${template.label}，不要输出解释。`,
        },
        {
          role: 'user',
          content: `${promptTemplate ? `【Prompt 模板补充】\n${promptTemplate}\n\n` : ''}【节点任务】\n${template.description}\n\n【参数】\n${controlNotes || '使用节点默认参数'}\n\n【输入材料】\n${assembled || '（暂无材料，请先根据任务建立草稿）'}${generationCount > 1 ? `\n\n【候选序号】\n${index + 1}/${generationCount}` : ''}`,
        },
      ], aiConfig, {
      category: template.promptModuleKey ?? 'node.creation',
      projectId: input.projectId,
      configOverrides: {
        temperature: controlNumber(inputs, 'control.temperature', numberConfig(node, 'temperature', aiConfig.temperature)),
        maxTokens: controlNumber(inputs, 'control.max-tokens', numberConfig(node, 'maxTokens', aiConfig.maxTokens)),
      },
      contextOverflowPolicy: 'reject',
      }, input.signal)
      variants.push(result.trim())
    }
    return {
      output: variants.join('\n\n--- 候选分隔 ---\n\n'),
      variants,
      sourceKeys,
      sourceHash: binding?.sourceHash,
      sourceEvidence: binding ?? undefined,
      semantic: template.outputs[0]?.semantic ?? 'candidate',
    }
  }
  if (template.capability === 'validate') {
    const output = composeInputs(inputs)
    const required = stringConfig(node, 'requiredTerms').split(/[\n,，]/).map(item => item.trim()).filter(Boolean)
    const forbidden = stringConfig(node, 'forbiddenTerms').split(/[\n,，]/).map(item => item.trim()).filter(Boolean)
    const issues = [
      ...(!output.trim() ? ['输入内容为空。'] : []),
      ...required.filter(term => !output.includes(term)).map(term => `缺少必含内容：${term}`),
      ...forbidden.filter(term => output.includes(term)).map(term => `包含禁用内容：${term}`),
    ]
    if (issues.length) throw new Error(issues.join('；'))
    return { output, semantic: 'candidate' }
  }
  if (template.capability === 'adopt') {
    return { output: composeInputs(inputs), semantic: inputs[0]?.semantic ?? 'candidate' }
  }
  if (template.class === 'control') {
    return { output: String(node.config.value ?? node.config.presetId ?? ''), semantic: template.outputs[0]?.semantic ?? 'control.count' }
  }
  return { output: composeInputs(inputs), semantic: template.outputs[0]?.semantic ?? 'any' }
}

/**
 * Explicit author confirmation boundary for generated node candidates.
 * The executor never writes Canon automatically; this helper is called by the UI
 * only after the author has reviewed the candidate output.
 */
export async function adoptAuthoringCandidate(input: {
  flow: NodeFlow
  nodeId: string
  output: string
}) {
  if (input.flow.id == null) throw new Error('请先保存节点图。')
  const scope = await resolveScopeLike(input.flow.projectId)
  const storedFlow = await db.nodeFlows.get(input.flow.id)
  if (!storedFlow || !await assertRecordInScope(scope, 'nodeFlows', storedFlow, { owner: 'work' })) {
    throw new Error('节点图不存在或不属于当前作品。')
  }
  const graph = parseAuthoringGraph(input.flow.graphJson)
  const node = graph.nodes.find(item => item.id === input.nodeId)
  if (!node) throw new Error('候选节点不存在。')
  if (node.binding?.mode === 'live') throw new Error('实时 Canon 绑定节点只读，不能重复采纳；请采纳它的下游候选节点。')
  const template = AUTHORING_NODE_BY_ID.get(node.templateId)
  const actionBinding = template ? authoringDomainActionBindingV1(template) : null
  const latestRuns = (await readOwnedRows<NodeRunRecord>(scope, 'nodeRuns', { owner: 'work' }))
    .filter(run => run.flowId === input.flow.id)
  latestRuns.sort((left, right) => right.startedAt - left.startedAt)
  let expectedSignature: AuthoringRunSignature | undefined
  let latestDomain: AuthoringCandidate['domain']
  for (const run of latestRuns) {
    try {
      const candidate = (JSON.parse(run.nodeResultsJson || '{}') as AuthoringCandidateMap)[input.nodeId]
      if (candidate?.signature) {
        expectedSignature = candidate.signature
        latestDomain = candidate.domain
        break
      }
    } catch {
      // A damaged historical run does not replace the latest valid candidate evidence.
    }
  }
  if (expectedSignature?.targetHash && expectedSignature.executorVersion === 'FLOW-3B.2') {
    const currentTarget = await readAuthoringTargetFingerprint({
      node,
      projectId: input.flow.projectId,
      scope,
      worldGroupId: input.flow.worldGroupId ?? null,
    })
    if (currentTarget && !currentTarget.ambiguous && currentTarget.hash !== expectedSignature.targetHash) {
      throw new Error('目标内容已在分步骤模式或其它入口中更新；请重新运行节点后再采纳，避免覆盖新内容。')
    }
  }
  if (latestDomain) {
    const adopted = await adoptDomainCandidate({
      node,
      domain: latestDomain,
      output: input.output,
      projectId: input.flow.projectId,
      scope,
      worldGroupId: input.flow.worldGroupId ?? null,
    })
    if (adopted) return adopted
  }
  if (actionBinding?.mode === 'formal-domain-action') {
    throw new Error('该正式节点缺少分步骤领域候选证据；请用当前版本重新运行节点后再采纳。')
  }
  if (actionBinding?.mode === 'experimental-draft') {
    throw new Error('实验性自由节点只生成候选草稿，不能直接写入 Canon；请接入已登记的正式领域节点后再采纳。')
  }
  if (!template?.writes) throw new Error('该节点没有登记可采纳的写回契约。')
  const write = template.writes
  if (write.fields?.length === 1 && (write.mode === 'replace' || write.mode === 'merge-diffs')) {
    const recordId = await resolveAuthoringBoundRecordId({
      node,
      projectId: input.flow.projectId,
      scope,
      worldGroupId: input.flow.worldGroupId ?? null,
      target: write.target,
    })
    if (write.target === 'characters' && recordId == null) {
      throw new Error('角色维度节点需要先绑定一个目标角色，避免把内容写入错误角色。')
    }
    return adopt({
      projectId: input.flow.projectId,
      scope,
      worldGroupId: input.flow.worldGroupId ?? null,
      target: write.target,
      ...(recordId == null ? {} : { recordId }),
      mode: 'replace',
      data: { [write.fields[0]]: input.output },
    })
  }
  let data: Record<string, unknown>[]
  try {
    const parsedOutput = JSON.parse(input.output) as unknown
    data = Array.isArray(parsedOutput)
      ? parsedOutput.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
      : [parsedOutput as Record<string, unknown>]
  } catch {
    throw new Error('集合节点的候选必须是合法 JSON；请先编辑为 JSON 后再采纳。')
  }
  if (!data.length) throw new Error('候选没有可采纳的记录。')
  return adopt({
    projectId: input.flow.projectId,
    scope,
    worldGroupId: input.flow.worldGroupId ?? null,
    target: write.target,
    mode: write.mode === 'replace' ? 'add-many' : write.mode,
    data,
  })
}

async function persistAuthoringRun(
  runId: number,
  status: NodeRunRecord['status'],
  snapshots: AuthoringRunSnapshotMap,
  candidates: AuthoringCandidateMap,
  plan: AuthoringExecutionPlan,
  completedAt?: number | null,
) {
  await db.nodeRuns.update(runId, {
    status,
    inputSnapshotsJson: JSON.stringify(snapshots),
    nodeResultsJson: JSON.stringify(candidates),
    executionPlanJson: JSON.stringify(plan),
    updatedAt: Date.now(),
    completedAt,
  })
}

/**
 * Called only after the normal domain adoption path succeeds. It records the
 * author's edited candidate without starting another model call, so a failed
 * graph can resume from the next node instead of paying to regenerate the same
 * artifact.
 */
export async function persistAdoptedAuthoringCandidate(input: {
  flow: NodeFlow
  runId: number
  nodeId: string
  output: string
}): Promise<NodeRunRecord> {
  if (input.flow.id == null) throw new Error('请先保存节点图。')
  const scope = await resolveScopeLike(input.flow.projectId)
  const run = await db.nodeRuns.get(input.runId)
  if (!run || run.flowId !== input.flow.id
    || !await assertRecordInScope(scope, 'nodeRuns', run, { owner: 'work' })) {
    throw new Error('节点运行记录不存在或不属于当前节点图。')
  }
  const plan = parseAuthoringExecutionPlan(run.executionPlanJson)
  if (!plan) throw new Error('节点运行计划损坏，不能保存作者修复。')
  const { snapshots, candidates } = parseRunMaps(run)
  const candidate = candidates[input.nodeId]
  if (!candidate) throw new Error('当前运行中没有这个候选。')
  const edited = input.output !== candidate.output
  const { errors: _errors, ...candidateWithoutErrors } = candidate
  candidates[input.nodeId] = {
    ...candidateWithoutErrors,
    output: input.output,
    status: 'adopted',
    ...(edited || candidate.authorEditedAfterArtifact ? { authorEditedAfterArtifact: true } : {}),
  }
  const stillBlocked = plan.completedNodeIds.some(nodeId => candidates[nodeId]?.status === 'blocked')
  const completed = plan.pendingNodeIds.length === 0 && !stillBlocked
  const updatedAt = Date.now()
  const status = completed ? 'completed' : run.status
  const completedAt = completed ? updatedAt : run.completedAt
  await persistAuthoringRun(input.runId, status, snapshots, candidates, plan, completedAt)
  return {
    ...run,
    status,
    nodeResultsJson: JSON.stringify(candidates),
    updatedAt,
    completedAt,
  }
}

export async function runAuthoringGraph(input: {
  flow: NodeFlow
  targetNodeId?: string | null
  /** Resume updates the same paused/failed run after graph-signature verification. */
  resumeRunId?: number
  /** A stale rerun creates a new run while reusing unchanged upstream evidence. */
  baseRunId?: number
  runNodeIds?: ReadonlySet<string>
  signal?: AbortSignal
  onUpdate?: (update: AuthoringRunUpdate) => void
}): Promise<AuthoringRunUpdate> {
  if (input.flow.id == null) throw new Error('请先保存节点图。')
  const scope = await resolveScopeLike(input.flow.projectId)
  const storedFlow = await db.nodeFlows.get(input.flow.id)
  if (!storedFlow || !await assertRecordInScope(scope, 'nodeFlows', storedFlow, { owner: 'work' })) {
    throw new Error('节点图不存在或不属于当前作品。')
  }
  const graph = parseAuthoringGraph(input.flow.graphJson)
  const issues = validateAuthoringGraph(graph)
  if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
  let ordered = topologicalAuthoringOrder(graph, input.targetNodeId)
  if (input.runNodeIds) ordered = ordered.filter(node => input.runNodeIds?.has(node.id))
  if (!ordered.length) throw new Error('本次执行计划没有需要运行的节点。')
  const now = Date.now()
  let plan = buildAuthoringExecutionPlan({
    graph,
    targetNodeId: input.targetNodeId,
    runNodeIds: input.runNodeIds,
  })
  let snapshots: AuthoringRunSnapshotMap = {}
  let candidates: AuthoringCandidateMap = {}
  let run: NodeRunRecord
  let runId: number

  if (input.resumeRunId != null) {
    const existing = await db.nodeRuns.get(input.resumeRunId)
    if (!existing || existing.flowId !== input.flow.id
      || !await assertRecordInScope(scope, 'nodeRuns', existing, { owner: 'work' })) {
      throw new Error('要恢复的运行记录不存在或不属于当前节点图。')
    }
    if (existing.status !== 'paused' && existing.status !== 'failed') {
      throw new Error('只有已暂停或失败的运行可以从断点恢复。')
    }
    const previousPlan = parseAuthoringExecutionPlan(existing.executionPlanJson)
    if (!previousPlan || previousPlan.graphHash !== plan.graphHash) {
      throw new Error('节点图已变化，不能继续旧断点；请开始一次新的运行。')
    }
    ;({ snapshots, candidates } = parseRunMaps(existing))
    const completed = new Set(previousPlan.completedNodeIds)
    const unresolved = previousPlan.completedNodeIds.filter(nodeId => candidates[nodeId]?.status === 'blocked')
    if (unresolved.length) {
      throw new Error('上次运行保留了需要手动修复的候选；请先编辑并确认采纳，再继续下游节点。')
    }
    ordered = previousPlan.orderedNodeIds
      .filter(nodeId => !completed.has(nodeId))
      .map(nodeId => graph.nodes.find(node => node.id === nodeId))
      .filter((node): node is AuthoringNodeInstance => Boolean(node))
    if (!ordered.length) throw new Error('该运行没有待恢复节点。')
    plan = { ...previousPlan, pendingNodeIds: ordered.map(node => node.id) }
    for (const node of ordered) {
      if (candidates[node.id]?.status === 'blocked') delete candidates[node.id]
    }
    runId = existing.id!
    run = { ...existing, status: 'running', updatedAt: now, completedAt: null }
    await db.nodeRuns.update(runId, {
      status: 'running',
      updatedAt: now,
      completedAt: null,
      executionPlanJson: JSON.stringify(plan),
    })
  } else {
    if (input.baseRunId != null) {
      const base = await db.nodeRuns.get(input.baseRunId)
      if (!base || base.flowId !== input.flow.id
        || !await assertRecordInScope(scope, 'nodeRuns', base, { owner: 'work' })) {
        throw new Error('过期重跑基线不存在或不属于当前节点图。')
      }
      const basePlan = parseAuthoringExecutionPlan(base.executionPlanJson)
      if (!basePlan || basePlan.graphHash !== plan.graphHash) {
        throw new Error('节点图已变化，不能复用旧运行候选；请开始一次新的运行。')
      }
      ;({ snapshots, candidates } = parseRunMaps(base))
    }
    const row = stampNewRecord(scope, 'nodeRuns', {
      projectId: input.flow.projectId,
      flowId: input.flow.id,
      status: 'running',
      inputSnapshotsJson: JSON.stringify(snapshots),
      nodeResultsJson: JSON.stringify(candidates),
      executionPlanJson: JSON.stringify(plan),
      graphSnapshotJson: safeAuthoringGraphJson(input.flow.graphJson),
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    } as NodeRunRecord, { owner: 'work' }) as NodeRunRecord
    runId = await db.nodeRuns.add(row) as number
    run = { ...row, id: runId }
  }
  const emit = (nextRun: NodeRunRecord) => input.onUpdate?.({ run: nextRun, snapshots: { ...snapshots }, candidates: { ...candidates } })
  emit(run)

  for (const node of ordered) {
    if (input.signal?.aborted) break
    const inputs = incomingFor(graph, node, candidates)
    snapshots[node.id] = {
      nodeId: node.id,
      nodeTitle: node.title,
      config: structuredClone(node.config),
      inputs,
      totalTokens: inputs.reduce((total, item) => total + item.tokens, 0),
      sourceKeys: AUTHORING_NODE_BY_ID.get(node.templateId)?.reads?.sourceKeys,
    }
    try {
      const executed = await executeNode({
        node,
        inputs,
        projectId: input.flow.projectId,
        scope,
        worldGroupId: input.flow.worldGroupId ?? null,
        signal: input.signal,
      })
      const targetFingerprint = await readAuthoringTargetFingerprint({
        node,
        projectId: input.flow.projectId,
        scope,
        worldGroupId: input.flow.worldGroupId ?? null,
      })
      snapshots[node.id].sourceHash = executed.sourceHash
      snapshots[node.id].sourceKeys = executed.sourceKeys ?? snapshots[node.id].sourceKeys
      snapshots[node.id].sourceEvidence = executed.sourceEvidence
      const signature: AuthoringRunSignature = {
        nodeConfigHash: hashAuthoringText(JSON.stringify(node.config)),
        upstreamHash: inputSignature(inputs),
        sourceHash: executed.sourceHash ?? hashAuthoringText(''),
        ...(!targetFingerprint?.ambiguous && targetFingerprint?.hash ? { targetHash: targetFingerprint.hash } : {}),
        promptVersion: AUTHORING_NODE_BY_ID.get(node.templateId)?.promptModuleKey,
        aiPresetId: stringConfig(node, 'aiPresetId') || undefined,
        executorVersion: 'FLOW-3B.2',
      }
      const selectedArtifact = executed.creativeArtifacts?.[0]
      const reliabilityBlocked = selectedArtifact?.status === 'manual-repair'
        || selectedArtifact?.status === 'blocked'
      candidates[node.id] = {
        nodeId: node.id,
        status: node.binding?.mode === 'live' ? 'adopted' : reliabilityBlocked ? 'blocked' : 'candidate',
        output: executed.output,
        ...(executed.variants ? { variants: executed.variants } : {}),
        ...(executed.creativeArtifacts ? {
          creativeArtifacts: executed.creativeArtifacts,
          selectedVariantIndex: 0,
        } : {}),
        ...('domain' in executed ? { domain: executed.domain } : {}),
        semantic: executed.semantic,
        signature,
        ...(reliabilityBlocked ? {
          errors: selectedArtifact.issues.map(issue => issue.message),
        } : {}),
        createdAt: Date.now(),
      }
      plan = {
        ...plan,
        completedNodeIds: Array.from(new Set([...plan.completedNodeIds, node.id])),
        pendingNodeIds: plan.pendingNodeIds.filter(nodeId => nodeId !== node.id),
      }
      if (reliabilityBlocked) {
        const completedAt = Date.now()
        await persistAuthoringRun(runId, 'failed', snapshots, candidates, plan, completedAt)
        const failed = {
          ...run,
          status: 'failed' as const,
          updatedAt: completedAt,
          completedAt,
          executionPlanJson: JSON.stringify(plan),
        }
        emit(failed)
        return { run: failed, snapshots, candidates }
      }
      await persistAuthoringRun(runId, 'running', snapshots, candidates, plan, null)
      emit({ ...run, updatedAt: Date.now(), executionPlanJson: JSON.stringify(plan) })
    } catch (error) {
      if (input.signal?.aborted) break
      candidates[node.id] = {
        nodeId: node.id,
        status: 'blocked',
        output: '',
        semantic: AUTHORING_NODE_BY_ID.get(node.templateId)?.outputs[0]?.semantic ?? 'any',
        errors: [error instanceof Error ? error.message : String(error)],
        createdAt: Date.now(),
      }
      const completedAt = Date.now()
      await persistAuthoringRun(runId, 'failed', snapshots, candidates, plan, completedAt)
      const failed = { ...run, status: 'failed' as const, updatedAt: completedAt, completedAt, executionPlanJson: JSON.stringify(plan) }
      emit(failed)
      return { run: failed, snapshots, candidates }
    }
  }

  const completedAt = Date.now()
  const status = input.signal?.aborted
    ? input.signal.reason === 'paused' ? 'paused' : 'cancelled'
    : 'completed'
  await persistAuthoringRun(runId, status, snapshots, candidates, plan, completedAt)
  const completed = { ...run, status: status as NodeRunRecord['status'], updatedAt: completedAt, completedAt, executionPlanJson: JSON.stringify(plan) }
  emit(completed)
  return { run: completed, snapshots, candidates }
}
