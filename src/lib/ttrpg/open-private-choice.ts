/** Deterministic disclosure of necessary costs, never the private roll/degree or GM prose. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import type { TtrpgOpenOperationV1 } from './open-operation'
import type { TtrpgOpenPrivateChoiceBodyV1 } from './open-private-choice-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { ttrpgOpenDiscoveryEffectTemplatesV1 } from './open-discovery-effect-templates'
import { describeTtrpgOpenHumanEffectV1 } from './open-table-risk'
import { projectTtrpgOpenMechanicalBasisV1 } from './open-rule-plan'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashProductProductionValueV2 } from '../product-production/hash'

/** Async hash work stays in read/command owners, outside the pure reducer. */
export async function verifyTtrpgOpenPrivateChoiceHashesV1(operations: readonly TtrpgOpenOperationV1[]) {
  for (const op of operations) for (const row of op.privateChoiceDisclosures ?? []) {
    if (await hashProductProductionValueV2({ viewerKey: row.viewerKey,body: row.body }) !== row.reviewHash) throw new Error('[ttrpg-private-choice] 已保存告知的 hash 不一致')
  }
}

export function buildTtrpgOpenPrivateChoiceBodyV1(input: {
  state: ProductRuntimeState; runtime: TtrpgRuntimeStateV2; operation: TtrpgOpenOperationV1
  kind: 'effect' | 'knowledge'; templateKey: string
}): TtrpgOpenPrivateChoiceBodyV1 {
  const { state,runtime,operation: op,kind,templateKey } = input,run = runtime.openRun!
  if (!runtime.authorization || !run || op.status !== 'executing' || op.plan.rollVisibility === 'public'
    || nextTtrpgOpenOperationStepV1(op)?.kind !== kind || runtime.product.safety.status !== 'active'
    || run.coordination.activeEpochKey !== op.authorizationEpochKey) throw new Error('[ttrpg-private-choice] 尚未到当前保密后果选择步骤')
  const receipt = run.ruleReceipts.find(r => r.operationKey === op.operationKey && r.frozenPlanHash === op.planHash)
  if (!receipt) throw new Error('[ttrpg-private-choice] 缺少实际裁定回执')
  const template = kind === 'effect'
    ? op.pendingChoice?.templateKey === templateKey && op.pendingChoice.selectedAlternativeKey === null ? op.plan.effectTemplates.find(t => t.planKey === templateKey) : null
    : !op.discoveryChoices?.some(c => c.templateKey === templateKey) ? ttrpgOpenDiscoveryEffectTemplatesV1(op,receipt).find(t => t.planKey === templateKey) : null
  if (!template?.alternatives.length) throw new Error('[ttrpg-private-choice] 不是真实未选择的保密后果')
  const actorKey = op.plan.request.actorKey,content = op.plan.discoveryPlan?.frozenContent
  const name = (ref: string | null) => {
    if (!ref) return null
    const known = ref === actorKey || ref === state.entities[actorKey]?.locationKey || runtime.authorization!.selectedActorKeys.includes(ref)
      || content?.campaign.entityBindings.some(b => b.bindingKey === ref && (b.audience === 'party' || b.audience === 'public' || b.audience === 'private' && b.knownByActorKeys.includes(actorKey)))
    return known ? state.entities[ref]?.name ?? null : null
  }
  const bindings = kind === 'effect' ? op.plan.request.effectBindings[templateKey] : op.plan.discoveryPlan!.request.effectBindings[templateKey]
  const alternatives = template.alternatives.map((alternative,index) => {
    const effects = alternative.effects.map(effect => describeTtrpgOpenHumanEffectV1({ state,rules: op.plan.rulePack,actorKey,effect,bindings,name }))
    if (effects.some(e => !e.reviewable)) throw new Error('[ttrpg-private-choice] 还有不能向玩家完整展示的后果，不能盲目确认')
    return { alternativeKey: alternative.alternativeKey,title: `选项 ${index + 1}`,lines: effects.map(e => e.text) }
  })
  return { kind,templateKey,actorKey,authorizationEpochKey: op.authorizationEpochKey,planHash: op.planHash,riskHash: op.riskHash,
    ruleSourceRef: receipt.sourceRef,mechanicalBasisJson: stable(projectTtrpgOpenMechanicalBasisV1(state)),alternatives }
}
export function currentTtrpgOpenPrivateChoiceV1(input: Parameters<typeof buildTtrpgOpenPrivateChoiceBodyV1>[0]) {
  const latest = [...(input.operation.privateChoiceDisclosures ?? [])].reverse().find(r => r.body.kind === input.kind && r.body.templateKey === input.templateKey)
  if (!latest) return null
  try { return stable(latest.body) === stable(buildTtrpgOpenPrivateChoiceBodyV1(input)) ? latest : null } catch { return null }
}
export function assertTtrpgOpenPrivateChoiceConsentV1(input: Parameters<typeof buildTtrpgOpenPrivateChoiceBodyV1>[0] & { disclosureHash?: unknown; currentCommand?: boolean }) {
  if (input.operation.plan.rollVisibility === 'public') {
    if (input.disclosureHash !== undefined) throw new Error('[ttrpg-private-choice] 公开选择不应绑定保密告知')
    return
  }
  // Old frozen histories without the additive policy keep their exact replay.
  // Every current command, including one acting on an old pending operation,
  // still requires the explicit real disclosure below.
  if (!input.currentCommand && input.operation.privateChoiceDisclosures === undefined && input.disclosureHash === undefined) return
  const review = currentTtrpgOpenPrivateChoiceV1(input)
  if (!review || review.reviewHash !== input.disclosureHash) throw new Error('[ttrpg-private-choice] 请先由主持告知当前真实后果，再由本人选择；旧告知或状态已失效')
}
