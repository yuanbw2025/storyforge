import { db } from '../db/schema'
import type { AIConfig, WorkspaceScope, AgentRunFormalAIEntryBindingV1 } from '../types'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'
import { assembleContext } from '../registry/assemble-context'
import { getAgentSkillV1, type AgentSkillDefinitionV1 } from '../agent/skill-registry'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { executeFrozenFormalImageEntryV1, freezeFormalAIEntryBindingV1 } from '../agent/formal-ai-entry'
import { agentRunScopeTransactionTablesV1, appendPrivilegedAgentRunEventInTransactionV1, createAgentRunV1, readVerifiedAgentRunInTransactionV1 } from '../agent/run/event-store'
import { createContextManifestFromAssemblyV1 } from '../agent/run/context-manifest'
import { createAgentRunCheckpointInTransactionV1, createAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { canonicalStringify } from '../agent/run/hash'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { sha256BinaryV1 } from '../media/blob-store'
import { assertGenerationAvailable } from '../showcase/policy'
import { assertLongformCoverWorkV1, coverRecordInScopeV1 } from './drafts'
import { buildCoverImageRequestV1, resolveWorkCoverImageRouteV1 } from './image-recipes'
import type { WorkCoverImageRouteV1 } from './image-recipes'
import type { WorkCoverResponseBufferV1 } from './types'
import { WORK_COVER_MAX_RESPONSE_BYTES_V1 } from './contracts'
import { appendCoverEvidenceOnceV1, failCoverRunV1, WORK_COVER_SOURCES_V1, WORK_COVER_STEP_V1 as STEP } from './run-evidence'

export interface CoverImageConnectionV1 { config: AIConfig; presetId: string; imageModel: string }
export interface CoverRunAuthorizationV1 { readonly runId: number; readonly dispatchKey: string; readonly route: WorkCoverImageRouteV1 }
const permits = new WeakMap<CoverRunAuthorizationV1, {
  scope: WorkspaceScope; bufferId: number; currentConnection: () => CoverImageConnectionV1; consumed: boolean
  skill: AgentSkillDefinitionV1; formalEntry: AgentRunFormalAIEntryBindingV1
}>()
export const WORK_COVER_RESPONSE_WAIT_MS_V1 = 180_000

/** Explicit local recovery after the waiting page was closed. This grants no
 * dispatch permit; an eventual original response may still be saved locally. */
export async function acknowledgeExpiredCoverWaitV1(scope: WorkspaceScope, runId: number) {
  await db.transaction('rw', agentRunScopeTransactionTablesV1(runId, db.workCoverResponseBuffers,
    db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints), async () => {
    await resolveScope({ scope })
    const row = await db.workCoverResponseBuffers.where('runId').equals(runId).first()
    if (!row || !coverRecordInScopeV1(scope, row)) throw new Error('图片请求不属于这部作品。')
    if (row.state === 'outcome-unknown') return
    if (row.state !== 'dispatch-intent') throw new Error('图片状态已变化，请重新载入。')
    const now = Date.now()
    if (now - row.updatedAt < WORK_COVER_RESPONSE_WAIT_MS_V1) throw new Error('原请求仍在等待窗口内，请稍后查看。')
    const snapshot = await readVerifiedAgentRunInTransactionV1(scope, runId)
    if (snapshot.contract.runtimeBindingHash !== row.routeHash || !snapshot.events.some(event => event.type === 'model.requested'
      && event.payload.stepId === STEP && event.payload.bindingHash === row.routeHash)) throw new Error('图片请求缺少发送证据。')
    const paused = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, {
      version: 1, runId, projectId: scope.projectId, worldGroupId: null, generation: snapshot.run.generation,
      contractHash: snapshot.run.contractHash, sequence: snapshot.projection.lastSequence + 1, createdAt: now,
      type: 'run.paused', payload: { reason: 'image-outcome-unknown-no-resend', recoverable: true },
    })
    await createAgentRunCheckpointInTransactionV1({ snapshot: paused, now, resumePayload: {
      kind: 'work-cover.awaiting-response', version: 1, portable: false, dispatchKey: row.dispatchKey, authorizedPost: false,
    } })
    await db.workCoverResponseBuffers.update(row.id!, { state: 'outcome-unknown', errorCode: 'image-outcome-unknown', updatedAt: now })
  })
}

export async function prepareCoverRunV1(input: {
  scope: WorkspaceScope; draftId: number; expectedDraftRevision: number
  connection: CoverImageConnectionV1; currentConnection: () => CoverImageConnectionV1; signal?: AbortSignal
}): Promise<CoverRunAuthorizationV1> {
  assertGenerationAvailable(); input.signal?.throwIfAborted()
  const scope = await resolveScope({ scope: input.scope })
  const route = await resolveWorkCoverImageRouteV1(input.connection)
  const assembled = await assembleContext({ projectId: scope.projectId, scope, worldGroupId: null,
    sourceKeys: [...WORK_COVER_SOURCES_V1], workCoverDraftId: input.draftId,
    workCoverDraftRevision: input.expectedDraftRevision, inputBudgetTokens: 16_000 })
  if (assembled.overBudgetAfterTrim || assembled.trimmed.length
    || assembled.sourceEvidence?.some(source => source.delivery === 'truncated' || source.delivery === 'compressed')) throw new Error('封面来源未完整交付或超出预算，请缩短输入后重新生成。')
  const prompt = `Create one book-cover image from the following author-approved sources. Do not add lettering unless the author prompt explicitly asks for it.\n${assembled.text}`
  const requestJson = canonicalStringify(buildCoverImageRequestV1(route, prompt))
  const skill = getAgentSkillV1('inspiration.work-cover-image-v1')
  const formalEntry = await freezeFormalAIEntryBindingV1('work-cover.image.generate')
  const snapshot = await createAgentRunV1({ scope, contract: {
    version: 1, objective: '只生成一张可恢复的作品封面图片候选；正式封面须另经作者明确采用', workflowKind: 'direct-generation',
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: { contextSourceKeys: [...WORK_COVER_SOURCES_V1], writeTargets: [{ table: 'works', fields: ['coverImage'], mode: 'candidate-only' }] },
    runtimeBindingHash: route.routeHash, executionBindings: [{ stepId: STEP, ...createAgentSkillExecutionBindingV1(skill), formalEntry }],
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 16_000, maxOutputTokens: 1, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'cover.candidate', kind: 'output-present', required: true }, { id: 'cover.bytes', kind: 'deterministic-check', required: true }],
    verificationPlan: [{ id: 'cover.terminal', kind: 'terminal', verifier: 'work-cover-image-v1', criterionIds: ['cover.candidate', 'cover.bytes'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  } })
  const runId = snapshot.run.id
  try {
    await appendCoverEvidenceOnceV1(scope, runId, 'step.scheduled', { stepId: STEP })
    await appendCoverEvidenceOnceV1(scope, runId, 'step.started', { stepId: STEP, attempt: 1 })
    const manifest = await createContextManifestFromAssemblyV1({ runId, stepId: STEP, attempt: 1,
      projectId: scope.projectId, worldGroupId: null, declaredSourceKeys: WORK_COVER_SOURCES_V1, assembled, readerVersion: 'work-cover-context-v1' })
    await appendCoverEvidenceOnceV1(scope, runId, 'context.assembled', { stepId: STEP, attempt: 1, manifestHash: manifest.manifestHash })
    const dispatchKey = crypto.randomUUID(), contextJson = canonicalStringify(manifest)
    for (const [artifactKind, content] of [
      ['context-manifest', contextJson], ['source-snapshot', assembled.text],
      ['rendered-request', canonicalStringify({ schema: 'storyforge.work-cover.image-request@1', route, dispatchKey, request: JSON.parse(requestJson) })],
    ] as const) await recordAgentRunArtifactV1({ scope, runId, stepId: STEP, attempt: 1, artifactKind, content })
    await createAgentRunCheckpointV1({ scope, runId, resumePayload: { kind: 'work-cover.prepared', version: 1, portable: false, dispatchKey, routeHash: route.routeHash } })
    input.signal?.throwIfAborted()
    const bufferId = await db.transaction('rw', scopeTransactionTables(db.workCoverDrafts, db.workCoverResponseBuffers), async () => {
      const work = await db.works.get(scope.workId)
      assertLongformCoverWorkV1(work, scope)
      const draft = await db.workCoverDrafts.get(input.draftId)
      if (!draft || !coverRecordInScopeV1(scope, draft) || draft.revision !== input.expectedDraftRevision || draft.expectedWorkUpdatedAt !== work.updatedAt) throw new Error('作品或提示词已修改，本次尚未发送。')
      const active = await db.workCoverResponseBuffers.where('workId').equals(scope.workId).filter(row => row.state === 'dispatch-intent').first()
      if (active) throw new Error('此作品已有等待结果的图片请求，请先查看原请求。')
      const now = Date.now()
      const row: WorkCoverResponseBufferV1 = {
        ...scope, version: 1, workCode: work.code, runId, assetKey: crypto.randomUUID(), attempt: 1, dispatchKey,
        draftId: input.draftId, draftRevision: draft.revision, briefHash: draft.briefHash,
        routeHash: route.routeHash, routeJson: canonicalStringify(route), contextJson, contextManifestHash: manifest.manifestHash,
        credentialIdentity: route.credentialIdentity, requestJson, state: 'prepared', httpStatus: null, requestId: null,
        rawResponseHash: null, payload: null, assetId: null, errorCode: null, createdAt: now, updatedAt: now,
      }
      const id = await db.workCoverResponseBuffers.add(row)
      await db.workCoverDrafts.update(input.draftId, { lastRunId: runId, updatedAt: now })
      return id
    })
    const authorization = Object.freeze({ runId, dispatchKey, route: Object.freeze(route) })
    permits.set(authorization, { scope, bufferId, currentConnection: input.currentConnection, consumed: false, skill: structuredClone(skill), formalEntry })
    return authorization
  } catch (error) {
    await failCoverRunV1(scope, runId, 'image-preparation-failed')
    throw error
  }
}

async function readBoundedResponse(response: Response): Promise<ArrayBuffer> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > WORK_COVER_MAX_RESPONSE_BYTES_V1) { await response.body?.cancel(); throw new Error('image-response-too-large') }
  const reader = response.body?.getReader()
  if (!reader) return new ArrayBuffer(0)
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > WORK_COVER_MAX_RESPONSE_BYTES_V1) throw new Error('image-response-too-large')
      chunks.push(next.value)
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  const joined = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return joined.buffer
}

/** Persist the original response before any JSON/image decoding or Blob write. */
export async function observeCoverResponseV1(input: {
  scope: WorkspaceScope; bufferId: number; dispatchKey: string; status: number; requestId: string | null; payload: ArrayBuffer
}) {
  if (input.payload.byteLength > WORK_COVER_MAX_RESPONSE_BYTES_V1) throw new Error('图片原答超过保存上限。')
  const rawResponseHash = await sha256BinaryV1(input.payload)
  const requestId = input.requestId && /^[A-Za-z0-9._:-]{1,200}$/.test(input.requestId) ? input.requestId : null
  await db.transaction('rw', scopeTransactionTables(db.workCoverResponseBuffers), async () => {
    await resolveScope({ scope: input.scope })
    const row = await db.workCoverResponseBuffers.get(input.bufferId)
    if (!row || !coverRecordInScopeV1(input.scope, row) || row.dispatchKey !== input.dispatchKey
      || !['dispatch-intent', 'outcome-unknown'].includes(row.state)) throw new Error('图片原答与原请求不匹配。')
    await db.workCoverResponseBuffers.update(input.bufferId, { state: 'response-observed', payload: input.payload.slice(0),
      rawResponseHash, httpStatus: input.status, requestId, updatedAt: Date.now() })
  })
  return rawResponseHash
}

/** Exactly one author action, one local opaque permit and one durable CAS may
 * enter fetch. Neither refresh nor this function contains a retry loop. */
export async function submitCoverImageOnceV1(authorization: CoverRunAuthorizationV1, signal?: AbortSignal): Promise<void> {
  const permit = permits.get(authorization)
  if (!permit || permit.consumed) throw new Error('本次生成授权已使用；不会重复发送。')
  permit.consumed = true
  const { scope, bufferId } = permit
  let dispatched = false
  const timeout = new AbortController()
  const abort = () => timeout.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => timeout.abort(new DOMException('图片响应等待超时', 'TimeoutError')), WORK_COVER_RESPONSE_WAIT_MS_V1)
  try {
    signal?.throwIfAborted()
    const current = permit.currentConnection(), route = await resolveWorkCoverImageRouteV1(current)
    if (route.routeHash !== authorization.route.routeHash) throw new Error('图片连接已变化，本次尚未发送；请重新明确生成。')
    const row = (await db.workCoverResponseBuffers.get(bufferId))!
    const { skill, formalEntry: entry } = permit
    await executeFrozenFormalImageEntryV1('work-cover.image.generate', entry, skill, 'src/lib/work-cover/run.ts', async () => {
      timeout.signal.throwIfAborted()
      await db.transaction('rw', agentRunScopeTransactionTablesV1(authorization.runId, db.workCoverResponseBuffers, db.workCoverDrafts, db.agentRuns, db.agentRunEvents), async () => {
        await resolveScope({ scope })
        const live = await db.workCoverResponseBuffers.get(bufferId), draft = await db.workCoverDrafts.get(row.draftId), work = await db.works.get(scope.workId)
        assertLongformCoverWorkV1(work, scope)
        if (!live || !coverRecordInScopeV1(scope, live) || live.state !== 'prepared' || live.dispatchKey !== authorization.dispatchKey
          || live.routeHash !== route.routeHash || live.requestJson !== row.requestJson || !draft || !coverRecordInScopeV1(scope, draft)
          || draft.lastRunId !== authorization.runId || draft.revision !== live.draftRevision || draft.briefHash !== live.briefHash || draft.expectedWorkUpdatedAt !== work.updatedAt) throw new Error('作品、提示词或发送状态已变化，本次尚未发送。')
        const snapshot = await readVerifiedAgentRunInTransactionV1(scope, authorization.runId)
        if (snapshot.contract.runtimeBindingHash !== live.routeHash) throw new Error('图片运行绑定已变化。')
        await appendPrivilegedAgentRunEventInTransactionV1(snapshot, {
          version: 1, runId: authorization.runId, projectId: scope.projectId, worldGroupId: null, generation: snapshot.run.generation,
          contractHash: snapshot.run.contractHash, sequence: snapshot.projection.lastSequence + 1, createdAt: Date.now(),
          type: 'model.requested', payload: { stepId: STEP, attempt: 1, bindingHash: route.routeHash },
        })
        await db.workCoverResponseBuffers.update(bufferId, { state: 'dispatch-intent', updatedAt: Date.now() })
      })
      const finalConnection = permit.currentConnection()
      if (finalConnection.presetId !== current.presetId || finalConnection.imageModel !== current.imageModel
        || finalConnection.config.apiKey !== current.config.apiKey || finalConnection.config.baseUrl !== current.config.baseUrl
        || finalConnection.config.provider !== current.config.provider) throw new Error('图片连接在发送前发生变化，本次未发送。')
      timeout.signal.throwIfAborted()
      dispatched = true
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${current.config.apiKey}` }
      if (typeof window !== 'undefined' && window.storyforgeClient?.http) headers['X-Storyforge-Image-Adapter'] = 'work-cover-b64-sync-v1'
      const response = await fetch(route.endpoint, { method: 'POST', headers, body: row.requestJson,
        signal: timeout.signal, credentials: 'omit', redirect: 'error' })
      const payload = await readBoundedResponse(response)
      if (new TextDecoder().decode(payload).includes(current.config.apiKey)) throw new Error('图片原答包含敏感凭据，未保存。')
      await observeCoverResponseV1({ scope, bufferId, dispatchKey: authorization.dispatchKey,
        status: response.status, requestId: response.headers.get('x-request-id'), payload })
      if (!response.ok) {
        const code = `image-http-${response.status}`
        await db.workCoverResponseBuffers.update(bufferId, { state: 'failed', errorCode: code, updatedAt: Date.now() })
        await failCoverRunV1(scope, authorization.runId, code)
        throw new Error(response.status === 401 || response.status === 403 ? '图片连接未获授权，请检查凭据和图片权限；未自动重发。'
          : response.status === 402 ? '图片连接额度不足，请检查账户；未自动重发。' : `图片服务返回 HTTP ${response.status}；未自动重发。`)
      }
    }, { projectId: scope.projectId, category: 'work-cover.image.generate' }, timeout.signal)
  } catch (error) {
    const row = await db.workCoverResponseBuffers.get(bufferId)
    if (row?.state === 'dispatch-intent' || row?.state === 'prepared') {
      await db.workCoverResponseBuffers.update(bufferId, { state: dispatched ? 'outcome-unknown' : 'failed',
        errorCode: dispatched ? 'image-outcome-unknown' : 'image-not-dispatched', updatedAt: Date.now() })
      if (dispatched) {
        await appendCoverEvidenceOnceV1(scope, authorization.runId, 'run.paused', { reason: 'image-outcome-unknown-no-resend', recoverable: true })
        await createAgentRunCheckpointV1({ scope, runId: authorization.runId, resumePayload: { kind: 'work-cover.awaiting-response', version: 1, portable: false, dispatchKey: authorization.dispatchKey, authorizedPost: false } })
      } else await failCoverRunV1(scope, authorization.runId, 'image-not-dispatched')
    }
    if (dispatched && row?.state === 'dispatch-intent') throw new Error('图片请求结果未知；若原答未保存，刷新无法恢复。请查看原请求，不会自动重发。')
    throw error
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
