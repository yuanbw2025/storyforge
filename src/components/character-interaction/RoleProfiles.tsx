import SourceRunFailure from './SourceRunFailure'
import {useEffect, useRef, useState} from 'react'
import {useAIConfigStore} from '../../stores/ai-config'
import {isAIConfigReady} from '../../lib/ai/config-readiness'
import {generateChatRoleProfileCandidateV1, readLatestChatRoleProfileRunV1, adoptChatRoleProfileCandidateV1, recoverChatRoleProfileRunV1, cancelChatRoleProfileRunV1, type ChatRoleProfileRunViewV1} from '../../lib/character-interaction/role-profile-harness'
import type {WorkspaceScope} from '../../lib/types'
import type {ChatAuthoringDraftV1, ChatAuthoringSettings} from '../../lib/character-interaction/authoring-contract'
import type {ChatSourceProjectionDraftV1} from '../../lib/character-interaction/source-projection'
import {readChatSourceReviewContextV1, type ChatSourceReviewContextV1} from '../../lib/character-interaction/source-review-context'
import {CHAT_ROLE_TRAIT_LABELS, parseChatRoleProfileSetV1, validateChatRoleProfilesForSourceV1, type ChatRoleProfileCandidateV1} from '../../lib/character-interaction/role-profile'
import {confirmChatRoleProfileV1, removeChatRoleProfileV1} from '../../lib/character-interaction/role-profile-store'

type Trait = ChatRoleProfileCandidateV1['traits'][number]
const blank = (): Trait => ({kind: 'value', text: '', evidence: [{fragmentKey: '', quote: ''}]})
export default function RoleProfiles(props: {
  scope: WorkspaceScope; draft: ChatAuthoringDraftV1; settings: ChatAuthoringSettings
  projection: ChatSourceProjectionDraftV1; selectedKeys: string[]; disabled: boolean; onConfirmed: () => void
}) {
  const config = useAIConfigStore(state => state.config)
  const [view, setView] = useState<ChatRoleProfileRunViewV1 | null>(null)
  const [aiOrigin, setAIOrigin] = useState<{runId: number; candidateHash: string} | null>(null)
  const [actorKey, setActorKey] = useState('')
  const [context, setContext] = useState<ChatSourceReviewContextV1 | null>(null)
  const [traits, setTraits] = useState<Trait[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const epoch = useRef({value: 0}).current
  const {projectId, worldId, workId} = props.scope
  useEffect(() => {
    const ticket = ++epoch.value
    setContext(null); setTraits([]); setActorKey(''); setBusy(false); setError(''); setAIOrigin(null); setView(null)
    void readLatestChatRoleProfileRunV1({projectId, worldId, workId}).then(next => {if (ticket === epoch.value) setView(next)})
      .catch(cause => {if (ticket === epoch.value) setError(cause instanceof Error ? cause.message : String(cause))})
    return () => {epoch.value++}
  }, [epoch, projectId, worldId, workId, props.draft.revision, props.projection.projectionHash])
  let saved: ReturnType<typeof parseChatRoleProfileSetV1> | undefined, invalid = ''
  try {saved = props.draft.roleProfilesJson === undefined ? undefined : parseChatRoleProfileSetV1(JSON.parse(props.draft.roleProfilesJson))}
  catch (cause) {invalid = cause instanceof Error ? cause.message : String(cause)}
  const act = async (action: (ticket: number) => Promise<void>) => {
    const ticket = ++epoch.value; setBusy(true); setError('')
    try {await action(ticket)} catch (cause) {if (ticket === epoch.value) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {if (ticket === epoch.value) {
      try {const next = await readLatestChatRoleProfileRunV1(props.scope); if (ticket === epoch.value) setView(next)}
      catch (cause) {if (ticket === epoch.value) setError(cause instanceof Error ? cause.message : String(cause))}
      if (ticket === epoch.value) setBusy(false)
    }}
  }
  const prepare = (key: string, fragmentKeys: string[], candidate?: ChatRoleProfileCandidateV1) => act(async ticket => {
    const next = await readChatSourceReviewContextV1(props.scope, {actorKey: key, fragmentKeys, draftRevision: props.draft.revision, projectionHash: props.projection.projectionHash})
    if (ticket === epoch.value) {setAIOrigin(null); setActorKey(key); setContext(next); setTraits(candidate ? structuredClone(candidate.traits) : [blank()])}
  })
  const change = (index: number, patch: Partial<Trait>) => setTraits(rows => rows.map((row, i) => i === index ? {...row, ...patch} : row))
  const disabled = busy || props.disabled
  const unfinished = !!view && ['ready', 'pending', 'unknown', 'stale'].includes(view.status)
  return <section aria-label="人物特征整理" className="space-y-3 rounded border border-border p-3">
    <h5>人物特征整理</h5>
    <p>把已确认的原文整理成角色的价值观、期望、顾虑、底线和说话习惯，每项保留引用。保存后用于新制作的情境与角色演绎，已有发布和存档保持原样。</p>
    <p>可让AI整理所选原文，也可手工填写。候选保留原始回复；修改后须明确确认才用于新制作。尚未确认的编辑不会自动保存。</p>
    {invalid && <p role="alert" className="text-danger">{invalid}</p>}
    {saved?.profiles.map(profile => {
      const label = props.projection.characters.find(row => row.resourceKey === profile.actorKey)?.label ?? '历史人物'
      let issue = ''
      try {
        if (props.settings.version === 1 || !props.settings.sourceReview) throw new Error('须重新确认资料知情范围')
        validateChatRoleProfilesForSourceV1({...saved!, profiles: [profile]}, props.projection, props.settings.sourceReview)
      } catch (cause) {issue = cause instanceof Error ? cause.message : String(cause)}
      return <article key={profile.actorKey} data-testid="chat-role-profile" className="space-y-2 rounded bg-bg-base p-3">
        <strong>{label} · 已保存人物整理</strong>
        {issue && <p role="status" className="text-danger">{issue}；新制作暂不能使用这份整理。</p>}
        {profile.candidate.traits.map((trait, index) => <div key={index}><p>{CHAT_ROLE_TRAIT_LABELS[trait.kind]}：{trait.text}</p>{trait.evidence.map((evidence, i) => <blockquote className="border-l-2 border-border pl-3 text-xs" key={i}>{evidence.quote}</blockquote>)}</div>)}
        <button type="button" className="lf-action" disabled={disabled} onClick={() => void prepare(profile.actorKey, profile.sourceFragments.map(row => row.fragmentKey), profile.candidate)}>编辑并重新确认{label}的整理</button>
        <button type="button" className="lf-action" disabled={disabled} onClick={() => void act(async () => {await removeChatRoleProfileV1(props.scope, props.draft.revision, profile.actorKey); props.onConfirmed()})}>移除{label}的整理</button>
      </article>
    })}
    <label>整理人物<select aria-label="整理人物" disabled={disabled} value={actorKey} onChange={event => {setActorKey(event.target.value); setContext(null); setTraits([]); setAIOrigin(null)}}>
      <option value="">请选择角色</option>{props.projection.characters.map(row => <option key={row.resourceKey} value={row.resourceKey}>{row.label}</option>)}
    </select></label>
    <p>使用下方勾选的 {props.selectedKeys.length} 项原文；所有原文都须在该角色已保存的知情范围内。</p>
    <button type="button" className="lf-action" disabled={disabled || !actorKey || !props.selectedKeys.length || props.selectedKeys.length > 12}
      onClick={() => void prepare(actorKey, [...props.selectedKeys])}>手工整理所选原文</button>
    {!isAIConfigReady(config) && <p>配置全局AI后可生成人物整理，仍可手工填写。</p>}
    <button type="button" className="lf-action" disabled={disabled || unfinished || !isAIConfigReady(config) || !actorKey || !props.selectedKeys.length || props.selectedKeys.length > 12}
      onClick={() => void act(async () => {await generateChatRoleProfileCandidateV1({scope: props.scope, request: {actorKey, fragmentKeys: [...props.selectedKeys], draftRevision: props.draft.revision, projectionHash: props.projection.projectionHash}, config})})}>AI整理人物特征</button>
    {view && <div className="space-y-2" data-testid="chat-role-profile-candidate">
      {view.status === 'unknown' && <p role="status">这次请求结果尚未留存，刷新不会重发。结束等待后才能明确发起新请求。</p>}
      {view.status === 'pending' && !view.failure && <p role="status">人物整理尚未完成；已有回复可零调用恢复，没有回复时须结束本次任务。</p>}
      {view.status === 'stale' && <p role="status">候选依据的方案或来源已经变化，不能采纳；请结束本次任务并按当前资料重新整理。</p>}
      {view.status === 'adopted' && <p role="status">这次候选已采纳；后续修改请编辑上方已保存的人物整理。</p>}
      {view.status === 'cancelled' && <p>本次候选已结束，没有自动重发。</p>}
      {view.failure && <SourceRunFailure failure={view.failure} pending={view.status === 'pending'}/>}
      {view.status === 'blocked' && !view.failure && <p role="status">本次人物整理未通过检查，未写入角色资料。可检查原始回复或手工整理。</p>}
      {view.result?.artifact.issues.map(issue => <p key={issue.code} className={issue.severity === 'error' ? 'text-danger' : 'text-text-muted'}>{issue.message}</p>)}
      {view.result && <details><summary>查看人物整理原始回复</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{view.result.artifact.originalText}</pre></details>}
      {view.status === 'ready' && view.result?.candidate && view.context && view.candidateHash && <button type="button" className="lf-action" disabled={disabled} onClick={() => {
        setContext(structuredClone(view.context!)); setTraits(structuredClone(view.result!.candidate!.traits)); setActorKey(view.context!.perspective!.actorKey)
        setAIOrigin({runId: view.runId, candidateHash: view.candidateHash!}); setError('')
      }}>检查并编辑AI人物候选</button>}
      {view.status === 'pending' && (view.result || view.failure) && <button type="button" className="lf-action" disabled={disabled} onClick={() => void act(async () => {await recoverChatRoleProfileRunV1(props.scope, view.runId)})}>{view.failure ? '恢复失败记录' : '恢复已保存的人物整理'}</button>}
      {unfinished && <button type="button" className="lf-action" disabled={disabled} onClick={() => void act(async () => {await cancelChatRoleProfileRunV1(props.scope, view.runId); setAIOrigin(null); setContext(null); setTraits([])})}>结束本次人物候选</button>}
      {unfinished && <button type="button" className="lf-action" disabled={disabled} onClick={() => void act(async () => undefined)}>查看人物整理最新结果</button>}
    </div>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    {context && <div className="space-y-3">
      <p>本次人物：{props.projection.characters.find(row => row.resourceKey === context.perspective?.actorKey)?.label}。整理不是原文事实，目标也不代表行动已经完成；保存前请核对主体、否定、条件和时态。</p>
      {traits.map((trait, index) => <fieldset key={index} className="space-y-2 rounded border border-border p-3" data-testid="chat-role-trait-editor">
        <legend>特征 {index + 1}</legend>
        <label>类别<select aria-label={`特征 ${index + 1} 类别`} disabled={disabled} value={trait.kind} onChange={event => change(index, {kind: event.target.value as Trait['kind']})}>{Object.entries(CHAT_ROLE_TRAIT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block">整理内容<textarea className="w-full" aria-label={`特征 ${index + 1} 内容`} maxLength={600} disabled={disabled} value={trait.text} onChange={event => change(index, {text: event.target.value})}/></label>
        {trait.evidence.map((evidence, evidenceIndex) => {
          const source = context.fragments.find(row => row.fragmentKey === evidence.fragmentKey)
          const quoteValue: unknown = source ? JSON.parse(source.valueJson) : null
          const update = (patch: Partial<Trait['evidence'][number]>) => change(index, {evidence: trait.evidence.map((row, i) => i === evidenceIndex ? {...row, ...patch} : row)})
          return <div key={evidenceIndex} className="space-y-2">
            <label>原文依据<select aria-label={`特征 ${index + 1} 依据 ${evidenceIndex + 1} 来源`} disabled={disabled} value={evidence.fragmentKey} onChange={event => update({fragmentKey: event.target.value, quote: ''})}>
              <option value="">请选择原文</option>{context.fragments.map((row, i) => <option key={row.fragmentKey} value={row.fragmentKey}>资料 {i + 1} · {row.resourceKey === context.perspective!.actorKey ? '本人' : '背景或他人'} · {row.pointer}</option>)}
            </select></label>
            {source && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">{typeof quoteValue === 'string' ? quoteValue : source.valueJson}</pre>}
            <label className="block">连续原文引用<textarea aria-label={`特征 ${index + 1} 依据 ${evidenceIndex + 1} 引用`} className="w-full" disabled={disabled} maxLength={800} value={evidence.quote} onChange={event => update({quote: event.target.value})}/></label>
            {trait.evidence.length > 1 && <button type="button" className="lf-action" disabled={disabled} onClick={() => change(index, {evidence: trait.evidence.filter((_, i) => i !== evidenceIndex)})}>移除依据 {evidenceIndex + 1}</button>}
          </div>
        })}
        <button type="button" className="lf-action" disabled={disabled || trait.evidence.length >= 4} onClick={() => change(index, {evidence: [...trait.evidence, {fragmentKey: '', quote: ''}]})}>增加依据</button>
        <button type="button" className="lf-action" disabled={disabled} onClick={() => setTraits(rows => rows.filter((_, i) => i !== index))}>移除特征 {index + 1}</button>
      </fieldset>)}
      <p>整理正文共 {traits.reduce((sum, row) => sum + row.text.length, 0)} / 3000 字符。</p>
      <button type="button" className="lf-action" disabled={disabled || traits.length >= 12} onClick={() => setTraits(rows => [...rows, blank()])}>增加人物特征</button>
      <button type="button" className="lf-action lf-action-primary" disabled={disabled || !traits.length} onClick={() => void act(async () => {
        if (aiOrigin) await adoptChatRoleProfileCandidateV1({scope: props.scope, runId: aiOrigin.runId, expectedCandidateHash: aiOrigin.candidateHash, candidate: {traits}})
        else await confirmChatRoleProfileV1(props.scope, {draftRevision: context.draftRevision, projectionHash: context.projectionHash, actorKey: context.perspective!.actorKey, fragmentKeys: context.fragments.map(row => row.fragmentKey)}, {traits})
        props.onConfirmed()
      })}>确认人物整理并用于新制作</button>
    </div>}
  </section>
}
