import { avgBoolean, avgEnum, avgKey, avgRecord, avgText } from './protocol-validation'
import { parseAvgRegionCompositeByteMetadataV1, type AvgRegionCompositeByteInputV1 } from './image-region-composite-pixels'
import { parseAvgImageRegionCompositeReceiptV3, type AvgImageRegionCompositeReceiptV3 } from './image-region-composite-receipt'
import { AVG_REGION_COMPOSITE_PIXEL_LIMIT_V1 } from './image-region-composite-contract'

export const AVG_REGION_COMPOSITE_WORKER_TIMEOUT_MS_V1 = 45_000
export type AvgRegionCompositeWorkerRequestV1 = { schema: 'storyforge.avg.region-worker-request'; version: 1; jobId: string; input: AvgRegionCompositeByteInputV1 } & (
  { operation: 'process' } | { operation: 'verify'; data: ArrayBuffer; receipt: AvgImageRegionCompositeReceiptV3 })
export type AvgRegionCompositeWorkerReplyV1 = { schema: 'storyforge.avg.region-worker-reply'; version: 1; jobId: string } & (
  { ok: false; message: string } | { ok: true; operation: 'process'; data: ArrayBuffer; receipt: AvgImageRegionCompositeReceiptV3 }
  | { ok: true; operation: 'verify'; receipt: AvgImageRegionCompositeReceiptV3 })

export function assertAvgRegionCompositeByteInputV1(value: unknown): AvgRegionCompositeByteInputV1 {
  const r = avgRecord(value, ['recipe', 'source', 'sourceData', 'base', 'baseData', 'inputProof'], 'region worker input')
  const metadata = parseAvgRegionCompositeByteMetadataV1({ recipe: r.recipe, source: r.source, base: r.base, inputProof: r.inputProof } as Omit<AvgRegionCompositeByteInputV1, 'sourceData' | 'baseData'>)
  if (!(r.sourceData instanceof ArrayBuffer) || !(r.baseData instanceof ArrayBuffer)
    || r.sourceData.byteLength !== metadata.source.byteSize || r.baseData.byteLength !== metadata.base.byteSize
    || metadata.source.width * metadata.source.height + metadata.base.width * metadata.base.height > AVG_REGION_COMPOSITE_PIXEL_LIMIT_V1) {
    throw new Error('[avg-composite] Worker 两输入字节或合计像素超过预算')
  }
  return { ...metadata, sourceData: r.sourceData, baseData: r.baseData }
}
export function parseAvgRegionCompositeWorkerRequestV1(value: unknown): AvgRegionCompositeWorkerRequestV1 {
  const operation = value && typeof value === 'object' && 'operation' in value ? value.operation : null
  const r = avgRecord(value, ['schema', 'version', 'jobId', 'operation', 'input', ...(operation === 'verify' ? ['data', 'receipt'] : [])], 'region worker request')
  if (r.schema !== 'storyforge.avg.region-worker-request' || r.version !== 1) throw new Error('[avg-composite] Worker 请求版本无效')
  const base = { schema: 'storyforge.avg.region-worker-request' as const, version: 1 as const, jobId: avgKey(r.jobId, 'region worker jobId'), input: assertAvgRegionCompositeByteInputV1(r.input) }
  if (avgEnum(r.operation, ['process', 'verify'], 'region worker operation') === 'process') return { ...base, operation: 'process' }
  const receipt = parseAvgImageRegionCompositeReceiptV3(r.receipt)
  if (!(r.data instanceof ArrayBuffer) || r.data.byteLength !== receipt.output.byteSize) throw new Error('[avg-composite] Worker 成品字节不符')
  return { ...base, operation: 'verify', data: r.data, receipt }
}
export function parseAvgRegionCompositeWorkerReplyV1(value: unknown): AvgRegionCompositeWorkerReplyV1 {
  const ok = value && typeof value === 'object' && 'ok' in value ? value.ok : null
  const operation = value && typeof value === 'object' && 'operation' in value ? value.operation : null
  const r = avgRecord(value, ['schema', 'version', 'jobId', 'ok', ...(ok === true ? ['operation', 'receipt', ...(operation === 'process' ? ['data'] : [])] : ['message'])], 'region worker reply')
  if (r.schema !== 'storyforge.avg.region-worker-reply' || r.version !== 1) throw new Error('[avg-composite] Worker 回应版本无效')
  const base = { schema: 'storyforge.avg.region-worker-reply' as const, version: 1 as const, jobId: avgKey(r.jobId, 'region reply jobId') }
  if (!avgBoolean(r.ok, 'region reply ok')) return { ...base, ok: false, message: avgText(r.message, 'region reply message', 1000) }
  const receipt = parseAvgImageRegionCompositeReceiptV3(r.receipt)
  if (avgEnum(r.operation, ['process', 'verify'], 'region reply operation') === 'verify') return { ...base, ok: true, operation: 'verify', receipt }
  if (!(r.data instanceof ArrayBuffer) || r.data.byteLength !== receipt.output.byteSize) throw new Error('[avg-composite] Worker 结果字节不符')
  return { ...base, ok: true, operation: 'process', data: r.data, receipt }
}
