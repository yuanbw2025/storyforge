import { describe, expect, it } from 'vitest'
import {
  AGENT_SKILLS,
  getAgentSkillV1,
  getDefaultAgentSkillV1,
  TEXT_ADVENTURE_PRODUCTION_AGENT_IDS,
} from '../../src/lib/agent/skill-registry'

const LEGACY_TEXT_ADVENTURE_SKILLS = [
  'text-adventure.production-architecture.v1',
  'text-adventure.production-mainline.v1',
  'text-adventure.production-systems.v1',
  'text-adventure.production-side-quests.v1',
  'text-adventure.production-ambient-events.v1',
  'text-adventure.production-quality-review.v1',
] as const

describe('TEXTADV-3 · 专业生产 Agent 团队', () => {
  it('把十二个专业岗位登记为独立 Agent 身份，每个岗位拥有自己的默认 Skill 与 owner', () => {
    expect(TEXT_ADVENTURE_PRODUCTION_AGENT_IDS).toHaveLength(12)
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

  it('一个专业 Agent 最多持有两个同域 Skill，不再由单一 Agent 承担整条生产链', () => {
    const textAdventureSkills = AGENT_SKILLS.filter(skill => (
      TEXT_ADVENTURE_PRODUCTION_AGENT_IDS.includes(skill.agentId as never)
    ))
    const counts = new Map<string, number>()
    for (const skill of textAdventureSkills) counts.set(skill.agentId, (counts.get(skill.agentId) ?? 0) + 1)
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2)
    expect(counts.get('text-adventure-side-content-designer')).toBe(2)
    expect(counts.get('text-adventure-showrunner')).toBe(1)
    expect(counts.get('text-adventure-scene-writer')).toBe(1)
  })
})

