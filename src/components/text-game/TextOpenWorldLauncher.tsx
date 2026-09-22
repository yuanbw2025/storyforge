import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Clock3,
  Gamepad2,
  Globe2,
  Loader2,
  MapPinned,
  PackageCheck,
  Play,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { classifyTextOpenWorldPlayerIssueV1 } from '../../lib/open-world/player-resilience'
import {
  currentTextOpenWorldReleasesV1,
  summarizeTextOpenWorldReleaseV1,
  textOpenWorldReleaseVersionsV1,
} from '../../lib/open-world/player-library'
import type { WorkspaceScope } from '../../lib/types'
import { useTextOpenWorldPlayerStore } from '../../stores/text-open-world-player'
import { useDialog } from '../shared/Dialog'
import TextOpenWorldPlayerStateNotice from './TextOpenWorldPlayerStateNotice'
import './player-roadshow.css'

function dateLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp))
}

function hashLabel(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 12)}…${hash.slice(-4)}` : hash
}

function statusLabel(status: string): string {
  if (status === 'active') return '进行中'
  if (status === 'paused') return '已暂停'
  if (status === 'completed') return '已完成'
  if (status === 'archived') return '已归档'
  return status
}

export default function TextOpenWorldLauncher(props: {
  scope: WorkspaceScope
  worldGroupId: number | null
}) {
  const store = useTextOpenWorldPlayerStore()
  const dialog = useDialog()
  const [catalogReleaseId, setCatalogReleaseId] = useState<number | null>(null)
  const detailBackRef = useRef<HTMLButtonElement>(null)
  const catalogRef = useRef<HTMLElement>(null)
  const catalogReturnIdRef = useRef<number | null>(null)
  const formalSessions = useMemo(() => store.sessions.filter(session => (
    session.productReleaseId != null && session.productBuildId == null
  )), [store.sessions])
  const catalog = useMemo(() => currentTextOpenWorldReleasesV1(store.releases), [store.releases])
  const summaries = useMemo(() => new Map(store.releases.flatMap(item => {
    if (!item.manifest || !item.packageHash || item.release.id == null) return []
    return [[item.release.id, summarizeTextOpenWorldReleaseV1({
      release: item.release,
      manifest: item.manifest,
      packageHash: item.packageHash,
    })] as const]
  })), [store.releases])
  const releaseById = useMemo(() => new Map(store.releases.flatMap(item => (
    item.release.id == null ? [] : [[item.release.id, item] as const]
  ))), [store.releases])
  const selectedRelease = store.releases.find(item => item.release.id === catalogReleaseId) ?? null
  const selectedSummary = selectedRelease?.release.id == null
    ? null : summaries.get(selectedRelease.release.id) ?? null
  const selectedVersions = selectedRelease
    ? textOpenWorldReleaseVersionsV1(store.releases, selectedRelease.release.productionKey)
    : []
  const selectedReleaseSessions = selectedRelease?.release.id == null
    ? [] : formalSessions.filter(session => session.productReleaseId === selectedRelease.release.id)
  const libraryIssue = useMemo(() => store.issue ?? classifyTextOpenWorldPlayerIssueV1({
    error: store.error,
    surface: 'library-load',
  }), [store.error, store.issue])
  const selectedReleaseIssue = useMemo(() => classifyTextOpenWorldPlayerIssueV1({
    error: selectedRelease?.error ?? '',
    surface: 'runtime-load',
  }), [selectedRelease?.error])

  useEffect(() => {
    if (catalogReleaseId != null && !store.releases.some(item => item.release.id === catalogReleaseId)) {
      setCatalogReleaseId(null)
    }
  }, [store.releases, catalogReleaseId])

  useEffect(() => {
    if (selectedRelease) queueMicrotask(() => detailBackRef.current?.focus())
  }, [selectedRelease])

  const openRelease = (releaseId: number | null) => {
    if (releaseId == null) return
    catalogReturnIdRef.current = releaseId
    setCatalogReleaseId(releaseId)
  }
  const closeRelease = () => {
    const releaseId = catalogReturnIdRef.current
    setCatalogReleaseId(null)
    queueMicrotask(() => catalogRef.current
      ?.querySelector<HTMLButtonElement>(`[data-release-id="${releaseId ?? ''}"]`)
      ?.focus())
  }

  const run = async (operation: () => Promise<unknown>) => {
    try { await operation() } catch { /* Store exposes a recoverable error. */ }
  }
  const remove = async (sessionId: number, title: string) => {
    const confirmed = await dialog.confirm({
      title: `删除存档“${title}”？`,
      message: '该时间线及其私有事件、检查点会被删除；不可变游戏发布和其它存档不会受影响。',
      confirmText: '删除存档',
      cancelText: '保留',
      tone: 'danger',
    })
    if (confirmed) await store.remove(sessionId)
  }

  return <div
    className="avg-title-screen open-world-launcher"
    data-testid="text-open-world-player"
    aria-busy={store.loading || undefined}
  >
    <div className="avg-title-atmosphere open-world-launcher-atmosphere" aria-hidden="true" />
    <main className="avg-title-content open-world-launcher-content">
      <span className="avg-title-kicker"><Globe2 />STORYFORGE · TEXT OPEN WORLD</span>
      <h2>{selectedRelease ? '游戏详情' : '文字开放世界游戏库'}</h2>
      <p>{selectedRelease
        ? '确认主角、世界规模与冻结版本，再开始一条新的冒险时间线。'
        : '从正式发布开始开放世界旅程；新游戏和每一个旧存档都精确绑定自己的不可变版本。'}</p>

      {libraryIssue && <TextOpenWorldPlayerStateNotice
        issue={libraryIssue}
        compact
        primaryLabel="重新加载游戏库"
        onPrimary={() => void run(() => store.load(props.scope, props.worldGroupId))}
      />}

      {store.loading && store.releases.length === 0 && store.sessions.length === 0
        ? <div className="avg-title-empty" data-testid="text-open-world-library-loading">
          <Loader2 className="animate-spin" /><span>正在核验游戏发布与存档…</span>
        </div>
        : selectedRelease ? <section className="textgame-title-page open-world-title-page" aria-label="文字开放世界游戏详情">
          <button ref={detailBackRef} type="button" className="textgame-catalog-back" onClick={closeRelease}>
            <ArrowLeft />返回全部游戏
          </button>
          <div className="textgame-title-art open-world-title-art" aria-hidden="true">
            <MapPinned /><span>OPEN<br />WORLD</span>
          </div>
          <div className="textgame-title-copy">
            <small>文字开放世界 · Release v{selectedRelease.release.version} · {selectedSummary?.shapeLabel ?? '发布损坏'}</small>
            <h3>{selectedSummary?.title ?? selectedRelease.release.label}</h3>
            <p>{selectedSummary?.description ?? '这个发布未通过完整性校验，不能用于创建新游戏。'}</p>
            {selectedSummary && <>
              <div className="textgame-player-role"><i>{selectedSummary.protagonistName.slice(0, 1)}</i><span>
                <small>本次冒险的主角</small><strong>{selectedSummary.protagonistName}</strong>
                <p>{selectedSummary.protagonistDescription || '由当前发布冻结的玩家角色。'}</p>
              </span></div>
              <div className="textgame-title-stats">
                <span>{selectedSummary.regionCount} 个地区</span>
                <span>{selectedSummary.locationCount} 个地点</span>
                <span>{selectedSummary.questCount} 项任务</span>
                <span>{selectedSummary.actorCount} 名世界角色</span>
              </div>
              <div className="open-world-release-evidence">
                <span><CalendarDays />发布于 {dateLabel(selectedRelease.release.createdAt)}</span>
                <span><PackageCheck />运行包 {hashLabel(selectedSummary.packageHash)}</span>
                <span><PackageCheck />Release {hashLabel(selectedSummary.releaseHash)}</span>
                <span><Globe2 />来源 {hashLabel(selectedSummary.sourceHash)}</span>
              </div>
            </>}
            {selectedVersions.length > 1 && <div className="open-world-release-versions" aria-label="发布版本">
              <small>选择不可变版本</small>
              <div>{selectedVersions.map(item => <button
                key={item.release.id ?? item.release.contentHash}
                type="button"
                aria-pressed={item.release.id === selectedRelease.release.id}
                disabled={store.loading || store.busy}
                onClick={() => setCatalogReleaseId(item.release.id ?? null)}
              >v{item.release.version}{item.error ? ' · 损坏' : ''}</button>)}</div>
            </div>}
            {selectedReleaseIssue
              ? <TextOpenWorldPlayerStateNotice
                issue={selectedReleaseIssue}
                compact
                primaryLabel="重新核对版本"
                onPrimary={() => void run(() => store.load(props.scope, props.worldGroupId))}
                secondaryLabel="返回全部游戏"
                onSecondary={closeRelease}
              />
              : <div className="textgame-title-actions">
                <button type="button" className="textgame-start" disabled={!selectedRelease.manifest || store.loading || store.busy}
                  onClick={() => void run(() => store.start(selectedRelease.release.id!))}>
                  <Plus />新旅程
                </button>
                {selectedReleaseSessions[0] && <button type="button" disabled={store.loading || store.busy}
                  onClick={() => void run(() => store.select(selectedReleaseSessions[0]!.id!))}>
                  <Play />继续最近存档
                </button>}
              </div>}
          </div>
        </section> : <>
          <div className="textgame-catalog-heading"><span>当前可玩版本</span><small>{catalog.filter(item => item.manifest).length} 部作品</small></div>
          <section ref={catalogRef} className="textgame-catalog-list" aria-label="文字开放世界游戏列表">
            {catalog.map(item => {
              const summary = item.release.id == null ? null : summaries.get(item.release.id) ?? null
              return <article key={item.release.id ?? item.release.contentHash}>
                <button type="button" aria-label={`查看游戏：${summary?.title ?? item.release.label}`}
                  data-release-id={item.release.id ?? undefined}
                  disabled={store.loading || store.busy}
                  onClick={() => openRelease(item.release.id ?? null)}>
                  <span className="textgame-catalog-icon open-world-catalog-icon"><Globe2 /></span>
                  <span className="textgame-catalog-copy">
                    <small>Release v{item.release.version} · {summary?.shapeLabel ?? '完整性校验失败'}</small>
                    <strong>{summary?.title ?? item.release.label}</strong>
                    <p>{summary?.description ?? '这个版本未通过完整性核对，暂时不能开始新旅程。'}</p>
                    {summary && <i>{summary.regionCount} 地区 · {summary.locationCount} 地点 · {summary.questCount} 任务 · 主角 {summary.protagonistName}</i>}
                  </span>
                  <span className="textgame-catalog-open">查看详情<ChevronRight /></span>
                </button>
              </article>
            })}
            {!catalog.length && <div className="avg-title-empty" data-testid="text-open-world-library-empty">
              <Globe2 /><span>还没有正式发布的文字开放世界</span>
              <small>请先在“制作”中完成构建与发布；制作预览不会混入正式游戏库。</small>
            </div>}
          </section>

          {formalSessions.length > 0 && <section className="open-world-launcher-saves" aria-label="正式存档">
            <header><div><Save /><span><strong>继续游戏</strong><small>旧存档继续绑定各自的 Release，不会被静默升级</small></span></div><small>{formalSessions.length} 条时间线</small></header>
            <div className="open-world-save-grid">{formalSessions.map(session => {
              const releaseItem = session.productReleaseId == null ? null : releaseById.get(session.productReleaseId) ?? null
              const summary = session.productReleaseId == null ? null : summaries.get(session.productReleaseId) ?? null
              return <article key={session.id}>
                <button type="button" className="open-world-save-open" disabled={store.loading || store.busy}
                  onClick={() => void run(() => store.select(session.id!))}>
                  <span><Gamepad2 /><strong>{session.title}</strong></span>
                  <p>{summary?.title ?? releaseItem?.release.label ?? '发布不可用'} · Release v{releaseItem?.release.version ?? '?'}</p>
                  <small><Clock3 />更新于 {dateLabel(session.updatedAt)} · {statusLabel(session.status)}</small>
                </button>
                <button type="button" aria-label={`删除存档：${session.title}`} disabled={store.loading || store.busy}
                  onClick={() => void run(() => remove(session.id!, session.title))}><Trash2 /></button>
              </article>
            })}</div>
          </section>}
        </>}
    </main>
  </div>
}
