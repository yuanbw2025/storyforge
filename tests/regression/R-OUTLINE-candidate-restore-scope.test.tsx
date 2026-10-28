import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOutlineGenerationController } from '../../src/components/outline/useOutlineGenerationController'
import { encodeGenerationOperation } from '../../src/lib/outline/generation-request'
import type { OutlineGenerationCandidateV1 } from '../../src/lib/outline/harness'
import type { Project, Work } from '../../src/lib/types'

const restoration = vi.hoisted(() => ({ recover: vi.fn(), candidate: vi.fn() }))
vi.mock('../../src/lib/outline/harness', () => ({
  recoverPendingOutlineGenerationAdoptionsV1: restoration.recover,
  restoreLatestOutlineGenerationCandidateV1: restoration.candidate,
  adoptOutlineGenerationCandidateV1: vi.fn(), createOutlineGenerationTraceV1: vi.fn(),
  rejectOutlineGenerationCandidateV1: vi.fn(), staleOutlineGenerationCandidateV1: vi.fn(),
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

type Options = Parameters<typeof useOutlineGenerationController>[0]
const mounted: Array<{ root: Root; host: HTMLDivElement }> = []
function candidate(workId = 201) {
  return { output: `作品${workId}的原候选`, operation: encodeGenerationOperation({ kind: 'single-volume', volumeId: workId }), scope: { projectId: 1, worldId: 101, workId } } as OutlineGenerationCandidateV1
}
function options(workId = 201): Options {
  return {
    project: { id: 1, activeWorkId: workId, activeWorldId: 101 } as Project,
    work: { id: workId, projectId: 1, worldId: 101 } as Work,
    nodes: [], volumes: [], hint: '', runOptions: {},
    ai: { output: '', operation: null, isStreaming: false, reset: vi.fn(), restore: vi.fn(), setOperation: vi.fn(), start: vi.fn() },
    assembleContext: vi.fn(), openPromptPanel: vi.fn(), clearPreview: vi.fn(), onInfo: vi.fn(), onError: vi.fn(), executionBoundary: 'formal',
  }
}
function Harness({ value }: { value: Options }) {
  const controller = useOutlineGenerationController(value)
  return createElement('div', null, controller.canAdopt ? 'candidate-ready' : 'no-candidate')
}
function mount(value: Options, strict = false) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  const render = (next: Options) => root.render(strict ? createElement(StrictMode, null, createElement(Harness, { value: next })) : createElement(Harness, { value: next }))
  return { render, host, value }
}
beforeEach(() => {
  restoration.recover.mockReset().mockResolvedValue({ recoveredRunIds: [], failed: [] })
  restoration.candidate.mockReset().mockResolvedValue(candidate())
})
afterEach(async () => { for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove() } })

describe('outline candidate hydration uses the mounted Work and survives effect replay', () => {
  it('restores the persisted candidate under StrictMode with one recovery request and no model request', async () => {
    const value = options(); const view = mount(value, true)
    await act(async () => view.render(value))
    expect(value.ai.restore).toHaveBeenCalledTimes(1)
    expect(value.ai.restore).toHaveBeenCalledWith({ output: candidate().output, operation: candidate().operation })
    expect(restoration.recover).toHaveBeenCalledTimes(1)
    expect(value.ai.start).not.toHaveBeenCalled()
    expect(view.host.textContent).toBe('candidate-ready')
  })
  it('a late candidate from another Work cannot enter the current Work even in the same Project', async () => {
    let release!: (value: OutlineGenerationCandidateV1) => void
    const held = new Promise<OutlineGenerationCandidateV1>(resolve => { release = resolve })
    restoration.candidate.mockImplementation((scope: number | { workId: number }) => typeof scope === 'number' || scope.workId === 201 ? held : Promise.resolve(candidate(202)))
    const a = options(201), b = options(202); const view = mount(a)
    await act(async () => view.render(a))
    await act(async () => view.render(b))
    await act(async () => { release(candidate(201)); await held })
    expect(b.ai.restore).toHaveBeenCalledTimes(1)
    expect(b.ai.restore).toHaveBeenCalledWith({ output: candidate(202).output, operation: candidate(202).operation })
    expect(a.ai.restore).not.toHaveBeenCalled()
    expect(restoration.recover).toHaveBeenCalledWith({ projectId: 1, worldId: 101, workId: 202 })
    expect(b.ai.start).not.toHaveBeenCalled()
  })
  it('waits for the actual Work before scheduling recovery instead of consuming its one-shot guard early', async () => {
    const waiting = { ...options(), work: null }; const ready = options(); const view = mount(waiting)
    await act(async () => view.render(waiting))
    expect(restoration.recover).not.toHaveBeenCalled()
    await act(async () => view.render(ready))
    expect(ready.ai.restore).toHaveBeenCalledTimes(1)
    expect(ready.ai.restore).toHaveBeenCalledWith({ output: candidate().output, operation: candidate().operation })
    expect(restoration.recover).toHaveBeenCalledWith({ projectId: 1, worldId: 101, workId: 201 })
  })
})
