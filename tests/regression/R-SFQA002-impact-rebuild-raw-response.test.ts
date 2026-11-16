import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { AIConfig, AgentRunRecord, Chapter, ChatMessage, OutlineNode, StoryCore, StoryTimelineEvent, TemporalFact, WorldGroup } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { buildEditImpactGraphV1 } from '../../src/lib/consistency/impact-analysis'
import { buildImpactRemediationPlanV1 } from '../../src/lib/consistency/impact-remediation-plan'
import { buildImpactHandoffV2 } from '../../src/lib/consistency/impact-handoff'
import { executeImpactAuthorReviewV1 } from '../../src/lib/agent/run/impact-review-durable'
import { beginImpactManualCorrectionV1, completeImpactManualCorrectionV1 } from '../../src/lib/agent/run/impact-manual-correction-durable'
import { executeImpactPostCorrectionReplanV1 } from '../../src/lib/agent/run/impact-post-correction-replan-durable'
import { generateImpactOutlineRegenerationCandidateV1, adoptImpactOutlineRegenerationCandidateV1, readPendingImpactOutlineRegenerationCandidateV1, rejectImpactOutlineRegenerationCandidateV1 } from '../../src/lib/agent/run/impact-outline-regeneration-durable'
import { generateImpactStoryTimelineRegenerationCandidateV1, adoptImpactStoryTimelineRegenerationCandidateV1, readPendingImpactStoryTimelineRegenerationCandidateV1, rejectImpactStoryTimelineRegenerationCandidateV1 } from '../../src/lib/agent/run/impact-story-timeline-regeneration-durable'
import { readAgentRunV1, staleAgentRunVerificationV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1, recordAgentRunArtifactV1 } from '../../src/lib/memory/artifact-store'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

type Kind = 'outline' | 'timeline'
type GenerateInput = Parameters<typeof generateImpactOutlineRegenerationCandidateV1>[0]
type GenerateOptions = Pick<GenerateInput, 'runAI' | 'aiConfig' | 'onDurableBoundary'>
const kinds: Kind[] = ['outline', 'timeline']
const aiConfig: AIConfig = { provider: 'custom', apiKey: '', model: 'isolated-model', baseUrl: 'http://127.0.0.1:9/v1', temperature: 0, maxTokens: 2_000, contextWindow: 128_000 }

async function fixture(kind: Kind, dependency: 'acknowledged' | null = 'acknowledged') {
  const created = await seedCurrentWorkspace(`002 impact ${kind}`, { enableMultiWorld: true })
  const { scope } = created
  const { projectId } = scope
  const now = Date.now()
  const worldGroupId = await db.worldGroups.add(stampNewRecord<WorldGroup>(scope, 'worldGroups', { projectId, name: '主世界', description: '', type: 'primary', order: 0, createdAt: now, updatedAt: now }, { owner: 'world' })) as number
  const volumeId = await db.outlineNodes.add(stampNewRecord<OutlineNode>(scope, 'outlineNodes', { projectId, worldGroupId, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0, createdAt: now, updatedAt: now }, { owner: 'work' })) as number
  const sourceOutlineNodeId = await db.outlineNodes.add(stampNewRecord<OutlineNode>(scope, 'outlineNodes', { projectId, worldGroupId, parentId: volumeId, type: 'chapter', title: '第一章', summary: '潮门异动', order: 0, createdAt: now, updatedAt: now }, { owner: 'work' })) as number
  const targetOutlineNodeId = await db.outlineNodes.add(stampNewRecord<OutlineNode>(scope, 'outlineNodes', { projectId, worldGroupId, parentId: volumeId, type: 'chapter', title: '第二章', summary: '钟楼照常回应', order: 1, createdAt: now, updatedAt: now }, { owner: 'work' })) as number
  const sourceChapterId = await db.chapters.add(stampNewRecord<Chapter>(scope, 'chapters', { projectId, outlineNodeId: sourceOutlineNodeId, title: '第一章', content: '<p>潮门只开启一半，钟声穿过旧港。</p>', wordCount: 17, status: 'revised', order: 0, notes: '', createdAt: now, updatedAt: now }, { owner: 'work' })) as number
  const targetChapterId = await db.chapters.add(stampNewRecord<Chapter>(scope, 'chapters', { projectId, outlineNodeId: targetOutlineNodeId, title: '第二章', content: '<p>侦察队确认潮门只开启一半，船队仍无法完整通行。</p>', wordCount: 24, status: 'revised', order: 1, notes: '', createdAt: now, updatedAt: now }, { owner: 'work' })) as number
  const factId = await db.temporalFacts.add(stampNewRecord<TemporalFact>(scope, 'temporalFacts', { projectId, worldGroupId, locationId: null, subjectName: '潮门', predicate: 'state', factKind: 'state', value: '完全开启', validFromChapterId: sourceChapterId, validToChapterId: null, sourceType: 'chapter', sourceChapterId, sourceQuote: '潮门', status: 'confirmed', locked: false, createdAt: now, updatedAt: now }, { owner: 'work' })) as number
  await db.storyCores.add(stampNewRecord<StoryCore>(scope, 'storyCores', { projectId, logline: '潮汐改变港城命运', concept: '', theme: '', centralConflict: '', plotPattern: '', mainPlot: '', subPlots: '', createdAt: now, updatedAt: now }, { owner: 'work' }))
  const eventId = kind === 'timeline' ? await db.storyTimelineEvents.add(stampNewRecord<StoryTimelineEvent>(scope, 'storyTimelineEvents', { projectId, title: '潮门开启', storyTime: '潮汐纪元第七日', importance: 2, description: '潮门完全开启，船队恢复通行。', chapterId: targetChapterId, chapterTitle: '第二章', order: 0, createdAt: now }, { owner: 'work' })) as number : null
  const graph = await buildEditImpactGraphV1(scope, sourceChapterId)
  const plan = await buildImpactRemediationPlanV1(graph)
  const factItem = plan.items.find(row => row.table === 'temporalFacts' && row.recordId === factId)!
  const review = await executeImpactAuthorReviewV1({ scope, worldGroupId, plan, itemId: factItem.id, decision: 'needs-manual-action', note: '把潮门改为半开启再重新规划。' })
  const handoff = buildImpactHandoffV2({ plan, itemId: factItem.id, decision: 'needs-manual-action', reviewRunId: review.snapshot.run.id, reviewReceiptHash: review.receiptHash, sourceOutlineNodeId })
  await beginImpactManualCorrectionV1({ scope, handoff })
  await db.temporalFacts.update(factId, { value: '半开启', updatedAt: now + 1 })
  await completeImpactManualCorrectionV1({ scope, handoff })
  const replan = await executeImpactPostCorrectionReplanV1({ scope, handoff })
  const item = replan.output.plan.items.find(row => row.table === (kind === 'outline' ? 'outlineNodes' : 'storyTimelineEvents') && row.recordId === (kind === 'outline' ? targetOutlineNodeId : eventId))!
  expect(item).toBeDefined()
  const dependencyItem = replan.output.plan.items.find(row => item.dependencyNodeIds.includes(row.nodeId))!
  const dependencyReview = dependency ? await executeImpactAuthorReviewV1({ scope, worldGroupId, plan: replan.output.plan, itemId: dependencyItem.id, decision: dependency, note: '当前正文已复核，可重建对应派生产物。' }) : null
  const payload = kind === 'outline'
    ? { summary: '钟楼根据半开启的潮门安排撤离。', reason: '保留来源原文 e\u0301。', evidenceRefs: ['章节正文', '当前章节大纲'] }
    : { storyTime: '潮汐纪元第七日黄昏', importance: 3, description: '潮门只开启一半，船队尚不能完整通行。', reason: '保留来源原文 e\u0301。', evidenceRefs: ['章节正文', '目标故事年表事件'] }
  const raw = '\r\n  ' + JSON.stringify(payload, null, 3) + '\n\t '
  const generate = (options: GenerateOptions = {}) => {
    const input: GenerateInput = { scope, expectedReplan: replan, itemId: item.id, ...options }
    return kind === 'outline' ? generateImpactOutlineRegenerationCandidateV1(input) : generateImpactStoryTimelineRegenerationCandidateV1(input)
  }
  return { kind, scope, sourceChapterId, targetOutlineNodeId, eventId, replan, item, dependencyReview, raw, generate,
    adopt: (runId: number) => kind === 'outline' ? adoptImpactOutlineRegenerationCandidateV1({ scope, runId }) : adoptImpactStoryTimelineRegenerationCandidateV1({ scope, runId }),
    pending: () => kind === 'outline' ? readPendingImpactOutlineRegenerationCandidateV1({ scope, sourceChapterId }) : readPendingImpactStoryTimelineRegenerationCandidateV1({ scope, sourceChapterId }),
    reject: (runId: number) => kind === 'outline' ? rejectImpactOutlineRegenerationCandidateV1({ scope, runId }) : rejectImpactStoryTimelineRegenerationCandidateV1({ scope, runId }),
  }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function current(f: Fixture) {
  const rows = await db.agentRuns.toArray()
  const child = rows.filter((row: AgentRunRecord) => row.parentRunId === f.replan.snapshot.run.id && row.parentRelation?.startsWith('impact-generative-target:'))
  expect(child).toHaveLength(1)
  return readAgentRunV1(f.scope, child[0]!.id!)
}
interface Evidence {
  version: string
  raw?: string
  requestArtifactHash?: string
  observation?: { outcome: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null; finishReason: string | null; requestLifecycle: { phase: string; responseStatus: number | null } | null }
  messages?: ChatMessage[]
}
async function artifacts(f: Fixture, kind: 'raw-response' | 'tool-result' | 'rendered-request') {
  const snapshot = await current(f)
  const result = []
  for (const event of snapshot.events) if (event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === kind) {
    const content = await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: kind, contentHash: event.payload.contentHash })
    result.push({ event, content, value: JSON.parse(content) as Evidence })
  }
  return result
}
async function assertRaw(f: Fixture, raw: string, unknownUsage = true) {
  const refs = await artifacts(f, 'raw-response')
  expect(refs.map(ref => ref.value.raw)).toEqual([raw])
  const snapshot = await current(f)
  const ref = refs[0]!
  const requested = snapshot.events.find(row => row.type === 'model.requested')!
  const request = snapshot.events.find(row => row.type === 'evidence.artifact.recorded' && row.payload.artifactKind === 'rendered-request' && row.payload.contentHash === ref.value.requestArtifactHash)!
  const responded = snapshot.events.find(row => row.type === 'model.responded')
  expect(request.sequence).toBeLessThan(requested.sequence)
  expect(requested.sequence).toBeLessThan(ref.event.sequence)
  expect(ref.event.payload).toMatchObject({ attempt: 1, stepId: snapshot.contract.executionBindings![0]!.stepId })
  if (responded) expect(ref.event.sequence).toBeLessThan(responded.sequence)
  if (unknownUsage) expect(ref.value.observation?.usage).toBeNull()
  return ref
}
async function formal() {
  return Promise.all([db.chapters.toArray(), db.outlineNodes.toArray(), db.storyTimelineEvents.toArray(), db.temporalFacts.toArray(), db.storyCores.toArray()])
}
function containsCause(value: unknown, target: unknown): boolean {
  if (value === target) return true
  if (!value || typeof value !== 'object') return false
  const row = value as { cause?: unknown; persistenceFailures?: unknown[] }
  return (row.cause != null && containsCause(row.cause, target)) || !!row.persistenceFailures?.some(item => containsCause(item, target))
}
let expectedSyntheticPosts = 0
beforeEach(async () => {
  await db.delete(); await db.open(); expectedSyntheticPosts = 0
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw Error('No real network or model is authorized') }))
})
afterEach(async () => {
  try { expect(fetch).toHaveBeenCalledTimes(expectedSyntheticPosts) }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete() }
})

describe('SFQA-002 impact rebuild per-attempt exact response preservation', () => {
  for (const kind of kinds) {
    it(`${kind}: preserves exact complete return before candidate normalization, reopen and normal explicit adoption`, async () => {
      const f = await fixture(kind); const before = await formal()
      const runAI = vi.fn(async () => f.raw)
      const generated = await f.generate({ runAI })
      expect(await formal()).toEqual(before)
      await assertRaw(f, f.raw)
      expect(generated.candidate.modelOutputHash).toBe(await hashCanonicalValue({ raw: f.raw }))
      const allBefore = JSON.stringify(await Promise.all(db.tables.map(table => table.toArray())))
      db.close(); await db.open()
      const ref = await assertRaw(f, f.raw)
      expect(ref.value.raw?.normalize('NFC')).not.toBe(f.raw)
      expect(JSON.stringify(await Promise.all(db.tables.map(table => table.toArray())))).toBe(allBefore)
      const completed = await f.adopt(generated.snapshot.run.id)
      expect(completed.snapshot.projection.state).toBe('completed')
      expect(completed.receiptHash).toHaveLength(64)
      await assertRaw(f, f.raw)
      expect(runAI).toHaveBeenCalledTimes(1)
    })
    for (const raw of [' \r\n002 complete invalid e\u0301\n ', '{"unexpected":"002 complete wrong-schema e\\u0301"}']) it(`${kind}: exact invalid response ${raw.includes('unexpected') ? 'schema' : 'JSON'} remains after one-call protocol failure`, async () => {
      const f = await fixture(kind); const before = await formal()
      const runAI = vi.fn(async () => raw)
      await expect(f.generate({ runAI })).rejects.toThrow()
      await assertRaw(f, raw)
      expect((await current(f)).projection.state).toBe('failed')
      expect((await current(f)).events.some(row => row.type === 'candidate.persisted')).toBe(false)
      expect(await formal()).toEqual(before)
      expect(runAI).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: raw is committed before a late response hook throws and keeps the primary cause if pause also fails`, async () => {
      const f = await fixture(kind); const primary = new Error('002 original response-hook failure'); const secondary = new Error('002 later pause transaction failure')
      const nativeAdd = db.agentRunEvents.add.bind(db.agentRunEvents)
      vi.spyOn(db.agentRunEvents, 'add').mockImplementation(row => nativeAdd(row).then(id => { if (row.type === 'run.paused') throw secondary; return id }))
      const runAI = vi.fn(async () => f.raw)
      let error: unknown
      try { await f.generate({ runAI, onDurableBoundary: boundary => { if (boundary === 'model.responded') throw primary } }) } catch (cause) { error = cause }
      expect(containsCause(error, primary)).toBe(true)
      expect(containsCause(error, secondary)).toBe(true)
      await assertRaw(f, f.raw)
      expect((await current(f)).events.some(row => row.type === 'candidate.persisted')).toBe(false)
      expect(runAI).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: a checkpoint write failure preserves raw and cannot resend or create a candidate event`, async () => {
      const f = await fixture(kind)
      vi.spyOn(checkpoints, 'createAgentRunCheckpointV1').mockRejectedValueOnce(new Error('002 checkpoint persistence failure'))
      const runAI = vi.fn(async () => f.raw)
      await expect(f.generate({ runAI })).rejects.toThrow('002 checkpoint persistence failure')
      await assertRaw(f, f.raw)
      expect((await current(f)).events.some(row => row.type === 'candidate.persisted')).toBe(false)
      expect(runAI).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: candidate.checkpoint interruption retains exact response and original pending-read recovery`, async () => {
      const f = await fixture(kind); const runAI = vi.fn(async () => f.raw)
      await expect(f.generate({ runAI, onDurableBoundary: boundary => { if (boundary === 'candidate.checkpoint') throw new Error('002 interrupted checkpoint boundary') } })).rejects.toThrow('002 interrupted checkpoint boundary')
      await assertRaw(f, f.raw)
      expect((await f.pending())?.snapshot.projection.state).toBe('awaiting_confirmation')
      expect(runAI).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: stale returned body is retained while original adoption still refuses the changed source`, async () => {
      const f = await fixture(kind)
      const runAI = vi.fn(async () => { await db.chapters.update(f.sourceChapterId, { content: '<p>作者已在另一窗口修改潮门。</p>', updatedAt: Date.now() }); return f.raw })
      const generated = await f.generate({ runAI }); await assertRaw(f, f.raw)
      await expect(f.adopt(generated.snapshot.run.id)).rejects.toThrow()
      expect((await current(f)).events.some(row => row.type === 'adoption.committed')).toBe(false)
      expect(runAI).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: existing client actual usage and response metadata survive without cost estimates`, async () => {
      const f = await fixture(kind); expectedSyntheticPosts = 1
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: f.raw }, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } }), { status: 200 })))
      await f.generate({ aiConfig })
      const ref = await assertRaw(f, f.raw, false)
      expect(ref.value.observation).toMatchObject({ outcome: 'returned', usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 }, finishReason: 'stop', requestLifecycle: { phase: 'response-observed', responseStatus: 200 } })
      expect(ref.content).not.toContain('costUsd')
    })
    for (const mode of ['unknown', 'no-text', '401'] as const) it(`${kind}: ${mode} saves only observable unavailable metadata, pauses and never resends`, async () => {
      const f = await fixture(kind); expectedSyntheticPosts = 1
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => {
        if (mode === 'unknown') throw new TypeError('002 unknown delivery')
        return mode === '401' ? new Response(JSON.stringify({ error: { message: '002 rejected' } }), { status: 401 }) : new Response(JSON.stringify({ choices: [{ message: { content: null }, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } }), { status: 200 })
      }))
      await expect(f.generate({ aiConfig })).rejects.toThrow()
      expect((await current(f)).projection.state).toBe('paused')
      expect(await artifacts(f, 'raw-response')).toHaveLength(0)
      const observation = (await artifacts(f, 'tool-result'))[0]!.value.observation
      expect(observation?.outcome).toBe('unavailable')
      expect(observation?.usage).toEqual(mode === 'no-text' ? { inputTokens: 13, outputTokens: 5, totalTokens: 18 } : null)
      expect((await current(f)).events.some(row => row.type === 'model.responded' || row.type === 'candidate.persisted')).toBe(false)
    })
    it(`${kind}: rendered-request native failure prevents the requested event and model callback`, async () => {
      const f = await fixture(kind); const primary = new Error('002 native rendered-request failure')
      const nativeAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
      vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(row => nativeAdd(row).then(id => { if (row.artifactKind === 'rendered-request') throw primary; return id }))
      const runAI = vi.fn(async () => f.raw)
      await expect(f.generate({ runAI })).rejects.toBe(primary)
      expect((await current(f)).events.some(row => row.type === 'model.requested' || row.type === 'candidate.persisted')).toBe(false)
      expect(runAI).not.toHaveBeenCalled()
    })
    for (const failedKind of ['raw-response', 'tool-result', 'both'] as const) it(`${kind}: ${failedKind} native response evidence failure blocks parse/candidate and preserves observed metering/cause`, async () => {
      const f = await fixture(kind); const primary = new Error('002 original evidence transaction failure'); expectedSyntheticPosts = 1
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: f.raw }, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } }), { status: 200 })))
      const nativeAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
      vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(row => nativeAdd(row).then(id => { if (row.artifactKind === failedKind || failedKind === 'both' && ['raw-response', 'tool-result'].includes(row.artifactKind)) throw primary; return id }))
      let error: unknown
      try { await f.generate({ aiConfig }) } catch (cause) { error = cause }
      expect(containsCause(error, primary)).toBe(true)
      expect(error).toMatchObject({ observation: { outcome: 'returned', usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 } } })
      expect((await current(f)).events.some(row => row.type === 'model.responded' || row.type === 'candidate.persisted')).toBe(false)
      if (failedKind === 'tool-result') expect((await assertRaw(f, f.raw, false)).value.observation?.usage?.totalTokens).toBe(18)
      else expect(await artifacts(f, 'raw-response')).toHaveLength(0)
      if (failedKind === 'raw-response') expect((await artifacts(f, 'tool-result'))[0]!.value.observation?.usage?.totalTokens).toBe(18)
    })
    it(`${kind}: unavailable metering/transport cause survive failed metadata and failed pause transactions`, async () => {
      const f = await fixture(kind); const primary = new Error('002 unavailable evidence failure'); const secondary = new Error('002 unavailable pause failure'); expectedSyntheticPosts = 1
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: null }, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } }), { status: 200 })))
      const nativeArtifactAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
      vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(row => nativeArtifactAdd(row).then(id => { if (row.artifactKind === 'tool-result') throw primary; return id }))
      const nativeEventAdd = db.agentRunEvents.add.bind(db.agentRunEvents)
      vi.spyOn(db.agentRunEvents, 'add').mockImplementation(row => nativeEventAdd(row).then(id => { if (row.type === 'run.paused') throw secondary; return id }))
      let error: unknown
      try { await f.generate({ aiConfig }) } catch (cause) { error = cause }
      expect(containsCause(error, primary)).toBe(true); expect(containsCause(error, secondary)).toBe(true)
      expect(containsCause(error, undefined)).toBe(false)
      const reports: unknown[] = []
      const collect = (value: unknown) => { if (!value || typeof value !== 'object') return; const row = value as { observation?: unknown; cause?: unknown }; if (row.observation) reports.push(row.observation); collect(row.cause) }
      collect(error)
      expect(reports).toContainEqual(expect.objectContaining({ outcome: 'unavailable', usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 } }))
      expect(await artifacts(f, 'raw-response')).toHaveLength(0)
    })
    it(`${kind}: native responded-event rollback cannot erase already committed raw or create a candidate`, async () => {
      const f = await fixture(kind); const primary = new Error('002 native responded-event failure')
      const nativeAdd = db.agentRunEvents.add.bind(db.agentRunEvents)
      vi.spyOn(db.agentRunEvents, 'add').mockImplementation(row => nativeAdd(row).then(id => { if (row.type === 'model.responded') throw primary; return id }))
      const runAI = vi.fn(async () => f.raw)
      await expect(f.generate({ runAI })).rejects.toBe(primary)
      await assertRaw(f, f.raw)
      expect((await current(f)).events.some(row => row.type === 'model.responded' || row.type === 'candidate.persisted')).toBe(false)
      expect(runAI).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: call-time inputs and original callback/hook receiver remain bound despite immediate caller mutations`, async () => {
      const f = await fixture(kind)
      const replacement = vi.fn(async () => '002 wrong replacement')
      const wrongHook = vi.fn()
      const input: GenerateInput = { scope: { ...f.scope }, expectedReplan: structuredClone(f.replan), itemId: f.item.id,
        runAI: async function (this: unknown) { expect(this).toBe(input); return f.raw },
        onDurableBoundary: function (this: unknown) { expect(this).toBe(input) },
      }
      const pending = kind === 'outline' ? generateImpactOutlineRegenerationCandidateV1(input) : generateImpactStoryTimelineRegenerationCandidateV1(input)
      input.scope.workId += 999_999; input.itemId = '002 replaced target'; input.expectedReplan.output.outputHash = '0'.repeat(64); input.runAI = replacement; input.onDurableBoundary = wrongHook
      const generated = await pending
      expect(generated.candidate.workId).toBe(f.scope.workId)
      await assertRaw(f, f.raw)
      expect(replacement).not.toHaveBeenCalled(); expect(wrongHook).not.toHaveBeenCalled()
    })
    it(`${kind}: call-time AI configuration is used by the original client without recording credentials`, async () => {
      const f = await fixture(kind); const config = { ...aiConfig }; expectedSyntheticPosts = 1
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async url => { expect(String(url)).toContain('127.0.0.1:9'); return new Response(JSON.stringify({ choices: [{ message: { content: f.raw }, finish_reason: 'stop' }] }), { status: 200 }) }))
      const pending = f.generate({ aiConfig: config }); config.baseUrl = 'http://127.0.0.1:10/changed'; config.model = '002 changed after call'
      await pending
      const request = (await artifacts(f, 'rendered-request'))[0]!
      expect(request.content).not.toContain('apiKey'); await assertRaw(f, f.raw)
    })
    it(`${kind}: exact prepared request predates mutation of messages by the original callback receiver`, async () => {
      const f = await fixture(kind); let original = ''
      const runAI = vi.fn(async function (this: unknown, messages: ChatMessage[]) { expect(this).toMatchObject({ runAI }); original = messages[0]!.content; messages[0]!.content = '002 mutated only inside the callback'; return f.raw })
      await f.generate({ runAI })
      expect((await artifacts(f, 'rendered-request'))[0]!.value.messages?.[0]?.content).toBe(original)
      await assertRaw(f, f.raw)
    })
    it(`${kind}: missing/stale dependency proof never spends a model call or gains candidate authority from evidence`, async () => {
      const f = await fixture(kind, null); const runAI = vi.fn(async () => f.raw)
      await expect(f.generate({ runAI })).rejects.toThrow('依赖未就绪')
      expect(runAI).not.toHaveBeenCalled()
      expect((await db.agentRuns.toArray()).filter(row => row.parentRunId === f.replan.snapshot.run.id && row.parentRelation?.startsWith('impact-generative-target:'))).toHaveLength(0)
    })
    it(`${kind}: wrong owner remains refused and a stale accepted dependency cannot be used for adoption`, async () => {
      const f = await fixture(kind); const runAI = vi.fn(async () => f.raw)
      const generated = await f.generate({ runAI }); await assertRaw(f, f.raw)
      const foreign = await seedCurrentWorkspace('002 foreign impact owner')
      await expect(readAgentRunV1(foreign.scope, generated.snapshot.run.id)).rejects.toThrow()
      await staleAgentRunVerificationV1({ scope: f.scope, runId: f.dependencyReview!.snapshot.run.id, reason: '002 author proof changed' })
      await expect(f.adopt(generated.snapshot.run.id)).rejects.toThrow()
      expect(runAI).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: explicit rejection leaves original exact response readable and terminal writer remains closed`, async () => {
      const f = await fixture(kind); const runAI = vi.fn(async () => f.raw)
      const generated = await f.generate({ runAI }); await f.reject(generated.snapshot.run.id)
      await assertRaw(f, f.raw)
      const before = JSON.stringify(await Promise.all(db.tables.map(table => table.toArray())))
      await expect(recordAgentRunArtifactV1({ scope: f.scope, runId: generated.snapshot.run.id, artifactKind: 'raw-response', content: '002 forbidden terminal append', stepId: generated.snapshot.contract.executionBindings![0]!.stepId, attempt: 1 })).rejects.toThrow()
      expect(JSON.stringify(await Promise.all(db.tables.map(table => table.toArray())))).toBe(before)
      expect((await current(f)).contract.budget).toMatchObject({ maxModelCalls: 1, maxAttemptsPerStep: 1, maxProtocolErrors: 0 })
      expect(runAI).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: real Project backup round-trip retains exact evidence without restoring physical candidate authority`, async () => {
      const f = await fixture(kind); const runAI = vi.fn(async () => f.raw)
      const generated = await f.generate({ runAI }); await f.adopt(generated.snapshot.run.id)
      const ref = await assertRaw(f, f.raw)
      const originalFormal = await formal()
      const backup = await exportProjectJSON(f.scope.projectId)
      const importedProjectId = await importProjectJSON(backup)
      const importedContent = await readAgentRunArtifactExactV1({ projectId: importedProjectId, artifactKind: 'raw-response', contentHash: ref.event.payload.contentHash })
      expect(importedContent).toBe(ref.content)
      expect((JSON.parse(importedContent) as Evidence).raw).toBe(f.raw)
      const imported = (await db.agentRuns.where('projectId').equals(importedProjectId).toArray()).find(row => row.parentRelation?.startsWith('impact-generative-target:'))!
      expect(imported.status).toBe('running'); expect(imported.terminalReceiptHash).toBeNull()
      const allFormal = await formal()
      for (const [index, rows] of originalFormal.entries()) expect(allFormal[index]!.filter(row => row.projectId === f.scope.projectId)).toEqual(rows)
      expect(runAI).toHaveBeenCalledTimes(1)
    })
  }
})
