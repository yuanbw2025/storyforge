import { describe, expect, it } from 'vitest'
import {
  AGENT_SKILLS,
  getAgentSkillV1,
  getDefaultAgentSkillV1,
  TEXT_ADVENTURE_PRODUCTION_AGENT_IDS,
} from '../../src/lib/agent/skill-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

const LEGACY_TEXT_ADVENTURE_SKILLS = [
  'text-adventure.production-architecture.v1',
  'text-adventure.production-mainline.v1',
  'text-adventure.production-systems.v1',
  'text-adventure.production-side-quests.v1',
  'text-adventure.production-ambient-events.v1',
  'text-adventure.production-quality-review.v1',
] as const

describe('TEXTADV-3 · 专业生产 Agent 团队', () => {
  it('把十九个专业岗位登记为独立 Agent 身份，每个岗位拥有自己的默认 Skill 与 owner', () => {
    expect(TEXT_ADVENTURE_PRODUCTION_AGENT_IDS).toHaveLength(19)
    const defaults = TEXT_ADVENTURE_PRODUCTION_AGENT_IDS.map(agentId => getDefaultAgentSkillV1(agentId))
    expect(new Set(defaults.map(skill => skill.agentId))).toEqual(new Set(TEXT_ADVENTURE_PRODUCTION_AGENT_IDS))
    expect(defaults.every(skill => skill.owner === skill.agentId)).toBe(true)
    expect(defaults.every(skill => skill.executionMode === 'product-production')).toBe(true)
    expect(defaults.every(skill => skill.writeTargets.every(target => (
      target.table === 'productBuildArtifacts'
      && target.adoptionExtension === 'product-production-artifacts'
    )))).toBe(true)
  })

  it('文字冒险专业 Skill 不再归属 outline Agent，跨岗位绑定会被拒绝', () => {
    const skills = LEGACY_TEXT_ADVENTURE_SKILLS.map(skillId => getAgentSkillV1(skillId))
    expect(skills.every(skill => skill.agentId !== 'outline' && skill.owner !== 'outline-agent')).toBe(true)
    expect(() => getAgentSkillV1(
      'text-adventure.production-mainline.v1',
      'text-adventure-game-designer',
    )).toThrow('不属于 Agent')
  })

  it('每个专业 Agent 只持有一个核心 Skill，不再由单一 Agent 兼任多个生产步骤', () => {
    const textAdventureSkills = AGENT_SKILLS.filter(skill => (
      TEXT_ADVENTURE_PRODUCTION_AGENT_IDS.includes(skill.agentId as never)
    ))
    const counts = new Map<string, number>()
    for (const skill of textAdventureSkills) counts.set(skill.agentId, (counts.get(skill.agentId) ?? 0) + 1)
    expect(Math.max(...counts.values())).toBe(1)
    expect(counts.get('text-adventure-side-quest-designer')).toBe(1)
    expect(counts.get('text-adventure-storylet-designer')).toBe(1)
    expect(counts.get('text-adventure-dialogue-editor')).toBe(1)
    expect(counts.get('text-adventure-visual-qa-director')).toBe(1)
    expect(counts.get('text-adventure-showrunner')).toBe(1)
    expect(counts.get('text-adventure-scene-writer')).toBe(1)
    expect(counts.get('text-adventure-ending-route-designer')).toBe(1)
  })

  it('分场作者和对白编辑只读取各自登记的有界投影', () => {
    expect(getAgentSkillV1('text-adventure.scene-script.v1').optionalContextSourceKeys)
      .toContain('product-production.adventure-scene-script-inputs')
    expect(getAgentSkillV1('text-adventure.dialogue-pass.v1').optionalContextSourceKeys)
      .toContain('product-production.adventure-dialogue-inputs')
    expect(CONTEXT_SOURCE_BY_KEY.get('product-production.adventure-scene-script-inputs'))
      .toMatchObject({ ownerFrom: 'work', protectedFromTrim: true })
    expect(CONTEXT_SOURCE_BY_KEY.get('product-production.adventure-dialogue-inputs'))
      .toMatchObject({ ownerFrom: 'work', protectedFromTrim: true })
    expect(getAgentSkillV1('text-adventure.playtest-strategy.v1').contextSourceKeys)
      .toContain('product-production.adventure-playtest-inputs')
    expect(getAgentSkillV1('text-adventure.playtest-strategy.v1').optionalContextSourceKeys)
      .toEqual([])
    expect(CONTEXT_SOURCE_BY_KEY.get('product-production.adventure-playtest-inputs'))
      .toMatchObject({ ownerFrom: 'work', protectedFromTrim: true })
    expect(getAgentSkillV1('text-adventure.visual-quality-review.v1').optionalContextSourceKeys)
      .toEqual(['product-production.adventure-visual-quality-inputs'])
    expect(CONTEXT_SOURCE_BY_KEY.get('product-production.adventure-visual-quality-inputs'))
      .toMatchObject({ ownerFrom: 'work', protectedFromTrim: true })
  })
})
