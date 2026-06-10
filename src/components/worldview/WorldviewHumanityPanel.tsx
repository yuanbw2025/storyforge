import { useState, useEffect, useCallback } from 'react'
import { Sparkles } from 'lucide-react'
import { useWorldviewStore } from '../../stores/worldview'
import { useWorldGroupStore } from '../../stores/world-group'
import WorldGroupSwitcher from '../world-group/WorldGroupSwitcher'
import { InlineTextarea } from '../shared/InlineEdit'
import { useAIStream } from '../../hooks/useAIStream'
import { buildWorldviewPrompt } from '../../lib/ai/adapters/worldview-adapter'
import { assembleContext } from '../../lib/registry/assemble-context'
import AIStreamOutput from '../shared/AIStreamOutput'
import PromptRunPanel from '../shared/PromptRunPanel'
import AIFieldModeTabs from '../shared/AIFieldModeTabs'
import type { Project } from '../../lib/types'
import type { FieldGenerationMode } from '../../lib/ai/field-generation-context'

async function buildRulesSourceContext(projectId: number, worldGroupId: number | null): Promise<string> {
  return (await assembleContext({ projectId, worldGroupId, sourceKeys: ['worldRules'] })).text
}
import CurrencyPanel from './CurrencyPanel'
import CodexPanel from '../codex/CodexPanel'

// ── 字段定义（统一标签，兼容幻想与历史） ─────────────────────────

interface FieldMeta {
  key: string       // skipKey for buildCtx
  field: string     // worldview store field name
  emoji: string
  label: string
  description: string
  /** 与独立管理面板重叠时的导航提示 */
  hint?: string
}

const FIELDS: FieldMeta[] = [
  { key: 'history',   field: 'historyLine',            emoji: '📜', label: '世界历史线',     description: '从远古到当下的时间脉络（朝代 / 时代 / 关键节点 / 架空度）', hint: '这里写概述脉络；具体事件、纪年与考证请到「📜 历史年表」逐条管理。' },
  { key: 'events',    field: 'worldEvents',            emoji: '📅', label: '世界大事记',     description: '改变世界格局的重大事件（战争、王朝兴替、灾劫……）', hint: '这里写大事概览；详细时间线事件请到「📜 历史年表」管理。' },
  { key: 'races',     field: 'races',                  emoji: '🧬', label: '种族与民族',     description: '不同种族 / 民族的特征、能力、历史与关系' },
  { key: 'factions',  field: 'factionLayout',          emoji: '⚔',  label: '势力分布',       description: '主要势力（门派 / 朝廷 / 商会 / 党派……）的格局和敌友关系' },
  { key: 'pec',       field: 'politicsEconomyCulture', emoji: '🏛', label: '政治/经济/文化', description: '政体 / 货币 / 赋税 / 阶层制度 / 宗教信仰 / 风俗节庆' },
  { key: 'conflicts', field: 'internalConflicts',      emoji: '🔥', label: '矛盾冲突',       description: '社会内在矛盾 / 阶级冲突 / 个体与集体冲突 / 与外部世界的张力' },
  { key: 'items',     field: 'itemDesign',             emoji: '🗡', label: '道具与器物',     description: '武器 / 法器 / 工具 / 科技装备……物品的来源、品级、规则', hint: '这里写物品体系概述；具体道具条目请到本面板「📚 人文主体·人工器物」词条逐条管理，主角随身物品由「🎒 物品栏」自动追踪。' },
]

// ── 主面板 ─────────────────────────────────────────────────────

interface Props { project: Project }

export default function WorldviewHumanityPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)

  const [values, setValues] = useState<Record<string, string>>({})
  const [activeKey, setActiveKey] = useState(FIELDS[0].key)
  const [streamingKeys, setStreamingKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
  }, [project.id, project.enableMultiWorld, activeGroupId, loadAll])

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
    if (worldview?.powerHierarchy) parts.push(`【力量体系】${worldview.powerHierarchy.slice(0, 150)}`)
    if (worldview?.continentLayout) parts.push(`【大陆分布】${worldview.continentLayout.slice(0, 150)}`)
    const map: [string, string, string][] = [
      ['history',   '世界历史线',   values.history || ''],
      ['events',    '世界大事记',   values.events || ''],
      ['races',     '种族与民族',   values.races || ''],
      ['factions',  '势力分布',     values.factions || ''],
      ['pec',       '政治经济文化', values.pec || ''],
      ['conflicts', '矛盾冲突',     values.conflicts || ''],
      ['items',     '道具与器物',   values.items || ''],
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
      {/* 顶部 */}
      <div className="pb-4 border-b border-border/40 px-6 pt-4 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
            🏛️ 人文环境与社会
          </h2>
          {project.enableMultiWorld && <WorldGroupSwitcher />}
        </div>
        <p className="text-xs text-text-muted mt-0.5">
          定义世界的历史、势力、政经文化与社会矛盾。如需声明真实与幻想的规则，请前往「⚖️ 真实与幻想」面板。
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── 左侧导航 ── */}
        <nav className="w-48 flex-shrink-0 border-r border-border overflow-y-auto py-4 pr-1">
          {FIELDS.map(f => {
            const isActive = f.key === activeKey
            const isFieldStreaming = streamingKeys.has(f.key)
            return (
              <button
                key={f.key}
                onClick={() => setActiveKey(f.key)}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors border-l-2 flex items-center gap-1 ${
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
              {/* B4: 人文主体词条(种族/势力/城池/器物)——结构化登记,可自定义字段、互相关联、进 AI 上下文 */}
              {f.key === 'races' && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-text-primary mb-1">📚 人文主体(词条):种族 / 势力 / 城池重镇 / 人工器物</h3>
                  <p className="text-xs text-text-muted mb-3">结构化登记人文设定——可自定义专属字段、互相关联，并进入 AI 生成上下文。下方旧版「种族与民族」纯文本兼容保留。</p>
                  <CodexPanel project={project} fixedDomain="humanity" embedded />
                </div>
              )}
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
  const [mode, setMode] = useState<FieldGenerationMode>('expand')
  const ai = useAIStream()
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)

  useEffect(() => {
    onStreamingChange(ai.isStreaming)
  }, [ai.isStreaming, onStreamingChange])

  const handleGenerate = async () => {
    const rulesCtx = await buildRulesSourceContext(project.id!, project.enableMultiWorld ? activeGroupId : null)
    const opts = {
      parameterValues: {
        ...parameterValues,
        worldRulesContext: rulesCtx,
      },
      overrides: (systemOverride != null || userOverride != null) ? {
        systemPrompt: systemOverride ?? undefined,
        userPromptTemplate: userOverride ?? undefined,
      } : undefined,
    }
    const messages = buildWorldviewPrompt(
      meta.label, project.name, project.genre || '', contextSummary, hint, opts, value, mode,
    )
    ai.start(messages)
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">{meta.emoji} {meta.label}</h3>
        <p className="mt-1 text-sm text-text-muted">{meta.description}</p>
        {meta.hint && (
          <p className="mt-1.5 text-xs text-accent/80 bg-accent/5 border border-accent/15 rounded px-2 py-1">
            💡 {meta.hint}
          </p>
        )}
      </div>

      <div className="bg-bg-surface border border-border rounded-xl p-4">
        <InlineTextarea value={value} onChange={onChange} placeholder={meta.description} />
      </div>

      <div className="flex items-center gap-2">
        <AIFieldModeTabs value={mode} onChange={setMode} />
        <input
          value={hint} onChange={e => setHint(e.target.value)}
          placeholder="给 AI 的补充说明（可选）"
          className="flex-1 px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
        <button onClick={handleGenerate} disabled={ai.isStreaming}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded disabled:opacity-50 shrink-0 bg-accent/10 text-accent hover:bg-accent/20">
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
