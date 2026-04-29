import { useState, useRef } from 'react'
import {
  Download, Upload, FileJson, FileText, FileType,
  Loader2, CheckCircle, AlertCircle, FolderOpen, X,
  History, Plus, Trash2, RotateCcw, HardDrive,
  Sparkles, Brain,
} from 'lucide-react'
import { exportProjectJSON, downloadJSON, importProjectJSON, type ProjectExportData } from '../../lib/export/json-export'
import { exportProjectMarkdown, exportProjectTXT, downloadTextFile } from '../../lib/export/text-export'
import { useFileSystemAccess, isFSASupported, type FSAHandle } from '../../hooks/useFileSystemAccess'
import { useBackupStore } from '../../stores/backup'
import { useToast } from '../shared/Toast'
import type { Project, Snapshot } from '../../lib/types'

type Tab = 'export' | 'backup' | 'ai-import'
type ExportStatus = 'idle' | 'loading' | 'success' | 'error'

interface Props {
  project: Project
  onImported?: (newProjectId: number) => void
}

export default function DataManagementPanel({ project, onImported }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('export')

  const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'export',    label: '导出 / 导入', icon: FileJson },
    { id: 'backup',    label: '版本历史',    icon: History },
    { id: 'ai-import', label: 'AI 解析导入', icon: Brain },
  ]

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-1">数据管理</h2>
        <p className="text-sm text-text-muted">备份、恢复、导出正文，以及 AI 辅助解析导入设定文档。</p>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 bg-bg-elevated rounded-xl p-1 w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-bg-surface text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'export'    && <ExportTab    project={project} onImported={onImported} />}
      {activeTab === 'backup'    && <BackupTab    project={project} onImported={onImported} />}
      {activeTab === 'ai-import' && <AIImportTab  project={project} />}
    </div>
  )
}

// ── 导出/导入 Tab ────────────────────────────────────────────
function ExportTab({ project, onImported }: Props) {
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [message, setMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { handle, writing, pickDirectory, writeFile, clearHandle } = useFileSystemAccess()

  const show = (s: ExportStatus, msg: string) => {
    setStatus(s); setMessage(msg)
    if (s === 'success') setTimeout(() => setStatus('idle'), 4000)
  }

  const handleExportJSON = async () => {
    try {
      show('loading', '正在导出 JSON...')
      const data = await exportProjectJSON(project.id!)
      downloadJSON(data, `${project.name}_${new Date().toISOString().slice(0, 10)}.json`)
      show('success', 'JSON 导出成功！')
    } catch (e) { show('error', `导出失败：${(e as Error).message}`) }
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      show('loading', '正在导入项目...')
      const data: ProjectExportData = JSON.parse(await file.text())
      const newId = await importProjectJSON(data)
      show('success', '导入成功！')
      onImported?.(newId)
    } catch (err) { show('error', `导入失败：${(err as Error).message}`) }
    e.target.value = ''
  }

  const handleExportMarkdown = async () => {
    try {
      show('loading', '正在导出 Markdown...')
      const md = await exportProjectMarkdown(project.id!)
      downloadTextFile(md, `${project.name}_${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown')
      show('success', 'Markdown 导出成功！')
    } catch (e) { show('error', `导出失败：${(e as Error).message}`) }
  }

  const handleExportTXT = async () => {
    try {
      show('loading', '正在导出 TXT...')
      const txt = await exportProjectTXT(project.id!)
      downloadTextFile(txt, `${project.name}_${new Date().toISOString().slice(0, 10)}.txt`)
      show('success', 'TXT 导出成功！')
    } catch (e) { show('error', `导出失败：${(e as Error).message}`) }
  }

  const handleBindFolder = async () => {
    const fsaHandle = await pickDirectory()
    if (!fsaHandle) return
    await handleSaveToFolder(fsaHandle)
  }

  const handleSaveToFolder = async (fsaHandle?: FSAHandle | null) => {
    try {
      show('loading', '正在写入本地文件夹...')
      const data = await exportProjectJSON(project.id!)
      const filename = `storyforge-${project.name.replace(/[/\\?%*:|"<>]/g, '-')}.json`
      const ok = await writeFile(filename, JSON.stringify(data, null, 2), fsaHandle)
      if (ok) show('success', `已保存到本地文件夹 / ${filename}`)
      else show('error', '写入失败，请重新绑定文件夹')
    } catch (e) { show('error', `写入失败：${(e as Error).message}`) }
  }

  return (
    <div className="space-y-4">
      {status !== 'idle' && (
        <StatusBar status={status} message={message} />
      )}

      {/* JSON */}
      <SectionCard
        icon={<FileJson className="w-5 h-5 text-accent" />}
        title="JSON（完整备份）"
        desc="导出包含所有数据的完整备份文件，可用于恢复项目。"
      >
        <div className="flex gap-3 flex-wrap">
          <ActionButton onClick={handleExportJSON} disabled={status === 'loading'} variant="accent">
            <Download className="w-4 h-4" /> 导出 JSON
          </ActionButton>
          <ActionButton onClick={() => fileInputRef.current?.click()} disabled={status === 'loading'} variant="default">
            <Upload className="w-4 h-4" /> 导入 JSON
          </ActionButton>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileSelected} className="hidden" />
        </div>
      </SectionCard>

      {/* Markdown */}
      <SectionCard
        icon={<FileText className="w-5 h-5 text-blue-400" />}
        title="Markdown（正文导出）"
        desc="按大纲结构导出所有章节正文。"
      >
        <ActionButton onClick={handleExportMarkdown} disabled={status === 'loading'} variant="blue">
          <Download className="w-4 h-4" /> 导出 Markdown
        </ActionButton>
      </SectionCard>

      {/* TXT */}
      <SectionCard
        icon={<FileType className="w-5 h-5 text-yellow-400" />}
        title="纯文本 TXT"
        desc="适合直接发布到小说平台。"
      >
        <ActionButton onClick={handleExportTXT} disabled={status === 'loading'} variant="yellow">
          <Download className="w-4 h-4" /> 导出 TXT
        </ActionButton>
      </SectionCard>

      {/* 本地文件夹 */}
      <SectionCard
        icon={<FolderOpen className="w-5 h-5 text-orange-400" />}
        title="本地文件夹自动保存"
        desc="绑定本地文件夹，将项目 JSON 实时写入磁盘。"
        badge={!isFSASupported() ? '仅 Chrome/Edge 支持' : undefined}
      >
        {handle ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
              <FolderOpen className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate">已绑定：{handle.path}</span>
              <button onClick={clearHandle} className="text-text-muted hover:text-text-primary"><X className="w-4 h-4" /></button>
            </div>
            <ActionButton onClick={() => handleSaveToFolder()} disabled={writing || status === 'loading'} variant="orange">
              {writing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {writing ? '写入中...' : '立即保存'}
            </ActionButton>
          </div>
        ) : (
          <ActionButton onClick={handleBindFolder} disabled={!isFSASupported() || status === 'loading'} variant="orange">
            <FolderOpen className="w-4 h-4" /> 选择本地文件夹
          </ActionButton>
        )}
      </SectionCard>
    </div>
  )
}

// ── 版本历史 Tab ─────────────────────────────────────────────
function BackupTab({ project }: Props) {
  const { snapshots, loading, loadSnapshots, createSnapshot, deleteSnapshot, restoreSnapshot } = useBackupStore()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState<number | null>(null)
  const [label, setLabel] = useState('')
  const [showForm, setShowForm] = useState(false)

  useState(() => { loadSnapshots(project.id!) })

  const handleCreate = async () => {
    setCreating(true)
    try {
      await createSnapshot(project.id!, label.trim() || `手动备份 ${new Date().toLocaleString('zh-CN')}`, 'manual')
      toast.success('快照创建成功')
      setLabel(''); setShowForm(false)
    } catch (err) {
      toast.error('快照创建失败: ' + (err as Error).message)
    } finally { setCreating(false) }
  }

  const handleRestore = async (snap: Snapshot) => {
    if (!confirm(`确定从快照「${snap.label}」恢复？\n将创建一个新项目（不覆盖当前项目）`)) return
    setRestoring(snap.id!)
    try {
      await restoreSnapshot(snap.id!)
      toast.success('恢复成功，已创建新项目')
    } catch (err) { toast.error('恢复失败: ' + (err as Error).message) }
    finally { setRestoring(null) }
  }

  return (
    <div className="space-y-4">
      {/* 新建快照 */}
      <div className="bg-bg-surface border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-accent" />
            <span className="text-sm font-medium text-text-primary">创建快照</span>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-xs text-accent hover:text-accent-hover transition-colors"
          >
            {showForm ? '收起' : '+ 新建'}
          </button>
        </div>
        {showForm && (
          <div className="flex gap-2">
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="快照备注（可选）"
              className="flex-1 px-3 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
            />
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              创建
            </button>
          </div>
        )}
      </div>

      {/* 快照列表 */}
      <div className="space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-8 text-text-muted">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
          </div>
        )}
        {!loading && snapshots.length === 0 && (
          <div className="text-center text-text-muted text-sm py-10">
            <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
            暂无快照，创建第一个吧
          </div>
        )}
        {snapshots.map(snap => (
          <div key={snap.id} className="bg-bg-surface border border-border rounded-lg p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{snap.label}</p>
              <p className="text-xs text-text-muted">{new Date(snap.createdAt).toLocaleString('zh-CN')}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => handleRestore(snap)}
                disabled={restoring === snap.id}
                title="从此快照恢复"
                className="p-1.5 text-text-muted hover:text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
              >
                {restoring === snap.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              </button>
              <button
                onClick={() => deleteSnapshot(snap.id!)}
                title="删除快照"
                className="p-1.5 text-text-muted hover:text-error rounded hover:bg-error/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── AI 解析导入 Tab ──────────────────────────────────────────
function AIImportTab({ project: _project }: { project: Project }) {
  return (
    <div className="space-y-4">
      <div className="bg-bg-surface border border-border rounded-lg p-6 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto">
          <Brain className="w-8 h-8 text-accent" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-text-primary mb-2">AI 解析导入</h3>
          <p className="text-sm text-text-muted max-w-sm mx-auto">
            将你已有的角色设定文档、世界观文档粘贴或上传，AI 自动解析并填入对应模块字段。
          </p>
        </div>
        <div className="flex flex-col gap-2 items-center text-sm text-text-muted/80">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold">1</span>
            选择目标模块（角色 / 世界观 / 大纲）
          </div>
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold">2</span>
            粘贴文本或上传 .txt / .md 文件
          </div>
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold">3</span>
            AI 解析结果预览，确认后一键写入
          </div>
        </div>
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-accent/5 border border-accent/20 rounded-full text-sm text-accent/70">
          <Sparkles className="w-3.5 h-3.5" />
          此功能正在开发中，即将推出
        </div>
      </div>
    </div>
  )
}

// ── 共用小组件 ───────────────────────────────────────────────
function StatusBar({ status, message }: { status: ExportStatus; message: string }) {
  const cls = status === 'loading' ? 'bg-accent/10 text-accent'
    : status === 'success' ? 'bg-green-500/10 text-green-400'
    : 'bg-red-500/10 text-red-400'
  return (
    <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${cls}`}>
      {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
      {status === 'success' && <CheckCircle className="w-4 h-4 shrink-0" />}
      {status === 'error'   && <AlertCircle className="w-4 h-4 shrink-0" />}
      <span>{message}</span>
    </div>
  )
}

function SectionCard({
  icon, title, desc, badge, children,
}: {
  icon: React.ReactNode; title: string; desc: string; badge?: string; children: React.ReactNode
}) {
  return (
    <div className="bg-bg-surface border border-border rounded-lg p-5 space-y-3">
      <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
        {icon} {title}
        {badge && <span className="text-xs text-text-muted bg-bg-elevated px-2 py-0.5 rounded ml-auto">{badge}</span>}
      </h3>
      <p className="text-xs text-text-muted">{desc}</p>
      {children}
    </div>
  )
}

type ButtonVariant = 'accent' | 'default' | 'blue' | 'yellow' | 'orange'
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  accent:  'bg-accent text-white hover:bg-accent-hover',
  default: 'bg-bg-elevated text-text-secondary hover:bg-bg-hover hover:text-text-primary',
  blue:    'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30',
  yellow:  'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30',
  orange:  'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30',
}

function ActionButton({
  onClick, disabled, variant, children,
}: {
  onClick: () => void; disabled?: boolean; variant: ButtonVariant; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${VARIANT_CLASS[variant]}`}
    >
      {children}
    </button>
  )
}
