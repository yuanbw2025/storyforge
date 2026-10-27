/** Native/fake IndexedDB fixture with a real first-turn condition consequence. */
import { setupPressureFixtureV1 } from './open-ttrpg-pressure'
import { settleOpenPaidTurnsV1 } from './open-ttrpg-paid-turns'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { rt } from './open-ttrpg-branch-recovery'
export async function setupPerTurnConsequenceFixtureV1() {
  const x = await setupPressureFixtureV1({ turns: 3,maximum: 2,effect: true,isolateSituations: true },pkg => {
    const c = pkg.ttrpg!,condition = c.rulePack.content.conditions[0],ability = c.rulePack.content.actions[1]
    c.campaign.clocks[0].initialValue = 1
    ability.requirements = [{ kind: 'condition',conditionKey: condition.key,stacks: 1,operator: 'present' }]
    const effect = c.campaign.effectPlanTemplates[0]
    effect.alternatives = [];effect.effects = [{ effectKey: 'temporary',family: 'condition',operation: 'condition.apply',targetRef: 'parameter:actor',conditionKey: condition.key,stacks: 1,duration: 2 }]
    c.campaign.clocks.push({ ...structuredClone(c.campaign.clocks[0]),clockKey: 'temporary.ability',initialValue: 0,title: '限时能力',maximum: 10,onCompleteEffectPlanRef: null,
      autoAdvance: { onIdleWorldTurns: 0,onFailedCheck: 0,onOracleNo: 0,onStageClose: 0 },
      advanceTriggers: [{ triggerKey: 'available',sceneKey: null,actionKey: null,condition: { op: 'ability-available',actorKey: 'hero',abilityKey: ability.key },amount: 1,reason: '真实当前能力' }] })
  })
  const result = await settleOpenPaidTurnsV1(x.command)
  const state = await readProductRuntimeState(x.f.sessionId),cycle = rt(state).openRun!.pressureCycles!.find(c => c.work.some(w => !w.completedRef))
  if (!cycle || result.status !== 'awaiting-consequence') throw new Error('Expected actual first-turn cost')
  return { ...x,cycle,work: cycle.work[0],state }
}
