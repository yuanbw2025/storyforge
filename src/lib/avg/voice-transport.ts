import type { AIConfig, ProviderCapabilityRequirementV1 } from '../types'
import type { ProductProductionCapabilityBindingV1 } from '../product-production/scheduler'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { assertExactRunArtifactBodySafeV1 } from '../memory/evidence-policy'
import { avgKey } from './protocol-validation'
import { assertAvgVoiceAssemblyRequestsV3, assertAvgVoiceCapabilityDeclarationV1, type AvgAssemblyBriefV3 } from './voice-assembly-contract'
import { inspectAvgVoiceWaveV1 } from './voice-wave'
import { AVG_VOICE_NETWORK_TIMEOUT_MS_V1 } from './voice-request-contract'

const MAX_BODY_BYTES = 32 * 1024 * 1024
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface AvgVoiceHttpResponseV1 {
  status: number
  contentType: string
  providerRequestId: string | null
  usage: unknown
  costUsd: number | null
  body: ArrayBuffer
  evidenceHash: string
}

/** The executor maps this disposition into the existing durable reservation
 * ledger. No retry, fallback, polling or candidate write occurs here. */
export class AvgVoiceTransportErrorV1 extends Error {
  constructor(readonly disposition: 'not-dispatched' | 'response-recorded' | 'result-unknown',
    message: string, readonly response: AvgVoiceHttpResponseV1 | null = null) {
    super(`[avg-voice] ${message}`)
    this.name = 'AvgVoiceTransportErrorV1'
  }
}

function speechEndpoint(baseUrl: string): URL {
  let endpoint: URL
  try {
    const root = baseUrl.trim().replace(/\/+$/, '').replace(/\/(?:chat\/completions|images\/generations|audio\/speech)$/i, '')
    endpoint = new URL(`${root}/audio/speech`)
  } catch { throw new Error('[avg-voice] Agnes 配音 Base URL 无效') }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.protocol !== 'https:' && !(loopback && endpoint.protocol === 'http:')) {
    throw new Error('[avg-voice] 配音地址须使用 HTTPS 或本机 HTTP，且不能含凭据、查询或片段')
  }
  return endpoint
}

/** Non-secret route identity only; it does not assert Agnes TTS availability,
 * voice rights, account access or a successful provider request. */
export async function configuredAvgVoiceEndpointHashV1(input: { baseUrl: string; model: string }) {
  const endpoint = speechEndpoint(input.baseUrl)
  return hashCanonicalValue({ schema: 'storyforge.avg.configured-speech-route', version: 1, provider: 'agnes',
    adapterId: 'storyforge.avg.compatible-speech.v1', method: 'POST', origin: endpoint.origin,
    path: endpoint.pathname, model: input.model })
}

function base64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 16_384) text += String.fromCharCode(...bytes.subarray(i, i + 16_384))
  return btoa(text)
}

async function hashBytes(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')
}

function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('voice transport interrupted')) }
    const finish = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    pending.then(value => { finish(); resolve(value) }, error => { finish(); reject(error) })
    if (signal.aborted) { finish(); abort() }
  })
}

function safeBody(bytes: Uint8Array, privateKey: string): boolean {
  try {
    const text = new TextDecoder().decode(bytes)
    if (text.includes(privateKey)) return false
    assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body: text })
    if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
      let value: unknown
      try { value = JSON.parse(text) } catch { return true }
      assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body: value })
    }
    return true
  } catch { return false }
}

function headersReceipt(response: Response, privateKey: string) {
  const omissions: string[] = []
  const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id')
  let providerRequestId = requestId && SAFE_ID.test(requestId) && !requestId.includes(privateKey) ? requestId : null
  if (providerRequestId) {
    try { assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body: providerRequestId }) }
    catch { providerRequestId = null }
  }
  if (requestId && !providerRequestId) omissions.push('request-id-policy')
  const rawType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  const contentType = ['audio/wav', 'audio/x-wav'].includes(rawType) ? rawType : 'other'
  let usage: unknown = null
  const rawUsage = response.headers.get('x-storyforge-usage')
  if (rawUsage !== null) {
    try {
      if (new TextEncoder().encode(rawUsage).byteLength > 8192 || rawUsage.includes(privateKey)) throw new Error('usage')
      usage = JSON.parse(rawUsage)
      assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body: usage })
    } catch { usage = null; omissions.push('usage-policy') }
  }
  const rawCost = response.headers.get('x-storyforge-cost-usd')
  const value = rawCost === null || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rawCost) ? NaN : Number(rawCost)
  const costUsd = Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null
  if (rawCost !== null && costUsd === null) omissions.push('cost-invalid')
  return { status: response.status, contentType, providerRequestId, usage, costUsd, omissions }
}

/** Private, inert factory until the V3 admission/executor/source/adoption
 * slice is enabled together. The only future caller is the registered media
 * Skill's durable executor, after start/CAS/source/budget checks. It must
 * resolve the current config per run; returned data contains no credential.
 * Explicit protocol model/catalog are required: no default model or voice,
 * no reuse of ephemeral companion speech and no provider substitution.
 */
export async function createConfiguredAvgVoiceTransportV1(input: {
  config: Pick<AIConfig, 'provider' | 'baseUrl' | 'apiKey'>
  assembly: AvgAssemblyBriefV3
  capability: ProviderCapabilityRequirementV1
  fetcher?: Fetcher
}) {
  const config = structuredClone(input.config)
  config.apiKey = config.apiKey.trim()
  const { assembly, requests } = await assertAvgVoiceAssemblyRequestsV3(input.assembly)
  const capability = structuredClone(input.capability)
  assertAvgVoiceCapabilityDeclarationV1(assembly, capability)
  if (config.provider !== 'agnes' || assembly.voice.protocol.provider !== 'agnes' || !config.apiKey.trim()
    || /[\r\n\u0000]/.test(config.apiKey)) throw new Error('[avg-voice] 需使用当前明确配置的 Agnes 服务与凭据')
  if (capability.maximumRequestCost !== null || capability.maximumTotalCost !== null) {
    throw new Error('[avg-voice] 尚无可核实的配音报价，不能开始有现金硬上限的请求')
  }
  const endpoint = speechEndpoint(config.baseUrl)
  const endpointRouteHash = await configuredAvgVoiceEndpointHashV1({ baseUrl: config.baseUrl, model: assembly.voice.protocol.model })
  if (endpointRouteHash !== assembly.voice.binding.endpointRouteHash) throw new Error('[avg-voice] 配音服务路由已变化，请重新准备并确认')
  const binding: ProductProductionCapabilityBindingV1 = { requirementKey: capability.requirementKey,
    adapterId: assembly.voice.protocol.adapterId, bindingHash: assembly.voice.binding.bindingHash,
    provider: 'agnes', model: assembly.voice.protocol.model }
  const fetcher: Fetcher = input.fetcher ?? ((target, init) => globalThis.fetch(target, init))
  return Object.freeze({ binding: Object.freeze(binding), endpointRouteHash, request: async (requestInput: {
    requirementKey: string
    requestIdentityHash: string
    idempotencyKey: string
    signal: AbortSignal
    onResponse: (evidence: string) => Promise<void | 'discarded-stale'>
  }): Promise<AvgVoiceHttpResponseV1> => {
    const { signal, idempotencyKey, onResponse } = requestInput
    const request = requests.find(r => r.requirementKey === requestInput.requirementKey)
    try {
      avgKey(idempotencyKey, 'voice idempotency key')
      if (!request || request.identityHash !== requestInput.requestIdentityHash || signal.aborted
        || typeof onResponse !== 'function') throw new Error('preflight')
    } catch { throw new AvgVoiceTransportErrorV1('not-dispatched', '请求身份、取消状态或回执通道无效，未发送') }
    const frozen = request!, controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, AVG_VOICE_NETWORK_TIMEOUT_MS_V1)
    let dispatched = false, recorded: AvgVoiceHttpResponseV1 | null = null
    try {
      if (signal.aborted) throw new AvgVoiceTransportErrorV1('not-dispatched', '调用前已取消，未发送')
      dispatched = true
      const response = await untilAborted(fetcher(endpoint.href, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json',
          'x-storyforge-idempotency-key': idempotencyKey }, body: frozen.requestBodyJson }), controller.signal)
      const receipt = headersReceipt(response, config.apiKey), chunks: Uint8Array[] = []
      let length = 0, complete = false, observedBytes = 0, readIssue: string | null = null
      const reader = response.body?.getReader()
      try {
        if (!reader) complete = true
        else while (true) {
          const { value, done } = await untilAborted(reader.read(), controller.signal)
          if (done) { complete = true; break }
          observedBytes += value.byteLength
          if (length + value.byteLength > MAX_BODY_BYTES) { readIssue = 'body-limit'; break }
          chunks.push(value.slice()); length += value.byteLength
        }
      } catch { readIssue = 'body-interrupted' }
      finally {
        if (reader && !complete) void reader.cancel().catch(() => {})
        reader?.releaseLock()
      }
      // Once the network body is complete, preserve headroom for the durable
      // receipt and real decoder. Parent cancellation still fences both.
      if (complete) clearTimeout(timeout)
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      const contentHash = await hashBytes(bytes), allowed = complete && safeBody(bytes, config.apiKey)
      const evidence = canonicalStringify({ schema: 'storyforge.avg.voice-provider-response', version: 1,
        requestIdentityHash: frozen.identityHash, requestBodyHash: frozen.requestBodyHash, endpointRouteHash,
        ...receipt, bodyComplete: complete, observedBytes, bodyHash: contentHash, hashScope: complete ? 'full-body' : 'retained-prefix',
        bodyBase64: allowed ? base64(bytes) : null, bodyOmitted: !complete ? readIssue : allowed ? null : 'policy' })
      assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body: JSON.parse(evidence) })
      if (await onResponse(evidence) === 'discarded-stale') throw new Error('stale')
      recorded = { status: receipt.status, contentType: receipt.contentType, providerRequestId: receipt.providerRequestId,
        usage: receipt.usage, costUsd: receipt.costUsd, body: allowed ? bytes.buffer : new ArrayBuffer(0),
        evidenceHash: await hashBytes(new TextEncoder().encode(evidence)) }
      if (!complete || controller.signal.aborted) throw new AvgVoiceTransportErrorV1('result-unknown', '发送后结果不完整或已取消；保留预留，禁止自动重发', recorded)
      if (!allowed || receipt.omissions.length || !response.ok || receipt.contentType === 'other') {
        throw new AvgVoiceTransportErrorV1('response-recorded', `已保存配音响应（HTTP ${receipt.status}），尚未成为可用音频`, recorded)
      }
      // A complete successful HTTP body must still be this profile's actual
      // PCM16 container. Browser decode and audition remain executor/UI gates.
      try { inspectAvgVoiceWaveV1(recorded.body, frozen.maximumDurationMs) }
      catch { throw new AvgVoiceTransportErrorV1('response-recorded', '配音字节不符合冻结的 WAV/时长合同，原始回执已保存', recorded) }
      return recorded
    } catch (error) {
      if (error instanceof AvgVoiceTransportErrorV1) throw error
      throw new AvgVoiceTransportErrorV1(dispatched ? 'result-unknown' : 'not-dispatched',
        dispatched ? '发送后未能确认并保存完整结果；保留预留，禁止自动重发' : '调用前失败，未发送', recorded)
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
  } })
}
