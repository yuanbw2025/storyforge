import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Project } from '../../lib/types'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'

interface AuthorView {
  project: Project
  activeGroupId: number | null
}

export function worldAuthorViewKey({ project, activeGroupId }: AuthorView): string {
  return `${project.id}:${project.activeWorldId}:${project.activeWorkId}:${project.enableMultiWorld ? activeGroupId ?? 'global' : 'single'}`
}

/** Keep the original editors mounted until their existing draft barrier succeeds. */
export default function ScopedWorldAuthoringBoundary({ project, activeGroupId, children }: AuthorView & {
  children: (view: AuthorView) => ReactNode
}) {
  const desired = { project, activeGroupId }
  const desiredKey = worldAuthorViewKey(desired)
  const latest = useRef(desired)
  latest.current = desired
  const [view, setView] = useState(desired)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const viewKey = worldAuthorViewKey(view)
  const switching = viewKey !== desiredKey

  useEffect(() => {
    if (!switching) return
    let active = true
    setError('')
    void flushPendingEditsV1().then(() => {
      if (active) setView(latest.current)
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : '编辑保存失败')
    })
    return () => { active = false }
  }, [desiredKey, viewKey, switching, retry])

  return <>
    {switching && <div role={error ? 'alert' : 'status'} className="mb-3 rounded border border-warning/40 p-3 text-sm">
      {error
        ? `尚未切换：原世界的输入已保留，请重试保存。${error}`
        : '正在保存原世界的编辑，保存成功后切换。'}
      {error && <button type="button" className="ml-3 underline" onClick={() => setRetry(value => value + 1)}>重试保存并切换</button>}
    </div>}
    <fieldset disabled={switching} inert={switching} className="contents" aria-label="世界编辑作用域保护">
      <Fragment key={viewKey}>{children(switching ? view : desired)}</Fragment>
    </fieldset>
  </>
}
