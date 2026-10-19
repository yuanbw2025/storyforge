import { avgVoiceConfigurationFixtureV1 } from './avg-voice-production-fixture'
import { freezeAvgSoundPlanningScopeV1 } from '../../src/lib/avg/sound-source'
import { compileAvgSoundRequirementsV1 } from '../../src/lib/avg/sound-requirements'
import type { AvgSoundPlanV1 } from '../../src/lib/avg/sound-plan-contract'
import type { AvgSoundTemplateV1 } from '../../src/lib/avg/sound-scope-contract'
import type { AvgAuthorSoundChoiceV1 } from '../../src/lib/avg/sound-choice-contract'

/** Pure metadata fixture. No Work/Run, actual audio, licence proof, hearing or
 * producer/adoption receipt is manufactured or claimed by this helper. */
export async function avgSoundPlanningFixtureV1() {
  const voice = await avgVoiceConfigurationFixtureV1(), workspace = voice.workspace
  const template = (channel: 'bgm' | 'sfx', order: number): AvgSoundTemplateV1 => ({
    requirementKey: `desk.${channel}`, assetKey: `sound.desk.${channel}`, channel, purpose: '工程声音需求', constraints: ['不要遮盖对白'],
    consumer: { consumerKey: `consumer.desk.${channel}`, domain: 'stage', slot: channel, subjectKey: 'desk', sceneKey: 'desk',
      lineKey: null, required: true, fallback: 'none' },
    cue: { cueKey: `cue.desk.${channel}`, beatKey: 'line.desk', phase: 'before', order, volume: channel === 'bgm' ? .2 : .6, loop: false },
    source: channel === 'bgm' ? { kind: 'generate-music', durationSeconds: 12, seed: 103, bpm: 68, keyscale: 'A Minor' }
      : { kind: 'licensed-library', allowedSourceKeys: ['fixture.click'] } })
  const scope = await freezeAvgSoundPlanningScopeV1({ schema: 'storyforge.avg.sound-planning-scope', version: 1,
    templates: [template('bgm', 10), template('sfx', 11)], librarySources: [{ sourceKey: 'fixture.click',
      publisherPage: 'https://kenney.nl/assets/interface-sounds', license: 'CC0-1.0', archiveHash: '1'.repeat(64),
      memberPath: 'Audio/click_001.ogg', memberHash: '2'.repeat(64) }] }, workspace)
  const plan: AvgSoundPlanV1 = { schema: 'storyforge.avg.sound-plan', version: 1,
    direction: { goal: '静谧的对话氛围', dialogueSpace: '为对白留白', continuity: '保持场景连续' },
    entries: [{ requirementKey: 'desk.bgm', designIntent: '平稳的背景', prompt: 'Sparse original instrumental piano, space for dialogue.',
      librarySourceKey: null, acceptanceNotes: ['检查是否出现人声'] }, { requirementKey: 'desk.sfx', designIntent: '轻提示',
      prompt: null, librarySourceKey: 'fixture.click', acceptanceNotes: ['检查点击声与操作同步'] }] }
  const compiled = await compileAvgSoundRequirementsV1(scope, plan)
  const choices: AvgAuthorSoundChoiceV1[] = compiled.requirements.map(request => {
    const t = request.template, asset = { ...voice.choices[0]!.asset, assetKey: t.assetKey, kind: t.channel,
      characterTag: '', sceneTag: t.consumer.sceneKey!, durationMs: t.channel === 'bgm' ? 12_000 : 500,
      mimeType: t.channel === 'bgm' ? 'audio/wav' : 'audio/ogg',
      contentHash: (t.channel === 'bgm' ? '4' : '2').repeat(64), blobContentHash: (t.channel === 'bgm' ? '4' : '2').repeat(64),
      byteSize: t.channel === 'bgm' ? 2_304_044 : 6500 }
    return { schema: 'storyforge.avg.sound-choice', version: 1, requirementKey: t.requirementKey, requestIdentityHash: request.identityHash,
      raw: { artifactKey: `avg.sound.raw.${t.requirementKey}`, version: 1, contentHash: asset.contentHash },
      review: { artifactKey: `avg.review.audio.${t.requirementKey}`, version: 1, contentHash: '3'.repeat(64) }, asset,
      declaration: '纯结构夹具；不是原始producer、音频或作者采用凭证' }
  })
  return { workspace, scope, plan, compiled, choices, voice }
}
