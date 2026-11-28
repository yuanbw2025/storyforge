import { useState } from 'react'
import type { Project } from '../../lib/types'
import { HISTORICAL_ERA_LABELS, KEYWORD_CATEGORY_LABELS } from '../../lib/types/history'
import { allocateHistoryKeywordSuggestionIdsV1, parseHistoryKeywordSuggestionsV1, parseHistoryKeywordSuggestionsSnapshotV1, type HistoryKeywordSuggestionsV1, type HistoryKeywordSuggestionV1 } from '../../lib/history/keyword-suggestions'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { useMasterCopilot } from '../agent/useMasterCopilot'
import CandidateSaveFeedback from '../agent/CandidateSaveFeedback'
import PromptRunPanel from '../shared/PromptRunPanel'
import { CInput, CTextarea } from '../shared/CompositionInput'

export default function HistoryKeywordSuggestions({ project, worldGroupId, disabled, transfer }: {
  project: Project; worldGroupId: number | null; disabled: boolean; transfer: (action: () => Promise<boolean | undefined>) => Promise<boolean>
}) {
  const copilot = useMasterCopilot({ project, worldGroupId })
  const [hint,setHint] = useState(''), [count,setCount] = useState(12), [error,setError] = useState('')
  const [parameterValues,setParameterValues] = useState<Record<string,unknown>>({}), [systemOverride,setSystemOverride] = useState<string|null>(null), [userOverride,setUserOverride] = useState<string|null>(null)
  const candidate = copilot.pendingCandidates.find(row => row.payload.skillId === 'world-origin.history-keyword-suggestions')
  let data: HistoryKeywordSuggestionsV1 | null = null, parseError = ''
  if (candidate) {
    try { data = parseHistoryKeywordSuggestionsV1(candidate.event.content,parseHistoryKeywordSuggestionsSnapshotV1(candidate.payload.baseSnapshot).request) }
    catch (cause) { parseError = cause instanceof Error ? cause.message : String(cause) }
  }
  const update = (change: (value: HistoryKeywordSuggestionsV1) => HistoryKeywordSuggestionsV1) => {
    if (!candidate) return
    try {
      const snapshot = parseHistoryKeywordSuggestionsSnapshotV1(candidate.payload.baseSnapshot)
      const current = parseHistoryKeywordSuggestionsV1(copilot.readVisibleCandidateDraft(candidate.event.id!)?.rawValue ?? candidate.event.content,snapshot.request)
      void copilot.updateCandidate(candidate.event.id!,JSON.stringify(change(current))).catch(cause=>setError(String(cause)))
    } catch(cause) {setError(cause instanceof Error ? cause.message : String(cause))}
  }
  const edit = (id: string, patch: Partial<HistoryKeywordSuggestionV1>) => update(current=>({...current,suggestions:current.suggestions.map(row=>row.draftId===id?{...row,...patch}:row)}))
  const run = async () => {
    setError('')
    try {
      await flushPendingEditsV1()
      await copilot.submitTargetedRequest('推荐历史关键词，先让我选择，再加入独立草稿。',{
        id:`history-keywords-${crypto.randomUUID()}`,agentId:'world-origin',skillId:'world-origin.history-keyword-suggestions',instruction:hint || '依据已确认世界与历史推荐不同维度的关键词，先保留建议，不写正式设定或我的个人意见。',
        historyKeywordSuggestionRequest:{draftIds:allocateHistoryKeywordSuggestionIdsV1(count)},
        promptExecution:{version:1,moduleKey:'history.keyword-suggestions',parameterValues,...(systemOverride===null?{}:{systemOverride}),...(userOverride===null?{}:{userOverride})},
      })
    } catch(cause) {setError(cause instanceof Error ? cause.message : String(cause))}
  }
  const blocked = disabled || copilot.busy || copilot.loading
  const otherPending = copilot.pendingCandidates.some(row=>row!==candidate)
  const old = copilot.events.flatMap(event=>{
    if(event.kind!=='candidate'||event.id===candidate?.event.id)return []
    try {
      const payload=JSON.parse(event.payload)
      if(payload.skillId!=='world-origin.history-keyword-suggestions')return []
      return [{event,data:parseHistoryKeywordSuggestionsV1(event.content,parseHistoryKeywordSuggestionsSnapshotV1(payload.baseSnapshot).request)}]
    } catch {return []}
  })
  return <section aria-label="历史关键词推荐" className="mb-4 rounded border border-border p-3 text-xs">
    <h3 className="mb-2 font-medium">推荐关键词</h3>
    <p className="mb-2 text-text-muted">建议先选择，再加入下方独立草稿。推荐理由不等于你的创作意见，也不会自动新建正式词条。</p>
    {(error||copilot.error||parseError)&&<p role="alert" className="mb-2 text-error">{error||copilot.error||parseError}</p>}
    {!candidate?<>
      <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1">希望补充的方向（可选）<CInput aria-label="关键词推荐方向" value={hint} onChange={event=>setHint(event.target.value)} className="mt-1 w-full"/></label><label>本批最多建议数<input aria-label="本批最多建议数" type="number" min={1} max={1000} step={1} value={count} onChange={event=>setCount(Number(event.target.value))} className="ml-2 w-20 rounded border border-border bg-bg-base p-1"/></label></div>
      <PromptRunPanel moduleKey="history.keyword-suggestions" parameterValues={parameterValues} onParamChange={setParameterValues} systemOverride={systemOverride} onSystemOverrideChange={setSystemOverride} userOverride={userOverride} onUserOverrideChange={setUserOverride}/>
      {otherPending&&<p className="my-2 text-text-muted">还有其他待确认候选，请先处理后再推荐。</p>}
      <div className="mt-2 flex flex-wrap justify-end gap-3">{copilot.busy&&<button onClick={copilot.stop}>停止推荐</button>}{copilot.recoveryAvailable&&<button disabled={blocked} onClick={()=>{void copilot.resume()}}>恢复原推荐</button>}<button disabled={blocked||otherPending} onClick={()=>{void run()}} className="text-accent disabled:opacity-40">{copilot.busy?'推荐中…':old.length?'再推荐一批':'推荐一批关键词'}</button></div>
    </>:<>
      <CandidateSaveFeedback event={candidate.event} scope={copilot.candidateLocalSaveScope} draftState={copilot.readCandidateLocalDraftState(candidate.event.id!)} busy={copilot.busy} onRetry={()=>copilot.flushCandidateDraft(candidate.event.id!)}>
        {data?<div className="space-y-2">{data.suggestions.map((row,index)=><fieldset key={row.draftId} disabled={blocked} className="rounded border border-border p-2">
          <label className="flex items-center gap-2"><input type="checkbox" aria-label={`选择建议${index+1}：${row.keyword||'未命名'}`} checked={!!data!.selectedIds?.includes(row.draftId)} onChange={event=>{const checked=event.target.checked;update(current=>({...current,selectedIds:checked?[...current.selectedIds??[],row.draftId]:(current.selectedIds??[]).filter(id=>id!==row.draftId)}))}}/>{row.keyword||'未命名建议'}</label>
          <div className="mt-2 grid gap-2 sm:grid-cols-3"><label>名称<CInput aria-label={`建议${index+1}的关键词`} value={row.keyword} onChange={event=>edit(row.draftId,{keyword:event.target.value})} className="mt-1 w-full"/></label><label>分类<select aria-label={`建议${index+1}的分类`} value={row.category} onChange={event=>edit(row.draftId,{category:event.target.value as HistoryKeywordSuggestionV1['category']})} className="mt-1 w-full rounded border border-border bg-bg-base p-1">{Object.entries(KEYWORD_CATEGORY_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>时期<CInput aria-label={`建议${index+1}的时期`} value={HISTORICAL_ERA_LABELS[row.era as keyof typeof HISTORICAL_ERA_LABELS]??row.era} onChange={event=>edit(row.draftId,{era:Object.entries(HISTORICAL_ERA_LABELS).find(([,label])=>label===event.target.value)?.[0]??event.target.value})} className="mt-1 w-full"/></label></div>
          <p className="mt-2 text-text-muted">推荐理由：{row.reason}</p>
        </fieldset>)}</div>:<CTextarea aria-label="关键词建议原始内容" value={candidate.event.content} rows={8} className="w-full" onChange={event=>{void copilot.updateCandidate(candidate.event.id!,event.target.value).catch(cause=>setError(String(cause)))}}/>}
      </CandidateSaveFeedback>
      <div className="mt-3 flex justify-end gap-3"><button disabled={blocked} onClick={()=>{void transfer(()=>copilot.rejectCandidate(candidate))}}>放弃本批建议</button><button disabled={blocked||!data?.selectedIds?.length} className="text-accent disabled:opacity-40" onClick={()=>{void transfer(()=>copilot.adoptCandidate(candidate))}}>加入所选建议到草稿（{data?.selectedIds?.length??0}）</button></div>
    </>}
    {!!old.length&&<details className="mt-3 text-text-muted"><summary>回看此前建议（{old.length} 批）</summary>{old.map(({event,data:past})=><details key={event.id} className="mt-2"><summary>{new Date(event.createdAt).toLocaleString()} 的建议</summary>{past.suggestions.map(row=><p key={row.draftId} className="mt-1"><strong>{row.keyword}</strong> · {KEYWORD_CATEGORY_LABELS[row.category]}：{row.reason}</p>)}</details>)}</details>}
  </section>
}
