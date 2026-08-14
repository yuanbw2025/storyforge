import type { ChatMessage } from '../types'
import type { ImpactRemediationItemV1 } from './impact-remediation-plan'

export const IMPACT_OUTLINE_REGENERATION_PROMPT_VERSION_V1 = 'impact-outline-regeneration-v1' as const

export interface ImpactOutlineRegenerationResultV1 {
  summary: string
  reason: string
  evidenceRefs: string[]
}

function exactKeys(row: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(row)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error('影响章纲重建结果含有协议外字段。')
  }
}

function normalizeText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`影响章纲重建结果缺少 ${label}。`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`影响章纲重建结果的 ${label} 为空或超过长度上限。`)
  }
  return normalized
}

export function parseImpactOutlineRegenerationResultStrictV1(
  raw: string,
  allowedEvidenceRefs: readonly string[],
): ImpactOutlineRegenerationResultV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    throw new Error('影响章纲重建必须返回单个严格 JSON 对象。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('影响章纲重建结果不是 JSON 对象。')
  }
  const row = parsed as Record<string, unknown>
  exactKeys(row, ['summary', 'reason', 'evidenceRefs'])
  if (!Array.isArray(row.evidenceRefs) || row.evidenceRefs.length < 1 || row.evidenceRefs.length > 8) {
    throw new Error('影响章纲重建必须引用 1～8 个登记 Context 分段。')
  }
  const allowed = new Set(allowedEvidenceRefs)
  const evidenceRefs = row.evidenceRefs.map(value => normalizeText(value, 'evidenceRefs', 120))
  if (new Set(evidenceRefs).size !== evidenceRefs.length || evidenceRefs.some(ref => !allowed.has(ref))) {
    throw new Error('影响章纲重建引用了未进入模型的 Context 分段或重复证据。')
  }
  return {
    summary: normalizeText(row.summary, 'summary', 4_000),
    reason: normalizeText(row.reason, 'reason', 1_200),
    evidenceRefs,
  }
}

export function readImpactOutlineRegenerationPromptTemplateV1() {
  return {
    version: IMPACT_OUTLINE_REGENERATION_PROMPT_VERSION_V1,
    system: [
      '你是 StoryForge 的大纲 Agent，负责在作者修正上游后重新生成一个受影响后续章纲的摘要候选。',
      '只使用已登记并实际提供的 Context；不得把推测写成既成事实，不得改写正文、事实或其它大纲字段。',
      '输出必须是单个 JSON 对象，键严格为 summary、reason、evidenceRefs，不得使用 Markdown 代码块。',
    ].join('\n'),
    outputProtocol: [
      '{"summary":"重建后的章纲摘要","reason":"为何这样调整","evidenceRefs":["实际 Context 分段标签"]}',
      'summary 应说明本章目标、关键因果、冲突推进和与上游修正的衔接，但不得提前写成正文。',
      'evidenceRefs 只能从下方允许标签中选择 1～8 个，不能虚构证据名。',
    ].join('\n'),
  }
}

export function readImpactOutlineRegenerationPromptTemplateSnapshotV1(
  template = readImpactOutlineRegenerationPromptTemplateV1(),
) {
  return {
    version: template.version,
    system: template.system,
    outputProtocol: template.outputProtocol,
  }
}

export function buildImpactOutlineRegenerationMessagesV1(input: {
  registeredContext: string
  item: ImpactRemediationItemV1
  targetTitle: string
  allowedEvidenceRefs: readonly string[]
  template?: ReturnType<typeof readImpactOutlineRegenerationPromptTemplateV1>
}): ChatMessage[] {
  const template = input.template ?? readImpactOutlineRegenerationPromptTemplateV1()
  return [
    { role: 'system', content: template.system },
    {
      role: 'user',
      content: [
        '【受控重建任务】',
        `影响项：${input.item.id}`,
        `目标大纲：#${input.item.recordId ?? 'unknown'} ${input.targetTitle}`,
        `计划理由：${input.item.reason}`,
        `依赖节点：${input.item.dependencyNodeIds.join('、') || '无'}`,
        '',
        '【允许引用的 Context 分段标签】',
        input.allowedEvidenceRefs.join('\n'),
        '',
        '【登记 Context】',
        input.registeredContext,
        '',
        '【HARNESS-77 严格输出协议】',
        template.outputProtocol,
      ].join('\n'),
    },
  ]
}
