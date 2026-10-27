import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { readTtrpgOpenTableContinuationTargetsV1, readTtrpgOpenTableContinuationChoicesV1,
  prepareTtrpgOpenTableContinuationV1, confirmTtrpgOpenTableContinuationV1,
  type TtrpgOpenTableInputV1 } from '../../lib/ttrpg/open-table-service'

type Preview = Awaited<ReturnType<typeof prepareTtrpgOpenTableContinuationV1>>
type Targets = NonNullable<Awaited<ReturnType<typeof readTtrpgOpenTableContinuationTargetsV1>>>
type Choices = Awaited<ReturnType<typeof readTtrpgOpenTableContinuationChoicesV1>>
export default function TtrpgOpenContinuationPanel(props: {
  input: TtrpgOpenTableInputV1; sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false), [targets, setTargets] = useState<Targets>([])
  const [target, setTarget] = useState(0), [choices, setChoices] = useState<Choices | null>(null)
  const [selected, setSelected] = useState<string[]>([]), [reason, setReason] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null), [accepted, setAccepted] = useState(false)
  const [created, setCreated] = useState<number | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const { projectId, worldId, workId } = props.input.scope, { sessionId, viewerKey } = props.input
  useEffect(() => {
    const token = ++generation.current
    setChoices(null); setSelected([]); setPreview(null); setAccepted(false); setError('')
    if (!expanded) return
    setLoading(true)
    const input = { scope: { projectId, worldId, workId }, sessionId, viewerKey }
    void (async () => {
      const rows = await readTtrpgOpenTableContinuationTargetsV1(input)
      if (generation.current !== token) return
      setTargets(rows ?? [])
      if (!target) return
      if (!rows?.some(r => r.id === target)) throw new Error('请选择本作品当前可用的发布版本。')
      const next = await readTtrpgOpenTableContinuationChoicesV1({ ...input, targetProductReleaseId: target })
      if (generation.current === token) { setChoices(next); setSelected(next.choices.filter(c => c.selected).map(c => c.templateKey)) }
    })().catch(e => { if (generation.current === token) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (generation.current === token) setLoading(false) })
    return () => { generation.current += 1 }
  }, [expanded, target, projectId, worldId, workId, sessionId, viewerKey, props.sequence])
  const invalidate = () => { setPreview(null); setAccepted(false) }
  return <details className="sf-open-table-card" onToggle={e => setExpanded(e.currentTarget.open)}>
    <summary>使用新发布续团</summary>
    <p>保留当前进度，创建绑定另一发布版本的续团存档。原团局和原行动记录继续保留。</p>
    <p>兼容版本须保留世界、规则、角色及已有局势；可追加作者已发布的开局素材、调整阶段安排。</p>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">正在读取可用发布…</p>}
    {!loading && !targets.length && <p>当前没有其他发布。请先在原作品制作并发布兼容的新版本。</p>}
    <fieldset disabled={props.busy || loading || created !== null} aria-label="新发布续团">
      <label>续团发布<select aria-label="续团发布" value={target || ''} onChange={e => { setTarget(Number(e.target.value)); invalidate() }}>
        <option value="">选择已发布版本</option>{targets.map(t => <option key={t.id} value={t.id}>{t.label}（版本 {t.version}）</option>)}
      </select></label>
      {choices && <><p>{choices.pitch}</p><p>选择续团开局要采用的局势。</p>
        {choices.choices.map(choice => <label key={choice.templateKey}><input type="checkbox" checked={selected.includes(choice.templateKey)}
          onChange={e => { setSelected(keys => e.target.checked ? [...keys, choice.templateKey] : keys.filter(k => k !== choice.templateKey)); invalidate() }} />{choice.title}</label>)}
      </>}
      <label>本次续团说明<textarea value={reason} onChange={e => { setReason(e.target.value); invalidate() }} placeholder="说明采用新发布的原因，以及如何衔接当前冒险。" /></label>
      <button disabled={!target || !choices || !selected.length || !reason.trim()} onClick={() => void props.perform(async () => {
        const token = generation.current
        const next = await prepareTtrpgOpenTableContinuationV1({ ...props.input, targetProductReleaseId: target, reason: reason.trim(), openingTemplateKeys: selected })
        if (generation.current === token) { setPreview(next); setAccepted(false) }
      })}>检查续团方案</button>
      {preview && <><p role="status">续团检查通过。保留世界轮次 {preview.plan.worldTurn}、原资源、知识和随机依据。</p>
        <p>本次保留 {preview.plan.interrupted.length} 项中断行动和 {preview.plan.unknownCalls.length} 条结果未知记录。中断只适用于已完成机械结算后剩余的检查、叙述与交接，原行动不会被标为完成。</p>
        <p>进入新存档后，每位真人须重新确认席位和开团约定，开局会按实际席位再次检查。</p>
        <label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />我确认以上承接与中断安排，创建续团存档。</label>
        <button disabled={!accepted} onClick={() => void props.perform(async () => {
          const token = generation.current
          const child = await confirmTtrpgOpenTableContinuationV1({ ...props.input, preview })
          if (generation.current === token) { setCreated(child.id!); setPreview(null); setAccepted(false) }
        })}>确认创建续团存档</button>
      </>}
    </fieldset>
    {created !== null && <p role="status">续团存档已保存。<Link to={`/play/session/${created}`}>进入续团，确认席位与开局</Link></p>}
  </details>
}
