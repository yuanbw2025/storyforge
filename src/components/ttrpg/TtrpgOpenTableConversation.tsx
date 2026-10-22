import { useCallback,useEffect,useRef,useState } from 'react'
import { readTtrpgOpenTableConversationV1,sendTtrpgOpenTableMessageV1,type TtrpgOpenTableInputV1 } from '../../lib/ttrpg/open-table-service'
type Page = Awaited<ReturnType<typeof readTtrpgOpenTableConversationV1>>
export default function TtrpgOpenTableConversation(props: {
  input: TtrpgOpenTableInputV1; sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void>;
}) {
  const [page,setPage] = useState<Page | null>(null),[error,setError] = useState(''),[text,setText] = useState(''),[reply,setReply] = useState<string | null>(null)
  const [kind,setKind] = useState<'out-of-character' | 'rules-question'>('out-of-character'),[audience,setAudience] = useState<'party' | 'host-private'>('party'),[saved,setSaved] = useState('')
  const live = useRef(true),generation = useRef(0),submission = useRef(crypto.randomUUID())
  const { sessionId,viewerKey,scope } = props.input,{ projectId,worldId,workId } = scope
  const load = useCallback(async (beforeMessageKey?: string) => {
    const token = ++generation.current
    try {
      const value = await readTtrpgOpenTableConversationV1({ scope: { projectId,worldId,workId },sessionId,viewerKey,beforeMessageKey })
      if (live.current && generation.current === token) { setPage(value);setError('') }
    } catch (e) { if (live.current && generation.current === token) { setPage(null);setError(e instanceof Error ? e.message : String(e)) } }
  },[sessionId,viewerKey,projectId,worldId,workId])
  useEffect(() => { live.current = true;setPage(null);void load();return () => { live.current = false;generation.current += 1 } },[load,props.sequence])
  const reset = () => { setText('');setReply(null);setSaved('');submission.current = crypto.randomUUID() }
  return <details className="sf-open-table-card" data-testid="ttrpg-open-table-conversation"><summary>本桌讨论与规则询问</summary>
    <p>这些文字不推进冒险时间。主持的规则答复供讨论参考，实际行动仍按冻结规则确认。</p>
    {error && <p role="alert">{error}</p>}{saved && <p role="status">讨论已保存。</p>}
    <button disabled={props.busy} onClick={() => void load()}>读取最新讨论</button>
    {page?.earlierCursor && <button disabled={props.busy} onClick={() => void load(page.earlierCursor!)}>查看更早讨论</button>}
    <section aria-label="当前身份可见的本桌讨论">{page?.messages.map(m => <article key={m.key}>
      <p><strong>{m.authorName}</strong> · {m.kind === 'rules-question' ? '规则询问' : m.kind === 'rules-answer' ? '主持答复' : '桌外讨论'} · {m.audience === 'party' ? '本次全队' : '私密：提问者与主持'}</p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{m.text}</p>
      {m.canReply && <button disabled={props.busy} onClick={() => { reset();setReply(m.key) }}>回复这个规则问题</button>}
    </article>)}</section>
    {page && <fieldset disabled={props.busy}><legend>{reply ? '回复原规则问题' : '写一条讨论'}</legend>
      {reply ? <p>答复沿用原问题的可见范围。</p> : <><label>讨论类型<select aria-label="讨论类型" value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="out-of-character">桌外讨论</option><option value="rules-question">规则询问</option></select></label>
        <label>讨论可见范围<select aria-label="讨论可见范围" value={audience} onChange={e => setAudience(e.target.value as typeof audience)}><option value="party">发送给本次全队</option><option value="host-private">仅提问者与真人主持可见</option></select></label></>}
      <label>讨论内容<textarea aria-label="讨论内容" maxLength={10000} value={text} onChange={e => setText(e.target.value)} /></label>
      <button disabled={!text.trim()} onClick={() => void props.perform(async () => {
        const result = await sendTtrpgOpenTableMessageV1({ ...props.input,submissionKey: submission.current,request: reply ? { kind: 'rules-answer',questionKey: reply,text } : { kind,audience,text } })
        if (live.current) { reset();setSaved(result.messageKey);await load() }
      })}>{reply ? '保存主持答复' : '发送讨论'}</button>
      <button onClick={reset}>另写一条</button>
    </fieldset>}
  </details>
}
