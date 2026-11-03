import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import type { WorkspaceScope } from '../../src/lib/types'
import {
  adoptImpactPatchCandidateV1,
  createImpactPatchCandidateV1,
  readLatestImpactPatchCandidateV1,
  rejectImpactPatchCandidateV1,
} from '../../src/lib/agent/run/impact-patch-durable'
import { seedCurrentWorkspace } from '../helpers/current-workspace'


function faultAdoptionEvent(type: string) {
  const original = db.agentRunEvents.add.bind(db.agentRunEvents)
  return vi.spyOn(db.agentRunEvents, 'add').mockImplementation((record, key) => {
    if (record.type === type) return Dexie.Promise.reject(new Error(`036 native storage fault: ${type}`))
    return original(record, key)
  })
}

async function seed(): Promise<{
  scope: WorkspaceScope
  sourceChapterId: number
  downstreamOutlineId: number
  worldGroupId: number
}> {
  const now = Date.now()
  const createdWorkspaceV1 = await seedCurrentWorkspace('影响修订')
  const { projectId, worldId, workId } = createdWorkspaceV1.scope
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

  afterEach(() => { vi.restoreAllMocks(); db.close() })

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
  it.each(['confirmation.recorded', 'adoption.started', 'adoption.committed', 'step.succeeded',
    'verification.started', 'verification.accepted', 'memory.settlement.recorded'])(
    '036 原生 %s 失败时 patch 与事件全回滚，原候选恢复后只写一次', async boundary => {
      const fixture = await seed()
      const created = await createImpactPatchCandidateV1({
        scope: fixture.scope, worldGroupId: fixture.worldGroupId, sourceChapterId: fixture.sourceChapterId,
        proposal: { target: 'outlineNodes', recordId: fixture.downstreamOutlineId,
          fields: { summary: '036 原确认摘要' }, reason: '原确认恢复', evidenceRefs: [] },
      })
      const input = { scope: fixture.scope, candidate: created.candidate }
      const before = await db.outlineNodes.get(fixture.downstreamOutlineId)
      const runBefore = await readAgentRunV1(fixture.scope, created.snapshot.run.id)
      const fault = faultAdoptionEvent(boundary)
      await expect(adoptImpactPatchCandidateV1(input)).rejects.toThrow(`036 native storage fault: ${boundary}`)
      fault.mockRestore()
      expect(await db.outlineNodes.get(fixture.downstreamOutlineId)).toEqual(before)
      expect(await readAgentRunV1(fixture.scope, created.snapshot.run.id)).toEqual(runBefore)
      expect(await readLatestImpactPatchCandidateV1({ scope: fixture.scope, sourceChapterId: fixture.sourceChapterId }))
        .toEqual(created.candidate)
      const done = await adoptImpactPatchCandidateV1(input)
      expect(done.snapshot.projection.state).toBe('completed')
      const formal = await db.outlineNodes.get(fixture.downstreamOutlineId)
      expect((await adoptImpactPatchCandidateV1(input)).receiptHash).toBe(done.receiptHash)
      expect(await db.outlineNodes.get(fixture.downstreamOutlineId)).toEqual(formal)
    },
  )

  it('036 目标摘要被作者改动后不得凭未变的影响图覆盖，也不得补造旧目标基线', async () => {
    const fixture = await seed()
    const created = await createImpactPatchCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, sourceChapterId: fixture.sourceChapterId,
      proposal: { target: 'outlineNodes', recordId: fixture.downstreamOutlineId,
        fields: { summary: '旧确认摘要' }, reason: '防止覆盖', evidenceRefs: [] },
    })
    await db.outlineNodes.update(fixture.downstreamOutlineId, { summary: '作者在生成后保存的新摘要' })
    await expect(adoptImpactPatchCandidateV1({ scope: fixture.scope, candidate: created.candidate }))
      .rejects.toThrow('正式数据已变化')
    expect((await db.outlineNodes.get(fixture.downstreamOutlineId))?.summary).toBe('作者在生成后保存的新摘要')
  })

})
