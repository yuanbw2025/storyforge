import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { History, Plus, Trash2, RotateCcw, HardDrive } from 'lucide-react'
import { useBackupStore } from '../../stores/backup'
import { useToast } from '../shared/Toast'
import type { Project, Snapshot } from '../../lib/types'

interface Props {
  project: Project
}

export default function VersionHistoryPanel({ project }: Props) {
  const navigate = useNavigate()
  const { snapshots, loading, loadSnapshots, createSnapshot, deleteSnapshot, restoreSnapshot } = useBackupStore()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState<number | null>(null)
  const [manualLabel, setManualLabel] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)

  useEffect(() => {
    if (project.id) {
      loadSnapshots(project.id)
    }
  }, [project.id, loadSnapshots])

  const handleCreateManual = async () => {
    if (!project.id) return
    setCreating(true)
    try {
      const label = manualLabel.trim() || `手动备份 ${new Date().toLocaleString('zh-CN')}`
      await createSnapshot(project.id, label, 'manual')
      toast.success('快照创建成功')
      setManualLabel('')
      setShowCreateForm(false)
    } catch (err) {
      toast.error('快照创建失败: ' + (err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const handleRestore = async (snap: Snapshot) => {
    if (!confirm(`确定要从快照「${snap.label}」恢复吗？\n将创建一个新项目（不会覆盖当前项目）`)) return
    setRestoring(snap.id!)
    try {
      const newId = await restoreSnapshot(snap.id!)
      toast.success('恢复成功，已创建新项目')
      navigate(`/workspace/${newId}`)
    } catch (err) {
      toast.error('恢复失败: ' + (err as Error).message)
    } finally {
      setRestoring(null)
    }
  }

  const handleDelete = async (snap: Snapshot) => {
    if (!confirm(`确定删除快照「${snap.label}」？此操作不可撤销。`)) return
    try {
      await deleteSnapshot(snap.id!)
      toast.success('快照已删除')
    } catch (err) {
      toast.error('删除失败')
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatTimeAgo = (ts: number) => {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins} 分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} 小时前`
    const days = Math.floor(hours / 24)
    return `${days} 天前`
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <History className="w-6 h-6 text-accent" />
          <h1 className="text-2xl font-bold text-text-primary">版本历史</h1>
          <span className="text-sm text-text-muted">共 {snapshots.length} 个快照</span>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition text-sm"
        >
          <Plus className="w-4 h-4" />
          手动备份
        </button>
      </div>

      {/* 手动创建表单 */}
      {showCreateForm && (
        <div className="bg-bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
          <input
            type="text"
            value={manualLabel}
            onChange={(e) => setManualLabel(e.target.value)}
            placeholder="快照名称（可选，如：完成第三章初稿）"
            className="flex-1 bg-bg-base border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateManual()}
          />
          <button
            onClick={handleCreateManual}
            disabled={creating}
            className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition text-sm disabled:opacity-50"
          >
            {creating ? '创建中...' : '创建'}
          </button>
          <button
            onClick={() => { setShowCreateForm(false); setManualLabel('') }}
            className="px-3 py-2 text-text-secondary hover:text-text-primary transition text-sm"
          >
            取消
          </button>
        </div>
      )}

      {/* 自动备份提示 */}
      <div className="bg-bg-surface/50 border border-border/50 rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-text-muted">
        <HardDrive className="w-4 h-4 shrink-0" />
        <span>系统每 5 分钟自动创建一次备份快照，最多保留最近 20 个自动快照。</span>
      </div>

      {/* 快照列表 */}
      {loading ? (
        <div className="text-center py-12 text-text-muted">加载中...</div>
      ) : snapshots.length === 0 ? (
        <div className="text-center py-16">
          <History className="w-12 h-12 text-text-muted mx-auto mb-4 opacity-50" />
          <p className="text-text-muted mb-2">暂无备份快照</p>
          <p className="text-text-muted text-sm">系统会在 5 分钟后自动创建首个备份，你也可以手动创建。</p>
        </div>
      ) : (
        <div className="space-y-2">
          {snapshots.map((snap) => (
            <div
              key={snap.id}
              className="bg-bg-surface border border-border rounded-xl p-4 hover:border-accent/30 transition group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-text-primary font-medium text-sm truncate">
                      {snap.label}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-xs ${
                        snap.type === 'auto'
                          ? 'bg-blue-500/10 text-blue-400'
                          : 'bg-green-500/10 text-green-400'
                      }`}
                    >
                      {snap.type === 'auto' ? '自动' : '手动'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-muted">
                    <span>{formatTime(snap.createdAt)}</span>
                    <span>·</span>
                    <span>{formatTimeAgo(snap.createdAt)}</span>
                    <span>·</span>
                    <span>{formatSize(snap.size)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button
                    onClick={() => handleRestore(snap)}
                    disabled={restoring === snap.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/10 rounded-lg transition disabled:opacity-50"
                    title="从此快照恢复（创建新项目）"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {restoring === snap.id ? '恢复中...' : '恢复'}
                  </button>
                  <button
                    onClick={() => handleDelete(snap)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition"
                    title="删除此快照"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
