import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldCraftingEconomyPanel from '../../src/components/text-game/TextOpenWorldCraftingEconomyPanel'
import type {
  TextOpenWorldPlayerCraftingEconomyExecuteRequestV1,
  TextOpenWorldPlayerCraftingEconomyProjectionV1,
  TextOpenWorldPlayerCraftingEconomyReceiptV1,
} from '../../src/lib/open-world/player-crafting-economy'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function projection(
  sessionId = 71,
  expectedBaseSequence = 4,
): TextOpenWorldPlayerCraftingEconomyProjectionV1 {
  return {
    schema: 'storyforge.text-open-world.player-crafting-economy-projection',
    version: 1,
    operationIdentity: { sessionId, expectedBaseSequence },
    compatibility: { craftingReadOnly: false, economyReadOnly: false, notice: null },
    location: { title: '盐灯集市' },
    currency: { label: '盐票', amount: 25 },
    crafting: {
      learnedRecipes: [
        {
          operationTargetKey: 'recipe.private.tonic',
          title: '盐露药剂',
          description: '把盐晶调成可饮用的恢复药剂。',
          categoryLabel: '药剂',
          ingredients: [{ title: '盐晶', requiredQuantity: 2, inventoryQuantity: 5, sufficient: true }],
          outputs: [{ title: '盐露药剂', quantity: 1 }],
          timeCostMinutes: 15,
          maximumQuantity: 2,
          totalTimeCostAtMaximumQuantity: 30,
          available: true,
          unavailableReasons: [],
          action: {
            actionKey: 'action.private.craft-tonic',
            targetKey: 'recipe.private.tonic',
            label: '制作盐露药剂',
            description: '制作选定数量的盐露药剂。',
            available: true,
            confirmationRequired: true,
          },
        },
        {
          operationTargetKey: 'recipe.private.charm',
          title: '潮纹护符',
          description: '需要罕见贝片的护符。',
          categoryLabel: '装备',
          ingredients: [{ title: '月贝片', requiredQuantity: 3, inventoryQuantity: 0, sufficient: false }],
          outputs: [{ title: '潮纹护符', quantity: 1 }],
          timeCostMinutes: 40,
          maximumQuantity: 0,
          totalTimeCostAtMaximumQuantity: 0,
          available: false,
          unavailableReasons: [{ code: 'materials-insufficient', message: '材料不足：还需要月贝片 3。' }],
          action: {
            actionKey: 'action.private.craft-charm',
            targetKey: 'recipe.private.charm',
            label: '制作潮纹护符',
            description: '制作一件潮纹护符。',
            available: false,
            confirmationRequired: true,
          },
        },
      ],
      lockedRecipeCount: 1,
      lockedPlaceholder: {
        title: '未学习配方',
        message: '继续探索、完成任务或向人物学习后才会显示详情。',
      },
    },
    vendors: [{
      operationTargetKey: 'vendor.private.market',
      title: '盐灯杂货铺',
      merchantName: '拾潮人',
      available: true,
      unavailableReasons: [],
      attitude: { semantic: 'good', label: '友善' },
      priceExplanation: {
        buy: [
          { label: '商店买入倍率', multiplier: 1.1, display: '×1.10' },
          { label: '关系修正', multiplier: 0.9, display: '×0.90' },
        ],
        sell: [
          { label: '商店回收倍率', multiplier: 0.6, display: '×0.60' },
          { label: '关系修正', multiplier: 1.1, display: '×1.10' },
        ],
        buyRounding: '买价按最终结果向上取整。',
        sellRounding: '卖价按最终结果向下取整。',
      },
      buy: [{
        operationItemKey: 'item.private.crystal',
        title: '盐晶',
        description: '常用的药剂材料。',
        categoryLabel: '材料',
        playerQuantity: 5,
        stock: { kind: 'limited', quantity: 5, label: '剩余 5' },
        unitPrice: 4,
        maximumQuantity: 5,
        totalPriceAtMaximumQuantity: 20,
        available: true,
        unavailableReasons: [],
        action: {
          actionKey: 'action.private.buy',
          targetKey: 'vendor.private.market',
          itemKey: 'item.private.crystal',
          label: '买入盐晶',
          description: '从盐灯杂货铺买入盐晶。',
          available: true,
          confirmationRequired: true,
        },
        equipmentComparison: null,
      }, {
        operationItemKey: 'item.private.sword',
        title: '旧盐刀',
        description: '经过修补的短刀。',
        categoryLabel: '装备',
        playerQuantity: 1,
        stock: { kind: 'unlimited', quantity: null, label: '不限量' },
        unitPrice: 30,
        maximumQuantity: 0,
        totalPriceAtMaximumQuantity: 0,
        available: false,
        unavailableReasons: [{ code: 'currency-insufficient', message: '盐票不足：单件需要 30，当前持有 25。' }],
        action: {
          actionKey: 'action.private.buy',
          targetKey: 'vendor.private.market',
          itemKey: 'item.private.sword',
          label: '买入旧盐刀',
          description: '从盐灯杂货铺买入旧盐刀。',
          available: false,
          confirmationRequired: true,
        },
        equipmentComparison: {
          slotLabel: '武器',
          currentTitle: null,
          candidateTitle: '旧盐刀',
          note: '这是替换当前装备后的属性预览；购买不会自动装备物品。',
          stats: [{
            semantic: 'attack',
            label: '攻击',
            before: 7,
            after: 10,
            delta: 3,
            displayBefore: '7',
            displayAfter: '10',
            displayDelta: '+3',
            direction: 'increase',
          }],
          resourceAdjustmentMessages: [],
        },
      }],
      sell: [{
        operationItemKey: 'item.private.tonic',
        title: '盐露药剂',
        description: '可以出售的恢复药剂。',
        categoryLabel: '消耗品',
        playerQuantity: 2,
        stock: { kind: 'limited', quantity: 1, label: '商店已有 1' },
        unitPrice: 3,
        maximumQuantity: 2,
        totalPriceAtMaximumQuantity: 6,
        available: true,
        unavailableReasons: [],
        action: {
          actionKey: 'action.private.sell',
          targetKey: 'vendor.private.market',
          itemKey: 'item.private.tonic',
          label: '卖出盐露药剂',
          description: '向盐灯杂货铺卖出盐露药剂。',
          available: true,
          confirmationRequired: true,
        },
        equipmentComparison: null,
      }, {
        operationItemKey: 'item.private.seal',
        title: '守渠印',
        description: '受关键物品保护。',
        categoryLabel: '任务物品',
        playerQuantity: 1,
        stock: { kind: 'limited', quantity: 0, label: '商店没有库存' },
        unitPrice: 1,
        maximumQuantity: 0,
        totalPriceAtMaximumQuantity: 0,
        available: false,
        unavailableReasons: [{ code: 'item-protected', message: '关键物品不能出售。' }],
        action: null,
        equipmentComparison: null,
      }],
    }],
  }
}

function receipt(
  request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1,
  input: Partial<Pick<TextOpenWorldPlayerCraftingEconomyReceiptV1, 'status' | 'title' | 'message' | 'details'>> = {},
): TextOpenWorldPlayerCraftingEconomyReceiptV1 {
  return {
    request,
    phase: 'terminal',
    status: 'succeeded',
    outcomeCommitted: true,
    resultingSequence: request.expectedBaseSequence + 2,
    title: '操作完成',
    message: '正式事务已写入当前存档。',
    details: [],
    ...input,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function buttonContaining(scope: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮：${text}`)
  return button
}

function setNumber(input: HTMLInputElement, value: number) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value))
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Text Open World G4-10 · 制作、商店和交易 UI', () => {
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

  it('展示公开配方、材料库存、产物与锁定占位，并在本地摘要二次确认后提交精确请求', async () => {
    const pending = deferred<TextOpenWorldPlayerCraftingEconomyReceiptV1>()
    const onExecute = vi.fn(() => pending.promise)
    await act(async () => {
      root.render(createElement(TextOpenWorldCraftingEconomyPanel, {
        sessionKey: 'session-a', projection: projection(), busy: false, onExecute,
      }))
    })

    expect(host.textContent).toContain('当前位置：盐灯集市')
    expect(host.textContent).toContain('持有盐票25')
    expect(host.querySelectorAll('[data-testid="text-open-world-recipe-option"]')).toHaveLength(2)
    const locked = host.querySelectorAll('[data-testid="text-open-world-locked-recipe-placeholder"]')
    expect(locked).toHaveLength(1)
    expect(locked[0]?.textContent).toContain('未学习配方')
    expect(locked[0]?.textContent).not.toMatch(/潮汐秘方|recipe\.|action\.|item\./)

    const allFilter = host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-recipe-filter-all"]')!
    const availableFilter = host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-recipe-filter-available"]')!
    const materialFilter = host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-recipe-filter-materials-insufficient"]')!
    expect(allFilter.textContent).toContain('全部 2')
    expect(availableFilter.textContent).toContain('可制作 1')
    expect(materialFilter.textContent).toContain('材料不足 1')

    await act(async () => setNumber(host.querySelector<HTMLInputElement>('[aria-label="制作数量"]')!, 2))
    await act(async () => materialFilter.click())
    expect(Array.from(host.querySelectorAll('[data-testid="text-open-world-recipe-option"]')).map(node => node.textContent))
      .toEqual([expect.stringContaining('潮纹护符')])
    expect(host.querySelector('[data-testid="text-open-world-locked-recipe-placeholder"]')).toBeNull()
    expect(host.querySelector<HTMLInputElement>('[aria-label="制作数量"]')?.value).toBe('1')

    await act(async () => availableFilter.click())
    expect(Array.from(host.querySelectorAll('[data-testid="text-open-world-recipe-option"]')).map(node => node.textContent))
      .toEqual([expect.stringContaining('盐露药剂')])
    await act(async () => allFilter.click())
    expect(host.querySelectorAll('[data-testid="text-open-world-locked-recipe-placeholder"]')).toHaveLength(1)

    const detail = host.querySelector('[data-testid="text-open-world-recipe-detail"]')!
    expect(detail.textContent).toContain('盐晶')
    expect(detail.textContent).toContain('需要 2 / 库存 5')
    expect(detail.textContent).toContain('盐露药剂×1')
    expect(detail.textContent).toContain('耗时 15 分钟')

    const quantity = host.querySelector<HTMLInputElement>('[aria-label="制作数量"]')!
    await act(async () => setNumber(quantity, 2))
    expect(detail.textContent).toContain('需要 4 / 库存 5')
    expect(detail.textContent).toContain('盐露药剂×2')
    expect(detail.textContent).toContain('耗时 30 分钟')

    const submit = host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-craft-submit"]')!
    await act(async () => submit.click())
    const dialog = host.querySelector<HTMLElement>('[role="alertdialog"]')!
    const background = host.querySelector<HTMLElement>('[data-testid="text-open-world-crafting-economy-content"]')!
    expect(dialog.textContent).toContain('确认制作“盐露药剂”')
    expect(dialog.textContent).toContain('数量：2 份')
    expect(dialog.textContent).toContain('材料：盐晶 ×4')
    expect(onExecute).not.toHaveBeenCalled()
    expect(background.hasAttribute('inert')).toBe(true)
    expect(background.getAttribute('aria-hidden')).toBe('true')
    expect(dialog.closest('[inert]')).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('[data-testid="text-open-world-crafting-economy-confirm-submit"]'))
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
    expect(document.activeElement).toBe(dialog.querySelector('[aria-label="取消并关闭确认"]'))
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })))
    expect(document.activeElement).toBe(host.querySelector('[data-testid="text-open-world-crafting-economy-confirm-submit"]'))

    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await act(async () => Promise.resolve())
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
    expect(background.hasAttribute('inert')).toBe(false)
    expect(background.getAttribute('aria-hidden')).toBeNull()
    expect(document.activeElement).toBe(submit)

    await act(async () => submit.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-crafting-economy-confirm-submit"]')!.click())
    const request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1 = {
      sessionId: 71,
      expectedBaseSequence: 4,
      kind: 'craft',
      actionKey: 'action.private.craft-tonic',
      targetKey: 'recipe.private.tonic',
      quantity: 2,
    }
    expect(onExecute).toHaveBeenCalledWith(request)
    expect(host.querySelector('[data-testid="text-open-world-crafting-economy-panel"]')?.getAttribute('aria-busy')).toBe('true')
    expect(host.textContent).toContain('正在等待正式规则结算')

    await act(async () => pending.resolve(receipt(request, {
      title: '制作完成',
      message: '盐露药剂 ×2 已放入背包。',
      details: ['盐晶 5 → 1', '世界时间推进 30 分钟'],
    })))
    expect(host.textContent).toContain('制作完成')
    expect(host.textContent).toContain('盐露药剂 ×2 已放入背包')
    expect(host.textContent).toContain('盐晶 5 → 1')

    await act(async () => buttonContaining(host, '潮纹护符').click())
    expect(host.textContent).toContain('材料不足：还需要月贝片 3')
    expect(host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-craft-submit"]')!.disabled).toBe(true)
    expect(host.outerHTML).not.toMatch(/recipe\.private|action\.private|item\.private|vendor\.private/)
  })

  it('买入与卖出页签展示库存、货币、单价总价和倍率说明，并公开禁用原因与错误', async () => {
    const calls: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1[] = []
    const onExecute = vi.fn((request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1) => {
      calls.push(request)
      if (request.kind === 'sell') throw new Error('交易状态已变化，请重新确认。')
      return receipt(request, { title: '买入完成', message: '盐晶 ×3 已放入背包。' })
    })
    await act(async () => {
      root.render(createElement(TextOpenWorldCraftingEconomyPanel, {
        sessionKey: 71, projection: projection(), busy: false, onExecute,
      }))
    })
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-shop-tab"]')!.click())

    expect(host.textContent).toContain('盐灯杂货铺')
    expect(host.textContent).toContain('拾潮人 · 友善')
    expect(host.textContent).toContain('商店买入倍率×1.10')
    expect(host.textContent).toContain('关系修正×0.90')
    expect(host.textContent).toContain('玩家库存5')
    expect(host.textContent).toContain('商店库存剩余 5')
    expect(host.textContent).toContain('单价4 盐票')

    await act(async () => buttonContaining(host, '旧盐刀').click())
    expect(host.textContent).toContain('盐票不足：单件需要 30，当前持有 25')
    expect(host.textContent).toContain('购买前查看装备属性比较')
    const comparison = host.querySelector('details')!
    comparison.open = true
    expect(comparison.textContent).toContain('购买不会自动装备物品')
    expect(comparison.textContent).toContain('攻击')
    expect(comparison.textContent).toContain('+3')
    expect(host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-trade-submit"]')!.disabled).toBe(true)

    await act(async () => buttonContaining(host, '盐晶').click())

    const quantity = host.querySelector<HTMLInputElement>('[aria-label="买入数量"]')!
    await act(async () => setNumber(quantity, 3))
    expect(host.querySelector('[data-testid="text-open-world-trade-detail"]')?.textContent).toContain('本次总价12 盐票')
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-trade-submit"]')!.click())
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('总价：12 盐票')
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('商店库存：剩余 5')
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('当前关系：友善')
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('关系倍率：关系修正 ×0.90')
    expect(calls).toHaveLength(0)
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-crafting-economy-confirm-submit"]')!.click())
    expect(calls).toEqual([{
      sessionId: 71,
      expectedBaseSequence: 4,
      kind: 'buy',
      actionKey: 'action.private.buy',
      targetKey: 'vendor.private.market',
      itemKey: 'item.private.crystal',
      quantity: 3,
    }])
    await act(async () => Promise.resolve())
    expect(host.textContent).toContain('买入完成')

    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-sell-tab"]')!.click())
    expect(host.textContent).toContain('商店回收倍率×0.60')
    expect(host.textContent).toContain('关系修正×1.10')
    await act(async () => buttonContaining(host, '守渠印').click())
    expect(host.textContent).toContain('关键物品不能出售')
    expect(host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-trade-submit"]')!.disabled).toBe(true)

    await act(async () => buttonContaining(host, '盐露药剂').click())
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-trade-submit"]')!.click())
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('商店库存：商店已有 1')
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('当前关系：友善')
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('关系倍率：关系修正 ×1.10')
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-crafting-economy-confirm-submit"]')!.click())
    await act(async () => Promise.resolve())
    const feedback = host.querySelector('[data-testid="text-open-world-crafting-economy-feedback"]')!
    expect(feedback.getAttribute('role')).toBe('alert')
    expect(feedback.textContent).toContain('交易状态已变化，请重新确认')

    const leakyExecute = vi.fn(() => {
      throw new Error('action.private.sell 与 item.private.tonic 不匹配')
    })
    await act(async () => {
      root.render(createElement(TextOpenWorldCraftingEconomyPanel, {
        sessionKey: 71, projection: projection(), busy: false, onExecute: leakyExecute,
      }))
    })
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-trade-submit"]')!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-crafting-economy-confirm-submit"]')!.click())
    await act(async () => Promise.resolve())
    expect(feedback.textContent).toContain('请求未能完成，请确认当前状态后重试')
    expect(feedback.textContent).not.toMatch(/action\.private|item\.private/)

    await act(async () => {
      root.render(createElement(TextOpenWorldCraftingEconomyPanel, {
        sessionKey: 71, projection: projection(), busy: true, onExecute,
      }))
    })
    expect(host.querySelector<HTMLInputElement>('[aria-label="卖出数量"]')!.disabled).toBe(true)
    expect(host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-trade-submit"]')!.disabled).toBe(true)
  })

  it('Session 切换关闭确认、重置页签并隔离旧请求；外部回执必须完整命中请求归属', async () => {
    const oldPending = deferred<TextOpenWorldPlayerCraftingEconomyReceiptV1>()
    const onExecute = vi.fn((request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1) => (
      request.sessionId === 71 ? oldPending.promise : undefined
    ))
    const render = async (
      sessionKey: string,
      value: TextOpenWorldPlayerCraftingEconomyProjectionV1,
      valueReceipt: TextOpenWorldPlayerCraftingEconomyReceiptV1 | null = null,
    ) => {
      await act(async () => root.render(createElement(TextOpenWorldCraftingEconomyPanel, {
        sessionKey,
        projection: value,
        busy: false,
        receipt: valueReceipt,
        onExecute,
      })))
    }

    await render('session-a', projection(71, 4))
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-recipe-filter-materials-insufficient"]')!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-shop-tab"]')!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-trade-submit"]')!.click())
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull()

    await render('session-b', projection(72, 9))
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
    expect(host.querySelector('[data-testid="text-open-world-crafting-tab"]')?.getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector('[data-testid="text-open-world-recipe-filter-all"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector<HTMLInputElement>('[aria-label="制作数量"]')?.value).toBe('1')

    await render('session-a', projection(71, 4))
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-shop-tab"]')!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-trade-submit"]')!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-crafting-economy-confirm-submit"]')!.click())
    expect(onExecute).toHaveBeenCalledTimes(1)
    await render('session-b', projection(72, 9))

    const sessionBQuantity = host.querySelector<HTMLInputElement>('[aria-label="制作数量"]')!
    await act(async () => setNumber(sessionBQuantity, 2))
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-craft-submit"]')!.click())
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull()
    await render('session-b', projection(72, 10))
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
    expect(host.querySelector<HTMLInputElement>('[aria-label="制作数量"]')?.value).toBe('1')
    expect(document.activeElement).toBe(host.querySelector('#text-open-world-crafting-economy-title'))

    const craftSubmit = host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-craft-submit"]')!
    await act(async () => craftSubmit.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-crafting-economy-confirm-submit"]')!.click())
    const sessionBRequest = onExecute.mock.calls.at(-1)?.[0] as TextOpenWorldPlayerCraftingEconomyExecuteRequestV1
    expect(sessionBRequest.sessionId).toBe(72)
    expect(sessionBRequest.expectedBaseSequence).toBe(10)

    const wrongQuantity = { ...sessionBRequest, quantity: 2 }
    await render('session-b', projection(72, 10), receipt(wrongQuantity, { title: '错误归属回执' }))
    expect(host.textContent).not.toContain('错误归属回执')
    await render('session-b', projection(72, 10), receipt(sessionBRequest, { title: '当前存档制作完成' }))
    expect(host.textContent).toContain('当前存档制作完成')

    const oldRequest: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1 = {
      sessionId: 71,
      expectedBaseSequence: 4,
      kind: 'buy',
      actionKey: 'action.private.buy',
      targetKey: 'vendor.private.market',
      itemKey: 'item.private.crystal',
      quantity: 1,
    }
    await act(async () => oldPending.resolve(receipt(oldRequest, { title: '旧存档买入完成' })))
    expect(host.textContent).not.toContain('旧存档买入完成')

    await render('session-c', projection(73, 10), receipt(sessionBRequest, { title: '上一存档回执' }))
    expect(host.textContent).not.toContain('上一存档回执')
  })
})
