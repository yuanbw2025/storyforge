import { Blob as NativeBlob } from 'node:buffer'
import { openImportBlobTextSourceV1 } from '../../src/lib/import/blob-text-source'
import { registerBlobImportSourceV1, verifyBlobImportSourceV1 } from '../../src/lib/import/frozen-source-recovery'
import { readChunkTextV1, clearChunkTexts, getChunkText } from '../../src/lib/import/chunk-text-registry'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { planNewDocumentImportV1, planNewBlobDocumentImportV1 } from '../../src/lib/import/document-import-plan'
import { recoverFrozenImportSourceV1 } from '../../src/lib/import/frozen-source-recovery'
import { chunkDocument, planAdaptiveDocumentParseChunksV1, quickHash, type ChunkPlan } from '../../src/lib/import/chunker'
import { hashImportChunkTextV1, useImportSessionStore } from '../../src/stores/import-session'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { usePromptStore } from '../../src/stores/prompt'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { finiteServiceConfigFixtureV1 } from '../helpers/model-capacity-fixture'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import type { WorkspaceScope } from '../../src/lib/types'

const originalConfig = useAIConfigStore.getState().config
beforeEach(async () => {
  await db.delete(); await db.open(); resetModelCapacityForTestsV1()
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No external/model requests') }))
})
afterEach(async () => {
  expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  useAIConfigStore.setState({ config: originalConfig }); resetModelCapacityForTestsV1(); await db.delete()
})
async function session(scope: WorkspaceScope, text: string, plans: ChunkPlan[], chunkSize: number, omitLabels = false) {
  const id = await useImportSessionStore.getState().create({ projectId: scope.projectId, targetScope: scope, filename: 'exact.txt',
    fileHash: quickHash(text), totalChars: text.length, totalChunks: plans.length, chunkSize,
    chunks: await Promise.all(plans.map(async plan => ({ index: plan.index, startChar: plan.startChar, endChar: plan.endChar,
      charCount: plan.charCount, ...(omitLabels ? {} : { label: plan.label }), sourceTextHash: await hashImportChunkTextV1(plan.text), status: 'pending' as const, attempts: 0 }))),
    merged: {}, rollingContext: '', importTarget: 'reference', status: 'pending' })
  return (await db.importSessions.get(id))!
}
it('uses the bound full request capacity for new plans, preserving an entire large source without a fixed 50000 limit', async () => {
  const { scope } = await seedCurrentWorkspace('031 automatic')
  const text = '  \r\n第一章 巨章\r\n' + '海'.repeat(60_001) + '\r\n😀尾部　 '
  useAIConfigStore.setState({ config: await finiteServiceConfigFixtureV1(32_768) })
  const small = await planNewDocumentImportV1({ scope, text, importTarget: 'reference', targetWorldGroupId: null })
  useAIConfigStore.setState({ config: await finiteServiceConfigFixtureV1(262_144) })
  const large = await planNewDocumentImportV1({ scope, text, importTarget: 'reference', targetWorldGroupId: null })
  expect(small.length).toBeGreaterThan(large.length); expect(large).toHaveLength(1)
  expect(small.every(plan => plan.text.trim().length > 0)).toBe(true)
  expect(large[0].charCount).toBeGreaterThan(50_000)
  expect(small.map(plan => plan.text).join('')).toBe(text); expect(large[0].text).toBe(text)
  expect(await db.importSessions.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
})
it('rejects an unfit complete template before creating a session, claim or request', async () => {
  const { scope } = await seedCurrentWorkspace('031 template frame')
  useAIConfigStore.setState({ config: await finiteServiceConfigFixtureV1(32_768) })
  const active = usePromptStore.getState().getActive('import.parse-chunk')
  vi.spyOn(usePromptStore.getState(), 'getActive').mockReturnValue({ ...active, systemPrompt: '完整系统框架'.repeat(20_000) })
  await expect(planNewDocumentImportV1({ scope, text: '短原文', importTarget: 'reference', targetWorldGroupId: null })).rejects.toThrow('空请求框架')
  expect(await db.importSessions.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
})
it('does not admit another owner or a reference with a World-group write target', async () => {
  const { scope } = await seedCurrentWorkspace('031 original target')
  const other = await seedCurrentWorkspace('031 other target')
  await expect(planNewDocumentImportV1({ scope: { ...scope, workId: other.scope.workId }, text: '原文', importTarget: 'reference', targetWorldGroupId: null })).rejects.toThrow()
  await expect(planNewDocumentImportV1({ scope, text: '原文', importTarget: 'reference', targetWorldGroupId: 123 })).rejects.toThrow('项目参考不能绑定')
  expect(await db.importSessions.count()).toBe(0)
})
it('rejects a custom template that omits the exact document source before admission', async () => {
  const { scope } = await seedCurrentWorkspace('031 omitted source')
  useAIConfigStore.setState({ config: await finiteServiceConfigFixtureV1(32_768) })
  const active = usePromptStore.getState().getActive('import.parse-chunk')
  vi.spyOn(usePromptStore.getState(), 'getActive').mockReturnValue({ ...active, systemPrompt: '只说你好', userPromptTemplate: '不要读文档' })
  await expect(planNewDocumentImportV1({ scope, text: '必须完整交付的原文', importTarget: 'reference', targetWorldGroupId: null })).rejects.toThrow('没有完整包含')
  expect(await db.importSessions.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
})
it('recovers exact frozen adaptive ranges after model/settings change without rewriting any session evidence', async () => {
  const { scope } = await seedCurrentWorkspace('031 frozen ranges')
  const text = ' \r\n😀𠀀Cafe\u0301'.repeat(35) + '尾部　 \r\n'
  const plans = planAdaptiveDocumentParseChunksV1(text, chunk => chunk.charCount <= 37)
  const frozen = await session(scope, text, plans, 50_000)
  useAIConfigStore.setState({ config: await finiteServiceConfigFixtureV1(262_144) })
  const restored = await recoverFrozenImportSourceV1(text, frozen)
  expect(restored).toEqual(plans); expect(restored.map(plan => plan.text).join('')).toBe(text)
  expect(await db.importSessions.get(frozen.id!)).toEqual(frozen); expect(await db.agentRuns.count()).toBe(0)
})
it.each(['paragraphs', 'overlap'])('preserves the original legacy %s chunk text and optional labels', async kind => {
  const { scope } = await seedCurrentWorkspace('031 original legacy')
  const text = kind === 'paragraphs' ? '  ' + '第一段'.repeat(2200) + '  \r\n\r\n  ' + '第二段'.repeat(2000) + '　 '
    : '无章节连续原文'.repeat(2200)
  const plans = chunkDocument(text, { targetChars: 5000 })
  const frozen = await session(scope, text, plans, 5000, true)
  const restored = await recoverFrozenImportSourceV1(text, frozen)
  expect(restored.map(({ label: _label, ...plan }) => plan)).toEqual(plans.map(({ label: _label, ...plan }) => plan))
  expect(restored.every(plan => plan.label === undefined)).toBe(true)
  expect(await db.importSessions.get(frozen.id!)).toEqual(frozen)
})
it('rejects changed originals or forged range hashes without replanning or altering the original record', async () => {
  const { scope } = await seedCurrentWorkspace('031 changed source'), text = '全篇原文。'.repeat(40)
  const plans = planAdaptiveDocumentParseChunksV1(text, chunk => chunk.charCount <= 37)
  const frozen = await session(scope, text, plans, 50_000)
  await expect(recoverFrozenImportSourceV1(text + ' ', frozen)).rejects.toThrow('原导入文件不同')
  await expect(recoverFrozenImportSourceV1(text, { ...frozen, chunks: frozen.chunks.map((chunk, index) => index ? chunk : { ...chunk, sourceTextHash: 'a'.repeat(64) }) })).rejects.toThrow('分块摘要不一致')
  expect(await db.importSessions.get(frozen.id!)).toEqual(frozen); expect(await db.agentRuns.count()).toBe(0)
})

it('plans the streamed original using complete request budgets and recovers immutable ranges without retaining all chunk text', async () => {
  const { scope } = await seedCurrentWorkspace('031 bounded source')
  useAIConfigStore.setState({ config: await finiteServiceConfigFixtureV1(32_768) })
  const text = '第一章 全文\r\n' + '逐字原文🌊e\u0301。'.repeat(19000) + '\r\n最后原文。'
  const blob = new NativeBlob([text]) as unknown as Blob
  const source = await openImportBlobTextSourceV1(blob)
  const plans = await planNewBlobDocumentImportV1({ scope, source, importTarget: 'reference', targetWorldGroupId: null })
  expect(plans.length).toBeGreaterThan(2); expect(plans.every(plan => !('text' in plan))).toBe(true)
  let cursor = 0
  for (const plan of plans) {
    expect(plan.startChar).toBe(cursor); cursor = plan.endChar
    expect(plan.sourceTextHash).toBe(await hashImportChunkTextV1(text.slice(plan.startChar, plan.endChar)))
  }
  expect(cursor).toBe(text.length)
  const materialized = await Promise.all(plans.map(async plan => ({ ...plan, text: await source.read(plan.startChar, plan.endChar) })))
  const frozen = await session(scope, text, materialized, Math.max(...plans.map(plan => plan.charCount)))
  try {
    const restored = await openImportBlobTextSourceV1(blob)
    await verifyBlobImportSourceV1(restored, frozen)
    registerBlobImportSourceV1(frozen.id!, restored, frozen.chunks)
    expect(getChunkText(frozen.id!, 0)).toBeUndefined()
    expect(await readChunkTextV1(frozen.id!, plans.length - 1)).toBe(materialized[materialized.length - 1]!.text)
    expect(getChunkText(frozen.id!, 0)).toBeUndefined()
    expect(await db.importSessions.get(frozen.id!)).toEqual(frozen)
    frozen.chunks[0].sourceTextHash = 'forged'
    await expect(verifyBlobImportSourceV1(restored, frozen)).rejects.toThrow('分块摘要不一致')
  } finally { clearChunkTexts(frozen.id!) }
})
it('cancels streamed planning without creating a paid attempt or replacing the original source', async () => {
  const { scope } = await seedCurrentWorkspace('031 cancelled plan')
  useAIConfigStore.setState({ config: await finiteServiceConfigFixtureV1(32_768) })
  const source = await openImportBlobTextSourceV1(new NativeBlob(['原文'.repeat(120000)]) as unknown as Blob)
  const controller = new AbortController()
  await expect(planNewBlobDocumentImportV1({ scope, source, importTarget: 'reference', targetWorldGroupId: null,
    signal: controller.signal, onProgress: () => controller.abort() })).rejects.toThrow()
  expect(await db.importSessions.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
})
