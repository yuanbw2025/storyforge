import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import ChapterOrganizationModal from '../../src/components/editor/ChapterOrganizationModal'
import { parseChapterOrganizationOutput, type ChapterOrganizationRun } from '../../src/lib/agent/chapter-organization'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

it('空候选允许明确结束，故事线三个分区显示各自用途', async () => {
  const candidate = parseChapterOrganizationOutput({
    raw: '{}', projectId: 1, chapterId: 2, chapterTitle: '夜信', worldGroupId: null,
    chapterText: '灯灭了。', sourceTextHash: 'test-only', characters: [], existingRelations: [],
    foreshadows: [], budget: new AgentTeamBudgetTracker('balanced').snapshot(),
  })!
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const apply = vi.fn()
  try {
    await act(async () => root.render(createElement(ChapterOrganizationModal, {
      run: { candidate } as ChapterOrganizationRun,
      current: true, busy: false, error: '', onApply: apply, onClose: vi.fn(), onRerun: vi.fn(),
    })))
    const headings = [...host.querySelectorAll('h4')].map(node => node.textContent)
    expect(headings).toEqual(expect.arrayContaining(['故事线推进', '故事线交汇', '新故事线候选']))
    const button = [...host.querySelectorAll('button')].find(node => node.textContent === '本次不写入')!
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(apply).toHaveBeenCalledOnce()
    expect(Object.values(apply.mock.calls[0][0]).every(value => Array.isArray(value) && value.length === 0)).toBe(true)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
