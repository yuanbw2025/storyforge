import { executeAvgAudioDspWorkerRequestV2, type AvgAudioDspWorkerReplyV2 } from './audio-dsp-worker-protocol-v2'
if (typeof document !== 'undefined') throw new Error('[avg-audio-process] DSP Worker不能在主窗口启动')
const port = self as unknown as { onmessage: ((event: MessageEvent<unknown>) => void) | null; postMessage: (value: AvgAudioDspWorkerReplyV2, transfer: Transferable[]) => void }
port.onmessage = event => {
  if ((event.data as { mode?: unknown })?.mode !== 'compute') throw new Error('[avg-audio-process] compute Worker只接受实际计算')
  const reply = executeAvgAudioDspWorkerRequestV2(event.data)
  port.postMessage(reply, reply.ok && reply.mode === 'compute' ? [reply.pcm] : [])
}
