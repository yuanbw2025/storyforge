import { describe, expect, it } from 'vitest'
import {
  TEXT_ADVENTURE_VISUAL_DEFECT_EVAL_CASES_V1,
  evaluateTextAdventureVisualDefectSuiteV1,
} from '../helpers/text-adventure-visual-quality'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import type { TextAdventureVisualQualityReviewArtifactV1 } from '../../src/lib/product-production/production-executor'

async function fixture() {
  const artifactBindings = await Promise.all(TEXT_ADVENTURE_VISUAL_DEFECT_EVAL_CASES_V1.map(async (testCase, index) => ({
    caseKey: testCase.caseKey,
    artifactKey: `media.visual.${String(index + 1).padStart(3, '0')}`,
    contentHash: await hashProductProductionValueV2(testCase.fixtureSvg),
  })))
  const reviews: TextAdventureVisualQualityReviewArtifactV1['reviews'] = artifactBindings.map(binding => {
    const testCase = TEXT_ADVENTURE_VISUAL_DEFECT_EVAL_CASES_V1.find(item => item.caseKey === binding.caseKey)!
    return {
      artifactKey: binding.artifactKey,
      contentHash: binding.contentHash,
      verdict: testCase.control ? 'accept' : 'revise',
      scores: {
        requirementFit: testCase.control ? 5 : 2,
        identityContinuity: testCase.caseKey === 'identity-swap' ? 1 : 4,
        styleContinuity: testCase.caseKey === 'style-drift' ? 1 : 4,
        composition: 4,
        technicalCleanliness: ['pseudo-text', 'visible-deformation'].includes(testCase.caseKey) ? 1 : 4,
      },
      issues: testCase.expectedCategories.map(category => ({
        severity: 'blocking' as const,
        category,
        detail: `${testCase.title} 已由独立审图检出。`,
        recommendation: '退回对应图片并按冻结视觉需求单项重生成。',
      })),
      reviewSource: 'multimodal-model',
    }
  })
  return { artifactBindings, reviews }
}

describe('R-TEXTADV8 · 文字冒险视觉缺陷专用评测图集', () => {
  it('以六张非同源合成图覆盖干净对照、人物错位、风格漂移、剧透、伪文字和明显畸形', async () => {
    const fixtureHashes = await Promise.all(TEXT_ADVENTURE_VISUAL_DEFECT_EVAL_CASES_V1
      .map(item => hashProductProductionValueV2(item.fixtureSvg)))
    expect(TEXT_ADVENTURE_VISUAL_DEFECT_EVAL_CASES_V1.map(item => item.caseKey)).toEqual([
      'clean-control', 'identity-swap', 'style-drift', 'ending-spoiler', 'pseudo-text', 'visible-deformation',
    ])
    expect(new Set(fixtureHashes).size).toBe(TEXT_ADVENTURE_VISUAL_DEFECT_EVAL_CASES_V1.length)
    expect(TEXT_ADVENTURE_VISUAL_DEFECT_EVAL_CASES_V1.every(item => (
      item.fixtureSvg.startsWith('<svg') && item.fixtureSvg.includes('viewBox="0 0 640 360"')
    ))).toBe(true)
  })

  it('只有零缺陷误接受且全部必需类别被检出时才通过', async () => {
    const input = await fixture()
    const result = evaluateTextAdventureVisualDefectSuiteV1(input)
    expect(result).toMatchObject({
      passed: true, defectCaseCount: 5, detectedDefectCaseCount: 5,
      falseAcceptCount: 0, requiredCategoryCount: 5, detectedRequiredCategoryCount: 5,
      detectionRate: 1, categoryRecall: 1,
    })
  })

  it('即使 JSON 合法，漏掉剧透类别或直接接受缺陷图仍会失败', async () => {
    const input = await fixture()
    const spoiler = input.reviews.find(item => item.artifactKey === 'media.visual.004')!
    spoiler.verdict = 'accept'
    spoiler.issues = []
    const result = evaluateTextAdventureVisualDefectSuiteV1(input)
    expect(result.passed).toBe(false)
    expect(result.falseAcceptCount).toBe(1)
    expect(result.categoryRecall).toBe(0.8)
    expect(result.cases.find(item => item.caseKey === 'ending-spoiler')?.failures).toEqual([
      '缺陷图被错误接受:accept', '未检出必需类别:spoiler',
    ])
  })

  it('拒绝漏项、重复 Artifact 或内容 hash 偷换', async () => {
    const input = await fixture()
    expect(() => evaluateTextAdventureVisualDefectSuiteV1({
      ...input, reviews: input.reviews.slice(1),
    })).toThrow('未唯一、完整覆盖图集')
    expect(() => evaluateTextAdventureVisualDefectSuiteV1({
      ...input,
      reviews: input.reviews.map((item, index) => index === 1 ? { ...item, contentHash: 'f'.repeat(64) } : item),
    })).toThrow('key/hash 越界')
  })
})
