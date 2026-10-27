import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { prepareTtrpgOpenIntentInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { generateTtrpgOpenIntentCandidateV1, executeTtrpgOpenIntentRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { estimateTtrpgOpenRuntimeInputTokensV1, estimateTtrpgOpenRuntimeFallbackInputV1,
  estimateTtrpgOpenFrozenRuntimeInputTokensV1, TTRPG_OPEN_RUNTIME_INPUT_ESTIMATION_V1 } from '../../src/lib/ttrpg/open-runtime-wire-budget'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { canonicalStringify } from '../../src/lib/agent/run/hash'
import { estimateTokens } from '../../src/lib/ai/context-budget'
import type { ChatResult } from '../../src/lib/ai/client'
import type { ChatMessage } from '../../src/lib/types'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())
const raw = JSON.stringify({ goal: '调查河港', method: '调查', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null })
const denseInput = '核对已公开清单，标识只作资料，不取得权限：' + JSON.stringify(Array.from({ length: 100 }, (_, i) => ({
  record: 'public.record.' + i, source: 'public.original', reliability: 'unverified',
})))
async function setup(rawInput = denseInput, maximumEpochTokens = 50_000) {
  const f = await readyOpenTtrpgSessionV1('runtime conservative input', pkg => {
    pkg.ttrpg!.campaign.runtimePolicy.enabled = true
    pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = maximumEpochTokens
  })
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'input-budget.epoch'),
    viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput })
  const input = { ...await openEnvelopeV1(f.sessionId, 'input-budget.prepare'), scope: f.scope, actorKey: 'hero',
    viewerKey: OPEN_HUMAN_VIEWER, rawInput, maximumOutputTokens: 800, maximumCostUsd: 0.1 }
  return { f, input }
}

it('admits a full JSON-heavy request and a provider receipt that would exceed its old estimate, without adopting it', async () => {
  const { f, input } = await setup(), before = await readProductRuntimeState(f.sessionId)
  // Explicit transport fixture: these token counts reproduce the observed
  // native receipt class. This is not another real provider or human test.
  const runAI = vi.fn(async (_messages: ChatMessage[], _signal: AbortSignal, result: ChatResult) => {
    result.usage = { inputTokens: 10206, outputTokens: 375, totalTokens: 10581 }
    return raw
  })
  const generated = await generateTtrpgOpenIntentCandidateV1({ ...input, runAI })
  const body = JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId,
    artifactKind: 'rendered-request', contentHash: generated.prepared.reservation.requestHash }))
  const { inputEstimation, ...oldRendered } = body
  expect(estimateTokens(canonicalStringify(oldRendered))).toBeLessThan(10206)
  expect(inputEstimation).toEqual(TTRPG_OPEN_RUNTIME_INPUT_ESTIMATION_V1)
  expect(generated.prepared.reservation.reservedInputTokens).toBeGreaterThanOrEqual(10206)
  expect(generated.candidate.artifact.status).toBe('usable-with-warnings')
  const state = await readProductRuntimeState(f.sessionId), call = state.ttrpg!.openRun!.coordination.calls[0]
  expect(call.usage).toEqual({ source: 'provider', inputTokens: 10206, outputTokens: 375, actualCostUsd: null })
  expect(state.entities).toEqual(before.entities)
  expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
  const snapshot = await readInstanceAgentRunV1(f.scope, generated.prepared.runId)
  expect(snapshot.contract.budget.maxInputTokens).toBe(call.reservedInputTokens)
  expect(snapshot.events.some(e => e.type === 'runtime.candidate.adopted')).toBe(false)
  expect(runAI).toHaveBeenCalledTimes(1)
}, 30_000)

it('rejects a complete request that cannot fit the frozen epoch before creating a Run or sending', async () => {
  const { f, input } = await setup(denseInput, 10_000), before = await readProductRuntimeState(f.sessionId)
  const runAI = vi.fn(async () => raw)
  await expect(generateTtrpgOpenIntentCandidateV1({ ...input, runAI })).rejects.toThrow(/完整请求超过剩余硬预算/)
  expect(runAI).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(0)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
}, 30_000)

it('still retains a genuinely over-budget response and blocks adoption without a hidden resend', async () => {
  const { f, input } = await setup('调查河港')
  const prepared = await prepareTtrpgOpenIntentInputV1({ ...input, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
  const runAI = vi.fn(async (_messages: ChatMessage[], _signal: AbortSignal, result: ChatResult) => {
    result.usage = { inputTokens: prepared.reservation.reservedInputTokens + 1, outputTokens: 40,
      totalTokens: prepared.reservation.reservedInputTokens + 41 }
    return raw
  })
  const owner = { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER,
    runId: prepared.runId, requestKey: prepared.requestKey }
  const generated = await executeTtrpgOpenIntentRequestV1({ ...owner, runAI })
  expect(generated.status).toBe('candidate')
  if (generated.status !== 'candidate') throw Error('Expected the retained blocked candidate')
  expect(generated.candidate.artifact.status).toBe('blocked')
  expect(generated.candidate.artifact.issues.some(i => i.code === 'ttrpg-open-intent-budget')).toBe(true)
  expect(generated.candidate.artifact.originalText).toBe(raw)
  expect(await executeTtrpgOpenIntentRequestV1({ ...owner, runAI })).toEqual({ status: 'not-sent' })
  expect(runAI).toHaveBeenCalledTimes(1)
}, 30_000)

it('keeps the old reservation and fallback formulas for frozen requests without the new marker', () => {
  const old = { messages: [{ role: 'system', content: '原冻结规则' }, { role: 'user', content: '{"goal":"调查"}' }],
    modelIdentity: { provider: 'codex', model: 'original' }, contextSelection: { version: 1 } }
  const bytes = canonicalStringify(old)
  expect(estimateTtrpgOpenRuntimeInputTokensV1(old)).toBe(estimateTokens(bytes))
  expect(estimateTtrpgOpenRuntimeFallbackInputV1(old)).toBe(estimateTokens(old.messages.map(m => m.content).join('\n')))
  expect(canonicalStringify(old)).toBe(bytes)
  for (const frozen of ['legacy rendered text', JSON.stringify(old.messages), bytes]) {
    expect(estimateTtrpgOpenFrozenRuntimeInputTokensV1(frozen)).toBe(estimateTokens(frozen))
  }
  const current = { ...old, inputEstimation: TTRPG_OPEN_RUNTIME_INPUT_ESTIMATION_V1 }
  expect(estimateTtrpgOpenRuntimeFallbackInputV1(current)).toBe(estimateTtrpgOpenRuntimeInputTokensV1(current))
})

it.each([{ version: 2 }, { overheadReserveTokens: 0 }, { extraAuthority: true }])('rejects unsupported or weakened estimation metadata (%j)', change => {
  expect(() => estimateTtrpgOpenRuntimeInputTokensV1({ messages: [{ role: 'user', content: '数据' }],
    inputEstimation: { ...TTRPG_OPEN_RUNTIME_INPUT_ESTIMATION_V1, ...change } })).toThrow(/input estimation|估算/)
})
