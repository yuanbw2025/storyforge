import { assembleBoundPrompt, getPromptBindingSourceKeys } from '../ai/prompt-variable-bindings'
import { db } from '../db/schema'
import type { PromptTemplate, WorkspaceScope } from '../types'
import { resolveScopeLike } from '../workspace/scope'
import { hashAuthoringText } from './bindings'
import type { AuthoringNodeInstance } from './contracts'

/** Selection is a versioned author-owned snapshot in graph config, not a new
 * template store. It travels with graph backup and never changes global active
 * templates. Legacy numeric references remain readable on the original device. */
export async function renderAuthoringPromptControl(input: {
  node: AuthoringNodeInstance
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
}) {
  const snapshot = input.node.config.promptSnapshot as PromptTemplate | undefined
  const id = Number(input.node.config.templateId)
  const template = snapshot ?? (Number.isInteger(id) && id > 0 ? await db.promptTemplates.get(id) : undefined)
  if (!template || typeof template.systemPrompt !== 'string' || typeof template.userPromptTemplate !== 'string') {
    throw new Error('请选择有效的提示词模板；该节点未保存可恢复的模板版本。')
  }
  const scope = input.scope ?? await resolveScopeLike(input.projectId)
  const [project, work] = await Promise.all([db.projects.get(scope.projectId), db.works.get(scope.workId)])
  const result = await assembleBoundPrompt({
    template, project, work, worldGroupId: input.worldGroupId,
    userHint: String(input.node.config.supplement ?? ''),
    manualValues: input.node.config.manualValues as Record<string, string> | undefined,
    parameterValues: input.node.config.parameterValues as Record<string, unknown> | undefined,
  })
  if (result.missingVariables.length || result.missingScopes.length) {
    throw new Error(`提示词还需填写或绑定：${[...result.missingVariables, ...result.missingScopes].join('、')}`)
  }
  const output = [result.messages.map(message => message.content).join('\n\n'), input.node.config.supplement ? `【本次补充】\n${String(input.node.config.supplement)}` : ''].filter(Boolean).join('\n\n')
  return { output, semantic: 'control.prompt' as const, sourceHash: hashAuthoringText(output), sourceKeys: getPromptBindingSourceKeys(template), sourceEvidence: result.contextEvidence }
}
