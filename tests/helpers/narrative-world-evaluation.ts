import corpus from '../acceptance/narrative-world/corpus-v1.json'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorldWork } from '../../src/lib/workspace/works'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { createWorldReferenceV1, resolveWorldReferenceResourceScopeV1 } from '../../src/lib/world-engine/world-reference'
import {
  describeWorldReleaseV1, listAllWorldReleaseResourceDescriptorsV1, readWorldOriginalEvidenceV1,
  readWorldResourceV1, searchWorldReleaseV1, WORLD_RELEASE_RESOURCE_PROVIDER_V1, WorldReleaseResourceProviderErrorV1,
} from '../../src/lib/context-gateway/world-release-provider'
import { buildEditImpactGraphV1, propagateChapterEditStale } from '../../src/lib/consistency/impact-analysis'
import { getUpperProductWorldRequirementAdapterV1 } from '../../src/lib/product/world-requirement-adapters'
import { freezeProductSourcePlanV1, resolveProductSourceReadBoundaryV1 } from '../../src/lib/product/source-contracts'
import { resolveProductProductionWorldCompilationDescriptorsV2 } from '../../src/lib/product-production/world-source'
import type { ContextResourceDescriptorV1, ResourceSearchInputV1 } from '../../src/lib/registry/types'
import type { ProductWorldSourceSelectionV1, ProductionProductKindV1 } from '../../src/lib/types'

export type NarrativeFamily = typeof corpus.families[number]
type Query = NarrativeFamily['queries'][number]
export type BaselineObservation = {
  id: string
  family: string
  split: string
  operation: string
  status: 'pass' | 'gap' | 'unsupported'
  expected: unknown
  observed: unknown
  evidence: string[]
  issue: string | null
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`NW-0B evaluator invariant: ${message}`)
}
const sorted = (items: readonly string[]) => [...items].sort()
const equalSet = (a: readonly string[], b: readonly string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))

/** Test-owned fixture translation. Gold annotations never enter model context,
 * production registries, author storage, or the reader being measured. */
export async function seedNarrativeFamily(family: NarrativeFamily) {
  const created = await createWorkspace({ name: family.title, genres: ['fantasy'], status: 'drafting',
    description: 'NW-0B 原创隔离评测夹具', targetWordCount: 10_000, enableMultiWorld: false,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const now = 1_800_000_000_000
  const localIds = new Map<string, number>()
  const source = (suffix: string) => {
    const value = family.sources.find(item => item.id === `${family.id}:${suffix}`)
    check(value, `missing fixture source ${suffix}`)
    return value
  }
  for (const item of family.sources.filter(s => s.kind === 'character')) {
    const id = await db.characters.add(stampNewRecord(created.scope, 'characters', {
      projectId: created.scope.projectId, name: item.title, identity: item.identity,
      roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: item.text,
      background: '', personality: '', createdAt: now, updatedAt: now,
    } as never, { owner: 'world' })) as number
    localIds.set(item.id, id)
  }
  for (const item of family.sources.filter(s => s.kind === 'chapter')) {
    const outlineId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
      projectId: created.scope.projectId, parentId: null, type: 'chapter', title: item.title,
      summary: item.summary, order: item.order, createdAt: now, updatedAt: now,
    } as never, { owner: 'work' })) as number
    const id = await db.chapters.add(stampNewRecord(created.scope, 'chapters', {
      projectId: created.scope.projectId, outlineNodeId: outlineId, title: item.title, summary: item.summary,
      content: item.text, order: item.order, status: 'draft', wordCount: [...item.text].length, notes: '',
      createdAt: now, updatedAt: now,
    } as never, { owner: 'work' })) as number
    localIds.set(item.id, id)
  }
  for (const item of family.sources.filter(s => s.kind === 'story-arc')) {
    const id = await db.storyArcs.add(stampNewRecord(created.scope, 'storyArcs', {
      projectId: created.scope.projectId, name: item.title, description: item.text,
      type: item.id.endsWith('main') ? 'main' : 'sub', stages: '[]', origin: 'manual', status: 'active',
      createdAt: now, updatedAt: now,
    } as never, { owner: 'work' })) as number
    localIds.set(item.id, id)
  }
  for (const [suffix, action] of [['a', 'mislearn'], ['b', 'learn']] as const) {
    const id = await db.knowledgeLedger.add(stampNewRecord(created.scope, 'knowledgeLedger', {
      projectId: created.scope.projectId, characterId: localIds.get(`${family.id}:character-${suffix}`),
      characterName: source(`character-${suffix}`).title, knowledgeKey: `${family.id}:proposition`,
      statement: family.seed.truth, belief: action === 'mislearn' ? family.seed.belief : null,
      action, sourceType: 'chapter', sourceChapterId: localIds.get(`${family.id}:chapter-2`),
      sourceQuote: family.seed.knowledgeQuote, status: 'confirmed', createdAt: now, updatedAt: now,
    } as never, { owner: 'work' })) as number
    localIds.set(`${family.id}:knowledge-${suffix}`, id)
  }
  const factIds = new Map<string, number>()
  for (const status of ['confirmed', 'candidate', 'stale', 'rejected', 'source-missing', 'invalid-range'] as const) {
    const id = await db.temporalFacts.add(stampNewRecord(created.scope, 'temporalFacts', {
      projectId: created.scope.projectId, subjectName: `${family.id}:fact-${status}`, predicate: 'knows',
      characterId: localIds.get(`${family.id}:character-b`), factKind: 'event', value: family.seed.truth,
      sourceType: 'chapter', sourceChapterId: localIds.get(`${family.id}:chapter-2`), sourceQuote: family.seed.knowledgeQuote,
      validFromChapterId: localIds.get(`${family.id}:chapter-2`), validToChapterId: null,
      status, locked: false, createdAt: now, updatedAt: now,
    } as never, { owner: 'work' })) as number
    factIds.set(status, id)
  }
  // Explicit manual fixture assertions for the history lifecycle control.
  // They are not extracted from the stories or included in semantic QA gold.
  const historicalId = await db.temporalFacts.add(stampNewRecord(created.scope, 'temporalFacts', {
    projectId: created.scope.projectId, subjectName: `${family.id}:fact-superseded`, predicate: 'location',
    characterId: localIds.get(`${family.id}:character-a`), factKind: 'state', value: '旧驿站', sourceType: 'manual',
    validFromChapterId: localIds.get(`${family.id}:chapter-1`), validToChapterId: localIds.get(`${family.id}:chapter-2`),
    status: 'superseded', locked: false, createdAt: now, updatedAt: now,
  } as never, { owner: 'work' })) as number
  factIds.set('superseded', historicalId)
  await db.temporalFacts.add(stampNewRecord(created.scope, 'temporalFacts', {
    projectId: created.scope.projectId, subjectName: `${family.id}:fact-current-location`, predicate: 'location',
    characterId: localIds.get(`${family.id}:character-a`), factKind: 'state', value: '新驿站', sourceType: 'manual',
    validFromChapterId: localIds.get(`${family.id}:chapter-2`), validToChapterId: null, supersedesFactId: historicalId,
    status: 'confirmed', locked: false, createdAt: now, updatedAt: now,
  } as never, { owner: 'work' }))
  // Fixture author explicitly confirms and locks B's knowledge of this rule.
  const lockedId = await db.temporalFacts.add(stampNewRecord(created.scope, 'temporalFacts', {
    projectId: created.scope.projectId, subjectName: `${family.id}:locked-rule`, predicate: 'knows',
    characterId: localIds.get(`${family.id}:character-b`), factKind: 'event', value: family.seed.lockedQuote, sourceType: 'chapter',
    sourceChapterId: localIds.get(`${family.id}:chapter-1`), sourceQuote: family.seed.lockedQuote,
    status: 'confirmed', locked: true, createdAt: now, updatedAt: now,
  } as never, { owner: 'work' })) as number
  factIds.set('locked', lockedId)
  await db.foreshadows.add(stampNewRecord(created.scope, 'foreshadows', {
    projectId: created.scope.projectId, name: `${family.id}:planned`, type: 'dialogue', status: 'planned',
    description: family.seed.plannedText, notes: '', plantChapterId: null, echoChapterIds: '[]', resolveChapterId: null,
    createdAt: now, updatedAt: now,
  } as never, { owner: 'work' }))
  const revision = await createWorldRevision({ scope: created.scope, label: `${family.id}:baseline` })
  const release = await publishWorldRevision(revision.id!)
  const reference = await createWorldReferenceV1(release.id!)
  // A second Work shares this World, but must not enter the first Work's
  // impact graph or have its facts demoted. This is stronger than a project-only check.
  const otherWork = await createWorldWork(created.scope.projectId, { title: `${family.title}·独立作品`, kind: 'novel', novelProfile: 'long' })
  const otherScope = { ...created.scope, workId: otherWork.id! }
  const foreignChapterId = await db.chapters.add(stampNewRecord(otherScope, 'chapters', {
    projectId: created.scope.projectId, title: '另一作品的后章', content: '独立作品，不依赖评测原文。',
    order: 99, status: 'draft', wordCount: 16, notes: '', createdAt: now, updatedAt: now,
  } as never, { owner: 'work' })) as number
  const foreignFactId = await db.temporalFacts.add(stampNewRecord(otherScope, 'temporalFacts', {
    projectId: created.scope.projectId, subjectName: 'other-work-fact', predicate: 'location',
    characterId: localIds.get(`${family.id}:character-a`), factKind: 'state', value: '独立作品的院内',
    sourceType: 'manual', status: 'confirmed', locked: false, createdAt: now, updatedAt: now,
  } as never, { owner: 'work' })) as number
  const foreignBefore = JSON.stringify({ chapter: await db.chapters.get(foreignChapterId), fact: await db.temporalFacts.get(foreignFactId) })
  const resourceScope = await resolveWorldReferenceResourceScopeV1(reference)
  const descriptors = await listAllWorldReleaseResourceDescriptorsV1(resourceScope)
  const byLogical = new Map<string, ContextResourceDescriptorV1>()
  const byKey = new Map<string, string>()
  const originals = new Map<string, Record<string, unknown>>()
  for (const descriptor of descriptors) {
    const original = await readWorldOriginalEvidenceV1({ scope: resourceScope, resourceKey: descriptor.resourceKey,
      sourceRef: descriptor.sourceRefs[0]!, maxTokens: 20_000 })
    const row = JSON.parse(original.content) as Record<string, unknown>
    const kind = descriptor.worldSemantic!.resourceKind
    let logical = family.sources.find(item => item.kind === kind
      && (kind === 'chapter' ? row.title === item.title
        : kind === 'character' ? row.shortDescription === item.text : row.name === item.title))?.id
    if (kind === 'knowledge-event') logical = `${family.id}:knowledge-${row.action === 'mislearn' ? 'a' : 'b'}`
    if (kind === 'temporal-fact') logical = String(row.subjectName)
    if (kind === 'foreshadow') logical = String(row.name)
    // Outlines and other release infrastructure retain an explicit local label;
    // no runtime numeric locator or random release hash goes into score gold.
    logical ??= `${family.id}:${kind}:${String(row.title ?? row.name ?? descriptor.worldSemantic!.resourceCoordinate)}`
    check(!byLogical.has(logical), `ambiguous descriptor mapping ${logical}`)
    byLogical.set(logical, descriptor)
    byKey.set(descriptor.resourceKey, logical)
    originals.set(logical, row)
  }
  const descriptor = (id: string) => { const item = byLogical.get(id); check(item, `unmapped resource ${id}`); return item }
  const logicalKeys = (items: readonly ContextResourceDescriptorV1[]) => sorted(items.map(item => {
    const id = byKey.get(item.resourceKey); check(id, `unknown response resource ${item.resourceKey}`); return id
  }))
  return { ...created, source, localIds, factIds, foreignChapterId, foreignFactId, foreignBefore, release, reference, resourceScope, descriptors,
    byLogical, byKey, originals, descriptor, logicalKeys }
}

type Fixture = Awaited<ReturnType<typeof seedNarrativeFamily>>
const queryIssues: Record<string, string> = {
  'body-search': 'NW-G03', 'entity-filter': 'NW-G01', 'arc-filter': 'NW-G01', 'chapter-cutoff': 'NW-G01',
  'character-knowledge-scope': 'NW-G02', 'causal-query': 'NW-G08', 'development-query': 'NW-G08', 'hypothesis-query': 'NW-G09',
}

async function observeQuery(family: NarrativeFamily, fixture: Fixture, query: Query): Promise<BaselineObservation> {
  const base = { id: query.id, family: family.id, split: family.split, operation: query.operation,
    expected: sorted(query.expectedResourceIds), evidence: query.evidence.map(span => span.spanHash) }
  const requiredMethod = ({ 'causal-query': 'query', 'development-query': 'query', 'hypothesis-query': 'simulate' } as Record<string, string>)[query.operation]
  if (requiredMethod) {
    check(!(requiredMethod in WORLD_RELEASE_RESOURCE_PROVIDER_V1), `${requiredMethod} appeared; add its real evaluator before updating this baseline`)
    return { ...base, status: 'unsupported', observed: { missingOperation: requiredMethod,
      exposedMethods: Object.keys(WORLD_RELEASE_RESOURCE_PROVIDER_V1).filter(key => typeof (WORLD_RELEASE_RESOURCE_PROVIDER_V1 as any)[key] === 'function').sort() },
    issue: queryIssues[query.operation]! }
  }
  let observed: string[]
  try {
  if (query.operation === 'original-read') {
    const target = fixture.descriptor(query.expectedResourceIds[0]!)
    const response = await readWorldOriginalEvidenceV1({ scope: fixture.resourceScope, resourceKey: target.resourceKey,
      sourceRef: target.sourceRefs[0]!, maxTokens: 20_000 })
    const value = JSON.parse(response.content) as { content: string }
    observed = query.evidence.every(span => value.content.includes(span.quote)) ? [query.expectedResourceIds[0]!] : []
  } else if (query.operation === 'character-knowledge-scope') {
    const resources = await listAllWorldReleaseResourceDescriptorsV1({ ...fixture.resourceScope,
      characterId: fixture.localIds.get(query.holderId!) })
    observed = fixture.logicalKeys(resources.filter(d => d.worldSemantic?.resourceKind === 'knowledge-event'))
  } else {
    const input: ResourceSearchInputV1 = { scope: fixture.resourceScope, query: query.search!, limit: 100,
      kinds: query.operation === 'entity-filter' ? ['character'] : query.operation === 'arc-filter' ? ['story-arc'] : ['chapter'] }
    if (query.operation === 'entity-filter') input.entityKeys = [fixture.descriptor(query.entityId!).resourceKey]
    if (query.operation === 'arc-filter') input.storyArcKeys = [fixture.descriptor(query.arcId!).resourceKey]
    if (query.operation === 'chapter-cutoff') input.timeRange = { throughChapterId: fixture.localIds.get(query.throughId!) }
    const page = await searchWorldReleaseV1(input)
    check(!page.nextCursor, 'fixture unexpectedly exceeds a single result page')
    observed = fixture.logicalKeys(page.items)
  }
  } catch (error) {
    // A legacy provider that explicitly refuses an unimplemented filter is
    // safer than silently ignoring it, but is still not a successful query.
    if (!(error instanceof WorldReleaseResourceProviderErrorV1) || error.code !== 'unsupported') throw error
    return { ...base, status: 'unsupported', observed: { rejectedOperation: query.operation, code: error.code },
      issue: queryIssues[query.operation] ?? 'NW-REGRESSION' }
  }
  const passed = equalSet(observed, query.expectedResourceIds)
  return { ...base, observed, status: passed ? 'pass' : 'gap', issue: passed ? null : queryIssues[query.operation] ?? 'NW-REGRESSION' }
}

/** Literal full-text reference baseline, deliberately no semantic answers,
 * perspective inference, temporal filtering, vectors, or synthetic model. */
function observeLexical(family: NarrativeFamily, query: Query): BaselineObservation | null {
  if (!['metadata-search', 'body-search'].includes(query.operation)) return null
  const term = query.search!.toLocaleLowerCase('zh-CN')
  const observed = family.sources.filter(s => s.kind === 'chapter'
    && `${s.title}\n${s.text}`.toLocaleLowerCase('zh-CN').includes(term)).map(s => s.id)
  const pass = equalSet(observed, query.expectedResourceIds)
  return { id: `${query.id}:lexical`, family: family.id, split: family.split, operation: 'literal-fulltext-reference',
    expected: sorted(query.expectedResourceIds), observed: sorted(observed), status: pass ? 'pass' : 'gap',
    evidence: query.evidence.map(e => e.spanHash), issue: pass ? null : 'NW-REFERENCE-GAP' }
}

export async function evaluateNarrativeFamily(family: NarrativeFamily) {
  const fixture = await seedNarrativeFamily(family)
  const queries: BaselineObservation[] = []
  const lexical: BaselineObservation[] = []
  for (const query of family.queries) {
    queries.push(await observeQuery(family, fixture, query))
    const result = observeLexical(family, query)
    if (result) lexical.push(result)
  }
  const edits: Array<BaselineObservation & { truePositive: number; falsePositive: number; falseNegative: number;
    lockedPreserved: boolean; sourceFactStatus: string; frozenReleaseUnchanged: boolean; otherWorkPreserved: boolean }> = []
  for (const edit of family.edits) {
    const original = family.sources.find(s => s.id === edit.sourceId)!
    const chapterId = fixture.localIds.get(edit.sourceId)!
    await db.chapters.update(chapterId, { content: original.text.replace(edit.before, edit.after) })
    const graph = await buildEditImpactGraphV1(fixture.scope, chapterId)
    await propagateChapterEditStale(fixture.scope, chapterId)
    const observed = family.sources.filter(s => s.kind === 'chapter'
      && graph.downstreamChapterIds.includes(fixture.localIds.get(s.id)!)).map(s => s.id)
    const truePositive = observed.filter(id => edit.mustReview.includes(id)).length
    const falsePositive = observed.filter(id => !edit.mustReview.includes(id)).length
    const falseNegative = edit.mustReview.filter(id => !observed.includes(id)).length
    const locked = await db.temporalFacts.get(fixture.factIds.get('locked')!)
    const changedFact = await db.temporalFacts.get(fixture.factIds.get('confirmed')!)
    const release = await db.worldReleases.get(fixture.release.id!)
    const foreignFact = await db.temporalFacts.get(fixture.foreignFactId)
    const foreignAfter = JSON.stringify({ chapter: await db.chapters.get(fixture.foreignChapterId), fact: foreignFact })
    const otherWorkPreserved = !graph.downstreamChapterIds.includes(fixture.foreignChapterId) && foreignAfter === fixture.foreignBefore
    const lockedPreserved = locked?.locked === true && locked.status === 'confirmed' && locked.value === family.seed.lockedQuote
    const frozenReleaseUnchanged = release?.contentHash === fixture.release.contentHash && release.manifestJson === fixture.release.manifestJson
    check(lockedPreserved && frozenReleaseUnchanged && otherWorkPreserved, 'impact evaluation crossed a protected boundary')
    const pass = equalSet(observed, edit.mustReview)
    edits.push({ id: edit.id, family: family.id, split: family.split, operation: `impact:${edit.kind}`,
      expected: sorted(edit.mustReview), observed: sorted(observed), status: pass ? 'pass' : 'gap',
      evidence: [edit.evidence.spanHash, ...edit.dependencyEvidence.map(e => e.spanHash)], issue: pass ? null : 'NW-G07',
      truePositive, falsePositive, falseNegative, lockedPreserved, sourceFactStatus: changedFact!.status, frozenReleaseUnchanged, otherWorkPreserved })
    await db.chapters.update(chapterId, { content: original.text })
    await db.temporalFacts.update(fixture.factIds.get('confirmed')!, { status: 'confirmed' })
  }
  const controls = await observeControls(family, fixture)
  return { queries, lexical, edits, controls }
}

async function observeControls(family: NarrativeFamily, fixture: Fixture) {
  const result: BaselineObservation[] = []
  function add(suffix: string, operation: string, expected: unknown, observed: unknown, issue: string | null = null,
    pass = JSON.stringify(expected) === JSON.stringify(observed)) {
    result.push({ id: `${family.id}:control:${suffix}`, family: family.id, split: family.split, operation,
      expected, observed, status: pass ? 'pass' : 'gap', evidence: [family.queries[0]!.evidence[0]!.spanHash], issue: pass ? null : issue ?? 'NW-REGRESSION' })
  }
  function unsupported(suffix: string, expected: unknown) {
    result.push({ id: `${family.id}:control:${suffix}`, family: family.id, split: family.split, operation: 'knowledge-scope',
      expected, observed: { code: 'unsupported', boundary: 'legacy-v3-has-no-perspective-grant' }, status: 'unsupported',
      evidence: [family.queries[0]!.evidence[0]!.spanHash], issue: 'NW-G02' })
  }
  const facts = [...fixture.originals.values()].filter(row => typeof row.subjectName === 'string' && String(row.subjectName).startsWith(`${family.id}:`))
  add('candidate-isolation', 'release-authority', ['confirmed', 'confirmed', 'confirmed'], facts.map(r => String(r.status)).sort())
  add('historical-state', 'release-history', true, fixture.byLogical.has(`${family.id}:fact-superseded`), 'NW-G04')
  const planned = fixture.descriptor(`${family.id}:planned`)
  add('intent-authority', 'release-authority', 'intent', planned.authority, 'NW-G05')
  const belief = fixture.descriptor(`${family.id}:knowledge-a`)
  add('belief-authority', 'release-authority', 'character-belief', belief.authority, 'NW-G05')
  const originalBelief = fixture.originals.get(`${family.id}:knowledge-a`)!
  add('belief-value-retained', 'release-preservation', family.seed.belief, originalBelief.belief)
  try {
    const noKnowledge = await listAllWorldReleaseResourceDescriptorsV1({ ...fixture.resourceScope, characterId: null })
    add('null-character-knowledge', 'knowledge-scope', 0,
      noKnowledge.filter(d => d.worldSemantic?.resourceKind === 'knowledge-event').length, 'NW-G02')
  } catch (error) {
    if (!(error instanceof WorldReleaseResourceProviderErrorV1) || error.code !== 'unsupported') throw error
    unsupported('null-character-knowledge', 0)
  }
  let otherHolderDenied: boolean | null = false
  const otherHolder = fixture.descriptor(`${family.id}:knowledge-b`)
  try { await readWorldOriginalEvidenceV1({ scope: { ...fixture.resourceScope, characterId: fixture.localIds.get(`${family.id}:character-a`) },
    resourceKey: otherHolder.resourceKey, sourceRef: otherHolder.sourceRefs[0]!, maxTokens: 20_000 }) }
  catch (error) {
    if (error instanceof WorldReleaseResourceProviderErrorV1 && error.code === 'unsupported') {
      unsupported('other-holder-original', true); otherHolderDenied = null
    } else otherHolderDenied = /scope|permission|not-found|forbidden/.test(String(error))
  }
  if (otherHolderDenied !== null) add('other-holder-original', 'knowledge-scope', true, otherHolderDenied, 'NW-G02')
  const target = fixture.descriptor(`${family.id}:chapter-1`)
  for (const [depth, read] of [
    ['index', () => readWorldResourceV1({ scope: fixture.resourceScope, resourceKey: target.resourceKey, depth: 'index', maxTokens: 1 })],
    ['original', () => readWorldOriginalEvidenceV1({ scope: fixture.resourceScope, resourceKey: target.resourceKey, sourceRef: target.sourceRefs[0]!, maxTokens: 1 })],
  ] as const) {
    if (depth === 'index') {
      const expected = 'tokenCount <= 1 or explicit budget refusal'
      try {
        const response = await read()
        add('budget-index', 'budget-bound', expected, response.tokenCount, 'NW-G10', response.tokenCount <= 1)
      } catch (error) {
        if (!(error instanceof WorldReleaseResourceProviderErrorV1) || error.code !== 'budget') throw error
        add('budget-index', 'budget-bound', expected, { status: 'refused', code: error.code }, 'NW-G10', true)
      }
    } else {
      let rejected = false
      try { await read() } catch (error) { rejected = String(error).includes('original-budget') }
      add('budget-original', 'budget-bound', true, rejected)
    }
  }
  let wrongScopeRejected = false
  try { await describeWorldReleaseV1({ ...fixture.resourceScope, projectId: fixture.scope.projectId + 999 }) }
  catch (error) { wrongScopeRejected = String(error).includes('scope') }
  add('wrong-owner', 'owner-isolation', true, wrongScopeRejected)
  const description = await describeWorldReleaseV1(fixture.resourceScope)
  // This legacy flag advertises populated metadata, not semantic or body search.
  add('metadata-index-available', 'metadata-capability', true,
    description.capabilities.find(c => c.area === 'manuscript')!.queryableIndexAvailable)
  let badRefRejected = false
  try { await readWorldOriginalEvidenceV1({ scope: fixture.resourceScope, resourceKey: target.resourceKey,
    sourceRef: { ...target.sourceRefs[0]!, contentHash: '0'.repeat(64) }, maxTokens: 20_000 }) }
  catch (error) { badRefRejected = String(error).includes('source-ref') }
  add('tampered-evidence', 'evidence-integrity', true, badRefRejected)
  const firstPage = await searchWorldReleaseV1({ scope: fixture.resourceScope, query: family.title, kinds: ['chapter'], limit: 1 })
  check(firstPage.nextCursor, 'pagination positive control needs two rows')
  let changedFilterRejected = false
  try { await searchWorldReleaseV1({ scope: fixture.resourceScope, query: family.title, kinds: ['chapter'], limit: 1,
    cursor: firstPage.nextCursor, entityKeys: [fixture.descriptor(`${family.id}:character-a`).resourceKey] }) }
  catch (error) { changedFilterRejected = String(error).includes('cursor') }
  add('cursor-filter-integrity', 'evidence-integrity', true, changedFilterRejected)
  const forbiddenTables = ['agentRunArtifacts', 'productRuntimeSessions', 'productMediaAssets', 'retrievalChunks']
  const rejectedTables: string[] = []
  for (const table of forbiddenTables) {
    try { await createWorldRevision({ scope: fixture.scope, label: 'must-not-publish', selectedTables: [table] }) }
    catch (error) { if (String(error).includes('未登记为可发布')) rejectedTables.push(table) }
  }
  add('hypothesis-private-tables', 'release-owner-boundary', forbiddenTables, rejectedTables)
  return result
}

export async function evaluateAdapterBaselines(family: NarrativeFamily) {
  const fixture = await seedNarrativeFamily(family)
  const observations: BaselineObservation[] = []
  const selected = ['character-a', 'character-b'].map(s => fixture.descriptor(`${family.id}:${s}`).resourceKey)
  for (const productType of ['character-interaction', 'ttrpg', 'ai-town', 'text-adventure', 'avg', 'text-open-world'] as ProductionProductKindV1[]) {
    const adapter = getUpperProductWorldRequirementAdapterV1(productType)
    const goal = { selectedAreas: ['characters'] as const, selectedResourceKinds: ['character'], selectedContextKinds: ['character'] as const,
      selectedResourceCount: selected.length, participantCount: 0, includeSelectedRelations: false, inheritStoryContinuity: false, allowCrossWorld: false }
    const plan = await freezeProductSourcePlanV1({ productInstanceKey: `nw0b:${productType}`, worldReference: fixture.reference,
      adapter, goal: { ...goal, selectedAreas: [...goal.selectedAreas], selectedContextKinds: [...goal.selectedContextKinds] },
      missingStrategy: 'block', initialResourceKeys: selected, createdAt: 100 })
    const boundary = await resolveProductSourceReadBoundaryV1(plan)
    const actual = fixture.logicalKeys(fixture.descriptors.filter(d => boundary.mandatoryResourceKeys.includes(d.resourceKey)))
    const expected = selected.map(key => fixture.byKey.get(key)!).sort()
    observations.push({ id: `adapter:${productType}:selected`, family: family.id, split: family.split,
      operation: 'generic-source-plan-selected-completeness', status: equalSet(actual, expected) ? 'pass' : 'gap', expected,
      observed: actual, evidence: [family.queries[3]!.evidence[0]!.spanHash], issue: equalSet(actual, expected) ? null : 'NW-G06' })
    const countOnlyPlan = await freezeProductSourcePlanV1({ productInstanceKey: `nw0b-count:${productType}`, worldReference: fixture.reference,
      adapter, goal: { ...goal, selectedAreas: [...goal.selectedAreas], selectedContextKinds: [...goal.selectedContextKinds] },
      missingStrategy: 'block', createdAt: 100 })
    const countOnlyBoundary = await resolveProductSourceReadBoundaryV1(countOnlyPlan)
    const sufficient = countOnlyBoundary.mandatoryResourceKeys.length >= selected.length
    observations.push({ id: `adapter:${productType}:count-only`, family: family.id, split: family.split,
      operation: 'source-plan-count-only-completeness', status: sufficient ? 'pass' : 'gap',
      expected: { minimumSelectedCount: selected.length }, observed: { mandatoryCount: countOnlyBoundary.mandatoryResourceKeys.length },
      evidence: [family.queries[3]!.evidence[0]!.spanHash], issue: sufficient ? null : 'NW-G06' })
    const selection: ProductWorldSourceSelectionV1 = { schema: 'storyforge.product-world-source-selection', version: 1, productType,
      worldReferenceHash: fixture.reference.referenceHash, resourceKeys: selected, roleBindings: {} }
    const compilation = resolveProductProductionWorldCompilationDescriptorsV2({ descriptors: fixture.descriptors as any,
      selection })
    const compiled = fixture.logicalKeys(compilation)
    check(equalSet(compiled, expected), 'existing stronger compilation closure lost a selected resource')
    observations.push({ id: `adapter:${productType}:compilation`, family: family.id, split: family.split,
      operation: 'production-compilation-selected-completeness', status: 'pass', expected, observed: compiled,
      evidence: [family.queries[3]!.evidence[0]!.spanHash], issue: null })
    observations.push({ id: `adapter:${productType}:prohibited`, family: family.id, split: family.split,
      operation: 'product-prohibited-rule-coverage', status: plan.permission.prohibitedSelectors.length ? 'pass' : 'gap',
      expected: 'product-specific prohibited selectors', observed: plan.permission.prohibitedSelectors.length,
      evidence: [family.queries[3]!.evidence[0]!.spanHash], issue: plan.permission.prohibitedSelectors.length ? null : 'NW-G06' })
  }
  return observations
}
