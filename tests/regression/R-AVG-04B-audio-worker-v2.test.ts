// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { audioRecipeV2, audioPcmV2, audioWaveV2 } from '../helpers/avg-audio-v2-fixture'
import * as bytes from '../../src/lib/product-production/media-blob-store'
import { executeAvgAudioDspWorkerRequestV2, type AvgAudioDspWorkerRequestV2, type AvgAudioDspWorkerReplyV2 } from '../../src/lib/avg/audio-dsp-worker-protocol-v2'
import { runAvgAudioDspWorkersV2, AVG_AUDIO_DSP_DEADLINE_MS_V2 } from '../../src/lib/avg/audio-dsp-worker-client-v2'
import { processAvgAudioPcmWaveV2, processAvgAudioPcmWaveWithWorkerV2, assertAvgAudioProcessingWaveBytesV2 } from '../../src/lib/avg/audio-processing-v2'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

class ControlledDspWorker {
  static instances: ControlledDspWorker[] = []
  static onPosted: (worker: ControlledDspWorker) => void = worker => queueMicrotask(() => worker.emit(executeAvgAudioDspWorkerRequestV2(worker.request)))
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  request!: AvgAudioDspWorkerRequestV2
  terminate = vi.fn()
  constructor(readonly url: URL, readonly options: WorkerOptions) { ControlledDspWorker.instances.push(this) }
  postMessage(request: AvgAudioDspWorkerRequestV2, transfer: Transferable[]) {
    this.request = structuredClone(request, { transfer }); ControlledDspWorker.onPosted(this)
  }
  emit(reply: AvgAudioDspWorkerReplyV2) { this.onmessage?.({ data: reply } as MessageEvent<unknown>) }
}
const input = () => ({ pcm: audioPcmV2(), channelCount: 1, sampleCount: 2400, sourceSampleRateHz: 24000, recipe: audioRecipeV2() })
const posted = (mode: 'compute' | 'verify') => new Promise<ControlledDspWorker>(resolve => {
  ControlledDspWorker.onPosted = worker => { if (worker.request.mode === mode) resolve(worker); else worker.emit(executeAvgAudioDspWorkerRequestV2(worker.request)) }
})
beforeEach(() => {
  ControlledDspWorker.instances = []
  ControlledDspWorker.onPosted = worker => queueMicrotask(() => worker.emit(executeAvgAudioDspWorkerRequestV2(worker.request)))
  vi.stubGlobal('Worker', ControlledDspWorker)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('AVG V2 separate compute and complete-verification Worker ports', () => {
  it('uses two fixed ports, transfers only copies, recomputes every sample and matches direct finite evaluation', async () => {
    const source = await audioWaveV2(), original = source.data.slice(0), recipe = audioRecipeV2()
    const direct = await processAvgAudioPcmWaveV2({ ...source, recipe })
    expect(await processAvgAudioPcmWaveWithWorkerV2({ ...source, recipe })).toEqual(direct)
    expect(ControlledDspWorker.instances.map(w => w.request.mode)).toEqual(['compute', 'verify'])
    expect(ControlledDspWorker.instances.map(w => w.url.pathname.split('/').at(-1))).toEqual(['audio-dsp-compute-v2.worker.ts', 'audio-dsp-verify-v2.worker.ts'])
    for (const worker of ControlledDspWorker.instances) { expect(worker.options.type).toBe('module'); expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull() }
    expect(new Uint8Array(source.data)).toEqual(new Uint8Array(original))
  })
  it('snapshots the exact source, format and recipe before asynchronous hashing', async () => {
    const source = input(), original = source.pcm.slice(0), started = posted('compute'), pending = runAvgAudioDspWorkersV2(source)
    source.sourceSampleRateHz = 48000; source.recipe.targetSampleRateHz = 16000; new DataView(source.pcm).setInt16(2, 30000, true)
    const worker = await started
    expect(worker.request.sourceSampleRateHz).toBe(24000); expect(worker.request.recipe.targetSampleRateHz).toBe(48000)
    expect(new Uint8Array(worker.request.pcm)).toEqual(new Uint8Array(original))
    ControlledDspWorker.onPosted = next => next.emit(executeAvgAudioDspWorkerRequestV2(next.request))
    worker.emit(executeAvgAudioDspWorkerRequestV2(worker.request))
    expect((await pending).sampleCount).toBe(4800)
  })
  it.each(['sample', 'observation'] as const)('refuses a forged %s in the compute response through actual second-Worker recomputation', async mode => {
    ControlledDspWorker.onPosted = worker => {
      const reply = executeAvgAudioDspWorkerRequestV2(worker.request)
      if (reply.ok && reply.mode === 'compute') {
        if (mode === 'sample') new DataView(reply.pcm).setInt16(200, new DataView(reply.pcm).getInt16(200, true) + 1, true)
        else reply.dynamicsObservation.limitedFrameCount++
      }
      worker.emit(reply)
    }
    await expect(runAvgAudioDspWorkersV2(input())).rejects.toThrow(/复算/)
    expect(ControlledDspWorker.instances.map(w => w.request.mode)).toEqual(['compute', 'verify'])
    for (const worker of ControlledDspWorker.instances) expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('rejects a wrong task identity without starting verification or retrying', async () => {
    ControlledDspWorker.onPosted = worker => worker.emit({ ...executeAvgAudioDspWorkerRequestV2(worker.request), jobId: 'another-job' })
    await expect(runAvgAudioDspWorkersV2(input())).rejects.toThrow(/不属于/)
    expect(ControlledDspWorker.instances).toHaveLength(1); expect(ControlledDspWorker.instances[0].terminate).toHaveBeenCalledOnce()
  })
  it('terminates a Worker cancelled synchronously during its constructor without posting computation', async () => {
    const controller = new AbortController()
    class ConstructorAbortWorker extends ControlledDspWorker {
      constructor(url: URL, options: WorkerOptions) { super(url, options); controller.abort() }
    }
    vi.stubGlobal('Worker', ConstructorAbortWorker)
    await expect(runAvgAudioDspWorkersV2({ ...input(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(ControlledDspWorker.instances).toHaveLength(1)
    const worker = ControlledDspWorker.instances[0]
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.request).toBeUndefined(); expect(worker.onmessage).toBeNull()
  })
  it.each(['compute', 'verify'] as const)('terminates the exact %s port on cancellation and ignores a captured late callback', async mode => {
    const controller = new AbortController(), started = posted(mode), pending = runAvgAudioDspWorkersV2({ ...input(), signal: controller.signal })
    const worker = await started, callback = worker.onmessage!, reply = executeAvgAudioDspWorkerRequestV2(worker.request)
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await failure; callback({ data: reply } as MessageEvent<unknown>); await Promise.resolve()
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(ControlledDspWorker.instances).toHaveLength(mode === 'compute' ? 1 : 2)
  })
  it('shares one unchanged 20s deadline across compute and verification', async () => {
    vi.useFakeTimers()
    const first = posted('compute'), pending = runAvgAudioDspWorkersV2(input()), compute = await first
    await vi.advanceTimersByTimeAsync(19000)
    const second = posted('verify'); compute.emit(executeAvgAudioDspWorkerRequestV2(compute.request))
    const verify = await second, failure = expect(pending).rejects.toThrow(/总时限/)
    await vi.advanceTimersByTimeAsync(AVG_AUDIO_DSP_DEADLINE_MS_V2 - 19000); await failure
    expect(verify.terminate).toHaveBeenCalledOnce(); expect(ControlledDspWorker.instances).toHaveLength(2)
  })
  it('bounds preparation and cannot start a port after a late hash', async () => {
    vi.useFakeTimers(); let release!: (hash: string) => void
    vi.spyOn(bytes, 'sha256MediaData').mockReturnValueOnce(new Promise<string>(resolve => { release = resolve }))
    const pending = runAvgAudioDspWorkersV2(input()), failure = expect(pending).rejects.toThrow(/总时限/)
    await vi.advanceTimersByTimeAsync(AVG_AUDIO_DSP_DEADLINE_MS_V2); await failure
    release('a'.repeat(64)); for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(ControlledDspWorker.instances).toHaveLength(0)
  })
  it('refuses missing Worker support and sound output above 8MiB before any computation', async () => {
    vi.stubGlobal('Worker', undefined)
    await expect(runAvgAudioDspWorkersV2(input())).rejects.toThrow(/Worker/)
    const source = await audioWaveV2(new ArrayBuffer(24000 * 60 * 2 * 2), 24000, 2)
    await expect(processAvgAudioPcmWaveWithWorkerV2({ ...source, source: { ...source.source, kind: 'bgm' },
      recipe: audioRecipeV2({ maximumDurationMs: 60000 }) })).rejects.toThrow(/声音物理字节上限/)
    expect(ControlledDspWorker.instances).toHaveLength(0)
  })
  it('uses only the verify port on physical read and rejects rehashed non-peak sample tampering', async () => {
    const source = await audioWaveV2(), recipe = audioRecipeV2(), result = await processAvgAudioPcmWaveV2({ ...source, recipe })
    await expect(assertAvgAudioProcessingWaveBytesV2({ source: source.data, output: result.data, recipe, receipt: result.receipt })).resolves.toMatchObject({ receipt: result.receipt })
    expect(ControlledDspWorker.instances.map(w => w.request.mode)).toEqual(['verify'])
    const output = result.data.slice(0), view = new DataView(output); view.setInt16(244, view.getInt16(244, true) + 1, true)
    const { receiptHash: _receiptHash, ...body } = result.receipt
    const bad = { ...body, output: { ...body.output, contentHash: await bytes.sha256MediaData(output), pcmHash: await bytes.sha256MediaData(output.slice(44)) } }
    const receipt = { ...bad, receiptHash: await hashProductProductionValueV2(bad) }
    await expect(assertAvgAudioProcessingWaveBytesV2({ source: source.data, output, recipe, receipt })).rejects.toThrow(/逐字节/)
  })
})
