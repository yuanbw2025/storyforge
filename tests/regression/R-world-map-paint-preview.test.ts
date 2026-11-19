import { afterEach, describe, expect, it, vi } from 'vitest'
import { atlasPaintGeometryHash, prepareAtlasPaintPreview, readAtlasPaintFile } from '../../src/lib/world-map/atlas/paint-preview'
import { requestAgnesReferenceImageV1, requestOpenAICompatibleImageEditV1 } from '../../src/lib/media/transport'
import { referenceImageBindingFromAIConfigV1 } from '../../src/lib/media/capability'
import { atlasPaintFrame } from '../../src/lib/world-map/atlas/paint-frame'
import { parseAtlasReference } from '../../src/lib/world-map/atlas/geometry'

const decoder = vi.hoisted(() => vi.fn(async () => ({ width: 1200, height: 700, mimeType: 'image/png' })))
vi.mock('../../src/lib/media/raster-image', () => ({ decodeRasterImageV1: decoder, MAX_RASTER_IMAGE_BYTES_V1: 25 * 1024 * 1024 }))
const geometry = parseAtlasReference({ version: 1, width: 1200, height: 700,
  features: [{ kind: 'land', name: '', rank: 0, points: [[0, 0], [1200, 0], [1200, 700], [0, 700]] }] })
const binding = { provider: 'openai-compatible' as const, baseUrl: 'https://provider.invalid/v1', apiKey: 'synthetic-key', model: 'configured-image-model' }
afterEach(() => { vi.unstubAllGlobals(); decoder.mockResolvedValue({ width: 1200, height: 700, mimeType: 'image/png' }) })

describe('地图绘画底图属于显式视图候选', () => {
  it('只发一次参考图编辑请求，保留模型和真实参考，不降级成无约束文生图', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: btoa('image-bytes') }] })))
    vi.stubGlobal('fetch', fetcher)
    const reference = new Blob(['png-reference'], { type: 'image/png' })
    expect(new TextDecoder().decode(await requestOpenAICompatibleImageEditV1({ binding, reference, prompt: 'preserve geometry', width: 1536, height: 896 }))).toBe('image-bytes')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://provider.invalid/v1/images/edits')
    const body = request.body as FormData
    expect(body.get('model')).toBe(binding.model)
    expect(body.get('size')).toBe('1536x896')
    expect((body.get('image') as File).size).toBe(reference.size)
    expect(body.get('n')).toBe('1')
  })
  it('授权/限额/服务异常不隐藏重发，参考类型无效在发送前拒绝', async () => {
    for (const status of [401, 402, 429, 503]) {
      const fetcher = vi.fn(async () => new Response('', { status })); vi.stubGlobal('fetch', fetcher)
      await expect(requestOpenAICompatibleImageEditV1({ binding, reference: new Blob(['x'], { type: 'image/png' }), prompt: 'map', width: 1536, height: 896 })).rejects.toThrow(String(status))
      expect(fetcher).toHaveBeenCalledTimes(1)
      await expect(requestOpenAICompatibleImageEditV1({ binding, reference: new Blob(['x'], { type: 'image/svg+xml' }), prompt: 'map', width: 1536, height: 896 })).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })
  it('包绑定精确几何和种子，拒绝另一张地图、SVG 或错纵横比；正常包可往返', async () => {
    const hash = await atlasPaintGeometryHash(geometry, 'fixed')
    const art = await prepareAtlasPaintPreview(new TextEncoder().encode('raster').buffer, hash, geometry)
    expect(await readAtlasPaintFile(new File([JSON.stringify(art)], 'map.json'), hash, geometry)).toEqual(art)
    const other = await atlasPaintGeometryHash(geometry, 'another-seed')
    await expect(readAtlasPaintFile(new File([JSON.stringify(art)], 'map.json'), other, geometry)).rejects.toThrow(/不属于/)
    await expect(readAtlasPaintFile(new File([JSON.stringify({ ...art, image: 'data:image/svg+xml;base64,PHN2Zz4=' })], 'map.json'), hash, geometry)).rejects.toThrow()
    decoder.mockResolvedValue({ width: 1024, height: 1024, mimeType: 'image/png' })
    await expect(prepareAtlasPaintPreview(new ArrayBuffer(8), hash, geometry)).rejects.toThrow(/纵横比/)
  })
  it('Agnes 参考图使用 image 单数数组和专用模型，不丢参考或降级成文生图', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: btoa('image-bytes') }] })))
    vi.stubGlobal('fetch', fetcher)
    const config = { provider: 'agnes' as const, baseUrl: 'https://fixture.invalid/v1/chat/completions', apiKey: 'synthetic-key', model: 'agnes-2.5-flash', temperature: 0.7, maxTokens: 0 }
    const binding = referenceImageBindingFromAIConfigV1(config, 'agnes-image-2.1-flash')
    expect(binding.provider).toBe('agnes')
    if (binding.provider !== 'agnes') throw Error('wrong binding')
    await requestAgnesReferenceImageV1({ binding, reference: new Blob(['png-reference'], { type: 'image/png' }), prompt: 'map', ratio: '16:9' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://fixture.invalid/v1/images/generations')
    expect(JSON.parse(request.body as string)).toMatchObject({ model: 'agnes-image-2.1-flash', ratio: '16:9', size: '2K',
      extra_body: { image: ['data:image/png;base64,' + btoa('png-reference')], response_format: 'b64_json' } })
    expect(JSON.parse(request.body as string).images).toBeUndefined()
    expect(config.model).toBe('agnes-2.5-flash')
    expect(() => referenceImageBindingFromAIConfigV1(config, 'gpt-image-2')).toThrow(/Agnes/)
  })
  it('Agnes 失败不自动重发；无效参考与比例在网络前拒绝', async () => {
    const binding = { provider: 'agnes' as const, model: 'agnes-image-2.1-flash' as const, baseUrl: 'https://fixture.invalid/v1', apiKey: 'synthetic-key' }
    for (const status of [401, 402, 429, 503]) {
      const fetcher = vi.fn(async () => new Response('', { status })); vi.stubGlobal('fetch', fetcher)
      const input = { binding, reference: new Blob(['png'], { type: 'image/png' }), prompt: 'map', ratio: '16:9' }
      await expect(requestAgnesReferenceImageV1(input)).rejects.toThrow(String(status))
      expect(fetcher).toHaveBeenCalledTimes(1)
      await expect(requestAgnesReferenceImageV1({ ...input, ratio: '12:7' })).rejects.toThrow(/画幅/)
      await expect(requestAgnesReferenceImageV1({ ...input, reference: new Blob(['svg'], { type: 'image/svg+xml' }) })).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })
  it('原地图等比放入原生画幅，裁去的仅是留边；横竖图不拉伸', () => {
    for (const [width, height] of [[1200, 700], [700, 1200], [1000, 1000], [1800, 700]]) {
      const frame = atlasPaintFrame(width, height)
      expect(frame.width * frame.contentWidth / (frame.height * frame.contentHeight)).toBeCloseTo(width / height, 10)
      expect(frame.x + frame.contentWidth / 2).toBeCloseTo(0.5, 10)
      expect(frame.y + frame.contentHeight / 2).toBeCloseTo(0.5, 10)
      expect(frame.x).toBeGreaterThanOrEqual(0)
      expect(frame.y).toBeGreaterThanOrEqual(0)
    }
    expect(atlasPaintFrame(1200, 700).ratio).toBe('16:9')
    expect(() => atlasPaintFrame(0, 700)).toThrow()
    expect(() => atlasPaintFrame(NaN, 700)).toThrow()
  })
})
