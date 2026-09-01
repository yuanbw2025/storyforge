import { estimateTokens } from '../ai/context-budget'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import {
  appendAgentRunEventV1,
  readAgentRunV1,
  type AgentRunSnapshotV1,
} from '../agent/run/event-store'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import {
  createContextManifestV3,
  parseContextManifestV3,
  verifyContextManifestIntegrityV3,
} from '../agent/run/context-manifest'
import {
  inspectAgentRunArtifactAvailabilityV1,
  readAgentRunArtifactExactV1,
  recordAgentRunArtifactV1,
} from '../memory/artifact-store'
import type {
  ContextManifestArtifactRefV3,
  ContextManifestV2,
  ContextManifestV3,
} from '../types/agent-run'
import type {
  ContextPacketV1,
  ContextSourceRefV1,
  ContextSufficiencyReportV1,
  RetrievalDecisionV1,
  RetrievalTraceV1,
} from '../registry/types'
import type { WorkspaceScope } from '../types'
import type { ContextSelectorResultV1 } from './selector'
import type { ContextGatewayToolSessionV1 } from './tool-session'

const HASH = /^[a-f0-9]{64}$/

export interface ContextGatewaySourceSnapshotInputV1 {
  sourceKey?: string
  resourceKey?: string
  sourceRefs?: readonly ContextSourceRefV1[]
  content: unknown
}

export interface ContextGatewayToolTranscriptInputV1 {
  toolName: string
  callIndex: number
  sourceKey?: string
  resourceKey?: string
  arguments: unknown
  result: unknown
}

export interface ContextGatewayPreflightEvidenceV1 {
  version: 'context-gateway-preflight-evidence-v1'
  runId: number
  stepId: string
  attempt: number
  selectorHash: string
  selectorArtifactHash: string
  contextPacket: ContextPacketV1
  contextPacketArtifactHash: string
  promptHash: string
  artifacts: ContextManifestArtifactRefV3[]
  preflightHash: string
}

export interface ContextGatewayFreshnessReportV1 {
  version: 'context-gateway-freshness-v1'
  manifestHash: string
  status: 'fresh' | 'stale'
  resources: Array<{
    resourceKey: string
    sourceKey: string
    status: 'fresh' | 'missing' | 'content-stale' | 'policy-stale' | 'source-ref-stale'
  }>
  reasonCodes: string[]
  reportHash: string
}

export class ContextGatewayEvidenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[context-gateway-evidence:${code}] ${message}`)
    this.name = 'ContextGatewayEvidenceError'
  }
}

function fail(code: string, message: string): never {
  throw new ContextGatewayEvidenceError(code, message)
}

function exactPayload(value: unknown): string {
  return typeof value === 'string' ? value : canonicalStringify(value)
}

function sameSourceRef(left: ContextSourceRefV1, right: ContextSourceRefV1): boolean {
  return left.table === right.table
    && left.recordId === right.recordId
    && left.field === right.field
    && left.revision === right.revision
    && left.contentHash === right.contentHash
    && canonicalStringify(left.anchor ?? null) === canonicalStringify(right.anchor ?? null)
}

async function assertContextPacketIntegrity(packet: ContextPacketV1): Promise<void> {
  if (packet.version !== 'context-packet-v1' || !HASH.test(packet.packetHash)
    || !HASH.test(packet.scopeFingerprint) || !HASH.test(packet.gatewayVersionHash)
    || !HASH.test(packet.policyHash) || !HASH.test(packet.sufficiencyReportHash)
    || !HASH.test(packet.retrievalTraceHash) || !HASH.test(packet.contentHash)
    || !Array.isArray(packet.sourceRefs)) fail('packet-contract', 'Context Packet 合同非法')
  if (await sha256Text(packet.content) !== packet.contentHash || estimateTokens(packet.content) !== packet.tokenCount) {
    fail('packet-content', 'Context Packet 正文 hash/token 不匹配')
  }
  const { packetHash, ...body } = packet
  if (await hashCanonicalValue(body) !== packetHash) fail('packet-hash', 'Context Packet hash 不匹配')
}

async function assertSelectorIntegrity(selector: ContextSelectorResultV1): Promise<void> {
  if (selector.version !== 'context-selector-v1' || !HASH.test(selector.selectorHash)
    || !HASH.test(selector.inventoryHash) || !Array.isArray(selector.selected)
    || !Array.isArray(selector.omitted) || !Array.isArray(selector.categoryBudgets)) {
    fail('selector-contract', 'Context Selector Result 合同非法')
  }
  const { selectorHash, ...body } = selector
  if (await hashCanonicalValue(body) !== selectorHash) fail('selector-hash', 'Context Selector Result hash 不匹配')
}

function normalizeArtifactRefs(refs: readonly ContextManifestArtifactRefV3[]): ContextManifestArtifactRefV3[] {
  return [...refs].sort((left, right) => (
    left.role.localeCompare(right.role)
      || (left.sourceKey ?? '').localeCompare(right.sourceKey ?? '')
      || (left.resourceKey ?? '').localeCompare(right.resourceKey ?? '')
      || (left.sourceContentHash ?? '').localeCompare(right.sourceContentHash ?? '')
      || (left.sourceRefsHash ?? '').localeCompare(right.sourceRefsHash ?? '')
      || (left.toolName ?? '').localeCompare(right.toolName ?? '')
      || (left.callIndex ?? -1) - (right.callIndex ?? -1)
      || left.contentHash.localeCompare(right.contentHash)
  ))
}

function toArtifactRef(
  artifact: { artifactKind: ContextManifestArtifactRefV3['artifactKind']; contentHash: string; byteLength: number },
  metadata: Omit<ContextManifestArtifactRefV3, 'artifactKind' | 'contentHash' | 'byteLength'>,
): ContextManifestArtifactRefV3 {
  return { ...metadata, artifactKind: artifact.artifactKind, contentHash: artifact.contentHash, byteLength: artifact.byteLength }
}

async function recordExact(input: {
  scope: WorkspaceScope
  runId: number
  stepId: string
  attempt: number
  snapshot: AgentRunSnapshotV1
  artifactKind: ContextManifestArtifactRefV3['artifactKind'] | 'context-manifest'
  content: string
  now?: number
}) {
  return recordAgentRunArtifactV1({
    scope: input.scope,
    runId: input.runId,
    artifactKind: input.artifactKind,
    content: input.content,
    stepId: input.stepId,
    attempt: input.attempt,
    expectedLastSequence: input.snapshot.projection.lastSequence,
    now: input.now,
  })
}

export async function recordContextGatewayPreflightEvidenceV1(input: {
  scope: WorkspaceScope
  runId: number
  stepId: string
  attempt: number
  contextPacket: ContextPacketV1
  selector: ContextSelectorResultV1
  renderedRequest: unknown
  sourceSnapshots?: readonly ContextGatewaySourceSnapshotInputV1[]
  toolTranscript?: readonly ContextGatewayToolTranscriptInputV1[]
  expectedLastSequence?: number
  now?: number
}): Promise<{ evidence: ContextGatewayPreflightEvidenceV1; snapshot: AgentRunSnapshotV1 }> {
  await assertContextPacketIntegrity(input.contextPacket)
  await assertSelectorIntegrity(input.selector)
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  if (input.expectedLastSequence != null && input.expectedLastSequence !== snapshot.projection.lastSequence) {
    fail('sequence-conflict', '运行已推进，拒绝记录过期 preflight')
  }
  const step = snapshot.projection.steps[input.stepId]
  if (!step || step.status !== 'running' || step.attempt !== input.attempt) {
    fail('step-attempt', 'preflight 必须属于当前 running step/attempt')
  }
  const artifacts: ContextManifestArtifactRefV3[] = []
  const selectorContent = canonicalStringify(input.selector)
  const selectorRecord = await recordExact({
    ...input, snapshot, artifactKind: 'selector-result', content: selectorContent,
  })
  snapshot = selectorRecord.snapshot
  artifacts.push(toArtifactRef(selectorRecord.artifact, { role: 'selector-result' }))
  const packetContent = canonicalStringify(input.contextPacket)
  const packet = await recordExact({
    ...input, snapshot, artifactKind: 'context-packet', content: packetContent,
  })
  snapshot = packet.snapshot
  artifacts.push(toArtifactRef(packet.artifact, { role: 'context-packet' }))

  const sourceSnapshots = [...(input.sourceSnapshots ?? [])].sort((left, right) => (
    (left.sourceKey ?? '').localeCompare(right.sourceKey ?? '')
      || (left.resourceKey ?? '').localeCompare(right.resourceKey ?? '')
      || canonicalStringify(left.sourceRefs ?? []).localeCompare(canonicalStringify(right.sourceRefs ?? []))
  ))
  for (const source of sourceSnapshots) {
    if (!source.sourceKey?.trim() && !source.resourceKey?.trim()) {
      fail('source-snapshot', 'source snapshot 必须声明 sourceKey 或 resourceKey')
    }
    const sourceBody = exactPayload(source.content)
    const sourceContentHash = await sha256Text(sourceBody)
    const sourceRefsHash = await hashCanonicalValue(source.sourceRefs ?? [])
    const content = canonicalStringify({
      version: 1,
      sourceKey: source.sourceKey ?? null,
      resourceKey: source.resourceKey ?? null,
      sourceRefs: source.sourceRefs ?? [],
      sourceContentHash,
      sourceRefsHash,
      content: source.content,
    })
    const recorded = await recordExact({ ...input, snapshot, artifactKind: 'source-snapshot', content })
    snapshot = recorded.snapshot
    artifacts.push(toArtifactRef(recorded.artifact, {
      role: 'source-snapshot',
      ...(source.sourceKey ? { sourceKey: source.sourceKey } : {}),
      ...(source.resourceKey ? { resourceKey: source.resourceKey } : {}),
      sourceContentHash,
      sourceRefsHash,
    }))
  }

  const transcript = [...(input.toolTranscript ?? [])].sort((left, right) => left.callIndex - right.callIndex)
  if (new Set(transcript.map(item => item.callIndex)).size !== transcript.length
    || transcript.some(item => !item.toolName.trim() || !Number.isSafeInteger(item.callIndex) || item.callIndex < 0)) {
    fail('tool-transcript', 'tool transcript 的 toolName/callIndex 非法或重复')
  }
  for (const call of transcript) {
    const content = canonicalStringify({
      version: 1,
      toolName: call.toolName,
      callIndex: call.callIndex,
      sourceKey: call.sourceKey ?? null,
      resourceKey: call.resourceKey ?? null,
      arguments: call.arguments,
      result: call.result,
    })
    const recorded = await recordExact({ ...input, snapshot, artifactKind: 'tool-result', content })
    snapshot = recorded.snapshot
    artifacts.push(toArtifactRef(recorded.artifact, {
      role: 'tool-result', toolName: call.toolName, callIndex: call.callIndex,
      ...(call.sourceKey ? { sourceKey: call.sourceKey } : {}),
      ...(call.resourceKey ? { resourceKey: call.resourceKey } : {}),
    }))
  }

  const requestContent = exactPayload(input.renderedRequest)
  const request = await recordExact({ ...input, snapshot, artifactKind: 'rendered-request', content: requestContent })
  snapshot = request.snapshot
  artifacts.push(toArtifactRef(request.artifact, { role: 'rendered-request' }))
  const body = {
    version: 'context-gateway-preflight-evidence-v1' as const,
    runId: input.runId,
    stepId: input.stepId,
    attempt: input.attempt,
    selectorHash: input.selector.selectorHash,
    selectorArtifactHash: selectorRecord.artifact.contentHash,
    contextPacket: input.contextPacket,
    contextPacketArtifactHash: packet.artifact.contentHash,
    promptHash: request.artifact.contentHash,
    artifacts: normalizeArtifactRefs(artifacts),
  }
  return { evidence: { ...body, preflightHash: await hashCanonicalValue(body) }, snapshot }
}

async function assertPreflightIntegrity(input: ContextGatewayPreflightEvidenceV1): Promise<void> {
  if (input.version !== 'context-gateway-preflight-evidence-v1' || !HASH.test(input.preflightHash)) {
    fail('preflight-contract', 'preflight evidence 合同非法')
  }
  const { preflightHash, ...body } = input
  if (await hashCanonicalValue(body) !== preflightHash) fail('preflight-hash', 'preflight evidence hash 不匹配')
  await assertContextPacketIntegrity(input.contextPacket)
  if (!HASH.test(input.selectorHash) || !HASH.test(input.selectorArtifactHash)) {
    fail('preflight-selector', 'preflight selector hash 非法')
  }
  const selector = input.artifacts.find(item => item.role === 'selector-result')
  const packet = input.artifacts.find(item => item.role === 'context-packet')
  const request = input.artifacts.find(item => item.role === 'rendered-request')
  if (!selector || selector.contentHash !== input.selectorArtifactHash
    || !packet || packet.contentHash !== input.contextPacketArtifactHash
    || !request || request.contentHash !== input.promptHash) fail('preflight-link', 'preflight packet/request artifact link 不一致')
}

async function readAndVerifyArtifactBodyV1(
  projectId: number,
  ref: ContextManifestArtifactRefV3,
): Promise<string> {
  const availability = await inspectAgentRunArtifactAvailabilityV1({
    projectId,
    artifactKind: ref.artifactKind,
    contentHash: ref.contentHash,
  })
  if (availability.state !== 'available' || availability.byteLength !== ref.byteLength) {
    fail('artifact-unavailable', `${ref.role}:${ref.contentHash} 当前为 ${availability.state}`)
  }
  const body = await readAgentRunArtifactExactV1({
    projectId,
    artifactKind: ref.artifactKind,
    contentHash: ref.contentHash,
  })
  if (ref.role === 'context-packet') {
    try {
      await assertContextPacketIntegrity(JSON.parse(body) as ContextPacketV1)
    } catch {
      fail('packet-artifact', 'Context Packet artifact JSON/完整性损坏')
    }
  }
  if (ref.role === 'selector-result') {
    let parsed: ContextSelectorResultV1
    try {
      parsed = JSON.parse(body) as ContextSelectorResultV1
      await assertSelectorIntegrity(parsed)
    } catch {
      fail('selector-artifact', 'selector result artifact JSON/完整性损坏')
    }
    if (await sha256Text(body) !== ref.contentHash) {
      fail('selector-artifact', 'selector result artifact hash 不匹配')
    }
  }
  if (ref.role === 'source-snapshot') {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(body) as Record<string, unknown>
    } catch {
      fail('source-snapshot-artifact', 'source snapshot artifact JSON 损坏')
    }
    const sourceHash = await sha256Text(exactPayload(parsed.content))
    if (parsed.version !== 1 || parsed.sourceKey !== (ref.sourceKey ?? null)
      || parsed.resourceKey !== (ref.resourceKey ?? null)
      || parsed.sourceContentHash !== ref.sourceContentHash || sourceHash !== ref.sourceContentHash
      || parsed.sourceRefsHash !== ref.sourceRefsHash || !Array.isArray(parsed.sourceRefs)
      || await hashCanonicalValue(parsed.sourceRefs) !== ref.sourceRefsHash) {
      fail('source-snapshot-artifact', 'source snapshot body 与 Manifest 元数据不一致')
    }
  }
  if (ref.role === 'tool-result') {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(body) as Record<string, unknown>
    } catch {
      fail('tool-artifact', 'tool result artifact JSON 损坏')
    }
    if (parsed.version !== 1 || parsed.toolName !== ref.toolName || parsed.callIndex !== ref.callIndex
      || parsed.sourceKey !== (ref.sourceKey ?? null) || parsed.resourceKey !== (ref.resourceKey ?? null)) {
      fail('tool-artifact', 'tool result body 与 Manifest 元数据不一致')
    }
  }
  return body
}

async function assertGatewayEvidenceCoherence(input: {
  preflight: ContextGatewayPreflightEvidenceV1
  selector: ContextSelectorResultV1
  sufficiency: ContextSufficiencyReportV1
  retrievalTrace: RetrievalTraceV1
  gatewayVersionHash: string
  policyHash: string
}): Promise<void> {
  const packet = input.preflight.contextPacket
  if (packet.gatewayVersionHash !== input.gatewayVersionHash || packet.policyHash !== input.policyHash
    || packet.sufficiencyReportHash !== input.sufficiency.reportHash
    || packet.retrievalTraceHash !== input.retrievalTrace.traceHash
    || input.selector.sufficiency.reportHash !== input.sufficiency.reportHash
    || input.selector.selectorPolicyId !== input.retrievalTrace.selectorPolicyId
    || input.preflight.selectorHash !== input.selector.selectorHash) {
    fail('gateway-link', 'selector/report/trace/packet/Gateway 证据链不一致')
  }
  if (input.selector.sufficiency.additionalRead === 'needed') {
    fail('insufficient-context', '充分性报告仍要求追加读取，不能 finalize')
  }
  const unresolvedHard = input.sufficiency.obligations.find(item => (
    item.required && (item.status === 'missing' || item.status === 'conflicted')
  ))
  if (unresolvedHard) {
    fail('insufficient-context', `硬证据义务未满足：${unresolvedHard.id}`)
  }
  const selected = new Map(input.selector.selected.map(item => [item.resourceKey, item]))
  const traced = [...input.retrievalTrace.mandatory, ...input.retrievalTrace.autoSelected]
  if (selected.size !== traced.length || traced.some(decision => {
    const expected = selected.get(decision.resourceKey)
    return !expected
      || expected.sourceKey !== decision.sourceKey
      || expected.depth !== decision.depth
      || expected.contentRevision !== decision.revision
      || expected.contentHash !== decision.contentHash
      || expected.policyRevision !== decision.policyRevision
      || expected.policyHash !== decision.policyHash
  })) fail('selector-trace', 'selector selected 与 Retrieval Trace 资源/内容/策略证据不一致')
  const hardKeys = new Set(input.selector.selected.filter(item => item.hardRequirement).map(item => item.resourceKey))
  if (input.retrievalTrace.mandatory.some(item => !hardKeys.has(item.resourceKey))
    || input.retrievalTrace.autoSelected.some(item => hardKeys.has(item.resourceKey))) {
    fail('selector-trace-class', 'Retrieval Trace mandatory/autoSelected 分类与 selector 不一致')
  }
  for (const decision of retrievalDecisions(input.retrievalTrace)) {
    if (!Number.isSafeInteger(decision.policyRevision) || decision.policyRevision! < 0
      || !HASH.test(decision.policyHash ?? '')) {
      fail('trace-policy-evidence', `${decision.resourceKey} 缺少可验签 policyRevision/policyHash`)
    }
    if (decision.sourceRefs.some(ref => !packet.sourceRefs.some(packetRef => sameSourceRef(packetRef, ref)))) {
      fail('packet-source-ref', `${decision.resourceKey} 的 Canon SourceRef 未进入 Context Packet`)
    }
    const sourceRefsHash = await hashCanonicalValue(decision.sourceRefs)
    const isAgentRead = input.retrievalTrace.agentReads.includes(decision)
    if (!input.preflight.artifacts.some(ref => (
      (ref.role === 'source-snapshot' && ref.resourceKey === decision.resourceKey
        && ref.sourceRefsHash === sourceRefsHash)
      || (isAgentRead && ref.role === 'tool-result' && ref.resourceKey === decision.resourceKey)
    ))) fail('resource-artifact', `${decision.resourceKey} 没有可逐字回读且 SourceRef 一致的 source/tool artifact`)
  }
}

export async function finalizeContextGatewayAttemptEvidenceV1(input: {
  scope: WorkspaceScope
  runId: number
  stepId: string
  attempt: number
  baseManifest: ContextManifestV2
  preflight: ContextGatewayPreflightEvidenceV1
  selector: ContextSelectorResultV1
  sufficiency: ContextSufficiencyReportV1
  retrievalTrace: RetrievalTraceV1
  gatewayVersionHash: string
  policyHash: string
  rawResponse: unknown
  candidateHash: string
  executionBoundary?:
    | { kind: 'model' }
    | { kind: 'tool'; toolName: string }
  checkpointHash?: string | null
  expectedLastSequence?: number
  now?: number
}): Promise<{
  manifest: ContextManifestV3
  manifestArtifactHash: string
  snapshot: AgentRunSnapshotV1
}> {
  await assertPreflightIntegrity(input.preflight)
  await assertGatewayEvidenceCoherence(input)
  if (!HASH.test(input.candidateHash)) fail('candidate-hash', 'candidateHash 必须是 SHA-256')
  if (input.preflight.runId !== input.runId || input.preflight.stepId !== input.stepId
    || input.preflight.attempt !== input.attempt || input.baseManifest.runId !== input.runId
    || input.baseManifest.stepId !== input.stepId || input.baseManifest.attempt !== input.attempt
    || input.baseManifest.scope.projectId !== input.scope.projectId) {
    fail('attempt-scope', 'preflight/V2/Run step attempt 或 scope 不一致')
  }
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  if (input.expectedLastSequence != null && input.expectedLastSequence !== snapshot.projection.lastSequence) {
    fail('sequence-conflict', '运行已推进，拒绝基于过期 response finalize')
  }
  const boundary = input.executionBoundary ?? { kind: 'model' as const }
  const requested = snapshot.events.filter(event => boundary.kind === 'model'
    ? event.type === 'model.requested'
      && event.payload.stepId === input.stepId && event.payload.attempt === input.attempt
    : event.type === 'tool.called'
      && event.payload.stepId === input.stepId && event.payload.attempt === input.attempt
      && event.payload.toolName === boundary.toolName)
  const responded = snapshot.events.filter(event => boundary.kind === 'model'
    ? event.type === 'model.responded'
      && event.payload.stepId === input.stepId && event.payload.attempt === input.attempt
    : event.type === 'tool.returned'
      && event.payload.stepId === input.stepId && event.payload.attempt === input.attempt
      && event.payload.toolName === boundary.toolName)
  const alreadyAssembled = snapshot.events.some(event => event.type === 'context.assembled'
    && event.payload.stepId === input.stepId && event.payload.attempt === input.attempt)
  if (requested.length !== 1 || responded.length !== 1
    || snapshot.events.indexOf(responded[0]) <= snapshot.events.indexOf(requested[0])) {
    fail('execution-boundary', 'finalize 需要唯一且有序的 model 或 deterministic tool 执行边界证据')
  }
  if (alreadyAssembled) fail('duplicate-finalize', '同一 step/attempt 不得重复 finalize')
  const requestEventIndex = snapshot.events.indexOf(requested[0])
  for (const ref of input.preflight.artifacts) {
    const artifactEventIndex = snapshot.events.findIndex(event => event.type === 'evidence.artifact.recorded'
      && event.payload.artifactKind === ref.artifactKind && event.payload.contentHash === ref.contentHash
      && event.payload.stepId === input.stepId && event.payload.attempt === input.attempt)
    if (artifactEventIndex < 0 || artifactEventIndex >= requestEventIndex) {
      fail('preflight-order', `${ref.role} exact artifact 未在执行请求前持久化`)
    }
    await readAndVerifyArtifactBodyV1(input.scope.projectId, ref)
  }
  const response = await recordExact({
    ...input,
    snapshot,
    artifactKind: 'raw-response',
    content: exactPayload(input.rawResponse),
  })
  snapshot = response.snapshot
  const artifacts = normalizeArtifactRefs([
    ...input.preflight.artifacts,
    toArtifactRef(response.artifact, { role: 'raw-response' }),
  ])
  const manifest = await createContextManifestV3({
    manifest: input.baseManifest,
    scopeFingerprint: input.preflight.contextPacket.scopeFingerprint,
    gatewayVersionHash: input.gatewayVersionHash,
    policyHash: input.policyHash,
    selectorPolicyId: input.selector.selectorPolicyId,
    selectorHash: input.selector.selectorHash,
    selectorArtifactHash: input.preflight.selectorArtifactHash,
    inventoryHash: input.selector.inventoryHash,
    catalogVersion: input.retrievalTrace.catalogVersion,
    contextPacketHash: input.preflight.contextPacket.packetHash,
    sufficiency: input.sufficiency,
    retrievalTrace: input.retrievalTrace,
    artifacts,
    promptHash: input.preflight.promptHash,
    candidateHash: input.candidateHash,
    workingContextGeneration: snapshot.projection.generation,
    packetArtifactHash: input.preflight.contextPacketArtifactHash,
    checkpointHash: input.checkpointHash,
  })
  const manifestRecord = await recordExact({
    ...input,
    snapshot,
    artifactKind: 'context-manifest',
    content: canonicalStringify(manifest),
  })
  snapshot = manifestRecord.snapshot
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: input.runId,
    type: 'context.assembled',
    payload: { stepId: input.stepId, attempt: input.attempt, manifestHash: manifest.manifestHash },
    expectedLastSequence: snapshot.projection.lastSequence,
    now: input.now,
  })
  return { manifest, manifestArtifactHash: manifestRecord.artifact.contentHash, snapshot }
}

export async function readContextGatewayManifestV3ForAttemptV1(input: {
  scope: WorkspaceScope
  runId: number
  stepId: string
  attempt: number
}): Promise<{ manifest: ContextManifestV3; manifestArtifactHash: string; snapshot: AgentRunSnapshotV1 }> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  const assembled = snapshot.events.filter((event): event is Extract<typeof event, { type: 'context.assembled' }> => (
    event.type === 'context.assembled'
      && event.payload.stepId === input.stepId && event.payload.attempt === input.attempt
  ))
  if (assembled.length !== 1) fail('manifest-event', `step/attempt 应有且仅有一条 context.assembled，实际 ${assembled.length}`)
  const refs = snapshot.events.filter((event): event is Extract<typeof event, { type: 'evidence.artifact.recorded' }> => (
    event.type === 'evidence.artifact.recorded'
      && event.payload.artifactKind === 'context-manifest'
      && event.payload.stepId === input.stepId && event.payload.attempt === input.attempt
  ))
  const matching: Array<{ manifest: ContextManifestV3; manifestArtifactHash: string }> = []
  for (const event of refs) {
    const content = await readAgentRunArtifactExactV1({
      projectId: input.scope.projectId,
      artifactKind: 'context-manifest',
      contentHash: event.payload.contentHash,
    })
    let parsed: ContextManifestV3
    try {
      parsed = parseContextManifestV3(JSON.parse(content))
    } catch {
      fail('manifest-body', 'ContextManifestV3 artifact JSON/合同损坏')
    }
    if (parsed.manifestHash === assembled[0].payload.manifestHash) {
      matching.push({ manifest: parsed, manifestArtifactHash: event.payload.contentHash })
    }
  }
  if (matching.length !== 1 || !await verifyContextManifestIntegrityV3(matching[0].manifest)) {
    fail('manifest-integrity', '无法找到唯一且完整的 ContextManifestV3 exact body')
  }
  return { ...matching[0], snapshot }
}

export async function verifyContextGatewayCandidateEvidenceV1(input: {
  scope: WorkspaceScope
  runId: number
  stepId: string
  attempt: number
  candidateHash: string
}): Promise<{
  manifest: ContextManifestV3
  manifestArtifactHash: string
  artifactBodies: Record<string, string>
}> {
  const restored = await readContextGatewayManifestV3ForAttemptV1(input)
  const generatedCandidateHash = restored.manifest.candidate.candidateHash
  const candidateEvents = restored.snapshot.events.filter(event => event.type === 'candidate.persisted'
    && event.payload.stepId === input.stepId && event.payload.attempt === input.attempt
    && event.payload.candidateHash === generatedCandidateHash)
  if (candidateEvents.length !== 1) fail('candidate-event', '缺少唯一 candidate.persisted 证据')
  let linkedCandidateHash = generatedCandidateHash
  for (const event of restored.snapshot.events) {
    if (event.type !== 'candidate.revised'
      || event.payload.stepId !== input.stepId
      || event.payload.attempt !== input.attempt) continue
    if (event.payload.previousCandidateHash !== linkedCandidateHash) {
      fail('candidate-revision-chain', '作者候选修订链出现分叉或断裂')
    }
    linkedCandidateHash = event.payload.candidateHash
  }
  if (linkedCandidateHash !== input.candidateHash) {
    fail('candidate-link', '当前 candidateHash 未由 ContextManifestV3 绑定的生成候选连续修订而来')
  }
  const manifestEventIndex = restored.snapshot.events.findIndex(event => event.type === 'context.assembled'
    && event.payload.stepId === input.stepId && event.payload.attempt === input.attempt)
  const candidateEventIndex = restored.snapshot.events.indexOf(candidateEvents[0])
  if (manifestEventIndex < 0 || candidateEventIndex <= manifestEventIndex) {
    fail('event-order', 'candidate.persisted 必须发生在 final ContextManifestV3 之后')
  }
  const artifactBodies: Record<string, string> = {}
  for (const ref of restored.manifest.artifacts) {
    artifactBodies[`${ref.role}:${ref.contentHash}`] = await readAndVerifyArtifactBodyV1(
      input.scope.projectId,
      ref,
    )
  }
  const packetRef = restored.manifest.artifacts.find(ref => ref.role === 'context-packet')!
  let packet: ContextPacketV1
  try {
    packet = JSON.parse(artifactBodies[`context-packet:${packetRef.contentHash}`]) as ContextPacketV1
  } catch {
    fail('packet-json', 'Context Packet artifact JSON 损坏')
  }
  await assertContextPacketIntegrity(packet)
  if (packet.packetHash !== restored.manifest.gateway.contextPacketHash
    || packet.gatewayVersionHash !== restored.manifest.gateway.gatewayVersionHash
    || packet.policyHash !== restored.manifest.gateway.policyHash
    || packet.sufficiencyReportHash !== restored.manifest.gateway.sufficiency.reportHash
    || packet.retrievalTraceHash !== restored.manifest.gateway.retrievalTrace.traceHash) {
    fail('packet-link', 'Context Packet 与 final Manifest 链接不一致')
  }
  const selectorRef = restored.manifest.artifacts.find(ref => ref.role === 'selector-result')!
  const selector = JSON.parse(artifactBodies[`selector-result:${selectorRef.contentHash}`]) as ContextSelectorResultV1
  await assertSelectorIntegrity(selector)
  if (selector.selectorHash !== restored.manifest.gateway.selectorHash
    || selector.inventoryHash !== restored.manifest.gateway.inventoryHash
    || selector.selectorPolicyId !== restored.manifest.gateway.selectorPolicyId
    || selector.sufficiency.reportHash !== restored.manifest.gateway.sufficiency.reportHash) {
    fail('selector-link', 'Selector Result 与 final Manifest 链接不一致')
  }
  return { manifest: restored.manifest, manifestArtifactHash: restored.manifestArtifactHash, artifactBodies }
}

function retrievalDecisions(trace: RetrievalTraceV1): RetrievalDecisionV1[] {
  return [...trace.mandatory, ...trace.autoSelected, ...trace.agentReads]
}

export async function inspectContextGatewayManifestFreshnessV1(input: {
  manifest: ContextManifestV3
  session: ContextGatewayToolSessionV1
}): Promise<ContextGatewayFreshnessReportV1> {
  const resources: ContextGatewayFreshnessReportV1['resources'] = []
  const reasonCodes = new Set<string>()
  if (input.manifest.gateway.scopeFingerprint !== input.session.scopeFingerprint) reasonCodes.add('scope-fingerprint-stale')
  if (input.manifest.gateway.policyHash !== input.session.policyHash) reasonCodes.add('policy-binding-stale')
  const unique = new Map(retrievalDecisions(input.manifest.gateway.retrievalTrace).map(item => [item.resourceKey, item]))
  for (const decision of [...unique.values()].sort((left, right) => left.resourceKey.localeCompare(right.resourceKey))) {
    const binding = input.session.providers.find(item => item.source.key === decision.sourceKey)
    if (!binding) {
      resources.push({ resourceKey: decision.resourceKey, sourceKey: decision.sourceKey, status: 'missing' })
      reasonCodes.add('provider-missing')
      continue
    }
    try {
      const current = await binding.provider.read({
        scope: input.session.scope,
        resourceKey: decision.resourceKey,
        depth: 'index',
        maxTokens: 1,
      })
      const status = current.descriptor.contentHash !== decision.contentHash
        || current.descriptor.contentRevision !== decision.revision
        ? 'content-stale' as const
        : current.descriptor.policyHash !== decision.policyHash
          || current.descriptor.policyRevision !== decision.policyRevision
          ? 'policy-stale' as const
          : decision.sourceRefs.some(ref => !current.descriptor.sourceRefs.some(item => sameSourceRef(item, ref)))
            ? 'source-ref-stale' as const
            : 'fresh' as const
      resources.push({ resourceKey: decision.resourceKey, sourceKey: decision.sourceKey, status })
      if (status !== 'fresh') reasonCodes.add(status)
    } catch {
      resources.push({ resourceKey: decision.resourceKey, sourceKey: decision.sourceKey, status: 'missing' })
      reasonCodes.add('resource-missing')
    }
  }
  const body = {
    version: 'context-gateway-freshness-v1' as const,
    manifestHash: input.manifest.manifestHash,
    status: (reasonCodes.size ? 'stale' : 'fresh') as 'fresh' | 'stale',
    resources,
    reasonCodes: [...reasonCodes].sort(),
  }
  return { ...body, reportHash: await hashCanonicalValue(body) }
}

export function summarizeContextGatewayManifestForAuthorV1(manifest: ContextManifestV3): {
  selectedResources: number
  mandatoryResources: number
  additionalReads: number
  omittedResources: number
  inputTokens: number
  evidenceStatus: 'complete'
  candidateHashShort: string
} {
  return {
    selectedResources: manifest.gateway.retrievalTrace.mandatory.length + manifest.gateway.retrievalTrace.autoSelected.length,
    mandatoryResources: manifest.gateway.retrievalTrace.mandatory.length,
    additionalReads: manifest.gateway.retrievalTrace.agentReads.length,
    omittedResources: manifest.gateway.retrievalTrace.omitted.length,
    inputTokens: manifest.totalInputTokens,
    evidenceStatus: 'complete',
    candidateHashShort: manifest.candidate.candidateHash.slice(0, 12),
  }
}

export async function exportContextGatewayDiagnosticV1(input: {
  scope: WorkspaceScope
  runId: number
  stepId: string
  attempt: number
  candidateHash: string
}): Promise<string> {
  const verified = await verifyContextGatewayCandidateEvidenceV1(input)
  return canonicalStringify({
    version: 'context-gateway-diagnostic-v1',
    manifestArtifactHash: verified.manifestArtifactHash,
    manifest: verified.manifest,
    artifactBodies: verified.artifactBodies,
  })
}
