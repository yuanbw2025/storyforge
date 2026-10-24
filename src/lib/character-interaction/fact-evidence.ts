import type {ChatFactEvidenceRecordV1, ChatNarrativeStateV1} from '../types/chat-narrative'

function fail(message: string): never {throw new Error(`[chat-fact-evidence] ${message}`)}

export function parseChatFactEvidenceVersionV1(value: unknown): 1 | undefined {
  if (value === undefined) return undefined
  if (value !== 1) fail('事实来源提交版本无效')
  return 1
}

/** Called only from the same deterministic reduction as the reviewed effects.
 * Old events never acquire provenance merely by being replayed in new code. */
export function recordChatFactEvidenceV1(story: ChatNarrativeStateV1, version: unknown, records: ChatFactEvidenceRecordV1[]): void {
  if (parseChatFactEvidenceVersionV1(version) === undefined || !records.length) return
  story.factEvidence ??= {version: 1, records: []}
  story.factEvidence.records.push(...structuredClone(records))
}

export function validateChatFactEvidenceV1(story: ChatNarrativeStateV1, participantKeys: readonly string[]): void {
  const evidence = story.factEvidence
  if (evidence === undefined) return
  const row = (value: unknown, keys: string): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== keys.split(',').sort().join(',')) fail('事实来源字段无效')
    return value as Record<string, unknown>
  }
  const header = row(evidence, 'version,records'), facts = story.situation.facts
  if (header.version !== 1 || story.revision === 0 || !Array.isArray(header.records)
    || !header.records.length || header.records.length > facts.length) fail('事实来源版本或数量无效')
  const factIndex = new Map(facts.map((fact, index) => [fact.factKey, index]))
  const seen = new Set<string>()
  for (const raw of header.records) {
    const record = row(raw, 'factKey,kind,evidenceFactKeys,actorKey,goalKey,source')
    const index = factIndex.get(String(record.factKey)) ?? -1, fact = facts[index]
    if (typeof record.factKey !== 'string' || !fact || seen.has(fact.factKey) || !['runtime-consequence', 'runtime-situation'].includes(fact.origin)
      || fact.sourceEventSequence === 0) fail('事实来源必须唯一绑定已提交运行事实')
    seen.add(fact.factKey)
    if (typeof record.source !== 'string' || !['action', 'situation', 'inquiry'].includes(record.source)
      || (record.source === 'action') !== (fact.origin === 'runtime-consequence')) fail('事实来源与提交路径不符')
    if (!story.permissions.allowedNewFactKinds.includes(record.kind as ChatFactEvidenceRecordV1['kind'])
      || record.source === 'inquiry' && record.kind !== 'observation') fail('事实类型与冻结权限或询问路径不符')
    if (record.actorKey !== null && (typeof record.actorKey !== 'string' || !participantKeys.includes(record.actorKey))
      || record.source !== 'situation' && record.actorKey === null) fail('事实来源角色无效')
    if (record.goalKey !== null && !story.situation.goals.some(g => g.goalKey === record.goalKey && g.actorKey === record.actorKey)) fail('事实来源目标无效')
    if (!Array.isArray(record.evidenceFactKeys) || new Set(record.evidenceFactKeys).size !== record.evidenceFactKeys.length) fail('事实依据引用无效')
    for (const key of record.evidenceFactKeys) {
      const prior = factIndex.get(key) ?? -1, dependency = facts[prior]
      // Original source order disambiguates dependencies in the same event.
      // Initial facts (sequence zero) are timeless even in rebased branches.
      if (prior < 0 || prior >= index || dependency.sourceEventSequence !== 0 && dependency.sourceEventSequence > fact.sourceEventSequence) fail('事实依据缺失、自引用、循环或尚未成立')
      if (record.actorKey !== null && !dependency.audienceKeys.includes(String(record.actorKey))) fail('事实依据不属于来源角色的知识')
    }
  }
}
