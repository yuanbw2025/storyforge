export interface TtrpgPrivateGuidanceV1 { actorKey: string; advice: string; suggestedActionKey: string | null }
export interface TtrpgPrivateGuidanceReceiptV1 extends TtrpgPrivateGuidanceV1 {
  eventSequence: number; runId: number; candidateHash: string; question: string
}
export function parseTtrpgPrivateGuidanceV1(value: unknown): TtrpgPrivateGuidanceV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[ttrpg-private] 指引格式无效')
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== 3 || Object.keys(row).some(key => !['actorKey', 'advice', 'suggestedActionKey'].includes(key))
    || typeof row.actorKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.actorKey)
    || typeof row.advice !== 'string' || !row.advice.trim() || row.advice.length > 5000
    || (row.suggestedActionKey !== null && (typeof row.suggestedActionKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.suggestedActionKey))))
    throw new Error('[ttrpg-private] 私密指引字段无效')
  return { actorKey: row.actorKey, advice: row.advice.trim(), suggestedActionKey: row.suggestedActionKey as string | null }
}
export function parseTtrpgPrivateGuidanceReceiptV1(value: unknown): TtrpgPrivateGuidanceReceiptV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[ttrpg-private] 指引回执无效')
  const fields = ['actorKey', 'advice', 'suggestedActionKey', 'eventSequence', 'runId', 'candidateHash', 'question']
  if (Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) throw new Error('[ttrpg-private] 指引回执字段无效')
  const row = value as TtrpgPrivateGuidanceReceiptV1
  const advice = parseTtrpgPrivateGuidanceV1({ actorKey: row.actorKey, advice: row.advice, suggestedActionKey: row.suggestedActionKey })
  if (!Number.isSafeInteger(row.eventSequence) || row.eventSequence < 1 || !Number.isSafeInteger(row.runId) || row.runId < 1
    || !/^[a-f0-9]{64}$/.test(row.candidateHash) || typeof row.question !== 'string' || !row.question.trim() || row.question.length > 8000)
    throw new Error('[ttrpg-private] 指引回执证据无效')
  return { ...advice, eventSequence: row.eventSequence, runId: row.runId, candidateHash: row.candidateHash, question: row.question }
}
