import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { backupOwnerKey, readBackupOwner, useBackupStore, type BackupOwner } from '../../stores/backup'
import type { Project } from '../../lib/types'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'

type OwnerProject = Pick<Project, 'id' | 'workspaceUid'>

/** A shared author surface, never a second backup timer. */
export default function AutoBackupStatusNotice({ project }: { project?: OwnerProject }) {
  return project?.id
    ? <BackupDetails owner={{ projectId: project.id, workspaceUid: project.workspaceUid }} />
    : <GlobalBackupNotice />
}

function GlobalBackupNotice() {
  const { key } = useLocation()
  const active = useBackupStore(state => state.activeView)
  const details = useBackupStore(state => state.detailOwnerKey)
  if (!active?.owner || active.routeKey !== key || details === backupOwnerKey(active.owner)) return null
  return <Status owner={active.owner} compact />
}

function BackupDetails({ owner }: { owner: BackupOwner }) {
  const showDetails = useBackupStore(state => state.showBackupDetails)
  const readStatus = useBackupStore(state => state.readAutoBackupStatus)
  const { projectId, workspaceUid } = owner
  useLayoutEffect(() => showDetails({ projectId, workspaceUid }), [projectId, workspaceUid, showDetails])
  useEffect(() => {
    void readStatus(projectId).catch(() => { /* Unknown is not success. */ })
  }, [projectId, workspaceUid, readStatus])
  return <Status owner={owner} />
}

function Status({ owner, compact = false }: { owner: BackupOwner; compact?: boolean }) {
  const status = useBackupStore(state => state.autoStatus[backupOwnerKey(owner)])
  const createSnapshot = useBackupStore(state => state.createSnapshot)
  const problem = status?.problem
  const maintenance = status?.maintenance ?? []
  const navigate = useNavigate()
  const location = useLocation()
  const frameKey = backupOwnerKey(owner) + ':' + location.key
  const currentFrame = useRef(frameKey)
  currentFrame.current = frameKey
  const active = useRef(true)
  const [navigationError, setNavigationError] = useState('')
  useEffect(() => {
    active.current = true
    setNavigationError('')
    return () => { active.current = false }
  }, [frameKey])
  const openBackup = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    try {
      await flushPendingEditsV1()
      const actual = await readBackupOwner(owner.projectId)
      if (!active.current || currentFrame.current !== frameKey) return
      if (actual.workspaceUid !== owner.workspaceUid) throw new Error('工作区身份已改变。')
      navigate('/home/data?project=' + owner.projectId)
    } catch {
      if (active.current && currentFrame.current === frameKey) setNavigationError('未能确认当前原稿保存与工作区状态，已停止跳转。请保留当前输入后重试。')
    }
  }
  if (compact && !problem && maintenance.length === 0) return null
  const retry = () => {
    void createSnapshot(owner.projectId, '作者重试自动快照', 'auto', owner.workspaceUid).catch(() => {
      // The original owner retains a safe failure; another owner is never used.
    })
  }
  const latest = status?.lastSuccessAt != null
    ? '最近可核对的自动快照：' + new Date(status.lastSuccessAt).toLocaleString('zh-CN')
    : '尚无可核对的自动快照。'
  return <aside data-auto-backup-notice role={problem ? 'alert' : 'status'} aria-label="自动快照状态"
    className={compact
      ? 'fixed bottom-4 left-4 z-[9998] max-w-md rounded border border-warning/50 bg-bg-surface p-4 text-sm shadow-lg'
      : 'rounded border border-border bg-bg-surface p-3 text-sm'}>
    {problem ? <>
      <strong>自动快照未更新{status?.state === 'saving' ? '，正在重试…' : ''}</strong>
      <p>{problem === 'quota' ? '可用存储空间不足。' : '本次自动快照未能保存。'}作者原稿和已有快照未因此删除。</p>
      <p>先导出完整项目备份到外部位置，再在版本历史中安全清理不再需要的快照。不要清除站点数据。</p>
    </> : maintenance.length > 0 ? <>
      <strong>{status?.maintenanceType === 'manual' ? '手动' : '自动'}快照已保存，后续维护未完成</strong>
      <p>{maintenance.includes('prune') ? '旧自动快照清理失败。' : ''}{maintenance.includes('refresh') ? '快照列表刷新失败。' : ''}新快照已经写入，可到版本历史重新读取。</p>
    </> : <strong>{status?.state === 'saving' ? '正在创建自动快照…' : '自动快照记录'}</strong>}
    <p>{latest}</p>
    {!compact && <p>仅在当前浏览器保存；历史失败只保留于本次会话，刷新后以真实快照事实为准，不代表每次编辑都已备份。</p>}
    <div className="mt-2 flex flex-wrap gap-3">
      <Link to={'/home/data?project=' + owner.projectId} onClick={event => { void openBackup(event) }}>导出与管理备份</Link>
      {(problem || maintenance.length > 0) && <button type="button" disabled={status?.state === 'saving'} onClick={retry}>重试自动快照</button>}
    </div>
    {navigationError && <p>{navigationError}</p>}
  </aside>
}
