import { sha256MediaData } from '../product-production/media-blob-store'
import { avgHash } from './protocol-validation'
import { assertAvgAudioGainPcmLayoutV1, quantizeAvgAudioGainSampleV1 } from './audio-gain-kernel'
import { parseAvgAudioGainWorkerReplyV1, type AvgAudioGainWorkerRequestV1 } from './audio-gain-worker-protocol'

export const AVG_AUDIO_WORKER_TIMEOUT_MS_V1 = 20_000
const aborted = () => new DOMException('AVG audio processing aborted', 'AbortError')

/** Dedicated fixed-URL port. Transfer only a copy; verify every returned
 * sample against the frozen gain, in yielding chunks, before returning it.
 * No fallback, retries, DB/HTTP writes or producer/author authority. */
export async function runAvgAudioGainWorkerV1(input: { pcm: ArrayBuffer; channelCount: number; sampleCount: number;
  gainMilliDb: number; recipeHash: string; signal?: AbortSignal }) {
  const { channelCount, sampleCount, gainMilliDb, signal } = input
  if (signal?.aborted) throw aborted()
  assertAvgAudioGainPcmLayoutV1(input.pcm, channelCount, sampleCount, gainMilliDb)
  const recipeHash = avgHash(input.recipeHash, 'audio recipe')
  if (typeof Worker !== 'function') throw new Error('[avg-audio-process] 当前浏览器不支持可中止的音频 Worker')
  const source = input.pcm.slice(0), jobId = crypto.randomUUID(), gain = 10 ** (gainMilliDb / 20_000)
  return new Promise<{ pcm: ArrayBuffer; sourcePcmHash: string; outputPcmHash: string }>((resolve, reject) => {
    let worker: Worker | null = null, settled = false, received = false, terminated = false, sourcePcmHash = ''
    const stopWorker = () => {
      if (!worker || terminated) return
      terminated = true; worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate()
    }
    const finish = (error: unknown, result?: { pcm: ArrayBuffer; sourcePcmHash: string; outputPcmHash: string }) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); stopWorker()
      if (error) reject(error); else resolve(result!)
    }
    const onAbort = () => finish(aborted())
    const accept = async (value: unknown) => {
      if (settled || received) return
      received = true; stopWorker()
      try {
        const result = parseAvgAudioGainWorkerReplyV1(value)
        if (result.jobId !== jobId) throw new Error('[avg-audio-process] Worker 返回不属于本次任务')
        if (!result.ok) throw new Error(result.message)
        if (result.channelCount !== channelCount || result.sampleCount !== sampleCount || result.gainMilliDb !== gainMilliDb
          || result.sourcePcmHash !== sourcePcmHash || result.recipeHash !== recipeHash) throw new Error('[avg-audio-process] Worker 返回改变了冻结来源、配方或声道时间轴')
        const pcm = result.pcm.slice(0), raw = new DataView(source), output = new DataView(pcm)
        for (let offset = 0; offset < source.byteLength; offset += 2) {
          if (output.getInt16(offset, true) !== quantizeAvgAudioGainSampleV1(raw.getInt16(offset, true), gain)) {
            throw new Error('[avg-audio-process] Worker 实际样本不符合准确原件与增益')
          }
          if ((offset + 2) % 131_072 === 0 && offset + 2 < source.byteLength) {
            await new Promise<void>(resume => setTimeout(resume, 0))
            if (settled) return
            if (signal?.aborted) throw aborted()
          }
        }
        const outputPcmHash = await sha256MediaData(pcm)
        if (signal?.aborted) throw aborted()
        finish(null, { pcm, sourcePcmHash, outputPcmHash })
      } catch (error) { finish(error) }
    }
    const start = async () => {
      sourcePcmHash = await sha256MediaData(source)
      if (settled) return
      if (signal?.aborted) { onAbort(); return }
      const transferred = source.slice(0)
      worker = new Worker(new URL('./audio-gain.worker.ts', import.meta.url), { type: 'module', name: 'avg-audio-gain-v1' })
      if (settled) { stopWorker(); return }
      worker.onmessage = event => { void accept(event.data) }
      worker.onerror = event => { event.preventDefault(); finish(new Error('[avg-audio-process] 音频 Worker 执行失败')) }
      worker.onmessageerror = () => finish(new Error('[avg-audio-process] 音频 Worker 返回无法读取'))
      const request: AvgAudioGainWorkerRequestV1 = { schema: 'storyforge.avg.audio-gain-worker-request', version: 1,
        jobId, pcm: transferred, channelCount, sampleCount, gainMilliDb, sourcePcmHash, recipeHash }
      worker.postMessage(request, [transferred])
    }
    const timer = setTimeout(() => finish(new Error('[avg-audio-process] 音频计算超时，原件保留')), AVG_AUDIO_WORKER_TIMEOUT_MS_V1)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    void start().catch(error => finish(error))
  })
}
