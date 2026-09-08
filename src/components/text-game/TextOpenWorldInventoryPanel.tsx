import { useEffect, useState } from 'react'
import {
  Backpack,
  Coins,
  PackageOpen,
  Search,
  ShieldAlert,
  Swords,
  TriangleAlert,
} from 'lucide-react'
import {
  projectTextOpenWorldPlayerInventoryV1,
  type TextOpenWorldPlayerEquipmentChangePreviewV1,
  type TextOpenWorldPlayerInventoryActionV1,
  type TextOpenWorldPlayerInventoryCategoryV1,
  type TextOpenWorldPlayerInventoryItemV1,
} from '../../lib/open-world/player-inventory'
import type {
  TextOpenWorldFeedbackReceiptV1,
  TextOpenWorldSessionProjectionV1,
} from '../../lib/types'

type InventoryView = 'inventory' | 'equipment'
type InventoryCategory = 'all' | TextOpenWorldPlayerInventoryCategoryV1
type InventorySort = 'category' | 'name' | 'quantity' | 'base-value'

const CATEGORY_ORDER: TextOpenWorldPlayerInventoryCategoryV1[] = [
  'equipment',
  'consumable',
  'material',
  'quest',
  'misc',
]

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN')
}

function InventoryActionButton(props: {
  kind: 'use' | 'equip' | 'unequip' | 'drop'
  action: TextOpenWorldPlayerInventoryActionV1 | null
  busy: boolean
  onExecute: (actionKey: string, targetKey: string) => void | Promise<void>
}) {
  const { action } = props
  if (!action) return null
  const disabled = props.busy || !action.available
  return <div className="grid min-w-0 gap-1" data-action-kind={props.kind}>
    <button
      type="button"
      disabled={disabled}
      onClick={() => { void props.onExecute(action.actionKey, action.targetKey) }}
      className={props.kind === 'drop'
        ? 'min-h-10 rounded border border-danger/40 px-3 py-2 text-xs text-danger disabled:cursor-not-allowed disabled:opacity-45'
        : 'min-h-10 rounded border border-accent/40 px-3 py-2 text-xs text-accent disabled:cursor-not-allowed disabled:opacity-45'}
    >
      {action.label}
    </button>
    {action.confirmationRequired && action.available && <small className="text-[9px] text-text-muted">
      执行前将由系统再次确认
    </small>}
    {!action.available && <small className="max-w-60 text-[9px] leading-4 text-warning">
      {action.unavailableReasons.map(reason => reason.message).join('；') || '当前不可执行。'}
    </small>}
  </div>
}

function EquipmentPreview(props: {
  title: string
  preview: TextOpenWorldPlayerEquipmentChangePreviewV1
}) {
  return <details className="min-w-0 rounded border border-border/70 bg-bg-surface/70 p-2">
    <summary className="cursor-pointer text-[10px] text-accent">{props.title}</summary>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[360px] text-left text-[10px]">
        <caption className="sr-only">{props.title}的旧值、新值与差值</caption>
        <thead className="text-text-muted">
          <tr>
            <th className="py-1 pr-3 font-normal">属性</th>
            <th className="px-2 py-1 text-right font-normal">旧值</th>
            <th className="px-2 py-1 text-right font-normal">新值</th>
            <th className="py-1 pl-2 text-right font-normal">差值</th>
          </tr>
        </thead>
        <tbody>
          {props.preview.stats.map(stat => <tr
            key={stat.semantic}
            className="border-t border-border/60"
            data-change-direction={stat.direction}
          >
            <th className="py-1 pr-3 font-normal text-text-primary">{stat.label}</th>
            <td className="px-2 py-1 text-right font-mono text-text-muted">{stat.displayBefore}</td>
            <td className="px-2 py-1 text-right font-mono">{stat.displayAfter}</td>
            <td className={stat.direction === 'increase'
              ? 'py-1 pl-2 text-right font-mono text-success'
              : stat.direction === 'decrease'
                ? 'py-1 pl-2 text-right font-mono text-warning'
                : 'py-1 pl-2 text-right font-mono text-text-muted'}>
              {stat.displayDelta}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {!!props.preview.resourceAdjustmentMessages.length && <div
      className="mt-2 rounded border border-warning/30 bg-warning/5 p-2 text-[9px] leading-4 text-warning"
      role="note"
    >
      <strong className="flex items-center gap-1">
        <TriangleAlert className="h-3 w-3" aria-hidden="true" />资源上限变化提示
      </strong>
      {props.preview.resourceAdjustmentMessages.map(message => <p key={message} className="m-0 mt-1">{message}</p>)}
    </div>}
  </details>
}

function InventoryDetail(props: {
  item: TextOpenWorldPlayerInventoryItemV1
  busy: boolean
  onExecute: (actionKey: string, targetKey: string) => void | Promise<void>
}) {
  const { item } = props
  const actions = [
    { kind: 'use' as const, action: item.actions.use },
    { kind: 'equip' as const, action: item.actions.equip },
    { kind: 'unequip' as const, action: item.actions.unequip },
    { kind: 'drop' as const, action: item.actions.drop },
  ]
  return <article
    className="min-w-0 rounded border border-border bg-bg-surface p-4"
    data-testid="text-open-world-inventory-detail"
  >
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <small className="text-[9px] tracking-wide text-accent">{item.category.label}</small>
        <h2 className="mt-1 break-words font-serif text-xl text-text-primary">{item.title}</h2>
        {item.equippedSlot && <span className="mt-1 inline-block rounded-full bg-accent/15 px-2 py-1 text-[9px] text-accent">
          已装备 · {item.equippedSlot.label}
        </span>}
      </div>
      <dl className="grid shrink-0 grid-cols-2 gap-x-3 gap-y-1 text-right text-[10px]">
        <dt className="text-text-muted">持有数量</dt><dd className="font-mono font-semibold">{item.quantity}</dd>
        <dt className="text-text-muted">可操作数量</dt><dd className="font-mono font-semibold">{item.removableQuantity}</dd>
      </dl>
    </header>

    <p className="mt-3 break-words text-xs leading-6 text-text-muted">{item.description}</p>
    {!!item.tags.length && <div className="mt-2 flex flex-wrap gap-1" aria-label="物品标签">
      {item.tags.map(tag => <span key={tag} className="rounded border border-border px-2 py-0.5 text-[9px] text-text-muted">{tag}</span>)}
    </div>}

    <dl className="mt-4 grid gap-2 rounded border border-border/70 bg-bg-base/60 p-3 text-xs sm:grid-cols-2">
      <div className="min-w-0">
        <dt className="text-[9px] text-text-muted">安全来源概括</dt>
        <dd className="mt-1 break-words">{item.sourceSummary}</dd>
      </div>
      <div>
        <dt className="text-[9px] text-text-muted">{item.baseValue.label}（非成交价）</dt>
        <dd className="mt-1 font-mono">{item.baseValue.amount}</dd>
      </div>
      <div>
        <dt className="text-[9px] text-text-muted">用途</dt>
        <dd className="mt-1">{item.category.kind === 'equipment'
          ? '装备后改变角色属性。'
          : item.category.kind === 'consumable'
            ? '通过正式使用行动消耗并生效。'
            : item.category.kind === 'material'
              ? '用于已发布配方；制作入口在制作功能中。'
              : item.category.kind === 'quest'
                ? '用于任务推进并受到关键保护规则约束。'
                : '用途由已发布内容决定。'}</dd>
      </div>
      <div>
        <dt className="text-[9px] text-text-muted">装备/保护状态</dt>
        <dd className="mt-1">已装备 {item.equippedQuantity} · 可移除 {item.removableQuantity}</dd>
      </div>
    </dl>

    <section className="mt-4" aria-label="属性修正">
      <h3 className="text-xs font-semibold">属性修正</h3>
      {item.statModifiers.length
        ? <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {item.statModifiers.map(modifier => <li
              key={modifier.semantic}
              className="flex justify-between rounded border border-border/70 bg-bg-base/60 px-3 py-2 text-[10px]"
            >
              <span>{modifier.label}</span><strong className="font-mono text-accent">{modifier.displayValue}</strong>
            </li>)}
          </ul>
        : <p className="mt-1 text-[10px] text-text-muted">没有战斗属性修正。</p>}
    </section>

    {!!item.protectionMessages.length && <aside
      className="mt-4 rounded border border-warning/30 bg-warning/5 p-3 text-[10px] leading-5 text-warning"
      aria-label="关键保护"
    >
      <strong className="flex items-center gap-1">
        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />保护规则
      </strong>
      {item.protectionMessages.map(message => <p key={message} className="m-0 mt-1">{message}</p>)}
    </aside>}

    <section className="mt-4" aria-label="物品操作">
      <h3 className="text-xs font-semibold">可用操作</h3>
      <div className="mt-2 flex min-w-0 flex-wrap items-start gap-2">
        {actions.map(entry => <InventoryActionButton
          key={entry.kind}
          kind={entry.kind}
          action={entry.action}
          busy={props.busy}
          onExecute={props.onExecute}
        />)}
        {!actions.some(entry => entry.action) && <small className="text-text-muted">此物品没有可直接执行的行动。</small>}
      </div>
    </section>

    <section className="mt-4 rounded border border-border/70 bg-bg-base/60 p-3" aria-label="出售政策">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold">出售政策</h3>
          <p className={item.salePolicy.protected
            ? 'm-0 mt-1 break-words text-[10px] text-warning'
            : 'm-0 mt-1 break-words text-[10px] text-text-muted'}>
            {item.salePolicy.message}
          </p>
        </div>
        {item.salePolicy.sellable && <span className="rounded border border-border px-3 py-2 text-[10px] text-text-muted">
          前往商店交易
        </span>}
      </div>
      {item.salePolicy.sellable && <small className="mt-2 block text-[9px] text-text-muted">
        此处只显示交易资格，不执行出售；实际价格、数量和回执由商店处理。
      </small>}
    </section>
  </article>
}

export interface TextOpenWorldInventoryPanelProps {
  sessionKey: string | number
  projection: TextOpenWorldSessionProjectionV1
  busy: boolean
  feedback: TextOpenWorldFeedbackReceiptV1 | null
  onExecute: (actionKey: string, targetKey: string) => void | Promise<void>
}

export default function TextOpenWorldInventoryPanel(props: TextOpenWorldInventoryPanelProps) {
  const inventory = projectTextOpenWorldPlayerInventoryV1(props.projection)
  const [view, setView] = useState<InventoryView>('inventory')
  const [category, setCategory] = useState<InventoryCategory>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<InventorySort>('category')
  const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(null)
  const [lastRequest, setLastRequest] = useState<{
    sessionKey: string | number
    actionKey: string
    targetKey: string
    feedbackReceiptHashAtRequest: string | null
  } | null>(null)

  useEffect(() => {
    setView('inventory')
    setCategory('all')
    setQuery('')
    setSort('category')
    setSelectedTargetKey(null)
    setLastRequest(null)
  }, [props.sessionKey])

  const execute = (actionKey: string, targetKey: string) => {
    setLastRequest({
      sessionKey: props.sessionKey,
      actionKey,
      targetKey,
      feedbackReceiptHashAtRequest: props.feedback?.receiptHash ?? null,
    })
    return props.onExecute(actionKey, targetKey)
  }

  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const visibleItems = inventory.items
    .filter(item => category === 'all' || item.category.kind === category)
    .filter(item => !normalizedQuery || [item.title, item.description, item.category.label, ...item.tags]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(normalizedQuery)))
    .sort((left, right) => {
      const name = compareText(left.title, right.title)
      if (sort === 'name') return name
      if (sort === 'quantity') return right.quantity - left.quantity || name
      if (sort === 'base-value') return right.baseValue.amount - left.baseValue.amount || name
      return CATEGORY_ORDER.indexOf(left.category.kind) - CATEGORY_ORDER.indexOf(right.category.kind) || name
    })
  const selectedItem = visibleItems.find(item => item.operationTargetKey === selectedTargetKey)
    ?? visibleItems[0]
    ?? null

  const categoryOptions: Array<{ kind: InventoryCategory; label: string; count: number }> = [
    { kind: 'all', label: '全部', count: inventory.summary.distinctItemCount },
    ...inventory.categories.map(entry => ({
      kind: entry.kind,
      label: entry.label,
      count: entry.distinctItemCount,
    })),
  ]
  const ownedFeedback = lastRequest?.sessionKey === props.sessionKey
    && props.feedback?.actionKey === lastRequest.actionKey
    && props.feedback.targetKey === lastRequest.targetKey
    && props.feedback.receiptHash !== lastRequest.feedbackReceiptHashAtRequest
    && (typeof props.sessionKey !== 'number' || props.feedback.sessionId === props.sessionKey)
    ? props.feedback
    : null

  return <section
    className="grid min-w-0 gap-4"
    data-testid="text-open-world-inventory-panel"
    aria-label="背包与装备"
    aria-busy={props.busy}
  >
    <header className="rounded border border-accent/25 bg-gradient-to-br from-accent/10 via-bg-surface to-bg-surface p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div>
          <small className="font-mono text-[8px] tracking-[0.16em] text-accent">冒险物资</small>
          <h1 className="mt-1 flex items-center gap-2 font-serif text-2xl text-text-primary">
            <Backpack className="h-5 w-5 text-accent" aria-hidden="true" />背包与装备
          </h1>
        </div>
        <dl
          className="grid grid-cols-2 gap-x-5 gap-y-1 rounded border border-border/70 bg-bg-base/60 px-3 py-2 text-[10px] sm:grid-cols-4"
          data-testid="text-open-world-inventory-summary"
        >
          <div><dt className="text-text-muted">种类</dt><dd className="font-mono font-semibold">{inventory.summary.distinctItemCount}</dd></div>
          <div><dt className="text-text-muted">总数量</dt><dd className="font-mono font-semibold">{inventory.summary.totalQuantity}</dd></div>
          <div><dt className="text-text-muted">已装备</dt><dd className="font-mono font-semibold">{inventory.summary.equippedSlotCount}/{inventory.summary.totalSlotCount}</dd></div>
          <div><dt className="text-text-muted">{inventory.summary.currency.label}</dt><dd className="font-mono font-semibold">{inventory.summary.currency.amount}</dd></div>
        </dl>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="背包与装备视图">
        <button
          type="button"
          aria-pressed={view === 'inventory'}
          onClick={() => setView('inventory')}
          className={view === 'inventory'
            ? 'min-h-10 rounded bg-accent px-4 py-2 text-xs text-white'
            : 'min-h-10 rounded border border-border px-4 py-2 text-xs text-text-muted'}
        >背包</button>
        <button
          type="button"
          aria-pressed={view === 'equipment'}
          onClick={() => setView('equipment')}
          className={view === 'equipment'
            ? 'min-h-10 rounded bg-accent px-4 py-2 text-xs text-white'
            : 'min-h-10 rounded border border-border px-4 py-2 text-xs text-text-muted'}
        >装备</button>
      </div>
    </header>

    <div
      className="min-h-5 text-xs text-text-muted"
      aria-live="polite"
      aria-atomic="true"
      data-testid="text-open-world-inventory-feedback"
    >
      {ownedFeedback && <p className="m-0">
        <strong className="text-text-primary">{ownedFeedback.presentation.headline}</strong>
        {ownedFeedback.reason?.message && `：${ownedFeedback.reason.message}`}
      </p>}
    </div>

    {view === 'inventory' && <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.28fr)]">
      <aside className="min-w-0 rounded border border-border bg-bg-surface p-4" aria-label="背包列表">
        <div className="grid gap-3">
          <label className="relative block min-w-0">
            <span className="sr-only">搜索背包</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索名称、说明或标签"
              aria-label="搜索背包"
              className="min-h-10 w-full rounded border border-border bg-bg-base py-2 pl-9 pr-3 text-xs outline-none focus:border-accent"
            />
          </label>
          <label className="grid gap-1 text-[10px] text-text-muted">
            排序
            <select
              value={sort}
              onChange={event => setSort(event.target.value as InventorySort)}
              aria-label="背包排序"
              className="min-h-10 rounded border border-border bg-bg-base px-3 py-2 text-xs text-text-primary"
            >
              <option value="category">按类别</option>
              <option value="name">按名称</option>
              <option value="quantity">按数量</option>
              <option value="base-value">按基础价值</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="物品分类">
          {categoryOptions.map(option => <button
            key={option.kind}
            type="button"
            aria-pressed={category === option.kind}
            data-category={option.kind}
            onClick={() => setCategory(option.kind)}
            className={category === option.kind
              ? 'min-h-9 rounded-full bg-accent px-3 py-1 text-[10px] text-white'
              : 'min-h-9 rounded-full border border-border px-3 py-1 text-[10px] text-text-muted'}
          >{option.label} {option.count}</button>)}
        </div>

        {visibleItems.length > 0
          ? <ul className="mt-4 grid gap-2" data-testid="text-open-world-inventory-list">
              {visibleItems.map(item => <li key={item.operationTargetKey}>
                <button
                  type="button"
                  aria-pressed={selectedItem?.operationTargetKey === item.operationTargetKey}
                  onClick={() => setSelectedTargetKey(item.operationTargetKey)}
                  className={selectedItem?.operationTargetKey === item.operationTargetKey
                    ? 'grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] gap-2 rounded border border-accent/45 bg-accent/10 p-3 text-left'
                    : 'grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] gap-2 rounded border border-border/70 bg-bg-base/60 p-3 text-left hover:border-accent/30'}
                  data-testid="text-open-world-inventory-item"
                >
                  <span className="min-w-0">
                    <strong className="block break-words text-xs">{item.title}</strong>
                    <small className="mt-1 block text-[9px] text-text-muted">
                      {item.category.label}{item.equippedQuantity ? ` · 已装备 ${item.equippedQuantity}` : ''}
                    </small>
                  </span>
                  <strong className="self-center font-mono text-xs text-accent">×{item.quantity}</strong>
                </button>
              </li>)}
            </ul>
          : <div className="mt-6 grid place-items-center gap-2 rounded border border-dashed border-border p-6 text-center">
              <PackageOpen className="h-6 w-6 text-text-muted" aria-hidden="true" />
              <p className="m-0 text-xs text-text-muted">
                {inventory.items.length ? '没有符合当前筛选的物品。' : '背包为空。'}
              </p>
              {!!inventory.items.length && <button
                type="button"
                onClick={() => { setCategory('all'); setQuery('') }}
                className="min-h-9 rounded border border-border px-3 py-1 text-[10px] text-accent"
              >清除筛选</button>}
            </div>}
      </aside>

      {selectedItem
        ? <InventoryDetail item={selectedItem} busy={props.busy} onExecute={execute} />
        : <article className="grid min-h-48 place-items-center rounded border border-border bg-bg-surface p-6 text-center">
            <div>
              <PackageOpen className="mx-auto h-7 w-7 text-text-muted" aria-hidden="true" />
              <p className="mt-2 text-xs text-text-muted">选择一个物品查看详情。</p>
            </div>
          </article>}
    </div>}

    {view === 'equipment' && <div className="grid min-w-0 gap-4" data-testid="text-open-world-equipment-view">
      <div className="rounded border border-border bg-bg-surface p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Swords className="h-4 w-4 text-accent" aria-hidden="true" />装备配置
        </h2>
        <p className="mt-1 text-[10px] text-text-muted">
          属性预览来自当前存档的确定性数值规则；操作仍须经过正式Action校验。
        </p>
      </div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-3">
        {inventory.equipmentSlots.map(slot => <article
          key={slot.semantic}
          className="min-w-0 rounded border border-border bg-bg-surface p-4"
          data-testid="text-open-world-equipment-slot"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border/70 pb-3">
            <h3 className="text-sm font-semibold">{slot.label}</h3>
            <span className="rounded-full border border-border px-2 py-1 text-[9px] text-text-muted">
              {slot.current ? '已装备' : '空槽位'}
            </span>
          </header>
          <section className="mt-3 rounded bg-bg-base/60 p-3" aria-label={`${slot.label}当前装备`}>
            <small className="text-[9px] text-text-muted">当前装备</small>
            <strong className="mt-1 block break-words text-xs">{slot.current?.title ?? '未装备'}</strong>
            {slot.current && <div className="mt-3 grid gap-2">
              <EquipmentPreview title="查看卸下后的旧值、新值与差值" preview={slot.current.preview} />
              <InventoryActionButton
                kind="unequip"
                action={slot.current.unequipAction}
                busy={props.busy}
                onExecute={execute}
              />
            </div>}
          </section>
          <section className="mt-4" aria-label={`${slot.label}候选装备`}>
            <h4 className="text-xs font-semibold">候选装备</h4>
            {slot.candidates.length
              ? <ul className="mt-2 grid gap-3">
                  {slot.candidates.map(candidate => <li
                    key={candidate.operationTargetKey}
                    className="min-w-0 rounded border border-border/70 bg-bg-base/60 p-3"
                  >
                    <span className="flex min-w-0 items-start justify-between gap-2">
                      <strong className="min-w-0 break-words text-xs">{candidate.title}</strong>
                      <small className="shrink-0 font-mono text-text-muted">×{candidate.quantity}</small>
                    </span>
                    <small className="mt-1 block text-[9px] text-text-muted">可操作 {candidate.removableQuantity}</small>
                    <div className="mt-2 grid gap-2">
                      <EquipmentPreview title="查看装备后的旧值、新值与差值" preview={candidate.preview} />
                      <InventoryActionButton
                        kind="equip"
                        action={candidate.equipAction}
                        busy={props.busy}
                        onExecute={execute}
                      />
                    </div>
                  </li>)}
                </ul>
              : <p className="mt-2 text-[10px] text-text-muted">背包中没有可替换的{slot.label}。</p>}
          </section>
        </article>)}
      </div>
    </div>}

    <footer className="flex flex-wrap items-center gap-2 rounded border border-border/70 bg-bg-surface px-3 py-2 text-[9px] text-text-muted">
      <Coins className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
      基础价值只用于规则参考，不是商店成交价；制作、购买和实际出售统一在交易功能中完成。
    </footer>
  </section>
}
