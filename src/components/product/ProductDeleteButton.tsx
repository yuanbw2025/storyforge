import { useState } from 'react'
import { useDialog } from '../shared/Dialog'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { deleteWork } from '../../lib/workspace/lifecycle'
import { deleteTextAdventureDraftV1 } from '../../lib/product-production/delete-draft'
import type { ProductProductionRecordV1, Work, WorkspaceScope } from '../../lib/types'

function ConfirmDeleteButton(props: { title: string; message: string; label: string; disabled?: boolean; remove(): Promise<void>; onDeleted?(): void | Promise<void> }) {
  const dialog = useDialog()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div>
    <button type="button" className="lf-action" disabled={busy || props.disabled} onClick={() => { void (async () => {
      setBusy(true); setError('')
      try {
        if (!await dialog.confirm({ title: props.title, message: props.message, confirmText: props.label, tone: 'danger' })) return
        await flushPendingEditsV1()
        await props.remove()
        await props.onDeleted?.()
      } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败，请刷新后重试。') }
      finally { setBusy(false) }
    })() }}>{props.label}</button>
    {error && <p role="alert" className="text-xs text-error">{error}</p>}
  </div>
}

export function DeleteProductWorkButton(props: { work: Work; disabled?: boolean; onDeleted?(): void | Promise<void> }) {
  // Legacy production rows can refer to a novel; never offer to delete its owner.
  if (props.work.kind !== 'avg' && props.work.kind !== 'ttrpg') return null
  return <ConfirmDeleteButton title={`删除作品“${props.work.title}”？`} label="删除作品" disabled={props.disabled}
    message="将永久删除这部作品的方案、制作版本、媒资、发布记录与存档。世界和其他作品保留。此操作不可撤销，建议先导出备份。"
    remove={() => deleteWork(props.work.id!, { expected: props.work })} onDeleted={props.onDeleted} />
}

export function DeleteTextAdventureDraftButton(props: { scope: WorkspaceScope; production: ProductProductionRecordV1; disabled?: boolean; onDeleted?(): void | Promise<void> }) {
  if (props.production.productType !== 'text-adventure' || !['consulting', 'brief-ready'].includes(props.production.status)) return null
  return <ConfirmDeleteButton title={`删除制作草稿“${props.production.title}”？`} label="删除草稿" disabled={props.disabled}
    message="只删除这份尚未开始制作的方案。原小说、世界及其他制作记录保留；已有执行记录的版本不能在这里删除。"
    remove={() => deleteTextAdventureDraftV1(props.scope, props.production)} onDeleted={props.onDeleted} />
}
