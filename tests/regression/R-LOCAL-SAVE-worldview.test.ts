import Dexie from 'dexie'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt, hashAdoptFieldValueV1 } from '../../src/lib/registry/adopt'
import { useWorldviewStore } from '../../src/stores/worldview'
import { coordinatePendingEditV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { LOCAL_SAVE_NATURAL_FIELDS_V1, LOCAL_SAVE_WORLDVIEW_TEXT_FIELDS_V1, LOCAL_SAVE_WORLDVIEW_LEAF_FIELDS_V1, type LocalSaveIntentV1, type LocalSaveWorldviewFieldV1 } from '../../src/lib/authoring/local-save-evidence'
import { fingerprintSettingSource } from '../../src/lib/fact-ledger/setting-assertions'
import { CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
const raw = '  # 潮汐\r\n\r\n```text\r\n  |--🌊  \r\n```\r\n  '
beforeEach(async () => { await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network') })) })
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); db.close() })
async function fixture() { const { scope } = await seedCurrentWorkspace('050 isolated'); await useWorldviewStore.getState().loadAll(scope); return scope }
function intent(field: LocalSaveWorldviewFieldV1 = 'worldStructure'): LocalSaveIntentV1 { return { kind: 'natural-field-local-save-v1', session: 'edit-1', generation: 1, expected: structuredClone(useWorldviewStore.getState().localSaveWitnesses[field]!) } }
async function row() { return (await db.worldviews.toArray())[0] }
it('confirms N5 exact raw text only after root commit, preserves UID/owner and survives close/reopen', async () => {
  const scope = await fixture(); expect(await db.worldviews.count()).toBe(0)
  let commits = 0; const complete = () => { commits++ }; Dexie.on.storagemutated.subscribe(complete)
  try {
    for (const field of LOCAL_SAVE_NATURAL_FIELDS_V1) {
      // Prior field first-create changes the absence identity of the other fields.
      await useWorldviewStore.getState().loadAll(scope)
      const ack = await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, [field]: raw }, scope, intent(field))
      expect(commits).toBeGreaterThan(0)
      expect(ack.witness).toMatchObject({ source: 'committed-write', present: true, value: raw, valueHash: await hashAdoptFieldValueV1(raw) })
      expect(ack.witness.recordId).toBe((await row()).id)
    }
  } finally { Dexie.on.storagemutated.unsubscribe(complete) }
  const uid = (await row()).ragDocumentId; db.close(); await db.open()
  expect(await db.worldviews.count()).toBe(1)
  expect(await row()).toMatchObject({ worldId: scope.worldId, ragDocumentId: uid, worldOrigin: '' })
  for (const field of LOCAL_SAVE_NATURAL_FIELDS_V1) expect((await row())[field]).toBe(raw)
})
it('keeps empty first-field absence unconfirmed, accepts whitespace creation and exact clear on an existing row', async () => {
  const scope = await fixture(); const save = (text: string) => useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: text }, scope, intent())
  await expect(save('')).rejects.toThrow('尚未填写'); expect(await db.worldviews.count()).toBe(0)
  const ack = await save(' \r\n '); expect(ack.witness.value).toBe(' \r\n ')
  await useWorldviewStore.getState().loadAll(scope); expect((await save('')).witness.value).toBe('')
})
it('rejects same-field stale, deleted/recreated identity and fabricated hash, while accepting another-field update', async () => {
  const scope = await fixture(); await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: 'old' }, scope)
  await useWorldviewStore.getState().loadAll(scope); const expected = intent(); const id = (await row()).id!
  await adopt({ projectId: scope.projectId, scope, target: 'worldviews', mode: 'replace', recordId: id, preserveAuthorText: true, data: { mountainsRivers: 'new river' } })
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: raw }, scope, expected)
  expect((await row()).mountainsRivers).toBe('new river')
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: 'overwrite' }, scope, expected)).rejects.toThrow('已被修改')
  await useWorldviewStore.getState().loadAll(scope); const forged = intent(); forged.expected.valueHash = 'fake'
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: 'overwrite' }, scope, forged)).rejects.toThrow('预像')
  const recreated = intent(); await db.worldviews.delete(id)
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: raw }, scope)
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: 'overwrite' }, scope, recreated)).rejects.toThrow('已被修改')
})
it('rejects uncommitted outer transactions, scope/field mismatch, and a concurrently created record', async () => {
  const scope = await fixture(); const expected = intent()
  await expect(db.transaction('rw', db.worldviews, () => useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: raw }, scope, expected))).rejects.toThrow('独立提交')
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldDimensions: raw }, scope, expected)).rejects.toThrow('凭据无效')
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: raw }, { ...scope, workId: scope.workId + 1 }, expected)).rejects.toThrow('凭据无效')
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: 'other tab' }, scope)
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: raw }, scope, expected)).rejects.toThrow('已被修改')
  expect((await row()).worldStructure).toBe('other tab')
})
it('rolls back first creation if exact second update or post-write check fails; no state or evidence is published', async () => {
  const scope = await fixture(); const fault = () => { throw new DOMException('simulated quota', 'QuotaExceededError') }
  db.worldviews.hook('updating', fault)
  try { await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: raw }, scope, intent())).rejects.toThrow('simulated quota') }
  finally { db.worldviews.hook('updating').unsubscribe(fault) }
  db.close(); await db.open(); expect(await db.worldviews.count()).toBe(0)
  expect(useWorldviewStore.getState().worldview).toBeNull()
  expect(useWorldviewStore.getState().localSaveWitnesses.worldStructure?.recordId).toBeNull()
  const corrupt = () => ({ worldStructure: 'synthetic wrong poststate' }); db.worldviews.hook('updating', corrupt)
  try { await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: raw }, scope, intent())).rejects.toThrow('精确保存') }
  finally { db.worldviews.hook('updating').unsubscribe(corrupt) }
  expect(await db.worldviews.count()).toBe(0)
})
it('keeps dependent fact invalidation and field write atomic, and exposes exact committed Canon originals after cache invalidation', async () => {
  const scope = await fixture(); await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: 'old' }, scope)
  await useWorldviewStore.getState().loadAll(scope); const id = (await row()).id!
  const factId = await db.temporalFacts.add({ projectId: scope.projectId, workId: scope.workId, subjectName: '海港', predicate: 'technologyLevel', factKind: 'state', value: 'old', sourceType: 'setting', sourceRecordTable: 'worldviews', sourceWorldviewId: id, sourceField: 'worldStructure', sourceFingerprint: fingerprintSettingSource('old'), status: 'confirmed', locked: false, createdAt: 1, updatedAt: 1 })
  const frozen = { ...scope, worldGroupId: null }; const before = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: frozen, kinds: ['worldview-field'], limit: 100 })
  const old = before.items.find(item => item.resourceKey.endsWith(':field:worldStructure'))!
  const fault = () => { throw new Error('dependent fact fault') }; db.temporalFacts.hook('updating', fault)
  const save = () => useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: raw }, scope, intent())
  try { await expect(save()).rejects.toThrow('dependent fact fault') } finally { db.temporalFacts.hook('updating').unsubscribe(fault) }
  expect((await row()).worldStructure).toBe('old'); expect((await db.temporalFacts.get(factId))?.status).toBe('confirmed')
  await save(); expect((await db.temporalFacts.get(factId))?.status).toBe('stale')
  const after = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: frozen, kinds: ['worldview-field'], limit: 100 })
  const current = after.items.find(item => item.resourceKey === old.resourceKey)!
  expect(current.contentHash).not.toBe(old.contentHash)
  expect((await CANON_RESOURCE_PROVIDER_V1.readOriginal({ scope: frozen, resourceKey: current.resourceKey, sourceRef: current.sourceRefs[0], maxTokens: 1000 })).content).toBe(raw)
})
it('fails closed for ambiguous rows and for a missing/cross-world group', async () => {
  const scope = await fixture(); await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: 'old' }, scope)
  await useWorldviewStore.getState().loadAll(scope); const original = await row()
  await db.worldviews.add({ ...original, id: undefined, ragDocumentId: original.ragDocumentId + '-duplicate' })
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: raw }, scope, intent())).rejects.toThrow('不唯一')
  const missing = intent(); missing.expected.identity.worldGroupId = 999
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldGroupId: 999, worldStructure: raw }, scope, missing)).rejects.toThrow('世界组')
})

it('distinguishes absent own-property, explicit undefined and null from fallback empty', async () => {
  const scope = await fixture()
  await adopt({ projectId: scope.projectId, scope, target: 'worldviews', mode: 'replace', data: { worldOrigin: 'fixture' } })
  await useWorldviewStore.getState().loadAll(scope)
  const missing = intent(); expect(missing.expected.present).toBe(false); expect(missing.expected.value).toBeUndefined()
  const original = await row(); await db.worldviews.put({ ...original, worldStructure: undefined })
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: raw }, scope, missing)).rejects.toThrow('已被修改')
  await useWorldviewStore.getState().loadAll(scope)
  expect(intent().expected.present).toBe(true); expect(intent().expected.value).toBeUndefined()
  await db.worldviews.put({ ...original, worldStructure: null } as unknown as typeof original)
  await useWorldviewStore.getState().loadAll(scope)
  expect(useWorldviewStore.getState().localSaveWitnesses.worldStructure).toBeUndefined()
  expect((await row()).worldStructure).toBeNull()
})
it('rejects a real group owned by another World and keeps a single-world primary-group record identity', async () => {
  const scope = await fixture(); const other = await seedCurrentWorkspace('other World')
  const foreign = await db.worldGroups.add(stampNewRecord(other.scope, 'worldGroups', { projectId: other.scope.projectId, name: 'foreign', type: 'primary', description: '', createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as never)
  const invalid = intent(); invalid.expected.identity.worldGroupId = foreign
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldGroupId: foreign, worldStructure: raw }, scope, invalid)).rejects.toThrow('世界组')
  const primary = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', { projectId: scope.projectId, name: 'primary', type: 'primary', description: '', createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as never)
  await adopt({ projectId: scope.projectId, scope, worldGroupId: primary, target: 'worldviews', mode: 'replace', data: { worldStructure: 'group origin' } })
  await useWorldviewStore.getState().loadAll(scope)
  expect(intent().expected.identity.worldGroupId).toBe(primary)
  const before = (await row()).id
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldGroupId: primary, worldStructure: raw }, scope, intent())
  expect(await db.worldviews.count()).toBe(1); expect((await row()).id).toBe(before); expect((await row()).worldStructure).toBe(raw)
})

it('captures caller scope before queueing and never publishes an old target into a newly selected workspace', async () => {
  const originalScope = await fixture(); const expected = intent(); const other = await seedCurrentWorkspace('new view')
  let release!: () => void
  const barrier = coordinatePendingEditV1({ key: `worldview:${originalScope.projectId}:default`, persist: () => new Promise<void>(resolve => { release = resolve }) })
  await Promise.resolve(); await Promise.resolve()
  const mutableScope = { ...originalScope }
  const save = useWorldviewStore.getState().saveWorldview({ projectId: originalScope.projectId, worldStructure: raw }, mutableScope, expected)
  await useWorldviewStore.getState().loadAll(other.scope)
  Object.assign(mutableScope, other.scope)
  release(); await barrier; const ack = await save
  expect(ack.witness.identity.projectId).toBe(originalScope.projectId)
  expect(useWorldviewStore.getState().loadedScope).toEqual(other.scope)
  expect(useWorldviewStore.getState().worldview).toBeNull()
  expect(await db.worldviews.get(ack.witness.recordId!)).toMatchObject({ worldId: originalScope.worldId })
})


it.each(LOCAL_SAVE_WORLDVIEW_TEXT_FIELDS_V1.filter(field => !(LOCAL_SAVE_NATURAL_FIELDS_V1 as readonly string[]).includes(field)))(
  'confirms %s only from actual committed exact source and retains it on DB reopen', async field => {
    const scope = await fixture(), expected = intent(field)
    const ack = await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, [field]: raw }, scope, expected)
    expect(ack.witness).toMatchObject({ source: 'committed-write', present: true, value: raw,
      valueHash: await hashAdoptFieldValueV1(raw), identity: { ...scope, field, table: 'worldviews', worldGroupId: null } })
    expect(ack.witness.recordId).toBe((await row()).id)
    await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, [field]: 'stale overwrite' }, scope, expected)).rejects.toThrow('已被修改')
    db.close(); await db.open(); await useWorldviewStore.getState().loadAll(scope)
    expect((await row())[field]).toBe(raw)
    expect(useWorldviewStore.getState().localSaveWitnesses[field]).toMatchObject({ source: 'database-read', value: raw,
      recordId: ack.witness.recordId, resourceUid: ack.witness.resourceUid })
  })

it('rolls back a new humanity receipt on quota error, rejects a false committed poststate and keeps object fields outside the whitelist', async () => {
  const scope = await fixture(), field = 'politicsOverview', before = intent(field)
  const fail = () => { throw new DOMException('new-field quota', 'QuotaExceededError') }
  db.worldviews.hook('updating', fail)
  try { await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, [field]: raw }, scope, before)).rejects.toThrow('new-field quota') }
  finally { db.worldviews.hook('updating').unsubscribe(fail) }
  expect(await db.worldviews.count()).toBe(0)
  expect(useWorldviewStore.getState().localSaveWitnesses[field]?.source).toBe('database-read')
  const corrupt = () => ({ politicsOverview: 'wrong source' }); db.worldviews.hook('updating', corrupt)
  try { await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, [field]: raw }, scope, before)).rejects.toThrow('精确保存') }
  finally { db.worldviews.hook('updating').unsubscribe(corrupt) }
  expect(await db.worldviews.count()).toBe(0)
  expect(LOCAL_SAVE_WORLDVIEW_TEXT_FIELDS_V1 as readonly string[]).not.toContain('divineDesign')
  expect(LOCAL_SAVE_WORLDVIEW_TEXT_FIELDS_V1 as readonly string[]).not.toContain('naturalResources')
})


function leafPatch(field: typeof LOCAL_SAVE_WORLDVIEW_LEAF_FIELDS_V1[number], value: string) {
  const [root, leaf] = field.split('.')
  return { [root]: { [leaf]: value } }
}
it.each(LOCAL_SAVE_WORLDVIEW_LEAF_FIELDS_V1)('confirms exact %s without changing sibling values or switches, and survives reopen', async field => {
  const scope = await fixture()
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldOrigin: 'root unchanged',
    divineDesign: { hasDivinity: true, divineRank: '阶序 ', divineNames: '原名\r\n', divineRules: '不可夜航' },
    naturalResources: { rareCreatures: '原兽', herbs: '旧草', minerals: '原矿 ', others: '原特产' } }, scope)
  await useWorldviewStore.getState().loadAll(scope)
  const before = await row(), [root, leaf] = field.split('.'), expected = intent(field)
  const ack = await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, ...leafPatch(field, raw) }, scope, expected)
  const after = await row(), beforeObject = before[root as 'divineDesign' | 'naturalResources']!
  expect(after[root as 'divineDesign' | 'naturalResources']).toEqual({ ...beforeObject, [leaf]: raw })
  expect(after.worldOrigin).toBe('root unchanged'); expect(after.id).toBe(before.id); expect(after.ragDocumentId).toBe(before.ragDocumentId)
  expect(ack.witness).toMatchObject({ present: true, source: 'committed-write', value: raw,
    identity: { ...scope, field, table: 'worldviews', worldGroupId: null }, valueHash: await hashAdoptFieldValueV1(raw) })
  db.close(); await db.open(); await useWorldviewStore.getState().loadAll(scope)
  expect(useWorldviewStore.getState().localSaveWitnesses[field]).toMatchObject({ source: 'database-read', value: raw, recordId: before.id, resourceUid: before.ragDocumentId })
})
it.each(['divineDesign.divineNames', 'naturalResources.herbs'] as const)('creates %s atomically, rejects an empty absence and rolls back a failed exact write', async field => {
  const scope = await fixture(), frozen = intent(field)
  const save = (value: string) => useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, ...leafPatch(field, value) }, scope, frozen)
  await expect(save('')).rejects.toThrow('尚未填写'); expect(await db.worldviews.count()).toBe(0)
  const fail = () => { throw new DOMException('leaf exact quota', 'QuotaExceededError') }; db.worldviews.hook('updating', fail)
  try { await expect(save(raw)).rejects.toThrow('leaf exact quota') } finally { db.worldviews.hook('updating').unsubscribe(fail) }
  expect(await db.worldviews.count()).toBe(0)
  expect(useWorldviewStore.getState().localSaveWitnesses[field]?.recordId).toBeNull()
  const ack = await save(raw)
  expect(await db.worldviews.count()).toBe(1); expect(ack.witness.value).toBe(raw)
})
it('merges concurrent edits of different leaves on the same native object, but rejects same-leaf stale and multi-leaf payloads', async () => {
  const scope = await fixture()
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId,
    divineDesign: { hasDivinity: true, divineNames: '旧名', divineRules: '旧禁忌', divineRank: '原阶' } }, scope)
  await useWorldviewStore.getState().loadAll(scope)
  const names = intent('divineDesign.divineNames'), rules = intent('divineDesign.divineRules')
  const first = useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, divineDesign: { divineNames: '新名  ' } }, scope, names)
  const second = useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, divineDesign: { divineRules: '新禁忌\r\n' } }, scope, rules)
  await Promise.all([first, second])
  expect((await row()).divineDesign).toEqual({ hasDivinity: true, divineNames: '新名  ', divineRules: '新禁忌\r\n', divineRank: '原阶' })
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, divineDesign: { divineNames: 'stale' } }, scope, names)).rejects.toThrow('已被修改')
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, divineDesign: { divineNames: 'stale', divineRules: 'extra' } }, scope, names)).rejects.toThrow('凭据无效')
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, naturalResources: { herbs: 'wrong-root' } }, scope, names)).rejects.toThrow('凭据无效')
})
it('does not confirm malformed object/leaf values or allow a forged switch receipt', async () => {
  const scope = await fixture()
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, divineDesign: { hasDivinity: true, divineNames: '旧名' } }, scope)
  await useWorldviewStore.getState().loadAll(scope); const expected = intent('divineDesign.divineNames'), before = await row()
  await db.worldviews.update(before.id!, { divineDesign: { ...before.divineDesign!, hasDivinity: 'invalid' } } as never)
  await useWorldviewStore.getState().loadAll(scope)
  expect(useWorldviewStore.getState().localSaveWitnesses['divineDesign.divineNames']).toBeUndefined()
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, divineDesign: { divineNames: 'new' } }, scope, expected)).rejects.toThrow('格式')
  const forged = { ...expected, expected: { ...expected.expected, identity: { ...expected.expected.identity, field: 'divineDesign.hasDivinity' } } } as unknown as LocalSaveIntentV1
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, divineDesign: { hasDivinity: false } }, scope, forged)).rejects.toThrow('凭据无效')
})

it.each([false, true])('ordinary worldview writes retain fresh scoped database witnesses for the next child edit (existing=%s)', async existing => {
  const scope = await fixture()
  if (existing) await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldOrigin: raw, divineDesign: { divineNames: '原名' } }, scope)
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, divineDesign: { hasDivinity: true } }, scope)
  const persisted = await row()
  expect(useWorldviewStore.getState().localSaveWitnesses['divineDesign.divineRank']).toMatchObject({
    source: 'database-read', recordId: persisted.id, resourceUid: persisted.ragDocumentId,
    identity: { ...scope, table: 'worldviews', field: 'divineDesign.divineRank', worldGroupId: null },
  })
  const expected = intent('divineDesign.divineRank')
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, divineDesign: { divineRank: raw } }, scope, expected)
  expect((await row()).divineDesign).toEqual({ ...persisted.divineDesign!, divineRank: raw })
  expect((await row()).worldOrigin).toBe(persisted.worldOrigin)
  await expect(useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, divineDesign: { divineRank: 'stale' } }, scope, expected)).rejects.toThrow('已被修改')
})
it('ordinary write witness refresh never publishes a late result into another workspace', async () => {
  const scope = await fixture(), other = await seedCurrentWorkspace('ordinary witness foreign view')
  let release!: () => void
  const barrier = coordinatePendingEditV1({ key: `worldview:${scope.projectId}:default`, persist: () => new Promise<void>(resolve => { release = resolve }) })
  await Promise.resolve(); await Promise.resolve()
  const saved = useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, divineDesign: { hasDivinity: true } }, scope)
  await useWorldviewStore.getState().loadAll(other.scope)
  const current = structuredClone(useWorldviewStore.getState().localSaveWitnesses)
  release(); await barrier; await saved
  expect(useWorldviewStore.getState().loadedScope).toEqual(other.scope)
  expect(useWorldviewStore.getState().worldview).toBeNull()
  expect(useWorldviewStore.getState().localSaveWitnesses).toEqual(current)
  expect((await row()).worldId).toBe(scope.worldId)
})
