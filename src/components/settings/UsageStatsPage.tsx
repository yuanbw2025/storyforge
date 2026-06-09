/**
 * AI 消耗统计页 — 设置区
 *
 * 展示每次 AI 调用：时间 / 消耗类型(标签) / 输入 / 输出 / 花费(美元上·人民币下)。
 * 顶部汇总：总输入/输出/总花费；可调美元→人民币汇率；可清空。
 */
import { useEffect, useMemo, useState } from 'react'
import { Trash2, RefreshCw, Coins } from 'lucide-react'
import { useAIUsageStore } from '../../stores/ai-usage'
import { categoryMeta, getUsdCnyRate, setUsdCnyRate } from '../../lib/ai/usage-log'
import type { Project } from '../../lib/types'

interface Props {
  project?: Project
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function fmtUsd(n: number): string {
  return '$' + n.toFixed(n < 0.01 ? 6 : 4)
}
function fmtCny(n: number): string {
  return '¥' + n.toFixed(n < 0.01 ? 4 : 2)
}

export default function UsageStatsPage({ project }: Props) {
  const { entries, loading, loadAll, clearAll } = useAIUsageStore()
  const [rate, setRate] = useState(getUsdCnyRate())
  const [scopeProject, setScopeProject] = useState(true)  // 仅当前项目 / 全部

  useEffect(() => {
    loadAll(scopeProject ? (project?.id ?? null) : null)
  }, [loadAll, scopeProject, project?.id])

  const totals = useMemo(() => {
    return entries.reduce(
      (acc, e) => {
        acc.input += e.inputTokens
        acc.output += e.outputTokens
        acc.usd += e.costUsd
        acc.count += 1
        return acc
      },
      { input: 0, output: 0, usd: 0, count: 0 },
    )
  }, [entries])

  const handleRateChange = (v: string) => {
    const n = Number(v)
    if (n > 0) { setRate(n); setUsdCnyRate(n) }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Coins className="w-5 h-5 text-accent" />
        <h2 className="text-xl font-bold text-text-primary">消耗统计</h2>
        <span className="text-xs text-text-muted">（{totals.count} 次调用）</span>
        <div className="ml-auto flex items-center gap-3">
          <label className="text-xs text-text-muted flex items-center gap-1">
            汇率 1$ =
            <input
              type="number" value={rate} step="0.1" min="0.1"
              onChange={e => handleRateChange(e.target.value)}
              className="w-16 px-1.5 py-1 rounded bg-bg-elevated border border-border text-text-primary text-xs"
            />
            ¥
          </label>
          <label className="text-xs text-text-muted flex items-center gap-1">
            <input type="checkbox" checked={scopeProject} onChange={e => setScopeProject(e.target.checked)} />
            仅当前项目
          </label>
          <button
            onClick={() => loadAll(scopeProject ? (project?.id ?? null) : null)}
            className="text-xs text-text-muted hover:text-text-primary inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 刷新
          </button>
          <button
            onClick={() => { if (confirm('确定清空消耗记录？此操作不可撤销。')) clearAll(scopeProject ? (project?.id ?? null) : null) }}
            className="text-xs text-red-400 hover:text-red-300 inline-flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" /> 清空
          </button>
        </div>
      </div>

      {/* 汇总卡 */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="总输入 Token" value={totals.input.toLocaleString()} />
        <SummaryCard label="总输出 Token" value={totals.output.toLocaleString()} />
        <SummaryCard
          label="总花费"
          value={fmtUsd(totals.usd)}
          sub={fmtCny(totals.usd * rate)}
        />
      </div>

      {/* 明细表 */}
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated text-text-muted text-xs">
              <th className="text-left font-medium px-3 py-2">时间</th>
              <th className="text-left font-medium px-3 py-2">消耗类型</th>
              <th className="text-left font-medium px-3 py-2">模型</th>
              <th className="text-right font-medium px-3 py-2">输入</th>
              <th className="text-right font-medium px-3 py-2">输出</th>
              <th className="text-right font-medium px-3 py-2">花费</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="text-center text-text-muted py-6">加载中…</td></tr>
            )}
            {!loading && entries.length === 0 && (
              <tr><td colSpan={6} className="text-center text-text-muted py-8">暂无消耗记录。使用任意 AI 生成功能后，这里会自动记录。</td></tr>
            )}
            {entries.map(e => {
              const meta = categoryMeta(e.category)
              return (
                <tr key={e.id} className="border-t border-border/50 hover:bg-bg-hover/50">
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtTime(e.timestamp)}</td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                      style={{ backgroundColor: meta.color + '22', color: meta.color }}
                    >
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-muted text-xs whitespace-nowrap max-w-[180px] truncate" title={e.model}>{e.model}</td>
                  <td className="px-3 py-2 text-right text-text-secondary tabular-nums">{e.inputTokens.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-text-secondary tabular-nums">{e.outputTokens.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    <div className="text-text-primary">{fmtUsd(e.costUsd)}</div>
                    <div className="text-text-muted text-xs">{fmtCny(e.costUsd * rate)}</div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-muted leading-relaxed">
        说明：费用按模型估算单价 × token 计算（不同中转站实际价格不同，仅供参考）；可上方调整美元→人民币汇率。
        消耗类型来自各 AI 行为标识，未标注的归「其他」（将随统一执行层逐步补全）。
      </p>
    </div>
  )
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-4">
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div className="text-lg font-semibold text-text-primary tabular-nums">{value}</div>
      {sub && <div className="text-sm text-text-muted tabular-nums">{sub}</div>}
    </div>
  )
}
