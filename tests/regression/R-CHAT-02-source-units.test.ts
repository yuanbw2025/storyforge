import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {readAgentRunV1} from '../../src/lib/agent/run/event-store'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {saveChatDraftV1, createChatDraftV3} from '../../src/lib/character-interaction/draft-service'
import {readChatSourceUnitsContextV1} from '../../src/lib/character-interaction/source-units-context'
import {parseChatSourceUnitsCandidateV1, validateChatSourceUnitsEvidenceV1, parseChatSourceUnitsReviewV1, sameChatSourceUnitsCandidateV1} from '../../src/lib/character-interaction/source-units'
import {generateChatSourceUnitsV1, readChatSourceUnitsRunV1, readLatestChatSourceUnitsRunV1, recoverChatSourceUnitsRunV1, cancelChatSourceUnitsRunV1,
  reviewChatSourceUnitsV1, readChatSourceUnitsReviewRunV1, readLatestChatSourceUnitsReviewRunV1, recoverChatSourceUnitsReviewRunV1, cancelChatSourceUnitsReviewRunV1} from '../../src/lib/character-interaction/source-units-harness'
import {seedChatSourceUnitsFixture, sourceUnitsReviewFixture, SOURCE_UNITS_FIXTURE_TEXT} from '../helpers/chat-source-units'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

it('retains full selected source and separate registered candidate/review runs without production or knowledge writes', async () => {
  const f = await seedChatSourceUnitsFixture(), before = await db.chatAuthoringDrafts.toArray(), worlds = await db.worldReleases.toArray()
  const generated = await generateChatSourceUnitsV1({scope: f.scope, request: f.request, runAI: async messages => {
    expect(messages[1].content).toContain(SOURCE_UNITS_FIXTURE_TEXT)
    expect(messages[1].content).not.toContain('失踪船队的名册')
    return JSON.stringify(f.candidate)
  }})
  expect(generated.status).toBe('ready'); expect(generated.result?.candidate).toEqual(f.candidate)
  expect(generated.result?.artifact.issues[0].message).toContain('尚未复核')
  const reviewed = await reviewChatSourceUnitsV1({scope: f.scope, request: {source: f.request, candidate: f.candidate}, runAI: async messages => {
    expect(messages[0].content).toContain('独立资料复核员')
    expect(messages[1].content).toContain(SOURCE_UNITS_FIXTURE_TEXT)
    expect(messages[1].content).toContain('initial-knowledge')
    return JSON.stringify(sourceUnitsReviewFixture(f.candidate))
  }})
  expect(reviewed.status).toBe('ready'); expect(reviewed.result?.passed).toBe(true)
  expect(reviewed.context?.candidate).toEqual(f.candidate)
  expect(reviewed.result?.artifact.callEvidence).toHaveLength(1)
  expect(await db.chatAuthoringDrafts.toArray()).toEqual(before); expect(await db.worldReleases.toArray()).toEqual(worlds)
  for (const [id, key] of [[generated.runId, 'chat.source-units'], [reviewed.runId, 'chat.source-units-review']] as const) {
    const run = await readAgentRunV1(f.scope, id)
    expect(run.projection.state).toBe('completed')
    expect(run.contract.permissions).toEqual({contextSourceKeys: [key], writeTargets: []})
    expect(run.events.filter(row => row.type === 'model.requested')).toHaveLength(1)
    expect(run.events.some(row => row.type === 'adoption.committed')).toBe(false)
  }
})

it('rejects missing source, forged quotes, duplicate keys and permission fields before dispatching review', async () => {
  const f = await seedChatSourceUnitsFixture(), context = await readChatSourceUnitsContextV1(f.scope, f.request)
  const base = f.candidate.fragments[0], fact = base.facts[0]
  for (const candidate of [{fragments: []}, {fragments: [base, base]}, {fragments: [{...base, fragmentKey: 'foreign'}]},
    {fragments: [{...base, facts: [{...fact, audienceKeys: ['player']}]}]}, {fragments: [{...base, facts: [fact, fact]}]},
    {fragments: [{...base, facts: [{...fact, quotes: ['掌柜已向守卫承认']}]}]}, {fragments: [{...base, facts: [], constraints: []}]}]) {
    expect(() => validateChatSourceUnitsEvidenceV1(candidate, context)).toThrow()
    const runAI = vi.fn(async () => '{}')
    await expect(reviewChatSourceUnitsV1({scope: f.scope, request: {source: f.request, candidate: candidate as typeof f.candidate}, runAI})).rejects.toThrow()
    expect(runAI).not.toHaveBeenCalled()
  }
  expect(() => parseChatSourceUnitsCandidateV1({...f.candidate, approved: true})).toThrow()
})

it.each(['faithful', 'atomic', 'standalone', 'established', 'complete', 'constraint'] as const)('retains independent %s rejection without repair or changing the candidate', async flag => {
  const f = await seedChatSourceUnitsFixture(), report = sourceUnitsReviewFixture(f.candidate)
  if (flag === 'complete') report.fragments[0].complete = false
  else if (flag === 'constraint') report.fragments[0].constraints[0].faithful = false
  else report.fragments[0].facts[0][flag] = false
  const call = vi.fn(async () => JSON.stringify(report))
  const result = await reviewChatSourceUnitsV1({scope: f.scope, request: {source: f.request, candidate: f.candidate}, runAI: call})
  expect(result.status).toBe('ready') // The report is durable; it is not candidate approval.
  expect(result.result?.passed).toBe(false); expect(result.result?.artifact.status).toBe('blocked')
  expect(result.result?.report).toEqual(report); expect(result.context?.candidate).toEqual(f.candidate)
  expect(call).toHaveBeenCalledTimes(1)
  expect((await readAgentRunV1(f.scope, result.runId)).events.some(row => row.type === 'adoption.committed')).toBe(false)
})

it('requires exhaustive independent verdicts, rejecting omissions, duplicates, extras and string booleans', async () => {
  const f = await seedChatSourceUnitsFixture(), report = sourceUnitsReviewFixture(f.candidate), row = report.fragments[0]
  for (const value of [{fragments: []}, {fragments: [{...row, facts: row.facts.slice(1)}]}, {fragments: [{...row, constraints: []}]},
    {fragments: [{...row, facts: [row.facts[0], row.facts[0], row.facts[0]]}]}, {fragments: [{...row, complete: 'true'}]}, {...report, passed: true}])
    expect(() => parseChatSourceUnitsReviewV1(value, f.candidate)).toThrow()
  const result = await reviewChatSourceUnitsV1({scope: f.scope, request: {source: f.request, candidate: f.candidate}, runAI: async () => JSON.stringify({fragments: []})})
  expect(result.status).toBe('blocked'); expect(result.result?.passed).toBe(false); expect(result.result?.artifact.originalText).toBe('{"fragments":[]}')
})

it.each(['response.saved', 'model.responded', 'candidate.persisted'] as const)('recovers both phases after %s without sending again', async boundary => {
  const f = await seedChatSourceUnitsFixture()
  for (const phase of ['generation', 'review'] as const) {
    let id = 0; const call = vi.fn(async () => JSON.stringify(phase === 'generation' ? f.candidate : sourceUnitsReviewFixture(f.candidate)))
    const onBoundary = (step: string, runId: number) => {id = runId; if (step === boundary) throw new Error('interruption')}
    const task = phase === 'generation' ? generateChatSourceUnitsV1({scope: f.scope, request: f.request, runAI: call, onBoundary})
      : reviewChatSourceUnitsV1({scope: f.scope, request: {source: f.request, candidate: f.candidate}, runAI: call, onBoundary})
    await expect(task).rejects.toThrow('interruption')
    const recover = phase === 'generation' ? recoverChatSourceUnitsRunV1 : recoverChatSourceUnitsReviewRunV1
    const restored = await recover(f.scope, id)
    expect(restored.status).toBe('ready'); expect(await recover(f.scope, id)).toEqual(restored)
    expect(call).toHaveBeenCalledTimes(1)
  }
})

it('keeps unknown review requests through refresh and forbids retry until explicit dismissal', async () => {
  const f = await seedChatSourceUnitsFixture(), request = {source: f.request, candidate: f.candidate}
  const call = vi.fn(async () => {throw new Error('lost response')})
  await expect(reviewChatSourceUnitsV1({scope: f.scope, request, runAI: call})).rejects.toThrow('lost response')
  const saved = (await readLatestChatSourceUnitsReviewRunV1(f.scope))!
  expect(saved.status).toBe('unknown'); expect(saved.context?.candidate).toEqual(f.candidate)
  const next = vi.fn(async () => JSON.stringify(sourceUnitsReviewFixture(f.candidate)))
  await expect(recoverChatSourceUnitsReviewRunV1(f.scope, saved.runId)).rejects.toThrow('不能自动重发')
  await expect(reviewChatSourceUnitsV1({scope: f.scope, request, runAI: next})).rejects.toThrow('尚未结束')
  expect(next).not.toHaveBeenCalled()
  await cancelChatSourceUnitsReviewRunV1(f.scope, saved.runId)
  expect((await reviewChatSourceUnitsV1({scope: f.scope, request, runAI: next})).result?.passed).toBe(true)
  expect(call).toHaveBeenCalledTimes(1); expect(next).toHaveBeenCalledTimes(1)
})

it('binds the review to the exact edited candidate and source revision, keeping a concurrent author edit intact', async () => {
  const f = await seedChatSourceUnitsFixture(), request = {source: f.request, candidate: structuredClone(f.candidate)}
  const result = await reviewChatSourceUnitsV1({scope: f.scope, request, runAI: async () => {
    request.candidate.fragments[0].facts[0].text = '调用中改变的草稿'
    await saveChatDraftV1(f.scope, f.draft.revision, {...f.settings, playerRole: '作者的新设定'})
    return JSON.stringify(sourceUnitsReviewFixture(f.candidate))
  }})
  expect(result.status).toBe('stale'); expect(result.context?.candidate).toEqual(f.candidate)
  expect(sameChatSourceUnitsCandidateV1(result.context?.candidate, request.candidate)).toBe(false)
  expect(JSON.parse((await db.chatAuthoringDrafts.get(f.draft.id!))!.settingsJson).playerRole).toBe('作者的新设定')
})

it('blocks stale and actor-scoped requests before dispatch and enforces owner checks for both histories', async () => {
  const f = await seedChatSourceUnitsFixture(), runAI = vi.fn(async () => JSON.stringify(f.candidate))
  for (const request of [{...f.request, draftRevision: 999}, {...f.request, actorKey: f.keys[0]}])
    await expect(generateChatSourceUnitsV1({scope: f.scope, request, runAI})).rejects.toThrow()
  expect(runAI).not.toHaveBeenCalled()
  const view = await generateChatSourceUnitsV1({scope: f.scope, request: f.request, runAI})
  const reviewed = await reviewChatSourceUnitsV1({scope: f.scope, request: {source: f.request, candidate: f.candidate}, runAI: async () => JSON.stringify(sourceUnitsReviewFixture(f.candidate))})
  const other = await createChatDraftV3('另一作品')
  for (const action of [readChatSourceUnitsRunV1, recoverChatSourceUnitsRunV1, cancelChatSourceUnitsRunV1]) await expect(action(other.scope, view.runId)).rejects.toThrow()
  for (const action of [readChatSourceUnitsReviewRunV1, recoverChatSourceUnitsReviewRunV1, cancelChatSourceUnitsReviewRunV1]) await expect(action(other.scope, reviewed.runId)).rejects.toThrow()
})

it('round-trips both source-bound histories and original raw responses, restoring receipts without model access', async () => {
  const f = await seedChatSourceUnitsFixture(), generated = await generateChatSourceUnitsV1({scope: f.scope, request: f.request, runAI: async () => JSON.stringify(f.candidate)})
  const reviewed = await reviewChatSourceUnitsV1({scope: f.scope, request: {source: f.request, candidate: f.candidate}, runAI: async () => JSON.stringify(sourceUnitsReviewFixture(f.candidate))})
  const id = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), draft = (await db.chatAuthoringDrafts.where('projectId').equals(id).first())!
  const scope = {projectId: id, workId: draft.workId, worldId: draft.worldId}
  const importedGeneration = (await readLatestChatSourceUnitsRunV1(scope))!, importedReview = (await readLatestChatSourceUnitsReviewRunV1(scope))!
  expect(importedGeneration.status).toBe('pending'); expect(importedReview.status).toBe('pending')
  const restoredGeneration = await recoverChatSourceUnitsRunV1(scope, importedGeneration.runId)
  const restoredReview = await recoverChatSourceUnitsReviewRunV1(scope, importedReview.runId)
  expect(restoredGeneration.status).toBe('ready'); expect(restoredReview.status).toBe('ready')
  expect(restoredGeneration.context).toEqual(generated.context); expect(restoredGeneration.result).toEqual(generated.result)
  expect(restoredReview.context).toEqual(reviewed.context); expect(restoredReview.result).toEqual(reviewed.result)
})
