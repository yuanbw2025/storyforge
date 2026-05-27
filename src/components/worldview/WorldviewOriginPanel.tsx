import { useState, useEffect, useCallback } from 'react'
import { Sparkles, ShieldCheck, Compass } from 'lucide-react'
import { useWorldviewStore } from '../../stores/worldview'
import { useProjectStore } from '../../stores/project'
import { InlineTextarea } from '../shared/InlineEdit'
import { useAIStream } from '../../hooks/useAIStream'
import { buildWorldviewPrompt } from '../../lib/ai/adapters/worldview-adapter'
import AIStreamOutput from '../shared/AIStreamOutput'
import PromptRunPanel from '../shared/PromptRunPanel'
import type { Project, DivineDesign, CreativeMode } from '../../lib/types'

// ── 常量 ───────────────────────────────────────────────────────

type FieldKey = 'origin' | 'power' | 'divine'

const FANTASY_FIELDS: { key: FieldKey; label: string; icon: string; desc: string }[] = [
  { key: 'origin', label: '世界来源', icon: '🌌', desc: '创世神话 / 科技起源 / 文明诞生……世界从何而来？' },
  { key: 'power',  label: '力量层次', icon: '⚡', desc: '修真等级 / 魔法体系 / 科技层级……力量如何分层、怎么晋升？' },
  { key: 'divine', label: '神明设定', icon: '🌟', desc: '是否存在神明？神明的层级、名号、规则与限制是什么？' },
]

const HISTORICAL_FIELDS: { key: FieldKey; label: string; icon: string; desc: string }[] = [
  { key: 'origin', label: '历史时期与架空度', icon: '📜', desc: '明确界定核心历史年份、皇帝年号、朝代背景，并详细阐述小说的“架空程度”与蝴蝶效应起点。' },
  { key: 'power',  label: '社会等级与官职', icon: '🏛️', desc: '提供该时期真实的官制体系（如三省六部、九品中正）、爵位制度、社会阶层以及真实的升迁/科举路径。' },
  { key: 'divine', label: '宗教与民间信仰', icon: '🎭', desc: '提供该时期真实的国教、民间信仰、岁时节日、祭祀风俗、禁忌与避讳。' },
]

interface Props {
  project: Project
}

// ── 主面板 ─────────────────────────────────────────────────────

/** v3 §2.1 — 世界观.世界起源（三个子模块） */
export default function WorldviewOriginPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()
  const { updateProject } = useProjectStore()

  const [active, setActive] = useState<FieldKey>('origin')
  const [worldOrigin, setWorldOrigin] = useState('')
  const [powerHierarchy, setPowerHierarchy] = useState('')
  const [divineDesign, setDivineDesign] = useState<DivineDesign>({
    hasDivinity: false,
    divineRank: '',
    divineNames: '',
    divineRules: '',
  })
  const [streamingKeys, setStreamingKeys] = useState<Set<string>>(new Set())

  const creativeMode: CreativeMode = project.creativeMode || 'fantasy'
  const fields = creativeMode === 'historical' ? HISTORICAL_FIELDS : FANTASY_FIELDS

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  // 同步 store -> 本地 state
  useEffect(() => {
    if (!worldview) return
    setWorldOrigin(worldview.worldOrigin || '')
    setPowerHierarchy(worldview.powerHierarchy || '')
    setDivineDesign(worldview.divineDesign || {
      hasDivinity: false, divineRank: '', divineNames: '', divineRules: '',
    })
  }, [worldview])

  // 通用保存
  const save = (patch: Partial<typeof worldview>) =>
    saveWorldview({ projectId: project.id!, ...patch })

  const handleModeChange = async (mode: CreativeMode) => {
    if (confirm(`确定切换到「${mode === 'historical' ? '历史考证' : '幻想设定'}」模式？这会改变 AI 生成世界观时的考证倾向。`)) {
      await updateProject(project.id!, { creativeMode: mode })
    }
  }

  // AI 上下文（排除当前字段）
  const buildCtx = useCallback((excludeKey: string): string => {
    const parts: string[] = []
    if (excludeKey !== 'origin' && worldOrigin) parts.push(`【世界来源】${worldOrigin.slice(0, 200)}`)
    if (excludeKey !== 'power'  && powerHierarchy) parts.push(`【力量层次】${powerHierarchy.slice(0, 200)}`)
    if (excludeKey !== 'divine' && divineDesign.hasDivinity) {
      parts.push(`【神明】${divineDesign.divineNames || ''}：${divineDesign.divineRules?.slice(0, 100) || ''}`)
    }
    return parts.join('\n')
  }, [worldOrigin, powerHierarchy, divineDesign])

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
    <div className="flex flex-col w-full max-w-5xl space-y-4">
      {/* 顶部模式切换 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/40">
        <div>
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
            🌌 世界起源与核心设定
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

      <div className="flex gap-4">
        {/* ── 左侧边栏 ── */}
        <div className="w-44 shrink-0 space-y-0.5 pt-1">
          {fields.map(f => {
            const isActive = active === f.key
            const isFieldStreaming = streamingKeys.has(f.key)
            return (
              <button
                key={f.key}
                onClick={() => setActive(f.key)}
                className={`w-full flex items-center gap-2.5 px-2 py-2.5 rounded-lg text-left transition-all ${
                  isActive
                    ? creativeMode === 'historical'
                      ? 'bg-amber-500/10 border-l-2 border-amber-500'
                      : 'bg-accent/8 border-l-2 border-accent'
                    : 'hover:bg-bg-hover border-l-2 border-transparent'
                }`}
              >
                <span className="text-base shrink-0">{f.icon}</span>
                <span className={`text-sm font-medium truncate flex-1 ${isActive ? creativeMode === 'historical' ? 'text-amber-500' : 'text-accent' : 'text-text-primary'}`}>
                  {f.label}
                </span>
                {isFieldStreaming && !isActive && (
                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
                )}
              </button>
            )
          })}
        </div>

        {/* ── 右侧：所有字段同时渲染，hidden 控制显示 ── */}
        <div className="flex-1 min-w-0">
          {/* 世界来源 */}
          <div className={active === 'origin' ? '' : 'hidden'}>
            <TextFieldEditor
              field={fields[0]}
              value={worldOrigin}
              onChange={v => { setWorldOrigin(v); save({ worldOrigin: v }) }}
              project={project}
              contextSummary={buildCtx('origin')}
              onStreamingChange={streaming => handleStreamingChange('origin', streaming)}
              creativeMode={creativeMode}
            />
          </div>

          {/* 力量层次 */}
          <div className={active === 'power' ? '' : 'hidden'}>
            <TextFieldEditor
              field={fields[1]}
              value={powerHierarchy}
              onChange={v => { setPowerHierarchy(v); save({ powerHierarchy: v }) }}
              project={project}
              contextSummary={buildCtx('power')}
              onStreamingChange={streaming => handleStreamingChange('power', streaming)}
              creativeMode={creativeMode}
            />
          </div>

          {/* 神明设定 */}
          <div className={active === 'divine' ? '' : 'hidden'}>
            <DivineFieldEditor
              field={fields[2]}
              divineDesign={divineDesign}
              onDivineChange={(next) => { setDivineDesign(next); save({ divineDesign: next }) }}
              project={project}
              contextSummary={buildCtx('divine')}
              onStreamingChange={streaming => handleStreamingChange('divine', streaming)}
              creativeMode={creativeMode}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 文本字段编辑器（世界来源 / 力量层次） ────────────────────────

function TextFieldEditor({
  field, value, onChange, project, contextSummary, onStreamingChange, creativeMode,
}: {
  field: typeof FANTASY_FIELDS[number]
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
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
          <span>{field.icon}</span> {field.label}
        </h2>
        <p className="text-xs text-text-muted mt-0.5">{field.desc}</p>
      </div>

      <div className="bg-bg-surface border border-border rounded-lg p-4">
        <InlineTextarea value={value} onChange={onChange} placeholder={field.desc} />
      </div>

      <div className="flex items-center gap-2">
        <input
          value={hint} onChange={e => setHint(e.target.value)}
          placeholder="给 AI 的补充说明（可选）"
          className="flex-1 px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
        <button onClick={handleGenerate} disabled={ai.isStreaming}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded disabled:opacity-50 ${
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

// ── 神明设定编辑器（独立 AI 流） ─────────────────────────────────

function DivineFieldEditor({
  field, divineDesign, onDivineChange, project, contextSummary, onStreamingChange, creativeMode,
}: {
  field: typeof FANTASY_FIELDS[number]
  divineDesign: DivineDesign
  onDivineChange: (next: DivineDesign) => void
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
      creativeMode === 'historical' ? '宗教与民间信仰' : '神明设定',
      project.name, project.genre || '', contextSummary,
      hint || (creativeMode === 'historical'
        ? '请设计完整的宗教与民间信仰体系，包含：1）国教与主流信仰 2）民间信仰与神祇名号 3）祭祀风俗与禁忌避讳。分三个小节输出。'
        : '请设计完整的神明体系，包含：1）神明层级划分 2）主要神明名号与职司 3）神明的规则与限制。分三个小节输出。'),
      opts,
    )
    ai.start(messages)
  }

  const handleAccept = (text: string) => {
    const sections = text.split(/(?:#{1,3}\s*|(?:\*\*))(?:神明层级|层级|主要神明|神明名号|国教|主流信仰|民间信仰|规则|限制|风俗|禁忌|避讳)/i)
    let next: DivineDesign
    if (sections.length >= 4) {
      next = {
        hasDivinity: true,
        divineRank: sections[1]?.replace(/\*\*/g, '').trim() || text,
        divineNames: sections[2]?.replace(/\*\*/g, '').trim() || '',
        divineRules: sections[3]?.replace(/\*\*/g, '').trim() || '',
      }
    } else {
      next = {
        hasDivinity: true,
        divineRank: text,
        divineNames: divineDesign.divineNames,
        divineRules: divineDesign.divineRules,
      }
    }
    onDivineChange(next)
    ai.reset()
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
          <span>{field.icon}</span> {field.label}
        </h2>
        <p className="text-xs text-text-muted mt-0.5">{field.desc}</p>
      </div>

      {/* 存在神明 checkbox */}
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={divineDesign.hasDivinity}
          onChange={e => {
            onDivineChange({ ...divineDesign, hasDivinity: e.target.checked })
          }}
          className={creativeMode === 'historical' ? 'accent-amber-500' : 'accent-accent'}
        />
        <span className="text-text-secondary">
          {creativeMode === 'historical' ? '存在宗教与民间信仰' : '存在神明'}
        </span>
      </label>

      {divineDesign.hasDivinity && (
        <div className="space-y-0 divide-y divide-border/40">
          <div className="flex gap-4 py-3 first:pt-0">
            <span className="w-24 shrink-0 text-xs text-text-muted pt-0.5 text-right">
              {creativeMode === 'historical' ? '国教与主流信仰' : '神明层级'}
            </span>
            <div className="flex-1 min-w-0">
              <InlineTextarea
                value={divineDesign.divineRank}
                onChange={v => onDivineChange({ ...divineDesign, divineRank: v })}
                placeholder={creativeMode === 'historical' ? '例：佛教为国教，辅以道教、儒家思想...' : '例：主神 / 次神 / 半神 / 古神 / 邪神 ...'}
              />
            </div>
          </div>
          <div className="flex gap-4 py-3">
            <span className="w-24 shrink-0 text-xs text-text-muted pt-0.5 text-right">
              {creativeMode === 'historical' ? '民间信仰与神祇' : '主要神明名号'}
            </span>
            <div className="flex-1 min-w-0">
              <InlineTextarea
                value={divineDesign.divineNames}
                onChange={v => onDivineChange({ ...divineDesign, divineNames: v })}
                placeholder={creativeMode === 'historical' ? '例：关公信仰、妈祖信仰、土地公、灶神...' : '例：天帝 · 创世神；幽冥之主 ...'}
              />
            </div>
          </div>
          <div className="flex gap-4 py-3">
            <span className="w-24 shrink-0 text-xs text-text-muted pt-0.5 text-right">
              {creativeMode === 'historical' ? '祭祀风俗与禁忌' : '规则与限制'}
            </span>
            <div className="flex-1 min-w-0">
              <InlineTextarea
                value={divineDesign.divineRules}
                onChange={v => onDivineChange({ ...divineDesign, divineRules: v })}
                placeholder={creativeMode === 'historical' ? '例：避讳皇帝名讳、寒食节禁火、秋分祭月...' : '例：不可直接干涉凡间 / 神战禁忌 / 信仰枯竭后陨落 ...'}
              />
            </div>
          </div>
        </div>
      )}

      {/* AI 生成神明体系 */}
      <div className="flex items-center gap-2">
        <input
          value={hint} onChange={e => setHint(e.target.value)}
          placeholder="给 AI 的补充说明（可选）"
          className="flex-1 px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
        <button onClick={handleGenerate} disabled={ai.isStreaming}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded disabled:opacity-50 ${
            creativeMode === 'historical'
              ? 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
              : 'bg-accent/10 text-accent hover:bg-accent/20'
          }`}>
          <Sparkles className="w-3.5 h-3.5" /> {creativeMode === 'historical' ? 'AI 生成信仰体系' : 'AI 生成神明体系'}
        </button>
      </div>

      <PromptRunPanel moduleKey="worldview.dimension" parameterValues={parameterValues}
        onParamChange={setParameterValues} systemOverride={systemOverride}
        onSystemOverrideChange={setSystemOverride} userOverride={userOverride}
        onUserOverrideChange={setUserOverride} />

      {(ai.output || ai.isStreaming || ai.error) && (
        <AIStreamOutput output={ai.output} isStreaming={ai.isStreaming} error={ai.error}
          tokenUsage={ai.tokenUsage} onStop={ai.stop}
          onAccept={handleAccept}
          onRetry={handleGenerate} moduleKey="worldview.dimension" />
      )}
    </div>
  )
}
