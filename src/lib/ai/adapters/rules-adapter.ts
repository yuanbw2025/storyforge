import type { ChatMessage } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'

/** 创作规则维度生成 */
export function buildRulesGeneratePrompt(
  dimension: string,           // 写作风格 / 叙事视角 / 基调氛围 / 禁忌 / 一致性 / 特殊要求 / 参考作品
  projectName: string,
  genre: string,
  worldContext: string,
  storyCore: string,
  userHint?: string,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('rules.generate')
  const { messages } = renderPrompt(tpl, {
    projectName,
    genres: genre,
    dimension,
    worldContext: worldContext || '',
    storyCore: storyCore || '',
    userHint,
  })
  return messages
}
