// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2 } from '../../src/lib/avg/image-foreground-boundary-unmix'
import { parseAvgForegroundPolicyV1, parseAvgForegroundPolicyV2, type AvgForegroundPolicyV2 } from '../../src/lib/avg/image-foreground-contract'
import { runAvgForegroundWorker } from '../../src/lib/avg/image-foreground-worker-client'
import { runAvgForegroundWorkerV2, AVG_FOREGROUND_WORKER_TIMEOUT_MS_V2 } from '../../src/lib/avg/image-foreground-worker-client-v2'
import { executeAvgForegroundWorkerRequestV1 } from '../../src/lib/avg/image-foreground-worker-protocol'
import * as protocol from '../../src/lib/avg/image-foreground-worker-protocol-v2'
import type { AvgForegroundWorkerRequestV2, AvgForegroundWorkerReplyV2 } from '../../src/lib/avg/image-foreground-worker-protocol-v2'

const policy: AvgForegroundPolicyV2 = { schema: 'storyforge.avg.foreground-policy', version: 2, method: 'reserved-magenta',
  reservedColor: '#FF00FF', subjectUsesReservedColor: false, algorithm: AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2,
  declaration: '原图明确预留底色；本次选择独立版本边缘颜色还原，仍待视觉审查。' }
const hash = (a: Uint8Array | Uint8ClampedArray) => createHash('sha256').update(a).digest('hex')
function input() {
  const width = 60, height = 40, rgba = new Uint8ClampedArray(width * height * 4)
  for (let at = 0; at < rgba.length; at += 4) rgba.set([255, 0, 255, 255], at)
  for (let y = 10; y < 30; y += 1) for (let x = 10; x < 50; x += 1) rgba.set([200, 149, 99, 255], (y * width + x) * 4)
  for (let y = 11; y < 29; y += 1) for (const x of [9, 50]) rgba.set([241, 37, 216, 255], (y * width + x) * 4)
  return { width, height, rgba, policy: structuredClone(policy) }
}

// Lifecycle transport only. The bundled Worker and actual PNG are separate
// native acceptance; neither this class nor its replies confer producer rights.
class ControlledWorker {
  static instances: ControlledWorker[] = []
  static queued: ControlledWorker[] = []
  static waiters: Array<(w: ControlledWorker) => void> = []
  static throwOnPost = false
  request!: AvgForegroundWorkerRequestV2
  onmessage: ((e: MessageEvent<unknown>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  constructor(readonly url: URL, readonly options: WorkerOptions) { ControlledWorker.instances.push(this) }
  postMessage(value: AvgForegroundWorkerRequestV2, transfer: Transferable[]) {
    if (ControlledWorker.throwOnPost) throw new Error('Controlled post failure')
    this.request = structuredClone(value, { transfer })
    const waiting = ControlledWorker.waiters.shift()
    if (waiting) waiting(this); else ControlledWorker.queued.push(this)
  }
  emit(value: AvgForegroundWorkerReplyV2) { this.onmessage?.({ data: value } as MessageEvent<unknown>) }
}
const posted = () => ControlledWorker.queued.length ? Promise.resolve(ControlledWorker.queued.shift()!)
  : new Promise<ControlledWorker>(resolve => { ControlledWorker.waiters.push(resolve) })
async function compute(w: ControlledWorker) {
  const reply = await protocol.executeAvgForegroundWorkerRequestV2(w.request)
  if (!reply.ok || reply.phase !== 'compute') throw new Error('Expected actual compute reply')
  return reply
}
async function complete() {
  const first = await posted(); first.emit(await compute(first))
  const second = await posted(); second.emit(await protocol.executeAvgForegroundWorkerRequestV2(second.request))
  return [first, second]
}
beforeEach(() => {
  ControlledWorker.instances = []; ControlledWorker.queued = []; ControlledWorker.waiters = []; ControlledWorker.throwOnPost = false
  vi.stubGlobal('Worker', ControlledWorker)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('AVG explicit boundary Worker2 compute and exact verification, without author authority', () => {
  it('uses two sequential terminated Workers, preserves originals and binds every accepted byte/hash to the recomputation', async () => {
    const source = input(), original = source.rgba.slice(), pending = runAvgForegroundWorkerV2(source)
    const [first, second] = await complete(), result = await pending
    expect([first.options.name, second.options.name]).toEqual(['avg-foreground-v2-compute', 'avg-foreground-v2-verify'])
    for (const w of [first, second]) { expect(w.url.pathname).toContain('image-foreground.worker.ts'); expect(w.terminate).toHaveBeenCalledOnce() }
    expect(source.rgba).toEqual(original)
    const at = (18 * source.width + 9) * 4
    expect([...result.rgba.slice(at, at + 3)]).toEqual([200, 149, 99])
    expect(result.rgba[at + 3]).toBeGreaterThanOrEqual(63); expect(result.rgba[at + 3]).toBeLessThanOrEqual(65)
    const alpha = new Uint8Array(source.width * source.height)
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = result.rgba[i * 4 + 3]
    expect(result.observation).toMatchObject({ version: 2, algorithm: AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2,
      sourcePixelHash: hash(original), cutoutPixelHash: hash(result.rgba), alphaPlaneHash: hash(alpha) })
  })

  it('snapshots policy/layout/pixels before the version facade yields', async () => {
    const source = input(), originalHash = hash(source.rgba), pending = runAvgForegroundWorker(source)
    source.width = 30; source.height = 80; source.rgba[0] = 0; source.policy.declaration = '后来改动'
    await complete(); const result = await pending
    expect(result.observation).toMatchObject({ width: 60, height: 40, sourcePixelHash: originalHash })
    expect(ControlledWorker.instances[0].request.policy.declaration).not.toBe(source.policy.declaration)
  })

  it.each(['rgb', 'alpha'] as const)('rejects a consistent-looking forged %s candidate during exact verification without a retry', async mode => {
    const pending = runAvgForegroundWorkerV2(input()), first = await posted(), reply = await compute(first), at = (18 * 60 + 25) * 4
    if (mode === 'rgb') new Uint8ClampedArray(reply.rgba)[at] += 1
    else {
      new Uint8ClampedArray(reply.rgba)[at + 3] = 0
      reply.observation.clearedPixelCount += 1; reply.observation.opaquePixelCount -= 1
      reply.observation.removedPixelRatio = (reply.observation.clearedPixelCount + reply.observation.translucentPixelCount) / 2400
    }
    first.emit(reply); const second = await posted(), failure = expect(pending).rejects.toThrow(/独立复算/)
    second.emit(await protocol.executeAvgForegroundWorkerRequestV2(second.request)); await failure
    expect(ControlledWorker.instances).toHaveLength(2)
    expect(first.terminate).toHaveBeenCalledOnce(); expect(second.terminate).toHaveBeenCalledOnce()
  })

  it('rejects the wrong source/candidate hash even after a valid verification observation', async () => {
    const pending = runAvgForegroundWorkerV2(input()), first = await posted(); first.emit(await compute(first))
    const second = await posted(), reply = await protocol.executeAvgForegroundWorkerRequestV2(second.request)
    if (!reply.ok || reply.phase !== 'verify') throw new Error('Expected actual verification')
    const failure = expect(pending).rejects.toThrow(/hash/); second.emit({ ...reply, verifiedCandidatePixelHash: '0'.repeat(64) }); await failure
    expect(second.terminate).toHaveBeenCalledOnce()
  })

  it('keeps V1 strict and rejects implicit policies, unknown fields and false numeric observations', async () => {
    expect(() => parseAvgForegroundPolicyV1(policy)).toThrow(/版本/)
    expect(() => parseAvgForegroundPolicyV2({ ...policy, producerAccepted: true })).toThrow(/未知/)
    const source = input(), request: AvgForegroundWorkerRequestV2 = { schema: 'storyforge.avg.foreground-worker-request', version: 2,
      phase: 'compute', jobId: 'strict-boundary-only', width: 60, height: 40, rgba: source.rgba.buffer, policy }
    expect(executeAvgForegroundWorkerRequestV1({ ...request, version: 1 }).ok).toBe(false)
    const reply = await protocol.executeAvgForegroundWorkerRequestV2(request)
    if (!reply.ok || reply.phase !== 'compute') throw new Error('Expected actual compute reply')
    expect(() => protocol.parseAvgForegroundWorkerReplyV2({ ...reply, ownerWorkId: 9 })).toThrow(/未知/)
    expect(() => protocol.parseAvgForegroundWorkerReplyV2({ ...reply, observation: { ...reply.observation, maxCompositeResidual: 9 } })).toThrow()
    expect(() => protocol.parseAvgForegroundWorkerReplyV2({ ...reply, observation: { ...reply.observation, correctedPixelCount: 200_001 } })).toThrow()
  })

  it('rejects job/phase/layout drift before starting verification', async () => {
    for (const mode of ['job', 'phase', 'layout']) {
      const before = ControlledWorker.instances.length, pending = runAvgForegroundWorkerV2(input()), first = await posted(), reply = await compute(first)
      const failure = expect(pending).rejects.toThrow()
      if (mode === 'job') first.emit({ ...reply, jobId: 'foreign-job' })
      else if (mode === 'layout') first.emit({ ...reply, width: 30, height: 80 })
      else first.onmessage?.({ data: { ...reply, phase: 'verify' } } as MessageEvent<unknown>)
      await failure; expect(ControlledWorker.instances).toHaveLength(before + 1)
      expect(first.terminate).toHaveBeenCalledOnce()
    }
  })

  it('terminates an aborted verification and ignores its captured late success', async () => {
    const controller = new AbortController(), pending = runAvgForegroundWorkerV2({ ...input(), signal: controller.signal })
    const first = await posted(); first.emit(await compute(first)); const second = await posted(), callback = second.onmessage!
    const late = await protocol.executeAvgForegroundWorkerRequestV2(second.request), failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await failure; callback({ data: late } as MessageEvent<unknown>); await Promise.resolve()
    expect(ControlledWorker.instances).toHaveLength(2); expect(second.terminate).toHaveBeenCalledOnce()
  })

  it('includes source hashing in its one deadline and never creates a late Worker', async () => {
    vi.useFakeTimers(); let release!: (hash: string) => void
    vi.spyOn(protocol, 'hashAvgForegroundPixelsV2').mockReturnValueOnce(new Promise<string>(resolve => { release = resolve }))
    const pending = runAvgForegroundWorkerV2(input()), failure = expect(pending).rejects.toThrow(/超时/)
    await vi.advanceTimersByTimeAsync(AVG_FOREGROUND_WORKER_TIMEOUT_MS_V2); await failure
    release('0'.repeat(64)); await Promise.resolve(); await Promise.resolve()
    expect(ControlledWorker.instances).toHaveLength(0)
  })

  it('does not reset its deadline between compute and verification', async () => {
    vi.useFakeTimers()
    const pending = runAvgForegroundWorkerV2(input()), first = await posted()
    await vi.advanceTimersByTimeAsync(19_000); first.emit(await compute(first)); const second = await posted()
    const failure = expect(pending).rejects.toThrow(/超时/)
    await vi.advanceTimersByTimeAsync(1000); await failure
    expect(first.terminate).toHaveBeenCalledOnce(); expect(second.terminate).toHaveBeenCalledOnce()
    expect(ControlledWorker.instances).toHaveLength(2)
  })

  it('ignores captured first-phase errors after moving to verification', async () => {
    const pending = runAvgForegroundWorkerV2(input()), first = await posted(), staleError = first.onerror!
    first.emit(await compute(first)); const second = await posted()
    staleError({ preventDefault: vi.fn() } as unknown as ErrorEvent)
    second.emit(await protocol.executeAvgForegroundWorkerRequestV2(second.request))
    await expect(pending).resolves.toMatchObject({ observation: { version: 2 } })
  })

  it('settles local posting failure and already-aborted input without fallback or a second computation', async () => {
    ControlledWorker.throwOnPost = true
    await expect(runAvgForegroundWorkerV2(input())).rejects.toThrow(/post failure/)
    expect(ControlledWorker.instances).toHaveLength(1); expect(ControlledWorker.instances[0].terminate).toHaveBeenCalledOnce()
    const controller = new AbortController(); controller.abort()
    await expect(runAvgForegroundWorkerV2({ ...input(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(ControlledWorker.instances).toHaveLength(1)
  })
})
