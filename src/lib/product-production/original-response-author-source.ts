/** Offline source lineage for an explicitly authored revision of a retained original response. */
import { db } from '../db/schema'
import type { WorkspaceScope, ProductProductionCommandV1, ProductProductionCommandRecordV1,
  ProductProductionRecordV1, ProductBuildRecordV1, AgentRunRecord, AgentRunArtifactRecordV1 } from '../types'
import { readProductProductionDetailsV1 } from './service'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from './hash'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { prepareProductProductionOriginalResponseBookingV1, assertProductProductionOriginalBookingCurrentV1,
  type PreparedOriginalResponseBookingV1 } from './original-response-booking'
import { assertProductProductionBudgetLedgerV1, inspectProductProductionOriginalBookingBudgetV1 } from './scheduler'
import { parseProductProductionBriefV3 } from './contracts'
import { parseProductProductionPlanV3 } from './plan'

const SCHEMA = 'storyforge.product-production-original-response-author-source'
type Resolve = Extract<ProductProductionCommandV1, { type: 'resolve-blocker' }>
interface Evidence {
  schema: typeof SCHEMA; version: 1; portable: false
  owner: { scope: WorkspaceScope; productionId: number; buildId: number; buildNumber: number; taskKey: string }
  original: { runId: number; attempt: number; controlEpoch: number; planHash: string; contractHash: string; projectionHash: string }
  captured: { runId: number; contractHash: string; projectionHash: string; receiptHash: string; rawResponseHash: string }
  booking: { commandId: string; bookingHash: string; usage: unknown; disposition: string }
  evidenceRefs: Array<{ kind: AgentRunArtifactRecordV1['artifactKind']; hash: string }>
  authorRevisionCommandId: string; authorCommandPayloadHash: string; authorDraftHash: string
  targetControlEpoch: number; previousAuthorSourceHash: string | null
}
export interface ProductProductionOriginalAuthorSourceV1 {
  source: Evidence; sourceHash: string
}
export interface PreparedProductProductionOriginalAuthorSourceV1 extends ProductProductionOriginalAuthorSourceV1 {
  production: ProductProductionRecordV1
  build: ProductBuildRecordV1 & { id: number }
  bookingPreparation: PreparedOriginalResponseBookingV1 | null
  commands: ProductProductionCommandRecordV1[]
  runs: AgentRunRecord[]
  artifacts: AgentRunArtifactRecordV1[]
}
const equal = (a: unknown, b: unknown) => a != null && b != null
  && canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
function fail(message: string): never { throw new Error(`[original-response-author-source] ${message}`) }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('来源证明不是对象')
  return value as Record<string, unknown>
}
async function command(scope: WorkspaceScope, productionId: number, commandId: string, type: string) {
  const row = await db.productProductionCommands.where('[productionId+commandId]').equals([productionId, commandId]).first()
  if (!row || row.projectId !== scope.projectId || row.worldId !== scope.worldId || row.workId !== scope.workId
    || row.type !== type || row.status !== 'succeeded' || row.completedAt == null) fail('缺少原作者成功命令的准确回执')
  return row
}
async function verified(sourceValue: unknown, sourceHash: string, scope: WorkspaceScope, productionId: number,
  buildId: number, taskKey: string, targetEpoch: number) {
  const source = sourceValue as Evidence
  if (!source || source.schema !== SCHEMA || source.version !== 1 || source.portable !== false
    || !isSha256Hash(sourceHash) || await hashProductProductionValueV2(source) !== sourceHash
    || !equal(source.owner?.scope, scope) || source.owner?.productionId !== productionId
    || source.owner.buildId !== buildId || source.owner.taskKey !== taskKey || source.targetControlEpoch !== targetEpoch
    || !isSha256Hash(source.authorDraftHash) || !isSha256Hash(source.authorCommandPayloadHash)
    || !Array.isArray(source.evidenceRefs) || !source.evidenceRefs.length) fail('原作者来源证明已变化、过期或属于导入副本')
  const author = await command(scope, productionId, source.authorRevisionCommandId, 'resolve-blocker')
  const authorResult = object(JSON.parse(author.resultJson))
  if (author.payloadHash !== source.authorCommandPayloadHash || authorResult.originalResponseAuthorSourceHash !== sourceHash
    || !equal(authorResult.originalResponseAuthorSource, source) || authorResult.controlEpoch !== targetEpoch
    || authorResult.blockerKey !== taskKey || authorResult.action !== 'author-edit') fail('来源证明没有绑定原作者修订命令')
  const book = await command(scope, productionId, source.booking.commandId, 'book-original-response')
  const bookResult = object(JSON.parse(book.resultJson)), booking = object(bookResult.originalResponseBooking)
  if (await hashProductProductionValueV2(booking) !== source.booking.bookingHash || booking.blocked !== false
    || booking.originalRunId !== source.original.runId || booking.originalAttempt !== source.original.attempt
    || booking.captureRunId !== source.captured.runId || booking.captureReceiptHash !== source.captured.receiptHash
    || booking.rawResponseHash !== source.captured.rawResponseHash || !equal(booking.usage, source.booking.usage)) fail('原用量核对证明已变化')
  const original = await readAgentRunV1(scope, source.original.runId), captured = await readAgentRunV1(scope, source.captured.runId)
  if (!['failed', 'cancelled'].includes(original.run.status) || captured.run.status !== 'completed'
    || original.run.productBuildId !== buildId || captured.run.productBuildId !== buildId
    || original.run.contractHash !== source.original.contractHash || original.run.projectionHash !== source.original.projectionHash
    || captured.run.contractHash !== source.captured.contractHash || captured.run.projectionHash !== source.captured.projectionHash
    || captured.projection.terminalReceiptHash !== source.captured.receiptHash
    || original.contract.scope.productProduction?.taskKey !== taskKey
    || original.contract.scope.productProduction.controlEpoch !== source.original.controlEpoch
    || original.contract.scope.productProduction.planHash !== source.original.planHash
    || original.projection.steps[taskKey]?.attempt !== source.original.attempt) fail('原请求或保留 Run 的终态证据不一致')
  const artifacts: AgentRunArtifactRecordV1[] = []
  for (const ref of source.evidenceRefs) {
    await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: ref.kind, contentHash: ref.hash })
    const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([scope.projectId, ref.kind, ref.hash]).first()
    if (!row || row.retentionState !== 'available' || row.content == null) fail('原完整证据不可用')
    artifacts.push(row)
  }
  const raw = await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'raw-response', contentHash: source.captured.rawResponseHash })
  if (await sha256Text(raw) !== source.captured.rawResponseHash) fail('原回答字节不一致')
  return { source, commands: [author, book], runs: [original.run, captured.run], artifacts }
}

/** Null preserves the existing author-edit path; no inference from similar raw text or hashes. */
export async function prepareProductProductionOriginalAuthorSourceV1(input: {
  scope: WorkspaceScope; productionId: number; command: Resolve; payloadHash: string; now: number
}): Promise<PreparedProductProductionOriginalAuthorSourceV1 | null> {
  const { command: cmd, scope, productionId } = input, ref = cmd.resolution.originalResponseSource
  if (cmd.resolution.action !== 'author-edit') {
    if (ref) fail('原来源证明只用于明确作者修订')
    return null
  }
  const details = await readProductProductionDetailsV1(scope, productionId)
  const { production, build } = details
  if (production.productType !== 'ttrpg') { if (ref) fail('此来源只用于跑团'); return null }
  if (!build?.id || build.status !== 'recovery-required') { if (ref) fail('当前不在作者恢复阶段'); return null }
  const failure = object(JSON.parse(build.failureJson)), provenance = object(failure.failureProvenance)
  let source: Evidence, bookingPreparation: PreparedOriginalResponseBookingV1 | null = null
  let commands: ProductProductionCommandRecordV1[], runs: AgentRunRecord[], artifacts: AgentRunArtifactRecordV1[]
  if (ref) {
    const booking = object(failure.originalResponseBooking)
    if (booking.captureRunId !== ref.captureRunId || booking.captureReceiptHash !== ref.captureReceiptHash
      || booking.blocked !== false || cmd.resolution.unknownResultReservation) fail('请先核对当前完整原回答用量；不能同时另选未知费用处置')
    bookingPreparation = await prepareProductProductionOriginalResponseBookingV1({ scope, productionId, now: input.now,
      command: { type: 'book-original-response', commandId: String(booking.commandId), expectedStateRevision: cmd.expectedStateRevision,
        buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: build.planHash, taskKey: cmd.blockerKey,
        originalRunId: Number(provenance.runId), originalAttempt: Number(provenance.attempt),
        captureRunId: ref.captureRunId, captureReceiptHash: ref.captureReceiptHash,
        disposition: booking.effectiveDisposition === 'provider-actual-charge' ? 'use-native-token-usage' : 'charge-reservation-upper-bound' } })
    if (!bookingPreparation.alreadyBooked || bookingPreparation.booking.blocked) fail('准确原用量尚未完成独立记账')
    const book = await command(scope, productionId, String(booking.commandId), 'book-original-response')
    if (!equal(object(JSON.parse(book.resultJson)).originalResponseBooking, bookingPreparation.booking)) fail('原记账命令回执不一致')
    commands = [book]; runs = bookingPreparation.runs; artifacts = bookingPreparation.artifacts
    source = {
      schema: SCHEMA, version: 1, portable: false,
      owner: { scope, productionId, buildId: build.id, buildNumber: build.buildNumber, taskKey: cmd.blockerKey },
      original: { runId: runs[0].id!, attempt: Number(provenance.attempt), controlEpoch: build.controlEpoch,
        planHash: build.planHash, contractHash: runs[0].contractHash, projectionHash: runs[0].projectionHash },
      captured: { runId: ref.captureRunId, contractHash: runs[1].contractHash, projectionHash: runs[1].projectionHash,
        receiptHash: ref.captureReceiptHash, rawResponseHash: String(booking.rawResponseHash) },
      booking: { commandId: book.commandId, bookingHash: await hashProductProductionValueV2(booking),
        usage: booking.usage, disposition: String(booking.effectiveDisposition) },
      evidenceRefs: artifacts.map(row => ({ kind: row.artifactKind, hash: row.contentHash })),
      authorRevisionCommandId: cmd.commandId, authorCommandPayloadHash: input.payloadHash,
      authorDraftHash: await sha256Text(cmd.resolution.authorDraftJson!), targetControlEpoch: build.controlEpoch + 1,
      previousAuthorSourceHash: null,
    }
  } else {
    // Only the explicit successful author command that produced this exact failed
    // epoch can pass retained provenance to another author revision. Never scan raw.
    const previous = (await db.productProductionCommands.where('productionId').equals(productionId).toArray())
      .filter(row => row.type === 'resolve-blocker' && row.status === 'succeeded')
      .map(row => ({ row, result: object(JSON.parse(row.resultJson)) }))
      .filter(({ result }) => result.controlEpoch === build.controlEpoch && result.blockerKey === cmd.blockerKey
        && result.action === 'author-edit' && result.originalResponseAuthorSource != null)
    if (!previous.length) return null
    if (previous.length !== 1) fail('当前失败轮次存在相互冲突的作者来源')
    const prior = previous[0].result
    const checked = await verified(prior.originalResponseAuthorSource, String(prior.originalResponseAuthorSourceHash), scope,
      productionId, build.id, cmd.blockerKey, build.controlEpoch)
    source = { ...checked.source, authorRevisionCommandId: cmd.commandId, authorCommandPayloadHash: input.payloadHash,
      authorDraftHash: await sha256Text(cmd.resolution.authorDraftJson!), targetControlEpoch: build.controlEpoch + 1,
      previousAuthorSourceHash: String(prior.originalResponseAuthorSourceHash) }
    commands = checked.commands; runs = checked.runs; artifacts = checked.artifacts
  }
  if (production.stateRevision !== cmd.expectedStateRevision || production.controlEpoch !== build.controlEpoch
    || failure.taskKey !== cmd.blockerKey || provenance.controlEpoch !== build.controlEpoch) fail('作者修订的作品或原失败已变化')
  const failed = await readAgentRunV1(scope, Number(provenance.runId))
  if (failed.run.status !== 'failed' || failed.run.productBuildId !== build.id
    || failed.contract.scope.productProduction?.taskKey !== cmd.blockerKey
    || failed.contract.scope.productProduction.controlEpoch !== build.controlEpoch
    || failed.contract.scope.productProduction.planHash !== build.planHash || provenance.planHash !== build.planHash
    || failed.projection.steps[cmd.blockerKey]?.attempt !== provenance.attempt) fail('当前作者失败尝试不一致')
  runs = [...runs.filter(row => row.id !== failed.run.id), failed.run]
  const briefRow = details.briefHistory.find(row => row.revision === build.briefRevision)
  if (!briefRow || briefRow.briefHash !== build.briefHash) fail('原授权 Brief 不一致')
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  if (await hashProductProductionValueV2(brief) !== build.briefHash
    || await hashProductProductionValueV2(plan) !== build.planHash) fail('原授权 Brief 或冻结 Plan 正文不一致')
  const budget = inspectProductProductionOriginalBookingBudgetV1({ budgetLedgerJson: build.budgetLedgerJson,
    brief, plan, taskKey: cmd.blockerKey, controlEpoch: build.controlEpoch })
  if (budget.blocked) fail('旧授权不足，不能用作者修订绕过已消费用量')
  return { source, sourceHash: await hashProductProductionValueV2(source), production,
    build: build as ProductBuildRecordV1 & { id: number }, bookingPreparation, commands, runs, artifacts }
}

/** Inside the existing owner-derived command transaction. */
export async function assertProductProductionOriginalAuthorSourceCurrentV1(prepared: PreparedProductProductionOriginalAuthorSourceV1,
  production: ProductProductionRecordV1, build: ProductBuildRecordV1) {
  if (!equal(production, prepared.production) || !equal(build, prepared.build)) fail('作品或原授权在修订期间已变化')
  if (prepared.bookingPreparation) await assertProductProductionOriginalBookingCurrentV1(prepared.bookingPreparation, production, build)
  for (const before of prepared.commands) if (!equal(await db.productProductionCommands.get(before.id!), before)) fail('原作者或记账回执已变化')
  for (const before of prepared.runs) if (!equal(await db.agentRuns.get(before.id!), before)) fail('原失败或保留 Run 已变化')
  for (const before of prepared.artifacts) if (!equal(await db.agentRunArtifacts.get(before.id!), before)) fail('原回答证据已变化')
}

/** Revalidate the persisted author command without native transport or fee mutations. */
export async function readProductProductionOriginalAuthorSourceForExecutionV1(input: {
  scope: WorkspaceScope; productionId: number; build: { id: number; controlEpoch: number; failureJson: string }; taskKey: string
}): Promise<(ProductProductionOriginalAuthorSourceV1 & { evidenceJson: string; authorDraftJson: string }) | null> {
  const state = object(JSON.parse(input.build.failureJson))
  if (state.blockerKey !== input.taskKey || state.originalResponseAuthorSource == null) return null
  const resolution = object(state.resolution), value = object(state.originalResponseAuthorSource)
  if (resolution.action !== 'author-edit' || typeof resolution.authorDraftJson !== 'string') fail('原来源没有当前明确作者修订')
  const checked = await verified(value.source, String(value.sourceHash), input.scope, input.productionId,
    input.build.id, input.taskKey, input.build.controlEpoch)
  if (checked.source.authorRevisionCommandId !== state.commandId
    || await sha256Text(resolution.authorDraftJson) !== checked.source.authorDraftHash) fail('作者修订正文与原来源证明不一致')
  const build = await db.productBuilds.get(input.build.id)
  if (!build || build.controlEpoch !== input.build.controlEpoch || build.failureJson !== input.build.failureJson) fail('执行前作者修订已过期')
  assertProductProductionBudgetLedgerV1(build.budgetLedgerJson)
  const attempt = JSON.parse(build.budgetLedgerJson).attempts.find((row: { runId: number; attempt: number; controlEpoch: number; taskKey: string }) =>
    row.runId === checked.source.original.runId && row.attempt === checked.source.original.attempt
    && row.controlEpoch === checked.source.original.controlEpoch && row.taskKey === input.taskKey)
  if (!attempt?.usageKnown || !equal(attempt.usage, checked.source.booking.usage)) fail('原已核用量在执行前发生变化')
  return { source: checked.source, sourceHash: String(value.sourceHash), evidenceJson: canonicalProductProductionJsonV2(checked.source),
    authorDraftJson: resolution.authorDraftJson }
}

type RejectedAuthorDraftReadV1 = {
  scope: WorkspaceScope; productionId: number; buildId: number; taskKey: string; controlEpoch: number
  planHash: string; runId: number; attempt: number
}
/** Re-read only this exact failed task/attempt's retained source bodies. */
async function readRejectedAuthorDraftRowsV1(input: RejectedAuthorDraftReadV1) {
  const details = await readProductProductionDetailsV1(input.scope, input.productionId, ['ttrpg'])
  const build = details.build
  if (!build || build.id !== input.buildId || build.status !== 'recovery-required'
    || build.controlEpoch !== input.controlEpoch || build.planHash !== input.planHash) fail('作者修订原稿不属于当前失败轮次')
  const failure = object(JSON.parse(build.failureJson)), provenance = object(failure.failureProvenance)
  const snapshot = await readAgentRunV1(input.scope, input.runId), binding = snapshot.contract.scope.productProduction
  if (failure.code !== 'task-draft-rejected' || failure.taskKey !== input.taskKey
    || provenance.runId !== input.runId || provenance.attempt !== input.attempt
    || provenance.controlEpoch !== input.controlEpoch || provenance.planHash !== input.planHash
    || snapshot.run.status !== 'failed' || snapshot.run.productBuildId !== input.buildId
    || binding?.taskKey !== input.taskKey || binding.controlEpoch !== input.controlEpoch || binding.planHash !== input.planHash
    || snapshot.projection.steps[input.taskKey]?.attempt !== input.attempt) fail('作者修订原稿缺少准确失败 Run/attempt')
  const rows: Array<{ hash: string; content: string }> = []
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot'
      || event.payload.stepId !== input.taskKey || event.payload.attempt !== input.attempt
      || rows.some(row => row.hash === event.payload.contentHash)) continue
    rows.push({ hash: event.payload.contentHash, content: await readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
      artifactKind: 'source-snapshot', contentHash: event.payload.contentHash }) })
  }
  return { snapshot, rows }
}

/** Re-read only the explicit authored source snapshot of this exact failed task. */
export async function readProductProductionRejectedOriginalAuthorDraftV1(input: RejectedAuthorDraftReadV1): Promise<string | null> {
  const { rows } = await readRejectedAuthorDraftRowsV1(input)
  const sources = rows.filter(row => { try { return JSON.parse(row.content)?.schema === SCHEMA } catch { return false } })
  if (!sources.length) return null
  if (sources.length !== 1) fail('作者修订来源证明冲突')
  const checked = await verified(JSON.parse(sources[0].content), sources[0].hash, input.scope, input.productionId,
    input.buildId, input.taskKey, input.controlEpoch)
  const draft = rows.find(row => row.hash === checked.source.authorDraftHash)
  if (!draft || await sha256Text(draft.content) !== checked.source.authorDraftHash) fail('作者原修订稿缺失或字节变化')
  return draft.content
}

/** Input recovery only. This body never proves model output, adoption or author confirmation. */
export async function readProductProductionRejectedAuthorInputV1(input: RejectedAuthorDraftReadV1): Promise<string | null> {
  const { snapshot, rows } = await readRejectedAuthorDraftRowsV1(input)
  if (snapshot.events.some(event => event.type === 'model.requested' && event.payload.stepId === input.taskKey
    && event.payload.attempt === input.attempt)) return null
  const schema = input.taskKey === 'ttrpg.open.source-facts' ? 'storyforge.ttrpg-open-source-facts'
    : input.taskKey === 'ttrpg.open.rule-system' ? 'storyforge.ttrpg-open-rule-system' : null
  if (schema == null) return null
  const drafts = [...new Set(rows.filter(row => { try { return JSON.parse(row.content)?.schema === schema } catch { return false } }).map(row => row.content))]
  if (drafts.length > 1) fail('保留的作者输入存在不同版本，请先核对原制作记录')
  const after = await readAgentRunV1(input.scope, input.runId)
  if (after.run.contractHash !== snapshot.run.contractHash || after.run.projectionHash !== snapshot.run.projectionHash
    || after.run.lastSequence !== snapshot.run.lastSequence) fail('作者输入读取期间原 Run 已变化')
  return drafts[0] ?? null
}
