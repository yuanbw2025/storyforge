import type { ChatMessage } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'
import { getEffectiveLimit } from '../../registry/effective-limits'

export interface RunOptions {
  parameterValues?: Record<string, unknown>
  overrides?: { systemPrompt?: string; userPromptTemplate?: string }
}

export function buildChapterContentPrompt(
  chapterTitle: string,
  chapterSummary: string,
  worldContext: string,
  characterContext: string,
  previousChapterEnding: string,
  worldRulesContext?: string,
  userHint?: string,
  options?: RunOptions,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('chapter.content')
  const { messages } = renderPrompt(tpl, {
    chapterTitle,
    chapterSummary,
    worldContext: worldContext || '（暂无）',
    characters: characterContext || '（暂无角色设定）',
    previousChapterEnding: previousChapterEnding || '（这是第一章）',
    worldRulesContext: worldRulesContext || '',
    userHint,
  }, options)
  return messages
}

export function buildContinuePrompt(
  existingContent: string,
  chapterSummary: string,
  worldContext: string,
  userHint?: string,
  options?: RunOptions,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('chapter.continue')
  // H5 — 续写时取已有正文末尾的字符数可调
  const tailChars = getEffectiveLimit('engine.continueTail', 3000)
  const { messages } = renderPrompt(tpl, {
    chapterSummary,
    worldContext: worldContext || '（暂无）',
    existingContent: existingContent.slice(-tailChars),
    userHint,
  }, options)
  return messages
}

export function buildPolishPrompt(text: string, instruction: string, options?: RunOptions): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('chapter.polish')
  const { messages } = renderPrompt(tpl, { text, instruction }, options)
  return messages
}

export function buildExpandPrompt(text: string, hint?: string, options?: RunOptions): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('chapter.expand')
  const { messages } = renderPrompt(tpl, { text, userHint: hint }, options)
  return messages
}

export function buildDeAIPrompt(text: string, options?: RunOptions): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('chapter.de-ai')
  const { messages } = renderPrompt(tpl, { text }, options)
  return messages
}
