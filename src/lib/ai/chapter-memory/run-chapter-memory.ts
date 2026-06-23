import type { ChatMessage } from '../../types'
import { adopt } from '../../registry/adopt'
import {
  parseChapterMemoryOutput,
  prepareChapterMemoryRequest,
  type ParsedChapterMemory,
} from '../adapters/chapter-memory-adapter'
import { CHAPTER_TEXT_NORMALIZATION_VERSION } from './text-normalization'

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
  const prepared = await prepareChapterMemoryRequest(args.chapterTitle, args.chapterContent)
  const raw = await args.call(prepared.messages)
  const memory = parseChapterMemoryOutput({
    raw,
    chapterId: args.chapterId,
    normalizedText: prepared.normalizedText,
    sourceTextHash: prepared.sourceTextHash,
  })
  if (!memory) return { status: 'parse-error' }

  const result = await adopt({
    projectId: args.projectId,
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
    },
  })

  return result.written.length > 0
    ? { status: 'written', memory }
    : { status: 'stale', memory }
}
