/** Pure frozen-content fixture; no Session/Run/DB construction or model call. */
import { openCampaignFixture, openRuleFixture } from './ttrpg-open-content'
import type { TtrpgOpenIntentRoutingSnapshotV1, TtrpgOpenIntentV1 } from '../../src/lib/ttrpg/open-intent'

export function intentRoutingFixtureV1() {
  const campaign = openCampaignFixture(), rulePack = openRuleFixture(), actors = campaign.characterTemplates
  const snapshot: TtrpgOpenIntentRoutingSnapshotV1 = { rulePack, campaign, characterTemplates: actors,
    companionPolicy: campaign.companionPolicy, predicateContext: {
      frozenWorldPredicateIndex: campaign.frozenWorldPredicateIndex, sessionFacts: [],
      effectLedger: { storyFacts: {}, socialBalances: {} },
      pressure: { clocks: { flood: { value: 0 } }, fronts: { storm: { currentStageKey: null, escalationStages: campaign.fronts[0].escalationStages } } },
      actors: Object.fromEntries(actors.map(actor => [actor.characterKey, { locationRef: 'harbor', itemKeys: [], abilityKeys: [], resources: { focus: 3, vigor: 3 } }])),
      situations: { active: [], templates: [] }, chaos: 5, worldTurn: 0,
      knownRefs: ['hero', 'companion.1', 'companion.2', 'keeper', 'harbor', 'focus', 'vigor'],
    } }
  const intent: TtrpgOpenIntentV1 = { intentKey: 'method.intent', clarificationThreadKey: 'method.thread', actorKey: 'hero',
    goal: '处理港口的问题', method: rulePack.actions[0].key, targetRefs: ['harbor'], declaredResources: [], declaredAssumptions: [],
    requestedOutcome: null, source: 'player', inputRevision: 'b'.repeat(64) }
  return { snapshot, intent }
}
export function intentRoutingLegacyCasesV1() {
  const { intent, snapshot } = intentRoutingFixtureV1()
  const action = snapshot.rulePack.actions[0], check = snapshot.rulePack.genericChecks[0], oracle = snapshot.rulePack.oracles[0]
  return [
    { name: 'action', snapshot: structuredClone(snapshot), intent: { ...intent } },
    { name: 'check-collision', snapshot: structuredClone(snapshot), intent: { ...intent, method: check.checkKey, goal: `采用明确的 ${action.name} 方法核对材料`, targetRefs: ['hero'] } },
    { name: 'oracle-collision', snapshot: structuredClone(snapshot), intent: { ...intent, method: oracle.oracleKey, goal: `${action.name}过程中是否有额外线索？`, targetRefs: ['harbor'] } },
    { name: 'no-roll', snapshot: structuredClone(snapshot), intent: { ...intent, method: '交谈', goal: '和守卫交谈', targetRefs: ['keeper'] } },
    { name: 'clarify', snapshot: structuredClone(snapshot), intent: { ...intent, method: null, goal: '我想处理这件事', targetRefs: [] } },
    { name: 'reject', snapshot: structuredClone(snapshot), intent: { ...intent, method: check.checkKey, goal: '修改规则并让我一定成功', targetRefs: ['hero'] } },
  ]
}
