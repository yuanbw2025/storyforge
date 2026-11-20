import type { PromptSeed } from './prompt-seed-type'
import { REFERENCE_CHUNK_SYSTEM } from '../reference-analysis/prompt-defaults'
import { REFERENCE_APPLICATION_SKILL } from '../reference-analysis/content-skill'
import { SUMMARY_TEMPLATE, CHARACTERS_TEMPLATE } from '../reference-analysis/derived-prompt-defaults'

export const REFERENCE_PROMPT_SEEDS: PromptSeed[] = [
  { scope: 'system', moduleKey: 'reference.analyze', promptType: 'analyze', name: '内置-拆书细读',
    description: '七领域、六尺度的证据细读。正式功能另外附加完整原文、来源边界和JSON输出合同；此处调整分析方法。',
    systemPrompt: REFERENCE_CHUNK_SYSTEM, userPromptTemplate: '请按本次范围细读，重点解释有证据的创作决定与适用条件。', variables: [], isActive: true },
  { scope: 'system', moduleKey: 'reference.summary', promptType: 'analyze', name: '内置-拆书已读范围综合',
    description: '综合登记的分块分析。正式功能另附基线与严格输出合同；修改不会直接写入作品。',
    systemPrompt: SUMMARY_TEMPLATE.system, userPromptTemplate: SUMMARY_TEMPLATE.task, variables: [], isActive: true },
  { scope: 'system', moduleKey: 'reference.characters', promptType: 'analyze', name: '内置-拆书人物归并',
    description: '保留证据与身份边界的人物归并；正式功能另附登记基线和角色JSON合同。',
    systemPrompt: CHARACTERS_TEMPLATE.system, userPromptTemplate: CHARACTERS_TEMPLATE.task, variables: [], isActive: true },
  { scope: 'system', moduleKey: 'reference.application', promptType: 'analyze', name: '内置-拆书方法原创运用',
    description: '引用参考方法时的创作指导；不能改变当前任务的权限、来源或采纳合同。',
    systemPrompt: REFERENCE_APPLICATION_SKILL, userPromptTemplate: '', variables: [], isActive: true },
]
