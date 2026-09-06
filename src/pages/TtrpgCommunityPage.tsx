import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, ArrowRight, Dices, Play, Settings, Users } from 'lucide-react'
import { db } from '../lib/db/schema'
import { readCommunityTtrpgBundleV1, readCommunityTtrpgCatalogV1, startCommunityTtrpgGameV1, type CommunityTtrpgGameV1 } from '../lib/ttrpg/community-games'
import type { ProductRuntimeSession } from '../lib/types'
import './ttrpg-community.css'

export default function TtrpgCommunityPage() {
  const { gameKey } = useParams(), navigate = useNavigate()
  const [games, setGames] = useState<CommunityTtrpgGameV1[]>([])
  const [sessions, setSessions] = useState<ProductRuntimeSession[]>([])
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([readCommunityTtrpgCatalogV1(controller.signal), db.productRuntimeSessions.where('kind').equals('ttrpg').toArray()])
      .then(([catalog, rows]) => { if (!controller.signal.aborted) { setGames(catalog); setSessions(rows.sort((a, b) => b.updatedAt - a.updatedAt)); setLoading(false) } })
      .catch(cause => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false) } })
    return () => controller.abort()
  }, [])
  const start = async (game: CommunityTtrpgGameV1) => {
    if (busy) return
    setBusy(game.key); setError('')
    try { const bundle = await readCommunityTtrpgBundleV1(game); const sessionId = await startCommunityTtrpgGameV1(game, bundle); navigate(`/play/session/${sessionId}`) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy('') }
  }
  const visible = gameKey ? games.filter(game => game.key === gameKey) : games
  return <div className="sf-community">
    <header className="sf-community-nav"><Link to="/"><ArrowLeft size={16} />StoryForge</Link><Link to={`/settings?returnTo=${encodeURIComponent(gameKey ? `/play/${gameKey}` : '/play')}`}><Settings size={16} />API 设置</Link></header>
    <main className="sf-community-main"><div className="sf-community-intro"><span>STORYFORGE ORIGINALS</span><h1>坐下来，<br />让故事开始。</h1><p>你扮演角色，AI 担任主持人。带上自己的选择、疑问和秘密，走进一场由你改变的冒险。</p></div>
      {loading && <p role="status">正在布置游戏桌面…</p>}
      {error && <div className="sf-community-error" role="alert">{error}</div>}
      {!loading && !error && !visible.length && <p>这场冒险还未发布。你可以从已有存档继续游玩。</p>}
      <div className="sf-community-games">{visible.map(game => <article className="sf-community-game" key={game.key}>
        {game.coverPath && <img src={`${import.meta.env.BASE_URL}${game.coverPath}`} alt={game.title} />}
        <div><span className="sf-community-kicker">原创调查冒险 · {game.version}</span><h2>{game.title}</h2><strong>{game.tagline}</strong><p>{game.description}</p>
          <div className="sf-community-details"><span><Dices size={16} />约 {game.minutes} 分钟</span><span><Users size={16} />{game.playerCount}</span></div>
          <button disabled={Boolean(busy)} onClick={() => void start(game)}><Play size={17} />{busy === game.key ? '正在准备你的冒险…' : '开始一场新冒险'}<ArrowRight size={18} /></button>
          <small>需要你在本机配置可用的模型 API。游戏进度自动保存在当前浏览器。</small>
        </div></article>)}</div>
      {sessions.length > 0 && <section className="sf-community-saves"><h2>故事还在等你</h2>{sessions.map(session => <Link key={session.id} to={`/play/session/${session.id}`}><div><strong>{session.title}</strong><small>{new Date(session.updatedAt).toLocaleString('zh-CN')}</small></div><ArrowRight size={18} /></Link>)}</section>}
      <footer>原创规则与模组 · 真实骰点与持久存档 · 随时暂停</footer>
    </main>
  </div>
}
