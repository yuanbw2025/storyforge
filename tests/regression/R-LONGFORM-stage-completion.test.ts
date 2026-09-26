import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { Chapter, OutlineNode, Character } from '../../src/lib/types'
import { splitLongformPlanAtChapterV1 } from '../../src/lib/agent/longform-stage-queue'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { readLongformCompletionV1, commitLongformCompletionV1 } from '../../src/lib/longform/completion'
import { seedCurrentMasterCandidate } from '../helpers/current-master-candidate'
import { rejectMasterAgentCandidateV1 } from '../../src/lib/agent/run/master-adoption'

describe.sequential('longform phase boundaries and whole-work acceptance', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('explicit rejection does not trap manuscript completion; pending or corrupted evidence still blocks', async () => {
    const fixture = await seedCurrentMasterCandidate('拒绝后的完稿验收')
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(fixture.scope, 'outlineNodes', { type: 'chapter', parentId: null, order: 0, title: '终章', summary: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode)
    await db.chapters.add(stampNewRecord(fixture.scope, 'chapters', { outlineNodeId, title: '终章', content: '<p>他终于回到故乡。</p>', wordCount: 8, status: 'final', order: 0, notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as Chapter)
    expect((await readLongformCompletionV1(fixture.scope)).unfinishedRuns).toBe(1)
    const runId = fixture.candidate.payload.runId!
    await rejectMasterAgentCandidateV1({ scope: fixture.scope, worldGroupId: null, runId, candidateEventId: fixture.candidate.event.id! })
    const ready = await readLongformCompletionV1(fixture.scope)
    expect(ready).toMatchObject({ ready: true, unfinishedRuns: 0 })
    await commitLongformCompletionV1(fixture.scope, ready.contentHash)
    expect((await db.works.get(fixture.scope.workId))?.status).toBe('completed')
    await db.agentRuns.update(runId, { projectionHash: 'tampered' })
    expect((await readLongformCompletionV1(fixture.scope)).unfinishedRuns).toBe(1)
  })
  it('retains every later task while splitting at the first chapter for post-adoption processing', () => {
    const result = splitLongformPlanAtChapterV1({ summary: '写两章', workflow: { version: 1, workflowId: 'staged-author-confirmed', reasonCodes: ['multiple-explicit-domains'] }, tasks: [
      { id: 'first', agentId: 'prose', skillId: 'prose.generate', instruction: '写第一章正文', dependsOn: [] },
      { id: 'second', agentId: 'prose', skillId: 'prose.generate', instruction: '写第二章正文', dependsOn: ['first'] },
    ] })
    expect(result.current.tasks.map(task => task.id)).toEqual(['first'])
    expect(result.remaining?.tasks.map(task => task.id)).toEqual(['second'])
    expect(result.remaining?.tasks[0].dependsOn).toEqual([])
  })
  it('binds an existing named character and requested dimensions without creating another character', async () => {
    const fixture = await seedCurrentWorkspace('角色目标')
    const characterId = await db.characters.add(stampNewRecord(fixture.scope, 'characters', { name: '守灯人', roleWeight: 'main', background: '', createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as Character)
    const plan = await createMasterAgentPlan({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, request: '补全角色守灯人的背景故事' })
    expect(plan.tasks[0].skillId).toBe('character.supplement')
    expect(plan.tasks[0].characterSupplementRequest).toEqual({ characterId, dimensions: ['background'], useEvidence: true })
    await expect(createMasterAgentPlan({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, request: '补全角色不存在者的背景故事' })).rejects.toThrow('明确一个角色姓名')
    expect(await db.characters.count()).toBe(1)
  })
  it('rejects empty or stale manuscripts and marks only the scoped work complete after coverage passes', async () => {
    const fixture = await seedCurrentWorkspace('完稿验收')
    const first = await readLongformCompletionV1(fixture.scope)
    expect(first.ready).toBe(false)
    await expect(commitLongformCompletionV1(fixture.scope, first.contentHash)).rejects.toThrow()
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(fixture.scope, 'outlineNodes', { type: 'chapter', parentId: null, order: 0, title: '终章', summary: '返回故乡', createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode)
    const chapterId = await db.chapters.add(stampNewRecord(fixture.scope, 'chapters', { outlineNodeId, title: '终章', content: '<p>他终于回到故乡。</p>', wordCount: 8, status: 'final', order: 0, notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as Chapter)
    const ready = await readLongformCompletionV1(fixture.scope)
    expect(ready.ready).toBe(true)
    await db.chapters.update(chapterId, { content: '<p>作者又修改了结局。</p>' })
    await expect(commitLongformCompletionV1(fixture.scope, ready.contentHash)).rejects.toThrow('已变化')
    const final = await readLongformCompletionV1(fixture.scope)
    await commitLongformCompletionV1(fixture.scope, final.contentHash)
    expect((await db.works.get(fixture.scope.workId))?.status).toBe('completed')
    expect((await db.projects.get(fixture.project.id!)) as unknown as Record<string, unknown>).not.toHaveProperty('status')
  })
})
