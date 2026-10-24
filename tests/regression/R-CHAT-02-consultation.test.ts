import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedChatConsultationFixtureV2} from '../helpers/chat-consultation'
import {generateChatConsultationV2, adoptChatConsultationV2, readChatConsultationV2, readLatestChatConsultationV2, recoverChatConsultationV2, cancelChatConsultationV2} from '../../src/lib/character-interaction/consultation-harness'
import {readChatConsultationContextV2} from '../../src/lib/character-interaction/consultation-context'
import {parseChatPlanCandidateV2} from '../../src/lib/character-interaction/consultation-candidate'
import {createChatDraftV2, readChatDraftV1, saveChatDraftV1} from '../../src/lib/character-interaction/draft-service'
import {readAgentRunV1} from '../../src/lib/agent/run/event-store'
import {adopt} from '../../src/lib/registry/adopt'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {loadProductProductionWorldSourceCatalogV2} from '../../src/lib/product-production/world-source'
import {draftProductProductionBriefV3, suggestProductStartingPoints} from '../../src/lib/product-production/consultation'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function ready() {
  const f = await seedChatConsultationFixtureV2(), runAI = vi.fn(async messages => {
    expect(JSON.stringify(messages)).toContain('自己检查工具')
    expect(JSON.stringify(messages)).not.toContain('仅作者掌握的私域结局')
    expect(JSON.stringify(messages)).not.toContain('知道失踪船队真相')
    return JSON.stringify(f.candidate)
  })
  const view = await generateChatConsultationV2({scope: f.scope, request: f.request, runAI})
  return {...f, view, runAI, confirmation: {scope: f.scope, runId: view.runId, expectedCandidateHash: view.candidateHash!, fields: ['openingSituation'] as const}}
}
it('reads only selected original evidence, selectively adopts a durable candidate, and lets deterministic Brief/SourcePlan consume the approved change', async () => {
  const f = await ready(), world = await db.worldReleases.toArray()
  expect(f.view.status).toBe('ready')
  expect((await readChatDraftV1(f.scope)).settingsJson).toBe(f.confirmed.settingsJson)
  expect((await readAgentRunV1(f.scope, f.view.runId)).contract.permissions).toEqual({contextSourceKeys: ['chat.consultation'], writeTargets: [{table: 'chatAuthoringDrafts', fields: ['settingsJson'], mode: 'author-confirmed'}]})
  const adopted = await adoptChatConsultationV2(f.confirmation)
  expect(adopted.status).toBe('adopted')
  const saved = await readChatDraftV1(f.scope), settings = JSON.parse(saved.settingsJson)
  expect(settings).toEqual({...f.settings, openingSituation: f.candidate.changes[0].value})
  expect(saved.revision).toBe(f.confirmed.revision + 1)
  expect(await adoptChatConsultationV2(f.confirmation)).toEqual(adopted)
  await expect(adoptChatConsultationV2({...f.confirmation, fields: ['playerRole']})).rejects.toThrow('其他字段')
  const starting = await suggestProductStartingPoints({scope: f.scope, worldReleaseId: saved.worldReleaseId!})
  const brief = await draftProductProductionBriefV3({scope: f.scope, worldReleaseId: saved.worldReleaseId!, suggestionKey: starting.suggestions[0].suggestionKey,
    productType: 'character-interaction', characterChat: settings, playerRole: settings.playerRole, openingSituation: settings.openingSituation, visualLevel: 'none', audioLevel: 'none'})
  expect(brief.intent.openingSituation).toBe(f.candidate.changes[0].value)
  const source = await loadProductProductionWorldSourceCatalogV2({scope: f.scope, worldReleaseId: saved.worldReleaseId!, selection: brief.source.selection, chatPrivateCharacters: settings.privateCharacters})
  expect(source.chatSourceProjection!.projectionHash).toBe(f.settings.sourceReview!.projectionHash)
  expect(await db.productProductions.count()).toBe(0)
  expect(await db.worldReleases.toArray()).toEqual(world)
  expect(f.runAI).toHaveBeenCalledTimes(1)
})
it('validates citations, field bounds and the immutable parts even at the registry write boundary', async () => {
  const f = await seedChatConsultationFixtureV2(), context = await readChatConsultationContextV2(f.scope, f.request)
  const change = f.candidate.changes[0]
  for (const invalid of [
    {...change, field: 'privateCharacters', value: []}, {...change, field: 'sourceReview', value: null}, {...change, field: 'narrative.permissions', value: {}},
    {...change, basis: 'source', evidence: []}, {...change, evidence: [{fragmentKey: change.evidence[0].fragmentKey, quote: '伪造原文'}]},
    {...change, field: 'maxTurns', value: 0}, {...change, value: 'x'.repeat(5001)},
  ]) expect(() => parseChatPlanCandidateV2({...f.candidate, changes: [invalid]}, context)).toThrow()
  for (const settings of [ {...f.settings, sourceReview: null}, {...f.settings, privateCharacters: []}, {...f.settings, characters: []},
    {...f.settings, narrative: {...f.settings.narrative, permissions: {...f.settings.narrative.permissions, maxActionsPerTrigger: 3}}},
  ]) await expect(adopt({scope: f.scope, projectId: f.scope.projectId, target: 'chatAuthoringDrafts', recordId: f.confirmed.id!, mode: 'replace', data: {settingsJson: JSON.stringify(settings)}})).rejects.toThrow('不能修改')
  expect((await readChatDraftV1(f.scope)).settingsJson).toBe(f.confirmed.settingsJson)
})
it.each(['response.saved', 'model.responded', 'candidate.persisted'] as const)('recovers %s without a second request or applying any fields', async boundary => {
  const f = await seedChatConsultationFixtureV2(), runAI = vi.fn(async () => JSON.stringify(f.candidate)); let id = 0
  await expect(generateChatConsultationV2({scope: f.scope, request: f.request, runAI, onBoundary: (point, runId) => {id = runId; if (point === boundary) throw new Error('interrupted')}})).rejects.toThrow('interrupted')
  expect((await recoverChatConsultationV2(f.scope, id)).status).toBe('ready')
  expect((await readChatDraftV1(f.scope)).settingsJson).toBe(f.confirmed.settingsJson)
  expect(runAI).toHaveBeenCalledTimes(1)
})
it('rolls back a mid-write interruption and recovers a committed receipt without repeating the revision', async () => {
  const f = await ready()
  await expect(adoptChatConsultationV2({...f.confirmation, onBoundary: point => {if (point === 'written-in-transaction') throw new Error('rollback')}})).rejects.toThrow('rollback')
  expect((await readChatDraftV1(f.scope)).settingsJson).toBe(f.confirmed.settingsJson)
  expect((await readAgentRunV1(f.scope, f.view.runId)).projection.state).toBe('awaiting_confirmation')
  await expect(adoptChatConsultationV2({...f.confirmation, onBoundary: point => {if (point === 'committed') throw new Error('after commit')}})).rejects.toThrow('after commit')
  const saved = await readChatDraftV1(f.scope)
  expect((await recoverChatConsultationV2(f.scope, f.view.runId)).status).toBe('adopted')
  await adoptChatConsultationV2(f.confirmation)
  expect(await readChatDraftV1(f.scope)).toEqual(saved)
})
it('rejects cross-Work, wrong hashes, empty field choice and stale author edits at commit', async () => {
  const f = await ready(), other = await createChatDraftV2('另一作品')
  await expect(readChatConsultationV2(other.scope, f.view.runId)).rejects.toThrow()
  await expect(adoptChatConsultationV2({...f.confirmation, expectedCandidateHash: 'f'.repeat(64)})).rejects.toThrow('已变化')
  await expect(adoptChatConsultationV2({...f.confirmation, fields: []})).rejects.toThrow('明确选择')
  await expect(adoptChatConsultationV2({...f.confirmation, onBoundary: async point => {
    if (point === 'before-commit') await saveChatDraftV1(f.scope, f.confirmed.revision, {...f.settings, openingSituation: '作者最新种子'})
  }})).rejects.toThrow('没有写入')
  expect((await readChatConsultationV2(f.scope, f.view.runId)).status).toBe('stale')
  expect((await readAgentRunV1(f.scope, f.view.runId)).events.some(e => e.type === 'adoption.committed')).toBe(false)
})
it('retains invalid output and unknown requests, and only starts anew after explicit dismissal', async () => {
  const f = await seedChatConsultationFixtureV2()
  const invalid = await generateChatConsultationV2({scope: f.scope, request: f.request, runAI: async () => 'not JSON'})
  expect(invalid.status).toBe('blocked'); expect(invalid.result!.artifact.originalText).toBe('not JSON')
  await expect(generateChatConsultationV2({scope: f.scope, request: f.request, runAI: async () => {throw new Error('unknown')}})).rejects.toThrow('unknown')
  const unknown = (await readLatestChatConsultationV2(f.scope))!
  expect(unknown.status).toBe('unknown')
  await expect(recoverChatConsultationV2(f.scope, unknown.runId)).rejects.toThrow('不能自动重发')
  const next = vi.fn(async () => JSON.stringify(f.candidate))
  await expect(generateChatConsultationV2({scope: f.scope, request: f.request, runAI: next})).rejects.toThrow('尚未结束')
  expect(next).not.toHaveBeenCalled()
  await cancelChatConsultationV2(f.scope, unknown.runId)
  expect((await generateChatConsultationV2({scope: f.scope, request: f.request, runAI: next})).status).toBe('ready')
})
it('imports committed settings and historical receipts without reverting later edits or requesting a model', async () => {
  const f = await ready(); await adoptChatConsultationV2(f.confirmation)
  const saved = await readChatDraftV1(f.scope)
  await saveChatDraftV1(f.scope, saved.revision, {...JSON.parse(saved.settingsJson), experience: '作者后来的修改'})
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const draft = (await db.chatAuthoringDrafts.where('projectId').equals(projectId).first())!, scope = {projectId, worldId: draft.worldId, workId: draft.workId}
  const view = (await readLatestChatConsultationV2(scope))!
  await recoverChatConsultationV2(scope, view.runId)
  expect((await readChatDraftV1(scope)).settingsJson).toBe(draft.settingsJson)
  expect((await readChatConsultationV2(scope, view.runId)).status).toBe('adopted')
  expect(f.runAI).toHaveBeenCalledTimes(1)
})

it('keeps imported unadopted candidates historical when world identity changes and does not borrow another Work discussion', async () => {
  const f = await ready(), other = await createChatDraftV2('不同作品的会谈')
  const otherDraft = await readChatDraftV1(other.scope)
  await expect(readChatConsultationContextV2(other.scope, {draftRevision: otherDraft.revision, question: '继续讨论', source: null, priorRunId: f.view.runId})).rejects.toThrow()
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const draft = (await db.chatAuthoringDrafts.where('projectId').equals(projectId).first())!, scope = {projectId, worldId: draft.worldId, workId: draft.workId}
  const view = (await readLatestChatConsultationV2(scope))!
  expect(view.status).toBe('stale')
  expect(view.result!.candidate).toEqual(f.candidate)
  await expect(adoptChatConsultationV2({...f.confirmation, scope, runId: view.runId})).rejects.toThrow()
  expect(await readChatDraftV1(scope)).toEqual(draft)
  expect(await db.productProductions.count()).toBe(0)
  expect(f.runAI).toHaveBeenCalledTimes(1)
})
