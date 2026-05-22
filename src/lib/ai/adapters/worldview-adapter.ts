import type { ChatMessage } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'

const DIMENSION_LABELS: Record<string, string> = {
  geography: '地理环境',
  history: '历史年表',
  society: '社会结构',
  culture: '文化与宗教',
  economy: '经济体系',
  rules: '世界规则/物理法则',
  summary: '世界观精华摘要',
}

export interface RunOptions {
  parameterValues?: Record<string, unknown>
  overrides?: { systemPrompt?: string; userPromptTemplate?: string }
}

/** 生成世界观某个维度（API 与旧 src/lib/ai/prompts/worldview.ts 一致） */
export function buildWorldviewPrompt(
  dimension: string,
  projectName: string,
  genre: string,
  existingContext: string,
  userHint?: string,
  options?: RunOptions,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('worldview.dimension')
  const label = DIMENSION_LABELS[dimension] || dimension
  const { messages } = renderPrompt(tpl, {
    projectName,
    genres: genre,
    dimension: label,
    worldContext: existingContext,
    userHint,
    isSummary: dimension === 'summary' ? '1' : '',
  }, options)
  return messages
}
