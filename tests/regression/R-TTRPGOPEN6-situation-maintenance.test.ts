import { describe, expect, it } from 'vitest'
import {
  evaluateTtrpgSituationMaintenanceV1,
  evaluateTtrpgSituationProgressV1,
  instantiateTtrpgSituationV1,
} from '../../src/lib/ttrpg/situation-engine'
import type { TtrpgPredicateEvaluationContextV1 } from '../../src/lib/ttrpg/predicate'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'

function situation(campaign: ReturnType<typeof openCampaignFixture>, key: string, due = 3) {
  const template = structuredClone(campaign.situationTemplates[0])
  template.templateKey = key
  template.whyNowRefs = ['world:harbor:exists', 'clock:flood']
  template.noInterventionOutcome = { ...template.noInterventionOutcome, afterWorldTurns: due }
  return template
}

function predicateContext(campaign: ReturnType<typeof openCampaignFixture>, worldTurn: number, active: string[] = []): TtrpgPredicateEvaluationContextV1 {
  return {
    frozenWorldPredicateIndex: campaign.frozenWorldPredicateIndex,
    sessionFacts: [],
    effectLedger: { storyFacts: {}, socialBalances: {} },
    pressure: { clocks: { flood: { value: 0, visibility: 'party' } }, fronts: {} },
    actors: {},
    situations: {
      active: active.map(templateKey => ({ templateKey, discoveredEvidenceRefs: [] })),
      templates: campaign.situationTemplates.map(template => ({
        templateKey: template.templateKey,
        evidence: template.evidence.map(evidence => ({
          clueRef: evidence.clueRef,
          audience: evidence.audience,
          knownByActorKeys: evidence.knownByActorKeys,
        })),
      })),
    },
    chaos: 5,
    worldTurn,
  }
}

function activeInstance(template: ReturnType<typeof situation>, sequence = 1, worldTurn = 0) {
  return instantiateTtrpgSituationV1({
    template,
    activatedAtSequence: sequence,
    activatedAtWorldTurn: worldTurn,
    activationReason: 'opening',
  })
}

describe('R-TTRPGOPEN6 situation maintenance', () => {
  it('unions progressed evidence and obstacles without deleting earlier progress', () => {
    const campaign = openCampaignFixture()
    const template = situation(campaign, 'situation.progress')
    const instance = activeInstance(template)
    const instanceBefore = structuredClone(instance)
    const first = evaluateTtrpgSituationProgressV1({
      template,
      instance,
      discoveredEvidenceRefs: [template.evidence[0].clueRef],
      satisfiedObstacleKeys: [template.obstacles[0].obstacleKey],
    })
    const repeated = evaluateTtrpgSituationProgressV1({
      template,instance: { ...instance,discoveredEvidenceRefs: first.discoveredEvidenceRefs,satisfiedObstacleKeys: first.satisfiedObstacleKeys },
      discoveredEvidenceRefs: [template.evidence[0].clueRef],satisfiedObstacleKeys: [template.obstacles[0].obstacleKey],
    })
    expect(repeated.discoveredEvidenceRefs).toEqual(first.discoveredEvidenceRefs)
    expect(repeated.satisfiedObstacleKeys).toEqual(first.satisfiedObstacleKeys)
    expect(repeated.newlyDiscoveredEvidenceRefs).toEqual([])
    expect(repeated.newlySatisfiedObstacleKeys).toEqual([])
    expect(() => evaluateTtrpgSituationProgressV1({ template,instance,satisfiedObstacleKeys: [template.obstacles[0].obstacleKey,template.obstacles[0].obstacleKey] })).toThrow(/重复/)
    const next = evaluateTtrpgSituationProgressV1({
      template,
      instance: {
        ...instance,
        discoveredEvidenceRefs: first.discoveredEvidenceRefs,
        satisfiedObstacleKeys: first.satisfiedObstacleKeys,
      },
      discoveredEvidenceRefs: [template.evidence[1].clueRef],
      satisfiedObstacleKeys: [template.obstacles[1].obstacleKey],
    })
    expect(instance).toEqual(instanceBefore)
    expect(next.discoveredEvidenceRefs).toEqual([
      template.evidence[0].clueRef,
      template.evidence[1].clueRef,
    ])
    expect(next.satisfiedObstacleKeys).toEqual([
      template.obstacles[0].obstacleKey,
      template.obstacles[1].obstacleKey,
    ])
  })

  it('emits all four terminal outcomes and writes a three-turn cooldown', () => {
    const campaign = openCampaignFixture()
    const cases: Array<{
      kind: 'intervened' | 'no-intervention' | 'front-defeated' | 'superseded'
      transition: 'resolved' | 'expired'
      worldTurn: number
      predicateContext?: TtrpgPredicateEvaluationContextV1
    }> = [
      { kind: 'intervened', transition: 'resolved', worldTurn: 0, predicateContext: predicateContext(campaign, 0) },
      { kind: 'no-intervention', transition: 'expired', worldTurn: 3 },
      { kind: 'front-defeated', transition: 'resolved', worldTurn: 0 },
      { kind: 'superseded', transition: 'resolved', worldTurn: 0 },
    ]
    for (const [index, testCase] of cases.entries()) {
      const template = situation(campaign, `situation.terminal.${index}`, 3)
      if (testCase.kind === 'intervened') {
        template.obstacles = template.obstacles.map(obstacle => ({
          ...obstacle,
          predicate: { op: 'world-turn-at-least', value: 0 },
        }))
      }
      const instance = activeInstance(template)
      const result = evaluateTtrpgSituationMaintenanceV1({
        template,
        instance,
        worldTurn: testCase.worldTurn,
        resolvedAtSequence: 9 + index,
        predicateContext: testCase.predicateContext,
        resolutionKind: testCase.kind === 'intervened' ? null : testCase.kind,
      })
      expect(result.transition).toBe(testCase.transition)
      expect(result.instance.status).toBe(testCase.transition === 'expired' ? 'expired' : 'resolved')
      expect(result.instance.resolutionKind).toBe(testCase.kind)
      expect(result.cooldownUntilWorldTurn).toBe(testCase.worldTurn + 3)
    }
  })

  it('takes queued templates FIFO, retains an I7 head, and activates at most one', () => {
    const campaign = openCampaignFixture()
    const current = situation(campaign, 'situation.current')
    const first = situation(campaign, 'situation.first')
    const second = situation(campaign, 'situation.second')
    current.evidence = current.evidence.map(evidence => ({
      ...evidence,
      clueRef: `${evidence.clueRef}.current`,
    }))
    const currentInstance = activeInstance(current)
    const result = evaluateTtrpgSituationMaintenanceV1({
      template: current,
      instance: currentInstance,
      worldTurn: 0,
      resolutionKind: 'superseded',
      queuedTemplateKeys: [first.templateKey, second.templateKey],
      templates: [current, first, second],
      predicateContext: predicateContext(campaign, 0),
      cooldownUntilWorldTurn: { [first.templateKey]: 3 },
      templateContext: campaign,
    })
    expect(result.nextActivation).toBeNull()
    expect(result.queuedTemplateKeys).toEqual([first.templateKey, second.templateKey])
    expect(result.queueDecisions[0].action).toBe('retained')
    expect(result.failureLogs[0].category).toBe('situation-capacity')
  })

  it('returns consequence-chain candidates as frozen template references', () => {
    const campaign = openCampaignFixture()
    const current = situation(campaign, 'situation.chain')
    const next = situation(campaign, 'situation.next')
    next.evidence = next.evidence.map(evidence => ({
      ...evidence,
      clueRef: `${evidence.clueRef}.next`,
    }))
    current.consequences = [{
      ...current.consequences[0],
      nextSituationTemplateKey: next.templateKey,
    }]
    const result = evaluateTtrpgSituationMaintenanceV1({
      template: current,
      instance: activeInstance(current),
      worldTurn: 0,
      resolutionKind: 'superseded',
      templates: [current, next],
      templateContext: { ...campaign, situationTemplates: [current, next] },
    })
    expect(result.consequenceCandidates).toEqual([expect.objectContaining({
      templateKey: next.templateKey,
      activationReason: 'consequence',
      effectPlanRef: 'plan.success',
    })])
  })
})
