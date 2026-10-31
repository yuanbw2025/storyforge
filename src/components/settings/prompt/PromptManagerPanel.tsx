import { useState, useRef, useEffect } from 'react'
import { Plus, Upload, Download, Layers, FileText, Workflow } from 'lucide-react'
import { usePromptStore } from '../../../stores/prompt'
import type { PromptTemplate } from '../../../lib/types/prompt'
import type { Project } from '../../../lib/types'
import { GENRE_PACKS } from '../../../lib/ai/prompt-seeds-genre-packs'
import { encodePromptTemplateExchange } from '../../../lib/ai/prompt-template-exchange'
import PromptTemplateList from './PromptTemplateList'
import PromptTemplateEditor from './PromptTemplateEditor'
import PromptWorkflowsPanel from './PromptWorkflowsPanel'
import { useToast } from '../../shared/Toast'

type ScopeFilter = 'all' | 'system' | 'user' | 'craft'

interface Props {
  /** 当前项目 — 工作流的「保存到项目」需要 */
  project?: Project
}

export default function PromptManagerPanel({ project }: Props = {}) {
  const toast = useToast()
  const templates = usePromptStore(s => s.templates)
  const saveTemplate = usePromptStore(s => s.saveTemplate)
  const importTemplates = usePromptStore(s => s.importTemplates)
  const setActive = usePromptStore(s => s.setActive)
  const reload = usePromptStore(s => s.reload)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [search, setSearch] = useState('')
  const [genrePack, setGenrePack] = useState<string>(() => {
    try { return localStorage.getItem('sf-genre-pack') || 'general' } catch { return 'general' }
  })
  const [tab, setTab] = useState<'templates' | 'workflows'>('templates')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 持久化题材包选择（切换时写入 + 挂载时从上面的 useState 初始化器读取）
  useEffect(() => {
    try { localStorage.setItem('sf-genre-pack', genrePack) } catch { /* ignore */ }
  }, [genrePack])

  /** 切换题材包：把同 moduleKey 下属于该 genre 的模板设为激活 */
  const handleGenrePackChange = async (genreId: string) => {
    setGenrePack(genreId)
    if (genreId === 'general') {
      // 默认包：把没 genres 字段或含 'general' 的 system 模板激活
      const candidates = templates.filter(t =>
        t.scope === 'system' && (!t.genres || t.genres.length === 0 || t.genres.includes('general'))
      )
      const seenModuleKeys = new Set<string>()
      for (const t of candidates) {
        if (!seenModuleKeys.has(t.moduleKey)) {
          seenModuleKeys.add(t.moduleKey)
          if (!t.isActive) await setActive(t.id!)
        }
      }
    } else {
      // 题材包：找到该 genre 的模板批量激活
      const packTpls = templates.filter(t => t.genres?.includes(genreId))
      for (const t of packTpls) {
        if (!t.isActive) await setActive(t.id!)
      }
    }
  }

  // 过滤后的模板
  const filtered = templates.filter(t => {
    const matchesScope = scopeFilter === 'all'
      || (scopeFilter === 'craft' ? t.assetId?.startsWith('CRAFT-') : t.scope === scopeFilter)
    const keywords = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    const searchable = `${t.name} ${t.description} ${t.moduleKey} ${t.assetId ?? ''}`.toLocaleLowerCase().replace(/\s+/g, '')
    return matchesScope && keywords.every(keyword => searchable.includes(keyword))
  })

  const selected = selectedId ? templates.find(t => t.id === selectedId) : null

  /** 新建一个空模板（user scope） */
  const handleNew = async () => {
    const now = Date.now()
    const blank: PromptTemplate = {
      scope: 'user',
      moduleKey: 'worldview.dimension',
      promptType: 'generate',
      name: '未命名模板',
      description: '',
      systemPrompt: '',
      userPromptTemplate: '',
      variables: [],
      isActive: false,
      createdAt: now,
      updatedAt: now,
    }
    const newId = await saveTemplate(blank)
    setSelectedId(newId)
  }

  /** 导出全部模板为 JSON */
  const handleExportAll = () => {
    try {
      const blob = new Blob([encodePromptTemplateExchange(templates)], { type: 'application/json' })
      triggerDownload(blob, `storyforge-prompts-${new Date().toISOString().slice(0, 10)}.json`)
    } catch (cause) {
      toast.error(`导出失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  /** 导入 JSON 文件 */
  const handleImportClick = () => fileInputRef.current?.click()

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const count = await importTemplates(text)
      toast.success(`成功导入 ${count} 条模板`)
    } catch (err) {
      toast.error(`导入失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 二级 Tab：模板 / 工作流 */}
      <div className="flex items-center gap-1 border-b border-border px-3 pt-2 flex-shrink-0">
        <button
          onClick={() => setTab('templates')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-t border-b-2 transition-colors ${
            tab === 'templates'
              ? 'border-accent text-accent font-medium'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          <FileText className="w-3.5 h-3.5" /> 模板
        </button>
        <button
          onClick={() => setTab('workflows')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-t border-b-2 transition-colors ${
            tab === 'workflows'
              ? 'border-accent text-accent font-medium'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          <Workflow className="w-3.5 h-3.5" /> 提示词实验
        </button>
      </div>

      {tab === 'workflows' ? (
        <div className="flex-1 overflow-y-auto">
          <PromptWorkflowsPanel project={project} />
        </div>
      ) : (
        <PromptTemplatesView
          templates={templates}
          filtered={filtered}
          selected={selected}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          search={search}
          setSearch={setSearch}
          scopeFilter={scopeFilter}
          setScopeFilter={setScopeFilter}
          genrePack={genrePack}
          handleGenrePackChange={handleGenrePackChange}
          handleNew={handleNew}
          handleImportClick={handleImportClick}
          handleExportAll={handleExportAll}
          handleImportFile={handleImportFile}
          fileInputRef={fileInputRef}
          reload={reload}
        />
      )}
    </div>
  )
}

interface TemplatesViewProps {
  templates: PromptTemplate[]
  filtered: PromptTemplate[]
  selected: PromptTemplate | null | undefined
  selectedId: number | null
  setSelectedId: (id: number | null) => void
  search: string
  setSearch: (value: string) => void
  scopeFilter: ScopeFilter
  setScopeFilter: (s: ScopeFilter) => void
  genrePack: string
  handleGenrePackChange: (g: string) => void
  handleNew: () => void
  handleImportClick: () => void
  handleExportAll: () => void
  handleImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  reload: () => Promise<void>
}

function PromptTemplatesView({
  filtered, selected, selectedId, setSelectedId, search, setSearch, scopeFilter, setScopeFilter,
  genrePack, handleGenrePackChange, handleNew, handleImportClick,
  handleExportAll, handleImportFile, fileInputRef, reload,
}: TemplatesViewProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 题材包切换器（一级显著位置） */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border flex-shrink-0 bg-bg-elevated/30">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Layers className="w-4 h-4 text-accent flex-shrink-0" />
          <span className="text-xs text-text-secondary flex-shrink-0">题材包</span>
          <select
            value={genrePack}
            onChange={e => handleGenrePackChange(e.target.value)}
            className="px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            {GENRE_PACKS.map(p => (
              <option key={p.id} value={p.id}>{p.emoji} {p.label}</option>
            ))}
          </select>
          <span className="ml-2 text-xs text-text-muted truncate">
            {GENRE_PACKS.find(p => p.id === genrePack)?.description}
          </span>
        </div>
      </div>

      <div className="px-5 py-3 border-b border-border space-y-2">
        <input
          type="search"
          aria-label="搜索提示词"
          placeholder="搜索任务、名称或关键词，如：去 AI 味、续写、对白"
          value={search}
          onChange={event => setSearch(event.target.value)}
          className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
        />
        {scopeFilter === 'craft' && (
          <p className="text-xs text-text-secondary">
            从一个写作问题开始：构思 → 人物与大纲 → 正文 → 修稿 → 交接与包装。每条可单独选用。
            在工作流节点中选中具体模板，填写材料即可；去 AI 味模板也可激活后用于正文工具。
          </p>
        )}
      </div>

      {/* 工具栏 */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary">作用域</span>
          <select
            value={scopeFilter}
            onChange={e => setScopeFilter(e.target.value as ScopeFilter)}
            className="px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="all">全部</option>
            <option value="system">系统内置</option>
            <option value="user">我的</option>
            <option value="craft">熔炉写作工坊</option>
          </select>
          <span className="ml-3 text-xs text-text-muted">
            共 {filtered.length} 条
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleNew}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent text-sm rounded hover:bg-accent/20"
          >
            <Plus className="w-3.5 h-3.5" /> 新建
          </button>
          <button
            onClick={handleImportClick}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-hover text-text-primary text-sm rounded hover:bg-bg-elevated"
          >
            <Upload className="w-3.5 h-3.5" /> 导入
          </button>
          <button
            onClick={handleExportAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-hover text-text-primary text-sm rounded hover:bg-bg-elevated"
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

      {/* 主区：左列表 + 右编辑器 */}
      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 flex-shrink-0 border-r border-border overflow-y-auto">
          <PromptTemplateList
            templates={filtered}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          <PromptTemplateEditor
            template={selected ?? null}
            onChanged={() => reload()}
            onDeleted={() => setSelectedId(null)}
          />
        </div>
      </div>
    </div>
  )
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
