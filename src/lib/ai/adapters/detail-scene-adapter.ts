import type { ChatMessage } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'

/** 细纲场景生成 */
export function buildDetailSceneGeneratePrompt(
  chapterTitle: string,
  chapterSummary: string,
  worldContext: string,
  characters: string,
  previousChapterEnding: string,
  userHint?: string,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('detail.scene')
  const { messages } = renderPrompt(tpl, {
    chapterTitle,
    chapterSummary,
    worldContext: worldContext || '',
    characters: characters || '',
    previousChapterEnding: previousChapterEnding || '',
    userHint,
  })
  return messages
}
