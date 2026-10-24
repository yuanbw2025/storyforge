import {resolveProductMediaProviderAdapterV1, type RedactedMediaTransportRequestV1} from '../../src/lib/product-production/media-adapters'
import type {ResolvedProductMediaCapabilityV1} from '../../src/lib/product-production/media-transport'
import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedChatNarrativeProductionFixture, chatSituationCandidatesFixture, chatOpeningDevelopmentReviewFixture, chatOpeningProofReviewFixture} from '../helpers/chat-narrative-production-fixture'
import {seedIllustratedChatBriefFixture as illustrated, seedChatMediaConfirmationFixture} from '../helpers/chat-media-production-fixture'
import {parseProductProductionBriefV3} from '../../src/lib/product-production/contracts'
import {createProductProductionPlanV3} from '../../src/lib/product-production/plan'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {createChatVisualRequirementsV1} from '../../src/lib/character-interaction/visual-intent'
import {chatNarrativeFixture} from '../helpers/chat-narrative-fixture'
import {productProductionTaskUsesWorldGatewayV1} from '../../src/lib/product-production/source-contracts'
import {createConfiguredProductProductionExecutorV1, createBuiltInProductionCapabilityBindingV1,
  parseProductMediaRequirementsArtifactV2, type ProductionTextRunnerV1} from '../../src/lib/product-production/production-executor'
import {executeProductProductionCommand} from '../../src/lib/product-production/commands'
import {runProductProductionUntilBlockedV1} from '../../src/lib/product-production/scheduler'
import {canRetryProductProductionBlockerV1, confirmChatSituationDecisionV1, confirmChatMediaDecisionV1, readProductProductionDetailsV1, publishProductProductionV1} from '../../src/lib/product-production/service'
import {readCurrentChatMediaReviewV1} from '../../src/lib/product-production/chat-media-authority'
import {parseProductRuntimePackageV1} from '../../src/lib/product-production/runtime-package'
import {verifyProductBuildTerminalArtifactSetV1} from '../../src/lib/product-production/artifact-store'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {exportProductDistributionBundleV2, importCommunityProductDistributionV1} from '../../src/lib/product-platform/distribution-bundle'
import {createChatDraftV3} from '../../src/lib/character-interaction/draft-service'
import {createCharacterInteractionInstance} from '../../src/lib/product/runtime-instances'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

it('opts into exact public pictures with a durable author gate and keeps historical text plans closed', async () => {
  const f = await illustrated('only'), brief = f.brief
  expect(brief.media).toMatchObject({imageCount: 2, visualLevel: 'key-scenes', requiredMediaKinds: ['character-pose', 'background']})
  const plan = await createProductProductionPlanV3({brief, briefHash: await hashProductProductionValueV2(brief), buildNumber: 1})
  const requirements = plan.tasks.find(task => task.taskKey === 'media.requirements')!
  expect(requirements).toMatchObject({executionMode: 'deterministic', skillId: null, budgetReservation: {modelCalls: 0, mediaCalls: 0}})
  expect(productProductionTaskUsesWorldGatewayV1(requirements)).toBe(true)
  expect(plan.tasks.find(task => task.taskKey === 'media.visual')).toMatchObject({failurePolicy: 'pause', inputArtifactKeys: ['media.requirements']})
  expect(plan.tasks.find(task => task.taskKey === 'integration.package')!.dependsOn).toContain('media.chat-author-gate')
  expect(plan.tasks.find(task => task.taskKey === 'media.chat-author-gate')!.executionMode).toBe('deterministic')
  for (const bad of [
    {...brief, media: {...brief.media, imageCount: 3}},
    {...brief, media: {...brief.media, visualLevel: 'illustrated'}},
    {...brief, characterChat: {...brief.characterChat, visuals: undefined}},
    {...brief, capabilityRequirements: brief.capabilityRequirements.filter(item => item.mediaClass !== 'image')},
  ]) expect(() => parseProductProductionBriefV3(bad)).toThrow()
  const text = await seedChatNarrativeProductionFixture()
  const old = await createProductProductionPlanV3({brief: text.brief, briefHash: await hashProductProductionValueV2(text.brief), buildNumber: 1})
  expect(old.tasks.some(task => task.taskKey.startsWith('media.chat-'))).toBe(false)
  expect(old.tasks.find(task => task.taskKey === 'media.requirements')!.executionMode).toBe('model')
  // Public request validation cannot append private role/forbidden-change text.
  const content = chatNarrativeFixture(); content.profiles[0].characterKey = f.source.participants[0].characterKey
  const visuals = brief.characterChat!.version === 3 ? brief.characterChat!.visuals! : undefined!
  const request = createChatVisualRequirementsV1(visuals, content, 'opening')
  brief.intent.playerRole = 'PRIVATE-PLAYER-ROLE'; brief.intent.forbiddenChanges = ['PRIVATE-CHANGE']
  expect(parseProductMediaRequirementsArtifactV2(request, brief, [], null, 'frozen')).toEqual(request)
  for (const mutate of [
    (value: typeof request) => {value.visual[0].prompt += ' SECRET'},
    (value: typeof request) => {value.visual[0].hardConstraints.push('SECRET')},
    (value: typeof request) => {value.visual[1].sceneTag = 'future-scene'},
    (value: typeof request) => {value.visual[0].characterAnchorRefs = ['intent:protagonist']},
  ]) {const changed = structuredClone(request); mutate(changed); expect(() => parseProductMediaRequirementsArtifactV2(changed, brief, [], null, 'frozen')).toThrow()}
})

it.each([undefined, 'only'] as const)('runs formal image production, author confirmation, release and transfer (private=%s)', async privateCast => {
  const f = await illustrated(privateCast), brief = f.brief
  const worldBefore = await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()
  const created = await executeProductProductionCommand({scope: f.scope, command: {type: 'create-intent', commandId: 'chat-media.create', productionKey: 'chat.media-production', productType: 'character-interaction',
    worldReleaseId: f.confirmed.worldReleaseId!, userText: '制作作者明确描述的两张图片'}})
  expect(created.ok).toBe(true); const productionId = created.productionId
  const saved = await executeProductProductionCommand({scope: f.scope, productionId, command: {type: 'save-brief-revision', commandId: 'chat-media.brief', expectedStateRevision: 0, parentRevision: null, brief}})
  expect(saved.ok, JSON.stringify(saved)).toBe(true)
  const authorized = await executeProductProductionCommand({scope: f.scope, productionId, command: {type: 'authorize-start', commandId: 'chat-media.start', expectedStateRevision: 1,
    briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'author.start'}})
  expect(authorized.ok, JSON.stringify(authorized)).toBe(true)
  const requirementKey = brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey, bindingHash = 'a'.repeat(64), calls: string[] = []
  const runText: ProductionTextRunnerV1 = async request => {
    expect(request.contextText).not.toContain('银灰短发'); expect(request.contextText).not.toContain('仅作者掌握的私域结局')
    expect(request.contextText).not.toMatch(/CARD_CREATOR_METADATA_ONLY|CARD_NOTES_METADATA_ONLY/)
    const isSituation = request.system.includes('初始情境编辑'), isReview = request.system.includes('开场的语义审查者')
    expect(isSituation || isReview).toBe(true); calls.push(isSituation ? 'situations' : 'review')
    const source = JSON.parse((await db.productBuildArtifacts.filter(row => row.artifactKey === 'design.game').last())!.payloadJson)
    const candidates = isSituation ? chatSituationCandidatesFixture(source) : JSON.parse((await db.productBuildArtifacts.filter(row => row.artifactKey === 'content.chat-candidates').last())!.payloadJson)
    return {output: JSON.stringify(isSituation ? candidates : chatOpeningProofReviewFixture(source, candidates, chatOpeningDevelopmentReviewFixture(candidates, 'option-1'))),
      usage: {inputTokens: 100, outputTokens: 100}, bindingReceipt: {schema: 'storyforge.provider-binding-receipt', version: 1,
        requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'fixture-model',
        endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct', credentialSource: 'existing-ai-config',
        credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: 'b'.repeat(64)}}
  }
  const capabilityBindings = [{requirementKey, adapterId: 'configured-text.v1', bindingHash},
    await createBuiltInProductionCapabilityBindingV1({requirementKey: 'media.visual', adapterId: 'storyforge.procedural-svg.v1'})]
  // Re-read the owning production for each continuation; no mocked scheduler.
  const run = async () => {
    const production = (await db.productProductions.get(productionId))!
    return runProductProductionUntilBlockedV1({scope: f.scope, productionId, capabilityBindings,
      executor: createConfiguredProductProductionExecutorV1({production, brief, runText})})
  }
  await run()
  let details = await readProductProductionDetailsV1(f.scope, productionId)
  expect(JSON.parse(details.build!.failureJson), details.build!.failureJson).toMatchObject({taskKey: 'content.chat-author-gate'})
  const rows = await db.productBuildArtifacts.where('buildId').equals(details.build!.id!).toArray()
  await confirmChatSituationDecisionV1({scope: f.scope, details, candidatesHash: rows.find(row => row.artifactKey === 'content.chat-candidates')!.contentHash,
    sourceHash: rows.find(row => row.artifactKey === 'design.game')!.contentHash, selectedOptionKey: 'option-2'})
  await run()
  details = await readProductProductionDetailsV1(f.scope, productionId)
  expect(JSON.parse(details.build!.failureJson), details.build!.failureJson).toMatchObject({taskKey: 'media.chat-author-gate'})
  expect(canRetryProductProductionBlockerV1(details)).toBe(false)
  expect(calls).toEqual(['situations', 'review'])
  const review = await readCurrentChatMediaReviewV1({scope: f.scope, build: details.build!})
  expect(review.images).toHaveLength(2); expect(review.images.every(image => image.bytes.byteLength > 0)).toBe(true)
  expect(await db.productReleases.count()).toBe(0)
  if (privateCast === 'only') {
    const adapterId = 'openai.gpt-image-2.v1', capabilityHash = 'c'.repeat(64), outgoing: RedactedMediaTransportRequestV1[] = []
    const binding = {requirementKey: 'media.visual', adapterId, bindingHash: capabilityHash}
    const resolved: ResolvedProductMediaCapabilityV1 = {binding, adapter: resolveProductMediaProviderAdapterV1(adapterId),
      transport: {executionLocation: 'trusted-relay', request: async request => {outgoing.push(structuredClone(request)); throw new Error('TEST_STOP_AFTER_SERIALIZATION')}},
      receipt: {schema: 'storyforge.media-relay-binding-receipt', version: 1, requirementKey: 'media.visual', adapterId, adapterVersion: 1,
        relayOrigin: 'https://fixture.invalid', executionLocation: 'trusted-relay', credentialSource: 'relay-session', capabilityHash, boundAt: 1, receiptHash: 'd'.repeat(64)}}
    const plan = JSON.parse(details.build!.planJson), currentRows = (await db.productBuildArtifacts.where('buildId').equals(details.build!.id!).toArray())
      .filter(row => row.controlEpoch === details.build!.controlEpoch && row.artifactKey === 'media.requirements')
    const isolated = createConfiguredProductProductionExecutorV1({production: details.production, brief, runText, mediaCapabilities: new Map([['media.visual', resolved]])})
    const objectsBefore = await db.mediaBlobObjects.count()
    await expect(isolated({scope: f.scope, productionId, buildId: details.build!.id!, buildNumber: details.build!.buildNumber,
      controlEpoch: details.build!.controlEpoch, planHash: details.build!.planHash, task: plan.tasks.find((task: {taskKey: string}) => task.taskKey === 'media.visual'),
      attempt: 1, idempotencyKey: 'e'.repeat(64), contextText: 'PRIVATE_CONTEXT_MUST_NOT_LEAVE', inputArtifacts: currentRows,
      capabilityBindings: [binding], authorResolution: null, signal: new AbortController().signal})).rejects.toThrow('TEST_STOP_AFTER_SERIALIZATION')
    expect(outgoing).toHaveLength(1)
    expect(JSON.stringify(outgoing)).toContain('银灰短发')
    for (const secret of ['PRIVATE_CONTEXT_MUST_NOT_LEAVE', brief.intent.playerRole, '仅作者掌握的私域结局', '知道失踪船队真相', '苏禾', 'CARD_CREATOR_METADATA_ONLY', 'CARD_NOTES_METADATA_ONLY']) expect(JSON.stringify(outgoing)).not.toContain(secret)
    expect(await db.mediaBlobObjects.count()).toBe(objectsBefore)
  }
  const actor = review.source.interaction.profiles[0], scene = review.source.interaction.chatNarrative!.initialSituation
  const bindings = {schema: 'storyforge.chat-media' as const, version: 1 as const,
    participants: [{participantKey: actor.participantKey, avatarAssetKey: review.source.assets.find(asset => asset.kind === 'character-pose')!.assetKey,
      portraitAssetKey: review.source.assets.find(asset => asset.kind === 'character-pose')!.assetKey}],
    scenes: [{sceneKey: scene.sceneKey, location: scene.location, backgroundAssetKey: review.source.assets.find(asset => asset.kind === 'background')!.assetKey}]}
  await confirmChatMediaDecisionV1({scope: f.scope, details, decision: {buildNumber: details.build!.buildNumber, controlEpoch: details.build!.controlEpoch, sourceHash: review.sourceHash, bindings}})
  db.close(); await db.open(); await run()
  details = await readProductProductionDetailsV1(f.scope, productionId)
  expect(details.build!.status, details.build!.failureJson).toBe('release-ready')
  const runtimeRow = (await db.productBuildArtifacts.where('buildId').equals(details.build!.id!).toArray()).find(row => row.controlEpoch === details.build!.controlEpoch && row.artifactKey === 'runtime.package')!
  const runtime = parseProductRuntimePackageV1(JSON.parse(runtimeRow.payloadJson))
  expect(runtime.interaction!.chatMedia).toEqual(bindings)
  if (privateCast === 'only') {
    expect(runtime.interaction!.chatCardCredits!.characters[0]).toMatchObject({creator: 'CARD_CREATOR_METADATA_ONLY', cardContentHash: f.settings.privateCharacters![0].cardOrigin!.contentHash})
    expect(JSON.stringify(runtime)).not.toContain('CARD_NOTES_METADATA_ONLY')
    expect(JSON.stringify(runtime.interaction!.chatSource)).not.toContain('CARD_CREATOR_METADATA_ONLY')
  }
  else expect(runtime.interaction!.chatCardCredits).toBeUndefined()
  expect(runtime.presentation!.assets).toEqual(review.source.assets); expect(runtime.presentation!.cues).toEqual([])
  await verifyProductBuildTerminalArtifactSetV1({scope: f.scope, productionId, buildId: details.build!.id!, expectedControlEpoch: details.build!.controlEpoch, expectedPlanHash: details.build!.planHash})
  await run(); expect(calls).toEqual(['situations', 'review'])
  const published = await publishProductProductionV1({scope: f.scope, productionId})
  const release = await db.productReleases.get(published.receipt.productReleaseId)
  expect(JSON.parse(release!.manifestJson).runtimePackage).toEqual(runtime)
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const copy = (await db.productReleases.where('projectId').equals(imported).first())!
  expect(copy.contentHash).toBe(release!.contentHash)
  expect(JSON.parse(copy.manifestJson).runtimePackage.interaction.chatMedia).toEqual(bindings)
  if (privateCast === 'only') {
    const bundle = await exportProductDistributionBundleV2({scope: f.scope, productReleaseId: release!.id!})
    expect(JSON.stringify(bundle)).not.toContain('CARD_NOTES_METADATA_ONLY')
    const target = await createChatDraftV3('独立安装工程验证')
    const installed = await importCommunityProductDistributionV1({scope: target.scope, bundle, catalogKey: 'chat-card-engineering',
      attribution: ['工程夹具，仅限测试'], license: {licenseId: 'fixture-only', licenseVersion: '1', allowOfflineExport: true,
        allowRemix: false, commercialReuse: false, requiresAttribution: true, termsUrl: 'https://fixture.invalid/license'}})
    expect(await db.worldReleases.where('projectId').equals(target.scope.projectId).count()).toBe(0)
    const session = await createCharacterInteractionInstance({scope: target.scope, productReleaseId: installed.id!, title: '独立存档'})
    expect(session.productReleaseId).toBe(installed.id)
    expect(JSON.parse(installed.manifestJson).runtimePackage.interaction.chatCardCredits).toEqual(runtime.interaction!.chatCardCredits)
    expect((await exportProductDistributionBundleV2({scope: target.scope, productReleaseId: installed.id!})).bundleHash).toBe(bundle.bundleHash)
  }
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worldBefore)
}, 30_000)

it('seeds the browser confirmation fixture through the real scheduler without an image approval', async () => {
  const f = await seedChatMediaConfirmationFixture()
  const details = await readProductProductionDetailsV1(f.scope, f.productionId)
  expect(details.build!.status).toBe('recovery-required')
  expect(canRetryProductProductionBlockerV1(details)).toBe(false)
  expect(f.injectedCalls).toBe(2)
  expect((await readCurrentChatMediaReviewV1({scope: f.scope, build: details.build!})).images).toHaveLength(2)
  expect(await db.productReleases.count()).toBe(0)
}, 30_000)
