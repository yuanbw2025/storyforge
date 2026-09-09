import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  CircleEllipsis,
  ListTodo,
  Map,
  PanelRightOpen,
  ScrollText,
  UserRound,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react'
import { createTextOpenWorldPlayerPreferencesStoreV1 } from '../../lib/open-world/player-preferences'
import {
  classifyTextOpenWorldPlayerIssueV1,
  type TextOpenWorldPlayerIssueV1,
} from '../../lib/open-world/player-resilience'
import type { TextOpenWorldTutorialFeatureV1 } from '../../lib/open-world/player-tutorials'
import TextOpenWorldPlayerStateNotice from './TextOpenWorldPlayerStateNotice'
import TextOpenWorldTutorialCoach, {
  type TextOpenWorldTutorialCoachProps,
} from './TextOpenWorldTutorialCoach'
import './player-roadshow.css'

export const TEXT_OPEN_WORLD_GAME_VIEW_KEYS = ['scene', 'map', 'quests', 'character', 'more'] as const

export type TextOpenWorldGameViewKey = typeof TEXT_OPEN_WORLD_GAME_VIEW_KEYS[number]

export type TextOpenWorldGameViews = Record<TextOpenWorldGameViewKey, ReactNode>
export type TextOpenWorldGameViewState = 'empty' | 'ready'

export interface TextOpenWorldGameViewRequest {
  /** Bind the request to one runtime session so a stale task link cannot move a new save. */
  sessionKey: number | string
  /** Monotonic UI-only identity; replaying the same request must be a no-op. */
  requestId: number
  view: TextOpenWorldGameViewKey
}

type TextOpenWorldActiveTutorialConfig = Omit<
  TextOpenWorldTutorialCoachProps,
  'sessionKey' | 'activeView' | 'suspended' | 'containerRef' | 'onSelectView'
>

export type TextOpenWorldGameTutorialConfig = TextOpenWorldActiveTutorialConfig & {
  /** Optional visible Action disclosure per page; unspecified pages use availableActionKeys. */
  availableActionKeysByView?: Readonly<Partial<Record<
    TextOpenWorldGameViewKey,
    readonly string[]
  >>>
}

export interface TextOpenWorldGameShellProps {
  /** A changed key starts from the scene again without persisting UI-only navigation state. */
  sessionKey: number | string
  /** Stable product-family identity; browser-local preferences span its immutable Releases. */
  preferenceProductionKey: string
  gameTitle: string
  locationTitle: string
  sourceLabel: string
  views: TextOpenWorldGameViews
  /** Optional truthful empty/ready projection for automated and assistive diagnostics. */
  viewStates?: Partial<Record<TextOpenWorldGameViewKey, TextOpenWorldGameViewState>>
  context: ReactNode
  status: ReactNode
  navigationSupplement?: ReactNode
  tutorial?: TextOpenWorldGameTutorialConfig
  /** One-shot navigation intent from content such as a task-location link. */
  viewRequest?: TextOpenWorldGameViewRequest | null
  overlay?: ReactNode
  onDismissOverlay?(): void
  error?: string | null
  issue?: TextOpenWorldPlayerIssueV1 | null
  onRecover?(): void
  busy?: boolean
  onExit(): void
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => !element.closest('[hidden]') && element.getAttribute('aria-hidden') !== 'true')
}

function focusFirst(container: HTMLElement | null): void {
  if (!container) return
  ;(focusableElements(container)[0] ?? container).focus()
}

function trapFocus(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== 'Tab') return
  const elements = focusableElements(container)
  if (!elements.length) {
    event.preventDefault()
    container.focus()
    return
  }
  const first = elements[0]
  const last = elements[elements.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

const NAVIGATION: ReadonlyArray<{
  key: TextOpenWorldGameViewKey
  label: string
  icon: LucideIcon
}> = [
  { key: 'scene', label: '场景', icon: ScrollText },
  { key: 'map', label: '地图', icon: Map },
  { key: 'quests', label: '任务', icon: ListTodo },
  { key: 'character', label: '角色', icon: UserRound },
  { key: 'more', label: '更多', icon: CircleEllipsis },
]

const VIEW_UI_KEYS: Record<TextOpenWorldGameViewKey, string> = {
  scene: 'play.scene',
  map: 'overlay.map',
  quests: 'overlay.quest-log',
  character: 'overlay.character',
  more: 'system.settings-help',
}

const TUTORIAL_FEATURE_VIEW: Readonly<Partial<Record<
  TextOpenWorldTutorialFeatureV1,
  TextOpenWorldGameViewKey
>>> = Object.freeze({
  scene: 'scene',
  'system-actions': 'scene',
  'fixed-choices': 'scene',
  'natural-input': 'scene',
  combat: 'scene',
  quests: 'quests',
  'map-travel': 'map',
  character: 'character',
  skills: 'character',
  'inventory-equipment': 'more',
  crafting: 'more',
  shop: 'more',
  relationships: 'more',
  'formal-save': 'more',
  'settings-help': 'more',
})

function tutorialForActiveView(
  tutorial: TextOpenWorldGameTutorialConfig | undefined,
  activeView: TextOpenWorldGameViewKey,
): TextOpenWorldActiveTutorialConfig | undefined {
  if (!tutorial) return undefined
  const { availableActionKeysByView, ...activeTutorial } = tutorial
  const featureAvailability = { ...tutorial.featureAvailability }
  for (const feature of Object.keys(featureAvailability) as TextOpenWorldTutorialFeatureV1[]) {
    const owningView = TUTORIAL_FEATURE_VIEW[feature]
    if (owningView && owningView !== activeView) featureAvailability[feature] = false
  }
  return {
    ...activeTutorial,
    featureAvailability,
    availableActionKeys: availableActionKeysByView?.[activeView]
      ?? activeTutorial.availableActionKeys,
  }
}

function NavigationButtons(props: {
  activeView: TextOpenWorldGameViewKey
  mainId: string
  onSelect(view: TextOpenWorldGameViewKey): void
}) {
  return <>{NAVIGATION.map(item => {
    const Icon = item.icon
    return <button
      key={item.key}
      type="button"
      aria-current={props.activeView === item.key ? 'page' : undefined}
      aria-controls={props.mainId}
      data-open-world-ui-key={`navigation.${item.key}`}
      onClick={() => props.onSelect(item.key)}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        const buttons = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        const current = buttons.indexOf(event.currentTarget)
        if (current < 0 || !buttons.length) return
        event.preventDefault()
        const next = event.key === 'Home' ? 0
          : event.key === 'End' ? buttons.length - 1
            : (current + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
        buttons[next]?.focus()
      }}
    >
      <Icon aria-hidden="true" />
      <span>{item.label}</span>
    </button>
  })}</>
}

export default function TextOpenWorldGameShell(props: TextOpenWorldGameShellProps) {
  const [activeView, setActiveView] = useState<TextOpenWorldGameViewKey>('scene')
  const [contextOpen, setContextOpen] = useState(false)
  const [contextDrawerMode, setContextDrawerMode] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1180px)').matches
  ))
  const [online, setOnline] = useState(() => (
    typeof navigator === 'undefined' || navigator.onLine !== false
  ))
  const [operationAnnouncement, setOperationAnnouncement] = useState('')
  const mainRef = useRef<HTMLElement>(null)
  const shellRef = useRef<HTMLElement>(null)
  const contextTriggerRef = useRef<HTMLButtonElement>(null)
  const contextCloseRef = useRef<HTMLButtonElement>(null)
  const contextPanelRef = useRef<HTMLElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null)
  const restoreContextFocusAfterCloseRef = useRef(false)
  const previousSessionKey = useRef(props.sessionKey)
  const previousBusy = useRef(Boolean(props.busy))
  const consumedViewRequestRef = useRef<string | null>(null)
  const overlayOpen = props.overlay != null
  const onDismissOverlay = props.onDismissOverlay
  const contextModalOpen = contextOpen && contextDrawerMode && !overlayOpen
  const backgroundInert = overlayOpen || contextModalOpen
  const mainId = `text-open-world-main-${String(props.sessionKey).replace(/[^A-Za-z0-9_-]/g, '-')}`
  const issue = useMemo(() => props.issue ?? classifyTextOpenWorldPlayerIssueV1({
    error: props.error ?? '',
    surface: 'runtime-operation',
  }), [props.error, props.issue])
  const blocked = issue?.state === 'blocking-error'
  const preferencesStore = useMemo(
    () => createTextOpenWorldPlayerPreferencesStoreV1({ productionKey: props.preferenceProductionKey }),
    [props.preferenceProductionKey],
  )
  const preferences = useSyncExternalStore(
    preferencesStore.subscribe,
    preferencesStore.getSnapshot,
    preferencesStore.getServerSnapshot,
  )
  const activeViewTutorial = useMemo(
    () => tutorialForActiveView(props.tutorial, activeView),
    [activeView, props.tutorial],
  )

  const closeContext = useCallback((restoreFocus = true) => {
    restoreContextFocusAfterCloseRef.current = restoreFocus
    setContextOpen(false)
  }, [])

  const selectView = useCallback((view: TextOpenWorldGameViewKey) => {
    setContextOpen(false)
    setActiveView(view)
    queueMicrotask(() => mainRef.current?.focus())
  }, [])

  useEffect(() => {
    queueMicrotask(() => mainRef.current?.focus())
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1180px)')
    const sync = () => {
      setContextDrawerMode(media.matches)
      if (!media.matches) {
        setContextOpen(wasOpen => {
          if (wasOpen) queueMicrotask(() => mainRef.current?.focus())
          return false
        })
      }
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine !== false)
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    sync()
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  useEffect(() => {
    const wasBusy = previousBusy.current
    previousBusy.current = Boolean(props.busy)
    if (props.busy) setOperationAnnouncement('正在核对并结算游戏操作。')
    else if (wasBusy) setOperationAnnouncement(issue ? '操作已经停止，请查看恢复提示。' : '操作已经完成，当前状态已保存。')
  }, [issue, props.busy])

  useEffect(() => {
    if (previousSessionKey.current === props.sessionKey) return
    previousSessionKey.current = props.sessionKey
    consumedViewRequestRef.current = null
    setActiveView('scene')
    setContextOpen(false)
    queueMicrotask(() => mainRef.current?.focus())
  }, [props.sessionKey])

  useEffect(() => {
    const request = props.viewRequest
    if (!request || request.sessionKey !== props.sessionKey) return
    const signature = `${typeof request.sessionKey}:${String(request.sessionKey)}:${request.requestId}:${request.view}`
    if (consumedViewRequestRef.current === signature) return
    consumedViewRequestRef.current = signature
    selectView(request.view)
  }, [props.sessionKey, props.viewRequest, selectView])

  useEffect(() => {
    if (!contextModalOpen) return
    queueMicrotask(() => contextCloseRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeContext()
        return
      }
      if (contextPanelRef.current) trapFocus(event, contextPanelRef.current)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [closeContext, contextModalOpen])

  useEffect(() => {
    if (contextModalOpen || !restoreContextFocusAfterCloseRef.current) return
    restoreContextFocusAfterCloseRef.current = false
    queueMicrotask(() => contextTriggerRef.current?.focus())
  }, [contextModalOpen])

  useEffect(() => {
    if (!overlayOpen) return
    const activeElement = document.activeElement
    overlayReturnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null
    setContextOpen(false)
    queueMicrotask(() => focusFirst(overlayRef.current))
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onDismissOverlay) {
        event.preventDefault()
        event.stopPropagation()
        onDismissOverlay()
        return
      }
      if (overlayRef.current) trapFocus(event, overlayRef.current)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      const returnFocus = overlayReturnFocusRef.current
      overlayReturnFocusRef.current = null
      queueMicrotask(() => {
        if (returnFocus?.isConnected) returnFocus.focus()
      })
    }
  }, [onDismissOverlay, overlayOpen])

  return <section
    ref={shellRef}
    className="open-world-game-shell"
    data-testid="text-open-world-shell"
    data-active-view={activeView}
    data-high-contrast={preferences.highContrast || undefined}
    data-reduced-motion={preferences.reducedMotion || undefined}
    data-muted={preferences.muted || undefined}
    data-connectivity={online ? 'online' : 'offline'}
    data-player-state={blocked ? 'blocking-error' : issue?.state ?? 'ready'}
    style={{
      '--open-world-reader-font-size': `${preferences.fontSizePx}px`,
      '--open-world-reader-line-height': preferences.lineHeight,
    } as CSSProperties}
    aria-busy={props.busy || undefined}
    onClickCapture={event => {
      if (!overlayOpen || overlayRef.current?.contains(event.target as Node)) return
      event.preventDefault()
      event.stopPropagation()
    }}
  >
    <a
      href={`#${mainId}`}
      className="open-world-game-skip-link"
      onClick={() => queueMicrotask(() => mainRef.current?.focus())}
    >跳到游戏主要内容</a>
    <div
      className="open-world-game-live-announcement"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="text-open-world-operation-announcement"
    >{operationAnnouncement}</div>
    <header
      className="open-world-game-header"
      data-testid="text-open-world-header"
      inert={backgroundInert}
      aria-hidden={backgroundInert || undefined}
    >
      <button type="button" className="open-world-game-exit" aria-label="退出游戏" onClick={props.onExit}>
        <ArrowLeft aria-hidden="true" />
        <span>退出游戏</span>
      </button>
      <div className="open-world-game-heading">
        <small data-testid="text-open-world-runtime-source">{props.sourceLabel}</small>
        <strong>{props.gameTitle}</strong>
        <span>{props.locationTitle}</span>
      </div>
      <div className="open-world-game-header-actions">
        {activeViewTutorial && <TextOpenWorldTutorialCoach
          {...activeViewTutorial}
          sessionKey={props.sessionKey}
          activeView={activeView}
          suspended={Boolean(props.busy) || overlayOpen || contextModalOpen}
          containerRef={shellRef}
          onSelectView={selectView}
        />}
        <button type="button" aria-label="返回当前场景" onClick={() => selectView('scene')}>
          <ChevronLeft aria-hidden="true" />
          <span>返回场景</span>
        </button>
        <button
          ref={contextTriggerRef}
          type="button"
          className="open-world-game-context-trigger"
          aria-label="打开当前位置上下文"
          aria-controls="text-open-world-context"
          aria-expanded={contextOpen}
          onClick={() => contextDrawerMode && setContextOpen(true)}
        >
          <PanelRightOpen aria-hidden="true" />
          <span>上下文</span>
        </button>
      </div>
    </header>

    <div className="open-world-game-layout">
      <aside
        className="open-world-game-navigation-rail"
        data-testid="text-open-world-navigation-rail"
        inert={backgroundInert}
        aria-hidden={backgroundInert || undefined}
      >
        <nav aria-label="开放世界主导航">
          <NavigationButtons activeView={activeView} mainId={mainId} onSelect={selectView} />
        </nav>
        {props.navigationSupplement && <div className="open-world-game-navigation-supplement">{props.navigationSupplement}</div>}
      </aside>

      <main
        ref={mainRef}
        id={mainId}
        className="open-world-game-main-view"
        data-testid="text-open-world-main-view"
        data-open-world-view={activeView}
        tabIndex={-1}
        inert={backgroundInert}
        aria-hidden={backgroundInert || undefined}
      >
        {!online && <section
          className="open-world-game-connectivity"
          role="status"
          data-testid="text-open-world-offline-status"
        >
          <WifiOff aria-hidden="true" />
          <span><strong>离线确定性模式</strong>核心玩法与本地存档可继续；需要网络或模型的可选表现暂不可用。</span>
        </section>}
        {issue && <TextOpenWorldPlayerStateNotice
          issue={issue}
          compact
          primaryLabel={issue.code === 'TOW-PLAYER-UNKNOWN-RESULT' ? '核对并恢复' : '重新核对当前存档'}
          onPrimary={issue.retryAllowed ? props.onRecover : undefined}
          secondaryLabel="返回游戏库"
          onSecondary={blocked ? props.onExit : undefined}
        />}
        {TEXT_OPEN_WORLD_GAME_VIEW_KEYS.map(view => <section
          key={view}
          className="open-world-game-view"
          data-open-world-view={view}
          data-open-world-ui-key={VIEW_UI_KEYS[view]}
          data-player-state={blocked
            ? 'blocking-error'
            : issue?.state === 'recoverable-error' ? 'recoverable-error'
              : props.viewStates?.[view] ?? 'ready'}
          aria-label={NAVIGATION.find(item => item.key === view)!.label}
          hidden={activeView !== view}
          inert={blocked || backgroundInert}
        >
          {props.views[view]}
        </section>)}
      </main>

      {contextModalOpen && <button
        type="button"
        className="open-world-game-context-backdrop"
        aria-label="关闭当前位置上下文"
        tabIndex={-1}
        onClick={() => closeContext()}
      />}
      <aside
        ref={contextPanelRef}
        id="text-open-world-context"
        className={`open-world-game-context-rail${contextModalOpen ? ' is-drawer-open' : ''}`}
        data-testid="text-open-world-context-rail"
        role={contextModalOpen ? 'dialog' : undefined}
        aria-modal={contextModalOpen || undefined}
        aria-label="当前位置上下文"
        inert={overlayOpen}
        aria-hidden={overlayOpen || undefined}
      >
        <header className="open-world-game-context-drawer-header">
          <div><small>CONTEXT</small><strong>当前位置上下文</strong></div>
          <button ref={contextCloseRef} type="button" aria-label="关闭当前位置上下文" onClick={() => closeContext()}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div data-testid={contextModalOpen ? 'text-open-world-context-drawer' : undefined}>{props.context}</div>
      </aside>
    </div>

    <footer
      className="open-world-game-global-status"
      data-testid="text-open-world-global-status"
      data-open-world-ui-key="overlay.world-status"
      inert={backgroundInert}
      aria-hidden={backgroundInert || undefined}
    >
      {props.status}
    </footer>

    <nav
      className="open-world-game-mobile-navigation"
      data-testid="text-open-world-mobile-navigation"
      aria-label="开放世界移动导航"
      inert={backgroundInert}
      aria-hidden={backgroundInert || undefined}
    >
      <NavigationButtons activeView={activeView} mainId={mainId} onSelect={selectView} />
    </nav>

    {props.overlay && <div
      ref={overlayRef}
      className="open-world-game-overlay"
      data-testid="text-open-world-modal-overlay"
      tabIndex={-1}
    >{props.overlay}</div>}
  </section>
}
