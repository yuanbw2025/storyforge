import { useEffect, useState } from 'react'
import type { ExtensionContext, HistoryEntry } from '@storyforge/plugin-sdk'
export default { activate(ctx: ExtensionContext) {
  function Timeline() {
    const [rows, setRows] = useState<HistoryEntry[]>([]), [search, setSearch] = useState(''), [title, setTitle] = useState(''), [time, setTime] = useState(''), [description, setDescription] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
    async function load() { const entries = await ctx.domain.history.list(); setRows(await Promise.all(entries.map(async row => ({ ...row, time: String(await ctx.services.call('storyforge.calendar.format', 'format', row.time)) })))) }
    useEffect(() => { void load().catch(e => setError(String(e))) }, [])
    async function add() { setBusy(true); try { await ctx.domain.history.create({ title, time, description }); setTitle(''); setDescription(''); await load() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
    return <section><header className="sf-extension-actions"><div><small>WORLD CHRONICLE</small><h3>世界的时间，正在展开</h3></div><button onClick={() => ctx.ai.openReview('history', '在正式历史面板中选择条目，进行考据、发散和确认。')}>历史 AI 与确认</button></header><input aria-label="搜索插件历史" placeholder="寻找人物、事件或时代" value={search} onChange={e => setSearch(e.target.value)}/><div className="sf-extension-grid">{rows.filter(row => `${row.title} ${row.description} ${row.time}`.includes(search)).map(row => <article key={row.id}><small>{row.time || '时间待定'}</small><h4>{row.title}</h4><p>{row.description}</p></article>)}</div>{!rows.length && <p>还没有历史事件。从世界的第一个转折开始。</p>}<details><summary>新增历史事件</summary><label>事件名称<input value={title} maxLength={200} onChange={e => setTitle(e.target.value)}/></label><label>年份或时间<input value={time} maxLength={200} onChange={e => setTime(e.target.value)}/></label><label>事件内容<textarea value={description} maxLength={20000} onChange={e => setDescription(e.target.value)}/></label><button disabled={busy || !title.trim()} onClick={() => void add()}>保存历史事件</button></details>{error && <p role="alert">{error}</p>}</section>
  }
  ctx.ui.registerView('timeline', Timeline)
} }
