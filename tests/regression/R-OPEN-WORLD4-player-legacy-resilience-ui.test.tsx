import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldLegacyCompatibilityPlayer from '../../src/components/text-game/TextOpenWorldLegacyCompatibilityPlayer'
import { createInitialOpenWorldState } from '../../src/lib/open-world/runtime'
import { classifyTextOpenWorldPlayerIssueV1 } from '../../src/lib/open-world/player-resilience'
import {
  EMPTY_PRODUCT_RUNTIME_STATE,
  type ProductRuntimeEvent,
  type ProductRuntimeSession,
} from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import {
  type TextOpenWorldPlayerState,
  useTextOpenWorldPlayerStore,
} from '../../src/stores/text-open-world-player'
import { createLegacyTextOpenWorldProductRuntimePackageFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const originalPlayerState = useTextOpenWorldPlayerStore.getState()
const originalAIState = useAIConfigStore.getState()

function resetPlayerStore(): void {
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
    saveProjection: { groups: [], totalBranches: 0, totalCheckpoints: 0 },
    versionCompatibility: null,
    runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    selectedManifest: null,
    lastFeedback: null,
    generatedCandidate: null,
    presentationBusy: false,
    presentationIssue: null,
    issue: null,
    recovery: null,
    recoveryNotice: '',
    loading: false,
    busy: false,
    error: '',
    command: originalPlayerState.command,
    generatePresentation: originalPlayerState.generatePresentation,
    recover: originalPlayerState.recover,
    cancelPresentation: originalPlayerState.cancelPresentation,
  })
  useAIConfigStore.setState({
    config: structuredClone(originalAIState.config),
    presets: structuredClone(originalAIState.presets),
    taskRoutes: structuredClone(originalAIState.taskRoutes),
  })
}

function setModelReady(ready: boolean): void {
  useAIConfigStore.setState({
    config: {
      ...originalAIState.config,
      provider: 'deepseek',
      apiKey: ready ? 'test-key-never-sent' : '',
      model: 'deepseek-test',
      baseUrl: 'https://example.invalid/v1',
    },
    presets: [],
    taskRoutes: {},
  })
}

function prepareLegacyPlayer(
  overrides: Partial<TextOpenWorldPlayerState> = {},
): void {
  const runtimePackage = createLegacyTextOpenWorldProductRuntimePackageFixtureV1(
    createTextOpenWorldVNextFixture().sourceManifest.contentHash,
  )
  if (!runtimePackage.openWorld) throw new Error('测试运行包缺少 legacy 开放世界模块')
  const contentHash = runtimePackage.sourceWorld.contentHash
  const session: ProductRuntimeSession = {
    id: 41,
    projectId: 1,
    worldGroupId: null,
    worldId: 2,
    workId: 3,
    productReleaseId: 4,
    productBuildId: null,
    runtimeSourceHash: contentHash,
    kind: 'text-open-world',
    title: 'Legacy 韧性验收',
    status: 'active',
    rulesetVersion: runtimePackage.definition.rulesetVersion,
    seed: 'legacy-resilience-ui',
    canonSnapshotJson: '{}',
    initialStateJson: '{}',
    runtimeHeadSequence: 0,
    runtimeHeadStateJson: '{}',
    runtimeHeadStateHash: contentHash,
    parentSessionId: null,
    parentThroughSequence: null,
    createdAt: 1,
    updatedAt: 1,
  }
  useTextOpenWorldPlayerStore.setState({
    scope: { projectId: 1, worldId: 2, workId: 3 },
    worldGroupId: null,
    releases: [],
    sessions: [],
    selectedSessionId: session.id!,
    selectedSession: session,
    selectedSessionSource: 'release',
    events: [],
    checkpoints: [],
    saveProjection: { groups: [], totalBranches: 0, totalCheckpoints: 0 },
    versionCompatibility: null,
    runtimeState: {
      ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
      openWorld: createInitialOpenWorldState(runtimePackage.openWorld, contentHash),
    },
    selectedManifest: runtimePackage,
    lastFeedback: null,
    generatedCandidate: null,
    presentationBusy: false,
    presentationIssue: null,
    issue: null,
    recovery: null,
    recoveryNotice: '',
    loading: false,
    busy: false,
    error: '',
    ...overrides,
  })
}

function buttonByText(host: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find(candidate => (
    candidate.textContent?.trim() === text
  ))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮:${text}`)
  return button
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

describe('Text Open World G4 · Legacy 玩家 AI 降级与恢复状态', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    localStorage.clear()
    resetPlayerStore()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    resetPlayerStore()
  })

  it('没有模型配置时明确降级，但世界 tick 仍可执行', async () => {
    const command = vi.fn(async () => {})
    setModelReady(false)
    prepareLegacyPlayer({ command })

    await act(async () => root.render(createElement(TextOpenWorldLegacyCompatibilityPlayer)))

    const notice = host.querySelector('[data-testid="text-open-world-player-state-notice"]')
    const tick = buttonByText(host, '推进世界 tick')
    expect(notice?.getAttribute('data-diagnostic-code')).toBe('TOW-PLAYER-OPTIONAL-AI')
    expect(notice?.textContent).toContain('可选 AI 表现尚未配置')
    expect(notice?.textContent).toContain('AI API Key')
    expect(tick.disabled).toBe(false)

    await click(tick)
    expect(command).toHaveBeenCalledWith({ kind: 'tick' })
  })

  it('AI 生成使用独立忙碌状态，失败或生成中都不伪装成世界结算', async () => {
    const command = vi.fn(async () => {})
    const cancelPresentation = vi.fn()
    const degraded = classifyTextOpenWorldPlayerIssueV1({
      error: '429 provider quota exceeded',
      surface: 'optional-ai',
    })
    const generatePresentation = vi.fn(async () => {
      useTextOpenWorldPlayerStore.setState({ presentationIssue: degraded })
      throw new Error('429 provider quota exceeded')
    })
    const event: ProductRuntimeEvent = {
      projectId: 1,
      worldGroupId: null,
      sessionId: 41,
      sequence: 1,
      type: 'world.tick.completed',
      actorKey: 'system',
      targetKey: null,
      payloadJson: '{}',
      createdAt: 1,
    }
    setModelReady(true)
    prepareLegacyPlayer({
      command,
      cancelPresentation,
      events: [event],
      presentationBusy: true,
    })

    await act(async () => root.render(createElement(TextOpenWorldLegacyCompatibilityPlayer)))

    const tick = buttonByText(host, '推进世界 tick')
    const presentationAction = buttonByText(host, '正在生成')
    const presentationStatus = host.querySelector(
      '[data-testid="text-open-world-legacy-presentation-busy"]',
    )
    expect(presentationStatus?.textContent).toContain('正在生成，可继续游玩')
    expect(presentationAction.disabled).toBe(true)
    expect(tick.disabled).toBe(false)
    expect(tick.querySelector('.animate-spin')).toBeNull()
    expect(host.querySelector('[data-testid="text-open-world-global-status"]')?.textContent)
      .toContain('事件已落盘')

    await click(tick)
    expect(command).toHaveBeenCalledWith({ kind: 'tick' })
    await click(buttonByText(host, '取消生成'))
    expect(cancelPresentation).toHaveBeenCalledTimes(1)

    await act(async () => {
      useTextOpenWorldPlayerStore.setState({
        presentationBusy: false,
        presentationIssue: null,
        generatePresentation,
      })
    })
    await click(buttonByText(host, 'Harness 场景'))

    const notice = host.querySelector('[data-testid="text-open-world-player-state-notice"]')
    expect(generatePresentation).toHaveBeenCalledTimes(1)
    expect(notice?.getAttribute('data-player-state')).toBe('degraded')
    expect(notice?.textContent).toContain('确定性玩法、地图、任务、战斗和存档仍可继续')
    expect(buttonByText(host, '推进世界 tick').disabled).toBe(false)
  })

  it('运行错误按 gameplayAvailability 锁定，并暴露核对恢复及恢复结果', async () => {
    const recover = vi.fn(async () => {})
    const issue = classifyTextOpenWorldPlayerIssueV1({
      error: '状态已变化，请重新核对',
      surface: 'runtime-operation',
    })
    if (!issue) throw new Error('测试未生成预期恢复问题')
    setModelReady(true)
    prepareLegacyPlayer({
      issue,
      recovery: { kind: 'refresh-session', sessionId: 41 },
      recover,
    })

    await act(async () => root.render(createElement(TextOpenWorldLegacyCompatibilityPlayer)))

    const tick = buttonByText(host, '推进世界 tick')
    const notice = host.querySelector('[data-testid="text-open-world-player-state-notice"]')
    expect(issue.gameplayAvailability).toBe('read-only')
    expect(tick.disabled).toBe(true)
    expect(notice?.getAttribute('data-diagnostic-code')).toBe('TOW-PLAYER-STALE')

    await click(buttonByText(host, '重新核对当前存档'))
    expect(recover).toHaveBeenCalledTimes(1)

    await act(async () => {
      useTextOpenWorldPlayerStore.setState({
        issue: null,
        recovery: null,
        recoveryNotice: '已核对最新时间线，尚未重复执行原操作。',
      })
    })

    const recoveryNotice = host.querySelector(
      '[data-testid="text-open-world-legacy-recovery-notice"]',
    )
    expect(recoveryNotice?.textContent).toContain('已核对最新时间线')
    expect(buttonByText(host, '推进世界 tick').disabled).toBe(false)
  })
})
