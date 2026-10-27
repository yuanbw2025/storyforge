/** Shared human read/availability boundary; all writes remain existing runtime commands. */
import type { WorkspaceScope } from '../types'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { assertTtrpgOpenSituationWindowEventV1, isTtrpgOpenPassiveEpochV1, ttrpgOpenScopedKeyV1 } from './open-coordination'
import { verifyTtrpgOpenOracleJournalV1 } from './open-oracle-contract'
import * as p from './open-contract-parse'

export interface TtrpgOpenConsultationInputV1 { scope: WorkspaceScope; sessionId: number; viewerKey: string }
export async function loadTtrpgOpenConsultationStateV1(input: TtrpgOpenConsultationInputV1) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  await verifyTtrpgOpenOracleJournalV1({ receipts: loaded.runtime.openRun!.oracleReceipts ?? [], rulePack: loaded.content.rulePack.content,
    sessionKey: loaded.runtime.sessionKey, seed: loaded.session.seed, ancestors: loaded.runtime.branchLineage?.ancestors ?? [] })
  return { ...loaded, authorizationHash: await hashProductProductionValueV2(loaded.authorization) }
}
export type TtrpgOpenConsultationStateV1 = Awaited<ReturnType<typeof loadTtrpgOpenConsultationStateV1>>
export function ttrpgOpenConsultationAvailabilityV1(loaded: TtrpgOpenConsultationStateV1, viewerKey: string) {
  const { runtime } = loaded, run = runtime.openRun!
  const epoch = run.coordination.epochs.find(row => row.epochKey === run.coordination.activeEpochKey)
  const active = runtime.product.safety.status === 'active' && run.stage.status === 'open'
  const idle = !run.operations.some(row => ['awaiting-approval', 'executing'].includes(row.status))
    && !run.coordination.calls.some(row => row.authorizationEpochKey === epoch?.epochKey && ['prepared', 'dispatched', 'unknown'].includes(row.status))
    && !run.entityOperations?.some(row => !row.resolution)
    && !runtime.branchLineage?.recoveryTasks.some(row => !['completed', 'withdrawn'].includes(row.status))
  const own = Boolean(epoch?.status === 'active' && epoch.viewerKey === viewerKey && epoch.authorizationHash === loaded.authorizationHash
    && !isTtrpgOpenPassiveEpochV1(epoch) && !epoch.commonOracle && !epoch.oracleRuntimeReferencePolicy
    && !epoch.normalizationRuntimeReferencePolicy && !epoch.runtimeEntityReferencePolicy
    && !(epoch.hostingDelegation && !epoch.hostingDelegation.stoppedRef))
  const allowed = (type: string) => { try { assertTtrpgOpenSituationWindowEventV1(runtime, type); return true } catch { return false } }
  return { epoch, active, idle, canStart: active && idle && !epoch,
    canConsult: active && idle && own && !epoch?.manualAction && allowed('ttrpg.oracle.consulted') && run.consultedThisWorldTurn < 2,
    canShare: active && idle && own && allowed('ttrpg.open.knowledge.shared'),
    canClose: active && idle && own && !epoch?.manualAction && allowed('ttrpg.open.epoch.closed')
      && !run.coordination.calls.some(row => row.authorizationEpochKey === epoch?.epochKey),
    unavailable: !active ? '请先恢复冒险并进入进行中的阶段。' : !idle ? '请先完成当前行动、原请求或恢复。'
      : !own ? '请明确开始本人的咨询与交流；其他用途的窗口不能借用。' : '' }
}
export async function ttrpgOpenConsultationEnvelopeV1(input: TtrpgOpenConsultationInputV1, loaded: TtrpgOpenConsultationStateV1, purpose: string, submissionKey: string) {
  return { sessionId: input.sessionId, baseSequence: loaded.state.lastSequence, baseStateHash: loaded.stateHash,
    commandId: await ttrpgOpenScopedKeyV1(loaded.runtime.sessionKey, purpose, [input.viewerKey, p.key(submissionKey, 'consultation submission')]) }
}
