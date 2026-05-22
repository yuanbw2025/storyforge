import type { ChatMessage } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'

export interface RunOptions {
  parameterValues?: Record<string, unknown>
  overrides?: { systemPrompt?: string; userPromptTemplate?: string }
}

export function buildForeshadowSuggestPrompt(
  projectName: string,
  genre: string,
  worldContext: string,
  characterContext: string,
  existingForeshadows: string,
  options?: RunOptions,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('foreshadow.generate')
  const { messages } = renderPrompt(tpl, {
    projectName,
    genres: genre,
    worldContext,
    characters: characterContext,
    existingForeshadows,
    hasNoForeshadows: existingForeshadows ? '' : '1',
  }, options)
  return messages
}
