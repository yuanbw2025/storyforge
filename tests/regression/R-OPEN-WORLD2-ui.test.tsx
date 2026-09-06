import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DialogProvider } from '../../src/components/shared/Dialog'
import TextOpenWorldPlayer from '../../src/components/text-game/TextOpenWorldPlayer'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function button(host: ParentNode, text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.trim() === text)
  if (!result) throw new Error(`找不到按钮:${text}`)
  return result
}

function buttonContaining(host: ParentNode, text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes(text))
  if (!result) throw new Error(`找不到包含文本的按钮:${text}`)
  return result
}

async function click(host: ParentNode, text: string, contains = false) {
  await act(async () => {
    ;(contains ? buttonContaining(host, text) : button(host, text)).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function waitFor(assertion: () => void | Promise<void>) {
  const started = Date.now(); let last: unknown
  while (Date.now() - started < 12_000) {
    try { await act(async () => { await assertion() }); return }
    catch (reason) {
      last = reason
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

async function fixture() {
  const textOpenWorldVNext = createTextOpenWorldVNextFixture()
  ;(textOpenWorldVNext.modules.actions.payload as any).actions[0].successEffectKeys = ['effect.reward-currency', 'effect.investigate-time']
  return createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD vNext 玩家 UI-${crypto.randomUUID()}`,
    textOpenWorldVNext,
    title: '盐脊初始存档',
    seed: 'ui-vnext-seed',
  })
}

describe('Text Open World vNext · ProductRuntime vNext player UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeAll(async () => { await db.delete(); await db.open() })
  beforeEach(() => {
    localStorage.clear()
    useTextOpenWorldPlayerStore.setState({
      scope: null, worldGroupId: null, releases: [], sessions: [], selectedSessionId: null,
      events: [], checkpoints: [], runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
      selectedManifest: null, lastFeedback: null, generatedCandidate: null,
      loading: false, busy: false, error: '',
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  afterAll(() => db.close())

  it.sequential('正式ProductRelease可从玩家入口启动、执行Action并建立可恢复分支', async () => {
    const created = await fixture()
    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(TextOpenWorldPlayer, {
        project: created.project, scope: created.scope, worldGroupId: null,
      })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(host.textContent).toContain('盐脊'))
    await click(host, '新旅程')
    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-vnext-runtime"]')).toBeTruthy())
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().busy).toBe(false))
    expect(host.textContent).toContain('TEXT-OPEN-WORLD vNEXT · PRODUCT RELEASE PINNED')
    expect(host.textContent).toContain('Lv.1 · 0 EXP')
    expect(host.textContent).toContain('6 · 3 · 6.5% · 3')
    expect(host.textContent).toContain('baseHealth:20')
    await click(host, '检查盐渠', true)
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().lastFeedback).not.toBeNull())
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().busy).toBe(false))
    expect(useTextOpenWorldPlayerStore.getState().error).toBe('')
    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-feedback"]')?.textContent ?? '').toContain('检查盐渠已完成'))
    expect(useTextOpenWorldPlayerStore.getState().runtimeState.textOpenWorld?.state.inventory.currency).toBe(30)

    const input = host.querySelector('input[placeholder="检查点名称"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'vNext调查完成')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await waitFor(() => expect(button(host, '保存').disabled).toBe(false))
    await click(host, '保存')
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().checkpoints.some(item => item.name === 'vNext调查完成')).toBe(true))
    const parentId = useTextOpenWorldPlayerStore.getState().selectedSessionId
    await click(host, 'vNext调查完成', true)
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).not.toBe(parentId))
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().busy).toBe(false))
    const branchId = useTextOpenWorldPlayerStore.getState().selectedSessionId!
    expect(await readProductRuntimeState(branchId)).toMatchObject({
      lastSequence: 0,
      textOpenWorld: { lastEventSequence: 0, state: { inventory: { currency: 30 } } },
    })
    expect(await db.productRuntimeSessions.get(branchId)).toMatchObject({ parentSessionId: parentId })
    await click(host, '退出游戏')
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).toBeNull())
    expect(host.textContent).toContain('从正式发布开始开放世界旅程')
  }, 30_000)
})
