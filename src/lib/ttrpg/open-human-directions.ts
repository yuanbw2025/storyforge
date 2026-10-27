/** Current human-visible directions only. Numbers belong to this projection;
 * frozen source references remain the durable identity. No author titles or clue text. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { ttrpgOpenSituationCatalogV1, ttrpgOpenSessionSituationActorAccessV1 } from './open-session-situation-catalog'
import { ttrpgOpenSituationGateContextV1 } from './open-situation-runtime'
import { evaluateTtrpgPredicateV1 } from './predicate'

export function listTtrpgOpenHumanDirectionsV1(input: {
  state: ProductRuntimeState; content: TtrpgRuntimeContentV2; runtime: TtrpgRuntimeStateV2; actorKey: string;
}) {
  const { state,content,runtime,actorKey } = input,run = runtime.openRun
  if (!run) return []
  const catalog = ttrpgOpenSituationCatalogV1(content.campaign,run)
  const context = ttrpgOpenSituationGateContextV1(state,content,actorKey)
  return run.situations.active.flatMap(instance => {
    if (!ttrpgOpenSessionSituationActorAccessV1(run,instance.templateKey,actorKey)) return []
    const template = catalog.byKey.get(instance.templateKey)
    return (template?.interventionPoints ?? []).filter(point =>
      (point.visibleTo === 'public' || point.visibleTo === 'party' || point.visibleTo === 'private' && point.knownByActorKeys.includes(actorKey))
      && (!point.requiresPredicate || evaluateTtrpgPredicateV1(point.requiresPredicate,context))
      && point.targetsObstacleKeys.some(key => !instance.satisfiedObstacleKeys.includes(key)))
      .map(point => ({ instance,template: template!,point,key: `${instance.situationKey}:${point.pointKey}` }))
  }).map((direction,index) => ({ ...direction,number: index + 1,label: `方向 ${index + 1}` }))
}
