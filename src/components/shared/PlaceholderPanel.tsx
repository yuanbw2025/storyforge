import { Construction } from 'lucide-react'

interface Props {
  title: string
  /** 计划在哪个 Phase 实施 */
  phase?: string
  /** 一句话描述这个面板将做什么 */
  description?: string
}

/**
 * 通用占位面板。
 * Phase 4 把侧边栏先骨架搭起来，等 Phase 5+ 填实内容。
 */
export default function PlaceholderPanel({ title, phase, description }: Props) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-bg-elevated border border-border mb-4">
          <Construction className="w-7 h-7 text-text-muted" />
        </div>
        <h2 className="text-xl font-semibold text-text-primary mb-2">{title}</h2>
        {description && (
          <p className="text-sm text-text-secondary mb-3 leading-relaxed">
            {description}
          </p>
        )}
        {phase && (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            {phase}
          </div>
        )}
      </div>
    </div>
  )
}
