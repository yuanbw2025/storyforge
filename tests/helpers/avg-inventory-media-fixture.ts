import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'

/** Wholly original, fixed safe SVG geometry for technical image decoding and
 * binding checks. No imported artwork, external URL, font, script or generator.
 * This intentionally makes no illustration/commercial-quality claim. */
export async function avgInventoryMediaFixture() {
  const drawings = [
    { assetKey: 'ui.envelope', kind: 'ui' as const, width: 256, height: 256, altText: '封闭的信封', body: '<rect x="32" y="54" width="192" height="148" rx="10" fill="#dec7a0" stroke="#725335" stroke-width="5"/><path d="M34 59L128 132L222 59M34 198L99 129M222 198L157 129" fill="none" stroke="#97764e" stroke-width="4"/><circle cx="128" cy="133" r="23" fill="#913f43"/><circle cx="128" cy="133" r="13" fill="none" stroke="#c58374" stroke-width="3"/>' },
    { assetKey: 'cg.seal-detail', kind: 'cg' as const, width: 640, height: 400, altText: '封印边缘的旧缺口', body: '<rect x="40" y="36" width="560" height="328" rx="14" fill="#dec7a0"/><path d="M42 40L320 216L598 40" fill="none" stroke="#97764e" stroke-width="8"/><circle cx="320" cy="218" r="96" fill="#913f43"/><circle cx="320" cy="218" r="64" fill="none" stroke="#c58374" stroke-width="7"/><path d="M397 162L365 196L411 189Z" fill="#dec7a0"/><path d="M454 127L404 166" stroke="#f5e9cd" stroke-width="4"/><circle cx="457" cy="124" r="7" fill="#f5e9cd"/>' },
  ]
  return Promise.all(drawings.map(async drawing => {
    const { body, ...metadata } = drawing
    const data = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${drawing.width}" height="${drawing.height}" viewBox="0 0 ${drawing.width} ${drawing.height}">${body}</svg>`).buffer
    const contentHash = await sha256MediaData(data)
    const asset: FrozenRuntimeMediaAssetV2 = { ...metadata, version: 1, name: drawing.altText, byteSize: data.byteLength,
      mimeType: 'image/svg+xml', contentHash, blobContentHash: contentHash, durationMs: null,
      source: 'original deterministic engineering fixture', license: 'CC0-1.0', characterTag: '', sceneTag: 'desk' }
    // Only portable metadata enters the package; the drawing body stays bytes.
    return { asset, data }
  }))
}
