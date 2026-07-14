import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, CornerDownRight, GripVertical, LayoutList, Plus, Sparkles, Trash2 } from 'lucide-react'
import { CInput } from '../shared/CompositionInput'
import { useDialog } from '../shared/Dialog'
import { useDragReorder, type ItemDnD } from './useDragReorder'
import {
  OUTLINE_CHAPTER_DRAG_MIME,
  chapterDropProps,
  readChapterDragPayload,
  type ChapterDragPayload,
  type GetActiveChapterDrag,
} from './chapter-drag'

interface ChapterRowProps {
  ch: { id?: number; title: string; summary: string }
  idx: number
  onUpdate: (id: number, patch: Record<string, string>) => void
  onDelete: (id: number) => void
  onOpen?: (id: number) => void
  dnd?: ItemDnD
  onInsertAfter?: () => void
  onGenerate?: () => void
  parentId?: number
  onMoveChapter?: (chapterId: number, targetParentId: number, index: number) => Promise<void>
  activeChapterDrag: ChapterDragPayload | null
  getActiveChapterDrag: GetActiveChapterDrag
  onChapterDragStart: (payload: ChapterDragPayload) => void
  onChapterDragEnd: () => void
}

export function OutlineChapterRow({
  ch,
  idx,
  onUpdate,
  onDelete,
  onOpen,
  dnd,
  onInsertAfter,
  onGenerate,
  parentId,
  onMoveChapter,
  activeChapterDrag,
  getActiveChapterDrag,
  onChapterDragStart,
  onChapterDragEnd,
}: ChapterRowProps) {
  const [summaryDraft, setSummaryDraft] = useState(ch.summary || '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { setSummaryDraft(ch.summary || '') }, [ch.summary])
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [summaryDraft])

  const crossParentDrop = parentId != null && onMoveChapter
    ? chapterDropProps({
      targetParentId: parentId,
      targetIndex: idx,
      onMoveChapter,
      getActiveChapterDrag,
      clearActiveChapterDrag: onChapterDragEnd,
    })
    : null
  const baseDropProps = dnd?.dropProps
  const isCrossParentTarget = activeChapterDrag != null && activeChapterDrag.sourceParentId !== parentId
  const isOver = dnd?.isOver || isCrossParentTarget

  return (
    <div
      {...(baseDropProps ?? {})}
      onDragOver={(event) => {
        if (isCrossParentTarget) {
          crossParentDrop?.onDragOver(event)
          return
        }
        baseDropProps?.onDragOver(event)
      }}
      onDrop={(event) => {
        const payload = readChapterDragPayload(event) ?? getActiveChapterDrag()
        if (crossParentDrop && payload && payload.sourceParentId !== parentId) {
          void crossParentDrop.onDrop(event)
          return
        }
        baseDropProps?.onDrop(event)
      }}
      className={`flex items-start gap-1 px-2 py-2 bg-bg-surface border rounded-md group transition-colors ${
        isOver ? 'border-accent ring-1 ring-accent/50' : 'border-border hover:border-accent/30'
      } ${dnd?.isDragging ? 'opacity-40' : ''}`}
    >
      {dnd && (
        <span
          {...dnd.dragHandleProps}
          onDragStart={(event) => {
            dnd.dragHandleProps.onDragStart(event)
            if (ch.id != null) {
              const payload = {
                chapterId: ch.id,
                sourceParentId: parentId ?? null,
              } satisfies ChapterDragPayload
              onChapterDragStart(payload)
              event.dataTransfer.setData(OUTLINE_CHAPTER_DRAG_MIME, JSON.stringify(payload))
            }
          }}
          onDragEnd={() => {
            dnd.dragHandleProps.onDragEnd()
            onChapterDragEnd()
          }}
          data-outline-chapter-id={ch.id}
          title="拖动调整章节顺序"
          className="shrink-0 mt-1 cursor-grab active:cursor-grabbing text-text-muted/40 group-hover:text-text-muted"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </span>
      )}
      <span className="text-xs text-text-muted mt-1.5 shrink-0 w-5 text-right">{idx + 1}</span>
      <div className="flex-1 min-w-0">
        <CInput
          value={ch.title}
          onChange={event => onUpdate(ch.id!, { title: event.target.value })}
          className="w-full bg-transparent text-text-primary text-sm font-medium outline-none"
        />
        <textarea
          ref={textareaRef}
          value={summaryDraft}
          onChange={event => setSummaryDraft(event.target.value)}
          onBlur={() => {
            if (ch.id != null && summaryDraft !== (ch.summary || '')) onUpdate(ch.id, { summary: summaryDraft })
          }}
          rows={1}
          placeholder="章节摘要（可编辑，失焦自动保存）"
          className="w-full bg-transparent text-text-muted text-xs outline-none mt-0.5 resize-none overflow-hidden leading-relaxed"
        />
      </div>
      <div className={`flex items-center gap-0.5 transition-opacity shrink-0 mt-1 ${
        !ch.summary.trim() && onGenerate ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}>
        {!ch.summary.trim() && onGenerate && (
          <button onClick={onGenerate} className="p-1 text-text-muted hover:text-accent rounded" title="AI 生成本章章纲">
            <Sparkles className="w-3.5 h-3.5" />
          </button>
        )}
        {onInsertAfter && (
          <button onClick={onInsertAfter} className="p-1 text-text-muted hover:text-accent rounded" title="在此章下方插入一章">
            <CornerDownRight className="w-3.5 h-3.5" />
          </button>
        )}
        {onOpen && (
          <button onClick={() => onOpen(ch.id!)} className="p-1 text-text-muted hover:text-accent rounded" title="编辑章节">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={() => onDelete(ch.id!)} className="p-1 text-text-muted hover:text-error rounded">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

export function OutlineStoryBlockSection({
  block,
  chapters,
  onUpdateNode,
  onDeleteNode,
  onAddChapter,
  onOpenChapter,
  onReorder,
  onInsertAfter,
  onGenerateChapter,
  onMoveChapter,
  activeChapterDrag,
  getActiveChapterDrag,
  onChapterDragStart,
  onChapterDragEnd,
}: {
  block: { id?: number; title: string; summary: string }
  chapters: { id?: number; title: string; summary: string }[]
  onUpdateNode: (id: number, patch: Record<string, string>) => void
  onDeleteNode: (id: number) => void
  onAddChapter: () => void
  onOpenChapter?: (id: number) => void
  onReorder: (orderedIds: number[]) => void
  onInsertAfter: (chapterId: number) => void
  onGenerateChapter: (chapterId: number) => void
  onMoveChapter: (chapterId: number, targetParentId: number, index: number) => Promise<void>
  activeChapterDrag: ChapterDragPayload | null
  getActiveChapterDrag: GetActiveChapterDrag
  onChapterDragStart: (payload: ChapterDragPayload) => void
  onChapterDragEnd: () => void
}) {
  const dialog = useDialog()
  const [expanded, setExpanded] = useState(true)
  const blockChaptersDnD = useDragReorder(chapters.map(chapter => chapter.id), onReorder)
  const handleDeleteBlock = async () => {
    if (!block.id) return
    const ok = await dialog.confirm({
      title: `删除故事块「${block.title}」？`,
      message: '其下章节也会被删除，此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (ok) onDeleteNode(block.id)
  }
  const dropToBlockEnd = block.id != null
    ? chapterDropProps({
      targetParentId: block.id,
      targetIndex: chapters.length,
      onMoveChapter,
      getActiveChapterDrag,
      clearActiveChapterDrag: onChapterDragEnd,
    })
    : null

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        onDragOver={event => dropToBlockEnd?.onDragOver(event)}
        onDrop={event => { if (dropToBlockEnd) void dropToBlockEnd.onDrop(event) }}
        className="flex items-center gap-2 px-3 py-2 bg-bg-elevated"
      >
        <button onClick={() => setExpanded(!expanded)} className="text-text-muted hover:text-text-primary">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <LayoutList className="w-3.5 h-3.5 text-accent/60" />
        <CInput
          value={block.title}
          onChange={event => onUpdateNode(block.id!, { title: event.target.value })}
          className="flex-1 bg-transparent text-text-primary text-sm font-medium outline-none"
        />
        <span className="text-[10px] text-text-muted">{chapters.length} 章</span>
        <button onClick={onAddChapter} className="p-1 text-text-muted hover:text-accent rounded" title="添加章节">
          <Plus className="w-3 h-3" />
        </button>
        <button onClick={() => { void handleDeleteBlock() }} className="p-1 text-text-muted hover:text-error rounded">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <CInput
        value={block.summary}
        onChange={event => onUpdateNode(block.id!, { summary: event.target.value })}
        placeholder="故事块描述..."
        className="w-full px-3 py-1.5 bg-bg-surface text-text-muted text-xs border-b border-border focus:outline-none"
      />
      {expanded && (
        <div className="p-2 space-y-1">
          {chapters.length === 0 ? (
            <div
              onDragOver={event => dropToBlockEnd?.onDragOver(event)}
              onDrop={event => { if (dropToBlockEnd) void dropToBlockEnd.onDrop(event) }}
              className="text-center py-3 text-text-muted text-xs border border-dashed border-transparent hover:border-accent/40 rounded"
            >
              点击 + 添加章节
            </div>
          ) : (
            chapters.map((chapter, index) => (
              <OutlineChapterRow
                key={chapter.id}
                ch={chapter}
                idx={index}
                onUpdate={onUpdateNode}
                onDelete={onDeleteNode}
                onOpen={onOpenChapter}
                dnd={blockChaptersDnD.itemDnD(chapter.id)}
                onInsertAfter={() => onInsertAfter(chapter.id!)}
                onGenerate={() => onGenerateChapter(chapter.id!)}
                parentId={block.id!}
                onMoveChapter={onMoveChapter}
                activeChapterDrag={activeChapterDrag}
                getActiveChapterDrag={getActiveChapterDrag}
                onChapterDragStart={onChapterDragStart}
                onChapterDragEnd={onChapterDragEnd}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
