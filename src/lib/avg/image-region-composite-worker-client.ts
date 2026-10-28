import { assertAvgRegionCompositeByteInputV1, parseAvgRegionCompositeWorkerReplyV1, AVG_REGION_COMPOSITE_WORKER_TIMEOUT_MS_V1,
  type AvgRegionCompositeWorkerRequestV1 } from './image-region-composite-worker-protocol'
import { assertAvgImageRegionCompositeReceiptV3, sameAvgRegionValueV1, type AvgImageRegionCompositeReceiptV3 } from './image-region-composite-receipt'
import type { AvgRegionCompositeByteInputV1 } from './image-region-composite-pixels'

const aborted = () => new DOMException('AVG region worker aborted', 'AbortError')
type ProcessRequest = Extract<AvgRegionCompositeWorkerRequestV1, { operation: 'process' }>
type VerifyRequest = Extract<AvgRegionCompositeWorkerRequestV1, { operation: 'verify' }>
function workerRequest(input: AvgRegionCompositeByteInputV1, result?: { data: ArrayBuffer; receipt: AvgImageRegionCompositeReceiptV3 }): { request: AvgRegionCompositeWorkerRequestV1; transfer: ArrayBuffer[] } {
  const checked = assertAvgRegionCompositeByteInputV1({ recipe: input.recipe, source: input.source, sourceData: input.sourceData,
    base: input.base, baseData: input.baseData, inputProof: input.inputProof }), sourceData = checked.sourceData.slice(0), baseData = checked.baseData.slice(0)
  const common = { schema: 'storyforge.avg.region-worker-request' as const, version: 1 as const, jobId: crypto.randomUUID(), input: { ...checked, sourceData, baseData } }
  if (!result) return { request: { ...common, operation: 'process' }, transfer: [sourceData, baseData] }
  const data = result.data.slice(0)
  return { request: { ...common, operation: 'verify', data, receipt: result.receipt }, transfer: [sourceData, baseData, data] }
}
function runWorker(request: ProcessRequest, transfer: ArrayBuffer[], signal?: AbortSignal): Promise<{ data: ArrayBuffer; receipt: AvgImageRegionCompositeReceiptV3 }>
function runWorker(request: VerifyRequest, transfer: ArrayBuffer[], signal?: AbortSignal): Promise<{ receipt: AvgImageRegionCompositeReceiptV3 }>
function runWorker(request: AvgRegionCompositeWorkerRequestV1, transfer: ArrayBuffer[], signal?: AbortSignal): Promise<{ data?: ArrayBuffer; receipt: AvgImageRegionCompositeReceiptV3 }> {
  if (signal?.aborted) return Promise.reject(aborted())
  if (typeof Worker !== 'function') return Promise.reject(new Error('[avg-composite] 当前环境缺少可终止的专用 Worker'))
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null, settled = false, received = false
    const terminate = () => { if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); worker = null } }
    const finish = (error: unknown, value?: { data?: ArrayBuffer; receipt: AvgImageRegionCompositeReceiptV3 }) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); terminate()
      if (error) reject(error); else resolve(value!)
    }
    const cancel = () => finish(aborted())
    const accept = async (value: unknown) => {
      if (settled || received) return
      received = true; terminate()
      try {
        const reply = parseAvgRegionCompositeWorkerReplyV1(value)
        if (reply.jobId !== request.jobId) throw new Error('[avg-composite] Worker 回应不属于本次计算')
        if (!reply.ok) throw new Error(reply.message)
        if (reply.operation !== request.operation) throw new Error('[avg-composite] Worker 回应操作不符')
        const receipt = await assertAvgImageRegionCompositeReceiptV3(request.input.recipe, reply.receipt)
        if (signal?.aborted) throw aborted()
        finish(null, { receipt, ...(reply.operation === 'process' ? { data: reply.data } : {}) })
      } catch (error) { finish(error) }
    }
    const timer = setTimeout(() => finish(new Error('[avg-composite] 本地计算超时，Worker 已终止')), AVG_REGION_COMPOSITE_WORKER_TIMEOUT_MS_V1)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) { cancel(); return }
    try {
      worker = request.operation==='process'
        ?new Worker(new URL('./image-region-composite.worker.ts', import.meta.url), { type: 'module', name: 'avg-region-process-v1' })
        :new Worker(new URL('./image-region-composite.worker.ts', import.meta.url), { type: 'module', name: 'avg-region-verify-v1' })
      worker.onmessage = event => { void accept(event.data) }
      worker.onerror = event => { event.preventDefault(); finish(new Error('[avg-composite] 专用 Worker 执行失败')) }
      worker.onmessageerror = () => finish(new Error('[avg-composite] 专用 Worker 回应无法读取'))
      worker.postMessage(request, transfer)
    } catch (error) { finish(error) }
  })
}
/** One independent verification worker, no fallback or retry. The durable
 * consumer still proves its own current/frozen Work inputs before calling. */
export async function verifyAvgRegionCompositeWorkerV1(input: AvgRegionCompositeByteInputV1 & {
  data: ArrayBuffer; receipt: AvgImageRegionCompositeReceiptV3; signal?: AbortSignal
}) {
  if (input.signal?.aborted) throw aborted()
  const { request, transfer } = workerRequest(input, input)
  if (request.operation !== 'verify') throw new Error('[avg-composite] 缺少明确校验操作')
  const result = await runWorker(request, transfer, input.signal)
  if (!sameAvgRegionValueV1(result.receipt, input.receipt)) throw new Error('[avg-composite] 校验 Worker 替换了回执')
  return result.receipt
}
/** Compute and independently recompute in two bounded dedicated workers.
 * Caller-owned original buffers remain intact; abort/timeout terminates workers
 * and returns no artifact. No model, DB write or adoption is performed here. */
export async function runAvgRegionCompositeWorkersV1(input: AvgRegionCompositeByteInputV1 & { signal?: AbortSignal }) {
  if (input.signal?.aborted) throw aborted()
  const { request, transfer } = workerRequest(input)
  if (request.operation !== 'process') throw new Error('[avg-composite] 缺少明确计算操作')
  const result = await runWorker(request, transfer, input.signal)
  await verifyAvgRegionCompositeWorkerV1({ ...input, ...result })
  if (input.signal?.aborted) throw aborted()
  return result
}
