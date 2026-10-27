import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCharacterStore } from '../../src/stores/character'
import { applyCharacterReferenceRemap } from '../../src/lib/registry/character-references'
import { transactionTablesFor } from '../../src/lib/registry/lifecycle'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { addCurrentWorkFixtureV1, addCurrentWorldFixtureV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import { stringifyFields, readStateCardFields } from '../../src/lib/types/state-card'
import type { Character, StateCard, WorkspaceScope } from '../../src/lib/types'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

async function addCharacter(scope: WorkspaceScope, name: string) {
  return db.characters.add(stampNewRecord(scope, 'characters', {
    projectId: scope.projectId, name, roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful',
    shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '', arc: '',
    createdAt: Date.now(), updatedAt: Date.now(),
  } as Character)) as Promise<number>
}
async function card(scope: WorkspaceScope, name: string, key = '位置', value = '断桥') {
  return db.stateCards.add(stampNewRecord(scope, 'stateCards', {
    projectId: scope.projectId, category: 'character', entityName: name,
    fields: stringifyFields([{ key, value }]), createdAt: Date.now(), updatedAt: Date.now(),
  } as StateCard)) as Promise<number>
}
async function siblingWork(scope: WorkspaceScope, sameWorld: boolean): Promise<WorkspaceScope> {
  const worldId = sameWorld ? scope.worldId : (await addCurrentWorldFixtureV1({ projectId: scope.projectId, name: '另一个 World' })).id!
  const work = await addCurrentWorkFixtureV1({ projectId: scope.projectId, worldId, create: { title: '另一本长篇', kind: 'novel', novelProfile: 'long' } })
  return { projectId: scope.projectId, worldId, workId: work.id! }
}
async function merge(scope: WorkspaceScope, from: number, fromName: string, to: number, toName: string) {
  await db.transaction('rw', transactionTablesFor('importProject'), async () => {
    await applyCharacterReferenceRemap({ projectId: scope.projectId, fromCharacterId: from, fromName, toCharacterId: to, toName })
    await db.characters.delete(from)
  })
}
describe('character state-card owner and same-name preservation', () => {
  beforeEach(async () => { resetPendingEditCoordinatorForTestsV1(); useCharacterStore.setState({ characters: [], loadedScope: null }); await db.delete(); await db.open() })
  afterEach(() => { resetPendingEditCoordinatorForTestsV1(); db.close() })
  it('deletion cleans the source World works and preserves a same-name card in another World', async () => {
    const { scope } = await seedCurrentWorkspace('角色删除边界')
    const second = await siblingWork(scope, true), foreign = await siblingWork(scope, false)
    const id = await addCharacter(scope, '林照'); await addCharacter(foreign, '林照')
    const firstCard = await card(scope, '林照'), secondCard = await card(second, '林照'), foreignCard = await card(foreign, '林照')
    const before = await db.stateCards.get(foreignCard)
    await useCharacterStore.getState().loadAll(scope); await useCharacterStore.getState().deleteCharacter(id)
    expect(await db.stateCards.get(firstCard)).toBeUndefined(); expect(await db.stateCards.get(secondCard)).toBeUndefined()
    expect(await db.stateCards.get(foreignCard)).toEqual(before)
  })
  it('merging equal names keeps the existing state instead of deleting it', async () => {
    const { scope } = await seedCurrentWorkspace('同名角色合并')
    const a = await addCharacter(scope, '林照'), b = await addCharacter(scope, '林照')
    const state = await card(scope, '林照'); const before = await db.stateCards.get(state)
    await merge(scope, a, '林照', b, '林照')
    expect(await db.stateCards.get(state)).toEqual(before)
  })
  it('deleting one ambiguous same-name character preserves the surviving character state', async () => {
    const { scope } = await seedCurrentWorkspace('同名角色删除')
    const a = await addCharacter(scope, '林照'), b = await addCharacter(scope, '林照')
    const state = await card(scope, '林照'); const before = await db.stateCards.get(state)
    await useCharacterStore.getState().loadAll(scope); await useCharacterStore.getState().deleteCharacter(a)
    expect(await db.characters.get(b)).toBeDefined(); expect(await db.stateCards.get(state)).toEqual(before)
  })
  it('renaming merges state independently in each Work', async () => {
    const { scope } = await seedCurrentWorkspace('状态按作品合并')
    const second = await siblingWork(scope, true)
    const from = await addCharacter(scope, '旧名'), to = await addCharacter(scope, '林照')
    const first = await card(scope, '林照', '位置', '北岸'), next = await card(second, '林照', '位置', '南岸')
    await card(scope, '旧名', '伤势', '左手擦伤'); await card(second, '旧名', '物品', '盐票')
    await merge(scope, from, '旧名', to, '林照')
    expect(readStateCardFields((await db.stateCards.get(first))!)).toEqual([{ key: '位置', value: '北岸' }, { key: '伤势', value: '左手擦伤' }])
    expect(readStateCardFields((await db.stateCards.get(next))!)).toEqual([{ key: '位置', value: '南岸' }, { key: '物品', value: '盐票' }])
  })
  it('unknown source ownership and a cross-World merge both fail without changing states', async () => {
    const { scope } = await seedCurrentWorkspace('拒绝错域重映射'), foreign = await siblingWork(scope, false)
    const source = await addCharacter(scope, '旧名'), target = await addCharacter(foreign, '林照')
    const state = await card(scope, '旧名'); const before = await db.stateCards.get(state)
    await expect(merge(scope, source, '旧名', target, '林照')).rejects.toThrow(/原 World/)
    expect(await db.stateCards.get(state)).toEqual(before); expect(await db.characters.get(source)).toBeDefined()
    await db.characters.update(source, { worldId: undefined } as Partial<Character>)
    await expect(merge(scope, source, '旧名', target, '林照')).rejects.toThrow(/归属/)
    expect(await db.stateCards.get(state)).toEqual(before)
  })
  it('unreadable merged fields abort the complete reference transaction', async () => {
    const { scope } = await seedCurrentWorkspace('损坏状态卡回滚')
    const source = await addCharacter(scope, '旧名'), target = await addCharacter(scope, '林照')
    const first = await card(scope, '旧名'), broken = await card(scope, '旧名')
    await db.stateCards.update(broken, { fields: '[' })
    const before = await db.stateCards.toArray()
    await expect(merge(scope, source, '旧名', target, '林照')).rejects.toThrow()
    expect(await db.stateCards.toArray()).toEqual(before)
    expect(await db.characters.get(source)).toBeDefined(); expect(await db.stateCards.get(first)).toBeDefined()
  })
})
