import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOpenEntityPlanningV1 } from '../helpers/open-entity-runtime'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import { readTtrpgOpenEntityDeskV1, proposeTtrpgOpenEntityDeskV1, confirmTtrpgOpenEntityDeskV1, materializeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { consultTtrpgOracleV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { createTtrpgOpenRuntimeEntityReferencesV1, parseTtrpgOpenRuntimeEntityReferencesV1, assertTtrpgOpenRuntimeEntityReferencesMatchV1,
  verifyTtrpgOpenRuntimeEntityReferencesHashV1 } from '../../src/lib/ttrpg/open-runtime-entity-references'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

async function setup() {
  const s = await setupOpenEntityPlanningV1(pkg => {
    const c = pkg.ttrpg!.campaign, npc = c.characterTemplates.find(row => row.characterKey === 'keeper')!, definition = pkg.ttrpg!.rulePack.content.items[0]
    c.gmMode = 'human'; c.dynamicEntityTemplates[0].audience = 'private'; c.dynamicEntityTemplates[0].knownByActorKeys = ['hero']
    npc.gmProfile!.secret = 'RUNTIME-REFERENCE-GM-CANARY'; npc.itemKeys = [definition.key]
    npc.characterSheet = createCompleteTtrpgCharacterSheetV2({ template: npc, rulePack: pkg.ttrpg!.rulePack.content })
    c.entityBindings.find(row => row.bindingKey === 'keeper')!.initialInventoryRefs = ['keeper.initial.gear']
    c.entityBindings.push({ bindingKey: 'keeper.initial.gear', templateKey: definition.key, kind: 'item', initialLocationRef: null,
      initialInventoryRefs: [], sourceResourceRef: null, sourceFieldRefs: [], audience: 'party', knownByActorKeys: [] })
  }, 'viewer.gm')
  const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.gm' }
  await proposeTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'reference.snapshot.first', oracleSourceRef: s.input.oracleSourceRef, proposals: [s.proposals[0], s.proposals[1]] })
  const journal = async (sessionId = s.f.sessionId) => ({ content: s.input.content, runtimeSourceHash: s.f.session.runtimeSourceHash,
    operations: (await readProductRuntimeState(sessionId)).ttrpg!.openRun!.entityOperations ?? [] })
  const create = async () => {
    const p = (await readTtrpgOpenEntityDeskV1(input))!.pending!
    for (const a of p.approvals) await confirmTtrpgOpenEntityDeskV1({ ...input, operationKey: p.operationKey, planHash: p.planHash,
      actorKey: a.actorKey, decision: 'approve', review: 'reviewed-this-plan' })
    await materializeTtrpgOpenEntityDeskV1({ ...input, operationKey: p.operationKey, planHash: p.planHash, decision: 'create-this-confirmed-plan' })
  }
  return { ...s, deskInput: input, journal, create }
}
describe('R-TTRPGOPEN13 versioned immutable instance reference snapshot, not a permission grant', () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('has no instances for a pending plan, then records exact primary/equipment origins without names, secrets or mutable values', async () => {
    const s = await setup(), pending = await s.journal(), before = await readProductRuntimeState(s.f.sessionId)
    expect((await createTtrpgOpenRuntimeEntityReferencesV1(pending)).references).toEqual([])
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await s.create(); const journal = await s.journal(), snapshot = await createTtrpgOpenRuntimeEntityReferencesV1(journal)
    expect(snapshot.references).toHaveLength(3); expect(snapshot.references.map(row => row.entityRef)).toEqual(snapshot.references.map(row => row.entityRef).sort())
    const npc = snapshot.references.find(row => row.kind === 'actor')!, gear = snapshot.references.find(row => row.kind === 'item')!
    expect(npc).toMatchObject({ audience: 'private', recipientActorKeys: ['hero'], templateKey: 'keeper', dynamicTemplateKey: 'dynamic.npc' })
    expect(gear).toMatchObject({ audience: 'gm-only', recipientActorKeys: [], dynamicTemplateKey: null, operationKey: npc.operationKey, sourceRef: npc.sourceRef })
    for (const hidden of ['RUNTIME-REFERENCE-GM-CANARY', 'frozenContentJson', 'gmProfile', 'attributes', 'locationKey', 'quantity']) expect(JSON.stringify(snapshot)).not.toContain(hidden)
    expect(parseTtrpgOpenRuntimeEntityReferencesV1(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
    await assertTtrpgOpenRuntimeEntityReferencesMatchV1({ ...journal, snapshot, mode: 'current' })
    const selected = await createTtrpgOpenRuntimeEntityReferencesV1({ ...journal, entityRefs: [npc.entityRef] })
    expect(selected.references).toEqual([npc]); await assertTtrpgOpenRuntimeEntityReferencesMatchV1({ ...journal, snapshot: selected, mode: 'current', entityRefs: [npc.entityRef] })
    await expect(createTtrpgOpenRuntimeEntityReferencesV1({ ...journal, entityRefs: ['keeper'] })).rejects.toThrow(/未创建或冻结/)
  })
  it('rejects another source and rehashed identity/audience/plan substitutions against the actual journal', async () => {
    const s = await setup(); await s.create(); const journal = await s.journal(), original = await createTtrpgOpenRuntimeEntityReferencesV1(journal)
    await expect(createTtrpgOpenRuntimeEntityReferencesV1({ ...journal, runtimeSourceHash: '0'.repeat(64) })).rejects.toThrow(/实际冻结来源/)
    for (const field of ['audience', 'planHash', 'entityRef'] as const) {
      const changed = structuredClone(original), row = changed.references.find(row => row.kind === 'actor')!
      if (field === 'audience') row.audience = 'public'
      else if (field === 'planHash') row.planHash = '0'.repeat(64)
      else row.entityRef = 'entity.' + '0'.repeat(48)
      changed.references.sort((a, b) => a.entityRef.localeCompare(b.entityRef))
      const { snapshotHash: _hash, ...body } = changed; changed.snapshotHash = await hashProductProductionValueV2(body)
      await verifyTtrpgOpenRuntimeEntityReferencesHashV1(changed)
      await expect(assertTtrpgOpenRuntimeEntityReferencesMatchV1({ ...journal, snapshot: changed, mode: 'current' })).rejects.toThrow(/当前完整选择/)
    }
  })
  it('resolves historical identities after later creation without treating future instances as earlier evidence', async () => {
    const s = await setup(); await s.create(); const old = await createTtrpgOpenRuntimeEntityReferencesV1(await s.journal())
    const event = await consultTtrpgOracleV1({ ...await openEnvelopeV1(s.f.sessionId, 'reference.snapshot.second.oracle'), viewerKey: 'viewer.gm', askedBy: 'gm',
      oracleKey: 'oracle.yes', question: '另一位新人物是否出现？' })
    const state = await readProductRuntimeState(s.f.sessionId), consumerRef = { sessionKey: state.ttrpg!.sessionKey, sequence: event.sequence }
    await proposeTtrpgOpenEntityDeskV1({ ...s.deskInput, submissionKey: 'reference.snapshot.second', oracleSourceRef: consumerRef, proposals: [{ ...s.proposals[0], name: '第二位守灯人' }] })
    await s.create(); const journal = await s.journal(), current = await createTtrpgOpenRuntimeEntityReferencesV1(journal)
    expect(current.references).toHaveLength(5)
    await expect(assertTtrpgOpenRuntimeEntityReferencesMatchV1({ ...journal, snapshot: old, mode: 'current' })).rejects.toThrow(/当前完整选择/)
    await assertTtrpgOpenRuntimeEntityReferencesMatchV1({ ...journal, snapshot: old, mode: 'historical', consumerRef })
    await expect(assertTtrpgOpenRuntimeEntityReferencesMatchV1({ ...journal, snapshot: current, mode: 'historical', consumerRef })).rejects.toThrow(/先前实际创建/)
  })
  it('keeps actual parent-qualified identities through parent deletion and a complete project import', async () => {
    const s = await setup(); await s.create(); const original = await createTtrpgOpenRuntimeEntityReferencesV1(await s.journal())
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: (await readProductRuntimeState(s.f.sessionId)).lastSequence, title: 'Runtime reference child' })
    await deleteProductRuntimeSession(s.f.sessionId)
    expect(await createTtrpgOpenRuntimeEntityReferencesV1(await s.journal(child.id!))).toEqual(original)
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId)), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => row.title === child.title)!
    const journal = await s.journal(session.id!)
    expect(await createTtrpgOpenRuntimeEntityReferencesV1(journal)).toEqual(original)
    await assertTtrpgOpenRuntimeEntityReferencesMatchV1({ ...journal, snapshot: original, mode: 'current' })
  })
})
