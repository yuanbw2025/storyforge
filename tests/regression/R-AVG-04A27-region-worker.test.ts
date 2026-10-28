// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { avgRegionCompositeByteFixture } from '../helpers/avg-region-composite-byte-fixture'
import { runAvgRegionCompositeWorkersV1 } from '../../src/lib/avg/image-region-composite-worker-client'
import { parseAvgRegionCompositeWorkerRequestV1, AVG_REGION_COMPOSITE_WORKER_TIMEOUT_MS_V1 } from '../../src/lib/avg/image-region-composite-worker-protocol'
import { processAvgRegionCompositeBytesV1, verifyAvgRegionCompositeBytesV1 } from '../../src/lib/avg/image-region-composite-pixels'

type Fault = 'normal' | 'never' | 'bad-job' | 'bad-operation' | 'error' | 'duplicate'
const modes: Fault[] = [], workers: ObservedWorker[] = []
class ObservedWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { preventDefault(): void }) => void) | null = null
  onmessageerror: (() => void) | null = null
  saved: ((event: { data: unknown }) => void) | null = null
  terminated = 0
  readonly fault: Fault
  constructor(readonly url: URL, readonly options: WorkerOptions) { this.fault = modes.shift() ?? 'normal'; workers.push(this) }
  terminate() { this.terminated++ }
  postMessage(value: unknown, transfer: Transferable[]) {
    const copied = structuredClone(value, { transfer }), request = parseAvgRegionCompositeWorkerRequestV1(copied)
    this.saved = this.onmessage
    if (this.fault === 'never') return
    if (this.fault === 'error') { queueMicrotask(() => this.onerror?.({ preventDefault() {} })); return }
    void (async () => {
      const result = request.operation === 'process'
        ? await processAvgRegionCompositeBytesV1({ ...request.input, renderer: { userAgent: 'worker-fixture', platform: 'test' } })
        : { receipt: await verifyAvgRegionCompositeBytesV1({ ...request.input, data: request.data, receipt: request.receipt }) }
      if (this.terminated) return
      const reply = { schema: 'storyforge.avg.region-worker-reply', version: 1,
        jobId: this.fault === 'bad-job' ? 'another-job' : request.jobId, ok: true,
        operation: this.fault === 'bad-operation' ? (request.operation === 'process' ? 'verify' : 'process') : request.operation, ...result }
      this.saved?.({ data: reply })
      if (this.fault === 'duplicate') this.saved?.({ data: { ...reply, jobId: 'late-duplicate' } })
    })().catch(error => this.onmessage?.({ data: { schema: 'storyforge.avg.region-worker-reply', version: 1,
      jobId: request.jobId, ok: false, message: String(error.message) } }))
  }
}
beforeEach(() => { modes.length = 0; workers.length = 0; vi.stubGlobal('Worker', ObservedWorker) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('AVG region worker ownership, independent verification and finite cancellation', () => {
  it('computes and independently verifies with exactly two terminated workers, preserving caller-owned buffers', async () => {
    const input = await avgRegionCompositeByteFixture(), source = input.sourceData.slice(0), base = input.baseData.slice(0)
    const result = await runAvgRegionCompositeWorkersV1(input)
    expect(workers.map(w => w.options.name)).toEqual(['avg-region-process-v1', 'avg-region-verify-v1'])
    expect(workers.every(w => w.url.href.endsWith('/image-region-composite.worker.ts') && w.options.type === 'module' && w.terminated === 1)).toBe(true)
    expect(input.sourceData).toEqual(source); expect(input.baseData).toEqual(base)
    expect(result.data.byteLength).toBe(result.receipt.output.byteSize)
  })
  it.each(['bad-job', 'bad-operation', 'error'] as const)('rejects %s with one terminated worker and no automatic retry', async fault => {
    const input = await avgRegionCompositeByteFixture(); modes.push(fault)
    await expect(runAvgRegionCompositeWorkersV1(input)).rejects.toThrow()
    expect(workers).toHaveLength(1); expect(workers[0].terminated).toBe(1)
  })
  it('withholds the computed output if the independent verifier fails', async () => {
    const input = await avgRegionCompositeByteFixture(); modes.push('normal', 'error')
    await expect(runAvgRegionCompositeWorkersV1(input)).rejects.toThrow(/Worker/)
    expect(workers).toHaveLength(2); expect(workers.every(w => w.terminated === 1)).toBe(true)
  })
  it('pre-cancels without a worker; active cancellation terminates and discards a late reply', async () => {
    const input = await avgRegionCompositeByteFixture(), controller = new AbortController(); controller.abort()
    await expect(runAvgRegionCompositeWorkersV1({ ...input, signal: controller.signal })).rejects.toThrow(/aborted/)
    expect(workers).toHaveLength(0)
    const active = new AbortController(); modes.push('never')
    const pending = runAvgRegionCompositeWorkersV1({ ...input, signal: active.signal })
    active.abort(); await expect(pending).rejects.toThrow(/aborted/)
    workers[0].saved?.({ data: { jobId: 'late-after-cancel', ok: true } })
    await Promise.resolve()
    expect(workers).toHaveLength(1); expect(workers[0].terminated).toBe(1)
  })
  it('terminates on its exact deadline without starting a replacement worker', async () => {
    const input = await avgRegionCompositeByteFixture(); modes.push('never'); vi.useFakeTimers()
    const pending = runAvgRegionCompositeWorkersV1(input), rejected = expect(pending).rejects.toThrow(/超时/)
    await vi.advanceTimersByTimeAsync(AVG_REGION_COMPOSITE_WORKER_TIMEOUT_MS_V1 + 1); await rejected
    expect(workers).toHaveLength(1); expect(workers[0].terminated).toBe(1)
  })
  it('ignores duplicate messages and rejects combined pixel overflow before starting native work', async () => {
    const input = await avgRegionCompositeByteFixture(); modes.push('duplicate', 'normal')
    await expect(runAvgRegionCompositeWorkersV1(input)).resolves.toHaveProperty('receipt')
    expect(workers).toHaveLength(2)
    await expect(runAvgRegionCompositeWorkersV1({ ...input, source: { ...input.source, width: 4096, height: 4096 } })).rejects.toThrow(/合计像素/)
    expect(workers).toHaveLength(2)
  })
})
