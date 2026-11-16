import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Globe2, Loader2 } from 'lucide-react'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import {
  deriveTextOpenWorldNovelWorldDraftV1,
  previewTextOpenWorldNovelWorldDraftV1,
  type TextOpenWorldNovelWorldDraftPreviewV1,
} from '../../lib/open-world/novel-world-derivation'
import type { WorkspaceScope } from '../../lib/types'

export default function TextOpenWorldNovelWorldDraft({ sourceScope }: { sourceScope: WorkspaceScope | null }) {
  const projectId = sourceScope?.projectId ?? null
  const worldId = sourceScope?.worldId ?? null
  const workId = sourceScope?.workId ?? null
  const scope = useMemo(() => projectId != null && worldId != null && workId != null
    ? { projectId, worldId, workId } : null, [projectId, worldId, workId])
  const [preview, setPreview] = useState<TextOpenWorldNovelWorldDraftPreviewV1 | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [derivedProjectId, setDerivedProjectId] = useState<number | null>(null)
  const generation = useRef(0)
  const pending = useRef<number | null>(null)

  useEffect(() => {
    const current = ++generation.current
    pending.current = null
    setPreview(null); setAcknowledged(false); setError(''); setBusy(false); setDerivedProjectId(null)
    if (!scope) { setLoading(false); return }
    setLoading(true)
    void previewTextOpenWorldNovelWorldDraftV1(scope).then(next => {
      if (generation.current === current) setPreview(next)
    }).catch(cause => {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : '无法检查小说来源。')
    }).finally(() => {
      if (generation.current === current) setLoading(false)
    })
    return () => { generation.current += 1 }
  }, [scope, refresh])

  const derive = async () => {
    if (!preview || !acknowledged || busy || pending.current != null) return
    const current = ++generation.current
    pending.current = current
    setBusy(true); setError('')
    try {
      await flushPendingEditsV1()
      if (generation.current !== current) return
      const result = await deriveTextOpenWorldNovelWorldDraftV1(preview)
      if (generation.current !== current) return
      setDerivedProjectId(result.targetProjectId)
      setAcknowledged(false)
    } catch (cause) {
      if (generation.current === current) {
        setError(cause instanceof Error ? cause.message : '派生世界草稿失败。')
        setAcknowledged(false)
      }
    } finally {
      if (generation.current === current) { pending.current = null; setBusy(false) }
    }
  }

  return <article className="space-y-4 rounded-xl border border-border bg-bg-elevated p-5" data-testid="creator-novel-world-draft" aria-busy={loading || busy || undefined}>
    <header><small className="text-xs text-text-muted">小说上游 · S1 世界草稿</small><h2 className="mt-1 flex items-center gap-2 text-base font-semibold"><BookOpen className="h-4 w-4" />先从小说派生世界草稿</h2></header>
    <p className="text-xs leading-6 text-text-muted">小说不能直接进入文字开放世界的正式会谈或制作。请先显式创建独立世界草稿，在世界页面检查、确认并封存，再选择该 WorldRelease 完成产品定向和明确开始。</p>
    <p className="rounded-lg bg-bg-base p-3 text-xs leading-6">本次范围是<strong>全部已确认语义</strong>，不限于正文；当前不提供按卷、大纲子树、章节范围或指定章节派生。源小说保留原 owner，双方之后的修改不会自动同步。</p>
    {!scope && <p className="text-xs text-text-muted">请先打开一部独立长篇或短篇小说，或改用已有封存世界版本。</p>}
    {loading && <p role="status" className="text-xs text-text-muted"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />正在检查已保存的小说来源…</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {preview && <div className="space-y-3">
      <p className="text-sm">来源作品：<strong>{preview.workTitle}</strong></p>
      <details className="text-xs text-text-muted"><summary className="cursor-pointer">查看本次来源指纹</summary><code className="mt-2 block break-all">{preview.sourceRevision.vectorHash}</code></details>
      {derivedProjectId == null && <>
        <label className="flex items-start gap-2 text-xs leading-6"><input type="checkbox" className="mt-1" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /><span>我确认按以上范围派生独立世界草稿；本次不封存、不开始产品制作。</span></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!acknowledged || busy} onClick={() => void derive()} className="rounded-lg bg-accent px-4 py-2 text-xs text-white disabled:opacity-40"><Globe2 className="mr-2 inline h-4 w-4" />{busy ? '正在派生草稿…' : '派生独立世界草稿'}</button>
          <button type="button" disabled={busy} onClick={() => setAcknowledged(false)} className="rounded-lg border border-border px-3 py-2 text-xs">取消派生</button>
        </div>
      </>}
    </div>}
    {derivedProjectId != null && <div role="status" className="space-y-2 rounded-lg border border-success/30 bg-success/5 p-4 text-xs leading-6">
      <p>独立世界草稿已创建，尚未封存，也没有开始任何游戏生产。</p>
      <a href={`/world/basics?project=${derivedProjectId}`} className="inline-block font-medium text-accent underline">检查并封存这个世界草稿</a>
      <p>确认并封存后，从世界页进入文字开放世界，重新选择版本和定向。旧小说制作记录及旧存档不会被迁移或改写。</p>
    </div>}
    {scope && derivedProjectId == null && <button type="button" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)} className="text-xs text-accent underline disabled:opacity-40">重新检查当前来源</button>}
  </article>
}
