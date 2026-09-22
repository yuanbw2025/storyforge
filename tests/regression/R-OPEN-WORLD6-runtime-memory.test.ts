import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { replayTextOpenWorldEventProtocolV1 } from '../../src/lib/open-world/event-contract'
import { readProductRuntimeState } from '../../src/lib/open-world/runtime-api'
import { generateTextOpenWorldRuntimeDialogueV1 } from '../../src/lib/open-world/runtime-dialogue'
import {
  generateAndCommitTextOpenWorldRuntimeMemoryV1,
  type TextOpenWorldRuntimeMemoryDialogueTurnV1,
} from '../../src/lib/open-world/runtime-memory'
import {
  parseTextOpenWorldSessionProjectionV1,
  rebaseTextOpenWorldSessionProjectionForBranchV1,
} from '../../src/lib/open-world/session-projection'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

async function fixture(label: string) {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  const narrative = runtimePackage.modules.narrative.payload as any
  const knowledge = runtimePackage.modules.knowledge.payload as any
  narrative.scenes.find((scene: any) => scene.key === 'scene.actor.caretaker')
    .allowedKnowledgeClaimKeys = ['knowledge.caretaker', 'knowledge.channel-warning', 'knowledge.player-report']
  knowledge.entries.push({
    key: 'knowledge.channel-warning',
    kind: 'quest-clue',
    title: '旧渠警告',
    content: '岑阿婆曾看见旧渠石阶下留有新鲜抓痕。',
    sourceRefs: ['world-release:fact:channel-warning'],
    initialPlayerVisibility: 'hidden',
    actorKeys: ['actor.caretaker'],
  }, {
    key: 'knowledge.player-report',
    kind: 'quest-clue',
    title: '玩家带来的报告',
    content: '玩家已经确认港墙外侧有一处松动的盐砖。',
    sourceRefs: ['world-release:fact:player-report'],
    initialPlayerVisibility: 'known',
    actorKeys: [],
  })
  return createGovernedTextOpenWorldSessionFixtureV1({
    name: `${label}-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    runtimeShape: 'vnext-only',
    title: label,
    seed: `g6-memory-${label}`,
  })
}

function memoryOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    kind: 'dialogue-window',
    subjectKey: 'actor.caretaker',
    summary: '岑阿婆向来客说明旧渠附近出现了危险痕迹，并记下了来客带来的港墙报告。',
    coveredEventSequences: [],
    playerKnowledgeKeys: ['knowledge.channel-warning'],
    actorKnowledgeKeys: ['knowledge.player-report'],
    openThreadKeys: [],
    ...overrides,
  })
}

async function verifiedDialogue(created: Awaited<ReturnType<typeof fixture>>) {
  const result = await generateTextOpenWorldRuntimeDialogueV1({
    scope: created.scope,
    productRuntimeSessionId: created.session.id!,
    selectedSceneKey: 'scene.actor.caretaker',
    utterance: '旧渠附近有什么危险？',
    runAI: async () => JSON.stringify({
      kind: 'npc-dialogue',
      actorKey: 'actor.caretaker',
      replyText: '我在旧渠石阶下看见了新鲜抓痕，你过去时别离墙根太近。',
      tone: 'neutral',
      citedKnowledgeKeys: ['knowledge.channel-warning'],
      recommendedActionKeys: ['action.talk-caretaker'],
      recommendedChoiceKeys: ['choice.talk-caretaker'],
      boundaryExplanation: null,
    }),
  })
  const dialogue: TextOpenWorldRuntimeMemoryDialogueTurnV1[] = [{
    speaker: 'player', actorKey: null, text: '旧渠附近有什么危险？', source: 'player-input',
    citedKnowledgeKeys: [], dialogueCandidateHash: null, dialogueContextManifestHash: null, dialogueRunId: null,
  }, {
    speaker: 'npc', actorKey: result.actorKey, text: result.replyText, source: 'ai-candidate',
    citedKnowledgeKeys: [...result.citedKnowledgeKeys], dialogueCandidateHash: result.candidateHash,
    dialogueContextManifestHash: result.contextManifestHash, dialogueRunId: result.runId,
  }]
  return { result, dialogue }
}

describe('R-OPEN-WORLD6 · vNext长期记忆与角色运行知识', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只采用已验证对白和闭集知识，并随事件重放与存档分支继承', async () => {
    const created = await fixture('长期记忆')
    const evidence = await verifiedDialogue(created)
    const committed = await generateAndCommitTextOpenWorldRuntimeMemoryV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.actor.caretaker',
      actorKey: 'actor.caretaker',
      dialogue: evidence.dialogue,
      runAI: async () => memoryOutput(),
    })

    expect(committed).toMatchObject({ status: 'committed', actorKey: 'actor.caretaker' })
    const state = await readProductRuntimeState(created.session.id!)
    const projection = parseTextOpenWorldSessionProjectionV1(state.textOpenWorld)
    expect(projection.state.knowledge.visibilityByKey['knowledge.channel-warning']).toBe('known')
    expect(projection.memory.actorKnowledgeByActorKey['actor.caretaker']).toContain('knowledge.player-report')
    expect(projection.memory.records).toHaveLength(1)
    expect(projection.memory.records[0]).toMatchObject({
      memoryKey: committed.memoryKey,
      sourceDialogueKnowledgeKeys: ['knowledge.channel-warning'],
      inherited: false,
    })

    let nextDialoguePrompt = ''
    await generateTextOpenWorldRuntimeDialogueV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.actor.caretaker',
      utterance: '你还记得我告诉你的报告吗？',
      runAI: async messages => {
        nextDialoguePrompt = messages.map(message => message.content).join('\n')
        return JSON.stringify({
          kind: 'npc-dialogue', actorKey: 'actor.caretaker', replyText: '我记得那份港墙报告。', tone: 'neutral',
          citedKnowledgeKeys: ['knowledge.player-report'], recommendedActionKeys: [], recommendedChoiceKeys: [], boundaryExplanation: null,
        })
      },
    })
    expect(nextDialoguePrompt).toContain('玩家带来的报告')
    expect(nextDialoguePrompt).toContain('岑阿婆向来客说明旧渠附近出现了危险痕迹')

    const branch = rebaseTextOpenWorldSessionProjectionForBranchV1(projection)
    expect(branch.lastEventSequence).toBe(0)
    expect(branch.memory.records[0]).toMatchObject({ inherited: true, committedSequence: 0, coveredEventSequences: [] })
    expect(branch.memory.actorKnowledgeByActorKey['actor.caretaker']).toContain('knowledge.player-report')

    const run = await readInstanceAgentRunV1(created.scope, committed.runId)
    expect(run.projection.state).toBe('completed')
    expect(run.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
  }, 90_000)

  it('拒绝伪造的对白Run、越界知识与未公开线程，且不写运行事件', async () => {
    const created = await fixture('记忆越界')
    const before = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()
    const forged: TextOpenWorldRuntimeMemoryDialogueTurnV1[] = [{
      speaker: 'player', actorKey: null, text: '告诉我。', source: 'player-input', citedKnowledgeKeys: [],
      dialogueCandidateHash: null, dialogueContextManifestHash: null, dialogueRunId: null,
    }, {
      speaker: 'npc', actorKey: 'actor.caretaker', text: '这是伪造证词。', source: 'ai-candidate',
      citedKnowledgeKeys: [], dialogueCandidateHash: 'a'.repeat(64), dialogueContextManifestHash: 'b'.repeat(64), dialogueRunId: 999,
    }]
    await expect(generateAndCommitTextOpenWorldRuntimeMemoryV1({
      scope: created.scope, productRuntimeSessionId: created.session.id!, selectedSceneKey: 'scene.actor.caretaker',
      actorKey: 'actor.caretaker', dialogue: forged, runAI: async () => memoryOutput(),
    })).rejects.toThrow(/对白Run不可验证/)
    expect(await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()).toBe(before)

    const evidence = await verifiedDialogue(created)
    await expect(generateAndCommitTextOpenWorldRuntimeMemoryV1({
      scope: created.scope, productRuntimeSessionId: created.session.id!, selectedSceneKey: 'scene.actor.caretaker',
      actorKey: 'actor.caretaker', dialogue: evidence.dialogue,
      runAI: async () => memoryOutput({ openThreadKeys: ['quest.hidden'] }),
    })).rejects.toThrow(/未公开故事线程/)
  }, 90_000)

  it('模型返回期间状态推进会使记忆候选过期，不覆盖新状态', async () => {
    const created = await fixture('记忆过期')
    const evidence = await verifiedDialogue(created)
    await expect(generateAndCommitTextOpenWorldRuntimeMemoryV1({
      scope: created.scope, productRuntimeSessionId: created.session.id!, selectedSceneKey: 'scene.actor.caretaker',
      actorKey: 'actor.caretaker', dialogue: evidence.dialogue,
      runAI: async () => {
        await executeTextOpenWorldActionV1({
          sessionId: created.session.id!, actionKey: 'action.rest', targetKey: null,
          source: 'system-action', commandId: 'command.g6.memory.advance',
        })
        return memoryOutput()
      },
    })).rejects.toThrow(/已经变化|已变化/)
    const events = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    expect(events.some(event => event.type === 'text-open-world.memory.committed')).toBe(false)
  }, 90_000)

  it('事件协议拒绝被篡改的采用Hash', async () => {
    const created = await fixture('记忆防篡改')
    const evidence = await verifiedDialogue(created)
    await generateAndCommitTextOpenWorldRuntimeMemoryV1({
      scope: created.scope, productRuntimeSessionId: created.session.id!, selectedSceneKey: 'scene.actor.caretaker',
      actorKey: 'actor.caretaker', dialogue: evidence.dialogue, runAI: async () => memoryOutput(),
    })
    const events = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    const tampered = events.map(event => event.type !== 'text-open-world.memory.committed' ? event : {
      ...event,
      payloadJson: JSON.stringify({ ...JSON.parse(event.payloadJson), adoptionHash: 'f'.repeat(64) }),
    })
    await expect(replayTextOpenWorldEventProtocolV1(tampered, created.session.seed)).rejects.toThrow(/采用Hash/)
  }, 90_000)
})
