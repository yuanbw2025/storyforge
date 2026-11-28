import Dexie from 'dexie'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCharacterRelationStore as store } from '../../src/stores/character-relation'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import * as scopeReads from '../../src/lib/workspace/scope'
import { readRecordTextWitnessesV1 } from '../../src/lib/authoring/record-text-save-evidence'
import { matchingLocalSaveAckV1, type LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import { coordinatePendingEditV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
const raw = '  # 原关系的新描述\r\n\r\n海😀 e\u0301　尾空白。  '
beforeEach(async () => { await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1(); store.setState({ relations: [], loadedScope: null, loading: false }) })
afterEach(() => { vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1(); db.close() })
async function fixture() {
  const { scope } = await seedCurrentWorkspace('050 原生角色关系')
  const characters: number[] = []
  for (const name of ['原角色甲', '原角色乙', '原角色丙']) characters.push(await db.characters.add(stampNewRecord(scope, 'characters', { projectId: scope.projectId, name, roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral', relationships: '手写人物关系不改。', createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as never) as number)
  await store.getState().loadAll(scope)
  await store.getState().addRelation({ projectId: scope.projectId, fromCharacterId: characters[0], toCharacterId: characters[1], relationType: 'friend', label: '原标签', description: '原描述', isBidirectional: true }, scope)
  const id = store.getState().relations[0].id!, before = (await db.characterRelations.get(id))!
  const intent = async (session = crypto.randomUUID()): Promise<LocalSaveIntentV1> => ({ kind: 'natural-field-local-save-v1', expected: (await readRecordTextWitnessesV1('characterRelations', id, scope)).description, generation: 1, session })
  const save = (confirmation: LocalSaveIntentV1) => store.getState().updateRelation(id, { description: raw }, { scope, confirmation, expected: before })
  return { scope, id, before, characters, intent, save }
}
it('confirms exact original World/UID text and reopens without changing endpoints, label or either character card', async () => {
  const f = await fixture(), intent = await f.intent(), ack = await f.save(intent)
  expect(matchingLocalSaveAckV1(ack, intent, raw)).toBe(true)
  db.close(); await db.open()
  const actual = await db.characterRelations.get(f.id)
  expect(actual).toMatchObject({ ...f.before, description: raw, updatedAt: expect.any(Number) })
  expect(actual?.updatedAt).toBeGreaterThan(f.before.updatedAt)
  expect((await db.characters.get(f.characters[0]))?.relationships).toBe('手写人物关系不改。')
  expect((await db.characters.get(f.characters[1]))?.relationships).toBe('手写人物关系不改。')
})
it('rolls back quota, zero-row and wrong native poststate without publishing success; explicit retry keeps the same row', async () => {
  const f = await fixture(), intent = await f.intent()
  const quota = () => { throw new DOMException('relation native quota', 'QuotaExceededError') }; db.characterRelations.hook('updating', quota)
  try { await expect(f.save(intent)).rejects.toThrow('relation native quota') } finally { db.characterRelations.hook('updating').unsubscribe(quota) }
  const zero = vi.spyOn(db.characterRelations, 'update').mockResolvedValueOnce(0); await expect(f.save(intent)).rejects.toThrow('0行'); zero.mockRestore()
  const wrong = () => ({ description: 'wrong native description' }); db.characterRelations.hook('updating', wrong)
  try { await expect(f.save(intent)).rejects.toThrow('相同身份与输入原文') } finally { db.characterRelations.hook('updating').unsubscribe(wrong) }
  expect(await db.characterRelations.get(f.id)).toEqual(f.before)
  expect(matchingLocalSaveAckV1(await f.save(intent), intent, raw)).toBe(true); expect(await db.characterRelations.count()).toBe(1)
})
it('rejects stale description, changed endpoint, foreign World, forged UID, deleted record and identity patches', async () => {
  const f = await fixture(), original = await f.intent(), other = await seedCurrentWorkspace('另一世界')
  await expect(store.getState().updateRelation(f.id, { description: raw }, { scope: other.scope, confirmation: original })).rejects.toThrow()
  await expect(f.save({ ...original, expected: { ...original.expected, resourceUid: 'forged' } })).rejects.toThrow('已被修改')
  await expect(store.getState().updateRelation(f.id, { projectId: other.scope.projectId }, { scope: f.scope })).rejects.toThrow('身份、归属')
  await db.characterRelations.update(f.id, { toCharacterId: f.characters[2] }); await expect(f.save(original)).rejects.toThrow('端点已被其他页面修改')
  await db.characterRelations.put(f.before); await db.characterRelations.update(f.id, { description: '别页新稿' }); await expect(f.save(original)).rejects.toThrow('已被修改')
  await db.characterRelations.delete(f.id); await expect(f.save(original)).rejects.toThrow('已删除')
})
it('freezes queued caller, scope and preimage and never publishes into a newly loaded foreign World', async () => {
  const f = await fixture(), confirmation = await f.intent(), other = await seedCurrentWorkspace('另一个作用域')
  let ready!: () => void, release!: () => void; const reached = new Promise<void>(resolve => { ready = resolve })
  const held = coordinatePendingEditV1({ key: `character-relation:${f.id}`, persist: () => new Promise<void>(resolve => { release = resolve; ready() }) }); await reached
  const scope = { ...f.scope }, data = { description: raw }
  const saving = store.getState().updateRelation(f.id, data, { scope, confirmation, expected: f.before })
  data.description = 'caller changed'; scope.worldId = other.scope.worldId; confirmation.expected.value = 'forged late'
  await store.getState().loadAll(other.scope); release(); await held; await saving
  expect((await db.characterRelations.get(f.id))?.description).toBe(raw); expect(store.getState().relations).toEqual([])
})
it('rereads a delayed old snapshot and preserves other-field edits instead of replaying an optimistic patch', async () => {
  const f = await fixture(), confirmation = await f.intent(), read = scopeReads.readOwnedRows
  let first = true, ready!: () => void, release!: () => void; const reached = new Promise<void>(resolve => { ready = resolve })
  vi.spyOn(scopeReads, 'readOwnedRows').mockImplementation(async<T>(...args: Parameters<typeof read>) => { const rows = await read<T>(...args); if (first && args[1] === 'characterRelations') { first = false; await new Promise<void>(resolve => { release = resolve; ready() }) } return rows })
  const loading = store.getState().loadAll(f.scope); await reached
  await db.characterRelations.update(f.id, { label: '另字段最新标签' }); await f.save(confirmation); release(); await loading
  expect(store.getState().relations[0]).toMatchObject({ label: '另字段最新标签', description: raw })
})
it('explicitly recovers a known committed readback failure but still rejects a later external edit', async () => {
  const f = await fixture(), intent = await f.intent(), original = db.characterRelations.get.bind(db.characterRelations)
  const fault = vi.spyOn(db.characterRelations, 'get').mockImplementation(key => {
    const lookup: unknown = key
    return !Dexie.currentTransaction && typeof lookup === 'number' && lookup === f.id ? Dexie.Promise.reject(new Error('native relation readback failure')) : original(key)
  })
  await expect(f.save(intent)).rejects.toThrow('readback failure'); fault.mockRestore()
  expect((await db.characterRelations.get(f.id))?.description).toBe(raw)
  expect(matchingLocalSaveAckV1(await f.save({ ...intent, generation: 2 }), { ...intent, generation: 2 }, raw)).toBe(true)
  const next = await f.intent(), second = vi.spyOn(db.characterRelations, 'get').mockImplementation(key => {
    const lookup: unknown = key
    return !Dexie.currentTransaction && typeof lookup === 'number' && lookup === f.id ? Dexie.Promise.reject(new Error('native readback again')) : original(key)
  })
  await expect(store.getState().updateRelation(f.id, { description: '已提交新稿' }, { scope: f.scope, confirmation: next, expected: f.before })).rejects.toThrow('readback again'); second.mockRestore()
  await db.characterRelations.update(f.id, { description: '外部冲突不能覆盖' })
  await expect(store.getState().updateRelation(f.id, { description: '已提交新稿' }, { scope: f.scope, confirmation: { ...next, generation: 2 }, expected: f.before })).rejects.toThrow('已被修改')
})
