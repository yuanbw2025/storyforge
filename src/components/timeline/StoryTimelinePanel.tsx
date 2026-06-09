/**
 * 故事进程年表 — Phase 25.5.2-a
 *
 * 下游提取产物：AI 从已写正文中提取剧情大事，按故事进程排列。
 * 与「历史年表（世界背景）」「故事线（结构）」严格区分。
 */
import { useState, useEffect, useMemo } from 'react'
import { CalendarClock, Sparkles, Loader2, Trash2, Plus } from 'lucide-react'
import { useStoryTimelineStore } from '../../stores/story-timeline'
import { useChapterStore } from '../../stores/chapter'
import { useAIConfigStore } from '../../stores/ai-config'
import { chat } from '../../lib/ai/client'
import { buildStoryTimelinePrompt, parseStoryEvents } from '../../lib/ai/adapters/story-timeline-adapter'
import { htmlToPlainText } from '../../lib/utils/html'
import { STORY_IMPORTANCE_LABELS } from '../../lib/types/story-timeline'
import type { Project } from '../../lib/types'

interface Props {
  project: Project
}

const IMPORTANCE_STYLE: Record<number, string> = {
  1: 'bg-bg-elevated text-text-muted',
  2: 'bg-blue-500/10 text-blue-400',
  3: 'bg-amber-500/15 text-amber-400',
}

export default function StoryTimelinePanel({ project }: Props) {
  const { events, loading, loadAll, addEvent, addEvents, updateEvent, deleteEvent, deleteByChapter } = useStoryTimelineStore()
  const { chapters, loadAll: loadChapters } = useChapterStore()
  const aiConfig = useAIConfigStore(s => s.config)

  const [extracting, setExtracting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadAll(project.id!)
    loadChapters(project.id!)
  }, [project.id, loadAll, loadChapters])

  // 按章节进程排序（章节顺序 = 故事进程），同章按 order
  const sorted = useMemo(() => {
    const chapterOrder = new Map<number, number>()
    chapters.forEach((c, i) => { if (c.id != null) chapterOrder.set(c.id, i) })
    return [...events].sort((a, b) => {
      const ca = a.chapterId != null ? (chapterOrder.get(a.chapterId) ?? 9999) : 9999
      const cb = b.chapterId != null ? (chapterOrder.get(b.chapterId) ?? 9999) : 9999
      if (ca !== cb) return ca - cb
      return a.order - b.order
    })
  }, [events, chapters])

  const writtenChapters = useMemo(
    () => chapters.filter(c => c.content && htmlToPlainText(c.content).trim().length > 50),
    [chapters],
  )

  const handleExtract = async () => {
    if (!aiConfig.apiKey) { setError('请先在「设置」中配置 AI API Key'); return }
    if (writtenChapters.length === 0) { setError('还没有已写正文的章节，先去写作再提取'); return }
    setExtracting(true)
    setError(null)
    setProgress({ done: 0, total: writtenChapters.length })
    try {
      for (let i = 0; i < writtenChapters.length; i++) {
        const ch = writtenChapters[i]
        try {
          const messages = buildStoryTimelinePrompt(ch.title, htmlToPlainText(ch.content))
          const raw = await chat(messages, aiConfig, { category: 'story.timeline', projectId: project.id! })
          const parsed = parseStoryEvents(raw)
          if (ch.id != null) await deleteByChapter(project.id!, ch.id)
          if (parsed.length > 0) {
            await addEvents(parsed.map((e, idx) => ({
              projectId: project.id!,
              title: e.title,
              storyTime: e.storyTime || undefined,
              importance: e.importance,
              description: e.description || undefined,
              chapterId: ch.id ?? null,
              chapterTitle: ch.title,
              order: idx,
            })))
          }
        } catch (err) {
          console.error('[StoryTimeline] 章节提取失败:', ch.title, err)
        }
        setProgress({ done: i + 1, total: writtenChapters.length })
      }
    } finally {
      setExtracting(false)
      setProgress(null)
    }
  }

  const handleManualAdd = async () => {
    await addEvent({
      projectId: project.id!,
      title: '新事件',
      importance: 2,
      order: events.length,
    })
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="pb-4 border-b border-border/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
              <CalendarClock className="w-5 h-5" /> 故事进程年表
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              AI 从已写正文中提取剧情大事，按故事进程排列。区别于「历史年表」（世界背景）和「故事线」（结构）。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={handleManualAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-bg-elevated text-text-secondary border border-border hover:text-text-primary transition-colors">
              <Plus className="w-3.5 h-3.5" /> 手动添加
            </button>
            <button onClick={handleExtract} disabled={extracting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors">
              {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {extracting ? `提取中 ${progress?.done}/${progress?.total}` : '从正文提取年表'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">{error}</div>}

      {extracting && progress && (
        <div className="p-3 bg-accent/10 border border-accent/20 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-accent mb-1.5">
            <Loader2 className="w-4 h-4 animate-spin" /> 正在逐章提取剧情大事…（{progress.done}/{progress.total}）
          </div>
          <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-text-muted text-sm py-8 text-center">加载中...</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <CalendarClock className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">还没有故事年表</p>
          <p className="text-xs mt-1">写完一些章节后，点「从正文提取年表」让 AI 自动梳理剧情大事</p>
        </div>
      ) : (
        <div className="relative pl-6 border-l border-border/80 space-y-3 ml-2">
          {sorted.map(e => (
            <div key={e.id} className="relative group">
              <span className={`absolute -left-[31px] top-2 w-2.5 h-2.5 rounded-full border-2 bg-bg-base ${
                e.importance === 3 ? 'border-amber-500 ring-4 ring-amber-500/10'
                  : e.importance === 2 ? 'border-blue-500 ring-4 ring-blue-500/10'
                  : 'border-text-muted'
              }`} />
              <div className="bg-bg-surface border border-border rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  {e.storyTime && <span className="text-xs font-mono text-text-secondary">{e.storyTime}</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${IMPORTANCE_STYLE[e.importance]}`}>
                    {STORY_IMPORTANCE_LABELS[e.importance]}
                  </span>
                  {e.chapterTitle && <span className="text-[10px] text-text-muted">· {e.chapterTitle}</span>}
                  <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <select
                      value={e.importance}
                      onChange={ev => updateEvent(e.id!, { importance: Number(ev.target.value) })}
                      className="bg-bg-base border border-border rounded text-[10px] px-1 py-0.5 text-text-secondary"
                    >
                      <option value={1}>次要</option>
                      <option value={2}>重要</option>
                      <option value={3}>关键</option>
                    </select>
                    <button onClick={() => deleteEvent(e.id!)} className="p-0.5 text-text-muted hover:text-red-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <input
                  value={e.title}
                  onChange={ev => updateEvent(e.id!, { title: ev.target.value })}
                  className="w-full bg-transparent text-sm font-medium text-text-primary outline-none"
                />
                {e.description && <p className="text-xs text-text-muted mt-0.5">{e.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
