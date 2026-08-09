import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adoptRestoredCharacterSupplementCandidateV1,
  characterSupplementCandidateMatchesBusinessStateV1,
  parseCharacterSupplementCandidateDraftV1,
  parseCharacterSupplementTaskInputV1,
  prepareCharacterSupplementCopilotV1,
  serializeCharacterSupplementCandidateV1,
  type CharacterSupplementCandidateV1,
  type CharacterSupplementTaskInputV1,
} from '../../src/lib/agent/character-supplement-copilot'
import { runGenerationNode } from '../../src/lib/generation/generation-node'
import {
  createMasterAgentPlan,
  type PinnedMasterAgentTaskV1,
} from '../../src/lib/agent/orchestrator'
import {
  parseMasterAgentPlanV1,
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import type { WorkspaceScope } from '../../src/lib/types'

const now = 1_910_000_000_000

function request(characterId: number, useEvidence = false): CharacterSupplementTaskInputV1 {
  return {
    characterId,
    dimensions: ['personality', 'goals'],
    useEvidence,
  }
}

function candidate(): CharacterSupplementCandidateV1 {
  return {
    version: 1,
    patch: {
      personality: '谨慎寡言，但对承诺近乎固执。',
      goals: '短期守住潮门，长期查清旧港沉没的真相。',
    },
  }
}

async function seedWorkspace() {
  const projectId = await db.projects.add({
    name: '角色补全作品',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    enableMultiWorld: false,
    worldCode: 'harness38-world',
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'harness38-world',
    name: '潮门世界',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '潮门纪事',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const scope: WorkspaceScope = { projectId, worldId, workId }
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  await db.worldviews.add({
    projectId,
    worldId,
    worldGroupId: null,
    worldOrigin: '潮门每逢月蚀开启，守门人不得离岗。',
    createdAt: now,
    updatedAt: now,
  } as any)
  await db.storyCores.add({
    projectId,
    workId,
    mainPlot: '查清旧港沉没与潮门契约的关系。',
    createdAt: now,
    updatedAt: now,
  } as any)
  const characterId = await db.characters.add({
    projectId,
    worldId,
    homeWorldGroupId: null,
    isCrossWorld: false,
    name: '青禾',
    role: 'npc',
    roleWeight: 'npc',
    moralAxis: 'good',
    orderAxis: 'lawful',
    shortDescription: '潮门守门人',
    appearance: '总披着盐霜斗篷。',
    personality: '',
    background: '幼年经历旧港沉没。',
    motivation: '不愿悲剧重演。',
    abilities: '能辨认潮声中的暗号。',
    relationships: '',
    arc: '',
    goals: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return { projectId, worldId, workId, scope, characterId }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  db.close()
})

describe('R-HARNESS38 · 已有角色补全领域契约', () => {
  it('固定任务和候选都是严格闭集，拒绝重复维度、缺失字段与额外字段', () => {
    expect(parseCharacterSupplementTaskInputV1({
      characterId: 7,
      dimensions: ['goals', 'personality'],
      useEvidence: false,
    }).dimensions).toEqual(['personality', 'goals'])
    expect(() => parseCharacterSupplementTaskInputV1({
      characterId: 7,
      dimensions: ['goals', 'goals'],
      useEvidence: false,
    })).toThrow('不得重复')
    expect(() => parseCharacterSupplementCandidateDraftV1(JSON.stringify({
      version: 1,
      patch: { personality: '谨慎' },
    }), request(7))).toThrow('缺少字段')
    expect(() => parseCharacterSupplementCandidateDraftV1(JSON.stringify({
      version: 1,
      patch: { personality: '谨慎', goals: '守门', background: '越权内容' },
    }), request(7))).toThrow('不允许的字段')
    expect(() => parseCharacterSupplementCandidateDraftV1(JSON.stringify({
      version: 1,
      patch: { personality: '谨慎', goals: '守门' },
      relationships: '越权关系',
    }), request(7))).toThrow('不允许的字段')
  })

  it('反向哺喂开关精确控制事实与正文来源，模型完成后仍不写正式角色', async () => {
    const seeded = await seedWorkspace()
    const prepared = await prepareCharacterSupplementCopilotV1({
      projectId: seeded.projectId,
      scope: seeded.scope,
      worldGroupId: null,
      request: request(seeded.characterId, false),
      authorRequest: '补全性格与目标',
      configOverride: useAIConfigStore.getState().config,
    }, {
      runAI: async messages => {
        const prompt = messages.map(message => message.content).join('\n')
        expect(prompt).toContain('潮门守门人')
        expect(prompt).toContain('潮门每逢月蚀开启')
        expect(prompt).toContain('未启用反向哺喂')
        return JSON.stringify(candidate())
      },
    })
    expect(prepared.contextEvidence.sourceEvidence?.every(source => source.sourceHash)).toBe(true)
    expect(prepared.contextEvidence.sourceEvidence?.map(source => source.key)).not.toContain('characterFacts')
    expect(prepared.contextEvidence.sourceEvidence?.map(source => source.key)).not.toContain('characterPassages')

    const generated = await runGenerationNode(prepared.node, prepared.prepared)
    expect(generated.output).toEqual(candidate())
    const unchanged = await db.characters.get(seeded.characterId)
    expect(unchanged?.personality).toBe('')
    expect(unchanged?.goals).toBe('')

    const evidencePrepared = await prepareCharacterSupplementCopilotV1({
      projectId: seeded.projectId,
      scope: seeded.scope,
      worldGroupId: null,
      request: request(seeded.characterId, true),
      authorRequest: '结合已写剧情补全性格与目标',
      configOverride: useAIConfigStore.getState().config,
    })
    expect(evidencePrepared.contextEvidence.sourceEvidence?.map(source => source.key))
      .toEqual(expect.arrayContaining(['characterFacts', 'characterPassages']))
  })

  it('任一已读取来源变化都会使旧候选过期，且不会发生业务写入', async () => {
    const seeded = await seedWorkspace()
    const prepared = await prepareCharacterSupplementCopilotV1({
      projectId: seeded.projectId,
      scope: seeded.scope,
      worldGroupId: null,
      request: request(seeded.characterId),
      authorRequest: '补全性格与目标',
      configOverride: useAIConfigStore.getState().config,
    })
    const worldview = (await db.worldviews.where('projectId').equals(seeded.projectId).first())!
    await db.worldviews.update(worldview.id!, {
      worldOrigin: '潮门规则已经被作者修改。',
      updatedAt: now + 1,
    })

    await expect(adoptRestoredCharacterSupplementCandidateV1({
      projectId: seeded.projectId,
      scope: seeded.scope,
      worldGroupId: null,
      snapshot: prepared.snapshot,
      draft: serializeCharacterSupplementCandidateV1(candidate(), request(seeded.characterId)),
    })).rejects.toThrow('已经变化')
    const unchanged = await db.characters.get(seeded.characterId)
    expect(unchanged?.personality).toBe('')
    expect(unchanged?.goals).toBe('')
  })

  it('确认采纳只经 merge-diffs 更新所选维度，并可精确核对正式终态', async () => {
    const seeded = await seedWorkspace()
    const supplementRequest = request(seeded.characterId)
    const prepared = await prepareCharacterSupplementCopilotV1({
      projectId: seeded.projectId,
      scope: seeded.scope,
      worldGroupId: null,
      request: supplementRequest,
      authorRequest: '补全性格与目标',
      configOverride: useAIConfigStore.getState().config,
    })
    const draft = serializeCharacterSupplementCandidateV1(candidate(), supplementRequest)
    await adoptRestoredCharacterSupplementCandidateV1({
      projectId: seeded.projectId,
      scope: seeded.scope,
      worldGroupId: null,
      snapshot: prepared.snapshot,
      draft,
    })
    const character = await db.characters.get(seeded.characterId)
    expect(character?.personality).toBe(candidate().patch.personality)
    expect(character?.goals).toBe(candidate().patch.goals)
    expect(character?.background).toBe('幼年经历旧港沉没。')
    expect(character?.relationships).toBe('')
    expect(await characterSupplementCandidateMatchesBusinessStateV1({
      scope: seeded.scope,
      snapshot: prepared.snapshot,
      draft,
    })).toBe(true)
  })

  it('durable 主路径刷新恢复不重复调用模型，确认后才写入并签发终态回执', async () => {
    const seeded = await seedWorkspace()
    const supplementRequest = request(seeded.characterId, false)
    const pinnedTask: PinnedMasterAgentTaskV1 = {
      id: 'character-supplement-targeted',
      agentId: 'character',
      skillId: 'character.supplement',
      instruction: '只补全青禾的性格与目标。',
      characterSupplementRequest: supplementRequest,
    }
    const plan = await createMasterAgentPlan({
      projectId: seeded.projectId,
      scope: seeded.scope,
      worldGroupId: null,
      request: '补全角色青禾的性格与目标',
      pinnedTask,
    })
    expect(parseMasterAgentPlanV1(plan).tasks[0].characterSupplementRequest).toEqual(supplementRequest)
    await expect(createMasterAgentPlan({
      projectId: seeded.projectId,
      scope: seeded.scope,
      worldGroupId: null,
      request: '错误固定任务',
      pinnedTask: {
        agentId: 'character',
        skillId: 'character.create',
        instruction: '错误固定任务',
        characterSupplementRequest: supplementRequest,
      },
    })).rejects.toThrow('只有角色补全 Skill')

    const conversation = await getOrCreateAgentConversation({
      projectId: seeded.projectId,
      worldGroupId: null,
      scope: seeded.scope,
    })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> }
      const prompt = body.messages?.map(message => message.content ?? '').join('\n') ?? ''
      expect(prompt).toContain('只允许补全的字段')
      expect(prompt).toContain('personality（性格）')
      expect(prompt).toContain('goals（目标(短/长期)）')
      expect(prompt).toContain('未启用反向哺喂')
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(candidate()) } }],
        usage: { prompt_tokens: 220, completion_tokens: 90, total_tokens: 310 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const first = await runDurableMasterAgentPlanV1({
      scope: seeded.scope,
      worldGroupId: null,
      conversationId: conversation.id!,
      plan,
      budget: new AgentTeamBudgetTracker('balanced'),
    })
    expect(first.candidates).toHaveLength(1)
    expect(first.candidates[0].payload.skillId).toBe('character.supplement')
    expect(first.candidates[0].payload.characterSupplementRequest).toEqual(supplementRequest)
    expect((await db.characters.get(seeded.characterId))?.personality).toBe('')

    const resumed = await restoreMasterAgentCandidatesV1({
      scope: seeded.scope,
      runId: first.runId,
    })
    expect(resumed.candidates).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await commitMasterAgentCandidateAdoptionV1({
      scope: seeded.scope,
      runId: first.runId,
      candidateEventId: resumed.candidates[0].event.id!,
      worldGroupId: null,
    })
    const verification = await verifyMasterAgentRunV1({ scope: seeded.scope, runId: first.runId })
    expect(verification.accepted).toBe(true)
    expect(verification.receipt?.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect((await db.characters.get(seeded.characterId))?.personality).toBe(candidate().patch.personality)
    expect((await db.characters.get(seeded.characterId))?.background).toBe('幼年经历旧港沉没。')
  })
})
