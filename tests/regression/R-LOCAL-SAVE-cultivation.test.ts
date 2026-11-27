import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCultivationStore as store } from '../../src/stores/cultivation'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { readRecordTextWitnessesV1, recordTextWitnessKeyV1 } from '../../src/lib/authoring/record-text-save-evidence'
import type { LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import { coordinatePendingEditV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import * as scopes from '../../src/lib/workspace/scope'
import { decodePowerStagesStrictV1 } from '../../src/lib/cultivation/power-authoring-contract'
const raw = '  # 作者境界\r\n\r\n🌋 e\u0301 原文尾。  '
const stages = JSON.stringify([
 { id: 'root', name: '起境', parentStageIds: [], features: '原能力', breakthrough: '原代价', custom: { source: '作者附注', number: 125 } },
 { id: 'left', name: '左路', parentStageIds: ['root'] }, { id: 'right', name: '右路', parentStageIds: ['root'] },
 { id: 'merge', name: '合流', parentStageIds: ['left','right'], custom: ['原属性'] },
])
beforeEach(async () => { await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1(); store.setState({ systems: [], loadedScope: null, loading: false, loadError: null }) })
afterEach(() => { vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1(); db.close() })
async function fixture() {
 const { scope } = await seedCurrentWorkspace('修炼保存'); await store.getState().loadAll(scope)
 const id = await store.getState().addSystem({ projectId: scope.projectId, name: '原路径', description: '原原理', stages }, scope)
 return { scope, id }
}
async function proof(f: Awaited<ReturnType<typeof fixture>>, field: string, entryId?: string): Promise<LocalSaveIntentV1> {
 const expected = (await readRecordTextWitnessesV1('cultivationSystems', f.id, f.scope))[recordTextWitnessKeyV1(field, entryId)]
 expect(expected).toBeDefined()
 return { kind: 'natural-field-local-save-v1', expected, session: 'cultivation-author', generation: 1 }
}
it('confirms exact path and stable-stage text while preserving World UID, unknown attributes and branching/merging DAG on reopen', async () => {
 const f = await fixture(), before = await db.cultivationSystems.get(f.id)
 for (const field of ['name','description']) {
  const ack = await store.getState().updateSystem(f.id, { [field]: raw }, { scope: f.scope, confirmation: await proof(f, field) })
  expect(ack).toMatchObject({ witness: { value: raw, source: 'committed-write', identity: { worldId: f.scope.worldId } } })
 }
 for (const field of ['name','features','breakthrough','branchLabel'] as const) {
  const ack = await store.getState().updateSystem(f.id, {}, { scope: f.scope, stageEdit: { stageId: 'root', patch: { [field]: raw } }, confirmation: await proof(f, `stages.${field}`, 'root') })
  expect(ack).toMatchObject({ witness: { value: raw, identity: { entryId: 'root', field: `stages.${field}` } } })
 }
 db.close(); await db.open()
 const saved = (await db.cultivationSystems.get(f.id))!
 expect(saved).toMatchObject({ name: raw, description: raw, worldId: f.scope.worldId, ragDocumentId: Reflect.get(before!, 'ragDocumentId') })
 const graph = JSON.parse(saved.stages)
 expect(graph[0]).toMatchObject({ id: 'root', name: raw, features: raw, breakthrough: raw, branchLabel: raw, custom: { source: '作者附注', number: 125 } })
 expect(graph.slice(1)).toEqual(JSON.parse(stages).slice(1)); expect(await db.cultivationSystems.count()).toBe(1)
})
it('retains the draft preimage after quota/zero-row/corrupt poststate faults and retries without duplicating the system', async () => {
 const f = await fixture(), confirmation = await proof(f, 'stages.features','root')
 const change = () => store.getState().updateSystem(f.id, {}, { scope: f.scope, stageEdit: { stageId: 'root', patch: { features: raw } }, confirmation })
 const fault = vi.spyOn(db.cultivationSystems, 'update').mockRejectedValueOnce(new Error('cultivation quota'))
 await expect(change()).rejects.toThrow('cultivation quota'); fault.mockRestore()
 const zero = vi.spyOn(db.cultivationSystems, 'update').mockResolvedValueOnce(0)
 await expect(change()).rejects.toThrow('0行'); zero.mockRestore()
 const corrupt = () => ({ stages: '[]' }); db.cultivationSystems.hook('updating', corrupt)
 try { await expect(change()).rejects.toThrow('精确保存') }
 finally { db.cultivationSystems.hook('updating').unsubscribe(corrupt) }
 expect((await db.cultivationSystems.get(f.id))?.stages).toBe(stages)
 await change(); expect(JSON.parse((await db.cultivationSystems.get(f.id))!.stages)[0].features).toBe(raw)
 expect(await db.cultivationSystems.count()).toBe(1)
})
it('merges a leaf into fresh native sibling changes/reorder but refuses same-leaf staleness or a deleted/foreign/forged target', async () => {
 const f = await fixture(), confirmation = await proof(f, 'stages.features','root')
 const peer = JSON.parse(stages); peer[0].breakthrough = '别处更新的代价'; peer.reverse()
 await db.cultivationSystems.update(f.id, { stages: JSON.stringify(peer) })
 const options = { scope: f.scope, stageEdit: { stageId: 'root', patch: { features: raw } }, confirmation }
 await store.getState().updateSystem(f.id, {}, options)
 const graph = JSON.parse((await db.cultivationSystems.get(f.id))!.stages)
 expect(graph.map((s: { id: string }) => s.id)).toEqual(peer.map((s: { id: string }) => s.id))
 expect(graph.find((s: { id: string }) => s.id === 'root')).toMatchObject({ features: raw, breakthrough: '别处更新的代价', custom: { number: 125 } })
 await expect(store.getState().updateSystem(f.id, {}, options)).rejects.toThrow('已被修改')
 const other = (await seedCurrentWorkspace('别的World')).scope
 await expect(store.getState().updateSystem(f.id, { description: raw }, { scope: other })).rejects.toThrow('原 World')
 const forged = await proof(f,'description'); forged.expected.valueHash = 'forged'
 await expect(store.getState().updateSystem(f.id, { description: raw }, { scope: f.scope, confirmation: forged })).rejects.toThrow('已被修改')
 await db.cultivationSystems.delete(f.id)
 await expect(store.getState().updateSystem(f.id, { description: raw }, { scope: f.scope })).rejects.toThrow('已删除')
})
it('never washes malformed/unknown or lossy-number stage JSON into an empty graph and rejects invalid DAG updates', async () => {
 const f = await fixture()
 for (const damaged of ['{broken', '[null]', '[{"id":"root","name":"起境","parentStageIds":[],"authorNumber":9007199254740993}]']) {
  await db.cultivationSystems.update(f.id, { stages: damaged })
  await expect(store.getState().updateSystem(f.id, {}, { scope: f.scope, stageEdit: { stageId: 'root', patch: { features: raw } } })).rejects.toThrow()
  expect((await db.cultivationSystems.get(f.id))?.stages).toBe(damaged)
  await store.getState().updateSystem(f.id, { description: raw }, { scope: f.scope })
  expect((await db.cultivationSystems.get(f.id))?.stages).toBe(damaged)
 }
 await db.cultivationSystems.update(f.id, { stages })
 await expect(store.getState().updateSystem(f.id, {}, { scope: f.scope, stageEdit: { stageId: 'root', patch: { parentStageIds: ['merge'] } } })).rejects.toThrow('有向环')
 await expect(store.getState().updateSystem(f.id, { stages: '[]' }, { scope: f.scope, expectedStages: 'stale' })).rejects.toThrow('图谱已被')
 expect((await db.cultivationSystems.get(f.id))?.stages).toBe(stages)
})
it('freezes queued inputs and scopes and leaves a newly selected World cache untouched', async () => {
 const f = await fixture(), confirmation = await proof(f,'description'), other = (await seedCurrentWorkspace('另一原稿')).scope
 let release!: () => void, ready!: () => void
 const entered = new Promise<void>(resolve => { ready = resolve })
 const held = coordinatePendingEditV1({ key: `cultivation-system:${f.id}`, persist: () => new Promise<void>(resolve => { release = resolve; ready() }) })
 await entered
 const scope = { ...f.scope }, patch = { description: raw }
 const saving = store.getState().updateSystem(f.id, patch, { scope, confirmation })
 patch.description = '后来输入'; Object.assign(scope, other); confirmation.expected.valueHash = 'later'
 await store.getState().loadAll(other); release(); await held; await saving
 expect(store.getState().loadedScope).toEqual(other); expect(store.getState().systems).toEqual([])
 expect((await db.cultivationSystems.get(f.id))?.description).toBe(raw)
})
it('fences delayed native reads and exposes read failure without replacing author records with an empty list', async () => {
 const f = await fixture(), confirmation = await proof(f,'description'), original = scopes.readOwnedRows
 let held = false, release!: () => void, ready!: () => void
 const entered = new Promise<void>(resolve => { ready = resolve })
 const spy = vi.spyOn(scopes,'readOwnedRows').mockImplementation(async <T>(...args: Parameters<typeof original>) => {
  const rows = await original<T>(...args)
  if (args[1] === 'cultivationSystems' && !held) { held = true; await new Promise<void>(resolve => { release = resolve; ready() }) }
  return rows
 })
 const loading = store.getState().loadAll(f.scope); await entered
 await store.getState().updateSystem(f.id, { description: raw }, { scope: f.scope, confirmation })
 release(); await loading; expect(store.getState().systems[0].description).toBe(raw); spy.mockRestore()
 const failure = vi.spyOn(scopes,'readOwnedRows').mockRejectedValueOnce(new Error('cultivation read failure'))
 await expect(store.getState().loadAll(f.scope)).rejects.toThrow('cultivation read failure')
 expect(store.getState()).toMatchObject({ loading: false, loadError: 'cultivation read failure', systems: [{ id: f.id, description: raw }] })
 failure.mockRestore(); await store.getState().loadAll(f.scope); expect(store.getState().loadError).toBeNull()
})
it('stage removals retain their original reference cleanup and roll back the graph and references together on native failure', async () => {
 const f = await fixture()
 const char = await db.characters.add(scopes.stampNewRecord(f.scope, 'characters', { projectId: f.scope.projectId, name: '有引用角色', cultivationSystemId: f.id, cultivationStageId: 'merge', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as never)
 const before = await db.characters.get(char)
 const progress = await db.cultivationProgress.add(scopes.stampNewRecord(f.scope, 'cultivationProgress', { projectId: f.scope.projectId, characterId: char, characterName: '有引用角色', cultivationSystemId: f.id, cultivationSystemName: '原路径', stageId: 'merge', stageName: '合流', transition: 'enter', sourceChapterTitle: '原章证据', sourceQuote: '原文证据保留', sourceOffset: 0, trigger: '进入合流', status: 'confirmed', createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as never)
 const progressBefore = await db.cultivationProgress.get(progress)
 const next = JSON.stringify(decodePowerStagesStrictV1(stages).filter(stage => stage.id !== 'merge'))
 const failure = vi.spyOn(db.characters,'update').mockRejectedValueOnce(new Error('reference quota'))
 await expect(store.getState().updateSystem(f.id, { stages: next }, { scope: f.scope, expectedStages: stages })).rejects.toThrow('reference quota'); failure.mockRestore()
 expect((await db.cultivationSystems.get(f.id))?.stages).toBe(stages); expect(await db.characters.get(char)).toEqual(before); expect(await db.cultivationProgress.get(progress)).toEqual(progressBefore)
 await store.getState().updateSystem(f.id, { stages: next }, { scope: f.scope, expectedStages: stages })
 expect(await db.characters.get(char)).toMatchObject({ cultivationSystemId: f.id, cultivationStageId: null })
 expect(await db.cultivationProgress.get(progress)).toMatchObject({ stageId: null, status: 'source-missing', sourceQuote: '原文证据保留' })
})
