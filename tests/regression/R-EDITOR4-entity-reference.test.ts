import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildEditorEntityReferences,
  filterEditorEntityReferences,
  findEditorEntityMatches,
} from '../../src/lib/editor/entity-reference'

describe('R-EDITOR4 · editor entity references', () => {
  it('builds project references with world filtering and stable duplicate priority', () => {
    const references = buildEditorEntityReferences({
      worldGroupId: 2,
      characters: [
        { id: 1, name: '林舟', shortDescription: '主角', homeWorldGroupId: 2 } as any,
        { id: 2, name: '异界人', shortDescription: '不可见', homeWorldGroupId: 3 } as any,
        { id: 3, name: '旅者', shortDescription: '跨界', homeWorldGroupId: 3, isCrossWorld: true } as any,
      ],
      itemEntries: [{ id: 1, projectId: 1, itemName: '林舟', action: 'gain', quantity: 1, createdAt: 1 }],
      locations: [{ id: 1, projectId: 1, name: '青石城', tags: '["城市"]', description: '边城', significance: '', parentId: null, sortOrder: 0, createdAt: 1, updatedAt: 1 }],
      codexCategories: [{ id: 10, projectId: 1, name: '势力', domain: 'humanity', parentId: null, fieldSchema: '[]', order: 0, worldGroupId: null, createdAt: 1, updatedAt: 1 }],
      codexEntries: [
        { id: 11, projectId: 1, categoryId: 10, name: '玄门', summary: '修行势力', description: '', fields: '{}', order: 0, worldGroupId: 2, createdAt: 1, updatedAt: 1 },
        { id: 12, projectId: 1, categoryId: 10, name: '魔域', summary: '错误世界', description: '', fields: '{}', order: 1, worldGroupId: 3, createdAt: 1, updatedAt: 1 },
      ],
    })

    expect(references.map(reference => reference.name)).toEqual(['林舟', '旅者', '青石城', '玄门'])
    expect(references.find(reference => reference.name === '林舟')?.kind).toBe('character')
  })

  it('prefers longest entity matches and filters @ candidates by query', () => {
    const references = [
      { id: 'c1', name: '李明', kind: 'character', kindLabel: '角色', summary: '', details: [] },
      { id: 'c2', name: '李明轩', kind: 'character', kindLabel: '角色', summary: '', details: [] },
      { id: 'l1', name: '明月城', kind: 'location', kindLabel: '地点', summary: '', details: [] },
    ] as const
    const matches = findEditorEntityMatches('李明轩走进明月城，李明随后出现。', references)
    expect(matches.map(match => match.reference.name)).toEqual(['李明轩', '明月城', '李明'])
    expect(filterEditorEntityReferences(references, '明').map(reference => reference.name)).toEqual(['明月城', '李明', '李明轩'])
  })

  it('wires non-persistent decorations, @ completion and hover cards into RichEditor', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/editor/RichEditor.tsx'), 'utf8')
    expect(source).toContain("new PluginKey('storyforgeEntityReferences')")
    expect(source).toContain("'data-entity-id': reference.id")
    expect(source).toContain('insertEntityReference')
    expect(source).toContain("type: 'text'")
    expect(source).toContain('event.isComposing')
    expect(source).toContain('hoveredEntity.reference.details')
    expect(source).toContain("addEventListener('keydown', handleKeyDown, true)")
    expect(source).not.toContain('data-entity-id=')

    const chapterEditor = readFileSync(resolve(process.cwd(), 'src/components/editor/ChapterEditor.tsx'), 'utf8')
    expect(chapterEditor).toContain('loadExisting: loadCodex')
    expect(chapterEditor).toContain('entityReferences={entityReferences}')
  })
})
