import type { Project, Work } from '../types'
import type { ChatMessage, PromptTemplate, PromptVariableContext } from '../types'
import { assembleContext } from '../registry/assemble-context'
import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import { renderPrompt } from './prompt-engine'
import { effectiveWorkKind } from '../workspace/work-kind'

export function derivePromptLengthMode(targetWordCount: number): 'short' | 'medium' | 'long' {
  if (targetWordCount <= 50_000) return 'short'
  if (targetWordCount <= 200_000) return 'medium'
  return 'long'
}

/** New Work-aware resolver. Legacy rows keep the historical word-count heuristic. */
export function resolveNovelPromptMode(
  work: Pick<Work, 'kind' | 'novelProfile'> | null | undefined,
  projectMirror: Pick<Project, 'targetWordCount'>,
): 'short' | 'medium' | 'long' {
  if (!work || (work.kind == null && work.novelProfile == null)) {
    return derivePromptLengthMode(projectMirror.targetWordCount)
  }
  if (effectiveWorkKind(work) !== 'novel') throw new Error('非小说 Work 不能匹配小说 Prompt')
  return work.novelProfile === 'short' ? 'short' : 'long'
}

export function derivePromptSerializationMode(project: Project): 'standalone' | 'serial' {
  return project.status === 'ongoing' ? 'serial' : 'standalone'
}

export function getPromptBindingSourceKeys(template: PromptTemplate): string[] {
  return [...new Set(template.variableBindings?.flatMap(binding => binding.sourceKeys ?? []) ?? [])]
}

export function promptTemplateMatchesProject(template: PromptTemplate, project: Project, work?: Work | null): boolean {
  if (work && effectiveWorkKind(work) !== 'novel') return false
  const applicability = template.applicability
  if (!applicability) return true
  if (applicability.lengthModes?.length
    && !applicability.lengthModes.includes(resolveNovelPromptMode(work, project))) return false
  if (applicability.serializationModes?.length
    && !applicability.serializationModes.includes(derivePromptSerializationMode(project))) return false
  if (applicability.genres?.length
    && !project.genres.some(genre => applicability.genres!.includes(genre))) return false
  return true
}

export interface AssembleBoundPromptInput {
  template: PromptTemplate
  project?: Project
  work?: Work | null
  worldGroupId?: number | null
  outlineNodeId?: number | null
  chapterId?: number | null
  previousOutput?: string
  /** FLOW-1 入边按目标变量分组后的已确认节点输出。 */
  workflowValues?: Record<string, string>
  userHint?: string
  manualValues?: Record<string, string>
  parameterValues?: Record<string, unknown>
}

export interface AssembleBoundPromptResult {
  variables: PromptVariableContext
  missingVariables: string[]
  missingScopes: ('project' | 'world' | 'outline' | 'chapter')[]
  messages: ChatMessage[]
  modelOverride?: { temperature?: number; maxTokens?: number }
}

/**
 * 普通 PromptTemplate 的声明式变量装配。只经 CONTEXT_SOURCES 读取项目事实，
 * 同一 source 只进入最终请求一次；变量槽位只保留语义指引和作者补充。
 */
export async function assembleBoundPrompt(input: AssembleBoundPromptInput): Promise<AssembleBoundPromptResult> {
  const bindings = input.template.variableBindings ?? []
  const sourceKeys = getPromptBindingSourceKeys(input.template)
  for (const key of sourceKeys) {
    if (!CONTEXT_SOURCE_BY_KEY.has(key)) {
      throw new Error(`Prompt ${input.template.assetId ?? input.template.name} 声明了未知上下文源：${key}`)
    }
  }

  const missingScopes = new Set<'project' | 'world' | 'outline' | 'chapter'>()
  const hasAutomaticProjectInput = bindings.some(binding => binding.sourceKeys?.length || binding.projectField)
  if (hasAutomaticProjectInput && !input.project?.id) missingScopes.add('project')

  const unresolvedSources = bindings
    .filter(binding => binding.required
      && !input.manualValues?.[binding.variable]?.trim()
      && !input.workflowValues?.[binding.variable]?.trim())
    .flatMap(binding => binding.sourceKeys ?? [])
    .map(key => CONTEXT_SOURCE_BY_KEY.get(key))
    .filter(Boolean)
  if (input.project?.enableMultiWorld && input.worldGroupId == null
    && unresolvedSources.some(source => source!.requiresWorldGroupId)) missingScopes.add('world')
  if (unresolvedSources.some(source => source!.requiresChapterId) && input.chapterId == null) {
    missingScopes.add('chapter')
  }
  if (unresolvedSources.some(source => source!.requiresOutlineNodeId)
    && input.outlineNodeId == null && input.chapterId == null) missingScopes.add('outline')

  const variables: PromptVariableContext = {
    projectName: input.project?.name ?? '',
    genres: input.project?.genres.join(' / ') ?? '',
    description: input.project?.description ?? '',
    targetWordCount: input.work?.targetWordCount ?? input.project?.targetWordCount,
    worldContext: input.previousOutput?.trim() || '',
    userHint: input.userHint?.trim() || '',
  }
  for (const binding of bindings) {
    const parts: string[] = []
    const projectValue = input.project && binding.projectField
      ? readPromptProjectField(input.project, binding.projectField, input.work)
      : ''
    if (projectValue) parts.push(projectValue)
    if (binding.sourceKeys?.length) {
      parts.push(`从下方统一项目上下文中选取与“${binding.label}”相关的已确认资料。`)
    }
    const workflowValue = input.workflowValues?.[binding.variable]?.trim() || ''
    if (workflowValue) parts.push(`【工作流上游节点输出】\n${workflowValue}`)
    const manual = input.manualValues?.[binding.variable]?.trim() || ''
    if (manual) parts.push(`【作者补充或修正】\n${manual}`)
    variables[binding.variable] = parts.join('\n\n')
  }
  for (const [variable, value] of Object.entries(input.workflowValues ?? {})) {
    if (!bindings.some(binding => binding.variable === variable)) {
      variables[variable] = value
    }
  }

  const assembled = input.project?.id && sourceKeys.length && !missingScopes.has('world')
    ? await assembleContext({
        projectId: input.project.id,
        worldGroupId: input.worldGroupId,
        outlineNodeId: input.outlineNodeId,
        chapterId: input.chapterId,
        sourceKeys,
      })
    : null
  const includedSources = new Set(assembled?.included ?? [])
  const missingVariables = bindings
    .filter(binding => {
      if (!binding.required) return false
      if (input.manualValues?.[binding.variable]?.trim()) return false
      if (input.workflowValues?.[binding.variable]?.trim()) return false
      if (input.project && binding.projectField && readPromptProjectField(input.project, binding.projectField, input.work)) return false
      if (binding.sourceKeys?.some(key => includedSources.has(key))) return false
      return true
    })
    .map(binding => binding.label)
  const rendered = renderPrompt(input.template, variables, { parameterValues: input.parameterValues })
  const messages = appendPromptProjectContext(rendered.messages, assembled?.segments.map(segment => ({
    label: segment.label,
    content: segment.content,
  })) ?? [])

  return {
    variables,
    missingVariables,
    missingScopes: [...missingScopes],
    messages,
    modelOverride: rendered.modelOverride,
  }
}

function readPromptProjectField(
  project: Project,
  field: NonNullable<PromptTemplate['variableBindings']>[number]['projectField'],
  work?: Work | null,
): string {
  if (field === 'name') return project.name
  if (field === 'genres') return project.genres.join(' / ')
  if (field === 'description') return project.description
  if (field === 'targetWordCount') return String(work?.targetWordCount ?? project.targetWordCount)
  if (field === 'lengthMode') return resolveNovelPromptMode(work, project)
  if (field === 'serializationMode') return derivePromptSerializationMode(project)
  return ''
}

function appendPromptProjectContext(
  messages: ChatMessage[],
  segments: { label: string; content: string }[],
): ChatMessage[] {
  if (!segments.length) return messages
  const context = [
    '<storyforge_project_context>',
    '以下资料由 StoryForge 当前项目统一装配。每项只出现一次；模板变量中的文字只负责标明应关注的语义。',
    ...segments.map(segment => `【${segment.label}】\n${segment.content}`),
    '</storyforge_project_context>',
  ].join('\n\n')
  const userIndex = messages.map(message => message.role).lastIndexOf('user')
  if (userIndex < 0) return [...messages, { role: 'user', content: context }]
  return messages.map((message, index) => index === userIndex
    ? { ...message, content: `${message.content}\n\n${context}` }
    : message)
}
