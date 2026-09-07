import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DialogProvider } from '../../src/components/shared/Dialog'
import TextOpenWorldPlayer from '../../src/components/text-game/TextOpenWorldPlayer'
import { db } from '../../src/lib/db/schema'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import { EMPTY_PRODUCT_RUNTIME_STATE, type ProductRelease } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import {
  createGovernedTextOpenWorldSessionFixtureV1,
  createTextOpenWorldVNextOnlyProductRuntimePackageFixtureV1,
} from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function resetStore() {
  useTextOpenWorldPlayerStore.setState({
    scope: null,
    worldGroupId: null,
    releases: [],
    sessions: [],
    selectedSessionId: null,
    selectedSession: null,
    selectedSessionSource: null,
    events: [],
    checkpoints: [],
    runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    selectedManifest: null,
    lastFeedback: null,
    generatedCandidate: null,
    loading: false,
    busy: false,
    error: '',
  })
}

function button(host: ParentNode, text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll('button'))
    .find(item => item.textContent?.trim() === text)
  if (!result) throw new Error(`找不到按钮:${text}`)
  return result
}

function buttonByLabel(host: ParentNode, label: string): HTMLButtonElement {
  const result = host.querySelector(`button[aria-label="${label}"]`)
  if (!(result instanceof HTMLButtonElement)) throw new Error(`找不到按钮:${label}`)
  return result
}

async function click(target: HTMLButtonElement) {
  await act(async () => {
    target.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function waitFor(assertion: () => void | Promise<void>) {
  const started = Date.now()
  let last: unknown
  while (Date.now() - started < 12_000) {
    try {
      await act(async () => { await assertion() })
      return
    } catch (reason) {
      last = reason
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

async function formalVersionFixture() {
  const created = await createGovernedTextOpenWorldSessionFixtureV1({
    name: `玩家库版本验收-${crypto.randomUUID()}`,
    textOpenWorldVNext: createTextOpenWorldVNextFixture(),
    runtimeShape: 'vnext-only',
    title: '旧版旅程',
    seed: 'g4-old-release-save',
  })
  const secondManifest = await createFixtureProductReleaseManifestV1({
    runtimePackage: created.runtimePackage,
    productionKey: created.release.productionKey,
    releaseVersion: 2,
    parentRelease: {
      releaseUid: created.manifest.lineage.releaseUid,
      releaseHash: created.manifest.lineage.releaseHash,
    },
  })
  const secondRelease: ProductRelease = {
    ...created.scope,
    productionKey: created.release.productionKey,
    productType: 'text-open-world',
    worldReleaseId: null,
    version: 2,
    label: '盐脊 v2',
    manifestJson: JSON.stringify(secondManifest),
    contentHash: await hashProductProductionValueV2(secondManifest),
    // Deliberately older: player catalog selection must prefer version over import time.
    createdAt: created.release.createdAt - 10_000,
  }
  secondRelease.id = await db.productReleases.add(secondRelease) as number
  return { ...created, secondManifest, secondRelease }
}

async function previewFixture() {
  const owned = await seedCurrentProductWorld(`玩家预览隔离-${crypto.randomUUID()}`)
  const textOpenWorldVNext = createTextOpenWorldVNextFixture()
  textOpenWorldVNext.sourceManifest.contentHash = owned.release.contentHash
  const runtimePackage = createTextOpenWorldVNextOnlyProductRuntimePackageFixtureV1(textOpenWorldVNext)
  const build = await seedCurrentProductBuild({
    scope: owned.scope,
    worldRelease: owned.release,
    runtimePackage,
    title: '制作预览时间线',
    seed: 'g4-build-preview',
  })
  const productionKey = `fixture.text-open-world.preview.${crypto.randomUUID()}`
  const manifest = await createFixtureProductReleaseManifestV1({ runtimePackage, productionKey })
  const release: ProductRelease = {
    ...owned.scope,
    productionKey,
    productType: 'text-open-world',
    worldReleaseId: owned.release.id,
    version: 1,
    label: '正式开放世界 v1',
    manifestJson: JSON.stringify(manifest),
    contentHash: await hashProductProductionValueV2(manifest),
    createdAt: Date.now(),
  }
  release.id = await db.productReleases.add(release) as number
  const formalSession = await createTextOpenWorldInstance({
    scope: owned.scope,
    productReleaseId: release.id,
    title: '正式存档时间线',
    seed: 'g4-formal-save',
  })
  return { ...owned, build, release, formalSession }
}

describe('Text Open World G4 · 玩家库与版本绑定 UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeAll(async () => { await db.delete(); await db.open() })
  beforeEach(async () => {
    await db.delete()
    await db.open()
    localStorage.clear()
    resetStore()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  afterAll(() => db.close())

  it.sequential('普通进入停留游戏库，新版作品卡与旧版存档各自显示真实 Release', async () => {
    const created = await formalVersionFixture()

    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(TextOpenWorldPlayer, {
        project: created.project,
        scope: created.scope,
        worldGroupId: null,
      })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    await waitFor(() => {
      expect(useTextOpenWorldPlayerStore.getState().loading).toBe(false)
      expect(host.textContent).toContain('Release v2')
    })
    expect(host.querySelector('[data-testid="text-open-world-vnext-runtime"]')).toBeNull()
    expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).toBeNull()
    expect(host.textContent).toContain('文字开放世界游戏库')
    expect(host.textContent).toContain('旧版旅程')
    expect(host.textContent).toContain('盐脊 · Release v1')
  }, 30_000)

  it.sequential('删除存档必须显式确认，取消不变更数据，确认只删时间线', async () => {
    const created = await formalVersionFixture()

    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(TextOpenWorldPlayer, {
        project: created.project,
        scope: created.scope,
        worldGroupId: null,
      })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(host.textContent).toContain('旧版旅程'))

    await click(buttonByLabel(host, '删除存档：旧版旅程'))
    await waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('删除存档“旧版旅程”？'))
    await click(button(document, '保留'))
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    await expect(db.productRuntimeSessions.get(created.session.id!)).resolves.toBeDefined()
    expect(host.textContent).toContain('旧版旅程')

    await click(buttonByLabel(host, '删除存档：旧版旅程'))
    await click(button(document, '删除存档'))
    await waitFor(async () => {
      await expect(db.productRuntimeSessions.get(created.session.id!)).resolves.toBeUndefined()
      expect(host.textContent).not.toContain('旧版旅程')
    })
    await expect(db.productReleases.get(created.release.id!)).resolves.toBeDefined()
    await expect(db.productReleases.get(created.secondRelease.id!)).resolves.toBeDefined()
  }, 30_000)

  it.sequential('显式 Build Preview 进入有非正式标识，退出后不会混入正式存档列表', async () => {
    const created = await previewFixture()

    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(TextOpenWorldPlayer, {
        project: created.project,
        scope: created.scope,
        worldGroupId: null,
        initialSessionId: created.build.session.id,
      })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-vnext-runtime"]')).toBeTruthy())
    expect(host.querySelector('[data-testid="text-open-world-runtime-source"]')?.textContent)
      .toContain('BUILD PREVIEW · 非正式发布')
    expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({
      selectedSessionId: created.build.session.id,
      selectedSessionSource: 'build-preview',
    })
    expect(new Set(useTextOpenWorldPlayerStore.getState().sessions.map(item => item.id)))
      .toEqual(new Set([created.formalSession.id, created.build.session.id]))

    await click(button(host, '退出游戏'))
    await waitFor(() => expect(host.textContent).toContain('文字开放世界游戏库'))
    expect(host.textContent).toContain('正式存档时间线')
    expect(host.textContent).not.toContain('制作预览时间线')
  }, 30_000)
})
