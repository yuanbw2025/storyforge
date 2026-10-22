/** Human-owned S3 rule proposals. No model permission, table or second rule engine. */
import type { TtrpgOpenEpochV1 } from './open-coordination'
import { parseTtrpgOpenRuleRequestV1,type TtrpgOpenRuleRequestV1 } from './open-rule-plan'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashProductProductionValueV2 } from '../product-production/hash'

export interface TtrpgOpenManualActionAuthorizationV1 { requestJson: string; requestHash: string }
export function parseTtrpgOpenManualRequestV1(manual: TtrpgOpenManualActionAuthorizationV1): TtrpgOpenRuleRequestV1 {
  const request = parseTtrpgOpenRuleRequestV1(JSON.parse(manual.requestJson))
  if (request.controllerMode !== 'human' || stable(request) !== manual.requestJson) throw new Error('[ttrpg-manual] 人工请求必须是规范化的本人规则选择')
  return request
}
export async function verifyTtrpgOpenManualAuthorizationV1(manual: TtrpgOpenManualActionAuthorizationV1) {
  const request = parseTtrpgOpenManualRequestV1(manual)
  if (await hashProductProductionValueV2(request) !== manual.requestHash) throw new Error('[ttrpg-manual] 已授权人工请求 hash 不一致')
  return request
}
export async function verifyTtrpgOpenManualEpochsV1(epochs: readonly TtrpgOpenEpochV1[]) {
  for (const epoch of epochs) if (epoch.manualAction) await verifyTtrpgOpenManualAuthorizationV1(epoch.manualAction)
}
export function assertTtrpgOpenManualRequestV1(epoch: TtrpgOpenEpochV1,request: TtrpgOpenRuleRequestV1) {
  if (epoch.manualAction && stable(request) !== epoch.manualAction.requestJson) throw new Error('[ttrpg-manual] 不能把已授权人工请求替换成其他行动')
}
