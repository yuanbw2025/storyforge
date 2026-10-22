import { useCallback, useEffect, useRef, useState } from 'react'
import { readTtrpgOpenIdentityKnowledgeDeskV1, prepareTtrpgOpenIdentityKnowledgeV1, confirmTtrpgOpenIdentityKnowledgeReviewV1,
  type TtrpgOpenIdentityKnowledgeDeskInputV1, type TtrpgOpenIdentityKnowledgeDeskV1, type TtrpgOpenIdentityKnowledgeReviewV1 } from '../../lib/ttrpg/open-identity-knowledge-service'

export default function TtrpgOpenIdentityKnowledgePanel(props: { input: TtrpgOpenIdentityKnowledgeDeskInputV1; sequence: number; busy: boolean; onChanged: () => Promise<void> }) {
  const { scope: { projectId, worldId, workId }, sessionId, viewerKey } = props.input
  const identity = `${projectId}:${worldId}:${workId}:${sessionId}:${viewerKey}`, current = useRef({ identity })
  if (current.current.identity !== identity) current.current = { identity }
  const [page, setPage] = useState<{ visit: object; value: TtrpgOpenIdentityKnowledgeDeskV1 } | null>(null)
  const [pending, setPending] = useState<{ visit: object; sequence: number; value: TtrpgOpenIdentityKnowledgeReviewV1 } | null>(null)
  const [mode, setMode] = useState<'observation' | 'share'>('observation'), [source, setSource] = useState(''), [refs, setRefs] = useState<string[]>([]), [recipients, setRecipients] = useState<string[]>([])
  const [agreed, setAgreed] = useState(false), [working, setWorking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const live = useRef(false), revision = useRef(0), locked = useRef(false), visit = current.current
  const input = useCallback(() => ({ scope: { projectId, worldId, workId }, sessionId, viewerKey }), [projectId, worldId, workId, sessionId, viewerKey])
  const refresh = useCallback(async () => {
    const owner = visit, token = ++revision.current
    if (current.current !== owner) return
    try { const value = await readTtrpgOpenIdentityKnowledgeDeskV1(input()); if (live.current && current.current === owner && revision.current === token) setPage({ visit: owner, value }) }
    catch { if (live.current && current.current === owner && revision.current === token) { setPage(null); setError('知识暂不可读取，请重新读取或核对原存档。') } }
  }, [input, visit])
  useEffect(() => {
    live.current = true; locked.current = false; setPage(null); setPending(null); setMode('observation'); setSource(''); setRefs([]); setRecipients([]); setAgreed(false); setWorking(false); setError(''); setNotice('')
    return () => { live.current = false }
  }, [identity])
  useEffect(() => { void refresh() }, [refresh, props.sequence])
  const view = page?.visit === visit && page.value.sequence === props.sequence ? page.value : null, review = pending?.visit === visit && pending.sequence === props.sequence ? pending.value : null
  const root = view?.roots.find(row => row.knowledgeKey === source), shared = view?.shareSources.find(row => `${row.knowledgeKey}:${row.actorKey}` === source)
  const choices = mode === 'share' ? shared?.identities ?? [] : view?.instances ?? []
  const receivers = view?.players.filter(row => mode === 'share' || root?.observerActorKeys.includes(row.actorKey)) ?? []
  const disabled = props.busy || working, reset = () => { setPending(null); setAgreed(false); setError(''); setNotice('') }
  const toggle = (values: string[], key: string) => values.includes(key) ? values.filter(value => value !== key) : [...values, key]
  const act = async (job: () => Promise<void>) => {
    if (locked.current || current.current !== visit) return
    locked.current = true; setWorking(true); setError(''); setNotice('')
    try { await job() } catch (cause) { if (live.current && current.current === visit) setError(cause instanceof Error ? cause.message : '本次核对失败，请重新读取。') }
    finally { if (live.current && current.current === visit) { locked.current = false; setWorking(false) } }
  }
  return <section className="space-y-3 rounded border p-3" aria-label="观察与身份知识" data-testid="ttrpg-open-identity-knowledge-panel">
    <h3 className="font-medium">观察与身份知识</h3>
    <p className="text-sm">核对实际观察识别了谁；分享给他人时保留转述标记。名称不代表装备、位置或能力权限。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button disabled={disabled} onClick={() => { setError(''); void refresh() }}>重新读取身份知识</button>
    {view && <><ul>{view.learned.map((row, index) => <li key={index}>{row.name} · {row.reliability === 'observed' ? '观察所得' : row.reliability === 'hearsay' ? '转述' : '信念'} · {row.evidence}</li>)}</ul>
      {!view.canReview && <p>本次本人窗口内，完成原结算和待办后可核对或分享知识。知识读取不推进游戏。</p>}
      {view.canReview && !review && <fieldset disabled={disabled} className="space-y-2">
        <label>操作<select aria-label="身份知识操作" value={mode} onChange={event => { setMode(event.target.value as typeof mode); setSource(''); setRefs([]); setRecipients([]); reset() }}><option value="observation">核对原观察</option><option value="share">明确分享</option></select></label>
        <label>原知识<select aria-label="原知识" value={source} onChange={event => { setSource(event.target.value); setRefs([]); setRecipients([]); reset() }}><option value="">请选择原记录</option>
          {mode === 'observation' ? view.roots.map(row => <option key={row.knowledgeKey} value={row.knowledgeKey}>{row.title}</option>) : view.shareSources.map(row => <option key={`${row.knowledgeKey}:${row.actorKey}`} value={`${row.knowledgeKey}:${row.actorKey}`}>{row.actorName}：{row.title} · {row.reliability === 'observed' ? '本人观察' : '转述'}</option>)}
        </select></label>
        {(root || shared) && <p className="whitespace-pre-wrap">{(mode === 'observation' ? root : shared)?.description}</p>}
        <div>本次明确识别的对象{choices.map(row => <label key={row.entityRef} className="block"><input type="checkbox" checked={refs.includes(row.entityRef)} onChange={() => { setRefs(toggle(refs, row.entityRef)); reset() }} />{row.name}</label>)}</div>
        <div>指定接收角色{receivers.map(row => <label key={row.actorKey} className="block"><input type="checkbox" checked={recipients.includes(row.actorKey)} onChange={() => { setRecipients(toggle(recipients, row.actorKey)); reset() }} />{row.name}</label>)}</div>
        <button disabled={!source || refs.length === 0 || recipients.length === 0} onClick={() => void act(async () => {
          const value = await prepareTtrpgOpenIdentityKnowledgeV1({ ...input(), submissionKey: crypto.randomUUID(), request: { mode, actorKey: mode === 'share' ? shared!.actorKey : view.humanGm ? null : view.actorKey,
            sourceKnowledgeKey: mode === 'share' ? shared!.knowledgeKey : source, entityRefs: refs, audience: 'private', recipientActorKeys: recipients } })
          if (live.current && current.current === visit) { setPending({ visit, sequence: props.sequence, value }); setAgreed(false) }
        })}>核对这次内容与接收者</button>
      </fieldset>}
    </>}
    {review && <div className="space-y-2" aria-label="身份知识确认" data-testid="ttrpg-open-identity-knowledge-review">
      <p>{review.evidence.title}：{review.evidence.description}</p><p>对象：{review.identities.map(row => row.name).join('、')}</p><p>指定接收者：{review.recipients.join('、')}；{review.mode === 'share' ? '按转述保存' : '绑定原实际观察'}</p>
      <label><input type="checkbox" disabled={disabled} checked={agreed} onChange={event => setAgreed(event.target.checked)} />我已核对这次身份、原观察与接收者</label>
      <button disabled={disabled || !agreed} onClick={() => void act(async () => {
        await confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...input(), review, decision: 'confirm-these-identities-and-recipients' })
        if (live.current && current.current === visit) { setPending(null); setAgreed(false); setNotice('知识已保存，原实例范围与机械状态保持原记录。'); await props.onChanged(); await refresh() }
      })}>明确保存这次知识</button>
      <button disabled={disabled} onClick={() => { setPending(null); setAgreed(false) }}>返回重选</button>
    </div>}
  </section>
}
