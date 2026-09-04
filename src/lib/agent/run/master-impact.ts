import { appendAgentEvent } from '../conversations'
import { buildEditImpactGraphV1, type EditImpactGraphV1 } from '../../consistency/impact-analysis'
import { readOwnedRows } from '../../workspace/scope'
import type { AgentEvent, WorkspaceScope } from '../../types'
import type { MasterAgentDurableCandidateV1 } from './master-durable'
import type { AgentRunSnapshotV1 } from './event-store'

export const MASTER_AGENT_IMPACT_REPORT_VERSION_V1 = 1 as const

export interface MasterAgentImpactReportV1 {
  version: typeof MASTER_AGENT_IMPACT_REPORT_VERSION_V1
  kind: 'master-agent-impact'
  runId: number
  stepId: string
  agentId: string
  direction: 'downstream-review' | 'upstream-review'
  changed: { table: string; id: number | null }
  upstreamContextSources: string[]
  sourceFactIds: number[]
  staleFactIds: number[]
  downstreamChapterIds: number[]
  staleSummaryNodeIds: number[]
  retrievalChunkCount: number
  requiresAuthorReview: boolean
  /** HARNESS-43: deterministic, read-only impact evidence for later patch work. */
  impactGraph?: EditImpactGraphV1
}

const TARGET_TABLE_BY_AGENT: Record<string, string> = {
  'world-origin': 'worldviews',
  character: 'characters',
  inspiration: 'inspirationWorkspaces',
  outline: 'outlineNodes',
  prose: 'chapters',
}

function targetTableFor(candidate: MasterAgentDurableCandidateV1): string {
  if (candidate.payload.skillId === 'world-origin.story-core') return 'storyCores'
  if (candidate.payload.skillId === 'world-origin.creative-rules') return 'creativeRules'
  if (candidate.payload.skillId === 'outline.story-arcs') return 'storyArcs'
  if (candidate.payload.skillId === 'outline.storyline-progress') return 'storylineProgress'
  return TARGET_TABLE_BY_AGENT[candidate.payload.agentId] ?? 'unknown'
}

function contentForReport(report: MasterAgentImpactReportV1): string {
  const subject = `${report.agentId} → ${report.changed.table}`
  if (report.agentId === 'prose') {
    return [
      `采纳后影响分析：${subject} 已写入。`,
      `本章来源事实 ${report.sourceFactIds.length} 条，其中待复核 ${report.staleFactIds.length} 条。`,
      `后续可能受影响章节 ${report.downstreamChapterIds.length} 章。`,
      report.impactGraph ? `影响图 ${report.impactGraph.nodes.length} 个节点、${report.impactGraph.edges.length} 条边（${report.impactGraph.graphHash.slice(0, 12)}）。` : '',
      report.requiresAuthorReview ? '请先复核事实和后续章节，再继续生成。' : '当前没有发现需要额外复核的下游对象。',
    ].join('\n')
  }
  return [
    `采纳后影响分析：${subject} 已写入。`,
    `本次读取的上游上下文 ${report.upstreamContextSources.length} 类，可能影响后续章节 ${report.downstreamChapterIds.length} 章。`,
    report.requiresAuthorReview ? '上游设定变化不会自动改写正文，请作者确认影响范围后再继续。' : '当前没有发现需要额外复核的下游对象。',
  ].join('\n')
}

async function buildReport(
  input: {
    scope: WorkspaceScope
    snapshot: AgentRunSnapshotV1
    candidate: MasterAgentDurableCandidateV1
  },
): Promise<MasterAgentImpactReportV1> {
  const { scope, snapshot, candidate } = input
  const payload = candidate.payload
  const agentId = payload.agentId
  const downstream = await readOwnedRows<any>(scope, 'chapters', { owner: 'work' })
  const report: MasterAgentImpactReportV1 = {
    version: MASTER_AGENT_IMPACT_REPORT_VERSION_V1,
    kind: 'master-agent-impact',
    runId: snapshot.run.id,
    stepId: payload.runStepId ?? `master:${payload.taskId}`,
    agentId,
    direction: agentId === 'prose' ? 'upstream-review' : 'downstream-review',
    changed: { table: targetTableFor(candidate), id: null },
    upstreamContextSources: [...new Set(payload.contextSources)],
    sourceFactIds: [],
    staleFactIds: [],
    downstreamChapterIds: downstream.map(row => row.id).filter((id): id is number => typeof id === 'number'),
    staleSummaryNodeIds: [],
    retrievalChunkCount: 0,
    requiresAuthorReview: agentId !== 'prose',
  }

  if (payload.skillId === 'world-origin.story-core') {
    const row = (await readOwnedRows<any>(scope, 'storyCores', { owner: 'work' }))[0]
    report.changed.id = typeof row?.id === 'number' ? row.id : null
  }

  if (payload.skillId === 'world-origin.creative-rules') {
    const row = (await readOwnedRows<any>(scope, 'creativeRules', { owner: 'work' }))[0]
    report.changed.id = typeof row?.id === 'number' ? row.id : null
  }

  if (payload.skillId === 'character.supplement') {
    report.changed.id = payload.characterSupplementRequest?.characterId ?? null
  }
  if (payload.skillId === 'character.lifecycle') {
    report.changed.id = payload.characterLifecycleRequest?.characterId ?? null
  }

  if (agentId !== 'prose' || payload.proseOutlineNodeId == null) {
    return report
  }
  const chapter = downstream.find(row => row.outlineNodeId === payload.proseOutlineNodeId)
  if (!chapter?.id) return report
  report.changed.id = chapter.id
  const impactGraph = await buildEditImpactGraphV1(scope, chapter.id)
  report.impactGraph = impactGraph
  report.sourceFactIds = impactGraph.nodes
    .filter(node => node.kind === 'fact' && node.recordId != null)
    .map(node => node.recordId!)
  report.staleFactIds = impactGraph.staleFactIds
  report.downstreamChapterIds = impactGraph.downstreamChapterIds
  report.staleSummaryNodeIds = impactGraph.nodes
    .filter(node => node.kind === 'summary' && node.status === 'stale' && node.recordId != null)
    .map(node => node.recordId!)
  report.retrievalChunkCount = impactGraph.nodes.filter(node => node.kind === 'retrieval-chunk').length
  report.requiresAuthorReview = report.sourceFactIds.length > 0 || report.downstreamChapterIds.length > 0
  return report
}

export async function appendMasterAgentImpactReportV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: MasterAgentDurableCandidateV1
}): Promise<{ event: AgentEvent; report: MasterAgentImpactReportV1 }> {
  const conversationId = input.snapshot.run.conversationId
  if (conversationId == null) throw new Error('主 Agent run 缺少影响报告对话')
  const report = await buildReport(input)
  const event = await appendAgentEvent({
    projectId: input.scope.projectId,
    conversationId,
    kind: 'message',
    role: 'system',
    content: contentForReport(report),
    payload: report,
    scope: input.scope,
  })
  return { event, report }
}
