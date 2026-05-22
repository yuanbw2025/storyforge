import { useState, useEffect, useRef, useCallback } from 'react'
import { Sparkles } from 'lucide-react'
import { useWorldviewStore } from '../../stores/worldview'
import { useAIStream } from '../../hooks/useAIStream'
import { buildWorldviewPrompt } from '../../lib/ai/adapters/worldview-adapter'
import AIStreamOutput from '../shared/AIStreamOutput'
import PromptRunPanel from '../shared/PromptRunPanel'
import type { Project, NaturalResources } from '../../lib/types'

interface Props { project: Project }

// ── 字段定义 ──────────────────────────────────────────────────

const SIMPLE_FIELDS = [
  { key: 'worldStructure',   emoji: '🌐', label: '世界结构',   desc: '单星球 / 多星系 / 多重天 / 套娃世界 / 平行宇宙……世界的物理层级是什么？', ctxKey: 'structure',  ctxLabel: '世界结构' },
  { key: 'worldDimensions',  emoji: '📐', label: '世界尺寸',   desc: '估算世界整体大小',                                                           ctxKey: 'dim',       ctxLabel: '世界尺寸' },
  { key: 'continentLayout',  emoji: '🗺', label: '大陆分布',   desc: '主要大陆数量、相对位置、典型地形特征',                                         ctxKey: 'continent', ctxLabel: '大陆分布' },
  { key: 'regionDimensions', emoji: '📏', label: '区域面积',   desc: '主要文明区域的尺度',                                                           ctxKey: 'region',    ctxLabel: '区域面积' },
  { key: 'mountainsRivers',  emoji: '⛰', label: '山川河流',   desc: '重要山脉、河流、湖泊、海洋',                                                   ctxKey: 'mountains', ctxLabel: '山川河流' },
  { key: 'climateByRegion',  emoji: '🌦', label: '分区域气候', desc: '不同地理区域的气候类型与季节特征',                                               ctxKey: 'climate',   ctxLabel: '气候' },
] as const

const ALL_KEYS = [...SIMPLE_FIELDS.map(f => f.key), 'naturalResources'] as const
type FieldKey = typeof ALL_KEYS[number]

// ── 主面板 ─────────────────────────────────────────────────────

export default function WorldviewNaturalPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()

  const [values, setValues] = useState<Record<string, string>>({})
  const [naturalResources, setNaturalResources] = useState<NaturalResources>({
    rareCreatures: '', herbs: '', minerals: '', others: '',
  })
  const [activeKey, setActiveKey] = useState<FieldKey>('worldStructure')
  const [streamingKeys, setStreamingKeys] = useState<Set<string>>(new Set())

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  useEffect(() => {
    if (!worldview) return
    setValues({
      worldStructure:   worldview.worldStructure || '',
      worldDimensions:  worldview.worldDimensions || '',
      continentLayout:  worldview.continentLayout || '',
      regionDimensions: worldview.regionDimensions || '',
      mountainsRivers:  worldview.mountainsRivers || '',
      climateByRegion:  worldview.climateByRegion || '',
    })
    setNaturalResources(worldview.naturalResources || {
      rareCreatures: '', herbs: '', minerals: '', others: '',
    })
  }, [worldview])

  const save = (patch: Partial<typeof worldview>) =>
    saveWorldview({ projectId: project.id!, ...patch })

  const buildCtx = useCallback((skipCtxKey: string): string => {
    const parts: string[] = []
    for (const f of SIMPLE_FIELDS) {
      if (f.ctxKey !== skipCtxKey && values[f.key]) {
        parts.push(`【${f.ctxLabel}】${values[f.key].slice(0, 150)}`)
      }
    }
    return parts.join('\n')
  }, [values])

  const handleStreamingChange = useCallback((key: string, streaming: boolean) => {
    setStreamingKeys(prev => {
      const next = new Set(prev)
      if (streaming) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  return (
    <div className="flex h-full">
      {/* ── 左侧边栏 ── */}
      <nav className="w-48 flex-shrink-0 border-r border-border bg-bg-surface/50 overflow-y-auto">
        <div className="px-3 pt-4 pb-2">
          <h2 className="text-sm font-bold text-text-primary">🏔 自然环境</h2>
          <p className="text-xs text-text-muted mt-0.5 leading-snug">七个维度搭建物理世界</p>
        </div>
        {[...SIMPLE_FIELDS.map(f => ({ key: f.key, emoji: f.emoji, label: f.label })),
          { key: 'naturalResources' as const, emoji: '🌿', label: '自然资源' },
        ].map(f => {
          const isActive = activeKey === f.key
          const isFieldStreaming = streamingKeys.has(f.key)
          return (
            <button
              key={f.key}
              onClick={() => setActiveKey(f.key)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors border-l-2 flex items-center gap-1 ${
                isActive
                  ? 'border-accent bg-accent/10 text-text-primary font-medium'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-elevated/50'
              }`}
            >
              <span className="flex-1">{f.emoji} {f.label}</span>
              {isFieldStreaming && !isActive && (
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
              )}
            </button>
          )
        })}
      </nav>

      {/* ── 右侧：所有字段同时渲染，hidden 控制显示 ── */}
      <div className="flex-1 overflow-y-auto p-6">
        {SIMPLE_FIELDS.map(f => (
          <div key={f.key} className={activeKey === f.key ? '' : 'hidden'}>
            <SimpleFieldEditor
              field={f}
              value={values[f.key] || ''}
              onChange={v => {
                setValues(prev => ({ ...prev, [f.key]: v }))
                save({ [f.key]: v })
              }}
              project={project}
              contextSummary={buildCtx(f.ctxKey)}
              onStreamingChange={streaming => handleStreamingChange(f.key, streaming)}
            />
          </div>
        ))}
        <div className={activeKey === 'naturalResources' ? '' : 'hidden'}>
          <NaturalResourcesEditor
            naturalResources={naturalResources}
            setNaturalResources={setNaturalResources}
            save={save}
          />
        </div>
      </div>
    </div>
  )
}

// ── 单字段编辑器（各自独立的 AI 流） ──────────────────────────

function SimpleFieldEditor({ field, value, onChange, project, contextSummary, onStreamingChange }: {
  field: typeof SIMPLE_FIELDS[number]
  value: string
  onChange: (v: string) => void
  project: Project
  contextSummary: string
  onStreamingChange: (streaming: boolean) => void
}) {
  const [hint, setHint] = useState('')
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const ai = useAIStream()

  useEffect(() => {
    onStreamingChange(ai.isStreaming)
  }, [ai.isStreaming, onStreamingChange])

  const handleGenerate = () => {
    const opts = {
      parameterValues: Object.keys(parameterValues).length > 0 ? parameterValues : undefined,
      overrides: (systemOverride != null || userOverride != null) ? {
        systemPrompt: systemOverride ?? undefined,
        userPromptTemplate: userOverride ?? undefined,
      } : undefined,
    }
    const messages = buildWorldviewPrompt(
      field.label, project.name, project.genre || '', contextSummary, hint, opts,
    )
    ai.start(messages)
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">{field.emoji} {field.label}</h3>
        <p className="mt-1 text-sm text-text-muted">{field.desc}</p>
      </div>

      <div className="bg-bg-surface border border-border rounded-lg p-4">
        <InlineTextarea value={value} onChange={onChange} placeholder={field.desc} />
      </div>

      <div className="flex items-center gap-2">
        <input value={hint} onChange={e => setHint(e.target.value)}
          placeholder="给 AI 的补充说明（可选）"
          className="flex-1 px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent" />
        <button onClick={handleGenerate} disabled={ai.isStreaming}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent text-xs rounded hover:bg-accent/20 disabled:opacity-50 shrink-0">
          <Sparkles className="w-3.5 h-3.5" /> AI 生成
        </button>
      </div>

      <PromptRunPanel moduleKey="worldview.dimension" parameterValues={parameterValues}
        onParamChange={setParameterValues} systemOverride={systemOverride}
        onSystemOverrideChange={setSystemOverride} userOverride={userOverride}
        onUserOverrideChange={setUserOverride} />

      {(ai.output || ai.isStreaming || ai.error) && (
        <AIStreamOutput output={ai.output} isStreaming={ai.isStreaming} error={ai.error}
          tokenUsage={ai.tokenUsage} onStop={ai.stop}
          onAccept={(text: string) => { onChange(text); ai.reset() }}
          onRetry={handleGenerate} moduleKey="worldview.dimension" />
      )}
    </div>
  )
}

// ── 自然资源编辑器 ─────────────────────────────────────────────

function NaturalResourcesEditor({ naturalResources, setNaturalResources, save }: {
  naturalResources: NaturalResources
  setNaturalResources: React.Dispatch<React.SetStateAction<NaturalResources>>
  save: (patch: Record<string, unknown>) => void
}) {
  const rows: { key: keyof NaturalResources; label: string; placeholder: string }[] = [
    { key: 'rareCreatures', label: '🦅 珍禽异兽', placeholder: '例：玄龟 / 火凤 / 噬魂蜘蛛 ...' },
    { key: 'herbs',         label: '🌿 灵药/草药', placeholder: '例：千年雪莲 / 还魂草 / 灵参 ...' },
    { key: 'minerals',      label: '💎 矿石/宝石', placeholder: '例：玄铁 / 灵石 / 龙血石 ...' },
    { key: 'others',        label: '✨ 其他特产',   placeholder: '例：神木、奇石、稀有元素 ...' },
  ]

  const update = (key: keyof NaturalResources, v: string) => {
    const next = { ...naturalResources, [key]: v }
    setNaturalResources(next)
    save({ naturalResources: next })
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">🌿 自然资源</h3>
        <p className="mt-1 text-sm text-text-muted">珍禽异兽 / 灵药草药 / 矿石宝石 / 其他特产</p>
      </div>
      <div className="bg-bg-surface border border-border rounded-lg p-4 space-y-4">
        {rows.map(r => (
          <div key={r.key} className="flex items-start gap-3">
            <span className="text-sm text-text-secondary w-28 flex-shrink-0 pt-0.5">{r.label}</span>
            <div className="flex-1">
              <InlineTextarea value={naturalResources[r.key]} onChange={v => update(r.key, v)} placeholder={r.placeholder} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── InlineTextarea ──────────────────────────────────────────────

function InlineTextarea({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { setDraft(value) }, [value])
  const resize = useCallback(() => {
    const el = ref.current; if (!el) return
    el.style.height = 'auto'; el.style.height = Math.max(32, el.scrollHeight) + 'px'
  }, [])
  useEffect(() => { if (editing) resize() }, [editing, resize])
  const commit = () => { setEditing(false); if (draft !== value) onChange(draft) }

  if (editing) return (
    <textarea ref={ref} value={draft} onChange={e => { setDraft(e.target.value); resize() }}
      onBlur={commit} onKeyDown={e => { if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
      placeholder={placeholder} className="w-full bg-transparent border border-accent/30 rounded px-2 py-1 text-sm text-text-primary outline-none resize-none" autoFocus />
  )
  if (!value) return (
    <div onClick={() => setEditing(true)} className="text-sm text-text-muted/40 cursor-text py-0.5">
      {placeholder || '点击编辑…'}
    </div>
  )
  return (
    <div onClick={() => setEditing(true)} className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap cursor-text py-0.5">
      {value}
    </div>
  )
}
