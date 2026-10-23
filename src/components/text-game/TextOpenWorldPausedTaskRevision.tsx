import { useEffect, useState } from 'react'
import type { TextOpenWorldContentRevisionV1, WorkspaceScope } from '../../lib/types'
import { listTextOpenWorldPausedRevisionTargetsV1 } from '../../lib/open-world/production-content-revision'

type Target = Awaited<ReturnType<typeof listTextOpenWorldPausedRevisionTargetsV1>>[number]
const LABELS: Record<string, string> = {
  'p2.experience-design': '体验设计与主角', 'p2.gameplay-ruleset': '玩法规则',
  'p2.presentation-profile': '呈现方式', 'p3.story-architecture': '故事架构与结局',
  'p4.region-skeleton': '地区与地图', 'p4.player-build': '玩家成长方案',
  'p5.mainline': '主线', 'p6.significant-threads': '重要故事',
  'p7.region-narrative-packs': '地区叙事', 'p8.quest-skeletons': '任务结构',
  'p8.catalog.progression': '成长与技能', 'p8.catalog.encounters': '遭遇',
  'p8.catalog.items-rewards': '物品与奖励', 'p8.catalog.crafting-economy': '配方与经济',
  'p8.catalog.npc-runtime': '角色行为', 'p8.catalog.map-interactions': '地点操作',
  'p8f.quest-finalize': '任务条件与后果', 'p9.scene-scripts': '场景正文', 'p10.system-finalize': '系统配置',
}
export default function TextOpenWorldPausedTaskRevision(props: {
  scope: WorkspaceScope; productionId: number; controlEpoch: number; busy: boolean;
  onSubmit: (revision: TextOpenWorldContentRevisionV1) => void
}) {
  const [targets, setTargets] = useState<Target[] | null>(null)
  const [selection, setSelection] = useState('')
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    setTargets(null); setSelection(''); setNote(''); setDraft(''); setError('')
    void listTextOpenWorldPausedRevisionTargetsV1({ scope: props.scope, productionId: props.productionId })
      .then(rows => { if (current) setTargets(rows) })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { current = false }
  }, [props.scope, props.productionId, props.controlEpoch])
  const selected = targets?.find(row => row.taskKey === selection)
  return <details className="mt-5 rounded border border-border bg-bg-elevated p-5" data-testid="open-world-paused-content-revision">
    <summary className="cursor-pointer text-sm font-semibold">返修已签收内容（高级）</summary>
    <p className="my-3 text-xs leading-6 text-text-muted">制作途中发现上游内容有误时，可提交该任务的完整 JSON 草稿。系统按原任务规则校验，保留原稿与调用记录，并重新生成受影响的下游。已完成的预览请使用现有返修流程。</p>
    {error && <p role="alert" className="text-xs text-error">{error}</p>}
    {!error && targets == null && <p className="text-xs text-text-muted">正在核对已签收内容…</p>}
    {targets?.length === 0 && <p className="text-xs text-text-muted">当前没有可选择的已签收任务；已有未完成修订时，点击“恢复并继续”沿用该修订。</p>}
    {!!targets?.length && <>
      <label className="grid gap-2 text-xs">返修任务<select aria-label="开放世界返修任务" value={selection} disabled={props.busy}
        onChange={event => { setSelection(event.target.value); setNote(''); setDraft('') }} className="rounded border border-border bg-bg-base p-2">
        <option value="">选择已签收任务</option>{targets.map(row => <option key={row.taskKey} value={row.taskKey}>{LABELS[row.taskKey] ?? row.taskKey}</option>)}
      </select></label>
      {selected && <>
        <p className="my-2 text-xs text-text-muted">已绑定本任务全部 {selected.expectedArtifacts.length} 份原稿；完整草稿使用该任务的模型输出格式，可在“查看冻结证据”中查看原稿。</p>
        <label className="mt-3 grid gap-2 text-xs">修订说明<textarea aria-label="开放世界内容修订说明" value={note} maxLength={2000}
          onChange={event => setNote(event.target.value)} className="rounded border border-border bg-bg-base p-3" /></label>
        <label className="mt-3 grid gap-2 text-xs">完整任务草稿（JSON）<textarea aria-label="开放世界修订后的完整任务 JSON" value={draft} maxLength={120000}
          onChange={event => setDraft(event.target.value)} className="min-h-60 rounded border border-border bg-bg-base p-3 font-mono" /></label>
        <button disabled={props.busy || !note.trim() || !draft.trim()} onClick={() => props.onSubmit({ ...selected, note, authorDraftJson: draft })}
          className="mt-3 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">保存开放世界修订并继续</button>
      </>}
    </>}
  </details>
}
