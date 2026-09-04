import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getOrCreateAgentConversation, appendAgentEvent } from '../../src/lib/agent/conversations'
import { createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { buildMasterAgentRunContractV1 } from '../../src/lib/agent/run/master-durable'
import { appendMasterAgentImpactReportV1 } from '../../src/lib/agent/run/master-impact'
import { parseAgentEventPayload } from '../../src/lib/types/agent-session'
import type { MasterAgentDurableCandidateV1 } from '../../src/lib/agent/run/master-durable'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

async function createWorkspace(): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  firstOutlineId: number
  firstChapterId: number
  downstreamChapterId: number
}> {
  const now = Date.now()
  const createdWorkspaceV1 = await seedCurrentWorkspace('正文影响报告')
  const { projectId, worldId, workId } = createdWorkspaceV1.scope
  const worldGroupId = await db.worldGroups.add({
    projectId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  const volumeId = await db.outlineNodes.add({
    projectId,
    worldId: null,
    workId,
    worldGroupId,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const firstOutlineId = await db.outlineNodes.add({
    projectId,
    worldId: null,
    workId,
    worldGroupId,
    parentId: volumeId,
    type: 'chapter',
    title: '潮门之夜',
    summary: '守灯人发现旧城将被潮水吞没。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const downstreamOutlineId = await db.outlineNodes.add({
    projectId,
    worldId: null,
    workId,
    worldGroupId,
    parentId: volumeId,
    type: 'chapter',
    title: '迁徙名单',
    summary: '城中人开始争夺迁徙名额。',
    order: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const firstChapterId = await db.chapters.add({
    projectId,
    workId,
    outlineNodeId: firstOutlineId,
    title: '潮门之夜',
    content: '<p>守灯人看见潮水越过旧城的石阶。</p>',
    wordCount: 20,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const downstreamChapterId = await db.chapters.add({
    projectId,
    workId,
    outlineNodeId: downstreamOutlineId,
    title: '迁徙名单',
    content: '<p>城中人围在广场等待名单。</p>',
    wordCount: 15,
    status: 'draft',
    order: 1,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return { scope: { projectId, worldId, workId }, worldGroupId, firstOutlineId, firstChapterId, downstreamChapterId }
}

describe.sequential('R-HARNESS3-master-impact-report · 采纳后的上下游反馈', { timeout: 15_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('正文采纳后的报告把来源事实和后续章节反馈到同一 Agent 证据流', async () => {
    const fixture = await createWorkspace()
    const factId = await db.temporalFacts.add({
      projectId: fixture.scope.projectId,
      workId: fixture.scope.workId,
      worldGroupId: fixture.worldGroupId,
      characterId: null,
      subjectName: '守灯人',
      predicate: 'location',
      factKind: 'state',
      value: '旧城石阶',
      sourceType: 'chapter',
      sourceChapterId: fixture.firstChapterId,
      sourceQuote: '潮水越过旧城的石阶',
      validFromChapterId: fixture.firstChapterId,
      validToChapterId: null,
      status: 'confirmed',
      locked: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any) as number
    const conversation = await getOrCreateAgentConversation({
      purpose: 'test:r-harness3-master-impact-report:1',
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
    })
    const contract = buildMasterAgentRunContractV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      plan: {
        summary: '正文影响报告测试',
        tasks: [{ id: 'prose-1', agentId: 'prose', skillId: 'prose.write', instruction: '写正文', dependsOn: [] }],
        workflow: { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] },
      },
      budgetEvidence: {
        profile: 'balanced',
        maxTokens: 160_000,
        maxCalls: 7,
        maxCanonRetries: 1,
        usedTokens: 0,
        calls: 0,
        canonRetries: 0,
      },
    })
    const run = await createAgentRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      contract,
    })
    const event = await appendAgentEvent({
      projectId: fixture.scope.projectId,
      conversationId: conversation.id!,
      kind: 'candidate',
      content: '候选正文',
      payload: {
        version: 1,
        taskId: 'prose-1',
        agentId: 'prose',
        skillId: 'prose.write',
        label: '第一章正文',
        contextSources: ['ragSelection'],
        proseOutlineNodeId: fixture.firstOutlineId,
        runId: run.run.id,
        runStepId: 'master:prose-1',
        candidateHash: 'a'.repeat(64),
      },
      scope: fixture.scope,
    })
    const candidate = {
      event,
      payload: JSON.parse(event.payload),
      draft: event.content,
    } as MasterAgentDurableCandidateV1
    const result = await appendMasterAgentImpactReportV1({
      scope: fixture.scope,
      snapshot: run,
      candidate,
    })
    expect(result.report.direction).toBe('upstream-review')
    expect(result.report.changed).toEqual({ table: 'chapters', id: fixture.firstChapterId })
    expect(result.report.sourceFactIds).toEqual([factId])
    expect(result.report.downstreamChapterIds).toEqual([fixture.downstreamChapterId])
    expect(result.report.requiresAuthorReview).toBe(true)
    expect(result.report.impactGraph?.source.recordId).toBe(fixture.firstChapterId)
    expect(result.report.impactGraph?.nodes.some(node => node.kind === 'fact' && node.recordId === factId)).toBe(true)
    expect(result.report.impactGraph?.graphHash).toHaveLength(64)
    const report = parseAgentEventPayload(result.event, null as any) as typeof result.report
    expect(report.kind).toBe('master-agent-impact')
    expect(report.impactGraph?.graphHash).toBe(result.report.impactGraph?.graphHash)
    expect(result.event.content).toContain('后续可能受影响章节 1 章')
  })
})
