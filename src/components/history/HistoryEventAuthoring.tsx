import { createContext, useContext, useState, type ReactNode } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { Project } from '../../lib/types'
import { allocateHistoryEventDraftIdsV1, assertSelectedHistoryEventsCompleteV1, parseHistoryEventCandidatesV1, type HistoryEventCandidatesV1, type HistoryEventDraftV1 } from '../../lib/history/event-creation-contract'
import { parseHistoryEventCreationSnapshotV1 } from '../../lib/history/event-creation-adoption'
import { useMasterCopilot } from '../agent/useMasterCopilot'
import CandidateSaveFeedback from '../agent/CandidateSaveFeedback'
import PromptRunPanel from '../shared/PromptRunPanel'
import { CInput, CTextarea } from '../shared/CompositionInput'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'

const Context = createContext<(() => void) | null>(null)
export function HistoryEventAIButtonV1() {
  const open = useContext(Context)
  return open ? <button type="button" onClick={open} className="inline-flex items-center gap-1 text-xs text-accent"><Sparkles className="h-3 w-3"/>AI 生成事件</button> : null
}
export default function HistoryEventAuthoringV1({ project, worldGroupId, hasEvents, onAdopted, children }: {
  project: Project; worldGroupId: number | null; hasEvents: boolean; onAdopted: () => Promise<unknown>; children: ReactNode
}) {
  const copilot = useMasterCopilot({ project, worldGroupId })
  const [open, setOpen] = useState(false), [hint, setHint] = useState(''), [count, setCount] = useState(6), [error, setError] = useState('')
  const [mode, setMode] = useState<'from-empty' | 'supplement'>(hasEvents ? 'supplement' : 'from-empty')
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({}), [systemOverride, setSystemOverride] = useState<string | null>(null), [userOverride, setUserOverride] = useState<string | null>(null)
  const effectiveMode = hasEvents ? 'supplement' : mode
  const candidate = copilot.pendingCandidates.find(item => item.payload.skillId === 'world-origin.history-events')
  let data: HistoryEventCandidatesV1 | null = null, parseError = '', ready = false
  if (candidate) {
    try {
      const snapshot = parseHistoryEventCreationSnapshotV1(candidate.payload.baseSnapshot)
      data = parseHistoryEventCandidatesV1(candidate.event.content, snapshot.request)
      try { assertSelectedHistoryEventsCompleteV1(data); ready = true } catch { /* Author can keep incomplete or unselected drafts. */ }
    } catch (cause) { parseError = cause instanceof Error ? cause.message : String(cause) }
  }
  const guarded = async (action: () => void | Promise<unknown>) => {
    setError('')
    try { await flushPendingEditsV1(); await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const update = (change: (current: HistoryEventCandidatesV1) => HistoryEventCandidatesV1) => {
    if (!candidate) return
    try {
      const snapshot = parseHistoryEventCreationSnapshotV1(candidate.payload.baseSnapshot)
      const current = parseHistoryEventCandidatesV1(copilot.readVisibleCandidateDraft(candidate.event.id!)?.rawValue ?? candidate.event.content, snapshot.request)
      void copilot.updateCandidate(candidate.event.id!, JSON.stringify(change(current))).catch(cause => setError(String(cause)))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const edit = (draftId: string, patch: Partial<HistoryEventDraftV1>) => update(current => ({ ...current, events: current.events.map(row => row.draftId === draftId ? { ...row, ...patch } : row) }))
  const run = () => copilot.submitTargetedRequest('为当前历史起草新事件，先保留候选，等待作者选择。', {
    id: `history-events-${crypto.randomUUID()}`, agentId: 'world-origin', skillId: 'world-origin.history-events',
    instruction: `${hasEvents ? '补充已有时间轴，不改已有事件。' : '从零构思时间轴或补充新事件。'}${hint || '保持已确认的世界和历史边界；新增设想标为待确认。'}`,
    historyEventRequest: { mode: effectiveMode, draftIds: allocateHistoryEventDraftIdsV1(count) },
    promptExecution: { version: 1, moduleKey: 'history.timeline', parameterValues,
      ...(systemOverride === null ? {} : { systemOverride }), ...(userOverride === null ? {} : { userOverride }) },
  })
  const otherPending = copilot.pendingCandidates.some(item => item !== candidate)
  return <Context.Provider value={() => { void guarded(() => setOpen(true)) }}>
    {candidate && <div role="status" className="mb-3 flex flex-wrap items-center gap-2 text-xs">时间轴有待确认候选。<button className="text-accent underline" onClick={() => { void guarded(() => setOpen(true)) }}>继续编辑：历史事件候选</button></div>}
    {error && !open && <p role="alert" className="text-xs text-error">{error}</p>}
    {children}
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3"><section role="dialog" aria-modal="true" aria-label="历史事件候选" className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-bg-surface p-4">
      <div className="mb-3 flex items-center justify-between"><h2>历史事件候选</h2><button aria-label="关闭事件候选" onClick={() => { void guarded(() => setOpen(false)) }}><X className="h-4 w-4"/></button></div>
      <p className="mb-3 text-xs text-text-muted">先选择并编辑事件，再加入时间轴。已有事件保持原样；具体日期文字保留，不自动推断数字年份，候选也不自动标为已核实史实。</p>
      {(error || copilot.error || parseError) && <p role="alert" className="mb-3 text-xs text-error">{error || copilot.error || parseError}</p>}
      {!candidate ? <div className="space-y-3">
        <div className="flex flex-wrap gap-3"><label className="text-xs">生成方式 <select aria-label="事件生成方式" value={effectiveMode} onChange={event => setMode(event.target.value as typeof mode)} className="rounded border border-border bg-bg-base p-1"><option value="from-empty" disabled={hasEvents}>从零构思</option><option value="supplement">补充事件</option></select></label>
          <label className="text-xs">本批最多事件数 <input aria-label="本批最多事件数" type="number" min={1} max={1000} step={1} value={count} onChange={event => setCount(Number(event.target.value))} className="w-20 rounded border border-border bg-bg-base p-1"/></label></div>
        <label className="block text-xs">补充要求（可选）<CTextarea value={hint} onChange={event => setHint(event.target.value)} rows={3} className="mt-1 w-full"/></label>
        <PromptRunPanel moduleKey="history.timeline" parameterValues={parameterValues} onParamChange={setParameterValues} systemOverride={systemOverride} onSystemOverrideChange={setSystemOverride} userOverride={userOverride} onUserOverrideChange={setUserOverride}/>
        {otherPending && <p className="text-xs text-text-muted">还有其他待确认候选，请先处理后再生成。</p>}
        <div className="flex justify-end gap-3">{copilot.busy && <button onClick={copilot.stop} className="text-xs">停止生成</button>}{copilot.recoveryAvailable && <button disabled={copilot.busy} onClick={() => { void guarded(copilot.resume) }} className="text-xs text-accent">恢复原生成</button>}
          <button disabled={copilot.busy || copilot.loading || otherPending} onClick={() => { void guarded(run) }} className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">{copilot.busy ? '生成中…' : '生成事件候选'}</button></div>
      </div> : <>
        <CandidateSaveFeedback event={candidate.event} scope={copilot.candidateLocalSaveScope} draftState={copilot.readCandidateLocalDraftState?.(candidate.event.id!)} busy={copilot.busy} onRetry={() => copilot.flushCandidateDraft(candidate.event.id!)}>
          {data ? <div className="space-y-3">{data.events.map((row, index) => <fieldset key={row.draftId} disabled={copilot.busy} className="rounded border border-border p-3">
            <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`加入事件：${row.title || '未命名'}`} checked={!!data!.selectedIds?.includes(row.draftId)} onChange={event => { const checked = event.target.checked; update(current => ({ ...current, selectedIds: checked ? [...current.selectedIds ?? [], row.draftId] : (current.selectedIds ?? []).filter(id => id !== row.draftId) })) }}/>{row.title || '未命名事件'}</label>
            <div className="grid gap-2 md:grid-cols-3"><label className="text-xs">事件名称<CInput aria-label={`第${index + 1}个事件的名称`} value={row.title} onChange={event => edit(row.draftId, { title: event.target.value })} className="mt-1 w-full"/></label><label className="text-xs">时期<CInput aria-label={`第${index + 1}个事件的时期`} value={row.era} onChange={event => edit(row.draftId, { era: event.target.value })} className="mt-1 w-full"/></label><label className="text-xs">具体时间<CInput aria-label={`第${index + 1}个事件的时间`} value={row.date} onChange={event => edit(row.draftId, { date: event.target.value })} className="mt-1 w-full"/></label></div>
            <label className="mt-2 block text-xs">发生过程与前因<CTextarea aria-label={`第${index + 1}个事件的过程`} value={row.description} onChange={event => edit(row.draftId, { description: event.target.value })} rows={4} className="mt-1 w-full"/></label>
            <label className="mt-2 block text-xs">影响与后果<CTextarea aria-label={`第${index + 1}个事件的影响`} value={row.impact} onChange={event => edit(row.draftId, { impact: event.target.value })} rows={2} className="mt-1 w-full"/></label>
          </fieldset>)}</div> : <CTextarea aria-label="事件候选原始内容" value={candidate.event.content} onChange={event => { void copilot.updateCandidate(candidate.event.id!, event.target.value).catch(cause => setError(String(cause))) }} rows={10} className="w-full"/>}
        </CandidateSaveFeedback>
        <div className="mt-4 flex justify-end gap-3"><button disabled={copilot.busy} onClick={() => { void guarded(() => copilot.rejectCandidate(candidate)) }} className="text-xs">拒绝整批候选</button><button disabled={copilot.busy || !ready} onClick={() => { void guarded(async () => { if (await copilot.adoptCandidate(candidate)) { await onAdopted(); setOpen(false) } }) }} className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">加入所选事件（{data?.selectedIds?.length ?? 0}）</button></div>
      </>}
    </section></div>}
  </Context.Provider>
}
