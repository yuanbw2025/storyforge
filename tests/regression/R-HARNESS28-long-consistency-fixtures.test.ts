import { describe, expect, it } from 'vitest'
import {
  H4_LONG_CONSISTENCY_FIXTURES_V1,
  H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
  H4_LONG_CONSISTENCY_MAX_CHARS_V1,
  H4_LONG_CONSISTENCY_MIN_CHARS_V1,
  LONG_CONSISTENCY_SUBTYPES_V1,
  createLongConsistencyEvalArtifactV1,
  createLongConsistencyFixtureBindingV1,
  getH4LongConsistencyFixturesV1,
  toH4ModelVisibleFixtureV1,
  type LongConsistencyEvalTaskV1,
  verifyLongConsistencyEvalArtifactV1,
} from '../../src/lib/evals/long-consistency'

const TASKS: LongConsistencyEvalTaskV1[] = ['generation', 'continuation', 'expansion', 'completion']

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {} as Record<T, number>)
}

describe('R-HARNESS28 · H4 Chinese long-form fixture catalog', () => {
  it('freezes exactly 40 development and 20 held-out cases with opaque public ids', () => {
    const development = getH4LongConsistencyFixturesV1('development')
    const heldOut = getH4LongConsistencyFixturesV1('held-out')
    expect(development).toHaveLength(40)
    expect(heldOut).toHaveLength(20)
    expect(H4_LONG_CONSISTENCY_FIXTURES_V1).toHaveLength(60)
    expect(new Set(H4_LONG_CONSISTENCY_FIXTURES_V1.map(fixture => fixture.id)).size).toBe(60)
    expect(H4_LONG_CONSISTENCY_FIXTURES_V1.every(
      fixture => fixture.fixtureVersion === H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
    )).toBe(true)
    expect(development[0].id).toBe('h4-dev-01')
    expect(development.at(-1)?.id).toBe('h4-dev-40')
    expect(heldOut[0].id).toBe('h4-held-01')
    expect(heldOut.at(-1)?.id).toBe('h4-held-20')
    expect(H4_LONG_CONSISTENCY_FIXTURES_V1.every(
      fixture => /^h4-(?:dev|held)-\d{2}$/u.test(fixture.id),
    )).toBe(true)
  })

  it('balances all four task types within each split', () => {
    expect(countBy(getH4LongConsistencyFixturesV1('development').map(fixture => fixture.task))).toEqual({
      generation: 10,
      continuation: 10,
      expansion: 10,
      completion: 10,
    })
    expect(countBy(getH4LongConsistencyFixturesV1('held-out').map(fixture => fixture.task))).toEqual({
      generation: 5,
      continuation: 5,
      expansion: 5,
      completion: 5,
    })
    expect(new Set(H4_LONG_CONSISTENCY_FIXTURES_V1.map(fixture => fixture.task))).toEqual(new Set(TASKS))
  })

  it('covers every official subtype twice in development and once in held-out', () => {
    const subtypeCounts = (split: 'development' | 'held-out') => countBy(
      getH4LongConsistencyFixturesV1(split).flatMap(fixture => (
        fixture.hiddenLabels.expectedIssues.map(issue => issue.subtype)
      )),
    )
    const development = subtypeCounts('development')
    const heldOut = subtypeCounts('held-out')
    for (const subtype of LONG_CONSISTENCY_SUBTYPES_V1) {
      expect(development[subtype], `development ${subtype}`).toBe(2)
      expect(heldOut[subtype], `held-out ${subtype}`).toBe(1)
    }
    expect(getH4LongConsistencyFixturesV1('development').filter(
      fixture => fixture.hiddenLabels.cleanControl,
    )).toHaveLength(2)
    expect(getH4LongConsistencyFixturesV1('held-out').filter(
      fixture => fixture.hiddenLabels.cleanControl,
    )).toHaveLength(1)
  })

  it('keeps every narrative within the frozen 8k-12k Chinese-character envelope', () => {
    for (const fixture of H4_LONG_CONSISTENCY_FIXTURES_V1) {
      const narrative = fixture.sources.find(source => source.kind === 'narrative')
      expect(narrative, fixture.id).toBeDefined()
      expect(narrative!.content.length, `${fixture.id} min length`).toBeGreaterThanOrEqual(
        H4_LONG_CONSISTENCY_MIN_CHARS_V1,
      )
      expect(narrative!.content.length, `${fixture.id} max length`).toBeLessThanOrEqual(
        H4_LONG_CONSISTENCY_MAX_CHARS_V1,
      )
      expect(fixture.modelInput.targetChineseChars).toEqual({ min: 8_000, max: 12_000 })
    }
  })

  it('binds every labeled issue to unique verbatim evidence and machine-checked placement', () => {
    for (const fixture of H4_LONG_CONSISTENCY_FIXTURES_V1) {
      const labels = fixture.hiddenLabels
      if (labels.cleanControl) {
        expect(labels.expectedIssues, fixture.id).toEqual([])
        expect(labels.factPositionRatio, fixture.id).toBeNull()
        expect(labels.contradictionPositionRatio, fixture.id).toBeNull()
        continue
      }
      expect(labels.expectedIssues, fixture.id).toHaveLength(1)
      const issue = labels.expectedIssues[0]
      const source = fixture.sources.find(candidate => candidate.id === issue.factEvidence.sourceId)!
      const contradictionSource = fixture.sources.find(
        candidate => candidate.id === issue.contradictionEvidence.sourceId,
      )!
      expect(source, `${fixture.id} fact source`).toBeDefined()
      expect(contradictionSource, `${fixture.id} contradiction source`).toBeDefined()
      expect(source.content.split(issue.factEvidence.quote)).toHaveLength(2)
      expect(contradictionSource.content.split(issue.contradictionEvidence.quote)).toHaveLength(2)
      expect(labels.factPositionRatio!, `${fixture.id} fact position`).toBeGreaterThan(0.05)
      expect(labels.factPositionRatio!, `${fixture.id} fact position`).toBeLessThan(0.2)
      if (labels.evidencePlacement === 'middle') {
        expect(labels.contradictionPositionRatio!, `${fixture.id} middle position`).toBeGreaterThanOrEqual(0.4)
        expect(labels.contradictionPositionRatio!, `${fixture.id} middle position`).toBeLessThanOrEqual(0.6)
      } else {
        expect(labels.contradictionPositionRatio!, `${fixture.id} distant position`).toBeGreaterThan(0.72)
        expect(labels.evidenceDistanceRatio!, `${fixture.id} distant gap`).toBeGreaterThan(0.58)
      }
    }
  })

  it('includes intentional and ambiguous controls without labeling them hard', () => {
    const labeled = H4_LONG_CONSISTENCY_FIXTURES_V1.flatMap(fixture => fixture.hiddenLabels.expectedIssues)
    expect(labeled.filter(issue => issue.intentClassification === 'intentional').length).toBeGreaterThanOrEqual(2)
    expect(labeled.filter(issue => issue.intentClassification === 'ambiguous').length).toBeGreaterThanOrEqual(2)
    for (const fixture of H4_LONG_CONSISTENCY_FIXTURES_V1.filter(item => (
      item.hiddenLabels.expectedIssues.some(issue => issue.intentClassification !== 'unintentional')
    ))) {
      expect(fixture.sources.some(source => source.kind === 'author-intent'), fixture.id).toBe(true)
    }
  })

  it('physically removes hidden labels and injection metadata from model-visible fixtures', () => {
    for (const fixture of H4_LONG_CONSISTENCY_FIXTURES_V1) {
      const visible = toH4ModelVisibleFixtureV1(fixture)
      const serialized = JSON.stringify(visible)
      expect(serialized).not.toContain('hiddenLabels')
      expect(serialized).not.toContain('expectedIssues')
      expect(serialized).not.toContain('evidencePlacement')
      expect(serialized).not.toContain('factPositionRatio')
      expect(serialized).not.toContain('clean-control')
      expect(serialized).not.toContain('无冲突对照')
      expect(serialized).not.toContain(`${fixture.id}:issue-1`)
      for (const issue of fixture.hiddenLabels.expectedIssues) {
        expect(serialized).not.toContain(issue.subtype)
        expect(serialized).not.toContain(issue.summary)
      }
    }
  })

  it('returns an isolated visible clone so callers cannot mutate the frozen catalog', () => {
    const fixture = H4_LONG_CONSISTENCY_FIXTURES_V1[0]
    const original = fixture.sources[0].content
    const visible = toH4ModelVisibleFixtureV1(fixture)
    visible.sources[0].content = 'mutated'
    visible.modelInput.instruction = 'mutated'
    expect(fixture.sources[0].content).toBe(original)
    expect(fixture.modelInput.instruction).not.toBe('mutated')
    expect(Object.isFrozen(H4_LONG_CONSISTENCY_FIXTURES_V1)).toBe(true)
    expect(Object.isFrozen(fixture)).toBe(true)
    expect(Object.isFrozen(fixture.sources)).toBe(true)
    expect(Object.isFrozen(fixture.sources[0])).toBe(true)
    expect(Object.isFrozen(fixture.hiddenLabels.expectedIssues)).toBe(true)
  })

  it('locates every hidden-label evidence pair through the production artifact path', async () => {
    for (const fixture of H4_LONG_CONSISTENCY_FIXTURES_V1) {
      const visible = toH4ModelVisibleFixtureV1(fixture)
      const fixtureBinding = await createLongConsistencyFixtureBindingV1({
        id: fixture.id,
        split: fixture.split,
        task: fixture.task,
        modelInput: visible,
        hiddenLabels: fixture.hiddenLabels,
      })
      const rawJudgeOutput = JSON.stringify({
        schemaVersion: 1,
        issues: fixture.hiddenLabels.expectedIssues.map(issue => ({
          id: issue.id,
          subtype: issue.subtype,
          severity: issue.severity,
          intentClassification: issue.intentClassification,
          summary: issue.summary,
          factEvidence: issue.factEvidence,
          contradictionEvidence: issue.contradictionEvidence,
        })),
      })
      const artifact = await createLongConsistencyEvalArtifactV1({
        runId: `fixture-proof:${fixture.id}`,
        createdAt: new Date(0).toISOString(),
        codeRevision: 'h4-fixture-catalog-test',
        fixture: fixtureBinding,
        generator: {
          provider: 'fixture',
          model: 'deterministic-generator',
          promptVersion: 'h4-fixture-v1',
        },
        verifier: {
          provider: 'fixture',
          model: 'independent-verifier',
          promptVersion: 'h4-long-consistency-judge-v1',
        },
        generationUsage: { inputTokens: 0, outputTokens: 0, durationMs: 0, costUsd: 0 },
        verifierUsage: { inputTokens: 0, outputTokens: 0, durationMs: 0, costUsd: 0 },
        sources: fixture.sources,
        rawJudgeOutput,
        traceHashes: ['a'.repeat(64)],
      })

      expect(artifact.issues, fixture.id).toHaveLength(fixture.hiddenLabels.expectedIssues.length)
      expect(artifact.fixture, fixture.id).toEqual(fixtureBinding)
      expect(artifact.issues.every(issue => (
        issue.pair.fact.endOffset > issue.pair.fact.startOffset
        && issue.pair.contradiction.endOffset > issue.pair.contradiction.startOffset
      )), fixture.id).toBe(true)
      await expect(verifyLongConsistencyEvalArtifactV1(artifact, {
        sources: fixture.sources,
        rawJudgeOutput,
      }), fixture.id).resolves.toBe(true)
    }
  })
})
