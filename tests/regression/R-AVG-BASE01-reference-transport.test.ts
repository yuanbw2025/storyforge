import { describe, expect, it, vi } from 'vitest'
import { AIError } from '../../src/lib/types'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { ProductProductionResultUnknownErrorV1 } from '../../src/lib/product-production/scheduler'
import type { MediaProviderTransportV1, MediaTransportResponseV1, ProductMediaRequestV1 } from '../../src/lib/product-production/media-adapters'
import {
  assertAvgImageRequestV1, freezeAvgImageRequestV1, parseAvgMediaReferencesV1,
  type AvgMediaReferenceV1,
} from '../../src/lib/avg/media-reference-contract'
import { AvgImageOperationUnknownErrorV1, createAvgReferenceImageAdapterV1 } from '../../src/lib/avg/media-reference-adapter'

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const PNG = Uint8Array.from(atob(PNG_BASE64), c => c.charCodeAt(0)).buffer
const signal = () => new AbortController().signal
const request = (): ProductMediaRequestV1 => ({
  schema: 'storyforge.product-media-request', version: 1, requestId: 'avg.image.test.1', adapterId: 'agnes.image-2.1-flash.v1',
  mediaClass: 'image', mediaKind: 'character-expression', requirementKey: 'avg.requirement.cast.smile', artifactKey: 'avg.media.cast.smile',
  prompt: '原创人物，同一服装，只把平静改为微笑。', negativePrompt: '水印', count: 1, width: 864, height: 1152, durationMs: null,
  inputHash: 'a'.repeat(64), qualityProfile: 'internal', environment: 'test', allowedDataClasses: ['avg-authorized-reference'],
  rightsPolicyVersion: 'avg-test-rights.v1',
})
async function reference(): Promise<AvgMediaReferenceV1> {
  return { assetKey: 'avg.asset.cast.reference', assetVersion: 1, contentHash: await sha256MediaData(PNG), mimeType: 'image/png', byteSize: PNG.byteLength,
    purpose: 'identity', allowedChange: '保留五官、发色、服装、构图，只改嘴角和眉眼。', dataClass: 'avg-authorized-reference',
    license: '原创测试输入，允许该次外发和衍生使用', providerInputAllowed: true, derivativeUseAllowed: true, crop: null, mask: null }
}
function provider(overrides: Partial<MediaTransportResponseV1> = {}) {
  const response: MediaTransportResponseV1 = { status: 200, contentType: 'application/json', body: null,
    json: { data: [{ b64_json: PNG_BASE64 }] }, providerRequestId: 'provider.image.1', usage: { image_tokens: 1 }, costUsd: null, ...overrides }
  const dispatch = vi.fn(async () => response)
  const transport: MediaProviderTransportV1 = { executionLocation: 'browser-direct', request: dispatch }
  return { transport, dispatch }
}
async function prepare(refs?: AvgMediaReferenceV1[]) {
  const frozen = await freezeAvgImageRequestV1({ request: request(), resolutionTier: '2K', references: refs ?? [await reference()] })
  const readReference = vi.fn(async () => PNG.slice(0))
  const adapter = await createAvgReferenceImageAdapterV1({ frozen, readReference })
  return { frozen, adapter, readReference, executable: { ...frozen.request, inputHash: frozen.inputHash } }
}

describe('R-AVG-BASE01 · actual reference image transport', () => {
  it('传入真实参考字节及用途顺序，保留未知费用和可验证回执', async () => {
    const first = await reference(), second = { ...first, assetKey: 'avg.asset.pose.reference', purpose: 'pose' as const, allowedChange: '采用右手姿势；保留第一图身份' }
    const { adapter, executable, frozen, readReference } = await prepare([first, second])
    const { transport, dispatch } = provider()
    const [candidate] = await adapter.generate(executable, transport, signal())
    expect(readReference.mock.calls).toEqual([[first], [second]])
    expect(dispatch).toHaveBeenCalledTimes(1)
    const sent = dispatch.mock.calls[0] as unknown as [{ body: Record<string, unknown> }]
    expect(sent[0].body).toMatchObject({ size: '2K', ratio: '3:4', extra_body: {
      response_format: 'b64_json', image: [`data:image/png;base64,${PNG_BASE64}`, `data:image/png;base64,${PNG_BASE64}`],
    } })
    expect(sent[0].body).not.toHaveProperty('image')
    expect(String(sent[0].body.prompt)).toContain('"image":2,"purpose":"pose"')
    expect(candidate.metadata.avgReferenceTransmission).toMatchObject({ inputHash: frozen.inputHash, capabilityHash: frozen.capabilityHash,
      references: [{ ...first, inputIndex: 1 }, { ...second, inputIndex: 2 }], alphaGuaranteed: false })
    expect(candidate.metadata.providerSize).toBe('2K')
    expect((await adapter.estimate(executable)).estimatedCostUsd).toBeNull()
    expect(candidate.providerReceipt).toMatchObject({ costUsd: null, providerRequestId: 'provider.image.1' })
    await expect(adapter.parseAndVerify(candidate)).resolves.toMatchObject({ contentHash: await sha256MediaData(PNG) })
    await expect(adapter.parseAndVerify({ ...candidate, metadata: { ...candidate.metadata, avgReferenceTransmission: {} } })).rejects.toThrow(/回执/)
  })

  it('空参考为显式文生图，仍有精确请求回执且不伪造图生图', async () => {
    const { adapter, executable } = await prepare([]), { transport, dispatch } = provider()
    const [candidate] = await adapter.generate(executable, transport, signal())
    const call = dispatch.mock.calls[0] as unknown as [{ body: { extra_body: object } }]
    expect(call[0].body.extra_body).toEqual({ response_format: 'b64_json' })
    expect(candidate.metadata.avgReferenceTransmission).toMatchObject({ references: [] })
  })

  it.each(['providerInputAllowed', 'derivativeUseAllowed'] as const)('未授权 %s 在 dispatch 前拒绝', async field => {
    const ref = await reference()
    expect(() => parseAvgMediaReferencesV1([{ ...ref, [field]: false }])).toThrow(/授权/)
  })
  it.each(['crop', 'mask'] as const)('能力不支持的 %s 不会静默丢弃', async field => {
    const ref = await reference()
    expect(() => parseAvgMediaReferencesV1([{ ...ref, [field]: { x: 0 } }])).toThrow(/crop\/mask/)
  })
  it('拒绝重复、过量、超大参考和未许可数据类别', async () => {
    const ref = await reference()
    expect(() => parseAvgMediaReferencesV1([ref, ref])).toThrow(/重复/)
    expect(() => parseAvgMediaReferencesV1(Array.from({ length: 5 }, (_, i) => ({ ...ref, assetKey: `ref.${i}` })))).toThrow(/有界/)
    expect(() => parseAvgMediaReferencesV1([{ ...ref, byteSize: 8 * 1024 * 1024 + 1 }])).toThrow(/byteSize/)
    expect(() => parseAvgMediaReferencesV1(Array.from({ length: 4 }, (_, i) => ({ ...ref, assetKey: `ref.${i}`, byteSize: 8 * 1024 * 1024 })))).toThrow(/总字节/)
    await expect(freezeAvgImageRequestV1({ request: { ...request(), allowedDataClasses: [] }, resolutionTier: '1K', references: [ref] })).rejects.toThrow(/数据类别/)
  })

  it('任何上游/参考/质量参数变化都会使冻结输入 stale', async () => {
    const { frozen, adapter, executable } = await prepare(), { transport, dispatch } = provider()
    for (const mutate of [
      (v: typeof frozen) => { v.references[0].assetVersion++ },
      (v: typeof frozen) => { v.references[0].contentHash = 'b'.repeat(64) },
      (v: typeof frozen) => { v.resolutionTier = '1K' },
      (v: typeof frozen) => { v.request.prompt += '改服装' },
      (v: typeof frozen) => { v.capabilityHash = 'c'.repeat(64) },
    ]) {
      const changed = structuredClone(frozen); mutate(changed)
      await expect(assertAvgImageRequestV1(changed)).rejects.toThrow(/stale/)
    }
    await expect(adapter.generate({ ...executable, inputHash: 'd'.repeat(64) }, transport, signal())).rejects.toThrow(/冻结/)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('跨 owner 读取或错 hash/MIME/尺寸会整笔失败，不降级到纯文字', async () => {
    for (const mode of ['scope', 'hash', 'mime', 'dimensions']) {
      const ref = await reference()
      let bytes = PNG
      if (mode === 'hash') bytes = PNG.slice(0, PNG.byteLength - 1)
      if (mode === 'mime' || mode === 'dimensions') {
        bytes = new Uint8Array(mode === 'mime' ? [1, 2, 3, 4] : [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(16).fill(0)]).buffer
        ref.byteSize = Math.max(24, bytes.byteLength)
        ref.contentHash = await sha256MediaData(bytes)
      }
      const frozen = await freezeAvgImageRequestV1({ request: request(), resolutionTier: '1K', references: [ref] })
      const adapter = await createAvgReferenceImageAdapterV1({ frozen, readReference: async () => { if (mode === 'scope') throw new Error('cross-work'); return bytes } })
      const { transport, dispatch } = provider()
      await expect(adapter.generate({ ...frozen.request, inputHash: frozen.inputHash }, transport, signal())).rejects.toThrow()
      expect(dispatch).not.toHaveBeenCalled()
    }
  })

  it('预先取消不会读取或发送参考', async () => {
    const { adapter, executable, readReference } = await prepare(), { transport, dispatch } = provider()
    const abort = new AbortController(); abort.abort()
    await expect(adapter.generate(executable, transport, abort.signal)).rejects.toThrow(/Aborted/)
    expect(readReference).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled()
  })

  it.each([202, 200])('只有 operation 的 %i 保留 ID 并交给 Harness 未知结果门', async status => {
    const { adapter, executable } = await prepare(), { transport, dispatch } = provider({ status, json: { task_id: 'operation.image.42' } })
    const error = await adapter.generate(executable, transport, signal()).catch(error => error)
    expect(error).toBeInstanceOf(ProductProductionResultUnknownErrorV1)
    expect(error).toBeInstanceOf(AvgImageOperationUnknownErrorV1)
    expect(error.operationId).toBe('operation.image.42')
    expect(error.requestDispatched).toBe(true); expect(error.reservationDisposition).toBe('retain')
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('operation 附空 data 仍是未知结果，不能把空数组当作同步完成', async () => {
    const { adapter, executable } = await prepare(), { transport, dispatch } = provider({ json: { task_id: 'operation.empty.1', data: [] } })
    const error = await adapter.generate(executable, transport, signal()).catch(error => error)
    expect(error).toBeInstanceOf(AvgImageOperationUnknownErrorV1)
    expect(error.operationId).toBe('operation.empty.1'); expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('恢复时拒绝被改写的用途、权利、费用、执行位置和输出档位', async () => {
    const { adapter, executable } = await prepare(), { transport } = provider()
    const [candidate] = await adapter.generate(executable, transport, signal())
    const variants = [
      { ...candidate, mediaClass: 'sfx' },
      { ...candidate, rights: { ...candidate.rights, rightsPolicyVersion: 'unfrozen-policy' } },
      { ...candidate, rights: { ...candidate.rights, requiresProviderTermsReview: false } },
      { ...candidate, providerReceipt: { ...candidate.providerReceipt, costUsd: Number.NaN } },
      { ...candidate, providerReceipt: { ...candidate.providerReceipt, executionLocation: 'trusted-relay' } },
      { ...candidate, metadata: { ...candidate.metadata, providerSize: '4K' } },
    ]
    for (const variant of variants) await expect(adapter.parseAndVerify(variant)).rejects.toThrow(/回执/)
  })

  it('已 dispatch 网络中断保守保留，绝不重发；非法 operation ID 不入证据', async () => {
    const { adapter, executable } = await prepare(), { transport, dispatch } = provider({ json: { operation_id: 'Bearer unsafe-private-id' } })
    const error = await adapter.generate(executable, transport, signal()).catch(error => error)
    expect(error.operationId).toBeNull(); expect(error.message).not.toContain('unsafe-private-id')
    dispatch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(adapter.generate(executable, transport, signal())).rejects.toBeInstanceOf(AvgImageOperationUnknownErrorV1)
    expect(dispatch).toHaveBeenCalledTimes(2) // Two explicit calls; zero hidden retries.
  })

  it.each([400, 401, 402, 403, 429])('明确 HTTP %i 原样进入失败分类，只有一次调用', async status => {
    const { adapter, executable } = await prepare(), { transport, dispatch } = provider({ status, json: { error: { code: 'account_error', message: 'Request rejected' } } })
    const error = await adapter.generate(executable, transport, signal()).catch(error => error)
    expect(error).toBeInstanceOf(AIError); expect(error.status).toBe(status); expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
