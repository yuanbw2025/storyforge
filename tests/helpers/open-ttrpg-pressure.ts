import { nextTtrpgOpenOperationStepV1 } from '../../src/lib/ttrpg/open-operation'
import { ttrpgOpenTurnCycleMatchesV1 } from '../../src/lib/ttrpg/open-turn-settlement'
import { ttrpgOpenPressureRuleSourceV1 } from '../../src/lib/ttrpg/open-pressure-cycle'
/** Real frozen pressure fixture shared by isolated IndexedDB regression and browser tests. */
import { setup, start } from './open-ttrpg-knowledge'
import { rt } from './open-ttrpg-branch-recovery'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { telegraphTtrpgOpenFrontV1, ttrpgOpenOperationCommandIdV1 } from '../../src/lib/ttrpg/runtime-commands'
import { ttrpgOpenScopedKeyV1 } from '../../src/lib/ttrpg/open-coordination'
import { nextTtrpgOpenPressureActionV1 } from '../../src/lib/ttrpg/open-pressure-cycle'
import { pressureActionKeyV1 } from '../../src/lib/ttrpg/open-pressure-reducer'

export async function setupPressureFixtureV1(options: { released?: boolean; turns?: number; generic?: boolean; maximum?: number; effect?: boolean; prewarn?: boolean; isolateSituations?: boolean } = {}, configure?: Parameters<typeof setup>[1], beforeStart?: (fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup({ generic: options.generic, released: options.released }, pkg => {
    const c = pkg.ttrpg!
    c.rulePack.content.timePolicy.existingAction = options.turns ?? 3
    c.rulePack.content.genericChecks[0].timeCostWorldTurns = options.turns ?? 3
    c.rulePack.content.timePolicy.actionOverrides = []
    c.campaign.clocks[0].maximum = options.maximum ?? 6
    c.campaign.clocks[0].autoAdvance = { onIdleWorldTurns: 1, onFailedCheck: options.generic ? 1 : 0, onOracleNo: 1, onStageClose: 0 }
    if (!options.effect) c.campaign.clocks[0].onCompleteEffectPlanRef = null
    c.campaign.fronts[0].escalationStages[0].atClockValue = Math.min(c.campaign.clocks[0].maximum, 3)
    c.campaign.fronts[0].escalationStages[0].newSituationTemplateKey = null
    if (options.isolateSituations) for (const template of c.campaign.situationTemplates) {
      template.obstacles = template.obstacles.map(obstacle => ({ ...obstacle,predicate: { op: 'world-turn-at-least',value: 20 } }))
      template.noInterventionOutcome.afterWorldTurns = 20
    }
    configure?.(pkg)
  })
  if (options.prewarn) {
    const sessionKey = rt(await readProductRuntimeState(f.sessionId)).sessionKey
    const input = { ...await openEnvelopeV1(f.sessionId, await ttrpgOpenScopedKeyV1(sessionKey, 'pressure-signal', ['storm', 'wind'])), viewerKey: OPEN_HUMAN_VIEWER, frontKey: 'storm', telegraphKey: 'wind' }
    const event = await telegraphTtrpgOpenFrontV1(input)
    const duplicate = await telegraphTtrpgOpenFrontV1(input)
    if (duplicate.id !== event.id || duplicate.sequence !== event.sequence) throw new Error('Warning retry created a new event')
  }
  await beforeStart?.(f)
  const command = await start(f)
  return { f, command }
}
export async function nextPressureInputV1(command: Awaited<ReturnType<typeof start>>) {
  const state = await readProductRuntimeState(command.sessionId), run = rt(state).openRun!,op = run.operations.find(o => o.operationKey === command.operationKey)!
  const receipt = run.ruleReceipts.find(r => r.operationKey === command.operationKey),step = nextTtrpgOpenOperationStepV1(op)
  const scope = step?.kind === 'pressure' ? step.stepKey : 'pressure'
  const cycle = receipt ? run.pressureCycles?.find(c => ttrpgOpenTurnCycleMatchesV1(c,op,ttrpgOpenPressureRuleSourceV1(receipt),'pressure')) : undefined
  const action = cycle && nextTtrpgOpenPressureActionV1(state, cycle)
  const key = !cycle ? `${scope}.plan` : action ? pressureActionKeyV1(action,scope) : `${scope}.settled`
  return { ...await openEnvelopeV1(command.sessionId, await ttrpgOpenOperationCommandIdV1(rt(state).sessionKey, command.operationKey, key)), ...command }
}
