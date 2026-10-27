import { nextTtrpgOpenOperationStepV1 } from '../../src/lib/ttrpg/open-operation'
import { resumeTtrpgOpenSituationsV1 } from '../../src/lib/ttrpg/open-situation-coordinator'
/** Real isolated frozen admission/cleanup fixture, no model transport. */
import { setupPressureFixtureV1, nextPressureInputV1 } from './open-ttrpg-pressure'
import { rt } from './open-ttrpg-branch-recovery'
import { openEnvelopeV1 } from './open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { advanceTtrpgOpenPressureV1, changeTtrpgSituationV1,completeTtrpgOpenOperationStepV1,ttrpgOpenOperationCommandIdV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'

export async function setupSituationPressureWorkV1(options: { duplicate?: boolean; defeat?: boolean; inaccessible?: boolean; full?: boolean; whyTelegraph?: boolean } = {}) {
  const f = await setupPressureFixtureV1({ turns: options.defeat ? 10 : 3, prewarn: !options.defeat }, pkg => {
    const campaign = pkg.ttrpg!.campaign, opening = campaign.situationTemplates[0]
    // This fixture isolates front-owned work; general situation outcomes have
    // separate consent/maintenance coverage. Keep them outside its ten turns.
    opening.obstacles = opening.obstacles.map(o => ({ ...o,predicate: { op: 'world-turn-at-least',value: 20 } }))
    opening.noInterventionOutcome.afterWorldTurns = 20
    if (options.defeat) {
      opening.driverBinding = { kind: 'front', frontKey: 'storm' }
      return
    }
    if (options.full) {
      for (let i = 1; i <= 4; i++) {
        const filler = structuredClone(opening)
        filler.templateKey = `situation.filler.${i}`
        filler.evidence = filler.evidence.map(e => ({ ...e, clueRef: `${e.clueRef}.filler.${i}` }))
        campaign.situationTemplates.push(filler)
        campaign.openingSituationKeys.push(filler.templateKey)
      }
    }
    if (options.duplicate) campaign.fronts[0].escalationStages[0].newSituationTemplateKey = opening.templateKey
    else {
      const second = structuredClone(opening)
      second.templateKey = 'situation.after-storm'
      second.evidence = second.evidence.map(e => ({ ...e, clueRef: `${e.clueRef}.after` }))
      if (options.whyTelegraph) {
        campaign.clocks[0].visibility = 'gm-only'
        second.whyNowRefs = ['telegraph:wind', 'clock:flood']
      }
      if (options.inaccessible) second.preconditions = [{ op: 'world-turn-at-least', value: 10 }]
      campaign.situationTemplates.push(second)
      campaign.fronts[0].escalationStages[0].newSituationTemplateKey = second.templateKey
    }
  }, async fixture => {
    if (options.full) for (const templateKey of fixture.campaign.openingSituationKeys.slice(1)) await changeTtrpgSituationV1({
      ...await openEnvelopeV1(fixture.sessionId, `opening.${templateKey}`), templateKey, activationReason: 'opening', mode: 'activated' })
  })
  await resumeTtrpgOpenOperationV1(f.command)
  for (let i = 0; i < 256; i++) {
    const state = await readProductRuntimeState(f.f.sessionId),run = rt(state).openRun!,cycle = run.pressureCycles?.find(c => c.work.some(w => w.situationTemplateKey && !w.completedRef))
    const pending = cycle?.work.find(w => w.situationTemplateKey && !w.completedRef)
    if (cycle && pending) return { ...f, cycleKey: cycle.cycleKey, workKey: pending.workKey,ownerStepKey: cycle.operationStepKey ?? 'pressure' }
    const step = nextTtrpgOpenOperationStepV1(run.operations[0])
    if (step?.kind === 'pressure' && run.operations[0].businessRefs.some(r => r.stepKey === step.stepKey)) await completeTtrpgOpenOperationStepV1({ ...await openEnvelopeV1(f.command.sessionId,await ttrpgOpenOperationCommandIdV1(rt(state).sessionKey,f.command.operationKey,`${step.stepKey}.receipt`)),...f.command,stepKey: step.stepKey })
    else if (step?.kind === 'pressure') await advanceTtrpgOpenPressureV1(await nextPressureInputV1(f.command))
    else if (step?.kind === 'situations') await resumeTtrpgOpenSituationsV1(f.command)
    else if (step && !['terminal','gates','narration','handoff'].includes(step.kind)) await resumeTtrpgOpenOperationV1(f.command)
    else break
  }
  throw new Error('expected actual pressure situation work')
}
