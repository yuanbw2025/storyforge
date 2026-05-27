import { useState, useEffect, useCallback } from 'react'
import { Sparkles, ShieldCheck, Compass } from 'lucide-react'
import { useWorldviewStore } from '../../stores/worldview'
import { useProjectStore } from '../../stores/project'
import { InlineTextarea } from '../shared/InlineEdit'
import { useAIStream } from '../../hooks/useAIStream'
import { buildWorldviewPrompt } from '../../lib/ai/adapters/worldview-adapter'
import AIStreamOutput from '../shared/AIStreamOutput'
import PromptRunPanel from '../shared/PromptRunPanel'
import type { Project, CreativeMode } from '../../lib/types'
import CurrencyPanel from './CurrencyPanel'

// ── 字段定义 ──────────────────────────────────────────────────

interface FieldMeta {
  key: string       // skipKey for buildCtx
  field: string     // worldview store field name
  emoji: string
  label: string
  description: string
}

const FANTASY_FIELDS: FieldMeta[] = [
  { key: 'history',   field: 'historyLine',            emoji: '📜', label: '世界历史线',     description: '从远古到当下的时间脉络（朝代 / 时代 / 关键节点）' },
  { key: 'events',    field: 'worldEvents',            emoji: '📅', label: '世界大事记',     description: '改变世界格局的重大事件（神战、王朝兴替、灾劫……）' },
  { key: 'races',     field: 'races',                  emoji: '🧬', label: '种族设定',       description: '人类 / 妖族 / 神族 / 异种……每个种族的特征、能力、栖息地、历史' },
  { key: 'factions',  field: 'factionLayout',          emoji: '⚔',  label: '势力分布',       description: '主要门派 / 王朝 / 商会 / 教派……势力间的格局和敌友关系' },
  { key: 'pec',       field: 'politicsEconomyCulture', emoji: '🏛', label: '政治/经济/文化', description: '政体 / 货币流通 / 阶层制度 / 宗教信仰 / 风俗节庆' },
  { key: 'conflicts', field: 'internalConflicts',      emoji: '🔥', label: '矛盾冲突',       description: '社会内在矛盾 / 阶级冲突 / 个体与集体冲突 / 与外部世界的张力' },
  { key: 'items',     field: 'itemDesign',             emoji: '🗡', label: '道具设计',       description: '武器 / 法器 / 灵药 / 神器……物品的来源、品级、规则' },
]

const HISTORICAL_FIELDS: FieldMeta[] = [
  { key: 'history',   field: 'historyLine',            emoji: '📜', label: '历史时期与架空度', description: '明确界定核心历史年份、皇帝年号、朝代背景，并详细阐述小说的“架空程度”与蝴蝶效应起点。' },
  { key: 'events',    field: 'worldEvents',            emoji: '📅', label: '重大历史事件',     description: '改变历史走向的重大事件，如安史之乱、靖康之变、玄武门之变等。' },
  { key: 'races',     field: 'races',                  emoji: '🧬', label: '民族与外族关系',   description: '中原主体民族与周边少数民族、外族政权的关系，如宋与辽金西夏、唐与突厥吐蕃等。' },
  { key: 'factions',  field: 'factionLayout',          emoji: '⚔',  label: '朝堂党争与地方势力', description: '朝廷内部党争、地方藩镇、世家大族、行会商会、民间帮派等势力格局。' },
  { key: 'pec',       field: 'politicsEconomyCulture', emoji: '🏛', label: '经济与赋税制度',   description: '真实的政体官制、货币流通、赋税制度如两税法、科举制度、风俗节庆等。' },
  { key: 'conflicts', field: 'internalConflicts',      emoji: '🔥', label: '社会矛盾与冲突',   description: '阶级矛盾、土地兼并、官民冲突、华夷之辨、新旧党争等核心冲突。' },
  { key: 'items',     field: 'itemDesign',             emoji: '🗡', label: '时代科技与生产力', description: '真实的农业工具、手工业水平如织布机、武器装备如明光铠、交通工具等。' },
]

// ── 主面板 ─────────────────────────────────────────────────────

interface Props { project: Project }

export default function WorldviewHumanityPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()
  const { updateProject } = useProjectStore()

  const [values, setValues] = useState<Record<string, string>>({})
  const [activeKey, setActiveKey] = useState(FANTASY_FIELDS[0].key)
  const [streamingKeys, setStreamingKeys] = useState<Set<string>>(new Set())

  const creativeMode: CreativeMode = project.creativeMode || 'fantasy'
  const fields = creativeMode === 'historical' ? HISTORICAL_FIELDS : FANTASY_FIELDS

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

  const handleModeChange = async (mode: CreativeMode) => {
    if (confirm(`确定切换到「${mode === 'historical' ? '历史考证' : '幻想设定'}」模式？这会改变 AI 生成世界观时的考证倾向。`)) {
      await updateProject(project.id!, { creativeMode: mode })
    }
  }

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
      if (prev.has(key) === streaming) return prev
      const next = new Set(prev)
      if (streaming) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  return (
    <div className="flex flex-col w-full h-full space-y-4">
      {/* 顶部模式切换 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/40 px-6 pt-4 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
            🏛️ 人文环境与社会考据
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {creativeMode === 'historical'
              ? '当前处于历史考证模式，AI 将严格遵循历史真实性进行细节推导。'
              : '当前处于幻想设定模式，支持天马行空的创世神话与力量体系。'}
          </p>
        </div>

        {/* 模式切换开关 */}
        <div className="flex bg-bg-elevated rounded-lg p-1 shrink-0 border border-border/40">
          <button
            onClick={() => handleModeChange('fantasy')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all ${
              creativeMode === 'fantasy'
                ? 'bg-accent text-white shadow-sm font-medium'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            幻想设定
          </button>
          <button
            onClick={() => handleModeChange('historical')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all ${
              creativeMode === 'historical'
                ? 'bg-amber-500 text-white shadow-sm font-medium'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            历史考证
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── 左侧导航 ── */}
        <nav className="w-48 flex-shrink-0 border-r border-border overflow-y-auto py-4 pr-1">
          {fields.map(f => {
            const isActive = f.key === activeKey
            const isFieldStreaming = streamingKeys.has(f.key)
            return (
              <button
                key={f.key}
                onClick={() => setActiveKey(f.key)}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors border-l-2 flex items-center gap-1 ${
                  isActive
                    ? creativeMode === 'historical'
                      ? 'border-amber-500 bg-amber-500/10 text-text-primary font-medium'
                      : 'border-accent bg-accent/8 text-accent font-medium'
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
          {fields.map(f => (
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
                creativeMode={creativeMode}
              />
              {/* Phase 23.2: 在经济文化字段下追加货币面板 */}
              {f.key === 'pec' && (
                <div className="mt-6 max-w-3xl">
                  <CurrencyPanel projectId={project.id!} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 单字段编辑器（各自独立的 AI 流） ──────────────────────────

function HumanityFieldEditor({
  meta, value, onChange, project, contextSummary, onStreamingChange, creativeMode,
}: {
  meta: FieldMeta
  value: string
  onChange: (v: string) => void
  project: Project
  contextSummary: string
  onStreamingChange: (streaming: boolean) => void
  creativeMode: CreativeMode
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
      parameterValues: {
        ...parameterValues,
        creativeMode,
      },
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
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded disabled:opacity-50 shrink-0 ${
            creativeMode === 'historical'
              ? 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
              : 'bg-accent/10 text-accent hover:bg-accent/20'
          }`}>
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
