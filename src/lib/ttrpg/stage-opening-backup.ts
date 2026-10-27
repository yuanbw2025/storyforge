/** Validate approvals against the actual preceding portable event state. */
import type { ProductRuntimeEvent } from '../types'
import { parseProductRuntimeState, applyProductRuntimeEvent } from '../product/runtime-core'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { prepareTtrpgOpenNextStagePlanV1 } from './open-stage-opening-plan'
import { parseTtrpgOpenStageOpeningReceiptV1, verifyTtrpgOpenStageOpeningReceiptsV1 } from './open-stage-opening-contract'

export async function assertTtrpgStageOpeningBackupV1(backup: Record<string, unknown>): Promise<void> {
  const sessions = backup.productRuntimeSessions, events = backup.productRuntimeEvents
  if (!Array.isArray(sessions) || !Array.isArray(events)) throw new Error('[ttrpg-stage-backup] 缺少实例或事件表')
  const grouped = new Map<number, typeof events>()
  for (const event of events) {
    const bucket = grouped.get(event._productRuntimeSessionExportId) ?? []
    bucket.push(event); grouped.set(event._productRuntimeSessionExportId, bucket)
  }
  for (const session of sessions) {
    if (session.kind !== 'ttrpg') continue
    const initial = JSON.parse(session.initialStateJson), own = grouped.get(session._exportId) ?? []
    if (!initial.ttrpg?.openRun?.stageOpenings?.length && !own.some(e => e.type === 'ttrpg.open.stage.opened')) continue
    let state = parseProductRuntimeState(initial)
    await verifyTtrpgOpenStageOpeningReceiptsV1(initial.ttrpg?.openRun?.stageOpenings ?? [])
    for (const row of [...own].sort((a, b) => a.sequence - b.sequence)) {
      const payload = JSON.parse(row._portablePayloadJson ?? row.payloadJson)
      if (payload?.envelope && typeof payload.envelope === 'object' && payload.envelope.sessionId === session._exportId) payload.envelope.sessionId = session._exportId + 1
      const event: ProductRuntimeEvent = { ...row, projectId: 0, sessionId: session._exportId + 1,
        worldGroupId: session._worldGroupExportId ?? null, payloadJson: JSON.stringify(payload) }
      if (event.type === 'ttrpg.open.stage.opened') {
        const receipt = parseTtrpgOpenStageOpeningReceiptV1(payload.receipt), { plan } = receipt
        const expected = await prepareTtrpgOpenNextStagePlanV1({ state, content: receipt.frozenContent, runtimeSourceHash: session.runtimeSourceHash,
          viewerKey: plan.viewerKey, commandId: plan.commandId, templateKeys: plan.selected.map(s => s.templateKey) })
        if (stable(expected.plan) !== stable(plan)) throw new Error('[ttrpg-stage-backup] 开局预览与原真实前态不一致')
        await verifyTtrpgOpenStageOpeningReceiptsV1([receipt])
      }
      state = applyProductRuntimeEvent(state, event)
    }
  }
}
