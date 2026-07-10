/**
 * 章节管理面板 — 合并原"章节列表"+"细纲"+"正文"为一体
 *
 * 左侧栏：按卷分组的章节列表（从 outlineNodes 读取）
 * 右侧编辑区：场景细纲 + 正文编辑器
 */
import { useState, useEffect, useMemo } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useOutlineStore } from '../../stores/outline'
import { useChapterStore } from '../../stores/chapter'
import PanelLayout from '../shared/PanelLayout'
import ScenePanel from '../outline/ScenePanel'
import ChapterEditor from './ChapterEditor'
import { buildBestChapterByOutlineMap } from '../../lib/chapters/selectors'
import type { Project, ChapterStatus } from '../../lib/types'

interface Props {
  project: Project
  /** 外部指定要打开的 outlineNodeId（从大纲跳转过来） */
  initialNodeId?: number | null
}

const STATUS_LABELS: Record<ChapterStatus, string> = {
  outline:  '仅大纲',
  draft:    '初稿',
  revised:  '已修改',
  polished: '已润色',
  final:    '定稿',
}

const STATUS_DOT: Record<ChapterStatus, string> = {
  outline:  'bg-text-muted/40',
  draft:    'bg-warning',
  revised:  'bg-info',
  polished: 'bg-accent',
  final:    'bg-success',
}

export default function ChaptersListPanel({ project, initialNodeId }: Props) {
  const { nodes, loadAll: loadOutline } = useOutlineStore()
  const { chapters, loadAll: loadChapters } = useChapterStore()
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(initialNodeId ?? null)
  const [expandedVols, setExpandedVols] = useState<Set<number>>(new Set())

  useEffect(() => {
    loadOutline(project.id!)
    loadChapters(project.id!)
  }, [project.id, loadOutline, loadChapters])

  // 外部传入的 initialNodeId 变化时同步
  useEffect(() => {
    if (initialNodeId != null) setSelectedNodeId(initialNodeId)
  }, [initialNodeId])

  // 按卷分组的章节列表（从 outlineNodes 读取）
  const volumeGroups = useMemo(() => {
    const volumes = nodes.filter(n => n.type === 'volume' && n.parentId === null).sort((a, b) => a.order - b.order)
    return volumes.map(vol => ({
      volume: vol,
      chapters: nodes
        .filter(n => n.parentId === vol.id && n.type === 'chapter')
        .sort((a, b) => a.order - b.order),
    }))
  }, [nodes])
  const chapterByOutline = useMemo(() => buildBestChapterByOutlineMap(chapters), [chapters])

  // 自动展开包含选中章节的卷
  useEffect(() => {
    if (selectedNodeId == null) return
    for (const grp of volumeGroups) {
      if (grp.chapters.some(c => c.id === selectedNodeId)) {
        setExpandedVols(prev => new Set([...prev, grp.volume.id!]))
        break
      }
    }
  }, [selectedNodeId, volumeGroups])

  // 自动选中第一个章节
  useEffect(() => {
    if (selectedNodeId != null) return
    for (const grp of volumeGroups) {
      if (grp.chapters.length > 0) {
        setSelectedNodeId(grp.chapters[0].id!)
        return
      }
    }
  }, [volumeGroups, selectedNodeId])

  const toggleVol = (volId: number) => {
    setExpandedVols(prev => {
      const s = new Set(prev)
      s.has(volId) ? s.delete(volId) : s.add(volId)
      return s
    })
  }

  // 选中章节的信息
  const selectedNode = nodes.find(n => n.id === selectedNodeId)
  const totalChapters = volumeGroups.reduce((sum, g) => sum + g.chapters.length, 0)
  const totalWords = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0)

  // ── 侧栏 ──

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* 统计 */}
      <div className="px-3 py-2 text-[10px] text-text-muted border-b border-border">
        共 {totalChapters} 章 · {totalWords.toLocaleString()} 字
      </div>

      {/* 按卷分组的章节列表 */}
      <div className="flex-1 overflow-y-auto">
        {volumeGroups.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-xs px-3">
            还没有章节。先在「大纲」里生成卷和章节。
          </div>
        ) : (
          volumeGroups.map(grp => {
            const volExpanded = expandedVols.has(grp.volume.id!)
            return (
              <div key={grp.volume.id}>
                {/* 卷标题 */}
                <button
                  onClick={() => toggleVol(grp.volume.id!)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-xs font-medium text-text-secondary hover:bg-bg-hover border-b border-border/50"
                >
                  {volExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  <span className="truncate flex-1">{grp.volume.title}</span>
                  <span className="text-text-muted">{grp.chapters.length}</span>
                </button>

                {/* 章节列表 */}
                {volExpanded && grp.chapters.map((ch, idx) => {
                  const active = selectedNodeId === ch.id
                  const chRec = ch.id != null ? chapterByOutline.get(ch.id) : undefined
                  const status = chRec?.status || 'outline'
                  const wc = chRec?.wordCount || 0
                  return (
                    <button
                      key={ch.id}
                      onClick={() => setSelectedNodeId(ch.id!)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all ${
                        active
                          ? 'bg-accent/10 border-l-2 border-accent'
                          : 'hover:bg-bg-hover border-l-2 border-transparent'
                      }`}
                    >
                      <span className="text-[10px] text-text-muted w-4 shrink-0 text-right">{idx + 1}</span>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[status]}`}
                        title={STATUS_LABELS[status]} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs truncate ${active ? 'text-accent font-medium' : 'text-text-primary'}`}>
                          {ch.title}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {wc > 0 && (
                            <span className="text-[9px] text-text-muted">{wc.toLocaleString()} 字</span>
                          )}
                          {chRec?.summary && (
                            <span className="text-[9px] text-accent/60" title={chRec.summary}>📝</span>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })
        )}
      </div>
    </div>
  )

  // ── 右侧编辑区 ──

  return (
    <PanelLayout
      sidebar={sidebarContent}
      sidebarTitle="📖 章节"
      defaultWidth={200}
      minWidth={150}
      maxWidth={320}
      className="h-[calc(100vh-8rem)]"
    >
      {selectedNode ? (
        <div className="h-full flex flex-col">
          {/* 场景细纲（可折叠） */}
          <div className="px-4 pt-4 pb-2">
            <ScenePanel
              projectId={project.id!}
              outlineNodeId={selectedNode.id!}
              chapterTitle={selectedNode.title}
              chapterSummary={selectedNode.summary}
            />
          </div>

          {/* 正文编辑器 — key 按章节隔离：切章强制重挂载，AI 生成态/草稿不跨章串台（bug G5） */}
          <div className="flex-1 min-h-0">
            <ChapterEditor key={selectedNode.id} project={project} outlineNodeId={selectedNode.id!} />
          </div>
        </div>
      ) : (
        <div className="h-full flex flex-col items-center justify-center text-text-muted gap-3">
          <div className="text-4xl opacity-20">📝</div>
          <p className="text-sm">
            {totalChapters > 0
              ? '从左侧选择一个章节开始写作'
              : '先在「大纲」里生成章节，然后回来写作'}
          </p>
        </div>
      )}
    </PanelLayout>
  )
}
