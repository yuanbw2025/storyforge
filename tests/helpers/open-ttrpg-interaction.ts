import { readyOpenTtrpgSessionV1,OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
import { readTtrpgOpenManualActionCatalogV1 } from '../../src/lib/ttrpg/open-table-service'
import { firstManualRequestV1 } from './open-ttrpg-manual'
import type { TtrpgOpenInteractionBindingV1 } from '../../src/lib/ttrpg/open-contract'
export async function seedOpenInteractionV1(kind: TtrpgOpenInteractionBindingV1['kind'],configure?: Parameters<typeof readyOpenTtrpgSessionV1>[1]) {
  const f = await readyOpenTtrpgSessionV1('冻结的游戏内互动',p => {
    const c = p.ttrpg!,action = c.rulePack.content.actions[0]
    action.effects = [];action.target = 'self';action.costResourceKey = null;action.costAmount = 0
    action.usage = { mode: 'unlimited',maximum: null,resourceKey: null,cost: null,sharedPoolKey: null,cooldownRounds: null,reset: [] }
    c.campaign.runtimePolicy.enabled = false
    c.campaign.entityBindings.push({ bindingKey: 'market',templateKey: 'market',kind: 'location',sourceResourceRef: null,sourceFieldRefs: [],initialLocationRef: null,initialInventoryRefs: [],audience: 'public',knownByActorKeys: [] })
    const base = c.campaign.effectPlanTemplates[0]
    c.campaign.effectPlanTemplates.push({ ...structuredClone(base),planKey: 'interaction.move',degree: 'success',alternatives: [],effects: [
      { effectKey: 'move.market',family: 'story',operation: 'location.set',targetRef: 'parameter:actor',storyKey: 'market',value: 'market' },
    ] })
    c.campaign.effectPlanTemplates.push({ ...structuredClone(base),planKey: 'interaction.cost',degree: 'success',alternatives: [],effects: [
      { effectKey: 'help.cost',family: 'numeric',operation: 'resource.spend',targetRef: 'parameter:actor',valueKey: c.rulePack.content.resources[0].key,amount: 1 },
    ] })
    c.rulePack.content.interactionBindings = [{ interactionKey: `interaction.${kind}`,kind,title: `明确的${kind}互动`,actionKey: action.key,
      effectPlanRef: kind === 'move' || kind === 'retreat' ? 'interaction.move' : kind === 'assist' ? 'interaction.cost' : null,
      preconditions: [],timeCostWorldTurns: kind === 'dialogue' ? 0 : kind === 'move' ? 2 : 1 }]
    configure?.(p)
  })
  const input = { scope: f.scope,sessionId: f.sessionId,viewerKey: OPEN_HUMAN_VIEWER },catalog = await readTtrpgOpenManualActionCatalogV1(input)
  const rule = catalog.rules.find(r => r.interactionKey === `interaction.${kind}`)!
  // Construct the frozen request shape even for negative admission cases; the real catalog stays unchanged.
  const { request } = firstManualRequestV1({ ...catalog,rules: [{ ...rule,available: true }] })
  return { f,input,catalog,rule,request }
}
