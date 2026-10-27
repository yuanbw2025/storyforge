import { useState, useSyncExternalStore } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { TtrpgOpenAuthoringSeatPlanV1 } from '../../lib/ttrpg/open-authoring-seat-plan'
import type { TtrpgOpenCompanionPolicyV1 } from '../../lib/ttrpg/open-contract'
import { beginSeatApprovalDraft, proposeSeatApprovalDraft, readSeatApprovalDraft, removedSeatApprovalKeys,
  reviewSeatApprovalDraft, seatApprovalOwnerKey, subscribeSeatApprovalDraft, updateSeatApprovalDraft,
  matchesSeatApprovalFingerprint,
  type OpenSeatSettings, type SeatApprovalDraft, type SeatApprovalProposal } from './open-seat-approval-draft'

/** Explicit author choices in S2. The parent retains the original Settings save. */
export default function TtrpgOpenSeatApprovalEditor({ owner, revision, value, onApply, onDiscard, onVision }: {
  owner: WorkspaceScope; revision: number; value: OpenSeatSettings
  onApply: (draft: SeatApprovalDraft, plan: TtrpgOpenAuthoringSeatPlanV1, policy: TtrpgOpenCompanionPolicyV1) => void
  onDiscard: (draft: SeatApprovalDraft) => void; onVision: () => void
}) {
  const pending = useSyncExternalStore(subscribeSeatApprovalDraft, readSeatApprovalDraft)
  const draft = pending && seatApprovalOwnerKey(pending.owner) === seatApprovalOwnerKey(owner) ? pending : null
  const [error, setError] = useState('')
  const run = (action: () => void) => { try { action(); setError('') } catch (e) { setError(e instanceof Error ? e.message : String(e)) } }
  const update = (proposal: SeatApprovalProposal) => { if (draft) run(() => updateSeatApprovalDraft(draft, proposal)) }
  const human = value.wizard.seats.filter(seat => seat.role === 'player' && seat.controller === 'human')
  const proposal = draft?.proposal, policy = proposal?.policy
  const label = (key: string) => value.wizard.seats.find(seat => seat.seatKey === key)?.label || key
  const removed = draft ? removedSeatApprovalKeys(draft) : []
  const appliedHere = Boolean(draft?.applied && draft.revision === revision && matchesSeatApprovalFingerprint(value, draft.expected))
  return <section className="md:col-span-2 lf-paper" data-testid="ttrpg-seat-approvals" aria-label="AI 队友批准配置">
    <h3>AI 队友批准配置</h3>
    <p>为每个 AI 队友明确选择真人批准席位。这里只配置未来角色和批准关系；数值映射、真实玩家认领和开局同意仍需分别确认。</p>
    {error && <p role="alert">{error}</p>}
    {!value.openAuthoring.companionPolicy ? <button type="button" className="lf-action" onClick={onVision}>先填写本桌边界</button> : !draft ? <>
      <p>{value.authoringSeatPlan ? '已有角色预留。重新核对时会保留仍在同一席位的角色标识。' : '尚未确认角色预留。现有设置不会自动改变。'}</p>
      {!value.authoringSeatPlan && <p>新预留不会自动改写已有设计中的角色引用。已有角色时，请沿用原标识并逐席核对。</p>}
      <button type="button" className="lf-action" disabled={Boolean(pending)} onClick={() => run(() => beginSeatApprovalDraft(proposeSeatApprovalDraft(owner, revision, value)))}>
        核对角色与批准席位
      </button>
      {!value.authoringSeatPlan && !value.openAuthoring.companionPolicy.approvalBindings.length && <button type="button" className="lf-action" disabled={Boolean(pending)}
        onClick={() => run(() => beginSeatApprovalDraft(proposeSeatApprovalDraft(owner, revision, value, true)))}>沿用已有设计的角色标识</button>}
    </> : proposal && policy && <>
      {proposal.manualIdentity && <p>原方案已有角色标识，系统无法推断它属于哪个席位。请逐席填写原角色标识并核对旧关系；可从原设计或制作角色表中复制。不会按姓名或顺序自动分配。</p>}
      <fieldset disabled={draft.applied}>
        <div className="avg-form">
          <label>最少 AI 队友<input aria-label="最少 AI 队友" type="number" min="2" max="5" value={policy.minimumCompanions}
            onChange={event => update({ ...proposal, policy: { ...policy, minimumCompanions: Number(event.target.value) } })}/></label>
          <label>最多 AI 队友<input aria-label="最多 AI 队友" type="number" min="2" max="5" value={policy.maximumCompanions}
            onChange={event => update({ ...proposal, policy: { ...policy, maximumCompanions: Number(event.target.value) } })}/></label>
        </div>
        {proposal.plan.seats.map(seat => {
          const binding = policy.approvalBindings.find(item => item.companionActorKey === seat.characterKey)
          const setBinding = (approverSeatKeys: string[], partyResourceApprovalAllowed: boolean) => update({ ...proposal, policy: { ...policy,
            approvalBindings: [...policy.approvalBindings.filter(item => item.companionActorKey !== seat.characterKey),
              { companionActorKey: seat.characterKey, approverSeatKeys, partyResourceApprovalAllowed }] } })
          return <article className="lf-paper" key={seat.seatKey} data-seat-key={seat.seatKey}>
            <h4>{label(seat.seatKey)} · {seat.controller === 'ai' ? 'AI 队友' : seat.controller === 'human' ? '真人' : '待认领'}</h4>
            {proposal.manualIdentity ? <label>原角色标识<input aria-label={`${label(seat.seatKey)} 原角色标识`} value={seat.characterKey} onChange={event => {
              const key = event.target.value.trim()
              const old = draft.original.policy.approvalBindings.find(item => item.companionActorKey === key.trim())
              update({ ...proposal, removalConfirmed: false, plan: { ...proposal.plan, seats: proposal.plan.seats.map(item => item.seatKey === seat.seatKey ? { ...item, characterKey: key } : item) },
                policy: { ...policy, approvalBindings: [...policy.approvalBindings.filter(item => item.companionActorKey !== seat.characterKey && item.companionActorKey !== key.trim()),
                  ...(old ? [structuredClone(old)] : [])] } })
            }}/></label> : <details><summary>查看角色标识</summary><code>{seat.characterKey}</code></details>}
            {seat.controller === 'ai' && <>
              <p>可批准此队友行动的真人席位：</p>
              {!human.length && <p role="alert">当前没有真人玩家席位。请先配置真人席位，再重新核对。</p>}
              {human.map(approver => <label key={approver.seatKey} className="block"><input type="checkbox"
                aria-label={`${label(seat.seatKey)} 由 ${approver.label} 批准`} checked={binding?.approverSeatKeys.includes(approver.seatKey) ?? false}
                onChange={event => setBinding(event.target.checked ? [...(binding?.approverSeatKeys ?? []), approver.seatKey] :
                  (binding?.approverSeatKeys ?? []).filter(key => key !== approver.seatKey), binding?.partyResourceApprovalAllowed ?? false)}/>{approver.label}</label>)}
              {binding?.approverSeatKeys.filter(key => !human.some(item => item.seatKey === key)).map(key => <label className="block" key={key}>
                <input type="checkbox" aria-label={`${label(seat.seatKey)} 移除失效批准席位 ${key}`} checked onChange={() => setBinding(binding.approverSeatKeys.filter(item => item !== key), binding.partyResourceApprovalAllowed)}/>
                失效批准席位 {key}（取消选择后移除）
              </label>)}
              <label className="block"><input type="checkbox" aria-label={`${label(seat.seatKey)} 公共资源批准`} checked={binding?.partyResourceApprovalAllowed ?? false}
                onChange={event => setBinding(binding?.approverSeatKeys ?? [], event.target.checked)}/>这些真人还可批准该队友使用队伍公共资源</label>
            </>}
          </article>
        })}
        {removed.length > 0 && <label className="block"><input type="checkbox" checked={proposal.removalConfirmed}
          onChange={event => update({ ...proposal, removalConfirmed: event.target.checked })}/>我已核对以下旧预留或批准关系将被移除：{removed.join('、')}</label>}
      </fieldset>
      <p>{appliedHere ? '配置已应用到本窗口表单，请点击保存方案。暂存副本在实际保存成功后才清除。' : '请逐项核对后应用，再保存方案。浏览器内切换页面会保留这份暂存副本；关闭或刷新前请保存或下载。'}</p>
      <div className="avg-actions">
        <button type="button" className="lf-action" disabled={appliedHere} onClick={() => run(() => {
          const next = reviewSeatApprovalDraft(draft, owner, revision, value); onApply(draft, next.plan, next.policy)
        })}>应用批准配置到表单</button>
        <button type="button" className="lf-action" onClick={() => onDiscard(draft)}>清除批准配置暂存副本</button>
      </div>
    </>}
  </section>
}
