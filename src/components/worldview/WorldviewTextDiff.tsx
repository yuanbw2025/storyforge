import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { assertWorldviewDiffExactV2, DIFF_BUDGET_V2, validateDiffBudgetV2, isSafeDiffBoundaryV2, type DiffResultV2, type DiffRowV2, type DiffCellRefV2 } from '../../lib/agent/worldview-text-diff-v2'
import { hashCanonicalValue, canonicalStringify } from '../../lib/agent/run/hash'
import { WORLDVIEW_DIFF_JOB_V1, exactDiffObjectV1, diffJobBindingV1, computeWorldviewDiffJobV1, type WorldviewDiffJobV1, type WorldviewDiffReplyV1 } from './worldview-diff.worker'
import './worldview-text-diff.css'

type Side='left'|'right'
/** Raw code-unit mapping for the textarea API and for explicit LF display spans. */
export function worldviewLFMap(raw:string) {
  const starts:number[]=[],domEnds:number[]=[]
  for(const match of raw.matchAll(/\r\n/g)){starts.push(match.index!);domEnds.push(match.index!-starts.length+2)}
  const domText=raw.replace(/\r\n?/g,'\n')
  const count=(values:number[],offset:number,inclusive:boolean)=>{let lo=0,hi=values.length;while(lo<hi){const mid=(lo+hi)>>>1;if(inclusive?values[mid]<=offset:values[mid]<offset)lo=mid+1;else hi=mid}return lo}
  return {domText,rawToDom:(offset:number,bias:'before'|'after'='before')=>{
    if(!Number.isSafeInteger(offset)||offset<0||offset>raw.length)throw new Error('raw-offset')
    const collapsed=count(starts,offset,false),inside=collapsed>0&&starts[collapsed-1]===offset-1
    return offset-collapsed+(inside&&bias==='after'?1:0)
  },domToRaw:(offset:number)=>{
    if(!Number.isSafeInteger(offset)||offset<0||offset>domText.length)throw new Error('dom-offset')
    return offset+count(domEnds,offset,true)
  }}
}
const RESULT_KEYS=['version','leftLength','rightLength','profile','budget','ops','rows','positionLinks','annotationsComplete','coarseReasons','work']
const REPLY_KEYS=['version','type','jobId','identityKey','baselineHash','leftHash','rightRevision','rightHash','profileRequestHash','budgetHash','inputBindingHash','result','resultBinding']
export async function validateWorldviewDiffReplyV1(job:WorldviewDiffJobV1,value:unknown):Promise<DiffResultV2> {
  if(value&&typeof value==='object'&&(value as {type?:unknown}).type==='error'){
    exactDiffObjectV1(value,['version','type','code','jobId','identityKey','baselineHash','leftHash','rightRevision','rightHash','profileRequestHash','budgetHash','inputBindingHash'])
    for(const key of ['jobId','identityKey','baselineHash','leftHash','rightRevision','rightHash','profileRequestHash','budgetHash','inputBindingHash'] as const)if(value[key]!==job[key])throw new Error('stale-diff-error')
    if(value.version!==WORLDVIEW_DIFF_JOB_V1||value.code!=='diff-computation-failed')throw new Error('diff-error-shape')
    throw new Error('diff-worker-failed')
  }
  exactDiffObjectV1(value,REPLY_KEYS);const reply=value as WorldviewDiffReplyV1
  for(const key of ['jobId','identityKey','baselineHash','leftHash','rightRevision','rightHash','profileRequestHash','budgetHash','inputBindingHash'] as const) if(reply[key]!==job[key]) throw new Error('stale-diff-reply')
  if(reply.version!==WORLDVIEW_DIFF_JOB_V1||reply.type!=='result') throw new Error('diff-reply-version')
  const result=reply.result;exactDiffObjectV1(result,RESULT_KEYS);validateDiffBudgetV2(result.budget)
  if(canonicalStringify(result.budget)!==canonicalStringify(job.budget)) throw new Error('diff-reply-budget')
  if(!Array.isArray(result.ops)||result.ops.length>job.budget.maxOps||!Array.isArray(result.rows)||result.rows.length>job.budget.maxRows
    ||!Array.isArray(result.positionLinks)||result.positionLinks.length>job.budget.maxOps||!Array.isArray(result.coarseReasons)||result.coarseReasons.length>32) throw new Error('diff-reply-size')
  const reasons=new Set(['input-size-limit','scan-limit','anchor-limit','diff-limit','trace-limit','gap-token-limit','output-op-limit','output-row-limit','annotation-output-limit','unsafe-gap-boundary','segmentation-replay-mismatch','invalid-segmentation-profile','segmentation-unavailable'])
  if(result.coarseReasons.some(reason=>typeof reason!=='string'||!reasons.has(reason))) throw new Error('diff-reply-reason')
  exactDiffObjectV1(result.work,['scan','anchor','diff','trace'])
  if(result.profile!==null) {exactDiffObjectV1(result.profile,['kind','locale','left','right']);if(!Array.isArray(result.profile.left)||result.profile.left.length>job.leftRaw.length+1||!Array.isArray(result.profile.right)||result.profile.right.length>job.rightRaw.length+1) throw new Error('diff-profile-size')}
  for(const op of result.ops) exactDiffObjectV1(op,['id','kind','left','right'])
  let refs=0
  for(const row of result.rows) {
    exactDiffObjectV1(row,['id','kind','left','right','leftRefs','rightRefs','precision'])
    if(!Array.isArray(row.leftRefs)||!Array.isArray(row.rightRefs)) throw new Error('diff-ref-shape')
    refs+=row.leftRefs.length+row.rightRefs.length
    if(refs>2*(job.budget.maxOps+job.budget.maxRows)) throw new Error('diff-ref-size')
    for(const ref of [...row.leftRefs,...row.rightRefs]) exactDiffObjectV1(ref,['op','range'])
  }
  for(const link of result.positionLinks) exactDiffObjectV1(link,['left','right','kind'])
  assertWorldviewDiffExactV2(job.leftRaw,job.rightRaw,result)
  const {resultBinding,...body}=reply
  if(typeof resultBinding!=='string'||await hashCanonicalValue(body)!==resultBinding) throw new Error('diff-result-hash')
  return result
}
function wholeFallback(left:string,right:string):DiffResultV2 {
  const ops:DiffResultV2['ops']=[]
  if(left.length)ops.push({id:'op-0',kind:'remove',left:[0,left.length],right:[0,0]})
  if(right.length)ops.push({id:`op-${ops.length}`,kind:'add',left:[left.length,left.length],right:[0,right.length]})
  return {version:'worldview-exact-display-diff-v2',leftLength:left.length,rightLength:right.length,profile:null,budget:{...DIFF_BUDGET_V2},ops,
    rows:ops.length?[{id:'row-0',kind:left.length&&right.length?'modified':left.length?'removed':'added',left:[0,left.length],right:[0,right.length],leftRefs:ops.flatMap((op,i)=>op.left[1]>op.left[0]?[{op:i,range:op.left}]:[]),rightRefs:ops.flatMap((op,i)=>op.right[1]>op.right[0]?[{op:i,range:op.right}]:[]),precision:'whole'}]:[],
    positionLinks:[],annotationsComplete:false,coarseReasons:['segmentation-unavailable'],work:{scan:0,anchor:0,diff:0,trace:0}}
}
type ChangeAnchor={id:string;groupId:string;left:DiffRowV2['left'];right:DiffRowV2['right']}
export function projectWorldviewDiffRowsV1(result:DiffResultV2,left:string,right:string) {
  const raw={left,right},safe=result.profile?{left:new Set(result.profile.left),right:new Set(result.profile.right)}:null
  const copyRef=(ref:DiffCellRefV2):DiffCellRefV2=>({op:ref.op,range:[...ref.range]})
  const refCount=(row:DiffRowV2)=>row.leftRefs.length+row.rightRefs.length
  const atLineEnd=(text:string,offset:number)=>isSafeDiffBoundaryV2(text,offset)&&(offset===0||offset===text.length||text[offset-1]==='\n'||text[offset-1]==='\r'&&text[offset]!=='\n')
  const lineBoundary=(row:DiffRowV2,edge:0|1)=>atLineEnd(left,row.left[edge])&&atLineEnd(right,row.right[edge])
  const groups:DiffRowV2[]=[],anchors:ChangeAnchor[]=[]
  const rowLimit=Math.min(DIFF_BUDGET_V2.maxRows,result.budget.maxRows),anchorLimit=Math.min(DIFF_BUDGET_V2.maxOps,result.budget.maxOps),refLimit=2*(anchorLimit+rowLimit)
  let rowRoom=rowLimit-result.rows.length,refRoom=refLimit-result.rows.reduce((sum,row)=>sum+refCount(row),0)
  let anchorRoom=anchorLimit-result.rows.filter(row=>row.kind!=='unchanged').length,open=false,limited=false
  const partition=(row:DiffRowV2,cuts:Array<{left:number;right:number}>,tag:string):DiffRowV2[]|null=>{
    if(!cuts.length)return[row]
    const cost=Number(row.left[1]>row.left[0])+Number(row.right[1]>row.right[0])
    if(cuts.length>rowRoom||cuts.length*cost>refRoom||row.kind!=='unchanged'&&cuts.length>anchorRoom){limited=true;return null}
    for(const cut of cuts)for(const side of ['left','right'] as const)if(!isSafeDiffBoundaryV2(raw[side],cut[side])||safe&&!safe[side].has(cut[side])){limited=true;return null}
    const pointers={left:0,right:0},pieces:DiffRowV2[]=[];let start={left:row.left[0],right:row.right[0]}
    const refs=(side:Side,from:number,to:number)=>{
      const input=row[side==='left'?'leftRefs':'rightRefs'],output:DiffCellRefV2[]=[]
      while(pointers[side]<input.length&&input[pointers[side]].range[1]<=from)pointers[side]++
      while(pointers[side]<input.length){const ref=input[pointers[side]];if(ref.range[0]>=to)break;const a=Math.max(from,ref.range[0]),b=Math.min(to,ref.range[1]);if(b>a)output.push({op:ref.op,range:[a,b]});if(ref.range[1]<=to)pointers[side]++;else break}
      return output
    }
    for(const end of [...cuts,{left:row.left[1],right:row.right[1]}]){
      pieces.push({...row,id:`${row.id}:${tag}:${pieces.length}`,kind:row.kind==='unchanged'?'unchanged':start.left===end.left?'added':start.right===end.right?'removed':'modified',left:[start.left,end.left],right:[start.right,end.right],leftRefs:refs('left',start.left,end.left),rightRefs:refs('right',start.right,end.right)});start=end
    }
    rowRoom-=cuts.length;refRoom-=pieces.reduce((sum,piece)=>sum+refCount(piece),0)-refCount(row);if(row.kind!=='unchanged')anchorRoom-=cuts.length
    return pieces
  }
  const appendRefs=(target:DiffCellRefV2[],input:DiffCellRefV2[])=>{for(const ref of input){const previous=target[target.length-1];if(previous&&previous.op===ref.op&&previous.range[1]===ref.range[0]){previous.range=[previous.range[0],ref.range[1]];refRoom++}else target.push(copyRef(ref))}}
  const emit=(row:DiffRowV2,barrier=false)=>{
    let group=groups[groups.length-1]
    if(!open||barrier||!group||group.left[1]!==row.left[0]||group.right[1]!==row.right[0]){
      group={...row,leftRefs:row.leftRefs.map(copyRef),rightRefs:row.rightRefs.map(copyRef)};groups.push(group)
    }else{
      rowRoom++;group.left=[group.left[0],row.left[1]];group.right=[group.right[0],row.right[1]]
      appendRefs(group.leftRefs,row.leftRefs);appendRefs(group.rightRefs,row.rightRefs)
      if(group.kind!=='unchanged'||row.kind!=='unchanged')group.kind=group.left[0]===group.left[1]?'added':group.right[0]===group.right[1]?'removed':'modified'
      if(row.precision==='whole'||row.precision==='line'&&group.precision==='grapheme')group.precision=row.precision
    }
    if(row.kind!=='unchanged')anchors.push({id:row.id,groupId:group.id,left:row.left,right:row.right})
    open=!barrier&&!lineBoundary(group,1)
  }
  const changedPiece=(canonical:DiffRowV2):void=>{
    const quoteSide=canonical.kind==='added'?'right':canonical.kind==='removed'?'left':null
    let firstQuote:RegExpExecArray|undefined
    if(quoteSide)for(const match of raw[quoteSide].slice(...canonical[quoteSide]).matchAll(/^[ \t]*>[ \t]/gm))if(atLineEnd(raw[quoteSide],canonical[quoteSide][0]+match.index!)){firstQuote=match;break}
    if(quoteSide&&firstQuote){
      if(firstQuote.index>0){const end=canonical[quoteSide][0]+firstQuote.index,pieces=partition(canonical,[{left:quoteSide==='left'?end:canonical.left[0],right:quoteSide==='right'?end:canonical.right[0]}],'block-prefix');if(pieces){for(const piece of pieces)changedPiece(piece);return}}
      const cuts:Array<{left:number;right:number}>=[],maximum=Math.min(127,rowRoom,refRoom,anchorRoom)
      if(maximum>0)for(const match of raw[quoteSide].slice(...canonical[quoteSide]).matchAll(/\r\n\r\n|\n\n|\r\r/g)){const end=canonical[quoteSide][0]+match.index!+match[0].length;if(end<canonical[quoteSide][1])cuts.push({left:quoteSide==='left'?end:canonical.left[0],right:quoteSide==='right'?end:canonical.right[0]});if(cuts.length>=maximum)break}
      const pieces=partition(canonical,cuts,'quote')??[canonical]
      for(const piece of pieces)emit(piece,true)
      return
    }
    const blockSide=canonical.kind==='added'?'right':canonical.kind==='removed'?'left':null
    const text=blockSide?raw[blockSide].slice(...canonical[blockSide]):''
    emit(canonical,!!blockSide&&!!text.trim()&&(/[\r\n]/.test(text)||lineBoundary(canonical,0)&&lineBoundary(canonical,1)))
  }
  for(const canonical of result.rows){
    if(canonical.kind!=='unchanged'){
      const leftText=left.slice(...canonical.left),rightText=right.slice(...canonical.right)
      let quote:RegExpExecArray|undefined
      for(const match of rightText.matchAll(/^[ \t]*>[ \t]/gm))if(atLineEnd(right,canonical.right[0]+match.index!)){quote=match;break}
      // Separate a real added physical block from its preceding replacement or
      // EOL change only when the original add ops already point at left.end.
      if(canonical.kind==='modified'&&quote&&canonical.rightRefs.every(ref=>result.ops[ref.op].kind==='add'&&result.ops[ref.op].left[0]===canonical.left[1])){
        const pieces=partition(canonical,[{left:canonical.left[1],right:canonical.right[0]+quote.index!}],'block')
        if(pieces){for(const piece of pieces)changedPiece(piece);continue}
      }
      if(canonical.kind==='modified'&&quote&&canonical.rightRefs.every(ref=>result.ops[ref.op].kind==='add'&&result.ops[ref.op].left[0]===canonical.left[0])&&canonical.leftRefs.every(ref=>result.ops[ref.op].kind==='remove'&&result.ops[ref.op].right[0]===canonical.right[1])){
        const pieces=partition(canonical,[{left:canonical.left[0],right:canonical.right[1]}],'block')
        if(pieces){for(const piece of pieces)changedPiece(piece);continue}
      }
      // Symmetric deletion: consume the original remove ops at their actual
      // right.start before the new EOL whitespace; never move that zero point.
      if(canonical.kind==='modified'&&!rightText.trim()&&!!leftText.trim()&&/[\r\n]/.test(leftText)&&canonical.leftRefs.every(ref=>result.ops[ref.op].kind==='remove'&&result.ops[ref.op].right[0]===canonical.right[0])){
        const pieces=partition(canonical,[{left:canonical.left[1],right:canonical.right[0]}],'block')
        if(pieces){for(const piece of pieces)changedPiece(piece);continue}
      }
      if(canonical.kind==='modified'&&!rightText.trim()&&!!leftText.trim()&&/[\r\n]/.test(leftText)&&canonical.leftRefs.every(ref=>result.ops[ref.op].kind==='remove'&&result.ops[ref.op].right[0]===canonical.right[1])&&canonical.rightRefs.every(ref=>result.ops[ref.op].kind==='add'&&result.ops[ref.op].left[0]===canonical.left[0])){
        const pieces=partition(canonical,[{left:canonical.left[0],right:canonical.right[1]}],'block')
        if(pieces){for(const piece of pieces)changedPiece(piece);continue}
      }
      changedPiece(canonical);continue
    }
    const cuts:Array<{left:number;right:number}>=[];let first=-1,last=-1
    if(!lineBoundary(canonical,0)||!lineBoundary(canonical,1))for(let at=canonical.left[0];at<canonical.left[1];at++)if(left[at]==='\r'||left[at]==='\n'){if(left[at]==='\r'&&left[at+1]==='\n')at++;if(first<0)first=at+1;last=at+1}
    if(!lineBoundary(canonical,0)&&first>canonical.left[0]&&first<canonical.left[1])cuts.push({left:first,right:canonical.right[0]+first-canonical.left[0]})
    if(!lineBoundary(canonical,1)&&last>canonical.left[0]&&last<canonical.left[1]&&last!==first)cuts.push({left:last,right:canonical.right[0]+last-canonical.left[0]})
    else if(!lineBoundary(canonical,1)&&last>canonical.left[0]&&last<canonical.left[1]&&!cuts.length)cuts.push({left:last,right:canonical.right[0]+last-canonical.left[0]})
    const pieces=partition(canonical,cuts,'context')
    if(!pieces)emit(canonical,true);else for(const piece of pieces)emit(piece)
  }
  let valid=groups.length<=rowLimit&&anchors.length<=anchorLimit&&groups.reduce((sum,row)=>sum+refCount(row),0)<=refLimit
  for(const side of ['left','right'] as const){let cursor=0;const consumed=result.ops.map(op=>op[side][0])
    for(const group of groups){if(group[side][0]!==cursor)valid=false;for(const ref of group[side==='left'?'leftRefs':'rightRefs']){const op=result.ops[ref.op];if(!op||ref.range[0]!==cursor||ref.range[0]!==consumed[ref.op]||ref.range[1]>op[side][1])valid=false;cursor=ref.range[1];consumed[ref.op]=cursor}if(cursor!==group[side][1])valid=false}
    if(cursor!==raw[side].length||consumed.some((end,index)=>end!==result.ops[index][side][1]))valid=false
  }
  if(!valid)return{rows:result.rows,anchors:result.rows.filter(row=>row.kind!=='unchanged').map(row=>({id:row.id,groupId:row.id,left:row.left,right:row.right})),limited:true}
  return{rows:groups,anchors,limited}
}
type ViewItem={kind:'row';row:DiffRowV2;index:number}|{kind:'fold';start:number;end:number;id:string;lines:number}
type TextMapping={sourceKey:string;side:Side;start:number;end:number;map:ReturnType<typeof worldviewLFMap>}
export interface WorldviewTextDiffProps {left:string;right:string;identityKey:string;baselineHash:string;rightRevision:number;sourceKind:'field-value'|'raw-artifact';onEditRange?:(start:number,end:number)=>void}
export default function WorldviewTextDiff(props:WorldviewTextDiffProps) {
  const {left,right,identityKey,baselineHash,rightRevision,sourceKind}=props
  const sourceKey=canonicalStringify({identityKey,baselineHash,rightRevision,left,right,sourceKind})
  const active=useRef(0),[answer,setAnswer]=useState<{key:string;result:DiffResultV2}|null>(null),[status,setStatus]=useState('正在更新对比…')
  const [notice,setNotice]=useState(''),[changesOnly,setChangesOnly]=useState(false),[expanded,setExpanded]=useState<Set<string>>(new Set())
  const viewport=useRef<HTMLDivElement>(null),nodes=useRef(new Map<string,HTMLDivElement>()),textMap=useRef(new WeakMap<Node,TextMapping>()),sideLock=useRef<Side|null>(null)
  const [scrollTop,setScrollTop]=useState(0),[height,setHeight]=useState(600),[layout,setLayout]=useState(0),heights=useRef(new Map<string,number>())
  const sourceRef=useRef(sourceKey);sourceRef.current=sourceKey
  const anchor=useRef<{key:string;top:number;source:string}|null>(null)
  const captureAnchor=useCallback(()=>{const box=viewport.current?.getBoundingClientRect();if(!box)return;let first:{key:string;top:number}|null=null;for(const [key,element]of nodes.current){const rect=element.getBoundingClientRect();if(rect.bottom>box.top+1&&(!first||rect.top<first.top))first={key,top:rect.top}}if(first)anchor.current={key:first.key,top:first.top-box.top,source:sourceRef.current}},[])
  const [changeIndex,setChangeIndex]=useState(-1),[navigationRequest,requestNavigation]=useState(0),navigation=useRef<{id:string;side?:Side;range?:readonly[number,number];source:string}|null>(null),selectionWindow=useRef<{start:number;end:number}|null>(null)
  useEffect(()=>{
    const id=++active.current;let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,disposed=false,settled=false,falling=false
    setStatus('正在更新对比…');setAnswer(null);setExpanded(new Set());setChangeIndex(-1);heights.current.clear();navigation.current=null;selectionWindow.current=null;sideLock.current=null;anchor.current=null
    const current=()=>!disposed&&active.current===id
    const deliver=(result:DiffResultV2,message:string)=>{if(!current()||settled)return;settled=true;if(timer)clearTimeout(timer);worker?.terminate();setAnswer({key:sourceKey,result});setStatus(message)}
    const fallback=async(job:WorldviewDiffJobV1,message:string)=>{
      if(!current()||settled||falling)return
      falling=true;if(timer)clearTimeout(timer)
      worker?.terminate()
      if(left.length+right.length<=8000)try{const reply=await computeWorldviewDiffJobV1(job);deliver(await validateWorldviewDiffReplyV1(job,reply),message);return}catch{/* Full exact coarse view below. */}
      deliver(wholeFallback(left,right),`${message}；当前按整段对照，完整原串仍可查看与复制。`)
    }
    void(async()=>{
      const profile={kind:'intl-grapheme' as const,version:1 as const,locale:'zh-CN' as const},budget={...DIFF_BUDGET_V2}
      const job:WorldviewDiffJobV1={version:WORLDVIEW_DIFF_JOB_V1,type:'compare',jobId:id,identityKey,baselineHash,leftHash:await hashCanonicalValue(left),rightRevision,rightHash:await hashCanonicalValue(right),leftRaw:left,rightRaw:right,sourceKind,profile,budget,profileRequestHash:await hashCanonicalValue(profile),budgetHash:await hashCanonicalValue(budget),inputBindingHash:''}
      job.inputBindingHash=await hashCanonicalValue(diffJobBindingV1(job))
      if(!current())return
      try {
        worker=new Worker(new URL('./worldview-diff.worker.ts',import.meta.url),{type:'module',name:'worldview-text-diff-v1'})
        worker.onmessage=event=>{void(async()=>{
          if(!current()||settled)return
          try{const result=await validateWorldviewDiffReplyV1(job,event.data);deliver(result,result.coarseReasons.length?'部分内容按较粗粒度对照。':'')}
          catch{await fallback(job,'细节对照暂不可用')}
        })()}
        worker.onerror=()=>{void fallback(job,'后台对照不可用')};worker.onmessageerror=()=>{void fallback(job,'无法读取后台对照')}
        timer=setTimeout(()=>{void fallback(job,'对照耗时较长，已停止后台计算')},1200)
        worker.postMessage(job)
      }catch{await fallback(job,'后台对照不可用')}
    })().catch(()=>{if(current())deliver(wholeFallback(left,right),'细节对照暂不可用；完整原串已保留。')})
    return()=>{disposed=true;worker?.terminate();if(timer)clearTimeout(timer)}
  },[sourceKey,left,right,identityKey,baselineHash,rightRevision,sourceKind])
  const result=answer?.key===sourceKey?answer.result:null
  const projection=useMemo(()=>result?projectWorldviewDiffRowsV1(result,left,right):{rows:[],anchors:[],limited:false},[result,left,right])
  const rows=projection.rows,changes=projection.anchors
  const anchorsByGroup=useMemo(()=>{const map=new Map<string,ChangeAnchor[]>();for(const change of changes){const list=map.get(change.groupId)??[];list.push(change);map.set(change.groupId,list)}return map},[changes])
  const physicalLines=useMemo(()=>{const map=new Map<string,number>();for(const row of rows)if(row.kind==='unchanged'){let lines=0;for(let at=row.left[0];at<row.left[1];at++)if(left[at]==='\r'||left[at]==='\n'){if(left[at]==='\r'&&left[at+1]==='\n')at++;lines++}if(row.left[1]>row.left[0]&&!/[\r\n]/.test(left[row.left[1]-1]))lines++;map.set(row.id,lines)}return map},[rows,left])
  const movement=useMemo(()=>{
    const links=new Map<string,Array<{id:string;side:Side;range:readonly[number,number]}>>()
    const find=(side:Side,from:number)=>{let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid][side][1]<=from)lo=mid+1;else hi=mid}return rows[lo]}
    for(const link of result?.positionLinks??[])for(const side of ['left','right'] as const){const other=side==='left'?'right':'left',from=find(side,link[side][0]),to=find(other,link[other][0]);if(from&&to){const list=links.get(from.id)??[];list.push({id:to.id,side:other,range:link[other]});links.set(from.id,list)}}
    return links
  },[result,rows])
  const items=useMemo(()=>{
    const list:ViewItem[]=[];let index=0
    while(index<rows.length){
      if(rows[index].kind!=='unchanged'){list.push({kind:'row',row:rows[index],index});index++;continue}
      let end=index+1;while(end<rows.length&&rows[end].kind==='unchanged')end++
      const key=`fold:${index}:${end}`
      const lines=rows.slice(index,end).reduce((sum,row)=>sum+(physicalLines.get(row.id)??1),0)
      if(!expanded.has(key)&&(changesOnly||lines>6)) {
        const entire=changesOnly||end-index<5,first=entire?index:Math.min(end,index+2),last=entire?end:Math.max(first,end-2)
        for(let n=index;n<first;n++)list.push({kind:'row',row:rows[n],index:n})
        if(last>first)list.push({kind:'fold',start:first,end:last,id:key,lines:rows.slice(first,last).reduce((sum,row)=>sum+(physicalLines.get(row.id)??1),0)})
        for(let n=last;n<end;n++)list.push({kind:'row',row:rows[n],index:n})
      }else for(let n=index;n<end;n++)list.push({kind:'row',row:rows[n],index:n})
      index=end
    }
    return list
  },[rows,expanded,changesOnly,physicalLines])
  const offsets=[0];for(const item of items)offsets.push(offsets[offsets.length-1]+(heights.current.get(item.kind==='row'?item.row.id:item.id)??(item.kind==='fold'?44:88)))
  let start=0;while(start+1<offsets.length&&offsets[start+1]<scrollTop)start++
  start=Math.max(0,start-5);let end=start;while(end<items.length&&offsets[end]<scrollTop+height+600)end++
  end=Math.min(items.length,Math.max(end,start+12))
  let selectionTooLarge=false
  if(selectionWindow.current){const pin=selectionWindow.current;if(Math.max(end,pin.end)-Math.min(start,pin.start)<=80){start=Math.min(start,pin.start);end=Math.max(end,pin.end)}else selectionTooLarge=true}
  useLayoutEffect(()=>{if(selectionTooLarge){selectionWindow.current=null;const selected=window.getSelection();if(selected?.anchorNode&&viewport.current?.contains(selected.anchorNode))selected.removeAllRanges();setNotice('所选范围过长，请缩小选择或使用整侧复制。')}},[selectionTooLarge])
  const visible=useMemo(()=>items.slice(start,end),[items,start,end])
  useLayoutEffect(()=>{
    const element=viewport.current;if(!element)return
    const measure=()=>{captureAnchor();setHeight(element.clientHeight||600);heights.current.clear();setLayout(value=>value+1)}
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);observer?.observe(element)
    window.addEventListener('themechange',measure);window.addEventListener('resize',measure)
    return()=>{observer?.disconnect();window.removeEventListener('themechange',measure);window.removeEventListener('resize',measure)}
  },[captureAnchor])
  useLayoutEffect(()=>{
    const previous=anchor.current;anchor.current=null
    if(previous&&previous.source===sourceKey){const element=nodes.current.get(previous.key),box=viewport.current?.getBoundingClientRect();if(element&&box&&viewport.current){const delta=element.getBoundingClientRect().top-box.top-previous.top;if(Math.abs(delta)>.5){viewport.current.scrollTop+=delta;setScrollTop(viewport.current.scrollTop)}}}
    let changed=false
    for(const item of visible){const key=item.kind==='row'?item.row.id:item.id,el=nodes.current.get(key),size=el?.getBoundingClientRect().height;if(size&&Math.abs((heights.current.get(key)??0)-size)>.5){heights.current.set(key,size);changed=true}}
    if(changed){captureAnchor();setLayout(value=>value+1)}
    const target=navigation.current
    if(target&&target.source!==sourceKey){navigation.current=null;return}
    if(target&&!changed){const element=nodes.current.get(target.id);if(element){element.scrollIntoView?.({block:'center'});if(target.side&&target.range&&viewport.current){const from=target.range[0],to=target.range[1];const span=[...element.querySelectorAll<HTMLElement>(`[data-diff-side="${target.side}"] [data-raw-start]`)].find(node=>Number(node.dataset.rawStart)<=from&&Number(node.dataset.rawEnd)>from);const mapped=span?.firstChild?textMap.current.get(span.firstChild):null;if(span?.firstChild&&mapped){const selection=document.createRange();selection.setStart(span.firstChild,mapped.map.rawToDom(from-mapped.start,'before'));selection.setEnd(span.firstChild,mapped.map.rawToDom(Math.min(to,mapped.end)-mapped.start,'after'));if(typeof selection.getBoundingClientRect==='function'){const rect=selection.getBoundingClientRect(),box=viewport.current.getBoundingClientRect();viewport.current.scrollTop+=rect.top-box.top-box.height/2}}}element.focus({preventScroll:true});navigation.current=null}}
  },[visible,layout,sourceKey,captureAnchor,navigationRequest])
  useEffect(()=>{const release=()=>{if(window.getSelection()?.isCollapsed)selectionWindow.current=null};document.addEventListener('selectionchange',release);return()=>document.removeEventListener('selectionchange',release)},[])
  const go=(direction:number)=>{
    if(!changes.length)return
    const currentIndex=changeIndex<0?(direction>0?-1:0):changeIndex,next=(currentIndex+direction+changes.length)%changes.length,change=changes[next];setChangeIndex(next)
    const side=change.right[1]>change.right[0]?'right':'left'
    navigation.current={id:change.groupId,side,range:change[side],source:sourceKey};requestNavigation(value=>value+1)
    const itemIndex=items.findIndex(item=>item.kind==='row'&&item.row.id===change.groupId)
    if(itemIndex>=0&&viewport.current){viewport.current.scrollTop=offsets[itemIndex];setScrollTop(offsets[itemIndex])}
  }
  const endpoint=(node:Node|null,offset:number):{side:Side;raw:number}|null=>{
    if(!node||!viewport.current?.contains(node))return null
    const mapped=textMap.current.get(node)
    if(mapped&&mapped.sourceKey===sourceKey&&viewport.current?.contains(node)){try{return{side:mapped.side,raw:mapped.start+mapped.map.domToRaw(node.nodeType===3?offset:offset===0?0:mapped.map.domText.length)}}catch{return null}}
    if(node.nodeType!==1||offset<0||offset>node.childNodes.length)return null
    const child=node.childNodes[offset]??node.childNodes[offset-1]
    if(child){const own=textMap.current.get(child)??(child.firstChild?textMap.current.get(child.firstChild):undefined);if(own&&own.sourceKey===sourceKey)return{side:own.side,raw:offset===node.childNodes.length?own.end:own.start}}
    return null
  }
  const copy=(event:React.ClipboardEvent)=>{
    const selection=window.getSelection(),a=selection?endpoint(selection.anchorNode,selection.anchorOffset):null,b=selection?endpoint(selection.focusNode,selection.focusOffset):null
    event.preventDefault()
    if(!selection||selection.rangeCount!==1||!a||!b||a.side!==b.side||sideLock.current!==a.side){setNotice('请在同一列连续选择，或使用整侧复制。');return}
    const from=Math.min(a.raw,b.raw),to=Math.max(a.raw,b.raw);let cursor=from
    for(const item of visible){if(item.kind==='fold')continue;const range=item.row[a.side];if(range[1]<=cursor)continue;if(range[0]>cursor)break;cursor=Math.max(cursor,range[1]);if(cursor>=to)break}
    if(cursor<to){setNotice('所选范围包含折叠或未显示内容，请展开或使用整侧复制。');return}
    event.clipboardData.setData('text/plain',(a.side==='left'?left:right).slice(from,to));setNotice('已复制当前列所选原文。')
  }
  const copyFull=async(side:Side)=>{try{if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(side==='left'?left:right);setNotice(side==='left'?'已复制完整原文。':'已复制完整候选正文。')}catch{setNotice('复制未完成，请使用同侧文本选择复制。')}}
  const forgetSelection=()=>{selectionWindow.current=null;const selection=window.getSelection();if(selection?.anchorNode&&viewport.current?.contains(selection.anchorNode)&&!selection.isCollapsed){selection.removeAllRanges();setNotice('显示范围已变化，请重新选择或使用整侧复制。')}}
  const editAnchor=(id:string)=>changes[changeIndex]?.groupId===id?changes[changeIndex]:anchorsByGroup.get(id)?.[0]
  const cell=(row:DiffRowV2,side:Side)=>{
    const raw=side==='left'?left:right,refs=row[side==='left'?'leftRefs':'rightRefs']
    const dense=refs.length>512
    const spans=dense&&row[side][1]>row[side][0]?[{op:-1,range:row[side]}]:refs
    return <div className={`wv-diff-cell wv-diff-${side}${!spans.length?' wv-diff-cell-empty':''}${/^\s*\|/.test(raw.slice(...row[side]))?' wv-diff-cell-table':''}`} data-diff-side={side} data-cell-start={row[side][0]} data-cell-end={row[side][1]} onKeyDown={()=>{sideLock.current=side}}>
      <span className="wv-diff-side-label" aria-hidden="true">{row.kind==='unchanged'?'未改上下文':side==='left'?'− 原文':'+ 候选'}</span>
      {!spans.length?<span className="wv-diff-padding" aria-label="对应位置无文本"/>:spans.map((ref:DiffCellRefV2,i)=>{
        const text=raw.slice(...ref.range),map=worldviewLFMap(text),kind=ref.op<0?'modified':result!.ops[ref.op].kind
        const selected=changes[changeIndex],current=kind!=='equal'&&selected?.groupId===row.id&&ref.range[0]<selected[side][1]&&ref.range[1]>selected[side][0]
        const metadata:TextMapping={sourceKey,side,start:ref.range[0],end:ref.range[1],map}
        return <span key={`${ref.op}:${ref.range[0]}:${i}`} data-diff-kind={kind} data-raw-start={ref.range[0]} data-raw-end={ref.range[1]}
          data-diff-current={current?'true':undefined} ref={element=>{if(element){textMap.current.set(element,metadata);if(element.firstChild?.nodeType===3)textMap.current.set(element.firstChild,metadata)}}} className={`wv-diff-span wv-diff-${kind}${current?' wv-diff-current':''}`}>{map.domText}</span>
      })}
      {dense&&<span className="wv-diff-decoration">本行变更较密，按段对照</span>}
      {row.kind==='added'&&side==='right'&&<span className="wv-diff-decoration">＋ 新增</span>}
      {row.kind==='removed'&&side==='left'&&<span className="wv-diff-decoration">− 删除</span>}
      {row.kind==='modified'&&refs.some(ref=>result!.ops[ref.op].kind===(side==='left'?'remove':'add'))&&<span className="wv-diff-decoration">{side==='left'?'− 原文有改动':'＋ 候选有改动'}</span>}
      {refs.some(ref=>result!.ops[ref.op].kind!=='equal'&&raw.slice(...ref.range).trim()==='')&&<span className="wv-diff-decoration">包含空白或换行变化</span>}
    </div>
  }
  return <section className="worldview-exact-diff" aria-label="原文与候选精确对照" data-current-change={changes[changeIndex]?.id}>
    <div className="wv-diff-toolbar"><span>{changes.length} 处变化</span><button type="button" onClick={()=>go(-1)} disabled={!changes.length}>上一处</button><button type="button" onClick={()=>go(1)} disabled={!changes.length}>下一处</button>
      <label><input type="checkbox" checked={changesOnly} onChange={event=>{forgetSelection();setChangesOnly(event.target.checked);setScrollTop(0);if(viewport.current)viewport.current.scrollTop=0}}/>只看变化</label>
      <button type="button" onClick={()=>void copyFull('left')}>复制原文</button><button type="button" onClick={()=>void copyFull('right')}>复制候选正文</button></div>
    {status&&<p role="status">{status}</p>}{notice&&<p role="status">{notice}</p>}
    {projection.limited&&<p role="status">部分较长上下文按原段展示，完整内容未截断。</p>}
    <div className="wv-diff-column-head" aria-hidden="true"><span>原文（只读）</span><span>候选正文（只读对照）</span></div>
    <div ref={viewport} className="wv-diff-viewport" data-diff-scroller tabIndex={0} onCopy={copy} onScroll={event=>setScrollTop(event.currentTarget.scrollTop)}
      onPointerDown={event=>{const side=(event.target as Element).closest('[data-diff-side]')?.getAttribute('data-diff-side');sideLock.current=side==='left'||side==='right'?side:null;selectionWindow.current={start,end}}}>
      <div aria-hidden="true" style={{height:offsets[start]??0}}/>
      {visible.map(item=>item.kind==='fold'?<div className="wv-diff-fold" key={item.id} ref={el=>{if(el)nodes.current.set(item.id,el);else nodes.current.delete(item.id)}}><button type="button" onClick={()=>{forgetSelection();setExpanded(current=>new Set([...current,item.id]))}}>展开 {item.lines} 行未改内容</button></div>
        :<div className={`wv-diff-row wv-diff-row-${item.row.kind}`} key={item.row.id} data-diff-row={item.row.id} tabIndex={-1} ref={el=>{if(el)nodes.current.set(item.row.id,el);else nodes.current.delete(item.row.id)}}>
          {cell(item.row,'left')}{cell(item.row,'right')}
          {(movement.get(item.row.id)??[]).slice(0,8).map((target,index)=><button type="button" className="wv-diff-move-link" key={`${target.side}:${target.range[0]}:${index}`} onClick={()=>{
            navigation.current={...target,source:sourceKey};requestNavigation(value=>value+1);const destination=items.findIndex(entry=>entry.kind==='row'&&entry.row.id===target.id)
            if(destination>=0&&viewport.current){viewport.current.scrollTop=offsets[destination];setScrollTop(offsets[destination])}
          }}>同文在{target.side==='left'?'原文':'候选'}另一处 · {index+1}</button>)}
          {props.onEditRange&&editAnchor(item.row.id)&&<button type="button" className="wv-diff-jump" onClick={()=>{const target=editAnchor(item.row.id);if(target)props.onEditRange!(...target.right)}}>在候选中定位</button>}
        </div>)}
      <div aria-hidden="true" style={{height:Math.max(0,(offsets[offsets.length-1]??0)-(offsets[end]??0))}}/>
      {result&&!rows.length&&<p>两侧内容为空。</p>}
    </div>
  </section>
}
