import { useState } from 'react'
import { chat } from '../../lib/ai/client'
import { getFixtures } from '../../lib/evals/long-consistency/fixtures'
import {
  evaluateNs1Gate,
  NS0_PAIRED_RESULTS_STORAGE_KEY,
  NS0_RESULTS_STORAGE_KEY,
  runPairedEvalInBrowser,
  runEvalInBrowser,
} from '../../lib/evals/long-consistency/runner'
import type { EvalRunRecord } from '../../lib/evals/long-consistency/types'
import {
  buildSemanticJudgeMessages,
  parseSemanticJudgeVerdict,
  scoreWithSemanticVerdict,
} from '../../lib/evals/long-consistency/semantic-judge'
import { useAIConfigStore } from '../../stores/ai-config'

function readStoredRecord(): EvalRunRecord | null {
  try {
    const raw = localStorage.getItem(NS0_RESULTS_STORAGE_KEY)
    return raw ? JSON.parse(raw) as EvalRunRecord : null
  } catch {
    return null
  }
}

function readPairedRecords(): EvalRunRecord[] {
  try {
    const raw = localStorage.getItem(NS0_PAIRED_RESULTS_STORAGE_KEY)
    return raw ? JSON.parse(raw) as EvalRunRecord[] : []
  } catch {
    return []
  }
}

async function evalChatWithRetry(
  messages: import('../../lib/types').ChatMessage[],
  config: import('../../lib/types').AIConfig,
  category: string,
) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45_000)
    try {
      const result: import('../../lib/ai/client').ChatResult = {}
      const output = await chat(
        messages,
        config,
        { category: category },
        controller.signal,
        result,
      )
      return { output, usage: result.usage }
    } catch (error) {
      lastError = error
      const status = typeof error === 'object' && error && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : 0
      const retryable = status >= 500 || status === 429 || status === 0
      if (!retryable || attempt === 2) throw error
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1500))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError
}

async function judgeEvalOutput(
  fixture: import('../../lib/evals/long-consistency/types').LongConsistencyFixture,
  output: string,
  config: import('../../lib/types').AIConfig,
) {
  const messages = buildSemanticJudgeMessages(fixture, output)
  const response = await evalChatWithRetry(
    messages,
    { ...config, temperature: 0, maxTokens: 600 },
    'eval.ns1.judge',
  )
  const verdict = parseSemanticJudgeVerdict(fixture, response.output)
  if (!verdict) throw new Error(`语义裁判返回无法解析：${fixture.id}`)
  return scoreWithSemanticVerdict(fixture, output, verdict)
}

export default function NS0EvalPanel() {
  const config = useAIConfigStore(state => state.config)
  const [record, setRecord] = useState<EvalRunRecord | null>(() => readStoredRecord())
  const [pairedRecords, setPairedRecords] = useState<EvalRunRecord[]>(() => readPairedRecords())
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    setError('')
    try {
      const fixtures = getFixtures('development')
      setProgress(`0/${fixtures.length}`)
      const next = await runEvalInBrowser({
        fixtures,
        split: 'development',
        variant: 'legacy-500-tail',
        budgetMode: 'fixed',
        config,
        call: (messages, fixedConfig) => evalChatWithRetry(messages, fixedConfig, 'eval.ns0'),
        onProgress: (completed, total) => setProgress(`${completed}/${total}`),
      })
      setRecord(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(false)
    }
  }

  const runPaired = async () => {
    setRunning(true)
    setError('')
    setProgress('0/4 组')
    try {
      const fixtures = getFixtures('held-out')
      const records = await runPairedEvalInBrowser({
        fixtures,
        split: 'held-out',
        variants: ['legacy-500-tail', 'handoff-tail-summary'],
        config,
        call: (messages, runConfig) => evalChatWithRetry(messages, runConfig, 'eval.ns1'),
        judge: judgeEvalOutput,
        onRunComplete: (_completedRecord, completed, total) => setProgress(`${completed}/${total} 组`),
        onCaseProgress: (completedRuns, totalRuns, completedCases, totalCases) => {
          setProgress(`${completedRuns + 1}/${totalRuns} 组 · ${completedCases}/${totalCases} 例`)
        },
      })
      setPairedRecords(records)
      setRecord(records.length ? records[records.length - 1] : null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(false)
    }
  }

  const aggregate = record?.aggregate
  const fixedLegacy = pairedRecords.find(item => item.budgetMode === 'fixed' && item.variant === 'legacy-500-tail')
  const fixedCandidate = pairedRecords.find(item => item.budgetMode === 'fixed' && item.variant === 'handoff-tail-summary')
  const naturalLegacy = pairedRecords.find(item => item.budgetMode === 'natural' && item.variant === 'legacy-500-tail')
  const naturalCandidate = pairedRecords.find(item => item.budgetMode === 'natural' && item.variant === 'handoff-tail-summary')
  const fixedGate = fixedLegacy && fixedCandidate ? evaluateNs1Gate(fixedLegacy, fixedCandidate) : null
  const naturalGate = naturalLegacy && naturalCandidate ? evaluateNs1Gate(naturalLegacy, naturalCandidate) : null
  const finalHeldOutAlreadyRun = pairedRecords.some(item => item.split === 'held-out')

  return (
    <div data-testid="ns0-eval-panel" className="max-w-2xl mt-6 p-4 bg-bg-surface border border-border rounded-xl">
      <h3 className="text-sm font-semibold text-text-primary">NS-0 长期一致性基线（仅开发环境）</h3>
      <p className="mt-1 text-xs text-text-muted">
        普通按钮运行 development 样例；NS-1 最终按钮运行冻结 held-out，并用独立语义裁判评分。最终盲测只展示 aggregate，不展开逐例输出。
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => { void run() }}
          disabled={running || !config.apiKey}
          className="px-3 py-1.5 text-sm rounded-lg bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-40"
        >
          {running ? `运行中 ${progress}` : '运行 development 集'}
        </button>
        <button
          onClick={() => { void runPaired() }}
          disabled={running || !config.apiKey || finalHeldOutAlreadyRun}
          className="px-3 py-1.5 text-sm rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
        >
          {finalHeldOutAlreadyRun ? 'NS-1 最终盲测已锁定' : 'NS-1 最终配对 A/B'}
        </button>
        {record && <span className="text-xs text-text-muted">{record.model} · {record.createdAt}</span>}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {aggregate && (
        <div data-testid="ns0-eval-result" className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-secondary">
          <span>事实召回：{(aggregate.requiredFactRecall * 100).toFixed(1)}%</span>
          <span>约束召回：{(aggregate.constraintRecall * 100).toFixed(1)}%</span>
          <span>未来泄漏：{(aggregate.futureLeakageRate * 100).toFixed(1)}%</span>
          <span>错世界泄漏：{(aggregate.wrongWorldLeakageRate * 100).toFixed(1)}%</span>
          <span>估算输入：{aggregate.estimatedInputTokens} tokens</span>
          <span>估算输出：{aggregate.estimatedOutputTokens} tokens</span>
        </div>
      )}
      {pairedRecords.length > 0 && (
        <div data-testid="ns1-paired-eval-result" className="mt-3 overflow-x-auto">
          <table className="w-full text-[11px] text-text-secondary">
            <thead>
              <tr className="text-left text-text-muted">
                <th>预算</th><th>变体</th><th>事实</th><th>约束</th><th>未来</th><th>错世界</th><th>输入/输出</th>
              </tr>
            </thead>
            <tbody>
              {pairedRecords.map(item => (
                <tr key={`${item.budgetMode}:${item.variant}`} className="border-t border-border/50">
                  <td>{item.budgetMode}</td>
                  <td>{item.variant}</td>
                  <td>{(item.aggregate.requiredFactRecall * 100).toFixed(1)}%</td>
                  <td>{(item.aggregate.constraintRecall * 100).toFixed(1)}%</td>
                  <td>{(item.aggregate.futureLeakageRate * 100).toFixed(1)}%</td>
                  <td>{(item.aggregate.wrongWorldLeakageRate * 100).toFixed(1)}%</td>
                  <td>{item.aggregate.estimatedInputTokens}/{item.aggregate.estimatedOutputTokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(fixedGate || naturalGate) && (
            <div className="mt-2 space-y-1 text-[11px]">
              {fixedGate && (
                <p className={fixedGate.passed ? 'text-success' : 'text-error'}>
                  fixed 硬门：{fixedGate.passed ? 'PASS' : `FAIL · ${fixedGate.failures.join(', ')}`}
                </p>
              )}
              {naturalGate && (
                <p className={naturalGate.passed ? 'text-success' : 'text-error'}>
                  natural 硬门：{naturalGate.passed ? 'PASS' : `FAIL · ${naturalGate.failures.join(', ')}`}
                </p>
              )}
            </div>
          )}
          <div className="mt-2 space-y-1">
            {pairedRecords.filter(item => item.split === 'development').map(item => (
              <details key={`details:${item.budgetMode}:${item.variant}`} className="text-[11px] text-text-muted">
                <summary>{item.budgetMode} · {item.variant} 逐例结果</summary>
                {item.results.map(result => (
                  <div key={result.fixtureId} className="mt-1 border-l border-border pl-2">
                    <p>
                      {result.fixtureId} · 事实 {(result.score.requiredFactRecall * 100).toFixed(0)}%
                      {' '}· 约束 {(result.score.constraintRecall * 100).toFixed(0)}%
                    </p>
                    <p>命中约束：{result.score.matchedConstraints.join(', ') || '无'}</p>
                    <p className="whitespace-pre-wrap text-text-secondary">{result.output.slice(0, 500)}</p>
                  </div>
                ))}
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
