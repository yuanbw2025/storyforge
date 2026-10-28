import { sha256MediaData } from '../product-production/media-blob-store'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { parseAvgAudioProcessingRecipeV2, parseAvgAudioDynamicsObservationV2 } from './audio-processing-contract-v2'
import { planAvgAudioDspLayoutV2, type AvgAudioDspInputV2 } from './audio-dsp-kernel-v2'
import { parseAvgAudioDspWorkerReplyV2, type AvgAudioDspWorkerRequestV2, type AvgAudioDspOutputV2 } from './audio-dsp-worker-protocol-v2'

export const AVG_AUDIO_DSP_DEADLINE_MS_V2 = 20000
const abortError = () => new DOMException('AVG audio DSP aborted', 'AbortError')
export function assertAvgAudioDspActiveV2(signal?: AbortSignal) { if (signal?.aborted) throw abortError() }

/** One preparation/compute/verify deadline. Cancellation always propagates to
 * the exact active port; late hash work cannot start another Worker. */
export function withAvgAudioDspDeadlineV2<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  assertAvgAudioDspActiveV2(signal)
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (error: unknown, result?: T) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort)
      if (error) { controller.abort(); reject(error) } else resolve(result!)
    }
    const onAbort = () => finish(abortError())
    const timer = setTimeout(() => finish(new Error('[avg-audio-process] DSP准备、计算及独立复算共用总时限已到，原件保留')), AVG_AUDIO_DSP_DEADLINE_MS_V2)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    void work(controller.signal).then(result => finish(null, result), error => finish(error))
  })
}

function port(request: AvgAudioDspWorkerRequestV2, signal: AbortSignal) {
  assertAvgAudioDspActiveV2(signal)
  if (typeof Worker !== 'function') throw new Error('[avg-audio-process] 当前浏览器缺少可中止DSP Worker，不能降级计算')
  return new Promise<ReturnType<typeof parseAvgAudioDspWorkerReplyV2>>((resolve, reject) => {
    let worker: Worker | null = null, settled = false, terminated = false
    const stopWorker = () => {
      if (!worker || terminated) return
      terminated = true; worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate()
    }
    const finish = (error: unknown, value?: ReturnType<typeof parseAvgAudioDspWorkerReplyV2>) => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', onAbort)
      stopWorker()
      if (error) reject(error); else resolve(value!)
    }
    const onAbort = () => finish(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) { onAbort(); return }
    try {
      worker = request.mode === 'compute'
        ? new Worker(new URL('./audio-dsp-compute-v2.worker.ts', import.meta.url), { type: 'module', name: 'avg-audio-dsp-compute-v2' })
        : new Worker(new URL('./audio-dsp-verify-v2.worker.ts', import.meta.url), { type: 'module', name: 'avg-audio-dsp-verify-v2' })
      // A synchronous constructor can deliver cancellation before assignment.
      // Dispose that late-created port and never attach handlers or post work.
      if (settled) { stopWorker(); return }
      if (signal.aborted) { onAbort(); return }
      worker.onmessage = event => {
        try { finish(null, parseAvgAudioDspWorkerReplyV2(event.data)) } catch (error) { finish(error) }
      }
      worker.onerror = event => { event.preventDefault(); finish(new Error('[avg-audio-process] 独立DSP Worker执行失败')) }
      worker.onmessageerror = () => finish(new Error('[avg-audio-process] DSP Worker返回无法读取'))
      worker.postMessage(request, request.mode === 'compute' ? [request.pcm] : [request.pcm, request.output.pcm])
    } catch (error) { finish(error) }
  })
}

async function sequence(input: AvgAudioDspInputV2, signal: AbortSignal, provided?: AvgAudioDspOutputV2) {
  assertAvgAudioDspActiveV2(signal)
  const recipe = parseAvgAudioProcessingRecipeV2(input.recipe), layout = planAvgAudioDspLayoutV2({ ...input, recipe })
  if (!(input.pcm instanceof ArrayBuffer) || input.pcm.byteLength !== layout.sampleCount * layout.channelCount * 2) throw new Error('[avg-audio-process] DSP原件PCM布局不一致')
  // Capture every caller-owned array and field before the first await.
  const original = input.pcm.slice(0)
  const captured = provided ? { ...provided, pcm: provided.pcm.slice(0),
    dynamicsObservation: parseAvgAudioDynamicsObservationV2(provided.dynamicsObservation, layout.outputSampleCount) } : undefined
  const [sourcePcmHash, recipeHash] = await Promise.all([sha256MediaData(original), hashProductProductionValueV2(recipe)])
  assertAvgAudioDspActiveV2(signal)
  const base = { schema: 'storyforge.avg.audio-dsp-worker-request' as const, version: 2 as const,
    channelCount: layout.channelCount, sampleCount: layout.sampleCount, sourceSampleRateHz: layout.sourceSampleRateHz, recipe, sourcePcmHash, recipeHash }
  const check = (reply: ReturnType<typeof parseAvgAudioDspWorkerReplyV2>, jobId: string, mode: 'compute' | 'verify') => {
    if (reply.jobId !== jobId) throw new Error('[avg-audio-process] DSP Worker返回不属于本次任务')
    if (!reply.ok) throw new Error(reply.message)
    if (reply.mode !== mode || reply.sourcePcmHash !== sourcePcmHash || reply.recipeHash !== recipeHash
      || reply.channelCount !== layout.channelCount || reply.sampleCount !== layout.outputSampleCount || reply.sampleRateHz !== layout.outputSampleRateHz) {
      throw new Error('[avg-audio-process] DSP Worker改变了冻结来源、配方或真实输出布局')
    }
    return reply
  }
  let output: AvgAudioDspOutputV2
  if (captured) output = captured
  else {
    const jobId = crypto.randomUUID(), reply = check(await port({ ...base, jobId, mode: 'compute', pcm: original.slice(0) }, signal), jobId, 'compute')
    if (reply.mode !== 'compute') throw new Error('[avg-audio-process] 缺少独立计算结果')
    output = { pcm: reply.pcm, channelCount: reply.channelCount, sampleCount: reply.sampleCount,
      sampleRateHz: reply.sampleRateHz, dynamicsObservation: reply.dynamicsObservation }
  }
  assertAvgAudioDspActiveV2(signal)
  const outputPcmHash = await sha256MediaData(output.pcm)
  assertAvgAudioDspActiveV2(signal)
  const jobId = crypto.randomUUID(), verified = check(await port({ ...base, jobId, mode: 'verify', pcm: original.slice(0),
    output: { ...output, pcm: output.pcm.slice(0) }, outputPcmHash }, signal), jobId, 'verify')
  if (verified.mode !== 'verify' || verified.outputPcmHash !== outputPcmHash
    || verified.dynamicsObservation.limitedFrameCount !== output.dynamicsObservation.limitedFrameCount
    || verified.dynamicsObservation.maximumReductionMilliDb !== output.dynamicsObservation.maximumReductionMilliDb) throw new Error('[avg-audio-process] 独立复算的准确输出或动态观察不一致')
  assertAvgAudioDspActiveV2(signal)
  return { ...output, sourcePcmHash, outputPcmHash }
}
/** Both complete numerical passes run in separate fixed Workers. */
export function runAvgAudioDspWorkersV2(input: AvgAudioDspInputV2 & { signal?: AbortSignal }) {
  return withAvgAudioDspDeadlineV2(input.signal, signal => sequence(input, signal))
}
/** Physical verification uses only the independent recomputation Worker. */
export function verifyAvgAudioDspWithWorkerV2(input: AvgAudioDspInputV2 & { output: AvgAudioDspOutputV2; signal?: AbortSignal }) {
  return withAvgAudioDspDeadlineV2(input.signal, signal => sequence(input, signal, input.output))
}
