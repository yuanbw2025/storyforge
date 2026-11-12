import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, RouterProvider, createMemoryRouter } from 'react-router'
import { flushSync } from 'react-dom'
import type { WorkspaceScope } from '../../src/lib/types'
import { db } from '../../src/lib/db/schema'
import AiTownPage from '../../src/pages/AiTownPage'
import { updateWorkTitle } from '../../src/lib/workspace/works'
import * as townService from '../../src/lib/ai-town/authoring-service'
import {
  createAiTownDraft,
  readAiTownDraft,
  saveAiTownDraft,
} from '../../src/lib/ai-town/authoring-service'
import {
  defaultAiTownSettings,
  settingsFromAiTownDraft,
} from '../../src/lib/ai-town/authoring-contract'

const network = vi.fn(() => { throw new Error('No network is authorized in SFQA-112') })
let host: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(async () => {
  network.mockClear()
  vi.stubGlobal('fetch', network)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  db.close()
  await db.delete()
  await db.open()
})

afterEach(async () => {
  try {
    if (root) await act(async () => { root?.unmount() })
    host?.remove()
    expect(network).toHaveBeenCalledTimes(0)
  } finally {
    root = null
    host = null
    db.close()
    vi.unstubAllGlobals()
  }
})

async function snapshot(): Promise<Record<string, unknown[]>> {
  return db.transaction('r', db.tables, async () => Object.fromEntries(
    await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])),
  ))
}

async function waitForUi(check: () => void | Promise<void>) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 10)) })
    await check()
  }, { timeout: 5000 })
}

function field(labelText: string): HTMLInputElement | HTMLTextAreaElement {
  const label = Array.from(host!.querySelectorAll('label'))
    .find(element => element.textContent?.startsWith(labelText))
  const input = label?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')
  if (!input) throw new Error(`The actual AI Town field is missing: ${labelText}`)
  return input
}

async function edit(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const set = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!set) throw new Error('The native input value setter is missing')
  await act(async () => {
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('keeps the public native service CAS and accepts a current ordinary save', async () => {
  const owner = await createAiTownDraft('112 base town', {
    ...defaultAiTownSettings(), openingSituation: '112 original opening',
  })
  const first = await readAiTownDraft(owner.scope)
  expect(first.revision).toBe(0)
  const remoteSettings = {
    ...settingsFromAiTownDraft(first), openingSituation: '112 remote committed opening',
  }
  const remote = await saveAiTownDraft(owner.scope, first.revision, remoteSettings, '112 remote title')
  const beforeStale = await snapshot()
  await expect(saveAiTownDraft(owner.scope, first.revision,
    settingsFromAiTownDraft(first), '112 stale title')).rejects.toThrow('其他页面')
  expect(await snapshot()).toEqual(beforeStale)
  const currentSettings = { ...remoteSettings, openingSituation: '112 ordinary current opening' }
  const current = await saveAiTownDraft(owner.scope, remote.revision, currentSettings, '112 current title')
  expect(current.revision).toBe(remote.revision + 1)
  expect(settingsFromAiTownDraft(await readAiTownDraft(owner.scope))).toEqual(currentSettings)
  expect((await db.works.get(owner.scope.workId))?.title).toBe('112 current title')
})

it('does not lend a liveQuery revision to an older dirty form or overwrite the committed remote copy', async () => {
  const owner = await createAiTownDraft('112 original title', {
    ...defaultAiTownSettings(), openingSituation: '112 original opening',
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(MemoryRouter, {
    initialEntries: [`/town/vision?project=${owner.scope.projectId}&work=${owner.scope.workId}`],
  }, createElement(Routes, null, createElement(Route, {
    path: '/town/:pageId', element: createElement(AiTownPage),
  })))))
  await waitForUi(() => { expect(field('小镇名称').value).toBe('112 original title') })
  const localHome = '112 author home e\u0301🌙\nkeep this complete local text'
  await edit(field('住所构想'), localHome)
  expect(field('住所构想').value).toBe(localHome)
  const old = await readAiTownDraft(owner.scope)
  const remoteSettings = {
    ...settingsFromAiTownDraft(old), openingSituation: '112 remote committed opening',
  }
  await act(async () => {
    await saveAiTownDraft(owner.scope, old.revision, remoteSettings, '112 remote committed title')
  })
  await waitForUi(() => {
    expect(host!.textContent).toContain('112 remote committed title')
    expect(field('生活愿景与开场目标').value).toBe('112 original opening')
  })
  const committed = await snapshot()
  const save = Array.from(host.querySelectorAll('button'))
    .find(button => button.textContent?.trim() === '保存制作方案')
  if (!save) throw new Error('The actual Save production plan button is missing')
  await act(async () => { save.click() })
  await waitForUi(() => {
    expect(host!.querySelector('[role="alert"],[role="status"]')).not.toBeNull()
  })
  const after = await snapshot()
  const current = await readAiTownDraft(owner.scope)
  const currentWork = await db.works.get(owner.scope.workId)
  console.info(JSON.stringify({
    actualRoute: 'AiTownPage /town/vision',
    formRevision: old.revision, externalRevision: old.revision + 1, afterRevision: current.revision,
    remoteOpeningPreserved: settingsFromAiTownDraft(current).openingSituation === remoteSettings.openingSituation,
    remoteTitlePreserved: currentWork?.title === '112 remote committed title',
    localHomePreserved: field('住所构想').value === localHome,
    alert: host.querySelector('[role="alert"]')?.textContent ?? null,
    networkCalls: network.mock.calls.length,
  }))
  expect(after).toEqual(committed)
  expect(current.revision).toBe(old.revision + 1)
  expect(settingsFromAiTownDraft(current)).toEqual(remoteSettings)
  expect(currentWork?.title).toBe('112 remote committed title')
  expect(field('小镇名称').value).toBe('112 original title')
  expect(field('生活愿景与开场目标').value).toBe('112 original opening')
  expect(field('住所构想').value).toBe(localHome)
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
})

it('protects the current Work title when the supported generic writer does not change the Town draft revision', async () => {
  const owner = await createAiTownDraft('112 generic original title', {
    ...defaultAiTownSettings(), openingSituation: '112 generic original opening',
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(MemoryRouter, {
    initialEntries: [`/town/vision?project=${owner.scope.projectId}&work=${owner.scope.workId}`],
  }, createElement(Routes, null, createElement(Route, {
    path: '/town/:pageId', element: createElement(AiTownPage),
  })))))
  await waitForUi(() => { expect(field('小镇名称').value).toBe('112 generic original title') })
  const localHome = '112 generic complete local home e\u0301🌙'
  await edit(field('住所构想'), localHome)
  const beforeRename = await readAiTownDraft(owner.scope)
  await act(async () => { await updateWorkTitle(owner.scope, '112 generic committed title') })
  await waitForUi(() => {
    expect(host!.textContent).toContain('112 generic committed title')
    expect(field('小镇名称').value).toBe('112 generic original title')
  })
  expect((await readAiTownDraft(owner.scope)).revision).toBe(beforeRename.revision)
  const committed = await snapshot()
  const save = Array.from(host.querySelectorAll('button'))
    .find(button => button.textContent?.trim() === '保存制作方案')
  if (!save) throw new Error('The actual Save production plan button is missing')
  await act(async () => { save.click() })
  await waitForUi(() => {
    expect(host!.querySelector('[role="alert"],[role="status"]')).not.toBeNull()
  })
  const after = await snapshot()
  const current = await readAiTownDraft(owner.scope)
  const currentWork = await db.works.get(owner.scope.workId)
  console.info(JSON.stringify({
    actualWriter: 'updateWorkTitle public native service',
    beforeDraftRevision: beforeRename.revision, afterDraftRevision: current.revision,
    committedWork: committed.works, afterWork: after.works,
    committedTown: committed.aiTownAuthoringDrafts, afterTown: after.aiTownAuthoringDrafts,
    localTitle: field('小镇名称').value, localHome: field('住所构想').value,
    alert: host.querySelector('[role="alert"]')?.textContent ?? null,
    networkCalls: network.mock.calls.length,
  }))
  expect(after).toEqual(committed)
  expect(current.revision).toBe(beforeRename.revision)
  expect(currentWork?.title).toBe('112 generic committed title')
  expect(field('小镇名称').value).toBe('112 generic original title')
  expect(field('住所构想').value).toBe(localHome)
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
})

async function mountTown(scope: WorkspaceScope, title: string) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const router = createMemoryRouter([{ path: '/town/:pageId', element: createElement(AiTownPage) }], {
    initialEntries: [`/town/vision?project=${scope.projectId}&work=${scope.workId}`],
  })
  await act(async () => root!.render(createElement(RouterProvider, { router, flushSync })))
  await waitForUi(() => {
    expect(field('小镇名称').value).toBe(title)
    expect(field('小镇名称').closest('fieldset')?.disabled).toBe(false)
  })
  return router
}

function buttonByText(text: string) {
  return Array.from(host!.querySelectorAll('button')).find(value => value.textContent?.trim() === text)
}

async function click(text: string) {
  const button = buttonByText(text)
  if (!button) throw new Error(`The actual AI Town action is missing: ${text}`)
  await act(async () => { button.click() })
}

it('checks the optional original title in the existing transaction and preserves explicit no-options callers', async () => {
  const owner = await createAiTownDraft('112 guarded original')
  const original = await readAiTownDraft(owner.scope)
  await updateWorkTitle(owner.scope, '112 guarded remote')
  const before = await snapshot()
  await expect(saveAiTownDraft(owner.scope, original.revision, settingsFromAiTownDraft(original),
    '112 unwanted rename', { expectedWorkTitle: '112 guarded original' })).rejects.toThrow('作品名称')
  expect(await snapshot()).toEqual(before)
  const explicit = await saveAiTownDraft(owner.scope, original.revision,
    settingsFromAiTownDraft(original), '112 explicit caller title')
  expect(explicit.revision).toBe(1)
  expect((await db.works.get(owner.scope.workId))?.title).toBe('112 explicit caller title')
})

it('captures the optional title and scope before an asynchronous caller can change either input', async () => {
  const owner = await createAiTownDraft('112 immutable owner')
  const foreign = await createAiTownDraft('112 untouched foreign')
  const foreignWork = await db.works.get(foreign.scope.workId)
  const foreignDraft = await readAiTownDraft(foreign.scope)
  const input = { ...owner.scope }, options = { expectedWorkTitle: '112 immutable owner' }
  const pending = saveAiTownDraft(input, 0, defaultAiTownSettings(), '112 captured result', options)
  input.workId = foreign.scope.workId
  options.expectedWorkTitle = '112 later changed input'
  expect((await pending).revision).toBe(1)
  expect((await db.works.get(owner.scope.workId))?.title).toBe('112 captured result')
  expect(await db.works.get(foreign.scope.workId)).toEqual(foreignWork)
  expect(await readAiTownDraft(foreign.scope)).toEqual(foreignDraft)
  const wrong = { expectedWorkTitle: '112 never authorized title' }
  const before = await snapshot()
  const refused = saveAiTownDraft(owner.scope, 1, defaultAiTownSettings(), '112 invalid retry', wrong)
  wrong.expectedWorkTitle = '112 captured result'
  await expect(refused).rejects.toThrow('作品名称')
  expect(await snapshot()).toEqual(before)
})

it('rolls the draft and Work back together when the real native Work write fails', async () => {
  const owner = await createAiTownDraft('112 atomic original')
  const before = await snapshot()
  const fail = () => { throw new Error('112 real native Work write failed') }
  db.works.hook('updating', fail)
  try {
    await expect(saveAiTownDraft(owner.scope, 0, {
      ...defaultAiTownSettings(), openingSituation: '112 must roll back',
    }, '112 must also roll back', { expectedWorkTitle: '112 atomic original' }))
      .rejects.toThrow('112 real native Work write failed')
    expect(await snapshot()).toEqual(before)
  } finally { db.works.hook('updating').unsubscribe(fail) }
})

it('hydrates a clean external change and advances its own basis across two ordinary saves', async () => {
  const owner = await createAiTownDraft('112 clean original')
  const router = await mountTown(owner.scope, '112 clean original')
  try {
    const remote = { ...defaultAiTownSettings(), openingSituation: '112 clean remote opening' }
    await act(async () => { await saveAiTownDraft(owner.scope, 0, remote, '112 clean remote title') })
    await waitForUi(() => {
      expect(field('小镇名称').value).toBe('112 clean remote title')
      expect(field('生活愿景与开场目标').value).toBe(remote.openingSituation)
    })
    await edit(field('住所构想'), '112 first local home')
    await click('保存制作方案')
    await waitForUi(async () => { expect((await readAiTownDraft(owner.scope)).revision).toBe(2) })
    await edit(field('生活愿景与开场目标'), '112 second local opening')
    await click('保存制作方案')
    await waitForUi(async () => { expect((await readAiTownDraft(owner.scope)).revision).toBe(3) })
    const saved = settingsFromAiTownDraft(await readAiTownDraft(owner.scope))
    expect(saved).toEqual({ ...remote, openingSituation: '112 second local opening',
      town: { ...remote.town, homeConcept: '112 first local home' } })
    expect((await db.works.get(owner.scope.workId))?.title).toBe('112 clean remote title')
    expect(host!.querySelector('[role="alert"]')).toBeNull()
  } finally { router.dispose() }
})

it.each(['title-only', 'settings-only'] as const)('keeps both full copies when the remote save changes %s', async kind => {
  const original = { ...defaultAiTownSettings(), openingSituation: '112 independently original opening' }
  const owner = await createAiTownDraft('112 independent original title', original)
  const router = await mountTown(owner.scope, '112 independent original title')
  try {
    await edit(field('住所构想'), '112 independently dirty local home')
    const remote = kind === 'settings-only' ? { ...original, openingSituation: '112 remote settings only' } : original
    const remoteTitle = kind === 'title-only' ? '112 remote title only' : '112 independent original title'
    await act(async () => { await saveAiTownDraft(owner.scope, 0, remote, remoteTitle) })
    const before = await snapshot()
    await click('保存制作方案')
    await waitForUi(() => { expect(host!.querySelector('[role="alert"]')).not.toBeNull() })
    expect(await snapshot()).toEqual(before)
    expect(settingsFromAiTownDraft(await readAiTownDraft(owner.scope))).toEqual(remote)
    expect((await db.works.get(owner.scope.workId))?.title).toBe(remoteTitle)
    expect(field('小镇名称').value).toBe('112 independent original title')
    expect(field('生活愿景与开场目标').value).toBe(original.openingSituation)
    expect(field('住所构想').value).toBe('112 independently dirty local home')
  } finally { router.dispose() }
})

it('retains separate complete dirty buffers when the real router switches between two Works', async () => {
  const a = await createAiTownDraft('112 owner A')
  const b = await createAiTownDraft('112 owner B')
  const before = await snapshot()
  const router = await mountTown(a.scope, '112 owner A')
  try {
    await edit(field('住所构想'), '112 unsaved A home')
    await act(async () => { await router.navigate(`/town/vision?project=${b.scope.projectId}&work=${b.scope.workId}`) })
    await waitForUi(() => { expect(field('小镇名称').value).toBe('112 owner B') })
    await edit(field('住所构想'), '112 unsaved B home')
    await act(async () => { await router.navigate(`/town/vision?project=${a.scope.projectId}&work=${a.scope.workId}`) })
    await waitForUi(() => {
      expect(field('小镇名称').value).toBe('112 owner A')
      expect(field('住所构想').value).toBe('112 unsaved A home')
    })
    expect(await snapshot()).toEqual(before)
    await click('保存制作方案')
    await waitForUi(async () => { expect((await readAiTownDraft(a.scope)).revision).toBe(1) })
    expect(settingsFromAiTownDraft(await readAiTownDraft(b.scope)).town.homeConcept)
      .toBe(defaultAiTownSettings().town.homeConcept)
    await act(async () => { await router.navigate(`/town/vision?project=${b.scope.projectId}&work=${b.scope.workId}`) })
    await waitForUi(() => { expect(field('住所构想').value).toBe('112 unsaved B home') })
    await click('保存制作方案')
    await waitForUi(async () => { expect((await readAiTownDraft(b.scope)).revision).toBe(1) })
    expect(settingsFromAiTownDraft(await readAiTownDraft(a.scope)).town.homeConcept).toBe('112 unsaved A home')
    expect(settingsFromAiTownDraft(await readAiTownDraft(b.scope)).town.homeConcept).toBe('112 unsaved B home')
  } finally { router.dispose() }
})

it('keeps local and committed complete JSON through comparison download and explicit committed reload', async () => {
  const original = { ...defaultAiTownSettings(), openingSituation: '112 compare original opening' }
  const owner = await createAiTownDraft('112 compare original title', original)
  const router = await mountTown(owner.scope, '112 compare original title')
  const blobs: Blob[] = [], handoffs: string[] = []
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    if (!(blob instanceof Blob)) throw new Error('Expected the actual platform Blob')
    blobs.push(blob)
    return `blob:quality112-${blobs.length}`
  })
  const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    handoffs.push(this.download)
  })
  const readBlob = (blob: Blob) => new Promise<unknown>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { try { resolve(JSON.parse(String(reader.result))) } catch (cause) { reject(cause) } }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
  try {
    const localHome = '112 comparison local e\u0301🌙\ncomplete text'
    await edit(field('住所构想'), localHome)
    const remote = { ...original, openingSituation: '112 comparison remote opening' }
    await act(async () => { await saveAiTownDraft(owner.scope, 0, remote, '112 comparison remote title') })
    await click('保存制作方案')
    await waitForUi(() => { expect(host!.querySelector('[role="alert"]')).not.toBeNull() })
    const before = await snapshot()
    await click('下载本地与已提交方案比较')
    await waitForUi(() => { expect(blobs).toHaveLength(1) })
    const copy = await readBlob(blobs[0])
    expect(copy).toMatchObject({ version: 1, kind: 'ai-town-edit-comparison', committedReadError: null,
      local: { title: '112 compare original title', settings: { ...original, town: { ...original.town, homeConcept: localHome } },
        basis: { scope: owner.scope, revision: 0, workTitle: '112 compare original title' } },
      committed: { title: '112 comparison remote title', settings: remote, basis: { scope: owner.scope, revision: 1 } } })
    expect(handoffs[0]).toContain('未保存方案比较.json')
    await click('保留本地副本，载入已提交版本')
    await waitForUi(() => {
      expect(field('小镇名称').value).toBe('112 comparison remote title')
      expect(field('生活愿景与开场目标').value).toBe(remote.openingSituation)
      expect(field('住所构想').value).toBe(remote.town.homeConcept)
    })
    expect(await snapshot()).toEqual(before)
    const retained = host!.querySelector<HTMLDetailsElement>('[data-testid="town-retained-edits"]')!
    expect(retained).not.toBeNull()
    await act(async () => { retained.querySelector('summary')!.click() })
    await click('下载此本地副本与已提交方案')
    await waitForUi(() => { expect(blobs).toHaveLength(2) })
    expect(await readBlob(blobs[1])).toEqual(copy)
    expect(await snapshot()).toEqual(before)
  } finally { createUrl.mockRestore(); anchor.mockRestore(); router.dispose() }
})

it('does not let an old real native save failure put its error into the newly selected Work', async () => {
  const a = await createAiTownDraft('112 late error A')
  const b = await createAiTownDraft('112 late error B')
  const before = await snapshot()
  const router = await mountTown(a.scope, '112 late error A')
  const nativeSave = townService.saveAiTownDraft
  let switched = false
  const fail = () => { throw new Error('112 original owner native failure') }
  const observer = vi.spyOn(townService, 'saveAiTownDraft').mockImplementation((...args) => {
    const nativePromise = nativeSave(...args)
    if (args[0].workId === a.scope.workId) void nativePromise.catch(() => {
      flushSync(() => { void router.navigate(`/town/vision?project=${b.scope.projectId}&work=${b.scope.workId}`) })
      switched = true
    })
    return nativePromise
  })
  db.works.hook('updating', fail)
  try {
    await edit(field('住所构想'), '112 A input before real failure')
    await click('保存制作方案')
    await waitForUi(() => {
      expect(switched).toBe(true)
      expect(field('小镇名称').value).toBe('112 late error B')
      expect(field('小镇名称').closest('fieldset')?.disabled).toBe(false)
    })
    expect(host!.querySelector('[role="alert"]')?.textContent ?? '').not.toContain('112 original owner native failure')
    expect(await snapshot()).toEqual(before)
    await edit(field('住所构想'), '112 B remains editable')
    expect(field('住所构想').value).toBe('112 B remains editable')
    await act(async () => { await router.navigate(`/town/vision?project=${a.scope.projectId}&work=${a.scope.workId}`) })
    await waitForUi(() => { expect(field('住所构想').value).toBe('112 A input before real failure') })
  } finally { observer.mockRestore(); db.works.hook('updating').unsubscribe(fail); router.dispose() }
})


async function recordNativeControl(name: string, router: ReturnType<typeof createMemoryRouter>) {
  const tables = await snapshot()
  const directory = process.env.QUALITY112_NATIVE_DIR
  if (directory) {
    const [{ mkdir, writeFile }, { serialize }, { join }] = await Promise.all([
      import('node:fs/promises'), import('node:v8'), import('node:path'),
    ])
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, name + '.bin'), serialize({
      name, tables, route: router.state.location,
      alerts: Array.from(host!.querySelectorAll('[role="alert"],[role="status"]')).map(value => value.textContent),
      localComparison: host!.querySelector('[data-testid="town-edit-conflict"] pre')?.textContent ?? null,
      controls: Array.from(host!.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select'))
        .map(value => ({ tag: value.tagName, value: value.value,
          checked: value instanceof HTMLInputElement ? value.checked : undefined,
          disabled: value.disabled, label: value.closest('label')?.textContent ?? null })),
    }))
  }
  return tables
}

function sourceCheckbox() {
  const group = Array.from(host!.querySelectorAll('fieldset'))
    .find(value => value.querySelector('legend')?.textContent === '设定')
  const input = group?.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!input) throw new Error('The actual optional source resource checkbox is missing')
  expect(input.disabled).toBe(false)
  return input
}

it.each(['go', 'leave', 'compile'] as const)('rejects a stale real %s entry before navigation or another product write', async entry => {
  const owner = await createAiTownDraft('112 action original', {
    ...defaultAiTownSettings(), openingSituation: '112 action original opening',
  })
  await createAiTownDraft('112 action foreign owner')
  const router = await mountTown(owner.scope, '112 action original')
  try {
    await edit(field('住所构想'), '112 action complete local home')
    if (entry === 'compile') {
      await act(async () => { await router.navigate('/town/confirm?project=' + owner.scope.projectId + '&work=' + owner.scope.workId) })
    }
    await act(async () => { await saveAiTownDraft(owner.scope, 0, {
      ...defaultAiTownSettings(), openingSituation: '112 action remote committed opening',
    }, '112 action remote committed title') })
    await waitForUi(() => { expect(host!.querySelector('[data-testid="town-edit-conflict"]')).not.toBeNull() })
    const before = await recordNativeControl('stale-' + entry + '-before', router)
    const pathBefore = router.state.location.pathname
    await click(entry === 'go' ? '居民与地点' : entry === 'leave' ? '通用设置' : '生成或更新审查方案')
    await waitForUi(() => { expect(host!.querySelector('[role="alert"]')).not.toBeNull() })
    expect(await recordNativeControl('stale-' + entry + '-after', router)).toEqual(before)
    expect(router.state.location.pathname).toBe(pathBefore)
    const local = JSON.parse(host!.querySelector('[data-testid="town-edit-conflict"] pre')!.textContent!)
    expect(local).toMatchObject({ title: '112 action original',
      settings: { openingSituation: '112 action original opening', town: { homeConcept: '112 action complete local home' } },
      basis: { scope: owner.scope, revision: 0, workTitle: '112 action original' } })
  } finally { router.dispose() }
})

it('threads actual own World, SourceSelection and Brief revisions through later settings and dirty source saves', async () => {
  const { seedCurrentProductWorld } = await import('../helpers/current-product-world')
  const source = await seedCurrentProductWorld('112 actual frozen source', { minimumCharacters: 4 })
  const sourceRelease = await db.worldReleases.get(source.release.id!)
  const initial = defaultAiTownSettings()
  initial.town.residentTarget = 4
  const owner = await createAiTownDraft('112 own source chain', initial)
  const router = await mountTown(owner.scope, '112 own source chain')
  let restorePrepare: (() => void) | undefined
  try {
    await edit(field('住所构想'), '112 own chain home')
    await click('世界引擎')
    await waitForUi(() => {
      expect(router.state.location.pathname).toBe('/town/source')
      expect(buttonByText('选择此版本')?.disabled).toBe(false)
    })
    expect((await readAiTownDraft(owner.scope)).revision).toBe(1)
    await click('选择此版本')
    await waitForUi(async () => {
      expect((await readAiTownDraft(owner.scope)).revision).toBe(2)
      expect(sourceCheckbox()).not.toBeNull()
    })
    await act(async () => { sourceCheckbox().click() })
    await click('保存出口范围')
    await waitForUi(async () => { expect((await readAiTownDraft(owner.scope)).revision).toBe(3) })
    const selected = (await readAiTownDraft(owner.scope)).selectionJson
    expect(selected).not.toBeNull()
    await click('制作台')
    await waitForUi(() => { expect(field('住所构想').value).toBe('112 own chain home') })
    await edit(field('生活愿景与开场目标'), '112 own chain current opening')
    await click('保存制作方案')
    await waitForUi(async () => { expect((await readAiTownDraft(owner.scope)).revision).toBe(4) })
    await click('确认制作方案')
    await click('生成或更新审查方案')
    await waitForUi(async () => {
      expect(router.state.location.pathname).toBe('/town/production')
      expect((await readAiTownDraft(owner.scope)).revision).toBe(5)
      expect(host!.textContent).toContain('审查方案已保存，核对后明确授权才会开始制作。')
    })
    await click('制作台')
    await waitForUi(() => { expect(field('住所构想').value).toBe('112 own chain home') })
    await edit(field('住所构想'), '112 post-Brief own home')
    await click('保存制作方案')
    await waitForUi(async () => { expect((await readAiTownDraft(owner.scope)).revision).toBe(6) })
    await recordNativeControl('own-source-brief-normal-chain-completed', router)
    await click('确认制作方案')
    const nativePrepare = townService.prepareAiTownBrief
    let prepareStarted = false
    let allowPrepare!: () => void
    const sourceEdited = new Promise<void>(resolve => { allowPrepare = resolve })
    const observer = vi.spyOn(townService, 'prepareAiTownBrief').mockImplementation(async (...args) => {
      prepareStarted = true
      await sourceEdited
      return nativePrepare(...args)
    })
    restorePrepare = () => { allowPrepare(); observer.mockRestore() }
    await click('生成或更新审查方案')
    await waitForUi(() => { expect(prepareStarted).toBe(true) })
    await act(async () => {
      await router.navigate('/town/source?project=' + owner.scope.projectId + '&work=' + owner.scope.workId)
    })
    await waitForUi(() => { expect(sourceCheckbox()).not.toBeNull() })
    await act(async () => { sourceCheckbox().click() })
    // Deliver the actual preparation result after the author changes the still-editable selection.
    allowPrepare()
    await waitForUi(async () => {
      expect(router.state.location.pathname).toBe('/town/production')
      expect((await readAiTownDraft(owner.scope)).revision).toBe(7)
    })
    restorePrepare(); restorePrepare = undefined
    await recordNativeControl('own-brief-dirty-source-before-save', router)
    await click('世界引擎')
    await waitForUi(() => {
      expect(router.state.location.pathname === '/town/source' || host!.querySelector('[role="alert"]') !== null).toBe(true)
    })
    const after = await recordNativeControl('own-brief-dirty-source-after-save', router)
    const draft = await readAiTownDraft(owner.scope)
    expect(draft.revision).toBe(8)
    expect(draft.preparedRevision).toBeNull()
    expect(draft.selectionJson).not.toBe(selected)
    expect(router.state.location.pathname).toBe('/town/source')
    expect(settingsFromAiTownDraft(draft)).toEqual({ ...initial,
      openingSituation: '112 own chain current opening', town: { ...initial.town, homeConcept: '112 post-Brief own home' } })
    expect(after.productBuilds).toEqual([])
    expect(await db.worldReleases.get(source.release.id!)).toEqual(sourceRelease)
    expect(network).toHaveBeenCalledTimes(0)
  } finally { restorePrepare?.(); router.dispose() }
})

it('does not lend a remote revision to an older dirty SourceSelection buffer', async () => {
  const { seedCurrentProductWorld } = await import('../helpers/current-product-world')
  const source = await seedCurrentProductWorld('112 stale source world', { minimumCharacters: 4 })
  const initial = defaultAiTownSettings(); initial.town.residentTarget = 4
  const owner = await createAiTownDraft('112 stale source owner', initial)
  await townService.selectAiTownWorld(owner.scope, 0, source.release.id!)
  const router = await mountTown(owner.scope, '112 stale source owner')
  try {
    await click('世界引擎')
    await waitForUi(() => { expect(sourceCheckbox()).not.toBeNull() })
    await act(async () => { sourceCheckbox().click() })
    await act(async () => { await saveAiTownDraft(owner.scope, 1, {
      ...initial, openingSituation: '112 stale source remote opening',
    }, '112 stale source remote title') })
    await waitForUi(() => { expect(host!.querySelector('[data-testid="town-edit-conflict"]')).not.toBeNull() })
    const localBefore = host!.querySelector('[data-testid="town-edit-conflict"] pre')!.textContent
    const before = await recordNativeControl('stale-source-before', router)
    await click('保存出口范围')
    await waitForUi(() => { expect(host!.querySelector('[role="alert"]')).not.toBeNull() })
    expect(await recordNativeControl('stale-source-after', router)).toEqual(before)
    expect(host!.querySelector('[data-testid="town-edit-conflict"] pre')!.textContent).toBe(localBefore)
    expect((await readAiTownDraft(owner.scope)).revision).toBe(2)
  } finally { router.dispose() }
})

it.each(['current', 'stale'] as const)('uses the actual Consultation confirmation callback with a %s editing basis', async mode => {
  const { consultAiTownV1 } = await import('../../src/lib/ai-town/consultation')
  const initial = defaultAiTownSettings()
  const owner = await createAiTownDraft('112 actual consultation owner', initial)
  const candidate = { ...initial, openingSituation: '112 actual candidate opening',
    town: { ...initial.town, sharedProjectConcept: '112 actual candidate shared project' } }
  const runAI = vi.fn(async () => JSON.stringify({ answer: '112 actual synthetic consultation candidate', settings: candidate }))
  await consultAiTownV1({ scope: owner.scope, question: '112 please draft an author proposal', runAI })
  const candidateDraft = await readAiTownDraft(owner.scope)
  expect(settingsFromAiTownDraft(candidateDraft)).toEqual(initial)
  expect(runAI).toHaveBeenCalledTimes(1)
  const router = await mountTown(owner.scope, '112 actual consultation owner')
  try {
    if (mode === 'stale') await edit(field('住所构想'), '112 consultation complete local home')
    await act(async () => { await router.navigate('/town/agent?project=' + owner.scope.projectId + '&work=' + owner.scope.workId) })
    await waitForUi(() => { expect(host!.textContent).toContain('112 actual synthetic consultation candidate') })
    if (mode === 'stale') {
      await act(async () => { await saveAiTownDraft(owner.scope, candidateDraft.revision, {
        ...initial, openingSituation: '112 consultation remote committed opening',
      }, '112 consultation remote committed title') })
      await waitForUi(() => { expect(host!.querySelector('[data-testid="town-edit-conflict"]')).not.toBeNull() })
    }
    const before = await recordNativeControl('consult-' + mode + '-before', router)
    await click('确认并回填制作方案')
    await waitForUi(() => {
      expect(host!.querySelector(mode === 'stale' ? '[role="alert"]' : '[role="status"]')).not.toBeNull()
    })
    const after = await recordNativeControl('consult-' + mode + '-after', router)
    if (mode === 'stale') {
      expect(after).toEqual(before)
      const local = JSON.parse(host!.querySelector('[data-testid="town-edit-conflict"] pre')!.textContent!)
      expect(local.settings.town.homeConcept).toBe('112 consultation complete local home')
      expect(local.basis.revision).toBe(candidateDraft.revision)
    } else {
      expect(settingsFromAiTownDraft(await readAiTownDraft(owner.scope))).toEqual(candidate)
      expect((await readAiTownDraft(owner.scope)).revision).toBe(candidateDraft.revision + 1)
      expect((await db.works.get(owner.scope.workId))?.title).toBe('112 actual consultation owner')
      expect({ ...after, works: before.works, aiTownAuthoringDrafts: before.aiTownAuthoringDrafts }).toEqual(before)
      expect(host!.textContent).toContain('候选已回填，可在各配置页继续编辑')
    }
    expect(after.productBuilds).toEqual([])
    expect(runAI).toHaveBeenCalledTimes(1)
  } finally { router.dispose() }
})

it('keeps a legitimate existing no-draft Production read-only without inventing a draft or rewriting it', async () => {
  const { createWorkspace } = await import('../../src/lib/workspace/create-workspace')
  const { cacheWorldReferenceForProductV1 } = await import('../../src/lib/world-engine/reference-cache')
  const { seedCurrentProductWorld } = await import('../helpers/current-product-world')
  const { consultProductProductionStartV1, compileProductProductionBriefV3, createProductProductionWithBriefV1 } = await import('../../src/lib/product-production/service')
  const source = await seedCurrentProductWorld('112 no-draft frozen source', { minimumCharacters: 4 })
  const owner = await createWorkspace({ name: '112 no-draft existing owner', genres: [], status: 'drafting',
    description: '', targetWordCount: 10000 }, { kind: 'ai-town' })
  const localReleaseId = await cacheWorldReferenceForProductV1(owner.scope, source.release.id!)
  const catalog = await consultProductProductionStartV1({ scope: owner.scope, worldReleaseId: localReleaseId, productType: 'ai-town' })
  const suggestion = catalog.suggestions.find(value => value.recommendedProductTypes.includes('ai-town')) ?? catalog.suggestions[0]
  if (!suggestion) throw new Error('The real no-draft Production fixture has no catalog starting point')
  const settings = defaultAiTownSettings(); settings.town.residentTarget = 4
  const brief = await compileProductProductionBriefV3({ scope: owner.scope, worldReleaseId: localReleaseId,
    suggestionKey: suggestion.suggestionKey, productType: 'ai-town', qualityProfile: 'prototype', scale: 'short-arc',
    visualLevel: 'none', audioLevel: 'none', playerRole: settings.town.playerName,
    openingSituation: '112 no-draft existing life', aiTown: { ...settings.town, townTitle: owner.work.title },
    sourceSelection: catalog.selectionDefaults[suggestion.suggestionKey] })
  const productionId = await createProductProductionWithBriefV1({ scope: owner.scope,
    worldReleaseId: localReleaseId, title: owner.work.title, brief })
  expect(await db.aiTownAuthoringDrafts.count()).toBe(0)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const router = createMemoryRouter([{ path: '/town/:pageId', element: createElement(AiTownPage) }], {
    initialEntries: ['/town/vision?project=' + owner.scope.projectId + '&work=' + owner.scope.workId],
  })
  try {
    const before = await snapshot()
    await act(async () => root!.render(createElement(RouterProvider, { router })))
    await waitForUi(() => { expect(host!.textContent).toContain('继续已有制作记录') })
    expect(field('小镇名称').closest('fieldset')?.disabled).toBe(true)
    expect(await recordNativeControl('no-draft-read-only', router)).toEqual(before)
    await click('继续已有制作记录')
    await waitForUi(() => {
      expect(router.state.location.pathname).toBe('/town/production')
      expect(host!.textContent).toContain('启用本作品的自动制作')
    })
    expect(await recordNativeControl('no-draft-original-production', router)).toEqual(before)
    expect(Number(new URLSearchParams(router.state.location.search).get('production'))).toBe(productionId)
  } finally { router.dispose() }
})

it('does not apply an old real native success to a newly selected Work', async () => {
  const a = await createAiTownDraft('112 late success A')
  const b = await createAiTownDraft('112 late success B')
  const router = await mountTown(a.scope, '112 late success A')
  const nativeSave = townService.saveAiTownDraft
  let switched = false
  const observer = vi.spyOn(townService, 'saveAiTownDraft').mockImplementation((...args) => {
    const nativePromise = nativeSave(...args)
    if (args[0].workId === a.scope.workId) void nativePromise.then(() => {
      void router.navigate('/town/vision?project=' + b.scope.projectId + '&work=' + b.scope.workId, { flushSync: true })
      switched = true
    })
    return nativePromise
  })
  try {
    await edit(field('住所构想'), '112 successful A complete local home')
    const before = await recordNativeControl('late-success-before', router)
    await click('保存制作方案')
    await recordNativeControl('late-success-native-after-click', router)
    await waitForUi(() => {
      expect(switched).toBe(true)
      expect(field('小镇名称').value).toBe('112 late success B')
      expect(field('小镇名称').closest('fieldset')?.disabled).toBe(false)
    })
    const after = await recordNativeControl('late-success-after', router)
    expect(settingsFromAiTownDraft(await readAiTownDraft(a.scope)).town.homeConcept).toBe('112 successful A complete local home')
    expect((await readAiTownDraft(a.scope)).revision).toBe(1)
    expect(after.works.filter(value => (value as { id: number }).id === b.scope.workId))
      .toEqual(before.works.filter(value => (value as { id: number }).id === b.scope.workId))
    expect(after.aiTownAuthoringDrafts.filter(value => (value as { workId: number }).workId === b.scope.workId))
      .toEqual(before.aiTownAuthoringDrafts.filter(value => (value as { workId: number }).workId === b.scope.workId))
    expect({ ...after, works: before.works, aiTownAuthoringDrafts: before.aiTownAuthoringDrafts }).toEqual(before)
    expect(host!.querySelector('[role="alert"]')).toBeNull()
    expect(host!.textContent).not.toContain('制作配置已保存')
    await act(async () => { await router.navigate('/town/vision?project=' + a.scope.projectId + '&work=' + a.scope.workId) })
    await waitForUi(() => { expect(field('住所构想').value).toBe('112 successful A complete local home') })
  } finally { observer.mockRestore(); router.dispose() }
})


it('returns the exact committed preparation draft on explicit opt-in while keeping ordinary numeric callers', async () => {
  const { seedCurrentProductWorld } = await import('../helpers/current-product-world')
  const source = await seedCurrentProductWorld('112 returned preparation source', { minimumCharacters: 4 })
  const settings = defaultAiTownSettings(); settings.town.residentTarget = 4
  const owner = await createAiTownDraft('112 returned preparation owner', settings)
  const selected = await townService.selectAiTownWorld(owner.scope, 0, source.release.id!)
  const legacyId = await townService.prepareAiTownBrief(owner.scope, selected.revision)
  expect(typeof legacyId).toBe('number')
  const legacyDraft = await readAiTownDraft(owner.scope)
  expect(legacyDraft.productionId).toBe(legacyId)
  const prepared = await townService.prepareAiTownBrief(owner.scope, legacyDraft.revision,
    { includeSavedDraft: true })
  const actual = await readAiTownDraft(owner.scope)
  expect(prepared.productionId).toBe(legacyId)
  expect(prepared.draft).toEqual(actual)
  expect(prepared.draft).toMatchObject({ ...owner.scope, productionId: legacyId,
    revision: legacyDraft.revision + 1, preparedRevision: legacyDraft.revision + 1 })
  expect(settingsFromAiTownDraft(prepared.draft)).toEqual(settings)
  expect(await db.productBuilds.count()).toBe(0)
  const nativeDirectory = process.env.QUALITY112_NATIVE_DIR
  if (nativeDirectory) {
    const [{ mkdir, writeFile }, { serialize }, { join }] = await Promise.all([
      import('node:fs/promises'), import('node:v8'), import('node:path'),
    ])
    await mkdir(nativeDirectory, { recursive: true })
    await writeFile(join(nativeDirectory, 'actual-preparation-opt-in-result.bin'),
      serialize({ legacyId, legacyDraft, prepared, actual, tables: await snapshot() }))
  }
})


it('does not hydrate another Work with a late original native read and keeps that new owner saveable', async () => {
  const { default: Dexie } = await import('dexie')
  const a = await createAiTownDraft('112 delayed native read A')
  const b = await createAiTownDraft('112 delayed native read B')
  const before = await snapshot()
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  let originalRowReady = false, delayedOnce = false, releasedOriginalRead = false
  let heldRead: Promise<unknown> | undefined
  const nativeRead = townService.readAiTownDraft
  const observer = vi.spyOn(townService, 'readAiTownDraft').mockImplementation((...args) => {
    const reading = nativeRead(...args)
    if (args[0].workId !== a.scope.workId || delayedOnce) return reading
    delayedOnce = true
    const delayed = Dexie.waitFor(reading.then(async actual => {
      originalRowReady = true
      await gate
      releasedOriginalRead = true
      return actual
    }), 5000)
    heldRead = Promise.resolve(delayed)
    return delayed
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const router = createMemoryRouter([{ path: '/town/:pageId', element: createElement(AiTownPage) }], {
    initialEntries: ['/town/vision?project=' + a.scope.projectId + '&work=' + a.scope.workId],
  })
  try {
    await act(async () => root!.render(createElement(RouterProvider, { router, flushSync })))
    await waitForUi(() => { expect(originalRowReady).toBe(true) })
    await act(async () => {
      await router.navigate('/town/vision?project=' + b.scope.projectId + '&work=' + b.scope.workId,
        { flushSync: true })
      release()
    })
    await waitForUi(() => {
      expect(releasedOriginalRead).toBe(true)
      expect(field('小镇名称').value).toBe('112 delayed native read B')
      expect(field('小镇名称').closest('fieldset')?.disabled).toBe(false)
    })
    expect(await recordNativeControl('late-read-new-owner-before-save', router)).toEqual(before)
    await edit(field('住所构想'), '112 delayed read actual B home')
    await click('保存制作方案')
    await waitForUi(async () => { expect((await readAiTownDraft(b.scope)).revision).toBe(1) })
    const after = await recordNativeControl('late-read-new-owner-after-save', router)
    expect(settingsFromAiTownDraft(await readAiTownDraft(b.scope)).town.homeConcept).toBe('112 delayed read actual B home')
    expect((await readAiTownDraft(a.scope)).revision).toBe(0)
    expect(after.works.filter(value => (value as { id: number }).id === a.scope.workId))
      .toEqual(before.works.filter(value => (value as { id: number }).id === a.scope.workId))
    expect(after.aiTownAuthoringDrafts.filter(value => (value as { workId: number }).workId === a.scope.workId))
      .toEqual(before.aiTownAuthoringDrafts.filter(value => (value as { workId: number }).workId === a.scope.workId))
    expect({ ...after, works: before.works, aiTownAuthoringDrafts: before.aiTownAuthoringDrafts }).toEqual(before)
    expect(host!.querySelector('[role="alert"]')).toBeNull()
  } finally {
    release()
    await heldRead?.catch(() => {})
    observer.mockRestore(); router.dispose()
  }
})
