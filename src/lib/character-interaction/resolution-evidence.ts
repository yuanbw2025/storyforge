import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatNarrativeActionV1, ChatNarrativeStateV1, ChatResolutionEvidenceRecordV1} from '../types/chat-narrative'

function fail(message: string): never {throw new Error(`[chat-resolution-evidence] ${message}`)}
export function parseChatResolutionEvidenceVersionV1(value: unknown): 1 | undefined {
  if (value === undefined) return undefined
  if (value !== 1) fail('收束依据提交版本无效')
  return 1
}
const terminalGoal = (status: string) => status === 'fulfilled' || status === 'abandoned'
const terminalThread = (status: string) => ['resolved', 'abandoned', 'transformed'].includes(status)

/** Runs on the action reducer's clone after the reviewed expression and status
 * changes. No inference from text, no backfill while replaying old events. */
export function recordChatResolutionEvidenceV1(state: CharacterInteractionRuntimeState, input: {
  version: unknown; action: ChatNarrativeActionV1; actorKey: string; messageId: string
}): void {
  if (parseChatResolutionEvidenceVersionV1(input.version) === undefined) return
  const {action, actorKey, messageId} = input, story = state.chatNarrative!
  const record = (targetKey: string, evidenceFactKeys: string[], excerpt: string): ChatResolutionEvidenceRecordV1 => {
    const start = action.text.indexOf(excerpt)
    if (start < 0 || !excerpt.length) fail('收束依据不在本次真实表达中')
    return {targetKey, actorKey, evidenceFactKeys: [...evidenceFactKeys], source: {messageId, start, end: start + excerpt.length}}
  }
  const goals = [
    ...(action.goalKey && action.goalStatus && terminalGoal(action.goalStatus) ? [record(action.goalKey, action.evidenceFactKeys, action.text)] : []),
    ...(action.goalUpdates ?? []).filter(e => terminalGoal(e.status)).map(e => record(e.goalKey, e.evidenceFactKeys, e.evidenceExcerpt)),
  ]
  const threads = action.threadUpdates.filter(e => terminalThread(e.status)).map(e => record(e.threadKey, action.evidenceFactKeys, e.evidenceExcerpt))
  if (!goals.length && !threads.length) return
  story.resolutionEvidence ??= {version: 1, goals: [], threads: []}
  story.resolutionEvidence.goals.push(...goals); story.resolutionEvidence.threads.push(...threads)
  validateChatResolutionEvidenceV1(story, state.profiles.map(p => p.participantKey))
  assertChatResolutionEvidenceSourcesV1(state)
}

export function validateChatResolutionEvidenceV1(story: ChatNarrativeStateV1, participants: readonly string[]): void {
  if (story.resolutionEvidence === undefined) return
  const row = (value: unknown, keys: string): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.split(',').sort().join(',')) fail('收束依据字段无效')
    return value as Record<string, unknown>
  }
  const header = row(story.resolutionEvidence, 'version,goals,threads')
  if (header.version !== 1 || story.revision === 0 || !Array.isArray(header.goals) || !Array.isArray(header.threads)
    || !header.goals.length && !header.threads.length || header.goals.length > story.situation.goals.length || header.threads.length > story.situation.threads.length) fail('收束依据版本或数量无效')
  const facts = new Map(story.situation.facts.map(f => [f.factKey, f]))
  for (const kind of ['goals', 'threads'] as const) {
    const seen = new Set<string>()
    for (const item of header[kind] as unknown[]) {
      const record = row(item, 'targetKey,actorKey,evidenceFactKeys,source'), source = row(record.source, 'messageId,start,end')
      const target = kind === 'goals' ? story.situation.goals.find(g => g.goalKey === record.targetKey) : story.situation.threads.find(t => t.threadKey === record.targetKey)
      if (typeof record.targetKey !== 'string' || !target || seen.has(record.targetKey) || target.updatedSequence === 0
        || !(kind === 'goals' ? terminalGoal(target.status) : terminalThread(target.status))) fail('收束依据须唯一绑定已结束的运行事项')
      seen.add(record.targetKey)
      if (typeof record.actorKey !== 'string' || !participants.includes(record.actorKey)
        || ('actorKey' in target ? target.actorKey !== record.actorKey : !target.participantKeys.includes(record.actorKey))) fail('收束依据角色与事项不符')
      if (typeof source.messageId !== 'string' || !source.messageId.length || !Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end)
        || Number(source.start) < 0 || Number(source.end) <= Number(source.start) || Number(source.end) > story.permissions.maxActionCharacters) fail('收束表达引用无效')
      if (!Array.isArray(record.evidenceFactKeys) || new Set(record.evidenceFactKeys).size !== record.evidenceFactKeys.length) fail('收束事实依据无效')
      for (const key of record.evidenceFactKeys) {
        const fact = facts.get(key)
        if (!fact || !fact.audienceKeys.includes(record.actorKey) || fact.sourceEventSequence !== 0 && fact.sourceEventSequence > target.updatedSequence) fail('收束依据未知、不可知或尚未成立')
      }
    }
  }
}

/** Messages remain canonical even when excluded from future model retrieval. */
export function assertChatResolutionEvidenceSourcesV1(state: CharacterInteractionRuntimeState): void {
  const story = state.chatNarrative, index = story?.resolutionEvidence
  if (!story || !index) return
  for (const kind of ['goals', 'threads'] as const) for (const record of index[kind]) {
    const target = kind === 'goals' ? story.situation.goals.find(g => g.goalKey === record.targetKey) : story.situation.threads.find(t => t.threadKey === record.targetKey)
    const message = state.messages.find(m => m.messageId === record.source.messageId)
    if (!target || !message || message.role !== 'character' || message.speakerKey !== record.actorKey
      || message.eventSequence !== target.updatedSequence || message.supersededBySequence != null || record.source.end > message.text.length
      || message.audienceKeys != null && (!message.audienceKeys.includes(record.actorKey)
        || kind === 'threads' && 'audienceKeys' in target && target.audienceKeys.some(key => !message.audienceKeys!.includes(key)))) fail('收束依据缺少对应的真实表达、事件或听众')
  }
}
