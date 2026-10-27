/** Actual player/host parents and governed source/Run APIs. PCM is synthetic;
 * no provider call, real listening acceptance or adoption is asserted here. */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TtrpgOpenPlayTable, { type TtrpgPlayTablePropsV1 } from '../../src/components/ttrpg/TtrpgOpenPlayTable'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { sendTtrpgOpenTableMessageV1 } from '../../src/lib/ttrpg/open-table-service'
import { prepareTtrpgOpenVoiceCandidateV1 } from '../../src/lib/ttrpg/open-audio-service'
import { setupVoiceCandidateFixtureV1 } from '../helpers/open-voice-candidate'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
let createDescriptor: PropertyDescriptor | undefined, revokeDescriptor: PropertyDescriptor | undefined
const button = (name: string) => [...host.querySelectorAll('button')].find(row => row.textContent === name)!
async function until(check: () => boolean) {
  for (let i = 0; i < 1500; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); if (check()) return }
  throw new Error('Parent voice UI did not settle: ' + host.textContent)
}
async function click(name: string) { expect(button(name), name).toBeTruthy(); await act(async () => button(name).click()) }
async function select(label: string, value: string) {
  await act(async () => { const node = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!; node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })) })
}
beforeEach(async () => {
  vi.stubEnv('VITE_ENABLE_TTRPG_OPEN_PREVIEW', '1'); localStorage.clear(); await db.delete(); await db.open()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL'); revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:parent-original-voice') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
  if (createDescriptor) Object.defineProperty(URL, 'createObjectURL', createDescriptor); else Reflect.deleteProperty(URL, 'createObjectURL')
  if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor); else Reflect.deleteProperty(URL, 'revokeObjectURL')
  localStorage.clear(); db.close()
})
describe('R-TTRPGOPEN10 original candidate survives actual parent progress refresh', { timeout: 120000 }, () => {
  for (const humanGm of [true, false]) it(`${humanGm ? 'host' : 'player fallback'} retains original manual audition across a real message and clears it on identity handoff`, async () => {
    const f = await setupVoiceCandidateFixtureV1(true, humanGm)
    await prepareTtrpgOpenVoiceCandidateV1(f.review)
    let props: TtrpgPlayTablePropsV1
    const refresh = async () => {
      props = { ...props, session: (await db.productRuntimeSessions.get(f.owner.sessionId))!, state: await readProductRuntimeState(f.owner.sessionId) }
      root.render(createElement(TtrpgOpenPlayTable, props))
    }
    props = { scope: f.owner.scope, session: (await db.productRuntimeSessions.get(f.owner.sessionId))!, state: await readProductRuntimeState(f.owner.sessionId), onChanged: refresh, onCheckpoint: async () => undefined }
    await act(async () => root.render(createElement(TtrpgOpenPlayTable, props)))
    await until(() => !!host.querySelector('[aria-label="我的角色"]'))
    if (humanGm) {
      await select('我的主持席位', f.owner.viewerKey)
      await act(async () => { const label = [...host.querySelectorAll('label')].find(row => row.textContent?.includes('我是本桌真人主持'))!; label.querySelector('input')!.click() })
      await click('确认主持身份并进入')
    } else { await select('我的角色', f.owner.viewerKey); await click('确认身份并进入') }
    await until(() => !!host.querySelector('[data-testid="ttrpg-open-voice-studio"]'))
    const studio = host.querySelector<HTMLDetailsElement>('[data-testid="ttrpg-open-voice-studio"]')!
    await act(async () => { studio.open = true })
    await until(() => !!host.querySelector(`[aria-label="原配音记录"] option[value="${f.input.requestKey}"]`))
    await select('原配音记录', f.input.requestKey); await click('核对原音频候选')
    await until(() => !!host.querySelector('[data-testid="ttrpg-voice-candidate"]'))
    await until(() => !!button('开启本机音频') && !button('开启本机音频').disabled); await click('开启本机音频'); await until(() => !!button('准备这条候选试听') && !button('准备这条候选试听').disabled); await click('准备这条候选试听')
    await until(() => !!host.querySelector('audio[aria-label="候选配音试听"]'))
    const original = host.querySelector<HTMLAudioElement>('audio[aria-label="候选配音试听"]')!, before = await readProductRuntimeState(f.owner.sessionId)
    const requests = before.ttrpg!.openRun!.voiceRequests, worlds = await db.worldReleases.toArray()
    await act(async () => {
      await sendTtrpgOpenTableMessageV1({ ...f.owner, submissionKey: 'parent-refresh-message', request: { kind: 'out-of-character', audience: 'party', text: '先核对原配音，再继续冒险。' } })
      await refresh()
    })
    await until(() => !!host.querySelector('[data-testid="ttrpg-open-voice-studio"]') && !host.textContent?.includes('正在读取主持进度'))
    expect(host.querySelector('[data-testid="ttrpg-open-voice-studio"]')).toBe(studio)
    expect(studio.open).toBe(true); expect(host.querySelector('audio[aria-label="候选配音试听"]')).toBe(original)
    expect(original.getAttribute('src')).toBe('blob:parent-original-voice')
    expect((host.querySelector('[aria-label="原配音记录"]') as HTMLSelectElement).value).toBe(f.input.requestKey)
    expect(host.querySelector('[data-testid="ttrpg-voice-candidate"]')).not.toBeNull()
    const after = await readProductRuntimeState(f.owner.sessionId)
    expect(after.lastSequence).toBe(before.lastSequence + 1); expect(after.entities).toEqual(before.entities)
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime); expect(after.ttrpg!.openRun!.voiceRequests).toEqual(requests)
    expect(await db.worldReleases.toArray()).toEqual(worlds); expect(await db.productMediaAssets.count()).toBe(0)
    expect(f.execute).toHaveBeenCalledTimes(1); expect(f.fetcher).not.toHaveBeenCalled(); expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    const handoff = humanGm ? '返回身份选择' : '交接给另一位玩家'
    await until(() => !!button(handoff) && !button(handoff).disabled); await click(handoff)
    expect(host.querySelector('[data-testid="ttrpg-voice-candidate"]')).toBeNull()
    expect(original.getAttribute('src')).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:parent-original-voice')
    expect(f.execute).toHaveBeenCalledTimes(1); expect(f.fetcher).not.toHaveBeenCalled()
  })
})
