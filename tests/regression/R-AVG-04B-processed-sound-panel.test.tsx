import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import SoundReviewPanel from '../../src/components/avg/SoundReviewPanel'
import SoundProductionPanel from '../../src/components/avg/SoundProductionPanel'
import type SoundAuditionPlayer from '../../src/components/avg/SoundAuditionPlayer'
import type OriginalAudioComparisonPlayer from '../../src/components/avg/OriginalAudioComparisonPlayer'
import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../../src/lib/types'
import { readAvgRawSoundCandidateV1, readAvgSoundCandidateV1, stageAvgSoundReviewV1, stageAvgSoundChoiceV1 } from '../../src/lib/avg/sound-workbench-service'
import { avgSoundReviewCriteriaV1 } from '../../src/lib/avg/sound-review'
import type { AvgSoundReviewIssuesV3 } from '../../src/lib/avg/sound-review-contract'

vi.mock('../../src/lib/avg/sound-workbench-service', () => ({ readAvgRawSoundCandidateV1: vi.fn(), readAvgSoundCandidateV1: vi.fn(), stageAvgSoundReviewV1: vi.fn(), stageAvgSoundChoiceV1: vi.fn() }))
vi.mock('../../src/lib/avg/assembly-service', () => ({ confirmAvgWorkspaceInputV1: vi.fn() }))
vi.mock('../../src/lib/avg/sound-author-service', () => ({ configureAvgChosenSoundDraftV1: vi.fn() }))
vi.mock('../../src/lib/avg/sound-production-brief', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/lib/avg/sound-production-brief')>(),
  avgSoundProductionExecutionReadyV1: () => true,
}))
vi.mock('../../src/lib/avg/sound-production-plan', () => ({ AVG_SOUND_PROPOSAL_KEY_V1: 'avg.proposal.sound-plan', AVG_SOUND_PLAN_KEY_V1: 'avg.media.sound-plan', AVG_SOUND_COMPILED_KEY_V1: 'avg.media.compiled-sound-requirements' }))
vi.mock('../../src/lib/product-production/service', () => ({ stopProductProductionV1: vi.fn() }))
vi.mock('../../src/components/avg/SoundPlanPanel', () => ({ default: () => null }))
vi.mock('../../src/components/avg/OriginalAudioComparisonPlayer', () => ({ default: (props: ComponentProps<typeof OriginalAudioComparisonPlayer>) =>
  <div data-comparison data-hash={props.expectedContentHash}><button onClick={() => void props.loadSource()}>读取只读原件</button></div> }))
vi.mock('../../src/components/avg/SoundAuditionPlayer', () => ({ default: (props: ComponentProps<typeof SoundAuditionPlayer>) => <div data-player data-duration={props.durationMs} data-channels={props.channelCount}>
  {[1, 2].map(cycles => <button key={cycles} onClick={() => props.onObservation({ audioHash: props.contentHash, requestIdentityHash: props.requestIdentityHash,
    audition: { generation: `audition.fixture.${cycles}`, outcome: 'ended', durationMs: props.durationMs, playedMs: props.durationMs * cycles,
      completedCycles: cycles, continuousLoops: cycles - 1, volume: 1, muted: false, playbackRate: 1, seeked: false } })}>听{cycles}遍</button>)}
</div> }))

const hash = (letter: string) => letter.repeat(64)
const scope: WorkspaceScope = { projectId: 1, worldId: 2, workId: 3 }
const reference = (row: ProductBuildArtifactRecordV1) => ({ artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash })
const raw: ProductBuildArtifactRecordV1 = { projectId: 1, worldId: 2, workId: 3, buildId: 4, controlEpoch: 1,
  artifactKey: 'avg.sound.raw.desk.bgm', requirementKey: null, version: 1, kind: 'audio', mediaKind: 'bgm', status: 'accepted', producerRunId: 5,
  producerReceiptHash: hash('a'), inputHash: hash('a'), contentHash: hash('a'), payloadJson: '{}', metadataJson: '{}', qualityJson: '{}', rightsJson: '{}',
  blobObjectId: 6, mimeType: 'audio/wav', byteSize: 96_044, parentArtifactHash: null, carriedFrom: null, createdAt: 1, updatedAt: 1 }
const processed = { ...raw, artifactKey: 'avg.sound.processed.desk.bgm', contentHash: hash('b'), producerReceiptHash: hash('c') }
const template = { requirementKey: 'desk.bgm', assetKey: 'sound.desk.bgm', purpose: '宁静的背景音乐', channel: 'bgm',
  consumer: { sceneKey: 'desk' }, source: { kind: 'generate-music' }, cue: { loop: true, phase: 'before', volume: .2, beatKey: 'line.desk' } }
const measurement = { contentHash: processed.contentHash, durationMs: 1000, channelCount: 1, decodedSampleRateHz: 48000,
  integratedLufs: -18.4, truePeakDbtp: -1.2, loopSeamDbfs: -36.1 }
const asset = { assetKey: template.assetKey, version: 1, kind: 'bgm', name: '背景音乐', altText: template.purpose,
  mimeType: 'audio/wav', byteSize: 96_044, contentHash: processed.contentHash, blobContentHash: processed.contentHash, width: null, height: null,
  durationMs: 1000, source: 'local', license: 'author-review-required', characterTag: '', sceneTag: 'desk' }
function selection(derived = true) {
  const actual = derived ? measurement : { ...measurement, contentHash: raw.contentHash }
  return { raw, ...(derived ? { processed } : {}), payload: { requirement: { template, identityHash: hash('d'), dispatch: { operation: 'generate-music' } },
    measurement: { ...measurement, contentHash: raw.contentHash, durationMs: 500, channelCount: 2 }, providerResult: {} },
  asset: { ...asset, contentHash: actual.contentHash, blobContentHash: actual.contentHash }, data: new ArrayBuffer(96_044), measurement: actual,
    originalMeasurement: { ...measurement, contentHash: raw.contentHash, durationMs: 500, channelCount: 2, decodedSampleRateHz: 44100,
      integratedLufs: -24.7, truePeakDbtp: -4.6, loopSeamDbfs: -28.3 }, sourceKey: derived ? 'processed.fixture' : 'raw.fixture' } as unknown as Awaited<ReturnType<typeof readAvgSoundCandidateV1>>
}
function report(audioHash = processed.contentHash): AvgSoundReviewIssuesV3 {
  return { schema: 'storyforge.avg.review-issues', version: 3, targetKey: template.requirementKey, observations: ['audio'], unobserved: [], issues: [],
    soundEvidence: { audioHash, requestIdentityHash: hash('d'), note: '作者完整原速审听后记录本轮观察。',
      audition: { generation: 'audition.fixture', outcome: 'ended', durationMs: 1000, playedMs: 2000, completedCycles: 2, continuousLoops: 1,
        muted: false, volume: 1, playbackRate: 1, seeked: false },
      checks: avgSoundReviewCriteriaV1(selection().payload).map(criterion => ({ criterion, result: 'pass', note: '已观察此项。' })) } }
}
function review(audioHash = processed.contentHash) { return { ...raw, artifactKey: 'avg.review.audio.desk.bgm', payloadJson: JSON.stringify(report(audioHash)), metadataJson: JSON.stringify({ candidateHash: hash('e') }) } }
function pendingChoice() {
  return { ...raw, artifactKey: 'avg.sound.choice.desk.bgm', status: 'pending' as const, metadataJson: JSON.stringify({ candidateHash: hash('e') }),
    payloadJson: JSON.stringify({ schema: 'storyforge.avg.sound-choice', version: 2, requirementKey: template.requirementKey, requestIdentityHash: hash('d'),
      raw: reference(raw), processed: { ...reference(processed), recipeHash: hash('f'), receiptHash: hash('c') }, review: reference(review()), asset,
      declaration: '确认的是这份加工声音的适用权利。' }) }
}
let root: Root, host: HTMLDivElement
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.mocked(readAvgSoundCandidateV1).mockResolvedValue(selection()) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const base = () => ({ scope, productionId: 7, raw, disabled: false, canAdopt: true, declaration: '确认这份声音及适用权利。',
  onPending: vi.fn(), onAction: async (action: () => Promise<void>) => action(), onReload: vi.fn(async () => {}) })
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!
const click = (text: string) => act(async () => { expect(button(text)?.disabled).toBe(false); button(text).click() })
const note = (value: string) => act(async () => { const input = host.querySelector('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })

describe('AVG independently reviewed processed sound in the original workbench', () => {
  it('waits for required processing without reading or signing for the original', async () => {
    await act(async () => root.render(<SoundReviewPanel {...base()} processingRequired pendingReview={review()} pendingChoice={pendingChoice()}/>))
    expect(host.textContent).toContain('等待本批已确认的音量加工完成')
    expect(readAvgSoundCandidateV1).not.toHaveBeenCalled(); expect(host.querySelector('[data-player]')).toBeNull()
    expect(button('确认这份声音观察').disabled).toBe(true); expect(button('确认采用加工声音').disabled).toBe(true)
    expect(host.textContent).toContain('确认的是这份加工声音的适用权利。')
  })
  it('uses the selected measurement and sends the exact derivative to review and choice staging', async () => {
    await act(async () => root.render(<SoundReviewPanel {...base()} processingRequired processed={processed} review={review()}/>))
    expect(readAvgSoundCandidateV1).toHaveBeenCalledWith({ scope, productionId: 7, raw: reference(raw), processed: reference(processed) })
    expect(host.querySelector('[data-player]')?.getAttribute('data-duration')).toBe('1000')
    expect(host.querySelector('[data-player]')?.getAttribute('data-channels')).toBe('1')
    expect(host.textContent).toContain('48,000 Hz'); expect(host.textContent).toContain('-18.4 LUFS')
    expect(host.textContent).toContain('-1.2 dBTP'); expect(host.textContent).toContain('原始声音基准')
    expect(host.textContent).toContain('-24.7 LUFS'); expect(host.textContent).toContain('不是专业听感')
    await click('将加工声音列为待确认选择')
    expect(stageAvgSoundChoiceV1).toHaveBeenCalledWith(expect.objectContaining({ raw: reference(raw), processed: reference(processed) }))
    await click('听2遍'); await note('加工后独立听完整两轮，记录本次观察。'); await click('保存为待确认声音观察')
    expect(stageAvgSoundReviewV1).toHaveBeenCalledWith(expect.objectContaining({ raw: reference(raw), processed: reference(processed),
      report: expect.objectContaining({ soundEvidence: expect.objectContaining({ audioHash: processed.contentHash,
        audition: expect.objectContaining({ durationMs: 1000, completedCycles: 2 }) }) }) }))
  })
  it('refuses an original-hash review for the processed target and retains unprocessed V1 behavior', async () => {
    const props = base()
    await act(async () => root.render(<SoundReviewPanel {...props} processed={processed} review={review(raw.contentHash)}/>))
    expect(button('将加工声音列为待确认选择').disabled).toBe(true)
    vi.mocked(readAvgSoundCandidateV1).mockResolvedValue(selection(false))
    await act(async () => root.render(<SoundReviewPanel {...props} review={review(raw.contentHash)}/>))
    await click('将原声音列为待确认选择')
    expect(stageAvgSoundChoiceV1).toHaveBeenCalledWith({ scope, productionId: 7, raw: reference(raw), declaration: props.declaration })
  })
  it('clears original observations for a same-byte derivative and again for a changed producer receipt', async () => {
    const props = base(), sameBytes = { ...processed, contentHash: raw.contentHash }
    vi.mocked(readAvgSoundCandidateV1).mockResolvedValue(selection(false))
    await act(async () => root.render(<SoundReviewPanel {...props}/>)); await click('听2遍'); await note('原件的未保存观察。')
    await act(async () => root.render(<SoundReviewPanel {...props} processingRequired processed={sameBytes}/>))
    expect(host.querySelector('textarea')!.value).toBe(''); expect(host.querySelector('select')!.value).toBe('unknown')
    await note('本加工版本的未保存观察。')
    await act(async () => root.render(<SoundReviewPanel {...props} processingRequired processed={{ ...sameBytes, producerReceiptHash: hash('f') }}/>))
    expect(host.querySelector('textarea')!.value).toBe(''); expect(readAvgSoundCandidateV1).toHaveBeenCalledTimes(3)
  })
  it('keeps two continuous original-speed cycles mandatory for a looping derivative', async () => {
    await act(async () => root.render(<SoundReviewPanel {...base()} processed={processed}/>))
    const loop = () => host.querySelector<HTMLSelectElement>('select[aria-label="循环接缝"]')!.querySelector<HTMLOptionElement>('option[value="pass"]')!
    await click('听1遍'); expect(loop().disabled).toBe(true)
    await click('听2遍'); expect(loop().disabled).toBe(false)
  })
  it('switches to an exact read-only original, removes candidate playback and resets unsaved observations on return', async () => {
    await act(async () => root.render(<SoundReviewPanel {...base()} processed={processed} review={review()}
      pendingReview={review()} pendingChoice={pendingChoice()}/>))
    expect(readAvgRawSoundCandidateV1).not.toHaveBeenCalled()
    const pass = () => host.querySelector<HTMLSelectElement>('select[aria-label="循环接缝"]')!.querySelector<HTMLOptionElement>('option[value="pass"]')!
    await click('听2遍'); expect(pass().disabled).toBe(false)
    await click('对照原始声音（只读）')
    expect(host.querySelector('[data-player]')).toBeNull()
    expect(host.querySelector('[data-comparison]')?.getAttribute('data-hash')).toBe(raw.contentHash)
    expect(host.querySelector('fieldset')!.disabled).toBe(true)
    expect(button('确认这份声音观察').disabled).toBe(true)
    expect(button('将加工声音列为待确认选择').disabled).toBe(true)
    expect(button('确认采用加工声音').disabled).toBe(true)
    await click('读取只读原件')
    expect(readAvgRawSoundCandidateV1).toHaveBeenCalledWith({ scope, productionId: 7, raw: reference(raw) })
    expect(stageAvgSoundReviewV1).not.toHaveBeenCalled(); expect(stageAvgSoundChoiceV1).not.toHaveBeenCalled()
    await click('审听加工候选')
    expect(host.querySelector('[data-comparison]')).toBeNull(); expect(host.querySelector('[data-player]')).not.toBeNull()
    expect(host.querySelector('select')!.value).toBe('unknown'); expect(pass().disabled).toBe(true)
    expect(host.querySelector('fieldset')!.disabled).toBe(false)
  })
  it('allows only the read-only original while the required processed sound is still pending', async () => {
    await act(async () => root.render(<SoundReviewPanel {...base()} processingRequired/>))
    await click('对照原始声音（只读）'); await click('读取只读原件')
    expect(readAvgRawSoundCandidateV1).toHaveBeenCalledWith({ scope, productionId: 7, raw: reference(raw) })
    expect(readAvgSoundCandidateV1).not.toHaveBeenCalled(); expect(host.querySelector('[data-player]')).toBeNull()
    expect(host.querySelector('fieldset')).toBeNull(); expect(stageAvgSoundReviewV1).not.toHaveBeenCalled()
  })
  it('continues local processing after originals arrive and disables execution only after required targets arrive', async () => {
    const props = { scope, disabled: false, canAdopt: true, sourcesReady: true, declaration: '本批权利确认。', visible: true, generating: false,
      onPending: vi.fn(), onAction: async (action: () => Promise<void>) => action(), onReload: vi.fn(async () => {}), onGenerate: vi.fn(async () => {}), onCancel: vi.fn(), onNotice: vi.fn() }
    const view = { details: { production: { id: 7, status: 'producing' }, build: { id: 4, briefRevision: 1, failureJson: '{}', previewHash: '', status: 'building' }, brief: { revision: 1 },
      executionBrief: { avgSoundPlanning: { version: 1, scope: { templates: [template] } }, avgAudioProcessing: { entries: [{ domain: 'sound', requirementKey: template.requirementKey }] } } },
      artifacts: [raw, { ...raw, artifactKey: 'avg.proposal.sound-plan' }, { ...raw, artifactKey: 'avg.media.sound-plan' }], draft: { revision: 1 }, soundProgress: {}, soundRecordedUsage: {} } as unknown as ComponentProps<typeof SoundProductionPanel>['view']
    await act(async () => root.render(<SoundProductionPanel {...props} view={view}/>))
    await click('继续本批声音制作'); expect(props.onGenerate).toHaveBeenCalledTimes(1)
    await click('查看并审听加工声音'); expect(host.textContent).toContain('等待本批已确认的音量加工完成'); expect(readAvgSoundCandidateV1).not.toHaveBeenCalled()
    await act(async () => root.render(<SoundProductionPanel {...props} view={{ ...view, artifacts: [...view.artifacts, processed] }}/>))
    expect(button('继续本批声音制作').disabled).toBe(true)
    expect(readAvgSoundCandidateV1).toHaveBeenCalledWith({ scope, productionId: 7, raw: reference(raw), processed: reference(processed) })
  })
})
