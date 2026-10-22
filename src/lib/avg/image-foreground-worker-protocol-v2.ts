import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1 } from '../product-production/character-alpha-matting'
import { AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2, matteAvgForegroundBoundaryUnmixV2 } from './image-foreground-boundary-unmix'
import { parseAvgForegroundPolicyV2, type AvgForegroundPolicyV2 } from './image-foreground-contract'
import { assertAvgForegroundRasterV1 } from './image-foreground-worker-protocol'
import { avgEnum, avgHash, avgNumber, avgRecord, avgText } from './protocol-validation'

export const AVG_FOREGROUND_OBSERVATION_KEYS_V2 = ['version', 'algorithm', 'baseAlgorithm', 'removedPixelRatio',
  'algorithmMaskRatio', 'reservedBorderRatio', 'clearedPixelCount', 'translucentPixelCount', 'opaquePixelCount',
  'correctedPixelCount', 'unsupportedBoundaryPixelCount', 'maxCompositeResidual'] as const
export interface AvgForegroundPixelObservationV2 {
  version: 2
  algorithm: typeof AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2
  baseAlgorithm: typeof DECLARED_MAGENTA_ALPHA_MATTING_ID_V1
  removedPixelRatio: number
  algorithmMaskRatio: number
  reservedBorderRatio: number
  clearedPixelCount: number
  translucentPixelCount: number
  opaquePixelCount: number
  correctedPixelCount: number
  unsupportedBoundaryPixelCount: number
  maxCompositeResidual: number
}
interface RequestFields {
  schema: 'storyforge.avg.foreground-worker-request'; version: 2; jobId: string
  width: number; height: number; rgba: ArrayBuffer; policy: AvgForegroundPolicyV2
}
export type AvgForegroundWorkerRequestV2 = RequestFields & ({ phase: 'compute' } | {
  phase: 'verify'; expectedRGBA: ArrayBuffer; expectedObservation: AvgForegroundPixelObservationV2
})
interface ReplyFields {
  schema: 'storyforge.avg.foreground-worker-reply'; version: 2; jobId: string
}
export type AvgForegroundWorkerReplyV2 = ReplyFields & ({ ok: false; phase: 'compute' | 'verify'; message: string }
  | { ok: true; phase: 'compute'; width: number; height: number; rgba: ArrayBuffer; observation: AvgForegroundPixelObservationV2 }
  | { ok: true; phase: 'verify'; width: number; height: number; sourcePixelHash: string; verifiedCandidatePixelHash: string; observation: AvgForegroundPixelObservationV2 })

export function parseAvgForegroundPixelObservationV2(value: unknown, width: number, height: number): AvgForegroundPixelObservationV2 {
  assertAvgForegroundRasterV1(width, height, width * height * 4)
  const r = avgRecord(value, [...AVG_FOREGROUND_OBSERVATION_KEYS_V2], 'foreground boundary observation')
  if (r.version !== 2) throw new Error('[avg-foreground] 边缘还原观察版本无效')
  const result: AvgForegroundPixelObservationV2 = { version: 2,
    algorithm: avgEnum(r.algorithm, [AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2] as const, 'foreground.algorithm'),
    baseAlgorithm: avgEnum(r.baseAlgorithm, [DECLARED_MAGENTA_ALPHA_MATTING_ID_V1] as const, 'foreground.baseAlgorithm'),
    removedPixelRatio: avgNumber(r.removedPixelRatio, 'foreground.removedPixelRatio', 0, 0.92, false),
    algorithmMaskRatio: avgNumber(r.algorithmMaskRatio, 'foreground.algorithmMaskRatio', 0.05, 0.92, false),
    reservedBorderRatio: avgNumber(r.reservedBorderRatio, 'foreground.reservedBorderRatio', 0.95, 1, false),
    clearedPixelCount: avgNumber(r.clearedPixelCount, 'foreground.clearedPixelCount', 1, width * height),
    translucentPixelCount: avgNumber(r.translucentPixelCount, 'foreground.translucentPixelCount', 0, width * height),
    opaquePixelCount: avgNumber(r.opaquePixelCount, 'foreground.opaquePixelCount', 1, width * height),
    correctedPixelCount: avgNumber(r.correctedPixelCount, 'foreground.correctedPixelCount', 0, 200_000),
    unsupportedBoundaryPixelCount: avgNumber(r.unsupportedBoundaryPixelCount, 'foreground.unsupportedBoundaryPixelCount', 0, 200_000),
    maxCompositeResidual: avgNumber(r.maxCompositeResidual, 'foreground.maxCompositeResidual', 0, 1.5, false) }
  if (result.clearedPixelCount + result.translucentPixelCount + result.opaquePixelCount !== width * height
    || result.removedPixelRatio !== (result.clearedPixelCount + result.translucentPixelCount) / (width * height)
    || result.correctedPixelCount + result.unsupportedBoundaryPixelCount > 200_000) throw new Error('[avg-foreground] 边缘还原像素统计不闭合')
  return result
}
export function parseAvgForegroundWorkerRequestV2(value: unknown): AvgForegroundWorkerRequestV2 {
  const phase = value && typeof value === 'object' && 'phase' in value ? value.phase : null
  const r = avgRecord(value, ['schema', 'version', 'phase', 'jobId', 'width', 'height', 'rgba', 'policy',
    ...(phase === 'verify' ? ['expectedRGBA', 'expectedObservation'] : [])], 'foreground boundary Worker request')
  if (r.schema !== 'storyforge.avg.foreground-worker-request' || r.version !== 2 || !(r.rgba instanceof ArrayBuffer)
    || phase !== 'compute' && phase !== 'verify') throw new Error('[avg-foreground] 边缘还原 Worker 请求版本或原字节无效')
  const width = avgNumber(r.width, 'worker.width', 2, 10_000), height = avgNumber(r.height, 'worker.height', 2, 10_000)
  assertAvgForegroundRasterV1(width, height, r.rgba.byteLength)
  const fields: RequestFields = { schema: r.schema, version: 2, jobId: avgText(r.jobId, 'worker.jobId', 100),
    width, height, rgba: r.rgba, policy: parseAvgForegroundPolicyV2(r.policy) }
  if (phase === 'compute') return { ...fields, phase }
  if (!(r.expectedRGBA instanceof ArrayBuffer)) throw new Error('[avg-foreground] 缺少准确待核验像素')
  assertAvgForegroundRasterV1(width, height, r.expectedRGBA.byteLength)
  return { ...fields, phase, expectedRGBA: r.expectedRGBA,
    expectedObservation: parseAvgForegroundPixelObservationV2(r.expectedObservation, width, height) }
}
export function parseAvgForegroundWorkerReplyV2(value: unknown): AvgForegroundWorkerReplyV2 {
  const fields = value && typeof value === 'object' ? value : null
  const ok = fields && 'ok' in fields ? fields.ok : null, phase = fields && 'phase' in fields ? fields.phase : null
  const r = avgRecord(value, ['schema', 'version', 'jobId', 'phase', 'ok', ...(ok !== true ? ['message']
    : ['width', 'height', 'observation', ...(phase === 'compute' ? ['rgba'] : ['sourcePixelHash', 'verifiedCandidatePixelHash'])])], 'foreground boundary Worker reply')
  if (r.schema !== 'storyforge.avg.foreground-worker-reply' || r.version !== 2 || typeof ok !== 'boolean'
    || phase !== 'compute' && phase !== 'verify') throw new Error('[avg-foreground] 边缘还原 Worker 返回版本无效')
  const base: ReplyFields = { schema: r.schema, version: 2, jobId: avgText(r.jobId, 'worker.jobId', 100) }
  if (!ok) return { ...base, phase, ok: false, message: avgText(r.message, 'worker.message', 1000) }
  const width = avgNumber(r.width, 'worker.width', 2, 10_000), height = avgNumber(r.height, 'worker.height', 2, 10_000)
  const observation = parseAvgForegroundPixelObservationV2(r.observation, width, height)
  if (phase === 'compute') {
    if (!(r.rgba instanceof ArrayBuffer)) throw new Error('[avg-foreground] Worker 未返回实际边缘像素')
    assertAvgForegroundRasterV1(width, height, r.rgba.byteLength)
    return { ...base, phase, ok: true, width, height, rgba: r.rgba, observation }
  }
  return { ...base, phase, ok: true, width, height, observation,
    sourcePixelHash: avgHash(r.sourcePixelHash, 'worker.sourcePixelHash'),
    verifiedCandidatePixelHash: avgHash(r.verifiedCandidatePixelHash, 'worker.verifiedCandidatePixelHash') }
}
export async function hashAvgForegroundPixelsV2(pixels: Uint8Array | Uint8ClampedArray): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(pixels).buffer))
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Fixed-module numerical computation or exact recomputation only. No DB,
 * model, producer, candidate or author-write authority exists in this module. */
export async function executeAvgForegroundWorkerRequestV2(value: unknown): Promise<AvgForegroundWorkerReplyV2> {
  let jobId = 'invalid-request', phase: 'compute' | 'verify' = 'compute'
  try {
    const request = parseAvgForegroundWorkerRequestV2(value); jobId = request.jobId; phase = request.phase
    const source = new Uint8ClampedArray(request.rgba.slice(0)), expected = request.phase === 'verify' ? new Uint8ClampedArray(request.expectedRGBA.slice(0)) : null
    const result = matteAvgForegroundBoundaryUnmixV2({ width: request.width, height: request.height, data: source })
    const observation = parseAvgForegroundPixelObservationV2({ version: 2, algorithm: result.algorithm, baseAlgorithm: result.baseAlgorithm,
      removedPixelRatio: (result.clearedPixelCount + result.translucentPixelCount) / (request.width * request.height),
      algorithmMaskRatio: result.baseMaskRatio, reservedBorderRatio: result.reservedBorderRatio,
      clearedPixelCount: result.clearedPixelCount, translucentPixelCount: result.translucentPixelCount, opaquePixelCount: result.opaquePixelCount,
      correctedPixelCount: result.correctedPixelCount, unsupportedBoundaryPixelCount: result.unsupportedBoundaryPixelCount,
      maxCompositeResidual: result.maxCompositeResidual }, request.width, request.height)
    const base = { schema: 'storyforge.avg.foreground-worker-reply' as const, version: 2 as const, jobId,
      width: request.width, height: request.height, observation }
    if (request.phase === 'compute') return { ...base, phase: 'compute', ok: true, rgba: new Uint8ClampedArray(result.data).buffer }
    if (!expected || JSON.stringify(observation) !== JSON.stringify(request.expectedObservation)) throw new Error('[avg-foreground] 独立复算的边缘观察不一致')
    for (let offset = 0; offset < result.data.length; offset += 1) {
      if (result.data[offset] !== expected[offset]) throw new Error('[avg-foreground] 独立复算的实际边缘像素不一致')
    }
    const [sourcePixelHash, verifiedCandidatePixelHash] = await Promise.all([hashAvgForegroundPixelsV2(source), hashAvgForegroundPixelsV2(result.data)])
    return { ...base, phase: 'verify', ok: true, sourcePixelHash, verifiedCandidatePixelHash }
  } catch (cause) {
    return { schema: 'storyforge.avg.foreground-worker-reply', version: 2, jobId, phase, ok: false,
      message: (cause instanceof Error ? cause.message : '边缘还原计算失败').slice(0, 1000) }
  }
}
