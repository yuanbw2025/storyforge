import { act, createElement, StrictMode, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogProvider, useDialog } from '../../src/components/shared/Dialog'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { detectTestEnv, requireBackupBefore, setBackupDialogAdapter } from '../../src/lib/safety/require-backup-before'
import { useProjectStore } from '../../src/stores/project'
import { useWorldGroupStore } from '../../src/stores/world-group'

const { saveFile } = vi.hoisted(() => ({ saveFile: vi.fn<(...args: [Blob, string]) => Promise<void>>() }))
vi.mock('../../src/lib/platform/save-file', () => ({ saveFile }))

let root: Root | undefined
let host: HTMLDivElement
let api: ReturnType<typeof useDialog>

function ExposeDialog() { api = useDialog(); return null }
async function mount(strict = false) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const provider = createElement(DialogProvider, null, createElement(ExposeDialog))
  await act(async () => root!.render(strict ? createElement(StrictMode, null, provider) : provider))
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(element => element.textContent === text)
  expect(button, `button ${text}`).toBeTruthy()
  await act(async () => button!.click())
}
async function dismiss(method: 'close' | 'escape') {
  await act(async () => {
    if (method === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    else host.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click()
  })
}
async function databaseRows() {
  const tables = [...db.tables].sort((a, b) => a.name.localeCompare(b.name))
  return db.transaction('r', tables, async () => JSON.stringify(await Promise.all(tables.map(async table => [table.name, await table.toArray()]))))
}
async function workspace(name = '合成安全确认原稿') {
  return createWorkspace({ name, description: '', genres: [], status: 'drafting', targetWordCount: 10_000 }, { kind: 'novel', novelProfile: 'long' })
}
async function beginDeletion(projectId: number) {
  let settled = false
  let operation!: Promise<void>
  await act(async () => { operation = useProjectStore.getState().deleteProject(projectId).then(() => { settled = true }) })
  expect(host.textContent).toContain('危险操作:删除项目')
  return { operation, settled: () => settled }
}
async function chooseBackup() {
  await click('继续')
  expect(host.textContent).toContain('是否立即下载备份')
}

// Load the real export graph before timing user interaction; cold Vite
// transforms are not evidence that an already authorized download failed.
beforeAll(async () => { await import('../../src/lib/export/json-export') })
beforeEach(async () => {
  await db.delete(); await db.open()
  setBackupDialogAdapter(null)
  saveFile.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No provider/network allowed in safety regression') }))
  // Exercise the real author confirmation path; ordinary automated tests retain
  // their existing explicit bypass. These signals are restored after each case.
  vi.stubEnv('VITEST', '')
  vi.stubEnv('NODE_ENV', 'production')
  expect(detectTestEnv({ vitestFlag: Boolean(import.meta.env.VITEST), processEnv: process.env })).toBe(false)
})
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  host?.remove()
  setBackupDialogAdapter(null)
  vi.unstubAllEnvs(); vi.unstubAllGlobals()
  await db.delete()
})

describe('SFQA-100 real safety dialog and public destructive consumers', () => {
  it.each(['close', 'escape'] as const)('first-step %s cancels deletion without a DB write', async method => {
    const created = await workspace(); await workspace('另一项目保留')
    await mount(); const before = await databaseRows(); const deletion = await beginDeletion(created.scope.projectId)
    await dismiss(method)
    await vi.waitFor(() => expect(deletion.settled()).toBe(true))
    await deletion.operation
    expect(await databaseRows()).toBe(before)
    expect(saveFile).not.toHaveBeenCalled()
  })
  it.each(['close', 'escape'] as const)('backup-step %s is cancellation, never an already-backed-up declaration', async method => {
    const created = await workspace(); await workspace('另一项目保留')
    await mount(); const before = await databaseRows(); const deletion = await beginDeletion(created.scope.projectId)
    await chooseBackup(); await dismiss(method)
    await vi.waitFor(() => expect(deletion.settled()).toBe(true))
    await deletion.operation
    expect(await databaseRows()).toBe(before)
    expect(saveFile).not.toHaveBeenCalled()
  })
  it('an explicit already-backed-up choice still deletes only the selected project', async () => {
    const created = await workspace(); const other = await workspace('另一项目保留')
    await mount(); const otherBefore = await db.projects.get(other.scope.projectId)
    const deletion = await beginDeletion(created.scope.projectId); await chooseBackup(); await click('已备份，继续')
    await act(async () => deletion.operation)
    expect(await db.projects.get(created.scope.projectId)).toBeUndefined()
    expect(await db.projects.get(other.scope.projectId)).toEqual(otherBefore)
    expect(saveFile).not.toHaveBeenCalled()
  })
  it('backup must finish before the public deletion continues', async () => {
    const created = await workspace(); await mount()
    let finish!: () => void
    saveFile.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const deletion = await beginDeletion(created.scope.projectId); await chooseBackup(); await click('立即备份')
    try {
      await vi.waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
      const [blob, filename] = saveFile.mock.calls[0]!
      expect(blob.size).toBeGreaterThan(0); expect(filename).toMatch(/backup-before-删除项目-.*\.json$/)
      expect(deletion.settled()).toBe(false); expect(await db.projects.get(created.scope.projectId)).toBeTruthy()
      await act(async () => { finish(); await deletion.operation })
      expect(await db.projects.get(created.scope.projectId)).toBeUndefined()
    } finally { finish?.() }
  })
  it.each(['close', 'escape', 'explicit-proceed'] as const)('failed backup requires a new explicit authorization: %s', async choice => {
    const created = await workspace(); await mount(); const before = await databaseRows()
    saveFile.mockRejectedValueOnce(new Error('synthetic disk failure'))
    const deletion = await beginDeletion(created.scope.projectId); await chooseBackup(); await click('立即备份')
    await vi.waitFor(() => expect(host.textContent).toContain('备份下载失败，仍要继续'))
    if (choice === 'explicit-proceed') await click('仍要继续')
    else await dismiss(choice)
    await vi.waitFor(() => expect(deletion.settled()).toBe(true))
    await deletion.operation
    if (choice === 'explicit-proceed') expect(await db.projects.get(created.scope.projectId)).toBeUndefined()
    else expect(await databaseRows()).toBe(before)
    expect(saveFile).toHaveBeenCalledTimes(1)
  })
  it.each(['first', 'backup'] as const)('provider unmount cancels the unresolved %s step and settles its caller', async step => {
    const created = await workspace(); await mount(); const before = await databaseRows()
    const deletion = await beginDeletion(created.scope.projectId); if (step === 'backup') await chooseBackup()
    await act(async () => root!.unmount()); root = undefined
    await vi.waitFor(() => expect(deletion.settled()).toBe(true))
    await deletion.operation
    expect(await databaseRows()).toBe(before)
    expect(saveFile).not.toHaveBeenCalled()
    await expect(api.confirm('removed provider cannot grant authority')).resolves.toBe(false)
  })
  it.each(['first', 'backup'] as const)('a replacement dialog cancels the unresolved %s operation', async step => {
    const created = await workspace(); await mount(); const before = await databaseRows()
    const deletion = await beginDeletion(created.scope.projectId); if (step === 'backup') await chooseBackup()
    let replacement!: Promise<void>
    await act(async () => { replacement = api.alert('independent replacement') })
    await vi.waitFor(() => expect(deletion.settled()).toBe(true))
    await deletion.operation
    expect(host.textContent).toContain('independent replacement')
    expect(await databaseRows()).toBe(before)
    await click('知道了'); await replacement
  })
  it('a stale button from a replaced dialog cannot confirm the current one', async () => {
    await mount(); let first!: Promise<boolean>; let second!: Promise<boolean>; let secondSettled = false
    await act(async () => { first = api.confirm('old question') })
    const staleConfirm = [...host.querySelectorAll('button')].find(button => button.textContent === '确认')!
    await act(async () => { second = api.confirm('new question').then(value => { secondSettled = true; return value }); staleConfirm.click() })
    await expect(first).resolves.toBe(false)
    expect(secondSettled).toBe(false); expect(host.textContent).toContain('new question')
    await click('确认'); await expect(second).resolves.toBe(true)
  })
  it('Escape cancels the actual world-group reassignment consumer without changing rows', async () => {
    const created = await workspace(); await mount(); const before = await databaseRows()
    let operation!: Promise<boolean>; let settled = false
    await act(async () => { operation = useWorldGroupStore.getState().enableMultiWorld(created.scope).then(value => { settled = true; return value }) })
    await vi.waitFor(() => expect(host.textContent).toContain('危险操作:启用多世界模式'))
    await chooseBackup(); await dismiss('escape')
    await vi.waitFor(() => expect(settled).toBe(true)); await expect(operation).resolves.toBe(false)
    expect(await databaseRows()).toBe(before)
  })
  it('ordinary confirm, prompt and alert retain their public return contracts', async () => {
    await mount(); let result!: Promise<boolean>
    await act(async () => { result = api.confirm('ordinary confirm') }); await click('取消'); await expect(result).resolves.toBe(false)
    let text!: Promise<string | null>
    await act(async () => { text = api.prompt({ title: 'ordinary prompt', defaultValue: '作者输入' }) }); await click('确认'); await expect(text).resolves.toBe('作者输入')
    await act(async () => { text = api.prompt('cancel prompt') }); await dismiss('escape'); await expect(text).resolves.toBeNull()
    let alert!: Promise<void>
    await act(async () => { alert = api.alert('ordinary alert') }); await dismiss('close'); await expect(alert).resolves.toBeUndefined()
  })
  it.each(['close', 'explicit-already'] as const)('actual main StrictMode retains the public deletion decision: %s', async choice => {
    const created = await workspace(); await mount(true); const before = await databaseRows()
    const deletion = await beginDeletion(created.scope.projectId); await chooseBackup()
    if (choice === 'close') await dismiss('close')
    else await click('已备份，继续')
    await act(async () => deletion.operation)
    if (choice === 'close') expect(await databaseRows()).toBe(before)
    else expect(await db.projects.get(created.scope.projectId)).toBeUndefined()
  })
  it('StrictMode cancels the old child mount question and leaves the live question answerable', async () => {
    const questions: Promise<boolean>[] = []
    function AskOnMount() {
      const dialog = useDialog()
      useEffect(() => { questions.push(dialog.confirm('child mount question')) }, [dialog])
      return null
    }
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => root!.render(createElement(StrictMode, null, createElement(DialogProvider, null, createElement(AskOnMount)))))
    expect(questions).toHaveLength(2)
    await expect(questions[0]).resolves.toBe(false)
    expect(host.querySelector('[role="dialog"]')).toBeTruthy()
    await click('确认')
    await expect(questions[1]).resolves.toBe(true)
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('SFQA-100 native fallback requires an explicit backup declaration', () => {
  it.each([
    { answers: [false], proceed: false, calls: 1 },
    { answers: [true, false, false], proceed: false, calls: 3 },
    { answers: [true, false, true], proceed: true, calls: 3 },
    { answers: [true, true], proceed: true, calls: 2 },
  ])('native choices $answers return $proceed with $calls confirmations', async ({ answers, proceed, calls }) => {
    const created = await workspace(); const before = await databaseRows()
    const confirm = vi.fn(() => answers.shift() ?? false); vi.stubGlobal('confirm', confirm)
    await expect(requireBackupBefore({ operation: '删除项目', projectId: created.scope.projectId })).resolves.toBe(proceed)
    expect(confirm).toHaveBeenCalledTimes(calls)
    expect(saveFile).toHaveBeenCalledTimes(proceed && calls === 2 ? 1 : 0)
    expect(await databaseRows()).toBe(before)
  })
  it('nested adapter cleanup restores the previous owner and a missing project uses only explicit confirmation', async () => {
    const first = { chooseBackup: vi.fn(async () => 'cancel' as const), confirm: vi.fn(async () => false) }
    const second = { chooseBackup: vi.fn(async () => 'proceed-already-backed-up' as const), confirm: vi.fn(async () => true) }
    const removeFirst = setBackupDialogAdapter(first); const removeSecond = setBackupDialogAdapter(second)
    await expect(requireBackupBefore({ operation: 'test owner' })).resolves.toBe(true)
    removeSecond(); await expect(requireBackupBefore({ operation: 'test owner' })).resolves.toBe(false)
    removeFirst(); await mount(); let operation!: Promise<boolean>
    await act(async () => { operation = requireBackupBefore({ operation: 'no project' }) })
    await click('继续'); await expect(operation).resolves.toBe(true); expect(saveFile).not.toHaveBeenCalled()
  })
})
