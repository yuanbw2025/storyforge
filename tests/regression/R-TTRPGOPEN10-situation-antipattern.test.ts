import { describe, expect, it } from 'vitest'
import type { TtrpgPredicateV1 } from '../../src/lib/ttrpg/open-contract'
import type {
  TtrpgSituationGenerationCandidateV1,
  TtrpgSituationGenerationInputV1,
} from '../../src/lib/ttrpg/situation-generation'
import {
  calculateWeightedJaccardV1,
  checkTtrpgSituationDependenciesV1,
  detectTtrpgSituationDependencyCyclesV1,
  evaluateTtrpgSituationGenerationV1,
  getTtrpgSituationCooldownUntilWorldTurnV1,
} from '../../src/lib/ttrpg/situation-generation'

const PLAYER_FACT = 'fact.player-choice'
const PLAYER_ACTOR = 'actor:hero'
const PREDICATE: TtrpgPredicateV1 = { op: 'world-turn-at-least', value: 1 }

function situation(
  templateKey: string,
  obstacleCount: number,
  actionCount = obstacleCount,
): TtrpgSituationGenerationCandidateV1 {
  return {
    templateKey,
    title: templateKey,
    motive: 'protection',
    driverBinding: { kind: 'player-commitment', factRef: PLAYER_FACT },
    driverGoal: '兑现先前承诺',
    driverBeliefs: [{ factRef: PLAYER_FACT, belief: '队伍已经承诺保护港口', isMistaken: false }],
    preconditions: [],
    obstacles: Array.from({ length: obstacleCount }, (_, index) => ({
      obstacleKey: `obstacle.${index}`,
      kind: 'physical' as const,
      ref: null,
      predicate: PREDICATE,
      dependsOn: index === 0 ? [] : ['obstacle.0'],
    })),
    interventionPoints: [{
      pointKey: 'point.inspect',
      visibleTo: 'private',
      knownByActorKeys: [PLAYER_ACTOR],
      affordanceHint: '可以检查障碍',
      requiresPredicate: null,
      suggestedActionKeys: Array.from({ length: actionCount }, () => 'action.inspect'),
      targetsObstacleKeys: ['obstacle.0'],
    }],
    evidence: [{
      clueRef: `${templateKey}.evidence`,
      title: '承诺的记录',
      description: '记录了玩家先前的选择。',
      sourceFactRefs: [PLAYER_FACT],
      sourceResourceRefs: [],
      discoverableBy: ['action.inspect'],
      coversObstacleKeys: ['obstacle.0'],
      audience: 'private',
      knownByActorKeys: [PLAYER_ACTOR],
      isRequired: false,
      discoveryPolicy: {
        preconditions: [],
        paths: [{ kind: 'action', key: 'action.inspect', interventionPointKey: 'point.inspect' }],
        failForwardEffectPlanRef: null,
        costEffectPlanRef: null,
        allowedAudience: 'private',
        recipientActorKeys: [PLAYER_ACTOR],
        requiresPlayerConfirmation: false,
      },
    }],
    whyNowRefs: ['world:fact.harbor', 'clock:flood'],
    noInterventionOutcome: {
      afterWorldTurns: 3,
      description: '潮水继续上涨',
      effectPlanRef: null,
      advancesClockKeys: ['flood'],
    },
    consequences: [],
    sourceRefs: ['world.harbor'],
    personalizationRefs: [{
      factKey: PLAYER_FACT,
      actorScope: [PLAYER_ACTOR],
      knownByActorKeys: [PLAYER_ACTOR],
      kind: 'choice',
      source: 'player-commitment',
    }],
  }
}

function generationInput(
  candidate: TtrpgSituationGenerationCandidateV1,
  overrides: Partial<TtrpgSituationGenerationInputV1> = {},
): TtrpgSituationGenerationInputV1 {
  return {
    candidate,
    worldTurn: 10,
    playerFactKeys: [PLAYER_FACT],
    playerActorKeys: [PLAYER_ACTOR],
    ...overrides,
  }
}

describe('R-TTRPGOPEN10 situation anti-pattern gates', () => {
  it('keeps 0.79 and rejects 0.80 at the weighted Jaccard boundary', () => {
    expect(calculateWeightedJaccardV1(
      Array.from({ length: 79 }, () => 'physical'),
      Array.from({ length: 100 }, () => 'physical'),
    )).toBeCloseTo(0.79, 10)

    const previous = situation('situation.previous', 100)
    const belowThreshold = evaluateTtrpgSituationGenerationV1(generationInput(
      situation('situation.below', 79),
      { recentSituations: [previous] },
    ))
    expect(belowThreshold.accepted).toBe(true)
    expect(belowThreshold.a1.comparisons[0]?.obstacleKindSimilarity).toBeCloseTo(0.79, 10)
    expect(belowThreshold.a1.comparisons[0]?.suggestedActionSimilarity).toBeCloseTo(0.79, 10)

    const atThreshold = evaluateTtrpgSituationGenerationV1(generationInput(
      situation('situation.at', 80),
      { recentSituations: [previous] },
    ))
    expect(atThreshold.accepted).toBe(false)
    expect(atThreshold.rejections[0]?.code).toBe('A1')
    expect(atThreshold.rejections[0]?.reason).toContain('situation.previous')
    expect(atThreshold.rejections[0]?.comparison?.comparedTemplateKey).toBe('situation.previous')
  })

  it('detects dependency cycles across explicit driver, evidence, and obstacle nodes', () => {
    const cycle = detectTtrpgSituationDependencyCyclesV1({
      dependencies: {
        driver: ['evidence'],
        evidence: ['obstacle'],
        obstacle: ['driver'],
      },
    })
    expect(cycle).toEqual([['driver', 'evidence', 'obstacle', 'driver']])

    const candidate = situation('situation.cycle', 2)
    candidate.obstacles[0]!.dependsOn = ['obstacle.1']
    candidate.obstacles[1]!.dependsOn = ['obstacle.0']
    const checked = checkTtrpgSituationDependenciesV1(candidate)
    expect(checked.passed).toBe(false)
    expect(checked.failures).toContain('cycle')
  })

  it('requires a player fact reference with explicit knownBy and actor scope', () => {
    const candidate = situation('situation.personalized', 2)
    candidate.personalizationRefs = [{
      factKey: PLAYER_FACT,
      actorScope: [],
      knownByActorKeys: [],
      kind: 'choice',
    }]
    const rejected = evaluateTtrpgSituationGenerationV1(generationInput(candidate))
    expect(rejected.accepted).toBe(false)
    expect(rejected.rejections.some(item => item.code === 'A3')).toBe(true)

    candidate.personalizationRefs = [{
      factKey: PLAYER_FACT,
      actorScope: [PLAYER_ACTOR],
      knownByActorKeys: [PLAYER_ACTOR],
      kind: 'commitment',
    }]
    const accepted = evaluateTtrpgSituationGenerationV1(generationInput(candidate))
    expect(accepted.a3.passed).toBe(true)
  })

  it('applies a deterministic three-world-turn cooldown without mutating input', () => {
    const candidate = situation('situation.cooldown', 2)
    const input = generationInput(candidate, {
      cooldownUntilWorldTurn: { [candidate.templateKey]: 13 },
    })
    const rejected = evaluateTtrpgSituationGenerationV1(input)
    expect(rejected.accepted).toBe(false)
    expect(rejected.cooldown.cooldownUntilWorldTurn).toBe(13)
    expect(rejected.rejections.some(item => item.code === 'cooldown')).toBe(true)
    expect(getTtrpgSituationCooldownUntilWorldTurnV1(10)).toBe(13)
    expect(input.cooldownUntilWorldTurn).toEqual({ [candidate.templateKey]: 13 })
    expect(candidate.templateKey).toBe('situation.cooldown')
  })
})
