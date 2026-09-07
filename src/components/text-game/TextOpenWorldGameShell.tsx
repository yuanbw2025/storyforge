import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  CircleEllipsis,
  ListTodo,
  Map,
  PanelRightOpen,
  ScrollText,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import './player-roadshow.css'

export const TEXT_OPEN_WORLD_GAME_VIEW_KEYS = ['scene', 'map', 'quests', 'character', 'more'] as const

export type TextOpenWorldGameViewKey = typeof TEXT_OPEN_WORLD_GAME_VIEW_KEYS[number]

export type TextOpenWorldGameViews = Record<TextOpenWorldGameViewKey, ReactNode>

export interface TextOpenWorldGameViewRequest {
  /** Bind the request to one runtime session so a stale task link cannot move a new save. */
  sessionKey: number | string
  /** Monotonic UI-only identity; replaying the same request must be a no-op. */
  requestId: number
  view: TextOpenWorldGameViewKey
}

export interface TextOpenWorldGameShellProps {
  /** A changed key starts from the scene again without persisting UI-only navigation state. */
  sessionKey: number | string
  gameTitle: string
  locationTitle: string
  sourceLabel: string
  views: TextOpenWorldGameViews
  context: ReactNode
  status: ReactNode
  navigationSupplement?: ReactNode
  /** One-shot navigation intent from content such as a task-location link. */
  viewRequest?: TextOpenWorldGameViewRequest | null
  overlay?: ReactNode
  onDismissOverlay?(): void
  error?: string | null
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

function NavigationButtons(props: {
  activeView: TextOpenWorldGameViewKey
  onSelect(view: TextOpenWorldGameViewKey): void
}) {
  return <>{NAVIGATION.map(item => {
    const Icon = item.icon
    return <button
      key={item.key}
      type="button"
      aria-current={props.activeView === item.key ? 'page' : undefined}
      onClick={() => props.onSelect(item.key)}
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
  const mainRef = useRef<HTMLElement>(null)
  const contextTriggerRef = useRef<HTMLButtonElement>(null)
  const contextCloseRef = useRef<HTMLButtonElement>(null)
  const contextPanelRef = useRef<HTMLElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null)
  const restoreContextFocusAfterCloseRef = useRef(false)
  const previousSessionKey = useRef(props.sessionKey)
  const consumedViewRequestRef = useRef<string | null>(null)
  const overlayOpen = props.overlay != null
  const onDismissOverlay = props.onDismissOverlay
  const contextModalOpen = contextOpen && contextDrawerMode && !overlayOpen
  const backgroundInert = overlayOpen || contextModalOpen

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
    className="open-world-game-shell"
    data-testid="text-open-world-shell"
    data-active-view={activeView}
    aria-busy={props.busy || undefined}
    onClickCapture={event => {
      if (!overlayOpen || overlayRef.current?.contains(event.target as Node)) return
      event.preventDefault()
      event.stopPropagation()
    }}
  >
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
          <NavigationButtons activeView={activeView} onSelect={selectView} />
        </nav>
        {props.navigationSupplement && <div className="open-world-game-navigation-supplement">{props.navigationSupplement}</div>}
      </aside>

      <main
        ref={mainRef}
        className="open-world-game-main-view"
        data-testid="text-open-world-main-view"
        data-open-world-view={activeView}
        tabIndex={-1}
        inert={backgroundInert}
        aria-hidden={backgroundInert || undefined}
      >
        {props.error && <div className="open-world-game-error" role="alert">{props.error}</div>}
        {TEXT_OPEN_WORLD_GAME_VIEW_KEYS.map(view => <section
          key={view}
          className="open-world-game-view"
          data-open-world-view={view}
          aria-label={NAVIGATION.find(item => item.key === view)!.label}
          hidden={activeView !== view}
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
      <NavigationButtons activeView={activeView} onSelect={selectView} />
    </nav>

    {props.overlay && <div
      ref={overlayRef}
      className="open-world-game-overlay"
      data-testid="text-open-world-modal-overlay"
      tabIndex={-1}
    >{props.overlay}</div>}
  </section>
}
