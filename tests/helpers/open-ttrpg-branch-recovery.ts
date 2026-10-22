import { resumeTtrpgOpenPressureV1 } from '../../src/lib/ttrpg/open-pressure-coordinator'
import { resumeTtrpgOpenSituationsV1 } from '../../src/lib/ttrpg/open-situation-coordinator'
/** Internal protocol fixture usable in fake and real isolated IndexedDB; no test-framework dependency. */
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
import { readProductRuntimeState, readProductRuntimeStateVersion, branchProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from '../../src/lib/ttrpg/open-operation'
import { startTtrpgOpenEpochV1, startTtrpgOpenOperationV1, confirmTtrpgOpenOperationV1, ttrpgOpenOperationCommandIdV1,
  resolveTtrpgOpenOperationRuleV1, applyTtrpgOpenOperationEffectV1, advanceTtrpgWorldTurnV1, completeTtrpgOpenOperationStepV1,
  completeTtrpgOpenSessionZeroV1, inheritTtrpgOpenSourceV1, startTtrpgOpenInheritedOperationV1 } from '../../src/lib/ttrpg/runtime-commands'

export const rt = (state: Awaited<ReturnType<typeof readProductRuntimeState>>) => parseTtrpgRuntimeStateV2(state.ttrpg)!

export async function operationInput(sessionId: number, operationKey: string, step: string) {
  const runtime = rt(await readProductRuntimeState(sessionId)), op = runtime.openRun!.operations.find(op => op.operationKey === operationKey)!
  return { ...await openEnvelopeV1(sessionId, await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, operationKey, step)),
    operationKey, frozenPlanHash: op.planHash, viewerKey: OPEN_HUMAN_VIEWER }
}
export async function approve(sessionId: number, operationKey: string) {
  const op = rt(await readProductRuntimeState(sessionId)).openRun!.operations.find(op => op.operationKey === operationKey)!
  for (const approval of op.plan.requiredApprovals) await confirmTtrpgOpenOperationV1({
    ...await operationInput(sessionId, operationKey, `approval.${approval.actorKey}`),
    actorKey: approval.actorKey, riskHash: op.riskHash, decision: 'approve' })
}
export async function parentAtCut(cut: string) {
  const fixture = await readyOpenTtrpgSessionV1('branch fault recovery', pkg => {
    pkg.ttrpg!.rulePack.content.timePolicy.existingAction = 3
    pkg.ttrpg!.rulePack.content.timePolicy.actionOverrides = []
    pkg.ttrpg!.rulePack.content.actions[0].usage = { mode: 'charges', maximum: 2, resourceKey: null, cost: null,
      sharedPoolKey: null, cooldownRounds: null, reset: [] }
  })
  const sessionId = fixture.sessionId
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(sessionId, 'epoch'), viewerKey: OPEN_HUMAN_VIEWER,
    triggerKind: 'submit-action', rawInput: '行动' })
  const action = fixture.runtimePackage.ttrpg!.rulePack.content.actions[0]
  await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(sessionId, 'plan'), viewerKey: OPEN_HUMAN_VIEWER,
    request: { route: 'existing-action', ruleKey: action.key, actorKey: 'hero', targetKey: action.target === 'self' ? 'hero' : action.target === 'scene' ? null : 'keeper',
      controllerMode: 'human', effectBindings: {} } })
  const op = rt(await readProductRuntimeState(sessionId)).openRun!.operations[0]
  await approve(sessionId, op.operationKey)
  for (let i = 0; i < 64; i++) {
    const current = rt(await readProductRuntimeState(sessionId)).openRun!.operations[0]
    const step = nextTtrpgOpenOperationStepV1(current)!
    if (step.kind === 'pressure' || step.kind === 'situations') {
      if (cut === 'pressure') break
      const command = { sessionId,operationKey: op.operationKey,frozenPlanHash: op.planHash,viewerKey: OPEN_HUMAN_VIEWER }
      const result = step.kind === 'pressure' ? await resumeTtrpgOpenPressureV1(command) : await resumeTtrpgOpenSituationsV1(command)
      if (result.status !== 'executing') break
      continue
    }
    if (['terminal','gates','narration','handoff'].includes(step.kind)) break
    const input = await operationInput(sessionId, op.operationKey, step.stepKey)
    if (step.kind === 'rule') await resolveTtrpgOpenOperationRuleV1(input)
    else if (step.kind === 'mechanics') await applyTtrpgOpenOperationEffectV1({ ...input, stepKey: 'mechanics' })
    else if (step.kind === 'time') await advanceTtrpgWorldTurnV1({ ...input, stepKey: step.stepKey, reason: 'game-action' })
    else throw new Error('unexpected fixture step')
    if (cut === step.stepKey) break
    await completeTtrpgOpenOperationStepV1({ ...await operationInput(sessionId, op.operationKey, `${step.stepKey}.receipt`), stepKey: step.stepKey })
    if (cut === `${step.stepKey}.receipt`) break
  }
  return { fixture, sessionId, operationKey: op.operationKey, frozenPlanHash: op.planHash }
}
export async function forkAndStart(parentId: number) {
  const child = await branchProductRuntimeSession({ parentSessionId: parentId,
    throughSequence: (await readProductRuntimeStateVersion(parentId)).sequence, title: '恢复分支', seed: 'child.recovery.seed' })
  const sessionId = child.id!, state = await readProductRuntimeState(sessionId), task = rt(state).branchLineage!.recoveryTasks[0]
  await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(sessionId, 'zero'), viewerKey: OPEN_HUMAN_VIEWER,
    acceptedItemKeys: rt(state).product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(sessionId, 'epoch'), viewerKey: OPEN_HUMAN_VIEWER,
    triggerKind: 'continue-host', rawInput: '只补齐父已提交结果的剩余结算' })
  const marker = await inheritTtrpgOpenSourceV1({ ...await openEnvelopeV1(sessionId, 'marker'), taskKey: task.taskKey, viewerKey: OPEN_HUMAN_VIEWER })
  const started = await startTtrpgOpenInheritedOperationV1({ ...await openEnvelopeV1(sessionId, 'recovery.start'), taskKey: task.taskKey, viewerKey: OPEN_HUMAN_VIEWER })
  const op = rt(await readProductRuntimeState(sessionId)).openRun!.operations[0]
  return { child, sessionId, taskKey: task.taskKey, op, marker, started }
}
