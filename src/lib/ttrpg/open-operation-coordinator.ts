import type { TtrpgOpenOperationResumeV1 } from './runtime-commands'
/** Explicit, bounded recovery. Reading a state never calls this coordinator. */
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { ttrpgOpenDiscoveryEffectTemplatesV1 } from './open-knowledge-settlement'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { resolveTtrpgOpenOperationRuleV1, applyTtrpgOpenOperationEffectV1, advanceTtrpgWorldTurnV1,
  completeTtrpgOpenOperationStepV1, completeTtrpgOpenOperationV1, ttrpgOpenOperationCommandIdV1, discoverTtrpgOpenKnowledgeV1 } from './runtime-commands'

export async function resumeTtrpgOpenOperationV1(input: TtrpgOpenOperationResumeV1) {
  for (let attempt = 0; attempt < 8193; attempt++) {
    const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
    const operation = runtime?.openRun?.operations.find(operation => operation.operationKey === input.operationKey)
    if (!runtime || !operation || operation.planHash !== input.frozenPlanHash) throw new Error('[ttrpg] 恢复操作不存在或冻结计划已变化')
    if (operation.status !== 'executing') return { status: operation.status, nextStepKey: nextTtrpgOpenOperationStepV1(operation)?.stepKey ?? null }
    const step = nextTtrpgOpenOperationStepV1(operation)
    const version = await readProductRuntimeStateVersion(input.sessionId)
    const envelope = async (stepKey: string) => ({ ...input,
      commandId: await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, operation.operationKey, stepKey),
      baseSequence: version.sequence, baseStateHash: version.stateHash })
    if (step === null) {
      await completeTtrpgOpenOperationV1(await envelope('completed'))
      continue
    }
    if (operation.businessRefs.some(ref => ref.stepKey === step.stepKey)) {
      await completeTtrpgOpenOperationStepV1({ ...await envelope(`${step.stepKey}.receipt`), stepKey: step.stepKey })
      continue
    }
    if (step.kind === 'effect' && operation.pendingChoice && operation.pendingChoice.selectedAlternativeKey === null) return { status: 'awaiting-choice', nextStepKey: step.stepKey }
    if (step.kind === 'knowledge') {
      const receipt = runtime.openRun!.ruleReceipts.find(r => r.operationKey === operation.operationKey)
      if (!receipt) throw new Error('[ttrpg] 发现选择缺少真实规则回执')
      const unresolved = ttrpgOpenDiscoveryEffectTemplatesV1(operation, receipt).filter(t => t.alternatives.length && !operation.discoveryChoices?.some(c => c.templateKey === t.planKey))
      if (unresolved.length) return { status: 'awaiting-choice', nextStepKey: step.stepKey, templateKeys: unresolved.map(t => t.planKey) }
    }
    if (step.kind === 'rule') await resolveTtrpgOpenOperationRuleV1(await envelope(step.stepKey))
    else if (step.kind === 'mechanics' || step.kind === 'effect') await applyTtrpgOpenOperationEffectV1({ ...await envelope(step.stepKey), stepKey: step.kind })
    else if (step.kind === 'knowledge') await discoverTtrpgOpenKnowledgeV1(await envelope(step.stepKey))
    else if (step.kind === 'time') await advanceTtrpgWorldTurnV1({ ...await envelope(step.stepKey), stepKey: step.stepKey,
      reason: operation.plan.request.controllerMode === 'ai' ? 'ai-companion-action' : 'game-action' })
    else return { status: 'awaiting-owner', nextStepKey: step.stepKey }
  }
  throw new Error('[ttrpg] 恢复操作超过冻结步骤上限')
}
