import {useEffect, useState} from 'react'
import {liveQuery} from 'dexie'
import {Loader2} from 'lucide-react'
import type {WorkspaceScope} from '../../lib/types'
import {readChatRunProgressV1, type ChatRunProgressV1} from '../../lib/character-interaction/run-progress'

export default function RunProgress({scope, sessionId, runId, active}: {
  scope: WorkspaceScope; sessionId: number; runId: number; active: boolean
}) {
  const [value, setValue] = useState<ChatRunProgressV1 | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setValue(null); setUnavailable(false)
    const subscription = liveQuery(() => readChatRunProgressV1(scope, sessionId, runId)).subscribe({
      next: result => {setValue(result); setUnavailable(false)},
      error: () => {setValue(null); setUnavailable(true)},
    })
    return () => subscription.unsubscribe()
  }, [scope, sessionId, runId])
  const waiting = active && !unavailable && (!value || ['preparing', 'generation', 'response', 'review', 'review-result', 'ready', 'applied'].includes(value.phase))
  useEffect(() => {
    if (!waiting) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [waiting, value?.since])
  const seconds = value ? Math.max(0, Math.floor((now - value.since) / 1000)) : 0
  return <div data-testid="chat-run-progress" className="space-y-1 rounded border border-border bg-bg-base p-3 text-xs text-text-muted">
    <div role="status" className="flex items-center gap-2">
      {waiting && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" />}
      <span>{!active && '上次保存的阶段：'}{unavailable ? '暂时无法读取运行阶段' : value?.label ?? '正在读取运行记录'}</span>
    </div>
    {value && <p>{value.detail}</p>}
    {waiting && value && <p aria-live="off">本阶段已等待 {seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`}；等待时间不代表完成比例。</p>}
    {!active && <p>这是保存的记录，不代表模型仍在运行；请按恢复提示处理。</p>}
    {unavailable && <p>这不表示生成已停止；本提示不会重发请求。</p>}
  </div>
}
