import { useState } from 'react'
import type { Project } from '../../lib/types'
import type { HistoryKeywordDraftSetV1 } from '../../lib/history/keyword-drafts'
import { HISTORY_KEYWORD_CONTENT_FIELDS_V1, parseHistoryKeywordContentV1, parseHistoryKeywordContentSnapshotV1, type HistoryKeywordContentFieldV1, type HistoryKeywordContentRequestV1, type HistoryKeywordContentV1 } from '../../lib/history/keyword-content'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { useMasterCopilot } from '../agent/useMasterCopilot'
import CandidateSaveFeedback from '../agent/CandidateSaveFeedback'
import PromptRunPanel from '../shared/PromptRunPanel'
import { CInput, CTextarea } from '../shared/CompositionInput'

export default function HistoryKeywordContent({ project, worldGroupId, value, activeId, formalIds, disabled, transfer }: {
  project: Project; worldGroupId: number | null; value: HistoryKeywordDraftSetV1; activeId: string | null; formalIds: string[]; disabled: boolean
  transfer: (action: () => Promise<boolean | undefined>) => Promise<boolean>
}) {
  const copilot = useMasterCopilot({ project, worldGroupId })
  const [fields,setFields] = useState<HistoryKeywordContentFieldV1[]>(['description']), [singleField,setSingleField] = useState<HistoryKeywordContentFieldV1>('description')
  const [mode,setMode] = useState<HistoryKeywordContentRequestV1['mode']>('fill-empty'), [hint,setHint] = useState(''), [error,setError] = useState(''), [preview,setPreview] = useState<HistoryKeywordContentRequestV1|null>(null)
  const [parameterValues,setParameterValues] = useState<Record<string,unknown>>({}), [systemOverride,setSystemOverride] = useState<string|null>(null), [userOverride,setUserOverride] = useState<string|null>(null)
  const candidate = copilot.pendingCandidates.find(row=>row.payload.skillId==='world-origin.history-keyword-content')
  let data: HistoryKeywordContentV1|null = null, parseError=''
  if(candidate)try{data=parseHistoryKeywordContentV1(candidate.event.content,parseHistoryKeywordContentSnapshotV1(candidate.payload.baseSnapshot).request)}catch(cause){parseError=String(cause)}
  const blocked=disabled||copilot.busy||copilot.loading, otherPending=copilot.pendingCandidates.some(row=>row!==candidate)
  const previous=copilot.events.flatMap(event=>{if(event.kind!=='candidate'||event.id===candidate?.event.id)return [];try{const payload=JSON.parse(event.payload);if(payload.skillId!=='world-origin.history-keyword-content')return [];const snapshot=parseHistoryKeywordContentSnapshotV1(payload.baseSnapshot);return [{event,snapshot,data:parseHistoryKeywordContentV1(event.content,snapshot.request)}]}catch{return []}})
  const prepare=(single:boolean, oneField?:HistoryKeywordContentFieldV1)=>{
    setError('')
    const targets=value.drafts.filter(row=>!row.deleted&&!formalIds.includes(row.draftId)&&(single?row.draftId===activeId:row.selected)).flatMap(row=>{
      const wanted=(oneField?[oneField]:fields).filter(field=>mode==='rewrite'||!(row[field]??'').trim())
      return wanted.length?[{draftId:row.draftId,fields:wanted}]:[]
    })
    if(!targets.length||targets.some(target=>!value.drafts.find(row=>row.draftId===target.draftId)?.keyword.trim())){setError('请选择有效草稿和字段；补全模式只生成空白字段。');return}
    setPreview({mode,targets})
  }
  const run=async()=>{
    if(!preview)return
    setError('')
    try{
      await flushPendingEditsV1()
      const request=preview;setPreview(null)
      await copilot.submitTargetedRequest('生成已确认范围内的关键词草稿字段，返回候选供我选择。',{
        id:`history-content-${crypto.randomUUID()}`,agentId:'world-origin',skillId:'world-origin.history-keyword-content',instruction:hint||'保留我已填的事实与意图，只起草本次选择的草稿字段，新增前提标为待确认设想。',historyKeywordContentRequest:request,
        promptExecution:{version:1,moduleKey:'history.keyword-content',parameterValues,...(systemOverride===null?{}:{systemOverride}),...(userOverride===null?{}:{userOverride})},
      })
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}
  }
  const change=(edit:(current:HistoryKeywordContentV1)=>HistoryKeywordContentV1)=>{
    if(!candidate)return
    try{const snapshot=parseHistoryKeywordContentSnapshotV1(candidate.payload.baseSnapshot), current=parseHistoryKeywordContentV1(copilot.readVisibleCandidateDraft(candidate.event.id!)?.rawValue??candidate.event.content,snapshot.request);void copilot.updateCandidate(candidate.event.id!,JSON.stringify(edit(current))).catch(cause=>setError(String(cause)))}catch(cause){setError(String(cause))}
  }
  const requestedFields=candidate&&data?parseHistoryKeywordContentSnapshotV1(candidate.payload.baseSnapshot).request.targets.reduce((sum,row)=>sum+row.fields.length,0):0
  const returnedFields=data?.patches.reduce((sum,row)=>sum+Object.keys(row.values).length,0)??0
  return <section aria-label="关键词条目创作" className="mb-4 rounded border border-border p-3 text-xs">
    <h3 className="mb-2 font-medium">生成条目内容</h3><p className="mb-2 text-text-muted">只起草选定字段，逐字段确认后加入草稿。草稿不会自动成为正式词条，推荐和内容生成分别由你发起。</p>
    {(error||copilot.error||parseError)&&<p role="alert" className="mb-2 text-error">{error||copilot.error||parseError}</p>}
    {!candidate?<>
      <fieldset disabled={blocked} className="space-y-2">
        <div className="flex flex-wrap gap-3">{Object.entries(HISTORY_KEYWORD_CONTENT_FIELDS_V1).map(([field,label])=><label key={field}><input type="checkbox" aria-label={`生成字段：${label}`} checked={fields.includes(field as HistoryKeywordContentFieldV1)} onChange={event=>setFields(previous=>event.target.checked?[...previous,field as HistoryKeywordContentFieldV1]:previous.filter(item=>item!==field))}/>{label}</label>)}</div>
        <label>生成方式<select aria-label="条目内容生成方式" className="ml-2 rounded border border-border bg-bg-base p-1" value={mode} onChange={event=>{setMode(event.target.value as typeof mode);setPreview(null)}}><option value="fill-empty">仅补全空白，保留已有内容</option><option value="rewrite">改写所选字段，采纳前对照原文</option></select></label>
        <CInput aria-label="条目生成补充要求" value={hint} onChange={event=>setHint(event.target.value)} placeholder="补充要求（可选）" className="w-full"/>
        <div className="flex flex-wrap items-center gap-3"><button disabled={otherPending} onClick={()=>prepare(false)} className="text-accent">生成所选条目</button><button disabled={otherPending} onClick={()=>prepare(true)} className="text-accent">生成当前条目</button><select aria-label="单字段生成目标" value={singleField} onChange={event=>setSingleField(event.target.value as HistoryKeywordContentFieldV1)} className="rounded border border-border bg-bg-base p-1">{Object.entries(HISTORY_KEYWORD_CONTENT_FIELDS_V1).map(([field,label])=><option key={field} value={field}>{label}</option>)}</select><button disabled={otherPending} onClick={()=>prepare(true,singleField)}>生成当前字段</button></div>
      </fieldset>
      {otherPending&&<p className="mt-2 text-text-muted">还有其他待确认候选，请先处理。</p>}
      <PromptRunPanel moduleKey="history.keyword-content" parameterValues={parameterValues} onParamChange={setParameterValues} systemOverride={systemOverride} onSystemOverrideChange={setSystemOverride} userOverride={userOverride} onUserOverrideChange={setUserOverride}/>
      {preview&&<div role="region" aria-label="本次条目生成范围" className="my-2 rounded border border-border p-2"><p>{preview.mode==='fill-empty'?'仅补全空白':'改写明确选择的字段'} · {preview.targets.length} 个草稿</p>{preview.targets.map(target=><p key={target.draftId}>{value.drafts.find(row=>row.draftId===target.draftId)?.keyword}：{target.fields.map(field=>HISTORY_KEYWORD_CONTENT_FIELDS_V1[field]).join('、')}</p>)}<p className="mt-1 text-text-muted">未列字段保持；返回后仍需选择采纳。停止或失败不自动重发。</p><button disabled={blocked||otherPending} className="mr-3 mt-2 text-accent" onClick={()=>{void run()}}>确认生成这些字段</button><button onClick={()=>setPreview(null)}>取消本次生成</button></div>}
      <div className="mt-2 flex gap-3">{copilot.busy&&<button onClick={copilot.stop}>停止条目生成</button>}{copilot.recoveryAvailable&&<button disabled={blocked} onClick={()=>{void copilot.resume()}}>恢复原条目生成</button>}</div>
    </>:<>
      <CandidateSaveFeedback event={candidate.event} scope={copilot.candidateLocalSaveScope} draftState={copilot.readCandidateLocalDraftState(candidate.event.id!)} busy={copilot.busy} onRetry={()=>copilot.flushCandidateDraft(candidate.event.id!)}>
        {data?data.patches.map(patch=><div key={patch.draftId} className="mb-3 rounded border border-border p-2"><h4>{value.drafts.find(row=>row.draftId===patch.draftId)?.keyword??'原关键词草稿'}</h4>{(Object.keys(patch.values) as HistoryKeywordContentFieldV1[]).map(field=>{
          const selected=!!data!.selectedTargets?.find(row=>row.draftId===patch.draftId)?.fields.includes(field), before=parseHistoryKeywordContentSnapshotV1(candidate.payload.baseSnapshot).baseline.value.drafts.find(row=>row.draftId===patch.draftId)?.[field]??''
          return <fieldset key={field} disabled={blocked} className="mt-2"><label><input type="checkbox" aria-label={`采纳${value.drafts.find(row=>row.draftId===patch.draftId)?.keyword??'原草稿'}的${HISTORY_KEYWORD_CONTENT_FIELDS_V1[field]}`} checked={selected} onChange={event=>{const checked=event.target.checked;change(current=>{const all=current.selectedTargets??[], previous=all.find(row=>row.draftId===patch.draftId)?.fields??[], next=checked?[...previous,field]:previous.filter(item=>item!==field);return {...current,selectedTargets:[...all.filter(row=>row.draftId!==patch.draftId),...(next.length?[{draftId:patch.draftId,fields:next}]:[])]}})}}/>{HISTORY_KEYWORD_CONTENT_FIELDS_V1[field]} · 待确认建议</label>{before&&<details className="my-1 text-text-muted"><summary>对照原字段</summary><p className="whitespace-pre-wrap">{before}</p></details>}<CTextarea aria-label={`候选${value.drafts.find(row=>row.draftId===patch.draftId)?.keyword??'原草稿'}的${HISTORY_KEYWORD_CONTENT_FIELDS_V1[field]}`} value={patch.values[field]??''} rows={3} className="mt-1 w-full" onChange={event=>{const text=event.target.value;change(current=>({...current,patches:current.patches.map(row=>row.draftId===patch.draftId?{...row,values:{...row.values,[field]:text}}:row)}))}}/></fieldset>
        })}</div>):<CTextarea aria-label="条目内容原始候选" rows={8} value={candidate.event.content} className="w-full" onChange={event=>{void copilot.updateCandidate(candidate.event.id!,event.target.value).catch(cause=>setError(String(cause)))}}/>}
      </CandidateSaveFeedback>
      <p className="mb-2 text-text-muted">本批返回 {returnedFields}/{requestedFields} 个请求字段。未返回的字段未完成，未选字段只保留在此前结果中；采纳仅写所选字段。需要补充时请重新明确选择，不会自动续费重发。</p>
      <div className="flex justify-end gap-3"><button disabled={blocked} onClick={()=>{void transfer(()=>copilot.rejectCandidate(candidate))}}>放弃本批内容</button><button disabled={blocked||!data?.selectedTargets?.length} onClick={()=>{void transfer(()=>copilot.adoptCandidate(candidate))}} className="text-accent disabled:opacity-40">采纳所选字段到草稿</button></div>
    </>}
    {!!previous.length&&<details className="mt-3 text-text-muted"><summary>回看此前内容候选（{previous.length} 批）</summary>{previous.map(({event,snapshot,data:past})=><details key={event.id} className="mt-2"><summary>{new Date(event.createdAt).toLocaleString()} 返回的内容 · {past.patches.reduce((sum,row)=>sum+Object.keys(row.values).length,0)}/{snapshot.request.targets.reduce((sum,row)=>sum+row.fields.length,0)} 个字段</summary>{past.patches.map(patch=><div key={patch.draftId}>{(Object.entries(patch.values) as [HistoryKeywordContentFieldV1,string][]).map(([field,text])=><p key={field} className="mt-2 whitespace-pre-wrap"><strong>{snapshot.baseline.value.drafts.find(row=>row.draftId===patch.draftId)?.keyword} · {HISTORY_KEYWORD_CONTENT_FIELDS_V1[field]}</strong>：{text}</p>)}</div>)}</details>)}</details>}
  </section>
}
