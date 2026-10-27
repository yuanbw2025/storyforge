import { useEffect, useRef, useState } from 'react'
import { readTtrpgOpenTableStageOpeningV1, prepareTtrpgOpenTableStageOpeningV1, confirmTtrpgOpenTableStageOpeningV1,
  type TtrpgOpenTableInputV1 } from '../../lib/ttrpg/open-table-service'

type Preview = Awaited<ReturnType<typeof prepareTtrpgOpenTableStageOpeningV1>>
type View = Awaited<ReturnType<typeof readTtrpgOpenTableStageOpeningV1>>
export default function TtrpgOpenStageOpeningPanel(props: {
  input: TtrpgOpenTableInputV1; sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void>
}) {
  const [view, setView] = useState<View>(null), [selected, setSelected] = useState<string[]>([])
  const [preview, setPreview] = useState<Preview | null>(null), [accepted, setAccepted] = useState(false), [error, setError] = useState('')
  const generation = useRef(0)
  const { projectId, worldId, workId } = props.input.scope, { sessionId, viewerKey } = props.input
  useEffect(() => {
    const token = ++generation.current
    setView(null); setSelected([]); setPreview(null); setAccepted(false); setError('')
    void readTtrpgOpenTableStageOpeningV1({ scope: { projectId, worldId, workId }, sessionId, viewerKey }).then(next => {
      if (generation.current !== token) return
      setView(next); setSelected(next?.choices.filter(c => c.continuing).map(c => c.templateKey) ?? [])
    }).catch(e => { if (generation.current === token) setError(e instanceof Error ? e.message : String(e)) })
    return () => { generation.current += 1 }
  }, [projectId, worldId, workId, sessionId, viewerKey, props.sequence])
  if (error) return <p role="status">下一阶段由本桌已确认的主持身份选择。{error}</p>
  if (!view) return null
  return <fieldset className="sf-open-table-card" disabled={props.busy} aria-label="下一阶段开局">
    <legend>准备下一阶段</legend>
    <p>当前世界轮次 {view.worldTurn}，本局上限 {view.maximumWorldTurns}。进度、资源与已确认线索继续保留。</p>
    <p>选择本阶段要继续使用的局势；确认前会检查每位真人玩家是否有可采取的行动和可理解的线索。</p>
    {view.choices.map(choice => <label key={choice.templateKey}><input type="checkbox" checked={selected.includes(choice.templateKey)}
      onChange={e => { setSelected(keys => e.target.checked ? [...keys, choice.templateKey] : keys.filter(k => k !== choice.templateKey)); setPreview(null); setAccepted(false) }} />
      {choice.title}{choice.continuing ? '（沿用当前局势）' : ''}</label>)}
    {!view.choices.length && <p>当前没有可供此身份选择的开局素材，请先核对本桌进度与作品内容。</p>}
    <button disabled={!selected.length || view.worldTurn >= view.maximumWorldTurns} onClick={() => void props.perform(async () => {
      const token = generation.current
      const next = await prepareTtrpgOpenTableStageOpeningV1({ ...props.input, templateKeys: selected })
      if (generation.current === token) { setPreview(next); setAccepted(false) }
    })}>检查下一阶段开局</button>
    {preview && <><p role="status">开局检查通过：{preview.plan.humanChecks.length} 位真人玩家的继续条件已核对。</p>
      <label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />我确认沿当前团局进入下一阶段。</label>
      <button disabled={!accepted} onClick={() => void props.perform(async () => {
        await confirmTtrpgOpenTableStageOpeningV1({ ...props.input, preview }); setPreview(null); setAccepted(false)
      })}>确认开始下一阶段</button></>}
  </fieldset>
}
