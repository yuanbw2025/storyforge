/** Explicit zero-model evidence retention. No candidate, adoption or original fee settlement. */
import { db } from '../db/schema'
import type { WorkspaceScope, AgentRunEventTypeV1, AgentRunEventPayloadByTypeV1 } from '../types'
import { createAgentRunV1, readAgentRunV1, appendAgentRunEventV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { acceptAgentRunContract } from '../agent/run/contract'
import { hashCanonicalValue, canonicalStringify } from '../agent/run/hash'
import { createAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { acknowledgeBoundCodexReceiptV1 } from '../ai/codex-transport'
import { inspectProductProductionOriginalCaptureSourceV1, readProductProductionOriginalLocalReceiptV1,
  type ProductProductionOriginalCaptureQueryV1 } from './local-request'

const STEP = 'production.original-response-capture'
const META = 'storyforge.product-production-captured-response'
const ACK = 'storyforge.product-production-capture-ack'
const RECEIPT = 'storyforge.product-production-response-capture-receipt'
const CONFIRM = 'retain-original-complete-response-without-inference-v1'
type Source = Awaited<ReturnType<typeof inspectProductProductionOriginalCaptureSourceV1>>
type Usage = Exclude<Awaited<ReturnType<typeof readProductProductionOriginalLocalReceiptV1>>, { status: 'unbound' }>['usage']
type AckStatus = 'acknowledged' | 'pending' | 'unknown' | 'owner-preexisting'
interface Metadata {
  schema: typeof META; version: 1; inputHash: string; requestHash: string; rawResponseHash: string
  status: 'completed'; source: 'owner' | 'native'; usage: Usage
}
interface CaptureReceipt {
  schema: typeof RECEIPT; version: 1; portable: false; inputHash: string; runId: number; contractHash: string
  requestArtifactHash: string; originalContractHash: string; originalProjectionHash: string
  rawResponseHash: string; metadataHash: string; ackStatus: AckStatus; modelCalls: 0; recordedAt: number
}
function fail(message: string): never { throw Error(`[production-response-capture] ${message}`) }
function contract(source: Source, inputHash: string) {
  const owner = source.original.owner
  return { version: 1, workflowKind: 'direct-generation',
    objective: `保留原任务 ${owner.runId}/${owner.taskKey}/${owner.attempt} 的完整本机响应，不发起推理或采用`,
    scope: { projectId: owner.scope.projectId, worldGroupId: null, productProduction: {
      productBuildId: owner.buildId, buildNumber: source.buildNumber, controlEpoch: owner.controlEpoch,
      planHash: owner.planHash, taskKey: STEP } }, runtimeBindingHash: inputHash,
    permissions: { contextSourceKeys: [], writeTargets: [] },
    budget: { maxModelCalls: 0, maxToolCalls: 1, maxInputTokens: 0, maxOutputTokens: 0, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'capture.exact-owner-raw-saved', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'capture.terminal', kind: 'terminal', verifier: 'production-original-response-capture-v1', criterionIds: ['capture.exact-owner-raw-saved'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' } }
}
async function append<T extends AgentRunEventTypeV1>(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: T, payload: AgentRunEventPayloadByTypeV1[T]) {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence })
}
async function rows<T>(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, schema: string) {
  const found: Array<{ value: T; hash: string }> = []
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot'
      || event.payload.stepId !== STEP || event.payload.attempt !== 1) continue
    const text = await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'source-snapshot', contentHash: event.payload.contentHash })
    let value: { schema?: string }
    try { value = JSON.parse(text) } catch { continue }
    if (value?.schema === schema && !found.some(row => row.hash === event.payload.contentHash)) found.push({ value: value as T, hash: event.payload.contentHash })
  }
  if (found.length > 1) fail('交接证据冲突；保留全部记录等待核对')
  return found[0] ?? null
}
async function retained(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, inputHash: string, source: Source) {
  const metadata = await rows<Metadata>(scope, snapshot, META)
  if (!metadata) return null
  const m = metadata.value
  if (m.version !== 1 || m.status !== 'completed' || m.inputHash !== inputHash
    || m.requestHash !== source.original.request.requestHash || !['owner', 'native'].includes(m.source)) fail('已保留的响应归属不一致')
  const raw = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response'
    && event.payload.stepId === STEP && event.payload.attempt === 1)
  if (raw.some(event => event.type === 'evidence.artifact.recorded' && event.payload.contentHash !== m.rawResponseHash)) fail('原回答发生冲突')
  if (!raw.length) return null
  const text = await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'raw-response', contentHash: m.rawResponseHash })
  if (!text.trim() || await sha256Text(text) !== m.rawResponseHash) fail('完整原回答字节不一致')
  return { text, metadata }
}
async function result(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, inputHash: string, source: Source) {
  const raw = await retained(scope, snapshot, inputHash, source), proof = await rows<CaptureReceipt>(scope, snapshot, RECEIPT)
  const ack = await rows<{ status: AckStatus; inputHash: string; requestHash: string; rawResponseHash: string }>(scope, snapshot, ACK)
  if (!raw || !proof || !ack || !snapshot.events.some(event => event.type === 'evidence.artifact.recorded'
    && event.payload.stepId === STEP && event.payload.attempt === 1 && event.payload.artifactKind === 'source-snapshot'
    && event.payload.contentHash === source.requestArtifactHash) || snapshot.run.status !== 'completed' || proof.value.version !== 1 || proof.value.portable !== false
    || proof.value.runId !== snapshot.run.id || proof.value.contractHash !== snapshot.run.contractHash
    || proof.value.inputHash !== inputHash || proof.value.requestArtifactHash !== source.requestArtifactHash
    || proof.value.originalContractHash !== source.originalContractHash || proof.value.originalProjectionHash !== source.originalProjectionHash
    || proof.value.rawResponseHash !== raw.metadata.value.rawResponseHash || proof.value.metadataHash !== raw.metadata.hash
    || proof.value.modelCalls !== 0 || !['acknowledged', 'pending', 'unknown', 'owner-preexisting'].includes(proof.value.ackStatus)
    || ack.value.inputHash !== inputHash || ack.value.requestHash !== source.original.request.requestHash
    || ack.value.rawResponseHash !== raw.metadata.value.rawResponseHash || ack.value.status !== proof.value.ackStatus
    || await hashCanonicalValue(proof.value) !== snapshot.projection.terminalReceiptHash) fail('完整交接尚未通过终验')
  return { schema: RECEIPT, version: 1 as const, runId: snapshot.run.id, receiptHash: snapshot.projection.terminalReceiptHash!,
    originalRunId: source.original.owner.runId, rawResponseHash: raw.metadata.value.rawResponseHash,
    text: raw.text, usage: raw.metadata.value.usage, model: source.original.request.model,
    ackStatus: proof.value.ackStatus, modelCalls: 0 as const, candidateReady: false as const }
}
async function capture(input: ProductProductionOriginalCaptureQueryV1) {
  const source = await inspectProductProductionOriginalCaptureSourceV1(input), { scope } = input
  const inputHash = await hashCanonicalValue({ schema: RECEIPT, version: 1, owner: source.original.owner,
    requestArtifactHash: source.requestArtifactHash, originalContractHash: source.originalContractHash,
    originalProjectionHash: source.originalProjectionHash })
  const expected = await acceptAgentRunContract(contract(source, inputHash))
  const runs = (await db.agentRuns.where('productBuildId').equals(input.buildId).toArray())
    .filter(run => JSON.parse(run.contractJson).scope.productProduction?.taskKey === STEP
      && JSON.parse(run.contractJson).runtimeBindingHash === inputHash)
  if (runs.length > 1) fail('原响应已有多个交接 owner，不能新建或自动选择')
  let snapshot = runs[0] ? await readAgentRunV1(scope, runs[0].id!) : null
  if (snapshot && snapshot.run.contractHash !== expected.contractHash) fail('已存在交接契约不一致')
  if (snapshot?.run.status === 'completed') return result(scope, snapshot, inputHash, source)
  if (snapshot && !['planned', 'running', 'verifying'].includes(snapshot.run.status)) fail('交接已结束或暂停，请保留原记录核对')
  let raw = snapshot ? await retained(scope, snapshot, inputHash, source) : null
  const original = raw ? null : await readProductProductionOriginalLocalReceiptV1(input)
  if (!raw && (!original || original.status !== 'completed' || !original.text.trim())) fail('只可保留已完成的完整原回答；未确认、取消和部分回答不能交接')
  if (!snapshot) snapshot = await createAgentRunV1({ scope, productBuildId: input.buildId, worldGroupId: null, contract: expected.contract })
  if (!snapshot.projection.steps[STEP]) snapshot = await append(scope, snapshot, 'step.scheduled', { stepId: STEP })
  if (snapshot.projection.steps[STEP].status === 'scheduled') snapshot = await append(scope, snapshot, 'step.started', { stepId: STEP, attempt: 1 })
  if (!snapshot.events.some(e => e.type === 'tool.called' && e.payload.stepId === STEP)) snapshot = await append(scope, snapshot, 'tool.called', { stepId: STEP, attempt: 1, toolName: STEP, callHash: inputHash })
  const save = async (artifactKind: 'source-snapshot' | 'raw-response', content: string) => {
    const saved = await recordAgentRunArtifactV1({ scope, runId: snapshot!.run.id, stepId: STEP, attempt: 1,
      artifactKind, content, expectedLastSequence: snapshot!.projection.lastSequence })
    snapshot = saved.snapshot; return saved.artifact.contentHash
  }
  await save('source-snapshot', JSON.stringify(source.original))
  if (!raw && original?.status === 'completed') {
    const metadata: Metadata = { schema: META, version: 1, inputHash, requestHash: source.original.request.requestHash,
      rawResponseHash: await sha256Text(original.text), status: 'completed', source: original.source, usage: original.usage }
    const old = await rows<Metadata>(scope, snapshot, META)
    if (old && canonicalStringify(old.value) !== canonicalStringify(metadata)) fail('原响应元数据发生冲突')
    await save('source-snapshot', JSON.stringify(metadata))
    await save('raw-response', original.text)
    snapshot = (await createAgentRunCheckpointV1({ scope, runId: snapshot.run.id,
      resumePayload: { schema: RECEIPT, version: 1, portable: false, inputHash, requestArtifactHash: source.requestArtifactHash,
        rawResponseHash: metadata.rawResponseHash }, expectedLastSequence: snapshot.projection.lastSequence })).snapshot
    raw = await retained(scope, snapshot, inputHash, source)
  }
  if (!raw) fail('完整原文尚未保存，不能释放本机回执')
  const current = await inspectProductProductionOriginalCaptureSourceV1(input)
  if (canonicalStringify(current) !== canonicalStringify(source)) fail('交接期间原任务已变化；原文保留，不释放或采用')
  let ack = await rows<{ schema: string; version: number; status: AckStatus }>(scope, snapshot, ACK)
  if (!ack) {
    // Persist intent first. A crash after intent never silently repeats ACK.
    const started = await rows(scope, snapshot, ACK + '-intent')
    if (!started) await save('source-snapshot', JSON.stringify({ schema: ACK + '-intent', version: 1, inputHash,
      requestHash: source.original.request.requestHash, rawResponseHash: raw.metadata.value.rawResponseHash }))
    let status: AckStatus = raw.metadata.value.source === 'owner' ? 'owner-preexisting' : started ? 'unknown' : 'pending'
    if (raw.metadata.value.source === 'native' && !started) {
      try { await acknowledgeBoundCodexReceiptV1({ request: source.original.request,
        rawResponseHash: raw.metadata.value.rawResponseHash, confirmation: 'owner-record-saved-v1' }); status = 'acknowledged' }
      catch { status = 'pending' }
    }
    await save('source-snapshot', JSON.stringify({ schema: ACK, version: 1, inputHash,
      requestHash: source.original.request.requestHash, rawResponseHash: raw.metadata.value.rawResponseHash, status }))
    ack = await rows<{ schema: string; version: number; status: AckStatus }>(scope, snapshot, ACK)
  }
  if (!ack) fail('缺少交接保留状态')
  const existing = await rows<CaptureReceipt>(scope, snapshot, RECEIPT)
  const receipt: CaptureReceipt = existing?.value ?? { schema: RECEIPT, version: 1, portable: false, inputHash,
    runId: snapshot.run.id, contractHash: snapshot.run.contractHash, requestArtifactHash: source.requestArtifactHash,
    originalContractHash: source.originalContractHash, originalProjectionHash: source.originalProjectionHash,
    rawResponseHash: raw.metadata.value.rawResponseHash, metadataHash: raw.metadata.hash, ackStatus: ack.value.status,
    modelCalls: 0, recordedAt: Date.now() }
  const receiptHash = await hashCanonicalValue(receipt)
  await save('source-snapshot', JSON.stringify(receipt))
  if (!snapshot.events.some(e => e.type === 'tool.returned' && e.payload.stepId === STEP)) snapshot = await append(scope, snapshot, 'tool.returned', { stepId: STEP, attempt: 1, toolName: STEP, resultHash: raw.metadata.value.rawResponseHash })
  if (snapshot.projection.steps[STEP].status === 'running') snapshot = await append(scope, snapshot, 'step.succeeded', { stepId: STEP, attempt: 1, outputHash: raw.metadata.value.rawResponseHash })
  if (snapshot.run.status !== 'verifying') snapshot = await append(scope, snapshot, 'verification.started', { verifierSetVersion: 'production-original-response-capture-v1' })
  snapshot = await append(scope, snapshot, 'verification.accepted', { receiptHash })
  return result(scope, snapshot, inputHash, source)
}
export async function captureProductProductionOriginalResponseCoreV1(input: ProductProductionOriginalCaptureQueryV1 & { confirmation: typeof CONFIRM }) {
  if (input.confirmation !== CONFIRM) fail('需要明确确认只保留完整原回答，不发起推理或采用')
  if (typeof navigator === 'undefined' || !navigator.locks?.request) fail('当前环境无法排除其他页面正在交接，请使用支持安全恢复的本机浏览器；原记录保留')
  const key = `storyforge:production-response-capture:${input.scope.projectId}:${input.scope.worldId}:${input.scope.workId}:${input.runId}:${input.taskKey}:${input.attempt}`
  return navigator.locks.request(key, { ifAvailable: true }, lock => {
    if (!lock) fail('原响应正在另一页面交接，请保留记录稍后查看')
    return capture(input)
  })
}

/** Read a retained proof only. Never creates a Run, GET, ACK, inference or adoption. */
export async function readProductProductionCapturedResponseForAuthorV1(input: ProductProductionOriginalCaptureQueryV1 & {
  captureRunId: number; captureReceiptHash: string
}) {
  const source = await inspectProductProductionOriginalCaptureSourceV1(input)
  const inputHash = await hashCanonicalValue({ schema: RECEIPT, version: 1, owner: source.original.owner,
    requestArtifactHash: source.requestArtifactHash, originalContractHash: source.originalContractHash,
    originalProjectionHash: source.originalProjectionHash })
  const expected = await acceptAgentRunContract(contract(source, inputHash))
  const snapshot = await readAgentRunV1(input.scope, input.captureRunId)
  if (snapshot.run.productBuildId !== input.buildId || snapshot.run.contractHash !== expected.contractHash
    || snapshot.run.status !== 'completed' || snapshot.projection.terminalReceiptHash !== input.captureReceiptHash) {
    fail('原响应保留证明不属于当前作品、Build 或尝试')
  }
  const retained = await result(input.scope, snapshot, inputHash, source)
  return { ...retained, originalOwner: source.original.owner }
}
