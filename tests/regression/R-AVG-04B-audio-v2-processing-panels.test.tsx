import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import VoiceProcessingDraftPanel from '../../src/components/avg/VoiceProcessingDraftPanel'
import SoundProcessingDraftPanel from '../../src/components/avg/SoundProcessingDraftPanel'
import VoiceLocalRepairPanel from '../../src/components/avg/VoiceLocalRepairPanel'
import type { AvgAudioProductionProcessingPlan } from '../../src/lib/avg/audio-production-contract'
import type { AvgAudioProcessingRecipeV2 } from '../../src/lib/avg/audio-processing-contract-v2'
import type { AvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { readAvgAdoptedGeneratedVoice } from '../../src/lib/avg/generated-voice-source'
import { saveAvgSoundProcessingDraftV1 } from '../../src/lib/avg/sound-draft-service'
import { saveAvgVoiceLocalRepairDraftV2 } from '../../src/lib/avg/voice-local-repair-service'

// Form projection only: strict versioned codecs and actual processing have
// separate contract/producer tests. These controlled children make no audio.
vi.mock('../../src/lib/avg/voice-processing-draft-contract', () => ({ assertAvgVoiceProcessingDraft: (value: unknown) => value }))
vi.mock('../../src/lib/avg/sound-processing-draft-contract', () => ({ assertAvgSoundProcessingDraft: (value: unknown) => value,
  avgSoundProcessingDraftTargetsV1: () => [{ mimeType: 'audio/wav' }, { mimeType: 'audio/wav' }] }))
vi.mock('../../src/lib/avg/audio-production-brief', () => ({ avgAudioProcessingExecutionReadyV1: () => false }))
vi.mock('../../src/lib/avg/sound-draft-service', () => ({ saveAvgSoundProcessingDraftV1: vi.fn() }))
vi.mock('../../src/lib/avg/generated-voice-source', () => ({ readAvgAdoptedGeneratedVoice: vi.fn() }))
vi.mock('../../src/lib/avg/voice-local-repair-service', () => ({ saveAvgVoiceLocalRepairDraftV2: vi.fn(), clearAvgVoiceLocalRepairDraftV2: vi.fn() }))

const scope = { projectId: 1, worldId: 2, workId: 3 }
const requirements = [0, 1].map(i => ({ requirementKey: `voice.${i}`, text: `台词${i}`, maximumDurationMs: 12_000 })) as ComponentProps<typeof VoiceProcessingDraftPanel>['requirements']
const recipe1 = { schema: 'storyforge.avg.audio-processing-recipe' as const, version: 1 as const, gainMilliDb: -3000, maximumDurationMs: 12_000,
  sampleRatePolicy: 'preserve' as const, channelPolicy: 'preserve' as const, timelinePolicy: 'preserve' as const, overflowPolicy: 'reject' as const, declaration: '保留原件，仅保存调整要求。' }
const dynamics = { processor: 'linked-lookahead-peak-limit.v1' as const, ceilingMilliDbfs: -1500, lookaheadMs: 3, releaseMs: 80 }
const recipe2: AvgAudioProcessingRecipeV2 = { ...recipe1, version: 2, maximumDurationMs: 19_000, sampleRatePolicy: 'explicit', targetSampleRateHz: 22050,
  resampler: 'blackman-sinc64.v1', processingOrder: 'resample-gain-linked-limit.v1', dynamics: { ...dynamics, lookaheadMs: 7, releaseMs: 220 } }
function saved(domain: 'voice' | 'sound'): AvgAudioProductionProcessingPlan {
  return { schema: 'storyforge.avg.audio-production-processing-plan', version: 2, entries: [
    { domain, requirementKey: `${domain}.0`, recipe: { ...recipe1 } }, { domain, requirementKey: `${domain}.1`, recipe: structuredClone(recipe2) }] }
}
function workspace(plan?: AvgAudioProductionProcessingPlan): AvgAuthorWorkspaceV1 {
  return { soundProduction: { scope: { templates: [0, 1].map(i => ({ requirementKey: `sound.${i}`, channel: 'bgm', purpose: `音乐用途${i}`,
    source: { kind: 'generate-music', durationSeconds: 12 } })) } }, soundProcessing: plan } as unknown as AvgAuthorWorkspaceV1
}
let root: Root, host: HTMLDivElement
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!
const click = (text: string) => act(async () => { expect(button(text)?.disabled).toBe(false); button(text).click() })
const toggle = (element: HTMLInputElement) => act(async () => element.click())
const value = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, text: string) => act(async () => {
  const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, text)
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
})
const row = (index = 0) => host.querySelectorAll<HTMLFieldSetElement>('fieldset > fieldset')[index]
const enabled = (index = 0) => row(index).querySelector<HTMLInputElement>('input[type="checkbox"]')!
const peaks = (index = 0) => row(index).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]
const rateMode = (index = 0) => row(index).querySelector('select')!
const rateInput = (index = 0) => row(index).querySelector<HTMLInputElement>('input[list]')!
const declaration = (index = 0) => row(index).querySelector('textarea')!
async function voice(plan?: AvgAudioProductionProcessingPlan, success = true) {
  const onPending = vi.fn(), onSave = vi.fn(async (_value: AvgAudioProductionProcessingPlan | null) => success)
  await act(async () => root.render(<VoiceProcessingDraftPanel requirements={requirements} saved={plan} disabled={false} ready={false} onPending={onPending} onSave={onSave}/>))
  return { onPending, onSave }
}
async function sound(plan?: AvgAudioProductionProcessingPlan) {
  const onPending = vi.fn(), onReload = vi.fn(async () => {})
  await act(async () => root.render(<SoundProcessingDraftPanel scope={scope} workspace={workspace(plan)} expectedDraftRevision={8} disabled={false} canEdit
    onPending={onPending} onAction={async action => action()} onReload={onReload}/>))
  return { onPending, onReload }
}

describe('AVG explicit local audio V2 form choices', () => {
  it('keeps ordinary gain as exact recipe1/plan1 and the public processor closed', async () => {
    const s = await voice(); await toggle(enabled()); await value(declaration(), recipe1.declaration)
    expect(rateMode().value).toBe('preserve'); expect(peaks().checked).toBe(false)
    expect(host.textContent).toContain('正式加工尚未开放')
    await click('保存音量调整要求')
    expect(s.onSave).toHaveBeenCalledWith({ schema: 'storyforge.avg.audio-production-processing-plan', version: 1,
      entries: [{ domain: 'voice', requirementKey: 'voice.0', recipe: { ...recipe1, gainMilliDb: 0 } }] })
  })
  it('creates recipe2 only after an explicit peak choice and returns to recipe1 after clearing it', async () => {
    const s = await voice(); await toggle(enabled()); await value(declaration(), recipe1.declaration); await toggle(peaks())
    await click('保存音量调整要求')
    expect(s.onSave.mock.calls[0][0]).toMatchObject({ version: 2, entries: [{ recipe: { version: 2, sampleRatePolicy: 'preserve', targetSampleRateHz: null,
      dynamics, resampler: 'blackman-sinc64.v1', processingOrder: 'resample-gain-linked-limit.v1' } }] })
    await toggle(peaks()); await click('保存音量调整要求')
    expect(s.onSave.mock.calls[1][0]).toMatchObject({ version: 1, entries: [{ recipe: { version: 1 } }] })
    expect(s.onSave.mock.calls[1][0]!.entries[0].recipe).not.toHaveProperty('dynamics')
  })
  it('preserves another saved recipe2 exactly and supports an explicit nonpreset 8–48k integer rate', async () => {
    const plan = saved('voice'), before = structuredClone(plan), s = await voice(plan)
    await value(declaration(), '只修改第一句的说明。'); await click('保存音量调整要求')
    expect(s.onSave.mock.calls[0][0]!.entries[1]).toEqual(before.entries[1]); expect(plan).toEqual(before)
    await value(rateMode(), 'explicit'); await value(rateInput(), '12345'); await click('保存音量调整要求')
    expect(s.onSave.mock.calls[1][0]!.entries[0].recipe).toMatchObject({ version: 2, sampleRatePolicy: 'explicit', targetSampleRateHz: 12345, dynamics: null })
    expect(Array.from(row().querySelectorAll('datalist option')).map(o => o.getAttribute('value'))).toEqual(['16000', '22050', '24000', '44100', '48000'])
  })
  it('retains failed edits, rejects an empty/outside rate, and discards back to the saved version2 baseline', async () => {
    const s = await voice(saved('voice'), false)
    await value(rateMode(), 'explicit'); await value(rateInput(), '48001'); await click('保存音量调整要求')
    expect(s.onSave).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('采样率')
    await value(rateInput(), ''); await click('保存音量调整要求'); expect(s.onSave).not.toHaveBeenCalled()
    await value(rateInput(), '48000'); await click('保存音量调整要求')
    expect(s.onPending).toHaveBeenLastCalledWith(true); expect(rateInput().value).toBe('48000')
    await click('撤销未保存的音量调整'); expect(rateMode().value).toBe('preserve'); expect(rateMode(1).value).toBe('explicit')
    expect(rateInput(1).value).toBe('22050'); expect(peaks(1).checked).toBe(true); expect(s.onPending).toHaveBeenLastCalledWith(false)
  })
  it('keeps sound gain legacy and preserves a separate saved sound recipe2 while editing another entry', async () => {
    await sound(); await toggle(enabled()); await value(declaration(), recipe1.declaration); await click('保存声音音量调整要求')
    expect(saveAvgSoundProcessingDraftV1).toHaveBeenCalledWith(expect.objectContaining({ expectedDraftRevision: 8,
      plan: { schema: 'storyforge.avg.audio-production-processing-plan', version: 1, entries: [{ domain: 'sound', requirementKey: 'sound.0', recipe: { ...recipe1, gainMilliDb: 0 } }] } }))
    await act(async () => root.unmount()); root = createRoot(host)
    const plan = saved('sound'); await sound(plan); await value(declaration(), '只修改第一项声音。'); await click('保存声音音量调整要求')
    const submitted = vi.mocked(saveAvgSoundProcessingDraftV1).mock.calls[1][0].plan!
    expect(submitted).toMatchObject({ version: 2 }); expect(submitted.entries[1]).toEqual(plan.entries[1])
    await toggle(peaks()); await value(rateMode(), 'explicit'); await value(rateInput(), '8000'); await click('保存声音音量调整要求')
    expect(vi.mocked(saveAvgSoundProcessingDraftV1).mock.calls[2][0].plan!.entries[0].recipe).toMatchObject({ version: 2,
      dynamics, sampleRatePolicy: 'explicit', targetSampleRateHz: 8000 })
  })
})

async function repair() {
  const target = { requirement: { text: '准确原句', maximumDurationMs: 19_000 } } as Awaited<ReturnType<typeof readAvgAdoptedGeneratedVoice>>
  vi.mocked(readAvgAdoptedGeneratedVoice).mockResolvedValue(target)
  const workspace = { presentation: { inheritedVoices: [{ assetKey: 'voice.keeper', source: { version: 2, source: 'original-source' } }],
    stage: { assets: [{ assetKey: 'voice.keeper', name: '保管员' }] } } } as unknown as AvgAuthorWorkspaceV1
  const view = { draft: { revision: 12 }, details: { build: { id: 7, buildNumber: 3, stateRevision: 9, previewHash: 'frozen-preview' } } } as ComponentProps<typeof VoiceLocalRepairPanel>['view']
  const onPending = vi.fn(), onReload = vi.fn(async () => {})
  await act(async () => root.render(<VoiceLocalRepairPanel scope={scope} workspace={workspace} view={view} disabled={false} onPending={onPending}
    onAction={async action => action()} onReload={onReload} onNotice={vi.fn()}/>))
  await value(host.querySelector('select')!, 'voice.keeper'); await value(host.querySelector('textarea')!, '相对原件重新处理这一句。')
  return { onPending, onReload }
}
describe('AVG local repair preserves original-source scope for V2', () => {
  it('retains recipe1 by default and passes the exact original duration and parent preview fences', async () => {
    await repair(); await click('以当前预览保存此句音量返修')
    expect(saveAvgVoiceLocalRepairDraftV2).toHaveBeenCalledWith({ scope, expectedDraftRevision: 12, expectedBuildId: 7,
      expectedBuildRevision: 9, expectedPreviewHash: 'frozen-preview', assetKey: 'voice.keeper',
      recipe: { ...recipe1, maximumDurationMs: 19_000, declaration: '相对原件重新处理这一句。' } })
  })
  it('submits explicit V2 without a gain fallback, blocks invalid rates, and clears new selections on cancel', async () => {
    const s = await repair(); await toggle(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!)
    await value(host.querySelectorAll('select')[1], 'explicit'); await value(host.querySelector<HTMLInputElement>('input[list]')!, '48001')
    expect(button('以当前预览保存此句音量返修').disabled).toBe(true); expect(saveAvgVoiceLocalRepairDraftV2).not.toHaveBeenCalled()
    await value(host.querySelector<HTMLInputElement>('input[list]')!, '44100'); await click('以当前预览保存此句音量返修')
    expect(saveAvgVoiceLocalRepairDraftV2).toHaveBeenCalledWith(expect.objectContaining({ recipe: { ...recipe1, version: 2, maximumDurationMs: 19_000,
      declaration: '相对原件重新处理这一句。', sampleRatePolicy: 'explicit', targetSampleRateHz: 44100,
      dynamics, resampler: 'blackman-sinc64.v1', processingOrder: 'resample-gain-linked-limit.v1' } }))
    await click('撤销未保存的返修选择'); expect(s.onPending).toHaveBeenLastCalledWith(false)
    await value(host.querySelector('select')!, 'voice.keeper')
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    expect(host.querySelectorAll('select')[1].value).toBe('preserve')
  })
})
