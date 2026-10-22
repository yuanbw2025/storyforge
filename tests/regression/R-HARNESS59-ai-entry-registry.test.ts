import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FORMAL_AI_ENTRY_REGISTRY_V1,
  assertFormalAIEntryCallV1,
  parseFormalAIEntryRegistryV1,
  freezeFormalAIEntryBindingV1,
  assertFormalAIEntrySnapshotIntegrityV1,
  executeFrozenFormalAudioEntryV1,
  executeFrozenFormalAIEntryV1,
  executeRegisteredAIEntryV1,
  streamRegisteredAIEntryV1,
} from '../../src/lib/agent/formal-ai-entry'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { hashCanonicalValue, canonicalStringify } from '../../src/lib/agent/run/hash'

interface Entry {
  entryId: string
  skillId: string
  entryKind: 'formal' | 'auxiliary' | 'evaluation' | 'experimental'
  adoptAllowed: boolean
  adoptionTargets?: string[]
  allowedCallers: string[]
}

const registry = JSON.parse(readFileSync('src/lib/agent/ai-entry-registry.json', 'utf8')) as {
  version: number
  entries: Entry[]
}

describe('R-HARNESS59 / WEH-0H · 正式 AI 入口机器绑定', () => {
  it('音频模式显式冻结，旧文本绑定没有新增默认字段或改变 hash', async () => {
    const old = await freezeFormalAIEntryBindingV1('ttrpg.open.kp'), oldBody = JSON.parse(old.bindingJson)
    expect(oldBody).not.toHaveProperty('outputModality')
    expect(old.bindingHash).toBe(await hashCanonicalValue(oldBody))
    expect(canonicalStringify(oldBody)).toBe(old.bindingJson)
    expect(await assertFormalAIEntrySnapshotIntegrityV1(old)).not.toHaveProperty('outputModality')
    const audio = await freezeFormalAIEntryBindingV1('ttrpg.open.local-voice')
    expect(await assertFormalAIEntrySnapshotIntegrityV1(audio)).toMatchObject({ outputModality: 'audio', adoptAllowed: false })
    for (const patch of [{ outputModality: null }, { outputModality: 'video' }, { outputModality: 'audio', adoptAllowed: true }, { outputModality: 'audio', entryKind: 'evaluation' }]) {
      const value = JSON.parse(JSON.stringify(registry)), row = value.entries.find((e: Entry) => e.entryId === 'ttrpg.open.local-voice')
      Object.assign(row, patch); expect(() => parseFormalAIEntryRegistryV1(value)).toThrow()
    }
  })
  it('冻结音频执行先校验 Skill/caller/category/模式和取消，回调没有重试或采用权', async () => {
    const entry = await freezeFormalAIEntryBindingV1('ttrpg.open.local-voice'), skill = getAgentSkillV1('prose.ttrpg-open-local-voice')
    let calls = 0
    const invoke = async () => { calls++; return 'raw-only' }, caller = 'src/lib/ttrpg/open-voice-execution.ts', meta = { category: 'runtime.ttrpg-open.local-voice' }
    await expect(executeFrozenFormalAudioEntryV1('ttrpg.open.local-voice', entry, skill, 'another.ts', invoke, meta)).rejects.toThrow(/caller/)
    await expect(executeFrozenFormalAudioEntryV1('ttrpg.open.local-voice', entry, skill, caller, invoke, { category: 'runtime.ttrpg-open.kp' })).rejects.toThrow(/category/)
    await expect(executeFrozenFormalAudioEntryV1('ttrpg.open.local-voice', { ...entry, bindingHash: '0'.repeat(64) }, skill, caller, invoke, meta)).rejects.toThrow(/hash/)
    const controller = new AbortController(); controller.abort()
    await expect(executeFrozenFormalAudioEntryV1('ttrpg.open.local-voice', entry, skill, caller, invoke, meta, controller.signal)).rejects.toThrow()
    const text = await freezeFormalAIEntryBindingV1('ttrpg.open.kp')
    await expect(executeFrozenFormalAudioEntryV1('ttrpg.open.kp', text, getAgentSkillV1('prose.ttrpg-open-kp'), 'src/lib/ttrpg/open-intent-harness.ts', invoke, { category: 'runtime.ttrpg-open.kp' })).rejects.toThrow(/音频入口/)
    expect(calls).toBe(0)
    expect(await executeFrozenFormalAudioEntryV1('ttrpg.open.local-voice', entry, skill, caller, invoke, meta)).toBe('raw-only'); expect(calls).toBe(1)
    await expect(executeRegisteredAIEntryV1('ttrpg.open.local-voice', [], {} as never, meta)).rejects.toThrow(/文本模型/)
    await expect(executeFrozenFormalAIEntryV1('ttrpg.open.local-voice', entry, skill, caller, [], {} as never, meta)).rejects.toThrow(/文本模型/)
    await expect(streamRegisteredAIEntryV1([], {} as never, { ...meta, formalEntryId: 'ttrpg.open.local-voice' }).next()).rejects.toThrow(/文本模型/)
  })
  it('AST 守卫证明实际 member/alias/wrapper 调用均携带登记 entryId', () => {
    const output = execFileSync(process.execPath, ['scripts/check-ai-entry-registry.mjs'], { encoding: 'utf8' })
    expect(output).toContain('60 bindings / 64 calls')
    expect(output).toContain('formal 38, auxiliary 15, evaluation 6, experimental 1')
  })

  it('唯一注册表严格解析且每项连接 Skill、执行器、候选和调用方', () => {
    expect(registry.version).toBe(2)
    expect(FORMAL_AI_ENTRY_REGISTRY_V1.entries).toHaveLength(60)
    for (const retiredId of ['world.setting.lookup.qa', 'world.setting.lookup.extract']) {
      expect(FORMAL_AI_ENTRY_REGISTRY_V1.entries.some(entry => entry.entryId === retiredId)).toBe(false)
    }
    for (const entry of FORMAL_AI_ENTRY_REGISTRY_V1.entries) {
      expect(entry.skillId).not.toBe('')
      expect(entry.runContractBuilderId).not.toBe('')
      expect(entry.candidateKind).not.toBe('')
      expect(entry.allowedCallers.length).toBeGreaterThan(0)
    }
  })

  it('跑团七个正式入口仅通过唯一 Harness 输出候选，没有模型自行采纳权限', () => {
    for (const purpose of ['intent', 'companion', 'kp', 'oracle-interpret', 'fact-normalize', 'brief', 'situation-propose']) {
      const entry = FORMAL_AI_ENTRY_REGISTRY_V1.entries.find(entry => entry.entryId === `ttrpg.open.${purpose}`)!
      expect(entry).toMatchObject({ entryKind: 'formal', executionBoundary: 'product-runtime', adoptAllowed: false,
        categories: [`runtime.ttrpg-open.${purpose}`], allowedCallers: ['src/lib/ttrpg/open-intent-harness.ts'] })
      expect(entry.adoptionTargets).toEqual([])
      expect(entry.skillId).toBe(`prose.ttrpg-open-${purpose}`)
      expect(entry.candidateKind).toBe(['intent', 'companion'].includes(purpose) ? 'storyforge.ttrpg-open-intent-candidate' : purpose === 'kp' ? 'storyforge.ttrpg-open-kp-candidate' : purpose === 'brief' ? 'storyforge.ttrpg-open-brief-candidate' : purpose === 'situation-propose' ? 'storyforge.ttrpg-open-situation-candidate' : 'storyforge.ttrpg-open-oracle-candidate')
    }
  })
  it('新增共同局势和实体入口仍仅输出各自候选，不继承机械采用权限', () => {
    for (const [purpose, candidateKind] of [['public-situation-propose', 'storyforge.ttrpg-open-public-situation-candidate'], ['entity-propose', 'storyforge.ttrpg-open-entity-candidate']]) {
      const entry = FORMAL_AI_ENTRY_REGISTRY_V1.entries.find(e => e.entryId === `ttrpg.open.${purpose}`)
      expect(entry).toMatchObject({ skillId: `prose.ttrpg-open-${purpose}`, candidateKind,
        entryKind: 'formal', executionBoundary: 'product-runtime', adoptAllowed: false, adoptionTargets: [],
        categories: [`runtime.ttrpg-open.${purpose}`], allowedCallers: ['src/lib/ttrpg/open-intent-harness.ts'] })
    }
  })
  it('共同 Oracle 解释使用自己的只读候选入口，不能借用私域解释或作者采纳权限', () => {
    const entry = FORMAL_AI_ENTRY_REGISTRY_V1.entries.find(e => e.entryId === 'ttrpg.open.common-oracle-interpret')
    expect(entry).toMatchObject({ skillId: 'prose.ttrpg-open-common-oracle-interpret', candidateKind: 'storyforge.ttrpg-open-common-oracle-candidate',
      entryKind: 'formal', executionBoundary: 'product-runtime', adoptAllowed: false, adoptionTargets: [],
      categories: ['runtime.ttrpg-open.common-oracle-interpret'], allowedCallers: ['src/lib/ttrpg/open-intent-harness.ts'] })
    expect(() => assertFormalAIEntryCallV1({ formalEntryId: 'ttrpg.open.common-oracle-interpret', category: 'runtime.ttrpg-open.oracle-interpret' })).toThrow(/不允许 category/)
  })

  it('辅助、评测和实验入口由机器权限证明不可采纳', () => {
    const nonFormal = registry.entries.filter(entry => entry.entryKind !== 'formal')
    expect(nonFormal.length).toBeGreaterThan(0)
    expect(nonFormal.every(entry => entry.adoptAllowed === false)).toBe(true)
    expect(nonFormal.every(entry => (entry.adoptionTargets?.length ?? 0) === 0)).toBe(true)
  })

  it('有限语音扩展不进入正式执行器，旧冻结注册表仍可严格解析', () => {
    const full = JSON.parse(JSON.stringify(registry))
    expect(() => parseFormalAIEntryRegistryV1(full)).not.toThrow()
    expect(FORMAL_AI_ENTRY_REGISTRY_V1.entries.some((entry) => entry.entryId.startsWith('longform.voice'))).toBe(false)
    delete full.limitedTransports
    expect(parseFormalAIEntryRegistryV1(full).entries).toHaveLength(60)
    const legacy = { ...full, entries: full.entries.filter((entry: Entry) => !['ttrpg.open.local-voice', 'ttrpg.open.brief', 'ttrpg.open.situation-propose', 'ttrpg.open.public-situation-propose', 'ttrpg.open.entity-propose', 'ttrpg.open.common-oracle-interpret', 'ttrpg.open.authoring-design', 'ttrpg.open.authoring-design.full'].includes(entry.entryId)) }
    expect(parseFormalAIEntryRegistryV1(legacy).entries).toHaveLength(52)
    expect(legacy.entries.some((entry: Entry) => entry.entryId.startsWith('ttrpg.open.authoring-design'))).toBe(false)
    for (const patch of [{ adoptAllowed: true }, { adoptionTargets: ['chapters'] }, { boundary: 'durable-run' }]) {
      const invalid = JSON.parse(JSON.stringify(registry))
      Object.assign(invalid.limitedTransports[0], patch)
      expect(() => parseFormalAIEntryRegistryV1(invalid)).toThrow(/有限语音/)
    }
  })

  it('unknown entry 和错配 category 在发起 provider 请求前 fail closed', () => {
    expect(() => assertFormalAIEntryCallV1({
      formalEntryId: 'unknown.entry',
      category: 'chapter.content',
    })).toThrow(/未登记正式 AI 入口/)
    expect(() => assertFormalAIEntryCallV1({
      formalEntryId: 'prose.chapter.generate',
      category: 'chapter.continue',
    })).toThrow(/不允许 category/)
  })

  it('删除 Skill 绑定、非法开放辅助采纳和未知 schema 字段均被拒绝', () => {
    const base = JSON.parse(JSON.stringify(registry)) as typeof registry
    const unknownSkill = JSON.parse(JSON.stringify(base)) as typeof registry
    unknownSkill.entries[0].skillId = 'missing.skill'
    expect(() => parseFormalAIEntryRegistryV1(unknownSkill)).toThrow(/未知 Skill/)

    const auxiliaryWrite = JSON.parse(JSON.stringify(base)) as typeof registry
    const auxiliary = auxiliaryWrite.entries.find(entry => entry.entryKind === 'auxiliary')!
    auxiliary.adoptAllowed = true
    auxiliary.adoptionTargets = ['chapters']
    expect(() => parseFormalAIEntryRegistryV1(auxiliaryWrite)).toThrow(/不得开放采纳/)

    const unknownField = JSON.parse(JSON.stringify(base)) as typeof registry & { surprise?: boolean }
    unknownField.surprise = true
    expect(() => parseFormalAIEntryRegistryV1(unknownField)).toThrow(/未知或缺失字段/)
  })

  it('正式写入口的 adoptionTargets 与 Skill 写集合机验一致', () => {
    const writable = FORMAL_AI_ENTRY_REGISTRY_V1.entries.filter(entry => entry.adoptAllowed)
    expect(writable.map(entry => entry.entryId)).toEqual(expect.arrayContaining([
      'prose.chapter.generate',
      'outline.volume.generate',
      'outline.detail.scene',
    ]))
    expect(writable.every(entry => entry.adoptionTargets.length > 0)).toBe(true)
  })
})
