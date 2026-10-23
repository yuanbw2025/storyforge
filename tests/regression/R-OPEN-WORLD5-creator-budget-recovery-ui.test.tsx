import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TextOpenWorldBudgetRecovery from '../../src/components/text-game/TextOpenWorldBudgetRecovery'

const api = vi.hoisted(() => ({ preview: vi.fn(), authorize: vi.fn() }))
vi.mock('../../src/lib/product-production/service', () => ({
  previewTextOpenWorldCreatorBudgetRecoveryV1: api.preview,
  authorizeTextOpenWorldCreatorBudgetRecoveryV1: api.authorize,
}))
const props = { scope: { projectId: 1, worldId: 1, workId: 1 }, productionId: 2, buildId: 6,
  disabled: false, onAuthorized: vi.fn(async () => {}) }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
function button(name: string) { return [...host.querySelectorAll('button')].find(row => row.textContent === name) }
async function render(disabled = false) { await act(async () => root.render(<TextOpenWorldBudgetRecovery {...props} disabled={disabled} />)) }
async function click(name: string) { await act(async () => button(name)!.click()) }

it('requires a verified preview before the explicit author command, showing bounded future reservations', async () => {
  const prepared = { reuseTaskKeys: ['p0', 'p1'], targetPlan: { tasks: [
    { reuse: {}, budgetReservation: { modelCalls: 100, maximumCostUsd: 50 } },
    { reuse: null, budgetReservation: { modelCalls: 2, maximumCostUsd: 0.5 } },
  ] } }
  api.preview.mockResolvedValue(prepared)
  api.authorize.mockResolvedValue({ ok: true })
  await render()
  expect(button('确认续建并创建新 Build')).toBeUndefined()
  await click('复验成果并预览续建')
  expect(button('确认续建并创建新 Build')).toBeDefined()
  expect(api.authorize).not.toHaveBeenCalled()
  expect(host.textContent).toContain('最多 2 次模型调用；费用上界 $0.50')
  await click('确认续建并创建新 Build')
  expect(props.onAuthorized).toHaveBeenCalledTimes(1)
  expect(api.authorize).toHaveBeenCalledWith({ prepared })
})

it('keeps a failed proof non-actionable and exposes its actual error', async () => {
  api.preview.mockRejectedValue(new Error('父级产物缺少完整 sibling'))
  await render()
  await click('复验成果并预览续建')
  expect(host.querySelector('[role=alert]')!.textContent).toContain('父级产物缺少完整 sibling')
  expect(button('确认续建并创建新 Build')).toBeUndefined()
  expect(api.authorize).not.toHaveBeenCalled()
})

it('does not allow a second operation while parent production is active', async () => {
  await render(true)
  expect(button('复验成果并预览续建')!.disabled).toBe(true)
})
