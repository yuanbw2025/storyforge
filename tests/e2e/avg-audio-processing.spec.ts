import { expect, test } from '@playwright/test'

test('native PCM gain preserves the source and timeline, decodes actual output bytes and grants no production or adoption writes', async ({ page }, info) => {
  const remote: string[] = []
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      remote.push(url.origin); await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await page.goto('./avg/library')
  const result = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const [processing, decoder, blob, { db }] = await Promise.all([load('/storyforge/src/lib/avg/audio-processing.ts'),
      load('/storyforge/src/lib/avg/sound-decoder.ts'), load('/storyforge/src/lib/product-production/media-blob-store.ts'),
      load('/storyforge/src/lib/db/schema.ts')])
    const snapshot = () => db.transaction('r', [db.productBuilds, db.productBuildArtifacts, db.mediaBlobObjects, db.agentRuns, db.agentRunEvents], async () => ({
      builds: await db.productBuilds.toArray(), artifacts: await db.productBuildArtifacts.toArray(), blobs: await db.mediaBlobObjects.toArray(),
      runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(),
    }))
    const before = JSON.stringify(await snapshot()), frames = 24_000, rate = 48_000, channels = 2
    const data = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(data)
    const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)))
    text(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true)
    view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true)
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * channels * 2, true)
    for (let frame = 0; frame < frames; frame++) {
      const value = Math.sin(2 * Math.PI * 440 * frame / rate)
      view.setInt16(44 + frame * 4, Math.round(20_000 * value), true)
      view.setInt16(46 + frame * 4, Math.round(10_000 * value), true)
    }
    const NativeWorker = window.Worker, workers: Array<{ url: string; type: string | undefined; terminated: number; postedTransfers: number }> = []
    let abortOnPost: AbortController | null = null
    class ObservedWorker extends NativeWorker {
      readonly record: { url: string; type: string | undefined; terminated: number; postedTransfers: number }
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); this.record = { url: String(url), type: options?.type, terminated: 0, postedTransfers: 0 }; workers.push(this.record)
      }
      postMessage(message: any, transfer: Transferable[]): void
      postMessage(message: any, options?: StructuredSerializeOptions): void
      postMessage(message: any, options?: Transferable[] | StructuredSerializeOptions) {
        if (Array.isArray(options)) { this.record.postedTransfers = options.length; super.postMessage(message, options) }
        else super.postMessage(message, options)
        abortOnPost?.abort()
      }
      terminate() { this.record.terminated++; super.terminate() }
    }
    window.Worker = ObservedWorker
    try {
    const sourceHash = await blob.sha256MediaData(data)
    const recipe = { schema: 'storyforge.avg.audio-processing-recipe', version: 1, gainMilliDb: -6000, maximumDurationMs: 1000,
      sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject',
      declaration: '原创双通道正弦工程音，不是音乐/人声或审听验收；只检查原字节、增益与时间轴。' }
    const input = { data, source: { contentHash: sourceHash, mimeType: 'audio/wav', kind: 'bgm' }, recipe }
    const direct = await processing.processAvgAudioPcmWaveV1(input)
    const output = await processing.processAvgAudioPcmWaveWithWorkerV1(input)
    await processing.assertAvgAudioProcessingWaveBytesV1({ source: data, output: output.data, recipe, receipt: output.receipt })
    const original = await decoder.inspectAvgSoundBytesV1({ data, contentHash: sourceHash, assetKey: 'probe.audio.original', mimeType: 'audio/wav' })
    const derived = await decoder.inspectAvgSoundBytesV1({ data: output.data, contentHash: output.receipt.output.contentHash,
      assetKey: 'probe.audio.derived', mimeType: 'audio/wav' })
    const controller = new AbortController(); abortOnPost = controller
    let stopped = false
    try { await processing.processAvgAudioPcmWaveWithWorkerV1({ ...input, signal: controller.signal }) }
    catch (error) { stopped = (error as Error).name === 'AbortError' }
    return { receipt: output.receipt, original: original.measurement, derived: derived.measurement,
      rawUnchanged: await blob.sha256MediaData(data) === sourceHash,
      outputHashMatches: await blob.sha256MediaData(derived.data) === output.receipt.output.contentHash,
      workerMatchesDirect: await blob.sha256MediaData(direct.data) === output.receipt.output.contentHash
        && JSON.stringify(direct.receipt) === JSON.stringify(output.receipt),
      storeUnchanged: JSON.stringify(await snapshot()) === before, stopped, workers }
    } finally { window.Worker = NativeWorker }
  })
  expect(result.receipt).toMatchObject({ version: 1, processor: 'storyforge.avg.pcm16-gain.v1', source: {
    sampleRateHz: 48_000, sampleCount: 24_000, durationMs: 500, channelCount: 2 },
  output: { sampleRateHz: 48_000, sampleCount: 24_000, durationMs: 500, channelCount: 2, fullScaleSampleCount: 0 } })
  expect(result.original).toMatchObject({ durationMs: 500, channelCount: 2, decodedSampleRateHz: 48_000 })
  expect(result.derived).toMatchObject({ durationMs: 500, channelCount: 2, decodedSampleRateHz: 48_000 })
  expect(Math.abs(result.derived.integratedLufs - result.original.integratedLufs + 6)).toBeLessThan(0.05)
  expect(Math.abs(result.derived.truePeakDbtp - result.original.truePeakDbtp + 6)).toBeLessThan(0.05)
  expect(result.rawUnchanged && result.outputHashMatches && result.storeUnchanged && result.stopped && result.workerMatchesDirect).toBe(true)
  expect(result.workers).toHaveLength(2)
  for (const worker of result.workers) {
    expect(worker.type).toBe('module'); expect(worker.url).toContain('audio-gain.worker')
    expect(worker.terminated).toBe(1); expect(worker.postedTransfers).toBe(1)
  }
  expect(remote).toEqual([])
  await info.attach('native-audio-processing-observation.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
})
