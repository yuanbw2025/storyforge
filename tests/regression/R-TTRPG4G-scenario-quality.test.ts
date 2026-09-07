import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTtrpgAuthoredScenarioV1, type TtrpgAuthoredScenarioV1 } from '../../src/lib/ttrpg/scenario-authoring'

function scenario(): TtrpgAuthoredScenarioV1 {
  return { schema: 'storyforge.ttrpg-authored-scenario', version: 1,
    characters: ['hero', 'keeper'].map((key, index) => ({ key, seatKey: index ? null : 'player.1', name: key,
      description: '带着雨伞站在海堤边。', appearance: '灰色雨衣', background: '在港口长大。', goal: '救回失踪的人。',
      secret: index ? '守灯人把失事的航路记录藏进了钟楼墙缝' : '调查者曾把装满记忆的灯油偷偷卖给旅客',
      portrayal: '谨慎发问', leverage: '认得本地人', strengthAttributeKey: 'mind', weaknessAttributeKey: 'body' })),
    scenes: ['opening', 'tower', 'ending'].map(nodeKey => ({ nodeKey, description: '风从窗边掠过，桌上有一个锡罐。',
      gmTruth: '罐底压着一张由港务官亲手改写的派遣单', failureForward: '可向守夜人查问。', participantKeys: ['hero', 'keeper'] })),
    clues: ['ledger', 'bell', 'oil'].map(key => ({ key, title: key, description: `${key} 对应的记录显示了一个被掩盖的时间差。`,
      conclusionKey: `truth.${key}`, required: true, visibility: 'discoverable', paths: [
        { nodeKey: 'opening', actionKey: 'investigate', failForward: '残留的纸角可以读出日期。' },
        { nodeKey: 'tower', actionKey: 'influence', failForward: '守夜人指出备份的位置。' },
      ] })),
    quests: [{ key: 'rescue', title: '找到归船', objective: '确认今晚的灯号。', requiredConclusionKeys: ['truth.ledger'] }],
    endings: [{ nodeKey: 'ending', title: '回到岸边', epilogue: '船声终于在堤岸边响起。', requiredConclusionKeys: [], forbiddenConclusionKeys: [] }] }
}
describe('R-TTRPG4G · authored module quality constraints', () => {
  it('真实模组允许独立发现路径与失败退场，但不能将秘密或未获知证据复制进开场', () => {
    const valid = scenario()
    expect(parseTtrpgAuthoredScenarioV1(valid)).toEqual(valid)
    for (const secret of [valid.characters[0].secret, valid.scenes[0].gmTruth, valid.clues[0].description]) {
      const leaked = structuredClone(valid); leaked.scenes[0].description += secret
      expect(() => parseTtrpgAuthoredScenarioV1(leaked)).toThrow('私密信息')
    }
  })
  it('重复发现路径不能伪装成冗余线索，所有结局设前提也不能通过', () => {
    const duplicate = scenario(); duplicate.clues[0].paths[1] = { ...duplicate.clues[0].paths[0] }
    expect(() => parseTtrpgAuthoredScenarioV1(duplicate)).toThrow('两条线索发现路径')
    const blocked = scenario(); blocked.endings[0].requiredConclusionKeys = ['truth.ledger']
    expect(() => parseTtrpgAuthoredScenarioV1(blocked)).toThrow('退场结局')
  })
  it('结局可复述其前提证据，不能泄露未要求的线索或玩家秘密', () => {
    const valid = scenario()
    valid.scenes.push({ ...valid.scenes[2], nodeKey: 'truth-ending', description: valid.clues[0].description })
    valid.endings.push({ ...valid.endings[0], nodeKey: 'truth-ending', epilogue: valid.clues[0].description,
      requiredConclusionKeys: ['truth.ledger'] })
    expect(parseTtrpgAuthoredScenarioV1(valid)).toEqual(valid)
    const unknown = structuredClone(valid)
    unknown.endings[0].epilogue = valid.clues[0].description
    expect(() => parseTtrpgAuthoredScenarioV1(unknown)).toThrow('ending:ending.epilogue')
    const secret = structuredClone(valid)
    secret.endings[1].epilogue += valid.characters[0].secret
    expect(() => parseTtrpgAuthoredScenarioV1(secret)).toThrow('私密信息')
  })
})

it('雾港作者校订正文符合场景、秘密和结局合同', () => {
  const module = JSON.parse(readFileSync('examples/ttrpg/fog-harbor/author-reviewed-module.json', 'utf8'))
  const scenario = parseTtrpgAuthoredScenarioV1(module.ttrpgScenario)
  expect(scenario.characters).toHaveLength(5)
  expect(scenario.scenes).toHaveLength(7)
  expect(scenario.clues).toHaveLength(6)
  const paths = scenario.clues.flatMap(clue => clue.paths.map(path => `${path.nodeKey}:${path.actionKey}`))
  expect(new Set(paths).size).toBe(12)
})
