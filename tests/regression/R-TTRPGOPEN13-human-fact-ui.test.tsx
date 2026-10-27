import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import TtrpgOpenFactPanel from '../../src/components/ttrpg/TtrpgOpenFactPanel'
import { setupOpenEntityPlanningV1 } from '../helpers/open-entity-runtime'
import { OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import * as desk from '../../src/lib/ttrpg/open-fact-desk'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import type { TtrpgOpenFactDeskReviewV1 } from '../../src/lib/ttrpg/open-fact-desk-contract'
globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('R-TTRPGOPEN13 actual human fact component and identity isolation', { timeout: 60000 }, () => {
  let host: HTMLDivElement, root: Root
  beforeEach(async () => { await db.delete(); await db.open(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); db.close(); vi.restoreAllMocks() })
  async function until(check: () => boolean) {
    for (let n = 0; n < 600; n++) { await act(async () => { await new Promise(r => setTimeout(r, 5)) }); if (check()) return }
    throw new Error('fact UI did not settle: ' + host.textContent)
  }
  const button = (text: string) => [...host.querySelectorAll('button')].find(row => row.textContent === text)!
  const checkbox = (text: string) => [...host.querySelectorAll('label')].find(row => row.textContent?.includes(text))!.querySelector('input')!
  async function select(label: string, value: string) {
    await act(async () => { const row = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement; row.value = value; row.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  async function text(label: string, value: string) {
    await act(async () => {
      const row = host.querySelector(`textarea[aria-label="${label}"]`) as HTMLTextAreaElement
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(row, value)
      row.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  async function setup() {
    const s = await setupOpenEntityPlanningV1(pkg => { pkg.ttrpg!.campaign.gmMode = 'human' }, 'viewer.gm')
    const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.gm' }, before = await readProductRuntimeState(s.f.sessionId)
    const props = { input, sequence: before.lastSequence, busy: false, perform: async (job: () => Promise<void>) => job() }
    await act(async () => root.render(createElement(TtrpgOpenFactPanel, props)))
    await until(() => Boolean(host.querySelector('select[aria-label="事实主体"]')))
    await select('事实主体', 'keeper'); await select('事实含义', 'knows'); await select('事实关联对象', 'harbor')
    await text('事实正文', 'PRIVATE-HUMAN-FACT-UI')
    return { ...s, props, before }
  }
  it('keeps reading/preview separate from exact confirmation, resets review on edits and masks private state on the same component instance changing identity', async () => {
    const s = await setup(), count = await db.productRuntimeEvents.count()
    expect(button('准备并审阅本条事实').disabled).toBe(false)
    await act(async () => button('准备并审阅本条事实').click())
    await until(() => Boolean(host.querySelector('[aria-label="本版本事实审阅"]')))
    expect(button('确认本版本事实变更').disabled).toBe(true); expect(await db.productRuntimeEvents.count()).toBe(count)
    await text('事实正文', 'PRIVATE-HUMAN-FACT-UI-EDITED')
    expect(host.querySelector('[aria-label="本版本事实审阅"]')).toBeNull()
    await act(async () => button('准备并审阅本条事实').click()); await until(() => Boolean(button('确认本版本事实变更')))
    await act(async () => checkbox('我已核对本版本全文、依据和准确知情范围').click())
    await act(async () => button('确认本版本事实变更').click())
    await until(() => (host.textContent ?? '').includes('本条事实变更已确认保存'))
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.ttrpg!.openRun!.factLedger!.entries).toHaveLength(1); expect(after.entities).toEqual(s.before.entities); expect(await db.agentRuns.count()).toBe(0)
    await act(async () => root.render(createElement(TtrpgOpenFactPanel, { ...s.props, input: { ...s.props.input, viewerKey: OPEN_HUMAN_VIEWER } })))
    expect(host.textContent).not.toContain('PRIVATE-HUMAN-FACT-UI')
    await until(() => host.querySelector('[data-testid="ttrpg-open-fact-desk"]') === null)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(after)
  })
  it('keeps the exact original review through a committed-return cut and retries without preparing or appending another fact', async () => {
    const s = await setup(), original = desk.confirmTtrpgOpenFactDeskV1, originalPrepare = desk.prepareTtrpgOpenFactDeskAssertionV1
    const prepareSpy = vi.spyOn(desk, 'prepareTtrpgOpenFactDeskAssertionV1').mockImplementation(originalPrepare)
    const confirmSpy = vi.spyOn(desk, 'confirmTtrpgOpenFactDeskV1').mockImplementationOnce(async input => { await original(input); throw new Error('UI-FACT-COMMITTED-RETURN-CUT') })
    await act(async () => button('准备并审阅本条事实').click()); await until(() => Boolean(button('确认本版本事实变更')))
    await act(async () => checkbox('我已核对本版本全文、依据和准确知情范围').click())
    await act(async () => button('确认本版本事实变更').click()); await until(() => Boolean(button('核对并重试原事实确认')))
    const count = await db.productRuntimeEvents.count()
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger!.entries).toHaveLength(1)
    expect(button('核对并重试原事实确认').disabled).toBe(false)
    await act(async () => button('核对并重试原事实确认').click()); await until(() => (host.textContent ?? '').includes('本条事实变更已确认保存'))
    expect(await db.productRuntimeEvents.count()).toBe(count); expect(prepareSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy).toHaveBeenCalledTimes(2); expect(confirmSpy.mock.calls[0][0].review).toEqual(confirmSpy.mock.calls[1][0].review)
  })
  it('ignores a real private preparation returning after an identity handoff', async () => {
    const s = await setup()
    const original = desk.prepareTtrpgOpenFactDeskAssertionV1
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve }), ready: TtrpgOpenFactDeskReviewV1[] = []
    vi.spyOn(desk, 'prepareTtrpgOpenFactDeskAssertionV1').mockImplementationOnce(async input => { const review = await original(input); ready.push(review); await held; return review })
    await act(async () => button('准备并审阅本条事实').click()); await until(() => ready.length === 1)
    await act(async () => root.render(createElement(TtrpgOpenFactPanel, { ...s.props, input: { ...s.props.input, viewerKey: OPEN_HUMAN_VIEWER } })))
    expect(host.textContent).not.toContain('PRIVATE-HUMAN-FACT-UI')
    await act(async () => { release(); await held })
    for (let n = 0; n < 25; n++) await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    expect(host.textContent).not.toContain('PRIVATE-HUMAN-FACT-UI'); expect(host.querySelector('[aria-label="本版本事实审阅"]')).toBeNull()
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger).toBeUndefined(); expect(await db.agentRuns.count()).toBe(0)
  })
})
