import { Globe2, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import type { Project } from '../../lib/types'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { deriveNovelToWorld } from '../../lib/world-engine/derivation'
import { effectiveWorkspacePurpose } from '../../lib/product/world-identity'
import { resolveScopeLike } from '../../lib/world-engine/scope'
import { effectiveNovelProfile, effectiveWorkKind } from '../../lib/world-engine/work-kind'
import { useActiveWork } from '../../hooks/useActiveWork'
import { useDialog } from '../shared/Dialog'

export default function WorldDerivationActions({
  project,
  onDerived,
  compact = false,
}: {
  project: Project
  onDerived: (targetProjectId: number) => void | Promise<void>
  compact?: boolean
}) {
  const activeWork = useActiveWork(project)
  const dialog = useDialog()
  const [busy, setBusy] = useState<'draft' | 'release' | null>(null)
  const [error, setError] = useState('')
  if (
    !project.id
    || effectiveWorkspacePurpose(project) !== 'independent-work'
    || !activeWork
    || effectiveWorkKind(activeWork) !== 'novel'
  ) return null

  const derive = async (publish: boolean) => {
    if (busy) return
    const profile = effectiveNovelProfile(activeWork) === 'short' ? '短篇' : '长篇'
    const confirmed = await dialog.confirm({
      title: publish ? '派生并封存世界 v1？' : '派生独立世界草稿？',
      message: publish
        ? `系统会复制当前${profile}的已确认语义内容并立即封存 v1。源作品不会被移动，之后两边也不会自动同步。`
        : `系统会复制当前${profile}的已确认语义内容。源作品不会被移动，之后两边也不会自动同步。`,
      confirmText: publish ? '派生并封存' : '派生世界草稿',
    })
    if (!confirmed) return
    setBusy(publish ? 'release' : 'draft')
    setError('')
    try {
      await flushPendingEditsV1()
      const sourceScope = await resolveScopeLike(project.id!)
      const result = await deriveNovelToWorld({ sourceScope, publish })
      await onDerived(result.targetProjectId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '派生世界失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={compact ? 'flex items-center gap-1' : 'flex flex-wrap items-center gap-2'}>
      <button
        type="button"
        className="rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover disabled:opacity-50"
        disabled={busy != null}
        onClick={() => void derive(false)}
      >
        <Globe2 className="mr-1 inline h-3.5 w-3.5" />
        {busy === 'draft' ? '派生中…' : '派生世界草稿'}
      </button>
      {!compact && (
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover disabled:opacity-50"
          disabled={busy != null}
          onClick={() => void derive(true)}
        >
          <LockKeyhole className="mr-1 inline h-3.5 w-3.5" />
          {busy === 'release' ? '封存中…' : '派生并封存 v1'}
        </button>
      )}
      {error && <span className="max-w-80 truncate text-[11px] text-red-600" title={error}>{error}</span>}
    </div>
  )
}
