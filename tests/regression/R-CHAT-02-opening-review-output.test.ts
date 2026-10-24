import {createHash} from 'node:crypto'
import budgetCase from '../fixtures/character-chat-opening-review-budget.json'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import * as skills from '../../src/lib/agent/skill-registry'
import Ajv from 'ajv'
import {db} from '../../src/lib/db/schema'
import {chatOpeningReviewOutputSchemaV1, chatOpeningReviewOutputSchemaV2, chatOpeningReviewOutputSchemaV3} from '../../src/lib/character-interaction/opening-review-output'
import {parseChatOpeningReviewDraftV1} from '../../src/lib/character-interaction/situation-production-review'
import {chatOpeningContinuationReviewPromptV1, chatOpeningScopedReviewPromptV1, chatOpeningBackgroundProductionPromptV2, chatOpeningBackgroundReviewPromptV2, chatOpeningBackgroundReviewPromptV3} from '../../src/lib/character-interaction/opening-continuation'
import {executeProductProductionCommand} from '../../src/lib/product-production/commands'
import {createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1} from '../../src/lib/product-production/production-executor'
import {runProductProductionUntilBlockedV1} from '../../src/lib/product-production/scheduler'
import {readProductProductionDetailsV1, retryProductProductionBlockerV1} from '../../src/lib/product-production/service'
import {estimateTokens, trimMessagesToFit} from '../../src/lib/ai/context-budget'
import {estimateChatRequestOptionsTokens} from '../../src/lib/ai/client'
import {chatOpeningAgencyReviewFixture, chatOpeningDevelopmentReviewFixture, chatSituationCandidatesFixture, seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'

beforeEach(async () => {
  await db.delete(); await db.open()
  // Freeze this suite's v10 transport and registered source as a historical contract.
  const original = skills.getAgentSkillV1
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-opening-review'
    ? {...original(id), promptVersion: 'chat-opening-review-v10', contextSourceKeys: ['product-production.artifact-inputs'],
      inputPolicy: {...original(id).inputPolicy, sourceKeys: ['product-production.artifact-inputs']},
      contextCompression: {...original(id).contextCompression, sourceKeys: ['product-production.artifact-inputs']}}
    : original(id))
})
afterEach(async () => {vi.restoreAllMocks(); await db.delete()})

it('validates exact per-option pointers and visible opportunity identities without copying source prose into the transport schema', async () => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true, privateCast: 'mixed'})
  const schema = chatOpeningReviewOutputSchemaV1(f.source, f.candidates)
  const validate = new Ajv().compile(schema.schema)
  const report = chatOpeningAgencyReviewFixture(f.candidates)
  expect(validate(report)).toBe(true)
  for (const fact of f.source.source.knowledge) expect(JSON.stringify(schema)).not.toContain(JSON.stringify(fact.content))
  for (const pointer of ['/background', '/shortDescription', '/contentBoundaries', '/source', '/options/0/title', '/source/projectionHash']) {
    const bad = structuredClone(report)
    bad.options[0].checks[0].evidence = [{target: 'source', pointer, quote: 'unverified'}]
    expect(validate(bad), pointer).toBe(false)
  }
  const valid = structuredClone(report)
  valid.options[0].checks[0].evidence = [{target: 'source', pointer: '/settings/openingSituation', quote: f.source.settings.openingSituation}]
  expect(validate(valid)).toBe(true)
  expect(() => parseChatOpeningReviewDraftV1(valid, f.source, f.candidates, 2)).not.toThrow()
  const hidden = structuredClone(report)
  hidden.options[0].agency!.basisFactKeys = ['hidden-note']
  expect(validate(hidden)).toBe(false)
  const foreign = structuredClone(report)
  foreign.options[0].agency!.actorKey = f.source.participants[1].participantKey
  expect(validate(foreign)).toBe(false)
  // A provider may ignore JSON Schema. Exact quote and identity checks remain local.
  valid.options[0].checks[0].evidence[0].quote = 'not the source text'
  expect(() => parseChatOpeningReviewDraftV1(valid, f.source, f.candidates, 2)).toThrow('连续摘录')
  expect(chatOpeningScopedReviewPromptV1().endsWith(chatOpeningContinuationReviewPromptV1())).toBe(true)
})

it('accepts a flat transport while locally rejecting wrong roots, cross-option opportunities and fabricated quotes', async () => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true})
  const last = f.candidates.options[f.candidates.options.length - 1]
  last.situation.facts.push({factKey: 'last-option-only', text: '另一开场新增的公共柜架。',
    audienceKeys: ['player', f.source.participants[0].participantKey],
    origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  last.situation.possibilities[0].evidenceFactKeys.push('last-option-only')
  const schema = chatOpeningReviewOutputSchemaV2(f.source, f.candidates)
  const validate = new Ajv().compile(schema.schema)
  const report = chatOpeningAgencyReviewFixture(f.candidates)
  expect(validate(report)).toBe(true)
  expect(() => parseChatOpeningReviewDraftV1(report, f.source, f.candidates, 2)).not.toThrow()
  expect(JSON.stringify(schema)).not.toMatch(/"anyOf"|"oneOf"|"\$ref"/)
  const wrongRoot = structuredClone(report)
  wrongRoot.options[0].checks[0].evidence = [{target: 'option', pointer: '/settings/openingSituation', quote: f.source.settings.openingSituation}]
  expect(validate(wrongRoot)).toBe(true)
  expect(() => parseChatOpeningReviewDraftV1(wrongRoot, f.source, f.candidates, 2)).toThrow('引用路径不属于')
  const wrongOption = structuredClone(report)
  wrongOption.options[0].agency!.basisFactKeys = ['last-option-only']
  expect(validate(wrongOption)).toBe(true)
  expect(() => parseChatOpeningReviewDraftV1(wrongOption, f.source, f.candidates, 2)).toThrow('行动机会不得借用')
  const fakeQuote = structuredClone(report)
  fakeQuote.options[0].checks[0].evidence[0].quote = 'invented evidence'
  expect(validate(fakeQuote)).toBe(true)
  expect(() => parseChatOpeningReviewDraftV1(fakeQuote, f.source, f.candidates, 2)).toThrow('连续摘录')
  const repeated = {options: report.options.map(() => report.options[0])}
  expect(validate(repeated)).toBe(true)
  expect(() => parseChatOpeningReviewDraftV1(repeated, f.source, f.candidates, 2)).toThrow('身份缺失或重复')
})

it.each(['accepted', 'provider-ignored-schema', 'semantic-rejection', 'schema-budget', 'output-limit', 'independent-retry'] as const)(
  'uses the registered production run and preserves failure without another request: %s', async scenario => {
    const f = await seedChatNarrativeProductionFixture()
    const world = await db.worldReleases.get(f.confirmed.worldReleaseId!)
    const created = await executeProductProductionCommand({scope: f.scope, command: {
      type: 'create-intent', commandId: 'review.create', productionKey: 'review.chat',
      productType: 'character-interaction', worldReleaseId: f.confirmed.worldReleaseId!, userText: '制作角色聊天',
    }})
    const productionId = created.productionId
    const saved = await executeProductProductionCommand({scope: f.scope, productionId, command: {
      type: 'save-brief-revision', commandId: 'review.brief', expectedStateRevision: 0, parentRevision: null, brief: f.brief,
    }})
    await executeProductProductionCommand({scope: f.scope, productionId, command: {
      type: 'authorize-start', commandId: 'review.start', expectedStateRevision: 1, briefRevision: 1,
      briefHash: saved.result.briefHash as string, authorizationNonce: 'author.start',
    }})
    const requirementKey = f.brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey
    const bindingHash = 'a'.repeat(64), requests: Array<Parameters<ProductionTextRunnerV1>[0]> = []
    let rawReview = ''
    const rejectedReviews: string[] = [], reviewInputs: Array<{source: unknown; candidates: unknown}> = []
    const runText: ProductionTextRunnerV1 = async request => {
      requests.push(request)
      const sourceRow = await db.productBuildArtifacts.where('projectId').equals(f.scope.projectId)
        .filter(row => row.artifactKey === 'design.game').last()
      const source = JSON.parse(sourceRow!.payloadJson)
      const isOpening = request.system.includes('初始情境编辑')
      const candidates = isOpening ? chatSituationCandidatesFixture(source)
        : JSON.parse((await db.productBuildArtifacts.where('projectId').equals(f.scope.projectId)
          .filter(row => row.artifactKey === 'content.chat-candidates').last())!.payloadJson)
      let output = JSON.stringify(candidates)
      if (!isOpening) {
        expect(request.jsonSchema?.name).toBe('chat_opening_review_v3')
        expect(request.system).toBe(chatOpeningBackgroundReviewPromptV3())
        expect(request.maximumOutputTokens).toBe(10_000)
        expect(request.contextText).not.toContain('REJECTED_REVIEW_NOT_SOURCE')
        expect(request.contextText).not.toContain('storyforge.product-production.repair-feedback')
        reviewInputs.push({source, candidates})
        const report = chatOpeningDevelopmentReviewFixture(candidates)
        const check = report.options[0].checks.find(item => item.check === 'knowledge-and-player-boundaries')!
        if (scenario === 'provider-ignored-schema' || scenario === 'independent-retry' && reviewInputs.length === 1) {
          check.evidence = [{target: 'source', pointer: '/contentBoundaries', quote: source.settings.contentBoundaries}]
          check.reason = 'REJECTED_REVIEW_NOT_SOURCE'
        }
        if (scenario === 'semantic-rejection') {
          // Injected verdict proves that the pipeline retains rejection, not model quality.
          check.passed = false
          check.reason = '候选收束条件提前指向该角色未知的答案。'
        }
        if (scenario !== 'provider-ignored-schema' && scenario !== 'independent-retry') expect(new Ajv().compile(request.jsonSchema!.schema)(report)).toBe(true)
        output = rawReview = JSON.stringify(report)
        rejectedReviews.push(rawReview)
      } else expect(request.system).toBe(chatOpeningBackgroundProductionPromptV2())
      // Even a parseable body cannot override an observed truncated response.
      return {output, finishReason: !isOpening && scenario === 'output-limit' ? 'length' : 'stop',
        usage: {inputTokens: 100, outputTokens: 100}, bindingReceipt: {
        schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
        provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
        credentialSource: 'existing-ai-config', credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: 'b'.repeat(64),
      }}
    }
    const configured = createConfiguredProductProductionExecutorV1({production: (await db.productProductions.get(productionId))!, brief: f.brief, runText})
    const execute = () => runProductProductionUntilBlockedV1({scope: f.scope, productionId,
      capabilityBindings: [{requirementKey, adapterId: 'configured-text.v1', bindingHash}],
      executor: input => {
        if (scenario !== 'schema-budget' || input.task.taskKey !== 'content.chat-opening-review') return configured(input)
        // The text alone fits exactly; the additional wire schema must stop before payment.
        return configured({...input, attemptBudgetReservation: {...input.attemptBudgetReservation!,
          inputTokens: estimateTokens(input.contextText + chatOpeningBackgroundReviewPromptV3())}})
      },
    })
    await execute()
    const details = await readProductProductionDetailsV1(f.scope, productionId)
    const report = await db.productBuildArtifacts.where('projectId').equals(f.scope.projectId)
      .filter(row => row.artifactKey === 'quality.chat-openings').last()
    expect(requests).toHaveLength(scenario === 'schema-budget' ? 1 : 2)
    if (['schema-budget', 'provider-ignored-schema', 'output-limit', 'independent-retry'].includes(scenario)) {
      expect(report).toBeUndefined()
      expect(JSON.parse(details.build!.failureJson).taskKey).toBe('content.chat-opening-review')
    } else {
      const result = JSON.parse(report!.payloadJson)
      expect(result.options[0].checks.find((c: {check: string}) => c.check === 'knowledge-and-player-boundaries').passed)
        .toBe(scenario === 'accepted')
    }
    if (rawReview) expect(await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId)
      .filter(row => row.artifactKind === 'raw-response' && row.content === rawReview).count()).toBeGreaterThan(0)
    await execute()
    expect(requests).toHaveLength(scenario === 'schema-budget' ? 1 : 2)
    if (scenario === 'output-limit') {
      expect(JSON.parse(details.build!.failureJson)).toMatchObject({
        code: 'task-draft-rejected', detail: expect.stringContaining('输出达到上限'),
      })
      expect(JSON.parse(details.build!.budgetLedgerJson).attempts).toContainEqual(expect.objectContaining({
        taskKey: 'content.chat-opening-review', outcome: 'failed', usageKnown: true,
        usage: expect.objectContaining({modelCalls: 1, inputTokens: 100, outputTokens: 100}),
      }))
    }
    if (scenario === 'independent-retry') {
      await retryProductProductionBlockerV1({scope: f.scope, details})
      await execute()
      expect(requests).toHaveLength(3)
      expect(reviewInputs).toHaveLength(2)
      expect(reviewInputs[1]).toEqual(reviewInputs[0])
      const retained = await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId)
        .filter(row => row.artifactKind === 'raw-response').toArray()
      for (const raw of rejectedReviews) expect(retained.some(row => row.content === raw)).toBe(true)
      expect(await db.productBuildArtifacts.where('projectId').equals(f.scope.projectId)
        .filter(row => row.artifactKey === 'quality.chat-openings').count()).toBe(1)
    }
    expect(await db.productReleases.where('projectId').equals(f.scope.projectId).count()).toBe(0)
    expect(await db.worldReleases.get(f.confirmed.worldReleaseId!)).toEqual(world)
  },
)


it('fits the complete real overflow case without reducing output allowance, source text or the review schema', () => {
  const artifacts = JSON.parse(budgetCase.contextText).artifacts as Array<{artifactKey: string; payload: unknown}>
  const source = artifacts.find(a => a.artifactKey === 'design.game')!.payload as Parameters<typeof chatOpeningReviewOutputSchemaV3>[0]
  const candidates = artifacts.find(a => a.artifactKey === 'content.chat-candidates')!.payload as Parameters<typeof chatOpeningReviewOutputSchemaV3>[1]
  const jsonSchema = chatOpeningReviewOutputSchemaV3(source, candidates)
  const schemaTokens = estimateChatRequestOptionsTokens({jsonSchema})
  const previous = chatOpeningBackgroundReviewPromptV2()
  expect(createHash('sha256').update(previous).digest('hex')).toBe(budgetCase.priorSystemSha256)
  const original = [{role: 'system' as const, content: previous}, {role: 'user' as const, content: budgetCase.contextText}]
  expect(trimMessagesToFit(original, 'codex', 'gpt-6.1-sol', 10_000, undefined, schemaTokens).trimmed).toBe(true)
  const messages = [{role: 'system' as const, content: chatOpeningBackgroundReviewPromptV3()}, original[1]]
  const result = trimMessagesToFit(messages, 'codex', 'gpt-6.1-sol', 10_000, undefined, schemaTokens)
  expect(result.trimmed).toBe(false)
  expect(result.protectedEnvelopePreserved).toBe(true)
  expect(result.messages).toEqual(messages)
  expect(result.inputBudget - result.totalInputTokens).toBeGreaterThan(1000)
  // The physical limit still applies to genuinely larger complete inputs.
  const larger = [messages[0], {...original[1], content: budgetCase.contextText + '额外完整资料'.repeat(10_000)}]
  expect(trimMessagesToFit(larger, 'codex', 'gpt-6.1-sol', 10_000, undefined, schemaTokens).trimmed).toBe(true)
})
