import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import WorldviewAgentControls from '../../src/components/worldview/WorldviewAgentControls'
import WorldviewFieldCandidateReview from '../../src/components/worldview/WorldviewFieldCandidateReview'
import { resolveTaskLengthPlanV1 } from '../../src/lib/ai/author-length-intent'
import { observeAuthorLengthV1 } from '../../src/lib/ai/author-length-revision'
import { WORLDVIEW_TEXT_COMPARISON_VERSION_V1 } from '../../src/lib/agent/worldview-text-comparison'
import type { MasterCopilotController, PendingMasterCandidate } from '../../src/components/agent/useMasterCopilot'
import type { Project } from '../../src/lib/types'

// Self-contained 054 integration-recovery compatibility cases. They pin the
// two-direction routing decided in DSH-054-同步冲突授权.json: main V2 keeps its
// own controls/baseline/edit/adopt path and really uses the pinned live
// comparison helper; strict frozen054 identity stays V1-only and never gates
// V2. Model/network/DB writes are all forbidden here.
const baseline = vi.hoisted(() => ({ values: { worldOrigin: '旧稿原文' }, id: 1, ragDocumentId: null, updatedAt: 1, serialized: 'fixture', foundationState: 'partial' }))
const restoreMock = vi.hoisted(() => vi.fn(async () => ({ baseline })))
vi.mock('../../src/lib/agent/run/worldview-field-v2-durable', () => ({ restoreWorldviewFieldMasterV2: restoreMock }))
vi.mock('../../src/components/shared/PromptRunPanel', () => ({ default: () => null }))
vi.mock('../../src/components/agent/HarnessEvidencePanel', () => ({ default: () => null }))
vi.mock('../../src/components/agent/CopilotGenerationStatus', () => ({ default: () => null }))

const reactActGlobal: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
async function render(node: ReactNode) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  await act(async () => root.render(node))
  return { host }
}
async function cleanup() {
  while (mounted.length) { const item = mounted.pop()!; await act(async () => item.root.unmount()); item.host.remove() }
}
async function setValue(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const waitFor = vi.waitFor
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('054 sync compat forbids network/model') })) })
afterEach(async () => { await cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function v2Candidate(): PendingMasterCandidate {
  const plan = resolveTaskLengthPlanV1({ taskKind: 'setting-field', operation: 'expand', intent: null })
  const value = '扩写后的长稿正文。'
  const observation = observeAuthorLengthV1({ plan, text: value, representation: 'plain-text', candidateKind: 'complete-replacement', baseline: { text: '旧稿原文', representation: 'plain-text' } })
  const ref = { artifactKind: 'tool-result' as const, contentHash: 'a'.repeat(64), byteLength: 1 }
  return { event: { id: 11, content: JSON.stringify({ field: 'worldOrigin', value }) }, payload: { version: 1, taskId: 'v2-task', agentId: 'world-origin', skillId: 'world-origin.worldview-field.v2', label: '世界来源', contextSources: [], baseSnapshot: {}, worldviewField: 'worldOrigin', worldviewFieldOperation: 'expand', runId: 1, runGeneration: 1, runStepId: 'v2-step', workspaceScope: { projectId: 1, worldId: 1, workId: 1 }, candidateHash: '1'.repeat(64), worldviewFieldV2: { version: 'worldview-field-candidate-v2', rootRef: ref, draftRef: ref, roundRefs: [], lengthPlan: plan, lengthObservation: observation, disposition: 'ready', reason: '字数自动' } } } as unknown as PendingMasterCandidate
}
function v1Candidate(): PendingMasterCandidate {
  return { event: { id: 21, projectId: 1, workId: 3, conversationId: 4, durableRunId: 5, kind: 'candidate', sequence: 1, payload: '{}', createdAt: 1, content: JSON.stringify({ field: 'worldStructure', value: '候选正文' }) }, payload: { version: 1, taskId: 'v1-task', agentId: 'world-origin', skillId: 'world-origin.worldview-field', label: '世界结构', contextSources: [], worldviewField: 'worldStructure', worldviewFieldOperation: 'expand', workspaceScope: { projectId: 1, worldId: 2, workId: 3 }, runId: 5, runGeneration: 1, runStepId: 'field-step', candidateHash: '1'.repeat(64), baseSnapshot: { id: 9, ragDocumentId: 'fixture', updatedAt: 1, serialized: 'fixed', values: { worldStructure: '原文正文' } } } } as PendingMasterCandidate
}

describe('054 sync recovery: main V2 preserved, frozen V1 isolated', () => {
  it('routes a V2 candidate to the main V2 renderer whose edit path stays callable (not legacy-gated read-only)', async () => {
    const update = vi.fn(), invalid = vi.fn()
    await render(<WorldviewFieldCandidateReview candidate={v2Candidate()} busy={false} onUpdate={update} onInvalidEdit={invalid} />)
    await waitFor(() => expect(document.body.textContent).toMatch(/当前全文/))
    const editor = document.querySelector<HTMLTextAreaElement>('[aria-label="世界来源候选内容"]')!
    expect(editor).toBeTruthy()
    expect(editor.readOnly).toBe(false)
    expect(document.querySelector('.worldview-review-v2')).toBeNull() // strict V1 shell must not wrap the V2 route
    await setValue(editor, '扩写后的长稿正文。作者手改')
    expect(update).toHaveBeenCalledOnce()
    expect(invalid).not.toHaveBeenCalled()
    expect(restoreMock).toHaveBeenCalled() // baseline restore actually requested on the V2 route
  })
  it('keeps the pinned live comparison helper as the real V2 consumer, not a fake reachability entry', async () => {
    await render(<WorldviewFieldCandidateReview candidate={v2Candidate()} busy={false} onUpdate={vi.fn()} />)
    await waitFor(() => expect(document.body.textContent).toMatch(/当前全文/))
    // The V2 renderer renders its conservative comparison card through the
    // live main helper; the frozen worker diff shell is not mounted for V2.
    expect(document.body.textContent).toContain('文本块对照')
    expect(document.body.textContent).toContain(`算法 ${WORLDVIEW_TEXT_COMPARISON_VERSION_V1}`)
    expect(document.querySelector('[data-diff-scroller]')).toBeNull()
  })
  it('routes a strict V1 candidate to the frozen054 V1 renderer whose unknown identity stays read-only', async () => {
    const update = vi.fn(), invalid = vi.fn()
    await render(<WorldviewFieldCandidateReview candidate={v1Candidate()} busy={false} onUpdate={update} onInvalidEdit={invalid} />)
    await waitFor(() => expect(document.body.textContent).toContain('候选归属尚未核实'))
    const editor = document.querySelector<HTMLTextAreaElement>('textarea')!
    expect(editor.readOnly).toBe(true)
    await setValue(editor, '未核实不能写入')
    expect(update).not.toHaveBeenCalled()
    expect(invalid).not.toHaveBeenCalled()
  })
  it('keeps V2 adopt/edit callbacks callable from the parent without the legacy owner lookup, while V1 stays fenced', async () => {
    const copilot = { submitTargetedRequest: vi.fn(async () => undefined), pendingCandidates: [], loading: false, busy: false, error: null, activeTaskLengthPlan: null, activeLengthProgress: null, readVisibleCandidateDraft: () => undefined, stop: vi.fn(), updateCandidate: vi.fn(async () => undefined), rejectCandidate: vi.fn(async () => undefined) } as unknown as MasterCopilotController
    const adopted = vi.fn(async () => undefined)
    const project = { id: 1, enableMultiWorld: false } as Project
    await render(<WorldviewAgentControls field="worldOrigin" project={project} activeGroupId={null} copilot={copilot} candidate={v2Candidate()} hasOtherPendingCandidates={false} onRunningChange={() => undefined} onAdopted={adopted} />)
    const adopt = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === '采纳')!
    expect(adopt.disabled).toBe(false)
    await act(async () => adopt.click())
    expect(adopted).toHaveBeenCalledOnce()
    // The V2 route performs no legacy conversation owner lookup at all.
    expect(document.body.textContent).not.toContain('候选归属尚未核实')
  })
  it('never resurrects the old token-cap length controls on the recovered main branch', async () => {
    const copilot = { submitTargetedRequest: vi.fn(async () => undefined), pendingCandidates: [], loading: false, busy: false, error: null, activeTaskLengthPlan: null, activeLengthProgress: null, readVisibleCandidateDraft: () => undefined, stop: vi.fn() } as unknown as MasterCopilotController
    await render(<WorldviewAgentControls field="worldOrigin" project={{ id: 1, enableMultiWorld: false } as Project} activeGroupId={null} copilot={copilot} hasOtherPendingCandidates={false} onRunningChange={() => undefined} onAdopted={async () => undefined} />)
    expect(document.querySelector('[aria-label="世界基座自定义输出 tokens"]')).toBeNull()
    expect(document.querySelector('[aria-label="篇幅安排"]')).toBeTruthy()
  })
})
