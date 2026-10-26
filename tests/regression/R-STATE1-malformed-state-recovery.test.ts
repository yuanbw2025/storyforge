import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { inspectStateFields, parseFields, readStateCardFields, StateFieldsParseError } from '../../src/lib/types/state-card'
import { useStateCardStore } from '../../src/stores/state-card'
import { applyCharacterReferenceRemap } from '../../src/lib/registry/character-references'
import { transactionTablesFor } from '../../src/lib/registry/lifecycle'
import { adopt } from '../../src/lib/registry/adopt'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { useAIConfigStore } from '../../src/stores/ai-config'

const valid = '[ { "key": "位置", "value": "山门", "authorNote": "保留附加字段" }, {"key":"空值","value":""} ]'
const malformed: unknown[] = [null, undefined, 7, '', '{', '{}', 'null', '7', '[null]', '[{}]', '[[]]', '[false]',
  '[{"key":"位置"}]', '[{"key":null,"value":"山门"}]', '[{"key":7,"value":"山门"}]',
  '[{"key":"位置","value":null}]', '[{"key":"位置","value":7}]', '[{"key":"位置","value":{}}]',
  '[{"key":"位置","value":"山门"},null]',
]
const originalStore = useStateCardStore.getState()

async function seed(fields = '[{"key":"位置","value":"山门"},null]') {
  const made = await seedCurrentWorkspace('状态卡恢复')
  const row = stampNewRecord(made.scope, 'stateCards', {
    projectId: made.scope.projectId, category: 'character' as const, entityName: '林照', fields, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })
  const id = await db.stateCards.add(row)
  useStateCardStore.setState({ cards: [{ ...row, id }] })
  return { ...made, id, row: { ...row, id } }
}

beforeEach(async () => { await db.delete(); await db.open(); useStateCardStore.setState({ cards: [], loading: false }) })
afterEach(() => { vi.restoreAllMocks(); useStateCardStore.setState(originalStore, true); db.close() })

describe('STATE1 · strict state fields without silent normalization', () => {
  it.each(malformed.map((value, index) => ({ value, index })))('rejects malformed value $index without exposing raw contents', ({ value }) => {
    expect(() => parseFields(value)).toThrow(StateFieldsParseError)
    const inspected = inspectStateFields(value)
    expect(inspected.ok).toBe(false)
    expect(inspected).not.toHaveProperty('fields')
  })
  it('preserves whitespace, empty text and additional author fields in valid records', () => {
    expect(parseFields(valid)).toEqual(JSON.parse(valid))
    expect(inspectStateFields(valid)).toEqual({ ok: true, fields: JSON.parse(valid) })
    expect(parseFields('[]')).toEqual([])
    const error = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn')
    expect(() => parseFields('{private raw field contents}')).toThrow('有效 JSON')
    expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled()
  })
  it('identifies the card and invalid member without formatting its private field values', () => {
    expect(() => readStateCardFields({ entityName: '林照', fields: '[{"key":"private-key","value":"private-value"},null]' }))
      .toThrow('状态卡「林照」：状态字段第2项')
    try { readStateCardFields({ entityName: '林照', fields: '[{"key":"private-key","value":null}]' }) }
    catch (error) { expect((error as Error).message).not.toContain('private-key') }
  })
})

describe('STATE1 · contexts and storage do not lose malformed originals', () => {
  it('all/selective/manual-extra/matching/fallback readers fail explicitly and never alter the stored card', async () => {
    const f = await seed()
    const store = useStateCardStore.getState()
    expect(() => store.buildStateContext()).toThrow('林照')
    expect(() => store.buildSelectiveStateContext('沿溪探路')).toThrow('第2项')
    expect(() => store.buildSelectiveStateContext('林照')).toThrow('第2项')
    expect(() => store.buildSelectiveStateContext('', [f.id])).toThrow('第2项')
    expect(() => store.getCharacterState('林照')).toThrow('第2项')
    expect(await db.stateCards.get(f.id)).toEqual(f.row)
    await expect(CONTEXT_SOURCE_BY_KEY.get('stateCards')!.read({ projectId: f.scope.projectId, scope: f.scope, stateReferenceText: '林照' }))
      .rejects.toThrow('第2项')
    expect(await db.stateCards.get(f.id)).toEqual(f.row)
  })
  it.each(malformed.map((fields, index) => ({ fields, index })))('adoption rejects malformed fields $index, including null, with zero writes', async ({ fields }) => {
    const f = await seed(valid)
    const result = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'stateCards', recordId: f.id, mode: 'replace', data: { fields } })
    expect(result.written).toEqual([])
    expect(result.typeErrors).toHaveLength(1)
    expect(await db.stateCards.get(f.id)).toEqual(f.row)
  })
  it('registered adoption accepts valid structured arrays and retains every member', async () => {
    const f = await seed(valid)
    const fields = [{ key: '伤势', value: '右手受伤' }, { key: '待定', value: '' }]
    const result = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'stateCards', recordId: f.id, mode: 'replace', data: { fields } })
    expect(result.written).toHaveLength(1)
    expect(parseFields((await db.stateCards.get(f.id))!.fields)).toEqual(fields)
  })
  it('rejects sparse structured arrays before JSON serialization can turn holes into corrupt null fields', async () => {
    const f = await seed(valid)
    const fields: Array<{ key: string; value: string }> = new Array(2)
    fields[0] = { key: '位置', value: '山门' }
    const result = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'stateCards', recordId: f.id, mode: 'replace', data: { fields } })
    expect(result.written).toEqual([])
    expect(result.typeErrors).toHaveLength(1)
    expect(await db.stateCards.get(f.id)).toEqual(f.row)
  })
  it('explicit repair uses the exact original as a CAS baseline and reads the saved fields back', async () => {
    const f = await seed()
    await useStateCardStore.getState().updateCard(f.id, { fields: valid }, { expectedFields: f.row.fields })
    expect((await db.stateCards.get(f.id))?.fields).toBe(valid)
    expect(useStateCardStore.getState().cards[0].fields).toBe(valid)
    await expect(useStateCardStore.getState().updateCard(f.id, { fields: '[]' }, { expectedFields: f.row.fields }))
      .rejects.toThrow('另一页面')
    expect((await db.stateCards.get(f.id))?.fields).toBe(valid)
  })
  it('write failure leaves both database and displayed card unchanged', async () => {
    const f = await seed()
    vi.spyOn(db.stateCards, 'update').mockRejectedValueOnce(new Error('隔离写失败'))
    await expect(useStateCardStore.getState().updateCard(f.id, { fields: valid }, { expectedFields: f.row.fields }))
      .rejects.toThrow('隔离写失败')
    expect(await db.stateCards.get(f.id)).toEqual(f.row)
    expect(useStateCardStore.getState().cards[0]).toEqual(f.row)
  })
  it('chapter diff adoption cannot discard bad existing fields while applying an unrelated change', async () => {
    const f = await seed()
    await db.characters.add(stampNewRecord(f.scope, 'characters', {
      projectId: f.scope.projectId, name: '林照', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '', background: '', personality: '', createdAt: 1, updatedAt: 1,
    }, { owner: 'world' }))
    await expect(useStateCardStore.getState().applyDiffs(f.scope, [{ entityName: '林照', category: 'character', field: '心情', oldValue: null, newValue: '紧张' }]))
      .rejects.toThrow('第2项')
    expect(await db.stateCards.get(f.id)).toEqual(f.row)
    expect(await db.stateCards.count()).toBe(1)
  })
  it('shared prose/review gateway refuses bad state before producing any context, and works after explicit repair', async () => {
    const f = await seed()
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', {
      projectId: f.scope.projectId, type: 'chapter', parentId: null, title: '探路', summary: '林照沿溪探查道路。', order: 0, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    await db.detailedOutlines.add(stampNewRecord(f.scope, 'detailedOutlines', {
      projectId: f.scope.projectId, outlineNodeId, scenes: [{ sceneId: 's1', title: '断桥', summary: '探路至断桥，检查右手伤势后停下。', characterIds: [], location: '溪边', conflict: '', pace: 'slow', estimatedWords: 400, notes: '' }], createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    const input = { projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, outlineNodeId, operation: 'review' as const, authorRequest: '核对探路中的伤势', config: useAIConfigStore.getState().config }
    await expect(prepareProseGatewayAssemblyV1(input)).rejects.toThrow('第2项')
    await useStateCardStore.getState().updateCard(f.id, { fields: '[{"key":"伤势","value":"右手受伤"}]' }, { expectedFields: f.row.fields })
    const assembled = await prepareProseGatewayAssemblyV1(input)
    expect(assembled.text).toContain('右手受伤')
    expect(assembled.contextGatewayExecution.sourceSnapshots.some(snapshot => snapshot.sourceRefs.some(ref => ref.table === 'stateCards' && ref.recordId === f.id))).toBe(true)
  })
})


describe('STATE1 · scope and reference lifecycle', () => {
  it('repair cannot write a card belonging to another workspace scope', async () => {
    const f = await seed()
    const other = await seedCurrentWorkspace('其它作品')
    await expect(useStateCardStore.getState().updateCard(f.id, { fields: valid }, { expectedFields: f.row.fields, scope: other.scope }))
      .rejects.toThrow('不属于当前作品')
    expect(await db.stateCards.get(f.id)).toEqual(f.row)
  })
  it('a malformed card aborts reference remapping and rolls back earlier item changes', async () => {
    const f = await seed()
    const putCharacter = (name: string) => db.characters.add(stampNewRecord(f.scope, 'characters', {
      projectId: f.scope.projectId, name, roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '', background: '', personality: '', createdAt: 1, updatedAt: 1,
    }, { owner: 'world' }))
    const fromId = await putCharacter('林照'), toId = await putCharacter('新角色')
    const item = stampNewRecord(f.scope, 'itemLedger', { projectId: f.scope.projectId, itemName: '探路绳', heldByName: '林照', characterId: fromId, action: 'gain' as const, quantity: 1, createdAt: 1 }, { owner: 'work' })
    const itemId = await db.itemLedger.add(item)
    await expect(db.transaction('rw', transactionTablesFor('importProject'), async () => {
      await applyCharacterReferenceRemap({ projectId: f.scope.projectId, fromCharacterId: fromId, fromName: '林照', toCharacterId: toId, toName: '新角色' })
      await db.characters.delete(fromId)
    })).rejects.toThrow('第2项')
    expect(await db.stateCards.get(f.id)).toEqual(f.row)
    expect(await db.itemLedger.get(itemId)).toEqual({ ...item, id: itemId })
    expect(await db.characters.get(fromId)).toBeDefined()
  })
})
