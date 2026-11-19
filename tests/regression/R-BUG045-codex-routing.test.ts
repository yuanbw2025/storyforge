import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { AIConfig, CodexCategory } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { estimateTokens } from '../../src/lib/ai/context-budget'
import { estimateChatRequestOptionsTokens } from '../../src/lib/ai/client'
import * as codexAdapter from '../../src/lib/ai/adapters/structured-extract-adapter'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { adoptCodexExtractionCandidateV1, generateCodexExtractionCandidateV1, readRecoverableCodexExtractionV1, resumeCodexExtractionCandidateV1 } from '../../src/lib/agent/run/codex-extraction-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'

const agnes: AIConfig = { provider: 'agnes', model: 'agnes-2.5-flash', baseUrl: 'https://apihub.agnes-ai.com/v1', apiKey: 'synthetic-agnes-045', temperature: 0.7, maxTokens: 0 }
const gemini: AIConfig = { provider: 'gemini', model: 'gemini-3.5-flash-lite', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'synthetic-gemini-045', temperature: 0.7, maxTokens: 0 }
const sourceText = '月栖花生于月潮湿地，只在退潮后成熟。'
const raw = JSON.stringify([{ name: '月栖花', icon: '🌱', summary: '生于月潮湿地。', description: '只在退潮后成熟。',
  fields: {}, tags: [], importance: 2, evidenceQuotes: ['月栖花生于月潮湿地'], provenance: 'verbatim-extraction' }])

async function seed(global: AIConfig, routed: AIConfig) {
  useAIConfigStore.setState({ config: global, presets: [{ id: '045-route', name: '合成路由', config: routed }], taskRoutes: { extraction: '045-route' } })
  const { scope } = await seedCurrentWorkspace('045 隔离拆分')
  const now = Date.now()
  const category: CodexCategory & { worldId: number; worldGroupId: null } = { projectId: scope.projectId, worldId: scope.worldId, domain: 'natural',
    parentId: null, name: '灵植草药', icon: '🌿', builtInKey: 'herb', fieldSchema: '[]', hidden: false,
    order: 0, worldGroupId: null, createdAt: now, updatedAt: now }
  const categoryId = await db.codexCategories.add(category)
  await stampCurrentFixtureResourceUidsV1(scope.projectId)
  return { scope, aiConfig: global, request: { categoryId, worldGroupId: null, sourceText, supplementTags: false } }
}
function transport(status = 200, failure?: Error, answer = raw, inputLimit = 32_768, bodyFailure?: Error) {
  const posts: Array<{ url: string; body: Record<string, any> }> = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'GET') return new Response(JSON.stringify({ name: `models/${gemini.model}`, inputTokenLimit: inputLimit, outputTokenLimit: 8_192 }))
    posts.push({ url, body: JSON.parse(init?.body as string) })
    if (failure) throw failure
    if (bodyFailure) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"choices":['))
      queueMicrotask(() => controller.error(bodyFailure))
    } }), { status: 200 })
    return new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] })
      : JSON.stringify({ error: { message: `do-not-display:${agnes.apiKey}:${sourceText}` } }), { status })
  })
  vi.stubGlobal('fetch', fetch)
  return { posts, fetch }
}
beforeEach(async () => { await db.delete(); await db.open(); resetModelCapacityForTestsV1() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('045 actual routed extraction request', () => {
  it('admits the existing 5200-CJK chunk plus actual baseline/schema within the approved bound, without adding or trimming chunks', async () => {
    const fixture = await seed(gemini, agnes), wire = transport(200, undefined, '[]')
    const generated = await generateCodexExtractionCandidateV1({ ...fixture, request: { ...fixture.request,
      sourceText: sourceText + '潮'.repeat(5200 - sourceText.length) } })
    const binding = generated.candidate.plan.requestBinding!
    const estimate = estimateTokens(JSON.stringify(wire.posts[0].body.messages))
      + estimateChatRequestOptionsTokens(binding.responseOptions ?? undefined)
    expect(estimate).toBeGreaterThan(8000); expect(estimate).toBeLessThan(binding.inputBudgetTokens)
    expect(binding.inputBudgetTokens).toBe(32_000)
    expect(generated.candidate.plan.chunks.length).toBe(wire.posts.length)
    expect(generated.snapshot.contract.budget.maxModelCalls).toBe(wire.posts.length)
    expect(generated.snapshot.contract.budget.maxOutputTokens).toBe(wire.posts.length * 4000)
  })

  it('refuses a small actual model input budget before POST and preserves original input', async () => {
    const fixture = await seed(agnes, gemini), wire = transport(200, undefined, raw, 512)
    await expect(generateCodexExtractionCandidateV1(fixture)).rejects.toThrow('超出本轮冻结预算')
    expect(wire.posts).toHaveLength(0)
    const row = (await db.agentRuns.toArray())[0], state = await readAgentRunV1(fixture.scope, row.id!)
    expect(state.contract.budget.maxInputTokens).toBeLessThan(512)
    expect(state.projection.state).toBe('failed')
    expect(state.events.some(event => event.type === 'model.requested')).toBe(false)
  })

  it('refuses an envelope above 32k before dispatch without truncating source or schema', async () => {
    const fixture = await seed(gemini, agnes), wire = transport()
    vi.spyOn(codexAdapter, 'buildCodexExtractPromptFromRegisteredContextV1').mockReturnValue([{ role: 'user', content: '合成超限外壳'.repeat(5000) }])
    await expect(generateCodexExtractionCandidateV1(fixture)).rejects.toThrow('超出本轮冻结预算')
    expect(wire.posts).toHaveLength(0)
    const row = (await db.agentRuns.toArray())[0], state = await readAgentRunV1(fixture.scope, row.id!)
    expect(state.contract.budget.maxInputTokens).toBe(32_000)
    expect(state.events.some(event => event.type === 'model.requested')).toBe(false)
  })

  it.each([{ global: agnes, routed: gemini }, { global: gemini, routed: agnes }])('binds $global.provider → $routed.provider before choosing transport, budget and evidence', async ({ global, routed }) => {
    const fixture = await seed(global, routed), wire = transport()
    const generated = await generateCodexExtractionCandidateV1(fixture)
    expect(wire.posts).toHaveLength(1)
    const { body, url } = wire.posts[0]
    expect(url).toContain(routed.baseUrl); expect(body.model).toBe(routed.model)
    if (routed.provider === 'agnes') {
      expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { schema: { type: 'array' } } })
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
    } else {
      expect(body.response_format).toBeUndefined(); expect(body.chat_template_kwargs).toBeUndefined()
    }
    const binding = (generated.candidate.plan as any).requestBinding
    expect(binding.settings).toMatchObject({ provider: routed.provider, model: routed.model, requested: { maxTokens: 4000 } })
    expect(binding.outputBudgetTokens).toBe(body.max_tokens)
    expect(generated.snapshot.contract.runtimeBindingHash).toBe(binding.bindingHash)
    expect(generated.snapshot.contract.budget.maxOutputTokens).toBe(body.max_tokens)
    expect(JSON.stringify(generated.candidate.plan)).not.toContain(global.apiKey)
    expect(JSON.stringify(generated.candidate.plan)).not.toContain(routed.apiKey)
    expect(await db.codexEntries.count()).toBe(0)
    const adopted = await adoptCodexExtractionCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0] })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.snapshot.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await db.codexEntries.count()).toBe(1); expect(wire.posts).toHaveLength(1)
  })

  it('binds a missing routed key to the pre-dispatch fallback, never a post-400 retry', async () => {
    const fixture = await seed(agnes, { ...gemini, apiKey: '' }), wire = transport()
    const generated = await generateCodexExtractionCandidateV1(fixture)
    expect(wire.posts).toHaveLength(1); expect(wire.posts[0].body.model).toBe(agnes.model)
    expect((generated.candidate.plan as any).requestBinding).toMatchObject({ fallbackReason: 'missing-api-key', presetId: null, settings: { provider: 'agnes' } })
  })

  it('terminalizes observed HTTP 400 safely and cannot resume it with another POST', async () => {
    const fixture = await seed(agnes, gemini), wire = transport(400)
    let failure: unknown
    try { await generateCodexExtractionCandidateV1(fixture) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('HTTP 400')
    expect((failure as Error).message).not.toContain(agnes.apiKey)
    expect((failure as Error).message).not.toContain(sourceText)
    const row = (await db.agentRuns.toArray())[0], snapshot = await readAgentRunV1(fixture.scope, row.id!)
    expect(snapshot.projection.state).toBe('failed')
    expect(snapshot.events.some(event => event.type === 'run.paused' && event.payload.reason.includes('outcome-unknown'))).toBe(false)
    expect(await readRecoverableCodexExtractionV1({ scope: fixture.scope })).toBeNull()
    await expect(resumeCodexExtractionCandidateV1({ scope: fixture.scope, runId: row.id!, aiConfig: agnes })).rejects.toThrow()
    expect(wire.posts).toHaveLength(1); expect(await db.codexEntries.count()).toBe(0)
  })

  it.each(['route', 'key', 'base', 'model', 'temperature'])('refuses changed %s after async preparation and immediately before the first POST', async change => {
    const fixture = await seed(agnes, gemini), wire = transport()
    await expect(generateCodexExtractionCandidateV1({ ...fixture, onDurableBoundary: boundary => {
      if (boundary !== 'plan.checkpoint') return
      if (change === 'route') useAIConfigStore.setState({ taskRoutes: {} })
      else useAIConfigStore.setState({ presets: [{ id: '045-route', name: '合成路由', config: { ...gemini,
        ...(change === 'key' ? { apiKey: 'synthetic-new-key-045' } : change === 'base' ? { baseUrl: 'https://other.invalid/v1' }
          : change === 'model' ? { model: 'changed-model' } : { temperature: 0.2 }) } }] })
    } })).rejects.toThrow('模型路由或请求配置已变化')
    expect(wire.posts).toHaveLength(0)
    const row = (await db.agentRuns.toArray())[0], state = await readAgentRunV1(fixture.scope, row.id!)
    expect(state.projection.state).toBe('paused')
    expect(state.events.some(event => event.type === 'model.requested')).toBe(false)
    expect((await readRecoverableCodexExtractionV1({ scope: fixture.scope }))?.safeToResume).toBe(false)
  })

  it('uses the actual routed bounded output consistently in wire, description and contract', async () => {
    const fixture = await seed(agnes, { ...gemini, maxTokens: 512 }), wire = transport()
    const generated = await generateCodexExtractionCandidateV1(fixture)
    const binding = generated.candidate.plan.requestBinding!
    expect(wire.posts[0].body.max_tokens).toBe(512)
    expect(binding.settings.parameters.max_tokens).toBe(512)
    expect(binding.settings.modelCapacity?.model).toBe(gemini.model)
    expect(binding.outputBudgetTokens).toBe(512)
    expect(generated.snapshot.contract.budget.maxInputTokens).toBe(binding.inputBudgetTokens)
    expect(generated.snapshot.contract.budget.maxOutputTokens).toBe(512)
  })

  it.each([401, 402, 429])('does not retry observed HTTP %s or expose the provider body', async status => {
    const fixture = await seed(agnes, gemini), wire = transport(status)
    await expect(generateCodexExtractionCandidateV1(fixture)).rejects.toThrow(`HTTP ${status}`)
    const row = (await db.agentRuns.toArray())[0], state = await readAgentRunV1(fixture.scope, row.id!)
    expect(state.projection.state).toBe('failed'); expect(wire.posts).toHaveLength(1)
    expect(JSON.stringify(state.events)).not.toContain('do-not-display')
    expect(await db.codexEntries.count()).toBe(0)
  })

  it('pauses a disconnected outcome with no automatic resume or raw error disclosure', async () => {
    const fixture = await seed(agnes, gemini), wire = transport(200, new TypeError(`private:${agnes.apiKey}:${sourceText}`))
    await expect(generateCodexExtractionCandidateV1(fixture)).rejects.toThrow('结果未知')
    const row = (await db.agentRuns.toArray())[0], state = await readAgentRunV1(fixture.scope, row.id!)
    expect(state.projection.state).toBe('paused')
    await expect(resumeCodexExtractionCandidateV1({ scope: fixture.scope, runId: row.id!, aiConfig: agnes })).rejects.toThrow('不可判定窗口')
    expect(wire.posts).toHaveLength(1); expect(await db.codexEntries.count()).toBe(0)
  })

  it.each([408, 500, 502, 504])('keeps observed HTTP %s upstream outcome unknown, without another POST on recovery', async status => {
    const fixture = await seed(agnes, gemini), wire = transport(status)
    await expect(generateCodexExtractionCandidateV1(fixture)).rejects.toThrow(`HTTP ${status}，但上游结果未知`)
    const row = (await db.agentRuns.toArray())[0], state = await readAgentRunV1(fixture.scope, row.id!)
    expect(state.projection.state).toBe('paused')
    expect(state.events.some(event => event.type === 'run.paused' && event.payload.reason === 'codex-extraction-model-outcome-unknown')).toBe(true)
    expect(state.events.some(event => event.type === 'run.failed')).toBe(false)
    const observation = state.events.find((event): event is Extract<(typeof state.events)[number], { type: 'evidence.artifact.recorded' }> => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'tool-result')!
    const stored = JSON.parse(await readAgentRunArtifactExactV1({ projectId: fixture.scope.projectId,
      artifactKind: 'tool-result', contentHash: observation.payload.contentHash }))
    expect(stored.observation.requestLifecycle).toMatchObject({ phase: 'response-observed', responseStatus: status })
    await expect(resumeCodexExtractionCandidateV1({ scope: fixture.scope, runId: row.id!, aiConfig: agnes })).rejects.toThrow('不可判定窗口')
    expect(wire.posts).toHaveLength(1); expect(await db.codexEntries.count()).toBe(0)
  })

  it.each([new TypeError('synthetic-partial-body'), new DOMException('synthetic-body-abort', 'AbortError')])('does not mistake HTTP200 headers with interrupted body for a complete rejected response: $name', async bodyFailure => {
    const fixture = await seed(agnes, gemini), wire = transport(200, undefined, raw, 32_768, bodyFailure)
    await expect(generateCodexExtractionCandidateV1(fixture)).rejects.toThrow('HTTP 200，但上游结果未知')
    const row = (await db.agentRuns.toArray())[0], state = await readAgentRunV1(fixture.scope, row.id!)
    expect(state.projection.state).toBe('paused')
    expect(state.events.some(event => event.type === 'run.failed')).toBe(false)
    await expect(resumeCodexExtractionCandidateV1({ scope: fixture.scope, runId: row.id!, aiConfig: agnes })).rejects.toThrow('不可判定窗口')
    expect(wire.posts).toHaveLength(1); expect(await db.codexEntries.count()).toBe(0)
  })

  it.each(['', '[{"secret":"invalid-local-fields"}]'])('retains observed no-candidate evidence and never retries HTTP 200 output %j', async answer => {
    const fixture = await seed(agnes, gemini), wire = transport(200, undefined, answer)
    await expect(generateCodexExtractionCandidateV1(fixture)).rejects.toThrow()
    const row = (await db.agentRuns.toArray())[0], state = await readAgentRunV1(fixture.scope, row.id!)
    expect(state.projection.state).toBe('failed'); expect(wire.posts).toHaveLength(1)
    expect(state.events.some(event => event.type === 'run.paused')).toBe(false)
    const artifacts = state.events.filter(event => event.type === 'evidence.artifact.recorded')
    expect(artifacts.some(event => event.payload.artifactKind === 'tool-result')).toBe(true)
    if (answer) {
      const original = artifacts.find(event => event.payload.artifactKind === 'raw-response')!
      const saved = JSON.parse(await readAgentRunArtifactExactV1({ projectId: fixture.scope.projectId,
        artifactKind: 'raw-response', contentHash: original.payload.contentHash }))
      expect(saved.raw).toBe(answer)
    }
    await expect(resumeCodexExtractionCandidateV1({ scope: fixture.scope, runId: row.id!, aiConfig: agnes })).rejects.toThrow()
    expect(wire.posts).toHaveLength(1)
  })

  it('recovers fully observed paid output with zero POST even if the current route/key changed', async () => {
    const fixture = await seed(agnes, gemini), wire = transport()
    await expect(generateCodexExtractionCandidateV1({ ...fixture, onDurableBoundary: boundary => {
      if (boundary === 'chunk.checkpoint') throw new Error('synthetic-stop-after-response-checkpoint')
    } })).rejects.toThrow('synthetic-stop-after-response-checkpoint')
    const row = (await db.agentRuns.toArray())[0]
    useAIConfigStore.setState({ config: { ...agnes, apiKey: '' }, presets: [], taskRoutes: {} })
    const result = await resumeCodexExtractionCandidateV1({ scope: fixture.scope, runId: row.id! })
    expect(result.candidate.entries[0].name).toBe('月栖花'); expect(wire.posts).toHaveLength(1)
    expect(await db.codexEntries.count()).toBe(0)
  })

  it('never grants dispatch authority to an old unbound partial progress plan', async () => {
    const fixture = await seed(agnes, gemini), wire = transport()
    await expect(generateCodexExtractionCandidateV1({ scope: fixture.scope, request: { ...fixture.request,
      sourceText: `${sourceText}${'潮声回旋。'.repeat(1200)}` }, runAI: async () => raw,
      onDurableBoundary: boundary => { if (boundary === 'chunk.checkpoint') throw new Error('synthetic-old-plan') },
    })).rejects.toThrow('synthetic-old-plan')
    const recovery = (await readRecoverableCodexExtractionV1({ scope: fixture.scope }))!
    expect(recovery.requiresNewRequestBinding).toBe(true)
    await expect(resumeCodexExtractionCandidateV1({ scope: fixture.scope, runId: recovery.snapshot.run.id,
      aiConfig: agnes })).rejects.toThrow('旧词条计划未冻结')
    expect(wire.posts).toHaveLength(0)
  })
})
