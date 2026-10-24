import SourceRunFailure from './SourceRunFailure'
import {useEffect, useRef, useState} from 'react'
import type {WorkspaceScope} from '../../lib/types'
import {parseChatAuthoringSettings, type ChatAuthoringDraftV1} from '../../lib/character-interaction/authoring-contract'
import {useAIConfigStore} from '../../stores/ai-config'
import {isAIConfigReady} from '../../lib/ai/config-readiness'
import {loadChatSourceProjectionV1, type ChatConversationTurnV1} from '../../lib/character-interaction/draft-service'
import {chatProjectionResourcesV1, type ChatSourceProjectionDraftV1} from '../../lib/character-interaction/source-projection'
import {CHAT_PLAN_FIELDS, chatPlanMissingInputsV1, type ChatPlanFieldV1} from '../../lib/character-interaction/consultation-plan'
import {generateChatConsultationV2, readLatestChatConsultationV2, adoptChatConsultationV2, recoverChatConsultationV2, cancelChatConsultationV2, type ChatConsultationViewV2} from '../../lib/character-interaction/consultation-harness'

export default function Consultation({scope, draft, dirty, onSource, onProduction}: {
  scope: WorkspaceScope | null; draft?: ChatAuthoringDraftV1; dirty: boolean; onSource: () => void; onProduction: () => void
}) {
  const config = useAIConfigStore(state => state.config)
  const [view, setView] = useState<ChatConsultationViewV2 | null>(null)
  const [question, setQuestion] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [projection, setProjection] = useState<ChatSourceProjectionDraftV1 | null>(null), [fragments, setFragments] = useState<string[]>([])
  const [fields, setFields] = useState<ChatPlanFieldV1[]>([]), [continueDiscussion, setContinueDiscussion] = useState(true)
  const epoch = useRef({value: 0}).current
  const controller = useRef<AbortController | null>(null), lastRun = useRef<number | null>(null)
  const projectId = scope?.projectId, workId = scope?.workId, worldId = scope?.worldId
  const accept = (next: ChatConsultationViewV2 | null) => {
    setView(next)
    if (lastRun.current !== (next?.runId ?? null)) {lastRun.current = next?.runId ?? null; setFields(next?.result?.candidate?.changes.map(change => change.field) ?? [])}
  }
  useEffect(() => {
    const ticket = ++epoch.value
    controller.current?.abort(); setBusy(false); setError(''); setProjection(null); setFragments([]); setView(null)
    if (projectId && workId && worldId) void readLatestChatConsultationV2({projectId, workId, worldId})
      .then(next => {if (ticket === epoch.value) accept(next)}).catch(cause => {if (ticket === epoch.value) setError(String(cause))})
    return () => {epoch.value++; controller.current?.abort()}
  }, [epoch, projectId, workId, worldId, draft?.revision])
  const act = async (action: () => Promise<unknown>) => {
    if (!scope || busy) return
    const ticket = ++epoch.value
    setBusy(true); setError('')
    try {await action()} catch (cause) {if (ticket === epoch.value) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {
      if (ticket === epoch.value) {
        try {const next = await readLatestChatConsultationV2(scope); if (ticket === epoch.value) accept(next)} catch (cause) {if (ticket === epoch.value) setError(String(cause))}
        if (ticket === epoch.value) setBusy(false)
      }
    }
  }
  const unfinished = view?.status === 'unknown' || view?.status === 'pending'
  const candidate = view?.result?.candidate
  const oldTurns = draft ? JSON.parse(draft.conversationJson) as ChatConversationTurnV1[] : []
  const missing = draft ? chatPlanMissingInputsV1(parseChatAuthoringSettings(JSON.parse(draft.settingsJson)), !!draft.worldReleaseId) : []
  const send = () => act(async () => {
    if (!scope || !draft || dirty) throw new Error('请先保存当前方案')
    if (view?.status === 'ready' || view?.status === 'stale') await cancelChatConsultationV2(scope, view.runId)
    controller.current = new AbortController()
    await generateChatConsultationV2({scope, request: {draftRevision: draft.revision, question, priorRunId: continueDiscussion && candidate ? view!.runId : null,
      source: projection && fragments.length ? {draftRevision: draft.revision, projectionHash: projection.projectionHash, fragmentKeys: fragments} : null}, config, signal: controller.current.signal})
    setQuestion('')
  })
  return <div className="avg-consult">
    <section className="lf-paper space-y-3">
      <h3>角色聊天 主 Agent</h3>
      <p>一起打磨人物牵挂、当前矛盾和开放的开场。你可选择带入的原文，并逐项采用建议；开始制作仍由你单独确认。</p>
      {!scope || !draft ? <p>请先保存制作方案。</p> : <>
        {dirty && <p>请先保存当前方案，再讨论或采用建议。</p>}
        {!draft.worldReleaseId && <button className="lf-action" onClick={onSource}>选择世界（也可先讨论方案）</button>}
        <details><summary>本轮带入的原文资料（已选 {fragments.length} 项）</summary>
          <p>只读取勾选片段，最多12项；未选择时仅讨论当前方案和你的想法。作者隐情仅供制作讨论，不会改变角色知情范围。</p>
          <button className="lf-action" disabled={busy || dirty || unfinished || !draft.worldReleaseId} onClick={() => void act(async () => {setProjection(await loadChatSourceProjectionV1(scope, draft.revision)); setFragments([])})}>选择会谈资料</button>
          {projection && chatProjectionResourcesV1(projection).map(resource => <fieldset className="my-3 space-y-2" key={resource.resourceKey}>
            <legend>{resource.label}{resource.origin === 'product-private' ? ' · 本体验新角色' : ''}</legend>
            {resource.fragments.map((fragment, index) => <label key={fragment.fragmentKey} className="block rounded border border-border p-2" data-testid="chat-consult-source">
              <input type="checkbox" aria-label={`${resource.label} 资料 ${index + 1}`} disabled={busy || dirty || unfinished || fragments.length >= 12 && !fragments.includes(fragment.fragmentKey)} checked={fragments.includes(fragment.fragmentKey)}
                onChange={event => setFragments(keys => event.target.checked ? [...keys, fragment.fragmentKey] : keys.filter(key => key !== fragment.fragmentKey))}/>
              资料 {index + 1}<span className="block max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm">{typeof JSON.parse(fragment.valueJson) === 'string' ? JSON.parse(fragment.valueJson) : fragment.valueJson}</span>
            </label>)}
          </fieldset>)}
        </details>
        {view?.context?.history.length ? <details><summary>本次承接的讨论</summary>{view.context.history.map((turn, index) => <article className="my-2" key={index}><p>你：{turn.question}</p><p>主 Agent：{turn.candidate.answer}</p></article>)}</details> : null}
        {oldTurns.length > 0 && <details><summary>旧版会谈记录（只读）</summary><p>旧版整份方案候选不再直接覆盖当前方案，请在新会谈重新讨论需要的修改。</p>{oldTurns.map(turn => <article key={turn.id}><p>{turn.question}</p><p>{turn.answer || turn.error}</p></article>)}</details>}
        <label className="block">你的想法<textarea aria-label="角色聊天 会谈输入" className="w-full" value={question} maxLength={5000} onChange={event => setQuestion(event.target.value)}/></label>
        {candidate && <label><input type="checkbox" checked={continueDiscussion} onChange={event => setContinueDiscussion(event.target.checked)}/>承接上一轮讨论</label>}
        <p>继续发送会保留上一份候选，尚未确认的修改不会自动采用；取消勾选可开始新的讨论。</p>
        {!isAIConfigReady(config) && <p>请先在全局设置中配置文本模型。</p>}
        <button className="lf-action lf-action-primary" disabled={busy || dirty || unfinished || !question.trim() || !isAIConfigReady(config)} onClick={() => void send()}>{busy ? '会谈中…' : '发送'}</button>
        {busy && <button className="lf-action" onClick={() => controller.current?.abort()}>停止</button>}
        {unfinished && !view?.failure && <p>{view?.status === 'unknown' ? '这次请求的结果尚未留存。刷新不会重发；结束等待后，下一次发送会发起新请求。' : '本次会谈尚未完成。已有回复可以恢复；恢复不调用模型。'}</p>}
        {view && <div className="avg-actions">
          {unfinished && (view.result || view.failure) && <button className="lf-action" disabled={busy} onClick={() => void act(() => recoverChatConsultationV2(scope, view.runId))}>{view.failure ? '恢复失败记录' : '恢复已保存结果'}</button>}
          {view.status !== 'adopted' && view.status !== 'cancelled' && <button className="lf-action" disabled={busy} onClick={() => void act(() => cancelChatConsultationV2(scope, view.runId))}>结束本次讨论</button>}
          <button className="lf-action" disabled={busy} onClick={() => void act(async () => undefined)}>查看最新结果</button>
        </div>}
      </>}
      {error && <p role="alert">{error}</p>}
    </section>
    <aside className="lf-paper space-y-3">
      <h3>待确认方案</h3>
      {view?.status === 'stale' && <p role="status">方案或资料已变化，下面是历史候选，不能覆盖当前方案。</p>}
      {view?.status === 'adopted' && <p role="status">已采用所选修改；其他方案设置保持原样。</p>}
      {view?.status === 'cancelled' && <p>本次讨论已结束，候选保留供查阅。</p>}
      {view?.result?.artifact.issues.map(issue => <p key={issue.code}>{issue.message}</p>)}
      {view?.result && !candidate && <details><summary>查看保留的原始回复</summary><p className="whitespace-pre-wrap break-words">{view.result.artifact.originalText}</p></details>}
      {view?.failure && <SourceRunFailure failure={view.failure} pending={view.status === 'pending'}/>}
      {view?.status === 'blocked' && !view.result && !view.failure && <p>模型服务拒绝了这次请求，没有生成方案；没有自动重发。</p>}
      {candidate ? <>
        <p className="whitespace-pre-wrap">{candidate.answer}</p>
        {candidate.changes.map(change => <article key={change.field} className="space-y-2 rounded border border-border p-3" data-testid="chat-plan-change">
          <label><input type="checkbox" disabled={busy || dirty || view?.status !== 'ready'} checked={fields.includes(change.field)} onChange={event => setFields(list => event.target.checked ? [...list, change.field] : list.filter(field => field !== change.field))}/>{CHAT_PLAN_FIELDS[change.field]}</label>
          <p className="text-sm">{change.basis === 'source' ? '有原文依据，仍需作者核对' : '体验创作提议，尚未成为事实'}</p>
          <p className="whitespace-pre-wrap break-words">当前：{String(view?.context?.plan[change.field] ?? '') || '尚未填写'}</p>
          <p className="whitespace-pre-wrap break-words">建议：{change.value}</p><p>{change.reason}</p>
          {change.evidence.map((evidence, index) => <blockquote key={index} className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm">{evidence.quote}</blockquote>)}
        </article>)}
        {candidate.changes.length > 0 && <button className="lf-action lf-action-primary" disabled={busy || dirty || view?.status !== 'ready' || !fields.length || !scope} onClick={() => void act(() => adoptChatConsultationV2({scope: scope!, runId: view!.runId, expectedCandidateHash: view!.candidateHash!, fields}))}>采用勾选的修改</button>}
      </> : <p>尚无可用候选。提出你的想法后，可以查看依据、选择需要的修改。</p>}
      {missing.length > 0 && <section aria-label="制作前待补齐"><h4>开始制作前还需</h4><ul>{missing.map(item => <li key={item}>{item}</li>)}</ul></section>}
      <p>采用建议只会更新方案。正式制作还会核对资料，并等待你明确开始。</p>
      <button className="lf-action" disabled={busy || dirty} onClick={onProduction}>检查制作准备</button>
    </aside>
  </div>
}
