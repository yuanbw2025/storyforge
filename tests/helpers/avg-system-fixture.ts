import type { AvgSystemPlanV1 } from '../../src/lib/avg/system-contract'

/** Original engineering fixture. No story generator, provider or commercial assets. */
export function avgSystemFixture(): AvgSystemPlanV1 {
  return {
    schema: 'storyforge.avg.system-plan', version: 1, key: 'fixture.sealed-letter', title: '规则试验：封口', storyMode: 'branching',
    characters: [{ key: 'keeper', displayName: '保管员' }],
    variables: [
      { key: 'attempts', kind: 'number', initial: 0, minimum: 0, maximum: 2, integer: true, optional: false },
      { key: 'phase', kind: 'enum', initial: 'sealed', values: ['sealed','checked'], optional: false },
      { key: 'note', kind: 'string', initial: '', maxLength: 20, optional: true },
      { key: 'promised', kind: 'boolean', initial: false, optional: false },
    ],
    knowledge: [{ holderKey: 'player', factKey: 'seal', initial: false }, { holderKey: 'keeper', factKey: 'seal', initial: false }],
    relationships: [{ characterKey: 'keeper', dimensionKey: 'trust', initial: 0, minimum: -2, maximum: 2 }],
    entrySceneKey: 'desk',
    scenes: [
      { key: 'desk', kind: 'entry', title: '桌前', enterWhen: {}, onEnter: [] },
      { key: 'wait', kind: 'ending', title: '等待', enterWhen: {}, onEnter: [] },
      { key: 'handover', kind: 'ending', title: '交接', enterWhen: { all: [{ path: 'avg.knowledge.keeper.seal', eq: true }, { selected: 'share' }] }, onEnter: [] },
    ],
    actions: [
      { key: 'inspect', fromSceneKey: 'desk', toSceneKey: 'desk', label: '检查封口', description: '', unavailableReason: '已经检查', visibleWhen: {}, enabledWhen: { path: 'avg.variables.phase', eq: 'sealed' }, effects: [
        { op: 'set', path: 'avg.knowledge.player.seal', value: true }, { op: 'set', path: 'avg.variables.phase', value: 'checked' },
        { op: 'increment', path: 'avg.variables.attempts', value: 1 },
      ] },
      { key: 'share', fromSceneKey: 'desk', toSceneKey: 'handover', label: '向保管员说明', description: '', unavailableReason: '先检查封口', visibleWhen: { visited: 'desk' }, enabledWhen: { path: 'avg.knowledge.player.seal', eq: true }, effects: [
        { op: 'set', path: 'avg.knowledge.keeper.seal', value: true }, { op: 'increment', path: 'avg.relationships.keeper.trust', value: 1 },
        { op: 'set', path: 'avg.variables.promised', value: true }, { op: 'unset', path: 'avg.variables.note' },
      ] },
      { key: 'wait', fromSceneKey: 'desk', toSceneKey: 'wait', label: '等待', description: '', unavailableReason: '', visibleWhen: {}, enabledWhen: {}, effects: [] },
    ],
  }
}

export function avgLinearSystemFixture(): AvgSystemPlanV1 {
  return {
    schema: 'storyforge.avg.system-plan', version: 1, key: 'fixture.signal', title: '规则试验：信号灯', storyMode: 'linear',
    characters: [], variables: [{ key: 'lit', kind: 'boolean', initial: false, optional: false }], knowledge: [], relationships: [], entrySceneKey: 'dark',
    scenes: [{ key: 'dark', kind: 'entry', title: '暗', enterWhen: {}, onEnter: [] },
      { key: 'light', kind: 'ending', title: '亮', enterWhen: { path: 'avg.variables.lit', eq: true }, onEnter: [] }],
    actions: [{ key: 'switch', fromSceneKey: 'dark', toSceneKey: 'light', label: '开灯', description: '', unavailableReason: '', visibleWhen: {}, enabledWhen: {}, effects: [{ op: 'set', path: 'avg.variables.lit', value: true }] }],
  }
}
