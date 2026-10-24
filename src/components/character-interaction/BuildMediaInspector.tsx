import {useEffect, useMemo, useState} from 'react'
import type {ProductRuntimePackageV1, WorkspaceScope} from '../../lib/types'
import {resolveProductRuntimeSource} from '../../lib/product-production/preview-source'
import {ChatImage} from './ChatMedia'
import {createChatMediaReviewSourceV1} from '../../lib/character-interaction/media-selection'

/** Author-only inspection of the selected Build. Looking at an image does not
 * confirm it, publish it or grant a character/player new knowledge. */
export default function BuildMediaInspector({scope, buildId, previewHash, pkg}: {
  scope: WorkspaceScope; buildId: number; previewHash: string; pkg: ProductRuntimePackageV1
}) {
  const identity = JSON.stringify({scope, buildId, previewHash})
  const [loaded, setLoaded] = useState<{identity: string; urls: Record<string, string>; failures: Record<string, string>; error: string} | null>(null)
  const current = loaded?.identity === identity ? loaded : null
  const assets = pkg.presentation?.assets ?? [], bindings = pkg.interaction?.chatMedia
  const metadataIssue = useMemo(() => {
    if (!pkg.interaction?.chatMedia || !pkg.presentation?.assets.length) return ''
    try {createChatMediaReviewSourceV1(pkg.interaction, pkg.presentation.assets); return ''}
    catch (cause) {return cause instanceof Error ? cause.message : String(cause)}
  }, [pkg])
  useEffect(() => {
    if (!bindings || !assets.length) return
    let active = true, resolver: Awaited<ReturnType<typeof resolveProductRuntimeSource>>['mediaResolver'] | null = null
    void (async () => {
      const resolved = await resolveProductRuntimeSource({scope, source: {kind: 'build', productBuildId: buildId, expectedPreviewHash: previewHash}})
      resolver = resolved.mediaResolver
      if (!active) return
      const catalog = await resolver.preload({assetKeys: resolved.runtimePackage.presentation?.assets.map(asset => asset.assetKey) ?? [], maximumBytes: 32 * 1024 * 1024})
      if (active) setLoaded({identity, urls: catalog.urls, failures: Object.fromEntries(catalog.failures.map(f => [f.assetKey, f.reason])), error: ''})
    })().catch(cause => {if (active) setLoaded({identity, urls: {}, failures: {}, error: String(cause)})}).finally(() => {if (!active) resolver?.dispose()})
    return () => {active = false; resolver?.dispose()}
  }, [identity]) // eslint-disable-line react-hooks/exhaustive-deps -- immutable Build preview hash binds the package
  if (!bindings || !assets.length) return <p>当前版本为纯文字角色聊天，不含图片或音频。生成的人物与场景内容可在对应页查看。</p>
  return <div data-testid="chat-build-media">
    <p>查看当前生成版本的图片、用途与许可。此处查看不会确认或发布素材。</p>
    {metadataIssue && <p role="alert">图片信息不完整：{metadataIssue}</p>}
    {current?.error && <p role="alert">图片暂不可用：{current.error}</p>}
    <div className="grid gap-4 sm:grid-cols-2">{assets.map(asset => {
      const uses = [
        ...bindings.participants.flatMap(binding => {
          const name = pkg.interaction!.profiles.find(profile => profile.participantKey === binding.participantKey)!.name
          return [...(binding.avatarAssetKey === asset.assetKey ? [`${name} · 头像`] : []), ...(binding.portraitAssetKey === asset.assetKey ? [`${name} · 在场立绘`] : [])]
        }),
        ...bindings.scenes.filter(scene => scene.backgroundAssetKey === asset.assetKey).map(scene => `${scene.location} · 场景背景`),
      ]
      return <article key={asset.assetKey} className="min-w-0 rounded border border-border p-3">
        <h4>{asset.name}</h4><p>{uses.join('；')}</p>
        <ChatImage image={current?.urls[asset.assetKey] ? {url: current.urls[asset.assetKey], alt: asset.altText} : null}
          className="max-h-72 w-full object-contain" fallback={<p>{!current ? '正在校验图片…' : '图片暂不可用，文字内容仍可查看。'}</p>}/>
        {current?.failures[asset.assetKey] && <p role="status">{current.failures[asset.assetKey]}</p>}
        <details><summary>素材信息</summary><p>来源：{asset.source}</p><p>许可：{asset.license}</p><p>{asset.width} × {asset.height} · {asset.mimeType} · {asset.byteSize} 字节</p><p className="break-all">{asset.contentHash}</p></details>
      </article>
    })}</div>
  </div>
}
