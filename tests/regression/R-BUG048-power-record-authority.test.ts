import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useWorldviewStore as store } from '../../src/stores/worldview'
import { useCultivationStore } from '../../src/stores/cultivation'
import { readRecordTextWitnessesV1 } from '../../src/lib/authoring/record-text-save-evidence'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { preparePowerAuthoringCopilotV1 } from '../../src/lib/agent/power-authoring-copilot'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { fingerprintSettingSource } from '../../src/lib/fact-ledger/setting-assertions'
import type { LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'

beforeEach(async () => { resetPendingEditCoordinatorForTestsV1(); await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1(); db.close() })
async function fixture() {
  const f = await seedCurrentWorkspace('048 多条规则权威')
  const ids: number[] = []
  for (const suffix of ['一', '二']) ids.push(await db.powerSystems.add(stampNewRecord(f.scope, 'powerSystems', {
    projectId: f.scope.projectId, worldGroupId: null, name: '同名力量规则', description: `第${suffix}条独立描述`, rules: `第${suffix}条独立约束`,
    levels: JSON.stringify({ 上阶: { 限制: `第${suffix}条不丢属性`, 数量: 125 } }), createdAt: 1, updatedAt: 1,
  }, { owner: 'world' }) as never) as number)
  const stages = '[{"id":"root","name":"独立起境","parentStageIds":[],"authorExtra":{"keep":125}}]'
  const pathId = await useCultivationStore.getState().addSystem({ projectId: f.scope.projectId, worldGroupId: null, name: '共享成长路径', description: '不属于某条规则', stages }, f.scope)
  await store.getState().loadAll(f.scope)
  return { ...f, ids, stages, pathId }
}
async function proof(f: Awaited<ReturnType<typeof fixture>>, id: number, field = 'description'): Promise<LocalSaveIntentV1> {
  return { kind: 'natural-field-local-save-v1', expected: (await readRecordTextWitnessesV1('powerSystems', id, f.scope))[field], session: '048-selected-rule', generation: 1 }
}
it('does not infer the first of same-named rules; explicit ID/proof writes only that original row and leaves shared paths untouched', async () => {
  const f = await fixture(), before = await db.powerSystems.get(f.ids[0]), second = (await db.powerSystems.get(f.ids[1]))!
  expect(store.getState().powerSystems.map(row => row.id)).toEqual(f.ids)
  await expect(store.getState().savePowerSystem({ projectId: f.scope.projectId, worldGroupId: null, description: '不允许默认写首条' }, f.scope)).rejects.toThrow('明确选择')
  const raw = '  第二条作者稿\r\n保留尾空格  '
  const ack = await store.getState().savePowerSystem({ projectId: f.scope.projectId, worldGroupId: null, id: f.ids[1], description: raw }, f.scope, await proof(f, f.ids[1]))
  expect(ack).toMatchObject({ witness: { value: raw, identity: { recordId: f.ids[1], field: 'description' } } })
  expect(await db.powerSystems.get(f.ids[0])).toEqual(before)
  expect(await db.powerSystems.get(f.ids[1])).toMatchObject({ description: raw, name: second.name, rules: second.rules, levels: second.levels, ragDocumentId: Reflect.get(second, 'ragDocumentId') })
  expect((await db.cultivationSystems.get(f.pathId))!.stages).toBe(f.stages)
  expect(store.getState().powerSystems.find(row => row.id === f.ids[1])!.description).toBe(raw)
})
it('rejects mismatched proof, foreign records and deleted selections without recreating or overwriting another rule', async () => {
  const f = await fixture(), first = await db.powerSystems.get(f.ids[0]), second = await db.powerSystems.get(f.ids[1]), old = await proof(f, f.ids[1])
  await expect(store.getState().savePowerSystem({ projectId: f.scope.projectId, worldGroupId: null, id: f.ids[0], description: '错绑' }, f.scope, old)).rejects.toThrow('目标与本机凭据不一致')
  const other = await seedCurrentWorkspace('外部世界')
  const foreign = await db.powerSystems.add(stampNewRecord(other.scope, 'powerSystems', { projectId: other.scope.projectId, name: '外部规则', rules: '原值', worldGroupId: null, createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as never) as number
  await expect(store.getState().savePowerSystem({ projectId: f.scope.projectId, worldGroupId: null, id: foreign, rules: '越界' }, f.scope)).rejects.toThrow('不属于')
  await db.powerSystems.delete(f.ids[1])
  await expect(store.getState().savePowerSystem({ projectId: f.scope.projectId, worldGroupId: null, id: f.ids[1], description: '不能重建' }, f.scope, old)).rejects.toThrow('已删除')
  expect(await db.powerSystems.get(f.ids[0])).toEqual(first)
  expect(await db.powerSystems.get(f.ids[1])).toBeUndefined()
  expect(second!.id).not.toBe(foreign)
  expect((await db.powerSystems.get(foreign))!.rules).toBe('原值')
})
it('reads all same-group rule records and their complete legacy level attributes through the original registered source', async () => {
  const f = await fixture(), group = await db.worldGroups.add(stampNewRecord(f.scope, 'worldGroups', { projectId: f.scope.projectId, name: '别的分区', type: 'secondary', order: 1, createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as never) as number
  await db.powerSystems.add(stampNewRecord(f.scope, 'powerSystems', { projectId: f.scope.projectId, worldGroupId: group, name: '不应读入的分区规则', rules: '分区外', createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as never)
  const context = await assembleContext({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, sourceKeys: ['powerSystem'], inputBudgetTokens: 20_000 })
  for (const marker of ['第一条独立描述', '第二条独立描述', '第一条独立约束', '第二条独立约束', '第一条不丢属性', '第二条不丢属性', '共享成长路径']) expect(context.text).toContain(marker)
  expect(context.text).not.toContain('不应读入的分区规则')
  expect(context.included).toEqual(['powerSystem']); expect(context.trimmed).toEqual([])
})
it('rolls back the selected rule and Canon source state together when the original source-status write fails', async () => {
  const f = await fixture(), id = f.ids[1], before = (await db.powerSystems.get(id))!, expected = await proof(f, id, 'rules')
  const factId = await db.temporalFacts.add(stampNewRecord(f.scope, 'temporalFacts', { projectId: f.scope.projectId, subjectName: '同名力量规则', predicate: 'powerCeiling', factKind: 'state', value: '旧规则', sourceType: 'setting', sourceRecordTable: 'powerSystems', sourcePowerSystemId: id, sourceField: 'rules', sourceFingerprint: fingerprintSettingSource(before.rules), status: 'confirmed', locked: false, createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as never)
  const fault = vi.spyOn(db.temporalFacts, 'update').mockResolvedValueOnce(0)
  await expect(store.getState().savePowerSystem({ projectId: f.scope.projectId, worldGroupId: null, id, rules: '作者新规则' }, f.scope, expected)).rejects.toThrow('已回滚')
  expect(fault).toHaveBeenCalledTimes(1)
  fault.mockRestore()
  expect(await db.powerSystems.get(id)).toEqual(before)
  expect((await db.temporalFacts.get(factId))!.status).toBe('confirmed')
  await store.getState().savePowerSystem({ projectId: f.scope.projectId, worldGroupId: null, id, rules: '作者新规则' }, f.scope, expected)
  expect((await db.powerSystems.get(id))!.rules).toBe('作者新规则')
  expect((await db.temporalFacts.get(factId))!.status).toBe('stale')
})

it('prepares the frozen second same-name rule with both original records and no write or model dispatch', async () => {
  const f = await fixture(), before = await db.powerSystems.toArray()
  const prepared = await preparePowerAuthoringCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null,
    request: { target: { table: 'powerSystems', recordId: f.ids[1], field: 'rules' }, allocatedStageIds: [] }, authorRequest: '只修改选中的第二条规则' })
  expect(prepared.label).toContain(`规则记录 #${f.ids[1]}`)
  const prompt = prepared.prepared.messages.map(message => message.content).join('\n')
  for (const marker of ['第一条独立描述', '第二条独立描述', '第一条独立约束', '第二条独立约束', '第一条不丢属性', '第二条不丢属性']) expect(prompt).toContain(marker)
  expect(await db.powerSystems.toArray()).toEqual(before)
})
