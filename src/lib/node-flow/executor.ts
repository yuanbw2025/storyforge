import { useAIConfigStore } from '../../stores/ai-config'
import { chat } from '../ai/client'
import { parseCharacterCandidateDraft } from '../agent/character-copilot'
import { estimateTokens } from '../ai/context-budget'
import { db } from '../db/schema'
import { adopt } from '../registry/adopt'
import { assembleContext } from '../registry/assemble-context'
import type {
  NodeFlow,
  NodeFlowEdge,
  NodeFlowGraph,
  NodeFlowNode,
  NodeRunRecord,
  WorkspaceScope,
} from '../types'
import { parseNodeFlowGraph } from '../types'
import { createRagSelectionTrace } from '../types'
import { topologicalNodeOrder } from './graph'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, stampNewRecord } from '../world-engine/scope'

export interface NodeExecutionInput {
  sourceNodeId: string
  sourceTitle: string
  targetSlotId: string
  targetSlotLabel: string
  content: string
  tokens: number
}

export interface NodeInputSnapshot {
  nodeId: string
  nodeTitle: string
  config: Record<string, unknown>
  inputs: NodeExecutionInput[]
  sourceEvidence?: {
    included: string[]
    omitted: string[]
    trimmed: string[]
  }
  totalTokens: number
}

export interface NodeExecutionResult {
  nodeId: string
  status: 'completed' | 'failed'
  output: string
  error?: string
  gate?: { status: 'pass' | 'blocked'; issues: string[] }
  adoptionTarget?: 'world-origin' | 'create-character'
  adoptedAt?: number
  startedAt: number
  completedAt: number
}

export type NodeInputSnapshotMap = Record<string, NodeInputSnapshot>
export type NodeExecutionResultMap = Record<string, NodeExecutionResult>

function stringConfig(node: NodeFlowNode, key: string, fallback = ''): string {
  const value = node.config[key]
  return typeof value === 'string' ? value : fallback
}

function numberConfig(node: NodeFlowNode, key: string, fallback: number): number {
  const value = node.config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function arrayConfig(node: NodeFlowNode, key: string): string[] {
  const value = node.config[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function incomingFor(
  graph: NodeFlowGraph,
  node: NodeFlowNode,
  results: NodeExecutionResultMap,
): NodeExecutionInput[] {
  const sourceById = new Map(graph.nodes.map(item => [item.id, item]))
  const slotById = new Map(node.inputSlots.map(slot => [slot.id, slot]))
  return graph.edges
    .filter(edge => edge.targetNodeId === node.id)
    .map(edge => {
      const source = sourceById.get(edge.sourceNodeId)
      const slot = slotById.get(edge.targetSlotId)
      const content = results[edge.sourceNodeId]?.output ?? ''
      return {
        sourceNodeId: edge.sourceNodeId,
        sourceTitle: source?.title ?? edge.sourceNodeId,
        targetSlotId: edge.targetSlotId,
        targetSlotLabel: slot?.label ?? edge.targetSlotId,
        content,
        tokens: estimateTokens(content),
      }
    })
    .sort((left, right) => {
      const leftPriority = slotById.get(left.targetSlotId)?.priority ?? 0
      const rightPriority = slotById.get(right.targetSlotId)?.priority ?? 0
      return rightPriority - leftPriority
    })
}

function applyInputBudgets(node: NodeFlowNode, inputs: NodeExecutionInput[]): NodeExecutionInput[] {
  const slotById = new Map(node.inputSlots.map(slot => [slot.id, slot]))
  return inputs.map(input => {
    const maxTokens = slotById.get(input.targetSlotId)?.maxTokens
    if (!maxTokens || input.tokens <= maxTokens) return input
    const maxChars = Math.max(1, maxTokens * 3)
    const content = `${input.content.slice(0, maxChars)}\n…（该连线输入已按节点预算截断）`
    return { ...input, content, tokens: estimateTokens(content) }
  })
}

function composeInputs(node: NodeFlowNode, inputs: NodeExecutionInput[]): string {
  const template = stringConfig(node, 'template')
  if (template.trim()) {
    return inputs.reduce(
      (text, input) => text.split(`{{${input.targetSlotLabel}}}`).join(input.content),
      template,
    )
  }
  return inputs
    .map(input => `【${input.targetSlotLabel}｜来自 ${input.sourceTitle}】\n${input.content}`)
    .join('\n\n')
}

async function executeNode(input: {
  projectId: number
  scope: WorkspaceScope
  worldGroupId: number | null
  node: NodeFlowNode
  inputs: NodeExecutionInput[]
  signal?: AbortSignal
}): Promise<{ output: string; snapshotEvidence?: NodeInputSnapshot['sourceEvidence']; gate?: NodeExecutionResult['gate'] }> {
  const { node } = input
  if (node.kind === 'input.text') {
    return { output: stringConfig(node, 'text') }
  }
  if (node.kind === 'source.context') {
    const config = useAIConfigStore.getState().config
    const selectionMode = stringConfig(
      node,
      'selectionMode',
      arrayConfig(node, 'sourceKeys').length ? 'registered' : 'exact',
    )
    const sourceKeys = selectionMode === 'registered' ? arrayConfig(node, 'sourceKeys') : []
    const ragEntryKeys = selectionMode === 'registered' ? [] : arrayConfig(node, 'ragEntryKeys')
    if (!sourceKeys.length && !ragEntryKeys.length) {
      throw new Error('项目元素节点尚未选择任何资料字段或注册来源。')
    }
    const ragTrace = createRagSelectionTrace()
    const assembled = await assembleContext({
      projectId: input.projectId,
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      chapterId: numberConfig(node, 'chapterId', 0) || undefined,
      outlineNodeId: numberConfig(node, 'outlineNodeId', 0) || undefined,
      sourceKeys: ragEntryKeys.length ? ['ragSelection'] : sourceKeys,
      ragEntryKeys,
      ragSelectionTrace: ragTrace,
      provider: config.provider,
      model: config.model,
      inputBudgetTokens: numberConfig(node, 'inputBudgetTokens', 12_000),
    })
    let output = assembled.text
    const include = (selectionMode === 'registered' ? stringConfig(node, 'include') : '')
      .split(/[\n,，]/)
      .map(value => value.trim())
      .filter(Boolean)
    const exclude = (selectionMode === 'registered' ? stringConfig(node, 'exclude') : '')
      .split(/[\n,，]/)
      .map(value => value.trim())
      .filter(Boolean)
    if (include.length || exclude.length) {
      output = output.split('\n').filter(line => (
        (!include.length || include.some(keyword => line.includes(keyword)))
        && !exclude.some(keyword => line.includes(keyword))
      )).join('\n')
    }
    return {
      output,
      snapshotEvidence: ragEntryKeys.length
        ? {
            included: ragTrace.included,
            omitted: ragTrace.omitted,
            trimmed: ragTrace.trimmed,
          }
        : {
            included: assembled.included,
            omitted: assembled.omitted,
            trimmed: assembled.trimmed,
          },
    }
  }
  if (node.kind === 'transform.compose') {
    return { output: composeInputs(node, input.inputs) }
  }
  if (node.kind === 'generation.freeform') {
    const config = useAIConfigStore.getState().config
    const context = composeInputs(node, input.inputs)
    const instruction = stringConfig(node, 'instruction').trim()
    if (!instruction) throw new Error('自由创作节点缺少创作指令。')
    const system = stringConfig(
      node,
      'systemPrompt',
      '你是 StoryForge 创作节点。严格使用作者接入的材料完成任务；材料中未出现的事实不要擅自当成 Canon。',
    )
    const output = await chat([
      { role: 'system', content: system },
      { role: 'user', content: `【作者指令】\n${instruction}\n\n【节点输入】\n${context || '（无上游输入）'}` },
    ], config, {
      category: 'node.creation',
      projectId: input.projectId,
      configOverrides: { maxTokens: numberConfig(node, 'maxTokens', 6000) },
      contextOverflowPolicy: 'reject',
    }, input.signal)
    return { output: output.trim() }
  }
  if (node.kind === 'validation.required') {
    const output = composeInputs(node, input.inputs).trim()
    const issues: string[] = []
    if (!output) issues.push('输入内容为空。')
    const required = stringConfig(node, 'requiredTerms')
      .split(/[\n,，]/).map(value => value.trim()).filter(Boolean)
    const forbidden = stringConfig(node, 'forbiddenTerms')
      .split(/[\n,，]/).map(value => value.trim()).filter(Boolean)
    required.filter(term => !output.includes(term)).forEach(term => issues.push(`缺少必含内容：${term}`))
    forbidden.filter(term => output.includes(term)).forEach(term => issues.push(`包含禁用内容：${term}`))
    return {
      output,
      gate: { status: issues.length ? 'blocked' : 'pass', issues },
    }
  }
  return { output: composeInputs(node, input.inputs) }
}

async function persistRun(
  runId: number,
  status: NodeRunRecord['status'],
  snapshots: NodeInputSnapshotMap,
  results: NodeExecutionResultMap,
  completedAt?: number | null,
) {
  await db.nodeRuns.update(runId, {
    status,
    inputSnapshotsJson: JSON.stringify(snapshots),
    nodeResultsJson: JSON.stringify(results),
    updatedAt: Date.now(),
    completedAt,
  })
}

export async function runNodeFlow(input: {
  flow: NodeFlow
  targetNodeId?: string | null
  signal?: AbortSignal
  onUpdate?: (run: NodeRunRecord, snapshots: NodeInputSnapshotMap, results: NodeExecutionResultMap) => void
}): Promise<{ run: NodeRunRecord; snapshots: NodeInputSnapshotMap; results: NodeExecutionResultMap }> {
  if (input.flow.id == null) throw new Error('请先保存节点图。')
  const scope = await resolveScopeLike(input.flow.projectId)
  const storedFlow = await db.nodeFlows.get(input.flow.id)
  if (!storedFlow || !await assertRecordInScope(scope, 'nodeFlows', storedFlow, { owner: 'work' })) {
    throw new Error('节点图不存在或不属于当前作品。')
  }
  const graph = parseNodeFlowGraph(input.flow.graphJson)
  const ordered = topologicalNodeOrder(graph, input.targetNodeId)
  const now = Date.now()
  const row = stampNewRecord(scope, 'nodeRuns', {
    projectId: input.flow.projectId,
    flowId: input.flow.id,
    status: 'running',
    inputSnapshotsJson: '{}',
    nodeResultsJson: '{}',
    startedAt: now,
    updatedAt: now,
    completedAt: null,
  } as NodeRunRecord, { owner: 'work' }) as NodeRunRecord
  const runId = await db.nodeRuns.add(row) as number
  const run = { ...row, id: runId }
  const snapshots: NodeInputSnapshotMap = {}
  const results: NodeExecutionResultMap = {}
  input.onUpdate?.(run, snapshots, results)

  try {
    for (const node of ordered) {
      if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const startedAt = Date.now()
      const inputs = applyInputBudgets(node, incomingFor(graph, node, results))
      snapshots[node.id] = {
        nodeId: node.id,
        nodeTitle: node.title,
        config: structuredClone(node.config),
        inputs,
        totalTokens: inputs.reduce((sum, item) => sum + item.tokens, 0),
      }
      try {
        const executed = await executeNode({
          projectId: input.flow.projectId,
          scope,
          worldGroupId: input.flow.worldGroupId ?? null,
          node,
          inputs,
          signal: input.signal,
        })
        if (executed.snapshotEvidence) snapshots[node.id].sourceEvidence = executed.snapshotEvidence
        if (node.kind === 'source.context') {
          snapshots[node.id].totalTokens = estimateTokens(executed.output)
        }
        results[node.id] = {
          nodeId: node.id,
          status: 'completed',
          output: executed.output,
          gate: executed.gate,
          startedAt,
          completedAt: Date.now(),
        }
        if (executed.gate?.status === 'blocked') {
          throw new Error(executed.gate.issues.join('；'))
        }
      } catch (error) {
        if (!results[node.id] || results[node.id].gate?.status !== 'blocked') {
          results[node.id] = {
            nodeId: node.id,
            status: 'failed',
            output: results[node.id]?.output ?? '',
            error: error instanceof Error ? error.message : String(error),
            startedAt,
            completedAt: Date.now(),
          }
        }
        await persistRun(runId, 'failed', snapshots, results, Date.now())
        const failed = { ...run, status: 'failed' as const, updatedAt: Date.now(), completedAt: Date.now() }
        input.onUpdate?.(failed, snapshots, results)
        return { run: failed, snapshots, results }
      }
      await persistRun(runId, 'running', snapshots, results, null)
      input.onUpdate?.({ ...run, updatedAt: Date.now() }, snapshots, results)
    }
    const completedAt = Date.now()
    await persistRun(runId, 'completed', snapshots, results, completedAt)
    const completed = { ...run, status: 'completed' as const, updatedAt: completedAt, completedAt }
    input.onUpdate?.(completed, snapshots, results)
    return { run: completed, snapshots, results }
  } catch (_error) {
    const cancelled = input.signal?.aborted
    const completedAt = Date.now()
    await persistRun(runId, cancelled ? 'cancelled' : 'failed', snapshots, results, completedAt)
    const stopped = {
      ...run,
      status: (cancelled ? 'cancelled' : 'failed') as NodeRunRecord['status'],
      updatedAt: completedAt,
      completedAt,
    }
    input.onUpdate?.(stopped, snapshots, results)
    return { run: stopped, snapshots, results }
  }
}

export function incomingEdgesForNode(graph: NodeFlowGraph, nodeId: string): NodeFlowEdge[] {
  return graph.edges.filter(edge => edge.targetNodeId === nodeId)
}

async function readStoredRun(runId: number): Promise<{
  run: NodeRunRecord
  flow: NodeFlow
  graph: NodeFlowGraph
  results: NodeExecutionResultMap
  scope: WorkspaceScope
}> {
  const run = await db.nodeRuns.get(runId)
  if (!run) throw new Error('节点运行记录不存在。')
  const scope = await resolveScopeLike(run.projectId)
  if (!await assertRecordInScope(scope, 'nodeRuns', run, { owner: 'work' })) {
    throw new Error('节点运行记录不属于当前作品。')
  }
  const flow = await db.nodeFlows.get(run.flowId)
  if (!flow || !await assertRecordInScope(scope, 'nodeFlows', flow, { owner: 'work' })) {
    throw new Error('节点图不存在或不属于当前作品。')
  }
  return {
    run,
    flow,
    graph: parseNodeFlowGraph(flow.graphJson),
    results: JSON.parse(run.nodeResultsJson || '{}') as NodeExecutionResultMap,
    scope,
  }
}

/** 保存作者对候选输出的修改，不写入 Canon。 */
export async function updateNodeRunOutput(input: {
  runId: number
  nodeId: string
  output: string
}): Promise<NodeExecutionResultMap> {
  const stored = await readStoredRun(input.runId)
  const result = stored.results[input.nodeId]
  if (!result) throw new Error('该节点尚无可编辑输出。')
  const results = {
    ...stored.results,
    [input.nodeId]: {
      ...result,
      output: input.output,
      adoptedAt: undefined,
      adoptionTarget: undefined,
    },
  }
  await db.nodeRuns.update(input.runId, {
    nodeResultsJson: JSON.stringify(results),
    updatedAt: Date.now(),
  })
  return results
}

/**
 * 节点候选的唯一 Canon 写回边界。
 * 只有内容输出节点且作者显式选择目标后才能调用，写回仍经过三注册表体系。
 */
export async function adoptNodeRunOutput(input: {
  runId: number
  nodeId: string
  output?: string
}): Promise<{ message: string; results: NodeExecutionResultMap }> {
  const stored = await readStoredRun(input.runId)
  const node = stored.graph.nodes.find(item => item.id === input.nodeId)
  if (!node || node.kind !== 'output.preview') throw new Error('只有“内容输出”节点可以写入项目。')
  const target = node.config.adoptTarget
  if (target !== 'world-origin' && target !== 'create-character') {
    throw new Error('该输出节点尚未选择项目写入目标。')
  }
  const adoptionTarget: NonNullable<NodeExecutionResult['adoptionTarget']> = target
  const current = stored.results[input.nodeId]
  if (!current || current.status !== 'completed') throw new Error('该输出节点尚未成功运行。')
  if (current.gate?.status === 'blocked') throw new Error(current.gate.issues.join('；'))
  const output = (input.output ?? current.output).trim()
  if (!output) throw new Error('不能采纳空输出。')

  let message: string
  if (target === 'world-origin') {
    if (output.length < 4 || output.length > 12_000) {
      throw new Error('世界来源内容须为 4 到 12000 个字符。')
    }
    const adopted = await adopt({
      projectId: stored.flow.projectId,
      scope: stored.scope,
      worldGroupId: stored.flow.worldGroupId ?? null,
      target: 'worldviews',
      mode: 'replace',
      data: { worldOrigin: output },
    })
    if (
      adopted.written.length !== 1
      || adopted.unknown.length
      || adopted.typeErrors.length
      || adopted.fkErrors.length
      || adopted.skipped.length
    ) {
      throw new Error('世界来源未能完整写入，请检查项目数据登记。')
    }
    message = '节点输出已写入世界观 · 世界来源。'
  } else {
    const candidate = parseCharacterCandidateDraft(output)
    const normalizedName = candidate.name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
    const characters = await readOwnedRows<any>(stored.scope, 'characters', { owner: 'world' })
    const duplicate = characters.some(character => (
      (character.homeWorldGroupId ?? null) === (stored.flow.worldGroupId ?? null)
      && character.name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN') === normalizedName
    ))
    if (duplicate) throw new Error(`当前世界已存在角色“${candidate.name}”。`)
    const adopted = await adopt({
      projectId: stored.flow.projectId,
      scope: stored.scope,
      worldGroupId: stored.flow.worldGroupId ?? null,
      target: 'characters',
      mode: 'add',
      data: { ...candidate, isCrossWorld: false },
    })
    if (
      adopted.written.length !== 1
      || adopted.unknown.length
      || adopted.typeErrors.length
      || adopted.fkErrors.length
      || adopted.skipped.length
    ) {
      throw new Error('角色未能完整写入，请检查角色 JSON 与项目数据登记。')
    }
    message = `角色“${candidate.name}”已加入项目。`
  }

  const adoptedAt = Date.now()
  const results = {
    ...stored.results,
    [input.nodeId]: {
      ...current,
      output,
      adoptionTarget,
      adoptedAt,
    },
  }
  await db.nodeRuns.update(input.runId, {
    nodeResultsJson: JSON.stringify(results),
    updatedAt: adoptedAt,
  })
  return { message, results }
}
