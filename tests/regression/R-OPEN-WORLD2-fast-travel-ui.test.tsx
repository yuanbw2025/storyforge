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
})
