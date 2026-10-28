import { parseAvgForegroundPolicy, type AvgForegroundPolicyV2, type AvgForegroundPolicyV3 } from './image-foreground-contract'
import { assertAvgForegroundRasterV1 } from './image-foreground-worker-protocol'
import { hashAvgForegroundPixelsV2, parseAvgForegroundWorkerReplyV2,
  type AvgForegroundPixelObservation, type AvgForegroundWorkerRequestV2 } from './image-foreground-worker-protocol-v2'

export const AVG_FOREGROUND_WORKER_TIMEOUT_MS_V2 = 20_000
export interface AvgForegroundWorkerResultV2 {
  rgba: Uint8ClampedArray
    observation: AvgForegroundPixelObservation & {
    width: number; height: number; sourcePixelHash: string; cutoutPixelHash: string; alphaPlaneHash: string
  }
}
const aborted = () => new DOMException('AVG foreground boundary processing aborted', 'AbortError')
const timedOut = () => new Error('[avg-foreground] 边缘计算或独立核验超时，原图保留且不自动重试')
const yieldHost = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** Two sequential fixed-module Workers under one deadline: compute, then
 * independently recompute/compare every byte. Host verifies source/result
 * hashes, actual alpha and observation. V1's RGB-preserving path is unchanged.
 * This tool has no producer, DB, author-choice or retry authority. */
export async function runAvgForegroundWorkerV2(input: {
  width: number; height: number; rgba: Uint8ClampedArray; policy: AvgForegroundPolicyV2 | AvgForegroundPolicyV3; signal?: AbortSignal
}): Promise<AvgForegroundWorkerResultV2> {
  const started = performance.now(), { width, height, signal } = input
  if (signal?.aborted) throw aborted()
  const policy = parseAvgForegroundPolicy(input.policy)
  if (policy.version !== 2 && policy.version !== 3) throw new Error('[avg-foreground] 边缘复算 Worker 仅接受登记的本地像素算法')
  if (!(input.rgba instanceof Uint8ClampedArray) || !(input.rgba.buffer instanceof ArrayBuffer)) throw new Error('[avg-foreground] 边缘计算需要独立RGBA来源')
  assertAvgForegroundRasterV1(width, height, input.rgba.byteLength)
  if (typeof Worker !== 'function') throw new Error('[avg-foreground] 当前浏览器不支持可中止的边缘Worker')
  const source = new Uint8ClampedArray(input.rgba)
  return new Promise<AvgForegroundWorkerResultV2>((resolve, reject) => {
    let worker: Worker | null = null, settled = false, sequence = 0
    const received = new Set<number>()
    let sourcePixelHash = '', cutoutPixelHash = '', alphaPlaneHash = ''
    let pixels: Uint8ClampedArray | null = null, observation: AvgForegroundPixelObservation | null = null
    const stopWorker = () => {
      if (!worker) return
      const current = worker; worker = null
      current.onmessage = null; current.onerror = null; current.onmessageerror = null; current.terminate()
    }
    const finish = (error: unknown, result?: AvgForegroundWorkerResultV2) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); stopWorker()
      if (error) reject(error); else resolve(result!)
    }
    const onAbort = () => finish(aborted())
    const assertActive = () => {
      if (settled || signal?.aborted) throw aborted()
      if (performance.now() - started >= AVG_FOREGROUND_WORKER_TIMEOUT_MS_V2) throw timedOut()
    }
    const accept = async (id: number, phase: 'compute' | 'verify', value: unknown) => {
      if (settled || id !== sequence || received.has(id)) return
      received.add(id); stopWorker()
      try {
        assertActive()
        const reply = parseAvgForegroundWorkerReplyV2(value)
        if (reply.jobId !== `${jobId}:${phase}` || reply.phase !== phase) throw new Error('[avg-foreground] Worker结果不属于准确计算或核验阶段')
        if (!reply.ok) throw new Error(reply.message)
        if (reply.width !== width || reply.height !== height) throw new Error('[avg-foreground] Worker边缘尺寸变化')
        if (reply.phase === 'compute') {
          pixels = new Uint8ClampedArray(reply.rgba.slice(0)); observation = reply.observation
          const alpha = new Uint8Array(width * height)
          let cleared = 0, translucent = 0, opaque = 0
          for (let begin = 0; begin < pixels.length; begin += 65_536) {
            const end = Math.min(pixels.length, begin + 65_536)
            for (let offset = begin; offset < end; offset += 4) {
              const a = pixels[offset + 3]; alpha[offset / 4] = a
              if (a === 0) cleared += 1; else if (a === 255) opaque += 1; else translucent += 1
            }
            if (end < pixels.length) { await yieldHost(); assertActive() }
          }
          if (cleared !== observation.clearedPixelCount || translucent !== observation.translucentPixelCount
            || opaque !== observation.opaquePixelCount) throw new Error('[avg-foreground] 实际边缘alpha与观察不一致')
          ;[cutoutPixelHash, alphaPlaneHash] = await Promise.all([hashAvgForegroundPixelsV2(pixels), hashAvgForegroundPixelsV2(alpha)])
          assertActive()
          const rawCopy = new Uint8ClampedArray(source), candidateCopy = new Uint8ClampedArray(pixels)
          post({ schema: 'storyforge.avg.foreground-worker-request', version: 2, phase: 'verify', jobId: `${jobId}:verify`,
            width, height, rgba: rawCopy.buffer, policy, expectedRGBA: candidateCopy.buffer, expectedObservation: observation },
          [rawCopy.buffer, candidateCopy.buffer])
          return
        }
        if (!pixels || !observation || reply.sourcePixelHash !== sourcePixelHash || reply.verifiedCandidatePixelHash !== cutoutPixelHash
          || JSON.stringify(reply.observation) !== JSON.stringify(observation)) throw new Error('[avg-foreground] 独立复算的原图、候选hash或观察不一致')
        assertActive()
        finish(null, { rgba: pixels, observation: { ...observation, width, height, sourcePixelHash, cutoutPixelHash, alphaPlaneHash } })
      } catch (error) { finish(error) }
    }
    const post = (request: AvgForegroundWorkerRequestV2, transfer: Transferable[]) => {
      assertActive()
      if (worker) throw new Error('[avg-foreground] 边缘计算不能并行或重入')
      const id = ++sequence
      // Vite also parses these options in the regression runner. Keep every
      // constructor literal static while naming both independently verified phases.
      worker = policy.version === 2
        ? request.phase === 'compute'
          ? new Worker(new URL('./image-foreground.worker.ts', import.meta.url), { type: 'module', name: 'avg-foreground-v2-compute' })
          : new Worker(new URL('./image-foreground.worker.ts', import.meta.url), { type: 'module', name: 'avg-foreground-v2-verify' })
        : request.phase === 'compute'
          ? new Worker(new URL('./image-foreground.worker.ts', import.meta.url), { type: 'module', name: 'avg-foreground-v3-compute' })
          : new Worker(new URL('./image-foreground.worker.ts', import.meta.url), { type: 'module', name: 'avg-foreground-v3-verify' })
      worker.onmessage = event => { void accept(id, request.phase, event.data) }
      worker.onerror = event => {
        if (settled || id !== sequence || received.has(id)) return
        event.preventDefault(); finish(new Error('[avg-foreground] 本地边缘Worker执行失败'))
      }
      worker.onmessageerror = () => {
        if (settled || id !== sequence || received.has(id)) return
        finish(new Error('[avg-foreground] 本地边缘Worker返回无法读取'))
      }
      worker.postMessage(request, transfer)
    }
    const start = async () => {
      for (let begin = 0; begin < source.length; begin += 65_536) {
        const end = Math.min(source.length, begin + 65_536)
        for (let offset = begin + 3; offset < end; offset += 4) if (source[offset] !== 255) throw new Error('[avg-foreground] 边缘还原需要不透明原图')
        if (end < source.length) { await yieldHost(); assertActive() }
      }
      sourcePixelHash = await hashAvgForegroundPixelsV2(source); assertActive()
      const rawCopy = new Uint8ClampedArray(source)
      post({ schema: 'storyforge.avg.foreground-worker-request', version: 2, phase: 'compute', jobId: `${jobId}:compute`,
        width, height, rgba: rawCopy.buffer, policy }, [rawCopy.buffer])
    }
    const jobId = crypto.randomUUID()
    const timer = setTimeout(() => finish(timedOut()), Math.max(0, AVG_FOREGROUND_WORKER_TIMEOUT_MS_V2 - (performance.now() - started)))
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    void start().catch(error => finish(error))
  })
}
