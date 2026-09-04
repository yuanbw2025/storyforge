import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { generateDocumentId, generateWorkspaceUid } from '../../src/lib/memory/identity'
import { buildWorkspaceImpactPlanV1 } from '../../src/lib/memory/workspace-impact'
import type { WorkspaceFileAdoptionCandidateV1, WorkspaceFileCandidateSetV1 } from '../../src/lib/types'
import {
  addCurrentWorldFixtureV1,
  addCurrentWorkFixtureV1,
  seedCurrentWorkspace,
} from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const HASH = 'a'.repeat(64)

function candidate(input: Partial<WorkspaceFileAdoptionCandidateV1> & Pick<WorkspaceFileAdoptionCandidateV1, 'tableName' | 'recordId'>): WorkspaceFileAdoptionCandidateV1 {
  const documentId = generateDocumentId()
  return {
    version: 1,
    candidateId: `MEMORY-CANDIDATE-${documentId}`,
    candidateHash: HASH,
    planHash: 'b'.repeat(64),
    identity: { version: 1, workspaceUid: generateWorkspaceUid(), documentId, documentKind: input.tableName },
    tableName: input.tableName,
    recordId: input.recordId,
    relativePath: `${documentId}.yaml`,
    changedFields: ['description'],
    patch: { description: 'changed' },
    compareAndSetFields: ['description'],
    compareAndSetExpectedHash: 'c'.repeat(64),
    baselineCanonicalHash: HASH,
    databaseCanonicalHash: HASH,
    fileCanonicalHash: 'd'.repeat(64),
    createdAt: 1,
    ...input,
  }
}

function candidateSet(projectId: number, candidates: WorkspaceFileAdoptionCandidateV1[]): WorkspaceFileCandidateSetV1 {
  return {
    version: 1,
    projectId,
    planHash: 'b'.repeat(64),
    candidates,
    blockedDocumentIds: [],
    createdAt: 1,
    zeroModelCalls: true,
  }
}

describe('MEMORY-7 · workspace changes reuse the governed impact DAG', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('emits a deterministic Work-scoped plan and never crosses into another Work', async () => {
    const now = Date.now()
    const first = await seedCurrentWorkspace('影响图', { enableMultiWorld: true })
    const projectId = first.scope.projectId
    const secondWorld = await addCurrentWorldFixtureV1({ projectId, name: '第二世界', now })
    const secondWork = await addCurrentWorkFixtureV1({
      projectId,
      worldId: secondWorld.id!,
      create: { title: '第二作品', targetWordCount: 10 },
      now,
    })
    const secondWorkId = secondWork.id!
    const firstOutline = await db.outlineNodes.add({
      projectId, workId: first.scope.workId, parentId: null, type: 'chapter', title: '一', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const secondOutline = await db.outlineNodes.add({
      projectId, workId: secondWorkId, parentId: null, type: 'chapter', title: '二', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const firstChapterId = await db.chapters.add({
      projectId, workId: first.scope.workId, outlineNodeId: firstOutline, title: '一', content: '<p>一</p>',
      wordCount: 1, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
    } as any) as number
    const secondChapterId = await db.chapters.add({
      projectId, workId: secondWorkId, outlineNodeId: secondOutline, title: '二', content: '<p>二</p>',
      wordCount: 1, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
    } as any) as number
    await finalizeCurrentFixtureV1(projectId)

    const set = candidateSet(projectId, [candidate({ tableName: 'works', recordId: first.scope.workId })])
    const firstPlan = await buildWorkspaceImpactPlanV1({ projectId, candidateSet: set })
    const secondPlan = await buildWorkspaceImpactPlanV1({ projectId, candidateSet: set })
    expect(firstPlan.planHash).toBe(secondPlan.planHash)
    expect(firstPlan.zeroModelCalls).toBe(true)
    expect(firstPlan.items.some(item => item.targetRecordId === firstChapterId)).toBe(true)
    expect(firstPlan.items.some(item => item.targetRecordId === secondChapterId)).toBe(false)
    expect(firstPlan.counts.deterministic).toBe(1)
  })

  it('reuses the H50-H81 chapter graph and separates deterministic, manual and generative policies', async () => {
    const now = Date.now()
    const owned = await seedCurrentWorkspace('章节影响')
    const projectId = owned.scope.projectId
    const firstOutline = await db.outlineNodes.add({
      projectId, workId: owned.scope.workId, parentId: null, type: 'chapter', title: '一', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const secondOutline = await db.outlineNodes.add({
      projectId, workId: owned.scope.workId, parentId: null, type: 'chapter', title: '二', summary: '旧章纲', order: 1,
      createdAt: now, updatedAt: now,
    } as any) as number
    const firstChapterId = await db.chapters.add({
      projectId, workId: owned.scope.workId, outlineNodeId: firstOutline, title: '一', content: '<p>一</p>',
      wordCount: 1, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
    } as any) as number
    await db.chapters.add({
      projectId, workId: owned.scope.workId, outlineNodeId: secondOutline, title: '二', content: '<p>二</p>',
      wordCount: 1, status: 'draft', order: 1, notes: '', createdAt: now, updatedAt: now,
    } as any)
    await db.narrativeSummaryNodes.add({
      projectId, workId: owned.scope.workId, level: 'book', title: '全书', summary: '旧摘要', status: 'stale',
      sourceHash: HASH, createdAt: now, updatedAt: now,
    } as any)
    await finalizeCurrentFixtureV1(projectId)

    const chapterCandidate = candidate({
      tableName: 'chapters', recordId: firstChapterId,
      changedFields: ['content', 'wordCount'], patch: { content: '<p>改</p>', wordCount: 1 },
      compareAndSetFields: ['content', 'wordCount'],
    })
    const plan = await buildWorkspaceImpactPlanV1({ projectId, candidateSet: candidateSet(projectId, [chapterCandidate]) })
    expect(plan.graphHashes).toHaveLength(1)
    expect(plan.counts.deterministic).toBeGreaterThan(0)
    expect(plan.counts.manualReview).toBeGreaterThan(0)
    expect(plan.counts.generativeCandidate).toBeGreaterThan(0)
    expect(plan.items.some(item => item.action === 'review-outline')).toBe(true)
  })
})
