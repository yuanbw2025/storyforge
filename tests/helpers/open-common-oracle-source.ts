/** Actual AI-host Oracle/F13 fixture; no real-provider or independent-player evidence. */
import { setupOpenEntityPlanningV1 } from './open-entity-runtime'
import { OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import { proposeTtrpgOpenEntityDeskV1, readTtrpgOpenEntityDeskV1, confirmTtrpgOpenEntityDeskV1, materializeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'

export async function setupCommonOracleSourceV1(audience: 'party' | 'public' = 'party', late = false, configure?: Parameters<typeof setupOpenEntityPlanningV1>[0]) {
  const s = await setupOpenEntityPlanningV1(pkg => {
    const c = pkg.ttrpg!.campaign, rule = pkg.ttrpg!.rulePack.content
    c.runtimePolicy.enabled = true; rule.oracles[0].audience = audience
    const npc = c.characterTemplates.find(row => row.characterKey === 'keeper')!, item = rule.items[0]
    npc.gmProfile!.secret = 'COMMON-ORACLE-GM-PROFILE-CANARY'; npc.itemKeys = [item.key]
    npc.characterSheet = createCompleteTtrpgCharacterSheetV2({ template: npc, rulePack: rule })
    c.entityBindings.find(row => row.bindingKey === 'keeper')!.initialInventoryRefs = ['common.keeper.gear']
    c.entityBindings.push({ bindingKey: 'common.keeper.gear', templateKey: item.key, kind: 'item', initialLocationRef: null, initialInventoryRefs: [], sourceResourceRef: null, sourceFieldRefs: [], audience: 'gm-only', knownByActorKeys: [] })
    c.fronts[0].goal = 'COMMON-ORACLE-PRIVATE-FRONT-CANARY'
    c.dynamicEntityTemplates[0].description = 'COMMON-ORACLE-FULL-TEMPLATE-CANARY'
    c.dynamicEntityTemplates[1].audience = 'private'; c.dynamicEntityTemplates[1].knownByActorKeys = ['hero']
    const initial = structuredClone(c.frozenWorldPredicateIndex.entries[0])
    c.frozenWorldPredicateIndex.entries.push({ ...initial, factKey: 'fact.keeper.release', subjectRef: 'keeper', predicateKey: 'located-at', canonicalValue: 'harbor', authority: 'initial-state', owner: 'entity' })
    c.frozenWorldPredicateIndex.entries.push({ ...initial, factKey: 'fact.private.common.oracle', subjectRef: 'keeper', audience: 'private', knownByActorKeys: ['hero'] })
    rule.oracles.push({ ...structuredClone(rule.oracles[0]), oracleKey: 'oracle.shared.public', audience: 'public' })
    if (late) {
      const actor = structuredClone(c.characterTemplates.find(row => row.characterKey === 'companion.2')!)
      actor.characterKey = 'late'; actor.seatKey = 'seat.late'; actor.name = '后来者'
      actor.characterSheet = createCompleteTtrpgCharacterSheetV2({ template: actor, rulePack: rule })
      c.characterTemplates.push(actor)
      c.companionPolicy.approvalBindings.push({ companionActorKey: 'late', approverSeatKeys: ['seat.hero'], partyResourceApprovalAllowed: false })
      c.entityBindings.push({ ...structuredClone(c.entityBindings.find(row => row.bindingKey === 'companion.2')!), bindingKey: 'late', templateKey: 'late' })
    }
    configure?.(pkg)
  })
  const owner = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: OPEN_HUMAN_VIEWER }
  await proposeTtrpgOpenEntityDeskV1({ ...owner, submissionKey: 'common.oracle.original.plan', oracleSourceRef: s.input.oracleSourceRef, proposals: s.proposals.slice(0, 2) })
  const plan = (await readTtrpgOpenEntityDeskV1(owner))!.pending!
  for (const approval of plan.approvals) await confirmTtrpgOpenEntityDeskV1({ ...owner, operationKey: plan.operationKey, planHash: plan.planHash, actorKey: approval.actorKey, decision: 'approve', review: 'reviewed-this-plan' })
  await materializeTtrpgOpenEntityDeskV1({ ...owner, operationKey: plan.operationKey, planHash: plan.planHash, decision: 'create-this-confirmed-plan' })
  const actualPlan = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.entityOperations![0].plan
  const npc = actualPlan.items.find(row => row.kind === 'actor')!.entityKey, privatePlace = actualPlan.items.find(row => row.kind === 'location')!.entityKey
  return { ...s, owner, npc, privatePlace, contextInput: { ...owner, actorKey: 'gm' }, scope: { ...s.f.scope, productRuntimeSessionId: s.f.sessionId, runtimeActorKey: 'gm' } }
}
