import { ttrpgOpenEntityIdentityCatalogV1, ttrpgOpenEntityReferenceVisibleV1, ttrpgOpenEntityParameterAllowedV1 } from './open-entity-catalog'
import { ttrpgOpenSituationCatalogV1, ttrpgOpenSessionSituationActorAccessV1 } from './open-session-situation-catalog'
/** Human projection of the existing frozen rules. No hidden clue text or GM templates. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import type { TtrpgOpenEffectPlanTemplateV1 } from './open-contract'
import type { loadTtrpgOpenHumanViewV1 } from './open-player-context'
import { ttrpgOpenPredicateContextV1 } from './open-rule-plan'
import { evaluateTtrpgPredicateV1 } from './predicate'
type HumanView = Awaited<ReturnType<typeof loadTtrpgOpenHumanViewV1>>['view']
export function buildTtrpgOpenManualCatalogV1(input: {
  state: ProductRuntimeState; content: TtrpgRuntimeContentV2; runtime: TtrpgRuntimeStateV2; view: HumanView; actorKey: string;
}) {
  const { state,content,runtime,view,actorKey } = input,location = state.entities[actorKey].locationKey
  const entityCatalog = ttrpgOpenEntityIdentityCatalogV1(content, runtime.openRun?.entityOperations ?? [])
  const known = (ref: string) => ref === actorKey || entityCatalog.some(b => b.entityKey === ref
    && ttrpgOpenEntityReferenceVisibleV1(b.audience, b.recipientActorKeys, actorKey, false, b.dynamic))
  const entities = Object.values(state.entities).filter(e => known(e.entityKey) && e.lifecycleStatus === 'active')
  const targets = entities.filter(e => e.entityKey === actorKey || (e.kind === 'location' ? e.entityKey === location : e.locationKey === location))
    .map(e => ({ key: e.entityKey,name: e.name,kind: e.kind === 'location' ? 'location' as const : e.kind === 'item' ? 'item' as const : e.entityKey === actorKey ? 'self' as const : 'actor' as const }))
  const parameters = (templates: TtrpgOpenEffectPlanTemplateV1[]) => templates.flatMap(t => t.parameters.map(p => ({
    key: JSON.stringify([t.planKey,p.parameterKey]),templateKey: t.planKey,parameterKey: p.parameterKey,required: p.required,
    options: entities.filter(e => {
      const kind = e.kind === 'location' ? 'location' : e.kind === 'item' ? 'item' : 'actor'
      return p.entityKinds.includes(kind) && (p.allowedRefs.includes(e.entityKey) || ttrpgOpenEntityParameterAllowedV1(runtime.openRun, e.entityKey, p.allowDynamicFromTemplateKeys))
    }).map(e => ({ key: e.entityKey,name: e.name })),
  })))
  const rules = view.rules.actions.flatMap(action => {
    const base = { route: 'existing-action' as 'existing-action' | 'generic-check',ruleKey: action.actionKey,label: action.name,
    available: view.rules.core.actionCatalog.some(a => a.actionKey === action.actionKey && a.available),
    targets: action.target === 'scene' ? [{ key: null as string | null,name: '当前地点' }] : targets.filter(t => action.target === 'self' ? t.key === actorKey : t.kind === 'actor').map(t => ({ key: t.key as string | null,name: t.name })),
    interactionKey: undefined as string | undefined,templateKeys: [] as string[],parameters: parameters([]),timeCostWorldTurns: action.timeCostWorldTurns,
    }
    const bindings = content.rulePack.content.interactionBindings?.filter(b => b.actionKey === action.actionKey) ?? []
    return bindings.length ? bindings.map(binding => {
      const templates = binding.effectPlanRef ? [content.campaign.effectPlanTemplates.find(t => t.planKey === binding.effectPlanRef)!] : []
      return { ...base,interactionKey: binding.interactionKey,label: binding.title,timeCostWorldTurns: binding.timeCostWorldTurns,
        templateKeys: templates.map(t => t.planKey),parameters: parameters(templates),available: base.available && binding.preconditions.every(p => evaluateTtrpgPredicateV1(p,ttrpgOpenPredicateContextV1(state,content))) }
    }) : [base]
  })
  for (const check of view.rules.genericChecks) {
    const definition = content.rulePack.content.genericChecks.find(c => c.checkKey === check.checkKey)!
    const templates = [...new Set(Object.values(definition.effectPlanByDegree).filter((key): key is string => key !== null))].map(key => content.campaign.effectPlanTemplates.find(t => t.planKey === key)!)
    rules.push({ interactionKey: undefined,route: 'generic-check',ruleKey: check.checkKey,label: check.title,available: true,
      targets: targets.filter(t => check.targetKinds.includes(t.kind)).map(t => ({ key: t.key,name: t.name })),templateKeys: templates.map(t => t.planKey),parameters: parameters(templates),timeCostWorldTurns: check.timeCostWorldTurns })
  }
  const context = ttrpgOpenPredicateContextV1(state,content)
  const discoveries = runtime.openRun!.situations.active.flatMap(instance => {
    if (!ttrpgOpenSessionSituationActorAccessV1(runtime.openRun, instance.templateKey, actorKey)) return []
    const template = ttrpgOpenSituationCatalogV1(content.campaign, runtime.openRun).templates.find(t => t.templateKey === instance.templateKey)!
    return template.interventionPoints.filter(point => (point.visibleTo === 'public' || point.visibleTo === 'party' || point.visibleTo === 'private' && point.knownByActorKeys.includes(actorKey))
      && (!point.requiresPredicate || evaluateTtrpgPredicateV1(point.requiresPredicate,context)) && point.targetsObstacleKeys.some(key => !instance.satisfiedObstacleKeys.includes(key)))
      .flatMap(point => template.evidence.flatMap(evidence => evidence.discoveryPolicy.paths.filter(path => path.interventionPointKey === point.pointKey).flatMap(path => {
        const route = path.kind === 'action' ? 'existing-action' as const : 'generic-check' as const
        if (!rules.some(r => r.route === route && r.ruleKey === path.key) || route === 'existing-action' && !point.suggestedActionKeys.includes(path.key)) return []
        const plans = [...new Set([evidence.discoveryPolicy.costEffectPlanRef,evidence.discoveryPolicy.failForwardEffectPlanRef].filter((key): key is string => key !== null))].map(key => content.campaign.effectPlanTemplates.find(t => t.planKey === key)!)
        return [{ key: JSON.stringify([instance.situationKey,point.pointKey,evidence.clueRef,route,path.key]),label: point.affordanceHint,
          route,ruleKey: path.key,situationKey: instance.situationKey,interventionPointKey: point.pointKey,evidenceRef: evidence.clueRef,templateKeys: plans.map(t => t.planKey),parameters: parameters(plans) }]
      })))
  })
  return { actorKey,rules,discoveries }
}
