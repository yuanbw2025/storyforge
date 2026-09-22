import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TextOpenWorldGameShell, {
  type TextOpenWorldGameShellProps,
} from '../../src/components/text-game/TextOpenWorldGameShell'
import TextOpenWorldPlayerPreferencesPanel from '../../src/components/text-game/TextOpenWorldPlayerPreferencesPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function views(productionKey: string): TextOpenWorldGameShellProps['views'] {
  return {
    scene: createElement('p', null, '叙事正文'),
    map: createElement('p', null, '地图'),
    quests: createElement('p', null, '任务'),
    character: createElement('p', null, '角色'),
    more: createElement(TextOpenWorldPlayerPreferencesPanel, {
      productionKey,
      audioAvailable: false,
    }),
  }
}

function shell(productionKey: string) {
  return createElement(TextOpenWorldGameShell, {
    sessionKey: `session:${productionKey}`,
    preferenceProductionKey: productionKey,
    gameTitle: '盐脊',
    locationTitle: '盐港',
    sourceLabel: 'PRODUCT RELEASE v1 · 已固定',
    views: views(productionKey),
    context: createElement('p', null, '上下文'),
    status: createElement('span', null, '状态已落盘'),
    busy: false,
    error: '',
    onExit: () => undefined,
  })
}

async function change(input: HTMLInputElement, value: string | boolean) {
  await act(async () => {
    if (typeof value === 'boolean') {
      if (input.checked !== value) input.click()
    } else {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('Text Open World G4-12 · 玩家设置UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    localStorage.clear()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('由同作品设置面板实时更新游戏壳，不写入模型凭证语义', async () => {
    await act(async () => root.render(shell('fixture.preferences.ui')))
    const shellElement = host.querySelector<HTMLElement>('[data-testid="text-open-world-shell"]')!
    const panel = host.querySelector<HTMLElement>('[data-testid="text-open-world-player-preferences"]')!
    const ranges = panel.querySelectorAll<HTMLInputElement>('input[type="range"]')
    const toggles = panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')

    expect(shellElement.style.getPropertyValue('--open-world-reader-font-size')).toBe('18px')
    expect(shellElement.style.getPropertyValue('--open-world-reader-line-height')).toBe('1.9')
    await change(ranges[0]!, '24')
    await change(ranges[1]!, '2.2')
    await change(toggles[0]!, true)
    await change(toggles[1]!, true)
    await change(toggles[2]!, true)

    expect(shellElement.style.getPropertyValue('--open-world-reader-font-size')).toBe('24px')
    expect(Number(shellElement.style.getPropertyValue('--open-world-reader-line-height'))).toBeCloseTo(2.2)
    expect(shellElement.getAttribute('data-high-contrast')).toBe('true')
    expect(shellElement.getAttribute('data-reduced-motion')).toBe('true')
    expect(shellElement.getAttribute('data-muted')).toBe('true')
    expect(panel.textContent).toContain('确定性规则无需模型即可完整游玩')
    expect(panel.textContent).toContain('不会进入世界、存档、提示词、导出或 API 凭证')
    expect(panel.textContent).toContain('当前播放器尚未接入音频播放')
  })

  it('重新挂载同一作品会恢复浏览器偏好，另一作品保持默认', async () => {
    await act(async () => root.render(shell('fixture.preferences.persisted')))
    const fontSize = host.querySelector<HTMLInputElement>(
      '[data-testid="text-open-world-player-preferences"] input[type="range"]',
    )!
    await change(fontSize, '27')
    expect(host.querySelector<HTMLElement>('[data-testid="text-open-world-shell"]')!
      .style.getPropertyValue('--open-world-reader-font-size')).toBe('27px')

    await act(async () => root.render(shell('fixture.preferences.other-product')))
    expect(host.querySelector<HTMLElement>('[data-testid="text-open-world-shell"]')!
      .style.getPropertyValue('--open-world-reader-font-size')).toBe('18px')

    await act(async () => root.render(shell('fixture.preferences.persisted')))
    expect(host.querySelector<HTMLElement>('[data-testid="text-open-world-shell"]')!
      .style.getPropertyValue('--open-world-reader-font-size')).toBe('27px')
  })
})
