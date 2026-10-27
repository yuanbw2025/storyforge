import { ttrpgOpenContinuationTaskInterruptedV1 } from './open-release-continuation-proof'
/** Explicit next-stage preparation from the current frozen release.
 * Pure preparation only. A formal command must rebuild against verified current
 * source/state and commit a real opening event. This is never execution authority.
 */
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgRuntimeStateV2, type TtrpgOpenSituationRuntimeStateV1 } from './open-runtime-contract'
import { parseTtrpgOpenSituationFrozenContentV1, admitTtrpgOpenSituationV1, settleTtrpgOpenSituationQueueV1,
  ttrpgOpenSituationGateContextV1, ttrpgOpenSituationProjectionActorV1 } from './open-situation-runtime'
import { ttrpgOpenSituationCatalogV1 } from './open-session-situation-catalog'
import { assertTtrpgSituationInstanceGatesV1 } from './situation-engine'
import { assertTtrpgOpenPressureGmV1 } from './open-pressure-cycle'
import { ttrpgOpenCallBudgetV1 } from './open-model-calls'
import { ttrpgOpenGateHumanActorsV1, evaluateTtrpgOpenNextStagePlayerGatesV1 } from './open-terminal-gates'
import { TTRPG_OPEN_GATE_KEYS } from './open-gates'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import * as p from './open-contract-parse'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'

export type SelectedOpening = {
  templateKey: string; definitionHash: string; instanceKey: string
  transition: 'activated' | 'continued' | 'promoted'
  origin: { kind: 'frozen-campaign' | 'adopted-session'; proofHash: string; sourceRef: TtrpgOpenSourceRefV1 | null }
}
type HumanOpeningCheck = {
  actorKey: string; viewerKey: string; evaluationHash: string; allApplicablePassed: boolean
  checks: Array<{ gateKey: typeof TTRPG_OPEN_GATE_KEYS[number]; applicable: boolean; passed: boolean | null }>
}
export interface TtrpgOpenNextStagePlanV1 {
  schema: 'storyforge.ttrpg-open-next-stage-plan'; version: 1
  commandId: string; sessionKey: string; viewerKey: string; authorizationRevision: number
  basisSequence: number; basisStateHash: string
  runtimeSourceHash: string; frozenContentHash: string
  previousClosureRef: TtrpgOpenSourceRefV1
  plannedSourceRef: TtrpgOpenSourceRefV1
  atWorldTurn: number; openingKey: string; stageRevision: string
  selected: SelectedOpening[]
  humanChecks: HumanOpeningCheck[]; gateBasisHash: string
  stateWithoutOpeningReceiptHash: string
  planHash: string
}

export type TtrpgOpenNextStageInputV1 = {
  state: ProductRuntimeState; content: TtrpgRuntimeContentV2; runtimeSourceHash: string
  viewerKey: string; commandId: string; templateKeys: readonly string[]
}
function nextStageBasis(input: TtrpgOpenNextStageInputV1) {
  const state = structuredClone(input.state)
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg) ?? p.fail('下一阶段需要开放跑团状态')
  state.ttrpg = runtime
  const run = runtime.openRun ?? p.fail('开放跑团尚未开始')
  const auth = runtime.authorization ?? p.fail('下一阶段需要真实开团授权')
  const viewerKey = p.key(input.viewerKey, 'next stage viewer')
  const commandId = p.key(input.commandId, 'next stage command')
  const seat = assertTtrpgOpenPressureGmV1(auth, viewerKey)
  const content = parseTtrpgOpenSituationFrozenContentV1(input.content)
  const runtimeSourceHash = p.hash(input.runtimeSourceHash, 'next stage source')
  const templateKeys = p.keys(input.templateKeys, 'next opening templates', 20, 1)
  if (new Set(templateKeys).size !== templateKeys.length) p.fail('开局素材不能重复选择')
  const previous = run.stageClosures?.[run.stageClosures.length - 1], previousClosureRef = previous?.completedRef
  if (!runtime.product.sessionZero.completed || runtime.product.safety.status !== 'active'
    || run.stage.status !== 'closed' || !previous || !previousClosureRef
    || run.stage.closedAtWorldTurn !== previous.atWorldTurn || previous.atWorldTurn !== run.worldTime.worldTurn
    || previous.ticks.some(t => !t.completedRef) || previous.work.some(w => !w.completedRef)
    || run.operations.some(o => o.status === 'executing' || o.status === 'awaiting-approval')
    || runtime.branchLineage?.recoveryTasks.some(t => t.status !== 'completed' && !ttrpgOpenContinuationTaskInterruptedV1(runtime, t.taskKey))) {
    p.fail('请先完成真实阶段收束和原结算；未完成行动或仅解析到放弃状态不能开启下一阶段')
  }
  if (run.coordination.activeEpochKey !== null || run.coordination.epochs.some(e => e.status === 'active'
    || ttrpgOpenCallBudgetV1(e, run.coordination.calls).pending
    || ttrpgOpenCallBudgetV1(e, run.coordination.calls).blockedByUnknown)) {
    p.fail('请先核对当前授权窗口和待处理或结果未知的游戏请求')
  }
  if (content.campaign.stageClosurePolicy.continuation !== 'author-confirmed-opening'
    || run.worldTime.worldTurn >= content.campaign.stageClosurePolicy.maximumWorldTurns
    || runtime.product.rulePackContentHash !== content.rulePack.contentHash
    || runtime.product.campaignKey !== content.campaign.campaignKey
    || previous.runtimeSourceHash !== runtimeSourceHash
    || stable(previous.frozenContent) !== stable(content)) {
    p.fail('下一阶段必须沿当前冻结来源和原单局上限，不能借交接替换规则或重置轮次')
  }
  return { state, runtime, run, auth, seat, viewerKey, commandId, content, runtimeSourceHash, templateKeys, previousClosureRef }
}

export function projectTtrpgOpenNextStageOpeningV1(input: TtrpgOpenNextStageInputV1 & { openingKey: string; frozenContentHash: string }) {
  const { state, content } = nextStageBasis(input)
  return projectTtrpgOpenSelectedSituationsV1({ ...input, state, content })
}

/** Shared deterministic admission only. Each caller owns its lifecycle boundary. */
export function projectTtrpgOpenSelectedSituationsV1(input: TtrpgOpenNextStageInputV1 & { openingKey: string; frozenContentHash: string }) {
  const state = structuredClone(input.state), runtime = parseTtrpgRuntimeStateV2(state.ttrpg) ?? p.fail('开局需要开放跑团状态')
  state.ttrpg = runtime
  const run = runtime.openRun ?? p.fail('开局需要已有运行状态')
  const seat = assertTtrpgOpenPressureGmV1(runtime.authorization ?? p.fail('开局需要真人授权'), input.viewerKey)
  const content = parseTtrpgOpenSituationFrozenContentV1(input.content)
  const templateKeys = p.keys(input.templateKeys, 'opening templates', 20, 1)
  if (new Set(templateKeys).size !== templateKeys.length) p.fail('开局素材不能重复选择')
  const openingKey = p.hash(input.openingKey, 'stage opening key')
  const frozenContentHash = p.hash(input.frozenContentHash, 'stage frozen content')
  const plannedSourceRef = { sessionKey: runtime.sessionKey, sequence: input.state.lastSequence + 1 }
  let proposed = structuredClone(state)
  const proposedRuntime = parseTtrpgRuntimeStateV2(proposed.ttrpg)!
  proposedRuntime.openRun!.stage = { status: 'open', openedAtWorldTurn: run.worldTime.worldTurn, closedAtWorldTurn: null }
  proposed.ttrpg = proposedRuntime
  const selected: Array<Omit<SelectedOpening, 'definitionHash'> & { definition: typeof content.campaign.situationTemplates[number] }> = []
  const actorKey = ttrpgOpenSituationProjectionActorV1(runtime, seat.actorKey)
  for (const templateKey of templateKeys) {
    const current = parseTtrpgRuntimeStateV2(proposed.ttrpg)!, currentRun = current.openRun!
    const catalog = ttrpgOpenSituationCatalogV1(content.campaign, currentRun)
    const template = catalog.templates.find(t => t.templateKey === templateKey) ?? p.fail('开局不属于当前已确认局势目录')
    const prior = currentRun.situations.active.find(i => i.templateKey === templateKey)
    if (prior) {
      // The ordinary admission helper returns existing instances early. A new
      // opening must revalidate rather than infer validity from that shortcut.
      assertTtrpgSituationInstanceGatesV1({ template,
        predicateContext: ttrpgOpenSituationGateContextV1(proposed, content, actorKey), actorKey,
        activeInstances: currentRun.situations.active.filter(i => i.situationKey !== prior.situationKey),
        cooldownUntilWorldTurn: currentRun.situations.cooldowns, worldTurn: currentRun.worldTime.worldTurn,
        templateContext: catalog.validationView, rulePack: content.rulePack.content })
    }
    const queued = currentRun.situations.queued.find(i => i.templateKey === templateKey)
    let instance: TtrpgOpenSituationRuntimeStateV1, transition: SelectedOpening['transition']
    if (queued) {
      const first = [...currentRun.situations.queued].sort((a, b) => a.queuePosition! - b.queuePosition!)[0]
      if (first.situationKey !== queued.situationKey) p.fail('请先处理排在前面的待激活局势')
      const promoted = settleTtrpgOpenSituationQueueV1({ state: proposed, content, actorKey, situationKey: queued.situationKey, sequence: plannedSourceRef.sequence })
      if (promoted.result.transition !== 'activated' || !promoted.result.instance) p.fail('待激活局势尚未实际可用；排队、冷却或容量冲突不能算作已经开始')
      proposed = promoted.state; instance = promoted.result.instance; transition = 'promoted'
    } else {
      const admitted = admitTtrpgOpenSituationV1({ state: proposed, content, templateKey, actorKey,
        sequence: plannedSourceRef.sequence, instanceKey: `stage-situation.${openingKey}.${selected.length}`, activationReason: 'opening' })
      if (!admitted.result.instance || admitted.result.instance.status !== 'active' || !['activated', 'existing'].includes(admitted.result.transition)) {
        p.fail('新开局需要实际可用的局势；排队、冷却或容量冲突不能算作已经开始')
      }
      proposed = admitted.state; instance = admitted.result.instance
      transition = admitted.result.transition === 'activated' ? 'activated' : 'continued'
    }
    const origin = currentRun.situationReceipts?.find(r => r.template.templateKey === templateKey)
    selected.push({ templateKey, definition: template, instanceKey: instance.situationKey,
      transition,
      origin: { kind: origin ? 'adopted-session' : 'frozen-campaign', proofHash: origin?.receiptHash ?? frozenContentHash,
        sourceRef: origin ? structuredClone(origin.sourceRef) : null } })
  }
  proposed.lastSequence = plannedSourceRef.sequence
  return { proposedState: proposed, selected }
}

export function evaluateTtrpgOpenNextStageOpeningV1(proposed: ProductRuntimeState, content: TtrpgRuntimeContentV2, stageRevision: string, gateBasisHash: string) {
  const evaluations: Array<{ actorKey: string; viewerKey: string; evaluation: ReturnType<typeof evaluateTtrpgOpenNextStagePlayerGatesV1> }> = []
  if (!ttrpgOpenGateHumanActorsV1(parseTtrpgRuntimeStateV2(proposed.ttrpg)!).length) p.fail('下一阶段需要已认领的真人玩家角色')
  for (const human of ttrpgOpenGateHumanActorsV1(parseTtrpgRuntimeStateV2(proposed.ttrpg)!)) {
    const evaluation = evaluateTtrpgOpenNextStagePlayerGatesV1({ state: proposed, content, actorKey: human.actorKey,
      viewerKey: human.viewerKey, basisHash: gateBasisHash, openingRevision: stageRevision })
    if (!evaluation.allApplicablePassed || evaluation.results['exit-exists'].passed !== true
      || evaluation.results['hypothesis-formable'].passed !== true) p.fail('拟开局尚未满足所有当前真人角色的可继续条件')
    evaluations.push({ ...human, evaluation })
  }
  return evaluations
}

export async function prepareTtrpgOpenNextStagePlanV1(input: TtrpgOpenNextStageInputV1): Promise<{ plan: TtrpgOpenNextStagePlanV1; proposedState: ProductRuntimeState }> {
  const { runtime, run, auth, viewerKey, commandId, content, runtimeSourceHash, templateKeys, previousClosureRef } = nextStageBasis(input)
  const basisSequence = p.integer(input.state.lastSequence, 'opening basis sequence', 0, Number.MAX_SAFE_INTEGER - 1)
  const basisStateHash = await hash(input.state), frozenContentHash = await hash(content)
  const plannedSourceRef = { sessionKey: runtime.sessionKey, sequence: basisSequence + 1 }
  const openingKey = await hash({ commandId, sessionKey: runtime.sessionKey, viewerKey, authorizationRevision: auth.revision,
    basisSequence, basisStateHash, runtimeSourceHash, frozenContentHash, previousClosureRef, templateKeys })
  const stageRevision = `stage.opening.${openingKey}`
  const { proposedState: proposed, selected: projected } = projectTtrpgOpenNextStageOpeningV1({ ...input, openingKey, frozenContentHash })
  const selected: SelectedOpening[] = await Promise.all(projected.map(async ({ definition, ...selection }) => ({ ...selection, definitionHash: await hash(definition) })))
  const gateBasisHash = await hash({ state: proposed, stageRevision })
  const humanChecks: HumanOpeningCheck[] = await Promise.all(evaluateTtrpgOpenNextStageOpeningV1(proposed, content, stageRevision, gateBasisHash).map(async ({ actorKey, viewerKey, evaluation }) => ({ actorKey, viewerKey, evaluationHash: await hash(evaluation), allApplicablePassed: evaluation.allApplicablePassed, checks: TTRPG_OPEN_GATE_KEYS.map(gateKey => ({ gateKey, applicable: evaluation.results[gateKey].applicability === 'applicable', passed: evaluation.results[gateKey].passed })) })))
  const body = { schema: 'storyforge.ttrpg-open-next-stage-plan' as const, version: 1 as const,
    commandId, sessionKey: runtime.sessionKey, viewerKey, authorizationRevision: auth.revision,
    basisSequence, basisStateHash, runtimeSourceHash, frozenContentHash,
    previousClosureRef: structuredClone(previousClosureRef), plannedSourceRef, atWorldTurn: run.worldTime.worldTurn,
    openingKey, stageRevision, selected, humanChecks, gateBasisHash, stateWithoutOpeningReceiptHash: await hash(proposed) }
  return { plan: { ...body, planHash: await hash(body) }, proposedState: proposed }
}
