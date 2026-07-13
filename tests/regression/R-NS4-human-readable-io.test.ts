/**
 * R-NS4-human-readable-io · 人类可读事实/记忆导出 + 候选 diff 导入。
 * 守卫：导出只读；导入只落 candidate/import；未知谓词和跨项目章节引用跳过。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportFactMemoryMarkdown, importFactCandidateDiff } from '../../src/lib/fact-ledger/human-readable-io'

const now = Date.now()

async function seed() {
  const pid = await db.projects.add({ name: 'P', genre: 'x', description: '', targetWordCount: 0, enableMultiWorld: false, createdAt: now, updatedAt: now } as any) as number
  const charId = await db.characters.add({ projectId: pid, name: '林飞', role: 'protagonist', createdAt: now, updatedAt: now } as any) as number
  const ch = await db.chapters.add({ projectId: pid, outlineNodeId: 0, title: '第1章', content: '林飞在洛阳。', wordCount: 0, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now } as any) as number
  const ch2 = await db.chapters.add({ projectId: pid, outlineNodeId: 0, title: '第2章', content: '林飞去北境。', wordCount: 0, status: 'draft', order: 1, notes: '', createdAt: now, updatedAt: now } as any) as number
  return { pid, charId, ch, ch2 }
}

describe('NS-4 · human-readable IO', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('导出 Markdown 同时包含事实账本和层级摘要节点', async () => {
    const { pid, charId, ch } = await seed()
    await db.temporalFacts.add({
      projectId: pid, characterId: charId, subjectName: '林飞', predicate: 'location', factKind: 'state', value: '洛阳',
      sourceType: 'chapter', sourceChapterId: ch, sourceQuote: '林飞在洛阳', status: 'confirmed', locked: false,
      createdAt: now, updatedAt: now,
    } as any)
    await db.narrativeSummaryNodes.add({
      projectId: pid, worldGroupId: null, level: 'book', sourceChapterId: null, sourceOutlineNodeId: null,
      title: '全书叙事摘要', summary: '林飞开局在洛阳。', keywords: ['林飞', '洛阳'],
      sourceHash: 'h', status: 'verified', generatedBy: 'system-rollup', createdAt: now, updatedAt: now,
    } as any)

    const md = await exportFactMemoryMarkdown(pid)
    expect(md).toContain('事实账本')
    expect(md).toContain('林飞')
    expect(md).toContain('洛阳')
    expect(md).toContain('层级叙事摘要')
  })

  it('导入候选 diff 只写 candidate/import，并跳过无效谓词与坏章节引用', async () => {
    const { pid, charId, ch, ch2 } = await seed()
    const otherProject = await db.projects.add({ name: 'Other', genre: 'x', description: '', targetWordCount: 0, enableMultiWorld: false, createdAt: now, updatedAt: now } as any) as number
    const foreignChapter = await db.chapters.add({ projectId: otherProject, outlineNodeId: 0, title: '外部章', content: '', wordCount: 0, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now } as any) as number

    const result = await importFactCandidateDiff(pid, {
      facts: [
        { subjectName: '林飞', predicate: 'location', value: '北境', sourceQuote: '人工整理', validFromChapterId: ch },
        { subjectName: '林飞', predicate: 'unknownPredicate', value: 'X' },
        { subjectName: '林飞', predicate: 'location', value: '坏引用', validFromChapterId: foreignChapter },
        { subjectName: '林飞', predicate: 'location', value: '倒置区间', validFromChapterId: ch2, validToChapterId: ch },
      ],
    })

    expect(result).toEqual({ written: 1, skippedInvalid: 3, skippedDuplicate: 0 })
    const facts = await db.temporalFacts.where('projectId').equals(pid).toArray()
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      characterId: charId,
      status: 'candidate',
      sourceType: 'import',
      sourceRecordTable: 'human-readable-diff',
      value: '北境',
    })
  })
})
