import { freezeFormalAIEntryBindingV1, executeFrozenFormalImagePreviewV1 } from '../../agent/formal-ai-entry'
import { getAgentSkillV1 } from '../../agent/skill-registry'
import { hashCanonicalValue } from '../../agent/run/hash'
import { referenceImageBindingFromAIConfigV1 } from '../../media/capability'
import { requestAgnesReferenceImageV1, requestGeminiReferenceImageV1, requestOpenAICompatibleImageEditV1 } from '../../media/transport'
import { decodeRasterImageV1, MAX_RASTER_IMAGE_BYTES_V1 } from '../../media/raster-image'
import type { AIConfig } from '../../types'
import { parseAtlasReference, type AtlasGeometry } from './geometry'
import { atlasPaintFrame, cropAtlasPaintFrame, frameAtlasPaintReference } from './paint-frame'
import { ATLAS_PAINT_REVISION, assertAtlasPaintPackageV2, atlasTerrainHash, type AtlasPaintPackageV2 } from './paint-package'
import type { AtlasSymbolStyle } from './symbols'
import type { AtlasImageProtocol } from './image-connection'

export interface AtlasLegacyPaintPreview {
  kind: 'storyforge.atlas-paint'
  version: 1
  geometryHash: string
  image: string
}
export type AtlasPaintPreview = AtlasLegacyPaintPreview | AtlasPaintPackageV2

export const ATLAS_PAINT_PROMPT = `Transform this exact top-down map into a richly detailed, continuous hand-painted fantasy atlas. Preserve the reference coastline, islands, lakes, mountain ranges and forest positions exactly. Keep north up, the same framing and aspect ratio. Paint dramatic, asymmetric mountain peaks, branching foothills and clear valleys blending into plains. Retain the reference's white snow on cold ridges, dark woodland canopies and ochre sand/desert zones; keep distinct regional palettes rather than covering everything in green. Forests fade into scattered trees; mineral greens, warm lowlands and deep teal sea with turquoise coastal shallows, delicate engraved waves and north-west directional light. Crisp small-scale relief must remain legible at whole-map scale. All terrain must blend organically rather than look like pasted symbols, embossed blobs or uniform noise. Do not add new named features or change geography. NO text, letters, numbers, labels, compass or border; the application overlays its own legible typography. NO cities, buildings, roads, borders or routes. Do not invent rivers: rivers, settlements and transport are independent application layers. This is a flat orthographic cartographic painting, never a tilted 3D scene.`

/** Local style comparison prototype; the released UI still uses `painted`.
 * Inputs and outputs retain the existing ephemeral, author-reviewed boundary. */
export const ATLAS_STYLE_PAINT_PROMPTS = {
  painted: ATLAS_PAINT_PROMPT,
  sketch: `Refine this exact map as an elegant antique pen-and-ink geographic atlas on warm pale parchment. Preserve every coastline, island, lake and the positions and extents of mountain chains, woods, marsh and desert. Keep north up and the exact framing. Fine sepia contour-like hatching, asymmetric hand-drawn mountain silhouettes with delicate engraved slope strokes, individually inked tree symbols and restrained dune marks; quiet open plains, subtle paper grain, muted grey-green water and thin coastal ink. Enhance line craftsmanship and terrain legibility while keeping the image flat, sparse and distinctly drawn with a pen. Do not turn it into a colorful painted relief or a 3D terrain render. Slope strokes are artistic terrain marks, not surveyed elevation contours. NO new geography, text, labels, letters, numbers, compass, frame, cities, buildings, roads or rivers. All names, settlements, rivers and routes are separate application overlays.`,
  illustrated: `Refine this exact map as a richly illustrated watercolor-and-gouache storybook fantasy atlas. Preserve every coastline, island, lake and the positions and extents of mountain chains, woods, marsh and desert. Keep north up and the exact framing. Paint connected craggy mountain groups with crisp miniature ink detail and snow where the reference shows it. Preserve the full footprint and density of EACH existing woodland: paint many recognizable little evergreen trees with triangular needle crowns, interspersed with rounded leafy trees. Distinct tree silhouettes and sunlit leafy canopies must read clearly from far away. Woodland is never a lattice, checkerboard, cobblestone, cracked-earth pattern, tiled rectangle or abstract dark hatching. Use soft sage-green and ochre lowlands, warm sand, pale turquoise and desaturated teal water. Let painted forms and watercolor edges blend into a restrained parchment ground. Avoid repeated identical stamp silhouettes, empty uniform terrain and photographic or embossed terrain. Keep a flat cartographic view and a handcrafted illustrated character, distinct from monochrome pen linework and from realistic shaded relief. NO new geography, text, labels, letters, numbers, compass, frame, cities, buildings, roads or rivers. All names, settlements, rivers and routes are separate application overlays.`,
} as const

export function atlasPaintGeometryHash(geometry: AtlasGeometry, seed: string): Promise<string> {
  return hashCanonicalValue({ geometry: parseAtlasReference(geometry), seed })
}

export async function prepareAtlasPaintPreview(data: ArrayBuffer, geometryHash: string, geometry: AtlasGeometry): Promise<AtlasLegacyPaintPreview> {
  if (!/^[a-f0-9]{64}$/.test(geometryHash)) throw Error('绘画底图缺少当前地图指纹。')
  const { width, height, mimeType } = await decodeRasterImageV1(data)
  if (width < 512 || height < 256 || Math.abs(width / height / (geometry.width / geometry.height) - 1) > 0.02) {
    throw Error('绘画底图的尺寸或纵横比与当前地图不一致，请保持参考图构图。')
  }
  let binary = ''
  const bytes = new Uint8Array(data)
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { kind: 'storyforge.atlas-paint', version: 1, geometryHash, image: `data:${mimeType};base64,${btoa(binary)}` }
}

export async function readAtlasPaintFile(file: File, geometryHash: string, geometry: AtlasGeometry,
  target?: { terrainHash: string; style: keyof typeof ATLAS_STYLE_PAINT_PROMPTS; symbols: AtlasSymbolStyle }): Promise<AtlasPaintPreview> {
  if (file.size > MAX_RASTER_IMAGE_BYTES_V1 * 1.5) throw Error('绘画底图文件过大。')
  if (file.name.toLowerCase().endsWith('.json')) {
    const doc = JSON.parse(await file.text()) as AtlasPaintPreview
    if (doc?.version === 2) {
      assertAtlasPaintPackageV2(doc)
      if (!target || doc.geometryHash !== target.terrainHash || doc.style !== target.style || doc.symbols !== target.symbols) throw Error('增强底图包不属于当前地形或画风。')
      const binary = atob(doc.image.slice(doc.image.indexOf(',') + 1))
      const checked = await prepareAtlasPaintPreview(Uint8Array.from(binary, c => c.charCodeAt(0)).buffer, doc.geometryHash, geometry)
      return { ...doc, image: checked.image }
    }
    if (target && target.style !== 'painted') throw Error('旧版底图包没有画风信息，请在连续绘画中导入，或导入原始图片。')
    if (doc?.kind !== 'storyforge.atlas-paint' || doc.version !== 1 || doc.geometryHash !== geometryHash
      || typeof doc.image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(doc.image)) {
      throw Error('底图包不属于当前地图，或图片内容无效。')
    }
    const binary = atob(doc.image.slice(doc.image.indexOf(',') + 1))
    return prepareAtlasPaintPreview(Uint8Array.from(binary, c => c.charCodeAt(0)).buffer, geometryHash, geometry)
  }
  return prepareAtlasPaintPreview(await file.arrayBuffer(), geometryHash, geometry)
}

/** Explicit canvas input only; no DB/context lookup, formal write or hidden retry. */
export async function generateAtlasPaintPreview(input: {
  geometry: AtlasGeometry
  seed: string
  reference: Blob
  aiConfig: AIConfig
  imageModel: string
  style?: keyof typeof ATLAS_STYLE_PAINT_PROMPTS
  symbols?: AtlasSymbolStyle
  protocol?: AtlasImageProtocol
  width: number
  height: number
  signal?: AbortSignal
}): Promise<AtlasPaintPackageV2> {
  const geometry = parseAtlasReference(structuredClone(input.geometry))
  if (geometry.width / geometry.height < 1 / 3 || geometry.width / geometry.height > 6) throw Error('此地图过于狭长，当前图片接口需先分区增强；程序地图仍可完整使用。')
  const config = structuredClone(input.aiConfig)
  const style = input.style ?? 'painted', symbols = input.symbols ?? 'watercolor', seed = input.seed
  if (!['sketch', 'illustrated', 'painted'].includes(style) || !['watercolor', 'ink'].includes(symbols)) throw Error('地图绘画风格无效。')
  const gemini = input.protocol === 'gemini-interactions'
  const binding = gemini ? { provider: 'gemini' as const, baseUrl: config.baseUrl, apiKey: config.apiKey, model: input.imageModel.trim() }
    : referenceImageBindingFromAIConfigV1(config, input.imageModel)
  const prompt = ATLAS_STYLE_PAINT_PROMPTS[style]
  if (!prompt) throw Error('地图绘画风格无效。')
  const geometryHash = await atlasTerrainHash(geometry, seed)
  const frame = atlasPaintFrame(geometry.width, geometry.height, binding.provider === 'openai-compatible' ? 'openai-edit' : 'native')
  const reference = await frameAtlasPaintReference(input.reference, frame)
  input.signal?.throwIfAborted()
  const entry = await freezeFormalAIEntryBindingV1('world.map.paint-preview')
  const data = await executeFrozenFormalImagePreviewV1('world.map.paint-preview', entry,
    getAgentSkillV1('world-origin.map-config'), 'src/lib/world-map/atlas/paint-preview.ts',
    () => binding.provider === 'gemini'
      ? requestGeminiReferenceImageV1({ binding, prompt, reference, ratio: frame.ratio, signal: input.signal })
      : binding.provider === 'agnes'
      ? requestAgnesReferenceImageV1({ binding, prompt: prompt
        + ' Preserve the entire reference frame, including narrow sea padding at the edges. Do not crop or zoom.',
        reference, ratio: frame.ratio, signal: input.signal })
      : requestOpenAICompatibleImageEditV1({ binding, prompt,
        reference, width: frame.width, height: frame.height, signal: input.signal }),
    { category: 'geography.world-map-paint' }, input.signal)
  input.signal?.throwIfAborted()
  const normalized = await cropAtlasPaintFrame(data, frame)
  input.signal?.throwIfAborted()
  const checked = await prepareAtlasPaintPreview(normalized, geometryHash, geometry)
  return { ...checked, version: 2, style, symbols, rendering: 'masked-v2',
    source: { provider: binding.provider, model: binding.model, createdAt: Date.now(), promptRevision: ATLAS_PAINT_REVISION } }
}
