import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  applyCodexImportCandidates,
  buildCodexImportCategoryOptions,
  formatCodexImportCatalog,
  loadCodexImportCategoryOptions,
  mergeCodexImportCandidates,
  normalizeCodexImportCandidates,
} from '../../src/lib/import/codex-classification'
import type { CodexImportCandidate } from '../../src/lib/types/import-session-data'

function candidate(patch: Partial<CodexImportCandidate> = {}): CodexImportCandidate {
  return {
    categoryRef: 'builtin:city',
    name: '临渊城',
    summary: '海门重镇',
    description: '扼守海峡。',
    fields: { scale: '十万人' },
    tags: ['重镇'],
    confidence: 0.8,
    evidence: [{ chunkIndex: 0, quote: '临渊城扼守海峡' }],
    ...patch,
  }
}

describe('WORLD-1 Phase 35-c: Codex 外部导入分类', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('分类目录使用稳定引用而非数据库 ID，并只暴露可导入的普通字段', () => {
    const categories = [
      {
        id: 9876,
        projectId: 1,
        domain: 'humanity',
        parentId: null,
        name: '城池重镇',
        builtInKey: 'city',
        fieldSchema: JSON.stringify([
          { key: 'scale', label: '规模', type: 'text' },
          { key: 'faction', label: '所属势力', type: 'ref' },
        ]),
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 9877,
        projectId: 1,
        domain: 'humanity',
        parentId: 9876,
        name: '港城',
        fieldSchema: '[]',
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ] as any
    const first = buildCodexImportCategoryOptions(categories)
    const second = buildCodexImportCategoryOptions(categories.map((row: any) => ({
      ...row,
      id: row.id + 1000,
      parentId: row.parentId == null ? null : row.parentId + 1000,
    })))
    expect(first.map(option => option.ref)).toEqual(second.map(option => option.ref))
    expect(first[0].ref).toBe('builtin:city')
    expect(first[1].ref).toMatch(/^custom:humanity:/)
    const promptCatalog = formatCodexImportCatalog(first)
    expect(promptCatalog).not.toContain('9876')
    expect(promptCatalog).toContain('scale')
    expect(promptCatalog).not.toContain('faction')
  })

  it('只接受目录内分类、合法字段和本块逐字证据', () => {
    const options = [{
      ref: 'builtin:city',
      categoryId: 12,
      domain: 'humanity',
      label: '城池重镇',
      fields: [
        { key: 'scale', label: '规模', type: 'text' },
        { key: 'faction', label: '势力', type: 'ref' },
      ],
    }] as any
    const normalized = normalizeCodexImportCandidates([
      {
        categoryRef: 'builtin:city',
        name: '临渊城',
        summary: '海门重镇',
        fields: { scale: '十万人', faction: '海盟', unknown: '丢弃' },
        tags: ['港城', '港城'],
        confidence: 4,
        evidenceQuote: '临渊城扼守海峡',
      },
      {
        categoryRef: 'builtin:city',
        name: '幻城',
        evidenceQuote: '原文里没有这句话',
      },
      {
        categoryRef: 'builtin:not-exists',
        name: '错类',
        evidenceQuote: '临渊城',
      },
    ], '临渊城扼守海峡，万舟汇聚。', 3, options)

    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toMatchObject({
      name: '临渊城',
      fields: { scale: '十万人' },
      tags: ['港城'],
      confidence: 1,
      evidence: [{ chunkIndex: 3, quote: '临渊城扼守海峡' }],
    })
  })

  it('跨块按分类和规范化名称合并，保留更完整内容与全部证据', () => {
    const merged = mergeCodexImportCandidates(
      [candidate({ name: '临 渊城', summary: '重镇', evidence: [{ chunkIndex: 0, quote: '临渊城' }] })],
      [candidate({
        name: '临渊城',
        summary: '东海最大的贸易重镇',
        fields: { economy: '海贸', scale: '百万人常住' },
        tags: ['港城'],
        evidence: [{ chunkIndex: 2, quote: '贸易重镇临渊城' }],
      })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].summary).toBe('东海最大的贸易重镇')
    expect(merged[0].fields).toEqual({ scale: '百万人常住', economy: '海贸' })
    expect(merged[0].evidence).toHaveLength(2)
  })

  it('确认后才写入；同世界同名只补空字段，不覆盖作者内容，多世界不串', async () => {
    const projectId = await db.projects.add({
      name: '多世界',
      genre: 'fantasy',
      enableMultiWorld: true,
      createdAt: 1,
      updatedAt: 1,
    } as any) as number
    const worldA = await db.worldGroups.add({
      projectId,
      name: '甲界',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    } as any) as number
    const worldB = await db.worldGroups.add({
      projectId,
      name: '乙界',
      order: 1,
      createdAt: 1,
      updatedAt: 1,
    } as any) as number
    const options = await loadCodexImportCategoryOptions(projectId)
    const city = options.find(option => option.ref === 'builtin:city')!
    const activeWorldId = (await db.projects.get(projectId))?.activeWorldId
    expect(activeWorldId).toBeTypeOf('number')

    await db.codexEntries.add({
      projectId,
      worldId: activeWorldId,
      worldGroupId: worldA,
      categoryId: city.categoryId,
      name: '临渊城',
      summary: '作者原摘要',
      description: '',
      fields: JSON.stringify({ scale: '作者设定十万人', economy: '' }),
      refs: '{}',
      tags: JSON.stringify(['作者标签']),
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    } as any)

    const before = await db.codexEntries.count()
    expect(before).toBe(1)

    const updated = await applyCodexImportCandidates({
      projectId,
      worldGroupId: worldA,
      candidates: [candidate({
        summary: 'AI 摘要不得覆盖',
        description: '补入的海峡说明',
        fields: { scale: 'AI 百万人', economy: '海贸' },
        tags: ['AI 标签'],
      })],
    })
    expect(updated).toMatchObject({ imported: 0, updated: 1, skipped: 0 })
    const inA = await db.codexEntries.where('projectId').equals(projectId)
      .filter(entry => entry.worldGroupId === worldA).first()
    expect(inA?.summary).toBe('作者原摘要')
    expect(inA?.description).toBe('补入的海峡说明')
    expect(JSON.parse(inA!.fields)).toEqual({
      scale: '作者设定十万人',
      economy: '海贸',
    })
    expect(JSON.parse(inA!.tags!)).toEqual(['作者标签', 'AI 标签'])

    const inserted = await applyCodexImportCandidates({
      projectId,
      worldGroupId: worldB,
      candidates: [candidate()],
    })
    expect(inserted).toMatchObject({ imported: 1, updated: 0, skipped: 0 })
    const rows = await db.codexEntries.where('projectId').equals(projectId).toArray()
    expect(rows.filter(entry => entry.name === '临渊城')).toHaveLength(2)

    const unknown = await applyCodexImportCandidates({
      projectId,
      worldGroupId: worldB,
      candidates: [candidate({ categoryRef: 'builtin:not-there', name: '未知' })],
    })
    expect(unknown.skipped).toBe(1)
    expect(await db.codexEntries.count()).toBe(2)
  })
})
