import type { ChatMessage } from '../types'
import type { ImpactRemediationItemV1 } from './impact-remediation-plan'

export const IMPACT_STORY_TIMELINE_REGENERATION_PROMPT_VERSION_V1 = 'impact-story-timeline-regeneration-v1' as const

export interface ImpactStoryTimelineTargetV1 {
  id: number
  title: string
  storyTime: string
  importance: number
  description: string
  chapterId: number
  chapterTitle: string
  order: number
}

export interface ImpactStoryTimelineRegenerationResultV1 {
  storyTime: string
  importance: number
  description: string
  reason: string
  evidenceRefs: string[]
}

function exactKeys(row: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(row)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error('影响年表重建结果含有协议外字段。')
  }
}

function text(value: unknown, label: string, maxLength: number, required = false): string {
  if (typeof value !== 'string') throw new Error(`影响年表重建结果缺少 ${label}。`)
  const normalized = value.trim()
  if ((required && !normalized) || normalized.length > maxLength) {
    throw new Error(`影响年表重建结果的 ${label} 为空或超过长度上限。`)
  }
  return normalized
}

export function parseImpactStoryTimelineRegenerationResultStrictV1(
  raw: string,
  allowedEvidenceRefs: readonly string[],
): ImpactStoryTimelineRegenerationResultV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    throw new Error('影响年表重建必须返回单个严格 JSON 对象。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('影响年表重建结果不是 JSON 对象。')
  }
  const row = parsed as Record<string, unknown>
  exactKeys(row, ['storyTime', 'importance', 'description', 'reason', 'evidenceRefs'])
  if (!Number.isInteger(row.importance) || (row.importance as number) < 1 || (row.importance as number) > 3) {
    throw new Error('影响年表重建 importance 必须是 1～3 的整数。')
  }
  if (!Array.isArray(row.evidenceRefs) || row.evidenceRefs.length < 1 || row.evidenceRefs.length > 4) {
    throw new Error('影响年表重建必须引用 1～4 个登记 Context 分段。')
  }
  const allowed = new Set(allowedEvidenceRefs)
  const evidenceRefs = row.evidenceRefs.map(value => text(value, 'evidenceRefs', 120, true))
  if (new Set(evidenceRefs).size !== evidenceRefs.length || evidenceRefs.some(ref => !allowed.has(ref))) {
    throw new Error('影响年表重建引用了未进入模型的 Context 分段或重复证据。')
  }
  return {
    storyTime: text(row.storyTime, 'storyTime', 300),
    importance: row.importance as number,
    description: text(row.description, 'description', 4_000),
    reason: text(row.reason, 'reason', 1_200, true),
    evidenceRefs,
  }
}

export function readImpactStoryTimelineRegenerationPromptTemplateV1() {
  return {
    version: IMPACT_STORY_TIMELINE_REGENERATION_PROMPT_VERSION_V1,
    system: [
      '你是 StoryForge 的 Prose Agent，负责在作者修正上游后复核一个既有故事年表事件。',
      '只使用已登记并实际提供的当前章节正文与故事年表；不得新增、删除或重命名事件，不得改章节绑定和顺序。',
      '只返回 storyTime、importance、description 三个可修订字段以及 reason、evidenceRefs；不得把推测写成既成事实。',
      '输出必须是单个 JSON 对象，不得使用 Markdown 代码块，也不得包含协议外字段。',
    ].join('\n'),
    outputProtocol: [
      '{"storyTime":"修订后的故事时间，可为空","importance":2,"description":"修订后的事件描述，可为空","reason":"为何需要这样修订","evidenceRefs":["实际 Context 分段标签"]}',
      'importance 只能是 1、2、3；evidenceRefs 只能从允许标签中选择 1～4 个。',
      '目标事件的 title、chapterId、chapterTitle、order 已冻结，不得在输出中出现或试图修改。',
    ].join('\n'),
  }
}

export function readImpactStoryTimelineRegenerationPromptTemplateSnapshotV1(
  template = readImpactStoryTimelineRegenerationPromptTemplateV1(),
) {
  return {
    version: template.version,
    system: template.system,
    outputProtocol: template.outputProtocol,
  }
}

export function buildImpactStoryTimelineRegenerationMessagesV1(input: {
  registeredContext: string
  item: ImpactRemediationItemV1
  target: ImpactStoryTimelineTargetV1
  allowedEvidenceRefs: readonly string[]
  template?: ReturnType<typeof readImpactStoryTimelineRegenerationPromptTemplateV1>
}): ChatMessage[] {
  const template = input.template ?? readImpactStoryTimelineRegenerationPromptTemplateV1()
  return [
    { role: 'system', content: template.system },
    {
      role: 'user',
      content: [
        '【受控重建任务】',
        `影响项：${input.item.id}`,
        `目标事件：#${input.target.id} ${input.target.title}`,
        `冻结章节：#${input.target.chapterId} ${input.target.chapterTitle}`,
        `冻结顺序：${input.target.order}`,
        `当前可修订值：${JSON.stringify({
          storyTime: input.target.storyTime,
          importance: input.target.importance,
          description: input.target.description,
        })}`,
        `计划理由：${input.item.reason}`,
        `依赖节点：${input.item.dependencyNodeIds.join('、') || '无'}`,
        '',
        '【允许引用的 Context 分段标签】',
        input.allowedEvidenceRefs.join('\n'),
        '',
        '【登记 Context】',
        input.registeredContext,
        '',
        '【HARNESS-79 严格输出协议】',
        template.outputProtocol,
      ].join('\n'),
    },
  ]
}
