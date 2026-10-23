import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TextOpenWorldPausedTaskRevision from '../../src/components/text-game/TextOpenWorldPausedTaskRevision'
import type { WorkspaceScope } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { listTargets } = vi.hoisted(() => ({ listTargets: vi.fn() }))
vi.mock('../../src/lib/open-world/production-content-revision', () => ({
  listTextOpenWorldPausedRevisionTargetsV1: listTargets,
}))
const scope = { projectId: 1, worldId: 1, workId: 1 } as WorkspaceScope
const target = { taskKey: 'p4.region-skeleton', expectedPlanHash: 'a'.repeat(64), expectedControlEpoch: 4,
  expectedArtifacts: [{ artifactKey: 'text-open-world.region-skeleton', version: 1, contentHash: 'b'.repeat(64) }] }
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  listTargets.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('drops an old Production readback that arrives after switching to another work', async () => {
  let finishOld!: (rows: typeof target[]) => void
  listTargets.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    .mockResolvedValueOnce([])
  const submit = vi.fn()
  await act(async () => root.render(<TextOpenWorldPausedTaskRevision scope={scope} productionId={1} controlEpoch={5} busy={false} onSubmit={submit} />))
  await act(async () => root.render(<TextOpenWorldPausedTaskRevision scope={{ ...scope, workId: 2 }} productionId={2} controlEpoch={1} busy={false} onSubmit={submit} />))
  await act(async () => finishOld([target]))
  expect(host.textContent).toContain('当前没有可选择的已签收任务')
  expect(host.querySelector('select')).toBeNull()
  expect(submit).not.toHaveBeenCalled()
})

it('clears unsent author JSON and selection when the control epoch changes', async () => {
  listTargets.mockResolvedValue([target])
  const submit = vi.fn()
  const render = (epoch: number) => root.render(<TextOpenWorldPausedTaskRevision scope={scope} productionId={1} controlEpoch={epoch} busy={false} onSubmit={submit} />)
  await act(async () => render(5))
  const select = host.querySelector('select')!
  await act(async () => { select.value = target.taskKey; select.dispatchEvent(new Event('change', { bubbles: true })) })
  const textareas = host.querySelectorAll('textarea')
  for (const [i, value] of ['来源纠错', '{"privateDraft":true}'].entries()) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textareas[i], value)
      textareas[i].dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  expect(host.querySelectorAll('textarea')).toHaveLength(2)
  await act(async () => render(6))
  expect(host.querySelector('select')!.value).toBe('')
  expect(host.querySelector('textarea')).toBeNull()
  expect(host.textContent).not.toContain('privateDraft')
  expect(submit).not.toHaveBeenCalled()
})
