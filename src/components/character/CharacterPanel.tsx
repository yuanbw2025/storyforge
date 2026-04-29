import { useState, useEffect } from 'react'
import {
  Plus, Trash2, Sparkles, ChevronDown, ChevronRight,
  LayoutGrid, LayoutList, User,
} from 'lucide-react'
import { useCharacterStore } from '../../stores/character'
import { useWorldviewStore } from '../../stores/worldview'
import { useAIStream } from '../../hooks/useAIStream'
import { buildCharacterPrompt } from '../../lib/ai/prompts/character'
import { buildWorldContext } from '../../lib/ai/context-builder'
import AIStreamOutput from '../shared/AIStreamOutput'
import type { Project, Character, CharacterRole } from '../../lib/types'

const ROLE_LABELS: Record<CharacterRole, string> = {
  protagonist: '主角',
  antagonist:  '反派',
  supporting:  '配角',
  minor:       '次要',
}

const ROLE_COLORS: Record<CharacterRole, string> = {
  protagonist: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  antagonist:  'text-red-400 bg-red-400/10 border-red-400/30',
  supporting:  'text-blue-400 bg-blue-400/10 border-blue-400/30',
  minor:       'text-text-muted bg-bg-elevated border-border',
}

type ViewMode = 'card' | 'table'

interface Props { project: Project }

export default function CharacterPanel({ project }: Props) {
  const { characters, loadAll, addCharacter, updateCharacter, deleteCharacter } = useCharacterStore()
  const { worldview, storyCore, powerSystem } = useWorldviewStore()
  const [selected, setSelected] = useState<number | null>(null)
  const [hint, setHint] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    characters.length > 10 ? 'table' : 'card'
  )
  const ai = useAIStream()

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  // 超过 10 个角色自动切换表格视图
  useEffect(() => {
    if (characters.length > 10 && viewMode === 'card') setViewMode('table')
  }, [characters.length])

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
    const messages = buildCharacterPrompt(project.name, project.genre ?? '', worldCtx, existing, hint)
    ai.start(messages)
  }

  return (
    <div className="max-w-5xl space-y-4">
      {/* 工具栏 */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors"
        >
          <Plus className="w-4 h-4" /> 添加角色
        </button>

        {/* AI 生成 */}
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

        {/* 视图切换 */}
        <div className="flex items-center gap-1 bg-bg-elevated rounded-lg p-1 ml-auto">
          <button
            onClick={() => setViewMode('card')}
            title="卡片视图"
            className={`p-1.5 rounded transition-colors ${viewMode === 'card' ? 'bg-bg-surface text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('table')}
            title="表格视图"
            className={`p-1.5 rounded transition-colors ${viewMode === 'table' ? 'bg-bg-surface text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          >
            <LayoutList className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* AI 输出 */}
      {(ai.output || ai.isStreaming || ai.error) && (
        <AIStreamOutput
          output={ai.output}
          isStreaming={ai.isStreaming}
          error={ai.error}
          onStop={ai.stop}
          onAccept={() => ai.reset()}
          onRetry={handleAIGenerate}
        />
      )}

      <div className="flex gap-4">
        {/* 角色列表：卡片或表格 */}
        <div className={selectedChar ? 'w-80 shrink-0' : 'flex-1'}>
          {characters.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-3">
              <User className="w-12 h-12 opacity-20" />
              <p className="text-sm">还没有角色，点击「添加角色」开始创作</p>
            </div>
          )}

          {viewMode === 'card' && characters.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {characters.map(c => (
                <CharacterCard
                  key={c.id}
                  char={c}
                  active={selected === c.id}
                  onClick={() => setSelected(selected === c.id ? null : c.id!)}
                />
              ))}
            </div>
          )}

          {viewMode === 'table' && characters.length > 0 && (
            <CharacterTable
              characters={characters}
              activeId={selected}
              onSelect={id => setSelected(selected === id ? null : id)}
            />
          )}
        </div>

        {/* 详情编辑器 */}
        {selectedChar && (
          <div className="flex-1 min-w-0">
            <CharacterEditor
              char={selectedChar}
              onUpdate={handleUpdate}
              onDelete={() => { deleteCharacter(selectedChar.id!); setSelected(null) }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── 卡片视图 ─────────────────────────────────────────────────
function CharacterCard({
  char, active, onClick,
}: { char: Character; active: boolean; onClick: () => void }) {
  const colorClass = ROLE_COLORS[char.role]
  return (
    <button
      onClick={onClick}
      className={`group relative rounded-xl border p-4 text-left transition-all hover:border-accent/50 ${active ? 'border-accent bg-accent/5' : 'border-border bg-bg-surface'}`}
    >
      {/* 头像占位 */}
      <div className="w-12 h-12 rounded-full bg-bg-elevated flex items-center justify-center mb-3 mx-auto">
        <User className="w-6 h-6 text-text-muted" />
      </div>
      <p className="font-semibold text-text-primary text-sm text-center truncate">{char.name}</p>
      <div className="flex justify-center mt-1.5">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colorClass}`}>
          {ROLE_LABELS[char.role]}
        </span>
      </div>
      {char.shortDescription && (
        <p className="text-xs text-text-muted mt-2 line-clamp-2 text-center">{char.shortDescription}</p>
      )}
    </button>
  )
}

// ── 表格视图 ─────────────────────────────────────────────────
function CharacterTable({
  characters, activeId, onSelect,
}: { characters: Character[]; activeId: number | null; onSelect: (id: number) => void }) {
  return (
    <div className="bg-bg-surface border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-elevated">
            <th className="text-left px-4 py-2.5 text-xs font-medium text-text-muted">姓名</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-text-muted">定位</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-text-muted hidden md:table-cell">简介</th>
          </tr>
        </thead>
        <tbody>
          {characters.map((c, i) => {
            const colorClass = ROLE_COLORS[c.role]
            return (
              <tr
                key={c.id}
                onClick={() => onSelect(c.id!)}
                className={`border-b border-border/50 cursor-pointer transition-colors last:border-0 ${
                  activeId === c.id ? 'bg-accent/5' : i % 2 === 0 ? 'hover:bg-bg-hover' : 'bg-bg-elevated/30 hover:bg-bg-hover'
                }`}
              >
                <td className="px-4 py-2.5 font-medium text-text-primary">{c.name}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colorClass}`}>
                    {ROLE_LABELS[c.role]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-text-muted truncate max-w-xs hidden md:table-cell">
                  {c.shortDescription || '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── 角色详情编辑器 ───────────────────────────────────────────
function CharacterEditor({
  char, onUpdate, onDelete,
}: {
  char: Character
  onUpdate: (f: keyof Character, v: string) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const fields: { key: keyof Character; label: string; rows?: number }[] = [
    { key: 'shortDescription', label: '一句话简介' },
    { key: 'appearance',       label: '外貌',     rows: 2 },
    { key: 'personality',      label: '性格',     rows: 2 },
    { key: 'background',       label: '背景故事', rows: 3 },
    { key: 'motivation',       label: '动机',     rows: 2 },
    { key: 'abilities',        label: '能力',     rows: 2 },
    { key: 'arc',              label: '角色弧光', rows: 2 },
  ]

  return (
    <div className="bg-bg-surface border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={char.name}
            onChange={e => onUpdate('name', e.target.value)}
            className="text-lg font-bold bg-transparent text-text-primary border-none outline-none w-32"
          />
          <select
            value={char.role}
            onChange={e => onUpdate('role', e.target.value)}
            className="px-2 py-1 bg-bg-elevated text-text-secondary text-xs rounded border border-border focus:outline-none focus:border-accent"
          >
            {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setExpanded(!expanded)} className="p-1 text-text-muted hover:text-text-primary rounded">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <button onClick={onDelete} className="p-1 text-text-muted hover:text-error rounded">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && fields.map(f => (
        <div key={String(f.key)}>
          <label className="block text-xs text-text-muted mb-1">{f.label}</label>
          <textarea
            value={(char[f.key] as string) || ''}
            onChange={e => onUpdate(f.key, e.target.value)}
            rows={f.rows || 1}
            className="w-full p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
          />
        </div>
      ))}
    </div>
  )
}
