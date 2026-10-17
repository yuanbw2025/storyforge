import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupIdentityKnowledgeRuntimeV1, identityKnowledgeWindowV1 } from '../helpers/open-identity-knowledge-runtime'
import { OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { approve, operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { prepareTtrpgOpenIdentityKnowledgeV1, confirmTtrpgOpenIdentityKnowledgeReviewV1 } from '../../src/lib/ttrpg/open-identity-knowledge-service'
import { loadTtrpgOpenCommonIdentityContextV1 } from '../../src/lib/ttrpg/open-common-identity-context'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1, assertTtrpgOpenFrozenContextSourcesV1 } from '../../src/lib/ttrpg/open-model-purpose-contract'
import { getAgentToolSchemaSnapshotV1 } from '../../src/lib/agent/tool-registry'
import { AGENT_TOOL_SCHEMA_HASH_V1, AGENT_TOOL_SCHEMA_VERSION_V1 } from '../../src/lib/agent/execution-binding'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { AGENT_SKILLS, resolveAgentSkillContextSourceKeysV1, getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { generateTtrpgOpenKpCandidateV1, generateTtrpgOpenBriefCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { ttrpgOpenDeliveredKpSourceKeysV1 } from '../../src/lib/ttrpg/open-kp-delivered-sources'
import { ttrpgOpenDeliveredBriefAttributionsV1 } from '../../src/lib/ttrpg/open-brief-output'
import type { ContextGatewaySourceSnapshotInputV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { parseTtrpgOpenBriefAttributionV1 } from '../../src/lib/ttrpg/open-brief-contract'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, startTtrpgOpenOperationV1, acceptTtrpgOpenKpNarrationV1, acceptTtrpgOpenBriefMemoryV1, completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { readTtrpgSessionParticipantsV2, configureTtrpgSessionParticipantV2 } from '../../src/lib/ttrpg/participants'
import { resolveScope } from '../../src/lib/workspace/scope'

async function setup() {
  const s = await setupIdentityKnowledgeRuntimeV1(false, true, 'party')
  const review = await prepareTtrpgOpenIdentityKnowledgeV1({ ...s.owner, request: s.request, submissionKey: 'common.observed' })
  const observed = await confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...s.owner, review, decision: 'confirm-these-identities-and-recipients' })
  return { ...s, observed, contextInput: { scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'gm' } }
}
async function share(s: Awaited<ReturnType<typeof setup>>, recipients = ['companion.1', 'companion.2']) {
  await identityKnowledgeWindowV1(s.f.sessionId, OPEN_HUMAN_VIEWER)
  const review = await prepareTtrpgOpenIdentityKnowledgeV1({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER, submissionKey: crypto.randomUUID(),
    request: { ...s.request, mode: 'share', actorKey: 'hero', sourceKnowledgeKey: s.observed.knowledgeKey, recipientActorKeys: recipients } })
  await confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER, review, decision: 'confirm-these-identities-and-recipients' })
}
async function briefWindow(s: Awaited<ReturnType<typeof setup>>, rawInput: string) {
  const run = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!, epoch = run.coordination.epochs.find(row => row.epochKey === run.coordination.activeEpochKey)!
  await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, crypto.randomUUID()), viewerKey: epoch.viewerKey, epochKey: epoch.epochKey, reason: '显式结束行动窗口' })
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, crypto.randomUUID()), viewerKey: 'viewer.gm', triggerKind: 'request-brief', rawInput })
}
const provider = () => CONTEXT_SOURCE_BY_KEY.get(TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1)!.resources!
describe('R-TTRPGOPEN9 all-current-player model identity intersection', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('freezes the actual v19 tool declaration and restores exact v18 when only the two identity sources are removed', async () => {
    const snapshot = getAgentToolSchemaSnapshotV1()
    const previous = JSON.parse(JSON.stringify(snapshot), (_key, value) => Array.isArray(value) ? value.filter(item => !['ttrpgOpenLearnedIdentities', 'ttrpgOpenCommonIdentities'].includes(item)) : value)
    expect(await hashCanonicalValue(snapshot)).toBe(AGENT_TOOL_SCHEMA_HASH_V1)
    expect(AGENT_TOOL_SCHEMA_VERSION_V1).toBe('agent-read-tools-v19')
    expect(await hashCanonicalValue(previous)).toBe('633a1385e92901aa1bba03f99abe413a68161577954917bd4073394fad9fdc18')
    for (const skill of AGENT_SKILLS.filter(skill => !['prose.ttrpg-open-kp', 'prose.ttrpg-open-brief'].includes(skill.id))) expect(resolveAgentSkillContextSourceKeysV1(skill, { includeOptional: true, includeGatewayProviders: true }), skill.id).not.toContain(TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1)
  })
  it('requires every actual player including AI; shared clue observation does not upgrade reported identities or expose private provenance', async () => {
    const s = await setup()
    expect((await loadTtrpgOpenCommonIdentityContextV1(s.contextInput)).view.identities).toEqual([])
    await share(s, ['companion.2'])
    expect((await loadTtrpgOpenCommonIdentityContextV1(s.contextInput)).view.identities).toEqual([])
    await share(s, ['companion.1'])
    const common = await loadTtrpgOpenCommonIdentityContextV1(s.contextInput)
    expect(common.view.recipientActorKeys).toEqual(['companion.1', 'companion.2', 'hero'])
    expect(common.view.identities).toEqual([{ citationKey: `identity.${s.entityRef}`, entityRef: s.entityRef, kind: 'actor', name: '新守灯人', reliability: 'hearsay' }])
    expect(JSON.stringify(common.view)).not.toMatch(/knowledgeKey|acquisitionRef|evidenceRef|evidenceTitle|gmProfile|gm-only|planHash|templateKey|locationRef|ownerRef|害怕洪水/)
    await expect(loadTtrpgOpenCommonIdentityContextV1({ ...s.contextInput, actorKey: 'hero' })).rejects.toThrow(/POV/)
  })
  it('upgrades the common grade only after each actual player has a genuine firsthand recognition receipt', async () => {
    const s = await setup(); await share(s)
    await identityKnowledgeWindowV1(s.f.sessionId, 'viewer.gm')
    const review = await prepareTtrpgOpenIdentityKnowledgeV1({ ...s.owner, submissionKey: 'common.all.firsthand', request: { ...s.request, recipientActorKeys: ['companion.1', 'companion.2'] } })
    await confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...s.owner, review, decision: 'confirm-these-identities-and-recipients' })
    expect((await loadTtrpgOpenCommonIdentityContextV1(s.contextInput)).view.identities[0].reliability).toBe('observed')
  })
  it('rechecks new Session Zero consent and permits common reading without granting individual AI advice', async () => {
    const s = await setup(); await share(s)
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, title: 'common consent child', throughSequence: (await readProductRuntimeState(s.f.sessionId)).lastSequence })
    const seat = (await readTtrpgSessionParticipantsV2(child.id!)).find(seat => seat.actorKey === 'hero')!
    await configureTtrpgSessionParticipantV2({ sessionId: child.id!, seatKey: seat.seatKey, expectedRevision: seat.revision, commandId: 'common.no-individual-advice', requestedByViewerKey: OPEN_HUMAN_VIEWER, consent: { aiAdviceAllowed: false } })
    const state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'common.new.zero'), viewerKey: 'viewer.gm', acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    const context = await loadTtrpgOpenCommonIdentityContextV1({ ...s.contextInput, sessionId: child.id! })
    expect(context.view.recipientActorKeys).toEqual(['companion.1', 'companion.2', 'hero']); expect(context.view.identities[0].reliability).toBe('hearsay')
  })
  it('pins full common bytes to actual participants and refuses partial reads, other POV and storage drift', async () => {
    const s = await setup(); await share(s)
    const scope = { ...s.f.scope, productRuntimeSessionId: s.f.sessionId, runtimeActorKey: 'gm' }, pin = await provider().openReadSession!(scope)
    const rows = (await pin.provider.listMetadata({ scope, limit: 1000 })).items, row = rows.find(row => row.title === '新守灯人')!
    await expect(pin.provider.read({ scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 1 })).rejects.toThrow(/完整资源/)
    await expect(pin.provider.readOriginal({ scope, resourceKey: row.resourceKey, maxTokens: 10000 })).rejects.toThrow(/禁止/)
    await expect(pin.provider.read({ scope: { ...scope, runtimeActorKey: 'hero' }, resourceKey: row.resourceKey, depth: 'full', maxTokens: 10000 })).rejects.toThrow(/更换/)
    const seat = (await readTtrpgSessionParticipantsV2(s.f.sessionId)).find(row => row.actorKey === 'companion.1')!
    // Deliberately corrupt/stale storage, not a legal post-Session-Zero consent edit.
    await db.ttrpgSessionParticipants.update(seat.id!, { consent: { ...seat.consent, sessionLoggingAllowed: false }, revision: seat.revision + 1 })
    await expect(pin.provider.read({ scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 10000 })).rejects.toThrow(/变化/)
    await expect(provider().listMetadata({ scope, limit: 1000 })).rejects.toThrow()
  })
  it('retains exact old KP and brief grants while new common-source generations stay closed', () => {
    for (const keys of [['ttrpgOpenKpInput'], ['ttrpgOpenKpInput', 'ttrpgOpenPartyContext'], ['ttrpgOpenKpInput', 'ttrpgOpenPartyContext', 'ttrpgOpenPartyMemory']])
      expect(assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-kp', keys)).toEqual(keys)
    const old = ['ttrpgOpenBriefInput', 'ttrpgOpenPartyMemory']
    expect(assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-brief', old)).toEqual(old)
    for (const id of ['prose.ttrpg-open-kp', 'prose.ttrpg-open-brief']) expect(assertTtrpgOpenFrozenContextSourcesV1(id, getAgentSkillV1(id).contextSourceKeys)).toContain(TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1)
    expect(() => assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-brief', ['ttrpgOpenBriefInput', TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1])).toThrow(/协议权限/)
    expect(() => assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-oracle-interpret', ['ttrpgOpenGmOracleInput', TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1])).toThrow(/协议权限/)
    expect(getAgentSkillV1('prose.ttrpg-open-kp').promptVersion).toBe('ttrpg-open-kp-v4')
    expect(getAgentSkillV1('prose.ttrpg-open-brief').promptVersion).toBe('ttrpg-open-brief-v2')
  })
  it('delivers common identity to a real KP request and accepts exactly one cited narration without time, entity or knowledge changes', async () => {
    const s = await setup(); await share(s)
    await identityKnowledgeWindowV1(s.f.sessionId, OPEN_HUMAN_VIEWER)
    const action = s.f.runtimePackage.ttrpg!.rulePack.content.actions[0]
    await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(s.f.sessionId, 'common.next.operation'), viewerKey: OPEN_HUMAN_VIEWER,
      request: { route: 'existing-action', actorKey: 'hero', controllerMode: 'human', ruleKey: action.key, targetKey: action.target === 'self' ? 'hero' : action.target === 'scene' ? null : 'keeper', effectBindings: {} } })
    const operation = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.operations.at(-1)!
    await approve(s.f.sessionId, operation.operationKey)
    const command = { sessionId: s.f.sessionId, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey: OPEN_HUMAN_VIEWER }
    expect((await resumeTtrpgOpenPlayV1(command)).status).toBe('awaiting-narration')
    const before = await readProductRuntimeState(s.f.sessionId), raw = JSON.stringify({ paragraphs: [{ text: '你们听说此人名为新守灯人，仍须谨慎核实。', sourceKeys: [`identity.${s.entityRef}`] }] }), runAI = vi.fn(async () => raw)
    const generated = await generateTtrpgOpenKpCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'common.kp'), scope: s.f.scope, viewerKey: 'viewer.gm', rawInput: 'GM-PRIVATE-RAW-EXCLUDED', maximumOutputTokens: 800, maximumCostUsd: .1, runAI })
    expect(generated.candidate.narration).toEqual(JSON.parse(raw)); expect(runAI).toHaveBeenCalledTimes(1)
    expect(generated.prepared.evidence.selector.selected.filter(row => row.sourceKey === TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1)).toHaveLength(2)
    const messages = generated.prepared.messages.map(row => row.content).join('\n')
    expect(messages).toContain('storyforge.ttrpg-open-common-identity'); expect(messages).toContain('hearsay'); expect(messages).not.toContain('GM-PRIVATE-RAW-EXCLUDED'); expect(messages).toContain('共同身份的 citationKey')
    const id = { ...s.owner, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey }
    const adoption = { ...await operationInput(s.f.sessionId, operation.operationKey, 'narration'), viewerKey: 'viewer.gm', runId: id.runId, requestKey: id.requestKey, candidateHash: generated.candidate.candidateHash }
    await acceptTtrpgOpenKpNarrationV1(adoption)
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.knowledge).toEqual(before.ttrpg!.openRun!.knowledge); expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect((await readInstanceAgentRunV1(s.f.scope, id.runId)).projection.state).toBe('completed')
  })
  it('retains the reported common identity through real recap adoption and the next party-memory attribution read', async () => {
    const s = await setup(); await share(s)
    const rawInput = '复盘新守灯人身份的原可靠性'
    await briefWindow(s, rawInput)
    const before = await readProductRuntimeState(s.f.sessionId)
    const generated = await generateTtrpgOpenBriefCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'common.brief'), scope: s.f.scope, viewerKey: 'viewer.gm', rawInput, maximumOutputTokens: 800, maximumCostUsd: .1,
      runAI: async () => JSON.stringify({ paragraphs: [{ text: '队伍听说此人名为新守灯人，这份身份转述尚需核实。', sourceKeys: [`identity.${s.entityRef}`] }] }) })
    expect(generated.candidate.brief).not.toBeNull()
    const attribution = generated.candidate.attributions.find(row => row.kind === 'known-identity')!
    expect(attribution).toMatchObject({ contextSourceKey: TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1, reliability: 'hearsay', observerKey: null, origin: null, sourceRef: null })
    await acceptTtrpgOpenBriefMemoryV1({ ...await openEnvelopeV1(s.f.sessionId, 'common.brief.accept'), viewerKey: 'viewer.gm', runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash })
    const after = await readProductRuntimeState(s.f.sessionId), receipt = after.ttrpg!.openRun!.memoryReceipts!.at(-1)!
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.knowledge).toEqual(before.ttrpg!.openRun!.knowledge); expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    const scope = { ...s.f.scope, productRuntimeSessionId: s.f.sessionId, runtimeActorKey: 'gm' }, reads: ContextGatewaySourceSnapshotInputV1[] = []
    for (const key of ['ttrpgOpenBriefInput', 'ttrpgOpenPartyMemory']) {
      const pin = await CONTEXT_SOURCE_BY_KEY.get(key)!.resources!.openReadSession!(scope)
      for (const row of (await pin.provider.listMetadata({ scope, limit: 1000 })).items) {
        if (key === 'ttrpgOpenBriefInput' && row.priority !== 'must-read') continue
        const read = await pin.provider.read({ scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 16000 })
        reads.push({ sourceKey: key, resourceKey: row.resourceKey, sourceRefs: read.sourceRefs, content: read.content })
      }
      await pin.assertCurrent()
    }
    const memory = (await ttrpgOpenDeliveredBriefAttributionsV1(reads)).find(row => row.citationKey === `memory.${receipt.draft.revisionKey}`)!
    expect(memory.originalSources).toContainEqual(attribution)
  })
  it('keeps the exact common names and grade through a real child, parent deletion and full backup', async () => {
    const s = await setup(); await share(s)
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, title: 'common identity child', throughSequence: (await readProductRuntimeState(s.f.sessionId)).lastSequence })
    const state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'common.child.zero'), viewerKey: 'viewer.gm', acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    const expected = (await loadTtrpgOpenCommonIdentityContextV1({ ...s.contextInput, sessionId: child.id! })).view
    await deleteProductRuntimeSession(s.f.sessionId)
    expect((await loadTtrpgOpenCommonIdentityContextV1({ ...s.contextInput, sessionId: child.id! })).view).toEqual(expected)
    const importedId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId)), imported = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()).find(row => row.title === 'common identity child')!
    const scope = await resolveScope({ projectId: importedId })
    expect((await loadTtrpgOpenCommonIdentityContextV1({ scope, sessionId: imported.id!, actorKey: 'gm' })).view).toEqual(expected)
  })
  it('does not admit invented, undelivered or private-source identity citations into the old KP and recap protocols', async () => {
    const s = await setup(); await share(s)
    const context = await loadTtrpgOpenCommonIdentityContextV1(s.contextInput), contract = context.resources[0].value, row = context.resources[1].value
    const kp = { schema: 'storyforge.ttrpg-open-kp-contract', version: 2, allowedSourceKeys: ['action.receipt'] }
    const packet = { schema: 'storyforge.ttrpg-open-kp-input', version: 2, recipientActorKeys: context.view.recipientActorKeys }
    expect(ttrpgOpenDeliveredKpSourceKeysV1([kp, packet, contract])).toEqual(['action.receipt'])
    expect(ttrpgOpenDeliveredKpSourceKeysV1([kp, packet, contract, row])).toContain(`identity.${s.entityRef}`)
    expect(() => ttrpgOpenDeliveredKpSourceKeysV1([kp, packet, row])).toThrow(/合同/)
    expect(() => ttrpgOpenDeliveredKpSourceKeysV1([kp, { ...packet, recipientActorKeys: ['hero'] }, contract, row])).toThrow(/全部/)
    const valid = { citationKey: `identity.${s.entityRef}`, resourceKey: `fact:ttrpg-open:example:gm:common-identity.${s.entityRef}`, contextSourceKey: TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1,
      contentHash: 'a'.repeat(64), kind: 'known-identity', reliability: 'hearsay', observerKey: null, origin: null, sourceRef: null }
    expect(parseTtrpgOpenBriefAttributionV1(valid).reliability).toBe('hearsay')
    expect(parseTtrpgOpenBriefAttributionV1({ ...valid, reliability: 'belief' }).reliability).toBe('belief')
    for (const patch of [{ observerKey: 'hero' }, { contextSourceKey: 'ttrpgOpenBriefInput' }, { reliability: 'confirmed' }, { resourceKey: 'private-identity' }]) expect(() => parseTtrpgOpenBriefAttributionV1({ ...valid, ...patch })).toThrow()
  })
})
