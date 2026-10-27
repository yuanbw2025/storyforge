import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  reviseProseGenerationCandidateV1,
  isProseGenerationCandidateCurrentV1,
  PROSE_GENERATION_CANDIDATE_TYPE_V1,
  PROSE_GENERATION_STEP_ID_V1,
  type ProseGenerationCandidateV1,
  type ProseGenerationOperationV1,
} from '../../src/lib/agent/run/prose-generation-durable'
import { appendAgentRunEventV1, readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { hashChapterText, normalizeChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import type { WorkspaceScope } from '../../src/lib/types'
import { buildChapterInformationBoundaryV1 } from '../../src/lib/agent/information-boundary'
import { captureWorkspaceContentRevisionV1 } from '../../src/lib/authoring/content-revision'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { createWorkspace as createWorkspaceRoot } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { normalizeProseForEditorV1, plainTextToHtml } from '../../src/lib/utils/html'

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
    projectId, outlineNodeId, scenes: [{ sceneId: 'scene-1', title: '潮门开启', summary: '守灯人目睹潮门开启。', characterIds: [], location: '潮门', conflict: '海潮倒流', pace: 'medium', estimatedWords: 1200, notes: '' }],
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

  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it.each(['generate', 'continue'] as const)('拒绝 %s 候选会结束运行，重复拒绝不重复决定或结算', async operation => {
    const pending = await preparePending('正文拒绝终态', operation)
    const input = { scope: pending.fixture.scope, runId: pending.candidate.durable.runId, candidate: pending.candidate }
    await Promise.all([rejectProseGenerationCandidateV1(input), rejectProseGenerationCandidateV1(input)])
    const after = await readAgentRunV1(input.scope, input.runId)
    expect(after.projection.state).toBe('failed')
    expect(after.events.filter(event => event.type === 'run.failed').map(event => event.payload)).toEqual([{ code: 'author_rejected', retryable: false }])
    for (const type of ['confirmation.recorded', 'run.failed', 'memory.settlement.recorded']) expect(after.events.filter(event => event.type === type)).toHaveLength(1)
    expect((await db.chapters.get(pending.fixture.chapterId))?.content).toBe(pending.fixture.content)
    const stored = await readLatestProseGenerationCandidateV1({ scope: input.scope, chapterId: pending.fixture.chapterId })
    expect(stored).toEqual(pending.candidate)
    expect(await recoverProseGenerationCandidateV1({ scope: input.scope, candidate: stored! })).toBeNull()
    expect((await rejectProseGenerationCandidateV1(input)).events).toEqual(after.events)
  })

  it.each(['run.failed', 'memory.settlement.recorded'])('正文拒绝的 %s 写失败时整次决定回滚，候选可恢复并明确重试', async eventType => {
    const pending = await preparePending('正文拒绝写失败')
    const input = { scope: pending.fixture.scope, runId: pending.candidate.durable.runId, candidate: pending.candidate }
    const before = await readAgentRunV1(input.scope, input.runId)
    const add = db.agentRunEvents.add.bind(db.agentRunEvents)
    const spy = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === eventType) throw new DOMException('正文拒绝终态写入故障', 'QuotaExceededError')
      return add(...args)
    })
    await expect(rejectProseGenerationCandidateV1(input)).rejects.toThrow('正文拒绝终态写入故障')
    expect(await readAgentRunV1(input.scope, input.runId)).toEqual(before)
    expect(await readLatestProseGenerationCandidateV1({ scope: input.scope, chapterId: pending.fixture.chapterId })).not.toBeNull()
    spy.mockRestore()
    expect((await rejectProseGenerationCandidateV1(input)).projection.state).toBe('failed')
  })

  it('明确再次拒绝可补齐旧的已拒绝正文步骤终态，保留原始事件', async () => {
    const pending = await preparePending('正文旧拒绝终态')
    const input = { scope: pending.fixture.scope, runId: pending.candidate.durable.runId, candidate: pending.candidate }
    const before = await appendAgentRunEventV1({ ...input, expectedLastSequence: pending.snapshot.projection.lastSequence, type: 'confirmation.recorded', payload: { stepId: PROSE_GENERATION_STEP_ID_V1, candidateHash: pending.candidate.durable.candidateHash, decision: 'reject' } })
    expect(before.projection.state).toBe('running')
    const after = await rejectProseGenerationCandidateV1(input)
    expect(after.projection.state).toBe('failed')
    expect(after.events.slice(0, before.events.length)).toEqual(before.events)
    expect(after.events.filter(event => event.type === 'confirmation.recorded')).toHaveLength(1)
  })

  it.each(['generate', 'continue'] as const)('作者修订 %s 候选可刷新恢复，并沿原 Gateway 证据链采纳', async operation => {
    const pending = await preparePending('作者修订', operation)
    const outputText = '守灯人收起铜箔，没有推开潮门。'
    const candidate = await reviseProseGenerationCandidateV1({ scope: pending.fixture.scope, candidate: pending.candidate, outputText })
    expect((await db.chapters.get(pending.fixture.chapterId))?.content).toBe(pending.fixture.content)
    expect(await readLatestProseGenerationCandidateV1({ scope: pending.fixture.scope, chapterId: pending.fixture.chapterId })).toEqual(candidate)
    expect((await recoverProseGenerationCandidateV1({ scope: pending.fixture.scope, candidate }))?.projection.state).toBe('awaiting_confirmation')
    const contentHtml = operation === 'continue' ? `${pending.fixture.content}<p>${outputText}</p>` : `<p>${outputText}</p>`
    const result = await commitProseGenerationAdoptionV1({ scope: pending.fixture.scope, runId: candidate.durable.runId, candidate, contentHtml, wordCount: 18 })
    expect(result.snapshot.projection.state).toBe('completed')
    expect(result.snapshot.events.filter(event => event.type === 'candidate.revised')).toHaveLength(1)
    expect((await db.chapters.get(pending.fixture.chapterId))?.content).toBe(contentHtml)
  })

  it.each(['generate', 'continue'] as const)('%s 候选中的字面标签与实体保留原文，并通过正式采纳', async operation => {
    const pending = await preparePending('字面文本采纳', operation)
    const outputText = '门牌写着 <潮门>，价签是 2 < 3。\r\n\r\n保留 </think> 和字面 &lt;铜箔&gt;。'
    const candidate = await reviseProseGenerationCandidateV1({
      scope: pending.fixture.scope, candidate: pending.candidate, outputText,
    })
    const fullText = operation === 'continue'
      ? [normalizeChapterText(pending.fixture.content), normalizeProseForEditorV1(outputText)].join('\n')
      : normalizeProseForEditorV1(outputText)
    const contentHtml = plainTextToHtml(fullText)
    expect(candidate.expectedContentHash).toBe(await hashChapterText(contentHtml))
    expect(normalizeChapterText(contentHtml)).toBe(fullText)
    const result = await commitProseGenerationAdoptionV1({
      scope: pending.fixture.scope, runId: candidate.durable.runId, candidate,
      contentHtml, wordCount: fullText.replace(/\s/g, '').length,
    })
    expect(result.snapshot.projection.state).toBe('completed')
    expect(normalizeChapterText((await db.chapters.get(pending.fixture.chapterId))!.content)).toBe(fullText)
  })

  it('重复草稿与正文之间出现推理分隔符时不能原样采纳；作者保留后段后同一候选可正式采纳', async () => {
    const pending = await preparePending('回复分隔核对', 'generate')
    const text = '守灯人决定关门，放下铜钥匙，转身离开潮门。'.repeat(30)
    const mixed = `${text}\n</think>\n# 第1章 潮门\n${text}`
    const candidate = await reviseProseGenerationCandidateV1({ scope: pending.fixture.scope, candidate: pending.candidate, outputText: mixed })
    await expect(commitProseGenerationAdoptionV1({ scope: pending.fixture.scope, runId: candidate.durable.runId, candidate, contentHtml: plainTextToHtml(mixed), wordCount: mixed.length })).rejects.toThrow('重复了正文')
    expect((await db.chapters.get(pending.fixture.chapterId))!.content).toBe(pending.fixture.content)
    const resolved = await reviseProseGenerationCandidateV1({ scope: pending.fixture.scope, candidate, outputText: text })
    const written = await commitProseGenerationAdoptionV1({ scope: pending.fixture.scope, runId: resolved.durable.runId, candidate: resolved, contentHtml: plainTextToHtml(text), wordCount: text.length })
    expect(written.snapshot.projection.state).toBe('completed')
    expect(normalizeChapterText((await db.chapters.get(pending.fixture.chapterId))!.content)).toBe(text)
  })

  it('正文候选修订拒绝空内容、跨作品、过期和重复旧版本', async () => {
    const pending = await preparePending('修订保护')
    const revise = (outputText: string) => reviseProseGenerationCandidateV1({ scope: pending.fixture.scope, candidate: pending.candidate, outputText })
    await expect(revise('  ')).rejects.toThrow('不能为空')
    const foreign = await createWorkspace('另一部作品')
    await expect(reviseProseGenerationCandidateV1({ scope: foreign.scope, candidate: pending.candidate, outputText: '跨界' })).rejects.toThrow('越界')
    await revise('作者修改的正文。')
    await expect(revise('重复使用旧候选')).rejects.toThrow()
    const restored = (await readLatestProseGenerationCandidateV1({ scope: pending.fixture.scope, chapterId: pending.fixture.chapterId }))!
    await db.chapters.update(pending.fixture.chapterId, { content: '<p>作者修改了原稿。</p>' })
    await expect(reviseProseGenerationCandidateV1({ scope: pending.fixture.scope, candidate: restored, outputText: '迟到修订' })).rejects.toThrow()
    expect((await db.chapters.get(pending.fixture.chapterId))?.content).toBe('<p>作者修改了原稿。</p>')
  })

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

  it('作者可以关闭 stale 正文候选，留下取消证据且不再恢复候选', async () => {
    const pending = await preparePending('正文 stale 关闭')
    await db.outlineNodes.update(pending.fixture.outlineNodeId, {
      summary: '作者在候选生成后更新了本章事件边界。',
      updatedAt: Date.now(),
    })
    await expect(commitProseGenerationAdoptionV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
      contentHtml: '<p>潮门在暮色中缓缓开启。</p>',
      wordCount: 12,
    })).rejects.toThrow('已过期')

    const cancelled = await rejectProseGenerationCandidateV1({
      scope: pending.fixture.scope,
      runId: pending.candidate.durable.runId,
      candidate: pending.candidate,
    })
    expect(cancelled.projection.state).toBe('cancelled')
    expect(cancelled.events.map(event => event.type)).toContain('run.cancelled')
    expect(await recoverProseGenerationCandidateV1({
      scope: pending.fixture.scope,
      candidate: pending.candidate,
    })).toBeNull()
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
    expect(rejected.projection.state).toBe('failed')
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
