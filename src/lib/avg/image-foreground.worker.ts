import { executeAvgForegroundWorkerRequestV1, type AvgForegroundWorkerReplyV1 } from './image-foreground-worker-protocol'
import { executeAvgForegroundWorkerRequestV2, type AvgForegroundWorkerReplyV2 } from './image-foreground-worker-protocol-v2'

// Dedicated Worker entry only. Importing this bootstrap into the main window
// is forbidden; the client loads its fixed module URL.
if (typeof document !== 'undefined') throw new Error('[avg-foreground] 前景 Worker 入口不能在主窗口启动')
const port = self as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage: (reply: AvgForegroundWorkerReplyV1 | AvgForegroundWorkerReplyV2, transfer: Transferable[]) => void
}
port.onmessage = async event => {
  const value = event.data
  const reply = value && typeof value === 'object' && 'version' in value && value.version === 2
    ? await executeAvgForegroundWorkerRequestV2(value) : executeAvgForegroundWorkerRequestV1(value)
  port.postMessage(reply, reply.ok && 'rgba' in reply ? [reply.rgba] : [])
}
