import { useId } from 'react'
import { AlertTriangle, RefreshCcw, ShieldAlert, Sparkles } from 'lucide-react'
import type { TextOpenWorldPlayerIssueV1 } from '../../lib/open-world/player-resilience'

export interface TextOpenWorldPlayerStateNoticeProps {
  issue: TextOpenWorldPlayerIssueV1
  compact?: boolean
  primaryLabel?: string
  onPrimary?(): void
  secondaryLabel?: string
  onSecondary?(): void
}

export default function TextOpenWorldPlayerStateNotice(
  props: TextOpenWorldPlayerStateNoticeProps,
) {
  const titleId = useId()
  const Icon = props.issue.state === 'blocking-error'
    ? ShieldAlert
    : props.issue.state === 'degraded' ? Sparkles : AlertTriangle
  return <section
    className={`open-world-player-state-notice${props.compact ? ' is-compact' : ''}`}
    data-testid="text-open-world-player-state-notice"
    data-player-state={props.issue.state}
    data-diagnostic-code={props.issue.code}
    role={props.issue.state === 'degraded' ? 'status' : 'alert'}
    aria-labelledby={titleId}
  >
    <Icon aria-hidden="true" />
    <div>
      <strong id={titleId}>{props.issue.title}</strong>
      <p>{props.issue.message}</p>
      <small>{props.issue.guidance} · 诊断码 {props.issue.code}</small>
      {(props.onPrimary || props.onSecondary) && <span className="open-world-player-state-actions">
        {props.onPrimary && <button type="button" onClick={props.onPrimary}>
          <RefreshCcw aria-hidden="true" />{props.primaryLabel ?? '重新核对'}
        </button>}
        {props.onSecondary && <button type="button" onClick={props.onSecondary}>
          {props.secondaryLabel ?? '返回游戏库'}
        </button>}
      </span>}
    </div>
  </section>
}
