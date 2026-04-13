import { useState, useEffect } from 'react'
import { Plus, Trash2, Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import { useCharacterStore } from '../../stores/character'
import { useWorldviewStore } from '../../stores/worldview'
import { useAIStream } from '../../hooks/useAIStream'
import { buildCharacterPrompt } from '../../lib/ai/prompts/character'
import { buildWorldContext } from '../../lib/ai/context-builder'
import AIStreamOutput from '../shared/AIStreamOutput'
import type { Project, Character, CharacterRole } from '../../lib/types'

const ROLE_LABELS: Record<CharacterRole, string> = {
  protagonist: '🌟 主角',
  antagonist: '😈 反派',
  supporting: '👥 配角',
  minor: '👤 次要',
}

interface Props { project: Project }

export default function CharacterPanel({ project }: Props) {
  const { characters, loadAll, addCharacter, updateCharacter, deleteCharacter } = useCharacterStore()
  const { worldview, storyCore, powerSystem } = useWorldviewStore()
  const [selected, setSelected] = useState<number | null>(null)
  const [hint, setHint] = useState('')
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
    const messages = buildCharacterPrompt(project.name, project.genre, worldCtx, existing, hint)
    ai.start(messages)
  }

  return (
    <div className="flex gap-4 max-w-5xl">
      {/* 左侧列表 */}
      <div className="w-56 shrink-0 space-y-2">
        <button onClick={handleAdd} className="w-full flex items-center gap-1.5 px-3 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors">
          <Plus className="w-4 h-4" /> 添加角色
        </button>
        {characters.map(c => (
          <button key={c.id} onClick={() => setSelected(c.id!)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${selected === c.id ? 'bg-accent/10 text-accent border border-accent/30' : 'bg-bg-surface text-text-secondary hover:bg-bg-hover'}`}>
            <div className="font-medium truncate">{c.name}</div>
            <div className="text-xs text-text-muted">{ROLE_LABELS[c.role]}</div>
          </button>
        ))}
        {/* AI 生成 */}
        <div className="pt-2 border-t border-border space-y-2">
          <input value={hint} onChange={e => setHint(e.target.value)} placeholder="角色要求（可选）"
            className="w-full px-2 py-1.5 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent" />
          <button onClick={handleAIGenerate} disabled={ai.isStreaming}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-bg-elevated text-text-secondary text-sm rounded-md hover:text-accent disabled:opacity-50 transition-colors">
            <Sparkles className="w-3.5 h-3.5" /> AI 设计角色
          </button>
        </div>
      </div>

      {/* 右侧编辑 */}
      <div className="flex-1 space-y-3">
        {(ai.output || ai.isStreaming || ai.error) && (
          <AIStreamOutput output={ai.output} isStreaming={ai.isStreaming} error={ai.error}
            onStop={ai.stop} onAccept={() => ai.reset()} onRetry={handleAIGenerate} />
        )}
        {selectedChar ? (
          <CharacterEditor char={selectedChar} onUpdate={handleUpdate}
            onDelete={() => { deleteCharacter(selectedChar.id!); setSelected(null) }} />
        ) : (
          <div className="flex items-center justify-center h-64 text-text-muted text-sm">
            ← 选择或添加一个角色
          </div>
        )}
      </div>
    </div>
  )
}

function CharacterEditor({ char, onUpdate, onDelete }: {
  char: Character; onUpdate: (f: keyof Character, v: string) => void; onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const fields: { key: keyof Character; label: string; rows?: number }[] = [
    { key: 'shortDescription', label: '一句话简介' },
    { key: 'appearance', label: '外貌', rows: 2 },
    { key: 'personality', label: '性格', rows: 2 },
    { key: 'background', label: '背景故事', rows: 3 },
    { key: 'motivation', label: '动机', rows: 2 },
    { key: 'abilities', label: '能力', rows: 2 },
    { key: 'arc', label: '角色弧光', rows: 2 },
  ]

  return (
    <div className="bg-bg-surface border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input value={char.name} onChange={e => onUpdate('name', e.target.value)}
            className="text-lg font-bold bg-transparent text-text-primary border-none outline-none" />
          <select value={char.role} onChange={e => onUpdate('role', e.target.value)}
            className="px-2 py-1 bg-bg-elevated text-text-secondary text-xs rounded border border-border">
            {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setExpanded(!expanded)} className="text-text-muted hover:text-text-primary">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <button onClick={onDelete} className="text-text-muted hover:text-error"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
      {expanded && fields.map(f => (
        <div key={f.key}>
          <label className="block text-xs text-text-muted mb-1">{f.label}</label>
          <textarea value={(char[f.key] as string) || ''} onChange={e => onUpdate(f.key, e.target.value)}
            rows={f.rows || 1}
            className="w-full p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent" />
        </div>
      ))}
    </div>
  )
}
