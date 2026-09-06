import type { RulePackV1, TtrpgProductionBriefV2 } from '../../src/lib/types'
import type { TtrpgAuthoredScenarioV1 } from '../../src/lib/ttrpg/scenario-authoring'

/** Deliberately small model response for the formal production protocol, never a shipped game. */
export function authoredScenarioFixture(input: {
  brief: TtrpgProductionBriefV2
  rulePack: RulePackV1
  nodes: Array<{ key: string; title: string; successorKeys: string[] }>
}): TtrpgAuthoredScenarioV1 {
  const { brief, rulePack, nodes } = input
  const investigation = rulePack.actions.find(action => action.key.includes('investigat')) ?? rulePack.actions[0]
  const alternative = rulePack.actions.find(action => action.key !== investigation.key)!
  const characters = [...brief.table.seats.map((seat, index) => ({ key: `hero.${index + 1}`, seatKey: seat.seatKey,
    name: seat.characterName || seat.label })), { key: 'keeper', seatKey: null, name: '守灯人' }].map(actor => ({ ...actor,
    description: '带着一只黄铜怀表来到码头的调查者。', appearance: '深蓝雨衣，袖口磨损。',
    background: '曾在港口修理船只，如今寻找失踪的家人。', goal: '找出求救信号来自哪里。',
    secret: `只有 ${actor.name} 知道怀表内部藏有一张旧船票。`, portrayal: '谨慎倾听，直接发问。', leverage: '认得当年的潮汐标记。',
    strengthAttributeKey: rulePack.attributes[0].key, weaknessAttributeKey: rulePack.attributes[1].key,
  }))
  return {
    schema: 'storyforge.ttrpg-authored-scenario', version: 1, characters,
    scenes: nodes.map(node => ({ nodeKey: node.key, description: `${node.title}。海风送来铜锈味，刻度盘上的指针仍在颤动。`,
      gmTruth: '值班记录在十年前被改过一次，墨迹中含有盐粒。', failureForward: '旧零件落在脚边，仍可换一种办法检查。',
      participantKeys: characters.map(actor => actor.key) })),
    clues: [
      ['ledger', '记录上的盐', '两种墨迹的盐分不同，值班记录曾被人带到海上改写。'],
      ['bell', '中空的铜铃', '铜铃内壁刻着白鹭号遇难当夜的潮汐刻度。'],
      ['oil', '第二瓶灯油', '瓶口的封蜡日期证明当夜有人提前换过灯油。'],
    ].map(([key, title, description]) => ({ key, title, description, conclusionKey: `truth.${key}`, required: true,
      visibility: 'discoverable', paths: [investigation, alternative].map(action => ({ nodeKey: nodes[0].key,
        actionKey: action.key, failForward: '检查没有完全成功，但残留物仍说明有人改动过设备。' })) })),
    quests: [{ key: 'investigate', title: '追踪求救信号', objective: '确认记录为什么发生变化。', requiredConclusionKeys: ['truth.ledger'] }],
    endings: nodes.filter(node => node.successorKeys.length === 0).map(node => ({ nodeKey: node.key, title: node.title,
      epilogue: '黎明照进港口。你把找到的记录交给等候的人，新的选择将由他们作出。', requiredConclusionKeys: [], forbiddenConclusionKeys: [] })),
  }
}
