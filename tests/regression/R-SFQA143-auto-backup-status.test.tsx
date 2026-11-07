import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useParams } from 'react-router'
import { db } from '../../src/lib/db/schema'
import { useBackupStore, AUTO_BACKUP_INTERVAL, backupOwnerKey } from '../../src/stores/backup'
import { useAutoBackup } from '../../src/hooks/useAutoBackup'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { ToastProvider } from '../../src/components/shared/Toast'
import App from '../../src/App'
import AutoBackupStatusNotice from '../../src/components/system/AutoBackupStatusNotice'
import * as projectExport from '../../src/lib/export/json-export'
import { registerPendingDraftFlusherV1 } from '../../src/lib/authoring/pending-edit-coordinator'

// Keep the actual App boundary, timer, exporter and IndexedDB writer. The
// product body is unrelated to the shared backup notice under test.
vi.mock('../../src/components/home/ResumeTracker', () => ({ default: () => null }))
vi.mock('../../src/components/extensions/ProductExtensionEntry', () => ({ default: () => null }))
vi.mock('../../src/pages/HomePage', () => ({ default: () => createElement('p', null, '数据管理目的地') }))
vi.mock('../../src/pages/WorkspacePage', () => ({
  default: function AuthorPage() {
    const { projectId } = useParams()
    useAutoBackup(Number(projectId))
    return createElement('textarea', { 'aria-label': '作者原稿', defaultValue: '尚在编辑的作者文字' })
  },
}))

let root: Root | undefined
let host: HTMLDivElement | undefined

async function settle(condition: () => boolean | Promise<boolean>) {
  for (let index = 0; index < 100; index++) {
    let done = false
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      done = await condition()
    })
    if (done) return
  }
  throw new Error('143 bounded UI/IndexedDB operation did not settle')
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  useBackupStore.setState(useBackupStore.getInitialState(), true)
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  host?.remove()
  host = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  db.close()
})

it('143 the actual shared author surface retains a quota failure past a toast lifetime', async () => {
  const fixture = await seedCurrentWorkspace('143独立自动快照')
  const oldId = await useBackupStore.getState().createSnapshot(fixture.project.id!, '原手动快照', 'manual')
  const failure = vi.spyOn(db.snapshots, 'add').mockRejectedValueOnce(new DOMException('synthetic quota', 'QuotaExceededError'))
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(MemoryRouter,
    { initialEntries: ['/workspace/' + fixture.project.id] },
    createElement(ToastProvider, null, createElement(App)))))
  await act(async () => vi.advanceTimersByTimeAsync(AUTO_BACKUP_INTERVAL))
  await settle(() => failure.mock.calls.length === 1)
  await act(async () => vi.advanceTimersByTimeAsync(4000))
  expect(host.textContent).toContain('自动快照未更新')
  expect(host.textContent).toContain('导出')
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="作者原稿"]')?.value).toBe('尚在编辑的作者文字')
  expect(await db.snapshots.get(oldId)).toBeDefined()
})

it.each(['pruneSnapshots', 'loadSnapshots'] as const)(
  '143 a committed snapshot remains a success when subsequent %s fails',
  async maintenance => {
    const fixture = await seedCurrentWorkspace('143真实提交后维护失败')
    await useBackupStore.getState().loadSnapshots(fixture.project.id!)
    vi.spyOn(useBackupStore.getState(), maintenance).mockRejectedValueOnce(new Error('synthetic maintenance failure'))
    const id = await useBackupStore.getState().createSnapshot(fixture.project.id!, '已提交自动快照', 'auto')
    expect((await db.snapshots.get(id))?.label).toBe('已提交自动快照')
    expect(useBackupStore.getState().autoStatus[backupOwnerKey({
      projectId: fixture.project.id!, workspaceUid: fixture.project.workspaceUid,
    })]).toMatchObject({ state: 'saved', problem: null, snapshotId: id,
      maintenance: [maintenance === 'pruneSnapshots' ? 'prune' : 'refresh'] })
  },
)

async function renderSurface(project: Awaited<ReturnType<typeof seedCurrentWorkspace>>['project'], details = false) {
  if (!host) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }
  await act(async () => root!.render(createElement(MemoryRouter,
    { key: project.id, initialEntries: ['/workspace/' + project.id] },
    createElement(ToastProvider, null, createElement(Fragment, null,
      createElement(App), details ? createElement(AutoBackupStatusNotice, { project }) : null)))))
  await settle(() => !!host?.querySelector('[aria-label="作者原稿"]'))
}

it('143 the same single interval recovers with a real new snapshot and clears its failure', async () => {
  const f = await seedCurrentWorkspace('143原定时器恢复')
  const original = await useBackupStore.getState().createSnapshot(f.project.id!, '保留的手动快照', 'manual')
  const add = vi.spyOn(db.snapshots, 'add').mockRejectedValueOnce(new DOMException('private synthetic text', 'QuotaExceededError'))
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  await renderSurface(f.project)
  expect(vi.getTimerCount()).toBe(1)
  await act(async () => vi.advanceTimersByTimeAsync(AUTO_BACKUP_INTERVAL))
  await settle(() => host!.textContent!.includes('自动快照未更新'))
  expect(host!.textContent).not.toContain('private synthetic text')
  await act(async () => vi.advanceTimersByTimeAsync(AUTO_BACKUP_INTERVAL))
  await settle(async () => (await db.snapshots.where('projectId').equals(f.project.id!).toArray()).some(row => row.type === 'auto'))
  await settle(() => host!.querySelectorAll('[data-auto-backup-notice]').length === 0)
  expect(vi.getTimerCount()).toBe(1)
  expect(add).toHaveBeenCalledTimes(2)
  expect(await db.snapshots.get(original)).toBeDefined()
  const status = useBackupStore.getState().autoStatus[backupOwnerKey({ projectId: f.project.id!, workspaceUid: f.project.workspaceUid })]
  expect(status.state).toBe('saved')
  expect(status.problem).toBeNull()
  expect(await db.snapshots.get(status.snapshotId!)).toBeDefined()
})

it.each(['export', 'serialize', 'write'] as const)('143 %s failure preserves prior snapshots and records no success', async phase => {
  const f = await seedCurrentWorkspace('143各失败边界')
  await useBackupStore.getState().createSnapshot(f.project.id!, '旧快照', 'manual')
  const before = await db.snapshots.toArray()
  const actual = projectExport.exportProjectJSON
  if (phase === 'export') vi.spyOn(projectExport, 'exportProjectJSON').mockRejectedValueOnce(new Error('private export contents'))
  if (phase === 'serialize') vi.spyOn(projectExport, 'exportProjectJSON').mockImplementationOnce(async id =>
    Object.assign(await actual(id), { toJSON() { throw new Error('private serialization contents') } }))
  if (phase === 'write') vi.spyOn(db.snapshots, 'add').mockRejectedValueOnce(new Error('private write contents'))
  await expect(useBackupStore.getState().createSnapshot(f.project.id!, '不能假成功', 'auto')).rejects.toThrow()
  expect(await db.snapshots.toArray()).toEqual(before)
  const status = useBackupStore.getState().autoStatus[backupOwnerKey({ projectId: f.project.id!, workspaceUid: f.project.workspaceUid })]
  expect(status).toMatchObject({ state: 'failed', problem: phase, lastSuccessAt: null, snapshotId: null })
  expect(JSON.stringify(status)).not.toContain('private')
})

it.each([false, true])('143 late old-owner completion cannot overwrite the new view; old attempt fails=%s', async fails => {
  const a = await seedCurrentWorkspace('143原工作区')
  const b = await seedCurrentWorkspace('143新工作区')
  await useBackupStore.getState().createSnapshot(b.project.id!, 'B的手动快照', 'manual')
  const actual = projectExport.exportProjectJSON
  let entered = false
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(projectExport, 'exportProjectJSON').mockImplementationOnce(async id => {
    const result = await actual(id)
    entered = true
    await held
    if (fails) throw new Error('private old-owner failure')
    return result
  })
  await renderSurface(a.project)
  let pending!: Promise<{ id?: number; error?: unknown }>
  await act(async () => { pending = useBackupStore.getState().createSnapshot(a.project.id!, '原A自动快照', 'auto')
    .then(id => ({ id }), error => ({ error })) })
  await settle(() => entered)
  await act(async () => { await useBackupStore.getState().loadSnapshots(b.project.id!) })
  const bRows = useBackupStore.getState().snapshots
  await renderSurface(b.project)
  await settle(() => useBackupStore.getState().activeView?.owner?.workspaceUid === b.project.workspaceUid)
  await act(async () => { release(); await pending })
  expect(useBackupStore.getState().snapshotsOwner?.workspaceUid).toBe(b.project.workspaceUid)
  expect(useBackupStore.getState().snapshots).toEqual(bRows)
  expect(host!.textContent).not.toContain('自动快照未更新')
  expect(host!.textContent).not.toContain('原A自动快照')
  const status = useBackupStore.getState().autoStatus[backupOwnerKey({ projectId: a.project.id!, workspaceUid: a.project.workspaceUid })]
  expect(status.state).toBe(fails ? 'failed' : 'saved')
})

it('143 a changed workspace identity during export cannot create a snapshot under that numeric id', async () => {
  const f = await seedCurrentWorkspace('143身份前像')
  const actual = projectExport.exportProjectJSON
  vi.spyOn(projectExport, 'exportProjectJSON').mockImplementationOnce(async id => {
    const result = await actual(id)
    await db.projects.update(id, { workspaceUid: f.project.workspaceUid + '-changed' })
    return result
  })
  await expect(useBackupStore.getState().createSnapshot(f.project.id!, '旧身份', 'auto', f.project.workspaceUid)).rejects.toThrow('身份')
  expect(await db.snapshots.count()).toBe(0)
})

it('143 cold details read real snapshot facts without inventing a healthy attempt or recursive backup', async () => {
  const f = await seedCurrentWorkspace('143冷启动事实')
  const id = await useBackupStore.getState().createSnapshot(f.project.id!, '真实自动快照', 'auto')
  const row = (await db.snapshots.get(id))!
  expect(Reflect.has(JSON.parse(row.data), 'snapshots')).toBe(false)
  useBackupStore.setState(useBackupStore.getInitialState(), true)
  db.close(); await db.open()
  await renderSurface(f.project, true)
  const key = backupOwnerKey({ projectId: f.project.id!, workspaceUid: f.project.workspaceUid })
  await settle(() => useBackupStore.getState().autoStatus[key]?.snapshotId === id)
  expect(useBackupStore.getState().autoStatus[key]).toMatchObject({ state: 'unverified', lastSuccessAt: row.createdAt, problem: null })
  expect(host!.querySelectorAll('[data-auto-backup-notice]')).toHaveLength(1)
  expect(host!.textContent).toContain('最近可核对的自动快照')
  expect(host!.textContent).toContain('刷新后以真实快照事实为准')
})

it('143 the backup detail replaces the global alert without starting a second interval', async () => {
  const f = await seedCurrentWorkspace('143单一可见提示')
  vi.spyOn(db.snapshots, 'add').mockRejectedValueOnce(new DOMException('synthetic', 'QuotaExceededError'))
  await expect(useBackupStore.getState().createSnapshot(f.project.id!, '失败自动快照', 'auto')).rejects.toThrow()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  await renderSurface(f.project)
  await settle(() => host!.querySelectorAll('[data-auto-backup-notice]').length === 1)
  await renderSurface(f.project, true)
  expect(host!.querySelectorAll('[data-auto-backup-notice]')).toHaveLength(1)
  expect(host!.textContent).toContain('自动快照未更新')
  expect(vi.getTimerCount()).toBe(1)
})

it('143 navigation waits for the existing draft barrier and a failed save keeps the author in place', async () => {
  const f = await seedCurrentWorkspace('143安全导出导航')
  vi.spyOn(db.snapshots, 'add').mockRejectedValueOnce(new DOMException('synthetic', 'QuotaExceededError'))
  await expect(useBackupStore.getState().createSnapshot(f.project.id!, '自动失败', 'auto')).rejects.toThrow()
  const flush = vi.fn(async () => { throw new Error('private draft persistence failure') })
  const unregister = registerPendingDraftFlusherV1(flush)
  try {
    await renderSurface(f.project)
    await settle(() => !!host!.querySelector('[data-auto-backup-notice] a'))
    await act(async () => host!.querySelector<HTMLAnchorElement>('[data-auto-backup-notice] a')!.click())
    expect(flush).toHaveBeenCalledTimes(1)
    expect(host!.querySelector<HTMLTextAreaElement>('[aria-label="作者原稿"]')?.value).toBe('尚在编辑的作者文字')
    expect(host!.textContent).not.toContain('数据管理目的地')
    expect(host!.textContent).not.toContain('private draft persistence failure')
  } finally { unregister() }
})

it.each([false, true])('143 held-save navigation is released only for the same author view; switched=%s', async switched => {
  const f = await seedCurrentWorkspace('143等待保存的导航')
  const next = await seedCurrentWorkspace('143导航的新归属')
  vi.spyOn(db.snapshots, 'add').mockRejectedValueOnce(new DOMException('synthetic', 'QuotaExceededError'))
  await expect(useBackupStore.getState().createSnapshot(f.project.id!, '自动失败', 'auto')).rejects.toThrow()
  let release!: () => void
  const saved = new Promise<void>(resolve => { release = resolve })
  const flush = vi.fn(() => saved)
  const unregister = registerPendingDraftFlusherV1(flush)
  try {
    await renderSurface(f.project)
    await settle(() => !!host!.querySelector('[data-auto-backup-notice] a'))
    await act(async () => host!.querySelector<HTMLAnchorElement>('[data-auto-backup-notice] a')!.click())
    expect(flush).toHaveBeenCalledTimes(1)
    expect(host!.querySelector('[aria-label="作者原稿"]')).not.toBeNull()
    if (switched) await renderSurface(next.project)
    await act(async () => { release(); await saved })
    await settle(() => switched
      ? !!host!.querySelector('[aria-label="作者原稿"]')
      : host!.textContent!.includes('数据管理目的地'))
    expect(host!.textContent!.includes('数据管理目的地')).toBe(!switched)
  } finally { unregister(); release() }
})

it.each(['pruneSnapshots', 'loadSnapshots'] as const)('143 manual %s warning cannot masquerade as an automatic success', async maintenance => {
  const f = await seedCurrentWorkspace('143手动维护边界')
  await useBackupStore.getState().loadSnapshots(f.project.id!)
  vi.spyOn(useBackupStore.getState(), maintenance).mockRejectedValueOnce(new Error('synthetic maintenance failure'))
  const id = await useBackupStore.getState().createSnapshot(f.project.id!, '真实手动快照', 'manual')
  expect(await db.snapshots.get(id)).toBeDefined()
  const status = useBackupStore.getState().autoStatus[backupOwnerKey({ projectId: f.project.id!, workspaceUid: f.project.workspaceUid })]
  expect(status).toMatchObject({ state: 'unverified', lastSuccessAt: null, snapshotId: null, problem: null,
    maintenanceType: 'manual', maintenance: [maintenance === 'pruneSnapshots' ? 'prune' : 'refresh'] })
  await renderSurface(f.project, true)
  expect(host!.textContent).toContain('手动快照已保存，后续维护未完成')
  expect(host!.textContent).not.toContain('自动快照已保存')
})

it('143 cold status does not borrow an old numeric-id snapshot belonging to a different workspace identity', async () => {
  const f = await seedCurrentWorkspace('143本机编号不能证明快照归属')
  await db.snapshots.add({ projectId: f.project.id!, label: '保留但不冒充当前归属',
    type: 'auto', data: JSON.stringify({ project: { workspaceUid: 'other-workspace' } }), size: 1, createdAt: Date.now() })
  await useBackupStore.getState().readAutoBackupStatus(f.project.id!)
  const status = useBackupStore.getState().autoStatus[backupOwnerKey({ projectId: f.project.id!, workspaceUid: f.project.workspaceUid })]
  expect(status).toMatchObject({ state: 'unverified', lastSuccessAt: null, snapshotId: null })
  expect(await db.snapshots.count()).toBe(1)
})

it('143 an identity-read failure after binding remains visible and the same timer can recover', async () => {
  const f = await seedCurrentWorkspace('143身份读取失败')
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  await renderSurface(f.project)
  await settle(() => useBackupStore.getState().activeView?.owner?.workspaceUid === f.project.workspaceUid)
  vi.spyOn(db.projects, 'get').mockRejectedValueOnce(new Error('synthetic private identity read'))
  await act(async () => vi.advanceTimersByTimeAsync(AUTO_BACKUP_INTERVAL))
  await settle(() => host!.textContent!.includes('自动快照未更新'))
  expect(await db.snapshots.count()).toBe(0)
  expect(host!.textContent).not.toContain('synthetic private identity read')
  await act(async () => vi.advanceTimersByTimeAsync(AUTO_BACKUP_INTERVAL))
  await settle(async () => await db.snapshots.count() === 1)
  await settle(() => host!.querySelectorAll('[data-auto-backup-notice]').length === 0)
  expect(vi.getTimerCount()).toBe(1)
})
