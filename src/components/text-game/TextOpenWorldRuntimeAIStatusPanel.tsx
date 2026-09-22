import { Activity, RefreshCcw, ShieldCheck } from 'lucide-react'
import type { TextOpenWorldRuntimeAIObservabilityV1 } from '../../lib/open-world/runtime-ai-observability'

export interface TextOpenWorldRuntimeAIStatusPanelProps {
  configured: boolean
  loading: boolean
  value: TextOpenWorldRuntimeAIObservabilityV1 | null
  onRefresh(): void
}

function stateLabel(state: TextOpenWorldRuntimeAIObservabilityV1['recentRuns'][number]['state']): string {
  if (state === 'completed') return '已完成'
  if (state === 'paused') return '已暂停'
  if (state === 'failed') return '已失败'
  if (state === 'cancelled') return '已取消'
  return '进行中'
}

export default function TextOpenWorldRuntimeAIStatusPanel(
  props: TextOpenWorldRuntimeAIStatusPanelProps,
) {
  return <section className="open-world-runtime-ai-status" data-testid="text-open-world-runtime-ai-status">
    <header>
      <span><Activity aria-hidden="true" /><strong>运行时 AI 与费用</strong></span>
      <button type="button" disabled={props.loading} onClick={props.onRefresh}>
        <RefreshCcw aria-hidden="true" />{props.loading ? '核对中…' : '刷新证据'}
      </button>
    </header>
    <p><ShieldCheck aria-hidden="true" />确定性规则、固定选项和系统操作不依赖模型；每个 AI Run 最多调用模型一次，绝不隐藏重试。</p>
    <dl>
      <div><dt>模型配置</dt><dd>{props.configured ? '可用' : '尚未配置'}</dd></div>
      <div><dt>成功调用</dt><dd>{props.value?.successfulCalls ?? 0} 次</dd></div>
      <div><dt>输入 / 输出</dt><dd>{props.value ? `${props.value.inputTokens} / ${props.value.outputTokens} tokens` : '尚未读取'}</dd></div>
      <div><dt>本项目运行时估算</dt><dd>${(props.value?.estimatedCostUsd ?? 0).toFixed(4)}</dd></div>
    </dl>
    <small>金额来自本机成功响应的 token 用量与 StoryForge 估算目录，不是服务商账单；结果未知的调用可能尚未计入。</small>
    {props.value && <details>
      <summary>单次上限与最近 Run</summary>
      <div className="open-world-runtime-ai-budget-grid">
        {props.value.budgets.map(budget => <article key={budget.skillId}>
          <strong>{budget.label}</strong>
          <span>{budget.maxInputTokens} + {budget.maxOutputTokens} tokens</span>
          <span>{Math.round(budget.maxDurationMs / 1_000)} 秒 · ${budget.maxEstimatedCostUsd.toFixed(2)} 合同估算上界</span>
        </article>)}
      </div>
      <ol>
        {props.value.recentRuns.map(run => <li key={run.runId}>
          <span>{run.label}</span>
          <strong>{stateLabel(run.state)}</strong>
          {run.code && <small>{run.code}{run.retryable ? ' · 可明确重试' : ''}</small>}
        </li>)}
        {!props.value.recentRuns.length && <li>当前存档还没有运行时 AI Run。</li>}
      </ol>
    </details>}
  </section>
}
