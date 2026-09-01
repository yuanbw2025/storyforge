import { estimateTokens } from '../ai/context-budget'
import type { NodeFlow } from '../types'
import { hashAuthoringText, readAuthoringCanonBinding } from './bindings'
import type { AuthoringCandidateMap, AuthoringRunSnapshotMap } from './executor'
import { downstreamAuthoringNodeIds } from './graph'
import { parseAuthoringGraph } from './graph-codec'

export type AuthoringFreshnessReason =
  | 'never-run'
  | 'blocked'
  | 'config-updated'
  | 'connections-updated'
  | 'source-updated'
  | 'source-missing'
  | 'upstream-stale'

export interface AuthoringNodeFreshness {
  nodeId: string
  status: 'fresh' | 'stale' | 'never-run' | 'blocked'
  reasons: AuthoringFreshnessReason[]
}

export type AuthoringFreshnessMap = Record<string, AuthoringNodeFreshness>

function currentUpstreamHash(
  graph: ReturnType<typeof parseAuthoringGraph>,
  nodeId: string,
  candidates: AuthoringCandidateMap,
): string {
  const inputs = graph.edges
    .filter(edge => edge.targetNodeId === nodeId)
    .map(edge => {
      const content = candidates[edge.sourceNodeId]?.output ?? ''
      return {
        content,
        sourceNodeId: edge.sourceNodeId,
        targetPortId: edge.targetPortId,
        tokens: estimateTokens(content),
      }
    })
    .sort((left, right) => right.tokens - left.tokens)
  return hashAuthoringText(inputs.map(input => `${input.sourceNodeId}:${input.targetPortId}:${input.content}`).join('\n'))
}

/** Compare latest run evidence with the graph and current Canon without writing either. */
export async function inspectAuthoringGraphFreshness(input: {
  flow: NodeFlow
  snapshots: AuthoringRunSnapshotMap
  candidates: AuthoringCandidateMap
}): Promise<AuthoringFreshnessMap> {
  const graph = parseAuthoringGraph(input.flow.graphJson)
  const result: AuthoringFreshnessMap = {}
  const staleRoots = new Set<string>()

  for (const node of graph.nodes) {
    const candidate = input.candidates[node.id]
    const snapshot = input.snapshots[node.id]
    if (!candidate) {
      result[node.id] = { nodeId: node.id, status: 'never-run', reasons: ['never-run'] }
      continue
    }
    if (candidate.status === 'blocked') {
      result[node.id] = { nodeId: node.id, status: 'blocked', reasons: ['blocked'] }
      staleRoots.add(node.id)
      continue
    }

    const reasons: AuthoringFreshnessReason[] = []
    const signature = candidate.signature
    if (!signature || signature.nodeConfigHash !== hashAuthoringText(JSON.stringify(node.config))) {
      reasons.push('config-updated')
    }
    if (!signature || signature.upstreamHash !== currentUpstreamHash(graph, node.id, input.candidates)) {
      reasons.push('connections-updated')
    }
    if (snapshot?.sourceHash && signature?.executorVersion === 'FLOW-3B.2') {
      const current = await readAuthoringCanonBinding({
        node,
        projectId: input.flow.projectId,
        worldGroupId: input.flow.worldGroupId ?? null,
        contextBudget: typeof node.config.contextBudget === 'number' ? node.config.contextBudget : undefined,
      })
      if (current.missing.length) reasons.push('source-missing')
      else if (current.sourceHash !== snapshot.sourceHash) reasons.push('source-updated')
    }

    const uniqueReasons = Array.from(new Set(reasons))
    const status = uniqueReasons.length ? 'stale' : 'fresh'
    result[node.id] = { nodeId: node.id, status, reasons: uniqueReasons }
    if (status === 'stale') staleRoots.add(node.id)
  }

  for (const rootId of staleRoots) {
    for (const nodeId of downstreamAuthoringNodeIds(graph, rootId)) {
      const current = result[nodeId]
      if (!current || current.status === 'never-run' || current.status === 'blocked') continue
      current.status = 'stale'
      current.reasons = Array.from(new Set([...current.reasons, 'upstream-stale']))
    }
  }
  return result
}
