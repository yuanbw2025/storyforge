import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  CircleHelp,
  Eye,
  PauseCircle,
  RotateCcw,
  SkipForward,
  X,
} from 'lucide-react'
import {
  createTextOpenWorldPlayerTutorialStoreV1,
  projectTextOpenWorldPlayerTutorialsV1,
  type TextOpenWorldAuthoredTutorialV1 as DomainAuthoredTutorialV1,
  type TextOpenWorldPlayerTutorialRuntimeChannelV1,
  type TextOpenWorldTutorialFeatureV1,
  type TextOpenWorldTutorialTargetViewV1,
} from '../../lib/open-world/player-tutorials'

export type TextOpenWorldTutorialViewV1 = TextOpenWorldTutorialTargetViewV1
export type TextOpenWorldTutorialRuntimeChannelV1 = TextOpenWorldPlayerTutorialRuntimeChannelV1
export type TextOpenWorldAuthoredTutorialV1 = DomainAuthoredTutorialV1

export interface TextOpenWorldTutorialCoachProps {
  sessionKey: number | string
  productionKey: string
  runtimeChannel: TextOpenWorldTutorialRuntimeChannelV1
  cycleKey: number | string
  activeView: TextOpenWorldTutorialViewV1
  featureSupport: Readonly<Partial<Record<TextOpenWorldTutorialFeatureV1, boolean>>>
  featureAvailability: Readonly<Partial<Record<TextOpenWorldTutorialFeatureV1, boolean>>>
  availableActionKeys: readonly string[]
  authoredTutorials: readonly TextOpenWorldAuthoredTutorialV1[]
  /** True while a business confirmation, context drawer, or other modal surface owns attention. */
  suspended: boolean
  containerRef: RefObject<HTMLElement | null>
  onSelectView(view: TextOpenWorldTutorialViewV1): void
}

type TutorialProjection = ReturnType<typeof projectTextOpenWorldPlayerTutorialsV1>
type TutorialStep = TutorialProjection['steps'][number]

interface ActiveHint {
  step: TutorialStep
  target: HTMLElement
  targetUiKey: string
  replay: boolean
}

const VIEW_LABELS: Readonly<Record<TextOpenWorldTutorialViewV1, string>> = {
  scene: '场景',
  map: '地图',
  quests: '任务',
  character: '角色',
  more: '更多',
}

function tokens(element: HTMLElement): string[] {
  return (element.getAttribute('data-open-world-ui-key') ?? '').split(/\s+/u).filter(Boolean)
}

function matchingTargets(container: HTMLElement, targetUiKey: string): HTMLElement[] {
  const descendants = Array.from(container.querySelectorAll<HTMLElement>('[data-open-world-ui-key]'))
    .filter(element => tokens(element).includes(targetUiKey))
  return tokens(container).includes(targetUiKey) ? [container, ...descendants] : descendants
}

function isActuallyVisible(element: HTMLElement, container: HTMLElement): boolean {
  if (!container.contains(element) && element !== container) return false
  let reachedContainer = false
  let current: HTMLElement | null = element
  while (current) {
    if (current.hidden
      || current.getAttribute('aria-hidden') === 'true'
      || current.hasAttribute('inert')) return false
    if (typeof getComputedStyle === 'function') {
      const style = getComputedStyle(current)
      if (style.display === 'none'
        || style.visibility === 'hidden'
        || style.visibility === 'collapse') return false
    }
    if (current === container) reachedContainer = true
    current = current.parentElement
  }
  return reachedContainer
}

function findVisibleTarget(container: HTMLElement, targetUiKey: string): HTMLElement | null {
  return matchingTargets(container, targetUiKey)
    .find(element => isActuallyVisible(element, container)) ?? null
}

function resolveTarget(
  container: HTMLElement | null,
  step: TutorialStep,
): Pick<ActiveHint, 'target' | 'targetUiKey'> | null {
  if (!container) return null
  const direct = findVisibleTarget(container, step.targetUiKey)
  if (direct) {
    return { target: direct, targetUiKey: step.targetUiKey }
  }
  const fallbackKey = `navigation.${step.targetView}`
  const fallback = findVisibleTarget(container, fallbackKey)
  if (!fallback) return null
  return { target: fallback, targetUiKey: fallbackKey }
}

function revealTarget(element: HTMLElement): void {
  const rect = element.getBoundingClientRect()
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  let centerVisible = centerX >= 0 && centerX <= viewportWidth
    && centerY >= 0 && centerY <= viewportHeight
  let ancestor = element.parentElement
  while (centerVisible && ancestor) {
    const style = getComputedStyle(ancestor)
    const bounds = ancestor.getBoundingClientRect()
    if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)
      && (centerX < bounds.left || centerX > bounds.right)) centerVisible = false
    if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)
      && (centerY < bounds.top || centerY > bounds.bottom)) centerVisible = false
    ancestor = ancestor.parentElement
  }
  if (centerVisible || typeof element.scrollIntoView !== 'function') return
  element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
}

function closeOnEscape(
  event: React.KeyboardEvent,
  close: () => void,
): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  close()
}

function trapDialogFocus(event: React.KeyboardEvent, dialog: HTMLElement | null): void {
  if (event.key !== 'Tab' || !dialog) return
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>([
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(','))).filter(element => !element.closest('[hidden], [aria-hidden="true"], [inert]'))
  if (!controls.length) {
    event.preventDefault()
    dialog.focus()
    return
  }
  const first = controls[0]!
  const last = controls[controls.length - 1]!
  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}

export default function TextOpenWorldTutorialCoach(props: TextOpenWorldTutorialCoachProps) {
  const scope = useMemo(() => ({
    productionKey: props.productionKey,
    runtimeChannel: props.runtimeChannel,
  }), [props.productionKey, props.runtimeChannel])
  const tutorialStore = useMemo(
    () => createTextOpenWorldPlayerTutorialStoreV1(scope),
    [scope],
  )
  const progress = useSyncExternalStore(
    tutorialStore.subscribe,
    tutorialStore.getSnapshot,
    tutorialStore.getServerSnapshot,
  )
  const projection = useMemo(() => projectTextOpenWorldPlayerTutorialsV1({
    progress,
    featureSupport: props.featureSupport,
    featureAvailability: props.featureAvailability,
    availableActionKeys: props.availableActionKeys,
    authoredTutorials: props.authoredTutorials,
  }), [
    progress,
    props.featureSupport,
    props.featureAvailability,
    props.availableActionKeys,
    props.authoredTutorials,
  ])
  const [activeHint, setActiveHint] = useState<ActiveHint | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [domProbeRevision, setDomProbeRevision] = useState(0)
  const consumedCyclesRef = useRef(new Set<string>())
  const targetProbeRef = useRef({ identity: '', attempts: 0 })
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  const hintCloseRef = useRef<HTMLButtonElement>(null)
  const helpDialogRef = useRef<HTMLElement>(null)
  const helpCloseRef = useRef<HTMLButtonElement>(null)

  const cycleIdentity = [
    props.productionKey,
    props.runtimeChannel,
    typeof props.sessionKey,
    String(props.sessionKey),
    props.activeView,
    typeof props.cycleKey,
    String(props.cycleKey),
  ].join(':')
  const sessionIdentity = [
    props.productionKey,
    props.runtimeChannel,
    typeof props.sessionKey,
    String(props.sessionKey),
  ].join(':')
  const previousSessionIdentityRef = useRef(sessionIdentity)
  const previousCycleIdentityRef = useRef(cycleIdentity)

  const closeHint = (restoreFocus = false) => {
    setActiveHint(null)
    if (restoreFocus) queueMicrotask(() => helpButtonRef.current?.focus())
  }
  const closeHelp = (restoreFocus = true) => {
    setHelpOpen(false)
    if (restoreFocus) queueMicrotask(() => helpButtonRef.current?.focus())
  }
  const showReplay = (step: TutorialStep) => {
    const resolved = resolveTarget(props.containerRef.current, step)
    if (!resolved) return
    revealTarget(resolved.target)
    closeHelp(false)
    setActiveHint({ step, ...resolved, replay: true })
  }

  useEffect(() => {
    if (previousSessionIdentityRef.current === sessionIdentity) return
    previousSessionIdentityRef.current = sessionIdentity
    setActiveHint(null)
    setHelpOpen(false)
  }, [sessionIdentity])

  useEffect(() => {
    if (previousCycleIdentityRef.current === cycleIdentity) return
    previousCycleIdentityRef.current = cycleIdentity
    setActiveHint(null)
  }, [cycleIdentity])

  useEffect(() => {
    if (!props.suspended) return
    setActiveHint(null)
    setHelpOpen(false)
  }, [props.suspended])

  useEffect(() => {
    if (props.suspended || helpOpen || activeHint || !projection.automaticStep) return
    if (consumedCyclesRef.current.has(cycleIdentity)) return
    const probeIdentity = `${cycleIdentity}:${projection.automaticStep.key}`
    const resolved = resolveTarget(props.containerRef.current, projection.automaticStep)
    if (!resolved) {
      if (targetProbeRef.current.identity !== probeIdentity) {
        targetProbeRef.current = { identity: probeIdentity, attempts: 0 }
      }
      const attempt = targetProbeRef.current.attempts
      const delays = [0, 16, 32, 64, 128, 250] as const
      if (attempt >= delays.length) return
      targetProbeRef.current.attempts += 1
      const timer = window.setTimeout(() => setDomProbeRevision(revision => revision + 1), delays[attempt])
      return () => window.clearTimeout(timer)
    }
    targetProbeRef.current = { identity: probeIdentity, attempts: 0 }
    consumedCyclesRef.current.add(cycleIdentity)
    revealTarget(resolved.target)
    setActiveHint({ step: projection.automaticStep, ...resolved, replay: false })
  }, [
    activeHint,
    cycleIdentity,
    domProbeRevision,
    helpOpen,
    projection.automaticStep,
    props.containerRef,
    props.suspended,
  ])

  useEffect(() => {
    const target = activeHint?.target
    if (!target) return
    revealTarget(target)
    const revealAfterResize = () => revealTarget(target)
    window.addEventListener('resize', revealAfterResize)
    target.setAttribute('data-open-world-tutorial-active', activeHint.step.key)
    return () => {
      window.removeEventListener('resize', revealAfterResize)
      if (target.getAttribute('data-open-world-tutorial-active') === activeHint.step.key) {
        target.removeAttribute('data-open-world-tutorial-active')
      }
    }
  }, [activeHint])

  useEffect(() => {
    if (!activeHint) return
    const container = props.containerRef.current
    const stillProjected = projection.steps.some(step => step.key === activeHint.step.key)
    const stillAvailable = activeHint.replay
      || props.featureAvailability[activeHint.step.feature] === true
    if (!container
      || !stillProjected
      || !stillAvailable
      || !isActuallyVisible(activeHint.target, container)) {
      setActiveHint(null)
    }
  }, [activeHint, projection.steps, props.containerRef, props.featureAvailability])

  useEffect(() => {
    if (!helpOpen) return
    queueMicrotask(() => helpCloseRef.current?.focus())
  }, [helpOpen])

  useEffect(() => {
    if (!activeHint?.replay) return
    queueMicrotask(() => hintCloseRef.current?.focus())
  }, [activeHint])

  const completed = projection.steps.filter(step => step.status === 'completed').length
  const skipped = projection.steps.filter(step => step.status === 'skipped').length

  return <div className="relative" data-testid="text-open-world-tutorial-coach">
    <button
      ref={helpButtonRef}
      type="button"
      className="open-world-tutorial-trigger inline-flex min-h-9 w-full items-center justify-center gap-2 rounded border border-accent/30 bg-accent/10 px-3 text-[10px] text-accent disabled:cursor-not-allowed disabled:opacity-50"
      disabled={props.suspended}
      data-testid="text-open-world-tutorial-trigger"
      aria-label="帮助与教程"
      title={props.suspended ? '请先处理当前确认或上下文面板' : undefined}
      onClick={() => {
        closeHint()
        setHelpOpen(true)
      }}
    >
      <CircleHelp aria-hidden="true" className="h-4 w-4" />帮助与教程
    </button>

    {props.containerRef.current && createPortal(<>
      {activeHint && !props.suspended && <aside
      className="open-world-tutorial-layer open-world-tutorial-card fixed bottom-20 right-4 z-[55] max-h-[min(44rem,calc(100dvh-6rem))] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-lg border border-accent/45 bg-bg-surface p-4 shadow-2xl"
      data-testid="text-open-world-tutorial-hint"
      data-tutorial-step-key={activeHint.step.key}
      data-tutorial-target-key={activeHint.targetUiKey}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-labelledby="text-open-world-tutorial-hint-title"
      onKeyDown={event => closeOnEscape(event, () => closeHint(true))}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <small className="text-[9px] tracking-wide text-warning">
            {activeHint.replay ? '教程重看' : '渐进提示'} · {VIEW_LABELS[activeHint.step.targetView]}
          </small>
          <h2 id="text-open-world-tutorial-hint-title" className="mt-1 font-serif text-lg">
            {activeHint.step.title}
          </h2>
        </div>
        <button ref={hintCloseRef} type="button" aria-label="稍后再看教程" onClick={() => closeHint(true)}>
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </header>
      <p className="mt-2 text-xs leading-5 text-text-muted">{activeHint.step.body}</p>
      {activeHint.targetUiKey !== activeHint.step.targetUiKey && <button
        type="button"
        className="mt-3 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[9px]"
        onClick={() => {
          closeHint()
          props.onSelectView(activeHint.step.targetView)
        }}
      >前往{VIEW_LABELS[activeHint.step.targetView]}</button>}
      <footer className="open-world-tutorial-actions mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded bg-accent px-3 py-2 text-[9px] text-white"
          onClick={() => {
            tutorialStore.complete(activeHint.step.key)
            closeHint(true)
          }}
        ><Check aria-hidden="true" className="h-3 w-3" />知道了</button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-[9px] text-text-muted"
          onClick={() => {
            tutorialStore.skip(activeHint.step.key)
            closeHint(true)
          }}
        ><SkipForward aria-hidden="true" className="h-3 w-3" />跳过此提示</button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-[9px] text-text-muted"
          onClick={() => {
            tutorialStore.setSuppress(true)
            closeHint(true)
          }}
        ><PauseCircle aria-hidden="true" className="h-3 w-3" />暂停全部自动提示</button>
      </footer>
      </aside>}

      {helpOpen && !props.suspended && <section
      ref={helpDialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="text-open-world-tutorial-help-title"
      data-testid="text-open-world-tutorial-help"
      className="open-world-tutorial-layer open-world-tutorial-help fixed inset-0 z-[60] grid place-items-center bg-bg-base/80 p-4"
      tabIndex={-1}
      onMouseDown={event => {
        if (event.target === event.currentTarget) closeHelp()
      }}
      onKeyDown={event => {
        closeOnEscape(event, () => closeHelp())
        trapDialogFocus(event, helpDialogRef.current)
      }}
    >
      <div className="open-world-tutorial-card max-h-[min(44rem,calc(100dvh-2rem))] w-full max-w-2xl overflow-y-auto rounded-lg border border-accent/35 bg-bg-surface p-5 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-3">
          <div>
            <small className="text-[9px] tracking-wide text-warning">玩家本机进度</small>
            <h2 id="text-open-world-tutorial-help-title" className="mt-1 font-serif text-xl">帮助与教程</h2>
            <p className="open-world-tutorial-progress mt-1 text-[10px] text-text-muted" data-testid="text-open-world-tutorial-progress">
              已完成 {completed}/{projection.steps.length}{skipped > 0 ? ` · 已跳过 ${skipped}` : ''}
            </p>
          </div>
          <button ref={helpCloseRef} type="button" aria-label="关闭帮助与教程" onClick={() => closeHelp()}>
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>

        <div className="mt-4 flex flex-wrap gap-2">
          {!progress.suppressAutomatic && <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-[9px]"
            onClick={() => tutorialStore.setSuppress(true)}
          ><PauseCircle aria-hidden="true" className="h-3 w-3" />暂停全部自动提示</button>}
          {progress.suppressAutomatic && <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-accent/40 px-3 py-2 text-[9px] text-accent"
            onClick={() => tutorialStore.setSuppress(false)}
          ><CircleHelp aria-hidden="true" className="h-3 w-3" />恢复自动提示</button>}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-[9px]"
            onClick={() => tutorialStore.reset()}
          ><RotateCcw aria-hidden="true" className="h-3 w-3" />重置自动提示进度</button>
        </div>
        <p className="mt-2 text-[9px] text-text-muted">
          重看不会改变已完成状态；只有显式重置才会清除完成和跳过记录。
        </p>
        {projection.incompatibleAuthoredTutorialCount > 0 && <p
          className="mt-3 rounded border border-warning/35 bg-warning/10 px-3 py-2 text-[9px] leading-4 text-warning"
          data-testid="text-open-world-tutorial-compatibility-warning"
          role="status"
        >
          此版本有 {projection.incompatibleAuthoredTutorialCount} 条作者教程超出当前客户端的安全展示能力，已跳过；游戏进度不受影响。
        </p>}

        <ol className="open-world-tutorial-step-list mt-4 grid gap-2" aria-label="教程清单" data-testid="text-open-world-tutorial-step-list">
          {projection.steps.map(step => <li key={step.key} className="rounded border border-border bg-bg-base/45 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <strong className="text-xs">{step.title}</strong>
                <p className="mt-1 text-[10px] leading-4 text-text-muted">{step.body}</p>
                <small className="mt-1 block text-[8px] text-text-muted">{VIEW_LABELS[step.targetView]}</small>
              </div>
              <span className="rounded-full border border-border px-2 py-1 text-[8px]" data-tutorial-status={step.status}>
                {step.status === 'completed' ? '已完成' : step.status === 'skipped' ? '已跳过' : '待了解'}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[9px]"
                onClick={() => showReplay(step)}
              ><Eye aria-hidden="true" className="h-3 w-3" />重看</button>
              {step.status === 'pending' && <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[9px] text-text-muted"
                onClick={() => tutorialStore.skip(step.key)}
              ><SkipForward aria-hidden="true" className="h-3 w-3" />跳过</button>}
            </div>
          </li>)}
        </ol>
      </div>
      </section>}
    </>, props.containerRef.current)}
  </div>
}
