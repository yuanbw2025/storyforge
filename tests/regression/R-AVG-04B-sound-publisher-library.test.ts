import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { compileAvgSoundRequirementsV1 } from '../../src/lib/avg/sound-requirements'
import { parseAvgSoundPlanningScopeV1 } from '../../src/lib/avg/sound-scope-contract'
import { listAvgSoundLibraryMetadataV1, listAvgSoundLibraryMetadataV2, validateAvgSoundProviderResultV1 } from '../../src/lib/avg/sound-provider-contract'
import { createConfiguredAvgSoundTransportV1, avgSoundFromBase64V1 } from '../../src/lib/avg/sound-transport'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { avgSoundProductionFixtureV1 } from '../helpers/avg-sound-production-fixture'
import { avgSoundLibraryFixtureV1 } from '../helpers/avg-sound-wire-data'
import { avgSoundPublisherFixtureV2 } from '../helpers/avg-sound-publisher-fixture'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })

async function fixture() {
  const s = await avgSoundProductionFixtureV1(true), actual = avgSoundPublisherFixtureV2(), sound = s.brief.avgSoundPlanning!
  sound.scope.librarySources = [actual.source]
  sound.scope.templates[0].source = { kind: 'licensed-library', allowedSourceKeys: [actual.source.sourceKey] }
  const plan = { ...s.plan, entries: s.plan.entries.filter(e => e.librarySourceKey !== null).map(e => ({ ...e, librarySourceKey: actual.source.sourceKey })) }
  const compiled = await compileAvgSoundRequirementsV1(sound.scope, plan)
  return { ...s, sound, actual, requirement: compiled.requirements[0] }
}

describe('explicit publisher-page sound source and original result V2, without legacy relabelling', () => {
  it('keeps the151 original choices and declaration shapes; only exact pinned V2 sources extend the combined catalogue', async () => {
    const old = listAvgSoundLibraryMetadataV1(), combined = listAvgSoundLibraryMetadataV2()
    expect(old).toHaveLength(151); expect(combined.slice(0,151)).toEqual(old); expect(combined).toHaveLength(154)
    expect(old.every(source => !('version' in source) && source.publisherPage.startsWith('https://kenney.nl/assets/'))).toBe(true)
    const s = await avgSoundPlanningFixtureV1(), { source } = avgSoundPublisherFixtureV2()
    const scope = { ...s.scope, templates: s.scope.templates.filter(t => t.source.kind === 'licensed-library').map(t => ({ ...t,
      source: { kind: 'licensed-library', allowedSourceKeys: [source.sourceKey] } })), librarySources: [source] }
    expect(parseAvgSoundPlanningScopeV1(scope).librarySources).toEqual([source])
    for (const patch of [{ version: 1 }, { version: undefined }, { version: 3 }, { publisherPageHash: '0'.repeat(64) },
      { publisherPage: 'https://opengameart.org/content/unreviewed' }, { sourceKey: 'kenney.rain' },
      { memberPath: '../rain.ogg' }, { memberHash: '0'.repeat(64) }, { license: 'CC-BY-NC-4.0' }, { licenseMember: 'License.txt' }]) {
      expect(() => parseAvgSoundPlanningScopeV1({ ...scope, librarySources: [{ ...source, ...patch }] })).toThrow()
    }
    expect(await db.productBuilds.count()).toBe(0); expect(await db.productReleases.count()).toBe(0)
  })

  it('verifies the actual original rain bytes and external witness; missing/changed grants and V1 relabelling still fail', async () => {
    const s = await fixture(), input = { requirement: s.requirement, data: s.actual.data, result: s.actual.result, jobId: null, bridgeHash: null }
    await expect(validateAvgSoundProviderResultV1(input)).resolves.toMatchObject({ mimeType: 'audio/ogg', contentHash: s.actual.source.memberHash })
    expect(s.actual.result).not.toHaveProperty('licenseMember'); expect(s.actual.result).not.toHaveProperty('licenseText')
    for (const patch of [{ version: 1 }, { publisher: 'Kenney' }, { licenseEvidence: undefined }, { transcoded: true }, { authorAdopted: true },
      { licenseEvidence: { ...s.actual.result.licenseEvidence, publisherPageHash: '0'.repeat(64) } },
      { licenseEvidence: { ...s.actual.result.licenseEvidence, downloadUrl: 'https://example.invalid/repacked.zip' } }]) {
      await expect(validateAvgSoundProviderResultV1({ ...input, result: { ...s.actual.result, ...patch } })).rejects.toThrow()
    }
    const changed = s.actual.data.slice(0); new Uint8Array(changed)[200] ^= 1
    await expect(validateAvgSoundProviderResultV1({ ...input, data: changed })).rejects.toThrow()
    const legacy = avgSoundLibraryFixtureV1(), original = await avgSoundPlanningFixtureV1()
    original.scope.librarySources = [legacy.source]
    const oldRequest = (await compileAvgSoundRequirementsV1(original.scope, original.plan)).requirements.find(r => r.dispatch.operation === 'import-licensed-audio')!
    await expect(validateAvgSoundProviderResultV1({ ...input, requirement: oldRequest, data: legacy.data, result: legacy.result })).resolves.toMatchObject({ result: legacy.result })
    await expect(validateAvgSoundProviderResultV1({ ...input, requirement: oldRequest })).rejects.toThrow()
  })

  it('uses the existing single GET and durable original-response callback, with zero music/Agnes requests or automatic conversion', async () => {
    const s = await fixture(), before = JSON.stringify(s.sound), beforeBlobs = await db.mediaBlobObjects.count(), onResponse = vi.fn(async (_body: string) => {})
    const fetcher = vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
      expect(String(target)).toBe(`http://127.0.0.1:5298/v1/library/audio/${s.actual.source.archiveHash}/${s.actual.source.memberHash}`)
      expect(init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store' })
      return new Response(s.actual.data.slice(0), { headers: { 'content-type': 'audio/ogg', 'x-storyforge-library-result': JSON.stringify(s.actual.result) } })
    })
    const transport = createConfiguredAvgSoundTransportV1({ declaration: s.sound, fetcher })
    const response = await transport.request({ requirement: s.requirement, idempotencyKey: 'publisher.original.once', signal: new AbortController().signal, onResponse })
    expect(transport.binding).toBeNull(); expect(fetcher).toHaveBeenCalledOnce(); expect(onResponse).toHaveBeenCalledOnce()
    const original = JSON.parse(onResponse.mock.calls[0][0])
    expect(original).toMatchObject({ result: s.actual.result, bodyComplete: true, bodyOmitted: null, automaticRetryAllowed: false })
    expect(new Uint8Array(avgSoundFromBase64V1(original.bodyBase64))).toEqual(new Uint8Array(s.actual.data))
    expect(response.costUsd).toBe(0); expect(JSON.stringify(s.sound)).toBe(before)
    expect(await db.mediaBlobObjects.count()).toBe(beforeBlobs); expect(await db.productQualityGateReceipts.count()).toBe(0)
  })

  it('retains a corrupt original HTTP witness once and refuses it without manufacturing a successful source or retry', async () => {
    const s = await fixture(), result = { ...s.actual.result, licenseEvidence: { ...s.actual.result.licenseEvidence, legalCodeHash: 'f'.repeat(64) } }
    const fetcher = vi.fn(async () => new Response(s.actual.data.slice(0), { headers: { 'content-type': 'audio/ogg', 'x-storyforge-library-result': JSON.stringify(result) } }))
    const onResponse = vi.fn(async (_body: string) => {}), beforeBlobs = await db.mediaBlobObjects.count()
    await expect(createConfiguredAvgSoundTransportV1({ declaration: s.sound, fetcher }).request({ requirement: s.requirement,
      idempotencyKey: 'publisher.corrupt.once', signal: new AbortController().signal, onResponse })).rejects.toMatchObject({ disposition: 'response-recorded' })
    expect(fetcher).toHaveBeenCalledOnce(); expect(onResponse).toHaveBeenCalledOnce()
    expect(JSON.parse(onResponse.mock.calls[0][0]).result).toEqual(result)
    expect(await db.mediaBlobObjects.count()).toBe(beforeBlobs)
  })
})
