import { useState, useRef } from 'react'
import {
  Download, Upload, FileJson, FileText, FileType,
  Loader2, CheckCircle, AlertCircle, FolderOpen, Github, ExternalLink, X,
} from 'lucide-react'
import { exportProjectJSON, downloadJSON, importProjectJSON, type ProjectExportData } from '../../lib/export/json-export'
import { exportProjectMarkdown, exportProjectTXT, downloadTextFile } from '../../lib/export/text-export'
import { exportToGist, validateGitHubPAT } from '../../lib/export/gist-export'
import { useFileSystemAccess, isFSASupported } from '../../hooks/useFileSystemAccess'
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

  // 6.5 File System Access
  const { handle, writing, pickDirectory, writeFile, clearHandle } = useFileSystemAccess()

  // 6.6 GitHub Gist
  const [pat, setPat] = useState(() => localStorage.getItem('sf_github_pat') ?? '')
  const [gistId, setGistId] = useState(() => localStorage.getItem(`sf_gist_${project.id}`) ?? '')
  const [gistUrl, setGistUrl] = useState('')
  const [patUser, setPatUser] = useState<string | null>(null)
  const [validatingPat, setValidatingPat] = useState(false)

  const showStatus = (s: ExportStatus, msg: string) => {
    setStatus(s)
    setMessage(msg)
    if (s === 'success') setTimeout(() => setStatus('idle'), 4000)
  }

  // ── JSON 导出 ──────────────────────────────────────────────
  const handleExportJSON = async () => {
    try {
      showStatus('loading', '正在导出 JSON...')
      const data = await exportProjectJSON(project.id!)
      const filename = `${project.name}_${new Date().toISOString().slice(0, 10)}.json`
      downloadJSON(data, filename)
      showStatus('success', 'JSON 导出成功！')
    } catch (e) {
      showStatus('error', `导出失败：${(e as Error).message}`)
    }
  }

  const handleImportJSON = () => fileInputRef.current?.click()

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      showStatus('loading', '正在导入项目...')
      const text = await file.text()
      const data: ProjectExportData = JSON.parse(text)
      const newId = await importProjectJSON(data)
      showStatus('success', `导入成功！`)
      onImported?.(newId)
    } catch (err) {
      showStatus('error', `导入失败：${(err as Error).message}`)
    }
    e.target.value = ''
  }

  // ── Markdown / TXT 导出 ────────────────────────────────────
  const handleExportMarkdown = async () => {
    try {
      showStatus('loading', '正在导出 Markdown...')
      const md = await exportProjectMarkdown(project.id!)
      downloadTextFile(md, `${project.name}_${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown')
      showStatus('success', 'Markdown 导出成功！')
    } catch (e) {
      showStatus('error', `导出失败：${(e as Error).message}`)
    }
  }

  const handleExportTXT = async () => {
    try {
      showStatus('loading', '正在导出 TXT...')
      const txt = await exportProjectTXT(project.id!)
      downloadTextFile(txt, `${project.name}_${new Date().toISOString().slice(0, 10)}.txt`)
      showStatus('success', 'TXT 导出成功！')
    } catch (e) {
      showStatus('error', `导出失败：${(e as Error).message}`)
    }
  }

  // ── 6.5 File System Access ─────────────────────────────────
  const handleBindFolder = async () => {
    const fsaHandle = await pickDirectory()
    if (!fsaHandle) return
    // 立刻写一次
    await handleSaveToFolder(fsaHandle)
  }

  const handleSaveToFolder = async (fsaHandle?: any) => {
    try {
      showStatus('loading', '正在写入本地文件夹...')
      const data = await exportProjectJSON(project.id!)
      const filename = `storyforge-${project.name.replace(/[/\\?%*:|"<>]/g, '-')}.json`
      const ok = await writeFile(filename, JSON.stringify(data, null, 2), fsaHandle)
      if (ok) showStatus('success', `已保存到本地文件夹 / ${filename}`)
      else showStatus('error', '写入失败，请重新绑定文件夹')
    } catch (e) {
      showStatus('error', `写入失败：${(e as Error).message}`)
    }
  }

  // ── 6.6 GitHub Gist ────────────────────────────────────────
  const handleValidatePAT = async () => {
    if (!pat.trim()) return
    setValidatingPat(true)
    try {
      const login = await validateGitHubPAT(pat.trim())
      setPatUser(login)
      localStorage.setItem('sf_github_pat', pat.trim())
    } catch {
      setPatUser(null)
      showStatus('error', 'PAT 无效，请检查权限（需要 gist 权限）')
    } finally {
      setValidatingPat(false)
    }
  }

  const handleExportGist = async () => {
    if (!pat.trim()) {
      showStatus('error', '请先填写 GitHub PAT')
      return
    }
    try {
      showStatus('loading', gistId ? '正在更新 Gist...' : '正在创建 Gist...')
      const data = await exportProjectJSON(project.id!)
      const result = await exportToGist(data, { pat: pat.trim(), gistId: gistId || undefined })
      setGistId(result.gistId)
      setGistUrl(result.url)
      localStorage.setItem(`sf_gist_${project.id}`, result.gistId)
      showStatus('success', gistId ? 'Gist 已更新！' : 'Gist 已创建！')
    } catch (e) {
      showStatus('error', `Gist 导出失败：${(e as Error).message}`)
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
          status === 'success' ? 'bg-green-500/10 text-green-400' :
          'bg-red-500/10 text-red-400'
        }`}>
          {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
          {status === 'success' && <CheckCircle className="w-4 h-4 shrink-0" />}
          {status === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{message}</span>
        </div>
      )}

      {/* JSON 导出/导入 */}
      <div className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <FileJson className="w-5 h-5 text-accent" /> JSON（完整备份）
        </h3>
        <p className="text-sm text-text-muted">
          导出包含所有数据（世界观、角色、大纲、章节正文、伏笔等）的完整 JSON 备份文件。
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
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileSelected} className="hidden" />
        </div>
      </div>

      {/* Markdown 导出 */}
      <div className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-400" /> Markdown（正文导出）
        </h3>
        <p className="text-sm text-text-muted">按大纲结构导出所有章节正文为 Markdown 格式。</p>
        <button onClick={handleExportMarkdown} disabled={status === 'loading'}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-500/30 transition-colors disabled:opacity-50">
          <Download className="w-4 h-4" /> 导出 Markdown
        </button>
      </div>

      {/* TXT 导出 */}
      <div className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <FileType className="w-5 h-5 text-yellow-400" /> 纯文本（TXT）
        </h3>
        <p className="text-sm text-text-muted">导出为纯文本，适合直接发布到小说平台。</p>
        <button onClick={handleExportTXT} disabled={status === 'loading'}
          className="flex items-center gap-2 px-4 py-2.5 bg-yellow-500/20 text-yellow-400 rounded-lg text-sm font-medium hover:bg-yellow-500/30 transition-colors disabled:opacity-50">
          <Download className="w-4 h-4" /> 导出 TXT
        </button>
      </div>

      {/* 6.5 本地文件夹自动保存 */}
      <div className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-orange-400" /> 本地文件夹自动保存
          {!isFSASupported() && (
            <span className="text-xs text-text-muted bg-bg-elevated px-2 py-0.5 rounded ml-auto">
              仅 Chrome / Edge 支持
            </span>
          )}
        </h3>
        <p className="text-sm text-text-muted">
          绑定本地文件夹，将项目 JSON 实时写入磁盘。适合在本地备份关键存档。
        </p>

        {handle ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
              <FolderOpen className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate">已绑定：{handle.path}</span>
              <button onClick={clearHandle} className="text-text-muted hover:text-text-primary transition">
                <X className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={() => handleSaveToFolder()}
              disabled={writing || status === 'loading'}
              className="flex items-center gap-2 px-4 py-2.5 bg-orange-500/20 text-orange-400 rounded-lg text-sm font-medium hover:bg-orange-500/30 transition-colors disabled:opacity-50"
            >
              {writing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {writing ? '写入中...' : '立即保存到文件夹'}
            </button>
          </div>
        ) : (
          <button
            onClick={handleBindFolder}
            disabled={!isFSASupported() || status === 'loading'}
            className="flex items-center gap-2 px-4 py-2.5 bg-orange-500/20 text-orange-400 rounded-lg text-sm font-medium hover:bg-orange-500/30 transition-colors disabled:opacity-50"
          >
            <FolderOpen className="w-4 h-4" /> 选择本地文件夹
          </button>
        )}
      </div>

      {/* 6.6 GitHub Gist 导出 */}
      <div className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <Github className="w-5 h-5 text-purple-400" /> GitHub Gist 云备份
        </h3>
        <p className="text-sm text-text-muted">
          将项目备份为私密 GitHub Gist。需要有 <code className="text-xs bg-bg-elevated px-1 py-0.5 rounded">gist</code> 权限的 Personal Access Token。
        </p>

        {/* PAT 输入 */}
        <div className="space-y-2">
          <label className="text-xs text-text-muted uppercase tracking-wide">GitHub Personal Access Token</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={pat}
              onChange={(e) => { setPat(e.target.value); setPatUser(null) }}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className="flex-1 bg-bg-base border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
            />
            <button
              onClick={handleValidatePAT}
              disabled={!pat.trim() || validatingPat}
              className="px-3 py-2 bg-bg-elevated text-text-secondary rounded-lg text-sm hover:text-text-primary transition disabled:opacity-50"
            >
              {validatingPat ? <Loader2 className="w-4 h-4 animate-spin" /> : '验证'}
            </button>
          </div>
          {patUser && (
            <p className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> 已验证：@{patUser}
            </p>
          )}
        </div>

        {/* 已有 Gist ID */}
        {gistId && (
          <div className="text-xs text-text-muted flex items-center gap-2">
            <span>Gist ID: <code className="bg-bg-elevated px-1 rounded">{gistId.slice(0, 8)}…</code></span>
            {gistUrl && (
              <a href={gistUrl} target="_blank" rel="noopener noreferrer"
                className="text-accent hover:underline flex items-center gap-1">
                查看 <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button onClick={() => { setGistId(''); localStorage.removeItem(`sf_gist_${project.id}`) }}
              className="text-text-muted hover:text-red-400 transition">
              <X className="w-3 h-3" /> 解绑
            </button>
          </div>
        )}

        <button
          onClick={handleExportGist}
          disabled={!pat.trim() || status === 'loading'}
          className="flex items-center gap-2 px-4 py-2.5 bg-purple-500/20 text-purple-400 rounded-lg text-sm font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-50"
        >
          <Github className="w-4 h-4" />
          {gistId ? '更新 Gist' : '创建 Gist'}
        </button>
      </div>
    </div>
  )
}
