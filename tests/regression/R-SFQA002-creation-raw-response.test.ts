import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { AIConfig, AgentRunRecord, Chapter, ChatMessage, ScreenplayTargetSpecV1, ShortNovelBriefV1, WorkspaceScope } from '../../src/lib/types'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createQualityCreationFixture, qualityMotionBible } from '../helpers/quality001016-creation-fixtures'
import { createAdaptation, listActiveSourceUnits } from '../../src/lib/adaptation/source-manifest'
import { readAgentRunV1, type AgentRunSnapshotV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1, recordAgentRunArtifactV1 } from '../../src/lib/memory/artifact-store'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import * as exactStore from '../../src/lib/memory/artifact-store'
import { generateComicProfessionalCandidateV1, adoptComicProfessionalCandidateV1, stopWaitingComicProfessionalTaskV1 } from '../../src/lib/comic/durable-production'
import { generateMotionDramaCandidateV1, adoptMotionDramaProfessionalCandidateV1, stopWaitingMotionDramaTaskV1 } from '../../src/lib/motion-drama/durable-production'
import { generateScreenplayProfessionalCandidateV1, adoptScreenplayProfessionalCandidateV1, closeScreenplayTaskV1 } from '../../src/lib/screenplay/durable-production'
import { generateShortNovelCandidateV1, adoptShortNovelCandidateV1, closeShortNovelTaskV1 } from '../../src/lib/agent/run/short-novel-durable'

type Kind = 'comic' | 'motion-drama' | 'screenplay' | 'short-novel'
interface Fixture {
  kind: Kind
  scope: WorkspaceScope
  sourceChapterId: number
  adaptationProjectId?: number
  sourceUnitKey?: string
  normalRaw: string
  generate: (options: { runAI?: (messages: ChatMessage[]) => Promise<string>; aiConfig?: AIConfig; signal?: AbortSignal }) => Promise<{ snapshot: AgentRunSnapshotV1; candidate: unknown }>
  adopt: (runId: number) => Promise<unknown>
  close?: (runId: number) => Promise<unknown>
}
const kinds: Kind[] = ['comic', 'motion-drama', 'screenplay', 'short-novel']
const aiConfig: AIConfig = { provider: 'custom', apiKey: '', model: 'isolated-model', baseUrl: 'http://127.0.0.1:9/v1', temperature: 0, maxTokens: 1_024, contextWindow: 128_000 }
const screenplayTarget: ScreenplayTargetSpecV1 = {
  format: 'film', language: 'zh-CN', episodeCount: null, targetMinutesPerEpisode: 2, rating: 'PG-13', dialogueDensity: 'balanced', productionScale: 'contained', preserveVoiceOver: false,
  titlePage: { creditLine: '改编', authorDisplayName: '002 synthetic', contactText: '', copyrightNotice: 'Synthetic only', draftLabel: '002 raw evidence' }, exportDefaults: ['fountain', 'fdx', 'pdf'],
}
async function fixture(kind: Kind): Promise<Fixture> {
  if (kind === 'comic' || kind === 'motion-drama') {
    const item = await createQualityCreationFixture(kind)
    const payload = kind === 'comic' ? [{ stableKey: 'fact_raw002', kind: 'event', statement: '检票员调查异常车票 e\u0301。', subjectKeys: [], sourceUnitKeys: [item.unit.sourceUnitKey], confidence: 1 }] : { ...qualityMotionBible, titlePromise: '原文 e\u0301：最后一张车票通向告别。' }
    return { kind, scope: item.scope, sourceChapterId: item.unit.sourceChapterId!, adaptationProjectId: item.adaptation.id!, sourceUnitKey: item.unit.sourceUnitKey, normalRaw: JSON.stringify(payload),
      generate: options => kind === 'comic' ? generateComicProfessionalCandidateV1({ scope: item.scope, adaptationProjectId: item.adaptation.id!, stage: 'source-analysis', sourceUnitKeys: [item.unit.sourceUnitKey], ...options }) : generateMotionDramaCandidateV1({ scope: item.scope, stage: 'series-bible', episodeNumber: 1, ...options }),
      adopt: runId => kind === 'comic' ? adoptComicProfessionalCandidateV1({ scope: item.scope, runId }) : adoptMotionDramaProfessionalCandidateV1({ scope: item.scope, runId }),
    }
  }
  const source = await seedCurrentWorkspace(`002 ${kind} source`, { targetWordCount: 5_000, novelProfile: 'short' })
  const chapters = await readOwnedRows<Chapter>(source.scope, 'chapters', { owner: 'work' })
  const chapter = chapters[0]!
  await db.chapters.update(chapter.id!, { content: '<p>清晨，检票员发现一张没有终点的车票。</p>', summary: '原创合成数据', updatedAt: Date.now() })
  if (kind === 'short-novel') {
    const brief: ShortNovelBriefV1 = { version: 1, premise: '原文 e\u0301：检票员追查车票。', coreChange: '从遵守时刻表到保护乘客。', dominantEmotion: '克制悬疑', pointOfView: 'third-limited', tense: 'past', audience: '中文短篇读者', storyPromise: '终点与选择在结尾兑现。', mustKeep: ['车票'], forbidden: ['梦醒结局'], targetWordCount: 5_000, chapterCount: chapters.length }
    return { kind, scope: source.scope, sourceChapterId: chapter.id!, normalRaw: JSON.stringify(brief), generate: options => generateShortNovelCandidateV1({ scope: source.scope, artifactKind: 'brief', ...options }), adopt: runId => adoptShortNovelCandidateV1({ scope: source.scope, runId }), close: runId => closeShortNovelTaskV1(source.scope, runId) }
  }
  const item = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '002 synthetic screenplay', sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec: screenplayTarget })
  const unit = (await listActiveSourceUnits(item.adaptation.id!)).find(row => row.sourceKind === 'chapter')!
  const payload = [{ stableKey: 'fact_raw002', kind: 'event', statement: '检票员调查异常车票 e\u0301。', subjectKeys: [], sourceUnitKeys: [unit.sourceUnitKey], confidence: 1 }]
  return { kind, scope: item.scope, sourceChapterId: chapter.id!, adaptationProjectId: item.adaptation.id!, sourceUnitKey: unit.sourceUnitKey, normalRaw: JSON.stringify(payload), generate: options => generateScreenplayProfessionalCandidateV1({ scope: item.scope, adaptationProjectId: item.adaptation.id!, stage: 'source-analysis', sourceUnitKeys: [unit.sourceUnitKey], ...options }), adopt: runId => adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId }), close: runId => closeScreenplayTaskV1(item.scope, runId) }
}
async function currentRun(scope: WorkspaceScope) {
  const rows = await readOwnedRows<AgentRunRecord>(scope, 'agentRuns', { owner: 'work' })
  expect(rows).toHaveLength(1)
  return readAgentRunV1(scope, rows[0].id!)
}
interface RawEvidence { version: string; raw: string; observation: { outcome: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null }; requestArtifactHash: string }
async function artifacts(scope: WorkspaceScope, kind: 'raw-response' | 'tool-result' | 'rendered-request') {
  const snapshot = await currentRun(scope)
  const result = []
  for (const event of snapshot.events) if (event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === kind) {
    const content = await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: kind, contentHash: event.payload.contentHash })
    result.push({ event, content, value: JSON.parse(content) as RawEvidence })
  }
  return result
}
async function assertRaw(scope: WorkspaceScope, outputs: string[]) {
  const refs = await artifacts(scope, 'raw-response')
  expect(refs.map(ref => ref.value.raw)).toEqual(outputs)
  const snapshot = await currentRun(scope)
  for (const [index, ref] of refs.entries()) {
    expect(ref.event.payload.attempt).toBe(index + 1)
    const request = snapshot.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'rendered-request' && event.payload.contentHash === ref.value.requestArtifactHash && event.payload.stepId === ref.event.payload.stepId && event.payload.attempt === ref.event.payload.attempt)
    const requested = snapshot.events.find(event => event.type === 'model.requested' && event.payload.stepId === ref.event.payload.stepId && event.payload.attempt === ref.event.payload.attempt)
    expect(request?.sequence).toBeLessThan(requested!.sequence)
    expect(requested!.sequence).toBeLessThan(ref.event.sequence)
    const responded = snapshot.events.find(event => event.type === 'model.responded' && event.payload.stepId === ref.event.payload.stepId && event.payload.attempt === ref.event.payload.attempt)
    if (responded) expect(ref.event.sequence).toBeLessThan(responded.sequence)
    expect(ref.value.observation.usage).toBeNull()
  }
  return refs
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
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw Error('No real model or network is authorized') }))
})
afterEach(async () => {
  try { expect(fetch).toHaveBeenCalledTimes(expectedSyntheticPosts) }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete() }
})

describe('SFQA-002 creation per-attempt response preservation', () => {
  for (const kind of kinds) {
    it(`${kind}: retains exact normal Unicode/whitespace response before normalization and read-only after reopen`, async () => {
      const f = await fixture(kind)
      const raw = `\r\n  ${f.normalRaw}\r\n\t`
      const runAI = vi.fn(async (): Promise<string> => raw)
      const generated = await f.generate({ runAI })
      expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
      await assertRaw(f.scope, [raw])
      const before = JSON.stringify(await Promise.all(db.tables.map(table => table.toArray())))
      db.close(); await db.open()
      const refs = await assertRaw(f.scope, [raw])
      expect(refs[0]!.value.raw.normalize('NFC')).not.toBe(raw)
      expect(JSON.stringify(await Promise.all(db.tables.map(table => table.toArray())))).toBe(before)
      expect(runAI).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: keeps each malformed response through bounded failure with no hidden third call`, async () => {
      const f = await fixture(kind)
      const outputs = [`RAW002_${kind}_first\r\ne\u0301_not_json`, `RAW002_${kind}_repair\nnot_json`]
      const runAI = vi.fn(async (): Promise<string> => outputs[runAI.mock.calls.length - 1]!)
      await expect(f.generate({ runAI })).rejects.toThrow()
      const calls = kind === 'short-novel' ? 1 : 2
      expect(runAI).toHaveBeenCalledTimes(calls)
      await assertRaw(f.scope, outputs.slice(0, calls))
    })
    it(`${kind}: preserves returned raw when checkpoint persistence fails and does not resend`, async () => {
      const f = await fixture(kind)
      const runAI = vi.fn(async (): Promise<string> => f.normalRaw)
      vi.spyOn(checkpoints, 'createAgentRunCheckpointV1').mockRejectedValueOnce(new Error('002 checkpoint failure after response'))
      await expect(f.generate({ runAI })).rejects.toThrow('002 checkpoint failure after response')
      await assertRaw(f.scope, [f.normalRaw])
      expect(runAI).toHaveBeenCalledTimes(1)
      expect((await currentRun(f.scope)).events.some(event => event.type === 'candidate.persisted')).toBe(false)
    })
    it(`${kind}: keeps already observed actual-client usage when the native raw write fails, stops before parse/repair and preserves the storage cause`, async () => {
      const f = await fixture(kind)
      expectedSyntheticPosts = 1
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'RAW002_RECEIVED_BUT_STORAGE_FAILS_not_json' }, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
      const primary = new Error('002 quota failure in native raw transaction')
      const nativeAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
      let rawWriteAttempted = false
      vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(record => nativeAdd(record).then(id => {
        if (record.artifactKind === 'raw-response') { rawWriteAttempted = true; throw primary }
        return id
      }))
      let error: unknown
      try { await f.generate({ aiConfig }) } catch (cause) { error = cause }
      expect(error).toBeInstanceOf(Error)
      expect(rawWriteAttempted).toBe(true)
      expect(containsCause(error, primary)).toBe(true)
      const observation = (await artifacts(f.scope, 'tool-result')).map(ref => ref.value).find(value => value.version === 'creation-model-observation-v1')
      expect(observation?.observation).toMatchObject({ outcome: 'returned', usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 } })
      expect(await artifacts(f.scope, 'raw-response')).toHaveLength(0)
      expect((await currentRun(f.scope)).events.some(event => event.type === 'candidate.persisted')).toBe(false)
      expect(fetch).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: records unknown transport metadata without inventing raw or resending`, async () => {
      const f = await fixture(kind)
      expectedSyntheticPosts = 1
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new TypeError('002 actual client unknown transport') }))
      await expect(f.generate({ aiConfig })).rejects.toThrow('002 actual client unknown transport')
      expect((await currentRun(f.scope)).projection.state).toBe('paused')
      expect(await artifacts(f.scope, 'raw-response')).toHaveLength(0)
      const observation = (await artifacts(f.scope, 'tool-result')).map(ref => ref.value).find(value => value.version === 'creation-model-observation-v1')
      expect(observation?.observation).toMatchObject({ outcome: 'unavailable', usage: null })
      expect(fetch).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: retains stale returned evidence while the original adoption freshness guard refuses formal writes`, async () => {
      const f = await fixture(kind)
      const runAI = vi.fn(async (): Promise<string> => {
        await db.chapters.update(f.sourceChapterId, { content: '<p>作者在另一窗口修改了当前来源。</p>', updatedAt: Date.now() })
        return f.normalRaw
      })
      const generated = await f.generate({ runAI })
      await assertRaw(f.scope, [f.normalRaw])
      await expect(f.adopt(generated.snapshot.run.id)).rejects.toThrow()
      expect(runAI).toHaveBeenCalledTimes(1)
      expect((await currentRun(f.scope)).events.some(event => event.type === 'adoption.committed')).toBe(false)
    })
  }
  for (const kind of ['comic', 'motion-drama', 'screenplay'] as const) it(`${kind}: repair success keeps both exact raw responses and actual request envelopes`, async () => {
    const f = await fixture(kind)
    const outputs = ['RAW002_first_invalid_for_repair', ` \n${f.normalRaw}\n `]
    const runAI = vi.fn(async (): Promise<string> => outputs[runAI.mock.calls.length - 1]!)
    const generated = await f.generate({ runAI })
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    await assertRaw(f.scope, outputs)
    expect(runAI).toHaveBeenCalledTimes(2)
  })
  for (const kind of ['screenplay', 'short-novel'] as const) {
    it(`${kind}: records fully returned text even when its original signal was aborted before the return`, async () => {
      const f = await fixture(kind); const controller = new AbortController()
      const runAI = vi.fn(async (): Promise<string> => { controller.abort(); return f.normalRaw })
      await expect(f.generate({ runAI, signal: controller.signal })).rejects.toThrow()
      await assertRaw(f.scope, [f.normalRaw])
      expect((await currentRun(f.scope)).events.some(event => event.type === 'candidate.persisted')).toBe(false)
      expect(runAI).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: refuses premature close of the actual pending attempt, then keeps the returned raw and allows normal explicit close`, async () => {
      const f = await fixture(kind)
      const runAI = vi.fn(async (): Promise<string> => {
        const before = await currentRun(f.scope)
        expect(before.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
        await expect(f.close!(before.run.id)).rejects.toThrow(/在途/)
        return f.normalRaw
      })
      const generated = await f.generate({ runAI })
      await assertRaw(f.scope, [f.normalRaw])
      await f.close!(generated.snapshot.run.id)
      expect((await currentRun(f.scope)).projection.state).toBe('cancelled')
      expect(runAI).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: keeps existing author close after an unknown paused request`, async () => {
      const f = await fixture(kind)
      const runAI = vi.fn(async (): Promise<string> => { throw Error('002 unknown synthetic result') })
      await expect(f.generate({ runAI })).rejects.toThrow('002 unknown synthetic result')
      const before = await currentRun(f.scope); expect(before.projection.state).toBe('paused')
      await f.close!(before.run.id)
      expect((await currentRun(f.scope)).projection.state).toBe('cancelled')
      expect(runAI).toHaveBeenCalledTimes(1)
    })
  }
  for (const kind of ['comic', 'motion-drama'] as const) it(`${kind}: late original response survives stop-waiting and the existing send gate blocks repair`, async () => {
    const f = await fixture(kind)
    const raw = 'RAW002_returned_after_author_stop_not_json'
    const runAI = vi.fn(async (): Promise<string> => {
      const current = await currentRun(f.scope)
      const stop = kind === 'comic' ? stopWaitingComicProfessionalTaskV1 : stopWaitingMotionDramaTaskV1
      await stop(f.scope, current.run.id, { generation: current.projection.generation, lastSequence: current.projection.lastSequence })
      return raw
    })
    await expect(f.generate({ runAI })).rejects.toThrow('停止等待')
    await assertRaw(f.scope, [raw])
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('existing exact-store idempotency and scope protection keep raw immutable, without write authority from the new evidence', async () => {
    const f = await fixture('short-novel')
    await f.generate({ runAI: async () => f.normalRaw })
    const [ref] = await assertRaw(f.scope, [f.normalRaw]); const snapshot = await currentRun(f.scope)
    const count = await db.agentRunArtifacts.count()
    const repeated = await recordAgentRunArtifactV1({ scope: f.scope, runId: snapshot.run.id, stepId: ref!.event.payload.stepId, attempt: ref!.event.payload.attempt, artifactKind: 'raw-response', content: ref!.content, expectedLastSequence: snapshot.projection.lastSequence })
    expect(repeated.eventCreated).toBe(false); expect(repeated.bodyCreated).toBe(false)
    const other = await seedCurrentWorkspace('002 unrelated owner')
    const before = JSON.stringify(await Promise.all(db.tables.map(table => table.toArray())))
    await expect(recordAgentRunArtifactV1({ scope: other.scope, runId: snapshot.run.id, stepId: ref!.event.payload.stepId, attempt: ref!.event.payload.attempt, artifactKind: 'raw-response', content: ref!.content })).rejects.toThrow()
    expect(await db.agentRunArtifacts.count()).toBe(count)
    expect(JSON.stringify(await Promise.all(db.tables.map(table => table.toArray())))).toBe(before)
  })

  for (const kind of kinds) {
    it(`${kind}: a request evidence write failure prevents the original model dispatch`, async () => {
      const f = await fixture(kind)
      const nativeAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
      const primary = new Error('002 request evidence transaction failed')
      vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(record => nativeAdd(record).then(id => {
        if (record.artifactKind === 'rendered-request') throw primary
        return id
      }))
      const runAI = vi.fn(async (): Promise<string> => f.normalRaw)
      await expect(f.generate({ runAI })).rejects.toThrow('002 request evidence transaction failed')
      expect(runAI).not.toHaveBeenCalled()
      expect((await currentRun(f.scope)).events.some(event => event.type === 'model.requested')).toBe(false)
      expect(await db.agentRunArtifacts.count()).toBe(0)
    })
    it(`${kind}: still preserves raw and observed usage if the separate small observation write fails`, async () => {
      const f = await fixture(kind); expectedSyntheticPosts = 1
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: f.normalRaw }, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } }), { status: 200 })))
      const nativeAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
      const primary = new Error('002 independent metering evidence transaction failed')
      vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(record => nativeAdd(record).then(id => {
        if (record.artifactKind === 'tool-result') throw primary
        return id
      }))
      let error: unknown
      try { await f.generate({ aiConfig }) } catch (cause) { error = cause }
      expect(containsCause(error, primary)).toBe(true)
      const refs = await artifacts(f.scope, 'raw-response')
      expect(refs.map(ref => ref.value.raw)).toEqual([f.normalRaw])
      expect(refs[0]!.value.observation.usage).toEqual({ inputTokens: 13, outputTokens: 5, totalTokens: 18 })
      expect((await currentRun(f.scope)).events.some(event => event.type === 'candidate.persisted')).toBe(false)
      expect(fetch).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: exposes observed metering and both original persistence causes when all completion evidence writes fail, without claiming durability`, async () => {
      const f = await fixture(kind); expectedSyntheticPosts = 1
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: f.normalRaw }, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } }), { status: 200 })))
      const nativeAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
      const metadataFailure = new Error('002 metadata unavailable')
      const rawFailure = new Error('002 raw unavailable')
      vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(record => nativeAdd(record).then(id => {
        if (record.artifactKind === 'tool-result') throw metadataFailure
        if (record.artifactKind === 'raw-response') throw rawFailure
        return id
      }))
      let error: unknown
      try { await f.generate({ aiConfig }) } catch (cause) { error = cause }
      expect(containsCause(error, metadataFailure)).toBe(true)
      expect(containsCause(error, rawFailure)).toBe(true)
      const observations: unknown[] = []
      const seen = new Set<object>()
      const collect = (value: unknown) => {
        if (!value || typeof value !== 'object' || seen.has(value)) return
        seen.add(value)
        const row = value as { observation?: unknown; cause?: unknown; persistenceFailures?: unknown[] }
        if (row.observation) observations.push(row.observation)
        collect(row.cause); row.persistenceFailures?.forEach(collect)
      }
      collect(error)
      expect(observations).toContainEqual(expect.objectContaining({ outcome: 'returned', usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 } }))
      expect(await artifacts(f.scope, 'raw-response')).toHaveLength(0)
      expect(await artifacts(f.scope, 'tool-result')).toHaveLength(0)
      expect((await currentRun(f.scope)).events.some(event => event.type === 'candidate.persisted')).toBe(false)
      expect(fetch).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: keeps actual-client successful metering separate from a raw string callback's unknown usage`, async () => {
      const f = await fixture(kind); expectedSyntheticPosts = 1
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: f.normalRaw }, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } }), { status: 200 })))
      const generated = await f.generate({ aiConfig })
      expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
      const refs = await artifacts(f.scope, 'raw-response')
      expect(refs.map(ref => ref.value.raw)).toEqual([f.normalRaw])
      expect(refs[0]!.value.observation).toMatchObject({ outcome: 'returned', usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 } })
      expect(JSON.stringify(refs[0]!.value)).not.toContain('costUsd')
      expect(fetch).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: retains already observed usage when the real client rejects a response without complete text`, async () => {
      const f = await fixture(kind); expectedSyntheticPosts = 1
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: null }, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } }), { status: 200 })))
      await expect(f.generate({ aiConfig })).rejects.toThrow()
      expect(await artifacts(f.scope, 'raw-response')).toHaveLength(0)
      const observation = (await artifacts(f.scope, 'tool-result')).map(ref => ref.value).find(value => value.version === 'creation-model-observation-v1')
      expect(observation?.observation).toMatchObject({ outcome: 'unavailable', usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 } })
      expect(fetch).toHaveBeenCalledTimes(1)
    })
    it(`${kind}: captures exact request text before the original receiver callback changes its messages`, async () => {
      const f = await fixture(kind)
      let original = ''
      const runAI = vi.fn(async function (this: unknown, messages: ChatMessage[]): Promise<string> {
        expect(this).toMatchObject({ scope: f.scope, runAI })
        original = messages[0]!.content
        messages[0]!.content = '002 changed only after original callback received the request'
        return f.normalRaw
      })
      await f.generate({ runAI })
      const [request] = await artifacts(f.scope, 'rendered-request')
      const body = JSON.parse(request!.content) as { messages: ChatMessage[] }
      expect(body.messages[0]!.content).toBe(original)
      await assertRaw(f.scope, [f.normalRaw])
      expect(runAI).toHaveBeenCalledTimes(1)
    })
  }

  it('screenplay: stale first response stays saved and the known changed source cannot trigger a repair request', async () => {
    const f = await fixture('screenplay')
    const raw = 'RAW002_STALE_FIRST_RECEIVED_not_json'
    const runAI = vi.fn(async (): Promise<string> => {
      if (runAI.mock.calls.length === 1) {
        await db.chapters.update(f.sourceChapterId, { content: '<p>作者在第一份响应期间修改原作。</p>', updatedAt: Date.now() })
        return raw
      }
      return f.normalRaw
    })
    await expect(f.generate({ runAI })).rejects.toThrow('来源或目标版本已变化')
    await assertRaw(f.scope, [raw])
    const snapshot = await currentRun(f.scope)
    expect(snapshot.projection.state).toBe('paused')
    expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(snapshot.events.some(event => event.type === 'adoption.committed')).toBe(false)
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('screenplay: drift after real prepared request commit is rejected before the first requested event or callback', async () => {
    const f = await fixture('screenplay')
    const nativeRecord = exactStore.recordAgentRunArtifactV1
    let changed = false
    vi.spyOn(exactStore, 'recordAgentRunArtifactV1').mockImplementation(async input => {
      const saved = await nativeRecord(input)
      if (!changed && input.artifactKind === 'rendered-request') {
        changed = true
        // Original artifact transaction has committed. This is an independent
        // author mutation, not a Promise used to keep that transaction alive.
        await db.chapters.update(f.sourceChapterId, { content: '<p>作者在首派发前更新原作。</p>', updatedAt: Date.now() })
      }
      return saved
    })
    const runAI = vi.fn(async (): Promise<string> => f.normalRaw)
    await expect(f.generate({ runAI })).rejects.toThrow('来源或目标版本已变化')
    expect(changed).toBe(true)
    expect(runAI).not.toHaveBeenCalled()
    const snapshot = await currentRun(f.scope)
    expect(snapshot.projection.state).toBe('paused')
    expect(snapshot.events.some(event => event.type === 'model.requested')).toBe(false)
    expect(snapshot.events.some(event => event.type === 'adoption.committed')).toBe(false)
    expect(await artifacts(f.scope, 'rendered-request')).toHaveLength(1)
  })
  it('screenplay: keeps the actual input owner, stage and source selection when the original receiver mutates caller aliases after dispatch', async () => {
    const f = await fixture('screenplay'); const other = await seedCurrentWorkspace('002 foreign caller scope')
    const beforeOther = await db.works.get(other.scope.workId)
    const input: Parameters<typeof generateScreenplayProfessionalCandidateV1>[0] = {
      scope: { ...f.scope }, adaptationProjectId: f.adaptationProjectId!, stage: 'source-analysis', sourceUnitKeys: [f.sourceUnitKey!],
      runAI: async function (this: unknown): Promise<string> {
        expect(this).toBe(input)
        input.scope.projectId = other.scope.projectId; input.scope.worldId = other.scope.worldId; input.scope.workId = other.scope.workId
        input.stage = 'causal-graph'; input.sourceUnitKeys!.push('not_the_original_source')
        return f.normalRaw
      },
    }
    const generated = await generateScreenplayProfessionalCandidateV1(input)
    expect(generated.snapshot.run).toMatchObject({ projectId: f.scope.projectId, workId: f.scope.workId })
    expect(generated.candidate).toMatchObject(f.scope)
    expect(generated.candidate.stage).toBe('source-analysis')
    expect(generated.candidate.sourceUnitKeys).toEqual([f.sourceUnitKey])
    await assertRaw(f.scope, [f.normalRaw])
    expect(await db.works.get(other.scope.workId)).toEqual(beforeOther)
  })
  it('short-novel: keeps the actual input scope and artifact kind while preserving the original receiver identity', async () => {
    const f = await fixture('short-novel'); const other = await seedCurrentWorkspace('002 unrelated short caller scope')
    const beforeOther = await db.works.get(other.scope.workId)
    const input: Parameters<typeof generateShortNovelCandidateV1>[0] = {
      scope: { ...f.scope }, artifactKind: 'brief',
      runAI: async function (this: unknown): Promise<string> {
        expect(this).toBe(input)
        input.scope.projectId = other.scope.projectId; input.scope.worldId = other.scope.worldId; input.scope.workId = other.scope.workId
        input.artifactKind = 'story-design'
        return f.normalRaw
      },
    }
    const generated = await generateShortNovelCandidateV1(input)
    expect(generated.snapshot.run).toMatchObject({ projectId: f.scope.projectId, workId: f.scope.workId })
    expect(generated.candidate).toMatchObject(f.scope)
    expect(generated.candidate.artifactKind).toBe('brief')
    await assertRaw(f.scope, [f.normalRaw])
    expect(await db.works.get(other.scope.workId)).toEqual(beforeOther)
  })
  it('screenplay: normal repair retains the original callback method even if its caller replaces the property mid-flight', async () => {
    const f = await fixture('screenplay')
    const replacement = vi.fn(async (): Promise<string> => f.normalRaw)
    let calls = 0
    const input: Parameters<typeof generateScreenplayProfessionalCandidateV1>[0] = {
      scope: { ...f.scope }, adaptationProjectId: f.adaptationProjectId!, stage: 'source-analysis', sourceUnitKeys: [f.sourceUnitKey!],
      runAI: async function (this: unknown): Promise<string> {
        expect(this).toBe(input)
        calls++
        if (calls === 1) { input.runAI = replacement; return 'RAW002_ORIGINAL_EXECUTOR_FIRST_not_json' }
        return f.normalRaw
      },
    }
    const generated = await generateScreenplayProfessionalCandidateV1(input)
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(calls).toBe(2); expect(replacement).not.toHaveBeenCalled()
    await assertRaw(f.scope, ['RAW002_ORIGINAL_EXECUTOR_FIRST_not_json', f.normalRaw])
  })

  for (const kind of ['screenplay', 'short-novel'] as const) for (const outcome of ['returned', 'unavailable'] as const) it(`${kind}: keeps observed ${outcome} evidence and original causes through a later native state-write failure`, async () => {
    const f = await fixture(kind); expectedSyntheticPosts = 1
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: outcome === 'returned' ? f.normalRaw : null }, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } }), { status: 200 })))
    const evidenceFailure = new Error('002 original completion-evidence transaction failure')
    const stateFailure = new Error('002 later native failure-state transaction failure')
    const nativeArtifactAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
    vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(record => nativeArtifactAdd(record).then(id => {
      if (record.artifactKind === (outcome === 'returned' ? 'raw-response' : 'tool-result')) throw evidenceFailure
      return id
    }))
    const nativeEventAdd = db.agentRunEvents.add.bind(db.agentRunEvents)
    let stateWriteAttempted = false
    vi.spyOn(db.agentRunEvents, 'add').mockImplementation(record => nativeEventAdd(record).then(id => {
      if (record.type === 'run.failed' || record.type === 'run.paused') { stateWriteAttempted = true; throw stateFailure }
      return id
    }))
    let error: unknown
    try { await f.generate({ aiConfig }) } catch (cause) { error = cause }
    expect(stateWriteAttempted).toBe(true)
    expect(containsCause(error, evidenceFailure)).toBe(true)
    expect(containsCause(error, stateFailure)).toBe(true)
    const seen = new Set<object>(); const observations: unknown[] = []
    const collect = (value: unknown) => {
      if (!value || typeof value !== 'object' || seen.has(value)) return
      seen.add(value)
      const row = value as { observation?: unknown; cause?: unknown; persistenceFailures?: unknown[] }
      if (row.observation) observations.push(row.observation)
      collect(row.cause); row.persistenceFailures?.forEach(collect)
    }
    collect(error)
    expect(observations).toContainEqual(expect.objectContaining({ outcome, usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 } }))
    expect(await artifacts(f.scope, 'raw-response')).toHaveLength(0)
    expect((await currentRun(f.scope)).events.some(event => event.type === 'candidate.persisted')).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  for (const kind of ['screenplay', 'short-novel'] as const) for (const status of [401, 402]) it(`${kind}: non-retryable HTTP ${status} keeps its real status and metadata without a fabricated raw body`, async () => {
    const f = await fixture(kind); expectedSyntheticPosts = 1
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: { message: `002 isolated HTTP ${status}` } }), { status })))
    let error: unknown
    try { await f.generate({ aiConfig }) } catch (cause) { error = cause }
    expect(error).toMatchObject({ status })
    expect((await currentRun(f.scope)).projection.state).toBe('paused')
    expect(await artifacts(f.scope, 'raw-response')).toHaveLength(0)
    const observation = (await artifacts(f.scope, 'tool-result')).map(ref => ref.value).find(value => value.version === 'creation-model-observation-v1')
    expect(observation?.observation).toMatchObject({ outcome: 'unavailable', usage: null })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  for (const kind of kinds) it(`${kind}: a native responded-event rollback keeps the already committed exact raw and cannot resend or create a candidate`, async () => {
    const f = await fixture(kind)
    const primary = new Error('002 model.responded native transaction failure')
    const nativeAdd = db.agentRunEvents.add.bind(db.agentRunEvents)
    let attempted = false
    vi.spyOn(db.agentRunEvents, 'add').mockImplementation(record => nativeAdd(record).then(id => {
      if (record.type === 'model.responded') { attempted = true; throw primary }
      return id
    }))
    const runAI = vi.fn(async (): Promise<string> => f.normalRaw)
    let error: unknown
    try { await f.generate({ runAI }) } catch (cause) { error = cause }
    expect(attempted).toBe(true)
    expect(containsCause(error, primary)).toBe(true)
    await assertRaw(f.scope, [f.normalRaw])
    const snapshot = await currentRun(f.scope)
    expect(snapshot.events.some(event => event.type === 'model.responded' || event.type === 'candidate.persisted')).toBe(false)
    expect(runAI).toHaveBeenCalledTimes(1)
  })
})
