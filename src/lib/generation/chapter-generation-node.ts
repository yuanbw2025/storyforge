import type { UseAIStreamReturn } from '../../hooks/useAIStream'
import type { ChatMessage } from '../types'
import type { GenerationGateResult, GenerationNode } from './generation-node'

export type ChapterGenerationOperation = 'generate' | 'continue'
export type ChapterGenerationCategory = 'chapter.content' | 'chapter.continue'

export function createChapterGenerationNode(input: {
  operation: ChapterGenerationOperation
  category: ChapterGenerationCategory
  projectId: number
  chapterIdentity: number | string
  ai: Pick<UseAIStreamReturn, 'start'>
  gate?: (output: string) => Promise<GenerationGateResult> | GenerationGateResult
}): GenerationNode<ChatMessage[], string> {
  const { operation, category, projectId, chapterIdentity, ai, gate } = input
  return {
    id: `chapter.${operation}:${chapterIdentity}`,
    kind: category,
    editableInput: true,
    assembleInput: messages => messages.map(message => ({ ...message })),
    run: messages => category === 'chapter.content'
      ? ai.start(messages, undefined, { category: 'chapter.content', projectId })
      : ai.start(messages, undefined, { category: 'chapter.continue', projectId }),
    ...(gate ? { gate } : {}),
  }
}
