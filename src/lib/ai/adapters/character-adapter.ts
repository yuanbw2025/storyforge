import type { ChatMessage } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'
import { composeFieldGenerationHint, type FieldGenerationMode } from '../field-generation-context'

export interface RunOptions {
  parameterValues?: Record<string, unknown>
  overrides?: { systemPrompt?: string; userPromptTemplate?: string }
}

/** 生成角色设定 */
export function buildCharacterPrompt(
  projectName: string,
  genre: string,
  worldContext: string,
  existingCharacters: string,
  userHint?: string,
  options?: RunOptions,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('character.generate')
  const { messages } = renderPrompt(tpl, {
    projectName,
    genres: genre,
    worldContext: worldContext || '（暂无）',
    existingCharacters: existingCharacters || '（暂无）',
    userHint,
  }, options)
  return messages
}

/** AI 丰富角色某个维度 */
export function buildCharacterDimensionPrompt(
  characterName: string,
  dimension: string,
  existingInfo: string,
  worldContext: string,
  options?: RunOptions,
  currentValue?: string,
  mode: FieldGenerationMode = 'expand',
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('character.dimension')
  const effectiveInfo = composeFieldGenerationHint(undefined, currentValue || existingInfo, mode)
  const { messages } = renderPrompt(tpl, {
    characterName,
    dimension,
    characterInfo: effectiveInfo || existingInfo,
    currentValue: currentValue || existingInfo || '',
    generationMode: mode,
    worldContext: worldContext || '（暂无）',
  }, options)
  return messages
}
