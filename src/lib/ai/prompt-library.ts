import type { AIProvider } from '../types/ai'
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
}

export interface AssembleLibraryPromptResult {
  variables: PromptVariableContext
  assembled: AssembleContextResult | null
  missingVariables: string[]
  missingScopes: ('world' | 'outline' | 'chapter')[]
}

/**
 * 资产库 Prompt 的唯一上下文装配入口。
 * 模板只声明 sourceKeys；这里统一调用 assembleContext()，再按变量绑定拆回模板槽位。
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

  const assembled = sourceKeys.length
    ? await assembleContext({
        projectId: input.project.id!,
        worldGroupId: input.worldGroupId,
        outlineNodeId: input.outlineNodeId,
        chapterId: input.chapterId,
        sourceKeys,
        provider: input.provider,
        model: input.model,
      })
    : null

  const contentBySource = new Map<string, string>()
  assembled?.included.forEach((key, index) => {
    const content = assembled.segments[index]?.content
    if (content) contentBySource.set(key, content)
  })

  const variables: PromptVariableContext = {
    projectName: input.project.name,
    genres: input.project.genres.join(' / '),
    description: input.project.description,
    targetWordCount: input.project.targetWordCount,
    userHint: input.userHint?.trim() || '',
  }
  const missingVariables: string[] = []

  for (const binding of bindings) {
    const automaticParts: string[] = []
    if (binding.projectField) {
      const projectValue = readProjectField(input.project, binding.projectField)
      if (projectValue) automaticParts.push(projectValue)
    }
    for (const key of binding.sourceKeys ?? []) {
      const content = contentBySource.get(key)
      if (content) automaticParts.push(content)
    }
    const manual = input.manualValues?.[binding.variable]?.trim() || ''
    const value = joinAutomaticAndManual(automaticParts, manual)
    variables[binding.variable] = value
    if (binding.required && !value) missingVariables.push(binding.label)
  }

  return {
    variables,
    assembled,
    missingVariables,
    missingScopes: [...missingScopes],
  }
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

function joinAutomaticAndManual(automaticParts: string[], manual: string): string {
  const automatic = [...new Set(automaticParts.filter(Boolean))].join('\n\n')
  if (!manual) return automatic
  if (!automatic) return manual
  return `${automatic}\n\n【作者补充或修正】\n${manual}`
}
