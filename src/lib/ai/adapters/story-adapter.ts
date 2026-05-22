import type { ChatMessage } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'

export interface RunOptions {
  parameterValues?: Record<string, unknown>
  overrides?: { systemPrompt?: string; userPromptTemplate?: string }
}

/** 故事核心生成（API 与 v3 §3.x 对应） */
export function buildStoryGeneratePrompt(
  dimension: string,           // 中文标签：一句话故事 / 故事概念 / 主题 / 核心冲突 / 故事模式 / 主线 / 复线
  projectName: string,
  genre: string,
  worldContext: string,
  userHint?: string,
  options?: RunOptions,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('story.generate')
  const { messages } = renderPrompt(tpl, {
    projectName,
    genres: genre,
    dimension,
    worldContext: worldContext || '',
    userHint,
  }, options)
  return messages
}
