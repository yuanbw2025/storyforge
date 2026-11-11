import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { runCharacterMerge } from '../../src/lib/import/character-merge'
import { applyProjectFromSession, applyReferenceFromSession, readPendingDocumentImportV1, cancelPipeline, clearChunkTexts, registerChunkTexts, retryFailedChunks, runSession } from '../../src/lib/import/pipeline'
import { confirmDocumentImportChunkV1 } from '../../src/lib/import/document-parse-adoption'
import { quickHash } from '../../src/lib/import/chunker'
import { hashImportChunkTextV1, useImportSessionStore } from '../../src/stores/import-session'
import { useImportStatusStore } from '../../src/stores/import-status'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const config = { provider: 'agnes' as const, model: 'agnes-2.5-flash', baseUrl: 'https://example.invalid/v1',
  apiKey: 'sfqa022-synthetic-only', temperature: 0, maxTokens: 1000 }
const originalAI = useAIConfigStore.getState()
const FOREIGN = '不得交给模型的异界角色'
const ALIAS = '同目标世界的原角色甲'
const PRIMARY = '原角色主甲'
const SOURCE_TEXT = '隔离测试原文：灯塔守望者不离开雾港。'
const activeSessions: number[] = []
const EDIT = '作者在模型回复前刚保存的合法新描述'

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.setState({ config, taskRoutes: {}, rememberApiKey: false })
})
afterEach(() => {
  for (const id of activeSessions.splice(0)) clearChunkTexts(id)
  useImportStatusStore.getState().reset()
  vi.unstubAllGlobals(); db.close(); useAIConfigStore.setState(originalAI)
})

async function fixture(importTarget: 'project' | 'reference') {
  const f = await seedCurrentWorkspace('022 legacy admission isolated', { enableMultiWorld: true })
  const group = (name: string, order: number) => db.worldGroups.add(stampNewRecord(f.scope, 'worldGroups', {
    projectId: f.scope.projectId, name, description: '', type: order ? 'parallel' : 'primary', order,
    createdAt: 1, updatedAt: 1,
  }, { owner: 'world' }))
  const targetGroupId = await group('明确选择的世界组', 0)
  const otherGroupId = await group('未选的世界组', 1)
  const character = (name: string, homeWorldGroupId: number) => db.characters.add(stampNewRecord(f.scope, 'characters', {
    projectId: f.scope.projectId, name, homeWorldGroupId, roleWeight: 'main', moralAxis: 'neutral',
    orderAxis: 'neutral', shortDescription: '原描述', appearance: '', personality: '', background: '',
    motivation: '', abilities: '', relationships: '', arc: '', createdAt: 1, updatedAt: 1,
  }, { owner: 'world' }))
  const primaryId = await character(PRIMARY, targetGroupId)
  const aliasId = await character(ALIAS, targetGroupId)
  const foreignId = await character(FOREIGN, otherGroupId)
  const sessionId = await db.importSessions.add({ projectId: f.scope.projectId, filename: 'isolated.txt',
    fileHash: 'a'.repeat(64), totalChars: 12, totalChunks: 1, chunkSize: 1000,
    chunks: [{ index: 0, startChar: 0, endChar: 12, charCount: 12, status: 'done', attempts: 1 }],
    merged: {}, rollingContext: '', importTarget, targetWorldGroupId: targetGroupId,
    status: 'running', createdAt: 1, updatedAt: 1,
  })
  return { ...f, sessionId, primaryId, aliasId, foreignId }
}

function syntheticMerge(aliases: string[], beforeReply?: () => Promise<unknown>) {
  const wire = vi.fn(async (_url: unknown, _init?: RequestInit) => {
    await beforeReply?.()
    return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: JSON.stringify({ mergeGroups: [{ canonical: PRIMARY, aliases }] }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 },
    }), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', wire)
  return wire
}

it('022 a reference-only import cannot read or merge any existing project characters', async () => {
  const f = await fixture('reference'), before = await db.characters.toArray()
  const wire = syntheticMerge([PRIMARY, ALIAS, FOREIGN])
  await runCharacterMerge({ sessionId: f.sessionId, projectId: f.scope.projectId, isFinal: true })
  expect(wire).not.toHaveBeenCalled()
  expect(await db.characters.toArray()).toEqual(before)
})

it('022 a target-world import must not send or remove an unselected-world character', async () => {
  const f = await fixture('project')
  const before = await db.characters.get(f.foreignId)
  const wire = syntheticMerge([PRIMARY, FOREIGN])
  await runCharacterMerge({ sessionId: f.sessionId, projectId: f.scope.projectId, isFinal: true })
  expect(wire.mock.calls.map(call => String(call[1]?.body ?? '')).join('\n')).not.toContain(FOREIGN)
  expect(await db.characters.get(f.foreignId)).toEqual(before)
})

it('022 model-suggested aliases must not overwrite a concurrent author edit or delete source rows', async () => {
  const f = await fixture('project')
  let edited = false
  syntheticMerge([PRIMARY, ALIAS], async () => {
    await db.characters.update(f.primaryId, { shortDescription: EDIT, updatedAt: Date.now() })
    edited = true
  })
  await runCharacterMerge({ sessionId: f.sessionId, projectId: f.scope.projectId, isFinal: true })
  expect((await db.characters.get(f.primaryId))?.shortDescription).toBe(edited ? EDIT : '原描述')
  expect(await db.characters.get(f.aliasId)).toBeDefined()
})

async function boundSession(importTarget: 'project' | 'reference' = 'project', texts = [SOURCE_TEXT]) {
  const f = await seedCurrentWorkspace('022 exact World and Work isolated')
  const store = useImportSessionStore.getState()
  let offset = 0
  const chunks = await Promise.all(texts.map(async (text, index) => {
    const startChar = offset
    offset += text.length
    return { index, startChar, endChar: offset, charCount: text.length,
      sourceTextHash: await hashImportChunkTextV1(text), status: 'pending' as const, attempts: 0 }
  }))
  const sessionId = await store.create({ projectId: f.scope.projectId, targetScope: f.scope,
    filename: 'bound.txt', fileHash: quickHash(texts.join('')), totalChars: offset, totalChunks: texts.length, chunkSize: 1000,
    chunks, importTarget, targetWorldGroupId: null, status: 'pending', merged: {}, rollingContext: '',
  })
  activeSessions.push(sessionId)
  registerChunkTexts(sessionId, texts.map((text, index) => ({ index, text })))
  return { ...f, sessionId, args: { projectId: f.scope.projectId, sessionId } }
}

function syntheticParse(beforeReply?: () => Promise<unknown>) {
  const wire = vi.fn(async (_url: unknown, _init?: RequestInit) => {
    await beforeReply?.()
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({
      worldview: { worldOrigin: '待导入世界内容' }, outline: [{ type: 'volume', title: '旧请求不得写入其他作品', children: [] }],
    }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 16, completion_tokens: 8, total_tokens: 24 } }),
    { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', wire)
  return wire
}

async function confirmNext(args: { sessionId: number; projectId: number }) {
  const candidate = (await readPendingDocumentImportV1(args))?.candidate
  expect(candidate).toBeTruthy()
  await confirmDocumentImportChunkV1({ ...args, chunkIndex: candidate!.chunkIndex, candidateHash: candidate!.candidateHash })
}

it('022 reference-only public pipeline parses and saves its own reference after author confirmation, and never auto-merges project roles', async () => {
  const f = await boundSession('reference')
  const wire = syntheticParse()
  await runSession(f.args)
  expect(wire).toHaveBeenCalledTimes(1)
  expect(String(wire.mock.calls[0][1]?.body)).toContain(SOURCE_TEXT)
  expect(await db.references.count()).toBe(0)
  await confirmNext(f.args)
  expect(await db.references.toArray()).toEqual([expect.objectContaining({ projectId: f.scope.projectId, workId: f.scope.workId,
    importSessionId: f.sessionId })])
  expect(await db.worldviews.count()).toBe(0)
  expect(await db.outlineNodes.count()).toBe(0)
  expect(await db.characters.count()).toBe(0)
  expect(await db.importSessions.get(f.sessionId)).toMatchObject({ status: 'done' })
})

it('022 a same-project Work switch during a real parser response cannot write to either Work or resume there', async () => {
  const f = await boundSession()
  const other = await createWorldWork(f.scope.projectId, { kind: 'novel', novelProfile: 'long', title: '不同作品' })
  const wire = syntheticParse(() => switchActiveWork(f.scope.projectId, other.id!))
  await runSession(f.args)
  expect(wire).toHaveBeenCalledTimes(1)
  expect(useImportStatusStore.getState().fatalError).toMatch(/作品已切换/)
  expect(await db.worldviews.count()).toBe(0)
  expect(await db.outlineNodes.count()).toBe(0)
  const before = await db.importSessions.get(f.sessionId)
  await expect(retryFailedChunks(f.args)).rejects.toThrow(/作品已切换/)
  expect(await db.importSessions.get(f.sessionId)).toEqual(before)
  expect(wire).toHaveBeenCalledTimes(1)
})

it('022 equal-count substitute source and historical unbound session cannot dispatch', async () => {
  const f = await boundSession()
  const wire = syntheticParse()
  registerChunkTexts(f.sessionId, [{ index: 0, text: SOURCE_TEXT.replace('雾港', '外域') }])
  await runSession(f.args)
  expect(useImportStatusStore.getState().fatalError).toMatch(/分块原文/)
  expect((await db.importSessions.get(f.sessionId))?.chunks[0].attempts).toBe(0)
  expect(await db.codexCategories.count()).toBe(0)
  await db.importSessions.update(f.sessionId, { targetScope: undefined })
  const legacy = await db.importSessions.get(f.sessionId)
  await expect(runSession(f.args)).rejects.toThrow(/旧导入/)
  expect(await db.importSessions.get(f.sessionId)).toEqual(legacy)
  expect(wire).not.toHaveBeenCalled()
})

const SECOND = '第二块：天明前不许摇响船铃。'
const SUBSTITUTE = SECOND.replace('船铃', '异物')

it.each(['substituted', 'missing'] as const)('022 a %s second chunk blocks the whole import before send, attempts or Canon writes', async (caseName) => {
  const f = await boundSession('project', [SOURCE_TEXT, SECOND])
  const wire = syntheticParse()
  const before = await db.importSessions.get(f.sessionId)
  registerChunkTexts(f.sessionId, [{ index: 0, text: SOURCE_TEXT },
    ...(caseName === 'substituted' ? [{ index: 1, text: SUBSTITUTE }] : [])])

  await runSession(f.args)

  expect(wire).not.toHaveBeenCalled()
  expect(await db.importSessions.get(f.sessionId)).toEqual(before)
  expect(await db.outlineNodes.count()).toBe(0)
  expect(await db.worldviews.count()).toBe(0)
  expect(useImportStatusStore.getState().fatalError).toMatch(/分块原文/)
})

it('022 in-flight later cache replacement cannot affect the first candidate or authorize the next attempt', async () => {
  const f = await boundSession('project', [SOURCE_TEXT, SECOND])
  let first = true
  const wire = syntheticParse(async () => {
    if (!first) return
    first = false
    registerChunkTexts(f.sessionId, [{ index: 0, text: SOURCE_TEXT }, { index: 1, text: SUBSTITUTE }])
  })
  await runSession(f.args)
  expect(wire).toHaveBeenCalledTimes(1)
  await confirmNext(f.args)
  await runSession(f.args)
  expect(wire).toHaveBeenCalledTimes(1)
  expect(useImportStatusStore.getState().fatalError).toMatch(/分块原文/)
  registerChunkTexts(f.sessionId, [{ index: 0, text: SOURCE_TEXT }, { index: 1, text: SECOND }])
  await runSession(f.args)
  await confirmNext(f.args)
  expect(wire).toHaveBeenCalledTimes(2)
  expect(String(wire.mock.calls[1][1]?.body)).toContain(SECOND)
  expect(String(wire.mock.calls[1][1]?.body)).not.toContain(SUBSTITUTE)
  clearChunkTexts(f.sessionId)
  const report = await useImportSessionStore.getState().load(f.sessionId)
  expect(report).toMatchObject({ status: 'done', finalReport: expect.any(String) })
  await expect(runSession(f.args)).rejects.toThrow(/已结束/)
  expect(await useImportSessionStore.getState().load(f.sessionId)).toEqual(report)
  expect(wire).toHaveBeenCalledTimes(2)
})

it('022 cancellation during parser transport cannot apply the delayed result', async () => {
  const f = await boundSession()
  const wire = syntheticParse(async () => cancelPipeline())
  await runSession(f.args)
  expect(wire).toHaveBeenCalledTimes(1)
  expect(await db.importSessions.get(f.sessionId)).toMatchObject({ status: 'cancelled' })
  expect(await db.worldviews.count()).toBe(0)
  expect(await db.outlineNodes.count()).toBe(0)
  await expect(retryFailedChunks(f.args)).rejects.toThrow(/已结束/)
})

it('022 explicit same-Work reuse keeps a reference separate unless the author picks project reuse', async () => {
  const f = await boundSession('reference')
  const wire = syntheticParse()
  await runSession(f.args)
  await confirmNext(f.args)
  const original = (await db.importSessions.get(f.sessionId))!
  await expect(applyProjectFromSession(f.scope.projectId, original)).rejects.toThrow(/明确选择/)
  expect(await db.outlineNodes.count()).toBe(0)
  await expect(applyProjectFromSession(f.scope.projectId, original, null, undefined, true))
    .resolves.toMatchObject({ outlineNodes: 1 })
  expect(await db.outlineNodes.toArray()).toEqual([expect.objectContaining({ workId: f.scope.workId })])
  const foreign = await seedCurrentWorkspace('022 different workspace')
  await expect(applyReferenceFromSession(foreign.scope.projectId, original, f.sessionId)).rejects.toThrow(/会话、原文或目标/)
  expect(await db.references.count()).toBe(1)
  expect(wire).toHaveBeenCalledTimes(1)
})
