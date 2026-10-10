import { useEffect, useState } from 'react'
import type { ExtensionContext, ExtensionRecord } from '@storyforge/plugin-sdk'
export default { activate(ctx: ExtensionContext) {
  function Ideas() {
    const [rows,setRows]=useState<ExtensionRecord[]>([]),[error,setError]=useState('')
    async function load(){try{setRows(await ctx.data.list('idea'));setError('')}catch(e){setError(String(e))}}
    useEffect(()=>{void load()},[])
    return <section><h3>从一个选择开始</h3><p>提出要求后，在熔炉 AI 面板确认生成。结果先保留为可编辑候选。</p><button onClick={()=>ctx.ai.propose('brainstorm',`idea_${Date.now()}`,'让人物通过主动选择改变局面。')}>构思一张新卡片</button><button onClick={()=>void load()}>刷新已确认卡片</button>{error&&<p role="alert">{error}</p>}{rows.map(row=>{const idea=row.payload as {title:string;premise:string;turn:string};return <article key={row.key}><h4>{idea.title}</h4><p>{idea.premise}</p><p>{idea.turn}</p></article>})}</section>
  }
  ctx.ui.registerView('ideas',Ideas)
} }
