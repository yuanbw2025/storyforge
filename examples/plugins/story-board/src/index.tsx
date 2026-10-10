import { useEffect, useState } from 'react'
import type { ExtensionContext, HistoryEntry } from '@storyforge/plugin-sdk'
export default { activate(ctx: ExtensionContext) {
  function Board() {
    const [rows, setRows] = useState<HistoryEntry[]>([]), [error, setError] = useState('')
    useEffect(() => { ctx.domain.history.list().then(setRows).catch(e => setError(String(e))) }, [])
    return <section><div className="sf-extension-actions"><h3>把故事的转折放在眼前</h3><button onClick={() => ctx.ai.openReview('timeline', '从已确认的正文提取时间线；请在宿主面板开始生成，并逐条确认。')}>从正文提取并确认</button></div><div className="sf-extension-grid">{rows.map((row, index) => <article key={row.id}><small>事件 {index + 1} · {row.time || '时间未定'}</small><h4>{row.title}</h4><p>{row.description}</p></article>)}</div>{!rows.length && <p>尚无故事事件。可以打开正式时间线新增事件，或从已写正文提取。</p>}{error && <p role="alert">{error}</p>}</section>
  }
  ctx.ui.registerView('board', Board)
} }
