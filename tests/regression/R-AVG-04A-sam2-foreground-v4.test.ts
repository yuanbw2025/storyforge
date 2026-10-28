import { describe, expect, it, vi } from 'vitest'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4, AVG_FOREGROUND_SAM2_MATTING_ID_V4,
  AVG_FOREGROUND_SAM2_MATTING_METHOD_V4, AVG_FOREGROUND_SAM2_MODEL_REVISION_V4,
  AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4, compileAvgForegroundRequirement, assertAvgForegroundRequirementBinding,
  parseAvgForegroundPolicyV4, supportsAvgSam2ForegroundRequirementV4 } from '../../src/lib/avg/image-foreground-contract'
import { assertAvgSam2ForegroundCapabilityV4, assertAvgSam2ForegroundServiceReadyV4,
  parseAvgSam2ForegroundHeadersV4, parseAvgForegroundSam2ObservationV4 } from '../../src/lib/avg/image-foreground-sam2-v4'

const policy = {
  schema: 'storyforge.avg.foreground-policy' as const, version: 4 as const, method: 'local-sam2-box-matting' as const,
  algorithm: AVG_FOREGROUND_SAM2_MATTING_ID_V4, model: 'sam2.1-hiera-tiny' as const,
  modelRevision: AVG_FOREGROUND_SAM2_MODEL_REVISION_V4, checkpointSha256: AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4,
  promptStrategy: AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4, mattingMethod: AVG_FOREGROUND_SAM2_MATTING_METHOD_V4,
  declaration: '本机 SAM 2 分割和 alpha 估算仅生成候选，作者必须对照原图评审。',
}
const hash = 'a'.repeat(64)
function responseHeaders() {
  return new Headers({
    'X-SF-Algorithm': policy.algorithm, 'X-SF-Source-SHA256': hash,
    'X-SF-Source-Pixel-SHA256': 'b'.repeat(64), 'X-SF-Alpha-SHA256': 'c'.repeat(64),
    'X-SF-Cutout-Pixel-SHA256': 'd'.repeat(64), 'X-SF-Result-PNG-SHA256': 'e'.repeat(64),
    'X-SF-Model-ID': policy.model, 'X-SF-Model-Revision': policy.modelRevision,
    'X-SF-Checkpoint-SHA256': policy.checkpointSha256, 'X-SF-Code-Revision': policy.modelRevision,
    'X-SF-Prompt-SHA256': 'f'.repeat(64), 'X-SF-Prompt-Strategy': policy.promptStrategy,
    'X-SF-Model-Score': '0.91', 'X-SF-Alpha-Ratio': '0.42', 'X-SF-Matting-Method': policy.mattingMethod,
    'X-SF-Device': 'mps', 'X-SF-Width': '80', 'X-SF-Height': '120',
  })
}

describe('AVG local SAM 2 foreground policy V4', () => {
  it('accepts only the frozen local service identity and readiness claims', () => {
    const capability = { schema: 'storyforge.avg.local-foreground-capability', version: 1, ready: true,
      algorithm: policy.algorithm, model: policy.model, modelRevision: policy.modelRevision,
      checkpointSha256: policy.checkpointSha256, codeRevision: policy.modelRevision, device: 'mps',
      storage: 'none', networkInference: false, mattingMethod: policy.mattingMethod }
    expect(assertAvgSam2ForegroundCapabilityV4(capability)).toEqual({ device: 'mps' })
    expect(() => assertAvgSam2ForegroundCapabilityV4({ ...capability, checkpointSha256: '0'.repeat(64) })).toThrow(/不一致/)
    expect(() => assertAvgSam2ForegroundCapabilityV4({ ...capability, networkInference: true })).toThrow(/不一致/)
    expect(() => assertAvgSam2ForegroundCapabilityV4({ ...capability, extra: true })).toThrow(/字段不完整或含未知字段/)
  })

  it('probes only the fixed loopback capability endpoint with bounded read-only request settings', async () => {
    const capability = { schema: 'storyforge.avg.local-foreground-capability', version: 1, ready: true,
      algorithm: policy.algorithm, model: policy.model, modelRevision: policy.modelRevision,
      checkpointSha256: policy.checkpointSha256, codeRevision: policy.modelRevision, device: 'cpu',
      storage: 'none', networkInference: false, mattingMethod: policy.mattingMethod }
    const fetcher = vi.fn(async () => new Response(JSON.stringify(capability), { status: 200,
      headers: { 'content-type': 'application/json' } }))
    await expect(assertAvgSam2ForegroundServiceReadyV4(fetcher)).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]![0]).toBe('http://127.0.0.1:5278/v1/capabilities')
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error' })
  })

  it('stops waiting on a stalled capability body at the fixed preflight deadline', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
      const pending = assertAvgSam2ForegroundServiceReadyV4(fetcher)
      const rejected = expect(pending).rejects.toThrow(/SAM 2 服务未就绪/)
      await vi.advanceTimersByTimeAsync(5_000)
      await rejected
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('pins code, checkpoint, prompt recipe and matting algorithm', () => {
    expect(parseAvgForegroundPolicyV4(policy)).toEqual(policy)
    expect(() => parseAvgForegroundPolicyV4({ ...policy, checkpointSha256: '0'.repeat(64) })).toThrow()
  })

  it('binds transparent actor output without retroactively changing the source image request', () => {
    const requirement = { mediaKind: 'character-pose' as const, consumer: { domain: 'stage' as const, slot: 'actor' as const },
      alpha: 'required' as const, invariants: ['角色身份不变'], forbiddenDepictions: ['背景文字'] }
    const compiled = compileAvgForegroundRequirement(policy, requirement)
    expect(compiled).toEqual(requirement)
    expect(compiled.invariants.some(value => value.includes('纯品红'))).toBe(false)
    expect(() => assertAvgForegroundRequirementBinding(policy, requirement)).not.toThrow()
    expect(supportsAvgSam2ForegroundRequirementV4({ mediaKind: 'ui', consumer: { domain: 'inventory', slot: 'icon' }, alpha: 'required' })).toBe(false)
    expect(() => assertAvgForegroundRequirementBinding(policy, { ...requirement, mediaKind: 'ui', consumer: { domain: 'inventory', slot: 'icon' } }))
      .toThrow(/人物框策略/)
  })

  it('accepts only service output bound to the exact source, model, prompts and dimensions', () => {
    const headers = responseHeaders()
    const observed = parseAvgSam2ForegroundHeadersV4(headers, { sourceHash: hash, width: 80, height: 120, policy })
    expect(observed).toMatchObject({ version: 4, algorithm: policy.algorithm, modelId: policy.model,
      modelRevision: policy.modelRevision, maskCoverage: 0.42, width: 80, height: 120 })
    headers.set('X-SF-Checkpoint-SHA256', '9'.repeat(64))
    expect(() => parseAvgSam2ForegroundHeadersV4(headers, { sourceHash: hash, width: 80, height: 120, policy })).toThrow(/不一致/)
  })

  it('parses a complete immutable observation and rejects missing alpha pixels', async () => {
    const observation = parseAvgForegroundSam2ObservationV4({
      version: 4, algorithm: policy.algorithm, modelId: policy.model, modelRevision: policy.modelRevision,
      checkpointSha256: policy.checkpointSha256, codeRevision: policy.modelRevision, promptStrategy: policy.promptStrategy,
      promptSha256: 'f'.repeat(64), modelScore: 0.91, maskCoverage: 0.42, alphaCoverage: 0.41,
      mattingMethod: policy.mattingMethod, device: 'cpu', clearedPixelCount: 5, translucentPixelCount: 4,
      opaquePixelCount: 11, width: 4, height: 5, policyHash: await hashProductProductionValueV2(policy),
      sourcePixelHash: 'b'.repeat(64), alphaPlaneHash: 'c'.repeat(64), cutoutPixelHash: 'd'.repeat(64),
      serviceCutoutPixelHash: '8'.repeat(64), resultPngSha256: 'e'.repeat(64),
    })
    expect(observation).toMatchObject({ version: 4, device: 'cpu', clearedPixelCount: 5, opaquePixelCount: 11 })
    expect(() => parseAvgForegroundSam2ObservationV4({ ...observation, opaquePixelCount: 10 })).toThrow(/像素计数/)
  })
})
