/** Explicit engineering response, using only common fact/clock/identity/rule projections. */
import type { TtrpgOpenPublicSituationKernelV1 } from '../../src/lib/ttrpg/open-public-situation-kernel'
export function publicSituationOutputV1(snapshot: TtrpgOpenPublicSituationKernelV1) {
  const original = structuredClone(snapshot.basis.campaign.situationTemplates[0])
  const { templateKey: _key, ...template } = original
  const fact = snapshot.basis.campaign.frozenWorldPredicateIndex.entries.find(row => row.factKey === 'fact.harbor')!
  const rule = snapshot.resources.find(row => row.suffix === 'public-situation-rules')!.value as { actions: Array<{ actionKey: string }>; genericChecks: Array<{ checkKey: string }> }
  const actionKey = rule.actions[0]?.actionKey, checkKey = rule.genericChecks[0]?.checkKey
  if (!actionKey && !checkKey) throw new Error('public fixture needs a common discovery path')
  template.title = '港湾的共同调查'; template.motive = 'knowledge'
  template.driverBinding = { kind: 'world-event', factRef: fact.factKey }
  template.driverGoal = '寻找公开港湾线索之间的联系'
  template.driverBeliefs = [{ factRef: fact.factKey, belief: '港湾存在，线索可能彼此有关', isMistaken: false }]
  template.preconditions = [{ op: 'world-turn-at-least', value: 0 }]
  template.obstacles.forEach((row, index) => { row.ref = null; row.kind = index ? 'informational' : 'social'; row.predicate = { op: 'world-turn-at-least', value: 0 } })
  template.interventionPoints.forEach(row => {
    row.visibleTo = 'party'; row.knownByActorKeys = []; row.affordanceHint = '可以选择调查公开线索'
    row.requiresPredicate = null; row.suggestedActionKeys = actionKey ? [actionKey] : []
  })
  template.evidence.forEach((row, index) => {
    row.clueRef = snapshot.basis.assignedTemplateKey + '.evidence.' + index
    row.title = '候选线索' + index; row.description = '共同调查可以发现的候选线索' + index
    row.sourceFactRefs = [fact.factKey]; row.sourceResourceRefs = []; row.audience = 'party'; row.knownByActorKeys = []
    row.discoverableBy = [actionKey ?? checkKey]
    row.discoveryPolicy = { preconditions: [], paths: [{ kind: actionKey ? 'action' : 'generic-check', key: actionKey ?? checkKey,
      interventionPointKey: template.interventionPoints[index % template.interventionPoints.length].pointKey }],
    failForwardEffectPlanRef: null, costEffectPlanRef: null, allowedAudience: 'party', recipientActorKeys: [], requiresPlayerConfirmation: true }
  })
  template.whyNowRefs = ['world:harbor:exists', 'clock:flood']
  template.noInterventionOutcome = { afterWorldTurns: 2, description: '调查机会暂时消退，潮水继续上涨', effectPlanRef: null, advancesClockKeys: ['flood'] }
  template.consequences = []; template.sourceRefs = [fact.factKey]
  return { schema: 'storyforge.ttrpg-open-situation-proposal', version: 1, template,
    personalizationSourceKeys: [snapshot.basis.personalizationSources[0].sourceKey] }
}
