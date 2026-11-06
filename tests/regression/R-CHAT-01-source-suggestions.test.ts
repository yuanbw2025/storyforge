import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedChatBackgroundSourceFixture, chatStructuredWorldRulesFixture} from '../helpers/chat-background-source'
import {readChatSourceReviewContextV1} from '../../src/lib/character-interaction/source-review-context'
import {parseChatSourceSuggestionsV1} from '../../src/lib/character-interaction/source-review-suggestions'
import {generateChatSourceReviewSuggestionsV1, readLatestChatSourceReviewRunV1, readChatSourceReviewRunV1, recoverChatSourceReviewRunV1, cancelChatSourceReviewRunV1, type ChatSourceReviewBoundaryV1} from '../../src/lib/character-interaction/source-review-harness'
import {readAgentRunV1} from '../../src/lib/agent/run/event-store'
import {saveChatDraftV1, createChatDraftV2, confirmChatSourceReviewV1, loadChatSourceProjectionV1, selectChatWorldV1} from '../../src/lib/character-interaction/draft-service'
import {createWorldPackage} from '../../src/lib/world-engine/world-package'
import {installWorldSourcePackageV1} from '../../src/lib/world-engine/source-receipt'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

async function fixture() {
  const f = await seedChatBackgroundSourceFixture(chatStructuredWorldRulesFixture())
  const rules = f.projection.background!.find(row => row.resourceKind === 'world-rules')!
  const fragment = rules.fragments.find(row => row.pointer === '/entries/harbor~1public/fictionalAdaptations')!
  const request = {draftRevision: f.draft.revision, projectionHash: f.projection.projectionHash, fragmentKeys: [fragment.fragmentKey]}
  const context = await readChatSourceReviewContextV1(f.scope, request)
  const output = {suggestions: [{fragmentKey: fragment.fragmentKey, purpose: 'knowledge', interpretation: '这条规则说明铃声与检查水尺的关系，具体谁知道仍由作者判断。', caution: 'uncertain', evidenceQuotes: ['蓝铃响起时先检查水尺']}]}
  return {...f, request, context, output}
}

it('generates a grounded CreativeArtifact with one registered read-only run and never changes author decisions', async () => {
  const f = await fixture(), runAI = vi.fn(async () => JSON.stringify(f.output))
  const before = await db.chatAuthoringDrafts.toArray(), worlds = await db.worldReleases.toArray()
  const view = await generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI})
  expect(view.status).toBe('ready')
  expect(view.result?.suggestions).toEqual(f.output)
  expect(view.result?.artifact).toMatchObject({status: 'usable-with-warnings', qualityMode: 'economy', repair: null})
  expect(view.result?.artifact.callEvidence).toHaveLength(1)
  expect(view.result?.artifact.issues[0].code).toBe('author-interpretation-required')
  expect(runAI).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(runAI.mock.calls)).not.toContain('失踪船队的名册')
  expect(await db.chatAuthoringDrafts.toArray()).toEqual(before)
  expect(await db.worldReleases.toArray()).toEqual(worlds)
  const run = await readAgentRunV1(f.scope, view.runId)
  expect(run.projection.state).toBe('completed')
  expect(run.contract.permissions).toEqual({contextSourceKeys: ['chat.source-review'], writeTargets: []})
  expect(run.contract.executionBindings?.[0].formalEntry?.entryId).toBe('chat.source-review')
  expect(run.events.filter(row => row.type === 'model.requested')).toHaveLength(1)
  expect(run.events.filter(row => row.type === 'verification.accepted')).toHaveLength(1)
  expect(await readLatestChatSourceReviewRunV1(f.scope)).toEqual(view)
})

async function installDeclaredChatSource(f: Awaited<ReturnType<typeof fixture>>) {
  return installWorldSourcePackageV1(f.scope, await createWorldPackage(f.world.release.id!, {
    authorName: '021 合成作者', attribution: '原署名', license: 'CC-BY-4.0', contentWarnings: ['原警告'],
    allowedUses: { 'world-remix': false, ttrpg: false, 'character-interaction': true, 'ai-town': false,
      'text-adventure': false, avg: false, 'text-open-world': false },
  }))
}

it('021 preserves valid legacy native settings when reselecting that same release, but clears them on a different D', async () => {
  const f = await fixture()
  const confirmed = await confirmChatSourceReviewV1(f.scope, f.draft.revision, f.review)
  await db.chatAuthoringDrafts.where('id').equals(confirmed.id!).modify(row => { delete row.sourcePurpose })
  const reselected = await selectChatWorldV1(f.scope, confirmed.revision, f.world.release.id!)
  expect(reselected.worldReleaseId).toBe(confirmed.worldReleaseId)
  expect(JSON.parse(reselected.settingsJson)).toEqual(JSON.parse(confirmed.settingsJson))
  expect(reselected.sourcePurpose?.origin.kind).toBe('local-author')

  const declared = await installDeclaredChatSource(f)
  const changed = await selectChatWorldV1(f.scope, reselected.revision, declared.worldReleaseId, declared.declarationHash)
  expect(changed.worldReleaseId).toBe(confirmed.worldReleaseId)
  expect(JSON.parse(changed.settingsJson)).toMatchObject({ characters: [], backgroundResourceKeys: [], sourceReview: null })
  expect(changed.sourcePurpose?.origin.kind).toBe('declared')
})

it('021 registered chat source suggestions require authority before any new Run or request', async () => {
  const f = await fixture()
  const runAI = vi.fn(async () => JSON.stringify(f.output))
  const network = vi.fn(async () => { throw Error('unexpected external request') })
  vi.stubGlobal('fetch', network)
  try {
    await db.chatAuthoringDrafts.where('id').equals(f.draft.id!).modify(row => { delete row.sourcePurpose })
    const before = await db.agentRuns.count()
    await expect(generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI}))
      .rejects.toThrow(/明确选择|unknown/)
    expect(await db.agentRuns.count()).toBe(before)
    expect(runAI).not.toHaveBeenCalled()
    expect(network).not.toHaveBeenCalled()

    const declared = await installDeclaredChatSource(f)
    const selected = await selectChatWorldV1(f.scope, f.draft.revision, declared.worldReleaseId, declared.declarationHash)
    const saved = await saveChatDraftV1(f.scope, selected.revision, f.settings)
    const projection = await loadChatSourceProjectionV1(f.scope, saved.revision)
    expect(projection.projectionHash).toBe(f.projection.projectionHash)
    const view = await generateChatSourceReviewSuggestionsV1({scope: f.scope,
      request: {...f.request, draftRevision: saved.revision}, runAI})
    expect(view.status).toBe('ready')
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(network).not.toHaveBeenCalled()
    await db.worldSourceReceipts.where('[worldId+declarationHash]').equals([f.scope.worldId, declared.declarationHash]).delete()
    expect(await readChatSourceReviewRunV1(f.scope, view.runId)).toEqual(view)
  } finally {vi.unstubAllGlobals()}
})

it('rejects invented quotations, foreign or missing fragments, duplicate suggestions and permission payloads', async () => {
  const f = await fixture(), base = f.output.suggestions[0]
  for (const suggestions of [[], [base, base], [{...base, fragmentKey: 'foreign'}], [{...base, evidenceQuotes: ['水尺是林舟造的']}],
    [{...base, evidenceQuotes: ['蓝铃响起', '蓝铃响起']}], [{...base, audienceKeys: ['player']}], [{...base, purpose: 'motivation'}]])
    expect(() => parseChatSourceSuggestionsV1(JSON.stringify({suggestions}), f.context)).toThrow()
  const call = vi.fn(async () => JSON.stringify({suggestions: [{...base, evidenceQuotes: ['伪造原文']}]}))
  const result = await generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI: call})
  expect(result.status).toBe('blocked')
  expect(result.result?.suggestions).toBeNull()
  expect(result.result?.artifact.originalText).toContain('伪造原文')
  expect(result.result?.artifact.status).toBe('blocked')
  expect(call).toHaveBeenCalledTimes(1)
})

it.each(['response.saved', 'model.responded', 'candidate.persisted'] satisfies ChatSourceReviewBoundaryV1[])('recovers interruption after %s with the same retained output and no new model call', async boundary => {
  const f = await fixture(), runAI = vi.fn(async () => JSON.stringify(f.output))
  let runId = 0
  await expect(generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI, onBoundary: (step, id) => {
    runId = id; if (step === boundary) throw new Error('simulated interruption')
  }})).rejects.toThrow('simulated interruption')
  expect((await readChatSourceReviewRunV1(f.scope, runId)).result?.suggestions).toEqual(f.output)
  const restored = await recoverChatSourceReviewRunV1(f.scope, runId)
  expect(restored.status).toBe('ready')
  expect(restored.result?.suggestions).toEqual(f.output)
  expect(await recoverChatSourceReviewRunV1(f.scope, runId)).toEqual(restored)
  expect(runAI).toHaveBeenCalledTimes(1)
  const run = await readAgentRunV1(f.scope, runId)
  expect(run.events.filter(row => row.type === 'candidate.persisted')).toHaveLength(1)
  expect(run.events.filter(row => row.type === 'model.responded')).toHaveLength(1)
})

it('blocks a missing response across refresh/new generation until the author explicitly ends the request', async () => {
  const f = await fixture(), unknown = vi.fn(async () => {throw new Error('connection lost')})
  await expect(generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI: unknown})).rejects.toThrow('connection lost')
  const previous = (await readLatestChatSourceReviewRunV1(f.scope))!
  expect(previous.status).toBe('unknown')
  await expect(recoverChatSourceReviewRunV1(f.scope, previous.runId)).rejects.toThrow('不能自动重发')
  const next = vi.fn(async () => JSON.stringify(f.output))
  await expect(generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI: next})).rejects.toThrow('尚未结束')
  expect(next).not.toHaveBeenCalled()
  await cancelChatSourceReviewRunV1(f.scope, previous.runId)
  expect((await readChatSourceReviewRunV1(f.scope, previous.runId)).status).toBe('cancelled')
  expect((await generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI: next})).status).toBe('ready')
  expect(unknown).toHaveBeenCalledTimes(1)
  expect(next).toHaveBeenCalledTimes(1)
})

it('retains changed-draft output as stale without modifying the newer author choices', async () => {
  const f = await fixture()
  const view = await generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI: async () => {
    await saveChatDraftV1(f.scope, f.draft.revision, {...f.settings, playerRole: '作者刚修改的玩家'})
    return JSON.stringify(f.output)
  }})
  expect(view.status).toBe('stale')
  expect(view.result?.suggestions).toEqual(f.output)
  expect(JSON.parse((await db.chatAuthoringDrafts.get(f.draft.id!))!.settingsJson).playerRole).toBe('作者刚修改的玩家')
})

it('rechecks freshness immediately before dispatch and preserves a cancellable preparation when it changed', async () => {
  const f = await fixture(), call = vi.fn(async () => JSON.stringify(f.output))
  await expect(generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI: call, onBoundary: async step => {
    if (step === 'prepared') await saveChatDraftV1(f.scope, f.draft.revision, {...f.settings, playerRole: '已经修改'})
  }})).rejects.toThrow('方案已变化')
  expect(call).not.toHaveBeenCalled()
  const run = (await readLatestChatSourceReviewRunV1(f.scope))!
  expect(run.status).toBe('pending')
  expect((await readAgentRunV1(f.scope, run.runId)).events.some(row => row.type === 'model.requested')).toBe(false)
  await cancelChatSourceReviewRunV1(f.scope, run.runId)
  expect((await readLatestChatSourceReviewRunV1(f.scope))?.status).toBe('cancelled')
})

it('prevents simultaneous requests for the same Work', async () => {
  const f = await fixture()
  let release!: () => void, arrived!: () => void
  const gate = new Promise<void>(resolve => {release = resolve}), started = new Promise<void>(resolve => {arrived = resolve})
  const first = generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI: async () => {arrived(); await gate; return JSON.stringify(f.output)}})
  await started
  const duplicate = vi.fn(async () => JSON.stringify(f.output))
  try {
    await expect(generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI: duplicate})).rejects.toThrow('仍在处理中')
    expect(duplicate).not.toHaveBeenCalled()
  } finally {release()}
  expect((await first).status).toBe('ready')
})

it('rejects stale input before sending, and checks ownership when reading, recovering and dismissing', async () => {
  const f = await fixture(), call = vi.fn(async () => JSON.stringify(f.output))
  await expect(generateChatSourceReviewSuggestionsV1({scope: f.scope, request: {...f.request, draftRevision: 999}, runAI: call})).rejects.toThrow('方案已变化')
  expect(call).not.toHaveBeenCalled()
  const view = await generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI: call})
  const other = await createChatDraftV2('其他作品')
  for (const action of [readChatSourceReviewRunV1, recoverChatSourceReviewRunV1, cancelChatSourceReviewRunV1])
    await expect(action(other.scope, view.runId)).rejects.toThrow()
})

it('preserves original citations and the completed report through project export/import without sending', async () => {
  const f = await fixture(), call = vi.fn(async () => JSON.stringify(f.output))
  await generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI: call})
  const view = await generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI: call})
  const id = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const draft = (await db.chatAuthoringDrafts.where('projectId').equals(id).first())!
  const scope = {projectId: id, workId: draft.workId, worldId: draft.worldId}
  const imported = (await readLatestChatSourceReviewRunV1(scope))!
  expect(imported.status).toBe('pending') // Imported receipts must be verified in their new owner scope.
  const restored = await recoverChatSourceReviewRunV1(scope, imported.runId)
  expect(restored.status).toBe('ready')
  expect(restored?.result).toEqual(view.result)
  expect(restored?.context).toEqual(view.context)
  expect(call).toHaveBeenCalledTimes(2)
  // Earlier imported reports keep stale receipts but cannot block a new,
  // explicitly requested report after the latest report has been restored.
  expect((await generateChatSourceReviewSuggestionsV1({scope, request: f.request, runAI: call})).status).toBe('ready')
  expect(call).toHaveBeenCalledTimes(3)
})
