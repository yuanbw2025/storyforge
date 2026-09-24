import registry from './ai-entry-registry.json'

export interface LimitedAITransport {
  entryId: string
  boundary: 'ephemeral-author-input' | 'read-only-audio'
  adoptAllowed: false
  allowedCallers: string[]
  reason: string
}
/** Strict optional extension: frozen creative bindings remain unchanged. */
export function parseLimitedAITransports(value: unknown): LimitedAITransport[] {
  if (!Array.isArray(value)) throw new Error('有限语音入口必须是数组')
  const ids = new Set<string>()
  return value.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('有限语音入口无效')
    const entry = raw as Record<string, unknown>
    if (Object.keys(entry).sort().join(',') !== 'adoptAllowed,allowedCallers,boundary,entryId,reason'
      || typeof entry.entryId !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(entry.entryId)
      || ids.has(entry.entryId) || entry.adoptAllowed !== false
      || !['ephemeral-author-input', 'read-only-audio'].includes(String(entry.boundary))
      || typeof entry.reason !== 'string' || !entry.reason.trim()
      || !Array.isArray(entry.allowedCallers) || !entry.allowedCallers.length
      || entry.allowedCallers.some((item) => typeof item !== 'string' || !item.startsWith('src/'))
      || new Set(entry.allowedCallers).size !== entry.allowedCallers.length) throw new Error('有限语音入口边界无效')
    ids.add(entry.entryId)
    return { entryId: entry.entryId, boundary: entry.boundary as LimitedAITransport['boundary'], adoptAllowed: false,
      allowedCallers: [...entry.allowedCallers] as string[], reason: entry.reason }
  })
}

const transports = parseLimitedAITransports(registry.limitedTransports)
export function assertVoiceTransport(entryId: string, caller: string): void {
  const entry = transports.find((value) => value.entryId === entryId)
  if (!entry || !entry.allowedCallers.includes(caller)) throw new Error('未登记的语音边界')
}
