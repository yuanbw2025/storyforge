import {AIError} from '../types'
import {classifyHarnessFailureV1, type HarnessFailureClassV1} from '../agent/run/harness-failure'
import {db} from '../db/schema'
import type {AgentRunEventTypeV1, ProductMediaAsset, WorkspaceScope} from '../types'
import {assembleContext} from '../registry/assemble-context'
import {hashCanonicalValue} from '../agent/run/hash'
import {createAgentSkillExecutionBindingV1} from '../agent/execution-binding'
import {getAgentSkillV1} from '../agent/skill-registry'
import {appendAgentRunEventV1, createAgentRunV1, type AgentRunSnapshotV1} from '../agent/run/event-store'
import {
  beginAgentRunRecoveryV1, completeAgentRunRecoveryV1, createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1,
} from '../agent/run/checkpoint'
import {createContextManifestFromAssemblyV1} from '../agent/run/context-manifest'
import {
  createVerificationReceiptV1, parseVerificationReceiptV1, verifyVerificationReceiptIntegrityV1,
} from '../agent/run/verification-receipt'
import {readAgentRunArtifactExactV1, recordAgentRunArtifactV1} from '../memory/artifact-store'
import {resolveConfiguredAgnesImageCapabilityV1, type ResolvedProductMediaCapabilityV1} from '../product-production/media-transport'
import {detectProductImageDimensionsV1, type ProductMediaCandidateV1, type ProductMediaRequestV1} from '../product-production/media-adapters'
import {importProductRuntimeMediaAssetV1} from '../product/runtime-media-library'
import {readProductMediaBlobData} from '../product-production/media-blob-store'
import {readChatRuntimeVisualContextV1, type ChatRuntimeVisualContextV1, type ChatRuntimeVisualRequestV1} from './runtime-visual-context'

const SKILL = 'character.chat-runtime-visuals', STEP = 'chat:runtime-visual', SOURCE = 'chat.runtime-visuals'
const VERIFIER = 'chat-runtime-visual-v1', KIND = 'storyforge.chat-runtime-visual-run'
interface VisualPayload {
  kind: typeof KIND; version: 1
  context: ChatRuntimeVisualContextV1; request: ChatRuntimeVisualRequestV1
  manifestHash: string
  status: 'prepared' | 'requested' | 'available' | 'failed'
  asset: {assetKey: string; contentHash: string} | null
  issue: string | null
  slotAttempt?: number
  explicitRetry?: boolean
}
export interface ChatRuntimeVisualJobV1 {
  runId: number; request: ChatRuntimeVisualRequestV1
  status: 'available' | 'failed' | 'unknown'; issue: string | null
  asset: ProductMediaAsset | null
}
const locks = new Set<number>()
export function latestChatVisualJobsV1(jobs: ChatRuntimeVisualJobV1[]) {
  const latest = new Map<string, ChatRuntimeVisualJobV1>()
  for (const job of jobs) if ((latest.get(job.request.key)?.runId ?? -1) < job.runId) latest.set(job.request.key, job)
  return latest
}
async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: AgentRunEventTypeV1, payload: unknown) {
  return appendAgentRunEventV1({scope, runId: snapshot.run.id, productRuntimeSessionId: snapshot.run.productRuntimeSessionId ?? undefined, type, payload, expectedLastSequence: snapshot.projection.lastSequence} as Parameters<typeof appendAgentRunEventV1>[0])
}
async function checkpoint(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, payload: VisualPayload) {
  return (await createAgentRunCheckpointV1({scope, runId: snapshot.run.id, productRuntimeSessionId: snapshot.run.productRuntimeSessionId ?? undefined, resumePayload: payload, expectedLastSequence: snapshot.projection.lastSequence})).snapshot
}

interface VisualResult {
  requestKey: string; assetKey: string; contentHash: string; originalContentHash: string
  providerReceipt: ProductMediaCandidateV1['providerReceipt']
  rights: ProductMediaCandidateV1['rights']
  preservesOriginalPixels: true
}
interface SavedVisualResult {result: VisualResult; artifactHash: string; outputHash: string}
const visualAssetKey = (requestKey: string, attempt: number) => `chat.runtime.${requestKey}${attempt > 1 ? `.attempt-${attempt}` : ''}`
const pendingVerification = '原图片已保存，可直接查看；补齐时会核验原图片，不会重新请求同一张。'

async function visualToolResults(snapshot: AgentRunSnapshotV1) {
  const contents: Array<{body: unknown; artifactHash: string; sequence: number}> = []
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.generation !== snapshot.projection.generation
      || event.payload.stepId !== STEP || event.payload.attempt !== 1 || event.payload.artifactKind !== 'tool-result') continue
    try {
      const artifactHash = event.payload.contentHash
      const body: unknown = JSON.parse(await readAgentRunArtifactExactV1({
        projectId: snapshot.run.projectId, artifactKind: 'tool-result', contentHash: artifactHash,
      }))
      contents.push({body, artifactHash, sequence: event.sequence})
    } catch { /* Missing or damaged exact evidence cannot authorize a receipt. */ }
  }
  return contents
}

async function readVisualResult(snapshot: AgentRunSnapshotV1, payload: VisualPayload): Promise<SavedVisualResult | null> {
  const expectedKey = visualAssetKey(payload.request.key, payload.slotAttempt ?? 1)
  const requested = snapshot.events.find(event => event.type === 'model.requested'
    && event.generation === snapshot.projection.generation && event.payload.stepId === STEP && event.payload.attempt === 1)
  if (!requested || requested.type !== 'model.requested' || !snapshot.events.some(event => event.type === 'context.assembled'
    && event.generation === requested.generation && event.sequence < requested.sequence && event.payload.stepId === STEP
    && event.payload.attempt === 1 && event.payload.manifestHash === payload.manifestHash)) return null
  const toolResults = await visualToolResults(snapshot)
  let verifiedRequest = false
  for (const {body, sequence} of toolResults) {
    if (sequence >= requested.sequence) continue
    const prepared = body as {mediaRequest?: ProductMediaRequestV1; manifest?: {manifestHash?: string}} | null
    if (prepared?.manifest?.manifestHash === payload.manifestHash && prepared.mediaRequest?.artifactKey === expectedKey
      && prepared.mediaRequest.requestId === `chat-visual-${snapshot.run.id}`
      && prepared.mediaRequest.inputHash === snapshot.contract.runtimeBindingHash
      && await hashCanonicalValue(prepared.mediaRequest) === requested.payload.bindingHash) {
      verifiedRequest = true
      break
    }
  }
  if (!verifiedRequest) return null
  const proofs: SavedVisualResult[] = []
  for (const {body, artifactHash, sequence} of toolResults) {
    if (sequence <= requested.sequence) continue
    const result = body as Partial<VisualResult> | null
    if (!result || result.requestKey !== payload.request.key || result.assetKey !== expectedKey
      || typeof result.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(result.contentHash)
      || result.originalContentHash !== result.contentHash || result.preservesOriginalPixels !== true
      || !result.providerReceipt || typeof result.rights?.adapterId !== 'string') continue
    const outputHash = await hashCanonicalValue(result)
    const candidateHash = snapshot.projection.steps[STEP]?.candidateHash
    if (candidateHash && candidateHash !== outputHash) continue
    proofs.push({result: result as VisualResult, artifactHash, outputHash})
  }
  return proofs.length === 1 ? proofs[0]! : null
}

async function readVerifiedVisualBlob(scope: WorkspaceScope, asset: ProductMediaAsset) {
  const bindings = await db.productMediaBlobs.where('mediaAssetId').equals(asset.id!).toArray()
  if (bindings.length !== 1) throw new Error('已生成图片缺少唯一的持久化字节')
  await readProductMediaBlobData({scope, blob: bindings[0]!, expected: asset})
}

function visualAssetHasProof(asset: ProductMediaAsset, proof: SavedVisualResult) {
  if (asset.contentHash !== proof.result.contentHash || asset.source !== proof.result.rights.adapterId
    || asset.license !== JSON.stringify(proof.result.rights)) return false
  if (asset.exactArtifactRefsJson == null) return true // legacy saved image: Run artifact and verified bytes still bind the result
  try {
    const refs: Array<{artifactKind: string; contentHash: string}> = JSON.parse(asset.exactArtifactRefsJson)
    return refs.some(ref => ref.artifactKind === 'tool-result' && ref.contentHash === proof.artifactHash)
  } catch { return false }
}

interface DurableVisualJob {
  job: ChatRuntimeVisualJobV1
  snapshot: AgentRunSnapshotV1
  payload: VisualPayload
  proof: SavedVisualResult | null
}

async function readDurableVisualJobs(scope: WorkspaceScope, sessionId: number): Promise<DurableVisualJob[]> {
  scope = {...scope}
  const session = await db.productRuntimeSessions.get(sessionId)
  if (!session || session.kind !== 'character-interaction' || session.projectId !== scope.projectId || session.workId !== scope.workId || session.worldId !== scope.worldId) throw new Error('聊天图片不属于当前存档')
  const runs = (await db.agentRuns.where('productRuntimeSessionId').equals(sessionId).toArray()).filter(run => run.contractJson.includes(`"skillId":"${SKILL}"`))
  const assets = await db.productMediaAssets.where('productRuntimeSessionId').equals(sessionId).toArray()
  const jobs: DurableVisualJob[] = []
  for (const run of runs) {
    const saved = await readLatestVerifiedAgentRunCheckpointV1(scope, run.id!, {owner: 'instance'})
    const payload = saved?.resumePayload as VisualPayload | undefined
    if (!saved || payload?.kind !== KIND || payload.version !== 1 || payload.context.releaseHash !== session.runtimeSourceHash
      || saved.snapshot.run.productRuntimeSessionId !== sessionId
      || saved.snapshot.contract.scope.runtime?.releaseHash !== payload.context.releaseHash) continue
    const snapshot = saved.snapshot
    const boundHash = await hashCanonicalValue({context: payload.context, request: payload.request})
    if (boundHash !== snapshot.contract.runtimeBindingHash) throw new Error('图片请求与冻结情境绑定不一致')
    const assetKey = visualAssetKey(payload.request.key, payload.slotAttempt ?? 1)
    const owned = assets.filter(asset => asset.ownerKind === 'runtime' && asset.productType === 'character-interaction'
      && asset.productRuntimeSessionId === sessionId && asset.productReleaseId === null && asset.projectId === scope.projectId
      && asset.worldId === scope.worldId && asset.workId === scope.workId && asset.kind === payload.request.kind
      && asset.assetKey === assetKey && asset.sceneTag === payload.request.frameKey
      && asset.characterTag === (payload.request.participantKey ?? ''))
    const proof = owned.length && snapshot.projection.state !== 'completed' ? await readVisualResult(snapshot, payload) : null
    const candidateHash = snapshot.projection.steps[STEP]?.candidateHash
    const matching = owned.filter(asset => proof && visualAssetHasProof(asset, proof)
      || candidateHash && payload.asset?.assetKey === asset.assetKey && payload.asset.contentHash === asset.contentHash)
    let asset = matching.length === 1 ? matching[0]! : null
    if (asset && snapshot.projection.state !== 'completed') {
      try { await readVerifiedVisualBlob(scope, asset) } catch { asset = null }
    }
    const locallyRecoverable = asset && proof && visualAssetHasProof(asset, proof)
      && ['running', 'paused', 'recovering', 'verifying'].includes(snapshot.projection.state)
      && !snapshot.events.some(event => event.type === 'verification.staled' && event.payload.reason === 'project-import-scope-rebound')
    jobs.push({
      snapshot, payload, proof: locallyRecoverable ? proof : null,
      job: {
        runId: run.id!, request: payload.request, asset,
        status: asset ? 'available' : payload.status === 'failed' && !owned.length ? 'failed' : 'unknown',
        issue: asset
          ? locallyRecoverable ? pendingVerification
            : payload.status === 'failed' ? '原图片已保存，原运行的终验未补齐；不会重新请求同一张。' : null
          : owned.length ? '原图片已保存但证据暂不可核验；不会重新请求同一张。' : payload.issue,
      },
    })
  }
  return jobs
}

/** Refresh projects verified image bytes without writing receipts or dispatching. */
export async function readChatRuntimeVisualJobsV1(scope: WorkspaceScope, sessionId: number): Promise<ChatRuntimeVisualJobV1[]> {
  return (await readDurableVisualJobs(scope, sessionId)).map(item => item.job)
}

async function settleSavedVisual(
  scope: WorkspaceScope, initial: AgentRunSnapshotV1, payload: VisualPayload, asset: ProductMediaAsset, proof: SavedVisualResult,
) {
  let snapshot = initial
  if (!visualAssetHasProof(asset, proof)) throw new Error('原图片与已保存的返回证据不一致')
  await readVerifiedVisualBlob(scope, asset)
  if (snapshot.projection.state === 'paused' || snapshot.projection.state === 'recovering') {
    const owner = {scope, runId: snapshot.run.id, productRuntimeSessionId: snapshot.run.productRuntimeSessionId ?? undefined}
    const recovery = await beginAgentRunRecoveryV1({...owner, expectedLastSequence: snapshot.projection.lastSequence})
    snapshot = await completeAgentRunRecoveryV1({...owner, checkpointHash: recovery.checkpointHash})
  }
  if (snapshot.projection.state === 'completed') return
  const outputHash = proof.outputHash
  const step = snapshot.projection.steps[STEP]
  if (!step || step.attempt !== 1 || (step.candidateHash && step.candidateHash !== outputHash)
    || (step.outputHash && step.outputHash !== outputHash)) throw new Error('原图片候选或已结算指纹不一致')
  const responses = snapshot.events.filter(event => event.type === 'model.responded' && event.generation === snapshot.projection.generation
    && event.payload.stepId === STEP && event.payload.attempt === 1)
  if (responses.some(event => event.type === 'model.responded' && event.payload.outputHash !== outputHash)) {
    throw new Error('原图片返回指纹不一致')
  }
  if (!responses.length) snapshot = await append(scope, snapshot, 'model.responded', {stepId: STEP, attempt: 1, outputHash})
  if (!step.candidateHash) snapshot = await append(scope, snapshot, 'candidate.persisted', {
    stepId: STEP, attempt: 1, candidateHash: outputHash, requiresConfirmation: false,
  })
  if (payload.status !== 'available' || payload.asset?.contentHash !== asset.contentHash || payload.issue) {
    snapshot = await checkpoint(scope, snapshot, {
      ...payload, status: 'available', asset: {assetKey: asset.assetKey, contentHash: asset.contentHash}, issue: null,
    })
  }
  if (snapshot.projection.steps[STEP]?.status !== 'succeeded') {
    snapshot = await append(scope, snapshot, 'step.succeeded', {stepId: STEP, attempt: 1, outputHash})
  }
  if (snapshot.projection.state !== 'verifying') {
    snapshot = await append(scope, snapshot, 'verification.started', {verifierSetVersion: VERIFIER})
  }
  const receiptBody = {
    version: 1 as const, runId: snapshot.run.id, generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash, contextManifestHashes: [payload.manifestHash],
    candidateHashes: [outputHash], adoptionEventIds: [], postStateHash: asset.contentHash, verifierSetVersion: VERIFIER,
    criteria: [{id: 'visual.bytes-and-owner', status: 'passed' as const, evidenceRefs: [`asset:${asset.assetKey}:${asset.contentHash}`]}],
  }
  let receiptHash: string | null = null
  for (const {body} of await visualToolResults(snapshot)) {
    if (!body || typeof body !== 'object' || !('receiptHash' in body)) continue
    const receipt = parseVerificationReceiptV1(body)
    const expected = await createVerificationReceiptV1({...receiptBody, acceptedAt: receipt.acceptedAt})
    if (!await verifyVerificationReceiptIntegrityV1(receipt) || receipt.receiptHash !== expected.receiptHash) {
      throw new Error('原图片已有终验回执与当前证据不一致')
    }
    if (receiptHash && receiptHash !== receipt.receiptHash) throw new Error('原图片存在多个终验回执')
    receiptHash = receipt.receiptHash
  }
  if (!receiptHash) {
    const receipt = await createVerificationReceiptV1({...receiptBody, acceptedAt: Date.now()})
    snapshot = (await recordAgentRunArtifactV1({scope, runId: snapshot.run.id, productRuntimeSessionId: snapshot.run.productRuntimeSessionId ?? undefined,
      artifactKind: 'tool-result', content: JSON.stringify(receipt), stepId: STEP, attempt: 1, expectedLastSequence: snapshot.projection.lastSequence})).snapshot
    receiptHash = receipt.receiptHash
  }
  await append(scope, snapshot, 'verification.accepted', {receiptHash})
}

/** One provider attempt per durable run. A confirmed failure can receive at
 * most two explicit new attempts; refresh and unknown outcomes never retry. */
export async function generateChatRuntimeVisualsV1(input: {
  scope: WorkspaceScope; sessionId: number; signal?: AbortSignal
  /** A separate visible player command; never enabled by automatic updates. */
  retryFailed?: boolean
  /** Inject the real adapter with a test transport, not an alternate image path. */
  capability?: ResolvedProductMediaCapabilityV1
  onProgress?: () => void
}): Promise<ChatRuntimeVisualJobV1[]> {
  input = {...input, scope: {...input.scope}}
  if (locks.has(input.sessionId)) return readChatRuntimeVisualJobsV1(input.scope, input.sessionId)
  locks.add(input.sessionId)
  const action = async () => {
    const assembled = await assembleContext({projectId: input.scope.projectId, scope: input.scope, productRuntimeSessionId: input.sessionId,
      sourceKeys: [SOURCE], inputBudgetMaxTokens: 12000})
    if (assembled.included.join(',') !== SOURCE || assembled.trimmed.length || assembled.overBudgetAfterTrim
      || assembled.sourceEvidence?.some(source => source.delivery !== 'full')) throw new Error('当前画面资料无法完整读取，未调用图片服务')
    const context = JSON.parse(assembled.segments[0].content) as ChatRuntimeVisualContextV1
    const before = await readDurableVisualJobs(input.scope, input.sessionId)
    for (const saved of before) {
      if (input.signal?.aborted) return before.map(item => item.job)
      if (!saved.proof || !saved.job.asset) continue
      try { await settleSavedVisual(input.scope, saved.snapshot, saved.payload, saved.job.asset, saved.proof) }
      catch { return readChatRuntimeVisualJobsV1(input.scope, input.sessionId) }
      input.onProgress?.()
    }
    const jobs = await readChatRuntimeVisualJobsV1(input.scope, input.sessionId)
    const latest = latestChatVisualJobsV1(jobs)
    const pending = context.requests.filter(request => !latest.has(request.key)
      || input.retryFailed === true && latest.get(request.key)?.status === 'failed'
        && jobs.filter(job => job.request.key === request.key).length < 3)
    if (!pending.length) return jobs
    if (jobs.length + pending.length > context.maximumImages) throw new Error('此存档的剧情配图次数已用完，仍可继续文字聊天')
    const capability = input.capability ?? await resolveConfiguredAgnesImageCapabilityV1({projectId: input.scope.projectId, requirement: {
      requirementKey: 'chat.runtime.image', mediaClass: 'image', operation: 'generate', adapterFamily: 'image', minimumCapabilityVersion: '1',
      allowedDataClasses: ['product-public-presentation'], maximumRequestCost: null, maximumTotalCost: null,
      rightsPolicyVersion: 'chat-runtime-visual-v1', capabilityHash: await hashCanonicalValue('chat-runtime-visual-v1'), required: true}})
    for (const request of pending) {
      if (input.signal?.aborted) break
      const fresh = await readChatRuntimeVisualContextV1(input.scope, input.sessionId)
      if (fresh.stateHash !== context.stateHash || fresh.releaseHash !== context.releaseHash) break
      const session = await db.productRuntimeSessions.get(input.sessionId)
      if (!session) break
      const slotAttempt = jobs.filter(job => job.request.key === request.key).length + 1
      const bindingHash = await hashCanonicalValue({context, request}), skill = getAgentSkillV1(SKILL)
      let snapshot = await createAgentRunV1({scope: input.scope, productRuntimeSessionId: input.sessionId, worldGroupId: session.worldGroupId ?? null,
        contract: {version: 1, objective: '表现当前已提交剧情，不改变角色、故事或发布版本', workflowKind: 'direct-generation',
          scope: {projectId: input.scope.projectId, worldGroupId: session.worldGroupId ?? null, runtime: {productRuntimeSessionId: input.sessionId,
            baseSequence: context.sequence, stateHash: context.stateHash, visibilityHash: await hashCanonicalValue(context), releaseHash: context.releaseHash}},
          permissions: {contextSourceKeys: [SOURCE], writeTargets: []}, runtimeBindingHash: bindingHash,
          executionBindings: [{stepId: STEP, ...createAgentSkillExecutionBindingV1(skill)}],
          budget: {maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 12000, maxOutputTokens: 1, maxAttemptsPerStep: 1},
          acceptance: [{id: 'visual.bytes-and-owner', kind: 'deterministic-check', required: true}],
          verificationPlan: [{id: 'visual.terminal', kind: 'terminal', verifier: VERIFIER, criterionIds: ['visual.bytes-and-owner']}],
          failurePolicy: {onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author'}}})
      snapshot = await append(input.scope, snapshot, 'step.scheduled', {stepId: STEP})
      snapshot = await append(input.scope, snapshot, 'step.started', {stepId: STEP, attempt: 1})
      const manifest = await createContextManifestFromAssemblyV1({runId: snapshot.run.id, stepId: STEP, attempt: 1,
        projectId: input.scope.projectId, worldGroupId: session.worldGroupId ?? null, assembled, declaredSourceKeys: [SOURCE], readerVersion: 'chat-runtime-visual-v1'})
      snapshot = await append(input.scope, snapshot, 'context.assembled', {stepId: STEP, attempt: 1, manifestHash: manifest.manifestHash})
      const payload: VisualPayload = {kind: KIND, version: 1, context, request, manifestHash: manifest.manifestHash, status: 'prepared', asset: null, issue: null,
        slotAttempt, explicitRetry: slotAttempt > 1}
      snapshot = await checkpoint(input.scope, snapshot, payload)
      const mediaRequest: ProductMediaRequestV1 = {schema: 'storyforge.product-media-request', version: 1,
        requestId: `chat-visual-${snapshot.run.id}`, adapterId: capability.adapter.capability.adapterId, mediaClass: 'image', mediaKind: request.kind,
        requirementKey: 'chat.runtime.image', artifactKey: visualAssetKey(request.key, slotAttempt), prompt: request.prompt,
        negativePrompt: '文字、水印、未发生的情节、额外人物、改变角色身份', count: 1,
        width: request.kind === 'character-expression' ? 768 : 1536, height: 1024, durationMs: null, inputHash: bindingHash,
        qualityProfile: 'internal', environment: 'production', allowedDataClasses: ['product-public-presentation'], rightsPolicyVersion: 'chat-runtime-visual-v1'}
      snapshot = (await recordAgentRunArtifactV1({scope: input.scope, runId: snapshot.run.id, productRuntimeSessionId: input.sessionId,
        artifactKind: 'tool-result', content: JSON.stringify({manifest, mediaRequest}), stepId: STEP, attempt: 1,
        expectedLastSequence: snapshot.projection.lastSequence})).snapshot
      snapshot = await append(input.scope, snapshot, 'model.requested', {stepId: STEP, attempt: 1, bindingHash: await hashCanonicalValue(mediaRequest)})
      payload.status = 'requested'; snapshot = await checkpoint(input.scope, snapshot, payload); input.onProgress?.()
      let stage: HarnessFailureClassV1 = 'provider'
      let savedAsset: ProductMediaAsset | null = null
      let proof: SavedVisualResult | null = null
      try {
        const candidates = await capability.adapter.generate(mediaRequest, capability.transport, input.signal ?? new AbortController().signal)
        stage = 'parse'
        if (candidates.length !== 1) throw new Error('图片返回数量不符合请求')
        const candidate = await capability.adapter.parseAndVerify(candidates[0])
        // Chat consumes an image card, not a composited stage sprite. Keep the
        // provider's original pixels instead of risking destructive keying.
        const data = candidate.data, mimeType = candidate.mimeType
        const dimensions = detectProductImageDimensionsV1(data)
        if (!dimensions) throw new Error('图片格式或尺寸无法验证')
        // Keep the exact provider response proof before binding any bytes.
        // The media transaction records the same evidence reference, so a
        // later write failure cannot turn an already paid image into a retry.
        stage = 'save'
        const result: VisualResult = {
          requestKey: request.key, assetKey: mediaRequest.artifactKey, contentHash: candidate.contentHash,
          originalContentHash: candidate.contentHash, providerReceipt: candidate.providerReceipt,
          rights: candidate.rights, preservesOriginalPixels: true,
        }
        const outputHash = await hashCanonicalValue(result)
        const recorded = await recordAgentRunArtifactV1({scope: input.scope, runId: snapshot.run.id, productRuntimeSessionId: input.sessionId,
          artifactKind: 'tool-result', content: JSON.stringify(result), stepId: STEP, attempt: 1, expectedLastSequence: snapshot.projection.lastSequence})
        snapshot = recorded.snapshot
        proof = {result, artifactHash: recorded.artifact.contentHash, outputHash}
        savedAsset = await importProductRuntimeMediaAssetV1({scope: input.scope, productRuntimeSessionId: input.sessionId,
          assetKey: mediaRequest.artifactKey, kind: request.kind, name: request.alt.slice(0, 200), altText: request.alt,
          blob: new Blob([data], {type: mimeType}), width: dimensions.width, height: dimensions.height,
          source: candidate.adapterId, license: JSON.stringify(candidate.rights), characterTag: request.participantKey ?? '', sceneTag: request.frameKey,
          exactArtifactRefs: [{artifactKind: 'tool-result', contentHash: proof.artifactHash}],
        })
        if (!input.signal?.aborted) await settleSavedVisual(input.scope, snapshot, payload, savedAsset, proof)
      } catch (cause) {
        const ownedOutput = savedAsset || (proof && await db.productMediaAssets.where('productRuntimeSessionId').equals(input.sessionId)
          .filter(asset => asset.ownerKind === 'runtime' && asset.assetKey === mediaRequest.artifactKey).first())
        if (ownedOutput) {
          input.onProgress?.()
          break
        }
        const evidence = await classifyHarnessFailureV1(cause, {stage})
        const status = cause instanceof AIError ? cause.status : undefined
        const unknown = stage === 'provider' && !(typeof status === 'number' && status >= 400)
        payload.status = unknown ? 'requested' : 'failed'
        payload.issue = `${unknown ? '图片请求结果尚未确认' : `图片${evidence.label}未完成${status ? `（HTTP ${status}）` : ''}`}；已保留请求，没有自动重发。可继续聊天。`
        // Only a safe classification/fingerprint is retained; provider error
        // bodies can contain endpoint credentials and must not enter evidence.
        snapshot = (await recordAgentRunArtifactV1({scope: input.scope, runId: snapshot.run.id, productRuntimeSessionId: input.sessionId,
          artifactKind: 'tool-result', content: JSON.stringify({requestKey: request.key, failure: evidence, outcome: unknown ? 'unknown' : 'failed', status}),
          stepId: STEP, attempt: 1, expectedLastSequence: snapshot.projection.lastSequence})).snapshot
        snapshot = await checkpoint(input.scope, snapshot, payload)
        if (unknown) await append(input.scope, snapshot, 'run.paused', {reason: payload.issue, recoverable: true})
        else {
          snapshot = await append(input.scope, snapshot, 'step.failed', {stepId: STEP, attempt: 1, code: evidence.code, fingerprint: evidence.fingerprint, retryable: false, category: 'deterministic', action: 'fail'})
          await append(input.scope, snapshot, 'run.failed', {code: evidence.code, retryable: false})
        }
        input.onProgress?.(); break
      }

      input.onProgress?.()
    }
    return readChatRuntimeVisualJobsV1(input.scope, input.sessionId)
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request(`storyforge:chat-media:${db.name}:${input.sessionId}`, {ifAvailable: true}, async lock => {
      if (!lock) return readChatRuntimeVisualJobsV1(input.scope, input.sessionId)
      return action()
    })
    if (typeof window !== 'undefined' && !input.capability) throw new Error('当前浏览器不支持图片请求锁定')
    return await action()
  } finally {locks.delete(input.sessionId)}
}
