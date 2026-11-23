import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ComicFields from '../../src/components/comic/ComicFields'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement
const draw = async (value: unknown) => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const changed = vi.fn()
  await act(async () => root!.render(createElement(ComicFields, { value, onChange: changed })))
  return changed
}
afterEach(async () => { await act(async () => root?.unmount()); host?.remove() })

it('pairs known comic metadata but keeps narrative and unknown fields full width', async () => {
  await draw({ audience: '中文读者', rating: 'PG-13', emotion: '克制', visualAction: '林岚推开门。', unknownNarrative: '不能裁去的原文' })
  for (const name of ['目标观众', '内容分级', '情绪']) expect(host.querySelector(`[aria-label="${name}"]`)!.closest('label')!.classList.contains('cp-wide')).toBe(false)
  for (const name of ['视觉动作', 'unknownNarrative']) expect(host.querySelector(`[aria-label="${name}"]`)!.closest('label')!.classList.contains('cp-wide')).toBe(true)
})

it('preserves nested design values, internal identity and scoped record removal', async () => {
  const value = [{ stableKey: 'hero', label: '林岚', design: { description: '短发旅人' } }, { stableKey: 'station', label: '旧站', design: { description: '暴雨中的车站' } }]
  const changed = await draw(value)
  expect(host.querySelector('[aria-label="第1项 外观设计 设计描述"]')?.textContent).toBe('短发旅人')
  expect(host.textContent).not.toContain('hero')
  await act(async () => host.querySelector('button')!.click())
  expect(changed).toHaveBeenCalledWith([value[1]])
})
