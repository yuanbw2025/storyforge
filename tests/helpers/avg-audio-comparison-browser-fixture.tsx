import { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import OriginalAudioComparisonPlayer from '../../src/components/avg/OriginalAudioComparisonPlayer'
import SoundAuditionPlayer, { type SoundObservation } from '../../src/components/avg/SoundAuditionPlayer'
import { processAvgAudioPcmWaveV1 } from '../../src/lib/avg/audio-processing'
import { audioPcmV2, audioWaveV2 } from './avg-audio-v2-fixture'

/** Native component-only fixture with declared engineering PCM. It cannot
 * sign a real author review, seed a producer or invoke a provider. */
export async function mountAvgAudioComparisonFixture() {
  const original = await audioWaveV2(audioPcmV2(24_000, 24_000), 24_000)
  const processed = await processAvgAudioPcmWaveV1({ ...original, recipe: {
    schema: 'storyforge.avg.audio-processing-recipe', version: 1, gainMilliDb: -6000, maximumDurationMs: 2000,
    sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject',
    declaration: 'ENGINEERING component comparison of a synthetic tone; no voice/music or author acceptance.',
  } })
  function ComparisonFixture() {
    const [mode, setMode] = useState<'candidate' | 'original'>('candidate')
    const [observed, setObserved] = useState(false)
    const observe = useCallback((value: SoundObservation | null) => setObserved(!!value), [])
    const loadSource = useCallback(async () => ({ data: original.data,
      asset: { contentHash: original.source.contentHash, mimeType: original.source.mimeType, durationMs: 1000 } }), [])
    const switchMode = (next: typeof mode) => { observe(null); setMode(next) }
    return <section data-audio-comparison-fixture style={{ position: 'fixed', inset: 0, padding: 16, background: 'white', color: 'black', zIndex: 10000, overflow: 'auto' }}>
      <p>工程正弦音对照；不是人声、音乐或作者审听验收。</p>
      <button onClick={() => switchMode('candidate')}>返回加工候选</button>
      <button onClick={() => switchMode('original')}>打开原始只读对照</button>
      <output aria-label="工程观察数">{observed ? '1' : '0'}</output>
      {mode === 'original' ? <OriginalAudioComparisonPlayer identityKey="native.original" expectedContentHash={original.source.contentHash}
        loadSource={loadSource} disabled={false}/>
        : <SoundAuditionPlayer sourceKey="native.processed" data={processed.data} assetKey="native.processed" contentHash={processed.receipt.output.contentHash}
          requestIdentityHash={'a'.repeat(64)} durationMs={1000} channelCount={1} loop={false} variant="processed" disabled={false} onObservation={observe}/>}
    </section>
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); root.render(<ComparisonFixture/>)
  return { originalHash: original.source.contentHash, processedHash: processed.receipt.output.contentHash }
}
