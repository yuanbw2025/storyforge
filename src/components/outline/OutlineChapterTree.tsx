import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, CornerDownRight, GripVertical, LayoutList, Plus, Sparkles, Trash2 } from 'lucide-react'
import AcknowledgedTextField from '../shared/AcknowledgedTextField'
import { useToast } from '../shared/Toast'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { useDragReorder, type ItemDnD } from './useDragReorder'
import {
  OUTLINE_CHAPTER_DRAG_MIME,
  chapterDropProps,
  readChapterDragPayload,
  type ChapterDragPayload,
  type GetActiveChapterDrag,
} from './chapter-drag'
import {
  INITIAL_RECORD_TARGET_CLASS,
  initialRecordTargetAttributes,
} from '../shared/initial-record-target'

interface ChapterRowProps {
  ch: { id?: number; title: string; summary: string }
  idx: number
  targeted?: boolean
  onUpdate: (id: number, patch: Record<string, string>, options?: { expected?: Record<string, string> }) => void | Promise<void>
  onDelete: (id: number) => void
  onOpen?: (id: number) => void
  onOpenDetail?: (id: number) => void
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
  targeted = false,
  onUpdate,
  onDelete,
  onOpen,
  onOpenDetail,
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
      data-outline-chapter-row={ch.id}
      {...initialRecordTargetAttributes(targeted, ch.id)}
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
      } ${dnd?.isDragging ? 'opacity-40' : ''} ${targeted ? INITIAL_RECORD_TARGET_CLASS : ''}`}
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
        <AcknowledgedTextField input label="章节标题"
          value={ch.title}
          onCommit={(value, expected) => onUpdate(ch.id!, { title: value }, { expected: { title: expected as string } })}
          className="w-full bg-transparent text-text-primary text-sm font-medium outline-none"
        />
        <AcknowledgedTextField autoGrow label="章节摘要" rows={1}
          value={ch.summary}
          onCommit={(value, expected) => onUpdate(ch.id!, { summary: value }, { expected: { summary: expected as string } })}
          placeholder="章节摘要（可编辑，失焦自动保存）"
          className="w-full bg-transparent text-text-muted text-xs outline-none mt-0.5 resize-none overflow-hidden leading-relaxed"
        />
      </div>
      <div className={`flex items-center gap-0.5 transition-opacity shrink-0 mt-1 ${
        !ch.summary.trim() && onGenerate ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
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
        {onOpenDetail && <button type="button" onClick={() => onOpenDetail(ch.id!)} className="rounded px-2 py-1 text-xs text-accent" title="编辑本章细纲">细纲</button>}
        <button title="删除章节" onClick={() => onDelete(ch.id!)} className="p-1 text-text-muted hover:text-error rounded">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

export function OutlineStoryBlockSection({
  block,
  chapters,
  initialTargetNodeId,
  onUpdateNode,
  onDeleteNode,
  onAddChapter,
  onOpenChapter,
  onOpenDetailedOutline,
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
  initialTargetNodeId?: number | null
  onUpdateNode: (id: number, patch: Record<string, string>, options?: { expected?: Record<string, string> }) => void | Promise<void>
  onDeleteNode: (id: number) => void
  onAddChapter: () => void
  onOpenChapter?: (id: number) => void
  onOpenDetailedOutline?: (id: number) => void
  onReorder: (orderedIds: number[]) => void
  onInsertAfter: (chapterId: number) => void
  onGenerateChapter: (chapterId: number) => void
  onMoveChapter: (chapterId: number, targetParentId: number, index: number) => Promise<void>
  activeChapterDrag: ChapterDragPayload | null
  getActiveChapterDrag: GetActiveChapterDrag
  onChapterDragStart: (payload: ChapterDragPayload) => void
  onChapterDragEnd: () => void
}) {
  const toast = useToast()
  const [expanded, setExpanded] = useState(true)
  const containsInitialTarget = block.id === initialTargetNodeId
    || chapters.some(chapter => chapter.id === initialTargetNodeId)
  useEffect(() => {
    if (containsInitialTarget) setExpanded(true)
  }, [containsInitialTarget])
  const blockChaptersDnD = useDragReorder(chapters.map(chapter => chapter.id), onReorder)
  const handleDeleteBlock = async () => {
    if (block.id) onDeleteNode(block.id)
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
    <div
      data-outline-block-id={block.id}
      {...initialRecordTargetAttributes(block.id === initialTargetNodeId, block.id)}
      className={`border border-border rounded-lg overflow-hidden ${
        block.id === initialTargetNodeId ? INITIAL_RECORD_TARGET_CLASS : ''
      }`}
    >
      <div
        onDragOver={event => dropToBlockEnd?.onDragOver(event)}
        onDrop={event => { if (dropToBlockEnd) void dropToBlockEnd.onDrop(event) }}
        className="flex items-center gap-2 px-3 py-2 bg-bg-elevated"
      >
        <button onClick={() => { void flushPendingEditsV1().then(() => setExpanded(!expanded)).catch(cause => toast.error(cause instanceof Error ? cause.message : '故事块草稿未保存。')) }} className="text-text-muted hover:text-text-primary">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <LayoutList className="w-3.5 h-3.5 text-accent/60" />
        <AcknowledgedTextField input label="故事块标题"
          value={block.title}
          onCommit={(value, expected) => onUpdateNode(block.id!, { title: value }, { expected: { title: expected as string } })}
          className="flex-1 bg-transparent text-text-primary text-sm font-medium outline-none"
        />
        <span className="text-[10px] text-text-muted">{chapters.length} 章</span>
        <button onClick={onAddChapter} className="p-1 text-text-muted hover:text-accent rounded" title="添加章节">
          <Plus className="w-3 h-3" />
        </button>
        <button title="删除故事块" onClick={() => { void handleDeleteBlock() }} className="p-1 text-text-muted hover:text-error rounded">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <AcknowledgedTextField input label="故事块摘要"
        value={block.summary}
        onCommit={(value, expected) => onUpdateNode(block.id!, { summary: value }, { expected: { summary: expected as string } })}
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
                targeted={chapter.id === initialTargetNodeId}
                onUpdate={onUpdateNode}
                onDelete={onDeleteNode}
                onOpen={onOpenChapter}
                onOpenDetail={onOpenDetailedOutline}
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
