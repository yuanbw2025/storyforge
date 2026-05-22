import { useEffect, useState, useRef, useCallback } from 'react'
import {
  Trash2, Library, BookMarked, Palette, Upload,
  Globe, Users2, ListTree, PenTool, ChevronDown, ChevronRight,
  Microscope, Loader2, UploadCloud, StopCircle, BarChart3,
} from 'lucide-react'
import { useReferenceStore } from '../../stores/reference'
import type {
  Project, Reference, ReferenceType,
  ReferenceChunkAnalysis, ReferenceAnalysisDepth,
} from '../../lib/types'
import { DIMENSION_LABELS, ANALYSIS_DIMENSIONS } from '../../lib/types/reference'
import type { WritingTechniques } from '../../lib/types/import-session-data'
import {
  planRefChunks,
  registerRefChunks,
  runRefAnalysis,
  cancelRefAnalysisPipeline,
  setRefAnalysisPipelineListener,
} from '../../lib/reference-analysis/pipeline'

// ── 常量 ─────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<ReferenceType, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  story: { label: '故事参考', icon: BookMarked, color: 'text-accent bg-accent/10 border-accent/30' },
  style: { label: '风格参考', icon: Palette,   color: 'text-purple-400 bg-purple-500/10 border-purple-400/30' },
}

/** 世界观字段 → 中文标签映射 */
const WV_LABELS: Record<string, string> = {
  worldOrigin: '世界来源',
  powerHierarchy: '力量层次',
  worldStructure: '世界结构',
  worldDimensions: '世界尺寸',
  continentLayout: '大陆分布',
  regionDimensions: '区域面积',
  mountainsRivers: '山川河流',
  climateByRegion: '分区域气候',
  historyLine: '世界历史线',
  worldEvents: '世界大事记',
  races: '种族设定',
  factionLayout: '势力分布',
  politicsEconomyCulture: '政治/经济/文化',
  internalConflicts: '矛盾冲突',
  itemDesign: '道具设计',
}

/** 写作技法字段 → 中文标签映射 */
const WT_LABELS: Record<string, string> = {
  narrativeStyle: '叙事视角与手法',
  proseStyle: '文笔风格',
  openingTechnique: '开篇技法 / 黄金三章',
  plotStructure: '情节结构与套路',
  climaxDesign: '高潮设计',
  pacingControl: '节奏控制',
  characterCraft: '人物塑造手法',
  dialogueTechnique: '对话技巧',
  conflictEscalation: '冲突设计与升级',
  emotionalBeats: '爽点 / 情绪节拍',
  foreshadowing: '伏笔与回收',
  otherTechniques: '其他技巧',
}

const GLYPH_COLORS = [
  'bg-[#C17D5E]/15 text-[#C17D5E]',
  'bg-[#7BA08A]/15 text-[#7BA08A]',
  'bg-[#8B7BB0]/15 text-[#8B7BB0]',
  'bg-[#B08B6B]/15 text-[#B08B6B]',
  'bg-[#6B8EB0]/15 text-[#6B8EB0]',
  'bg-[#B06B7B]/15 text-[#B06B7B]',
]

interface Props { project: Project }

// ── 主面板 ─────────────────────────────────────────────────────────

export default function ReferencePanel({ project }: Props) {
  const { references, loadAll, updateReference, deleteReference } = useReferenceStore()
  const [filter, setFilter] = useState<ReferenceType | 'all'>('all')
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const displayed = filter === 'all'
    ? references
    : references.filter(r => r.type === filter)

  const storyCount = references.filter(r => r.type === 'story').length
  const styleCount = references.filter(r => r.type === 'style').length
  const importedCount = references.filter(r => r.importedData).length

  const selectedRef = references.find(r => r.id === selected)

  const handleDelete = async (ref: Reference) => {
    if (!confirm(`确定删除「${ref.title}」？`)) return
    await deleteReference(ref.id!)
    if (selected === ref.id) setSelected(null)
  }

  return (
    <div className="flex gap-4">
      {/* 左侧列表 */}
      <div className="w-52 shrink-0 space-y-2">
        {/* 导入提示 */}
        <div className="bg-bg-elevated rounded-lg p-2.5 text-xs text-text-muted">
          <Upload className="w-3.5 h-3.5 inline mr-1 text-accent" />
          通过侧边栏「导入」上传文档，解析后选择「导入项目参考」即可自动添加到此处。
        </div>

        {/* 筛选 tabs */}
        <div className="flex gap-1 bg-bg-elevated rounded-lg p-1">
          {([['all', '全部', references.length], ['story', '故事', storyCount], ['style', '风格', styleCount]] as const).map(
            ([v, l, c]) => (
              <button
                key={v}
                onClick={() => setFilter(v)}
                className={`flex-1 text-xs py-1 rounded px-1 transition-colors ${filter === v ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary'}`}
              >
                {l} {c > 0 && <span className="opacity-70">({c})</span>}
              </button>
            )
          )}
        </div>

        {importedCount > 0 && (
          <div className="text-[10px] text-text-muted px-1">
            其中 {importedCount} 条来自导入解析
          </div>
        )}

        {/* 列表 */}
        <div className="space-y-0.5 max-h-[calc(100vh-320px)] overflow-y-auto">
          {displayed.length === 0 && (
            <div className="text-center text-text-muted text-sm py-8">
              <Library className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>暂无项目参考</p>
            </div>
          )}
          {displayed.map((ref, i) => {
            const cfg = TYPE_CONFIG[ref.type]
            const active = selected === ref.id
            const hasImported = !!ref.importedData
            const colorClass = GLYPH_COLORS[i % GLYPH_COLORS.length]
            return (
              <button
                key={ref.id}
                onClick={() => setSelected(active ? null : ref.id!)}
                className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-all ${
                  active
                    ? 'bg-accent/8 border-l-2 border-accent'
                    : 'hover:bg-bg-hover border-l-2 border-transparent'
                }`}
              >
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${colorClass}`}>
                  {ref.title.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium truncate ${active ? 'text-accent' : 'text-text-primary'}`}>{ref.title}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className={`text-[10px] px-1 py-0.5 rounded border ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    {hasImported && (
                      <span className="text-[10px] px-1 py-0.5 rounded border border-blue-400/30 text-blue-400 bg-blue-400/10">
                        已导入
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* 右侧详情 */}
      <div className="flex-1 min-w-0">
        {selectedRef ? (
          <ReferenceDetailCard
            reference={selectedRef}
            refIndex={references.findIndex(r => r.id === selectedRef.id)}
            onUpdate={(data) => {
              if (selectedRef?.id) {
                updateReference(selectedRef.id, data)
              }
            }}
            onDelete={() => handleDelete(selectedRef)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-text-muted text-sm gap-3">
            <Library className="w-12 h-12 opacity-20" />
            <p>← 从左侧选择一条项目参考查看详情</p>
            <div className="text-xs text-text-muted/60 text-center max-w-xs space-y-0.5">
              <p>· <span className="text-accent">故事参考</span>：借鉴情节结构、世界观框架</p>
              <p>· <span className="text-purple-400">风格参考</span>：借鉴文风、叙事节奏</p>
              <p>· <span className="text-blue-400">导入参考</span>：通过「导入」解析文档自动填充</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 详情卡 ────────────────────────────────────────────────────────

type DetailTab = 'worldview' | 'characters' | 'outline' | 'techniques' | 'deep-analysis' | 'info'

function ReferenceDetailCard({
  reference, refIndex, onUpdate, onDelete,
}: {
  reference: Reference
  refIndex: number
  onUpdate: (data: Partial<Reference>) => void
  onDelete: () => void
}) {
  const data = reference.importedData
  const glyphColor = GLYPH_COLORS[refIndex % GLYPH_COLORS.length]
  const cfg = TYPE_CONFIG[reference.type]

  // 导入的参考有结构化数据，分tab展示
  const hasTabs = !!data
  const worldviewEntries = data?.worldview ? Object.entries(data.worldview).filter(([, v]) => v?.trim()) : []
  const characters = data?.characters || []
  const outline = data?.outline || []
  const wt = data?.writingTechniques
  const wtEntries = wt ? Object.entries(wt).filter(([, v]) => typeof v === 'string' && v.trim()) : []

  const availableTabs: { key: DetailTab; label: string; icon: React.ComponentType<{ className?: string }>; count?: number }[] = []
  // 深度分析始终显示（可上传文件触发分析）
  availableTabs.push({ key: 'deep-analysis', label: '深度分析', icon: Microscope })
  if (hasTabs) {
    if (wtEntries.length > 0) availableTabs.push({ key: 'techniques', label: '写作技法', icon: PenTool, count: wtEntries.length })
    if (worldviewEntries.length > 0) availableTabs.push({ key: 'worldview', label: '世界观', icon: Globe, count: worldviewEntries.length })
    if (characters.length > 0) availableTabs.push({ key: 'characters', label: '角色', icon: Users2, count: characters.length })
    if (outline.length > 0) availableTabs.push({ key: 'outline', label: '大纲', icon: ListTree, count: outline.length })
  }
  availableTabs.push({ key: 'info', label: '基本信息', icon: BookMarked })

  const [activeTab, setActiveTab] = useState<DetailTab>(availableTabs[0]?.key || 'info')

  // 确保切换参考时 tab 合法
  useEffect(() => {
    const valid = availableTabs.map(t => t.key)
    if (!valid.includes(activeTab)) setActiveTab(valid[0] || 'info')
  }, [reference.id])

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex items-start gap-4">
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-serif font-bold shrink-0 ${glyphColor}`}>
          {reference.title.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs mb-0.5">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${cfg.color}`}>
              {cfg.label}
            </span>
            {data && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-400/30 text-blue-400 bg-blue-400/10">
                已导入
              </span>
            )}
          </div>
          <h3 className="text-xl font-bold font-serif text-text-primary">{reference.title}</h3>
          {reference.author && <p className="text-sm text-text-muted">{reference.author}</p>}
          {data?.sourceFilename && (
            <p className="text-[10px] text-text-muted mt-0.5">
              来源文件：{data.sourceFilename}
              {data.importedAt && ` · 导入于 ${new Date(data.importedAt).toLocaleString('zh-CN')}`}
            </p>
          )}
        </div>
        <button onClick={onDelete} className="p-1.5 text-text-muted hover:text-error rounded transition-colors shrink-0">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Tab 切换 */}
      {availableTabs.length > 1 && (
        <div className="flex gap-1 border-b border-border pb-0">
          {availableTabs.map(tab => {
            const Icon = tab.icon
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-t transition-colors border-b-2 ${
                  active
                    ? 'border-accent text-accent font-medium'
                    : 'border-transparent text-text-muted hover:text-text-secondary'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                {tab.count != null && <span className="opacity-60">({tab.count})</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Tab 内容 */}
      <div>
        {activeTab === 'info' && (
          <InfoTab reference={reference} onUpdate={onUpdate} />
        )}
        {activeTab === 'worldview' && (
          <WorldviewTab entries={worldviewEntries} />
        )}
        {activeTab === 'characters' && (
          <CharactersTab characters={characters} />
        )}
        {activeTab === 'outline' && (
          <OutlineTab outline={outline} />
        )}
        {activeTab === 'techniques' && (
          <TechniquesTab techniques={data?.writingTechniques} />
        )}
        {activeTab === 'deep-analysis' && (
          <DeepAnalysisTab reference={reference} onUpdate={onUpdate} />
        )}
      </div>
    </div>
  )
}

// ── 各 Tab ────────────────────────────────────────────────────────

function InfoTab({
  reference, onUpdate,
}: {
  reference: Reference
  onUpdate: (data: Partial<Reference>) => void
}) {
  return (
    <div className="space-y-0 divide-y divide-border/40">
      <div className="flex gap-4 py-3">
        <span className="w-16 shrink-0 text-xs text-text-muted pt-0.5 text-right">标题</span>
        <div className="flex-1 min-w-0">
          <InlineInput value={reference.title} onChange={v => onUpdate({ title: v })} className="text-sm font-medium text-text-primary" />
        </div>
      </div>
      <div className="flex gap-4 py-3">
        <span className="w-16 shrink-0 text-xs text-text-muted pt-0.5 text-right">作者</span>
        <div className="flex-1 min-w-0">
          <InlineInput value={reference.author} onChange={v => onUpdate({ author: v })} placeholder="点击填写作者…" className="text-sm text-text-primary" />
        </div>
      </div>
      <div className="flex gap-4 py-3">
        <span className="w-16 shrink-0 text-xs text-text-muted pt-0.5 text-right">参考要点</span>
        <div className="flex-1 min-w-0">
          <InlineTextarea value={reference.note} onChange={v => onUpdate({ note: v })} placeholder="记录你希望借鉴这部作品的哪些方面…" />
        </div>
      </div>
    </div>
  )
}

function WorldviewTab({ entries }: { entries: [string, string][] }) {
  return (
    <div className="space-y-0 divide-y divide-border/40">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-4 py-3">
          <span className="w-24 shrink-0 text-xs text-accent pt-0.5 text-right font-medium">
            {WV_LABELS[key] || key}
          </span>
          <div className="flex-1 min-w-0 text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
            {value}
          </div>
        </div>
      ))}
    </div>
  )
}

function CharactersTab({ characters }: { characters: Array<Record<string, unknown>> }) {
  const [expanded, setExpanded] = useState<number | null>(null)

  return (
    <div className="space-y-0.5">
      {characters.map((c, i) => {
        const name = String(c.name || '未命名')
        const role = String(c.role || '')
        const desc = c.shortDescription ? String(c.shortDescription) : ''
        const isExpanded = expanded === i
        const colorClass = GLYPH_COLORS[i % GLYPH_COLORS.length]

        const detailFields = [
          ['外貌', c.appearance],
          ['性格', c.personality],
          ['背景', c.background],
          ['动机', c.motivation],
          ['能力', c.abilities],
          ['关系', c.relationships],
          ['弧光', c.arc],
        ].filter(([, v]) => v && String(v).trim()) as [string, unknown][]

        return (
          <div key={i}>
            <button
              onClick={() => setExpanded(isExpanded ? null : i)}
              className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-all ${
                isExpanded ? 'bg-accent/8' : 'hover:bg-bg-hover'
              }`}
            >
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${colorClass}`}>
                {name.charAt(0)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">{name}</p>
                {desc && <p className="text-[10px] text-text-muted truncate">{desc}</p>}
              </div>
              {role && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted shrink-0">
                  {role}
                </span>
              )}
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />}
            </button>
            {isExpanded && detailFields.length > 0 && (
              <div className="ml-12 space-y-0 divide-y divide-border/30 mb-2">
                {detailFields.map(([label, val]) => (
                  <div key={label} className="flex gap-4 py-2">
                    <span className="w-12 shrink-0 text-xs text-text-muted text-right">{label}</span>
                    <div className="flex-1 text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                      {String(val)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function OutlineTab({ outline }: { outline: Array<Record<string, unknown>> }) {
  return (
    <div className="space-y-1">
      {outline.map((n, i) => (
        <OutlineNodeView key={i} node={n} depth={0} />
      ))}
    </div>
  )
}

function TechniquesTab({ techniques }: { techniques?: WritingTechniques }) {
  if (!techniques) return <div className="text-sm text-text-muted py-4">暂无写作技法分析</div>

  const entries = Object.entries(techniques).filter(([, v]) => typeof v === 'string' && v.trim())
  if (entries.length === 0) return <div className="text-sm text-text-muted py-4">暂无写作技法分析</div>

  return (
    <div className="space-y-0 divide-y divide-border/40">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-4 py-3">
          <span className="w-28 shrink-0 text-xs text-purple-400 pt-0.5 text-right font-medium">
            {WT_LABELS[key] || key}
          </span>
          <div className="flex-1 min-w-0 text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
            {String(value)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 深度分析 Tab ────────────────────────────────────────────────

function DeepAnalysisTab({
  reference, onUpdate,
}: {
  reference: Reference
  onUpdate: (data: Partial<Reference>) => void
}) {
  const { getChunkAnalyses, clearChunkAnalyses } = useReferenceStore()
  const [chunks, setChunks] = useState<ReferenceChunkAnalysis[]>([])
  const [depth, setDepth] = useState<ReferenceAnalysisDepth>(reference.analysisDepth || 'standard')
  const [progress, setProgress] = useState(reference.analysisProgress || 0)
  const [statusMsg, setStatusMsg] = useState('')
  const [activityLog, setActivityLog] = useState<{ level: string; msg: string }[]>([])
  const [running, setRunning] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const status = reference.analysisStatus || 'none'

  // 加载已有分析结果
  useEffect(() => {
    if (reference.id && (status === 'done' || status === 'analyzing')) {
      getChunkAnalyses(reference.id).then(setChunks)
    }
  }, [reference.id, status, getChunkAnalyses])

  // 设置 pipeline listener
  useEffect(() => {
    setRefAnalysisPipelineListener({
      onProgress: (p, msg) => {
        setProgress(p)
        if (msg) setStatusMsg(msg)
      },
      onActivity: (level, msg) => {
        setActivityLog(prev => [...prev.slice(-20), { level, msg }])
      },
      onDone: (refId, _success) => {
        setRunning(false)
        if (reference.id === refId) {
          getChunkAnalyses(refId).then(setChunks)
        }
      },
    })
    return () => setRefAnalysisPipelineListener({})
  }, [reference.id, getChunkAnalyses])

  // 上传文件并开始分析
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !reference.id) return

    const text = await file.text()
    if (!text.trim()) {
      setStatusMsg('文件内容为空')
      return
    }

    // 规划分块
    const plan = planRefChunks(text, depth)

    // 更新 Reference 元数据
    onUpdate({
      totalChars: plan.totalChars,
      fileHash: plan.fileHash,
      analysisDepth: depth,
      analysisStatus: 'pending',
      analysisProgress: 0,
      analysisError: undefined,
    })

    // 如果有旧分析结果，清理
    await clearChunkAnalyses(reference.id)
    setChunks([])

    // 注册分块到内存
    registerRefChunks(reference.id, plan.chunks)

    setStatusMsg(`已加载「${file.name}」，共 ${plan.totalChars.toLocaleString()} 字，分 ${plan.chunks.length} 块`)
    setActivityLog([])

    // 启动分析
    setRunning(true)
    setProgress(0)
    runRefAnalysis(reference.id)

    // 清空 file input
    e.target.value = ''
  }

  const handleCancel = () => {
    cancelRefAnalysisPipeline()
    setRunning(false)
  }

  const handleReanalyze = async () => {
    if (!reference.id) return
    setStatusMsg('请上传文件以重新分析')
    fileInputRef.current?.click()
  }

  const isAnalyzing = status === 'analyzing' || running

  return (
    <div className="space-y-4">
      {/* 说明 */}
      <div className="bg-bg-elevated rounded-lg p-3 text-xs text-text-muted leading-relaxed">
        <Microscope className="w-4 h-4 inline mr-1.5 text-accent" />
        上传优秀网文 / 小说样本，让 AI 从
        <span className="text-accent font-medium"> 叙事架构、开篇技法、情节节奏、人物塑造、冲突升级、伏笔悬念、文笔对话、世界观构建 </span>
        八个维度提炼创作方法论。分析结果永久保留在浏览器本地，创作时可「引用手法」注入 AI prompt 上下文。
      </div>

      {/* 操作区 */}
      {!isAnalyzing && status !== 'done' && (
        <div className="flex items-center gap-3">
          {/* 深度选择 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">分析深度：</span>
            <select
              value={depth}
              onChange={e => setDepth(e.target.value as ReferenceAnalysisDepth)}
              className="bg-bg-elevated border border-border rounded px-2 py-1 text-xs text-text-primary"
            >
              <option value="quick">快速（大块，省 token）</option>
              <option value="standard">标准（推荐）</option>
              <option value="deep">深度（细块，最详尽）</option>
            </select>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.epub"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors"
          >
            <UploadCloud className="w-4 h-4" />
            上传文件并分析
          </button>
        </div>
      )}

      {/* 分析进度 */}
      {isAnalyzing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-accent">
              <Loader2 className="w-4 h-4 animate-spin" />
              正在分析...
            </div>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 px-3 py-1 text-xs text-red-400 hover:text-red-300 border border-red-400/30 rounded transition-colors"
            >
              <StopCircle className="w-3.5 h-3.5" />
              取消
            </button>
          </div>
          <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-xs text-text-muted">{progress}% — {statusMsg}</div>
        </div>
      )}

      {/* 分析完成 */}
      {status === 'done' && !isAnalyzing && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-green-400">
            <BarChart3 className="w-4 h-4" />
            分析完成 — 共 {chunks.length} 块
            {reference.totalChars && <span className="text-text-muted text-xs">（{reference.totalChars.toLocaleString()} 字）</span>}
          </div>
          <button
            onClick={handleReanalyze}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-text-muted hover:text-accent border border-border rounded-lg transition-colors"
          >
            重新分析
          </button>
        </div>
      )}

      {/* 分析失败 */}
      {status === 'failed' && !isAnalyzing && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400">分析失败</p>
          {reference.analysisError && <p className="text-xs text-text-muted mt-1">{reference.analysisError}</p>}
          <button
            onClick={handleReanalyze}
            className="mt-2 flex items-center gap-1 px-3 py-1.5 text-xs text-accent border border-accent/30 rounded-lg hover:bg-accent/10 transition-colors"
          >
            重新上传并分析
          </button>
        </div>
      )}

      {/* 活动日志（分析中显示） */}
      {isAnalyzing && activityLog.length > 0 && (
        <div className="bg-bg-elevated rounded-lg p-2 max-h-28 overflow-y-auto text-[11px] font-mono space-y-0.5">
          {activityLog.map((log, i) => (
            <div key={i} className={
              log.level === 'error' ? 'text-red-400' :
              log.level === 'warn' ? 'text-yellow-400' :
              log.level === 'success' ? 'text-green-400' :
              'text-text-muted'
            }>{log.msg}</div>
          ))}
        </div>
      )}

      {/* 分块分析结果 */}
      {chunks.length > 0 && !isAnalyzing && (
        <ChunkAnalysisViewer chunks={chunks} />
      )}
    </div>
  )
}

/** 分块分析查看器 —— 可切换块 + 按维度展示 */
function ChunkAnalysisViewer({ chunks }: { chunks: ReferenceChunkAnalysis[] }) {
  const [selectedChunk, setSelectedChunk] = useState(0)
  const [expandedDims, setExpandedDims] = useState<Set<string>>(new Set(ANALYSIS_DIMENSIONS))

  const chunk = chunks[selectedChunk]
  if (!chunk) return null

  const toggleDim = (dim: string) => {
    setExpandedDims(prev => {
      const next = new Set(prev)
      if (next.has(dim)) next.delete(dim)
      else next.add(dim)
      return next
    })
  }

  const dimColors: Record<string, string> = {
    narrativeStructure: 'text-blue-400 border-blue-400/30',
    openingTechnique:   'text-amber-400 border-amber-400/30',
    plotRhythm:         'text-green-400 border-green-400/30',
    characterCraft:     'text-purple-400 border-purple-400/30',
    conflictEscalation: 'text-red-400 border-red-400/30',
    foreshadowing:      'text-cyan-400 border-cyan-400/30',
    proseAndDialogue:   'text-pink-400 border-pink-400/30',
    worldBuilding:      'text-teal-400 border-teal-400/30',
  }

  return (
    <div className="space-y-3">
      {/* 块选择器 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted">分块：</span>
        <div className="flex flex-wrap gap-1">
          {chunks.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setSelectedChunk(i)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                i === selectedChunk
                  ? 'bg-accent text-white'
                  : 'bg-bg-elevated text-text-muted hover:text-text-secondary'
              }`}
            >
              {c.label || `块 ${i + 1}`}
            </button>
          ))}
        </div>
      </div>

      {/* 八维内容 */}
      <div className="space-y-1">
        {ANALYSIS_DIMENSIONS.map(dim => {
          const content = chunk[dim]
          if (!content || content === '本块未涉及') return null
          const isExpanded = expandedDims.has(dim)
          const colorClass = dimColors[dim] || 'text-text-muted border-border'

          return (
            <div key={dim} className="border border-border/40 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleDim(dim)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover transition-colors"
              >
                {isExpanded
                  ? <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  : <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
                }
                <span className={`text-xs font-medium ${colorClass.split(' ')[0]}`}>
                  {DIMENSION_LABELS[dim]}
                </span>
              </button>
              {isExpanded && (
                <div className="px-3 pb-3 text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                  {content}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 精彩片段 */}
      {chunk.rawExcerpt && (
        <div className="border border-border/40 rounded-lg p-3">
          <h4 className="text-xs font-medium text-text-muted mb-1.5">精彩片段引用</h4>
          <div className="text-sm text-text-secondary italic leading-relaxed whitespace-pre-wrap">
            {chunk.rawExcerpt}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 子组件 ────────────────────────────────────────────────────────

function OutlineNodeView({ node, depth }: { node: Record<string, unknown>; depth: number }) {
  const title = String(node.title || '未命名')
  const summary = node.summary ? String(node.summary) : ''
  const children = Array.isArray(node.children) ? node.children : []
  const [collapsed, setCollapsed] = useState(depth > 1)

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <button
        onClick={() => children.length > 0 && setCollapsed(!collapsed)}
        className="w-full text-left flex items-center gap-1.5 py-1.5 px-2 rounded hover:bg-bg-hover transition-colors"
      >
        {children.length > 0 && (
          collapsed ? <ChevronRight className="w-3 h-3 text-text-muted shrink-0" /> : <ChevronDown className="w-3 h-3 text-text-muted shrink-0" />
        )}
        <span className="text-sm font-medium text-text-primary">{title}</span>
      </button>
      {summary && <p className="text-xs text-text-muted pl-8 pb-1">{summary}</p>}
      {!collapsed && children.map((child, i) => (
        <OutlineNodeView key={i} node={child as Record<string, unknown>} depth={depth + 1} />
      ))}
    </div>
  )
}

// ── 行内编辑：单行 ────────────────────────────────────────────────

function InlineInput({
  value, onChange, className, placeholder,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onChange(draft)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        placeholder={placeholder}
        className={`bg-transparent border-b border-accent/50 outline-none w-full ${className || ''}`}
        autoFocus
      />
    )
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className={`cursor-text min-h-[1.2em] ${className || ''} ${!value ? 'opacity-40' : ''}`}
    >
      {value || (placeholder || '点击编辑…')}
    </div>
  )
}

// ── 行内编辑：多行 ────────────────────────────────────────────────

function InlineTextarea({
  value, onChange, placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setDraft(value) }, [value])

  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.max(32, el.scrollHeight) + 'px'
  }, [])

  useEffect(() => { if (editing) resize() }, [editing, resize])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onChange(draft)
  }

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={draft}
        onChange={e => { setDraft(e.target.value); resize() }}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        placeholder={placeholder}
        className="w-full bg-transparent border border-accent/30 rounded px-2 py-1 text-sm text-text-primary outline-none resize-none"
        autoFocus
      />
    )
  }

  if (!value) {
    return (
      <div
        onClick={() => setEditing(true)}
        className="text-sm text-text-muted/40 cursor-text py-0.5"
      >
        {placeholder || '点击编辑…'}
      </div>
    )
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap cursor-text py-0.5"
    >
      {value}
    </div>
  )
}
