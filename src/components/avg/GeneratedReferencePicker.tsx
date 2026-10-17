import { useEffect, useRef, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import { listAvgGeneratedReferenceImagesV1, prepareAvgGeneratedReferenceImageV1 } from '../../lib/avg/media-generated-reference'
import MediaAssetPreview from './MediaAssetPreview'

export type GeneratedReferenceSelection = Awaited<ReturnType<typeof prepareAvgGeneratedReferenceImageV1>>
type Page = Awaited<ReturnType<typeof listAvgGeneratedReferenceImagesV1>>

export default function GeneratedReferencePicker({scope,disabled,visible,refreshKey,onAction,onSelect}:{scope:WorkspaceScope;disabled:boolean;visible:boolean;
  refreshKey:string;onAction:(action:()=>Promise<void>)=>Promise<void>;onSelect:(selected:GeneratedReferenceSelection|null)=>void}){
  const [items,setItems]=useState<Page['items']>([]),[cursor,setCursor]=useState<number|null>(null),[choiceId,setChoiceId]=useState('')
  const [prepared,setPrepared]=useState<GeneratedReferenceSelection|null>(null),[observed,setObserved]=useState(''),[error,setError]=useState('')
  const request=useRef({generation:0})
  useEffect(()=>{setObserved('')},[visible])
  useEffect(()=>{
    const state=request.current,token=++state.generation
    setItems([]);setCursor(null);setChoiceId('');setPrepared(null);setObserved('');setError('')
    void listAvgGeneratedReferenceImagesV1(scope).then(page=>{if(token===state.generation){setItems(page.items);setCursor(page.nextCursor)}})
      .catch(cause=>{if(token===state.generation)setError(String(cause))})
    return()=>{state.generation++}
  },[scope,refreshKey])
  return <section aria-label="已采用生成图参考"><p>可沿用当前作品明确采用的生成图。每次外发和衍生用途仍需另行授权；原图和旧制作记录保持。</p>
    {error&&<p role="alert">{error}</p>}
    <label>已采用的生成图<select value={choiceId} disabled={disabled} onChange={event=>{request.current.generation++;setChoiceId(event.target.value);setPrepared(null);setObserved('');onSelect(null)}}>
      <option value="">请选择</option>{items.map(item=><option key={item.choiceId} value={item.choiceId} disabled={item.tooLarge}>{item.name}{item.tooLarge?'（超过参考大小上限）':''}</option>)}
    </select></label>
    {cursor&&<button className="lf-action" disabled={disabled} onClick={()=>void onAction(async()=>{
      const token=++request.current.generation,page=await listAvgGeneratedReferenceImagesV1(scope,cursor)
      if(token===request.current.generation){setItems(old=>[...old,...page.items]);setCursor(page.nextCursor)}
    })}>加载更早的生成图</button>}
    <button className="lf-action" disabled={disabled||!choiceId} onClick={()=>void onAction(async()=>{
      const token=++request.current.generation,value=await prepareAvgGeneratedReferenceImageV1({scope,choiceId:Number(choiceId)})
      if(token===request.current.generation){setPrepared(value);setObserved('')}
    })}>核验并查看生成图</button>
    {prepared&&<><div>{visible&&<MediaAssetPreview key={`${scope.projectId}:${scope.workId}:${prepared.asset.contentHash}:${prepared.source.choice.authorReceiptHash}`} scope={scope} asset={prepared.asset} generatedSource={prepared.source} onObserved={()=>setObserved(prepared.asset.contentHash)}/>}</div>
      <button className="lf-action" disabled={disabled||observed!==prepared.asset.contentHash} onClick={()=>onSelect(prepared)}>使用这张生成图作为参考</button></>}
  </section>
}
