import { SUMMARY_TEMPLATE, CHARACTERS_TEMPLATE } from './derived-prompt-defaults'
import { readReferenceLibraryPrompt } from './prompt-library'
import type { ChatMessage } from '../types'
import type {
  ReferenceDerivedBaselineV1,
  ReferenceDerivedModeV1,
} from './derived-agent-baseline'

export interface ReferenceDerivedPromptTemplateV1 {
  version: 'reference-derived-v1'
  mode: ReferenceDerivedModeV1
  system: string
  task: string
  outputContract: string
}

export type ReferenceDerivedResultV1 =
  | { mode: 'summary'; value: Record<string, string>; resultJson: string }
  | {
      mode: 'characters'
      value: Array<{ name: string; role: string; summary: string; analysis: string }>
      resultJson: string
    }

export function readReferenceDerivedPromptTemplateV1(
  mode: ReferenceDerivedModeV1,
): ReferenceDerivedPromptTemplateV1 {
  const fixed = mode === 'summary' ? SUMMARY_TEMPLATE : CHARACTERS_TEMPLATE
  const editable = readReferenceLibraryPrompt(mode === 'summary' ? 'reference.summary' : 'reference.characters')
  return { ...fixed, system: editable.system, task: editable.task }
}

export function readReferenceDerivedPromptTemplateSnapshotV1(
  mode: ReferenceDerivedModeV1,
  template: ReferenceDerivedPromptTemplateV1 = readReferenceDerivedPromptTemplateV1(mode),
) {
  return {
    version: template.version,
    mode,
    system: template.system,
    task: template.task,
    outputContract: template.outputContract,
  }
}

export function buildReferenceDerivedMessagesV1(input: {
  mode: ReferenceDerivedModeV1
  registeredContext: string
  template?: ReferenceDerivedPromptTemplateV1
}): ChatMessage[] {
  const template = input.template ?? readReferenceDerivedPromptTemplateV1(input.mode)
  if (template.mode !== input.mode) throw new Error('参考派生 Agent Prompt 模式不匹配。')
  return [
    { role: 'system', content: `${template.system}\n仅使用本次登记基线；结果只是参考分析候选，不是当前作品事实，不获得任何正式写入权限。\n【HARNESS-74 严格输出协议】\n${template.outputContract}` },
    {
      role: 'user',
      content: [
        input.registeredContext,
        '',
        '【本次任务】',
        template.task,
        '',
        '再次确认：只处理上述登记基线；确认前结果只是候选，不代表当前作品事实。',
      ].join('\n'),
    },
  ]
}

function exactKeys(row: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(row)
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label}键名或顺序不符合严格协议。`)
  }
}

function parsePureObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}') || trimmed.includes('```')) {
    throw new Error('参考派生 Agent 只接受纯 JSON 对象。')
  }
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) } catch { throw new Error('参考派生 Agent JSON 无法解析。') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('参考派生 Agent 根输出必须是对象。')
  }
  return parsed as Record<string, unknown>
}

function cleanText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串。`)
  const text = value.trim()
  if (!text || text.length > maxLength) throw new Error(`${label}为空或超过 ${maxLength} 字。`)
  return text
}

export function parseReferenceDerivedResultStrictV1(
  mode: ReferenceDerivedModeV1,
  raw: string,
  baseline: ReferenceDerivedBaselineV1,
): ReferenceDerivedResultV1 {
  if (baseline.mode !== mode || baseline.input.kind !== mode) {
    throw new Error('参考派生 Agent 输出与冻结基线模式不匹配。')
  }
  const root = parsePureObject(raw)
  if (mode === 'summary' && baseline.input.kind === 'summary') {
    const keys = baseline.input.dimensions.map(dimension => dimension.dimension)
    exactKeys(root, keys, '参考总结')
    const value: Record<string, string> = {}
    for (const key of keys) value[key] = cleanText(root[key], `参考总结.${key}`, 1_200)
    return { mode, value, resultJson: JSON.stringify(value) }
  }
  if (mode === 'characters' && baseline.input.kind === 'characters') {
    exactKeys(root, ['characters'], '参考角色聚合')
    if (!Array.isArray(root.characters) || root.characters.length === 0 || root.characters.length > 80) {
      throw new Error('参考角色聚合必须返回 1～80 张角色卡。')
    }
    const seen = new Set<string>()
    const value = root.characters.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`参考角色聚合第 ${index + 1} 项不是对象。`)
      }
      const row = item as Record<string, unknown>
      exactKeys(row, ['name', 'role', 'summary', 'analysis'], `参考角色聚合第 ${index + 1} 项`)
      const name = cleanText(row.name, `角色 ${index + 1}.name`, 120)
      const dedupKey = name.replace(/[\s·・\-—_]+/g, '').toLocaleLowerCase()
      if (seen.has(dedupKey)) throw new Error(`参考角色聚合包含重复角色“${name}”。`)
      seen.add(dedupKey)
      return {
        name,
        role: cleanText(row.role, `角色 ${index + 1}.role`, 120),
        summary: cleanText(row.summary, `角色 ${index + 1}.summary`, 500),
        analysis: cleanText(row.analysis, `角色 ${index + 1}.analysis`, 2_000),
      }
    })
    return { mode, value, resultJson: JSON.stringify(value) }
  }
  throw new Error('参考派生 Agent 模式不受支持。')
}
