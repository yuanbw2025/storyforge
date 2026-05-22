import { useEffect, useState } from 'react'
import { useImportStatusStore } from '../../../stores/import-status'
import { useImportSessionStore } from '../../../stores/import-session'
import type { ImportSession, ChunkState } from '../../../lib/types/import-session'
import { CheckCircle2, XCircle, Loader2, Circle, Clock } from 'lucide-react'

/** 分块进度面板：N 个小方块，每个方块显示第 X 块状态 */
export default function ImportProgressPanel() {
  const status = useImportStatusStore()
  const [session, setSession] = useState<ImportSession | null>(null)

  // 每次状态变化都重新拉 session（chunk 列表最新）
  useEffect(() => {
    let cancelled = false
    if (!status.sessionId) { setSession(null); return }
    const load = async () => {
      const s = await useImportSessionStore.getState().load(status.sessionId!)
      if (!cancelled) setSession(s)
    }
    load()
    // 轮询：每 1.5s 刷一次
    const iv = setInterval(load, 1500)
    return () => { cancelled = true; clearInterval(iv) }
  }, [status.sessionId, status.finishedChunks, status.failedChunks, status.activeChunkIndex])

  if (!session) return null

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-text-primary">
            分块进度 · {session.filename}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            共 {session.totalChunks} 块 · 每块约 {session.chunkSize.toLocaleString()} 字 · 总 {session.totalChars.toLocaleString()} 字
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="text-success">✓ {status.finishedChunks}</div>
          {status.failedChunks > 0 && <div className="text-error">✗ {status.failedChunks}</div>}
          <div className="text-text-muted">/ {status.totalChunks}</div>
        </div>
      </div>

      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(20px, 1fr))' }}>
        {session.chunks.map(c => (
          <ChunkCell
            key={c.index}
            chunk={c}
            isActive={status.activeChunkIndex === c.index}
            activeAttempts={status.activeChunkIndex === c.index ? status.activeAttempts : 0}
          />
        ))}
      </div>

      {/* 当前正在跑的 chunk 明细 */}
      {status.activeChunkIndex !== null && (
        <div className="mt-3 px-3 py-2 bg-accent/5 border border-accent/20 rounded text-xs text-accent">
          <Loader2 className="inline w-3 h-3 animate-spin mr-1" />
          正在处理第 {status.activeChunkIndex + 1}/{session.totalChunks} 块
          {status.activeAttempts > 1 && ` · 第 ${status.activeAttempts} 次尝试`}
          {session.chunks[status.activeChunkIndex]?.label &&
            ` · ${session.chunks[status.activeChunkIndex].label}`}
        </div>
      )}
    </div>
  )
}

function ChunkCell({ chunk, isActive, activeAttempts }: {
  chunk: ChunkState
  isActive: boolean
  activeAttempts: number
}) {
  let Icon = Circle
  let color = 'text-text-muted bg-bg-base'
  let title = `第 ${chunk.index + 1} 块 · ${chunk.charCount.toLocaleString()} 字`
  if (chunk.label) title += ` · ${chunk.label}`

  if (chunk.status === 'done') {
    Icon = CheckCircle2
    color = 'text-success bg-success/10 border-success/30'
    title += '\n✓ 已完成'
    if (chunk.extractedCounts) {
      title += `\n世界观 ${chunk.extractedCounts.worldviewFields} · 角色 ${chunk.extractedCounts.characters} · 大纲 ${chunk.extractedCounts.outlineNodes}`
    }
  } else if (chunk.status === 'failed') {
    Icon = XCircle
    color = 'text-error bg-error/10 border-error/30'
    title += `\n✗ 失败（重试 ${chunk.attempts} 次）\n${chunk.errorMessage || ''}`
  } else if (chunk.status === 'running' || isActive) {
    Icon = Loader2
    color = 'text-accent bg-accent/20 border-accent animate-pulse'
    title += `\n▶ 处理中`
    if (activeAttempts > 1) title += `（第 ${activeAttempts} 次尝试）`
  } else {
    Icon = Clock
    color = 'text-text-muted bg-bg-base border-border'
    title += '\n⏳ 等待中'
  }

  return (
    <div
      title={title}
      className={`aspect-square flex items-center justify-center border rounded ${color} text-[9px] cursor-help`}
    >
      <Icon className={`w-3 h-3 ${isActive ? 'animate-spin' : ''}`} />
    </div>
  )
}
