import type {ChatExperienceInfoV1} from '../../src/lib/character-interaction/experience-info'
import {previewChatCharacterCardV2} from '../../src/lib/character-interaction/character-card'
import {chatCharacterCardFixture} from './chat-character-card-fixture'
import {db} from '../../src/lib/db/schema'
import {saveChatDraftV1} from '../../src/lib/character-interaction/draft-service'
import {draftProductProductionBriefV3, suggestProductStartingPoints} from '../../src/lib/product-production/consultation'
import {executeProductProductionCommand} from '../../src/lib/product-production/commands'
import {createBuiltInProductionCapabilityBindingV1, createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1} from '../../src/lib/product-production/production-executor'
import {runProductProductionUntilBlockedV1} from '../../src/lib/product-production/scheduler'
import {confirmChatSituationDecisionV1, readProductProductionDetailsV1} from '../../src/lib/product-production/service'
import {seedChatNarrativeProductionFixture, chatSituationCandidatesFixture, chatOpeningDevelopmentReviewFixture, chatOpeningProofReviewFixture} from './chat-narrative-production-fixture'

export async function seedIllustratedChatBriefFixture(privateCast?: 'only', experienceInfo?: ChatExperienceInfoV1) {
  const cardOrigin = privateCast === 'only' ? (await previewChatCharacterCardV2({bytes: new TextEncoder().encode(JSON.stringify(chatCharacterCardFixture())).buffer, fileName: 'card.json'})).origin : undefined
  const f = await seedChatNarrativeProductionFixture({privateCast, cardOrigin, experienceInfo})
  const characterKey = f.source.participants[0].characterKey
  const settings = {...f.settings, visuals: {version: 1 as const,
    characters: [{characterKey, description: '银灰短发，蓝色围裙，手里没有任何物品。'}], openingBackground: '无人的木屋，明亮窗户，整洁木桌。'}}
  const confirmed = await saveChatDraftV1(f.scope, f.confirmed.revision, settings)
  const starting = await suggestProductStartingPoints({scope: f.scope, worldReleaseId: confirmed.worldReleaseId!})
  const brief = await draftProductProductionBriefV3({scope: f.scope, worldReleaseId: confirmed.worldReleaseId!,
    suggestionKey: starting.suggestions[0].suggestionKey, productType: 'character-interaction', characterChat: settings,
    playerRole: settings.playerRole, openingSituation: settings.openingSituation, visualLevel: 'key-scenes', audioLevel: 'none'})
  return {...f, confirmed, settings, brief}
}

/** Synthetic text and procedural images exercise production authority, not artistic quality. */
export async function seedChatMediaConfirmationFixture(experienceInfo?: ChatExperienceInfoV1) {
  const f = await seedIllustratedChatBriefFixture('only', experienceInfo), {scope, brief} = f
  const created = await executeProductProductionCommand({scope, command: {type: 'create-intent', commandId: 'pictures.create',
    productionKey: 'chat.pictures-fixture', productType: 'character-interaction', worldReleaseId: f.confirmed.worldReleaseId!, userText: '图片确认工程验证'}})
  if (!created.ok) throw new Error('fixture creation failed')
  const productionId = created.productionId
  const saved = await executeProductProductionCommand({scope, productionId, command: {type: 'save-brief-revision', commandId: 'pictures.brief', expectedStateRevision: 0, parentRevision: null, brief}})
  if (!saved.ok) throw new Error('fixture brief failed')
  const started = await executeProductProductionCommand({scope, productionId, command: {type: 'authorize-start', commandId: 'pictures.start', expectedStateRevision: 1,
    briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'fixture-author-start'}})
  if (!started.ok) throw new Error('fixture authorization failed')
  const requirementKey = brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey, bindingHash = 'a'.repeat(64)
  let injectedCalls = 0
  const textRequests: string[] = []
  const runText: ProductionTextRunnerV1 = async request => {
    const situation = request.system.includes('初始情境编辑'), review = request.system.includes('开场的语义审查者')
    if (!situation && !review) throw new Error('Unexpected fixture model call')
    injectedCalls++
    textRequests.push(JSON.stringify(request))
    const production = (await db.productProductions.get(productionId))!
    const buildId = (await db.productBuilds.where('[productionId+buildNumber]').equals([productionId, production.currentBuildNumber!]).first())!.id!
    const source = JSON.parse((await db.productBuildArtifacts.where('buildId').equals(buildId).filter(row => row.artifactKey === 'design.game').last())!.payloadJson)
    const candidates = situation ? chatSituationCandidatesFixture(source) : JSON.parse((await db.productBuildArtifacts.filter(row => row.artifactKey === 'content.chat-candidates').last())!.payloadJson)
    return {output: JSON.stringify(situation ? candidates : chatOpeningProofReviewFixture(source, candidates, chatOpeningDevelopmentReviewFixture(candidates, 'option-1'))), usage: {inputTokens: 100, outputTokens: 100},
      bindingReceipt: {schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
        provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct', credentialSource: 'existing-ai-config',
        credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: 'b'.repeat(64)}}
  }
  const capabilityBindings = [{requirementKey, adapterId: 'configured-text.v1', bindingHash},
    await createBuiltInProductionCapabilityBindingV1({requirementKey: 'media.visual', adapterId: 'storyforge.procedural-svg.v1'})]
  const run = async () => runProductProductionUntilBlockedV1({scope, productionId, capabilityBindings,
    executor: createConfiguredProductProductionExecutorV1({production: (await db.productProductions.get(productionId))!, brief, runText})})
  await run()
  let details = await readProductProductionDetailsV1(scope, productionId)
  if (JSON.parse(details.build!.failureJson!).taskKey !== 'content.chat-author-gate') throw new Error(`Missing fixture situation gate: ${details.build!.failureJson}`)
  const rows = await db.productBuildArtifacts.where('buildId').equals(details.build!.id!).toArray()
  await confirmChatSituationDecisionV1({scope, details, candidatesHash: rows.find(row => row.artifactKey === 'content.chat-candidates')!.contentHash,
    sourceHash: rows.find(row => row.artifactKey === 'design.game')!.contentHash, selectedOptionKey: 'option-2'})
  await run()
  details = await readProductProductionDetailsV1(scope, productionId)
  if (JSON.parse(details.build!.failureJson!).taskKey !== 'media.chat-author-gate' || injectedCalls !== 2) throw new Error('Missing fixture image gate')
  return {scope, productionId, buildId: details.build!.id!, injectedCalls, textRequests, world: JSON.stringify(await db.worldReleases.toArray())}
}
