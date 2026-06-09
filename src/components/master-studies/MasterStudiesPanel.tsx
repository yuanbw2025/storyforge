import { useEffect, useState, useCallback } from 'react'
import {
  GraduationCap, Plus, BookOpen, Lightbulb, Settings as SettingsIcon,
  FileSearch, Trash2, Loader2, AlertCircle, Sparkles, ChevronDown,
  ChevronUp, Copy, Check,
} from 'lucide-react'
import MasterLegalConsentModal from './MasterLegalConsentModal'
import MasterAddWorkModal from './MasterAddWorkModal'
import MasterWorkDetail from './MasterWorkDetail'
import { useMasterStudyStore } from '../../stores/master-study'
import {
  setMasterPipelineListener,
  getActiveMasterWorkId,
  loadMasterBlob,
  registerMasterChunks,
} from '../../lib/master-study/pipeline'
import { extractTextFromFile } from '../../lib/doc-parser'
import { chunkDocument } from '../../lib/import/chunker'
import { generateInsights } from '../../lib/master-study/insight-generator'
import type { Project, MasterWork, MasterWorkStatus, MasterInsight } from '../../lib/types'

const CONSENT_KEY = 'sf-master-consent'

interface Props {
  /** 当前项目（可选：作品学习可以在项目上下文或全局使用） */
  project?: Project | null
}

type Tab = 'works' | 'insights' | 'settings'

/**
 * 作品学习主面板 —— Phase 19-a + Phase 19-b
 *
 * P19-a：法律声明 gate + 作品列表 + Tabs 占位
 * P19-b：添加作品 Modal + 作品详情页 + 五维分析报告 + ZIP 下载
 */
export default function MasterStudiesPanel({ project }: Props) {
  // consent 状态 —— null = 未决定；false = 刚拒绝（返回空页）；true = 已同意
  const [consent, setConsent] = useState<boolean | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(CONSENT_KEY) === 'agreed' ? true : null
  })

  const [tab, setTab] = useState<Tab>('works')
  const [showAddModal, setShowAddModal] = useState(false)
  const [detailWorkId, setDetailWorkId] = useState<number | null>(null)

  const { works, loading, listWorks, deleteWork } = useMasterStudyStore()

  // 进入即刷新作品列表 + Blob 恢复扫描（Phase 19-c）
  useEffect(() => {
    if (consent !== true) return
    listWorks().then(async (allWorks) => {
      const pending = allWorks.filter(
        w => w.id && (w.status === 'pending' || w.status === 'analyzing' || (w.status === 'failed' && w.progress > 0 && w.progress < 100)),
      )
      for (const w of pending) {
        if (!w.id) continue
        try {
          const blob = await loadMasterBlob(w.id)
          if (!blob) continue
          const file = new File([blob.blob], blob.filename, { type: 'text/plain' })
          const result = await extractTextFromFile(file)
          const depth = w.analysisDepth || 'standard'
          const targetChars = { quick: 40000, standard: 25000, deep: 15000 }[depth]
          const chunks = chunkDocument(result.text, { targetChars })
          registerMasterChunks(w.id, chunks)
        } catch {
          // Blob 恢复失败不阻断
        }
      }
    })
  }, [consent, listWorks])

  // 在列表页订阅 pipeline，用 listWorks 触发 progress 刷新（store 已自带更新，
  // 这里主要是保障"即使用户切走再回来"也能看到最新进度）
  useEffect(() => {
    if (consent !== true) return
    setMasterPipelineListener({
      onProgress: () => {
        // 轻量 debounce：每次进度变化 pipeline 已写 db，这里可不刷
      },
      onDone: () => {
        listWorks()
      },
    })
  }, [consent, listWorks])

  const handleAgree = () => {
    localStorage.setItem(CONSENT_KEY, 'agreed')
    setConsent(true)
  }

  const handleDecline = () => {
    setConsent(false)
  }

  const handleAddWork = () => {
    setShowAddModal(true)
  }

  const handleStartedFromModal = (workId: number) => {
    setShowAddModal(false)
    setDetailWorkId(workId)
    listWorks()
  }

  const handleDelete = async (w: MasterWork) => {
    if (!w.id) return
    if (getActiveMasterWorkId() === w.id) {
      alert('该作品正在分析中，请先取消分析再删除。')
      return
    }
    if (!confirm(`删除作品「${w.title}」？其分析报告、节奏时间线、风格画像会一并清除，此操作不可恢复。`)) return
    await deleteWork(w.id)
  }

  // ── Consent Gate ────────────────────────────────────────────────
  if (consent === null) {
    return <MasterLegalConsentModal onAgree={handleAgree} onDecline={handleDecline} />
  }

  if (consent === false) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-bg-elevated border border-border mb-4">
            <AlertCircle className="w-6 h-6 text-text-muted" />
          </div>
          <h2 className="text-lg font-semibold text-text-primary mb-2">
            您尚未同意使用须知
          </h2>
          <p className="text-sm text-text-secondary mb-4">
            作品学习功能需要您先知悉法律声明才能使用。
          </p>
          <button
            onClick={() => setConsent(null)}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm hover:opacity-90"
          >
            重新阅读使用须知
          </button>
        </div>
      </div>
    )
  }

  // ── 详情页（优先级高于 Tab） ─────────────────────────────────
  if (detailWorkId != null) {
    return (
      <MasterWorkDetail
        workId={detailWorkId}
        onBack={() => {
          setDetailWorkId(null)
          listWorks()
        }}
      />
    )
  }

  // ── Main ────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto">
      {/* 顶部标题 + 说明 */}
      <header className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-text-primary">📚 作品学习库</h1>
              <p className="text-xs text-text-muted mt-0.5">
                {project?.name ? `当前项目：${project.name}` : '全局学习库（可跨项目复用）'}
              </p>
            </div>
          </div>
          <button
            onClick={handleAddWork}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-sm hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            添加作品
          </button>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed max-w-3xl">
          上传优秀网文 / 小说样本，让 AI 从 <strong>世界观、角色设计、情节节奏、伏笔悬念、文笔</strong> 五个维度提炼创作方法论。
          分析结果会永久保留在您本地浏览器，并可打包下载完整档案。
          在自己创作时可以"引用手法"，把大师洞察注入 AI prompt 上下文。
        </p>
      </header>

      {/* Tabs */}
      <nav className="flex items-center gap-1 border-b border-border mb-4">
        <TabButton active={tab === 'works'} onClick={() => setTab('works')} icon={BookOpen} label="作品列表" />
        <TabButton active={tab === 'insights'} onClick={() => setTab('insights')} icon={Lightbulb} label="手法洞察" />
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')} icon={SettingsIcon} label="学习设置" />
      </nav>

      {/* Tab 内容 */}
      {tab === 'works' && (
        <WorksTab
          works={works}
          loading={loading}
          onAdd={handleAddWork}
          onDelete={handleDelete}
          onOpen={w => w.id && setDetailWorkId(w.id)}
        />
      )}
      {tab === 'insights' && <MasterInsightsTab works={works} />}
      {tab === 'settings' && <MasterSettingsTab works={works} onCleaned={() => listWorks()} />}

      {/* Add modal */}
      {showAddModal && (
        <MasterAddWorkModal
          projectId={project?.id ?? null}
          onClose={() => setShowAddModal(false)}
          onStarted={handleStartedFromModal}
        />
      )}
    </div>
  )
}

// ── 小组件 ─────────────────────────────────────────────────────────

function TabButton({
  active, onClick, icon: Icon, label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
        active
          ? 'border-accent text-accent'
          : 'border-transparent text-text-muted hover:text-text-primary'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  )
}

function WorksTab({
  works, loading, onAdd, onDelete, onOpen,
}: {
  works: MasterWork[]
  loading: boolean
  onAdd: () => void
  onDelete: (w: MasterWork) => void
  onOpen: (w: MasterWork) => void
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        加载中…
      </div>
    )
  }

  if (works.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-bg-elevated/30 p-10 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-bg-surface border border-border mb-3">
          <FileSearch className="w-6 h-6 text-text-muted" />
        </div>
        <h3 className="text-base font-medium text-text-primary mb-1">还没有学习过的作品</h3>
        <p className="text-sm text-text-secondary mb-4">
          上传一本想学习的作品，系统会帮您提炼它的叙事方法论。
        </p>
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-sm hover:opacity-90"
        >
          <Plus className="w-4 h-4" />
          添加第一部作品
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {works.map(w => (
        <WorkCard
          key={w.id}
          work={w}
          onOpen={() => onOpen(w)}
          onDelete={() => onDelete(w)}
        />
      ))}
    </div>
  )
}

function WorkCard({
  work, onOpen, onDelete,
}: {
  work: MasterWork
  onOpen: () => void
  onDelete: () => void
}) {
  const statusLabel: Record<MasterWorkStatus, string> = {
    pending: '待开始',
    analyzing: '分析中…',
    done: '已完成',
    failed: '失败',
  }
  const statusColor: Record<MasterWorkStatus, string> = {
    pending: 'text-text-muted bg-bg-elevated',
    analyzing: 'text-accent bg-accent/10',
    done: 'text-emerald-500 bg-emerald-500/10',
    failed: 'text-red-500 bg-red-500/10',
  }
  const depthLabel = { quick: '快速', standard: '标准', deep: '深度' }[work.analysisDepth]

  return (
    <div
      onClick={onOpen}
      className="rounded-xl border border-border bg-bg-surface p-4 hover:border-accent/40 transition-colors group cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-text-primary truncate">{work.title}</h4>
          <p className="text-xs text-text-muted mt-0.5 truncate">
            {work.author || '（未知作者）'} {work.genre ? `· ${work.genre}` : ''}
          </p>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500 transition"
          title="删除"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${statusColor[work.status]}`}>
          {statusLabel[work.status]}
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated text-text-secondary">
          {depthLabel}分析
        </span>
        <span className="text-[11px] text-text-muted">
          {(work.totalChars / 10000).toFixed(1)} 万字
        </span>
      </div>

      {work.status === 'analyzing' && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.max(0, Math.min(100, work.progress))}%` }}
            />
          </div>
          <p className="text-[11px] text-text-muted mt-1">{work.progress.toFixed(0)}%</p>
        </div>
      )}

      {work.status === 'failed' && work.errorMessage && (
        <p className="mt-2 text-[11px] text-red-500 line-clamp-2">{work.errorMessage}</p>
      )}
    </div>
  )
}

function MasterInsightsTab({ works }: { works: MasterWork[] }) {
  const { insights, listInsights, deleteInsight } = useMasterStudyStore()
  const [generating, setGenerating] = useState(false)
  const [activity, setActivity] = useState('')
  const [showGenerator, setShowGenerator] = useState(false)
  const [selectedWorkIds, setSelectedWorkIds] = useState<Set<number>>(new Set())
  const [genreFilter, setGenreFilter] = useState('')
  const [insightCount, setInsightCount] = useState(5)

  const doneWorks = works.filter(w => w.id && w.status === 'done')
  const genres = [...new Set(doneWorks.map(w => w.genre).filter(Boolean))]

  useEffect(() => { listInsights() }, [listInsights])

  const toggleWork = useCallback((id: number) => {
    setSelectedWorkIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    const filtered = genreFilter
      ? doneWorks.filter(w => w.genre === genreFilter)
      : doneWorks
    setSelectedWorkIds(new Set(filtered.map(w => w.id!)))
  }, [doneWorks, genreFilter])

  const handleGenerate = async () => {
    const ids = [...selectedWorkIds]
    if (ids.length < 2) {
      alert('请至少选择 2 本已完成分析的作品')
      return
    }
    setGenerating(true)
    setActivity('')
    try {
      await generateInsights(ids, {
        genre: genreFilter || undefined,
        insightCount,
      }, {
        onActivity: (_level, msg) => setActivity(msg),
      })
      await listInsights()
      setShowGenerator(false)
    } catch (err) {
      setActivity(`失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('删除此洞察？')) return
    await deleteInsight(id)
  }

  // 空态
  if (insights.length === 0 && !showGenerator) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-dashed border-border bg-bg-elevated/30 p-10 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-bg-surface border border-border mb-3">
            <Lightbulb className="w-5 h-5 text-text-muted" />
          </div>
          <h3 className="text-base font-medium text-text-primary mb-1">还没有手法洞察</h3>
          <p className="text-sm text-text-secondary mb-4">
            选择多本已分析完成的作品，AI 会归纳出跨作品的共性创作方法论。
          </p>
          {doneWorks.length >= 2 ? (
            <button
              onClick={() => setShowGenerator(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-sm hover:opacity-90"
            >
              <Sparkles className="w-4 h-4" />
              归纳洞察
            </button>
          ) : (
            <p className="text-xs text-text-muted">
              至少需要 2 本已完成分析的作品才能归纳（当前 {doneWorks.length} 本）
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">{insights.length} 条洞察</p>
        {doneWorks.length >= 2 && (
          <button
            onClick={() => setShowGenerator(!showGenerator)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-sm hover:opacity-90"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {showGenerator ? '收起' : '归纳新洞察'}
          </button>
        )}
      </div>

      {/* 归纳面板 */}
      {showGenerator && (
        <InsightGeneratorPanel
          doneWorks={doneWorks}
          genres={genres as string[]}
          selectedWorkIds={selectedWorkIds}
          genreFilter={genreFilter}
          insightCount={insightCount}
          generating={generating}
          activity={activity}
          onToggleWork={toggleWork}
          onSelectAll={selectAll}
          onSetGenreFilter={setGenreFilter}
          onSetInsightCount={setInsightCount}
          onGenerate={handleGenerate}
        />
      )}

      {/* 洞察卡片列表 */}
      <div className="space-y-3">
        {insights.map(insight => (
          <InsightCard key={insight.id} insight={insight} works={works} onDelete={() => insight.id && handleDelete(insight.id)} />
        ))}
      </div>
    </div>
  )
}

function InsightGeneratorPanel({
  doneWorks, genres, selectedWorkIds, genreFilter, insightCount,
  generating, activity,
  onToggleWork, onSelectAll, onSetGenreFilter, onSetInsightCount, onGenerate,
}: {
  doneWorks: MasterWork[]
  genres: string[]
  selectedWorkIds: Set<number>
  genreFilter: string
  insightCount: number
  generating: boolean
  activity: string
  onToggleWork: (id: number) => void
  onSelectAll: () => void
  onSetGenreFilter: (v: string) => void
  onSetInsightCount: (v: number) => void
  onGenerate: () => void
}) {
  const filtered = genreFilter
    ? doneWorks.filter(w => w.genre === genreFilter)
    : doneWorks

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-3">
      <h4 className="text-sm font-medium text-text-primary">选择作品归纳</h4>

      {/* 流派筛选 */}
      {genres.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-text-muted">流派：</span>
          <button
            onClick={() => onSetGenreFilter('')}
            className={`text-xs px-2 py-0.5 rounded-full border transition ${!genreFilter ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary'}`}
          >
            全部
          </button>
          {genres.map(g => (
            <button
              key={g}
              onClick={() => onSetGenreFilter(g)}
              className={`text-xs px-2 py-0.5 rounded-full border transition ${genreFilter === g ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary'}`}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {/* 作品多选 */}
      <div className="flex items-center gap-2 mb-1">
        <button onClick={onSelectAll} className="text-xs text-accent hover:underline">全选</button>
        <span className="text-xs text-text-muted">已选 {selectedWorkIds.size} / {filtered.length}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
        {filtered.map(w => (
          <label
            key={w.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-hover cursor-pointer text-sm"
          >
            <input
              type="checkbox"
              checked={selectedWorkIds.has(w.id!)}
              onChange={() => onToggleWork(w.id!)}
              className="rounded border-border"
            />
            <span className="truncate text-text-primary">{w.title}</span>
            {w.genre && <span className="text-[11px] text-text-muted shrink-0">{w.genre}</span>}
          </label>
        ))}
      </div>

      {/* 洞察数量 */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-text-muted">归纳数量：</span>
        {[3, 5, 8].map(n => (
          <button
            key={n}
            onClick={() => onSetInsightCount(n)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition ${insightCount === n ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary'}`}
          >
            {n} 条
          </button>
        ))}
      </div>

      {/* 执行按钮 */}
      <div className="flex items-center gap-3">
        <button
          onClick={onGenerate}
          disabled={generating || selectedWorkIds.size < 2}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-sm hover:opacity-90 disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {generating ? '归纳中…' : '开始归纳'}
        </button>
        {activity && <span className="text-xs text-text-muted">{activity}</span>}
      </div>
    </div>
  )
}

function InsightCard({ insight, works, onDelete }: { insight: MasterInsight; works: MasterWork[]; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const sourceNames = insight.sourceWorkIds
    .map(id => works.find(w => w.id === id)?.title)
    .filter(Boolean)

  const handleCopy = async () => {
    const text = `${insight.title}\n\n${insight.description}\n\n${insight.bulletPoints.map(b => `• ${b}`).join('\n')}`
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="rounded-xl border border-border bg-bg-surface p-4 group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
            <h4 className="font-medium text-text-primary truncate">{insight.title}</h4>
            {insight.genre && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent shrink-0">
                {insight.genre}
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted mt-1 line-clamp-2">{insight.description}</p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button onClick={handleCopy} className="p-1 rounded hover:bg-bg-hover text-text-muted" title="复制">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500 transition"
            title="删除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1 rounded hover:bg-bg-hover text-text-muted">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-border space-y-3">
          <div className="text-sm text-text-secondary whitespace-pre-wrap">{insight.description}</div>

          {insight.bulletPoints.length > 0 && (
            <ul className="space-y-1">
              {insight.bulletPoints.map((bp, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-accent mt-0.5 shrink-0">•</span>
                  <span className="text-text-primary">{bp}</span>
                </li>
              ))}
            </ul>
          )}

          {sourceNames.length > 0 && (
            <p className="text-[11px] text-text-muted">
              来源：{sourceNames.join('、')}
            </p>
          )}

          <p className="text-[11px] text-text-muted">
            创建于 {new Date(insight.createdAt).toLocaleDateString('zh-CN')}
          </p>
        </div>
      )}
    </div>
  )
}

const SETTINGS_KEY = 'sf-master-settings'

export interface MasterModelOverride {
  /** 'global' 表示跟随全局设置，其他为 provider id */
  provider: string
  model: string
}

export interface MasterSettings {
  defaultDepth: 'quick' | 'standard' | 'deep'
  autoLayer2: boolean
  /** 分析专用模型，避免全局选了贵模型导致批量分析烧钱 */
  modelOverride?: MasterModelOverride
}

const DEFAULT_SETTINGS: MasterSettings = {
  defaultDepth: 'standard',
  autoLayer2: false,
  modelOverride: undefined, // undefined = 跟随全局
}

function loadSettings(): MasterSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}

function saveSettings(s: MasterSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

export function getMasterSettings(): MasterSettings {
  return loadSettings()
}

/** 推荐的低成本模型（按 provider 分组）—— 用于学习设置模型选择 */
const RECOMMENDED_MODELS: Array<{ provider: string; model: string; label: string; hint: string }> = [
  { provider: 'global', model: '', label: '跟随全局设置', hint: '使用系统设置中的 AI 模型' },
  { provider: 'deepseek', model: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', hint: '输入 ¥1 + 输出 ¥2/百万 token，性价比最高' },
  { provider: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: '免费层不限量，付费层也很便宜' },
  { provider: 'glm', model: 'glm-4-flash', label: 'GLM-4 Flash', hint: '完全免费' },
  { provider: 'modelscope', model: 'Qwen/Qwen3-235B-A22B', label: 'ModelScope Qwen3', hint: '每天 2000 次免费（魔搭）' },
  { provider: 'qwen', model: 'qwen-plus', label: 'Qwen Plus', hint: '输入 ¥0.8 + 输出 ¥4.8/百万 token' },
  { provider: 'deepseek', model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', hint: '输入 ¥3 + 输出 ¥6/百万 token，最强但贵' },
]

function MasterSettingsTab({ works, onCleaned }: { works: MasterWork[]; onCleaned: () => void }) {
  const [settings, setSettings] = useState(loadSettings)
  const { deleteWork } = useMasterStudyStore()
  const [cleaning, setCleaning] = useState(false)

  const failedWorks = works.filter(w => w.status === 'failed')

  const update = (partial: Partial<MasterSettings>) => {
    const next = { ...settings, ...partial }
    setSettings(next)
    saveSettings(next)
  }

  const currentOverride = settings.modelOverride
  const selectedKey = currentOverride
    ? `${currentOverride.provider}:${currentOverride.model}`
    : 'global:'

  const handleCleanFailed = async () => {
    if (failedWorks.length === 0) return
    if (!confirm(`将删除 ${failedWorks.length} 个失败的作品及其分析数据，此操作不可恢复。继续？`)) return
    setCleaning(true)
    for (const w of failedWorks) {
      if (w.id) await deleteWork(w.id)
    }
    setCleaning(false)
    onCleaned()
  }

  return (
    <div className="max-w-xl space-y-6">
      {/* 分析专用模型 */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">分析专用模型</h3>
        <p className="text-xs text-text-muted mb-3">
          作品分析会分块多次调用 AI，百万字小说可能产生数百万 token 消耗。
          建议选择便宜的 Flash 模型，避免全局选了贵模型导致批量分析烧钱。
        </p>
        <div className="grid gap-2">
          {RECOMMENDED_MODELS.map(m => {
            const key = `${m.provider}:${m.model}`
            const active = selectedKey === key
            return (
              <button
                key={key}
                onClick={() => {
                  if (m.provider === 'global') {
                    update({ modelOverride: undefined })
                  } else {
                    update({ modelOverride: { provider: m.provider, model: m.model } })
                  }
                }}
                className={`text-left px-3 py-2.5 rounded-lg border transition ${
                  active
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-bg-base hover:border-accent/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${active ? 'text-accent' : 'text-text-primary'}`}>
                    {m.label}
                  </span>
                  {active && <Check className="w-4 h-4 text-accent" />}
                </div>
                <p className="text-[11px] text-text-muted mt-0.5">{m.hint}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* 默认分析深度 */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-2">默认分析深度</h3>
        <p className="text-xs text-text-muted mb-3">新建作品时的预选深度。</p>
        <div className="flex gap-2">
          {(['quick', 'standard', 'deep'] as const).map(d => {
            const labels = { quick: '快速', standard: '标准', deep: '深度' }
            const active = settings.defaultDepth === d
            return (
              <button
                key={d}
                onClick={() => update({ defaultDepth: d })}
                className={`px-4 py-2 rounded-lg border text-sm transition ${
                  active
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-secondary hover:border-accent/40'
                }`}
              >
                {labels[d]}
              </button>
            )
          })}
        </div>
      </div>

      {/* 自动 Layer 2 */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-2">Layer 2 分析</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <div
            onClick={() => update({ autoLayer2: !settings.autoLayer2 })}
            className={`w-10 h-6 rounded-full transition-colors relative ${
              settings.autoLayer2 ? 'bg-accent' : 'bg-bg-elevated border border-border'
            }`}
          >
            <div
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                settings.autoLayer2 ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </div>
          <div>
            <span className="text-sm text-text-primary">Layer 1 完成后自动运行风格量化</span>
            <p className="text-xs text-text-muted">本地计算，不消耗 AI token</p>
          </div>
        </label>
      </div>

      {/* 批量清理 */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-2">数据清理</h3>
        <button
          onClick={handleCleanFailed}
          disabled={cleaning || failedWorks.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border text-sm text-text-primary hover:bg-bg-hover disabled:opacity-50"
        >
          {cleaning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          清理失败作品（{failedWorks.length} 个）
        </button>
      </div>
    </div>
  )
}
