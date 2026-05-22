import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, MapPin, GitBranch, List, Sparkles, Image, Copy, Check, Loader2 } from 'lucide-react'
import { useGeographyStore } from '../../stores/project-singletons'
import { useAIStream } from '../../hooks/useAIStream'
import { buildConceptMapPrompt, buildImageMapPrompt } from '../../lib/ai/adapters/geography-adapter'
import type { Project, Location, LocationType } from '../../lib/types'
import { nanoid } from '../../lib/utils/id'
import LocationTreeMap from './LocationTreeMap'

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

interface Props {
  project: Project
}

export default function GeographyPanel({ project }: Props) {
  const { geography, loadAll, save } = useGeographyStore()
  const [overview, setOverview] = useState('')
  const [locations, setLocations] = useState<Location[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'map' | 'aimap'>('map')
  const [svgContent, setSvgContent] = useState<string>('')
  const [imagePrompt, setImagePrompt] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const ai = useAIStream()

  useEffect(() => {
    loadAll(project.id!)
  }, [project.id, loadAll])

  useEffect(() => {
    if (geography) {
      setOverview(geography.overview || '')
      try {
        setLocations(JSON.parse(geography.locations || '[]'))
      } catch {
        setLocations([])
      }
    }
  }, [geography])

  const saveLocations = useCallback(async (newLocations: Location[]) => {
    setLocations(newLocations)
    await save({
      projectId: project.id!,
      locations: JSON.stringify(newLocations),
    })
  }, [project.id, save])

  const handleSaveOverview = async () => {
    await save({ projectId: project.id!, overview })
  }

  const handleAddLocation = () => {
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
    const updated = locations.filter(l => l.id !== id && l.parentId !== id)
    saveLocations(updated)
  }

  // AI 概念地图
  const handleGenerateConceptMap = async () => {
    setSvgContent('')
    setView('aimap')
    const messages = buildConceptMapPrompt(overview, locations)
    const result = await ai.start(messages)
    // 提取 SVG 代码（去掉可能的 markdown code block）
    const svg = result
      .replace(/^```(?:svg|xml)?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim()
    setSvgContent(svg)
  }

  // AI 图像 prompt
  const handleGenerateImagePrompt = () => {
    const prompt = buildImageMapPrompt(project.name, overview, locations)
    setImagePrompt(prompt)
  }

  const handleCopyPrompt = async () => {
    await navigator.clipboard.writeText(imagePrompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold text-text-primary mb-4">🗺️ 地理环境</h2>

      {/* 总述 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text-secondary mb-1">地理总述</label>
        <textarea
          value={overview}
          onChange={e => setOverview(e.target.value)}
          onBlur={handleSaveOverview}
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
            </div>
          )}
          {ai.error && (
            <div className="text-error text-sm p-3 bg-error/10 rounded-lg">{ai.error}</div>
          )}
          {svgContent && (
            <div
              className="rounded-lg overflow-hidden border border-border bg-bg-base"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
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
                    <div className="grid grid-cols-2 gap-3">
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
    </div>
  )
}
