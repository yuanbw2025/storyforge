import { describe, expect, it } from 'vitest'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { parseAvgProfessionalArtifactV1, prepareAvgProfessionalArtifactV1 } from '../../src/lib/avg/artifact-contract'
import { parseAvgSoundPlanV1 } from '../../src/lib/avg/sound-plan-contract'
import { parseAvgSoundPlanningScopeV1 } from '../../src/lib/avg/sound-scope-contract'
import { compileAvgSoundRequirementsV1 } from '../../src/lib/avg/sound-requirements'
import { freezeAvgSoundPlanningScopeV1, validateAvgSoundPlanningSourcesV1 } from '../../src/lib/avg/sound-source'

describe('AVG-04B frozen sound plan preparation contracts', () => {
  it('prepares the reserved sound output through the existing professional candidate boundary, without self-authorizing writes', async () => {
    const s = await avgSoundPlanningFixtureV1()
    expect(parseAvgProfessionalArtifactV1(s.plan)).toEqual(s.plan)
    const result = prepareAvgProfessionalArtifactV1({ artifactKey: 'avg.media.sound-plan', kind: 'narrative', payload: s.plan,
      allowedOutputKeys: ['avg.media.sound-plan'] })
    expect(result.agentId).toBe('avg-sound-director'); expect(result.skillId).toBe('avg.sound-plan.v1')
    expect(() => prepareAvgProfessionalArtifactV1({ artifactKey: 'avg.media.sound-plan', kind: 'narrative', payload: s.plan, allowedOutputKeys: [] })).toThrow(/写域/)
    expect(() => prepareAvgProfessionalArtifactV1({ artifactKey: 'avg.media.sound-plan', kind: 'audio', payload: s.plan, allowedOutputKeys: ['avg.media.sound-plan'] })).toThrow(/kind/)
  })

  it('compiles exact music wire fields and a separate licensed import without exposing mutable Cue, source or licence selection to a model', async () => {
    const s = await avgSoundPlanningFixtureV1(), before = structuredClone({ scope: s.scope, plan: s.plan })
    const music = s.compiled.requirements[0]!, library = s.compiled.requirements[1]!
    expect(music.dispatch.operation).toBe('generate-music')
    if (music.dispatch.operation !== 'generate-music') throw new Error('wrong test branch')
    expect(music.dispatch.body).toEqual({ caption: `${s.plan.entries[0]!.prompt}\nConstraints:\n不要遮盖对白`, durationSeconds: 12, seed: 103, bpm: 68, keyscale: 'A Minor' })
    expect(music.dispatch.model).toBe('ACE-Step/Ace-Step1.5@19671f406d603126926c1b7e2adc169acbcade22')
    expect(music.dispatch.runtimeCodeRevision).toBe('ca1e85fe9430179831e6bc6be790c332190a3866')
    expect(library.dispatch).toEqual({ operation: 'import-licensed-audio', source: s.scope.librarySources[0] })
    expect(await compileAvgSoundRequirementsV1(s.scope, s.plan)).toEqual(s.compiled)
    expect({ scope: s.scope, plan: s.plan }).toEqual(before)
  })

  it('rejects extra authority, malformed choices, control characters, sparse/duplicate entries and overlong music prompts', async () => {
    const s = await avgSoundPlanningFixtureV1()
    for (const patch of [{ owner: 'world' }, { authorAccepted: true }, { version: 2 }, { entries: [] }, { entries: [...s.plan.entries, s.plan.entries[0]] },
      { entries: [{ ...s.plan.entries[0], prompt: '\0bad' }] }, { entries: [{ ...s.plan.entries[0], prompt: '😀'.repeat(257) }] },
      { entries: [{ ...s.plan.entries[0], prompt: '\ud800' }] },
      { entries: [{ ...s.plan.entries[0], librarySourceKey: 'fixture.click' }] }]) {
      expect(() => parseAvgSoundPlanV1({ ...s.plan, ...patch })).toThrow()
    }
    const sparse = new Array(1)
    expect(() => parseAvgSoundPlanV1({ ...s.plan, entries: sparse })).toThrow(/稀疏/)
  })

  it('compiles canonical NFC music wire bytes so equivalent plan hashes cannot dispatch different captions', async () => {
    const s = await avgSoundPlanningFixtureV1(), a = structuredClone(s.plan), b = structuredClone(s.plan)
    a.entries[0]!.prompt = 'Original café piano'; b.entries[0]!.prompt = 'Original cafe\u0301 piano'
    const first = await compileAvgSoundRequirementsV1(s.scope, a), second = await compileAvgSoundRequirementsV1(s.scope, b)
    expect(first.planHash).toBe(second.planHash)
    expect(first.requirements[0]!.identityHash).toBe(second.requirements[0]!.identityHash)
    expect(first.requirements[0]!.dispatch).toEqual(second.requirements[0]!.dispatch)
  })

  it('always delivers the exact frozen constraints and rejects a combined prompt over the actual provider limit without truncation', async () => {
    const s = await avgSoundPlanningFixtureV1(), plan = structuredClone(s.plan)
    plan.entries[0]!.prompt = 'p'.repeat(512)
    expect(parseAvgSoundPlanV1(plan).entries[0]!.prompt?.length).toBe(512)
    await expect(compileAvgSoundRequirementsV1(s.scope, plan)).rejects.toThrow(/不会截断/)
    expect(plan.entries[0]!.prompt).toHaveLength(512)
  })

  it('checks the complete wire caption, including malformed frozen constraints, before any provider dispatch can exist', async () => {
    const s = await avgSoundPlanningFixtureV1()
    for (const constraint of ['bad\0constraint', 'bad\ud800constraint']) {
      const scope = structuredClone(s.scope); scope.templates[0]!.constraints = [constraint]
      await expect(compileAvgSoundRequirementsV1(scope, s.plan)).rejects.toThrow(/控制字符或无效Unicode/)
    }
  })

  it('requires exact coverage and freezes semantic edits and technical/source changes into request identities', async () => {
    const s = await avgSoundPlanningFixtureV1()
    await expect(compileAvgSoundRequirementsV1(s.scope, { ...s.plan, entries: [s.plan.entries[0]] })).rejects.toThrow(/覆盖/)
    await expect(compileAvgSoundRequirementsV1(s.scope, { ...s.plan, entries: [{ ...s.plan.entries[0], requirementKey: 'other' }, s.plan.entries[1]] })).rejects.toThrow(/覆盖/)
    const edited = structuredClone(s.plan); edited.entries[0]!.prompt += ' Softer.'
    expect((await compileAvgSoundRequirementsV1(s.scope, edited)).requirements[0]!.identityHash).not.toBe(s.compiled.requirements[0]!.identityHash)
    const changed = structuredClone(s.scope); changed.templates[0]!.cue.volume = .3
    expect((await compileAvgSoundRequirementsV1(changed, s.plan)).requirements[0]!.identityHash).not.toBe(s.compiled.requirements[0]!.identityHash)
    changed.librarySources[0]!.memberHash = '4'.repeat(64)
    expect((await compileAvgSoundRequirementsV1(changed, s.plan)).requirements[1]!.identityHash).not.toBe(s.compiled.requirements[1]!.identityHash)
  })

  it('rejects unlicensed/foreign/traversal source declarations and missing or extra source catalogue members', async () => {
    const s = await avgSoundPlanningFixtureV1()
    for (const patch of [{ license: 'unknown' }, { publisherPage: 'https://example.invalid/assets/test' },
      { publisherPage: 'https://key@kenney.nl/assets/interface-sounds' }, { publisherPage: 'https://kenney.nl/assets/interface-sounds?key=value' },
      { memberPath: '../outside.wav' }, { memberPath: 'Audio/../../outside.wav' }, { memberPath: 'C:\\outside.wav' }, { memberPath: 'Logos/logo.png' }]) {
      expect(() => parseAvgSoundPlanningScopeV1({ ...s.scope, librarySources: [{ ...s.scope.librarySources[0], ...patch }] })).toThrow()
    }
    expect(() => parseAvgSoundPlanningScopeV1({ ...s.scope, librarySources: [] })).toThrow(/闭集/)
    expect(() => parseAvgSoundPlanningScopeV1({ ...s.scope, librarySources: [...s.scope.librarySources, { ...s.scope.librarySources[0], sourceKey: 'extra' }] })).toThrow(/闭集/)
    const wrong = structuredClone(s.plan); wrong.entries[1]!.librarySourceKey = 'extra'
    await expect(compileAvgSoundRequirementsV1(s.scope, wrong)).rejects.toThrow(/允许/)
  })

  it('rejects unknown, conflicting or unsupported channel/source/technical settings before execution', async () => {
    const s = await avgSoundPlanningFixtureV1()
    for (const patch of [{ channel: 'voice' }, { consumer: { ...s.scope.templates[0]!.consumer, slot: 'sfx' } },
      { source: { ...s.scope.templates[0]!.source, durationSeconds: 600 } }, { source: { ...s.scope.templates[0]!.source, seed: true } },
      { source: { ...s.scope.templates[0]!.source, bpm: 0 } }, { cue: { ...s.scope.templates[0]!.cue, volume: 2 } }]) {
      expect(() => parseAvgSoundPlanningScopeV1({ ...s.scope, templates: [{ ...s.scope.templates[0], ...patch }, s.scope.templates[1]] })).toThrow()
    }
    const loop = structuredClone(s.scope); loop.templates[1]!.cue.loop = true
    expect(() => parseAvgSoundPlanningScopeV1(loop)).toThrow(/循环/)
    const alias = structuredClone(s.scope); alias.templates[1]!.assetKey = alias.templates[0]!.assetKey
    expect(() => parseAvgSoundPlanningScopeV1(alias)).toThrow(/重复/)
  })

  it('binds the actual canonical script/scene/beat and fails stale source changes without altering either source', async () => {
    const s = await avgSoundPlanningFixtureV1()
    expect(await validateAvgSoundPlanningSourcesV1(s.scope, s.workspace)).toEqual(s.scope)
    const edited = structuredClone(s.workspace); edited.scripts[0]!.lines[0]!.text += ' 改写。'
    await expect(validateAvgSoundPlanningSourcesV1(s.scope, edited)).rejects.toThrow(/重新冻结/)
    for (const patch of [{ consumer: { ...s.scope.templates[0]!.consumer, sceneKey: 'missing' } },
      { consumer: { ...s.scope.templates[0]!.consumer, subjectKey: 'keeper' } }, { cue: { ...s.scope.templates[0]!.cue, beatKey: 'unknown' } }]) {
      await expect(validateAvgSoundPlanningSourcesV1({ ...s.scope, templates: [{ ...s.scope.templates[0], ...patch }, s.scope.templates[1]] }, s.workspace)).rejects.toThrow(/规范场景/)
    }
  })

  it('refuses two simultaneous requests for a single runtime channel even with distinct consumer/Cue/order identities', async () => {
    const s = await avgSoundPlanningFixtureV1(), scope = structuredClone(s.scope)
    scope.templates[1] = { ...scope.templates[0]!, requirementKey: 'other.music', assetKey: 'other.music',
      consumer: { ...scope.templates[0]!.consumer, consumerKey: 'other.music' }, cue: { ...scope.templates[0]!.cue, cueKey: 'other.music', order: 99 } }
    scope.librarySources = []
    expect(() => parseAvgSoundPlanningScopeV1(scope)).toThrow(/同拍同阶段/)
  })

  it('rejects a globally ambiguous beat clock even when a recomputed source hash and local scene lookup would otherwise agree', async () => {
    const s = await avgSoundPlanningFixtureV1(), source = structuredClone(s.workspace)
    source.scripts[1]!.lines[0]!.lineKey = 'line.desk'; source.scripts[1]!.lines[0]!.beatKey = 'line.desk'
    await expect(freezeAvgSoundPlanningScopeV1({ schema: s.scope.schema, version: 1, templates: s.scope.templates,
      librarySources: s.scope.librarySources }, source)).rejects.toThrow(/规范场景/)
  })
})
