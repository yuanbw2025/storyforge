import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FORMAL_AI_ENTRY_REGISTRY_V1,
  assertFormalAIEntryCallV1,
  parseFormalAIEntryRegistryV1,
} from '../../src/lib/agent/formal-ai-entry'

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
  it('AST 守卫证明实际 member/alias/wrapper 调用均携带登记 entryId', () => {
    const output = execFileSync(process.execPath, ['scripts/check-ai-entry-registry.mjs'], { encoding: 'utf8' })
    expect(output).toContain('36 bindings / 40 calls')
    expect(output).toContain('formal 16, auxiliary 15, evaluation 4, experimental 1')
  })

  it('唯一注册表严格解析且每项连接 Skill、执行器、候选和调用方', () => {
    expect(registry.version).toBe(2)
    expect(FORMAL_AI_ENTRY_REGISTRY_V1.entries).toHaveLength(36)
    for (const entry of FORMAL_AI_ENTRY_REGISTRY_V1.entries) {
      expect(entry.skillId).not.toBe('')
      expect(entry.runContractBuilderId).not.toBe('')
      expect(entry.candidateKind).not.toBe('')
      expect(entry.allowedCallers.length).toBeGreaterThan(0)
    }
  })

  it('辅助、评测和实验入口由机器权限证明不可采纳', () => {
    const nonFormal = registry.entries.filter(entry => entry.entryKind !== 'formal')
    expect(nonFormal.length).toBeGreaterThan(0)
    expect(nonFormal.every(entry => entry.adoptAllowed === false)).toBe(true)
    expect(nonFormal.every(entry => (entry.adoptionTargets?.length ?? 0) === 0)).toBe(true)
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
