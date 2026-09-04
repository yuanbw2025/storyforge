import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adoptRestoredCharacterLifecycleCandidateV1,
  parseCharacterLifecycleTaskInputV1,
  prepareCharacterLifecycleCopilotV1,
  serializeCharacterLifecycleCandidateV1,
  type CharacterLifecycleCandidateV1,
} from '../../src/lib/agent/character-lifecycle-copilot'
import { prepareCharacterSupplementCopilotV1 } from '../../src/lib/agent/character-supplement-copilot'
import { createMasterAgentPlan, type PinnedMasterAgentTaskV1 } from '../../src/lib/agent/orchestrator'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import {
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { db } from '../../src/lib/db/schema'
import { REGISTRY_BY_NAME } from '../../src/lib/registry/project-tables'
import type { WorkspaceScope } from '../../src/lib/types'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const now = 1_920_000_000_000

async function seed(): Promise<{
  projectId: number
  scope: WorkspaceScope
  worldA: number
  worldB: number
  characterId: number
  otherCharacterId: number
  chapterId: number
  storyArcId: number
}> {
  const created = await seedCurrentWorkspace('角色关系网', { enableMultiWorld: true })
  const { scope } = created
  const { projectId } = scope
  const worldA = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId, name: '潮灯界', type: 'primary', order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never) as number
  const worldB = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId, name: '镜潮界', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never) as number
  const categoryId = await db.codexCategories.add(stampNewRecord(scope, 'codexCategories', {
    projectId, domain: 'humanity', parentId: null, name: '种族与民族', builtInKey: 'race',
    fieldSchema: '[]', hidden: false, order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never) as number
  const raceEntryId = await db.codexEntries.add(stampNewRecord(scope, 'codexEntries', {
    projectId, worldGroupId: worldA, categoryId, name: '潮裔', summary: '能从潮声辨认誓言。',
    description: '', fields: '{}', refs: '{}', tags: '[]', order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never) as number
  const cultivationSystemId = await db.cultivationSystems.add(stampNewRecord(scope, 'cultivationSystems', {
    projectId, worldGroupId: worldA, name: '听潮法', description: '借潮音修炼。', stages: '[]',
    createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never) as number
  const powerSystemId = await db.powerSystems.add(stampNewRecord(scope, 'powerSystems', {
    projectId, worldGroupId: worldA, name: '潮印', description: '誓言会留下可见印记。',
    levels: '初印、重印', rules: '背誓者失去潮印。', createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never) as number
  const locationId = await db.importantLocations.add(stampNewRecord(scope, 'importantLocations', {
    projectId, name: '旧潮门', tags: '[]', description: '连接海床与灯塔城。',
    significance: '主角守门之地', parentId: null, sortOrder: 0, createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never) as number
  const characterId = await db.characters.add(stampNewRecord(scope, 'characters', {
    projectId, homeWorldGroupId: worldA, isCrossWorld: false, name: '青禾',
    roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful', shortDescription: '潮门守人',
    appearance: '', personality: '', background: '幼年目睹旧港沉没。', motivation: '阻止潮灾重演。',
    abilities: '能听懂潮声。', relationships: '', arc: '', goals: '', narrativeStatus: 'active',
    raceEntryId, cultivationSystemId, powerSystemId, importantLocationId: locationId,
    createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never) as number
  const otherCharacterId = await db.characters.add(stampNewRecord(scope, 'characters', {
    projectId, homeWorldGroupId: worldA, isCrossWorld: false, name: '闻钟',
    roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'chaotic', shortDescription: '青禾的失踪导师',
    appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '', arc: '',
    createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never) as number
  await db.characters.add(stampNewRecord(scope, 'characters', {
    projectId, homeWorldGroupId: worldB, isCrossWorld: false, name: '青禾',
    roleWeight: 'main', moralAxis: 'evil', orderAxis: 'lawful', shortDescription: '另一个世界的同名角色',
    appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '', arc: '',
    createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never)
  await db.characterRelations.add(stampNewRecord(scope, 'characterRelations', {
    projectId, fromCharacterId: characterId, toCharacterId: otherCharacterId,
    relationType: 'mentor', description: '失踪导师', strength: 8, isMutual: false,
    createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never)
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId, worldGroupId: worldA, parentId: null, type: 'chapter', title: '潮门断响',
    summary: '青禾为封闭潮门而受伤。', order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId, outlineNodeId, title: '潮门断响', content: '<p>青禾封住潮门后昏迷，无法继续守门。</p>',
    wordCount: 21, status: 'final', order: 0, notes: '', createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const storyArcId = await db.storyArcs.add(stampNewRecord(scope, 'storyArcs', {
    projectId, worldGroupId: worldA, name: '守门主线', type: 'main',
    description: '青禾守住潮门并查清导师失踪真相。', stages: '[]', status: 'active',
    origin: 'manual', createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  await db.knowledgeLedger.add(stampNewRecord(scope, 'knowledgeLedger', {
    projectId, worldGroupId: worldA, characterId, characterName: '青禾', knowledgeKey: 'mentor-alive',
    statement: '青禾仍相信导师活着。', action: 'learn', sourceType: 'chapter', sourceChapterId: chapterId,
    status: 'confirmed', createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never)
  return { projectId, scope, worldA, worldB, characterId, otherCharacterId, chapterId, storyArcId }
}

function lifecycleCandidate(characterId: number): CharacterLifecycleCandidateV1 {
  return {
    version: 1,
    characterId,
    fromStatus: 'active',
    targetStatus: 'inactive',
    reason: '青禾在封闭潮门后昏迷，暂时无法继续承担守门职责。',
    ending: '',
    activeChapterRange: '第1章以前',
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  vi.unstubAllGlobals()
  db.close()
})

describe('CHAR-1 · 角色创建、补全、关系检索与状态演化', () => {
  it('Skill 只声明角色写目标，创建与补全都走 required Gateway 且无固定工具大包', () => {
    for (const id of ['character.create', 'character.supplement', 'character.lifecycle'] as const) {
      const skill = getAgentSkillV1(id)
      expect(skill?.readToolNames).toEqual([])
      expect(skill?.contextGateway?.rollout).toBe('required')
      expect(skill?.writeTargets.every(target => target.table === 'characters')).toBe(true)
    }
  })

  it('补全完整读取目标角色，并按关系召回种族、地点、力量、另一角色和认知证据', async () => {
    const fixture = await seed()
    const prepared = await prepareCharacterSupplementCopilotV1({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.worldA,
      request: { characterId: fixture.characterId, dimensions: ['personality', 'goals'], useEvidence: true },
      authorRequest: '结合种族、导师、地点、力量体系和已知信息补全角色。',
    })
    const target = prepared.contextGatewayExecution.retrievalTrace.mandatory.find(item => (
      item.sourceRefs.some(ref => ref.table === 'characters' && ref.recordId === fixture.characterId)
    ))
    expect(target?.depth).toBe('full')
    const tables = new Set(prepared.contextGatewayExecution.contextPacket.sourceRefs.map(ref => ref.table))
    for (const table of [
      'characters', 'characterRelations', 'codexEntries', 'importantLocations',
      'cultivationSystems', 'powerSystems', 'knowledgeLedger',
    ]) expect(tables.has(table)).toBe(true)
    const prompt = prepared.prepared.messages.map(message => message.content).join('\n')
    expect(prompt).toContain('闻钟')
    expect(prompt).not.toContain('另一个世界的同名角色')
  })

  it('未启用正文证据时 policy 真正排除 chapter/fact/foreshadow，启用后恢复授权', async () => {
    const fixture = await seed()
    const withoutEvidence = await prepareCharacterSupplementCopilotV1({
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.worldA,
      request: { characterId: fixture.characterId, dimensions: ['personality'], useEvidence: false },
      authorRequest: '只按设定补全性格。',
    })
    expect(withoutEvidence.contextGatewayExecution.session.policy.allowedResourceKinds).not.toContain('chapter')
    expect(withoutEvidence.contextGatewayExecution.session.policy.allowedResourceKinds).not.toContain('fact')
    const withEvidence = await prepareCharacterSupplementCopilotV1({
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.worldA,
      request: { characterId: fixture.characterId, dimensions: ['personality'], useEvidence: true },
      authorRequest: '结合正文证据补全性格。',
    })
    expect(withEvidence.contextGatewayExecution.session.policy.allowedResourceKinds).toContain('chapter')
    expect(withEvidence.contextGatewayExecution.session.policy.allowedResourceKinds).toContain('fact')
  })

  it('状态变化要求章节/故事线证据，候选不写库；证据变化后旧候选 stale', async () => {
    const fixture = await seed()
    expect(() => parseCharacterLifecycleTaskInputV1({
      characterId: fixture.characterId, targetStatus: 'inactive',
      evidenceChapterId: null, evidenceStoryArcId: null,
    })).toThrow('必须绑定')
    const request = {
      characterId: fixture.characterId,
      targetStatus: 'inactive' as const,
      evidenceChapterId: fixture.chapterId,
      evidenceStoryArcId: fixture.storyArcId,
    }
    const prepared = await prepareCharacterLifecycleCopilotV1({
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.worldA,
      request, authorRequest: '依据封门受伤事件生成暂离候选。',
    })
    expect((await db.characters.get(fixture.characterId))?.narrativeStatus).toBe('active')
    expect(prepared.contextGatewayExecution.retrievalTrace.mandatory.some(item => (
      item.depth === 'full' && item.sourceRefs.some(ref => ref.table === 'characters')
    ))).toBe(true)
    await db.chapters.update(fixture.chapterId, { content: '<p>作者改写了触发事件。</p>', updatedAt: now + 1 })
    await expect(adoptRestoredCharacterLifecycleCandidateV1({
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.worldA,
      snapshot: prepared.snapshot,
      draft: serializeCharacterLifecycleCandidateV1(lifecycleCandidate(fixture.characterId), prepared.snapshot),
    })).rejects.toThrow('已变化')
    expect((await db.characters.get(fixture.characterId))?.narrativeStatus).toBe('active')
  })

  it('durable 状态候选刷新不重复调用模型，作者确认后才写入并记录 producer provenance', async () => {
    const fixture = await seed()
    const lifecycleRequest = {
      characterId: fixture.characterId,
      targetStatus: 'inactive' as const,
      evidenceChapterId: fixture.chapterId,
      evidenceStoryArcId: fixture.storyArcId,
    }
    const pinnedTask: PinnedMasterAgentTaskV1 = {
      id: 'character-lifecycle-targeted', agentId: 'character', skillId: 'character.lifecycle',
      instruction: '让青禾依据第一章事件暂离。', characterLifecycleRequest: lifecycleRequest,
    }
    const plan = await createMasterAgentPlan({
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.worldA,
      request: '生成角色暂离候选', pinnedTask,
    })
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.projectId, worldGroupId: fixture.worldA, scope: fixture.scope,
      purpose: 'character-lifecycle',
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(lifecycleCandidate(fixture.characterId)) } }],
      usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const first = await runDurableMasterAgentPlanV1({
      scope: fixture.scope, worldGroupId: fixture.worldA, conversationId: conversation.id!, plan,
      budget: new AgentTeamBudgetTracker('balanced'),
    })
    expect((await db.characters.get(fixture.characterId))?.narrativeStatus).toBe('active')
    const restored = await restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId: first.runId })
    expect(restored.candidates).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await commitMasterAgentCandidateAdoptionV1({
      scope: fixture.scope, runId: first.runId,
      candidateEventId: restored.candidates[0].event.id!, worldGroupId: fixture.worldA,
    })
    const row = await db.characters.get(fixture.characterId)
    expect(row).toMatchObject({
      narrativeStatus: 'inactive',
      statusEvidenceChapterId: fixture.chapterId,
      statusEvidenceStoryArcId: fixture.storyArcId,
    })
    expect(row?.statusProducerContractHash).toMatch(/^[a-f0-9]{64}$/)
    expect(row?.statusProducerCandidateHash).toMatch(/^[a-f0-9]{64}$/)
    expect((await verifyMasterAgentRunV1({ scope: fixture.scope, runId: first.runId })).accepted).toBe(true)
  })

  it('跨世界目标拒绝生成；新引用都登记进 PROJECT_TABLES 生命周期与导入重映射', async () => {
    const fixture = await seed()
    await expect(prepareCharacterSupplementCopilotV1({
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.worldB,
      request: { characterId: fixture.characterId, dimensions: ['goals'], useEvidence: false },
      authorRequest: '错误世界补全。',
    })).rejects.toThrow('不属于本次执行世界')
    const character = REGISTRY_BY_NAME.get('characters')!
    const remaps = new Set(character.exportRemap?.map(item => item.field))
    for (const field of [
      'raceEntryId', 'cultivationSystemId', 'powerSystemId', 'importantLocationId',
      'statusEvidenceChapterId', 'statusEvidenceStoryArcId',
    ]) expect(remaps.has(field)).toBe(true)
    expect(REGISTRY_BY_NAME.get('powerSystems')?.refs?.some(ref => ref.target === 'characters[powerSystemId]')).toBe(true)
    expect(REGISTRY_BY_NAME.get('importantLocations')?.refs?.some(ref => ref.target === 'characters[importantLocationId]')).toBe(true)
    expect(REGISTRY_BY_NAME.get('chapters')?.refs?.some(ref => ref.target === 'characters[statusEvidenceChapterId]')).toBe(true)
    expect(REGISTRY_BY_NAME.get('storyArcs')?.refs?.some(ref => ref.target === 'characters[statusEvidenceStoryArcId]')).toBe(true)
  })
})
