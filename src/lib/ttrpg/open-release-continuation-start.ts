/** Fresh Session Zero is the explicit opening authority for a continued release. */
import type { ProductRuntimeState, ProductRuntimeEvent } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenAuthorizationV1 } from './open-authorization'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { projectTtrpgOpenSelectedSituationsV1, evaluateTtrpgOpenNextStageOpeningV1 } from './open-stage-opening-plan'
import { parseTtrpgOpenSituationFrozenContentV1 } from './open-situation-runtime'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable, type ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { TTRPG_OPEN_GATE_KEYS } from './open-gates'
import * as p from './open-contract-parse'

function projectOpening(state: ProductRuntimeState, authorization: TtrpgOpenAuthorizationV1, content: TtrpgRuntimeContentV2, gateBasisHash: string) {
  const proposed = structuredClone(state), runtime = parseTtrpgRuntimeStateV2(proposed.ttrpg), receipt = runtime?.openRun?.releaseContinuation
  if (!runtime || !receipt || receipt.confirmedRef || receipt.plan.childSessionKey !== runtime.sessionKey
    || authorization.sourceRef.sessionKey !== runtime.sessionKey || authorization.sourceRef.sequence !== state.lastSequence + 1
    || stable(authorization.selectedActorKeys) !== stable(receipt.plan.selectedActorKeys)) p.fail('续团必须重新确认原队伍和当前开局，不能继承旧执行权')
  runtime.authorization = authorization
  runtime.product.sessionZero = { ...runtime.product.sessionZero, completed: true, selectedCharacterKeys: [...authorization.selectedActorKeys],
    completedBy: authorization.completedBySeatKey, completedAtSequence: authorization.sourceRef.sequence }
  runtime.openRun!.companions = runtime.openRun!.companions.filter(c => authorization.selectedActorKeys.includes(c.actorKey))
  proposed.ttrpg = runtime
  const projected = projectTtrpgOpenSelectedSituationsV1({ state: proposed, content, runtimeSourceHash: receipt.plan.targetRuntimeSourceHash,
    viewerKey: authorization.viewerKey, commandId: receipt.plan.transitionKey, templateKeys: receipt.plan.openingTemplateKeys,
    openingKey: receipt.plan.planHash, frozenContentHash: receipt.plan.targetContentHash })
  const checks = evaluateTtrpgOpenNextStageOpeningV1(projected.proposedState, content, `stage.opening.${receipt.plan.planHash}`, gateBasisHash)
    .map(({ actorKey, viewerKey, evaluation }) => ({ actorKey, viewerKey, gates: TTRPG_OPEN_GATE_KEYS.map(key => ({ key,
      applicable: evaluation.results[key].applicability === 'applicable', passed: evaluation.results[key].passed })) }))
  return { ...projected, checks }
}
export async function prepareTtrpgOpenContinuationStartV1(input: {
  state: ProductRuntimeState; authorization: TtrpgOpenAuthorizationV1; content: TtrpgRuntimeContentV2
}) {
  const receipt = parseTtrpgRuntimeStateV2(input.state.ttrpg)?.openRun?.releaseContinuation
  if (!receipt || await hash(input.content) !== receipt.plan.targetContentHash) p.fail('续团开局没有绑定目标发布内容')
  const gateBasisHash = await hash({ continuation: receipt.plan.planHash, state: input.state, authorization: input.authorization })
  const projected = projectOpening(input.state, input.authorization, input.content, gateBasisHash)
  const body = { schema: 'storyforge.ttrpg-open-release-opening' as const, version: 1 as const, planHash: receipt.plan.planHash,
    sourceRef: input.authorization.sourceRef, frozenContent: input.content, gateBasisHash, checks: projected.checks,
    openingStateHash: await hash(parseTtrpgRuntimeStateV2(projected.proposedState.ttrpg)!.openRun) }
  return { ...body, receiptHash: await hash(body) }
}
export function applyTtrpgOpenContinuationStartV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): void {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), receipt = runtime?.openRun?.releaseContinuation
  if (!receipt || !runtime?.authorization) p.fail('续团开局缺少当前新授权')
  const r = p.record(payload.continuationOpening, ['schema', 'version', 'planHash', 'sourceRef', 'frozenContent', 'gateBasisHash', 'checks', 'openingStateHash', 'receiptHash'], 'continued opening')
  p.literal(r.schema, 'storyforge.ttrpg-open-release-opening', 'continued opening schema'); p.literal(r.version, 1, 'continued opening version')
  const source = p.record(r.sourceRef, ['sessionKey', 'sequence'], 'continued opening source')
  if (r.planHash !== receipt.plan.planHash || source.sessionKey !== runtime.sessionKey || source.sequence !== event.sequence) p.fail('续团开局预览与当前事件不一致')
  p.hash(r.openingStateHash, 'continued opening state'); p.hash(r.receiptHash, 'continued opening hash')
  const projected = projectOpening(state, runtime.authorization, parseTtrpgOpenSituationFrozenContentV1(r.frozenContent), p.hash(r.gateBasisHash, 'continued opening basis'))
  if (stable(projected.checks) !== stable(r.checks)) p.fail('续团开局必须通过新席位的实际继续条件')
  const next = parseTtrpgRuntimeStateV2(projected.proposedState.ttrpg)!
  next.openRun!.releaseContinuation!.confirmedRef = { sessionKey: runtime.sessionKey, sequence: event.sequence }
  state.ttrpg = next
}
