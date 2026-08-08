import { describe, expect, it } from 'vitest'
import {
  AGENT_SKILLS,
  getDefaultAgentSkillV1,
  resolveAgentSkillContextSourceKeysV1,
  validateAgentSkillDefinitionsV1,
  type AgentSkillDefinitionV1,
} from '../../src/lib/agent/skill-registry'
import { buildMasterAgentRunContractV1 } from '../../src/lib/agent/run/master-durable'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'

function contractFor(tasks: Parameters<typeof buildMasterAgentRunContractV1>[0]['plan']['tasks']) {
  return buildMasterAgentRunContractV1({
    scope: { projectId: 1, worldId: 10, workId: 20 },
    worldGroupId: null,
    plan: { summary: 'Skill 权限测试', tasks },
    budgetEvidence: new AgentTeamBudgetTracker('balanced').snapshot(),
  })
}

describe('R-HARNESS13 · Agent Skill 单一事实源', () => {
  it('每个领域 Agent 有且仅有一个默认 Skill，全部读写都能通过三注册表校验', () => {
    expect(() => validateAgentSkillDefinitionsV1(AGENT_SKILLS)).not.toThrow()
    expect(AGENT_SKILLS.filter(skill => skill.defaultForAgent)).toHaveLength(5)
    expect(AGENT_SKILLS.map(skill => skill.id)).toEqual(expect.arrayContaining([
      'outline.volumes',
      'outline.chapters',
      'prose.generate',
      'prose.continue',
    ]))
    expect(new Set(AGENT_SKILLS.map(skill => skill.owner)).size).toBe(5)
  })

  it('允许同一 Agent 增加非默认 Skill，但拒绝第二个默认 Skill', () => {
    const base = getDefaultAgentSkillV1('character')
    const supplement: AgentSkillDefinitionV1 = {
      ...base,
      id: 'character.supplement',
      defaultForAgent: false,
      label: '角色定向补全',
    }
    expect(() => validateAgentSkillDefinitionsV1([...AGENT_SKILLS, supplement])).not.toThrow()
    expect(() => validateAgentSkillDefinitionsV1([
      ...AGENT_SKILLS,
      { ...supplement, id: 'character.second-default', defaultForAgent: true },
    ])).toThrow('存在多个默认 Skill')
  })

  it('主 Agent RunContract 从 Skill 派生最小上下文和写权限', () => {
    const contract = contractFor([
      { id: 'world', agentId: 'world-origin', instruction: '补全世界来源', dependsOn: [] },
      { id: 'character', agentId: 'character', instruction: '创建角色', dependsOn: ['world'] },
      { id: 'prose', agentId: 'prose', instruction: '写第一章正文', dependsOn: ['character'] },
    ])

    expect(contract.permissions.contextSourceKeys).toContain('projectStatus')
    expect(contract.permissions.contextSourceKeys).toContain('characterRelations')
    expect(contract.permissions.contextSourceKeys).toContain('chapterOutline')
    expect(contract.permissions.contextSourceKeys).not.toContain('characterKnowledge')
    expect(contract.permissions.writeTargets.map(target => target.table)).toEqual([
      'worldviews',
      'characters',
      'chapters',
    ])
  })

  it('正文采纳扩展仍由内部 Skill 登记，但不能伪装成主计划生成任务', () => {
    const organize = AGENT_SKILLS.find(skill => skill.id === 'prose.organize')
    expect(organize?.writeTargets).toContainEqual({
      table: 'temporalFacts',
      fields: [],
      adoptionExtension: 'fact-ledger',
    })
    expect(() => contractFor([
      { id: 'post', agentId: 'prose', skillId: 'prose.organize', instruction: '整理正文后六域候选', dependsOn: [] },
    ])).toThrow('不是主计划可直接执行的生成 Skill')
  })

  it('只有显式正文视角才把角色认知源加入 Skill 权限', () => {
    const withoutPerspective = contractFor([
      { id: 'prose', agentId: 'prose', instruction: '写第一章正文', dependsOn: [] },
    ])
    const withPerspective = contractFor([
      {
        id: 'prose',
        agentId: 'prose',
        instruction: '以守灯人视角写第一章正文',
        dependsOn: [],
        perspectiveCharacterId: 7,
      },
    ])
    expect(withoutPerspective.permissions.contextSourceKeys).not.toContain('characterKnowledge')
    expect(withPerspective.permissions.contextSourceKeys).toContain('characterKnowledge')
  })

  it('未知上下文源和未知写字段均 fail-closed', () => {
    const base = getDefaultAgentSkillV1('world-origin')
    expect(() => validateAgentSkillDefinitionsV1(AGENT_SKILLS.map(skill => (
      skill.id === base.id
        ? { ...skill, contextSourceKeys: ['not-registered-source'] }
        : skill
    )))).toThrow('未登记上下文源')
    expect(() => validateAgentSkillDefinitionsV1(AGENT_SKILLS.map(skill => (
      skill.id === base.id
        ? { ...skill, writeTargets: [{ table: 'worldviews', fields: ['notRegisteredField'] }] }
        : skill
    )))).toThrow('未登记写字段')
    expect(() => validateAgentSkillDefinitionsV1(AGENT_SKILLS.map(skill => (
      skill.id === base.id
        ? { ...skill, executionMode: 'continue' }
        : skill
    )) as AgentSkillDefinitionV1[])).toThrow('执行模式与 Agent 不匹配')
  })

  it('Skill 的工具源和直接上下文源只在需要时合并可选源', () => {
    const prose = getDefaultAgentSkillV1('prose')
    const world = getDefaultAgentSkillV1('world-origin')
    expect(resolveAgentSkillContextSourceKeysV1(world)).toEqual([
      'projectStatus',
      'worldview',
      'powerSystem',
      'codex',
    ])
    expect(resolveAgentSkillContextSourceKeysV1(prose)).not.toContain('characterKnowledge')
    expect(resolveAgentSkillContextSourceKeysV1(prose, { includeOptional: true }))
      .toContain('characterKnowledge')
  })
})
