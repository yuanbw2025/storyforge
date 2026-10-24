import {useEffect, useRef, useState} from 'react'
import {canonicalStringify} from '../../lib/agent/run/hash'
import type {WorkspaceScope} from '../../lib/types'
import type {ChatAuthoringDraftV1, ChatAuthoringSettingsV3} from '../../lib/character-interaction/authoring-contract'
import type {ChatSourceReviewRequestV1} from '../../lib/character-interaction/source-review-context'
import {chatProjectionResourcesV1, type ChatSourceProjectionDraftV1} from '../../lib/character-interaction/source-projection'
import type {ChatSourceUnitsCandidateV1} from '../../lib/character-interaction/source-units'
import {parseChatSourceUnitSetV1, validateChatSourceUnitSetForProjectionV1, type ChatSourceUnitPermissionV1} from '../../lib/character-interaction/source-unit-authorization'
import {readLatestChatSourceUnitConfirmationRunV1, reviewChatSourceUnitConfirmationV1, adoptChatSourceUnitConfirmationV1, recoverChatSourceUnitConfirmationV1, cancelChatSourceUnitConfirmationV1, type ChatSourceUnitConfirmationViewV1} from '../../lib/character-interaction/source-unit-confirmation-harness'
import {removeChatSourceUnitBundleV1} from '../../lib/character-interaction/source-unit-store'
import {useAIConfigStore} from '../../stores/ai-config'
import {isAIConfigReady} from '../../lib/ai/config-readiness'
import SourceRunFailure from './SourceRunFailure'

export default function SourceUnitConfirmation(props: {scope: WorkspaceScope; draft: ChatAuthoringDraftV1; settings: ChatAuthoringSettingsV3; projection: ChatSourceProjectionDraftV1;
  source: ChatSourceReviewRequestV1; candidate: ChatSourceUnitsCandidateV1; disabled: boolean; onConfirmed: () => void}) {
  const config = useAIConfigStore(state => state.config)
  const [view, setView] = useState<ChatSourceUnitConfirmationViewV1 | null>(null)
  const [permissions, setPermissions] = useState<ChatSourceUnitPermissionV1[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const epoch = useRef({value: 0}).current
  const {projectId, worldId, workId} = props.scope
  const keysJson = canonicalStringify(props.candidate.fragments.flatMap(row => row.facts.map(fact => ({fragmentKey: row.fragmentKey, unitKey: fact.key}))))
  useEffect(() => {
    const ticket = ++epoch.value
    const keys = JSON.parse(keysJson) as Array<{fragmentKey: string; unitKey: string}>
    setView(null); setError(''); setBusy(false)
    setPermissions(keys.map(key => ({...key, audienceKeys: []})))
    void readLatestChatSourceUnitConfirmationRunV1({projectId, worldId, workId}).then(next => {
      if (ticket !== epoch.value) return
      setView(next)
      if (next?.context) setPermissions(keys.map(key => next.context!.permissions.find(row => row.fragmentKey === key.fragmentKey && row.unitKey === key.unitKey) ?? {...key, audienceKeys: []}))
    }).catch(cause => {if (ticket === epoch.value) setError(cause instanceof Error ? cause.message : String(cause))})
    return () => {epoch.value++}
  }, [epoch, projectId, worldId, workId, props.draft.revision, keysJson])
  const act = async (action: () => Promise<unknown>) => {
    const ticket = ++epoch.value; setBusy(true); setError('')
    try {await action()} catch (cause) {if (ticket === epoch.value) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {
      if (ticket === epoch.value) {
        try {const next = await readLatestChatSourceUnitConfirmationRunV1(props.scope); if (ticket === epoch.value) setView(next)}
        catch (cause) {if (ticket === epoch.value) setError(cause instanceof Error ? cause.message : String(cause))}
        if (ticket === epoch.value) setBusy(false)
      }
    }
  }
  const disabled = props.disabled || busy, pending = view?.status === 'pending' || view?.status === 'unknown'
  const stale = props.source.draftRevision !== props.draft.revision || props.source.projectionHash !== props.projection.projectionHash
  const eligible = props.candidate.fragments.length > 0 && props.candidate.fragments.every(fragment => {
    const decision = props.settings.sourceReview?.classifications.find(row => row.fragmentKey === fragment.fragmentKey)
    return decision?.purpose === 'knowledge' && decision.visibility === 'author-only'
  })
  const matched = view?.status === 'ready' && !stale && canonicalStringify(view.context?.candidate) === canonicalStringify(props.candidate)
    && canonicalStringify(view.context?.permissions) === canonicalStringify(permissions)
  const actors = props.projection.characters.map(row => ({key: row.resourceKey, label: row.label})), audiences = [{key: 'player', label: '玩家'}, ...actors]
  const resources = chatProjectionResourcesV1(props.projection)
  const update = (target: ChatSourceUnitPermissionV1, patch: Partial<ChatSourceUnitPermissionV1>) => setPermissions(rows => rows.map(row => {
    if (row.fragmentKey !== target.fragmentKey || row.unitKey !== target.unitKey) return row
    const next = {...row, ...patch}; if (!next.discovery) delete next.discovery
    if (next.discovery) next.discovery = {...next.discovery, actorKeys: next.discovery.actorKeys.filter(key => !next.audienceKeys.includes(key))}
    return next
  }))
  let saved: ReturnType<typeof parseChatSourceUnitSetV1> | null = null, savedIssue = ''
  try {
    if (props.draft.sourceUnitsJson !== undefined) {
      saved = parseChatSourceUnitSetV1(JSON.parse(props.draft.sourceUnitsJson))
      if (!props.settings.sourceReview) throw new Error('请重新确认来源资料')
      validateChatSourceUnitSetForProjectionV1(saved, props.projection, props.settings.sourceReview)
    }
  } catch (cause) {savedIssue = cause instanceof Error ? cause.message : String(cause)}
  return <section aria-label="事实知情确认" className="space-y-3 border-t border-border pt-3">
    <h5>逐项知情与发现条件</h5>
    <p>原段作为作者证据保留，角色按下面的事实分别获知。初始知情和发现条件须符合原文；没有初知者且未允许调查的事实保持未知。</p>
    {!eligible && <p>保存前，请先把所选原文设为“事实与经历 / 仅作者掌握”，保存资料检查后重新整理。这样完整秘密不会绕过逐项授权进入角色视角。</p>}
    {savedIssue && <p role="alert">{savedIssue}；新制作不能使用过期整理，可重新整理同批原文或明确移除。</p>}
    {saved?.bundles.map((bundle, index) => <article key={bundle.candidate.fragments[0].fragmentKey} data-testid="chat-saved-source-units" className="rounded bg-bg-base p-2">
      <p>已确认批次 {index + 1}：{bundle.candidate.fragments.flatMap(row => row.facts.map(fact => fact.text)).join('；')}</p>
      <button type="button" className="lf-action" disabled={disabled} onClick={() => void act(async () => {
        await removeChatSourceUnitBundleV1(props.scope, props.draft.revision, bundle.candidate.fragments.map(row => row.fragmentKey)); props.onConfirmed()
      })}>移除此批已确认事实整理</button>
    </article>)}
    {permissions.map(permission => {
      const fact = props.candidate.fragments.find(row => row.fragmentKey === permission.fragmentKey)!.facts.find(row => row.key === permission.unitKey)!
      return <fieldset key={canonicalStringify([permission.fragmentKey, permission.unitKey])} className="space-y-2 rounded border border-border p-2">
        <legend>{fact.text}</legend>
        <p>起初知道这项事实的人</p>
        {audiences.map(actor => <label key={actor.key} className="mr-3 inline-flex gap-1"><input type="checkbox" disabled={disabled || stale} checked={permission.audienceKeys.includes(actor.key)} onChange={event => update(permission, {audienceKeys: event.target.checked ? [...permission.audienceKeys, actor.key] : permission.audienceKeys.filter(key => key !== actor.key)})}/>{actor.label}</label>)}
        <label className="block"><input type="checkbox" disabled={disabled || stale || !props.settings.narrative.permissions.maxDiscoveriesPerSituation} checked={!!permission.discovery} onChange={event => update(permission,
          {discovery: event.target.checked ? {actorKeys: actors.filter(actor => !permission.audienceKeys.includes(actor.key)).slice(0, 1).map(actor => actor.key), condition: '', prerequisiteFragmentKeys: []} : undefined})}/>允许调查后获知此事实</label>
        {permission.discovery && <div className="space-y-2">
          <label className="block">实际发现条件<textarea className="w-full" maxLength={2000} disabled={disabled || stale} value={permission.discovery.condition} onChange={event => update(permission, {discovery: {...permission.discovery!, condition: event.target.value}})}/></label>
          <fieldset><legend>允许调查者</legend>{actors.filter(actor => !permission.audienceKeys.includes(actor.key)).map(actor => <label key={actor.key} className="mr-3 inline-flex gap-1"><input type="checkbox" disabled={disabled || stale} checked={permission.discovery!.actorKeys.includes(actor.key)} onChange={event => update(permission, {discovery: {...permission.discovery!, actorKeys: event.target.checked ? [...permission.discovery!.actorKeys, actor.key] : permission.discovery!.actorKeys.filter(key => key !== actor.key)}})}/>{actor.label}</label>)}</fieldset>
          <fieldset className="max-h-40 overflow-auto"><legend>调查者已知的前提</legend>{resources.flatMap(resource => resource.fragments.map(fragment => {
            const rule = permission.discovery!, decision = props.settings.sourceReview?.classifications.find(row => row.fragmentKey === fragment.fragmentKey)
            const allowed = !props.candidate.fragments.some(row => row.fragmentKey === fragment.fragmentKey) && decision?.purpose === 'knowledge' && (decision.visibility === 'public' || decision.visibility === 'participants' && rule.actorKeys.every(key => decision.audienceKeys.includes(key)))
            const selected = rule.prerequisiteFragmentKeys.includes(fragment.fragmentKey)
            if (!allowed && !selected) return null
            return <label key={fragment.fragmentKey} className="block text-xs"><input type="checkbox" disabled={disabled || stale || !allowed && !selected} checked={selected} onChange={event => update(permission, {discovery: {...rule, prerequisiteFragmentKeys: event.target.checked ? [...rule.prerequisiteFragmentKeys, fragment.fragmentKey] : rule.prerequisiteFragmentKeys.filter(key => key !== fragment.fragmentKey)}})}/>{resource.label}：{fragment.valueJson}</label>
          }))}</fieldset>
        </div>}
      </fieldset>
    })}
    {error && <p role="alert" className="text-danger">{error}</p>}
    {busy && <p>正在处理本次确认…</p>}
    <button type="button" className="lf-action" disabled={disabled || stale || !eligible || pending || view?.status === 'ready' || !isAIConfigReady(config)} onClick={() => void act(() => reviewChatSourceUnitConfirmationV1({scope: props.scope, request: {source: props.source, candidate: props.candidate, permissions}, config}))}>复核事实和知情范围</button>
    <button type="button" className="lf-action" disabled={disabled || !matched || !view?.result?.passed} onClick={() => void act(async () => {
      await adoptChatSourceUnitConfirmationV1({scope: props.scope, runId: view!.runId, expectedCandidateHash: view!.candidateHash!, candidate: props.candidate, permissions}); props.onConfirmed()
    })}>确认保存事实与知情范围</button>
    {view && <div data-testid="chat-source-unit-confirmation-result">
      {view.status === 'ready' && <p>{matched ? '事实与权限复核通过，等待你确认保存。' : '候选或权限已编辑，旧复核不能用于保存；结束这次复核后重新检查。'}</p>}
      {view.status === 'adopted' && <p>此批事实已经确认保存；新制作会使用逐项知情与发现条件。</p>}
      {pending && <p>本次请求尚未结束，结果未知时不会自动重发。可恢复已留存的回复或明确结束等待。</p>}
      {view.status === 'stale' && <p>来源或方案已变化，此复核不能用于当前确认。</p>}
      {view.failure && <SourceRunFailure failure={view.failure} pending={view.status === 'pending'}/>}
      {view.result?.artifact.issues.map(issue => <p key={issue.code}>{issue.message}</p>)}
      {view.result?.report && <details><summary>逐项复核依据</summary>
        {view.result.report.interpretation.fragments.map(row => <p key={row.fragmentKey}>覆盖：{row.complete ? '通过' : '未通过'} · {row.reason}{row.facts.map(fact => `；${fact.reason}`).join('')}{row.constraints.map(item => `；${item.reason}`).join('')}</p>)}
        {view.result.report.permissions.map(row => <p key={canonicalStringify([row.fragmentKey, row.unitKey])}>初知：{row.initialKnowledgeFaithful ? '通过' : '未通过'}；发现：{row.discoverySupported ? '通过' : '未通过'} · {row.reason}</p>)}
      </details>}
      {pending && <button type="button" className="lf-action" disabled={disabled} onClick={() => void act(() => recoverChatSourceUnitConfirmationV1(props.scope, view.runId))}>恢复事实确认记录</button>}
      {['pending', 'unknown', 'ready', 'stale'].includes(view.status) && <button type="button" className="lf-action" disabled={disabled} onClick={() => void act(() => cancelChatSourceUnitConfirmationV1(props.scope, view.runId))}>结束这次事实确认</button>}
    </div>}
  </section>
}
