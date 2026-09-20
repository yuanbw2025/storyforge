import { Sparkles } from 'lucide-react'
import type { TextOpenWorldFeedbackReceiptV1 } from '../../lib/types'
import type { TextOpenWorldRuntimeExpressionPresentationV1 } from '../../lib/open-world/runtime-expression'
import type { TextOpenWorldRuntimeAIFailureV1 } from '../../lib/open-world/runtime-ai-error'
import TextOpenWorldRuntimeAIFailureNotice from './TextOpenWorldRuntimeAIFailureNotice'

const KIND_LABELS: Record<TextOpenWorldRuntimeExpressionPresentationV1['kind'], string> = {
  scene: '场景结果',
  combat: '战斗结果',
  quest: '任务结果',
  system: '系统结果',
}

export interface TextOpenWorldResultExpressionPanelProps {
  feedback: TextOpenWorldFeedbackReceiptV1 | null
  presentation: TextOpenWorldRuntimeExpressionPresentationV1 | null
  busy: boolean
  /** String is accepted only for restored/legacy callers and is never rendered verbatim. */
  issue: TextOpenWorldRuntimeAIFailureV1 | string | null
  onGenerate(): void
}

export default function TextOpenWorldResultExpressionPanel(
  props: TextOpenWorldResultExpressionPanelProps,
) {
  const terminal = props.feedback?.phase === 'terminal'
    && props.feedback.outcomeCommitted
    && props.feedback.commandId
    ? props.feedback
    : null
  if (!terminal) return null
  const presentation = props.presentation?.receiptHash === terminal.receiptHash
    && props.presentation.commandId === terminal.commandId
    ? props.presentation
    : null
  const governedFailure = props.issue && typeof props.issue !== 'string' ? props.issue : null
  return <section
    className="open-world-runtime-expression"
    data-testid="text-open-world-runtime-expression"
    data-expression-state={props.busy ? 'generating' : presentation ? 'generated' : props.issue ? 'fallback' : 'ready'}
    aria-busy={props.busy || undefined}
  >
    <header>
      <span><Sparkles aria-hidden="true" /><strong>AI结果演绎</strong></span>
      <small>系统回执是唯一正式结果</small>
    </header>
    {presentation ? <>
      <div className="open-world-runtime-expression-copy">
        <small>{KIND_LABELS[presentation.kind]} · AI只读候选</small>
        <p>{presentation.text}</p>
      </div>
      <small className="open-world-runtime-expression-evidence">
        仅依据正式事件 {presentation.evidenceEventSequences.map(sequence => `#${sequence}`).join('、')} · 不写游戏状态
      </small>
    </> : <>
      <p>“{terminal.presentation.headline}”已经由确定性规则结算。你可以让AI只依据这份回执补充现场感。</p>
      {governedFailure ? <TextOpenWorldRuntimeAIFailureNotice
        failure={governedFailure}
        busy={props.busy}
        retryLabel="明确重试AI演绎"
        onRetry={props.onGenerate}
      /> : props.issue ? <>
        <p role="status" className="open-world-runtime-expression-issue">
          AI演绎当前不可用；上方系统结算与游戏状态不受影响。
        </p>
        <button type="button" disabled={props.busy} onClick={props.onGenerate}>
          <Sparkles aria-hidden="true" />重新尝试AI演绎
        </button>
      </> : <button type="button" disabled={props.busy} onClick={props.onGenerate}>
          <Sparkles aria-hidden="true" />
          {props.busy ? '正在核对回执并演绎…' : 'AI演绎本次结果'}
        </button>}
    </>}
  </section>
}
