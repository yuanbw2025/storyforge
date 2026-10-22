/** Pure narration identity; importing a runtime parser must never load context readers. */
import * as p from './open-contract-parse'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
export interface TtrpgOpenNarrationBindingV1 { operationKey: string; frozenPlanHash: string; ruleSourceRef: TtrpgOpenSourceRefV1; audience: 'party'; viewerKey: string }
export function parseTtrpgOpenNarrationBindingV1(value: unknown): TtrpgOpenNarrationBindingV1 {
  const n = p.record(value, ['operationKey', 'frozenPlanHash', 'ruleSourceRef', 'audience', 'viewerKey'], 'KP operation binding')
  return { operationKey: p.key(n.operationKey, 'KP operation'), frozenPlanHash: p.hash(n.frozenPlanHash, 'KP frozen plan'), ruleSourceRef: parseTtrpgOpenSourceRefV1(n.ruleSourceRef), audience: p.literal(n.audience, 'party', 'KP audience'), viewerKey: p.key(n.viewerKey, 'KP actual requester') }
}
