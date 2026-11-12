import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldScenePanel from '../../src/components/text-game/TextOpenWorldScenePanel'
import { db } from '../../src/lib/db/schema'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { readProductRuntimeState } from '../../src/lib/open-world/runtime-api'
import { generateTextOpenWorldRuntimeDialogueV1 } from '../../src/lib/open-world/runtime-dialogue'
import { generateTextOpenWorldRuntimeIntentV1 } from '../../src/lib/open-world/runtime-intent'
import { generateAndCommitTextOpenWorldRuntimeMemoryV1 } from '../../src/lib/open-world/runtime-memory'
import { projectTextOpenWorldScenesV1 } from '../../src/lib/open-world/scene-projection'
import { deriveTextOpenWorldContextsV1, parseTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
const sceneKey = 'scene.actor.caretaker'
const actorKey = 'actor.caretaker'
type SceneProps = Parameters<typeof TextOpenWorldScenePanel>[0]
type Interpret = NonNullable<SceneProps['onInterpretNaturalInput']>
type Commit = NonNullable<SceneProps['onCommitMemory']>

function dialogueOutput(replyText: string) {
  return JSON.stringify({
    kind: 'npc-dialogue', actorKey, replyText, tone: 'neutral',
    citedKnowledgeKeys: [], recommendedActionKeys: [], recommendedChoiceKeys: [], boundaryExplanation: null,
  })
}

const intentOutput = JSON.stringify({
  kind: 'dialogue-only', confidence: 0.98, actionKeys: [], choiceKeys: [],
  extractedArguments: { targetKey: null }, rationale: '请角色回应当前问题。',
  requiresConfirmation: false, boundaryExplanation: null, replyText: '我明白你的问题。',
})

const memoryOutput = JSON.stringify({
  kind: 'dialogue-window', subjectKey: actorKey, summary: '岑阿婆记下了来客在盐港的询问。',
  coveredEventSequences: [], playerKnowledgeKeys: [], actorKnowledgeKeys: [], openThreadKeys: [],
})

function button(host: HTMLElement, label: string) {
  const target = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  if (!target) throw Error(`按钮不存在：${label}`)
  return target
}

async function click(target: HTMLButtonElement, settled?: () => unknown) {
  await act(async () => {
    target.click()
    if (settled) await vi.waitFor(settled, { timeout: 10_000 })
  })
}

async function enter(host: HTMLElement, value: string, settled: () => unknown) {
  const input = host.querySelector('#text-open-world-natural-command')
  if (!(input instanceof HTMLInputElement)) throw Error('自然输入不存在')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click(button(host, '提交'), settled)
}

describe('SFQA-084 · 真实场景面板的对白窗口', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    await db.delete()
    await db.open()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    db.close()
  })

  async function fixture(label: string, props: (input: {
    scope: Awaited<ReturnType<typeof createGovernedTextOpenWorldSessionFixtureV1>>['scope']
    productRuntimeSessionId: number
  }) => Pick<SceneProps, 'onInterpretNaturalInput' | 'onCommitMemory'>) {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `084-${label}-${crypto.randomUUID()}`, textOpenWorldVNext: runtimePackage,
      runtimeShape: 'vnext-only', title: '对白窗口', seed: `084-${label}`,
    })
    const sessionId = created.session.id!
    const state = await readProductRuntimeState(sessionId)
    const runtime = parseTextOpenWorldSessionProjectionV1(state.textOpenWorld)
    const projection = projectTextOpenWorldScenesV1(runtime)
    const availableActions = createTextOpenWorldActionRegistryV1(runtimePackage)
      .project(deriveTextOpenWorldContextsV1(runtime).action).filter(action => action.available)
    const onExecute = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldScenePanel, {
      sessionKey: sessionId, eventSequence: state.lastSequence, projection, availableActions,
      feedback: null, busy: false, memoryAvailable: true, onExecute,
      fallback: { regionTitle: '盐港', locationTitle: '盐港广场', description: '测试', playerName: '来客' },
      ...props({ scope: created.scope, productRuntimeSessionId: sessionId }),
    })))
    await click(button(host, '守渠人的话'))
    return { sessionId, onExecute, scope: created.scope }
  }

  it.each([1_000, 1_001, 4_000])('让已接纳的 %i 字对白逐字进入下一轮和显式记忆', async length => {
    const longReply = `港${'潮'.repeat(length - 2)}岸`
    const nextReply = '记得你刚才问了潮水。'
    const openingInput = length === 4_000 ? '询'.repeat(1_000) : '请说说这里的潮水。'
    // Max reply plus two real exchanges exactly exhausts the memory budget.
    const nextInput = length === 4_000 ? '问'.repeat(1_000 - nextReply.length) : '你还记得刚才的问题吗？'
    const completed: Array<{ runId: number | null; candidateHash: string | null; contextManifestHash: string | null }> = []
    const dialoguePrompts: string[] = []
    const memoryPrompts: string[] = []
    const errors: string[] = []
    const requests: Parameters<Interpret>[0][] = []
    const memoryRequests: Parameters<Commit>[0][] = []
    let memorySettled = false
    const { sessionId, onExecute } = await fixture(String(length), scope => ({
      onInterpretNaturalInput: async request => {
        requests.push(request)
        try {
          const intent = await generateTextOpenWorldRuntimeIntentV1({
            ...scope, selectedSceneKey: request.selectedSceneKey, utterance: request.utterance,
            runAI: async () => intentOutput,
          })
          expect(intent.status).toBe('reply-only')
          const dialogue = await generateTextOpenWorldRuntimeDialogueV1({
            ...scope, ...request,
            runAI: async messages => {
              dialoguePrompts.push(messages.map(message => message.content).join('\n'))
              return dialogueOutput(requests.length === 1 ? longReply : nextReply)
            },
          })
          completed.push(dialogue)
          return { ...intent, dialogue }
        } catch (error) {
          errors.push(String(error))
          throw error
        }
      },
      onCommitMemory: async request => {
        memoryRequests.push(request)
        try {
          if (length === 4_000) {
            const invalidRunAI = vi.fn(async () => memoryOutput)
            const [player, npc, ...rest] = request.dialogue
            const reject = (dialogue: Parameters<Commit>[0]['dialogue']) => generateAndCommitTextOpenWorldRuntimeMemoryV1({
              ...scope, ...request, dialogue, runAI: invalidRunAI,
            })
            await expect(reject([player!, { ...npc!, dialogueRunId: 999_999 }, ...rest])).rejects.toThrow(/对白Run不可验证/)
            await expect(reject([player!, { ...npc!, citedKnowledgeKeys: ['knowledge.caretaker'] }, ...rest]))
              .rejects.toThrow(/对白候选与窗口证据不一致/)
            await expect(reject([...request.dialogue, { ...player!, text: '溢' }])).rejects.toThrow(/超过6000字符/)
            expect(invalidRunAI).not.toHaveBeenCalled()
          }
          return await generateAndCommitTextOpenWorldRuntimeMemoryV1({
            ...scope, ...request,
            runAI: async messages => {
              memoryPrompts.push(messages.map(message => message.content).join('\n'))
              return memoryOutput
            },
          })
        } catch (error) {
          errors.push(String(error))
          throw error
        } finally {
          memorySettled = true
        }
      },
    }))
    const output = () => host.querySelector('[data-testid="text-open-world-runtime-dialogue"]')?.textContent ?? ''
    const commits = () => db.productRuntimeEvents.where('sessionId').equals(sessionId)
      .filter(event => event.type === 'text-open-world.memory.committed').count()

    await enter(host, openingInput, () => expect(completed.length === 1 || errors.length > 0).toBe(true))
    expect(errors).toEqual([])
    expect(output()).toContain(longReply)
    expect(completed).toHaveLength(1)
    expect(await commits()).toBe(0)
    await enter(host, nextInput, () => expect(completed.length === 2 || errors.length > 0).toBe(true))
    await click(button(host, '整理并保存长期记忆'), () => expect(memorySettled).toBe(true))

    expect(errors).toEqual([])
    expect(requests[1]!.recentDialogue).toEqual([
      { speaker: 'player', actorKey: null, text: openingInput },
      { speaker: 'npc', actorKey, text: longReply },
    ])
    expect(dialoguePrompts[1]).toContain(longReply)
    expect(dialoguePrompts[1]).toContain(nextInput)
    expect(memoryRequests[0]!.dialogue[1]).toMatchObject({
      text: longReply, dialogueRunId: completed[0]!.runId,
      dialogueCandidateHash: completed[0]!.candidateHash,
      dialogueContextManifestHash: completed[0]!.contextManifestHash, citedKnowledgeKeys: [],
    })
    expect(memoryPrompts[0]).toContain(longReply)
    expect(memoryPrompts[0]).toContain(nextInput)
    if (length === 4_000) {
      expect(memoryRequests[0]!.dialogue.reduce((total, turn) => total + turn.text.length, 0)).toBe(6_000)
    }
    expect(await commits()).toBe(1)
    expect(onExecute).not.toHaveBeenCalled()
  }, 60_000)

  it('保留显示原文，两个入口只交接最新且连续的完整轮，最多12条', async () => {
    const opening = '甲'.repeat(1_000)
    const bigReply = '乙'.repeat(4_000)
    const second = '丙'.repeat(1_000)
    const secondReply = '丁'.repeat(1_001)
    const requests: Parameters<Interpret>[0][] = []
    const onCommitMemory = vi.fn<Commit>(async () => { throw Error('测试只观察面板交接，不制造假回执') })
    await fixture('latest-complete', () => ({
      onCommitMemory,
      onInterpretNaturalInput: async request => {
        requests.push(request)
        const index = requests.length
        const replyText = index === 1 ? bigReply : index === 2 ? secondReply : `答复 ${index}`
        return {
          version: 1, source: 'ai-candidate', status: 'reply-only', selectedSceneKey: sceneKey,
          baseSequence: 0, candidateHash: 'a'.repeat(64), contextManifestHash: 'b'.repeat(64), runId: index + 100,
          confidence: 0.98, options: [], replyText: '', boundaryExplanation: null,
          dialogue: {
            version: 1, source: 'ai-candidate', status: 'generated', selectedSceneKey: sceneKey,
            actorKey, actorName: '岑阿婆', tone: 'neutral', replyText, citedKnowledgeKeys: ['knowledge.caretaker'],
            recommendedActionKeys: [], recommendedChoiceKeys: [], boundaryExplanation: null, baseSequence: 0,
            candidateHash: 'c'.repeat(64), contextManifestHash: 'd'.repeat(64), runId: index,
          },
        }
      },
    }))
    const log = () => host.querySelector('[data-testid="text-open-world-runtime-dialogue"]')?.textContent ?? ''
    await enter(host, opening, () => expect(requests).toHaveLength(1))
    await enter(host, second, () => expect(requests).toHaveLength(2))
    expect(log()).toContain(bigReply)
    expect(log()).toContain(secondReply)
    expect(log()).toContain('整理最近 1 轮完整对白')
    expect(onCommitMemory).not.toHaveBeenCalled()
    await click(button(host, '整理并保存长期记忆'), () => expect(onCommitMemory).toHaveBeenCalledTimes(1))
    expect(onCommitMemory.mock.calls[0]![0].dialogue).toEqual([
      expect.objectContaining({ speaker: 'player', text: second }),
      expect.objectContaining({ speaker: 'npc', text: secondReply, dialogueRunId: 2, citedKnowledgeKeys: ['knowledge.caretaker'] }),
    ])
    for (let index = 3; index <= 8; index += 1) {
      await enter(host, `提问 ${index}`, () => expect(requests).toHaveLength(index))
    }
    expect(requests[2]).toEqual({
      selectedSceneKey: sceneKey, utterance: '提问 3', recentDialogue: [
        { speaker: 'player', actorKey: null, text: second },
        { speaker: 'npc', actorKey, text: secondReply },
      ],
    })
    expect(requests[7]!.recentDialogue).toHaveLength(12)
    expect(requests[7]!.recentDialogue[0]).toMatchObject({ speaker: 'player', text: second })
    expect(requests[7]!.recentDialogue[requests[7]!.recentDialogue.length - 1]).toMatchObject({ speaker: 'npc', text: '答复 7' })
    expect(log()).toContain('整理最近 6 轮完整对白')
  }, 60_000)

  it('真实服务拒绝第13条、超6000字和超过合同的候选，且不写玩法事件', async () => {
    const { sessionId, scope } = await fixture('service-limit', () => ({}))
    const selection = { scope, productRuntimeSessionId: sessionId, selectedSceneKey: sceneKey }
    const player = { speaker: 'player' as const, actorKey: null, text: '问' }
    const npc = { speaker: 'npc' as const, actorKey, text: '答' }
    const tooMany = [...Array.from({ length: 6 }, () => [player, npc]).flat(), player]
    const skipped = vi.fn(async () => dialogueOutput('答复'))
    await expect(generateTextOpenWorldRuntimeDialogueV1({
      ...selection, utterance: '询问', recentDialogue: tooMany, runAI: skipped,
    })).rejects.toThrow(/最多12条记录/)
    await expect(generateTextOpenWorldRuntimeDialogueV1({
      ...selection, utterance: '询问', recentDialogue: [
        { ...player, text: '问'.repeat(1_000) }, { ...npc, text: '答'.repeat(4_000) },
        player, { ...npc, text: '另'.repeat(1_000) },
      ], runAI: skipped,
    })).rejects.toThrow(/超过6000字符/)
    const memoryRunAI = vi.fn(async () => memoryOutput)
    await expect(generateAndCommitTextOpenWorldRuntimeMemoryV1({
      ...selection, actorKey, dialogue: tooMany.map(turn => ({
        ...turn, source: turn.speaker === 'player' ? 'player-input' : 'frozen-scene-fallback',
        citedKnowledgeKeys: [], dialogueCandidateHash: null, dialogueContextManifestHash: null, dialogueRunId: null,
      })), runAI: memoryRunAI,
    })).rejects.toThrow(/2到12条记录/)
    expect(skipped).not.toHaveBeenCalled()
    expect(memoryRunAI).not.toHaveBeenCalled()
    const before = await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()
    const overlong = vi.fn(async () => dialogueOutput('潮'.repeat(4_001)))
    await expect(generateTextOpenWorldRuntimeDialogueV1({
      ...selection, utterance: '询问', runAI: overlong,
    })).rejects.toThrow(/replyText.*4000/)
    expect(overlong).toHaveBeenCalledTimes(1)
    expect(await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()).toBe(before)
  }, 60_000)
})
