import { AlertTriangle, RefreshCcw } from 'lucide-react'
import type { TextOpenWorldRuntimeAIFailureV1 } from '../../lib/open-world/runtime-ai-error'

export interface TextOpenWorldRuntimeAIFailureNoticeProps {
  failure: TextOpenWorldRuntimeAIFailureV1
  busy?: boolean
  retryLabel?: string
  onRetry?(): void
}

export default function TextOpenWorldRuntimeAIFailureNotice(
  props: TextOpenWorldRuntimeAIFailureNoticeProps,
) {
  return <aside
    className="open-world-runtime-ai-failure"
    role="status"
    data-testid="text-open-world-runtime-ai-failure"
    data-failure-kind={props.failure.kind}
  >
    <header><AlertTriangle aria-hidden="true" /><strong>{props.failure.message}</strong></header>
    <p>{props.failure.recovery}</p>
    {props.failure.possibleCharge && <small>
      这次请求可能已经产生模型费用；费用记录以服务商账单为准。
    </small>}
    {props.failure.unknownResult && <small>
      结果状态未知，StoryForge不会把“没有显示候选”当作“没有调用”，也不会暗中重发。
    </small>}
    {props.failure.retryable && props.onRetry && <button
      type="button"
      disabled={props.busy}
      onClick={props.onRetry}
    >
      <RefreshCcw aria-hidden="true" />{props.busy ? '正在重试…' : props.retryLabel ?? '明确重试一次'}
    </button>}
  </aside>
}
