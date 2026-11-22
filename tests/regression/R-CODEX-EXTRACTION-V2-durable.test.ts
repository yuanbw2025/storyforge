import { installEvalWebLocksFixtureV1 } from '../helpers/eval-web-locks'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assertRecordInScope, stampNewRecord } from '../../src/lib/workspace/scope'
import type { AIConfig, CodexCategory } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { usePromptStore } from '../../src/stores/prompt'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import * as artifacts from '../../src/lib/memory/artifact-store'
import * as events from '../../src/lib/agent/run/event-store'
import * as adoption from '../../src/lib/registry/adopt'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { parseAgentRunContract } from '../../src/lib/agent/run/contract'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { PreparedRequestStoppedV2 } from '../../src/lib/ai/client'
import { setUsageLoggingEnabled } from '../../src/lib/ai/usage-log'
import * as rootContracts from '../../src/lib/agent/run/codex-extraction-v2-contract'
import * as registeredContext from '../../src/lib/registry/assemble-context'
import { abandonCodexExtractionV2, adoptCodexExtractionCandidateV2, compileCodexExtractionReviewV2,
  CodexExtractionEvidenceCursorV2, CodexNativeHandoffStoppedV2, generateCodexExtractionCandidateV2, inspectCodexNativeHandoffV2, inspectCodexExtractionRunForLookupV2,
  readCodexExtractionStateV2, resumeCodexExtractionCandidateV2, saveCodexExtractionAuthorDraftV2,
  type CodexCallChainRefsV2 } from '../../src/lib/agent/run/codex-extraction-v2-runtime'
import { generateCodexExtractionCandidateV1, readPendingCodexExtractionCandidateV1, readPendingCodexExtractionCandidateV2,
  readRecoverableCodexExtractionV2, type BlockedCodexExtractionRunV2 } from '../../src/lib/agent/run/codex-extraction-durable'

const config: AIConfig = { provider: 'custom', model: 'b01-durable-synthetic', baseUrl: 'https://durable.invalid/v1', apiKey: '', temperature: 0, maxTokens: 4000 }
const sourceText = ' \r\n月栖花生于月潮湿地。😀\r\n星露藤只能在退潮后成熟。尾段反例：不得造出月潮果。\n '
const entry = (name = '月栖花') => ({ name, icon: '🌱', summary: '原文词条', description: '生于月潮湿地。',
  fields: {}, tags: [], importance: 2, evidenceQuotes: [name], provenance: 'verbatim-extraction' as const })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
type CustomMetadataFixtureCall = { url: string; method: string | undefined; redirect: RequestRedirect | undefined; bodyPresent: boolean }
const customMetadataFixtureCalls: CustomMetadataFixtureCall[] = []
const unexpectedCustomMetadataFixtureCalls: CustomMetadataFixtureCall[] = []
function withSyntheticCustomMetadata(inference: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (init?.method === 'POST') return inference(input, init)
    const call = { url: String(input), method: init?.method, redirect: init?.redirect, bodyPresent: init?.body !== undefined }
    customMetadataFixtureCalls.push(call)
    if (call.url !== 'https://durable.invalid/api/v1/models' || call.method !== 'GET'
      || call.redirect !== 'error' || call.bodyPresent) {
      unexpectedCustomMetadataFixtureCalls.push(call)
      throw new Error('Unexpected synthetic custom metadata request')
    }
    return json({ models: [] })
  }
}
async function seed(aiConfig = config) {
  useAIConfigStore.setState({ config: aiConfig, presets: [], taskRoutes: {} })
  const { scope } = await seedCurrentWorkspace('B01 synthetic durable')
  const now = Date.now(), categoryId = await db.codexCategories.add(stampNewRecord<CodexCategory>(scope, 'codexCategories', { projectId: scope.projectId, domain: 'natural',
    parentId: null, name: '灵植', icon: '🌱', builtInKey: 'herb', fieldSchema: '[]', hidden: false, order: 0,
    createdAt: now, updatedAt: now }, { owner: 'world' }))
  await stampCurrentFixtureResourceUidsV1(scope.projectId)
  return { scope, aiConfig, request: { categoryId, worldGroupId: null, sourceText, supplementTags: false } }
}
function http(answer = JSON.stringify([entry()]), finish = 'stop', status = 200, usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } = { prompt_tokens: 0 }) {
  const posts: string[] = []
  vi.stubGlobal('fetch', vi.fn(withSyntheticCustomMetadata(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== 'POST') throw new Error('unexpected synthetic metadata request')
    posts.push(String(init.body))
    return json({ choices: [{ message: { content: answer, reasoning_content: 'HIDDEN' }, finish_reason: finish }], usage }, status)
  })))
  return posts
}
async function soleRun() { const rows = await db.agentRuns.toArray(); expect(rows).toHaveLength(1); return rows[0].id! }
function chain(read: Awaited<ReturnType<typeof readCodexExtractionStateV2>>): CodexCallChainRefsV2 {
  const call = read.calls[0], response = read.responses[0], frame = read.plan.frames.find(row => row.frameHash === call.body.frameHash)!
  const ref = (hash: string) => {
    const event = read.snapshot.events.find(row => row.type === 'evidence.artifact.recorded' && row.payload.contentHash === hash)
    if (!event || event.type !== 'evidence.artifact.recorded') throw new Error('fixture lacks exact member')
    return { artifactKind: event.payload.artifactKind, contentHash: hash, byteLength: event.payload.byteLength,
      ...(event.payload.stepId === undefined ? {} : { stepId: event.payload.stepId, attempt: event.payload.attempt }) }
  }
  return { root: read.rootRef, plan: read.planRef, frame: ref(frame.frameHash), wire: ref(frame.wireFrameHash), call: call.ref, response: response.ref }
}

let restoreWebLocks: (() => void) | undefined
beforeEach(async () => { restoreWebLocks = installEvalWebLocksFixtureV1(); customMetadataFixtureCalls.length = 0; unexpectedCustomMetadataFixtureCalls.length = 0; await db.delete(); await db.open(); resetModelCapacityForTestsV1(); setUsageLoggingEnabled(true); vi.stubGlobal('location', { hostname: 'localhost' }) })
afterEach(() => { restoreWebLocks?.(); restoreWebLocks = undefined;
  // Discovery catches transport errors; this independent assertion is outside
  // that catch and cleanup always restores the original mocks/globals.
  try {
    expect(unexpectedCustomMetadataFixtureCalls).toEqual([])
    expect(customMetadataFixtureCalls.every(call => call.url === 'https://durable.invalid/api/v1/models'
      && call.method === 'GET' && call.redirect === 'error' && !call.bodyPresent)).toBe(true)
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() }
})

describe.sequential('B01 C09–C18/C21/C23/C24/C29/C30 · exact durable chain', () => {
  it('persists source/frame/plan before the real call, restores M, saves D, and adopts R only after author confirmation', async () => {
    const fixture = await seed(), posts = http(), result = await generateCodexExtractionCandidateV2(fixture)
    expect(await db.codexEntries.count()).toBe(0)
    const read = await readCodexExtractionStateV2({ scope: fixture.scope, runId: result.snapshot.run.id })
    expect(read.materials.source.rawText).toBe(sourceText)
    for (const frame of read.plan.frames) expect(frame.request.capacity).toMatchObject({ contextTokens: null, inputTokens: null, outputTokens: null })
    expect(posts).toHaveLength(1); expect(posts[0]).toContain('尾段反例')
    expect(read.candidate?.candidateHash).toBe(result.candidate.candidateHash)
    expect(read.responses[0].body.response.usage).toEqual({ inputTokens: 0 })
    expect(JSON.stringify(read.responses)).not.toContain('HIDDEN')
    const requested = read.snapshot.events.findIndex(row => row.type === 'model.requested')
    for (const hash of [read.rootRef.contentHash, read.planRef.contentHash, read.plan.frames[0].frameHash, read.plan.frames[0].wireFrameHash]) {
      expect(read.snapshot.events.findIndex(row => row.type === 'evidence.artifact.recorded' && row.payload.contentHash === hash)).toBeLessThan(requested)
    }
    const edited = [{ ...result.candidate.entries[0], name: '作者另命名', tags: ['作者手填'], description: '作者修改后的描述' }]
    const saved = await saveCodexExtractionAuthorDraftV2({ scope: fixture.scope, runId: result.snapshot.run.id,
      expectedLastSequence: read.snapshot.projection.lastSequence, entries: edited, selectedIndexes: [0] })
    expect(saved.draft.modelCandidateHash).toBe(result.candidate.candidateHash)
    expect(saved.draft.editPaths).toContain('entries.0.tags')
    const refreshed = await readCodexExtractionStateV2({ scope: fixture.scope, runId: result.snapshot.run.id })
    expect(refreshed.candidate).toEqual(result.candidate); expect(refreshed.draft?.entries).toEqual(edited)
    const compiled = await compileCodexExtractionReviewV2({ root: read.materials.root, candidate: result.candidate,
      candidateRef: read.candidateRef!, entries: edited, selectedIndexes: [0], sourceText, baseline: read.materials.baselineState })
    expect(compiled.review.compiledContentHash).toBe(await hashCanonicalValue(compiled.formalItems.map(({ producerCandidateHash: _hash, ...row }) => row)))
    const adopted = await adoptCodexExtractionCandidateV2({ scope: fixture.scope, runId: result.snapshot.run.id, entries: edited, selectedIndexes: [0] })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(await db.codexEntries.toArray()).toEqual([expect.objectContaining({ name: '作者另命名', origin: 'manual',
      producerRunId: result.snapshot.run.id, producerCandidateHash: compiled.review.confirmedCandidateHash })])
    expect(posts).toHaveLength(1)
    expect((await adoptCodexExtractionCandidateV2({ scope: fixture.scope, runId: result.snapshot.run.id, selectedIndexes: [0] })).receiptHash).toBe(adopted.receiptHash)
  })

  it('seals one cursor at the last returned commit and refuses a blind second write', async () => {
    const fixture = await seed(); http('[]')
    const generated = await generateCodexExtractionCandidateV2(fixture), cursor = await CodexExtractionEvidenceCursorV2.open(fixture.scope, generated.snapshot.run.id)
    await cursor.record({ artifactKind: 'tool-result', content: canonicalStringify({ marker: 'committed' }) })
    const seq = cursor.snapshot.projection.lastSequence
    const spy = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockRejectedValue(new Error('synthetic quota'))
    await expect(cursor.record({ artifactKind: 'tool-result', content: '{}' })).rejects.toThrow()
    expect(cursor.snapshot.projection.lastSequence).toBe(seq); expect(cursor.isStopped).toBe(true)
    await expect(cursor.record({ artifactKind: 'tool-result', content: '{}' })).rejects.toThrow()
    expect(spy).toHaveBeenCalledOnce()
  })

  it('does not reject a valid long returned description merely because its source forecast was smaller', async () => {
    const fixture = await seed(), description = '这是有原文依据的长描述。'.repeat(3000)
    const posts = http(JSON.stringify([{ ...entry(), description }]))
    const generated = await generateCodexExtractionCandidateV2(fixture)
    expect(generated.candidate.entries[0].description).toBe(description)
    expect(generated.snapshot.contract.budget.allocation?.mode).toBe('adaptive-plan')
    expect(posts).toHaveLength(1)
    expect((await readCodexExtractionStateV2({ scope: fixture.scope, runId: generated.snapshot.run.id })).candidate?.entries[0].description).toBe(description)
  })

  it('serializes same-target start admission across independent callers before any Run exists, paying for only one Root', async () => {
    const f = await seed(), posts = http(), source = structuredClone(f.request)
    const original = registeredContext.captureRegisteredContextSourceV2
    let entered = 0, release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const spy = vi.spyOn(registeredContext, 'captureRegisteredContextSourceV2').mockImplementation(async value => {
      if (value.sourceKey === 'manualText') { entered++; await barrier }
      return original(value)
    })
    const requests = vi.spyOn(navigator.locks, 'request')
    const first = generateCodexExtractionCandidateV2(f)
    let outcomes: ReturnType<typeof Promise.allSettled> | undefined
    try {
      await vi.waitFor(() => expect(entered).toBe(1))
      expect(await db.agentRuns.count()).toBe(0)
      const second = generateCodexExtractionCandidateV2({ ...f, request: structuredClone(f.request) })
      outcomes = Promise.allSettled([first, second])
      const key = `storyforge:codex-extraction-start-v2:${db.name}:${f.scope.projectId}:${f.scope.worldId}:${f.scope.workId}:${f.request.categoryId}:null`
      expect(requests.mock.calls.filter(([name]) => name === key)).toHaveLength(2)
      expect(entered).toBe(1); expect(await db.agentRuns.count()).toBe(0)
      release()
      const results = await outcomes
      expect(results[0].status).toBe('fulfilled'); expect(results[1].status).toBe('rejected')
      if (results[1].status === 'rejected') expect(String(results[1].reason)).toContain('另一页面')
      expect(await db.agentRuns.count()).toBe(1); expect(posts).toHaveLength(1)
      expect(f.request).toEqual(source); expect(await db.codexEntries.count()).toBe(0)
      // Once the first lock releases, its durable pending Run must still deny
      // an old preflight without granting restoration over another page's input.
      await expect(generateCodexExtractionCandidateV2(f)).rejects.toBeInstanceOf(rootContracts.CodexExtractionAdmissionUnavailableV2)
      expect(await db.agentRuns.count()).toBe(1); expect(posts).toHaveLength(1)
    } finally {
      release(); await (outcomes ?? Promise.allSettled([first])); spy.mockRestore()
    }
  })

  it('releases admission before a hanging POST so another caller can explicitly abandon and start a new Run', async () => {
    const f = await seed(), posts: string[] = []
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    vi.stubGlobal('fetch', vi.fn(withSyntheticCustomMetadata(async (_input, init) => {
      posts.push(String(init?.body))
      if (posts.length === 1) await barrier
      return json({ choices: [{ message: { content: JSON.stringify([entry()]) }, finish_reason: 'stop' }] })
    })))
    const first = Promise.allSettled([generateCodexExtractionCandidateV2(f)])
    try {
      await vi.waitFor(() => expect(posts).toHaveLength(1))
      const oldRunId = await soleRun()
      await expect(generateCodexExtractionCandidateV2(f)).rejects.toBeInstanceOf(rootContracts.CodexExtractionAdmissionUnavailableV2)
      expect(posts).toHaveLength(1)
      await abandonCodexExtractionV2({ scope: f.scope, runId: oldRunId })
      const next = await generateCodexExtractionCandidateV2({ ...f, request: { ...f.request, sourceText: f.request.sourceText + '\n\n作者明确另起的新请求。' } })
      expect(next.snapshot.run.id).not.toBe(oldRunId); expect(posts).toHaveLength(2)
      expect(await db.agentRuns.count()).toBe(2); expect(await db.codexEntries.count()).toBe(0)
      release()
      expect((await first)[0].status).toBe('rejected')
      expect((await events.readAgentRunV1(f.scope, oldRunId)).projection.state).toBe('cancelled')
      await expect(adoptCodexExtractionCandidateV2({ scope: f.scope, runId: oldRunId, selectedIndexes: [0] })).rejects.toThrow()
      await expect(resumeCodexExtractionCandidateV2({ scope: f.scope, runId: oldRunId, aiConfig: f.aiConfig })).rejects.toThrow()
      expect(posts).toHaveLength(2); expect(await db.codexEntries.count()).toBe(0)
    } finally { release(); await first }
  })

  it('dispatches no old POST after cancellation before its dispatch guard completes, while admitting an explicitly new Run', async () => {
    const f = await seed(), posts = http(), original = events.readAgentRunV1
    let entered = false, release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const spy = vi.spyOn(events, 'readAgentRunV1').mockImplementation(async (...args) => {
      const snapshot = await original(...args)
      if (!entered && snapshot.projection.state === 'running' && snapshot.events.some(event => event.type === 'step.started')
        && !snapshot.events.some(event => event.type === 'model.requested')) { entered = true; await barrier }
      return snapshot
    })
    const first = Promise.allSettled([generateCodexExtractionCandidateV2(f)])
    try {
      await vi.waitFor(() => expect(entered).toBe(true))
      const oldRunId = await soleRun()
      expect(posts).toEqual([])
      await abandonCodexExtractionV2({ scope: f.scope, runId: oldRunId })
      const marker = 'SECOND-AUTHOR-REQUEST'
      const next = await generateCodexExtractionCandidateV2({ ...f, request: { ...f.request, sourceText: f.request.sourceText + '\n\n' + marker } })
      expect(next.snapshot.run.id).not.toBe(oldRunId)
      expect(posts).toHaveLength(1); expect(posts[0]).toContain(marker)
      release()
      expect((await first)[0].status).toBe('rejected')
      expect((await original(f.scope, oldRunId)).projection.state).toBe('cancelled')
      expect(posts).toHaveLength(1); expect(await db.codexEntries.count()).toBe(0)
    } finally { release(); await first; spy.mockRestore() }
  })

  it('admits different legitimate targets independently through a shared pre-Run barrier', async () => {
    const f = await seed(), posts = http(), at = Date.now()
    const categoryId = await db.codexCategories.add(stampNewRecord<CodexCategory>(f.scope, 'codexCategories', {
      projectId: f.scope.projectId, domain: 'natural', parentId: null, name: '另一灵植类', icon: '🌱', fieldSchema: '[]',
      hidden: false, order: 1, createdAt: at, updatedAt: at,
    }, { owner: 'world' }))
    await stampCurrentFixtureResourceUidsV1(f.scope.projectId)
    const original = registeredContext.captureRegisteredContextSourceV2
    let entered = 0, release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const spy = vi.spyOn(registeredContext, 'captureRegisteredContextSourceV2').mockImplementation(async value => {
      if (value.sourceKey === 'manualText') { entered++; await barrier }
      return original(value)
    })
    const outcomes = Promise.allSettled([generateCodexExtractionCandidateV2(f),
      generateCodexExtractionCandidateV2({ ...f, request: { ...f.request, categoryId } })])
    try {
      await vi.waitFor(() => expect(entered).toBe(2))
      expect(await db.agentRuns.count()).toBe(0)
      release()
      const results = await outcomes
      expect(results.map(row => row.status)).toEqual(['fulfilled', 'fulfilled'])
      expect(await db.agentRuns.count()).toBe(2); expect(posts).toHaveLength(2)
      const scopes = await Promise.all((await db.agentRuns.toArray()).map(row => readCodexExtractionStateV2({ scope: f.scope, runId: row.id! })))
      expect(new Set(scopes.map(row => row.materials.root.categoryId))).toEqual(new Set([f.request.categoryId, categoryId]))
      expect(new Set(scopes.map(row => row.materials.root.rootHash)).size).toBe(2)
      expect(await db.codexEntries.count()).toBe(0)
    } finally { release(); await outcomes; spy.mockRestore() }
  })

  it('fails without cross-page lock capability before creating any Run or inference', async () => {
    const f = await seed(), posts = http(), original = structuredClone(f.request)
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    await expect(generateCodexExtractionCandidateV2(f)).rejects.toThrow('跨页面执行占用')
    expect(await db.agentRuns.count()).toBe(0); expect(posts).toEqual([]); expect(f.request).toEqual(original)
  })

  it('round-trips 201 source-grounded candidates with 8 tags/quotes through actual Run, refresh, adopt and terminal receipt in one inference', async () => {
    const f = await seed({ ...config, maxTokens: 32000 })
    const firstQuotes = Array.from({ length: 8 }, (_, i) => `灵植000性质${i}。`)
    const tags = Array.from({ length: 8 }, (_, i) => `标签${i}`)
    const entries = Array.from({ length: 201 }, (_, i) => {
      const name = `灵植${String(i).padStart(3, '0')}`
      return { ...entry(name), summary: '来源词条', description: i === 0 ? firstQuotes.join('') : `${name}有来源。`,
        tags: i === 0 ? tags : [], evidenceQuotes: i === 0 ? firstQuotes : [name] }
    })
    const original = firstQuotes.join('\n') + '\n\n' + entries.slice(1).map(row => row.description).join('\n\n')
    const posts = http(JSON.stringify(entries))
    const generated = await generateCodexExtractionCandidateV2({ ...f, request: { ...f.request, sourceText: original, supplementTags: true } })
    expect(generated.candidate.entries).toHaveLength(201)
    expect(await db.codexEntries.count()).toBe(0)
    const read = await readCodexExtractionStateV2({ scope: f.scope, runId: generated.snapshot.run.id })
    expect(read.candidate).toEqual(generated.candidate)
    expect(read.candidate?.entries[0].tags).toEqual(tags)
    expect(read.candidate?.entries[0].evidenceQuotes).toEqual(firstQuotes)
    expect(read.candidate?.entries[200].name).toBe('灵植200')
    const selectedIndexes = entries.map((_, i) => i)
    const adopted = await adoptCodexExtractionCandidateV2({ scope: f.scope, runId: generated.snapshot.run.id, selectedIndexes })
    expect(adopted.written).toBe(201)
    const rows = await db.codexEntries.toArray()
    expect(rows).toHaveLength(201)
    const first = rows.find(row => row.name === '灵植000')!
    expect(JSON.parse(first.tags!)).toEqual(tags)
    expect(JSON.parse(first.sourceEvidenceQuotes!)).toEqual(firstQuotes)
    expect(rows.find(row => row.name === '灵植200')?.description).toBe('灵植200有来源。')
    expect(await Promise.all(rows.map(row => assertRecordInScope(f.scope, 'codexEntries', row, { owner: 'world' })))).toEqual(rows.map(() => true))
    expect(rows.every(row => row.producerRunId === generated.snapshot.run.id)).toBe(true)
    const terminal = await readCodexExtractionStateV2({ scope: f.scope, runId: generated.snapshot.run.id })
    expect(terminal.snapshot.projection.state).toBe('completed')
    expect(terminal.snapshot.projection.terminalReceiptHash).toBe(adopted.receiptHash)
    expect(terminal.snapshot.events.some(event => event.type === 'verification.accepted' && event.payload.receiptHash === adopted.receiptHash)).toBe(true)
    expect((await adoptCodexExtractionCandidateV2({ scope: f.scope, runId: generated.snapshot.run.id, selectedIndexes })).receiptHash).toBe(adopted.receiptHash)
    expect(await db.codexEntries.count()).toBe(201); expect(posts).toHaveLength(1)
  })

  it.each(['same-name', 'pronoun', 'field-conflict'] as const)('new frozen policy preserves sameRoot continuation across actual HTTP/restore/adopt: %s', async mode => {
    const f = await seed()
    const first = mode === 'field-conflict' ? '北辰联邦都城为甲。' : '北辰联邦位于北境。'
    const second = mode === 'same-name' ? '北辰联邦每逢朔日禁用灵力。' : mode === 'field-conflict' ? '该国都城为乙。' : '该国每逢朔日禁用灵力。'
    const original = first + '\n\n' + second
    await db.codexCategories.update(f.request.categoryId, { domain: 'humanity', builtInKey: 'faction', name: '国家',
      fieldSchema: JSON.stringify([{ key: 'capital', label: '都城', type: 'select', options: ['甲', '乙'] }]) })
    const posts: string[] = []
    vi.stubGlobal('fetch', vi.fn(withSyntheticCustomMetadata(async (_input: RequestInfo | URL, init?: RequestInit) => {
      posts.push(String(init?.body))
      const description = posts.length === 2 ? first : second
      const fields = mode === 'field-conflict' ? { capital: posts.length === 2 ? '甲' : '乙' } : {}
      return json({ choices: [{ message: { content: posts.length === 1 ? '[{"name":"unfinished' : JSON.stringify([
        { ...entry('北辰联邦'), summary: description, description, fields, evidenceQuotes: [description] },
      ]) }, finish_reason: posts.length === 1 ? 'length' : 'stop' }] })
    })))
    const request = { ...f.request, sourceText: original }
    if (mode === 'field-conflict') {
      await expect(generateCodexExtractionCandidateV2({ ...f, request })).rejects.toThrow('不同值')
      const read = await readCodexExtractionStateV2({ scope: f.scope, runId: await soleRun() })
      expect(read.responses).toHaveLength(3); expect(read.candidate).toBeNull()
      expect(await db.codexEntries.count()).toBe(0)
      await expect(resumeCodexExtractionCandidateV2({ scope: f.scope, runId: read.snapshot.run.id, aiConfig: f.aiConfig })).rejects.toThrow('不同值')
      expect(posts).toHaveLength(3)
      return
    }
    const generated = await generateCodexExtractionCandidateV2({ ...f, request })
    expect(posts).toHaveLength(3)
    expect(JSON.parse(posts[2]).messages.some((message: { content: string }) => message.content.startsWith('【本次实际发送的同Root已验证草稿，非Canon】') && message.content.includes('北辰联邦'))).toBe(true)
    const read = await readCodexExtractionStateV2({ scope: f.scope, runId: generated.snapshot.run.id })
    expect(read.materials.root.productionPolicy?.version).toBe('codex-production-source-units-and-drafts-v1')
    expect(read.plan.frames.map(frame => original.slice(frame.startChar, frame.endChar)).join('')).toBe(original)
    expect(read.candidate?.entries).toEqual(generated.candidate.entries)
    expect(read.candidate?.entries).toHaveLength(1)
    expect(read.candidate?.entries[0]).toMatchObject({ name: '北辰联邦', description: first + '\n\n' + second, evidenceQuotes: [first, second] })
    const adopted = await adoptCodexExtractionCandidateV2({ scope: f.scope, runId: generated.snapshot.run.id, selectedIndexes: [0] })
    expect(adopted.written).toBe(1)
    const rows = await db.codexEntries.toArray()
    expect(rows).toHaveLength(1); expect(rows[0].description).toBe(first + '\n\n' + second)
    expect(JSON.parse(rows[0].sourceEvidenceQuotes!)).toEqual([first, second])
    expect(posts).toHaveLength(3)
  })

  it('keeps two actually sent verified entities and former/latter facts through durable restore and author adoption without a name-count cutoff', async () => {
    const f = await seed(), first = '北辰联邦与南辰共和国位于北境。', second = '前者朔日禁用灵力，后者不受此限。'
    await db.codexCategories.update(f.request.categoryId, { domain: 'humanity', builtInKey: 'faction', name: '国家' })
    const names = ['北辰联邦', '南辰共和国'], posts: string[] = []
    vi.stubGlobal('fetch', vi.fn(withSyntheticCustomMetadata(async (_input: RequestInfo | URL, init?: RequestInit) => {
      posts.push(String(init?.body))
      const entries = names.map((name, i) => ({ ...entry(name), summary: posts.length === 2 ? first : i === 0 ? '朔日禁用灵力' : '不受此限',
        description: posts.length === 2 ? first : i === 0 ? '北辰联邦朔日禁用灵力。' : '南辰共和国不受此限。',
        evidenceQuotes: posts.length === 2 ? [first] : i === 0 ? ['前者朔日禁用灵力'] : ['后者不受此限。'] }))
      return json({ choices: [{ message: { content: posts.length === 1 ? '[{"name":"unfinished' : JSON.stringify(entries) },
        finish_reason: posts.length === 1 ? 'length' : 'stop' }] })
    })))
    const generated = await generateCodexExtractionCandidateV2({ ...f, request: { ...f.request, sourceText: first + '\n\n' + second } })
    expect(posts).toHaveLength(3)
    const sent = JSON.parse(posts[2]).messages.find((message: { content: string }) => message.content.startsWith('【本次实际发送的同Root已验证草稿，非Canon】'))
    expect(sent.content).toContain('北辰联邦'); expect(sent.content).toContain('南辰共和国')
    const read = await readCodexExtractionStateV2({ scope: f.scope, runId: generated.snapshot.run.id })
    expect(read.candidate?.entries).toEqual(generated.candidate.entries)
    expect(read.candidate?.entries.map(row => row.name)).toEqual(names)
    expect(read.candidate?.entries[0].description).toBe(first + '\n\n北辰联邦朔日禁用灵力。')
    expect(read.candidate?.entries[1].description).toBe(first + '\n\n南辰共和国不受此限。')
    await adoptCodexExtractionCandidateV2({ scope: f.scope, runId: generated.snapshot.run.id, selectedIndexes: [0, 1] })
    const rows = await db.codexEntries.toArray()
    expect(rows.map(row => row.name)).toEqual(names)
    expect(JSON.parse(rows[0].sourceEvidenceQuotes!)).toEqual([first, '前者朔日禁用灵力'])
    expect(JSON.parse(rows[1].sourceEvidenceQuotes!)).toEqual([first, '后者不受此限。'])
    expect(posts).toHaveLength(3)
  })

  it('retains an incomplete raw answer when a new-policy indivisible source unit cannot be refined', async () => {
    const f = await seed(), original = '前'.repeat(1000) + '北辰联邦' + '后'.repeat(1000)
    const posts = http('[{"name":"unfinished', 'length')
    await expect(generateCodexExtractionCandidateV2({ ...f, request: { ...f.request, sourceText: original } })).rejects.toThrow('单个完整原文单元')
    const read = await readCodexExtractionStateV2({ scope: f.scope, runId: await soleRun() })
    expect(read.materials.source.rawText).toBe(original)
    expect(read.responses).toHaveLength(1); expect(read.candidate).toBeNull(); expect(posts).toHaveLength(1)
    expect(await db.codexEntries.count()).toBe(0)
  })

  it.each(['北辰联邦：\n该国首都玄京，朔日禁用灵力。', '北辰联邦：\n\n该国首都玄京，朔日禁用灵力。',
    '【北辰联邦】\n\n该国首都玄京，朔日禁用灵力。'])('does not pay for a detached heading/facts split after output length: %j', async original => {
    const f = await seed()
    const posts = http('[{"name":"unfinished', 'length')
    await expect(generateCodexExtractionCandidateV2({ ...f, request: { ...f.request, sourceText: original } })).rejects.toThrow('单个完整原文单元')
    const read = await readCodexExtractionStateV2({ scope: f.scope, runId: await soleRun() })
    expect(read.materials.source.rawText).toBe(original); expect(read.responses).toHaveLength(1)
    expect(read.candidate).toBeNull(); expect(await db.codexEntries.count()).toBe(0); expect(posts).toHaveLength(1)
  })

  it('keeps absent-policy Root/hash/raw readable but exposes attention instead of resplitting a paid legacy incomplete answer', async () => {
    const f = await seed(), posts = http('[{"name":"unfinished', 'length'), original = rootContracts.createCodexExtractionRootV2
    const legacy = vi.spyOn(rootContracts, 'createCodexExtractionRootV2').mockImplementation(value => original({ ...value, newProductionPolicy: false }))
    await expect(generateCodexExtractionCandidateV2(f)).rejects.toThrow('旧提取策略')
    legacy.mockRestore()
    const runId = await soleRun(), before = await readCodexExtractionStateV2({ scope: f.scope, runId })
    expect(before.materials.root).not.toHaveProperty('productionPolicy')
    await expect(resumeCodexExtractionCandidateV2({ scope: f.scope, runId, aiConfig: f.aiConfig })).rejects.toThrow('旧提取策略')
    const after = await readCodexExtractionStateV2({ scope: f.scope, runId })
    expect(after.materials.root).toEqual(before.materials.root); expect(after.responses).toEqual(before.responses)
    expect(after.plan).toEqual(before.plan); expect(posts).toHaveLength(1); expect(await db.codexEntries.count()).toBe(0)
  })

  it('persists an incomplete original, then sends strictly smaller children with registered same-Run progress', async () => {
    const fixture = await seed(), posts: string[] = []
    // New policy fixture uses two real paragraphs; single line breaks are not safe split authority.
    const safeSource = fixture.request.sourceText.replace(/\r\n/g, '\r\n\r\n')
    vi.stubGlobal('fetch', vi.fn(withSyntheticCustomMetadata(async (_input: RequestInfo | URL, init?: RequestInit) => {
      posts.push(String(init?.body))
      return json({ choices: [{ message: { content: posts.length === 1 ? '[{"name":"unfinished' : '[]' },
        finish_reason: posts.length === 1 ? 'length' : 'stop' }] })
    })))
    const generated = await generateCodexExtractionCandidateV2({ ...fixture, request: { ...fixture.request, sourceText: safeSource } })
    const read = await readCodexExtractionStateV2({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(posts).toHaveLength(3); expect(read.responses).toHaveLength(3); expect(read.results).toHaveLength(2)
    expect(read.responses.filter(row => row.body.response.completion === 'incomplete')).toHaveLength(1)
    expect(read.plan.frames.map(row => safeSource.slice(row.startChar, row.endChar)).join('')).toBe(safeSource)
    expect(read.plan.frames.every(row => row.endChar - row.startChar < safeSource.length)).toBe(true)
    expect(read.candidate?.entries).toEqual([])
    expect(read.snapshot.contract.permissions.contextSourceKeys).toContain('codexExtractionProgressV2')
    const context = { projectId: fixture.scope.projectId, scope: fixture.scope, codexCategoryId: fixture.request.categoryId,
      worldGroupId: null, codexExtractionProgressV2: { runId: generated.snapshot.run.id, rootHash: read.materials.root.rootHash,
        verifiedResultHashes: read.results.map(row => row.ref.contentHash) } }
    const progress = await registeredContext.captureRegisteredContextSourceV2({ sourceKey: 'codexExtractionProgressV2', context })
    expect(JSON.parse(progress.rawText)).toMatchObject({ runId: generated.snapshot.run.id, rootHash: read.materials.root.rootHash, authority: 'draft-not-canon' })
    await expect(registeredContext.captureRegisteredContextSourceV2({ sourceKey: 'codexExtractionProgressV2', context: { ...context,
      codexExtractionProgressV2: { ...context.codexExtractionProgressV2, verifiedResultHashes: [read.responses[0].ref.contentHash] } } })).rejects.toThrow()
    await expect(registeredContext.captureRegisteredContextSourceV2({ sourceKey: 'codexExtractionProgressV2', context: { ...context,
      codexExtractionProgressV2: { ...context.codexExtractionProgressV2, verifiedResultHashes: [read.results[0].ref.contentHash, read.results[0].ref.contentHash] } } })).rejects.toThrow()
  })

  it('recovers a saved complete paid answer and adopts it under frozen evidence after the active template changes, with zero new POST', async () => {
    const f = await seed(), posts = http(), originalSave = artifacts.recordAgentRunArtifactV1
    const fail = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async value => {
      if (JSON.parse(value.content).version === 'codex-call-usage-v2') throw new Error('saved raw before usage failure')
      return originalSave(value)
    })
    await expect(generateCodexExtractionCandidateV2(f)).rejects.toThrow()
    fail.mockRestore()
    const runId = await soleRun(), before = await readCodexExtractionStateV2({ scope: f.scope, runId })
    const prior = usePromptStore.getState(), current = prior.getActive('codex.extract')
    try {
      usePromptStore.setState({ templates: [{ ...current, scope: 'user', isActive: true, systemPrompt: current.systemPrompt + '\n新的作者模板' }], loaded: true })
      const recovered = await resumeCodexExtractionCandidateV2({ scope: f.scope, runId })
      expect(recovered.candidate.entries[0].name).toBe('月栖花')
      await adoptCodexExtractionCandidateV2({ scope: f.scope, runId, selectedIndexes: [0] })
      const after = await readCodexExtractionStateV2({ scope: f.scope, runId })
      expect(after.materials.root).toEqual(before.materials.root)
      expect(after.responses).toEqual(before.responses)
      expect(posts).toHaveLength(1); expect(await db.codexEntries.count()).toBe(1)
    } finally { usePromptStore.setState({ templates: prior.templates, loaded: prior.loaded }) }
  })

  it('preserves paid raw and refuses a new inference for unfinished ranges after the active template changes', async () => {
    const f = await seed(), original = f.request.sourceText.replace(/\r\n/g, '\r\n\r\n')
    const posts = http('[{"name":"unfinished', 'length'), originalSave = artifacts.recordAgentRunArtifactV1
    let manifests = 0
    const fail = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async value => {
      if (value.artifactKind === 'context-manifest' && ++manifests === 2) throw new Error('stop before second dispatch')
      return originalSave(value)
    })
    await expect(generateCodexExtractionCandidateV2({ ...f, request: { ...f.request, sourceText: original } })).rejects.toThrow()
    fail.mockRestore()
    const runId = await soleRun(), before = await readCodexExtractionStateV2({ scope: f.scope, runId })
    const prior = usePromptStore.getState(), current = prior.getActive('codex.extract')
    try {
      usePromptStore.setState({ templates: [{ ...current, scope: 'user', isActive: true, systemPrompt: current.systemPrompt + '\n新的作者模板' }], loaded: true })
      await expect(resumeCodexExtractionCandidateV2({ scope: f.scope, runId, aiConfig: f.aiConfig })).rejects.toThrow('模板已变化')
      const after = await readCodexExtractionStateV2({ scope: f.scope, runId })
      expect(after.materials.root).toEqual(before.materials.root); expect(after.responses).toEqual(before.responses)
      expect(posts).toHaveLength(1); expect(await db.codexEntries.count()).toBe(0)
    } finally { usePromptStore.setState({ templates: prior.templates, loaded: prior.loaded }) }
  })

  it('reuses saved complete HTTP raw after the following usage write fails without another POST or raw save', async () => {
    const fixture = await seed(), posts = http(JSON.stringify([entry()]), 'stop', 200, { prompt_tokens: 0, completion_tokens: 5, total_tokens: 5 }), original = artifacts.recordAgentRunArtifactV1
    const spy = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
      if (JSON.parse(input.content).version === 'codex-call-usage-v2') throw new Error('usage write failed')
      return original(input)
    })
    await expect(generateCodexExtractionCandidateV2(fixture)).rejects.toThrow()
    spy.mockRestore()
    const runId = await soleRun(), read = await readCodexExtractionStateV2({ scope: fixture.scope, runId })
    expect(read.responses).toHaveLength(1); expect(read.results).toHaveLength(0)
    await vi.waitFor(async () => expect(await db.aiUsageLog.count()).toBe(1))
    const accounted = await db.aiUsageLog.toArray()
    const resumed = await resumeCodexExtractionCandidateV2({ scope: fixture.scope, runId })
    expect(resumed.candidate.entries[0].name).toBe('月栖花'); expect(posts).toHaveLength(1)
    const after = await readCodexExtractionStateV2({ scope: fixture.scope, runId })
    expect(after.responses).toHaveLength(1)
    expect(after.snapshot.events.filter(row => row.type === 'model.responded')).toHaveLength(1)
    expect(await db.aiUsageLog.toArray()).toEqual(accounted)
  })

  it('accounts measured native usage once before a product save failure, then recovers saved native raw with zero network or extra usage rows', async () => {
    const nativeConfig: AIConfig = { ...config, provider: 'codex', baseUrl: '/storyforge/local-codex/v1' }
    const fixture = await seed(nativeConfig), posts: string[] = [], acknowledgements: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/status')) return json({ state: 'ready' })
      if (url.endsWith('/acknowledge')) { acknowledgements.push(String(init?.body)); throw new Error('unexpected ACK') }
      if (url.endsWith('/requests') && init?.method === 'POST') { posts.push(String(init.body)); return json({ id: JSON.parse(posts[0]).id }, 202) }
      const body = JSON.parse(posts[0])
      return json({ id: body.id, model: body.model, createdAt: 1, status: 'completed', text: JSON.stringify([entry()]), dispatched: true,
        requestHash: await sha256Text(posts[0]), requestHashAlgorithm: 'sha256-json-request-v1', receiptRetention: 'until-owner-ack-v1',
        usage: { inputTokens: 0, outputTokens: 9, totalTokens: 9 } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const original = artifacts.recordAgentRunArtifactV1
    const save = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
      if (JSON.parse(input.content).version === 'codex-call-usage-v2') throw new Error('product usage evidence did not commit')
      return original(input)
    })
    await expect(generateCodexExtractionCandidateV2(fixture)).rejects.toThrow(); save.mockRestore()
    const runId = await soleRun(), read = await readCodexExtractionStateV2({ scope: fixture.scope, runId })
    expect(read.responses).toHaveLength(1); expect(read.results).toHaveLength(0)
    await vi.waitFor(async () => expect(await db.aiUsageLog.count()).toBe(1))
    const accounted = await db.aiUsageLog.toArray()
    expect(accounted).toEqual([expect.objectContaining({ provider: 'codex', model: nativeConfig.model, inputTokens: 0, outputTokens: 9, costUsd: null })])
    const transportCalls = fetchMock.mock.calls.length
    const resumed = await resumeCodexExtractionCandidateV2({ scope: fixture.scope, runId })
    expect(resumed.candidate.entries[0].name).toBe('月栖花')
    expect((await readCodexExtractionStateV2({ scope: fixture.scope, runId })).responses).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(transportCalls); expect(posts).toHaveLength(1); expect(acknowledgements).toEqual([])
    expect(await db.aiUsageLog.toArray()).toEqual(accounted)
  })

  it('does not POST again for an unknown HTTP outcome, filter, nonretry 4xx, or domain parse failure', async () => {
    const fixture = await seed(), posts = http('invalid domain', 'stop')
    await expect(generateCodexExtractionCandidateV2(fixture)).rejects.toThrow()
    const runId = await soleRun()
    await expect(resumeCodexExtractionCandidateV2({ scope: fixture.scope, runId, aiConfig: config })).rejects.toThrow()
    expect(posts).toHaveLength(1); expect(await db.codexEntries.count()).toBe(0)
  })

  it('does not let an exact artifact available under the project grant a foreign Work read', async () => {
    const fixture = await seed(); http()
    const generated = await generateCodexExtractionCandidateV2(fixture), other = await seedCurrentWorkspace('foreign Work')
    await expect(readCodexExtractionStateV2({ scope: other.scope, runId: generated.snapshot.run.id })).rejects.toThrow()
    await expect(generateCodexExtractionCandidateV2({ ...fixture, scope: { ...fixture.scope, workId: 0 } })).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(1)
  })

  it('keeps old and new pending readers on exact profiles without rewriting either stored contract', async () => {
    const fixture = await seed(); const posts = http()
    const old = await generateCodexExtractionCandidateV1({ ...fixture, runAI: async () => JSON.stringify([entry()]) })
    const current = await generateCodexExtractionCandidateV2(fixture)
    const oldContract = (await db.agentRuns.get(old.snapshot.run.id))!.contractJson
    expect((await readPendingCodexExtractionCandidateV1({ scope: fixture.scope }))?.snapshot.run.id).toBe(old.snapshot.run.id)
    expect((await readPendingCodexExtractionCandidateV2({ scope: fixture.scope }))?.snapshot.run.id).toBe(current.snapshot.run.id)
    expect((await db.agentRuns.get(old.snapshot.run.id))!.contractJson).toBe(oldContract); expect(posts).toHaveLength(1)
  })

  it.each(['partial-plan','corrupt-plan','corrupt-contract','self-consistent-non-v2-contract'] as const)('isolates newest %s category/group A while V2/V1 B stay discoverable, preserving all original rows', async failure => {
    const fixture = await seed(), now = Date.now()
    await db.projects.update(fixture.scope.projectId, { enableMultiWorld: true })
    const worldGroupId = await db.worldGroups.add({ projectId: fixture.scope.projectId, worldId: fixture.scope.worldId,
      name: '另一目标组', description: '', type: 'primary', icon: '🌙', order: 1, createdAt: now, updatedAt: now })
    const originalCategory = (await db.codexCategories.get(fixture.request.categoryId))!
    const categoryId = await db.codexCategories.add(stampNewRecord<CodexCategory>(fixture.scope, 'codexCategories', {
      projectId: fixture.scope.projectId, domain: originalCategory.domain, parentId: originalCategory.parentId,
      name: '坏运行目标', icon: originalCategory.icon, builtInKey: 'mineral', fieldSchema: originalCategory.fieldSchema,
      hidden: originalCategory.hidden, order: originalCategory.order, createdAt: now, updatedAt: now,
    }, { owner: 'world' }))
    await stampCurrentFixtureResourceUidsV1(fixture.scope.projectId)
    const posts = http()
    const good = await generateCodexExtractionCandidateV2(fixture)
    const legacy = await generateCodexExtractionCandidateV1({ ...fixture, runAI: async () => JSON.stringify([entry()]) })
    const badInput = { ...fixture, request: { ...fixture.request, categoryId, worldGroupId } }
    let badId: number
    if (failure === 'partial-plan') {
      const original = artifacts.recordAgentRunArtifactV1
      const save = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
        if (JSON.parse(input.content).version === 'codex-extraction-plan-v2') throw new Error('plan did not commit')
        return original(input)
      })
      await expect(generateCodexExtractionCandidateV2(badInput)).rejects.toThrow(); save.mockRestore()
      const runsAfterFailure = await db.agentRuns.toArray()
      badId = runsAfterFailure[runsAfterFailure.length - 1]!.id!
    } else {
      const bad = await generateCodexExtractionCandidateV2(badInput); badId = bad.snapshot.run.id
      if (failure === 'corrupt-contract') await db.agentRuns.update(badId, { contractJson: 'corrupt current contract' })
      else if (failure === 'self-consistent-non-v2-contract') {
        const replacement = parseAgentRunContract({ ...legacy.snapshot.contract, scope: { ...legacy.snapshot.contract.scope, worldGroupId } })
        await db.agentRuns.update(badId, { contractJson: canonicalStringify(replacement),
          contractHash: await hashCanonicalValue(replacement), contractVersion: replacement.version })
        const modified = (await db.agentRuns.get(badId))!
        expect(await sha256Text(modified.contractJson)).toBe(modified.contractHash)
        await expect(events.readAgentRunV1(fixture.scope, badId)).rejects.toThrow()
      } else {
        const read = await readCodexExtractionStateV2({ scope: fixture.scope, runId: badId })
        const stored = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([fixture.scope.projectId, 'tool-result', read.planRef.contentHash]).first()
        await db.agentRunArtifacts.update(stored!.id!, { content: 'corrupt original plan' })
      }
    }
    const originalRows = { runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(),
      artifacts: await db.agentRunArtifacts.toArray(), checkpoints: await db.agentRunCheckpoints.toArray() }
    const filter = { scope: { ...fixture.scope }, categoryId: fixture.request.categoryId, worldGroupId: null as number | null }
    const blocked: BlockedCodexExtractionRunV2[] = []
    const pending = readPendingCodexExtractionCandidateV2(filter, { onBlockedRun: row => { blocked.push(row) } })
    // Mutation after invocation cannot change any filter across the first await.
    filter.scope.workId += 1000; filter.categoryId = categoryId; filter.worldGroupId = worldGroupId
    expect((await pending)?.snapshot.run.id).toBe(good.snapshot.run.id)
    expect(blocked).toEqual([expect.objectContaining({ runId: badId, target: ['corrupt-contract','self-consistent-non-v2-contract'].includes(failure) ? null : { categoryId, worldGroupId }, scope: fixture.scope })])
    if (['corrupt-contract','self-consistent-non-v2-contract'].includes(failure)) expect(blocked[0].originalRefs).toEqual([])
    else expect(blocked[0].originalRefs.length).toBeGreaterThan(0)
    expect((await readPendingCodexExtractionCandidateV1({ scope: fixture.scope, categoryId: fixture.request.categoryId, worldGroupId: null }))?.snapshot.run.id).toBe(legacy.snapshot.run.id)
    expect(await readRecoverableCodexExtractionV2({ scope: fixture.scope, categoryId: fixture.request.categoryId, worldGroupId: null })).toBeNull()
    const calls = posts.length
    await expect(generateCodexExtractionCandidateV2(badInput)).rejects.toThrow('不重新发送')
    expect(posts).toHaveLength(calls)
    expect({ runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(),
      artifacts: await db.agentRunArtifacts.toArray(), checkpoints: await db.agentRunCheckpoints.toArray() }).toEqual(originalRows)
  })

  it('does not guess an uncommitted root target from the objective or attach it to a new Work, and blocks replacement inference', async () => {
    const fixture = await seed(), posts = http(), original = artifacts.recordAgentRunArtifactV1
    const save = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
      if (JSON.parse(input.content).version === 'codex-extraction-root-v2') throw new Error('root did not commit')
      return original(input)
    })
    await expect(generateCodexExtractionCandidateV2(fixture)).rejects.toThrow(); save.mockRestore()
    const badId = await soleRun(), blocked: BlockedCodexExtractionRunV2[] = []
    const before = await db.agentRunEvents.toArray()
    expect(await readRecoverableCodexExtractionV2({ scope: fixture.scope, categoryId: fixture.request.categoryId, worldGroupId: null },
      { onBlockedRun: row => { blocked.push(row) } })).toBeNull()
    expect(blocked).toEqual([expect.objectContaining({ runId: badId, target: null, reason: 'unverified-run-or-target', originalRefs: [] })])
    const foreign = await seedCurrentWorkspace('another original Work')
    const foreignBlocked: BlockedCodexExtractionRunV2[] = []
    expect(await readRecoverableCodexExtractionV2({ scope: foreign.scope }, { onBlockedRun: row => { foreignBlocked.push(row) } })).toBeNull()
    expect(foreignBlocked).toEqual([])
    await expect(generateCodexExtractionCandidateV2(fixture)).rejects.toThrow('不重新发送')
    expect(posts).toHaveLength(0); expect(await db.agentRunEvents.toArray()).toEqual(before)
  })

  it.each([
    { axis: 'category', groups: 'null' }, { axis: 'category', groups: 'numeric' },
    { axis: 'group', groups: 'null-to-numeric' }, { axis: 'group', groups: 'numeric-to-null' }, { axis: 'group', groups: 'numeric-to-numeric' },
  ])('isolates the independent $axis axis ($groups), retaining normal V1/V2 and refusing the exact blocked target', async ({ axis, groups }) => {
    const fixture = await seed(), now = Date.now()
    await db.projects.update(fixture.scope.projectId, { enableMultiWorld: true })
    const firstGroup = await db.worldGroups.add({ projectId: fixture.scope.projectId, worldId: fixture.scope.worldId, name: '分组一',
      description: '', type: 'primary', icon: '🌙', order: 1, createdAt: now, updatedAt: now })
    const secondGroup = await db.worldGroups.add({ projectId: fixture.scope.projectId, worldId: fixture.scope.worldId, name: '分组二',
      description: '', type: 'primary', icon: '🌊', order: 2, createdAt: now, updatedAt: now })
    const goodGroup = groups === 'null' || groups === 'null-to-numeric' ? null : firstGroup
    const badGroup = axis === 'category' ? goodGroup : groups === 'numeric-to-null' ? null : groups === 'null-to-numeric' ? firstGroup : secondGroup
    let badCategory = fixture.request.categoryId
    if (axis === 'category') {
      const category = (await db.codexCategories.get(badCategory))!
      badCategory = await db.codexCategories.add(stampNewRecord<CodexCategory>(fixture.scope, 'codexCategories', {
        projectId: fixture.scope.projectId, domain: category.domain, parentId: category.parentId,
        name: '仅分类不同', icon: category.icon, builtInKey: 'mineral', fieldSchema: category.fieldSchema,
        hidden: category.hidden, order: category.order, createdAt: now, updatedAt: now,
      }, { owner: 'world' }))
      expect(badGroup).toBe(goodGroup); expect(badCategory).not.toBe(fixture.request.categoryId)
    } else { expect(badCategory).toBe(fixture.request.categoryId); expect(badGroup).not.toBe(goodGroup) }
    await stampCurrentFixtureResourceUidsV1(fixture.scope.projectId)
    const goodInput = { ...fixture, request: { ...fixture.request, worldGroupId: goodGroup } }
    const badInput = { ...fixture, request: { ...fixture.request, categoryId: badCategory, worldGroupId: badGroup } }
    const posts = http(), good = await generateCodexExtractionCandidateV2(goodInput)
    const legacy = await generateCodexExtractionCandidateV1({ ...goodInput, runAI: async () => JSON.stringify([entry()]) })
    const original = artifacts.recordAgentRunArtifactV1
    const save = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
      if (JSON.parse(input.content).version === 'codex-extraction-plan-v2') throw new Error('isolated partial target plan')
      return original(input)
    })
    await expect(generateCodexExtractionCandidateV2(badInput)).rejects.toThrow(); save.mockRestore()
    const runsAfterFailure = await db.agentRuns.toArray()
    const badId = runsAfterFailure[runsAfterFailure.length - 1]!.id!, blocked: BlockedCodexExtractionRunV2[] = []
    const before = { runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(), artifacts: await db.agentRunArtifacts.toArray() }
    const filter = { scope: fixture.scope, categoryId: fixture.request.categoryId, worldGroupId: goodGroup }
    expect((await readPendingCodexExtractionCandidateV2(filter, { onBlockedRun: run => { blocked.push(run) } }))?.snapshot.run.id).toBe(good.snapshot.run.id)
    expect((await readPendingCodexExtractionCandidateV1(filter))?.snapshot.run.id).toBe(legacy.snapshot.run.id)
    expect(blocked).toEqual([expect.objectContaining({ runId: badId, target: { categoryId: badCategory, worldGroupId: badGroup } })])
    await expect(generateCodexExtractionCandidateV2(badInput)).rejects.toThrow('不重新发送')
    expect(posts).toHaveLength(1)
    expect({ runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(), artifacts: await db.agentRunArtifacts.toArray() }).toEqual(before)
  })

  it('rolls back all adopted rows and adoption.committed when a same-transaction followup fails, then retries only the frozen intent', async () => {
    const fixture = await seed(); http()
    const generated = await generateCodexExtractionCandidateV2(fixture)
    const original = events.appendPrivilegedAgentRunEventInTransactionV1
    const append = vi.spyOn(events, 'appendPrivilegedAgentRunEventInTransactionV1').mockImplementation(async (...args) => {
      const result = await original(...args)
      if (args[1].type === 'adoption.committed') throw new Error('after in-transaction event failure')
      return result
    })
    const adoptOriginal = adoption.adopt
    const transactions: unknown[] = []
    const adopt = vi.spyOn(adoption, 'adopt').mockImplementation(async (input, options) => {
      expect(options?.transaction).toBe(Dexie.currentTransaction)
      expect(options?.transaction?.active).toBe(true)
      transactions.push(options?.transaction)
      return adoptOriginal(input, options)
    })
    await expect(adoptCodexExtractionCandidateV2({ scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0] })).rejects.toThrow()
    expect(transactions).toHaveLength(1); expect(await db.codexEntries.count()).toBe(0)
    const read = await readCodexExtractionStateV2({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(read.intent).toBeTruthy(); expect(read.selectionFrozen).toBe(true)
    expect(read.snapshot.events.some(row => row.type === 'adoption.committed')).toBe(false)
    await expect(abandonCodexExtractionV2({ scope: fixture.scope, runId: generated.snapshot.run.id })).rejects.toThrow()
    await expect(adoptCodexExtractionCandidateV2({ scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [] })).rejects.toThrow()
    append.mockRestore(); adopt.mockRestore()
    const resumed = await adoptCodexExtractionCandidateV2({ scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0] })
    expect(resumed.written).toBe(1); expect(await db.codexEntries.count()).toBe(1)
  })

  it('refuses a stale baseline rather than merging an existing identity', async () => {
    const fixture = await seed(); http()
    const generated = await generateCodexExtractionCandidateV2(fixture)
    await db.codexCategories.update(fixture.request.categoryId, { fieldSchema: '[{"key":"new","label":"新增字段","type":"text"}]', updatedAt: Date.now() + 1 })
    await expect(adoptCodexExtractionCandidateV2({ scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0] })).rejects.toThrow()
    expect(await db.codexEntries.count()).toBe(0)
  })

  it.each(['closed','readonly','foreign','missing-tables'] as const)('rejects a %s caller transaction without any formal rows', async kind => {
    const fixture = await seed(); http()
    const generated = await generateCodexExtractionCandidateV2(fixture)
    const read = await readCodexExtractionStateV2({ scope: fixture.scope, runId: generated.snapshot.run.id })
    const compiled = await compileCodexExtractionReviewV2({ root: read.materials.root, candidate: read.candidate!, candidateRef: read.candidateRef!,
      entries: read.candidate!.entries, selectedIndexes: [0], sourceText, baseline: read.materials.baselineState })
    const input = { projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: null,
      target: 'codexEntries', mode: 'add-many' as const, data: compiled.formalItems }
    const tables = adoption.adoptionTransactionTablesV1('codexEntries', undefined, { callerOwned: true })
    if (kind === 'closed') {
      let closed: typeof Dexie.currentTransaction
      await db.transaction('rw', tables, () => { closed = Dexie.currentTransaction })
      await expect(adoption.adopt(input, { transaction: closed! })).rejects.toThrow()
    } else if (kind === 'readonly') {
      await expect(db.transaction('r', tables, () => adoption.adopt(input, { transaction: Dexie.currentTransaction! }))).rejects.toThrow()
    } else if (kind === 'missing-tables') {
      await expect(db.transaction('rw', db.codexEntries, () => adoption.adopt(input, { transaction: Dexie.currentTransaction! }))).rejects.toThrow()
    } else {
      const foreign = new Dexie('B01-explicit-foreign-transaction-fixture'); foreign.version(1).stores({ guard: '++id' })
      try { await expect(foreign.transaction('rw', foreign.table('guard'), () => adoption.adopt(input, { transaction: Dexie.currentTransaction! }))).rejects.toThrow() }
      finally { await foreign.delete() }
    }
    expect(await db.codexEntries.count()).toBe(0)
    expect((await events.readAgentRunV1(fixture.scope, generated.snapshot.run.id)).events.some(row => row.type === 'adoption.committed')).toBe(false)
  })

  it.each([
    { committedBeforeThrow: false, ackCommitted: false }, { committedBeforeThrow: true, ackCommitted: false },
    { committedBeforeThrow: false, ackCommitted: true }, { committedBeforeThrow: true, ackCommitted: true },
  ])('C29 ack/pending unknowns preserve actual prefix ($committedBeforeThrow/$ackCommitted) without replay', async ({ committedBeforeThrow, ackCommitted }) => {
    const nativeConfig: AIConfig = { ...config, provider: 'codex', baseUrl: '/storyforge/local-codex/v1' }
    const fixture = await seed(nativeConfig), posts: string[] = [], acknowledgements: unknown[] = []
    let ownerAcknowledgedAt: number | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/status')) return json({ state: 'ready' })
      if (url.endsWith('/acknowledge')) { acknowledgements.push(JSON.parse(String(init?.body))); if (ackCommitted) ownerAcknowledgedAt = 123; throw new TypeError('ack result unknown') }
      if (init?.method === 'POST') { posts.push(String(init.body)); return json({ id: JSON.parse(posts[0]).id }, 202) }
      const body = JSON.parse(posts[0]), hash = await sha256Text(posts[0])
      return json({ id: body.id, model: body.model, createdAt: 1, status: 'completed', text: JSON.stringify([entry()]), dispatched: true,
        requestHash: hash, requestHashAlgorithm: 'sha256-json-request-v1', receiptRetention: 'until-owner-ack-v1', usage: { inputTokens: 0 }, ownerAcknowledgedAt })
    }))
    const original = artifacts.recordAgentRunArtifactV1
    const save = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
      if (JSON.parse(input.content).version === 'codex-native-handoff-pending-v2') {
        if (committedBeforeThrow) await original(input)
        throw new Error('pending save not returned')
      }
      return original(input)
    })
    let failure: unknown
    try { await generateCodexExtractionCandidateV2(fixture) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(PreparedRequestStoppedV2)
    const handoff = (failure as PreparedRequestStoppedV2).cause
    expect(handoff).toBeInstanceOf(CodexNativeHandoffStoppedV2)
    save.mockRestore()
    const runId = await soleRun(), read = await readCodexExtractionStateV2({ scope: fixture.scope, runId })
    expect(posts).toHaveLength(1); expect(acknowledgements).toHaveLength(1); expect(read.responses).toHaveLength(1)
    expect(acknowledgements[0]).toMatchObject({ rawResponseHash: await sha256Text(read.responses[0].body.response.text) })
    const pending = read.snapshot.events.filter(row => row.type === 'evidence.artifact.recorded' && row.payload.artifactKind === 'tool-result')
    const pendingBodies = await Promise.all(pending.map(row => {
      if (row.type !== 'evidence.artifact.recorded') throw Error('type guard')
      return artifacts.readAgentRunArtifactExactV1({ projectId: fixture.scope.projectId, artifactKind: 'tool-result', contentHash: row.payload.contentHash })
    }))
    expect(pendingBodies.filter(body => JSON.parse(body).version === 'codex-native-handoff-pending-v2')).toHaveLength(committedBeforeThrow ? 1 : 0)
    const prefix = read.snapshot.projection.lastSequence
    const known = (handoff as CodexNativeHandoffStoppedV2).lastKnownCommittedSnapshot.projection.lastSequence
    if (committedBeforeThrow) expect(known).toBeLessThan(prefix)
    else expect(known).toBe(prefix)
    const proof = await inspectCodexNativeHandoffV2({ scope: fixture.scope, runId, refs: chain(read) })
    expect(proof.nativeReceipt.ownerAcknowledgedAt).toBe(ackCommitted ? 123 : undefined)
    expect((await events.readAgentRunV1(fixture.scope, runId)).projection.lastSequence).toBe(prefix)
    expect(acknowledgements).toHaveLength(1)
    const resumed = await resumeCodexExtractionCandidateV2({ scope: fixture.scope, runId })
    expect(resumed.candidate.entries[0].name).toBe('月栖花')
    const after = await readCodexExtractionStateV2({ scope: fixture.scope, runId })
    expect(after.responses).toHaveLength(1)
    expect(after.snapshot.events.filter(row => row.type === 'model.responded')).toHaveLength(1)
    expect(posts).toHaveLength(1); expect(acknowledgements).toHaveLength(1)
  })

  it('exports exact V2 evidence through the existing project lifecycle without granting imported execution authority', async () => {
    const fixture = await seed(); http()
    const generated = await generateCodexExtractionCandidateV2(fixture), before = await readCodexExtractionStateV2({ scope: fixture.scope, runId: generated.snapshot.run.id })
    const exported = await exportProjectJSON(fixture.scope.projectId)
    expect(JSON.stringify(exported)).toContain(before.rootRef.contentHash)
    expect(JSON.stringify(exported)).not.toContain('HIDDEN')
    const imported = await importProjectJSON(exported)
    expect(imported).not.toBe(fixture.scope.projectId)
    const importedProject = (await db.projects.get(imported))!
    const importedScope = { projectId: imported, worldId: importedProject.activeWorldId!, workId: importedProject.activeWorkId! }
    const importedRuns = await db.agentRuns.where('projectId').equals(imported).toArray()
    expect(importedRuns).toHaveLength(1)
    const importedRun = importedRuns[0], importedId = importedRun.id!
    expect(importedId).not.toBe(generated.snapshot.run.id)
    expect(importedRun.workId).toBe(importedScope.workId)
    const originals = { runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(), artifacts: await db.agentRunArtifacts.toArray(),
      checkpoints: await db.agentRunCheckpoints.toArray(), entries: await db.codexEntries.toArray(), usage: await db.aiUsageLog.toArray() }
    const transport = vi.mocked(fetch), transportCalls = transport.mock.calls.length
    const blocked: BlockedCodexExtractionRunV2[] = []
    const filter = { scope: importedScope }
    expect(await readPendingCodexExtractionCandidateV2(filter, { onBlockedRun: run => { blocked.push(run) } })).toBeNull()
    expect(await readRecoverableCodexExtractionV2(filter, { onBlockedRun: run => { blocked.push(run) } })).toBeNull()
    // The actual import may already be terminal under the existing lifecycle;
    // either way its exact new identity has only this readonly diagnostic.
    const diagnostic = await inspectCodexExtractionRunForLookupV2({ scope: importedScope, runId: importedId })
    expect(diagnostic.kind).toBe('blocked')
    if (diagnostic.kind === 'blocked') {
      expect(diagnostic.blocked).toMatchObject({ runId: importedId, scope: importedScope, target: null })
    }
    expect(blocked.every(run => run.runId === importedId && run.scope.projectId === imported && run.scope.workId === importedScope.workId)).toBe(true)
    await expect(resumeCodexExtractionCandidateV2({ scope: importedScope, runId: importedId, aiConfig: config })).rejects.toThrow()
    await expect(adoptCodexExtractionCandidateV2({ scope: importedScope, runId: importedId, selectedIndexes: [0] })).rejects.toThrow()
    expect(transport).toHaveBeenCalledTimes(transportCalls)
    expect({ runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(), artifacts: await db.agentRunArtifacts.toArray(),
      checkpoints: await db.agentRunCheckpoints.toArray(), entries: await db.codexEntries.toArray(), usage: await db.aiUsageLog.toArray() }).toEqual(originals)
    // Original immutable bytes remain addressable only through original Run membership.
    expect((await readCodexExtractionStateV2({ scope: fixture.scope, runId: generated.snapshot.run.id })).candidate).toEqual(before.candidate)
  })
})
