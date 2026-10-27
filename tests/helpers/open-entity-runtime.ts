/** Internal F13 planning fixture, not a produced work or real-provider acceptance. */
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER, openEnvelopeV1 } from './open-ttrpg-session'
import { startTtrpgOpenEpochV1, consultTtrpgOracleV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import type { TtrpgOpenEntityProposalV1 } from '../../src/lib/ttrpg/open-entity-contract'

export async function setupOpenEntityPlanningV1(configure?: Parameters<typeof readyOpenTtrpgSessionV1>[1], viewerKey = OPEN_HUMAN_VIEWER, selectedCharacterKeys?: string[]) {
  const f = await readyOpenTtrpgSessionV1('F13 original Oracle planning', pkg => {
    const c = pkg.ttrpg!.campaign, rule = pkg.ttrpg!.rulePack.content
    rule.oracles[0].interpretation.maxNewEntities = 3
    const common = { description: '冻结授权的实例模板', maximumNameLength: 20, maximumInstances: 2,
      audience: 'party' as const, knownByActorKeys: [], sourceRefs: [c.entityBindings.find(b => b.bindingKey === 'harbor')!.sourceResourceRef!] }
    c.dynamicEntityTemplates = [
      { ...common, templateKey: 'dynamic.npc', kind: 'actor', characterTemplateKey: 'keeper', itemDefinitionKey: null,
        parameters: [{ parameterKey: 'mood', allowedValues: ['quiet', 'alert'], required: true }] },
      { ...common, templateKey: 'dynamic.location', kind: 'location', characterTemplateKey: null, itemDefinitionKey: null, parameters: [] },
      { ...common, templateKey: 'dynamic.item', kind: 'item', characterTemplateKey: null, itemDefinitionKey: rule.items[0].key, parameters: [] },
    ]
    configure?.(pkg)
  }, selectedCharacterKeys)
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'entity.start'), viewerKey, triggerKind: viewerKey === 'viewer.gm' ? 'continue-host' : 'submit-action', rawInput: '明确咨询并审查可实例化对象' })
  const event = await consultTtrpgOracleV1({ ...await openEnvelopeV1(f.sessionId, 'entity.oracle'), viewerKey,
    askedBy: viewerKey === 'viewer.gm' ? 'gm' : 'player:hero', oracleKey: f.runtimePackage.ttrpg!.rulePack.content.oracles[0].oracleKey, question: '当前可以引入哪些模板内的新对象？' })
  const state = await readProductRuntimeState(f.sessionId)
  const proposals: TtrpgOpenEntityProposalV1[] = [
    { templateKey: 'dynamic.npc', name: '新守灯人', description: '依原结果提出的候选人物', parameters: { mood: 'quiet' }, locationRef: 'harbor', ownerRef: null },
    { templateKey: 'dynamic.location', name: '新候选地点', description: '尚未实际创建的地点', parameters: {}, locationRef: null, ownerRef: null },
    { templateKey: 'dynamic.item', name: '候选物品', description: '沿原冻结定义创建的物品', parameters: {}, locationRef: null, ownerRef: 'companion.1' },
  ]
  const input = { state, content: f.runtimePackage.ttrpg!, runtimeSourceHash: f.session.runtimeSourceHash, viewerKey,
    commandId: 'entity.propose', sequence: event.sequence + 1, oracleSourceRef: { sessionKey: state.ttrpg!.sessionKey, sequence: event.sequence }, proposals, previousOperations: [] }
  return { f, input, proposals }
}
