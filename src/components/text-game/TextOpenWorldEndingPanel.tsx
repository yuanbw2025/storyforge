import { BookOpen, CheckCircle2, Clock3, Save, Sparkles } from 'lucide-react'
import { useId } from 'react'
import type { TextOpenWorldPlayerEndingProjectionV1 } from '../../lib/open-world/player-ending'

export interface TextOpenWorldEndingPanelProps {
  projection: TextOpenWorldPlayerEndingProjectionV1
}

export default function TextOpenWorldEndingPanel({ projection }: TextOpenWorldEndingPanelProps) {
  const headingId = useId()
  const summaryId = useId()

  if (projection.phase === 'in-progress') {
    return <article
      aria-labelledby={headingId}
      className="rounded border border-border bg-bg-surface p-5"
      data-ending-phase="in-progress"
      data-testid="text-open-world-ending-panel"
    >
      <div className="flex items-start gap-3">
        <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-muted">旅程状态</p>
          <h2 id={headingId} className="mt-1 text-lg font-semibold">旅程仍在继续</h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">当前时间线尚未抵达结局，继续探索和推进任务即可。</p>
        </div>
      </div>
    </article>
  }

  const isCompleted = projection.phase === 'completed'
  return <article
    aria-describedby={summaryId}
    aria-labelledby={headingId}
    className="overflow-hidden rounded border border-accent/30 bg-bg-surface shadow-sm"
    data-ending-phase={projection.phase}
    data-testid="text-open-world-ending-panel"
  >
    <header className="border-b border-border bg-gradient-to-br from-accent/15 via-bg-surface to-bg-surface px-5 py-6 sm:px-7">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-1 h-6 w-6 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            {isCompleted ? '旅程完成' : '结局正在收束'}
          </p>
          <h2 id={headingId} className="mt-1 text-2xl font-semibold text-text-primary">
            {projection.ending.title}
          </h2>
          <p id={summaryId} className="mt-3 max-w-3xl text-sm leading-7 text-text-muted">
            {projection.ending.summary}
          </p>
        </div>
      </div>
      <p
        className="mt-5 flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
        role="status"
        aria-live={isCompleted ? undefined : 'polite'}
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        {isCompleted ? '时间线已保存' : '结局已写入时间线并保存，正在完成最终收束'}
      </p>
    </header>

    <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)]">
      <section aria-labelledby={`${headingId}-statistics`}>
        <h3 id={`${headingId}-statistics`} className="flex items-center gap-2 text-sm font-semibold">
          <BookOpen className="h-4 w-4 text-accent" aria-hidden="true" />
          完成统计
        </h3>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded bg-bg-base px-3 py-3">
            <dt className="text-[11px] text-text-muted">等级</dt>
            <dd className="mt-1 text-lg font-semibold">{projection.statistics.level}</dd>
          </div>
          <div className="rounded bg-bg-base px-3 py-3">
            <dt className="text-[11px] text-text-muted">完成任务</dt>
            <dd className="mt-1 text-lg font-semibold">{projection.statistics.completedQuestCount}</dd>
          </div>
          <div className="rounded bg-bg-base px-3 py-3">
            <dt className="text-[11px] text-text-muted">已获成就</dt>
            <dd className="mt-1 text-lg font-semibold">{projection.statistics.earnedAchievementCount}</dd>
          </div>
          <div className="rounded bg-bg-base px-3 py-3">
            <dt className="text-[11px] text-text-muted">世界时间</dt>
            <dd className="mt-1 text-sm font-semibold">{projection.statistics.worldTimeLabel}</dd>
          </div>
        </dl>
      </section>

      <aside aria-label="结局后的可用内容" className="rounded border border-border bg-bg-base/70 p-4 text-xs leading-6 text-text-muted">
        <div className="flex items-start gap-2">
          <Save className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <p className="font-semibold text-text-primary">这条时间线仍可回顾</p>
            <p className="mt-1">任务日志、角色、世界记录和存档仍可阅读。</p>
            <p className="mt-2">载入终局前的存档，可以从那条时间线走向其他结局。</p>
          </div>
        </div>
      </aside>
    </div>
  </article>
}
