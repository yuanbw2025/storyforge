import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AvgPage from '../../src/pages/AvgPage'
import ProductProductionStudio from '../../src/components/product/ProductProductionStudio'
import { db } from '../../src/lib/db/schema'
import { DEFAULT_AVG_SETTINGS } from '../../src/lib/avg/authoring-contract'
import { createAvgDraftV1, selectAvgWorldV1 } from '../../src/lib/avg/draft-service'
import * as commands from '../../src/lib/product-production/commands'
import * as services from '../../src/lib/product-production/service'
import { createWorldWork, updateWorkspace } from '../../src/lib/workspace/works'
import { cacheWorldReferenceForProductV1 } from '../../src/lib/world-engine/reference-cache'
import {
  compileProductProductionBriefV3,
  consultProductProductionStartV1,
  createProductProductionWithBriefV1,
} from '../../src/lib/product-production/service'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedTextAdventureMediaRevisionWorkbenchV1 } from '../helpers/text-adventure-media-revision-workbench'

function deferred() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

let host: HTMLDivElement
let root: Root
let locationText = ''
let navigateCurrent: NavigateFunction | null = null
let createResult = deferred()
let holdCreateResult = false
let createdProductionId: number | null = null
let workspaceResult = deferred()
let holdNextWorkspaceResult = false
let workspaceResultHeld = false
let progressResult = deferred()
let holdNextProgressResult = false
let progressResultHeld = false
let rejectProgressResult = false
let archiveResult = deferred()
let holdArchiveResult = false
let archiveResultHeld = false
const nativeExecute = commands.executeProductProductionCommand
const nativeCreate = services.createProductProductionWithBriefV1
const nativeList = services.listProductProductionWorkspaceV1
const nativeDetails = services.readProductProductionDetailsV1
const nativeProgress = services.readProductProductionProgressV1
const activeCalls = new Set<Promise<unknown>>()

function observe<T>(promise: Promise<T>): Promise<T> {
  activeCalls.add(promise)
  void promise.then(() => { activeCalls.delete(promise) }, () => { activeCalls.delete(promise) })
  return promise
}

async function settleObservedCalls() {
  let quiet = 0
  for (let turn = 0; turn < 30; turn++) {
    await act(async () => {
      await Promise.allSettled([...activeCalls])
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    if (activeCalls.size === 0) quiet++
    else quiet = 0
    if (quiet === 2) return
  }
  throw Error('Original native service calls did not settle')
}

function LocationWitness() {
  locationText = useLocation().search
  navigateCurrent = useNavigate()
  return null
}

async function waitFor(assertion: () => void | Promise<void>) {
  const started = Date.now()
  let last: unknown
  while (Date.now() - started < 5000) {
    try {
      await act(async () => { await assertion() })
      return
    } catch (error) {
      last = error
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

function button(label: string) {
  const found = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label)
  if (!found) throw Error(`Missing actual UI button: ${label}`)
  return found
}

async function click(label: string) {
  await waitFor(() => { expect(button(label).disabled).toBe(false) })
  await act(async () => { button(label).click() })
}

async function fixture(title = '005 first-save AVG') {
  const world = await seedCurrentProductWorld(`${title} real frozen source`)
  const settings = { ...DEFAULT_AVG_SETTINGS, playerRole: '灯塔档案员',
    openingSituation: '和林舟核对港口来信', experience: '保留作者边界的调查', visualLevel: 'none' as const }
  const created = await createAvgDraftV1(title, settings)
  const draft = await selectAvgWorldV1(created.scope, 0, world.release.id!)
  if (draft.worldReleaseId == null) throw Error('Public AVG world selection returned no frozen release')
  return { scope: created.scope, settings, releaseId: draft.worldReleaseId, title }
}

async function existingProduction(f: Awaited<ReturnType<typeof fixture>>, title: string) {
  const consultation = await consultProductProductionStartV1({ scope: f.scope, worldReleaseId: f.releaseId, productType: 'avg' })
  const suggestion = consultation.suggestions[0]!
  const brief = await compileProductProductionBriefV3({ scope: f.scope, worldReleaseId: f.releaseId,
    suggestionKey: suggestion.suggestionKey, productType: 'avg', scale: 'scene', qualityProfile: 'prototype',
    visualLevel: 'none', audioLevel: 'none', playerRole: f.settings.playerRole, openingSituation: f.settings.openingSituation,
    avg: f.settings, sourceSelection: consultation.selectionDefaults[suggestion.suggestionKey] })
  return createProductProductionWithBriefV1({ scope: f.scope, worldReleaseId: f.releaseId, title, brief })
}

async function mountDirect(f: Awaited<ReturnType<typeof fixture>>, options: { productionId?: number; product?: 'avg' | 'ttrpg' } = {}) {
  const product = options.product ?? 'avg'
  await updateWorkspace(f.scope.projectId, { productPlatformOptIns: { productProductionV3: true } })
  await act(async () => {
    root.render(createElement(ProductProductionStudio, {
      scope: f.scope, allowedProducts: [product], initialProduct: product,
      initialProductionId: options.productionId, view: 'confirm', authorOptIn: true,
      avgSetup: product === 'avg' ? { settings: f.settings, title: f.title, worldReleaseId: f.releaseId } : undefined,
    }))
  })
  if (holdCreateResult && createdProductionId != null) await settleObservedCallsWithoutHeldCreation()
  else await settleObservedCalls()
}

async function prepareAndHoldSave(pageParent: boolean) {
  if (pageParent) await click('启用并继续确认')
  await click('分析可玩起点')
  await click('生成严格 Brief')
  await waitFor(() => { expect(host.querySelector('[data-testid="product-production-command-activity"]')?.textContent).toContain('succeeded') })
  holdCreateResult = true
  await click('保存 Brief revision')
  await waitFor(() => { expect(createdProductionId).not.toBeNull() })
}

async function releaseAndReadOriginalBrief() {
  createResult.release()
  await waitFor(async () => { expect((await db.productProductions.get(createdProductionId!))?.currentBriefRevision).toBe(1) })
  await settleObservedCalls()
}

async function snapshotDatabase() {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
}

async function mountRecoveryWithHeldProgress() {
  const f = await seedTextAdventureMediaRevisionWorkbenchV1(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8WgWQAAAABJRU5ErkJggg==',
  )
  await db.productBuilds.update(f.parentBuildId, { status: 'recovery-required', failureJson: JSON.stringify({
    taskKey: 'content.quest-script.main.act-2.single', code: 'task-executor-failed', detail: '005 read-only recovery fixture',
  }) })
  await db.productProductions.update(f.productionId, { status: 'producing' })
  const before = await snapshotDatabase()
  holdNextProgressResult = true
  await act(async () => root.render(createElement(ProductProductionStudio, {
    scope: f.scope, initialProductionId: f.productionId, initialProduct: 'text-adventure', allowedProducts: ['text-adventure'],
  })))
  await waitFor(() => { expect(progressResultHeld).toBe(true) })
  await waitFor(() => { expect(host.querySelector('textarea[aria-label="作者修订的完整任务 JSON"]')).not.toBeNull() })
  return { ...f, before }
}

async function typeRecoveryDraft(value: string) {
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="作者修订的完整任务 JSON"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function mount(scope: Awaited<ReturnType<typeof fixture>>['scope'], productionId?: number, strict = false) {
  const url = `/avg/confirm?project=${scope.projectId}&work=${scope.workId}${productionId ? `&production=${productionId}` : ''}`
  await act(async () => {
    const page = createElement(MemoryRouter, { initialEntries: [url] },
      createElement(LocationWitness),
      createElement(Routes, null,
        createElement(Route, { path: '/avg/:pageId', element: createElement(AvgPage) }),
        createElement(Route, { path: '/other-product', element: createElement('div', null, '005 other product view') })))
    root.render(strict ? createElement(StrictMode, null, page) : page)
  })
  await waitFor(() => { expect(host.querySelector('[data-testid="avg-page"]')).not.toBeNull() })
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model or network is authorized') }))
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
  vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => undefined)
  await db.delete()
  await db.open()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  locationText = ''
  navigateCurrent = null
  activeCalls.clear()
  createResult = deferred()
  holdCreateResult = false
  createdProductionId = null
  workspaceResult = deferred()
  holdNextWorkspaceResult = false
  workspaceResultHeld = false
  progressResult = deferred()
  holdNextProgressResult = false
  progressResultHeld = false
  rejectProgressResult = false
  archiveResult = deferred()
  holdArchiveResult = false
  archiveResultHeld = false
  vi.spyOn(commands, 'executeProductProductionCommand').mockImplementation(async input => {
    // The original command and native TX finish first. Only its unmodified
    // return is delayed; no DB work is kept alive and no authority is invented.
    const result = await observe(nativeExecute(input))
    const commandType = input.command != null && typeof input.command === 'object' && 'type' in input.command
      ? input.command.type : undefined
    if (holdCreateResult && createdProductionId == null && commandType === 'create-intent') {
      createdProductionId = result.productionId
      await createResult.promise
    }
    if (holdArchiveResult && commandType === 'archive') {
      archiveResultHeld = true
      await observe(archiveResult.promise)
    }
    return result
  })
  vi.spyOn(services, 'createProductProductionWithBriefV1').mockImplementation((...args) => observe(nativeCreate(...args)))
  vi.spyOn(services, 'listProductProductionWorkspaceV1').mockImplementation((...args) => observe((async () => {
    const result = await nativeList(...args)
    if (holdNextWorkspaceResult) {
      holdNextWorkspaceResult = false
      workspaceResultHeld = true
      await workspaceResult.promise
    }
    return result
  })()))
  vi.spyOn(services, 'readProductProductionDetailsV1').mockImplementation((...args) => observe(nativeDetails(...args)))
  vi.spyOn(services, 'readProductProductionProgressV1').mockImplementation((...args) => observe((async () => {
    const result = await nativeProgress(...args)
    if (holdNextProgressResult) {
      holdNextProgressResult = false
      progressResultHeld = true
      await progressResult.promise
      if (rejectProgressResult) throw Error('005 injected progress read failure after native read')
    }
    return result
  })()))
})

afterEach(async () => {
  // Detach the real UI before releasing a failed assertion's held read. This
  // prevents cleanup itself from authorizing an old mounted auto-continuation.
  await act(async () => { root.unmount() })
  createResult.release()
  workspaceResult.release()
  progressResult.release()
  archiveResult.release()
  await settleObservedCalls()
  host.remove()
  vi.restoreAllMocks()
  await db.delete()
  vi.unstubAllGlobals()
})

describe('005 shared Studio first-save projection', () => {
  for (const strict of [false, true]) it(`shows real Brief1 after its parent selects the committed new intent before the Brief command finishes (StrictMode=${strict})`, async () => {
    const f = await fixture()
    await mount(f.scope, undefined, strict)
    await prepareAndHoldSave(true)
    await waitFor(async () => {
      expect(createdProductionId).not.toBeNull()
      expect(new URLSearchParams(locationText).get('production')).toBe(String(createdProductionId))
      expect((await db.productProductions.get(createdProductionId!))?.status).toBe('consulting')
      expect(await db.productProductionBriefs.count()).toBe(0)
    })
    await act(async () => { createResult.release() })
    await waitFor(async () => {
      expect((await db.productProductions.get(createdProductionId!))?.currentBriefRevision).toBe(1)
      expect(await db.productProductionBriefs.count()).toBe(1)
      expect((await db.productProductionCommands.toArray()).map(row => [row.type, row.status]))
        .toEqual([['create-intent', 'succeeded'], ['save-brief-revision', 'succeeded']])
    })
    await waitFor(() => { expect(host.textContent).toContain('r1 · 草稿') })
    expect(new URLSearchParams(locationText).get('production')).toBe(String(createdProductionId))
    expect(await db.productBuilds.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('reads an already persisted real Brief1 normally without creating or authorizing another production', async () => {
    const f = await fixture()
    const productionId = await existingProduction(f, '005 existing AVG')
    const before = await db.productProductionCommands.toArray()
    await mount(f.scope, productionId)
    await waitFor(() => { expect(host.textContent).toContain('r1 · 草稿') })
    expect(await db.productProductionCommands.toArray()).toEqual(before)
    expect(await db.productProductions.count()).toBe(1)
    expect(await db.productBuilds.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('can explicitly create a successor Production while its original Production is selected', async () => {
    const f = await fixture()
    const originalId = await existingProduction(f, '005 original selected Production')
    const original = await db.productProductions.get(originalId)
    await mount(f.scope, originalId)
    await waitFor(() => { expect(host.textContent).toContain('r1 · 草稿') })
    await click('新建 Production')
    await prepareAndHoldSave(true)
    expect(new URLSearchParams(locationText).get('production')).toBe(String(originalId))
    await releaseAndReadOriginalBrief()
    await waitFor(() => {
      expect(new URLSearchParams(locationText).get('production')).toBe(String(createdProductionId))
      expect(host.querySelector('main h1')?.textContent).toBe(f.title)
      expect(host.textContent).toContain('r1 · 草稿')
    })
    expect(createdProductionId).not.toBe(originalId)
    expect(await db.productProductions.get(originalId)).toEqual(original)
    expect(await db.productProductionBriefs.count()).toBe(2)
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  for (const changed of ['work', 'world', 'product-route'] as const) it(`never returns a late save to the original view after a real ${changed} navigation`, async () => {
    const f = await fixture()
    const target = changed === 'world' ? await fixture('005 other World AVG') : null
    const work = changed === 'work' ? await createWorldWork(f.scope.projectId, { title: '005 same World other Work', kind: 'avg' }) : null
    await mount(f.scope)
    await prepareAndHoldSave(true)
    await waitFor(() => { expect(new URLSearchParams(locationText).get('production')).toBe(String(createdProductionId)) })
    const next = target ? `/avg/confirm?project=${target.scope.projectId}&work=${target.scope.workId}`
      : work ? `/avg/confirm?project=${f.scope.projectId}&work=${work.id}` : '/other-product'
    await act(async () => { void navigateCurrent!(next) })
    await settleObservedCallsWithoutHeldCreation()
    const selected = locationText
    const foreignRows = target ? await db.works.get(target.scope.workId) : work ? await db.works.get(work.id!) : null
    await releaseAndReadOriginalBrief()
    expect(locationText).toBe(selected)
    if (target) expect(await db.works.get(target.scope.workId)).toEqual(foreignRows)
    if (work) expect(await db.works.get(work.id!)).toEqual(foreignRows)
    expect(await db.productBuilds.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('keeps another selected Production after the first new save completes', async () => {
    const f = await fixture()
    await mountDirect(f)
    await prepareAndHoldSave(false)
    const otherId = await existingProduction(f, '005 explicitly selected other Production')
    await mountDirect(f, { productionId: otherId })
    await waitFor(() => { expect(host.querySelector('main h1')?.textContent).toBe('005 explicitly selected other Production') })
    const other = await db.productProductions.get(otherId)
    await releaseAndReadOriginalBrief()
    expect(host.querySelector('main h1')?.textContent).toBe('005 explicitly selected other Production')
    expect(await db.productProductions.get(otherId)).toEqual(other)
    expect(host.querySelector('[data-testid="product-production-command-activity"]')?.textContent ?? '')
      .not.toContain('保存 Brief revision · succeeded')
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('does not apply a completed AVG save to a different allowed product in the same shared component', async () => {
    const f = await fixture()
    await mountDirect(f)
    await prepareAndHoldSave(false)
    await mountDirect(f, { product: 'ttrpg' })
    await releaseAndReadOriginalBrief()
    expect(host.textContent).not.toContain('r1 · 草稿')
    expect(host.querySelector('[data-testid="product-production-command-activity"]')?.textContent ?? '')
      .not.toContain('保存 Brief revision · succeeded')
    expect((await db.productProductions.get(createdProductionId!))?.productType).toBe('avg')
    expect(await db.productBuilds.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('preserves a subsequently selected frozen source instead of selecting the completed old-source Production', async () => {
    const f = await fixture()
    const nextWorld = await seedCurrentProductWorld('005 subsequent source')
    const nextReleaseId = await cacheWorldReferenceForProductV1(f.scope, nextWorld.release.id!)
    await mountDirect(f)
    await prepareAndHoldSave(false)
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="冻结 WorldRelease"]')!
    await act(async () => {
      select.value = String(nextReleaseId)
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await releaseAndReadOriginalBrief()
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="冻结 WorldRelease"]')?.value).toBe(String(nextReleaseId))
    expect(host.textContent).not.toContain('r1 · 草稿')
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('does not apply the old save after the parent changes its frozen source in the same Work', async () => {
    const f = await fixture()
    const nextWorld = await seedCurrentProductWorld('005 parent subsequent source')
    const nextReleaseId = await cacheWorldReferenceForProductV1(f.scope, nextWorld.release.id!)
    await mountDirect(f)
    await prepareAndHoldSave(false)
    await mountDirect({ ...f, releaseId: nextReleaseId })
    await releaseAndReadOriginalBrief()
    expect(host.querySelector('[data-testid="product-production-command-activity"]')?.textContent ?? '')
      .not.toContain('保存 Brief revision · succeeded')
    expect((await db.productProductionBriefs.toArray())[0]?.sourceWorldReleaseId).toBe(f.releaseId)
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('keeps author text entered while the first save is in flight', async () => {
    const f = await fixture()
    await mountDirect(f)
    await prepareAndHoldSave(false)
    const input = host.querySelector<HTMLInputElement>('input[placeholder="会谈后可修改"]')!
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setValue.call(input, '005 author newer title')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await releaseAndReadOriginalBrief()
    expect(host.querySelector<HTMLInputElement>('input[placeholder="会谈后可修改"]')?.value).toBe('005 author newer title')
    expect((await db.productProductions.get(createdProductionId!))?.title).toBe(f.title)
    expect(host.querySelector('[data-testid="product-production-command-activity"]')?.textContent ?? '')
      .not.toContain('保存 Brief revision · succeeded')
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('ignores a refresh snapshot if the author changes its source during that native read', async () => {
    const f = await fixture()
    const nextWorld = await seedCurrentProductWorld('005 source changed during refresh')
    const nextReleaseId = await cacheWorldReferenceForProductV1(f.scope, nextWorld.release.id!)
    await mountDirect(f)
    await prepareAndHoldSave(false)
    holdNextWorkspaceResult = true
    await act(async () => { createResult.release() })
    await waitFor(() => { expect(workspaceResultHeld).toBe(true) })
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="冻结 WorldRelease"]')!
    await act(async () => {
      select.value = String(nextReleaseId)
      select.dispatchEvent(new Event('change', { bubbles: true }))
      workspaceResult.release()
    })
    await settleObservedCalls()
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="冻结 WorldRelease"]')?.value).toBe(String(nextReleaseId))
    expect((await db.productProductions.get(createdProductionId!))?.currentBriefRevision).toBe(1)
    expect(host.textContent).not.toContain('r1 · 草稿')
    expect(host.querySelector('[data-testid="product-production-command-activity"]')?.textContent ?? '')
      .not.toContain('保存 Brief revision · succeeded')
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('shows owned native details and keeps a local author draft while pending progress cannot authorize execution', async () => {
    const f = await mountRecoveryWithHeldProgress()
    const originalDraft = '{"author":"005 pending progress draft"}'
    await typeRecoveryDraft(originalDraft)
    expect(button('修正后继续制作').disabled).toBe(true)
    await act(async () => { button('修正后继续制作').click() })
    expect(await snapshotDatabase()).toEqual(f.before)
    await act(async () => { progressResult.release() })
    await settleObservedCalls()
    await waitFor(() => { expect(button('修正后继续制作').disabled).toBe(false) })
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="作者修订的完整任务 JSON"]')?.value).toBe(originalDraft)
    expect(await snapshotDatabase()).toEqual(f.before)
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('does not automatically execute an authorized native Build before its progress read completes', async () => {
    const f = await fixture('005 authorized Build awaiting progress')
    const productionId = await existingProduction(f, f.title)
    const brief = await db.productProductionBriefs.where('productionId').equals(productionId).first()
    const receipt = await commands.executeProductProductionCommand({ scope: f.scope, productionId,
      command: { type: 'authorize-start', commandId: '005.pending-progress.authorize', expectedStateRevision: 1,
        briefRevision: brief!.revision, briefHash: brief!.briefHash, authorizationNonce: '005.pending-progress.explicit-author' } })
    expect(receipt.ok).toBe(true)
    const before = await snapshotDatabase()
    const run = vi.spyOn(services, 'runAuthorizedProductProductionV1')
    holdNextProgressResult = true
    await act(async () => root.render(createElement(ProductProductionStudio, {
      scope: f.scope, initialProductionId: productionId, initialProduct: 'avg', allowedProducts: ['avg'],
      avgSetup: { settings: f.settings, title: f.title, worldReleaseId: f.releaseId },
    })))
    await waitFor(() => {
      expect(progressResultHeld).toBe(true)
      expect(button('继续自动制作').disabled).toBe(true)
    })
    await act(async () => { button('继续自动制作').click() })
    expect(run).not.toHaveBeenCalled()
    expect(await snapshotDatabase()).toEqual(before)
    await act(async () => { root.unmount() })
    root = createRoot(host)
    progressResult.release()
    await settleObservedCalls()
    expect(run).not.toHaveBeenCalled()
    expect(await snapshotDatabase()).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('ignores the old native progress after the shared component changes Work and World', async () => {
    const previous = await mountRecoveryWithHeldProgress()
    const next = await seedTextAdventureMediaRevisionWorkbenchV1(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8WgWQAAAABJRU5ErkJggg==',
    )
    expect(next.scope.workId).not.toBe(previous.scope.workId)
    expect(next.scope.worldId).not.toBe(previous.scope.worldId)
    await db.productProductions.update(next.productionId, { title: '005 different scope while progress is pending' })
    const before = await snapshotDatabase()
    await act(async () => root.render(createElement(ProductProductionStudio, {
      scope: next.scope, initialProductionId: next.productionId,
      initialProduct: 'text-adventure', allowedProducts: ['text-adventure'],
    })))
    await waitFor(() => { expect(host.querySelector('main h1')?.textContent).toBe('005 different scope while progress is pending') })
    progressResult.release()
    await settleObservedCalls()
    expect(host.querySelector('main h1')?.textContent).toBe('005 different scope while progress is pending')
    expect(await snapshotDatabase()).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('does not attach an old progress failure to the author explicit new-Production form', async () => {
    const f = await mountRecoveryWithHeldProgress()
    await click('新建 Production')
    expect(host.querySelector('main h1')?.textContent).toBe('从冻结世界版本开始制作')
    rejectProgressResult = true
    progressResult.release()
    await settleObservedCalls()
    expect(host.querySelector('main h1')?.textContent).toBe('从冻结世界版本开始制作')
    expect(host.querySelector('[role="alert"]')?.textContent ?? '').not.toContain('005 injected progress read failure')
    expect(await snapshotDatabase()).toEqual(f.before)
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('fails closed on a progress read error and permits a real refresh without losing the local author draft', async () => {
    const f = await mountRecoveryWithHeldProgress()
    const originalDraft = '{"author":"005 retained across progress read error"}'
    await typeRecoveryDraft(originalDraft)
    rejectProgressResult = true
    await act(async () => { progressResult.release() })
    await settleObservedCalls()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('005 injected progress read failure')
    expect(button('修正后继续制作').disabled).toBe(true)
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="刷新当前 Production"]')?.disabled).toBe(false)
    expect(await snapshotDatabase()).toEqual(f.before)
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="刷新当前 Production"]')!.click() })
    await settleObservedCalls()
    await waitFor(() => { expect(button('修正后继续制作').disabled).toBe(false) })
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="作者修订的完整任务 JSON"]')?.value).toBe(originalDraft)
    expect(await snapshotDatabase()).toEqual(f.before)
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)
})

async function competingActualBriefCommit(f: Awaited<ReturnType<typeof fixture>>) {
  const consultation = await consultProductProductionStartV1({ scope: f.scope, worldReleaseId: f.releaseId, productType: 'avg' })
  const suggestion = consultation.suggestions[0]!
  const brief = await compileProductProductionBriefV3({
    scope: f.scope, worldReleaseId: f.releaseId, suggestionKey: suggestion.suggestionKey,
    productType: 'avg', scale: 'scene', qualityProfile: 'prototype', visualLevel: 'none', audioLevel: 'none',
    playerRole: f.settings.playerRole, openingSituation: f.settings.openingSituation, avg: f.settings,
    sourceSelection: consultation.selectionDefaults[suggestion.suggestionKey],
  })
  const receipt = await nativeExecute({ scope: f.scope, productionId: createdProductionId!, command: {
    type: 'save-brief-revision', commandId: 'quality005.competing.actual.brief',
    expectedStateRevision: 0, parentRevision: null, brief,
  } })
  expect(receipt.ok).toBe(true)
  expect((await db.productProductions.get(createdProductionId!))?.currentBriefRevision).toBe(1)
}

async function selectOtherActualProduction(f: Awaited<ReturnType<typeof fixture>>) {
  const title = '005 new B selected while old A is pending'
  const otherId = await existingProduction(f, title)
  await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="刷新制作列表"]')!.click() })
  await waitFor(() => { expect([...host.querySelectorAll('button')].some(item => item.textContent?.includes(title))).toBe(true) })
  await act(async () => { [...host.querySelectorAll('button')].find(item => item.textContent?.includes(title))!.click() })
  await waitFor(() => { expect(new URLSearchParams(locationText).get('production')).toBe(String(otherId)) })
  await waitFor(() => { expect(host.querySelector('main h1')?.textContent).toBe(title) })
  await settleObservedCallsWithoutHeldCreation()
  return otherId
}

async function assertOriginalConflictRetained() {
  const commands = await db.productProductionCommands.where('productionId').equals(createdProductionId!).toArray()
  expect(commands.some(item => item.type === 'save-brief-revision'
    && item.status === 'failed' && item.errorCode === 'production-state-conflict')).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
  expect(await db.productBuilds.count()).toBe(0)
}

describe('005 command result ownership', () => {
  it('keeps a real first-save conflict visible after the parent automatically selects that own new Production', async () => {
    const f = await fixture('005 own A concurrent save')
    await mount(f.scope)
    await prepareAndHoldSave(true)
    await competingActualBriefCommit(f)
    await waitFor(() => { expect(new URLSearchParams(locationText).get('production')).toBe(String(createdProductionId)) })
    createResult.release()
    await settleObservedCalls()
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/revision|过期|conflict|冲突/i)
    expect(host.querySelector('[data-testid="product-production-command-activity"]')?.textContent).toContain('conflict / failed')
    await assertOriginalConflictRetained()
  }, 20_000)

  it('does not attach an old native save conflict to the actual explicitly selected other Production', async () => {
    const f = await fixture('005 old A conflict isolation')
    await mount(f.scope)
    await prepareAndHoldSave(true)
    await competingActualBriefCommit(f)
    const otherId = await selectOtherActualProduction(f)
    const before = await db.productProductions.get(otherId)
    const url = locationText
    createResult.release()
    await settleObservedCalls()
    expect(locationText).toBe(url)
    expect(await db.productProductions.get(otherId)).toEqual(before)
    expect(host.querySelector('[role="alert"]')?.textContent ?? '').toBe('')
    expect(host.querySelector('[data-testid="product-production-command-activity"]')?.textContent ?? '').not.toContain('conflict / failed')
    await assertOriginalConflictRetained()
  }, 20_000)

  it('does not attach the same native save conflict after a real route unmount', async () => {
    const f = await fixture('005 unmounted A native conflict')
    await mount(f.scope)
    await prepareAndHoldSave(true)
    await competingActualBriefCommit(f)
    await act(async () => { void navigateCurrent!('/other-product') })
    createResult.release()
    await settleObservedCalls()
    expect(host.textContent).toContain('005 other product view')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    await assertOriginalConflictRetained()
  }, 20_000)

  it('does not let the old A failure or finally clear a newer actual B command activity and busy state', async () => {
    const f = await fixture('005 B owns newer pending command')
    await mount(f.scope)
    await prepareAndHoldSave(true)
    await competingActualBriefCommit(f)
    const otherId = await selectOtherActualProduction(f)
    holdArchiveResult = true
    await click('归档')
    await waitFor(() => { expect(archiveResultHeld).toBe(true) })
    expect(host.querySelector('[data-testid="product-production-command-activity"]')?.textContent).toContain('归档 Production · pending')
    expect(host.querySelector('[aria-busy="true"]')?.textContent).toContain('正在执行受治理的制作步骤')
    const archiveAction = () => [...host.querySelectorAll('button')].find(item => ['归档', '恢复归档'].includes(item.textContent?.trim() ?? ''))!
    expect(archiveAction().disabled).toBe(true)
    createResult.release()
    await waitFor(assertOriginalConflictRetained)
    expect(host.querySelector('[role="alert"]')?.textContent ?? '').toBe('')
    expect(host.querySelector('[data-testid="product-production-command-activity"]')?.textContent).toContain('归档 Production · pending')
    expect(host.querySelector('[aria-busy="true"]')?.textContent).toContain('正在执行受治理的制作步骤')
    expect(archiveAction().disabled).toBe(true)
    archiveResult.release()
    await settleObservedCalls()
    await waitFor(() => { expect(host.querySelector('[data-testid="product-production-command-activity"]')?.textContent).toContain('归档 Production · succeeded') })
    expect((await db.productProductions.get(otherId))?.status).toBe('archived')
    expect(button('恢复归档').disabled).toBe(false)
    await assertOriginalConflictRetained()
  }, 20_000)
})

async function settleObservedCallsWithoutHeldCreation() {
  // The create result is intentionally pending. Let real parent/router effects
  // run without awaiting that one withheld return or extending its native TX.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
