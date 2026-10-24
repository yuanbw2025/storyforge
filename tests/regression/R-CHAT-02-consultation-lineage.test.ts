import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedChatConsultationFixtureV2} from '../helpers/chat-consultation'
import {adoptChatConsultationV2, generateChatConsultationV2, readChatConsultationProductionEvidenceV1, readChatConsultationV2} from '../../src/lib/character-interaction/consultation-harness'
import {readChatDraftV1, saveChatDraftV1, createChatDraftV2} from '../../src/lib/character-interaction/draft-service'
import {draftProductProductionBriefV3, suggestProductStartingPoints} from '../../src/lib/product-production/consultation'
import {createProductProductionWithBriefV1, readProductProductionDetailsV1} from '../../src/lib/product-production/service'
import * as sourcePlans from '../../src/lib/product-production/source-contracts'
import {readLatestVerifiedAgentRunCheckpointV1, createAgentRunCheckpointV1} from '../../src/lib/agent/run/checkpoint'
import {readAgentRunV1} from '../../src/lib/agent/run/event-store'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {parseProductProductionBriefV3} from '../../src/lib/product-production/contracts'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function fixture(adopted = true, withSources = true) {
  const f = await seedChatConsultationFixtureV2()
  const candidate = withSources ? f.candidate : {...f.candidate, changes: f.candidate.changes.map(change => ({...change, evidence: []}))}
  const request = withSources ? f.request : {...f.request, source: null}
  const runAI = vi.fn(async () => JSON.stringify(candidate))
  const view = await generateChatConsultationV2({scope: f.scope, request, runAI})
  if (adopted) await adoptChatConsultationV2({scope: f.scope, runId: view.runId, expectedCandidateHash: view.candidateHash!, fields: ['openingSituation']})
  const draft = await readChatDraftV1(f.scope), settings = JSON.parse(draft.settingsJson)
  const suggestions = await suggestProductStartingPoints({scope: f.scope, worldReleaseId: draft.worldReleaseId!})
  const brief = await draftProductProductionBriefV3({scope: f.scope, worldReleaseId: draft.worldReleaseId!, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'character-interaction', characterChat: settings, playerRole: settings.playerRole, openingSituation: settings.openingSituation, visualLevel: 'none', audioLevel: 'none'})
  return {...f, request, candidate, view, draft, brief, runAI}
}
it('retains an adopted author discussion without pretending that it read world passages', async () => {
  const f = await fixture(true, false)
  const evidence = await readChatConsultationProductionEvidenceV1(f.scope, f.brief)
  expect(evidence).toHaveLength(1)
  expect(evidence[0].hasSelectedSources).toBe(false)
  expect(evidence[0].changes.every(change => change.basis === 'proposal' && change.evidence.length === 0)).toBe(true)
  const plan = await sourcePlans.createProductProductionSourcePlanV1({scope: f.scope, productionKey: 'author-discussion', brief: f.brief})
  expect(plan.consultationContextManifests).toEqual(evidence.map(row => row.pointer))
  expect(f.runAI).toHaveBeenCalledTimes(1)
})
it('freezes actual adopted consultation manifests and keeps the same pointers through export/import without revealing author context in the source plan', async () => {
  const f = await fixture(), worlds = await db.worldReleases.toArray()
  const evidence = await readChatConsultationProductionEvidenceV1(f.scope, f.brief)
  expect(evidence).toHaveLength(1)
  expect(evidence[0].changes.map(change => change.field)).toEqual(['openingSituation'])
  const checkpoint = (await readLatestVerifiedAgentRunCheckpointV1(f.scope, f.view.runId))!
  const payload = checkpoint.resumePayload as {manifest: {sourceText: string}; manifestHash: string}
  expect(payload.manifest.sourceText).toContain('希望修好旧钟')
  const productionId = await createProductProductionWithBriefV1({scope: f.scope, worldReleaseId: f.draft.worldReleaseId!, title: '有据的开场', brief: f.brief})
  const details = await readProductProductionDetailsV1(f.scope, productionId)
  const plan = await sourcePlans.parseProductProductionSourcePlanV1(details.brief!)
  expect(plan.consultationContextManifests).toEqual(evidence.map(row => row.pointer))
  expect(plan.consultationContextManifests[0].manifestHash).toBe(payload.manifestHash)
  expect(JSON.stringify(plan)).not.toContain('希望修好旧钟')
  expect(await db.productBuilds.count()).toBe(0)
  expect(await db.worldReleases.toArray()).toEqual(worlds)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productProductionBriefs.where('projectId').equals(projectId).first())!
  const importedPlan = await sourcePlans.parseProductProductionSourcePlanV1(imported)
  expect(importedPlan.planHash).toBe(plan.planHash)
  expect(importedPlan.consultationContextManifests).toEqual(plan.consultationContextManifests)
  const scope = {projectId, workId: imported.workId, worldId: imported.worldId}
  const restored = await readChatConsultationProductionEvidenceV1(scope, parseProductProductionBriefV3(imported.briefJson), importedPlan.consultationContextManifests)
  expect(restored.map(row => row.pointer)).toEqual(evidence.map(row => row.pointer))
  expect(restored[0].changes).toEqual(evidence[0].changes)
  expect(f.runAI).toHaveBeenCalledTimes(1)
})
it('does not claim pending, unselected, edited, foreign-world or cross-Work suggestions as adopted provenance', async () => {
  const f = await fixture(false)
  expect(await readChatConsultationProductionEvidenceV1(f.scope, f.brief)).toEqual([])
  await adoptChatConsultationV2({scope: f.scope, runId: f.view.runId, expectedCandidateHash: f.view.candidateHash!, fields: ['openingSituation']})
  const saved = await readChatDraftV1(f.scope), settings = JSON.parse(saved.settingsJson)
  const accepted = {...f.brief, characterChat: settings, intent: {...f.brief.intent, openingSituation: settings.openingSituation}}
  expect((await readChatConsultationProductionEvidenceV1(f.scope, accepted))[0].changes).toHaveLength(1)
  for (const brief of [f.brief, {...accepted, intent: {...accepted.intent, openingSituation: '制作页独立修改'}}, {...accepted, source: {...accepted.source, worldContentHash: 'f'.repeat(64)}}]) {
    expect(await readChatConsultationProductionEvidenceV1(f.scope, brief)).toEqual([])
  }
  const other = await createChatDraftV2('另一作品')
  expect(await readChatConsultationProductionEvidenceV1(other.scope, accepted)).toEqual([])
  await saveChatDraftV1(f.scope, saved.revision, {...settings, experience: '作者后来改体验重点'})
  expect((await readChatConsultationProductionEvidenceV1(f.scope, accepted))[0].changes[0].field).toBe('openingSituation')
})
it('retains a frozen old consultation when a later adopted discussion has the same field value', async () => {
  const f = await fixture(), original = await readChatConsultationProductionEvidenceV1(f.scope, f.brief)
  const next = await generateChatConsultationV2({scope: f.scope, request: {...f.request, draftRevision: f.draft.revision, source: {...f.request.source!, draftRevision: f.draft.revision}}, runAI: async () => JSON.stringify(f.candidate)})
  await adoptChatConsultationV2({scope: f.scope, runId: next.runId, expectedCandidateHash: next.candidateHash!, fields: ['openingSituation']})
  expect((await readChatConsultationProductionEvidenceV1(f.scope, f.brief))[0].runId).toBe(next.runId)
  expect(await readChatConsultationProductionEvidenceV1(f.scope, f.brief, original.map(row => row.pointer))).toEqual(original)
})
it('preserves hash-only legacy runs without inventing a complete manifest or preventing adoption', async () => {
  const f = await fixture(false), saved = (await readLatestVerifiedAgentRunCheckpointV1(f.scope, f.view.runId))!
  const payload = structuredClone(saved.resumePayload) as {manifest?: unknown}
  delete payload.manifest
  await createAgentRunCheckpointV1({scope: f.scope, runId: f.view.runId, resumePayload: payload, expectedLastSequence: saved.snapshot.projection.lastSequence})
  await adoptChatConsultationV2({scope: f.scope, runId: f.view.runId, expectedCandidateHash: f.view.candidateHash!, fields: ['openingSituation']})
  expect((await readChatConsultationV2(f.scope, f.view.runId)).status).toBe('adopted')
  const draft = await readChatDraftV1(f.scope), settings = JSON.parse(draft.settingsJson)
  expect(await readChatConsultationProductionEvidenceV1(f.scope, {...f.brief, characterChat: settings, intent: {...f.brief.intent, openingSituation: settings.openingSituation}})).toEqual([])
})
it('rejects a complete manifest that no longer represents the retained model input', async () => {
  const f = await fixture(false), saved = (await readLatestVerifiedAgentRunCheckpointV1(f.scope, f.view.runId))!
  const payload = structuredClone(saved.resumePayload) as {manifest: {sourceText: string}}
  payload.manifest.sourceText = '{}'
  await createAgentRunCheckpointV1({scope: f.scope, runId: f.view.runId, resumePayload: payload, expectedLastSequence: saved.snapshot.projection.lastSequence})
  await expect(readChatConsultationV2(f.scope, f.view.runId)).rejects.toThrow('实际模型输入')
  expect((await readAgentRunV1(f.scope, f.view.runId)).events.some(event => event.type === 'adoption.committed')).toBe(false)
})
it('rechecks adoption evidence inside the Brief transaction and rejects a changed preparation', async () => {
  const f = await fixture(), original = sourcePlans.createProductProductionSourcePlanV1
  vi.spyOn(sourcePlans, 'createProductProductionSourcePlanV1').mockImplementationOnce(async input => {
    const plan = await original(input)
    const next = await generateChatConsultationV2({scope: f.scope, request: {...f.request, draftRevision: f.draft.revision, source: {...f.request.source!, draftRevision: f.draft.revision}}, runAI: async () => JSON.stringify(f.candidate)})
    await adoptChatConsultationV2({scope: f.scope, runId: next.runId, expectedCandidateHash: next.candidateHash!, fields: ['openingSituation']})
    return plan
  })
  await expect(createProductProductionWithBriefV1({scope: f.scope, worldReleaseId: f.draft.worldReleaseId!, title: '并发保存', brief: f.brief})).rejects.toThrow('会谈采纳证据')
  expect(await db.productProductionBriefs.count()).toBe(0)
  expect(await db.productBuilds.count()).toBe(0)
})
