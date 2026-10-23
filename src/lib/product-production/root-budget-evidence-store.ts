import { readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { replayAgentRunEventsV1 } from '../agent/run/projection'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, WorkspaceScope } from '../types'
import { verifyProductBuildRootBudgetEvidenceV1 } from './root-budget-evidence'

function fail(detail: string): never {
  throw new Error(`[product-build-root-evidence] ${detail}`)
}

/** Verifies retained preimage bytes against current, independently read Run ownership. */
export async function verifyStoredProductBuildRootBudgetEvidenceV1(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1
  artifacts: ProductBuildArtifactRecordV1[]
}): Promise<void> {
  const { scope, build } = input
  if (!['preview-ready', 'release-ready', 'released'].includes(build.status)) {
    fail('历史封存证据不授予当前 Build 权限')
  }
  if (!build.id || !build.rootBudgetEvidenceJson || !build.rootTerminalReceiptHash
    || build.projectId !== scope.projectId || build.workId !== scope.workId
    || build.worldId !== scope.worldId) fail('Build owner 或原始封存证据缺失')
  const ledger = JSON.parse(build.budgetLedgerJson) as { rootRunId: number }
  const snapshots = new Map<number, Promise<AgentRunSnapshotV1>>()
  const read = (id: number): Promise<AgentRunSnapshotV1> => {
    let result = snapshots.get(id)
    if (!result) {
      result = readAgentRunV1(scope, id)
      snapshots.set(id, result)
    }
    return result
  }
  const assertRunOwner = (run: AgentRunSnapshotV1, epoch: number, taskKey: string) => {
    const boundary = run.contract.scope.productProduction
    if (run.run.projectId !== build.projectId || run.run.workId !== build.workId
      || run.run.productBuildId !== build.id || !boundary || boundary.productBuildId !== build.id
      || boundary.buildNumber !== build.buildNumber || boundary.controlEpoch !== epoch
      || boundary.taskKey !== taskKey
      || epoch === build.controlEpoch && boundary.planHash !== build.planHash) {
      fail('预算 Run 不属于冻结的 Build/任务/轮次')
    }
  }
  await verifyProductBuildRootBudgetEvidenceV1({
    planHash: build.planHash, manifestHash: build.manifestHash, packageHash: build.packageHash,
    qualityReportHash: build.qualityReportHash, controlEpoch: build.controlEpoch,
    budgetLedgerJson: build.budgetLedgerJson, artifacts: input.artifacts,
    expectedReceiptHash: build.rootTerminalReceiptHash,
    evidenceJson: build.rootBudgetEvidenceJson,
    verifyCurrentRun: async reference => {
      const snapshot = await read(reference.runId)
      assertRunOwner(snapshot, reference.controlEpoch, reference.taskKey)
      if (reference.taskKey === '$root') {
        const last = snapshot.events[snapshot.events.length - 1]
        const complete = snapshot.projection.state === 'completed'
          && snapshot.run.terminalReceiptHash === build.rootTerminalReceiptHash
          && snapshot.projection.terminalReceiptHash === build.rootTerminalReceiptHash
        const completedPrefix = last?.type === 'verification.staled'
          ? replayAgentRunEventsV1(snapshot.events.slice(0, -1)) : null
        const imported = snapshot.projection.state === 'running'
          && last?.type === 'verification.staled'
          && last.payload.reason === 'project-import-scope-rebound'
          && last.payload.previousReceiptHash === build.rootTerminalReceiptHash
          && completedPrefix?.errors.length === 0
          && completedPrefix.state === 'completed'
          && completedPrefix.terminalReceiptHash === build.rootTerminalReceiptHash
          && Object.values(snapshot.projection.steps).every(step => step.status === 'succeeded')
        if (snapshot.run.parentRunId !== null || snapshot.run.parentRelation !== null
          || reference.runId !== ledger.rootRunId || !complete && !imported) {
          fail('root 没有精确完成态或导入失效前缀')
        }
        return
      }
      if (snapshot.run.parentRunId == null
        || snapshot.run.parentRelation !== `task:${reference.taskKey}`) {
        fail('task Run 没有冻结的 root 归属')
      }
      const parent = await read(snapshot.run.parentRunId)
      assertRunOwner(parent, reference.controlEpoch, '$root')
      if (parent.run.parentRunId !== null || parent.run.parentRelation !== null
        || reference.controlEpoch === build.controlEpoch && parent.run.id !== ledger.rootRunId) {
        fail('task Run 的父 root 不闭合')
      }
    },
  })
}
