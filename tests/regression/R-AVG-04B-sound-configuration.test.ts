import { describe, expect, it } from 'vitest'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { applyAvgSoundChoicesToDraftV1 } from '../../src/lib/avg/sound-configuration'
import { parseAvgAuthorSoundChoiceV1 } from '../../src/lib/avg/sound-choice-contract'
import { applyAvgVoiceChoicesToDraftV1 } from '../../src/lib/avg/voice-configuration'
import { applyAvgCue, EMPTY_AVG_STAGE } from '../../src/lib/avg/runtime'

describe('AVG-04B reviewable sound configuration preparation', () => {
  it('binds exact music and sound-effect assets to native Cue channels, preserving existing voice, rules, script and draft', async () => {
    const s = await avgSoundPlanningFixtureV1(), workspace = await applyAvgVoiceChoicesToDraftV1(s.voice)
    workspace.presentation.stage.assets.push({ ...s.choices[0]!.asset, assetKey: 'desk.background', kind: 'background',
      mimeType: 'image/png', width: 1280, height: 720, durationMs: null, byteSize: 100,
      source: '工程图像结构夹具，没有生成图片', license: '工程结构元数据，不是权利证明' })
    workspace.presentation.stage.cues.push({ cueKey: 'old.background', beatKey: 'line.desk', phase: 'before', type: 'set-background',
      assetKey: 'desk.background', durationMs: 0, easing: 'linear', order: 1 })
    const original = structuredClone(workspace), next = await applyAvgSoundChoicesToDraftV1({ ...s, workspace })
    expect(workspace).toEqual(original)
    expect(next.systemPlan).toEqual(original.systemPlan); expect(next.scripts).toEqual(original.scripts)
    expect(next.presentation.reading).toEqual(original.presentation.reading)
    expect(next.presentation.stage.assets).toEqual([...original.presentation.stage.assets, ...s.choices.map(c => c.asset)])
    expect(next.presentation.stage.cues.find(c => c.cueKey === 'old.background')?.assetKey).toBe('desk.background')
    expect(next.presentation.stage.cues.filter(c => c.type === 'play-audio').map(c => ({ key: c.cueKey, beat: c.beatKey, type: c.type, asset: c.assetKey, volume: c.volume, loop: c.loop })))
      .toEqual([{ key: 'cue.desk.bgm', beat: 'line.desk', type: 'play-audio', asset: 'sound.desk.bgm', volume: .2, loop: false },
        { key: 'cue.desk.sfx', beat: 'line.desk', type: 'play-audio', asset: 'sound.desk.sfx', volume: .6, loop: false }])
    expect(await applyAvgSoundChoicesToDraftV1({ ...s, workspace: next })).toEqual(next)
    const actual = next.presentation.stage.cues.reduce((state, cue) => applyAvgCue(state, cue, next.presentation.stage.assets, {}), structuredClone(EMPTY_AVG_STAGE))
    expect(actual.backgroundAssetKey).toBe('desk.background')
    expect(actual.activeAudio).toEqual([{ channel: 'bgm', assetKey: 'sound.desk.bgm', volume: .2, loop: false },
      { channel: 'sfx', assetKey: 'sound.desk.sfx', volume: .6, loop: false }])
  })

  it('requires complete unique choices and rejects another request, channel, scene, asset or unapproved authority field', async () => {
    const s = await avgSoundPlanningFixtureV1()
    for (const choices of [[], [s.choices[0], s.choices[0]], [{ ...s.choices[0], requirementKey: 'other' }, s.choices[1]],
      [{ ...s.choices[0], requestIdentityHash: '8'.repeat(64) }, s.choices[1]],
      [{ ...s.choices[0], asset: { ...s.choices[0]!.asset, sceneTag: 'other' } }, s.choices[1]],
      [{ ...s.choices[0], asset: { ...s.choices[0]!.asset, kind: 'sfx' } }, s.choices[1]],
      [{ ...s.choices[0], asset: { ...s.choices[0]!.asset, assetKey: 'other' } }, s.choices[1]],
      [{ ...s.choices[0], authorAccepted: true }, s.choices[1]]]) {
      await expect(applyAvgSoundChoicesToDraftV1({ ...s, choices })).rejects.toThrow()
    }
  })

  it('rejects missing/wrong raw or review references, bad byte metadata and a music duration from another request', async () => {
    const s = await avgSoundPlanningFixtureV1()
    for (const patch of [{ review: null }, { raw: { ...s.choices[0]!.raw, artifactKey: 'avg.sound.raw.other' } },
      { review: { ...s.choices[0]!.review, artifactKey: 'avg.review.audio.other' } },
      { asset: { ...s.choices[0]!.asset, mimeType: 'audio/mpeg' } }, { asset: { ...s.choices[0]!.asset, byteSize: 32 * 1024**2 + 1 } }]) {
      expect(() => parseAvgAuthorSoundChoiceV1({ ...s.choices[0], ...patch })).toThrow()
    }
    await expect(applyAvgSoundChoicesToDraftV1({ ...s, choices: [{ ...s.choices[0], asset: { ...s.choices[0]!.asset, durationMs: 30_000 } }, s.choices[1]] }))
      .rejects.toThrow(/实际时长/)
  })

  it('preserves existing unrelated Cues and refuses silently replacing an existing Cue or asset version', async () => {
    const s = await avgSoundPlanningFixtureV1(), next = await applyAvgSoundChoicesToDraftV1(s)
    next.presentation.stage.cues.push({ cueKey: 'old.wait', beatKey: 'line.wait', phase: 'before', type: 'wait', durationMs: 100, easing: 'linear', order: 1 })
    const preserved = await applyAvgSoundChoicesToDraftV1({ ...s, workspace: next })
    expect(preserved.presentation.stage.cues.find(c => c.cueKey === 'old.wait')?.durationMs).toBe(100)
    const changedCue = structuredClone(next); changedCue.presentation.stage.cues[0]!.volume = .9
    await expect(applyAvgSoundChoicesToDraftV1({ ...s, workspace: changedCue })).rejects.toThrow(/不能覆盖/)
    const changedAsset = structuredClone(next), asset = changedAsset.presentation.stage.assets[0]!
    asset.contentHash = '9'.repeat(64); asset.blobContentHash = '9'.repeat(64)
    await expect(applyAvgSoundChoicesToDraftV1({ ...s, workspace: changedAsset })).rejects.toThrow(/不能覆盖/)
  })

  it('rejects changed canonical words and new mix settings paired with the old choice instead of silently reusing stale audio', async () => {
    const s = await avgSoundPlanningFixtureV1(), workspace = structuredClone(s.workspace)
    workspace.scripts[0]!.lines[0]!.text += '另一句。'
    await expect(applyAvgSoundChoicesToDraftV1({ ...s, workspace })).rejects.toThrow(/重新冻结/)
    const scope = structuredClone(s.scope); scope.templates[0]!.cue.volume = .3
    await expect(applyAvgSoundChoicesToDraftV1({ ...s, scope })).rejects.toThrow(/请求/)
  })

  it('refuses an existing different Cue on the same beat/channel even when another Cue key and order would hide the overwrite', async () => {
    const s = await avgSoundPlanningFixtureV1(), workspace = await applyAvgSoundChoicesToDraftV1(s)
    workspace.presentation.stage.cues[0]!.cueKey = 'existing.bgm'; workspace.presentation.stage.cues[0]!.order = 1
    const before = structuredClone(workspace)
    await expect(applyAvgSoundChoicesToDraftV1({ ...s, workspace })).rejects.toThrow(/通道已有其它声音/)
    expect(workspace).toEqual(before)
  })

  it('retains the declared original OGG member without transcoding or pretending a different raw hash is the licensed source', async () => {
    const s = await avgSoundPlanningFixtureV1(), next = await applyAvgSoundChoicesToDraftV1(s)
    const effect = next.presentation.stage.assets.find(a => a.assetKey === 'sound.desk.sfx')!
    expect(effect.mimeType).toBe('audio/ogg')
    expect(effect.contentHash).toBe(s.scope.librarySources[0]!.memberHash)
    expect(effect.blobContentHash).toBe(s.scope.librarySources[0]!.memberHash)
    expect(effect).toEqual(s.choices[1]!.asset)
  })

  it('rejects an internally consistent wrong library member or silent format conversion, and rejects OGG as generated music', async () => {
    const s = await avgSoundPlanningFixtureV1(), wrong = structuredClone(s.choices)
    wrong[1]!.asset.contentHash = '5'.repeat(64); wrong[1]!.asset.blobContentHash = '5'.repeat(64); wrong[1]!.raw.contentHash = '5'.repeat(64)
    await expect(applyAvgSoundChoicesToDraftV1({ ...s, choices: wrong })).rejects.toThrow(/来源原字节/)
    const converted = structuredClone(s.choices); converted[1]!.asset.mimeType = 'audio/wav'
    await expect(applyAvgSoundChoicesToDraftV1({ ...s, choices: converted })).rejects.toThrow(/来源原字节/)
    const music = structuredClone(s.choices); music[0]!.asset.mimeType = 'audio/ogg'
    await expect(applyAvgSoundChoicesToDraftV1({ ...s, choices: music })).rejects.toThrow(/音乐格式/)
  })
})
