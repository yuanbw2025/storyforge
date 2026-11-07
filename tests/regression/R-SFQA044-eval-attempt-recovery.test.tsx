import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import HarnessEvalPanel from '../../src/components/settings/HarnessEvalPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { runContextCompressionEvalVariantV1 } from '../../src/lib/evals/context-compression/runner'
import { chat } from '../../src/lib/ai/client'
import {
  H4_LONG_CONSISTENCY_FIXTURES_V1, H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
  LONG_CONSISTENCY_CURRENT_JUDGE_PROMPT_VERSION_V1, exportH4LongConsistencyRunCheckpointV1,
  importH4LongConsistencyRunCheckpointV1, runH4LongConsistencyVerifierV1,
  type H4LongConsistencyRunCheckpointV1,
} from '../../src/lib/evals/long-consistency'
import { H4CheckpointWriteErrorV1, classifyEvalTransportErrorV1 } from '../../src/lib/evals/long-consistency/h4-runner'
import { getFixtures } from '../../src/lib/evals/long-consistency/fixtures'
import { useAIConfigStore } from '../../src/stores/ai-config'

const config = { provider: 'openai' as const, model: 'gpt-4o-mini', apiKey: 'synthetic-only',
  baseUrl: 'http://127.0.0.1:9/v1', temperature: 0, maxTokens: 3000, contextWindow: 128_000 }
const fixture = H4_LONG_CONSISTENCY_FIXTURES_V1.find(row => row.split === 'development' && row.hiddenLabels.cleanControl)!
const input = { runId: '044-h4-isolated', split: 'development' as const, codeRevision: '044-test',
  fixtureIds: [fixture.id], maxAttemptsPerFixture: 3, execution: {
    generator: { provider: 'fixture', model: 'h4-synthetic-corpus', promptVersion: H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1 },
    verifier: { provider: config.provider, model: config.model, promptVersion: LONG_CONSISTENCY_CURRENT_JUDGE_PROMPT_VERSION_V1 },
  } }
const validRaw = ' {"schemaVersion":1,"issues":[]}\n'
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

it('044 H4 a real post-send disconnect stops after one request and checkpoint re-open does not resend', async () => {
  const transport = vi.fn<typeof fetch>(async () => { throw new TypeError('isolated post-send disconnect') })
  vi.stubGlobal('fetch', transport)
  const call = async ({ messages }: { messages: Parameters<typeof chat>[0] }) => {
    const result = {}
    try { return { output: await chat(messages, config, { category: 'eval.h4.verifier' }, undefined, result) } }
    catch (error) { throw classifyEvalTransportErrorV1(error, result) }
  }
  const observed: H4LongConsistencyRunCheckpointV1[] = []
  const failed = await runH4LongConsistencyVerifierV1({ ...input, call, onCheckpoint: row => { observed.push(row) } })
  expect(failed).toMatchObject({ status: 'failed', failures: [{ code: 'verifier_outcome_unknown', usage: null }] })
  expect(observed.some(row => row.pendingAttempt?.attempt === 1)).toBe(true)
  const restored = await importH4LongConsistencyRunCheckpointV1(await exportH4LongConsistencyRunCheckpointV1(failed))
  await expect(runH4LongConsistencyVerifierV1({ ...input, call, resumeFrom: restored })).resolves.toEqual(failed)
  expect(transport).toHaveBeenCalledTimes(1)
})

it('044 H4 a saved raw response can be reparsed after a local checkpoint write failure without calling the model again', async () => {
  const call = vi.fn(async () => ({ output: validRaw }))
  const localWrite = vi.fn((checkpoint: H4LongConsistencyRunCheckpointV1) => {
    if (checkpoint.pendingAttempt?.response) throw new Error('isolated storage write failure')
  })
  let interrupted: H4LongConsistencyRunCheckpointV1 | undefined
  try { await runH4LongConsistencyVerifierV1({ ...input, call, onCheckpoint: localWrite }) }
  catch (error) {
    expect(error).toBeInstanceOf(H4CheckpointWriteErrorV1)
    interrupted = (error as H4CheckpointWriteErrorV1).checkpoint
  }
  expect(interrupted?.pendingAttempt?.response?.rawJudgeOutput).toBe(validRaw)
  const resumed = await runH4LongConsistencyVerifierV1({ ...input, call, resumeFrom: interrupted,
    onCheckpoint: () => undefined })
  expect(resumed.status).toBe('completed')
  expect(resumed.completed[0]?.rawJudgeOutput).toBe(validRaw)
  expect(call).toHaveBeenCalledTimes(1)
})

it('044 H4 refresh of a prepared attempt with no response fails closed without a model request', async () => {
  const call = vi.fn(async () => ({ output: validRaw }))
  let snapshot: H4LongConsistencyRunCheckpointV1 | undefined
  await expect(runH4LongConsistencyVerifierV1({ ...input, call, onCheckpoint: checkpoint => {
    if (checkpoint.pendingAttempt) {
      snapshot = checkpoint
      throw new Error('tab interruption before final dispatch evidence')
    }
  } })).rejects.toBeInstanceOf(H4CheckpointWriteErrorV1)
  expect(call).not.toHaveBeenCalled()
  const resumed = await runH4LongConsistencyVerifierV1({ ...input, call, resumeFrom: snapshot })
  expect(resumed.failures[0]?.code).toBe('verifier_outcome_unknown')
  expect(call).not.toHaveBeenCalled()
})

it('044 real H17 button retains the uncertain attempt instead of silently sending again', async () => {
  useAIConfigStore.setState({ config, taskRoutes: {} })
  const transport = vi.fn<typeof fetch>(async () => { throw new TypeError('isolated H17 post-send disconnect') })
  vi.stubGlobal('fetch', transport)
  const host = document.createElement('div')
  let root = createRoot(host)
  try {
    await act(async () => root.render(createElement(DialogProvider, null, createElement(ToastProvider, null, createElement(HarnessEvalPanel)))))
    const title = [...host.querySelectorAll('h4')].find(row => row.textContent === 'H17 上下文质量对照')
    const run = title?.closest('section')?.querySelector('button')
    expect(run?.disabled).toBe(false)
    await act(async () => { run!.click() })
    await expect.poll(() => run?.textContent?.trim()).toBe('运行')
    expect(transport).toHaveBeenCalledTimes(1)
    const key = Object.keys(localStorage).find(row => row.startsWith('storyforge.h17.attempts.'))!
    const saved = JSON.parse(localStorage.getItem(key)!)
    expect(saved.attempts.map((row: { state: string }) => row.state)).toEqual(['prepared', 'unknown'])
    expect(localStorage.getItem(key)).not.toContain(config.apiKey)
    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => root.render(createElement(DialogProvider, null, createElement(ToastProvider, null, createElement(HarnessEvalPanel)))))
    expect(host.textContent).toContain('上次评测请求结果未知')
    expect(transport).toHaveBeenCalledTimes(1)
  } finally { await act(async () => root.unmount()) }
})

it('044 H17 semantic compression cannot turn a failed request into an implicit generation request', async () => {
  const unknown = new Error('isolated compression outcome unknown')
  const call = vi.fn<Parameters<typeof runContextCompressionEvalVariantV1>[0]['call']>(async () => { throw unknown })
  await expect(runContextCompressionEvalVariantV1({
    fixtures: getFixtures('development').slice(0, 1), variant: 'semantic-compression', split: 'development',
    contextTargetTokens: 900, generationMaxTokens: 1200, config, call,
  })).rejects.toBe(unknown)
  expect(call).toHaveBeenCalledTimes(1)
  expect(call.mock.calls[0][2]).toBe('compression')
})
