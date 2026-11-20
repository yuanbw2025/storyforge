import { usePromptStore } from '../../stores/prompt'
import { renderPrompt } from '../ai/prompt-engine'
import type { ChatMessage } from '../types'
import { parseStructuredOutputV1 } from '../agent/structured-output-pipeline'

import { INSPIRATION_PREPARATION_MODES, INSPIRATION_PREPARATION_MODULES, type InspirationPreparationMode } from './preparation-contract'
export { INSPIRATION_PREPARATION_MODES, INSPIRATION_PREPARATION_LABELS, INSPIRATION_PREPARATION_MODULES, type InspirationPreparationMode } from './preparation-contract'
export interface InspirationPreparationResult {
  summary: string
  authorMaterial: string
  proposals: { title: string; content: string }[]
  openQuestions: string[]
}
export function isInspirationPreparationMode(mode: unknown): mode is InspirationPreparationMode {
  return INSPIRATION_PREPARATION_MODES.includes(mode as InspirationPreparationMode)
}
export function inspirationPreparationModeFromRequest(request: string): InspirationPreparationMode {
  const mode = /灵感准备任务\s*=\s*(organize|compare|deepen|position-open|position-defined)\b/.exec(request)?.[1]
  if (!isInspirationPreparationMode(mode)) throw new Error('灵感准备缺少明确动作，请选择整理、比较、深化或创作定位。')
  return mode
}
/** The last explicit selection is the author's current choice. */
export function inspirationDirectionIndexFromRequest(request: string): number | undefined {
  const matches = [...request.matchAll(/灵感方向选择\s*=\s*([^\s。；，,;]*)/g)]
  const match = matches[matches.length - 1]
  if (!match) return undefined
  if (!/^[1-4]$/.test(match[1])) throw new Error('方向序号须为1—4的整数，请重新选择明确的比较方向。')
  return Number(match[1])
}
export function parseInspirationPreparationDraft(raw: string, mode: InspirationPreparationMode): InspirationPreparationResult {
  return parseStructuredOutputV1({ raw, contract: { version: 1, schemaId: `inspiration-preparation-${mode}.v1`, target: 'inspirationWorkspaces.versions', root: 'object', maxChars: 40000, allowedRootFields: ['summary', 'authorMaterial', 'proposals', 'openQuestions'], requiredRootFields: ['summary', 'authorMaterial', 'proposals', 'openQuestions'] }, parse: value => {
    const source = value as Record<string, unknown>
    const readText = (text: unknown, max: number) => {
      if (typeof text !== 'string' || !text.trim() || text.length > max) throw new Error('灵感准备文本为空或超长。')
      return text.trim()
    }
    if (!Array.isArray(source.proposals)) throw new Error('准备提议必须是数组。')
    const count = source.proposals.length
    const min = mode === 'compare' || mode === 'position-open' ? 2 : mode === 'organize' ? 0 : 1
    const max = mode === 'organize' || mode === 'position-defined' ? 1 : 4
    if (count < min || count > max) throw new Error('方向未定需2—4个选择，明确定位需一份方向稿，深化需1—4个兼容要点，整理至多1项提议。')
    const proposals = source.proposals.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'content,title') throw new Error('提议只能包含title和content。')
      return { title: readText(item.title, 120), content: readText(item.content, 16000) }
    })
    if (!Array.isArray(source.openQuestions) || source.openQuestions.length > 6) throw new Error('待决定问题至多6项。')
    return { summary: readText(source.summary, 8000), authorMaterial: readText(source.authorMaterial, 8000), proposals, openQuestions: source.openQuestions.map(q => readText(q, 600)) }
  } })
}
export function buildInspirationPreparationPrompt(mode: InspirationPreparationMode, context: string, request: string): ChatMessage[] {
  const template = usePromptStore.getState().getActive(INSPIRATION_PREPARATION_MODULES[mode])
  return renderPrompt(template, { inspiration: context, userHint: request }).messages
}
