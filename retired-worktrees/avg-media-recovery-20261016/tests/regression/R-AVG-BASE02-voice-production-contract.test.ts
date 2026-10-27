import { describe, expect, it } from 'vitest'
import { avgSystemFixture } from '../helpers/avg-system-fixture'
import type { AvgSceneScriptV1 } from '../../src/lib/avg/artifact-contract'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import type { AvgMediaSourceInputV1 } from '../../src/lib/avg/media-source'
import {
  assertAvgVoiceProductionTextHashesV1, hashAvgVoiceTextV1, parseAvgVoiceProductionBatchV1,
  type AvgVoiceProductionBatchV1,
} from '../../src/lib/avg/voice-production-contract'
import { hashAvgVoiceSourceInputV1, validateAvgVoiceProductionSourcesV1 } from '../../src/lib/avg/voice-production-source'

async function fixture() {
  const systemPlan = avgSystemFixture()
  const scripts: AvgSceneScriptV1[] = systemPlan.scenes.map(scene => ({
    schema: 'storyforge.avg.scene-script', version: 1, sceneKey: scene.key,
    lines: [{ lineKey: `line.${scene.key}`, beatKey: `line.${scene.key}`,
      speakerKey: scene.key === 'desk' ? 'keeper' : null,
      text: scene.key === 'desk' ? '  **封口**仍在。\n' : '你等待答复。', informationKeys: [], actionKeys: [] }],
    choices: systemPlan.actions.filter(action => action.fromSceneKey === scene.key)
      .map(action => ({ choiceKey: action.key, actionKey: action.key, text: action.label })),
  }))
  const input: AvgMediaSourceInputV1 = { systemPlan, scripts, presentation: { aspectRatio: '16:9' } }
  const script = scripts[0]!, line = script.lines[0]!
  const source = { artifactKey: `avg.content.scene-script.${script.sceneKey}`,
    version: 3, contentHash: await hashProductProductionValueV2(script), payload: script }
  const batch: AvgVoiceProductionBatchV1 = {
    schema: 'storyforge.avg.voice-production-batch', version: 1,
    sourceInputHash: await hashAvgVoiceSourceInputV1(input), outputFormat: 'wav',
    presets: [{ presetKey: 'keeper.voice', revision: 2, adapterId: 'storyforge.avg.compatible-speech.v1',
      provider: 'test-provider', model: 'speech-fixture', voiceId: 'catalog-voice', locale: 'zh-CN',
      endpointRouteHash: 'a'.repeat(64), capabilityHash: 'b'.repeat(64),
      rights: { basis: 'provider-preset', declaration: '工程预设；不表示真实账户或声音使用权已验收。', reference: 'fixture-terms-v1' } }],
    requirements: [{ requirementKey: 'keeper.line', assetKey: 'voice.desk', sceneKey: script.sceneKey,
      lineKey: line.lineKey, speakerKey: line.speakerKey, locale: 'zh-CN', text: line.text,
      textRevision: source.version, textHash: await hashAvgVoiceTextV1(line.text),
      script: { artifactKey: source.artifactKey, version: source.version, contentHash: source.contentHash },
      presetKey: 'keeper.voice', presetRevision: 2,
      performance: { revision: 1, intent: '平静确认；固定工程句，不生成新剧情。',
        pronunciations: [{ phrase: '封口', reading: 'fēng kǒu' }], instructions: null, speed: null }, maximumDurationMs: 30_000 }],
  }
  return { batch, input, source }
}

describe('AVG BASE-02 exact single-line voice production contract', () => {
  it('preserves exact whitespace and literal Markdown; canonical text hashes never use assistant cleanup', async () => {
    const { batch } = await fixture()
    const parsed = await assertAvgVoiceProductionTextHashesV1(JSON.stringify(batch))
    expect(parsed.requirements[0]!.text).toBe('  **封口**仍在。\n')
    expect(await hashAvgVoiceTextV1(parsed.requirements[0]!.text.trim())).not.toBe(parsed.requirements[0]!.textHash)
    expect(await hashAvgVoiceTextV1('é')).not.toBe(await hashAvgVoiceTextV1('e\u0301'))
  })

  it('checks the exact canonical script bytes and version without granting Work or author authority', async () => {
    const { batch, input, source } = await fixture()
    expect(await validateAvgVoiceProductionSourcesV1(batch, input, [source])).toEqual(batch)
    const portable = JSON.stringify(batch)
    for (const key of ['apiKey', 'baseUrl', 'blobObjectId', 'workId', 'producerRunId', 'authorAccepted', 'estimatedDurationMs']) {
      expect(portable).not.toContain(`"${key}"`)
    }
  })

  it('retakes identical text with a new performance revision while retaining the independent text identity', async () => {
    const { batch } = await fixture(), changed = structuredClone(batch)
    changed.requirements[0]!.performance.revision++
    changed.requirements[0]!.performance.intent = '同句更急切；演法变更须重新生产和审听。'
    expect((await assertAvgVoiceProductionTextHashesV1(changed)).requirements[0]!.textHash).toBe(batch.requirements[0]!.textHash)
    expect(await hashProductProductionValueV2(changed)).not.toBe(await hashProductProductionValueV2(batch))
  })

  it('rejects stale text hashes and also rejects rehashed replacement text that is absent from the accepted script', async () => {
    const { batch, input, source } = await fixture(), changed = structuredClone(batch)
    changed.requirements[0]!.text = '封口已经打开。'
    changed.requirements[0]!.performance.pronunciations = []
    await expect(assertAvgVoiceProductionTextHashesV1(changed)).rejects.toThrow(/hash/)
    changed.requirements[0]!.textHash = await hashAvgVoiceTextV1(changed.requirements[0]!.text)
    await expect(validateAvgVoiceProductionSourcesV1(changed, input, [source])).rejects.toThrow(/文本/)
  })

  it.each(['speakerKey', 'lineKey'] as const)('rejects an altered %s even when exact text remains unchanged', async field => {
    const { batch, input, source } = await fixture(), changed = structuredClone(batch)
    if (field === 'speakerKey') changed.requirements[0]!.speakerKey = null
    else changed.requirements[0]!.lineKey = 'line.absent'
    await expect(validateAvgVoiceProductionSourcesV1(changed, input, [source])).rejects.toThrow(/说话人|配音句/)
  })

  it('refuses the old script revision even after an identical-text script is accepted again', async () => {
    const { batch, input, source } = await fixture()
    await expect(validateAvgVoiceProductionSourcesV1(batch, input, [{ ...source, version: source.version + 1 }])).rejects.toThrow(/修订/)
    const updated = structuredClone(batch)
    updated.requirements[0]!.textRevision++
    updated.requirements[0]!.script.version++
    expect(await validateAvgVoiceProductionSourcesV1(updated, input, [{ ...source, version: source.version + 1 }])).toEqual(updated)
  })

  it('rejects a stale aggregate source after a canonical rule or another scene changes', async () => {
    const { batch, input, source } = await fixture(), changed = structuredClone(input)
    changed.systemPlan.title = '规则修订'
    await expect(validateAvgVoiceProductionSourcesV1(batch, changed, [source])).rejects.toThrow(/重新冻结/)
    const edited = structuredClone(input)
    edited.scripts[1]!.lines[0]!.text = '新的结束台词。'
    await expect(validateAvgVoiceProductionSourcesV1(batch, edited, [source])).rejects.toThrow(/重新冻结/)
  })

  it('keeps the same voice source across image canvas changes and script enumeration order', async () => {
    const { batch, input, source } = await fixture(), changed = structuredClone(input)
    changed.presentation.aspectRatio = '4:3'
    changed.scripts.reverse()
    expect(await hashAvgVoiceSourceInputV1(changed)).toBe(batch.sourceInputHash)
    expect(await validateAvgVoiceProductionSourcesV1(batch, changed, [source])).toEqual(batch)
  })

  it('distinguishes exact script Unicode even when the legacy Artifact hash considers the strings equivalent', async () => {
    const { batch, input, source } = await fixture(), exact = structuredClone(input), changed = structuredClone(batch)
    exact.scripts[0]!.lines[0]!.text = 'e\u0301 的原样台词。'
    changed.requirements[0]!.text = exact.scripts[0]!.lines[0]!.text
    changed.requirements[0]!.textHash = await hashAvgVoiceTextV1(changed.requirements[0]!.text)
    changed.requirements[0]!.performance.pronunciations = []
    changed.sourceInputHash = await hashAvgVoiceSourceInputV1(exact)
    const exactSource = { ...source, payload: exact.scripts[0]!, contentHash: await hashProductProductionValueV2(exact.scripts[0]!) }
    changed.requirements[0]!.script.contentHash = exactSource.contentHash
    expect(await validateAvgVoiceProductionSourcesV1(changed, exact, [exactSource])).toEqual(changed)
    const normalized = structuredClone(exactSource)
    normalized.payload.lines[0]!.text = 'é 的原样台词。'
    expect(await hashProductProductionValueV2(normalized.payload)).toBe(exactSource.contentHash)
    await expect(validateAvgVoiceProductionSourcesV1(changed, exact, [normalized])).rejects.toThrow(/来源字节/)
    const normalizedInput = structuredClone(exact)
    normalizedInput.scripts[0]!.lines[0]!.text = normalized.payload.lines[0]!.text
    expect(await hashAvgVoiceSourceInputV1(normalizedInput)).not.toBe(changed.sourceInputHash)
    expect(() => hashAvgVoiceTextV1('\ud800')).toThrow(/Unicode/)
  })

  it('requires the exact source set and refuses missing, duplicate, unrelated or byte-forged script evidence', async () => {
    const { batch, input, source } = await fixture()
    for (const sources of [[], [source, source], [{ ...source, artifactKey: 'avg.content.scene-script.other' }]]) {
      await expect(validateAvgVoiceProductionSourcesV1(batch, input, sources)).rejects.toThrow(/来源/)
    }
    await expect(validateAvgVoiceProductionSourcesV1(batch, input, [{ ...source, contentHash: 'c'.repeat(64) }])).rejects.toThrow(/字节/)
  })

  it('binds one exact runtime line and asset per requirement; another requirement name cannot duplicate a consumer', async () => {
    const { batch } = await fixture()
    const duplicateLine = structuredClone(batch)
    duplicateLine.requirements.push({ ...duplicateLine.requirements[0]!, requirementKey: 'second', assetKey: 'second.voice' })
    expect(() => parseAvgVoiceProductionBatchV1(duplicateLine)).toThrow(/重复/)
    const duplicateAsset = structuredClone(batch)
    duplicateAsset.requirements.push({ ...duplicateAsset.requirements[0]!, requirementKey: 'second', lineKey: 'line.other' })
    expect(() => parseAvgVoiceProductionBatchV1(duplicateAsset)).toThrow(/重复/)
  })

  it('refuses missing, stale or unconsumed presets instead of expanding the frozen authorization range', async () => {
    const { batch } = await fixture()
    const changed = structuredClone(batch)
    changed.requirements[0]!.presetRevision++
    expect(() => parseAvgVoiceProductionBatchV1(changed)).toThrow(/音色/)
    expect(() => parseAvgVoiceProductionBatchV1({ ...batch, presets: [] })).toThrow()
    expect(() => parseAvgVoiceProductionBatchV1({ ...batch, presets: [...batch.presets, { ...batch.presets[0]!, presetKey: 'unused' }] })).toThrow(/未使用/)
  })

  it('keeps the supported runtime locale and requested WAV explicit and rejects cloning, credentials and inferred timing', async () => {
    const { batch } = await fixture()
    for (const patch of [{ locale: 'en-US' }, { apiKey: 'forbidden' }, { baseUrl: 'https://example.invalid/v1' }, { rights: { ...batch.presets[0]!.rights, basis: 'voice-clone' } }]) {
      expect(() => parseAvgVoiceProductionBatchV1({ ...batch, presets: [{ ...batch.presets[0], ...patch }] })).toThrow()
    }
    expect(() => parseAvgVoiceProductionBatchV1({ ...batch, outputFormat: 'mp3' })).toThrow()
    expect(() => parseAvgVoiceProductionBatchV1({ ...batch, requirements: [{ ...batch.requirements[0], estimatedDurationMs: 1000 }] })).toThrow()
    expect(() => parseAvgVoiceProductionBatchV1({ ...batch, requirements: [{ ...batch.requirements[0], timing: [{ startMs: 0, endMs: 1000 }] }] })).toThrow()
  })

  it('rejects unknown rights, unused pronunciation phrases, unbounded output and sparse or oversized batches', async () => {
    const { batch } = await fixture()
    const changed = structuredClone(batch)
    changed.presets[0]!.rights.declaration = ''
    expect(() => parseAvgVoiceProductionBatchV1(changed)).toThrow()
    for (const performance of [
      { ...batch.requirements[0]!.performance, pronunciations: [{ phrase: '不存在的词', reading: 'test' }] },
      { ...batch.requirements[0]!.performance, speed: 99 },
    ]) expect(() => parseAvgVoiceProductionBatchV1({ ...batch, requirements: [{ ...batch.requirements[0], performance }] })).toThrow()
    for (const requirements of [[], Array(1), Array.from({ length: 9 }, () => batch.requirements[0])]) {
      expect(() => parseAvgVoiceProductionBatchV1({ ...batch, requirements })).toThrow()
    }
    expect(() => parseAvgVoiceProductionBatchV1({ ...batch, requirements: [{ ...batch.requirements[0], maximumDurationMs: 120_001 }] })).toThrow()
  })
})
