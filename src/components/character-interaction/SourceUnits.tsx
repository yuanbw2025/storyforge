import {useEffect, useRef, useState} from 'react'
import type {WorkspaceScope} from '../../lib/types'
import {useAIConfigStore} from '../../stores/ai-config'
import {isAIConfigReady} from '../../lib/ai/config-readiness'
import {chatProjectionResourcesV1, type ChatSourceProjectionDraftV1} from '../../lib/character-interaction/source-projection'
import type {ChatSourceReviewRequestV1, ChatSourceReviewContextV1} from '../../lib/character-interaction/source-review-context'
import {sameChatSourceUnitsCandidateV1, type ChatSourceUnitsCandidateV1, type ChatSourceUnitV1} from '../../lib/character-interaction/source-units'
import {generateChatSourceUnitsV1, reviewChatSourceUnitsV1, readLatestChatSourceUnitsRunV1, readLatestChatSourceUnitsReviewRunV1,
  recoverChatSourceUnitsRunV1, recoverChatSourceUnitsReviewRunV1, cancelChatSourceUnitsRunV1, cancelChatSourceUnitsReviewRunV1,
  type ChatSourceUnitsRunViewV1, type ChatSourceUnitsReviewRunViewV1} from '../../lib/character-interaction/source-units-harness'
import SourceRunFailure from './SourceRunFailure'
import SourceUnitConfirmation from './SourceUnitConfirmation'
import {readLatestChatSourceUnitConfirmationRunV1} from '../../lib/character-interaction/source-unit-confirmation-harness'
import type {ChatAuthoringDraftV1, ChatAuthoringSettingsV3} from '../../lib/character-interaction/authoring-contract'

const pending = (view: ChatSourceUnitsRunViewV1 | ChatSourceUnitsReviewRunViewV1 | null) => view?.status === 'unknown' || view?.status === 'pending'
export default function SourceUnits(props: {scope: WorkspaceScope; revision: number; projection: ChatSourceProjectionDraftV1; selectedKeys: string[]; disabled: boolean;
  draft: ChatAuthoringDraftV1; settings: ChatAuthoringSettingsV3; onConfirmed: () => void}) {
  const config = useAIConfigStore(state => state.config)
  const [generation, setGeneration] = useState<ChatSourceUnitsRunViewV1 | null>(null)
  const [review, setReview] = useState<ChatSourceUnitsReviewRunViewV1 | null>(null)
  const [candidate, setCandidate] = useState<ChatSourceUnitsCandidateV1 | null>(null)
  const [source, setSource] = useState<ChatSourceReviewRequestV1 | null>(null)
  const [retainedContext, setRetainedContext] = useState<ChatSourceReviewContextV1 | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const epoch = useRef({value: 0}).current
  const {projectId, worldId, workId} = props.scope, {projectionHash} = props.projection
  useEffect(() => {
    const ticket = ++epoch.value
    setGeneration(null); setReview(null); setCandidate(null); setSource(null); setRetainedContext(null); setBusy(false); setError('')
    void Promise.all([readLatestChatSourceUnitsRunV1({projectId, worldId, workId}), readLatestChatSourceUnitsReviewRunV1({projectId, worldId, workId}), readLatestChatSourceUnitConfirmationRunV1({projectId, worldId, workId})])
      .then(([generated, reviewed, confirmation]) => {
        if (ticket !== epoch.value) return
        setGeneration(generated); setReview(reviewed)
        const newest = [generated?.context && {runId: generated.runId, context: generated.context, candidate: generated.result?.candidate},
          reviewed?.context && {runId: reviewed.runId, context: reviewed.context.source, candidate: reviewed.context.candidate},
          confirmation?.context && {runId: confirmation.runId, context: confirmation.context.source, candidate: confirmation.context.candidate}]
          .filter((row): row is NonNullable<typeof row> => !!row).sort((a, b) => b.runId - a.runId)[0]
        const context = newest?.context, saved = newest?.candidate
        if (context && saved) {
          setCandidate(saved); setRetainedContext(context); setSource({draftRevision: context.draftRevision, projectionHash: context.projectionHash, fragmentKeys: context.fragments.map(row => row.fragmentKey)})
        }
      }).catch(cause => {if (ticket === epoch.value) setError(String(cause instanceof Error ? cause.message : cause))})
    return () => {epoch.value++}
  }, [epoch, projectId, worldId, workId, props.revision, projectionHash])
  const act = async (action: (ticket: number) => Promise<unknown>) => {
    const ticket = ++epoch.value; setBusy(true); setError('')
    try {await action(ticket)} catch (cause) {if (ticket === epoch.value) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {
      if (ticket === epoch.value) {
        try {
          const [generated, reviewed] = await Promise.all([readLatestChatSourceUnitsRunV1(props.scope), readLatestChatSourceUnitsReviewRunV1(props.scope)])
          if (ticket === epoch.value) {setGeneration(generated); setReview(reviewed)}
        } catch (cause) {if (ticket === epoch.value) setError(cause instanceof Error ? cause.message : String(cause))}
        if (ticket === epoch.value) setBusy(false)
      }
    }
  }
  const request = (): ChatSourceReviewRequestV1 => ({draftRevision: props.revision, projectionHash, fragmentKeys: [...props.selectedKeys]})
  const disabled = props.disabled || busy
  const selected = props.selectedKeys.length > 0 && props.selectedKeys.length <= 12
  const stale = !source || source.draftRevision !== props.revision || source.projectionHash !== projectionHash
  const matchesReview = review?.status === 'ready' && !stale && sameChatSourceUnitsCandidateV1(candidate, review.context?.candidate)
  const resources = chatProjectionResourcesV1(props.projection)
  const retainedSource = [retainedContext, review?.context?.source, generation?.context].find(context => context?.projectionHash === source?.projectionHash && context?.draftRevision === source?.draftRevision)
  const change = (fragmentKey: string, kind: 'facts' | 'constraints', items: ChatSourceUnitV1[]) => setCandidate(previous => previous && ({fragments: previous.fragments.map(row => row.fragmentKey === fragmentKey ? {...row, [kind]: items} : row)}))
  return <section aria-label="事实拆分与复核" className="space-y-3 rounded border border-border p-3">
    <h5>事实拆分与复核 · 实验</h5>
    <p>把位置、经手者、用途等整理为可分别验证的事实。完整原文始终保留；未来安排、初始未知和其他限制须单独列出。</p>
    <p>候选不会自动进入聊天。须在下方设置逐项知情范围，复核并明确确认后才用于新制作。编辑后须重新复核；未提交复核的手工修改刷新后会丢失。</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="lf-action" disabled={disabled || !selected || pending(generation) || pending(review) || !isAIConfigReady(config)} onClick={() => void act(async ticket => {
        const selectedSource = request(), view = await generateChatSourceUnitsV1({scope: props.scope, request: selectedSource, config})
        if (ticket === epoch.value && view.result?.candidate) {setCandidate(view.result.candidate); setRetainedContext(view.context); setSource(selectedSource)}
      })}>整理所选原文的事实</button>
      <button type="button" className="lf-action" disabled={disabled || !selected || pending(generation) || pending(review)} onClick={() => {
        const selectedSource = request(); setSource(selectedSource); setCandidate({fragments: selectedSource.fragmentKeys.map(fragmentKey => ({fragmentKey, facts: [], constraints: []}))})
      }}>手动整理所选原文</button>
    </div>
    {!isAIConfigReady(config) && <p>配置全局 AI 后可生成候选和独立复核。</p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    {([{view: generation, label: '事实整理', recover: recoverChatSourceUnitsRunV1, cancel: cancelChatSourceUnitsRunV1},
      {view: review, label: '独立复核', recover: recoverChatSourceUnitsReviewRunV1, cancel: cancelChatSourceUnitsReviewRunV1}] as const).map(({view, label, recover, cancel}) => view && <div key={label}>
      {pending(view) && <>
        <p>{label}尚未结束。结果未知时不会自动重发；已留存的回复可恢复。</p>
        <button type="button" className="lf-action" disabled={disabled} onClick={() => void act(async ticket => {
          const restored = await recover(props.scope, view.runId)
          if (ticket === epoch.value && 'candidate' in (restored.result ?? {}) && restored.context && 'fragments' in restored.context) {
            const generated = restored as ChatSourceUnitsRunViewV1
            if (generated.result?.candidate && generated.context) {
              setCandidate(generated.result.candidate); setRetainedContext(generated.context); setSource({draftRevision: generated.context.draftRevision, projectionHash: generated.context.projectionHash, fragmentKeys: generated.context.fragments.map(row => row.fragmentKey)})
            }
          }
        })}>恢复{label}记录</button>
        <button type="button" className="lf-action" disabled={disabled} onClick={() => void act(() => cancel(props.scope, view.runId))}>结束这次{label}</button>
        <button type="button" className="lf-action" disabled={disabled} onClick={() => void act(async () => undefined)}>查看{label}最新结果</button>
      </>}
      {view.status === 'cancelled' && <p>{label}已结束，没有自动重发。</p>}
      {view.status === 'stale' && <p>{label}依据的方案或来源已变化，历史结果不能用于当前方案。</p>}
      {view.failure && <SourceRunFailure failure={view.failure} pending={view.status === 'pending'}/>}
      {view.status === 'blocked' && <p className="text-danger">{label}未完成有效结果，请检查原始错误后再明确发起新请求。</p>}
      {view.result?.artifact.issues.map(issue => <p key={issue.code}>{label}：{issue.message}</p>)}
    </div>)}
    {candidate && <div data-testid="chat-source-units-candidate" className="space-y-3">
      {candidate.fragments.map(fragment => {
        const resource = resources.find(row => row.fragments.some(item => item.fragmentKey === fragment.fragmentKey))
        const original = stale ? retainedSource?.fragments.find(row => row.fragmentKey === fragment.fragmentKey) : resource?.fragments.find(row => row.fragmentKey === fragment.fragmentKey)
        return <article key={fragment.fragmentKey} className="space-y-2 rounded bg-bg-base p-3">
          <strong>{resource?.label ?? '历史资料'} · 原文与整理</strong>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{original ? JSON.stringify(JSON.parse(original.valueJson), null, 2) : '来源已变化，请查看历史运行记录。'}</pre>
          {(['facts', 'constraints'] as const).map(kind => <fieldset key={kind} className="space-y-2"><legend>{kind === 'facts' ? '可分别验证的事实' : '必须保留的限制'}</legend>
            {fragment[kind].map((item, index) => <div key={item.key} className="space-y-1 border-l-2 border-border pl-2">
              <label className="block">{kind === 'facts' ? '事实' : '限制'} {index + 1}<textarea aria-label={`${kind === 'facts' ? '事实' : '限制'} ${index + 1}`} className="w-full" disabled={disabled || stale} maxLength={600} value={item.text}
                onChange={event => change(fragment.fragmentKey, kind, fragment[kind].map(row => row.key === item.key ? {...row, text: event.target.value} : row))}/></label>
              {item.quotes.map((quote, quoteIndex) => <label key={quoteIndex} className="block text-xs">原文引用 {quoteIndex + 1}<textarea className="w-full" disabled={disabled || stale} maxLength={800} value={quote}
                onChange={event => change(fragment.fragmentKey, kind, fragment[kind].map(row => row.key === item.key ? {...row, quotes: row.quotes.map((value, i) => i === quoteIndex ? event.target.value : value)} : row))}/>
                <button type="button" disabled={disabled || stale || item.quotes.length <= 1} onClick={() => change(fragment.fragmentKey, kind, fragment[kind].map(row => row.key === item.key ? {...row, quotes: row.quotes.filter((_, i) => i !== quoteIndex)} : row))}>删除引用 {quoteIndex + 1}</button></label>)}
              <button type="button" disabled={disabled || stale || item.quotes.length >= 4} onClick={() => change(fragment.fragmentKey, kind, fragment[kind].map(row => row.key === item.key ? {...row, quotes: [...row.quotes, '']} : row))}>添加原文引用</button>
              <button type="button" disabled={disabled || stale} onClick={() => change(fragment.fragmentKey, kind, fragment[kind].filter(row => row.key !== item.key))}>删除此{kind === 'facts' ? '事实' : '限制'}</button>
            </div>)}
            <button type="button" className="lf-action" disabled={disabled || stale || fragment[kind].length >= 16} onClick={() => {
              const keys = new Set([...fragment.facts, ...fragment.constraints].map(row => row.key)); let n = 1
              while (keys.has(`${kind}-${n}`)) n++
              change(fragment.fragmentKey, kind, [...fragment[kind], {key: `${kind}-${n}`, text: '', quotes: ['']}])
            }}>添加{kind === 'facts' ? '事实' : '限制'}</button>
          </fieldset>)}
        </article>
      })}
      <button type="button" className="lf-action" disabled={disabled || stale || pending(review) || pending(generation) || !isAIConfigReady(config)} onClick={() => void act(() => reviewChatSourceUnitsV1({scope: props.scope, request: {source: source!, candidate}, config}))}>独立复核当前候选</button>
      <p role="status">{matchesReview ? review.result?.passed ? '当前候选已获独立复核通过，尚未确认用于制作。' : '当前候选未通过独立复核，请按原因修改。'
        : stale ? '这是历史候选；请按当前所选原文重新整理。' : '当前候选没有匹配的有效复核结果。'}</p>
    </div>}
    {review?.result?.report && <details open><summary>{matchesReview ? '当前候选的逐项复核' : '历史候选的逐项复核'}</summary>
      {review.result.report.fragments.map(fragment => <div key={fragment.fragmentKey} className="space-y-1 p-2">
        <p>整段覆盖：{fragment.complete ? '通过' : '未通过'} · {fragment.reason}</p>
        {[...fragment.facts, ...fragment.constraints].map(item => <p key={item.key}>{review.context?.candidate.fragments.find(row => row.fragmentKey === fragment.fragmentKey)?.facts.find(row => row.key === item.key)?.text
          ?? review.context?.candidate.fragments.find(row => row.fragmentKey === fragment.fragmentKey)?.constraints.find(row => row.key === item.key)?.text}：{item.reason}</p>)}
      </div>)}
    </details>}
    <SourceUnitConfirmation scope={props.scope} draft={props.draft} settings={props.settings} projection={props.projection}
      source={source ?? {draftRevision: props.revision, projectionHash, fragmentKeys: []}} candidate={candidate ?? {fragments: []}}
      disabled={disabled} onConfirmed={props.onConfirmed}/>
  </section>
}
