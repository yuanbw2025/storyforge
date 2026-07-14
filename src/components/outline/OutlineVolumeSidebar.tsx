import { useEffect, useState } from 'react'
import { Check, GripVertical, Layers, Loader2, Plus, Sparkles, X } from 'lucide-react'
import type { ParsedChapter } from '../../lib/ai/parse-outline-output'
import type { BatchOutlineProgress } from '../../lib/ai/batch-outline-runner'
import type { OutlineNode, WorldGroup } from '../../lib/types'
import { useDragReorder } from './useDragReorder'
import {
  chapterDropProps,
  hasChapterDragPayload,
  type ChapterDragPayload,
  type GetActiveChapterDrag,
} from './chapter-drag'

interface OutlineVolumeSidebarProps {
  volumes: OutlineNode[]
  nodes: OutlineNode[]
  selectedVolumeId: number | null
  multiWorldEnabled: boolean
  worldGroups: WorldGroup[]
  aiStreaming: boolean
  batchRunning: boolean
  batchProgress: BatchOutlineProgress | null
  batchResult: Map<number, ParsedChapter[]> | null
  activeChapterDrag: ChapterDragPayload | null
  getActiveChapterDrag: GetActiveChapterDrag
  onClearActiveChapterDrag: () => void
  onSelectVolume: (volumeId: number) => void
  onAddVolume: () => void
  onGenerateVolumes: () => void
  onGenerateAllChapters: () => void
  onCancelBatch: () => void
  onConfirmBatch: () => void
  onDismissBatch: () => void
  onReorderVolumes: (orderedIds: number[]) => void
  onMoveChapter: (chapterId: number, targetParentId: number, index: number) => Promise<void>
}

export default function OutlineVolumeSidebar({
  volumes,
  nodes,
  selectedVolumeId,
  multiWorldEnabled,
  worldGroups,
  aiStreaming,
  batchRunning,
  batchProgress,
  batchResult,
  activeChapterDrag,
  getActiveChapterDrag,
  onClearActiveChapterDrag,
  onSelectVolume,
  onAddVolume,
  onGenerateVolumes,
  onGenerateAllChapters,
  onCancelBatch,
  onConfirmBatch,
  onDismissBatch,
  onReorderVolumes,
  onMoveChapter,
}: OutlineVolumeSidebarProps) {
  const [chapterDropTargetId, setChapterDropTargetId] = useState<number | null>(null)
  const volumeDnD = useDragReorder(volumes.map(volume => volume.id), onReorderVolumes)

  useEffect(() => {
    if (activeChapterDrag == null) setChapterDropTargetId(null)
  }, [activeChapterDrag])

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 space-y-1.5">
        <button
          onClick={onAddVolume}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-bg-elevated text-text-secondary rounded-md hover:text-text-primary border border-border transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> 添加卷
        </button>
        <button
          onClick={onGenerateVolumes}
          disabled={aiStreaming || batchRunning}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" /> 批量生成卷级大纲
        </button>
        {volumes.length >= 2 && (
          <button
            onClick={onGenerateAllChapters}
            disabled={aiStreaming || batchRunning}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-bg-elevated text-accent rounded-md hover:bg-accent/10 border border-accent/30 disabled:opacity-50 transition-colors"
          >
            <Layers className="w-3.5 h-3.5" /> 批量生成所有卷的章节
          </button>
        )}
      </div>

      {(batchRunning || batchResult) && (
        <div className="px-2 pb-2">
          <div className="bg-bg-surface border border-border rounded-lg p-2 space-y-1.5">
            {batchRunning && batchProgress && (
              <>
                <div className="flex items-center gap-1.5 text-xs text-accent">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>{batchProgress.completedVolumes}/{batchProgress.totalVolumes} 卷</span>
                </div>
                <div className="w-full bg-border rounded-full h-1.5">
                  <div
                    className="bg-accent h-1.5 rounded-full transition-all"
                    style={{ width: `${(batchProgress.completedVolumes / batchProgress.totalVolumes) * 100}%` }}
                  />
                </div>
                <p className="text-[10px] text-text-muted truncate">{batchProgress.stage}</p>
                <button
                  onClick={onCancelBatch}
                  className="w-full px-2 py-1 text-[10px] text-error border border-error/30 rounded hover:bg-error/10 transition-colors"
                >
                  取消
                </button>
              </>
            )}
            {!batchRunning && batchResult && (
              <>
                <p className="text-xs text-success">
                  批量生成完成：{Array.from(batchResult.values()).reduce((sum, chapters) => sum + chapters.length, 0)} 章
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={onConfirmBatch}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] bg-accent text-white rounded hover:bg-accent-hover transition-colors"
                  >
                    <Check className="w-3 h-3" /> 全部写入
                  </button>
                  <button
                    onClick={onDismissBatch}
                    title="关闭批量生成结果"
                    className="px-2 py-1 text-[10px] text-text-muted border border-border rounded hover:text-text-primary transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-1">
        {volumes.map(volume => {
          const storyBlockIds = new Set(
            nodes
              .filter(node => node.parentId === volume.id && node.type === 'storyBlock')
              .map(node => node.id),
          )
          const childCount = nodes.filter(node => (
            node.type === 'chapter'
            && (node.parentId === volume.id || storyBlockIds.has(node.parentId ?? undefined))
          )).length
          const active = selectedVolumeId === volume.id
          const dnd = volumeDnD.itemDnD(volume.id)
          const dropToVolume = chapterDropProps({
            targetParentId: volume.id!,
            targetIndex: nodes.filter(node => node.parentId === volume.id && node.type === 'chapter').length,
            onMoveChapter,
            getActiveChapterDrag,
            clearActiveChapterDrag: onClearActiveChapterDrag,
          })
          const isChapterDropTarget = chapterDropTargetId === volume.id && activeChapterDrag != null

          return (
            <div
              key={volume.id}
              {...dnd.dropProps}
              data-outline-volume-id={volume.id}
              data-chapter-drop-target={isChapterDropTarget ? 'true' : undefined}
              onDragEnter={event => {
                dnd.dropProps.onDragEnter()
                if (getActiveChapterDrag() || hasChapterDragPayload(event)) setChapterDropTargetId(volume.id!)
              }}
              onDragLeave={event => {
                dnd.dropProps.onDragLeave()
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setChapterDropTargetId(current => current === volume.id ? null : current)
                }
              }}
              onDragOver={event => {
                if (getActiveChapterDrag() || hasChapterDragPayload(event)) {
                  setChapterDropTargetId(volume.id!)
                  dropToVolume.onDragOver(event)
                  return
                }
                dnd.dropProps.onDragOver(event)
              }}
              onDrop={event => {
                if (getActiveChapterDrag() || hasChapterDragPayload(event)) {
                  void dropToVolume.onDrop(event)
                  return
                }
                dnd.dropProps.onDrop(event)
              }}
              className={`group/vol flex items-center rounded-lg mb-0.5 transition-all ${
                active ? 'bg-accent/8 border-l-2 border-accent' : 'hover:bg-bg-hover border-l-2 border-transparent'
              } ${dnd.isDragging ? 'opacity-40' : ''} ${dnd.isOver || isChapterDropTarget ? 'ring-1 ring-accent/60 bg-accent/10' : ''}`}
            >
              <span
                {...dnd.dragHandleProps}
                title="拖动调整卷顺序"
                className="shrink-0 pl-1 pr-0.5 py-2 cursor-grab active:cursor-grabbing text-text-muted/40 group-hover/vol:text-text-muted"
              >
                <GripVertical className="w-3.5 h-3.5" />
              </span>
              <button
                onClick={() => onSelectVolume(volume.id!)}
                className="min-w-0 flex-1 text-left px-1 py-2"
              >
                <p className={`text-sm font-medium truncate ${active ? 'text-accent' : 'text-text-primary'}`}>
                  {multiWorldEnabled && volume.worldGroupId != null && (
                    <span className="mr-1">{worldGroups.find(group => group.id === volume.worldGroupId)?.icon || '🌐'}</span>
                  )}
                  {volume.title}
                </p>
                <p className="text-[10px] text-text-muted">
                  {childCount} 章{volume.summary ? ` · ${volume.summary.slice(0, 20)}...` : ''}
                </p>
              </button>
            </div>
          )
        })}
        {volumes.length === 0 && (
          <div className="text-center py-8 text-text-muted text-xs">还没有卷</div>
        )}
      </div>
    </div>
  )
}
