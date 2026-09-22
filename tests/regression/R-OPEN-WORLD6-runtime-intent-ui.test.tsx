import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldScenePanel from '../../src/components/text-game/TextOpenWorldScenePanel'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import type {
  TextOpenWorldRuntimeIntentAuthorizationV1,
  TextOpenWorldRuntimeIntentResolutionV1,
} from '../../src/lib/open-world/runtime-intent'
import { projectTextOpenWorldScenesV1 } from '../../src/lib/open-world/scene-projection'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function authorization(input: {
  runId: number
  selectedKind: 'action' | 'choice'
  selectedKey: string
  actionKey: string
  targetKey: string | null
}): TextOpenWorldRuntimeIntentAuthorizationV1 {
  return {
    schema: 'storyforge.text-open-world.runtime-intent-authorization',
    version: 1,
    runId: input.runId,
    candidateHash: 'a'.repeat(64),
    contextManifestHash: 'b'.repeat(64),
    terminalReceiptHash: 'c'.repeat(64),
    baseSequence: 4,
    selectedKind: input.selectedKind,
    selectedKey: input.selectedKey,
    actionKey: input.actionKey,
    targetKey: input.targetKey,
    authorizationHash: 'd'.repeat(64),
  }
}

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

describe('R-OPEN-WORLD6 · 自由输入玩家界面', () => {
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
    return { ...current, onExecute }
  }

  it('唯一AI映射立即交给既有Action，并携带原始事件基线与授权', async () => {
    const targetKey = 'quest-instance.7.quest.main.1.release.1.session-start'
    const auth = authorization({
      runId: 101,
      selectedKind: 'choice',
      selectedKey: 'choice.accept-main',
      actionKey: 'action.accept-main',
      targetKey,
    })
    const resolution: TextOpenWorldRuntimeIntentResolutionV1 = {
      version: 1,
      source: 'ai-candidate',
      status: 'mapped',
      selectedSceneKey: 'scene.offer.main',
      baseSequence: 4,
      candidateHash: auth.candidateHash,
      contextManifestHash: auth.contextManifestHash,
      runId: auth.runId,
      confidence: 0.98,
      options: [{
        optionKey: 'choice:choice.accept-main:quest',
        selectedKind: 'choice', selectedKey: 'choice.accept-main', actionKey: 'action.accept-main', targetKey,
        label: '接下盐渠委托', description: '接受主线委托', confirmationRequired: false, authorization: auth,
      }],
      replyText: '可以接下委托。',
      boundaryExplanation: null,
    }
    const current = fixture()
    const actualTarget = current.availableActions.find(item => item.action.key === 'action.accept-main')!.validTargetKeys[0]!
    resolution.options[0]!.targetKey = actualTarget
    resolution.options[0]!.authorization.targetKey = actualTarget
    const rendered = await render(vi.fn(async () => resolution))
    await inputValue(host, '我来帮她处理这件事')
    await click(button(host, '提交'))
    await waitFor(() => expect(rendered.onExecute).toHaveBeenCalled())
    expect(rendered.onExecute).toHaveBeenCalledWith('action.accept-main', actualTarget, 'mapped-intent', {
      expectedBaseSequence: 4,
      runtimeIntentAuthorization: resolution.options[0]!.authorization,
    })
  })

  it('多义候选先展示选择，不会在玩家选择前调用Action', async () => {
    const current = fixture()
    const accept = current.availableActions.find(item => item.action.key === 'action.accept-main')!
    const steal = current.availableActions.find(item => item.action.key === 'action.steal-tonic')!
    const options = [
      { action: accept, selectedKey: 'action.accept-main', label: '接受主线任务' },
      { action: steal, selectedKey: 'action.steal-tonic', label: '偷取盐露药剂' },
    ].map((item, index) => {
      const targetKey = item.action.validTargetKeys[0] ?? null
      const auth = authorization({
        runId: 200 + index,
        selectedKind: 'action',
        selectedKey: item.selectedKey,
        actionKey: item.action.action.key,
        targetKey,
      })
      return {
        optionKey: `action:${item.selectedKey}:${targetKey ?? 'none'}`,
        selectedKind: 'action' as const,
        selectedKey: item.selectedKey,
        actionKey: item.action.action.key,
        targetKey,
        label: item.label,
        description: item.action.action.description,
        confirmationRequired: item.action.confirmationRequired,
        authorization: auth,
      }
    })
    const rendered = await render(vi.fn(async request => ({
      version: 1,
      source: 'ai-candidate',
      status: 'needs-selection',
      selectedSceneKey: request.selectedSceneKey,
      baseSequence: 4,
      candidateHash: 'a'.repeat(64),
      contextManifestHash: 'b'.repeat(64),
      runId: 200,
      confidence: 0.9,
      options,
      replyText: '',
      boundaryExplanation: null,
    })))
    await inputValue(host, '我可以答应她，也可以顺手拿走药剂')
    await click(button(host, '提交'))
    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-intent-options"]')).not.toBeNull())
    expect(rendered.onExecute).not.toHaveBeenCalled()
    const optionGroup = host.querySelector('[data-testid="text-open-world-intent-options"]')
    if (!(optionGroup instanceof HTMLElement)) throw new Error('意图候选选项组不存在')
    await click(button(optionGroup, '偷取盐露药剂', true))
    expect(rendered.onExecute).toHaveBeenCalledWith(
      'action.steal-tonic',
      steal.validTargetKeys[0],
      'mapped-intent',
      expect.objectContaining({ expectedBaseSequence: 4 }),
    )
  })

  it('AI失败只降级自然输入，系统Action仍可立即使用', async () => {
    const rendered = await render(vi.fn(async () => { throw new Error('provider unavailable') }))
    await inputValue(host, '做一件没有冻结例句但合理的事')
    await click(button(host, '提交'))
    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-input-notice"]')?.textContent)
      .toContain('AI理解当前不可用'))
    expect(rendered.onExecute).not.toHaveBeenCalled()
    const systemAction = button(host, '接受主线任务', true)
    expect(systemAction.disabled).toBe(false)
    await click(systemAction)
    expect(rendered.onExecute).toHaveBeenCalled()
  })
})
