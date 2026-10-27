import { ttrpgOpenDeliveredCommonIdentitiesV1 } from './open-common-identity-contract'
import * as p from './open-contract-parse'
import { canonicalStringify } from '../agent/run/hash'
/** A citation is usable only when the exact retained KP resource was actually delivered. */
export function ttrpgOpenDeliveredKpSourceKeysV1(values: readonly unknown[]): string[] {
  const objects = values.filter((value): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value))
  const contracts = objects.filter(value => value.schema === 'storyforge.ttrpg-open-kp-contract')
  if (contracts.length !== 1) throw new Error('[ttrpg-kp] 缺少唯一实际交付引用合同')
  const contract = contracts[0]
  if (!Array.isArray(contract.allowedSourceKeys) || !contract.allowedSourceKeys.every(key => typeof key === 'string')) throw new Error('[ttrpg-kp] 引用合同格式非法')
  if (contract.version === 1) return [...contract.allowedSourceKeys]
  if (![2, 3].includes(contract.version as number) || contract.allowedSourceKeys.length !== 1 || contract.allowedSourceKeys[0] !== 'action.receipt') throw new Error('[ttrpg-kp] 未支持的引用合同')
  if (contract.version === 3) {
    const packets = objects.filter(value => value.schema === 'storyforge.ttrpg-open-kp-input')
    if (packets.length !== 1 || packets[0].version !== 3 || canonicalStringify(packets[0].binding) !== canonicalStringify(contract.binding)) p.fail('公开行动叙述缺少唯一准确交付输入')
    p.keys(packets[0].recipientActorKeys, 'actual KP recipients', 256, 1)
    const entries = packets[0].entries
    if (!Array.isArray(entries) || entries.length !== 1 || p.object(entries[0], 'actual KP receipt').sourceKey !== 'action.receipt') p.fail('公开行动叙述缺少准确实际结算')
  }
  const keys = new Set<string>(['action.receipt'])
  for (const value of objects) {
    if (value.schema !== 'storyforge.ttrpg-open-kp-delivered-entry' || value.version !== 1) continue
    const entry = value.entry
    if (!entry || typeof entry !== 'object' || !('sourceKey' in entry) || typeof entry.sourceKey !== 'string'
      || !/^(initial|knowledge|fact|signal)\.(0|[1-9]\d*)$/.test(entry.sourceKey)) throw new Error('[ttrpg-kp] 实际交付引用条目非法')
    keys.add(entry.sourceKey)
  }
  if (objects.some(value => value.schema === 'storyforge.ttrpg-open-common-identities-context' || value.schema === 'storyforge.ttrpg-open-common-identity')) {
    const packets = objects.filter(value => value.schema === 'storyforge.ttrpg-open-kp-input' && value.version === contract.version)
    if (packets.length !== 1) p.fail('共同身份缺少唯一准确结算接收者')
    const recipients = p.keys(packets[0].recipientActorKeys, 'actual KP recipients', 256, 1)
    for (const row of ttrpgOpenDeliveredCommonIdentitiesV1(objects, recipients)) keys.add(row.citationKey)
  }
  return [...keys]
}

/** V3 adds fields outside the immutable legacy context hash. Recheck their exact
 * delivered bytes at response recovery and adoption, without rehashing old calls. */
export function assertTtrpgOpenKpDeliveryCurrentV1(values: readonly unknown[], resources: readonly { value: unknown }[]) {
  ttrpgOpenDeliveredKpSourceKeysV1(values)
  const objects = values.filter((value): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value))
  if (objects.find(value => value.schema === 'storyforge.ttrpg-open-kp-contract')!.version !== 3) return
  for (const schema of ['storyforge.ttrpg-open-kp-contract', 'storyforge.ttrpg-open-kp-input']) {
    const original = objects.filter(value => value.schema === schema)
    const current = resources.map(row => row.value).filter(value => value !== null && typeof value === 'object' && 'schema' in value && value.schema === schema)
    if (original.length !== 1 || current.length !== 1 || canonicalStringify(original[0]) !== canonicalStringify(current[0])) p.fail('本次公开行动叙述输入已经变化，请保留原回答并重新读取进度')
  }
}
