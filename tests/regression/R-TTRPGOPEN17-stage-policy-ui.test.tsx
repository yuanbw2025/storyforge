import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import TtrpgOpenAuthoringEditor from '../../src/components/ttrpg/TtrpgOpenAuthoringEditor'
import TtrpgOpenBriefReview from '../../src/components/ttrpg/TtrpgOpenBriefReview'
import { defaultTtrpgSettingsV2 } from '../../src/lib/ttrpg/authoring-contract-v2'
import { initializeTtrpgOpenAuthoringPoliciesV1 } from '../../src/lib/ttrpg/open-authoring-edit'
import type { ProductProductionBriefV3 } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
describe('R-TTRPGOPEN17 author stage policy controls and frozen review', () => {
  let root: Root, host: HTMLDivElement
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  function settings() {
    const s = defaultTtrpgSettingsV2('open')
    if (s.runFormat !== 'open') throw Error('fixture format')
    s.openAuthoring = initializeTtrpgOpenAuthoringPoliciesV1(s.openAuthoring)
    return s
  }
  it('edits the explicit turn trigger without altering its separate maximum or the original draft object', async () => {
    const s = settings(), before = structuredClone(s.openAuthoring), changed = vi.fn()
    await act(async () => root.render(createElement(TtrpgOpenAuthoringEditor, { value: s.openAuthoring, onChange: changed })))
    const label = [...host.querySelectorAll('label')].find(l => l.textContent?.includes('允许收束的世界回合'))!
    const input = label.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '5')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(changed).toHaveBeenCalledOnce()
    expect(changed.mock.calls[0][0].stageClosurePolicy.triggers[0].predicate).toEqual({ op: 'world-turn-at-least', value: 5 })
    expect(changed.mock.calls[0][0].stageClosurePolicy.maximumWorldTurns).toBe(before.stageClosurePolicy!.maximumWorldTurns)
    expect(s.openAuthoring).toEqual(before)
  })
  it('shows the actual frozen trigger separately from the maximum and never invokes production by reading it', async () => {
    const s = settings()
    s.openAuthoring.stageClosurePolicy!.triggers[0] = { triggerKey: 'review.five', predicate: { op: 'world-turn-at-least', value: 5 }, summaryPrompt: '保留尚未解决的事项' }
    const brief = { ttrpgOpen: { settings: s, worldReference: { releaseVersion: 2 }, rulePack: { interactionBindings: [] } },
      productionBudget: { maximumModelCalls: 3, maximumInputTokens: 1000, maximumOutputTokens: 500, maximumCostUsd: null } } as unknown as ProductProductionBriefV3
    const start = vi.fn()
    await act(async () => root.render(createElement(TtrpgOpenBriefReview, { brief, started: false, onProduction: start })))
    expect(host.textContent).toContain('达到第 5 个世界回合'); expect(host.textContent).toContain('保留尚未解决的事项')
    expect(host.textContent).toContain('单局最多 50 个世界轮次')
    expect(start).not.toHaveBeenCalled()
  })
})
