import { act, StrictMode, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldTutorialCoach, {
  type TextOpenWorldAuthoredTutorialV1,
  type TextOpenWorldTutorialViewV1,
} from '../../src/components/text-game/TextOpenWorldTutorialCoach'
import {
  createTextOpenWorldPlayerTutorialStoreV1,
  type TextOpenWorldTutorialFeatureV1,
} from '../../src/lib/open-world/player-tutorials'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

type HiddenMode = 'visible' | 'hidden' | 'aria-hidden' | 'inert'

interface HarnessProps {
  productionKey: string
  sessionKey: string
  cycleKey: number
  activeView?: TextOpenWorldTutorialViewV1
  targetsMounted?: boolean
  hiddenMode?: HiddenMode
  hideNavigation?: boolean
  suspended?: boolean
  featureSupport: Readonly<Partial<Record<TextOpenWorldTutorialFeatureV1, boolean>>>
  featureAvailability: Readonly<Partial<Record<TextOpenWorldTutorialFeatureV1, boolean>>>
  availableActionKeys?: readonly string[]
  authoredTutorials?: readonly TextOpenWorldAuthoredTutorialV1[]
  onSelectView?: (view: TextOpenWorldTutorialViewV1) => void
  onGameAction?: () => void
}

function hiddenProps(mode: HiddenMode): React.HTMLAttributes<HTMLDivElement> {
  if (mode === 'hidden') return { hidden: true }
  if (mode === 'aria-hidden') return { 'aria-hidden': true }
  if (mode === 'inert') return { inert: true }
  return {}
}

function TutorialHarness(props: HarnessProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeView = props.activeView ?? 'scene'
  return <div ref={containerRef} data-testid="tutorial-test-container">
    {props.targetsMounted !== false && <><nav hidden={props.hideNavigation} aria-label="测试导航">
      {(['scene', 'map', 'quests', 'character', 'more'] as const).map(view => <button
        key={view}
        type="button"
        data-open-world-ui-key={`navigation.${view}`}
      >导航 {view}</button>)}
    </nav>
    <section hidden={activeView !== 'scene'}>
      <div {...hiddenProps(props.hiddenMode ?? 'visible')}>
        <article data-open-world-ui-key="play.scene">场景正文</article>
        <button
          type="button"
          data-open-world-ui-key="play.system-actions"
          onClick={props.onGameAction}
        >执行底层游戏行动</button>
        <button type="button" data-open-world-ui-key="play.fixed-choices">固定选项</button>
        <label data-open-world-ui-key="play.natural-language">
          自然语言<input aria-label="测试自然输入" />
        </label>
      </div>
      <section data-open-world-ui-key="overlay.combat">战斗面板</section>
    </section></>}
    <section hidden={activeView !== 'map'} data-open-world-ui-key="overlay.map">地图面板</section>
    <section hidden={activeView !== 'quests'} data-open-world-ui-key="overlay.quest-log">任务面板</section>
    <section hidden={activeView !== 'character'} data-open-world-ui-key="overlay.character overlay.skills">
      角色面板
    </section>
    <section hidden={activeView !== 'more'}>
      <div data-open-world-ui-key="overlay.inventory overlay.equipment">背包面板</div>
      <div data-open-world-ui-key="overlay.crafting overlay.shop">制作与商店</div>
      <div data-open-world-ui-key="system.save-branches system.settings-help">保存与设置</div>
    </section>
    <TextOpenWorldTutorialCoach
      sessionKey={props.sessionKey}
      productionKey={props.productionKey}
      runtimeChannel="release"
      cycleKey={props.cycleKey}
      activeView={activeView}
      featureSupport={props.featureSupport}
      featureAvailability={props.featureAvailability}
      availableActionKeys={props.availableActionKeys ?? []}
      authoredTutorials={props.authoredTutorials ?? []}
      suspended={props.suspended ?? false}
      containerRef={containerRef}
      onSelectView={props.onSelectView ?? (() => undefined)}
    />
  </div>
}

function byTestId(root: ParentNode, testId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
}

function buttonByText(root: ParentNode, text: string, contains = false): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll('button')).find(item => (
    contains ? item.textContent?.includes(text) : item.textContent?.trim() === text
  ))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮:${text}`)
  return button
}

function buttonByLabel(root: ParentNode, label: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`找不到按钮:${label}`)
  return button
}

function itemByText(root: ParentNode, text: string): HTMLLIElement {
  const item = Array.from(root.querySelectorAll('li')).find(row => row.textContent?.includes(text))
  if (!(item instanceof HTMLLIElement)) throw new Error(`找不到教程项:${text}`)
  return item
}

async function flush() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function keyDown(target: Element, key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  await act(async () => {
    target.dispatchEvent(event)
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  return event
}

async function waitFor(assertion: () => void, timeout = 2_000) {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeout) {
    try { assertion(); return }
    catch (error) { lastError = error }
    await flush()
  }
  throw lastError
}

describe('Text Open World G4-13B · 渐进教程Coach', () => {
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

  it('StrictMode重放挂载effect时不会把首个cycle误记为已展示后清空', async () => {
    await act(async () => root.render(<StrictMode><TutorialHarness
      productionKey={`tutorial-ui-strict-${crypto.randomUUID()}`}
      sessionKey="session-strict"
      cycleKey={1}
      featureSupport={{ scene: true }}
      featureAvailability={{ scene: true }}
    /></StrictMode>))
    await waitFor(() => expect(byTestId(host, 'text-open-world-tutorial-hint')).not.toBeNull())
    expect(byTestId(host, 'text-open-world-tutorial-hint')?.dataset.tutorialStepKey)
      .toBe('system.opening')
    expect(host.querySelector('[data-open-world-ui-key="play.scene"]')
      ?.getAttribute('data-open-world-tutorial-active')).toBe('system.opening')
  })

  it('容器内容稍后挂载时通过有界探测找到目标，不会无限轮询或漏掉首项', async () => {
    const props: HarnessProps = {
      productionKey: `tutorial-ui-late-target-${crypto.randomUUID()}`,
      sessionKey: 'session-late-target',
      cycleKey: 1,
      targetsMounted: false,
      featureSupport: { scene: true },
      featureAvailability: { scene: true },
    }
    await act(async () => root.render(<TutorialHarness {...props} />))
    expect(byTestId(host, 'text-open-world-tutorial-hint')).toBeNull()
    await act(async () => root.render(<TutorialHarness {...props} targetsMounted />))
    await waitFor(() => expect(byTestId(host, 'text-open-world-tutorial-hint')).not.toBeNull())
    expect(byTestId(host, 'text-open-world-tutorial-hint')?.dataset.tutorialTargetKey)
      .toBe('play.scene')
  })

  it('当前场景撤下教程对应功能时立即关闭旧提示，不保留失效高亮', async () => {
    const productionKey = `tutorial-ui-feature-withdrawn-${crypto.randomUUID()}`
    const base: HarnessProps = {
      productionKey,
      sessionKey: 'session-feature-withdrawn',
      cycleKey: 1,
      featureSupport: { 'fixed-choices': true },
      featureAvailability: { 'fixed-choices': true },
    }
    await act(async () => root.render(<TutorialHarness {...base} />))
    await waitFor(() => expect(byTestId(host, 'text-open-world-tutorial-hint')).not.toBeNull())
    const target = host.querySelector<HTMLElement>('[data-open-world-ui-key="play.fixed-choices"]')!
    expect(target.getAttribute('data-open-world-tutorial-active')).toBe('system.fixed-choices')

    await act(async () => root.render(<TutorialHarness
      {...base}
      featureAvailability={{ 'fixed-choices': false }}
    />))
    await flush()
    expect(byTestId(host, 'text-open-world-tutorial-hint')).toBeNull()
    expect(target.hasAttribute('data-open-world-tutorial-active')).toBe(false)
  })

  it('切换到同类控件但不同Action的场景时撤下旧作者提示', async () => {
    const productionKey = `tutorial-ui-action-withdrawn-${crypto.randomUUID()}`
    createTextOpenWorldPlayerTutorialStoreV1({
      productionKey,
      runtimeChannel: 'release',
    }).complete('system.system-actions')
    const base: HarnessProps = {
      productionKey,
      sessionKey: 'session-action-withdrawn',
      cycleKey: 1,
      featureSupport: { 'system-actions': true },
      featureAvailability: { 'system-actions': true },
      availableActionKeys: ['action.scene-a'],
      authoredTutorials: [{
        key: 'scene-a',
        triggerActionKey: 'action.scene-a',
        targetUiKey: 'play.system-actions',
        title: '场景 A 行动',
        body: '只解释场景 A 当前可见的行动。',
      }],
    }
    await act(async () => root.render(<TutorialHarness {...base} />))
    await waitFor(() => expect(byTestId(host, 'text-open-world-tutorial-hint')).not.toBeNull())
    expect(byTestId(host, 'text-open-world-tutorial-hint')?.dataset.tutorialStepKey)
      .toBe('authored.scene-a')

    await act(async () => root.render(<TutorialHarness
      {...base}
      availableActionKeys={['action.scene-b']}
    />))
    await flush()
    expect(byTestId(host, 'text-open-world-tutorial-hint')).toBeNull()
  })

  it('每Session、页面和cycle只自动展示一项，完成后可重看且不改变完成状态', async () => {
    const productionKey = `tutorial-ui-cycle-${crypto.randomUUID()}`
    const onGameAction = vi.fn()
    const common: HarnessProps = {
      productionKey,
      sessionKey: 'session-a',
      cycleKey: 1,
      featureSupport: { scene: true },
      featureAvailability: { scene: true },
      onGameAction,
    }
    await act(async () => root.render(<TutorialHarness {...common} />))
    await waitFor(() => expect(byTestId(host, 'text-open-world-tutorial-hint')).not.toBeNull())
    let hint = byTestId(host, 'text-open-world-tutorial-hint')!
    const target = host.querySelector<HTMLElement>('[data-open-world-ui-key="play.scene"]')!
    expect(hint.parentElement).toBe(byTestId(host, 'tutorial-test-container'))
    expect(hint.dataset.tutorialStepKey).toBe('system.opening')
    expect(hint.dataset.tutorialTargetKey).toBe('play.scene')
    expect(hint.getAttribute('role')).toBe('status')
    expect(hint.getAttribute('aria-live')).toBe('polite')
    expect(hint.getAttribute('aria-atomic')).toBe('true')
    expect(target.getAttribute('data-open-world-tutorial-active')).toBe('system.opening')
    expect(onGameAction).not.toHaveBeenCalled()

    await click(buttonByLabel(hint, '稍后再看教程'))
    expect(byTestId(host, 'text-open-world-tutorial-hint')).toBeNull()
    expect(target.hasAttribute('data-open-world-tutorial-active')).toBe(false)
    expect(document.activeElement).toBe(byTestId(host, 'text-open-world-tutorial-trigger'))

    await act(async () => root.render(<TutorialHarness {...common} />))
    await flush()
    expect(byTestId(host, 'text-open-world-tutorial-hint')).toBeNull()

    await act(async () => root.render(<TutorialHarness {...common} cycleKey={2} />))
    await waitFor(() => expect(byTestId(host, 'text-open-world-tutorial-hint')).not.toBeNull())
    hint = byTestId(host, 'text-open-world-tutorial-hint')!
    await click(buttonByText(hint, '知道了'))
    expect(onGameAction).not.toHaveBeenCalled()

    const progressStore = createTextOpenWorldPlayerTutorialStoreV1({
      productionKey,
      runtimeChannel: 'release',
    })
    expect(progressStore.getSnapshot().completedStepKeys).toEqual(['system.opening'])
    const completedBeforeReplay = JSON.stringify(progressStore.getSnapshot())

    const helpTrigger = byTestId(host, 'text-open-world-tutorial-trigger') as HTMLButtonElement
    await click(helpTrigger)
    const help = byTestId(host, 'text-open-world-tutorial-help')!
    const opening = itemByText(help, '从当前场景开始')
    expect(opening.querySelector('[data-tutorial-status]')?.textContent).toContain('已完成')
    await click(buttonByText(opening, '重看'))
    hint = byTestId(host, 'text-open-world-tutorial-hint')!
    expect(hint.textContent).toContain('教程重看')
    expect(JSON.stringify(progressStore.refresh())).toBe(completedBeforeReplay)
    const close = buttonByLabel(hint, '稍后再看教程')
    expect(document.activeElement).toBe(close)
    const escape = await keyDown(close, 'Escape')
    expect(escape.defaultPrevented).toBe(true)
    expect(byTestId(host, 'text-open-world-tutorial-hint')).toBeNull()
    expect(document.activeElement).toBe(helpTrigger)
    expect(JSON.stringify(progressStore.refresh())).toBe(completedBeforeReplay)
  })

  it.each<HiddenMode>(['hidden', 'aria-hidden', 'inert'])(
    '祖先为%s的挂载目标不会误触发，而是高亮真实可见的导航锚点',
    async hiddenMode => {
      const onSelectView = vi.fn()
      const onGameAction = vi.fn()
      await act(async () => root.render(<TutorialHarness
        productionKey={`tutorial-ui-hidden-${hiddenMode}-${crypto.randomUUID()}`}
        sessionKey="session-hidden"
        cycleKey={1}
        hiddenMode={hiddenMode}
        featureSupport={{ scene: true }}
        featureAvailability={{ scene: true }}
        onSelectView={onSelectView}
        onGameAction={onGameAction}
      />))
      await waitFor(() => expect(byTestId(host, 'text-open-world-tutorial-hint')).not.toBeNull())
      const hint = byTestId(host, 'text-open-world-tutorial-hint')!
      const direct = host.querySelector<HTMLElement>('[data-open-world-ui-key="play.scene"]')!
      const fallback = host.querySelector<HTMLElement>('[data-open-world-ui-key="navigation.scene"]')!
      expect(hint.dataset.tutorialTargetKey).toBe('navigation.scene')
      expect(direct.hasAttribute('data-open-world-tutorial-active')).toBe(false)
      expect(fallback.getAttribute('data-open-world-tutorial-active')).toBe('system.opening')
      await click(buttonByText(hint, '前往场景'))
      expect(onSelectView).toHaveBeenCalledWith('scene')
      expect(onGameAction).not.toHaveBeenCalled()
      expect(fallback.hasAttribute('data-open-world-tutorial-active')).toBe(false)
    },
  )

  it('直接目标和对应导航均不可见时保持安静，suspended及Session切换会清理提示与高亮', async () => {
    const productionKey = `tutorial-ui-suspend-${crypto.randomUUID()}`
    const base: HarnessProps = {
      productionKey,
      sessionKey: 'session-a',
      cycleKey: 1,
      hiddenMode: 'hidden',
      hideNavigation: true,
      featureSupport: { scene: true },
      featureAvailability: { scene: true },
    }
    await act(async () => root.render(<TutorialHarness {...base} />))
    await flush()
    expect(byTestId(host, 'text-open-world-tutorial-hint')).toBeNull()

    await act(async () => root.render(<TutorialHarness
      {...base}
      hiddenMode="visible"
      hideNavigation={false}
      cycleKey={2}
    />))
    await waitFor(() => expect(byTestId(host, 'text-open-world-tutorial-hint')).not.toBeNull())
    const target = host.querySelector<HTMLElement>('[data-open-world-ui-key="play.scene"]')!
    expect(target.hasAttribute('data-open-world-tutorial-active')).toBe(true)

    await act(async () => root.render(<TutorialHarness
      {...base}
      sessionKey="session-b"
      cycleKey={2}
      hiddenMode="visible"
      hideNavigation={false}
      suspended
    />))
    await flush()
    expect(byTestId(host, 'text-open-world-tutorial-hint')).toBeNull()
    expect(byTestId(host, 'text-open-world-tutorial-help')).toBeNull()
    expect(target.hasAttribute('data-open-world-tutorial-active')).toBe(false)
    expect((byTestId(host, 'text-open-world-tutorial-trigger') as HTMLButtonElement).disabled).toBe(true)

    await act(async () => root.render(<TutorialHarness
      {...base}
      sessionKey="session-b"
      cycleKey={2}
      hiddenMode="visible"
      hideNavigation={false}
    />))
    await waitFor(() => expect(byTestId(host, 'text-open-world-tutorial-hint')).not.toBeNull())
  })

  it('可用Action的作者教程只解释目标，不执行Action；跳过、暂停和显式重置语义分离', async () => {
    const productionKey = `tutorial-ui-authored-${crypto.randomUUID()}`
    const onGameAction = vi.fn()
    const authoredTutorials: TextOpenWorldAuthoredTutorialV1[] = [{
      key: 'first-action',
      triggerActionKey: 'action.investigate',
      targetUiKey: 'ui.action-panel',
      title: '检查行动面板',
      body: '这里解释规则，但不会替你执行行动。',
    }]
    const base: HarnessProps = {
      productionKey,
      sessionKey: 'session-authored',
      cycleKey: 1,
      featureSupport: { 'system-actions': true, 'natural-input': true },
      featureAvailability: { 'system-actions': true, 'natural-input': true },
      availableActionKeys: ['action.investigate'],
      authoredTutorials,
      onGameAction,
    }
    createTextOpenWorldPlayerTutorialStoreV1({
      productionKey,
      runtimeChannel: 'release',
    }).complete('system.system-actions')
    await act(async () => root.render(<TutorialHarness {...base} />))
    await waitFor(() => expect(byTestId(host, 'text-open-world-tutorial-hint')).not.toBeNull())
    let hint = byTestId(host, 'text-open-world-tutorial-hint')!
    expect(hint.dataset.tutorialStepKey).toBe('authored.first-action')
    expect(hint.dataset.tutorialTargetKey).toBe('play.system-actions')
    await click(buttonByText(hint, '跳过此提示'))
    expect(onGameAction).not.toHaveBeenCalled()

    await act(async () => root.render(<TutorialHarness {...base} cycleKey={2} />))
    await waitFor(() => expect(byTestId(host, 'text-open-world-tutorial-hint')).not.toBeNull())
    hint = byTestId(host, 'text-open-world-tutorial-hint')!
    expect(hint.dataset.tutorialStepKey).toBe('system.natural-input')
    await click(buttonByText(hint, '暂停全部自动提示'))

    await act(async () => root.render(<TutorialHarness {...base} cycleKey={3} />))
    await flush()
    expect(byTestId(host, 'text-open-world-tutorial-hint')).toBeNull()
    const trigger = byTestId(host, 'text-open-world-tutorial-trigger') as HTMLButtonElement
    await click(trigger)
    let help = byTestId(host, 'text-open-world-tutorial-help')!
    expect(help.textContent).toContain('已跳过 1')
    expect(buttonByText(help, '恢复自动提示')).toBeTruthy()
    await click(buttonByText(help, '重置自动提示进度'))
    help = byTestId(host, 'text-open-world-tutorial-help')!
    expect(help.textContent).not.toContain('已跳过 1')
    const progressStore = createTextOpenWorldPlayerTutorialStoreV1({
      productionKey,
      runtimeChannel: 'release',
    })
    expect(progressStore.getSnapshot()).toMatchObject({
      completedStepKeys: [],
      skippedStepKeys: [],
      suppressAutomatic: false,
    })

    const close = buttonByLabel(help, '关闭帮助与教程')
    close.focus()
    const escape = await keyDown(close, 'Escape')
    expect(escape.defaultPrevented).toBe(true)
    expect(byTestId(host, 'text-open-world-tutorial-help')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await waitFor(() => expect(byTestId(host, 'text-open-world-tutorial-hint')).not.toBeNull())
    expect(byTestId(host, 'text-open-world-tutorial-hint')?.dataset.tutorialStepKey)
      .toBe('system.system-actions')
    expect(onGameAction).not.toHaveBeenCalled()
  })

  it('帮助页只汇总静态不兼容作者教程，不把暂未出现的Action误报为异常', async () => {
    const productionKey = `tutorial-ui-compatibility-${crypto.randomUUID()}`
    const authoredTutorials = [{
      key: 'unknown-target',
      triggerActionKey: 'action.visible',
      targetUiKey: 'overlay.future-client',
      title: '未来客户端教程',
      body: '当前客户端不能展示。',
    }, {
      key: 'dormant-action',
      triggerActionKey: 'action.not-yet-visible',
      targetUiKey: 'play.system-actions',
      title: '尚未开放的行动',
      body: '只是暂未满足出现条件。',
    }]
    await act(async () => root.render(<TutorialHarness
      productionKey={productionKey}
      sessionKey="session-compatibility"
      cycleKey={1}
      featureSupport={{ 'system-actions': true }}
      featureAvailability={{}}
      availableActionKeys={[]}
      authoredTutorials={authoredTutorials}
    />))
    await click(byTestId(host, 'text-open-world-tutorial-trigger') as HTMLButtonElement)
    const help = byTestId(host, 'text-open-world-tutorial-help')!
    expect(byTestId(help, 'text-open-world-tutorial-compatibility-warning')?.textContent)
      .toContain('1 条作者教程')
    expect(help.textContent).not.toContain('未来客户端教程')
    expect(help.textContent).not.toContain('尚未开放的行动')
  })
})
