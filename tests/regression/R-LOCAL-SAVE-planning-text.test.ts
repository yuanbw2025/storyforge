import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useOutlineStore } from '../../src/stores/outline'
import { useDetailedOutlineStore } from '../../src/stores/detailed-outline'
import { useStoryArcStore } from '../../src/stores/story-arc'
import { readRecordTextWitnessesV1, recordTextWitnessKeyV1 } from '../../src/lib/authoring/record-text-save-evidence'
import type { LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import * as scopeModule from '../../src/lib/workspace/scope'

type Kind = 'scene' | 'arc' | 'stage'
const kinds = ['scene', 'arc', 'stage'] as const
const raw = '  # 作者原文\r\n\r\n🌊 完整文字。　 '
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  useDetailedOutlineStore.setState({ detailedOutlines: [], loadedScope: null, loading: false })
  useStoryArcStore.setState({ arcs: [], loadedScope: null, loading: false, activeArcId: null })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model calls') }))
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
async function fixture(kind: Kind) {
  const { scope } = await seedCurrentWorkspace('规划文字保存')
  const table = kind === 'scene' ? 'detailedOutlines' as const : 'storyArcs' as const
  const field = kind === 'scene' ? 'scenes.summary' : kind === 'stage' ? 'stages.description' : 'description'
  const entryId = kind === 'arc' ? undefined : 'stable-one'
  let id: number
  if (kind === 'scene') {
    const node = await useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: null, type: 'chapter', title: '章纲', summary: '摘要', order: 0 }, scope)
    id = (await useDetailedOutlineStore.getState().getOrCreate(scope, node)).id!
    for (const sceneId of ['stable-one', 'stable-two']) await useDetailedOutlineStore.getState().editScene(id, { kind: 'add', scene: { sceneId, title: sceneId, summary: '原文', characterIds: [], location: '', conflict: '', pace: 'medium', estimatedWords: 0, notes: '' } }, scope, '摘要')
  } else id = await useStoryArcStore.getState().addArc({ projectId: scope.projectId, name: '原故事线', description: '原文', type: 'main', stages: JSON.stringify(['stable-one', 'stable-two'].map(stageId => ({ id: stageId, title: stageId, description: '原文', keyEvents: ['保留事件'] }))) }, scope)
  const read = () => db.table(table).get(id)
  const text = (row: Awaited<ReturnType<typeof read>>) => kind === 'arc' ? row.description : kind === 'scene'
    ? row.scenes.find((scene: { sceneId: string }) => scene.sceneId === entryId)?.summary
    : JSON.parse(row.stages).find((stage: { id: string }) => stage.id === entryId)?.description
  const intent = async (): Promise<LocalSaveIntentV1> => ({ kind: 'natural-field-local-save-v1', session: 'planning-author', generation: 1,
    expected: (await readRecordTextWitnessesV1(table, id, scope))[recordTextWitnessKeyV1(field, entryId)] })
  const save = async (value = raw, proof?: LocalSaveIntentV1) => {
    const confirmation = proof ?? await intent()
    return kind === 'scene' ? useDetailedOutlineStore.getState().editScene(id, { kind: 'patch', sceneId: entryId!, patch: { summary: value } }, scope, '摘要', confirmation)
      : kind === 'stage' ? useStoryArcStore.getState().editStage(id, { kind: 'patch', stageId: entryId!, patch: { description: value } }, scope, confirmation)
        : useStoryArcStore.getState().updateArc(id, { description: value }, scope, undefined, confirmation)
  }
  const load = () => kind === 'scene' ? useDetailedOutlineStore.getState().loadAll(scope) : useStoryArcStore.getState().loadAll(scope)
  return { scope, table, field, id, entryId, read, text, intent, save, load }
}
it.each(kinds)('%s confirms exact persisted text and owner after reopen through its original writer', async kind => {
  const f = await fixture(kind), before = await f.read(), ack = await f.save()
  expect(ack.witness).toMatchObject({ value: raw, resourceUid: before.ragDocumentId, identity: { ...f.scope, table: f.table, field: f.field, recordId: f.id } })
  db.close(); await db.open(); const row = await f.read()
  expect(f.text(row)).toBe(raw); expect(row.ragDocumentId).toBe(before.ragDocumentId); expect(row.workId).toBe(f.scope.workId)
})
it.each(kinds)('%s rolls back quota and corrupt poststate, then explicitly retries the original preimage', async kind => {
  const f = await fixture(kind), proof = await f.intent(), table = db.table(f.table)
  const fault = () => { throw new DOMException('planning quota failure', 'QuotaExceededError') }
  table.hook('updating', fault)
  try { await expect(f.save(raw, proof)).rejects.toThrow('planning quota failure') } finally { table.hook('updating').unsubscribe(fault) }
  const before = await f.read()
  const corrupt = () => kind === 'arc' ? { description: 'wrong' } : kind === 'scene'
    ? { scenes: before.scenes.map((scene: { sceneId: string }) => scene.sceneId === f.entryId ? { ...scene, summary: 'wrong' } : scene) }
    : { stages: JSON.stringify(JSON.parse(before.stages).map((stage: { id: string }) => stage.id === f.entryId ? { ...stage, description: 'wrong' } : stage)) }
  table.hook('updating', corrupt)
  try { await expect(f.save(raw, proof)).rejects.toThrow('未读到相同身份与原文') } finally { table.hook('updating').unsubscribe(corrupt) }
  expect(f.text(await f.read())).toBe('原文'); expect((await f.save(raw, proof)).witness.value).toBe(raw)
})
it.each(kinds)('%s rejects stale, forged, wrong-entry, zero-row and deleted targets without success', async kind => {
  const f = await fixture(kind), proof = await f.intent()
  const forged = structuredClone(proof); forged.expected.valueHash = 'forged'
  await expect(f.save(raw, forged)).rejects.toThrow('字段已被修改')
  if (kind !== 'arc') {
    const wrong = structuredClone(proof); if ('entryId' in wrong.expected.identity) wrong.expected.identity.entryId = 'stable-two'
    await expect(f.save(raw, wrong)).rejects.toThrow('凭据与目标不符')
  }
  vi.spyOn(kind === 'scene' ? db.detailedOutlines : db.storyArcs, 'update').mockResolvedValueOnce(0)
  await expect(f.save(raw, proof)).rejects.toThrow(/0行|未写入/); vi.restoreAllMocks()
  await f.save(raw, proof); await expect(f.save('过期覆盖', proof)).rejects.toThrow('字段已被修改')
  const latest = await f.intent(); await db.table(f.table).delete(f.id)
  await expect(f.save('已删除', latest)).rejects.toThrow(/删除/)
})
it.each(['scene', 'stage'] as const)('%s follows stable identity across reorder while preserving sibling changes', async kind => {
  const f = await fixture(kind), proof = await f.intent(), row = await f.read()
  if (kind === 'scene') await db.detailedOutlines.update(f.id, { scenes: row.scenes.reverse().map((scene: { sceneId: string }) => scene.sceneId === 'stable-two' ? { ...scene, notes: '另一场景的新备注' } : scene) })
  else await db.storyArcs.update(f.id, { stages: JSON.stringify(JSON.parse(row.stages).reverse().map((stage: { id: string }) => stage.id === 'stable-two' ? { ...stage, turningPoint: '另一阶段的新转折' } : stage)) })
  await f.save(raw, proof); const saved = await f.read(); expect(f.text(saved)).toBe(raw)
  if (kind === 'scene') expect(saved.scenes[0].notes).toBe('另一场景的新备注')
  else expect(JSON.parse(saved.stages)[0].turningPoint).toBe('另一阶段的新转折')
})
it.each(['scene', 'stage'] as const)('%s rereads a precommit snapshot instead of republishing old text after save', async kind => {
  const f = await fixture(kind), proof = await f.intent(), original = scopeModule.readOwnedRows
  let release!: () => void, entered!: () => void, first = true
  const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
  vi.spyOn(scopeModule, 'readOwnedRows').mockImplementation(async (...args) => {
    const rows = await original(...args)
    if (first && args[1] === f.table) { first = false; entered(); await gate }
    return rows
  })
  const loading = f.load()
  try { await reached; await f.save(raw, proof) } finally { release() }
  await loading
  const rows = kind === 'scene' ? useDetailedOutlineStore.getState().detailedOutlines : useStoryArcStore.getState().arcs
  expect(f.text(rows.find(row => row.id === f.id))).toBe(raw)
})
it.each(['scene', 'stage'] as const)('%s confirms first creation and explicit empty clearing of an optional text leaf', async kind => {
  const f = await fixture(kind), leaf = kind === 'scene' ? 'goal' : 'turningPoint', field = `${kind === 'scene' ? 'scenes' : 'stages'}.${leaf}`
  const proof = async (): Promise<LocalSaveIntentV1> => ({ kind: 'natural-field-local-save-v1', session: 'optional-field', generation: 1,
    expected: (await readRecordTextWitnessesV1(f.table, f.id, f.scope))[recordTextWitnessKeyV1(field, f.entryId)] })
  const save = async (value: string) => kind === 'scene'
    ? useDetailedOutlineStore.getState().editScene(f.id, { kind: 'patch', sceneId: f.entryId!, patch: { goal: value } }, f.scope, '', await proof())
    : useStoryArcStore.getState().editStage(f.id, { kind: 'patch', stageId: f.entryId!, patch: { turningPoint: value } }, f.scope, await proof())
  expect((await proof()).expected.present).toBe(false)
  expect((await save(raw)).witness.value).toBe(raw)
  expect((await save('')).witness).toMatchObject({ value: '', present: true })
})
