import type { ChatMessage } from '../../types'
import type { PromptModuleKey } from '../../types/prompt'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'
import { buildExpandPrompt, buildPolishPrompt } from './chapter-adapter'

export const SELECTION_EDIT_ACTIONS = ['polish', 'expand', 'condense', 'rewrite', 'check'] as const
export type SelectionEditActionV1 = typeof SELECTION_EDIT_ACTIONS[number]

export function isSelectionEditActionV1(value: unknown): value is SelectionEditActionV1 {
  return typeof value === 'string' && SELECTION_EDIT_ACTIONS.includes(value as SelectionEditActionV1)
}

export function selectionPromptModuleKeyV1(action: SelectionEditActionV1): PromptModuleKey {
  if (action === 'polish') return 'chapter.polish'
  if (action === 'expand') return 'chapter.expand'
  if (action === 'condense') return 'chapter.condense'
  if (action === 'rewrite') return 'chapter.rewrite'
  return 'chapter.check'
}

/** Builds every local-selection prompt through the configurable Prompt Engine. */
export function buildSelectionEditPromptV1(action: SelectionEditActionV1, text: string): ChatMessage[] {
  if (action === 'polish') return buildPolishPrompt(text, '优化文笔，使表达更准确、生动，同时保持事实与原意不变')
  if (action === 'expand') return buildExpandPrompt(text)
  const template = usePromptStore.getState().getActive(selectionPromptModuleKeyV1(action))
  return renderPrompt(template, { text }).messages
}
