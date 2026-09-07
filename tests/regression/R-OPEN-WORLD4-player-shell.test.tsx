import { act, createElement, useState, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldGameShell, {
  TEXT_OPEN_WORLD_GAME_VIEW_KEYS,
  type TextOpenWorldGameShellProps,
} from '../../src/components/text-game/TextOpenWorldGameShell'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const NAVIGATION_LABELS = ['场景', '地图', '任务', '角色', '更多'] as const

type OverlayAwareShellProps = TextOpenWorldGameShellProps & {
  onDismissOverlay(): void
}

const OverlayAwareShell = TextOpenWorldGameShell as ComponentType<OverlayAwareShellProps>

function views(): TextOpenWorldGameShellProps['views'] {
  return Object.fromEntries(TEXT_OPEN_WORLD_GAME_VIEW_KEYS.map(view => [
    view,
    createElement('article', { 'data-testid': `view-content-${view}` }, `${view} content`),
  ])) as TextOpenWorldGameShellProps['views']
}

function props(overrides: Partial<TextOpenWorldGameShellProps> = {}): TextOpenWorldGameShellProps {
  return {
    sessionKey: 1,
    gameTitle: '盐脊',
    locationTitle: '盐港',
    sourceLabel: 'PRODUCT RELEASE v1 · 已固定',
    views: views(),
    context: createElement('div', null, '盐港 · 守渠人 · 状态良好'),
    status: createElement('div', null, 'Lv.1 · 生命 20/20 · 第 1 天'),
    navigationSupplement: createElement('p', null, '当前任务：检查盐渠'),
    onExit: vi.fn(),
    ...overrides,
  }
}

function buttonByText(host: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.trim() === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮:${text}`)
  return button
}

function buttonByLabel(host: ParentNode, label: string): HTMLButtonElement {
  const button = host.querySelector(`button[aria-label="${label}"]`)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮:${label}`)
  return button
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function keyDown(target: EventTarget, key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  })
  await act(async () => {
    target.dispatchEvent(event)
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  return event
}

function OverlaySafetyHarness(props: {
  onDismiss(): void
  onUnderlyingAction(): void
}) {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const shellViews = views()
  shellViews.scene = createElement('article', null,
    createElement('button', {
      type: 'button',
      'aria-label': '打开高风险行动确认',
      onClick: () => setOverlayOpen(true),
    }, '打开确认'),
    createElement('button', {
      type: 'button',
      'aria-label': '底层正式行动',
      onClick: props.onUnderlyingAction,
    }, '底层正式行动'),
  )
  const dismiss = () => {
    props.onDismiss()
    setOverlayOpen(false)
  }
  const overlay = overlayOpen
    ? createElement('section', {
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-label': '确认高风险行动',
    },
    createElement('strong', null, '确认执行高风险行动'),
    createElement('button', { type: 'button' }, '确认执行'),
    createElement('button', { type: 'button', onClick: dismiss }, '取消'),
    )
    : null

  return createElement(OverlayAwareShell, {
    ...propsForHarness(shellViews),
    overlay,
    onDismissOverlay: dismiss,
  })
}

function propsForHarness(shellViews: TextOpenWorldGameShellProps['views']) {
  return props({ views: shellViews })
}

function installResponsiveViewport(initialWidth: number) {
  let width = initialWidth
  const queries = new Map<string, {
    list: MediaQueryList
    listeners: Set<EventListenerOrEventListenerObject>
    legacyListeners: Set<(event: MediaQueryListEvent) => void>
    previousMatches: boolean
  }>()
  const matches = (query: string) => {
    const maximum = query.match(/max-width\s*:\s*(\d+)px/i)?.[1]
    const minimum = query.match(/min-width\s*:\s*(\d+)px/i)?.[1]
    return (maximum == null || width <= Number(maximum))
      && (minimum == null || width >= Number(minimum))
  }
  const mediaEvent = (query: string) => {
    const event = new Event('change') as MediaQueryListEvent
    Object.defineProperties(event, {
      matches: { value: matches(query) },
      media: { value: query },
    })
    return event
  }

  vi.stubGlobal('innerWidth', width)
  vi.stubGlobal('matchMedia', vi.fn((query: string) => {
    const existing = queries.get(query)
    if (existing) return existing.list
    const listeners = new Set<EventListenerOrEventListenerObject>()
    const legacyListeners = new Set<(event: MediaQueryListEvent) => void>()
    let onchange: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null = null
    const list = {
      get matches() { return matches(query) },
      media: query,
      get onchange() { return onchange },
      set onchange(listener) { onchange = listener },
      addListener(listener: (event: MediaQueryListEvent) => void) { legacyListeners.add(listener) },
      removeListener(listener: (event: MediaQueryListEvent) => void) { legacyListeners.delete(listener) },
      addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
        if (type === 'change' && listener) listeners.add(listener)
      },
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
        if (type === 'change' && listener) listeners.delete(listener)
      },
      dispatchEvent(event: Event) {
        listeners.forEach(listener => {
          if (typeof listener === 'function') listener.call(list, event)
          else listener.handleEvent(event)
        })
        return !event.defaultPrevented
      },
    } as MediaQueryList
    queries.set(query, {
      list,
      listeners,
      legacyListeners,
      previousMatches: matches(query),
    })
    return list
  }))

  return {
    async setWidth(nextWidth: number) {
      width = nextWidth
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: width,
      })
      await act(async () => {
        queries.forEach((record, query) => {
          const nextMatches = matches(query)
          if (record.previousMatches === nextMatches) return
          record.previousMatches = nextMatches
          const event = mediaEvent(query)
          record.list.dispatchEvent(event)
          record.legacyListeners.forEach(listener => listener.call(record.list, event))
          record.list.onchange?.call(record.list, event)
        })
        window.dispatchEvent(new Event('resize'))
        await new Promise(resolve => setTimeout(resolve, 0))
      })
    },
  }
}

describe('Text Open World G4 · 玩家游戏壳', () => {
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
    vi.unstubAllGlobals()
  })

  it('提供左侧导航、中央主视图和右侧上下文三栏 landmark', async () => {
    await act(async () => root.render(createElement(TextOpenWorldGameShell, props())))

    const shell = host.querySelector('[data-testid="text-open-world-shell"]')
    const navigation = host.querySelector('[data-testid="text-open-world-navigation-rail"]')
    const main = host.querySelector('[data-testid="text-open-world-main-view"]')
    const context = host.querySelector('[data-testid="text-open-world-context-rail"]')

    expect(shell?.tagName).toBe('SECTION')
    expect(host.querySelector('[data-testid="text-open-world-header"]')?.tagName).toBe('HEADER')
    expect(navigation?.tagName).toBe('ASIDE')
    expect(navigation?.querySelector('nav[aria-label="开放世界主导航"]')).toBeTruthy()
    expect(main?.tagName).toBe('MAIN')
    expect(context?.tagName).toBe('ASIDE')
    expect(context?.getAttribute('aria-label')).toBe('当前位置上下文')
    expect(host.querySelector('[data-testid="text-open-world-global-status"]')?.tagName).toBe('FOOTER')
    expect(host.textContent).toContain('当前任务：检查盐渠')
  })

  it('移动导航严格保持五个入口的顺序和唯一当前页', async () => {
    await act(async () => root.render(createElement(TextOpenWorldGameShell, props())))

    const mobile = host.querySelector('[data-testid="text-open-world-mobile-navigation"]')!
    const buttons = Array.from(mobile.querySelectorAll('button'))
    expect(mobile.getAttribute('aria-label')).toBe('开放世界移动导航')
    expect(buttons.map(button => button.textContent?.trim())).toEqual(NAVIGATION_LABELS)
    expect(buttons.filter(button => button.getAttribute('aria-current') === 'page').map(button => button.textContent?.trim()))
      .toEqual(['场景'])

    await click(buttons[2])
    expect(buttons.filter(button => button.getAttribute('aria-current') === 'page').map(button => button.textContent?.trim()))
      .toEqual(['任务'])
    const desktop = host.querySelector('[data-testid="text-open-world-navigation-rail"]')!
    expect(desktop.querySelector('button[aria-current="page"]')?.textContent?.trim()).toBe('任务')
  })

  it('切换面板后可稳定返回场景，且全局状态、来源和退出入口不被重建', async () => {
    const onExit = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldGameShell, props({ onExit }))))

    const shell = host.querySelector('[data-testid="text-open-world-shell"]')!
    const main = host.querySelector('[data-testid="text-open-world-main-view"]') as HTMLElement
    const header = host.querySelector('[data-testid="text-open-world-header"]')!
    const status = host.querySelector('[data-testid="text-open-world-global-status"]')!
    const exit = buttonByLabel(host, '退出游戏')

    const mobile = host.querySelector('[data-testid="text-open-world-mobile-navigation"]')!
    await click(buttonByText(mobile, '地图'))
    expect(shell.getAttribute('data-active-view')).toBe('map')
    expect(main.getAttribute('data-open-world-view')).toBe('map')
    expect(host.querySelector('[data-testid="view-content-map"]')?.closest('section')?.hidden).toBe(false)
    expect(onExit).not.toHaveBeenCalled()

    const desktop = host.querySelector('[data-testid="text-open-world-navigation-rail"]')!
    await click(buttonByText(desktop, '更多'))
    expect(shell.getAttribute('data-active-view')).toBe('more')
    expect(onExit).not.toHaveBeenCalled()

    await click(buttonByLabel(host, '返回当前场景'))
    expect(shell.getAttribute('data-active-view')).toBe('scene')
    expect(main.getAttribute('data-open-world-view')).toBe('scene')
    expect(host.querySelector('[data-testid="view-content-scene"]')?.closest('section')?.hidden).toBe(false)
    expect(host.querySelector('[data-testid="text-open-world-header"]')).toBe(header)
    expect(host.querySelector('[data-testid="text-open-world-global-status"]')).toBe(status)
    expect(buttonByLabel(host, '退出游戏')).toBe(exit)
    expect(header.textContent).toContain('PRODUCT RELEASE v1 · 已固定')
    expect(status.textContent).toContain('Lv.1 · 生命 20/20 · 第 1 天')
    expect(onExit).not.toHaveBeenCalled()

    await click(exit)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('上下文抽屉支持按钮关闭与 Escape，并把焦点还给触发器', async () => {
    await act(async () => root.render(createElement(TextOpenWorldGameShell, props())))

    const trigger = buttonByLabel(host, '打开当前位置上下文')
    await click(trigger)
    const context = host.querySelector('[data-testid="text-open-world-context-rail"]')!
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(context.getAttribute('role')).toBe('dialog')
    expect(context.getAttribute('aria-modal')).toBe('true')
    expect(host.querySelector('[data-testid="text-open-world-context-drawer"]')?.textContent)
      .toContain('盐港 · 守渠人 · 状态良好')
    const close = buttonByLabel(context, '关闭当前位置上下文')
    expect(document.activeElement).toBe(close)

    await click(close)
    expect(context.getAttribute('role')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)

    await click(trigger)
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => {
      window.dispatchEvent(escape)
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(escape.defaultPrevented).toBe(true)
    expect(context.getAttribute('role')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('sessionKey 变更时关闭抽屉并将纯 UI 导航复位到场景', async () => {
    const initial = props({ sessionKey: 'session-a' })
    await act(async () => root.render(createElement(TextOpenWorldGameShell, initial)))

    const desktop = host.querySelector('[data-testid="text-open-world-navigation-rail"]')!
    await click(buttonByText(desktop, '角色'))
    await click(buttonByLabel(host, '打开当前位置上下文'))
    expect(host.querySelector('[data-testid="text-open-world-shell"]')?.getAttribute('data-active-view')).toBe('character')
    expect(host.querySelector('[data-testid="text-open-world-context-rail"]')?.getAttribute('role')).toBe('dialog')

    await act(async () => {
      root.render(createElement(TextOpenWorldGameShell, { ...initial, sessionKey: 'session-b' }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(host.querySelector('[data-testid="text-open-world-shell"]')?.getAttribute('data-active-view')).toBe('scene')
    expect(host.querySelector('[data-testid="text-open-world-main-view"]')?.getAttribute('data-open-world-view')).toBe('scene')
    expect(host.querySelector('[data-testid="text-open-world-context-rail"]')?.getAttribute('role')).toBeNull()
    expect(buttonByLabel(host, '打开当前位置上下文').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(host.querySelector('[data-testid="text-open-world-main-view"]'))
  })

  it('确认层接管焦点、循环 Tab，并在 Escape 取消后恢复原触发器焦点', async () => {
    const onDismiss = vi.fn()
    await act(async () => root.render(createElement(OverlaySafetyHarness, {
      onDismiss,
      onUnderlyingAction: vi.fn(),
    })))

    const trigger = buttonByLabel(host, '打开高风险行动确认')
    trigger.focus()
    await click(trigger)

    const dialog = host.querySelector('[role="alertdialog"][aria-modal="true"]')!
    const confirm = buttonByText(dialog, '确认执行')
    const cancel = buttonByText(dialog, '取消')
    expect(document.activeElement).toBe(confirm)

    const reverseTab = await keyDown(confirm, 'Tab', true)
    expect(reverseTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(cancel)

    const forwardTab = await keyDown(cancel, 'Tab')
    expect(forwardTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(confirm)

    const escape = await keyDown(confirm, 'Escape')
    expect(escape.defaultPrevented).toBe(true)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('确认层存在时将底层正式行动标记为不可交互并从辅助语义树隐藏', async () => {
    await act(async () => root.render(createElement(OverlaySafetyHarness, {
      onDismiss: vi.fn(),
      onUnderlyingAction: vi.fn(),
    })))

    const trigger = buttonByLabel(host, '打开高风险行动确认')
    trigger.focus()
    await click(trigger)
    expect(host.querySelector('[role="alertdialog"][aria-modal="true"]')).toBeTruthy()

    const action = buttonByLabel(host, '底层正式行动')
    const main = host.querySelector('[data-testid="text-open-world-main-view"]')
    expect(main?.hasAttribute('inert')).toBe(true)
    expect(main?.getAttribute('aria-hidden')).toBe('true')
    expect(action.closest('[inert]')).toBe(main)
  })

  it('移动端上下文抽屉将 Tab 与 Shift+Tab 循环限制在抽屉内', async () => {
    installResponsiveViewport(390)
    await act(async () => root.render(createElement(TextOpenWorldGameShell, props({
      context: createElement('div', null,
        createElement('button', { type: 'button' }, '上下文首项'),
        createElement('button', { type: 'button' }, '上下文末项'),
      ),
    }))))

    await click(buttonByLabel(host, '打开当前位置上下文'))
    const context = host.querySelector('[data-testid="text-open-world-context-rail"]')!
    const close = buttonByLabel(context, '关闭当前位置上下文')
    const last = buttonByText(context, '上下文末项')
    expect(document.activeElement).toBe(close)

    const reverseTab = await keyDown(close, 'Tab', true)
    expect(reverseTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)

    const forwardTab = await keyDown(last, 'Tab')
    expect(forwardTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
  })

  it('移动端上下文抽屉进入桌面断点后关闭并恢复为普通上下文栏', async () => {
    const viewport = installResponsiveViewport(390)
    await act(async () => root.render(createElement(TextOpenWorldGameShell, props())))

    const trigger = buttonByLabel(host, '打开当前位置上下文')
    await click(trigger)
    const context = host.querySelector('[data-testid="text-open-world-context-rail"]')!
    expect(context.getAttribute('role')).toBe('dialog')
    expect(context.getAttribute('aria-modal')).toBe('true')

    await viewport.setWidth(1440)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(context.classList.contains('is-drawer-open')).toBe(false)
    expect(context.getAttribute('role')).toBeNull()
    expect(context.getAttribute('aria-modal')).toBeNull()
    expect(host.querySelector('[data-testid="text-open-world-context-drawer"]')).toBeNull()
  })
})
