import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TtrpgSessionPage from '../../src/pages/TtrpgSessionPage'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ session: vi.fn(), state: vi.fn(), checkpoints: vi.fn(), verify: vi.fn(), branch: vi.fn() }))
vi.mock('../../src/lib/db/schema', () => ({ db: {
  productRuntimeSessions: { get: mocks.session },
  productRuntimeCheckpoints: { where: () => ({ equals: () => ({ toArray: mocks.checkpoints }) }) },
} }))
vi.mock('../../src/lib/workspace/scope', () => ({ resolveScope: async (input: { scope: unknown }) => input.scope }))
vi.mock('../../src/lib/ttrpg/runtime-api', () => ({ readProductRuntimeState: mocks.state,
  verifyProductRuntimeCheckpoint: mocks.verify, branchProductRuntimeSession: mocks.branch, createProductRuntimeCheckpoint: vi.fn() }))
vi.mock('../../src/components/ttrpg/TtrpgPlayTable', () => ({ default: (props: { session: { id: number; title: string }; onBusyChange: (busy: boolean) => void }) =>
  <section data-testid="table" data-session={props.session.id}><p>{props.session.title}</p>
    <button onClick={() => props.onBusyChange(true)}>模拟主持开始</button><button onClick={() => props.onBusyChange(false)}>模拟主持结束</button></section> }))

const session = (id: number) => ({ id, title: `冒险 ${id}`, kind: 'ttrpg', projectId: id, worldId: id, workId: id })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }
let root: Root, host: HTMLDivElement
async function open(path = '/play/session/1') {
  const router = createMemoryRouter([{ path: '/play/session/:sessionId', element: <TtrpgSessionPage /> }], { initialEntries: [path] })
  await act(async () => root.render(<RouterProvider router={router} />))
  return router
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(button => button.textContent?.includes(text))!
  expect(button).toBeTruthy()
  await act(async () => button.click())
}
beforeEach(() => {
  vi.resetAllMocks()
  host = document.createElement('div'); root = createRoot(host)
  mocks.session.mockImplementation(async id => session(id))
  mocks.state.mockResolvedValue({ lastSequence: 0 })
  mocks.checkpoints.mockResolvedValue([{ id: 10, name: '离港之前', throughSequence: 0, createdAt: 1 }])
  mocks.verify.mockResolvedValue(true)
  mocks.branch.mockResolvedValue({ id: 2 })
})
afterEach(async () => { await act(async () => root.unmount()) })

describe('R-TTRPG4H · session route and checkpoint recovery', () => {
  it('已打开的桌面在路由切换时立即移除，较慢的新存档读取不会借用旧桌面', async () => {
    const router = await open()
    expect(host.querySelector('[data-session="1"]')).not.toBeNull()
    const slow = deferred<ReturnType<typeof session>>()
    mocks.session.mockImplementation(id => id === 2 ? slow.promise : Promise.resolve(session(id)))
    await act(async () => { await router.navigate('/play/session/2') })
    expect(host.querySelector('[data-testid="table"]')).toBeNull()
    expect(host.textContent).toContain('正在恢复你的冒险')
    await act(async () => slow.resolve(session(2)))
    expect(host.querySelector('[data-session="2"]')).not.toBeNull()
    expect(host.textContent).not.toContain('冒险 1')
  })
  it('旧读取晚到不会覆盖新路由，错误地址也不会污染后续有效存档', async () => {
    const slow = deferred<ReturnType<typeof session>>()
    mocks.session.mockImplementation(id => id === 1 ? slow.promise : Promise.resolve(session(id)))
    const router = await open()
    await act(async () => { await router.navigate('/play/session/2') })
    await act(async () => slow.resolve(session(1)))
    expect(host.querySelector('[data-session="2"]')).not.toBeNull()
    await act(async () => { await router.navigate('/play/session/not-a-number') })
    expect(host.textContent).toContain('存档地址无效')
    await act(async () => { await router.navigate('/play/session/2') })
    expect(host.textContent).not.toContain('存档地址无效')
    expect(host.querySelector('[data-session="2"]')).not.toBeNull()
  })
  it('坏检查点不隐藏当前桌面、不创建分支，修复后可在本页重试', async () => {
    await open()
    mocks.verify.mockResolvedValueOnce(false)
    await click('离港之前')
    expect(host.textContent).toContain('存档校验失败')
    expect(host.querySelector('[data-session="1"]')).not.toBeNull()
    expect(mocks.branch).not.toHaveBeenCalled()
    await click('返回当前冒险')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    await click('离港之前')
    expect(mocks.branch).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-session="2"]')).not.toBeNull()
  })
  it('主持期间禁用读取；恢复请求在途时桌面禁用，连点只创建一个分支', async () => {
    await open()
    await click('模拟主持开始')
    const checkpoint = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('离港之前'))!
    expect(checkpoint.disabled).toBe(true)
    await click('模拟主持结束')
    const pending = deferred<boolean>()
    mocks.verify.mockReturnValue(pending.promise)
    await act(async () => { checkpoint.click(); checkpoint.click() })
    expect(mocks.verify).toHaveBeenCalledTimes(1)
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    await act(async () => pending.resolve(true))
    expect(mocks.branch).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-session="2"]')).not.toBeNull()
  })
})
