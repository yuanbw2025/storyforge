import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import { createAdaptation, listActiveSourceUnits } from '../../src/lib/adaptation/source-manifest'
import { adoptAdaptationSourceFactsV1 } from '../../src/lib/adaptation/analysis'
import * as events from '../../src/lib/agent/run/event-store'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  adoptScreenplayProfessionalCandidateV1,
  generateScreenplayProfessionalCandidateV1,
  listScreenplayTasksV1,
  type ScreenplayProfessionalPayloadV1,
  type ScreenplayProfessionalStageV1,
} from '../../src/lib/screenplay/durable-production'
import { startScreenplayProductionV1 } from '../../src/lib/screenplay/production'
import type { AdaptationBriefV1, Chapter, ScreenplayTargetSpecV1 } from '../../src/lib/types'

const targetSpec: ScreenplayTargetSpecV1 = {
  format: 'film', language: 'zh-CN', episodeCount: null, targetMinutesPerEpisode: 2,
  rating: 'PG-13', dialogueDensity: 'balanced', productionScale: 'contained', preserveVoiceOver: false,
  titlePage: { creditLine: '改编', authorDisplayName: '合成作者', contactText: '', copyrightNotice: '合成夹具', draftLabel: '初稿' },
  exportDefaults: ['fountain'],
}

async function fixture() {
  const source = await createWorkspace({
    name: '冻结意图来源', description: '', genres: ['other'], status: 'drafting', targetWordCount: 8_000,
  }, { kind: 'novel', novelProfile: 'short' })
  const [chapter] = await readOwnedRows<Chapter>(source.scope, 'chapters', { owner: 'work' })
  await db.chapters.update(chapter!.id!, {
    content: '<p>清晨，检票员发现一张没有目的地的车票，并把它放进抽屉。</p>',
    summary: '检票员保留车票。', updatedAt: Date.now(),
  })
  const item = await createAdaptation({
    sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '冻结意图剧本',
    sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec,
  })
  const unit = (await listActiveSourceUnits(item.adaptation.id!)).find(row => row.sourceKind === 'chapter')!
  const facts = [
    { stableKey: 'fact.ticket', kind: 'event' as const, statement: '模型提案：检票员丢弃车票。', subjectKeys: [], sourceUnitKeys: [unit.sourceUnitKey], confidence: 1 },
    { stableKey: 'fact.excluded', kind: 'event' as const, statement: '作者排除的模型提案。', subjectKeys: [], sourceUnitKeys: [unit.sourceUnitKey], confidence: 1 },
  ]
  return { ...item, source, chapter: chapter!, unit, facts }
}

type Fixture = Awaited<ReturnType<typeof fixture>>
type Generated = Awaited<ReturnType<typeof generateScreenplayProfessionalCandidateV1>>

async function generate(item: Fixture, stage: ScreenplayProfessionalStageV1, payload: ScreenplayProfessionalPayloadV1, targetSceneKeys?: string[]) {
  const runAI = vi.fn(async () => JSON.stringify(payload))
  const generated = await generateScreenplayProfessionalCandidateV1({
    scope: item.scope, adaptationProjectId: item.adaptation.id!, stage,
    sourceUnitKeys: [item.unit.sourceUnitKey], targetSceneKeys, runAI,
  })
  expect(runAI).toHaveBeenCalledTimes(1)
  return { ...generated, runAI }
}

function interruptBeforeConfirmation() {
  const original = events.appendAgentRunEventV1
  const spy = vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => {
    if (input.type === 'confirmation.recorded') throw new Error('017: intent saved, confirmation not written')
    return original(input)
  })
  return spy
}

async function frozenIntent(item: Fixture, generated: Generated) {
  const checkpoint = await checkpoints.readLatestVerifiedAgentRunCheckpointV1(item.scope, generated.snapshot.run.id)
  expect(checkpoint?.resumePayload).toMatchObject({ kind: 'screenplay-professional-intent' })
  return checkpoint!.resumePayload as {
    authorPayload: ScreenplayProfessionalPayloadV1
    authorPayloadHash: string
    allowReplaceDownstream?: boolean
    intentHash: string
  }
}

async function savedFacts(item: Fixture) {
  return db.adaptationSourceFacts.where('adaptationProjectId').equals(item.adaptation.id!).toArray()
}

async function expectCompletedOnce(item: Fixture, generated: Generated, intent: Awaited<ReturnType<typeof frozenIntent>>) {
  const snapshot = await events.readAgentRunV1(item.scope, generated.snapshot.run.id)
  expect(snapshot.projection.state).toBe('completed')
  for (const type of ['confirmation.recorded', 'adoption.started', 'adoption.committed', 'verification.accepted']) {
    expect(snapshot.events.filter(event => event.type === type)).toHaveLength(1)
  }
  expect(snapshot.events.find(event => event.type === 'adoption.started')?.payload).toMatchObject({ intentHash: intent.intentHash })
  expect(await frozenIntent(item, generated)).toEqual(intent)
  expect(await db.agentRunCheckpoints.where('runId').equals(generated.snapshot.run.id).count()).toBe(2)
  if (generated.candidate.stage === 'source-analysis') {
    expect((await db.adaptationProjects.get(item.adaptation.id!))?.revision).toBe(generated.candidate.adaptationRevision + 1)
  }
  return snapshot
}

async function plannedFixture(stage: 'beat-sheet' | 'scene-card') {
  const item = await fixture()
  const unitKey = item.unit.sourceUnitKey
  const brief: AdaptationBriefV1 = {
    version: 1, coreTheme: '保留一个选择', dominantEmotion: '克制', mustKeep: ['保留车票'],
    mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: [], audience: '成年观众', rating: 'PG-13',
    targetScale: '两分钟短片', narrativePerspective: '跟随检票员', timeBudget: '两分钟', costLimit: '单场景',
    deviationNotes: '保留结局', unresolvedQuestions: [], assumptions: [],
  }
  const beat = {
    stableKey: 'beat.ticket', sectionKey: 'act-one', sectionTitle: '车票', scope: 'act' as const, episodeNumber: 1, order: 0,
    objective: '检票员决定保留车票。', conflict: '列车即将离站。', turn: '他收回丢弃的手。', outcome: '车票留在抽屉。',
    causalFactKeys: ['fact.ticket'], decisionKeys: ['decision.keep'], sourceUnitKeys: [unitKey], estimatedSeconds: 120,
  }
  const card = {
    stableKey: 'scene.ticket', beatKey: beat.stableKey, episodeNumber: 1, sceneNumber: 1, order: 0,
    purpose: '让保留车票成为可见选择。', conflict: '离站广播催促。', entryState: '车票放在桌面。', exitState: '车票留在抽屉。',
    visibleAction: '检票员把车票放进抽屉。', informationReveal: '他主动保留车票。', sourceUnitKeys: [unitKey], estimatedSeconds: 120,
  }
  const stages: Array<[ScreenplayProfessionalStageV1, ScreenplayProfessionalPayloadV1]> = [
    ['source-analysis', item.facts],
    ['causal-graph', [{ stableKey: 'edge.ticket', fromFactKey: 'fact.ticket', toFactKey: 'fact.excluded', relation: 'enables', rationale: '发现车票使选择发生。', sourceUnitKeys: [unitKey] }]],
    ['adaptation-brief', brief],
    ['decision-pass', [{ stableKey: 'decision.keep', action: 'keep', sourceFactKeys: ['fact.ticket'], targetKeys: [], rationale: '保留车票结局。' }]],
    ['beat-sheet', [beat]],
    ['scene-card', [card]],
  ]
  for (const [currentStage, payload] of stages) {
    const generated = await generate(item, currentStage, payload)
    await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })
  }
  const root = (await db.adaptationProjects.get(item.adaptation.id!))!
  await startScreenplayProductionV1({ scope: item.scope, expectedAdaptationRevision: root.revision })
  const scene = await generate(item, 'scene-draft', {
    stableKey: card.stableKey, planSectionKey: beat.sectionKey, episodeNumber: 1, sceneNumber: 1, intExt: 'INT',
    location: '检票室', timeOfDay: '清晨', summary: '检票员保留车票。', estimatedSeconds: 120, sourceUnitKeys: [unitKey],
    blocks: [{ id: 'block.ticket', type: 'action', text: '检票员把车票放进抽屉。' }],
  }, [card.stableKey])
  await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: scene.snapshot.run.id })
  const payload = stage === 'beat-sheet'
    ? [{ ...beat, objective: '模型重规划提案。' }]
    : [{ ...card, purpose: '模型重规划提案。' }]
  const authorPayload = stage === 'beat-sheet'
    ? [{ ...beat, objective: '作者确认的重新规划。' }]
    : [{ ...card, purpose: '作者确认的重新规划。' }]
  const generated = await generate(item, stage, payload)
  return { ...item, generated, authorPayload }
}

describe('SFQA-017 · frozen screenplay author intent', () => {
  beforeEach(async () => {
    await db.delete(); await db.open()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('017 regression must not use network') }))
  })
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete() })

  it.each([
    { conflicting: false, reopen: false }, { conflicting: false, reopen: true },
    { conflicting: true, reopen: false }, { conflicting: true, reopen: true },
  ])('recovers the original checkpoint/confirmation crash: $conflicting/$reopen', async ({ conflicting, reopen }) => {
    const item = await fixture()
    const generated = await generate(item, 'source-analysis', item.facts)
    const authorPayload = [{ ...item.facts[0], statement: '作者确认：检票员妥善保留车票。' }]
    const crash = interruptBeforeConfirmation()
    await expect(adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id, authorPayload })).rejects.toThrow('017: intent saved')
    crash.mockRestore()
    const intent = await frozenIntent(item, generated)
    expect(intent.authorPayload).toEqual(authorPayload)
    expect(await listScreenplayTasksV1(item.scope)).toEqual([{ id: generated.snapshot.run.id, status: 'awaiting_confirmation', intent: true }])
    if (reopen) { db.close(); await db.open() }
    await adoptScreenplayProfessionalCandidateV1({
      scope: item.scope, runId: generated.snapshot.run.id,
      ...(conflicting ? { authorPayload: [item.facts[1]], allowReplaceDownstream: true } : {}),
    })
    expect((await savedFacts(item)).map(row => row.statement)).toEqual([authorPayload[0].statement])
    await expectCompletedOnce(item, generated, intent)
    expect(generated.runAI).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['before-adoption-started', 'adoption.started', 'formal.written', 'adoption.committed', 'verification.accepted'] as const)(
    'resumes %s exactly once without accepting new recovery input', async boundary => {
      const item = await fixture()
      const generated = await generate(item, 'source-analysis', item.facts)
      const authorPayload = [{ ...item.facts[0], statement: '作者冻结并只保留这一项。' }]
      const original = events.appendAgentRunEventV1
      const crash = boundary === 'before-adoption-started'
        ? vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => {
          if (input.type === 'adoption.started') throw new Error('017: boundary crash')
          return original(input)
        }) : null
      await expect(adoptScreenplayProfessionalCandidateV1({
        scope: item.scope, runId: generated.snapshot.run.id, authorPayload,
        onDurableBoundary: current => { if (current === boundary) throw new Error('017: boundary crash') },
      })).rejects.toThrow('017: boundary crash')
      crash?.mockRestore()
      const intent = await frozenIntent(item, generated)
      db.close(); await db.open()
      const recovered = await adoptScreenplayProfessionalCandidateV1({
        scope: item.scope, runId: generated.snapshot.run.id,
        authorPayload: [{ ...item.facts[1], statement: '恢复输入不能替代冻结作者决定。' }], allowReplaceDownstream: true,
      })
      expect((await savedFacts(item)).map(row => row.statement)).toEqual([authorPayload[0].statement])
      const snapshot = await expectCompletedOnce(item, generated, intent)
      const again = await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })
      expect(again.receiptHash).toBe(recovered.receiptHash)
      expect(again.snapshot.projection.lastSequence).toBe(snapshot.projection.lastSequence)
      expect(generated.runAI).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    ['beat-sheet', undefined], ['beat-sheet', false], ['beat-sheet', true],
    ['scene-card', undefined], ['scene-card', false], ['scene-card', true],
  ] as const)('preserves %s replacement authorization when recovery supplies %s', async (stage, resumeAuthorization) => {
    const item = await plannedFixture(stage)
    const before = await db.screenplayScenes.where('adaptationProjectId').equals(item.adaptation.id!).toArray()
    expect(before).toHaveLength(1)
    const crash = interruptBeforeConfirmation()
    await expect(adoptScreenplayProfessionalCandidateV1({
      scope: item.scope, runId: item.generated.snapshot.run.id, authorPayload: item.authorPayload, allowReplaceDownstream: true,
    })).rejects.toThrow('017: intent saved')
    crash.mockRestore()
    const intent = await frozenIntent(item, item.generated)
    expect(intent.allowReplaceDownstream).toBe(true)
    expect(await db.screenplayScenes.where('adaptationProjectId').equals(item.adaptation.id!).toArray()).toEqual(before)
    db.close(); await db.open()
    await adoptScreenplayProfessionalCandidateV1({
      scope: item.scope, runId: item.generated.snapshot.run.id,
      authorPayload: item.generated.candidate.payload, allowReplaceDownstream: resumeAuthorization,
    })
    expect(await db.screenplayScenes.where('adaptationProjectId').equals(item.adaptation.id!).count()).toBe(0)
    const rows = stage === 'beat-sheet'
      ? await db.screenplayBeats.where('adaptationProjectId').equals(item.adaptation.id!).toArray()
      : await db.screenplaySceneCards.where('adaptationProjectId').equals(item.adaptation.id!).toArray()
    expect(rows).toEqual([expect.objectContaining(item.authorPayload[0])])
    await expectCompletedOnce(item, item.generated, intent)
    expect(item.generated.runAI).toHaveBeenCalledTimes(1)
  })

  it.each(['beat-sheet', 'scene-card'] as const)('requires author authorization before creating a destructive %s intent', async stage => {
    const item = await plannedFixture(stage)
    const before = await db.screenplayScenes.where('adaptationProjectId').equals(item.adaptation.id!).toArray()
    await expect(adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: item.generated.snapshot.run.id })).rejects.toThrow('明确确认下游替换')
    expect(await db.screenplayScenes.where('adaptationProjectId').equals(item.adaptation.id!).toArray()).toEqual(before)
    expect(await listScreenplayTasksV1(item.scope)).toEqual([{ id: item.generated.snapshot.run.id, status: 'awaiting_confirmation', intent: false }])
  })

  it('can establish the first intent when an earlier checkpoint attempt wrote nothing', async () => {
    const item = await fixture()
    const generated = await generate(item, 'source-analysis', item.facts)
    const failed = vi.spyOn(checkpoints, 'createAgentRunCheckpointV1').mockRejectedValueOnce(new Error('017: checkpoint not saved'))
    await expect(adoptScreenplayProfessionalCandidateV1({
      scope: item.scope, runId: generated.snapshot.run.id, authorPayload: [item.facts[1]],
    })).rejects.toThrow('017: checkpoint not saved')
    failed.mockRestore()
    expect(await listScreenplayTasksV1(item.scope)).toEqual([{ id: generated.snapshot.run.id, status: 'awaiting_confirmation', intent: false }])
    const authorPayload = [{ ...item.facts[0], statement: '尚无冻结意图时的新作者决定。' }]
    await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id, authorPayload })
    expect((await savedFacts(item)).map(row => row.statement)).toEqual([authorPayload[0].statement])
    const intent = await frozenIntent(item, generated)
    await expectCompletedOnce(item, generated, intent)
  })

  it('accepts the original candidate when the author has not supplied an edited payload', async () => {
    const item = await fixture()
    const generated = await generate(item, 'source-analysis', item.facts)
    await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })
    expect((await savedFacts(item)).map(row => row.statement)).toEqual(item.facts.map(row => row.statement))
    const intent = await frozenIntent(item, generated)
    expect(intent.authorPayload).toEqual(generated.candidate.payload)
    await expectCompletedOnce(item, generated, intent)
  })

  it.each(['before-confirmation', 'after-confirmation'] as const)('refuses stale sources %s without replacing the intent', async boundary => {
    const item = await fixture()
    const generated = await generate(item, 'source-analysis', item.facts)
    const authorPayload = [{ ...item.facts[0], statement: '过期前作者冻结的决定。' }]
    const original = events.appendAgentRunEventV1
    const crash = vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => {
      if (input.type === (boundary === 'before-confirmation' ? 'confirmation.recorded' : 'adoption.started')) throw new Error('017: stale crash')
      return original(input)
    })
    await expect(adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id, authorPayload })).rejects.toThrow('017: stale crash')
    crash.mockRestore()
    const intent = await frozenIntent(item, generated)
    const newContent = '<p>作者后来改为把车票交给失主。</p>'
    await db.chapters.update(item.chapter.id!, { content: newContent, updatedAt: Date.now() })
    await expect(adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })).rejects.toThrow('stale')
    expect(await savedFacts(item)).toHaveLength(0)
    expect((await db.chapters.get(item.chapter.id!))?.content).toBe(newContent)
    expect(await frozenIntent(item, generated)).toEqual(intent)
    expect(generated.runAI).toHaveBeenCalledTimes(1)
  })

  it('rejects another Work without changing the original intent or events', async () => {
    const item = await fixture()
    const generated = await generate(item, 'source-analysis', item.facts)
    const crash = interruptBeforeConfirmation()
    await expect(adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id, authorPayload: [item.facts[0]] })).rejects.toThrow('017: intent saved')
    crash.mockRestore()
    const intent = await frozenIntent(item, generated)
    const before = await events.readAgentRunV1(item.scope, generated.snapshot.run.id)
    const other = await fixture()
    await expect(adoptScreenplayProfessionalCandidateV1({ scope: other.scope, runId: generated.snapshot.run.id })).rejects.toThrow()
    expect(await events.readAgentRunV1(item.scope, generated.snapshot.run.id)).toEqual(before)
    expect(await frozenIntent(item, generated)).toEqual(intent)
    expect(await savedFacts(item)).toHaveLength(0)
    expect(await savedFacts(other)).toHaveLength(0)
  })

  it.each(['authorPayloadHash', 'intentHash'] as const)('rejects a damaged %s without recreating author authority', async hashField => {
    const item = await fixture()
    const generated = await generate(item, 'source-analysis', item.facts)
    const crash = interruptBeforeConfirmation()
    await expect(adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id, authorPayload: [item.facts[0]] })).rejects.toThrow('017: intent saved')
    crash.mockRestore()
    const intent = await frozenIntent(item, generated)
    const damaged = { ...intent, [hashField]: '0'.repeat(64) }
    await checkpoints.createAgentRunCheckpointV1({ scope: item.scope, runId: generated.snapshot.run.id, resumePayload: damaged })
    const before = await events.readAgentRunV1(item.scope, generated.snapshot.run.id)
    await expect(adoptScreenplayProfessionalCandidateV1({
      scope: item.scope, runId: generated.snapshot.run.id, authorPayload: item.facts, allowReplaceDownstream: true,
    })).rejects.toThrow('hash 不匹配')
    expect(await events.readAgentRunV1(item.scope, generated.snapshot.run.id)).toEqual(before)
    expect((await checkpoints.readLatestVerifiedAgentRunCheckpointV1(item.scope, generated.snapshot.run.id))?.resumePayload).toEqual(damaged)
    expect(await savedFacts(item)).toHaveLength(0)
  })

  it.each(['single-conflict', 'correct-then-conflict', 'conflict-then-correct'] as const)('validates the full started hash collection: %s', async order => {
    const item = await fixture()
    const generated = await generate(item, 'source-analysis', item.facts)
    const original = events.appendAgentRunEventV1
    const crash = vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => {
      if (input.type === 'adoption.started') throw new Error('017: confirmation saved')
      return original(input)
    })
    await expect(adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id, authorPayload: [item.facts[0]] })).rejects.toThrow('017: confirmation saved')
    crash.mockRestore()
    const intent = await frozenIntent(item, generated)
    const hashes = order === 'single-conflict' ? ['0'.repeat(64)]
      : order === 'correct-then-conflict' ? [intent.intentHash, '0'.repeat(64)]
        : ['0'.repeat(64), intent.intentHash]
    for (const intentHash of hashes) await events.appendAgentRunEventV1({
      scope: item.scope, runId: generated.snapshot.run.id, type: 'adoption.started',
      payload: { stepId: 'screenplay-professional:source-analysis', candidateHash: generated.candidate.candidateHash, intentHash },
    })
    const before = await events.readAgentRunV1(item.scope, generated.snapshot.run.id)
    await expect(adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })).rejects.toThrow('采纳开始事件与冻结意图不匹配')
    expect(await events.readAgentRunV1(item.scope, generated.snapshot.run.id)).toEqual(before)
    expect(await frozenIntent(item, generated)).toEqual(intent)
    expect(await savedFacts(item)).toHaveLength(0)
  })

  it('keeps two identical recorded starts and completes the frozen author choice only once', async () => {
    const item = await fixture()
    const generated = await generate(item, 'source-analysis', item.facts)
    const authorPayload = [{ ...item.facts[0], statement: '重复开始证据也只采用这份作者决定。' }]
    const original = events.appendAgentRunEventV1
    const crash = vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => {
      if (input.type === 'adoption.started') throw new Error('017: confirmation saved')
      return original(input)
    })
    await expect(adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id, authorPayload })).rejects.toThrow('017: confirmation saved')
    crash.mockRestore()
    const intent = await frozenIntent(item, generated)
    for (let index = 0; index < 2; index++) await events.appendAgentRunEventV1({
      scope: item.scope, runId: generated.snapshot.run.id, type: 'adoption.started',
      payload: { stepId: 'screenplay-professional:source-analysis', candidateHash: generated.candidate.candidateHash, intentHash: intent.intentHash },
    })
    const before = await events.readAgentRunV1(item.scope, generated.snapshot.run.id)
    const recovered = await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })
    expect(recovered.snapshot.events.slice(0, before.events.length)).toEqual(before.events)
    expect(recovered.snapshot.events.filter(event => event.type === 'adoption.started')).toHaveLength(2)
    for (const type of ['confirmation.recorded', 'adoption.committed', 'verification.accepted']) {
      expect(recovered.snapshot.events.filter(event => event.type === type)).toHaveLength(1)
    }
    expect((await savedFacts(item)).map(row => row.statement)).toEqual([authorPayload[0].statement])
    expect((await db.adaptationProjects.get(item.adaptation.id!))?.revision).toBe(generated.candidate.adaptationRevision + 1)
    expect(await frozenIntent(item, generated)).toEqual(intent)
    const again = await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })
    expect(again.snapshot).toEqual(recovered.snapshot)
    expect(again.receiptHash).toBe(recovered.receiptHash)
    expect(generated.runAI).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('checks recorded start hashes before a post-commit receipt; conflicting=%s', async conflicting => {
    const item = await fixture()
    const generated = await generate(item, 'source-analysis', item.facts)
    const authorPayload = [{ ...item.facts[0], statement: '正式写入后仍只保留这份作者决定。' }]
    await expect(adoptScreenplayProfessionalCandidateV1({
      scope: item.scope, runId: generated.snapshot.run.id, authorPayload,
      onDurableBoundary: boundary => { if (boundary === 'adoption.committed') throw new Error('017: committed before receipt') },
    })).rejects.toThrow('017: committed before receipt')
    const intent = await frozenIntent(item, generated)
    await events.appendAgentRunEventV1({
      scope: item.scope, runId: generated.snapshot.run.id, type: 'adoption.started',
      payload: {
        stepId: 'screenplay-professional:source-analysis', candidateHash: generated.candidate.candidateHash,
        intentHash: conflicting ? '0'.repeat(64) : intent.intentHash,
      },
    })
    const before = await events.readAgentRunV1(item.scope, generated.snapshot.run.id)
    const facts = await savedFacts(item)
    const root = await db.adaptationProjects.get(item.adaptation.id!)
    if (conflicting) {
      await expect(adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })).rejects.toThrow('采纳开始事件与冻结意图不匹配')
      expect(await events.readAgentRunV1(item.scope, generated.snapshot.run.id)).toEqual(before)
    } else {
      const recovered = await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })
      expect(recovered.snapshot.projection.state).toBe('completed')
      expect(recovered.snapshot.events.slice(0, before.events.length)).toEqual(before.events)
      expect(recovered.snapshot.events.filter(event => event.type === 'adoption.started')).toHaveLength(2)
      expect(recovered.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
      expect(recovered.snapshot.events.filter(event => event.type === 'verification.accepted')).toHaveLength(1)
      expect(await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })).toEqual(recovered)
    }
    expect(await savedFacts(item)).toEqual(facts)
    expect(await db.adaptationProjects.get(item.adaptation.id!)).toEqual(root)
    expect(await frozenIntent(item, generated)).toEqual(intent)
  })

  it.each([false, true])('finishes a legal legacy commit without rewriting optional evidence; hashless started=%s', async hashlessStarted => {
    const item = await fixture()
    const generated = await generate(item, 'source-analysis', item.facts)
    const authorPayload = [{ ...item.facts[0], statement: '旧合同已正式采用的作者决定。' }]
    const original = events.appendAgentRunEventV1
    const crash = vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => {
      if (input.type === 'adoption.started') throw new Error('017: confirmation saved')
      return original(input)
    })
    await expect(adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id, authorPayload })).rejects.toThrow('017: confirmation saved')
    crash.mockRestore()
    const intent = await frozenIntent(item, generated)
    if (hashlessStarted) await events.appendAgentRunEventV1({
      scope: item.scope, runId: generated.snapshot.run.id, type: 'adoption.started',
      payload: { stepId: 'screenplay-professional:source-analysis', candidateHash: generated.candidate.candidateHash },
    })
    // The old public recovery path could commit after confirmation without a
    // started event. Reproduce that valid forward history through its services.
    await adoptAdaptationSourceFactsV1({
      scope: item.scope, adaptationProjectId: item.adaptation.id!, expectedAdaptationRevision: generated.candidate.adaptationRevision,
      sourceManifestVersion: generated.candidate.sourceManifestVersion,
      items: authorPayload.map(candidate => ({ candidate, authorStatus: 'confirmed' })), replaceExisting: false,
    })
    const facts = await savedFacts(item)
    const stateHash = await hashCanonicalValue(facts)
    const before = await events.appendAgentRunEventV1({
      scope: item.scope, runId: generated.snapshot.run.id, type: 'adoption.committed',
      payload: {
        stepId: 'screenplay-professional:source-analysis', candidateHash: generated.candidate.candidateHash,
        adoptionHash: await hashCanonicalValue({ intentHash: intent.intentHash, stateHash }),
      },
    })
    const recovered = await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })
    expect(recovered.snapshot.projection.state).toBe('completed')
    expect(recovered.snapshot.events.slice(0, before.events.length)).toEqual(before.events)
    const starts = recovered.snapshot.events.filter(event => event.type === 'adoption.started')
    expect(starts).toHaveLength(hashlessStarted ? 1 : 0)
    if (hashlessStarted) expect(starts[0].payload).not.toHaveProperty('intentHash')
    expect(recovered.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
    expect(recovered.snapshot.events.filter(event => event.type === 'verification.accepted')).toHaveLength(1)
    expect(await savedFacts(item)).toEqual(facts)
    expect(await frozenIntent(item, generated)).toEqual(intent)
    expect(await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })).toEqual(recovered)
  })

  it('resumes a legitimate legacy uncommitted started event without its optional intent hash', async () => {
    const item = await fixture()
    const generated = await generate(item, 'source-analysis', item.facts)
    const authorPayload = [{ ...item.facts[0], statement: '旧开始事件没有可选hash，也只采用冻结作者稿。' }]
    const original = events.appendAgentRunEventV1
    const crash = vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => {
      if (input.type === 'adoption.started') throw new Error('017: confirmation saved')
      return original(input)
    })
    await expect(adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id, authorPayload })).rejects.toThrow('017: confirmation saved')
    crash.mockRestore()
    const intent = await frozenIntent(item, generated)
    const before = await events.appendAgentRunEventV1({
      scope: item.scope, runId: generated.snapshot.run.id, type: 'adoption.started',
      payload: { stepId: 'screenplay-professional:source-analysis', candidateHash: generated.candidate.candidateHash },
    })
    const recovered = await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id, authorPayload: item.facts })
    expect(recovered.snapshot.projection.state).toBe('completed')
    expect(recovered.snapshot.events.slice(0, before.events.length)).toEqual(before.events)
    const starts = recovered.snapshot.events.filter(event => event.type === 'adoption.started')
    expect(starts).toHaveLength(1)
    expect(starts[0].payload).not.toHaveProperty('intentHash')
    expect(recovered.snapshot.events.filter(event => event.type === 'confirmation.recorded')).toHaveLength(1)
    expect(recovered.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
    expect(recovered.snapshot.events.filter(event => event.type === 'verification.accepted')).toHaveLength(1)
    expect((await savedFacts(item)).map(row => row.statement)).toEqual([authorPayload[0].statement])
    expect(await frozenIntent(item, generated)).toEqual(intent)
    expect(await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })).toEqual(recovered)
  })

  it('does not overwrite a persisted intent when an older concurrent caller already read an empty intent', async () => {
    const item = await fixture()
    const generated = await generate(item, 'source-analysis', item.facts)
    const original = checkpoints.createAgentRunCheckpointV1
    let release!: () => void
    let reached!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { reached = resolve })
    let first = true
    const pause = vi.spyOn(checkpoints, 'createAgentRunCheckpointV1').mockImplementation(async input => {
      if (first) { first = false; reached(); await hold }
      return original(input)
    })
    const crash = interruptBeforeConfirmation()
    const pending = adoptScreenplayProfessionalCandidateV1({
      scope: item.scope, runId: generated.snapshot.run.id, authorPayload: [item.facts[1]],
    }).then(() => ({ error: null as unknown }), (error: unknown) => ({ error }))
    await ready
    const authorPayload = [{ ...item.facts[0], statement: '首先持久化的作者决定不得被旧读状态覆写。' }]
    await expect(adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id, authorPayload })).rejects.toThrow('017: intent saved')
    const intent = await frozenIntent(item, generated)
    const before = await events.readAgentRunV1(item.scope, generated.snapshot.run.id)
    release()
    const result = await pending
    pause.mockRestore(); crash.mockRestore()
    expect(await frozenIntent(item, generated)).toEqual(intent)
    expect(await events.readAgentRunV1(item.scope, generated.snapshot.run.id)).toEqual(before)
    expect(String(result.error)).toContain('运行已推进')
    await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })
    expect((await savedFacts(item)).map(row => row.statement)).toEqual([authorPayload[0].statement])
    await expectCompletedOnce(item, generated, intent)
  })
})
