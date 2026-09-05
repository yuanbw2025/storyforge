import { describe, expect, it } from 'vitest'
import {
  CONTEXT_SELECTOR_POLICIES_V1,
  getContextSelectorPolicyV1,
  selectContextResourcesV1,
} from '../../src/lib/context-gateway/selector'
import { createContextSufficiencyReportV1 } from '../../src/lib/context-gateway/contracts'
import type {
  ContextAccessPolicyV1,
  ContextResourceDescriptorV1,
  ContextResourceKind,
} from '../../src/lib/registry/types'
import { AGENT_CONTEXT_TASK_KINDS, type AgentContextTaskKind } from '../../src/lib/agent/context-policy'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function descriptor(input: {
  key: string
  kind: ContextResourceKind
  title?: string
  tokens?: number
  priority?: ContextResourceDescriptorV1['priority']
  authority?: ContextResourceDescriptorV1['authority']
  revision?: number
  worldId?: number
  workId?: number
  worldGroupId?: number
  chapterId?: number
  time?: { start?: number | string; end?: number | string; throughChapterId?: number }
  relations?: ContextResourceDescriptorV1['relations']
  weight?: number
}): ContextResourceDescriptorV1 {
  const tokens = input.tokens ?? 400
  return {
    version: 1,
    resourceKey: input.key,
    sourceKey: 'ragSelection',
    kind: input.kind,
    title: input.title ?? input.key,
    shortSummary: `${input.key} 的确定性短摘`,
    authority: input.authority ?? 'author-canon',
    contentRevision: input.revision ?? 1,
    contentHash: input.revision === 2 ? HASH_B : HASH_A,
    policyRevision: 1,
    policyHash: HASH_B,
    scope: {
      projectId: 1,
      worldId: input.worldId ?? 11,
      worldGroupId: input.worldGroupId ?? 21,
      ...(input.workId == null ? {} : { workId: input.workId }),
      ...(input.chapterId == null ? {} : { chapterId: input.chapterId }),
    },
    relations: input.relations ?? [],
    ...(input.time ? { timeRange: input.time } : {}),
    sourceRefs: [{ table: 'worldviews', recordId: 1, field: 'races', revision: 1, contentHash: HASH_A }],
    tokenEstimate: { index: 20, summary: Math.min(120, tokens), focused: tokens, full: tokens, original: tokens },
    availableDepths: ['index', 'summary', 'focused', 'full', 'original'],
    priority: input.priority ?? 'normal',
    retrievalWeight: input.weight ?? 1,
    tokenCap: 50_000,
  }
}

function accessPolicy(taskKind: AgentContextTaskKind, maxRetrievedTokens = 30_000): ContextAccessPolicyV1 {
  return {
    version: 'context-access-policy-v1',
    policyId: `test-${taskKind}`,
    mandatorySourceKeys: ['ragSelection'],
    allowedSourceKeys: ['ragSelection'],
    allowedResourceKinds: [
      'workspace', 'world', 'worldview-field', 'story-core-field', 'character', 'character-relation',
      'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'chapter', 'foreshadow',
      'location', 'codex-entry', 'world-link', 'fact', 'reference', 'narrative-blueprint',
    ],
    allowedDepths: ['index', 'summary', 'focused', 'full'],
    selectorPolicyId: getContextSelectorPolicyV1(taskKind).selectorPolicyId,
    maxReadCalls: 50,
    maxRetrievedTokens,
    allowOriginalRead: false,
    candidateAccess: 'explicit-resource-key-only',
  }
}

const scope = { projectId: 1, worldId: 11, worldGroupId: 21, workId: 31 }

describe('R-CTXG5 Context Gateway deterministic selector', () => {
  it('defines one frozen selector policy for every registered task kind', () => {
    expect(Object.keys(CONTEXT_SELECTOR_POLICIES_V1).sort()).toEqual([...AGENT_CONTEXT_TASK_KINDS].sort())
    for (const taskKind of AGENT_CONTEXT_TASK_KINDS) {
      const policy = getContextSelectorPolicyV1(taskKind)
      expect(policy.taskKind).toBe(taskKind)
      expect(Object.values(policy.categoryShares).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
      expect(policy.maxAutomaticResources).toBeGreaterThan(0)
    }
  })

  it('delivers explicit Mandatory and every pinned/must-read resource independent of catalog order', async () => {
    const resources = [
      descriptor({ key: 'worldview-field:w:races', kind: 'worldview-field', priority: 'must-read' }),
      descriptor({ key: 'character:w:hero', kind: 'character', priority: 'pinned' }),
      descriptor({ key: 'story-core-field:w:main', kind: 'story-core-field' }),
      descriptor({ key: 'world-link:w:gate', kind: 'world-link' }),
      descriptor({ key: 'reference:w:manual', kind: 'reference' }),
    ]
    const run = (descriptors: ContextResourceDescriptorV1[]) => selectContextResourcesV1({
      taskKind: 'agent-world-origin',
      accessPolicy: accessPolicy('agent-world-origin'),
      scope,
      descriptors,
      budgetTokens: 12_000,
      mandatoryResourceKeys: ['reference:w:manual'],
      targetResourceKeys: ['worldview-field:w:races'],
      readsAllowed: true,
    })
    const first = await run(resources)
    const last = await run([...resources].reverse())
    expect(first).toEqual(last)
    expect(first.selectorHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.selected.filter(item => item.hardRequirement).map(item => item.resourceKey)).toEqual(expect.arrayContaining([
      'worldview-field:w:races', 'character:w:hero', 'reference:w:manual',
    ]))
    expect(first.sufficiency.obligations.filter(item => item.required).every(item => item.status === 'satisfied')).toBe(true)
  })

  it('reserves category capacity so one huge world resource cannot evict character, story, fact and a small world anchor', async () => {
    const result = await selectContextResourcesV1({
      taskKind: 'agent-prose',
      accessPolicy: accessPolicy('agent-prose', 6_000),
      scope,
      descriptors: [
        descriptor({ key: 'worldview-field:w:huge', kind: 'worldview-field', tokens: 5_000, weight: 5 }),
        descriptor({ key: 'worldview-field:w:anchor', kind: 'worldview-field', tokens: 350 }),
        descriptor({ key: 'character:w:hero', kind: 'character', tokens: 700 }),
        descriptor({ key: 'story-arc:w:main', kind: 'story-arc', tokens: 700 }),
        descriptor({ key: 'fact:w:oath', kind: 'fact', tokens: 700 }),
        descriptor({ key: 'narrative-blueprint:w:active', kind: 'narrative-blueprint', tokens: 700 }),
      ],
      budgetTokens: 6_000,
      readsAllowed: true,
    })
    expect(result.selected.map(item => item.resourceKey)).toEqual(expect.arrayContaining([
      'worldview-field:w:anchor', 'character:w:hero', 'story-arc:w:main', 'fact:w:oath', 'narrative-blueprint:w:active',
    ]))
    expect(result.overBudget).toBe(false)
    for (const category of ['world', 'character', 'story-planning', 'prose-fact'] as const) {
      const budget = result.categoryBudgets.find(item => item.category === category)!
      expect(budget.selectedResourceCount).toBeGreaterThan(0)
    }
  })

  it('caps automatic disclosure while keeping an exact-query late resource inside the world-origin top 20', async () => {
    const resources = Array.from({ length: 60 }, (_, index) => descriptor({
      key: `character:w:${index + 1}`,
      kind: 'character',
      title: index === 59 ? '末位航契守卫' : `目录角色 ${index + 1}`,
      tokens: 20,
      revision: index + 1,
    }))
    const result = await selectContextResourcesV1({
      taskKind: 'agent-world-origin',
      accessPolicy: accessPolicy('agent-world-origin'),
      scope,
      descriptors: resources,
      budgetTokens: 24_000,
      query: '为末位航契守卫设计种族关系',
      readsAllowed: false,
    })
    expect(result.selected.filter(item => !item.hardRequirement)).toHaveLength(20)
    expect(result.selected.map(item => item.resourceKey)).toContain('character:w:60')
    expect(result.omitted).toHaveLength(39)
    expect(result.overBudget).toBe(false)
  })

  it('adds only one-hop high-risk relations and keeps relevant early anchors plus recent changes', async () => {
    const result = await selectContextResourcesV1({
      taskKind: 'agent-outline',
      accessPolicy: accessPolicy('agent-outline'),
      scope,
      descriptors: [
        descriptor({
          key: 'character:w:hero', kind: 'character', revision: 5,
          relations: [{ kind: 'depends-on', targetResourceKey: 'fact:w:oath', direction: 'outgoing' }],
        }),
        descriptor({
          key: 'fact:w:oath', kind: 'fact', revision: 2, time: { start: 1, throughChapterId: 1 },
          relations: [{ kind: 'depends-on', targetResourceKey: 'reference:w:second-hop', direction: 'outgoing' }],
        }),
        descriptor({ key: 'reference:w:second-hop', kind: 'reference', revision: 9 }),
        descriptor({ key: 'chapter:w:middle', kind: 'chapter', revision: 3, chapterId: 8, time: { start: 8, throughChapterId: 8 } }),
        descriptor({ key: 'story-core-field:w:main', kind: 'story-core-field', revision: 8 }),
      ],
      budgetTokens: 12_000,
      targetResourceKeys: ['character:w:hero'],
      entityKeys: ['character:w:hero'],
      timeRange: { throughChapterId: 8 },
      readsAllowed: true,
    })
    const oath = result.selected.find(item => item.resourceKey === 'fact:w:oath')!
    expect(oath.reasonCodes).toContain('one-hop-high-risk')
    expect(oath.reasonCodes).toContain('early-anchor')
    const secondHop = result.selected.find(item => item.resourceKey === 'reference:w:second-hop')
    expect(secondHop?.reasonCodes).not.toContain('one-hop-high-risk')
    expect(result.selected.some(item => item.reasonCodes.includes('recent-change'))).toBe(true)
  })

  it('blocks missing Mandatory, over-budget hard delivery and same-name conflicting Canon with structured obligations', async () => {
    const result = await selectContextResourcesV1({
      taskKind: 'agent-character',
      accessPolicy: accessPolicy('agent-character', 1_000),
      scope,
      descriptors: [
        descriptor({ key: 'character:w:a', kind: 'character', title: '阿澜', tokens: 800, priority: 'must-read' }),
        descriptor({ key: 'character:w:b', kind: 'character', title: '阿澜', tokens: 800, priority: 'pinned', revision: 2 }),
      ],
      budgetTokens: 1_000,
      mandatoryResourceKeys: ['fact:w:missing'],
      readsAllowed: true,
    })
    expect(result.selected.map(item => item.resourceKey)).toEqual(['character:w:a', 'character:w:b'])
    expect(result.overBudget).toBe(true)
    expect(result.sufficiency.additionalRead).toBe('forbidden')
    expect(result.sufficiency.obligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mandatory-resource:fact:w:missing', status: 'missing', required: true }),
      expect.objectContaining({ id: 'hard-selection-budget', status: 'conflicted', required: true }),
      expect.objectContaining({ id: 'same-name-conflict:character:阿澜', status: 'conflicted', required: true }),
    ]))
  })

  it('allows same-title temporal facts to coexist without treating narrative history as an entity identity conflict', async () => {
    const result = await selectContextResourcesV1({
      taskKind: 'agent-prose',
      accessPolicy: accessPolicy('agent-prose', 4_000),
      scope,
      descriptors: [
        descriptor({ key: 'fact:w:beat-1', kind: 'fact', title: '情感节拍 · 情感节拍', tokens: 300 }),
        descriptor({ key: 'fact:w:beat-2', kind: 'fact', title: '情感节拍 · 情感节拍', tokens: 300, revision: 2 }),
      ],
      budgetTokens: 4_000,
      mandatoryResourceKeys: ['fact:w:beat-1', 'fact:w:beat-2'],
      readsAllowed: true,
    })

    expect(result.selected.map(item => item.resourceKey)).toEqual(['fact:w:beat-1', 'fact:w:beat-2'])
    expect(result.sufficiency.obligations.some(item => item.id.startsWith('same-name-conflict:'))).toBe(false)
  })

  it('keeps cross-scope and implicit candidates out while allowing an explicitly keyed candidate', async () => {
    const resources = [
      descriptor({ key: 'character:w:canon', kind: 'character' }),
      descriptor({ key: 'character:w:candidate', kind: 'character', authority: 'candidate' }),
      descriptor({ key: 'character:other-work', kind: 'character', workId: 99 }),
      descriptor({ key: 'character:other-group', kind: 'character', worldGroupId: 88 }),
    ]
    const hidden = await selectContextResourcesV1({
      taskKind: 'agent-character', accessPolicy: accessPolicy('agent-character'), scope,
      descriptors: resources, budgetTokens: 8_000, readsAllowed: true,
    })
    expect(hidden.selected.map(item => item.resourceKey)).not.toContain('character:w:candidate')
    expect(hidden.omitted).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceKey: 'character:w:candidate', reasonCode: 'candidate-not-explicit' }),
      expect.objectContaining({ resourceKey: 'character:other-work', reasonCode: 'scope-conflict' }),
      expect.objectContaining({ resourceKey: 'character:other-group', reasonCode: 'scope-conflict' }),
    ]))
    expect(hidden.sufficiency.additionalRead).toBe('forbidden')
    expect(hidden.sufficiency.obligations).toContainEqual(expect.objectContaining({
      id: 'catalog-scope-integrity', status: 'conflicted', required: true,
    }))

    const explicit = await selectContextResourcesV1({
      taskKind: 'agent-character', accessPolicy: accessPolicy('agent-character'), scope,
      descriptors: resources, budgetTokens: 8_000,
      mandatoryResourceKeys: ['character:w:candidate'], readsAllowed: true,
    })
    expect(explicit.selected.map(item => item.resourceKey)).toContain('character:w:candidate')
  })

  it('strictly validates sufficiency obligations and makes soft conflicts request another read', async () => {
    await expect(createContextSufficiencyReportV1({
      obligations: [{
        id: 'bad', kind: 'entity', required: true, status: 'satisfied', evidenceResourceKeys: [], reasonCode: 'bad',
      }],
      readsAllowed: true,
    })).rejects.toThrow('evidenceResourceKeys')
    const report = await createContextSufficiencyReportV1({
      obligations: [{
        id: 'soft-conflict', kind: 'conflict-check', required: false, status: 'conflicted',
        evidenceResourceKeys: ['fact:w:a', 'fact:w:b'], reasonCode: 'needs-original-read',
      }],
      readsAllowed: true,
    })
    expect(report.additionalRead).toBe('needed')
  })
})
