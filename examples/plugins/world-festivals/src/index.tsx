import { useEffect,useState } from 'react'
import type {ExtensionContext,ExtensionRecord} from '@storyforge/plugin-sdk'
export default {activate(ctx:ExtensionContext){
 function Card({row,onSaved}:{row:ExtensionRecord;onSaved:(row:ExtensionRecord)=>void}){
  const [item,setItem]=useState(row.payload as {name:string;summary:string;customs:string;season:string;layout:string}),[busy,setBusy]=useState(false),[error,setError]=useState('')
  async function save(){setBusy(true);try{onSaved(await ctx.data.put({key:row.key,schemaId:row.schemaId,payload:item,expectedRevision:row.revision}));setError('')}catch(e){setError(String(e))}finally{setBusy(false)}}
  return <article><h4>{(row.payload as {name:string}).name}</h4><p>{(row.payload as {summary:string}).summary}</p><details><summary>编辑节庆</summary>{([['name','节庆名称'],['summary','节庆摘要'],['customs','节庆习俗'],['season','举行时节']] as const).map(([key,label])=><label key={key}>{label}<textarea aria-label={label} value={item[key]} disabled={busy} onChange={e=>setItem({...item,[key]:e.target.value})}/></label>)}<button disabled={busy} onClick={()=>void save()}>保存节庆</button></details>{error&&<p role="alert">{error}</p>}<button disabled={busy||JSON.stringify(item)!==JSON.stringify(row.payload)} onClick={()=>ctx.world.publish('culture',[row.key])}>预览并确认到世界</button></article>
 }
 function Festivals(){const [rows,setRows]=useState<ExtensionRecord[]>([]),[error,setError]=useState('');useEffect(()=>{ctx.data.list('festival').then(setRows).catch(e=>setError(String(e)))},[]);return <section><h3>一个世界，如何纪念自己的日子</h3><p>先在插件中整理文化并保存。确认到世界后，正式词条独立保留，世界封存与其他产品都能读取。</p>{error&&<p role="alert">{error}</p>}{rows.map(row=><Card key={row.key} row={row} onSaved={saved=>setRows(values=>values.map(value=>value.key===saved.key?saved:value))}/>)}</section>}
 ctx.ui.registerView('festivals',Festivals)
}}
