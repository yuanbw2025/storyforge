import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorldSharingPanel from '../../src/components/product/WorldSharingPanel'
import { db } from '../../src/lib/db/schema'
import type { Project } from '../../src/lib/types'
import * as receipts from '../../src/lib/world-engine/source-receipt'
import * as packages from '../../src/lib/world-engine/world-package'
import * as files from '../../src/lib/export/text-export'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createSfqa021WorldSharingCarrierV1 as fixture } from '../helpers/sfqa021-world-sharing-carrier'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
const releasePending: (() => void)[] = []
const imported = vi.fn()
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  releasePending.push(resolve)
  return { promise, resolve }
}
async function owner(name: string) {
  const value = await seedCurrentWorkspace(name, { purpose: 'world-engine' })
  const project = await db.projects.get(value.scope.projectId)
  if (!project) throw Error('Missing actual World owner')
  return { ...value, project }
}
async function mount(project?: Project, revision = 0) {
  await act(async () => root.render(<WorldSharingPanel project={project} worldReleaseRevision={revision} onImported={imported} />))
}
function button(text: string) {
  const value = [...host.querySelectorAll('button')].find(row => row.textContent?.trim() === text)
  if (!value) throw Error('Actual UI missing button: ' + text)
  return value
}
async function click(text: string) { await act(async () => button(text).click()) }
async function waitFor(check: () => boolean, why: string) {
  const deadline = performance.now() + 2000
  while (!check()) {
    if (performance.now() > deadline) throw Error('Actual UI did not settle: ' + why)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  }
}
function inputFile(wire: string, name = 'source.json') { return new File([wire], name, { type: 'application/json' }) }
async function chooseFile(file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type=file]')
  if (!input) throw Error('Missing actual file picker')
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}
async function ready(wire: string) {
  await chooseFile(inputFile(wire))
  await waitFor(() => host.querySelector('[data-testid="world-package-preview"]')?.textContent?.includes('分享包预检通过') === true, 'verified file preview')
}
function sourceSelect() {
  const value = host.querySelector<HTMLSelectElement>('select[aria-label="选择来源声明"]')
  if (!value) throw Error('Missing explicit R:D source picker')
  return value
}
async function selectSource(key: string) {
  await act(async () => { sourceSelect().value = key; sourceSelect().dispatchEvent(new Event('change', { bubbles: true })) })
}
function sourceDetails() { return host.querySelector('[data-testid="world-source-declaration"]') }
function heldText(file: File) {
  const read = file.text.bind(file), reached = deferred(), ack = deferred()
  const hook = vi.spyOn(file, 'text').mockImplementation(async () => {
    const wire = await read(); reached.resolve(); await ack.promise; return wire
  })
  return { reached, ack, hook }
}
async function packetB(f: Awaited<ReturnType<typeof fixture>>) {
  return packages.createWorldPackage(f.release.id!, { ...f.pkg.manifest, attribution: '第二份声明B',
    allowedUses: { ...f.pkg.manifest.allowedUses, ttrpg: false, avg: true } })
}

beforeEach(async () => {
  await db.delete(); await db.open(); imported.mockReset()
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('F3 isolated UI forbids network/model requests'))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { releasePending.splice(0).forEach(resolve => resolve()); await Promise.resolve() })
  await act(async () => root.unmount()); host.remove(); db.close(); vi.restoreAllMocks()
})

describe('SFQA021 F3 · real World source library UI', () => {
  it('installs remix=false readonly without domain writes, retains both same-R declarations and exact original exports, and still shares its independent own R', async () => {
    const f = await fixture(3), target = await owner('来源库当前世界')
    const revision = await createWorldRevision({ scope: target.scope, label: '独立作者原版', formatVersion: 3 })
    const ownRelease = await publishWorldRevision(revision.id!)
    const beforeWorld = await db.worlds.get(target.scope.worldId), beforeRoots = await db.projects.count()
    const semanticBefore = await Promise.all(PROJECT_TABLES.filter(spec => spec.worldSemantic).map(spec => spec.table.toArray()))
    const download = vi.spyOn(files, 'downloadTextFile').mockResolvedValue(undefined)
    const ownDownload = vi.spyOn(packages, 'downloadWorldPackage').mockImplementation(() => {})
    const wireA = JSON.stringify(f.pkg, null, 2) + '\n', b = await packetB(f), wireB = JSON.stringify(b)
    await mount(target.project); await ready(wireA)
    expect(button('确认导入纯语义世界').disabled).toBe(true)
    await click('保存为只读来源')
    await waitFor(() => Boolean(host.textContent?.includes('已保存只读来源')), 'real readonly install acknowledged')
    await waitFor(() => sourceSelect().options.length === 2, 'one verified source plus empty choice')
    expect(sourceSelect().value).toBe(''); expect(button('下载所选原来源包').disabled).toBe(true)
    expect(await db.projects.count()).toBe(beforeRoots); expect(await db.worlds.get(target.scope.worldId)).toEqual(beforeWorld)
    expect(await Promise.all(PROJECT_TABLES.filter(spec => spec.worldSemantic).map(spec => spec.table.toArray()))).toEqual(semanticBefore)
    expect(await db.worldDerivations.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0); expect(imported).not.toHaveBeenCalled()
    const choicesA = await receipts.listWorldSourceReceiptsV1(target.scope), keyA = choicesA[0].key
    await selectSource(keyA)
    expect(sourceDetails()?.textContent).toContain('跑团：允许')
    expect(sourceDetails()?.querySelector('[aria-label="来源署名要求"]')?.textContent).toBe(f.pkg.manifest.attribution)
    await click('下载所选原来源包')
    await waitFor(() => download.mock.calls.length === 1, 'actual selected raw wire exporter')
    expect(download.mock.calls[0][0]).toBe(wireA)
    await ready(wireB); await click('保存为只读来源')
    await waitFor(() => sourceSelect().options.length === 3, 'two distinct same-R declarations')
    expect(sourceSelect().value).toBe(keyA); expect(sourceDetails()?.textContent).toContain('跑团：允许')
    const choices = await receipts.listWorldSourceReceiptsV1(target.scope), second = choices.find(choice => choice.key !== keyA)
    if (!second) throw Error('Missing real second D')
    expect(choices[0].releaseUid).toBe(choices[1].releaseUid)
    await selectSource(second.key); expect(sourceDetails()?.textContent).toContain('跑团：不允许')
    expect(sourceDetails()?.textContent).toContain('AVG：允许')
    await click('下载所选原来源包'); await waitFor(() => download.mock.calls.length === 2, 'exact second raw export')
    expect(download.mock.calls[1][0]).toBe(wireB)
    const author = host.querySelector<HTMLInputElement>('input[placeholder="例如：林岚"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(author, '独立作者')
      author.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await waitFor(() => !button('下载世界分享包').disabled, 'independent own R share available')
    await click('下载世界分享包'); await waitFor(() => ownDownload.mock.calls.length === 1, 'existing own-R create API still usable')
    expect(ownDownload.mock.calls[0][0].manifest.releaseHash).toBe(ownRelease.contentHash)
    expect(ownDownload.mock.calls[0][0].manifest.authorName).toBe('独立作者')
  })

  it('requires an explicit World for readonly installation and rejects invalid or over-budget files without any write', async () => {
    const f = await fixture(3), counts = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    await mount(); await ready(JSON.stringify(f.pkg))
    expect(button('保存为只读来源').disabled).toBe(true); expect(button('确认导入纯语义世界').disabled).toBe(true)
    await chooseFile(inputFile('not JSON'))
    await waitFor(() => host.textContent?.includes('无法读取分享包') === true, 'invalid file visibly rejected')
    const large = inputFile('{}'); Object.defineProperty(large, 'size', { value: 32 * 1024 * 1024 + 1 })
    await chooseFile(large); await waitFor(() => host.textContent?.includes('超过 32 MiB') === true, 'budget visibly rejected')
    expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(counts)
  })

  it('keeps the later actual file preview when an earlier file.text acknowledgement arrives last', async () => {
    const f = await fixture(3), target = await owner('文件读取次序'), b = await packetB(f)
    await mount(target.project)
    const slow = inputFile(JSON.stringify(f.pkg)), held = heldText(slow)
    await chooseFile(slow); await held.reached.promise
    await ready(JSON.stringify(b))
    await act(async () => { held.ack.resolve(); await held.hook.mock.results[0].value })
    expect(host.querySelector('[data-testid="world-package-preview"]')?.textContent).toContain('第二份声明B')
    await click('保存为只读来源'); await waitFor(() => host.textContent?.includes('已保存只读来源') === true, 'later file installed')
    const rows = await db.worldSourceReceipts.where('worldId').equals(target.scope.worldId).toArray()
    expect(rows).toHaveLength(1); expect(rows[0].wireJson).toBe(JSON.stringify(b))
  })

  it('invalidates an old file read across an owner switch instead of installing its result into the newly selected World', async () => {
    const f = await fixture(3), a = await owner('读取时世界A'), b = await owner('读取时世界B'), next = await packetB(f)
    await mount(a.project)
    const slow = inputFile(JSON.stringify(f.pkg)), held = heldText(slow)
    await chooseFile(slow); await held.reached.promise
    await mount(b.project); await ready(JSON.stringify(next))
    await act(async () => { held.ack.resolve(); await held.hook.mock.results[0].value })
    expect(host.querySelector('[data-testid="world-package-preview"]')?.textContent).toContain('第二份声明B')
    await click('保存为只读来源'); await waitFor(() => host.textContent?.includes('已保存只读来源') === true, 'explicit current World install')
    expect(await db.worldSourceReceipts.where('worldId').equals(a.scope.worldId).count()).toBe(0)
    expect((await db.worldSourceReceipts.where('worldId').equals(b.scope.worldId).first())?.wireJson).toBe(JSON.stringify(next))
  })

  it('does not clear a newer owner/file preview when a real install in the original owner was committed before its held acknowledgement', async () => {
    const f = await fixture(3), a = await owner('保存时世界A'), b = await owner('保存时世界B'), next = await packetB(f)
    const original = receipts.installWorldSourcePackageV1, committed = deferred(), ack = deferred()
    const hook = vi.spyOn(receipts, 'installWorldSourcePackageV1').mockImplementationOnce(async (...args) => {
      const result = await original(...args); committed.resolve(); await ack.promise; return result
    })
    const wire = JSON.stringify(f.pkg, null, 2) + '\n'
    await mount(a.project); await ready(wire); await click('保存为只读来源'); await committed.promise
    expect((await db.worldSourceReceipts.where('worldId').equals(a.scope.worldId).first())?.wireJson).toBe(wire)
    await mount(b.project); await ready(JSON.stringify(next))
    await act(async () => { ack.resolve(); await hook.mock.results[0].value })
    expect(host.querySelector('[data-testid="world-package-preview"]')?.textContent).toContain('第二份声明B')
    expect(await db.worldSourceReceipts.where('worldId').equals(b.scope.worldId).count()).toBe(0)
    expect(imported).not.toHaveBeenCalled()
    await click('保存为只读来源'); await waitFor(() => host.textContent?.includes('已保存只读来源') === true, 'new explicit save still required')
    expect((await db.worldSourceReceipts.where('worldId').equals(b.scope.worldId).first())?.wireJson).toBe(JSON.stringify(next))
  })

  it('keeps a later explicit declaration selection after a slower older library response', async () => {
    const f = await fixture(3), target = await owner('来源库读取次序'), b = await packetB(f)
    await receipts.installWorldSourcePackageV1(target.scope, f.pkg)
    const original = receipts.listWorldSourceReceiptsV1, read = deferred(), ack = deferred()
    const hook = vi.spyOn(receipts, 'listWorldSourceReceiptsV1').mockImplementationOnce(async (...args) => {
      const rows = await original(...args); read.resolve(); await ack.promise; return rows
    })
    await mount(target.project); await act(async () => { await read.promise })
    let installed!: Awaited<ReturnType<typeof receipts.installWorldSourcePackageV1>>
    await act(async () => { installed = await receipts.installWorldSourcePackageV1(target.scope, b) })
    await mount(target.project, 1)
    await waitFor(() => sourceSelect().options.length === 3, 'new library response contains both variants')
    const key = (await original(target.scope)).find(choice => choice.declarationHash === installed.declarationHash)!.key
    await selectSource(key)
    await act(async () => { ack.resolve(); await hook.mock.results[0].value })
    expect(sourceSelect().value).toBe(key); expect(sourceDetails()?.textContent).toContain('第二份声明B')
  })
})
