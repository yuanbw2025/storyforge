import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronRight, Compass, Play, Save, Trash2 } from 'lucide-react'
import { resolveProductRuntimeSource } from '../../lib/product-production/preview-source'
import { currentPlayerReleases } from '../../lib/text-game/player-library'
import type { AdventureProductRuntimePackageV1, ProductMediaResolverV1, ProductRuntimeSourceV1, WorkspaceScope } from '../../lib/types'
import { useAdventureGamePlayerStore } from '../../stores/adventure-game-player'
import './adventure-showcase.css'

interface ShelfItem {
  key: string
  title: string
  manifest: AdventureProductRuntimePackageV1 | null
  source: ProductRuntimeSourceV1
  edition: string
  error: string
}

function clean(value?: string) { return (value ?? '').replace(/\*\*/gu, '').trim() }

function synopsis(item: ShelfItem) {
  const description = clean(item.manifest?.definition.description).split('；本轮演化：')[0]
  const story = description.includes('有后果的选择；') ? description.split('有后果的选择；')[1] : description
  return story.split('。玩家')[0].replace(/[。；]+$/u, '') + (story ? '。' : '') || '循着故事的线索，踏上一段属于你的旅程。'
}


function Cover({ item, scope }: { item: ShelfItem; scope: WorkspaceScope }) {
  const [url, setUrl] = useState('')
  const openingBeats = new Set(item.manifest?.narrative.beats.filter(beat => beat.nodeKey === item.manifest?.narrative.entryNodeKey).map(beat => beat.beatKey))
  const openingAsset = item.manifest?.presentation?.cues.filter(cue => openingBeats.has(cue.beatKey))
    .map(cue => item.manifest?.presentation?.assets.find(asset => asset.assetKey === cue.assetKey))
    .find(asset => asset?.kind === 'background' || asset?.kind === 'cg')
  const asset = item.manifest?.presentation?.assets.find(row => row.sceneTag === 'cover-opening')
    ?? openingAsset
    ?? item.manifest?.presentation?.assets.find(row => row.kind === 'background' || row.kind === 'cg')
  useEffect(() => {
    let active = true
    let resolver: ProductMediaResolverV1 | null = null
    setUrl('')
    if (!asset) return
    void (async () => {
      const result = await resolveProductRuntimeSource({ scope, source: item.source })
      resolver = result.mediaResolver
      if (!active) { resolver.dispose(); return }
      const loaded = await resolver.preload({ assetKeys: [asset.assetKey], maximumBytes: 16 * 1024 * 1024 })
      if (active) setUrl(loaded.urls[asset.assetKey] ?? '')
      else resolver.dispose()
    })().catch(() => { resolver?.dispose() })
    return () => { active = false; resolver?.dispose() }
  }, [asset, item.source, scope])
  return <div className={`adventure-cover${url ? ' has-art' : ''}`} aria-hidden="true">
    {url ? <img src={url} alt="" /> : <div className="adventure-cover-symbol"><Compass /><span>STORIES<br />BEYOND THE PAGE</span></div>}
  </div>
}

export default function AdventureLibrary(props: {
  scope: WorkspaceScope
  error: string
  onOpenSession: (id: number) => void
  onRemoveSession: (id: number, title: string) => Promise<void>
}) {
  const store = useAdventureGamePlayerStore()
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const [localError, setLocalError] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const editions = useMemo<ShelfItem[]>(() => [
    ...store.previews.map(item => ({
      key: `build:${item.buildId}`, title: clean(item.manifest?.definition.title) || item.title,
      manifest: item.manifest, source: { kind: 'build' as const, productBuildId: item.buildId, expectedPreviewHash: item.previewHash },
      edition: `创作试玩 #${item.buildNumber} · 尚未发布`, error: item.error,
    })),
    ...currentPlayerReleases(store.releases).map(item => ({
      key: `release:${item.release.id}`, title: clean(item.manifest?.definition.title) || item.release.label,
      manifest: item.manifest, source: { kind: 'release' as const, productReleaseId: item.release.id! },
      edition: `正式版本 · ${item.release.version}`, error: item.error,
    })),
  ], [store.previews, store.releases])
  const items = editions.filter((item, index) => editions.findIndex(candidate => candidate.title === item.title) === index)
  const detail = editions.find(item => item.key === detailKey)
  const featured = detail ?? items.find(item => item.manifest && !item.error)
  const matchingSessions = featured ? store.sessions.filter(session => featured.source.kind === 'build'
    ? session.productBuildId === featured.source.productBuildId
    : session.productReleaseId === featured.source.productReleaseId) : []
  const latest = matchingSessions.find(session => !store.completedSessionEndingKeys[session.id!]) ?? matchingSessions[0]
  const start = async (item: ShelfItem) => {
    setLocalError('')
    try {
      const id = item.source.kind === 'build'
        ? await store.startPreview(item.source.productBuildId)
        : await store.start(item.source.productReleaseId)
      props.onOpenSession(id)
    } catch (cause) { if (mounted.current) setLocalError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const open = async (id: number) => {
    await store.select(id)
    if (useAdventureGamePlayerStore.getState().selectedSessionId === id) props.onOpenSession(id)
  }
  const endings = featured?.manifest?.narrative.nodes.filter(node => node.kind === 'ending').length ?? 0
  return <div className="adventure-showcase" data-testid="adventure-game-player">
    <div className="adventure-shelf-heading">
      {detail ? <button className="adventure-text-button" onClick={() => setDetailKey(null)}><ArrowLeft />返回全部游戏</button>
        : <><span className="adventure-eyebrow">STORYFORGE / INTERACTIVE FICTION</span><h1>下一段故事，由你选择。</h1><p>走进一个世界，让每一次选择留下回响。</p></>}
    </div>
    {(props.error || localError) && <div role="alert" className="adventure-alert"><p>{localError || props.error}</p>
      <button className="adventure-secondary" onClick={() => void store.load(props.scope, store.worldGroupId, true)}>刷新作品库</button>
    </div>}
    {featured && <section className={`adventure-feature${detail ? ' is-detail' : ''}`} aria-label={detail ? '文字冒险游戏详情' : '推荐冒险'}>
      <Cover key={featured.key} item={featured} scope={props.scope} />
      <div className="adventure-feature-copy">
        <span className="adventure-edition"><span />{featured.edition}</span>
        <p className="adventure-eyebrow">{detail ? 'YOUR STORY STARTS HERE' : '走进故事 / FEATURED ADVENTURE'}</p>
        <h2>{featured.title}</h2>
        <p className="adventure-feature-description">{synopsis(featured)}</p>
        <div className="adventure-story-tags"><span><BookOpen />互动叙事</span><span><Compass />自由探索</span>{endings > 1 && <span>{endings} 种故事结局</span>}</div>
        {featured.error ? <p role="alert">版本暂不可用：{featured.error}</p> : <div className="adventure-feature-actions">
          {detail ? <>
            {latest && <button className="adventure-primary" disabled={store.busy || store.loading} onClick={() => void open(latest.id!)}><Play />{store.completedSessionEndingKeys[latest.id!] ? '查看通关记录' : '继续上次进度'}<ChevronRight /></button>}
            <button className={latest ? 'adventure-secondary' : 'adventure-primary'} disabled={!featured.manifest || store.busy} onClick={() => void start(featured)}><Play />{store.busy ? '正在开启旅程…' : '开始新冒险'}</button>
          </> : <button className="adventure-primary" aria-label={`探索作品：${featured.title}`} onClick={() => setDetailKey(featured.key)}>探索这部作品<ArrowUpRight /></button>}
        </div>}
        {detail && <small className="adventure-start-note">进度自动保存在此设备。新的旅程会建立独立存档。</small>}
      </div>
      <span className="adventure-feature-number" aria-hidden="true">{detail ? 'THE JOURNEY' : '01 / DISCOVER'}</span>
    </section>}
    {detail && editions.filter(item => item.title === detail.title).length > 1 && <label className="adventure-edition-select">游玩版本
      <select aria-label="游玩版本" value={detail.key} onChange={event => setDetailKey(event.target.value)}>
        {editions.filter(item => item.title === detail.title).map(item => <option key={item.key} value={item.key}>{item.edition}</option>)}
      </select>
      <span>不同版本的存档各自保留。</span>
    </label>}
    {detail ? <div className="adventure-detail-footer">
      <div><span className="adventure-eyebrow">HOW TO PLAY</span><h3>读故事，做选择，发现另一种可能。</h3></div>
      <p>观察现场、与角色交谈、收集线索。你可以选择行动，也可以输入自己的想法。故事推进时会自动记录进度，随时回来继续。</p>
    </div> : <>
      <div className="adventure-section-heading"><h2>全部游戏</h2><span>{items.length} 部可游玩作品</span></div>
      <section className="adventure-book-grid" aria-label="文字冒险游戏列表">
        {items.map((item, index) => <article key={item.key}><button aria-label={`查看游戏：${item.title}`} onClick={() => setDetailKey(item.key)}>
          <div className="adventure-book-art"><Cover item={item} scope={props.scope} /><span>{String(index + 1).padStart(2, '0')}</span><ArrowUpRight /></div>
          <div className="adventure-book-copy"><small>{item.edition}</small><h3>{item.title}</h3><p>{item.error ? '版本校验未通过，查看详情' : synopsis(item)}</p><span>查看作品 <ChevronRight /></span></div>
        </button></article>)}
        {!items.length && <div className="adventure-library-empty"><Compass /><h3>故事正等待启程</h3><p>在创作工作台完成可验证试玩或发布后，作品就会出现在这里。</p></div>}
      </section>
      {!!store.sessions.length && <details className="adventure-saved-journeys"><summary><Save />冒险存档<span>{store.sessions.length} 份存档</span></summary>
        <div>{store.sessions.map(session => <article key={session.id}><button disabled={store.loading || store.busy} onClick={() => void open(session.id!)}><strong>{session.title}</strong><small>{new Date(session.updatedAt).toLocaleString('zh-CN')} · {store.completedSessionEndingKeys[session.id!] ? '已通关' : '可继续'}</small></button><button aria-label="删除冒险存档" onClick={() => void props.onRemoveSession(session.id!, session.title)}><Trash2 /></button></article>)}</div>
      </details>}
    </>}
    <footer className="adventure-shelf-footer"><span>STORYFORGE</span><p>每个世界，都有尚未写下的答案。</p><Compass /></footer>
  </div>
}
