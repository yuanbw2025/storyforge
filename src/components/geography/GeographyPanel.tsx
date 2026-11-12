import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, MapPin, GitBranch, List, Sparkles, Image, Copy, Check, Loader2 } from 'lucide-react'
import { useGeographyStore } from '../../stores/project-singletons'
import { useWorldGroupStore } from '../../stores/world-group'
import WorldGroupSwitcher from '../world-group/WorldGroupSwitcher'
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { buildConceptMapPrompt, buildImageMapPrompt } from '../../lib/ai/adapters/geography-adapter'
import type { Project, Location, LocationType } from '../../lib/types'
import { nanoid } from '../../lib/utils/id'
import { sanitizeSvg } from '../../lib/utils/sanitize-svg'
import LocationTreeMap from './LocationTreeMap'
import { useActiveWork } from '../../hooks/useActiveWork'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import ScopedWorldAuthoringBoundary, { worldAuthorViewKey } from '../world-group/ScopedWorldAuthoringBoundary'

const LOCATION_TYPES: { value: LocationType; label: string }[] = [
  { value: 'continent', label: '大陆' },
  { value: 'country', label: '国家' },
  { value: 'city', label: '城市' },
  { value: 'sect', label: '门派驻地' },
  { value: 'secret', label: '秘境' },
  { value: 'ruin', label: '遗迹' },
  { value: 'battlefield', label: '战场' },
  { value: 'nature', label: '自然景观' },
  { value: 'building', label: '建筑' },
  { value: 'other', label: '其他' },
]

export function removeLocationSubtree(locations: Location[], id: string): Location[] {
  const toDelete = new Set<string>()
  const collect = (parentId: string) => {
    toDelete.add(parentId)
    for (const loc of locations) {
      if (loc.parentId === parentId) collect(loc.id)
    }
  }
  collect(id)
  return locations.filter(l => !toDelete.has(l.id))
}

interface Props {
  project: Project
}

export default function GeographyPanel({ project }: Props) {
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  return <ScopedWorldAuthoringBoundary project={project} activeGroupId={activeGroupId}>
    {view => <ScopedGeographyPanel {...view} />}
  </ScopedWorldAuthoringBoundary>
}

function ScopedGeographyPanel({ project, activeGroupId }: Props & { activeGroupId: number | null }) {
  const activeWork = useActiveWork(project)
  const { geography, loadAll, save, loadedScope, loading, loadError } = useGeographyStore()
  const scope = useMemo(() => ({ projectId: project.id!, worldId: project.activeWorldId!, workId: project.activeWorkId! }), [project.id, project.activeWorldId, project.activeWorkId])
  const groupId = project.enableMultiWorld ? activeGroupId : null
  const readReady = !loading && !loadError && loadedScope?.projectId === scope.projectId
    && loadedScope.worldId === scope.worldId && loadedScope.workId === scope.workId
    && useGeographyStore.getState().activeWorldGroupId === groupId
  const [overview, setOverview] = useState('')
  const [locations, setLocations] = useState<Location[]>([])
  const draft = useRef({ overview: '', locations: [] as Location[] })
  const draftReady = useRef(false)
  const draftGroupId = useRef(groupId)
  const dirtyFields = useRef(new Set<'overview' | 'locations'>())
  const [dirty, setDirty] = useState(false)
  const pendingSave = useRef<Promise<void> | null>(null)
  const [saveError, setSaveError] = useState('')
  const [readError, setReadError] = useState('')
  const [saving, setSaving] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useBeforeUnload(dirty || saving)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'map' | 'aimap'>('map')
  const [svgContent, setSvgContent] = useState<string>('')
  const [imagePrompt, setImagePrompt] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const ai = useAIStream(createAISessionKey(
    project.id!,
    'geography.concept-map',
    worldAuthorViewKey({ project, activeGroupId }),
  ))

  useEffect(() => {
    void loadAll(scope, groupId).catch(() => undefined)
  }, [scope, groupId, loadAll])

  useEffect(() => {
    if (!readReady) return
    try {
      const nextOverview = geography ? geography.overview : ''
      const nextLocations: unknown = geography ? JSON.parse(geography.locations) : []
      if (typeof nextOverview !== 'string' || !Array.isArray(nextLocations)
        || nextLocations.some(value => !value || typeof value !== 'object' || typeof value.id !== 'string' || typeof value.name !== 'string')) {
        throw new Error('地理字段格式异常')
      }
      if (!dirtyFields.current.has('overview')) { draft.current.overview = nextOverview; setOverview(nextOverview) }
      if (!dirtyFields.current.has('locations')) { draft.current.locations = nextLocations; setLocations(nextLocations) }
      draftGroupId.current = geography?.worldGroupId ?? groupId
      draftReady.current = true
      setReadError('')
    } catch {
      draftReady.current = false
      setReadError('地理内容无法读取，原数据已保留。请先导出备份并恢复异常字段。')
    }
  }, [geography, readReady, groupId])

  const persistDraft = useCallback(async function persist(): Promise<void> {
    if (pendingSave.current) { await pendingSave.current; return persist() }
    if (!dirtyFields.current.size) return
    if (!draftReady.current) throw new Error('地理读取未完成，输入已保留')
    const before = { ...draft.current }
    const fields = [...dirtyFields.current]
    setSaving(true)
    const operation = save({
      projectId: scope.projectId, worldGroupId: draftGroupId.current,
      ...(fields.includes('overview') ? { overview: before.overview } : {}),
      ...(fields.includes('locations') ? { locations: JSON.stringify(before.locations) } : {}),
    }, scope)
    pendingSave.current = operation
    try {
      await operation
      for (const field of fields) if (draft.current[field] === before[field]) dirtyFields.current.delete(field)
      setDirty(dirtyFields.current.size > 0)
      setSaveError('')
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '保存失败，输入已保留')
      throw cause
    } finally { pendingSave.current = null; setSaving(false) }
  }, [scope, save])
  const persistRef = useRef(persistDraft)
  persistRef.current = persistDraft
  useEffect(() => registerPendingDraftFlusherV1(() => persistRef.current()), [])
  useEffect(() => () => { void persistRef.current().catch(() => undefined) }, [])

  useEffect(() => {
    if (ai.isStreaming || !ai.output || svgContent) return
    const svg = ai.output
      .replace(/^```(?:svg|xml)?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim()
    if (svg.includes('<svg')) {
      setSvgContent(sanitizeSvg(svg))
      setView('aimap')
    }
  }, [ai.isStreaming, ai.output, svgContent])

  const saveLocations = (newLocations: Location[]) => {
    if (!readReady || readError) return
    draft.current.locations = newLocations
    dirtyFields.current.add('locations')
    setDirty(true)
    setLocations(newLocations)
    void persistDraft().catch(() => undefined)
  }

  const handleAddLocation = () => {
    if (!readReady || readError) return
    const newLoc: Location = {
      id: nanoid(),
      name: '新地点',
      type: 'other',
      description: '',
      significance: '',
      parentId: null,
      order: locations.length,
    }
    const updated = [...locations, newLoc]
    setExpandedId(newLoc.id)
    saveLocations(updated)
  }

  const handleUpdateLocation = (id: string, data: Partial<Location>) => {
    const updated = locations.map(l => l.id === id ? { ...l, ...data } : l)
    saveLocations(updated)
  }

  const handleDeleteLocation = (id: string) => {
    saveLocations(removeLocationSubtree(locations, id))
  }

  // AI 概念地图
  const handleGenerateConceptMap = async () => {
    setSvgContent('')
    setView('aimap')
    const messages = buildConceptMapPrompt(overview, locations)
    const result = await ai.start(messages, undefined, {
      formalEntryId: 'world.map.concept', category: 'geography.concept-map', projectId: project.id!,
    })
    if (!mounted.current) return
    // 提取 SVG 代码（去掉可能的 markdown code block）
    const svg = result
      .replace(/^```(?:svg|xml)?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim()
    // 保留既有净化边界；预览以独立图片显示，SVG 样式留在图片内。
    setSvgContent(sanitizeSvg(svg))
  }

  // AI 图像 prompt
  const handleGenerateImagePrompt = () => {
    const prompt = buildImageMapPrompt(activeWork?.title ?? '当前作品', overview, locations)
    setImagePrompt(prompt)
  }

  const handleCopyPrompt = async () => {
    await navigator.clipboard.writeText(imagePrompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-text-primary">🗺️ 地理环境</h2>
        {project.enableMultiWorld && <WorldGroupSwitcher />}
      </div>

      {(loadError || readError) && <div role="alert" className="mb-3 text-sm text-error">
        {loadError || readError}
        <button type="button" className="ml-3 underline" onClick={() => { void loadAll(scope, groupId).catch(() => undefined) }}>重新读取地理</button>
      </div>}
      {saveError && <div role="alert" className="mb-3 text-sm text-error">
        未保存：{saveError} 输入已保留。
        <button type="button" className="ml-3 underline" onClick={() => { void persistDraft().catch(() => undefined) }}>重试保存</button>
      </div>}
      {saving && <p role="status" className="text-xs text-text-muted">正在保存…</p>}
      <fieldset disabled={!readReady || !!readError} inert={!readReady || !!readError} className="contents" aria-label="地理读取保护">

      {/* 总述 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text-secondary mb-1">地理总述</label>
        <textarea
          value={overview}
          onChange={e => {
            draft.current.overview = e.target.value
            dirtyFields.current.add('overview')
            setDirty(true)
            setOverview(e.target.value)
          }}
          onBlur={() => { void persistDraft().catch(() => undefined) }}
          placeholder="描述这个世界的整体地理面貌、大陆分布、气候特征等..."
          className="w-full h-32 p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
      </div>

      {/* 地点工具栏 */}
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-base font-semibold text-text-primary">地点列表 ({locations.length})</h3>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 视图切换 */}
          <div className="flex bg-bg-elevated rounded-lg p-0.5">
            <button
              onClick={() => setView('map')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                view === 'map' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" /> 树状图
            </button>
            <button
              onClick={() => setView('aimap')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                view === 'aimap' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" /> AI地图
            </button>
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                view === 'list' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <List className="w-3.5 h-3.5" /> 列表
            </button>
          </div>
          <button
            onClick={handleAddLocation}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加地点
          </button>
        </div>
      </div>

      {/* 树状图视图 */}
      {view === 'map' && <div className="mb-6"><LocationTreeMap locations={locations} /></div>}

      {/* AI 概念地图视图 */}
      {view === 'aimap' && (
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={handleGenerateConceptMap}
              disabled={ai.isStreaming || locations.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {ai.isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {ai.isStreaming ? 'AI 生成中...' : '生成 AI 概念地图'}
            </button>
            <button
              onClick={handleGenerateImagePrompt}
              disabled={locations.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-elevated text-text-secondary text-sm rounded-md hover:text-text-primary disabled:opacity-50 transition-colors"
            >
              <Image className="w-4 h-4" />
              生成图像 Prompt
            </button>
            {locations.length === 0 && (
              <span className="text-xs text-text-muted">请先在列表中添加地点</span>
            )}
          </div>

          {/* SVG 概念地图输出 */}
          {ai.isStreaming && !svgContent && (
            <div className="flex items-center gap-2 text-text-muted text-sm py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              AI 正在绘制地图...
              {ai.output.length > 0 && (
                <span className="text-xs">≈ ~{Math.round(ai.output.length * 1.5).toLocaleString()} tokens</span>
              )}
            </div>
          )}
          {ai.tokenUsage && !ai.isStreaming && (
            <div className="text-[10px] text-text-muted mb-2">
              Token: ↑{ai.tokenUsage.inputTokens.toLocaleString()} ↓{ai.tokenUsage.outputTokens.toLocaleString()}
            </div>
          )}
          {ai.error && (
            <div className="text-error text-sm p-3 bg-error/10 rounded-lg">{ai.error}</div>
          )}
          {svgContent && (
            <GeographySvgPreview svg={svgContent} />
          )}

          {/* 图像生成 Prompt */}
          {imagePrompt && (
            <div className="mt-4 p-3 bg-bg-elevated border border-border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-secondary flex items-center gap-1">
                  <Image className="w-3.5 h-3.5" /> 图像生成 Prompt（适用于 Midjourney / DALL-E）
                </span>
                <button
                  onClick={handleCopyPrompt}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-accent transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <p className="text-xs text-text-muted leading-relaxed break-words select-all">{imagePrompt}</p>
            </div>
          )}
        </div>
      )}

      <div className={`space-y-2 ${view === 'map' ? 'hidden' : ''}`}>
        {locations.length === 0 ? (
          <p className="text-text-muted text-sm py-8 text-center">暂无地点，点击上方按钮添加</p>
        ) : (
          locations.map(loc => {
            const isExpanded = expandedId === loc.id
            return (
              <div key={loc.id} className="border border-border rounded-lg bg-bg-surface overflow-hidden">
                {/* 头部 */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : loc.id)}
                  className="w-full flex items-center gap-2 px-4 py-3 hover:bg-bg-hover transition-colors"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
                  <MapPin className="w-4 h-4 text-accent" />
                  <span className="text-sm font-medium text-text-primary flex-1 text-left">{loc.name}</span>
                  <span className="text-xs text-text-muted bg-bg-elevated px-2 py-0.5 rounded">
                    {LOCATION_TYPES.find(t => t.value === loc.type)?.label || loc.type}
                  </span>
                </button>

                {/* 展开编辑 */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-text-muted mb-1">名称</label>
                        <input
                          value={loc.name}
                          onChange={e => handleUpdateLocation(loc.id, { name: e.target.value })}
                          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">类型</label>
                        <select
                          value={loc.type}
                          onChange={e => handleUpdateLocation(loc.id, { type: e.target.value as LocationType })}
                          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        >
                          {LOCATION_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">上级地点</label>
                        <select
                          value={loc.parentId ?? ''}
                          onChange={e => handleUpdateLocation(loc.id, { parentId: e.target.value || null })}
                          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        >
                          <option value="">（顶级）</option>
                          {locations.filter(l => l.id !== loc.id).map(l => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">描述</label>
                      <textarea
                        value={loc.description}
                        onChange={e => handleUpdateLocation(loc.id, { description: e.target.value })}
                        className="w-full h-20 p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">剧情重要性</label>
                      <input
                        value={loc.significance}
                        onChange={e => handleUpdateLocation(loc.id, { significance: e.target.value })}
                        className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleDeleteLocation(loc.id)}
                        className="flex items-center gap-1 px-3 py-1.5 text-red-400 hover:bg-red-500/10 text-xs rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        删除地点
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
      </fieldset>
    </div>
  )
}


type SvgPreviewUrl = { source: string; url: string; attempt: number; dispose: () => void }

/** The component owns only its temporary image URL, never stored SVG/media. */
function GeographySvgPreview({ svg }: { svg: string }) {
  const [preview, setPreview] = useState<SvgPreviewUrl | null>(null)
  const owned = useRef<SvgPreviewUrl | null>(null)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    try {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      let disposed = false
      const current: SvgPreviewUrl = { source: svg, url, attempt, dispose: () => {
        if (!disposed) { disposed = true; URL.revokeObjectURL(url) }
      } }
      owned.current = current
      setPreview(current)
      setFailedSource(null)
      return () => {
        if (owned.current === current) owned.current = null
        current.dispose()
      }
    } catch {
      owned.current = null
      setPreview(null)
      setFailedSource(svg)
    }
  }, [svg, attempt])
  const currentUrl = preview?.source === svg && preview.attempt === attempt ? preview.url : undefined
  const handleImageError = () => {
    if (!preview || owned.current !== preview || preview.source !== svg || preview.attempt !== attempt) return
    owned.current = null
    preview.dispose()
    setPreview(null)
    setFailedSource(svg)
  }
  return <div className="rounded-lg overflow-hidden border border-border bg-bg-base">
    {currentUrl ? <img key={`${attempt}:${currentUrl}`} src={currentUrl} onError={handleImageError} alt="地理概念地图" className="block h-auto w-full" />
      : failedSource === svg && <div role="alert" className="p-3 text-sm text-text-secondary">
        地图预览暂不可用，原图已保留。
        <button type="button" className="ml-3 underline" onClick={() => setAttempt(value => value + 1)}>重试预览</button>
      </div>}
  </div>
}
