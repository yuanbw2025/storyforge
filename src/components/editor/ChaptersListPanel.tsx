import { useEffect } from 'react'
import { FilePen, Trash2 } from 'lucide-react'
import { useChapterStore } from '../../stores/chapter'
import { useOutlineStore } from '../../stores/outline'
import type { Project, ChapterStatus } from '../../lib/types'

interface Props {
  project: Project
  onOpenChapter: (outlineNodeId: number) => void
}

const STATUS_LABELS: Record<ChapterStatus, string> = {
  outline:  '仅大纲',
  draft:    '初稿',
  revised:  '已修改',
  polished: '已润色',
  final:    '定稿',
}

const STATUS_COLORS: Record<ChapterStatus, string> = {
  outline:  'bg-text-muted/15 text-text-muted',
  draft:    'bg-warning/15 text-warning',
  revised:  'bg-info/15 text-info',
  polished: 'bg-accent/15 text-accent',
  final:    'bg-success/15 text-success',
}

/** v3 §2.1 — 创作区.章节（独立的章节列表管理） */
export default function ChaptersListPanel({ project, onOpenChapter }: Props) {
  const { chapters, loadAll: loadChapters, deleteChapter } = useChapterStore()
  const { nodes, loadAll: loadOutline } = useOutlineStore()

  useEffect(() => {
    loadChapters(project.id!)
    loadOutline(project.id!)
  }, [project.id, loadChapters, loadOutline])

  // 把章节按所属 volume 分组（通过 outlineNode.parentId 找上层 volume）
  const grouped = groupChaptersByVolume(chapters, nodes)

  const totalWords = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0)

  return (
    <div className="max-w-5xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-text-primary mb-1">📖 章节列表</h2>
          <p className="text-sm text-text-muted">
            共 {chapters.length} 章 · 累计 {totalWords.toLocaleString()} 字
          </p>
        </div>
        <div className="text-xs text-text-muted">
          新章节请在「大纲」面板里添加（章节由大纲节点驱动）。
        </div>
      </div>

      {chapters.length === 0 ? (
        <div className="text-center py-16 text-text-muted text-sm">
          <FilePen className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p>还没有章节。先在「大纲」里建几个章节节点。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(grp => (
            <div key={grp.volumeId} className="bg-bg-surface border border-border rounded-xl">
              {/* 卷头 */}
              {grp.volumeTitle && (
                <div className="px-4 py-2 border-b border-border">
                  <h3 className="text-sm font-semibold text-text-primary">📚 {grp.volumeTitle}</h3>
                </div>
              )}
              {/* 章节行 */}
              <div className="divide-y divide-border/50">
                {grp.chapters.map(c => {
                  const status = c.status || 'outline'
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 p-3 hover:bg-bg-hover transition-colors"
                    >
                      <button
                        onClick={() => onOpenChapter(c.outlineNodeId)}
                        className="flex-1 flex items-center gap-3 text-left"
                      >
                        <span className="text-text-muted text-xs w-10 flex-shrink-0">#{c.order ?? '-'}</span>
                        <span className="flex-1 text-sm text-text-primary truncate font-medium">
                          {c.title || '未命名章节'}
                        </span>
                        <span className={`px-2 py-0.5 text-[10px] rounded ${STATUS_COLORS[status]}`}>
                          {STATUS_LABELS[status]}
                        </span>
                        <span className="text-xs text-text-secondary w-16 text-right flex-shrink-0">
                          {(c.wordCount || 0).toLocaleString()} 字
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`删除章节「${c.title || '未命名'}」？`)) deleteChapter(c.id!)
                        }}
                        className="p-1 text-text-muted hover:text-error"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface VolumeGroup {
  volumeId: number | string
  volumeTitle: string
  chapters: ReturnType<typeof useChapterStore.getState>['chapters']
}

function groupChaptersByVolume(
  chapters: ReturnType<typeof useChapterStore.getState>['chapters'],
  nodes: ReturnType<typeof useOutlineStore.getState>['nodes'],
): VolumeGroup[] {
  const nodeById = new Map(nodes.map(n => [n.id!, n]))
  const groups = new Map<number | string, VolumeGroup>()

  for (const ch of chapters) {
    const chapterNode = nodeById.get(ch.outlineNodeId)
    // 向上找 volume 节点
    let volumeNode = chapterNode
    while (volumeNode && volumeNode.type !== 'volume') {
      volumeNode = volumeNode.parentId ? nodeById.get(volumeNode.parentId) : undefined
    }
    const key = volumeNode?.id ?? '__no_volume'
    if (!groups.has(key)) {
      groups.set(key, {
        volumeId: key,
        volumeTitle: volumeNode?.title || '',
        chapters: [],
      })
    }
    groups.get(key)!.chapters.push(ch)
  }

  // 按章节 order 排序
  for (const grp of groups.values()) {
    grp.chapters.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }
  return [...groups.values()]
}
