import { ttrpgOpenEntityParameterAllowedV1 } from './open-entity-catalog'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
/** One deterministic parameter/affected-player validator for action and discovery plans. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgOpenEffectPlanTemplateV1 } from './open-contract'
import type { TtrpgOpenAuthorizationV1 } from './open-authorization'
import * as p from './open-contract-parse'

export function validateTtrpgOpenEffectBindingsV1(input: {
  state: ProductRuntimeState; templates: readonly TtrpgOpenEffectPlanTemplateV1[];
  bindings: Record<string, Record<string, string | null>>; authorization: TtrpgOpenAuthorizationV1;
  readableBinding: (ref: string) => boolean;
}): string[] {
  if (Object.keys(input.bindings).sort().join(',') !== input.templates.map(template => template.planKey).sort().join(',')) p.fail('后果参数必须覆盖所有冻结后果模板')
  const affected = new Set<string>()
  for (const template of input.templates) {
    const bindings = input.bindings[template.planKey]
    if (Object.keys(bindings).sort().join(',') !== template.parameters.map(parameter => parameter.parameterKey).sort().join(',')) p.fail('后果参数槽不精确')
    for (const parameter of template.parameters) {
      const ref = bindings[parameter.parameterKey]
      if (ref === null) { if (parameter.required) p.fail('缺少必需后果参数'); continue }
      const entity = input.state.entities[ref]
      const kind = entity?.kind === 'item' ? 'item' : entity?.kind === 'location' ? 'location' : entity ? 'actor' : null
      if (!entity || !kind || !input.readableBinding(ref) || entity.lifecycleStatus !== 'active'
        || (entity.kind === 'player' && !input.authorization.selectedActorKeys.includes(entity.entityKey)) || !parameter.entityKinds.includes(kind)
        || (!parameter.allowedRefs.includes(ref) && !ttrpgOpenEntityParameterAllowedV1(parseTtrpgRuntimeStateV2(input.state.ttrpg)?.openRun, ref, parameter.allowDynamicFromTemplateKeys))) p.fail('后果绑定不属于冻结允许范围')
    }
    for (const primitive of [...template.effects, ...template.alternatives.flatMap(alternative => alternative.effects)]) {
      const ref = primitive.targetRef.startsWith('parameter:') ? bindings[primitive.targetRef.slice(10)] : primitive.targetRef
      if (ref && input.state.entities[ref]?.kind === 'player') affected.add(ref)
    }
  }
  return [...affected]
}
