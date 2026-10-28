import { avgEnum, avgHash, avgRecord } from './protocol-validation'
import {
  AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4, AVG_FOREGROUND_SAM2_MODEL_REVISION_V4,
  AVG_FOREGROUND_SAM2_MATTING_ID_V6, AVG_FOREGROUND_SAM2_MATTING_METHOD_V6, AVG_FOREGROUND_SAM2_QUALITY_GATE_V6,
  AVG_FOREGROUND_SAM2_NEUTRAL_RULE_V6, AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5,
  AVG_FOREGROUND_SAM2_MIN_COVERAGE_V5, AVG_FOREGROUND_SAM2_MAX_COVERAGE_V5,
  parseAvgForegroundPolicyV6, type AvgForegroundPolicyV6,
} from './image-foreground-contract'
import { deriveAvgNeutralBackgroundV1, parseAvgNeutralBackgroundObservationV1, type AvgNeutralBackgroundObservationV1 } from './image-foreground-neutral-background'
import { buildAvgSam2PromptManifestV5, readAvgSam2SelectionHeadersV5, selectAvgSam2CandidateV5, parseAvgSam2AlphaCountsV1,
  type AvgForegroundSam2ProcessingObservationV5 } from './image-foreground-sam2-v5'
import { assertAvgSam2ServiceReady, readAvgSam2RatioHeader, runAvgSam2Transport, type AvgSam2Fetcher, type AvgSam2TransportInput } from './image-foreground-sam2-transport'
import { sha256MediaData } from '../product-production/media-blob-store'

export interface AvgForegroundSam2ProcessingObservationV6 extends Omit<AvgForegroundSam2ProcessingObservationV5, 'version' | 'algorithm' | 'mattingMethod' | 'qualityGate'> {
  version: 6
  algorithm: typeof AVG_FOREGROUND_SAM2_MATTING_ID_V6
  mattingMethod: typeof AVG_FOREGROUND_SAM2_MATTING_METHOD_V6
  qualityGate: typeof AVG_FOREGROUND_SAM2_QUALITY_GATE_V6
  background: AvgNeutralBackgroundObservationV1
}
export function assertAvgSam2ForegroundCapabilityV6(value: unknown) {
  const r = avgRecord(value, ['schema', 'version', 'ready', 'algorithm', 'model', 'modelRevision', 'checkpointSha256',
    'codeRevision', 'device', 'storage', 'networkInference', 'mattingMethod', 'promptStrategy', 'qualityGate', 'backgroundRule'], 'SAM 2 V6 capability')
  if (r.schema !== 'storyforge.avg.local-foreground-capability' || r.version !== 3 || r.ready !== true
    || r.algorithm !== AVG_FOREGROUND_SAM2_MATTING_ID_V6 || r.model !== 'sam2.1-hiera-tiny'
    || r.modelRevision !== AVG_FOREGROUND_SAM2_MODEL_REVISION_V4 || r.checkpointSha256 !== AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4
    || r.codeRevision !== AVG_FOREGROUND_SAM2_MODEL_REVISION_V4 || r.storage !== 'none' || r.networkInference !== false
    || r.mattingMethod !== AVG_FOREGROUND_SAM2_MATTING_METHOD_V6 || r.promptStrategy !== AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5
    || r.qualityGate !== AVG_FOREGROUND_SAM2_QUALITY_GATE_V6 || r.backgroundRule !== AVG_FOREGROUND_SAM2_NEUTRAL_RULE_V6) throw new Error('[avg-foreground-sam2] 本机服务与冻结 V6 亮灰背景配方不一致')
  return { device: avgEnum(r.device, ['cpu', 'mps', 'mps+cpu-fallback'] as const, 'sam2.device') }
}
export async function assertAvgSam2ForegroundServiceReadyV6(fetcher: AvgSam2Fetcher = globalThis.fetch): Promise<void> {
  await assertAvgSam2ServiceReady({ api: 'v3', assertCapability: assertAvgSam2ForegroundCapabilityV6, fetcher })
}
type V6Claims = Omit<AvgForegroundSam2ProcessingObservationV6, 'alphaCoverage' | 'clearedPixelCount' | 'translucentPixelCount' | 'opaquePixelCount' | 'cutoutPixelHash'>
export function parseAvgSam2ForegroundHeadersV6(headers: Headers, input: { sourceHash: string; width: number; height: number; policy: AvgForegroundPolicyV6 }): V6Claims {
  const policy = parseAvgForegroundPolicyV6(input.policy)
  if (headers.get('X-SF-Algorithm') !== policy.algorithm || headers.get('X-SF-Source-SHA256') !== input.sourceHash
    || headers.get('X-SF-Model-ID') !== policy.model || headers.get('X-SF-Model-Revision') !== policy.modelRevision
    || headers.get('X-SF-Checkpoint-SHA256') !== policy.checkpointSha256 || headers.get('X-SF-Code-Revision') !== policy.modelRevision
    || headers.get('X-SF-Prompt-Strategy') !== policy.promptStrategy || headers.get('X-SF-Matting-Method') !== policy.mattingMethod
    || headers.get('X-SF-Quality-Gate') !== policy.qualityGate || headers.get('X-SF-Width') !== String(input.width)
    || headers.get('X-SF-Height') !== String(input.height)) throw new Error('[avg-foreground-sam2] 本机来源、模型、策略或尺寸与 V6 冻结配方不一致')
  const selection = readAvgSam2SelectionHeadersV5(headers), encodedBackground = headers.get('X-SF-Neutral-Background')
  if (!encodedBackground || encodedBackground.length > 2048) throw new Error('[avg-foreground-sam2] 缺少有界亮灰背景观察')
  const background = parseAvgNeutralBackgroundObservationV1(JSON.parse(encodedBackground), input.width, input.height, selection.maskCoverage)
  return { version: 6, algorithm: policy.algorithm, modelId: policy.model, modelRevision: policy.modelRevision,
    checkpointSha256: policy.checkpointSha256, codeRevision: policy.modelRevision, promptStrategy: policy.promptStrategy,
    qualityGate: policy.qualityGate, ...selection, background, mattingMethod: policy.mattingMethod,
    alphaThresholdCoverage: readAvgSam2RatioHeader(headers.get('X-SF-Alpha-Ratio'), 'sam2.alphaThresholdCoverage', AVG_FOREGROUND_SAM2_MIN_COVERAGE_V5, AVG_FOREGROUND_SAM2_MAX_COVERAGE_V5),
    device: avgEnum(headers.get('X-SF-Device'), ['cpu', 'mps', 'mps+cpu-fallback'] as const, 'sam2.device'),
    width: input.width, height: input.height, policyHash: '',
    promptSha256: avgHash(headers.get('X-SF-Prompt-SHA256'), 'sam2.promptSha256'), sourcePixelHash: avgHash(headers.get('X-SF-Source-Pixel-SHA256'), 'sam2.sourcePixelHash'),
    alphaPlaneHash: avgHash(headers.get('X-SF-Alpha-SHA256'), 'sam2.alphaPlaneHash'), serviceCutoutPixelHash: avgHash(headers.get('X-SF-Cutout-Pixel-SHA256'), 'sam2.serviceCutoutPixelHash'),
    resultPngSha256: avgHash(headers.get('X-SF-Result-PNG-SHA256'), 'sam2.resultPngSha256') }
}
export async function runAvgForegroundSam2V6(input: AvgSam2TransportInput & { policy: AvgForegroundPolicyV6; rgba: Uint8ClampedArray }):
Promise<{ rgba: Uint8ClampedArray; observation: AvgForegroundSam2ProcessingObservationV6 }> {
  const policy = parseAvgForegroundPolicyV6(input.policy), source = { ...input.source }, data = input.data.slice(0), signal = input.signal
  if (!data.byteLength || data.byteLength > 32 * 1024 * 1024) throw new Error('[avg-foreground-sam2] 原图字节超出上限')
  const [analysis, sourceHash] = await Promise.all([deriveAvgNeutralBackgroundV1({ ...source, rgba: input.rgba, signal }), sha256MediaData(data)])
  if (sourceHash !== source.contentHash) throw new Error('[avg-foreground-sam2] 原图字节 hash 不符')
  const result = await runAvgSam2Transport({ data, source, policy, signal }, { api: 'v3', prompts: buildAvgSam2PromptManifestV5(),
    parseClaims: headers => parseAvgSam2ForegroundHeadersV6(headers, { ...source, sourceHash, policy }) })
  const actual = result.observation.background, expected = analysis.observation
  if (result.observation.sourcePixelHash !== analysis.sourcePixelHash || actual.median.some((v, i) => v !== expected.median[i])
    || actual.borderP99Deviation !== expected.borderP99Deviation || actual.radius !== expected.radius
    || actual.borderCoverage !== expected.borderCoverage || actual.floodPixelCount !== expected.floodPixelCount
    || actual.floodMaskSha256 !== expected.floodMaskSha256) throw new Error('[avg-foreground-sam2] 浏览器独立背景分析与服务观察不符')
  for (let index = 0; index < analysis.flood.length; index++) {
    if (analysis.flood[index] && result.rgba[index * 4 + 3] !== 0) throw new Error('[avg-foreground-sam2] 已确认的连通背景仍保留不透明像素')
  }
  if (signal?.aborted) throw new DOMException('SAM 2 V6 verification aborted', 'AbortError')
  if (Math.abs(result.thresholdCoverage - result.observation.alphaThresholdCoverage) > 0.0000000051) throw new Error('[avg-foreground-sam2] V6 alpha 覆盖率与实际字节不符')
  return { rgba: result.rgba, observation: parseAvgForegroundSam2ObservationV6({ ...result.observation, alphaThresholdCoverage: result.thresholdCoverage }) }
}
export function parseAvgForegroundSam2ObservationV6(value: unknown): AvgForegroundSam2ProcessingObservationV6 {
  const r = avgRecord(value, ['version', 'algorithm', 'modelId', 'modelRevision', 'checkpointSha256', 'codeRevision', 'promptStrategy',
    'promptSha256', 'modelScore', 'maskCoverage', 'alphaCoverage', 'mattingMethod', 'device', 'clearedPixelCount', 'translucentPixelCount',
    'opaquePixelCount', 'width', 'height', 'policyHash', 'sourcePixelHash', 'alphaPlaneHash', 'cutoutPixelHash', 'serviceCutoutPixelHash',
    'resultPngSha256', 'qualityGate', 'selectedCandidateIndex', 'candidates', 'alphaThresholdCoverage', 'background'], 'SAM 2 V6 observation')
  if (r.version !== 6 || r.algorithm !== AVG_FOREGROUND_SAM2_MATTING_ID_V6 || r.modelId !== 'sam2.1-hiera-tiny'
    || r.modelRevision !== AVG_FOREGROUND_SAM2_MODEL_REVISION_V4 || r.codeRevision !== AVG_FOREGROUND_SAM2_MODEL_REVISION_V4
    || r.checkpointSha256 !== AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4 || r.promptStrategy !== AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5
    || r.mattingMethod !== AVG_FOREGROUND_SAM2_MATTING_METHOD_V6 || r.qualityGate !== AVG_FOREGROUND_SAM2_QUALITY_GATE_V6) throw new Error('[avg-foreground-sam2] V6 观察未使用登记的模型、背景策略与挡板')
  const selection = selectAvgSam2CandidateV5(r.candidates), selected = selection.candidates[selection.selectedCandidateIndex]!
  if (r.selectedCandidateIndex !== selection.selectedCandidateIndex || r.modelScore !== selected.score || r.maskCoverage !== selected.maskCoverage) throw new Error('[avg-foreground-sam2] V6 掩模选择不一致')
  const counts = parseAvgSam2AlphaCountsV1(r, 'V6')
  return { version: 6, algorithm: AVG_FOREGROUND_SAM2_MATTING_ID_V6, modelId: 'sam2.1-hiera-tiny',
    modelRevision: AVG_FOREGROUND_SAM2_MODEL_REVISION_V4, checkpointSha256: AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4,
    codeRevision: AVG_FOREGROUND_SAM2_MODEL_REVISION_V4, promptStrategy: AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5,
    mattingMethod: AVG_FOREGROUND_SAM2_MATTING_METHOD_V6, qualityGate: AVG_FOREGROUND_SAM2_QUALITY_GATE_V6,
    ...counts, ...selection, modelScore: selected.score, maskCoverage: selected.maskCoverage,
    background: parseAvgNeutralBackgroundObservationV1(r.background, counts.width, counts.height, selected.maskCoverage),
    device: avgEnum(r.device, ['cpu', 'mps', 'mps+cpu-fallback'] as const, 'sam2.device'),
    policyHash: avgHash(r.policyHash, 'sam2.policyHash'), promptSha256: avgHash(r.promptSha256, 'sam2.promptSha256'),
    sourcePixelHash: avgHash(r.sourcePixelHash, 'sam2.sourcePixelHash'), alphaPlaneHash: avgHash(r.alphaPlaneHash, 'sam2.alphaPlaneHash'),
    cutoutPixelHash: avgHash(r.cutoutPixelHash, 'sam2.cutoutPixelHash'), serviceCutoutPixelHash: avgHash(r.serviceCutoutPixelHash, 'sam2.serviceCutoutPixelHash'),
    resultPngSha256: avgHash(r.resultPngSha256, 'sam2.resultPngSha256') }
}
