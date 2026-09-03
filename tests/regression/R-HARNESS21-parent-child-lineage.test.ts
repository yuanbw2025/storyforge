import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  deleteAgentRunV1,
  readAgentRunV1,
  staleAgentRunVerificationV1,
} from '../../src/lib/agent/run/event-store'
import {
  buildProseGenerationRunContractV1,
  PROSE_GENERATION_STEP_ID_V1,
} from '../../src/lib/agent/run/prose-generation-durable'
import {
  CHAPTER_POST_ADOPTION_PARENT_RELATION_V1,
  createChapterPostAdoptionDurableRunV1,
  readChapterPostAdoptionChainStatusV1,
  verifyChapterPostAdoptionRunV1,
} from '../../src/lib/agent/run/chapter-post-adoption-durable'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

const CONTENT = '<p>守灯人抵达潮门，点亮了旧灯。</p>'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  chapterId: number
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: label,
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,


    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `world-${label}`, name: `${label}世界`, description: '', currentVersion: 1,
    createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: label, description: '', genres: ['fantasy'], status: 'drafting',
    targetWordCount: 100_000, createdAt: now, updatedAt: now,
  }) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({ projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now }) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'chapter', title: '潮门', summary: '守灯人抵达潮门。', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId, workId, outlineNodeId, title: '潮门', content: CONTENT, wordCount: 15, status: 'draft', order: 0, notes: '',
    createdAt: now, updatedAt: now,
  } as any) as number
  return { scope: { projectId, worldId, workId }, worldGroupId, chapterId }
}

async function completeProseParent(fixture: Awaited<ReturnType<typeof createWorkspace>>) {
  let snapshot = await createAgentRunV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    contract: buildProseGenerationRunContractV1({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      chapterId: fixture.chapterId,
      operation: 'generate',
      semanticReview: false,
    }),
  })
  snapshot = await appendAgentRunEventV1({ scope: fixture.scope, runId: snapshot.run.id, type: 'step.scheduled', payload: { stepId: PROSE_GENERATION_STEP_ID_V1 } })
  snapshot = await appendAgentRunEventV1({ scope: fixture.scope, runId: snapshot.run.id, type: 'step.started', payload: { stepId: PROSE_GENERATION_STEP_ID_V1, attempt: 1 } })
  snapshot = await appendAgentRunEventV1({ scope: fixture.scope, runId: snapshot.run.id, type: 'step.succeeded', payload: { stepId: PROSE_GENERATION_STEP_ID_V1, attempt: 1, outputHash: '1'.repeat(64) } })
  snapshot = await appendAgentRunEventV1({ scope: fixture.scope, runId: snapshot.run.id, type: 'verification.started', payload: { verifierSetVersion: 'prose-generation-terminal-v1' } })
  snapshot = await appendAgentRunEventV1({ scope: fixture.scope, runId: snapshot.run.id, type: 'verification.accepted', payload: { receiptHash: '2'.repeat(64) } })
  return { snapshot, artifactHash: await hashChapterText(CONTENT) }
}

async function completeChild(fixture: Awaited<ReturnType<typeof createWorkspace>>, childId: number) {
  for (const stepId of [
    'chapter-post-adoption:retrieval',
    'chapter-post-adoption:organization',
    'chapter-post-adoption:memory',
  ]) {
    await appendAgentRunEventV1({ scope: fixture.scope, runId: childId, type: 'step.scheduled', payload: { stepId } })
    await appendAgentRunEventV1({ scope: fixture.scope, runId: childId, type: 'step.started', payload: { stepId, attempt: 1 } })
    await appendAgentRunEventV1({ scope: fixture.scope, runId: childId, type: 'step.succeeded', payload: { stepId, attempt: 1, outputHash: '3'.repeat(64) } })
  }
  await appendAgentRunEventV1({ scope: fixture.scope, runId: childId, type: 'verification.started', payload: { verifierSetVersion: 'chapter-post-adoption-terminal-v1' } })
  return appendAgentRunEventV1({ scope: fixture.scope, runId: childId, type: 'verification.accepted', payload: { receiptHash: '4'.repeat(64) } })
}

describe.sequential('R-HARNESS21 · 正文 Run 与章后处理 Run 的父子 lineage', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('创建时绑定父终态回执和正文 hash，并对同一父关系幂等', async () => {
    const fixture = await createWorkspace('lineage-create')
    const parent = await completeProseParent(fixture)
    const input = {
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      chapterId: fixture.chapterId,
      parent: {
        runId: parent.snapshot.run.id,
        receiptHash: parent.snapshot.projection.terminalReceiptHash!,
        artifactHash: parent.artifactHash,
      },
    }
    const first = await createChapterPostAdoptionDurableRunV1(input)
    const second = await createChapterPostAdoptionDurableRunV1(input)
    expect(second.run.id).toBe(first.run.id)
    expect(first.contract.lineage?.parent).toEqual({
      runId: parent.snapshot.run.id,
      receiptHash: '2'.repeat(64),
      relation: CHAPTER_POST_ADOPTION_PARENT_RELATION_V1,
      artifactHash: parent.artifactHash,
    })
    expect(first.run).toMatchObject({
      parentRunId: parent.snapshot.run.id,
      parentRelation: CHAPTER_POST_ADOPTION_PARENT_RELATION_V1,
      parentReceiptHash: '2'.repeat(64),
      parentArtifactHash: parent.artifactHash,
    })
    const chain = await readChapterPostAdoptionChainStatusV1({ scope: fixture.scope, parentRunId: parent.snapshot.run.id })
    expect(chain.state).toBe('downstream-processing')
  })

  it('章节编辑器主路径把正文终态回执和采纳产物传给章后 Run', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/editor/ChapterEditor.tsx'), 'utf8')
    expect(source).toContain('receiptHash: verification.receiptHash')
    expect(source).toContain('artifactHash: durableCandidate.expectedContentHash')
    expect(source).toContain('全链状态：')
  })

  it('父回执失效或正文 hash 变化时拒绝启动，并把已完成子 Run 标记为 stale', async () => {
    const fixture = await createWorkspace('lineage-stale')
    const parent = await completeProseParent(fixture)
    const input = {
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      chapterId: fixture.chapterId,
      parent: { runId: parent.snapshot.run.id, receiptHash: 'f'.repeat(64), artifactHash: parent.artifactHash },
    }
    await expect(createChapterPostAdoptionDurableRunV1(input)).rejects.toThrow('父 Run')

    const child = await createChapterPostAdoptionDurableRunV1({
      ...input,
      parent: { ...input.parent, receiptHash: '2'.repeat(64) },
    })
    await completeChild(fixture, child.run.id)
    await staleAgentRunVerificationV1({ scope: fixture.scope, runId: parent.snapshot.run.id, reason: 'test-parent-stale' })
    await expect(verifyChapterPostAdoptionRunV1({ scope: fixture.scope, runId: child.run.id })).rejects.toThrow('父运行')
    const staleChild = await readAgentRunV1(fixture.scope, child.run.id)
    expect(staleChild.projection.state).toBe('running')
    expect(staleChild.projection.terminalReceiptHash).toBeUndefined()
  })

  it('导入后父键、契约 lineage 一并重映射，旧完成回执按项目边界失效', async () => {
    const fixture = await createWorkspace('lineage-portable')
    const parent = await completeProseParent(fixture)
    const child = await createChapterPostAdoptionDurableRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      chapterId: fixture.chapterId,
      parent: { runId: parent.snapshot.run.id, receiptHash: '2'.repeat(64), artifactHash: parent.artifactHash },
    })
    await completeChild(fixture, child.run.id)
    const importedProjectId = await importProjectJSON(await exportProjectJSON(fixture.scope.projectId))
    const importedScope = {
      projectId: importedProjectId,
      worldId: (await db.worlds.where('projectId').equals(importedProjectId).first())!.id!,
      workId: (await db.works.where('projectId').equals(importedProjectId).first())!.id!,
    }
    const importedRuns = await db.agentRuns.where('projectId').equals(importedProjectId).toArray()
    const importedParent = importedRuns.find(run => run.parentRunId == null)!
    const importedChild = importedRuns.find(run => run.parentRunId === importedParent.id)!
    const childSnapshot = await readAgentRunV1(importedScope, importedChild.id!)
    expect(childSnapshot.contract.lineage?.parent.runId).toBe(importedParent.id)
    expect(importedChild.parentRunId).toBe(importedParent.id)
    expect(childSnapshot.projection.state).toBe('running')
    expect(importedRuns.every(run => run.status !== 'completed')).toBe(true)
  })

  it('删除父 Run 时级联删除子 Run 及双方事件', async () => {
    const fixture = await createWorkspace('lineage-delete')
    const parent = await completeProseParent(fixture)
    const child = await createChapterPostAdoptionDurableRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      chapterId: fixture.chapterId,
      parent: { runId: parent.snapshot.run.id, receiptHash: '2'.repeat(64), artifactHash: parent.artifactHash },
    })
    expect(await deleteAgentRunV1(fixture.scope, parent.snapshot.run.id)).toBe(true)
    expect(await db.agentRuns.get(parent.snapshot.run.id)).toBeUndefined()
    expect(await db.agentRuns.get(child.run.id)).toBeUndefined()
    expect(await db.agentRunEvents.where('runId').anyOf([parent.snapshot.run.id, child.run.id]).count()).toBe(0)
  })
})
