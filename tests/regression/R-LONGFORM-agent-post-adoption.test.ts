import * as entries from '../../src/lib/agent/formal-ai-entry'
import { authorizeChapterPostAdoptionV1, rejectChapterPostAdoptionAuthorizationV1, chapterPostAdoptionChainStateV1 } from '../../src/lib/agent/run/chapter-post-adoption-durable'
import { buildChapterPostAdoptionResumePlanV1 } from '../../src/lib/agent/run/chapter-post-adoption-resume'
import { prepareProseCopilot } from '../../src/lib/agent/prose-copilot'
import { runChapterPostAdoptionV1 } from '../../src/lib/prose/post-adoption-runner'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { htmlToPlainText } from '../../src/lib/utils/html'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { OutlineNode } from '../../src/lib/types'
import * as client from '../../src/lib/ai/client'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { runDurableMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { prepareMasterChapterPostAdoptionV1, recoverLongformPhaseHandoffV1 } from '../../src/lib/agent/master-post-adoption'
import { readLatestChapterPostAdoptionRunV1, createChapterPostAdoptionDurableRunV1 } from '../../src/lib/agent/run/chapter-post-adoption-durable'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import { readLongformProgressV1 } from '../../src/lib/agent/longform-progress'
import { readLatestChapterOrganizationRun } from '../../src/lib/agent/chapter-organization'

async function prepare(memoryOnly: boolean | 'organization' = false) {
  const fixture = await seedCurrentWorkspace('主 Agent 章后交接')
  if (memoryOnly) await db.works.update(fixture.scope.workId, { postAdoptionTaskTypes: [memoryOnly === 'organization' ? 'organization' : 'memory'] })
  await db.outlineNodes.add(stampNewRecord(fixture.scope, 'outlineNodes', { parentId: null, type: 'chapter', title: '第一章', summary: '守灯人沿潮痕寻找旧信，面对邮差拒绝承认的证据。', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode)
  const plan = await createMasterAgentPlan({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, request: '写第一章正文' })
  const conversation = await getOrCreateAgentConversation({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, purpose: 'master-authoring' })
  const text = '守灯人沿着潮痕来到邮局，柜台后的邮差把登记簿藏到身后。他递出旧信，要求查验那枚仍然温热的印章。邮差摇头，说这座城十年前已经不用这样的邮戳。门外的钟声骤然中断，守灯人听见失踪亲人的敲门声。'
  const model = vi.spyOn(client, 'chat').mockResolvedValue(text)
  const result = await runDurableMasterAgentPlanV1({ scope: fixture.scope, worldGroupId: null, conversationId: conversation.id!, plan })
  return { ...fixture, result, model }
}
describe.sequential('longform main Agent chapter post-adoption handoff', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('skipping optional post-adoption is a persistent terminal choice, not a retryable failure', async () => {
    const fixture = await prepare()
    await commitMasterAgentCandidateAdoptionV1({ scope: fixture.scope, runId: fixture.result.runId, candidateEventId: fixture.result.candidates[0].event.id!, worldGroupId: null })
    await verifyMasterAgentRunV1({ scope: fixture.scope, runId: fixture.result.runId })
    await prepareMasterChapterPostAdoptionV1({ scope: fixture.scope, runId: fixture.result.runId })
    const chapter = (await db.chapters.toArray())[0]
    const child = (await readLatestChapterPostAdoptionRunV1({ scope: fixture.scope, chapterId: chapter.id! }))!
    await db.outlineNodes.add(stampNewRecord(fixture.scope, 'outlineNodes', { parentId: null, type: 'chapter', title: '第二章', summary: '', order: 1, createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode)
    const nextChapter = { projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, authorRequest: '写第二章正文，守灯人拆开旧信。' }
    await expect(prepareProseCopilot(nextChapter)).rejects.toThrow('章后处理尚未完成')
    await rejectChapterPostAdoptionAuthorizationV1({ scope: fixture.scope, snapshot: child })
    const stored = await readAgentRunV1(fixture.scope, child.run.id)
    expect(stored.projection.state).toBe('cancelled')
    expect(chapterPostAdoptionChainStateV1(stored)).toBe('downstream-skipped')
    expect(buildChapterPostAdoptionResumePlanV1(stored)).toMatchObject({ terminal: true, canResume: false })
    const legacy = { ...stored, projection: { ...stored.projection, state: 'paused' as const } }
    expect(chapterPostAdoptionChainStateV1(legacy)).toBe('downstream-skipped')
    expect(buildChapterPostAdoptionResumePlanV1(legacy)).toMatchObject({ terminal: true, canResume: false })
    const model = vi.spyOn(entries, 'executeRegisteredAIEntryV1')
    await runChapterPostAdoptionV1({ project: fixture.project, aiConfig: useAIConfigStore.getState().config, task: { chapterId: chapter.id!, chapterTitle: chapter.title, chapterContent: chapter.content, chapterPlainText: htmlToPlainText(chapter.content), resumeRunId: child.run.id } })
    expect(model).not.toHaveBeenCalled()
    expect((await db.chapters.get(chapter.id!))?.content).toBe(chapter.content)
    await expect(prepareProseCopilot(nextChapter)).resolves.toBeDefined()
  })
  it.each(['organization', 'memory'] as const)('retries only the failed %s step with matching attempt evidence', async taskType => {
    const fixture = await prepare(taskType === 'memory' ? true : 'organization')
    await commitMasterAgentCandidateAdoptionV1({ scope: fixture.scope, runId: fixture.result.runId, candidateEventId: fixture.result.candidates[0].event.id!, worldGroupId: null })
    await verifyMasterAgentRunV1({ scope: fixture.scope, runId: fixture.result.runId })
    await prepareMasterChapterPostAdoptionV1({ scope: fixture.scope, runId: fixture.result.runId })
    const chapter = (await db.chapters.toArray())[0]
    const child = (await readLatestChapterPostAdoptionRunV1({ scope: fixture.scope, chapterId: chapter.id! }))!
    await authorizeChapterPostAdoptionV1({ scope: fixture.scope, snapshot: child, source: 'author-click' })
    const model = vi.spyOn(entries, 'executeRegisteredAIEntryV1')
      .mockRejectedValueOnce(new Error('临时服务错误'))
      .mockResolvedValue(taskType === 'organization' ? '{}' : JSON.stringify({
        summary: '守灯人在邮局查验旧信，发现邮戳异常。',
        handoff: { finalScene: { location: '邮局', activeCharacters: ['守灯人'], lastAction: '听见敲门声' }, stateChanges: [], knowledgeChanges: [], commitments: [], openLoops: ['旧信是谁寄的'], immediateNextIntent: '查明敲门声', evidenceQuotes: [{ quote: '门外的钟声骤然中断，守灯人听见失踪亲人的敲门声。' }] },
      }))
    const errors: string[] = []
    const phases: string[] = []
    const input = {
      project: fixture.project, aiConfig: useAIConfigStore.getState().config,
      task: { chapterId: chapter.id!, chapterTitle: chapter.title, chapterContent: chapter.content, chapterPlainText: htmlToPlainText(chapter.content), resumeRunId: child.run.id },
      callbacks: { onError: (error: string) => { errors.push(error) }, onPhase: (phase: string) => { phases.push(phase) } },
    }
    await runChapterPostAdoptionV1(input)
    expect(model).toHaveBeenCalledOnce()
    errors.length = 0
    await runChapterPostAdoptionV1(input)
    expect(errors).toEqual([])
    expect(model).toHaveBeenCalledTimes(2)
    const resumed = await readAgentRunV1(fixture.scope, child.run.id)
    expect(resumed.projection.steps[`chapter-post-adoption:${taskType}`].attempt).toBe(2)
    if (taskType === 'organization') {
      const organization = await readLatestChapterOrganizationRun({ projectId: fixture.project.id!, chapterId: chapter.id! })
      expect(organization?.candidate.durable?.attempt).toBe(2)
    } else {
      expect(resumed.projection.state).toBe('completed')
      expect(phases).toEqual(['memory', 'idle', 'memory', 'idle'])
    }
    await runChapterPostAdoptionV1(input)
    expect(model).toHaveBeenCalledTimes(2)
    expect((await db.chapters.get(chapter.id!))?.content).toBe(chapter.content)
  })
  it('requires phase verification, links the exact chapter, and repeated preparation makes no model call', async () => {
    const fixture = await prepare()
    await expect(prepareMasterChapterPostAdoptionV1({ scope: fixture.scope, runId: fixture.result.runId })).rejects.toThrow('尚未通过')
    await commitMasterAgentCandidateAdoptionV1({ scope: fixture.scope, runId: fixture.result.runId, candidateEventId: fixture.result.candidates[0].event.id!, worldGroupId: null })
    expect((await verifyMasterAgentRunV1({ scope: fixture.scope, runId: fixture.result.runId })).accepted).toBe(true)
    const calls = fixture.model.mock.calls.length
    const messages = await prepareMasterChapterPostAdoptionV1({ scope: fixture.scope, runId: fixture.result.runId })
    expect(messages.join('')).toContain('待授权')
    const chapter = (await db.chapters.toArray())[0]
    const child = await readLatestChapterPostAdoptionRunV1({ scope: fixture.scope, chapterId: chapter.id! })
    expect(child?.contract.lineage?.parent.runId).toBe(fixture.result.runId)
    expect(child?.contract.lineage?.parent.relation).toBe(`prose-post-adoption:${chapter.id}`)
    await prepareMasterChapterPostAdoptionV1({ scope: fixture.scope, runId: fixture.result.runId })
    expect(fixture.model).toHaveBeenCalledTimes(calls)
    expect((await readLongformProgressV1(fixture.scope, null)).written).toBe(1)
    expect((await db.works.get(fixture.scope.workId))?.status).not.toBe('completed')
    const otherId = await db.chapters.add({ ...chapter, id: undefined, outlineNodeId: 999, content: '<p>另一个章节</p>' })
    await expect(createChapterPostAdoptionDurableRunV1({ scope: fixture.scope, worldGroupId: null, chapterId: otherId, parent: { runId: fixture.result.runId, receiptHash: child!.contract.lineage!.parent.receiptHash, artifactHash: await hashChapterText('<p>另一个章节</p>') } })).rejects.toThrow('没有该章节')
  })
  it('recovers a crash after adoption verification without calling a model or duplicating the handoff', async () => {
    const fixture = await prepare()
    await commitMasterAgentCandidateAdoptionV1({ scope: fixture.scope, runId: fixture.result.runId, candidateEventId: fixture.result.candidates[0].event.id!, worldGroupId: null })
    await verifyMasterAgentRunV1({ scope: fixture.scope, runId: fixture.result.runId })
    const run = await readAgentRunV1(fixture.scope, fixture.result.runId)
    const calls = fixture.model.mock.calls.length
    await recoverLongformPhaseHandoffV1(fixture.scope, run.run.conversationId!)
    const chapter = (await db.chapters.toArray())[0]
    const child = await readLatestChapterPostAdoptionRunV1({ scope: fixture.scope, chapterId: chapter.id! })
    expect(child?.contract.lineage?.parent.runId).toBe(fixture.result.runId)
    const events = await db.agentEvents.count()
    await recoverLongformPhaseHandoffV1(fixture.scope, run.run.conversationId!)
    expect(await db.agentEvents.count()).toBe(events)
    expect(fixture.model).toHaveBeenCalledTimes(calls)
  })
  it('authorizes and runs the shared memory step once, persists its real CAS result, and restores completion', async () => {
    const fixture = await prepare(true)
    await commitMasterAgentCandidateAdoptionV1({ scope: fixture.scope, runId: fixture.result.runId, candidateEventId: fixture.result.candidates[0].event.id!, worldGroupId: null })
    await verifyMasterAgentRunV1({ scope: fixture.scope, runId: fixture.result.runId })
    await prepareMasterChapterPostAdoptionV1({ scope: fixture.scope, runId: fixture.result.runId })
    const chapter = (await db.chapters.toArray())[0]
    const child = (await readLatestChapterPostAdoptionRunV1({ scope: fixture.scope, chapterId: chapter.id! }))!
    await authorizeChapterPostAdoptionV1({ scope: fixture.scope, snapshot: child, source: 'author-click' })
    const model = vi.spyOn(entries, 'executeRegisteredAIEntryV1').mockResolvedValue(JSON.stringify({ summary: '守灯人在邮局查验旧信，发现邮戳异常。', handoff: { finalScene: { location: '邮局', activeCharacters: ['守灯人'], lastAction: '听见敲门声' }, stateChanges: [], knowledgeChanges: [], commitments: [], openLoops: ['旧信是谁寄的'], immediateNextIntent: '查明敲门声', evidenceQuotes: [{ quote: '门外的钟声骤然中断，守灯人听见失踪亲人的敲门声。' }] } }))
    const errors: string[] = []
    const task = { chapterId: chapter.id!, chapterTitle: chapter.title, chapterContent: chapter.content, chapterPlainText: htmlToPlainText(chapter.content), resumeRunId: child.run.id }
    await runChapterPostAdoptionV1({ project: fixture.project, aiConfig: useAIConfigStore.getState().config, task, callbacks: { onError: error => errors.push(error) } })
    expect(errors).toEqual([])
    expect(model).toHaveBeenCalledOnce()
    expect((await db.chapters.get(chapter.id!))?.summary).toContain('查验旧信')
    expect((await readAgentRunV1(fixture.scope, child.run.id)).projection.state).toBe('completed')
    await runChapterPostAdoptionV1({ project: fixture.project, aiConfig: useAIConfigStore.getState().config, task })
    expect(model).toHaveBeenCalledOnce()
  })

})
