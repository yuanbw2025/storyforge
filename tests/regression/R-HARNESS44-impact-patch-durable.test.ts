import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import {
  adoptImpactPatchCandidateV1,
  createImpactPatchCandidateV1,
  readLatestImpactPatchCandidateV1,
  rejectImpactPatchCandidateV1,
} from '../../src/lib/agent/run/impact-patch-durable'

async function seed(): Promise<{
  scope: WorkspaceScope
  sourceChapterId: number
  downstreamOutlineId: number
  worldGroupId: number
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '影响修订', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 100_000,
    createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({ projectId, code: 'patch-world', name: '主世界', description: '', currentVersion: 1, createdAt: now, updatedAt: now }) as number
  const workId = await db.works.add({ projectId, worldId, title: '影响修订', description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({ projectId, name: '主世界', order: 0, createdAt: now, updatedAt: now }) as number
  const volumeId = await db.outlineNodes.add({ projectId, workId, worldGroupId, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number
  const sourceOutlineId = await db.outlineNodes.add({ projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '潮门', summary: '潮门初见', order: 0, createdAt: now, updatedAt: now } as any) as number
  const downstreamOutlineId = await db.outlineNodes.add({ projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '迁徙', summary: '等待后续安排', order: 1, createdAt: now, updatedAt: now } as any) as number
  const sourceChapterId = await db.chapters.add({ projectId, workId, outlineNodeId: sourceOutlineId, title: '潮门', content: '<p>守灯人看见潮水。</p>', wordCount: 8, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now } as any) as number
  await db.chapters.add({ projectId, workId, outlineNodeId: downstreamOutlineId, title: '迁徙', content: '', wordCount: 0, status: 'outline', order: 1, notes: '', createdAt: now, updatedAt: now } as any)
  return { scope: { projectId, worldId, workId }, sourceChapterId, downstreamOutlineId, worldGroupId }
}

describe.sequential('R-HARNESS44 · 影响 patch 候选与作者确认写回', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('候选只进入 Agent 事件流，确认后才经 adopt 写入大纲摘要并签发回执', async () => {
    const fixture = await seed()
    const created = await createImpactPatchCandidateV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      sourceChapterId: fixture.sourceChapterId,
      proposal: {
        target: 'outlineNodes',
        recordId: fixture.downstreamOutlineId,
        fields: { summary: '守灯人发现潮门变化后，迁徙名单争议提前爆发。' },
        reason: '来源章节改变了后续迁徙动机。',
        evidenceRefs: [`chapter:${fixture.sourceChapterId}`],
      },
    })
    expect(created.snapshot.projection.steps['impact-patch:apply']?.status).toBe('awaiting_confirmation')
    expect((await db.outlineNodes.get(fixture.downstreamOutlineId))?.summary).toBe('等待后续安排')
    expect(created.event.durableRunId).toBe(created.snapshot.run.id)
    expect(await readLatestImpactPatchCandidateV1({
      scope: fixture.scope,
      sourceChapterId: fixture.sourceChapterId,
    })).toEqual(created.candidate)

    const adopted = await adoptImpactPatchCandidateV1({ scope: fixture.scope, candidate: created.candidate })
    expect((await db.outlineNodes.get(fixture.downstreamOutlineId))?.summary).toBe(
      created.candidate.proposal.fields.summary,
    )
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.receiptHash).toHaveLength(64)
  })

  it('源正文变化时拒绝写回，候选 hash 被篡改时也拒绝写回', async () => {
    const fixture = await seed()
    const created = await createImpactPatchCandidateV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      sourceChapterId: fixture.sourceChapterId,
      proposal: {
        target: 'outlineNodes',
        recordId: fixture.downstreamOutlineId,
        fields: { summary: '不应写入。' },
        reason: '测试过期候选。',
        evidenceRefs: [],
      },
    })
    await db.chapters.update(fixture.sourceChapterId, { content: '<p>正文已改变。</p>' })
    expect(await readLatestImpactPatchCandidateV1({
      scope: fixture.scope,
      sourceChapterId: fixture.sourceChapterId,
    })).toBeNull()
    await expect(adoptImpactPatchCandidateV1({ scope: fixture.scope, candidate: created.candidate })).rejects.toThrow('候选已过期')
    expect((await db.outlineNodes.get(fixture.downstreamOutlineId))?.summary).toBe('等待后续安排')

    const tampered = structuredClone(created.candidate)
    tampered.proposal.fields.summary = '篡改后的摘要。'
    await expect(adoptImpactPatchCandidateV1({ scope: fixture.scope, candidate: tampered })).rejects.toThrow('候选 hash 不匹配')
    expect((await db.outlineNodes.get(fixture.downstreamOutlineId))?.summary).toBe('等待后续安排')
  })

  it('目标带作者锁时不允许通过反向 patch 写回', async () => {
    const fixture = await seed()
    const created = await createImpactPatchCandidateV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      sourceChapterId: fixture.sourceChapterId,
      proposal: {
        target: 'outlineNodes',
        recordId: fixture.downstreamOutlineId,
        fields: { summary: '锁定节点不应被改写。' },
        reason: '验证作者锁边界。',
        evidenceRefs: [],
      },
    })
    await db.outlineNodes.update(fixture.downstreamOutlineId, { locked: true } as any)
    await expect(adoptImpactPatchCandidateV1({ scope: fixture.scope, candidate: created.candidate })).rejects.toThrow('已锁定')
    expect((await db.outlineNodes.get(fixture.downstreamOutlineId))?.summary).toBe('等待后续安排')
  })

  it('作者拒绝会结束候选步骤并保持正式大纲不变', async () => {
    const fixture = await seed()
    const created = await createImpactPatchCandidateV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      sourceChapterId: fixture.sourceChapterId,
      proposal: {
        target: 'outlineNodes',
        recordId: fixture.downstreamOutlineId,
        fields: { summary: '作者拒绝的摘要。' },
        reason: '验证拒绝边界。',
        evidenceRefs: [],
      },
    })
    const rejected = await rejectImpactPatchCandidateV1({ scope: fixture.scope, candidate: created.candidate })
    expect(rejected.projection.steps['impact-patch:apply']).toMatchObject({
      status: 'failed',
      confirmation: 'reject',
    })
    expect(await readLatestImpactPatchCandidateV1({
      scope: fixture.scope,
      sourceChapterId: fixture.sourceChapterId,
    })).toBeNull()
    expect((await db.outlineNodes.get(fixture.downstreamOutlineId))?.summary).toBe('等待后续安排')
  })
})
