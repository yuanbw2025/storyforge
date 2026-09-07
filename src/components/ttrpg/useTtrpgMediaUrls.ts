import { useEffect, useState } from 'react'
import { resolveProductRuntimeSource } from '../../lib/product-production/preview-source'
import { readTtrpgRuntimeMediaBlobV1 } from '../../lib/ttrpg/runtime-media'
import type { ProductRuntimeSourceV1, WorkspaceScope } from '../../lib/types'
import type { TtrpgViewerProjectionV1 } from '../../lib/ttrpg/viewer-projection'

/** Only resolve slots already allowed by the viewer projection; discard old viewer URLs synchronously. */
export function useTtrpgMediaUrls(input: {
  scope: WorkspaceScope
  sessionId: number
  source: ProductRuntimeSourceV1 | null
  viewerKey: string | null
  media: TtrpgViewerProjectionV1['media']
}) {
  const identity = JSON.stringify({ scope: input.scope, sessionId: input.sessionId, source: input.source,
    viewerKey: input.viewerKey, slots: input.media?.slots })
  const [loaded, setLoaded] = useState<{ identity: string; urls: Record<string, string> }>({ identity: '', urls: {} })
  useEffect(() => {
    if (!input.source || !input.viewerKey || !input.media) return
    const { scope, sessionId, source, viewerKey, media } = input
    let cancelled = false
    const objectUrls: string[] = []
    let resolver: Awaited<ReturnType<typeof resolveProductRuntimeSource>>['mediaResolver'] | null = null
    const dispose = () => { objectUrls.forEach(url => URL.revokeObjectURL(url)); resolver?.dispose() }
    void (async () => {
      const urls: Record<string, string> = {}
      const keys = media.slots.flatMap(slot => slot.status === 'available' && slot.mediaAssetId == null && slot.assetKey ? [slot.assetKey] : [])
      if (keys.length) {
        resolver = (await resolveProductRuntimeSource({ scope, source })).mediaResolver
        const catalog = await resolver.preload({ assetKeys: [...new Set(keys)], maximumBytes: 100 * 1024 * 1024 })
        for (const slot of media.slots) if (slot.assetKey && catalog.urls[slot.assetKey]) urls[slot.slotKey] = catalog.urls[slot.assetKey]
      }
      for (const slot of media.slots) {
        if (cancelled) return
        if (slot.status !== 'available' || slot.mediaAssetId == null) continue
        try {
          const blob = await readTtrpgRuntimeMediaBlobV1({ scope, sessionId, viewerKey, mediaAssetId: slot.mediaAssetId })
          const url = URL.createObjectURL(blob)
          objectUrls.push(url); urls[slot.slotKey] = url
        } catch { /* A missing or unauthorized image leaves the text presentation usable. */ }
      }
      if (!cancelled) setLoaded({ identity, urls })
    })().catch(() => { if (!cancelled) setLoaded({ identity, urls: {} }) }).finally(() => { if (cancelled) dispose() })
    return () => { cancelled = true; dispose() }
  }, [identity]) // eslint-disable-line react-hooks/exhaustive-deps -- identity freezes every field used by this load
  return loaded.identity === identity ? loaded.urls : {}
}
