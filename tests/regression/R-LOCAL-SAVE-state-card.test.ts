import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useStateCardStore as store } from '../../src/stores/state-card'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import * as scopes from '../../src/lib/workspace/scope'
import { stringifyFields } from '../../src/lib/types/state-card'
const fields = stringifyFields([{ key: '状态', value: '  中文 e\u0301 😀\n尾空白。  ' }])
beforeEach(async () => { await db.delete(); await db.open(); store.setState({ cards: [], loadedScope: null, loading: false }) })
afterEach(() => { vi.restoreAllMocks(); db.close() })
async function fixture() {
  const { scope } = await seedCurrentWorkspace('状态保存确认'); await store.getState().loadAll(scope)
  const id = await store.getState().addCard({ projectId: scope.projectId, category: 'character', entityName: '甲', fields: '[]' }, { scope })
  return { scope, id }
}
it('confirms exact manual fields through original adoption and native Work identity after reopening', async () => {
  const { scope, id } = await fixture(), before = await db.stateCards.get(id)
  await store.getState().updateCard(id, { fields }, { scope, expectedFields: '[]' })
  expect(store.getState().cards[0].fields).toBe(fields)
  db.close(); await db.open()
  expect(await db.stateCards.get(id)).toMatchObject({ fields, workId: scope.workId, ragDocumentId: Reflect.get(before!, 'ragDocumentId') })
})
it('does not acknowledge corrupt poststate or a zero-row write and leaves a failed quota draft basis usable', async () => {
  const { scope, id } = await fixture()
  const fault = vi.spyOn(db.stateCards, 'update').mockRejectedValueOnce(new Error('state quota'))
  await expect(store.getState().updateCard(id, { fields }, { scope, expectedFields: '[]' })).rejects.toThrow('state quota'); fault.mockRestore()
  expect((await db.stateCards.get(id))?.fields).toBe('[]')
  const zero = vi.spyOn(db.stateCards, 'update').mockResolvedValueOnce(0)
  await expect(store.getState().updateCard(id, { fields }, { scope, expectedFields: '[]' })).rejects.toThrow('精确保存'); zero.mockRestore()
  const corrupt = () => ({ fields: '[{"key":"状态","value":"peer replacement"}]' }); db.stateCards.hook('updating', corrupt)
  try { await expect(store.getState().updateCard(id, { fields }, { scope, expectedFields: '[]' })).rejects.toThrow('精确保存') }
  finally { db.stateCards.hook('updating').unsubscribe(corrupt) }
  expect(store.getState().cards[0].fields).toBe('[]')
  const actual = (await db.stateCards.get(id))!.fields
  await store.getState().updateCard(id, { fields }, { scope, expectedFields: actual })
  expect(store.getState().cards[0].fields).toBe(fields)
})
it('freezes caller input before reads and prevents a late original Work read from replacing a confirmed write', async () => {
  const { scope, id } = await fixture(), other = (await seedCurrentWorkspace('别的Work')).scope
  const mutable = { ...scope }, patch = { fields }
  const saving = store.getState().updateCard(id, patch, { scope: mutable, expectedFields: '[]' })
  Object.assign(mutable, other); patch.fields = '[]'; await saving
  expect((await db.stateCards.get(id))?.fields).toBe(fields)
  const original = scopes.readOwnedRows
  let held = false, ready!: () => void, release!: () => void
  const entered = new Promise<void>(resolve => { ready = resolve })
  vi.spyOn(scopes, 'readOwnedRows').mockImplementation(async <T>(...args: Parameters<typeof original>) => {
    const rows = await original<T>(...args)
    if (args[1] === 'stateCards' && !held) { held = true; await new Promise<void>(resolve => { release = resolve; ready() }) }
    return rows
  })
  const loading = store.getState().loadAll(scope); await entered
  await store.getState().updateCard(id, { fields: '[]' }, { scope, expectedFields: fields })
  release(); await loading
  expect(store.getState().cards[0].fields).toBe('[]')
})
