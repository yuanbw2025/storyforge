import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { NARRATIVE_KINDS_V1 } from '../../src/lib/types/narrative-ir'
import { projectNarrativeDomainsV1 } from '../../src/lib/world-engine/narrative-domain-projection'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
import corpus from '../acceptance/narrative-world/corpus-v1.json'

const observations: unknown[] = []
const counts = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map(key => [key, values.filter(value => value === key).length]))

describe('NW-1B · unchanged corpus with explicit fixture author annotations', () => {
  beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000); await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.useRealTimers() })
  for (const family of corpus.families) it(`${family.id}: factual, epistemic, historical and intent boundaries`, async () => {
    const source = await seedConfirmedNarrativeDomainV1(family)
    const { bundle, coverage } = await projectNarrativeDomainsV1(source.input)
    expect([...new Set(bundle.records.map(record => record.kind))].sort()).toEqual([...NARRATIVE_KINDS_V1].sort())
    const truth = bundle.records.find(record => record.kind === 'assertion' && record.payload.predicateKey === 'knows')!
    const belief = bundle.records.find(record => record.kind === 'epistemic-event')!
    const intent = bundle.records.find(record => record.kind === 'development')!
    expect(truth.payload).toMatchObject({ value: { kind: 'text', value: family.seed.truth } })
    expect(belief.payload).toMatchObject({ assertedValue: { kind: 'text', value: family.seed.belief }, attitude: 'believe' })
    expect(intent).toMatchObject({ modality: 'intent', visibility: { class: 'author-only' }, payload: { state: 'open' } })
    expect(bundle.records.filter(record => record.reviewState === 'historical')).toHaveLength(1)
    expect(new Set([...coverage.projectedSourceKeys, ...coverage.explicitlyUnsupportedSourceKeys])).toEqual(new Set(coverage.eligibleSelected))
    expect((await db.worldReleases.get(source.release.id!))!.manifestJson).toBe(source.release.manifestJson)
    observations.push({ family: family.id, split: family.split, kinds: counts(bundle.records.map(record => record.kind)),
      eligibleSources: coverage.eligibleSelected.length, projectedSources: coverage.projectedSourceKeys.length,
      unsupportedSources: coverage.explicitlyUnsupportedSourceKeys.length, gaps: counts(coverage.gaps.map(gap => gap.code)),
      excluded: counts(coverage.excluded.map(gap => gap.code)), evidenceSpans: bundle.evidence.length,
      rawBytesInRegisteredProse: coverage.sourceSpans.reduce((sum, span) => sum + span.byteLength, 0),
      evidenceCoveredBytes: coverage.sourceSpans.reduce((sum, span) => sum + span.covered.reduce((total, range) => total + range.end - range.start, 0), 0),
      separatedTruthAndBelief: true, intentExcludedFromFacts: true, historicalStateRetained: true, oldV3BytesPreserved: true })
  })
  afterAll(() => {
    expect(observations).toHaveLength(12)
    const paths = [
      ...fs.readdirSync('src/lib/narrative-domain').map(file => `src/lib/narrative-domain/${file}`),
      ...fs.readdirSync('src/lib/world-engine').filter(file => file.startsWith('narrative-domain-')).map(file => `src/lib/world-engine/${file}`),
      'src/lib/types/narrative-domain.ts', 'src/lib/registry/project-tables.ts', 'src/lib/registry/field-registry.ts', 'src/lib/types/state-card.ts',
      'src/lib/registry/adopt.ts', 'src/lib/registry/adoption-schema.ts', 'src/lib/export/registry-export.ts',
      'src/lib/export/registry-import.ts', 'src/lib/export/backup-trust.ts', 'src/lib/world-engine/semantic-registry-v3.ts',
      'src/lib/context-gateway/canon-provider.ts',
      'tests/helpers/narrative-domain-fixture.ts', 'tests/regression/R-NW-1B-corpus.test.ts',
      'tests/acceptance/narrative-world/corpus-v1.json',
    ]
    const receipt = { schema: 'storyforge.narrative-domain-evaluation', version: 1, workPackage: 'NW-1B', datasetVersion: 1,
      evidenceLevel: 'deterministic-domain-projection-with-explicit-fixture-author-annotations; not-model-extraction-or-query-acceptance',
      modelCalls: 0, independentHumanReviews: 0, queryProviderChanged: false,
      cases: observations, inputHashes: Object.fromEntries(paths.sort().map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')])) }
    if (process.env.NW_DOMAIN_REPORT) fs.writeFileSync(process.env.NW_DOMAIN_REPORT, JSON.stringify(receipt, null, 2) + '\n')
    else expect(receipt).toEqual(JSON.parse(fs.readFileSync('tests/acceptance/narrative-world/domain-projection-20261028-longform-avg-integration-v1.json', 'utf8')))
  })
})
