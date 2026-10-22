import { useEffect, useRef, useState } from 'react'
import type { captureProductProductionOriginalResponseV1 } from '../../lib/product-production/local-request'
import type { bookTtrpgOpenOriginalResponseV1, TtrpgOpenOriginalResponseOwnerV1, TtrpgOpenOriginalResponseRefV1,
  TtrpgOpenOriginalBookingSummaryV1 } from '../../lib/ttrpg/open-original-response-review-service'

type Captured = Awaited<ReturnType<typeof captureProductProductionOriginalResponseV1>>
export default function TtrpgOpenOriginalResponseHandoff(props: {
  owner: TtrpgOpenOriginalResponseOwnerV1; expectedStateRevision: number; value: string; disabled: boolean
  booking: TtrpgOpenOriginalBookingSummaryV1 | null
  onBusy: (value: boolean) => void
  onBooked: (result: Awaited<ReturnType<typeof bookTtrpgOpenOriginalResponseV1>>) => void
  onDraft: (text: string, source: TtrpgOpenOriginalResponseRefV1) => void
}) {
  const [captured, setCaptured] = useState<Captured | null>(null), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [upperBound, setUpperBound] = useState(false)
  const current = useRef(props), active = useRef(true), serial = useRef(0), inFlight = useRef(false)
  current.current = props
  useEffect(() => { const token = serial; active.current = true; return () => { active.current = false; token.current++ } }, [])
  const valid = (before: typeof props, token: number) => active.current && token === serial.current
    && JSON.stringify(current.current.owner) === JSON.stringify(before.owner)
  const perform = async (action: (before: typeof props, token: number) => Promise<void>) => {
    if (inFlight.current || props.disabled) return
    inFlight.current = true
    const before = current.current, token = ++serial.current
    setBusy(true); setError(''); before.onBusy(true)
    try { await action(before, token) }
    catch (e) { if (valid(before, token)) setError(e instanceof Error ? e.message : String(e)) }
    finally { inFlight.current = false; before.onBusy(false); if (valid(before, token)) setBusy(false) }
  }
  const retain = () => perform(async (before, token) => {
    const { captureProductProductionOriginalResponseV1 } = await import('../../lib/product-production/local-request')
    const result = await captureProductProductionOriginalResponseV1({ ...before.owner, confirmation: 'retain-original-complete-response-without-inference-v1' })
    if (valid(before, token)) setCaptured(result)
  })
  const nativeUsageKnown = !!captured?.usage && Number.isSafeInteger(captured.usage.inputTokens)
    && Number.isSafeInteger(captured.usage.outputTokens) && captured.usage.inputTokens > 0 && captured.usage.outputTokens > 0
  const book = () => perform(async (before, token) => {
    if (!captured) throw new Error('请先保留完整原回答。')
    const { bookTtrpgOpenOriginalResponseV1 } = await import('../../lib/ttrpg/open-original-response-review-service')
    const result = await bookTtrpgOpenOriginalResponseV1({ owner: before.owner, expectedStateRevision: before.expectedStateRevision,
      source: { captureRunId: captured.runId, captureReceiptHash: captured.receiptHash },
      disposition: nativeUsageKnown ? 'use-native-token-usage' : upperBound ? 'charge-reservation-upper-bound'
        : (() => { throw new Error('没有可核对的用量；请明确选择原预留上限。') })() })
    if (valid(before, token)) before.onBooked(result)
  })
  const load = () => perform(async (before, token) => {
    if (!captured) throw new Error('请先读取已保留的完整回答。')
    const { readTtrpgOpenOriginalResponseDraftV1 } = await import('../../lib/ttrpg/open-original-response-review-service')
    const result = await readTtrpgOpenOriginalResponseDraftV1({ owner: before.owner, existingDraft: before.value,
      source: { captureRunId: captured.runId, captureReceiptHash: captured.receiptHash } })
    if (!valid(before, token)) return
    if (current.current.value !== before.value) throw new Error('读取期间你修改了修订稿，已保留你的修改；请重新关联。')
    before.onDraft(result.authorDraftJson, result.originalResponseSource)
  })
  const booked = captured && props.booking?.captureRunId === captured.runId && props.booking.captureReceiptHash === captured.receiptHash
  return <section className="mt-3 rounded border border-accent/40 bg-accent/5 p-4 text-xs" data-testid="ttrpg-original-response-handoff">
    <h3 className="font-semibold">使用完整原回答修订</h3>
    <p className="my-2 leading-5 text-text-muted">按顺序保留原回答、核对旧用量，再载入修订稿。这些操作不会重新生成；确认内容后仍需点击“修正后继续制作”。</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={props.disabled || busy} onClick={() => { void retain() }} className="rounded border border-border px-3 py-2">{captured ? '重新读取已保留回答' : '读取并保留完整原回答'}</button>
      {captured && !booked && <button type="button" disabled={props.disabled || busy || (!nativeUsageKnown && !upperBound)} onClick={() => { void book() }} className="rounded border border-accent/40 px-3 py-2">核对并记入原用量</button>}
      {captured && booked && !props.booking?.blocked && <button type="button" disabled={props.disabled || busy} onClick={() => { void load() }} className="rounded border border-accent/40 px-3 py-2">{props.value.trim() ? '关联原回答并保留我的修订' : '将原回答载入修订稿'}</button>}
    </div>
    {captured && !nativeUsageKnown && !booked && <label className="mt-3 block"><input type="checkbox" checked={upperBound} disabled={busy || props.disabled} onChange={event => setUpperBound(event.target.checked)} /> 我已核对，按原冻结预留上限暂记用量</label>}
    {booked && <p role="status" className="mt-3">{props.booking?.blocked ? '原用量已保存，但旧授权不足，当前不能继续；请明确修订方案。' : '原用量已核对，尚未提交内容修订。'}</p>}
    {captured && <details className="mt-3"><summary className="cursor-pointer">完整原回答及原用量</summary><p className="mt-2">原用量：{JSON.stringify(captured.usage) ?? '未报告'}。费用未报告时不记为免费。</p><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words">{captured.text}</pre></details>}
    {error && <p role="alert" className="mt-3 text-error">{error}</p>}
  </section>
}
