import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn(), download: vi.fn() }))
vi.mock('../../src/lib/open-world/experience-feedback', () => ({
  readTextOpenWorldExperienceV1: mocks.read,
  createTextOpenWorldExperienceFeedbackV1: mocks.create,
  TEXT_OPEN_WORLD_FEEDBACK_CATEGORIES_V1: { narrative: '叙事与节奏' },
}))
vi.mock('../../src/lib/export/text-export', () => ({ downloadTextFile: mocks.download }))
import TextOpenWorldExperienceFeedback from '../../src/components/text-game/TextOpenWorldExperienceFeedback'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
const scope = { projectId: 1, worldId: 2, workId: 3 }
const render = (sessionId = 4) => act(async () => {
  root.render(createElement(TextOpenWorldExperienceFeedback, { scope, sessionId }))
})
const exportButton = () => [...host.querySelectorAll('button')]
  .find(button => button.textContent === '导出本地反馈文件')!

async function prepareFeedback() {
  await render()
  await act(async () => { host.querySelector('button')!.click() })
  await act(async () => {
    const input = host.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '工程验证：任务引导不够清楚')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    host.querySelector('input')!.click()
  })
  expect(exportButton().disabled).toBe(false)
}

beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue({
    mainline: { steps: 0, completedQuests: 0, wallClockSpanMinutes: null },
    sideQuests: { accepted: 0, completed: 0 }, quests: { abandoned: 0, expired: 0 },
    combat: { defeated: 0, escaped: 0, respawned: 0 },
    map: { knownVisitedLocations: 1, fastTravel: 0 },
    freeInput: { mappingOffered: 0, mappedCommands: 0, boundaryResponses: 0, mainlineAfterBoundary: 0, unavailableRuns: 0 },
    repetition: { sameFingerprint: 0, sameSource: 0 }, throughSequence: 0, inheritedFromBranch: false,
  })
  mocks.create.mockReset().mockResolvedValue({ feedbackHash: 'a'.repeat(64) })
  mocks.download.mockReset().mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('W7 feedback file completion', () => {
  it('waits for the file write receipt before showing success or allowing another export', async () => {
    let finish!: () => void
    mocks.download.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    await prepareFeedback()
    await act(async () => { exportButton().click() })
    expect(mocks.download).toHaveBeenCalledTimes(1)
    expect(exportButton().disabled).toBe(true)
    expect(host.textContent).not.toContain('已导出到本机文件')
    await act(async () => { finish() })
    expect(exportButton().disabled).toBe(false)
    expect(host.textContent).toContain('已导出到本机文件')
  })

  it.each(['用户取消保存', '系统文件写入失败'])('keeps %s visible without a false export receipt', async message => {
    mocks.download.mockRejectedValueOnce(new Error(message))
    await prepareFeedback()
    await act(async () => { exportButton().click() })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(message)
    expect(host.textContent).not.toContain('已导出到本机文件')
    expect(exportButton().disabled).toBe(false)
  })

  it.each(['success', 'failure'])('does not apply a late %s to another session', async result => {
    let finish!: () => void, fail!: (error: Error) => void
    mocks.download.mockImplementationOnce(() => new Promise<void>((resolve, reject) => { finish = resolve; fail = reject }))
    await prepareFeedback()
    await act(async () => { exportButton().click() })
    await render(5)
    await act(async () => { if (result === 'success') finish(); else fail(new Error('旧存档导出失败')) })
    expect(host.textContent).not.toContain('已导出到本机文件')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.querySelector('button')!.disabled).toBe(false)
  })
})
