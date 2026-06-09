import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { MasterChapterBeat, BeatType } from '../../lib/types/master-study'

interface Props {
  beats: MasterChapterBeat[]
}

const BEAT_META: Record<BeatType, { label: string; color: string; emoji: string }> = {
  opening:     { label: '开场',   color: 'bg-blue-500',    emoji: '🎬' },
  conflict:    { label: '冲突',   color: 'bg-red-500',     emoji: '⚔️' },
  reversal:    { label: '反转',   color: 'bg-purple-500',  emoji: '🔄' },
  climax:      { label: '高潮',   color: 'bg-orange-500',  emoji: '🔥' },
  hook:        { label: '钩子',   color: 'bg-amber-500',   emoji: '🪝' },
  foreshadow:  { label: '伏笔',   color: 'bg-emerald-500', emoji: '🌱' },
  relief:      { label: '松弛',   color: 'bg-cyan-500',    emoji: '☁️' },
}

export default function MasterBeatsTimeline({ beats }: Props) {
  const grouped = useMemo(() => {
    const map = new Map<number, MasterChapterBeat[]>()
    for (const b of beats) {
      const arr = map.get(b.chapterIndex) || []
      arr.push(b)
      map.set(b.chapterIndex, arr)
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([idx, items]) => ({
        chapterIndex: idx,
        label: items[0]?.chapterLabel || `第 ${idx + 1} 章`,
        beats: items.sort((a, b) => a.position - b.position),
      }))
  }, [beats])

  if (beats.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-bg-elevated/30 p-8 text-center">
        <p className="text-sm text-text-muted">暂无节奏分析数据。</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-text-primary">
          章节节奏时间线
        </h3>
        <span className="text-xs text-text-muted">
          {grouped.length} 章 · {beats.length} 个节奏点
        </span>
      </div>

      {/* 类型图例 */}
      <div className="flex flex-wrap gap-2">
        {(Object.entries(BEAT_META) as [BeatType, typeof BEAT_META[BeatType]][]).map(([type, meta]) => (
          <span key={type} className="inline-flex items-center gap-1 text-[11px] text-text-secondary">
            <span className={`w-2 h-2 rounded-full ${meta.color}`} />
            {meta.label}
          </span>
        ))}
      </div>

      {/* 章节列表 */}
      <div className="space-y-1">
        {grouped.map(g => (
          <ChapterRow key={g.chapterIndex} {...g} />
        ))}
      </div>
    </div>
  )
}

function ChapterRow({
  label, beats,
}: {
  chapterIndex: number
  label: string
  beats: MasterChapterBeat[]
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-border/60 bg-bg-base overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-bg-hover transition text-left"
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />}
        <span className="text-xs font-medium text-text-primary flex-1 truncate">{label}</span>

        {/* 节奏条（mini timeline） */}
        <div className="w-32 h-3 bg-bg-elevated rounded-full relative overflow-hidden shrink-0">
          {beats.map((b, i) => {
            const meta = BEAT_META[b.type] || BEAT_META.conflict
            return (
              <div
                key={i}
                className={`absolute top-0 w-2 h-3 rounded-sm ${meta.color}`}
                style={{ left: `${Math.max(0, Math.min(96, b.position))}%` }}
                title={`${meta.label} @ ${b.position}%`}
              />
            )
          })}
        </div>

        <span className="text-[11px] text-text-muted shrink-0">{beats.length} 点</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-1.5">
          {beats.map((b, i) => {
            const meta = BEAT_META[b.type] || BEAT_META.conflict
            return (
              <div
                key={i}
                className="flex items-start gap-2 text-xs"
              >
                <span className="shrink-0 mt-0.5 text-sm" title={meta.label}>{meta.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] text-white ${meta.color}`}>
                      {meta.label}
                    </span>
                    <span className="text-text-muted">@{b.position}%</span>
                  </div>
                  {b.excerpt && (
                    <p className="mt-0.5 text-text-secondary italic line-clamp-2">"{b.excerpt}"</p>
                  )}
                  {b.note && (
                    <p className="mt-0.5 text-text-primary">{b.note}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
