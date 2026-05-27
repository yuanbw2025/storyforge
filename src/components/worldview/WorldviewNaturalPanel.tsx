import { useState, useEffect, useCallback } from 'react'
import { Sparkles, ShieldCheck, Compass } from 'lucide-react'
import { useWorldviewStore } from '../../stores/worldview'
import { useProjectStore } from '../../stores/project'
import { InlineTextarea } from '../shared/InlineEdit'
import { useAIStream } from '../../hooks/useAIStream'
import { buildWorldviewPrompt } from '../../lib/ai/adapters/worldview-adapter'
import AIStreamOutput from '../shared/AIStreamOutput'
import PromptRunPanel from '../shared/PromptRunPanel'
import type { Project, NaturalResources, CreativeMode } from '../../lib/types'

interface Props { project: Project }

// ── 字段定义 ──────────────────────────────────────────────────

const FANTASY_FIELDS = [
  { key: 'worldStructure',   emoji: '🌐', label: '世界结构',   desc: '单星球 / 多星系 / 多重天 / 套娃世界 / 平行宇宙……世界的物理层级是什么？', ctxKey: 'structure',  ctxLabel: '世界结构' },
  { key: 'worldDimensions',  emoji: '📐', label: '世界尺寸',   desc: '估算世界整体大小',                                                           ctxKey: 'dim',       ctxLabel: '世界尺寸' },
  { key: 'continentLayout',  emoji: '🗺', label: '大陆分布',   desc: '主要大陆数量、相对位置、典型地形特征',                                         ctxKey: 'continent', ctxLabel: '大陆分布' },
  { key: 'regionDimensions', emoji: '📏', label: '区域面积',   desc: '主要文明区域的尺度',                                                           ctxKey: 'region',    ctxLabel: '区域面积' },
  { key: 'mountainsRivers',  emoji: '⛰', label: '山川河流',   desc: '重要山脉、河流、湖泊、海洋',                                                   ctxKey: 'mountains', ctxLabel: '山川河流' },
  { key: 'climateByRegion',  emoji: '🌦', label: '分区域气候', desc: '不同地理区域的气候类型与季节特征',                                               ctxKey: 'climate',   ctxLabel: '气候' },
] as const

const HISTORICAL_FIELDS = [
  { key: 'worldStructure',   emoji: '🗺️', label: '真实地理与地名考据', desc: '提供该历史时期的真实行政区划、地名演变、关隘要塞、水系分布，并指出哪些是史实，哪些是合理虚构。', ctxKey: 'structure',  ctxLabel: '真实地理与地名考据' },
  { key: 'worldDimensions',  emoji: '📐', label: '疆域与行政区划',     desc: '估算该历史政权或地理区域的疆域范围、核心行政区划、边疆防线等。',                               ctxKey: 'dim',       ctxLabel: '疆域与行政区划' },
  { key: 'continentLayout',  emoji: '⛰️', label: '地貌与地形特征',     desc: '主要山脉、平原、盆地分布，以及对军事、交通、农业产生的深远影响。',                             ctxKey: 'continent', ctxLabel: '地貌与地形特征' },
  { key: 'regionDimensions', emoji: '🏰', label: '核心城市与重镇',     desc: '主要都城、军事重镇、商业都会的地理分布与战略地位。',                                           ctxKey: 'region',    ctxLabel: '核心城市与重镇' },
  { key: 'mountainsRivers',  emoji: '🌊', label: '重要水系与漕运',     desc: '重要河流、湖泊、运河分布，以及漕运路线、水利工程对经济和军事的影响。',                         ctxKey: 'mountains', ctxLabel: '重要水系与漕运' },
  { key: 'climateByRegion',  emoji: '🌦️', label: '气候与自然灾害',     desc: '该时期的气候特征、典型自然灾害如旱涝、蝗灾、极寒等对社会稳定的冲击。',                         ctxKey: 'climate',   ctxLabel: '气候与自然灾害' },
] as const

const ALL_KEYS = ['worldStructure', 'worldDimensions', 'continentLayout', 'regionDimensions', 'mountainsRivers', 'climateByRegion', 'naturalResources'] as const
type FieldKey = typeof ALL_KEYS[number]

// ── 主面板 ─────────────────────────────────────────────────────

export default function WorldviewNaturalPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()
  const { updateProject } = useProjectStore()

  const [values, setValues] = useState<Record<string, string>>({})
  const [naturalResources, setNaturalResources] = useState<NaturalResources>({
    rareCreatures: '', herbs: '', minerals: '', others: '',
  })
  const [activeKey, setActiveKey] = useState<FieldKey>('worldStructure')
  const [streamingKeys, setStreamingKeys] = useState<Set<string>>(new Set())

  const creativeMode: CreativeMode = project.creativeMode || 'fantasy'
  const simpleFields = creativeMode === 'historical' ? HISTORICAL_FIELDS : FANTASY_FIELDS

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

  const handleModeChange = async (mode: CreativeMode) => {
    if (confirm(`确定切换到「${mode === 'historical' ? '历史考证' : '幻想设定'}」模式？这会改变 AI 生成世界观时的考证倾向。`)) {
      await updateProject(project.id!, { creativeMode: mode })
    }
  }

  const buildCtx = useCallback((skipCtxKey: string): string => {
    const parts: string[] = []
    for (const f of simpleFields) {
      if (f.ctxKey !== skipCtxKey && values[f.key]) {
        parts.push(`【${f.ctxLabel}】${values[f.key].slice(0, 150)}`)
      }
    }
    return parts.join('\n')
  }, [values, simpleFields])

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
            🏔️ 自然环境与地理考据
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
        {/* ── 左侧边栏 ── */}
        <nav className="w-48 flex-shrink-0 border-r border-border bg-bg-surface/50 overflow-y-auto">
          {[...simpleFields.map(f => ({ key: f.key, emoji: f.emoji, label: f.label })),
            { key: 'naturalResources' as const, emoji: '🌿', label: creativeMode === 'historical' ? '特产与战略物资' : '自然资源' },
          ].map(f => {
            const isActive = activeKey === f.key
            const isFieldStreaming = streamingKeys.has(f.key)
            return (
              <button
                key={f.key}
                onClick={() => setActiveKey(f.key)}
                className={`w-full text-left px-3 py-2.5 text-sm transition-colors border-l-2 flex items-center gap-1 ${
                  isActive
                    ? creativeMode === 'historical'
                      ? 'border-amber-500 bg-amber-500/10 text-text-primary font-medium'
                      : 'border-accent bg-accent/10 text-text-primary font-medium'
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
          {simpleFields.map(f => (
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
                creativeMode={creativeMode}
              />
            </div>
          ))}
          <div className={activeKey === 'naturalResources' ? '' : 'hidden'}>
            <NaturalResourcesEditor
              naturalResources={naturalResources}
              setNaturalResources={setNaturalResources}
              save={save}
              creativeMode={creativeMode}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 单字段编辑器（各自独立的 AI 流） ──────────────────────────

function SimpleFieldEditor({ field, value, onChange, project, contextSummary, onStreamingChange, creativeMode }: {
  field: { key: string; emoji: string; label: string; desc: string }
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

// ── 自然资源编辑器 ─────────────────────────────────────────────

function NaturalResourcesEditor({ naturalResources, setNaturalResources, save, creativeMode }: {
  naturalResources: NaturalResources
  setNaturalResources: React.Dispatch<React.SetStateAction<NaturalResources>>
  save: (patch: Record<string, unknown>) => void
  creativeMode: CreativeMode
}) {
  const rows: { key: keyof NaturalResources; label: string; placeholder: string }[] = creativeMode === 'historical' ? [
    { key: 'rareCreatures', label: '🐎 战马与牲畜', placeholder: '例：河曲马、大宛马、耕牛、军骡分布与产地...' },
    { key: 'herbs',         label: '🌾 粮食与作物', placeholder: '例：占城稻、粟、麦、救荒作物、棉花分布...' },
    { key: 'minerals',      label: '🪙 盐铁与矿产', placeholder: '例：官营铁矿、私盐产地、铜矿、煤炭（石炭）...' },
    { key: 'others',        label: '✨ 战略与特产', placeholder: '例：蜀锦、青瓷、桐油、造船木材、茶叶、丝绸...' },
  ] : [
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
        <h3 className="text-lg font-semibold text-text-primary">
          {creativeMode === 'historical' ? '🌿 特产与战略物资' : '🌿 自然资源'}
        </h3>
        <p className="mt-1 text-sm text-text-muted">
          {creativeMode === 'historical' ? '战马与牲畜 / 粮食与作物 / 盐铁与矿产 / 战略与特产' : '珍禽异兽 / 灵药草药 / 矿石宝石 / 其他特产'}
        </p>
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
