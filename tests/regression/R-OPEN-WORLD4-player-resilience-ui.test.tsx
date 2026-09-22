import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldPlayerErrorBoundary from '../../src/components/text-game/TextOpenWorldPlayerErrorBoundary'
import TextOpenWorldPlayerStateNotice from '../../src/components/text-game/TextOpenWorldPlayerStateNotice'
import { classifyTextOpenWorldPlayerIssueV1 } from '../../src/lib/open-world/player-resilience'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function buttonByText(host: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.trim() === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮:${text}`)
  return button
}

function ThrowingRuntime(): never {
  throw new Error('runtime.private.session-882 / state-hash-deadbeef / sk-player-secret')
}

describe('Text Open World G4-14 · 玩家错误状态与安全回退 UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it('以结构化 alert、状态和诊断码区分可恢复与阻断 notice', async () => {
    const onRecover = vi.fn()
    const onExit = vi.fn()
    const recoverable = classifyTextOpenWorldPlayerIssueV1({
      error: new Error('状态已变化: action.private.secret'),
      surface: 'runtime-operation',
    })
    const blocking = classifyTextOpenWorldPlayerIssueV1({
      error: new Error('状态hash不一致: runtime.private.hash'),
      surface: 'runtime-operation',
    })
    if (!recoverable || !blocking) throw new Error('测试错误必须被分类')

    await act(async () => root.render(createElement(TextOpenWorldPlayerStateNotice, {
      issue: recoverable,
      primaryLabel: '重新核对当前存档',
      onPrimary: onRecover,
    })))

    const recoverableNotice = host.querySelector<HTMLElement>('[data-testid="text-open-world-player-state-notice"]')!
    const recoverableTitleId = recoverableNotice.getAttribute('aria-labelledby')!
    expect(recoverableNotice.getAttribute('role')).toBe('alert')
    expect(recoverableNotice.dataset.playerState).toBe('recoverable-error')
    expect(recoverableNotice.dataset.diagnosticCode).toBe('TOW-PLAYER-STALE')
    expect(document.getElementById(recoverableTitleId)?.textContent).toBe(recoverable.title)
    expect(recoverableNotice.textContent).toContain(recoverable.message)
    expect(recoverableNotice.textContent).toContain(recoverable.guidance)
    expect(recoverableNotice.textContent).toContain('诊断码 TOW-PLAYER-STALE')
    expect(recoverableNotice.textContent).not.toContain('action.private.secret')
    await act(async () => buttonByText(host, '重新核对当前存档').click())
    expect(onRecover).toHaveBeenCalledTimes(1)

    await act(async () => root.render(createElement(TextOpenWorldPlayerStateNotice, {
      issue: blocking,
      primaryLabel: '重新核对存档',
      onPrimary: onRecover,
      secondaryLabel: '返回游戏库',
      onSecondary: onExit,
    })))

    const blockingNotice = host.querySelector<HTMLElement>('[data-testid="text-open-world-player-state-notice"]')!
    const blockingTitleId = blockingNotice.getAttribute('aria-labelledby')!
    expect(blockingNotice.getAttribute('role')).toBe('alert')
    expect(blockingNotice.dataset.playerState).toBe('blocking-error')
    expect(blockingNotice.dataset.diagnosticCode).toBe('TOW-PLAYER-INTEGRITY')
    expect(document.getElementById(blockingTitleId)?.textContent).toBe(blocking.title)
    expect(blockingNotice.textContent).toContain(blocking.message)
    expect(blockingNotice.textContent).toContain(blocking.guidance)
    expect(blockingNotice.textContent).toContain('诊断码 TOW-PLAYER-INTEGRITY')
    expect(blockingNotice.textContent).not.toContain('runtime.private.hash')
    await act(async () => buttonByText(host, '返回游戏库').click())
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('ErrorBoundary 只显示安全阻断回退，可执行恢复与退出并随 resetKey 复位', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onRecover = vi.fn()
    const onExit = vi.fn()

    await act(async () => root.render(createElement(TextOpenWorldPlayerErrorBoundary, {
      resetKey: 'session-a:1',
      onRecover,
      onExit,
      children: createElement(ThrowingRuntime),
    })))

    const fallback = host.querySelector<HTMLElement>('[data-testid="text-open-world-runtime-render-blocking"]')!
    const notice = fallback.querySelector<HTMLElement>('[data-testid="text-open-world-player-state-notice"]')!
    expect(fallback).toBeTruthy()
    expect(notice.getAttribute('role')).toBe('alert')
    expect(notice.dataset.playerState).toBe('blocking-error')
    expect(notice.dataset.diagnosticCode).toBe('TOW-PLAYER-INTEGRITY')
    expect(notice.textContent).toContain('这个存档暂时不能运行')
    expect(notice.textContent).toContain('播放器不会猜测或改写这份存档')
    expect(host.textContent).not.toMatch(/runtime\.private|state-hash-deadbeef|sk-player-secret/)
    expect(host.innerHTML).not.toMatch(/runtime\.private|state-hash-deadbeef|sk-player-secret/)
    expect(JSON.stringify(consoleError.mock.calls))
      .not.toMatch(/runtime\.private|state-hash-deadbeef|sk-player-secret/)

    await act(async () => buttonByText(host, '重新核对存档').click())
    await act(async () => buttonByText(host, '返回游戏库').click())
    expect(onRecover).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.render(createElement(TextOpenWorldPlayerErrorBoundary, {
        resetKey: 'session-a:2',
        onRecover,
        onExit,
        children: createElement('p', { 'data-testid': 'recovered-runtime' }, '已重新核对并恢复'),
      }))
      await Promise.resolve()
    })
    expect(host.querySelector('[data-testid="text-open-world-runtime-render-blocking"]')).toBeNull()
    expect(host.querySelector('[data-testid="recovered-runtime"]')?.textContent).toBe('已重新核对并恢复')
  })
})
