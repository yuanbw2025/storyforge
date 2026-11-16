import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chat, type ChatResult } from '../../src/lib/ai/client'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import { db } from '../../src/lib/db/schema'
import type { AIConfig, Chapter, ChatMessage, DetailedOutline, OutlineNode } from '../../src/lib/types'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { buildChapterInformationBoundaryV1 } from '../../src/lib/agent/information-boundary'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { runDurableProseSemanticReviewV1 } from '../../src/lib/agent/run/prose-semantic-durable'
import {
  beginProseGenerationGatewayStepV1,
  createProseGenerationDurableRunV1,
  finalizeProseGenerationGatewayStepV1,
  readLatestProseGenerationCandidateV1,
} from '../../src/lib/agent/run/prose-generation-durable'

const original = '守灯人说出了月井密钥。'
const revisionRaw = '\r\n 守灯人站在潮门外，只观察潮水退去。e\u0301。\r\n\t'
const reviewRaw = `\r\n ${JSON.stringify({ issues: [{
  code: 'pov-knowledge-leak', severity: 'blocking', candidateQuote: original,
  evidence: [{ sourceKey: 'ragSelection', quote: '不知道月井密钥' }],
  reason: '守灯人使用了尚未知晓的密钥 e\u0301。',
  revisionInstruction: '只观察潮水，不说出密钥。', autoRevisable: true,
}] })}\r\n\t`
const rereviewRaw = ' \r\n{"issues":[]}\n\t'
const phases = ['prose-semantic-review', 'prose-semantic-revision', 'prose-semantic-rereview']
const config: AIConfig = { provider: 'custom', apiKey: '', model: 'isolated-semantic', baseUrl: 'http://127.0.0.1:9/v1', temperature: 0, maxTokens: 1_024, contextWindow: 128_000 }

async function fixture() {
  const { scope } = await seedCurrentWorkspace('002 explicit semantic raw')
  const now = Date.now()
  const outline: OutlineNode = { projectId: scope.projectId, parentId: null, type: 'chapter', title: '潮门', summary: '守灯人在潮门外观察退潮，不知道月井密钥。', order: 0, createdAt: now, updatedAt: now }
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', outline, { owner: 'work' }))
  const detail: DetailedOutline = { projectId: scope.projectId, outlineNodeId, scenes: [{ sceneId: 'observe-tide', title: '观察退潮', summary: '守灯人在潮门外观察退潮。', characterIds: [], location: '潮门', conflict: '秘密不可泄漏', pace: 'medium', estimatedWords: 1_000, notes: '' }], prohibitions: ['守灯人不知道月井密钥'], lastUsedSummary: outline.summary, createdAt: now, updatedAt: now }
  await db.detailedOutlines.add(stampNewRecord(scope, 'detailedOutlines', detail, { owner: 'work' }))
  const chapter: Chapter = { projectId: scope.projectId, outlineNodeId, title: '潮门', content: '', wordCount: 0, status: 'outline', order: 0, notes: '', createdAt: now, updatedAt: now, perspectiveCharacterId: null }
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', chapter, { owner: 'work' }))
  let snapshot = await createProseGenerationDurableRunV1({ scope, worldGroupId: null, chapterId, operation: 'generate', semanticReview: true })
  const generationAssembled = await prepareProseGatewayAssemblyV1({ projectId: scope.projectId, scope, worldGroupId: null, chapterId, outlineNodeId, operation: 'generate', authorRequest: '写潮门正文', perspectiveCharacterId: null, config })
  const informationBoundary = await buildChapterInformationBoundaryV1({ scope, chapterId, outlineNodeId, worldGroupId: null, perspectiveCharacterId: null })
  const generationMessages: ChatMessage[] = [{ role: 'user', content: `受控资料：\n${generationAssembled.text}\n\n写潮门正文` }]
  const begun = await beginProseGenerationGatewayStepV1({
    scope, snapshot, worldGroupId: null, chapterId, outlineNodeId, assembled: generationAssembled, messages: generationMessages,
    binding: { operation: 'generate', sourceTextHash: await hashChapterText(''), promptHash: await hashCanonicalValue(generationMessages), informationBoundaryHash: informationBoundary.manifestHash },
    budgetReservationTokens: 18_000,
  })
  snapshot = (await finalizeProseGenerationGatewayStepV1({ scope, snapshot: begun.snapshot, attempt: begun.attempt, output: original, usedTokens: 1_200 })).snapshot
  const input = {
    scope, snapshot, projectId: scope.projectId, worldGroupId: null, chapterId, outlineNodeId,
    chapterTitle: '潮门', originalText: original, generationMessages, generationAssembled, informationBoundary,
    generationProvider: 'synthetic', generationModel: 'generator', reviewerProvider: 'synthetic', reviewerModel: 'reviewer',
    budget: new AgentTeamBudgetTracker('balanced'),
  }
  return { scope, chapterId, input, current: () => readAgentRunV1(scope, snapshot.run.id) }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
interface EvidenceBody {
  raw?: string
  requestArtifactHash?: string
  contextManifestHash: string
  generation?: number
  contractHash?: string
  stepId?: string
  attempt?: number
  messages?: ChatMessage[]
  observation?: { outcome: 'returned' | 'unavailable'; usage: ChatResult['usage'] | null; finishReason: string | null; requestLifecycle: ChatResult['requestLifecycle'] | null }
}
async function evidence(f: Fixture, kind: 'raw-response' | 'rendered-request' | 'tool-result') {
  const snapshot = await f.current()
  const refs = []
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== kind || !event.payload.stepId?.startsWith('prose-semantic-')) continue
    const content = await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: kind, contentHash: event.payload.contentHash })
    refs.push({ event, body: JSON.parse(content) as EvidenceBody })
  }
  return refs
}
async function assertRaw(f: Fixture, outputs: string[]) {
  const refs = await evidence(f, 'raw-response')
  expect(refs.map(ref => ref.body.raw)).toEqual(outputs)
  const requests = await evidence(f, 'rendered-request')
  const snapshot = await f.current()
  for (const [index, ref] of refs.entries()) {
    expect(ref.event.payload.stepId).toBe(phases[index])
    expect(ref.event.payload.attempt).toBe(1)
    const request = requests.find(item => item.event.payload.contentHash === ref.body.requestArtifactHash)
    const requested = snapshot.events.find(event => event.type === 'model.requested' && event.payload.stepId === phases[index])
    const context = snapshot.events.find(event => event.type === 'context.assembled' && event.payload.stepId === phases[index])
    if (!request || !requested || context?.type !== 'context.assembled') throw new Error('Missing real semantic request/manifest events')
    expect(request.event.sequence).toBeLessThan(requested.sequence)
    expect(requested.sequence).toBeLessThan(ref.event.sequence)
    expect(request.body).toMatchObject({ generation: snapshot.projection.generation, contractHash: snapshot.projection.contractHash, stepId: phases[index], attempt: 1, contextManifestHash: context.payload.manifestHash })
    expect(ref.body.contextManifestHash).toBe(context.payload.manifestHash)
    expect(request.body.messages?.length).toBeGreaterThan(0)
    const responded = snapshot.events.find(event => event.type === 'model.responded' && event.payload.stepId === phases[index])
    if (responded) expect(ref.event.sequence).toBeLessThan(responded.sequence)
  }
  return refs
}
function containsCause(value: unknown, target: unknown): boolean {
  if (value === target) return true
  if (!value || typeof value !== 'object') return false
  const error = value as { cause?: unknown; persistenceFailures?: unknown[] }
  return containsCause(error.cause, target) || !!error.persistenceFailures?.some(item => containsCause(item, target))
}
function observedCall() {
  return vi.fn((messages: ChatMessage[], result: ChatResult) => chat(messages, config, undefined, undefined, result))
}
function stubResponses(outputs: Array<string | null>) {
  let next = 0
  expectedPosts = outputs.length
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => {
    const index = next++
    if (index >= outputs.length) throw new Error('Unexpected extra model call')
    return new Response(JSON.stringify({ choices: [{ message: { content: outputs[index] }, finish_reason: 'stop' }], usage: { prompt_tokens: 13 + index, completion_tokens: 5, total_tokens: 18 + index } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
}
let expectedPosts = 0
beforeEach(async () => {
  await db.delete(); await db.open(); expectedPosts = 0
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('No real model/network authorized') }))
})
afterEach(async () => {
  try { expect(fetch).toHaveBeenCalledTimes(expectedPosts) }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete() }
})

describe('SFQA-002 explicit prose semantic per-attempt raw evidence', () => {
  it('retains all three exact responses before the next call, keeps opaque usage unknown and reopens without a model call', async () => {
    const f = await fixture()
    const sent: ChatMessage[][] = []
    const review = vi.fn(async (messages: ChatMessage[]): Promise<string> => {
      sent.push(structuredClone(messages))
      if (review.mock.calls.length === 2) expect((await assertRaw(f, [reviewRaw, revisionRaw])).length).toBe(2)
      return review.mock.calls.length === 1 ? reviewRaw : rereviewRaw
    })
    const revise = vi.fn(async (messages: ChatMessage[]) => {
      sent.push(structuredClone(messages))
      expect((await assertRaw(f, [reviewRaw])).length).toBe(1)
      return revisionRaw
    })
    const result = await runDurableProseSemanticReviewV1({ ...f.input, review, revise })
    expect(result.cycle.status).toBe('passed')
    expect(result.cycle.outputText).toBe(revisionRaw)
    const refs = await assertRaw(f, [reviewRaw, revisionRaw, rereviewRaw])
    expect(refs[0]!.body.raw?.normalize('NFC')).not.toBe(reviewRaw)
    expect(refs.every(ref => ref.body.observation?.usage === null)).toBe(true)
    expect((await evidence(f, 'rendered-request')).map(ref => ref.body.messages)).toEqual(sent)
    const before = JSON.stringify(await Promise.all(db.tables.map(table => table.toArray())))
    db.close(); await db.open()
    await assertRaw(f, [reviewRaw, revisionRaw, rereviewRaw])
    expect(await readLatestProseGenerationCandidateV1({ scope: f.scope, chapterId: f.chapterId })).toBeNull()
    expect(JSON.stringify(await Promise.all(db.tables.map(table => table.toArray())))).toBe(before)
    expect(review).toHaveBeenCalledTimes(2); expect(revise).toHaveBeenCalledTimes(1)
  })

  it('binds real client usage and request lifecycle independently for initial review, revision and rereview', async () => {
    const f = await fixture(); stubResponses([reviewRaw, revisionRaw, rereviewRaw])
    const review = observedCall(); const revise = observedCall()
    const result = await runDurableProseSemanticReviewV1({ ...f.input, review: { call: review }, revise: { call: revise } })
    expect(result.cycle.status).toBe('passed')
    const refs = await assertRaw(f, [reviewRaw, revisionRaw, rereviewRaw])
    refs.forEach((ref, index) => expect(ref.body.observation).toMatchObject({ outcome: 'returned', usage: { inputTokens: 13 + index, outputTokens: 5, totalTokens: 18 + index }, finishReason: 'stop', requestLifecycle: { phase: 'response-observed', responseStatus: 200 } }))
    expect(review).toHaveBeenCalledTimes(2); expect(revise).toHaveBeenCalledTimes(1)
  })

  for (const failedPhase of [0, 1, 2]) it(`keeps the original malformed response at phase ${failedPhase + 1} and never starts a later call`, async () => {
    const f = await fixture()
    const raw = failedPhase === 1 ? ' \r\n\t' : 'AUDIT_INVALID_SEMANTIC_RESPONSE_8273 definitely not JSON'
    const outputs = [reviewRaw, revisionRaw, rereviewRaw]; outputs[failedPhase] = raw
    let call = 0
    const receive = vi.fn(async () => outputs[call++]!)
    await expect(runDurableProseSemanticReviewV1({ ...f.input, review: receive, revise: receive })).rejects.toThrow(failedPhase === 1 ? '语义修订没有返回正文' : '语义评审没有返回 JSON 对象')
    await assertRaw(f, outputs.slice(0, failedPhase + 1))
    expect(receive).toHaveBeenCalledTimes(failedPhase + 1)
    const snapshot = await f.current()
    expect(snapshot.projection.steps[phases[failedPhase]!]!.status).toBe('failed')
    expect(snapshot.events.some(event => event.type === 'candidate.persisted')).toBe(false)
    const mainRaw = snapshot.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response' && event.payload.stepId === 'prose-generation')
    if (mainRaw?.type !== 'evidence.artifact.recorded') throw new Error('Original prose raw evidence missing')
    expect(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: mainRaw.payload.contentHash })).toContain(original)
  })

  it('a native raw transaction failure preserves observed metering and its cause, then blocks parsing and revision', async () => {
    const f = await fixture(); stubResponses([reviewRaw])
    const primary = new Error('002 semantic native raw write failed')
    const nativeAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
    let attempted = false
    vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(record => nativeAdd(record).then(id => {
      if (record.artifactKind === 'raw-response') { attempted = true; throw primary }
      return id
    }))
    const review = observedCall(); const revise = vi.fn(async () => revisionRaw)
    let error: unknown
    try { await runDurableProseSemanticReviewV1({ ...f.input, review: { call: review }, revise }) } catch (caught) { error = caught }
    expect(attempted).toBe(true); expect(containsCause(error, primary)).toBe(true)
    expect(await evidence(f, 'raw-response')).toHaveLength(0)
    expect((await evidence(f, 'tool-result'))[0]?.body.observation).toMatchObject({ outcome: 'returned', usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 } })
    expect((await f.current()).projection.steps[phases[0]!]!.status).toBe('failed')
    expect(review).toHaveBeenCalledTimes(1); expect(revise).not.toHaveBeenCalled()
  })

  it('a small observation write failure still keeps exact returned raw and usage without parsing or issuing a revision', async () => {
    const f = await fixture(); stubResponses([reviewRaw])
    const primary = new Error('002 semantic observation write failed')
    const nativeAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
    vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(record => nativeAdd(record).then(id => {
      if (record.artifactKind === 'tool-result') throw primary
      return id
    }))
    const review = observedCall(); const revise = vi.fn(async () => revisionRaw)
    let error: unknown
    try { await runDurableProseSemanticReviewV1({ ...f.input, review: { call: review }, revise }) } catch (caught) { error = caught }
    expect(containsCause(error, primary)).toBe(true)
    const [ref] = await assertRaw(f, [reviewRaw])
    expect(ref?.body.observation?.usage).toEqual({ inputTokens: 13, outputTokens: 5, totalTokens: 18 })
    expect(await evidence(f, 'tool-result')).toHaveLength(0)
    expect((await f.current()).projection.steps[phases[0]!]!.status).toBe('failed')
    expect(review).toHaveBeenCalledTimes(1); expect(revise).not.toHaveBeenCalled()
  })

  it('request persistence failure prevents even the first dispatch and leaves no fabricated unavailable response', async () => {
    const f = await fixture()
    const primary = new Error('002 semantic request write failed')
    const nativeAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
    vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(record => nativeAdd(record).then(id => {
      if (record.artifactKind === 'rendered-request') throw primary
      return id
    }))
    const receive = vi.fn(async () => reviewRaw)
    await expect(runDurableProseSemanticReviewV1({ ...f.input, review: receive, revise: receive })).rejects.toThrow(primary.message)
    expect(receive).not.toHaveBeenCalled()
    expect(await evidence(f, 'rendered-request')).toHaveLength(0)
    expect(await evidence(f, 'tool-result')).toHaveLength(0)
    expect((await f.current()).events.some(event => event.type === 'model.requested' && event.payload.stepId === phases[0])).toBe(false)
  })

  it('a real-client response without text retains observable usage, invents no raw and never retries', async () => {
    const f = await fixture(); stubResponses([null])
    const review = observedCall(); const revise = vi.fn(async () => revisionRaw)
    await expect(runDurableProseSemanticReviewV1({ ...f.input, review: { call: review }, revise })).rejects.toThrow()
    expect(await evidence(f, 'raw-response')).toHaveLength(0)
    expect((await evidence(f, 'tool-result'))[0]?.body.observation).toMatchObject({ outcome: 'unavailable', usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 } })
    expect(review).toHaveBeenCalledTimes(1); expect(revise).not.toHaveBeenCalled()
  })

  it('an opaque transport failure stays the original error, with unknown usage and no invented text', async () => {
    const f = await fixture()
    const primary = new Error('002 semantic opaque transport failure')
    const receive = vi.fn(async (): Promise<string> => { throw primary })
    await expect(runDurableProseSemanticReviewV1({ ...f.input, review: receive, revise: receive })).rejects.toBe(primary)
    expect(await evidence(f, 'raw-response')).toHaveLength(0)
    expect((await evidence(f, 'tool-result'))[0]?.body.observation).toMatchObject({ outcome: 'unavailable', usage: null, requestLifecycle: null })
    expect(receive).toHaveBeenCalledTimes(1)
  })
})
