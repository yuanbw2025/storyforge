/** Closed, name-only common knowledge. Inputs must be actual full Gateway reads. */
import * as p from './open-contract-parse'

export function ttrpgOpenDeliveredCommonIdentitiesV1(values: readonly unknown[], recipients: readonly string[]) {
  const objects = values.map(value => p.object(value, 'delivered common identity resource'))
  const contracts = objects.filter(value => value.schema === 'storyforge.ttrpg-open-common-identities-context')
  const entries = objects.filter(value => value.schema === 'storyforge.ttrpg-open-common-identity')
  if (!contracts.length && !entries.length) return []
  if (contracts.length !== 1) p.fail('共同身份缺少唯一实际交付合同')
  const contract = p.record(contracts[0], ['schema', 'version', 'recipientActorKeys', 'semanticIdentitiesOnly', 'originalNames',
    'receiptSelection', 'reliabilityAggregation', 'hearsayIsNotFirsthand', 'grantsNoTargetOrResourcePermission',
    'locationEquipmentAndCurrentStateExcluded', 'grantsNoEvidenceGate', 'citationsOnlyFromDeliveredResources'], 'common identity contract')
  if (contract.version !== 1 || contract.receiptSelection !== 'strongest-reliability-then-latest'
    || contract.reliabilityAggregation !== 'weakest-of-current-recipients'
    || ['semanticIdentitiesOnly', 'originalNames', 'hearsayIsNotFirsthand', 'grantsNoTargetOrResourcePermission',
      'locationEquipmentAndCurrentStateExcluded', 'grantsNoEvidenceGate', 'citationsOnlyFromDeliveredResources'].some(key => contract[key] !== true)) p.fail('共同身份合同版本或权限非法')
  const current = [...recipients].sort(), audience = p.keys(contract.recipientActorKeys, 'common identity recipients', 256, 1).sort()
  if (current.join(',') !== audience.join(',')) p.fail('共同身份未覆盖当前全部实际队员')
  const rows = entries.map(value => {
    const r = p.record(value, ['schema', 'version', 'citationKey', 'entityRef', 'kind', 'name', 'reliability'], 'common identity entry')
    const entityRef = p.key(r.entityRef, 'common identity original key'), citationKey = p.text(r.citationKey, 'common identity citation', 512)
    if (r.version !== 1 || citationKey !== `identity.${entityRef}`) p.fail('共同身份版本或引用身份非法')
    return { citationKey, entityRef, kind: p.oneOf(r.kind, ['actor', 'location', 'item'], 'common identity kind'), name: p.text(r.name, 'common identity original name', 1000),
      reliability: p.oneOf(r.reliability, ['observed', 'hearsay', 'belief'], 'common identity original grade') }
  })
  p.unique(rows.map(row => row.citationKey), 'delivered common identities')
  return rows
}
