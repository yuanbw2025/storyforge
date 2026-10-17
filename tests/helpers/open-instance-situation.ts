/** Real deterministic F13 fixture shared by regression and isolated native-browser tests. */
import { setupOpenEntityPlanningV1 } from './open-entity-runtime'
import { OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
import { readTtrpgOpenEntityDeskV1, proposeTtrpgOpenEntityDeskV1, confirmTtrpgOpenEntityDeskV1, materializeTtrpgOpenEntityDeskV1, closeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'

export async function setupInstanceSituationV1(humanGm = true) {
  const s = await setupOpenEntityPlanningV1(pkg => {
    const c = pkg.ttrpg!.campaign, rule = pkg.ttrpg!.rulePack.content
    c.gmMode = humanGm ? 'human' : 'ai'; c.runtimePolicy.enabled = true; c.runtimePolicy.maximumEpochTokens = 50000; c.runtimePolicy.maximumOutputTokens = 8000
    if (!humanGm) {
      c.dynamicEntityTemplates[1].audience = 'private'; c.dynamicEntityTemplates[1].knownByActorKeys = ['hero']
      const npc = c.characterTemplates.find(row => row.characterKey === 'keeper')!, definition = rule.items[0]
      npc.gmProfile!.secret = 'INSTANCE-SITUATION-PRIVATE-NPC-PROFILE'; npc.itemKeys = [definition.key]
      npc.characterSheet = createCompleteTtrpgCharacterSheetV2({ template: npc, rulePack: rule })
      c.entityBindings.find(row => row.bindingKey === 'keeper')!.initialInventoryRefs = ['keeper.initial.gear']
      c.entityBindings.push({ bindingKey: 'keeper.initial.gear', templateKey: definition.key, kind: 'item', initialLocationRef: null,
        initialInventoryRefs: [], sourceResourceRef: null, sourceFieldRefs: [], audience: 'party', knownByActorKeys: [] })
    }
    rule.actions[0].effects = []; rule.timePolicy.existingAction = 2; rule.timePolicy.actionOverrides = []
    const template = c.situationTemplates[0]
    template.obstacles.forEach(o => { o.predicate = { op: 'world-turn-at-least', value: 20 } })
    template.noInterventionOutcome.afterWorldTurns = 2; template.consequences = []
    template.evidence[0].audience = 'gm-only'; template.evidence[0].knownByActorKeys = []
    template.evidence[0].discoveryPolicy.allowedAudience = 'private'; template.evidence[0].discoveryPolicy.recipientActorKeys = ['hero']
    template.evidence[0].discoveryPolicy.requiresPlayerConfirmation = true
    c.fronts[0].escalationStages[0].newSituationTemplateKey = null
    c.clocks[0].maximum = 8; c.clocks[0].onCompleteEffectPlanRef = null; c.clocks[0].autoAdvance.onIdleWorldTurns = 1
  }, humanGm ? 'viewer.gm' : OPEN_HUMAN_VIEWER)
  const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: humanGm ? 'viewer.gm' : OPEN_HUMAN_VIEWER }
  await proposeTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'instance.situation.create', oracleSourceRef: s.input.oracleSourceRef, proposals: s.proposals.slice(0, 2) })
  const pending = (await readTtrpgOpenEntityDeskV1(input))!.pending!
  for (const approval of pending.approvals) await confirmTtrpgOpenEntityDeskV1({ ...input, operationKey: pending.operationKey, planHash: pending.planHash,
    actorKey: approval.actorKey, decision: 'approve', review: 'reviewed-this-plan' })
  await materializeTtrpgOpenEntityDeskV1({ ...input, operationKey: pending.operationKey, planHash: pending.planHash, decision: 'create-this-confirmed-plan' })
  await closeTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'instance.situation.close' })
  const before = await readProductRuntimeState(input.sessionId), npc = Object.values(before.entities).find(e => e.name === '新守灯人')!, place = Object.values(before.entities).find(e => e.name === '新候选地点')!
  return { ...s, deskInput: input, before, npc: npc.entityKey, place: place.entityKey }
}
