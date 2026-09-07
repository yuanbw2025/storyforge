import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldMapPanel from '../../src/components/text-game/TextOpenWorldMapPanel'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('Text Open World vNext · fast travel player UI', () => {
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

  it('只为已到访且已解锁的目的地显示同一正式快旅Action', async () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())
    const onTravel = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldMapPanel, { projection, busy: false, onTravel })))
    expect(host.querySelector('[aria-label="快速旅行列表"]')?.textContent).toContain('到访其他地点后可解锁快速旅行')

    projection.state.map.currentLocationKey = 'location.ridge-channel'
    projection.state.map.regionKnowledgeByKey['region.ridge'] = 'visited'
    projection.state.map.locationKnowledgeByKey['location.ridge-channel'] = 'visited'
    projection.state.map.unlockedFastTravelPointKeys.push('fast-travel.ridge')
    await act(async () => root.render(createElement(TextOpenWorldMapPanel, { projection, busy: false, onTravel })))
    const fastTravel = Array.from(host.querySelectorAll('[aria-label="快速旅行列表"] button'))
      .find(button => button.textContent === '快速旅行') as HTMLButtonElement | undefined
    expect(fastTravel).toBeTruthy()
    expect(host.querySelector('[aria-label="快速旅行列表"]')?.textContent).toContain('盐港广场 · 30分钟')
    await act(async () => fastTravel!.click())
    expect(onTravel).toHaveBeenCalledWith('action.fast-travel', 'location.salt-port')
  })

  it('任务定位只聚焦玩家已知地点，未知key不会泄露地图内容或抢走焦点', async () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())
    const onTravel = vi.fn()
    await act(async () => {
      root.render(createElement(TextOpenWorldMapPanel, {
        projection,
        busy: false,
        focusedLocationKey: 'location.salt-port',
        focusedLocationRequestId: 1,
        onTravel,
      }))
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const focused = host.querySelector('[aria-current="location"]')
    expect(focused?.textContent).toContain('盐港广场')
    expect(host.querySelectorAll('[data-task-focused="true"]')).toHaveLength(2)
    expect(document.activeElement).toBe(focused)
    expect(host.textContent).not.toContain('未公开')

    const sentinel = document.createElement('button')
    document.body.append(sentinel)
    sentinel.focus()
    await act(async () => {
      root.render(createElement(TextOpenWorldMapPanel, {
        projection,
        busy: false,
        focusedLocationKey: 'location.salt-port',
        focusedLocationRequestId: 2,
        onTravel,
      }))
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.activeElement).toBe(host.querySelector('[aria-current="location"]'))

    sentinel.focus()
    await act(async () => {
      root.render(createElement(TextOpenWorldMapPanel, {
        projection,
        busy: false,
        focusedLocationKey: 'location.never-disclosed',
        focusedLocationRequestId: 3,
        onTravel,
      }))
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(host.querySelector('[data-task-focused="true"]')).toBeNull()
    expect(document.activeElement).toBe(sentinel)
    expect(onTravel).not.toHaveBeenCalled()
    sentinel.remove()
  })
})
