import { executeAvgAudioGainWorkerRequestV1, type AvgAudioGainWorkerReplyV1 } from './audio-gain-worker-protocol'

if (typeof document !== 'undefined') throw new Error('[avg-audio-process] 音频 Worker 入口不能在主窗口启动')
const port = self as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage: (reply: AvgAudioGainWorkerReplyV1, transfer: Transferable[]) => void
}
port.onmessage = event => {
  const reply = executeAvgAudioGainWorkerRequestV1(event.data)
  port.postMessage(reply, reply.ok ? [reply.pcm] : [])
}
