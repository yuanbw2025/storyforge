import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TextOpenWorldCreatorProductionReadiness } from '../../src/components/text-game/TextOpenWorldCreatorProductionReadiness'
import { db } from '../../src/lib/db/schema'
import {
  applyTextOpenWorldCreatorBriefSynthesisV1,
  confirmTextOpenWorldCreatorBriefV1,
  generateTextOpenWorldCreatorBriefCandidateV1,
  readTextOpenWorldCreatorConsultationUsageV1,
  recoverLatestTextOpenWorldCreatorBriefSessionV1,
  startTextOpenWorldCreatorBriefSessionV1,
  type TextOpenWorldCreatorBriefSessionV1,
} from '../../src/lib/open-world/creator-brief'
import { inspectTextOpenWorldCreatorWorldSourceV1 } from '../../src/lib/open-world/creator-source'
import type { AIConfig } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

const config: AIConfig = {
  provider: 'openai', apiKey: 'synthetic-sfqa089-fixture-only', model: 'gpt-4o-mini',
  baseUrl: 'https://sfqa089-fixture.invalid/v1', maxTokens: 2_000, contextWindow: 128_000, temperature: 0.2,
}
const acknowledgements = {
  sourceIdentityReviewed: true, productBoundaryReviewed: true,
  unresolvedItemsClosed: true, directPublishWorkflowReviewed: true,
} as const
const suggestion = JSON.stringify({
  suggestedTitle: '潮汐边界',
  understandingSummary: '作者希望以受保护的顺序主线承载成长，并用地区故事填充探索。',
  playerFantasy: '成为能够穿行多地、逐步揭开核心冲突的冒险者。',
  experiencePromise: '清晰主线与丰富但有边界的地区冒险并行。',
  primaryConflict: '长期目标与持续变化的地区问题互相牵引。',
  recommendedOpening: '从港区的失踪调查开始第一项明确任务。',
  protagonistFit: '作者设定的主角需要拥有进入调查和持续成长的动机。',
  experiencePillars: ['长期主线成长', '地区故事探索'],
  sourceUsePlan: ['只把已给来源摘要作为定位，正文留待正式冻结阶段读取。'],
  unresolvedQuestions: [], assumptions: ['首版使用标准难度。'], risks: ['没有足够的具体人物事实。'],
})

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let priorConfig: Pick<ReturnType<typeof useAIConfigStore.getState>, 'config' | 'rememberApiKey'>

beforeEach(async () => {
  await db.delete()
  await db.open()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const { config: old, rememberApiKey } = useAIConfigStore.getState()
  priorConfig = { config: old, rememberApiKey }
  useAIConfigStore.getState().setRememberApiKey(false)
  useAIConfigStore.getState().setConfig(config)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useAIConfigStore.setState(priorConfig)
  vi.unstubAllGlobals()
  db.close()
})

function syntheticProvider(outputs: { content: string; input: number; output: number }[]) {
  const fetch = vi.fn(async (request: string | URL | Request) => {
    const url = typeof request === 'string' || request instanceof URL ? String(request) : request.url
    const entry = outputs[fetch.mock.calls.length - 1]
    if (url !== 'https://sfqa089-fixture.invalid/v1/chat/completions' || !entry) throw Error(`未授权的测试网络访问：${url}`)
    return new Response(JSON.stringify({
      id: `sfqa089-synthetic-${fetch.mock.calls.length}`,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: entry.content } }],
      usage: { prompt_tokens: entry.input, completion_tokens: entry.output, total_tokens: entry.input + entry.output },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function start(label: string) {
  const owned = await seedCurrentProductWorld(`089 ${label} ${crypto.randomUUID()}`)
  const preview = await inspectTextOpenWorldCreatorWorldSourceV1({
    scope: owned.scope, localReleaseRecordId: owned.release.id!, expectedReleaseHash: owned.release.contentHash,
  })
  return startTextOpenWorldCreatorBriefSessionV1({
    selection: {
      sourceKind: 'world-release', sourceScope: owned.scope, localReleaseRecordId: owned.release.id!,
      expectedReleaseHash: owned.release.contentHash, preview,
    },
    sessionKey: `089-${label}`,
  })
}

async function readiness(session: TextOpenWorldCreatorBriefSessionV1) {
  await act(async () => {
    root.render(createElement(TextOpenWorldCreatorProductionReadiness, {
      session, onBack: vi.fn(), onConfirmed: vi.fn(),
    }))
  })
  const panel = () => host.querySelector('[aria-labelledby="tow-usage-heading"]')
  for (let i = 0; (!panel() || panel()?.textContent?.includes('正在核验')) && i < 200; i += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  }
  if (!panel()) throw Error(`真实准备页用量区未渲染：${host.textContent}`)
  return panel()!
}

it.each([
  { input: 113, output: 17, amount: '<$0.0001' },
  { input: 0, output: 0, amount: '$0.0000' },
])('preserves the paid consultation ($input/$output) when formal confirmation changes the candidate hash', async ({ input, output, amount }) => {
  const fetch = syntheticProvider([{ content: suggestion, input, output }])
  const begun = await start('direct')
  const suggested = await generateTextOpenWorldCreatorBriefCandidateV1({ session: begun, draft: begun.draft, aiConfig: config })
  expect(suggested.candidate?.modelCalls).toMatchObject([{ inputTokens: input, outputTokens: output, usageSource: 'provider' }])
  const confirmed = await confirmTextOpenWorldCreatorBriefV1({ session: suggested, draft: suggested.draft, acknowledgements })
  expect(confirmed.confirmedBrief?.candidateEvidence.origin).toBe('ai')
  expect(confirmed.confirmedBrief?.candidateEvidence.candidateHash).not.toBe(suggested.candidate?.candidateHash)
  expect(fetch).toHaveBeenCalledTimes(1)
  const panel = await readiness(confirmed)
  expect(panel.textContent).toContain('1 次')
  expect(panel.textContent).toContain(`${input} / ${output}`)
  expect(panel.textContent).toContain(`按已知价格估算${amount}`)
  expect(panel.textContent).not.toContain('没有发生模型调用或费用')
  expect(fetch).toHaveBeenCalledTimes(1)
}, 60_000)

it('continues to report zero for a truly manual consultation', async () => {
  const fetch = syntheticProvider([])
  const begun = await start('manual')
  const confirmed = await confirmTextOpenWorldCreatorBriefV1({ session: begun, draft: begun.draft, acknowledgements })
  expect(confirmed.confirmedBrief?.candidateEvidence.origin).toBe('author')
  const panel = await readiness(confirmed)
  expect(panel.textContent).toContain('没有发生模型调用或费用')
  expect(fetch).not.toHaveBeenCalled()
}, 60_000)


it('counts earlier rounds and a bounded repair once, after adopting, editing and refreshing', async () => {
  const fetch = syntheticProvider([
    { content: suggestion, input: 120, output: 21 },
    { content: '无效 JSON', input: 130, output: 22 },
    { content: suggestion, input: 140, output: 23 },
  ])
  const begun = await start('multiple')
  const first = await generateTextOpenWorldCreatorBriefCandidateV1({ session: begun, draft: begun.draft, aiConfig: config })
  const second = await generateTextOpenWorldCreatorBriefCandidateV1({
    session: first, draft: first.draft, followUp: '增加明确的盐港开场。', aiConfig: config,
  })
  expect(second.candidate?.repairApplied).toBe(true)
  const adopted = applyTextOpenWorldCreatorBriefSynthesisV1(second.draft, second.candidate!.synthesis)
  const confirmed = await confirmTextOpenWorldCreatorBriefV1({
    session: second, draft: { ...adopted, gameTitle: '潮汐边界：作者修订' }, acknowledgements,
  })
  expect(confirmed.confirmedBrief?.draft.gameTitle).toBe('潮汐边界：作者修订')
  expect(confirmed.confirmedBrief?.candidateEvidence.candidateHash).not.toBe(second.candidate!.candidateHash)
  const durable = async () => Promise.all([
    db.agentRuns.toArray(), db.agentRunEvents.toArray(), db.agentRunArtifacts.toArray(),
    db.aiUsageLog.toArray(), db.productProductionBriefs.toArray(),
  ])
  const before = await durable()
  const panel = await readiness(confirmed)
  expect(panel.textContent).toContain('3 次')
  expect(panel.textContent).toContain('390 / 66')
  expect(panel.textContent).toContain('本次确认关联 2 次')
  const recovered = await recoverLatestTextOpenWorldCreatorBriefSessionV1([confirmed.scope])
  expect(recovered?.confirmedBrief?.briefHash).toBe(confirmed.confirmedBrief?.briefHash)
  const rendered = panel.textContent
  expect((await readiness(recovered!)).textContent).toBe(rendered)
  const usage = await readTextOpenWorldCreatorConsultationUsageV1(recovered!)
  expect(usage.calls.map(call => [call.runId, call.attempt])).toEqual([
    [first.candidateRunId, 1], [second.candidateRunId, 1], [second.candidateRunId, 2],
  ])
  expect(await durable()).toEqual(before)
  expect(fetch).toHaveBeenCalledTimes(3)
}, 60_000)

it('keeps paid suggestions when the author confirms without selecting that candidate, including unknown price', async () => {
  const fetch = syntheticProvider([{ content: suggestion, input: 111, output: 13 }])
  const begun = await start('ignored')
  await generateTextOpenWorldCreatorBriefCandidateV1({
    session: begun, draft: begun.draft, aiConfig: { ...config, model: 'synthetic-unknown-price-model' },
  })
  const confirmed = await confirmTextOpenWorldCreatorBriefV1({
    session: begun, draft: { ...begun.draft, gameTitle: '作者独立确认的标题' }, acknowledgements,
  })
  expect(confirmed.confirmedBrief?.candidateEvidence.origin).toBe('author')
  const panel = await readiness(confirmed)
  expect(panel.textContent).toContain('1 次')
  expect(panel.textContent).toContain('111 / 13')
  expect(panel.textContent).toContain('按已知价格估算未知')
  expect(panel.textContent).toContain('本次由作者整理确认，之前的会谈用量仍计入')
  const other = await startTextOpenWorldCreatorBriefSessionV1({ selection: begun.selection!, sessionKey: '089-same-work-separate-production' })
  expect(other.scope).toEqual(begun.scope)
  await expect(readTextOpenWorldCreatorConsultationUsageV1({ ...confirmed, conversation: other.conversation }))
    .rejects.toThrow(/来源绑定不一致/)
  expect(fetch).toHaveBeenCalledTimes(1)
}, 60_000)

it('recovers actual responses from a rejected consultation that produced no candidate', async () => {
  const fetch = syntheticProvider([
    { content: '仍然不是 JSON', input: 81, output: 11 },
    { content: '第二次也不是 JSON', input: 70, output: 12 },
  ])
  const begun = await start('no-candidate')
  await expect(generateTextOpenWorldCreatorBriefCandidateV1({ session: begun, draft: begun.draft, aiConfig: config })).rejects.toThrow()
  const confirmed = await confirmTextOpenWorldCreatorBriefV1({ session: begun, draft: begun.draft, acknowledgements })
  expect(confirmed.candidate).toBeNull()
  expect(confirmed.confirmedBrief?.candidateEvidence.origin).toBe('author')
  const panel = await readiness(confirmed)
  expect(panel.textContent).toContain('2 次')
  expect(panel.textContent).toContain('151 / 23')
  expect(panel.textContent).toContain('按已知价格估算未知')
  expect(fetch).toHaveBeenCalledTimes(2)
}, 60_000)

it('reports an unproved dispatch as unknown instead of claiming either a call or zero usage', async () => {
  const fetch = syntheticProvider([])
  const begun = await start('unknown-dispatch')
  await expect(generateTextOpenWorldCreatorBriefCandidateV1({
    session: begun, draft: begun.draft, runAI: async () => { throw Error('synthetic adapter supplied no transport evidence') },
  })).rejects.toThrow()
  const confirmed = await confirmTextOpenWorldCreatorBriefV1({ session: begun, draft: begun.draft, acknowledgements })
  const usage = await readTextOpenWorldCreatorConsultationUsageV1(confirmed)
  expect(usage).toMatchObject({ calls: [], unresolvedRequests: 1, confirmedOrigin: 'author', confirmedCalls: 0 })
  const panel = await readiness(confirmed)
  expect(panel.textContent).toContain('1 次请求的发送状态未核验')
  expect(panel.textContent).toContain('输入 / 输出未知 / 未知')
  expect(panel.textContent).toContain('按已知价格估算未知')
  expect(panel.textContent).not.toContain('没有发生模型调用或费用')
  expect(fetch).not.toHaveBeenCalled()
}, 60_000)

it('holds the original conversation and confirmation across the actual Brief read', async () => {
  const fetch = syntheticProvider([{ content: suggestion, input: 133, output: 37 }])
  const begun = await start('barrier-a')
  const other = await startTextOpenWorldCreatorBriefSessionV1({
    selection: begun.selection!, sessionKey: '089-barrier-b',
  })
  const generated = await generateTextOpenWorldCreatorBriefCandidateV1({ session: other, draft: other.draft, aiConfig: config })
  const confirmed = await confirmTextOpenWorldCreatorBriefV1({ session: begun, draft: begun.draft, acknowledgements })
  expect(other.scope).toEqual(confirmed.scope)
  expect(other.production.id).not.toBe(confirmed.production.id)
  expect(other.conversation.id).not.toBe(confirmed.conversation.id)
  const caller = structuredClone(confirmed)
  let changed = false
  const afterSourceValidated = (row: unknown) => {
    if (!changed) {
      changed = true
      caller.conversation = other.conversation
    }
    return row
  }
  db.productProductionBriefs.hook('reading', afterSourceValidated)
  try {
    const result = await readTextOpenWorldCreatorConsultationUsageV1(caller)
    expect(changed).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ calls: [], unresolvedRequests: 0, confirmedOrigin: 'author', confirmedCalls: 0 })
  } finally {
    db.productProductionBriefs.hook('reading').unsubscribe(afterSourceValidated)
  }
  expect((await readTextOpenWorldCreatorConsultationUsageV1(generated)).calls).toMatchObject([
    { runId: generated.candidateRunId, attempt: 1, inputTokens: 133, outputTokens: 37 },
  ])
}, 60_000)
