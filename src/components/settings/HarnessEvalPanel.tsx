import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardCopy, Download, FileJson, LoaderCircle, Play, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
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
  clearH4SubtypeAdjudicationBrowserCheckpointV1,
  exportH4LongConsistencyRunCheckpointV1,
  exportH4SubtypeAdjudicationCheckpointV1,
  H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
  H4_SUBTYPE_ADJUDICATION_PROMPT_VERSION_V1,
  importH4LongConsistencyRunCheckpointV1,
  loadH4LongConsistencyBrowserStateV1,
  loadH4SubtypeAdjudicationBrowserStateV1,
  LONG_CONSISTENCY_CURRENT_JUDGE_PROMPT_VERSION_V1,
  persistH4LongConsistencyBrowserCheckpointV1,
  persistH4SubtypeAdjudicationBrowserCheckpointV1,
  runH4SubtypeAdjudicationV1,
  runH4LongConsistencyVerifierV1,
  scoreH4SubtypeAdjudicationCheckpointV1,
  scoreH4LongConsistencyCheckpointV1,
  type H4LongConsistencyRunCheckpointV1,
  type H4LongConsistencySealedScoreV1,
  type H4LongConsistencyVerifierCallInputV1,
  type H4SubtypeAdjudicationCallInputV1,
  type H4SubtypeAdjudicationCheckpointV1,
  type H4SubtypeAdjudicationSealedScoreV1,
} from '../../lib/evals/long-consistency'
import { getFixtures } from '../../lib/evals/long-consistency/fixtures'
import type { EvalSplit } from '../../lib/evals/long-consistency/types'
import type { AIConfig, ChatMessage } from '../../lib/types'
import { APP_BUILD_ID } from '../../lib/version'
import { useAIConfigStore } from '../../stores/ai-config'
import { useDialog } from '../shared/Dialog'
import H86StoryArcEvalPanel from './H86StoryArcEvalPanel'
import CreativeReliabilityEvalPanel from './CreativeReliabilityEvalPanel'

interface SplitViewState {
  checkpoint: H4LongConsistencyRunCheckpointV1 | null
  score: H4LongConsistencySealedScoreV1 | null
}

interface AdjudicationSplitViewState {
  checkpoint: H4SubtypeAdjudicationCheckpointV1 | null
  score: H4SubtypeAdjudicationSealedScoreV1 | null
}

const EMPTY_SPLIT_STATE: Record<EvalSplit, SplitViewState> = {
  development: { checkpoint: null, score: null },
  'held-out': { checkpoint: null, score: null },
}

const EMPTY_ADJUDICATION_SPLIT_STATE: Record<EvalSplit, AdjudicationSplitViewState> = {
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

const H85_STATUS_LABELS: Record<H4SubtypeAdjudicationCheckpointV1['status'], string> = {
  running: '可恢复',
  completed: '已完成',
  failed: '失败',
  'budget-exhausted': '预算耗尽',
  'provider-blocked': '服务暂阻，可继续',
}

function isAdjudicationResumable(
  checkpoint: H4SubtypeAdjudicationCheckpointV1 | null | undefined,
): checkpoint is H4SubtypeAdjudicationCheckpointV1 {
  if (!checkpoint) return false
  if (checkpoint.status === 'running' || checkpoint.status === 'provider-blocked') return true
  const latestFailure = checkpoint.failures[checkpoint.failures.length - 1]
  return checkpoint.status === 'failed'
    && latestFailure?.code === 'adjudicator_error'
    && latestFailure.message.includes('AI API Error (429)')
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
      input.verifier.promptVersion === LONG_CONSISTENCY_CURRENT_JUDGE_PROMPT_VERSION_V1
        ? { responseFormat: 'json_object' }
        : undefined,
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

async function callH4SubtypeAdjudicator(
  input: H4SubtypeAdjudicationCallInputV1,
  config: AIConfig,
) {
  if (input.adjudicator.provider !== config.provider || input.adjudicator.model !== config.model) {
    throw new Error('当前模型与 H85 checkpoint 冻结的 adjudicator 身份不一致')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180_000)
  const startedAt = performance.now()
  try {
    const result: ChatResult = {}
    const output = await chat(
      input.messages,
      { ...config, temperature: 0, maxTokens: 2_000 },
      { category: 'eval.h4.verifier', contextOverflowPolicy: 'reject' },
      controller.signal,
      result,
      { responseFormat: 'json_object' },
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
  const [adjudicationSplits, setAdjudicationSplits] = useState<Record<EvalSplit, AdjudicationSplitViewState>>(
    EMPTY_ADJUDICATION_SPLIT_STATE,
  )
  const [compressionRecords, setCompressionRecords] = useState<ContextCompressionEvalRecordV1[]>([])
  const [runningSplit, setRunningSplit] = useState<EvalSplit | null>(null)
  const [runningAdjudicationSplit, setRunningAdjudicationSplit] = useState<EvalSplit | null>(null)
  const [compressionRunning, setCompressionRunning] = useState(false)
  const [copiedSplit, setCopiedSplit] = useState<EvalSplit | null>(null)
  const [copiedAdjudicationSplit, setCopiedAdjudicationSplit] = useState<EvalSplit | null>(null)
  const [adjudicationExportJson, setAdjudicationExportJson] = useState<Partial<Record<EvalSplit, string>>>({})
  const [importingSplit, setImportingSplit] = useState<EvalSplit | null>(null)
  const [importDrafts, setImportDrafts] = useState<Record<EvalSplit, string>>({
    development: '',
    'held-out': '',
  })
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const importInputRefs = useRef<Record<EvalSplit, HTMLInputElement | null>>({
    development: null,
    'held-out': null,
  })

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

    void Promise.all((['development', 'held-out'] as const).map(async split => (
      [split, await loadH4SubtypeAdjudicationBrowserStateV1(split)] as const
    ))).then(entries => {
      if (!active) return
      setAdjudicationSplits(Object.fromEntries(entries.map(([split, state]) => [
        split,
        state ?? { checkpoint: null, score: null },
      ])) as Record<EvalSplit, AdjudicationSplitViewState>)
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

  const updateAdjudicationSplit = (
    split: EvalSplit,
    checkpoint: H4SubtypeAdjudicationCheckpointV1 | null,
    score: H4SubtypeAdjudicationSealedScoreV1 | null = null,
  ) => {
    setAdjudicationSplits(current => ({ ...current, [split]: { checkpoint, score } }))
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
            promptVersion: LONG_CONSISTENCY_CURRENT_JUDGE_PROMPT_VERSION_V1,
          },
        },
        call: input => callH4Verifier(input, config),
        maxAttemptsPerFixture: existing?.maxAttemptsPerFixture ?? 3,
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

  const copySplit = async (split: EvalSplit) => {
    const checkpoint = splits[split].checkpoint
    if (!checkpoint) return
    try {
      const raw = await exportH4LongConsistencyRunCheckpointV1(checkpoint)
      await navigator.clipboard.writeText(raw)
      setCopiedSplit(split)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const importSplitRaw = async (split: EvalSplit, raw: string) => {
    try {
      const checkpoint = await importH4LongConsistencyRunCheckpointV1(raw)
      if (checkpoint.split !== split) throw new Error(`导入文件属于 ${checkpoint.split}，不能写入 ${split} 槽`)
      if (splits[split].checkpoint) {
        const confirmed = await dialog.confirm({
          title: `替换 ${split} checkpoint？`,
          message: '导入文件已通过完整性验证；继续会替换浏览器中的当前槽，原 checkpoint 不会自动导出。',
          confirmText: '替换',
          cancelText: '保留',
          tone: 'danger',
        })
        if (!confirmed) return
      }
      await persistH4LongConsistencyBrowserCheckpointV1(checkpoint)
      updateSplit(split, checkpoint, await scoreH4LongConsistencyCheckpointV1({ checkpoint }))
      setImportDrafts(current => ({ ...current, [split]: '' }))
      setImportingSplit(null)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const importSplitFile = async (split: EvalSplit, file: File) => {
    try {
      await importSplitRaw(split, await file.text())
    } finally {
      const input = importInputRefs.current[split]
      if (input) input.value = ''
    }
  }

  const runAdjudication = async (split: EvalSplit) => {
    setRunningAdjudicationSplit(split)
    setError('')
    const baseCheckpoint = splits[split].checkpoint
    const existing = adjudicationSplits[split].checkpoint
    const frozenBaseCheckpoint = existing?.baseCheckpoint ?? baseCheckpoint
    const resumable = isAdjudicationResumable(existing)
    setProgress(`${existing?.completed.length ?? 0}/${frozenBaseCheckpoint?.fixtureIds.length ?? 0}`)
    try {
      if (!frozenBaseCheckpoint || frozenBaseCheckpoint.status !== 'completed') {
        throw new Error('H85 需要同 split 已完成并验签的 H4 judge v7 checkpoint')
      }
      if (
        resumable
        && (
          existing.execution.adjudicator.provider !== config.provider
          || existing.execution.adjudicator.model !== config.model
        )
      ) {
        throw new Error(
          `请先切回 ${existing.execution.adjudicator.provider}/${existing.execution.adjudicator.model} 再继续该 H85 checkpoint`,
        )
      }
      const checkpoint = await runH4SubtypeAdjudicationV1({
        runId: existing?.runId ?? `h85-${split}-${crypto.randomUUID()}`,
        codeRevision: existing?.codeRevision ?? APP_BUILD_ID,
        baseCheckpoint: frozenBaseCheckpoint,
        adjudicator: existing?.execution.adjudicator ?? {
          provider: config.provider,
          model: config.model,
          promptVersion: H4_SUBTYPE_ADJUDICATION_PROMPT_VERSION_V1,
        },
        call: input => callH4SubtypeAdjudicator(input, config),
        maxAttemptsPerFixture: existing?.maxAttemptsPerFixture ?? 2,
        resumeFrom: resumable ? existing : undefined,
        onCheckpoint: async next => {
          await persistH4SubtypeAdjudicationBrowserCheckpointV1(next)
          updateAdjudicationSplit(split, next)
          setProgress(`${next.completed.length}/${next.fixtureIds.length}`)
        },
      })
      const score = await scoreH4SubtypeAdjudicationCheckpointV1({ checkpoint })
      updateAdjudicationSplit(split, checkpoint, score)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunningAdjudicationSplit(null)
    }
  }

  const resetAdjudication = async (split: EvalSplit) => {
    const confirmed = await dialog.confirm({
      title: '清除 H85 checkpoint？',
      message: '未导出的两阶段判类证据将无法恢复；H4 父 checkpoint 不受影响。',
      confirmText: '清除',
      cancelText: '保留',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      clearH4SubtypeAdjudicationBrowserCheckpointV1(split)
      updateAdjudicationSplit(split, null)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const exportAdjudication = async (split: EvalSplit) => {
    const checkpoint = adjudicationSplits[split].checkpoint
    if (!checkpoint) return
    try {
      const raw = await exportH4SubtypeAdjudicationCheckpointV1(checkpoint)
      downloadJson(raw, `storyforge-h85-${split}-${checkpoint.runId}.json`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const copyAdjudication = async (split: EvalSplit) => {
    const checkpoint = adjudicationSplits[split].checkpoint
    if (!checkpoint) return
    try {
      const raw = await exportH4SubtypeAdjudicationCheckpointV1(checkpoint)
      await navigator.clipboard.writeText(raw)
      setCopiedAdjudicationSplit(split)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const toggleAdjudicationJson = async (split: EvalSplit) => {
    if (adjudicationExportJson[split] != null) {
      setAdjudicationExportJson(current => ({ ...current, [split]: undefined }))
      return
    }
    const checkpoint = adjudicationSplits[split].checkpoint
    if (!checkpoint) return
    try {
      const raw = await exportH4SubtypeAdjudicationCheckpointV1(checkpoint)
      setAdjudicationExportJson(current => ({ ...current, [split]: raw }))
      setError('')
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
  const adjudicationDevelopmentPassed = adjudicationSplits.development.score?.gate.passed === true
  const developmentPassed = splits.development.score?.gate.passed === true || adjudicationDevelopmentPassed
  const busy = runningSplit != null || runningAdjudicationSplit != null || compressionRunning

  const renderSplit = (split: EvalSplit, label: string) => {
    const state = splits[split]
    const checkpoint = state.checkpoint
    const score = state.score
    const latestFailure = checkpoint?.failures[checkpoint.failures.length - 1] ?? null
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
                ? `生成 ${checkpoint.execution.generator.provider}/${checkpoint.execution.generator.model} · 验证 ${checkpoint.execution.verifier.provider}/${checkpoint.execution.verifier.model} · ${STATUS_LABELS[checkpoint.status]} · ${checkpoint.completed.length}/${checkpoint.fixtureIds.length}`
                : split === 'development' ? '40 例' : '20 例 · development 通过后解锁'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void runH4(split) }}
              disabled={busy || !isAIConfigReady(config) || locked || heldOutBlocked}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent/10 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/20 disabled:opacity-40"
            >
              {isRunning
                ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                : <Play className="h-3.5 w-3.5" />}
              {isRunning ? progress : isResumable ? '继续' : '运行'}
            </button>
            <input
              ref={node => { importInputRefs.current[split] = node }}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label={`选择 ${label} checkpoint 文件`}
              onChange={event => {
                const file = event.currentTarget.files?.[0]
                if (file) void importSplitFile(split, file)
              }}
            />
            <button
              type="button"
              onClick={() => setImportingSplit(current => current === split ? null : split)}
              disabled={busy}
              title="从文件或粘贴 JSON 导入并验证 checkpoint"
              aria-label={`导入 ${label}`}
              className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
            >
              <Upload className="h-3.5 w-3.5" />
            </button>
            {checkpoint && (
              <button
                type="button"
                onClick={() => { void copySplit(split) }}
                disabled={busy}
                title={copiedSplit === split ? '已复制 checkpoint JSON' : '复制 checkpoint JSON'}
                aria-label={`复制 ${label}`}
                className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
              >
                <ClipboardCopy className="h-3.5 w-3.5" />
              </button>
            )}
            {checkpoint && (
              <button
                type="button"
                onClick={() => { void exportSplit(split) }}
                disabled={busy}
                title="导出 checkpoint artifact"
                aria-label={`导出 ${label}`}
                className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
            {checkpoint && !busy
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
        {importingSplit === split && (
          <div className="mt-3 rounded-md border border-border/70 bg-bg-primary/40 p-2" data-testid={`h4-${split}-import-panel`}>
            <textarea
              value={importDrafts[split]}
              onChange={event => setImportDrafts(current => ({ ...current, [split]: event.target.value }))}
              placeholder="粘贴 H4 checkpoint JSON；导入前会验签并核对 split"
              aria-label={`${label} checkpoint JSON`}
              className="h-24 w-full resize-y rounded-md border border-border bg-bg-primary px-2 py-1.5 font-mono text-[10px] text-text-secondary outline-none focus:border-accent"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { void importSplitRaw(split, importDrafts[split]) }}
                disabled={!importDrafts[split].trim()}
                className="rounded-md bg-accent/10 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/20 disabled:opacity-40"
              >
                验证并导入
              </button>
              <button
                type="button"
                onClick={() => importInputRefs.current[split]?.click()}
                className="rounded-md px-2.5 py-1.5 text-xs text-text-secondary hover:bg-bg-hover"
              >
                选择 JSON 文件
              </button>
              <span className="text-[10px] text-text-muted">完整性、父 hash、fixture 与 split 均通过后才替换当前槽。</span>
            </div>
          </div>
        )}
        {score && (
          <div data-testid={`h4-${split}-score`} className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-text-secondary sm:grid-cols-4">
            <span>高严重度精确率 {formatRate(score.highSeverityHard.precision.estimate)}</span>
            <span>高严重度召回率 {formatRate(score.highSeverityHard.recall.estimate)}</span>
            <span>证据回查 {formatRate(score.evidence.verificationRate.estimate)}</span>
            <span className={score.gate.passed ? 'text-success' : 'text-error'}>
              {score.gate.passed ? '门禁 PASS' : `门禁 FAIL · ${score.gate.failures.join(', ')}`}
            </span>
            <span>验证调用 {score.usage.modelCalls}</span>
            <span>验证输入 {score.usage.inputTokens} tokens</span>
            <span>验证输出 {score.usage.outputTokens} tokens</span>
            <span>验证估算成本 ${score.usage.costUsd.toFixed(4)}</span>
            <span>累计延迟 {(score.usage.durationMs / 1_000).toFixed(1)}s</span>
          </div>
        )}
        {checkpoint && (
          <p
            data-testid={`h4-${split}-checkpoint-hash`}
            className="mt-2 break-all font-mono text-[10px] text-text-muted"
          >
            checkpoint {checkpoint.checkpointHash}
          </p>
        )}
        {latestFailure && (
          <p
            data-testid={`h4-${split}-failure`}
            className="mt-2 break-words text-[11px] text-error"
          >
            最近失败：{latestFailure.code} · {latestFailure.message}
            {latestFailure.usage == null ? ' · 未取得 provider 用量' : ''}
          </p>
        )}
      </section>
    )
  }

  const renderAdjudicationSplit = (split: EvalSplit, label: string) => {
    const baseCheckpoint = splits[split].checkpoint
    const state = adjudicationSplits[split]
    const checkpoint = state.checkpoint
    const score = state.score
    const latestFailure = checkpoint?.failures[checkpoint.failures.length - 1] ?? null
    const isRunning = runningAdjudicationSplit === split
    const isResumable = isAdjudicationResumable(checkpoint)
    const locked = checkpoint != null && !isResumable
    const baseReady = isResumable || (
      baseCheckpoint?.status === 'completed'
      && baseCheckpoint.execution.verifier.promptVersion === LONG_CONSISTENCY_CURRENT_JUDGE_PROMPT_VERSION_V1
    )
    const heldOutBlocked = split === 'held-out' && !isResumable && !adjudicationDevelopmentPassed
    return (
      <section
        className="border-t border-border/60 py-3"
        data-testid={`h85-${split}-section`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-medium text-text-primary">{label}</h4>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {checkpoint
                ? `发现 ${checkpoint.execution.discoveryVerifier.provider}/${checkpoint.execution.discoveryVerifier.model} · 判类 ${checkpoint.execution.adjudicator.provider}/${checkpoint.execution.adjudicator.model} · ${H85_STATUS_LABELS[checkpoint.status]} · ${checkpoint.completed.length}/${checkpoint.fixtureIds.length}`
                : !baseReady
                  ? '需要同 split 已完成的 H4 judge v7 父 checkpoint'
                  : split === 'development'
                    ? '复用已验签证据对；只新增逐调用记账的定向判类'
                    : 'H85 development 通过后解锁'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void runAdjudication(split) }}
              disabled={busy || !isAIConfigReady(config) || !baseReady || locked || heldOutBlocked}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-500 hover:bg-emerald-500/20 disabled:opacity-40"
            >
              {isRunning
                ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                : <Play className="h-3.5 w-3.5" />}
              {isRunning ? progress : isResumable ? '继续判类' : '运行判类'}
            </button>
            {checkpoint && (
              <button
                type="button"
                onClick={() => { void copyAdjudication(split) }}
                disabled={busy}
                title={copiedAdjudicationSplit === split ? '已复制 H85 checkpoint JSON' : '复制 H85 checkpoint JSON'}
                aria-label={`复制 ${label}`}
                className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
              >
                <ClipboardCopy className="h-3.5 w-3.5" />
              </button>
            )}
            {checkpoint && (
              <button
                type="button"
                onClick={() => { void exportAdjudication(split) }}
                disabled={busy}
                title="导出 H85 checkpoint artifact"
                aria-label={`导出 ${label}`}
                className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
            {checkpoint && (
              <button
                type="button"
                onClick={() => { void toggleAdjudicationJson(split) }}
                disabled={busy}
                title={adjudicationExportJson[split] == null ? '显示 H85 checkpoint JSON' : '收起 H85 checkpoint JSON'}
                aria-label={`${adjudicationExportJson[split] == null ? '显示' : '收起'} ${label} JSON`}
                className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
              >
                <FileJson className="h-3.5 w-3.5" />
              </button>
            )}
            {checkpoint && !busy
              && (split === 'development' || checkpoint.status !== 'completed') && (
              <button
                type="button"
                onClick={() => { void resetAdjudication(split) }}
                title="开始新的 H85 判类评测"
                aria-label={`清除 ${label}`}
                className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {score && (
          <div data-testid={`h85-${split}-score`} className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-text-secondary sm:grid-cols-4">
            <span>高严重度精确率 {formatRate(score.highSeverityHard.precision.estimate)}</span>
            <span>高严重度召回率 {formatRate(score.highSeverityHard.recall.estimate)}</span>
            <span>证据回查 {formatRate(score.evidence.verificationRate.estimate)}</span>
            <span className={score.gate.passed ? 'text-success' : 'text-error'}>
              {score.gate.passed ? '门禁 PASS' : `门禁 FAIL · ${score.gate.failures.join(', ')}`}
            </span>
            <span>发现调用 {score.usage.discovery.modelCalls}</span>
            <span>判类调用 {score.usage.adjudication.modelCalls}</span>
            <span>总输入 {score.usage.total.inputTokens} tokens</span>
            <span>总输出 {score.usage.total.outputTokens} tokens</span>
            <span>总估算成本 ${score.usage.total.costUsd.toFixed(4)}</span>
            <span>累计延迟 {(score.usage.total.durationMs / 1_000).toFixed(1)}s</span>
          </div>
        )}
        {checkpoint && (
          <p
            data-testid={`h85-${split}-checkpoint-hash`}
            className="mt-2 break-all font-mono text-[10px] text-text-muted"
          >
            checkpoint {checkpoint.checkpointHash} · parent {checkpoint.baseCheckpointHash}
          </p>
        )}
        {adjudicationExportJson[split] != null && (
          <textarea
            data-testid={`h85-${split}-export-json`}
            readOnly
            aria-label={`${label} checkpoint JSON`}
            value={adjudicationExportJson[split]}
            className="mt-2 h-28 w-full resize-y rounded-md border border-border bg-bg-base p-2 font-mono text-[10px] text-text-secondary"
          />
        )}
        {latestFailure && (
          <p data-testid={`h85-${split}-failure`} className="mt-2 break-words text-[11px] text-error">
            最近失败：{latestFailure.code} · {latestFailure.message}
            {latestFailure.usage == null ? ' · 未取得 provider 用量' : ''}
          </p>
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
      {renderAdjudicationSplit('development', 'H85 两阶段判类 Development')}
      {renderAdjudicationSplit('held-out', 'H85 两阶段判类 Held-out')}
      <H86StoryArcEvalPanel />
      <CreativeReliabilityEvalPanel />

      <section className="border-t border-border pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-medium text-text-primary">H17 上下文质量对照</h4>
          <button
            type="button"
            onClick={() => { void runCompressionMatrix() }}
            disabled={busy || !isAIConfigReady(config)}
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
