import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  authorRequest: '',
  activeRequest: null as string | null,
  showPendingCandidate: true,
  setAuthorRequest: vi.fn(),
  submit: vi.fn(),
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
      },
    }] : [],
    busy: false,
    loading: false,
    submit: mocks.submit,
    stop: mocks.stop,
    updateCandidate: mocks.updateCandidate,
    adoptCandidate: mocks.adoptCandidate,
    rejectCandidate: mocks.rejectCandidate,
  }),
}))

import ChatCopilotPanel from '../../src/components/agent/ChatCopilotPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  vi.clearAllMocks()
  mocks.authorRequest = ''
  mocks.activeRequest = null
  mocks.showPendingCandidate = true
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
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
    expect(host.textContent).toContain('单一对话入口')
    expect(host.textContent).toContain('幕后调度领域 Agent')
    expect(host.textContent).toContain('待确认 · 世界来源')
    expect(host.textContent).toContain('2 个输入来源')
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

    const buttons = Array.from(host.querySelectorAll('button'))
    await act(async () => buttons.find(button => button.textContent?.includes('拒绝'))!.click())
    await act(async () => buttons.find(button => button.textContent?.includes('采纳'))!.click())
    expect(mocks.rejectCandidate).toHaveBeenCalledTimes(1)
    expect(mocks.adoptCandidate).toHaveBeenCalledTimes(1)
  })

  it('在调用模型前展示产物、常规调用与硬预算边界', async () => {
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
    expect(preview?.textContent).toContain('本轮硬上限 7 次')
    expect(preview?.textContent).toContain('正文会等你先确认故事规划后')
    expect(preview?.textContent).toContain('执行中可随时停止')
  })
})
