import type { TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createTextOpenWorldVNextP9Fixture } from './text-open-world-vnext-fixture'

// An isolated authored fixture, never the live sample or a player receipt.
export function createActionEvidenceV19Fixture(): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  const actions = runtimePackage.modules.actions.payload as any
  const progression = runtimePackage.modules.progression.payload as any
  const combat = runtimePackage.modules.combat.payload as any
  const stagedAbandon = actions.actions.find((action: any) => action.key === 'action.abandon-supplies')
  const stagedBinding = actions.inputBindings.actions.find((binding: any) => binding.actionKey === stagedAbandon.key)
  const actionKey = 'action.abandon-supplies-unstarted-craft-proof'
  const effectKey = 'effect.abandon-supplies-unstarted-craft-proof'
  const actionDefinitionHash = 'd'.repeat(64)
  actions.effects.push({
    key: effectKey, operation: 'transition-quest',
    payload: { questKey: 'quest.template.supplies', status: 'abandoned', stageKey: null },
  })
  actions.actions.push({ ...structuredClone(stagedAbandon), key: actionKey, successEffectKeys: [effectKey] })
  actions.inputBindings.actions.push({
    ...structuredClone(stagedBinding),
    key: `binding.${actionKey}`, order: actions.inputBindings.actions.length + 1, actionKey, actionDefinitionHash,
    resultAuthority: { ...structuredClone(stagedBinding.resultAuthority), actionKey, actionDefinitionHash },
    naturalLanguage: {
      ...structuredClone(stagedBinding.naturalLanguage),
      exampleUtterances: ['放弃尚未开始的物资请求', '不接这一轮物资委托'],
    },
  })
  actions.version = 19
  runtimePackage.modules.actions.schemaVersion = 19
  progression.version = 2
  progression.skills = progression.skills.map((candidate: any) => {
    const { activation: _activation, kind, ...skill } = candidate
    if (kind !== 'attack') throw new Error(`Unexpected fixture skill ${String(kind)}`)
    return { ...skill, mechanic: { kind: 'attack' } }
  })
  progression.statuses = progression.statuses.map((status: any) => ({
    ...status, duration: { clock: 'combat' }, reapplyPolicy: 'reject', maxStacks: 1, modifiers: [],
  }))
  runtimePackage.modules.progression.schemaVersion = 2
  combat.version = 4
  delete combat.transientPlayerStatusKeys
  runtimePackage.modules.combat.schemaVersion = 4
  const craft = actions.actions.find((action: any) => action.key === 'action.craft-brine-tonic')
  const proofKey = 'effect.fulfillment.recipe.recipe.brine-tonic'
  actions.effects.push({
    key: proofKey, operation: 'set-world-flag',
    payload: { flagKey: 'flag.fulfillment.recipe.recipe.brine-tonic', value: true },
  })
  craft.successEffectKeys.push(proofKey)
  parseTextOpenWorldModulesV1(runtimePackage)
  return runtimePackage
}

export function createActionEvidenceV20Fixture() {
  const pkg = createActionEvidenceV19Fixture()
  const actions = pkg.modules.actions.payload as any
  actions.version = 20
  pkg.modules.actions.schemaVersion = 20
  for (const action of actions.actions.filter((item: any) => item.category === 'buy')) {
    const transaction = actions.effects.find((effect: any) => action.successEffectKeys.includes(effect.key) && effect.operation === 'perform-transaction')
    const key = `effect.fulfillment.purchase.${transaction.payload.vendorKey}`
    actions.effects.push({ key, operation: 'prove-purchase', payload: { vendorKey: transaction.payload.vendorKey } })
    action.successEffectKeys.push(key)
  }
  return pkg
}
