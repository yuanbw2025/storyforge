import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TextOpenWorldCreatorBriefDraftV1,
  TextOpenWorldCreatorBriefV1,
  TextOpenWorldCreatorSourceSelectionV1,
  WorkspaceScope,
} from '../../src/lib/types'
import type { TextOpenWorldCreatorBriefSessionV1 } from '../../src/lib/open-world/creator-brief'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

const creatorBriefMocks = vi.hoisted(() => ({
  recover: vi.fn(),
  recoverExact: vi.fn(),
  start: vi.fn(),
  save: vi.fn(),
  consult: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('../../src/lib/open-world/creator-brief', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/open-world/creator-brief')>()
  return {
    ...actual,
    recoverLatestTextOpenWorldCreatorBriefSessionV1: creatorBriefMocks.recover,
    recoverTextOpenWorldCreatorBriefSessionByIdentityV1: creatorBriefMocks.recoverExact,
    startTextOpenWorldCreatorBriefSessionV1: creatorBriefMocks.start,
    saveTextOpenWorldCreatorBriefDraftV1: creatorBriefMocks.save,
    generateTextOpenWorldCreatorBriefCandidateV1: creatorBriefMocks.consult,
    confirmTextOpenWorldCreatorBriefV1: creatorBriefMocks.confirm,
  }
})

vi.mock('../../src/components/text-game/TextOpenWorldCreatorStudio', async () => {
  const { createElement: element } = await import('react')
  return {
    TextOpenWorldCreatorStudio: (props: {
      onContinue?: (selection: TextOpenWorldCreatorSourceSelectionV1) => void
    }) => element('section', { 'data-testid': 'mock-creator-source-studio' },
      element('h1', null, '选择游戏内容来源'),
      element('button', {
        type: 'button',
        onClick: () => props.onContinue?.(sourceSelection()),
      }, '使用已核验来源')),
  }
})

import TextOpenWorldCreatorBriefStudio from '../../src/components/text-game/TextOpenWorldCreatorBriefStudio'
import TextOpenWorldCreatorWorkflow from '../../src/components/text-game/TextOpenWorldCreatorWorkflow'
import { useAIConfigStore } from '../../src/stores/ai-config'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SCOPE: WorkspaceScope = { projectId: 51, worldId: 52, workId: 53 }
const SOURCE_VERSION_HASH = 'a'.repeat(64)
const SOURCE_BOUNDARY_HASH = 'b'.repeat(64)
const SOURCE_BINDING_HASH = 'c'.repeat(64)

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
    unresolvedQuestions: ['主角是否已经认识守灯人？'],
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

function consultationSession(overrides: Partial<TextOpenWorldCreatorBriefSessionV1> = {}): TextOpenWorldCreatorBriefSessionV1 {
  const now = 1_788_000_000_000
  return {
    scope: SCOPE,
    conversation: {
      id: 61,
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
      id: 71,
      ...SCOPE,
      productionKey: 'text-open-world.primary.test-source',
      productType: 'text-open-world',
      title: '河灯长夜开放世界',
      status: 'consulting',
      stateRevision: 0,
      controlEpoch: 0,
      currentBriefRevision: null,
      currentBuildNumber: null,
      currentProductReleaseId: null,
      creatorSourceKind: 'novel',
      creatorSourceWorkId: SCOPE.workId,
      creatorSourceSelectionMode: 'entire-work',
      creatorSourceVersionHash: SOURCE_VERSION_HASH,
      creatorSourceBoundaryHash: SOURCE_BOUNDARY_HASH,
      creatorSourceBindingJson: '{}',
      creatorSourceBindingHash: SOURCE_BINDING_HASH,
      lastErrorJson: '{}',
      createdAt: now,
      updatedAt: now,
    },
    productInstanceKey: 'text-open-world.primary.test-source',
    selection: sourceSelection(),
    sourceBinding: {
      kind: 'novel',
      workCode: 'work.river-lantern',
      sourceVersionHash: SOURCE_VERSION_HASH,
      sourceBoundaryHash: SOURCE_BOUNDARY_HASH,
      coverage: 'full-text',
      selectionMode: 'entire-work',
      selectedChapterCount: 8,
      selectedOutlineCount: 3,
    },
    sourceBindingHash: SOURCE_BINDING_HASH,
    sourceSummary: {
      label: '河灯长夜 · 整部小说',
      sourceKind: 'novel',
      coverage: 'full-text',
      resourceCount: 12,
      rowOrWordCount: 42_000,
      capabilityAreas: ['story', 'characters'],
      gaps: [],
    },
    draft: briefDraft(),
    candidate: null,
    candidateRunId: null,
    confirmedBrief: null,
    sourceIssue: null,
    ...overrides,
  }
}

function resumeTarget(session: TextOpenWorldCreatorBriefSessionV1) {
  return {
    conversationId: session.conversation.id,
    productInstanceKey: session.productInstanceKey,
    sourceBindingHash: session.sourceBindingHash,
    sourceBinding: session.sourceBinding,
  }
}

async function confirmedBrief(session: TextOpenWorldCreatorBriefSessionV1, draft: TextOpenWorldCreatorBriefDraftV1): Promise<TextOpenWorldCreatorBriefV1> {
  const body: Omit<TextOpenWorldCreatorBriefV1, 'briefHash'> = {
    schema: 'storyforge.text-open-world-creator-brief',
    version: 1,
    productInstanceKey: session.productInstanceKey,
    revision: 1,
    sourceBinding: session.sourceBinding,
    sourceBindingHash: await hashCanonicalValue(session.sourceBinding),
    sourceSummary: session.sourceSummary,
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
      candidateHash: 'e'.repeat(64),
      runBindingHash: 'f'.repeat(64),
      origin: 'author',
      contextManifestHashes: ['1'.repeat(64)],
    },
    confirmedAt: 1_788_000_000_100,
  }
  return { ...body, briefHash: await hashCanonicalValue(body) }
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

async function setControlValue(control: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const prototype = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(control, value)
    control.dispatchEvent(new Event('input', { bubbles: true }))
    control.dispatchEvent(new Event('change', { bubbles: true }))
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

describe('TOW-G5-02 · Creator Brief UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.resetAllMocks()
    useAIConfigStore.setState({
      config: {
        provider: 'deepseek',
        apiKey: '',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-flash',
        temperature: 0.7,
        maxTokens: 0,
      },
    })
    creatorBriefMocks.recover.mockResolvedValue(null)
    creatorBriefMocks.recoverExact.mockResolvedValue(null)
    creatorBriefMocks.start.mockImplementation(async () => consultationSession())
    creatorBriefMocks.save.mockImplementation(async input => ({
      ...input.session,
      draft: input.draft,
      conversation: { ...input.session.conversation, updatedAt: 1_788_000_000_050 },
    }))
    creatorBriefMocks.confirm.mockImplementation(async input => {
      const brief = await confirmedBrief(input.session, input.draft)
      return {
        ...input.session,
        draft: input.draft,
        candidateRunId: 81,
        confirmedBrief: brief,
        production: {
          ...input.session.production,
          title: input.draft.gameTitle,
          status: 'brief-ready',
          stateRevision: input.session.production.stateRevision + 1,
          currentBriefRevision: 1,
        },
      }
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('从已核验来源进入会谈，支持编辑保存，并在无 AI 时通过全部人工门禁确认到 brief-ready', async () => {
    await act(async () => root.render(createElement(TextOpenWorldCreatorWorkflow, {
      worldScope: SCOPE,
      novelScope: SCOPE,
      initialSourceKind: 'novel',
    })))
    await waitFor(() => expect(host.querySelector('[data-testid="mock-creator-source-studio"]')).not.toBeNull())

    await act(async () => button(host, '使用已核验来源').click())
    await waitFor(() => expect(host.querySelector('[data-testid="text-open-world-creator-brief-studio"]')).not.toBeNull())

    expect(creatorBriefMocks.start).toHaveBeenCalledWith({
      selection: sourceSelection(),
      sessionKey: 'primary',
    })
    expect(host.textContent).toContain('河灯长夜 · 整部小说')
    expect(host.textContent).toContain('未配置 Key，可纯人工确认')
    expect(button(host, '请求主 Agent').disabled).toBe(true)

    const confirmButton = button(host, '确认 Brief')
    expect(confirmButton.disabled).toBe(true)
    const title = host.querySelector<HTMLInputElement>('#tow-title')!
    await setControlValue(title, '河灯守望者')
    await act(async () => button(host, '保存草稿').click())
    await waitFor(() => expect(creatorBriefMocks.save).toHaveBeenCalledTimes(1))
    expect(creatorBriefMocks.save.mock.calls[0]?.[0].draft.gameTitle).toBe('河灯守望者')
    expect(host.textContent).toContain('草稿已保存，可刷新后继续')

    for (const label of [
      '我确认当前来源身份与 Hash',
      '我理解首版是有边界的自由演绎',
      '我确认未决问题已经清空',
      '我理解通过质量门后直接发布',
    ]) {
      await act(async () => checkbox(host, label).click())
    }
    expect(confirmButton.disabled).toBe(true)

    const unresolved = host.querySelector<HTMLTextAreaElement>('#tow-unresolved')!
    await setControlValue(unresolved, '')
    expect(confirmButton.disabled).toBe(false)

    await act(async () => confirmButton.click())
    await waitFor(() => expect(creatorBriefMocks.confirm).toHaveBeenCalledTimes(1))
    expect(creatorBriefMocks.confirm.mock.calls[0]?.[0]).toMatchObject({
      draft: { gameTitle: '河灯守望者', unresolvedQuestions: [] },
      acknowledgements: {
        sourceIdentityReviewed: true,
        productBoundaryReviewed: true,
        unresolvedItemsClosed: true,
        directPublishWorkflowReviewed: true,
      },
    })
    await waitFor(() => expect(host.textContent).toContain('Brief 已就绪'))
    expect(host.textContent).toContain('已确认 v1')
    expect(host.textContent).toContain('Build 0')

    await act(async () => button(host, '核对模型与预算').click())
    await waitFor(() => expect(
      host.querySelector('[data-testid="text-open-world-creator-production-readiness"]'),
    ).not.toBeNull())
    expect(host.textContent).toContain('核对模型、凭证与生产预算')
  })

  it('来源漂移时保留表单但阻断保存、Agent 与确认，并允许返回来源重选', async () => {
    const onBack = vi.fn()
    const stale = consultationSession({
      selection: null,
      sourceIssue: '来源版本或内容边界已经变化',
    })
    await act(async () => root.render(createElement(TextOpenWorldCreatorBriefStudio, {
      initialSession: stale,
      onBack,
    })))

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('来源版本或内容边界已经变化')
    expect(host.querySelector<HTMLInputElement>('#tow-title')?.value).toBe('河灯长夜开放世界')
    expect(button(host, '保存草稿').disabled).toBe(true)
    expect(button(host, '请求主 Agent').disabled).toBe(true)
    expect(button(host, '确认 Brief').disabled).toBe(true)
    expect(button(host, '恢复预填').disabled).toBe(true)

    await act(async () => button(host, '返回来源').click())
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(creatorBriefMocks.save).not.toHaveBeenCalled()
    expect(creatorBriefMocks.confirm).not.toHaveBeenCalled()
  })

  it('把余额拒绝显示为不含供应商原文的暂停说明，且不会隐藏重发', async () => {
    const secret = 'sk-provider-secret-must-not-render'
    useAIConfigStore.setState({
      config: {
        provider: 'deepseek',
        apiKey: secret,
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-flash',
        temperature: 0.7,
        maxTokens: 0,
      },
      rememberApiKey: false,
    })
    creatorBriefMocks.consult.mockRejectedValue({
      status: 429,
      body: `insufficient balance; upstream diagnostic ${secret}`,
    })

    await act(async () => root.render(createElement(TextOpenWorldCreatorBriefStudio, {
      initialSession: consultationSession(),
      onBack: vi.fn(),
    })))
    await act(async () => button(host, '请求主 Agent').click())

    await waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('余额不足'))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('没有隐藏重发')
    expect(host.innerHTML).not.toContain(secret)
    expect(host.innerHTML).not.toContain('upstream diagnostic')
    expect(creatorBriefMocks.consult).toHaveBeenCalledTimes(1)
  })

  it('从设置返回后恢复已确认 Brief，并直接回到模型与预算核对页', async () => {
    const recovered = consultationSession()
    const draft = { ...recovered.draft, unresolvedQuestions: [] }
    const brief = await confirmedBrief(recovered, draft)
    const exactTarget = resumeTarget(recovered)
    creatorBriefMocks.recoverExact.mockResolvedValue({
      ...recovered,
      draft,
      confirmedBrief: brief,
      production: {
        ...recovered.production,
        status: 'brief-ready',
        currentBriefRevision: 1,
      },
    })

    await act(async () => root.render(createElement(TextOpenWorldCreatorWorkflow, {
      novelScope: SCOPE,
      initialSourceKind: 'novel',
      initialView: 'readiness',
      initialResumeTarget: exactTarget,
    })))

    await waitFor(() => expect(
      host.querySelector('[data-testid="text-open-world-creator-production-readiness"]'),
    ).not.toBeNull())
    expect(creatorBriefMocks.recoverExact).toHaveBeenCalledWith([SCOPE], exactTarget)
    expect(creatorBriefMocks.recover).not.toHaveBeenCalled()
    expect(host.textContent).toContain('核对模型、凭证与生产预算')
    await waitFor(() => expect(host.textContent).toContain('缺少远程服务 Key'))
  })

  it('设置返回目标失效时不回退到其他来源的最新会谈', async () => {
    const exactTarget = resumeTarget(consultationSession())
    creatorBriefMocks.recoverExact.mockResolvedValue(null)
    creatorBriefMocks.recover.mockResolvedValue(consultationSession({
      conversation: { ...consultationSession().conversation, id: 999, updatedAt: 1_788_000_000_999 },
    }))

    await act(async () => root.render(createElement(TextOpenWorldCreatorWorkflow, {
      novelScope: SCOPE,
      initialSourceKind: 'novel',
      initialView: 'readiness',
      initialResumeTarget: exactTarget,
    })))

    await waitFor(() => expect(host.querySelector('[data-testid="mock-creator-source-studio"]')).not.toBeNull())
    expect(creatorBriefMocks.recoverExact).toHaveBeenCalledWith([SCOPE], exactTarget)
    expect(creatorBriefMocks.recover).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="text-open-world-creator-production-readiness"]')).toBeNull()
  })
})
