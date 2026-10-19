import { describe, expect, it } from 'vitest'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import { parseAvgAuthorStageV1 } from '../../src/lib/avg/author-workspace-contract'
import { applyAvgVoiceChoicesToDraftV1 } from '../../src/lib/avg/voice-configuration'
import { assertAvgInheritedVoiceBindingV1, parseAvgGeneratedVoiceSourceV1, parseAvgInheritedStageVoicesV1 } from '../../src/lib/avg/stage-voice-source-contract'
import { avgVoiceConfigurationFixtureV1 } from '../helpers/avg-voice-production-fixture'
import { hashAvgVoiceTextV1 } from '../../src/lib/avg/voice-production-contract'

/** Structural engineering values only: these hashes are not real producer,
 * author, audition, rights or Build receipts. The authority reader must prove
 * them separately before stage adoption or any physical-media consumption. */
async function fixture() {
  const input = await avgVoiceConfigurationFixtureV1(), workspace = await applyAvgVoiceChoicesToDraftV1(input)
  const r = input.assembly.voice.batch.requirements[0]!, asset = input.choices[0]!.asset
  const source = parseAvgGeneratedVoiceSourceV1({ schema: 'storyforge.avg.generated-voice-source', version: 1,
    productionKey: 'voice.contract.fixture', requirementKey: r.requirementKey, requestIdentityHash: input.choices[0]!.requestIdentityHash,
    raw: { schema: 'storyforge.avg.historical-raw-voice-proof', version: 1, buildNumber: 1, briefHash: 'a'.repeat(64),
      planHash: 'b'.repeat(64), controlEpoch: 0, taskKey: `avg.voice.generate.${r.requirementKey}`, artifactKey: `avg.voice.raw.${r.requirementKey}`,
      artifactVersion: 1, contentHash: asset.contentHash, inputHash: 'c'.repeat(64), producerReceiptHash: 'd'.repeat(64), candidateHash: 'e'.repeat(64), proofHash: 'f'.repeat(64) },
    review: { ...input.choices[0]!.review, authorReceiptHash: '1'.repeat(64) },
    choice: { artifactKey: `avg.voice.choice.${r.requirementKey}`, version: 1, contentHash: '2'.repeat(64), authorReceiptHash: '3'.repeat(64) } })
  return { workspace, asset, requirement: r, source, entry: { assetKey: asset.assetKey, source, declaration: '结构值，未授予任何采用或实际媒资权限。' } }
}

describe('AVG inherited voice portable locators and exact target consumers', () => {
  it('preserves old stage bytes when absent and round-trips an explicit optional source without local IDs', async () => {
    const f = await fixture(), before = canonicalProductProductionJsonV2(f.workspace.presentation)
    expect(canonicalProductProductionJsonV2(parseAvgAuthorStageV1(before))).toBe(before)
    expect(parseAvgAuthorStageV1(before)).not.toHaveProperty('inheritedVoices')
    const stage = parseAvgAuthorStageV1({ ...f.workspace.presentation, inheritedVoices: [f.entry] })
    expect(parseAvgAuthorStageV1(canonicalProductProductionJsonV2(stage))).toEqual(stage)
    for (const key of ['buildId', 'runId', 'blobObjectId']) expect(() => parseAvgGeneratedVoiceSourceV1({ ...f.source, [key]: 5 })).toThrow()
  })

  it('requires exact raw, review and choice identities and refuses missing reviews or unknown fields', async () => {
    const f = await fixture()
    for (const source of [
      { ...f.source, review: undefined }, { ...f.source, requestIdentityHash: 'bad' },
      { ...f.source, raw: { ...f.source.raw, taskKey: 'avg.voice.generate.other' } },
      { ...f.source, review: { ...f.source.review, artifactKey: 'avg.review.audio.other' } },
      { ...f.source, choice: { ...f.source.choice, artifactKey: 'avg.voice.choice.other' } },
    ]) expect(() => parseAvgGeneratedVoiceSourceV1(source)).toThrow()
  })

  it('rejects duplicate sources, absent catalog audio and changed exact Blob hashes', async () => {
    const f = await fixture()
    expect(() => parseAvgInheritedStageVoicesV1([f.entry, f.entry], [f.asset])).toThrow()
    expect(() => parseAvgInheritedStageVoicesV1([f.entry], [])).toThrow()
    expect(() => parseAvgInheritedStageVoicesV1([f.entry], [{ ...f.asset, blobContentHash: '0'.repeat(64) }])).toThrow()
    expect(() => parseAvgInheritedStageVoicesV1([f.entry], [{ ...f.asset, kind: 'sfx' }])).toThrow()
  })

  it('allows an unchanged exact line after unrelated script edits without rebinding original script or performance identity', async () => {
    const f = await fixture(), workspace = structuredClone(f.workspace)
    workspace.scripts.find(s => s.sceneKey !== f.requirement.sceneKey)!.lines[0]!.text += ' 与本句无关的修订。'
    expect(() => assertAvgInheritedVoiceBindingV1({ ...f, scripts: workspace.scripts, reading: workspace.presentation.reading })).not.toThrow()
    expect(workspace.presentation.reading!.voices[0]!.text).toBe(f.requirement.text)
  })

  it('rejects changed words, speakers, scenes, ambiguous consumers and insufficient playback waits', async () => {
    const f = await fixture()
    for (const mutate of [
      (w: typeof f.workspace) => { w.scripts[0]!.lines[0]!.text += ' 已改字' },
      (w: typeof f.workspace) => { w.scripts[0]!.lines[0]!.speakerKey = null },
      (w: typeof f.workspace) => { w.scripts[0]!.sceneKey = 'other' },
      (w: typeof f.workspace) => { w.presentation.reading!.voices.push({ ...w.presentation.reading!.voices[0]!, lineKey: 'other' }) },
      (w: typeof f.workspace) => { w.presentation.reading!.maximumVoiceWaitMs = f.asset.durationMs! },
    ]) {
      const workspace = structuredClone(f.workspace); mutate(workspace)
      expect(() => assertAvgInheritedVoiceBindingV1({ ...f, scripts: workspace.scripts, reading: workspace.presentation.reading })).toThrow()
    }
  })

  it('does not turn canonically equivalent Unicode into permission to reuse different exact words', async () => {
    const f = await fixture(), exact = 'Cafe\u0301'
    f.requirement.text = exact; f.requirement.textHash = await hashAvgVoiceTextV1(exact)
    f.workspace.scripts[0]!.lines[0]!.text = exact; f.workspace.presentation.reading!.voices[0]!.text = exact
    expect(() => assertAvgInheritedVoiceBindingV1({ ...f, scripts: f.workspace.scripts, reading: f.workspace.presentation.reading })).not.toThrow()
    f.workspace.scripts[0]!.lines[0]!.text = exact.normalize('NFC')
    expect(() => assertAvgInheritedVoiceBindingV1({ ...f, scripts: f.workspace.scripts, reading: f.workspace.presentation.reading })).toThrow()
  })
})
