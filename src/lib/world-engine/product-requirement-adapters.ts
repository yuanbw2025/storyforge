import type {
  ContextResourceKind,
  WorldCapabilityArea,
} from '../registry/types'
import type { WorldRequirementRuleV1 } from '../types'
import type { WorldRequirementAdapterV1 } from './product-source-contracts'

function selector(input: {
  areas: WorldCapabilityArea[]
  resourceKinds?: string[]
  contextKinds: ContextResourceKind[]
  query?: string | null
}): WorldRequirementRuleV1['selector'] {
  return {
    areas: input.areas,
    resourceKinds: input.resourceKinds ?? [],
    contextKinds: input.contextKinds,
    query: input.query ?? null,
  }
}

export interface TtrpgWorldRequirementGoalV1 {
  allowCrossWorld: boolean
  useManuscriptContinuity: boolean
  investigationHeavy: boolean
}

export const TTRPG_WORLD_REQUIREMENT_ADAPTER_V1: WorldRequirementAdapterV1<TtrpgWorldRequirementGoalV1> = {
  adapterId: 'storyforge.ttrpg.world-requirements',
  adapterVersion: 1,
  productType: 'ttrpg',
  contextTaskKind: 'agent-outline',
  resolve: goal => [
    {
      key: 'world-grounding', label: '世界基础与规则', level: 'stable-required', minimumResources: 1,
      selector: selector({ areas: ['foundation'], contextKinds: ['world', 'worldview-field', 'location', 'fact'] }),
      condition: null,
    },
    {
      key: 'playable-cast', label: '可用角色', level: 'stable-required', minimumResources: 1,
      selector: selector({ areas: ['characters'], resourceKinds: ['character'], contextKinds: ['character'] }),
      condition: null,
    },
    {
      key: 'cast-story-roles', label: '角色在作品中的身份与弧光', level: 'recommended', minimumResources: 1,
      selector: selector({ areas: ['characters'], resourceKinds: ['work-character-binding'], contextKinds: ['character'] }),
      condition: null,
    },
    {
      key: 'story-and-fronts', label: '故事、主支线与结构', level: 'recommended', minimumResources: 1,
      selector: selector({
        areas: ['story', 'storylines', 'outline', 'detailed-outline'],
        contextKinds: ['story-core-field', 'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'foreshadow'],
      }),
      condition: null,
    },
    {
      key: 'investigation-evidence', label: '调查事实与地点', level: 'conditional', minimumResources: 1,
      selector: selector({
        areas: ['entities', 'story'],
        contextKinds: ['codex-entry', 'location', 'fact', 'foreshadow'],
        query: goal.investigationHeavy ? null : 'inactive-investigation',
      }),
      condition: { key: 'investigationHeavy', active: goal.investigationHeavy, reason: '调查型跑团需要事实、线索与地点证据' },
    },
    {
      key: 'cross-world-travel', label: '多世界连接', level: 'conditional', minimumResources: 1,
      selector: selector({ areas: ['multi-world'], contextKinds: ['world', 'world-link'] }),
      condition: { key: 'allowCrossWorld', active: goal.allowCrossWorld, reason: '仅跨世界跑团读取世界关系与通道' },
    },
    {
      key: 'published-manuscript', label: '封存正文连续性', level: 'conditional', minimumResources: 1,
      selector: selector({ areas: ['manuscript'], resourceKinds: ['chapter'], contextKinds: ['chapter'] }),
      condition: { key: 'useManuscriptContinuity', active: goal.useManuscriptContinuity, reason: '仅在用户选择继承正文连续性时读取' },
    },
  ],
}

export interface CharacterInteractionWorldRequirementGoalV1 {
  participantCount: number
  inheritStoryContinuity: boolean
  allowCrossWorld: boolean
}

export const CHARACTER_INTERACTION_WORLD_REQUIREMENT_ADAPTER_V1: WorldRequirementAdapterV1<CharacterInteractionWorldRequirementGoalV1> = {
  adapterId: 'storyforge.character-interaction.world-requirements',
  adapterVersion: 1,
  productType: 'character-interaction',
  contextTaskKind: 'agent-outline',
  resolve: goal => [
    {
      key: 'conversation-cast', label: '聊天角色身份', level: 'stable-required', minimumResources: Math.max(1, goal.participantCount),
      selector: selector({ areas: ['characters'], resourceKinds: ['character'], contextKinds: ['character'] }),
      condition: null,
    },
    {
      key: 'conversation-cast-roles', label: '聊天角色在作品中的身份与弧光', level: 'recommended', minimumResources: 1,
      selector: selector({ areas: ['characters'], resourceKinds: ['work-character-binding'], contextKinds: ['character'] }),
      condition: null,
    },
    {
      key: 'participant-relations', label: '参与角色关系', level: 'conditional', minimumResources: 1,
      selector: selector({ areas: ['relations'], contextKinds: ['character-relation'] }),
      condition: { key: 'multipleParticipants', active: goal.participantCount > 1, reason: '多人聊天必须了解参与角色之间的关系与知识边界' },
    },
    {
      key: 'identity-context', label: '角色所属世界语境', level: 'recommended', minimumResources: 1,
      selector: selector({ areas: ['foundation', 'entities'], contextKinds: ['world', 'worldview-field', 'location', 'codex-entry', 'fact'] }),
      condition: null,
    },
    {
      key: 'story-continuity', label: '既有故事连续性', level: 'conditional', minimumResources: 1,
      selector: selector({
        areas: ['story', 'storylines', 'outline', 'detailed-outline', 'manuscript'],
        contextKinds: ['story-core-field', 'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'chapter', 'foreshadow'],
      }),
      condition: { key: 'inheritStoryContinuity', active: goal.inheritStoryContinuity, reason: '继承原作时间点时读取故事与正文证据' },
    },
    {
      key: 'cross-world-knowledge', label: '跨世界认知', level: 'conditional', minimumResources: 1,
      selector: selector({ areas: ['multi-world'], contextKinds: ['world', 'world-link'] }),
      condition: { key: 'allowCrossWorld', active: goal.allowCrossWorld, reason: '只有跨世界对话才允许读取世界关系' },
    },
  ],
}
