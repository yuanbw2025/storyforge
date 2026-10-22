/** Original published RootV2 identity across registered backup ID rebinding. */
import { db } from '../db/schema'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { PROJECT_TABLES } from '../registry/project-tables'
import { readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { replayAgentRunEventsV1 } from '../agent/run/projection'
import { assertRecordInScope } from '../workspace/scope'
import type { AgentRunRecord, ProductBuildRecordV1, ProductProductionRecordV1, WorkspaceScope } from '../types'
import { canonicalProductProductionJsonV2 as canonical, hashProductProductionValueV2 as hash, isSha256Hash } from './hash'
import { projectProductBuildRootTerminalReceiptBodyV2, type ProductBuildRootTerminalReceiptInputV1 } from './receipts'
import { parseProductProductionPlanV3 } from './plan'
import { parseProductProductionPortableTaskLedgerV1 } from './task-evidence'
import { verifyProductReleaseManifestV1 } from './runtime-package'

type RootBody = Awaited<ReturnType<typeof projectProductBuildRootTerminalReceiptBodyV2>>
interface PublishedRootOriginV1 {
  schema: 'storyforge.product-production-published-root-origin'
  version: 1
  productionKey: string
  buildNumber: number
  rootTerminalReceiptHash: string
  body: RootBody
}
function fail(message: string): never { throw new Error(`[published-root-origin] ${message}`) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('证明对象损坏')
  return value as Record<string, unknown>
}
export async function assertPortablePublishedRootOriginV1(json: string): Promise<PublishedRootOriginV1> {
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > 8_000_000) fail('原封存证明超过便携预算')
  const value = record(JSON.parse(json))
  const keys = ['schema', 'version', 'productionKey', 'buildNumber', 'rootTerminalReceiptHash', 'body']
  if (Object.keys(value).sort().join() !== keys.sort().join()
    || value.schema !== 'storyforge.product-production-published-root-origin' || value.version !== 1
    || typeof value.productionKey !== 'string' || !value.productionKey.trim() || value.productionKey.length > 200
    || !Number.isSafeInteger(value.buildNumber) || Number(value.buildNumber) < 1
    || !isSha256Hash(value.rootTerminalReceiptHash)) fail('原封存证明字段无效')
  const body = record(value.body)
  const bodyKeys = ['schema', 'version', 'planHash', 'manifestHash', 'packageHash', 'qualityReportHash', 'controlEpoch', 'budgetLedger', 'artifactEnvelopes']
  if (Object.keys(body).sort().join() !== bodyKeys.sort().join()
    || body.schema !== 'storyforge.product-build-root-terminal-receipt' || body.version !== 2
    || ![body.planHash, body.manifestHash, body.packageHash, body.qualityReportHash].every(isSha256Hash)
    || !Number.isSafeInteger(body.controlEpoch) || Number(body.controlEpoch) < 0
    || !Array.isArray(body.artifactEnvelopes) || body.artifactEnvelopes.length > 20_000
    || await sha256Text(canonical(body)) !== value.rootTerminalReceiptHash) fail('原封存 preimage/hash 不一致')
  record(body.budgetLedger)
  return value as unknown as PublishedRootOriginV1
}

/** Compare every byte-semantic field; only PROJECT_TABLES-declared references may be rebound. */
export function comparePublishedRootLedgerRebindingV1(original: unknown, current: unknown): Map<number, number> {
  const spec = PROJECT_TABLES.find(spec => spec.name === 'productBuilds')?.exportRefRemap
    ?.find(ref => ref.field === 'budgetLedgerJson' && ref.kind === 'json-id-paths' && ref.remapVia === 'agentRuns')
  if (!spec || spec.kind !== 'json-id-paths') fail('预算引用注册缺失')
  const paths = spec.paths.map(path => path.split('.'))
  const matches = (parts: readonly string[], pattern: readonly string[]) => parts.length === pattern.length
    && parts.every((part, index) => pattern[index] === '*' || part === pattern[index])
  const isRef = (parts: readonly string[]) => paths.some(pattern => matches(parts, pattern))
  const forward = new Map<number, number>(), reverse = new Map<number, number>()
  const walk = (left: unknown, right: unknown, path: string[]): void => {
    if (isRef(path)) {
      if (!Number.isSafeInteger(left) || Number(left) < 1 || !Number.isSafeInteger(right) || Number(right) < 1) fail('原/当前 Run 引用无效')
      const a = Number(left), b = Number(right)
      if ((forward.has(a) && forward.get(a) !== b) || (reverse.has(b) && reverse.get(b) !== a)) fail('Run 引用别名不是双射')
      forward.set(a, b); reverse.set(b, a); return
    }
    const keyed = spec.keyedMaps?.find(keyed => matches(path, keyed.path.split('.')))
    if (keyed) {
      const rows = (value: unknown) => Object.entries(record(value)).map(([key, raw]) => {
        const row = record(raw)
        if (key !== keyed.keyFields.map(field => row[field]).join(keyed.separator)) fail('预算 keyed map 与实际引用不一致')
        const sortRow = Object.fromEntries(Object.entries(row).filter(([key]) => !isRef([...path, '*', key])))
        return { row, sortKey: canonical(sortRow) }
      }).sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      const a = rows(left), b = rows(right)
      if (a.length !== b.length) fail('预算 keyed map 集合变化')
      for (let i = 0; i < a.length; i++) walk(a[i].row, b[i].row, [...path, '*'])
      return
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) fail('封存数组变化')
      for (let i = 0; i < left.length; i++) walk(left[i], right[i], [...path, String(i)])
      return
    }
    if (left !== null && typeof left === 'object' || right !== null && typeof right === 'object') {
      const a = record(left), b = record(right), keys = Object.keys(a).sort()
      if (canonical(keys) !== canonical(Object.keys(b).sort())) fail('封存对象字段变化')
      for (const key of keys) walk(a[key], b[key], [...path, key])
      return
    }
    if (left !== right) fail(`封存字段变化:${path.join('.')}`)
  }
  walk(original, current, [])
  return forward
}

function importedOriginalReceipt(root: AgentRunSnapshotV1, expectedHash: string): boolean {
  // A copied opaque JSON value alone has no authority. Require the strict replayed
  // completed prefix and actual import invalidation, followed only by our verifier.
  const stale = [...root.events].reverse().find(event => event.type === 'verification.staled')
  if (stale?.type !== 'verification.staled' || stale.payload.reason !== 'project-import-scope-rebound'
    || stale.payload.previousReceiptHash !== expectedHash) return false
  const prefix = replayAgentRunEventsV1(root.events.filter(event => event.sequence < stale.sequence))
  if (prefix.errors.length || prefix.state !== 'completed' || prefix.terminalReceiptHash !== expectedHash) return false
  const after = root.events.filter(event => event.sequence > stale.sequence)
  if (after.length === 0) return root.projection.state === 'running'
  if (after.length === 1) return after[0].type === 'verification.started'
    && after[0].payload.verifierSetVersion === 'product-production-root-published-origin-rebind-v1'
    && root.projection.state === 'verifying'
  const settlement = root.projection.memorySettlement
  return after.length === 3 && after[0].type === 'verification.started'
    && after[0].payload.verifierSetVersion === 'product-production-root-published-origin-rebind-v1'
    && after[1].type === 'verification.accepted' && after[1].payload.receiptHash === expectedHash
    // The existing event-store terminal writer appends its mandatory settlement
    // atomically. Retain that exact suffix rather than ignoring arbitrary events.
    && after[2].type === 'memory.settlement.recorded' && after[2].payload.terminalReceiptHash === expectedHash
    && settlement?.receiptHash === after[2].payload.receiptHash && settlement.terminalReceiptHash === expectedHash
    && settlement.recordedAt === after[2].createdAt && settlement.state === after[2].payload.state
    && settlement.artifactIndexHash === after[2].payload.artifactIndexHash
    && settlement.workspaceDirty === after[2].payload.workspaceDirty
    && root.projection.state === 'completed' && root.projection.terminalReceiptHash === expectedHash
}

type Context = { scope: WorkspaceScope; production: ProductProductionRecordV1; build: ProductBuildRecordV1 & { id: number }; root: AgentRunSnapshotV1 }
async function assertPublishedOwner(input: Context, body: RootBody): Promise<void> {
  const { scope, production, build, root } = input, boundary = root.contract.scope.productProduction
  if (production.productType !== 'ttrpg' || build.status !== 'released' || build.productionId !== production.id
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || root.run.productBuildId !== build.id || root.run.parentRunId != null || root.run.parentRelation != null
    || !boundary || boundary.productBuildId !== build.id || boundary.buildNumber !== build.buildNumber
    || boundary.controlEpoch !== build.controlEpoch || boundary.planHash !== build.planHash || boundary.taskKey !== '$root') fail('原封存 root owner 不一致')
  const release = build.releasedProductReleaseId != null ? await db.productReleases.get(build.releasedProductReleaseId) : undefined
  if (!release || !await assertRecordInScope(scope, 'productReleases', release, { owner: 'work' })) fail('原封存发行记录缺失')
  const manifest = await verifyProductReleaseManifestV1(release.manifestJson, { ttrpgProtocol: 2 })
  const provenance = manifest.productionProvenance
  if (release.contentHash !== await hash(manifest) || manifest.productType !== 'ttrpg'
    || provenance?.productionKey !== production.productionKey || provenance.buildNumber !== build.buildNumber
    || provenance.buildManifestHash !== build.manifestHash || provenance.rootTerminalReceiptHash !== build.rootTerminalReceiptHash
    || body.planHash !== build.planHash || body.manifestHash !== build.manifestHash || body.packageHash !== build.packageHash
    || body.qualityReportHash !== build.qualityReportHash || body.controlEpoch !== build.controlEpoch) fail('原封存 Build/发行指针不闭合')
  const plan = parseProductProductionPlanV3(build.planJson, undefined, build.briefHash)
  const tasks = parseProductProductionPortableTaskLedgerV1({ budgetLedgerJson: canonical(body.budgetLedger), plan })
  const outputHash = await hash({ manifestHash: build.manifestHash, taskReceipts: plan.tasks.map(task => ({
    taskKey: task.taskKey, receiptHash: tasks.find(row => row.taskKey === task.taskKey)!.terminalReceiptHash,
  })) })
  const step = root.projection.steps['$join']
  if (step?.status !== 'succeeded' || step.attempt !== 1 || step.outputHash !== outputHash) fail('原 root join 未证明完整任务集合')
}

async function assertRunGraph(input: Context, ledger: Record<string, unknown>, ids: ReadonlyMap<number, number>): Promise<void> {
  const tasks = record(ledger.tasks), rootId = Number(ledger.rootRunId)
  if (rootId !== input.root.run.id) fail('预算 root 不是当前 owner')
  const attempts = Array.isArray(ledger.attempts) ? ledger.attempts.map(record) : []
  const rows = new Map<number, AgentRunSnapshotV1>()
  for (const id of ids.values()) {
    const run = await readAgentRunV1(input.scope, id), boundary = run.contract.scope.productProduction
    if (run.run.productBuildId !== input.build.id || !boundary || boundary.productBuildId !== input.build.id
      || boundary.buildNumber !== input.build.buildNumber) fail('重绑 Run 跨 Build')
    rows.set(id, run)
  }
  const anchored = new Set<number>([rootId])
  for (const [taskKey, raw] of Object.entries(tasks)) {
    const entry = record(raw), run = rows.get(Number(entry.runId)), boundary = run?.contract.scope.productProduction
    if (!run || !boundary || boundary.taskKey !== taskKey || boundary.controlEpoch !== input.build.controlEpoch
      || boundary.planHash !== input.build.planHash || run.run.parentRunId !== rootId
      || run.projection.steps[taskKey]?.attempt !== entry.attempt) fail('当前任务 Run/epoch/attempt 不一致')
    anchored.add(run.run.id)
  }
  for (const attempt of attempts) {
    const run = rows.get(Number(attempt.runId)), boundary = run?.contract.scope.productProduction
    if (!run || !boundary || boundary.taskKey !== attempt.taskKey || boundary.controlEpoch !== attempt.controlEpoch
      || !run.events.some(event => event.type === 'step.started' && event.payload.stepId === attempt.taskKey && event.payload.attempt === attempt.attempt)) fail('历史任务 Run/epoch/attempt 不一致')
    anchored.add(run.run.id)
  }
  if ([...rows.keys()].some(id => !anchored.has(id))) fail('未绑定的预算 Run 引用')
}

/** Explicit local revalidation: retains the immutable published identity, not a new publication. */
export async function verifyImportedPublishedRootOriginV1(input: Context & { receiptInput: ProductBuildRootTerminalReceiptInputV1 }): Promise<boolean> {
  const json = input.root.run.portablePublishedRootOriginJson
  if (json === undefined) return false
  const origin = await assertPortablePublishedRootOriginV1(json)
  if (origin.productionKey !== input.production.productionKey || origin.buildNumber !== input.build.buildNumber
    || origin.rootTerminalReceiptHash !== input.build.rootTerminalReceiptHash
    || !importedOriginalReceipt(input.root, origin.rootTerminalReceiptHash)) fail('原封存证明没有真实导入完成态前缀')
  const body = await projectProductBuildRootTerminalReceiptBodyV2(input.receiptInput)
  const { budgetLedger: oldLedger, ...oldBody } = origin.body, { budgetLedger: ledger, ...localBody } = body
  if (canonical(oldBody) !== canonical(localBody)) fail('原封存 Artifact envelope 或终端指针变化')
  const ids = comparePublishedRootLedgerRebindingV1(oldLedger, ledger)
  await assertPublishedOwner(input, body)
  await assertRunGraph(input, record(ledger), ids)
  return true
}

/** Full-workspace export only. Existing imported evidence is carried; never invented after ID loss. */
export async function freezePublishedRootOriginForExportV1(runId: number): Promise<string | undefined> {
  const row = await db.agentRuns.get(runId)
  if (!row?.productBuildId || row.workId == null || row.parentRunId != null) return row?.portablePublishedRootOriginJson
  const build = await db.productBuilds.get(row.productBuildId), work = await db.works.get(row.workId)
  const production = build && await db.productProductions.get(build.productionId)
  if (!build?.id || !production || production.productType !== 'ttrpg' || build.status !== 'released' || !work) return row.portablePublishedRootOriginJson
  if (Number(JSON.parse(build.budgetLedgerJson).rootRunId) !== runId) return row.portablePublishedRootOriginJson
  const scope = { projectId: row.projectId, worldId: work.worldId, workId: row.workId }
  const root = await readAgentRunV1(scope, runId)
  const artifacts = (await db.productBuildArtifacts.where('buildId').equals(build.id).toArray())
    .filter(row => row.controlEpoch === build.controlEpoch && ['accepted', 'carried-forward'].includes(row.status))
  const receiptInput = { planHash: build.planHash, manifestHash: build.manifestHash, packageHash: build.packageHash,
    qualityReportHash: build.qualityReportHash, controlEpoch: build.controlEpoch, budgetLedgerJson: build.budgetLedgerJson, artifacts }
  const context = { scope, production, build: build as ProductBuildRecordV1 & { id: number }, root, receiptInput }
  if (row.portablePublishedRootOriginJson !== undefined) {
    await verifyImportedPublishedRootOriginV1(context)
    return row.portablePublishedRootOriginJson
  }
  if (root.events.some(event => event.type === 'verification.staled' && event.payload.reason === 'project-import-scope-rebound')) return undefined
  const body = await projectProductBuildRootTerminalReceiptBodyV2(receiptInput), receiptHash = await hash(body)
  // Legacy or otherwise unproven source rows remain exportable as data.
  // Absence cannot manufacture a V2 origin or grant recovery/publication rights.
  if (root.projection.state !== 'completed' || root.projection.terminalReceiptHash !== receiptHash || build.rootTerminalReceiptHash !== receiptHash) return undefined
  await assertPublishedOwner(context, body)
  const origin: PublishedRootOriginV1 = { schema: 'storyforge.product-production-published-root-origin', version: 1,
    productionKey: production.productionKey, buildNumber: build.buildNumber, rootTerminalReceiptHash: receiptHash, body }
  const json = canonical(origin)
  await assertPortablePublishedRootOriginV1(json)
  return json
}

/** Import structure validation does not grant revalidation or publication authority. */
export async function assertImportedPublishedRootOriginOwnerV1(run: AgentRunRecord): Promise<void> {
  if (run.portablePublishedRootOriginJson === undefined) return
  const origin = await assertPortablePublishedRootOriginV1(run.portablePublishedRootOriginJson)
  const contract = record(JSON.parse(run.contractJson)), boundary = record(record(contract.scope).productProduction)
  if (run.workId == null || run.productRuntimeSessionId != null || run.productBuildId == null
    || run.parentRunId != null || boundary.taskKey !== '$root' || boundary.productBuildId !== run.productBuildId
    || boundary.buildNumber !== origin.buildNumber || boundary.planHash !== origin.body.planHash
    || boundary.controlEpoch !== origin.body.controlEpoch) fail('导入原封存证明 owner 无效')
}
