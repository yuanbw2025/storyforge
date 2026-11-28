import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { Project } from '../../lib/types'
import type { PowerAuthoringTargetV1, PowerPathPlanV1 } from '../../lib/cultivation/power-authoring-contract'
import { decodePowerStagesStrictV1 } from '../../lib/cultivation/power-authoring-contract'
import { powerRemovalImpactHashV1 } from '../../lib/cultivation/power-authoring-adoption'
import { parsePowerAuthoringCandidateV1, parsePowerAuthoringSnapshotV1, powerAuthoringCurrentValueV1, powerAuthoringLabelV1, preparePowerCandidateV1, samePowerAuthoringTargetV1, type PowerAuthoringCandidateV1, type PowerAuthoringCopilotSnapshotV1 } from '../../lib/agent/power-authoring-copilot'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import type { useMasterCopilot } from '../agent/useMasterCopilot'
import CandidateSaveFeedback from '../agent/CandidateSaveFeedback'
import HarnessEvidencePanel from '../agent/HarnessEvidencePanel'
import { CInput, CTextarea } from '../shared/CompositionInput'

const Context = createContext<((target: PowerAuthoringTargetV1) => void) | null>(null)
export function PowerAuthoringButtonV1({ target }: { target: PowerAuthoringTargetV1 | null }) {
  const open = useContext(Context)
  if (!open || !target) return null
  return <button type="button" className="ml-2 inline-flex shrink-0 items-center gap-1 text-[11px] font-normal text-accent"
    onClick={() => open(target)} aria-label={`AI ${powerAuthoringLabelV1(target)}`}><Sparkles className="h-3 w-3"/>AI</button>
}
function render(value: unknown) { return typeof value === 'string' ? value : JSON.stringify(value, null, 2) }

export function PowerAuthoringWorkspaceV1({ project, copilot, onDone, children }: {
  project: Project; copilot: ReturnType<typeof useMasterCopilot>; onDone: () => Promise<void>; children: ReactNode
}) {
  const [target, setTarget] = useState<PowerAuthoringTargetV1 | null>(null)
  const [hint, setHint] = useState(''), [newCount, setNewCount] = useState(4), [error, setError] = useState('')
  const [impactHash, setImpactHash] = useState('')
  const pending = copilot.pendingCandidates.filter(item => item.payload.skillId === 'world-origin.power-authoring')
  const candidate = pending.find(item => target && item.payload.powerAuthoringRequest && samePowerAuthoringTargetV1(item.payload.powerAuthoringRequest.target, target))
  const parsed = useMemo(() => {
    if (!candidate) return null
    try {
      const snapshot = parsePowerAuthoringSnapshotV1(candidate.payload.baseSnapshot)
      try {
        const value = parsePowerAuthoringCandidateV1(candidate.event.content, snapshot)
        return { snapshot, value, prepared: preparePowerCandidateV1(snapshot, value), error: '' }
      } catch (cause) {
        // A temporarily empty text name stays in its original editor. The
        // strict adoption gate still blocks it; no visible keystroke is lost.
        const draft = JSON.parse(candidate.event.content)
        if (draft && draft.version === 1 && typeof draft.value === 'string' && Object.keys(draft).every(key => ['version', 'value', 'confirmedRemovalHash'].includes(key)))
          return { snapshot, value: draft as PowerAuthoringCandidateV1, error: cause instanceof Error ? cause.message : String(cause) }
        throw cause
      }
    } catch (cause) { return { error: cause instanceof Error ? cause.message : String(cause) } }
  }, [candidate])
  const snapshot = parsed && 'snapshot' in parsed ? parsed.snapshot : undefined
  const value = parsed && 'value' in parsed ? parsed.value : undefined
  const prepared = parsed && 'prepared' in parsed ? parsed.prepared : undefined
  const removalKey = prepared?.removedStageIds.join('\0') ?? ''
  useEffect(() => {
    let active = true
    setImpactHash('')
    if (snapshot && prepared?.removedStageIds.length) void powerRemovalImpactHashV1(snapshot.baseline, prepared.removedStageIds).then(hash => { if (active) setImpactHash(hash) }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [snapshot, removalKey, prepared?.removedStageIds])
  const guarded = async (action: () => void | Promise<unknown>) => {
    setError('')
    try { await flushPendingEditsV1(); await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const open = (next: PowerAuthoringTargetV1) => { void guarded(() => { setHint(''); setTarget(next) }) }
  const close = () => { void guarded(() => setTarget(null)) }
  const update = async (next: PowerAuthoringCandidateV1) => {
    if (!candidate) return
    setError('')
    try { await copilot.updateCandidate(candidate.event.id!, JSON.stringify(next, null, 2)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const run = async () => {
    if (!target) return
    const plan = target.table === 'cultivationSystems' && target.field === 'stages' && !target.stageId
    const count = plan ? newCount : 0
    if (!Number.isSafeInteger(count) || count < 0) { setError('新增阶段数必须是非负整数。'); return }
    // An explicit author count allocates stable IDs before the original task is frozen.
    const allocatedStageIds = Array.from({ length: count }, () => `stage-${crypto.randomUUID()}`)
    await copilot.submitTargetedRequest(`为${powerAuthoringLabelV1(target)}生成独立候选，等待我确认。${hint}`, {
      id: `power-${crypto.randomUUID()}`,
      agentId: 'world-origin', skillId: 'world-origin.power-authoring',
      instruction: `只创作${powerAuthoringLabelV1(target)}。${hint || '保持当前作品风格，明确能力边界与代价。'}`,
      powerAuthoringRequest: { target, allocatedStageIds },
    })
  }
  const planTarget = target?.table === 'cultivationSystems' && target.field === 'stages' && !target.stageId
  const otherPending = copilot.pendingCandidates.some(item => item !== candidate)
  const affected = snapshot?.baseline.references.filter(ref => ref.stageId && prepared?.removedStageIds.includes(ref.stageId)) ?? []
  return <Context.Provider value={open}>
    {pending.length > 0 && <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded border border-accent/30 p-2 text-xs">
      力量设定有待确认候选。{pending.map(item => <button key={item.event.id} className="text-accent underline" onClick={() => item.payload.powerAuthoringRequest && open(item.payload.powerAuthoringRequest.target)}>继续编辑：{item.payload.label}</button>)}
    </div>}
    {error && !target && <p role="alert" className="text-xs text-error">{error}</p>}
    {children}
    {target && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3" role="presentation">
      <section role="dialog" aria-modal="true" aria-label={`力量 AI · ${powerAuthoringLabelV1(target)}`} className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-bg-surface p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">{powerAuthoringLabelV1(target)} · AI 候选</h2>
          <button type="button" onClick={close} aria-label="关闭力量候选" className="p-1"><X className="h-4 w-4"/></button></div>
        <p className="mb-3 text-xs text-text-muted">结果先保存为候选。采用时只修改本次选中的字段；其它字段、路径和未涉及的阶段保持原值。</p>
        {(error || copilot.error || parsed?.error) && <p role="alert" className="mb-3 rounded border border-error/30 p-2 text-xs text-error">{error || copilot.error || parsed?.error}</p>}
        {!candidate ? <>
          <label className="block text-xs">补充要求（可选）<CTextarea value={hint} onChange={event => setHint(event.target.value)} rows={3} className="mt-1 w-full"/></label>
          {planTarget && <label className="mt-3 block text-xs">最多新增阶段数 <input aria-label="最多新增阶段数" type="number" min={0} step={1} value={newCount} onChange={event => setNewCount(Number(event.target.value))} className="ml-2 w-20 rounded border border-border bg-bg-base p-1"/><span className="ml-2 text-text-muted">设为 0 时只调整已有阶段；实际新增数可以更少。</span></label>}
          {otherPending && <p className="mt-3 text-xs text-text-muted">还有其他待确认候选，请先处理后再生成。</p>}
          <div className="mt-4 flex justify-end gap-3">{copilot.recoveryAvailable && <button disabled={copilot.busy} onClick={() => { void guarded(copilot.resume) }} className="text-xs text-accent">恢复原生成</button>}
            <button disabled={copilot.loading || copilot.busy || otherPending || !project.id} onClick={() => { void guarded(run) }} className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">{copilot.busy ? '生成中…' : '生成候选'}</button></div>
        </> : <>
          <CandidateSaveFeedback event={candidate.event} scope={copilot.candidateLocalSaveScope} draftState={copilot.readCandidateLocalDraftState?.(candidate.event.id!)} busy={copilot.busy} onRetry={() => copilot.flushCandidateDraft(candidate.event.id!)}>
            {snapshot && value && (!planTarget || prepared) ? <>
              {planTarget ? <PowerPlanEditor snapshot={snapshot} candidate={value} busy={copilot.busy} onChange={next => { void update({ version: 1, value: next }) }} onRawChange={raw => { void copilot.updateCandidate(candidate.event.id!, raw).catch(cause => setError(String(cause))) }}/>
                : target.table === 'cultivationSystems' && target.field === 'stages' && target.stageField === 'parentStageIds' ? <fieldset disabled={copilot.busy} className="space-y-2"><legend className="mb-2 text-xs">候选前置境界</legend>
                  {decodePowerStagesStrictV1(Reflect.get(snapshot.baseline.snapshot.record, 'stages')).filter(stage => stage.id !== target.stageId).map(stage => <label key={stage.id} className="mr-3 inline-flex gap-1 text-xs"><input type="checkbox" checked={(value.value as string[]).includes(stage.id)} onChange={event => { const ids = value.value as string[]; void update({ version: 1, value: event.target.checked ? [...ids, stage.id] : ids.filter(id => id !== stage.id) }) }}/>{stage.name}</label>)}
                </fieldset> : <CTextarea aria-label="力量字段候选" value={render(value.value)} disabled={copilot.busy} onChange={event => { void update({ version: 1, value: event.target.value }) }} rows={7} className="w-full"/>}
              <details className="mt-3 text-xs"><summary>查看修改前后</summary><div className="mt-2 grid gap-3 md:grid-cols-2"><div><h3>原内容</h3><pre className="whitespace-pre-wrap break-words">{planTarget ? Reflect.get(snapshot.baseline.snapshot.record, 'stages') : render(powerAuthoringCurrentValueV1(snapshot))}</pre></div><div><h3>候选采用后</h3><pre className="whitespace-pre-wrap break-words">{planTarget ? prepared?.patch.stages : render(value.value)}</pre></div></div></details>
              {!!prepared?.removedStageIds.length && <div className="mt-3 rounded border border-warning/40 p-3 text-xs"><p>将删除 {prepared.removedStageIds.length} 个阶段。{affected.length ? `涉及 ${affected.length} 条原引用：` : '当前没有记录直接引用这些阶段。'}</p>
                <ul className="my-2 list-inside list-disc">{affected.map(ref => <li key={`${ref.table}:${ref.id}`}>{ref.label}{ref.workId !== snapshot.scope.workId && ref.workId ? '（同世界其他作品）' : ''}</li>)}</ul>
                <p>对应角色和词条的阶段引用会置空，历史修炼记录保留并标记来源缺失；其他已变更阶段的历史来源可能标记过期。</p>
                <label className="mt-2 flex gap-2"><input type="checkbox" disabled={copilot.busy || !impactHash} checked={!!impactHash && value.confirmedRemovalHash === impactHash} onChange={event => { void update({ ...value, confirmedRemovalHash: event.target.checked ? impactHash : undefined }) }}/>我已核对以上删除和引用影响</label></div>}
            </> : <><p role="alert" className="mb-2 text-xs text-error">{parsed?.error || '候选无法安全读取。原文已保留，可修正或拒绝。'}</p><CTextarea aria-label="修正力量候选原文" value={candidate.event.content} disabled={copilot.busy} onChange={event => { void copilot.updateCandidate(candidate.event.id!, event.target.value).catch(cause => setError(String(cause))) }} rows={12} className="w-full font-mono text-xs"/></>}
          </CandidateSaveFeedback>
          <HarnessEvidencePanel contextEvidence={candidate.payload.contextEvidence} lifecycle={candidate.lifecycle}/>
          <div className="mt-4 flex justify-end gap-3"><button disabled={copilot.busy} onClick={() => { void guarded(() => copilot.rejectCandidate(candidate)) }} className="text-xs text-text-muted">拒绝候选</button>
            <button disabled={copilot.busy || !snapshot || !!parsed?.error || !!prepared?.removedStageIds.length && (!impactHash || value?.confirmedRemovalHash !== impactHash)}
              onClick={() => { void guarded(async () => { if (await copilot.adoptCandidate(candidate)) { await onDone(); setTarget(null) } }) }} className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">确认采用</button></div>
        </>}
      </section>
    </div>}
  </Context.Provider>
}

function PowerPlanEditor({ snapshot, candidate, busy, onChange, onRawChange }: { snapshot: PowerAuthoringCopilotSnapshotV1; candidate: PowerAuthoringCandidateV1; busy: boolean; onChange: (plan: PowerPathPlanV1) => void; onRawChange: (raw: string) => void }) {
  const plan = candidate.value as PowerPathPlanV1
  const before = decodePowerStagesStrictV1(Reflect.get(snapshot.baseline.snapshot.record, 'stages'))
  const after = decodePowerStagesStrictV1(preparePowerCandidateV1(snapshot, candidate).patch.stages)
  const originalIds = new Set(before.map(stage => stage.id))
  const change = (id: string, patch: Record<string, unknown>) => {
    const next = structuredClone(plan)
    if (originalIds.has(id)) {
      const update = next.updates.find(item => item.id === id)
      if (update) Object.assign(update.patch, patch)
      else next.updates.push({ id, patch })
    } else Object.assign(next.additions.find(stage => stage.id === id)!, patch)
    onChange(next)
  }
  return <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 text-sm">路径规划预览 · {after.length} 个阶段</legend>
    {after.map(stage => <div key={stage.id} className="rounded border border-border p-3 text-xs"><div className="mb-2 flex gap-2"><span className="text-accent">{originalIds.has(stage.id) ? plan.updates.some(item => item.id === stage.id) ? '修改' : '保留' : '新增'}</span>
      <CInput aria-label={`规划阶段名称-${stage.id}`} value={stage.name} onChange={event => change(stage.id, { name: event.target.value })} className="min-w-0 flex-1 rounded border border-border bg-bg-base p-1"/>
      <button type="button" onClick={() => { const next = structuredClone(plan); if (originalIds.has(stage.id)) { next.updates = next.updates.filter(item => item.id !== stage.id); next.removals.push(stage.id) } else next.additions = next.additions.filter(item => item.id !== stage.id); onChange(next) }} className="text-error">移除</button></div>
      <div className="mb-2 flex flex-wrap gap-2">前置：{after.filter(item => item.id !== stage.id).map(parent => <label key={parent.id} className="inline-flex gap-1"><input type="checkbox" checked={stage.parentStageIds.includes(parent.id)} onChange={event => change(stage.id, { parentStageIds: event.target.checked ? [...stage.parentStageIds, parent.id] : stage.parentStageIds.filter(id => id !== parent.id) })}/>{parent.name}</label>)}</div>
      <div className="grid gap-2 md:grid-cols-2"><label>能力与限制<CTextarea aria-label={`规划能力-${stage.id}`} value={stage.features ?? ''} onChange={event => change(stage.id, { features: event.target.value })} rows={2} className="mt-1 w-full"/></label><label>突破与代价<CTextarea aria-label={`规划突破-${stage.id}`} value={stage.breakthrough ?? ''} onChange={event => change(stage.id, { breakthrough: event.target.value })} rows={2} className="mt-1 w-full"/></label></div>
    </div>)}
    {plan.removals.map(id => <div key={id} className="flex justify-between rounded border border-error/30 p-2 text-xs">删除：{before.find(stage => stage.id === id)?.name ?? id}<button type="button" className="text-accent" onClick={() => onChange({ ...plan, removals: plan.removals.filter(item => item !== id) })}>保留这个阶段</button></div>)}
    {snapshot.request.allocatedStageIds.some(id => !plan.additions.some(stage => stage.id === id)) && <button type="button" className="text-xs text-accent" onClick={() => { const id = snapshot.request.allocatedStageIds.find(id => !plan.additions.some(stage => stage.id === id))!; onChange({ ...plan, additions: [...plan.additions, { id, name: '新境界', parentStageIds: [], features: '', breakthrough: '' }] }) }}>添加候选阶段</button>}
    <details className="text-xs"><summary>编辑完整规划操作</summary><CTextarea aria-label="路径规划 JSON" value={JSON.stringify(candidate, null, 2)} onChange={event => onRawChange(event.target.value)} rows={8} className="mt-2 w-full font-mono"/></details>
  </fieldset>
}
