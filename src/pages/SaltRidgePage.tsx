import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowLeft,
  ArrowRight,
  Backpack,
  BookOpen,
  Compass,
  Loader2,
  Map,
  Play,
  Shield,
  Swords,
} from 'lucide-react'
import { db } from '../lib/db/schema'
import {
  SALT_RIDGE_SHOWCASE_TITLE,
  saltRidgeShowcase,
} from '../lib/salt-ridge/production'
import { createTextOpenWorldInstance } from '../lib/product/runtime-instances'
import type { Project, WorkspaceScope } from '../lib/types'
import './salt-ridge.css'

const TextOpenWorldPlayer = lazy(() => import('../components/text-game/TextOpenWorldPlayer'))

type Player = {
  project: Project
  scope: WorkspaceScope
  initialSessionId: number
}

export default function SaltRidgePage() {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [resumeId, setResumeId] = useState<number | null>(null)
  const [workspaceProjectId, setWorkspaceProjectId] = useState<number | null>(null)
  const [player, setPlayer] = useState<Player | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const installed = await saltRidgeShowcase.findInstalled()
        if (!installed || cancelled) return
        const sessions = await db.productRuntimeSessions
          .where('productReleaseId')
          .equals(installed.releaseId)
          .toArray()
        const latest = sessions
          .filter(row => row.status !== 'archived')
          .sort((left, right) => right.updatedAt - left.updatedAt)[0]
        if (!cancelled) {
          setResumeId(latest?.id ?? null)
          setWorkspaceProjectId(installed.scope.projectId)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { cancelled = true }
  }, [player])

  async function start(resume: boolean) {
    if (busy) return
    setBusy(true)
    setError('')
    setProgress('正在准备盐脊…')
    try {
      const installed = await saltRidgeShowcase.install(setProgress)
      const project = await db.projects.get(installed.scope.projectId)
      if (!project) throw new Error('盐脊工作区不存在，请重试。')
      const saved = resume && resumeId != null
        ? await db.productRuntimeSessions.get(resumeId)
        : null
      if (saved && saved.productReleaseId !== installed.releaseId) {
        throw new Error('存档与当前盐脊版本不匹配。')
      }
      const session = saved ?? await createTextOpenWorldInstance({
        scope: installed.scope,
        productReleaseId: installed.releaseId,
        title: `${SALT_RIDGE_SHOWCASE_TITLE} · 旅程`,
      })
      setWorkspaceProjectId(installed.scope.projectId)
      setPlayer({ project, scope: installed.scope, initialSessionId: session.id! })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  return <main className="salt-ridge-page" data-testid="salt-ridge-showcase">
    <header className="salt-ridge-nav">
      <Link to="/"><ArrowLeft size={16} />返回故事熔炉</Link>
      <span>STORYFORGE ORIGINALS · TEXT OPEN WORLD</span>
      {workspaceProjectId != null && <Link to={`/workspace/${workspaceProjectId}`}>
        <BookOpen size={16} />查看盐脊来源
      </Link>}
    </header>

    {player ? <section className="salt-ridge-playing">
      <div className="salt-ridge-player-header">
        <div><small>正在游玩</small><h1>{SALT_RIDGE_SHOWCASE_TITLE}</h1></div>
        <button type="button" onClick={() => setPlayer(null)}>返回作品介绍</button>
      </div>
      <Suspense fallback={<p role="status" className="salt-ridge-status">正在打开盐脊世界…</p>}>
        <TextOpenWorldPlayer {...player} worldGroupId={null} />
      </Suspense>
    </section> : <>
      <section className="salt-ridge-hero" aria-labelledby="salt-ridge-title">
        <div className="salt-ridge-landscape" aria-hidden="true">
          <div className="salt-ridge-sun" />
          <div className="salt-ridge-mountain salt-ridge-mountain-far" />
          <div className="salt-ridge-mountain salt-ridge-mountain-near" />
          <div className="salt-ridge-canal" />
          <span className="salt-ridge-place place-port">盐港</span>
          <span className="salt-ridge-place place-ridge">断脊</span>
        </div>
        <div className="salt-ridge-hero-copy">
          <span className="salt-ridge-kicker">一封来信 · 两片土地 · 两种未来</span>
          <h1 id="salt-ridge-title">盐脊<span>断流之夜</span></h1>
          <p className="salt-ridge-lead">潮脉正在干涸，而两地都认为自己才是被牺牲的那一个。</p>
          <p>循着失踪测潮师的来信来到盐港。探索断脊、追查盐渠、帮助居民，在战斗与交易中成长，最后决定水将如何重新流动。</p>
          <div className="salt-ridge-facts">
            <span>2 个开放地区</span><span>任务与随机事件</span><span>2 个结局</span><span>无需 API</span>
          </div>
        </div>
      </section>

      <section className="salt-ridge-overview" aria-label="盐脊玩法介绍">
        <header>
          <small>完整系统纵向样板</small>
          <h2>从踏上码头，到作出最后的治理选择</h2>
          <p>这是一部可完整通关的展示作品，用来证明文字开放世界的核心游玩闭环。当前内容约 20—30 分钟，不代表未来正式世界的体量上限。</p>
        </header>
        <div className="salt-ridge-feature-grid">
          <article><Map /><h3>自由探索</h3><p>在盐港与断脊之间旅行，使用地图、道路与快速旅行点。</p></article>
          <article><Compass /><h3>多层任务</h3><p>主线会等待玩家，普通委托、地区发牌和随机事件继续运转。</p></article>
          <article><Swords /><h3>回合战斗</h3><p>普通攻击、技能、道具与逃跑都由确定性规则结算。</p></article>
          <article><Backpack /><h3>成长经营</h3><p>升级、装备、材料、配方、制作、买卖形成同一套资源循环。</p></article>
          <article><Shield /><h3>关系反馈</h3><p>道德和阵营态度影响问候、价格与局部事件，但不破坏主线可达性。</p></article>
          <article><BookOpen /><h3>自由表达</h3><p>系统行动、固定选项和自然语言共享同一行动结果；越界意图会被清楚引导。</p></article>
        </div>
      </section>

      <section className="salt-ridge-start" aria-label="开始盐脊">
        <div>
          <small>首次开始会在本机建立独立作品、冻结来源并发布正式版本</small>
          <h2>准备好踏上白盐码头了吗？</h2>
          <p>自动保存旅程。重新开始会建立一条新的时间线，不覆盖旧存档。</p>
        </div>
        <div className="salt-ridge-start-actions">
          {resumeId != null && <button type="button" disabled={busy} onClick={() => void start(true)}>
            <Play size={17} />继续最近旅程
          </button>}
          <button type="button" className="primary" disabled={busy} onClick={() => void start(false)}>
            {busy ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}
            {resumeId != null ? '开启新旅程' : '安装并开始'}
          </button>
        </div>
        {busy && <p role="status" className="salt-ridge-status">{progress}</p>}
        {error && <p role="alert" className="salt-ridge-status salt-ridge-error">{error} 已有内容和存档会保留，可以重试。</p>}
      </section>
    </>}
  </main>
}
