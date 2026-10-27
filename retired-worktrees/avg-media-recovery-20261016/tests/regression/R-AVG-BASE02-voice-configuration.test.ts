import { describe, expect, it } from 'vitest'
import { avgVoiceConfigurationFixtureV1 } from '../helpers/avg-voice-production-fixture'
import { applyAvgVoiceChoicesToDraftV1 } from '../../src/lib/avg/voice-configuration'
import { parseAvgAuthorVoiceChoiceV1 } from '../../src/lib/avg/voice-choice-contract'

describe('AVG BASE-02 deterministic generated voice configuration proposal', () => {
  it('proposes one exact-line reading binding and voice asset without changing words, cues, rules or the original draft', async () => {
    const s = await avgVoiceConfigurationFixtureV1(), before = structuredClone(s.workspace)
    const next = await applyAvgVoiceChoicesToDraftV1(s)
    expect(s.workspace).toEqual(before)
    expect(next.systemPlan).toEqual(before.systemPlan); expect(next.scripts).toEqual(before.scripts)
    expect(next.presentation.stage.cues).toEqual(before.presentation.stage.cues)
    expect(next.presentation.stage.assets).toEqual([s.choices[0]!.asset])
    expect(next.presentation.reading!.voices).toEqual([{ lineKey: 'line.desk', assetKey: 'voice.desk', text: '封口仍在。', textRevision: 1, speakerKey: 'keeper', locale: 'zh-CN' }])
    expect(await applyAvgVoiceChoicesToDraftV1({ ...s, workspace: next })).toEqual(next)
  })

  it('refuses stale source text/versions and the old choice after a same-text retake', async () => {
    const s = await avgVoiceConfigurationFixtureV1(), workspace = structuredClone(s.workspace)
    workspace.scripts[0]!.lines[0]!.text = '新的台词。'
    await expect(applyAvgVoiceChoicesToDraftV1({ ...s, workspace })).rejects.toThrow(/重新冻结/)
    await expect(applyAvgVoiceChoicesToDraftV1({ ...s, sourceScripts: [{ ...s.sourceScripts[0]!, version: 2 }] })).rejects.toThrow(/修订/)
    const assembly = structuredClone(s.assembly); assembly.voice.batch.requirements[0]!.performance.revision++
    await expect(applyAvgVoiceChoicesToDraftV1({ ...s, assembly })).rejects.toThrow(/演法/)
  })

  it('refuses missing/duplicate choices, wrong consumer/speaker and missing or wrong review references', async () => {
    const s = await avgVoiceConfigurationFixtureV1()
    for (const choices of [[], [...s.choices, ...s.choices], [{ ...s.choices[0]!, asset: { ...s.choices[0]!.asset, assetKey: 'voice.other' } }],
      [{ ...s.choices[0]!, asset: { ...s.choices[0]!.asset, characterTag: 'other' } }]]) {
      await expect(applyAvgVoiceChoicesToDraftV1({ ...s, choices })).rejects.toThrow()
    }
    for (const patch of [{ review: null }, { review: { ...s.choices[0]!.review, artifactKey: 'avg.review.audio.other' } }, { authorAccepted: true }]) {
      expect(() => parseAvgAuthorVoiceChoiceV1({ ...s.choices[0], ...patch })).toThrow()
    }
  })

  it('preserves unrelated bindings and refuses silently replacing another voice or binary version', async () => {
    const s = await avgVoiceConfigurationFixtureV1(), workspace = structuredClone(s.workspace)
    workspace.presentation.stage.assets.push({ ...s.choices[0]!.asset, assetKey: 'voice.other', characterTag: '', sceneTag: 'wait' })
    workspace.presentation.reading!.voices.push({ lineKey: 'line.wait', assetKey: 'voice.other', text: '你等待答复。', textRevision: 1, speakerKey: null, locale: 'zh-CN' })
    const next = await applyAvgVoiceChoicesToDraftV1({ ...s, workspace })
    expect(next.presentation.reading!.voices[0]).toEqual(workspace.presentation.reading!.voices[0])
    workspace.presentation.reading!.voices[0]!.lineKey = 'line.desk'
    await expect(applyAvgVoiceChoicesToDraftV1({ ...s, workspace })).rejects.toThrow(/已有其他配音/)
    const replaced = structuredClone(s.workspace), old = { ...s.choices[0]!.asset, contentHash: 'c'.repeat(64), blobContentHash: 'c'.repeat(64) }
    replaced.presentation.stage.assets.push(old)
    await expect(applyAvgVoiceChoicesToDraftV1({ ...s, workspace: replaced })).rejects.toThrow(/其他媒资版本/)
    await expect(applyAvgVoiceChoicesToDraftV1({ ...s, workspace: replaced, replaceableAssets: [{ assetKey: old.assetKey, contentHash: 'b'.repeat(64) }] })).rejects.toThrow()
    expect((await applyAvgVoiceChoicesToDraftV1({ ...s, workspace: replaced, replaceableAssets: [{ assetKey: old.assetKey, contentHash: old.contentHash }] })).presentation.stage.assets)
      .toEqual([s.choices[0]!.asset])
  })

  it('requires an explicit reading/failure policy and an adequate wait instead of silently raising author preferences', async () => {
    const s = await avgVoiceConfigurationFixtureV1(), missing = structuredClone(s.workspace)
    delete missing.presentation.reading
    await expect(applyAvgVoiceChoicesToDraftV1({ ...s, workspace: missing })).rejects.toThrow(/明确阅读/)
    s.workspace.presentation.reading!.maximumVoiceWaitMs = 1000
    await expect(applyAvgVoiceChoicesToDraftV1(s)).rejects.toThrow(/等待上限/)
    expect(s.workspace.presentation.reading!.maximumVoiceWaitMs).toBe(1000)
  })
})
