import { db } from '../db/schema'
import { hashCanonicalValue } from '../agent/run/hash'
import { buildEditImpactGraphV1 } from '../consistency/impact-analysis'
import { buildImpactRemediationPlanV1 } from '../consistency/impact-remediation-plan'
import { PROJECT_TABLES } from '../registry/project-tables'
import type {
  WorkspaceFileAdoptionCandidateV1,
  WorkspaceFileCandidateSetV1,
  WorkspaceImpactExecutionV1,
  WorkspaceImpactItemV1,
  WorkspaceImpactPlanV1,
} from '../types'
import type { Chapter } from '../types'
import { ensureWorkspaceOwnership } from '../world-engine/ownership'

function executionForImpact(action: string, mode: string): WorkspaceImpactExecutionV1 {
  if (mode === 'deterministic') return 'deterministic-rebuild'
  if (action === 'review-outline' || action === 'review-derived-state') return 'generative-candidate'
  return 'manual-review'
}

function rootReviewItem(
  candidate: WorkspaceFileAdoptionCandidateV1,
): WorkspaceImpactItemV1 {
  return {
    id: `workspace-impact:${candidate.candidateId}:source`,
    candidateId: candidate.candidateId,
    sourceTable: candidate.tableName,
    sourceRecordId: candidate.recordId,
    targetTable: candidate.tableName,
    targetRecordId: candidate.recordId,
    action: 'review-changed-source',
    execution: 'manual-review',
    dependencyItemIds: [],
    reason: `作者从本地文件修改了 ${candidate.changedFields.join('、')}；正式采纳后需核对受影响来源。`,
  }
}

async function chapterIdsForRootCandidate(
  projectId: number,
  candidate: WorkspaceFileAdoptionCandidateV1,
): Promise<number[]> {
  const chapters = await db.chapters.where('projectId').equals(projectId).toArray() as Array<Chapter & { workId?: number }>
  if (candidate.tableName === 'projects') return chapters.map(chapter => chapter.id!).filter(Number.isInteger)
  if (candidate.tableName === 'works') {
    return chapters.filter(chapter => chapter.workId === candidate.recordId).map(chapter => chapter.id!).filter(Number.isInteger)
  }
  if (candidate.tableName === 'worlds') {
    const workIds = new Set((await db.works.where('worldId').equals(candidate.recordId).toArray()).map(work => work.id))
    return chapters.filter(chapter => chapter.workId != null && workIds.has(chapter.workId))
      .map(chapter => chapter.id!).filter(Number.isInteger)
  }
  return []
}

async function rootCandidateItems(
  projectId: number,
  candidate: WorkspaceFileAdoptionCandidateV1,
): Promise<WorkspaceImpactItemV1[]> {
  const source = rootReviewItem(candidate)
  const chapterIds = await chapterIdsForRootCandidate(projectId, candidate)
  const downstream = chapterIds.sort((left, right) => left - right).map(chapterId => ({
    id: `workspace-impact:${candidate.candidateId}:chapter:${chapterId}`,
    candidateId: candidate.candidateId,
    sourceTable: candidate.tableName,
    sourceRecordId: candidate.recordId,
    targetTable: 'chapters',
    targetRecordId: chapterId,
    action: 'review-downstream-chapter',
    execution: 'manual-review' as const,
    dependencyItemIds: [source.id],
    reason: '根设定可能改变后续生成前提；不得自动重写正文。',
  }))
  return [source, ...downstream]
}

async function chapterCandidateItems(input: {
  projectId: number
  candidate: WorkspaceFileAdoptionCandidateV1
}): Promise<{ items: WorkspaceImpactItemV1[]; graphHash: string }> {
  const chapter = await db.chapters.get(input.candidate.recordId) as (Chapter & { workId?: number }) | undefined
  const work = chapter?.workId == null ? undefined : await db.works.get(chapter.workId)
  if (!chapter || !work) throw new Error(`[memory-impact] Chapter ${input.candidate.recordId} 缺少有效 Work`)
  const scope = { projectId: input.projectId, worldId: work.worldId, workId: work.id! }
  const graph = await buildEditImpactGraphV1(scope, input.candidate.recordId)
  const plan = await buildImpactRemediationPlanV1(graph)
  const idByNode = new Map(plan.items.map(item => [item.nodeId, `workspace-impact:${input.candidate.candidateId}:${item.nodeId}`]))
  return {
    graphHash: graph.graphHash,
    items: plan.items.map(item => ({
      id: idByNode.get(item.nodeId)!,
      candidateId: input.candidate.candidateId,
      sourceTable: input.candidate.tableName,
      sourceRecordId: input.candidate.recordId,
      targetTable: item.table,
      targetRecordId: item.recordId,
      action: item.action,
      execution: executionForImpact(item.action, item.mode),
      dependencyItemIds: item.dependencyNodeIds.map(nodeId => idByNode.get(nodeId)).filter((id): id is string => !!id),
      reason: item.reason,
    })),
  }
}

/**
 * Reuse H50-H81's chapter DAG for chapter edits and registered root emitters
 * for Workspace/World/Work edits. This only plans; it never calls a model or
 * changes Canon.
 */
export async function buildWorkspaceImpactPlanV1(input: {
  projectId: number
  candidateSet: WorkspaceFileCandidateSetV1
}): Promise<WorkspaceImpactPlanV1> {
  if (input.candidateSet.projectId !== input.projectId) throw new Error('[memory-impact] candidate set 项目不匹配')
  await ensureWorkspaceOwnership(input.projectId)
  const items: WorkspaceImpactItemV1[] = []
  const graphHashes: string[] = []
  for (const candidate of input.candidateSet.candidates) {
    const projection = PROJECT_TABLES.find(spec => spec.name === candidate.tableName)?.workspaceProjection
    if (!projection?.dependencyEmitter) throw new Error(`[memory-impact] ${candidate.tableName} 缺少 dependencyEmitter`)
    if (projection.dependencyEmitter === 'chapter-impact-v1') {
      const emitted = await chapterCandidateItems({ projectId: input.projectId, candidate })
      items.push(...emitted.items)
      graphHashes.push(emitted.graphHash)
    } else {
      items.push(...await rootCandidateItems(input.projectId, candidate))
    }
    items.push({
      id: `workspace-impact:${candidate.candidateId}:recovery-capsule`,
      candidateId: candidate.candidateId,
      sourceTable: candidate.tableName,
      sourceRecordId: candidate.recordId,
      targetTable: '__recovery__',
      targetRecordId: input.projectId,
      action: 'rebuild-recovery-capsule',
      execution: 'deterministic-rebuild',
      dependencyItemIds: [],
      reason: '完整恢复胶囊由 PROJECT_TABLES 确定性重建。',
    })
  }
  items.sort((left, right) => left.id.localeCompare(right.id))
  const body = {
    version: 1 as const,
    projectId: input.projectId,
    candidateSetPlanHash: input.candidateSet.planHash,
    sourceCandidateHashes: input.candidateSet.candidates.map(candidate => candidate.candidateHash).sort(),
    graphHashes: [...new Set(graphHashes)].sort(),
    items,
    counts: {
      deterministic: items.filter(item => item.execution === 'deterministic-rebuild').length,
      manualReview: items.filter(item => item.execution === 'manual-review').length,
      generativeCandidate: items.filter(item => item.execution === 'generative-candidate').length,
    },
    zeroModelCalls: true as const,
  }
  return { ...body, planHash: await hashCanonicalValue(body) }
}
