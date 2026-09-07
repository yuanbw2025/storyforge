import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldMapPanel from '../../src/components/text-game/TextOpenWorldMapPanel'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import type {
  TextOpenWorldFeedbackReceiptV1,
  TextOpenWorldSessionProjectionV1,
} from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function createProjection(): TextOpenWorldSessionProjectionV1 {
  return createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())
}

function ridgeSvgNode(host: ParentNode): SVGElement {
  const node = host.querySelector('[data-map-location="location.ridge-channel"]')
  if (!(node instanceof SVGElement)) throw new Error('找不到断脊渠口 SVG 节点')
  return node
}

function ridgeListItem(host: ParentNode): HTMLElement {
  const item = Array.from(host.querySelectorAll('[aria-label="地图列表视图"] [role="listitem"]'))
    .find(candidate => candidate.textContent?.includes('断脊渠口'))
  if (!(item instanceof HTMLElement)) throw new Error('找不到断脊渠口列表项')
  return item
}

function detailTravelButton(host: ParentNode): HTMLButtonElement {
  const button = host.querySelector('[aria-label="选中地点详情"] button[aria-label*="耗时60分钟"]')
  if (!(button instanceof HTMLButtonElement)) throw new Error('找不到详情区普通旅行按钮')
  return button
}

function feedback(
  actionKey: string,
  sessionId = 41,
  headline = '旅行成功',
  targetKey = 'location.ridge-channel',
  baseSequence = 0,
): TextOpenWorldFeedbackReceiptV1 {
  return {
    schema: 'storyforge.text-open-world.feedback-receipt',
    version: 1,
    phase: 'terminal',
    status: 'succeeded',
    sessionId,
    commandId: `command.map.${sessionId}`,
    actionKey,
    targetKey,
    baseSequence,
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
      headline,
      details: [`这条反馈只属于 Session ${sessionId}。`],
      mayNarrateSuccess: true,
    },
    evidenceEventIds: [],
    evidenceEventSequences: [],
    receiptHash: 'c'.repeat(64),
  }
}

describe('Text Open World G4-06 · 玩家 SVG 地图与确定性旅行 UI', () => {
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

  it('SVG 点击和键盘只改变选点，高亮道路后由详情按钮提交一次精确 Session-bound 请求', async () => {
    const projection = createProjection()
    const onTravel = vi.fn()
    await act(async () => {
      root.render(createElement(TextOpenWorldMapPanel, {
        projection,
        runtimeEventSequence: 0,
        busy: false,
        sessionKey: 'session.map.41',
        onTravel,
      }))
    })

    const ridge = ridgeSvgNode(host)
    await act(async () => ridge.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onTravel).not.toHaveBeenCalled()
    expect(ridge.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[aria-label="选中地点详情"]')?.getAttribute('data-selected-location'))
      .toBe('location.ridge-channel')
    expect(host.querySelector('[data-map-route="edge.port-ridge"]')?.getAttribute('data-route-selected'))
      .toBe('true')

    const port = host.querySelector('[data-map-location="location.salt-port"]')!
    await act(async () => port.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onTravel).not.toHaveBeenCalled()
    expect(port.getAttribute('aria-pressed')).toBe('true')
    await act(async () => ridge.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
    expect(onTravel).not.toHaveBeenCalled()

    const travel = detailTravelButton(host)
    await act(async () => {
      travel.click()
      travel.click()
    })
    expect(onTravel).toHaveBeenCalledTimes(1)
    expect(onTravel).toHaveBeenCalledWith({
      sessionKey: 'session.map.41',
      expectedBaseSequence: 0,
      kind: 'travel',
      actionKey: 'action.travel-port-ridge',
      destinationLocationKey: 'location.ridge-channel',
    })
  })

  it('听说地点只显示名称与通行信息，不在 SVG、详情或列表中泄露冻结内容', async () => {
    const projection = createProjection()
    await act(async () => {
      root.render(createElement(TextOpenWorldMapPanel, {
        projection,
        runtimeEventSequence: 0,
        busy: false,
        sessionKey: 42,
        onTravel: vi.fn(),
      }))
    })
    await act(async () => ridgeSvgNode(host).dispatchEvent(new MouseEvent('click', { bubbles: true })))

    const detail = host.querySelector('[aria-label="选中地点详情"]')!
    const listItem = ridgeListItem(host)
    expect(ridgeSvgNode(host).getAttribute('data-map-knowledge')).toBe('heard')
    expect(detail.textContent).toContain('断脊渠口')
    expect(detail.textContent).toContain('亲自到访后才能了解更多')
    expect(detail.textContent).not.toContain('被碎石阻塞的上游渠口')
    expect(detail.textContent).not.toContain('荒野危险与断流真相')
    expect(detail.textContent).not.toContain('建议等级')
    expect(detail.textContent).not.toContain('地点类型')
    expect(detail.querySelector('[aria-label="地点功能"]')).toBeNull()
    expect(listItem.textContent).not.toContain('被碎石阻塞的上游渠口')
    expect(host.textContent).not.toContain('承载上游探索、战斗和盐渠主线后续')
  })

  it('移动端等价地点列表先选点再执行，不把查看地点误当成旅行', async () => {
    const projection = createProjection()
    const onTravel = vi.fn()
    await act(async () => {
      root.render(createElement(TextOpenWorldMapPanel, {
        projection,
        runtimeEventSequence: 0,
        busy: false,
        sessionKey: 43,
        onTravel,
      }))
    })

    const item = ridgeListItem(host)
    const select = Array.from(item.querySelectorAll('button'))
      .find(button => button.textContent?.includes('断脊渠口'))
    expect(select).toBeInstanceOf(HTMLButtonElement)
    await act(async () => (select as HTMLButtonElement).click())
    expect(onTravel).not.toHaveBeenCalled()
    expect(item.getAttribute('data-selected')).toBe('true')

    const travel = item.querySelector('button[aria-label*="耗时60分钟"]')
    expect(travel).toBeInstanceOf(HTMLButtonElement)
    await act(async () => (travel as HTMLButtonElement).click())
    expect(onTravel).toHaveBeenCalledTimes(1)
    expect(onTravel.mock.calls[0][0]).toMatchObject({
      sessionKey: 43,
      expectedBaseSequence: 0,
      kind: 'travel',
      actionKey: 'action.travel-port-ridge',
      destinationLocationKey: 'location.ridge-channel',
    })
  })

  it('道路阻断与投影序号过期都禁用执行并给出可恢复的公开原因', async () => {
    const blockedProjection = createProjection()
    blockedProjection.state.map.openEdgeKeys = []
    const onTravel = vi.fn()
    await act(async () => {
      root.render(createElement(TextOpenWorldMapPanel, {
        projection: blockedProjection,
        runtimeEventSequence: 0,
        busy: false,
        sessionKey: 44,
        onTravel,
      }))
    })
    await act(async () => ridgeSvgNode(host).dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const blocked = detailTravelButton(host)
    expect(blocked.disabled).toBe(true)
    expect(blocked.title).toBe('这条道路当前不能通行。')
    expect(host.querySelector('[aria-label="选中地点详情"]')?.textContent).toContain('这条道路当前不能通行。')
    expect(host.querySelector('[data-map-route="edge.port-ridge"]')?.getAttribute('stroke-dasharray')).toBe('20 16')

    const fresh = createProjection()
    await act(async () => {
      root.render(createElement(TextOpenWorldMapPanel, {
        projection: fresh,
        runtimeEventSequence: 0,
        busy: false,
        sessionKey: 45,
        onTravel,
      }))
    })
    await act(async () => ridgeSvgNode(host).dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const advanced = structuredClone(fresh)
    advanced.lastEventSequence = 1
    await act(async () => {
      root.render(createElement(TextOpenWorldMapPanel, {
        projection: advanced,
        runtimeEventSequence: 1,
        busy: false,
        sessionKey: 45,
        onTravel,
      }))
    })
    const stale = detailTravelButton(host)
    expect(stale.disabled).toBe(true)
    expect(stale.title).toBe('地图状态已经变化，请重新选择地点后再出发。')
    expect(host.textContent).toContain('地图状态已经变化，请重新选择地点后再出发。')
    await act(async () => {
      const reselect = Array.from(host.querySelectorAll('button'))
        .find(button => button.textContent?.includes('重新选择'))
      ;(reselect as HTMLButtonElement).click()
    })
    expect(detailTravelButton(host).disabled).toBe(false)
    expect(onTravel).not.toHaveBeenCalled()
  })

  it('切换 Session 会使旧请求失效、释放提交锁，并只接收新 Session 的精确回执', async () => {
    const projection = createProjection()
    let resolveOldRequest!: (receipt: TextOpenWorldFeedbackReceiptV1) => void
    const oldRequest = new Promise<TextOpenWorldFeedbackReceiptV1>(resolve => { resolveOldRequest = resolve })
    const onTravel = vi.fn()
      .mockReturnValueOnce(oldRequest)
      .mockResolvedValueOnce(feedback('action.travel-port-ridge', 42, '新 Session 旅行成功'))
    const render = async (sessionKey: number) => {
      await act(async () => {
        root.render(createElement(TextOpenWorldMapPanel, {
          projection,
          runtimeEventSequence: 0,
          busy: false,
          sessionKey,
          onTravel,
        }))
      })
    }
    await render(41)
    await act(async () => ridgeSvgNode(host).dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => detailTravelButton(host).click())
    expect(host.querySelector('[aria-label="选中地点详情"]')?.getAttribute('data-selected-location'))
      .toBe('location.ridge-channel')

    await render(42)
    expect(host.querySelector('[aria-label="选中地点详情"]')?.getAttribute('data-selected-location'))
      .toBe('location.salt-port')
    expect(host.querySelector('[data-testid="text-open-world-map-feedback"]')).toBeNull()
    expect(ridgeListItem(host).getAttribute('data-selected')).toBeNull()

    await act(async () => resolveOldRequest(feedback('action.travel-port-ridge', 41, '旧 Session 旅行成功')))
    expect(host.querySelector('[data-testid="text-open-world-map-feedback"]')).toBeNull()
    expect(host.textContent).not.toContain('旧 Session 旅行成功')

    await act(async () => ridgeSvgNode(host).dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => detailTravelButton(host).click())
    expect(onTravel).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[data-testid="text-open-world-map-feedback"]')?.textContent)
      .toContain('新 Session 旅行成功')
  })

  it('共用同一快旅Action时拒绝目标或外层事件基线不属于本次请求的回执', async () => {
    const projection = createProjection()
    projection.state.map.currentLocationKey = 'location.ridge-channel'
    projection.state.map.regionKnowledgeByKey['region.ridge'] = 'visited'
    projection.state.map.locationKnowledgeByKey['location.ridge-channel'] = 'visited'
    projection.state.map.unlockedFastTravelPointKeys.push('fast-travel.ridge')
    const onTravel = vi.fn()
      .mockResolvedValueOnce(feedback(
        'action.fast-travel', 46, '错误目标的成功回执', 'location.ridge-channel', 3,
      ))
      .mockResolvedValueOnce(feedback(
        'action.fast-travel', 46, '错误基线的成功回执', 'location.salt-port', 2,
      ))
    await act(async () => {
      root.render(createElement(TextOpenWorldMapPanel, {
        projection,
        runtimeEventSequence: 3,
        busy: false,
        sessionKey: 46,
        onTravel,
      }))
    })

    const choose = Array.from(host.querySelectorAll('[aria-label="快速旅行列表"] button'))
      .find(button => button.textContent === '查看快旅路线') as HTMLButtonElement
    await act(async () => choose.click())
    const fast = host.querySelector('button[aria-label^="快速旅行"]') as HTMLButtonElement
    await act(async () => { fast.click(); await Promise.resolve() })
    expect(host.querySelector('[data-testid="text-open-world-map-feedback"]')?.textContent)
      .toContain('旅行结果与本次请求不一致')
    expect(host.textContent).not.toContain('错误目标的成功回执')

    await act(async () => { fast.click(); await Promise.resolve() })
    expect(onTravel).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[data-testid="text-open-world-map-feedback"]')?.textContent)
      .toContain('旅行结果与本次请求不一致')
    expect(host.textContent).not.toContain('错误基线的成功回执')
  })
})
