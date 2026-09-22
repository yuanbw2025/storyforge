import { describe, expect, it } from 'vitest'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { freezeTextOpenWorldRuntimeModuleV1 } from '../../src/lib/open-world/runtime-package-production'
import type { TextOpenWorldParsedModulesV1 } from '../../src/lib/types'

const LEGACY_DIRECTOR_CANONICAL_JSON = [
  '{"decks":[],"randomEvents":[{"actionKeys":["action.listen-rumor"],',
  '"conditionKeys":["condition.always"],"cooldownMinutes":60,',
  '"effectKeys":["effect.learn-rumor"],',
  '"fingerprint":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",',
  '"intensity":2,"key":"event.legacy-rumor","kind":"clue",',
  '"regionKeys":["region.salt-port"],"rumorKey":"rumor.salt-port",',
  '"title":"Legacy rumor","upgradeTemplateKey":null,"weight":3}],',
  '"regionRules":[],"rules":{"globalMaximumActive":2,"globalMaximumRevealed":4,',
  '"highIntensityStreakLimit":2,"historyLimit":32,"maximumQuestInstances":16,',
  '"maximumSettlementIntervals":8,"systemActionKey":"action.settle-director"},',
  '"templates":[],"version":2}',
].join('')

const LEGACY_DIRECTOR_CONTENT_HASH = 'ffb394b08ed61619fb6896ec75f2bf6f76a53709b4ac678376e21582d1f4c315'

function directorPayload(version: 2 | 3): TextOpenWorldParsedModulesV1['director'] {
  return {
    version,
    sourceVersion: version,
    rules: {
      globalMaximumRevealed: 4,
      globalMaximumActive: 2,
      maximumQuestInstances: 16,
      highIntensityStreakLimit: 2,
      historyLimit: 32,
      maximumSettlementIntervals: 8,
      systemActionKey: 'action.settle-director',
    },
    decks: [],
    templates: [],
    randomEvents: [{
      key: 'event.legacy-rumor',
      title: 'Legacy rumor',
      kind: 'clue',
      regionKeys: ['region.salt-port'],
      locationKeys: ['location.salt-market'],
      actionKeys: ['action.listen-rumor'],
      effectKeys: ['effect.learn-rumor'],
      conditionKeys: ['condition.always'],
      fingerprint: 'f'.repeat(64),
      rumorKey: 'rumor.salt-port',
      upgradeTemplateKey: null,
      intensity: 2,
      weight: 3,
      cooldownMinutes: 60,
    }],
    regionRules: [],
  }
}

function frozenPayload(value: Awaited<ReturnType<typeof freezeTextOpenWorldRuntimeModuleV1>>) {
  return value.payload as Record<string, unknown> & { randomEvents: Array<Record<string, unknown>> }
}

describe('Text Open World · legacy Director runtime-module freeze bytes', () => {
  it('Director v2删除归一化locationKeys并冻结既有canonical JSON与contentHash', async () => {
    const source = directorPayload(2)
    const frozen = await freezeTextOpenWorldRuntimeModuleV1({
      moduleKey: 'director',
      schemaVersion: 2,
      payload: source,
    })
    const payload = frozenPayload(frozen)

    expect(frozen).toMatchObject({
      moduleKey: 'director',
      schemaVersion: 2,
      dependencies: ['quests', 'time-weather'],
      contentHash: LEGACY_DIRECTOR_CONTENT_HASH,
    })
    expect(payload).not.toHaveProperty('sourceVersion')
    expect(payload.randomEvents[0]).not.toHaveProperty('locationKeys')
    expect(canonicalProductProductionJsonV2(payload)).toBe(LEGACY_DIRECTOR_CANONICAL_JSON)
    expect(await hashProductProductionValueV2(payload)).toBe(LEGACY_DIRECTOR_CONTENT_HASH)

    // Freezing is non-mutating even though the legacy byte contract omits the
    // parser-normalized field.
    expect(source).toMatchObject({
      sourceVersion: 2,
      randomEvents: [expect.objectContaining({ locationKeys: ['location.salt-market'] })],
    })
  })

  it('Director v3保留locationKeys并把它纳入冻结hash', async () => {
    const source = directorPayload(3)
    const frozen = await freezeTextOpenWorldRuntimeModuleV1({
      moduleKey: 'director',
      schemaVersion: 3,
      payload: source,
    })
    const payload = frozenPayload(frozen)

    expect(frozen.schemaVersion).toBe(3)
    expect(payload).not.toHaveProperty('sourceVersion')
    expect(payload.randomEvents[0]).toHaveProperty('locationKeys', ['location.salt-market'])
    expect(frozen.contentHash).toBe(await hashProductProductionValueV2(payload))
    expect(frozen.contentHash).not.toBe(LEGACY_DIRECTOR_CONTENT_HASH)
    expect(source.randomEvents[0]!.locationKeys).toEqual(['location.salt-market'])
  })
})
