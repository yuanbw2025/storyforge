import { useEffect, useState } from 'react'
import type { ExtensionContext, ExtensionRecord } from '@storyforge/plugin-sdk'
export default {
  activate(ctx: ExtensionContext) {
    function Notes() {
      const [text, setText] = useState(''), [record, setRecord] = useState<ExtensionRecord | undefined>(), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false)
      useEffect(() => { let active = true; ctx.data.list('note').then(rows => { if (active) { setRecord(rows[0]); setText(String((rows[0]?.payload as { text?: string })?.text ?? '')); setReady(true) } }).catch(e => active && setMessage(String(e))); return () => { active = false } }, [])
      async function save() { setBusy(true); try { const row = await ctx.data.put({ key: 'main', schemaId: 'note', payload: { text }, expectedRevision: record?.revision ?? null }); setRecord(row); setMessage('已保存到这部作品。') } catch (e) { setMessage(String(e)) } finally { setBusy(false) } }
      return <section><h3>留住一闪而过的念头</h3><p>这份便笺只属于当前作品，随完整备份保存。</p><textarea aria-label="插件创作便笺" disabled={!ready || busy} value={text} maxLength={20000} rows={8} onChange={e => setText(e.target.value)} placeholder="人物的一句台词、下一章的冲突、忽然想到的结尾……"/><div className="sf-extension-actions"><button onClick={() => void save()} disabled={busy || !ready}>{busy ? '保存中…' : '保存便笺'}</button><span role="status">{message}</span></div></section>
    }
    ctx.ui.registerView('notes', Notes)
  },
}
