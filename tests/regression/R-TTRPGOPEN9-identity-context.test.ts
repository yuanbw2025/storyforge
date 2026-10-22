import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupIdentityKnowledgeRuntimeV1, identityKnowledgeWindowV1 } from '../helpers/open-identity-knowledge-runtime'
import { OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenIdentityKnowledgeV1, confirmTtrpgOpenIdentityKnowledgeReviewV1 } from '../../src/lib/ttrpg/open-identity-knowledge-service'
import { loadTtrpgOpenLearnedIdentityContextV1 } from '../../src/lib/ttrpg/open-identity-knowledge-context'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1, assertTtrpgOpenFrozenContextSourcesV1 } from '../../src/lib/ttrpg/open-model-purpose-contract'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { generateTtrpgOpenCompanionCandidateV1, generateTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession, hashProductRuntimeStateV1 } from '../../src/lib/product/runtime-core'
import { completeTtrpgOpenSessionZeroV1, startTtrpgOpenIntentCandidateOperationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { ttrpgOpenActorKnowsEvidenceV1 } from '../../src/lib/ttrpg/open-knowledge'

async function setup() {
  const s = await setupIdentityKnowledgeRuntimeV1(false, true)
  const review = await prepareTtrpgOpenIdentityKnowledgeV1({ ...s.owner, request: s.request, submissionKey: 'context.observed' })
  const observed = await confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...s.owner, review, decision: 'confirm-these-identities-and-recipients' })
  return { ...s, observed, contextInput: { scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'hero' } }
}
async function share(s: Awaited<ReturnType<typeof setup>>, recipient = 'companion.1') {
  await identityKnowledgeWindowV1(s.f.sessionId, OPEN_HUMAN_VIEWER)
  const input = { ...s.owner, viewerKey: OPEN_HUMAN_VIEWER }
  const review = await prepareTtrpgOpenIdentityKnowledgeV1({ ...input, submissionKey: crypto.randomUUID(), request: { ...s.request, mode: 'share', actorKey: 'hero',
    sourceKnowledgeKey: s.observed.knowledgeKey, recipientActorKeys: [recipient] } })
  return confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...input, review, decision: 'confirm-these-identities-and-recipients' })
}
const source = () => CONTEXT_SOURCE_BY_KEY.get(TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1)!.resources!
describe('R-TTRPGOPEN9 exact registered model identity knowledge without mechanical permission', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('discloses only the actual receiver name and provenance, while retaining legacy knowledge bytes and original mechanical visibility', async () => {
    const s = await setup(), known = await loadTtrpgOpenLearnedIdentityContextV1(s.contextInput)
    expect(known.view.identities).toMatchObject([{ entityRef: s.entityRef, name: '新守灯人', reliability: 'observed', knowledgeKey: s.observed.knowledgeKey }])
    expect(JSON.stringify(known.view)).not.toMatch(/gmProfile|planHash|templateKey|ownerRef|locationKey|害怕洪水/)
    expect((await loadTtrpgOpenLearnedIdentityContextV1({ ...s.contextInput, actorKey: 'companion.2' })).view.identities).toEqual([])
    const legacy = CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenKnowledge')!.resources!, scope = { ...s.f.scope, productRuntimeSessionId: s.f.sessionId, runtimeActorKey: 'hero' }
    const page = await legacy.listMetadata({ scope, limit: 1000 })
    for (const row of page.items) expect((await legacy.read({ scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 10000 })).content).not.toMatch(/新守灯人|identityGrant|learned-identit/)
    expect(JSON.stringify((await loadTtrpgOpenPlayerContextV1(s.contextInput)).view.actorsHere)).not.toContain(s.entityRef)
  })
  it('preserves hearsay and chooses genuine firsthand recognition over a later repeated report', async () => {
    const s = await setup(), heard = await share(s, 'companion.2')
    const listener = await loadTtrpgOpenLearnedIdentityContextV1({ ...s.contextInput, actorKey: 'companion.2' })
    expect(listener.view.identities).toMatchObject([{ reliability: 'hearsay', knowledgeKey: heard.knowledgeKey }])
    await identityKnowledgeWindowV1(s.f.sessionId, 'viewer.seat.companion.2')
    const input = { ...s.owner, viewerKey: 'viewer.seat.companion.2' }
    const review = await prepareTtrpgOpenIdentityKnowledgeV1({ ...input, submissionKey: 'report.back', request: { ...s.request, mode: 'share', actorKey: 'companion.2', sourceKnowledgeKey: heard.knowledgeKey, recipientActorKeys: ['hero'] } })
    await confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...input, review, decision: 'confirm-these-identities-and-recipients' })
    expect((await loadTtrpgOpenLearnedIdentityContextV1(s.contextInput)).view.identities[0].knowledgeKey).toBe(s.observed.knowledgeKey)
    expect(ttrpgOpenActorKnowsEvidenceV1((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.knowledge, 'companion.2', s.root.evidenceRef)).toBe(false)
  })
  it('does not turn firsthand clue observation into firsthand identity recognition when that identity was only reported later', async () => {
    const s = await setupIdentityKnowledgeRuntimeV1(false, true, 'party')
    const review = await prepareTtrpgOpenIdentityKnowledgeV1({ ...s.owner, submissionKey: 'party.selected.observer', request: { ...s.request, recipientActorKeys: ['companion.2'] } })
    const observed = await confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...s.owner, review, decision: 'confirm-these-identities-and-recipients' })
    await identityKnowledgeWindowV1(s.f.sessionId, 'viewer.seat.companion.2')
    const actor = { ...s.owner, viewerKey: 'viewer.seat.companion.2' }
    const report = await prepareTtrpgOpenIdentityKnowledgeV1({ ...actor, submissionKey: 'party.identity.report', request: { ...s.request, mode: 'share', actorKey: 'companion.2', sourceKnowledgeKey: observed.knowledgeKey, recipientActorKeys: ['hero'] } })
    await confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...actor, review: report, decision: 'confirm-these-identities-and-recipients' })
    const known = await loadTtrpgOpenLearnedIdentityContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'hero' })
    expect(known.view.identities).toMatchObject([{ name: '新守灯人', reliability: 'hearsay' }])
    expect(ttrpgOpenActorKnowsEvidenceV1((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.knowledge, 'hero', s.root.evidenceRef)).toBe(true)
    const rawInput = '亲眼看见的线索与后来听到的名字应分别核对。'
    await identityKnowledgeWindowV1(s.f.sessionId, OPEN_HUMAN_VIEWER, rawInput)
    const generated = await generateTtrpgOpenIntentCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'identity.observed-and-heard'), scope: s.f.scope, sessionId: s.f.sessionId,
      actorKey: 'hero', viewerKey: OPEN_HUMAN_VIEWER, rawInput, maximumOutputTokens: 800, maximumCostUsd: .1,
      runAI: async () => JSON.stringify({ goal: '谨慎核实转述的名字', method: null, targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null }) })
    expect(generated.candidate.intent).not.toBeNull()
    const reads = generated.prepared.evidence.selector.selected
    expect(reads.filter(row => row.sourceKey === 'ttrpgOpenKnowledge' && /:knowledge\./.test(row.resourceKey))).toHaveLength(1)
    const messages = generated.prepared.messages.map(row => row.content).join('\n')
    expect(messages).toContain('"reliability":"observed"'); expect(messages).toContain('"reliability":"hearsay"')
    const scope = { ...s.f.scope, productRuntimeSessionId: s.f.sessionId, runtimeActorKey: 'hero' }, provider = CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenKnowledge')!.resources!
    expect((await provider.listMetadata({ scope, limit: 1000 })).items.filter(row => /:knowledge\./.test(row.resourceKey))).toHaveLength(2)

  })
  it('requires complete registered resources and rejects participant storage drift on every pinned read', async () => {
    const s = await setup(), scope = { ...s.f.scope, productRuntimeSessionId: s.f.sessionId, runtimeActorKey: 'hero' }, provider = source()
    const pin = await provider.openReadSession!(scope), page = await pin.provider.listMetadata({ scope, limit: 1000 }), row = page.items.find(row => row.title === '新守灯人')!
    await expect(pin.provider.read({ scope: { ...scope, runtimeActorKey: 'companion.2' }, resourceKey: row.resourceKey, depth: 'full', maxTokens: 10000 })).rejects.toThrow(/更换/)
    await expect(provider.listMetadata({ scope: { ...scope, runtimeActorKey: 'gm' }, limit: 1000 })).rejects.toThrow(/POV/)
    await expect(provider.readOriginal({ scope, resourceKey: row.resourceKey, maxTokens: 10000 })).rejects.toThrow(/禁止/)
    await expect(pin.provider.read({ scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 1 })).rejects.toThrow(/完整资源/)
    expect((await pin.provider.read({ scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 10000 })).content).toContain('observed')
    const seat = (await readTtrpgSessionParticipantsV2(s.f.sessionId)).find(row => row.actorKey === 'hero')!
    // Session Zero correctly forbids ordinary consent edits. This is corrupt/stale storage evidence, never a legal UI grant.
    await db.ttrpgSessionParticipants.update(seat.id!, { consent: { ...seat.consent, aiAdviceAllowed: false }, revision: seat.revision + 1 })
    await expect(pin.provider.read({ scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 10000 })).rejects.toThrow(/变化/)
    await expect(provider.listMetadata({ scope, limit: 1000 })).rejects.toThrow()
  })
  it('delivers actual registered identity bytes through a v5 player Run and leaves the old source protocol closed', async () => {
    const s = await setup(), rawInput = '依据我观察识别的新守灯人，整理一个谨慎的调查目标。'
    await identityKnowledgeWindowV1(s.f.sessionId, OPEN_HUMAN_VIEWER, rawInput)
    const before = await readProductRuntimeState(s.f.sessionId), runAI = vi.fn(async () => JSON.stringify({ goal: '谨慎调查', method: null, targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null }))
    const generated = await generateTtrpgOpenIntentCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'identity.intent'), ...s.contextInput, viewerKey: OPEN_HUMAN_VIEWER,
      rawInput, maximumOutputTokens: 800, maximumCostUsd: .1, runAI })
    expect(runAI).toHaveBeenCalledTimes(1)
    const selected = generated.prepared.evidence.selector.selected.filter(row => row.sourceKey === TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1)
    expect(selected).toHaveLength(2); expect(selected.every(row => row.depth === 'full')).toBe(true)
    const text = generated.prepared.messages.map(row => row.content).join('\n')
    expect(text).toContain('storyforge.ttrpg-open-learned-identity'); expect(text).toContain('observed'); expect(text).not.toContain('gmProfile')
    const run = await readInstanceAgentRunV1(s.f.scope, generated.prepared.runId)
    expect(run.contract.permissions.contextSourceKeys).toContain(TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1)
    expect(getAgentSkillV1('prose.ttrpg-open-intent').promptVersion).toBe('ttrpg-open-intent-v5')
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
  })
  it('lets an AI companion read its genuine report but blocks using that known identity as an ungranted action target', async () => {
    const s = await setup(); await share(s)
    const rawInput = '根据关于新守灯人的转述提出下一步。'
    await identityKnowledgeWindowV1(s.f.sessionId, OPEN_HUMAN_VIEWER, rawInput)
    const before = await readProductRuntimeState(s.f.sessionId)
    const generated = await generateTtrpgOpenCompanionCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'identity.companion'), scope: s.f.scope, sessionId: s.f.sessionId,
      actorKey: 'companion.1', viewerKey: OPEN_HUMAN_VIEWER, rawInput, maximumOutputTokens: 800, maximumCostUsd: .1,
      runAI: async () => JSON.stringify({ goal: '联系新守灯人', method: null, targetRefs: [s.entityRef], declaredResources: [], declaredAssumptions: [], requestedOutcome: null }) })
    expect(generated.prepared.messages.map(row => row.content).join('\n')).toContain('hearsay')
    expect(generated.prepared.evidence.selector.selected.filter(row => row.sourceKey === TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1)).toHaveLength(2)
    expect(generated.candidate.intent).toBeNull(); expect(generated.candidate.artifact.issues.some(row => row.message.includes('未授权'))).toBe(true)
    await expect(startTtrpgOpenIntentCandidateOperationV1({ ...await openEnvelopeV1(s.f.sessionId, 'identity.bad-target'), viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash, decision: 'start' })).rejects.toThrow(/修订|受阻/)
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.operations).toEqual(before.ttrpg!.openRun!.operations)
  })
  it('retains the model-readable grade and source after a real branch, parent deletion and full backup', async () => {
    const s = await setup(); await share(s)
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: (await readProductRuntimeState(s.f.sessionId)).lastSequence, title: 'identity context child' })
    const state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'context.child.zero'), viewerKey: 'viewer.gm', acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    await deleteProductRuntimeSession(s.f.sessionId)
    const input = { ...s.contextInput, sessionId: child.id!, actorKey: 'companion.1' }, expected = (await loadTtrpgOpenLearnedIdentityContextV1(input)).view
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId)), imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => row.title === child.title)!
    expect((await loadTtrpgOpenLearnedIdentityContextV1({ scope: { projectId, worldId: imported.worldId!, workId: imported.workId! }, sessionId: imported.id!, actorKey: 'companion.1' })).view).toEqual(expected)
  })
  it('recovers names from actual events instead of disclosing a self-hashed corrupt identity cache', async () => {
    const s = await setup(), state = await readProductRuntimeState(s.f.sessionId)
    state.ttrpg!.openRun!.knowledge[1].identityGrant!.identities[0].name = 'FORGED-IDENTITY-NAME'
    await db.productRuntimeSessions.update(s.f.sessionId, { runtimeHeadStateJson: JSON.stringify(state), runtimeHeadStateHash: await hashProductRuntimeStateV1(state) })
    const result = await loadTtrpgOpenLearnedIdentityContextV1(s.contextInput)
    expect(result.view.identities[0].name).toBe('新守灯人'); expect(JSON.stringify(result)).not.toContain('FORGED-IDENTITY-NAME')
  })
  it('refuses a self-hashed forged recipient cache even when its actual creation and observed-name records are real', async () => {
    const s = await setup(); await share(s, 'companion.2')
    const state = await readProductRuntimeState(s.f.sessionId), run = state.ttrpg!.openRun!
    run.knowledge[2].recipientActorKeys = ['companion.1']; run.knowledgeShares![0].knowledge.recipientActorKeys = ['companion.1']
    await db.productRuntimeSessions.update(s.f.sessionId, { runtimeHeadStateJson: JSON.stringify(state), runtimeHeadStateHash: await hashProductRuntimeStateV1(state) })
    await expect(loadTtrpgOpenLearnedIdentityContextV1({ ...s.contextInput, actorKey: 'companion.1' })).rejects.toThrow()
    await expect(loadTtrpgOpenPlayerContextV1({ ...s.contextInput, actorKey: 'companion.1' })).rejects.toThrow()
  })
  it('accepts exact old actor source generations without adding the new grant to them or to a GM consumer', () => {
    const old = ['ttrpgOpenAuthority', 'ttrpgOpenKnowledge', 'ttrpgOpenActorContext', 'ttrpgOpenMemory']
    expect(assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-intent', old)).toEqual(old)
    expect(assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-intent', [...old, TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1])).toHaveLength(5)
    expect(() => assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-oracle-interpret', [...old, TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1])).toThrow()
    expect(() => assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-intent', [...old.slice(0, 3), TTRPG_OPEN_LEARNED_IDENTITY_SOURCE_V1])).toThrow()
  })
})
