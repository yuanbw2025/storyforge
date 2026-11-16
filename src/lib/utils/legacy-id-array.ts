/** Reads stored reference IDs without changing the legacy numeric acceptance rules. */
export function parseLegacyIdArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.filter((id): id is number => typeof id === 'number')
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : []
  } catch {
    return []
  }
}
