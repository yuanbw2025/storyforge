import type { ChatMessage } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'

export interface RunOptions {
  parameterValues?: Record<string, unknown>
  overrides?: { systemPrompt?: string; userPromptTemplate?: string }
}

/** 生成卷级大纲 */
export function buildVolumeOutlinePrompt(
  projectName: string,
  genre: string,
  worldContext: string,
  storyCoreContext: string,
  targetWordCount: number,
  userHint?: string,
  options?: RunOptions,
  characterContext?: string,
  /** Phase 32: 世界规则清单（替代旧 historicalContext + creativeMode） */
  worldRulesContext?: string,
): ChatMessage[] {
  const estimatedVolumes = Math.max(1, Math.ceil(targetWordCount / 300000))
  const tpl = usePromptStore.getState().getActive('outline.volume')
  const { messages } = renderPrompt(tpl, {
    projectName,
    genres: genre,
    targetWordCount,
    estimatedVolumes,
    worldContext: worldContext || '（暂无，请自由发挥）',
    storyCore: storyCoreContext || '（暂无，请自由发挥）',
    characterContext: characterContext || '',
    worldRulesContext: worldRulesContext || '',
    userHint,
  }, options)
  return messages
}

/** 将卷展开为章节大纲 */
export function buildChapterOutlinePrompt(
  volumeTitle: string,
  volumeSummary: string,
  worldContext: string,
  prevVolumeSummary: string,
  userHint?: string,
  options?: RunOptions,
  characterContext?: string,
  /** Phase 32: 世界规则清单 */
  worldRulesContext?: string,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('outline.chapter')
  const { messages } = renderPrompt(tpl, {
    volumeTitle,
    volumeSummary,
    worldContext: worldContext || '（暂无）',
    prevVolumeSummary: prevVolumeSummary || '（这是第一卷）',
    characterContext: characterContext || '',
    worldRulesContext: worldRulesContext || '',
    userHint,
  }, options)
  return messages
}
