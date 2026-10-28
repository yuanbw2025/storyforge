import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import VoiceProcessingDraftPanel from '../../src/components/avg/VoiceProcessingDraftPanel'
import { avgVoiceAssemblyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import type { AvgAudioProductionProcessingPlanV1 } from '../../src/lib/avg/audio-production-contract'

let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

async function panel(result = true) {
  const { assembly } = await avgVoiceAssemblyFixtureV3(), requirements = assembly.voice.batch.requirements
  const onPending = vi.fn(), onSave = vi.fn(async (_plan: AvgAudioProductionProcessingPlanV1 | null) => result)
  await act(async () => root.render(<VoiceProcessingDraftPanel requirements={requirements} disabled={false} ready={false}
    onPending={onPending} onSave={onSave} />))
  const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!
  const click = async (text: string) => act(async () => { expect(button(text).disabled).toBe(false); button(text).click() })
  const enable = async () => act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
  const value = async (selector: string, text: string) => act(async () => {
    const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
    const prototype = element.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, text)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return { requirements, onPending, onSave, button, click, enable, value }
}

describe('AVG per-line local gain preparation', () => {
  it('starts unselected, saves exact units and declared duration, and waits for successful persistence before clearing edits', async () => {
    const s = await panel()
    expect(host.textContent).toContain('正式加工尚未开放')
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    expect(s.onSave).not.toHaveBeenCalled()
    await s.enable(); await s.value('input[type="number"]', '-4.2')
    await s.value('textarea', '调低此句音量，与相邻对白衔接；原音频保留。')
    expect(s.onPending).toHaveBeenLastCalledWith(true)
    await s.click('保存音量调整要求')
    const entry = s.onSave.mock.calls[0][0]!.entries[0]
    expect(entry).toMatchObject({ domain: 'voice', requirementKey: s.requirements[0].requirementKey,
      recipe: { gainMilliDb: -4200, maximumDurationMs: s.requirements[0].maximumDurationMs,
        sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject' } })
    expect(s.onPending).toHaveBeenLastCalledWith(false)
    expect(s.button('保存音量调整要求').disabled).toBe(true)
    await s.enable(); await s.click('保存音量调整要求')
    expect(s.onSave).toHaveBeenLastCalledWith(null)
  })
  it('keeps edits and allows retry or explicit discard when the surrounding action reports save failure', async () => {
    const s = await panel(false)
    await s.enable(); await s.value('textarea', '保存失败时保留这次编辑。')
    await s.click('保存音量调整要求')
    expect(s.onSave).toHaveBeenCalledTimes(1)
    expect(s.onPending).toHaveBeenLastCalledWith(true)
    expect(s.button('保存音量调整要求').disabled).toBe(false)
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(false)
    await s.click('撤销未保存的音量调整')
    expect(s.onPending).toHaveBeenLastCalledWith(false)
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
  })
  it('refuses a blank gain or missing declaration without calling the save service', async () => {
    const s = await panel()
    await s.enable(); await s.value('input[type="number"]', '')
    await s.click('保存音量调整要求')
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('有效')
    await s.value('input[type="number"]', '-3')
    await s.click('保存音量调整要求')
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    expect(s.onSave).not.toHaveBeenCalled()
    expect(s.onPending).toHaveBeenLastCalledWith(true)
  })
})
