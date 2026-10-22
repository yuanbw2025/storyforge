import { useEffect,useRef,useState } from 'react'
import { readTtrpgOpenTablePrivateChoicesV1,prepareTtrpgOpenTablePrivateChoiceV1,discloseTtrpgOpenTablePrivateChoiceV1,type TtrpgOpenTableInputV1 } from '../../lib/ttrpg/open-table-service'
type Review = Awaited<ReturnType<typeof prepareTtrpgOpenTablePrivateChoiceV1>>
export default function TtrpgOpenPrivateChoicePanel(props: {
  input: TtrpgOpenTableInputV1; operationKey: string; sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void>
}) {
  const [accepted,setAccepted] = useState(false),[choices,setChoices] = useState<Awaited<ReturnType<typeof readTtrpgOpenTablePrivateChoicesV1>> | null>(null),[review,setReview] = useState<Review | null>(null)
  const live = useRef(true),generation = useRef(0),{ sessionId,viewerKey,scope } = props.input
  useEffect(() => { live.current = true;generation.current += 1;setAccepted(false);setChoices(null);setReview(null);return () => { live.current = false;generation.current += 1 } },[sessionId,viewerKey,scope.projectId,scope.worldId,scope.workId,props.operationKey,props.sequence])
  const read = async () => {
    const token = generation.current
    await props.perform(async () => { const value = await readTtrpgOpenTablePrivateChoicesV1(props.input);if (live.current && token === generation.current) setChoices(value) })
  }
  return <section className="sf-open-table-card" aria-label="保密后果主持告知"><h3>保密后果的知情选择</h3>
    <p>主持先核对实际后果，只告知玩家需要承担的必要代价；保密骰点与主持理由不会随告知公开。</p>
    {!choices && <><label><input type="checkbox" checked={accepted} disabled={props.busy} onChange={e => setAccepted(e.target.checked)} />我以主持身份查看本次保密后果。</label><button disabled={props.busy || !accepted} onClick={() => void read()}>读取需要告知的后果</button></>}
    {choices?.length === 0 && <p>当前没有等待告知的后果选项。</p>}
    {choices?.map(c => <div key={`${c.kind}:${c.templateKey}`}>{c.disclosed ? <p>本次必要后果已告知，等待有权确认的人亲自选择。</p> : <button disabled={props.busy} onClick={() => void props.perform(async () => {
      const token = generation.current,value = await prepareTtrpgOpenTablePrivateChoiceV1({ ...props.input,...c })
      if (live.current && token === generation.current) setReview(value)
    })}>核对将向玩家告知的代价</button>}</div>)}
    {review && <fieldset disabled={props.busy}><legend>将向{review.actorName}告知</legend>{review.alternatives.map(a => <div key={a.alternativeKey}><p>{a.title}</p>{a.lines.map((s,i) => <p key={i}>{s}</p>)}</div>)}
      <p>这里只告知必要后果，不会代替玩家选择，也不会执行费用或重掷骰子。</p>
      <button onClick={() => void props.perform(async () => { await discloseTtrpgOpenTablePrivateChoiceV1({ ...props.input,operationKey: props.operationKey,kind: review.kind,templateKey: review.templateKey,reviewHash: review.reviewHash });setReview(null) })}>确认告知，交由本人选择</button>
    </fieldset>}
  </section>
}
