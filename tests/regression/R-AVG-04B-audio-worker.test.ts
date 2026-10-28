// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import * as bytes from '../../src/lib/product-production/media-blob-store'
import { runAvgAudioGainWorkerV1, AVG_AUDIO_WORKER_TIMEOUT_MS_V1 } from '../../src/lib/avg/audio-gain-worker-client'
import { executeAvgAudioGainWorkerRequestV1, parseAvgAudioGainWorkerReplyV1,
  type AvgAudioGainWorkerRequestV1, type AvgAudioGainWorkerReplyV1 } from '../../src/lib/avg/audio-gain-worker-protocol'
import { processAvgAudioPcmWaveV1, processAvgAudioPcmWaveWithWorkerV1 } from '../../src/lib/avg/audio-processing'
import type { AvgAudioProcessingRecipeV1 } from '../../src/lib/avg/audio-processing-contract'

const hash = (data: ArrayBuffer) => createHash('sha256').update(new Uint8Array(data)).digest('hex')
function input() { return { pcm: new Int16Array([1000, -1000, 2000, -2000]).buffer, channelCount: 2, sampleCount: 2,
  gainMilliDb: -6000, recipeHash: 'a'.repeat(64) } }
class ControlledWorker {
  static instances: ControlledWorker[] = []
  static onPosted: (worker: ControlledWorker) => void = () => undefined
  static throwOnPost = false
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  request!: AvgAudioGainWorkerRequestV1
  terminate = vi.fn()
  constructor(readonly url: URL, readonly options: WorkerOptions) { ControlledWorker.instances.push(this) }
  postMessage(request: AvgAudioGainWorkerRequestV1, transfer: Transferable[]) {
    if (ControlledWorker.throwOnPost) throw new Error('Controlled audio post failure')
    this.request = structuredClone(request, { transfer }); ControlledWorker.onPosted(this)
  }
  emit(reply: AvgAudioGainWorkerReplyV1) { this.onmessage?.({ data: reply } as MessageEvent<unknown>) }
}
const posted = () => new Promise<ControlledWorker>(resolve => { ControlledWorker.onPosted = resolve })
function success(worker: ControlledWorker) {
  const reply = executeAvgAudioGainWorkerRequestV1(worker.request)
  if (!reply.ok) throw new Error(reply.message)
  return reply
}
async function waveInput() {
  const data = new ArrayBuffer(52), v = new DataView(data)
  const text = (offset: number, value: string) => [...value].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF'); v.setUint32(4, 44, true); text(8, 'WAVE'); text(12, 'fmt '); v.setUint32(16, 16, true)
  v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, 24_000, true); v.setUint32(28, 96_000, true)
  v.setUint16(32, 4, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, 8, true)
  for (const [i, value] of [1000, -1000, 2000, -2000].entries()) v.setInt16(44 + i * 2, value, true)
  const recipe: AvgAudioProcessingRecipeV1 = { schema: 'storyforge.avg.audio-processing-recipe', version: 1, gainMilliDb: -6000,
    maximumDurationMs: 1000, sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve',
    overflowPolicy: 'reject', declaration: '原创工程帧；受控端口测试不签原生或生产/作者权限。' }
  return { data, source: { contentHash: hash(data), mimeType: 'audio/wav' as const, kind: 'voice' as const }, recipe }
}
beforeEach(() => {
  ControlledWorker.instances = []; ControlledWorker.onPosted = () => undefined; ControlledWorker.throwOnPost = false
  vi.stubGlobal('Worker', ControlledWorker)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('AVG bounded audio Worker port without producer/adoption authority', () => {
  it('transfers only a copy and verifies exact frozen-gain samples and hashes', async () => {
    const source = input(), original = source.pcm.slice(0), started = posted(), pending = runAvgAudioGainWorkerV1(source)
    const worker = await started
    expect(worker.url.pathname).toContain('audio-gain.worker.ts'); expect(worker.options).toEqual({ type: 'module', name: 'avg-audio-gain-v1' })
    worker.emit(success(worker)); const result = await pending
    expect(source.pcm).toEqual(original); expect(source.pcm.byteLength).toBe(8)
    expect(Array.from(new Int16Array(result.pcm))).toEqual([501, -501, 1002, -1002])
    expect(result.sourcePcmHash).toBe(hash(original)); expect(result.outputPcmHash).toBe(hash(result.pcm))
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull()
  })

  it('snapshots the original samples, layout and recipe claim before asynchronous hashing', async () => {
    const source = input(), originalHash = hash(source.pcm), started = posted(), pending = runAvgAudioGainWorkerV1(source)
    source.channelCount = 1; source.sampleCount = 4; source.gainMilliDb = 0; source.recipeHash = 'b'.repeat(64)
    new Int16Array(source.pcm)[0] = 5000
    const worker = await started; worker.emit(success(worker)); const result = await pending
    expect(worker.request).toMatchObject({ channelCount: 2, sampleCount: 2, gainMilliDb: -6000, recipeHash: 'a'.repeat(64) })
    expect(result.sourcePcmHash).toBe(originalHash); expect(new Int16Array(result.pcm)[0]).toBe(501)
  })

  it('rejects invalid frames and missing Worker capability without a main-thread fallback', async () => {
    await expect(runAvgAudioGainWorkerV1({ ...input(), sampleCount: 3 })).rejects.toThrow(/帧数/)
    vi.stubGlobal('Worker', undefined)
    await expect(runAvgAudioGainWorkerV1(input())).rejects.toThrow(/不支持/)
    const s = await waveInput()
    await expect(processAvgAudioPcmWaveWithWorkerV1(s)).rejects.toThrow(/不支持/)
    expect(ControlledWorker.instances).toHaveLength(0)
  })

  it('rejects an already stopped operation before creating a Worker', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(runAvgAudioGainWorkerV1({ ...input(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(ControlledWorker.instances).toHaveLength(0)
  })

  it.each(['abort', 'timeout'])('bounds source hashing and discards a late hash after %s', async mode => {
    vi.useFakeTimers()
    let release!: (hash: string) => void
    vi.spyOn(bytes, 'sha256MediaData').mockReturnValueOnce(new Promise<string>(resolve => { release = resolve }))
    const controller = new AbortController(), pending = runAvgAudioGainWorkerV1({ ...input(), signal: controller.signal })
    const failure = mode === 'abort' ? expect(pending).rejects.toMatchObject({ name: 'AbortError' }) : expect(pending).rejects.toThrow(/超时/)
    if (mode === 'abort') controller.abort(); else await vi.advanceTimersByTimeAsync(AVG_AUDIO_WORKER_TIMEOUT_MS_V1)
    await failure; release('0'.repeat(64)); for (let i = 0; i < 6; i++) await Promise.resolve()
    expect(ControlledWorker.instances).toHaveLength(0)
  })

  it('bounds the entire WAV operation even before PCM preparation can finish', async () => {
    const s = await waveInput(); vi.useFakeTimers()
    let release!: (hash: string) => void
    vi.spyOn(bytes, 'sha256MediaData').mockResolvedValue('b'.repeat(64))
      .mockReturnValueOnce(new Promise<string>(resolve => { release = resolve }))
    const pending = processAvgAudioPcmWaveWithWorkerV1(s), failure = expect(pending).rejects.toThrow(/总时限/)
    await vi.advanceTimersByTimeAsync(AVG_AUDIO_WORKER_TIMEOUT_MS_V1); await failure
    release(s.source.contentHash); for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(ControlledWorker.instances).toHaveLength(0); expect(hash(s.data)).toBe(s.source.contentHash)
  })

  it('terminates a running Worker on abort and ignores its captured late callback', async () => {
    const controller = new AbortController(), started = posted(), pending = runAvgAudioGainWorkerV1({ ...input(), signal: controller.signal })
    const worker = await started, callback = worker.onmessage!, reply = success(worker), failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await failure; callback({ data: reply } as MessageEvent<unknown>); await Promise.resolve()
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(ControlledWorker.instances).toHaveLength(1)
  })

  it('terminates an idle computation at the fixed deadline without restart', async () => {
    vi.useFakeTimers()
    const started = posted(), pending = runAvgAudioGainWorkerV1(input()), worker = await started
    const callback = worker.onmessage!, reply = success(worker), failure = expect(pending).rejects.toThrow(/超时/)
    await vi.advanceTimersByTimeAsync(AVG_AUDIO_WORKER_TIMEOUT_MS_V1); await failure
    callback({ data: reply } as MessageEvent<unknown>); await Promise.resolve()
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(ControlledWorker.instances).toHaveLength(1)
  })

  it.each(['job', 'layout', 'gain', 'source', 'recipe'])('rejects a changed %s claim', async mode => {
    const started = posted(), pending = runAvgAudioGainWorkerV1(input()), worker = await started, reply = success(worker)
    if (mode === 'job') reply.jobId = 'another-job'
    if (mode === 'layout') { reply.channelCount = 1; reply.sampleCount = 4 }
    if (mode === 'gain') reply.gainMilliDb = 0
    if (mode === 'source') reply.sourcePcmHash = 'b'.repeat(64)
    if (mode === 'recipe') reply.recipeHash = 'b'.repeat(64)
    worker.emit(reply); await expect(pending).rejects.toThrow(/不属于|改变/)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('rejects a changed non-peak sample even when all claimed hashes and dimensions match', async () => {
    const started = posted(), pending = runAvgAudioGainWorkerV1(input()), worker = await started, reply = success(worker)
    new DataView(reply.pcm).setInt16(0, 502, true)
    expect(() => parseAvgAudioGainWorkerReplyV1(reply)).not.toThrow()
    worker.emit(reply); await expect(pending).rejects.toThrow(/实际样本/)
  })

  it('snapshots the first reply and ignores duplicate/reused mutable reply bytes', async () => {
    const started = posted(), pending = runAvgAudioGainWorkerV1(input()), worker = await started, callback = worker.onmessage!, reply = success(worker)
    callback({ data: reply } as MessageEvent<unknown>); new DataView(reply.pcm).setInt16(0, 900, true)
    callback({ data: reply } as MessageEvent<unknown>)
    const result = await pending
    expect(new Int16Array(result.pcm)[0]).toBe(501); expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('closes post, execution and message errors without automatically retrying', async () => {
    ControlledWorker.throwOnPost = true
    await expect(runAvgAudioGainWorkerV1(input())).rejects.toThrow(/post failure/)
    expect(ControlledWorker.instances[0].terminate).toHaveBeenCalledOnce(); ControlledWorker.throwOnPost = false
    for (const mode of ['execution', 'message', 'reported']) {
      const started = posted(), pending = runAvgAudioGainWorkerV1(input()), worker = await started
      if (mode === 'execution') worker.onerror!({ preventDefault: vi.fn() } as unknown as ErrorEvent)
      if (mode === 'message') worker.onmessageerror!()
      if (mode === 'reported') worker.emit({ schema: 'storyforge.avg.audio-gain-worker-reply', version: 1, jobId: worker.request.jobId, ok: false, message: '明确失败' })
      await expect(pending).rejects.toThrow(); expect(worker.terminate).toHaveBeenCalledOnce()
    }
    expect(ControlledWorker.instances).toHaveLength(4)
  })

  it('keeps the full source WAV and typed receipt byte-equivalent to direct evaluation', async () => {
    const s = await waveInput(), direct = await processAvgAudioPcmWaveV1(s)
    ControlledWorker.onPosted = worker => worker.emit(success(worker))
    const result = await processAvgAudioPcmWaveWithWorkerV1(s)
    expect(result).toEqual(direct); expect(hash(s.data)).toBe(s.source.contentHash)
    expect(ControlledWorker.instances).toHaveLength(1); expect(ControlledWorker.instances[0].terminate).toHaveBeenCalledOnce()
  })
})
