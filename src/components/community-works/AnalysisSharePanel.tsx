import { useEffect, useState } from 'react'
import type { Reference, ReferenceAnalysisRun, ReferenceChunkAnalysis } from '../../lib/types/reference'
import type { FictionDimension } from '../../lib/types/import-session-data'
import { FICTION_DIMENSIONS } from '../../lib/types/import-session-data'
import { DIMENSION_LABELS } from '../../lib/types/reference'
import { db } from '../../lib/db/schema'
import { loadSelectedBookAnalysisPreview } from '../../lib/community-works/local-preview'
import CommunityShareFlow from './CommunityShareFlow'

export default function AnalysisSharePanel({ reference, run, chunks, onClose }: {
  reference: Reference; run: ReferenceAnalysisRun; chunks: ReferenceChunkAnalysis[]; onClose: () => void
}) {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([])
  const [selectedDimensions, setSelectedDimensions] = useState<FictionDimension[]>([])
  const [commentary, setCommentary] = useState('')
  const [worldId, setWorldId] = useState<number | null>(null)
  useEffect(() => {
    let active = true
    setWorldId(null); setSelectedIndices([]); setSelectedDimensions([])
    void db.works.get(reference.workId).then(work => {
      if (active && work?.projectId === reference.projectId && work.worldId) setWorldId(work.worldId)
    })
    return () => { active = false }
  }, [reference.projectId, reference.workId, run.id])
  const indices = [...new Set(chunks.map(chunk => chunk.chunkIndex))].sort((a, b) => a - b)
  const chosen = indices.filter(index => selectedIndices.includes(index))
  const dimensions = FICTION_DIMENSIONS.filter(key => selectedDimensions.includes(key))
  return <section aria-label="选择拆书分析公开范围" className="space-y-4 bg-bg-surface border border-border rounded-xl p-4 mt-4">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">分享拆书分析到社区作品集</h3>
      <button type="button" onClick={onClose} aria-label="关闭拆书分析分享">关闭</button></div>
    <p className="text-xs text-text-muted">使用这里已完成的 v{run.version} 分析；默认不选条目或维度。原 TXT/MD、原文切块和来源文件不会上传。</p>
    {!worldId && <p role="status">正在核对当前作品归属…</p>}
    <fieldset className="space-y-2" disabled={!worldId}>
      <legend className="text-sm font-medium">选择分析条目（{chosen.length}/{indices.length}）</legend>
      <div className="flex gap-3 text-xs"><button type="button" onClick={() => setSelectedIndices(indices)}>全部选择</button>
        <button type="button" onClick={() => setSelectedIndices([])}>全部取消</button></div>
      <div className="max-h-44 overflow-y-auto space-y-1">{indices.map(index => {
        const chunk = chunks.find(item => item.chunkIndex === index)
        return <label key={index} className="flex gap-2 text-xs p-2 border border-border rounded">
          <input type="checkbox" checked={selectedIndices.includes(index)} onChange={event => setSelectedIndices(current =>
            event.target.checked ? [...current, index] : current.filter(value => value !== index))} />
          {chunk?.label || `第 ${index + 1} 部分`}</label>
      })}</div>
    </fieldset>
    <fieldset className="space-y-2" disabled={!worldId}>
      <legend className="text-sm font-medium">选择分析维度（{dimensions.length}/13）</legend>
      <div className="flex gap-3 text-xs"><button type="button" onClick={() => setSelectedDimensions([...FICTION_DIMENSIONS])}>全部选择</button>
        <button type="button" onClick={() => setSelectedDimensions([])}>全部取消</button></div>
      <div className="grid grid-cols-2 gap-1">{FICTION_DIMENSIONS.map(key => <label key={key} className="flex gap-2 text-xs p-2 border border-border rounded">
        <input type="checkbox" checked={selectedDimensions.includes(key)} onChange={event => setSelectedDimensions(current =>
          event.target.checked ? [...current, key] : current.filter(value => value !== key))} />{DIMENSION_LABELS[key]}</label>)}</div>
    </fieldset>
    <label className="block text-xs">作者点评（可选）<textarea className="w-full p-2 border border-border rounded bg-bg-base"
      maxLength={100000} rows={3} value={commentary} onChange={event => setCommentary(event.target.value)} /></label>
    {worldId && chosen.length > 0 && dimensions.length > 0 && reference.id && run.id &&
      <CommunityShareFlow selectionRevision={`${run.id}:${chosen.join(',')}:${dimensions.join(',')}:${commentary}`}
        buildSnapshot={() => loadSelectedBookAnalysisPreview({
          scope: { projectId: reference.projectId, worldId, workId: reference.workId },
          referenceId: reference.id!, analysisRunId: run.id!, selectedChunkIndices: chosen,
          selectedDimensions: dimensions, authorCommentary: commentary, publicRightsConfirmed: true,
        })} />}
  </section>
}
