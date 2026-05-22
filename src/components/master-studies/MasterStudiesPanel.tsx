import { useEffect, useState } from 'react'
import {
  GraduationCap, Plus, BookOpen, Lightbulb, Settings as SettingsIcon,
  FileSearch, Trash2, Loader2, AlertCircle,
} from 'lucide-react'
import MasterLegalConsentModal from './MasterLegalConsentModal'
import MasterAddWorkModal from './MasterAddWorkModal'
import MasterWorkDetail from './MasterWorkDetail'
import { useMasterStudyStore } from '../../stores/master-study'
import {
  setMasterPipelineListener,
  getActiveMasterWorkId,
} from '../../lib/master-study/pipeline'
import type { Project, MasterWork, MasterWorkStatus } from '../../lib/types'

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

  // 进入即刷新作品列表（全局学习库：不按项目过滤）
  useEffect(() => {
    if (consent === true) {
      listWorks()
    }
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
      {tab === 'insights' && <InsightsTabPlaceholder />}
      {tab === 'settings' && <SettingsTabPlaceholder />}

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

function InsightsTabPlaceholder() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-bg-elevated/30 p-10 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-bg-surface border border-border mb-3">
        <Lightbulb className="w-5 h-5 text-text-muted" />
      </div>
      <h3 className="text-base font-medium text-text-primary mb-1">手法洞察</h3>
      <p className="text-sm text-text-secondary">
        学习多本同流派作品后，系统会在这里归纳共性手法卡片。
      </p>
      <div className="inline-flex items-center gap-2 mt-3 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs">
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        将在 Phase 19-d 上线
      </div>
    </div>
  )
}

function SettingsTabPlaceholder() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-bg-elevated/30 p-10 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-bg-surface border border-border mb-3">
        <SettingsIcon className="w-5 h-5 text-text-muted" />
      </div>
      <h3 className="text-base font-medium text-text-primary mb-1">学习设置</h3>
      <p className="text-sm text-text-secondary">
        这里会放默认分析深度、停用词、批量清理等选项。
      </p>
      <div className="inline-flex items-center gap-2 mt-3 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs">
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        将在 Phase 19-c 上线
      </div>
    </div>
  )
}
