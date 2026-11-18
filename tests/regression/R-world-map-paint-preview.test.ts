import { afterEach, describe, expect, it, vi } from 'vitest'
import { atlasPaintGeometryHash, prepareAtlasPaintPreview, readAtlasPaintFile } from '../../src/lib/world-map/atlas/paint-preview'
import { requestOpenAICompatibleImageEditV1 } from '../../src/lib/media/transport'
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
})
