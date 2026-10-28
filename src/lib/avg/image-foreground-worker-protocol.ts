import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1, DECLARED_MAGENTA_PIXEL_LIMIT_V1,
  matteDeclaredMagentaCharacterBackdropV1 } from '../product-production/character-alpha-matting'
import { parseAvgForegroundPolicyV1, type AvgForegroundPolicyV1 } from './image-foreground-contract'
import { avgEnum, avgNumber, avgRecord, avgText } from './protocol-validation'

// Separate numerical candidate only; neither the V1 transport nor a formal
// production policy dispatches this new algorithm before its own acceptance.
export { matteAvgForegroundBoundaryUnmixV2, iterateAvgForegroundBoundaryUnmixV2,
  AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2 } from './image-foreground-boundary-unmix'

export interface AvgForegroundWorkerRequestV1 {
  schema: 'storyforge.avg.foreground-worker-request'
  version: 1
  jobId: string
  width: number
  height: number
  rgba: ArrayBuffer
  policy: AvgForegroundPolicyV1
}
export interface AvgForegroundPixelObservationV1 {
  algorithm: typeof DECLARED_MAGENTA_ALPHA_MATTING_ID_V1
  removedPixelRatio: number
  algorithmMaskRatio: number
  reservedBorderRatio: number
  clearedPixelCount: number
  translucentPixelCount: number
  opaquePixelCount: number
}
export type AvgForegroundWorkerReplyV1 = {
  schema: 'storyforge.avg.foreground-worker-reply'; version: 1; jobId: string; ok: true
  width: number; height: number; rgba: ArrayBuffer; observation: AvgForegroundPixelObservationV1
} | { schema: 'storyforge.avg.foreground-worker-reply'; version: 1; jobId: string; ok: false; message: string }

export function assertAvgForegroundRasterV1(width: number, height: number, byteLength: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || width > 10_000 || height > 10_000 || width * height > DECLARED_MAGENTA_PIXEL_LIMIT_V1
    || byteLength !== width * height * 4) throw new Error('[avg-foreground] Worker 源栅格或像素上限无效')
}
export function parseAvgForegroundWorkerRequestV1(value: unknown): AvgForegroundWorkerRequestV1 {
  const r = avgRecord(value, ['schema', 'version', 'jobId', 'width', 'height', 'rgba', 'policy'], 'foreground Worker request')
  if (r.schema !== 'storyforge.avg.foreground-worker-request' || r.version !== 1 || !(r.rgba instanceof ArrayBuffer)) throw new Error('[avg-foreground] Worker 请求版本或像素字节无效')
  const width = avgNumber(r.width, 'worker.width', 2, 10_000), height = avgNumber(r.height, 'worker.height', 2, 10_000)
  assertAvgForegroundRasterV1(width, height, r.rgba.byteLength)
  return { schema: r.schema, version: 1, jobId: avgText(r.jobId, 'worker.jobId', 100), width, height,
    rgba: r.rgba, policy: parseAvgForegroundPolicyV1(r.policy) }
}
export function parseAvgForegroundWorkerReplyV1(value: unknown): AvgForegroundWorkerReplyV1 {
  const record = value && typeof value === 'object' && 'ok' in value ? value : null
  const ok = record?.ok
  const r = avgRecord(value, ok === true ? ['schema', 'version', 'jobId', 'ok', 'width', 'height', 'rgba', 'observation']
    : ['schema', 'version', 'jobId', 'ok', 'message'], 'foreground Worker reply')
  if (r.schema !== 'storyforge.avg.foreground-worker-reply' || r.version !== 1 || typeof ok !== 'boolean') throw new Error('[avg-foreground] Worker 返回版本无效')
  const jobId = avgText(r.jobId, 'worker.jobId', 100)
  if (!ok) return { schema: r.schema, version: 1, jobId, ok: false, message: avgText(r.message, 'worker.message', 1000) }
  if (!(r.rgba instanceof ArrayBuffer)) throw new Error('[avg-foreground] Worker 未返回真实像素字节')
  const width = avgNumber(r.width, 'worker.width', 2, 10_000), height = avgNumber(r.height, 'worker.height', 2, 10_000)
  assertAvgForegroundRasterV1(width, height, r.rgba.byteLength)
  const observation = parseAvgForegroundPixelObservationV1(r.observation, width, height)
  return { schema: r.schema, version: 1, jobId, ok: true, width, height, rgba: r.rgba, observation }
}
/** Shared numeric observation codec; it grants no pixel or producer authority. */
export function parseAvgForegroundPixelObservationV1(value: unknown, width: number, height: number): AvgForegroundPixelObservationV1 {
  assertAvgForegroundRasterV1(width, height, width * height * 4)
  const o = avgRecord(value, ['algorithm', 'removedPixelRatio', 'algorithmMaskRatio', 'reservedBorderRatio', 'clearedPixelCount', 'translucentPixelCount', 'opaquePixelCount'], 'foreground Worker observation')
  const observation: AvgForegroundPixelObservationV1 = {
    algorithm: avgEnum(o.algorithm, [DECLARED_MAGENTA_ALPHA_MATTING_ID_V1] as const, 'worker.algorithm'),
    removedPixelRatio: avgNumber(o.removedPixelRatio, 'worker.removedPixelRatio', 0, 0.92, false),
    algorithmMaskRatio: avgNumber(o.algorithmMaskRatio, 'worker.algorithmMaskRatio', 0.05, 0.92, false),
    reservedBorderRatio: avgNumber(o.reservedBorderRatio, 'worker.reservedBorderRatio', 0.95, 1, false),
    clearedPixelCount: avgNumber(o.clearedPixelCount, 'worker.clearedPixelCount', 1, width * height),
    translucentPixelCount: avgNumber(o.translucentPixelCount, 'worker.translucentPixelCount', 0, width * height),
    opaquePixelCount: avgNumber(o.opaquePixelCount, 'worker.opaquePixelCount', 1, width * height) }
  if (observation.clearedPixelCount + observation.translucentPixelCount + observation.opaquePixelCount !== width * height
    || observation.removedPixelRatio !== (observation.clearedPixelCount + observation.translucentPixelCount) / (width * height)) throw new Error('[avg-foreground] Worker 像素统计不闭合')
  return observation
}

/** One pure operation. The worker has no DB, transport, producer or adoption authority. */
export function executeAvgForegroundWorkerRequestV1(value: unknown): AvgForegroundWorkerReplyV1 {
  let jobId = 'invalid-request'
  try {
    const request = parseAvgForegroundWorkerRequestV1(value); jobId = request.jobId
    const result = matteDeclaredMagentaCharacterBackdropV1({ width: request.width, height: request.height, data: new Uint8ClampedArray(request.rgba) })
    return { schema: 'storyforge.avg.foreground-worker-reply', version: 1, jobId, ok: true,
      width: request.width, height: request.height, rgba: new Uint8ClampedArray(result.data).buffer,
      observation: { algorithm: DECLARED_MAGENTA_ALPHA_MATTING_ID_V1,
        removedPixelRatio: (result.clearedPixelCount + result.translucentPixelCount) / (request.width * request.height),
        algorithmMaskRatio: result.removedPixelRatio,
        reservedBorderRatio: result.reservedBorderRatio, clearedPixelCount: result.clearedPixelCount,
        translucentPixelCount: result.translucentPixelCount, opaquePixelCount: result.opaquePixelCount } }
  } catch (cause) {
    return { schema: 'storyforge.avg.foreground-worker-reply', version: 1, jobId, ok: false,
      message: (cause instanceof Error ? cause.message : '前景计算失败').slice(0, 1000) }
  }
}
