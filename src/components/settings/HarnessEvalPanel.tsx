import { useEffect, useMemo, useState } from 'react'
import { Download, LoaderCircle, Play, RotateCcw, ShieldCheck } from 'lucide-react'
import { chat, type ChatResult } from '../../lib/ai/client'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
import { estimateTokens } from '../../lib/ai/context-budget'
import { computeCostUsd } from '../../lib/ai/usage-log'
import {
  evaluateContextCompressionNonInferiorityV1,
  H17_CONTEXT_COMPRESSION_RESULTS_STORAGE_KEY,
  runContextCompressionEvalMatrixV1,
  verifyContextCompressionEvalRecordV1,
} from '../../lib/evals/context-compression/runner'
import type { ContextCompressionEvalRecordV1 } from '../../lib/evals/context-compression/types'
import {
  clearH4LongConsistencyBrowserCheckpointV1,
  exportH4LongConsistencyRunCheckpointV1,
  H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
  loadH4LongConsistencyBrowserStateV1,
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V1,
  persistH4LongConsistencyBrowserCheckpointV1,
  runH4LongConsistencyVerifierV1,
  scoreH4LongConsistencyCheckpointV1,
  type H4LongConsistencyRunCheckpointV1,
  type H4LongConsistencySealedScoreV1,
  type H4LongConsistencyVerifierCallInputV1,
} from '../../lib/evals/long-consistency'
import { getFixtures } from '../../lib/evals/long-consistency/fixtures'
import type { EvalSplit } from '../../lib/evals/long-consistency/types'
import type { AIConfig, ChatMessage } from '../../lib/types'
import { APP_BUILD_ID } from '../../lib/version'
import { useAIConfigStore } from '../../stores/ai-config'
import { useDialog } from '../shared/Dialog'

interface SplitViewState {
  checkpoint: H4LongConsistencyRunCheckpointV1 | null
  score: H4LongConsistencySealedScoreV1 | null
}

const EMPTY_SPLIT_STATE: Record<EvalSplit, SplitViewState> = {
  development: { checkpoint: null, score: null },
  'held-out': { checkpoint: null, score: null },
}

const CONTEXT_VARIANT_LABELS: Record<ContextCompressionEvalRecordV1['variant'], string> = {
  'full-source': '全文基线',
  'deterministic-truncation': '旧截断',
  'semantic-compression': '语义压缩',
}

const STATUS_LABELS: Record<H4LongConsistencyRunCheckpointV1['status'], string> = {
  running: '可恢复',
  completed: '已完成',
  failed: '失败',
  'budget-exhausted': '预算耗尽',
}

function readContextCompressionRecords(): ContextCompressionEvalRecordV1[] {
  try {
    const raw = localStorage.getItem(H17_CONTEXT_COMPRESSION_RESULTS_STORAGE_KEY)
    return raw ? JSON.parse(raw) as ContextCompressionEvalRecordV1[] : []
  } catch {
    return []
  }
}

async function evalChatWithRetry(
  messages: ChatMessage[],
  config: AIConfig,
  category: 'eval.h17.compression' | 'eval.h17.generation',
) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 180_000)
    try {
      const result: ChatResult = {}
      const output = category === 'eval.h17.compression'
        ? await chat(messages, config, { category: 'eval.h17.compression' }, controller.signal, result)
        : await chat(messages, config, { category: 'eval.h17.generation' }, controller.signal, result)
      return { output, usage: result.usage }
    } catch (error) {
      lastError = error
      const status = typeof error === 'object' && error && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : 0
      const retryable = status >= 500 || status === 429 || status === 0
      if (!retryable || attempt === 2) throw error
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1_500))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError
}

async function callH4Verifier(
  input: H4LongConsistencyVerifierCallInputV1,
  config: AIConfig,
) {
  if (input.verifier.provider !== config.provider || input.verifier.model !== config.model) {
    throw new Error('当前模型与 H4 checkpoint 冻结的 verifier 身份不一致')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180_000)
  const startedAt = performance.now()
  try {
    const result: ChatResult = {}
    const output = await chat(
      input.messages,
      { ...config, temperature: 0, maxTokens: 4_000 },
      { category: 'eval.h4.verifier', contextOverflowPolicy: 'reject' },
      controller.signal,
      result,
    )
    const inputTokens = result.usage?.inputTokens
      ?? input.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
    const outputTokens = result.usage?.outputTokens ?? estimateTokens(output)
    return {
      output,
      usage: {
        inputTokens,
        outputTokens,
        durationMs: Math.round(performance.now() - startedAt),
        costUsd: computeCostUsd(config.model, inputTokens, outputTokens),
      },
    }
  } finally {
    clearTimeout(timeout)
  }
}

function formatRate(value: number | null): string {
  return value == null ? '无样本' : `${(value * 100).toFixed(1)}%`
}

function downloadJson(raw: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function HarnessEvalPanel() {
  const config = useAIConfigStore(state => state.config)
  const dialog = useDialog()
  const [splits, setSplits] = useState<Record<EvalSplit, SplitViewState>>(EMPTY_SPLIT_STATE)
  const [compressionRecords, setCompressionRecords] = useState<ContextCompressionEvalRecordV1[]>([])
  const [runningSplit, setRunningSplit] = useState<EvalSplit | null>(null)
  const [compressionRunning, setCompressionRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void Promise.all((['development', 'held-out'] as const).map(async split => (
      [split, await loadH4LongConsistencyBrowserStateV1(split)] as const
    ))).then(entries => {
      if (!active) return
      setSplits(Object.fromEntries(entries.map(([split, state]) => [
        split,
        state ?? { checkpoint: null, score: null },
      ])) as Record<EvalSplit, SplitViewState>)
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause))
    })

    const stored = readContextCompressionRecords()
    void Promise.all(stored.map(async item => (
      await verifyContextCompressionEvalRecordV1(item) ? item : null
    ))).then(records => {
      if (!active) return
      setCompressionRecords(records.filter((item): item is ContextCompressionEvalRecordV1 => item !== null))
    })
    return () => { active = false }
  }, [])

  const updateSplit = (
    split: EvalSplit,
    checkpoint: H4LongConsistencyRunCheckpointV1 | null,
    score: H4LongConsistencySealedScoreV1 | null = null,
  ) => {
    setSplits(current => ({ ...current, [split]: { checkpoint, score } }))
  }

  const runH4 = async (split: EvalSplit) => {
    setRunningSplit(split)
    setError('')
    const existing = splits[split].checkpoint
    const total = split === 'development' ? 40 : 20
    setProgress(`${existing?.completed.length ?? 0}/${total}`)
    try {
      if (
        existing?.status === 'running'
        && (existing.execution.verifier.provider !== config.provider
          || existing.execution.verifier.model !== config.model)
      ) {
        throw new Error(
          `请先切回 ${existing.execution.verifier.provider}/${existing.execution.verifier.model} 再继续该 checkpoint`,
        )
      }
      const checkpoint = await runH4LongConsistencyVerifierV1({
        runId: existing?.runId ?? `h4-${split}-${crypto.randomUUID()}`,
        split,
        codeRevision: existing?.codeRevision ?? APP_BUILD_ID,
        execution: existing?.execution ?? {
          generator: {
            provider: 'fixture',
            model: 'h4-synthetic-corpus',
            promptVersion: H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
          },
          verifier: {
            provider: config.provider,
            model: config.model,
            promptVersion: LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V1,
          },
        },
        call: input => callH4Verifier(input, config),
        maxAttemptsPerFixture: existing?.maxAttemptsPerFixture ?? 2,
        resumeFrom: existing?.status === 'running' ? existing : undefined,
        onCheckpoint: async next => {
          await persistH4LongConsistencyBrowserCheckpointV1(next)
          updateSplit(split, next)
          setProgress(`${next.completed.length}/${next.fixtureIds.length}`)
        },
      })
      const score = await scoreH4LongConsistencyCheckpointV1({ checkpoint })
      updateSplit(split, checkpoint, score)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunningSplit(null)
    }
  }

  const resetSplit = async (split: EvalSplit) => {
    const confirmed = await dialog.confirm({
      title: '清除 H4 checkpoint？',
      message: '未导出的评测证据将无法恢复。',
      confirmText: '清除',
      cancelText: '保留',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      clearH4LongConsistencyBrowserCheckpointV1(split)
      updateSplit(split, null)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const exportSplit = async (split: EvalSplit) => {
    const checkpoint = splits[split].checkpoint
    if (!checkpoint) return
    try {
      const raw = await exportH4LongConsistencyRunCheckpointV1(checkpoint)
      downloadJson(raw, `storyforge-h4-${split}-${checkpoint.runId}.json`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const runCompressionMatrix = async () => {
    setCompressionRunning(true)
    setError('')
    setProgress('0/3 组')
    try {
      const records = await runContextCompressionEvalMatrixV1({
        fixtures: getFixtures('development').slice(0, 3),
        split: 'development',
        contextTargetTokens: 900,
        generationMaxTokens: 1_200,
        config,
        call: async (messages, runConfig, phase) => evalChatWithRetry(
          messages,
          runConfig,
          phase === 'compression' ? 'eval.h17.compression' : 'eval.h17.generation',
        ),
        onVariantComplete: (_record, completed, total) => setProgress(`${completed}/${total} 组`),
        onCaseProgress: (variantIndex, variantTotal, completed, total) => {
          setProgress(`${variantIndex + 1}/${variantTotal} 组 · ${completed}/${total} 例`)
        },
      })
      setCompressionRecords(records)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCompressionRunning(false)
    }
  }

  const fullCompressionRecord = compressionRecords.find(item => item.variant === 'full-source')
  const semanticCompressionRecord = compressionRecords.find(item => item.variant === 'semantic-compression')
  const compressionGate = useMemo(() => (
    fullCompressionRecord && semanticCompressionRecord
      ? evaluateContextCompressionNonInferiorityV1({
          full: fullCompressionRecord,
          semantic: semanticCompressionRecord,
        })
      : null
  ), [fullCompressionRecord, semanticCompressionRecord])
  const developmentPassed = splits.development.score?.gate.passed === true

  const renderSplit = (split: EvalSplit, label: string) => {
    const state = splits[split]
    const checkpoint = state.checkpoint
    const score = state.score
    const isRunning = runningSplit === split
    const isResumable = checkpoint?.status === 'running'
    const locked = checkpoint != null && checkpoint.status !== 'running'
    const heldOutBlocked = split === 'held-out' && !isResumable && !developmentPassed
    return (
      <section className="border-t border-border/60 py-3 first:border-t-0" data-testid={`h4-${split}-section`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-medium text-text-primary">{label}</h4>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {checkpoint
                ? `${checkpoint.execution.verifier.provider}/${checkpoint.execution.verifier.model} · ${STATUS_LABELS[checkpoint.status]} · ${checkpoint.completed.length}/${checkpoint.fixtureIds.length}`
                : split === 'development' ? '40 例' : '20 例 · development 通过后解锁'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void runH4(split) }}
              disabled={runningSplit != null || compressionRunning || !isAIConfigReady(config) || locked || heldOutBlocked}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent/10 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/20 disabled:opacity-40"
            >
              {isRunning
                ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                : <Play className="h-3.5 w-3.5" />}
              {isRunning ? progress : isResumable ? '继续' : '运行'}
            </button>
            {checkpoint && (
              <button
                type="button"
                onClick={() => { void exportSplit(split) }}
                disabled={runningSplit != null}
                title="导出 checkpoint artifact"
                aria-label={`导出 ${label}`}
                className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
            {checkpoint && runningSplit == null
              && (split === 'development' || checkpoint.status !== 'completed') && (
              <button
                type="button"
                onClick={() => { void resetSplit(split) }}
                title={split === 'development' ? '开始新的 development 评测' : '清除未完成 checkpoint'}
                aria-label={`清除 ${label}`}
                className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {score && (
          <div data-testid={`h4-${split}-score`} className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-text-secondary sm:grid-cols-4">
            <span>高严重度精确率 {formatRate(score.highSeverityHard.precision.estimate)}</span>
            <span>高严重度召回率 {formatRate(score.highSeverityHard.recall.estimate)}</span>
            <span>证据回查 {formatRate(score.evidence.verificationRate.estimate)}</span>
            <span className={score.gate.passed ? 'text-success' : 'text-error'}>
              {score.gate.passed ? '门禁 PASS' : `门禁 FAIL · ${score.gate.failures.join(', ')}`}
            </span>
            <span>调用 {score.usage.modelCalls}</span>
            <span>输入 {score.usage.inputTokens} tokens</span>
            <span>输出 {score.usage.outputTokens} tokens</span>
            <span>估算成本 ${score.usage.costUsd.toFixed(4)}</span>
          </div>
        )}
      </section>
    )
  }

  return (
    <div data-testid="harness-eval-panel" className="mt-6 max-w-2xl rounded-lg border border-border bg-bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Harness 长篇一致性评测</h3>
        <span className="text-[10px] text-text-muted">仅开发环境</span>
      </div>
      {renderSplit('development', 'H4 Development')}
      {renderSplit('held-out', 'H4 Held-out')}

      <section className="border-t border-border pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-medium text-text-primary">H17 上下文质量对照</h4>
          <button
            type="button"
            onClick={() => { void runCompressionMatrix() }}
            disabled={runningSplit != null || compressionRunning || !isAIConfigReady(config)}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-500/10 px-2.5 py-1.5 text-xs text-sky-400 hover:bg-sky-500/20 disabled:opacity-40"
          >
            {compressionRunning
              ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              : <Play className="h-3.5 w-3.5" />}
            {compressionRunning ? progress : '运行'}
          </button>
        </div>
        {compressionRecords.length > 0 && (
          <div data-testid="h17-context-compression-result" className="mt-3 overflow-x-auto">
            <table className="w-full text-[11px] text-text-secondary">
              <thead>
                <tr className="text-left text-text-muted">
                  <th>方案</th><th>事实</th><th>约束</th><th>泄漏</th><th>生成输入</th><th>总输入</th><th>调用</th>
                </tr>
              </thead>
              <tbody>
                {compressionRecords.map(item => (
                  <tr key={item.variant} className="border-t border-border/50">
                    <td>{CONTEXT_VARIANT_LABELS[item.variant]}</td>
                    <td>{(item.aggregate.requiredFactRecall * 100).toFixed(1)}%</td>
                    <td>{(item.aggregate.constraintRecall * 100).toFixed(1)}%</td>
                    <td>{((item.aggregate.futureLeakageRate + item.aggregate.wrongWorldLeakageRate) * 100).toFixed(1)}%</td>
                    <td>{item.aggregate.generationInputTokens}</td>
                    <td>{item.aggregate.totalInputTokens}</td>
                    <td>{item.aggregate.modelCalls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {compressionGate && (
              <p className={`mt-2 text-[11px] ${compressionGate.passed ? 'text-success' : 'text-error'}`}>
                H17 非劣门：{compressionGate.passed ? 'PASS' : `FAIL · ${compressionGate.failures.join(', ')}`}
                {' '}· 生成输入下降 {(compressionGate.generationInputReduction * 100).toFixed(1)}%
                {' '}· 总输入倍率 {compressionGate.totalInputMultiplier.toFixed(2)}x
              </p>
            )}
          </div>
        )}
      </section>
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
    </div>
  )
}
