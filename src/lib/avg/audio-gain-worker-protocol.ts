import { assertAvgAudioGainPcmLayoutV1, executeAvgAudioGainPcmV1, AVG_AUDIO_GAIN_MIN_MILLI_DB_V1,
  AVG_AUDIO_GAIN_MAX_MILLI_DB_V1, AVG_AUDIO_GAIN_MAX_FRAMES_V1 } from './audio-gain-kernel'
import { avgHash, avgNumber, avgRecord, avgText } from './protocol-validation'

export interface AvgAudioGainWorkerRequestV1 {
  schema: 'storyforge.avg.audio-gain-worker-request'; version: 1; jobId: string
  pcm: ArrayBuffer; channelCount: number; sampleCount: number; gainMilliDb: number
  sourcePcmHash: string; recipeHash: string
}
export type AvgAudioGainWorkerReplyV1 = {
  schema: 'storyforge.avg.audio-gain-worker-reply'; version: 1; jobId: string; ok: true
  pcm: ArrayBuffer; channelCount: number; sampleCount: number; gainMilliDb: number
  sourcePcmHash: string; recipeHash: string
} | { schema: 'storyforge.avg.audio-gain-worker-reply'; version: 1; jobId: string; ok: false; message: string }

function fields(r: Record<string, unknown>) {
  const pcm = r.pcm as ArrayBuffer, channelCount = avgNumber(r.channelCount, 'audio channels', 1, 2)
  const sampleCount = avgNumber(r.sampleCount, 'audio frames', 2, AVG_AUDIO_GAIN_MAX_FRAMES_V1)
  const gainMilliDb = avgNumber(r.gainMilliDb, 'audio gain', AVG_AUDIO_GAIN_MIN_MILLI_DB_V1, AVG_AUDIO_GAIN_MAX_MILLI_DB_V1)
  assertAvgAudioGainPcmLayoutV1(pcm, channelCount, sampleCount, gainMilliDb)
  return { pcm, channelCount, sampleCount, gainMilliDb, sourcePcmHash: avgHash(r.sourcePcmHash, 'audio source PCM'), recipeHash: avgHash(r.recipeHash, 'audio recipe') }
}
const frameKeys = ['pcm', 'channelCount', 'sampleCount', 'gainMilliDb', 'sourcePcmHash', 'recipeHash'] as const
export function parseAvgAudioGainWorkerRequestV1(value: unknown): AvgAudioGainWorkerRequestV1 {
  const r = avgRecord(value, ['schema', 'version', 'jobId', ...frameKeys], 'audio Worker request')
  if (r.schema !== 'storyforge.avg.audio-gain-worker-request' || r.version !== 1) throw new Error('[avg-audio-process] Worker 请求版本无效')
  return { schema: r.schema, version: 1, jobId: avgText(r.jobId, 'audio job', 100), ...fields(r) }
}
export function parseAvgAudioGainWorkerReplyV1(value: unknown): AvgAudioGainWorkerReplyV1 {
  const ok = value && typeof value === 'object' && 'ok' in value ? value.ok : null
  const r = avgRecord(value, ['schema', 'version', 'jobId', 'ok', ...(ok === true ? frameKeys : ['message'])], 'audio Worker reply')
  if (r.schema !== 'storyforge.avg.audio-gain-worker-reply' || r.version !== 1 || typeof ok !== 'boolean') throw new Error('[avg-audio-process] Worker 返回版本无效')
  const jobId = avgText(r.jobId, 'audio job', 100)
  return ok ? { schema: r.schema, version: 1, jobId, ok: true, ...fields(r) }
    : { schema: r.schema, version: 1, jobId, ok: false, message: avgText(r.message, 'audio Worker failure', 1000) }
}

export function executeAvgAudioGainWorkerRequestV1(value: unknown): AvgAudioGainWorkerReplyV1 {
  let jobId = 'invalid-request'
  try {
    const request = parseAvgAudioGainWorkerRequestV1(value); jobId = request.jobId
    const { schema: _schema, version: _version, ...fields } = request
    return { schema: 'storyforge.avg.audio-gain-worker-reply', version: 1, ...fields, ok: true, pcm: executeAvgAudioGainPcmV1(request) }
  } catch (error) {
    return { schema: 'storyforge.avg.audio-gain-worker-reply', version: 1, jobId, ok: false,
      message: (error instanceof Error ? error.message : '音频增益计算失败').slice(0, 1000) }
  }
}
