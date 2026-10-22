import { setupOpenEntityPlanningV1 } from './open-entity-runtime'
import { loadTtrpgOpenEntityContextV1 } from '../../src/lib/ttrpg/open-entity-context'
import type { TtrpgOpenEntityModelSelectionV1 } from '../../src/lib/ttrpg/open-entity-model-contract'
import { OPEN_HUMAN_VIEWER } from './open-ttrpg-session'

export async function setupOpenEntityModelV1(audience: 'party' | 'private' | 'gm-only' = 'party', configure?: Parameters<typeof setupOpenEntityPlanningV1>[0]) {
  const viewerKey = audience === 'gm-only' ? 'viewer.gm' : OPEN_HUMAN_VIEWER
  const s = await setupOpenEntityPlanningV1(pkg => {
    const c = pkg.ttrpg!.campaign; c.runtimePolicy.enabled = true; c.runtimePolicy.maximumEpochTokens = 50000
    if (audience === 'gm-only') { c.gmMode = 'human'; pkg.ttrpg!.rulePack.content.oracles[0].audience = 'gm-only' }
    c.characterTemplates.find(c => c.characterKey === 'keeper')!.gmProfile!.secret = 'ENTITY-MODEL-NPC-SECRET-CANARY'
    c.fronts[0].goal = 'ENTITY-MODEL-FRONT-SECRET-CANARY'
    c.dynamicEntityTemplates.push({ ...c.dynamicEntityTemplates[0], templateKey: 'private.hero.template', audience: 'private', knownByActorKeys: ['hero'], description: 'ENTITY-MODEL-PRIVATE-TEMPLATE-CANARY' },
      { ...c.dynamicEntityTemplates[0], templateKey: 'gm.template', audience: 'gm-only', description: 'ENTITY-MODEL-GM-TEMPLATE-CANARY' })
    configure?.(pkg)
  }, viewerKey)
  const context = await loadTtrpgOpenEntityContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'gm' })
  const partition = context.directory.find(d => d.scope.audience === audience)!
  const selection: TtrpgOpenEntityModelSelectionV1 = { schema: 'storyforge.ttrpg-open-entity-model-selection', version: 1,
    oracleSourceRef: partition.sourceRef, scope: partition.scope, epochInputRevision: context.epochInputRevision,
    templateKeys: [audience === 'private' ? 'private.hero.template' : audience === 'gm-only' ? 'gm.template' : 'dynamic.npc'], placementRefs: ['harbor'] }
  const proposal = { ...s.proposals[0], templateKey: selection.templateKeys[0] }
  return { ...s, context, viewerKey, selection, proposal }
}
