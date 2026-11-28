import HistoryCandidateDialog from './HistoryCandidateDialog'
import PromptRunPanel from '../shared/PromptRunPanel'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { Project } from '../../lib/types'
import { HISTORY_TEXT_LABELS_V1, parseHistoryTextCandidateV1, parseHistoryTextSnapshotV1, type HistoryTextFieldV1, type HistoryTextRequestV1 } from '../../lib/agent/history-text-copilot'
import { useMasterCopilot } from '../agent/useMasterCopilot'
import CandidateSaveFeedback from '../agent/CandidateSaveFeedback'
import WorldviewTextDiff from '../worldview/WorldviewTextDiff'
import { CTextarea } from '../shared/CompositionInput'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'

const Context = createContext<((field: HistoryTextFieldV1) => void) | null>(null)
export function HistoryTextAIButton({ field }: { field: HistoryTextFieldV1 }) {
  const open = useContext(Context)
  return open ? <button type="button" className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-accent" aria-label={`AI ${HISTORY_TEXT_LABELS_V1[field]}`} onClick={() => open(field)}><Sparkles className="h-3 w-3"/>AI</button> : null
}
/** Only mounted for the existing longform Work entry, never to fabricate a World Run owner. */
export default function HistoryTextAuthoring({ project, worldGroupId, onAdopted, children }: { project: Project; worldGroupId: number | null; onAdopted: () => Promise<unknown>; children: ReactNode }) {
  const copilot = useMasterCopilot({ project, worldGroupId })
  const [field, setField] = useState<HistoryTextFieldV1 | null>(null), [hint, setHint] = useState(''), [mode, setMode] = useState<HistoryTextRequestV1['mode']>('expand'), [error, setError] = useState('')
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({}), [systemOverride, setSystemOverride] = useState<string | null>(null), [userOverride, setUserOverride] = useState<string | null>(null)
  const pending = copilot.pendingCandidates.filter(item => item.payload.skillId === 'world-origin.history-text')
  const candidate = pending.find(item => item.payload.historyTextRequest?.field === field)
  let parsed: { snapshot: ReturnType<typeof parseHistoryTextSnapshotV1>; value: string } | null = null, parseError = ''
  if (candidate) {
    try { parsed = { snapshot: parseHistoryTextSnapshotV1(candidate.payload.baseSnapshot), value: parseHistoryTextCandidateV1(candidate.event.content).value } }
    catch (cause) { parseError = cause instanceof Error ? cause.message : String(cause) }
  }
  const guarded = async (action: () => void | Promise<unknown>) => {
    setError('')
    try { await flushPendingEditsV1(); await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const open = (next: HistoryTextFieldV1) => { void guarded(() => { setField(next); setHint(''); setParameterValues({}); setSystemOverride(null); setUserOverride(null) }) }
  const otherPending = copilot.pendingCandidates.some(item => item !== candidate)
  return <Context.Provider value={open}>
    {!!pending.length && <div role="status" className="mb-3 flex flex-wrap items-center gap-2 text-xs">历史有待确认候选。{pending.map(item => <button key={item.event.id} className="text-accent underline" onClick={() => item.payload.historyTextRequest && open(item.payload.historyTextRequest.field)}>继续编辑：{item.payload.label}</button>)}</div>}
    {error && !field && <p role="alert" className="text-xs text-error">{error}</p>}
    {children}
    {field && <HistoryCandidateDialog label={`历史 AI · ${HISTORY_TEXT_LABELS_V1[field]}`} onClose={() => { void guarded(() => setField(null)) }}>
      <div className="mb-3 flex items-center justify-between"><h2>{HISTORY_TEXT_LABELS_V1[field]} · AI 候选</h2><button aria-label="关闭历史候选" onClick={() => { void guarded(() => setField(null)) }}><X className="h-4 w-4"/></button></div>
      <p className="mb-3 text-xs text-text-muted">候选尚未成为正式设定。采用只修改此字段；纪年变化不会自动换算已有事件。</p>
      {(error || copilot.error || parseError) && <p role="alert" className="mb-3 text-xs text-error">{error || copilot.error || parseError}</p>}
      {!candidate ? <>
        <div className="mb-3 flex gap-2" role="group" aria-label="历史生成方式">{(['expand', 'rewrite', 'polish'] as const).map(key => <button key={key} aria-pressed={key === mode} className={`rounded px-3 py-1 text-xs ${key === mode ? 'bg-accent text-white' : 'bg-bg-base'}`} onClick={() => setMode(key)}>{{ expand: '扩写', rewrite: '重写', polish: '润色' }[key]}</button>)}</div>
        <label className="text-xs">补充要求（可选）<CTextarea value={hint} onChange={event => setHint(event.target.value)} rows={3} className="mt-1 w-full"/></label>
        <PromptRunPanel key={field} moduleKey={field === 'overview' ? 'history.overview' : 'history.calendar'} parameterValues={parameterValues} onParamChange={setParameterValues}
          systemOverride={systemOverride} onSystemOverrideChange={setSystemOverride} userOverride={userOverride} onUserOverrideChange={setUserOverride}/>
        {otherPending && <p className="mt-2 text-xs text-text-muted">还有其他待确认候选，请先处理后再生成。</p>}
        <div className="mt-4 flex justify-end gap-3">{copilot.busy && <button className="text-xs" onClick={copilot.stop}>停止生成</button>}{copilot.recoveryAvailable && <button disabled={copilot.busy} className="text-xs text-accent" onClick={() => { void guarded(copilot.resume) }}>恢复原生成</button>}
          <button disabled={copilot.loading || copilot.busy || otherPending} className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40" onClick={() => { void guarded(() => copilot.submitTargetedRequest(`起草${HISTORY_TEXT_LABELS_V1[field]}，等待我确认。${hint}`, { id: `history-${crypto.randomUUID()}`, agentId: 'world-origin', skillId: 'world-origin.history-text', instruction: `只创作${HISTORY_TEXT_LABELS_V1[field]}。${hint || '保持已确认世界约束；空白可从幻想设想起步。'}`, historyTextRequest: { field, mode }, promptExecution: { version: 1, moduleKey: field === 'overview' ? 'history.overview' : 'history.calendar', parameterValues, ...(systemOverride === null ? {} : { systemOverride }), ...(userOverride === null ? {} : { userOverride }) } })) }}>{copilot.busy ? '生成中…' : '生成候选'}</button></div>
      </> : <>
        <CandidateSaveFeedback event={candidate.event} scope={copilot.candidateLocalSaveScope} draftState={copilot.readCandidateLocalDraftState?.(candidate.event.id!)} busy={copilot.busy} onRetry={() => copilot.flushCandidateDraft(candidate.event.id!)}>
          <CTextarea aria-label={parsed ? '历史字段候选' : '历史候选原始内容'} value={parsed ? parsed.value : candidate.event.content} disabled={copilot.busy} rows={8} className="w-full" onChange={event => { const raw = parsed ? JSON.stringify({ version: 1, value: event.target.value }) : event.target.value; void copilot.updateCandidate(candidate.event.id!, raw).catch(cause => setError(String(cause))) }}/>
        </CandidateSaveFeedback>
        {parsed && <details className="mt-3 text-xs"><summary>查看修改前后</summary><WorldviewTextDiff left={parsed.snapshot.baseline[field]} right={parsed.value} identityKey={`history:${candidate.event.id}:${field}`} baselineHash={parsed.snapshot.baselineHash} rightRevision={candidate.event.createdAt} sourceKind="field-value"/></details>}
        <div className="mt-4 flex justify-end gap-3"><button disabled={copilot.busy} className="text-xs" onClick={() => { void guarded(() => copilot.rejectCandidate(candidate)) }}>拒绝候选</button><button disabled={copilot.busy || !parsed} className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40" onClick={() => { void guarded(async () => { if (await copilot.adoptCandidate(candidate)) { await onAdopted(); setField(null) } }) }}>确认采用</button></div>
      </>}
    </HistoryCandidateDialog>}
  </Context.Provider>
}
