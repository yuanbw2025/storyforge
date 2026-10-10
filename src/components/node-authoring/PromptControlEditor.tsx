import { useEffect, useState } from 'react'
import type { PromptTemplate } from '../../lib/types'
import type { AuthoringNodeInstance } from '../../lib/node-authoring/contracts'
import { usePromptStore } from '../../stores/prompt'

export default function PromptControlEditor(props: { node: AuthoringNodeInstance; onChange: (config: Record<string, unknown>) => void }) {
  const templates = usePromptStore(state => state.templates)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { void usePromptStore.getState().init().catch(cause => setError(String(cause))) }, [])
  const snapshot = props.node.config.promptSnapshot as PromptTemplate | undefined
  const selectedId = String(props.node.config.templateId ?? '')
  const selected = templates.find(template => String(template.id) === selectedId && (!snapshot || template.name === snapshot.name))
  const value = selected ? selectedId : snapshot ? 'snapshot' : ''
  const update = (patch: Record<string, unknown>) => props.onChange({ ...props.node.config, ...patch })
  const parameterValues = (props.node.config.parameterValues ?? {}) as Record<string, unknown>
  return <section className="space-y-3 text-xs">
    <label className="block">查找提示词<input aria-label="查找提示词" value={query} onChange={event => setQuery(event.target.value)} className="mt-1 w-full rounded border border-border bg-bg-base p-2" /></label>
    <label className="block">提示词模板<select aria-label="提示词模板" value={value} onChange={event => {
      const template = templates.find(item => String(item.id) === event.target.value)
      if (template) update({ templateId: String(template.id), promptSnapshot: structuredClone(template), parameterValues: {}, manualValues: {} })
    }} className="mt-1 w-full rounded border border-border bg-bg-base p-2">
      <option value="">请选择提示词</option>
      {snapshot && !selected && <option value="snapshot">{snapshot.name} · 图内保存版本</option>}
      {templates.filter(item => item === selected || `${item.name} ${item.description} ${item.moduleKey}`.toLowerCase().includes(query.toLowerCase())).map(item => <option key={item.id} value={String(item.id)}>{item.name} · {item.scope === 'user' ? '我的模板' : '内置'}</option>)}
    </select></label>
    {error && <p role="alert" className="text-error">提示词加载失败：{error}</p>}
    {snapshot && <>
      <p className="leading-5 text-text-muted">{snapshot.description}。当前图保存选中版本；本次修改不改变全局模板。</p>
      {(snapshot.parameters ?? []).map(parameter => {
        const current = parameterValues[parameter.key] ?? parameter.default
        const set = (next: unknown) => update({ parameterValues: { ...parameterValues, [parameter.key]: next } })
        return <label key={parameter.key} className="block">{parameter.label}
          {parameter.type === 'select' ? <select aria-label={parameter.label} value={String(current)} onChange={event => set(event.target.value)} className="mt-1 w-full rounded border border-border bg-bg-base p-2">{parameter.options?.map(option => <option key={option}>{option}</option>)}</select>
            : parameter.type === 'boolean' ? <input aria-label={parameter.label} type="checkbox" checked={Boolean(current)} onChange={event => set(event.target.checked)} className="ml-2" />
              : <input aria-label={parameter.label} type={parameter.type === 'text' ? 'text' : 'number'} min={parameter.min} max={parameter.max} step={parameter.step} value={String(current)} onChange={event => set(parameter.type === 'text' ? event.target.value : Number(event.target.value))} className="mt-1 w-full rounded border border-border bg-bg-base p-2" />}
        </label>
      })}
      {(snapshot.variableBindings ?? []).filter(binding => binding.manual || binding.required).map(binding => <label key={binding.variable} className="block">{binding.label}{binding.required ? '（必需或使用已绑定资料）' : ''}<textarea aria-label={`提示词变量 ${binding.label}`} value={String((props.node.config.manualValues as Record<string, string> | undefined)?.[binding.variable] ?? '')} onChange={event => update({ manualValues: { ...(props.node.config.manualValues as Record<string, string> | undefined), [binding.variable]: event.target.value } })} className="mt-1 w-full rounded border border-border bg-bg-base p-2" /></label>)}
      <details><summary className="cursor-pointer">查看或调整本节点提示词</summary>
        <label className="mt-2 block">系统提示词<textarea aria-label="节点系统提示词" rows={5} value={snapshot.systemPrompt} onChange={event => update({ promptSnapshot: { ...snapshot, systemPrompt: event.target.value } })} className="mt-1 w-full rounded border border-border bg-bg-base p-2" /></label>
        <label className="mt-2 block">用户提示词<textarea aria-label="节点用户提示词" rows={5} value={snapshot.userPromptTemplate} onChange={event => update({ promptSnapshot: { ...snapshot, userPromptTemplate: event.target.value } })} className="mt-1 w-full rounded border border-border bg-bg-base p-2" /></label>
      </details>
    </>}
    <label className="block">本次补充<textarea aria-label="提示词本次补充" value={String(props.node.config.supplement ?? '')} onChange={event => update({ supplement: event.target.value })} className="mt-1 w-full rounded border border-border bg-bg-base p-2" /></label>
  </section>
}
