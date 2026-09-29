import { canonicalProductProductionJsonV2 } from './hash'

/** A capacity correction preserves keys, authored effects, costs and all story content. */
export function isTextAdventureClockCapacityRevisionV1(before: unknown, after: unknown): boolean {
  try {
    const original = before as { schema?: string; resources?: Array<{ role: string; maximum: number }> }
    const revised = structuredClone(after) as typeof original
    if (original.schema !== 'storyforge.text-adventure-systems-artifact'
      || !Array.isArray(original.resources) || !Array.isArray(revised.resources)) return false
    const clocks = original.resources.filter(resource => resource.role === 'clock')
    const nextClocks = revised.resources.filter(resource => resource.role === 'clock')
    if (clocks.length !== 1 || nextClocks.length !== 1
      || !Number.isSafeInteger(nextClocks[0].maximum)
      || nextClocks[0].maximum <= clocks[0].maximum || nextClocks[0].maximum > 10_000_000) return false
    nextClocks[0].maximum = clocks[0].maximum
    return canonicalProductProductionJsonV2(original) === canonicalProductProductionJsonV2(revised)
  } catch { return false }
}
