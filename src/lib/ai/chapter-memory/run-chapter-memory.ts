import type { ChatMessage } from '../../types'
import { adopt } from '../../registry/adopt'
import {
  parseChapterMemoryOutput,
  prepareChapterMemoryRequest,
  type ParsedChapterMemory,
} from '../adapters/chapter-memory-adapter'
import { CHAPTER_TEXT_NORMALIZATION_VERSION } from './text-normalization'
import { loadChapterPlanSnapshot } from './plan-reconciliation'
import { assertRecordInScope, resolveScopeLike } from '../../world-engine/scope'
import { db } from '../../db/schema'

export interface ChapterMemoryTaskResult {
  status: 'written' | 'stale' | 'parse-error'
  memory?: ParsedChapterMemory
}

/**
 * 捕获固定 chapterId/content，单次调用生成 summary + handoff，再经原子 CAS 写回。
 * 调用方不得在完成回调中重新读取 currentChapter。
 */
export async function runChapterMemoryTask(args: {
  projectId: number
  chapterId: number
  chapterTitle: string
  chapterContent: string
  call: (messages: ChatMessage[]) => Promise<string>
}): Promise<ChapterMemoryTaskResult> {
  const scope = await resolveScopeLike(args.projectId)
  const chapter = await db.chapters.get(args.chapterId)
  if (!await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    return { status: 'stale' }
  }
  const planSnapshot = await loadChapterPlanSnapshot(args.projectId, args.chapterId, scope)
  const prepared = await prepareChapterMemoryRequest(
    args.chapterTitle,
    args.chapterContent,
    planSnapshot.currentPlan,
    planSnapshot.nextChapterPlan,
  )
  const raw = await args.call(prepared.messages)
  const memory = parseChapterMemoryOutput({
    raw,
    chapterId: args.chapterId,
    normalizedText: prepared.normalizedText,
    sourceTextHash: prepared.sourceTextHash,
    planSourceHash: planSnapshot.currentPlan ? planSnapshot.planSourceHash : undefined,
  })
  if (!memory) return { status: 'parse-error' }
  const latestPlan = await loadChapterPlanSnapshot(args.projectId, args.chapterId, scope)
  const planStillCurrent = latestPlan.planSourceHash === planSnapshot.planSourceHash

  const result = await adopt({
    projectId: args.projectId,
    scope,
    recordId: args.chapterId,
    target: 'chapters',
    mode: 'replace',
    compareAndSet: {
      kind: 'chapter-source-text-hash',
      expectedHash: prepared.sourceTextHash,
      textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
    },
    data: {
      summary: memory.summary,
      summarySourceTextHash: prepared.sourceTextHash,
      summaryTextNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
      continuityHandoff: memory.handoff,
      ...(planStillCurrent && memory.planReconciliation
        ? { planReconciliation: memory.planReconciliation }
        : {}),
    },
  })

  return result.written.length > 0
    ? { status: 'written', memory }
    : { status: 'stale', memory }
}
