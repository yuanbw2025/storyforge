import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCharacterStore } from '../../src/stores/character'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { fingerprintSettingSource } from '../../src/lib/fact-ledger/setting-assertions'
import type { TemporalFact } from '../../src/lib/types'
import * as scopes from '../../src/lib/workspace/scope'

async function seed() {
  const { scope } = await seedCurrentWorkspace('角色手动保存边界')
  await useCharacterStore.getState().loadAll(scope)
  const id = await useCharacterStore.getState().addCharacter({
    projectId: scope.projectId, name: '林照', roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful',
    shortDescription: '', appearance: '', personality: '', background: '原背景', motivation: '', abilities: '', relationships: '', arc: '',
  })
  return { scope, id }
}
describe('character author save boundary', () => {
  beforeEach(async () => { resetPendingEditCoordinatorForTestsV1(); useCharacterStore.setState({ characters: [], loading: false, loadedScope: null, loadError: null }); await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1(); db.close() })
  it('a deleted row rejects instead of acknowledging a nonexistent save', async () => {
    const { id } = await seed(); await db.characters.delete(id)
    await expect(useCharacterStore.getState().updateCharacter(id, { background: '新背景' })).rejects.toThrow(/删除/)
  })
  it('author patches cannot move owner, identity or model provenance', async () => {
    const { id } = await seed(); const before = await db.characters.get(id)
    await expect(useCharacterStore.getState().updateCharacter(id, { projectId: 900 })).rejects.toThrow(/作者字段/)
    expect(await db.characters.get(id)).toEqual(before)
  })
  it('invalid scalar text stays unchanged instead of crashing the next render', async () => {
    const { id } = await seed(); const before = await db.characters.get(id)
    await expect(useCharacterStore.getState().updateCharacter(id, { name: ['损坏'] as unknown as string })).rejects.toThrow(/格式/)
    expect(await db.characters.get(id)).toEqual(before)
  })
  it('a zero-row write is not acknowledged or published into the cache', async () => {
    const { id } = await seed(); const before = await db.characters.get(id)
    vi.spyOn(db.characters, 'update').mockResolvedValue(0)
    await expect(useCharacterStore.getState().updateCharacter(id, { background: '新背景' })).rejects.toThrow(/删除|保存/)
    expect(useCharacterStore.getState().characters.find(row => row.id === id)).toEqual(before)
  })
  it('stale author text rejects while another field may still save', async () => {
    const { id } = await seed()
    await db.characters.update(id, { background: '另一页面的新背景' })
    await expect(useCharacterStore.getState().updateCharacter(id, { background: '旧草稿' })).rejects.toThrow(/其他页面/)
    expect((await db.characters.get(id))?.background).toBe('另一页面的新背景')
    await useCharacterStore.getState().updateCharacter(id, { appearance: '左手有探路绳勒痕' })
    expect((await db.characters.get(id))?.appearance).toBe('左手有探路绳勒痕')
  })
  it('a fact invalidation failure rolls back the original character write', async () => {
    const { id, scope } = await seed()
    const before = await db.characters.get(id)
    const factId = await db.temporalFacts.add({
      projectId: scope.projectId, workId: scope.workId, subjectName: '林照', predicate: 'past', factKind: 'state',
      value: '原背景', sourceType: 'setting', sourceQuote: '原背景', sourceFingerprint: fingerprintSettingSource('原背景'),
      sourceRecordTable: 'characters', sourceRecordId: id, sourceCharacterId: id, sourceField: 'background',
      status: 'accepted', locked: false, createdAt: Date.now(), updatedAt: Date.now(),
    } as TemporalFact)
    vi.spyOn(db.temporalFacts, 'update').mockRejectedValue(new Error('事实状态写入失败'))
    await expect(useCharacterStore.getState().updateCharacter(id, { background: '更改背景' })).rejects.toThrow('事实状态写入失败')
    expect(await db.characters.get(id)).toEqual(before)
    expect((await db.temporalFacts.get(factId))?.status).toBe('accepted')
  })
  it('read failure keeps same-owner rows, clears loading, and exposes a successful retry', async () => {
    const { scope } = await seed(); const before = useCharacterStore.getState().characters
    const read = vi.spyOn(scopes, 'readOwnedRows').mockRejectedValueOnce(new Error('角色读取配额异常'))
    await useCharacterStore.getState().loadAll(scope)
    expect(useCharacterStore.getState()).toMatchObject({ characters: before, loading: false, loadError: '角色读取配额异常' })
    read.mockRestore(); await useCharacterStore.getState().loadAll(scope)
    expect(useCharacterStore.getState()).toMatchObject({ characters: before, loading: false, loadError: null })
  })
  it('a late old-owner load never replaces the newer owner', async () => {
    const { scope } = await seed(); const next = await seedCurrentWorkspace('另一个角色 World')
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
    const read = scopes.readOwnedRows
    vi.spyOn(scopes, 'readOwnedRows').mockImplementationOnce((async (...args: Parameters<typeof read>) => {
      const result = await read(...args); await gate; return result
    }) as typeof read)
    const oldLoad = useCharacterStore.getState().loadAll(scope)
    await vi.waitFor(() => expect(scopes.readOwnedRows).toHaveBeenCalled())
    await useCharacterStore.getState().loadAll(next.scope)
    release(); await oldLoad
    expect(useCharacterStore.getState()).toMatchObject({ loadedScope: next.scope, characters: [], loading: false })
  })
})
