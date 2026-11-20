/**
 * 场景考证适配器 — Phase 27.2a
 * 用户描述场景 → AI 结合世界观/历史年表/世界规则给出考证建议。
 */
import type { ChatMessage } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'

export function buildSceneVerifyPrompt(args: {
  worldContext: string
  historyContext: string
  worldRulesContext: string
  scene: string
  sceneEra?: string
  sceneLocation?: string
  researchMode?: 'scene' | 'plan' | 'sources'
  hasSuppliedSources?: boolean
}): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('scene.verify')
  const { messages } = renderPrompt(tpl, {
    [`research_${args.researchMode ?? 'scene'}_${args.hasSuppliedSources ? 'sources' : 'empty'}`]: '1',
    worldContext: args.worldContext,
    historyContext: args.historyContext,
    worldRulesContext: args.worldRulesContext,
    scene: args.scene,
    sceneEra: args.sceneEra || '',
    sceneLocation: args.sceneLocation || '',
  })
  return messages
}
