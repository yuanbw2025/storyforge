import {useEffect, useRef, useState} from 'react'
import type {CharacterInteractionRuntimeState, ProductRuntimeSession, WorkspaceScope} from '../../lib/types'
import {productRuntimeSourceForSessionV1, resolveProductRuntimeSource} from '../../lib/product-production/preview-source'
import {chatMediaFrameV1} from '../../lib/character-interaction/media-contract'
import {planChatRuntimeVisualsV1} from '../../lib/character-interaction/runtime-visual-context'
import {generateChatRuntimeVisualsV1, readChatRuntimeVisualJobsV1, latestChatVisualJobsV1} from '../../lib/character-interaction/runtime-visuals'
import {db} from '../../lib/db/schema'
import {readProductMediaBlobData} from '../../lib/product-production/media-blob-store'

export interface ChatImageView {url: string; alt: string}
export interface ChatMediaView {
  background: ChatImageView | null
  avatars: Record<string, ChatImageView>
  portraits: Array<ChatImageView & {participantKey: string; name: string}>
  missing: number
  illustration?: ChatImageView | null
  runtime?: {running: boolean; paused: boolean; issue: string; count: number; toggle: () => void; update: () => void; retry?: () => void}
}
const empty = (): ChatMediaView => ({background: null, avatars: {}, portraits: [], missing: 0})

/** Resolves the selected save's immutable source, never a newer library release.
 * A changed save/location hides obsolete URLs synchronously, before effects run. */
export function useChatMedia(input: {scope?: WorkspaceScope; session: ProductRuntimeSession | null; interaction: CharacterInteractionRuntimeState | null; enabled: boolean; busy?: boolean}): ChatMediaView {
  const {scope, session, interaction, enabled} = input, scene = interaction?.activeScene
  const [refresh, setRefresh] = useState(0), [running, setRunning] = useState(false), [issue, setIssue] = useState('')
  const [paused, setPaused] = useState(false)
  const observed = useRef<{sessionId: number | undefined; sequence: number} | null>(null)
  const controller = useRef<AbortController | null>(null)
  const sequence = interaction?.chatNarrative?.lastEventSequence ?? 0
  useEffect(() => {
    setPaused(localStorage.getItem(`storyforge:chat-visual-paused:${session?.id}`) === 'true')
    setIssue(''); observed.current = {sessionId: session?.id, sequence: interaction ? sequence : -1}
    setRunning(false)
    return () => {controller.current?.abort()}
  }, [session?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- mounting/restoring a save never starts a provider request
  const identity = JSON.stringify({enabled, scope, sessionId: session?.id, sourceHash: session?.runtimeSourceHash,
    releaseId: session?.productReleaseId, buildId: session?.productBuildId, sequence, refresh,
    scene: scene && {key: scene.sceneKey, location: scene.location, participants: scene.activeParticipantKeys}})
  const [loaded, setLoaded] = useState<{identity: string; view: ChatMediaView; runtimeAllowed?: boolean; count?: number; issue?: string; canRetry?: boolean}>({identity: '', view: empty()})
  const update = (retryFailed = false) => {
    if (!scope || !session?.id || running || input.busy) return
    const abort = new AbortController(); controller.current = abort
    setRunning(true); setIssue('')
    void generateChatRuntimeVisualsV1({scope, sessionId: session.id, signal: abort.signal, retryFailed, onProgress: () => {if (controller.current === abort) setRefresh(value => value + 1)}})
      .catch(cause => {if (!abort.signal.aborted) setIssue(cause instanceof Error ? cause.message : '画面暂不可用，可继续聊天')})
      .finally(() => {if (controller.current === abort) {setRunning(false); setRefresh(value => value + 1)}})
  }
  useEffect(() => {
    if (!enabled || input.busy || running || loaded.identity !== identity || !loaded.runtimeAllowed) return
    const before = observed.current
    observed.current = {sessionId: session?.id, sequence}
    if (!paused && before && before.sequence >= 0 && before.sessionId === session?.id && sequence > before.sequence) update()
  }, [identity, loaded.identity, loaded.runtimeAllowed, enabled, input.busy, running, paused, sequence, session?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- only a newly committed live turn triggers generation
  useEffect(() => {
    if (!enabled || !scope || !session || !interaction) return
    let cancelled = false, resolver: Awaited<ReturnType<typeof resolveProductRuntimeSource>>['mediaResolver'] | null = null
    const runtimeUrls: string[] = []
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
      let missing = catalog.failures.length
      let background = image(frame.backgroundAssetKey), illustration: ChatImageView | null = null, count = 0, canRetry = false, currentIssue = ''
      const design = pkg.interaction?.chatVisualDesign
      if (design?.runtime.enabled) {
        const current = await planChatRuntimeVisualsV1(design, interaction)
        if (current.requests.some(request => request.kind === 'background')) background = null
        const jobs = await readChatRuntimeVisualJobsV1(scope, session.id!)
        count = jobs.length
        const latest = latestChatVisualJobsV1(jobs)
        for (const request of current.requests) {
          const job = latest.get(request.key)
          if (job?.issue) currentIssue ||= job.issue
          if (job && job.status !== 'available') {
            currentIssue ||= '有图片请求的结果尚未确认；没有自动重发。'
            canRetry ||= job.status === 'failed' && jobs.filter(item => item.request.key === request.key).length < 3 && count < design.runtime.maximumImages
          }
          if (!job?.asset || job.status !== 'available') continue
          const blob = await db.productMediaBlobs.where('mediaAssetId').equals(job.asset.id!).first()
          if (!blob) {missing++; continue}
          const data = await readProductMediaBlobData({scope, blob, expected: job.asset}).catch(() => null)
          if (!data) {missing++; continue}
          if (cancelled) return
          const url = URL.createObjectURL(new Blob([data], {type: job.asset.mimeType})); runtimeUrls.push(url)
          const picture = {url, alt: job.asset.altText}
          if (request.kind === 'background') background = picture
          else if (request.kind === 'cg') illustration = picture
          else {
            const portrait = portraits.find(person => person.participantKey === request.participantKey)
            if (portrait) Object.assign(portrait, picture)
          }
        }
      }
      if (!cancelled) setLoaded({identity, view: {background, avatars, portraits, illustration, missing}, runtimeAllowed: !!design?.runtime.enabled, count, canRetry, issue: currentIssue})
    })().catch(() => {if (!cancelled) setLoaded({identity, view: {...empty(), missing: 1}})}).finally(() => {if (cancelled) resolver?.dispose()})
    return () => {cancelled = true; resolver?.dispose(); runtimeUrls.forEach(url => URL.revokeObjectURL(url))}
  }, [identity]) // eslint-disable-line react-hooks/exhaustive-deps -- identity binds every source and selection used by this read
  const view = loaded.identity === identity ? loaded.view : empty()
  return loaded.identity === identity && loaded.runtimeAllowed ? {...view, runtime: {running, paused, issue: issue || loaded.issue || '', count: loaded.count ?? 0,
    update: () => update(), retry: loaded.canRetry ? () => update(true) : undefined,
    toggle: () => {localStorage.setItem(`storyforge:chat-visual-paused:${session?.id}`, String(!paused)); setPaused(!paused); if (!paused) controller.current?.abort()}}} : view
}
