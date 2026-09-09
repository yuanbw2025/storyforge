import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProductProductionStudio from '../../src/components/product/ProductProductionStudio'
import { db } from '../../src/lib/db/schema'
import { createTextOpenWorldProductionPlanV1 } from '../../src/lib/open-world/production-contract'
import {
  draftProductProductionBriefV3,
  suggestProductStartingPoints,
} from '../../src/lib/product-production/consultation'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import type { ProductProductionBriefV3, WorkspaceScope } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

const serviceMocks = vi.hoisted(() => ({
  retryBlocker: vi.fn(async () => undefined),
}))

vi.mock('../../src/lib/product-production/service', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/product-production/service')>()
  return {
    ...actual,
    retryProductProductionBlockerV1: serviceMocks.retryBlocker,
  }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const NOW = 1_789_100_000_000

interface RecoveryProductionFixtureV1 {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  brief: ProductProductionBriefV3
  briefHash: string
  buildNumber: number
  controlEpoch: number
  title: string
}

function button(host: ParentNode, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  if (!result) throw new Error(`找不到按钮:${label}`)
  return result
}

function ariaButton(host: ParentNode, label: string): HTMLButtonElement {
  const result = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!result) throw new Error(`找不到按钮:${label}`)
  return result
}

function textarea(host: ParentNode, label: string): HTMLTextAreaElement | null {
  return host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)
}

async function setTextareaValue(element: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function waitForEnabledButton(host: ParentNode, label: string): Promise<HTMLButtonElement> {
  let result!: HTMLButtonElement
  await waitFor(() => {
    result = button(host, label)
    expect(result.disabled).toBe(false)
  })
  return result
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const started = Date.now()
  let last: unknown
  while (Date.now() - started < 5_000) {
    try {
      await act(async () => { await assertion() })
      return
    } catch (cause) {
      last = cause
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

async function createRecoveryProduction(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  title: string
  taskKey: string
  sequence: number
}): Promise<RecoveryProductionFixtureV1> {
  const suggestions = await suggestProductStartingPoints({
    scope: input.scope,
    worldReleaseId: input.worldReleaseId,
  })
  const startingPoint = suggestions.suggestions.find(item => item.kind === 'character')
    ?? suggestions.suggestions[0]!
  const brief = parseProductProductionBriefV3(await draftProductProductionBriefV3({
    scope: input.scope,
    worldReleaseId: input.worldReleaseId,
    suggestionKey: startingPoint.suggestionKey,
    productType: 'text-open-world',
    scale: 'chapter',
    visualLevel: 'none',
    audioLevel: 'none',
    qualityProfile: 'prototype',
    playerRole: '扮演冻结世界中的调查者',
    openingSituation: '从港口危机开始调查并成长。',
    coreExperience: ['有边界的自由演绎', '长期任务成长'],
    requiredFacts: ['世界来源和主线目标必须保持'],
    forbiddenChanges: ['不得让主线核心目标永久失败'],
    contentBoundaries: ['不生成露骨内容'],
    tone: ['边地悬疑', '成长冒险'],
  }))
  const productionKey = `tow.recovery-ui.${input.sequence}.${crypto.randomUUID()}`
  const created = await executeProductProductionCommand({
    scope: input.scope,
    now: NOW + input.sequence * 10,
    command: {
      type: 'create-intent',
      commandId: `${productionKey}.intent`,
      productionKey,
      productType: 'text-open-world',
      worldReleaseId: input.worldReleaseId,
      userText: input.title,
    },
  })
  const saved = await executeProductProductionCommand({
    scope: input.scope,
    productionId: created.productionId,
    now: NOW + input.sequence * 10 + 1,
    command: {
      type: 'save-brief-revision',
      commandId: `${productionKey}.brief`,
      expectedStateRevision: 0,
      parentRevision: null,
      brief,
    },
  })
  await executeProductProductionCommand({
    scope: input.scope,
    productionId: created.productionId,
    now: NOW + input.sequence * 10 + 2,
    command: {
      type: 'authorize-start',
      commandId: `${productionKey}.start`,
      expectedStateRevision: 1,
      briefRevision: 1,
      briefHash: saved.result.briefHash as string,
      authorizationNonce: `${productionKey}.author-click`,
    },
  })
  const [production, build, briefRow] = await Promise.all([
    db.productProductions.get(created.productionId),
    db.productBuilds.where('[productionId+buildNumber]').equals([created.productionId, 1]).first(),
    db.productProductionBriefs.where('[productionId+revision]').equals([created.productionId, 1]).first(),
  ])
  if (!production || !build || !briefRow) throw new Error('恢复 UI 测试 Production 创建失败')
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber: build.buildNumber,
    controlEpoch: build.controlEpoch,
    briefHash: briefRow.briefHash,
    brief,
  })
  const planHash = await hashProductProductionValueV2(plan)
  await db.transaction('rw', db.productProductions, db.productBuilds, async () => {
    await db.productProductions.update(production.id!, { title: input.title })
    await db.productBuilds.update(build.id!, {
      status: 'recovery-required',
      planRevision: 1,
      planJson: JSON.stringify(plan),
      planHash,
      failureJson: JSON.stringify({
        taskKey: input.taskKey,
        code: 'task-draft-rejected',
        detail: `${input.taskKey} 测试失败`,
      }),
    })
  })
  return {
    scope: input.scope,
    productionId: production.id!,
    buildId: build.id!,
    brief,
    briefHash: briefRow.briefHash,
    buildNumber: build.buildNumber,
    controlEpoch: build.controlEpoch,
    title: input.title,
  }
}

async function setRecoveryTask(fixture: RecoveryProductionFixtureV1, taskKey: string): Promise<void> {
  await db.productBuilds.update(fixture.buildId, {
    failureJson: JSON.stringify({
      taskKey,
      code: 'task-draft-rejected',
      detail: `${taskKey} 测试失败`,
    }),
  })
}

async function bumpControlEpoch(fixture: RecoveryProductionFixtureV1): Promise<void> {
  const nextEpoch = fixture.controlEpoch + 1
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber: fixture.buildNumber,
    controlEpoch: nextEpoch,
    briefHash: fixture.briefHash,
    brief: fixture.brief,
  })
  await db.transaction('rw', db.productProductions, db.productBuilds, async () => {
    await db.productProductions.update(fixture.productionId, { controlEpoch: nextEpoch })
    await db.productBuilds.update(fixture.buildId, {
      controlEpoch: nextEpoch,
      planJson: JSON.stringify(plan),
      planHash: await hashProductProductionValueV2(plan),
    })
  })
  fixture.controlEpoch = nextEpoch
}

describe('PRODUCT-PROD-1E · recovery policy UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    serviceMocks.retryBlocker.mockClear()
    localStorage.clear()
    await db.delete()
    await db.open()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  afterAll(() => db.close())

  it('P1和V2只允许原输入重试，P2才显示并提交修复要求与作者JSON', async () => {
    const owned = await seedCurrentProductWorld('恢复策略 UI')
    const fixture = await createRecoveryProduction({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
      title: '恢复策略产品',
      taskKey: 'p1.source-curation',
      sequence: 1,
    })
    await act(async () => {
      root.render(createElement(ProductProductionStudio, {
        scope: owned.scope,
        worldGroupId: owned.world.worldGroupId,
        initialProduct: 'text-open-world',
        allowedProducts: ['text-open-world'],
      }))
    })

    await waitFor(() => expect(host.querySelector('[data-testid="product-production-retry-only"]')).toBeTruthy())
    expect(textarea(host, '本次修复要求')).toBeNull()
    expect(textarea(host, '作者修订的完整任务 JSON')).toBeNull()
    const initialRetry = await waitForEnabledButton(host, '重试失败任务')
    await act(async () => { initialRetry.click() })
    await waitFor(() => expect(serviceMocks.retryBlocker).toHaveBeenCalledTimes(1))
    expect(serviceMocks.retryBlocker.mock.calls[0]![0]).not.toHaveProperty('repairNote')
    expect(serviceMocks.retryBlocker.mock.calls[0]![0]).not.toHaveProperty('authorDraftJson')

    await setRecoveryTask(fixture, 'v2.semantic-review')
    await act(async () => { ariaButton(host, '刷新当前 Production').click() })
    await waitFor(() => expect(host.textContent).toContain('v2.semantic-review'))
    expect(textarea(host, '本次修复要求')).toBeNull()
    expect(textarea(host, '作者修订的完整任务 JSON')).toBeNull()
    await waitForEnabledButton(host, '重试失败任务')
    serviceMocks.retryBlocker.mockClear()
    await act(async () => { button(host, '重试失败任务').click() })
    await waitFor(() => expect(serviceMocks.retryBlocker).toHaveBeenCalledTimes(1))
    expect(serviceMocks.retryBlocker.mock.calls[0]![0]).not.toHaveProperty('repairNote')
    expect(serviceMocks.retryBlocker.mock.calls[0]![0]).not.toHaveProperty('authorDraftJson')

    await setRecoveryTask(fixture, 'p2.experience-design')
    await act(async () => { ariaButton(host, '刷新当前 Production').click() })
    await waitFor(() => {
      expect(textarea(host, '本次修复要求')).toBeTruthy()
      expect(textarea(host, '作者修订的完整任务 JSON')).toBeTruthy()
    })
    await setTextareaValue(textarea(host, '本次修复要求')!, '保留冻结事实并修正节奏')
    await setTextareaValue(textarea(host, '作者修订的完整任务 JSON')!, '{"schema":"author-draft"}')
    await waitForEnabledButton(host, '修正后继续制作')
    serviceMocks.retryBlocker.mockClear()
    await act(async () => { button(host, '修正后继续制作').click() })
    await waitFor(() => expect(serviceMocks.retryBlocker).toHaveBeenCalledTimes(1))
    expect(serviceMocks.retryBlocker.mock.calls[0]![0]).toMatchObject({
      repairNote: '保留冻结事实并修正节奏',
      authorDraftJson: '{"schema":"author-draft"}',
    })
  }, 20_000)

  it('切换Production或当前Build controlEpoch时清空尚未提交的本地修复输入', async () => {
    const owned = await seedCurrentProductWorld('恢复输入隔离 UI')
    const first = await createRecoveryProduction({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
      title: '恢复产品甲',
      taskKey: 'p2.experience-design',
      sequence: 1,
    })
    await createRecoveryProduction({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
      title: '恢复产品乙',
      taskKey: 'p2.experience-design',
      sequence: 2,
    })
    await act(async () => {
      root.render(createElement(ProductProductionStudio, {
        scope: owned.scope,
        worldGroupId: owned.world.worldGroupId,
        initialProduct: 'text-open-world',
        allowedProducts: ['text-open-world'],
      }))
    })
    await waitFor(() => expect(button(host, first.title)).toBeTruthy())
    await act(async () => { button(host, first.title).click() })
    await waitFor(() => {
      expect(host.querySelector('h1')?.textContent).toContain(first.title)
      expect(textarea(host, '本次修复要求')).toBeTruthy()
    })
    await setTextareaValue(textarea(host, '本次修复要求')!, '只属于甲的说明')
    await setTextareaValue(textarea(host, '作者修订的完整任务 JSON')!, '{"owner":"甲"}')

    await act(async () => { button(host, '恢复产品乙').click() })
    await waitFor(() => {
      expect(host.querySelector('h1')?.textContent ?? host.textContent).toContain('恢复产品乙')
      expect(textarea(host, '本次修复要求')?.value).toBe('')
      expect(textarea(host, '作者修订的完整任务 JSON')?.value).toBe('')
    })
    await setTextareaValue(textarea(host, '本次修复要求')!, '乙在旧epoch填写的说明')
    await setTextareaValue(textarea(host, '作者修订的完整任务 JSON')!, '{"epoch":"old"}')

    await act(async () => { button(host, first.title).click() })
    await waitFor(() => {
      expect(host.querySelector('h1')?.textContent).toContain(first.title)
      expect(textarea(host, '本次修复要求')?.value).toBe('')
    })
    await setTextareaValue(textarea(host, '本次修复要求')!, '甲在旧epoch填写的说明')
    await setTextareaValue(textarea(host, '作者修订的完整任务 JSON')!, '{"epoch":"old"}')
    await bumpControlEpoch(first)
    await act(async () => { ariaButton(host, '刷新当前 Production').click() })
    await waitFor(() => {
      expect(textarea(host, '本次修复要求')?.value).toBe('')
      expect(textarea(host, '作者修订的完整任务 JSON')?.value).toBe('')
    })
  }, 25_000)
})
