import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createDocumentImportChunkCandidateV1, readDocumentImportChunkEvidenceV1 } from '../../src/lib/import/document-parse-durable'
import {
  applyReferenceFromSession, clearChunkTexts, readPendingDocumentImportV1, registerChunkTexts,
  runPublishedReferenceAnalysisV1, runSession,
} from '../../src/lib/import/pipeline'
import { confirmDocumentImportChunkV1 } from '../../src/lib/import/document-parse-adoption'
import { quickHash } from '../../src/lib/import/chunker'
import { hashImportChunkTextV1, useImportSessionStore } from '../../src/stores/import-session'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { Character } from '../../src/lib/types'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const source = '原稿片段：雾港守望者喝 Cafe\u0301，保存他的名字。'
const raw = ' \n {"worldview":{"summary":"Cafe\u0301 原名"},"characters":[],"outline":[]} \t\n'
const sessions: number[] = []
const previous = useAIConfigStore.getState()

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.setState({ config: { provider: 'deepseek', model: 'deepseek-v4-flash',
    baseUrl: 'https://api.deepseek.com/v1', apiKey: 'isolated-022-f2-no-real-key',
    maxTokens: 16_384, temperature: 0.1 }, rememberApiKey: false, presets: [], taskRoutes: {} })
})
afterEach(() => {
  for (const id of sessions.splice(0)) clearChunkTexts(id)
  useAIConfigStore.setState(previous); vi.unstubAllGlobals(); db.close()
})

async function fixture(target: 'project' | 'reference' = 'project', depth?: 'quick' | 'deep',
  existing?: Awaited<ReturnType<typeof seedCurrentWorkspace>>) {
  const f = existing ?? await seedCurrentWorkspace('022 formal candidate isolated')
  const sessionId = await useImportSessionStore.getState().create({
    projectId: f.scope.projectId, targetScope: f.scope, filename: 'synthetic.txt', fileHash: quickHash(source),
    totalChars: source.length, totalChunks: 1, chunkSize: 1000,
    chunks: [{ index: 0, startChar: 0, endChar: source.length, charCount: source.length,
      sourceTextHash: await hashImportChunkTextV1(source), status: 'pending', attempts: 0 }],
    importTarget: target, analysisDepth: depth, targetWorldGroupId: null, status: 'pending', merged: {}, rollingContext: '',
  })
  sessions.push(sessionId)
  registerChunkTexts(sessionId, [{ index: 0, text: source }])
  return { ...f, input: { projectId: f.scope.projectId, sessionId, chunkIndex: 0 } }
}

const reply = (body: string, finish_reason = 'stop') => new Response(JSON.stringify({
  choices: [{ message: { role: 'assistant', content: body }, finish_reason }],
  usage: { prompt_tokens: 31, completion_tokens: 17, total_tokens: 48 },
}), { headers: { 'Content-Type': 'application/json' } })

it('022 F2 persists a formal candidate plus exact raw answer and measured usage across reopen, without canonical writes', async () => {
  const f = await fixture()
  const post = vi.fn(async () => reply(raw))
  vi.stubGlobal('fetch', post)
  const candidate = await createDocumentImportChunkCandidateV1(f.input)
  expect(post).toHaveBeenCalledTimes(1)
  expect(candidate.result.worldview?.summary).toBe('Cafe\u0301 原名')
  expect(await db.worldviews.count()).toBe(0)
  expect(await db.characters.count()).toBe(0)
  expect(await db.outlineNodes.count()).toBe(0)
  expect(await db.agentRuns.count()).toBe(1)
  clearChunkTexts(f.input.sessionId)
  db.close(); await db.open()
  const restored = await readDocumentImportChunkEvidenceV1(f.input)
  expect(restored).toMatchObject({ state: 'awaiting_confirmation', candidate, raw,
    observation: { usage: { inputTokens: 31, outputTokens: 17, totalTokens: 48 } } })
  await expect(createDocumentImportChunkCandidateV1(f.input)).rejects.toThrow(/不能再次发送/)
  expect(post).toHaveBeenCalledTimes(1)
})

it.each(['malformed', 'truncated', 'unknown'] as const)('022 F2 keeps %s transport evidence with no candidate or second send', async kind => {
  const f = await fixture()
  const content = kind === 'malformed' ? ' \n坏 JSON Cafe\u0301 \t' : raw
  const post = vi.fn(async () => {
    if (kind === 'unknown') throw new TypeError('isolated transport disconnect')
    return reply(content, kind === 'truncated' ? 'length' : 'stop')
  })
  vi.stubGlobal('fetch', post)
  await expect(createDocumentImportChunkCandidateV1(f.input)).rejects.toThrow()
  db.close(); await db.open()
  expect(await readDocumentImportChunkEvidenceV1(f.input)).toMatchObject({
    state: kind === 'unknown' ? 'paused' : 'failed', candidate: null, raw: kind === 'unknown' ? null : content,
    observation: { usage: kind === 'unknown' ? null : { inputTokens: 31, outputTokens: 17, totalTokens: 48 } },
  })
  await expect(createDocumentImportChunkCandidateV1(f.input)).rejects.toThrow(/不能再次发送/)
  expect(post).toHaveBeenCalledTimes(1)
  expect(await db.worldviews.count()).toBe(0)
})

it('022 F2 serializes concurrent starts, retains paid evidence at the original owner, and rejects a Work switch before candidate adoption', async () => {
  const f = await fixture()
  const other = await createWorldWork(f.scope.projectId, { kind: 'novel', novelProfile: 'long', title: '隔离其他作品' })
  const post = vi.fn(async () => { await switchActiveWork(f.scope.projectId, other.id!); return reply(raw) })
  vi.stubGlobal('fetch', post)
  const attempts = await Promise.allSettled([createDocumentImportChunkCandidateV1(f.input), createDocumentImportChunkCandidateV1(f.input)])
  expect(attempts.every(item => item.status === 'rejected')).toBe(true)
  expect(post).toHaveBeenCalledTimes(1)
  expect(await db.agentRuns.count()).toBe(1)
  expect(await db.worldviews.count()).toBe(0)
  await expect(readDocumentImportChunkEvidenceV1(f.input)).rejects.toThrow(/作品已切换/)
  await switchActiveWork(f.scope.projectId, f.scope.workId)
  expect(await readDocumentImportChunkEvidenceV1(f.input)).toMatchObject({ state: 'paused', raw, candidate: null })
})

it('022 F2 interruption during candidate publication rolls back the checkpoint but keeps paid evidence without replay', async () => {
  const f = await fixture()
  const post = vi.fn(async () => reply(raw))
  vi.stubGlobal('fetch', post)
  const interrupt = (_id: unknown, event: { type: string }) => {
    if (event.type === 'candidate.persisted') throw new Error('synthetic candidate publication interruption')
  }
  db.agentRunEvents.hook('creating', interrupt)
  try {
    await expect(createDocumentImportChunkCandidateV1(f.input)).rejects.toThrow(/candidate publication interruption/)
  } finally {
    db.agentRunEvents.hook('creating').unsubscribe(interrupt)
  }
  db.close(); await db.open()
  expect(await db.agentRunCheckpoints.count()).toBe(0)
  expect(await readDocumentImportChunkEvidenceV1(f.input)).toMatchObject({ candidate: null, raw,
    observation: { usage: { inputTokens: 31, outputTokens: 17, totalTokens: 48 } } })
  await expect(createDocumentImportChunkCandidateV1(f.input)).rejects.toThrow(/不能再次发送/)
  expect(post).toHaveBeenCalledTimes(1)
  expect(await db.outlineNodes.count()).toBe(0)
})

const adoptableRaw = JSON.stringify({
  worldview: { worldOrigin: '初稿：这里曾是群岛。' },
  outline: [{ type: 'volume', title: '雾港纪事', children: [{ type: 'chapter', title: '第一夜' }] }],
})

it('022 F3 rejects the wrong source and confirmation, then writes the author edit once with a durable receipt', async () => {
  const f = await fixture()
  const post = vi.fn(async () => reply(adoptableRaw))
  vi.stubGlobal('fetch', post)
  const candidate = await createDocumentImportChunkCandidateV1(f.input)
  const confirm = { ...f.input, candidateHash: candidate.candidateHash,
    reviewedResult: { ...candidate.result, worldview: { worldOrigin: '作者校订：这里曾是两座群岛。' } } }
  await expect(confirmDocumentImportChunkV1({ ...confirm, candidateHash: '0'.repeat(64) })).rejects.toThrow(/候选已变化/)
  registerChunkTexts(f.input.sessionId, [{ index: 0, text: source + '替换' }])
  await expect(confirmDocumentImportChunkV1(confirm)).rejects.toThrow(/相同原文件/)
  expect(await db.outlineNodes.count()).toBe(0)
  expect(await db.worldviews.count()).toBe(0)
  registerChunkTexts(f.input.sessionId, [{ index: 0, text: source }])
  const receipt = await confirmDocumentImportChunkV1(confirm)
  expect(await db.worldviews.toArray()).toMatchObject([{ worldId: f.scope.worldId, worldOrigin: '作者校订：这里曾是两座群岛。' }])
  expect(await db.outlineNodes.toArray()).toMatchObject([{ workId: f.scope.workId, title: '雾港纪事' }, { workId: f.scope.workId, title: '第一夜' }])
  expect(await db.importSessions.get(f.input.sessionId)).toMatchObject({ status: 'done', chunks: [
    { status: 'done', durableParse: { confirmation: { receipt } } },
  ] })
  clearChunkTexts(f.input.sessionId)
  db.close(); await db.open()
  expect(await confirmDocumentImportChunkV1(confirm)).toEqual(receipt)
  expect(await db.outlineNodes.count()).toBe(2)
  expect(post).toHaveBeenCalledTimes(1)
})

it('022 F3 receipt write fault rolls back Canon, author confirmation and session checkpoint together', async () => {
  const f = await fixture()
  const post = vi.fn(async () => reply(adoptableRaw))
  vi.stubGlobal('fetch', post)
  const candidate = await createDocumentImportChunkCandidateV1(f.input)
  const confirm = { ...f.input, candidateHash: candidate.candidateHash }
  const fault = (_id: unknown, event: { type: string }) => {
    if (event.type === 'verification.accepted') throw new Error('synthetic receipt interruption')
  }
  db.agentRunEvents.hook('creating', fault)
  try {
    await expect(confirmDocumentImportChunkV1(confirm)).rejects.toThrow(/receipt interruption/)
  } finally {
    db.agentRunEvents.hook('creating').unsubscribe(fault)
  }
  db.close(); await db.open()
  expect(await db.worldviews.count()).toBe(0)
  expect(await db.outlineNodes.count()).toBe(0)
  expect(await db.importSessions.get(f.input.sessionId)).toMatchObject({ status: 'pending', chunks: [{ status: 'pending' }] })
  expect(await db.agentRunEvents.where('type').equals('confirmation.recorded').count()).toBe(0)
  expect(await readDocumentImportChunkEvidenceV1(f.input)).toMatchObject({ state: 'awaiting_confirmation', candidate, raw: adoptableRaw })
  await expect(confirmDocumentImportChunkV1(confirm)).resolves.toMatchObject({ receiptHash: expect.any(String) })
  expect(post).toHaveBeenCalledTimes(1)
})

it.each(['work', 'source'] as const)('022 F2 blocks a %s change during the final formal-entry digest before the real POST', async change => {
  const f = await fixture()
  const other = await createWorldWork(f.scope.projectId, { kind: 'novel', novelProfile: 'long', title: '审查独立作品' })
  const post = vi.fn(async () => reply(raw))
  vi.stubGlobal('fetch', post)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let entered = false
  const original = crypto.subtle.digest.bind(crypto.subtle)
  const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => {
    if (!entered && new Error().stack?.includes('executeFrozenFormalAIEntryV1')) {
      entered = true
      await gate
    }
    return original(algorithm, bytes)
  })
  const pending = createDocumentImportChunkCandidateV1(f.input).then(
    value => ({ value, error: null }), error => ({ value: null, error: String(error) }),
  )
  try {
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 2000 })
    expect(post).not.toHaveBeenCalled()
    if (change === 'work') {
      await switchActiveWork(f.scope.projectId, other.id!)
      expect((await db.projects.get(f.scope.projectId))?.activeWorkId).toBe(other.id)
    } else registerChunkTexts(f.input.sessionId, [{ index: 0, text: source + '替换' }])
  } finally {
    release()
    await pending
    digest.mockRestore()
  }
  expect((await pending).value).toBeNull()
  expect(post).not.toHaveBeenCalled()
  if (change === 'work') await switchActiveWork(f.scope.projectId, f.scope.workId)
  db.close(); await db.open()
  expect(await readDocumentImportChunkEvidenceV1(f.input)).toMatchObject({ state: 'failed', raw: null, candidate: null,
    observation: { usage: null, requestLifecycle: { phase: 'pre-dispatch', responseStatus: null } } })
  await expect(createDocumentImportChunkCandidateV1(f.input)).rejects.toThrow(/不能再次发送/)
  expect(post).not.toHaveBeenCalled()
})

it('022 F2 stops Codex before its POST when the active Work changes while bridge status is pending', async () => {
  const f = await fixture()
  const other = await createWorldWork(f.scope.projectId, { kind: 'novel', novelProfile: 'long', title: '隔离桥接作品' })
  const config = useAIConfigStore.getState().config
  useAIConfigStore.setState({ config: { ...config, provider: 'codex', model: 'synthetic-codex-model', apiKey: '' } })
  let entered = false
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const wire = vi.fn(async (url: unknown) => {
    if (!String(url).endsWith('/status')) throw new Error('blocked: synthetic bridge must not receive a model submission')
    entered = true
    await gate
    return new Response(JSON.stringify({ state: 'ready' }), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', wire)
  const pending = createDocumentImportChunkCandidateV1(f.input).then(
    value => ({ value, error: null }), error => ({ value: null, error: String(error) }),
  )
  try {
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 2000 })
    await switchActiveWork(f.scope.projectId, other.id!)
  } finally {
    release()
    await pending
  }
  expect((await pending).value).toBeNull()
  expect(wire).toHaveBeenCalledTimes(1)
  expect(String(wire.mock.calls[0][0])).toMatch(/\/status$/)
  await switchActiveWork(f.scope.projectId, f.scope.workId)
  expect(await readDocumentImportChunkEvidenceV1(f.input)).toMatchObject({ state: 'failed', raw: null, candidate: null,
    observation: { usage: null, requestLifecycle: { phase: 'pre-dispatch', responseStatus: null } } })
})


it('022 F3 public import records review evidence without writing and reloads without another paid request', async () => {
  const f = await fixture()
  const post = vi.fn(async () => reply(adoptableRaw))
  vi.stubGlobal('fetch', post)
  await runSession(f.input)
  expect(post).toHaveBeenCalledTimes(1)
  expect(await db.worldviews.count()).toBe(0)
  expect(await db.outlineNodes.count()).toBe(0)
  clearChunkTexts(f.input.sessionId)
  db.close(); await db.open()
  await runSession(f.input)
  const evidence = await readPendingDocumentImportV1(f.input)
  expect(evidence).toMatchObject({ state: 'awaiting_confirmation', raw: adoptableRaw })
  expect(post).toHaveBeenCalledTimes(1)
  expect(await db.outlineNodes.count()).toBe(0)
  const candidate = evidence!.candidate!
  await expect(confirmDocumentImportChunkV1({ ...f.input, candidateHash: candidate.candidateHash }))
    .rejects.toThrow(/相同原文件/)
  registerChunkTexts(f.input.sessionId, [{ index: 0, text: source }])
  await confirmDocumentImportChunkV1({ ...f.input, candidateHash: candidate.candidateHash })
  expect(await db.outlineNodes.count()).toBe(2)
  expect(post).toHaveBeenCalledTimes(1)
})

it('022 F3 initializes the scoped Codex catalog on first project import and leaves reference parsing isolated', async () => {
  const projectImport = await fixture()
  expect(await db.codexCategories.count()).toBe(0)
  const categoryRef = 'builtin:city'
  const rawResult = JSON.stringify({ codexCandidates: [
    { categoryRef, name: '雾港守望者', evidenceQuote: '雾港守望者', description: '原文有据' },
    { categoryRef, name: '模型自造', evidenceQuote: '正文无此凭据' },
  ] })
  const post = vi.fn(async (_url: unknown, _init?: RequestInit) => reply(rawResult))
  vi.stubGlobal('fetch', post)
  await runSession(projectImport.input)
  const projectEvidence = await readPendingDocumentImportV1(projectImport.input)
  expect(projectEvidence?.candidate?.result.codexCandidates?.map(item => item.name)).toEqual(['雾港守望者'])
  expect(post).toHaveBeenCalledTimes(1)
  expect(String(post.mock.calls[0][1]?.body)).toContain(categoryRef)
  expect(await db.codexCategories.where('builtInKey').equals('city').toArray()).toMatchObject([{
    projectId: projectImport.scope.projectId, worldId: projectImport.scope.worldId,
  }])
  expect(await db.codexEntries.count()).toBe(0)

  const ref = await fixture('reference', 'quick')
  await runSession(ref.input)
  const referenceEvidence = await readPendingDocumentImportV1(ref.input)
  expect(referenceEvidence?.candidate?.result.codexCandidates).toEqual([])
  expect(post).toHaveBeenCalledTimes(2)
  expect(String(post.mock.calls[1][1]?.body)).not.toContain(categoryRef)
  expect(await db.codexCategories.where('projectId').equals(ref.scope.projectId).count()).toBe(0)
})

it('022 F3 atomically publishes the reviewed reference, then runs deep analysis on the exact original bytes once', async () => {
  const f = await fixture('reference', 'deep')
  const post = vi.fn(async (_url: unknown, init?: RequestInit) =>
    reply(String(init?.body).includes('请分析以下文本') ?
      JSON.stringify({ narrativeStyle: '近距离视角', rawExcerpt: source }) : adoptableRaw))
  vi.stubGlobal('fetch', post)
  await runSession(f.input)
  const candidate = (await readPendingDocumentImportV1(f.input))!.candidate!
  const row = (await db.importSessions.get(f.input.sessionId))!
  await expect(applyReferenceFromSession(f.scope.projectId, row, f.input.sessionId)).rejects.toThrow(/完整作者确认/)
  expect(await db.references.count()).toBe(0)
  const confirm = { ...f.input, candidateHash: candidate.candidateHash }
  const fault = (_id: unknown, event: { type: string }) => {
    if (event.type === 'verification.accepted') throw new Error('synthetic reference receipt interruption')
  }
  db.agentRunEvents.hook('creating', fault)
  try { await expect(confirmDocumentImportChunkV1(confirm)).rejects.toThrow(/reference receipt interruption/) }
  finally { db.agentRunEvents.hook('creating').unsubscribe(fault) }
  expect(await db.references.count()).toBe(0)
  expect(await db.importSessions.get(f.input.sessionId)).toMatchObject({ status: 'pending' })
  const receipt = await confirmDocumentImportChunkV1(confirm)
  expect(await confirmDocumentImportChunkV1(confirm)).toEqual(receipt)
  const published = await db.importSessions.get(f.input.sessionId)
  expect(await db.references.toArray()).toMatchObject([{ id: published!.publishedReferenceId, workId: f.scope.workId, analysisDepth: 'deep' }])
  expect(await db.worldviews.count()).toBe(0)
  expect(await db.outlineNodes.count()).toBe(0)
  expect(post).toHaveBeenCalledTimes(1)
  await runPublishedReferenceAnalysisV1(f.input)
  await runPublishedReferenceAnalysisV1(f.input)
  expect(post).toHaveBeenCalledTimes(2)
  expect(String(post.mock.calls[1][1]?.body)).toContain(source)
  expect(await db.referenceAnalysisRuns.toArray()).toMatchObject([{ referenceId: published!.publishedReferenceId, depth: 'deep' }])
})


it('022 F3 accepts a complete JSON fence required by the existing prompt, preserving the original response byte for byte', async () => {
  const f = await fixture()
  const fenced = ' \n' + String.fromCharCode(96).repeat(3) + 'json\n' + adoptableRaw + '\n' + String.fromCharCode(96).repeat(3) + ' '
  const post = vi.fn(async () => reply(fenced))
  vi.stubGlobal('fetch', post)
  await runSession(f.input)
  const evidence = await readPendingDocumentImportV1(f.input)
  expect(evidence).toMatchObject({ state: 'awaiting_confirmation', raw: fenced,
    candidate: { result: { worldview: { worldOrigin: '初稿：这里曾是群岛。' } } } })
  expect(await db.worldviews.count()).toBe(0)
  expect(post).toHaveBeenCalledTimes(1)
})

it.each(['Run', 'Source'] as const)('022 can explicitly start deep analysis after the initial %s write fails', async boundary => {
  const f = await fixture('reference', 'deep')
  const post = vi.fn(async (_url: unknown, init?: RequestInit) =>
    reply(String(init?.body).includes('请分析以下文本') ?
      JSON.stringify({ narrativeStyle: '近距离视角', rawExcerpt: source }) : adoptableRaw))
  vi.stubGlobal('fetch', post)
  await runSession(f.input)
  const candidate = (await readPendingDocumentImportV1(f.input))!.candidate!
  const receipt = await confirmDocumentImportChunkV1({ ...f.input, candidateHash: candidate.candidateHash })
  const fault = () => { throw new Error(`synthetic failure creating initial reference analysis ${boundary}`) }
  if (boundary === 'Run') db.referenceAnalysisRuns.hook('creating', fault)
  else db.referenceAnalysisSources.hook('creating', fault)
  try { await expect(runPublishedReferenceAnalysisV1(f.input)).rejects.toThrow(/synthetic failure creating/) }
  finally {
    if (boundary === 'Run') db.referenceAnalysisRuns.hook('creating').unsubscribe(fault)
    else db.referenceAnalysisSources.hook('creating').unsubscribe(fault)
  }
  expect((await db.importSessions.get(f.input.sessionId))?.referenceAnalysisStartedAt).toBeUndefined()
  expect(await db.referenceAnalysisRuns.count()).toBe(0)
  expect(await db.referenceAnalysisSources.count()).toBe(0)
  expect(await db.references.count()).toBe(1)
  expect(post).toHaveBeenCalledTimes(1)
  db.close(); await db.open()
  expect((await db.importSessions.get(f.input.sessionId))?.chunks[0].durableParse?.confirmation?.receipt).toEqual(receipt)
  await runPublishedReferenceAnalysisV1(f.input)
  await runPublishedReferenceAnalysisV1(f.input)
  expect(await db.referenceAnalysisRuns.count()).toBe(1)
  expect(await db.referenceAnalysisSources.count()).toBe(1)
  expect((await db.importSessions.get(f.input.sessionId))?.referenceAnalysisStartedAt).toEqual(expect.any(Number))
  expect(post).toHaveBeenCalledTimes(2)
})


it('022 F3 same-name adoption keeps current author axes and text when a late candidate has older axes', async () => {
  const f = await fixture()
  const original = stampNewRecord(f.scope, 'characters', {
    projectId: f.scope.projectId, name: '雾港守望者', homeWorldGroupId: null,
    roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
    shortDescription: '原作者简介', createdAt: 1, updatedAt: 1,
  }, { owner: 'world' }) as Character
  const id = await db.characters.add(original)
  const post = vi.fn(async () => {
    await db.characters.update(id, { roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful', shortDescription: '请求后作者修订' })
    return reply(JSON.stringify({ characters: [{ name: original.name, roleWeight: 'npc', moralAxis: 'evil',
      orderAxis: 'chaotic', shortDescription: '文档中她守候夜航船。' }] }))
  })
  vi.stubGlobal('fetch', post)
  await runSession(f.input)
  expect(await db.characters.get(id)).toMatchObject({ roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful', shortDescription: '请求后作者修订' })
  const candidate = (await readPendingDocumentImportV1(f.input))!.candidate!
  await confirmDocumentImportChunkV1({ ...f.input, candidateHash: candidate.candidateHash })
  expect(await db.characters.toArray()).toMatchObject([{ id, roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful',
    shortDescription: '请求后作者修订\n\n文档中她守候夜航船。' }])
  expect(post).toHaveBeenCalledTimes(1)
})


it('022 F3 shallow reference analysis retries only the uncommitted initial local creation', async () => {
  const f = await fixture('reference', 'quick')
  const post = vi.fn(async () => reply(JSON.stringify({ writingTechniques: { narrativeStyle: '视角随作者确认保存' } })))
  vi.stubGlobal('fetch', post)
  await runSession(f.input)
  const candidate = (await readPendingDocumentImportV1(f.input))!.candidate!
  await confirmDocumentImportChunkV1({ ...f.input, candidateHash: candidate.candidateHash })
  const fault = () => { throw new Error('synthetic quick Run create fault') }
  db.referenceAnalysisRuns.hook('creating', fault)
  try { await expect(runPublishedReferenceAnalysisV1(f.input)).rejects.toThrow(/quick Run create fault/) }
  finally { db.referenceAnalysisRuns.hook('creating').unsubscribe(fault) }
  expect((await db.importSessions.get(f.input.sessionId))?.referenceAnalysisStartedAt).toBeUndefined()
  await runPublishedReferenceAnalysisV1(f.input)
  await runPublishedReferenceAnalysisV1(f.input)
  expect(await db.referenceAnalysisRuns.count()).toBe(1)
  expect(post).toHaveBeenCalledTimes(1)
})
