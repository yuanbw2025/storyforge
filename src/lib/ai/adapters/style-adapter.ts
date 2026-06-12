import type { ChatMessage } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'
import type { RunOptions } from './outline-adapter'

/**
 * 文风学习(FB-5):把章节样本交给 AI,产出作者文风画像。
 *
 * 走 style.learn 提示词模块(getActive),不在调用方手拼 prompt。
 */
export function buildStyleLearnPrompt(
  samples: string,
  sampleCount: number,
  sampleWords: number,
  userHint?: string,
  options?: RunOptions,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('style.learn')
  const { messages } = renderPrompt(tpl, {
    samples,
    sampleCount,
    sampleWords,
    userHint: userHint || '',
  }, options)
  return messages
}
