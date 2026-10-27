import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useStoryArcStore } from '../../src/stores/story-arc'
import * as scopeModule from '../../src/lib/workspace/scope'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { assembleContext } from '../../src/lib/registry/assemble-context'

const stage = { id: 'verify-route', title: '核验路标', description: '先试绳，再决定封路', keyEvents: ['记录实测数据'] }
async function fixture(label = '故事线保存') {
  const f = await seedCurrentWorkspace(label)
  const id = await db.storyArcs.add(stampNewRecord(f.scope, 'storyArcs', { projectId: f.scope.projectId, name: label, type: 'main', stages: JSON.stringify([stage]), description: '原作者描述', origin: 'manual', status: 'active', createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  return { ...f, id }
}

describe.sequential('STAB · 故事线作者保存与作用域', () => {
  beforeEach(async () => {
    resetPendingEditCoordinatorForTestsV1(); await db.delete(); await db.open()
    useStoryArcStore.setState({ arcs: [], activeArcId: null, intentAlignmentByArcId: {}, loading: false, loadedScope: null, loadError: null } as any)
  })
  afterEach(() => { vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1(); db.close() })

  it('读取失败结束等待并暴露重读错误，原始行不变', async () => {
    const f = await fixture(); const original = await db.storyArcs.get(f.id)
    const read = scopeModule.readOwnedRows
    vi.spyOn(scopeModule, 'readOwnedRows').mockImplementation(async (...args) => {
      if (args[1] === 'storyArcs') throw new Error('隔离故事线读取故障')
      return read(...args)
    })
    await useStoryArcStore.getState().loadAll(f.scope)
    expect(useStoryArcStore.getState().loading).toBe(false)
    expect((useStoryArcStore.getState() as any).loadError).toContain('隔离故事线读取故障')
    expect(await db.storyArcs.get(f.id)).toEqual(original)
  })

  it('迟到旧作品读取不能覆盖新作品列表或选择', async () => {
    const a = await fixture('旧作品'); const b = await fixture('新作品')
    const read = scopeModule.readOwnedRows
    let release!: () => void; let entered!: () => void
    const gate = new Promise<void>(r => { release = r }); const started = new Promise<void>(r => { entered = r })
    vi.spyOn(scopeModule, 'readOwnedRows').mockImplementation(async (...args) => {
      if (args[1] === 'storyArcs' && args[0].workId === a.scope.workId) { entered(); await gate }
      return read(...args)
    })
    const older = useStoryArcStore.getState().loadAll(a.scope); await started
    await useStoryArcStore.getState().loadAll(b.scope); release(); await older
    expect(useStoryArcStore.getState().arcs.map(row => row.id)).toEqual([b.id])
    expect(useStoryArcStore.getState().activeArcId).toBe(b.id)
    expect((useStoryArcStore.getState() as any).loadedScope?.workId).toBe(b.scope.workId)
  })

  it.each([{ name: 2 }, { description: null }, { type: 'invalid' }, { projectId: 123 }, { stages: '[]' }])('只允许登记作者标量字段与合法类型：%j', async patch => {
    const f = await fixture(); await useStoryArcStore.getState().loadAll(f.scope)
    const before = await db.storyArcs.get(f.id)
    await expect((useStoryArcStore.getState().updateArc as any)(f.id, patch, f.scope)).rejects.toThrow()
    expect(await db.storyArcs.get(f.id)).toEqual(before)
  })

  it('已删除与0行写入都明确失败，不发布成功缓存', async () => {
    const f = await fixture(); await useStoryArcStore.getState().loadAll(f.scope)
    const before = useStoryArcStore.getState().arcs
    const update = vi.spyOn(db.storyArcs, 'update').mockResolvedValue(0)
    await expect(useStoryArcStore.getState().updateArc(f.id, { description: '新描述' })).rejects.toThrow()
    expect(useStoryArcStore.getState().arcs).toEqual(before)
    update.mockRestore(); await db.storyArcs.delete(f.id)
    await expect(useStoryArcStore.getState().updateArc(f.id, { name: '丢失目标' })).rejects.toThrow()
  })

  it('明确外作品scope不能借记录projectId绕过作者边界', async () => {
    const a = await fixture('作者甲'); const b = await fixture('作者乙')
    await useStoryArcStore.getState().loadAll(a.scope); const before = await db.storyArcs.get(a.id)
    await expect((useStoryArcStore.getState().updateArc as any)(a.id, { name: '越界改名' }, b.scope)).rejects.toThrow()
    expect(await db.storyArcs.get(a.id)).toEqual(before)
  })

  it('逐字段CAS阻止覆盖另一页面，未改字段允许并行合并', async () => {
    const f = await fixture(); await useStoryArcStore.getState().loadAll(f.scope)
    await db.storyArcs.update(f.id, { description: '另一页的新稿' })
    await expect((useStoryArcStore.getState().updateArc as any)(f.id, { description: '旧页覆盖' }, f.scope, { description: '原作者描述' })).rejects.toThrow()
    await (useStoryArcStore.getState().updateArc as any)(f.id, { name: '只改名称' }, f.scope, { name: '故事线保存' })
    expect((await db.storyArcs.get(f.id))?.description).toBe('另一页的新稿')
    expect((await db.storyArcs.get(f.id))?.name).toBe('只改名称')
  })

  it.each([[{ ...stage, keyEvents: null }], [{ ...stage }, { ...stage }], [null]])('非法阶段结构拒绝并保留原JSON：%j', async stages => {
    const f = await fixture(); await useStoryArcStore.getState().loadAll(f.scope); const before = await db.storyArcs.get(f.id)
    await expect(useStoryArcStore.getState().updateStages(f.id, stages as any)).rejects.toThrow()
    expect(await db.storyArcs.get(f.id)).toEqual(before)
  })

  it('阶段0行写入不清掉进度引用，整个修改回滚', async () => {
    const f = await fixture(); await useStoryArcStore.getState().loadAll(f.scope)
    const id = await db.storylineProgress.add(stampNewRecord(f.scope, 'storylineProgress', { projectId: f.scope.projectId, arcId: f.id, currentStageId: stage.id, currentStageLabel: stage.title, status: 'in_progress', progressPercent: 10, lastActiveChapterId: null, lastActiveChapterTitle: '', notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as any)
    const original = await db.storylineProgress.get(id)
    vi.spyOn(db.storyArcs, 'update').mockResolvedValue(0)
    await expect(useStoryArcStore.getState().updateStages(f.id, [])).rejects.toThrow()
    expect(await db.storylineProgress.get(id)).toEqual(original)
  })

  it('两个阶段字段串行合并，不用旧完整数组覆盖另一字段', async () => {
    const f = await fixture(); await useStoryArcStore.getState().loadAll(f.scope)
    await Promise.all([
      useStoryArcStore.getState().editStage(f.id, { kind: 'patch', stageId: stage.id, patch: { title: '核验新标题' }, expected: { title: stage.title } }, f.scope),
      useStoryArcStore.getState().editStage(f.id, { kind: 'patch', stageId: stage.id, patch: { description: '核验新描述' }, expected: { description: stage.description } }, f.scope),
    ])
    expect(JSON.parse((await db.storyArcs.get(f.id))!.stages)[0]).toMatchObject({ title: '核验新标题', description: '核验新描述' })
  })

  it('阶段冲突、已删目标和身份字段均拒绝，原JSON保留', async () => {
    const f = await fixture(); await useStoryArcStore.getState().loadAll(f.scope)
    const before = (await db.storyArcs.get(f.id))!.stages
    await expect(useStoryArcStore.getState().editStage(f.id, { kind: 'patch', stageId: stage.id, patch: { title: '覆盖' }, expected: { title: '错误前值' } }, f.scope)).rejects.toThrow()
    await expect(useStoryArcStore.getState().editStage(f.id, { kind: 'remove', stageId: 'missing' }, f.scope)).rejects.toThrow()
    await expect(useStoryArcStore.getState().editStage(f.id, { kind: 'patch', stageId: stage.id, patch: { id: '篡改' } as any }, f.scope)).rejects.toThrow()
    expect((await db.storyArcs.get(f.id))!.stages).toBe(before)
  })

  it('写入绑定发起时作品，迟到回执不能替换另一作品列表', async () => {
    const a = await fixture('写入原作品'); const b = await fixture('当前新作品')
    await useStoryArcStore.getState().loadAll(a.scope)
    const resolve = scopeModule.resolveScopeLike
    let release!: () => void; let entered!: () => void
    const gate = new Promise<void>(r => { release = r }); const started = new Promise<void>(r => { entered = r })
    vi.spyOn(scopeModule, 'resolveScopeLike').mockImplementation(async input => {
      if (typeof input === 'object' && input.workId === a.scope.workId) { entered(); await gate }
      return resolve(input)
    })
    const pending = useStoryArcStore.getState().updateArc(a.id, { description: '保存在原作品' }, a.scope)
    await started; await useStoryArcStore.getState().loadAll(b.scope); release(); await pending
    expect((await db.storyArcs.get(a.id))?.description).toBe('保存在原作品')
    expect(useStoryArcStore.getState().arcs.map(row => row.id)).toEqual([b.id])
    expect((await db.storyArcs.get(b.id))?.description).toBe('原作者描述')
    useStoryArcStore.getState().setActiveArc(a.id)
    expect(useStoryArcStore.getState().activeArcId).toBe(b.id)
  })

  it('登记上下文不按固定条数或字段长度丢掉已保存作者内容', async () => {
    const f = await fixture(); const description = 'x'.repeat(170) + '描述尾标'
    const stages = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, title: i === 6 ? '第七阶段尾标' : '阶段', description: 'd', keyEvents: i === 0 ? ['a', 'b', 'c', 'd', 'e', '第六事件尾标'] : [] }))
    await db.storyArcs.update(f.id, { description, stages: JSON.stringify(stages) })
    for (let i = 0; i < 8; i++) await db.storyArcs.add(stampNewRecord(f.scope, 'storyArcs', { projectId: f.scope.projectId, name: i === 7 ? '第九故事线尾标' : `线${i}`, type: 'sub', stages: JSON.stringify([{ ...stage, id: `extra${i}`, title: 't', description: 'd', keyEvents: [] }]), createdAt: 2 + i, updatedAt: 2 + i }, { owner: 'work' }))
    const result = await assembleContext({ projectId: f.scope.projectId, scope: f.scope, sourceKeys: ['storyArcs'], inputBudgetTokens: 12000 })
    for (const text of ['描述尾标', '第七阶段尾标', '第六事件尾标', '第九故事线尾标']) expect(result.text).toContain(text)
  })

  it('损坏阶段不能静默变成空上下文，正式原文不改写', async () => {
    const f = await fixture(); await db.storyArcs.update(f.id, { stages: '[{"id":"坏阶段","keyEvents":null}]' })
    const before = await db.storyArcs.get(f.id)
    await expect(assembleContext({ projectId: f.scope.projectId, scope: f.scope, sourceKeys: ['storyArcs'], inputBudgetTokens: 12000 })).rejects.toThrow('故事阶段')
    expect(await db.storyArcs.get(f.id)).toEqual(before)
  })

  it('仅写了总体描述的故事线仍进入登记上下文', async () => {
    const f = await fixture(); await db.storyArcs.update(f.id, { stages: '[]', description: '未拆阶段时也必须先实测路标' })
    const context = await assembleContext({ projectId: f.scope.projectId, scope: f.scope, sourceKeys: ['storyArcs'], inputBudgetTokens: 12000 })
    expect(context.text).toContain('未拆阶段时也必须先实测路标')
  })

  it('新建拒绝外作品标记和不存在的世界分组', async () => {
    const f = await fixture(); const base = { projectId: f.scope.projectId, name: '不能错投', type: 'sub' as const, stages: '[]' }
    await expect(useStoryArcStore.getState().addArc({ ...base, workId: f.scope.workId + 100 }, f.scope)).rejects.toThrow('不属于')
    await expect(useStoryArcStore.getState().addArc({ ...base, worldGroupId: 999999 }, f.scope)).rejects.toThrow('世界分组')
    expect(await db.storyArcs.count()).toBe(1)
  })
})
