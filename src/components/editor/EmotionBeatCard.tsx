/**
 * 情感节拍卡组件 — 嵌入 ChapterEditor，在写作前/中展示和编辑情感节奏规划
 * 支持：AI 生成、手动编辑、展开/折叠、删除
 */
import { useState, useEffect } from 'react'
import { Heart, Sparkles, ChevronUp, Trash2, Edit3, Save, Plus, X, RotateCcw } from 'lucide-react'
import { useEmotionBeatStore } from '../../stores/emotion-beat'
import { useAIStream } from '../../hooks/useAIStream'
import { buildEmotionBeatPrompt, parseEmotionBeats } from '../../lib/ai/adapters/emotion-beat-adapter'
import type { EmotionBeat } from '../../lib/types'

interface Props {
  projectId: number
  chapterId: number
  chapterTitle: string
  chapterSummary: string
  worldContext: string
  characterContext: string
  prevChapterEnding: string
}

const TONE_COLORS: Record<string, string> = {
  '紧张': 'bg-red-500/15 text-red-400',
  '温馨': 'bg-amber-500/15 text-amber-400',
  '悲伤': 'bg-blue-500/15 text-blue-400',
  '欢乐': 'bg-yellow-500/15 text-yellow-400',
  '愤怒': 'bg-orange-500/15 text-orange-400',
  '恐惧': 'bg-purple-500/15 text-purple-400',
  '平静': 'bg-green-500/15 text-green-400',
  '震撼': 'bg-pink-500/15 text-pink-400',
  '期待': 'bg-cyan-500/15 text-cyan-400',
}

function getToneColor(tone: string): string {
  for (const [key, cls] of Object.entries(TONE_COLORS)) {
    if (tone.includes(key)) return cls
  }
  return 'bg-bg-elevated text-text-muted'
}

export default function EmotionBeatCard({
  projectId, chapterId, chapterTitle, chapterSummary,
  worldContext, characterContext, prevChapterEnding,
}: Props) {
  const { getByChapter, saveCard, updateCard, deleteCard, loadAll } = useEmotionBeatStore()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editBeats, setEditBeats] = useState<EmotionBeat[]>([])
  const [editArc, setEditArc] = useState('')
  const ai = useAIStream()

  useEffect(() => { loadAll(projectId) }, [projectId, loadAll])

  const card = getByChapter(chapterId)

  const handleGenerate = async () => {
    try {
      const messages = buildEmotionBeatPrompt(
        chapterTitle, chapterSummary, worldContext, characterContext, prevChapterEnding,
      )
      console.log('[EmotionBeat] 开始生成节拍卡:', chapterTitle)
      const raw = await ai.start(messages)
      const { overallArc, beats, error } = parseEmotionBeats(raw)
      if (error) console.warn('[EmotionBeat] 解析警告:', error)
      if (beats.length > 0) {
        await saveCard({
          projectId,
          chapterId,
          chapterTitle,
          overallArc,
          beats,
          source: 'ai',
        })
        console.log(`[EmotionBeat] 节拍卡已保存: ${beats.length} 个节拍`)
        setExpanded(true)
      }
      ai.reset()
    } catch (err) {
      console.error('[EmotionBeat] 生成失败:', err)
    }
  }

  const handleStartEdit = () => {
    if (card) {
      setEditBeats([...card.beats])
      setEditArc(card.overallArc)
    } else {
      setEditBeats([{ label: '', sceneGoal: '', emotionTone: '', readerFeeling: '', characterGrowth: '' }])
      setEditArc('')
    }
    setEditing(true)
  }

  const handleSaveEdit = async () => {
    try {
      const validBeats = editBeats.filter(b => b.label.trim())
      if (card?.id) {
        await updateCard(card.id, { overallArc: editArc, beats: validBeats })
      } else {
        await saveCard({
          projectId, chapterId, chapterTitle,
          overallArc: editArc, beats: validBeats, source: 'manual',
        })
      }
      setEditing(false)
      setExpanded(true)
      console.log('[EmotionBeat] 手动编辑已保存')
    } catch (err) {
      console.error('[EmotionBeat] 保存失败:', err)
    }
  }

  const handleDelete = async () => {
    if (!card?.id) return
    if (!confirm('确定删除本章的情感节拍卡？')) return
    try {
      await deleteCard(card.id)
      setExpanded(false)
      setEditing(false)
      console.log('[EmotionBeat] 节拍卡已删除')
    } catch (err) {
      console.error('[EmotionBeat] 删除失败:', err)
    }
  }

  const addBeat = () => {
    setEditBeats([...editBeats, { label: '', sceneGoal: '', emotionTone: '', readerFeeling: '', characterGrowth: '' }])
  }

  const removeBeat = (idx: number) => {
    setEditBeats(editBeats.filter((_, i) => i !== idx))
  }

  const updateBeat = (idx: number, field: keyof EmotionBeat, value: string) => {
    const next = [...editBeats]
    next[idx] = { ...next[idx], [field]: value }
    setEditBeats(next)
  }

  // 紧凑模式 — 没展开时只显示一行
  if (!expanded && !editing) {
    return (
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => card ? setExpanded(true) : handleGenerate()}
          disabled={ai.isStreaming}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 disabled:opacity-50"
        >
          <Heart className="w-3.5 h-3.5" />
          {ai.isStreaming ? '生成中...' : card ? `情感节拍（${card.beats.length}拍）` : '生成情感节拍'}
        </button>
        {card && (
          <span className="text-[10px] text-text-muted">{card.overallArc.slice(0, 40)}{card.overallArc.length > 40 ? '...' : ''}</span>
        )}
      </div>
    )
  }

  // 编辑模式
  if (editing) {
    return (
      <div className="mb-3 p-3 bg-bg-surface border border-pink-500/20 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-pink-400" />
            <span className="font-semibold text-sm text-text-primary">编辑情感节拍</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="text-xs text-text-muted hover:text-text-primary">取消</button>
            <button onClick={handleSaveEdit}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover">
              <Save className="w-3 h-3" /> 保存
            </button>
          </div>
        </div>

        <input value={editArc} onChange={e => setEditArc(e.target.value)}
          placeholder="整章情感概述..."
          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary" />

        {editBeats.map((beat, idx) => (
          <div key={idx} className="p-2 bg-bg-elevated rounded-lg space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted w-6 text-right">{idx + 1}.</span>
              <input value={beat.label} onChange={e => updateBeat(idx, 'label', e.target.value)}
                placeholder="节拍名" className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary font-medium" />
              <input value={beat.emotionTone} onChange={e => updateBeat(idx, 'emotionTone', e.target.value)}
                placeholder="情感基调" className="w-24 px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary" />
              <button onClick={() => removeBeat(idx)} className="p-0.5 text-text-muted hover:text-error">
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="ml-8 grid grid-cols-1 gap-1.5">
              <input value={beat.sceneGoal} onChange={e => updateBeat(idx, 'sceneGoal', e.target.value)}
                placeholder="场景目标" className="px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary" />
              <input value={beat.readerFeeling} onChange={e => updateBeat(idx, 'readerFeeling', e.target.value)}
                placeholder="期望读者感受" className="px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary" />
              <input value={beat.characterGrowth} onChange={e => updateBeat(idx, 'characterGrowth', e.target.value)}
                placeholder="角色变化/成长" className="px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary" />
            </div>
          </div>
        ))}
        <button onClick={addBeat} className="text-xs text-accent hover:text-accent-hover">
          <Plus className="w-3 h-3 inline mr-1" />添加节拍
        </button>
      </div>
    )
  }

  // 展开查看模式
  return (
    <div className="mb-3 p-3 bg-bg-surface border border-pink-500/20 rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-pink-400" />
          <span className="font-semibold text-sm text-text-primary">情感节拍</span>
          {card && <span className="text-[10px] text-text-muted">（{card.beats.length}拍 · {card.source === 'ai' ? 'AI生成' : '手动'}）</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={handleGenerate} disabled={ai.isStreaming}
            title="重新生成"
            className="p-1 text-text-muted hover:text-accent transition-colors disabled:opacity-50">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleStartEdit} title="编辑"
            className="p-1 text-text-muted hover:text-accent transition-colors">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          {card?.id && (
            <button onClick={handleDelete} title="删除"
              className="p-1 text-text-muted hover:text-error transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => setExpanded(false)}
            className="p-1 text-text-muted hover:text-text-primary">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {card?.overallArc && (
        <p className="text-xs text-text-secondary mb-2 italic">{card.overallArc}</p>
      )}

      {card && card.beats.length > 0 && (
        <div className="space-y-2">
          {card.beats.map((beat, idx) => (
            <div key={idx} className="flex gap-2 text-xs">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center text-[10px] font-bold mt-0.5">
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-text-primary">{beat.label}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${getToneColor(beat.emotionTone)}`}>
                    {beat.emotionTone}
                  </span>
                </div>
                <div className="text-text-muted space-y-0.5">
                  {beat.sceneGoal && <p>🎯 {beat.sceneGoal}</p>}
                  {beat.readerFeeling && <p>💭 {beat.readerFeeling}</p>}
                  {beat.characterGrowth && <p>📈 {beat.characterGrowth}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {ai.isStreaming && (
        <p className="text-xs text-text-muted mt-2 animate-pulse">
          <Sparkles className="w-3 h-3 inline mr-1" />正在生成情感节拍...
        </p>
      )}
    </div>
  )
}
