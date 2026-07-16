import type { AIProvider } from '../types/ai'
import type { ChatMessage } from '../types/ai'
import type { Project } from '../types/project'
import type {
  PromptLibraryInputBinding,
  PromptLibraryStage,
  PromptLibraryTaskType,
  PromptTemplate,
  PromptVariableContext,
} from '../types/prompt'
import { assembleContext } from '../registry/assemble-context'
import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import type { AssembleContextResult } from '../registry/types'
import { estimateTokens, getModelPreset } from './context-budget'
import { renderPrompt } from './prompt-engine'

export const PROMPT_LIBRARY_STAGE_META: Record<PromptLibraryStage, { label: string; order: number }> = {
  'project-brief': { label: '立项', order: 0 },
  ideation: { label: '灵感', order: 1 },
  positioning: { label: '定位', order: 2 },
  'story-core': { label: '故事核心', order: 3 },
  research: { label: '研究考证', order: 4 },
  worldbuilding: { label: '世界观', order: 5 },
  character: { label: '人物', order: 6 },
  plot: { label: '剧情', order: 7 },
  structure: { label: '结构', order: 8 },
  'long-form': { label: '长篇架构', order: 9 },
  'short-story': { label: '短篇架构', order: 10 },
  serialization: { label: '连载架构', order: 11 },
  'chapter-planning': { label: '章场规划', order: 12 },
  drafting: { label: '正文', order: 13 },
  continuity: { label: '连续性', order: 14 },
  'developmental-editing': { label: '宏观修订', order: 15 },
  'line-editing': { label: '语言修订', order: 16 },
  'reader-validation': { label: '读者验证', order: 17 },
  packaging: { label: '包装', order: 18 },
  'prompt-operations': { label: 'Prompt 管理', order: 19 },
}

export const PROMPT_LIBRARY_TASK_LABELS: Record<PromptLibraryTaskType, string> = {
  decision: '决策',
  generate: '生成',
  plan: '规划',
  diagnose: '诊断',
  revise: '修订',
  extract: '提取',
  meta: '元 Prompt',
}

export type PromptLibraryTaskCategory =
  | 'library.creation'
  | 'library.extraction'
  | 'library.analysis'
  | 'library.review'

const LIBRARY_TASK_CATEGORIES: Record<PromptLibraryTaskType, PromptLibraryTaskCategory> = {
  decision: 'library.analysis',
  generate: 'library.creation',
  plan: 'library.creation',
  diagnose: 'library.analysis',
  revise: 'library.review',
  extract: 'library.extraction',
  meta: 'library.analysis',
}

export function getLibraryTaskCategory(taskType: PromptLibraryTaskType): PromptLibraryTaskCategory {
  return LIBRARY_TASK_CATEGORIES[taskType]
}

export function deriveLengthMode(targetWordCount: number): 'short' | 'medium' | 'long' {
  if (targetWordCount <= 50_000) return 'short'
  if (targetWordCount <= 200_000) return 'medium'
  return 'long'
}

export function deriveSerializationMode(project: Project): 'standalone' | 'serial' {
  return project.status === 'ongoing' ? 'serial' : 'standalone'
}

export function getLibrarySourceKeys(template: PromptTemplate): string[] {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const input of template.library?.inputs ?? []) {
    for (const key of input.sourceKeys ?? []) {
      if (seen.has(key)) continue
      seen.add(key)
      keys.push(key)
    }
  }
  return keys
}

export function getLibraryScopeNeeds(template: PromptTemplate): {
  world: boolean
  outline: boolean
  chapter: boolean
} {
  const sources = getLibrarySourceKeys(template)
    .map(key => CONTEXT_SOURCE_BY_KEY.get(key))
    .filter(Boolean)
  return {
    world: sources.some(source => source!.requiresWorldGroupId),
    outline: sources.some(source => source!.requiresOutlineNodeId),
    chapter: sources.some(source => source!.requiresChapterId),
  }
}

export function libraryTemplateMatchesProject(template: PromptTemplate, project: Project): boolean {
  const app = template.library?.applicability
  if (!app) return true
  const lengthMode = deriveLengthMode(project.targetWordCount)
  if (app.lengthModes?.length && !app.lengthModes.includes(lengthMode)) return false
  const serialization = deriveSerializationMode(project)
  if (app.serializationModes?.length && !app.serializationModes.includes(serialization)) return false
  if (app.genres?.length && !project.genres.some(genre => app.genres!.includes(genre))) return false
  return true
}

export interface AssembleLibraryPromptInput {
  template: PromptTemplate
  project: Project
  worldGroupId: number | null
  outlineNodeId?: number | null
  chapterId?: number | null
  manualValues?: Record<string, string>
  userHint?: string
  provider?: AIProvider
  model?: string
  contextWindow?: number
  maxOutputTokens?: number
}

export interface AssembleLibraryPromptResult {
  variables: PromptVariableContext
  assembled: AssembleContextResult | null
  missingVariables: string[]
  missingScopes: ('world' | 'outline' | 'chapter')[]
  messages: ChatMessage[]
  modelOverride?: { temperature?: number; maxTokens?: number }
  totalInputTokens: number
  inputBudget: number
}

/**
 * 资产库 Prompt 的唯一上下文装配入口。
 * 模板只声明 sourceKeys；这里统一调用 assembleContext()，并把每个自动源只注入一次。
 * 各变量保留自己的语义职责和作者修正，不再复制同一份上下文正文。
 */
export async function assembleLibraryPromptVariables(
  input: AssembleLibraryPromptInput,
): Promise<AssembleLibraryPromptResult> {
  const bindings = input.template.library?.inputs ?? []
  const sourceKeys = getLibrarySourceKeys(input.template)
  for (const key of sourceKeys) {
    if (!CONTEXT_SOURCE_BY_KEY.has(key)) {
      throw new Error(`Prompt ${input.template.library?.assetId ?? input.template.name} 声明了未知上下文源：${key}`)
    }
  }

  const requiredSourceKeys = new Set(
    bindings
      .filter(binding => binding.required && !input.manualValues?.[binding.variable]?.trim())
      .flatMap(binding => binding.sourceKeys ?? []),
  )
  const missingScopes = new Set<'world' | 'outline' | 'chapter'>()
  if (input.template.library?.output.recordScope === 'chapter' && input.chapterId == null) {
    missingScopes.add('chapter')
  }
  const hasUnresolvedWorldBinding = bindings.some(binding =>
    !input.manualValues?.[binding.variable]?.trim()
    && (binding.sourceKeys ?? []).some(key => CONTEXT_SOURCE_BY_KEY.get(key)?.requiresWorldGroupId),
  )
  if (input.project.enableMultiWorld && input.worldGroupId == null && hasUnresolvedWorldBinding) {
    missingScopes.add('world')
  }
  for (const key of requiredSourceKeys) {
    const source = CONTEXT_SOURCE_BY_KEY.get(key)!
    if (source.requiresChapterId && input.chapterId == null) missingScopes.add('chapter')
    if (source.requiresOutlineNodeId && input.outlineNodeId == null && input.chapterId == null) {
      missingScopes.add('outline')
    }
  }

  const variables = buildLibraryVariables(input, bindings, null)
  const initialRender = renderPrompt(input.template, variables)
  const inputBudget = deriveLibraryInputBudget(input)
  const staticTokens = estimateMessageTokens(initialRender.messages)
  const wrapperReserve = estimateUnifiedContextWrapperTokens(sourceKeys)
  if (staticTokens + wrapperReserve >= inputBudget) {
    throw new Error(`Prompt 固定指令与手动输入约 ${staticTokens} tokens，已超过当前模型可用输入预算 ${inputBudget} tokens。请缩短手动输入或更换更大上下文模型。`)
  }

  const assembled = sourceKeys.length
    ? await assembleContext({
        projectId: input.project.id!,
        worldGroupId: input.worldGroupId,
        outlineNodeId: input.outlineNodeId,
        chapterId: input.chapterId,
        sourceKeys,
        provider: input.provider,
        model: input.model,
        inputBudgetTokens: inputBudget - staticTokens - wrapperReserve,
      })
    : null
  const finalVariables = buildLibraryVariables(input, bindings, new Set(assembled?.included ?? []))
  const missingVariables: string[] = []
  for (const binding of bindings) {
    if (binding.required && !String(finalVariables[binding.variable] ?? '').trim()) {
      missingVariables.push(binding.label)
    }
  }

  const rendered = renderPrompt(input.template, finalVariables)
  const messages = appendUnifiedProjectContext(rendered.messages, assembled)
  const totalInputTokens = estimateMessageTokens(messages)
  if (totalInputTokens > inputBudget) {
    throw new Error(`最终 Prompt 约 ${totalInputTokens} tokens，超过当前模型可用输入预算 ${inputBudget} tokens。请缩短手动输入或减少自动资料。`)
  }

  return {
    variables: finalVariables,
    assembled,
    missingVariables,
    missingScopes: [...missingScopes],
    messages,
    modelOverride: rendered.modelOverride,
    totalInputTokens,
    inputBudget,
  }
}

function buildLibraryVariables(
  input: AssembleLibraryPromptInput,
  bindings: PromptLibraryInputBinding[],
  includedSources: Set<string> | null,
): PromptVariableContext {
  const variables: PromptVariableContext = {
    projectName: input.project.name,
    genres: input.project.genres.join(' / '),
    description: input.project.description,
    targetWordCount: input.project.targetWordCount,
    userHint: input.userHint?.trim() || '',
  }
  for (const binding of bindings) {
    const parts: string[] = []
    if (binding.projectField) {
      const projectValue = readProjectField(input.project, binding.projectField)
      if (projectValue) parts.push(projectValue)
    }
    const hasAutomaticContext = (binding.sourceKeys ?? []).some(key => (
      includedSources === null || includedSources.has(key)
    ))
    if (hasAutomaticContext) {
      parts.push(`从下方统一项目上下文中选取与“${binding.label}”相关的已确认资料。`)
    }
    const manual = input.manualValues?.[binding.variable]?.trim() || ''
    if (manual) parts.push(`【作者补充或修正】\n${manual}`)
    variables[binding.variable] = parts.join('\n\n')
  }
  return variables
}

function appendUnifiedProjectContext(
  messages: ChatMessage[],
  assembled: AssembleContextResult | null,
): ChatMessage[] {
  if (!assembled?.segments.length) return messages
  const sections = assembled.segments.map((segment, index) => (
    `【${segment.label} · ${assembled.included[index]}】\n${segment.content}`
  ))
  const block = [
    '<storyforge_project_context>',
    '以下资料由 StoryForge 当前项目统一装配。每项只出现一次；变量中的说明只负责指出本任务应关注的语义。',
    ...sections,
    '</storyforge_project_context>',
  ].join('\n\n')
  const lastUserIndex = messages.map(message => message.role).lastIndexOf('user')
  if (lastUserIndex < 0) return [...messages, { role: 'user', content: block }]
  return messages.map((message, index) => index === lastUserIndex
    ? { ...message, content: `${message.content}\n\n${block}` }
    : message)
}

function deriveLibraryInputBudget(input: AssembleLibraryPromptInput): number {
  if (!input.provider || !input.model) return 48_000
  const preset = getModelPreset(input.provider, input.model)
  const maxContext = input.contextWindow && input.contextWindow > 0
    ? input.contextWindow
    : preset.maxContext
  const requestedOutput = input.template.modelOverride?.maxTokens || input.maxOutputTokens || preset.maxOutput
  const outputBudget = Math.min(requestedOutput, Math.floor(maxContext * 0.5))
  return Math.max(1, maxContext - outputBudget - Math.round(maxContext * 0.05))
}

function estimateMessageTokens(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0)
}

function estimateUnifiedContextWrapperTokens(sourceKeys: readonly string[]): number {
  const labels = sourceKeys.map(key => CONTEXT_SOURCE_BY_KEY.get(key)?.label ?? key).join('\n')
  return estimateTokens(`<storyforge_project_context>\n${labels}\n</storyforge_project_context>`) + sourceKeys.length * 8
}

function readProjectField(project: Project, field: PromptLibraryInputBinding['projectField']): string {
  switch (field) {
    case 'name': return project.name
    case 'genres': return project.genres.join(' / ')
    case 'description': return project.description
    case 'targetWordCount': return String(project.targetWordCount)
    case 'lengthMode': {
      const labels = { short: '短篇', medium: '中篇', long: '长篇' }
      return labels[deriveLengthMode(project.targetWordCount)]
    }
    case 'serializationMode': return deriveSerializationMode(project) === 'serial' ? '连载' : '非连载'
    default: return ''
  }
}
