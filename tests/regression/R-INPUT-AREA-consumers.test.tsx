import { act, type ComponentProps, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HistoryOverviewTab from '../../src/components/history/HistoryOverviewTab'
import HistoryKeywordCard from '../../src/components/history/HistoryKeywordCard'
import HistoryTimelineEventCard from '../../src/components/history/HistoryTimelineEventCard'
import WorldRuleEntryEditor from '../../src/components/worldview/WorldRuleEntryEditor'
import WorldviewFieldCandidateReview, { worldviewReviewSessionKeyV1, type WorldviewReviewViewV1 } from '../../src/components/worldview/WorldviewFieldCandidateReview'
import CandidateDraftEditor from '../../src/components/agent/CandidateDraftEditor'
import { inputAreaLayoutV1, worldviewInputAreaFieldV1 } from '../../src/lib/input-area-layout'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
async function mount(element: ReactNode) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  await act(async () => root.render(<>{element}<button data-outside type="button">外部</button></>))
  return { host, root }
}
afterEach(async () => {
  for (const item of mounted.splice(0)) { await act(async () => item.root.unmount()); item.host.remove() }
  localStorage.clear(); vi.restoreAllMocks()
})
async function edit(area: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function resize(host: HTMLElement) {
  const frame = host.querySelector<HTMLElement>('[data-input-area-layout]')!
  Object.defineProperty(frame, 'clientWidth', { configurable: true, value: 600 })
  frame.getBoundingClientRect = () => new DOMRect(0, 0, 600, 200)
  await act(async () => window.dispatchEvent(new Event('resize')))
  const handle = frame.querySelector<HTMLButtonElement>('[aria-label="调整输入区大小"]')!
  await act(async () => { handle.focus(); handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); handle.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true })) })
  return { frame, handle }
}
let nextCandidateId = 27000
function syntheticView(candidate: any): WorldviewReviewViewV1 {
  const identity = { projectId: 1, worldId: 2, workId: 3, worldGroupId: null, field: candidate.payload.worldviewField, eventId: candidate.event.id, conversationId: 4, taskId: candidate.payload.taskId, runId: 5, runStepId: 'worldview-test', runGeneration: 1, skillId: 'world-origin.worldview-field' }
  return { ...identity, version: 'worldview-review-view-v1', status: 'verified', generation: 1, sessionKey: worldviewReviewSessionKeyV1(identity) }
}
async function editMode(host: HTMLElement) { const button = [...host.querySelectorAll('button')].find(item => item.textContent === '编辑候选'); if (button) await act(async () => button.click()) }
function pending(operation: 'create' | 'expand' | 'rewrite' | 'polish', value: unknown = '完整候选正文') {
  const id = ++nextCandidateId
  return {
    event: { id, projectId: 1, workId: 3, conversationId: 4, durableRunId: 5, kind: 'candidate', content: JSON.stringify({ field: typeof value === 'string' ? 'races' : 'divineDesign', value }) },
    payload: { taskId: `synthetic-${id}`, skillId: 'world-origin.worldview-field', workspaceScope: { projectId: 1, worldId: 2, workId: 3 }, runId: 5, runStepId: 'worldview-test', runGeneration: 1, label: '种族与民族', worldviewField: typeof value === 'string' ? 'races' : 'divineDesign', worldviewFieldOperation: operation, baseSnapshot: { values: { races: '前版正文' } } },
  } as ComponentProps<typeof WorldviewFieldCandidateReview>['candidate']
}
const lane = { candidate: null, runId: null, busy: false, message: null, unsafeRunId: null, adoptionPending: false }
function cardProps() {
  return { chapters: [], expanded: true, canEdit: false, consultActive: false, stormActive: false, consultAI: lane, stormAI: lane,
    onToggle: vi.fn(), onChange: vi.fn(), onConsult: vi.fn(), onStorm: vi.fn(), onDelete: vi.fn(), onAcceptConsult: vi.fn(), onAcceptStorm: vi.fn(), onRejectConsult: vi.fn(), onRejectStorm: vi.fn(), onRetryConsult: vi.fn(), onRetryStorm: vi.fn() }
}

describe('047 actual consumers keep their content authority', () => {
  it('requires explicit opt-in; finite aliases neither grant admission nor include author ids/text', () => {
    expect(inputAreaLayoutV1(false, 'world.origin')).toBeUndefined()
    expect(inputAreaLayoutV1(undefined, 'world.origin')).toBeUndefined()
    expect(worldviewInputAreaFieldV1('constructor')).toBeUndefined()
    expect(worldviewInputAreaFieldV1('作者文本/作品-123')).toBeUndefined()
    expect(inputAreaLayoutV1(true, worldviewInputAreaFieldV1('作者文本/作品-123'))).toEqual({ enabled: true })
    expect(inputAreaLayoutV1(true, worldviewInputAreaFieldV1('rareCreatures'))).toEqual({ enabled: true, preferenceKey: 'world.creatures/current' })
  })
  it('history overview saves only on true leave, preserving its original change and blur callbacks', async () => {
    const change = vi.fn(), save = vi.fn(), eraSave = vi.fn()
    const ui = await mount(<HistoryOverviewTab resizableInputs overview="旧总述" eraSystem="纪年" onOverviewChange={change} onEraSystemChange={vi.fn()} onSaveOverview={save} onSaveEraSystem={eraSave} />)
    const area = ui.host.querySelector('textarea')!
    await edit(area, '作者总述')
    expect(change).toHaveBeenCalledExactlyOnceWith('作者总述')
    await act(async () => area.focus())
    const { frame } = await resize(ui.host)
    expect(save).not.toHaveBeenCalled(); expect(change).toHaveBeenCalledOnce()
    await act(async () => frame.querySelectorAll<HTMLButtonElement>('button')[0].click())
    expect(save).not.toHaveBeenCalled()
    await act(async () => ui.host.querySelector<HTMLButtonElement>('[data-outside]')!.focus())
    expect(save).toHaveBeenCalledOnce(); expect(eraSave).not.toHaveBeenCalled()
  })
  it('history 4 keyword and 5 timeline fields keep their exact callbacks and AI permissions', async () => {
    const keyword = { projectId: 1, keyword: '盐路', era: 'custom', category: 'economy' as const, description: '定稿', createdAt: 1, updatedAt: 1 }
    const event = { projectId: 1, title: '启航', era: 'custom', year: 1, date: '元年', description: '事件定稿', isHistorical: false, createdAt: 1, updatedAt: 1 }
    const kp = cardProps(), ep = cardProps()
    for (const [element, props, fields] of [
      [<HistoryKeywordCard {...kp} keyword={keyword} resizableInputs />, kp, ['description', 'conceptNote', 'consultPrompt', 'stormPrompt']],
      [<HistoryTimelineEventCard {...ep} event={event} resizableInputs />, ep, ['description', 'impact', 'conceptNote', 'consultPrompt', 'stormPrompt']],
    ] as const) {
      const ui = await mount(element)
      expect(ui.host.querySelectorAll('[data-input-area-layout]')).toHaveLength(fields.length)
      await resize(ui.host)
      expect(props.onChange).not.toHaveBeenCalled()
      const areas = ui.host.querySelectorAll('textarea')
      for (let i = 0; i < fields.length; i++) {
        await edit(areas[i], `内容-${i}`)
        expect(props.onChange).toHaveBeenLastCalledWith({ [fields[i]]: `内容-${i}` })
      }
      const consult = [...ui.host.querySelectorAll('button')].find(button => button.textContent?.includes('AI 历史考据'))!
      expect(consult.disabled).toBe(true); expect(props.onConsult).not.toHaveBeenCalled()
    }
  })
  it('collapsed or default-off history cards do not mount resizing controls', async () => {
    const props = cardProps(), keyword = { projectId: 1, keyword: '盐路', era: 'custom', category: 'economy' as const, description: '', createdAt: 1, updatedAt: 1 }
    for (const element of [<HistoryKeywordCard {...props} keyword={keyword} />, <HistoryKeywordCard {...props} keyword={keyword} expanded={false} resizableInputs />]) {
      const ui = await mount(element)
      expect(ui.host.querySelector('[data-input-area-layout]')).toBeNull()
    }
  })
  it.each(['create', 'expand', 'rewrite', 'polish'] as const)('keeps %s worldview candidate editing, original readonly state, and capture guards', async operation => {
    const candidate = pending(operation), update = vi.fn(), invalid = vi.fn(), snapshot = JSON.stringify(candidate)
    const ui = await mount(<WorldviewFieldCandidateReview candidate={candidate} viewBinding={syntheticView(candidate)} busy={false} onUpdate={update} onInvalidEdit={invalid} resizableInputs />)
    await editMode(ui.host)
    const editor = ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="种族与民族候选内容"]')!
    const original = ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="种族与民族原文"]')
    if (original) expect(original.readOnly).toBe(true)
    await resize(ui.host)
    expect(update).not.toHaveBeenCalled(); expect(invalid).not.toHaveBeenCalled(); expect(JSON.stringify(candidate)).toBe(snapshot)
    await act(async () => editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    expect(invalid).toHaveBeenCalledWith(editor.value, expect.stringContaining('组合输入'))
    await act(async () => editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
    update.mockClear() // The existing composition-end path acknowledges its visible value.
    await edit(editor, '作者修改候选')
    expect(update).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ field: 'races', value: '作者修改候选' }, null, 2), '作者修改候选')
  })
  it('preserves actual candidate ref and busy controls with one shared comparison scroller', async () => {
    const candidate = pending('expand'), update = vi.fn()
    const ui = await mount(<WorldviewFieldCandidateReview candidate={candidate} viewBinding={syntheticView(candidate)} busy onUpdate={update} resizableInputs />)
    const right = ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="种族与民族候选内容"]')!
    expect(right.disabled).toBe(true)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    const scroller = ui.host.querySelector<HTMLElement>('[data-diff-scroller]')!
    expect(scroller).not.toBeNull(); expect(ui.host.querySelectorAll('[data-diff-scroller]')).toHaveLength(1)
    expect(ui.host.querySelector('textarea[aria-label="种族与民族原文"]')).toBeNull()
    await resize(ui.host)
    await act(async () => { scroller.scrollTop = 400; scroller.dispatchEvent(new Event('scroll', { bubbles: true })) })
    expect(scroller.scrollTop).toBe(400); expect(update).not.toHaveBeenCalled(); expect(right.disabled).toBe(true)
  })
  it('uses finite json/raw aliases without bypassing invalid candidate guards', async () => {
    const update = vi.fn(), invalid = vi.fn(), candidate = pending('create', { hasDivinity: false, divineRank: '', divineNames: '', divineRules: '' })
    const json = await mount(<WorldviewFieldCandidateReview candidate={candidate} viewBinding={syntheticView(candidate)} busy={false} onUpdate={update} onInvalidEdit={invalid} resizableInputs />)
    expect(json.host.querySelector('[data-input-area-layout]')!.getAttribute('data-input-area-layout')).toBe('world.divine/json')
    await edit(json.host.querySelector('textarea')!, '{')
    expect(update).not.toHaveBeenCalled(); expect(invalid).toHaveBeenCalledWith('{', expect.stringContaining('JSON'))
    candidate.event.content = '历史损坏候选'
    candidate.event.id = ++nextCandidateId; candidate.payload.taskId = `synthetic-${candidate.event.id}` // independent historical raw fixture
    const raw = await mount(<WorldviewFieldCandidateReview candidate={candidate} viewBinding={syntheticView(candidate)} busy={false} onUpdate={update} onInvalidEdit={invalid} resizableInputs />)
    expect(raw.host.querySelector('[data-input-area-layout]')!.getAttribute('data-input-area-layout')).toBe('world.divine/raw')
  })
  it('does not infer StoryCore admission from skillId and keeps the exact serialized content edit', async () => {
    const payload = { skillId: 'world-origin.story-core', storyCoreField: 'theme', label: '主题' } as ComponentProps<typeof CandidateDraftEditor>['payload']
    const change = vi.fn(), value = JSON.stringify({ field: 'theme', value: '旧主题' })
    const off = await mount(<CandidateDraftEditor payload={payload} value={value} disabled={false} onChange={change} inputAreaField="story.theme" />)
    expect(off.host.querySelector('[data-input-area-layout]')).toBeNull()
    const on = await mount(<CandidateDraftEditor payload={payload} value={value} disabled={false} onChange={change} inputAreaField="story.theme" resizableInputs />)
    await resize(on.host); expect(change).not.toHaveBeenCalled()
    await edit(on.host.querySelector('textarea')!, '新主题')
    expect(JSON.parse(change.mock.calls[0][0])).toEqual({ field: 'theme', value: '新主题' })
    await act(async () => [...on.host.querySelectorAll('button')].find(button => button.textContent === '查看原始结构')!.click())
    expect(on.host.querySelector('[data-input-area-layout]')!.getAttribute('data-input-area-layout')).toBe('story.theme/raw')
  })
  it('retains the native rule entry callbacks, values and default DOM', async () => {
    const props = { selectedNode: 'government', currentLabel: '官制', currentHints: [], currentEntry: { historicalAnchors: '原型', fictionalAdaptations: '架空', priority: 'balanced' as const }, isCustomNode: false, onFieldChange: vi.fn(), onDeleteNode: vi.fn(), onClearEntry: vi.fn() }
    const off = await mount(<WorldRuleEntryEditor {...props} />)
    expect(off.host.querySelector('[data-input-area-layout]')).toBeNull()
    const on = await mount(<WorldRuleEntryEditor {...props} resizableInputs />)
    expect(on.host.querySelectorAll('[data-input-area-layout]')).toHaveLength(2)
    await resize(on.host); expect(props.onFieldChange).not.toHaveBeenCalled()
    const areas = on.host.querySelectorAll('textarea')
    await edit(areas[0], '作者考据'); await edit(areas[1], '作者架空')
    expect(props.onFieldChange.mock.calls).toEqual([['historicalAnchors', '作者考据'], ['fictionalAdaptations', '作者架空']])
  })
})
