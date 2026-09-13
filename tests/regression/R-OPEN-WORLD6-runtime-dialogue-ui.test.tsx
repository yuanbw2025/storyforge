import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldScenePanel, {
  type TextOpenWorldSceneNaturalInputResolutionV1,
} from '../../src/components/text-game/TextOpenWorldScenePanel'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import type { TextOpenWorldRuntimeDialoguePresentationV1 } from '../../src/lib/open-world/runtime-dialogue'
import { projectTextOpenWorldScenesV1 } from '../../src/lib/open-world/scene-projection'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function fixture() {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  const runtime = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
  const projection = projectTextOpenWorldScenesV1(runtime)
  if (projection.status !== 'ready') throw new Error('测试需要P9场景投影')
  const availableActions = createTextOpenWorldActionRegistryV1(runtimePackage)
    .project(deriveTextOpenWorldContextsV1(runtime).action)
    .filter(action => action.available)
  return { projection, availableActions }
}

function dialogue(input: Partial<TextOpenWorldRuntimeDialoguePresentationV1> = {}): TextOpenWorldRuntimeDialoguePresentationV1 {
  return {
    version: 1,
    source: 'ai-candidate',
    status: 'generated',
    selectedSceneKey: 'scene.actor.caretaker',
    actorKey: 'actor.caretaker',
    actorName: '岑阿婆',
    tone: 'neutral',
    replyText: '昨夜只响过一回，我还没见到上游发生了什么。',
    citedKnowledgeKeys: [],
    recommendedActionKeys: ['action.talk-caretaker'],
    recommendedChoiceKeys: [],
    boundaryExplanation: null,
    baseSequence: 4,
    candidateHash: 'a'.repeat(64),
    contextManifestHash: 'b'.repeat(64),
    runId: 201,
    ...input,
  } as TextOpenWorldRuntimeDialoguePresentationV1
}

function resolution(presentation: TextOpenWorldRuntimeDialoguePresentationV1): TextOpenWorldSceneNaturalInputResolutionV1 {
  return {
    version: 1,
    source: 'ai-candidate',
    status: 'reply-only',
    selectedSceneKey: 'scene.actor.caretaker',
    baseSequence: 4,
    candidateHash: 'c'.repeat(64),
    contextManifestHash: 'd'.repeat(64),
    runId: 200,
    confidence: 0.98,
    options: [],
    replyText: '',
    boundaryExplanation: null,
    dialogue: presentation,
  }
}

async function inputValue(host: ParentNode, value: string) {
  const input = host.querySelector('#text-open-world-natural-command')
  if (!(input instanceof HTMLInputElement)) throw new Error('自然输入不存在')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function button(host: ParentNode, label: string, contains = false): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(item => (
    contains ? item.textContent?.includes(label) : item.textContent?.trim() === label
  ))
  if (!(found instanceof HTMLButtonElement)) throw new Error(`按钮不存在:${label}`)
  return found
}

async function click(target: HTMLButtonElement) {
  await act(async () => {
    target.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function waitFor(assertion: () => void) {
  const started = Date.now()
  while (Date.now() - started < 5_000) {
    try {
      await act(async () => assertion())
      return
    } catch {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  assertion()
}

describe('R-OPEN-WORLD6 · NPC对白玩家界面', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  async function render(onInterpretNaturalInput: NonNullable<Parameters<typeof TextOpenWorldScenePanel>[0]['onInterpretNaturalInput']>) {
    const current = fixture()
    const onExecute = vi.fn()
    await act(async () => {
      root.render(createElement(TextOpenWorldScenePanel, {
        sessionKey: 7,
        eventSequence: 4,
        projection: current.projection,
        availableActions: current.availableActions,
        feedback: null,
        busy: false,
        fallback: { regionTitle: '盐港', locationTitle: '盐港广场', description: '测试', playerName: '来客' },
        onExecute,
        onInterpretNaturalInput,
      }))
    })
    await click(button(host, '守渠人的话', true))
    return { ...current, onExecute }
  }

  it('把高置信对白候选呈现为独立临时会话，并把同场景短窗口交给下一轮', async () => {
    const requests: Parameters<NonNullable<Parameters<typeof TextOpenWorldScenePanel>[0]['onInterpretNaturalInput']>>[0][] = []
    const rendered = await render(vi.fn(async request => {
      requests.push(request)
      return resolution(dialogue({
        replyText: requests.length === 1 ? '昨夜只响过一回。' : '我记得你刚才问过这件事。',
      }))
    }))
    await inputValue(host, '昨夜响了几次？')
    await click(button(host, '提交'))
    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-runtime-dialogue"]')?.textContent)
      .toContain('昨夜只响过一回'))
    expect(rendered.onExecute).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="text-open-world-runtime-dialogue"]')?.textContent).toContain('AI只读候选')
    expect(host.querySelector('[data-testid="text-open-world-runtime-dialogue"]')?.textContent).toContain('与岑阿婆交谈（未执行）')

    await inputValue(host, '你记得我刚才问了什么吗？')
    await click(button(host, '提交'))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]!.recentDialogue).toEqual([
      { speaker: 'player', actorKey: null, text: '昨夜响了几次？' },
      { speaker: 'npc', actorKey: 'actor.caretaker', text: '昨夜只响过一回。' },
    ])
    expect(host.querySelector('[data-testid="text-open-world-runtime-dialogue"]')?.textContent)
      .toContain('我记得你刚才问过这件事')
  })

  it('模型不可用时明确显示冻结安全对白，且切换场景会清空临时对话', async () => {
    const fallback = dialogue({
      source: 'frozen-scene-fallback',
      status: 'fallback',
      replyText: '岑阿婆礼貌地点头，等你说明来意。',
      citedKnowledgeKeys: [],
      recommendedActionKeys: [],
      recommendedChoiceKeys: [],
      boundaryExplanation: 'AI对白当前不可用，已显示发布时冻结的安全对白；没有改变任何游戏状态。',
      baseSequence: null,
      candidateHash: null,
      contextManifestHash: null,
      runId: null,
    })
    const rendered = await render(vi.fn(async () => resolution(fallback)))
    await inputValue(host, '再说说这里吧')
    await click(button(host, '提交'))
    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-runtime-dialogue"]')?.textContent)
      .toContain('冻结安全回退'))
    expect(host.querySelector('[data-testid="text-open-world-runtime-dialogue"]')?.textContent)
      .toContain('岑阿婆礼貌地点头')
    expect(host.querySelector('[data-testid="text-open-world-input-notice"]')?.textContent)
      .toContain('没有改变任何游戏状态')
    expect(rendered.onExecute).not.toHaveBeenCalled()

    await click(button(host, '干涸的内渠', true))
    expect(host.querySelector('[data-testid="text-open-world-runtime-dialogue"]')).toBeNull()
  })
})
