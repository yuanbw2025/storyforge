/** Read-only identities from frozen bindings and actual committed entity operations. */
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenAudience, TtrpgOpenDynamicEntityTemplateV1 } from './open-contract'
import { parseTtrpgOpenEntityOperationV1, type TtrpgOpenEntityOperationV1 } from './open-entity-contract'
import { ttrpgOpenEntityEquipmentV1, ttrpgOpenEntityEquipmentKeyV1 } from './open-entity-mechanics'
import * as p from './open-contract-parse'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'

export interface TtrpgOpenRuntimeEntityIdentityV1 {
  entityKey: string; kind: 'actor' | 'location' | 'item'; templateKey: string; dynamicTemplateKey: string | null;
  audience: TtrpgOpenAudience; recipientActorKeys: string[]; dynamic: boolean; sourceRef: TtrpgOpenSourceRefV1 | null;
}

/** Party grants are frozen to actual recipients; public requires both original authorities to be public. */
export function ttrpgOpenEntityDisclosureV1(template: Pick<TtrpgOpenDynamicEntityTemplateV1, 'audience' | 'knownByActorKeys'>,
  oracleAudience: 'gm-only' | 'party' | 'public', selectedActorKeys: string[]) {
  if (template.audience === 'gm-only' || oracleAudience === 'gm-only') return { audience: 'gm-only' as const, recipientActorKeys: [] }
  const recipients = template.audience === 'private' || template.knownByActorKeys.length ? template.knownByActorKeys.filter(key => selectedActorKeys.includes(key)) : [...selectedActorKeys]
  if (!recipients.length) p.fail('实体模板没有当前获授权接收者')
  const audience = template.audience === 'public' && oracleAudience === 'public' ? 'public' as const : template.audience === 'private' ? 'private' as const : 'party' as const
  return { audience, recipientActorKeys: [...recipients].sort() }
}
export function ttrpgOpenEntityIdentityCatalogV1(content: TtrpgRuntimeContentV2, operations: readonly TtrpgOpenEntityOperationV1[]) {
  const entries: TtrpgOpenRuntimeEntityIdentityV1[] = content.campaign.entityBindings.map(binding => ({ entityKey: binding.bindingKey, kind: binding.kind,
    templateKey: binding.templateKey, dynamicTemplateKey: null, audience: binding.audience, recipientActorKeys: binding.knownByActorKeys, dynamic: false, sourceRef: null }))
  for (const raw of operations) {
    const operation = parseTtrpgOpenEntityOperationV1(raw)
    if (operation.resolution?.kind !== 'materialized') continue
    for (const item of operation.plan.items) {
      const template = content.campaign.dynamicEntityTemplates.find(row => row.templateKey === item.proposal.templateKey) ?? p.fail('已创建实体缺少原冻结模板')
      entries.push({ entityKey: item.entityKey, kind: item.kind, templateKey: item.kind === 'actor' ? template.characterTemplateKey! : item.kind === 'item' ? template.itemDefinitionKey! : template.templateKey,
        dynamicTemplateKey: template.templateKey, audience: item.audience, recipientActorKeys: item.recipientActorKeys, dynamic: true, sourceRef: operation.resolution.sourceRef })
      for (const [index, definitionRef] of ttrpgOpenEntityEquipmentV1(content, item.proposal).entries()) entries.push({
        entityKey: ttrpgOpenEntityEquipmentKeyV1(item.entityKey, index), kind: 'item', templateKey: definitionRef, dynamicTemplateKey: null,
        // An observed NPC is not evidence that its private inventory was observed.
        audience: 'gm-only', recipientActorKeys: [], dynamic: true, sourceRef: operation.resolution.sourceRef })
    }
  }
  p.unique(entries.map(row => row.entityKey), 'runtime entity identities')
  return entries
}
/** Mutable entity attributes cannot grant a frozen dynamic-template capability. */
export function ttrpgOpenEntityParameterAllowedV1(run: { entityOperations?: readonly TtrpgOpenEntityOperationV1[] } | null | undefined, ref: string, allowedTemplateKeys: readonly string[]) {
  return run?.entityOperations?.some(row => row.resolution?.kind === 'materialized'
    && row.plan.items.some(item => item.entityKey === ref && allowedTemplateKeys.includes(item.proposal.templateKey))) ?? false
}
export function ttrpgOpenEntityReferenceVisibleV1(audience: TtrpgOpenAudience, recipients: readonly string[], actorKey: string | null, humanGm: boolean, dynamic: boolean) {
  return humanGm || audience === 'public' || actorKey !== null && (audience === 'private' || audience === 'party' && (dynamic || recipients.length > 0) ? recipients.includes(actorKey) : audience === 'party')
}
