/** Scoped event operations reuse the story-arc Skill, candidate and adopt path. */
import { parseAuthorStoryStagesV1 } from '../types/story-arc'
import { canonicalStringify } from './run/hash'
import { parseStructuredOutputV1 } from './structured-output-pipeline'
import type { StoryArcCopilotCandidate, StoryArcCopilotSnapshot, StoryArcMutationRequestV1 } from './story-arc-copilot'

export const STORY_ARC_STAGE_EVENT_LIMITS_V1 = Object.freeze({ additionalEvents: 5, eventChars: 400 })
export interface StoryArcStageEventRequestV1 { version: 1; kind: 'append' | 'sort'; stageId: string }

export function readStoryArcStageEventTargetV1(snapshot: StoryArcCopilotSnapshot, mutation: StoryArcMutationRequestV1) {
  const request = mutation.stageEvents
  if (!request || request.version !== 1 || !['append', 'sort'].includes(request.kind)
    || typeof request.stageId !== 'string' || !request.stageId.trim() || request.stageId.length > 160
    || Object.keys(request).sort().join('|') !== 'kind|stageId|version'
    || (request.kind === 'append' ? mutation.operation !== 'expand' : mutation.operation !== 'replan')) throw new Error('阶段事件范围请求无效。')
  const arc = snapshot.arcs?.find(row => row.id === mutation.targetArcId)
  if (!arc) throw new Error('阶段事件的原故事线不存在或不属于当前作品。')
  const stages = parseAuthorStoryStagesV1(arc.stages)
  const stage = stages.find(row => row.id === request.stageId)
  if (!stage) throw new Error('阶段事件的目标阶段不存在，不能改用其他阶段。')
  if (request.kind === 'sort' && stage.keyEvents.length < 2) throw new Error('阶段事件排序至少需要两个既有事件。')
  return { arc, stages, stage, request }
}

function validateEvents(value: unknown, before: string[], request: StoryArcStageEventRequestV1): string[] {
  if (!Array.isArray(value) || Array.from(value).some(event => typeof event !== 'string')) throw new Error('阶段 keyEvents 必须是完整字符串数组。')
  const events = value as string[]
  if (request.kind === 'sort') {
    if (events.length !== before.length || canonicalStringify([...events].sort()) !== canonicalStringify([...before].sort())) throw new Error('阶段事件排序只能重排既有事件，不得新增、删除或改写。')
  } else {
    const added = events.slice(before.length)
    if (added.length < 1 || added.length > STORY_ARC_STAGE_EVENT_LIMITS_V1.additionalEvents) throw new Error(`阶段事件必须新增1—${STORY_ARC_STAGE_EVENT_LIMITS_V1.additionalEvents}项，已有事件不计入新增上限。`)
    if (canonicalStringify(events.slice(0, before.length)) !== canonicalStringify(before)) throw new Error('新增阶段事件必须原样保留全部既有事件和顺序。')
    const normalize = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
    const seen = new Set(before.map(normalize))
    for (const event of added) {
      if (!event.trim() || event.length > STORY_ARC_STAGE_EVENT_LIMITS_V1.eventChars) throw new Error(`新增阶段事件须为非空文本且不超过${STORY_ARC_STAGE_EVENT_LIMITS_V1.eventChars}字符。`)
      const identity = normalize(event)
      if (seen.has(identity)) throw new Error('新增阶段事件不得重复既有或本轮新增事件。')
      seen.add(identity)
    }
  }
  return [...events]
}

function materialize(snapshot: StoryArcCopilotSnapshot, mutation: StoryArcMutationRequestV1, value: unknown): StoryArcCopilotCandidate[] {
  const { arc, stages, stage, request } = readStoryArcStageEventTargetV1(snapshot, mutation)
  const events = validateEvents(value, stage.keyEvents, request)
  return [{ name: arc.name, type: arc.type, description: arc.description,
    stages: stages.map(row => ({ stageId: row.id, title: row.title, description: row.description,
      keyEvents: row.id === stage.id ? events : [...row.keyEvents],
      ...(row.turningPoint === undefined ? {} : { turningPoint: row.turningPoint }),
      ...(row.startVolume === undefined ? {} : { startVolume: row.startVolume }),
      ...(row.endVolume === undefined ? {} : { endVolume: row.endVolume }),
    })),
  }]
}

/** Model and editable draft share one compact contract. No full arc is inferred
 * from model text: immutable non-target content comes from the frozen snapshot. */
export function parseStoryArcStageEventDraftV1(raw: string, snapshot: StoryArcCopilotSnapshot, mutation: StoryArcMutationRequestV1, maxChars: number): StoryArcCopilotCandidate[] {
  return parseStructuredOutputV1({ raw, contract: {
    version: 1, schemaId: 'story-arc-stage-events.v1', target: 'storyArcs.stages', root: 'object', maxChars,
    allowedRootFields: ['keyEvents'], requiredRootFields: ['keyEvents'],
  }, parse: value => materialize(snapshot, mutation, (value as Record<string, unknown>).keyEvents) })
}

/** Runtime node callers cannot bypass the compact draft's selected-field gate. */
export function assertStoryArcStageEventCandidatesV1(value: unknown, snapshot: StoryArcCopilotSnapshot, mutation: StoryArcMutationRequestV1): StoryArcCopilotCandidate[] {
  if (!Array.isArray(value) || value.length !== 1 || !Array.isArray(value[0]?.stages)) throw new Error('阶段事件候选必须绑定原故事线。')
  const events = value[0].stages.find((row: any) => row?.stageId === mutation.stageEvents?.stageId)?.keyEvents
  const expected = materialize(snapshot, mutation, events)
  if (canonicalStringify(value) !== canonicalStringify(expected)) throw new Error('阶段事件候选不得修改所选阶段事件以外的内容。')
  return expected
}

export function formatStoryArcStageEventDraftV1(candidates: StoryArcCopilotCandidate[], mutation: StoryArcMutationRequestV1): string {
  const events = candidates[0]?.stages.find(row => row.stageId === mutation.stageEvents?.stageId)?.keyEvents
  if (!events) throw new Error('阶段事件候选缺少原阶段。')
  return JSON.stringify({ keyEvents: events }, null, 2)
}

export function storedStoryArcStageEventsV1(candidates: StoryArcCopilotCandidate[], snapshot: StoryArcCopilotSnapshot, mutation: StoryArcMutationRequestV1) {
  const verified = assertStoryArcStageEventCandidatesV1(candidates, snapshot, mutation)
  const { stages, stage } = readStoryArcStageEventTargetV1(snapshot, mutation)
  const events = verified[0].stages.find(row => row.stageId === stage.id)!.keyEvents
  return stages.map(row => row.id === stage.id ? { ...row, keyEvents: [...events] } : row)
}
