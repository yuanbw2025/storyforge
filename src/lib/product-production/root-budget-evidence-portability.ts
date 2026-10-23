import type { ProjectExportData } from '../export/json-export'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, AgentRunRecord } from '../types'
import { verifyPortableCompletedAgentRunEvidenceV1 } from '../agent/run/ledger-portability'
import { createProductBuildRootTerminalReceiptV1, verifyProductBuildRootTerminalReceiptV1 } from './receipts'
import { createProductBuildRootBudgetEvidenceV1, parseProductBuildRootBudgetEvidenceV1, verifyProductBuildRootBudgetEvidenceV1,
  type ProductBuildBudgetRunReferenceV1 } from './root-budget-evidence'

type PortableRun = ProjectExportData['agentRuns'][number]
type PortableEvent = ProjectExportData['agentRunEvents'][number]

function fail(message: string): never {
  throw new Error(`[product-build-root-evidence] ${message}`)
}

function receiptInput(build: ProductBuildRecordV1, artifacts: ProductBuildArtifactRecordV1[]) {
  return { planHash: build.planHash, manifestHash: build.manifestHash, packageHash: build.packageHash,
    qualityReportHash: build.qualityReportHash, controlEpoch: build.controlEpoch,
    budgetLedgerJson: build.budgetLedgerJson, artifacts }
}

function indexEvents(data: ProjectExportData): Map<number, PortableEvent[]> {
  const events = new Map<number, PortableEvent[]>()
  for (const row of data.agentRunEvents) {
    const bucket = events.get(row._agentRunExportId) ?? []
    bucket.push(row)
    events.set(row._agentRunExportId, bucket)
  }
  return events
}

function assertBoundary(run: Pick<AgentRunRecord, 'contractJson'>, expected: {
  buildId: number; buildNumber: number; epoch: number; taskKey: string; planHash?: string
}) {
  const boundary = JSON.parse(run.contractJson).scope?.productProduction
  if (!boundary || boundary.productBuildId !== expected.buildId
    || boundary.buildNumber !== expected.buildNumber || boundary.controlEpoch !== expected.epoch
    || boundary.taskKey !== expected.taskKey
    || expected.planHash !== undefined && boundary.planHash !== expected.planHash) {
    fail('Run 契约与账本定位不一致')
  }
}

/** Called only from the registry export pipeline, against its immutable captured rows. */
export async function prepareProductBuildRootBudgetEvidenceExportV1(input: {
  data: ProjectExportData
  originalRows: ReadonlyMap<string, readonly unknown[]>
  exportIds: ReadonlyMap<string, ReadonlyMap<number, number>>
}): Promise<void> {
  const builds = input.originalRows.get('productBuilds') as readonly ProductBuildRecordV1[] | undefined
  if (!builds?.length) return
  const rows = input.originalRows.get('productBuildArtifacts') as readonly ProductBuildArtifactRecordV1[]
  const runs = new Map((input.originalRows.get('agentRuns') as readonly AgentRunRecord[])
    .map(run => [run.id!, run]))
  const events = indexEvents(input.data)
  const portableRuns = new Map(input.data.agentRuns.map(run => [run._exportId, run]))
  for (const build of builds) {
    if (!['preview-ready', 'release-ready', 'released'].includes(build.status)
      || JSON.parse(build.planJson).productType !== 'text-open-world') continue
    const exportedId = input.exportIds.get('productBuilds')?.get(build.id!)
    const exported = input.data.productBuilds.find(row => row._exportId === exportedId)
    if (!exported || !build.rootTerminalReceiptHash) fail('封存 Build 导出身份缺失')
    const artifacts = rows.filter(row => row.buildId === build.id && row.controlEpoch === build.controlEpoch
      && ['accepted', 'carried-forward'].includes(row.status))
    const rootInput = receiptInput(build, artifacts)
    const rawRoot = await createProductBuildRootTerminalReceiptV1(rootInput)
    if (rawRoot === build.rootTerminalReceiptHash) {
      exported.rootBudgetEvidenceJson = await createProductBuildRootBudgetEvidenceV1({
        ...rootInput, expectedReceiptHash: build.rootTerminalReceiptHash,
      })
      continue
    }
    if (!build.rootBudgetEvidenceJson) {
      // Preserve the established diagnostic/archive path for a genuine legacy
      // seal. It grants no v2 envelope authority and cannot acquire this witness.
      const legacy = await verifyProductBuildRootTerminalReceiptV1({
        ...rootInput, expectedReceiptHash: build.rootTerminalReceiptHash,
      })
      if (legacy.valid && legacy.version === 1) continue
      fail('缺少原始 root 预算证据，不能从重映射后的账本补造')
    }
    const ledger = JSON.parse(build.budgetLedgerJson) as { rootRunId: number }
    const assertOwner = (run: AgentRunRecord | undefined, epoch: number, taskKey: string) => {
      if (!run || run.projectId !== build.projectId || run.workId !== build.workId
        || run.productBuildId !== build.id) fail('Run 不属于封存 Build')
      assertBoundary(run, { buildId: build.id!, buildNumber: build.buildNumber, epoch, taskKey,
        ...(epoch === build.controlEpoch ? { planHash: build.planHash } : {}) })
      return run
    }
    await verifyProductBuildRootBudgetEvidenceV1({
      ...rootInput, expectedReceiptHash: build.rootTerminalReceiptHash,
      evidenceJson: build.rootBudgetEvidenceJson,
      verifyCurrentRun: async ref => {
        const run = assertOwner(runs.get(ref.runId), ref.controlEpoch, ref.taskKey)
        if (ref.taskKey === '$root') {
          const portableId = input.exportIds.get('agentRuns')?.get(run.id!)
          const portable = portableId === undefined ? undefined : portableRuns.get(portableId)
          if (!portable || run.id !== ledger.rootRunId || run.parentRunId !== null
            || run.parentRelation !== null) fail('root 导出归属缺失')
          const proof = await verifyPortableCompletedAgentRunEvidenceV1(portable, events.get(portable._exportId) ?? [])
          if (proof.projection.terminalReceiptHash !== build.rootTerminalReceiptHash) fail('root 完成前缀不匹配')
        } else {
          const parent = assertOwner(runs.get(run.parentRunId!), ref.controlEpoch, '$root')
          if (run.parentRelation !== `task:${ref.taskKey}` || parent.parentRunId !== null
            || parent.parentRelation !== null
            || ref.controlEpoch === build.controlEpoch && parent.id !== ledger.rootRunId) {
            fail('task 父 root 不闭合')
          }
        }
      },
    })
    exported.rootBudgetEvidenceJson = build.rootBudgetEvidenceJson
  }
}

/** Temporary in-memory positive locators only; the registered backup bytes are unchanged. */
function positivePortableLedger(value: string): string {
  const ledger = JSON.parse(value)
  const positive = (id: unknown): number => {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) fail('便携 Run 定位无效')
    return id + 1
  }
  ledger.rootRunId = positive(ledger.rootRunId)
  for (const task of Object.values(ledger.tasks) as Array<{ runId: number }>) task.runId = positive(task.runId)
  for (const attempt of ledger.attempts as Array<{ runId: number }>) attempt.runId = positive(attempt.runId)
  return JSON.stringify(ledger)
}

/** Runs before any import write. Active seals require full closure; inactive bytes are audit-only. */
export async function verifyPortableProductBuildRootBudgetEvidenceV1(data: ProjectExportData): Promise<void> {
  const runs = new Map(data.agentRuns.map(run => [run._exportId, run]))
  const events = indexEvents(data)
  for (const build of data.productBuilds) {
    if (build.rootBudgetEvidenceJson === undefined) continue
    if (JSON.parse(build.planJson).productType !== 'text-open-world' || !build.rootTerminalReceiptHash) {
      fail('封存证据的产品或历史回执缺失')
    }
    if (!['preview-ready', 'release-ready', 'released'].includes(build.status)) {
      // Stop/archive invalidate the active epoch; discard may also orphan
      // Artifacts. Preserve canonical historical bytes without granting
      // resume, reuse, preview or publication authority.
      if (!['cancelled', 'archived'].includes(build.status)) fail('封存证据出现在非封存 Build')
      const retained = parseProductBuildRootBudgetEvidenceV1(build.rootBudgetEvidenceJson)
      if (retained.rootTerminalReceiptHash !== build.rootTerminalReceiptHash) fail('历史封存证据回执不匹配')
      continue
    }
    const budgetLedgerJson = positivePortableLedger(build._budgetLedgerPortableJson)
    const ledger = JSON.parse(budgetLedgerJson) as { rootRunId: number }
    const assertOwner = (run: PortableRun | undefined, ref: ProductBuildBudgetRunReferenceV1) => {
      if (!run || run._productBuildExportId !== build._exportId
        || run._workOwnerExportId !== build._workExportId) fail('便携 Run 跨越 Build/Work')
      assertBoundary(run, { buildId: build._exportId + 1, buildNumber: build.buildNumber,
        epoch: ref.controlEpoch, taskKey: ref.taskKey,
        ...(ref.controlEpoch === build.controlEpoch ? { planHash: build.planHash } : {}) })
      return run
    }
    const artifacts = data.productBuildArtifacts
      .filter(row => row._buildExportId === build._exportId && row.controlEpoch === build.controlEpoch
        && ['accepted', 'carried-forward'].includes(row.status))
      .map(row => ({ ...row, blobObjectId: row._blobObjectExportId == null ? null : row._blobObjectExportId + 1 }))
    await verifyProductBuildRootBudgetEvidenceV1({
      planHash: build.planHash, manifestHash: build.manifestHash, packageHash: build.packageHash,
      qualityReportHash: build.qualityReportHash, controlEpoch: build.controlEpoch, budgetLedgerJson,
      artifacts, expectedReceiptHash: build.rootTerminalReceiptHash, evidenceJson: build.rootBudgetEvidenceJson,
      verifyCurrentRun: async ref => {
        const run = assertOwner(runs.get(ref.runId - 1), ref)
        if (ref.taskKey === '$root') {
          if (ref.runId !== ledger.rootRunId || run._parentExportId !== null || run.parentRelation !== null) {
            fail('便携 root 归属无效')
          }
          const proof = await verifyPortableCompletedAgentRunEvidenceV1(run, events.get(run._exportId) ?? [])
          if (proof.projection.terminalReceiptHash !== build.rootTerminalReceiptHash) fail('便携 root 终态不匹配')
          return
        }
        const parent = assertOwner(runs.get(run._parentExportId!), { ...ref, taskKey: '$root' })
        if (run.parentRelation !== `task:${ref.taskKey}` || parent._parentExportId !== null
          || parent.parentRelation !== null
          || ref.controlEpoch === build.controlEpoch && parent._exportId + 1 !== ledger.rootRunId) {
          fail('便携 task 父 root 不闭合')
        }
      },
    })
  }
}
