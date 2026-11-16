import {db} from '../db/schema'
import type {FrozenInteractionRuntimeV2, FrozenRuntimeMediaAssetV2, ProductProductionBriefV3, ProductProductionRecordV1} from '../types'
import {createChatVisualRequirementsV1} from '../character-interaction/visual-intent'
import {createChatVisualContextV1, parseChatVisualDesignV1, assertChatVisualDesignContextV1, createDesignedChatVisualRequirementsV1} from '../character-interaction/visual-design'
import {createChatMediaReviewSourceV1} from '../character-interaction/media-selection'
import {canonicalProductProductionJsonV2, hashProductProductionValueV2} from './hash'
import {chatProductionArtifactPayloadV1, verifyChatNarrativeShellV1} from './chat-situation-tasks'
import {compileInteractionModulesV1} from './product-module-compilers'
import {readProductProductionBuildWorldScopeV1} from './world-binding'
import {loadProductProductionWorldSourceCatalogV2} from './world-source'
import {CHAT_MEDIA_AUTHOR_GATE, CHAT_MEDIA_REVIEW_ARTIFACT, CHAT_MEDIA_SELECTION_ARTIFACT,
  createChatMediaAuthorConfirmationV1, readCurrentChatMediaReviewV1} from './chat-media-authority'
import type {ProductProductionTaskExecutionInputV1, ProductProductionTaskExecutionResultV1} from './scheduler'

function fail(message: string): never {throw new Error(`[chat-media-production] ${message}`)}

/** The same reviewed world and selected story compiler as final assembly.
 * This runs locally through the registered Gateway; only confirmed public content crosses the later visual handoff. */
export async function compileChatMediaContent(input: ProductProductionTaskExecutionInputV1, brief: ProductProductionBriefV3): Promise<{interaction: FrozenInteractionRuntimeV2; openingBeatKey: string}> {
  const chat = await verifyChatNarrativeShellV1(input)
  const worldScope = await readProductProductionBuildWorldScopeV1({...input, brief})
  const sourceCatalog = await loadProductProductionWorldSourceCatalogV2({scope: input.scope,
    worldReleaseId: worldScope.worldReleaseId, selection: brief.source.selection, sourcePlan: worldScope.sourcePlan,
    chatPrivateCharacters: brief.characterChat?.version === 3 ? brief.characterChat.privateCharacters : undefined})
  if (sourceCatalog.release.contentHash !== brief.source.worldContentHash) fail('冻结世界来源已变化')
  return {interaction: compileInteractionModulesV1({brief, narrative: chat.shell, sourceCatalog, chatNarrative: chat.content}),
    openingBeatKey: chat.shell.beats[0]?.beatKey ?? fail('选定开场缺少导航标识')}
}

/** System lane's own deterministic artifact. It binds the confirmed story to
 * actual character, memory, relationship and scene settings before images. */
export async function createChatSystemConfigV1(interaction: FrozenInteractionRuntimeV2) {
  if (!interaction.chatNarrative || !interaction.chatSource) fail('系统配置缺少已确认内容')
  return {schema: 'storyforge.chat-system-config', version: 1,
    worldReleaseHash: interaction.chatSource.worldReleaseHash,
    contentHash: await hashProductProductionValueV2(interaction.chatNarrative),
    playerKey: interaction.playerKey, profiles: interaction.profiles, sceneTemplates: interaction.sceneTemplates,
    permissions: interaction.chatNarrative.permissions,
    mediaSlots: {characterPresentation: 'image-card', alphaRequired: false, preserveProviderPixels: true,
      characters: interaction.profiles.map(({characterKey, participantKey}) => ({characterKey, participantKey})),
      scenes: interaction.sceneTemplates.map(({sceneKey, location}) => ({sceneKey, location}))}}
}
export async function verifyChatSystemConfigV1(input: Pick<ProductProductionTaskExecutionInputV1, 'inputArtifacts'>, interaction: FrozenInteractionRuntimeV2) {
  const actual = chatProductionArtifactPayloadV1(input, 'system.chat-config')
  if (canonicalProductProductionJsonV2(actual) !== canonicalProductProductionJsonV2(await createChatSystemConfigV1(interaction))) fail('系统配置与当前角色、内容或运行规则不一致')
}

/** Rechecked both before sending images and at assembly. No model-produced
 * prompt is accepted merely because it has the right JSON shape. */
export async function verifyDesignedChatRequirementsV1(input: Pick<ProductProductionTaskExecutionInputV1, 'inputArtifacts'>, brief: ProductProductionBriefV3) {
  const intent = brief.characterChat?.version === 3 ? brief.characterChat.visuals : undefined
  if (intent?.version !== 2) return undefined
  const context = chatProductionArtifactPayloadV1(input, 'media.chat-context') as ReturnType<typeof createChatVisualContextV1>
  const design = parseChatVisualDesignV1(chatProductionArtifactPayloadV1(input, 'media.chat-design'))
  await assertChatVisualDesignContextV1(design, context, intent.runtimeImages)
  const actual = chatProductionArtifactPayloadV1(input, 'media.requirements') as {visual: Array<{beatKey: string}>}
  const expected = createDesignedChatVisualRequirementsV1(design, context, actual.visual[0]?.beatKey)
  if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(actual)) fail('图片请求与已完成的角色场景设计不一致')
  return design
}

export async function executeChatMediaDeterministicTaskV1(input: ProductProductionTaskExecutionInputV1, options: {
  production: ProductProductionRecordV1; brief: ProductProductionBriefV3
}, assets: FrozenRuntimeMediaAssetV2[]): Promise<ProductProductionTaskExecutionResultV1> {
  const startedAt = performance.now(), settings = options.brief.characterChat
  if (options.brief.intent.productType !== 'character-interaction' || settings?.version !== 3
    || !settings.visuals || options.brief.media.imageCount < 1) fail('图片制作缺少已冻结的美术意向')
  const artifacts: ProductProductionTaskExecutionResultV1['artifacts'] = []
  if (['system.chat-config', 'media.chat-context', 'media.requirements', CHAT_MEDIA_REVIEW_ARTIFACT].includes(input.task.taskKey)) {
    const {interaction, openingBeatKey} = await compileChatMediaContent(input, options.brief)
    if (input.task.taskKey === 'system.chat-config') return {artifacts: [{artifactKey: 'system.chat-config', kind: 'product-module',
      payload: await createChatSystemConfigV1(interaction), quality: {deterministicSystemAndContentBinding: true}, rights: {}}],
      passedGateIds: [...input.task.acceptanceGateIds], usage: {modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0, durationMs: Math.round(performance.now() - startedAt), storageBytes: 0}}
    if (settings.visuals.version === 2) await verifyChatSystemConfigV1(input, interaction)
    const context = settings.visuals.version === 2 ? createChatVisualContextV1(interaction, settings.visuals) : null
    if (input.task.taskKey === 'media.chat-context') {
      if (!context) fail('旧画面方案不能进入情境设计')
      return {artifacts: [{artifactKey: 'media.chat-context', kind: 'product-design', payload: context,
        quality: {confirmedPlayerVisibleContent: true}, rights: {}}], passedGateIds: [...input.task.acceptanceGateIds],
        usage: {modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0, durationMs: Math.round(performance.now() - startedAt), storageBytes: 0}}
    }
    const design = context ? parseChatVisualDesignV1(chatProductionArtifactPayloadV1(input, 'media.chat-design')) : null
    if (design && context && settings.visuals.version === 2) {
      await assertChatVisualDesignContextV1(design, context, settings.visuals.runtimeImages)
      if (canonicalProductProductionJsonV2(context) !== canonicalProductProductionJsonV2(chatProductionArtifactPayloadV1(input, 'media.chat-context'))) fail('设计来源与已确认内容不一致')
    }
    const requirements = design && context ? createDesignedChatVisualRequirementsV1(design, context, openingBeatKey)
      : createChatVisualRequirementsV1(settings.visuals, interaction, openingBeatKey)
    if (requirements.visual.length !== options.brief.media.imageCount) fail('图片数量与冻结 Brief 不一致')
    if (input.task.taskKey === 'media.requirements') {
      artifacts.push({artifactKey: 'media.requirements', kind: 'asset-manifest', payload: requirements,
        quality: {confirmedPublicContent: true}, rights: {}})
    } else {
      if (canonicalProductProductionJsonV2(chatProductionArtifactPayloadV1(input, 'media.requirements')) !== canonicalProductProductionJsonV2(requirements)
        || assets.length !== requirements.visual.length) fail('原图或图片需求与选定开场不一致')
      for (const requirement of requirements.visual) {
        const rows = input.inputArtifacts.filter(row => row.artifactKey === requirement.artifactKey && row.blobObjectId != null)
        if (rows.length !== 1 || canonicalProductProductionJsonV2(JSON.parse(rows[0].payloadJson).request) !== canonicalProductProductionJsonV2(requirement)) fail('原图不属于当前公开画面请求')
      }
      if (design) interaction.chatVisualDesign = design
      artifacts.push({artifactKey: CHAT_MEDIA_REVIEW_ARTIFACT, kind: 'product-design',
        payload: createChatMediaReviewSourceV1(interaction, assets), quality: {authorReviewRequired: true}, rights: {}})
    }
  } else if (input.task.taskKey === CHAT_MEDIA_AUTHOR_GATE) {
    const decision = input.authorResolution
    if (decision?.blockerKey !== CHAT_MEDIA_AUTHOR_GATE || decision.resolution.action !== 'confirm-chat-media') fail('请查看当前原图，确认角色和场景绑定后继续')
    const build = await db.productBuilds.get(input.buildId)
    if (!build || build.controlEpoch !== input.controlEpoch || build.buildNumber !== input.buildNumber
      || build.productionId !== input.productionId || build.planHash !== input.planHash) fail('图片制作版本已变化')
    const review = await readCurrentChatMediaReviewV1({scope: input.scope, build})
    if (canonicalProductProductionJsonV2(review.source) !== canonicalProductProductionJsonV2(chatProductionArtifactPayloadV1(input, CHAT_MEDIA_REVIEW_ARTIFACT))) fail('图片审查来源已变化')
    const command = await db.productProductionCommands.where('[productionId+commandId]').equals([input.productionId, decision.commandId]).first()
    if (!command || command.expectedStateRevision === null) fail('缺少作者图片确认命令')
    const confirmation = await createChatMediaAuthorConfirmationV1({...input, source: review.source, command: {
      type: 'resolve-blocker', commandId: decision.commandId, expectedStateRevision: command.expectedStateRevision,
      blockerKey: decision.blockerKey, resolution: decision.resolution,
    }})
    artifacts.push({artifactKey: CHAT_MEDIA_SELECTION_ARTIFACT, kind: 'product-design', payload: confirmation,
      quality: {exactSuccessfulAuthorCommand: true}, rights: {}})
  } else fail('未登记的角色聊天图片任务')
  return {artifacts, passedGateIds: [...input.task.acceptanceGateIds], usage: {
    modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)), storageBytes: 0,
  }}
}
