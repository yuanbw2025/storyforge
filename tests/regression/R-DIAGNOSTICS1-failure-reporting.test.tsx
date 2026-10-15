import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let container: HTMLDivElement | undefined
import FailureFeedbackPanel from '../../src/components/shared/FailureFeedbackPanel'
import ErrorBoundary from '../../src/components/shared/ErrorBoundary'
import TextOpenWorldPlayerErrorBoundary from '../../src/components/text-game/TextOpenWorldPlayerErrorBoundary'
import { recordRuntimeDiagnosticError, readRuntimeDiagnosticErrors, resetRuntimeDiagnostics, RUNTIME_DIAGNOSTICS_KEY } from '../../src/lib/diagnostics/runtime-errors'
import { failureFeedbackLink, readFailureHandoff, parseFailureSummary } from '../../src/lib/diagnostics/failure-summary'
import { buildFailureSummary } from '../../src/lib/diagnostics/build-failure-summary'
import { APP_BUILD_ID } from '../../src/lib/version'

afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); root = undefined; container = undefined; resetRuntimeDiagnostics(); vi.restoreAllMocks() })

describe('local failure reporting privacy and explicit handoff', () => {
  it('retains errors across reload, excluding messages, keys, hosts, query strings, and disk paths', async () => {
    const error = new TypeError('SECRET manuscript and sk-private-key')
    error.stack = 'TypeError: SECRET\n at secretFunction (http://localhost:1111/storyforge/assets/index-abc.js:24:9)\n at Object.eval (/Users/private/SECRET.js:5:2)\n at https://provider.example/request?api_key=SECRET'
    recordRuntimeDiagnosticError(error, 'window.error')
    const persisted = localStorage.getItem(RUNTIME_DIAGNOSTICS_KEY)!
    expect(JSON.parse(persisted)[0].build).toBe(APP_BUILD_ID)
    expect(persisted).not.toMatch(/SECRET|sk-private|localhost|provider|private|secretFunction/)
    expect(readRuntimeDiagnosticErrors()[0].frames).toEqual(['/storyforge/assets/index-abc.js:24:9'])
    vi.resetModules()
    const reloaded = await import('../../src/lib/diagnostics/runtime-errors')
    expect(reloaded.readRuntimeDiagnosticErrors()[0].name).toBe('TypeError')
    expect(reloaded.readRuntimeDiagnosticErrors()[0].build).toBe(JSON.parse(persisted)[0].build)
  })

  it('bounds failures, rejects corrupt and stale handoffs, and removes unknown fields', async () => {
    for (let index = 0; index < 25; index++) {
      const error = new Error('SECRET'); error.stack = `Error\n at f (app.js:${index}:1)`
      recordRuntimeDiagnosticError(error, 'react')
    }
    expect(readRuntimeDiagnosticErrors()).toHaveLength(20)
    const report = await buildFailureSummary()
    const parsed = readFailureHandoff(new URL(failureFeedbackLink(report)).hash)!
    expect(parsed.errors).toHaveLength(5)
    expect(parseFailureSummary({ ...report, manuscript: 'SECRET' })).not.toHaveProperty('manuscript')
    expect(readFailureHandoff('#storyforge-report=%broken')).toBeNull()
    expect(readFailureHandoff('#storyforge-report=' + 'x'.repeat(20_000))).toBeNull()
    expect(parseFailureSummary({ ...report, errors: [{ occurredAt: '2000-01-01T00:00:00Z', name: 'Error', source: 'react', frames: [] }] })?.errors).toEqual([])
    expect(parseFailureSummary({ ...report, application: 'SECRET' })).toBeNull()
  })

  it('does not transmit or open windows when preparing or clearing a report', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
    await act(async () => root!.render(createElement(FailureFeedbackPanel)))
    const button = [...container.querySelectorAll('button')].find(node => node.textContent === '查看故障摘要并反馈')!
    await act(async () => button.click())
    expect(container.querySelector('[aria-label=故障摘要预览]')).toBeTruthy()
    const link = [...container.querySelectorAll('a')].find(node => node.textContent === '带摘要打开官方反馈表单')!.getAttribute('href')!
    expect(link).toMatch(/^https:\/\/docs\.storyforge-lab\.com\/feedback\/bug#storyforge-report=/)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    await act(async () => [...container!.querySelectorAll('button')].find(node => node.textContent === '清空本地错误记录')!.click())
    expect(readRuntimeDiagnosticErrors()).toEqual([])
    expect(container.querySelector('[aria-label=故障摘要预览]')).toBeNull()
  })

  it('survives denied local storage without recursive failures', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => recordRuntimeDiagnosticError(new Error('SECRET'), 'bootstrap')).not.toThrow()
    expect(readRuntimeDiagnosticErrors()).toHaveLength(1)
    const error = new Error('SECRET')
    Object.defineProperty(error, 'stack', { get() { throw new Error('do not recurse') } })
    expect(() => recordRuntimeDiagnosticError(error, 'react')).not.toThrow()
  })

  it('offers feedback when React rendering fails without a project or dialog provider', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function BrokenView(): never { throw new TypeError('PRIVATE-MANUSCRIPT') }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
    await act(async () => root!.render(createElement(ErrorBoundary, { children: createElement(BrokenView) })))
    expect(container.textContent).toContain('出了点问题')
    await act(async () => [...container!.querySelectorAll('button')].find(node => node.textContent === '查看故障摘要并反馈')!.click())
    const preview = container.querySelector('[aria-label=故障摘要预览]')!.textContent!
    expect(preview).toContain('react')
    expect(preview).not.toContain('PRIVATE-MANUSCRIPT')
  })

  it('retains a sanitized record when a nested player boundary handles the exception', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function BrokenView(): never { throw new RangeError('PRIVATE-PLAYER-STATE') }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
    await act(async () => root!.render(createElement(TextOpenWorldPlayerErrorBoundary,
      { resetKey: 1, onRecover() {}, onExit() {}, children: createElement(BrokenView) })))
    expect(readRuntimeDiagnosticErrors()[0].name).toBe('RangeError')
    expect(JSON.stringify(readRuntimeDiagnosticErrors())).not.toContain('PRIVATE-PLAYER-STATE')
    expect(container.textContent).not.toContain('PRIVATE-PLAYER-STATE')
  })
})
