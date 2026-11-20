import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import FailureFeedbackPanel from '../../src/components/shared/FailureFeedbackPanel'
import { recordRuntimeDiagnosticError, resetRuntimeDiagnostics } from '../../src/lib/diagnostics/runtime-errors'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
const locks = Object.getOwnPropertyDescriptor(navigator, 'locks')
beforeEach(async () => {
  localStorage.clear(); resetRuntimeDiagnostics()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, callback: () => unknown) => callback() } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(createElement(FailureFeedbackPanel)))
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks()
  if (locks) Object.defineProperty(navigator, 'locks', locks); else Reflect.deleteProperty(navigator, 'locks')
})
async function click(name: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === name)!
  expect(button).toBeTruthy(); await act(async () => button.click())
}
function choice() { return [...container.querySelectorAll('label')].find(item => item.textContent?.includes('接收本条反馈的处理进展'))!.querySelector('input')! }
async function value(label: string, text: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!
  expect(field).toBeTruthy()
  const proto = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, text); field.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function fill(kind: 'bug' | 'feature') {
  await value('标题', kind === 'bug' ? 'Bug sample' : 'Feature sample'); await value('涉及模块', '反馈')
  await value(kind === 'bug' ? '问题描述' : '建议与使用场景', 'Synthetic description without private data')
  if (kind === 'bug') { await value('复现步骤或触发场景', '点击按钮'); await value('实际结果', '出现错误') }
  await value(kind === 'bug' ? '期望结果' : '希望怎样改进', '正常完成操作')
}
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
function backend(failFirst = false) {
  const bodies: Record<string, unknown>[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (!String(url).endsWith('/feedback')) return new Response(JSON.stringify({ diagnosticContext: 1, feedbackForm: 2, feedbackImages: 1, feedbackFollowup: 1 }))
    const body = JSON.parse(String(init?.body)); bodies.push(body)
    if (failFirst && bodies.length === 1) throw new TypeError('Synthetic lost receipt')
    return new Response(JSON.stringify({ accepted: true, id: body.id }))
  })
  return bodies
}
it('keeps an explicit follow-up choice with its own draft and leaves another kind unselected', async () => {
  await click('报告 Bug'); expect(choice().checked).toBe(false)
  await act(async () => choice().click()); expect(choice().checked).toBe(true)
  await click('功能建议'); expect(choice().checked).toBe(false)
  await click('报告 Bug'); expect(choice().checked).toBe(true)
})
it('starts a new report unselected after an accepted report while preserving the original follow-up receipt', async () => {
  const bodies = backend()
  await click('报告 Bug'); await fill('bug'); await act(async () => choice().click()); await submit()
  await vi.waitFor(() => expect(bodies).toHaveLength(1))
  await vi.waitFor(() => expect(container.textContent).toContain('提交成功'))
  await click('报告 Bug'); expect(choice().checked).toBe(false)
  expect(bodies[0]).toHaveProperty('followup')
  expect(localStorage.getItem('storyforge_feedback_followup_v1')).toContain(String(bodies[0]!.id))
})
it('keeps the exact request and claim for an unknown submission across another kind of draft and its successful submission', async () => {
  const bodies = backend(true)
  await click('报告 Bug'); await fill('bug'); await act(async () => choice().click()); await submit()
  await vi.waitFor(() => expect(container.textContent).toContain('提交结果未确认'))
  await click('功能建议'); await fill('feature'); await submit()
  await vi.waitFor(() => expect(container.textContent).toContain('提交成功'))
  await click('报告 Bug'); await submit()
  await vi.waitFor(() => expect(bodies).toHaveLength(3))
  expect(bodies[2]).toEqual(bodies[0])
  expect(bodies[1]).not.toHaveProperty('followup')
})

it('retains the original error preview on a pending Bug when a feature draft completes, so the retry remains byte-identical', async () => {
  const bodies = backend(true)
  recordRuntimeDiagnosticError(new TypeError('Cannot read properties of undefined'), 'window.error')
  await click('查看故障摘要并反馈'); await fill('bug'); await act(async () => choice().click()); await submit()
  await vi.waitFor(() => expect(container.textContent).toContain('提交结果未确认'))
  expect(bodies[0]!.diagnostics).toHaveLength(1)
  await click('功能建议'); await fill('feature'); await submit()
  await vi.waitFor(() => expect(container.textContent).toContain('提交成功'))
  await click('报告 Bug'); await submit()
  await vi.waitFor(() => expect(bodies).toHaveLength(3))
  expect(bodies[2]).toEqual(bodies[0])
})
