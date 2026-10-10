import { useState } from 'react'
import type { ExtensionContext, Json } from '@storyforge/plugin-sdk'
export default { activate(ctx: ExtensionContext) {
  function Research() {
    const [query, setQuery] = useState(''), [results, setResults] = useState<{title:string;url:string}[]>([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
    async function search() { setBusy(true); setMessage(''); try { const response: Json = await ctx.network.fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&limit=6&search=${encodeURIComponent(query)}`); if (!Array.isArray(response) || !Array.isArray(response[1]) || !Array.isArray(response[3])) throw new Error('资料接口返回了不兼容的结果'); const names=response[1],links=response[3]; setResults(names.flatMap((name,index)=> typeof name==='string' && typeof links[index]==='string' && links[index].startsWith('https://en.wikipedia.org/') ? [{title:name,url:links[index]}] : [])) } catch(e) { setMessage(String(e)) } finally { setBusy(false) } }
    async function save(title:string,url:string) { try { await ctx.data.put({key:`ref_${Date.now()}`,schemaId:'note',payload:{text:`${title}\n${url}`},expectedRevision:null});setMessage('链接已保存到本作品的插件内容中。') } catch(e) { setMessage(String(e)) } }
    return <section><h3>给故事找到可追溯的资料</h3><p>搜索词会发送到 Wikipedia 公开接口；作品正文不会被发送。</p><input aria-label="检索资料关键词" value={query} onChange={e=>setQuery(e.target.value)} placeholder="例如 lighthouse 或 maritime history"/><button disabled={busy || !query.trim()} onClick={()=>void search()}>{busy?'检索中…':'查询公开资料'}</button><div className="sf-extension-grid">{results.map(row=><article key={row.url}><h4>{row.title}</h4><p><a href={row.url} target="_blank" rel="noreferrer">阅读来源</a></p><button onClick={()=>void save(row.title,row.url)}>保存资料链接</button></article>)}</div><p role="status">{message}</p></section>
  }
  ctx.ui.registerView('research',Research)
} }
