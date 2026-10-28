import { describe, expect, it } from 'vitest'
import { buildEditorEntityReferences, type BuildEditorEntityReferencesInput } from '../../src/lib/editor/entity-reference'

function fixture(): BuildEditorEntityReferencesInput {
  return {
    characters: [], itemEntries: [], locations: [], worldGroupId: 2,
    codexCategories: [{ id: 10, projectId: 1, name: '势力', domain: 'humanity', parentId: null,
      fieldSchema: '[{"key":"rank","label":"等级","type":"text"}]', order: 0, createdAt: 1, updatedAt: 1 }],
    codexEntries: [{ id: 11, projectId: 1, categoryId: 10, name: '玄门', summary: '修行势力',
      description: '', fields: '{"rank":"甲等"}', origin: 'manual', sourceEvidenceQuotes: '[]',
      sourceContentHash: '', producerRunId: null, producerCandidateHash: null,
      order: 0, worldGroupId: 2, createdAt: 1, updatedAt: 1 }],
  }
}

describe('Issue225 · chapter entity lookup preserves malformed Codex data', () => {
  it.each([undefined, null, 42, {}, ['错误名称']])('does not crash chapter lookup on invalid name %j', name => {
    const input = fixture()
    input.codexEntries.unshift({ ...input.codexEntries[0]!, id: 12, name: name as string })
    const before = structuredClone(input)
    const references = buildEditorEntityReferences(input)
    expect(references).toHaveLength(1)
    expect(references[0]).toMatchObject({ id: 'codex:11', name: '玄门', summary: '修行势力',
      details: [{ label: '等级', value: '甲等' }] })
    expect(input).toEqual(before)
  })

  it('omits previews for malformed stored fields without changing the entry or reference authority', () => {
    const input = fixture()
    input.codexCategories[0]!.fieldSchema = JSON.stringify([
      { key: 'rank', label: '等级', type: 'text' },
      { key: 'bad', label: '坏值', type: 'text' }, { key: 'link', label: '关系', type: 'ref' },
    ])
    input.codexEntries[0]!.fields = '{"rank":"甲等","bad":42,"link":"私有引用"}'
    input.codexEntries[0]!.summary = { value: '不可转换' } as unknown as string
    input.codexEntries[0]!.description = 23 as unknown as string
    const before = structuredClone(input)
    expect(buildEditorEntityReferences(input)[0]).toMatchObject({ id: 'codex:11', name: '玄门',
      summary: '', details: [] })
    expect(input).toEqual(before)
  })

  it('omits previews for a malformed stored schema while retaining the raw data', () => {
    const input = fixture()
    input.codexCategories[0]!.fieldSchema = JSON.stringify([
      null, { key: 'rank', label: '等级', type: 'text' },
    ])
    const before = structuredClone(input)
    expect(buildEditorEntityReferences(input)[0]).toMatchObject({ id: 'codex:11', details: [] })
    expect(input).toEqual(before)
  })

  it('retains hidden category and other-world exclusion with malformed rows present', () => {
    const input = fixture()
    input.codexEntries.push({ ...input.codexEntries[0]!, id: 12, name: '异界条目', worldGroupId: 3 })
    expect(buildEditorEntityReferences(input).map(x => x.id)).toEqual(['codex:11'])
    input.codexCategories[0]!.hidden = true
    expect(buildEditorEntityReferences(input)).toEqual([])
  })
})
