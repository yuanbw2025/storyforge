import { describe, expect, it } from 'vitest'
import { resolveTextOpenWorldSceneRegionV1 } from '../../src/lib/open-world/scene-region-binding'

const input = {
  scene: { key: 'scene.objective.visit', sourceKind: 'quest-objective' as const,
    questKey: 'quest.visit', regionKey: 'region.port', locationKey: 'location.camp' },
  locations: [{ key: 'location.camp', regionKey: 'region.basin' }],
  quests: [{ key: 'quest.visit', regionKeys: ['region.port', 'region.basin'],
    locationKeys: ['location.port', 'location.camp'] }],
}

describe('frozen map owns objective scene geography', () => {
  it('corrects only the known first-region projection without mutating accepted inputs', () => {
    const before = structuredClone(input)
    expect(resolveTextOpenWorldSceneRegionV1(input)).toBe('region.basin')
    expect(input).toEqual(before)
    expect(resolveTextOpenWorldSceneRegionV1({ ...input,
      scene: { ...input.scene, regionKey: 'region.basin' },
    })).toBe('region.basin')
  })

  it('rejects missing places, unrelated regions, non-objective scenes and out-of-scope places', () => {
    for (const candidate of [
      { ...input, locations: [] },
      { ...input, scene: { ...input.scene, regionKey: 'region.other' } },
      { ...input, scene: { ...input.scene, sourceKind: 'actor-dialogue' as const } },
      { ...input, quests: [{ ...input.quests[0]!, locationKeys: ['location.port'] }] },
      { ...input, quests: [{ ...input.quests[0]!, regionKeys: ['region.port'] }] },
    ]) expect(() => resolveTextOpenWorldSceneRegionV1(candidate)).toThrow(/场景/)
  })
})
