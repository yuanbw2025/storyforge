import { useEffect, useRef, useState, type MouseEvent } from 'react'
import {
  CheckCircle2,
  Coins,
  Hammer,
  LockKeyhole,
  Minus,
  PackageOpen,
  Plus,
  ShoppingBasket,
  Store,
  TriangleAlert,
  X,
} from 'lucide-react'
import type {
  TextOpenWorldPlayerCraftingEconomyExecuteRequestV1,
  TextOpenWorldPlayerCraftingEconomyProjectionV1,
  TextOpenWorldPlayerCraftingEconomyReceiptV1,
  TextOpenWorldPlayerTradeEquipmentComparisonV1,
} from '../../lib/open-world/player-crafting-economy'

type PrimaryView = 'crafting' | 'shop'
type TradeView = 'buy' | 'sell'
type CraftingFilter = 'all' | 'available' | 'materials-insufficient'

type ExecuteResult =
  | TextOpenWorldPlayerCraftingEconomyReceiptV1
  | null
  | void
  | Promise<TextOpenWorldPlayerCraftingEconomyReceiptV1 | null | void>

interface PendingConfirmation {
  sessionKey: string | number
  request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1
  heading: string
  summary: string[]
  submitLabel: string
}

interface RequestOutcome {
  sessionKey: string | number
  request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1
  receipt: TextOpenWorldPlayerCraftingEconomyReceiptV1 | null
  error: string | null
}

interface LastRequest {
  sessionKey: string | number
  request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1
  receiptAtRequest: TextOpenWorldPlayerCraftingEconomyReceiptV1 | null
}

export interface TextOpenWorldCraftingEconomyPanelProps {
  /** Pure UI identity. A change invalidates confirmations and in-flight local results. */
  sessionKey: string | number
  projection: TextOpenWorldPlayerCraftingEconomyProjectionV1
  busy: boolean
  /** Optional fresh, disclosure-safe receipt supplied by the runtime shell. */
  receipt?: TextOpenWorldPlayerCraftingEconomyReceiptV1 | null
  onExecute(request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1): ExecuteResult
}

function clampQuantity(value: number, maximum: number): number {
  if (maximum < 1) return 1
  if (!Number.isSafeInteger(value)) return 1
  return Math.min(maximum, Math.max(1, value))
}

function requestsEqual(
  left: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1,
  right: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1,
): boolean {
  return left.sessionId === right.sessionId
    && left.expectedBaseSequence === right.expectedBaseSequence
    && left.kind === right.kind
    && left.actionKey === right.actionKey
    && left.targetKey === right.targetKey
    && left.quantity === right.quantity
    && ('itemKey' in left ? left.itemKey : null) === ('itemKey' in right ? right.itemKey : null)
}

function publicError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    const message = error.message.trim()
    const exposesOpaqueIdentity = /\b(?:action|condition|effect|item|recipe|vendor|claim|instance|session)\.[\w.-]+\b/i.test(message)
      || /\b[a-f\d]{32,}\b/i.test(message)
    if (!exposesOpaqueIdentity) return message
  }
  return '请求未能完成，请确认当前状态后重试。'
}

function unavailableText(reasons: Array<{ message: string }>): string {
  const messages = [...new Set(reasons.map(reason => reason.message.trim()).filter(Boolean))]
  return messages.join('；') || '当前不可执行。'
}

function QuantityControl(props: {
  label: string
  value: number
  maximum: number
  disabled: boolean
  onChange(value: number): void
}) {
  const disabled = props.disabled || props.maximum < 1
  return <fieldset className="min-w-0 rounded border border-border/70 bg-bg-base/60 p-3" disabled={disabled}>
    <legend className="px-1 text-[10px] text-text-muted">{props.label}</legend>
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <button
        type="button"
        aria-label={`${props.label}减少一份`}
        disabled={disabled || props.value <= 1}
        onClick={() => props.onChange(clampQuantity(props.value - 1, props.maximum))}
        className="grid min-h-10 min-w-10 place-items-center rounded border border-border text-text-muted disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={Math.max(1, props.maximum)}
        step={1}
        value={props.value}
        disabled={disabled}
        aria-label={`${props.label}数量`}
        data-testid="text-open-world-crafting-economy-quantity"
        onChange={event => props.onChange(clampQuantity(Number(event.target.value), props.maximum))}
        className="min-h-10 w-20 rounded border border-border bg-bg-surface px-2 text-center font-mono text-sm outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-45"
      />
      <button
        type="button"
        aria-label={`${props.label}增加一份`}
        disabled={disabled || props.value >= props.maximum}
        onClick={() => props.onChange(clampQuantity(props.value + 1, props.maximum))}
        className="grid min-h-10 min-w-10 place-items-center rounded border border-border text-text-muted disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        disabled={disabled || props.value === props.maximum}
        onClick={() => props.onChange(Math.max(1, props.maximum))}
        className="min-h-10 rounded border border-accent/40 px-3 py-2 text-[10px] text-accent disabled:cursor-not-allowed disabled:border-border disabled:text-text-muted"
      >
        最大 {props.maximum}
      </button>
    </div>
  </fieldset>
}

function TradeEquipmentComparison(props: {
  comparison: TextOpenWorldPlayerTradeEquipmentComparisonV1
}) {
  return <details className="rounded border border-border/70 bg-bg-base/60 p-3">
    <summary className="cursor-pointer text-xs font-semibold text-accent">购买前查看装备属性比较</summary>
    <p className="mt-2 text-[10px] leading-5 text-text-muted">{props.comparison.note}</p>
    <p className="mt-1 text-[10px] text-text-muted">
      {props.comparison.slotLabel}：{props.comparison.currentTitle ?? '当前未装备'} → {props.comparison.candidateTitle}
    </p>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[360px] text-left text-[10px]">
        <caption className="sr-only">购买候选装备的旧值、新值与差值</caption>
        <thead className="text-text-muted"><tr><th className="py-1 pr-3 font-normal">属性</th><th className="px-2 py-1 text-right font-normal">旧值</th><th className="px-2 py-1 text-right font-normal">新值</th><th className="py-1 pl-2 text-right font-normal">差值</th></tr></thead>
        <tbody>{props.comparison.stats.map(stat => <tr key={stat.semantic} className="border-t border-border/60" data-change-direction={stat.direction}>
          <th className="py-1 pr-3 font-normal">{stat.label}</th>
          <td className="px-2 py-1 text-right font-mono text-text-muted">{stat.displayBefore}</td>
          <td className="px-2 py-1 text-right font-mono">{stat.displayAfter}</td>
          <td className={stat.direction === 'increase' ? 'py-1 pl-2 text-right font-mono text-success' : stat.direction === 'decrease' ? 'py-1 pl-2 text-right font-mono text-warning' : 'py-1 pl-2 text-right font-mono text-text-muted'}>{stat.displayDelta}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {props.comparison.resourceAdjustmentMessages.length > 0 && <aside className="mt-2 rounded border border-warning/35 bg-warning/5 p-2 text-[9px] leading-4 text-warning" role="note">
      {props.comparison.resourceAdjustmentMessages.map((message, index) => <p key={index} className="m-0 mt-1 first:mt-0">{message}</p>)}
    </aside>}
  </details>
}

function ConfirmationDialog(props: {
  confirmation: PendingConfirmation
  busy: boolean
  onCancel(): void
  onConfirm(): void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  return <section
    ref={dialogRef}
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="text-open-world-crafting-economy-confirm-title"
    aria-describedby="text-open-world-crafting-economy-confirm-summary"
    className="fixed inset-0 z-50 grid place-items-center bg-bg-base/80 p-4"
    onMouseDown={event => {
      if (event.target === event.currentTarget && !props.busy) props.onCancel()
    }}
    onKeyDown={event => {
      if (event.key === 'Escape' && !props.busy) {
        event.preventDefault()
        props.onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      if (!controls.length) return
      const first = controls[0]!
      const last = controls[controls.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }}
  >
    <div className="w-full max-w-lg rounded border border-accent/40 bg-bg-surface p-5 shadow-xl" onMouseDown={event => event.stopPropagation()}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <small className="text-[9px] tracking-wide text-warning">写入正式游戏记录前确认</small>
          <h2 id="text-open-world-crafting-economy-confirm-title" className="mt-1 font-serif text-xl">
            {props.confirmation.heading}
          </h2>
        </div>
        <button
          type="button"
          aria-label="取消并关闭确认"
          disabled={props.busy}
          onClick={props.onCancel}
          className="grid min-h-10 min-w-10 place-items-center rounded border border-border text-text-muted disabled:opacity-45"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>
      <ul id="text-open-world-crafting-economy-confirm-summary" className="mt-4 grid gap-2 rounded border border-border/70 bg-bg-base/60 p-3 text-xs">
        {props.confirmation.summary.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
      <p className="mt-3 text-[10px] leading-5 text-text-muted">
        确认时仍会由正式规则重新核验地点、材料、库存、货币、价格和事件基线。
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={props.busy}
          onClick={props.onCancel}
          className="min-h-10 rounded border border-border px-4 py-2 text-xs text-text-muted disabled:opacity-45"
        >取消</button>
        <button
          ref={confirmRef}
          type="button"
          disabled={props.busy}
          onClick={props.onConfirm}
          data-testid="text-open-world-crafting-economy-confirm-submit"
          className="min-h-10 rounded bg-accent px-4 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-45"
        >{props.busy ? '提交中…' : props.confirmation.submitLabel}</button>
      </div>
    </div>
  </section>
}

export default function TextOpenWorldCraftingEconomyPanel(
  props: TextOpenWorldCraftingEconomyPanelProps,
) {
  const [primaryView, setPrimaryView] = useState<PrimaryView>('crafting')
  const [tradeView, setTradeView] = useState<TradeView>('buy')
  const [craftingFilter, setCraftingFilter] = useState<CraftingFilter>('all')
  const [selectedRecipeIndex, setSelectedRecipeIndex] = useState(0)
  const [selectedVendorIndex, setSelectedVendorIndex] = useState(0)
  const [selectedTradeItemIndex, setSelectedTradeItemIndex] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null)
  const [lastRequest, setLastRequest] = useState<LastRequest | null>(null)
  const [outcome, setOutcome] = useState<RequestOutcome | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const currentContextRef = useRef({
    sessionKey: props.sessionKey,
    sessionId: props.projection.operationIdentity.sessionId,
  })
  currentContextRef.current = {
    sessionKey: props.sessionKey,
    sessionId: props.projection.operationIdentity.sessionId,
  }
  const requestGenerationRef = useRef(0)
  const submittingRef = useRef(false)
  const [localSubmitting, setLocalSubmitting] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const confirmationOpenRef = useRef(false)
  const previousBaseSequenceRef = useRef(props.projection.operationIdentity.expectedBaseSequence)
  const previousSessionIdentityRef = useRef({
    sessionKey: props.sessionKey,
    sessionId: props.projection.operationIdentity.sessionId,
  })

  const resetChoice = () => {
    setSelectedTradeItemIndex(0)
    setQuantity(1)
    setOutcome(null)
  }

  useEffect(() => {
    const previous = previousSessionIdentityRef.current
    const sessionId = props.projection.operationIdentity.sessionId
    if (previous.sessionKey === props.sessionKey && previous.sessionId === sessionId) return
    previousSessionIdentityRef.current = { sessionKey: props.sessionKey, sessionId }
    requestGenerationRef.current += 1
    submittingRef.current = false
    setPrimaryView('crafting')
    setTradeView('buy')
    setCraftingFilter('all')
    setSelectedRecipeIndex(0)
    setSelectedVendorIndex(0)
    setSelectedTradeItemIndex(0)
    setQuantity(1)
    setConfirmation(null)
    setLastRequest(null)
    setOutcome(null)
    setLocalSubmitting(false)
    triggerRef.current = null
    previousBaseSequenceRef.current = props.projection.operationIdentity.expectedBaseSequence
  }, [
    props.projection.operationIdentity.expectedBaseSequence,
    props.projection.operationIdentity.sessionId,
    props.sessionKey,
  ])

  useEffect(() => {
    const nextBaseSequence = props.projection.operationIdentity.expectedBaseSequence
    if (previousBaseSequenceRef.current === nextBaseSequence) return
    previousBaseSequenceRef.current = nextBaseSequence
    const restoreHeadingFocus = confirmationOpenRef.current
    setConfirmation(null)
    setQuantity(1)
    triggerRef.current = null
    if (restoreHeadingFocus) queueMicrotask(() => headingRef.current?.focus())
  }, [props.projection.operationIdentity.expectedBaseSequence])

  useEffect(() => () => {
    requestGenerationRef.current += 1
    submittingRef.current = false
  }, [])

  const visibleRecipes = props.projection.crafting.learnedRecipes.filter(entry => (
    craftingFilter === 'all'
      || (craftingFilter === 'available'
        ? entry.available
        : entry.unavailableReasons.some(reason => reason.code === 'materials-insufficient'))
  ))
  const recipe = visibleRecipes[selectedRecipeIndex]
    ?? visibleRecipes[0]
    ?? null
  const vendor = props.projection.vendors[selectedVendorIndex]
    ?? props.projection.vendors[0]
    ?? null
  const tradeItems = vendor ? (tradeView === 'buy' ? vendor.buy : vendor.sell) : []
  const tradeItem = tradeItems[selectedTradeItemIndex] ?? tradeItems[0] ?? null
  const maximumQuantity = primaryView === 'crafting'
    ? recipe?.maximumQuantity ?? 0
    : tradeItem?.maximumQuantity ?? 0
  const effectiveQuantity = clampQuantity(quantity, maximumQuantity)
  const actionBusy = props.busy || localSubmitting
  const craftingFilterOptions: Array<{
    kind: CraftingFilter
    label: string
    count: number
  }> = [
    { kind: 'all', label: '全部', count: props.projection.crafting.learnedRecipes.length },
    {
      kind: 'available',
      label: '可制作',
      count: props.projection.crafting.learnedRecipes.filter(entry => entry.available).length,
    },
    {
      kind: 'materials-insufficient',
      label: '材料不足',
      count: props.projection.crafting.learnedRecipes.filter(entry => (
        entry.unavailableReasons.some(reason => reason.code === 'materials-insufficient')
      )).length,
    },
  ]

  const selectCraftingFilter = (next: CraftingFilter) => {
    setCraftingFilter(next)
    setSelectedRecipeIndex(0)
    setQuantity(1)
    setOutcome(null)
  }

  const closeConfirmation = (restoreFocus = true) => {
    setConfirmation(null)
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus())
  }

  const openConfirmation = (
    event: MouseEvent<HTMLButtonElement>,
    pending: Omit<PendingConfirmation, 'sessionKey'>,
  ) => {
    if (actionBusy) return
    triggerRef.current = event.currentTarget
    setOutcome(null)
    setConfirmation({ ...pending, sessionKey: props.sessionKey })
  }

  const submit = (pending: PendingConfirmation) => {
    if (actionBusy || submittingRef.current) return
    const identity = props.projection.operationIdentity
    if (pending.sessionKey !== props.sessionKey
      || pending.request.sessionId !== identity.sessionId
      || pending.request.expectedBaseSequence !== identity.expectedBaseSequence) {
      closeConfirmation(false)
      setOutcome({
        sessionKey: props.sessionKey,
        request: pending.request,
        receipt: null,
        error: '游戏状态已经变化，请重新选择数量并确认。',
      })
      return
    }

    closeConfirmation(false)
    const request = pending.request
    const generation = requestGenerationRef.current + 1
    requestGenerationRef.current = generation
    submittingRef.current = true
    setLocalSubmitting(true)
    setOutcome(null)
    setLastRequest({
      sessionKey: props.sessionKey,
      request,
      receiptAtRequest: props.receipt ?? null,
    })

    let result: ExecuteResult
    try {
      result = props.onExecute(request)
    } catch (error) {
      result = Promise.reject(error)
    }
    void Promise.resolve(result)
      .then(receipt => {
        const context = currentContextRef.current
        if (requestGenerationRef.current !== generation
          || context.sessionKey !== props.sessionKey
          || context.sessionId !== request.sessionId) return
        if (!receipt) return
        setOutcome({
          sessionKey: props.sessionKey,
          request,
          receipt: requestsEqual(receipt.request, request) ? receipt : null,
          error: requestsEqual(receipt.request, request)
            ? null
            : '返回结果不属于本次请求，已停止显示。',
        })
      })
      .catch(error => {
        const context = currentContextRef.current
        if (requestGenerationRef.current !== generation
          || context.sessionKey !== props.sessionKey
          || context.sessionId !== request.sessionId) return
        setOutcome({ sessionKey: props.sessionKey, request, receipt: null, error: publicError(error) })
      })
      .finally(() => {
        const context = currentContextRef.current
        if (requestGenerationRef.current !== generation
          || context.sessionKey !== props.sessionKey
          || context.sessionId !== request.sessionId) return
        submittingRef.current = false
        setLocalSubmitting(false)
      })
  }

  const propReceipt = lastRequest
    && lastRequest.sessionKey === props.sessionKey
    && props.receipt
    && props.receipt !== lastRequest.receiptAtRequest
    && requestsEqual(props.receipt.request, lastRequest.request)
    ? props.receipt
    : null
  const visibleOutcome = outcome?.sessionKey === props.sessionKey ? outcome : null
  const visibleReceipt = propReceipt ?? visibleOutcome?.receipt ?? null
  const visibleError = visibleOutcome?.error ?? null
  const receiptSuccessful = visibleReceipt?.status === 'succeeded' || visibleReceipt?.status === 'degraded'
  const receiptPending = visibleReceipt?.status === 'pending'
  const feedbackFailure = visibleError != null || (visibleReceipt != null && !receiptSuccessful && !receiptPending)
  const visibleConfirmation = confirmation?.sessionKey === props.sessionKey
    && confirmation.request.sessionId === props.projection.operationIdentity.sessionId
    && confirmation.request.expectedBaseSequence === props.projection.operationIdentity.expectedBaseSequence
    ? confirmation
    : null
  confirmationOpenRef.current = confirmation != null

  return <section
    className="min-w-0"
    data-testid="text-open-world-crafting-economy-panel"
    aria-labelledby="text-open-world-crafting-economy-title"
    aria-busy={actionBusy}
  >
    <div
      className="grid min-w-0 gap-4"
      data-testid="text-open-world-crafting-economy-content"
      inert={visibleConfirmation != null}
      aria-hidden={visibleConfirmation != null || undefined}
    >
    <header className="rounded border border-accent/25 bg-gradient-to-br from-accent/10 via-bg-surface to-bg-surface p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div>
          <small className="font-mono text-[8px] tracking-[0.16em] text-accent">手艺与市集</small>
          <h1
            id="text-open-world-crafting-economy-title"
            ref={headingRef}
            tabIndex={-1}
            className="mt-1 flex items-center gap-2 font-serif text-2xl text-text-primary"
          >
            <Hammer className="h-5 w-5 text-accent" aria-hidden="true" />制作与交易
          </h1>
          <p className="mt-1 text-[10px] text-text-muted">当前位置：{props.projection.location.title}</p>
        </div>
        <dl className="rounded border border-border/70 bg-bg-base/60 px-4 py-2 text-right">
          <dt className="flex items-center justify-end gap-1 text-[9px] text-text-muted">
            <Coins className="h-3 w-3 text-accent" aria-hidden="true" />持有{props.projection.currency.label}
          </dt>
          <dd className="mt-1 font-mono text-lg font-semibold">{props.projection.currency.amount}</dd>
        </dl>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="制作与交易页面">
        <button
          id="text-open-world-crafting-tab-control"
          type="button"
          role="tab"
          data-testid="text-open-world-crafting-tab"
          aria-selected={primaryView === 'crafting'}
          aria-controls="text-open-world-crafting-view"
          onClick={() => { setPrimaryView('crafting'); setQuantity(1); setOutcome(null) }}
          className={primaryView === 'crafting'
            ? 'min-h-10 rounded bg-accent px-4 py-2 text-xs text-white'
            : 'min-h-10 rounded border border-border px-4 py-2 text-xs text-text-muted'}
        >制作</button>
        <button
          id="text-open-world-shop-tab-control"
          type="button"
          role="tab"
          data-testid="text-open-world-shop-tab"
          aria-selected={primaryView === 'shop'}
          aria-controls="text-open-world-shop-view"
          onClick={() => { setPrimaryView('shop'); resetChoice() }}
          className={primaryView === 'shop'
            ? 'min-h-10 rounded bg-accent px-4 py-2 text-xs text-white'
            : 'min-h-10 rounded border border-border px-4 py-2 text-xs text-text-muted'}
        >商店</button>
      </div>
    </header>

    {(props.projection.compatibility.notice
      || props.projection.compatibility.craftingReadOnly
      || props.projection.compatibility.economyReadOnly) && <aside
      className="rounded border border-warning/35 bg-warning/5 p-3 text-xs leading-5 text-warning"
      role="note"
    >
      {props.projection.compatibility.notice ?? '当前版本仅可查看，不能执行新的制作或交易。'}
    </aside>}

    <div
      className={`min-h-6 rounded border px-3 py-2 text-xs ${feedbackFailure ? 'border-danger/40 bg-danger/5' : visibleReceipt ? 'border-success/40 bg-success/5' : 'border-transparent'}`}
      data-testid="text-open-world-crafting-economy-feedback"
      role={feedbackFailure ? 'alert' : 'status'}
      aria-live={feedbackFailure ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {visibleError && <p className="m-0"><strong>请求未完成：</strong>{visibleError}</p>}
      {visibleReceipt && <div>
        <strong className={receiptSuccessful ? 'text-success' : receiptPending ? 'text-warning' : 'text-danger'}>
          {visibleReceipt.title}
        </strong>
        {visibleReceipt.message && <p className="m-0 mt-1 text-text-muted">{visibleReceipt.message}</p>}
        {visibleReceipt.details.length > 0 && <ul className="mt-1 list-disc space-y-1 pl-4 text-text-muted">
          {visibleReceipt.details.slice(0, 6).map((detail, index) => <li key={index}>{detail}</li>)}
        </ul>}
      </div>}
      {localSubmitting && !visibleError && !visibleReceipt && <span>正在等待正式规则结算…</span>}
    </div>

    {primaryView === 'crafting' && <div
      id="text-open-world-crafting-view"
      role="tabpanel"
      aria-labelledby="text-open-world-crafting-tab-control"
      className="grid min-w-0 gap-4 xl:grid-cols-[minmax(240px,0.72fr)_minmax(0,1.28fr)]"
    >
      <aside className="min-w-0 rounded border border-border bg-bg-surface p-4" aria-label="配方列表">
        <header className="flex items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Hammer className="h-4 w-4 text-accent" aria-hidden="true" />已学习配方</h2>
            <p className="mt-1 text-[10px] text-text-muted">选择配方后查看每份材料与当前最大数量。</p>
          </div>
          <span className="rounded-full border border-border px-2 py-1 text-[9px] text-text-muted">
            {props.projection.crafting.learnedRecipes.length} 已学习
          </span>
        </header>
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="筛选配方">
          {craftingFilterOptions.map(option => <button
            key={option.kind}
            type="button"
            aria-pressed={craftingFilter === option.kind}
            data-testid={`text-open-world-recipe-filter-${option.kind}`}
            onClick={() => selectCraftingFilter(option.kind)}
            className={craftingFilter === option.kind
              ? 'min-h-9 rounded-full bg-accent px-3 py-1 text-[10px] text-white'
              : 'min-h-9 rounded-full border border-border px-3 py-1 text-[10px] text-text-muted'}
          >{option.label} {option.count}</button>)}
        </div>
        {visibleRecipes.length > 0
          ? <ul className="mt-3 grid gap-2">
              {visibleRecipes.map((entry, index) => <li key={index}>
                <button
                  type="button"
                  aria-pressed={recipe === entry}
                  onClick={() => { setSelectedRecipeIndex(index); setQuantity(1); setOutcome(null) }}
                  className={recipe === entry
                    ? 'grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] gap-2 rounded border border-accent/45 bg-accent/10 p-3 text-left'
                    : 'grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] gap-2 rounded border border-border/70 bg-bg-base/60 p-3 text-left hover:border-accent/30'}
                  data-testid="text-open-world-recipe-option"
                >
                  <span className="min-w-0"><strong className="block break-words text-xs">{entry.title}</strong><small className="mt-1 block text-[9px] text-text-muted">{entry.categoryLabel}</small></span>
                  <small className={entry.available ? 'self-center text-success' : 'self-center text-warning'}>{entry.available ? '可制作' : '不可用'}</small>
                </button>
              </li>)}
            </ul>
          : <div className="mt-4 grid place-items-center gap-2 rounded border border-dashed border-border p-5 text-center">
              <PackageOpen className="h-5 w-5 text-text-muted" aria-hidden="true" />
              <p className="m-0 text-xs text-text-muted">
                {props.projection.crafting.learnedRecipes.length === 0
                  ? '尚未学习任何可展示的配方。'
                  : '没有符合当前筛选的配方。'}
              </p>
            </div>}
        {craftingFilter === 'all' && props.projection.crafting.lockedRecipeCount > 0 && props.projection.crafting.lockedPlaceholder && <section className="mt-4" aria-label="未学习配方">
          <h3 className="flex items-center gap-1 text-[10px] font-semibold text-text-muted">
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />未学习 {props.projection.crafting.lockedRecipeCount}
          </h3>
          <ul className="mt-2 grid gap-2">
            {Array.from({ length: props.projection.crafting.lockedRecipeCount }, (_, index) => <li
              key={index}
              className="rounded border border-dashed border-border bg-bg-base/45 p-3"
              data-testid="text-open-world-locked-recipe-placeholder"
            >
              <strong className="text-xs text-text-muted">{props.projection.crafting.lockedPlaceholder!.title}</strong>
              <p className="m-0 mt-1 text-[9px] leading-4 text-text-muted">{props.projection.crafting.lockedPlaceholder!.message}</p>
            </li>)}
          </ul>
        </section>}
      </aside>

      {recipe ? <article className="min-w-0 rounded border border-border bg-bg-surface p-4" data-testid="text-open-world-recipe-detail">
        <header>
          <small className="text-[9px] text-accent">{recipe.categoryLabel}</small>
          <h2 className="mt-1 break-words font-serif text-xl">{recipe.title}</h2>
          <p className="mt-2 text-xs leading-5 text-text-muted">{recipe.description}</p>
        </header>
        <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
          <section className="rounded border border-border/70 bg-bg-base/60 p-3" aria-label="所需材料">
            <h3 className="text-xs font-semibold">所需材料</h3>
            <ul className="mt-2 grid gap-2">
              {recipe.ingredients.map((ingredient, index) => <li key={index} className="flex min-w-0 justify-between gap-2 text-[10px]">
                <span className="min-w-0 break-words">{ingredient.title}</span>
                <span className={ingredient.inventoryQuantity >= ingredient.requiredQuantity * effectiveQuantity ? 'shrink-0 font-mono text-success' : 'shrink-0 font-mono text-warning'}>
                  需要 {ingredient.requiredQuantity * effectiveQuantity} / 库存 {ingredient.inventoryQuantity}
                </span>
              </li>)}
              {!recipe.ingredients.length && <li className="text-[10px] text-text-muted">此配方没有材料消耗。</li>}
            </ul>
          </section>
          <section className="rounded border border-border/70 bg-bg-base/60 p-3" aria-label="制作产物">
            <h3 className="text-xs font-semibold">确定产物</h3>
            <ul className="mt-2 grid gap-2">
              {recipe.outputs.map((output, index) => <li key={index} className="flex min-w-0 justify-between gap-2 text-[10px]">
                <span className="min-w-0 break-words">{output.title}</span><strong className="shrink-0 font-mono text-accent">×{output.quantity * effectiveQuantity}</strong>
              </li>)}
            </ul>
            <p className="mt-3 text-[10px] text-text-muted">耗时 {recipe.timeCostMinutes * effectiveQuantity} 分钟 · 成功由正式规则确定</p>
          </section>
        </div>
        <div className="mt-4 grid gap-3">
          <QuantityControl
            label="制作"
            value={effectiveQuantity}
            maximum={recipe.maximumQuantity}
            disabled={actionBusy || !recipe.available || !recipe.action || props.projection.compatibility.craftingReadOnly}
            onChange={setQuantity}
          />
          {!recipe.available && <p className="m-0 flex items-start gap-1 text-[10px] leading-5 text-warning" role="note">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{unavailableText(recipe.unavailableReasons)}
          </p>}
          <button
            type="button"
            disabled={actionBusy || !recipe.available || !recipe.action?.available || recipe.maximumQuantity < 1 || props.projection.compatibility.craftingReadOnly}
            aria-describedby={!recipe.available ? 'text-open-world-selected-recipe-reason' : undefined}
            data-testid="text-open-world-craft-submit"
            onClick={event => {
              if (!recipe.action) return
              const request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1 = {
                sessionId: props.projection.operationIdentity.sessionId,
                expectedBaseSequence: props.projection.operationIdentity.expectedBaseSequence,
                kind: 'craft',
                actionKey: recipe.action.actionKey,
                targetKey: recipe.action.targetKey,
                quantity: effectiveQuantity,
              }
              openConfirmation(event, {
                request,
                heading: `确认制作“${recipe.title}”`,
                submitLabel: '确认制作',
                summary: [
                  `数量：${effectiveQuantity} 份`,
                  `产物：${recipe.outputs.map(output => `${output.title} ×${output.quantity * effectiveQuantity}`).join('、')}`,
                  `材料：${recipe.ingredients.map(ingredient => `${ingredient.title} ×${ingredient.requiredQuantity * effectiveQuantity}`).join('、') || '无'}`,
                  `耗时：${recipe.timeCostMinutes * effectiveQuantity} 分钟`,
                ],
              })
            }}
            className="min-h-11 rounded bg-accent px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-border disabled:text-text-muted"
          >制作 {effectiveQuantity} 份</button>
          {!recipe.available && <span id="text-open-world-selected-recipe-reason" className="sr-only">{unavailableText(recipe.unavailableReasons)}</span>}
        </div>
      </article> : <article className="grid min-h-52 place-items-center rounded border border-border bg-bg-surface p-6 text-center">
        <div><LockKeyhole className="mx-auto h-7 w-7 text-text-muted" aria-hidden="true" /><p className="mt-2 text-xs text-text-muted">学习配方后可在这里查看材料并制作。</p></div>
      </article>}
    </div>}

    {primaryView === 'shop' && <div
      id="text-open-world-shop-view"
      role="tabpanel"
      aria-labelledby="text-open-world-shop-tab-control"
      className="grid min-w-0 gap-4"
    >
      {props.projection.vendors.length ? <>
        <section className="rounded border border-border bg-bg-surface p-4" aria-label="商店选择">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="flex items-center gap-2 text-sm font-semibold"><Store className="h-4 w-4 text-accent" aria-hidden="true" />当前商店</h2><p className="mt-1 text-[10px] text-text-muted">只显示当前地点可公开的商店与正式成交价格。</p></div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="选择商店">
              {props.projection.vendors.map((entry, index) => <button
                key={index}
                type="button"
                aria-pressed={vendor === entry}
                onClick={() => { setSelectedVendorIndex(index); resetChoice() }}
                className={vendor === entry ? 'min-h-9 rounded bg-accent px-3 py-1 text-[10px] text-white' : 'min-h-9 rounded border border-border px-3 py-1 text-[10px] text-text-muted'}
              >{entry.title}</button>)}
            </div>
          </header>
        </section>
        {vendor && <section
          id="text-open-world-trade-view"
          role="tabpanel"
          aria-labelledby={`text-open-world-${tradeView}-tab-control`}
          className="grid min-w-0 gap-4 xl:grid-cols-[minmax(240px,0.76fr)_minmax(0,1.24fr)]"
        >
          <aside className="min-w-0 rounded border border-border bg-bg-surface p-4">
            <header>
              <small className="text-[9px] text-accent">{vendor.merchantName} · {vendor.attitude.label}</small>
              <h2 className="mt-1 font-serif text-xl">{vendor.title}</h2>
            </header>
            {!vendor.available && <p className="mt-3 flex items-start gap-1 text-[10px] leading-5 text-warning" role="note">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{unavailableText(vendor.unavailableReasons)}
            </p>}
            <div className="mt-4 flex gap-2" role="tablist" aria-label="买入与卖出">
              {(['buy', 'sell'] as const).map(kind => <button
                key={kind}
                id={`text-open-world-${kind}-tab-control`}
                type="button"
                role="tab"
                aria-controls="text-open-world-trade-view"
                data-testid={`text-open-world-${kind}-tab`}
                aria-selected={tradeView === kind}
                onClick={() => { setTradeView(kind); resetChoice() }}
                className={tradeView === kind ? 'min-h-10 flex-1 rounded bg-accent px-3 py-2 text-xs text-white' : 'min-h-10 flex-1 rounded border border-border px-3 py-2 text-xs text-text-muted'}
              >{kind === 'buy' ? '买入' : '卖出'}</button>)}
            </div>
            <section className="mt-4 rounded border border-border/70 bg-bg-base/60 p-3" aria-label={`${tradeView === 'buy' ? '买入' : '卖出'}价格说明`}>
              <h3 className="text-xs font-semibold">价格倍率说明</h3>
              <ul className="mt-2 grid gap-1 text-[10px] text-text-muted">
                {vendor.priceExplanation[tradeView].map((part, index) => <li key={index} className="flex justify-between gap-2"><span>{part.label}</span><strong className="font-mono text-text-primary">{part.display}</strong></li>)}
              </ul>
              <p className="mt-2 text-[9px] leading-4 text-text-muted">
                {tradeView === 'buy' ? vendor.priceExplanation.buyRounding : vendor.priceExplanation.sellRounding}
              </p>
              <p className="mt-2 text-[9px] leading-4 text-text-muted">上列倍率已经计入投影给出的单价；界面不会自行改价。</p>
            </section>
            <ul className="mt-4 grid gap-2" aria-label={`${tradeView === 'buy' ? '买入' : '卖出'}商品`}>
              {tradeItems.map((entry, index) => <li key={index}>
                <button
                  type="button"
                  aria-pressed={tradeItem === entry}
                  onClick={() => { setSelectedTradeItemIndex(index); setQuantity(1); setOutcome(null) }}
                  className={tradeItem === entry ? 'grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] gap-2 rounded border border-accent/45 bg-accent/10 p-3 text-left' : 'grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] gap-2 rounded border border-border/70 bg-bg-base/60 p-3 text-left'}
                  data-testid="text-open-world-trade-item-option"
                >
                  <span className="min-w-0"><strong className="block break-words text-xs">{entry.title}</strong><small className="mt-1 block text-[9px] text-text-muted">{entry.categoryLabel} · {entry.stock.label}</small></span>
                  <span className="self-center text-right"><strong className="block font-mono text-xs text-accent">{entry.unitPrice ?? '—'}</strong><small className={entry.available ? 'text-success' : 'text-warning'}>{entry.available ? '可交易' : '不可用'}</small></span>
                </button>
              </li>)}
              {!tradeItems.length && <li className="rounded border border-dashed border-border p-5 text-center text-xs text-text-muted">当前没有可{tradeView === 'buy' ? '买入' : '卖出'}的商品。</li>}
            </ul>
          </aside>

          {tradeItem ? <article className="min-w-0 rounded border border-border bg-bg-surface p-4" data-testid="text-open-world-trade-detail">
            <header>
              <small className="text-[9px] text-accent">{tradeItem.categoryLabel} · {tradeView === 'buy' ? '买入' : '卖出'}</small>
              <h2 className="mt-1 font-serif text-xl">{tradeItem.title}</h2>
              <p className="mt-2 text-xs leading-5 text-text-muted">{tradeItem.description}</p>
            </header>
            <dl className="mt-4 grid gap-2 rounded border border-border/70 bg-bg-base/60 p-3 text-xs sm:grid-cols-2">
              <div><dt className="text-[9px] text-text-muted">玩家库存</dt><dd className="mt-1 font-mono font-semibold">{tradeItem.playerQuantity}</dd></div>
              <div><dt className="text-[9px] text-text-muted">商店库存</dt><dd className="mt-1 font-mono font-semibold">{tradeItem.stock.label}</dd></div>
              <div><dt className="text-[9px] text-text-muted">单价</dt><dd className="mt-1 font-mono font-semibold">{tradeItem.unitPrice == null ? '不可报价' : `${tradeItem.unitPrice} ${props.projection.currency.label}`}</dd></div>
              <div><dt className="text-[9px] text-text-muted">本次数量上限</dt><dd className="mt-1 font-mono font-semibold">{tradeItem.maximumQuantity}</dd></div>
              <div className="sm:col-span-2"><dt className="text-[9px] text-text-muted">本次总价</dt><dd className="mt-1 font-mono text-lg font-semibold text-accent">{tradeItem.unitPrice == null ? '不可报价' : `${tradeItem.unitPrice * effectiveQuantity} ${props.projection.currency.label}`}</dd></div>
            </dl>
            {tradeItem.equipmentComparison && <div className="mt-4">
              <TradeEquipmentComparison comparison={tradeItem.equipmentComparison} />
            </div>}
            <div className="mt-4 grid gap-3">
              <QuantityControl
                label={tradeView === 'buy' ? '买入' : '卖出'}
                value={effectiveQuantity}
                maximum={tradeItem.maximumQuantity}
                disabled={actionBusy || !vendor.available || !tradeItem.available || !tradeItem.action?.available || tradeItem.unitPrice == null || props.projection.compatibility.economyReadOnly}
                onChange={setQuantity}
              />
              {!tradeItem.available && <p className="m-0 flex items-start gap-1 text-[10px] leading-5 text-warning" role="note">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{unavailableText(tradeItem.unavailableReasons)}
              </p>}
              <button
                type="button"
                disabled={actionBusy || !vendor.available || !tradeItem.available || !tradeItem.action?.available || tradeItem.unitPrice == null || tradeItem.maximumQuantity < 1 || props.projection.compatibility.economyReadOnly}
                data-testid="text-open-world-trade-submit"
                onClick={event => {
                  if (!tradeItem.action || tradeItem.unitPrice == null) return
                  const relationshipModifier = vendor.priceExplanation[tradeView]
                    .find(part => part.label.includes('关系'))
                  const request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1 = {
                    sessionId: props.projection.operationIdentity.sessionId,
                    expectedBaseSequence: props.projection.operationIdentity.expectedBaseSequence,
                    kind: tradeView,
                    actionKey: tradeItem.action.actionKey,
                    targetKey: tradeItem.action.targetKey,
                    itemKey: tradeItem.action.itemKey,
                    quantity: effectiveQuantity,
                  }
                  openConfirmation(event, {
                    request,
                    heading: `确认${tradeView === 'buy' ? '买入' : '卖出'}“${tradeItem.title}”`,
                    submitLabel: `确认${tradeView === 'buy' ? '买入' : '卖出'}`,
                    summary: [
                      `商店：${vendor.title}（${vendor.merchantName}）`,
                      `数量：${effectiveQuantity}`,
                      `商店库存：${tradeItem.stock.label}`,
                      `当前关系：${vendor.attitude.label}`,
                      `关系倍率：${relationshipModifier ? `${relationshipModifier.label} ${relationshipModifier.display}` : '本方向无单独关系修正'}`,
                      `单价：${tradeItem.unitPrice} ${props.projection.currency.label}`,
                      `总价：${tradeItem.unitPrice * effectiveQuantity} ${props.projection.currency.label}`,
                      `当前持有：${props.projection.currency.amount} ${props.projection.currency.label}`,
                    ],
                  })
                }}
                className="min-h-11 rounded bg-accent px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-border disabled:text-text-muted"
              >
                <ShoppingBasket className="mr-1 inline h-4 w-4" aria-hidden="true" />
                {tradeView === 'buy' ? '买入' : '卖出'} {effectiveQuantity} 件 · {tradeItem.unitPrice == null ? '不可报价' : `${tradeItem.unitPrice * effectiveQuantity} ${props.projection.currency.label}`}
              </button>
            </div>
          </article> : <article className="grid min-h-52 place-items-center rounded border border-border bg-bg-surface p-6 text-center">
            <div><PackageOpen className="mx-auto h-7 w-7 text-text-muted" aria-hidden="true" /><p className="mt-2 text-xs text-text-muted">当前商店没有这一类商品。</p></div>
          </article>}
        </section>}
      </> : <section className="grid min-h-52 place-items-center rounded border border-dashed border-border bg-bg-surface p-6 text-center" role="status">
        <div><Store className="mx-auto h-7 w-7 text-text-muted" aria-hidden="true" /><h2 className="mt-2 text-sm font-semibold">当前位置没有商店</h2><p className="mt-1 text-xs text-text-muted">前往提供交易服务的地点后再来查看。</p></div>
      </section>}
    </div>}

    <footer className="flex flex-wrap items-center gap-2 rounded border border-border/70 bg-bg-surface px-3 py-2 text-[9px] text-text-muted">
      <CheckCircle2 className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
      本页只提交投影给出的目标、数量和事件基线；材料扣除、产物、库存与货币变化由正式事务原子结算。
    </footer>
    </div>

    {visibleConfirmation && <ConfirmationDialog
        confirmation={visibleConfirmation}
        busy={actionBusy}
        onCancel={() => closeConfirmation()}
        onConfirm={() => submit(visibleConfirmation)}
      />}
  </section>
}
