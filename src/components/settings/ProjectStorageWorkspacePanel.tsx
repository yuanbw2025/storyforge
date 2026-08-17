import { useEffect, useState } from 'react'
import { FolderOpen, HardDrive, Loader2, RefreshCw, ShieldAlert, Unplug } from 'lucide-react'
import type { Project } from '../../lib/types'
import {
  ensureFolderPermission,
  folderPermissionGranted,
  isFSASupported,
  pickFolder,
} from '../../lib/storage/folder-backup'
import {
  clearProjectFolderHandle,
  loadProjectFolderHandle,
} from '../../lib/storage/folder-handle-store'
import { bindProjectStorageWorkspace } from '../../lib/storage/project-storage-workspace'

interface Props {
  project?: Project
  onOpenDataManagement?: () => void
}

type Notice = { kind: 'success' | 'error'; text: string } | null

export default function ProjectStorageWorkspacePanel({ project, onOpenDataManagement }: Props) {
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const supported = isFSASupported()

  useEffect(() => {
    let cancelled = false
    setHandle(null)
    setNeedsAuth(false)
    setNotice(null)
    if (!project) return () => { cancelled = true }
    void (async () => {
      const stored = await loadProjectFolderHandle(project)
      if (!stored || cancelled) return
      const granted = await folderPermissionGranted(stored)
      if (cancelled) return
      setHandle(stored)
      setNeedsAuth(!granted)
    })()
    return () => { cancelled = true }
  }, [project])

  const chooseLocation = async () => {
    if (!project) return
    setBusy(true)
    setNotice(null)
    try {
      const selected = await pickFolder({
        id: 'storyforge-project-location',
        startIn: handle ?? undefined,
      })
      if (!selected) return
      if (!(await ensureFolderPermission(selected))) {
        setNotice({ kind: 'error', text: '没有获得该文件夹的读写权限。' })
        return
      }
      const replaced = handle != null
      await bindProjectStorageWorkspace(project, selected)
      setHandle(selected)
      setNeedsAuth(false)
      setNotice({
        kind: 'success',
        text: replaced
          ? `存储位置已改为“${selected.name}”。原文件夹没有被删除；新位置尚未写入，请前往数据管理核对并确认。`
          : `已将“${selected.name}”设为项目存储工作区。尚未写入任何文件。`,
      })
    } catch (error) {
      setNotice({ kind: 'error', text: `保存位置失败：${(error as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  const reauthorize = async () => {
    if (!handle) return
    setBusy(true)
    setNotice(null)
    try {
      const granted = await ensureFolderPermission(handle)
      setNeedsAuth(!granted)
      setNotice(granted
        ? { kind: 'success', text: '文件夹权限已恢复；没有自动读取或写入文件。' }
        : { kind: 'error', text: '没有获得该文件夹的读写权限。' })
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!project) return
    setBusy(true)
    setNotice(null)
    try {
      await clearProjectFolderHandle(project)
      setHandle(null)
      setNeedsAuth(false)
      setNotice({ kind: 'success', text: '已解除关联；硬盘上的原文件不会被删除。' })
    } catch (error) {
      setNotice({ kind: 'error', text: `解除关联失败：${(error as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="max-w-2xl rounded-xl border border-border bg-bg-surface p-4" data-testid="project-storage-workspace-settings">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-lg bg-orange-500/10 p-2 text-orange-400"><HardDrive className="h-5 w-5" /></div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">项目存储工作区</h3>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            项目的可读内容、记忆和恢复证据都跟随这个文件夹。你可以把它放在 D 盘或任意本地硬盘位置。
          </p>
        </div>
      </div>

      {!project ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-text-muted">
          请先进入一个项目，再为它设置存储位置。
        </div>
      ) : !supported ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs text-amber-300">
          当前浏览器不支持直接绑定本地文件夹。仍可在数据管理中导出、导入自校验工作区包。
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-bg-base px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {needsAuth ? <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" /> : <FolderOpen className="h-4 w-4 shrink-0 text-green-400" />}
                <div className="min-w-0">
                  <p className="truncate text-sm text-text-primary">
                    {handle ? handle.name : '尚未设置项目文件夹'}
                  </p>
                  <p className="text-[11px] text-text-muted">
                    {handle
                      ? needsAuth ? '已记住位置，需要重新授权' : '已关联；浏览器出于隐私不会显示完整盘符路径'
                      : '项目目前只保存在此浏览器中'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {needsAuth && handle && (
                  <button type="button" onClick={() => void reauthorize()} disabled={busy} className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/10 disabled:opacity-40">
                    重新授权
                  </button>
                )}
                <button type="button" onClick={() => void chooseLocation()} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-40">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
                  {handle ? '更换位置' : '选择项目文件夹'}
                </button>
              </div>
            </div>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            选择或更换位置只保存文件夹授权，不会自动覆盖任何文件。请在数据管理中人工检查差异后再确认同步。
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {handle && onOpenDataManagement && (
              <button type="button" onClick={onOpenDataManagement} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:border-accent hover:text-accent">
                <RefreshCw className="h-3.5 w-3.5" />核对与同步
              </button>
            )}
            {handle && (
              <button type="button" onClick={() => void disconnect()} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:border-error/60 hover:text-error disabled:opacity-40">
                <Unplug className="h-3.5 w-3.5" />解除关联
              </button>
            )}
          </div>
        </>
      )}

      {notice && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${notice.kind === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-error/10 text-error'}`}>
          {notice.text}
        </p>
      )}
    </section>
  )
}
