/** Exact local transport evidence for one already-authorized TTRPG task.
 * Reading a receipt never grants dispatch, accounting, candidate or adoption. */
import { db } from '../db/schema'
import type { ChatMessage, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1, recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { canonicalStringify } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { acknowledgeBoundCodexReceiptV1, readBoundCodexReceiptV1,
  CODEX_DURABLE_RECEIPT_RETENTION_V1, CODEX_REQUEST_HASH_ALGORITHM_V1,
  type CodexRequestRefV1, type CodexReceipt } from '../ai/codex-transport'

const REQUEST = 'storyforge.product-production-local-request'
const RESPONSE = 'storyforge.product-production-local-response'
const HANDOFF = 'storyforge.product-production-local-handoff'
const TASKS = new Set(['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer', 'ttrpg.open.media-plan'])
export function supportsProductProductionLocalRequestV1(taskKey: string): boolean { return TASKS.has(taskKey) }

export interface ProductProductionLocalRequestOwnerV1 {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  runId: number
  taskKey: string
  attempt: number
  controlEpoch: number
  planHash: string
  idempotencyKey: string
  expectedCapabilityHash: string
}
interface RequestEvidence {
  schema: typeof REQUEST
  version: 1
  portable: false
  owner: ProductProductionLocalRequestOwnerV1
  contractHash: string
  request: CodexRequestRefV1
  messages: ChatMessage[]
  responseFormat: 'json_object'
}
interface ResponseEvidence {
  schema: typeof RESPONSE
  version: 1
  requestHash: string
  rawResponseHash: string
  status: 'completed'
  usage: CodexReceipt['usage'] | null
}
function fail(message: string): never { throw new Error(`[production-local-request] ${message}`) }
function imported(snapshot: AgentRunSnapshotV1) {
  return snapshot.events.some(event => (event.type === 'run.cancelled' && event.payload.reason === 'project-import-nonportable-checkpoint')
    || (event.type === 'verification.staled' && event.payload.reason === 'project-import-scope-rebound'))
}

async function owned(owner: ProductProductionLocalRequestOwnerV1, preparing: boolean) {
  const [snapshot, build, production] = await Promise.all([
    readAgentRunV1(owner.scope, owner.runId), db.productBuilds.get(owner.buildId), db.productProductions.get(owner.productionId),
  ])
  const boundary = snapshot.contract.scope.productProduction, step = snapshot.projection.steps[owner.taskKey]
  if (!TASKS.has(owner.taskKey) || !build || !production || production.productType !== 'ttrpg'
    || build.productionId !== production.id || snapshot.run.productBuildId !== build.id
    || !await assertRecordInScope(owner.scope, 'productBuilds', build, { owner: 'work' })
    || !await assertRecordInScope(owner.scope, 'productProductions', production, { owner: 'work' })
    || boundary?.productBuildId !== owner.buildId || boundary.taskKey !== owner.taskKey
    || boundary.controlEpoch !== owner.controlEpoch || boundary.planHash !== owner.planHash
    || !snapshot.run.parentRunId || !step || step.attempt < owner.attempt
    || (preparing && step.attempt !== owner.attempt) || imported(snapshot)
    || !snapshot.events.some(event => event.type === 'model.requested'
      && event.payload.stepId === owner.taskKey && event.payload.attempt === owner.attempt)
    || !/^[a-f0-9]{64}$/.test(owner.idempotencyKey) || !/^[a-f0-9]{64}$/.test(owner.expectedCapabilityHash)) {
    fail('本机请求不属于原作品、Build、Run 或尝试；不能发送或关联')
  }
  const { assertProductProductionBudgetLedgerV1 } = await import('./scheduler')
  assertProductProductionBudgetLedgerV1(build.budgetLedgerJson)
  const ledger = JSON.parse(build.budgetLedgerJson)
  const current = ledger.tasks[owner.taskKey]
  const exact = (row: { runId: number; attempt: number; idempotencyKey: string }) => row.runId === owner.runId
    && row.attempt === owner.attempt && row.idempotencyKey === owner.idempotencyKey
  if (!((current && exact(current) && build.controlEpoch === owner.controlEpoch)
    || ledger.attempts?.some((row: { runId: number; attempt: number; idempotencyKey: string; controlEpoch: number }) =>
      exact(row) && row.controlEpoch === owner.controlEpoch))) fail('原请求缺少准确账本归属')
  if (preparing && (snapshot.run.status !== 'running' || step.status !== 'running'
    || build.status !== 'building' || production.status !== 'producing'
    || build.controlEpoch !== owner.controlEpoch || production.controlEpoch !== owner.controlEpoch
    || build.planHash !== owner.planHash || !current || !exact(current) || current.status !== 'claimed')) {
    fail('原任务已经失效，不能发送或交接')
  }
  return snapshot
}

async function evidence<T>(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, taskKey: string, attempt: number, schema: string) {
  const found: T[] = []
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot'
      || event.payload.stepId !== taskKey || event.payload.attempt !== attempt) continue
    const text = await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'source-snapshot', contentHash: event.payload.contentHash })
    let row: { schema?: string }
    try { row = JSON.parse(text) } catch { continue }
    if (row?.schema === schema) found.push(row as T)
  }
  if (found.length > 1) fail('原请求证据存在冲突，保留记录等待核对')
  return found[0] ?? null
}
async function verify(value: RequestEvidence, scope: WorkspaceScope, snapshot: AgentRunSnapshotV1) {
  const ref = value?.request
  if (value?.schema !== REQUEST || value.version !== 1 || value.portable !== false
    || canonicalStringify(value.owner?.scope) !== canonicalStringify(scope)
    || value.owner.runId !== snapshot.run.id || value.contractHash !== snapshot.run.contractHash
    || ref?.version !== 1 || ref.provider !== 'codex' || Object.keys(ref).length !== 6
    || !/^[a-f0-9-]{36}$/i.test(ref.requestId) || !ref.model?.trim()
    || ref.requestHashAlgorithm !== CODEX_REQUEST_HASH_ALGORITHM_V1 || !/^[a-f0-9]{64}$/.test(ref.requestHash)
    || value.responseFormat !== 'json_object' || !Array.isArray(value.messages)
    || await sha256Text(JSON.stringify({ id: ref.requestId, model: ref.model, messages: value.messages,
      receiptRetention: CODEX_DURABLE_RECEIPT_RETENTION_V1, responseFormat: value.responseFormat })) !== ref.requestHash) {
    fail('原请求与发送前冻结的准确正文或作品身份不一致')
  }
}

/** Hook must finish before streamCodex's single POST. A second hook cannot
 * claim another native ID for this same paid attempt, even after refresh. */
export async function prepareProductProductionLocalRequestV1(input: {
  owner: ProductProductionLocalRequestOwnerV1; request: Readonly<CodexRequestRefV1>; messages: ChatMessage[]
}) {
  const snapshot = await owned(input.owner, true)
  if (await evidence(input.owner.scope, snapshot, input.owner.taskKey, input.owner.attempt, REQUEST)) {
    fail('该尝试已保存原本机请求；请明确查询原记录，不会重新发送')
  }
  const value: RequestEvidence = { schema: REQUEST, version: 1, portable: false,
    owner: structuredClone(input.owner), contractHash: snapshot.run.contractHash,
    request: { ...input.request }, messages: structuredClone(input.messages), responseFormat: 'json_object' }
  await verify(value, input.owner.scope, snapshot)
  await recordAgentRunArtifactV1({ scope: input.owner.scope, runId: input.owner.runId,
    stepId: input.owner.taskKey, attempt: input.owner.attempt, artifactKind: 'source-snapshot',
    content: JSON.stringify(value), expectedLastSequence: snapshot.projection.lastSequence })
}

/** Exact raw and metadata belong to the original owner before native ACK.
 * Failure/late/unknown responses stay retained; no terminal Run is reopened. */
export async function completeProductProductionLocalRequestV1(input: {
  owner: ProductProductionLocalRequestOwnerV1; request: Readonly<CodexRequestRefV1>
  output: string; usage: CodexReceipt['usage'] | null
}) {
  let snapshot = await owned(input.owner, true)
  const original = await evidence<RequestEvidence>(input.owner.scope, snapshot, input.owner.taskKey, input.owner.attempt, REQUEST)
  if (!original) fail('缺少发送前本机归属，不能补造回执交接')
  await verify(original, input.owner.scope, snapshot)
  if (canonicalStringify(original.request) !== canonicalStringify(input.request) || !input.output.trim()) fail('回传请求或完整原文不一致')
  const raw = await recordAgentRunArtifactV1({ scope: input.owner.scope, runId: input.owner.runId,
    stepId: input.owner.taskKey, attempt: input.owner.attempt, artifactKind: 'raw-response', content: input.output,
    expectedLastSequence: snapshot.projection.lastSequence })
  snapshot = raw.snapshot
  const metadata: ResponseEvidence = { schema: RESPONSE, version: 1, requestHash: input.request.requestHash,
    rawResponseHash: raw.artifact.contentHash, status: 'completed', usage: input.usage }
  snapshot = (await recordAgentRunArtifactV1({ scope: input.owner.scope, runId: input.owner.runId,
    stepId: input.owner.taskKey, attempt: input.owner.attempt, artifactKind: 'source-snapshot', content: JSON.stringify(metadata),
    expectedLastSequence: snapshot.projection.lastSequence })).snapshot
  let receipt: Awaited<ReturnType<typeof acknowledgeBoundCodexReceiptV1>>
  try { receipt = await acknowledgeBoundCodexReceiptV1({ request: input.request, rawResponseHash: raw.artifact.contentHash, confirmation: 'owner-record-saved-v1' }) }
  catch { return } // The protected native copy remains; the durable owner raw is already complete.
  await recordAgentRunArtifactV1({ scope: input.owner.scope, runId: input.owner.runId,
    stepId: input.owner.taskKey, attempt: input.owner.attempt, artifactKind: 'source-snapshot',
    content: JSON.stringify({ schema: HANDOFF, version: 1, requestHash: input.request.requestHash, rawResponseHash: raw.artifact.contentHash, receipt }),
    expectedLastSequence: snapshot.projection.lastSequence })
}

export type ProductProductionOriginalLocalReceiptV1 = { status: 'unbound' } | {
  status: CodexReceipt['status']; requestId: string; model: string; text: string
  usage: CodexReceipt['usage'] | null; source: 'owner' | 'native'; candidateReady: false
}

/** Explicit GET of the one original ID. Never creates events, inference,
 * charges, candidates or ACK; legacy and imported references are not inferred. */
export async function readProductProductionOriginalLocalReceiptV1(input: {
  scope: WorkspaceScope; productionId: number; buildId: number; runId: number; taskKey: string; attempt: number
}): Promise<ProductProductionOriginalLocalReceiptV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  const original = await evidence<RequestEvidence>(input.scope, snapshot, input.taskKey, input.attempt, REQUEST)
  if (!original) return { status: 'unbound' }
  if (original.owner.productionId !== input.productionId || original.owner.buildId !== input.buildId
    || original.owner.taskKey !== input.taskKey || original.owner.attempt !== input.attempt) fail('查询参数不属于原请求')
  await verify(original, input.scope, snapshot)
  await owned(original.owner, false)
  const saved = await evidence<ResponseEvidence>(input.scope, snapshot, input.taskKey, input.attempt, RESPONSE)
  if (saved) {
    if (saved.version !== 1 || saved.status !== 'completed' || saved.requestHash !== original.request.requestHash
      || !snapshot.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response'
        && event.payload.stepId === input.taskKey && event.payload.attempt === input.attempt && event.payload.contentHash === saved.rawResponseHash)) {
      fail('原作品响应元数据与准确原文不一致')
    }
    const text = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: saved.rawResponseHash })
    return { status: 'completed', requestId: original.request.requestId, model: original.request.model,
      text, usage: saved.usage, source: 'owner', candidateReady: false }
  }
  const receipt = await readBoundCodexReceiptV1(original.request)
  if (receipt.receiptRetention !== CODEX_DURABLE_RECEIPT_RETENTION_V1) fail('原本机回执没有约定的 owner 交接保留策略')
  if (receipt.status === 'completed' && (!receipt.dispatched || !receipt.text.trim())) fail('原完成回执不包含有效完整回答')
  return { status: receipt.status, requestId: original.request.requestId, model: original.request.model,
    text: receipt.text, usage: receipt.usage ?? null, source: 'native', candidateReady: false }
}

/** Read-only pre-dispatch ownership proof for an explicitly requested evidence copy. */
export type ProductProductionOriginalCaptureQueryV1 = Parameters<typeof readProductProductionOriginalLocalReceiptV1>[0]
export async function inspectProductProductionOriginalCaptureSourceV1(input: ProductProductionOriginalCaptureQueryV1) {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  const original = await evidence<RequestEvidence>(input.scope, snapshot, input.taskKey, input.attempt, REQUEST)
  if (!original) fail('原任务没有发送前绑定；不能补造原回答交接')
  if (original.owner.productionId !== input.productionId || original.owner.buildId !== input.buildId
    || original.owner.taskKey !== input.taskKey || original.owner.attempt !== input.attempt) fail('交接参数不属于原请求')
  await verify(original, input.scope, snapshot)
  await owned(original.owner, false)
  if (!['failed', 'cancelled'].includes(snapshot.run.status)) fail('原任务尚未结束；请由原执行者保存响应')
  const build = await db.productBuilds.get(input.buildId)
  if (!build || build.status !== 'recovery-required' || build.controlEpoch !== original.owner.controlEpoch
    || build.planHash !== original.owner.planHash) fail('原 Build 已变化，只能保留历史查询，不能交接为当前待审稿')
  const failure = JSON.parse(build.failureJson)
  const provenance = failure.failureProvenance
  if (failure.taskKey !== input.taskKey || provenance?.runId !== input.runId || provenance.attempt !== input.attempt
    || provenance.controlEpoch !== original.owner.controlEpoch || provenance.planHash !== original.owner.planHash
    || snapshot.projection.steps[input.taskKey]?.attempt !== input.attempt) fail('只有当前失败尝试可进入原回答交接')
  const requestArtifactHash = await sha256Text(JSON.stringify(original))
  if (!snapshot.events.some(event => event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === 'source-snapshot' && event.payload.contentHash === requestArtifactHash
    && event.payload.stepId === input.taskKey && event.payload.attempt === input.attempt)) fail('缺少准确原请求正文')
  return { original, requestArtifactHash, originalContractHash: snapshot.run.contractHash,
    originalProjectionHash: snapshot.run.projectionHash, buildNumber: build.buildNumber }
}
export async function captureProductProductionOriginalResponseV1(input: ProductProductionOriginalCaptureQueryV1 & {
  confirmation: 'retain-original-complete-response-without-inference-v1'
}) {
  return (await import('./local-response-capture')).captureProductProductionOriginalResponseCoreV1(input)
}
