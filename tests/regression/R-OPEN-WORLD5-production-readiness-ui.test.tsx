import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldCreatorProductionReadiness from '../../src/components/text-game/TextOpenWorldCreatorProductionReadiness'
import { db } from '../../src/lib/db/schema'
import type { TextOpenWorldCreatorBriefSessionV1 } from '../../src/lib/open-world/creator-brief'
import type {
  TextOpenWorldCreatorBriefDraftV1,
  TextOpenWorldCreatorBriefV1,
  TextOpenWorldCreatorSourceSelectionV1,
  WorkspaceScope,
} from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SCOPE: WorkspaceScope = { projectId: 451, worldId: 452, workId: 453 }
const SOURCE_VERSION_HASH = 'a'.repeat(64)
const SOURCE_BOUNDARY_HASH = 'b'.repeat(64)
const CANDIDATE_HASH = 'd'.repeat(64)
const RUN_BINDING_HASH = 'e'.repeat(64)
const SECRET_KEY = 'sk-session-must-never-reach-the-dom'
const SECRET_USER = 'hidden-user'
const SECRET_PASSWORD = 'hidden-password'
const SECRET_QUERY = 'api_key=hidden-query-secret'

function sourceSelection(): TextOpenWorldCreatorSourceSelectionV1 {
  return {
    sourceKind: 'novel',
    sourceScope: SCOPE,
    selection: { mode: 'entire-work' },
    preview: {
      schema: 'storyforge.text-open-world-novel-source-snapshot-preview',
      version: 1,
      sourceKind: 'novel',
      workCode: 'work.river-lantern',
      workTitle: '河灯长夜',
      sourceUpdatedAt: 1_788_000_000_000,
      sourceVersionHash: SOURCE_VERSION_HASH,
      sourceBoundaryHash: SOURCE_BOUNDARY_HASH,
      coverage: 'full-text',
      selection: {
        mode: 'entire-work',
        label: '整部小说',
        selectedChapterCount: 8,
        selectedOutlineCount: 3,
      },
      outlines: [],
      chapters: [],
      storyCoreCount: 1,
      writtenChapterCount: 8,
      totalWordCount: 42_000,
      sourceUnitCount: 12,
      readiness: 'ready',
      gaps: [],
    },
  }
}

function briefDraft(): TextOpenWorldCreatorBriefDraftV1 {
  return {
    schema: 'storyforge.text-open-world-creator-brief-draft',
    version: 1,
    gameTitle: '河灯长夜开放世界',
    playerRole: '扮演巡灯人，追查河灯失踪事件。',
    playerFantasy: '在持续演化的河谷中成长、探索并完成长期主线。',
    protagonistMode: 'author-defined',
    protagonistDirective: '主角必须有进入开场并调查河灯事件的动机。',
    coreGoal: '沿主线查清河灯熄灭的原因，并决定河谷的结局。',
    primaryConflict: '守旧渡人与试图改变河流秩序的势力发生冲突。',
    openingSituation: '从旧渡口接到寻找第一盏失踪河灯的任务。',
    experiencePillars: ['长期主线成长', '地区故事', '随机冒险'],
    toneKeywords: ['沉浸', '民俗', '冒险'],
    mustKeep: ['河灯负责标记安全航道'],
    allowedInferences: ['允许补齐不违背来源的地区任务'],
    forbiddenChanges: ['不得改变主角与旧渡口的关系'],
    contentRating: '12+',
    contentBoundaries: ['不表现露骨伤害'],
    authorNotes: '',
    unresolvedQuestions: [],
    acceptedAssumptions: [],
    scale: {
      regions: 3,
      namedLocations: { minimum: 12, maximum: 18 },
      mainlineStages: { minimum: 8, maximum: 12 },
      endings: 2,
      significantStorylines: 4,
      ordinaryQuests: { minimum: 18, maximum: 28 },
      taskTemplates: { minimum: 8, maximum: 12 },
      randomEvents: { minimum: 16, maximum: 24 },
      requiredPlayMinutes: { minimum: 90, maximum: 120 },
      optionalInventoryMinutes: { minimum: 120, maximum: 180 },
    },
    media: {
      proceduralMap: 'required',
      characterPortraits: 'required',
      sceneBackgrounds: 'required',
      audio: 'none',
      artDirection: '低饱和水墨像素风',
    },
    completion: {
      playablePreviewRequired: true,
      deterministicGatesRequired: true,
      semanticReviewRequired: true,
      publishAfterGates: true,
      humanPlaytest: 'post-release',
      repairPolicy: 'new-release',
    },
  }
}

async function confirmedBrief(draft: TextOpenWorldCreatorBriefDraftV1): Promise<TextOpenWorldCreatorBriefV1> {
  const sourceBinding = {
    kind: 'novel' as const,
    workCode: 'work.river-lantern',
    sourceVersionHash: SOURCE_VERSION_HASH,
    sourceBoundaryHash: SOURCE_BOUNDARY_HASH,
    coverage: 'full-text' as const,
    selectionMode: 'entire-work' as const,
    selectedChapterCount: 8,
    selectedOutlineCount: 3,
  }
  const body: Omit<TextOpenWorldCreatorBriefV1, 'briefHash'> = {
    schema: 'storyforge.text-open-world-creator-brief',
    version: 1,
    productInstanceKey: 'text-open-world.primary.river-lantern',
    revision: 1,
    sourceBinding,
    sourceBindingHash: await hashCanonicalValue(sourceBinding),
    sourceSummary: {
      label: '河灯长夜 · 整部小说',
      sourceKind: 'novel',
      coverage: 'full-text',
      resourceCount: 12,
      rowOrWordCount: 42_000,
      capabilityAreas: ['story', 'characters'],
      gaps: [],
    },
    draft,
    productBoundary: {
      freedomModel: 'bounded-guided',
      mainlineStructure: 'strict-sequential-with-multiple-endings',
      mainlineWaitsForPlayer: true,
      significantStorylinesWaitAtSafePoints: true,
      ordinaryWorldContinues: true,
      criticalActorsProtected: true,
      criticalItemsProtected: true,
      freeTextPolicy: 'respond-then-redirect-or-reject',
      unsupportedSolutionPolicy: 'declared-actions-only',
      combatMode: 'turn-based-four-actions',
      difficulty: 'standard',
      locationOnlyCriticalTriggersForbidden: true,
    },
    confirmation: {
      sourceIdentityReviewed: true,
      productBoundaryReviewed: true,
      unresolvedItemsClosed: true,
      directPublishWorkflowReviewed: true,
    },
    candidateEvidence: {
      candidateHash: CANDIDATE_HASH,
      runBindingHash: RUN_BINDING_HASH,
      origin: 'ai',
      contextManifestHashes: ['1'.repeat(64)],
    },
    confirmedAt: 1_788_000_000_100,
  }
  return { ...body, briefHash: await hashCanonicalValue(body) }
}

async function session(): Promise<TextOpenWorldCreatorBriefSessionV1> {
  const now = 1_788_000_000_000
  const draft = briefDraft()
  const brief = await confirmedBrief(draft)
  return {
    scope: SCOPE,
    conversation: {
      id: 461,
      projectId: SCOPE.projectId,
      workId: SCOPE.workId,
      worldGroupId: null,
      purpose: 'text-open-world.creator-brief.v1:primary',
      title: '文字开放世界 Creator Brief',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    production: {
      id: 471,
      ...SCOPE,
      productionKey: brief.productInstanceKey,
      productType: 'text-open-world',
      title: draft.gameTitle,
      status: 'brief-ready',
      stateRevision: 1,
      controlEpoch: 0,
      currentBriefRevision: 1,
      currentBuildNumber: null,
      currentProductReleaseId: null,
      creatorSourceKind: 'novel',
      creatorSourceWorkId: SCOPE.workId,
      creatorSourceSelectionMode: 'entire-work',
      creatorSourceVersionHash: SOURCE_VERSION_HASH,
      creatorSourceBoundaryHash: SOURCE_BOUNDARY_HASH,
      creatorSourceBindingJson: '{}',
      creatorSourceBindingHash: brief.sourceBindingHash,
      lastErrorJson: '{}',
      createdAt: now,
      updatedAt: now,
    },
    productInstanceKey: brief.productInstanceKey,
    selection: sourceSelection(),
    sourceBinding: brief.sourceBinding,
    sourceBindingHash: brief.sourceBindingHash,
    sourceSummary: brief.sourceSummary,
    draft,
    candidate: {
      schema: 'storyforge.text-open-world-creator-brief-candidate',
      version: 1,
      origin: 'ai',
      runBindingHash: RUN_BINDING_HASH,
      sourceBindingHash: brief.sourceBindingHash,
      draftHash: '2'.repeat(64),
      contextManifestHashes: ['1'.repeat(64)],
      synthesis: {
        suggestedTitle: draft.gameTitle,
        understandingSummary: '围绕失踪河灯建立一个有边界自由演绎的文字开放世界。',
        playerFantasy: draft.playerFantasy,
        experiencePromise: '完成长期主线，并在地区故事中持续成长。',
        primaryConflict: draft.primaryConflict,
        recommendedOpening: draft.openingSituation,
        protagonistFit: '巡灯人天然适合调查河谷各地区。',
        experiencePillars: draft.experiencePillars,
        sourceUsePlan: ['保留河灯与航道设定', '从来源拆解主支线'],
        unresolvedQuestions: [],
        assumptions: [],
        risks: [],
      },
      modelCalls: [{
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        usageSource: 'provider',
        inputTokens: 12_345,
        outputTokens: 678,
        totalTokens: 13_023,
        latencyMs: 4_321,
        estimatedCostUsd: 0.0042,
      }],
      repairApplied: false,
      candidateHash: CANDIDATE_HASH,
    },
    candidateRunId: 481,
    confirmedBrief: brief,
    sourceIssue: null,
  }
}

function button(host: ParentNode, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(item => item.textContent?.includes(label))
  if (!found) throw new Error(`找不到按钮：${label}`)
  return found
}

function checkbox(host: ParentNode, label: string): HTMLInputElement {
  const found = [...host.querySelectorAll<HTMLLabelElement>('label')]
    .find(item => item.textContent?.includes(label))
    ?.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!found) throw new Error(`找不到确认项：${label}`)
  return found
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

async function productionCounts() {
  const [productions, briefs, builds, artifacts] = await Promise.all([
    db.productProductions.count(),
    db.productProductionBriefs.count(),
    db.productBuilds.count(),
    db.productBuildArtifacts.count(),
  ])
  return { productions, briefs, builds, artifacts }
}

describe('TOW-G5-03 · production readiness UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.resetAllMocks()
    sessionStorage.removeItem('storyforge-ai-preset-api-keys-session')
    useAIConfigStore.setState({
      config: {
        provider: 'deepseek',
        apiKey: SECRET_KEY,
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-flash',
        temperature: 0.7,
        maxTokens: 0,
      },
      rememberApiKey: false,
      presets: [],
      taskRoutes: {},
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    sessionStorage.removeItem('storyforge-ai-preset-api-keys-session')
    vi.restoreAllMocks()
  })

  it('展示安全模型绑定、完整生产上限和 Creator Brief 实际用量，四项确认只形成内存快照', async () => {
    const onConfirmed = vi.fn()
    const currentSession = await session()
    const before = await productionCounts()
    await act(async () => root.render(createElement(TextOpenWorldCreatorProductionReadiness, {
      session: currentSession,
      onBack: vi.fn(),
      onConfirmed,
    })))

    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-preflight-budget"]')).not.toBeNull())
    const rendered = host.textContent ?? ''
    expect(rendered).toContain('deepseek')
    expect(rendered).toContain('deepseek-v4-flash')
    expect(rendered).toContain('https://api.deepseek.com')
    expect(rendered).toContain('已配置 · 仅当前会话')
    expect(rendered).toContain('155 / 160')
    expect(rendered).toContain('1,200,000')
    expect(rendered).toContain('360,000')
    expect(rendered).toContain('$0.2688 / $30.00')
    expect(rendered).toContain('12,345 / 678')
    expect(rendered).toContain('4.3 秒')
    expect(rendered).toContain('$0.0042')
    expect(rendered).toContain('不是 Provider 实际账单')

    for (const secret of [
      SECRET_KEY,
      SECRET_USER,
      SECRET_PASSWORD,
      '/v1/chat/completions',
      SECRET_QUERY,
      'hidden-fragment',
    ]) expect(host.innerHTML).not.toContain(secret)

    for (const label of [
      '我理解 Key 只由全局凭证设置持有',
      '我确认当前提供商、模型、安全端点域名',
      '我已核对价格来源',
      '我理解本次金额只覆盖文本模型',
    ]) {
      await act(async () => checkbox(host, label).click())
    }

    const confirm = button(host, '确认当前模型与预算')
    expect(confirm.disabled).toBe(false)
    await act(async () => confirm.click())
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1))

    expect(onConfirmed.mock.calls[0]?.[0]).toMatchObject({
      schema: 'storyforge.text-open-world-creator-production-preflight-confirmation',
      version: 1,
      productInstanceKey: 'text-open-world.primary.river-lantern',
      briefHash: currentSession.confirmedBrief?.briefHash,
      acknowledgement: {
        credentialPolicyReviewed: true,
        providerAndModelReviewed: true,
        priceAndBudgetReviewed: true,
        mediaCostBoundaryReviewed: true,
      },
    })
    expect(JSON.stringify(onConfirmed.mock.calls[0]?.[0])).not.toContain(SECRET_KEY)
    expect(host.textContent).toContain('Build 仍为 0')
    await expect(productionCounts()).resolves.toEqual(before)
  })

  it('未知 provider/model 默认要求手工报价并以 blocker 关闭确认', async () => {
    useAIConfigStore.setState({
      config: {
        provider: 'nvidia',
        apiKey: SECRET_KEY,
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        model: 'unknown-model-without-catalog-price',
        temperature: 0.5,
        maxTokens: 8_000,
      },
      rememberApiKey: false,
    })
    const before = await productionCounts()
    const currentSession = await session()
    await act(async () => root.render(createElement(TextOpenWorldCreatorProductionReadiness, {
      session: currentSession,
      onBack: vi.fn(),
    })))

    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-manual-price-fields"]')).not.toBeNull())
    expect(host.querySelector<HTMLInputElement>('#tow-input-price')).not.toBeNull()
    expect(host.querySelector<HTMLInputElement>('#tow-output-price')).not.toBeNull()
    expect(host.querySelector<HTMLInputElement>('#tow-price-source')).not.toBeNull()
    expect(host.querySelector<HTMLInputElement>('#tow-price-date')).not.toBeNull()
    expect(host.querySelector('[data-testid="text-open-world-preflight-blockers"]')?.textContent)
      .toContain('请填写非负且不同时为零的输入、输出 token 单价')
    expect(button(host, '确认当前模型与预算').disabled).toBe(true)
    expect(host.textContent).toContain('https://integrate.api.nvidia.com')

    for (const secret of [SECRET_KEY, SECRET_USER, SECRET_PASSWORD, '/v1', SECRET_QUERY]) {
      expect(host.innerHTML).not.toContain(secret)
    }
    await expect(productionCounts()).resolves.toEqual(before)
  })

  it('与正式 product-production 调用共用任务路由后的 provider/model，而不是误报全局默认模型', async () => {
    const routedSecret = 'sk-routed-production-secret'
    useAIConfigStore.setState({
      config: {
        provider: 'deepseek', apiKey: SECRET_KEY,
        baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash',
        temperature: 0.7, maxTokens: 0,
      },
      rememberApiKey: false,
      presets: [{
        id: 'production-route',
        name: '开放世界生产模型',
        config: {
          provider: 'openai', apiKey: routedSecret,
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 16_000,
        },
      }],
      taskRoutes: { creation: 'production-route' },
    })
    const currentSession = await session()
    await act(async () => root.render(createElement(TextOpenWorldCreatorProductionReadiness, {
      session: currentSession,
      onBack: vi.fn(),
    })))

    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-preflight-budget"]')).not.toBeNull())
    const providerSection = host.querySelector('#tow-provider-heading')?.closest('section')
    expect(providerSection?.textContent).toContain('openai')
    expect(providerSection?.textContent).toContain('gpt-4o-mini')
    expect(providerSection?.textContent).toContain('https://api.openai.com')
    expect(providerSection?.textContent).toContain('作者选择本地记住')
    expect(host.textContent).toContain('$0.3960 / $30.00')
    expect(host.innerHTML).not.toContain(routedSecret)
    expect(host.innerHTML).not.toContain('routed-user')
    expect(host.innerHTML).not.toContain('routed-password')
    expect(host.innerHTML).not.toContain('token=private')
  })

  it('按任务路由预设的真实凭证来源区分会话 Key，而不沿用全局记住开关误标', async () => {
    const routedSecret = 'sk-routed-session-only-secret'
    sessionStorage.setItem('storyforge-ai-preset-api-keys-session', JSON.stringify({
      'session-production-route': routedSecret,
    }))
    useAIConfigStore.setState({
      config: {
        provider: 'deepseek', apiKey: SECRET_KEY,
        baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash',
        temperature: 0.7, maxTokens: 0,
      },
      rememberApiKey: true,
      presets: [{
        id: 'session-production-route',
        name: '仅会话开放世界生产模型',
        config: {
          provider: 'openai', apiKey: '', baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 16_000,
        },
      }],
      taskRoutes: { creation: 'session-production-route' },
    })
    const currentSession = await session()
    await act(async () => root.render(createElement(TextOpenWorldCreatorProductionReadiness, {
      session: currentSession,
      onBack: vi.fn(),
    })))

    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-preflight-budget"]')).not.toBeNull())
    const providerSection = host.querySelector('#tow-provider-heading')?.closest('section')
    expect(providerSection?.textContent).toContain('openai')
    expect(providerSection?.textContent).toContain('已配置 · 仅当前会话')
    expect(providerSection?.textContent).not.toContain('作者选择本地记住')
    expect(host.innerHTML).not.toContain(routedSecret)
  })
})
