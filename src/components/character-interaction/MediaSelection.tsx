import {useEffect, useState} from 'react'
import type {ProductBuildRecordV1, WorkspaceScope} from '../../lib/types'
import {readCurrentChatMediaReviewV1} from '../../lib/product-production/chat-media-authority'
import {parseChatMediaBindingsV1} from '../../lib/character-interaction/media-contract'
import type {ChatMediaProductionDecisionV1, ChatMediaReviewSourceV1} from '../../lib/character-interaction/media-selection'

/** Suggestions are presentation bindings only; a successful explicit command
 * is still required before any package may use them. */
function suggestedBindings(source: ChatMediaReviewSourceV1) {
  return parseChatMediaBindingsV1({schema: 'storyforge.chat-media', version: 1,
    participants: source.interaction.profiles.flatMap(profile => {
      const assets = source.assets.filter(asset => ['character-pose', 'character-expression'].includes(asset.kind)
        && [profile.characterKey, profile.participantKey].includes(asset.characterTag))
      if (!assets.length) return []
      if (assets.length !== 1) throw new Error('同一角色有多张图片，需要重新检查当前制作')
      return [{participantKey: profile.participantKey, avatarAssetKey: assets[0].assetKey, portraitAssetKey: assets[0].assetKey}]
    }),
    scenes: source.interaction.sceneTemplates.flatMap(scene => {
      const assets = source.assets.filter(asset => asset.kind === 'background' && asset.sceneTag === scene.sceneKey)
      if (!assets.length) return []
      if (assets.length !== 1) throw new Error('同一场景有多张背景，需要重新检查当前制作')
      return [{sceneKey: scene.sceneKey, location: scene.location, backgroundAssetKey: assets[0].assetKey}]
    }),
  }, source.interaction, source.assets)
}

export default function MediaSelection({scope, build, disabled, onConfirm}: {
  scope: WorkspaceScope; build: ProductBuildRecordV1; disabled: boolean
  onConfirm: (decision: ChatMediaProductionDecisionV1) => void
}) {
  const identity = JSON.stringify({scope, id: build.id, buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: build.planHash})
  const [loaded, setLoaded] = useState<{identity: string; review: Awaited<ReturnType<typeof readCurrentChatMediaReviewV1>>;
    decision: ChatMediaProductionDecisionV1; urls: Record<string, string>; ready: string[]; failed: string[]} | null>(null)
  const [failure, setFailure] = useState<{identity: string; message: string} | null>(null)
  const current = loaded?.identity === identity ? loaded : null
  useEffect(() => {
    let active = true
    const urls: string[] = []
    void (async () => {
      const review = await readCurrentChatMediaReviewV1({scope, build})
      if (!active) return
      const decision = {buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, sourceHash: review.sourceHash, bindings: suggestedBindings(review.source)}
      const byAsset: Record<string, string> = {}
      for (const image of review.images) {
        const url = URL.createObjectURL(new Blob([image.bytes], {type: image.asset.mimeType}))
        urls.push(url); byAsset[image.asset.assetKey] = url
      }
      setLoaded({identity, review, decision, urls: byAsset, ready: [], failed: []})
    })().catch(cause => {
      urls.splice(0).forEach(url => URL.revokeObjectURL(url))
      if (active) setFailure({identity, message: cause instanceof Error ? cause.message : String(cause)})
    })
    return () => {active = false; urls.splice(0).forEach(url => URL.revokeObjectURL(url))}
  }, [identity]) // eslint-disable-line react-hooks/exhaustive-deps -- exact Build/epoch identity; command rechecks current original bytes
  const mark = (assetKey: string, failed: boolean) => setLoaded(previous => previous?.identity === identity ? {...previous,
    ready: failed ? previous.ready.filter(key => key !== assetKey) : [...new Set([...previous.ready, assetKey])],
    failed: failed ? [...new Set([...previous.failed, assetKey])] : previous.failed.filter(key => key !== assetKey),
  } : previous)
  const allVisible = !!current && current.ready.length === current.review.images.length && !current.failed.length
  return <section className="mt-3 rounded border border-accent/40 bg-accent/5 p-4 text-xs" data-testid="chat-media-selection">
    <h3 className="font-semibold">确认角色和开场图片</h3>
    <p className="mt-2 text-text-muted">请检查原图、人物外观和用途。确认后，图片才会进入本次聊天版本。若不合适，可取消本次制作，修改公开画面描述后重新开始。</p>
    {failure?.identity === identity && <p role="alert" className="mt-2 text-error">图片无法确认：{failure.message}</p>}
    {!current && failure?.identity !== identity && <p role="status">正在读取并校验当前原图…</p>}
    <div className="mt-3 grid gap-3 sm:grid-cols-2">{current?.review.images.map(({asset}) => {
      const participant = current.decision.bindings.participants.find(binding => binding.avatarAssetKey === asset.assetKey)
      const role = participant && current.review.source.interaction.profiles.find(profile => profile.participantKey === participant.participantKey)
      const scene = current.decision.bindings.scenes.find(binding => binding.backgroundAssetKey === asset.assetKey)
      return <article key={asset.assetKey} className="min-w-0 rounded border border-border bg-bg-base p-3">
        <h4 className="font-semibold">{role ? `${role.name} · 头像与在场立绘` : `${scene?.location} · 开场背景`}</h4>
        <img src={current.urls[asset.assetKey]} alt={asset.altText} className="mt-2 max-h-80 w-full object-contain"
          onLoad={() => mark(asset.assetKey, false)} onError={() => mark(asset.assetKey, true)}/>
        {current.failed.includes(asset.assetKey) && <p role="alert">原图无法显示，请重新打开制作页检查。</p>}
        <p className="mt-2 break-words">来源：{asset.source}</p><p className="break-words">许可：{asset.license}</p>
        <details className="mt-2"><summary>图片信息</summary><p>{asset.width} × {asset.height} · {asset.byteSize} 字节</p><p className="break-all">{asset.contentHash}</p></details>
      </article>
    })}</div>
    <button className="mt-4 rounded bg-accent px-3 py-2 text-white disabled:opacity-40" disabled={disabled || !allVisible}
      onClick={() => {if (current && allVisible && !disabled) onConfirm(structuredClone(current.decision))}}>确认这些图片与用途并继续</button>
  </section>
}
