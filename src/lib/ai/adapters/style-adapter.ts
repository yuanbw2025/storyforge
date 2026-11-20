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
  advanced?: {
    revisionPairs?: string
    calibrationFeedback?: string
    userHint?: string
  },
  options?: RunOptions,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('style.learn')
  const { messages } = renderPrompt(tpl, {
    samples,
    sampleCount,
    sampleWords,
    revisionPairs: advanced?.revisionPairs || '',
    calibrationFeedback: advanced?.calibrationFeedback || '',
    userHint: advanced?.userHint || '',
  }, options)
  return messages
}

/** 用当前画像和有界改稿样本重写短文，结果必须由作者确认后才会沉淀为新样本。 */
export function buildStyleCalibrationPrompt(
  input: {
    profile: string
    revisionPairs?: string
    calibrationFeedback?: string
    sourceText: string
  },
  options?: RunOptions,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('style.calibrate')
  const { messages } = renderPrompt(tpl, {
    profile: input.profile,
    revisionPairs: input.revisionPairs || '',
    calibrationFeedback: input.calibrationFeedback || '',
    sourceText: input.sourceText,
  }, options)
  return messages
}
