import { useState, useEffect } from 'react'
import { Plus, Trash2, Sparkles, ChevronDown, ChevronRight, BookOpen } from 'lucide-react'
import { useOutlineStore } from '../../stores/outline'
import { useWorldviewStore } from '../../stores/worldview'
import { useAIStream } from '../../hooks/useAIStream'
import { buildVolumeOutlinePrompt, buildChapterOutlinePrompt } from '../../lib/ai/prompts/outline'
import { buildWorldContext } from '../../lib/ai/context-builder'
import AIStreamOutput from '../shared/AIStreamOutput'
import type { Project, OutlineNode } from '../../lib/types'

interface Props {
  project: Project
  onOpenChapter?: (nodeId: number) => void
}

export default function OutlinePanel({ project, onOpenChapter }: Props) {
  const { nodes, loadAll, addNode, updateNode, deleteNode } = useOutlineStore()
  const { worldview, storyCore, powerSystem } = useWorldviewStore()
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [hint, setHint] = useState('')
  const ai = useAIStream()

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const toggle = (id: number) => {
    const s = new Set(expandedIds)
    s.has(id) ? s.delete(id) : s.add(id)
    setExpandedIds(s)
  }

  const volumes = nodes.filter(n => n.type === 'volume' && n.parentId === null)

  const handleAddVolume = async () => {
    await addNode({
      projectId: project.id!, parentId: null, type: 'volume',
      title: `第${volumes.length + 1}卷`, summary: '', order: volumes.length,
    })
  }

  const handleAddChapter = async (volumeId: number) => {
    const children = nodes.filter(n => n.parentId === volumeId)
    await addNode({
      projectId: project.id!, parentId: volumeId, type: 'chapter',
      title: `第${children.length + 1}章`, summary: '', order: children.length,
    })
  }

  const handleAIVolumes = async () => {
    const worldCtx = buildWorldContext(worldview, storyCore, powerSystem)
    const scCtx = storyCore ? `主题：${storyCore.theme}\n冲突：${storyCore.centralConflict}\n故事线：${storyCore.storyLines}` : ''
    const messages = buildVolumeOutlinePrompt(project.name, project.genre, worldCtx, scCtx, project.targetWordCount || 500000, hint)
    ai.start(messages)
  }

  const handleAIChapters = async (volume: OutlineNode) => {
    const worldCtx = buildWorldContext(worldview, storyCore, powerSystem)
    const volIdx = volumes.indexOf(volume)
    const prevSummary = volIdx > 0 ? volumes[volIdx - 1].summary : ''
    const messages = buildChapterOutlinePrompt(volume.title, volume.summary, worldCtx, prevSummary, hint)
    ai.start(messages)
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-text-primary">📖 大纲</h2>
        <div className="flex gap-2">
          <button onClick={handleAddVolume}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-elevated text-text-secondary text-sm rounded-md hover:text-text-primary transition-colors">
            <Plus className="w-4 h-4" /> 添加卷
          </button>
          <button onClick={handleAIVolumes} disabled={ai.isStreaming}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors">
            <Sparkles className="w-4 h-4" /> AI 生成卷级大纲
          </button>
        </div>
      </div>

      <input value={hint} onChange={e => setHint(e.target.value)} placeholder="给 AI 的补充说明（可选）"
        className="w-full mb-3 px-3 py-2 bg-bg-surface border border-border rounded-md text-text-primary text-sm focus:outline-none focus:border-accent" />

      {(ai.output || ai.isStreaming || ai.error) && (
        <div className="mb-4">
          <AIStreamOutput output={ai.output} isStreaming={ai.isStreaming} error={ai.error}
            onStop={ai.stop} onAccept={() => ai.reset()} onRetry={handleAIVolumes} />
        </div>
      )}

      {/* 大纲树 */}
      <div className="space-y-2">
        {volumes.map(vol => {
          const children = nodes.filter(n => n.parentId === vol.id).sort((a, b) => a.order - b.order)
          const isExpanded = expandedIds.has(vol.id!)
          return (
            <div key={vol.id} className="border border-border rounded-lg overflow-hidden">
              {/* 卷头 */}
              <div className="flex items-center gap-2 px-3 py-2 bg-bg-elevated">
                <button onClick={() => toggle(vol.id!)} className="text-text-muted hover:text-text-primary">
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <input value={vol.title} onChange={e => updateNode(vol.id!, { title: e.target.value })}
                  className="flex-1 bg-transparent text-text-primary font-medium text-sm outline-none" />
                <span className="text-xs text-text-muted">{children.length} 章</span>
                <button onClick={() => handleAIChapters(vol)} className="text-text-muted hover:text-accent" title="AI 展开为章节">
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleAddChapter(vol.id!)} className="text-text-muted hover:text-accent" title="添加章节">
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => deleteNode(vol.id!)} className="text-text-muted hover:text-error">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {/* 卷摘要 */}
              <textarea value={vol.summary} onChange={e => updateNode(vol.id!, { summary: e.target.value })}
                placeholder="卷情节摘要..." rows={2}
                className="w-full px-3 py-2 bg-bg-surface text-text-secondary text-xs resize-none border-b border-border focus:outline-none" />
              {/* 章节列表 */}
              {isExpanded && children.map(ch => (
                <div key={ch.id} className="flex items-center gap-2 px-6 py-1.5 bg-bg-surface border-b border-border last:border-b-0 hover:bg-bg-hover group">
                  <input value={ch.title} onChange={e => updateNode(ch.id!, { title: e.target.value })}
                    className="w-32 shrink-0 bg-transparent text-text-primary text-sm outline-none" />
                  <input value={ch.summary} onChange={e => updateNode(ch.id!, { summary: e.target.value })}
                    placeholder="章节摘要..."
                    className="flex-1 bg-transparent text-text-muted text-xs outline-none" />
                  {onOpenChapter && (
                    <button onClick={() => onOpenChapter(ch.id!)} className="text-text-muted hover:text-accent opacity-0 group-hover:opacity-100" title="写作">
                      <BookOpen className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => deleteNode(ch.id!)} className="text-text-muted hover:text-error opacity-0 group-hover:opacity-100">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )
        })}
        {volumes.length === 0 && (
          <div className="text-center py-12 text-text-muted text-sm">
            还没有大纲，点击"添加卷"或"AI 生成"开始
          </div>
        )}
      </div>
    </div>
  )
}
