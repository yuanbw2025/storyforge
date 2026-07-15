import { useEffect, useState } from 'react'
import { Library, Upload } from 'lucide-react'
import { useReferenceStore } from '../../stores/reference'
import type { Project, Reference, ReferenceType } from '../../lib/types'
import { useDialog } from '../shared/Dialog'
import ReferenceDetailCard from './ReferenceDetailCard'
import {
  REFERENCE_GLYPH_COLORS,
  REFERENCE_TYPE_CONFIG,
} from './reference-view'

// ── 常量 ─────────────────────────────────────────────────────────

interface Props { project: Project }

// ── 主面板 ─────────────────────────────────────────────────────────

export default function ReferencePanel({ project }: Props) {
  const dialog = useDialog()
  const { references, loadAll, updateReference, deleteReference } = useReferenceStore()
  const [filter, setFilter] = useState<ReferenceType | 'all'>('all')
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const displayed = filter === 'all'
    ? references
    : references.filter(r => r.type === filter)

  const storyCount = references.filter(r => r.type === 'story').length
  const styleCount = references.filter(r => r.type === 'style').length
  const importedCount = references.filter(r => r.importedData).length

  const selectedRef = references.find(r => r.id === selected)

  const handleDelete = async (ref: Reference) => {
    const ok = await dialog.confirm({
      title: `删除「${ref.title}」？`,
      message: '此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    await deleteReference(ref.id!)
    if (selected === ref.id) setSelected(null)
  }

  return (
    <div className="flex gap-4">
      {/* 左侧列表 */}
      <div className="w-52 shrink-0 space-y-2">
        {/* 导入提示 */}
        <div className="bg-bg-elevated rounded-lg p-2.5 text-xs text-text-muted">
          <Upload className="w-3.5 h-3.5 inline mr-1 text-accent" />
          通过侧边栏「导入」上传文档，解析后选择「导入项目参考」即可自动添加到此处。
        </div>

        {/* 筛选 tabs */}
        <div className="flex gap-1 bg-bg-elevated rounded-lg p-1">
          {([['all', '全部', references.length], ['story', '故事', storyCount], ['style', '风格', styleCount], ['historical', '历史', references.filter(r => r.type === 'historical').length]] as const).map(
            ([v, l, c]) => (
              <button
                key={v}
                onClick={() => setFilter(v)}
                className={`flex-1 text-xs py-1 rounded px-1 transition-colors ${filter === v ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary'}`}
              >
                {l} {c > 0 && <span className="opacity-70">({c})</span>}
              </button>
            )
          )}
        </div>

        {importedCount > 0 && (
          <div className="text-[10px] text-text-muted px-1">
            其中 {importedCount} 条来自导入解析
          </div>
        )}

        {/* 列表 */}
        <div className="space-y-0.5 max-h-[calc(100vh-320px)] overflow-y-auto">
          {displayed.length === 0 && (
            <div className="text-center text-text-muted text-sm py-8">
              <Library className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>暂无项目参考</p>
            </div>
          )}
          {displayed.map((ref, i) => {
            const cfg = REFERENCE_TYPE_CONFIG[ref.type]
            const active = selected === ref.id
            const hasImported = !!ref.importedData
            const colorClass = REFERENCE_GLYPH_COLORS[i % REFERENCE_GLYPH_COLORS.length]
            return (
              <button
                key={ref.id}
                onClick={() => setSelected(active ? null : ref.id!)}
                className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-all ${
                  active
                    ? 'bg-accent/8 border-l-2 border-accent'
                    : 'hover:bg-bg-hover border-l-2 border-transparent'
                }`}
              >
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${colorClass}`}>
                  {ref.title.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium truncate ${active ? 'text-accent' : 'text-text-primary'}`}>{ref.title}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className={`text-[10px] px-1 py-0.5 rounded border ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    {hasImported && (
                      <span className="text-[10px] px-1 py-0.5 rounded border border-blue-400/30 text-blue-400 bg-blue-400/10">
                        已导入
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* 右侧详情 */}
      <div className="flex-1 min-w-0">
        {selectedRef ? (
          <ReferenceDetailCard
            reference={selectedRef}
            referenceIndex={references.findIndex(r => r.id === selectedRef.id)}
            onUpdate={(data) => {
              if (selectedRef?.id) {
                updateReference(selectedRef.id, data)
              }
            }}
            onDelete={() => handleDelete(selectedRef)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-text-muted text-sm gap-3">
            <Library className="w-12 h-12 opacity-20" />
            <p>← 从左侧选择一条项目参考查看详情</p>
            <div className="text-xs text-text-muted/60 text-center max-w-xs space-y-0.5">
              <p>· <span className="text-accent">故事参考</span>：借鉴情节结构、世界观框架</p>
              <p>· <span className="text-purple-400">风格参考</span>：借鉴文风、叙事节奏</p>
              <p>· <span className="text-amber-500">历史资料</span>：考证历史背景、社会制度、日常生活细节</p>
              <p>· <span className="text-blue-400">导入参考</span>：通过「导入」解析文档自动填充</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
