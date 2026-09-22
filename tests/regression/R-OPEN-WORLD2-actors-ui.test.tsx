import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import TextOpenWorldActorsPanel from '../../src/components/text-game/TextOpenWorldActorsPanel'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

describe('Text Open World vNext · actor UI projection', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('展示当前位置、角色层级、当前活动、态度和营业服务，不展示人物小传', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    root.render(createElement(TextOpenWorldActorsPanel, {
      runtimePackage,
      state: projection.state,
      attitudeByActorKey: { 'actor.caretaker': 'good' },
    }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(container.querySelector('[data-testid="text-open-world-current-actors"]')?.textContent).toContain('岑阿婆')
    expect(container.textContent).toContain('主线角色')
    expect(container.textContent).toContain('检查内渠')
    expect(container.textContent).toContain('友好')
    expect(container.textContent).toContain('问候语气：友善且愿意帮助')
    expect(container.textContent).toContain('守渠补给（营业中）')
    expect(container.textContent).not.toContain('盐港最后一位老守渠人')
    root.unmount()
  })

  it('显示显式绑定的角色头像，解析失败时保留文字头像回退', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    root.render(createElement(TextOpenWorldActorsPanel, {
      runtimePackage,
      state: projection.state,
      attitudeByActorKey: { 'actor.caretaker': 'good' },
      portraitByActorKey: {
        'actor.caretaker': {
          slotKey: 'slot.caretaker', assetKey: 'asset.caretaker', url: 'blob:caretaker',
          altText: '岑阿婆头像', fallbackText: '岑阿婆文字肖像',
        },
      },
    }))
    await new Promise(resolve => setTimeout(resolve, 0))
    const portrait = container.querySelector('[data-media-slot="slot.caretaker"] img')
    expect(portrait?.getAttribute('src')).toBe('blob:caretaker')
    expect(portrait?.getAttribute('alt')).toBe('岑阿婆头像')

    root.render(createElement(TextOpenWorldActorsPanel, {
      runtimePackage,
      state: projection.state,
      attitudeByActorKey: { 'actor.caretaker': 'good' },
      portraitByActorKey: {
        'actor.caretaker': {
          slotKey: 'slot.caretaker', assetKey: null, url: null,
          altText: '岑阿婆头像', fallbackText: '岑阿婆文字肖像',
        },
      },
    }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(container.querySelector('[data-media-slot="slot.caretaker"]')?.getAttribute('data-media-fallback')).toBe('true')
    expect(container.querySelector('[aria-label="岑阿婆文字肖像"]')?.textContent).toBe('岑')
    root.unmount()
  })
})
