import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/lib/types'
import { AgentTeamBudgetTracker, type AgentTeamBudgetEvidence } from '../../src/lib/agent/team-budget'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as creativePreview from '../../src/lib/agent/creative-run-preview'

const mocks = vi.hoisted(() => ({
  authorRequest: '',
  activeRequest: null as string | null,
  showPendingCandidate: true,
  teamBudgetEvidence: undefined as AgentTeamBudgetEvidence | undefined,
  setAuthorRequest: vi.fn(),
  submit: vi.fn(),
  discuss: vi.fn(),
  stop: vi.fn(),
  updateCandidate: vi.fn(),
  adoptCandidate: vi.fn(),
  rejectCandidate: vi.fn(),
}))

vi.mock('../../src/components/agent/useMasterCopilot', () => ({
  useMasterCopilot: () => ({
    authorRequest: mocks.authorRequest,
    activeRequest: mocks.activeRequest,
    setAuthorRequest: mocks.setAuthorRequest,
    events: [
      {
        id: 1,
        kind: 'message',
        role: 'assistant',
        content: '直接告诉我你想完成什么。',
        payload: '{}',
      },
      {
        id: 2,
        kind: 'task',
        content: '建立世界',
        payload: JSON.stringify({
          taskId: 'world-1',
          agentId: 'world-origin',
          status: 'completed',
        }),
      },
    ],
    pendingCandidates: mocks.showPendingCandidate ? [{
      event: {
        id: 3,
        kind: 'candidate',
        content: '潮汐退去后，第一座盐城从海床升起。',
        payload: '{}',
      },
      payload: {
        version: 1,
        taskId: 'world-1',
        agentId: 'world-origin',
        label: '世界来源',
        contextSources: ['workStatus', 'worldview'],
        baseSnapshot: {},
        ...(mocks.teamBudgetEvidence ? { teamBudgetEvidence: mocks.teamBudgetEvidence } : {}),
      },
    }] : [],
    busy: false,
    loading: false,
    submit: mocks.submit,
    discuss: mocks.discuss,
    stop: mocks.stop,
    updateCandidate: mocks.updateCandidate,
    adoptCandidate: mocks.adoptCandidate,
    rejectCandidate: mocks.rejectCandidate,
  }),
}))

import ChatCopilotPanel from '../../src/components/agent/ChatCopilotPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const originalPreferences = { agentTeamBudgetProfile: useAIConfigStore.getState().agentTeamBudgetProfile, creativeQualityMode: useAIConfigStore.getState().creativeQualityMode }

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  vi.clearAllMocks()
  mocks.authorRequest = ''
  mocks.activeRequest = null
  mocks.showPendingCandidate = true
  mocks.teamBudgetEvidence = undefined
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
  vi.restoreAllMocks()
  useAIConfigStore.setState(originalPreferences)
})

describe('AGENT-2 · 单一主 Agent 对话入口', () => {
  it('不暴露领域标签页，由主 Agent 统一展示后台任务与可编辑候选', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ host, root })
    const project = {
      id: 1,
      workspaceUid: 'WS-00000000-0000-4000-8000-000000000001',
      workspacePurpose: 'independent-work',
      name: '潮汐纪元',
      activeWorldId: 11,
      activeWorkId: 12,
      createdAt: 1,
      updatedAt: 1,
    } as Project

    await act(async () => root.render(createElement(ChatCopilotPanel, {
      project,
      worldGroupId: 3,
      worldName: '盐海世界',
      onClose: vi.fn(),
    })))

    expect(host.querySelector('aside')?.getAttribute('aria-label')).toBe('主 Agent 创作副驾')
    expect(host.textContent).toContain('主 Agent')
    expect(host.textContent).toContain('炉娘')
    expect(host.querySelector('.companion-portrait')?.getAttribute('data-pose')).toBe('ready')
    expect(host.textContent).toContain('确认采纳前，作品原文保持不变')
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="告诉主 Agent 你的目标"]')?.disabled).toBe(false)
    expect(host.textContent).toContain('待确认 · 世界来源')
    expect(host.textContent).toContain('2 个输入来源')
    expect(host.textContent).not.toContain('本轮团队预算约')
    expect(host.textContent).not.toContain('角色生成')
    expect(host.textContent).not.toContain('灵感反推')

    const candidate = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="世界来源候选内容"]',
    )!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!
      setter.call(candidate, '作者修订后的候选')
      candidate.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(mocks.updateCandidate).toHaveBeenCalledWith(3, '作者修订后的候选')

    const composer = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="告诉主 Agent 你的目标"]')!
    await act(async () => composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })))
    expect(mocks.discuss).not.toHaveBeenCalled()
    await act(async () => composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(mocks.discuss).toHaveBeenCalledTimes(1)
    const buttons = Array.from(host.querySelectorAll('button'))
    await act(async () => buttons.find(button => button.textContent?.includes('拒绝'))!.click())
    await act(async () => buttons.find(button => button.textContent?.includes('采纳'))!.click())
    expect(mocks.rejectCandidate).toHaveBeenCalledTimes(1)
    expect(mocks.adoptCandidate).toHaveBeenCalledTimes(1)
  })

  it('即使设置选择有限档位，新主 Agent 仍展示参考调用与服务容量', async () => {
    useAIConfigStore.setState({ agentTeamBudgetProfile: 'economy', creativeQualityMode: 'balanced' })
    const estimate = vi.spyOn(creativePreview, 'estimateCreativeRunPreviewV1')
    mocks.activeRequest = '规划第一章章纲，然后写出第一章正文'
    mocks.showPendingCandidate = false
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ host, root })

    await act(async () => root.render(createElement(ChatCopilotPanel, {
      project: {
        id: 1,
        workspaceUid: 'WS-00000000-0000-4000-8000-000000000001',
        workspacePurpose: 'independent-work',
        name: '潮汐纪元',
        activeWorldId: 11,
        activeWorkId: 12,
        createdAt: 1,
        updatedAt: 1,
      } as Project,
      worldGroupId: 3,
      worldName: '盐海世界',
      onClose: vi.fn(),
    })))

    const preview = host.querySelector('[aria-label="本轮调用预估"]')
    expect(preview?.textContent).toContain('本轮预计 1 份可编辑候选：故事规划')
    expect(preview?.textContent).toContain('通常 2 次模型调用')
    expect(estimate).toHaveBeenCalledWith({ request: mocks.activeRequest, qualityMode: 'balanced', teamBudgetProfile: 'service-capacity' })
    expect(preview?.textContent).toContain('仅供参考；本轮按服务实际容量执行')
    expect(preview?.textContent).not.toContain('本轮硬上限')
    expect(preview?.textContent).not.toContain('0 次 / 0 tokens')
    expect(useAIConfigStore.getState().agentTeamBudgetProfile).toBe('economy')
    expect(preview?.textContent).toContain('正文会等你先确认故事规划后')
    expect(preview?.textContent).toContain('执行中可随时停止')
  })

  it.each(['balanced', 'service-capacity'] as const)('已有%s候选按自身冻结预算显示，忽略当前设置', async profile => {
    useAIConfigStore.setState({ agentTeamBudgetProfile: profile === 'balanced' ? 'service-capacity' : 'economy' })
    const evidence = { ...new AgentTeamBudgetTracker(profile).snapshot(), usedTokens: 1234, calls: 2 }
    mocks.teamBudgetEvidence = evidence
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ host, root })
    await act(async () => root.render(createElement(ChatCopilotPanel, {
      project: {
        id: 1, workspaceUid: 'WS-00000000-0000-4000-8000-000000000001', workspacePurpose: 'independent-work',
        name: '潮汐纪元', activeWorldId: 11, activeWorkId: 12, createdAt: 1, updatedAt: 1,
      } as Project,
      worldGroupId: 3, worldName: '盐海世界', onClose: vi.fn(),
    })))
    expect(host.querySelector('[aria-label="本轮调用预估"]')).toBeNull()
    expect(host.textContent).toContain(evidence.usedTokens.toLocaleString())
    if (profile === 'balanced') {
      expect(host.textContent).toContain(`${evidence.usedTokens.toLocaleString()} / ${evidence.maxTokens.toLocaleString()} tokens`)
      expect(host.textContent).toContain(`${evidence.calls}/${evidence.maxCalls} 次调用`)
      expect(host.textContent).toContain(`Canon 打回 ${evidence.canonRetries}/${evidence.maxCanonRetries}`)
      expect(host.textContent).not.toContain('无应用额度上限')
    } else {
      expect(host.textContent).toContain('按服务容量')
      expect(host.textContent).toContain(`${evidence.calls}/无应用额度上限 次调用`)
      expect(host.textContent).not.toContain('/ 0 tokens')
      expect(host.textContent).not.toContain(`${evidence.calls}/0 次调用`)
    }
    expect(mocks.teamBudgetEvidence).toEqual(evidence)
  })
})
