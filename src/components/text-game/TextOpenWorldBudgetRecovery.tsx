import { useState } from 'react'
import {
  authorizeTextOpenWorldCreatorBudgetRecoveryV1,
  previewTextOpenWorldCreatorBudgetRecoveryV1,
} from '../../lib/product-production/service'
import type { WorkspaceScope } from '../../lib/types'

export default function TextOpenWorldBudgetRecovery(props: {
  scope: WorkspaceScope; productionId: number; buildId: number; disabled: boolean
  onAuthorized: () => Promise<void>
}) {
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof previewTextOpenWorldCreatorBudgetRecoveryV1>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function preview() {
    setBusy(true); setError(''); setPrepared(null)
    try { setPrepared(await previewTextOpenWorldCreatorBudgetRecoveryV1(props)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  async function authorize() {
    if (!prepared) return
    setBusy(true); setError('')
    try {
      const receipt = await authorizeTextOpenWorldCreatorBudgetRecoveryV1({ prepared })
      if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode))
      setPrepared(null)
      await props.onAuthorized()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const remaining = prepared?.targetPlan.tasks.filter(task => !task.reuse) ?? []
  const maximumCalls = remaining.reduce((sum, task) => sum + task.budgetReservation.modelCalls, 0)
  const maximumCost = remaining.some(task => task.budgetReservation.maximumCostUsd === null)
    ? null : remaining.reduce((sum, task) => sum + (task.budgetReservation.maximumCostUsd ?? 0), 0)
  return <section className="mt-4 rounded border border-warning/40 p-4" aria-label="开放世界预算续建">
    <p className="text-sm">本次制作已达到冻结的预算上限。可以复验已完成内容，创建新一轮制作继续余下工作。</p>
    <p className="mt-2 text-xs text-text-muted">原制作记录、实际用量和未知请求预留全部保留。新一轮继续使用原作者 Brief 的预算上限，重新执行质量评审。</p>
    {!prepared && <button disabled={busy || props.disabled} onClick={() => void preview()} className="mt-3 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">复验成果并预览续建</button>}
    {prepared && <div className="mt-3 text-xs">
      <p>复用 {prepared.reuseTaskKeys.length} 项已验签任务，执行 {remaining.length} 项任务。</p>
      <p>本轮任务预留最多 {maximumCalls} 次模型调用；费用上界 {maximumCost === null ? '未标价' : `$${maximumCost.toFixed(2)}`}，这不是实际费用。</p>
      <button disabled={busy || props.disabled} onClick={() => void authorize()} className="mt-3 rounded bg-accent px-4 py-2 text-white disabled:opacity-40">确认续建并创建新 Build</button>
    </div>}
    {busy && <p className="mt-2 text-xs" role="status">正在核验完整制作证据…</p>}
    {error && <p className="mt-2 text-xs text-error" role="alert">{error}</p>}
  </section>
}
