import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InlineInput, InlineTextarea } from '../../src/components/shared/InlineEdit'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
afterEach(async () => {
  while (mounted.length) { const item = mounted.pop()!; await act(async () => item.root.unmount()); item.host.remove() }
  resetPendingEditCoordinatorForTestsV1()
})
describe.each([['input', InlineInput], ['textarea', InlineTextarea]] as const)('invalid persisted author text: %s', (_name, Component) => {
  it.each([{ stale: '完整原值保留' }, ['完整原值保留'], 123, false])('contains malformed field %j without a render crash or an automatic write', async original => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host); mounted.push({ host, root })
    const save = vi.fn()
    const originalJson = JSON.stringify(original, null, 2)
    await act(async () => { root.render(<Component value={original as unknown as string} onChange={save} />) })
    expect(host.querySelector('[role=alert]')?.textContent).toContain('格式')
    expect(host.textContent).toContain(originalJson)
    expect(save).not.toHaveBeenCalled()
    expect(JSON.stringify(original, null, 2)).toBe(originalJson)
  })
})
