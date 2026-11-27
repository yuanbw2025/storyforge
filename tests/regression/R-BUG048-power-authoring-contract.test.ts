import { describe, expect, it } from 'vitest'
import {
  decodePowerStagesStrictV1,
  preparePowerAuthoringEditV1,
  type PowerAuthoringScopeV1,
  type PowerAuthoringSnapshotV1,
  type PowerAuthoringTargetV1,
  type PowerStageFieldV1,
} from '../../src/lib/cultivation/power-authoring-contract'

const scope: PowerAuthoringScopeV1 = { projectId: 1, worldId: 2, workId: 3, worldGroupId: null }
const graph = [
  { id: 'root', name: '起点', parentStageIds: [], features: '保留能力', breakthrough: '保留代价', branchLabel: '原分支', tier: 0,
    authorData: { quote: '作者独立注释', flags: [false, null, ''], nested: { cost: 2 } } },
  { id: 'left', name: '分支', parentStageIds: ['root'], features: '' },
  { id: 'right', name: '分支', parentStageIds: ['root'], breakthrough: '不同ID的同名阶段' },
  { id: 'merge', name: '合流', parentStageIds: ['left', 'right'] },
]
function path(stages = JSON.stringify(graph), id = 7): PowerAuthoringSnapshotV1 {
  return { table: 'cultivationSystems', record: {
    id, projectId: 1, worldId: 2, name: '现有路径', description: '现有原理', stages, createdAt: 1, updatedAt: 2,
  } }
}
function edit(field: PowerStageFieldV1, value: unknown, stages = JSON.stringify(graph)) {
  return preparePowerAuthoringEditV1({ scope, snapshot: path(stages),
    target: { table: 'cultivationSystems', recordId: 7, field: 'stages', stageId: 'root', stageField: field }, value })
}
const whole = (value: unknown, stages = JSON.stringify(graph), allocatedStageIds?: string[]) => preparePowerAuthoringEditV1({
  scope, snapshot: path(stages), target: { table: 'cultivationSystems', recordId: 7, field: 'stages' }, value, allocatedStageIds,
})
const plan = (overrides: Record<string, unknown> = {}) => ({ version: 1, updates: [], additions: [], removals: [], ...overrides })

describe('048 A1 pure power authoring contract (not adoption authorization)', () => {
  it('keeps overview, detail and path edits on their own actual record IDs', () => {
    const fixtures: Array<[PowerAuthoringSnapshotV1, PowerAuthoringTargetV1]> = [
      [{ table: 'worldviews', record: { id: 4, projectId: 1, worldId: 2, powerHierarchy: '正式总体', createdAt: 1, updatedAt: 1 } },
        { table: 'worldviews', recordId: 4, field: 'powerHierarchy' }],
      [{ table: 'powerSystems', record: { id: 5, projectId: 1, worldId: 2, name: '同名', description: '独立明细', levels: '作者逐行等级\n不是DAG', rules: '原规则', createdAt: 1, updatedAt: 1 } },
        { table: 'powerSystems', recordId: 5, field: 'rules' }],
      [path(), { table: 'cultivationSystems', recordId: 7, field: 'description' }],
    ]
    for (const [snapshot, target] of fixtures) {
      const original = structuredClone(snapshot)
      const result = preparePowerAuthoringEditV1({ scope, snapshot, target, value: '  作者新输入 é 😀\n' })
      expect(result.patch).toEqual({ [target.field]: '  作者新输入 é 😀\n' })
      expect(result.removedStageIds).toEqual([])
      expect(snapshot).toEqual(original)
    }
  })

  it('does not choose an identically named path or require a fake parent power-system ID', () => {
    const snapshot = path(undefined, 8)
    const result = preparePowerAuthoringEditV1({ scope, snapshot,
      target: { table: 'cultivationSystems', recordId: 8, field: 'name' }, value: '同名' })
    expect(result.target.recordId).toBe(8)
    expect(() => preparePowerAuthoringEditV1({ scope, snapshot,
      target: { table: 'cultivationSystems', recordId: 7, field: 'name' }, value: '同名' })).toThrow(/scope or ID/)
  })

  it.each([
    ['projectId', 9], ['worldId', 9], ['worldGroupId', 9], ['worldGroupId', undefined], ['worldGroupId', '2'],
    ['projectId', 0], ['worldId', NaN], ['workId', -1], ['workId', 1.5],
  ])('rejects an invalid or different scope %s=%s without changing the snapshot', (key, value) => {
    const snapshot = path(), original = structuredClone(snapshot)
    expect(() => preparePowerAuthoringEditV1({ scope: { ...scope, [key]: value } as PowerAuthoringScopeV1, snapshot,
      target: { table: 'cultivationSystems', recordId: 7, field: 'description' }, value: '改动' })).toThrow()
    expect(snapshot).toEqual(original)
  })

  it('accepts an explicit selected world group but never borrows another group', () => {
    const snapshot = path()
    snapshot.record.worldGroupId = 4
    expect(preparePowerAuthoringEditV1({ scope: { ...scope, worldGroupId: 4 }, snapshot,
      target: { table: 'cultivationSystems', recordId: 7, field: 'name' }, value: '本组' }).patch).toEqual({ name: '本组' })
    expect(() => preparePowerAuthoringEditV1({ scope, snapshot,
      target: { table: 'cultivationSystems', recordId: 7, field: 'name' }, value: '越界' })).toThrow(/scope or ID/)
  })

  it.each([
    { table: 'powerSystems', recordId: 7, field: 'name' },
    { table: 'cultivationSystems', recordId: 7, field: 'projectId' },
    { table: 'cultivationSystems', recordId: 7, field: 'name', stageId: 'root', stageField: 'name' },
    { table: 'cultivationSystems', recordId: 7, field: 'stages', stageId: 'root', stageField: 'id' },
    { table: 'cultivationSystems', recordId: 7, field: 'stages', stageId: undefined },
    { table: 'cultivationSystems', recordId: 7, field: 'name', worldId: 2 },
    { table: 'cultivationSystems', recordId: 0, field: 'name' },
  ])('rejects table, identity and field bypasses %#', target => {
    expect(() => preparePowerAuthoringEditV1({ scope, snapshot: path(), target: target as PowerAuthoringTargetV1, value: '改动' })).toThrow()
  })

  it('does not coerce malformed saved text or accept object candidates as text', () => {
    const snapshot = path()
    const target = { table: 'cultivationSystems', recordId: 7, field: 'description' } as const
    expect(() => preparePowerAuthoringEditV1({ scope, snapshot, target, value: { text: '擅加字段' } })).toThrow(/must be text/)
    Object.assign(snapshot.record, { description: { author: '坏值仍保留' } })
    const original = structuredClone(snapshot)
    expect(() => preparePowerAuthoringEditV1({ scope, snapshot, target, value: '覆盖' })).toThrow(/preserve it/)
    expect(snapshot).toEqual(original)
  })

  it('strictly decodes branching/merging DAGs and preserves unknown author data', () => {
    expect(decodePowerStagesStrictV1(JSON.stringify(graph))).toEqual(graph)
    expect(decodePowerStagesStrictV1('[]')).toEqual([])
    const result = edit('name', '新名')
    expect(JSON.parse(result.patch.stages)).toEqual([{ ...graph[0], name: '新名' }, ...graph.slice(1)])
    expect(result.removedStageIds).toEqual([])
    expect(Object.keys(result.patch)).toEqual(['stages'])
  })

  it.each([
    '', '{', 'null', '{}', '[null]', '[1]', '[[]]',
    '[{"id":"a","name":"a","parentStageIds":"b"}]',
    '[{"id":"a","name":"a","parentStageIds":[4]}]',
    '[{"id":"a","name":"a","parentStageIds":[],"features":null}]',
    '[{"id":"a","name":"a","parentStageIds":[],"authorData":{"cost":1e999}}]',
    '[{"id":"a","name":"a","parentStageIds":[],"tier":1e999}]',
    '[{"id":"a","name":"a","parentStageIds":[]},{"id":"a","name":"b","parentStageIds":[]}]',
    '[{"id":"a","name":"a","parentStageIds":["missing"]}]',
    '[{"id":"a","name":"a","parentStageIds":["a"]}]',
    '[{"id":"a","name":"a","parentStageIds":["b"]},{"id":"b","name":"b","parentStageIds":["a"]}]',
    '[{"id":"a","name":"a","parentStageIds":[]},{"id":"b","name":"b","parentStageIds":["a","a"]}]',
  ])('blocks malformed old graphs, preserving the raw input %#', raw => {
    const snapshot = path(raw)
    expect(() => decodePowerStagesStrictV1(raw)).toThrow()
    expect(() => preparePowerAuthoringEditV1({ scope, snapshot,
      target: { table: 'cultivationSystems', recordId: 7, field: 'stages', stageId: 'a', stageField: 'name' }, value: '不可覆盖' })).toThrow()
    expect(snapshot.record).toHaveProperty('stages', raw)
  })

  it.each([
    ['features', '新能力'], ['breakthrough', '新代价'], ['branchLabel', '分支乙'], ['tier', 1], ['parentStageIds', []],
  ] as const)('changes only a stage %s, keeping the rest of its JSON intact', (field, value) => {
    const next = JSON.parse(edit(field, value).patch.stages)
    expect(next).toEqual([{ ...graph[0], [field]: value }, ...graph.slice(1)])
  })

  it.each([
    ['name', ' '], ['features', null], ['tier', Infinity], ['parentStageIds', ['missing']],
    ['parentStageIds', ['root']], ['parentStageIds', ['merge']], ['parentStageIds', ['left', 'left']],
  ] as const)('blocks invalid partial stage changes %s=%s', (field, value) => {
    expect(() => edit(field, value)).toThrow()
    expect(graph[0].name).toBe('起点')
  })

  it('keeps stable IDs, order and unknown data across an explicit whole-path edit', () => {
    const result = whole(plan({ updates: [{ id: 'left', patch: { name: '同名可保留', features: '局部扩写' } }],
      additions: [{ id: 'allocated-new', name: '新阶段', parentStageIds: ['merge'] }] }), undefined, ['allocated-new'])
    const next = JSON.parse(result.patch.stages)
    expect(next.slice(0, 4)).toEqual([graph[0], { ...graph[1], name: '同名可保留', features: '局部扩写' }, graph[2], graph[3]])
    expect(next[4]).toEqual({ id: 'allocated-new', name: '新阶段', parentStageIds: ['merge'] })
    expect(result.removedStageIds).toEqual([])
  })

  it('reports explicit removed IDs and requires explicit repair of edges, without performing reference cleanup', () => {
    expect(() => whole(plan({ removals: ['left'] }))).toThrow()
    const result = whole(plan({ removals: ['left'], updates: [{ id: 'merge', patch: { parentStageIds: ['right'] } }] }))
    expect(result.removedStageIds).toEqual(['left'])
    expect(JSON.parse(result.patch.stages)).toEqual([graph[0], graph[2], { ...graph[3], parentStageIds: ['right'] }])
  })

  it.each([
    plan({ version: 2 }), plan({ stages: [] }), [], plan({ updates: [{ id: 'unknown', patch: { name: '新名' } }] }),
    plan({ updates: [{ id: 'root', patch: { id: 'rewrite' } }] }), plan({ updates: [{ id: 'root', patch: {} }] }),
    plan({ updates: [{ id: 'root', patch: { authorData: '不可越权' } }] }),
    plan({ updates: [{ id: 'root', patch: { name: 'a' } }, { id: 'root', patch: { name: 'b' } }] }),
    plan({ updates: [{ id: 'root', patch: { name: 'a' } }], removals: ['root'] }),
    plan({ removals: ['missing'] }), plan({ removals: ['left', 'left'] }),
    plan({ additions: [{ id: 'not-allocated', name: '名称不能代替ID', parentStageIds: [] }] }),
    plan({ additions: [{ id: 'root', name: '替换旧ID', parentStageIds: [] }] }),
    plan({ additions: [{ id: 'new', name: '新', parentStageIds: [], invented: '未登记' }] }),
    plan({ additions: [{ id: 'new', name: '新', parentStageIds: ['missing'] }] }),
    plan({ additions: [{ id: 'new', name: '新', parentStageIds: ['new'] }] }),
  ])('rejects invalid or broad whole-path requests %#', value => {
    const original = JSON.stringify(graph)
    expect(() => whole(value, original, ['new'])).toThrow()
    expect(JSON.stringify(graph)).toBe(original)
  })

  it('blocks the reviewed combined receipt ID and tiny measurement counterexample', () => {
    const raw = '[{"id":"a","name":"a","parentStageIds":[],"authorData":{"receiptId":9007199254740993,"tinyMeasure":1e-325}}]'
    const snapshot = path(raw)
    expect(() => preparePowerAuthoringEditV1({ scope, snapshot,
      target: { table: 'cultivationSystems', recordId: 7, field: 'stages', stageId: 'a', stageField: 'name' },
      value: 'b' })).toThrow(/cannot round-trip without information loss/)
    expect(snapshot.record).toHaveProperty('stages', raw)
  })

  it.each([
    '9007199254740993', '-9007199254740993', '9007199254740993123456789',
    '0.10000000000000001', '1.0000000000000001', '1e-325', '-1e-325',
    '4.9406564584124654e-324', '1e309', '-1e309', '-0', '-0.0e10',
  ])('preserves old raw and rejects a name-only edit that would change numeric value %s', token => {
    const raw = `[{"id":"root","name":"原名","parentStageIds":[],"authorData":{"number":${token}}}]`
    const snapshot = path(raw)
    expect(() => decodePowerStagesStrictV1(raw)).toThrow()
    expect(() => preparePowerAuthoringEditV1({ scope, snapshot,
      target: { table: 'cultivationSystems', recordId: 7, field: 'stages', stageId: 'root', stageField: 'name' }, value: '新名' })).toThrow()
    expect(snapshot.record).toHaveProperty('stages', raw)
    expect(() => whole(plan({ updates: [{ id: 'root', patch: { name: '新名' } }] }), raw)).toThrow()
  })

  it.each([
    '0', '42', '-42', '0.1', '-1.25', '1.0000', '1.25e2', '125e-2',
    '12.500E+1', '0e-99999', '1e20', '1e21', '1e-7', '1e-320', '5e-324',
    '9007199254740992', '9007199254740994',
  ])('accepts round-trip-equivalent author numeric values %s', token => {
    const raw = `[{"id":"root","name":"原名","parentStageIds":[],"authorData":{"number":${token}}}]`
    const next = JSON.parse(edit('name', '新名', raw).patch.stages)
    expect(next[0]).toEqual({ ...JSON.parse(raw)[0], name: '新名' })
  })

  it('does not interpret numeric-looking keys or escaped string contents as number tokens', () => {
    const authorData = { '9007199254740993': '1e-325', text: '"9007199254740993" \\ -0 1e309', nested: ['0.10000000000000001'] }
    const raw = JSON.stringify([{ id: 'root', name: '原名', parentStageIds: [], authorData }])
    expect(JSON.parse(edit('name', '新名', raw).patch.stages)[0].authorData).toEqual(authorData)
  })

  it('detaches output objects from caller-owned targets and input graph values', () => {
    const snapshot = path(), original = structuredClone(snapshot)
    const target = { table: 'cultivationSystems', recordId: 7, field: 'stages', stageId: 'merge', stageField: 'parentStageIds' } as const
    const parents = ['right', 'left']
    const result = preparePowerAuthoringEditV1({ scope, snapshot, target, value: parents })
    parents.push('root')
    expect(JSON.parse(result.patch.stages)[3].parentStageIds).toEqual(['right', 'left'])
    expect(snapshot).toEqual(original)
    expect(result.target).not.toBe(target)
  })
})
