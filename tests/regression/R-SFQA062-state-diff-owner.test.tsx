import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createWorldWork } from '../../src/lib/workspace/works'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import * as scopes from '../../src/lib/workspace/scope'
import { useStateCardStore } from '../../src/stores/state-card'
import { readStateCardFields } from '../../src/lib/types/state-card'
import type { StateCard, StateDiffItem, WorkspaceScope } from '../../src/lib/types'
import CharacterStatusPanel from '../../src/components/character/CharacterStatusPanel'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const diffs: StateDiffItem[] = [
  { category: 'character', entityName: '林照', field: '位置', oldValue: 'A位置', newValue: 'A新位置' },
  { category: 'character', entityName: '林照', field: '心情', oldValue: null, newValue: '紧张' },
]
async function fixture(bName = '林照') {
  const made = await seedCurrentWorkspace('状态卡 owner')
  const bWork = await createWorldWork(made.scope.projectId, { title: '同壳另一作品', kind: 'novel', novelProfile: 'long' })
  const b = { ...made.scope, workId: bWork.id! }
  const characterId = await db.characters.add(stampNewRecord(made.scope, 'characters', {
    projectId: made.scope.projectId, name: '林照', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '', createdAt: 1, updatedAt: 1,
    appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '[]', arc: '',
  }, { owner: 'world' }))
  const add = (scope: WorkspaceScope, name: string, prefix: string) => db.stateCards.add(stampNewRecord(scope, 'stateCards', {
    projectId: scope.projectId, category: 'character', entityName: name,
    fields: JSON.stringify([{ key: '位置', value: `${prefix}位置` }, { key: `${prefix}私域`, value: `${prefix}秘密` }]), createdAt: 1, updatedAt: 1,
  } satisfies StateCard, { owner: 'work' }))
  const aId = await add(made.scope, '林照', 'A'), bId = await add(b, bName, 'B')
  return { a: made.scope, b, aId, bId, characterId }
}
beforeEach(async () => {
  await db.delete(); await db.open()
  useStateCardStore.setState({ cards: [], loading: false, loadedScope: null })
})
afterEach(() => { vi.restoreAllMocks(); db.close() })

describe('SFQA-062 · scoped state diff adoption', () => {
  for (const cache of ['A', 'B', 'empty'] as const) for (const bName of ['林照', '另一角色']) {
    it(`merges only A current fields with ${cache} cache / B=${bName}`, async () => {
      const f = await fixture(bName)
      const beforeB = await db.stateCards.get(f.bId)
      if (cache !== 'empty') await useStateCardStore.getState().loadAll(cache === 'A' ? f.a : f.b)
      await useStateCardStore.getState().applyDiffs(f.a, diffs)
      const row = (await db.stateCards.get(f.aId))!
      expect(readStateCardFields(row)).toEqual([
        { key: '位置', value: 'A新位置' }, { key: 'A私域', value: 'A秘密' }, { key: '心情', value: '紧张' },
      ])
      expect(await db.stateCards.get(f.bId)).toEqual(beforeB)
      expect(await db.stateCards.count()).toBe(2)
      if (cache === 'B') expect(useStateCardStore.getState().cards).toEqual([beforeB])
    })
  }

  it('rejects a changed target field atomically and leaves the candidate usable for explicit repair', async () => {
    const f = await fixture()
    await useStateCardStore.getState().loadAll(f.a)
    await db.stateCards.update(f.aId, { fields: JSON.stringify([{ key: '位置', value: '作者后来改的位置' }, { key: 'A私域', value: 'A秘密' }]) })
    const before = await db.stateCards.toArray()
    const candidate = structuredClone(diffs)
    await expect(useStateCardStore.getState().applyDiffs(f.a, candidate)).rejects.toThrow(/变化|过期|冲突/)
    expect(await db.stateCards.toArray()).toEqual(before)
    expect(candidate).toEqual(diffs)
  })

  it('rejects foreign source chapters and invalid entities without partially writing the valid diff', async () => {
    const f = await fixture()
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.b, 'outlineNodes', {
      projectId: f.b.projectId, type: 'chapter', parentId: null, title: 'B章纲', summary: '', order: 0, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    const chapterId = await db.chapters.add(stampNewRecord(f.b, 'chapters', {
      projectId: f.b.projectId, title: 'B正文', outlineNodeId, status: 'draft', notes: '', content: 'B正文', order: 0, wordCount: 3, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    const before = await db.stateCards.toArray()
    await expect(useStateCardStore.getState().applyDiffs(f.a, diffs, chapterId)).rejects.toThrow(/章节|作用域/)
    await expect(useStateCardStore.getState().applyDiffs(f.a, [...diffs, { ...diffs[0], entityName: '未登记角色' }])).rejects.toThrow(/角色|登记/)
    expect(await db.stateCards.toArray()).toEqual(before)
  })

  it('a failed domain write rolls back the whole batch', async () => {
    const f = await fixture()
    await useStateCardStore.getState().loadAll(f.a)
    const character = (await db.characters.get(f.characterId))!
    await db.characters.add({ ...character, id: undefined, name: '阿迟' })
    const card = (await db.stateCards.get(f.aId))!
    await db.stateCards.add({ ...card, id: undefined, entityName: '阿迟', fields: JSON.stringify([{ key: '位置', value: 'C位置' }]) })
    const before = await db.stateCards.toArray()
    const update = db.stateCards.update.bind(db.stateCards)
    vi.spyOn(db.stateCards, 'update').mockImplementationOnce(update).mockRejectedValueOnce(new Error('测试写失败'))
    await expect(useStateCardStore.getState().applyDiffs(f.a, [...diffs, { ...diffs[0], entityName: '阿迟', oldValue: 'C位置' }])).rejects.toThrow('测试写失败')
    expect(await db.stateCards.toArray()).toEqual(before)
  })

  it('across-await switching and candidate edits cannot retarget a confirmed delta or the displayed B cache', async () => {
    const f = await fixture()
    let release!: () => void, ready!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const reached = new Promise<void>(resolve => { ready = resolve })
    const original = scopes.resolveScopeLike
    vi.spyOn(scopes, 'resolveScopeLike').mockImplementationOnce(async input => {
      const resolved = await original(input)
      ready(); await gate
      return resolved
    })
    const candidate = structuredClone(diffs)
    const adopting = useStateCardStore.getState().applyDiffs(f.a, candidate)
    await reached
    await db.projects.update(f.a.projectId, { activeWorkId: f.b.workId })
    await useStateCardStore.getState().loadAll(f.b)
    const displayedB = useStateCardStore.getState().cards
    candidate[0].newValue = '确认之后才修改的候选'
    release(); await adopting
    expect(readStateCardFields((await db.stateCards.get(f.aId))!)[0].value).toBe('A新位置')
    expect(useStateCardStore.getState().cards).toEqual(displayedB)
  })

  it('valid new-card multi-field deltas create one card in A while preserving an unrelated latest author field', async () => {
    const f = await fixture()
    await db.stateCards.delete(f.aId)
    const create = diffs.map(diff => ({ ...diff, oldValue: null }))
    await useStateCardStore.getState().applyDiffs(f.a, create)
    const aRows = await scopes.readOwnedRows<StateCard>(f.a, 'stateCards', { owner: 'work' })
    expect(aRows).toHaveLength(1)
    expect(readStateCardFields(aRows[0])).toEqual([{ key: '位置', value: 'A新位置' }, { key: '心情', value: '紧张' }])
    await db.stateCards.update(aRows[0].id!, { fields: JSON.stringify([...readStateCardFields(aRows[0]), { key: '作者新增', value: '保留' }]) })
    await useStateCardStore.getState().applyDiffs(f.a, [{ ...diffs[0], oldValue: 'A新位置', newValue: '下一处' }])
    expect(readStateCardFields((await db.stateCards.get(aRows[0].id!))!)).toContainEqual({ key: '作者新增', value: '保留' })
  })

  it('the actual character status view reads its frozen Work even when the global cache is another Work', async () => {
    const f = await fixture()
    await useStateCardStore.getState().loadAll(f.b)
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const render = (scope: WorkspaceScope) => act(async () => root.render(createElement(CharacterStatusPanel, { scope, characterName: '林照', characterId: f.characterId })))
    try {
      await render(f.a)
      await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); expect(host.textContent).toContain('A位置') })
      expect(host.textContent).not.toContain('B秘密')
      await render(f.b)
      await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); expect(host.textContent).toContain('B位置') })
      expect(host.textContent).not.toContain('A秘密')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
