import { hashCanonicalValue } from '../../agent/run/hash'
import type { AtlasGeometry } from './geometry'
import type { AtlasViewStyle } from './view-style'
import type { AtlasSymbolStyle } from './symbols'

export const ATLAS_PAINT_REVISION = 'atlas-masked-20261119-v2'
export interface AtlasPaintPackageV2 {
  kind: 'storyforge.atlas-paint'
  version: 2
  geometryHash: string
  style: AtlasViewStyle
  symbols: AtlasSymbolStyle
  image: string
  rendering: 'masked-v2'
  source: { provider: string; model: string; createdAt: number; promptRevision: string }
}
/** Labels, routes and settlement edits are independent overlays. Only material geography
 * invalidates a painted surface. Cold-ridge classification currently follows the native renderer. */
export function atlasTerrainHash(g: AtlasGeometry, seed: string): Promise<string> {
  return hashCanonicalValue({ version: g.version, width: g.width, height: g.height, cellCoast: !!g.cellCoast, seed,
    features: g.features.filter(f => ['land', 'realm', 'water', 'ridge', 'wood', 'desert', 'marsh'].includes(f.kind))
      .map(f => ({ kind: f.kind, points: f.points, cold: f.kind === 'ridge' && /雪|霜|冰|寒/.test(f.name) })) })
}
export function assertAtlasPaintPackageV2(value: unknown): asserts value is AtlasPaintPackageV2 {
  const v = value as AtlasPaintPackageV2
  if (!v || v.kind !== 'storyforge.atlas-paint' || v.version !== 2 || v.rendering !== 'masked-v2'
    || !/^[a-f0-9]{64}$/.test(v.geometryHash) || !['sketch', 'illustrated', 'painted'].includes(v.style)
    || !['watercolor', 'ink'].includes(v.symbols) || typeof v.image !== 'string'
    || v.image.length > 36 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v.image)
    || !v.source || typeof v.source.provider !== 'string' || v.source.provider.length > 80
    || typeof v.source.model !== 'string' || v.source.model.length > 200
    || typeof v.source.promptRevision !== 'string' || v.source.promptRevision.length > 100
    || !Number.isFinite(v.source.createdAt) || v.source.createdAt < 0) throw Error('增强底图包格式或来源无效。')
}
