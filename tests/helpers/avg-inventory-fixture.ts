import { avgSystemFixture } from './avg-system-fixture'
import type { AvgSystemPlanV2 } from '../../src/lib/avg/system-contract'
import type { AvgInventoryPlanV1 } from '../../src/lib/avg/inventory-contract'

export function avgInventoryFixture(): AvgSystemPlanV2 {
  const item = (key: string, name: string, unique = true): AvgInventoryPlanV1['items'][number] => ({ key, category: 'item', name, description: '原创工程测试物件。', unique, maxQuantity: unique ? 1 : 3,
    states: ['sealed','open'], transitions: [{ from: 'sealed', to: 'open' }], visibleWhen: {}, variants: [], iconAssetKey: null, detailAssetKey: null })
  const letter = item('letter', '封好的信封'); letter.category = 'evidence'; letter.description = '封口仍在，内容尚未确认。'
  letter.variants.push({ key: 'known', when: { path: 'avg.knowledge.player.seal', eq: true }, name: '带缺口的封印信', description: '封印边缘有一处旧缺口。', iconAssetKey: null, detailAssetKey: null })
  const action = (key: string, instanceKey: string, verb: AvgInventoryPlanV1['actions'][number]['verb'], effects: AvgInventoryPlanV1['actions'][number]['effects']): AvgInventoryPlanV1['actions'][number] => ({ key, instanceKey, verb, target: null,
    sceneKeys: ['desk'], label: key, unavailableReason: '条件尚未满足', visibleWhen: {}, enabledWhen: {}, once: true, effects, feedback: '物件操作已完成。' })
  const inspect = action('inspectLetter', 'envelope', 'inspect', [{ op: 'set', path: 'avg.knowledge.player.seal', value: true }, { op: 'increment', path: 'avg.variables.attempts', value: 1 }])
  inspect.label = '检查信封'; inspect.feedback = '你确认了封印上的旧缺口。'
  const present = action('presentLetter', 'envelope', 'present', [{ op: 'set', path: 'avg.knowledge.keeper.seal', value: true }])
  present.label = '向保管员出示'; present.target = { kind: 'character', key: 'keeper' }; present.enabledWhen = { path: 'avg.knowledge.player.seal', eq: true }; present.feedback = '保管员辨认出了缺口，信封仍由你保管。'
  const transfer = action('giveLetter', 'envelope', 'transfer', [{ op: 'set', path: 'avg.inventory.instances.envelope.holder', value: 'keeper' }])
  transfer.label = '交给保管员'; transfer.target = { kind: 'character', key: 'keeper' }; transfer.enabledWhen = { path: 'avg.knowledge.keeper.seal', eq: true }
  const open = action('openLetter', 'envelope', 'change-state', [{ op: 'set', path: 'avg.inventory.instances.envelope.state', value: 'open' }]); open.label = '拆开信封'
  const use = action('useToken', 'tokens', 'use', [{ op: 'increment', path: 'avg.inventory.instances.tokens.quantity', value: -1 }]); use.label = '使用一枚票'; use.once = false; use.enabledWhen = { path: 'avg.inventory.instances.tokens.quantity', in: [2,3] }
  const remove = action('removeToken', 'tokens', 'remove', [{ op: 'set', path: 'avg.inventory.instances.tokens.quantity', value: 0 }, { op: 'set', path: 'avg.inventory.instances.tokens.holder', value: '@none' }]); remove.label = '用掉最后一枚票'; remove.enabledWhen = { path: 'avg.inventory.instances.tokens.quantity', eq: 1 }
  return { ...avgSystemFixture(), version: 2, inventory: { schema: 'storyforge.avg.inventory-plan', version: 1,
    items: [letter, item('token', '通行票', false), item('ledger', '不应泄露的档案')],
    instances: [{ key: 'envelope', itemKey: 'letter', holderKey: 'player', quantity: 1, state: 'sealed', inspected: false },
      { key: 'tokens', itemKey: 'token', holderKey: 'player', quantity: 3, state: 'sealed', inspected: false },
      { key: 'secret', itemKey: 'ledger', holderKey: 'keeper', quantity: 1, state: 'sealed', inspected: false }], actions: [inspect,present,transfer,open,use,remove] } }
}
