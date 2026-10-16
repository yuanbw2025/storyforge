import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace, currentWorkFixtureRecordV1 } from '../helpers/current-workspace'
import { readOwnedRows, resolveScopeLike, stampNewRecord } from '../../src/lib/workspace/scope'
import { adopt } from '../../src/lib/registry/adopt'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { buildDetailedOutlineCopilotPatchV1, parseDetailedOutlineCopilotDraftV1 } from '../../src/lib/agent/detailed-outline-copilot'
import { hasDetailedOutlinePlanV1, normalizeDetailedScenes, type DetailedScene } from '../../src/lib/types/detailed-outline'
import { useDetailedOutlineStore } from '../../src/stores/detailed-outline'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { resolveLongformChapterNavigationV1 } from '../../src/lib/authoring/longform-chapter-navigation'

const scene = (): DetailedScene => ({ sceneId: 'stable-scene', title: '擦桌', summary: '收店后两人安静擦桌，约好明早分工。', location: '小店', conflict: '', characterIds: [], pace: 'slow', estimatedWords: 600, notes: '  保留作者原文\n不加敌人  ', entryState: '还没确认分工', goal: '把明早分工说清楚', keyChoice: '先问搭档愿不愿意', outcome: '双方同意各负责一项', exitState: '明早仍未开始干活', sceneFunction: '缓冲、关系变化；约定尚未履行' })
async function fixture() {
  const made = await seedCurrentWorkspace('场景任务验证')
  const nodeId = await db.outlineNodes.add(stampNewRecord(made.scope, 'outlineNodes', { projectId: made.scope.projectId, parentId: null, type: 'chapter', title: '第一章', summary: '两人收店后安排明天', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  const detail = await useDetailedOutlineStore.getState().getOrCreate(made.scope, nodeId)
  return { ...made, nodeId, detailId: detail.id! }
}

describe('LFQ4 · 可选场景任务、编辑合并与章节身份', () => {
  beforeEach(async () => {
    resetPendingEditCoordinatorForTestsV1()
    await db.delete(); await db.open()
    useDetailedOutlineStore.setState({ detailedOutlines: [], loading: false })
  })
  afterEach(() => { resetPendingEditCoordinatorForTestsV1(); db.close() })

  it('旧场景和原文不补写；空壳不显示已规划，允许缓冲场景和计划中的退出状态', () => {
    const { entryState: _a, goal: _b, keyChoice: _c, outcome: _d, exitState: _e, sceneFunction: _f, ...old } = scene()
    expect(normalizeDetailedScenes([old])).toEqual([old])
    expect('goal' in normalizeDetailedScenes([old])[0]).toBe(false)
    expect(hasDetailedOutlinePlanV1({ scenes: [] })).toBe(false)
    expect(hasDetailedOutlinePlanV1({ scenes: [{ ...old, title: '新场景', summary: '', notes: '' }] })).toBe(false)
    expect(hasDetailedOutlinePlanV1({ scenes: [scene()] })).toBe(true)
    expect(() => normalizeDetailedScenes([{ ...scene(), goal: 3 }])).toThrow('目标必须是文本')
    const raw = JSON.stringify({ scenes: [{ ...scene(), sceneId: undefined, notes: undefined }] })
    expect(parseDetailedOutlineCopilotDraftV1(raw, 'scenes').scenes[0]).toMatchObject({ conflict: '', exitState: '明早仍未开始干活' })
  })

  it('AI 修改保留 stable sceneId、未改动任务和作者备注；清空必须显式声明', () => {
    const current = { ...scene(), characterIds: [11] }
    const base = { title: '收店', summary: '收店时重新安排分工', location: '小店', conflict: '', pace: 'slow', estimatedWords: 500, characterIds: [] }
    const build = (extra: object) => buildDetailedOutlineCopilotPatchV1({ raw: JSON.stringify({ scenePlanMode: 'merge-proposal', scenes: [{ action: 'modify', sceneId: current.sceneId, ...base, ...extra }] }), operation: 'scenes', currentScenes: [current], chapterSummary: '章纲', validCharacterIds: new Set([11]), validForeshadowIds: new Set() }).scenes![0]
    expect(build({ goal: '新增目标' })).toMatchObject({ sceneId: current.sceneId, notes: current.notes, goal: '新增目标', exitState: current.exitState, keyChoice: current.keyChoice })
    expect(build({ notes: '', exitState: '' })).toMatchObject({ notes: '', exitState: '' })
    expect(build({ characterIds: undefined })).toMatchObject({ characterIds: [11] })
    expect(build({ characterIds: [] })).toMatchObject({ characterIds: [] })
    expect(() => build({ rewardBalance: 500 })).toThrow('未声明字段')
  })

  it('快速编辑读取最新数组后合并，追加/修改/删除不吞掉其它字段或场景', async () => {
    const f = await fixture(); const store = useDetailedOutlineStore.getState()
    await store.editScene(f.detailId, { kind: 'add', scene: scene() }, f.scope, '初始章纲')
    await Promise.all([
      store.editScene(f.detailId, { kind: 'patch', sceneId: 'stable-scene', patch: { goal: '作者快速改目标' } }, f.scope, '后续章纲'),
      store.editScene(f.detailId, { kind: 'patch', sceneId: 'stable-scene', patch: { notes: '作者快速改备注' } }, f.scope, '后续章纲'),
      store.editScene(f.detailId, { kind: 'add', scene: { ...scene(), sceneId: 'second' } }, f.scope, '后续章纲'),
    ])
    const row = await db.detailedOutlines.get(f.detailId)
    expect(row?.scenes[0]).toMatchObject({ goal: '作者快速改目标', notes: '作者快速改备注', exitState: scene().exitState })
    expect(row?.scenes.map(item => item.sceneId)).toEqual(['stable-scene', 'second'])
    expect(row?.lastUsedSummary).toBe('初始章纲')
    await store.editScene(f.detailId, { kind: 'remove', sceneId: 'second' }, f.scope, '后续章纲')
    expect((await db.detailedOutlines.get(f.detailId))?.scenes[0]).toMatchObject({ goal: '作者快速改目标', notes: '作者快速改备注' })
  })

  it('跨 Work、已删场景、变更稳定 ID 和错误类型写入拒绝，数据库不变且阻止继续生成', async () => {
    const f = await fixture(); const store = useDetailedOutlineStore.getState()
    await store.editScene(f.detailId, { kind: 'add', scene: scene() }, f.scope, '章纲')
    const before = await db.detailedOutlines.get(f.detailId)
    const workId = await db.works.add(currentWorkFixtureRecordV1({ projectId: f.scope.projectId, worldId: f.scope.worldId, title: '其它作品' })) as number
    await expect(store.editScene(f.detailId, { kind: 'patch', sceneId: 'stable-scene', patch: { goal: '越界' } }, { ...f.scope, workId }, '章纲')).rejects.toThrow('不属于指定作品')
    await expect(store.editScene(f.detailId, { kind: 'patch', sceneId: 'gone', patch: { goal: '错误场景' } }, f.scope, '章纲')).rejects.toThrow('场景已变化或删除')
    await expect(store.editScene(f.detailId, { kind: 'patch', sceneId: 'stable-scene', patch: { sceneId: 'forged' } as never }, f.scope, '章纲')).rejects.toThrow('不能改变稳定标识')
    await expect(store.editScene(f.detailId, { kind: 'patch', sceneId: 'stable-scene', patch: { goal: 123 } as never }, f.scope, '章纲')).rejects.toThrow('目标必须是文本')
    expect(await db.detailedOutlines.get(f.detailId)).toEqual(before)
    await expect(flushPendingEditsV1()).rejects.toThrow('编辑保存失败')
  })

  it('登记字段拒绝非法任务的整次采纳；导入预检先拒绝损坏值，新旧场景和引用都可往返', async () => {
    const f = await fixture()
    const characterId = await db.characters.add(stampNewRecord(f.scope, 'characters', { projectId: f.scope.projectId, name: '阿澄', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '{}', arc: '', createdAt: 1, updatedAt: 1 }, { owner: 'world' })) as number
    const data = { outlineNodeId: f.nodeId, scenes: [{ ...scene(), characterIds: [characterId] }] }
    const accepted = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'detailedOutlines', mode: 'replace', data })
    expect(accepted.written).toHaveLength(1)
    const rejected = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'detailedOutlines', mode: 'replace', data: { ...data, scenes: [{ ...scene(), goal: [] }], endingCliffhanger: '不能部分写入' } })
    expect(rejected.typeErrors).toHaveLength(1)
    expect(rejected.written).toHaveLength(0)
    const backup = await exportProjectJSON(f.scope.projectId)
    const imported = await resolveScopeLike(await importProjectJSON(backup))
    const row = (await readOwnedRows<any>(imported, 'detailedOutlines', { owner: 'work' }))[0]
    const character = (await readOwnedRows<any>(imported, 'characters', { owner: 'world' }))[0]
    expect(row.scenes[0]).toMatchObject({ ...scene(), characterIds: [character.id] })
    expect(character.id).not.toBe(characterId)
    const bad = structuredClone(backup); bad.detailedOutlines[0].scenes[0].goal = [] as never
    const count = await db.projects.count()
    await expect(importProjectJSON(bad)).rejects.toThrow('目标必须是文本')
    expect(await db.projects.count()).toBe(count)
    expect(backup.detailedOutlines[0].scenes[0].goal).toBe(scene().goal)
  })

  it('跳转固定当前 Work 和同一章纲身份，拒绝其它作品、非章节以及等待期间切换作品', async () => {
    const f = await fixture()
    await expect(resolveLongformChapterNavigationV1({ scope: f.scope, outlineNodeId: f.nodeId, module: 'settings' as never })).rejects.toThrow('目标无效')
    for (const module of ['outline', 'detailed-outline', 'chapters-list'] as const) expect(await resolveLongformChapterNavigationV1({ scope: f.scope, outlineNodeId: f.nodeId, module })).toBe(`/workspace/${f.scope.projectId}?module=${module}&chapter=${f.nodeId}&work=${f.scope.workId}`)
    const other = await fixture()
    await expect(resolveLongformChapterNavigationV1({ scope: f.scope, outlineNodeId: other.nodeId, module: 'detailed-outline' })).rejects.toThrow('不属于当前作品')
    const workId = await db.works.add(currentWorkFixtureRecordV1({ projectId: f.scope.projectId, worldId: f.scope.worldId, title: '切换后作品' })) as number
    await db.projects.update(f.scope.projectId, { activeWorkId: workId })
    await expect(resolveLongformChapterNavigationV1({ scope: f.scope, outlineNodeId: f.nodeId, module: 'chapters-list' })).rejects.toThrow('作品已切换')
  })
})
