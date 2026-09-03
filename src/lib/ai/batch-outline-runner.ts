import { useAIConfigStore } from '../../stores/ai-config'
import {
  prepareGenerationNode,
  runGenerationNode,
} from '../generation/generation-node'
import {
  createOutlineGenerationTraceV1,
  type OutlineGenerationCandidateV1,
} from '../outline/harness'
import { createOutlineGenerationNode } from '../outline/generation-node'
import type { RunOptions } from './adapters/outline-adapter'
import { chat } from './client'
import {
  parseChapterOutlineOutput,
  type ParsedChapter,
} from './parse-outline-output'
import type { AssembleContextResult } from '../registry/types'
import type { ChatMessage, OutlineNode, Project } from '../types'
import type { OutlineGenerationTraceV1 } from '../outline/harness'
import {
  assertWorkspaceContentRevisionFreshV1,
  captureWorkspaceContentRevisionV1,
} from '../authoring/content-revision'
import { resolveScopeLike } from '../workspace/scope'

export interface BatchOutlineProgress {
  currentVolumeIndex: number
  totalVolumes: number
  currentVolumeTitle: string
  parsedChapters: ParsedChapter[]
  completedVolumes: number
  stage: string
}

export interface BatchOutlineFailure {
  volumeId: number
  volumeTitle: string
  reason: string
}

export interface BatchOutlineResult {
  batchGroupId: string
  chaptersByVolume: Map<number, ParsedChapter[]>
  candidatesByVolume: Map<number, OutlineGenerationCandidateV1>
  failures: BatchOutlineFailure[]
  cancelled: boolean
  elapsed: number
}

export interface BatchOutlineContextRequest {
  volume: OutlineNode
  priorOutlineCandidateText?: string
}

export interface BatchOutlineOptions {
  project: Project
  nodes: OutlineNode[]
  volumes: OutlineNode[]
  assembleContext: (request: BatchOutlineContextRequest) => Promise<AssembleContextResult>
  userHint?: string
  runOptions?: RunOptions
  onProgress?: (progress: BatchOutlineProgress) => void
  signal?: AbortSignal
  /** Test seam for proving one model call per volume without changing production routing. */
  runModel?: (messages: ChatMessage[], volume: OutlineNode, signal?: AbortSignal) => Promise<string>
  /** Stable injection for recovery tests. Production callers omit it. */
  batchGroupId?: string
}

function newBatchGroupId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `outline-batch-${globalThis.crypto.randomUUID()}`
  }
  return `outline-batch-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function priorCandidateContext(input: {
  volume: OutlineNode
  chapters: ParsedChapter[]
  candidate: OutlineGenerationCandidateV1
}): string {
  return [
    '【同批次上一卷章纲候选（尚未采纳）】',
    `卷：${input.volume.title}`,
    `候选哈希：${input.candidate.candidateHash}`,
    ...input.chapters.map((chapter, index) => (
      `${index + 1}. ${chapter.title}${chapter.summary ? `：${chapter.summary}` : ''}`
    )),
    '仅用于保持后续卷的承接关系；它不是已采纳 Canon，不得覆盖用户正式设定。',
  ].join('\n')
}

function cancelledResult(input: {
  batchGroupId: string
  chaptersByVolume: Map<number, ParsedChapter[]>
  candidatesByVolume: Map<number, OutlineGenerationCandidateV1>
  failures: BatchOutlineFailure[]
  startTime: number
}): BatchOutlineResult {
  return {
    batchGroupId: input.batchGroupId,
    chaptersByVolume: input.chaptersByVolume,
    candidatesByVolume: input.candidatesByVolume,
    failures: input.failures,
    cancelled: true,
    elapsed: Date.now() - input.startTime,
  }
}

async function finalizeFailedTrace(input: {
  trace: OutlineGenerationTraceV1 | null
  cancelled: boolean
  code: string
}): Promise<void> {
  if (!input.trace) return
  await input.trace.terminateRun({
    status: input.cancelled ? 'cancelled' : 'failed',
    code: input.code,
  })
}

/**
 * 按卷生成 durable 章纲候选。每卷只有一次模型调用；输出必须通过
 * 确定性解析，候选持久化成功后才会进入可确认结果。
 */
export async function runBatchOutlineGeneration(
  options: BatchOutlineOptions,
): Promise<BatchOutlineResult> {
  const {
    project,
    nodes,
    volumes,
    assembleContext,
    userHint,
    runOptions = {},
    onProgress,
    signal,
  } = options
  if (project.id == null) throw new Error('批量章纲生成缺少项目 ID')
  const batchGroupId = options.batchGroupId ?? newBatchGroupId()
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(batchGroupId)) throw new Error('批量章纲任务 ID 不符合受控格式')

  const config = useAIConfigStore.getState().config
  const chaptersByVolume = new Map<number, ParsedChapter[]>()
  const candidatesByVolume = new Map<number, OutlineGenerationCandidateV1>()
  const failures: BatchOutlineFailure[] = []
  const startTime = Date.now()
  let previous: {
    volume: OutlineNode
    chapters: ParsedChapter[]
    candidate: OutlineGenerationCandidateV1
  } | null = null

  for (let index = 0; index < volumes.length; index++) {
    if (signal?.aborted) {
      return cancelledResult({ batchGroupId, chaptersByVolume, candidatesByVolume, failures, startTime })
    }
    const volume = volumes[index]
    if (volume.id == null) {
      failures.push({ volumeId: -1, volumeTitle: volume.title, reason: '目标卷缺少持久化 ID' })
      continue
    }
    const volumeId = volume.id
    onProgress?.({
      currentVolumeIndex: index,
      totalVolumes: volumes.length,
      currentVolumeTitle: volume.title,
      parsedChapters: [],
      completedVolumes: index,
      stage: `正在生成「${volume.title}」的章节大纲...`,
    })

    let trace: OutlineGenerationTraceV1 | null = null
    try {
      const scopedPrevious = previous
        && (previous.volume.worldGroupId ?? null) === (volume.worldGroupId ?? null)
        ? previous
        : null
      const predecessorCandidateHash = scopedPrevious?.candidate.candidateHash
      const scope = await resolveScopeLike(project.id)
      const contentRevision = await captureWorkspaceContentRevisionV1({
        scope,
        worldGroupId: volume.worldGroupId ?? null,
      })
      const assembled = await assembleContext({
        volume,
        priorOutlineCandidateText: scopedPrevious ? priorCandidateContext(scopedPrevious) : undefined,
      })
      await assertWorkspaceContentRevisionFreshV1(contentRevision, {
        scope,
        worldGroupId: volume.worldGroupId ?? null,
      })
      if (signal?.aborted) {
        return cancelledResult({ batchGroupId, chaptersByVolume, candidatesByVolume, failures, startTime })
      }
      const request = { kind: 'chapters' as const, volumeId }
      const runModel = options.runModel ?? ((messages: ChatMessage[], target: OutlineNode, abortSignal?: AbortSignal) => (
        chat(messages, config, { category: 'outline.chapter', projectId: target.projectId }, abortSignal)
      ))
      const node = createOutlineGenerationNode({
        request,
        project,
        nodes,
        volumes,
        hint: userHint ?? '',
        runOptions,
        ai: { start: messages => runModel(messages, volume, signal) },
      })
      const prepared = prepareGenerationNode(node, assembled)
      trace = await createOutlineGenerationTraceV1({
        projectId: project.id,
        worldGroupId: volume.worldGroupId ?? null,
        request,
        assembled,
        priorOutlineCandidateText: scopedPrevious ? priorCandidateContext(scopedPrevious) : undefined,
        durable: true,
        batch: {
          batchGroupId,
          batchIndex: index,
          batchTotal: volumes.length,
          ...(predecessorCandidateHash ? { predecessorCandidateHash } : {}),
        },
        contentRevision,
      })
      if (!trace.durable) {
        throw new Error(`durable 运行初始化失败：${trace.initializationError ?? '未知原因'}`)
      }
      const generation = await runGenerationNode(node, prepared, {
        shadowTrace: trace,
        traceFailureMode: 'throw',
      })
      if (generation.gate?.status === 'blocked') {
        throw new Error(generation.gate.issues.map(issue => issue.message).join('；'))
      }
      const parsed = parseChapterOutlineOutput(generation.output)
      if (parsed.length === 0) throw new Error('模型输出无法确定性解析为章节大纲')
      const candidate = await trace.persistCandidate(generation.output)
      if (!candidate) throw new Error('durable 候选未能持久化')

      chaptersByVolume.set(volumeId, parsed)
      candidatesByVolume.set(volumeId, candidate)
      previous = { volume, chapters: parsed, candidate }
      onProgress?.({
        currentVolumeIndex: index,
        totalVolumes: volumes.length,
        currentVolumeTitle: volume.title,
        parsedChapters: parsed,
        completedVolumes: index + 1,
        stage: `「${volume.title}」完成，生成了 ${parsed.length} 章`,
      })
      if (signal?.aborted) {
        await finalizeFailedTrace({
          trace,
          cancelled: true,
          code: 'author_cancelled_batch',
        })
        return cancelledResult({ batchGroupId, chaptersByVolume, candidatesByVolume, failures, startTime })
      }
    } catch (error) {
      if (signal?.aborted) {
        await finalizeFailedTrace({
          trace,
          cancelled: true,
          code: 'author_cancelled_batch',
        })
        return cancelledResult({ batchGroupId, chaptersByVolume, candidatesByVolume, failures, startTime })
      }
      const reason = error instanceof Error ? error.message : String(error)
      await finalizeFailedTrace({
        trace,
        cancelled: false,
        code: reason,
      })
      console.error(`[BatchOutline] 卷「${volume.title}」生成失败:`, error)
      failures.push({ volumeId, volumeTitle: volume.title, reason })
      onProgress?.({
        currentVolumeIndex: index,
        totalVolumes: volumes.length,
        currentVolumeTitle: volume.title,
        parsedChapters: [],
        completedVolumes: index + 1,
        stage: `「${volume.title}」生成失败，已保留诊断并跳过`,
      })
    }
  }

  return {
    batchGroupId,
    chaptersByVolume,
    candidatesByVolume,
    failures,
    cancelled: false,
    elapsed: Date.now() - startTime,
  }
}
