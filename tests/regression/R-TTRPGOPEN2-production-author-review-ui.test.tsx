import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Editor from '../../src/components/ttrpg/TtrpgOpenProductionReview'
import { db } from '../../src/lib/db/schema'
import { seedOpenBrowserProductionV1 } from '../helpers/open-ttrpg-production-browser'
import { openProductionCompilerFixtureV1 } from '../helpers/open-ttrpg-production-artifacts'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import type { TtrpgOpenProductionReviewOwnerV1 } from '../../src/lib/ttrpg/open-production-review-service'

const mock = vi.hoisted(() => ({ read: vi.fn<() => Promise<string>>() }))
vi.mock('../../src/lib/ttrpg/open-production-review-service', () => ({ readTtrpgOpenProductionReviewDraftV1: mock.read }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
beforeEach(async () => {
  await db.delete(); await db.open(); mock.read.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); db.close() })
async function fixture() {
  const f = await seedOpenBrowserProductionV1(), details = await readProductProductionDetailsV1(f.scope, f.productionId)
  const brief = details.executionBrief!, data = await openProductionCompilerFixtureV1(true, { ...f, brief })
  data.sourceFacts.factPolicy.forEach(item => { item.authorConfirmed = false })
  const owner: TtrpgOpenProductionReviewOwnerV1 = { ...f, taskKey: 'ttrpg.open.source-facts', buildId: details.build!.id!,
    controlEpoch: 0, planHash: 'a'.repeat(64), runId: 1, attempt: 1 }
  return { owner, brief: brief.ttrpgOpen!, facts: data.sourceFacts, value: JSON.stringify(data.sourceFacts) }
}
const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === text)!

it('changes only the selected fact in the single parent JSON and does not submit or invoke the loader', async () => {
  const f = await fixture(), change = vi.fn()
  await act(async () => root.render(createElement(Editor, { ...f, onChange: change, disabled: false })))
  expect(host.textContent).toContain('来源字段与原版本')
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
  expect(change).toHaveBeenCalledOnce()
  const expected = structuredClone(f.facts); expected.factPolicy[0].authorConfirmed = true
  expect(JSON.parse(change.mock.calls[0][0])).toEqual(expected)
  expect(f.facts.factPolicy.every(item => !item.authorConfirmed)).toBe(true)
  expect(mock.read).not.toHaveBeenCalled()
})

it('pages large fact sets without hiding earlier choices or changing the wrong fact index', async () => {
  const f = await fixture(), change = vi.fn()
  f.facts.factPolicy = Array.from({ length: 52 }, (_, i) => ({ fact: { ...structuredClone(f.facts.factPolicy[0].fact), factKey: `review.fact.${i}` }, authorConfirmed: i === 0 }))
  f.value = JSON.stringify(f.facts)
  await act(async () => root.render(createElement(Editor, { ...f, onChange: change, disabled: false })))
  expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(25)
  await act(async () => button('下一页').click())
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
  const revised = JSON.parse(change.mock.calls[0][0])
  expect(revised.factPolicy.filter((item: { authorConfirmed: boolean }) => item.authorConfirmed).map((item: { fact: { factKey: string } }) => item.fact.factKey))
    .toEqual(['review.fact.0', 'review.fact.25'])
})

it('drops a late loader response after switching Work and remounting the owner-bound editor', async () => {
  const f = await fixture(), oldChange = vi.fn(), nextChange = vi.fn()
  let finish!: (value: string) => void
  mock.read.mockReturnValue(new Promise(resolve => { finish = resolve }))
  await act(async () => root.render(createElement(Editor, { ...f, key: 'old', value: '', onChange: oldChange, disabled: false })))
  await act(async () => { button('读取本任务待审稿').click(); await vi.waitFor(() => expect(mock.read).toHaveBeenCalledOnce()) })
  await act(async () => root.render(createElement(Editor, { ...f, key: 'next', owner: { ...f.owner, scope: { ...f.owner.scope, workId: 999 } }, value: '', onChange: nextChange, disabled: false })))
  await act(async () => { finish(f.value); await Promise.resolve() })
  expect(oldChange).not.toHaveBeenCalled(); expect(nextChange).not.toHaveBeenCalled()
  expect(button('读取本任务待审稿')).toBeDefined()
})

it('preserves an advanced edit made while reading instead of overwriting it with the late original', async () => {
  const f = await fixture(), change = vi.fn()
  let finish!: (value: string) => void
  mock.read.mockReturnValue(new Promise(resolve => { finish = resolve }))
  await act(async () => root.render(createElement(Editor, { ...f, value: '', onChange: change, disabled: false })))
  await act(async () => { button('读取本任务待审稿').click(); await vi.waitFor(() => expect(mock.read).toHaveBeenCalledOnce()) })
  await act(async () => root.render(createElement(Editor, { ...f, value: f.value, onChange: change, disabled: false })))
  await act(async () => { finish(f.value); await Promise.resolve() })
  expect(change).not.toHaveBeenCalled(); expect(host.textContent).toContain('保留你的修改')
})
