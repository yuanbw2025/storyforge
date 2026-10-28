import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import VoiceReviewPanel from '../../src/components/avg/VoiceReviewPanel'
import type VoiceAuditionPlayer from '../../src/components/avg/VoiceAuditionPlayer'
import type OriginalAudioComparisonPlayer from '../../src/components/avg/OriginalAudioComparisonPlayer'
import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../../src/lib/types'
import { readAvgRawVoiceCandidateV3, readAvgVoiceCandidateV3, stageAvgAudioReviewV3, stageAvgVoiceChoiceV3 } from '../../src/lib/avg/assembly-service'

vi.mock('../../src/lib/avg/assembly-service', () => ({
  confirmAvgWorkspaceInputV1: vi.fn(), readAvgRawVoiceCandidateV3: vi.fn(), readAvgVoiceCandidateV3: vi.fn(), stageAvgAudioReviewV3: vi.fn(), stageAvgVoiceChoiceV3: vi.fn(),
}))
vi.mock('../../src/components/avg/OriginalAudioComparisonPlayer', () => ({ default: (props: ComponentProps<typeof OriginalAudioComparisonPlayer>) =>
  <div data-comparison data-hash={props.expectedContentHash}><button onClick={() => void props.loadSource()}>读取只读原件</button></div> }))
vi.mock('../../src/components/avg/VoiceAuditionPlayer', () => ({ default: (props: ComponentProps<typeof VoiceAuditionPlayer>) =>
  <div data-player data-hash={props.contentHash}/> }))

const hash = (value: string) => value.repeat(64)
const scope: WorkspaceScope = { projectId: 1, worldId: 2, workId: 3 }
const raw: ProductBuildArtifactRecordV1 = { projectId: 1, worldId: 2, workId: 3, buildId: 4, controlEpoch: 1,
  artifactKey: 'avg.voice.raw.line.desk', requirementKey: null, version: 1, kind: 'audio', mediaKind: 'voice', status: 'accepted',
  producerRunId: 5, producerReceiptHash: hash('a'), inputHash: hash('a'), contentHash: hash('a'), payloadJson: '{}', metadataJson: '{}',
  qualityJson: '{}', rightsJson: '{}', blobObjectId: 6, mimeType: 'audio/wav', byteSize: 96_044, parentArtifactHash: null,
  carriedFrom: null, createdAt: 1, updatedAt: 1 }
const processed = { ...raw, artifactKey: 'avg.voice.processed.line.desk', version: 2, contentHash: hash('b'), producerReceiptHash: hash('c') }
const baseMeasurement = { contentHash: raw.contentHash, mimeType: 'audio/wav' as const, byteSize: 96_044, durationMs: 4000, channelCount: 1,
  sourceSampleRateHz: 24_000, decodedSampleRateHz: 48_000, sampleCount: 192_000, integratedLufs: -26.1, truePeakDbtp: -3.7,
  decoder: 'storyforge.avg.pcm16-browser.v1' as const }
const derivedMeasurement = { ...baseMeasurement, contentHash: processed.contentHash, sourceSampleRateHz: 48_000,
  sampleCount: 192_000, integratedLufs: -18.3, truePeakDbtp: -1.5 }
let root: Root, host: HTMLDivElement

beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.mocked(readAvgVoiceCandidateV3).mockResolvedValue({
    raw, asset: { assetKey: 'voice.desk', contentHash: processed.contentHash, durationMs: 4000 }, data: new ArrayBuffer(96_044),
    sourceKey: 'voice.source.fixture', buildId: 4, buildNumber: 1, controlEpoch: 1,
    payload: { requirement: { requirementKey: 'line.desk', assetKey: 'voice.desk', text: '信封仍封着。', maximumDurationMs: 10_000 },
      request: { identityHash: hash('d') }, preset: { voiceId: 'Serena', rights: { declaration: '固定预设', reference: 'Apache-2.0 权重' } },
      measurement: baseMeasurement, provider: { costUsd: 0 } },
    processed, processing: { receipt: { receiptHash: hash('e') } }, processedMeasurement: derivedMeasurement,
  } as unknown as Awaited<ReturnType<typeof readAvgVoiceCandidateV3>>)
})

afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const click = (text: string) => act(async () => { const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent === text)!
  expect(button.disabled).toBe(false); button.click() })
const base = () => ({ scope, productionId: 7, raw, disabled: false, canAdopt: true, declaration: '工程显示测试',
  onPending: vi.fn(), onAction: async (task: () => Promise<void>) => task(), onReload: vi.fn(async () => {}) })

describe('AVG voice review technical signal summary', () => {
  it('shows measurements for the exact processed clip and keeps the raw measurement as a separate baseline', async () => {
    await act(async () => root.render(<VoiceReviewPanel scope={scope} productionId={7} raw={raw} processed={processed}
      disabled={false} canAdopt={false} declaration="工程显示测试" onPending={vi.fn()} onAction={async task => task()} onReload={vi.fn(async () => {})}/>))

    expect(readAvgVoiceCandidateV3).toHaveBeenCalledWith({ scope, productionId: 7, requirementKey: 'line.desk',
      version: raw.version, contentHash: raw.contentHash, processed: { version: processed.version, contentHash: processed.contentHash } })
    expect(host.textContent).toContain('当前加工版本技术分析')
    expect(host.textContent).toContain('-18.3 LUFS')
    expect(host.textContent).toContain('-1.5 dBTP')
    expect(host.textContent).toContain('原始配音基准')
    expect(host.textContent).toContain('-26.1 LUFS')
    expect(host.textContent).toContain('不是专业听感')
    expect(host.querySelector('[data-player]')?.getAttribute('data-hash')).toBe(processed.contentHash)
  })
  it('stops candidate review and disables author actions while comparing the exact original voice', async () => {
    await act(async () => root.render(<VoiceReviewPanel {...base()} processed={processed}/>))
    expect(readAvgRawVoiceCandidateV3).not.toHaveBeenCalled()
    await click('对照原始配音（只读）')
    expect(host.querySelector('[data-player]')).toBeNull()
    expect(host.querySelector('[data-comparison]')?.getAttribute('data-hash')).toBe(raw.contentHash)
    expect(host.querySelector('fieldset')!.disabled).toBe(true)
    await click('读取只读原件')
    expect(readAvgRawVoiceCandidateV3).toHaveBeenCalledWith({ scope, productionId: 7, requirementKey: 'line.desk', version: raw.version, contentHash: raw.contentHash })
    expect(stageAvgAudioReviewV3).not.toHaveBeenCalled(); expect(stageAvgVoiceChoiceV3).not.toHaveBeenCalled()
    await click('审听加工配音')
    expect(host.querySelector('[data-comparison]')).toBeNull()
    expect(host.querySelector('[data-player]')?.getAttribute('data-hash')).toBe(processed.contentHash)
    expect(host.querySelector('fieldset')!.disabled).toBe(false)
  })
  it('does not call the strict candidate reader while required processing is pending, but can read an original for comparison', async () => {
    await act(async () => root.render(<VoiceReviewPanel {...base()} processingRequired/>))
    expect(host.textContent).toContain('等待本批已确认的配音加工完成')
    expect(readAvgVoiceCandidateV3).not.toHaveBeenCalled()
    await click('对照原始配音（只读）'); await click('读取只读原件')
    expect(readAvgRawVoiceCandidateV3).toHaveBeenCalledWith({ scope, productionId: 7, requirementKey: 'line.desk', version: raw.version, contentHash: raw.contentHash })
    expect(host.querySelector('fieldset')).toBeNull(); expect(stageAvgAudioReviewV3).not.toHaveBeenCalled()
  })
})
