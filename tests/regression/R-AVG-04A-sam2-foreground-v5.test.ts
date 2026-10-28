import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4, AVG_FOREGROUND_SAM2_MATTING_METHOD_V4, AVG_FOREGROUND_SAM2_MODEL_REVISION_V4,
  AVG_FOREGROUND_SAM2_MATTING_ID_V5, AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5, AVG_FOREGROUND_SAM2_QUALITY_GATE_V5,
  assertAvgForegroundRequirementBinding, compileAvgForegroundRequirement, parseAvgForegroundPolicy, parseAvgForegroundPolicyV5 } from '../../src/lib/avg/image-foreground-contract'
import { assertAvgSam2ForegroundCapabilityV5, assertAvgSam2ForegroundServiceReadyV5, hashAvgSam2PromptManifestV5,
  parseAvgForegroundSam2ObservationV5, parseAvgSam2ForegroundHeadersV5, runAvgForegroundSam2V5,
  selectAvgSam2CandidateV5, type AvgSam2MaskCandidateV5 } from '../../src/lib/avg/image-foreground-sam2-v5'
import { AVG_IMAGE_PROCESSOR_V2, assertAvgImageProcessingReceiptV2, parseAvgForegroundProcessingObservation } from '../../src/lib/avg/image-processing-contract-v2'
import { processAvgImageBytesV2 } from '../../src/lib/avg/image-processing'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import { avgImageProcessingRecipeFixture, avgImageProcessingReceiptFixture } from '../helpers/avg-image-processing-fixture'

const policy = parseAvgForegroundPolicyV5({ schema: 'storyforge.avg.foreground-policy', version: 5,
  method: 'local-sam2-box-anchor-matting', algorithm: AVG_FOREGROUND_SAM2_MATTING_ID_V5, model: 'sam2.1-hiera-tiny',
  modelRevision: AVG_FOREGROUND_SAM2_MODEL_REVISION_V4, checkpointSha256: AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4,
  mattingMethod: AVG_FOREGROUND_SAM2_MATTING_METHOD_V4, promptStrategy: AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5,
  qualityGate: AVG_FOREGROUND_SAM2_QUALITY_GATE_V5, declaration: '本机独立分割候选，作者仍须核对人物完整性与边缘。' })
const hash = 'a'.repeat(64)
const candidates = (): AvgSam2MaskCandidateV5[] => [0.65, 0.99, 0.98, 0.92, 0.80, 0.86].map((score, index) => ({
  promptIndex: Math.floor(index / 3), maskIndex: index % 3, score, maskCoverage: index === 1 || index === 2 ? 0.02 : 0.4,
}))
function capability() {
  return { schema: 'storyforge.avg.local-foreground-capability', version: 2, ready: true, algorithm: policy.algorithm,
    model: policy.model, modelRevision: policy.modelRevision, checkpointSha256: policy.checkpointSha256,
    codeRevision: policy.modelRevision, device: 'cpu', storage: 'none', networkInference: false,
    mattingMethod: policy.mattingMethod, promptStrategy: policy.promptStrategy, qualityGate: policy.qualityGate }
}
function headers(width = 80, height = 120) {
  return new Headers({ 'content-type': 'image/png', 'X-SF-Algorithm': policy.algorithm, 'X-SF-Source-SHA256': hash,
    'X-SF-Source-Pixel-SHA256': 'b'.repeat(64), 'X-SF-Alpha-SHA256': 'c'.repeat(64), 'X-SF-Cutout-Pixel-SHA256': 'd'.repeat(64),
    'X-SF-Result-PNG-SHA256': 'e'.repeat(64), 'X-SF-Model-ID': policy.model, 'X-SF-Model-Revision': policy.modelRevision,
    'X-SF-Checkpoint-SHA256': policy.checkpointSha256, 'X-SF-Code-Revision': policy.modelRevision,
    'X-SF-Prompt-SHA256': 'f'.repeat(64), 'X-SF-Prompt-Strategy': policy.promptStrategy, 'X-SF-Quality-Gate': policy.qualityGate,
    'X-SF-Model-Score': '0.920000', 'X-SF-Mask-Ratio': '0.40000000', 'X-SF-Alpha-Ratio': '0.50000000',
    'X-SF-Candidates': JSON.stringify(candidates()), 'X-SF-Selected-Candidate': '3', 'X-SF-Matting-Method': policy.mattingMethod,
    'X-SF-Device': 'cpu', 'X-SF-Width': String(width), 'X-SF-Height': String(height) })
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function browserTransportFixture(alphaClaim = '0.50000000') {
  const width = 32, height = 40, data = new Uint8Array([1, 2, 3]).buffer, encoded = new Uint8Array([4, 5, 6]).buffer
  const source = { contentHash: await sha256MediaData(data), mimeType: 'image/png', width, height }
  const rgba = new Uint8ClampedArray(width * height * 4), alpha = new Uint8Array(width * height)
  for (let pixel = 0; pixel < alpha.length / 2; pixel += 1) { alpha[pixel] = 255; rgba[pixel * 4] = 180; rgba[pixel * 4 + 3] = 255 }
  const responseHeaders = headers(width, height)
  responseHeaders.set('X-SF-Source-SHA256', source.contentHash)
  responseHeaders.set('X-SF-Result-PNG-SHA256', await sha256MediaData(encoded))
  responseHeaders.set('X-SF-Alpha-SHA256', await sha256MediaData(alpha.buffer))
  responseHeaders.set('X-SF-Prompt-SHA256', await hashAvgSam2PromptManifestV5())
  responseHeaders.set('X-SF-Alpha-Ratio', alphaClaim)
  const fetcher = vi.fn(async () => new Response(encoded, { status: 200, headers: responseHeaders }))
  const close = vi.fn(), decoding = vi.fn(async () => ({ width, height, close }))
  vi.stubGlobal('fetch', fetcher); vi.stubGlobal('createImageBitmap', decoding)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: rgba }) } as unknown as CanvasRenderingContext2D)
  return { data, source, fetcher, decoding, close }
}

describe('AVG SAM 2 box and body-anchor policy V5', () => {
  it('freezes a distinct policy and does not add a magenta declaration to an existing character request', () => {
    expect(parseAvgForegroundPolicy(policy)).toEqual(policy)
    expect(() => parseAvgForegroundPolicyV5({ ...policy, qualityGate: 'relaxed' })).toThrow()
    expect(() => parseAvgForegroundPolicyV5({ ...policy, extra: true })).toThrow()
    const requirement = { mediaKind: 'character-pose' as const, consumer: { domain: 'stage' as const, slot: 'actor' as const },
      alpha: 'required' as const, invariants: ['人物身份保留'], forbiddenDepictions: ['文字'] }
    expect(compileAvgForegroundRequirement(policy, requirement)).toEqual(requirement)
    expect(() => assertAvgForegroundRequirementBinding(policy, { ...requirement, mediaKind: 'ui', consumer: { domain: 'inventory', slot: 'icon' } }))
      .toThrow(/人物框策略/)
  })

  it('filters high-scored fragments, rejects an empty eligible set and keeps the first eligible tie', () => {
    expect(selectAvgSam2CandidateV5(candidates()).selectedCandidateIndex).toBe(3)
    expect(() => selectAvgSam2CandidateV5(candidates().map(c => ({ ...c, score: 0.74 })))).toThrow(/挡板/)
    expect(selectAvgSam2CandidateV5(candidates().map(c => ({ ...c, score: 0.9, maskCoverage: 0.3 }))).selectedCandidateIndex).toBe(0)
    expect(() => selectAvgSam2CandidateV5(candidates().slice(0, 5))).toThrow(/六个/)
    const whole = candidates(); whole[0] = { ...whole[0]!, score: 0.81, maskCoverage: 0.6 }
    expect(selectAvgSam2CandidateV5(whole).selectedCandidateIndex).toBe(0)
  })

  it('requires V5 capability and probes its separate read-only endpoint once', async () => {
    expect(assertAvgSam2ForegroundCapabilityV5(capability())).toEqual({ device: 'cpu' })
    expect(() => assertAvgSam2ForegroundCapabilityV5({ ...capability(), version: 1 })).toThrow(/不一致/)
    expect(() => assertAvgSam2ForegroundCapabilityV5({ ...capability(), qualityGate: 'other' })).toThrow(/不一致/)
    const fetcher = vi.fn(async () => new Response(JSON.stringify(capability()), { headers: { 'content-type': 'application/json' } }))
    await assertAvgSam2ForegroundServiceReadyV5(fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]![0]).toBe('http://127.0.0.1:5278/v2/capabilities')
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error' })
  })

  it('binds header selection to all observations and rejects a substituted result or gate', () => {
    const values = headers(), input = { sourceHash: hash, width: 80, height: 120, policy }
    expect(parseAvgSam2ForegroundHeadersV5(values, input)).toMatchObject({ version: 5, selectedCandidateIndex: 3, modelScore: 0.92, maskCoverage: 0.4 })
    values.set('X-SF-Selected-Candidate', '1')
    expect(() => parseAvgSam2ForegroundHeadersV5(values, input)).toThrow(/选择/)
    values.set('X-SF-Selected-Candidate', '3'); values.set('X-SF-Quality-Gate', 'other')
    expect(() => parseAvgSam2ForegroundHeadersV5(values, input)).toThrow(/不一致/)
  })

  it('preserves the versioned observation through the processing codec and rejects inconsistent alpha statistics', async () => {
    const observation = parseAvgForegroundSam2ObservationV5({ ...parseAvgSam2ForegroundHeadersV5(headers(4, 5), { sourceHash: hash, width: 4, height: 5, policy }),
      alphaCoverage: 0.5, alphaThresholdCoverage: 0.5, clearedPixelCount: 10, translucentPixelCount: 0, opaquePixelCount: 10,
      cutoutPixelHash: 'd'.repeat(64), policyHash: await hashProductProductionValueV2(policy) })
    expect(parseAvgForegroundProcessingObservation(observation)).toEqual(observation)
    expect(() => parseAvgForegroundSam2ObservationV5({ ...observation, alphaThresholdCoverage: 0.4 })).toThrow(/alpha 像素/)
    expect(() => parseAvgForegroundSam2ObservationV5({ ...observation, modelScore: 0.95 })).toThrow(/选择不一致/)
  })

  it('checks the decoded alpha against the service claim and retains the exact V5 evidence without retries', async () => {
    const f = await browserTransportFixture()
    const sourceHash = f.source.contentHash, pending = runAvgForegroundSam2V5({ data: f.data, source: f.source, policy })
    f.source.contentHash = '0'.repeat(64)
    const result = await pending
    expect(result.observation).toMatchObject({ version: 5, selectedCandidateIndex: 3, alphaThresholdCoverage: 0.5,
      opaquePixelCount: 640, clearedPixelCount: 640, policyHash: await hashProductProductionValueV2(policy) })
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.close).toHaveBeenCalledTimes(1)
    expect(f.fetcher.mock.calls[0]![0]).toBe('http://127.0.0.1:5278/v2/segment')
    expect(f.fetcher.mock.calls[0]![1]).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' })
    expect(new Headers(f.fetcher.mock.calls[0]![1]!.headers).get('X-SF-Source-SHA256')).toBe(sourceHash)
  })

  it('rejects existing source transparency in the formal pixel dispatcher before making a local request', async () => {
    const width = 96, height = 128, data = await deterministicRegionMapPngV1({ width, height, palette: ['#172534', '#baab89', '#ece1c0'] })
    const source = { contentHash: await sha256MediaData(data), mimeType: 'image/png', width, height }
    const rgba = new Uint8ClampedArray(width * height * 4).fill(255); rgba[3] = 254
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close: vi.fn() })))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: rgba }) } as unknown as CanvasRenderingContext2D)
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(processAvgImageBytesV2({ data, source, recipe: { ...avgImageProcessingRecipeFixture(), width, height, version: 2, foreground: policy },
      frozenRequirement: { mediaKind: 'character-pose', consumer: { domain: 'stage', slot: 'actor' }, alpha: 'required', invariants: [], forbiddenDepictions: [] } }))
      .rejects.toThrow(/原图已有透明像素/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a self-consistently rehashed receipt that substitutes the frozen prompt manifest', async () => {
    const width = 32, height = 40, canvasRecipe = { ...avgImageProcessingRecipeFixture(), width, height }
    const recipe = { ...canvasRecipe, version: 2 as const, foreground: policy }
    const base = await avgImageProcessingReceiptFixture({ recipe: canvasRecipe, source: { contentHash: hash, mimeType: 'image/png', byteSize: 3, width, height },
      data: new Uint8Array([4, 5, 6]).buffer, hasAlpha: true })
    const { receiptHash: _old, ...fields } = base; void _old
    const foreground = parseAvgForegroundSam2ObservationV5({ ...parseAvgSam2ForegroundHeadersV5(headers(width, height), { sourceHash: hash, width, height, policy }),
      alphaCoverage: 0.5, clearedPixelCount: 640, translucentPixelCount: 0, opaquePixelCount: 640, cutoutPixelHash: 'd'.repeat(64),
      policyHash: await hashProductProductionValueV2(policy), promptSha256: await hashAvgSam2PromptManifestV5() })
    const body = { ...fields, version: 2 as const, processor: AVG_IMAGE_PROCESSOR_V2, recipeHash: await hashProductProductionValueV2(recipe), foreground }
    await expect(assertAvgImageProcessingReceiptV2(recipe, { ...body, receiptHash: await hashProductProductionValueV2(body) })).resolves.toMatchObject({ foreground })
    const changed = { ...body, foreground: { ...foreground, promptSha256: '9'.repeat(64) } }
    await expect(assertAvgImageProcessingReceiptV2(recipe, { ...changed, receiptHash: await hashProductProductionValueV2(changed) })).rejects.toThrow(/冻结的提示集合/)
  })

  it('rejects mismatched actual alpha coverage after decoding and never resends the source', async () => {
    const f = await browserTransportFixture('0.25000000')
    await expect(runAvgForegroundSam2V5({ data: f.data, source: f.source, policy })).rejects.toThrow(/浏览器解码的前景覆盖率/)
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.close).toHaveBeenCalledTimes(1)
  })

  it('bounds a stalled V5 capability fetch without creating a processing request', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(() => new Promise<Response>(() => {}))
    const pending = assertAvgSam2ForegroundServiceReadyV5(fetcher), rejected = expect(pending).rejects.toThrow(/SAM 2 服务未就绪/)
    await vi.advanceTimersByTimeAsync(5_000); await rejected
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
