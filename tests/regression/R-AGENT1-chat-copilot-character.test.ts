import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CharacterCopilotStaleError,
  createCharacterCopilotNode,
  parseCharacterCandidateDraft,
  prepareCharacterCopilot,
  type CharacterCopilotCandidate,
  type CharacterCopilotInput,
} from '../../src/lib/agent/character-copilot'
import { CHARACTER_DIMENSIONS } from '../../src/lib/character/character-dimensions'
import { db } from '../../src/lib/db/schema'
import {
  adoptGenerationNodeOutput,
  prepareGenerationNode,
  runGenerationNode,
} from '../../src/lib/generation/generation-node'
import type { Character } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'

function candidate(patch: Partial<CharacterCopilotCandidate> = {}): CharacterCopilotCandidate {
  return {
    name: '沈灯',
    roleWeight: 'secondary',
    moralAxis: 'good',
    orderAxis: 'lawful',
    relationships: '曾受主角搭救，却隐瞒潮汐钟的真相。',
    ...Object.fromEntries(CHARACTER_DIMENSIONS.map(dimension => [dimension.key, ''])),
    shortDescription: '守护旧港灯塔的年轻钟匠。',
    personality: '克制谨慎，不轻易许诺。',
    background: '出身旧港钟匠世家。',
    motivation: '修复失踪的潮汐钟。',
    ...patch,
  } as CharacterCopilotCandidate
}

async function addProject(enableMultiWorld = false): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: enableMultiWorld ? '群界灯塔' : '潮汐纪元',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    enableMultiWorld,
    createdAt: now,
    updatedAt: now,
  }) as number
}

async function addCharacter(
  projectId: number,
  name: string,
  homeWorldGroupId: number | null,
  patch: Partial<Character> = {},
): Promise<number> {
  const now = Date.now()
  return await db.characters.add({
    projectId,
    name,
    role: 'protagonist',
    roleWeight: 'main',
    moralAxis: 'good',
    orderAxis: 'lawful',
    shortDescription: `${name}的角色简介`,
    appearance: '',
    personality: '',
    background: '',
    motivation: '',
    abilities: '',
    relationships: '',
    arc: '',
    homeWorldGroupId,
    isCrossWorld: false,
    createdAt: now,
    updatedAt: now,
    ...patch,
  }) as number
}

function nodeInput(
  projectId: number,
  patch: Partial<CharacterCopilotInput> = {},
): CharacterCopilotInput {
  return {
    projectId,
    projectName: '潮汐纪元',
    genres: 'fantasy',
    worldGroupId: null,
    authorRequest: '设计一名守灯钟匠',
    worldContext: '【世界观】盐海每十年退潮一次。',
    characterContext: '【角色档案】陆潮（主要）',
    contextSources: ['worldview', 'characters'],
    snapshot: { serialized: '[]', visibleNames: [] },
    config: useAIConfigStore.getState().config,
    ...patch,
  }
}

describe('AGENT-1 27.1-d · ChatCopilot 角色生成闭环', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('prepare 只经正式工具读取当前世界可见角色，并冻结零写入名单快照', async () => {
    const projectId = await addProject(true)
    const now = Date.now()
    const worldA = await db.worldGroups.add({
      projectId,
      name: '盐海界',
      type: 'primary',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }) as number
    const worldB = await db.worldGroups.add({
      projectId,
      name: '雾港界',
      type: 'parallel',
      order: 1,
      createdAt: now,
      updatedAt: now,
    }) as number
    await db.worldviews.add({
      projectId,
      worldGroupId: worldA,
      worldOrigin: '盐海退潮后，第一座灯塔城从海床升起。',
      createdAt: now,
      updatedAt: now,
    } as never)
    await addCharacter(projectId, '陆潮', worldA)
    await addCharacter(projectId, '雾隐', worldB)
    await addCharacter(projectId, '界行者', null, { isCrossWorld: true })
    const before = await db.characters.count()

    const prepared = await prepareCharacterCopilot({
      projectId,
      worldGroupId: worldA,
      authorRequest: '设计一名守灯钟匠',
    })
    const prompt = prepared.prepared.messages.map(message => message.content).join('\n')

    expect(prepared.contextSources).toContain('worldview')
    expect(prepared.contextSources).toContain('characters')
    expect(prepared.contextEvidence.inputState).toMatchObject({
      state: 'partial',
      handling: 'reference-and-create',
    })
    expect(prompt).toContain('partial / reference-and-create')
    expect(prompt).toContain('盐海退潮后')
    expect(prompt).toContain('陆潮')
    expect(prompt).toContain('界行者')
    expect(prompt).not.toContain('雾隐')
    expect(prompt).toContain('"roleWeight": "main | secondary | npc | extra"')
    expect(await db.characters.count()).toBe(before)
  })

  it('生成只产出内存候选，确认作者眼前 JSON 后恰好新增一条且不二次调用模型', async () => {
    const projectId = await addProject()
    const output = candidate()
    const runAI = vi.fn(async () => JSON.stringify(output))
    const input = nodeInput(projectId)
    const node = createCharacterCopilotNode(input, { runAI })
    const prepared = prepareGenerationNode(node, input)
    const generated = await runGenerationNode(node, prepared)

    expect(generated.gate?.status).toBe('pass')
    expect(runAI).toHaveBeenCalledOnce()
    expect(await db.characters.count()).toBe(0)

    const edited = { ...generated.output, name: '沈砚灯', shortDescription: '作者确认的守灯钟匠。' }
    const adopted = await adoptGenerationNodeOutput(node, edited)

    expect(adopted.adopted).toBe(true)
    expect(runAI).toHaveBeenCalledOnce()
    const rows = await db.characters.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      projectId,
      name: '沈砚灯',
      shortDescription: '作者确认的守灯钟匠。',
      roleWeight: 'secondary',
      moralAxis: 'good',
      orderAxis: 'lawful',
      role: 'minor',
      homeWorldGroupId: null,
      isCrossWorld: false,
    })
  })

  it('未知字段、非法枚举、空简介和不完整 JSON 在写入前阻断', () => {
    expect(() => parseCharacterCandidateDraft(JSON.stringify({
      ...candidate(),
      projectId: 999,
    }))).toThrow('不允许的字段')
    expect(() => parseCharacterCandidateDraft(JSON.stringify({
      ...candidate(),
      roleWeight: 'hero',
    }))).toThrow('roleWeight')
    expect(() => parseCharacterCandidateDraft(JSON.stringify({
      ...candidate(),
      shortDescription: '',
    }))).toThrow('shortDescription')
    expect(() => parseCharacterCandidateDraft('{"name":"未完成"')).toThrow('完整')
  })

  it('当前世界可见同名角色在 gate 和确认前均被阻断，不触发 merge 覆盖', async () => {
    const projectId = await addProject()
    await addCharacter(projectId, '沈灯', null)
    const existing = (await db.characters.toArray())[0]
    const snapshot = {
      serialized: JSON.stringify([{
        id: existing.id!,
        updatedAt: existing.updatedAt,
        name: existing.name,
        homeWorldGroupId: null,
        isCrossWorld: false,
      }]),
      visibleNames: ['沈灯'.normalize('NFKC').toLocaleLowerCase('zh-CN')],
    }
    const saveCharacter = vi.fn()
    const input = nodeInput(projectId, { snapshot })
    const node = createCharacterCopilotNode(input, {
      readCurrent: async () => snapshot,
      saveCharacter,
    })

    const result = await adoptGenerationNodeOutput(node, candidate({ name: '沈灯' }))
    expect(result.adopted).toBe(false)
    expect(result.gate?.issues.map(issue => issue.code)).toContain('character-duplicate-name')
    expect(saveCharacter).not.toHaveBeenCalled()
    expect(await db.characters.count()).toBe(1)
  })

  it('角色名单在生成后变化会作废旧候选', async () => {
    const projectId = await addProject()
    const saveCharacter = vi.fn()
    const node = createCharacterCopilotNode(nodeInput(projectId), {
      readCurrent: async () => ({ serialized: '[changed]', visibleNames: [] }),
      saveCharacter,
    })

    await expect(adoptGenerationNodeOutput(node, candidate()))
      .rejects.toBeInstanceOf(CharacterCopilotStaleError)
    expect(saveCharacter).not.toHaveBeenCalled()
  })

  it('多世界项目必须选择世界，确认后只盖当前世界归属', async () => {
    const projectId = await addProject(true)
    await expect(prepareCharacterCopilot({
      projectId,
      worldGroupId: null,
      authorRequest: '生成角色',
    })).rejects.toThrow('必须先选择一个世界')

    const now = Date.now()
    const worldId = await db.worldGroups.add({
      projectId,
      name: '盐海界',
      type: 'primary',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }) as number
    const input = nodeInput(projectId, { worldGroupId: worldId })
    const node = createCharacterCopilotNode(input)
    const adopted = await adoptGenerationNodeOutput(node, candidate({ name: '盐灯' }))

    expect(adopted.adopted).toBe(true)
    expect((await db.characters.toArray())[0]).toMatchObject({
      name: '盐灯',
      homeWorldGroupId: worldId,
      isCrossWorld: false,
    })
  })
})
