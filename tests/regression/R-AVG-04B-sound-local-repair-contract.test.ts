import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { compileAvgSoundRequirementsV1 } from '../../src/lib/avg/sound-requirements'
import { parseAvgSoundLocalRepairV1, assertAvgSoundLocalRepairV1,
  type AvgSoundLocalRepairV1 } from '../../src/lib/avg/sound-local-repair-contract'
import { parseAvgSoundPlanningBriefV1, parseAvgSoundPlanningBriefV2, parseAvgSoundPlanningBrief,
  type AvgSoundPlanningBriefV1, type AvgSoundPlanningBriefV2 } from '../../src/lib/avg/sound-production-brief'
import type { AvgAudioProcessingRecipe } from '../../src/lib/avg/audio-processing-versioned-contract'
import type { AvgGeneratedSoundSource } from '../../src/lib/avg/stage-processed-sound-source-contract'

const hash = (digit: string) => digit.repeat(64)
const recipe = (version: 1 | 2): AvgAudioProcessingRecipe => {
  const common = { schema: 'storyforge.avg.audio-processing-recipe' as const, gainMilliDb: -3000, maximumDurationMs: 120_000,
    channelPolicy: 'preserve' as const, timelinePolicy: 'preserve' as const, overflowPolicy: 'reject' as const,
    declaration: '相对准确原件调整；新声音须重新独立审听并由作者采用。' }
  return version === 1 ? { ...common, version: 1, sampleRatePolicy: 'preserve' }
    : { ...common, version: 2, sampleRatePolicy: 'explicit', targetSampleRateHz: 24000,
      resampler: 'blackman-sinc64.v1', processingOrder: 'resample-gain-linked-limit.v1',
      dynamics: { processor: 'linked-lookahead-peak-limit.v1', ceilingMilliDbfs: -1500, lookaheadMs: 3, releaseMs: 80 } }
}

/** Complete old scope/plan metadata and real canonical hashes only. No Work,
 * producer, actual audio, licence or author adoption evidence is seeded. */
async function fixture(sourceVersion: 1 | 2 = 1, recipeVersion: 1 | 2 = 1, channel: 'bgm' | 'sfx' | 'ambience' = 'bgm') {
  const f = await avgSoundPlanningFixtureV1()
  if (channel !== 'bgm') {
    const t = f.scope.templates[1]!
    t.channel = channel; t.consumer.slot = channel; t.source = { kind: 'licensed-library', allowedSourceKeys: ['fixture.click'] }
    f.scope.librarySources[0]!.memberPath = 'Audio/click_001.wav'
  }
  const compiled = await compileAvgSoundRequirementsV1(f.scope, f.plan)
  const requirement = compiled.requirements.find(r => r.template.channel === channel)!, key = requirement.template.requirementKey
  const original = f.choices.find(c => c.requirementKey === key)!.asset
  const rawHash = channel === 'bgm' ? hash('4') : f.scope.librarySources[0]!.memberHash
  const selectedHash = sourceVersion === 2 ? hash('b') : rawHash
  const source: AvgGeneratedSoundSource = { schema: 'storyforge.avg.generated-sound-source', version: 1,
    productionKey: 'fixture.sound', buildNumber: 1, controlEpoch: 0, briefHash: hash('1'), planHash: hash('2'),
    requirementKey: key, requestIdentityHash: requirement.identityHash,
    raw: { artifactKey: `avg.sound.raw.${key}`, version: 1, contentHash: rawHash, producerReceiptHash: hash('3'),
      responseEvidenceHash: hash('5'), requestSnapshotHash: hash('6'), rightsHash: hash('7') },
    compiled: { artifactKey: 'avg.media.compiled-sound-requirements', version: 1, contentHash: await hashProductProductionValueV2(compiled) },
    review: { artifactKey: `avg.review.audio.${key}`, version: 1, contentHash: hash('8'), authorReceiptHash: hash('9') },
    choice: { artifactKey: `avg.sound.choice.${key}`, version: 1, contentHash: hash('a'), authorReceiptHash: hash('c') } }
  const selectedSource: AvgGeneratedSoundSource = sourceVersion === 1 ? source : { ...source, version: 2,
    processing: { schema: 'storyforge.avg.audio-processing-producer-proof', version: 1, noProviderRequest: true,
      buildNumber: source.buildNumber, briefHash: source.briefHash, planHash: source.planHash, controlEpoch: source.controlEpoch,
      taskKey: `avg.sound.process.${key}`, artifactKey: `avg.sound.processed.${key}`, artifactVersion: 1, contentHash: selectedHash,
      inputHash: hash('d'), producerReceiptHash: hash('e'), candidateHash: hash('f'), proofHash: hash('0'), processingEvidenceHash: hash('d') } }
  const repair: AvgSoundLocalRepairV1 = { schema: 'storyforge.avg.sound-local-repair', version: 1, source: selectedSource,
    sourceBuildRevision: 8, sourceScope: f.scope, sourcePlan: f.plan,
    sourceAsset: { ...original, version: sourceVersion, kind: channel, mimeType: 'audio/wav', contentHash: selectedHash,
      blobContentHash: selectedHash, byteSize: 2_304_044, durationMs: channel === 'bgm' ? 12000 : 500 },
    parent: { productionKey: source.productionKey, buildNumber: 3, buildRevision: 31,
      briefHash: hash('d'), planHash: hash('e'), previewHash: hash('f'), manifestHash: hash('0') },
    recipe: recipe(recipeVersion), declaration: '仅返修所选已采用声音；旧原件、其他声音槽和旧版本保留。' }
  const assembly = { schema: 'storyforge.avg.assembly-brief' as const, version: 1 as const, title: '单项声音返修',
    sceneKeys: [requirement.template.consumer.sceneKey!], mediaAssetKeys: [requirement.template.assetKey], basePackageHash: null }
  const brief: AvgSoundPlanningBriefV2 = { schema: 'storyforge.avg.sound-planning-brief', version: 2, assembly, aspectRatio: '16:9', repair }
  const legacy: AvgSoundPlanningBriefV1 = { schema: 'storyforge.avg.sound-planning-brief', version: 1,
    assembly: { ...assembly, mediaAssetKeys: f.scope.templates.map(t => t.assetKey) }, aspectRatio: '16:9', scope: f.scope,
    musicBinding: { adapterId: 'storyforge.avg.local-music.v1', requirementKey: 'avg.media.music', bindingHash: hash('d'), endpointRouteHash: hash('e') } }
  return { repair, brief, legacy, compiled, requirement }
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Sound repair codecs cannot dispatch providers') }))
  vi.stubGlobal('Worker', vi.fn(() => { throw new Error('Sound repair codecs cannot create Workers') }))
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(Worker).not.toHaveBeenCalled(); vi.unstubAllGlobals() })

describe('AVG strict adopted-sound local repair source contract', () => {
  it.each([[1, 1], [1, 2], [2, 1], [2, 2]] as const)('preserves original identity for source %s and recipe %s with another OGG unchanged', async (sourceVersion, recipeVersion) => {
    const f = await fixture(sourceVersion, recipeVersion), encoded = canonicalProductProductionJsonV2(f.repair)
    const result = await assertAvgSoundLocalRepairV1(encoded)
    expect(canonicalProductProductionJsonV2(result.repair)).toBe(encoded)
    expect(result.compiled).toEqual(f.compiled); expect(result.requirement).toEqual(f.requirement)
    expect(result.repair.sourceScope.templates).toHaveLength(2)
    expect(result.repair.sourceScope.librarySources[0]!.memberPath).toMatch(/\.ogg$/)
    expect(result.repair.source.raw.contentHash).toBe(hash('4'))
    expect(result.repair.sourceAsset.contentHash).toBe(sourceVersion === 2 ? hash('b') : hash('4'))
    expect(result.repair.recipe).toEqual(recipe(recipeVersion))
    expect(parseAvgSoundPlanningBriefV2(f.brief)).toEqual(f.brief)
  })
  it.each(['sfx', 'ambience'] as const)('accepts a selected exact WAV %s without changing the original full compilation', async channel => {
    const f = await fixture(2, 2, channel), result = await assertAvgSoundLocalRepairV1(f.repair)
    expect(result.requirement.template.channel).toBe(channel)
    expect(result.compiled.requirements).toHaveLength(2)
    expect(result.repair.sourceAsset.mimeType).toBe('audio/wav')
  })
  it('keeps exact original V1 parser/dispatcher bytes and rejects version or capability confusion', async () => {
    const f = await fixture(), encoded = canonicalProductProductionJsonV2(f.legacy)
    expect(canonicalProductProductionJsonV2(parseAvgSoundPlanningBriefV1(encoded))).toBe(encoded)
    expect(canonicalProductProductionJsonV2(parseAvgSoundPlanningBrief(encoded))).toBe(encoded)
    expect(parseAvgSoundPlanningBrief(JSON.stringify(f.brief))).toEqual(f.brief)
    expect(() => parseAvgSoundPlanningBriefV1(f.brief)).toThrow()
    expect(() => parseAvgSoundPlanningBriefV2(f.legacy)).toThrow()
    for (const extra of ['scope', 'musicBinding', 'textCapability', 'capabilityBindings', 'authorized']) {
      expect(() => parseAvgSoundPlanningBrief({ ...f.brief, [extra]: null })).toThrow()
    }
    for (const version of [0, 3, '2']) expect(() => parseAvgSoundPlanningBrief({ ...f.brief, version })).toThrow()
  })
  it.each(['extra', 'bad-version', 'ogg', 'wrong-hash', 'wrong-kind', 'wrong-slot', 'foreign-asset', 'missing-target',
    'short-duration', 'unknown-recipe', 'missing-preview', 'future-source', 'source-permission'] as const)('rejects structural %s without producer or adoption authority', async mode => {
    const f = await fixture(), r = f.repair
    if (mode === 'extra') Object.assign(r, { authorAdopted: true })
    if (mode === 'bad-version') Object.assign(r, { version: 2 })
    if (mode === 'ogg') r.sourceAsset.mimeType = 'audio/ogg'
    if (mode === 'wrong-hash') r.sourceAsset.contentHash = r.sourceAsset.blobContentHash = hash('b')
    if (mode === 'wrong-kind') r.sourceAsset.kind = 'voice'
    if (mode === 'wrong-slot') r.sourceAsset.sceneTag = 'foreign'
    if (mode === 'foreign-asset') r.sourceAsset.assetKey = 'foreign'
    if (mode === 'missing-target') r.source.requirementKey = 'foreign'
    if (mode === 'short-duration') r.recipe.maximumDurationMs = 1000
    if (mode === 'unknown-recipe') Object.assign(r.recipe, { version: 3 })
    if (mode === 'missing-preview') Object.assign(r.parent, { previewHash: null })
    if (mode === 'future-source') r.source.buildNumber = r.parent.buildNumber + 1
    if (mode === 'source-permission') Object.assign(r.source, { mayExecute: true })
    expect(() => parseAvgSoundLocalRepairV1(r)).toThrow()
  })
  it.each(['compiled', 'request', 'other-template', 'other-plan', 'narrowed'] as const)('rejects %s against the complete old compiled hash and selected request', async mode => {
    const { repair } = await fixture()
    if (mode === 'compiled') repair.source.compiled.contentHash = hash('0')
    if (mode === 'request') repair.source.requestIdentityHash = hash('0')
    if (mode === 'other-template') repair.sourceScope.templates[1]!.purpose += ' changed'
    if (mode === 'other-plan') repair.sourcePlan.entries[1]!.designIntent += ' changed'
    if (mode === 'narrowed') { repair.sourceScope.templates.splice(1); repair.sourceScope.librarySources = []; repair.sourcePlan.entries.splice(1) }
    await expect(assertAvgSoundLocalRepairV1(repair)).rejects.toThrow(/compiled hash|请求身份/)
  })
  it('rejects an OGG original member even if caller relabels its adopted asset as WAV', async () => {
    const f = await fixture(1, 1, 'sfx')
    f.repair.sourceScope.librarySources[0]!.memberPath = 'Audio/click_001.ogg'
    expect(() => parseAvgSoundLocalRepairV1(f.repair)).toThrow(/原库成员.*WAV/)
  })
  it('requires only the selected slot in the target assembly and never imports the old full batch as new tasks', async () => {
    const f = await fixture()
    expect(f.brief.assembly.mediaAssetKeys).toHaveLength(1)
    expect(parseAvgSoundPlanningBriefV2(f.brief).repair.sourceScope.templates).toHaveLength(2)
    for (const assembly of [{ ...f.brief.assembly, mediaAssetKeys: [] }, { ...f.brief.assembly, sceneKeys: ['foreign'] }]) {
      expect(() => parseAvgSoundPlanningBriefV2({ ...f.brief, assembly })).toThrow(/准确组装/)
    }
  })
  it('captures independent metadata and recipe before asynchronous original-identity checks', async () => {
    const f = await fixture(2, 2), before = structuredClone(f.repair), pending = assertAvgSoundLocalRepairV1(f.repair)
    f.repair.sourceScope.templates[0]!.purpose = 'changed'; f.repair.sourcePlan.entries[0]!.prompt = 'changed'
    f.repair.sourceAsset.name = 'changed'; f.repair.recipe.gainMilliDb = 0
    expect((await pending).repair).toEqual(before)
  })
})
