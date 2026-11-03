import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HarnessEvalPanel from '../../src/components/settings/HarnessEvalPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { db } from '../../src/lib/db/schema'
import * as usageLog from '../../src/lib/ai/usage-log'
import { measureLongConsistencyProviderUsageV1 } from '../../src/lib/evals/long-consistency/model-usage'
import { useAIConfigStore } from '../../src/stores/ai-config'
import {
  exportH4LongConsistencyRunCheckpointV1,
  exportH4LongConsistencySealedScoreV1,
  exportH4SubtypeAdjudicationCheckpointV1,
  exportH4SubtypeAdjudicationSealedScoreV1,
  H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
  H4_LONG_CONSISTENCY_FIXTURES_V1,
  H4_SUBTYPE_ADJUDICATION_PROMPT_VERSION_V1,
  importH4LongConsistencyRunCheckpointV1,
  importH4LongConsistencySealedScoreV1,
  importH4SubtypeAdjudicationCheckpointV1,
  loadH4LongConsistencyBrowserStateV1,
  loadH4SubtypeAdjudicationBrowserStateV1,
  LONG_CONSISTENCY_CURRENT_JUDGE_PROMPT_VERSION_V1,
  persistH4LongConsistencyBrowserCheckpointV1,
  runH4LongConsistencyVerifierV1,
  runH4SubtypeAdjudicationV1,
  scoreH4LongConsistencyCheckpointV1,
  scoreH4SubtypeAdjudicationCheckpointV1,
  verifyH4SubtypeAdjudicationSealedScoreV1,
} from '../../src/lib/evals/long-consistency'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
const config = { provider: 'openai' as const, model: 'gpt-4o-mini', apiKey: 'synthetic-only',
  baseUrl: 'http://127.0.0.1:9/v1', temperature: 0, maxTokens: 6_000, contextWindow: 128_000 }
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let pendingUsage: Promise<unknown>[]

beforeEach(async () => {
  await db.delete(); await db.open()
  localStorage.clear(); sessionStorage.clear()
  useAIConfigStore.setState({ config, taskRoutes: {} })
  pendingUsage = []
  const record = usageLog.recordUsage
  vi.spyOn(usageLog, 'recordUsage').mockImplementation(input => {
    const write = record(input)
    pendingUsage.push(write)
    return write
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  await Promise.allSettled(pendingUsage)
  vi.unstubAllGlobals(); vi.restoreAllMocks()
  host.remove(); db.close()
})

async function prepareActualPausedCheckpoint() {
  const fixture = H4_LONG_CONSISTENCY_FIXTURES_V1.find(item => item.split === 'development' && item.hiddenLabels.cleanControl)
  if (!fixture) throw new Error('Missing a real clean development fixture')
  const stop = new Error('Stop after the actual initial checkpoint is saved')
  await expect(runH4LongConsistencyVerifierV1({
    runId: 'sfqa120-one-fixture', split: 'development', codeRevision: 'sfqa120-synthetic', fixtureIds: [fixture.id],
    execution: { generator: { provider: 'fixture', model: 'h4-synthetic-corpus', promptVersion: H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1 },
      verifier: { provider: config.provider, model: config.model, promptVersion: LONG_CONSISTENCY_CURRENT_JUDGE_PROMPT_VERSION_V1 } },
    maxAttemptsPerFixture: 1,
    call: async () => { throw new Error('Initial checkpoint must not make any model request') },
    onCheckpoint: async checkpoint => { await persistH4LongConsistencyBrowserCheckpointV1(checkpoint); throw stop },
  })).rejects.toBe(stop)
}

const usageCases = [
  { name: 'missing usage', providerUsage: undefined, metered: 0, input: 'estimated', output: 'estimated', total: null },
  { name: 'partial usage', providerUsage: { prompt_tokens: 200, total_tokens: 200 }, metered: 0, input: 'provider', output: 'estimated', total: 200 },
  { name: 'complete usage', providerUsage: { prompt_tokens: 200, completion_tokens: 11, total_tokens: 211 }, metered: 1, input: 'provider', output: 'provider', total: 211 },
  { name: 'explicit measured zero', providerUsage: { prompt_tokens: 200, completion_tokens: 0, total_tokens: 200 }, metered: 1, input: 'provider', output: 'provider', total: 200 },
] as const

async function clickActualRun(sectionId: string, label: string, status: () => Promise<string | undefined>) {
  await act(async () => root.render(<DialogProvider><ToastProvider><HarnessEvalPanel /></ToastProvider></DialogProvider>))
  const button = () => [...(host.querySelector(`[data-testid="${sectionId}"]`)?.querySelectorAll('button') ?? [])]
    .find(item => item.textContent?.trim() === label)
  for (let attempt = 0; (!button() || button()?.disabled) && attempt < 100; attempt += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  }
  const run = button()
  if (!run || run.disabled) throw new Error(`Expected actual ${sectionId} control: ${label}`)
  await act(async () => {
    run.click()
    await expect.poll(status, { timeout: 2500 }).toBe('completed')
  })
}

function wireTransport(output: string, providerUsage: (typeof usageCases)[number]['providerUsage']) {
  const transport = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url) !== config.baseUrl + '/chat/completions' || options?.method !== 'POST') throw new Error('Unexpected real provider request in SFQA120')
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: output }, finish_reason: 'stop' }],
      ...(providerUsage == null ? {} : { usage: providerUsage }) }), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', transport)
  return transport
}

const fixtureExecution = {
  generator: { provider: 'fixture', model: 'h4-synthetic-corpus', promptVersion: H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1 },
  verifier: { provider: config.provider, model: config.model, promptVersion: LONG_CONSISTENCY_CURRENT_JUDGE_PROMPT_VERSION_V1 },
}
const development = H4_LONG_CONSISTENCY_FIXTURES_V1.filter(item => item.split === 'development')
const positiveFixture = development.find(item => item.hiddenLabels.expectedIssues.length === 1)!
const cleanFixture = development.find(item => item.hiddenLabels.cleanControl)!
const judgeUsage = {
  inputTokens: 30, outputTokens: 10, durationMs: 1, costUsd: 0.001,
  provenance: { input: 'provider', output: 'provider', providerTotalTokens: 40, cost: 'catalog-estimate' },
} as const

async function oneFixtureDiscovery(fixture: typeof positiveFixture) {
  return await runH4LongConsistencyVerifierV1({
    runId: 'sfqa120-discovery', split: 'development', codeRevision: 'sfqa120-synthetic',
    fixtureIds: [fixture.id], execution: fixtureExecution, maxAttemptsPerFixture: 1, now: () => 0,
    call: async () => ({
      output: JSON.stringify({ schemaVersion: 1, issues: fixture.hiddenLabels.expectedIssues.map((issue, i) => ({
        ...issue, id: `isolated-${i}`, summary: '仅根据两个逐字证据判定。',
      })) }),
      usage: judgeUsage,
    }),
  })
}

describe('SFQA120 · provider metering survives signed export/import', () => {
  it.each(usageCases)('H4 $name retains provenance through the settings runner', async ({ providerUsage, metered, input, output, total }) => {
    await prepareActualPausedCheckpoint()
    const transport = wireTransport(JSON.stringify({ schemaVersion: 1, issues: [] }), providerUsage)
    await clickActualRun('h4-development-section', '继续', async () => (await loadH4LongConsistencyBrowserStateV1('development'))?.checkpoint.status)
    expect(transport).toHaveBeenCalledTimes(1)
    const state = await loadH4LongConsistencyBrowserStateV1('development')
    if (!state) throw new Error('Missing signed H4 state')
    const restored = await importH4LongConsistencyRunCheckpointV1(await exportH4LongConsistencyRunCheckpointV1(state.checkpoint))
    expect(restored).toEqual(state.checkpoint)
    const score = await scoreH4LongConsistencyCheckpointV1({ checkpoint: restored })
    expect({ metered: restored.usage.meteredModelCalls, unmetered: restored.usage.unmeteredModelCalls,
      missingGate: score.gate.failures.includes('usage-evidence-missing') }).toEqual({ metered, unmetered: 1 - metered, missingGate: metered === 0 })
    const usage = restored.completed[0].artifact.execution.verifierUsage
    expect(usage.provenance).toEqual({ input, output, providerTotalTokens: total, cost: 'catalog-estimate' })
    expect(usage.inputTokens).toBeGreaterThan(0)
    if (providerUsage && 'completion_tokens' in providerUsage) expect(usage.outputTokens).toBe(providerUsage.completion_tokens)
    else expect(usage.outputTokens).toBeGreaterThan(0)
    expect(usage.costUsd).toBeGreaterThan(0)
  })

  it.each(usageCases)('H85 $name retains provenance through the settings runner', async ({ providerUsage, metered, input, output, total }) => {
    const parent = await oneFixtureDiscovery(positiveFixture)
    expect(parent.status).toBe('completed')
    await persistH4LongConsistencyBrowserCheckpointV1(parent)
    const transport = wireTransport(JSON.stringify({ schemaVersion: 1, decisions: [{
      candidateId: 'candidate-01', verdict: 'conflict', subtype: positiveFixture.hiddenLabels.expectedIssues[0].subtype,
      reason: '两个逐字证据满足操作定义。',
    }] }), providerUsage)
    await clickActualRun('h85-development-section', '运行判类', async () => (await loadH4SubtypeAdjudicationBrowserStateV1('development'))?.checkpoint.status)
    expect(transport).toHaveBeenCalledTimes(1)
    const state = await loadH4SubtypeAdjudicationBrowserStateV1('development')
    if (!state) throw new Error('Missing signed H85 state')
    const restored = await importH4SubtypeAdjudicationCheckpointV1(await exportH4SubtypeAdjudicationCheckpointV1(state.checkpoint))
    expect(restored).toEqual(state.checkpoint)
    expect(restored.calls[0].usage?.provenance).toEqual({ input, output, providerTotalTokens: total, cost: 'catalog-estimate' })
    expect(restored.completed[0].artifact.call?.usage).toEqual(restored.calls[0].usage)
    const score = await scoreH4SubtypeAdjudicationCheckpointV1({ checkpoint: restored })
    expect(score.usage.discovery).toMatchObject({ meteredModelCalls: 1, unmeteredModelCalls: 0 })
    expect(score.usage.adjudication).toMatchObject({ meteredModelCalls: metered, unmeteredModelCalls: 1 - metered })
    expect(score.gate.failures.includes('usage-evidence-missing')).toBe(metered === 0)
    await expect(verifyH4SubtypeAdjudicationSealedScoreV1(
      JSON.parse(await exportH4SubtypeAdjudicationSealedScoreV1(score, restored)), restored,
    )).resolves.toBe(true)
  })

  it('round-trips a closed historical H4 checkpoint and score without trusting them in a new gate', async () => {
    const modern = await oneFixtureDiscovery(cleanFixture)
    const { usagePolicy: _policy, checkpointHash: _checkpointHash, ...oldBody } = modern
    const { artifactHash: _artifactHash, ...oldArtifactBody } = oldBody.completed[0].artifact
    const { provenance: _provenance, ...oldUsage } = oldArtifactBody.execution.verifierUsage
    oldArtifactBody.execution = { ...oldArtifactBody.execution, verifierUsage: oldUsage }
    oldBody.completed = [{ ...oldBody.completed[0], artifact: { ...oldArtifactBody, artifactHash: await hashCanonicalValue(oldArtifactBody) } }]
    const legacy = { ...oldBody, checkpointHash: await hashCanonicalValue(oldBody) }
    const restored = await importH4LongConsistencyRunCheckpointV1(await exportH4LongConsistencyRunCheckpointV1(legacy))
    expect(restored).toEqual(legacy)
    expect(restored.usage).toMatchObject({ meteredModelCalls: 1, unmeteredModelCalls: 0 })
    const current = await scoreH4LongConsistencyCheckpointV1({ checkpoint: restored })
    expect(current.usage).toMatchObject({ meteredModelCalls: 0, unmeteredModelCalls: 1 })
    expect(current.gate.failures).toContain('usage-evidence-missing')
    const { scoreHash: _scoreHash, usagePolicy: _scorePolicy, ...oldScoreBody } = current
    oldScoreBody.usage = legacy.usage
    oldScoreBody.gate.failures = oldScoreBody.gate.failures.filter(failure => failure !== 'usage-evidence-missing')
    oldScoreBody.gate.passed = oldScoreBody.gate.failures.length === 0
    const historical = { ...oldScoreBody, scoreHash: await hashCanonicalValue(oldScoreBody) }
    const roundTrip = await importH4LongConsistencySealedScoreV1(
      await exportH4LongConsistencySealedScoreV1(historical, restored), restored,
    )
    expect(roundTrip).toEqual(historical)
    expect(roundTrip).not.toHaveProperty('usagePolicy')

    const modernAdjudication = await runH4SubtypeAdjudicationV1({
      runId: 'sfqa120-old-h85', codeRevision: 'sfqa120-synthetic', baseCheckpoint: restored,
      adjudicator: { ...fixtureExecution.verifier, promptVersion: H4_SUBTYPE_ADJUDICATION_PROMPT_VERSION_V1 },
      call: async () => { throw new Error('Zero-candidate fixture must not call the adjudicator') },
      now: () => 0,
    })
    expect(modernAdjudication.calls).toHaveLength(0)
    const { usagePolicy: _h85Policy, checkpointHash: _h85Hash, ...oldAdjudicationBody } = modernAdjudication
    const legacyH85 = { ...oldAdjudicationBody, checkpointHash: await hashCanonicalValue(oldAdjudicationBody) }
    const h85 = await importH4SubtypeAdjudicationCheckpointV1(await exportH4SubtypeAdjudicationCheckpointV1(legacyH85))
    expect(h85).toEqual(legacyH85)
    const currentH85 = await scoreH4SubtypeAdjudicationCheckpointV1({ checkpoint: h85 })
    expect(currentH85.usage.total.unmeteredModelCalls).toBe(1)
    expect(currentH85.gate.failures).toContain('usage-evidence-missing')
    const { scoreHash: _h85ScoreHash, usagePolicy: _h85ScorePolicy, ...oldH85ScoreBody } = currentH85
    oldH85ScoreBody.usage.discovery = restored.usage
    oldH85ScoreBody.usage.total = restored.usage
    oldH85ScoreBody.gate.failures = oldH85ScoreBody.gate.failures.filter(failure => failure !== 'usage-evidence-missing')
    oldH85ScoreBody.gate.passed = oldH85ScoreBody.gate.failures.length === 0
    const historicalH85 = { ...oldH85ScoreBody, scoreHash: await hashCanonicalValue(oldH85ScoreBody) }
    await expect(verifyH4SubtypeAdjudicationSealedScoreV1(
      JSON.parse(await exportH4SubtypeAdjudicationSealedScoreV1(historicalH85, h85)), h85,
    )).resolves.toBe(true)
  })

  it('preserves unknown pricing and stops on estimated budget without claiming provider evidence', async () => {
    const run = await runH4LongConsistencyVerifierV1({
      runId: 'sfqa120-estimated-budget', split: 'development', codeRevision: 'sfqa120-synthetic',
      fixtureIds: [cleanFixture.id], execution: fixtureExecution, maxAttemptsPerFixture: 1,
      budget: { maxInputTokens: 1 },
      call: async ({ messages }) => {
        const output = JSON.stringify({ schemaVersion: 1, issues: [] })
        const usage = measureLongConsistencyProviderUsageV1({ messages, output, durationMs: 1,
          config: { provider: 'custom', model: 'isolated-unknown-price' } })
        return { output, usage }
      },
    })
    const restored = await importH4LongConsistencyRunCheckpointV1(await exportH4LongConsistencyRunCheckpointV1(run))
    expect(restored.status).toBe('budget-exhausted')
    expect(restored.usage).toMatchObject({ meteredModelCalls: 0, unmeteredModelCalls: 1 })
    expect(restored.usage.inputTokens).toBeGreaterThan(1)
    expect(restored.usage.costUsd).toBeGreaterThan(0)
    expect(restored.completed[0].artifact.execution.verifierUsage.provenance).toMatchObject({
      input: 'estimated', output: 'estimated', providerTotalTokens: null, cost: 'fallback-estimate',
    })
    const score = await scoreH4LongConsistencyCheckpointV1({ checkpoint: restored })
    expect(score.gate.failures).toEqual(expect.arrayContaining(['budget-exceeded', 'usage-evidence-missing']))
    const { checkpointHash: _hash, ...forged } = structuredClone(restored)
    forged.usage.meteredModelCalls = 1
    forged.usage.unmeteredModelCalls = 0
    await expect(importH4LongConsistencyRunCheckpointV1(JSON.stringify({
      ...forged, checkpointHash: await hashCanonicalValue(forged),
    }))).rejects.toThrow('完整性验证失败')
  })
})
