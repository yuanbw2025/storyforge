import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { useNavigate } from 'react-router'
import type { Project } from '../../lib/types'
import { resolveScope } from '../../lib/workspace/scope'
import { readLongformProgressV1 } from '../../lib/agent/longform-progress'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'

export default function LongformAgentProgress({
  project,
  worldGroupId,
  busy,
  onRequest,
}: {
  project: Project
  worldGroupId: number | null
  busy: boolean
  onRequest: (text: string) => void
}) {
  const navigate = useNavigate()
  const [progress, setProgress] = useState<Awaited<ReturnType<typeof readLongformProgressV1>> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const sub = liveQuery(async () =>
      readLongformProgressV1(await resolveScope({ projectId: project.id! }), worldGroupId),
    ).subscribe({ next: setProgress, error: (cause) => setError(String(cause)) })
    return () => sub.unsubscribe()
  }, [project.id, worldGroupId])
  const open = async (module: string, chapter?: number) => {
    try {
      await flushPendingEditsV1()
      navigate(`/workspace/${project.id}?module=${module}${chapter ? `&chapter=${chapter}` : ''}`)
    } catch (cause) {
      setError(String(cause))
    }
  }
  if (!progress) return error ? <p role="alert">{error}</p> : null
  return (
    <details className="lf-agent-progress shrink-0 max-h-48 overflow-auto border-b border-border px-4 py-2">
      <summary className="cursor-pointer font-medium">
        作品进度 · 已写 {progress.written}/{progress.rows.length} 章 · {progress.words.toLocaleString()} 字
      </summary>
      <p className="my-2 text-xs text-text-secondary">
        世界设定{progress.worldReady ? '已有内容' : '留白'} · 故事核心
        {progress.storyReady ? '已有内容' : '留白'} · {progress.characterCount} 位角色 · {progress.volumes} 卷
        · {progress.detailed} 章细纲
      </p>
      <p className="text-xs text-text-muted">
        此处统计已保存内容；全书是否完成还需你核对目标、结局和修订结果。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="lf-action"
          disabled={busy}
          onClick={() => onRequest(progress.nextRequest)}
        >
          讨论下一步
        </button>
        <button type="button" className="lf-action" onClick={() => void open('info')}>
          查看作品目标
        </button>
        <button type="button" className="lf-action" onClick={() => void open('export')}>
          版本与导出
        </button>
      </div>
      {progress.rows.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs cursor-pointer">章节与后续工作</summary>
          <ol className="mt-2 max-h-48 overflow-auto text-xs space-y-2">
            {progress.rows.map((row) => (
              <li key={row.outlineNodeId} className="flex justify-between gap-3">
                <span>
                  {row.title} · {row.written ? `${row.words} 字` : row.hasDetails ? '待写正文' : '待完善细纲'}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className="text-accent"
                  onClick={() => void open('chapters-list', row.outlineNodeId)}
                >
                  打开正文与章后处理
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  )
}
