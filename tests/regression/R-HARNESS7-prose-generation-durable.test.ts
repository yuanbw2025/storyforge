import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  beginProseGenerationGatewayStepV1,
  commitProseGenerationAdoptionV1,
  createProseGenerationDurableRunV1,
  finalizeProseGenerationGatewayStepV1,
  hashProseGenerationCandidateV1,
  persistProseGenerationCandidateV1,
  readLatestProseGenerationCandidateV1,
  recordProseGenerationCandidateV1,
  recoverProseGenerationCandidateV1,
  rejectProseGenerationCandidateV1,
  isProseGenerationCandidateCurrentV1,
  PROSE_GENERATION_CANDIDATE_TYPE_V1,
  PROSE_GENERATION_STEP_ID_V1,
  type ProseGenerationCandidateV1,
  type ProseGenerationOperationV1,
} from '../../src/lib/agent/run/prose-generation-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { hashChapterText, normalizeChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import type { WorkspaceScope } from '../../src/lib/types'
import { buildChapterInformationBoundaryV1 } from '../../src/lib/agent/information-boundary'
import { captureWorkspaceContentRevisionV1 } from '../../src/lib/authoring/content-revision'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { createWorkspace as createWorkspaceRoot } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  outlineNodeId: number
  chapterId: number
  content: string
}> {
  const now = Date.now()
  const created = await createWorkspaceRoot({
    name: label, genres: ['fantasy'], status: 'drafting', description: '', targetWordCount: 100_000,
  }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
  const { scope } = created
  const projectId = scope.projectId
  const worldGroupId = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId, name: '主世界', description: '', type: 'primary', order: 0, createdAt: now, updatedAt: now,
  } as any, { owner: 'world' })) as number
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId,
    worldGroupId,
    parentId: null,
    type: 'chapter',
    title: '潮门',
    summary: '守灯人抵达潮门。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any, { owner: 'work' })) as number
  await db.detailedOutlines.add(stampNewRecord(scope, 'detailedOutlines', {
    projectId, outlineNodeId, scenes: [{ sceneId: 'scene-1', title: '潮门开启', summary: '守灯人目睹潮门开启。', characterIds: [], location: '潮门', conflict: '海潮倒流', pace: 'medium', estimatedWords: 1200 }],
    openingHook: '潮声骤停。', endingCliffhanger: '门后传来钟响。', sceneLocation: '潮门',
    appearingCharacterIds: [], foreshadowIds: [], emotionArc: 'rising', prohibitions: [],
    lastUsedSummary: '守灯人抵达潮门。', createdAt: now, updatedAt: now,
  } as any, { owner: 'work' }))
  const content = '<p>守灯人抵达潮门。</p>'
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId,
    outlineNodeId,
    title: '潮门',
    content,
    wordCount: 9,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
    perspectiveCharacterId: null,
  } as any, { owner: 'work' })) as number
  return { scope, worldGroupId, outlineNodeId, chapterId, content }
}

async function preparePending(
  label: string,
  operation: ProseGenerationOperationV1 = 'generate',
  recordLedger = true,
) {
  const fixture = await createWorkspace(label)
  let snapshot = await createProseGenerationDurableRunV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    chapterId: fixture.chapterId,
    operation,
  })
  const assembled = await prepareProseGatewayAssemblyV1({
    projectId: fixture.scope.projectId,
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    chapterId: fixture.chapterId,
    outlineNodeId: fixture.outlineNodeId,
    operation,
    authorRequest: '生成潮门正文',
    perspectiveCharacterId: null,
    config: useAIConfigStore.getState().config,
  })
  const sourceTextHash = await hashChapterText(fixture.content)
  const informationBoundary = await buildChapterInformationBoundaryV1({
    scope: fixture.scope,
    chapterId: fixture.chapterId,
    outlineNodeId: fixture.outlineNodeId,
    worldGroupId: fixture.worldGroupId,
    perspectiveCharacterId: null,
  })
  const messages = [{ role: 'user' as const, content: `受控资料：\n${assembled.text}\n\n生成潮门正文` }]
  const begun = await beginProseGenerationGatewayStepV1({
    scope: fixture.scope,
    snapshot,
    worldGroupId: fixture.worldGroupId,
    chapterId: fixture.chapterId,
    outlineNodeId: fixture.outlineNodeId,
    assembled,
    messages,
    binding: {
      operation,
      sourceTextHash,
      promptHash: await hashCanonicalValue(messages),
      informationBoundaryHash: informationBoundary.manifestHash,
    },
  })
  snapshot = begun.snapshot
  const outputText = operation === 'continue' ? '潮声里传来第二次钟响。' : '潮门在暮色中缓缓开启。'
  const finalized = await finalizeProseGenerationGatewayStepV1({
    scope: fixture.scope,
    snapshot,
    attempt: begun.attempt,
    output: outputText,
  })
  snapshot = finalized.snapshot
  const baseCandidate = {
    version: 1 as const,
    type: PROSE_GENERATION_CANDIDATE_TYPE_V1,
    projectId: fixture.scope.projectId,
    chapterId: fixture.chapterId,
    chapterTitle: '潮门',
    worldGroupId: fixture.worldGroupId,
    operation,
    sourceTextHash,
    contentRevision: await captureWorkspaceContentRevisionV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
    }),
    outputText,
    outputTextHash: await hashCanonicalValue(outputText),
    gatewayEvidenceVersion: 3 as const,
    expectedContentHash: await hashChapterText(
      operation === 'continue'
        ? [normalizeChapterText(fixture.content), normalizeChapterText(outputText)].join('\n')
        : outputText,
    ),
    informationBoundaryHash: informationBoundary.manifestHash,
    perspectiveCharacterId: null,
    perspectiveFromChapter: false,
    createdAt: Date.now(),
  }
  const candidateHash = await hashProseGenerationCandidateV1(baseCandidate)
  const candidate: ProseGenerationCandidateV1 = {
    ...baseCandidate,
    durable: {
      runId: snapshot.run.id,
      stepId: PROSE_GENERATION_STEP_ID_V1,
      attempt: 1,
      contextManifestHash: finalized.manifest.manifestHash,
      candidateHash,
    },
  }
  await persistProseGenerationCandidateV1({ scope: fixture.scope, candidate })
  if (recordLedger) {
    snapshot = await recordProseGenerationCandidateV1({
      scope: fixture.scope,
      snapshot,
      candidate,
    })
  }
  return { fixture, snapshot, candidate }
}

describe.sequential('R-HARNESS7 · 正文生成 durable run', { timeout: 15_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('生成正文先停在候选，作者确认后经 CAS 写回并签发 receipt', async () => {
    const pending = await preparePending('正文生成')
    expect(pending.snapshot.projection.state).toBe('awaiting_confirmation')
    expect((await db.chapters.get(pending.fixture.chapterId))?.content).toBe(pending.fixture.content)
    const summaryId = await db.narrativeSummaryNodes.add({
      projectId: pending.fixture.scope.projectId,
      workId: pending.fixture.scope.workId,
      worldGroupId: pending.fixture.worldGroupId,
      level: 'chapter',
      sourceChapterId: pending.fixture.chapterId,
      sourceOutlineNodeId: pending.fixture.outlineNodeId,
      title: '旧摘要',
      summary: '旧正文摘要',
      keywords: [],
      sourceHash: await hashChapterText(pending.fixture.content),
      status: 'verified',
      generatedBy: 'system-rollup',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }) as number

    const completed = await commitProseGenerationAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
      contentHtml: '<p>潮门在暮色中缓缓开启。</p>',
      wordCount: 12,
    })

    expect(completed.snapshot.projection.state).toBe('completed')
    expect(completed.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect((await db.chapters.get(pending.fixture.chapterId))?.content)
      .toBe('<p>潮门在暮色中缓缓开启。</p>')
    expect((await db.narrativeSummaryNodes.get(summaryId))?.status).toBe('stale')
    expect(completed.snapshot.events.map(event => event.type).slice(-6)).toEqual([
      'adoption.started',
      'adoption.committed',
      'step.succeeded',
      'verification.started',
      'verification.accepted',
      'memory.settlement.recorded',
    ])
  })

  it('续写 receipt 校验完整正文，而不是把续写片段误当成整章', async () => {
    const pending = await preparePending('正文续写', 'continue')
    const contentHtml = `${pending.fixture.content}<p>潮声里传来第二次钟响。</p>`
    const completed = await commitProseGenerationAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
      contentHtml,
      wordCount: 20,
    })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect((await db.chapters.get(pending.fixture.chapterId))?.content).toBe(contentHtml)
  })

  it('等待确认期间正文变化会把旧候选标记 stale，禁止覆盖作者编辑', async () => {
    const pending = await preparePending('正文 stale')
    await db.chapters.update(pending.fixture.chapterId, {
      content: '<p>作者在等待期间改写了正文。</p>',
      updatedAt: Date.now(),
    })
    await expect(commitProseGenerationAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
      contentHtml: '<p>潮门在暮色中缓缓开启。</p>',
      wordCount: 12,
    })).rejects.toThrow('已过期')
    const snapshot = await readAgentRunV1(pending.fixture.scope, pending.candidate.durable.runId)
    expect(snapshot.projection.state).toBe('paused')
    expect(snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1].status).toBe('stale')
    expect(snapshot.projection.terminalReceiptHash).toBeUndefined()
  })

  it('等待确认期间上游 Canon 变化会由 content revision 阻断，不只检查当前正文', async () => {
    const pending = await preparePending('正文上游 stale')
    await db.outlineNodes.update(pending.fixture.outlineNodeId, {
      summary: '作者生成后改变了本章必须遵守的事件边界。',
      updatedAt: Date.now(),
    })
    await expect(commitProseGenerationAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
      contentHtml: '<p>潮门在暮色中缓缓开启。</p>',
      wordCount: 12,
    })).rejects.toThrow(/项目内容已变化.*outlineNodes/)
    expect((await db.chapters.get(pending.fixture.chapterId))?.content).toBe(pending.fixture.content)
  })

  it('作者确认的最终正文与候选不一致时先拒绝，不写入错误正文', async () => {
    const pending = await preparePending('正文输出不一致')
    await expect(commitProseGenerationAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
      contentHtml: '<p>作者改动了候选内容。</p>',
      wordCount: 10,
    })).rejects.toThrow('不一致')
    expect((await db.chapters.get(pending.fixture.chapterId))?.content).toBe(pending.fixture.content)
    const snapshot = await readAgentRunV1(pending.fixture.scope, pending.candidate.durable.runId)
    expect(snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1].status).toBe('failed')
    expect(snapshot.projection.terminalReceiptHash).toBeUndefined()
  })

  it('候选事件先落库时可恢复 ledger，且作者关闭会留下拒绝证据', async () => {
    const interrupted = await preparePending('正文恢复', 'generate', false)
    const restoredCandidate = await readLatestProseGenerationCandidateV1({
      scope: interrupted.fixture.scope,
      chapterId: interrupted.fixture.chapterId,
    })
    expect(restoredCandidate?.durable.candidateHash).toBe(interrupted.candidate.durable.candidateHash)
    const recovered = await recoverProseGenerationCandidateV1({
      scope: interrupted.fixture.scope,
      candidate: interrupted.candidate,
    })
    expect(recovered?.projection.state).toBe('awaiting_confirmation')
    expect(recovered?.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(recovered?.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)

    const rejected = await rejectProseGenerationCandidateV1({
      scope: interrupted.fixture.scope,
      runId: interrupted.candidate.durable.runId,
      candidate: interrupted.candidate,
    })
    expect(rejected.projection.state).toBe('running')
    expect(rejected.projection.steps[PROSE_GENERATION_STEP_ID_V1].status).toBe('failed')
    expect(rejected.projection.steps[PROSE_GENERATION_STEP_ID_V1].confirmation).toBe('reject')
  })

  it('新 V2 合同缺少信息边界证据时拒绝候选，不能降级为旧 V1 校验', async () => {
    const pending = await preparePending('正文边界必需')
    const { durable: _durable, informationBoundaryHash: _boundary, ...candidateBody } = pending.candidate
    const candidateWithoutBoundary: ProseGenerationCandidateV1 = {
      ...candidateBody,
      durable: {
        ...pending.candidate.durable,
        candidateHash: await hashProseGenerationCandidateV1(candidateBody),
      },
    }
    expect(await isProseGenerationCandidateCurrentV1(candidateWithoutBoundary)).toBe(false)
  })
})
