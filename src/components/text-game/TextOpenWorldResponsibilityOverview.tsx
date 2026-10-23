import { useEffect, useRef, useState } from 'react'
import { createLatestSnapshotReadQueue } from './latest-snapshot-read'
import type { WorkspaceScope } from '../../lib/types'
import { readTextOpenWorldResponsibilityWorkspaceV1 } from '../../lib/open-world/responsibility-workspace'
import type {
  TextOpenWorldResponsibilityProgressV1,
  TextOpenWorldResponsibilityStateV1,
} from '../../lib/open-world/responsibility-progress'

const LABELS: Record<TextOpenWorldResponsibilityStateV1, string> = {
  'not-started': '尚未开始', running: '正在制作', blocked: '等待处理',
  failed: '验证或执行失败', ready: '可进入组装', stale: '来源已失效',
}

export interface TextOpenWorldResponsibilityOverviewProps {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  refreshToken: string
  onInspectArtifact: (artifactKey: string) => void
  onInspectTask: (taskKey: string) => void
}

export default function TextOpenWorldResponsibilityOverview(props: TextOpenWorldResponsibilityOverviewProps) {
  const { projectId, worldId, workId } = props.scope
  const [result, setResult] = useState<TextOpenWorldResponsibilityProgressV1 | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const readQueue = useRef(createLatestSnapshotReadQueue())
  useEffect(() => {
    const queue = readQueue.current
    setResult(null)
    setError('')
    void queue.enqueue(async isCurrent => {
      try {
        const value = await readTextOpenWorldResponsibilityWorkspaceV1({
          scope: { projectId, worldId, workId }, productionId: props.productionId, buildId: props.buildId,
        })
        if (isCurrent()) setResult(value)
      } catch (cause) {
        if (isCurrent()) setError(cause instanceof Error ? cause.message : '暂时无法核验生产状态')
      }
    })
    return () => { queue.invalidate() }
  }, [projectId, worldId, workId, props.productionId, props.buildId, props.refreshToken, refresh])

  return <section className="mt-5 rounded border border-border bg-bg-elevated p-4" aria-label="三条生产责任线"
    data-testid="text-open-world-responsibilities">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">三条生产责任线</h2>
      <button type="button" className="rounded border border-border px-3 py-2 text-xs"
        onClick={() => setRefresh(value => value + 1)}>刷新责任线</button>
    </div>
    <p className="mt-2 text-xs leading-5 text-text-muted">内容、系统与媒资共同交付同一个游戏。展开可查看缺少的产物、依赖和返修位置。</p>
    {!result && !error && <p role="status" className="mt-3 text-xs">正在核验当前 Build 的任务回执与产物…</p>}
    {error && <p role="alert" className="mt-3 break-words text-xs text-error">{error}</p>}
    {result && <>
      <p role="status" className="mt-3 text-xs">
        Build #{result.build.buildNumber} · {result.readyForAssembly ? '三线产物已齐备，可进入 V3 组装' : '三线产物尚未齐备，暂不能进入 V3 组装'}。
        工程就绪仍需后续质量检查和人工验收。
      </p>
      <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-3">{result.tracks.map(track => <details
        key={track.responsibilityTrack} className="min-w-0 rounded border border-border bg-bg-base p-3"
        data-testid={`responsibility-${track.responsibilityTrack}`}>
        <summary className="cursor-pointer text-xs">
          <strong>{track.label}</strong><span className="ml-2">{LABELS[track.state]}</span>
          <span className="mt-2 block text-text-muted">任务 {track.completedTasks}/{track.totalTasks} · 必需产物 {track.completedArtifacts}/{track.requiredArtifacts}</span>
        </summary>
        <div className="mt-3 space-y-3 text-xs leading-5">
          <p>模型调用 {track.usage.modelCalls} · 媒资调用 {track.usage.mediaCalls} · 费用 {track.usage.costUsd === null
            ? '未取得完整实值' : `$${track.usage.costUsd.toFixed(4)}`}{!track.usage.known && '（调用统计不完整）'}</p>
          <p className="text-text-muted">跨线任务可贡献多条线；调用和费用只计入任务主责，含失败尝试。</p>
          {track.running.length > 0 && <p className="break-words">当前运行：{track.running.join('、')}</p>}
          {track.staleReasons.length > 0 && <ul className="max-h-40 overflow-auto text-warning">
            {track.staleReasons.map(reason => <li key={reason} className="break-all">{reason}</li>)}
          </ul>}
          {track.blockers.length > 0 && <details><summary className="cursor-pointer">缺项与阻塞（{track.blockers.length}）</summary>
            <ul className="mt-2 max-h-60 space-y-2 overflow-auto">{track.blockers.map(reason => <li className="break-all" key={reason}>{reason}</li>)}</ul>
          </details>}
          {track.failures.map(failure => <p key={failure.taskKey} className="break-all text-warning">{failure.taskKey}：
            {failure.retryReady ? '调度器允许有界重试' : '需通过原恢复入口处理，结果未知时不得自动重发'}。
          </p>)}
          {track.degradations.length > 0 && <details><summary className="cursor-pointer">已声明降级（{track.degradations.length}）</summary>
            <ul className="mt-2 space-y-1">{track.degradations.map(item => <li className="break-words" key={item}>{item}</li>)}</ul>
          </details>}
          <details><summary className="cursor-pointer">任务、来源与下游</summary>
            <ul className="mt-2 max-h-96 space-y-3 overflow-auto">{track.tasks.map(task => <li key={task.taskKey}>
              <strong className="break-all">{task.stage} · {task.taskKey}</strong>
              <p>{task.objective}</p><p>执行 lane：{task.lane} · {task.progress.status}</p>
              <p className="break-all">输入：{task.inputArtifactKeys.join('、') || '已冻结的来源授权'}</p>
              <p className="break-all">下游：{task.downstreamTaskKeys.join('、') || '发布'}</p>
              {task.progress.runId && <button type="button" onClick={() => props.onInspectTask(task.taskKey)}
                className="mt-1 rounded border border-border px-2 py-1">查看任务证据</button>}
            </li>)}</ul>
          </details>
          <details><summary className="cursor-pointer">产物与返修位置</summary>
            <ul className="mt-2 max-h-96 space-y-3 overflow-auto">{track.artifacts.map(artifact => <li key={artifact.artifactKey}>
              <strong className="break-all">{artifact.artifactKey}</strong>
              <p>owner：文字开放世界 / {artifact.ownerTaskKey}</p>
              <p>{artifact.verified ? '生产验证通过' : '待生产或重新核验'}{artifact.version !== null ? ` · v${artifact.version}` : ''}</p>
              <p className="break-all">消费者：{artifact.consumerTaskKeys.join('、') || '来源审计 / 发布证据'}</p>
              <button type="button" onClick={() => props.onInspectArtifact(artifact.artifactKey)}
                className="mt-1 rounded border border-accent/40 px-2 py-1 text-accent">查看或返修产物</button>
            </li>)}</ul>
          </details>
        </div>
      </details>)}</div>
      <p className="mt-3 text-xs text-text-muted">组装与发布检查：{result.assemblyTasks.map(task => `${task.stage} ${task.progress.status}`).join(' · ')}。底层执行 lane 仍可在自动制作任务中查看。</p>
    </>}
  </section>
}
