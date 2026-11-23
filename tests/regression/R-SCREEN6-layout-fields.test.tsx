import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ScreenplayFields from '../../src/components/screenplay/ScreenplayFields'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement
async function draw(value: unknown, options = {}) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const changed = vi.fn()
  await act(async () => root!.render(createElement(ScreenplayFields, { value, options, onChange: changed })))
  return changed
}
const label = (name: string) => host.querySelector(`[aria-label="${name}"]`)!.closest('label')!
afterEach(async () => { await act(async () => root?.unmount()); host?.remove() })

it('pairs short metadata while retaining full-width narrative and unchanged field labels', async () => {
  await draw({ language: 'zh-CN', rating: 'PG-13', sectionTitle: '第一幕', objective: '抵达车站', statement: '她选择留下', audience: '中文观众' })
  for (const name of ['语言', '内容分级', '幕或段落名称', '目标观众']) expect(label(name).classList.contains('sp-wide')).toBe(false)
  for (const name of ['叙事目标', '原作事实']) expect(label(name).classList.contains('sp-wide')).toBe(true)
  expect(host.querySelector('[aria-label="语言"]')?.getAttribute('rows')).toBe('2')
})

it('keeps multi-select reference values and emits the same selected source keys', async () => {
  const changed = await draw({ sourceUnitKeys: ['source.a'] }, { sourceUnitKeys: [{ value: 'source.a', label: '很长的第一章来源标题' }, { value: 'source.b', label: '第二章' }] })
  const select = host.querySelector('select')!
  expect(select.multiple).toBe(true)
  expect(select.options[0].selected).toBe(true)
  expect(select.options[1].selected).toBe(false)
  select.options[1].selected = true
  await act(async () => select.dispatchEvent(new Event('change', { bubbles: true })))
  expect(changed).toHaveBeenCalledWith({ sourceUnitKeys: ['source.a', 'source.b'] })
})

it('does not hide nested title-page fields or expose internal keys in the compact form', async () => {
  await draw({ stableKey: 'protected', version: 1, titlePage: { authorDisplayName: '作者', copyrightNotice: '完整版权声明' }, preserveVoiceOver: true })
  expect(host.textContent).not.toContain('protected')
  expect(host.querySelector('[aria-label="标题页 作者署名"]')).not.toBeNull()
  expect(host.querySelector<HTMLInputElement>('[aria-label="保留旁白"]')!.checked).toBe(true)
})

it('keeps unknown narrative fields wide and array removal scoped to the selected item', async () => {
  const changed = await draw([{ stableKey: 'a', unknownNarrative: '不可省略的原文' }, { stableKey: 'b', unknownNarrative: '第二条' }])
  expect(label('第1项 unknownNarrative').classList.contains('sp-wide')).toBe(true)
  const buttons = host.querySelectorAll('button')
  await act(async () => buttons[0].click())
  expect(changed).toHaveBeenCalledWith([{ stableKey: 'b', unknownNarrative: '第二条' }])
})
