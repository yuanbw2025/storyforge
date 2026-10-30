import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { db } from '../../src/lib/db/schema'
import {
  confirmTextOpenWorldCreatorBriefV1,
  generateTextOpenWorldCreatorBriefCandidateV1,
  recoverLatestTextOpenWorldCreatorBriefSessionV1,
  recoverTextOpenWorldCreatorBriefSessionByIdentityV1,
  startTextOpenWorldCreatorBriefSessionV1,
} from '../../src/lib/open-world/creator-brief'
import {
  parseTextOpenWorldCreatorSourceLocatorV1,
  textOpenWorldCreatorLocatorFromBriefRowV1,
  textOpenWorldCreatorLocatorColumnsV1,
} from '../../src/lib/open-world/creator-brief-persistence'
import {
  inspectTextOpenWorldCreatorWorldSourceV1,
} from '../../src/lib/open-world/creator-source'
import type {
  AdaptationSourceSelectionV1,
  ProductProductionBriefRecordV1,
  TextOpenWorldCreatorSourceLocatorV1,
  TextOpenWorldCreatorSourceSelectionV1,
} from '../../src/lib/types'
import { seedQuality005LegacyChapterBriefV1 } from '../helpers/quality005-legacy-chapter-brief'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

const ACKNOWLEDGEMENTS = {
  sourceIdentityReviewed: true,
  productBoundaryReviewed: true,
  unresolvedItemsClosed: true,
  directPublishWorkflowReviewed: true,
} as const

async function emptyDownstreamCounts() {
  const [
    builds,
    artifacts,
    releases,
    runtimeSessions,
  ] = await Promise.all([
    db.productBuilds.count(),
    db.productBuildArtifacts.count(),
    db.productReleases.count(),
    db.productRuntimeSessions.count(),
  ])
  return { builds, artifacts, releases, runtimeSessions }
}

async function worldSelection(
  owned: Awaited<ReturnType<typeof seedCurrentProductWorld>>,
): Promise<TextOpenWorldCreatorSourceSelectionV1> {
  const preview = await inspectTextOpenWorldCreatorWorldSourceV1({
    scope: owned.scope,
    localReleaseRecordId: owned.release.id!,
    expectedReleaseHash: owned.release.contentHash,
  })
  return {
    sourceKind: 'world-release',
    sourceScope: owned.scope,
    localReleaseRecordId: owned.release.id!,
    expectedReleaseHash: owned.release.contentHash,
    preview,
  }
}

describe('R-OPEN-WORLD5 · Creator Brief 会谈、确认与持久化', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('把世界来源的人工确认写入统一 Brief 生命周期，保存完成 Run/receipt，刷新可恢复且不越权启动生产', async () => {
    const owned = await seedCurrentProductWorld(`TOW G5 Brief 世界 ${crypto.randomUUID()}`)
    const selection = await worldSelection(owned)
    const now = Date.now()
    const started = await startTextOpenWorldCreatorBriefSessionV1({
      selection,
      sessionKey: 'world-happy-path',
      createdAt: now,
    })
    expect(started.production).toMatchObject({
      productType: 'text-open-world',
      status: 'consulting',
      currentBriefRevision: null,
      creatorSourceKind: 'world-release',
      creatorSourceWorldReleaseId: owned.release.id,
      creatorSourceBindingHash: started.sourceBindingHash,
    })
    expect(await db.productProductionBriefs.count()).toBe(0)
    expect(await emptyDownstreamCounts()).toEqual({
      builds: 0,
      artifacts: 0,
      releases: 0,
      runtimeSessions: 0,
    })

    const confirmed = await confirmTextOpenWorldCreatorBriefV1({
      session: started,
      draft: {
        ...started.draft,
        gameTitle: '雾港守灯人',
        coreGoal: '追查失踪船队、修复潮汐钟，并在多个被允许的结局中完成主线。',
      },
      acknowledgements: ACKNOWLEDGEMENTS,
      confirmedAt: now + 1,
    })
    expect(confirmed.confirmedBrief).not.toBeNull()
    expect(confirmed.confirmedBrief).toMatchObject({
      schema: 'storyforge.text-open-world-creator-brief',
      version: 1,
      revision: 1,
      sourceBindingHash: started.sourceBindingHash,
      candidateEvidence: { origin: 'author' },
      confirmation: ACKNOWLEDGEMENTS,
    })
    expect(confirmed.production).toMatchObject({
      status: 'brief-ready',
      title: '雾港守灯人',
      currentBriefRevision: 1,
    })

    const rows = await db.productProductionBriefs.toArray()
    expect(rows).toHaveLength(1)
    const briefRow = rows[0]!
    expect(briefRow).toMatchObject({
      productionId: started.production.id,
      revision: 1,
      parentRevision: null,
      status: 'draft',
      briefKind: 'text-open-world-creator-v1',
      sourceKind: 'world-release',
      sourceWorldReleaseId: owned.release.id,
      sourceBindingHash: started.sourceBindingHash,
      sourcePlanJson: '{}',
      confirmedBriefJson: '{}',
      authorizedAt: null,
    })
    expect(briefRow.briefHash).toBe(confirmed.confirmedBrief!.briefHash)
    expect(briefRow.candidateRunId).toBe(confirmed.candidateRunId)

    const run = await readAgentRunV1(owned.scope, confirmed.candidateRunId!)
    expect(run.projection.state).toBe('completed')
    expect(run.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(run.projection.steps['text-open-world:creator-brief-candidate']).toMatchObject({
      status: 'succeeded',
      candidateHash: confirmed.confirmedBrief!.candidateEvidence.candidateHash,
      outputHash: confirmed.confirmedBrief!.briefHash,
    })
    const verificationEvent = await db.agentRunEvents
      .where('runId').equals(run.run.id)
      .filter(event => event.type === 'verification.accepted')
      .first()
    expect(verificationEvent).toBeDefined()
    expect(run.projection.terminalReceiptHash).toBe(JSON.parse(verificationEvent!.payloadJson).receiptHash)

    const recovered = await recoverLatestTextOpenWorldCreatorBriefSessionV1([owned.scope])
    expect(recovered).not.toBeNull()
    expect(recovered).toMatchObject({
      productInstanceKey: started.productInstanceKey,
      sourceBindingHash: started.sourceBindingHash,
      sourceIssue: null,
      candidateRunId: confirmed.candidateRunId,
    })
    expect(recovered!.confirmedBrief?.briefHash).toBe(confirmed.confirmedBrief!.briefHash)
    expect(recovered!.draft.gameTitle).toBe('雾港守灯人')
    expect(await emptyDownstreamCounts()).toEqual({
      builds: 0,
      artifacts: 0,
      releases: 0,
      runtimeSessions: 0,
    })
  }, 30_000)

  it('同一来源会谈并发初始化仍只产生一个 Production、Conversation 和起点事件', async () => {
    const owned = await seedCurrentProductWorld(`TOW G5 Brief 并发 ${crypto.randomUUID()}`)
    const selection = await worldSelection(owned)
    const sessions = await Promise.all([
      startTextOpenWorldCreatorBriefSessionV1({ selection, sessionKey: 'strict-mode' }),
      startTextOpenWorldCreatorBriefSessionV1({ selection, sessionKey: 'strict-mode' }),
    ])
    expect(sessions[0]!.production.id).toBe(sessions[1]!.production.id)
    expect(sessions[0]!.conversation.id).toBe(sessions[1]!.conversation.id)
    expect(await db.productProductions.count()).toBe(1)
    expect(await db.agentConversations.count()).toBe(1)
    const events = await db.agentEvents
      .where('conversationId').equals(sessions[0]!.conversation.id).toArray()
    expect(events.filter(event => {
      try {
        return JSON.parse(event.payload ?? '{}').schema
          === 'storyforge.text-open-world-creator-brief-session-start'
      } catch { return false }
    })).toHaveLength(1)
  }, 30_000)

  it('设置往返按会谈、产品与来源绑定精确恢复，绝不误选同 Work 的更新会谈', async () => {
    const fixture = await seedQuality005LegacyChapterBriefV1()
    const novel = fixture.novel, first = fixture.confirmed, second = fixture.otherSession
    await db.agentConversations.update(first.conversation.id, { updatedAt: novel.now + 10 })
    await db.agentConversations.update(second.conversation.id, { updatedAt: novel.now + 20 })

    const latest = await recoverLatestTextOpenWorldCreatorBriefSessionV1([novel.scope])
    expect(latest?.conversation.id).toBe(second.conversation.id)
    const exact = await recoverTextOpenWorldCreatorBriefSessionByIdentityV1([novel.scope], {
      conversationId: first.conversation.id,
      productInstanceKey: first.productInstanceKey,
      sourceBindingHash: first.sourceBindingHash,
      sourceBinding: first.sourceBinding,
    })
    expect(exact?.conversation.id).toBe(first.conversation.id)
    expect(exact?.sourceBinding).toEqual(first.sourceBinding)

    await expect(recoverTextOpenWorldCreatorBriefSessionByIdentityV1([novel.scope], {
      conversationId: first.conversation.id,
      productInstanceKey: second.productInstanceKey,
      sourceBindingHash: second.sourceBindingHash,
      sourceBinding: second.sourceBinding,
    })).resolves.toBeNull()
  }, 30_000)

  it('历史小说来源正文漂移仍可见，禁止新确认并保留原 Brief、Run 与回执', async () => {
    const fixture = await seedQuality005LegacyChapterBriefV1(), novel = fixture.novel
    const started = fixture.otherSession
    await db.chapters.update(novel.chapters[0]!.id, {
      content: '<p>作者在会谈之后改写了来源正文，旧 Hash 不得继续使用。</p>',
      updatedAt: novel.now + 2,
    })
    const beforeBriefs = await db.productProductionBriefs.toArray()
    const beforeRuns = await db.agentRuns.toArray()
    await expect(confirmTextOpenWorldCreatorBriefV1({
      session: started, draft: started.draft, acknowledgements: ACKNOWLEDGEMENTS, confirmedAt: novel.now + 3,
    })).rejects.toThrow(/WorldRelease|派生.*世界/)
    expect(await db.productProductionBriefs.toArray()).toEqual(beforeBriefs)
    expect(await db.agentRuns.toArray()).toEqual(beforeRuns)
    expect(await emptyDownstreamCounts()).toEqual({ builds: 0, artifacts: 0, releases: 0, runtimeSessions: 0 })
    const recovered = await recoverLatestTextOpenWorldCreatorBriefSessionV1([novel.scope])
    expect(recovered).not.toBeNull()
    expect(recovered!.selection).toBeNull()
    expect(recovered!.sourceIssue).toMatch(/来源|变化|stale|Hash/i)
  }, 30_000)

  it('未决问题和四项作者确认任一缺失都会在创建 Run 之前阻断正式 Brief', async () => {
    const owned = await seedCurrentProductWorld(`TOW G5 Brief 阻断 ${crypto.randomUUID()}`)
    const started = await startTextOpenWorldCreatorBriefSessionV1({
      selection: await worldSelection(owned),
      sessionKey: 'confirmation-gates',
    })
    const unresolvedDraft = {
      ...started.draft,
      unresolvedQuestions: ['主角究竟由作者创建，还是从世界来源中选择？'],
    }
    await expect(confirmTextOpenWorldCreatorBriefV1({
      session: started,
      draft: unresolvedDraft,
      acknowledgements: ACKNOWLEDGEMENTS,
    })).rejects.toThrow(/未决问题/)
    await expect(confirmTextOpenWorldCreatorBriefV1({
      session: started,
      draft: started.draft,
      acknowledgements: {
        ...ACKNOWLEDGEMENTS,
        directPublishWorkflowReviewed: false,
      },
    })).rejects.toThrow(/逐项确认/)
    expect(await db.agentRuns.count()).toBe(0)
    expect(await db.productProductionBriefs.count()).toBe(0)
    expect((await db.productProductions.get(started.production.id))?.status).toBe('consulting')
  }, 30_000)

  it('模型协议错误只进行一次有界修复，并把第二次合法结果停在待作者确认候选', async () => {
    const owned = await seedCurrentProductWorld(`TOW G5 Brief 修复 ${crypto.randomUUID()}`)
    const started = await startTextOpenWorldCreatorBriefSessionV1({
      selection: await worldSelection(owned),
      sessionKey: 'bounded-protocol-repair',
    })
    const outputs = [
      '这不是 JSON',
      JSON.stringify({
        suggestedTitle: '潮汐边界',
        understandingSummary: '作者希望以受保护的顺序主线承载成长，并用地区故事填充探索。',
        playerFantasy: '成为能够穿行多地、逐步揭开核心冲突的冒险者。',
        experiencePromise: '清晰主线与丰富但有边界的地区冒险并行。',
        primaryConflict: '长期目标与持续变化的地区问题互相牵引。',
        recommendedOpening: '从港区的失踪调查开始第一项明确任务。',
        protagonistFit: '作者设定的主角需要拥有进入调查和持续成长的动机。',
        experiencePillars: ['长期主线成长', '地区故事探索'],
        sourceUsePlan: ['只把已给来源摘要作为定位，正文留待正式冻结阶段读取。'],
        unresolvedQuestions: [],
        assumptions: ['首版使用标准难度。'],
        risks: ['来源摘要不足以支持具体人物和地点事实。'],
      }),
    ]
    let calls = 0
    const candidateSession = await generateTextOpenWorldCreatorBriefCandidateV1({
      session: started,
      draft: started.draft,
      runAI: async () => outputs[calls++]!,
    })

    expect(calls).toBe(2)
    expect(candidateSession.candidate).toMatchObject({
      origin: 'ai',
      repairApplied: true,
      sourceBindingHash: started.sourceBindingHash,
      synthesis: { suggestedTitle: '潮汐边界' },
    })
    expect(candidateSession.candidateRunId).toBeTypeOf('number')
    const run = await readAgentRunV1(owned.scope, candidateSession.candidateRunId!)
    expect(run.projection.state).toBe('awaiting_confirmation')
    expect(run.projection.steps['text-open-world:creator-brief-candidate']?.candidateHash)
      .toBe(candidateSession.candidate?.candidateHash)
    expect(await db.productProductionBriefs.count()).toBe(0)
    expect(await emptyDownstreamCounts()).toEqual({
      builds: 0,
      artifacts: 0,
      releases: 0,
      runtimeSessions: 0,
    })
  }, 30_000)

  it('四种小说 locator 均可严格解析和列式往返，混入其他 selector 字段或重复章节会被拒绝', () => {
    const sourceVersionHash = 'a'.repeat(64)
    const sourceBoundaryHash = 'b'.repeat(64)
    const selections: AdaptationSourceSelectionV1[] = [
      { mode: 'entire-work' },
      { mode: 'outline-subtree', outlineNodeId: 11 },
      { mode: 'chapter-range', startChapterId: 21, endChapterId: 25 },
      { mode: 'chapters', chapterIds: [31, 33, 37] },
    ]
    for (const selection of selections) {
      const locator: TextOpenWorldCreatorSourceLocatorV1 = {
        kind: 'novel',
        sourceWorkId: 7,
        selection,
        expectedSourceVersionHash: sourceVersionHash,
        expectedSourceBoundaryHash: sourceBoundaryHash,
      }
      expect(parseTextOpenWorldCreatorSourceLocatorV1(locator)).toEqual(locator)
      const columns = textOpenWorldCreatorLocatorColumnsV1(locator)
      const reconstructed = textOpenWorldCreatorLocatorFromBriefRowV1({
        sourceKind: 'novel',
        ...columns,
        sourceVersionHash,
        sourceBoundaryHash,
      } as ProductProductionBriefRecordV1)
      expect(reconstructed).toEqual(locator)
    }

    expect(() => parseTextOpenWorldCreatorSourceLocatorV1({
      kind: 'novel',
      sourceWorkId: 7,
      selection: { mode: 'entire-work', outlineNodeId: 11 },
      expectedSourceVersionHash: sourceVersionHash,
      expectedSourceBoundaryHash: sourceBoundaryHash,
    })).toThrow(/字段不精确/)
    expect(() => parseTextOpenWorldCreatorSourceLocatorV1({
      kind: 'novel',
      sourceWorkId: 7,
      selection: { mode: 'chapters', chapterIds: [31, 31] },
      expectedSourceVersionHash: sourceVersionHash,
      expectedSourceBoundaryHash: sourceBoundaryHash,
    })).toThrow(/不得重复/)
    expect(() => parseTextOpenWorldCreatorSourceLocatorV1({
      kind: 'novel',
      sourceWorkId: 7,
      selection: { mode: 'chapter-range', startChapterId: 21 },
      expectedSourceVersionHash: sourceVersionHash,
      expectedSourceBoundaryHash: sourceBoundaryHash,
    })).toThrow(/字段不精确/)
  })
})
