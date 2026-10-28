import { hashProductProductionValueV2 } from '../product-production/hash'
import { avgEnum, avgHash, avgNumber, avgRecord } from './protocol-validation'
import {
  AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4, AVG_FOREGROUND_SAM2_MATTING_METHOD_V4, AVG_FOREGROUND_SAM2_MODEL_REVISION_V4,
  AVG_FOREGROUND_SAM2_MATTING_ID_V5, AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5, AVG_FOREGROUND_SAM2_QUALITY_GATE_V5,
  AVG_FOREGROUND_SAM2_MIN_SCORE_V5, AVG_FOREGROUND_SAM2_MIN_COVERAGE_V5, AVG_FOREGROUND_SAM2_MAX_COVERAGE_V5,
  parseAvgForegroundPolicyV5, type AvgForegroundPolicyV5,
} from './image-foreground-contract'
import type { AvgForegroundSam2ProcessingObservationV4 } from './image-foreground-sam2-v4'
import { assertAvgSam2ServiceReady, readAvgSam2RatioHeader, runAvgSam2Transport,
  type AvgSam2Fetcher, type AvgSam2TransportInput } from './image-foreground-sam2-transport'

export interface AvgSam2MaskCandidateV5 { promptIndex: number; maskIndex: number; score: number; maskCoverage: number }
export interface AvgForegroundSam2ProcessingObservationV5 extends Omit<AvgForegroundSam2ProcessingObservationV4, 'version' | 'algorithm' | 'promptStrategy'> {
  version: 5
  algorithm: typeof AVG_FOREGROUND_SAM2_MATTING_ID_V5
  promptStrategy: typeof AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5
  qualityGate: typeof AVG_FOREGROUND_SAM2_QUALITY_GATE_V5
  selectedCandidateIndex: number
  candidates: AvgSam2MaskCandidateV5[]
  alphaThresholdCoverage: number
}
export function buildAvgSam2PromptManifestV5() {
  const box = { x1: 1250, x2: 8750, y1: 100, y2: 9900 }
  return [{ box }, { box: { ...box }, points: [
    { label: 1, x: 5000, y: 1600 }, { label: 1, x: 5000, y: 4000 }, { label: 1, x: 5000, y: 7200 },
  ] }]
}
export function hashAvgSam2PromptManifestV5() {
  return hashProductProductionValueV2({ prompts: buildAvgSam2PromptManifestV5(), strategy: AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5 })
}
function parseCandidates(value: unknown): AvgSam2MaskCandidateV5[] {
  if (!Array.isArray(value) || value.length !== 6) throw new Error('[avg-foreground-sam2] V5 必须记录两组提示的六个掩模观察')
  return value.map((item, index) => {
    const r = avgRecord(item, ['promptIndex', 'maskIndex', 'score', 'maskCoverage'], 'SAM 2 mask candidate')
    if (r.promptIndex !== Math.floor(index / 3) || r.maskIndex !== index % 3) throw new Error('[avg-foreground-sam2] 掩模观察顺序不符')
    return { promptIndex: r.promptIndex, maskIndex: r.maskIndex,
      score: avgNumber(r.score, 'sam2.candidate.score', 0, 1, false), maskCoverage: avgNumber(r.maskCoverage, 'sam2.candidate.maskCoverage', 0, 1, false) }
  })
}
/** Full-person masks take precedence over confidently segmented parts. Among
 * eligible masks choose the largest area, then score, then original order.
 * These plausibility gates are not an art verdict. */
export function selectAvgSam2CandidateV5(value: unknown) {
  const candidates = parseCandidates(value)
  let selectedCandidateIndex = -1
  for (const [index, candidate] of candidates.entries()) {
    if (candidate.score < AVG_FOREGROUND_SAM2_MIN_SCORE_V5 || candidate.maskCoverage < AVG_FOREGROUND_SAM2_MIN_COVERAGE_V5
      || candidate.maskCoverage > AVG_FOREGROUND_SAM2_MAX_COVERAGE_V5) continue
    const previous = candidates[selectedCandidateIndex]
    if (!previous || candidate.maskCoverage > previous.maskCoverage
      || candidate.maskCoverage === previous.maskCoverage && candidate.score > previous.score) selectedCandidateIndex = index
  }
  if (selectedCandidateIndex < 0) throw new Error('[avg-foreground-sam2] 没有掩模达到 V5 分数与覆盖率挡板')
  return { candidates, selectedCandidateIndex }
}
/** An existing alpha channel is already an authored foreground boundary; do
 * not silently discard it and segment the hidden RGB beneath it. */
export function assertAvgSam2OpaqueSourceV5(rgba: Uint8ClampedArray): void {
  if (!rgba.length || rgba.length % 4) throw new Error('[avg-foreground-sam2] 原图像素尺寸无效')
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] !== 255) throw new Error('[avg-foreground-sam2] 原图已有透明像素；请保留原始透明度并使用画布加工')
  }
}
export function assertAvgSam2ForegroundCapabilityV5(value: unknown) {
  const r = avgRecord(value, ['schema', 'version', 'ready', 'algorithm', 'model', 'modelRevision', 'checkpointSha256',
    'codeRevision', 'device', 'storage', 'networkInference', 'mattingMethod', 'promptStrategy', 'qualityGate'], 'SAM 2 V5 local capability')
  if (r.schema !== 'storyforge.avg.local-foreground-capability' || r.version !== 2 || r.ready !== true
    || r.algorithm !== AVG_FOREGROUND_SAM2_MATTING_ID_V5 || r.model !== 'sam2.1-hiera-tiny'
    || r.modelRevision !== AVG_FOREGROUND_SAM2_MODEL_REVISION_V4 || r.checkpointSha256 !== AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4
    || r.codeRevision !== AVG_FOREGROUND_SAM2_MODEL_REVISION_V4 || r.storage !== 'none' || r.networkInference !== false
    || r.mattingMethod !== AVG_FOREGROUND_SAM2_MATTING_METHOD_V4 || r.promptStrategy !== AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5
    || r.qualityGate !== AVG_FOREGROUND_SAM2_QUALITY_GATE_V5) throw new Error('[avg-foreground-sam2] 本机服务能力与冻结 V5 模型配方不一致')
  return { device: avgEnum(r.device, ['cpu', 'mps', 'mps+cpu-fallback'] as const, 'sam2.device') }
}
export async function assertAvgSam2ForegroundServiceReadyV5(fetcher: AvgSam2Fetcher = globalThis.fetch): Promise<void> {
  await assertAvgSam2ServiceReady({ api: 'v2', assertCapability: assertAvgSam2ForegroundCapabilityV5, fetcher })
}

type V5Claims = Omit<AvgForegroundSam2ProcessingObservationV5,
  'alphaCoverage' | 'clearedPixelCount' | 'translucentPixelCount' | 'opaquePixelCount' | 'cutoutPixelHash'>
/** Shared structural selection validation; each protocol separately checks
 * its own algorithm, source, method and capability identity. */
export function readAvgSam2SelectionHeadersV5(headers: Headers) {
  const encodedCandidates = headers.get('X-SF-Candidates')
  if (!encodedCandidates || encodedCandidates.length > 4096) throw new Error('[avg-foreground-sam2] 缺少有界掩模观察')
  const selection = selectAvgSam2CandidateV5(JSON.parse(encodedCandidates))
  if (headers.get('X-SF-Selected-Candidate') !== String(selection.selectedCandidateIndex)) throw new Error('[avg-foreground-sam2] 本机掩模选择与固定挡板不符')
  const selected = selection.candidates[selection.selectedCandidateIndex]!
  const score = readAvgSam2RatioHeader(headers.get('X-SF-Model-Score'), 'sam2.modelScore', AVG_FOREGROUND_SAM2_MIN_SCORE_V5, 1)
  const coverage = readAvgSam2RatioHeader(headers.get('X-SF-Mask-Ratio'), 'sam2.maskCoverage', AVG_FOREGROUND_SAM2_MIN_COVERAGE_V5, AVG_FOREGROUND_SAM2_MAX_COVERAGE_V5)
  if (Math.abs(score - selected.score) > 0.00000051 || Math.abs(coverage - selected.maskCoverage) > 0.0000000051) {
    throw new Error('[avg-foreground-sam2] 掩模分数或覆盖率未绑定所选候选')
  }
  return { ...selection, modelScore: selected.score, maskCoverage: selected.maskCoverage }
}
export function parseAvgSam2ForegroundHeadersV5(headers: Headers, input: {
  sourceHash: string; width: number; height: number; policy: AvgForegroundPolicyV5
}): V5Claims {
  const policy = parseAvgForegroundPolicyV5(input.policy)
  if (headers.get('X-SF-Algorithm') !== policy.algorithm || headers.get('X-SF-Source-SHA256') !== input.sourceHash
    || headers.get('X-SF-Model-ID') !== policy.model || headers.get('X-SF-Model-Revision') !== policy.modelRevision
    || headers.get('X-SF-Checkpoint-SHA256') !== policy.checkpointSha256 || headers.get('X-SF-Code-Revision') !== policy.modelRevision
    || headers.get('X-SF-Prompt-Strategy') !== policy.promptStrategy || headers.get('X-SF-Matting-Method') !== policy.mattingMethod
    || headers.get('X-SF-Quality-Gate') !== policy.qualityGate || headers.get('X-SF-Width') !== String(input.width)
    || headers.get('X-SF-Height') !== String(input.height)) throw new Error('[avg-foreground-sam2] 本机来源、模型、策略或尺寸与 V5 冻结配方不一致')
  const selection = readAvgSam2SelectionHeadersV5(headers)
  return { version: 5, algorithm: policy.algorithm, modelId: policy.model, modelRevision: policy.modelRevision,
    checkpointSha256: policy.checkpointSha256, codeRevision: policy.modelRevision, promptStrategy: policy.promptStrategy,
    qualityGate: policy.qualityGate, ...selection,
    alphaThresholdCoverage: readAvgSam2RatioHeader(headers.get('X-SF-Alpha-Ratio'), 'sam2.alphaThresholdCoverage', AVG_FOREGROUND_SAM2_MIN_COVERAGE_V5, AVG_FOREGROUND_SAM2_MAX_COVERAGE_V5),
    mattingMethod: policy.mattingMethod, device: avgEnum(headers.get('X-SF-Device'), ['cpu', 'mps', 'mps+cpu-fallback'] as const, 'sam2.device'),
    width: input.width, height: input.height, policyHash: '', promptSha256: avgHash(headers.get('X-SF-Prompt-SHA256'), 'sam2.promptSha256'),
    sourcePixelHash: avgHash(headers.get('X-SF-Source-Pixel-SHA256'), 'sam2.sourcePixelHash'),
    alphaPlaneHash: avgHash(headers.get('X-SF-Alpha-SHA256'), 'sam2.alphaPlaneHash'),
    serviceCutoutPixelHash: avgHash(headers.get('X-SF-Cutout-Pixel-SHA256'), 'sam2.serviceCutoutPixelHash'),
    resultPngSha256: avgHash(headers.get('X-SF-Result-PNG-SHA256'), 'sam2.resultPngSha256') }
}
export async function runAvgForegroundSam2V5(input: AvgSam2TransportInput & { policy: AvgForegroundPolicyV5 }):
Promise<{ rgba: Uint8ClampedArray; observation: AvgForegroundSam2ProcessingObservationV5 }> {
  const policy = parseAvgForegroundPolicyV5(input.policy)
  const source = { ...input.source }
  const result = await runAvgSam2Transport({ ...input, source, policy }, { api: 'v2', prompts: buildAvgSam2PromptManifestV5(),
    parseClaims: headers => parseAvgSam2ForegroundHeadersV5(headers, { ...source, sourceHash: source.contentHash, policy }) })
  if (result.thresholdCoverage < AVG_FOREGROUND_SAM2_MIN_COVERAGE_V5 || result.thresholdCoverage > AVG_FOREGROUND_SAM2_MAX_COVERAGE_V5
    || Math.abs(result.thresholdCoverage - result.observation.alphaThresholdCoverage) > 0.0000000051) {
    throw new Error('[avg-foreground-sam2] 浏览器解码的前景覆盖率与 V5 挡板或服务观察不符')
  }
  return { rgba: result.rgba, observation: parseAvgForegroundSam2ObservationV5({ ...result.observation, alphaThresholdCoverage: result.thresholdCoverage }) }
}
export function parseAvgSam2AlphaCountsV1(r: Record<string, unknown>, label = 'V5') {
  const width = avgNumber(r.width, 'sam2.width', 2, 10000), height = avgNumber(r.height, 'sam2.height', 2, 10000), pixels = width * height
  const clearedPixelCount = avgNumber(r.clearedPixelCount, 'sam2.clearedPixelCount', 1, pixels)
  const translucentPixelCount = avgNumber(r.translucentPixelCount, 'sam2.translucentPixelCount', 0, pixels)
  const opaquePixelCount = avgNumber(r.opaquePixelCount, 'sam2.opaquePixelCount', 1, pixels)
  const alphaCoverage = avgNumber(r.alphaCoverage, 'sam2.alphaCoverage', 0, 1, false)
  const alphaThresholdCoverage = avgNumber(r.alphaThresholdCoverage, 'sam2.alphaThresholdCoverage', AVG_FOREGROUND_SAM2_MIN_COVERAGE_V5, AVG_FOREGROUND_SAM2_MAX_COVERAGE_V5, false)
  if (clearedPixelCount + translucentPixelCount + opaquePixelCount !== pixels
    || alphaCoverage + 1e-12 < opaquePixelCount / pixels || alphaCoverage - 1e-12 > (opaquePixelCount + translucentPixelCount) / pixels
    || alphaThresholdCoverage + 1e-12 < opaquePixelCount / pixels || alphaThresholdCoverage - 1e-12 > (opaquePixelCount + translucentPixelCount) / pixels
    || Math.abs(alphaThresholdCoverage * pixels - Math.round(alphaThresholdCoverage * pixels)) > 0.000001) {
    throw new Error(`[avg-foreground-sam2] ${label} alpha 像素计数或覆盖率不符`)
  }
  return { width, height, clearedPixelCount, translucentPixelCount, opaquePixelCount, alphaCoverage, alphaThresholdCoverage }
}
export function parseAvgForegroundSam2ObservationV5(value: unknown): AvgForegroundSam2ProcessingObservationV5 {
  const r = avgRecord(value, ['version', 'algorithm', 'modelId', 'modelRevision', 'checkpointSha256', 'codeRevision', 'promptStrategy',
    'promptSha256', 'modelScore', 'maskCoverage', 'alphaCoverage', 'mattingMethod', 'device', 'clearedPixelCount', 'translucentPixelCount',
    'opaquePixelCount', 'width', 'height', 'policyHash', 'sourcePixelHash', 'alphaPlaneHash', 'cutoutPixelHash', 'serviceCutoutPixelHash',
    'resultPngSha256', 'qualityGate', 'selectedCandidateIndex', 'candidates', 'alphaThresholdCoverage'], 'SAM 2 V5 foreground observation')
  if (r.version !== 5 || r.algorithm !== AVG_FOREGROUND_SAM2_MATTING_ID_V5 || r.modelId !== 'sam2.1-hiera-tiny'
    || r.modelRevision !== AVG_FOREGROUND_SAM2_MODEL_REVISION_V4 || r.codeRevision !== AVG_FOREGROUND_SAM2_MODEL_REVISION_V4
    || r.checkpointSha256 !== AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4 || r.promptStrategy !== AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5
    || r.mattingMethod !== AVG_FOREGROUND_SAM2_MATTING_METHOD_V4 || r.qualityGate !== AVG_FOREGROUND_SAM2_QUALITY_GATE_V5) {
    throw new Error('[avg-foreground-sam2] V5 观察未使用登记的模型、提示与挡板')
  }
  const selection = selectAvgSam2CandidateV5(r.candidates), selected = selection.candidates[selection.selectedCandidateIndex]!
  if (r.selectedCandidateIndex !== selection.selectedCandidateIndex || r.modelScore !== selected.score || r.maskCoverage !== selected.maskCoverage) {
    throw new Error('[avg-foreground-sam2] V5 观察中的掩模选择不一致')
  }
  const { width, height, clearedPixelCount, translucentPixelCount, opaquePixelCount, alphaCoverage, alphaThresholdCoverage } = parseAvgSam2AlphaCountsV1(r)
  return { version: 5, algorithm: AVG_FOREGROUND_SAM2_MATTING_ID_V5, modelId: 'sam2.1-hiera-tiny',
    modelRevision: AVG_FOREGROUND_SAM2_MODEL_REVISION_V4, checkpointSha256: AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4,
    codeRevision: AVG_FOREGROUND_SAM2_MODEL_REVISION_V4, promptStrategy: AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5,
    qualityGate: AVG_FOREGROUND_SAM2_QUALITY_GATE_V5, ...selection, modelScore: selected.score, maskCoverage: selected.maskCoverage,
    alphaCoverage, alphaThresholdCoverage, mattingMethod: AVG_FOREGROUND_SAM2_MATTING_METHOD_V4,
    device: avgEnum(r.device, ['cpu', 'mps', 'mps+cpu-fallback'] as const, 'sam2.device'), width, height,
    clearedPixelCount, translucentPixelCount, opaquePixelCount, policyHash: avgHash(r.policyHash, 'sam2.policyHash'),
    promptSha256: avgHash(r.promptSha256, 'sam2.promptSha256'), sourcePixelHash: avgHash(r.sourcePixelHash, 'sam2.sourcePixelHash'),
    alphaPlaneHash: avgHash(r.alphaPlaneHash, 'sam2.alphaPlaneHash'), cutoutPixelHash: avgHash(r.cutoutPixelHash, 'sam2.cutoutPixelHash'),
    serviceCutoutPixelHash: avgHash(r.serviceCutoutPixelHash, 'sam2.serviceCutoutPixelHash'), resultPngSha256: avgHash(r.resultPngSha256, 'sam2.resultPngSha256') }
}
