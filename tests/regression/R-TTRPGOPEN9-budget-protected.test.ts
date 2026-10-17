import { describe, expect, it } from 'vitest'
import {
  assembleTtrpgContextWithBudgetV1,
  parseTtrpgContextBudgetReceiptV1,
  TtrpgContextBudgetErrorV1,
} from '../../src/lib/ttrpg/context-budget'
import {
  parseTtrpgContextTriggerV1,
  selectTtrpgContextInjectionsV1,
} from '../../src/lib/ttrpg/context-trigger'
import type { TtrpgPredicateEvaluationContextV1 } from '../../src/lib/ttrpg/predicate'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'

const triggerSource = 'ttrpgRuntime'

function context(): TtrpgPredicateEvaluationContextV1 {
  const campaign = openCampaignFixture()
  return {
    frozenWorldPredicateIndex: campaign.frozenWorldPredicateIndex,
    sessionFacts: [],
    effectLedger: { storyFacts: {}, socialBalances: {} },
    pressure: { clocks: {}, fronts: {} },
    actors: {},
    situations: { active: [], templates: [] },
    chaos: 5,
    worldTurn: 4,
    knownRefs: [],
  }
}

function trigger(overrides: Record<string, unknown> = {}) {
  return parseTtrpgContextTriggerV1({
    triggerKey: 'storm-warning',
    logic: 'both',
    textPatterns: ['  Storm  '],
    predicate: { op: 'world-turn-at-least', value: 3 },
    audience: 'party',
    knownByActorKeys: [],
    injectText: 'The storm is closing in.',
    group: 'weather',
    priority: 80,
    timing: { stickyWorldTurns: 1, cooldownWorldTurns: 1, delayWorldTurns: 0 },
    sourceRefs: [triggerSource],
    ...overrides,
  })
}

describe('R-TTRPGOPEN9 P7 context trigger and protected budget', () => {
  it('parses a trigger, evaluates its predicate, applies audience filtering, and chooses a group winner deterministically', () => {
    const lowerPriority = trigger({
      triggerKey: 'quiet-weather',
      injectText: 'The air is still.',
      priority: 20,
    })
    const selected = selectTtrpgContextInjectionsV1({
      triggers: [lowerPriority, trigger()],
      text: 'We search for signs of a storm.',
      worldTurn: 4,
      predicateContext: context(),
      viewer: { audience: 'party' },
    })

    expect(selected).toHaveLength(1)
    expect(selected[0]).toMatchObject({
      triggerKey: 'storm-warning',
      injectText: 'The storm is closing in.',
      sourceKey: triggerSource,
      matchedBy: 'both',
    })
  })

  it('supports whole-word matching while keeping Chinese matching substring based', () => {
    const english = parseTtrpgContextTriggerV1({
      triggerKey: 'keyword',
      logic: 'text-match',
      textPatterns: ['open'],
      predicate: null,
      audience: 'public',
      knownByActorKeys: [],
      injectText: 'matched',
      group: null,
      priority: 1,
      timing: { stickyWorldTurns: 0, cooldownWorldTurns: 0, delayWorldTurns: 0 },
      sourceRefs: [triggerSource],
    })
    const chinese = parseTtrpgContextTriggerV1({
      triggerKey: 'chinese-keyword',
      logic: 'text-match',
      textPatterns: ['渡口'],
      predicate: null,
      audience: 'public',
      knownByActorKeys: [],
      injectText: 'matched',
      group: null,
      priority: 1,
      timing: { stickyWorldTurns: 0, cooldownWorldTurns: 0, delayWorldTurns: 0 },
      sourceRefs: [triggerSource],
    })

    expect(selectTtrpgContextInjectionsV1({
      triggers: [english],
      text: 'reopen the gate',
      worldTurn: 0,
    })).toEqual([])
    expect(selectTtrpgContextInjectionsV1({
      triggers: [chinese],
      text: '沿着旧渡口继续走',
      worldTurn: 0,
    })).toHaveLength(1)
  })

  it('keeps private triggers private and rejects malformed or unregistered triggers', () => {
    expect(() => parseTtrpgContextTriggerV1({
      ...trigger(),
      audience: 'private',
      knownByActorKeys: [],
    })).toThrow(/private trigger/)
    expect(() => parseTtrpgContextTriggerV1({
      ...trigger(),
      sourceRefs: ['not-registered'],
    })).toThrow(/未登记 sourceKey/)
    expect(() => parseTtrpgContextTriggerV1({
      ...trigger(),
      logic: 'always',
    })).toThrow(/always/)

    const privateTrigger = trigger({
      triggerKey: 'private-warning',
      logic: 'always',
      textPatterns: [],
      predicate: null,
      audience: 'private',
      knownByActorKeys: ['actor-alice'],
      group: null,
    })
    expect(selectTtrpgContextInjectionsV1({
      triggers: [privateTrigger],
      worldTurn: 0,
      viewer: { audience: 'private', actorKey: 'actor-bob' },
    })).toEqual([])
    expect(selectTtrpgContextInjectionsV1({
      triggers: [privateTrigger],
      worldTurn: 0,
      viewer: { audience: 'private', actorKey: 'actor-alice' },
    })).toHaveLength(1)
    expect(selectTtrpgContextInjectionsV1({
      triggers: [privateTrigger],
      worldTurn: 0,
      viewer: { audience: 'gm-only' },
    })).toHaveLength(1)
  })

  it('applies sticky and cooldown timing without mutating trigger state', () => {
    const candidate = trigger({
      logic: 'text-match',
      textPatterns: ['alarm'],
      predicate: null,
      group: null,
      timing: { stickyWorldTurns: 2, cooldownWorldTurns: 2, delayWorldTurns: 0 },
    })
    const state = { triggerKey: 'storm-warning', lastTriggeredWorldTurn: 3 }
    expect(selectTtrpgContextInjectionsV1({
      triggers: [candidate],
      text: '',
      worldTurn: 4,
      triggerStates: [state],
      viewer: { audience: 'party' },
    })).toHaveLength(1)
    expect(selectTtrpgContextInjectionsV1({
      triggers: [candidate],
      text: '',
      worldTurn: 6,
      triggerStates: [state],
      viewer: { audience: 'party' },
    })).toHaveLength(0)
    expect(state).toEqual({ triggerKey: 'storm-warning', lastTriggeredWorldTurn: 3 })
  })

  it('zero sticky duration cannot bypass cooldown in the original world turn', () => {
    const candidate = trigger({ logic: 'text-match', textPatterns: ['alarm'], predicate: null, group: null,
      timing: { stickyWorldTurns: 0, cooldownWorldTurns: 2, delayWorldTurns: 0 } })
    expect(selectTtrpgContextInjectionsV1({ triggers: [candidate], text: 'alarm', worldTurn: 3,
      triggerStates: [{ triggerKey: candidate.triggerKey, lastTriggeredWorldTurn: 3 }], audience: 'party' })).toEqual([])
    const noTiming = { ...candidate, timing: { stickyWorldTurns: 0, cooldownWorldTurns: 0, delayWorldTurns: 0 } }
    expect(selectTtrpgContextInjectionsV1({ triggers: [noTiming], text: 'alarm', worldTurn: 3,
      triggerStates: [{ triggerKey: candidate.triggerKey, lastTriggeredWorldTurn: 3 }], audience: 'party' })).toHaveLength(1)
  })

  it('demotes complete tiers in the fixed order and retains required/protected layers', () => {
    const blocks = [
      ['rules', 'ttrpgRuntime', 20, true, false],
      ['authority-state', 'ttrpgDirector', 20, false, true],
      ['active-situations', 'ttrpgPlayerRuntime', 10, false, false],
      ['known-facts', 'ttrpgPublicNarration', 9, false, false],
      ['recent-events', 'ttrpgNpcRuntime', 8, false, false],
      ['memory-summary', 'ttrpgPrivateGuidance', 7, false, false],
      ['dynamic-injection', 'ttrpgDirector', 6, false, false],
      ['flavor', 'ttrpgRuntime', 5, false, false],
    ] as const
    const result = assembleTtrpgContextWithBudgetV1(
      blocks.map(([tierKey, sourceKey, tokens, required, protectedBlock]) => ({
        tierKey,
        sourceKey,
        content: `${tierKey}-content`,
        tokens,
        required,
        protected: protectedBlock,
      })),
      65,
    )

    expect(result.receipt.tiers.filter(tier => tier.demoted).map(tier => tier.tierKey)).toEqual([
      'recent-events',
      'memory-summary',
      'dynamic-injection',
      'flavor',
    ])
    expect(result.receipt.tiers.find(tier => tier.tierKey === 'rules')).toMatchObject({
      demotable: false,
      demoted: false,
      includedTokens: 20,
    })
    expect(result.receipt.tiers.find(tier => tier.tierKey === 'authority-state')).toMatchObject({
      demotable: false,
      demoted: false,
      includedTokens: 20,
    })
    expect(result.text).toContain('active-situations-content')
    expect(result.text).not.toContain('flavor-content')
    expect(result.receipt.totalTokens).toBeLessThanOrEqual(65)
  })

  it('is independent of input order and rejects an unregistered source key', () => {
    const first = assembleTtrpgContextWithBudgetV1({
      budgetTokens: 100,
      blocks: [
        { tierKey: 'flavor', sourceKey: 'ttrpgRuntime', content: 'z', tokens: 1, blockKey: 'z' },
        { tierKey: 'rules', sourceKey: 'ttrpgRuntime', content: 'a', tokens: 1, required: true, blockKey: 'a' },
      ],
    })
    const second = assembleTtrpgContextWithBudgetV1({
      budgetTokens: 100,
      blocks: [
        { tierKey: 'rules', sourceKey: 'ttrpgRuntime', content: 'a', tokens: 1, required: true, blockKey: 'a' },
        { tierKey: 'flavor', sourceKey: 'ttrpgRuntime', content: 'z', tokens: 1, blockKey: 'z' },
      ],
    })
    expect(second).toEqual(first)
    expect(() => assembleTtrpgContextWithBudgetV1({
      budgetTokens: 10,
      blocks: [{ tierKey: 'rules', sourceKey: 'unknown-source', content: 'x', tokens: 1 }],
    })).toThrow(/未登记 sourceKey/)
  })

  it('fails closed with a receipt when protected layers alone exceed the budget', () => {
    expect(() => assembleTtrpgContextWithBudgetV1({
      budgetTokens: 100,
      blocks: [
        { tierKey: 'rules', sourceKey: 'ttrpgRuntime', content: 'rules', tokens: 60, required: true },
        { tierKey: 'authority-state', sourceKey: 'ttrpgDirector', content: 'authority', tokens: 50, protected: true },
        { tierKey: 'flavor', sourceKey: 'ttrpgRuntime', content: 'flavor', tokens: 10 },
      ],
    })).toThrow(TtrpgContextBudgetErrorV1)

    try {
      assembleTtrpgContextWithBudgetV1({
        budgetTokens: 100,
        blocks: [
          { tierKey: 'rules', sourceKey: 'ttrpgRuntime', content: 'rules', tokens: 60, required: true },
          { tierKey: 'authority-state', sourceKey: 'ttrpgDirector', content: 'authority', tokens: 50, protected: true },
        ],
      })
    } catch (error) {
      expect(error).toBeInstanceOf(TtrpgContextBudgetErrorV1)
      const receipt = (error as TtrpgContextBudgetErrorV1).receipt
      expect(receipt.overflowHandled).toBe(true)
      expect(receipt.totalTokens).toBe(110)
      expect(receipt.tiers.filter(tier => tier.demoted)).toEqual([])
      expect(parseTtrpgContextBudgetReceiptV1(receipt)).toEqual(receipt)
    }
  })

  it('rejects malformed receipts and preserves the fixed non-demotable contract', () => {
    const valid = {
      tiers: [
        { tierKey: 'rules', demotable: false, includedTokens: 3, demoted: false, demoteReason: null },
      ],
      totalTokens: 3,
      budgetTokens: 10,
      overflowHandled: false,
    }
    expect(parseTtrpgContextBudgetReceiptV1(valid)).toEqual(valid)
    expect(() => parseTtrpgContextBudgetReceiptV1({
      ...valid,
      tiers: [{ ...valid.tiers[0], demotable: true }],
    })).toThrow(/不可降级层/)
    expect(() => parseTtrpgContextBudgetReceiptV1({
      ...valid,
      totalTokens: 4,
    })).toThrow(/totalTokens/)
    expect(() => parseTtrpgContextBudgetReceiptV1({
      ...valid,
      tiers: [{ ...valid.tiers[0], tierKey: 'not-a-tier' }],
    })).toThrow(/枚举无效/)
    expect(() => parseTtrpgContextBudgetReceiptV1({
      tiers: [
        { tierKey: 'known-facts', demotable: true, includedTokens: 0, demoted: true, demoteReason: 'budget-overflow:fixed-order' },
        { tierKey: 'flavor', demotable: true, includedTokens: 0, demoted: true, demoteReason: 'budget-overflow:fixed-order' },
      ],
      totalTokens: 0,
      budgetTokens: 10,
      overflowHandled: true,
    })).toThrow(/固定降级顺序/)
  })
})
