import { describe, expect, it } from 'vitest'
import {
  appendTtrpgOpenFailureV1,
  assertTtrpgOpenPublicationGatesV1,
  buildTtrpgOpenEvidenceGraphV1,
  evaluateTtrpgOpenRuntimeGatesV1,
  filterTtrpgOpenFailureLogsFromPlayerProjectionV1,
  recordTtrpgOpenFailureV1,
} from '../../src/lib/ttrpg/open-gates'
import { openCampaignFixture, openRuleFixture, openPublicationCampaignFixture as publishableCampaign } from '../helpers/ttrpg-open-content'
import type { TtrpgPredicateEvaluationContextV1 } from '../../src/lib/ttrpg/predicate'

function predicateContext(campaign = openCampaignFixture()): TtrpgPredicateEvaluationContextV1 {
  return {
    frozenWorldPredicateIndex: campaign.frozenWorldPredicateIndex,
    sessionFacts: [],
    effectLedger: { storyFacts: {}, socialBalances: {} },
    pressure: { clocks: { flood: { value: 3 } }, fronts: { storm: {
      currentStageKey: null,
      escalationStages: [{ stageKey: 'rising' }],
    } } },
    actors: { hero: { locationRef: 'harbor', itemKeys: [], abilityKeys: [], resources: {} } },
    situations: { active: [], templates: [] },
    chaos: 5,
    worldTurn: 2,
    knownRefs: ['hero', 'harbor', 'flood', 'storm', 'rising'],
  }
}

function runtimeInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const campaign = openCampaignFixture()
  return {
    campaign,
    predicateContext: predicateContext(campaign),
    viewer: { actorKey: 'hero', viewerKey: 'viewer.hero' },
    situations: {
      active: [{
        situationKey: 'situation.lighthouse.1',
        templateKey: 'situation.lighthouse',
        status: 'active',
        activatedAtSequence: 1,
        activatedAtWorldTurn: 0,
        activationReason: 'opening',
        whyNowRefs: ['world:fact.harbor', 'clock:flood'],
        satisfiedObstacleKeys: ['door'],
        discoveredEvidenceRefs: ['evidence.door'],
        noInterventionDueWorldTurn: 3,
        resolvedAtSequence: null,
        resolutionKind: null,
      }],
    },
    pressure: {
      clocks: { flood: { value: 2 } },
      fronts: { storm: { currentStageKey: null, telegraphWorldTurns: { wind: 1 }, defeated: false } },
    },
    worldTurn: 2,
    sessionFacts: [],
    ...overrides,
  }
}

describe('R-TTRPGOPEN6 open runtime gates', () => {
  it('publishes the nine open gates and exposes the explicit evidence graph', () => {
    const campaign = publishableCampaign()
    const rule = openRuleFixture()
    rule.license.commercialUse = true
    const report = assertTtrpgOpenPublicationGatesV1(campaign, rule)
    expect(report.valid).toBe(true)
    expect(report.gates.map(gate => gate.gateId)).toEqual([
      'product.narrative.play-loop',
      'product.ttrpg.rules',
      'product.ttrpg.open-situation-layer',
      'product.ttrpg.open-pressure',
      'product.ttrpg.open-canon',
      'product.ttrpg.safety-and-companions',
      'product.ttrpg.open-closure',
      'product.ttrpg.open-effect-plans',
      'product.ttrpg.open-clock-disjoint',
    ])
    const graph = buildTtrpgOpenEvidenceGraphV1(campaign.situationTemplates[0])
    expect(graph.edges.evidenceToObstacle).toEqual([
      { from: 'evidence.door', to: 'door' },
      { from: 'evidence.lamp', to: 'lamp' },
    ])
    expect(graph.edges.obstacleToObstacle).toEqual([{ from: 'lamp', to: 'door' }])
    expect(graph.edges.interventionToObstacle).toEqual([
      { from: 'point.door', to: 'door' },
      { from: 'point.lamp', to: 'lamp' },
    ])
  })

  it('checks G1 and G2 against the current player projection', () => {
    const result = evaluateTtrpgOpenRuntimeGatesV1(runtimeInput())
    expect(result.results['exit-exists'].passed).toBe(true)
    expect(result.results['hypothesis-formable'].passed).toBe(true)

    const hiddenCampaign = openCampaignFixture()
    for (const point of hiddenCampaign.situationTemplates[0].interventionPoints) {
      point.visibleTo = 'private'
      point.knownByActorKeys = ['hero']
    }
    const hidden = runtimeInput({
      campaign: hiddenCampaign,
      viewer: { actorKey: 'other', viewerKey: 'viewer.other' },
    })
    const hiddenResult = evaluateTtrpgOpenRuntimeGatesV1(hidden)
    expect(hiddenResult.results['exit-exists'].passed).toBe(false)
    expect(hiddenResult.results['hypothesis-formable'].passed).toBe(false)
  })

  it('uses the one-turn imminent threshold and rejects a two-turn early stage', () => {
    const oneTurn = evaluateTtrpgOpenRuntimeGatesV1(runtimeInput({
      worldTurn: 2,
      pressure: { clocks: { flood: { value: 2 } }, fronts: {
        storm: { currentStageKey: null, telegraphWorldTurns: { wind: 1 }, defeated: false },
      } },
    }))
    expect(oneTurn.results['telegraph-complete'].passed).toBe(true)

    const twoTurns = evaluateTtrpgOpenRuntimeGatesV1(runtimeInput({
      worldTurn: 1,
      pressure: { clocks: { flood: { value: 1 } }, fronts: {
        storm: { currentStageKey: null, telegraphWorldTurns: {}, defeated: false },
      } },
    }))
    expect(twoTurns.results['telegraph-complete'].passed).toBe(true)
    expect(twoTurns.results['telegraph-complete'].evidence).toContain('imminentStages=0')
  })

  it('keeps G4 incremental and full evaluations equivalent', () => {
    const facts = Array.from({ length: 501 }, (_, index) => ({
      factKey: `fact.harbor.knows.${index}`,
      subjectRef: 'hero',
      predicateKey: 'knows',
      objectRef: `clue.${index}`,
      canonicalValue: `clue-${index}`,
      retired: false,
    }))
    const full = evaluateTtrpgOpenRuntimeGatesV1(runtimeInput({ sessionFacts: facts.slice(0, 2) }))
    const incremental = evaluateTtrpgOpenRuntimeGatesV1(runtimeInput({ sessionFacts: facts }))
    expect(incremental.results['facts-consistent'].passed).toBe(full.results['facts-consistent'].passed)
    expect(incremental.results['facts-consistent'].evidence.slice(-1)[0]).toBe('activeFacts=501')
    expect(incremental.results['facts-consistent'].evidence[0]).toBe('validation=incremental')
  })

  it('requests author review after three consecutive applicable failures', () => {
    const input = runtimeInput({
      situations: { active: [] },
      consecutiveFailures: { 'exit-exists': 2 },
    })
    const result = evaluateTtrpgOpenRuntimeGatesV1(input)
    expect(result.consecutiveFailures['exit-exists']).toBe(3)
    expect(result.recovery['exit-exists']).toBe('request-author-review')
    expect(result.requestAuthorReview).toContain('exit-exists')

    const closed = evaluateTtrpgOpenRuntimeGatesV1({ ...input, stageStatus: 'closed' })
    expect(closed.results['exit-exists'].applicability).toBe('not-applicable')
    expect(closed.results['exit-exists'].passed).toBeNull()
    expect(closed.consecutiveFailures['exit-exists']).toBe(2)
  })

  it('constructs the E18 log, caps the ring buffer at 200, and filters player output', () => {
    const first = recordTtrpgOpenFailureV1({
      sessionId: 1,
      atSequence: 1,
      atWorldTurn: 1,
      category: 'gate-failed',
      violatedRule: 'gate.exit-exists',
      evidence: ['no exit'],
    })
    let buffer = { failures: [] as typeof first[], droppedCount: 0 }
    for (let index = 0; index < 201; index += 1) {
      const log = { ...first, atSequence: index + 1, evidence: [`sequence=${index + 1}`] }
      buffer = appendTtrpgOpenFailureV1(buffer.failures, log)
    }
    expect(buffer.failures).toHaveLength(200)
    expect(buffer.failures[0].atSequence).toBe(2)
    expect(buffer.droppedCount).toBe(1)

    const projected = filterTtrpgOpenFailureLogsFromPlayerProjectionV1({
      text: '可见叙述',
      openRun: { failures: buffer.failures, worldTurn: 3 },
    })
    expect(projected).toEqual({ text: '可见叙述', openRun: { worldTurn: 3 } })
  })
})
