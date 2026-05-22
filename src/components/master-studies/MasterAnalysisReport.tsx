import { useMemo, useState } from 'react'
import {
  Globe, Users, Activity, Eye, Feather, FileText,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import type { MasterChunkAnalysis } from '../../lib/types/master-study'

interface Props {
  analyses: MasterChunkAnalysis[]
}

/** 五维维度元数据 */
const DIMENSIONS: Array<{
  key: keyof MasterChunkAnalysis
  label: string
  icon: React.ComponentType<{ className?: string }>
  desc: string
  color: string
}> = [
  { key: 'worldviewPattern', label: '世界观范式',    icon: Globe,    desc: '设定的独特逻辑、体系的构建手法', color: 'text-blue-500 bg-blue-500/10' },
  { key: 'characterDesign',  label: '角色设计手法',  icon: Users,    desc: '人物塑造、弧光、对比、成长机制', color: 'text-purple-500 bg-purple-500/10' },
  { key: 'plotRhythm',       label: '情节节奏规律',  icon: Activity, desc: '冲突推进、爽点密度、节奏张弛',   color: 'text-orange-500 bg-orange-500/10' },
  { key: 'foreshadowing',    label: '伏笔与悬念',    icon: Eye,      desc: '埋设、回收、钩子、期待感构建',   color: 'text-emerald-500 bg-emerald-500/10' },
  { key: 'proseStyle',       label: '文笔与语言',    icon: Feather,  desc: '句式、意象、语感、独特表达',     color: 'text-pink-500 bg-pink-500/10' },
]

/**
 * 五维分析报告展示（Phase 19-b）
 *
 * 两个视图：
 *  · 维度视图（默认）：按 5 个维度横切，每维合并所有块的结论
 *  · 分块视图：按块纵切，看每块的完整五维输出 + 原文片段
 */
export default function MasterAnalysisReport({ analyses }: Props) {
  const [view, setView] = useState<'dimension' | 'chunk'>('dimension')

  const sorted = useMemo(
    () => [...analyses].sort((a, b) => a.chunkIndex - b.chunkIndex),
    [analyses],
  )

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-bg-elevated/30 p-10 text-center">
        <p className="text-sm text-text-muted">暂无分析数据。</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 视图切换 */}
      <div className="flex items-center gap-1 border-b border-border">
        <ViewTab active={view === 'dimension'} onClick={() => setView('dimension')} label="按维度看" />
        <ViewTab active={view === 'chunk'}     onClick={() => setView('chunk')}     label="按分块看" />
        <span className="ml-auto text-xs text-text-muted pb-2">共 {sorted.length} 块分析</span>
      </div>

      {view === 'dimension'
        ? <DimensionView analyses={sorted} />
        : <ChunkView analyses={sorted} />}
    </div>
  )
}

function ViewTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
        active
          ? 'border-accent text-accent'
          : 'border-transparent text-text-muted hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  )
}

// ── 维度视图 ─────────────────────────────────────────────────

function DimensionView({ analyses }: { analyses: MasterChunkAnalysis[] }) {
  return (
    <div className="space-y-3">
      {DIMENSIONS.map(d => (
        <DimensionCard key={d.key} dim={d} analyses={analyses} />
      ))}
    </div>
  )
}

function DimensionCard({
  dim, analyses,
}: {
  dim: typeof DIMENSIONS[number]
  analyses: MasterChunkAnalysis[]
}) {
  const [expanded, setExpanded] = useState(true)

  // 收集所有块中该维度的结论（去重 + 限 12 条）
  const items = useMemo(() => {
    const result: Array<{ text: string; chunkIndex: number; label?: string }> = []
    for (const a of analyses) {
      const raw = a[dim.key] as string | undefined
      const text = typeof raw === 'string' ? raw.trim() : ''
      if (!text) continue
      // 粗略去重：前 40 字相同算同一条
      if (result.some(r => r.text.slice(0, 40) === text.slice(0, 40))) continue
      result.push({ text, chunkIndex: a.chunkIndex, label: a.label })
      if (result.length >= 12) break
    }
    return result
  }, [analyses, dim.key])

  const Icon = dim.icon

  return (
    <div className="rounded-xl border border-border bg-bg-surface overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition text-left"
      >
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${dim.color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-text-primary">{dim.label}</h4>
          <p className="text-[11px] text-text-muted truncate">{dim.desc}</p>
        </div>
        <span className="text-xs text-text-muted shrink-0">{items.length} 条</span>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-2">
          {items.length === 0 ? (
            <p className="text-xs text-text-muted italic">（本作品未在此维度获得显著结论）</p>
          ) : (
            items.map((it, i) => (
              <div
                key={i}
                className="rounded-lg border border-border/60 bg-bg-base px-3 py-2"
              >
                <div className="flex items-center gap-1.5 text-[10px] text-text-muted mb-1">
                  <span className="px-1.5 py-0.5 rounded bg-bg-elevated">
                    块 {it.chunkIndex + 1}{it.label ? ` · ${it.label}` : ''}
                  </span>
                </div>
                <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{it.text}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── 分块视图 ─────────────────────────────────────────────────

function ChunkView({ analyses }: { analyses: MasterChunkAnalysis[] }) {
  return (
    <div className="space-y-3">
      {analyses.map(a => (
        <ChunkCard key={a.id ?? a.chunkIndex} row={a} />
      ))}
    </div>
  )
}

function ChunkCard({ row }: { row: MasterChunkAnalysis }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-xl border border-border bg-bg-surface overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition text-left"
      >
        <FileText className="w-4 h-4 text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-text-primary">
            块 {row.chunkIndex + 1}{row.label ? ` · ${row.label}` : ''}
          </h4>
          {row.rawExcerpt && (
            <p className="text-[11px] text-text-muted truncate">
              {row.rawExcerpt.slice(0, 80)}…
            </p>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {row.rawExcerpt && (
            <blockquote className="border-l-2 border-accent/40 pl-3 text-xs text-text-secondary italic leading-relaxed whitespace-pre-wrap">
              {row.rawExcerpt}
            </blockquote>
          )}
          <div className="space-y-2">
            {DIMENSIONS.map(d => {
              const text = (row[d.key] as string | undefined)?.trim()
              if (!text) return null
              const Icon = d.icon
              return (
                <div key={d.key} className="rounded-lg border border-border/60 bg-bg-base px-3 py-2">
                  <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] mb-1 ${d.color}`}>
                    <Icon className="w-3 h-3" />
                    {d.label}
                  </div>
                  <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{text}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
