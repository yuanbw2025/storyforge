import { parseAvgRegionCompositeWorkerRequestV1, type AvgRegionCompositeWorkerReplyV1 } from './image-region-composite-worker-protocol'
import { processAvgRegionCompositeBytesV1, verifyAvgRegionCompositeBytesV1 } from './image-region-composite-pixels'

const channel = self as unknown as { onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: AvgRegionCompositeWorkerReplyV1, transfer?: Transferable[]): void }
channel.onmessage = event => { void (async () => {
  let jobId = 'rejected'
  try {
    const request = parseAvgRegionCompositeWorkerRequestV1(event.data); jobId = request.jobId
    if (request.operation === 'verify') {
      const receipt = await verifyAvgRegionCompositeBytesV1({ ...request.input, data: request.data, receipt: request.receipt })
      channel.postMessage({ schema: 'storyforge.avg.region-worker-reply', version: 1, jobId, ok: true, operation: 'verify', receipt })
    } else {
      const result = await processAvgRegionCompositeBytesV1({ ...request.input, renderer: { userAgent: navigator.userAgent, platform: navigator.platform } })
      channel.postMessage({ schema: 'storyforge.avg.region-worker-reply', version: 1, jobId, ok: true, operation: 'process', ...result }, [result.data])
    }
  } catch (error) {
    channel.postMessage({ schema: 'storyforge.avg.region-worker-reply', version: 1, jobId, ok: false,
      message: String(error instanceof Error ? error.message : error).slice(0, 1000) || '[avg-composite] 本地 Worker 失败' })
  }
})() }
