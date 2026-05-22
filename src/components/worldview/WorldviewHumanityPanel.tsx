import { useState, useEffect, useCallback, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { useWorldviewStore } from '../../stores/worldview'
import { useAIStream } from '../../hooks/useAIStream'
import { buildWorldviewPrompt } from '../../lib/ai/adapters/worldview-adapter'
import AIStreamOutput from '../shared/AIStreamOutput'
import PromptRunPanel from '../shared/PromptRunPanel'
import type { Project } from '../../lib/types'

// ── 字段定义 ──────────────────────────────────────────────────

interface FieldMeta {
  key: string       // skipKey for buildCtx
  field: string     // worldview store field name
  emoji: string
  label: string
  description: string
}

const FIELDS: FieldMeta[] = [
  { key: 'history',   field: 'historyLine',            emoji: '📜', label: '世界历史线',     description: '从远古到当下的时间脉络（朝代 / 时代 / 关键节点）' },
  { key: 'events',    field: 'worldEvents',            emoji: '📅', label: '世界大事记',     description: '改变世界格局的重大事件（神战、王朝兴替、灾劫……）' },
  { key: 'races',     field: 'races',                  emoji: '🧬', label: '种族设定',       description: '人类 / 妖族 / 神族 / 异种……每个种族的特征、能力、栖息地、历史' },
  { key: 'factions',  field: 'factionLayout',          emoji: '⚔',  label: '势力分布',       description: '主要门派 / 王朝 / 商会 / 教派……势力间的格局和敌友关系' },
  { key: 'pec',       field: 'politicsEconomyCulture', emoji: '🏛', label: '政治/经济/文化', description: '政体 / 货币流通 / 阶层制度 / 宗教信仰 / 风俗节庆' },
  { key: 'conflicts', field: 'internalConflicts',      emoji: '🔥', label: '矛盾冲突',       description: '社会内在矛盾 / 阶级冲突 / 个体与集体冲突 / 与外部世界的张力' },
  { key: 'items',     field: 'itemDesign',             emoji: '🗡', label: '道具设计',       description: '武器 / 法器 / 灵药 / 神器……物品的来源、品级、规则' },
]

// ── 主面板 ─────────────────────────────────────────────────────

interface Props { project: Project }

export default function WorldviewHumanityPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()

  const [values, setValues] = useState<Record<string, string>>({})
  const [activeKey, setActiveKey] = useState(FIELDS[0].key)
  const [streamingKeys, setStreamingKeys] = useState<Set<string>>(new Set())

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  useEffect(() => {
    if (!worldview) return
    setValues({
      history:   worldview.historyLine || '',
      events:    worldview.worldEvents || '',
      races:     worldview.races || '',
      factions:  worldview.factionLayout || '',
      pec:       worldview.politicsEconomyCulture || '',
      conflicts: worldview.internalConflicts || '',
      items:     worldview.itemDesign || '',
    })
  }, [worldview])

  const save = (fieldName: string, v: string) =>
    saveWorldview({ projectId: project.id!, [fieldName]: v })

  /** 拼其他字段（含世界起源 + 自然环境的关键值）做 AI 上下文 */
  const buildCtx = useCallback((skipKey: string): string => {
    const parts: string[] = []
    if (worldview?.worldOrigin) parts.push(`【世界起源】${worldview.worldOrigin.slice(0, 200)}`)
    if (worldview?.powerHierarchy) parts.push(`【力量层次】${worldview.powerHierarchy.slice(0, 150)}`)
    if (worldview?.continentLayout) parts.push(`【大陆分布】${worldview.continentLayout.slice(0, 150)}`)
    const map: [string, string, string][] = [
      ['history',   '世界历史线',   values.history || ''],
      ['events',    '世界大事记',   values.events || ''],
      ['races',     '种族设定',     values.races || ''],
      ['factions',  '势力分布',     values.factions || ''],
      ['pec',       '政治经济文化', values.pec || ''],
      ['conflicts', '矛盾冲突',     values.conflicts || ''],
      ['items',     '道具设计',     values.items || ''],
    ]
    for (const [k, label, val] of map) {
      if (k !== skipKey && val) parts.push(`【${label}】${val.slice(0, 150)}`)
    }
    return parts.join('\n')
  }, [worldview, values])

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
      {/* ── 左侧导航 ── */}
      <nav className="w-48 flex-shrink-0 border-r border-border overflow-y-auto py-4 pr-1">
        <h2 className="px-4 mb-3 text-xs font-semibold text-text-muted uppercase tracking-wider">
          人文环境
        </h2>
        {FIELDS.map(f => {
          const isActive = f.key === activeKey
          const isFieldStreaming = streamingKeys.has(f.key)
          return (
            <button
              key={f.key}
              onClick={() => setActiveKey(f.key)}
              className={`w-full text-left px-4 py-2 text-sm transition-colors border-l-2 flex items-center gap-1 ${
                isActive
                  ? 'border-accent bg-accent/8 text-accent font-medium'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
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
      <div className="flex-1 min-w-0 overflow-y-auto p-6">
        {FIELDS.map(f => (
          <div key={f.key} className={activeKey === f.key ? '' : 'hidden'}>
            <HumanityFieldEditor
              meta={f}
              value={values[f.key] || ''}
              onChange={v => {
                setValues(prev => ({ ...prev, [f.key]: v }))
                save(f.field, v)
              }}
              project={project}
              contextSummary={buildCtx(f.key)}
              onStreamingChange={streaming => handleStreamingChange(f.key, streaming)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 单字段编辑器（各自独立的 AI 流） ──────────────────────────

function HumanityFieldEditor({
  meta, value, onChange, project, contextSummary, onStreamingChange,
}: {
  meta: FieldMeta
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
      meta.label, project.name, project.genre || '', contextSummary, hint, opts,
    )
    ai.start(messages)
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">{meta.emoji} {meta.label}</h3>
        <p className="mt-1 text-sm text-text-muted">{meta.description}</p>
      </div>

      <div className="bg-bg-surface border border-border rounded-xl p-4">
        <InlineTextarea value={value} onChange={onChange} placeholder={meta.description} />
      </div>

      <div className="flex items-center gap-2">
        <input
          value={hint} onChange={e => setHint(e.target.value)}
          placeholder="给 AI 的补充说明（可选）"
          className="flex-1 px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
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
