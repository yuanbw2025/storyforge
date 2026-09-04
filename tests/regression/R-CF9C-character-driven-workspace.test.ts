import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCharacterDrivenPlanStore } from '../../src/stores/character-driven-plan'
import { useCharacterStore } from '../../src/stores/character'
import {
  parseCharacterDrivenPlanArcs,
  parseCharacterDrivenPlotVolumes,
} from '../../src/lib/types'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { adoptCharacterDrivenVolumes } from '../../src/lib/story-planning/character-driven-adoption'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentProject } from '../helpers/current-workspace'

async function seedProject() {
  return await seedCurrentProject({
    name: '角色驱动测试',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    createdAt: 1,
    updatedAt: 1,
  })
}

const generated = [{
  volumeTitle: '第一卷 归乡',
  volumeSummary: '主角回到故乡并直面旧案。',
  characterArcs: '林舟从逃避转向承担。',
  chapters: [{
    title: '第一章 故人',
    summary: '林舟遇见昔日同伴。',
    keyCharacters: ['林舟'],
    arcProgress: '林舟第一次承认自己仍在意故乡。',
  }],
}]

describe('R-CF9C · 持久化角色驱动工作区', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useCharacterDrivenPlanStore.setState({
      plans: [],
      currentPlanId: null,
      activePlanId: null,
      loading: false,
    })
    useCharacterStore.setState({ characters: [], loading: false })
  })

  afterEach(async () => {
    db.close()
  })

  it('只读取当前 JSON 与当前字段，不再接受旧别名或损坏数据', () => {
    expect(() => parseCharacterDrivenPlanArcs('{broken')).toThrow('不是有效的当前 JSON 数组')
    expect(() => parseCharacterDrivenPlanArcs(JSON.stringify([{
      characterId: null,
      name: '林舟',
      role: '主角',
      initialState: '逃避',
      targetState: '承担',
      characterRole: '旧字段',
    }]))).toThrow('包含非当前字段')
    expect(() => parseCharacterDrivenPlotVolumes(JSON.stringify([{
      title: '旧卷名',
      summary: '旧摘要',
      characterArcs: '旧弧光',
      chapters: [],
    }]))).toThrow('缺少当前字段')
  })

  it('CRUD、版本复制、生成结果和 active 方案均持久化', async () => {
    const projectId = await seedProject()
    const characterId = await db.characters.add({
      projectId,
      name: '林舟',
      roleWeight: 'main',
      moralAxis: 'good',
      orderAxis: 'neutral',
      createdAt: 1,
      updatedAt: 1,
    } as any)
    await finalizeCurrentFixtureV1(projectId)
    const store = useCharacterDrivenPlanStore.getState()
    const planId = await store.createPlan(projectId, '归乡方案')
    await useCharacterDrivenPlanStore.getState().saveInputs(planId, {
      arcs: [{
        characterId,
        name: '林舟',
        role: '主角',
        initialState: '逃避过去',
        targetState: '承担责任',
      }],
      userHint: '主线不可改写',
    })
    await useCharacterDrivenPlanStore.getState().saveGenerated(planId, generated)
    await useCharacterDrivenPlanStore.getState().setActivePlan(projectId, planId)
    const copyId = await useCharacterDrivenPlanStore.getState().copyAsNewVersion(planId)

    const source = await db.characterDrivenPlans.get(planId)
    const copy = await db.characterDrivenPlans.get(copyId)
    expect(source?.status).toBe('generated')
    expect(parseCharacterDrivenPlotVolumes(source?.generatedVolumes)).toEqual(generated)
    expect(copy).toMatchObject({
      parentPlanId: planId,
      version: 2,
      status: 'generated',
    })
    const activeWorkId = (await db.projects.get(projectId))?.activeWorkId
    expect((await db.works.get(activeWorkId!))?.activeCharacterDrivenPlanId).toBe(planId)

    await useCharacterDrivenPlanStore.getState().deletePlan(planId)
    expect(await db.characterDrivenPlans.get(planId)).toBeUndefined()
    expect((await db.characterDrivenPlans.get(copyId))?.parentPlanId).toBeNull()
    expect((await db.works.get(activeWorkId!))?.activeCharacterDrivenPlanId).toBeNull()
  })

  it('连续输入保存按调用顺序落库，后发完整快照不会被较早 blur 覆盖', async () => {
    const projectId = await seedProject()
    const characterId = await db.characters.add({
      projectId,
      name: '林舟',
      roleWeight: 'main',
      moralAxis: 'good',
      orderAxis: 'neutral',
      createdAt: 1,
      updatedAt: 1,
    } as any)
    await finalizeCurrentFixtureV1(projectId)
    const planId = await useCharacterDrivenPlanStore.getState().createPlan(projectId, '连续保存方案')
    const earlier = useCharacterDrivenPlanStore.getState().saveInputs(planId, {
      arcs: [{
        characterId, name: '林舟', role: '主角',
        initialState: '旧起点', targetState: '旧终点',
      }],
      userHint: '旧要求',
    })
    const latest = useCharacterDrivenPlanStore.getState().saveInputs(planId, {
      arcs: [{
        characterId, name: '林舟', role: '主角',
        initialState: '当前方案起点', targetState: '当前方案终点',
      }],
      userHint: '当前方案要求',
    })
    await Promise.all([earlier, latest])

    const stored = await db.characterDrivenPlans.get(planId)
    expect(parseCharacterDrivenPlanArcs(stored?.arcs)[0]).toMatchObject({
      initialState: '当前方案起点',
      targetState: '当前方案终点',
    })
    expect(stored?.userHint).toBe('当前方案要求')
  })

  it('只读取显式 active 方案；改名用当前名+快照提示，删除角色后保留方案快照', async () => {
    const projectId = await seedProject()
    const characterId = await db.characters.add({
      projectId,
      name: '林舟（新名）',
      roleWeight: 'main',
      moralAxis: 'good',
      orderAxis: 'neutral',
      createdAt: 1,
      updatedAt: 1,
    } as any)
    await finalizeCurrentFixtureV1(projectId)
    const planId = await useCharacterDrivenPlanStore.getState().createPlan(projectId, '归乡方案')
    await useCharacterDrivenPlanStore.getState().saveInputs(planId, {
      arcs: [{
        characterId,
        name: '林舟',
        role: '主角',
        initialState: '逃避',
        targetState: '承担',
      }],
      userHint: '',
    })

    const inactive = await assembleContext({
      projectId,
      sourceKeys: ['characterDrivenPlan'],
    })
    expect(inactive.text).toBe('')

    await useCharacterDrivenPlanStore.getState().setActivePlan(projectId, planId)
    const renamed = await assembleContext({
      projectId,
      sourceKeys: ['characterDrivenPlan'],
    })
    expect(renamed.text).toContain('林舟（新名）')
    expect(renamed.text).toContain('方案快照名：林舟')

    await useCharacterStore.getState().deleteCharacter(characterId)
    // 面板若仍持有删除前的本地 arc，store 写入边界也不能复活悬空 ID。
    await useCharacterDrivenPlanStore.getState().saveInputs(planId, {
      arcs: [{
        characterId,
        name: '林舟',
        role: '主角',
        initialState: '逃避',
        targetState: '承担',
      }],
      userHint: '',
    })
    const stored = await db.characterDrivenPlans.get(planId)
    expect(parseCharacterDrivenPlanArcs(stored?.arcs)[0]).toMatchObject({
      characterId: null,
      name: '林舟',
    })
    const deleted = await assembleContext({
      projectId,
      sourceKeys: ['characterDrivenPlan'],
    })
    expect(deleted.text).toContain('原角色已删除，仅保留方案快照')
  })

  it('采纳只新增大纲节点，不改 storyCore 或既有正文，并且重复采纳幂等', async () => {
    const projectId = await seedProject()
    const storyCoreId = await db.storyCores.add({
      projectId,
      mainPlot: '不可覆盖的主线',
      createdAt: 1,
      updatedAt: 1,
    } as any)
    const existingNodeId = await db.outlineNodes.add({
      projectId,
      parentId: null,
      type: 'volume',
      title: '既有卷',
      summary: '既有摘要',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    } as any)
    const chapterId = await db.chapters.add({
      projectId,
      outlineNodeId: existingNodeId,
      title: '已有正文',
      content: '<p>不能修改</p>',
      wordCount: 4,
      status: 'draft',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    } as any)
    await finalizeCurrentFixtureV1(projectId)

    const first = await adoptCharacterDrivenVolumes({ projectId, volumes: generated })
    const second = await adoptCharacterDrivenVolumes({ projectId, volumes: generated })
    expect(first.volumeIds).toHaveLength(1)
    expect(first.chapterIds).toHaveLength(1)
    expect(second.volumeIds).toEqual(first.volumeIds)
    expect(second.chapterIds).toHaveLength(0)
    expect(await db.outlineNodes.where('projectId').equals(projectId).count()).toBe(3)
    expect((await db.storyCores.get(storyCoreId))?.mainPlot).toBe('不可覆盖的主线')
    expect((await db.chapters.get(chapterId))?.content).toBe('<p>不能修改</p>')
  })
})
