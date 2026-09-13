import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readContextGatewayManifestV3ForAttemptV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import {
  generateTextOpenWorldRuntimeDialogueV1,
  TEXT_OPEN_WORLD_RUNTIME_DIALOGUE_STEP_ID_V1,
} from '../../src/lib/open-world/runtime-dialogue'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

function output(input: {
  actorKey?: string
  replyText?: string
  tone?: 'bad' | 'neutral' | 'good'
  citedKnowledgeKeys?: string[]
  recommendedActionKeys?: string[]
  recommendedChoiceKeys?: string[]
  extra?: Record<string, unknown>
}) {
  return JSON.stringify({
    kind: 'npc-dialogue',
    actorKey: input.actorKey ?? 'actor.caretaker',
    replyText: input.replyText ?? '旧渠先贴着港墙走，昨夜的响动我只听见一次。',
    tone: input.tone ?? 'neutral',
    citedKnowledgeKeys: input.citedKnowledgeKeys ?? ['knowledge.caretaker'],
    recommendedActionKeys: input.recommendedActionKeys ?? ['action.talk-caretaker'],
    recommendedChoiceKeys: input.recommendedChoiceKeys ?? ['choice.talk-caretaker'],
    boundaryExplanation: null,
    ...input.extra,
  })
}

async function fixture(label: string, allowCaretakerKnowledge = true) {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  const narrative = runtimePackage.modules.narrative.payload as any
  const knowledge = runtimePackage.modules.knowledge.payload as any
  narrative.scenes.find((scene: any) => scene.key === 'scene.actor.caretaker')
    .allowedKnowledgeClaimKeys = allowCaretakerKnowledge ? ['knowledge.caretaker'] : []
  knowledge.entries.push({
    key: 'knowledge.hidden-upstream',
    kind: 'quest-clue',
    title: '上游密封闸门真相',
    content: '断脊最深处的黑石闸门由港务长秘密封死，这件事尚无人公开。',
    sourceRefs: ['world-release:secret:hidden-upstream'],
    initialPlayerVisibility: 'hidden',
    actorKeys: [],
  })
  return createGovernedTextOpenWorldSessionFixtureV1({
    name: `${label}-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    runtimeShape: 'vnext-only',
    title: label,
    seed: `g6-dialogue-${label}`,
  })
}

describe('R-OPEN-WORLD6 · vNext NPC受治理对白', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只向所选场景角色交付人格、当前态度与可说知识，并以只读V3证据闭环', async () => {
    const created = await fixture('角色对白')
    const beforeEvents = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()
    let prompt = ''
    const result = await generateTextOpenWorldRuntimeDialogueV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.actor.caretaker',
      utterance: '昨夜的异响是怎么回事？',
      recentDialogue: [
        { speaker: 'player', actorKey: null, text: '你还记得旧渠怎么走吗？' },
        { speaker: 'npc', actorKey: 'actor.caretaker', text: '我只说亲眼见过的。' },
      ],
      runAI: async messages => {
        prompt = messages.map(message => message.content).join('\n')
        return output({})
      },
    })

    expect(prompt).toContain('说话简短，重视可验证的行动')
    expect(prompt).toContain('knowledge.caretaker')
    expect(prompt).toContain('scene.actor.caretaker')
    expect(prompt).toContain('action.talk-caretaker')
    expect(prompt).not.toContain('knowledge.hidden-upstream')
    expect(prompt).not.toContain('断脊最深处的黑石闸门')
    expect(prompt).not.toContain('scene.offer.main')
    expect(prompt).not.toContain('action.accept-main')
    expect(result).toMatchObject({
      status: 'generated',
      selectedSceneKey: 'scene.actor.caretaker',
      actorKey: 'actor.caretaker',
      actorName: '岑阿婆',
      tone: 'neutral',
      citedKnowledgeKeys: ['knowledge.caretaker'],
      recommendedActionKeys: ['action.talk-caretaker'],
      recommendedChoiceKeys: ['choice.talk-caretaker'],
    })
    expect(await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()).toBe(beforeEvents)
    const run = await readInstanceAgentRunV1(created.scope, result.runId)
    expect(run.projection.state).toBe('completed')
    expect(run.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    const manifest = await readContextGatewayManifestV3ForAttemptV1({
      scope: created.scope,
      runId: result.runId,
      stepId: TEXT_OPEN_WORLD_RUNTIME_DIALOGUE_STEP_ID_V1,
      attempt: 1,
    })
    expect(manifest.manifest.manifestHash).toBe(result.contextManifestHash)
  }, 45_000)

  it('拒绝错误角色、错误态度、越界知识、越界推荐和扩字段', async () => {
    const created = await fixture('对白协议拒绝')
    const attempt = (candidate: string) => generateTextOpenWorldRuntimeDialogueV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.actor.caretaker',
      utterance: '告诉我你知道的事。',
      runAI: async () => candidate,
    })
    await expect(attempt(output({ actorKey: 'actor.unknown' }))).rejects.toThrow(/候选角色/)
    await expect(attempt(output({ tone: 'good' }))).rejects.toThrow(/三档态度/)
    await expect(attempt(output({ citedKnowledgeKeys: ['knowledge.hidden-upstream'] }))).rejects.toThrow(/不可声明的知识/)
    await expect(attempt(output({ recommendedActionKeys: ['action.accept-main'] }))).rejects.toThrow(/场景闭集之外/)
    await expect(attempt(output({ recommendedChoiceKeys: ['choice.accept-main'] }))).rejects.toThrow(/场景闭集之外/)
    await expect(attempt(output({ extra: { inventedResult: '任务已完成' } }))).rejects.toThrow(/字段不在允许闭集/)
  }, 90_000)

  it('即使模型直接复述未交付秘密原文也拒绝，并把Run标记为失败', async () => {
    const created = await fixture('秘密防漏')
    let runId = 0
    await expect(generateTextOpenWorldRuntimeDialogueV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.actor.caretaker',
      utterance: '上游到底发生了什么？',
      onRunCreated: value => { runId = value },
      runAI: async () => output({
        citedKnowledgeKeys: [],
        recommendedActionKeys: [],
        recommendedChoiceKeys: [],
        replyText: '断脊最深处的黑石闸门由港务长秘密封死，这件事尚无人公开。',
      }),
    })).rejects.toThrow(/不可声明的冻结知识原文/)
    expect((await readInstanceAgentRunV1(created.scope, runId)).projection.state).toBe('failed')
  }, 45_000)

  it('本场景没有任何可说知识时仍可给出不引用事实的角色化回应', async () => {
    const created = await fixture('空知识对白', false)
    const result = await generateTextOpenWorldRuntimeDialogueV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.actor.caretaker',
      utterance: '你能告诉我上游真相吗？',
      runAI: async () => output({
        replyText: '我没亲眼见过上游的情况，不能替你下结论。',
        citedKnowledgeKeys: [],
        recommendedActionKeys: [],
        recommendedChoiceKeys: [],
      }),
    })
    expect(result).toMatchObject({ status: 'generated', citedKnowledgeKeys: [] })
  }, 45_000)

  it('模型响应期间Session推进后丢弃过期对白，不把旧候选展示为当前事实', async () => {
    const created = await fixture('过期对白')
    await expect(generateTextOpenWorldRuntimeDialogueV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.actor.caretaker',
      utterance: '现在还能休息吗？',
      runAI: async () => {
        await executeTextOpenWorldActionV1({
          sessionId: created.session.id!,
          actionKey: 'action.rest',
          targetKey: null,
          source: 'system-action',
          commandId: 'command.g6.dialogue.advance',
        })
        return output({ citedKnowledgeKeys: [], recommendedActionKeys: [], recommendedChoiceKeys: [] })
      },
    })).rejects.toThrow(/已经变化|已变化/)
  }, 45_000)
})
