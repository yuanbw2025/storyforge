import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { freezeFormalAIEntryBindingV1, assertFormalAIEntrySnapshotIntegrityV1,
  executeFrozenFormalAudioEntryV1, executeFrozenFormalAIEntryV1, parseFormalAIEntryRegistryV1 } from '../../src/lib/agent/formal-ai-entry'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'

// The shared foundation is tested with a synthetic frozen registry. It does
// not depend on any new product entry, worker, model, database or credential.
async function audioBinding() {
  const skill = getAgentSkillV1('prose.ttrpg-open-kp'), old = await freezeFormalAIEntryBindingV1('ttrpg.open.kp')
  const body = { ...JSON.parse(old.bindingJson), entryId: 'harness.audio-test', outputModality: 'audio', categories: ['test.audio'], allowedCallers: ['fixture.ts'] }
  return { skill, body, snapshot: { version: 1 as const, entryId: body.entryId, bindingJson: canonicalStringify(body), bindingHash: await hashCanonicalValue(body) } }
}
describe('R-HARNESS114 explicit frozen audio output boundary', () => {
  it('preserves absent modality in legacy text bindings and validates explicit audio without adding adoption', async () => {
    const legacy = await freezeFormalAIEntryBindingV1('ttrpg.open.kp'), raw = JSON.parse(legacy.bindingJson)
    expect(raw).not.toHaveProperty('outputModality'); expect(await hashCanonicalValue(raw)).toBe(legacy.bindingHash)
    const a = await audioBinding()
    expect(await assertFormalAIEntrySnapshotIntegrityV1(a.snapshot, new Map([[a.skill.id, a.skill]]))).toMatchObject({ outputModality: 'audio', adoptAllowed: false })
    for (const patch of [{ outputModality: null }, { outputModality: 'video' }, { adoptAllowed: true }, { entryKind: 'experimental' }]) {
      expect(() => parseFormalAIEntryRegistryV1({ version: 2, bindingVersion: 1, scope: 'formal-ai-execution-entry', entries: [{ ...a.body, ...patch }] }, new Map([[a.skill.id, a.skill]]))).toThrow()
    }
  })
  it('blocks wrong caller/category/hash/Skill and text-to-audio substitution before the callback', async () => {
    const a = await audioBinding(), meta = { category: 'test.audio' }
    let calls = 0
    const invoke = async () => { calls++; return 'raw' }
    await expect(executeFrozenFormalAudioEntryV1(a.body.entryId, a.snapshot, a.skill, 'wrong.ts', invoke, meta)).rejects.toThrow(/caller/)
    await expect(executeFrozenFormalAudioEntryV1(a.body.entryId, a.snapshot, a.skill, 'fixture.ts', invoke, { category: 'other' })).rejects.toThrow(/category/)
    await expect(executeFrozenFormalAudioEntryV1(a.body.entryId, { ...a.snapshot, bindingHash: '0'.repeat(64) }, a.skill, 'fixture.ts', invoke, meta)).rejects.toThrow(/hash/)
    await expect(executeFrozenFormalAudioEntryV1(a.body.entryId, a.snapshot, { ...a.skill, id: 'another' }, 'fixture.ts', invoke, meta)).rejects.toThrow(/Skill/)
    const legacy = await freezeFormalAIEntryBindingV1('ttrpg.open.kp')
    await expect(executeFrozenFormalAudioEntryV1('ttrpg.open.kp', legacy, a.skill, 'src/lib/ttrpg/open-intent-harness.ts', invoke, { category: 'runtime.ttrpg-open.kp' })).rejects.toThrow(/音频入口/)
    await expect(executeFrozenFormalAIEntryV1(a.body.entryId, a.snapshot, a.skill, 'fixture.ts', [], {} as never, meta)).rejects.toThrow(/文本模型/)
    expect(calls).toBe(0)
  })
  it('checks cancellation and performs exactly one invocation without retrying failures', async () => {
    const a = await audioBinding(), controller = new AbortController(); controller.abort()
    let calls = 0
    const invoke = async () => { calls++; throw new Error('unknown-outcome') }
    await expect(executeFrozenFormalAudioEntryV1(a.body.entryId, a.snapshot, a.skill, 'fixture.ts', invoke, { category: 'test.audio' }, controller.signal)).rejects.toThrow()
    expect(calls).toBe(0)
    await expect(executeFrozenFormalAudioEntryV1(a.body.entryId, a.snapshot, a.skill, 'fixture.ts', invoke, { category: 'test.audio' })).rejects.toThrow('unknown-outcome')
    expect(calls).toBe(1)
  })
})
