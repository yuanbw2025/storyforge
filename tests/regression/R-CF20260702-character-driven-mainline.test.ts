import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { prepareCharacterDrivenCopilotV1 } from '../../src/lib/agent/character-driven-copilot'

const textOf = (messages: { content: string }[]) => messages.map(m => m.content).join('\n\n')

afterEach(async () => {
  await db.delete()
  await db.open()
})

describe('R-CF20260702-character-driven-mainline', () => {
  it('角色驱动剧情 prompt 通过注册表上下文注入故事核心全字段与主线对齐约束', async () => {
    const projectId = await db.projects.add({
      name: '测试书',
      genre: '玄幻',
      genres: ['xuanhuan'],
      status: 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    await db.storyCores.add({
      projectId,
      logline: '废柴少年被迫继承天命。',
      theme: '自我选择',
      centralConflict: '天命与自由意志冲突',
      plotPattern: '升级流',
      mainPlot: '少年拒绝被天命操控，联合旧敌推翻天命祭坛。',
      subPlots: '师徒裂痕与家族旧案。',
    } as any)
    const characterId = await db.characters.add({
      projectId,
      name: '林砚',
      role: 'protagonist',
      roleWeight: 'main',
      moralAxis: 'good',
      orderAxis: 'neutral',
      relationships: '[]',
      createdAt: 1,
      updatedAt: 1,
    } as any) as number
    const planId = await db.characterDrivenPlans.add({
      projectId,
      name: '天命弧光',
      arcs: JSON.stringify([{
        characterId,
        name: '林砚',
        role: '主角',
        initialState: '相信天命安排。',
        targetState: '主动选择自己的道路。',
      }]),
      userHint: '',
      generatedVolumes: '[]',
      status: 'draft',
      version: 1,
      parentPlanId: null,
      createdAt: 1,
      updatedAt: 1,
    } as any) as number

    const prepared = await prepareCharacterDrivenCopilotV1({
      projectId,
      worldGroupId: null,
      planId,
      authorRequest: '依据角色弧光编排卷章方案',
    })
    const text = textOf(prepared.prepared.messages)
    expect(text).toContain('一句话故事：废柴少年被迫继承天命。')
    expect(text).toContain('主线：少年拒绝被天命操控')
    expect(text).toContain('复线：师徒裂痕与家族旧案。')
    expect(text).toContain('角色驱动编排硬约束')
    expect(text).toContain('不得另起主线')
    expect(text).toContain('arcProgress')
    expect(text).toContain('不得让角色预知后续安排')
    expect(text).toContain('简体中文')
  })
})
