import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildInteractionContextWindow,
  interactionVisibilityView,
} from '../../src/lib/character-interaction/runtime'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { buildSimulationCanonSnapshot } from '../../src/lib/simulation/canon-snapshot'
import {
  branchSimulationSession,
  changeInteractionRelationship,
  commitInteractionCharacterReply,
  commitInteractionPlayerMessage,
  createSimulationCheckpoint,
  createSimulationSession,
  proposeInteractionMemory,
  readSimulationState,
  readSimulationStateVersion,
  resolveInteractionMemory,
  startInteractionScene,
  verifySimulationCheckpoint,
} from '../../src/lib/simulation/runtime'
import type { SimulationInteractionState, SimulationRuntimeState } from '../../src/lib/types'

function interactionState(maxTurns = 200): SimulationInteractionState {
  return {
    schema: 'storyforge.character-interaction',
    version: 1,
    playerKey: 'player',
    profiles: [
      { participantKey: 'aria', characterKey: 'character:aria', name: '阿莉娅', roleLabel: '信使', voiceRules: '克制直接', maxMemoryEntries: 20 },
      { participantKey: 'bo', characterKey: 'character:bo', name: '博', roleLabel: '修表匠', voiceRules: '谨慎', maxMemoryEntries: 20 },
      { participantKey: 'cen', characterKey: 'character:cen', name: '岑', roleLabel: '巡夜人', voiceRules: '简短', maxMemoryEntries: 20 },
    ],
    sceneTemplates: [{
      sceneKey: 'clocktower',
      title: '钟楼会面',
      purpose: '确认失踪信件的去向',
      location: '旧钟楼',
      timeLabel: '雨夜',
      participantKeys: ['aria', 'bo', 'cen'],
      publicKnowledgeKeys: [],
      goals: ['决定是否公开秘密'],
      endingConditions: ['秘密已经处理'],
      safetyBoundaries: ['不替玩家发言'],
      openingNodeKey: 'meet',
      endingNodeKey: 'leave',
      maxTurns,
      directorBudget: 50_000,
    }],
    activeScene: null,
    sceneHistory: [],
    messages: [],
    knowledge: [{
      knowledgeKey: 'sealed-letter',
      participantKey: 'aria',
      content: '失踪的信藏在钟楼第三层。',
      status: 'known',
      importance: 95,
      sourceEventSequence: 0,
    }],
    memories: [],
    relationships: [{
      fromParticipantKey: 'aria',
      toParticipantKey: 'player',
      dimensionKey: 'trust',
      label: '信任',
      minimum: -5,
      maximum: 5,
      value: 1,
      largeChangeThreshold: 2,
      lastChangedSequence: 0,
    }],
    relationshipHistory: [],
    threads: [],
    totalPlayerTurns: 0,
    remainingDirectorBudget: 0,
  }
}

function initialState(maxTurns = 200): SimulationRuntimeState {
  return {
    version: 1,
    clock: 0,
    entities: {},
    memories: [],
    narratives: [],
    ttrpg: null,
    chat: null,
    interaction: interactionState(maxTurns),
    narrative: null,
    lastSequence: 0,
  }
}

describe('CHATGAME-2A · 确定性角色互动内核', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.projects.put({
      id: 99201,
      name: 'CHATGAME-2A 测试项目',
      genre: 'drama',
      genres: ['drama'],
      status: 'drafting',
      description: '三角色关系故事',
      targetWordCount: 10_000,
      enableMultiWorld: false,
      createdAt: 1,
      updatedAt: 1,
    } as any)
  })

  afterEach(() => db.close())

  async function session(maxTurns = 200) {
    const canon = await buildSimulationCanonSnapshot({
      projectId: 99201,
      worldGroupId: null,
      sourceKeys: ['project-world:99201'],
    })
    return createSimulationSession({
      projectId: 99201,
      kind: 'chatgame',
      title: '钟楼会面',
      canonSnapshot: canon.snapshot,
      initialState: initialState(maxTurns),
    })
  }

  async function envelope(sessionId: number, commandId: string) {
    const version = await readSimulationStateVersion(sessionId)
    return { sessionId, commandId, baseSequence: version.sequence, baseStateHash: version.stateHash }
  }

  it('知识只经真实告知传播，关系变化有证据与幅度规则，记忆不能伪造', async () => {
    const created = await session()
    const started = await startInteractionScene({
      ...await envelope(created.id!, 'scene.start'),
      sceneId: 'scene:clocktower:1',
      sceneKey: 'clocktower',
    })
    const privateQuestion = await commitInteractionPlayerMessage({
      ...await envelope(created.id!, 'message.private-question'),
      messageId: 'message:1',
      text: '信到底在哪里？',
      audienceKeys: ['aria'],
    })
    await commitInteractionCharacterReply({
      ...await envelope(created.id!, 'reply.private-secret'),
      messageId: 'message:2',
      speakerKey: 'aria',
      text: '只告诉你：信藏在钟楼第三层。',
      replyToSequence: privateQuestion.sequence,
      audienceKeys: ['player'],
      budgetCost: 5,
    })
    let state = await readSimulationState(created.id!)
    expect(interactionVisibilityView(state.interaction!, 'bo').knowledge).toEqual([])
    expect(interactionVisibilityView(state.interaction!, 'bo').messages).toEqual([])

    const publicQuestion = await commitInteractionPlayerMessage({
      ...await envelope(created.id!, 'message.public-question'),
      messageId: 'message:3',
      text: '现在可以把真相告诉大家吗？',
      audienceKeys: null,
    })
    const disclosure = await commitInteractionCharacterReply({
      ...await envelope(created.id!, 'reply.public-secret'),
      messageId: 'message:4',
      speakerKey: 'aria',
      text: '我正式告诉你们：失踪的信藏在钟楼第三层。',
      replyToSequence: publicQuestion.sequence,
      audienceKeys: null,
      disclosures: [{
        knowledgeKey: 'sealed-letter',
        toParticipantKeys: ['bo', 'cen'],
        evidenceExcerpt: '信藏在钟楼第三层',
      }],
      budgetCost: 5,
    })
    state = await readSimulationState(created.id!)
    expect(interactionVisibilityView(state.interaction!, 'bo').knowledge.map(item => item.knowledgeKey)).toEqual(['sealed-letter'])

    await expect(proposeInteractionMemory({
      ...await envelope(created.id!, 'memory.fake'),
      memoryId: 'memory:fake',
      participantKey: 'bo',
      kind: 'secret',
      content: '阿莉娅说信已经烧掉了。',
      importance: 90,
      sourceEventSequences: [disclosure.sequence],
      evidenceExcerpt: '信已经烧掉了',
    })).rejects.toThrow('无法在引用消息中验证')

    const proposal = await proposeInteractionMemory({
      ...await envelope(created.id!, 'memory.valid'),
      memoryId: 'memory:letter',
      participantKey: 'bo',
      kind: 'secret',
      content: '阿莉娅公开了信件藏在钟楼第三层。',
      importance: 90,
      sourceEventSequences: [disclosure.sequence],
      evidenceExcerpt: '信藏在钟楼第三层',
    })
    const adoptionEnvelope = await envelope(created.id!, 'memory.accept')
    const adopted = await resolveInteractionMemory({
      ...adoptionEnvelope,
      memoryId: 'memory:letter',
      resolution: 'accepted',
    })
    expect((await resolveInteractionMemory({
      ...adoptionEnvelope,
      memoryId: 'memory:letter',
      resolution: 'accepted',
    })).id).toBe(adopted.id)
    expect(proposal.sequence).toBeLessThan(adopted.sequence)

    const missedPromise = await commitInteractionPlayerMessage({
      ...await envelope(created.id!, 'message.missed-promise'),
      messageId: 'message:5',
      text: '我失约了，没有按时来。',
      audienceKeys: null,
    })
    await expect(changeInteractionRelationship({
      ...await envelope(created.id!, 'relation.too-large'),
      fromParticipantKey: 'aria',
      toParticipantKey: 'player',
      dimensionKey: 'trust',
      delta: -3,
      reason: '玩家失约',
      ruleKey: 'promise-missed',
      sourceEventSequence: missedPromise.sequence,
    })).rejects.toThrow('重大事件')
    await changeInteractionRelationship({
      ...await envelope(created.id!, 'relation.missed'),
      fromParticipantKey: 'aria',
      toParticipantKey: 'player',
      dimensionKey: 'trust',
      delta: -2,
      reason: '玩家承认自己失约',
      ruleKey: 'promise-missed',
      sourceEventSequence: missedPromise.sequence,
    })
    const repaired = await commitInteractionPlayerMessage({
      ...await envelope(created.id!, 'message.repair'),
      messageId: 'message:6',
      text: '我带来了补救方案并愿意承担后果。',
      audienceKeys: null,
    })
    await changeInteractionRelationship({
      ...await envelope(created.id!, 'relation.repaired'),
      fromParticipantKey: 'aria',
      toParticipantKey: 'player',
      dimensionKey: 'trust',
      delta: 2,
      reason: '玩家提出可执行的补救方案',
      ruleKey: 'promise-repaired',
      sourceEventSequence: repaired.sequence,
    })
    state = await readSimulationState(created.id!)
    expect(state.interaction?.relationships[0].value).toBe(1)
    expect(state.interaction?.relationshipHistory.map(item => item.reason)).toEqual([
      '玩家承认自己失约',
      '玩家提出可执行的补救方案',
    ])
    expect(started.commandId).toBe('scene.start')
  })

  it('过期回复被拒绝，回放、检查点和分支保持独立', async () => {
    const created = await session()
    await startInteractionScene({ ...await envelope(created.id!, 'scene.start'), sceneId: 'scene:1', sceneKey: 'clocktower' })
    const player = await commitInteractionPlayerMessage({
      ...await envelope(created.id!, 'message.1'),
      messageId: 'message:1',
      text: '你怎么看？',
    })
    const stale = await envelope(created.id!, 'reply.stale')
    await commitInteractionPlayerMessage({
      ...await envelope(created.id!, 'message.2'),
      messageId: 'message:2',
      text: '先等一下。',
    })
    await expect(commitInteractionCharacterReply({
      ...stale,
      messageId: 'message:stale',
      speakerKey: 'aria',
      text: '这是过期回复。',
      replyToSequence: player.sequence,
    })).rejects.toThrow('变化')
    const reply = await commitInteractionCharacterReply({
      ...await envelope(created.id!, 'reply.current'),
      messageId: 'message:3',
      speakerKey: 'aria',
      text: '我还在考虑。',
      replyToSequence: player.sequence,
    })
    const checkpoint = await createSimulationCheckpoint({ sessionId: created.id!, name: '钟楼检查点' })
    expect(await verifySimulationCheckpoint(checkpoint.id!)).toBe(true)
    const beforeBranch = await readSimulationState(created.id!, reply.sequence)
    const child = await branchSimulationSession({
      parentSessionId: created.id!,
      throughSequence: reply.sequence,
      title: '另一种回答',
    })
    expect((await readSimulationState(child.id!)).interaction?.messages.map(item => item.text))
      .toEqual(beforeBranch.interaction?.messages.map(item => item.text))
    expect((await readSimulationState(child.id!)).interaction?.messages.every(item => item.eventSequence < 0)).toBe(true)
    await commitInteractionPlayerMessage({
      ...await envelope(child.id!, 'branch.message'),
      messageId: 'branch:message',
      text: '只发生在分支。',
    })
    expect((await readSimulationState(created.id!)).interaction?.messages.some(item => item.messageId === 'branch:message')).toBe(false)
    const childSequences = (await readSimulationState(child.id!)).interaction?.messages.map(item => item.eventSequence) ?? []
    expect(new Set(childSequences).size).toBe(childSequences.length)
  })

  it('100 轮后上下文保持有界且已采用的关键承诺不会被摘要丢弃', async () => {
    const created = await session(120)
    await startInteractionScene({ ...await envelope(created.id!, 'scene.start'), sceneId: 'scene:long', sceneKey: 'clocktower' })
    const first = await commitInteractionPlayerMessage({
      ...await envelope(created.id!, 'turn.1'),
      messageId: 'turn:1',
      text: '我承诺第十天前归还钥匙。',
    })
    await proposeInteractionMemory({
      ...await envelope(created.id!, 'memory.promise.propose'),
      memoryId: 'memory:promise',
      participantKey: 'aria',
      kind: 'commitment',
      content: '玩家承诺第十天前归还钥匙。',
      importance: 100,
      sourceEventSequences: [first.sequence],
      evidenceExcerpt: '第十天前归还钥匙',
    })
    await resolveInteractionMemory({
      ...await envelope(created.id!, 'memory.promise.accept'),
      memoryId: 'memory:promise',
      resolution: 'accepted',
    })
    for (let turn = 2; turn <= 100; turn += 1) {
      await commitInteractionPlayerMessage({
        ...await envelope(created.id!, `turn.${turn}`),
        messageId: `turn:${turn}`,
        text: `这是第 ${turn} 轮普通交谈。`,
      })
    }
    const state = await readSimulationState(created.id!)
    const context = buildInteractionContextWindow(state.interaction!, 'aria', {
      maxCharacters: 12_000,
      maxRecentMessages: 24,
    })
    expect(state.interaction?.totalPlayerTurns).toBe(100)
    expect(context.messages).toHaveLength(24)
    expect(context.omittedMessageCount).toBe(76)
    expect(context.characterCount).toBeLessThanOrEqual(12_000)
    expect(context.memories.map(item => item.content)).toContain('玩家承诺第十天前归还钥匙。')
  }, 30_000)

  it('CONTEXT_SOURCES 只装配指定角色视角，不泄露其他角色私聊', async () => {
    const created = await session()
    await startInteractionScene({ ...await envelope(created.id!, 'scene.start'), sceneId: 'scene:context', sceneKey: 'clocktower' })
    await commitInteractionPlayerMessage({
      ...await envelope(created.id!, 'message.private'),
      messageId: 'message:private',
      text: '只有阿莉娅能看到这句私聊。',
      audienceKeys: ['aria'],
    })
    const aria = await assembleContext({
      projectId: 99201,
      simulationSessionId: created.id!,
      interactionParticipantKey: 'aria',
      sourceKeys: ['interactionRuntime'],
    })
    const bo = await assembleContext({
      projectId: 99201,
      simulationSessionId: created.id!,
      interactionParticipantKey: 'bo',
      sourceKeys: ['interactionRuntime'],
    })
    const shared = await assembleContext({
      projectId: 99201,
      simulationSessionId: created.id!,
      sourceKeys: ['simulationRuntime'],
    })
    expect(aria.text).toContain('只有阿莉娅能看到这句私聊')
    expect(aria.text).toContain('sealed-letter')
    expect(bo.text).not.toContain('只有阿莉娅能看到这句私聊')
    expect(bo.text).not.toContain('sealed-letter')
    expect(shared.text).not.toContain('只有阿莉娅能看到这句私聊')
    expect(shared.text).not.toContain('sealed-letter')
  })
})
