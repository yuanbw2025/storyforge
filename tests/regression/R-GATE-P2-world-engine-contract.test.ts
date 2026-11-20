import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { FIELD_REGISTRY } from '../../src/lib/registry/field-registry'

const DOMAIN_CONTRACTS = [
  { skillId: 'world-origin.worldview-field', agentId: 'world-origin', tables: ['worldviews'] },
  { skillId: 'world-origin.story-core', agentId: 'world-origin', tables: ['storyCores'] },
  { skillId: 'character.create', agentId: 'character', tables: ['characters'] },
  { skillId: 'character.supplement', agentId: 'character', tables: ['characters'] },
  { skillId: 'character.lifecycle', agentId: 'character', tables: ['characters'] },
  { skillId: 'world-origin.codex-extract', agentId: 'world-origin', tables: ['codexEntries'] },
  { skillId: 'world-origin.codex-enrich', agentId: 'world-origin', tables: ['codexEntries'] },
] as const

describe('GATE-P2 · world engine domain contracts', () => {
  it.each(DOMAIN_CONTRACTS)(
    '$skillId uses required Gateway and cannot write another domain',
    ({ skillId, agentId, tables }) => {
      const skill = getAgentSkillV1(skillId, agentId)
      expect(skill.contextGateway?.rollout).toBe('required')
      expect(skill.contextGateway?.providerSourceKeys).toEqual(skillId === 'world-origin.story-core' ? ['ragSelection', 'workAuthoringIntent'] : ['ragSelection'])
      expect(new Set(skill.writeTargets.map(target => target.table))).toEqual(new Set(tables))
      const required = new Set(skill.contextGateway?.requiredWriteTargets ?? [])
      expect(required.size).toBeGreaterThan(0)
      for (const target of skill.writeTargets) {
        for (const field of target.fields) {
          expect(FIELD_REGISTRY.some(spec => spec.target === target.table && spec.field === field)).toBe(true)
        }
      }
      const declared = new Set(skill.writeTargets.flatMap(target => (
        target.fields.map(field => `${target.table}.${field}`)
      )))
      expect([...required].every(target => declared.has(target))).toBe(true)
    },
  )

  it('Codex enrichment no longer encodes a handwritten World/Story/Character source package', () => {
    const enrich = getAgentSkillV1('world-origin.codex-enrich', 'world-origin')
    expect(enrich.contextSourceKeys).toEqual(['ragSelection'])
    expect(enrich.contextSourceKeys).not.toEqual(expect.arrayContaining([
      'worldview', 'storyCore', 'characters', 'storyArcs',
    ]))
    expect(enrich.contextGateway?.allowedResourceKinds).toEqual(expect.arrayContaining([
      'worldview-field', 'story-core-field', 'character', 'story-arc', 'codex-entry',
    ]))
  })

  it('story intent, executable arcs, characters, worldview and Codex remain separate write authorities', () => {
    const worldview = getAgentSkillV1('world-origin.worldview-field', 'world-origin')
    const story = getAgentSkillV1('world-origin.story-core', 'world-origin')
    const arcs = getAgentSkillV1('outline.story-arcs', 'outline')
    const character = getAgentSkillV1('character.create', 'character')
    const codex = getAgentSkillV1('world-origin.codex-enrich', 'world-origin')
    expect(worldview.writeTargets.map(target => target.table)).toEqual(['worldviews'])
    expect(story.writeTargets.map(target => target.table)).toEqual(['storyCores'])
    expect(arcs.writeTargets.map(target => target.table)).toEqual(['storyArcs'])
    expect(character.writeTargets.map(target => target.table)).toEqual(['characters'])
    expect(codex.writeTargets.map(target => target.table)).toEqual(['codexEntries'])
  })
})
