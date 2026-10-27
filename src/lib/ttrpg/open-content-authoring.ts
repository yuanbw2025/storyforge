import { parseTtrpgOpenContextPolicyV1 } from './open-context-policy'
import type { TtrpgOpenAuthoringV1 } from './open-contract'
import * as p from './open-contract-parse'
import { frozenFact } from './open-content-predicates'
import { clock, front, situation } from './open-content-situations'
import { effectTemplate, dynamicTemplate, companionPolicy, closurePolicy, runtimePolicy } from './open-content-templates'

/** Drafts may be empty. Cross-resource closure belongs to Campaign V2 publication parsing. */
export function parseTtrpgOpenAuthoringV1(input: unknown): TtrpgOpenAuthoringV1 {
  const raw = p.object(p.json(input), 'openAuthoring')
  const hasContextPolicy = Object.prototype.hasOwnProperty.call(raw, 'contextPolicy')
  const r = p.record(raw, ['factPolicy', 'situationTemplates', 'openingSituationKeys', 'effectPlanTemplates', 'pressure', 'companionPolicy', 'stageClosurePolicy', 'dynamicEntityTemplates', 'runtimePolicy', ...(hasContextPolicy ? ['contextPolicy'] : [])], 'openAuthoring')
  const pressure = p.record(r.pressure, ['clocks', 'fronts'], 'openAuthoring.pressure')
  const result: TtrpgOpenAuthoringV1 = {
    ...(hasContextPolicy ? { contextPolicy: parseTtrpgOpenContextPolicyV1(r.contextPolicy) } : {}),
    factPolicy: p.list(r.factPolicy, 'factPolicy', (v, l) => {
      const a = p.record(v, ['fact', 'authorConfirmed'], l)
      return { fact: frozenFact(a.fact, l), authorConfirmed: p.bool(a.authorConfirmed, l) }
    }, 20_000),
    situationTemplates: p.list(r.situationTemplates, 'situationTemplates', situation),
    openingSituationKeys: p.keys(r.openingSituationKeys, 'openingSituationKeys', 5),
    effectPlanTemplates: p.list(r.effectPlanTemplates, 'effectPlanTemplates', effectTemplate),
    pressure: { clocks: p.list(pressure.clocks, 'clocks', clock, 256), fronts: p.list(pressure.fronts, 'fronts', front, 128) },
    companionPolicy: p.nullable(r.companionPolicy, companionPolicy, 'companionPolicy'),
    stageClosurePolicy: p.nullable(r.stageClosurePolicy, closurePolicy, 'stageClosurePolicy'),
    dynamicEntityTemplates: p.list(r.dynamicEntityTemplates, 'dynamicEntityTemplates', dynamicTemplate, 100),
    runtimePolicy: p.nullable(r.runtimePolicy, runtimePolicy, 'runtimePolicy'),
  }
  p.unique(result.factPolicy.map(f => f.fact.factKey), 'factPolicy')
  p.unique(result.situationTemplates.map(s => s.templateKey), 'situationTemplates')
  p.unique(result.effectPlanTemplates.map(s => s.planKey), 'effectPlanTemplates')
  p.unique(result.pressure.clocks.map(s => s.clockKey), 'clocks')
  p.unique(result.pressure.fronts.map(s => s.frontKey), 'fronts')
  p.unique(result.dynamicEntityTemplates.map(s => s.templateKey), 'dynamicEntityTemplates')
  for (const key of result.openingSituationKeys) p.known(key, result.situationTemplates.map(s => s.templateKey), 'openingSituationKeys')
  return result
}
