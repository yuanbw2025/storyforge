import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProductProductionStudio from '../../src/components/product/ProductProductionStudio'
import { TextOpenWorldCreatorProductionStart } from '../../src/components/text-game/TextOpenWorldCreatorProductionStart'
import type { TextOpenWorldCreatorBriefSessionV1 } from '../../src/lib/open-world/creator-brief'
import type { TextOpenWorldCreatorStartPreparationV1 } from '../../src/lib/open-world/creator-production-start'
import type {
  ProductProductionDetailsV1,
  ProductProductionProgressV1,
} from '../../src/lib/product-production/service'
import type {
  ProductProductionRecordV1,
  TextOpenWorldCreatorProductionPreflightConfirmationV1,
  TextOpenWorldCreatorProductionPreflightV1,
} from '../../src/lib/types'

const serviceMocks = vi.hoisted(() => ({
  authorizeCreatorStart: vi.fn(),
  inspectCapabilityReadiness: vi.fn(() => ({
    text: { ready: true, provider: 'deepseek', model: 'deepseek-v4-flash', issue: null },
    image: { ready: false, model: null, issue: '未配置' },
    mediaRelayConfigured: false,
    mediaRelayReady: false,
    mediaRelayOrigin: null,
    mediaRelayIssue: null,
  })),
  listWorkspace: vi.fn(),
  previewCreatorStart: vi.fn(),
  readDetails: vi.fn(),
  readProgress: vi.fn(),
  runAuthorized: vi.fn(),
}))

vi.mock('../../src/lib/open-world/creator-brief-persistence', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/open-world/creator-brief-persistence')>()
  return {
    ...actual,
    createTextOpenWorldCreatorSourceLocatorV1: vi.fn(() => ({
      kind: 'world-release',
      localReleaseRecordId: 71,
      releaseUid: 'world-release-ui-test',
      expectedReleaseHash: 'release-hash-ui-test',
    })),
  }
})

vi.mock('../../src/lib/product-production/service', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/product-production/service')>()
  return {
    ...actual,
    authorizeTextOpenWorldCreatorProductionStartV1: serviceMocks.authorizeCreatorStart,
    inspectProductProductionCapabilityReadinessV1: serviceMocks.inspectCapabilityReadiness,
    listProductProductionWorkspaceV1: serviceMocks.listWorkspace,
    previewTextOpenWorldCreatorProductionStartV1: serviceMocks.previewCreatorStart,
    readProductProductionDetailsV1: serviceMocks.readDetails,
    readProductProductionProgressV1: serviceMocks.readProgress,
    runAuthorizedProductProductionV1: serviceMocks.runAuthorized,
  }
})

vi.mock('../../src/lib/product-production/quality-receipts', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/product-production/quality-receipts')>()
  return {
    ...actual,
    listCompletedProductBuildPlaythroughsV1: vi.fn(async () => []),
    readLatestProductBrowserPerformanceGateV1: vi.fn(async () => null),
    readLatestProductBuildMainRouteGateV1: vi.fn(async () => null),
    readLatestProductMediaRuntimeGateV1: vi.fn(async () => null),
  }
})

vi.mock('../../src/lib/product-production/recovery-policy', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/product-production/recovery-policy')>()
  return {
    ...actual,
    inspectProductProductionBuildRecoveryPolicyV1: vi.fn(() => ({
      taskKey: 'p2.experience-design',
      retryAllowed: true,
      repairNoteAllowed: true,
      authorDraftAllowed: true,
      repairFeedbackContextAllowed: true,
      reason: 'author-repair-supported',
    })),
  }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SCOPE = { projectId: 41, worldId: 42, workId: 43 }
const CREATOR_BRIEF_HASH = 'brief-hash-0123456789abcdef'
const SOURCE_PLAN_HASH = 'source-plan-hash-0123456789abcdef'
const PRODUCTION_PLAN_HASH = 'production-plan-hash-0123456789abcdef'

const preflight = {
  providerBinding: { provider: 'deepseek', model: 'deepseek-v4-flash' },
} as TextOpenWorldCreatorProductionPreflightV1

const confirmation = {
  confirmationHash: 'confirmation-hash-0123456789abcdef',
} as TextOpenWorldCreatorProductionPreflightConfirmationV1

const creatorSession = {
  scope: SCOPE,
  production: { id: 42, stateRevision: 7 },
  selection: { sourceKind: 'world-release' },
  confirmedBrief: {
    revision: 3,
    briefHash: CREATOR_BRIEF_HASH,
    sourceBinding: { kind: 'world-release' },
  },
} as unknown as TextOpenWorldCreatorBriefSessionV1

const preparation = {
  buildNumber: 2,
  sourcePlan: { planHash: SOURCE_PLAN_HASH },
  start: { productionPlanHash: PRODUCTION_PLAN_HASH },
  plan: {
    tasks: [
      {
        taskKey: 'p0.source-pin',
        lane: 'source',
        executionMode: 'deterministic',
        dependsOn: [],
        concurrencyGroup: 'source-pin',
        maxAttempts: 1,
        timeoutMs: 20_000,
        acceptanceGateIds: ['source-pin-valid'],
        budgetReservation: {
          modelCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          mediaCalls: 0,
          durationMs: 20_000,
          storageBytes: 1_000_000,
          maximumCostUsd: 0,
        },
      },
      {
        taskKey: 'p2.experience-design',
        lane: 'content',
        executionMode: 'model',
        dependsOn: ['p0.source-pin'],
        concurrencyGroup: 'narrative-design',
        maxAttempts: 2,
        timeoutMs: 80_000,
        acceptanceGateIds: ['experience-valid'],
        budgetReservation: {
          modelCalls: 3,
          inputTokens: 12_000,
          outputTokens: 4_000,
          mediaCalls: 0,
          durationMs: 80_000,
          storageBytes: 2_000_000,
          maximumCostUsd: 1.25,
        },
      },
    ],
  },
} as unknown as TextOpenWorldCreatorStartPreparationV1

function button(host: ParentNode, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  if (!result) throw new Error(`找不到按钮:${label}`)
  return result
}

async function changeValue(element: HTMLSelectElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const prototype = element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
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

function productionRecord(id: number, title: string): ProductProductionRecordV1 {
  return {
    id,
    projectId: SCOPE.projectId,
    worldId: SCOPE.worldId,
    workId: SCOPE.workId,
    productionKey: `text-open-world.ui.${id}`,
    productType: 'text-open-world',
    title,
    status: 'producing',
    stateRevision: 9,
    controlEpoch: 4,
    currentBriefRevision: 1,
    currentBuildNumber: 1,
    currentProductReleaseId: null,
  } as ProductProductionRecordV1
}

const lockedProduction = productionRecord(91, '锁定的 Creator Production')
const unrelatedProduction = productionRecord(92, '不应显示的最近 Production')

const lockedDetails = {
  production: lockedProduction,
  brief: {
    id: 101,
    revision: 1,
    status: 'authorized',
    briefKind: 'text-open-world-creator-v1',
    briefJson: '{}',
  },
  executionBrief: null,
  build: {
    id: 201,
    buildNumber: 1,
    status: 'recovery-required',
    briefHash: CREATOR_BRIEF_HASH,
    planHash: PRODUCTION_PLAN_HASH,
    packageHash: '',
    manifestHash: '',
    previewHash: '',
    qualityReportHash: '',
    planJson: '{}',
    failureJson: JSON.stringify({
      taskKey: 'p2.experience-design',
      detail: '供应商结果未知，已停机等待作者处理',
    }),
  },
  artifactCount: 6,
  recentCommands: [],
  briefHistory: [],
  buildHistory: [],
} as unknown as ProductProductionDetailsV1

const recoveryProgress = {
  productionId: lockedProduction.id,
  buildId: 201,
  buildNumber: 1,
  controlEpoch: 4,
  planHash: PRODUCTION_PLAN_HASH,
  budget: {
    usage: { modelCalls: 1, mediaCalls: 0, costUsd: 0.2, storageBytes: 512 },
    limits: { maximumModelCalls: 160, maximumMediaCalls: 0, maximumCostUsd: 30, maximumStorageBytes: 200_000_000 },
  },
  tasks: [{
    taskKey: 'p2.experience-design',
    lane: 'content',
    concurrencyGroup: 'narrative-design',
    status: 'blocked',
    attempt: 2,
    maxAttempts: 2,
    dependsOn: ['p1.source-curation'],
    timeoutMs: 80_000,
    blocker: 'provider-result-unknown',
    staleReason: null,
    latestDurableBoundary: { eventType: 'step.checkpointed', sequence: 12 },
    checkpoint: { status: 'saved', resumeKind: 'author-retry' },
    steps: [],
    runId: null,
  }],
} as unknown as ProductProductionProgressV1

describe('TOW-G5-04 · production start UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.clearAllMocks()
    serviceMocks.authorizeCreatorStart.mockResolvedValue({ ok: true })
    serviceMocks.previewCreatorStart.mockResolvedValue(preparation)
    serviceMocks.listWorkspace.mockResolvedValue({
      worldReleases: [],
      productions: [unrelatedProduction, lockedProduction],
    })
    serviceMocks.readDetails.mockResolvedValue(lockedDetails)
    serviceMocks.readProgress.mockResolvedValue(recoveryProgress)
    serviceMocks.runAuthorized.mockResolvedValue(recoveryProgress)
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('要求完整权利声明，零写预览展示DAG、依赖、预算、模型和唯一哈希，再调用专用授权服务', async () => {
    const onStarted = vi.fn()
    await act(async () => {
      root.render(createElement(TextOpenWorldCreatorProductionStart, {
        session: creatorSession,
        preflight,
        confirmation,
        onBack: vi.fn(),
        onStarted,
      }))
    })

    const rightsBasis = host.querySelector('select')
    const rightsNote = host.querySelector('textarea')
    expect(rightsBasis).toBeTruthy()
    expect(rightsNote).toBeTruthy()
    expect(button(host, '生成并检查冻结计划').disabled).toBe(true)

    await changeValue(rightsBasis!, 'author-owned')
    expect(button(host, '生成并检查冻结计划').disabled).toBe(false)
    await changeValue(rightsNote!, '   ')
    expect(button(host, '生成并检查冻结计划').disabled).toBe(true)
    await changeValue(rightsNote!, '作者确认拥有来源内容的派生制作权。')
    expect(button(host, '生成并检查冻结计划').disabled).toBe(false)

    await act(async () => { button(host, '生成并检查冻结计划').click() })
    await waitFor(() => expect(serviceMocks.previewCreatorStart).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-creator-plan-preview"]')).toBeTruthy())

    expect(serviceMocks.previewCreatorStart).toHaveBeenCalledWith(expect.objectContaining({
      productionId: 42,
      expectedStateRevision: 7,
      rightsBasis: 'author-owned',
      rightsNote: '作者确认拥有来源内容的派生制作权。',
    }))
    expect(host.textContent).toContain('deepseek · deepseek-v4-flash')
    expect(host.textContent).toContain('p0.source-pin')
    expect(host.textContent).toContain('p2.experience-design')
    expect(host.textContent).toContain('依赖：p0.source-pin')
    expect(host.textContent).toContain('3 次模型 / 12,000 入 / 4,000 出 / $1.25')
    const hashLabels = [...host.querySelectorAll('[data-testid="text-open-world-creator-plan-preview"] dt')]
      .map(item => item.textContent)
    expect(hashLabels).toEqual(['Creator Brief', 'SourcePlan', 'Production Plan'])
    expect(host.querySelector(`[title="${CREATOR_BRIEF_HASH}"]`)).toBeTruthy()
    expect(host.querySelector(`[title="${SOURCE_PLAN_HASH}"]`)).toBeTruthy()
    expect(host.querySelector(`[title="${PRODUCTION_PLAN_HASH}"]`)).toBeTruthy()

    await act(async () => { button(host, '再次复验并创建 Build').click() })
    await waitFor(() => expect(serviceMocks.authorizeCreatorStart).toHaveBeenCalledTimes(1))
    expect(serviceMocks.authorizeCreatorStart).toHaveBeenCalledWith(expect.objectContaining({
      productionId: 42,
      rightsBasis: 'author-owned',
      rightsNote: '作者确认拥有来源内容的派生制作权。',
      expectedPlanHash: PRODUCTION_PLAN_HASH,
    }))
    expect(onStarted).toHaveBeenCalledWith(42)
  })

  it('productionOnly锁定initialProductionId，隐藏新建入口并显示增强任务恢复边界', async () => {
    await act(async () => {
      root.render(createElement(ProductProductionStudio, {
        scope: SCOPE,
        allowedProducts: ['text-open-world'],
        initialProduct: 'text-open-world',
        initialProductionId: lockedProduction.id,
        productionOnly: true,
      }))
    })

    await waitFor(() => expect(host.querySelector('h1')?.textContent).toContain(lockedProduction.title))
    expect(serviceMocks.readDetails).toHaveBeenCalledWith(
      SCOPE,
      lockedProduction.id,
      ['text-open-world'],
    )
    expect(serviceMocks.readDetails).not.toHaveBeenCalledWith(
      SCOPE,
      unrelatedProduction.id,
      expect.anything(),
    )
    expect(host.textContent).not.toContain('新建 Production')
    expect(host.textContent).not.toContain(unrelatedProduction.title)
    expect(host.textContent).toContain('自动制作停在可恢复边界')
    expect(host.textContent).toContain('p2.experience-design · 供应商结果未知，已停机等待作者处理')
    expect(host.textContent).toContain('本次修复要求（可选）')
    expect(host.textContent).toContain('直接修订任务草稿（高级）')
    expect(host.textContent).toContain('阻塞：provider-result-unknown')
    expect(host.textContent).toContain('边界：step.checkpointed #12')
    expect(host.textContent).toContain('checkpoint：saved · author-retry')
  })

  it('Creator Build 仅开放检查与试玩，不展示尚未实现的发布或版本演化入口', async () => {
    serviceMocks.readDetails.mockResolvedValue({
      ...lockedDetails,
      production: {
        ...lockedProduction,
        status: 'preview-ready',
      },
      build: {
        ...lockedDetails.build,
        status: 'release-ready',
        failureJson: null,
      },
    } as unknown as ProductProductionDetailsV1)
    serviceMocks.readProgress.mockResolvedValue(null)

    await act(async () => {
      root.render(createElement(ProductProductionStudio, {
        scope: SCOPE,
        allowedProducts: ['text-open-world'],
        initialProduct: 'text-open-world',
        initialProductionId: lockedProduction.id,
        productionOnly: true,
      }))
    })

    await waitFor(() => expect(
      host.querySelector('[data-testid="text-open-world-creator-later-stage-notice"]'),
    ).toBeTruthy())
    expect(host.textContent).toContain('当前阶段可检查与试玩 Creator Build')
    expect(host.textContent).toContain('试玩未发布 Build')
    expect(host.textContent).not.toContain('复验并原子发布')
    expect(host.textContent).not.toContain('继续演化下一版')
    expect(host.querySelector('[data-testid="text-open-world-creator-artifact-browser"]')).toBeTruthy()
  })

  it('旧泛型文字开放世界不误挂 Creator Artifact 浏览器，原有发布与演化动作保持可见', async () => {
    serviceMocks.readDetails.mockResolvedValue({
      ...lockedDetails,
      production: {
        ...lockedProduction,
        status: 'preview-ready',
      },
      brief: {
        ...lockedDetails.brief,
        briefKind: 'product-production-v3',
      },
      build: {
        ...lockedDetails.build,
        status: 'release-ready',
        failureJson: null,
      },
    } as unknown as ProductProductionDetailsV1)
    serviceMocks.readProgress.mockResolvedValue(null)

    await act(async () => {
      root.render(createElement(ProductProductionStudio, {
        scope: SCOPE,
        allowedProducts: ['text-open-world'],
        initialProduct: 'text-open-world',
        initialProductionId: lockedProduction.id,
        productionOnly: true,
      }))
    })

    await waitFor(() => expect(host.querySelector('h1')?.textContent).toContain(lockedProduction.title))
    expect(host.querySelector('[data-testid="text-open-world-creator-artifact-browser"]')).toBeNull()
    expect(host.textContent).toContain('复验并原子发布')
    expect(host.textContent).toContain('继续演化下一版')
  })

  it('productionOnly目标不存在时失败关闭，不回退或自动续跑其他 Production', async () => {
    serviceMocks.listWorkspace.mockResolvedValue({
      worldReleases: [],
      productions: [unrelatedProduction],
    })

    await act(async () => {
      root.render(createElement(ProductProductionStudio, {
        scope: SCOPE,
        allowedProducts: ['text-open-world'],
        initialProduct: 'text-open-world',
        initialProductionId: lockedProduction.id,
        productionOnly: true,
      }))
    })

    await waitFor(() => expect(
      host.querySelector('[data-testid="product-production-locked-target-unavailable"]'),
    ).toBeTruthy())
    expect(host.textContent).toContain(`Production #${lockedProduction.id} 不存在`)
    expect(host.textContent).not.toContain(unrelatedProduction.title)
    expect(serviceMocks.readDetails).not.toHaveBeenCalled()
    expect(serviceMocks.readProgress).not.toHaveBeenCalled()
    expect(serviceMocks.runAuthorized).not.toHaveBeenCalled()
  })
})
