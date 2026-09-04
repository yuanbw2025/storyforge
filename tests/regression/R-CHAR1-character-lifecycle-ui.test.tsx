import { act, createElement } from 'react'
import { readFileSync } from 'node:fs'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Character, Project } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  copilot: {
    pendingCandidates: [] as any[], loading: false, busy: false, error: null as string | null,
    submitTargetedRequest: vi.fn(async () => undefined), updateCandidate: vi.fn(async () => undefined),
    rejectCandidate: vi.fn(async () => true), adoptCandidate: vi.fn(async () => true),
  },
  chapters: [{ id: 21, outlineNodeId: 11, title: '潮门断响' }],
  arcs: [{ id: 31, worldGroupId: null, name: '守门主线' }],
  outlineNodes: [{ id: 11, worldGroupId: null }],
  loadChapters: vi.fn(async () => undefined),
  loadArcs: vi.fn(async () => undefined),
  loadOutlineNodes: vi.fn(async () => undefined),
}))

vi.mock('../../src/components/agent/useMasterCopilot', () => ({ useMasterCopilot: () => mocks.copilot }))
vi.mock('../../src/stores/chapter', () => ({
  useChapterStore: (selector: (state: any) => unknown) => selector({ chapters: mocks.chapters, loadAll: mocks.loadChapters }),
}))
vi.mock('../../src/stores/story-arc', () => ({
  useStoryArcStore: (selector: (state: any) => unknown) => selector({ arcs: mocks.arcs, loadAll: mocks.loadArcs }),
}))
vi.mock('../../src/stores/outline', () => ({
  useOutlineStore: (selector: (state: any) => unknown) => selector({ nodes: mocks.outlineNodes, loadAll: mocks.loadOutlineNodes }),
}))

import CharacterLifecycleAction from '../../src/components/character/CharacterLifecycleAction'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project = {
  id: 1,
  workspaceUid: 'WS-00000000-0000-4000-8000-000000000001',
  workspacePurpose: 'independent-work',
  name: '潮门纪事',
  enableMultiWorld: false,
  activeWorldId: 11,
  activeWorkId: 12,
  createdAt: 1,
  updatedAt: 1,
} as Project
const character = {
  id: 7, projectId: 1, name: '青禾', roleWeight: 'main',
  moralAxis: 'good', orderAxis: 'lawful', shortDescription: '', appearance: '', personality: '',
  background: '', motivation: '', abilities: '', relationships: '', arc: '', narrativeStatus: 'active',
  ragDocumentId: 'res:v1:character:00000000-0000-4000-8000-000000000007',
  createdAt: 1, updatedAt: 1,
} as Character

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function renderAction(onDone = vi.fn()) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(CharacterLifecycleAction, {
    character, project, worldGroupId: null, onDone,
  })))
  await act(async () => Array.from(host.querySelectorAll('button'))
    .find(button => button.textContent?.includes('状态 · 活跃'))!.click())
  return { host, onDone }
}

function pendingCandidate() {
  const request = { characterId: 7, targetStatus: 'inactive', evidenceChapterId: 21, evidenceStoryArcId: 31 }
  const snapshot = {
    version: 1, request,
    character: {
      id: 7, ragDocumentId: character.ragDocumentId, updatedAt: 1, homeWorldGroupId: null,
      isCrossWorld: false, narrativeStatus: 'active', exitChapterId: null, ending: '', activeChapterRange: '',
    },
    evidence: [], serialized: '{}',
  }
  return {
    event: { id: 88, content: JSON.stringify({
      version: 1, characterId: 7, fromStatus: 'active', targetStatus: 'inactive',
      reason: '封门后昏迷。', ending: '', activeChapterRange: '第1章以前',
    }) },
    payload: {
      skillId: 'character.lifecycle', characterLifecycleRequest: request, baseSnapshot: snapshot,
      contextEvidence: { profile: 'balanced', included: ['ragSelection'], omitted: [], trimmed: [], estimatedInputTokens: 100, inputBudgetTokens: 1000 },
    },
  }
}

beforeEach(() => {
  mocks.copilot.pendingCandidates = []
  mocks.copilot.loading = false
  mocks.copilot.busy = false
  mocks.copilot.error = null
})

afterEach(async () => {
  vi.clearAllMocks()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('CHAR-1 · 角色状态候选 UI', () => {
  it('没有证据时禁用，选择章节和故事线后只提交固定 lifecycle 任务', async () => {
    const { host } = await renderAction()
    const generate = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('生成候选')) as HTMLButtonElement
    expect(generate.disabled).toBe(true)
    const chapter = host.querySelector<HTMLSelectElement>('[aria-label="角色状态触发章节"]')!
    const arc = host.querySelector<HTMLSelectElement>('[aria-label="角色状态触发故事线"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(chapter, '21')
      chapter.dispatchEvent(new Event('change', { bubbles: true }))
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(arc, '31')
      arc.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => generate.click())
    expect(mocks.copilot.submitTargetedRequest).toHaveBeenCalledWith(
      expect.stringContaining('青禾'),
      expect.objectContaining({
        id: 'character-lifecycle-7', agentId: 'character', skillId: 'character.lifecycle',
        characterLifecycleRequest: {
          characterId: 7, targetStatus: 'inactive', evidenceChapterId: 21, evidenceStoryArcId: 31,
        },
      }),
    )
  })

  it('恢复候选可编辑、拒绝和采纳，所有角色面板均提供入口且组件不直写 Canon', async () => {
    const candidate = pendingCandidate()
    mocks.copilot.pendingCandidates = [candidate]
    const { host, onDone } = await renderAction()
    const reason = host.querySelector<HTMLTextAreaElement>('[aria-label="角色状态变化理由"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, '作者补充：昏迷持续三日。')
      reason.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(mocks.copilot.updateCandidate).toHaveBeenCalledWith(88, expect.stringContaining('昏迷持续三日'))
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('拒绝'))!.click())
    expect(mocks.copilot.rejectCandidate).toHaveBeenCalledWith(candidate)
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('采纳'))!.click())
    expect(mocks.copilot.adoptCandidate).toHaveBeenCalledWith(candidate)
    expect(onDone).toHaveBeenCalledTimes(1)

    const actionSource = readFileSync('src/components/character/CharacterLifecycleAction.tsx', 'utf8')
    expect(actionSource).not.toContain('assembleContext')
    expect(actionSource).not.toMatch(/\badopt\s*\(/)
    for (const file of ['CharacterDetailCard.tsx', 'CharacterNPCPanel.tsx', 'CharacterMinorPanel.tsx', 'CharacterExtraPanel.tsx']) {
      expect(readFileSync(`src/components/character/${file}`, 'utf8')).toContain('<CharacterLifecycleAction')
    }
  })
})
