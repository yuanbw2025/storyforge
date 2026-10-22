import { settleOpenPaidTurnsV1 } from './open-ttrpg-paid-turns'
/** Isolated real approval work fixture; no model transport or private configuration. */
import { setupPressureFixtureV1 } from './open-ttrpg-pressure'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { rt } from './open-ttrpg-branch-recovery'
import { OPEN_HUMAN_VIEWER } from './open-ttrpg-session'

export async function setupPressureEffectFixtureV1(options: { humanGm?: boolean; aiTarget?: boolean; impossible?: boolean } = {}, configure?: Parameters<typeof setupPressureFixtureV1>[1], beforeStart?: Parameters<typeof setupPressureFixtureV1>[2]) {
  const result = await setupPressureFixtureV1({ turns: 2, maximum: 2, effect: true }, pkg => {
    const template = pkg.ttrpg!.campaign.effectPlanTemplates[0], resource = pkg.ttrpg!.rulePack.content.resources[0].key
    template.effects = []
    const cost = { effectKey: 'small.cost', family: 'numeric' as const, operation: 'resource.spend' as const, targetRef: 'parameter:actor', valueKey: resource, amount: options.impossible ? 999 : 1 }
    template.alternatives = [{ alternativeKey: 'small', title: '支付一份资源', effects: [cost] }, { alternativeKey: 'large', title: '支付两份资源', effects: [{ ...cost, effectKey: 'large.cost', amount: 2 }] }]
    if (options.aiTarget) {
      template.parameters[0].allowedRefs = ['companion.1']
    }
    if (options.humanGm) pkg.ttrpg!.campaign.gmMode = 'human'
    configure?.(pkg)
  }, beforeStart)
  await settleOpenPaidTurnsV1(result.command)
  const state = await readProductRuntimeState(result.f.sessionId), cycle = rt(state).openRun!.pressureCycles!.find(c => c.work.some(w => !w.completedRef))!, work = cycle.work[0]
  return { ...result, cycleKey: cycle.cycleKey, workKey: work.workKey, resource: result.f.runtimePackage.ttrpg!.rulePack.content.resources[0].key,
    gmViewer: options.humanGm ? 'viewer.gm' : OPEN_HUMAN_VIEWER, target: options.aiTarget ? 'companion.1' : 'hero' }
}
