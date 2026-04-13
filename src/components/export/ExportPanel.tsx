import { useState, useRef } from 'react'
import { Download, Upload, FileJson, FileText, FileType, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { exportProjectJSON, downloadJSON, importProjectJSON, type ProjectExportData } from '../../lib/export/json-export'
import { exportProjectMarkdown, exportProjectTXT, downloadTextFile } from '../../lib/export/text-export'
import type { Project } from '../../lib/types'

interface Props {
  project: Project
  onImported?: (newProjectId: number) => void
}

type ExportStatus = 'idle' | 'loading' | 'success' | 'error'

export default function ExportPanel({ project, onImported }: Props) {
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [message, setMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showStatus = (s: ExportStatus, msg: string) => {
    setStatus(s)
    setMessage(msg)
    if (s === 'success') setTimeout(() => setStatus('idle'), 3000)
  }

  // JSON 导出
  const handleExportJSON = async () => {
    try {
      setStatus('loading')
      setMessage('正在导出 JSON...')
      const data = await exportProjectJSON(project.id!)
      const filename = `${project.name}_${new Date().toISOString().slice(0, 10)}.json`
      downloadJSON(data, filename)
      showStatus('success', 'JSON 导出成功！')
    } catch (e) {
      showStatus('error', `导出失败：${(e as Error).message}`)
    }
  }

  // JSON 导入
  const handleImportJSON = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setStatus('loading')
      setMessage('正在导入项目...')
      const text = await file.text()
      const data: ProjectExportData = JSON.parse(text)
      const newId = await importProjectJSON(data)
      showStatus('success', `导入成功！新项目 ID: ${newId}`)
      onImported?.(newId)
    } catch (err) {
      showStatus('error', `导入失败：${(err as Error).message}`)
    }

    // 重置 input
    e.target.value = ''
  }

  // Markdown 导出
  const handleExportMarkdown = async () => {
    try {
      setStatus('loading')
      setMessage('正在导出 Markdown...')
      const md = await exportProjectMarkdown(project.id!)
      const filename = `${project.name}_${new Date().toISOString().slice(0, 10)}.md`
      downloadTextFile(md, filename, 'text/markdown')
      showStatus('success', 'Markdown 导出成功！')
    } catch (e) {
      showStatus('error', `导出失败：${(e as Error).message}`)
    }
  }

  // TXT 导出
  const handleExportTXT = async () => {
    try {
      setStatus('loading')
      setMessage('正在导出 TXT...')
      const txt = await exportProjectTXT(project.id!)
      const filename = `${project.name}_${new Date().toISOString().slice(0, 10)}.txt`
      downloadTextFile(txt, filename)
      showStatus('success', 'TXT 导出成功！')
    } catch (e) {
      showStatus('error', `导出失败：${(e as Error).message}`)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-1">📦 导出 / 导入</h2>
        <p className="text-sm text-text-muted">导出项目数据用于备份或分享，也可以导入之前的备份。</p>
      </div>

      {/* 状态提示 */}
      {status !== 'idle' && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${
          status === 'loading' ? 'bg-accent/10 text-accent' :
          status === 'success' ? 'bg-success/10 text-success' :
          'bg-error/10 text-error'
        }`}>
          {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin" />}
          {status === 'success' && <CheckCircle className="w-4 h-4" />}
          {status === 'error' && <AlertCircle className="w-4 h-4" />}
          {message}
        </div>
      )}

      {/* JSON 导出/导入 */}
      <div className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <FileJson className="w-5 h-5 text-accent" /> JSON（完整备份）
        </h3>
        <p className="text-sm text-text-muted">
          导出包含所有数据（世界观、角色、大纲、章节正文、伏笔等）的完整 JSON 备份文件。可用于恢复或迁移项目。
        </p>
        <div className="flex gap-3">
          <button onClick={handleExportJSON} disabled={status === 'loading'}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50">
            <Download className="w-4 h-4" /> 导出 JSON
          </button>
          <button onClick={handleImportJSON} disabled={status === 'loading'}
            className="flex items-center gap-2 px-4 py-2.5 bg-bg-elevated text-text-secondary rounded-lg text-sm font-medium hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-50">
            <Upload className="w-4 h-4" /> 导入 JSON
          </button>
          <input ref={fileInputRef} type="file" accept=".json"
            onChange={handleFileSelected} className="hidden" />
        </div>
      </div>

      {/* Markdown 导出 */}
      <div className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <FileText className="w-5 h-5 text-info" /> Markdown（正文导出）
        </h3>
        <p className="text-sm text-text-muted">
          按大纲结构导出所有章节正文为 Markdown 格式，适合在其他编辑器中阅读或发布。
        </p>
        <button onClick={handleExportMarkdown} disabled={status === 'loading'}
          className="flex items-center gap-2 px-4 py-2.5 bg-info/20 text-info rounded-lg text-sm font-medium hover:bg-info/30 transition-colors disabled:opacity-50">
          <Download className="w-4 h-4" /> 导出 Markdown
        </button>
      </div>

      {/* TXT 导出 */}
      <div className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <FileType className="w-5 h-5 text-warning" /> 纯文本（TXT）
        </h3>
        <p className="text-sm text-text-muted">
          导出为纯文本格式，不含任何格式标记，适合直接发布到小说平台。
        </p>
        <button onClick={handleExportTXT} disabled={status === 'loading'}
          className="flex items-center gap-2 px-4 py-2.5 bg-warning/20 text-warning rounded-lg text-sm font-medium hover:bg-warning/30 transition-colors disabled:opacity-50">
          <Download className="w-4 h-4" /> 导出 TXT
        </button>
      </div>
    </div>
  )
}
