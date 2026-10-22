/** Fixed loopback bridge client. Waiting/GET/reload cannot start a worker.
 * The original domain must recheck current owner immediately before /start. */
import profile from '../../../scripts/ttrpg-local-tts/product-profile.json'
import { hashCanonicalValue } from '../agent/run/hash'
import type { TtrpgOpenLocalVoiceTransportV1 } from './open-voice-execution'
import type { TtrpgOpenVoiceProductProfileV1 } from './open-voice-product-profile'

const PREFIX = '/storyforge/local-tts/v1'
export async function requestText(url: string, init: RequestInit, signal: AbortSignal | undefined, limit: number, timeoutMs: number) {
  const controller = new AbortController(), relay = () => controller.abort(signal?.reason)
  if (signal?.aborted) relay(); else signal?.addEventListener('abort', relay, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('本机语音响应超过传输期限，请核查原任务，不自动重发')), timeoutMs)
  try {
    controller.signal.throwIfAborted()
    const response = await fetch(url, { ...init, headers: { 'X-StoryForge-Tts': '1', 'Content-Type': 'application/json' }, cache: 'no-store', signal: controller.signal })
    return await boundedBody(response, limit)
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', relay) }
}
async function boundedBody(response: Response, limit: number): Promise<string> {
  if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')) throw new Error('本机语音服务未就绪或原任务需核查；不会自动重发')
  const declared = Number(response.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > limit) { await response.body?.cancel(); throw new Error('本机语音响应超过原传输预算') }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('本机语音响应缺少可核验正文')
  let bytes = 0; const chunks: string[] = [], decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  try {
    while (true) {
      const value = await reader.read()
      if (value.done) break
      bytes += value.value.byteLength
      if (bytes > limit) { await reader.cancel(); throw new Error('本机语音响应超过原传输预算') }
      chunks.push(decoder.decode(value.value, { stream: true }))
    }
    chunks.push(decoder.decode()); return chunks.join('')
  } finally { reader.releaseLock() }
}
const pause = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const done = () => { signal?.removeEventListener('abort', stop); resolve() }, timer = setTimeout(done, 500)
  const stop = () => { clearTimeout(timer); reject(new Error('本机语音已请求停止，须核查原任务是否确实结束')) }
  if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true })
})
/** Metadata GET only: no original job, budget reservation or inference. */
export async function probeTtrpgOpenLocalVoiceProfileV1(profile: TtrpgOpenVoiceProductProfileV1, signal?: AbortSignal) {
  await createTtrpgOpenLocalVoiceTransportV1(signal, profile)
}
export async function createTtrpgOpenLocalVoiceTransportV1(probeSignal?: AbortSignal, originalProfile: TtrpgOpenVoiceProductProfileV1 = profile): Promise<TtrpgOpenLocalVoiceTransportV1> {
  const selected = structuredClone(originalProfile)
  const profileHash = await hashCanonicalValue(selected)
  const read = async (url: string, init: RequestInit = {}, signal?: AbortSignal) => {
    return JSON.parse(await requestText(url, init, signal, 65536, selected.statusRequestTimeoutMs)) as { jobKey?: string; inputArtifactHash?: string; profileHash?: string; status?: string; canStart?: boolean; kind?: string; profile?: unknown }
  }
  const remote = await read(PREFIX + '/profile' + (selected.profileId === profile.profileId ? '' : '?profileId=' + encodeURIComponent(selected.profileId)), {}, probeSignal)
  if (remote.kind !== 'local-offline-speech-v1' || remote.profileHash !== profileHash || await hashCanonicalValue(remote.profile) !== profileHash) throw new Error('本机执行器版本与当前确认合同不同')
  return { kind: 'local-offline-speech-v1', profileHash, execute: async input => {
    input = { ...input, execution: structuredClone(input.execution) }
    if (input.execution.profileHash !== profileHash || await hashCanonicalValue(input.execution.profile) !== profileHash
      || await hashCanonicalValue(input.execution) !== input.inputArtifactHash) throw new Error('本机传输不能更换原声线或准确输入')
    const url = PREFIX + '/jobs/' + encodeURIComponent(input.jobKey), started = Date.now()
    const current = (value: Awaited<ReturnType<typeof read>>) => {
      if (value.jobKey !== input.jobKey || value.inputArtifactHash !== input.inputArtifactHash || value.profileHash !== profileHash) throw new Error('本机任务与原输入不一致')
      return value
    }
    const cancel = () => { void read(url + '/cancel', { method: 'POST', body: JSON.stringify({ decision: 'request-stop-original-local-voice-job' }) }).catch(() => { /* Original job remains queryable; no stop claim is inferred. */ }) }
    input.signal?.throwIfAborted()
    input.signal?.addEventListener('abort', cancel, { once: true })
    try {
      let state = current(await read(PREFIX + '/jobs', { method: 'POST', body: JSON.stringify({ jobKey: input.jobKey, inputArtifactHash: input.inputArtifactHash, execution: input.execution }) }, input.signal))
      let startAttempted = false, lastRenewed = 0
      while (true) {
        input.signal?.throwIfAborted()
        if (Date.now() - started > selected.timeoutMs) { cancel(); throw new Error('本机配音已到期限，请核查原任务，不自动重发') }
        if (state.status === 'generated') {
          return await requestText(url + '/raw', {}, input.signal, Math.ceil(selected.maxAudioBytes / 3) * 4 + 1048576,
            Math.max(1, Math.min(selected.rawResponseTimeoutMs, selected.timeoutMs - (Date.now() - started))))
        }
        if (['unknown', 'running-observed', 'failed', 'cancelled-confirmed', 'cancelled-before-start', 'cancelled-before-spawn', 'stop-requested-without-job'].includes(state.status ?? '')) throw new Error('原语音任务已停止或结果未知，请核查同一任务')
        if (state.status === 'waiting-for-slot' && state.canStart && !startAttempted) {
          // No inference may be queued beyond the actual source/consent check.
          await input.assertCurrentBeforeStart(); input.signal?.throwIfAborted(); startAttempted = true
          state = current(await read(url + '/start', { method: 'POST', body: JSON.stringify({ inputArtifactHash: input.inputArtifactHash }) }, input.signal))
          lastRenewed = Date.now()
          if (state.status === 'waiting-for-slot') throw new Error('本机槽位发生竞争，原任务保持未启动；请明确继续')
        } else if (state.status === 'running' && Date.now() - lastRenewed >= selected.authorizationRenewMs) {
          await input.assertCurrentBeforeStart(); input.signal?.throwIfAborted()
          state = current(await read(url + '/lease', { method: 'POST', body: JSON.stringify({ inputArtifactHash: input.inputArtifactHash }) }, input.signal)); lastRenewed = Date.now()
        } else { await pause(input.signal); state = current(await read(url, {}, input.signal)) }
      }
    } catch (error) { cancel(); throw error }
    finally { input.signal?.removeEventListener('abort', cancel) }
  } }
}
