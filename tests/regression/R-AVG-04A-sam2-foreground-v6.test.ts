import { afterEach, describe, expect, it, vi } from 'vitest'
import sourceFixture from '../helpers/avg-neutral-background.json'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4, AVG_FOREGROUND_SAM2_MODEL_REVISION_V4,
  AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5, AVG_FOREGROUND_SAM2_MATTING_ID_V6,
  AVG_FOREGROUND_SAM2_MATTING_METHOD_V6, AVG_FOREGROUND_SAM2_QUALITY_GATE_V6, AVG_FOREGROUND_SAM2_NEUTRAL_RULE_V6,
  compileAvgForegroundRequirement, parseAvgForegroundPolicy, parseAvgForegroundPolicyV6 } from '../../src/lib/avg/image-foreground-contract'
import { deriveAvgNeutralBackgroundV1, parseAvgNeutralBackgroundObservationV1 } from '../../src/lib/avg/image-foreground-neutral-background'
import { assertAvgSam2ForegroundCapabilityV6, assertAvgSam2ForegroundServiceReadyV6,
  parseAvgSam2ForegroundHeadersV6, parseAvgForegroundSam2ObservationV6, runAvgForegroundSam2V6 } from '../../src/lib/avg/image-foreground-sam2-v6'
import { hashAvgSam2PromptManifestV5 } from '../../src/lib/avg/image-foreground-sam2-v5'
import { parseAvgForegroundProcessingObservation } from '../../src/lib/avg/image-processing-contract-v2'

const policy = parseAvgForegroundPolicyV6({ schema: 'storyforge.avg.foreground-policy', version: 6,
  method: 'local-sam2-neutral-background-matting', algorithm: AVG_FOREGROUND_SAM2_MATTING_ID_V6, model: 'sam2.1-hiera-tiny',
  modelRevision: AVG_FOREGROUND_SAM2_MODEL_REVISION_V4, checkpointSha256: AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4,
  mattingMethod: AVG_FOREGROUND_SAM2_MATTING_METHOD_V6, promptStrategy: AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5,
  qualityGate: AVG_FOREGROUND_SAM2_QUALITY_GATE_V6, backgroundRule: AVG_FOREGROUND_SAM2_NEUTRAL_RULE_V6,
  declaration: '均匀亮灰底单人立绘；独立本地加工，结果仍须对照原件评审。' })
function fixture() {
  const width = sourceFixture.rows[0].length, height = sourceFixture.rows.length
  const symbols = sourceFixture.rows.join(''), rgb = new Uint8Array(width * height * 3), rgba = new Uint8ClampedArray(width * height * 4)
  const flood = new Uint8Array(width * height)
  for (let i = 0; i < symbols.length; i++) {
    const color = sourceFixture.colors[symbols[i] as keyof typeof sourceFixture.colors]
    rgb.set(color, i * 3); rgba.set([...color, 255], i * 4)
    // The fixture marks open background as '.' and an enclosed, identical
    // colour shirt as 'w': this oracle does not implement a flood algorithm.
    flood[i] = symbols[i] === '.' ? 1 : 0
  }
  return { width, height, rgb, rgba, flood }
}
async function background() {
  const f = fixture()
  return { rule: policy.backgroundRule, median: [229, 228, 229], borderP99Deviation: 0, radius: 8,
    borderCoverage: 1, floodPixelCount: sourceFixture.floodPixelCount,
    floodMaskSha256: await sha256MediaData(f.flood.buffer), removedMaskPixelCount: 18 }
}
function capability() {
  return { schema: 'storyforge.avg.local-foreground-capability', version: 3, ready: true, algorithm: policy.algorithm,
    model: policy.model, modelRevision: policy.modelRevision, checkpointSha256: policy.checkpointSha256,
    codeRevision: policy.modelRevision, device: 'cpu', storage: 'none', networkInference: false,
    mattingMethod: policy.mattingMethod, promptStrategy: policy.promptStrategy, qualityGate: policy.qualityGate, backgroundRule: policy.backgroundRule }
}
async function transportFixture(ghostBackground = false) {
  const f = fixture(), data = new Uint8Array([1, 2, 3]).buffer, encoded = new Uint8Array([4, 5, 6]).buffer
  const source = { contentHash: await sha256MediaData(data), mimeType: 'image/png', width: f.width, height: f.height }
  const rgba = f.rgba.slice(), alpha = new Uint8Array(f.flood.length)
  for (let i = 0; i < f.flood.length; i++) {
    if (f.flood[i]) rgba.fill(0, i * 4, i * 4 + 4)
    alpha[i] = f.flood[i] ? 0 : 255
  }
  if (ghostBackground) { rgba[3] = 255; alpha[0] = 255 }
  const threshold = alpha.reduce((sum, v) => sum + (v >= 128 ? 1 : 0), 0) / alpha.length
  const candidates = [0.65, 0.99, 0.98, 0.92, 0.80, 0.86].map((score, index) => ({
    promptIndex: Math.floor(index / 3), maskIndex: index % 3, score, maskCoverage: index === 1 || index === 2 ? 0.02 : 0.4 }))
  const headers = new Headers({ 'content-type': 'image/png', 'X-SF-Algorithm': policy.algorithm,
    'X-SF-Source-SHA256': source.contentHash, 'X-SF-Source-Pixel-SHA256': await sha256MediaData(f.rgb.buffer),
    'X-SF-Alpha-SHA256': await sha256MediaData(alpha.buffer), 'X-SF-Cutout-Pixel-SHA256': await sha256MediaData(rgba.buffer),
    'X-SF-Result-PNG-SHA256': await sha256MediaData(encoded), 'X-SF-Model-ID': policy.model,
    'X-SF-Model-Revision': policy.modelRevision, 'X-SF-Checkpoint-SHA256': policy.checkpointSha256,
    'X-SF-Code-Revision': policy.modelRevision, 'X-SF-Prompt-SHA256': await hashAvgSam2PromptManifestV5(),
    'X-SF-Prompt-Strategy': policy.promptStrategy, 'X-SF-Quality-Gate': policy.qualityGate,
    'X-SF-Matting-Method': policy.mattingMethod, 'X-SF-Device': 'cpu', 'X-SF-Width': String(f.width), 'X-SF-Height': String(f.height),
    'X-SF-Model-Score': '0.920000', 'X-SF-Mask-Ratio': '0.40000000', 'X-SF-Alpha-Ratio': threshold.toFixed(8),
    'X-SF-Candidates': JSON.stringify(candidates), 'X-SF-Selected-Candidate': '3', 'X-SF-Neutral-Background': JSON.stringify(await background()) })
  const fetcher = vi.fn(async () => new Response(encoded, { headers })), close = vi.fn()
  vi.stubGlobal('fetch', fetcher); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: f.width, height: f.height, close })))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: rgba }) } as unknown as CanvasRenderingContext2D)
  return { ...f, data, source, headers, fetcher, close }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('AVG V6 independently verified neutral background', () => {
  it('clears the open leg gap but preserves identical enclosed shirt colour and skin', async () => {
    const f = fixture(), actual = await deriveAvgNeutralBackgroundV1(f)
    expect(actual.flood).toEqual(f.flood)
    expect(actual.sourcePixelHash).toBe(await sha256MediaData(f.rgb.buffer))
    const { rule: _rule, removedMaskPixelCount: _removed, ...expected } = await background(); void _rule; void _removed
    expect(actual.observation).toEqual(expected)
  })
  it('snapshots source pixels before asynchronous hashes', async () => {
    const f = fixture(), pending = deriveAvgNeutralBackgroundV1(f)
    f.rgba.fill(0)
    expect((await pending).flood).toEqual(f.flood)
  })
  it.each(['tinted', 'unstable', 'alpha', 'empty'] as const)('rejects %s source before inference', async kind => {
    const f = fixture()
    if (kind === 'tinted') for (let i = 0; i < f.rgba.length; i += 4) f.rgba.set([255, 0, 255, 255], i)
    if (kind === 'unstable') for (let x = 0; x < f.width; x++) f.rgba.set([255, 255, 255, 255], x * 4)
    if (kind === 'alpha') f.rgba[3] = 254
    if (kind === 'empty') for (let i = 0; i < f.rgba.length; i += 4) f.rgba.set([229, 228, 229, 255], i)
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const data = new Uint8Array([1]).buffer, source = { ...f, contentHash: await sha256MediaData(data), mimeType: 'image/png' }
    await expect(runAvgForegroundSam2V6({ ...f, source, data, policy })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('checks input bounds and cancellation without allocating or calling the service', async () => {
    await expect(deriveAvgNeutralBackgroundV1({ width: 10_000, height: 10_000, rgba: new Uint8ClampedArray(4) })).rejects.toThrow()
    const controller = new AbortController(); controller.abort()
    await expect(deriveAvgNeutralBackgroundV1({ ...fixture(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('has an explicit policy, target boundary and read-only capability independent of V4/V5', async () => {
    expect(parseAvgForegroundPolicy(policy)).toEqual(policy)
    expect(() => parseAvgForegroundPolicyV6({ ...policy, backgroundRule: 'unbounded' })).toThrow()
    const r = { mediaKind: 'character-pose' as const, consumer: { domain: 'stage' as const, slot: 'actor' as const }, alpha: 'required' as const, invariants: [], forbiddenDepictions: [] }
    expect(compileAvgForegroundRequirement(policy, r)).toEqual(r)
    expect(() => compileAvgForegroundRequirement(policy, { ...r, alpha: 'forbidden' as const })).toThrow()
    expect(assertAvgSam2ForegroundCapabilityV6(capability())).toEqual({ device: 'cpu' })
    expect(() => assertAvgSam2ForegroundCapabilityV6({ ...capability(), version: 2 })).toThrow()
    expect(() => assertAvgSam2ForegroundCapabilityV6({ ...capability(), checkpointSha256: '0'.repeat(64) })).toThrow()
    const fetcher = vi.fn(async () => new Response(JSON.stringify(capability()), { headers: { 'content-type': 'application/json' } }))
    await assertAvgSam2ForegroundServiceReadyV6(fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]![0]).toBe('http://127.0.0.1:5278/v3/capabilities')
  })
  it('checks decoded alpha and independent source analysis, preserving the versioned observation', async () => {
    const f = await transportFixture(), pending = runAvgForegroundSam2V6({ ...f, policy })
    f.rgba.fill(0); f.source.contentHash = '0'.repeat(64)
    const { observation } = await pending
    expect(parseAvgForegroundProcessingObservation(observation)).toEqual(observation)
    expect(observation).toMatchObject({ version: 6, background: await background(), opaquePixelCount: 110, clearedPixelCount: 210,
      policyHash: await hashProductProductionValueV2(policy) })
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.close).toHaveBeenCalledTimes(1)
    expect(f.fetcher.mock.calls[0]![0]).toBe('http://127.0.0.1:5278/v3/segment')
    expect(() => parseAvgForegroundSam2ObservationV6({ ...observation, version: 5 })).toThrow()
  })
  it('rejects service background claims substituted independently of PNG hashes', async () => {
    const f = await transportFixture()
    f.headers.set('X-SF-Neutral-Background', JSON.stringify({ ...await background(), floodPixelCount: 200 }))
    await expect(runAvgForegroundSam2V6({ ...f, policy })).rejects.toThrow(/独立背景分析/)
    expect(f.fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects background opacity even when all service byte hashes and alpha counts agree', async () => {
    const f = await transportFixture(true)
    await expect(runAvgForegroundSam2V6({ ...f, policy })).rejects.toThrow(/连通背景仍保留/)
    expect(f.fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects excessive deletion and false source statistics at the wire boundary', async () => {
    const b = await background(), f = await transportFixture()
    expect(() => parseAvgNeutralBackgroundObservationV1({ ...b, removedMaskPixelCount: 20 }, f.width, f.height, 0.4)).toThrow()
    expect(() => parseAvgNeutralBackgroundObservationV1({ ...b, radius: 9 }, f.width, f.height, 0.4)).toThrow()
    f.headers.set('X-SF-Algorithm', 'storyforge.avg.foreground.sam2.1-pymatting.v5')
    expect(() => parseAvgSam2ForegroundHeadersV6(f.headers, { ...f.source, sourceHash: f.source.contentHash, policy })).toThrow()
  })
})
