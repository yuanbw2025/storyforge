import type { ProductProductionCapabilityBindingV1 } from '../product-production/scheduler'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assertExactRunArtifactBodySafeV1 } from '../memory/evidence-policy'
import { avgHash, avgKey } from './protocol-validation'
import { AVG_SOUND_MUSIC_CAPABILITY_V1, parseAvgSoundPlanningBriefV1 } from './sound-production-brief'
import { AVG_LOCAL_MUSIC_MODEL_V1 } from './sound-requirements'
import { AVG_LOCAL_SOUND_BASE_URL_V1, AVG_LOCAL_MUSIC_ADAPTER_V1, avgLocalMusicRouteV1, parseAvgLocalMusicCapabilityV1,
  assertAvgLicensedSoundSourceV1, hashAvgSoundBytesV1, validateAvgSoundProviderResultV1, type AvgCompiledSoundRequirementV1 } from './sound-provider-contract'

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export const AVG_SOUND_NETWORK_TIMEOUT_MS_V1 = 840_000
export interface AvgSoundHttpResponseV1 {
  status: number; contentType: 'audio/wav' | 'audio/ogg'; providerRequestId: string | null; result: unknown
  body: ArrayBuffer; evidenceHash: string; costUsd: 0
}
export class AvgSoundTransportErrorV1 extends Error {
  constructor(readonly disposition: 'not-dispatched' | 'response-recorded' | 'result-unknown', message: string) { super(`[avg-sound] ${message}`) }
}
export function avgSoundBase64V1(data: ArrayBuffer) {
  const bytes = new Uint8Array(data); let text = ''
  for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384))
  return btoa(text)
}
export function avgSoundFromBase64V1(value: unknown): ArrayBuffer {
  if (typeof value !== 'string' || value.length > 12 * 1024 * 1024 || value.length % 4 || /[^A-Za-z0-9+/=]/.test(value)) throw new Error('[avg-sound] 原始音频编码无效或越界')
  const decoded = atob(value)
  if (btoa(decoded) !== value) throw new Error('[avg-sound] 原始音频编码不是准确规范字节')
  return Uint8Array.from(decoded, c => c.charCodeAt(0)).buffer
}
function interrupted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('Aborted', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    pending.then(v => { signal.removeEventListener('abort', abort); resolve(v) }, e => { signal.removeEventListener('abort', abort); reject(e) })
    if (signal.aborted) abort()
  })
}
async function boundedBody(response: Response, maximum: number, signal: AbortSignal) {
  const reader = response.body?.getReader(), chunks: Uint8Array[] = []
  let length = 0, complete = !reader
  try {
    if (reader) while (true) {
      const part = await interrupted(reader.read(), signal)
      if (part.done) { complete = true; break }
      if (length + part.value.byteLength > maximum) break
      chunks.push(part.value.slice()); length += part.value.byteLength
    }
  } catch { /* Preserve exactly the retained prefix; never call it complete. */ }
  finally { if (reader && !complete) void reader.cancel().catch(() => {}); reader?.releaseLock() }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return { data: bytes.buffer, complete }
}
async function readIdentity(fetcher: Fetcher, parent?: AbortSignal) {
  const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 5000)
  parent?.addEventListener('abort', abort, { once: true })
  if (parent?.aborted) abort()
  try {
    const response = await interrupted(fetcher(`${AVG_LOCAL_SOUND_BASE_URL_V1}/capabilities`, { method: 'GET', credentials: 'omit',
      redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal }), controller.signal)
    const body = await boundedBody(response, 8192, controller.signal)
    if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json') || !body.complete || controller.signal.aborted) throw new Error('identity')
    return parseAvgLocalMusicCapabilityV1(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.data)))
  } finally { clearTimeout(timer); parent?.removeEventListener('abort', abort) }
}
/** Read-only local preflight; never loads a model or creates a production. */
export async function resolveAvgLocalMusicCapabilityV1(fetcher: Fetcher = globalThis.fetch) {
  const capability = await readIdentity(fetcher)
  if (capability.version !== 2 || !capability.journalId) throw new Error('[avg-sound] 旧版或记录身份缺失的音乐服务仅可只读核验，不能准备新生成')
  const route = await avgLocalMusicRouteV1(capability)
  return { capability, ...route, binding: { requirementKey: AVG_SOUND_MUSIC_CAPABILITY_V1, adapterId: AVG_LOCAL_MUSIC_ADAPTER_V1,
    bindingHash: route.bindingHash, provider: 'storyforge-local-music', model: AVG_LOCAL_MUSIC_MODEL_V1 } satisfies ProductProductionCapabilityBindingV1 }
}

/** One POST for music or one original member GET. No retry, fallback, polling,
 * adoption or Work access. Every received response precedes candidate parsing. */
export function createConfiguredAvgSoundTransportV1(input: { declaration: unknown; fetcher?: Fetcher }) {
  const sound = parseAvgSoundPlanningBriefV1(input.declaration), fetcher: Fetcher = input.fetcher ?? ((url, init) => globalThis.fetch(url, init))
  const binding: ProductProductionCapabilityBindingV1 | null = sound.musicBinding ? { requirementKey: AVG_SOUND_MUSIC_CAPABILITY_V1,
    adapterId: AVG_LOCAL_MUSIC_ADAPTER_V1, bindingHash: sound.musicBinding.bindingHash, provider: 'storyforge-local-music', model: AVG_LOCAL_MUSIC_MODEL_V1 } : null
  return Object.freeze({ binding: binding ? Object.freeze(binding) : null, endpointRouteHash: sound.musicBinding?.endpointRouteHash ?? null,
    request: async (request: { requirement: AvgCompiledSoundRequirementV1; idempotencyKey: string; signal: AbortSignal;
      beforeDispatch?: (capability: ReturnType<typeof parseAvgLocalMusicCapabilityV1> | null) => Promise<void>;
      onResponse: (evidence: string) => Promise<void | 'discarded-stale'> }): Promise<AvgSoundHttpResponseV1> => {
      const req = structuredClone(request.requirement), generated = req.dispatch.operation === 'generate-music'
      const controller = new AbortController(), abort = () => controller.abort()
      const timer = setTimeout(abort, generated ? AVG_SOUND_NETWORK_TIMEOUT_MS_V1 : 30_000)
      request.signal.addEventListener('abort', abort, { once: true })
      let dispatched = false, recorded = false
      try {
        avgKey(request.idempotencyKey, 'sound request id'); avgHash(req.identityHash, 'sound request identity')
        if (request.signal.aborted || typeof request.onResponse !== 'function') throw new Error('preflight')
        let bridgeHash: string | null = null, jobId: string | null = null
        let capability: ReturnType<typeof parseAvgLocalMusicCapabilityV1> | null = null
        if (generated) {
          if (!binding || !sound.musicBinding) throw new Error('unfrozen route')
          const identity = await readIdentity(fetcher, controller.signal), route = await avgLocalMusicRouteV1(identity)
          if (identity.version !== 2 || !identity.journalId || route.bindingHash !== binding.bindingHash || route.endpointRouteHash !== sound.musicBinding.endpointRouteHash) throw new Error('local bridge or journal changed')
          bridgeHash = identity.bridgeHash
          capability = identity
          jobId = await hashAvgSoundBytesV1(new TextEncoder().encode(request.idempotencyKey).buffer)
        } else assertAvgLicensedSoundSourceV1(req)
        await request.beforeDispatch?.(capability)
        if (controller.signal.aborted || request.signal.aborted) throw new Error('cancelled before dispatch')
        const url = req.dispatch.operation === 'generate-music' ? `${AVG_LOCAL_SOUND_BASE_URL_V1}/audio/music`
          : `${AVG_LOCAL_SOUND_BASE_URL_V1}/library/audio/${req.dispatch.source.archiveHash}/${req.dispatch.source.memberHash}`
        dispatched = true
        const response = await interrupted(fetcher(url, { method: generated ? 'POST' : 'GET', credentials: 'omit', redirect: 'error',
          cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
          ...(req.dispatch.operation === 'generate-music' ? { headers: { 'Content-Type': 'application/json', 'x-storyforge-idempotency-key': request.idempotencyKey },
            body: canonicalProductProductionJsonV2(req.dispatch.body) } : {}) }), controller.signal)
        const body = await boundedBody(response, 8 * 1024 * 1024, controller.signal)
        if (body.complete) clearTimeout(timer)
        const rawHeader = response.headers.get(generated ? 'x-storyforge-music-result' : 'x-storyforge-library-result')
        let providerResult: unknown = null
        if (rawHeader !== null && rawHeader.length <= 8192) { try { providerResult = JSON.parse(rawHeader) } catch { /* retained below */ } }
        const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
        let bodyAllowed = true
        try {
          const text = new TextDecoder().decode(body.data)
          assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body: text })
          const leading = text.trimStart()
          if (leading.startsWith('{') || leading.startsWith('[')) assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body: JSON.parse(text) })
        } catch { bodyAllowed = false }
        const evidence = canonicalProductProductionJsonV2({ schema: 'storyforge.avg.sound-provider-response', version: 1,
          operation: req.dispatch.operation, requestIdentityHash: req.identityHash, requestBodyHash: generated
            ? await hashProductProductionValueV2(req.dispatch.operation === 'generate-music' ? req.dispatch.body : null) : null,
          endpointRouteHash: generated ? sound.musicBinding!.endpointRouteHash : null,
          capabilityBindingHash: binding && generated ? binding.bindingHash : null, bridgeHash, jobId, capability,
          status: response.status, contentType, resultHeader: rawHeader && rawHeader.length <= 8192 ? rawHeader : null,
          result: providerResult, bodyComplete: body.complete, bodyHash: await hashAvgSoundBytesV1(body.data),
          bodyBase64: bodyAllowed ? avgSoundBase64V1(body.data) : null, bodyOmitted: bodyAllowed ? null : 'policy',
          hashScope: body.complete ? 'full-body' : 'retained-prefix', automaticRetryAllowed: false })
        assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body: JSON.parse(evidence) })
        if (await request.onResponse(evidence) === 'discarded-stale') throw new Error('stale response')
        recorded = true
        if (!body.complete || controller.signal.aborted || request.signal.aborted) throw new AvgSoundTransportErrorV1('result-unknown', '已发送但结果不完整/已取消，原记录保留且禁止重发')
        if (!response.ok || !bodyAllowed) throw new AvgSoundTransportErrorV1('response-recorded', `原声音响应HTTP ${response.status}已保存，未产生可用候选`)
        const valid = await validateAvgSoundProviderResultV1({ requirement: req, data: body.data, result: providerResult, jobId, bridgeHash,
          providerJournalId: capability?.journalId ?? null })
        if (valid.mimeType !== contentType || generated && response.headers.get('x-request-id') !== jobId) throw new Error('original MIME/request id differs')
        return { status: response.status, contentType: valid.mimeType, providerRequestId: jobId, result: providerResult,
          body: body.data, costUsd: 0, evidenceHash: await hashAvgSoundBytesV1(new TextEncoder().encode(evidence).buffer) }
      } catch (error) {
        if (error instanceof AvgSoundTransportErrorV1) throw error
        throw new AvgSoundTransportErrorV1(recorded ? 'response-recorded' : dispatched ? 'result-unknown' : 'not-dispatched',
          recorded ? '原始响应已保存，但声音字节或冻结身份未通过' : dispatched ? '发送后结果未知，保留预留且禁止重发' : '调用前核验失败，未发送声音生产请求')
      } finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort) }
    } })
}
