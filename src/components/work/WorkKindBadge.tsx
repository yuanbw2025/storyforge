import type { Work } from '../../lib/types'
import { effectiveNovelProfile, effectiveWorkKind } from '../../lib/workspace/work-kind'

export function workKindLabel(work: Pick<Work, 'kind' | 'novelProfile'>): string {
  const kind = effectiveWorkKind(work)
  if (kind === 'screenplay') return '剧本'
  if (kind === 'comic') return '漫画'
  return effectiveNovelProfile(work) === 'short' ? '小说 · 短篇' : '小说 · 长篇'
}

export default function WorkKindBadge({ work }: { work: Pick<Work, 'kind' | 'novelProfile'> }) {
  return (
    <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
      {workKindLabel(work)}
    </span>
  )
}
