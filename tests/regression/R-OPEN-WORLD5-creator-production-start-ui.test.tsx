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
  listReviewArtifacts: vi.fn(async () => []),
  listWorkspace: vi.fn(),
  previewCreatorStart: vi.fn(),
  readDetails: vi.fn(),
  readProgress: vi.fn(),
  recoverImportedProofs: vi.fn(),
  retryBlocker: vi.fn(),
  runAuthorized: vi.fn(),
  sourceAdmission: vi.fn(),
  readEvidence: vi.fn(),
}))

vi.mock('../../src/lib/open-world/source-admission', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/open-world/source-admission')>()
  return { ...actual, readTextOpenWorldProductionSourceKindV1: serviceMocks.sourceAdmission }
})

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
    listProductProductionReviewArtifactsV1: serviceMocks.listReviewArtifacts,
    listProductProductionWorkspaceV1: serviceMocks.listWorkspace,
    previewTextOpenWorldCreatorProductionStartV1: serviceMocks.previewCreatorStart,
    readProductProductionDetailsV1: serviceMocks.readDetails,
    readProductProductionProgressV1: serviceMocks.readProgress,
    recoverImportedProductProductionProofsV1: serviceMocks.recoverImportedProofs,
    retryProductProductionBlockerV1: serviceMocks.retryBlocker,
    runAuthorizedProductProductionV1: serviceMocks.runAuthorized,
    readProductProductionTaskEvidenceV1: serviceMocks.readEvidence,
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

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

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

const importedProgress = {
  ...recoveryProgress,
  buildStatus: 'release-ready',
  terminal: false,
  tasks: recoveryProgress.tasks.map(task => ({
    ...task,
    status: 'stale',
    blocker: null,
    staleReason: 'project-import-scope-rebound',
  })),
} as unknown as ProductProductionProgressV1

const recoveredImportedProgress = {
  ...importedProgress,
  terminal: true,
  tasks: importedProgress.tasks.map(task => ({
    ...task,
    status: 'completed',
    staleReason: null,
  })),
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
    serviceMocks.recoverImportedProofs.mockResolvedValue(recoveredImportedProgress)
    serviceMocks.retryBlocker.mockResolvedValue(null)
    serviceMocks.runAuthorized.mockResolvedValue(recoveryProgress)
    serviceMocks.sourceAdmission.mockResolvedValue('world-release')
    serviceMocks.readEvidence.mockResolvedValue([{ type: 'model.responded', raw: 'historical-paid-output-kept' }])
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('005 冷刷新必须先核真实来源，历史 novel 既不自动续跑也不隐藏费用与原回答证据', async () => {
    let resolve!: (kind: 'novel') => void
    serviceMocks.sourceAdmission.mockReturnValue(new Promise<'novel'>(done => { resolve = done }))
    serviceMocks.readDetails.mockResolvedValue({ ...lockedDetails, build: { ...lockedDetails.build, status: 'building' } })
    serviceMocks.readProgress.mockResolvedValue({ ...recoveryProgress, tasks: recoveryProgress.tasks.map(task => ({ ...task, runId: 301 })) })
    await act(async () => root.render(createElement(ProductProductionStudio, {
      scope: SCOPE, allowedProducts: ['text-open-world'], initialProductionId: 91, productionOnly: true,
    })))
    await waitFor(() => expect(host.querySelector('h1')?.textContent).toContain(lockedProduction.title))
    expect(serviceMocks.runAuthorized).not.toHaveBeenCalled()
    expect(host.textContent).toContain('正在核验当前制作')
    await act(async () => resolve('novel'))
    await waitFor(() => expect(host.textContent).toContain('历史来源只读核验'))
    expect(serviceMocks.runAuthorized).not.toHaveBeenCalled()
    expect(button(host, '继续自动制作').disabled).toBe(true)
    expect(host.textContent).toContain('0.20')
    await act(async () => button(host, '查看冻结证据').click())
    await waitFor(() => expect(host.textContent).toContain('historical-paid-output-kept'))
    expect(serviceMocks.readEvidence).toHaveBeenCalledWith({ scope: SCOPE, productionId: 91, taskKey: 'p2.experience-design' })
  })

  it('005 同一冷刷新在 World 来源完成核验后保留自动续跑', async () => {
    let resolve!: (kind: 'world-release') => void
    serviceMocks.sourceAdmission.mockReturnValue(new Promise<'world-release'>(done => { resolve = done }))
    serviceMocks.readDetails.mockResolvedValueOnce({ ...lockedDetails, build: { ...lockedDetails.build, status: 'building' } })
      .mockResolvedValue(lockedDetails)
    await act(async () => root.render(createElement(ProductProductionStudio, {
      scope: SCOPE, allowedProducts: ['text-open-world'], initialProductionId: 91, productionOnly: true,
    })))
    await waitFor(() => expect(host.querySelector('h1')?.textContent).toContain(lockedProduction.title))
    expect(serviceMocks.runAuthorized).not.toHaveBeenCalled()
    expect(serviceMocks.sourceAdmission).toHaveBeenCalledTimes(1)
    await act(async () => resolve('world-release'))
    await waitFor(() => expect(serviceMocks.runAuthorized).toHaveBeenCalledTimes(1))
    expect(serviceMocks.runAuthorized.mock.calls[0][0]).toMatchObject({ scope: SCOPE, productionId: 91 })
  })

  it('005 来源核验失败保持关闭，不以 nullable locator 或旧状态解锁自动执行', async () => {
    serviceMocks.sourceAdmission.mockRejectedValue(new Error('frozen source hash damaged'))
    serviceMocks.readDetails.mockResolvedValue({ ...lockedDetails, build: { ...lockedDetails.build, status: 'building' } })
    await act(async () => root.render(createElement(ProductProductionStudio, {
      scope: SCOPE, allowedProducts: ['text-open-world'], initialProductionId: 91, productionOnly: true,
    })))
    await waitFor(() => expect(host.querySelector('h1')?.textContent).toContain(lockedProduction.title))
    expect(serviceMocks.runAuthorized).not.toHaveBeenCalled()
    await waitFor(() => expect(host.textContent).toContain('frozen source hash damaged'))
    expect(button(host, '继续自动制作').disabled).toBe(true)
  })

  it('005 旧 scope 的晚到 World 结果不能解锁另一 scope 的 novel 制作', async () => {
    const otherScope = { projectId: 51, worldId: 52, workId: 53 }
    const otherProduction = { ...lockedProduction, ...otherScope, id: 191, title: '当前小说来源' }
    let resolveOld!: (kind: 'world-release') => void
    let resolveCurrent!: (kind: 'novel') => void
    const old = new Promise<'world-release'>(done => { resolveOld = done })
    const current = new Promise<'novel'>(done => { resolveCurrent = done })
    serviceMocks.sourceAdmission.mockImplementation(({ productionId }) => productionId === 91 ? old : current)
    serviceMocks.listWorkspace.mockImplementation(async scope => ({ worldReleases: [], productions: scope.projectId === SCOPE.projectId ? [lockedProduction] : [otherProduction] }))
    serviceMocks.readDetails.mockImplementation(async (_scope, id) => ({ ...lockedDetails,
      production: id === 91 ? lockedProduction : otherProduction,
      build: { ...lockedDetails.build, status: 'building' } }))
    await act(async () => root.render(createElement(ProductProductionStudio, {
      scope: SCOPE, allowedProducts: ['text-open-world'], initialProductionId: 91, productionOnly: true,
    })))
    await waitFor(() => expect(host.querySelector('h1')?.textContent).toContain(lockedProduction.title))
    expect(serviceMocks.sourceAdmission).toHaveBeenCalledWith({ scope: SCOPE, productionId: 91 })
    await act(async () => root.render(createElement(ProductProductionStudio, {
      scope: otherScope, allowedProducts: ['text-open-world'], initialProductionId: 191, productionOnly: true,
    })))
    await waitFor(() => expect(serviceMocks.sourceAdmission).toHaveBeenCalledWith({ scope: otherScope, productionId: 191 }))
    await act(async () => resolveOld('world-release'))
    expect(serviceMocks.runAuthorized).not.toHaveBeenCalled()
    await act(async () => resolveCurrent('novel'))
    await waitFor(() => expect(host.textContent).toContain('历史来源只读核验'))
    expect(host.querySelector('h1')?.textContent).toContain(otherProduction.title)
    expect(serviceMocks.runAuthorized).not.toHaveBeenCalled()
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

  it('取消的 Creator Build 可回到简报修订，按钮不派发制作', async () => {
    const revise = vi.fn(async () => undefined)
    serviceMocks.readDetails.mockResolvedValue({
      ...lockedDetails,
      production: { ...lockedProduction, status: 'stopped', creatorSourceBindingHash: 'a'.repeat(64) },
      build: { ...lockedDetails.build, productionId: lockedProduction.id, status: 'cancelled', releasedProductReleaseId: null },
    })
    await act(async () => root.render(createElement(ProductProductionStudio, {
      scope: SCOPE, allowedProducts: ['text-open-world'], initialProductionId: 91,
      productionOnly: true, onReviseCreatorBrief: revise,
    })))
    await waitFor(() => expect(host.textContent).toContain('修订制作简报'))
    await act(async () => button(host, '修订制作简报').click())
    expect(revise).toHaveBeenCalledWith(91)
    expect(serviceMocks.runAuthorized).not.toHaveBeenCalled()
    expect(host.textContent).toContain('旧 Build、原始模型产物和用量已保留')
  })

  it('Creator Build 开放检查、试玩和专属发布入口，但仍不展示尚未实现的版本演化', async () => {
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
      host.querySelector('[data-testid="text-open-world-creator-release-stage-notice"]'),
    ).toBeTruthy())
    expect(host.textContent).toContain('作者最终确认 → 不可变 Release')
    expect(host.textContent).toContain('试玩未发布 Build')
    expect(host.textContent).toContain('正式发布 ProductRelease')
    expect(host.textContent).not.toContain('继续演化下一版')
    expect(host.querySelector('[data-testid="text-open-world-creator-artifact-browser"]')).toBeTruthy()
  })

  it('导入的终态 Build 先显示零调用证明复验，完成前禁止试玩，复验后恢复本地工作台', async () => {
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
    serviceMocks.readProgress
      .mockResolvedValueOnce(importedProgress)
      .mockResolvedValue(recoveredImportedProgress)

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
      host.querySelector('[data-testid="product-production-import-proof-recovery"]'),
    ).toBeTruthy())
    expect(host.textContent).toContain('复验不会调用模型或媒资供应商')
    expect(button(host, '试玩未发布 Build').disabled).toBe(true)

    await act(async () => { button(host, '复验导入生产证明').click() })
    await waitFor(() => expect(serviceMocks.recoverImportedProofs).toHaveBeenCalledWith({
      scope: SCOPE,
      productionId: lockedProduction.id,
    }))
    await waitFor(() => expect(
      host.querySelector('[data-testid="product-production-import-proof-recovery"]'),
    ).toBeNull())
    expect(host.textContent).toContain('已在新本地作用域完成零调用复验')
    await waitFor(() => expect(button(host, '试玩未发布 Build').disabled).toBe(false))
  })

  it('未完成的导入 Build 先复验已签收证明，保留原修复入口而不冒充终态', async () => {
    serviceMocks.readProgress.mockResolvedValue({ ...recoveryProgress, importedProofRecoveryRequired: true })
    serviceMocks.recoverImportedProofs.mockResolvedValue({ ...recoveryProgress, importedProofRecoveryRequired: false })
    await act(async () => {
      root.render(createElement(ProductProductionStudio, {
        scope: SCOPE, allowedProducts: ['text-open-world'], initialProduct: 'text-open-world',
        initialProductionId: lockedProduction.id, productionOnly: true,
      }))
    })
    await waitFor(() => expect(host.querySelector('[data-testid="product-production-recover-import-proof"]')).toBeTruthy())
    expect(button(host, '修正后继续制作').disabled).toBe(true)
    serviceMocks.readProgress.mockResolvedValue({ ...recoveryProgress, importedProofRecoveryRequired: false })
    await act(async () => { button(host, '复验导入生产证明').click() })
    await waitFor(() => expect(host.textContent).toContain('原阻塞、待执行任务和用量保留'))
    expect(button(host, '修正后继续制作').disabled).toBe(false)
    expect(serviceMocks.runAuthorized).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('试玩未发布 Build')
  })

  it.each(['task-reservation', 'model-calls', 'unknown-detail'] as const)('Creator %s 预算耗尽时只允许提交非空作者稿，导入证明闸门仍有效', async budgetBoundary => {
    const exhaustedDetails = {
      ...lockedDetails,
      executionBrief: {
        qualityProfile: 'prototype', intent: { productType: 'text-open-world' },
        productionBudget: { maximumModelCalls: 1 },
        media: { imageCount: 0, requiredMediaKinds: [] },
      },
      build: {
        ...lockedDetails.build,
        failureJson: JSON.stringify({
          taskKey: 'p2.experience-design',
          code: 'task-budget-exceeded',
          detail: budgetBoundary === 'task-reservation'
            ? 'Build lifetime budget 不足:task=p2.experience-design,remainingModelCalls=0'
            : budgetBoundary === 'model-calls' ? '累计模型调用已达到上限' : '历史预算拒绝，明细格式未知',
        }),
      },
    } as unknown as ProductProductionDetailsV1
    const progress = {
      ...recoveryProgress,
      importedProofRecoveryRequired: true,
      budget: {
        ...recoveryProgress.budget,
        usage: { ...recoveryProgress.budget.usage, modelCalls: budgetBoundary === 'model-calls' ? 1 : 0 },
      },
    }
    serviceMocks.readDetails.mockResolvedValue(exhaustedDetails)
    serviceMocks.readProgress.mockResolvedValue(progress)
    await act(async () => root.render(createElement(ProductProductionStudio, {
      scope: SCOPE, allowedProducts: ['text-open-world'], initialProduct: 'text-open-world',
      initialProductionId: lockedProduction.id, productionOnly: true,
    })))
    await waitFor(() => expect(host.querySelector('textarea[aria-label="作者修订的完整任务 JSON"]')).toBeTruthy())
    const draftInput = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="作者修订的完整任务 JSON"]')!
    await changeValue(draftInput, '  ')
    expect(host.textContent).not.toContain('校验修订稿并继续')
    expect(host.textContent).not.toContain('修正后继续制作')
    // A budget code can forbid another paid request without proving that a
    // historical refusal qualifies for a new child Build.
    expect(host.querySelector('[aria-label="开放世界预算续建"]')).toBeNull()
    const draft = '{"schema":"complete-author-draft"}'
    await changeValue(draftInput, draft)
    expect(button(host, '校验修订稿并继续').disabled).toBe(true)
    serviceMocks.readProgress.mockResolvedValue({ ...progress, importedProofRecoveryRequired: false })
    await act(async () => button(host, '复验导入生产证明').click())
    await waitFor(() => expect(button(host, '校验修订稿并继续').disabled).toBe(false))
    await changeValue(draftInput, '')
    expect(host.textContent).not.toContain('校验修订稿并继续')
    await changeValue(draftInput, draft)
    await act(async () => button(host, '校验修订稿并继续').click())
    await waitFor(() => expect(serviceMocks.retryBlocker).toHaveBeenCalledWith(expect.objectContaining({
      authorDraftJson: draft, details: exhaustedDetails,
    })))
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
