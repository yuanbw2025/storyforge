import type { UseAIStreamReturn } from '../../hooks/useAIStream'
import type { ChatMessage } from '../types'
import type { AIRequestConfigResolution, StreamResult } from '../ai/client'
import type { GenerationGateResult, GenerationNode } from './generation-node'

export type ChapterGenerationOperation = 'generate' | 'continue'

/** A received fragment stays inspectable, but never enters the complete draft gate. */
export class InterruptedChapterGenerationErrorV1 extends Error {
  constructor(readonly output: string, readonly completion: 'cancelled' | 'failed' | 'unknown') {
    super(completion === 'cancelled'
      ? '生成已停止。收到的片段已保留，未作为完整正文候选；没有自动重发。'
      : completion === 'unknown'
        ? '连接结束但未收到模型完成确认。收到的片段已保留，结果未确认；没有自动重发。'
        : '生成未完成。收到的片段已保留，未作为完整正文候选；没有自动重发。')
    this.name = 'InterruptedChapterGenerationErrorV1'
  }
}
export type ChapterGenerationCategory = 'chapter.content' | 'chapter.continue'

export function createChapterGenerationNode(input: {
  operation: ChapterGenerationOperation
  category: ChapterGenerationCategory
  projectId: number
  chapterIdentity: number | string
  ai: Pick<UseAIStreamReturn, 'start'>
  gate?: (output: string) => Promise<GenerationGateResult> | GenerationGateResult
  generationOverrides?: { temperature?: number; maxTokens?: number }
  frozenResolution?: AIRequestConfigResolution
  streamResult?: StreamResult
}): GenerationNode<ChatMessage[], string> {
  const { operation, category, projectId, chapterIdentity, ai, gate } = input
  const modelOptions = input.generationOverrides ? { configOverrides: { ...input.generationOverrides } } : {}
  return {
    id: `chapter.${operation}:${chapterIdentity}`,
    kind: category,
    editableInput: true,
    assembleInput: messages => messages.map(message => ({ ...message })),
    run: async messages => {
      const output = category === 'chapter.content'
        ? await ai.start(messages, undefined, { formalEntryId: 'prose.chapter.generate', category: 'chapter.content', projectId, contextOverflowPolicy: 'reject', transportRetryPolicy: 'none', ...modelOptions }, input.frozenResolution, input.streamResult)
        : await ai.start(messages, undefined, { formalEntryId: 'prose.chapter.continue', category: 'chapter.continue', projectId, contextOverflowPolicy: 'reject', transportRetryPolicy: 'none', ...modelOptions }, input.frozenResolution, input.streamResult)
      const completion = input.streamResult?.completion
      if (completion && completion !== 'complete') throw new InterruptedChapterGenerationErrorV1(output, completion)
      return output
    },
    ...(gate ? { gate } : {}),
  }
}
