import {
  AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4, AVG_FOREGROUND_SAM2_MATTING_ID_V4,
  AVG_FOREGROUND_SAM2_MATTING_METHOD_V4, AVG_FOREGROUND_SAM2_MODEL_REVISION_V4,
  AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4, parseAvgForegroundPolicyV4, type AvgForegroundPolicyV4,
} from './image-foreground-contract'
import { avgEnum, avgHash, avgNumber, avgRecord } from './protocol-validation'
import { AVG_SAM2_LOCAL_ENDPOINT, AVG_SAM2_TIMEOUT_MS, AVG_SAM2_PREFLIGHT_TIMEOUT_MS,
  assertAvgSam2ServiceReady, readAvgSam2RatioHeader, runAvgSam2Transport,
  type AvgSam2Fetcher, type AvgSam2TransportInput } from './image-foreground-sam2-transport'

export const AVG_FOREGROUND_SAM2_LOCAL_ENDPOINT_V4 = AVG_SAM2_LOCAL_ENDPOINT
export const AVG_FOREGROUND_SAM2_TIMEOUT_MS_V4 = AVG_SAM2_TIMEOUT_MS
export const AVG_FOREGROUND_SAM2_PREFLIGHT_TIMEOUT_MS_V4 = AVG_SAM2_PREFLIGHT_TIMEOUT_MS

export function assertAvgSam2ForegroundCapabilityV4(value: unknown) {
  const r = avgRecord(value, ['schema', 'version', 'ready', 'algorithm', 'model', 'modelRevision', 'checkpointSha256',
    'codeRevision', 'device', 'storage', 'networkInference', 'mattingMethod'], 'SAM 2 local capability')
  if (r.schema !== 'storyforge.avg.local-foreground-capability' || r.version !== 1 || r.ready !== true
    || r.algorithm !== AVG_FOREGROUND_SAM2_MATTING_ID_V4 || r.model !== 'sam2.1-hiera-tiny'
    || r.modelRevision !== AVG_FOREGROUND_SAM2_MODEL_REVISION_V4 || r.checkpointSha256 !== AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4
    || r.codeRevision !== AVG_FOREGROUND_SAM2_MODEL_REVISION_V4 || r.storage !== 'none' || r.networkInference !== false
    || r.mattingMethod !== AVG_FOREGROUND_SAM2_MATTING_METHOD_V4) {
    throw new Error('[avg-foreground-sam2] 本机服务能力与冻结模型配方不一致')
  }
  return { device: avgEnum(r.device, ['cpu', 'mps', 'mps+cpu-fallback'] as const, 'sam2.device') }
}


/** Frozen V4 readiness still uses the original capability protocol. */
export async function assertAvgSam2ForegroundServiceReadyV4(fetcher: AvgSam2Fetcher = globalThis.fetch): Promise<void> {
  await assertAvgSam2ServiceReady({ api: 'v1', assertCapability: assertAvgSam2ForegroundCapabilityV4, fetcher })
}

export interface AvgForegroundSam2ProcessingObservationV4 {
  version: 4
  algorithm: typeof AVG_FOREGROUND_SAM2_MATTING_ID_V4
  modelId: 'sam2.1-hiera-tiny'
  modelRevision: typeof AVG_FOREGROUND_SAM2_MODEL_REVISION_V4
  checkpointSha256: typeof AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4
  codeRevision: typeof AVG_FOREGROUND_SAM2_MODEL_REVISION_V4
  promptStrategy: typeof AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4
  promptSha256: string
  modelScore: number
  maskCoverage: number
  alphaCoverage: number
  mattingMethod: typeof AVG_FOREGROUND_SAM2_MATTING_METHOD_V4
  device: 'cpu' | 'mps' | 'mps+cpu-fallback'
  clearedPixelCount: number
  translucentPixelCount: number
  opaquePixelCount: number
  width: number
  height: number
  policyHash: string
  sourcePixelHash: string
  alphaPlaneHash: string
  cutoutPixelHash: string
  serviceCutoutPixelHash: string
  resultPngSha256: string
}


/** Parse and bind every service claim before decoding its candidate bytes. */
export function parseAvgSam2ForegroundHeadersV4(headers: Headers, input: {
  sourceHash: string; width: number; height: number; policy: AvgForegroundPolicyV4
}): Omit<AvgForegroundSam2ProcessingObservationV4, 'alphaCoverage' | 'clearedPixelCount' | 'translucentPixelCount' | 'opaquePixelCount' | 'cutoutPixelHash'> {
  const policy = parseAvgForegroundPolicyV4(input.policy)
  const values = {
    algorithm: headers.get('X-SF-Algorithm'), sourceHash: headers.get('X-SF-Source-SHA256'),
    sourcePixelHash: headers.get('X-SF-Source-Pixel-SHA256'), alphaPlaneHash: headers.get('X-SF-Alpha-SHA256'),
    cutoutPixelHash: headers.get('X-SF-Cutout-Pixel-SHA256'), resultPngSha256: headers.get('X-SF-Result-PNG-SHA256'), modelId: headers.get('X-SF-Model-ID'),
    modelRevision: headers.get('X-SF-Model-Revision'), checkpointSha256: headers.get('X-SF-Checkpoint-SHA256'),
    codeRevision: headers.get('X-SF-Code-Revision'), promptSha256: headers.get('X-SF-Prompt-SHA256'),
    promptStrategy: headers.get('X-SF-Prompt-Strategy'), modelScore: headers.get('X-SF-Model-Score'),
    maskCoverage: headers.get('X-SF-Alpha-Ratio'), mattingMethod: headers.get('X-SF-Matting-Method'),
    device: headers.get('X-SF-Device'), width: headers.get('X-SF-Width'), height: headers.get('X-SF-Height'),
  }
  if (values.algorithm !== policy.algorithm || values.sourceHash !== input.sourceHash
    || values.modelId !== policy.model || values.modelRevision !== policy.modelRevision
    || values.checkpointSha256 !== policy.checkpointSha256 || values.codeRevision !== policy.modelRevision
    || values.promptStrategy !== policy.promptStrategy || values.mattingMethod !== policy.mattingMethod
    || values.width !== String(input.width) || values.height !== String(input.height)
    || values.device !== 'cpu' && values.device !== 'mps' && values.device !== 'mps+cpu-fallback') {
    throw new Error('[avg-foreground-sam2] 本地服务返回的来源、模型、策略或尺寸与冻结配方不一致')
  }
  const modelScore = readAvgSam2RatioHeader(values.modelScore, 'sam2.modelScore', 0, 1)
  const maskCoverage = readAvgSam2RatioHeader(values.maskCoverage, 'sam2.maskCoverage', 0.001, 0.999)
  return {
    version: 4, algorithm: policy.algorithm, modelId: policy.model, modelRevision: policy.modelRevision,
    checkpointSha256: policy.checkpointSha256, codeRevision: policy.modelRevision,
    promptStrategy: policy.promptStrategy, promptSha256: avgHash(values.promptSha256, 'sam2.promptSha256'),
    modelScore, maskCoverage, mattingMethod: policy.mattingMethod, device: values.device,
    width: input.width, height: input.height, policyHash: '',
    sourcePixelHash: avgHash(values.sourcePixelHash, 'sam2.sourcePixelHash'),
    alphaPlaneHash: avgHash(values.alphaPlaneHash, 'sam2.alphaPlaneHash'),
    resultPngSha256: avgHash(values.resultPngSha256, 'sam2.resultPngSha256'),
    serviceCutoutPixelHash: avgHash(values.cutoutPixelHash, 'sam2.serviceCutoutPixelHash'),
  }
}


export async function runAvgForegroundSam2V4(input: AvgSam2TransportInput & { policy: AvgForegroundPolicyV4 }):
Promise<{ rgba: Uint8ClampedArray; observation: AvgForegroundSam2ProcessingObservationV4 }> {
  const policy = parseAvgForegroundPolicyV4(input.policy)
  const source = { ...input.source }
  const result = await runAvgSam2Transport({ ...input, source, policy }, { api: 'v1',
    prompts: [{ box: { x1: 1250, x2: 8750, y1: 100, y2: 9900 } }],
    parseClaims: headers => parseAvgSam2ForegroundHeadersV4(headers, { ...source, sourceHash: source.contentHash, policy }),
  })
  return { rgba: result.rgba, observation: result.observation }
}

export function parseAvgForegroundSam2ObservationV4(value: unknown): AvgForegroundSam2ProcessingObservationV4 {
  const keys = ['version', 'algorithm', 'modelId', 'modelRevision', 'checkpointSha256', 'codeRevision', 'promptStrategy',
    'promptSha256', 'modelScore', 'maskCoverage', 'alphaCoverage', 'mattingMethod', 'device', 'clearedPixelCount',
    'translucentPixelCount', 'opaquePixelCount', 'width', 'height', 'policyHash', 'sourcePixelHash', 'alphaPlaneHash', 'cutoutPixelHash',
    'serviceCutoutPixelHash', 'resultPngSha256']
  const r = avgRecord(value, keys, 'SAM 2 foreground processing observation')
  if (r.version !== 4 || r.algorithm !== AVG_FOREGROUND_SAM2_MATTING_ID_V4 || r.modelId !== 'sam2.1-hiera-tiny'
    || r.modelRevision !== AVG_FOREGROUND_SAM2_MODEL_REVISION_V4 || r.codeRevision !== AVG_FOREGROUND_SAM2_MODEL_REVISION_V4
    || r.checkpointSha256 !== AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4
    || r.promptStrategy !== AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4 || r.mattingMethod !== AVG_FOREGROUND_SAM2_MATTING_METHOD_V4) {
    throw new Error('[avg-foreground-sam2] 前景观察未使用登记的模型、代码与 alpha 策略')
  }
  const width = avgNumber(r.width, 'sam2.width', 2, 10000), height = avgNumber(r.height, 'sam2.height', 2, 10000)
  const pixels = width * height
  const clearedPixelCount = avgNumber(r.clearedPixelCount, 'sam2.clearedPixelCount', 1, pixels)
  const translucentPixelCount = avgNumber(r.translucentPixelCount, 'sam2.translucentPixelCount', 0, pixels)
  const opaquePixelCount = avgNumber(r.opaquePixelCount, 'sam2.opaquePixelCount', 1, pixels)
  if (clearedPixelCount + translucentPixelCount + opaquePixelCount !== pixels) throw new Error('[avg-foreground-sam2] alpha 像素计数未覆盖原图')
  return { version: 4, algorithm: AVG_FOREGROUND_SAM2_MATTING_ID_V4, modelId: 'sam2.1-hiera-tiny',
    modelRevision: AVG_FOREGROUND_SAM2_MODEL_REVISION_V4, checkpointSha256: AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4,
    codeRevision: AVG_FOREGROUND_SAM2_MODEL_REVISION_V4, promptStrategy: AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4,
    promptSha256: avgHash(r.promptSha256, 'sam2.promptSha256'), modelScore: avgNumber(r.modelScore, 'sam2.modelScore', 0, 1, false),
    maskCoverage: avgNumber(r.maskCoverage, 'sam2.maskCoverage', 0.001, 0.999, false), alphaCoverage: avgNumber(r.alphaCoverage, 'sam2.alphaCoverage', 0, 1, false),
    mattingMethod: AVG_FOREGROUND_SAM2_MATTING_METHOD_V4,
    device: r.device === 'cpu' ? 'cpu' : r.device === 'mps' ? 'mps' : r.device === 'mps+cpu-fallback' ? 'mps+cpu-fallback' : (() => { throw new Error('[avg-foreground-sam2] 推理设备无效') })(),
    clearedPixelCount, translucentPixelCount, opaquePixelCount, width, height, policyHash: avgHash(r.policyHash, 'sam2.policyHash'),
    sourcePixelHash: avgHash(r.sourcePixelHash, 'sam2.sourcePixelHash'), alphaPlaneHash: avgHash(r.alphaPlaneHash, 'sam2.alphaPlaneHash'),
    cutoutPixelHash: avgHash(r.cutoutPixelHash, 'sam2.cutoutPixelHash'), serviceCutoutPixelHash: avgHash(r.serviceCutoutPixelHash, 'sam2.serviceCutoutPixelHash'),
    resultPngSha256: avgHash(r.resultPngSha256, 'sam2.resultPngSha256') }
}
