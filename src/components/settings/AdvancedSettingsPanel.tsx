/**
 * 高级设置子面板（H2 暴露 → H5 调整入口）
 *
 * 行为：
 * - 顶部「高级模式」开关（默认关闭）。OFF 时仅显示开关本身 + 说明文。
 * - ON 后展示 5 个分组的 budget / 截断阈值表格。每行右侧是一个数字输入框，
 *   作者填进去会立即覆盖运行时默认值；留空 / 点「恢复」则回退到 budget-config.ts 的默认值。
 * - 整体「全部恢复默认」按钮在头部。
 *
 * 注意：H3 字段提示与超限警告不读高级模式开关，始终生效。本面板仅控制内部 budget。
 */
import { useEffect, useMemo, useState } from 'react'
import { Lock, Unlock, Layers, Info, AlertTriangle, RotateCcw, Save, Check } from 'lucide-react'
import { useAdvancedMode } from '../../hooks/useAdvancedMode'
import { BUDGET_GROUPS, flattenBudgetEntry, type BudgetEntry, type BudgetLeaf } from '../../lib/registry/budget-config'
import {
  getEffectiveLimitsSnapshot,
  setEffectiveLimit,
  resetAllEffectiveLimits,
  onEffectiveLimitsChange,
} from '../../lib/registry/effective-limits'
import { useDialog } from '../shared/Dialog'

export default function AdvancedSettingsPanel() {
  const [enabled, setEnabled] = useAdvancedMode()
  const [snapshot, setSnapshot] = useState<Record<string, number>>(() => getEffectiveLimitsSnapshot())
  const dialog = useDialog()

  // 订阅 effective-limits 变化（写入 / 跨标签页 / 全部恢复）
  useEffect(() => {
    return onEffectiveLimitsChange(() => setSnapshot(getEffectiveLimitsSnapshot()))
  }, [])

  // 把所有 entry 拍平成 leaf，方便整体「全部恢复」时知道有哪些被改过
  const allLeafs = useMemo(() => {
    const out: BudgetLeaf[] = []
    for (const g of BUDGET_GROUPS) for (const e of g.entries) out.push(...flattenBudgetEntry(e))
    return out
  }, [])
  const overriddenCount = allLeafs.filter(l => snapshot[l.flatKey] !== undefined).length

  return (
    <div className="max-w-3xl mt-6 p-4 bg-bg-surface border border-border rounded-xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
            {enabled
              ? <Unlock className="w-4 h-4 text-amber-500" />
              : <Lock className="w-4 h-4 text-text-muted" />}
            高级设置
            {enabled && overriddenCount > 0 && (
              <span className="text-[10px] text-amber-400 font-normal">
                · 已覆盖 {overriddenCount} 项默认值
              </span>
            )}
          </h3>
          <p className="text-xs text-text-muted mt-1 leading-relaxed">
            打开后会暴露上下文装配的 budget、各上下文源的 token 上限、Reader 与字段格式化层的硬截断阈值，
            并解锁后续步骤里的「查看注入 prompt」「调整截断长度」等高级入口。
            <span className="text-amber-500"> 这些内部参数普通使用不需要关心；改动会直接影响 AI 调用的 token 消耗。</span>
          </p>
          <p className="text-xs text-text-muted mt-1">
            提示：业务面板上的字段「文本提示」与「超限警告」始终对所有用户可见，<span className="text-text-secondary">不受此开关影响</span>。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled(!enabled)}
          aria-pressed={enabled}
          className={`relative inline-flex shrink-0 h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? 'bg-amber-500' : 'bg-bg-elevated border border-border'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* 高级模式开关 OFF：到此为止，避免信息过载 */}
      {!enabled && (
        <div className="mt-4 p-3 bg-bg-base border border-border/60 rounded-lg flex items-start gap-2 text-xs text-text-muted">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>开关处于关闭状态。打开后才会显示 budget 表格与后续高级控件。</span>
        </div>
      )}

      {/* 高级模式 ON：暴露所有 budget / 截断阈值（可调） */}
      {enabled && (
        <div className="mt-5 space-y-5">
          <div className="p-3 bg-amber-500/5 border border-amber-500/30 rounded-lg flex items-start gap-2 text-xs text-amber-200/90">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
            <div className="flex-1 leading-relaxed">
              <p className="text-amber-400 font-medium">下方为内部预算与硬截断阈值（可调整）</p>
              <p className="mt-1">
                数值默认取自源代码事实清单 <code className="px-1 py-0.5 bg-bg-base rounded">src/lib/registry/budget-config.ts</code>。
                在右侧输入新值会立即覆盖运行时；点「↺」单项恢复，或下方「全部恢复默认」一次清空。
              </p>
            </div>
            {overriddenCount > 0 && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await dialog.confirm({
                    title: '恢复全部默认值？',
                    message: `确定恢复全部 ${overriddenCount} 项 budget 到默认值？`,
                    confirmText: '全部恢复',
                    tone: 'danger',
                  })
                  if (ok) resetAllEffectiveLimits()
                }}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-bg-base border border-amber-500/40 text-amber-400 rounded hover:bg-amber-500/10 transition-colors"
              >
                <RotateCcw className="w-3 h-3" /> 全部恢复默认
              </button>
            )}
          </div>

          {BUDGET_GROUPS.map(group => (
            <section key={group.id} className="space-y-2">
              <header>
                <h4 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-500" />
                  {group.label}
                  <span className="text-[10px] text-text-muted font-normal">
                    （{group.entries.length} 项）
                  </span>
                </h4>
                <p className="text-[11px] text-text-muted mt-0.5">{group.description}</p>
              </header>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full text-xs">
                  <thead className="bg-bg-elevated">
                    <tr className="text-left text-[10px] text-text-muted uppercase">
                      <th className="px-3 py-1.5 font-normal">字段</th>
                      <th className="px-3 py-1.5 font-normal">默认值</th>
                      <th className="px-3 py-1.5 font-normal">单位</th>
                      <th className="px-3 py-1.5 font-normal w-44">当前生效</th>
                      <th className="px-3 py-1.5 font-normal">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.entries.flatMap(e => flattenBudgetEntry(e)).map(leaf => (
                      <BudgetRow key={leaf.flatKey} leaf={leaf} snapshot={snapshot} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function BudgetRow({ leaf, snapshot }: { leaf: BudgetLeaf; snapshot: Record<string, number> }) {
  const overridden = snapshot[leaf.flatKey] !== undefined
  const effective = overridden ? snapshot[leaf.flatKey] : leaf.defaultValue
  const [draft, setDraft] = useState<string>(String(effective))
  const [savedFlash, setSavedFlash] = useState(false)

  // 外部变化（如 全部恢复）时同步本地 input 值
  useEffect(() => { setDraft(String(effective)) }, [effective])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      setEffectiveLimit(leaf.flatKey, null) // 视为恢复默认
      return
    }
    const num = Number(trimmed)
    if (!Number.isFinite(num) || num <= 0) {
      // 输入非法：还原为当前生效值
      setDraft(String(effective))
      return
    }
    if (Math.round(num) === leaf.defaultValue) {
      setEffectiveLimit(leaf.flatKey, null) // 显式回到默认值时清掉 override
      return
    }
    setEffectiveLimit(leaf.flatKey, Math.round(num))
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1200)
  }

  const reset = () => setEffectiveLimit(leaf.flatKey, null)

  const parent: BudgetEntry = leaf.parent

  return (
    <tr className="border-t border-border/60">
      <td className="px-3 py-2 text-text-primary">{leaf.label}</td>
      <td className="px-3 py-2 font-mono text-text-muted whitespace-nowrap">{leaf.defaultValue.toLocaleString()}</td>
      <td className="px-3 py-2 text-text-muted">{parent.unit}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            min={1}
            className={`w-24 px-2 py-1 bg-bg-base border rounded text-xs font-mono focus:outline-none focus:border-amber-500 ${
              overridden ? 'border-amber-500/60 text-amber-400' : 'border-border text-text-primary'
            }`}
          />
          {overridden ? (
            <button
              type="button"
              onClick={reset}
              title="恢复此项默认值"
              className="p-1 text-text-muted hover:text-amber-400 hover:bg-bg-hover rounded transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          ) : (
            <span className="w-5 inline-block" />
          )}
          {savedFlash && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-green-400">
              <Check className="w-3 h-3" /> 已保存
            </span>
          )}
          {!savedFlash && overridden && !draft.startsWith('—') && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-400">
              <Save className="w-3 h-3" /> 覆盖中
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-text-secondary leading-relaxed">{parent.note}</td>
    </tr>
  )
}
