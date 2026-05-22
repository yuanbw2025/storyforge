import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Plus, Sparkles, Trash2, ChevronDown, ChevronRight,
} from 'lucide-react'
import { useCharacterStore } from '../../stores/character'
import { useWorldviewStore } from '../../stores/worldview'
import { useAIConfigStore } from '../../stores/ai-config'
import { useAIStream } from '../../hooks/useAIStream'
import { buildCharacterPrompt } from '../../lib/ai/adapters/character-adapter'
import { buildWorldContext } from '../../lib/ai/context-builder'
import { parseCharacterOutput } from '../../lib/ai/parse-character-output'
import AIStreamOutput from '../shared/AIStreamOutput'
import PromptRunPanel from '../shared/PromptRunPanel'
import type { Project, Character, CharacterRole, CharacterAlignment } from '../../lib/types'

// ── 常量 ───────────────────────────────────────────────────────

const ROLE_LABELS: Record<CharacterRole, string> = {
  protagonist: '主角',
  antagonist:  '反派',
  supporting:  '配角',
  minor:       '次要',
  npc:         'NPC',
  extra:       '路人',
}

const ROLE_COLORS: Record<CharacterRole, string> = {
  protagonist: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30',
  antagonist:  'text-red-400 bg-red-400/10 border-red-400/30',
  supporting:  'text-blue-400 bg-blue-400/10 border-blue-400/30',
  minor:       'text-text-muted bg-bg-elevated border-border',
  npc:         'text-purple-400 bg-purple-400/10 border-purple-400/30',
  extra:       'text-text-muted bg-bg-base border-border',
}

// 首字圆的柔和色板（按角色 index 循环取色）
const GLYPH_COLORS = [
  'bg-[#C17D5E]/15 text-[#C17D5E]',   // 陶土
  'bg-[#7BA08A]/15 text-[#7BA08A]',   // 青竹
  'bg-[#8B7BB0]/15 text-[#8B7BB0]',   // 紫藤
  'bg-[#B08B6B]/15 text-[#B08B6B]',   // 琥珀
  'bg-[#6B8EB0]/15 text-[#6B8EB0]',   // 墨蓝
  'bg-[#B06B7B]/15 text-[#B06B7B]',   // 玫红
]

interface Props { project: Project }

// ── 主面板 ─────────────────────────────────────────────────────

export default function CharacterPanel({ project }: Props) {
  const { characters, loadAll, addCharacter, updateCharacter, deleteCharacter } = useCharacterStore()
  const { worldview, storyCore, powerSystem } = useWorldviewStore()
  const { config: aiConfig } = useAIConfigStore()
  const [selected, setSelected] = useState<number | null>(null)
  const [hint, setHint] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const ai = useAIStream()

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const selectedChar = characters.find(c => c.id === selected)

  const handleAdd = async () => {
    const id = await addCharacter({
      projectId: project.id!, name: '新角色', role: 'supporting',
      shortDescription: '', appearance: '', personality: '',
      background: '', motivation: '', abilities: '', relationships: '', arc: '',
    })
    setSelected(id)
  }

  const handleUpdate = (field: keyof Character, value: string) => {
    if (selectedChar?.id) updateCharacter(selectedChar.id, { [field]: value })
  }

  const handleAIGenerate = () => {
    const existing = characters.map(c => `${c.name}（${ROLE_LABELS[c.role]}）`).join('、')
    const worldCtx = buildWorldContext(worldview, storyCore, powerSystem)
    const opts = {
      parameterValues: Object.keys(parameterValues).length > 0 ? parameterValues : undefined,
      overrides: (systemOverride != null || userOverride != null) ? {
        systemPrompt: systemOverride ?? undefined,
        userPromptTemplate: userOverride ?? undefined,
      } : undefined,
    }
    const messages = buildCharacterPrompt(project.name, project.genre ?? '', worldCtx, existing, hint, opts)
    ai.start(messages)
  }

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors"
        >
          <Plus className="w-4 h-4" /> 新建角色
        </button>
        <div className="flex items-center gap-2 flex-1">
          <input
            value={hint}
            onChange={e => setHint(e.target.value)}
            placeholder="角色要求（可选）"
            className="w-48 px-2 py-1.5 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleAIGenerate}
            disabled={ai.isStreaming}
            className="flex items-center gap-1.5 px-3 py-2 bg-bg-elevated text-text-secondary text-sm rounded-md hover:text-accent disabled:opacity-50 transition-colors border border-border hover:border-accent/50"
          >
            <Sparkles className="w-3.5 h-3.5" /> AI 设计角色
          </button>
        </div>
        <span className="text-xs text-text-muted ml-auto">角色册 · {characters.length}</span>
      </div>

      {/* 调参浮窗 */}
      <PromptRunPanel
        moduleKey="character.generate"
        parameterValues={parameterValues}
        onParamChange={setParameterValues}
        systemOverride={systemOverride}
        onSystemOverrideChange={setSystemOverride}
        userOverride={userOverride}
        onUserOverrideChange={setUserOverride}
      />

      {/* AI 解析中提示 */}
      {parsing && (
        <div className="flex items-center gap-2 px-4 py-3 bg-accent/5 border border-accent/20 rounded-lg text-sm text-accent animate-pulse">
          <Sparkles className="w-4 h-4 shrink-0" />
          AI 正在将角色内容分字段整理，请稍候…
        </div>
      )}

      {/* AI 输出 */}
      {(ai.output || ai.isStreaming || ai.error) && (
        <AIStreamOutput
          output={ai.output}
          isStreaming={ai.isStreaming}
          error={ai.error} tokenUsage={ai.tokenUsage}
          onStop={ai.stop}
          onAccept={async (text: string) => {
            ai.reset()
            setParsing(true)
            const parsed = await parseCharacterOutput(text, aiConfig)
            setParsing(false)
            const nameMatch = text.match(/(?:\*\*|#{1,3}\s*|【)([^*#\n【】]{1,20})(?:\*\*|】)/)
            const fallbackName = nameMatch?.[1]?.trim() || 'AI 生成角色'
            const id = await addCharacter({
              projectId: project.id!,
              name:             parsed?.name             || fallbackName,
              role:             parsed?.role             || 'supporting',
              shortDescription: parsed?.shortDescription || '',
              appearance:       parsed?.appearance       || '',
              personality:      parsed?.personality      || '',
              background:       parsed?.background       || text,
              motivation:       parsed?.motivation       || '',
              abilities:        parsed?.abilities        || '',
              relationships:    parsed?.relationships    || '',
              arc:              parsed?.arc              || '',
            })
            setSelected(id)
          }}
          onRetry={handleAIGenerate}
          moduleKey="character.generate"
        />
      )}

      {/* 主体：左侧列表 + 右侧详情 */}
      {characters.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-3">
          <div className="text-4xl opacity-20">📖</div>
          <p className="text-sm">还没有角色，点击「新建角色」开始创作</p>
        </div>
      ) : (
        <div className="flex gap-4">
          {/* 左侧角色列表 */}
          <div className="w-40 shrink-0 space-y-0.5">
            {characters.map((c, i) => {
              const active = selected === c.id
              const colorClass = GLYPH_COLORS[i % GLYPH_COLORS.length]
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(active ? null : c.id!)}
                  className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-all ${
                    active
                      ? 'bg-accent/8 border-l-2 border-accent'
                      : 'hover:bg-bg-hover border-l-2 border-transparent'
                  }`}
                >
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${colorClass}`}>
                    {c.name.charAt(0)}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${active ? 'text-accent' : 'text-text-primary'}`}>{c.name}</p>
                    <p className="text-[10px] text-text-muted truncate">{c.shortDescription?.slice(0, 10) || ROLE_LABELS[c.role]}</p>
                  </div>
                </button>
              )
            })}
          </div>

          {/* 右侧详情卡 */}
          <div className="flex-1 min-w-0">
            {selectedChar ? (
              <CharacterDetailCard
                char={selectedChar}
                charIndex={characters.findIndex(c => c.id === selectedChar.id)}
                onUpdate={handleUpdate}
                onDelete={() => { deleteCharacter(selectedChar.id!); setSelected(null) }}
              />
            ) : (
              <div className="flex items-center justify-center h-64 text-text-muted text-sm">
                ← 选择一个角色查看详情
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 角色详情卡（design 风格） ────────────────────────────────────

function CharacterDetailCard({
  char, charIndex, onUpdate, onDelete,
}: {
  char: Character
  charIndex: number
  onUpdate: (f: keyof Character, v: string) => void
  onDelete: () => void
}) {
  const { updateCharacter } = useCharacterStore()
  const [expanded, setExpanded] = useState(true)
  const glyphColor = GLYPH_COLORS[charIndex % GLYPH_COLORS.length]

  const fields: { key: keyof Character; label: string }[] = [
    { key: 'appearance',   label: '外貌' },
    { key: 'personality',  label: '性格' },
    { key: 'background',   label: '背景故事' },
    { key: 'motivation',   label: '动机' },
    { key: 'abilities',    label: '能力' },
    { key: 'relationships', label: '人物关系' },
    { key: 'arc',          label: '角色弧' },
  ]

  return (
    <div className="space-y-4">
      {/* 头部：大号首字 + 名字 + 标签 */}
      <div className="flex items-start gap-4">
        {/* 大号首字 */}
        <div className={`w-16 h-16 rounded-xl flex items-center justify-center text-3xl font-serif font-bold shrink-0 ${glyphColor}`}>
          {char.name.charAt(0)}
        </div>

        <div className="flex-1 min-w-0">
          {/* 角色元信息行 */}
          <div className="flex items-center gap-1.5 text-xs text-text-muted mb-0.5">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${ROLE_COLORS[char.role]}`}>
              {ROLE_LABELS[char.role]}
            </span>
            <select
              value={char.alignment || 'good'}
              onChange={e => char.id && updateCharacter(char.id, { alignment: e.target.value as CharacterAlignment })}
              className="px-1.5 py-0.5 bg-bg-elevated text-text-secondary text-[10px] rounded border border-border focus:outline-none focus:border-accent cursor-pointer"
            >
              <option value="good">正派</option>
              <option value="evil">反派</option>
            </select>
          </div>

          {/* 名字（可编辑） */}
          <InlineInput
            value={char.name}
            onChange={v => onUpdate('name', v)}
            className="text-2xl font-bold font-serif text-text-primary"
          />

          {/* 一句话简介（引号样式） */}
          {char.shortDescription ? (
            <InlineInput
              value={char.shortDescription}
              onChange={v => onUpdate('shortDescription', v)}
              className="text-sm text-text-secondary mt-1 italic"
              prefix={"“"}
              suffix={"”"}
              placeholder="点击添加一句话简介…"
            />
          ) : (
            <InlineInput
              value=""
              onChange={v => onUpdate('shortDescription', v)}
              className="text-sm text-text-muted mt-1 italic"
              placeholder="点击添加一句话简介…"
            />
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setExpanded(!expanded)} className="p-1.5 text-text-muted hover:text-text-primary rounded transition-colors">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <button onClick={onDelete} className="p-1.5 text-text-muted hover:text-error rounded transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 字段列表 — 横排 label: value */}
      {expanded && (
        <div className="space-y-0 divide-y divide-border/40">
          {fields.map(f => {
            const val = (char[f.key] as string) || ''
            return (
              <div key={String(f.key)} className="flex gap-4 py-3 first:pt-0">
                <span className="w-16 shrink-0 text-xs text-text-muted pt-0.5 text-right">{f.label}</span>
                <div className="flex-1 min-w-0">
                  <InlineTextarea
                    value={val}
                    onChange={v => onUpdate(f.key, v)}
                    placeholder={`点击填写${f.label}…`}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── 行内编辑组件：单行 ──────────────────────────────────────────

function InlineInput({
  value, onChange, className, placeholder, prefix, suffix,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  placeholder?: string
  prefix?: string
  suffix?: string
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
      {value ? <>{prefix}{value}{suffix}</> : (placeholder || '点击编辑…')}
    </div>
  )
}

// ── 行内编辑组件：多行 ──────────────────────────────────────────

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
