import { useState, useEffect, useRef } from 'react'
import {
  Play, Trash2, Copy, ArrowRight,
  Upload, Download, Plus, Edit3,
} from 'lucide-react'
import { useWorkflowStore } from '../../../stores/workflow'
import type { PromptWorkflowStep } from '../../../lib/types/workflow'
import type { Project } from '../../../lib/types'
import WorkflowEditor from './WorkflowEditor'
import WorkflowRunner from './WorkflowRunner'

interface Props {
  project?: Project
}

/** 工作流面板：列表 + Runner / Editor（同一面板切换视图） */
export default function PromptWorkflowsPanel({ project }: Props = {}) {
  const workflows = useWorkflowStore(s => s.workflows)
  const cloneWorkflow = useWorkflowStore(s => s.clone)
  const removeWorkflow = useWorkflowStore(s => s.remove)
  const saveWorkflow = useWorkflowStore(s => s.save)
  const reloadWorkflows = useWorkflowStore(s => s.reload)
  const initWorkflows = useWorkflowStore(s => s.init)

  const [runningId, setRunningId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { initWorkflows() }, [initWorkflows])

  const handleExportAll = () => {
    const blob = new Blob([JSON.stringify(workflows, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `storyforge-workflows-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleImportClick = () => fileInputRef.current?.click()

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const items: unknown[] = Array.isArray(data) ? data : [data]
      const now = Date.now()
      let count = 0
      for (const raw of items) {
        if (typeof raw !== 'object' || raw === null) continue
        const r = raw as Record<string, unknown>
        if (typeof r.name !== 'string' || !Array.isArray(r.steps)) continue
        await saveWorkflow({
          scope: 'user',
          name: r.name,
          description: typeof r.description === 'string' ? r.description : '',
          genres: Array.isArray(r.genres) ? r.genres as string[] : undefined,
          steps: r.steps as PromptWorkflowStep[],
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        })
        count++
      }
      await reloadWorkflows()
      alert(`成功导入 ${count} 个工作流`)
    } catch (err) {
      alert(`导入失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleNew = async () => {
    const now = Date.now()
    const id = await saveWorkflow({
      scope: 'user',
      name: '新建工作流',
      description: '',
      steps: [],
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    })
    setEditingId(id)
  }

  if (runningId !== null) {
    const wf = workflows.find(w => w.id === runningId)
    if (!wf) {
      setRunningId(null)
      return null
    }
    return <WorkflowRunner workflow={wf} project={project} onClose={() => setRunningId(null)} />
  }

  if (editingId !== null) {
    const wf = workflows.find(w => w.id === editingId)
    if (!wf) {
      setEditingId(null)
      return null
    }
    return <WorkflowEditor workflow={wf} onClose={() => setEditingId(null)} />
  }

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary mb-1">🔗 提示词工作流</h2>
          <p className="text-sm text-text-muted">
            一键跑完一段创作流程，每步可暂停审核。
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleNew}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent text-xs rounded hover:bg-accent/20"
          >
            <Plus className="w-3.5 h-3.5" /> 新建
          </button>
          <button
            onClick={handleImportClick}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-hover text-text-primary text-xs rounded hover:bg-bg-elevated"
          >
            <Upload className="w-3.5 h-3.5" /> 导入
          </button>
          <button
            onClick={handleExportAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-hover text-text-primary text-xs rounded hover:bg-bg-elevated"
          >
            <Download className="w-3.5 h-3.5" /> 导出全部
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </div>

      {workflows.length === 0 ? (
        <div className="text-center py-12 text-text-muted text-sm">加载中...</div>
      ) : (
        <div className="space-y-2">
          {workflows.map(w => (
            <div key={w.id} className="bg-bg-surface border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-text-primary truncate">{w.name}</h3>
                    {w.scope === 'system'
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning">系统</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/15 text-info">我的</span>}
                    {w.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent">★ 默认</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-text-secondary">{w.description}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setRunningId(w.id!)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-hover"
                  >
                    <Play className="w-3 h-3" /> 运行
                  </button>
                  {w.scope === 'user' && (
                    <button
                      onClick={() => setEditingId(w.id!)}
                      className="p-1.5 text-text-muted hover:text-text-primary"
                      title="编辑"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => cloneWorkflow(w.id!)}
                    className="p-1.5 text-text-muted hover:text-text-primary"
                    title="克隆"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {w.scope === 'user' && (
                    <button
                      onClick={() => {
                        if (confirm(`删除工作流「${w.name}」？`)) removeWorkflow(w.id!)
                      }}
                      className="p-1.5 text-text-muted hover:text-error"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* 步骤预览 */}
              <div className="flex items-center gap-1 flex-wrap mt-2">
                {w.steps.map((s, i) => (
                  <span key={s.stepId} className="flex items-center gap-1 text-xs">
                    <span className="px-2 py-0.5 bg-bg-elevated text-text-secondary rounded">
                      {i + 1}. {s.label}
                    </span>
                    {i < w.steps.length - 1 && <ArrowRight className="w-3 h-3 text-text-muted" />}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-text-muted">
                共 {w.steps.length} 步 · {w.steps.filter(s => s.userConfirmRequired).length} 步需用户确认
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
