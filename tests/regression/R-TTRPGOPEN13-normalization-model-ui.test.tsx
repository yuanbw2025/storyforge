import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import TtrpgOpenNormalizationModelPanel from '../../src/components/ttrpg/TtrpgOpenNormalizationModelPanel'
import TtrpgOpenSemanticModelPanel from '../../src/components/ttrpg/TtrpgOpenSemanticModelPanel'
import { setupNormalizationRuntimeSourceV1 } from '../helpers/open-normalization-runtime-model'
import { OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import * as harness from '../../src/lib/ttrpg/open-intent-harness'
import * as desk from '../../src/lib/ttrpg/open-normalization-model-desk'
import * as commands from '../../src/lib/ttrpg/runtime-commands'
globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('R-TTRPGOPEN13 actual accepted-source normalization component consent, exact review and identity', { timeout: 120000 }, () => {
  let host: HTMLDivElement, root: Root, props: Parameters<typeof TtrpgOpenNormalizationModelPanel>[0]
  let pending: Set<Promise<void>>, releaseWait: (() => void) | null
  beforeEach(async () => { await db.delete(); await db.open(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); pending = new Set(); releaseWait = null })
  afterEach(async () => { releaseWait?.(); await act(async () => { await Promise.all([...pending]); root.unmount() }); host.remove(); vi.restoreAllMocks(); db.close() })
  async function until(check: () => boolean) {
    for (let n = 0; n < 1600; n++) { await act(async () => { await new Promise(r => setTimeout(r, 5)) }); if (check()) return }
    throw new Error('Normalization model UI did not settle: ' + host.textContent)
  }
  const button = (label: string) => [...host.querySelectorAll('button')].find(row => row.textContent === label)!
  const checkbox = (label: string) => [...host.querySelectorAll('label')].find(row => row.textContent?.includes(label))!.querySelector('input')!
  async function select(label: string, value: string) {
    await act(async () => { const row = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement; row.value = value; row.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  async function number(label: string, value: string) {
    await act(async () => { const row = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(row, value); row.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  async function setup(runAI?: () => Promise<string>, contradictory = false) {
    const s = await setupNormalizationRuntimeSourceV1('gm-only', undefined, { interpretation: 'PRIVATE-NORMALIZATION-MODEL-UI-EXPLANATION：该 NPC 了解港口，具体事实另行审阅。' })
    const fact = { ...s.normalizedFact, predicateKey: 'knows' as const, objectRef: 'harbor', canonicalValue: true, detail: 'PRIVATE-NORMALIZATION-MODEL-UI-FACT' }
    const output = JSON.stringify({ facts: [fact, ...(contradictory ? [{ ...fact, canonicalValue: false, detail: '相反的同槽事实，须逐项审阅。' }] : [])] })
    const sends = vi.fn(runAI ?? (async () => output)), original = harness.generateTtrpgOpenFactNormalizationCandidateV2
    vi.spyOn(harness, 'generateTtrpgOpenFactNormalizationCandidateV2').mockImplementation(input => original({ ...input, aiConfig: undefined, runAI: sends }))
    props = { input: s.owner, sequence: (await readProductRuntimeState(s.f.sessionId)).lastSequence, busy: false, perform: async job => {
      const work = (async () => { try { await job() } finally {
        props = { ...props, sequence: (await readProductRuntimeState(props.input.sessionId)).lastSequence }; act(() => root.render(createElement(TtrpgOpenNormalizationModelPanel, props)))
      } })()
      pending.add(work)
      try { await work } finally { pending.delete(work) }
    } }
    await act(async () => root.render(createElement(TtrpgOpenNormalizationModelPanel, props)))
    await until(() => Boolean(host.querySelector('select[aria-label="用于事实整理的原解释"]')))
    await select('用于事实整理的原解释', `${s.review.sourceRef.sessionKey}:${s.review.sourceRef.sequence}`)
    return { ...s, output, sends }
  }
  async function send() {
    await act(async () => checkbox('我同意 AI 按以上原已接受解释').click())
    await act(async () => button('按本次选择请求事实整理候选').click())
    await until(() => (host.textContent ?? '').includes('PRIVATE-NORMALIZATION-MODEL-UI-EXPLANATION'))
    await until(() => Boolean(button('确认本版本事实整理审阅')) && !host.querySelector<HTMLFieldSetElement>('fieldset:has(select[aria-label="本次事实整理决定"])')!.disabled)
  }
  async function review() {
    await select('事实提案 1 决定', 'adopt'); await select('本次事实整理决定', 'accept')
    await act(async () => checkbox('我已核对本版本全文').click())
  }
  it('renews changed consent, leaves facts pending until exact review, resets edited decisions and masks private text on the same component changing identity', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId)
    expect(button('按本次选择请求事实整理候选').disabled).toBe(true)
    await act(async () => checkbox('我同意 AI 按以上原已接受解释').click())
    expect(button('按本次选择请求事实整理候选').disabled).toBe(false)
    await number('事实整理预留上限', '0.11')
    expect(checkbox('我同意 AI 按以上原已接受解释').checked).toBe(false)
    await send()
    expect(s.sends).toHaveBeenCalledOnce(); expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger?.entries ?? []).toHaveLength(0)
    expect(button('确认本版本事实整理审阅').disabled).toBe(true)
    await review(); expect(button('确认本版本事实整理审阅').disabled).toBe(false)
    await select('事实提案 1 决定', 'discard')
    expect(checkbox('我已核对本版本全文').checked).toBe(false); expect(button('确认本版本事实整理审阅').disabled).toBe(true)
    await review()
    await act(async () => button('确认本版本事实整理审阅').click())
    await until(() => (host.textContent ?? '').includes('原解释保持，本次逐项决定已保存'))
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.ttrpg!.openRun!.factLedger!.entries).toHaveLength(1); expect(after.entities).toEqual(before.entities); expect(s.sends).toHaveBeenCalledOnce()
    props = { ...props, input: { ...props.input, viewerKey: OPEN_HUMAN_VIEWER } }
    await act(async () => root.render(createElement(TtrpgOpenNormalizationModelPanel, props)))
    expect(host.textContent).not.toContain('PRIVATE-NORMALIZATION-MODEL-UI')
    await until(() => !host.querySelector('[data-testid="ttrpg-open-normalization-model-desk"]'))
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(after)
  })
  it('preserves the same review through an actual committed-return cut and a temporary failed read, then retries without another fact or send', async () => {
    const s = await setup(); await send(); await review()
    const original = commands.reviewTtrpgOpenOracleCandidateV1, originalDesk = desk.reviewTtrpgOpenNormalizationModelDeskV1
    const reviews = vi.spyOn(desk, 'reviewTtrpgOpenNormalizationModelDeskV1').mockImplementation(originalDesk)
    vi.spyOn(commands, 'reviewTtrpgOpenOracleCandidateV1').mockImplementationOnce(async input => {
      await original(input)
      vi.spyOn(desk, 'readTtrpgOpenNormalizationModelDeskV1').mockRejectedValueOnce(new Error('NORMALIZATION-UI-READ-AFTER-COMMIT-CUT'))
      throw new Error('NORMALIZATION-UI-COMMITTED-RETURN-CUT')
    })
    await act(async () => button('确认本版本事实整理审阅').click())
    await until(() => Boolean(button('核对并重试原整理审阅')) && !button('核对并重试原整理审阅').disabled && (host.textContent ?? '').includes('NORMALIZATION-UI-READ-AFTER-COMMIT-CUT'))
    const count = await db.productRuntimeEvents.count()
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger!.entries).toHaveLength(1)
    await act(async () => button('核对并重试原整理审阅').click())
    await until(() => (host.textContent ?? '').includes('原审阅确认已核对完成'))
    expect(await db.productRuntimeEvents.count()).toBe(count); expect(reviews).toHaveBeenCalledTimes(2)
    expect(reviews.mock.calls[0][0]).toEqual(reviews.mock.calls[1][0]); expect(s.sends).toHaveBeenCalledOnce()
  })
  it('stops the original in-flight request durably and keeps unknown cost before a late answer returns', async () => {
    let release!: () => void
    const held = new Promise<void>(r => { release = r })
    releaseWait = () => release()
    const s = await setup(async () => { await held; return JSON.stringify({ facts: [] }) })
    await act(async () => checkbox('我同意 AI 按以上原已接受解释').click())
    await act(async () => button('按本次选择请求事实整理候选').click())
    await until(() => s.sends.mock.calls.length === 1 && Boolean(button('停止本次事实整理请求')))
    await act(async () => button('停止本次事实整理请求').click())
    await until(() => (host.textContent ?? '').includes('原请求已停止并结束窗口'))
    const stopped = await readProductRuntimeState(s.f.sessionId)
    expect(stopped.ttrpg!.openRun!.coordination.calls.at(-1)).toMatchObject({ status: 'unknown', usage: { actualCostUsd: null } })
    expect(stopped.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    await act(async () => { release(); await held })
    await until(() => !button('停止本次事实整理请求'))
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(stopped); expect(host.textContent).not.toContain('LATE-NORMALIZATION-UI-ANSWER'); expect(s.sends).toHaveBeenCalledOnce()
  })
  it('keeps an actual contradictory batch atomic and lets the human explicitly re-review its still-unconfirmed choices', async () => {
    const s = await setup(undefined, true); await send()
    await select('事实提案 1 决定', 'adopt'); await select('事实提案 2 决定', 'adopt'); await select('本次事实整理决定', 'accept')
    await act(async () => checkbox('我已核对本版本全文').click())
    await act(async () => button('确认本版本事实整理审阅').click())
    await until(() => Boolean(button('重新审阅尚未确认的候选')) && !button('重新审阅尚未确认的候选').disabled)
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger?.entries ?? []).toHaveLength(0)
    await act(async () => button('重新审阅尚未确认的候选').click())
    await select('事实提案 2 决定', 'discard')
    await act(async () => { const row = host.querySelector('textarea[aria-label="事实提案 2 弃用原因"]') as HTMLTextAreaElement
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(row, '与第一条相反，不采用第二条。'); row.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => checkbox('我已核对本版本全文').click())
    await act(async () => button('确认本版本事实整理审阅').click())
    await until(() => (host.textContent ?? '').includes('原解释保持，本次逐项决定已保存'))
    const run = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!
    expect(run.factLedger!.entries).toHaveLength(1); expect(run.oracleReviews!.at(-1)!.choices[1]).toMatchObject({ decision: 'discard', reason: '与第一条相反，不采用第二条。' })
    expect(s.sends).toHaveBeenCalledOnce()
  })
  it('ignores a real private candidate read returning after an identity handoff on the same mounted component', async () => {
    const s = await setup(); await send()
    const original = desk.readTtrpgOpenNormalizationModelDeskV1, ready: Array<Awaited<ReturnType<typeof original>>> = []
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve }); releaseWait = () => release()
    vi.spyOn(desk, 'readTtrpgOpenNormalizationModelDeskV1').mockImplementationOnce(async input => { const value = await original(input); ready.push(value); await held; return value })
    const before = await readProductRuntimeState(s.f.sessionId)
    await act(async () => button('读取原事实整理进度').click()); await until(() => ready.length === 1)
    expect(JSON.stringify(ready[0])).toContain('PRIVATE-NORMALIZATION-MODEL-UI-EXPLANATION')
    props = { ...props, input: { ...props.input, viewerKey: OPEN_HUMAN_VIEWER } }
    await act(async () => root.render(createElement(TtrpgOpenNormalizationModelPanel, props)))
    expect(host.textContent).not.toContain('PRIVATE-NORMALIZATION-MODEL-UI')
    await until(() => !host.querySelector('[data-testid="ttrpg-open-normalization-model-desk"]'))
    await act(async () => { release(); await held })
    for (let n = 0; n < 10; n++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    expect(host.textContent).not.toContain('PRIVATE-NORMALIZATION-MODEL-UI'); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(s.sends).toHaveBeenCalledOnce()
  })
  it('masks the previous purpose immediately and ignores its delayed read on the same shared component', async () => {
    const s = await setup(); await send(); await act(async () => { await Promise.all([...pending]) })
    await act(async () => root.render(createElement(TtrpgOpenSemanticModelPanel, { ...props, purpose: 'normalization' })))
    await until(() => (host.textContent ?? '').includes('PRIVATE-NORMALIZATION-MODEL-UI-FACT'))
    const original = desk.readTtrpgOpenNormalizationModelDeskV1, ready: Array<Awaited<ReturnType<typeof original>>> = []
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve }); releaseWait = () => release()
    vi.spyOn(desk, 'readTtrpgOpenNormalizationModelDeskV1').mockImplementationOnce(async input => { const value = await original(input); ready.push(value); await held; return value })
    const before = await readProductRuntimeState(s.f.sessionId)
    await act(async () => button('读取原事实整理进度').click()); await until(() => ready.length === 1)
    expect(JSON.stringify(ready[0])).toContain('PRIVATE-NORMALIZATION-MODEL-UI-FACT')
    await act(async () => root.render(createElement(TtrpgOpenSemanticModelPanel, { ...props, purpose: 'oracle' })))
    expect(host.textContent).not.toContain('PRIVATE-NORMALIZATION-MODEL-UI-FACT')
    await until(() => !host.querySelector('[data-testid="ttrpg-open-normalization-model-desk"]'))
    await act(async () => { release(); await held })
    for (let n = 0; n < 10; n++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    expect(host.textContent).not.toContain('PRIVATE-NORMALIZATION-MODEL-UI-FACT'); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(s.sends).toHaveBeenCalledOnce()
  })
})
