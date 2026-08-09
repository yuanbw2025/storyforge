import { appendAgentEvent } from '../conversations'
import { analyzeEditImpact } from '../../consistency/impact-analysis'
import { readOwnedRows } from '../../world-engine/scope'
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
  if (candidate.payload.skillId === 'outline.story-arcs') return 'storyArcs'
  return TARGET_TABLE_BY_AGENT[candidate.payload.agentId] ?? 'unknown'
}

function contentForReport(report: MasterAgentImpactReportV1): string {
  const subject = `${report.agentId} → ${report.changed.table}`
  if (report.agentId === 'prose') {
    return [
      `采纳后影响分析：${subject} 已写入。`,
      `本章来源事实 ${report.sourceFactIds.length} 条，其中待复核 ${report.staleFactIds.length} 条。`,
      `后续可能受影响章节 ${report.downstreamChapterIds.length} 章。`,
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

  if (agentId !== 'prose' || payload.proseOutlineNodeId == null) {
    return report
  }
  const chapter = downstream.find(row => row.outlineNodeId === payload.proseOutlineNodeId)
  if (!chapter?.id) return report
  report.changed.id = chapter.id
  const impact = await analyzeEditImpact(scope, chapter.id)
  report.sourceFactIds = impact.factsFromChapter
    .map(fact => fact.id)
    .filter((id): id is number => typeof id === 'number')
  report.staleFactIds = impact.factsFromChapter
    .filter(fact => ['stale', 'source-missing', 'invalid-range'].includes(fact.status))
    .map(fact => fact.id)
    .filter((id): id is number => typeof id === 'number')
  report.downstreamChapterIds = impact.downstreamChapterIds
  const summaries = await readOwnedRows<any>(scope, 'narrativeSummaryNodes', { owner: 'work' })
  report.staleSummaryNodeIds = summaries
    .filter(summary => summary.status === 'stale' && (
      summary.sourceChapterId === chapter.id
      || summary.level === 'book'
      || summary.level === 'volume'
    ))
    .map(summary => summary.id)
    .filter((id): id is number => typeof id === 'number')
  report.retrievalChunkCount = (await readOwnedRows<any>(scope, 'retrievalChunks', { owner: 'work' }))
    .filter(chunk => chunk.sourceChapterId === chapter.id).length
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
