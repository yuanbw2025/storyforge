import { sha256MediaData } from '../product-production/media-blob-store'
import { parseAvgForegroundPolicyV1, parseAvgForegroundPolicy, type AvgForegroundPolicyV1, type AvgForegroundPolicy } from './image-foreground-contract'
import { assertAvgForegroundRasterV1, parseAvgForegroundWorkerReplyV1,
  type AvgForegroundPixelObservationV1, type AvgForegroundWorkerRequestV1 } from './image-foreground-worker-protocol'
import { runAvgForegroundWorkerV2 } from './image-foreground-worker-client-v2'

export const AVG_FOREGROUND_WORKER_TIMEOUT_MS_V1 = 20_000
export interface AvgForegroundWorkerResultV1 {
  rgba: Uint8ClampedArray
  observation: AvgForegroundPixelObservationV1 & {
    width: number; height: number; sourcePixelHash: string; cutoutPixelHash: string; alphaPlaneHash: string
  }
}
const aborted = () => new DOMException('AVG foreground processing aborted', 'AbortError')

/** Headless bounded pixel tool. The caller must prove frozen source/requirement,
 * then recheck scope/epoch/CAS and seal a producer before storing any result.
 * This API never writes data, dispatches a model or grants author adoption. */
export async function runAvgForegroundWorkerV1(input: {
  width: number; height: number; rgba: Uint8ClampedArray; policy: AvgForegroundPolicyV1; signal?: AbortSignal
}): Promise<AvgForegroundWorkerResultV1> {
  const { width, height, signal } = input
  if (signal?.aborted) throw aborted()
  const policy = parseAvgForegroundPolicyV1(input.policy)
  if (!(input.rgba instanceof Uint8ClampedArray) || !(input.rgba.buffer instanceof ArrayBuffer)) throw new Error('[avg-foreground] Worker 需要独立的 RGBA 像素来源')
  assertAvgForegroundRasterV1(width, height, input.rgba.byteLength)
  if (typeof Worker !== 'function') throw new Error('[avg-foreground] 当前浏览器不支持可中止的前景 Worker')
  const source = new Uint8ClampedArray(input.rgba)
  for (let offset = 3; offset < source.length; offset += 4) {
    if (source[offset] !== 255) throw new Error('[avg-foreground] 声明底色加工需要不透明原图，不能把已有透明像素当成新结果')
  }
  const jobId = crypto.randomUUID()
  return new Promise<AvgForegroundWorkerResultV1>((resolve, reject) => {
    let worker: Worker | null = null, terminated = false, settled = false, received = false
    let sourcePixelHash = ''
    const stopWorker = () => {
      if (!worker || terminated) return
      terminated = true; worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate()
    }
    const finish = (error: unknown, value?: AvgForegroundWorkerResultV1) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort); stopWorker()
      if (error) reject(error); else resolve(value!)
    }
    const onAbort = () => finish(aborted())
    const accept = async (value: unknown) => {
      if (settled || received) return
      received = true; stopWorker()
      try {
        const result = parseAvgForegroundWorkerReplyV1(value)
        if (result.jobId !== jobId) throw new Error('[avg-foreground] Worker 返回不属于本次计算')
        if (!result.ok) throw new Error(result.message)
        if (result.width !== width || result.height !== height) throw new Error('[avg-foreground] Worker 返回尺寸已变化')
        const pixels = new Uint8ClampedArray(result.rgba), alpha = new Uint8Array(width * height)
        let cleared = 0, translucent = 0, opaque = 0
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset] !== source[offset] || pixels[offset + 1] !== source[offset + 1] || pixels[offset + 2] !== source[offset + 2]) throw new Error('[avg-foreground] Worker 改写了主体颜色或来源像素')
          const a = pixels[offset + 3]; alpha[offset / 4] = a
          if (a === 0) cleared += 1; else if (a === 255) opaque += 1; else translucent += 1
        }
        if (cleared !== result.observation.clearedPixelCount || translucent !== result.observation.translucentPixelCount
          || opaque !== result.observation.opaquePixelCount) throw new Error('[avg-foreground] Worker 声明与实际 alpha 像素不一致')
        const [cutoutPixelHash, alphaPlaneHash] = await Promise.all([sha256MediaData(new Uint8Array(pixels).buffer), sha256MediaData(alpha.buffer)])
        if (signal?.aborted) throw aborted()
        finish(null, { rgba: pixels, observation: { ...result.observation, width, height,
          sourcePixelHash, cutoutPixelHash, alphaPlaneHash } })
      } catch (cause) { finish(cause) }
    }
    const start = async () => {
      sourcePixelHash = await sha256MediaData(source.buffer)
      if (settled) return
      if (signal?.aborted) { onAbort(); return }
      const transferred = new Uint8ClampedArray(source)
      worker = new Worker(new URL('./image-foreground.worker.ts', import.meta.url), { type: 'module', name: 'avg-foreground-v1' })
      worker.onmessage = event => { void accept(event.data) }
      worker.onerror = event => { event.preventDefault(); finish(new Error('[avg-foreground] 本地前景 Worker 执行失败')) }
      worker.onmessageerror = () => finish(new Error('[avg-foreground] 本地前景 Worker 返回无法读取'))
      const request: AvgForegroundWorkerRequestV1 = { schema: 'storyforge.avg.foreground-worker-request', version: 1,
        jobId, width, height, rgba: transferred.buffer, policy }
      worker.postMessage(request, [transferred.buffer])
    }
    const timer = setTimeout(() => finish(new Error('[avg-foreground] 本地前景计算超时，计算已停止接收，原图保留')), AVG_FOREGROUND_WORKER_TIMEOUT_MS_V1)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    void start().catch(cause => finish(cause))
  })
}

/** Explicit policy dispatch; never reinterpret V2 as a V1 request. */
export async function runAvgForegroundWorker(input: {
  width: number; height: number; rgba: Uint8ClampedArray; policy: AvgForegroundPolicy; signal?: AbortSignal
}) {
  const policy = parseAvgForegroundPolicy(input.policy)
  if (policy.version === 1) return runAvgForegroundWorkerV1({ ...input, policy })
  if (policy.version === 4 || policy.version === 5 || policy.version === 6) throw new Error('[avg-foreground] SAM 2 需通过受限本机服务执行，不能交给像素 Worker')
  return runAvgForegroundWorkerV2({ ...input, policy })
}
