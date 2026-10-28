import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import SoundLocalRepairPanel from '../../src/components/avg/SoundLocalRepairPanel'
import { readAvgAdoptedGeneratedSoundV1 } from '../../src/lib/avg/stage-sound-sources'
import { saveAvgSoundLocalRepairDraftV1, clearAvgSoundLocalRepairDraftV1 } from '../../src/lib/avg/sound-local-repair-service'

// Form projection only. Actual source/producer/adoption authority belongs to
// the service tests; these controlled readers never calculate or play audio.
vi.mock('../../src/lib/avg/stage-sound-sources', () => ({ readAvgAdoptedGeneratedSoundV1: vi.fn() }))
vi.mock('../../src/lib/avg/sound-local-repair-service', () => ({ saveAvgSoundLocalRepairDraftV1: vi.fn(), clearAvgSoundLocalRepairDraftV1: vi.fn() }))
type Props = ComponentProps<typeof SoundLocalRepairPanel>
type Target = Awaited<ReturnType<typeof readAvgAdoptedGeneratedSoundV1>>
const scope = { projectId: 1, worldId: 2, workId: 3 }
const source = (key: string) => ({ version: 2, requirementKey: key })
const template = { requirementKey: 'sound.bgm', purpose: '保留对白空间的书桌音乐', channel: 'bgm', cue: { loop: true } }
const recipe = { schema: 'storyforge.avg.audio-processing-recipe', version: 1, gainMilliDb: -3000, maximumDurationMs: 12_000,
  sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject', declaration: '相对原音频调整，仅保存返修要求。' }
const workspace = () => ({ presentation: { inheritedSounds: ['bgm', 'sfx', 'ogg'].map(key => ({ assetKey: `sound.${key}`, source: source(`sound.${key}`) })),
  stage: { assets: ['bgm', 'sfx', 'ogg'].map(key => ({ assetKey: `sound.${key}`, name: key === 'bgm' ? '书桌音乐' : key === 'sfx' ? '按键音效' : '旧OGG',
    kind: key === 'bgm' ? 'bgm' : 'sfx', mimeType: key === 'ogg' ? 'audio/ogg' : 'audio/wav' })) } } }) as unknown as Props['workspace']
const target = (key = 'sound.bgm') => ({ asset: { assetKey: key, mimeType: 'audio/wav', durationMs: 9000 },
  originalAsset: { mimeType: 'audio/wav', durationMs: 12_000 }, rawPayload: { requirement: { template: { ...template, requirementKey: key } } } }) as Target
const view = { draft: { revision: 12 }, details: { build: { id: 7, buildNumber: 3, stateRevision: 9, previewHash: 'exact-preview' } } } as Props['view']
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.mocked(readAvgAdoptedGeneratedSoundV1).mockResolvedValue(target())
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(row => row.textContent === text)!
const click = (text: string) => act(async () => { expect(button(text)?.disabled).toBe(false); button(text).click() })
const value = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, text: string) => act(async () => {
  const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, text)
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
})
async function render(overrides: Partial<Props> = {}) {
  const props: Props = { scope, workspace: workspace(), view, enabled: true, disabled: false, canEdit: true,
    onPending: vi.fn(), onAction: async action => { try { await action() } catch { /* Retain the form error. */ } },
    onReload: vi.fn(async () => {}), onNotice: vi.fn(), ...overrides }
  await act(async () => root.render(<SoundLocalRepairPanel {...props}/>)); return props
}
const select = () => host.querySelector('select')!
const save = '以当前预览保存此声音返修'
const cancel = '撤销未保存的声音返修选择'

describe('AVG one adopted sound local repair form', () => {
  it('hides new proposals by default but keeps saved proposals readable and explicitly removable', async () => {
    const s = await render({ enabled: undefined })
    expect(host.textContent).toBe(''); expect(readAvgAdoptedGeneratedSoundV1).not.toHaveBeenCalled()
    expect(s.onPending).toHaveBeenLastCalledWith(false)
    const saved = { ...workspace(), soundLocalRepair: { source: source('sound.bgm'), sourceScope: { templates: [template] },
      sourceAsset: { assetKey: 'sound.bgm', name: '书桌音乐' }, parent: { buildNumber: 3 }, recipe, declaration: recipe.declaration } } as Props['workspace']
    const current = await render({ workspace: saved, enabled: false })
    expect(host.textContent).toContain(template.purpose); expect(host.textContent).toContain('重新核对方案并明确开始')
    expect(host.querySelector('select')).toBeNull(); expect(button(save)).toBeUndefined()
    await click('撤销尚未开始的声音返修要求')
    expect(clearAvgSoundLocalRepairDraftV1).toHaveBeenCalledWith({ scope, expectedDraftRevision: 12 })
    expect(current.onReload).toHaveBeenCalledOnce(); expect(saveAvgSoundLocalRepairDraftV1).not.toHaveBeenCalled()
  })
  it('uses a verified original duration, exact Preview fences and recipe1 while keeping its own pending form usable', async () => {
    const s = await render()
    expect(Array.from(select().options).map(option => option.value)).toEqual(['', 'sound.bgm', 'sound.sfx'])
    expect(Array.from(host.querySelectorAll('button')).some(row => /开始|生成/.test(row.textContent ?? ''))).toBe(false)
    await value(select(), 'sound.bgm')
    expect(s.onPending).toHaveBeenLastCalledWith(true); expect(host.textContent).toContain(template.purpose)
    expect(readAvgAdoptedGeneratedSoundV1).toHaveBeenCalledWith({ scope, source: source('sound.bgm') })
    expect(host.querySelectorAll('select')[1].value).toBe('preserve')
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    await value(host.querySelector('textarea')!, recipe.declaration); await click(save)
    expect(saveAvgSoundLocalRepairDraftV1).toHaveBeenCalledWith({ scope, expectedDraftRevision: 12, expectedBuildId: 7,
      expectedBuildRevision: 9, expectedPreviewHash: 'exact-preview', assetKey: 'sound.bgm', recipe })
    expect(s.onReload).toHaveBeenCalledOnce(); expect(s.onPending).toHaveBeenLastCalledWith(false)
  })
  it('submits an explicit recipe2, blocks invalid rates and retains failed edits until author cancellation', async () => {
    const s = await render(); await value(select(), 'sound.bgm')
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await value(host.querySelectorAll('select')[1], 'explicit'); await value(host.querySelector<HTMLInputElement>('input[list]')!, '48001')
    await value(host.querySelector('textarea')!, recipe.declaration)
    expect(button(save).disabled).toBe(true); expect(saveAvgSoundLocalRepairDraftV1).not.toHaveBeenCalled()
    await value(host.querySelector<HTMLInputElement>('input[list]')!, '24000')
    vi.mocked(saveAvgSoundLocalRepairDraftV1).mockRejectedValueOnce(new Error('准确预览已变化'))
    await click(save)
    expect(saveAvgSoundLocalRepairDraftV1).toHaveBeenCalledWith(expect.objectContaining({ recipe: { ...recipe, version: 2,
      sampleRatePolicy: 'explicit', targetSampleRateHz: 24000, resampler: 'blackman-sinc64.v1', processingOrder: 'resample-gain-linked-limit.v1',
      dynamics: { processor: 'linked-lookahead-peak-limit.v1', ceilingMilliDbfs: -1500, lookaheadMs: 3, releaseMs: 80 } } }))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('准确预览已变化')
    expect(s.onPending).toHaveBeenLastCalledWith(true); expect(host.querySelector<HTMLInputElement>('input[list]')!.value).toBe('24000')
    await click(cancel); expect(s.onPending).toHaveBeenLastCalledWith(false); expect(select().value).toBe('')
    await value(select(), 'sound.bgm'); expect(host.querySelectorAll('select')[1].value).toBe('preserve')
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
  })
  it('ignores a stale source read after a different selection or cancellation', async () => {
    let resolveOld!: (value: Target) => void
    vi.mocked(readAvgAdoptedGeneratedSoundV1).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    const s = await render(); await value(select(), 'sound.bgm')
    expect(button(save).disabled).toBe(true); expect(host.querySelector('[role="status"]')?.textContent).toContain('正在核对')
    await value(select(), 'sound.sfx')
    expect(button(save).disabled).toBe(true) // The controlled second result still names the first slot.
    await act(async () => resolveOld(target())); expect(button(save).disabled).toBe(true)
    await click(cancel); expect(s.onPending).toHaveBeenLastCalledWith(false); expect(host.querySelector('textarea')).toBeNull()
    expect(saveAvgSoundLocalRepairDraftV1).not.toHaveBeenCalled()
  })
})
