import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import {
  AUTHORING_NODE_BY_ID,
  AUTHORING_OFFICIAL_TEMPLATES,
  authoringDomainActionBindingV1,
  buildOfficialAuthoringTemplate,
} from '../../src/lib/node-authoring'

describe('ARCH-06 · 节点模式与分步骤模式同源', () => {
  it('所有官方模板的生成节点都绑定已登记 Skill 与正式采纳边界', () => {
    for (const official of AUTHORING_OFFICIAL_TEMPLATES) {
      const graph = buildOfficialAuthoringTemplate(official.id)
      for (const node of graph.nodes) {
        const template = AUTHORING_NODE_BY_ID.get(node.templateId)!
        if (template.capability !== 'generate-field' && template.capability !== 'generate-collection') continue
        const binding = authoringDomainActionBindingV1(template)
        expect(binding, `${official.id}/${node.templateId}`).toMatchObject({
          version: 1,
          mode: 'formal-domain-action',
        })
        if (binding?.mode === 'formal-domain-action') {
          expect(() => getAgentSkillV1(binding.skillId)).not.toThrow()
          expect(binding.adoptionBoundary).not.toBe('candidate-only')
        }
      }
    }
  })

  it('世界、故事、角色、故事线与关系节点只声明领域动作，不复制提示词或数据写回', () => {
    const expected = new Map([
      ['world.races', ['worldview-field-copilot', 'world-origin.worldview-field']],
      ['story.concept', ['story-core-field-copilot', 'world-origin.story-core']],
      ['character.profile', ['character-profile-copilot', 'character.create']],
      ['character.field.motivation', ['character-supplement-copilot', 'character.supplement']],
      ['story.arc', ['story-arc-copilot', 'outline.story-arcs']],
      ['character.relation', ['character-relationship-durable', 'character.relationships']],
    ])
    for (const [templateId, [actionId, skillId]] of expected) {
      const binding = authoringDomainActionBindingV1(AUTHORING_NODE_BY_ID.get(templateId)!)
      expect(binding).toMatchObject({ mode: 'formal-domain-action', actionId, skillId })
    }
  })

  it('尚未接入正式领域流程的自由实体节点只能生成候选草稿', () => {
    const binding = authoringDomainActionBindingV1(AUTHORING_NODE_BY_ID.get('entity.location')!)
    expect(binding).toEqual({
      version: 1,
      mode: 'experimental-draft',
      actionId: 'generic-draft-generation',
      skillId: null,
      adoptionBoundary: 'candidate-only',
    })
  })
})
