import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { avgImageResponseEvidenceV1 } from '../../src/lib/avg/media-production-executor'
import { parseAvgHeldImageQueueFailureV4 } from '../../src/lib/avg/visual-held-image-failure'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import type { MediaTransportResponseV1 } from '../../src/lib/product-production/media-adapters'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgVisualBatchDraftV1, prepareAvgAssemblyBriefV1, startAvgAssemblyV1,
  stageAvgWorkspaceInputV1, confirmAvgWorkspaceInputV1, runAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import type { AvgVisualProductionRequirementV1 } from '../../src/lib/avg/media-production-contract'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'

const response: MediaTransportResponseV1 = {
  status: 200, contentType: 'application/json', providerRequestId: 'synthetic-002',
  usage: null, costUsd: null, body: null, json: null,
}
interface Envelope { schema: string; version: number; rawText?: string; responseHash?: string; reason?: string }
const parse = (text: string) => JSON.parse(text) as Envelope
const exactHash = (text: string) => sha256MediaData(new TextEncoder().encode(text).buffer)

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('SFQA-002 AVG exact response encoding', () => {
  it('preserves ASCII, Chinese, NFC/NFD, whitespace, escapes, duplicate keys and malformed JSON verbatim', async () => {
    const bodies = [
      '{"data":[],"revised_prompt":"ASCII"}', '{"data":[],"revised_prompt":"中文"}',
      '{"data":[],"revised_prompt":"\u00e9"}', '{"data":[],"revised_prompt":"e\u0301"}',
      '\r\n  {"data": []}\r\n\t', '{"revised_prompt":"\\u0065\\u0301"}',
      '{"revised_prompt":"first","revised_prompt":"e\u0301"}', '{broken\r\ne\u0301',
    ]
    for (const raw of bodies) {
      const stored = parse(await avgImageResponseEvidenceV1(response, raw))
      expect(stored.schema).toBe('storyforge.avg.image-provider-response')
      expect(stored.version).toBe(1)
      expect(stored.rawText).toBe(raw)
      expect(await exactHash(stored.rawText!)).toBe(await exactHash(raw))
    }
    const nfc = await avgImageResponseEvidenceV1(response, '\u00e9')
    const nfd = await avgImageResponseEvidenceV1(response, 'e\u0301')
    expect(nfd).not.toBe(nfc)
    expect(await exactHash(nfd)).not.toBe(await exactHash(nfc))
    // Production/candidate semantic hashes deliberately keep their old NFC rule.
    expect(canonicalProductProductionJsonV2('e\u0301')).toBe(canonicalProductProductionJsonV2('\u00e9'))
    expect(await hashProductProductionValueV2('e\u0301')).toBe(await hashProductProductionValueV2('\u00e9'))
  })

  it('retains the existing strict JSON rejection instead of silently coercing invalid metadata', async () => {
    const circular: { self?: unknown } = {}; circular.self = circular
    const invalid: unknown[] = [
      { value: undefined }, { value: NaN }, { value: Infinity }, { value: BigInt(1) },
      { value: Symbol('not-json') }, { value: () => 'not-json' }, new Array<unknown>(1),
      new Date(0), circular, { '\u00e9': 1, 'e\u0301': 2 },
    ]
    for (const json of invalid) await expect(avgImageResponseEvidenceV1({ ...response, json }, 'raw')).rejects.toThrow()
  })

  it('preserves controlled privacy omission and distinguishes the omitted exact Unicode bytes', async () => {
    const nfc = parse(await avgImageResponseEvidenceV1(response, '{"api_key":"synthetic-\u00e9"}'))
    const nfd = parse(await avgImageResponseEvidenceV1(response, '{"api_key":"synthetic-e\u0301"}'))
    expect(nfc).toMatchObject({ schema: 'storyforge.avg.image-provider-response-omitted', reason: 'policy' })
    expect(nfd).toMatchObject({ schema: 'storyforge.avg.image-provider-response-omitted', reason: 'policy' })
    expect(nfc.rawText).toBeUndefined(); expect(nfd.rawText).toBeUndefined()
    expect(nfd.responseHash).not.toBe(nfc.responseHash)
    expect(JSON.stringify(nfd)).not.toContain('synthetic-')
  })

  it('keeps the existing v1 queue-failure reader compatible with both old and new envelopes', async () => {
    const raw = JSON.stringify({ error: { message: '队列 e\u0301 已满', type: '', param: '', code: null } })
    const text = await avgImageResponseEvidenceV1({ ...response, status: 503 }, raw)
    expect(parseAvgHeldImageQueueFailureV4(text)).toMatchObject({ status: 503, providerRequestId: response.providerRequestId })
    const historical = canonicalProductProductionJsonV2(JSON.parse(text))
    expect(parseAvgHeldImageQueueFailureV4(historical)).toMatchObject({ status: 503, providerRequestId: response.providerRequestId })
    expect(parse(text).rawText).toBe(raw)
  })
})

describe('SFQA-002 original public AVG Unicode probe, controlled HTTP only', () => {
  beforeEach(async () => {
    await db.delete(); await db.open()
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1')
    useAIConfigStore.getState().setConfig({ provider: 'agnes', apiKey: 'synthetic-002-no-network', model: 'agnes-2.5-flash',
      baseUrl: 'https://avg-raw.fixture.invalid/v1', temperature: 0.7, maxTokens: 0 })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw Error('No real model or network is authorized') }))
  })
  afterEach(() => { db.close() })

  for (const note of ['\u00e9', 'e\u0301']) it(`retains the actual accepted image response after reopen: ${JSON.stringify(note)}`, async () => {
    const bytes = new Uint8Array(await deterministicRegionMapPngV1({ width: 576, height: 324, palette: ['#18213b', '#39506b', '#c8dce8'] }))
    let binary = ''
    for (let i = 0; i < bytes.length; i += 16_384) binary += String.fromCharCode(...bytes.subarray(i, i + 16_384))
    const raw = '{\n "data": [{"b64_json":"' + btoa(binary) + '", "revised_prompt":"' + note + '"}]\n}'
    const dispatch = vi.fn<typeof fetch>(async url => {
      expect(String(url)).toMatch(/^https:\/\/avg-raw\.fixture\.invalid\//)
      return new Response(raw, { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'synthetic-002' } })
    })
    vi.stubGlobal('fetch', dispatch)
    const source = await prepareNativeAvgAssembly()
    const requirement: AvgVisualProductionRequirementV1 = {
      requirementKey: 'desk.background', revision: 1, assetKey: 'avg.generated.desk', name: '原文工程背景', altText: '合成校准图',
      family: { subjectKey: 'desk', familyKey: 'desk.day', variantKey: 'day', revision: 1 },
      consumer: { consumerKey: 'desk.background', domain: 'stage', slot: 'background', subjectKey: 'desk', sceneKey: 'desk', lineKey: null, required: true, fallback: 'none' },
      triggerBeatKey: 'line.desk', itemVariantKey: null, mediaKind: 'background', prompt: '原创工程校准', negativePrompt: '',
      invariants: [], forbiddenDepictions: [], width: 576, height: 324, resolutionTier: '1K', alpha: 'not-required', references: [],
    }
    const saved = await saveAvgVisualBatchDraftV1({ scope: source.scope,
      expectedDraftRevision: (await readAvgDraftV1(source.scope)).revision, batchKey: 'raw002.batch', revision: 1, requirements: [requirement] })
    const prepared = await prepareAvgAssemblyBriefV1({ scope: source.scope, expectedDraftRevision: saved.revision })
    const details = await startAvgAssemblyV1({ scope: source.scope, productionId: source.productionId, expectedBriefHash: prepared.brief!.briefHash })
    for (const artifactKey of ['avg.system.plan', ...details.executionBrief!.avgAssembly!.sceneKeys.map(key => `avg.content.scene-script.${key}`)]) {
      const candidate = await stageAvgWorkspaceInputV1({ scope: source.scope, productionId: source.productionId,
        expectedDraftRevision: (await readAvgDraftV1(source.scope)).revision, artifactKey, declaration: '合成原创工程输入，非艺术验收' })
      await confirmAvgWorkspaceInputV1({ scope: source.scope, productionId: source.productionId, artifactKey,
        candidateVersion: candidate.version, candidateHash: (JSON.parse(candidate.metadataJson) as { candidateHash: string }).candidateHash })
    }
    await runAvgAssemblyV1({ scope: source.scope, productionId: source.productionId })
    const build = (await db.productBuilds.get(details.build!.id!))!
    const accepted = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!, 'avg.media.raw.desk.background'])
      .filter(row => row.status === 'accepted').first()
    expect(accepted, build.failureJson).toBeDefined()
    const quality = JSON.parse(accepted!.qualityJson) as { responseEvidenceHash: string }
    const evidence = await readAgentRunArtifactExactV1({ projectId: source.scope.projectId, artifactKind: 'raw-response', contentHash: quality.responseEvidenceHash })
    expect(parse(evidence).rawText).toBe(raw)
    expect(await exactHash(parse(evidence).rawText!)).toBe(await exactHash(raw))
    expect(await exactHash(evidence)).toBe(quality.responseEvidenceHash)
    db.close(); await db.open()
    expect(await readAgentRunArtifactExactV1({ projectId: source.scope.projectId, artifactKind: 'raw-response', contentHash: quality.responseEvidenceHash })).toBe(evidence)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
