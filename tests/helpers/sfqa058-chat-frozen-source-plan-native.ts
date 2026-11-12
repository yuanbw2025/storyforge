// Native IndexedDB fixture uses the same public authoring and scheduler chain as the focused regression.
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { parseChatAuthoringSettings } from '../../src/lib/character-interaction/authoring-contract'
import {
  confirmChatSourceReviewV1, createChatDraftV3, loadChatSourceProjectionV1, saveChatDraftV1, selectChatWorldV1,
} from '../../src/lib/character-interaction/draft-service'
import type { ChatNarrativeProductionSourceV1 } from '../../src/lib/character-interaction/narrative-production'
import { chatProjectionResourcesV1 } from '../../src/lib/character-interaction/source-projection'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import type { LocalContextManifestAttemptV1 } from '../../src/lib/types/world-product-contracts'
import { readProductProductionBuildWorldScopeV1 } from '../../src/lib/product-production/world-binding'
import { aggregateProductSourceManifestFromExactRuns } from '../../src/lib/product/source-contracts'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  createBuiltInProductionCapabilityBindingV1, createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1,
} from '../../src/lib/product-production/production-executor'
import { runProductProductionSchedulerCycleV1, runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { confirmChatSituationDecisionV1, readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { parseProductProductionSourcePlanV1 } from '../../src/lib/product-production/source-contracts'
import {
  loadProductProductionConsultationSourceV2, loadProductProductionWorldSourceCatalogV2,
} from '../../src/lib/product-production/world-source'
import {
  chatOpeningDevelopmentReviewFixture, chatOpeningPerspectiveReviewFixture, chatSituationCandidatesFixture,
} from '../helpers/chat-narrative-production-fixture'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedNarrativeRelationReleaseV4 } from '../helpers/narrative-release-fixture'

const privateAlias = 'sfqa058-author-only-alias'

async function enhancedSource(illustrated: boolean) {
  const seeded = await seedNarrativeRelationReleaseV4({ explicitEntityEvidence: true })
  if (!illustrated) return seeded.release
  const { scope } = seeded
  const owner = { kind: 'world' as const, worldCode: seeded.world.code, sourceWorkCode: null }
  for (const recordId of [seeded.actorId, seeded.secondActorId]) {
    const capture = await captureNarrativeDomainV1({ scope, owner })
    const row = capture.rows.get('characters')!.find(item => item.id === recordId)!
    await confirmNarrativeDomainAnnotationsV1({
      scope, owner, table: 'characters', recordId,
      expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'characters', row),
      annotations: { narrativeAliasesV1: [privateAlias] },
    })
  }
  const revision = await createWorldRevision({
    scope, formatVersion: 4, selectedTables: ['characters', 'characterRelations'], label: '058 授权审查来源',
  })
  return publishWorldRevision(revision.id!)
}

async function prepare(version: 1 | 2, illustrated = false) {
  const release = version === 2
    ? await enhancedSource(illustrated)
    : (await seedCurrentProductWorld('058 ordinary WorldRelease')).release
  const { scope } = await createChatDraftV3('058 formal ChatDraft')
  const linked = await selectChatWorldV1(scope, 0, release.id!)
  const index = await loadProductProductionConsultationSourceV2({
    scope, worldReleaseId: linked.worldReleaseId!, productType: 'character-interaction',
  })
  assert(index.worldReference.version === version, 'WorldReference version')
  const sourceKey = index.selectionOptions.characters[0]!.resourceKey
  const base = parseChatAuthoringSettings(JSON.parse(linked.settingsJson))
  if (base.version !== 3) throw Error('fixture requires current ChatDraft V3')
  const draft = await saveChatDraftV1(scope, linked.revision, {
    ...base, mode: 'single', playerRole: '来到桥边的旅人', openingSituation: '在桥边商议已经获准的修桥准备。',
    characters: [{ sourceKey, voiceRules: '自然简短', privateKnowledge: '', initialTrust: 0 }],
    ...(illustrated ? { visuals: { version: 1 as const,
      characters: [{ characterKey: sourceKey, description: '蓝色围裙，完整清晰的面容。' }],
      openingBackground: '没有人物的明亮木屋与整洁木桌。',
    } } : {}),
  })
  const projection = await loadChatSourceProjectionV1(scope, draft.revision)
  const protectedFragment = illustrated ? projection.characters[0]?.fragments.find(
    fragment => fragment.pointer === '/atom/aliases' && fragment.valueJson.includes(privateAlias),
  ) : undefined
  if (illustrated && !protectedFragment) throw Error('fixture must expose an exact alias for explicit author-only classification')
  const confirmed = await confirmChatSourceReviewV1(scope, draft.revision, {
    projectionHash: projection.projectionHash,
    classifications: chatProjectionResourcesV1(projection).flatMap(resource => resource.fragments.map(fragment => ({
      projectionHash: projection.projectionHash, fragmentKey: fragment.fragmentKey,
      purpose: 'identity' as const,
      visibility: fragment.fragmentKey === protectedFragment?.fragmentKey ? 'author-only' as const : 'public' as const,
      audienceKeys: [],
    }))),
  })
  const settings = parseChatAuthoringSettings(JSON.parse(confirmed.settingsJson))
  if (settings.version !== 3) throw Error('fixture lost current V3 settings')
  const worldReleaseId = confirmed.worldReleaseId!
  const suggestions = await suggestProductStartingPoints({ scope, worldReleaseId, productType: 'character-interaction' })
  const brief = await draftProductProductionBriefV3({
    scope, worldReleaseId, suggestionKey: suggestions.suggestions[0]!.suggestionKey, productType: 'character-interaction',
    characterChat: settings, playerRole: settings.playerRole, openingSituation: settings.openingSituation,
    scale: 'scene', visualLevel: illustrated ? 'key-scenes' : 'none', audioLevel: 'none',
  })
  const key = `sfqa058.chat.${version}`
  const intent = await executeProductProductionCommand({ scope, command: {
    type: 'create-intent', commandId: `${key}.intent`, productionKey: key, productType: 'character-interaction',
    worldReleaseId, userText: '制作角色聊天',
  } })
  const productionId = intent.productionId
  const saved = await executeProductProductionCommand({ scope, productionId, command: {
    type: 'save-brief-revision', commandId: `${key}.brief`, expectedStateRevision: 0, parentRevision: null, brief,
  } })
  assert(saved.ok, 'save brief')
  const requirementKey = brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey
  const bindingHash = await hashProductProductionValueV2({ fixture: '058-no-network' })
  const capabilityBindings = [{ requirementKey, adapterId: 'configured-text.v1', bindingHash }]
  const authorize = async () => {
    const authorized = await executeProductProductionCommand({ scope, productionId, command: {
      type: 'authorize-start', commandId: `${key}.start`, expectedStateRevision: 1, briefRevision: 1,
      briefHash: String(saved.result.briefHash), authorizationNonce: `${key}.nonce`,
    } })
    assert(authorized.ok, `authorize: ${JSON.stringify(authorized.result)}`)
    const row = await db.productProductionBriefs.where('productionId').equals(productionId).first()
    return parseProductProductionSourcePlanV1(row!)
  }
  return { scope, worldReleaseId, brief, productionId, authorize, capabilityBindings,
    requirementKey, bindingHash, protectedFragment, publicName: projection.characters[0]!.label, privateCharacters: settings.privateCharacters }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`[sfqa058-native] ${message}`)
}

async function rejects(action: () => Promise<unknown>, pattern: RegExp) {
  let message = ''
  try { await action() } catch (cause) { message = String(cause) }
  assert(pattern.test(message), `expected rejection ${pattern}; got ${message}`)
  return message
}

export async function readSfqa058NativeSnapshotV1(scope: WorkspaceScope, productionId: number) {
  const production = await db.productProductions.get(productionId)
  assert(production, 'persisted production')
  const briefs = await db.productProductionBriefs.where('productionId').equals(productionId).toArray()
  const builds = await db.productBuilds.where('productionId').equals(productionId).toArray()
  const artifacts = await db.productBuildArtifacts.where('buildId').anyOf(builds.map(build => build.id!)).toArray()
  const commands = await db.productProductionCommands.where('productionId').equals(productionId).toArray()
  const runs = await db.agentRuns.where('projectId').equals(scope.projectId).toArray()
  const events = await db.agentRunEvents.where('projectId').equals(scope.projectId).toArray()
  return {
    storedJsonHash: await hashProductProductionValueV2(JSON.stringify({ production, briefs, builds, artifacts, commands, runs, events })),
    briefHashes: briefs.map(row => row.sourcePlanHash), buildCount: builds.length,
    artifactCount: artifacts.length, runCount: runs.length, eventCount: events.length,
  }
}

export async function exerciseSfqa058NativeV1(version: 1 | 2) {
  const f = await prepare(version, version === 2)
  const { scope, productionId, brief } = f
  const controls: string[] = [], calls: string[] = []
  const release = await db.worldReleases.get(f.worldReleaseId)
  assert(release, 'source WorldRelease')
  const releaseBefore = await hashProductProductionValueV2(JSON.stringify(release))
  if (version === 2) {
    let executions = 0
    await rejects(() => runProductProductionSchedulerCycleV1({
      scope, productionId, capabilityBindings: f.capabilityBindings,
      executor: async () => { executions++; throw new Error('unapproved production executed') },
    }), /Build|授权/)
    assert(executions === 0 && await db.productBuilds.where('productionId').equals(productionId).count() === 0,
      'unapproved start must not create a Build or execute a task')
    controls.push('unapproved-start')
  }
  const sourcePlan = await f.authorize()
  assert(sourcePlan.worldReference.version === version, 'frozen plan version')
  const catalogInput = { scope, worldReleaseId: f.worldReleaseId,
    selection: brief.source.selection, chatPrivateCharacters: f.privateCharacters }
  assert((await loadProductProductionWorldSourceCatalogV2({ ...catalogInput, sourcePlan })).characters.length > 0,
    'authorized catalog must contain the selected character')
  if (version === 2) {
    await rejects(() => loadProductProductionWorldSourceCatalogV2(catalogInput), /产品定向目录不能作为正式生产原文授权/)
    await rejects(() => loadProductProductionWorldSourceCatalogV2({ ...catalogInput,
      sourcePlan: { ...sourcePlan, productType: 'avg' } }), /来源计划的版本或产品不一致/)
    await rejects(() => loadProductProductionWorldSourceCatalogV2({ ...catalogInput, sourcePlan,
      selection: { ...brief.source.selection, version: 1 } }), /来源计划的版本或产品不一致/)
    assert((await loadProductProductionWorldSourceCatalogV2({ ...catalogInput, chatSourceReview: true }))
      .chatSourceProjection!.characters.length > 0, 'explicit author review remains available')
    controls.push('missing-plan', 'wrong-product', 'wrong-version', 'author-review-only')
  }
  const rows = async () => {
    const details = await readProductProductionDetailsV1(scope, productionId)
    assert(details.build?.id, 'authorized Build')
    return db.productBuildArtifacts.where('buildId').equals(details.build.id).toArray()
  }
  const runText: ProductionTextRunnerV1 = async request => {
    assert(version === 2, 'ordinary deterministic content.design must not call a text model')
    assert(!request.contextText.includes(privateAlias), 'author-only source reached text input')
    const situation = request.system.includes('初始情境编辑')
    assert(situation || request.system.includes('开场的语义审查者'), 'unexpected synthetic text stage')
    calls.push(situation ? 'situation' : 'review')
    const artifacts = await rows()
    const source = JSON.parse(artifacts.find(row => row.artifactKey === 'design.game')!.payloadJson) as ChatNarrativeProductionSourceV1
    const candidates = situation ? chatSituationCandidatesFixture(source)
      : JSON.parse(artifacts.find(row => row.artifactKey === 'content.chat-candidates')!.payloadJson)
    const output = situation ? candidates
      : chatOpeningPerspectiveReviewFixture(source, candidates, chatOpeningDevelopmentReviewFixture(candidates, 'option-1'))
    return { output: JSON.stringify(output), usage: { inputTokens: 100, outputTokens: 100 }, bindingReceipt: {
      schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey: f.requirementKey,
      adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'fixture',
      endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
      credentialSource: 'existing-ai-config', credentialPresent: true, capabilityHash: f.bindingHash,
      boundAt: 1, receiptHash: 'b'.repeat(64),
    } }
  }
  const executor = createConfiguredProductProductionExecutorV1({
    production: (await db.productProductions.get(productionId))!, brief, sourcePlan, runText,
  })
  const bindings = version === 2 ? [...f.capabilityBindings,
    await createBuiltInProductionCapabilityBindingV1({ requirementKey: 'media.visual', adapterId: 'storyforge.procedural-svg.v1' })]
    : f.capabilityBindings
  const run = () => runProductProductionUntilBlockedV1({ scope, productionId, capabilityBindings: bindings, executor })
  if (version === 1) {
    const result = await runProductProductionSchedulerCycleV1({ scope, productionId,
      capabilityBindings: bindings, executor })
    assert(result.tasks.find(task => task.taskKey === 'content.design')?.status === 'completed', 'ordinary content.design')
  } else {
    assert(JSON.parse(f.protectedFragment!.valueJson).includes(privateAlias), 'sensitive fixture fragment')
    await run()
    const details = await readProductProductionDetailsV1(scope, productionId)
    assert(JSON.parse(details.build!.failureJson).taskKey === 'content.chat-author-gate', 'situation author gate')
    const artifacts = await rows(), design = artifacts.find(row => row.artifactKey === 'design.game')!
    const candidates = artifacts.find(row => row.artifactKey === 'content.chat-candidates')!
    await confirmChatSituationDecisionV1({ scope, details, candidatesHash: candidates.contentHash,
      sourceHash: design.contentHash, selectedOptionKey: 'option-2' })
    await run()
    const after = await readProductProductionDetailsV1(scope, productionId)
    assert(JSON.parse(after.build!.failureJson).taskKey === 'media.chat-author-gate', 'explicit media author gate')
    assert(JSON.stringify(calls) === JSON.stringify(['situation', 'review']), 'bounded synthetic text calls')
  }
  const details = await readProductProductionDetailsV1(scope, productionId)
  const bound = await readProductProductionBuildWorldScopeV1({ scope, productionId, buildId: details.build!.id!, brief })
  assert(bound.sourcePlan.planHash === sourcePlan.planHash, 'Build must return the same validated frozen plan')
  const artifacts = await rows(), design = artifacts.find(row => row.artifactKey === 'design.game')!
  assert(JSON.parse(design.payloadJson).participants[0].name === f.publicName, 'public character identity')
  assert(!design.payloadJson.includes(privateAlias), 'author-only source reached content.design')
  const media = artifacts.find(row => row.artifactKey === 'media.requirements')
  if (version === 2) {
    assert(media && JSON.parse(media.payloadJson).visual.length === 2, 'illustrated media requirements')
    assert(!media.payloadJson.includes(privateAlias), 'author-only source reached media requirements')
  }
  const pointers: LocalContextManifestAttemptV1[] = []
  for (const artifact of [design, ...(media ? [media] : [])]) {
    const snapshot = await readAgentRunV1(scope, artifact.producerRunId!)
    assert(snapshot.projection.terminalReceiptHash === artifact.producerReceiptHash, 'exact producer receipt')
    for (const event of snapshot.events) if (event.type === 'context.assembled') pointers.push({
      runId: snapshot.run.id, stepId: event.payload.stepId,
      attempt: event.payload.attempt, manifestHash: event.payload.manifestHash,
    })
  }
  if (version === 2) {
    const manifest = await aggregateProductSourceManifestFromExactRuns({ scope, sourcePlan, runContextManifests: pointers })
    assert(manifest.sourcePlanHash === sourcePlan.planHash, 'aggregated exact source plan')
  } else {
    // This ordinary fixture has only executed content.design. Its other stable
    // requirements must remain unpublishable until their actual reads exist.
    await rejects(() => aggregateProductSourceManifestFromExactRuns({ scope, sourcePlan, runContextManifests: pointers }),
      /product-source-contract:required-source-evidence/)
    controls.push('incomplete-prefix-publication')
  }
  const briefRow = await db.productProductionBriefs.where('productionId').equals(productionId).first()
  assert(briefRow?.sourcePlanHash === sourcePlan.planHash, 'frozen plan hash must remain unchanged')
  assert(await hashProductProductionValueV2(JSON.stringify(await db.worldReleases.get(f.worldReleaseId))) === releaseBefore,
    'source WorldRelease must remain unchanged')
  return { version, scope, productionId, controls, syntheticTextCalls: calls,
    sourcePlanHash: sourcePlan.planHash, manifestSteps: pointers.map(pointer => pointer.stepId),
    mediaCount: media ? JSON.parse(media.payloadJson).visual.length as number : 0,
    authorOnlyPreserved: true, sourceWorldUnchanged: true,
    snapshot: await readSfqa058NativeSnapshotV1(scope, productionId) }
}
