import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { TextOpenWorldResponsibilityProgressV1 } from '../../src/lib/open-world/responsibility-progress'

const read = vi.hoisted(() => vi.fn())
vi.mock('../../src/lib/open-world/responsibility-workspace', () => ({
  readTextOpenWorldResponsibilityWorkspaceV1: read,
}))
import TextOpenWorldResponsibilityOverview from '../../src/components/text-game/TextOpenWorldResponsibilityOverview'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
const root = createRoot(host)
afterEach(async () => { await act(async () => root.render(null)); read.mockReset() })

it('责任线刷新只保留最新 Build，旧失败不覆盖新状态', async () => {
  let rejectOld!: (error: Error) => void
  let resolveNew!: (value: TextOpenWorldResponsibilityProgressV1) => void
  read.mockReturnValueOnce(new Promise((_, reject) => { rejectOld = reject }))
    .mockReturnValueOnce(new Promise(resolve => { resolveNew = resolve }))
  const scope = { projectId: 1, worldId: 2, workId: 3 }
  const render = (buildId: number, refreshToken: string) => act(async () => {
    root.render(createElement(TextOpenWorldResponsibilityOverview, {
      scope, productionId: 4, buildId, refreshToken,
      onInspectArtifact: () => {}, onInspectTask: () => {},
    }))
  })
  await render(5, 'first')
  for (let index = 0; index < 20; index += 1) await render(6, String(index))
  expect(read).toHaveBeenCalledTimes(1)
  await act(async () => rejectOld(new Error('旧 Build 的错误')))
  expect(read).toHaveBeenCalledTimes(2)
  expect(read).toHaveBeenLastCalledWith({ scope, productionId: 4, buildId: 6 })
  expect(host.textContent).not.toContain('旧 Build 的错误')
  await act(async () => resolveNew({
    build: { buildNumber: 6 }, readyForAssembly: false, tracks: [], assemblyTasks: [],
  } as unknown as TextOpenWorldResponsibilityProgressV1))
  expect(host.textContent).toContain('Build #6')
})

it('卸载清除排队读取', async () => {
  let resolveOld!: (value: TextOpenWorldResponsibilityProgressV1) => void
  read.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
  const props = {
    scope: { projectId: 1, worldId: 2, workId: 3 }, productionId: 4, buildId: 5,
    refreshToken: 'first', onInspectArtifact: () => {}, onInspectTask: () => {},
  }
  await act(async () => root.render(createElement(TextOpenWorldResponsibilityOverview, props)))
  await act(async () => root.render(createElement(TextOpenWorldResponsibilityOverview, {
    ...props, refreshToken: 'queued',
  })))
  await act(async () => root.render(null))
  await act(async () => resolveOld({
    build: { buildNumber: 5 }, readyForAssembly: false, tracks: [], assemblyTasks: [],
  } as unknown as TextOpenWorldResponsibilityProgressV1))
  expect(read).toHaveBeenCalledTimes(1)
  expect(host.textContent).toBe('')
})
