import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import TtrpgOpenCommonOraclePanel from '../../src/components/ttrpg/TtrpgOpenCommonOraclePanel'
import { setupCommonOracleDeskV1 as fixture } from '../helpers/open-common-oracle-desk'
import * as desk from '../../src/lib/ttrpg/open-common-oracle-desk'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
describe('R-TTRPGOPEN14 common fact component actual authorization, review, stopping and identity', { timeout: 120000 }, () => {
  let host: HTMLDivElement, root: Root, props: Parameters<typeof TtrpgOpenCommonOraclePanel>[0], pending: Set<Promise<void>>, releaseWait: (() => void) | null
  beforeEach(async () => { await db.delete(); await db.open(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); pending = new Set(); releaseWait = null })
  afterEach(async () => { releaseWait?.(); await act(async () => { await Promise.all([...pending]); root.unmount() }); host.remove(); vi.restoreAllMocks(); db.close() })
  async function until(check: () => boolean) {
    for (let n = 0; n < 2400; n++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); if (check()) return }
    throw new Error('Common UI did not settle: ' + host.textContent)
  }
  const button = (label: string) => [...host.querySelectorAll('button')].find(row => row.textContent === label)!
  const checkbox = (label: string) => [...host.querySelectorAll('label')].find(row => row.textContent?.includes(label))!.querySelector('input')!
  async function select(label: string, value: string) {
    await act(async () => { const row = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement; row.value = value; row.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  async function setup(runAI?: () => Promise<string>) {
    const s = await fixture(), output = JSON.stringify({ interpretation: 'COMMON-UI-ORIGINAL-EXPLANATION', facts: [s.fact] })
    const sends = vi.fn(runAI ?? (async () => output)), original = desk.requestTtrpgOpenCommonOracleDeskV1
    vi.spyOn(desk, 'requestTtrpgOpenCommonOracleDeskV1').mockImplementation(input => original({ ...input, aiConfig: undefined, runAI: sends }))
    props = { input: s.owner, sequence: s.page.sequence, busy: false, perform: async job => {
      const jobOwner = props.input
      const work = (async () => { try { await job() } finally {
        if (props.input === jobOwner) {
          props = { ...props, sequence: (await readProductRuntimeState(props.input.sessionId)).lastSequence }
          act(() => root.render(createElement(TtrpgOpenCommonOraclePanel, props)))
        }
      } })()
      pending.add(work); try { await work } finally { pending.delete(work) }
    } }
    await act(async () => root.render(createElement(TtrpgOpenCommonOraclePanel, props)))
    await until(() => Boolean(host.querySelector('select[aria-label="共同事实的原咨询"]')))
    await select('共同事实的原咨询', `${s.selected.oracleSourceRef.sessionKey}:${s.selected.oracleSourceRef.sequence}`)
    return { ...s, output, sends }
  }
  async function send() {
    await act(async () => checkbox('我同意 AI 按以上原咨询、共同资料').click())
    await act(async () => { button('请求本次共同事实候选').click(); await Promise.all([...pending]) })
    await until(() => (host.textContent ?? '').includes('COMMON-UI-ORIGINAL-EXPLANATION'))
    await until(() => Boolean(button('确认本版本共同事实审阅')) && !host.querySelector<HTMLFieldSetElement>('fieldset:has(select[aria-label="原共同解释决定"])')!.disabled)
  }
  async function decisions() {
    await select('共同事实提案 1 决定', 'adopt'); await select('原共同解释决定', 'accept')
    await act(async () => checkbox('我已核对本版本共同解释').click())
  }
  it('requires renewed cost consent and explicit complete review, keeps facts pending until confirmation and shows saved decisions after closing', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId)
    expect(button('请求本次共同事实候选').disabled).toBe(true)
    await act(async () => checkbox('我同意 AI 按以上原咨询、共同资料').click())
    expect(button('请求本次共同事实候选').disabled).toBe(false)
    await act(async () => {
      const row = host.querySelector('input[aria-label="共同事实预留上限"]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(row, '0.11'); row.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(checkbox('我同意 AI 按以上原咨询、共同资料').checked).toBe(false)
    await send()
    expect(s.sends).toHaveBeenCalledOnce(); expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger?.entries ?? []).toHaveLength(0)
    expect(host.querySelector('[aria-label="原请求实际交付的共同资料"]')).toBeTruthy()
    expect(button('确认本版本共同事实审阅').disabled).toBe(true)
    await decisions(); expect(button('确认本版本共同事实审阅').disabled).toBe(false)
    await select('共同事实提案 1 决定', 'discard')
    expect(checkbox('我已核对本版本共同解释').checked).toBe(false); expect(button('确认本版本共同事实审阅').disabled).toBe(true)
    await decisions(); await act(async () => { button('确认本版本共同事实审阅').click(); await Promise.all([...pending]) })
    await until(() => (host.textContent ?? '').includes('共同解释及逐项决定已保存'))
    await until(() => Boolean(button('结束本次已审阅共同事实窗口')) && !button('结束本次已审阅共同事实窗口').disabled)
    await act(async () => { button('结束本次已审阅共同事实窗口').click(); await Promise.all([...pending]) })
    await until(() => (host.textContent ?? '').includes('原共同事实窗口已结束'))
    expect(host.textContent).toContain('已保存决定：采用')
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product); expect(after.ttrpg!.openRun!.factLedger!.entries).toHaveLength(1)
    expect(s.sends).toHaveBeenCalledOnce()
  })
  it('retains exact review choices after a real storage failure and clears original text immediately on the same component identity change', async () => {
    const s = await setup(); await send(); await decisions()
    const cut = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('COMMON-UI-REVIEW-ROLLBACK'))
    await act(async () => { button('确认本版本共同事实审阅').click(); await Promise.all([...pending]) })
    await until(() => Boolean(button('核对并重试原共同审阅')) && !button('核对并重试原共同审阅').disabled); cut.mockRestore()
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger?.entries ?? []).toHaveLength(0)
    expect((host.querySelector('select[aria-label="共同事实提案 1 决定"]') as HTMLSelectElement).value).toBe('adopt')
    await act(async () => { button('核对并重试原共同审阅').click(); await Promise.all([...pending]) })
    await until(() => (host.textContent ?? '').includes('原共同审阅已核对完成'))
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger!.entries).toHaveLength(1)
    props = { ...props, input: { ...props.input, viewerKey: 'viewer.gm' } }
    await act(async () => root.render(createElement(TtrpgOpenCommonOraclePanel, props)))
    expect(host.textContent).not.toContain('COMMON-UI-ORIGINAL-EXPLANATION'); expect(host.textContent).not.toContain(s.fact.detail)
    expect(s.sends).toHaveBeenCalledOnce()
  })
  it('records unknown cost and closes the original authority before aborting a stopped request; a late answer stays unconfirmed', async () => {
    let started!: () => void
    const sending = new Promise<void>(resolve => { started = resolve }), waiting = new Promise<void>(resolve => { releaseWait = resolve })
    const s = await setup(async () => { started(); await waiting; return JSON.stringify({ interpretation: 'COMMON-UI-LATE-RESPONSE', facts: [] }) })
    await act(async () => checkbox('我同意 AI 按以上原咨询、共同资料').click())
    await act(async () => button('请求本次共同事实候选').click()); await sending
    await until(() => Boolean(button('停止本次共同事实请求')))
    await act(async () => button('停止本次共同事实请求').click())
    await until(() => (host.textContent ?? '').includes('原共同请求已明确停止'))
    const saved = await readProductRuntimeState(s.f.sessionId)
    expect(saved.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull(); expect(saved.ttrpg!.openRun!.coordination.calls[0].status).toBe('unknown')
    releaseWait?.(); await act(async () => { await Promise.all([...pending]) })
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(saved); expect(host.textContent).not.toContain('COMMON-UI-LATE-RESPONSE'); expect(s.sends).toHaveBeenCalledOnce()
  })
})
