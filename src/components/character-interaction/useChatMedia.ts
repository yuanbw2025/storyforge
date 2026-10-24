import {useEffect, useState} from 'react'
import type {CharacterInteractionRuntimeState, ProductRuntimeSession, WorkspaceScope} from '../../lib/types'
import {productRuntimeSourceForSessionV1, resolveProductRuntimeSource} from '../../lib/product-production/preview-source'
import {chatMediaFrameV1} from '../../lib/character-interaction/media-contract'

export interface ChatImageView {url: string; alt: string}
export interface ChatMediaView {
  background: ChatImageView | null
  avatars: Record<string, ChatImageView>
  portraits: Array<ChatImageView & {participantKey: string; name: string}>
  missing: number
}
const empty = (): ChatMediaView => ({background: null, avatars: {}, portraits: [], missing: 0})

/** Resolves the selected save's immutable source, never a newer library release.
 * A changed save/location hides obsolete URLs synchronously, before effects run. */
export function useChatMedia(input: {scope?: WorkspaceScope; session: ProductRuntimeSession | null; interaction: CharacterInteractionRuntimeState | null; enabled: boolean}): ChatMediaView {
  const {scope, session, interaction, enabled} = input, scene = interaction?.activeScene
  const identity = JSON.stringify({enabled, scope, sessionId: session?.id, sourceHash: session?.runtimeSourceHash,
    releaseId: session?.productReleaseId, buildId: session?.productBuildId,
    scene: scene && {key: scene.sceneKey, location: scene.location, participants: scene.activeParticipantKeys}})
  const [loaded, setLoaded] = useState<{identity: string; view: ChatMediaView}>({identity: '', view: empty()})
  useEffect(() => {
    if (!enabled || !scope || !session || !interaction) return
    let cancelled = false, resolver: Awaited<ReturnType<typeof resolveProductRuntimeSource>>['mediaResolver'] | null = null
    void (async () => {
      const source = await productRuntimeSourceForSessionV1(session)
      if (cancelled) return
      const resolved = await resolveProductRuntimeSource({scope, source})
      resolver = resolved.mediaResolver
      if (cancelled) return
      if (resolved.runtimeSourceHash !== session.runtimeSourceHash || resolved.runtimePackage.productType !== 'character-interaction') throw new Error('会话图片来源不匹配')
      const pkg = resolved.runtimePackage, bindings = pkg.interaction?.chatMedia
      if (!bindings) {setLoaded({identity, view: empty()}); return}
      const frame = chatMediaFrameV1(pkg, interaction)
      const keys = [frame.backgroundAssetKey, ...bindings.participants.map(p => p.avatarAssetKey), ...frame.participants.map(p => p.portraitAssetKey)].filter((key): key is string => key != null)
      const catalog = await resolver.preload({assetKeys: keys, maximumBytes: 32 * 1024 * 1024})
      if (cancelled) return
      const image = (key: string | null): ChatImageView | null => key && catalog.urls[key]
        ? {url: catalog.urls[key], alt: pkg.presentation!.assets.find(asset => asset.assetKey === key)!.altText} : null
      const avatars: ChatMediaView['avatars'] = {}, portraits: ChatMediaView['portraits'] = []
      for (const person of bindings.participants) {
        const avatar = image(person.avatarAssetKey)
        if (avatar) avatars[person.participantKey] = avatar
      }
      for (const person of frame.participants) {
        const portrait = image(person.portraitAssetKey)
        if (portrait) portraits.push({...portrait, participantKey: person.participantKey, name: pkg.interaction!.profiles.find(p => p.participantKey === person.participantKey)!.name})
      }
      setLoaded({identity, view: {background: image(frame.backgroundAssetKey), avatars, portraits, missing: catalog.failures.length}})
    })().catch(() => {if (!cancelled) setLoaded({identity, view: {...empty(), missing: 1}})}).finally(() => {if (cancelled) resolver?.dispose()})
    return () => {cancelled = true; resolver?.dispose()}
  }, [identity]) // eslint-disable-line react-hooks/exhaustive-deps -- identity binds every source and selection used by this read
  return loaded.identity === identity ? loaded.view : empty()
}
