import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import type { AIConfig } from '../../src/lib/types'

const config: AIConfig = { provider: 'custom', model: 'b03-unknown-synthetic', baseUrl: 'https://b03.invalid/v1', apiKey: 'synthetic-only', temperature: 0, maxTokens: 12 }
beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })
async function fixture() {
  const made = await seedCurrentWorkspace('B03 完整世界与祖先卷纲')
  const put = (table: string, data: Record<string, unknown>, owner: 'work' | 'world' = 'work') => db.table(table).add(stampNewRecord(made.scope, table,
    { projectId: made.scope.projectId, createdAt: 1, updatedAt: 1, ...data }, { owner })) as Promise<number>
  const parentText = '祖先卷纲明确保留同伴的选择，不强行制造战争。'.repeat(1600) + '【祖先卷纲唯一尾标】'
  const volume = await put('outlineNodes', { type: 'volume', parentId: null, title: '盐门卷', summary: parentText, order: 0 })
  // Future content deliberately has a smaller DB id than both earlier chapters.
  const futureNode = await put('outlineNodes', { type: 'chapter', parentId: volume, title: '明日', summary: '【未来章纲仅属计划】', order: 2 })
  const futureChapter = await put('chapters', { outlineNodeId: futureNode, title: '明日', content: '【未来正文不得进入当前请求】', wordCount: 15, status: 'draft', order: 2, notes: '' })
  const previousNode = await put('outlineNodes', { type: 'chapter', parentId: volume, title: '昨日', summary: '昨日检查守门名单', order: 0 })
  const previousText = '【前章原文首标】' + '同伴已经选择留下，盐门没有预知能力。'.repeat(1200) + '【前章原文尾标】'
  await put('chapters', { outlineNodeId: previousNode, title: '昨日', content: previousText, wordCount: previousText.length, status: 'draft', order: 0, notes: '' })
  const nodeId = await put('outlineNodes', { type: 'chapter', parentId: volume, title: '检查盐门', summary: '检查现有名单后停笔，不进入明日', order: 1 })
  const chapterId = await put('chapters', { outlineNodeId: nodeId, title: '检查盐门', content: '', wordCount: 0, status: 'outline', order: 1, notes: '' })
  await put('detailedOutlines', { outlineNodeId: nodeId, scenes: [{ sceneId: 's1', title: '核对名单', summary: '同伴核对旧名单，确认后停笔',
    conflict: '', location: '盐门', characterIds: [], pace: 'slow', estimatedWords: 800, notes: '不制造战争' }], openingHook: '接续检查', endingCliffhanger: '确认即停笔' })
  const worldText = '【基础设定原文首标】' + '盐门由古代治水者修建，不用记忆换通行，也不能预知未来。'.repeat(3500) + '【基础设定原文唯一尾标】'
  const worldviewId = await put('worldviews', { worldOrigin: worldText }, 'world')
  await put('temporalFacts', { subjectName: '钥匙', predicate: 'owns', value: '【未来事实不得当成已经发生】', factKind: 'state', sourceType: 'chapter',
    status: 'confirmed', locked: true, validFromChapterId: futureChapter, validToChapterId: null, sourceChapterId: futureChapter })
  return { ...made, put, parentText, worldText, previousText, worldviewId, nodeId, chapterId }
}
function assemble(f: Awaited<ReturnType<typeof fixture>>) {
  return prepareProseGatewayAssemblyV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, chapterId: f.chapterId,
    outlineNodeId: f.nodeId, operation: 'generate', taskRequestV2: true, authorRequest: '核对盐门名单后停笔', config })
}

describe('B03 finite full-material collection never falls back to old project/model-policy caps', () => {
  it('delivers >48k base setting, canonical ancestor outline and the full previous chapter without any model/metadata request', async () => {
    const f = await fixture(), fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network'))
    const result = await assemble(f)
    for (const text of [f.worldText, f.parentText, f.previousText]) expect(result.text).toContain(text)
    expect(result.inputBudget).toBeGreaterThan(48_000)
    expect(result.overBudgetAfterTrim).toBe(false)
    expect(result.trimmed).toEqual([])
    expect(result.text).not.toContain('【未来正文不得进入当前请求】')
    expect(result.text).not.toContain('【未来事实不得当成已经发生】')
    expect(result.contextGatewayExecution.modelBudget).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps author-disabled settings blocked rather than bypassing source governance to get more text', async () => {
    const f = await fixture()
    await db.worldviews.update(f.worldviewId, { ragPolicy: { enabled: false } })
    await expect(assemble(f)).rejects.toThrow(/author-disabled|停用/)
    expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe(f.worldText)
  })

  it('retains Work/World isolation while collecting long material', async () => {
    const f = await fixture(), foreign = await seedCurrentWorkspace('不属于目标的作品')
    await db.worldviews.add(stampNewRecord(foreign.scope, 'worldviews', { projectId: foreign.scope.projectId,
      worldOrigin: '【另一个世界的私有设定】', createdAt: 1, updatedAt: 1 }, { owner: 'world' }))
    const result = await assemble(f)
    expect(result.text).toContain(f.worldText)
    expect(result.text).not.toContain('【另一个世界的私有设定】')
  })

  it('fails a missing canonical ancestor instead of inventing a new parent path', async () => {
    const f = await fixture()
    await db.outlineNodes.update(f.nodeId, { parentId: 999_999 })
    await expect(assemble(f)).rejects.toThrow(/父节点/)
  })
})
