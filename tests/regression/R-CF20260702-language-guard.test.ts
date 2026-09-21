import { describe, expect, it } from 'vitest'
import {
  buildChapterOutlinePrompt,
  buildSingleChapterOutlinePrompt,
  buildVolumeOutlinePrompt,
} from '../../src/lib/ai/adapters/outline-adapter'
import {
  buildChapterContentPrompt,
  buildContinuePrompt,
} from '../../src/lib/ai/adapters/chapter-adapter'
import {
  findTextAdventurePlayerVisibleLanguageIssuesV1,
  groupTextAdventurePlayerVisibleLanguageIssuesV1,
  repairKnownTextAdventureLanguageLeaksV1,
} from '../../src/lib/adventure/language-quality'

const textOf = (messages: { content: string }[]) => messages.map(m => m.content).join('\n\n')

function expectChineseGuard(messages: { content: string }[]) {
  const text = textOf(messages)
  expect(text).toContain('语言输出硬约束')
  expect(text).toContain('简体中文')
  expect(text).toContain('禁止中英夹杂')
  expect(text).toContain('禁止输出整句英文')
  expect(text).toContain('不要原样扩散到大纲或正文')
}

describe('R-CF20260702-language-guard', () => {
  it('卷纲 / 章纲 / 单章补全 prompt 都带简体中文输出纪律', () => {
    expectChineseGuard(buildVolumeOutlinePrompt('测试书', '玄幻', '世界观', '故事主线', 1000000))
    expectChineseGuard(buildChapterOutlinePrompt('第一卷', '本卷推进主线', '世界观', '上一卷'))
    expectChineseGuard(buildSingleChapterOutlinePrompt('第一卷', '本卷推进主线', '第一章', '已有第二章', '世界观', '上一卷'))
  })

  it('正文生成 / 续写 prompt 都带简体中文输出纪律', () => {
    expectChineseGuard(buildChapterContentPrompt('第一章', '主角 enters a mysterious world', '世界观', '角色', '上一章'))
    expectChineseGuard(buildContinuePrompt('已有正文', '本章目标 tangledfuture', '世界观'))
  })

  it('文字冒险只扫描玩家可见字段，并阻止未本地化外语单词泄漏', () => {
    const issues = findTextAdventurePlayerVisibleLanguageIssuesV1([{
      artifactKey: 'content.narrative',
      payload: {
        schema: 'storyforge.product-narrative-artifact',
        beats: [{ beatKey: 'beat.act-1.001', text: '岚舟 carefully 收起笔记。' }],
        choices: [{ choiceKey: 'choice.001', text: '检查 B 区', description: '使用 AI 辅助判断' }],
      },
    }])
    expect(issues).toEqual([expect.objectContaining({
      artifactKey: 'content.narrative', path: 'beats[0].text', tokens: ['carefully'],
    })])
  })

  it('按工件聚合语言泄漏，避免同一专业 Agent 的修复反馈被重复条目挤掉', () => {
    const issues = findTextAdventurePlayerVisibleLanguageIssuesV1([{
      artifactKey: 'content.quest-script',
      payload: {
        outcomes: [
          { text: '你 actively 推动了机关。' },
          { text: '这段 secrets 属于旧守灯人。' },
        ],
      },
    }])
    expect(groupTextAdventurePlayerVisibleLanguageIssuesV1(issues)).toEqual([expect.objectContaining({
      artifactKey: 'content.quest-script',
      tokens: ['actively', 'secrets'],
      examples: expect.arrayContaining([
        expect.objectContaining({ path: 'outcomes[0].text' }),
        expect.objectContaining({ path: 'outcomes[1].text' }),
      ]),
    })])
  })

  it('在专业场景、对白和任务脚本分片进入装配前识别语言泄漏', () => {
    const artifactKeys = [
      'content.scene-script.act-2.part-1',
      'content.dialogue-pass.act-2',
      'content.quest-script.main.act-2.single',
    ]
    for (const artifactKey of artifactKeys) {
      expect(findTextAdventurePlayerVisibleLanguageIssuesV1([{
        artifactKey, payload: { revisedText: '她 waits for the bell。' },
      }])).toEqual([expect.objectContaining({ artifactKey, tokens: ['waits', 'for', 'the', 'bell'] })])
    }
  })

  it('只确定性修复无歧义的已知外语残片，其他泄漏仍由严格质量门拒绝', () => {
    const repaired = repairKnownTextAdventureLanguageLeaksV1({
      artifactKey: 'content.scene-script.act-1.part-2',
      payload: {
        scenes: [{ beats: [
          { text: 'Nobody 回答，只有潮声。' },
          { text: '他 carefully 收起铜钟。' },
        ] }],
        cost: '消耗 stamina 10 与 mana 5，需先完成 objective.02',
        machineKey: 'Nobody.must-remain-outside-player-fields',
      },
    })
    expect(repaired.repairedFields).toEqual(['scenes[0].beats[0].text', 'cost'])
    expect(repaired.payload).toMatchObject({
      scenes: [{ beats: [
        { text: '没有人回答，只有潮声。' },
        { text: '他 carefully 收起铜钟。' },
      ] }],
      cost: '消耗体力 10 与法力 5，需先完成目标 02',
      machineKey: 'Nobody.must-remain-outside-player-fields',
    })
    expect(findTextAdventurePlayerVisibleLanguageIssuesV1([{
      artifactKey: 'content.scene-script.act-1.part-2', payload: repaired.payload,
    }])).toEqual([expect.objectContaining({
      path: 'scenes[0].beats[1].text', tokens: ['carefully'],
    })])
  })

  it('文字冒险把任务代价视为玩家可见字段', () => {
    expect(findTextAdventurePlayerVisibleLanguageIssuesV1([{
      artifactKey: 'content.main-quest-plan',
      payload: { alternatives: [{ cost: '消耗 stamina 10，需完成 objective.02' }] },
    }])).toEqual([expect.objectContaining({
      path: 'alternatives[0].cost', tokens: ['stamina', 'objective'],
    })])
  })
})
