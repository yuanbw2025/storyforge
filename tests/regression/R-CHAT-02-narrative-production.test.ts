import {beforeEach, afterEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {resolveWorkspaceOwnership} from '../../src/lib/workspace/ownership'
import {seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'
import {parseChatSituationCandidatesV1, selectChatNarrativeCandidateV1, chatNarrativeShellV1} from '../../src/lib/character-interaction/narrative-production'
import {parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {saveChatDraftV1, readChatDraftV1} from '../../src/lib/character-interaction/draft-service'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {compileInteractionModulesV1} from '../../src/lib/product-production/product-module-compilers'
import {createProductProductionPlanV3} from '../../src/lib/product-production/plan'
import {productProductionTaskUsesWorldGatewayV1} from '../../src/lib/product-production/source-contracts'
import {getAgentSkillV1} from '../../src/lib/agent/skill-registry'
import {parseProductProductionCommandV1} from '../../src/lib/product-production/contracts'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {interactionVisibilityView, createInitialInteractionState} from '../../src/lib/character-interaction/runtime'
import {executeProductProductionCommand} from '../../src/lib/product-production/commands'
import {createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1} from '../../src/lib/product-production/production-executor'
import {runProductProductionUntilBlockedV1, recoverImportedChatProductionPrefixV1, recoverImportedProductProductionProofsV1} from '../../src/lib/product-production/scheduler'
import {readProductProductionBuildWorldScopeV1} from '../../src/lib/product-production/world-binding'
import {aggregateProductSourceManifestFromExactRunsV1} from '../../src/lib/product/source-contracts'
import {readProductProductionDetailsV1, confirmChatSituationDecisionV1, listProductProductionReviewArtifactsV1, retryProductProductionBlockerV1, publishProductProductionV1} from '../../src/lib/product-production/service'
import {chatSituationCandidatesFixture, chatSituationReferenceDraftFixture, chatOpeningDevelopmentReviewFixture, chatOpeningProofReviewFixture} from '../helpers/chat-narrative-production-fixture'
import {CHAT_OPENING_FACT_CATALOG_KEY, buildChatOpeningFactCatalogV2} from '../../src/lib/character-interaction/opening-source-references'
import type {ChatNarrativeProductionSourceV1} from '../../src/lib/character-interaction/narrative-production'
import {verifyProductBuildTerminalArtifactSetV1} from '../../src/lib/product-production/artifact-store'
import {createCharacterInteractionInstance} from '../../src/lib/product/runtime-instances'
import {readProductRuntimeState} from '../../src/lib/character-interaction/runtime-api'
import {parseProductRuntimePackageV1} from '../../src/lib/product-production/runtime-package'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

async function select(f: Awaited<ReturnType<typeof seedChatNarrativeProductionFixture>>, selectedOptionKey = 'option-2') {
  const selection = {schema: 'storyforge.chat-situation-selection' as const, version: 1 as const,
    candidatesHash: await hashProductProductionValueV2(f.candidates), sourceHash: await hashProductProductionValueV2(f.source),
    selectedOptionKey, authorCommandId: 'author.select.initial'}
  return {selection, content: await selectChatNarrativeCandidateV1({source: f.source, candidates: f.candidates, selection})}
}

it('keeps v3 setup and source confirmation across saving, refresh and project transfer; rejects downgrade and offline permission', async () => {
  const f = await seedChatNarrativeProductionFixture()
  expect(f.settings.version).toBe(3)
  expect(f.settings.sourceReview).not.toBeNull()
  const changed = {...f.settings, narrative: {...f.settings.narrative, personaName: '沈禾'}}
  const saved = await saveChatDraftV1(f.scope, f.confirmed.revision, changed)
  db.close(); await db.open()
  expect(JSON.parse((await readChatDraftV1(f.scope)).settingsJson)).toEqual(changed)
  const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  expect(JSON.parse((await db.chatAuthoringDrafts.where('projectId').equals(importedId).first())!.settingsJson)).toEqual(changed)
  const {narrative: _setup, ...old} = changed
  await expect(saveChatDraftV1(f.scope, saved.revision, {...old, version: 2})).rejects.toThrow('旧版')
  expect(() => parseChatAuthoringSettings({...changed, narrative: {...changed.narrative, permissions: {...changed.narrative.permissions, triggers: ['offline']}}})).toThrow()
  expect(() => parseChatAuthoringSettings({...changed, narrative: {...changed.narrative, openingCount: 2}})).toThrow()
})

it('requires actual different candidates, own goals and exact permissions; candidates carry no author-confirmed seed', async () => {
  const f = await seedChatNarrativeProductionFixture()
  expect(parseChatSituationCandidatesV1(f.candidates, f.source)).toEqual(f.candidates)
  const five = structuredClone(f.candidates)
  for (const n of [4, 5]) {
    const option = structuredClone(f.candidates.options[0])
    option.optionKey = `option-${n}`; option.situation.sceneKey = `scene-${n}`; option.situation.situationKey = `situation-${n}`
    option.situation.facts[0].text = n === 4 ? '刚送来的齿轮装在木盒里。' : '一封尚未打开的委托信放在工作台上。'
    five.options.push(option)
  }
  expect(parseChatSituationCandidatesV1(five, {...f.source, settings: {...f.settings, narrative: {...f.settings.narrative, openingCount: 5}}}).options).toHaveLength(5)
  expect(() => parseChatSituationCandidatesV1(five, f.source)).toThrow('数量')
  expect(JSON.stringify(f.source)).not.toContain('知道失踪船队真相')
  const invalid = structuredClone(f.candidates)
  invalid.options[1].situation = {...structuredClone(invalid.options[0].situation), situationKey: 'other', sceneKey: 'other', title: '改个名字'}
  expect(() => parseChatSituationCandidatesV1(invalid, f.source)).toThrow('只替换')
  invalid.options = invalid.options.slice(0, 2)
  expect(() => parseChatSituationCandidatesV1(invalid, f.source)).toThrow('数量')
  const noGoal = structuredClone(f.candidates); noGoal.options[0].situation.goals = []
  expect(() => parseChatSituationCandidatesV1(noGoal, f.source)).toThrow('自身目标')
  const injectedSeed = structuredClone(f.candidates) as unknown as {options: Array<{situation: Record<string, unknown>}>}
  injectedSeed.options[0].situation.seed = {origin: 'author-confirmed'}
  expect(() => parseChatSituationCandidatesV1(injectedSeed, f.source)).toThrow('字段')
})

it('binds selection to both source and candidates; compiles only the selected situation with no future graph', async () => {
  const f = await seedChatNarrativeProductionFixture()
  const {selection, content} = await select(f)
  const narrative = chatNarrativeShellV1(content)
  expect(narrative.nodes).toHaveLength(1); expect(narrative.choices).toEqual([])
  const compiled = compileInteractionModulesV1({brief: f.brief, sourceCatalog: f.sourceCatalog, narrative, chatNarrative: content})
  expect(compiled.chatNarrative?.initialSituation.title).toBe('旧账本')
  expect(JSON.stringify(compiled)).not.toContain('停摆的纪念钟')
  expect(compiled.profiles[0].characterKey).toBe(f.source.participants[0].characterKey)
  expect(interactionVisibilityView(createInitialInteractionState(compiled), 'player').chatNarrative?.persona.name).toBe(f.settings.narrative.personaName)
  expect(() => compileInteractionModulesV1({brief: f.brief, sourceCatalog: f.sourceCatalog, narrative})).toThrow('选定')
  const drift = structuredClone(content); drift.persona.name = '更换身份'
  expect(() => compileInteractionModulesV1({brief: f.brief, sourceCatalog: f.sourceCatalog, narrative, chatNarrative: drift})).toThrow('身份')
  await expect(selectChatNarrativeCandidateV1({source: f.source, candidates: f.candidates, selection: {...selection, candidatesHash: 'f'.repeat(64)}})).rejects.toThrow('已变化')
  await expect(selectChatNarrativeCandidateV1({source: f.source, candidates: f.candidates, selection: {...selection, sourceHash: 'f'.repeat(64)}})).rejects.toThrow('已变化')
  await expect(selectChatNarrativeCandidateV1({source: f.source, candidates: f.candidates, selection: {...selection, selectedOptionKey: 'absent'}})).rejects.toThrow('不存在')
})

it('plans a durable author gate and prevents the situation model from rereading unreviewed world or Brief prose', async () => {
  const f = await seedChatNarrativeProductionFixture()
  const plan = await createProductProductionPlanV3({brief: f.brief, briefHash: await hashProductProductionValueV2(f.brief), buildNumber: 1})
  const model = plan.tasks.find(t => t.taskKey === 'content.product-module')!
  expect(model.outputArtifactKeys).toEqual(['content.chat-candidates'])
  expect(productProductionTaskUsesWorldGatewayV1(model)).toBe(false)
  expect(getAgentSkillV1(model.skillId!).contextSourceKeys).toEqual(['product-production.artifact-inputs'])
  expect(plan.tasks.find(t => t.taskKey === 'content.narrative')?.executionMode).toBe('deterministic')
  expect(plan.tasks.find(t => t.taskKey === 'content.narrative')?.dependsOn).toEqual(['content.chat-author-gate'])
  expect(productProductionTaskUsesWorldGatewayV1(plan.tasks.find(t => t.taskKey === 'content.design')!)).toBe(true)
  const {selection} = await select(f)
  const {schema: _schema, version: _version, authorCommandId: _author, ...chatSituation} = selection
  const command = {type: 'resolve-blocker', commandId: 'select.initial', expectedStateRevision: 1, blockerKey: 'content.chat-author-gate', resolution: {action: 'confirm-chat-situation', note: '选择旧账本', chatSituation}}
  expect(parseProductProductionCommandV1(command)).toEqual(command)
  expect(() => parseProductProductionCommandV1({...command, resolution: {...command.resolution, chatSituation: {...chatSituation, authorCommandId: 'forged'}}})).toThrow('字段')
})

it.each([
  {mappedPlayer: false, factDiscovery: false, worldDiscovery: false, privateCast: undefined, transferAtSelection: true, referenceWire: false},
  {mappedPlayer: true, factDiscovery: false, worldDiscovery: false, privateCast: undefined, referenceWire: false},
  {mappedPlayer: false, factDiscovery: true, worldDiscovery: false, privateCast: undefined, referenceWire: false},
  {mappedPlayer: true, factDiscovery: false, worldDiscovery: true, privateCast: undefined, referenceWire: false},
  {mappedPlayer: true, factDiscovery: true, worldDiscovery: false, privateCast: 'only' as const, referenceWire: false},
  {mappedPlayer: false, factDiscovery: false, worldDiscovery: false, privateCast: 'mixed' as const, referenceWire: false},
  {mappedPlayer: true, factDiscovery: false, worldDiscovery: true, privateCast: undefined, transferAtSelection: true, referenceWire: true},
  {mappedPlayer: true, factDiscovery: true, worldDiscovery: false, privateCast: 'only' as const, referenceWire: true},
])('runs the formal scheduler through selection, release and transfer without regenerating candidates (mapped=$mappedPlayer, discovery=$factDiscovery, world=$worldDiscovery, private=$privateCast, transfer=$transferAtSelection, references=$referenceWire)', async ({mappedPlayer, factDiscovery, worldDiscovery, privateCast, transferAtSelection, referenceWire}) => {
  const f = await seedChatNarrativeProductionFixture({mappedPlayer, factDiscovery, worldDiscovery, privateCast, consultation: privateCast === 'mixed'})
  const created = await executeProductProductionCommand({scope: f.scope, command: {
    type: 'create-intent', commandId: 'chat.intent', productionKey: 'chat.situation-production', productType: 'character-interaction',
    worldReleaseId: f.confirmed.worldReleaseId!, userText: '制作可以自由演绎的角色聊天',
  }})
  expect(created.ok).toBe(true)
  let productionId = created.productionId
  const saved = await executeProductProductionCommand({scope: f.scope, productionId, command: {
    type: 'save-brief-revision', commandId: 'chat.brief', expectedStateRevision: 0, parentRevision: null, brief: f.brief,
  }})
  expect(saved.ok, JSON.stringify(saved.result)).toBe(true)
  const authorized = await executeProductProductionCommand({scope: f.scope, productionId, command: {
    type: 'authorize-start', commandId: 'chat.start', expectedStateRevision: 1, briefRevision: 1,
    briefHash: saved.result.briefHash as string, authorizationNonce: 'author.start',
  }})
  expect(authorized.ok, JSON.stringify(authorized.result)).toBe(true)
  const requirementKey = f.brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey
  const bindingHash = 'a'.repeat(64)
  const capabilityBindings = [{requirementKey, adapterId: 'configured-text.v1', bindingHash}]
  const calls: string[] = []
  let openingRaw = ''
  let rejectMedia = true
  const runText: ProductionTextRunnerV1 = async request => {
    expect(request.contextText).not.toContain('知道失踪船队真相')
    expect(JSON.stringify(request)).not.toContain('仅作者掌握的私域结局')
    expect(JSON.stringify(request)).not.toContain('S2AUTHOR-ONLY-LINEAGE-NOTE')
    const isSituation = request.system.includes('初始情境编辑'), isReview = request.system.includes('开场的语义审查者')
    calls.push(isSituation ? 'situations' : isReview ? 'opening-review' : 'media')
    const sourceRow = await db.productBuildArtifacts.filter(row => row.artifactKey === 'design.game').last()
    const source = JSON.parse(sourceRow!.payloadJson) as ChatNarrativeProductionSourceV1
    const candidatesRow = isReview ? await db.productBuildArtifacts.filter(row => row.artifactKey === 'content.chat-candidates').last() : undefined
    const candidates = candidatesRow ? JSON.parse(candidatesRow.payloadJson) : chatSituationCandidatesFixture(source)
    const output = isSituation ? referenceWire ? await chatSituationReferenceDraftFixture(source, candidates) : candidates : isReview ? chatOpeningProofReviewFixture(source, candidates, chatOpeningDevelopmentReviewFixture(candidates, 'option-1')) : rejectMedia ? {invalid: 'bounded failure after author selection'} : {
      schema: 'storyforge.product-media-requirements-artifact', version: 2, visual: [], audio: [],
    }
    if (isSituation) {
      openingRaw = JSON.stringify(output)
      const catalog = await buildChatOpeningFactCatalogV2(source)
      expect(JSON.parse((await db.productBuildArtifacts.filter(row => row.artifactKey === CHAT_OPENING_FACT_CATALOG_KEY).last())!.payloadJson)).toEqual(catalog)
      expect(request.contextText).toContain(CHAT_OPENING_FACT_CATALOG_KEY)
      if (referenceWire) expect(openingRaw).not.toContain('"sourceKnowledgeKey"')
    }
    return {output: JSON.stringify(output), usage: {inputTokens: 100, outputTokens: 100}, bindingReceipt: {
      schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
      provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
      credentialSource: 'existing-ai-config', credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: 'b'.repeat(64),
    }}
  }
  const execute = async () => runProductProductionUntilBlockedV1({scope: f.scope, productionId, capabilityBindings,
    executor: createConfiguredProductProductionExecutorV1({production: (await db.productProductions.get(productionId))!, brief: f.brief, runText})})
  await execute()
  let details = await readProductProductionDetailsV1(f.scope, productionId)
  expect(JSON.parse(details.build!.failureJson), details.build!.failureJson).toMatchObject({taskKey: 'content.chat-author-gate'})
  expect(calls).toEqual(['situations', 'opening-review'])
  if (referenceWire) {
    const accepted = JSON.parse((await db.productBuildArtifacts.filter(row => row.artifactKey === 'content.chat-candidates').last())!.payloadJson)
    expect(accepted.schema).toBe('storyforge.chat-situation-candidates')
    expect(await db.agentRunArtifacts.filter(row => row.artifactKind === 'raw-response' && row.content === openingRaw).count()).toBe(1)
    if (worldDiscovery) {
      const truth = f.source.source.knowledge.find(k => k.discovery)!
      for (const option of accepted.options) {
        expect(option.situation.facts.find((fact: {sourceKnowledgeKey: string}) => fact.sourceKnowledgeKey === truth.key))
          .toMatchObject({text: truth.content, audienceKeys: [], origin: 'reviewed-world'})
      }
    }
  }
  expect(JSON.parse(details.build!.budgetLedgerJson).attempts.find((a: {taskKey: string}) => a.taskKey === 'content.chat-author-gate'))
    .toMatchObject({usageKnown: true, usage: {modelCalls: 0, mediaCalls: 0, costUsd: 0}})
  if (transferAtSelection) {
    const before = details.brief!
    const originalArtifacts = await db.productBuildArtifacts.where('buildId').equals(details.build!.id!).toArray()
    const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    f.scope = (await resolveWorkspaceOwnership(importedId)).scope
    productionId = (await db.productProductions.where('projectId').equals(importedId).first())!.id!
    details = await readProductProductionDetailsV1(f.scope, productionId)
    expect(details.brief!.sourceWorldReleaseId).not.toBe(before.sourceWorldReleaseId)
    expect(details.brief!.briefJson).toBe(before.briefJson)
    expect(details.brief!.briefHash).toBe(before.briefHash)
    expect(details.brief!.sourcePlanHash).toBe(before.sourcePlanHash)
    const restoredArtifacts = await db.productBuildArtifacts.where('buildId').equals(details.build!.id!).toArray()
    expect(restoredArtifacts.map(row => [row.artifactKey, row.contentHash, row.payloadJson]))
      .toEqual(originalArtifacts.map(row => [row.artifactKey, row.contentHash, row.payloadJson]))
    expect(calls).toEqual(['situations', 'opening-review'])
    const briefRow = details.brief!, buildId = details.build!.id!
    const bind = () => readProductProductionBuildWorldScopeV1({scope: f.scope, productionId, buildId, brief: f.brief})
    for (const patch of [
      {sourceWorldReleaseId: null}, {sourceWorldContentHash: 'f'.repeat(64)},
      {sourcePlanHash: 'f'.repeat(64)}, {briefJson: '{}'},
    ]) {
      await db.productProductionBriefs.update(briefRow.id!, patch)
      await expect(bind()).rejects.toThrow()
      await db.productProductionBriefs.put(briefRow)
    }
    const wrongScope = JSON.parse(briefRow.sourcePlanJson)
    wrongScope.worldReference.localReleaseRecordId = before.sourceWorldReleaseId
    await db.productProductionBriefs.update(briefRow.id!, {
      sourceWorldReleaseId: before.sourceWorldReleaseId, sourcePlanJson: JSON.stringify(wrongScope),
    })
    await expect(bind()).rejects.toThrow('世界作用域')
    await db.productProductionBriefs.put(briefRow)
    await expect(bind()).resolves.toMatchObject({worldReleaseId: briefRow.sourceWorldReleaseId})
    const recover = () => recoverImportedChatProductionPrefixV1({scope: f.scope, productionId,
      expectedStateRevision: details.production.stateRevision})
    const originalDesign = originalArtifacts.find(row => row.artifactKey === 'design.game')!
    const restoredDesign = restoredArtifacts.find(row => row.artifactKey === 'design.game')!
    const assembled = (await db.agentRunEvents.where('runId').equals(originalDesign.producerRunId!).toArray())
      .find(event => event.type === 'context.assembled')!
    const pointer = JSON.parse(assembled.payloadJson)
    const aggregate = (scope: typeof f.scope, runId: number) => aggregateProductSourceManifestFromExactRunsV1({
      scope, sourcePlan: JSON.parse(briefRow.sourcePlanJson), runContextManifests: [{runId,
        stepId: pointer.stepId, attempt: pointer.attempt, manifestHash: pointer.manifestHash}],
    })
    // Even identical portable content cannot excuse a scope mismatch without
    // an actual imported, locally revalidated completed producer.
    await expect(aggregate({projectId: before.projectId, worldId: before.worldId, workId: before.workId},
      originalDesign.producerRunId!)).rejects.toThrow('release/policy')
    await expect(aggregate(f.scope, restoredDesign.producerRunId!)).rejects.toThrow('release/policy')
    const candidate = restoredArtifacts.find(row => row.artifactKey === 'content.chat-candidates')!
    // Matching payload/hash alone is insufficient: the exact original candidate
    // and envelope must agree with the settled producer checkpoint.
    const forgedPayload = {...JSON.parse(candidate.payloadJson), title: '伪造导入候选'}
    await db.productBuildArtifacts.update(candidate.id!, {payloadJson: JSON.stringify(forgedPayload),
      contentHash: await hashProductProductionValueV2(forgedPayload)})
    await expect(recover()).rejects.toThrow('完成证据')
    await db.productBuildArtifacts.put(candidate)
    await db.productBuildArtifacts.update(candidate.id!, {metadataJson: '{"forged":true}'})
    await expect(recover()).rejects.toThrow('完成证据')
    await db.productBuildArtifacts.put(candidate)
    const checkpoint = (await db.agentRunCheckpoints.where('runId').equals(candidate.producerRunId!).toArray()).at(-1)!
    await db.agentRunCheckpoints.delete(checkpoint.id!)
    await expect(recover()).rejects.toThrow('checkpoint')
    await db.agentRunCheckpoints.put(checkpoint)
    const eventsBefore = await db.agentRunEvents.where('runId').equals(candidate.producerRunId!).count()
    await recover()
    await expect(aggregate(f.scope, restoredDesign.producerRunId!)).resolves.toMatchObject({sourcePlanHash: briefRow.sourcePlanHash})
    const eventsAfter = await db.agentRunEvents.where('runId').equals(candidate.producerRunId!).count()
    expect(eventsAfter).toBeGreaterThan(eventsBefore)
    await recover()
    expect(await db.agentRunEvents.where('runId').equals(candidate.producerRunId!).count()).toBe(eventsAfter)
    expect((await db.productBuilds.get(buildId))!.budgetLedgerJson).toBe(details.build!.budgetLedgerJson)
    expect(calls).toEqual(['situations', 'opening-review'])
  }
  db.close(); await db.open()
  details = await readProductProductionDetailsV1(f.scope, productionId)
  const artifacts = await listProductProductionReviewArtifactsV1({scope: f.scope, buildId: details.build!.id!})
  const candidates = artifacts.find(a => a.artifactKey === 'content.chat-candidates')!
  const source = artifacts.find(a => a.artifactKey === 'design.game')!
  expect(candidates).toBeDefined(); expect(source).toBeDefined()
  await expect(confirmChatSituationDecisionV1({scope: f.scope, details, candidatesHash: 'f'.repeat(64), sourceHash: source.contentHash, selectedOptionKey: 'option-2'})).rejects.toThrow('版本')
  await expect(confirmChatSituationDecisionV1({scope: f.scope, details, candidatesHash: candidates.contentHash, sourceHash: source.contentHash, selectedOptionKey: 'option-1'})).rejects.toThrow()
  await confirmChatSituationDecisionV1({scope: f.scope, details, candidatesHash: candidates.contentHash, sourceHash: source.contentHash, selectedOptionKey: 'option-2'})
  await expect(confirmChatSituationDecisionV1({scope: f.scope, details, candidatesHash: candidates.contentHash, sourceHash: source.contentHash, selectedOptionKey: 'option-3'})).rejects.toThrow()
  await execute()
  details = await readProductProductionDetailsV1(f.scope, productionId)
  expect(JSON.parse(details.build!.failureJson)).toMatchObject({taskKey: 'media.requirements'})
  expect(calls).toEqual(['situations', 'opening-review', 'media', 'media'])
  if (transferAtSelection) {
    const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    f.scope = (await resolveWorkspaceOwnership(importedId)).scope
    productionId = (await db.productProductions.where('projectId').equals(importedId).first())!.id!
    expect(calls).toEqual(['situations', 'opening-review', 'media', 'media'])
  }
  // The selected situation is a durable author decision and must survive a
  // later task failure; ordinary retries cannot silently choose a new opening.
  db.close(); await db.open()
  details = await readProductProductionDetailsV1(f.scope, productionId)
  rejectMedia = false
  await retryProductProductionBlockerV1({scope: f.scope, details})
  await execute()
  details = await readProductProductionDetailsV1(f.scope, productionId)
  expect(details.build!.status, details.build!.failureJson).toBe('release-ready')
  expect(calls).toEqual(['situations', 'opening-review', 'media', 'media', 'media'])
  const completed = await listProductProductionReviewArtifactsV1({scope: f.scope, buildId: details.build!.id!})
  const runtime = parseProductRuntimePackageV1(completed.find(a => a.artifactKey === 'runtime.package')!.payload)
  if (privateCast === 'mixed') {
    expect(JSON.parse(details.brief!.sourcePlanJson).consultationContextManifests).toHaveLength(1)
    expect(JSON.stringify(runtime)).not.toContain('S2AUTHOR-ONLY-LINEAGE-NOTE')
  }
  expect(runtime.interaction?.chatNarrative?.initialSituation.title).toBe('旧账本')
  if (privateCast) {
    expect(runtime.interaction!.chatSource!.version).toBe(5)
    expect(runtime.interaction!.chatSource!.privateCharacterSources!.map(c => c.resourceKey)).toEqual(f.settings.privateCharacters!.map(c => c.characterKey))
    expect(runtime.interaction!.profiles.some(p => p.characterKey === f.settings.privateCharacters![0].characterKey && p.name === '苏禾')).toBe(true)
    expect(JSON.stringify(runtime)).not.toContain('仅作者掌握的私域结局')
  }
  expect(runtime.narrative.choices).toEqual([])
  expect(runtime.narrative.nodes.some(n => n.kind === 'ending')).toBe(false)
  const exposed = structuredClone(runtime)
  exposed.narrative.nodes[0].summary = '泄露幕后真相'
  expect(() => parseProductRuntimePackageV1(exposed)).toThrow('不能混入')
  const fixedEnding = structuredClone(runtime)
  fixedEnding.narrative.nodes[0].kind = 'ending'
  expect(() => parseProductRuntimePackageV1(fixedEnding)).toThrow('不能混入')
  await execute()
  expect(calls).toEqual(['situations', 'opening-review', 'media', 'media', 'media'])
  // Publication must prove both the original paid candidate and the later
  // zero-provider reuse. A valid root row seal alone cannot authorize it.
  const build = details.build!
  const verify = () => verifyProductBuildTerminalArtifactSetV1({scope: f.scope, productionId,
    buildId: build.id!, expectedControlEpoch: build.controlEpoch, expectedPlanHash: build.planHash})
  await verify()
  const allRows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
  const copied = allRows.find(row => row.artifactKey === 'content.chat-candidates' && row.status === 'carried-forward')!
  const origin = allRows.find(row => row.artifactKey === copied.artifactKey && row.carriedFrom === null)!
  const ledger = JSON.parse(build.budgetLedgerJson)
  expect(copied.producerRunId).toBe(origin.producerRunId)
  expect(copied.producerRunId).not.toBe(ledger.tasks['content.product-module'].runId)
  for (const patch of [
    {producerRunId: ledger.tasks['content.product-module'].runId},
    {producerReceiptHash: 'f'.repeat(64)},
    {inputHash: 'f'.repeat(64)},
    {carriedFrom: {...copied.carriedFrom!, version: copied.version}},
  ]) {
    await db.productBuildArtifacts.update(copied.id!, patch)
    await expect(verify()).rejects.toThrow(/chat carry/)
    await db.productBuildArtifacts.put(copied)
  }
  await db.productBuildArtifacts.update(origin.id!, {metadataJson: '{"forged":true}'})
  await expect(verify()).rejects.toThrow(/chat carry origin/)
  await db.productBuildArtifacts.put(origin)
  const checkpoint = (await db.agentRunCheckpoints.where('runId').equals(origin.producerRunId!).toArray()).at(-1)!
  await db.agentRunCheckpoints.delete(checkpoint.id!)
  await expect(verify()).rejects.toThrow(/checkpoint/)
  await db.agentRunCheckpoints.put(checkpoint)
  const forgedLedger = structuredClone(ledger)
  forgedLedger.tasks['content.product-module'].terminalReceiptHash = 'f'.repeat(64)
  await db.productBuilds.update(build.id!, {budgetLedgerJson: JSON.stringify(forgedLedger)})
  await expect(verify()).rejects.toThrow(/chat carry/)
  await db.productBuilds.put(build)
  if (transferAtSelection) {
    // Legacy backups predate explicit zero-cost author-choice bookkeeping.
    const legacyLedger = JSON.parse(build.budgetLedgerJson)
    const gate = legacyLedger.attempts.find((a: {taskKey: string; controlEpoch: number}) =>
      a.taskKey === 'content.chat-author-gate' && a.controlEpoch === 0)
    gate.usageKnown = false; gate.usage = null
    await db.productBuilds.update(build.id!, {budgetLedgerJson: JSON.stringify(legacyLedger)})
    const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    f.scope = (await resolveWorkspaceOwnership(importedId)).scope
    productionId = (await db.productProductions.where('projectId').equals(importedId).first())!.id!
    details = await readProductProductionDetailsV1(f.scope, productionId)
    const restoredBuild = details.build!
    const restoredRows = await db.productBuildArtifacts.where('buildId').equals(restoredBuild.id!).toArray()
    const original = restoredRows.find(row => row.artifactKey === 'content.chat-candidates'
      && row.status === 'invalid' && row.carriedFrom === null)!
    const recover = () => recoverImportedProductProductionProofsV1({scope: f.scope, productionId})
    await expect(recoverImportedProductProductionProofsV1({scope: {projectId: build.projectId, workId: build.workId, worldId: build.worldId}, productionId})).rejects.toThrow()
    const historicalCheckpoint = (await db.agentRunCheckpoints.where('runId').equals(original.producerRunId!).toArray()).at(-1)!
    await db.agentRunCheckpoints.delete(historicalCheckpoint.id!)
    await expect(recover()).rejects.toThrow('checkpoint')
    await db.agentRunCheckpoints.put(historicalCheckpoint)
    await db.productBuildArtifacts.update(original.id!, {metadataJson: '{"forged":true}'})
    await expect(recover()).rejects.toThrow('historical accepted payload')
    await db.productBuildArtifacts.put(original)
    const importedLedger = JSON.parse(restoredBuild.budgetLedgerJson)
    const missingAttempt = structuredClone(importedLedger)
    missingAttempt.attempts = missingAttempt.attempts.filter((a: {runId: number}) => a.runId !== original.producerRunId)
    await db.productBuilds.update(restoredBuild.id!, {budgetLedgerJson: JSON.stringify(missingAttempt)})
    await expect(recover()).rejects.toThrow('结算证据')
    await db.productBuilds.put(restoredBuild)
    const unknownPaid = structuredClone(importedLedger)
    const paid = unknownPaid.attempts.find((a: {runId: number}) => a.runId === original.producerRunId)
    paid.usageKnown = false
    await db.productBuilds.update(restoredBuild.id!, {budgetLedgerJson: JSON.stringify(unknownPaid)})
    await expect(recover()).rejects.toThrow('预算证明')
    await db.productBuilds.put(restoredBuild)
    const recovered = await recover()
    expect(recovered.terminal).toBe(true)
    const count = await db.agentRunEvents.where('projectId').equals(f.scope.projectId).count()
    await recover()
    expect(await db.agentRunEvents.where('projectId').equals(f.scope.projectId).count()).toBe(count)
    expect((await db.productBuilds.get(restoredBuild.id!))!.budgetLedgerJson).toBe(restoredBuild.budgetLedgerJson)
    expect((await db.productBuilds.get(restoredBuild.id!))!.packageHash).toBe(build.packageHash)
    expect(await db.productBuildArtifacts.where('buildId').equals(restoredBuild.id!).toArray()).toEqual(restoredRows)
    expect(calls).toEqual(['situations', 'opening-review', 'media', 'media', 'media'])
  }
  const published = await publishProductProductionV1({scope: f.scope, productionId})
  expect(published.receipt.productReleaseId).toBeGreaterThan(0)
  const session = await createCharacterInteractionInstance({scope: f.scope,
    productReleaseId: published.receipt.productReleaseId, title: '从正式开场继续'})
  const state = await readProductRuntimeState(session.id!)
  expect(state.interaction!.chatNarrative!.situation.title).toBe('旧账本')
  if (factDiscovery) {
    expect(state.interaction!.chatNarrative!.permissions.maxDiscoveriesPerSituation).toBe(2)
    expect(state.interaction!.chatNarrative!.situation.facts.find(f => f.factKey === 'hidden-note')?.discovery).toMatchObject({sceneKey: 'scene-2', prerequisiteFactKeys: ['parcel']})
    expect(JSON.stringify(interactionVisibilityView(state.interaction!, 'player'))).not.toContain('未署名的清单')
  }
  if (worldDiscovery) {
    expect(runtime.interaction!.chatSource!.version).toBe(4)
    const sourceTruth = f.source.source.knowledge.find(k => k.discovery)!
    expect(state.interaction!.chatNarrative!.situation.facts.find(f => f.sourceKnowledgeKey === sourceTruth.key)).toMatchObject({text: sourceTruth.content, audienceKeys: [], origin: 'reviewed-world', discovery: {sceneKey: 'scene-2', condition: sourceTruth.discovery!.condition}})
    expect(JSON.stringify(interactionVisibilityView(state.interaction!, 'player'))).not.toContain('红铜钥匙')
  }
  expect(state.interaction!.chatNarrative!.persona.name).toBe(f.settings.narrative.personaName)
  if (mappedPlayer) {
    expect(state.interaction!.chatNarrative!.persona.origin).toBe('world-character')
    expect(state.interaction!.chatNarrative!.persona.source).toEqual(f.source.source.playerCharacterSource)
    expect(state.interaction!.profiles.some(p => p.characterKey === f.settings.narrative.playerCharacterKey)).toBe(false)
  }
  db.close(); await db.open()
  expect(await readProductRuntimeState(session.id!)).toEqual(state)
  const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  if (privateCast === 'mixed') {
    const restoredBrief = (await db.productProductionBriefs.where('projectId').equals(importedId).first())!
    expect(restoredBrief.sourcePlanHash).toBe(details.brief!.sourcePlanHash)
    expect(JSON.parse(restoredBrief.sourcePlanJson).consultationContextManifests).toEqual(JSON.parse(details.brief!.sourcePlanJson).consultationContextManifests)
  }
  const restored = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()).find(row => row.title === session.title)!
  expect((await readProductRuntimeState(restored.id!)).interaction!.chatNarrative).toEqual(state.interaction!.chatNarrative)
  expect(calls).toEqual(['situations', 'opening-review', 'media', 'media', 'media'])
}, 60_000)
