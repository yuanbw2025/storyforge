import { freezeFormalAIEntryBindingV1, executeFrozenFormalImagePreviewV1 } from '../../agent/formal-ai-entry'
import { getAgentSkillV1 } from '../../agent/skill-registry'
import { hashCanonicalValue } from '../../agent/run/hash'
import { referenceImageBindingFromAIConfigV1 } from '../../media/capability'
import { requestAgnesReferenceImageV1, requestOpenAICompatibleImageEditV1 } from '../../media/transport'
import { decodeRasterImageV1, MAX_RASTER_IMAGE_BYTES_V1 } from '../../media/raster-image'
import type { AIConfig } from '../../types'
import { parseAtlasReference, type AtlasGeometry } from './geometry'
import { atlasPaintFrame, cropAtlasPaintFrame, frameAtlasPaintReference } from './paint-frame'

export interface AtlasPaintPreview {
  kind: 'storyforge.atlas-paint'
  version: 1
  geometryHash: string
  image: string
}

export const ATLAS_PAINT_PROMPT = `Transform this exact top-down map into a richly detailed, continuous hand-painted fantasy atlas. Preserve the reference coastline, islands, lakes, mountain ranges and forest positions exactly. Keep north up, the same framing and aspect ratio. Paint dramatic, asymmetric mountain peaks, branching foothills and clear valleys blending into plains. Retain the reference's white snow on cold ridges, dark woodland canopies and ochre sand/desert zones; keep distinct regional palettes rather than covering everything in green. Forests fade into scattered trees; mineral greens, warm lowlands and deep teal sea with turquoise coastal shallows, delicate engraved waves and north-west directional light. Crisp small-scale relief must remain legible at whole-map scale. All terrain must blend organically rather than look like pasted symbols, embossed blobs or uniform noise. Do not add new named features or change geography. NO text, letters, numbers, labels, compass or border; the application overlays its own legible typography. NO cities, buildings, roads, borders or routes. Do not invent rivers: rivers, settlements and transport are independent application layers. This is a flat orthographic cartographic painting, never a tilted 3D scene.`

export function atlasPaintGeometryHash(geometry: AtlasGeometry, seed: string): Promise<string> {
  return hashCanonicalValue({ geometry: parseAtlasReference(geometry), seed })
}

export async function prepareAtlasPaintPreview(data: ArrayBuffer, geometryHash: string, geometry: AtlasGeometry): Promise<AtlasPaintPreview> {
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

export async function readAtlasPaintFile(file: File, geometryHash: string, geometry: AtlasGeometry): Promise<AtlasPaintPreview> {
  if (file.size > MAX_RASTER_IMAGE_BYTES_V1 * 1.5) throw Error('绘画底图文件过大。')
  if (file.name.toLowerCase().endsWith('.json')) {
    const doc = JSON.parse(await file.text()) as AtlasPaintPreview
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
  width: number
  height: number
  signal?: AbortSignal
}): Promise<AtlasPaintPreview> {
  const geometry = parseAtlasReference(structuredClone(input.geometry))
  const config = structuredClone(input.aiConfig)
  const binding = referenceImageBindingFromAIConfigV1(config, input.imageModel)
  const geometryHash = await atlasPaintGeometryHash(geometry, input.seed)
  const frame = binding.provider === 'agnes' ? atlasPaintFrame(geometry.width, geometry.height) : undefined
  const reference = frame ? await frameAtlasPaintReference(input.reference, frame) : input.reference
  input.signal?.throwIfAborted()
  const entry = await freezeFormalAIEntryBindingV1('world.map.paint-preview')
  const data = await executeFrozenFormalImagePreviewV1('world.map.paint-preview', entry,
    getAgentSkillV1('world-origin.map-config'), 'src/lib/world-map/atlas/paint-preview.ts',
    () => binding.provider === 'agnes'
      ? requestAgnesReferenceImageV1({ binding, prompt: ATLAS_PAINT_PROMPT
        + ' Preserve the entire reference frame, including narrow sea padding at the edges. Do not crop or zoom.',
        reference, ratio: frame!.ratio, signal: input.signal })
      : requestOpenAICompatibleImageEditV1({ binding, prompt: ATLAS_PAINT_PROMPT,
        reference, width: input.width, height: input.height, signal: input.signal }),
    { category: 'geography.world-map-paint' }, input.signal)
  input.signal?.throwIfAborted()
  const normalized = frame ? await cropAtlasPaintFrame(data, frame) : data
  input.signal?.throwIfAborted()
  return prepareAtlasPaintPreview(normalized, geometryHash, geometry)
}
