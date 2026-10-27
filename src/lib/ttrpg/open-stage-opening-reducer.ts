/** Replay the same admission and per-human gates used by the explicit preview. */
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgOpenStageOpeningReceiptV1 } from './open-stage-opening-contract'
import { projectTtrpgOpenNextStageOpeningV1, evaluateTtrpgOpenNextStageOpeningV1 } from './open-stage-opening-plan'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { TTRPG_OPEN_GATE_KEYS } from './open-gates'
import * as p from './open-contract-parse'

export function applyTtrpgOpenStageOpeningEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type !== 'ttrpg.open.stage.opened') return false
  p.exact(payload, ['receipt', 'intent'], 'stage opening payload')
  const receipt = parseTtrpgOpenStageOpeningReceiptV1(payload.receipt), { plan, frozenContent } = receipt
  const intent = p.record(payload.intent, ['viewerKey', 'templateKeys', 'expectedPlanHash'], 'stage opening intent')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), auth = runtime?.authorization
  if (!runtime || !auth || event.actorKey !== 'gm' || event.targetKey !== null
    || plan.sessionKey !== runtime.sessionKey || event.commandId !== plan.commandId
    || event.baseSequence !== state.lastSequence || plan.basisSequence !== state.lastSequence
    || plan.plannedSourceRef.sequence !== event.sequence || plan.authorizationRevision !== auth.revision
    || intent.viewerKey !== plan.viewerKey || intent.expectedPlanHash !== plan.planHash
    || stable(intent.templateKeys) !== stable(plan.selected.map(s => s.templateKey))) p.fail('阶段开启必须来自当前真人确认的准确预览')
  const projected = projectTtrpgOpenNextStageOpeningV1({ state, content: frozenContent, runtimeSourceHash: plan.runtimeSourceHash,
    viewerKey: plan.viewerKey, commandId: plan.commandId, templateKeys: plan.selected.map(s => s.templateKey),
    openingKey: plan.openingKey, frozenContentHash: plan.frozenContentHash })
  if (plan.atWorldTurn !== runtime.openRun!.worldTime.worldTurn
    || stable(plan.previousClosureRef) !== stable(runtime.openRun!.stageClosures![runtime.openRun!.stageClosures!.length - 1].completedRef)
    || stable(projected.selected.map(({ definition: _, ...selection }) => selection)) !== stable(plan.selected.map(({ definitionHash: _, ...selection }) => selection))) p.fail('阶段开局不能改写原收束或局势来源')
  const checks = evaluateTtrpgOpenNextStageOpeningV1(projected.proposedState, frozenContent, plan.stageRevision, plan.gateBasisHash)
    .map(({ actorKey, viewerKey, evaluation }) => ({ actorKey, viewerKey, allApplicablePassed: evaluation.allApplicablePassed,
      checks: TTRPG_OPEN_GATE_KEYS.map(gateKey => ({ gateKey, applicable: evaluation.results[gateKey].applicability === 'applicable', passed: evaluation.results[gateKey].passed })) }))
  if (stable(checks) !== stable(plan.humanChecks.map(({ evaluationHash: _, ...check }) => check))) p.fail('新阶段必须重新通过当前全部真人的继续条件')
  const proposedRuntime = parseTtrpgRuntimeStateV2(projected.proposedState.ttrpg)!
  proposedRuntime.openRun!.stageOpenings = [...(runtime.openRun!.stageOpenings ?? []), receipt]
  state.ttrpg = proposedRuntime
  return true
}
