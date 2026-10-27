/** Pure frozen-template compiler. Only an authorized F13 reducer may commit its result. */
import type { RuntimeEntityState, TtrpgAbilityRuntimeStateV2 } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenEntityPlanItemV1, TtrpgOpenEntityProposalV1 } from './open-entity-contract'
import { initialCharacterAttributes } from './character-mechanical-initialization'
import { createTtrpgAbilityRuntimeStateV2, ttrpgAbilityStateKeyV2 } from './ability-ledger'
import type { TtrpgItemCommandV2 } from './item-ledger'
import * as p from './open-contract-parse'

export function ttrpgOpenEntityEquipmentV1(content: TtrpgRuntimeContentV2, proposal: TtrpgOpenEntityProposalV1) {
  const template = content.campaign.dynamicEntityTemplates.find(row => row.templateKey === proposal.templateKey) ?? p.fail('实体缺少原冻结模板')
  const character = template.kind === 'actor' ? content.campaign.characterTemplates.find(row => row.characterKey === template.characterTemplateKey) : null
  return [...(character?.itemKeys ?? [])]
}
/** Intrinsic equipment is mechanical material too: it consumes the original Oracle allowance. */
export function countTtrpgOpenEntityInstancesV1(content: TtrpgRuntimeContentV2, proposals: readonly TtrpgOpenEntityProposalV1[]) {
  return proposals.reduce((count, proposal) => count + 1 + ttrpgOpenEntityEquipmentV1(content, proposal).length, 0)
}
export function ttrpgOpenEntityEquipmentKeyV1(entityKey: string, index: number) { return `${entityKey}.equipment.${index}` }

export function compileTtrpgOpenEntityMechanicsV1(input: { content: TtrpgRuntimeContentV2; items: readonly TtrpgOpenEntityPlanItemV1[]; eventSequence: number }) {
  const { content } = input, rule = content.rulePack.content
  p.integer(input.eventSequence, 'entity materialization event', 1, Number.MAX_SAFE_INTEGER)
  const entities: RuntimeEntityState[] = [], abilities: Record<string, TtrpgAbilityRuntimeStateV2> = {}, inventoryCommands: TtrpgItemCommandV2[] = []
  const grant = (entityKey: string, definitionRef: string, ownerRef: string | null, locationRef: string | null) => {
    if (!rule.items.some(row => row.key === definitionRef)) p.fail('实体物品缺少原冻结定义')
    inventoryCommands.push({ kind: 'grant', commandId: entityKey, instanceId: entityKey, definitionRef, ownerRef, locationRef, quantity: 1, eventId: `event.${input.eventSequence}` })
  }
  for (const item of input.items) {
    const template = content.campaign.dynamicEntityTemplates.find(row => row.templateKey === item.proposal.templateKey) ?? p.fail('实体缺少原冻结模板')
    if (template.kind !== item.kind) p.fail('实体类别与原模板不一致')
    const character = template.kind === 'actor' ? content.campaign.characterTemplates.find(row => row.characterKey === template.characterTemplateKey) : null
    if (template.kind === 'actor' && (!character || character.role !== 'npc' || character.controller !== 'gm' || character.seatKey !== null)) p.fail('动态实例只能来自冻结 NPC，不能建立可玩席位')
    const mechanicalTemplateKey = template.kind === 'actor' ? template.characterTemplateKey! : template.kind === 'item' ? template.itemDefinitionKey! : template.templateKey
    entities.push({ entityKey: item.entityKey, kind: template.kind === 'actor' ? 'npc' : template.kind, sourceId: null, name: item.proposal.name,
      locationKey: item.proposal.locationRef, lifecycleStatus: 'active', attributes: { productLocal: true, templateKey: mechanicalTemplateKey,
        audience: item.audience, role: template.kind === 'actor' ? 'npc' : template.kind, controller: character?.controller ?? null,
        ...(character ? initialCharacterAttributes(character, rule) : {}) } })
    if (character) {
      for (const action of rule.actions) {
        const stateKey = ttrpgAbilityStateKeyV2(item.entityKey, action.key)
        if (abilities[stateKey]) p.fail('实体能力初始身份重复')
        abilities[stateKey] = createTtrpgAbilityRuntimeStateV2({ actorInstanceId: item.entityKey,
          definition: { abilityKey: action.key, actionDefinitionKey: action.key, usage: action.usage } })
      }
      for (const [index, definitionRef] of ttrpgOpenEntityEquipmentV1(content, item.proposal).entries()) {
        const entityKey = ttrpgOpenEntityEquipmentKeyV1(item.entityKey, index), definition = rule.items.find(row => row.key === definitionRef) ?? p.fail('NPC 初始装备缺少冻结定义')
        entities.push({ entityKey, kind: 'item', sourceId: null, name: definition.name, locationKey: null, lifecycleStatus: 'active',
          attributes: { productLocal: true, templateKey: definitionRef, audience: 'gm-only', role: 'item', controller: null } })
        grant(entityKey, definitionRef, item.entityKey, null)
      }
    }
    if (template.kind === 'item') grant(item.entityKey, template.itemDefinitionKey!, item.proposal.ownerRef, item.proposal.locationRef)
  }
  p.unique(entities.map(row => row.entityKey), 'materialized entity keys')
  return { entities, abilities, inventoryCommands }
}
