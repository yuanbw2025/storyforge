import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TextOpenWorldInventoryPanel from '../../src/components/text-game/TextOpenWorldInventoryPanel'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import type {
  TextOpenWorldActorModuleV1,
  TextOpenWorldFeedbackReceiptV1,
  TextOpenWorldItemModuleV1,
  TextOpenWorldSessionProjectionV1,
} from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function inventoryProjection(input: {
  equippedSword?: boolean
  swordHealthBonus?: number
} = {}): TextOpenWorldSessionProjectionV1 {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const actors = runtimePackage.modules.actors.payload as TextOpenWorldActorModuleV1
  const items = runtimePackage.modules.items.payload as TextOpenWorldItemModuleV1
  actors.player.build.startingItemKeys.push('item.canal-seal')
  const sword = items.items.find(item => item.key === 'item.rust-sword')!
  if (input.swordHealthBonus) sword.statModifiers.maximumHealth = input.swordHealthBonus

  const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
  projection.state.inventory.stackQuantities['item.salt-crystal'] = 3
  projection.state.inventory.stackQuantities['item.brine-tonic'] = 2
  projection.state.player.health = projection.state.player.maximumHealth - 10

  if (input.equippedSword) {
    const instanceId = Object.entries(projection.state.inventory.itemInstances)
      .find(([, instance]) => instance.itemKey === 'item.rust-sword')![0]
    projection.state.inventory.equippedItemInstanceIdBySlot.weapon = instanceId
    projection.state.player.maximumHealth += input.swordHealthBonus ?? 0
    projection.state.player.health = projection.state.player.maximumHealth
  }
  return projection
}

function feedback(input: {
  actionKey: string
  targetKey: string
  headline: string
  details?: string[]
  receiptHash?: string
}): TextOpenWorldFeedbackReceiptV1 {
  return {
    schema: 'storyforge.text-open-world.feedback-receipt',
    version: 1,
    phase: 'terminal',
    status: 'succeeded',
    sessionId: 1,
    commandId: 'command.inventory-test',
    actionKey: input.actionKey,
    targetKey: input.targetKey,
    baseSequence: 0,
    outcomeCommitted: true,
    commandSequence: 1,
    resultingSequence: 2,
    resultingStateHash: 'a'.repeat(64),
    outcomeFingerprint: 'b'.repeat(64),
    gameplayStateChanged: true,
    changes: [],
    randomEvidence: [],
    reason: null,
    degradation: null,
    presentation: {
      headline: input.headline,
      details: input.details ?? [],
      mayNarrateSuccess: true,
    },
    evidenceEventIds: [1, 2],
    evidenceEventSequences: [1, 2],
    receiptHash: input.receiptHash ?? 'c'.repeat(64),
  }
}

function buttonStartingWith(scope: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.trim().startsWith(text))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮：${text}`)
  return button
}

function itemButton(scope: ParentNode, title: string): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll<HTMLButtonElement>(
    '[data-testid="text-open-world-inventory-item"]',
  )).find(candidate => candidate.textContent?.includes(title))
  if (!button) throw new Error(`找不到物品：${title}`)
  return button
}

function visibleItemTitles(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll('[data-testid="text-open-world-inventory-item"]'))
    .map(item => item.querySelector('strong')?.textContent ?? '')
}

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function setSelect(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('Text Open World G4-08 · 背包、物品详情与装备 UI', () => {
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

  it('展示背包摘要，并按类别、搜索、数量和基础价值稳定筛选排序', async () => {
    await act(async () => {
      root.render(createElement(TextOpenWorldInventoryPanel, {
        sessionKey: 1,
        projection: inventoryProjection(),
        busy: false,
        feedback: null,
        onExecute: () => undefined,
      }))
    })

    const panel = host.querySelector('[data-testid="text-open-world-inventory-panel"]')!
    const summary = panel.querySelector('[data-testid="text-open-world-inventory-summary"]')!
    expect(summary.textContent).toContain('种类4')
    expect(summary.textContent).toContain('总数量7')
    expect(summary.textContent).toContain('已装备0/3')
    expect(buttonStartingWith(panel, '其他').textContent).toContain('0')
    expect(visibleItemTitles(panel)).toEqual(['旧盐刀', '盐露药剂', '盐晶', '守渠印'])

    await act(async () => buttonStartingWith(panel, '材料').click())
    expect(visibleItemTitles(panel)).toEqual(['盐晶'])

    await act(async () => buttonStartingWith(panel, '全部').click())
    const search = panel.querySelector<HTMLInputElement>('[aria-label="搜索背包"]')!
    await act(async () => setInput(search, '恢复'))
    expect(visibleItemTitles(panel)).toEqual(['盐露药剂'])

    await act(async () => setInput(search, ''))
    const sort = panel.querySelector<HTMLSelectElement>('[aria-label="背包排序"]')!
    await act(async () => setSelect(sort, 'quantity'))
    expect(visibleItemTitles(panel).slice(0, 2)).toEqual(['盐晶', '盐露药剂'])
    await act(async () => setSelect(sort, 'base-value'))
    expect(visibleItemTitles(panel)).toEqual(['旧盐刀', '盐露药剂', '盐晶', '守渠印'])

    await act(async () => buttonStartingWith(panel, '其他').click())
    expect(panel.textContent).toContain('没有符合当前筛选的物品')
  })

  it('真实空背包仍保留摘要、分类、装备入口和安全空态', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const actors = runtimePackage.modules.actors.payload as TextOpenWorldActorModuleV1
    actors.player.build.startingItemKeys = []
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    await act(async () => {
      root.render(createElement(TextOpenWorldInventoryPanel, {
        sessionKey: 'empty-session',
        projection,
        busy: false,
        feedback: null,
        onExecute: () => undefined,
      }))
    })

    expect(host.querySelector('[data-testid="text-open-world-inventory-summary"]')?.textContent)
      .toContain('种类0')
    expect(host.textContent).toContain('背包为空')
    expect(buttonStartingWith(host, '全部').textContent).toContain('0')
    await act(async () => buttonStartingWith(host, '装备').click())
    expect(host.querySelectorAll('[data-testid="text-open-world-equipment-slot"]')).toHaveLength(3)
  })

  it('只提交投影给出的精确Action与物品目标，并正确显示详情、出售政策和关键保护', async () => {
    const calls: Array<[string, string]> = []
    await act(async () => {
      root.render(createElement(TextOpenWorldInventoryPanel, {
        sessionKey: 'session-a',
        projection: inventoryProjection(),
        busy: false,
        feedback: null,
        onExecute: (actionKey, targetKey) => { calls.push([actionKey, targetKey]) },
      }))
    })
    const panel = host.querySelector('[data-testid="text-open-world-inventory-panel"]')!

    await act(async () => itemButton(panel, '守渠印').click())
    const protectedDetail = panel.querySelector('[data-testid="text-open-world-inventory-detail"]')!
    expect(protectedDetail.textContent).toContain('初始配置包含此物品')
    expect(protectedDetail.textContent).toContain('基础价值（非成交价）')
    expect(protectedDetail.textContent).toContain('关键物品受到保护，不能丢弃、出售或作为材料消耗')
    expect(protectedDetail.textContent).not.toContain('前往商店交易')

    await act(async () => itemButton(panel, '盐晶').click())
    const materialDetail = panel.querySelector('[data-testid="text-open-world-inventory-detail"]')!
    expect(materialDetail.textContent).toContain('持有数量3')
    expect(materialDetail.textContent).toContain('可操作数量3')
    expect(materialDetail.textContent).toContain('前往商店交易')
    expect(materialDetail.textContent).toContain('此处只显示交易资格，不执行出售')
    const drop = buttonStartingWith(materialDetail, '丢弃盐晶')
    await act(async () => drop.click())
    expect(calls).toEqual([['action.drop-salt-crystal', 'item.salt-crystal']])
    expect(panel.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => itemButton(panel, '盐露药剂').click())
    await act(async () => buttonStartingWith(panel, '使用盐露药剂').click())
    await act(async () => itemButton(panel, '旧盐刀').click())
    await act(async () => buttonStartingWith(panel, '装备旧盐刀').click())
    expect(calls.slice(1)).toEqual([
      ['action.use-brine-tonic', 'item.brine-tonic'],
      ['action.equip-rust-sword', 'item.rust-sword'],
    ])

    const markup = panel.outerHTML
    expect(markup).not.toMatch(/item\.|action\.|effect\.|condition\.|instance\.|claim\./)
    expect(markup).not.toContain('sourceRefs')
    expect(markup).not.toContain('presentationRefs')
  })

  it('装备区展示三槽、旧值/新值/差值和资源裁剪提示，busy时阻止执行', async () => {
    const calls: Array<[string, string]> = []
    const projection = inventoryProjection({ equippedSword: true, swordHealthBonus: 5 })
    await act(async () => {
      root.render(createElement(TextOpenWorldInventoryPanel, {
        sessionKey: 1,
        projection,
        busy: false,
        feedback: null,
        onExecute: (actionKey, targetKey) => { calls.push([actionKey, targetKey]) },
      }))
    })
    await act(async () => buttonStartingWith(host, '装备').click())

    const equipment = host.querySelector('[data-testid="text-open-world-equipment-view"]')!
    const slots = equipment.querySelectorAll('[data-testid="text-open-world-equipment-slot"]')
    expect(slots).toHaveLength(3)
    const weapon = Array.from(slots).find(slot => slot.textContent?.includes('武器'))!
    expect(weapon.textContent).toContain('旧盐刀')
    expect(weapon.textContent).toContain('旧值')
    expect(weapon.textContent).toContain('新值')
    expect(weapon.textContent).toContain('差值')
    expect(weapon.textContent).toContain('最大生命')
    expect(weapon.textContent).toContain('-5')
    expect(weapon.textContent).toContain('资源上限变化提示')
    expect(weapon.textContent).toMatch(/当前生命将由\d+调整为\d+/)

    const unequip = buttonStartingWith(weapon, '卸下旧盐刀')
    await act(async () => unequip.click())
    expect(calls).toEqual([['action.unequip-rust-sword', 'item.rust-sword']])

    await act(async () => {
      root.render(createElement(TextOpenWorldInventoryPanel, {
        sessionKey: 1,
        projection,
        busy: true,
        feedback: null,
        onExecute: (actionKey, targetKey) => { calls.push([actionKey, targetKey]) },
      }))
    })
    const busyUnequip = buttonStartingWith(host, '卸下旧盐刀')
    expect(busyUnequip.disabled).toBe(true)
    await act(async () => busyUnequip.click())
    expect(calls).toHaveLength(1)
  })

  it('切换Session重置本地视图/筛选/排序，并且只展示本页最近请求的安全回执', async () => {
    const projection = inventoryProjection()
    const unrelated = feedback({
      actionKey: 'action.travel.somewhere',
      targetKey: 'location.somewhere',
      headline: '旧地图回执不应出现',
    })
    const render = async (sessionKey: string | number, receipt: TextOpenWorldFeedbackReceiptV1 | null) => {
      await act(async () => {
        root.render(createElement(TextOpenWorldInventoryPanel, {
          sessionKey,
          projection,
          busy: false,
          feedback: receipt,
          onExecute: () => undefined,
        }))
      })
    }

    await render('session-a', unrelated)
    expect(host.textContent).not.toContain('旧地图回执不应出现')
    await act(async () => buttonStartingWith(host, '材料').click())
    const search = host.querySelector<HTMLInputElement>('[aria-label="搜索背包"]')!
    const sort = host.querySelector<HTMLSelectElement>('[aria-label="背包排序"]')!
    await act(async () => setInput(search, '盐'))
    await act(async () => setSelect(sort, 'quantity'))
    await act(async () => buttonStartingWith(host, '装备').click())

    const staleMatching = feedback({
      actionKey: 'action.drop-salt-crystal',
      targetKey: 'item.salt-crystal',
      headline: '上一次丢弃已完成',
    })
    await render('session-b', staleMatching)
    expect(buttonStartingWith(host, '背包').getAttribute('aria-pressed')).toBe('true')
    expect(buttonStartingWith(host, '全部').getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector<HTMLInputElement>('[aria-label="搜索背包"]')!.value).toBe('')
    expect(host.querySelector<HTMLSelectElement>('[aria-label="背包排序"]')!.value).toBe('category')

    await act(async () => itemButton(host, '盐晶').click())
    await act(async () => buttonStartingWith(host, '丢弃盐晶').click())
    expect(host.textContent).not.toContain('上一次丢弃已完成')
    await render('session-b', staleMatching)
    expect(host.textContent).not.toContain('上一次丢弃已完成')
    const matching = feedback({
      actionKey: 'action.drop-salt-crystal',
      targetKey: 'item.salt-crystal',
      headline: '盐晶已丢弃',
      details: ['remove-item:item.salt-crystal:drop'],
      receiptHash: 'd'.repeat(64),
    })
    await render('session-b', matching)
    const live = host.querySelector('[data-testid="text-open-world-inventory-feedback"]')!
    expect(live.textContent).toContain('盐晶已丢弃')
    expect(live.textContent).not.toContain('remove-item')
    expect(live.outerHTML).not.toContain('item.salt-crystal')

    await render('session-c', matching)
    expect(host.textContent).not.toContain('盐晶已丢弃')

    await render(2, null)
    await act(async () => itemButton(host, '盐晶').click())
    await act(async () => buttonStartingWith(host, '丢弃盐晶').click())
    await render(2, feedback({
      actionKey: 'action.drop-salt-crystal',
      targetKey: 'item.salt-crystal',
      headline: '其他存档的丢弃回执',
      receiptHash: 'e'.repeat(64),
    }))
    expect(host.textContent).not.toContain('其他存档的丢弃回执')
  })
})
