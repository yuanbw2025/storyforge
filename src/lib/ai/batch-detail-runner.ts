/**
 * Phase 30.1 / HARNESS-10 — 细纲批量生成引擎
 *
 * 功能：
 * batchGenerateDetails: 对无细纲的章节批量生成 durable 候选，经作者确认后受控采纳。
 * 支持进度回调、AbortSignal 中途停止、单章失败留证和父任务终态验证。
 */

import { chat } from './client'
import { useAIConfigStore } from '../../stores/ai-config'
import { buildEnhancedDetailPrompt, parseEnhancedDetailResult } from './adapters/detail-scene-adapter'
import type { OutlineNode, DetailedOutline, WorkspaceScope } from '../types'
import type { AssembleContextResult } from '../registry/types'
import type { ScenePace } from '../types/detailed-outline'
import { nanoid } from '../utils/id'
import { hashCanonicalValue } from '../agent/run/hash'
import { hashDetailedOutlineSourceSummaryV1 } from '../agent/run/detailed-outline-generation-durable'
import {
  beginDetailedOutlineBatchStepV1,
  cancelDetailedOutlineBatchRunV1,
  commitDetailedOutlineBatchCandidateV1,
  createDetailedOutlineBatchDurableRunV1,
  detailedOutlineBatchManifestV1,
  detailedOutlineBatchStepIdV1,
  failDetailedOutlineBatchStepV1,
  hashDetailedOutlineBatchCandidateV1,
  pauseDetailedOutlineBatchRunV1,
  persistDetailedOutlineBatchCandidateV1,
  recordDetailedOutlineBatchCandidateV1,
  recordDetailedOutlineBatchModelOutputV1,
  rejectDetailedOutlineBatchCandidateV1,
  verifyDetailedOutlineBatchRunV1,
  DETAILED_OUTLINE_BATCH_GENERATION_CANDIDATE_TYPE_V1,
  type DetailedOutlineBatchCandidateV1,
} from '../agent/run/detailed-outline-batch-durable'

// ── 公共类型 ─────────────────────────────────────────────────────

export interface BatchProgress {
  current: number
  total: number
  currentTitle: string
  stage: string
  /** 已完成数（含失败跳过的） */
  completed: number
  /** 失败的章节标题列表 */
  failures: string[]
}

// ── 批量细纲 ─────────────────────────────────────────────────────

export interface BatchDetailOptions {
  /** 需要生成细纲的章节节点列表（按 order 排好序） */
  chapters: OutlineNode[]
  /** 已有细纲列表（用于跳过） */
  existingDetails: DetailedOutline[]
  /** 保存回调：把生成的细纲数据写入 store/DB */
  onSave: (outlineNodeId: number, data: Partial<DetailedOutline>) => Promise<void>
  /** H10：批量任务必须绑定当前 Work，不允许以 projectId 猜测写入范围。 */
  scope: WorkspaceScope
  /** H10：逐章提供真实 assembleContext 结果，供 Context Manifest 留证。 */
  contextResolver: (chapterNodeId: number) => Promise<{
    worldGroupId: number | null
    worldContext: string
    characterContext?: string
    foreshadowContext?: string
    assembled: AssembleContextResult
  }>
  /** 候选落入 durable ledger 后等待作者逐章确认；未确认绝不调用 onSave。 */
  onCandidate: (input: {
    chapter: OutlineNode
    candidate: DetailedOutlineBatchCandidateV1
  }) => Promise<'adopt' | 'reject'>
  /** 采纳后读取正式表，用于父任务终态验证。 */
  onPostState: (outlineNodeId: number) => Promise<unknown>
  onRunCreated?: (runId: number) => void
  onProgress?: (p: BatchProgress) => void
  signal?: AbortSignal
}

export interface BatchDetailResult {
  generated: number
  skipped: number
  failed: number
  cancelled: boolean
  elapsed: number
  runIds: number[]
}

/** 批量生成细纲：跳过已有、串行调用 AI、逐章确认后受控采纳。 */
export async function batchGenerateDetails(
  opts: BatchDetailOptions,
): Promise<BatchDetailResult> {
  const {
    chapters,
    existingDetails,
    onSave,
    onProgress,
    signal,
    scope,
    contextResolver,
    onCandidate,
    onPostState,
    onRunCreated,
  } = opts
  const config = useAIConfigStore.getState().config
  const start = Date.now()

  // 过滤出需要生成的
  const detailNodeIds = new Set(existingDetails.filter(d => d.scenes.length > 0).map(d => d.outlineNodeId))
  const todo = chapters.filter(ch => !detailNodeIds.has(ch.id!))

  let generated = 0
  let failed = 0
  const failures: string[] = []
  const runIds: number[] = []

  const groups = new Map<number | null, OutlineNode[]>()
  for (const chapter of todo) {
    const worldGroupId = chapter.worldGroupId ?? null
    groups.set(worldGroupId, [...(groups.get(worldGroupId) ?? []), chapter])
  }

  let processed = 0

  for (const [worldGroupId, group] of groups) {
    let snapshot = await createDetailedOutlineBatchDurableRunV1({
      scope,
      worldGroupId,
      outlineNodeIds: group.map(chapter => chapter.id!),
    })
    runIds.push(snapshot.run.id)
    onRunCreated?.(snapshot.run.id)
    const acceptedCandidates: DetailedOutlineBatchCandidateV1[] = []
    const postStates: unknown[] = []
    let groupFailed = false

    for (const ch of group) {
      if (signal?.aborted) {
        snapshot = await cancelDetailedOutlineBatchRunV1({ scope, snapshot })
        return {
          generated,
          skipped: chapters.length - todo.length,
          failed,
          cancelled: true,
          elapsed: Date.now() - start,
          runIds,
        }
      }

      onProgress?.({
        current: processed + 1,
        total: todo.length,
        currentTitle: ch.title,
        stage: `正在生成「${ch.title}」的细纲候选...`,
        completed: processed,
        failures,
      })

      try {
        const context = await contextResolver(ch.id!)
        if (context.worldGroupId !== worldGroupId) {
          throw new Error('批量细纲逐章上下文与父任务世界作用域不一致。')
        }
        const messages = buildEnhancedDetailPrompt(
          ch.title,
          ch.summary || '',
          '',
          '',
          context.worldContext,
          context.characterContext ?? '',
          context.foreshadowContext ?? '',
        )
        const manifest = await detailedOutlineBatchManifestV1({
          runId: snapshot.run.id,
          scope,
          worldGroupId,
          outlineNodeId: ch.id!,
          assembled: context.assembled,
        })
        const sourceSummaryHash = await hashDetailedOutlineSourceSummaryV1(ch.summary || '')
        snapshot = await beginDetailedOutlineBatchStepV1({
          scope,
          snapshot,
          contextManifest: manifest,
          binding: {
            outlineNodeId: ch.id!,
            sourceSummaryHash,
            promptHash: await hashCanonicalValue(messages),
          },
        })

        const rawOutput = await chat(
          messages,
          config,
          { category: 'detail.scene', projectId: ch.projectId, contextOverflowPolicy: 'reject' },
          signal,
        )
        if (signal?.aborted) {
          snapshot = await cancelDetailedOutlineBatchRunV1({ scope, snapshot })
          return {
            generated,
            skipped: chapters.length - todo.length,
            failed,
            cancelled: true,
            elapsed: Date.now() - start,
            runIds,
          }
        }

        snapshot = await recordDetailedOutlineBatchModelOutputV1({
          scope,
          snapshot,
          outlineNodeId: ch.id!,
          output: rawOutput,
        })
        const parsed = parseEnhancedDetailResult(rawOutput)
        if (!parsed?.scenes?.length) {
          snapshot = await failDetailedOutlineBatchStepV1({
            scope,
            snapshot,
            outlineNodeId: ch.id!,
            code: 'invalid_structured_detail_output',
            retryable: true,
          })
          failed++
          groupFailed = true
          failures.push(ch.title)
          continue
        }

        const data: Partial<DetailedOutline> = {}
        if (parsed.openingHook) data.openingHook = parsed.openingHook
        if (parsed.endingCliffhanger) data.endingCliffhanger = parsed.endingCliffhanger
        if (parsed.sceneLocation) data.sceneLocation = parsed.sceneLocation
        if (parsed.emotionArc) data.emotionArc = parsed.emotionArc as DetailedOutline['emotionArc']
        if (parsed.appearingCharacterIds) data.appearingCharacterIds = parsed.appearingCharacterIds
        if (parsed.foreshadowIds) data.foreshadowIds = parsed.foreshadowIds
        // Phase 30.3: 快照大纲摘要
        data.lastUsedSummary = ch.summary || ''

        if (parsed.scenes && parsed.scenes.length > 0) {
          data.scenes = parsed.scenes.map(s => ({
            sceneId: nanoid(),
            title: s.title,
            summary: s.summary,
            characterIds: s.characterIds || [],
            location: s.location || '',
            conflict: s.conflict || '',
            pace: (s.pace || 'medium') as ScenePace,
            estimatedWords: s.estimatedWords || 0,
            notes: '',
          }))
        }

        const baseCandidate: Omit<DetailedOutlineBatchCandidateV1, 'durable'> = {
          version: 1,
          type: DETAILED_OUTLINE_BATCH_GENERATION_CANDIDATE_TYPE_V1,
          projectId: scope.projectId,
          runId: snapshot.run.id,
          stepId: detailedOutlineBatchStepIdV1(ch.id!),
          outlineNodeId: ch.id!,
          worldGroupId,
          operation: 'enhanced',
          sourceSummaryHash,
          output: rawOutput,
          outputHash: await hashCanonicalValue(rawOutput),
          contextManifestHash: manifest.manifestHash,
          workspaceScope: scope,
          createdAt: Date.now(),
        }
        const draftCandidate: DetailedOutlineBatchCandidateV1 = {
          ...baseCandidate,
          durable: {
            runId: snapshot.run.id,
            stepId: detailedOutlineBatchStepIdV1(ch.id!),
            attempt: 1,
            candidateHash: '',
          },
        }
        const candidate: DetailedOutlineBatchCandidateV1 = {
          ...draftCandidate,
          durable: {
            ...draftCandidate.durable,
            candidateHash: await hashDetailedOutlineBatchCandidateV1(draftCandidate),
          },
        }
        await persistDetailedOutlineBatchCandidateV1({ scope, candidate })
        snapshot = await recordDetailedOutlineBatchCandidateV1({ scope, snapshot, candidate })
        onProgress?.({
          current: processed + 1,
          total: todo.length,
          currentTitle: ch.title,
          stage: `等待确认「${ch.title}」的细纲候选...`,
          completed: processed,
          failures,
        })
        const decision = await onCandidate({ chapter: ch, candidate })
        if (decision === 'reject') {
          snapshot = await rejectDetailedOutlineBatchCandidateV1({
            scope,
            runId: snapshot.run.id,
            candidate,
          })
          failed++
          failures.push(ch.title)
          return {
            generated,
            skipped: chapters.length - todo.length,
            failed,
            cancelled: true,
            elapsed: Date.now() - start,
            runIds,
          }
        }
        snapshot = await commitDetailedOutlineBatchCandidateV1({
          scope,
          runId: snapshot.run.id,
          candidate,
          output: rawOutput,
          currentSourceSummaryHash: () => hashDetailedOutlineSourceSummaryV1(ch.summary || ''),
          adopt: () => onSave(ch.id!, data),
          postState: () => onPostState(ch.id!),
        })
        acceptedCandidates.push(candidate)
        postStates.push(await onPostState(ch.id!))
        generated++
      } catch (err) {
        console.error(`[BatchDetail] 「${ch.title}」生成失败:`, err)
        const step = snapshot.projection.steps[detailedOutlineBatchStepIdV1(ch.id!)]
        if (!step || ['scheduled', 'running'].includes(step.status)) {
          snapshot = await failDetailedOutlineBatchStepV1({
            scope,
            snapshot,
            outlineNodeId: ch.id!,
            code: err instanceof Error ? err.message : 'batch_detail_failed',
            retryable: true,
          })
        }
        failed++
        groupFailed = true
        failures.push(ch.title)
      } finally {
        processed++
      }
    }

    if (groupFailed) {
      snapshot = await pauseDetailedOutlineBatchRunV1({
        scope,
        snapshot,
        reason: `批量细纲有 ${failures.length} 个章节失败；保留断点等待重试。`,
      })
    } else {
      await verifyDetailedOutlineBatchRunV1({
        scope,
        runId: snapshot.run.id,
        candidates: acceptedCandidates,
        postStates,
      })
    }
  }

  onProgress?.({
    current: todo.length,
    total: todo.length,
    currentTitle: '',
    stage: `完成！生成 ${generated}，跳过 ${chapters.length - todo.length}，失败 ${failed}`,
    completed: todo.length,
    failures,
  })

  return {
    generated,
    skipped: chapters.length - todo.length,
    failed,
    cancelled: false,
    elapsed: Date.now() - start,
    runIds,
  }
}
