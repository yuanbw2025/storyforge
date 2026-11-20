import type { PromptSeed } from './prompt-seed-type'
import { FIELD_METHODS, worldviewFieldContentGuidanceV1 } from '../creation/worldview-content-skill'
import { FULL_INSPIRATION_CONTENT_GUIDANCE, WORLD_SUGGEST_CONTENT_GUIDANCE, WORLD_EXPAND_CONTENT_GUIDANCE, HISTORY_CONTENT_GUIDANCE, CODEX_CONTENT_METHODS, codexContentGuidance } from '../creation/world-entry-content-skill'
import { STYLE_LEARNING_CONTENT_GUIDANCE, STYLE_CALIBRATION_CONTENT_GUIDANCE, CREATIVE_RULES_CONTENT_GUIDANCE, researchContentGuidance } from '../creation/preparation-content-skill'

/** Build editable seed content once. Runtime only renders the author's active
 * template; content methods are never appended behind that template. */
export function withPreparationContentMethods(seed: PromptSeed): PromptSeed {
  const simple: Partial<Record<PromptSeed['moduleKey'], string>> = {
    'inspiration.reverse': FULL_INSPIRATION_CONTENT_GUIDANCE, 'inspiration.reverse.multiworld': FULL_INSPIRATION_CONTENT_GUIDANCE,
    'world-group.suggest': WORLD_SUGGEST_CONTENT_GUIDANCE, 'world-group.expand': WORLD_EXPAND_CONTENT_GUIDANCE,
    'history.consult': HISTORY_CONTENT_GUIDANCE, 'history.storm': HISTORY_CONTENT_GUIDANCE,
    'style.learn': STYLE_LEARNING_CONTENT_GUIDANCE, 'style.calibrate': STYLE_CALIBRATION_CONTENT_GUIDANCE,
    'rules.generate': CREATIVE_RULES_CONTENT_GUIDANCE,
  }
  let method = simple[seed.moduleKey]
  const variables: string[] = []
  if (seed.moduleKey === 'worldview.dimension') {
    method = Object.keys(FIELD_METHODS).map(field => {
      const variable = `field_${field}`; variables.push(variable)
      return `{{#if ${variable}}}\n${worldviewFieldContentGuidanceV1(field as keyof typeof FIELD_METHODS)}\n{{/if}}`
    }).join('\n')
  }
  if (seed.moduleKey === 'codex.extract' || seed.moduleKey === 'codex.enrich') {
    const operation = seed.moduleKey === 'codex.extract' ? 'extract' : 'enrich'
    method = [...Object.keys(CODEX_CONTENT_METHODS), 'custom'].map(key => {
      const variable = `codex_${key}`; variables.push(variable)
      return `{{#if ${variable}}}\n${codexContentGuidance(key, operation)}\n{{/if}}`
    }).join('\n')
  }
  if (seed.moduleKey === 'scene.verify') {
    method = (['scene', 'plan', 'sources'] as const).flatMap(mode => [false, true].map(hasSources => {
      const variable = `research_${mode}_${hasSources ? 'sources' : 'empty'}`; variables.push(variable)
      return `{{#if ${variable}}}\n${researchContentGuidance(mode, hasSources)}\n{{/if}}`
    })).join('\n')
    return { ...seed, systemPrompt: `你是StoryForge研究准备助手，依据本轮资料与任务提供可审阅建议。\n${method}`,
      userPromptTemplate: `【当前场景或研究问题】\n{{scene}}\n年代：{{sceneEra}}\n地点：{{sceneLocation}}\n【登记读取资料】\n{{worldContext}}`,
      variables: [...new Set([...seed.variables, ...variables])] }
  }
  return method ? { ...seed, systemPrompt: `${seed.systemPrompt}\n\n${method}`, variables: [...new Set([...seed.variables, ...variables])] } : seed
}
