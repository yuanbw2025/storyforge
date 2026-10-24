import {chatOpeningProofReviewPromptV1} from '../../src/lib/character-interaction/opening-review-proof-citations'
import {chatOpeningRelationalReviewPromptV1} from '../../src/lib/character-interaction/opening-review-relations'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import Ajv from 'ajv'
import * as skills from '../../src/lib/agent/skill-registry'
import {chatOpeningKeyedReviewPromptV1} from '../../src/lib/character-interaction/opening-review-keyed'
import {db} from '../../src/lib/db/schema'
import {CONTEXT_SOURCES} from '../../src/lib/registry/context-sources'
import {buildChatOpeningReviewReferencesV1, chatOpeningReviewReferenceSchemaV1, chatOpeningReviewReferencePromptV1,
  parseChatOpeningReferenceReviewV1, assertChatOpeningReviewReferencesDeliveredV1} from '../../src/lib/character-interaction/opening-review-references'
import {createChatOpeningReviewV1, assertChatOpeningReviewedV1} from '../../src/lib/character-interaction/situation-production-review'
import {executeProductProductionCommand} from '../../src/lib/product-production/commands'
import {createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1} from '../../src/lib/product-production/production-executor'
import {runProductProductionUntilBlockedV1, type ProductProductionTaskExecutionInputV1} from '../../src/lib/product-production/scheduler'
import {readProductProductionDetailsV1} from '../../src/lib/product-production/service'
import {estimateTokens} from '../../src/lib/ai/context-budget'
import {chatOpeningDevelopmentReviewFixture, chatOpeningKeyedReviewFixture, chatOpeningProofReviewFixture, chatOpeningReferenceReviewFixture, chatSituationCandidatesFixture, seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {vi.restoreAllMocks(); await db.delete()})

it('selects exact original excerpts, handles long Unicode text without truncating the source, and preserves all review judgments', async () => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true})
  f.source.settings.openingSituation = '甲'.repeat(799) + '😀' + '乙'.repeat(900)
  const before = structuredClone(f.source), refs = buildChatOpeningReviewReferencesV1(f.source, f.candidates)
  const long = refs.filter(ref => ref.target === 'source' && ref.pointer === '/settings/openingSituation')
  expect(long.map(ref => ref.quote).join('')).toBe(before.settings.openingSituation)
  expect(long.every(ref => ref.quote.length <= 800 && !/[\uD800-\uDBFF]$/u.test(ref.quote))).toBe(true)
  expect(f.source).toEqual(before)
  const reordered = Object.fromEntries(Object.entries(f.source).reverse()) as typeof f.source
  expect(buildChatOpeningReviewReferencesV1(reordered, f.candidates)).toEqual(refs)
  const original = chatOpeningDevelopmentReviewFixture(f.candidates), wire = chatOpeningReferenceReviewFixture(f.source, f.candidates, original)
  const retained = structuredClone(wire)
  expect(new Ajv().compile(chatOpeningReviewReferenceSchemaV1(f.source, f.candidates).schema)(wire)).toBe(true)
  expect(parseChatOpeningReferenceReviewV1(wire, f.source, f.candidates)).toEqual(original)
  expect(wire).toEqual(retained)
  const rejected = chatOpeningDevelopmentReviewFixture(f.candidates, f.candidates.options[0].optionKey)
  const report = await createChatOpeningReviewV1(parseChatOpeningReferenceReviewV1(chatOpeningReferenceReviewFixture(f.source, f.candidates, rejected), f.source, f.candidates), f.source, f.candidates, 3)
  await expect(assertChatOpeningReviewedV1(report, f.source, f.candidates, f.candidates.options[0].optionKey, 3)).rejects.toThrow('未通过')
})

it.each(['unknown', 'foreign-option', 'extra-quote', 'missing-check', 'missing-basis', 'repeated-adaptive'] as const)('rejects %s without repairing or changing the retained wire', async kind => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true})
  const wire = chatOpeningReferenceReviewFixture(f.source, f.candidates), first = wire.options[0]
  if (kind === 'unknown') first.checks[0].evidence = [{refId: 'unknown'}]
  if (kind === 'foreign-option') first.checks[0].evidence = [{refId: buildChatOpeningReviewReferencesV1(f.source, f.candidates).find(ref => ref.optionKey === wire.options[1].optionKey)!.refId}]
  if (kind === 'extra-quote') Object.assign(first.checks[0].evidence[0], {quote: '模型改写的原文'})
  if (kind === 'missing-check') first.checks.pop()
  if (kind === 'missing-basis') first.agency!.basisFactKeys = ['not-delivered']
  if (kind === 'repeated-adaptive') first.development!.mode = 'adaptive'
  const before = structuredClone(wire)
  expect(() => parseChatOpeningReferenceReviewV1(wire, f.source, f.candidates)).toThrow()
  expect(wire).toEqual(before)
})

it.each(([11, 12, 13, 14] as const).flatMap(version => (['accepted', 'semantic-rejection', 'invalid-reference', 'repeated-adaptive', 'missing-delivery', 'tampered-delivery', 'schema-budget'] as const).map(scenario => ({version, scenario}))))('runs the registered v$version boundary with $scenario and never retries a rejected review', async ({version, scenario}) => {
  if (version < 14) {
    const original = skills.getAgentSkillV1
    vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-opening-review' ? {...original(id), promptVersion: `chat-opening-review-v${version}`} : original(id))
  }
  const prompt = version === 14 ? chatOpeningRelationalReviewPromptV1 : version === 13 ? chatOpeningProofReviewPromptV1 : version === 11 ? chatOpeningReviewReferencePromptV1 : chatOpeningKeyedReviewPromptV1
  const encode = version >= 13 ? chatOpeningProofReviewFixture : version === 11 ? chatOpeningReferenceReviewFixture : chatOpeningKeyedReviewFixture
  const f = await seedChatNarrativeProductionFixture()
  const created = await executeProductProductionCommand({scope: f.scope, command: {type: 'create-intent', commandId: 'ref.create', productionKey: 'ref.chat',
    worldReleaseId: f.confirmed.worldReleaseId!, productType: 'character-interaction', userText: '引用审查工程夹具'}})
  const productionId = created.productionId
  const saved = await executeProductProductionCommand({scope: f.scope, productionId, command: {type: 'save-brief-revision', commandId: 'ref.brief', expectedStateRevision: 0, parentRevision: null, brief: f.brief}})
  await executeProductProductionCommand({scope: f.scope, productionId, command: {type: 'authorize-start', commandId: 'ref.start', expectedStateRevision: 1,
    briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'author.start'}})
  const requirementKey = f.brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey
  const bindingHash = 'a'.repeat(64), requests: Array<Parameters<ProductionTextRunnerV1>[0]> = []
  let rawReview = '', delivered: ProductProductionTaskExecutionInputV1 | undefined
  const runText: ProductionTextRunnerV1 = async request => {
    requests.push(request)
    const source = JSON.parse((await db.productBuildArtifacts.where('projectId').equals(f.scope.projectId).filter(row => row.artifactKey === 'design.game').last())!.payloadJson)
    const isOpening = request.system.includes('初始情境编辑')
    const candidates = isOpening ? chatSituationCandidatesFixture(source) : JSON.parse((await db.productBuildArtifacts.where('projectId').equals(f.scope.projectId).filter(row => row.artifactKey === 'content.chat-candidates').last())!.payloadJson)
    let output = JSON.stringify(candidates)
    if (!isOpening) {
      expect(request.jsonSchema?.name).toBe(version === 14 ? 'chat_opening_review_relations_v1' : version === 13 ? 'chat_opening_review_proof_citations_v1' : version === 11 ? 'chat_opening_review_references_v1' : 'chat_opening_review_keyed_v1')
      expect(request.system).toBe(prompt() + (version === 11 ? '\n输出 JSON Schema：' + JSON.stringify(request.jsonSchema!.schema) : ''))
      expect(request.maximumOutputTokens).toBe(10_000)
      expect(request.contextText).toContain('storyforge.chat-opening-review-inputs')
      expect(request.contextText).not.toContain('product-production.repair-feedback')
      const draft = chatOpeningDevelopmentReviewFixture(candidates)
      if (scenario === 'semantic-rejection') draft.options[0].checks[0].passed = false
      if (scenario === 'repeated-adaptive') draft.options[0].development!.mode = 'adaptive'
      const wire = encode(source, candidates, draft)
      if (scenario === 'invalid-reference') Object.values(Object.values(wire.options)[0].checks)[0].evidence = [{refId: 'not-in-catalog'}]
      output = rawReview = JSON.stringify(wire)
      if (scenario !== 'invalid-reference') expect(new Ajv().compile(request.jsonSchema!.schema)(wire)).toBe(!(version >= 13 && scenario === 'repeated-adaptive'))
      expect(() => assertChatOpeningReviewReferencesDeliveredV1(delivered!, source, candidates)).not.toThrow()
    }
    return {output, usage: {inputTokens: 100, outputTokens: 100}, bindingReceipt: {schema: 'storyforge.provider-binding-receipt', version: 1,
      requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid',
      executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: 'b'.repeat(64)}}
  }
  const configured = createConfiguredProductProductionExecutorV1({production: (await db.productProductions.get(productionId))!, brief: f.brief, runText})
  const execute = () => runProductProductionUntilBlockedV1({scope: f.scope, productionId, capabilityBindings: [{requirementKey, adapterId: 'configured-text.v1', bindingHash}],
    executor: input => {
      if (input.task.taskKey !== 'content.chat-opening-review') return configured(input)
      delivered = input
      if (scenario === 'missing-delivery') return configured({...input, contextText: ''})
      if (scenario === 'tampered-delivery') return configured({...input, contextText: input.contextText.replace('s.001', 's.not-original')})
      if (scenario === 'schema-budget') return configured({...input, attemptBudgetReservation: {...input.attemptBudgetReservation!,
        inputTokens: estimateTokens(input.contextText + prompt())}})
      return configured(input)
    }})
  await execute()
  const report = await db.productBuildArtifacts.where('projectId').equals(f.scope.projectId).filter(row => row.artifactKey === 'quality.chat-openings').last()
  if (scenario === 'accepted' || scenario === 'semantic-rejection') {
    expect(JSON.parse(report!.payloadJson).options[0].checks[0].passed).toBe(scenario === 'accepted')
    expect(report!.payloadJson).not.toContain('refId')
  } else {
    expect(report).toBeUndefined()
    expect(JSON.parse((await readProductProductionDetailsV1(f.scope, productionId)).build!.failureJson).taskKey).toBe('content.chat-opening-review')
  }
  expect(requests).toHaveLength(['missing-delivery', 'tampered-delivery', 'schema-budget'].includes(scenario) ? 1 : 2)
  if (rawReview) expect(await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).filter(row => row.artifactKind === 'raw-response' && row.content === rawReview).count()).toBeGreaterThan(0)
  await execute()
  expect(requests).toHaveLength(['missing-delivery', 'tampered-delivery', 'schema-budget'].includes(scenario) ? 1 : 2)
  const source = CONTEXT_SOURCES.find(source => source.key === 'product-production.chat-opening-review-inputs')!
  expect(source).toMatchObject({protectedFromTrim: true})
  await expect(source.read({projectId: f.scope.projectId, scope: f.scope, productProductionId: productionId, productBuildId: delivered!.buildId,
    productArtifactKeys: ['design.game'], productProductionTaskKey: 'content.chat-opening-review'})).rejects.toThrow('读取不属于')
  if (scenario === 'accepted') {
    const input = {projectId: f.scope.projectId, scope: f.scope, productProductionId: productionId, productBuildId: delivered!.buildId,
      productArtifactKeys: ['design.game', 'content.chat-candidates'], productProductionTaskKey: 'content.chat-opening-review'}
    await expect(source.read({...input, scope: {...f.scope, workId: f.scope.workId! + 999}})).rejects.toThrow('跨 Work')
    const row = (await db.productBuildArtifacts.where('buildId').equals(delivered!.buildId).filter(row => row.artifactKey === 'design.game').last())!
    await db.productBuildArtifacts.update(row.id!, {contentHash: '0'.repeat(64)})
    await expect(source.read(input)).rejects.toThrow('冻结 hash')
    await db.productBuildArtifacts.update(row.id!, {contentHash: row.contentHash})
    expect(requests).toHaveLength(2)
  }
})
