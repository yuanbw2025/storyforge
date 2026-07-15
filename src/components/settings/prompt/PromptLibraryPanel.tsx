import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, BookOpen, Check, Clipboard, Database, Play, Search, Square, WandSparkles,
} from 'lucide-react'
import type { Project } from '../../../lib/types'
import type { PromptLibraryStage, PromptLibraryTaskType, PromptTemplate } from '../../../lib/types/prompt'
import { usePromptStore } from '../../../stores/prompt'
import { useWorldGroupStore } from '../../../stores/world-group'
import { useOutlineStore } from '../../../stores/outline'
import { useChapterStore } from '../../../stores/chapter'
import { useAIConfigStore } from '../../../stores/ai-config'
import { useAIStream } from '../../../hooks/useAIStream'
import { renderPrompt } from '../../../lib/ai/prompt-engine'
import {
  assembleLibraryPromptVariables,
  getLibraryScopeNeeds,
  getLibrarySourceKeys,
  libraryTemplateMatchesProject,
  PROMPT_LIBRARY_STAGE_META,
  PROMPT_LIBRARY_TASK_LABELS,
} from '../../../lib/ai/prompt-library'
import { CONTEXT_SOURCE_BY_KEY } from '../../../lib/registry/context-sources'
import { adopt } from '../../../lib/registry/adopt'
import { useDialog } from '../../shared/Dialog'
import { useToast } from '../../shared/Toast'

interface Props {
  project?: Project
}

type StageFilter = 'all' | PromptLibraryStage
type TaskFilter = 'all' | PromptLibraryTaskType

export default function PromptLibraryPanel({ project }: Props) {
  const templates = usePromptStore(s => s.templates)
  const libraryTemplates = useMemo(
    () => templates.filter(template => template.library).sort((a, b) => a.library!.order - b.library!.order),
    [templates],
  )
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState<StageFilter>('all')
  const [taskType, setTaskType] = useState<TaskFilter>('all')
  const [currentOnly, setCurrentOnly] = useState(false)
  const [mobileDetail, setMobileDetail] = useState(false)
  const detailScrollRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => libraryTemplates.filter(template => {
    const meta = template.library!
    if (stage !== 'all' && meta.stage !== stage) return false
    if (taskType !== 'all' && meta.taskType !== taskType) return false
    if (currentOnly && project && !libraryTemplateMatchesProject(template, project)) return false
    const query = search.trim().toLowerCase()
    if (!query) return true
    return `${meta.assetId} ${template.name} ${template.description}`.toLowerCase().includes(query)
  }), [libraryTemplates, stage, taskType, currentOnly, project, search])

  useEffect(() => {
    if (!filtered.length) {
      setSelectedAssetId(null)
      return
    }
    if (!filtered.some(template => template.library?.assetId === selectedAssetId)) {
      setSelectedAssetId(filtered[0].library!.assetId)
    }
  }, [filtered, selectedAssetId])

  useEffect(() => {
    detailScrollRef.current?.scrollTo({ top: 0 })
  }, [selectedAssetId])

  if (!project?.id) {
    return <div className="p-6 text-sm text-text-muted">进入一个项目后即可调用小说创作 Prompt。</div>
  }

  const selected = libraryTemplates.find(template => template.library?.assetId === selectedAssetId) ?? null

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 flex-shrink-0">
        <div className="relative min-w-52 flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-text-muted" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="搜索 118 个小说 Prompt"
            className="w-full pl-8 pr-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <select
          value={stage}
          onChange={event => setStage(event.target.value as StageFilter)}
          className="px-2 py-2 bg-bg-base border border-border rounded text-xs text-text-primary"
          aria-label="创作阶段"
        >
          <option value="all">全部阶段</option>
          {Object.entries(PROMPT_LIBRARY_STAGE_META)
            .sort((a, b) => a[1].order - b[1].order)
            .map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
        </select>
        <select
          value={taskType}
          onChange={event => setTaskType(event.target.value as TaskFilter)}
          className="px-2 py-2 bg-bg-base border border-border rounded text-xs text-text-primary"
          aria-label="任务类型"
        >
          <option value="all">全部任务</option>
          {Object.entries(PROMPT_LIBRARY_TASK_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 px-2 py-2 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={currentOnly}
            onChange={event => setCurrentOnly(event.target.checked)}
            className="accent-accent"
          />
          仅当前项目适用
        </label>
        <span className="ml-auto text-xs text-text-muted">{filtered.length} / {libraryTemplates.length}</span>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className={`${mobileDetail ? 'hidden lg:block' : 'block'} border-r border-border overflow-y-auto`}>
          <PromptLibraryList
            templates={filtered}
            selectedAssetId={selectedAssetId}
            project={project}
            onSelect={(assetId) => {
              setSelectedAssetId(assetId)
              setMobileDetail(true)
            }}
          />
        </div>
        <div ref={detailScrollRef} className={`${mobileDetail ? 'block' : 'hidden lg:block'} min-w-0 overflow-y-auto`}>
          {selected
            ? <PromptLibraryRunner
                key={selected.library!.assetId}
                template={selected}
                project={project}
                onBack={() => setMobileDetail(false)}
              />
            : <div className="p-8 text-center text-sm text-text-muted">当前筛选下没有 Prompt</div>}
        </div>
      </div>
    </div>
  )
}

function PromptLibraryList({
  templates, selectedAssetId, project, onSelect,
}: {
  templates: PromptTemplate[]
  selectedAssetId: string | null
  project: Project
  onSelect: (assetId: string) => void
}) {
  if (!templates.length) return <div className="p-6 text-center text-sm text-text-muted">没有匹配的 Prompt</div>
  return (
    <div className="py-1">
      {templates.map(template => {
        const meta = template.library!
        const applicable = libraryTemplateMatchesProject(template, project)
        return (
          <button
            key={meta.assetId}
            onClick={() => onSelect(meta.assetId)}
            className={`w-full px-3 py-2.5 text-left border-l-2 border-b border-border/50 transition-colors ${
              selectedAssetId === meta.assetId
                ? 'border-l-accent bg-accent/10'
                : 'border-l-transparent hover:bg-bg-hover'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-accent">{meta.assetId}</span>
              <span className="text-[10px] text-text-muted">{PROMPT_LIBRARY_STAGE_META[meta.stage].label}</span>
              {!applicable && <span className="ml-auto text-[10px] text-warning">不匹配当前项目</span>}
            </div>
            <div className="mt-1 text-sm text-text-primary line-clamp-2">
              {libraryTemplateTitle(template)}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function PromptLibraryRunner({
  template, project, onBack,
}: {
  template: PromptTemplate
  project: Project
  onBack: () => void
}) {
  const meta = template.library!
  const toast = useToast()
  const dialog = useDialog()
  const aiConfig = useAIConfigStore(s => s.config)
  const ai = useAIStream(`prompt-library:${project.id}:${meta.assetId}`)
  const groups = useWorldGroupStore(s => s.groups)
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  const loadGroups = useWorldGroupStore(s => s.loadAll)
  const nodes = useOutlineStore(s => s.nodes)
  const loadNodes = useOutlineStore(s => s.loadAll)
  const chapters = useChapterStore(s => s.chapters)
  const loadChapters = useChapterStore(s => s.loadAll)
  const refreshChapter = useChapterStore(s => s.refreshChapter)
  const [worldGroupId, setWorldGroupId] = useState<number | null>(project.enableMultiWorld ? activeGroupId : null)
  const [outlineNodeId, setOutlineNodeId] = useState<number | null>(null)
  const [chapterId, setChapterId] = useState<number | null>(null)
  const [manualValues, setManualValues] = useState<Record<string, string>>({})
  const [userHint, setUserHint] = useState('')
  const [copied, setCopied] = useState(false)
  const [adopted, setAdopted] = useState(false)
  const scopeNeeds = getLibraryScopeNeeds(template)
  const sourceKeys = getLibrarySourceKeys(template)

  useEffect(() => {
    Promise.all([loadNodes(project.id!), loadChapters(project.id!), loadGroups(project.id!)]).catch(() => undefined)
  }, [project.id, loadNodes, loadChapters, loadGroups])

  useEffect(() => {
    if (project.enableMultiWorld) setWorldGroupId(activeGroupId)
  }, [project.enableMultiWorld, activeGroupId])

  const handleChapterChange = (value: string) => {
    const next = value ? Number(value) : null
    setChapterId(next)
    const chapter = chapters.find(item => item.id === next)
    if (chapter) setOutlineNodeId(chapter.outlineNodeId)
  }

  const handleRun = async () => {
    if (!project.id) return
    setAdopted(false)
    try {
      const result = await assembleLibraryPromptVariables({
        template,
        project,
        worldGroupId: project.enableMultiWorld ? worldGroupId : null,
        outlineNodeId,
        chapterId,
        manualValues,
        userHint,
        provider: aiConfig.provider,
        model: aiConfig.model,
      })
      if (result.missingScopes.length) {
        const scopeLabels = result.missingScopes.map(scope => ({
          world: '世界', outline: '章纲节点', chapter: '章节',
        }[scope]))
        toast.error(`请先选择${scopeLabels.join('、')}。`)
        return
      }
      if (result.missingVariables.length) {
        toast.error(`请补充必填资料：${result.missingVariables.join('、')}`)
        return
      }
      const { messages, modelOverride } = renderPrompt(template, result.variables)
      await ai.start(messages, modelOverride, {
        category: `library.${meta.stage}`,
        projectId: project.id,
      })
    } catch (error) {
      toast.error(`运行失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleCopy = async () => {
    if (!ai.output) return
    await navigator.clipboard.writeText(ai.output)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const handleAdopt = async () => {
    const contract = meta.output
    if (contract.mode !== 'adopt' || !contract.target || !contract.field || !project.id || !ai.output) return
    if (contract.recordScope === 'chapter' && chapterId == null) {
      toast.error('请先选择要写入的章节。')
      return
    }
    const chapter = chapters.find(item => item.id === chapterId)
    const ok = await dialog.confirm({
      title: contract.adoptMode === 'append' ? '把结果追加到章节正文？' : '用结果替换章节正文？',
      message: contract.adoptMode === 'append'
        ? `将追加到「${chapter?.title ?? '当前章节'}」末尾。`
        : `将替换「${chapter?.title ?? '当前章节'}」的现有正文，请确认已检查生成结果。`,
      confirmText: contract.adoptMode === 'append' ? '追加' : '替换',
      tone: contract.adoptMode === 'append' ? 'info' : 'danger',
    })
    if (!ok) return
    const result = await adopt({
      projectId: project.id,
      worldGroupId: project.enableMultiWorld ? worldGroupId : null,
      target: contract.target,
      recordId: chapterId ?? undefined,
      mode: contract.adoptMode ?? 'replace',
      data: { [contract.field]: ai.output },
    })
    if (!result.written.length) {
      toast.error('没有写入任何内容，请检查章节和输出。')
      return
    }
    if (chapterId != null) await refreshChapter(chapterId)
    setAdopted(true)
    toast.success(`已写入「${chapter?.title ?? '当前章节'}」`)
  }

  const sourceLabels = sourceKeys.map(key => CONTEXT_SOURCE_BY_KEY.get(key)?.label ?? key)

  return (
    <div className="p-4 md:p-5 space-y-5">
      <button
        onClick={onBack}
        className="lg:hidden inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="w-4 h-4" /> 返回 Prompt 列表
      </button>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-accent">{meta.assetId}</span>
          <span className="text-xs px-2 py-0.5 bg-bg-hover text-text-secondary rounded">
            {PROMPT_LIBRARY_STAGE_META[meta.stage].label}
          </span>
          <span className="text-xs px-2 py-0.5 bg-bg-hover text-text-secondary rounded">
            {PROMPT_LIBRARY_TASK_LABELS[meta.taskType]}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded ${
            meta.output.mode === 'adopt' ? 'bg-success/10 text-success' : 'bg-info/10 text-info'
          }`}>
            {meta.output.mode === 'adopt' ? '可采纳' : '仅预览'}
          </span>
        </div>
        <h2 className="mt-2 text-base font-semibold text-text-primary">
          {libraryTemplateTitle(template)}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">{template.description}</p>
      </div>

      <section className="border-y border-border py-3 space-y-2">
        <div className="flex items-start gap-2 text-xs">
          <Database className="w-3.5 h-3.5 mt-0.5 text-text-muted flex-shrink-0" />
          <div>
            <span className="text-text-secondary">自动读取：</span>
            <span className="text-text-primary">{sourceLabels.length ? sourceLabels.join('、') : '无，使用手动输入'}</span>
          </div>
        </div>
        <div className="flex items-start gap-2 text-xs">
          <BookOpen className="w-3.5 h-3.5 mt-0.5 text-text-muted flex-shrink-0" />
          <div>
            <span className="text-text-secondary">结果去向：</span>
            <span className="text-text-primary">{meta.output.suggestedDestination}</span>
          </div>
        </div>
      </section>

      {(scopeNeeds.world || scopeNeeds.outline || scopeNeeds.chapter || meta.output.recordScope === 'chapter') && (
        <section>
          <h3 className="text-sm font-medium text-text-primary mb-2">运行范围</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {project.enableMultiWorld && scopeNeeds.world && (
              <label className="text-xs text-text-secondary">
                世界
                <select
                  value={worldGroupId ?? ''}
                  onChange={event => setWorldGroupId(event.target.value ? Number(event.target.value) : null)}
                  className="mt-1 w-full px-2 py-2 bg-bg-base border border-border rounded text-sm text-text-primary"
                >
                  <option value="">请选择世界</option>
                  {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </label>
            )}
            {(scopeNeeds.chapter || meta.output.recordScope === 'chapter') && (
              <label className="text-xs text-text-secondary">
                章节
                <select
                  value={chapterId ?? ''}
                  onChange={event => handleChapterChange(event.target.value)}
                  className="mt-1 w-full px-2 py-2 bg-bg-base border border-border rounded text-sm text-text-primary"
                >
                  <option value="">请选择章节</option>
                  {chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
                </select>
              </label>
            )}
            {scopeNeeds.outline && (
              <label className="text-xs text-text-secondary">
                大纲节点
                <select
                  value={outlineNodeId ?? ''}
                  onChange={event => setOutlineNodeId(event.target.value ? Number(event.target.value) : null)}
                  className="mt-1 w-full px-2 py-2 bg-bg-base border border-border rounded text-sm text-text-primary"
                >
                  <option value="">请选择大纲节点</option>
                  {nodes.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}
                </select>
              </label>
            )}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-sm font-medium text-text-primary mb-2">输入资料</h3>
        <div className="space-y-3">
          {meta.inputs.map(binding => (
            <label key={binding.variable} className="block">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-xs text-text-primary">{binding.label}</span>
                {binding.required && <span className="text-[10px] text-error">必填</span>}
                {(binding.sourceKeys?.length || binding.projectField) && (
                  <span className="text-[10px] text-info">
                    自动：{[
                      ...(binding.sourceKeys ?? []).map(key => CONTEXT_SOURCE_BY_KEY.get(key)?.label ?? key),
                      ...(binding.projectField ? ['项目信息'] : []),
                    ].join('、')}
                  </span>
                )}
              </div>
              <textarea
                value={manualValues[binding.variable] ?? ''}
                onChange={event => setManualValues(values => ({ ...values, [binding.variable]: event.target.value }))}
                rows={binding.required ? 3 : 2}
                placeholder={binding.placeholder}
                className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
              />
            </label>
          ))}
          <label className="block">
            <span className="block mb-1 text-xs text-text-primary">本次补充要求</span>
            <textarea
              value={userHint}
              onChange={event => setUserHint(event.target.value)}
              rows={2}
              placeholder="可选：本次运行需要特别强调的方向、禁区或输出偏好"
              className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
            />
          </label>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {ai.isStreaming ? (
          <button
            onClick={ai.stop}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-error/10 text-error text-sm rounded hover:bg-error/20"
          >
            <Square className="w-4 h-4" /> 停止
          </button>
        ) : (
          <button
            onClick={handleRun}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent-hover"
          >
            <Play className="w-4 h-4" /> 运行 Prompt
          </button>
        )}
        {ai.output && (
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-bg-hover text-text-primary text-sm rounded hover:bg-bg-elevated"
          >
            {copied ? <Check className="w-4 h-4 text-success" /> : <Clipboard className="w-4 h-4" />}
            {copied ? '已复制' : '复制结果'}
          </button>
        )}
        {ai.output && meta.output.mode === 'adopt' && (
          <button
            onClick={handleAdopt}
            disabled={adopted}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-success/10 text-success text-sm rounded hover:bg-success/20 disabled:opacity-50"
          >
            {adopted ? <Check className="w-4 h-4" /> : <WandSparkles className="w-4 h-4" />}
            {adopted ? '已采纳' : '采纳到章节'}
          </button>
        )}
        {ai.error && <span className="text-xs text-error">{ai.error}</span>}
      </div>

      {(ai.output || ai.isStreaming) && (
        <section>
          <h3 className="text-sm font-medium text-text-primary mb-2">生成结果</h3>
          <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words bg-bg-base border border-border rounded p-4 text-sm leading-6 text-text-primary font-sans">
            {ai.output || '正在生成…'}
          </pre>
        </section>
      )}
    </div>
  )
}

function libraryTemplateTitle(template: PromptTemplate): string {
  const prefix = template.library ? `小说库-${template.library.assetId}-` : ''
  return prefix && template.name.startsWith(prefix) ? template.name.slice(prefix.length) : template.name
}
