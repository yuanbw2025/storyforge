import { describe, expect, it } from 'vitest'
import { textAdventureConflictingLocationAliasesV1 } from '../../src/lib/adventure/production-artifacts-v2'
import {
  textAdventureQuestLocationAuthorityIssuesV1,
  textAdventureQualityReviewReferenceViolationsV1,
  type TextAdventureQualityReferenceIndexV1,
} from '../../src/lib/product-production/text-adventure-quality'

const locationTitles = ['灯港主灯塔与修钟工坊', '雾隐酒馆']
const conflicts = (text: string) => textAdventureConflictingLocationAliasesV1({
  text, expectedLocation: '雾隐酒馆', locationTitles,
})
const index: TextAdventureQualityReferenceIndexV1 = {
  decisionSceneByKey: {}, decisionOptionKeysByKey: {}, optionKeys: [],
  choiceEdgeByKey: {}, sceneKeys: ['scene.005'], endingKeys: [],
  objectiveSceneByKey: { 'objective.03': 'scene.005' },
  objectiveAlternativeKeysByKey: {}, alternativeKeys: [],
}

describe('text adventure quality reference ambiguity', () => {
  it('在本地辨认便携证据上的来处记号，不会被判为移动到另一个地点', () => {
    expect(conflicts('在雾隐酒馆用调音钥匙辨认航图边的旧工坊记号，把导师指引与亲历见闻对照。')).toEqual([])
    expect(conflicts('在雾隐酒馆阅读灯港主灯塔与修钟工坊的笔记。')).toEqual([])
    expect(textAdventureQuestLocationAuthorityIssuesV1({ quests: [{ objectives: [{
      key: 'objective.03', locationOrdinal: 2, title: '辨认旧航图',
      narrativePurpose: '在雾隐酒馆用调音钥匙辨认航图边的旧工坊记号。',
    }] }] }, locationTitles)).toEqual([])
  })

  it.each([
    '前往工坊阅读记号。',
    '查看工坊内部并取走记录。',
    '阅读工坊记号后，进入工坊修钟。',
    '阅读工坊的记录，然后前往灯港主灯塔与修钟工坊。',
    '查看灯港主灯塔与修钟工坊的内部。',
  ])('保留真实地点冲突：%s', text => {
    expect(conflicts(text).length).toBeGreaterThan(0)
  })

  it('重算出的地点问题可通过身份校验，而未登记实例仍失败', () => {
    const issues = textAdventureQuestLocationAuthorityIssuesV1({ quests: [{ objectives: [{
      key: 'objective.03', locationOrdinal: 2, title: '前往工坊修钟', narrativePurpose: '',
    }] }] }, locationTitles)
    expect(issues).toHaveLength(1)
    expect(issues[0].recommendation).toContain('objective.key')
    expect(textAdventureQualityReviewReferenceViolationsV1(issues, index)).toEqual([])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'objective.missing.key 不正确。', recommendation: '保持 objective.key 不变。',
    }], index)).toEqual(['审查 引用未登记 key:objective.missing'])
  })
})
