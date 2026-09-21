import type { TextAdventureVisualQualityReviewArtifactV1 } from '../../src/lib/product-production/production-executor'

export type TextAdventureVisualDefectCategoryV1 =
  TextAdventureVisualQualityReviewArtifactV1['reviews'][number]['issues'][number]['category']

export interface TextAdventureVisualDefectEvalCaseV1 {
  caseKey: string
  title: string
  control: boolean
  expectedCategories: TextAdventureVisualDefectCategoryV1[]
  fixtureSvg: string
}

export interface TextAdventureVisualDefectEvalCaseResultV1 {
  caseKey: string
  artifactKey: string
  contentHash: string
  passed: boolean
  failures: string[]
}

export interface TextAdventureVisualDefectEvalResultV1 {
  schema: 'storyforge.text-adventure-visual-defect-eval'
  version: 1
  suiteId: 'storyforge.text-adventure-visual-defects.v1'
  cases: TextAdventureVisualDefectEvalCaseResultV1[]
  defectCaseCount: number
  detectedDefectCaseCount: number
  falseAcceptCount: number
  requiredCategoryCount: number
  detectedRequiredCategoryCount: number
  detectionRate: number
  categoryRecall: number
  passed: boolean
}

function scene(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360"><rect width="640" height="360" fill="#172033"/><path d="M0 300L130 210l90 55 120-145 130 150 90-65 80 95z" fill="#0b121d"/><circle cx="520" cy="70" r="42" fill="#d8c6a0"/>${body}</svg>`
}

/**
 * Synthetic, repository-owned development fixtures. They intentionally make
 * one defect legible at a time so a visual provider can be regression-tested
 * without using user media or copyrighted game art.
 */
export const TEXT_ADVENTURE_VISUAL_DEFECT_EVAL_CASES_V1:
readonly TextAdventureVisualDefectEvalCaseV1[] = Object.freeze([
  {
    caseKey: 'clean-control', title: '干净对照：蓝衣守灯人和铜色灯杖', control: true,
    expectedCategories: [],
    fixtureSvg: scene('<rect x="120" y="120" width="52" height="130" rx="18" fill="#52647a"/><circle cx="146" cy="96" r="27" fill="#b98c6a"/><path d="M192 92v180" stroke="#c48a3a" stroke-width="12"/><circle cx="192" cy="78" r="24" fill="#f4d58b"/>'),
  },
  {
    caseKey: 'identity-swap', title: '人物错位：锚点角色被替换为红衣无灯杖人物', control: false,
    expectedCategories: ['identity'],
    fixtureSvg: scene('<rect x="120" y="120" width="52" height="130" rx="18" fill="#b13a3a"/><circle cx="146" cy="96" r="27" fill="#f0c2a0"/><path d="M118 70q28-35 56 0" fill="#f2cf43"/>'),
  },
  {
    caseKey: 'style-drift', title: '风格漂移：海洋厚涂变为高饱和像素霓虹', control: false,
    expectedCategories: ['style'],
    fixtureSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360"><rect width="640" height="360" fill="#090025"/><path d="M0 330h640v30H0zM60 250h45v80H60zM110 210h45v120h-45zM160 260h45v70h-45z" fill="#00ffea"/><circle cx="500" cy="70" r="45" fill="#ff00e5"/><path d="M320 40v280M0 180h640" stroke="#7a18ff" stroke-width="8"/></svg>',
  },
  {
    caseKey: 'ending-spoiler', title: '剧透：开场插图直接暴露封灯结局', control: false,
    expectedCategories: ['spoiler'],
    fixtureSvg: scene('<rect x="205" y="80" width="250" height="85" fill="#f4ead8"/><text x="230" y="132" font-family="sans-serif" font-size="28" fill="#7d1f1f">封灯结局：同伴牺牲</text>'),
  },
  {
    caseKey: 'pseudo-text', title: '伪文字：招牌出现不可读生成字符', control: false,
    expectedCategories: ['text'],
    fixtureSvg: scene('<rect x="210" y="95" width="240" height="85" fill="#d8c6a0"/><text x="232" y="147" font-family="serif" font-size="33" fill="#172033">潮門氵己 口鳥乇</text><path d="M220 158q40-25 80 0t80 0" fill="none" stroke="#7d1f1f" stroke-width="5"/>'),
  },
  {
    caseKey: 'visible-deformation', title: '明显畸形：人物出现三条手臂和断裂关节', control: false,
    expectedCategories: ['artifact'],
    fixtureSvg: scene('<rect x="120" y="120" width="52" height="130" rx="18" fill="#52647a"/><circle cx="146" cy="96" r="27" fill="#b98c6a"/><path d="M128 145L55 205M160 145l82 42M145 158l96 86M55 205l35-42M242 187l-25 58M241 244l-9 50" stroke="#b98c6a" stroke-width="16" stroke-linecap="round"/>'),
  },
])

function validHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value)
}

export function evaluateTextAdventureVisualDefectSuiteV1(input: {
  cases?: readonly TextAdventureVisualDefectEvalCaseV1[]
  artifactBindings: Array<{ caseKey: string; artifactKey: string; contentHash: string }>
  reviews: TextAdventureVisualQualityReviewArtifactV1['reviews']
}): TextAdventureVisualDefectEvalResultV1 {
  const cases = input.cases ?? TEXT_ADVENTURE_VISUAL_DEFECT_EVAL_CASES_V1
  if (!cases.length || new Set(cases.map(item => item.caseKey)).size !== cases.length) {
    throw new Error('[text-adventure-visual-eval] 评测用例为空或 caseKey 重复')
  }
  if (input.artifactBindings.length !== cases.length
    || new Set(input.artifactBindings.map(item => item.caseKey)).size !== cases.length
    || new Set(input.artifactBindings.map(item => item.artifactKey)).size !== cases.length
    || input.artifactBindings.some(item => !validHash(item.contentHash))) {
    throw new Error('[text-adventure-visual-eval] Artifact 绑定未唯一、完整覆盖图集或 hash 无效')
  }
  if (input.reviews.length !== cases.length
    || new Set(input.reviews.map(item => item.artifactKey)).size !== cases.length) {
    throw new Error('[text-adventure-visual-eval] 审图结果未唯一、完整覆盖图集')
  }
  const bindingByCase = new Map(input.artifactBindings.map(item => [item.caseKey, item]))
  const reviewByArtifact = new Map(input.reviews.map(item => [item.artifactKey, item]))
  let detectedDefectCaseCount = 0
  let falseAcceptCount = 0
  let requiredCategoryCount = 0
  let detectedRequiredCategoryCount = 0
  const results = cases.map(testCase => {
    const binding = bindingByCase.get(testCase.caseKey)
    if (!binding) throw new Error(`[text-adventure-visual-eval] 缺少用例绑定:${testCase.caseKey}`)
    const review = reviewByArtifact.get(binding.artifactKey)
    if (!review || review.contentHash !== binding.contentHash) {
      throw new Error(`[text-adventure-visual-eval] 审图 key/hash 越界:${testCase.caseKey}`)
    }
    const failures: string[] = []
    const categories = new Set(review.issues.map(issue => issue.category))
    if (testCase.control) {
      if (review.verdict !== 'accept') failures.push(`干净对照被误判为 ${review.verdict}`)
      if (review.issues.some(issue => issue.severity === 'blocking')) failures.push('干净对照产生 blocking 问题')
    } else {
      if (review.verdict === 'accept' || review.verdict === 'not-applicable-text-fallback') {
        failures.push(`缺陷图被错误接受:${review.verdict}`)
        falseAcceptCount += 1
      } else {
        detectedDefectCaseCount += 1
      }
      requiredCategoryCount += testCase.expectedCategories.length
      for (const category of testCase.expectedCategories) {
        if (categories.has(category)) detectedRequiredCategoryCount += 1
        else failures.push(`未检出必需类别:${category}`)
      }
    }
    return {
      caseKey: testCase.caseKey,
      artifactKey: binding.artifactKey,
      contentHash: binding.contentHash,
      passed: failures.length === 0,
      failures,
    }
  })
  const defectCaseCount = cases.filter(item => !item.control).length
  const detectionRate = defectCaseCount ? detectedDefectCaseCount / defectCaseCount : 1
  const categoryRecall = requiredCategoryCount ? detectedRequiredCategoryCount / requiredCategoryCount : 1
  return {
    schema: 'storyforge.text-adventure-visual-defect-eval', version: 1,
    suiteId: 'storyforge.text-adventure-visual-defects.v1', cases: results,
    defectCaseCount, detectedDefectCaseCount, falseAcceptCount,
    requiredCategoryCount, detectedRequiredCategoryCount, detectionRate, categoryRecall,
    passed: results.every(item => item.passed) && falseAcceptCount === 0
      && detectionRate === 1 && categoryRecall === 1,
  }
}
