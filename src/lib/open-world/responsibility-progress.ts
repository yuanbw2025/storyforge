import type { ProductProductionPlanV3 } from '../types'
import type {
  ProductProductionSchedulerProjectionV1,
  ProductProductionTaskUsageV1,
} from '../product-production/scheduler'
import type { TextOpenWorldArtifactGovernanceProjectionV1 } from './creator-artifact-governance'
import {
  createTextOpenWorldResponsibilityMatrixV1,
  TEXT_OPEN_WORLD_RESPONSIBILITY_LABELS_V1,
  TEXT_OPEN_WORLD_RESPONSIBILITY_TRACKS_V1,
  textOpenWorldTaskResponsibilityV1,
} from './responsibility-contract'

export type TextOpenWorldResponsibilityStateV1 = 'not-started' | 'running' | 'blocked' | 'failed' | 'ready' | 'stale'
export interface TextOpenWorldResponsibilityUsageV1 {
  taskKey: string
  usage: ProductProductionTaskUsageV1 | null
  usageKnown: boolean
}

export function projectTextOpenWorldResponsibilitiesV1(input: {
  plan: ProductProductionPlanV3
  progress: ProductProductionSchedulerProjectionV1
  governance: TextOpenWorldArtifactGovernanceProjectionV1
  usage: TextOpenWorldResponsibilityUsageV1[]
  degradations: string[]
}) {
  const { plan, progress, governance } = input
  if (progress.buildId !== governance.build.id || progress.productionId !== governance.production.id
    || progress.planHash !== governance.build.planHash || progress.controlEpoch !== governance.build.controlEpoch
    || plan.controlEpoch !== progress.controlEpoch || plan.buildNumber !== progress.buildNumber) {
    throw new Error('[text-open-world-responsibility] Build/Plan/epoch 快照已变化，请刷新')
  }
  const matrix = createTextOpenWorldResponsibilityMatrixV1(plan)
  const byTask = new Map(progress.tasks.map(task => [task.taskKey, task]))
  if (progress.tasks.length !== plan.tasks.length || byTask.size !== plan.tasks.length || plan.tasks.some(task => !byTask.has(task.taskKey))) {
    throw new Error('[text-open-world-responsibility] 调度任务快照不完整')
  }
  const artifacts = matrix.artifacts.map(definition => {
    const rows = governance.artifacts.filter(row => row.artifactKey === definition.artifactKey)
    const current = rows.filter(row => row.currentEpoch && ['accepted', 'carried-forward'].includes(row.artifactStatus))
    const row = current.length === 1 ? current[0] : rows.sort((a, b) => b.version - a.version)[0]
    const verified = current.length === 1 && row.health === 'verified'
      && row.productionValidation === 'production-validated' && row.ownerTaskKey === definition.ownerTaskKey
    return {
      ...definition, verified, contentHash: row?.contentHash ?? null,
      version: row?.version ?? null, health: row?.health ?? 'pending',
      stale: !!row && (row.health === 'stale' || !row.currentEpoch),
      problems: current.length > 1 ? ['同一产物存在多个当前有效版本']
        : row?.diagnostics.map(diagnostic => diagnostic.message) ?? [],
    }
  })
  const taskRows = matrix.tasks.map(definition => ({
    ...definition, progress: byTask.get(definition.taskKey)!,
  }))
  const tracks = TEXT_OPEN_WORLD_RESPONSIBILITY_TRACKS_V1.map(responsibilityTrack => {
    // Cross-line producers count as contributors, but usage is attributed once
    // to the primary task owner. V3/QA are a separate join, never prerequisites
    // of their own readiness.
    const tasks = taskRows.filter(task => !task.assembly && task.contributingTracks.includes(responsibilityTrack))
    const outputs = artifacts.filter(row => !row.assembly && row.responsibilityTrack === responsibilityTrack)
    const running = tasks.filter(task => task.progress.status === 'running').map(task => task.taskKey)
    const staleReasons = [
      ...tasks.filter(task => task.progress.status === 'stale').map(task => `${task.taskKey}：运行来源已失效`),
      ...outputs.filter(row => row.stale).map(row => `${row.artifactKey}：没有当前 epoch 的有效产物`),
    ]
    const failures = tasks.flatMap(task => {
      const codes = task.progress.steps.filter(step => step.status === 'failed')
        .map(step => step.failureCode ?? 'task-failed')
      return task.progress.status === 'blocked' || task.progress.status === 'retry-ready'
        ? [{ taskKey: task.taskKey, reason: task.progress.blocker ?? codes[0] ?? '等待作者处理',
          retryReady: task.progress.status === 'retry-ready' }]
        : []
    })
    const blockers = [
      ...tasks.filter(task => task.progress.status === 'waiting').map(task => (
        `${task.taskKey} 等待：${task.dependsOn.filter(key => byTask.get(key)?.status !== 'completed').join('、') || '依赖回执核验'}`
      )),
      ...tasks.filter(task => task.progress.status === 'completed' && !task.progress.terminalReceiptHash)
        .map(task => `${task.taskKey} 缺少完成回执`),
      ...outputs.filter(row => !row.verified).map(row => (
        `${row.artifactKey}：${row.problems.join('；') || '必需产物尚未通过生产验证'}`
      )),
      ...failures.map(item => `${item.taskKey}：${item.reason}`),
    ]
    const completedTasks = tasks.filter(task => task.progress.status === 'completed' && task.progress.terminalReceiptHash).length
    const completedArtifacts = outputs.filter(row => row.verified).length
    const ready = tasks.length > 0 && outputs.length > 0 && completedTasks === tasks.length
      && completedArtifacts === outputs.length && staleReasons.length === 0 && failures.length === 0
    const failed = outputs.some(row => ['invalid', 'corrupt', 'dangling'].includes(row.health))
      || tasks.some(task => task.progress.steps.some(step => step.status === 'failed')
        && task.progress.status !== 'completed' && task.progress.status !== 'running')
    const started = tasks.some(task => task.progress.runId !== null) || outputs.some(row => row.contentHash)
    const state: TextOpenWorldResponsibilityStateV1 = staleReasons.length ? 'stale'
      : failed ? 'failed' : ready ? 'ready' : failures.length ? 'blocked'
        : running.length ? 'running' : !started ? 'not-started' : 'blocked'
    const usageEntries = input.usage.filter(row => textOpenWorldTaskResponsibilityV1(row.taskKey) === responsibilityTrack)
    const usageKnown = usageEntries.every(row => row.usageKnown && row.usage !== null)
    const known = usageEntries.flatMap(row => row.usage ? [row.usage] : [])
    return {
      responsibilityTrack, label: TEXT_OPEN_WORLD_RESPONSIBILITY_LABELS_V1[responsibilityTrack],
      state, readyForAssembly: ready, tasks, artifacts: outputs,
      completedTasks, totalTasks: tasks.length, completedArtifacts, requiredArtifacts: outputs.length,
      running, blockers: ready ? [] : blockers, failures, staleReasons,
      degradations: responsibilityTrack === 'media' ? input.degradations : [],
      usage: {
        known: usageKnown,
        modelCalls: known.reduce((sum, row) => sum + row.modelCalls, 0),
        mediaCalls: known.reduce((sum, row) => sum + row.mediaCalls, 0),
        costUsd: !usageKnown || known.some(row => row.costUsd === null) ? null
          : known.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
      },
    }
  })
  return {
    schema: 'storyforge.text-open-world-responsibility-progress' as const,
    version: 1 as const,
    build: governance.build, snapshotHash: governance.snapshotHash,
    tracks, readyForAssembly: tracks.every(track => track.readyForAssembly),
    assemblyTasks: taskRows.filter(task => task.assembly),
  }
}

export type TextOpenWorldResponsibilityProgressV1 = ReturnType<typeof projectTextOpenWorldResponsibilitiesV1>
