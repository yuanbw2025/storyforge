import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProductProductionBriefV3 } from '../../lib/types'
import { parseTtrpgOpenProductionReviewDraftV1 } from '../../lib/ttrpg/open-production-review'
import type { TtrpgOpenProductionReviewOwnerV1 } from '../../lib/ttrpg/open-production-review-service'
import type { TtrpgOpenProductionReviewTaskV1 } from '../../lib/ttrpg/open-production-review'

/** An editor for the existing authorDraftJson, not a second confirmation store. */
export default function TtrpgOpenProductionReview(props: ({ owner: TtrpgOpenProductionReviewOwnerV1; taskKey?: never }
  | { owner?: never; taskKey: TtrpgOpenProductionReviewTaskV1 }) & {
  brief: NonNullable<ProductProductionBriefV3['ttrpgOpen']>
  value: string
  onChange: (text: string) => void
  disabled: boolean
}) {
  const taskKey = props.owner?.taskKey ?? props.taskKey!
  const [reading, setReading] = useState(false), [error, setError] = useState(''), [page, setPage] = useState(0)
  const active = useRef(true), serial = useRef(0), current = useRef(props)
  current.current = props
  useEffect(() => { setError('') }, [props.value])
  useEffect(() => {
    const generation = serial
    active.current = true
    return () => { active.current = false; generation.current++ }
  }, [])
  const parsed = useMemo(() => {
    if (!props.value.trim()) return null
    try { return { draft: parseTtrpgOpenProductionReviewDraftV1(taskKey, props.value, props.brief), error: '' } }
    catch (e) { return { draft: null, error: e instanceof Error ? e.message : String(e) } }
  }, [props.value, taskKey, props.brief])
  const draft = parsed?.draft
  const total = draft?.kind === 'facts' ? draft.artifact.factPolicy.length : draft?.kind === 'rules'
    ? draft.artifact.characterTemplates.reduce((sum, actor) => sum + Object.keys(actor.attributeMappings).length, 0) : 0
  const confirmed = draft?.kind === 'facts' ? draft.artifact.factPolicy.filter(item => item.authorConfirmed).length : draft?.kind === 'rules'
    ? draft.artifact.characterTemplates.reduce((sum, actor) => sum + Object.values(actor.attributeMappings).filter(item => item.authorConfirmed).length, 0) : 0
  const count = draft?.kind === 'facts' ? draft.artifact.factPolicy.length : draft?.artifact.characterTemplates.length ?? 0
  const pageSize = draft?.kind === 'facts' ? 25 : 5, pages = Math.max(1, Math.ceil(count / pageSize)), shownPage = Math.min(page, pages - 1)
  const load = async () => {
    const captured = current.current, token = ++serial.current
    if (!captured.owner) return
    setReading(true); setError('')
    try {
      const { readTtrpgOpenProductionReviewDraftV1 } = await import('../../lib/ttrpg/open-production-review-service')
      const text = await readTtrpgOpenProductionReviewDraftV1(captured.owner)
      if (!active.current || token !== serial.current
        || JSON.stringify(current.current.owner) !== JSON.stringify(captured.owner)) return
      if (current.current.value !== captured.value) throw new Error('读取期间修订稿已变化，保留你的修改；需要时可清空后重新读取。')
      captured.onChange(text); setPage(0)
    } catch (e) {
      if (active.current && token === serial.current) setError(e instanceof Error ? e.message : String(e))
    } finally { if (active.current && token === serial.current) setReading(false) }
  }
  const checkboxClass = 'mr-2 accent-accent'
  const cardClass = 'rounded border border-border bg-bg-base p-3'
  return <section className="mt-4 rounded border border-accent/40 bg-accent/5 p-4 text-xs text-text-primary" data-testid="ttrpg-open-production-review">
    <h3 className="font-semibold">{taskKey === 'ttrpg.open.source-facts' ? '核对来源事实' : '核对角色属性'}</h3>
    <p className="my-2 leading-5 text-text-muted">逐项查看本任务的待确认稿。勾选只修改本页修订稿；点击下方“修正后继续制作”才提交。未提交的选择刷新后需要重新核对。</p>
    {props.owner && !props.value.trim() && <button type="button" className="rounded border border-accent/40 px-3 py-2" disabled={props.disabled || reading} onClick={() => { void load() }}>
      {reading ? '正在读取原稿…' : '读取本任务待审稿'}
    </button>}
    {parsed?.error && <p role="alert" className="my-2 text-error">当前修订稿尚不能逐项显示：{parsed.error}。请在下方高级修订中补齐；原记录保持不变。</p>}
    {draft && <>
      <p className="my-3" role="status">已确认 {confirmed}/{total} 项。需修改内容或来源时，可编辑下方已填好的高级修订稿。</p>
      <fieldset disabled={props.disabled || reading} className="grid gap-3">
        {draft.kind === 'facts' ? draft.artifact.factPolicy.slice(shownPage * pageSize, (shownPage + 1) * pageSize).map(item => <article key={item.fact.factKey} className={cardClass}>
          <label className="block font-medium"><input type="checkbox" className={checkboxClass} checked={item.authorConfirmed}
            onChange={event => {
              const artifact = structuredClone(draft.artifact)
              artifact.factPolicy.find(row => row.fact.factKey === item.fact.factKey)!.authorConfirmed = event.target.checked
              props.onChange(JSON.stringify(artifact))
            }} />我确认事实 {item.fact.factKey}</label>
          <p className="mt-2 break-words leading-5">{item.fact.subjectRef} · {item.fact.predicateKey} · {item.fact.objectRef ?? '—'}：{JSON.stringify(item.fact.canonicalValue)}</p>
          <p className="mt-1 text-text-muted">{item.fact.authority === 'invariant' ? '世界不变量' : '开局状态'} · {item.fact.owner} · 可见范围 {item.fact.audience}</p>
          {!!item.fact.knownByActorKeys.length && <p className="mt-1 break-words text-text-muted">知情角色：{item.fact.knownByActorKeys.join('、')}</p>}
          <details className="mt-2"><summary className="cursor-pointer">来源字段与原版本</summary>
            {item.fact.sourceFieldRefs.map((ref, index) => <p key={index} className="mt-2 break-all font-mono text-[10px]">{ref.resourceKey} · {ref.fieldPath}<br />{ref.contentHash}</p>)}
            {!item.fact.sourceFieldRefs.length && <p>本事实没有世界字段引用，请核对作者私域依据。</p>}
          </details>
        </article>) : draft.artifact.characterTemplates.slice(shownPage * pageSize, (shownPage + 1) * pageSize).map(actor => <article key={actor.characterKey} className={cardClass}>
          <h4 className="font-semibold">{actor.name}</h4><p className="my-2 break-words text-text-muted">{actor.characterKey} · {actor.role === 'player' ? '玩家角色' : 'NPC'} · {actor.controller} · 席位 {actor.seatKey ?? '—'}</p>
          {Object.entries(actor.attributeMappings).map(([key, mapping]) => <div key={key} className="mt-2 rounded bg-bg-elevated p-3">
            <label className="block"><input type="checkbox" className={checkboxClass} checked={mapping.authorConfirmed}
              onChange={event => {
                const artifact = structuredClone(draft.artifact)
                artifact.characterTemplates.find(row => row.characterKey === actor.characterKey)!.attributeMappings[key].authorConfirmed = event.target.checked
                props.onChange(JSON.stringify(artifact))
              }} />我确认 {actor.name} 的 {props.brief.rulePack.attributes.find(attr => attr.key === key)?.name ?? key} 映射：{mapping.value}</label>
            <p className="mt-2 whitespace-pre-wrap leading-5">{mapping.derivationRule}</p><p className="mt-1 break-words text-text-muted">依据：{mapping.sourceRefs.join('、') || '未列来源，请先检查'}</p>
          </div>)}
          <details className="mt-3"><summary className="cursor-pointer">完整角色卡与作者资料</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(actor, null, 2)}</pre></details>
        </article>)}
      </fieldset>
      {pages > 1 && <div className="mt-3 flex items-center gap-3"><button type="button" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>上一页</button><span>{shownPage + 1}/{pages}</span><button type="button" disabled={shownPage + 1 === pages} onClick={() => setPage(shownPage + 1)}>下一页</button></div>}
    </>}
    {error && <p role="alert" className="mt-3 text-error">{error}</p>}
  </section>
}
