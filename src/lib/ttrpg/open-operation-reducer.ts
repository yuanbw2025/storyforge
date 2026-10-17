import { isTtrpgOpenPassiveEpochV1 } from './open-coordination'
import { ttrpgOpenOperationEffectTemplateKeyV1,ttrpgOpenOperationEffectDegreeV1,assertTtrpgOpenInteractionChoiceCostV1 } from './open-interaction'
import { assertTtrpgOpenManualRequestV1 } from './open-manual-action'
import { assertTtrpgOpenDelegatedCompanionProposalV1 } from './open-hosting-delegation'
import { assertTtrpgOpenPrivateChoiceConsentV1 } from './open-private-choice'
import { changeTtrpgOpenChaosV1 } from './open-chaos'
import { ttrpgDegreeSucceededV2 } from './runtime-state'
/** Offline replay consumes verified business receipts; never reads DB, time or providers. */
import type { ProductRuntimeEvent, ProductRuntimeState, TtrpgEffectPrimitiveV2 } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2, advanceOpenWorldTimeV1 } from './open-runtime-contract'
import { parseTtrpgOpenOperationV1, parseTtrpgOpenRuleReceiptV1, nextTtrpgOpenOperationStepV1, ttrpgOpenOperationRuleCauseV1,
  assertTtrpgOpenOperationIntentCallV1 } from './open-operation'
import { assertTtrpgOpenRecoveredOperationV1 } from './open-branch-recovery'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { applyTtrpgMechanicalResultV1 } from './rule-action-mechanical'
import { applyTtrpgEffectPlanToRuntimeV2 } from './effect-runtime'
import { parseTtrpgEffectPlanV2 } from './effect-plan'
import * as p from './open-contract-parse'
import { settleTtrpgOpenKnowledgeV1, assertTtrpgOpenKnowledgeSettlementEqualV1, ttrpgOpenDiscoveryEffectTemplatesV1 } from './open-knowledge-settlement'

export function applyTtrpgOpenOperationEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  const types = ['ttrpg.open.operation.started', 'ttrpg.open.intent.confirmed', 'ttrpg.open.intent.disposed',
    'ttrpg.rule.action.resolved', 'ttrpg.effects.applied', 'ttrpg.world-turn.advanced',
    'ttrpg.open.operation.step.completed', 'ttrpg.open.operation.completed', 'ttrpg.open.knowledge.discovered']
  if (!types.includes(event.type)) return false
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  const run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth) p.fail('操作事件需要已授权 open 团局')
  state.ttrpg = runtime
  const eventRef = { sessionKey: runtime.sessionKey, sequence: event.sequence }
  if (event.type === 'ttrpg.open.operation.started') {
    const operation = parseTtrpgOpenOperationV1(payload.operation, runtime.sessionKey)
    const body = p.record(payload, ['operation', 'intent', ...(operation.inheritance ? ['inheritedRuleReceipt'] : [])], 'operation.started')
    const epoch = run.coordination.epochs.find(epoch => epoch.epochKey === operation.authorizationEpochKey)
    if (!epoch || isTtrpgOpenPassiveEpochV1(epoch) || epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey
      || operation.plan.authorizationHash !== epoch.authorizationHash || operation.plan.rulePackContentHash !== runtime.product.rulePackContentHash
      || operation.startedRef.sequence !== event.sequence || operation.status !== 'awaiting-approval'
      || Boolean(operation.privateChoiceDisclosures?.length) || operation.handoff || operation.preauthorization || operation.approvals.length || operation.businessRefs.length || operation.receipts.length || operation.completedRef !== null || operation.pendingChoice !== null || operation.discoveryChoices
      || run.operations.some(op => op.operationKey === operation.operationKey || ['awaiting-approval', 'executing'].includes(op.status))) p.fail('操作起点或并发窗口不合法')
    if (epoch.manualAction) {
      assertTtrpgOpenManualRequestV1(epoch,operation.plan.request)
      if (operation.inheritance || operation.intentEvidence || run.operations.some(o => o.authorizationEpochKey === epoch.epochKey)) p.fail('人工授权不能新增第二个提案或替换为模型候选')
    }
    const intent = p.object(body.intent, 'operation intent')
    const seat = auth.seats.find(seat => seat.viewerKey === intent.viewerKey)
    if (!seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || intent.viewerKey !== epoch.viewerKey
      || event.actorKey !== operation.plan.request.actorKey) p.fail('操作缺少真人启动授权')
    assertTtrpgOpenOperationIntentCallV1(operation, run.coordination.calls)
    if (operation.intentEvidence) {
      if (intent.candidateHash !== operation.intentEvidence.candidateHash) p.fail('提案不是本次真实候选版本')
      const delegationRef = operation.intentEvidence.hostingDelegationRef
      if (delegationRef) {
        if (intent.decision !== 'delegate-proposal' || stable(intent.hostingDelegationRef) !== stable(delegationRef)) p.fail('队友系统提案不能冒充新的真人确认')
        assertTtrpgOpenDelegatedCompanionProposalV1(state,{ epochKey: epoch.epochKey,viewerKey: epoch.viewerKey,delegationRef,
          runContractHash: operation.intentEvidence.runContractHash,actorKey: operation.plan.request.actorKey })
      } else if (intent.decision !== 'start' || Object.prototype.hasOwnProperty.call(intent,'hostingDelegationRef')) p.fail('意图候选尚未由真人确认此版本')
    }
    if (!operation.inheritance && operation.plan.stageTimeLimit && (run.stage.status !== 'open'
      || operation.plan.stageTimeLimit.openedAtWorldTurn !== run.stage.openedAtWorldTurn || run.worldTime.worldTurn >= operation.plan.stageTimeLimit.maximumWorldTurns
      || run.worldTime.worldTurn + operation.plan.timeCostWorldTurns > operation.plan.stageTimeLimit.maximumWorldTurns)) p.fail('新行动超过实际阶段耗时窗口')
    run.operations.push(operation)
    if (operation.inheritance) {
      if (!runtime.branchLineage) p.fail('继承操作缺少冻结祖先')
      const receipt = parseTtrpgOpenRuleReceiptV1(body.inheritedRuleReceipt)
      const task = assertTtrpgOpenRecoveredOperationV1({ lineage: runtime.branchLineage, authorization: auth,
        operation, receipt, mode: 'candidate' })
      task.childOperationKey = operation.operationKey; task.status = 'executing'
      if (operation.plan.interaction && (receipt.result.outcome !== 'automatic' || receipt.result.check !== null || receipt.result.resourceChanges.some(c => c.proofHash !== null))) p.fail('no-roll 互动不得携带随机裁定或随机伤害证明')
    run.ruleReceipts.push(receipt)
    }
    return true
  }
  const operationKey = p.key(payload.operationKey, 'operationKey')
  const operation = run.operations.find(op => op.operationKey === operationKey) ?? p.fail('操作不存在')
  if (payload.frozenPlanHash !== operation.planHash) p.fail('操作冻结计划已变化')
  const epoch = run.coordination.epochs.find(epoch => epoch.epochKey === operation.authorizationEpochKey)
  if (!epoch || epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey) p.fail('操作授权窗口已关闭')
  if (event.type === 'ttrpg.open.intent.confirmed') {
    p.exact(p.object(payload, 'confirmation'), ['operationKey', 'frozenPlanHash', 'riskHash', 'actorKey', 'approverSeatKey', 'viewerKey', 'decision', 'intent', 'confirmationKind', 'alternativeKey', ...(payload.confirmationKind === 'knowledge-choice' ? ['templateKey'] : []), ...(Object.prototype.hasOwnProperty.call(payload,'disclosureHash') ? ['disclosureHash'] : [])], 'confirmation')
    const actorKey = p.key(payload.actorKey, 'approval actor')
    const seat = auth.seats.find(seat => seat.seatKey === payload.approverSeatKey && seat.viewerKey === payload.viewerKey)
    const required = operation.plan.requiredApprovals.find(approval => approval.actorKey === actorKey)
    if (payload.confirmationKind === 'knowledge-choice') {
      const receipt = run.ruleReceipts.find(r => r.operationKey === operation.operationKey) ?? p.fail('发现选择尚无真实规则结果')
      const template = ttrpgOpenDiscoveryEffectTemplatesV1(operation, receipt).find(t => t.planKey === payload.templateKey)
      if (operation.status !== 'executing' || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'knowledge'
        || operation.businessRefs.some(ref => ref.stepKey === 'knowledge') || operation.discoveryChoices?.some(c => c.templateKey === payload.templateKey)
        || actorKey !== operation.plan.request.actorKey || payload.decision !== 'approve' || payload.riskHash !== operation.riskHash
        || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || !required?.allowedSeatKeys.includes(seat.seatKey)
        || event.actorKey !== seat.actorKey || !template?.alternatives.some(a => a.alternativeKey === payload.alternativeKey)) p.fail('发现代价必须是本计划允许的真人选择')
      assertTtrpgOpenPrivateChoiceConsentV1({ state,runtime,operation,kind: 'knowledge',templateKey: String(payload.templateKey),disclosureHash: payload.disclosureHash })
      operation.discoveryChoices = [...(operation.discoveryChoices ?? []), { templateKey: template.planKey,
        alternativeKey: p.key(payload.alternativeKey, 'discovery alternative'), selectionRef: eventRef }]
      return true
    }
    if (payload.confirmationKind === 'effect-choice') {
      const choice = operation.pendingChoice
      const template = operation.plan.effectTemplates.find(template => template.planKey === choice?.templateKey)
      if (operation.status !== 'executing' || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'effect'
        || !choice || choice.selectedAlternativeKey !== null || actorKey !== operation.plan.request.actorKey
        || payload.decision !== 'approve' || payload.riskHash !== operation.riskHash || !seat || seat.controller === 'ai'
        || seat.assignmentState !== 'claimed' || !required?.allowedSeatKeys.includes(seat.seatKey)
        || event.actorKey !== seat.actorKey || !template?.alternatives.some(alternative => alternative.alternativeKey === payload.alternativeKey)) p.fail('后果选择必须是本计划允许的真人选择')
      assertTtrpgOpenPrivateChoiceConsentV1({ state,runtime,operation,kind: 'effect',templateKey: operation.pendingChoice?.templateKey ?? '',disclosureHash: payload.disclosureHash })
      assertTtrpgOpenInteractionChoiceCostV1(state,operation.plan,p.key(payload.alternativeKey,'alternative key'))
      choice.selectedAlternativeKey = p.key(payload.alternativeKey, 'alternativeKey')
      choice.selectionRef = eventRef
      return true
    }
    if (payload.confirmationKind !== 'operation' || payload.alternativeKey !== null) p.fail('确认种类不合法')
    if (operation.status !== 'awaiting-approval' || operation.approvals.some(approval => approval.actorKey === actorKey)
      || payload.riskHash !== operation.riskHash || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed'
      || !required?.allowedSeatKeys.includes(seat.seatKey) || event.actorKey !== seat.actorKey) p.fail('确认不属于本计划或已 claimed 真人批准者')
    const decision = p.oneOf(payload.decision, ['approve', 'reject'], 'decision')
    operation.approvals.push({ actorKey, approverSeatKey: seat.seatKey, viewerKey: seat.viewerKey, decision, sourceRef: eventRef })
    if (decision === 'reject') {
      operation.status = 'rejected'
      if (operation.inheritance && runtime.branchLineage) {
        const task = runtime.branchLineage.recoveryTasks.find(task => task.taskKey === operation.inheritance!.taskKey)!
        task.status = 'ready'; task.childOperationKey = null
      }
    }
    else if (operation.plan.requiredApprovals.every(required => operation.approvals.some(approval => approval.actorKey === required.actorKey && approval.decision === 'approve'))) {
      operation.status = 'executing'
      if (operation.inheritance?.discoveryChoices && operation.plannedSteps.some(s => s.kind === 'knowledge')) {
        operation.discoveryChoices = operation.inheritance.discoveryChoices.map(c => ({ ...c, selectionRef: eventRef }))
      }
      if (operation.inheritance && operation.plannedSteps.some(step => step.kind === 'effect')) {
        const receipt = run.ruleReceipts.find(receipt => receipt.operationKey === operation.operationKey)!
        const templateKey = ttrpgOpenOperationEffectTemplateKeyV1(operation.plan,receipt.result.outcome)
        const template = operation.plan.effectTemplates.find(template => template.planKey === templateKey)
        if (template?.alternatives.length) operation.pendingChoice = { templateKey: template.planKey,
          selectedAlternativeKey: operation.inheritance.selectedAlternativeKey,
          selectionRef: operation.inheritance.selectedAlternativeKey === null ? null : eventRef }
      }
    }
    return true
  }
  if (event.type === 'ttrpg.open.intent.disposed') {
    p.exact(p.object(payload, 'disposed'), ['operationKey', 'frozenPlanHash', 'viewerKey', 'reason', 'intent'], 'disposed')
    const seat = auth.seats.find(seat => seat.viewerKey === payload.viewerKey)
    if (!['awaiting-approval', 'executing'].includes(operation.status) || operation.businessRefs.length || operation.inheritance
      || payload.viewerKey !== epoch.viewerKey || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed'
      || event.actorKey !== seat.actorKey) p.fail('只能撤销未执行业务的本人计划')
    p.text(payload.reason, 'dispose reason', 2000)
    operation.status = 'stale'
    return true
  }
  if (operation.status !== 'executing') p.fail('计划尚未获全部真人批准或已处置')
  if (event.type === 'ttrpg.open.operation.step.completed') {
    p.exact(p.object(payload, 'step completed'), ['operationKey', 'frozenPlanHash', 'stepKey', 'businessRef', 'intent'], 'step completed')
    const step = nextTtrpgOpenOperationStepV1(operation)
    const businessRef = parseTtrpgOpenSourceRefV1(payload.businessRef)
    const business = operation.businessRefs.find(ref => ref.stepKey === payload.stepKey)
    if (!step || step.stepKey !== payload.stepKey || !business || stable(business.sourceRef) !== stable(businessRef)
      || businessRef.sessionKey !== runtime.sessionKey || businessRef.sequence >= event.sequence) p.fail('步骤回执必须引用真实已提交且按序的业务事件')
    operation.receipts.push({ stepKey: step.stepKey, businessRef, completedRef: eventRef })
    return true
  }
  if (event.type === 'ttrpg.open.operation.completed') {
    p.exact(p.object(payload, 'completed'), ['operationKey', 'frozenPlanHash', 'intent'], 'completed')
    if (nextTtrpgOpenOperationStepV1(operation) !== null) p.fail('仍有必需业务步骤，不能宣布操作完成')
    operation.status = 'completed'; operation.completedRef = eventRef
    if (operation.inheritance && runtime.branchLineage) {
      runtime.branchLineage.recoveryTasks.find(task => task.taskKey === operation.inheritance!.taskKey)!.status = 'completed'
    }
    return true
  }
  const step = nextTtrpgOpenOperationStepV1(operation)
  const causeRef = parseTtrpgOpenSourceRefV1(payload.causeRef)
  if (!step || step.stepKey !== payload.stepKey || operation.businessRefs.some(ref => ref.stepKey === step.stepKey)
    || causeRef.sessionKey !== runtime.sessionKey || causeRef.sequence >= event.sequence) p.fail('业务步骤顺序、因果或幂等键不合法')
  if (event.type === 'ttrpg.rule.action.resolved') {
    p.exact(p.object(payload, 'rule result'), ['operationKey', 'frozenPlanHash', 'stepKey', 'causeRef', 'receipt', 'intent', ...(Object.prototype.hasOwnProperty.call(payload, 'recordChaos') ? ['recordChaos'] : [])], 'rule result')
    const receipt = parseTtrpgOpenRuleReceiptV1(payload.receipt)
    if (operation.plan.interaction && (receipt.result.outcome !== 'automatic' || receipt.result.check !== null
      || receipt.result.resourceChanges.some(c => c.proofHash !== null) || payload.recordChaos !== true)) p.fail('no-roll 互动必须保留无骰结果与真实混乱结算')
    if (step.kind !== 'rule' || stable(causeRef) !== stable(operation.startedRef)
      || receipt.operationKey !== operationKey || receipt.frozenPlanHash !== operation.planHash
      || stable(receipt.sourceRef) !== stable(eventRef) || event.actorKey !== operation.plan.request.actorKey
      || (receipt.result.check && (receipt.result.check.eventSequence !== event.sequence
        || receipt.result.check.rule?.rulePackContentHash !== operation.plan.rulePackContentHash))) p.fail('规则裁定没有绑定真实计划/来源/规则')
    run.ruleReceipts.push(receipt)
    if (Object.prototype.hasOwnProperty.call(payload, 'recordChaos')) {
      p.literal(payload.recordChaos, true, 'record rule chaos')
      if (receipt.result.outcome !== 'automatic' && !ttrpgDegreeSucceededV2(receipt.result.outcome)) changeTtrpgOpenChaosV1(run, 'failed-check', event.sequence)
      if (operation.plan.interaction?.kind === 'retreat') changeTtrpgOpenChaosV1(run,'player-retreat',event.sequence)
    }
    const templateKey = ttrpgOpenOperationEffectTemplateKeyV1(operation.plan,receipt.result.outcome) ?? null
    const template = operation.plan.effectTemplates.find(template => template.planKey === templateKey)
    if (template?.alternatives.length) operation.pendingChoice = { templateKey: template.planKey, selectedAlternativeKey: null, selectionRef: null }
  } else if (event.type === 'ttrpg.effects.applied') {
    p.exact(p.object(payload, 'operation effect'), ['operationKey', 'frozenPlanHash', 'stepKey', 'causeRef', 'effectPlan', 'intent'], 'operation effect')
    const receipt = run.ruleReceipts.find(receipt => receipt.operationKey === operationKey) ?? p.fail('机械效果缺少规则裁定回执')
    if (stable(causeRef) !== stable(receipt.sourceRef)) p.fail('效果因果不属于实际规则事件')
    if (step.kind === 'mechanics') {
      if (payload.effectPlan !== null) p.fail('基础机械步骤不能注入额外效果计划')
      applyTtrpgMechanicalResultV1(state, receipt.result)
      if (operation.plan.request.controllerMode === 'ai') {
        const actorKey = operation.plan.request.actorKey
        if (epoch.successfulActorKeys.includes(actorKey) || epoch.successfulActorKeys.length >= epoch.budget.maximumAiActions) p.fail('队友 epoch 行动额度耗尽')
        epoch.successfulActorKeys.push(actorKey)
      }
    } else if (step.kind === 'effect') {
      const degree = ttrpgOpenOperationEffectDegreeV1(operation.plan,receipt.result.outcome)
      const templateKey = ttrpgOpenOperationEffectTemplateKeyV1(operation.plan,receipt.result.outcome)
      if (templateKey === null) { if (payload.effectPlan !== null) p.fail('该冻结裁定没有后果模板') }
      else {
        const template = operation.plan.effectTemplates.find(template => template.planKey === templateKey) ?? p.fail('后果模板缺失')
        if (template.alternatives.length && !operation.pendingChoice?.selectedAlternativeKey) p.fail('该后果需要真人选择，不能自动采纳')
        const effectPlan = parseTtrpgEffectPlanV2(payload.effectPlan)
        const bindings = operation.plan.request.effectBindings[templateKey]
        const primitives = template.alternatives.length ? template.alternatives.find(alternative => alternative.alternativeKey === operation.pendingChoice!.selectedAlternativeKey)!.effects : template.effects
        const effects: TtrpgEffectPrimitiveV2[] = primitives.flatMap(effect => {
          if (effect.family === 'knowledge') {
            if (!operation.plan.discoveryPlan || effect.evidenceRef !== operation.plan.discoveryPlan.request.evidenceRef) p.fail('知识后果缺少冻结发现计划')
            return []
          }
          if (effect.family === 'story' && effect.operation !== 'location.set') return p.fail('后果 owner 尚未接入，必须保留待办')
          const targetRef = effect.targetRef.startsWith('parameter:') ? bindings[effect.targetRef.slice(10)] : effect.targetRef
          return targetRef === null ? [] : [{ ...effect, targetRef }]
        })
        if (effectPlan.degree !== degree || effectPlan.ruleRef !== template.ruleRef || effectPlan.reason !== template.reason
          || effectPlan.audience !== template.audience || effectPlan.sourceEventId !== `event.${causeRef.sequence}`
          || stable(effectPlan.effects) !== stable(effects)) p.fail('后果计划不是冻结模板的合法绑定')
        assertTtrpgOpenInteractionChoiceCostV1(state,operation.plan,operation.pendingChoice?.selectedAlternativeKey ?? null)
        const applied = applyTtrpgEffectPlanToRuntimeV2({ state, rulePack: operation.plan.rulePack, plan: effectPlan, eventSequence: event.sequence })
        state.entities = applied.state.entities
        runtime.product = applied.state.ttrpg!.product
      }
    } else p.fail('效果事件不属于此步骤')
  } else if (event.type === 'ttrpg.open.knowledge.discovered') {
    p.exact(payload, ['operationKey', 'frozenPlanHash', 'stepKey', 'causeRef', 'knowledgeKey', 'settlement', 'intent'], 'knowledge discovery')
    const receipt = run.ruleReceipts.find(receipt => receipt.operationKey === operationKey) ?? p.fail('知识发现没有实际检定回执')
    if (step.kind !== 'knowledge' || stable(causeRef) !== stable(receipt.sourceRef) || event.actorKey !== operation.plan.request.actorKey || event.targetKey !== null) p.fail('知识发现顺序或真实因果不一致')
    const result = settleTtrpgOpenKnowledgeV1({ state, operation, ruleReceipt: receipt, sequence: event.sequence,
      commandId: p.key(event.commandId, 'knowledge command'), knowledgeKey: p.key(payload.knowledgeKey, 'knowledge key') })
    assertTtrpgOpenKnowledgeSettlementEqualV1(payload.settlement, result.settlement)
    state.entities = result.state.entities
    runtime.product = result.state.ttrpg!.product
    const settledRun = result.state.ttrpg!.openRun as typeof run
    run.knowledge = settledRun.knowledge
    run.situations = settledRun.situations
  } else if (event.type === 'ttrpg.world-turn.advanced') {
    p.exact(p.object(payload, 'time tick'), ['operationKey', 'frozenPlanHash', 'stepKey', 'causeRef', 'byEventSequence', 'reason', 'tickIndex', 'intent', ...(Object.prototype.hasOwnProperty.call(payload, 'recordPressureTurn') ? ['recordPressureTurn'] : [])], 'time tick')
    const ruleCauseRef = ttrpgOpenOperationRuleCauseV1(operation)
    if (step.kind !== 'time' || !ruleCauseRef || stable(causeRef) !== stable(ruleCauseRef)
      || payload.byEventSequence !== causeRef.sequence || payload.tickIndex !== step.tickIndex
      || step.tickIndex === null || step.tickIndex > operation.plan.timeCostWorldTurns
      || payload.reason !== (operation.plan.request.controllerMode === 'ai' ? 'ai-companion-action' : 'game-action')) p.fail('世界耗时缺少已结算行动和冻结 tick 依据')
    // Tick sequence orders storage; the separate causeRef/byEventSequence prove the settled action.
    const reason = operation.plan.request.controllerMode === 'ai' ? 'ai-companion-action' : 'game-action'
    if (operation.plan.stageTimeLimit && run.worldTime.worldTurn >= operation.plan.stageTimeLimit.maximumWorldTurns) p.fail('阶段已达最大世界轮次，不得继续耗时')
    const advanced = advanceOpenWorldTimeV1(run, reason, event.sequence)
    run.worldTime = advanced.worldTime
    run.consultedThisWorldTurn = 0
    for (const [actorKey, conditions] of Object.entries(runtime.product.conditions)) {
      runtime.product.conditions[actorKey] = conditions.flatMap(condition => condition.duration === null ? [condition]
        : condition.duration > 1 ? [{ ...condition, duration: condition.duration - 1 }] : [])
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'recordPressureTurn')) {
      p.literal(payload.recordPressureTurn, true, 'record pressure turn')
      operation.pressureTurnConditions = [...(operation.pressureTurnConditions ?? []), { tickIndex: step.tickIndex!, worldTurn: run.worldTime.worldTurn,
        sourceRef: eventRef, conditions: structuredClone(runtime.product.conditions) }]
    }
    state.clock = run.worldTime.worldTurn
  } else return false
  operation.businessRefs.push({ stepKey: step.stepKey, sourceRef: eventRef })
  return true
}
