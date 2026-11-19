import Dexie from 'dexie'
import { db } from '../db/schema'
import type { AgentRunContract, AnyAgentRunEventV1, VerificationReceiptV1, WorkspaceScope } from '../types'
import { parseAgentRunContract } from '../agent/run/contract'
import { parseAgentRunEventV1 } from '../agent/run/event-schema'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { readVerifiedAgentRunInTransactionV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { completedAgentRunEvidencePrefixV1, replayAgentRunEventsV1, toAgentRunProjectionBodyV1 } from '../agent/run/projection'
import { parseVerificationReceiptV1, verifyVerificationReceiptIntegrityV1 } from '../agent/run/verification-receipt'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'
import { assertWorkCoverCandidateHashV1, parseWorkCoverImageCandidateV1 } from './contracts'
import type { WorkCoverAssetV1, WorkCoverRepairedImageCandidateV1, WorkCoverResponseBufferV1 } from './types'

export const COVER_REPAIR_DECODER_V1 = 'work-cover-sync-image-v2' as const
export const COVER_REPAIR_STEP_V1 = 'work-cover.local-repair'
export interface CoverLedgerWitnessV1 {
  contractJson: string
  contractHash: string
  events: AnyAgentRunEventV1[]
  projectionHash: string
}
export interface CoverSourceWitnessV1 {
  schema: 'storyforge.work-cover.failed-source@1'
  ledger: CoverLedgerWitnessV1
  requestArtifactJson: string
  workCode: string
  assetKey: string
  dispatchKey: string
  briefHash: string
  routeHash: string
  responseHash: string
  httpStatus: number
}
export interface CoverRepairDescriptorV1 {
  schema: 'storyforge.work-cover.local-image-proof@1'
  decoderVersion: typeof COVER_REPAIR_DECODER_V1
  operationKey: string
  nonce: string
  sourceWitnessHash: string
  workCode: string
  assetKey: string
  dispatchKey: string
  briefHash: string
  routeHash: string
  responseHash: string
  blobHash: string
  mimeType: string
  width: number
  height: number
  byteSize: number
  draftKey: string
  draftRevision: number
  expectedWorkUpdatedAt: number
}
export interface CoverRepairEvidenceV1 {
  schema: 'storyforge.work-cover.repair-evidence@1'
  source: CoverSourceWitnessV1
  descriptor: CoverRepairDescriptorV1
  proof: CoverLedgerWitnessV1
  receipt: VerificationReceiptV1
}

function fail(): never { throw new Error('[work-cover] 本地恢复的来源、运行或不可变证明不一致') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  return value as Record<string, unknown>
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  const row = record(value)
  if (Object.keys(row).sort().join(',') !== keys.sort().join(',')) fail()
  return row
}
function equal(left: unknown, right: unknown) { if (canonicalStringify(left) !== canonicalStringify(right)) fail() }

export function coverRepairContractV1(projectId: number, bindingHash: string): AgentRunContract {
  return parseAgentRunContract({ version: 1, objective: '明确从已保存原答验证封面图片；零模型、本机候选，须另经作者采用',
    workflowKind: 'read-only-audit', runtimeBindingHash: bindingHash,
    scope: { projectId, worldGroupId: null }, permissions: { contextSourceKeys: [], writeTargets: [] },
    budget: { maxModelCalls: 0, maxToolCalls: 1, maxInputTokens: 0, maxOutputTokens: 0, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'cover.local-bytes', kind: 'deterministic-check', required: true }],
    verificationPlan: [{ id: 'cover.local-terminal', kind: 'terminal', verifier: 'work-cover-local-repair-v1', criterionIds: ['cover.local-bytes'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  })
}
export async function coverRepairBindingV1(descriptor: CoverRepairDescriptorV1) {
  return hashCanonicalValue({ operationKey: descriptor.operationKey, nonce: descriptor.nonce,
    sourceWitnessHash: descriptor.sourceWitnessHash, repairProofHash: await hashCanonicalValue(descriptor) })
}

/** Only this known coordinate in this exact V1 cover contract can change.
 * No recursive deletion of ID/hash-named fields is permitted. */
function semanticContract(raw: string, source: boolean): unknown {
  const original = record(JSON.parse(raw)), contract = parseAgentRunContract(original)
  const scope = exact(original.scope, ['projectId', 'worldGroupId'])
  if (contract.version !== 1 || scope.worldGroupId !== null || !Number.isSafeInteger(scope.projectId) || (scope.projectId as number) < 1) fail()
  if (source) {
    exact(original, ['version', 'objective', 'workflowKind', 'runtimeBindingHash', 'executionBindings', 'scope', 'permissions', 'budget', 'acceptance', 'verificationPlan', 'failurePolicy'])
    if (contract.workflowKind !== 'direct-generation' || contract.executionBindings?.length !== 1
      || contract.executionBindings[0].version !== 1 || contract.executionBindings[0].skillId !== 'inspiration.work-cover-image-v1'
      || contract.executionBindings[0].stepId !== 'work-cover.image' || contract.executionBindings[0].formalEntry?.entryId !== 'work-cover.image.generate') fail()
    equal(contract.permissions, { contextSourceKeys: ['workCoverMetadataV1', 'workCoverBriefV1', 'workCoverSelectedTextV1'],
      writeTargets: [{ table: 'works', fields: ['coverImage'], mode: 'candidate-only' }] })
    equal(contract.budget, { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 16_000, maxOutputTokens: 1, maxAttemptsPerStep: 1 })
  } else equal(contract, coverRepairContractV1(contract.scope.projectId, contract.runtimeBindingHash!))
  return { ...original, scope: { projectId: 1, worldGroupId: null } }
}

function semanticEvents(events: AnyAgentRunEventV1[], source: boolean): unknown[] {
  const allowed = source
    ? ['run.created', 'contract.accepted', 'step.scheduled', 'step.started', 'context.assembled', 'evidence.artifact.recorded', 'checkpoint.created', 'model.requested', 'run.paused', 'run.failed', 'memory.settlement.recorded']
    : ['run.created', 'contract.accepted', 'step.scheduled', 'step.started', 'tool.called', 'tool.returned', 'evidence.artifact.recorded', 'candidate.persisted', 'step.succeeded', 'verification.started', 'checkpoint.created', 'verification.accepted', 'memory.settlement.recorded']
  if (!events.length || events.length > 128) fail()
  return events.map(raw => {
    const event = parseAgentRunEventV1(raw)
    if (!allowed.includes(event.type) || event.generation !== 1 || event.worldGroupId !== null) fail()
    if ('stepId' in event.payload && event.payload.stepId !== (source ? 'work-cover.image' : COVER_REPAIR_STEP_V1)) fail()
    if ('attempt' in event.payload && event.payload.attempt !== 1) fail()
    if (event.type === 'evidence.artifact.recorded'
      && !(source ? ['context-manifest', 'source-snapshot', 'rendered-request'] : ['source-snapshot', 'tool-result']).includes(event.payload.artifactKind)) fail()
    if (event.type === 'run.paused' && (event.payload.reason !== 'image-outcome-unknown-no-resend' || !event.payload.recoverable)) fail()
    if ((event.type === 'tool.called' || event.type === 'tool.returned') && event.payload.toolName !== 'validate-saved-cover-image') fail()
    const payload = event.type === 'contract.accepted'
      ? { contractJson: semanticContract(event.payload.contractJson!, source) } : event.payload
    return { version: event.version, sequence: event.sequence, generation: event.generation,
      worldGroupId: event.worldGroupId, type: event.type, createdAt: event.createdAt, payload }
  })
}
export function coverLedgerWitnessV1(snapshot: AgentRunSnapshotV1): CoverLedgerWitnessV1 {
  return { contractJson: snapshot.run.contractJson, contractHash: snapshot.run.contractHash,
    events: snapshot.events, projectionHash: snapshot.run.projectionHash }
}
async function verifyArchive(ledger: CoverLedgerWitnessV1, source: boolean) {
  exact(ledger, ['contractJson', 'contractHash', 'events', 'projectionHash'])
  const contract = parseAgentRunContract(JSON.parse(ledger.contractJson))
  semanticContract(ledger.contractJson, source); semanticEvents(ledger.events, source)
  const projection = replayAgentRunEventsV1(ledger.events.map(parseAgentRunEventV1))
  if (projection.errors.length || projection.generation !== 1 || projection.state !== (source ? 'failed' : 'completed')
    || projection.contractHash !== ledger.contractHash || await hashCanonicalValue(contract) !== ledger.contractHash
    || canonicalStringify(contract) !== ledger.contractJson
    || await hashCanonicalValue(toAgentRunProjectionBodyV1(projection)) !== ledger.projectionHash) fail()
  const accepted = ledger.events.filter(event => event.type === 'contract.accepted')
  if (accepted.length !== 1 || accepted[0].type !== 'contract.accepted' || accepted[0].payload.contractJson !== ledger.contractJson) fail()
  return projection
}

export async function assertCoverSourceWitnessV1(source: CoverSourceWitnessV1) {
  exact(source, ['schema', 'ledger', 'requestArtifactJson', 'workCode', 'assetKey', 'dispatchKey', 'briefHash', 'routeHash', 'responseHash', 'httpStatus'])
  if (source.schema !== 'storyforge.work-cover.failed-source@1' || !Number.isInteger(source.httpStatus) || source.httpStatus < 200 || source.httpStatus >= 300) fail()
  await verifyArchive(source.ledger, true)
  const model = source.ledger.events.filter(event => event.type === 'model.requested')
  const failure = source.ledger.events.filter(event => event.type === 'run.failed')
  if (model.length !== 1 || model[0].type !== 'model.requested' || model[0].payload.bindingHash !== source.routeHash
    || failure.length !== 1 || failure[0].type !== 'run.failed' || failure[0].payload.code !== 'image-response-rejected' || failure[0].payload.retryable) fail()
  const request = exact(JSON.parse(source.requestArtifactJson), ['schema', 'route', 'dispatchKey', 'request'])
  const route = exact(request.route, ['adapterId', 'connectionPresetId', 'imageModel', 'endpoint', 'recipeId', 'protocolVersion', 'capabilityManifestHash', 'credentialIdentity', 'routeHash'])
  const { routeHash, ...routeBody } = route
  const body = exact(request.request, ['model', 'prompt', 'size', 'ratio', 'return_base64'])
  if (request.schema !== 'storyforge.work-cover.image-request@1' || request.dispatchKey !== source.dispatchKey
    || routeHash !== source.routeHash || await hashCanonicalValue(routeBody) !== routeHash
    || route.adapterId !== 'agnes-images-b64-sync-v1' || route.recipeId !== 'agnes-image-2.1-b64-v1'
    || route.imageModel !== 'agnes-image-2.1-flash' || route.protocolVersion !== 1
    || !['https://apihub.agnes-ai.com/v1/images/generations', '/agnes-proxy/v1/images/generations'].includes(route.endpoint as string)
    || body.model !== route.imageModel || body.size !== '1K' || body.ratio !== '2:3' || body.return_base64 !== true
    || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 16_000
    || JSON.parse(source.ledger.contractJson).runtimeBindingHash !== source.routeHash) fail()
  const requestHash = await hashCanonicalValue(request)
  if (source.requestArtifactJson !== canonicalStringify(request) || !source.ledger.events.some(event => event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === 'rendered-request' && event.payload.contentHash === requestHash)) fail()
}

export async function captureCoverSourceV1(scope: WorkspaceScope, buffer: WorkCoverResponseBufferV1): Promise<CoverSourceWitnessV1> {
  const snapshot = await readVerifiedAgentRunInTransactionV1(scope, buffer.runId)
  if (snapshot.run.workId !== scope.workId || snapshot.run.worldGroupId != null || snapshot.run.conversationId != null
    || snapshot.run.nodeRunId != null || snapshot.run.productBuildId != null) fail()
  const requests = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'rendered-request')
  if (requests.length !== 1 || requests[0].type !== 'evidence.artifact.recorded') fail()
  const requestArtifactJson = await readAgentRunArtifactExactV1({ projectId: scope.projectId,
    artifactKind: 'rendered-request', contentHash: requests[0].payload.contentHash })
  const source: CoverSourceWitnessV1 = { schema: 'storyforge.work-cover.failed-source@1', ledger: coverLedgerWitnessV1(snapshot), requestArtifactJson,
    workCode: buffer.workCode, assetKey: buffer.assetKey, dispatchKey: buffer.dispatchKey, briefHash: buffer.briefHash,
    routeHash: buffer.routeHash, responseHash: buffer.rawResponseHash!, httpStatus: buffer.httpStatus! }
  await Dexie.waitFor(assertCoverSourceWitnessV1(source))
  const originalRequest = JSON.parse(requestArtifactJson)
  if (canonicalStringify(originalRequest.request) !== buffer.requestJson || canonicalStringify(originalRequest.route) !== buffer.routeJson) fail()
  return source
}

export function coverRepairPostStateV1(asset: Pick<WorkCoverAssetV1, 'assetKey' | 'blobHash' | 'mimeType' | 'width' | 'height' | 'byteSize'>, candidate: WorkCoverRepairedImageCandidateV1) {
  return { assetKey: asset.assetKey, blobHash: asset.blobHash, mimeType: asset.mimeType, width: asset.width,
    height: asset.height, byteSize: asset.byteSize, candidateHash: candidate.candidateHash, repairProofHash: candidate.repairProofHash }
}

/** Pure verification works on independently verified ledgers, never on fake
 * portable coordinates constructed from live records. */
export async function assertCoverRepairEvidenceV1(asset: WorkCoverAssetV1, currentSource: { contractJson: string; events: AnyAgentRunEventV1[] },
  currentProof: { contractJson: string; events: AnyAgentRunEventV1[] }) {
  const candidate = parseWorkCoverImageCandidateV1(asset.candidateJson!)
  if (candidate.schema !== 'storyforge.work-cover.repaired-image-candidate@1') fail()
  await assertWorkCoverCandidateHashV1(candidate)
  const evidence = JSON.parse(asset.repairEvidenceJson!) as CoverRepairEvidenceV1
  exact(evidence, ['schema', 'source', 'descriptor', 'proof', 'receipt'])
  if (evidence.schema !== 'storyforge.work-cover.repair-evidence@1') fail()
  await assertCoverSourceWitnessV1(evidence.source)
  const descriptor = evidence.descriptor
  exact(descriptor, ['schema', 'decoderVersion', 'operationKey', 'nonce', 'sourceWitnessHash', 'workCode', 'assetKey', 'dispatchKey', 'briefHash', 'routeHash', 'responseHash', 'blobHash', 'mimeType', 'width', 'height', 'byteSize', 'draftKey', 'draftRevision', 'expectedWorkUpdatedAt'])
  if (descriptor.schema !== 'storyforge.work-cover.local-image-proof@1' || descriptor.decoderVersion !== COVER_REPAIR_DECODER_V1
    || await hashCanonicalValue(evidence.source) !== candidate.sourceWitnessHash || descriptor.sourceWitnessHash !== candidate.sourceWitnessHash
    || await hashCanonicalValue(descriptor) !== candidate.repairProofHash) fail()
  if (descriptor.operationKey !== await hashCanonicalValue({ workCode: candidate.workCode, dispatchKey: candidate.dispatchKey,
    responseHash: candidate.responseHash, decoderVersion: COVER_REPAIR_DECODER_V1 })
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(descriptor.nonce)
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(descriptor.draftKey)
    || !Number.isSafeInteger(descriptor.draftRevision) || descriptor.draftRevision < 1
    || !Number.isSafeInteger(descriptor.expectedWorkUpdatedAt) || descriptor.expectedWorkUpdatedAt < 0) fail()
  for (const key of ['workCode', 'assetKey', 'dispatchKey', 'briefHash', 'routeHash', 'responseHash', 'blobHash', 'decoderVersion'] as const) equal(candidate[key], descriptor[key])
  for (const key of ['workCode', 'assetKey', 'dispatchKey', 'briefHash', 'routeHash', 'responseHash'] as const) equal(candidate[key], evidence.source[key])
  for (const key of ['workCode', 'assetKey', 'blobHash', 'mimeType', 'width', 'height', 'byteSize'] as const) equal(asset[key], descriptor[key])
  equal(semanticContract(currentSource.contractJson, true), semanticContract(evidence.source.ledger.contractJson, true))
  equal(semanticEvents(currentSource.events, true), semanticEvents(evidence.source.ledger.events, true))
  const historical = await verifyArchive(evidence.proof, false)
  const completed = completedAgentRunEvidencePrefixV1(currentProof.events)
  if (!completed || completed.terminalReceiptHash !== historical.terminalReceiptHash) fail()
  const proofEvents = currentProof.events[currentProof.events.length - 1]?.type === 'verification.staled' ? currentProof.events.slice(0, -1) : currentProof.events
  equal(semanticContract(currentProof.contractJson, false), semanticContract(evidence.proof.contractJson, false))
  equal(semanticEvents(proofEvents, false), semanticEvents(evidence.proof.events, false))
  const proofContract = parseAgentRunContract(JSON.parse(evidence.proof.contractJson))
  if (proofContract.runtimeBindingHash !== await coverRepairBindingV1(descriptor)) fail()
  const receipt = parseVerificationReceiptV1(evidence.receipt)
  if (!await verifyVerificationReceiptIntegrityV1(receipt) || receipt.receiptHash !== historical.terminalReceiptHash
    || receipt.contractHash !== evidence.proof.contractHash || receipt.runId !== evidence.proof.events[0].runId
    || receipt.postStateHash !== await hashCanonicalValue(coverRepairPostStateV1(asset, candidate))
    || receipt.zeroModelCommit?.contractJson !== evidence.proof.contractJson) fail()
  if (receipt.generation !== 1 || receipt.verifierSetVersion !== 'work-cover-local-repair-v1') fail()
  equal(receipt.criteria, [{ id: 'cover.local-bytes', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`, `proof:${candidate.repairProofHash}`] }])
  equal(receipt.zeroModelCommit.inputArtifactHashes, [candidate.sourceWitnessHash, candidate.repairProofHash, await hashCanonicalValue(candidate)])
  const called = proofEvents.filter(event => event.type === 'tool.called'), returned = proofEvents.filter(event => event.type === 'tool.returned')
  if (called.length !== 1 || called[0].type !== 'tool.called' || called[0].payload.callHash !== candidate.sourceWitnessHash
    || returned.length !== 1 || returned[0].type !== 'tool.returned' || returned[0].payload.resultHash !== candidate.repairProofHash
    || !proofEvents.some(event => event.type === 'candidate.persisted' && event.payload.candidateHash === candidate.candidateHash)) fail()
  const refs = [
    { artifactKind: 'source-snapshot', contentHash: candidate.sourceWitnessHash },
    { artifactKind: 'tool-result', contentHash: candidate.repairProofHash },
    { artifactKind: 'tool-result', contentHash: await hashCanonicalValue(candidate) },
  ]
  for (const ref of refs) if (!proofEvents.some(event => event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === ref.artifactKind && event.payload.contentHash === ref.contentHash)) fail()
  const expectedRoots = [...evidence.source.ledger.events, ...evidence.proof.events].flatMap(event => event.type === 'evidence.artifact.recorded'
    ? [{ artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash }] : [])
  equal(JSON.parse(asset.exactArtifactRefsJson), [...new Map(expectedRoots.map(ref => [canonicalStringify(ref), ref])).values()])
  return evidence
}

export async function assertLiveRepairedCoverAssetV1(scope: WorkspaceScope, asset: WorkCoverAssetV1) {
  if (!asset.materializationRunId || !asset.sourceRunId || asset.sourceRunId === asset.materializationRunId) fail()
  if (asset.projectId !== scope.projectId || asset.worldId !== scope.worldId || asset.workId !== scope.workId) fail()
  const verify = async () => {
    await resolveScope({ scope })
    const work = await db.works.get(scope.workId)
    if (!work || work.code !== asset.workCode) fail()
    const source = await Dexie.Promise.resolve(readVerifiedAgentRunInTransactionV1(scope, asset.sourceRunId!))
    const proof = await Dexie.Promise.resolve(readVerifiedAgentRunInTransactionV1(scope, asset.materializationRunId!))
    for (const snapshot of [source, proof]) if (snapshot.run.workId !== scope.workId || snapshot.run.worldGroupId != null
      || snapshot.run.conversationId != null || snapshot.run.productBuildId != null || snapshot.run.nodeRunId != null) fail()
    const evidence = await Dexie.waitFor(assertCoverRepairEvidenceV1(asset, { contractJson: source.run.contractJson, events: source.events },
      { contractJson: proof.run.contractJson, events: proof.events }))
    for (const ref of JSON.parse(asset.exactArtifactRefsJson) as Array<{ artifactKind: 'source-snapshot' | 'tool-result' | 'rendered-request'; contentHash: string }>) {
      await readAgentRunArtifactExactV1({ projectId: scope.projectId, ...ref })
    }
    return evidence
  }
  const transaction = Dexie.currentTransaction
  if (transaction) {
    if (!transaction.active || transaction.db !== db || !scopeTransactionTables(db.agentRuns, db.agentRunEvents, db.agentRunArtifacts).every(table => transaction.storeNames.includes(table.name))) fail()
    return verify()
  }
  return db.transaction('r', scopeTransactionTables(db.agentRuns, db.agentRunEvents, db.agentRunArtifacts), verify)
}
