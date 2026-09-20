import { hashCanonicalValue } from '../../agent/run/hash'
import { TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_FIXTURES_V1 } from './fixtures'
import {
  evaluateTextOpenWorldRuntimeAIObservationV1,
  scoreTextOpenWorldRuntimeAIEvalV1,
} from './scoring'
import {
  TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_VERSION_V1,
  type TextOpenWorldRuntimeAIEvalFixtureV1,
  type TextOpenWorldRuntimeAIEvalJudgeV1,
  type TextOpenWorldRuntimeAIEvalObservationV1,
  type TextOpenWorldRuntimeAIEvalReportV1,
  type TextOpenWorldRuntimeAIEvalResultV1,
} from './types'

function safeError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value)
  const normalized = message.trim().replace(/\s+/g, ' ')
  return normalized ? normalized.slice(0, 500) : '运行时AI评测样本失败'
}

function reportBody(report: Omit<TextOpenWorldRuntimeAIEvalReportV1, 'reportHash'>) {
  return report
}

export async function runTextOpenWorldRuntimeAIEvalV1(input: {
  generatorIdentity: { provider: string; model: string }
  graderIdentity?: { provider: string; model: string; promptVersion: string } | null
  fixtures?: readonly TextOpenWorldRuntimeAIEvalFixtureV1[]
  observe: (fixture: TextOpenWorldRuntimeAIEvalFixtureV1) => Promise<TextOpenWorldRuntimeAIEvalObservationV1>
  judge?: TextOpenWorldRuntimeAIEvalJudgeV1
  now?: () => number
}): Promise<TextOpenWorldRuntimeAIEvalReportV1> {
  const fixtures = [...(input.fixtures ?? TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_FIXTURES_V1)]
  const semanticEvaluationRequired = fixtures.some(fixture => fixture.semanticJudgeRequired)
  if (semanticEvaluationRequired && (!input.judge || !input.graderIdentity)) {
    throw new Error('运行时AI语义评测必须同时提供独立grader及其冻结身份')
  }
  if (semanticEvaluationRequired
    && input.graderIdentity?.provider === input.generatorIdentity.provider
    && input.graderIdentity.model === input.generatorIdentity.model) {
    throw new Error('运行时AI发布评测要求生成器与grader使用不同provider/model身份')
  }
  const now = input.now ?? Date.now
  const startedAt = now()
  const fixtureHash = await hashCanonicalValue(fixtures)
  const results: TextOpenWorldRuntimeAIEvalResultV1[] = []
  for (const fixture of fixtures) {
    const caseStartedAt = now()
    try {
      const observation = await input.observe(fixture)
      if (fixture.semanticJudgeRequired && !input.judge) throw new Error('语义样本缺少独立grader')
      const judged = fixture.semanticJudgeRequired
        ? await input.judge!({ fixture, observation })
        : null
      if (judged && input.graderIdentity && (
        judged.evidence.provider !== input.graderIdentity.provider
        || judged.evidence.model !== input.graderIdentity.model
        || judged.evidence.promptVersion !== input.graderIdentity.promptVersion
      )) throw new Error('grader证据与冻结评测身份不一致')
      const deterministicFailures = evaluateTextOpenWorldRuntimeAIObservationV1({
        fixture,
        observation,
        grade: judged?.grade ?? null,
      })
      results.push({
        fixtureId: fixture.id,
        risk: fixture.risk,
        capability: fixture.capability,
        status: deterministicFailures.length ? 'failed' : 'passed',
        disposition: observation.disposition,
        candidateHash: observation.candidateText
          ? await hashCanonicalValue(observation.candidateText)
          : null,
        selectedActionKey: observation.selectedActionKey,
        providerCallCount: observation.providerCallCount,
        deterministicFailures,
        grade: judged?.grade ?? null,
        gradeEvidence: judged?.evidence ?? null,
        transport: observation.transport,
        error: null,
        durationMs: Math.max(0, now() - caseStartedAt),
      })
    } catch (error) {
      results.push({
        fixtureId: fixture.id,
        risk: fixture.risk,
        capability: fixture.capability,
        status: 'failed',
        disposition: null,
        candidateHash: null,
        selectedActionKey: null,
        providerCallCount: 0,
        deterministicFailures: ['样本执行失败'],
        grade: null,
        gradeEvidence: null,
        transport: null,
        error: safeError(error),
        durationMs: Math.max(0, now() - caseStartedAt),
      })
    }
  }
  const body: Omit<TextOpenWorldRuntimeAIEvalReportV1, 'reportHash'> = {
    version: TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_VERSION_V1,
    fixtureHash,
    generatorIdentity: { ...input.generatorIdentity },
    graderIdentity: input.graderIdentity ? { ...input.graderIdentity } : null,
    results,
    score: scoreTextOpenWorldRuntimeAIEvalV1(results, fixtures),
    startedAt,
    completedAt: now(),
  }
  return { ...body, reportHash: await hashCanonicalValue(reportBody(body)) }
}

export async function verifyTextOpenWorldRuntimeAIEvalReportV1(
  report: TextOpenWorldRuntimeAIEvalReportV1,
  fixtures: readonly TextOpenWorldRuntimeAIEvalFixtureV1[] = TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_FIXTURES_V1,
): Promise<boolean> {
  if (report.version !== TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_VERSION_V1) return false
  if (report.fixtureHash !== await hashCanonicalValue([...fixtures])) return false
  const { reportHash, ...body } = report
  if (reportHash !== await hashCanonicalValue(reportBody(body))) return false
  const score = scoreTextOpenWorldRuntimeAIEvalV1(report.results, fixtures)
  return await hashCanonicalValue(score) === await hashCanonicalValue(report.score)
}

export function exportTextOpenWorldRuntimeAIEvalReportV1(report: TextOpenWorldRuntimeAIEvalReportV1): string {
  return JSON.stringify(report, null, 2)
}
