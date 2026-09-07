export interface TtrpgDirectorPlanV1 {
  revealClueKeys: string[]
  recommendedSceneKeys: string[]
  recommendedEndingKeys: string[]
  pacing: 'investigate' | 'discuss' | 'move' | 'conclude'
}
export interface TtrpgDirectorReceiptV1 extends TtrpgDirectorPlanV1 {
  eventSequence: number
  basisActionSequence: number
  sceneKey: string
  actorKey: string
  runId: number
  candidateHash: string
  reveals: Array<{ clueKey: string; actorKey: string; visibility: 'party' | 'private'; pathKey: string; failForward: boolean }>
}
export function parseTtrpgDirectorPlanV1(value: unknown): TtrpgDirectorPlanV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[ttrpg-director] 决策必须为对象')
  const row = value as Record<string, unknown>
  const fields = ['revealClueKeys', 'recommendedSceneKeys', 'recommendedEndingKeys', 'pacing']
  if (Object.keys(row).length !== fields.length || Object.keys(row).some(key => !fields.includes(key))) throw new Error('[ttrpg-director] 决策字段不在闭集')
  const keys = (value: unknown, maximum: number): string[] => {
    if (!Array.isArray(value) || value.length > maximum || value.some(key => typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key))
      || new Set(value).size !== value.length) throw new Error('[ttrpg-director] 决策引用无效')
    return [...value] as string[]
  }
  if (!['investigate', 'discuss', 'move', 'conclude'].includes(String(row.pacing))) throw new Error('[ttrpg-director] 节奏无效')
  return { revealClueKeys: keys(row.revealClueKeys, 1), recommendedSceneKeys: keys(row.recommendedSceneKeys, 8),
    recommendedEndingKeys: keys(row.recommendedEndingKeys, 8), pacing: row.pacing as TtrpgDirectorPlanV1['pacing'] }
}
export function parseTtrpgDirectorReceiptV1(value: unknown): TtrpgDirectorReceiptV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[ttrpg-director] 回执无效')
  const fields = ['revealClueKeys', 'recommendedSceneKeys', 'recommendedEndingKeys', 'pacing', 'eventSequence', 'basisActionSequence', 'sceneKey', 'actorKey', 'runId', 'candidateHash', 'reveals']
  if (Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) throw new Error('[ttrpg-director] 回执字段无效')
  const row = value as TtrpgDirectorReceiptV1
  const keyValid = (key: unknown) => typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key)
  const plan = parseTtrpgDirectorPlanV1({ revealClueKeys: row.revealClueKeys, recommendedSceneKeys: row.recommendedSceneKeys,
    recommendedEndingKeys: row.recommendedEndingKeys, pacing: row.pacing })
  if (!Number.isSafeInteger(row.eventSequence) || row.eventSequence < 1 || !Number.isSafeInteger(row.basisActionSequence)
    || row.basisActionSequence < 1 || row.basisActionSequence >= row.eventSequence || !Number.isSafeInteger(row.runId) || row.runId < 1
    || !/^[a-f0-9]{64}$/.test(row.candidateHash) || !keyValid(row.sceneKey) || !keyValid(row.actorKey) || !Array.isArray(row.reveals)
    || row.reveals.length !== plan.revealClueKeys.length || row.reveals.some((reveal, index) => !reveal || typeof reveal !== 'object'
      || Object.keys(reveal).length !== 5 || Object.keys(reveal).some(key => !['clueKey', 'actorKey', 'visibility', 'pathKey', 'failForward'].includes(key))
      || reveal.clueKey !== plan.revealClueKeys[index] || reveal.actorKey !== row.actorKey || !['party', 'private'].includes(reveal.visibility)
      || !keyValid(reveal.pathKey) || typeof reveal.failForward !== 'boolean'))
    throw new Error('[ttrpg-director] 回执证据不完整')
  return { ...plan, eventSequence: row.eventSequence, basisActionSequence: row.basisActionSequence, sceneKey: row.sceneKey,
    actorKey: row.actorKey, runId: row.runId, candidateHash: row.candidateHash, reveals: structuredClone(row.reveals) }
}
