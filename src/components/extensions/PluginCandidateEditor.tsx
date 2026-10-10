import { useState } from 'react'
import type { DataSchema } from '../../lib/extensions/types'
import { isObject } from '../../lib/extensions/schema'

/** Common primitives get author-friendly fields; complex schemas keep an explicit JSON editor. */
export default function PluginCandidateEditor({ schema, value, disabled, onChange }: { schema: DataSchema; value: string; disabled: boolean; onChange(value:string):void }) {
  const [advanced,setAdvanced]=useState(false)
  let parsed: unknown
  try { parsed=JSON.parse(value) } catch { parsed=null }
  const properties=Object.entries(schema.properties??{})
  const simple=isObject(parsed) && properties.length>0 && properties.every(([,field])=>['string','number','integer','boolean'].includes(field.type))
  const object=simple ? parsed as Record<string,unknown> : {}
  function change(key:string,next:unknown){onChange(JSON.stringify({...object,[key]:next},null,2))}
  return <div>{simple && !advanced ? <div className="sf-plugin-candidate-fields">{properties.map(([key,field])=><label key={key}>{field.description||key}{field.type==='boolean'?<input type="checkbox" checked={object[key]===true} disabled={disabled} onChange={e=>change(key,e.target.checked)}/>:field.enum?<select aria-label={field.description||key} value={String(object[key]??'')} disabled={disabled} onChange={e=>change(key,field.type==='string'?e.target.value:Number(e.target.value))}>{field.enum.map(item=><option key={String(item)} value={String(item)}>{String(item)}</option>)}</select>:field.type==='string'?<textarea aria-label={field.description||key} value={String(object[key]??'')} disabled={disabled} maxLength={field.maxLength} rows={key==='title'?2:4} onChange={e=>change(key,e.target.value)}/>:<input aria-label={field.description||key} type="number" value={typeof object[key]==='number'?object[key] as number:''} disabled={disabled} min={field.minimum} max={field.maximum} step={field.type==='integer'?1:'any'} onChange={e=>change(key,e.target.value===''?null:Number(e.target.value))}/>}</label>)}</div>:<textarea aria-label="插件 AI 候选内容" rows={12} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}/>}{simple && <button onClick={()=>setAdvanced(!advanced)}>{advanced?'返回表单':'查看 JSON'}</button>}</div>
}
