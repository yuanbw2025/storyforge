import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ImportDocPanel from '../../src/components/system/ImportDocPanel'
import ImportConfirmModal from '../../src/components/system/import/ImportConfirmModal'
import { detectReferenceDuplicatesV1, REFERENCE_DUPLICATE_RULE_V1 } from '../../src/lib/import/dedup'
import { quickHash } from '../../src/lib/import/chunker'
import { db } from '../../src/lib/db/schema'
import * as scopeApi from '../../src/lib/workspace/scope'
import { useReferenceStore } from '../../src/stores/reference'
import { useImportStatusStore } from '../../src/stores/import-status'
import { addCurrentWorkFixtureV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import type { WorkspaceScope } from '../../src/lib/types'

vi.mock('../../src/components/shared/Dialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }))
vi.mock('../../src/components/shared/Toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../src/components/system/import/useImportSessionRecovery', () => ({ default: () => ({
  unfinished: null, reusable: null, blobRestored: false, restoringBlob: false,
  clearUnfinished: vi.fn(), clearReusable: vi.fn(), markBlobRestored: vi.fn(),
}) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
const content = '第一章 海港\n这是供作者确认的原文。'
const baseProps = { filename: '海港.txt', totalChars: content.length,
  chunks: [{ index: 0, startChar: 0, endChar: content.length, charCount: content.length, text: content }],
  chunkSize: 50000, onChunkSizeChange: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn() }
beforeEach(async () => {
  await db.delete(); await db.open(); useImportStatusStore.getState().reset()
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Unexpected model or external request') }))
})
afterEach(async () => {
  for (const ui of mounted.splice(0)) { await act(async () => ui.root.unmount()); ui.host.remove() }
  expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete()
})
async function mount(element: React.ReactElement) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  mounted.push({ host, root }); await act(async () => root.render(element)); return host
}
async function click(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll('button')].find(node => node.textContent?.includes(label))!
  expect(button).toBeTruthy(); await act(async () => button.click())
}
async function confirmation(host: HTMLElement) {
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(host.querySelector('[data-target="reference"]')).not.toBeNull()
  })
}
async function upload(host: HTMLElement, filename = '海港.txt', text = content) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
  const file = new File([text], filename, { type: 'text/plain' })
  Object.defineProperty(file, 'text', { value: async () => text })
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe(text))
}
async function add(scope: WorkspaceScope, title: string, fileHash?: string) {
  return useReferenceStore.getState().addReference({ projectId: scope.projectId, title, author: '', type: 'story', note: '', url: '', fileHash }, scope)
}
const duplicates = () => detectReferenceDuplicatesV1({ existingReferences: [{ id: 3, title: '旧参考', fileHash: 'exact' }], incomingTitle: '新文件', incomingFileHash: 'exact' })

it('prioritizes exact source hashes per row and exposes every matching reference without mutating inputs', () => {
  const existing = Object.freeze([Object.freeze({ id: 1, title: '不同书名', fileHash: 'Exact' }), Object.freeze({ id: 2, title: ' Ａ 书 ', fileHash: 'other' })])
  expect(detectReferenceDuplicatesV1({ existingReferences: existing, incomingTitle: 'a书', incomingFileHash: 'Exact' }))
    .toMatchObject([{ existingId: 1, reason: 'same-file' }, { existingId: 2, reason: 'same-name' }])
  expect(detectReferenceDuplicatesV1({ existingReferences: existing, incomingTitle: '另一本', incomingFileHash: 'exact' })).toEqual([])
})
it('does not invent missing hash matches, blank names or unrelated references', () => {
  expect(detectReferenceDuplicatesV1({ existingReferences: [{ title: '甲' }], incomingTitle: '甲' })[0].reason).toBe('same-name')
  expect(detectReferenceDuplicatesV1({ existingReferences: [{ title: '甲' }], incomingTitle: '乙' })).toEqual([])
  expect(detectReferenceDuplicatesV1({ existingReferences: [{ title: '甲', fileHash: 'same' }], incomingTitle: ' ', incomingFileHash: 'same' })).toEqual([])
})
it('shows the warning only inside the reference option and preserves both explicit confirm paths and cancel', async () => {
  const onConfirm = vi.fn(), onCancel = vi.fn()
  const host = await mount(createElement(ImportConfirmModal, { ...baseProps, referenceDuplicates: duplicates(), onConfirm, onCancel }))
  const status = host.querySelector('[role="status"]')!
  expect(status.closest('[data-target="reference"]')).not.toBeNull()
  expect(status.textContent).toContain('同一原件「新文件」已作为参考存在')
  expect(status.textContent).toContain(REFERENCE_DUPLICATE_RULE_V1)
  await click(host, '导入当前项目'); expect(onConfirm).toHaveBeenLastCalledWith('project', null)
  await click(host, '导入项目参考 ·'); expect(onConfirm).toHaveBeenLastCalledWith('reference', null, 'quick')
  await click(host, '取消'); expect(onCancel).toHaveBeenCalledOnce()
})
it('keeps the modal free of duplicate warnings when the optional list is absent or empty', async () => {
  for (const referenceDuplicates of [undefined, []]) {
    const host = await mount(createElement(ImportConfirmModal, { ...baseProps, referenceDuplicates }))
    expect(host.querySelector('[role="status"]')).toBeNull()
  }
})
it('wires the actual import panel to the target Work only, without writes or model calls before confirmation', async () => {
  const { project, scope } = await seedCurrentWorkspace('032 reference current')
  const work = await addCurrentWorkFixtureV1({ projectId: scope.projectId, worldId: scope.worldId, create: { title: '其他作品' } })
  const foreign = await seedCurrentWorkspace('032 reference foreign')
  await add(scope, '本作品参考', quickHash(content))
  await add({ ...scope, workId: work.id! }, '其他作品参考', quickHash(content))
  await add(foreign.scope, '其他项目参考', quickHash(content))
  const before = await db.references.toArray()
  const host = await mount(createElement(ImportDocPanel, { project }))
  await upload(host); await click(host, '开始解析'); await confirmation(host)
  const status = host.querySelector('[data-target="reference"] [role="status"]')!
  expect(status.textContent).toContain('检测到 1 处重复/同名参考')
  expect(status.textContent).toContain('本作品参考')
  expect(status.textContent).not.toContain('其他作品参考'); expect(status.textContent).not.toContain('其他项目参考')
  await click(host, '取消')
  expect(await db.references.toArray()).toEqual(before); expect(await db.importSessions.count()).toBe(0)
})
it('matches the existing publication filename-to-title rule when content hashes differ', async () => {
  const { project, scope } = await seedCurrentWorkspace()
  await add(scope, '海港', 'different-content')
  const host = await mount(createElement(ImportDocPanel, { project }))
  await upload(host); await click(host, '开始解析'); await confirmation(host)
  expect(host.querySelector('[data-target="reference"] [role="status"]')?.textContent).toContain('同名参考「海港」已存在')
  expect(await db.importSessions.count()).toBe(0)
})
it('leaves confirmation available without a misleading warning when the optional reference read fails', async () => {
  const { project, scope } = await seedCurrentWorkspace(); await add(scope, '海港', quickHash(content))
  const reject = () => { throw Error('reference-read-unavailable') }
  db.references.hook('reading', reject)
  try {
    const host = await mount(createElement(ImportDocPanel, { project })); await upload(host); await click(host, '开始解析'); await confirmation(host)
    expect(host.textContent).toContain('即将开始大文档分块解析')
    expect(host.querySelector('[data-target="reference"] [role="status"]')).toBeNull()
  } finally { db.references.hook('reading').unsubscribe(reject) }
  expect(await db.importSessions.count()).toBe(0)
})
it('does not publish a late duplicate list or open confirmation for a replaced source file', async () => {
  const { project, scope } = await seedCurrentWorkspace(); await add(scope, '旧参考', quickHash(content))
  const ownedRead = scopeApi.readOwnedRows
  let release!: (rows: unknown[]) => void
  const held = new Promise<unknown[]>(resolve => { release = resolve })
  vi.spyOn(scopeApi, 'readOwnedRows').mockImplementation((...args) => args[1] === 'references' ? held : Reflect.apply(ownedRead, undefined, args))
  const host = await mount(createElement(ImportDocPanel, { project })); await upload(host); await click(host, '开始解析')
  await vi.waitFor(() => expect(scopeApi.readOwnedRows).toHaveBeenCalledWith(scope, 'references', { owner: 'work' }))
  await upload(host, '新文档.txt', '第二份待确认原文')
  await act(async () => release([{ title: '旧参考', fileHash: quickHash(content) }]))
  expect(host.textContent).not.toContain('即将开始大文档分块解析')
  expect(host.querySelector('[data-target="reference"]')).toBeNull(); expect(await db.importSessions.count()).toBe(0)
})
