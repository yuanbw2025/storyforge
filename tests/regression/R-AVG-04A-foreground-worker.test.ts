// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as mediaBytes from '../../src/lib/product-production/media-blob-store'
import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1 } from '../../src/lib/product-production/character-alpha-matting'
import { runAvgForegroundWorkerV1, AVG_FOREGROUND_WORKER_TIMEOUT_MS_V1 } from '../../src/lib/avg/image-foreground-worker-client'
import { executeAvgForegroundWorkerRequestV1, parseAvgForegroundWorkerReplyV1,
  type AvgForegroundWorkerReplyV1, type AvgForegroundWorkerRequestV1 } from '../../src/lib/avg/image-foreground-worker-protocol'
import type { AvgForegroundPolicyV1 } from '../../src/lib/avg/image-foreground-contract'

const policy: AvgForegroundPolicyV1 = { schema: 'storyforge.avg.foreground-policy', version: 1,
  method: 'reserved-magenta', reservedColor: '#FF00FF', subjectUsesReservedColor: false,
  algorithm: DECLARED_MAGENTA_ALPHA_MATTING_ID_V1, declaration: '明确保留底色，处理后另行视觉评审。' }
const hash = (data: Uint8Array | Uint8ClampedArray) => createHash('sha256').update(data).digest('hex')
function input() {
  const rgba = new Uint8ClampedArray(30 * 30 * 4)
  for (let i = 0; i < rgba.length; i += 4) rgba.set([255, 0, 255, 255], i)
  for (let y = 5; y < 25; y += 1) for (let x = 6; x < 24; x += 1) rgba.set([30, 60, 90, 255], (y * 30 + x) * 4)
  return { width: 30, height: 30, rgba, policy: structuredClone(policy) }
}

// Controlled lifecycle port, without native Worker/Canvas or a producer. A
// separate browser test must prove the bundled worker and actual termination.
class ControlledWorker {
  static instances: ControlledWorker[] = []
  static onPosted: (worker: ControlledWorker) => void = () => undefined
  static throwOnPost = false
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  request!: AvgForegroundWorkerRequestV1
  terminate = vi.fn()
  constructor(readonly url: URL, readonly options: WorkerOptions) { ControlledWorker.instances.push(this) }
  postMessage(message: AvgForegroundWorkerRequestV1, transfer: Transferable[]) {
    if (ControlledWorker.throwOnPost) throw new Error('Controlled local post failure')
    this.request = structuredClone(message, { transfer })
    ControlledWorker.onPosted(this)
  }
  emit(reply: AvgForegroundWorkerReplyV1) { this.onmessage?.({ data: reply } as MessageEvent<unknown>) }
}
function posted() { return new Promise<ControlledWorker>(resolve => { ControlledWorker.onPosted = resolve }) }
function success(worker: ControlledWorker) {
  const reply = executeAvgForegroundWorkerRequestV1(worker.request)
  if (!reply.ok) throw new Error(reply.message)
  return reply
}
beforeEach(() => {
  ControlledWorker.instances = []; ControlledWorker.throwOnPost = false; ControlledWorker.onPosted = () => undefined
  vi.stubGlobal('Worker', ControlledWorker)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('AVG bounded foreground Worker port and independently measured pixels', () => {
  it('transfers only a copy and measures actual returned pixels, alpha, hashes and original dimensions', async () => {
    const source = input(), original = source.rgba.slice(), started = posted(), pending = runAvgForegroundWorkerV1(source)
    const worker = await started
    expect(worker.url.pathname).toContain('image-foreground.worker.ts')
    expect(worker.options).toEqual({ type: 'module', name: 'avg-foreground-v1' })
    expect(source.rgba.byteLength).toBe(3600)
    worker.emit(success(worker))
    const result = await pending
    expect(source.rgba).toEqual(original)
    expect(result.observation).toMatchObject({ width: 30, height: 30, sourcePixelHash: hash(original), cutoutPixelHash: hash(result.rgba) })
    const alpha = new Uint8Array(900)
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = result.rgba[i * 4 + 3]
    expect(result.observation.alphaPlaneHash).toBe(hash(alpha))
    expect(result.observation.clearedPixelCount).toBeGreaterThan(0)
    expect(result.observation.opaquePixelCount).toBeGreaterThan(0)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.onmessage).toBeNull()
  })

  it('snapshots layout, source pixels and policy before asynchronous work', async () => {
    const source = input(), originalHash = hash(source.rgba), started = posted(), pending = runAvgForegroundWorkerV1(source)
    const worker = await started
    source.width = 15; source.height = 60; source.rgba[0] = 0; source.policy.declaration = '后来修改'
    worker.emit(success(worker))
    const result = await pending
    expect(result.observation).toMatchObject({ width: 30, height: 30, sourcePixelHash: originalHash })
    expect(result.rgba[0]).toBe(255)
    expect(worker.request.policy.declaration).not.toBe(source.policy.declaration)
  })

  it('refuses existing alpha or missing Worker capability before starting any computation', async () => {
    const source = input(); source.rgba[3] = 0
    await expect(runAvgForegroundWorkerV1(source)).rejects.toThrow(/不透明原图/)
    expect(ControlledWorker.instances).toHaveLength(0)
    vi.stubGlobal('Worker', undefined)
    await expect(runAvgForegroundWorkerV1(input())).rejects.toThrow(/不支持/)
    expect(ControlledWorker.instances).toHaveLength(0)
  })

  it('does not start a Worker for an already aborted request', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(runAvgForegroundWorkerV1({ ...input(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(ControlledWorker.instances).toHaveLength(0)
  })

  it('settles abort during source hashing and never starts a Worker when the hash arrives late', async () => {
    let release!: (hash: string) => void
    vi.spyOn(mediaBytes, 'sha256MediaData').mockReturnValueOnce(new Promise<string>(resolve => { release = resolve }))
    const controller = new AbortController(), pending = runAvgForegroundWorkerV1({ ...input(), signal: controller.signal })
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await failure
    release('0'.repeat(64)); await Promise.resolve(); await Promise.resolve()
    expect(ControlledWorker.instances).toHaveLength(0)
  })

  it('bounds preparation too and discards a late hash after its deadline', async () => {
    vi.useFakeTimers()
    let release!: (hash: string) => void
    vi.spyOn(mediaBytes, 'sha256MediaData').mockReturnValueOnce(new Promise<string>(resolve => { release = resolve }))
    const pending = runAvgForegroundWorkerV1(input()), failure = expect(pending).rejects.toThrow(/超时/)
    await vi.advanceTimersByTimeAsync(AVG_FOREGROUND_WORKER_TIMEOUT_MS_V1); await failure
    release('0'.repeat(64)); await Promise.resolve(); await Promise.resolve()
    expect(ControlledWorker.instances).toHaveLength(0)
  })

  it('terminates on abort and ignores a captured late successful callback', async () => {
    const controller = new AbortController(), started = posted(), pending = runAvgForegroundWorkerV1({ ...input(), signal: controller.signal })
    const worker = await started, callback = worker.onmessage!, reply = success(worker)
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await failure
    callback({ data: reply } as MessageEvent<unknown>); await Promise.resolve()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(ControlledWorker.instances).toHaveLength(1)
  })

  it('enforces its fixed deadline with termination and no automatic restart', async () => {
    vi.useFakeTimers()
    const started = posted(), pending = runAvgForegroundWorkerV1(input()), worker = await started
    const callback = worker.onmessage!, reply = success(worker), failure = expect(pending).rejects.toThrow(/超时/)
    await vi.advanceTimersByTimeAsync(AVG_FOREGROUND_WORKER_TIMEOUT_MS_V1); await failure
    callback({ data: reply } as MessageEvent<unknown>); await Promise.resolve()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(ControlledWorker.instances).toHaveLength(1)
  })

  it('rejects a wrong job or changed layout instead of accepting another result', async () => {
    for (const mode of ['job', 'layout']) {
      const started = posted(), pending = runAvgForegroundWorkerV1(input()), worker = await started, reply = success(worker)
      worker.emit(mode === 'job' ? { ...reply, jobId: 'another-job' } : { ...reply, width: 15, height: 60 })
      await expect(pending).rejects.toThrow(mode === 'job' ? /不属于/ : /尺寸/)
      expect(worker.terminate).toHaveBeenCalledOnce()
    }
  })

  it('rejects forged but internally consistent counters after measuring actual returned alpha', async () => {
    const started = posted(), pending = runAvgForegroundWorkerV1(input()), worker = await started, reply = success(worker)
    reply.observation.clearedPixelCount -= 1; reply.observation.opaquePixelCount += 1
    reply.observation.removedPixelRatio = (reply.observation.clearedPixelCount + reply.observation.translucentPixelCount) / 900
    expect(() => parseAvgForegroundWorkerReplyV1(reply)).not.toThrow()
    worker.emit(reply)
    await expect(pending).rejects.toThrow(/声明与实际/)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('rejects RGB changes even when dimensions and alpha counters match', async () => {
    const started = posted(), pending = runAvgForegroundWorkerV1(input()), worker = await started, reply = success(worker)
    new Uint8ClampedArray(reply.rgba)[(10 * 30 + 10) * 4] += 1
    worker.emit(reply)
    await expect(pending).rejects.toThrow(/改写/)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('closes local post or execution errors without retrying', async () => {
    ControlledWorker.throwOnPost = true
    await expect(runAvgForegroundWorkerV1(input())).rejects.toThrow(/post failure/)
    expect(ControlledWorker.instances[0].terminate).toHaveBeenCalledOnce()
    ControlledWorker.throwOnPost = false
    const started = posted(), pending = runAvgForegroundWorkerV1(input()), worker = await started, preventDefault = vi.fn()
    worker.onerror!({ preventDefault } as unknown as ErrorEvent)
    await expect(pending).rejects.toThrow(/执行失败/)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(ControlledWorker.instances).toHaveLength(2)
  })

  it('rejects unregistered protocol fields and inaccurate numeric observations', () => {
    const source = input(), request: AvgForegroundWorkerRequestV1 = { schema: 'storyforge.avg.foreground-worker-request',
      version: 1, jobId: 'protocol-only', width: 30, height: 30, rgba: new Uint8ClampedArray(source.rgba).buffer, policy }
    expect(executeAvgForegroundWorkerRequestV1({ ...request, producerAccepted: true }).ok).toBe(false)
    const reply = executeAvgForegroundWorkerRequestV1(request)
    expect(reply.ok).toBe(true)
    if (!reply.ok) throw new Error(reply.message)
    expect(() => parseAvgForegroundWorkerReplyV1({ ...reply, ownerWorkId: 2 })).toThrow()
    expect(() => parseAvgForegroundWorkerReplyV1({ ...reply, observation: { ...reply.observation, removedPixelRatio: 0.1 } })).toThrow(/统计/)
    expect(() => parseAvgForegroundWorkerReplyV1({ ...reply, observation: { ...reply.observation, clearedPixelCount: Number.NaN } })).toThrow()
    expect(() => parseAvgForegroundWorkerReplyV1({ ...reply, rgba: new Uint8ClampedArray(reply.rgba) })).toThrow(/真实像素/)
  })
})
