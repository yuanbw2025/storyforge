import type { AIRequestConfigResolution, ChatResult } from '../ai/client'
import { supportsVerifiedJsonObjectResponseV1 } from '../ai/provider-capabilities'
import { executeRegisteredAIEntryV1 } from '../agent/formal-ai-entry'
import { hashCanonicalValue } from '../agent/run/hash'
import type {
  AIConfig,
  TextOpenWorldContentBudgetV1,
  TextOpenWorldMainlineThreadV1,
  TextOpenWorldRegionNarrativePacksV1,
  TextOpenWorldSceneScriptsV1,
  TextOpenWorldSignificantThreadsV1,
} from '../types'
import {
  TEXT_OPEN_WORLD_CREATOR_CALIBRATION_METRICS_V1,
  type TextOpenWorldCreatorCalibrationEvidenceV1,
} from './creator-quality-contract'

export const TEXT_OPEN_WORLD_CREATOR_CALIBRATION_PROMPT_VERSION_V1 = 'text-open-world-release-calibration-grader.v1'
export const TEXT_OPEN_WORLD_CREATOR_CALIBRATION_CATEGORY_V1 = 'review.text-open-world.release-calibration-grader'
const TIMEOUT_MS = 120_000

export interface TextOpenWorldCreatorCalibrationReviewContextV1 {
  schema: 'storyforge.text-open-world-creator-calibration-review-input'
  version: 1
  buildPackageHash: string
  mainline: {
    title: string
    summary: string
    coreGoal: string
    stages: Array<{
      key: string
      title: string
      summary: string
      dramaticQuestion: string
      requiredReveal: string
      stageOutcome: string
      estimatedMinutes: number
    }>
    endings: Array<{ endingKey: string; title: string; routeSummary: string; decisivePlayerValue: string }>
  }
  significantStories: Array<{
    key: string
    ownerKind: string
    ownerTitle: string
    title: string
    summary: string
    centralConflict: string
    theme: string
    escalationSteps: string[]
    atmosphereSignals: string[]
    estimatedMinutes: number
  }>
  regions: Array<{
    regionKey: string
    title: string
    fantasy: string
    localConflict: string
    distinctivenessStatement: string
    templates: Array<{ key: string; title: string; storyFrame: string; variationAxes: string[] }>
  }>
  templateVariants: Array<{
    templateKey: string
    variants: Array<{ title: string; description: string }>
  }>
  duration: TextOpenWorldCreatorCalibrationEvidenceV1['contentDuration']
  evaluationRules: {
    independentFromGenerator: true
    noSourceFactInvention: true
    noStateMutation: true
    scoresInClosedMetricOrder: typeof TEXT_OPEN_WORLD_CREATOR_CALIBRATION_METRICS_V1
    passThreshold: 70
  }
}

interface CalibrationDraftV1 {
  schema: 'storyforge.text-open-world-creator-calibration-grade'
  version: 1
  scores: Array<{
    metricKey: typeof TEXT_OPEN_WORLD_CREATOR_CALIBRATION_METRICS_V1[number]
    score: number
    rationale: string
  }>
  findings: string[]
}

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-calibration] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label}字段不精确:${actual.join(',')}`)
  }
}

function text(value: unknown, label: string, maximum = 1_000): string {
  if (typeof value !== 'string') fail(`${label}必须是文本`)
  const normalized = value.trim().normalize('NFC')
  if (!normalized || normalized.length > maximum) fail(`${label}为空或过长`)
  return normalized
}

function parseDraft(value: string): CalibrationDraftV1 {
  let candidate: unknown
  try { candidate = JSON.parse(value) } catch { fail('grader没有返回合法JSON') }
  const row = record(candidate, 'grade')
  exactKeys(row, ['schema', 'version', 'scores', 'findings'], 'grade')
  if (row.schema !== 'storyforge.text-open-world-creator-calibration-grade' || row.version !== 1
    || !Array.isArray(row.scores) || row.scores.length !== TEXT_OPEN_WORLD_CREATOR_CALIBRATION_METRICS_V1.length
    || !Array.isArray(row.findings) || row.findings.length > 30) fail('grade身份或数量无效')
  const scores = row.scores.map((value, index) => {
    const score = record(value, `scores[${index}]`)
    exactKeys(score, ['metricKey', 'score', 'rationale'], `scores[${index}]`)
    if (score.metricKey !== TEXT_OPEN_WORLD_CREATOR_CALIBRATION_METRICS_V1[index]
      || !Number.isInteger(score.score) || Number(score.score) < 0 || Number(score.score) > 100) {
      fail(`scores[${index}]未按闭集顺序评分`)
    }
    return {
      metricKey: score.metricKey as CalibrationDraftV1['scores'][number]['metricKey'],
      score: Number(score.score), rationale: text(score.rationale, `scores[${index}].rationale`),
    }
  })
  const findings = row.findings.map((value, index) => text(value, `findings[${index}]`))
  if (new Set(findings).size !== findings.length) fail('findings不能重复')
  if (scores.some(score => score.score < 85) && findings.length === 0) fail('低于85分时必须给出具体finding')
  return {
    schema: 'storyforge.text-open-world-creator-calibration-grade', version: 1, scores, findings,
  }
}

function textUnits(value: string): Set<string> {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\p{P}\p{S}\s]+/gu, '')
  const units = new Set<string>()
  const chars = [...normalized]
  for (let index = 0; index < chars.length; index += 1) {
    units.add(chars.slice(index, index + 2).join(''))
  }
  return units
}

function similarityBasisPoints(left: string, right: string): number {
  const a = textUnits(left)
  const b = textUnits(right)
  if (!a.size && !b.size) return 10_000
  let intersection = 0
  for (const unit of a) if (b.has(unit)) intersection += 1
  const union = a.size + b.size - intersection
  return union ? Math.round(intersection / union * 10_000) : 0
}

export function projectTextOpenWorldTemplateDifferentiationV1(input: {
  regions: TextOpenWorldRegionNarrativePacksV1
  scenes: TextOpenWorldSceneScriptsV1
}): TextOpenWorldCreatorCalibrationEvidenceV1['templateDifferentiation'] {
  const templateKeys = input.regions.packs.flatMap(pack => pack.taskTemplateSeeds.map(template => template.key)).sort()
  const groups = templateKeys.map(templateKey => ({
    templateKey,
    variants: input.scenes.templateTextVariants.filter(variant => variant.templateKey === templateKey),
  }))
  let duplicateTitles = 0
  let duplicateDescriptions = 0
  let maximumSimilarity = 0
  for (const group of groups) {
    const titles = group.variants.map(variant => variant.title.trim().toLocaleLowerCase('zh-CN'))
    const descriptions = group.variants.map(variant => variant.description.trim().toLocaleLowerCase('zh-CN'))
    duplicateTitles += titles.length - new Set(titles).size
    duplicateDescriptions += descriptions.length - new Set(descriptions).size
    for (let left = 0; left < group.variants.length; left += 1) {
      for (let right = left + 1; right < group.variants.length; right += 1) {
        maximumSimilarity = Math.max(maximumSimilarity, similarityBasisPoints(
          `${group.variants[left]!.title}\n${group.variants[left]!.description}`,
          `${group.variants[right]!.title}\n${group.variants[right]!.description}`,
        ))
      }
    }
  }
  return {
    templateCount: groups.length,
    variantCount: groups.reduce((sum, group) => sum + group.variants.length, 0),
    minimumVariantsPerTemplate: groups.length ? Math.min(...groups.map(group => group.variants.length)) : 0,
    exactDuplicateTitleCount: duplicateTitles,
    exactDuplicateDescriptionCount: duplicateDescriptions,
    maximumPairSimilarityBasisPoints: maximumSimilarity,
  }
}

export function projectTextOpenWorldContentDurationV1(
  budget: TextOpenWorldContentBudgetV1,
): TextOpenWorldCreatorCalibrationEvidenceV1['contentDuration'] {
  const optionalInventoryMinutes = budget.inventory.significantMinutes
    + budget.inventory.ordinaryFixedMinutes + budget.inventory.templateVariantMinutes
    + budget.inventory.randomEventMinutes
  return {
    mainlineMinutes: budget.inventory.mainlineMinutes,
    optionalInventoryMinutes,
    totalAuthoredMinutes: budget.inventory.totalAuthoredMinutes,
    typicalPlaythroughMinutes: budget.singlePlaythrough.typicalTotalMinutes,
    requestedMainlineMinimum: budget.requested.requiredPlayMinuteRange.minimum,
    requestedMainlineMaximum: budget.requested.requiredPlayMinuteRange.maximum,
    requestedOptionalMinimum: budget.requested.optionalInventoryMinuteRange.minimum,
    requestedOptionalMaximum: budget.requested.optionalInventoryMinuteRange.maximum,
  }
}

export function buildTextOpenWorldCreatorCalibrationContextV1(input: {
  buildPackageHash: string
  mainline: TextOpenWorldMainlineThreadV1
  significant: TextOpenWorldSignificantThreadsV1
  regions: TextOpenWorldRegionNarrativePacksV1
  scenes: TextOpenWorldSceneScriptsV1
  contentBudget: TextOpenWorldContentBudgetV1
}): TextOpenWorldCreatorCalibrationReviewContextV1 {
  const templates = input.regions.packs.flatMap(pack => pack.taskTemplateSeeds.map(template => ({
    templateKey: template.key,
    variants: input.scenes.templateTextVariants
      .filter(variant => variant.templateKey === template.key)
      .map(variant => ({ title: variant.title, description: variant.description })),
  })))
  return {
    schema: 'storyforge.text-open-world-creator-calibration-review-input', version: 1,
    buildPackageHash: input.buildPackageHash,
    mainline: {
      title: input.mainline.thread.title, summary: input.mainline.thread.summary,
      coreGoal: input.mainline.thread.coreGoal,
      stages: input.mainline.stages.map(stage => ({
        key: stage.key, title: stage.title, summary: stage.summary,
        dramaticQuestion: stage.dramaticQuestion, requiredReveal: stage.requiredReveal,
        stageOutcome: stage.stageOutcome, estimatedMinutes: stage.estimatedMinutes,
      })),
      endings: input.mainline.endingRoutes.map(route => ({
        endingKey: route.endingKey, title: route.endingKey, routeSummary: route.routeSummary,
        decisivePlayerValue: route.decisivePlayerValue,
      })),
    },
    significantStories: input.significant.threads.map(thread => ({
      key: thread.key, ownerKind: thread.ownerKind, ownerTitle: thread.ownerTitle,
      title: thread.title, summary: thread.summary, centralConflict: thread.centralConflict,
      theme: thread.theme, escalationSteps: thread.conflictSystem.escalationSteps,
      atmosphereSignals: thread.conflictSystem.atmosphereSignals, estimatedMinutes: thread.estimatedMinutes,
    })),
    regions: input.regions.packs.map(pack => ({
      regionKey: pack.regionKey, title: pack.identity.title, fantasy: pack.identity.fantasy,
      localConflict: pack.identity.localConflict,
      distinctivenessStatement: pack.identity.distinctivenessStatement,
      templates: pack.taskTemplateSeeds.map(template => ({
        key: template.key, title: template.title, storyFrame: template.storyFrame,
        variationAxes: template.variationAxes,
      })),
    })),
    templateVariants: templates,
    duration: projectTextOpenWorldContentDurationV1(input.contentBudget),
    evaluationRules: {
      independentFromGenerator: true, noSourceFactInvention: true, noStateMutation: true,
      scoresInClosedMetricOrder: TEXT_OPEN_WORLD_CREATOR_CALIBRATION_METRICS_V1,
      passThreshold: 70,
    },
  }
}

function messages(context: TextOpenWorldCreatorCalibrationReviewContextV1) {
  return [
    {
      role: 'system' as const,
      content: [
        '你是独立的文字开放世界叙事校准评审员。只评价输入中的已完成Build，不创造新事实、不修改内容或状态，只返回JSON。',
        '按顺序评价：mainline-quality（主线目标、递进、揭示、结局回收）、significant-stories（人物/势力/地区重要故事的冲突与升级）、template-differentiation（同模板三份变体是否不仅换名，而在动机、情境、阻碍或结果表达上有可感差异）。',
        '每项0到100整数分；70为最低发布校准线，低于85必须在findings给出可定位问题。不得把估算时长冒充真人游玩时长。',
        `返回：{"schema":"storyforge.text-open-world-creator-calibration-grade","version":1,"scores":[{"metricKey":"mainline-quality","score":80,"rationale":"..."},{"metricKey":"significant-stories","score":80,"rationale":"..."},{"metricKey":"template-differentiation","score":80,"rationale":"..."}],"findings":["..."]}`,
      ].join('\n'),
    },
    { role: 'user' as const, content: `<calibration-input>\n${JSON.stringify(context)}\n</calibration-input>` },
  ]
}

export async function runTextOpenWorldCreatorIndependentCalibrationReviewV1(input: {
  projectId: number
  config: AIConfig
  frozenResolution?: AIRequestConfigResolution
  context: TextOpenWorldCreatorCalibrationReviewContextV1
  signal?: AbortSignal
}): Promise<TextOpenWorldCreatorCalibrationEvidenceV1['independentReview']> {
  const requestMessages = messages(input.context)
  const result: ChatResult = {}
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(input.signal?.reason)
  if (input.signal?.aborted) forwardAbort()
  else input.signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = globalThis.setTimeout(() => controller.abort(new DOMException('G7-11独立校准超时', 'TimeoutError')), TIMEOUT_MS)
  const startedAt = Date.now()
  try {
    const requestOptions = input.config.provider === 'nvidia'
      ? {
          jsonSchema: {
            name: 'text_open_world_release_calibration_grade_v1', strict: true,
            schema: {
              type: 'object', additionalProperties: false,
              required: ['schema', 'version', 'scores', 'findings'],
              properties: {
                schema: { type: 'string', enum: ['storyforge.text-open-world-creator-calibration-grade'] },
                version: { type: 'integer', enum: [1] },
                scores: {
                  type: 'array', minItems: 3, maxItems: 3,
                  items: {
                    type: 'object', additionalProperties: false,
                    required: ['metricKey', 'score', 'rationale'],
                    properties: {
                      metricKey: { type: 'string', enum: [...TEXT_OPEN_WORLD_CREATOR_CALIBRATION_METRICS_V1] },
                      score: { type: 'integer', minimum: 0, maximum: 100 },
                      rationale: { type: 'string', minLength: 1, maxLength: 1000 },
                    },
                  },
                },
                findings: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 1000 } },
              },
            },
          },
        }
      : supportsVerifiedJsonObjectResponseV1(input.config.provider) ? { responseFormat: 'json_object' as const } : undefined
    const frozenResolution = input.frozenResolution ? {
      ...input.frozenResolution,
      config: { ...input.frozenResolution.config, temperature: 0, maxTokens: 2_400 },
    } : undefined
    const output = await executeRegisteredAIEntryV1(
      'eval.text-open-world.release-calibration-grader', requestMessages,
      { ...input.config, temperature: 0, maxTokens: 2_400 },
      { category: 'review.text-open-world.release-calibration-grader', projectId: input.projectId, contextOverflowPolicy: 'reject' },
      controller.signal, result,
      requestOptions,
      frozenResolution,
    )
    const draft = parseDraft(output)
    return {
      provider: input.config.provider, model: input.config.model,
      promptVersion: TEXT_OPEN_WORLD_CREATOR_CALIBRATION_PROMPT_VERSION_V1,
      inputHash: await hashCanonicalValue(requestMessages), outputHash: await hashCanonicalValue(output),
      inputTokens: result.usage?.inputTokens ?? null, outputTokens: result.usage?.outputTokens ?? null,
      finishReason: result.finishReason ?? null, durationMs: Math.max(1, Date.now() - startedAt),
      scores: draft.scores, findings: draft.findings,
    }
  } finally {
    globalThis.clearTimeout(timeout)
    input.signal?.removeEventListener('abort', forwardAbort)
  }
}
