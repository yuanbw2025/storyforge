import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, ArrowRight, BookOpen, Loader2, Play } from 'lucide-react'
import { db } from '../lib/db/schema'
import { mistHarborAdventure, mistHarborAvg } from '../lib/mist-harbor/production'
import { mistTitle, type MistHarborEdition } from '../lib/mist-harbor/compiler'
import { createAvgGameInstance, createTextAdventureInstance } from '../lib/product/runtime-instances'
import type { Project, WorkspaceScope } from '../lib/types'
import './mist-harbor.css'
const AvgPlayer = lazy(() => import('../components/text-game/AvgGamePlayer'))
const AdventurePlayer = lazy(() => import('../components/text-game/AdventureGamePlayer'))
type Player = { project: Project; scope: WorkspaceScope; initialSessionId: number }
export default function MistHarborPage() {
  const [edition, setEdition] = useState<MistHarborEdition>('avg')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [resumeId, setResumeId] = useState<number | null>(null)
  const [worldProjectId, setWorldProjectId] = useState<number | null>(null)
  const [player, setPlayer] = useState<Player | null>(null)
  useEffect(() => {
    let cancelled = false
    setResumeId(null)
    void (async () => {
      try {
        const installed = await (edition === 'avg' ? mistHarborAvg : mistHarborAdventure).findInstalled()
        if (!installed || cancelled) return
        const sessions = await db.productRuntimeSessions
          .where('productReleaseId')
          .equals(installed.releaseId)
          .toArray()
        const latest = sessions
          .filter((row) => row.status !== 'archived')
          .sort((a, b) => b.updatedAt - a.updatedAt)[0]
        if (!cancelled) {
          setResumeId(latest?.id ?? null)
          setWorldProjectId(installed.scope.projectId)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [edition, player])
  async function start(resume: boolean) {
    if (busy) return
    setBusy(true)
    setError('')
    setProgress('正在准备雾港…')
    try {
      const installed = await (edition === 'avg' ? mistHarborAvg : mistHarborAdventure).install(setProgress)
      const project = await db.projects.get(installed.scope.projectId)
      if (!project) throw new Error('雾港工作区不存在，请重试。')
      const saved = resume && resumeId != null ? await db.productRuntimeSessions.get(resumeId) : null
      if (saved && saved.productReleaseId !== installed.releaseId) throw new Error('存档与当前作品不匹配。')
      const session =
        saved ??
        (await (edition === 'avg' ? createAvgGameInstance : createTextAdventureInstance)({
          scope: installed.scope,
          productReleaseId: installed.releaseId,
          title: mistTitle(edition),
        }))
      setWorldProjectId(installed.scope.projectId)
      setPlayer({ project, scope: installed.scope, initialSessionId: session.id! })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      setProgress('')
    }
  }
  return (
    <main className="mist-page">
      <header className="mist-nav">
        <Link to="/">
          <ArrowLeft size={16} /> 返回故事熔炉
        </Link>
        <span>STORYFORGE ORIGINALS</span>
        {worldProjectId != null && (
          <Link to={`/workspace/${worldProjectId}`}>
            <BookOpen size={16} /> 查看雾港原稿
          </Link>
        )}
      </header>
      {player ? (
        <section className="mist-playing">
          <div className="mist-player-header">
            <h1>{mistTitle(edition)}</h1>
            <button onClick={() => setPlayer(null)}>返回作品介绍</button>
          </div>
          <Suspense fallback={<p role="status">正在打开故事…</p>}>
            {edition === 'avg' ? (
              <AvgPlayer {...player} worldGroupId={null} />
            ) : (
              <AdventurePlayer {...player} worldGroupId={null} />
            )}
          </Suspense>
        </section>
      ) : (
        <>
          <section className="mist-hero" aria-labelledby="mist-title">
            <img
              className="mist-backdrop"
              src={`${import.meta.env.BASE_URL}demo-assets/mist-harbor/mist-bg-harbor.webp`}
              alt="盐雾中的雾港码头与远处灯塔"
            />
            <div className="mist-hero-content">
              <span className="mist-kicker">一夜 · 一座城 · 三种回答</span>
              <h1 id="mist-title">
                雾港<span>失潮钟声</span>
              </h1>
              <p className="mist-lead">
                潮汐迟到了十三分钟。
                <br />
                而这座城，正在忘记你的名字。
              </p>
              <p className="mist-description">
                提起旧铜灯，成为守灯人林澈。穿过潮灯集市与封闭档案馆，找回四十七个被抹去的名字。在最后一声钟响之前，决定雾港愿意付出什么代价。
              </p>
              <div className="mist-facts">
                <span>18 个叙事节点</span>
                <span>3 条结局</span>
                <span>无需 API</span>
              </div>
            </div>
          </section>
          <section className="mist-selection" aria-label="选择雾港玩法">
            <div className="mist-editions">
              <button
                className={edition === 'avg' ? 'selected' : ''}
                aria-pressed={edition === 'avg'}
                onClick={() => {
                  setEdition('avg')
                  setError('')
                }}
                disabled={busy}
              >
                <span>VISUAL NOVEL</span>
                <h2>视觉小说</h2>
                <p>看见雾港。原版背景、角色立绘与结局插画，逐句阅读，作出选择。</p>
              </button>
              <button
                className={edition === 'adventure' ? 'selected' : ''}
                aria-pressed={edition === 'adventure'}
                onClick={() => {
                  setEdition('adventure')
                  setError('')
                }}
                disabled={busy}
              >
                <span>TEXT ADVENTURE</span>
                <h2>文字冒险</h2>
                <p>走进雾港。观察、交谈、收集证据，再亲手打开通往钟楼的路。</p>
              </button>
            </div>
            <div className="mist-start">
              <div>
                <p>完整预写故事 · 无模型调用或配音</p>
                <small>首次开始会在本机准备独立作品；自动保存进度，从头开始会另建存档。</small>
              </div>
              <div className="mist-start-buttons">
                {resumeId != null && (
                  <button disabled={busy} onClick={() => void start(true)}>
                    <Play size={16} />
                    继续游玩
                  </button>
                )}
                <button className="primary" disabled={busy} onClick={() => void start(false)}>
                  {busy ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}{' '}
                  {resumeId != null ? '从头开始' : '开始故事'}
                </button>
              </div>
            </div>
            {busy && (
              <p role="status" className="mist-message">
                {progress}
              </p>
            )}
            {error && (
              <p role="alert" className="mist-message mist-error">
                {error} 已有内容与存档会保留，可重试。
              </p>
            )}
          </section>
        </>
      )}
    </main>
  )
}
