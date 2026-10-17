import { settleOpenPaidTurnsV1 } from './open-ttrpg-paid-turns'
/** Actual frozen fixture for terminal and role-bound runtime gates. */
import { setupPressureFixtureV1 } from './open-ttrpg-pressure'
import { operationInput } from './open-ttrpg-branch-recovery'
import { evaluateTtrpgOpenOperationTerminalV1 } from '../../src/lib/ttrpg/runtime-commands'
export async function setupChecksFixtureV1(options: { closure?: boolean; maximum?: boolean; empty?: boolean; privatePoint?: boolean; noWarning?: boolean; privateDiscovery?: boolean; stageTick?: number; stageEffect?: boolean; stageMaximum?: number; multiHuman?: boolean; nearlyMaximum?: boolean; initiallyAlmostFull?: boolean; humanGm?: boolean; ai?: boolean; cooperative?: boolean; maximumCalls?: number } = {}, configure?: Parameters<typeof setupPressureFixtureV1>[1], beforeStart?: Parameters<typeof setupPressureFixtureV1>[2]) {
  const f = await setupPressureFixtureV1({ turns: options.maximum ? 10 : options.nearlyMaximum ? 9 : options.noWarning ? 2 : 1, prewarn: !options.noWarning && !options.humanGm }, pkg => {
    if (options.ai || options.cooperative) pkg.ttrpg!.campaign.runtimePolicy.enabled = true
    if (options.maximumCalls !== undefined) pkg.ttrpg!.campaign.runtimePolicy.maximumCallsPerEpoch = options.maximumCalls
    if (options.cooperative) pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
    if (options.humanGm) pkg.ttrpg!.campaign.gmMode = 'human'
    if (options.multiHuman) pkg.ttrpg!.campaign.characterTemplates[1].controller = 'hybrid'
    const c = pkg.ttrpg!, situation = c.campaign.situationTemplates[0]
    if (options.noWarning) for (const front of c.campaign.fronts) for (const signal of front.telegraph) signal.minLeadWorldTurns = 2
    situation.consequences = []
    situation.obstacles = situation.obstacles.map(o => ({ ...o, predicate: { op: 'world-turn-at-least', value: options.empty ? 1 : 10 } }))
    situation.noInterventionOutcome.afterWorldTurns = 20
    if (options.stageTick) c.campaign.clocks[0].autoAdvance.onStageClose = options.stageTick
    if (options.stageMaximum) { c.campaign.clocks[0].maximum = options.stageMaximum; c.campaign.fronts[0].escalationStages[0].atClockValue = Math.min(3, options.stageMaximum) }
    if (options.initiallyAlmostFull) c.campaign.clocks[0].initialValue = c.campaign.clocks[0].maximum - 1
    if (options.stageEffect) {
      c.campaign.clocks[0].onCompleteEffectPlanRef = 'plan.success'
      c.campaign.effectPlanTemplates[0].effects = [{ effectKey: 'stage.cost', family: 'numeric', operation: 'resource.spend', targetRef: 'parameter:actor', valueKey: c.rulePack.content.resources[0].key, amount: 1 }]
    }
    if (options.closure) c.campaign.stageClosurePolicy.triggers[0].predicate = { op: 'world-turn-at-least', value: 1 }
    if (options.maximum || options.nearlyMaximum) c.campaign.stageClosurePolicy.maximumWorldTurns = 10
    if (options.privatePoint) situation.interventionPoints = situation.interventionPoints.map(point => ({ ...point, visibleTo: 'private', knownByActorKeys: ['companion.1'] }))
    if (options.privateDiscovery) {
      const evidence = situation.evidence[0]
      evidence.discoveryPolicy.allowedAudience = 'private'; evidence.discoveryPolicy.recipientActorKeys = ['hero']
      situation.interventionPoints = situation.interventionPoints.map(point => ({ ...point, targetsObstacleKeys: [situation.obstacles[1].obstacleKey] }))
    }
    configure?.(pkg)
  }, async fixture => { if (options.privatePoint) Reflect.deleteProperty(fixture.request, 'discovery');await beforeStart?.(fixture) })
  await settleOpenPaidTurnsV1(f.command)
  return f
}
export async function checksTerminalV1(command: Awaited<ReturnType<typeof setupChecksFixtureV1>>['command']) {
  return evaluateTtrpgOpenOperationTerminalV1(await operationInput(command.sessionId, command.operationKey, 'terminal'))
}

export async function approveChecksStageEffectV1(command: Awaited<ReturnType<typeof setupChecksFixtureV1>>['command']) {
  const api = await import('../../src/lib/ttrpg/runtime-commands'), { readProductRuntimeState } = await import('../../src/lib/product/runtime-core'), { rt } = await import('./open-ttrpg-branch-recovery')
  const run = rt(await readProductRuntimeState(command.sessionId)).openRun!, cycle = run.stageClosures!.find(c => !c.completedRef)!, work = cycle.work.find(w => !w.completedRef)!
  const locator = { ...command, cycleKey: cycle.cycleKey, workKey: work.workKey }, request = { bindings: { actor: 'hero' }, alternativeKey: null }
  const review = await api.prepareTtrpgOpenStageEffectV1({ ...locator, request })
  await api.proposeTtrpgOpenStageEffectV1({ ...await operationInput(command.sessionId, command.operationKey, `stage.work.${work.workKey}.${review.reviewKey}.propose`), ...locator, request, riskHash: review.riskHash, reviewKey: review.reviewKey })
  await api.confirmTtrpgOpenStageEffectV1({ ...await operationInput(command.sessionId, command.operationKey, `stage.work.${work.workKey}.${review.reviewKey}.approval.hero`), ...locator, actorKey: 'hero', decision: 'approve', riskHash: review.riskHash, reviewKey: review.reviewKey })
  return review
}
