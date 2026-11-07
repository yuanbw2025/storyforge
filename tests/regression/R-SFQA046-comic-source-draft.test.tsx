import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createAdaptation, listActiveSourceUnits } from '../../src/lib/adaptation/source-manifest'
import { adoptComicVisualBibleV1 } from '../../src/lib/comic/production'
import * as authoring from '../../src/lib/comic/authoring'
import { flushCandidateDraftsV1, resetCandidateDraftCoordinatorForTestsV1 } from '../../src/lib/agent/candidate-draft-coordinator'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import * as pendingEdits from '../../src/lib/authoring/pending-edit-coordinator'
import type { AdaptationProject } from '../../src/lib/types'
import ComicSourcePanel from '../../src/components/comic/ComicSourcePanel'

type ComicRoot = AdaptationProject & { medium: 'comic' }
type Fixture = Awaited<ReturnType<typeof fixture>>
let mounted: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement
const releases: (() => void)[] = []
const actualRead = authoring.readComicAuthorDraft
const actualFormalSave = authoring.updateComicTargetSpecV1
const actualFlush = pendingEdits.flushPendingEditsV1
let nextRead: typeof actualRead | undefined
const reads: Promise<unknown>[] = [], flushes: Promise<unknown>[] = [], formalWrites: Promise<unknown>[] = []

function gate() {
  let release!: () => void
  const promise = new Promise<void>(done => { release = done })
  releases.push(release)
  return { promise, release }
}

async function fixture(audience = '原始目标读者') {
  const source = await createWorkspace({ name: '漫画来源', description: '', genres: ['other'], status: 'drafting', targetWordCount: 10_000 },
    { purpose: 'independent-work', kind: 'novel', novelProfile: 'long', importedNovelText: '暴雨中，作者确认的人物主动走入旧车站。' })
  const targetSpec = { ...authoring.defaultComicTargetSpec(), audience }
  const created = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: audience, sourceSelection: { mode: 'entire-work' }, medium: 'comic', targetSpec })
  if (created.adaptation.medium !== 'comic') throw new Error('测试漫画根无效')
  return { scope: created.scope, root: created.adaptation as ComicRoot }
}

async function visualMetadata(f: Fixture): Promise<Fixture> {
  const unit = (await listActiveSourceUnits(f.root.id!)).find(row => row.sourceKind !== 'work')
  if (!unit) throw new Error('Expected the real frozen source unit')
  await adoptComicVisualBibleV1({ scope: f.scope, expectedAdaptationRevision: f.root.revision,
    sourceManifestVersion: f.root.activeSourceManifestVersion, candidate: {
      global: { version: 1, artDirection: '旧车站的克制色调', linework: '清晰轮廓', palette: ['蓝灰'],
        lighting: '雨中柔光', periodAndMaterials: '旧车站', cameraLanguage: ['稳定画面'], prohibitedDepictions: [] },
      subjects: [{ stableKey: 'station-style', kind: 'style', label: '车站色调',
        design: { description: '阴雨中的车站', silhouette: '清晰轮廓', facialFeatures: '不适用', hairAndCostume: '不适用',
          palette: ['蓝灰'], materials: ['石材'], distinguishingMarks: [], prohibitedChanges: [] }, sourceUnitKeys: [unit.sourceUnitKey] }],
    } })
  const row = await db.adaptationProjects.get(f.root.id!)
  if (!row || row.medium !== 'comic') throw new Error('Expected the actual metadata revision')
  return { ...f, root: { ...row, medium: 'comic' } }
}

async function draw(f: Fixture, awaitRead = true) {
  const start = reads.length
  await act(async () => mounted!.render(createElement(ComicSourcePanel, { scope: f.scope, root: f.root, units: [], onChanged: async () => {} })))
  if (awaitRead) await act(async () => { await Promise.allSettled(reads.slice(start)) })
}
function input() { return [...host.querySelectorAll('label')].find(label => label.textContent?.startsWith('目标读者'))!.querySelector('input')! }
async function fill(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function save() {
  const flushStart = flushes.length, formalStart = formalWrites.length
  await act(async () => {
    [...host.querySelectorAll('button')].find(button => button.textContent === '保存制作规格')!.click()
    await Promise.allSettled(flushes.slice(flushStart))
    await Promise.resolve()
    await Promise.allSettled(formalWrites.slice(formalStart))
  })
}
async function expectFormal(f: Fixture, audience: string) {
  await vi.waitFor(async () => {
    const row = await db.adaptationProjects.get(f.root.id!)
    expect(row?.targetSpec).toMatchObject({ audience })
    expect(row?.revision).toBe(f.root.revision + 1)
  })
}

beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  resetCandidateDraftCoordinatorForTestsV1(); resetPendingEditCoordinatorForTestsV1()
  nextRead = undefined; reads.length = 0; flushes.length = 0; formalWrites.length = 0
  vi.spyOn(authoring, 'readComicAuthorDraft').mockImplementation((...args) => {
    const read = nextRead ?? actualRead; nextRead = undefined
    const promise = read(...args); reads.push(promise); return promise
  })
  vi.spyOn(authoring, 'updateComicTargetSpecV1').mockImplementation((...args) => {
    const promise = actualFormalSave(...args); formalWrites.push(promise); return promise
  })
  vi.spyOn(pendingEdits, 'flushPendingEditsV1').mockImplementation((...args) => {
    const promise = actualFlush(...args); flushes.push(promise); return promise
  })
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No model or external network authorized') }))
  await db.delete(); await db.open()
  host = document.createElement('div'); document.body.append(host); mounted = createRoot(host)
})
afterEach(async () => {
  await act(async () => {
    releases.splice(0).forEach(release => release())
    await Promise.allSettled(reads)
    await flushCandidateDraftsV1().catch(() => {})
    mounted?.unmount()
  })
  expect(fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  resetCandidateDraftCoordinatorForTestsV1(); resetPendingEditCoordinatorForTestsV1()
  host.remove(); db.close()
})

describe('SFQA-046 · comic source author draft ordering', () => {
  it('reads a saved draft before editing and saves the latest input through the actual domain writer', async () => {
    const f = await fixture()
    await authoring.saveComicAuthorDraft(f.scope, 'target:r1', JSON.stringify({ ...f.root.targetSpec, audience: '已存草稿' }))
    await draw(f)
    await vi.waitFor(() => expect(input().value).toBe('已存草稿'))
    await fill('作者的新输入'); await save(); await expectFormal(f, '作者的新输入')
  })

  it('never replaces newer author input with a delayed real draft read, and formally saves the new text', async () => {
    const f = await fixture(), held = gate()
    await authoring.saveComicAuthorDraft(f.scope, 'target:r1', JSON.stringify({ ...f.root.targetSpec, audience: '迟到的旧草稿' }))
    const original = actualRead
    let readComplete = false
    nextRead = async (...args) => {
      const value = await original(...args); readComplete = true; await held.promise; return value
    }
    await draw(f, false); await vi.waitFor(() => expect(readComplete).toBe(true))
    await fill('作者刚输入的新值')
    await act(async () => held.release())
    expect(input().value).toBe('作者刚输入的新值')
    await save(); await expectFormal(f, '作者刚输入的新值')
    expect(JSON.parse((await original(f.scope, 'target:r1'))!).audience).toBe('作者刚输入的新值')
  })

  it('keeps dirty input on a same-revision parent refresh even before the draft queue has persisted it', async () => {
    const f = await fixture(), held = gate()
    await authoring.saveComicAuthorDraft(f.scope, 'target:r1', JSON.stringify({ ...f.root.targetSpec, audience: '磁盘旧草稿' }))
    await draw(f); await vi.waitFor(() => expect(input().value).toBe('磁盘旧草稿'))
    const original = authoring.saveComicAuthorDraft
    vi.spyOn(authoring, 'saveComicAuthorDraft').mockImplementationOnce(async (...args) => { await held.promise; return original(...args) })
    await fill('等待落盘的作者输入')
    await draw({ ...f, scope: { ...f.scope }, root: { ...f.root, targetSpec: { ...f.root.targetSpec } } })
    expect(input().value).toBe('等待落盘的作者输入')
    held.release(); await save(); await expectFormal(f, '等待落盘的作者输入')
  })

  it('keeps editable input and visible feedback after a read failure', async () => {
    const f = await fixture()
    nextRead = async (...args) => { await actualRead(...args); throw new Error('受控恢复读取失败') }
    await draw(f); await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('受控恢复读取失败'))
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '保存制作规格')?.matches(':disabled')).toBe(true)
    await fill('读取失败后明确输入的新稿'); await save(); await expectFormal(f, '读取失败后明确输入的新稿')
  })

  it('does not place an old Work read into a new Work and restores the latest persisted draft when returning', async () => {
    const a = await fixture('A原值'), b = await fixture('B原值'), held = gate()
    const original = actualRead
    let readComplete = false
    nextRead = async (...args) => {
      const value = await original(...args); readComplete = true; await held.promise; return value
    }
    await draw(a, false); await vi.waitFor(() => expect(readComplete).toBe(true))
    await fill('A作者稿')
    await act(async () => { await flushPendingEditsV1() })
    await draw(b); await vi.waitFor(() => expect(input().value).toBe('B原值'))
    await act(async () => held.release())
    expect(input().value).toBe('B原值')
    expect((await db.adaptationProjects.get(b.root.id!))?.targetSpec).toMatchObject({ audience: 'B原值' })
    await act(async () => mounted!.unmount()); mounted = createRoot(host)
    await draw(a); await vi.waitFor(() => expect(input().value).toBe('A作者稿'))
    expect((await db.adaptationProjects.get(a.root.id!))?.targetSpec).toMatchObject({ audience: 'A原值' })
  })

  it('rejects formal save on draft persistence failure, keeps the new input, and explicitly retries once', async () => {
    const f = await fixture()
    await authoring.saveComicAuthorDraft(f.scope, 'target:r1', JSON.stringify({ ...f.root.targetSpec, audience: '读取已就绪' }))
    await draw(f); await vi.waitFor(() => expect(input().value).toBe('读取已就绪'))
    const fail = vi.spyOn(authoring, 'saveComicAuthorDraft').mockRejectedValueOnce(new Error('受控草稿落盘失败'))
    const formal = vi.spyOn(authoring, 'updateComicTargetSpecV1')
    await fill('不得静默丢失的作者稿'); await save()
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('受控草稿落盘失败'))
    expect(input().value).toBe('不得静默丢失的作者稿'); expect(formal).not.toHaveBeenCalled()
    expect((await db.adaptationProjects.get(f.root.id!))?.revision).toBe(f.root.revision)
    fail.mockRestore(); await save(); await expectFormal(f, '不得静默丢失的作者稿')
    expect(formal).toHaveBeenCalledTimes(1)
  })

  it('discards a read failure after switching away instead of adding the old error to the new Work', async () => {
    const a = await fixture('A原值'), b = await fixture('B原值')
    let reject!: (reason: Error) => void
    const pending = new Promise<string | null>((_, fail) => { reject = fail })
    let readComplete = false
    nextRead = async (...args) => { await actualRead(...args); readComplete = true; return pending }
    await draw(a, false); await vi.waitFor(() => expect(readComplete).toBe(true)); await draw(b)
    await act(async () => reject(new Error('A已卸载页面的迟到错误')))
    await vi.waitFor(() => expect(input().value).toBe('B原值'))
    expect(host.textContent).not.toContain('A已卸载页面的迟到错误')
  })

  it('blocks fallback confirmation until the real initial draft read has settled', async () => {
    const f = await fixture(), held = gate()
    await authoring.saveComicAuthorDraft(f.scope, 'target:r1', JSON.stringify({ ...f.root.targetSpec, audience: '必须先恢复的稿' }))
    const original = actualRead
    let readComplete = false
    nextRead = async (...args) => {
      const value = await original(...args); readComplete = true; await held.promise; return value
    }
    const formal = vi.spyOn(authoring, 'updateComicTargetSpecV1')
    await draw(f, false); await vi.waitFor(() => expect(readComplete).toBe(true))
    const button = [...host.querySelectorAll('button')].find(button => button.textContent === '保存制作规格')
    expect(button?.matches(':disabled')).toBe(true)
    expect(input().matches(':disabled')).toBe(false)
    await save()
    expect(formal).not.toHaveBeenCalled()
    expect((await db.adaptationProjects.get(f.root.id!))?.revision).toBe(f.root.revision)
    await act(async () => held.release())
    await vi.waitFor(() => expect(input().value).toBe('必须先恢复的稿'))
    await save(); await expectFormal(f, '必须先恢复的稿')
  })

  it('does not expose or save an old root while the active owner is switching', async () => {
    const a = await fixture('A规格'), b = await fixture('B规格')
    await draw(a)
    await fill('A本地作者稿'); await act(async () => { await flushPendingEditsV1() })
    await draw({ ...b, root: a.root })
    expect(host.querySelector('.cp-planning')).toBeNull()
    expect(host.querySelector('[role="status"]')?.textContent).toContain('正在读取当前漫画作品')
    expect((await db.adaptationProjects.get(b.root.id!))?.targetSpec).toMatchObject({ audience: 'B规格' })
    await draw(b); await vi.waitFor(() => expect(input().value).toBe('B规格'))
    expect(JSON.parse((await authoring.readComicAuthorDraft(a.scope, 'target:r1'))!).audience).toBe('A本地作者稿')
  })

  it('keeps dirty input on a genuine revision update and cannot borrow its new revision to overwrite another save', async () => {
    const f = await fixture()
    await draw(f)
    await vi.waitFor(() => expect([...host.querySelectorAll('button')].find(button => button.textContent === '保存制作规格')?.matches(':disabled')).toBe(false))
    await fill('当前页面未确认的作者稿')
    await authoring.updateComicTargetSpecV1({ scope: f.scope, expectedRevision: f.root.revision,
      targetSpec: { ...f.root.targetSpec, audience: '另一窗口已经确认的规格' } })
    const row = await db.adaptationProjects.get(f.root.id!)
    if (!row || row.medium !== 'comic') throw new Error('Expected the real updated comic root')
    await draw({ ...f, root: { ...row, medium: 'comic' } })
    expect(input().value).toBe('当前页面未确认的作者稿')
    await save()
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('漫画规格已变化'))
    expect(input().value).toBe('当前页面未确认的作者稿')
    expect((await db.adaptationProjects.get(f.root.id!))?.targetSpec).toMatchObject({ audience: '另一窗口已经确认的规格' })
    expect((await db.adaptationProjects.get(f.root.id!))?.revision).toBe(f.root.revision + 1)
    expect(JSON.parse((await authoring.readComicAuthorDraft(f.scope, 'target:r1'))!).audience).toBe('当前页面未确认的作者稿')
  })

  it('retains a usable formal fallback after a malformed saved draft and requires explicit new input before saving', async () => {
    const f = await fixture()
    await authoring.saveComicAuthorDraft(f.scope, 'target:r1', JSON.stringify({ audience: '缺少正式字段的坏稿' }))
    await draw(f)
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy())
    expect(input().value).toBe('原始目标读者')
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '保存制作规格')?.matches(':disabled')).toBe(true)
    await fill('作者明确检查后输入的新稿'); await save(); await expectFormal(f, '作者明确检查后输入的新稿')
  })


  it('keeps a restored but untouched author draft when real visual metadata advances revision, without borrowing its new CAS', async () => {
    const f = await fixture()
    await authoring.saveComicAuthorDraft(f.scope, 'target:r1', JSON.stringify({ ...f.root.targetSpec, audience: '已恢复但尚未确认的作者稿' }))
    await draw(f)
    expect(input().value).toBe('已恢复但尚未确认的作者稿')
    const next = await visualMetadata(f)
    expect(next.root.revision).toBe(f.root.revision + 1)
    expect(next.root.targetSpec).toEqual(f.root.targetSpec)
    await draw(next)
    expect(input().value).toBe('已恢复但尚未确认的作者稿')
    await save()
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('漫画规格已变化'))
    expect(input().value).toBe('已恢复但尚未确认的作者稿')
    const stored = await db.adaptationProjects.get(f.root.id!)
    expect(stored?.targetSpec).toEqual(f.root.targetSpec)
    expect(stored?.revision).toBe(next.root.revision)
    expect(stored?.visualBible).toEqual(next.root.visualBible)
    expect(JSON.parse((await actualRead(f.scope, 'target:r1'))!).audience).toBe('已恢复但尚未确认的作者稿')
  })

  it('keeps a non-draft formal fallback pristine so a real metadata revision becomes the next edit basis', async () => {
    const f = await fixture()
    await draw(f)
    const next = await visualMetadata(f)
    await draw(next)
    expect(input().value).toBe('原始目标读者')
    await fill('基于当前版本明确输入的新稿'); await save(); await expectFormal(next, '基于当前版本明确输入的新稿')
  })


  it('settles the original pending read before a real metadata revision can replace its unconfirmed draft basis', async () => {
    const f = await fixture(), held = gate()
    await authoring.saveComicAuthorDraft(f.scope, 'target:r1', JSON.stringify({ ...f.root.targetSpec, audience: '尚未返回的既存作者稿' }))
    let readComplete = false
    nextRead = async (...args) => { const value = await actualRead(...args); readComplete = true; await held.promise; return value }
    await draw(f, false); await vi.waitFor(() => expect(readComplete).toBe(true))
    const next = await visualMetadata(f)
    await draw(next)
    await act(async () => { held.release(); await Promise.allSettled(reads) })
    expect(input().value).toBe('尚未返回的既存作者稿')
    await save()
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('漫画规格已变化'))
    expect(input().value).toBe('尚未返回的既存作者稿')
    expect((await db.adaptationProjects.get(f.root.id!))?.revision).toBe(next.root.revision)
    expect(JSON.parse((await actualRead(f.scope, 'target:r1'))!).audience).toBe('尚未返回的既存作者稿')
  })

  it('keeps a failed initial recovery visible across metadata revision instead of silently enabling fallback confirmation', async () => {
    const f = await fixture()
    await authoring.saveComicAuthorDraft(f.scope, 'target:r1', JSON.stringify({ ...f.root.targetSpec, audience: '读取失败也不得丢弃的既存稿' }))
    nextRead = async (...args) => { await actualRead(...args); throw new Error('原恢复失败，作者尚未作出选择') }
    await draw(f)
    const next = await visualMetadata(f)
    await draw(next)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('原恢复失败，作者尚未作出选择')
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '保存制作规格')?.matches(':disabled')).toBe(true)
    await save()
    expect((await db.adaptationProjects.get(f.root.id!))?.revision).toBe(next.root.revision)
    expect(JSON.parse((await actualRead(f.scope, 'target:r1'))!).audience).toBe('读取失败也不得丢弃的既存稿')
  })

  it('acknowledges an explicitly saved replacement after failed recovery and permits the next real revision save', async () => {
    const f = await fixture()
    nextRead = async (...args) => { await actualRead(...args); throw new Error('首次恢复失败，需要作者明确输入') }
    await draw(f)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('首次恢复失败，需要作者明确输入')
    await fill('失败后作者明确保存的第一稿'); await save(); await expectFormal(f, '失败后作者明确保存的第一稿')
    const row = await db.adaptationProjects.get(f.root.id!)
    if (!row || row.medium !== 'comic') throw new Error('Expected the actually committed first replacement')
    const next = { ...f, root: { ...row, medium: 'comic' as const } }
    await draw(next)
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '保存制作规格')?.matches(':disabled')).toBe(false)
    expect(input().value).toBe('失败后作者明确保存的第一稿')
    await fill('作者随后明确保存的第二稿'); await save(); await expectFormal(next, '作者随后明确保存的第二稿')
    expect(JSON.parse((await actualRead(f.scope, `target:r${next.root.revision}`))!).audience).toBe('作者随后明确保存的第二稿')
  })

})
