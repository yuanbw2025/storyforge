import { avgEnum, avgHash, avgNumber, avgRecord, avgText } from './protocol-validation'
import { parseAvgAudioProcessingRecipeV2, parseAvgAudioDynamicsObservationV2,
  type AvgAudioProcessingRecipeV2, type AvgAudioDynamicsObservationV2 } from './audio-processing-contract-v2'
import { executeAvgAudioDspPcmV2, planAvgAudioDspLayoutV2 } from './audio-dsp-kernel-v2'

interface Base { schema: 'storyforge.avg.audio-dsp-worker-request'; version: 2; jobId: string
  pcm: ArrayBuffer; channelCount: number; sampleCount: number; sourceSampleRateHz: number
  recipe: AvgAudioProcessingRecipeV2; sourcePcmHash: string; recipeHash: string }
export interface AvgAudioDspOutputV2 { pcm: ArrayBuffer; channelCount: number; sampleCount: number; sampleRateHz: number; dynamicsObservation: AvgAudioDynamicsObservationV2 }
export type AvgAudioDspWorkerRequestV2 = Base & ({ mode: 'compute' } | { mode: 'verify'; output: AvgAudioDspOutputV2; outputPcmHash: string })
interface Success { schema: 'storyforge.avg.audio-dsp-worker-reply'; version: 2; jobId: string; ok: true
  sourcePcmHash: string; recipeHash: string; channelCount: number; sampleCount: number; sampleRateHz: number; dynamicsObservation: AvgAudioDynamicsObservationV2 }
export type AvgAudioDspWorkerReplyV2 = Success & ({ mode: 'compute'; pcm: ArrayBuffer } | { mode: 'verify'; verified: true; outputPcmHash: string })
  | { schema: 'storyforge.avg.audio-dsp-worker-reply'; version: 2; jobId: string; ok: false; message: string }
const baseKeys = ['schema', 'version', 'jobId', 'mode', 'pcm', 'channelCount', 'sampleCount', 'sourceSampleRateHz', 'recipe', 'sourcePcmHash', 'recipeHash']
export function parseAvgAudioDspWorkerRequestV2(value: unknown): AvgAudioDspWorkerRequestV2 {
  const mode = avgEnum((value as { mode?: unknown } | null)?.mode, ['compute', 'verify'] as const, 'DSP Worker mode')
  const r = avgRecord(value, [...baseKeys, ...(mode === 'verify' ? ['output', 'outputPcmHash'] : [])], 'DSP Worker request')
  if (r.schema !== 'storyforge.avg.audio-dsp-worker-request' || r.version !== 2) throw new Error('[avg-audio-process] DSP Worker请求版本无效')
  const recipe = parseAvgAudioProcessingRecipeV2(r.recipe)
  const layout = planAvgAudioDspLayoutV2({ channelCount: r.channelCount as number, sampleCount: r.sampleCount as number, sourceSampleRateHz: r.sourceSampleRateHz as number, recipe })
  if (!(r.pcm instanceof ArrayBuffer) || r.pcm.byteLength !== layout.sampleCount * layout.channelCount * 2) throw new Error('[avg-audio-process] DSP Worker原件布局无效')
  const common: Base = { schema: r.schema, version: 2, jobId: avgText(r.jobId, 'DSP job', 100), pcm: r.pcm,
    channelCount: layout.channelCount, sampleCount: layout.sampleCount, sourceSampleRateHz: layout.sourceSampleRateHz,
    recipe, sourcePcmHash: avgHash(r.sourcePcmHash, 'DSP source hash'), recipeHash: avgHash(r.recipeHash, 'DSP recipe hash') }
  if (mode === 'compute') return { ...common, mode }
  const output = parseOutput(r.output)
  if (output.channelCount !== layout.channelCount || output.sampleCount !== layout.outputSampleCount || output.sampleRateHz !== layout.outputSampleRateHz) {
    throw new Error('[avg-audio-process] DSP复算输出布局不属于冻结来源与配方')
  }
  return { ...common, mode, output, outputPcmHash: avgHash(r.outputPcmHash, 'DSP output hash') }
}
function parseOutput(value: unknown): AvgAudioDspOutputV2 {
  const r = avgRecord(value, ['pcm', 'channelCount', 'sampleCount', 'sampleRateHz', 'dynamicsObservation'], 'DSP output')
  const channelCount = avgNumber(r.channelCount, 'DSP output channels', 1, 2), sampleCount = avgNumber(r.sampleCount, 'DSP output frames', 2, 48000 * 120)
  if (!(r.pcm instanceof ArrayBuffer) || r.pcm.byteLength > 32 * 1024 * 1024 || r.pcm.byteLength !== sampleCount * channelCount * 2) throw new Error('[avg-audio-process] DSP输出PCM布局无效')
  return { pcm: r.pcm, channelCount, sampleCount, sampleRateHz: avgNumber(r.sampleRateHz, 'DSP output rate', 8000, 48000),
    dynamicsObservation: parseAvgAudioDynamicsObservationV2(r.dynamicsObservation, sampleCount) }
}
export function parseAvgAudioDspWorkerReplyV2(value: unknown): AvgAudioDspWorkerReplyV2 {
  const ok = (value as { ok?: unknown } | null)?.ok
  if (typeof ok !== 'boolean') throw new Error('[avg-audio-process] DSP Worker返回状态无效')
  if (!ok) {
    const r = avgRecord(value, ['schema', 'version', 'jobId', 'ok', 'message'], 'DSP Worker failure')
    if (r.schema !== 'storyforge.avg.audio-dsp-worker-reply' || r.version !== 2) throw new Error('[avg-audio-process] DSP Worker失败版本无效')
    return { schema: r.schema, version: 2, jobId: avgText(r.jobId, 'DSP job', 100), ok: false, message: avgText(r.message, 'DSP error', 1000) }
  }
  const mode = avgEnum((value as { mode?: unknown })?.mode, ['compute', 'verify'] as const, 'DSP reply mode')
  const r = avgRecord(value, ['schema', 'version', 'jobId', 'ok', 'mode', 'sourcePcmHash', 'recipeHash', 'channelCount',
    'sampleCount', 'sampleRateHz', 'dynamicsObservation', ...(mode === 'compute' ? ['pcm'] : ['verified', 'outputPcmHash'])], 'DSP Worker reply')
  if (r.schema !== 'storyforge.avg.audio-dsp-worker-reply' || r.version !== 2) throw new Error('[avg-audio-process] DSP Worker返回版本无效')
  const sampleCount = avgNumber(r.sampleCount, 'DSP output frames', 2, 48000 * 120)
  const common: Success = { schema: r.schema, version: 2, jobId: avgText(r.jobId, 'DSP job', 100), ok: true,
    sourcePcmHash: avgHash(r.sourcePcmHash, 'DSP source hash'), recipeHash: avgHash(r.recipeHash, 'DSP recipe hash'),
    channelCount: avgNumber(r.channelCount, 'DSP output channels', 1, 2), sampleCount,
    sampleRateHz: avgNumber(r.sampleRateHz, 'DSP output rate', 8000, 48000), dynamicsObservation: parseAvgAudioDynamicsObservationV2(r.dynamicsObservation, sampleCount) }
  if (mode === 'compute') return { ...common, mode, pcm: parseOutput({ pcm: r.pcm, channelCount: common.channelCount,
    sampleCount, sampleRateHz: common.sampleRateHz, dynamicsObservation: common.dynamicsObservation }).pcm }
  if (r.verified !== true) throw new Error('[avg-audio-process] DSP Worker未完成逐字节复算')
  return { ...common, mode, verified: true, outputPcmHash: avgHash(r.outputPcmHash, 'DSP verified output hash') }
}

/** Runs only in a bounded Worker, or explicit finite numeric tests. */
export function executeAvgAudioDspWorkerRequestV2(value: unknown): AvgAudioDspWorkerReplyV2 {
  let jobId = 'invalid-dsp-request'
  try {
    const request = parseAvgAudioDspWorkerRequestV2(value); jobId = request.jobId
    const computed = executeAvgAudioDspPcmV2(request)
    const common: Success = { schema: 'storyforge.avg.audio-dsp-worker-reply', version: 2, ok: true, jobId,
      sourcePcmHash: request.sourcePcmHash, recipeHash: request.recipeHash, channelCount: computed.channelCount,
      sampleCount: computed.sampleCount, sampleRateHz: computed.sampleRateHz, dynamicsObservation: computed.dynamicsObservation }
    if (request.mode === 'compute') return { ...common, mode: 'compute', pcm: computed.pcm }
    const expected = new Uint8Array(computed.pcm), actual = new Uint8Array(request.output.pcm)
    if (expected.length !== actual.length || computed.dynamicsObservation.limitedFrameCount !== request.output.dynamicsObservation.limitedFrameCount
      || computed.dynamicsObservation.maximumReductionMilliDb !== request.output.dynamicsObservation.maximumReductionMilliDb) throw new Error('[avg-audio-process] 独立复算的动态观察或字节数不一致')
    for (let offset = 0; offset < expected.length; offset++) if (expected[offset] !== actual[offset]) throw new Error('[avg-audio-process] 独立DSP复算逐字节不一致')
    return { ...common, mode: 'verify', verified: true, outputPcmHash: request.outputPcmHash }
  } catch (error) {
    return { schema: 'storyforge.avg.audio-dsp-worker-reply', version: 2, jobId, ok: false,
      message: (error instanceof Error ? error.message : 'DSP Worker处理失败').slice(0, 1000) }
  }
}
