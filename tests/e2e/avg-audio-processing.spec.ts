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
    const nativeContext = new AudioContext()
    const nativeDecodeSampleRateHz = nativeContext.sampleRate
    await nativeContext.close()
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
    return { receipt: output.receipt, original: original.measurement, derived: derived.measurement, nativeDecodeSampleRateHz,
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
  // The default browser decoder uses the host AudioContext rate. The exact
  // 48 kHz WAV container/sample-count assertions above remain independent.
  expect(result.original).toMatchObject({ durationMs: 500, channelCount: 2, decodedSampleRateHz: result.nativeDecodeSampleRateHz })
  expect(result.derived).toMatchObject({ durationMs: 500, channelCount: 2, decodedSampleRateHz: result.nativeDecodeSampleRateHz })
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

test('native V2 audio resamples 48k to 24k with linked peak control, verifies in a second Worker and cancels without delivering audio', async ({ page }, info) => {
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
    const [processing, decoder, blob, hash, { db }] = await Promise.all([
      load('/storyforge/src/lib/avg/audio-processing-dispatch.ts'), load('/storyforge/src/lib/avg/sound-decoder.ts'),
      load('/storyforge/src/lib/product-production/media-blob-store.ts'), load('/storyforge/src/lib/product-production/hash.ts'),
      load('/storyforge/src/lib/db/schema.ts'),
    ])
    const snapshot = () => db.transaction('r', [db.productBuilds, db.productBuildArtifacts, db.mediaBlobObjects, db.agentRuns, db.agentRunEvents], async () => ({
      builds: await db.productBuilds.toArray(), artifacts: await db.productBuildArtifacts.toArray(), blobs: await db.mediaBlobObjects.toArray(),
      runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(),
    }))
    const before = JSON.stringify(await snapshot()), frames = 24_000, rate = 48_000, channels = 2
    const data = new ArrayBuffer(44 + frames * channels * 2), source = new DataView(data)
    const text = (at: number, value: string) => [...value].forEach((char, index) => source.setUint8(at + index, char.charCodeAt(0)))
    text(0, 'RIFF'); source.setUint32(4, data.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
    source.setUint32(16, 16, true); source.setUint16(20, 1, true); source.setUint16(22, channels, true)
    source.setUint32(24, rate, true); source.setUint32(28, rate * channels * 2, true)
    source.setUint16(32, channels * 2, true); source.setUint16(34, 16, true); text(36, 'data'); source.setUint32(40, frames * channels * 2, true)
    for (let frame = 0; frame < frames; frame++) {
      const left = frame >= 11_980 && frame < 12_020 ? 30_000 : 2 * Math.round(4000 * Math.sin(2 * Math.PI * 440 * frame / rate))
      source.setInt16(44 + frame * 4, left, true); source.setInt16(46 + frame * 4, left / 2, true)
    }
    const sourceHash = await blob.sha256MediaData(data), sourcePcmHash = await blob.sha256MediaData(data.slice(44))
    const recipe = { schema: 'storyforge.avg.audio-processing-recipe', version: 2, gainMilliDb: 6000, maximumDurationMs: 1000,
      sampleRatePolicy: 'explicit', targetSampleRateHz: 24_000, channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject',
      resampler: 'blackman-sinc64.v1', processingOrder: 'resample-gain-linked-limit.v1',
      dynamics: { processor: 'linked-lookahead-peak-limit.v1', ceilingMilliDbfs: -1500, lookaheadMs: 3, releaseMs: 80 },
      declaration: '原创双声道工程音，只验证实际加工与解码，不签审听、保真、响度或采用。' }
    const input = { data, source: { contentHash: sourceHash, mimeType: 'audio/wav', kind: 'bgm' }, recipe }
    type PortRecord = { url: string; type: string | undefined; mode: string; terminated: number; transfers: number; detached: boolean; handlersCleared: boolean }
    const NativeWorker = window.Worker, workers: PortRecord[] = []
    let abortOnVerify: AbortController | null = null
    // Observe the real native ports; every request and response stays native.
    class ObservedWorker extends NativeWorker {
      readonly record: PortRecord
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.record = { url: String(url), type: options?.type, mode: '', terminated: 0, transfers: 0, detached: false, handlersCleared: false }
        workers.push(this.record)
      }
      postMessage(message: unknown, transfer: Transferable[]): void
      postMessage(message: unknown, options?: StructuredSerializeOptions): void
      postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        this.record.mode = String((message as { mode?: unknown }).mode)
        if (Array.isArray(options)) {
          this.record.transfers = options.length; super.postMessage(message, options)
          this.record.detached = options.every(value => value instanceof ArrayBuffer && value.byteLength === 0)
        } else super.postMessage(message, options)
        if (this.record.mode === 'verify') abortOnVerify?.abort()
      }
      terminate() {
        this.record.terminated++
        this.record.handlersCleared = this.onmessage === null && this.onerror === null && this.onmessageerror === null
        super.terminate()
      }
    }
    window.Worker = ObservedWorker
    try {
      const output = await processing.processAvgAudioPcmWaveWithWorker(input)
      const actual = new DataView(output.data), pcmBytes = actual.getUint32(40, true), actualChannels = actual.getUint16(22, true)
      const actualRate = actual.getUint32(24, true), actualFrames = pcmBytes / (actualChannels * 2)
      let peak = 0, fullScaleSamples = 0, maximumStereoError = 0, energy = 0
      for (let frame = 0; frame < actualFrames; frame++) {
        const left = actual.getInt16(44 + frame * 4, true), right = actual.getInt16(46 + frame * 4, true)
        peak = Math.max(peak, Math.abs(left), Math.abs(right)); maximumStereoError = Math.max(maximumStereoError, Math.abs(left - 2 * right))
        fullScaleSamples += Number(left === -32768 || left === 32767) + Number(right === -32768 || right === 32767)
        energy += left * left + right * right
      }
      const original = await decoder.inspectAvgSoundBytesV1({ data, contentHash: sourceHash, assetKey: 'probe.audio.v2.original', mimeType: 'audio/wav' })
      const derived = await decoder.inspectAvgSoundBytesV1({ data: output.data, contentHash: output.receipt.output.contentHash,
        assetKey: 'probe.audio.v2.derived', mimeType: 'audio/wav' })
      // Native decode at the declared output rate proves frame count and time;
      // the shared analyzer may otherwise decode at the device's own rate.
      const context = new AudioContext({ sampleRate: 24_000 })
      let native: { sampleRateHz: number; frames: number; channels: number; durationMs: number }
      try {
        const decoded = await context.decodeAudioData(output.data.slice(0))
        native = { sampleRateHz: decoded.sampleRate, frames: decoded.length, channels: decoded.numberOfChannels, durationMs: decoded.duration * 1000 }
      } finally { await context.close() }
      const successWorkers = workers.length, controller = new AbortController()
      abortOnVerify = controller
      let stopped = false, cancelledResultDelivered = false
      try { await processing.processAvgAudioPcmWaveWithWorker({ ...input, signal: controller.signal }); cancelledResultDelivered = true }
      catch (error) { stopped = (error as Error).name === 'AbortError' }
      const { receiptHash: _receiptHash, ...body } = output.receipt
      return { receipt: output.receipt, original: original.measurement, derived: derived.measurement, native,
        physical: { sampleRateHz: actualRate, frames: actualFrames, channels: actualChannels, durationMs: actualFrames * 1000 / actualRate,
          bytes: output.data.byteLength, pcmBytes, peak, fullScaleSamples, maximumStereoError, rms: Math.sqrt(energy / (actualFrames * actualChannels)) },
        sourceMatchesReceipt: output.receipt.source.contentHash === sourceHash && output.receipt.source.pcmHash === sourcePcmHash,
        outputMatchesReceipt: await blob.sha256MediaData(output.data) === output.receipt.output.contentHash
          && await blob.sha256MediaData(output.data.slice(44)) === output.receipt.output.pcmHash,
        recipeAndReceiptHashesMatch: await hash.hashProductProductionValueV2(recipe) === output.receipt.recipeHash
          && await hash.hashProductProductionValueV2(body) === output.receipt.receiptHash,
        rawUnchanged: data.byteLength === 96_044 && await blob.sha256MediaData(data) === sourceHash,
        storeUnchanged: JSON.stringify(await snapshot()) === before, successWorkers, stopped, cancelledResultDelivered, workers }
    } finally { window.Worker = NativeWorker }
  })
  expect(result.receipt).toMatchObject({ version: 2, processor: 'storyforge.avg.pcm16-dynamics-resample.v2',
    source: { sampleRateHz: 48_000, sampleCount: 24_000, durationMs: 500, channelCount: 2 },
    output: { sampleRateHz: 24_000, sampleCount: 12_000, durationMs: 500, channelCount: 2, byteSize: 48_044, dataOffset: 44, fullScaleSampleCount: 0 } })
  expect(result.receipt.dynamicsObservation.limitedFrameCount).toBeGreaterThan(0)
  expect(result.receipt.dynamicsObservation.maximumReductionMilliDb).toBeGreaterThan(0)
  expect(result.physical).toMatchObject({ sampleRateHz: 24_000, frames: 12_000, channels: 2, durationMs: 500, bytes: 48_044, pcmBytes: 48_000, fullScaleSamples: 0 })
  const ceiling = Math.floor(32768 * 10 ** (-1500 / 20000))
  expect(result.physical.peak).toBeLessThanOrEqual(ceiling)
  expect(result.physical.peak).toBeGreaterThanOrEqual(ceiling - 1)
  expect(result.physical.maximumStereoError).toBeLessThanOrEqual(1)
  expect(result.physical.rms).toBeGreaterThan(100)
  expect(result.original).toMatchObject({ durationMs: 500, channelCount: 2 })
  expect(result.derived).toMatchObject({ durationMs: 500, channelCount: 2 })
  expect(result.native).toEqual({ sampleRateHz: 24_000, frames: 12_000, channels: 2, durationMs: 500 })
  expect(result.sourceMatchesReceipt && result.outputMatchesReceipt && result.recipeAndReceiptHashesMatch && result.rawUnchanged && result.storeUnchanged).toBe(true)
  expect(result.successWorkers).toBe(2)
  expect(result.stopped).toBe(true); expect(result.cancelledResultDelivered).toBe(false)
  expect(result.workers.map(worker => worker.mode)).toEqual(['compute', 'verify', 'compute', 'verify'])
  for (const worker of result.workers) {
    expect(worker.type).toBe('module'); expect(worker.url).toContain(`audio-dsp-${worker.mode}-v2.worker`)
    expect(worker.terminated).toBe(1); expect(worker.handlersCleared).toBe(true); expect(worker.detached).toBe(true)
    expect(worker.transfers).toBe(worker.mode === 'compute' ? 1 : 2)
  }
  expect(remote).toEqual([])
  await info.attach('native-audio-v2-processing-observation.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
})
