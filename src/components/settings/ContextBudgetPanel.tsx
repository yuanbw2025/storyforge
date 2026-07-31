import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, SlidersHorizontal, Search, Info } from 'lucide-react'
import { CONTEXT_SOURCES } from '../../lib/registry/context-sources'
import { useContextBudgetStore } from '../../stores/context-budget'
import type { ContextSource } from '../../lib/registry/types'

const LAYER_ORDER: ('L0' | 'L1' | 'L2' | 'L3')[] = ['L1', 'L2', 'L3', 'L0']

const LAYER_META: Record<string, { label: string; hint: string }> = {
  L0: { label: 'L0 · 基础指令', hint: 'system 级，始终注入、不被整段裁剪' },
  L1: { label: 'L1 · 核心上下文', hint: '受保护层，预算不足时才整段丢弃' },
  L2: { label: 'L2 · 扩展上下文', hint: '预算紧张时在 L3 之后被裁剪' },
  L3: { label: 'L3 · 增强上下文', hint: '预算紧张时最先被裁剪' },
}

const SCOPE_LABEL: Record<string, string> = {
  project: '项目',
  world: '世界',
  node: '节点',
  chapter: '章节',
  manual: '手动',
}

const SCOPE_COLOR: Record<string, string> = {
  project: 'bg-blue-500/10 text-blue-600',
  world: 'bg-purple-500/10 text-purple-600',
  node: 'bg-amber-500/10 text-amber-600',
  chapter: 'bg-emerald-500/10 text-emerald-600',
  manual: 'bg-gray-500/10 text-gray-500',
}

type ParseResult =
  | { kind: 'empty' }
  | { kind: 'valid'; value: number }
  | { kind: 'invalid'; message: string }

/** 解析预算输入：支持纯数字或 k/千 后缀（如 2000、2k、4.5k）。空 = 恢复默认。 */
function parseBudgetInput(raw: string): ParseResult {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: 'empty' }
  const m = /^(\d+(?:\.\d+)?)\s*(k|千)?$/i.exec(trimmed)
  if (!m) return { kind: 'invalid', message: '请输入正整数，如 2000 或 2k' }
  const base = parseFloat(m[1])
  const value = Math.round(base * (m[2] ? 1000 : 1))
  if (!(Number.isFinite(value) && value > 0)) return { kind: 'invalid', message: '预算必须大于 0' }
  return { kind: 'valid', value }
}

function BudgetRow({ source }: { source: ContextSource }) {
  const override = useContextBudgetStore(s => s.overrides[source.key])
  const setOverride = useContextBudgetStore(s => s.setOverride)
  const [draft, setDraft] = useState(override ? String(override) : '')
  const [error, setError] = useState('')

  // 外部变化（如「全部重置」）同步到草稿
  useEffect(() => {
    setDraft(override ? String(override) : '')
    setError('')
  }, [override])

  const handleChange = (raw: string) => {
    setDraft(raw)
    const parsed = parseBudgetInput(raw)
    if (parsed.kind === 'invalid') {
      setError(parsed.message)
      return
    }
    setError('')
    setOverride(source.key, parsed.kind === 'valid' ? parsed.value : null)
  }

  const hasOverride = override != null
  const scopeLabel = SCOPE_LABEL[source.scope] ?? source.scope
  const scopeColor = SCOPE_COLOR[source.scope] ?? SCOPE_COLOR.manual

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/60 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-primary truncate">{source.label}</span>
          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${scopeColor}`}>{scopeLabel}</span>
          {hasOverride && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">已覆盖</span>
          )}
        </div>
        <div className="text-[11px] text-text-muted mt-0.5 truncate">
          key: {source.key} · 默认 {source.budgetTokens.toLocaleString()} token
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={e => handleChange(e.target.value)}
          aria-invalid={Boolean(error)}
          placeholder={String(source.budgetTokens)}
          title={`设置「${source.label}」的预算上限（token），留空恢复默认 ${source.budgetTokens.toLocaleString()}`}
          className={`w-24 px-2 py-1.5 bg-bg-base border rounded text-sm text-text-primary text-right focus:outline-none transition-colors ${
            error
              ? 'border-red-400 focus:border-red-400'
              : hasOverride
                ? 'border-accent/60 focus:border-accent'
                : 'border-border focus:border-accent'
          }`}
        />
        <button
          type="button"
          onClick={() => handleChange('')}
          disabled={!draft && !hasOverride}
          title="恢复默认预算"
          aria-label={`重置「${source.label}」预算为默认`}
          className="p-1.5 rounded border border-border text-text-muted hover:text-accent hover:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

export default function ContextBudgetPanel() {
  const overrides = useContextBudgetStore(s => s.overrides)
  const totalBudget = useContextBudgetStore(s => s.totalBudget)
  const setTotalBudget = useContextBudgetStore(s => s.setTotalBudget)
  const resetAll = useContextBudgetStore(s => s.resetAll)
  const [query, setQuery] = useState('')
  const [totalBudgetDraft, setTotalBudgetDraft] = useState(totalBudget ? String(totalBudget) : '')
  const [totalBudgetError, setTotalBudgetError] = useState('')

  // 外部变化（如「全部重置」）同步到草稿
  useEffect(() => {
    setTotalBudgetDraft(totalBudget ? String(totalBudget) : '')
    setTotalBudgetError('')
  }, [totalBudget])

  const handleTotalBudgetChange = (raw: string) => {
    setTotalBudgetDraft(raw)
    const parsed = parseBudgetInput(raw)
    if (parsed.kind === 'invalid') {
      setTotalBudgetError(parsed.message)
      return
    }
    setTotalBudgetError('')
    setTotalBudget(parsed.kind === 'valid' ? parsed.value : null)
  }

  const groups = useMemo(() => {
    const q = query.trim()
    const filtered = CONTEXT_SOURCES.filter(src =>
      !q || src.label.includes(q) || src.key.toLowerCase().includes(q.toLowerCase()),
    )
    return LAYER_ORDER
      .map(layer => ({ layer, sources: filtered.filter(src => src.layer === layer) }))
      .filter(g => g.sources.length > 0)
  }, [query])

  const totals = useMemo(() => {
    const defaults = CONTEXT_SOURCES.reduce((sum, s) => sum + s.budgetTokens, 0)
    const current = CONTEXT_SOURCES.reduce((sum, s) => sum + (overrides[s.key] ?? s.budgetTokens), 0)
    return { defaults, current }
  }, [overrides])

  const overrideCount = Object.keys(overrides).length

  return (
    <div className="max-w-3xl mt-6 p-5 bg-bg-surface border border-border rounded-xl">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <SlidersHorizontal className="w-4 h-4 text-accent" />
            提示词预算
          </h3>
          <p className="text-xs text-text-muted mt-1">
            调整各上下文源注入提示词时的预算上限（token）。修改即时生效，下次生成请求即应用；留空恢复默认值。
          </p>
        </div>
        <button
          type="button"
          onClick={() => { if (window.confirm('确认将所有提示词预算（含总窗口预算）恢复为默认值？')) resetAll() }}
          disabled={overrideCount === 0 && totalBudget == null}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm bg-bg-elevated text-text-secondary rounded-lg hover:bg-bg-hover disabled:opacity-40 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          全部重置
        </button>
      </div>

      {/* 总窗口预算 */}
      <div className="mt-4 p-3 bg-bg-base border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-1.5">
          <h4 className="text-sm font-medium text-text-primary">总窗口预算（输入预算上限）</h4>
          {totalBudget != null && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">已覆盖</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={totalBudgetDraft}
            onChange={e => handleTotalBudgetChange(e.target.value)}
            aria-invalid={Boolean(totalBudgetError)}
            placeholder="按模型预设计算"
            title="设置一次请求允许注入的输入预算上限（token），留空恢复按模型预设计算"
            className={`min-w-0 flex-1 px-3 py-2 bg-bg-base border rounded text-sm text-text-primary focus:outline-none transition-colors ${
              totalBudgetError
                ? 'border-red-400 focus:border-red-400'
                : totalBudget != null
                  ? 'border-accent/60 focus:border-accent'
                  : 'border-border focus:border-accent'
            }`}
          />
          <button
            type="button"
            onClick={() => handleTotalBudgetChange('')}
            disabled={!totalBudgetDraft && totalBudget == null}
            title="恢复按模型预设计算"
            aria-label="重置总窗口预算为模型预设"
            className="shrink-0 p-2 rounded border border-border text-text-muted hover:text-accent hover:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
        {totalBudgetError ? (
          <p className="mt-1 text-[11px] text-red-400">{totalBudgetError}；已保存值未改变。</p>
        ) : (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-green-400/80">
            <Info className="w-3 h-3" />
            {totalBudget != null ? `已保存：${totalBudget.toLocaleString()} token` : '按模型预设自动计算'}
          </p>
        )}
        <p className="text-[11px] text-text-muted mt-1">
          总窗口不足时按 L3→L2→L1 分层裁剪；建议不低于下方「源预算总和」，否则单源预算会被总窗口压缩。
        </p>
      </div>

      {/* 总预算概览 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted bg-bg-base border border-border rounded-lg px-3 py-2">
        <span>默认总预算：<span className="text-text-secondary">{totals.defaults.toLocaleString()}</span> token</span>
        <span>当前总预算：<span className={totals.current !== totals.defaults ? 'text-accent' : 'text-text-secondary'}>
          {totals.current.toLocaleString()}</span> token</span>
        <span>已覆盖源：<span className={overrideCount > 0 ? 'text-accent' : 'text-text-secondary'}>{overrideCount}</span> / {CONTEXT_SOURCES.length}</span>
        <span className="flex items-center gap-1 text-text-muted/80">
          <Info className="w-3 h-3" />
          单源预算受模型总窗口预算约束，窗口不足时仍会按 L3→L2→L1 分层裁剪
        </span>
      </div>

      {/* 搜索 */}
      <div className="relative mt-4">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索上下文源（名称或 key）…"
          className="w-full pl-8 pr-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
        />
      </div>

      {/* 分层分组 */}
      <div className="mt-4 space-y-4">
        {groups.map(({ layer, sources }) => (
          <div key={layer}>
            <div className="flex items-baseline gap-2 mb-1">
              <h4 className="text-xs font-semibold text-text-secondary">{LAYER_META[layer]?.label ?? layer}</h4>
              <span className="text-[10px] text-text-muted">{LAYER_META[layer]?.hint}</span>
            </div>
            <div className="px-3 bg-bg-base/60 border border-border rounded-lg">
              {sources.map(source => <BudgetRow key={source.key} source={source} />)}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <p className="text-sm text-text-muted py-4 text-center">没有匹配的上下文源</p>
        )}
      </div>
    </div>
  )
}
