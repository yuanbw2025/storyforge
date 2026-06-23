import type { ChatMessage } from '../../types'
import type { CaseScore, LongConsistencyFixture } from './types'
import { scoreOutput } from './runner'

export interface SemanticJudgeVerdict {
  matchedRequiredFactIds: string[]
  satisfiedConstraintIds: string[]
  leakedFutureFactIds: string[]
  leakedForeignWorldFactIds: string[]
}

export function buildSemanticJudgeMessages(
  fixture: LongConsistencyFixture,
  output: string,
): ChatMessage[] {
  const rubric = {
    requiredFacts: fixture.requiredFacts,
    constraints: fixture.requiredConstraints,
    forbiddenFutureFacts: fixture.forbiddenFutureFacts,
    forbiddenForeignWorldFacts: fixture.forbiddenForeignWorldFacts,
  }
  return [
    {
      role: 'system',
      content: [
        '你是严格的小说连续性语义裁判，只判断给定正文，不续写。',
        'requiredFacts：正文必须明确呈现该事实或无歧义同义表达。',
        'constraints：判断行为是否遵守。对“不得/不能/不要”类约束，只要正文没有违反且场景已完成相关步骤，就算 satisfied；不要求逐字复述禁令。',
        'forbiddenFutureFacts：只有正文把该未来事件写成当前已发生事实才算 leaked；否定、假设、计划不算。',
        'forbiddenForeignWorldFacts：只有正文把异世界专属事实当成本世界当前事实使用才算 leaked；单纯否定或比较不算。',
        '只返回一个 JSON 对象，不要 markdown，不要解释。',
        '{"matchedRequiredFactIds":[],"satisfiedConstraintIds":[],"leakedFutureFactIds":[],"leakedForeignWorldFactIds":[]}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `【评分规则】\n${JSON.stringify(rubric)}\n\n【待评分正文】\n${output}`,
    },
  ]
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

function filterKnownIds(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && allowed.has(item)))]
}

export function parseSemanticJudgeVerdict(
  fixture: LongConsistencyFixture,
  raw: string,
): SemanticJudgeVerdict | null {
  const parsed = extractJsonObject(raw)
  if (!parsed) return null
  return {
    matchedRequiredFactIds: filterKnownIds(
      parsed.matchedRequiredFactIds,
      new Set(fixture.requiredFacts.map(item => item.id)),
    ),
    satisfiedConstraintIds: filterKnownIds(
      parsed.satisfiedConstraintIds,
      new Set(fixture.requiredConstraints.map(item => item.id)),
    ),
    leakedFutureFactIds: filterKnownIds(
      parsed.leakedFutureFactIds,
      new Set(fixture.forbiddenFutureFacts.map(item => item.id)),
    ),
    leakedForeignWorldFactIds: filterKnownIds(
      parsed.leakedForeignWorldFactIds,
      new Set(fixture.forbiddenForeignWorldFacts.map(item => item.id)),
    ),
  }
}

export function scoreWithSemanticVerdict(
  fixture: LongConsistencyFixture,
  output: string,
  verdict: SemanticJudgeVerdict,
): CaseScore {
  const deterministic = scoreOutput(fixture, output)
  return {
    ...deterministic,
    requiredFactRecall: fixture.requiredFacts.length
      ? verdict.matchedRequiredFactIds.length / fixture.requiredFacts.length
      : 1,
    constraintRecall: fixture.requiredConstraints.length
      ? verdict.satisfiedConstraintIds.length / fixture.requiredConstraints.length
      : 1,
    futureLeakage: verdict.leakedFutureFactIds.length > 0,
    wrongWorldLeakage: verdict.leakedForeignWorldFactIds.length > 0,
    matchedRequiredFacts: verdict.matchedRequiredFactIds,
    matchedConstraints: verdict.satisfiedConstraintIds,
    leakedFutureFacts: verdict.leakedFutureFactIds,
    leakedForeignWorldFacts: verdict.leakedForeignWorldFactIds,
  }
}
