import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { DialogProvider } from '../../src/components/shared/Dialog'
import TextOpenWorldPlayer from '../../src/components/text-game/TextOpenWorldPlayer'
import * as actions from '../../src/lib/open-world/action-executor'
import * as saves from '../../src/lib/open-world/player-saves'
import { readTextOpenWorldProductionSourceKindV1 } from '../../src/lib/open-world/source-admission'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { EMPTY_PRODUCT_RUNTIME_STATE, type Project } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'
import { seedQuality005LegacyNovelV1, snapshotQuality005RowsV1 } from '../helpers/quality005-legacy-novel'

vi.mock('../../src/components/text-game/TextOpenWorldVNextPlayer', () => ({
  default: () => createElement('p', { 'data-testid': 'quality005-live-player-mounted' }, 'normal World player'),
}))
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

async function waitFor(check: () => void) {
  const until = Date.now() + 5000
  let failure: unknown
  do {
    try { await act(async () => check()); return } catch (cause) { failure = cause }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  } while (Date.now() < until)
  throw failure
}

describe('SFQA-005 · verified legacy reads and the actual player shell', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(async () => {
    await db.delete(); await db.open()
    useTextOpenWorldPlayerStore.setState({ ...useTextOpenWorldPlayerStore.getInitialState(),
      runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE) })
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })
  afterAll(() => db.close())

  it('classifies the actual hash-closed novel Brief without changing any stored byte', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const before = await snapshotQuality005RowsV1()
    expect(await readTextOpenWorldProductionSourceKindV1({ scope: f.scope, productionId: f.creator.productionId })).toBe('novel')
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('does not accept a foreign scope or forged source-kind metadata as a World source', async () => {
    const f = await seedQuality005LegacyNovelV1()
    await expect(readTextOpenWorldProductionSourceKindV1({ scope: { ...f.scope, workId: f.scope.workId + 999 },
      productionId: f.creator.productionId })).rejects.toThrow(/当前 Work|归属|作用域/)
    await db.productProductions.update(f.creator.productionId, { creatorSourceKind: 'world-release' })
    const before = await snapshotQuality005RowsV1()
    await expect(readTextOpenWorldProductionSourceKindV1({ scope: f.scope, productionId: f.creator.productionId }))
      .rejects.toThrow(/证据不一致/)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('cold-loads and refreshes the exact old event prefix without system jobs, automatic saves or live Player effects', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const resume = vi.spyOn(actions, 'resumeTextOpenWorldSystemWorkV1')
    const reconcile = vi.spyOn(saves, 'reconcileTextOpenWorldAutomaticSavesV1')
    const before = await snapshotQuality005RowsV1()
    const project = (await db.projects.get(f.scope.projectId))! as Project
    await act(async () => root.render(createElement(DialogProvider, null, createElement(TextOpenWorldPlayer, {
      project, scope: f.scope, worldGroupId: null, initialSessionId: f.receiptSessionId,
    }))))
    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-legacy-novel-readonly"]')).toBeTruthy())
    expect(host.querySelector('[data-testid="quality005-live-player-mounted"]')).toBeNull()
    expect(host.textContent).toContain(f.envelope.commandId)
    expect(resume).not.toHaveBeenCalled(); expect(reconcile).not.toHaveBeenCalled()
    const refresh = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '重新核对原存档')!
    await act(async () => refresh.click())
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().loading).toBe(false))
    expect(resume).not.toHaveBeenCalled(); expect(reconcile).not.toHaveBeenCalled()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('keeps true World source classification, system recovery and live Player mounting', async () => {
    const f = await createTextOpenWorldCreatorReleaseFixtureV1('world-release')
    expect(await readTextOpenWorldProductionSourceKindV1({ scope: f.scope, productionId: f.creator.productionId })).toBe('world-release')
    const releaseId = await db.productReleases.add({ ...f.scope, productType: 'text-open-world',
      productionKey: f.creator.productionKey, worldReleaseId: null, version: 1, label: '005 true portable World',
      manifestJson: JSON.stringify(f.manifest), contentHash: await hashProductProductionValueV2(f.manifest), createdAt: Date.now() }) as number
    const session = await createTextOpenWorldInstance({ scope: f.scope, productReleaseId: releaseId, title: 'World normal', seed: '005-normal' })
    const resume = vi.spyOn(actions, 'resumeTextOpenWorldSystemWorkV1')
    const project = (await db.projects.get(f.scope.projectId))! as Project
    await act(async () => root.render(createElement(DialogProvider, null, createElement(TextOpenWorldPlayer, {
      project, scope: f.scope, worldGroupId: null, initialSessionId: session.id!,
    }))))
    await waitFor(() => expect(host.querySelector('[data-testid="quality005-live-player-mounted"]')).toBeTruthy())
    expect(host.querySelector('[data-testid="text-open-world-legacy-novel-readonly"]')).toBeNull()
    expect(resume).toHaveBeenCalledWith(session.id)
  }, 30_000)
})
