import {CHAT_OPENING_REVIEW_KEY, assertChatOpeningReviewedV1, minimumChatOpeningReviewVersionV1} from '../character-interaction/situation-production-review'
import type { ProductProductionBriefV3, ProductProductionRecordV1 } from '../types'
import type { ProductProductionTaskExecutionInputV1, ProductProductionTaskExecutionResultV1 } from './scheduler'
import { loadProductProductionWorldSourceCatalogV2 } from './world-source'
import { readProductProductionBuildWorldScopeV1 } from './world-binding'
import { prepareChatNarrativeCompilerSourceV1 } from './product-module-compilers'
import {composeChatRoleVoiceRulesV1} from '../character-interaction/role-profile'
import {CHAT_OPENING_FACT_CATALOG_KEY, buildChatOpeningFactCatalogV1, validateChatOpeningFactCatalogV1, buildChatOpeningFactCatalogV2, validateChatOpeningFactCatalogV2, assertChatOpeningSourceCompletenessV1, CHAT_OPENING_SOURCE_COMPLETENESS_GATE_V1} from '../character-interaction/opening-source-references'
import { canonicalProductProductionJsonV2 } from './hash'
import {
  chatNarrativeShellV1, selectChatNarrativeCandidateV1, validateChatNarrativeProductionSourceV1, parseChatSituationCandidatesV1,
  type ChatNarrativeProductionSourceV1, type ChatSituationSelectionV1,
} from '../character-interaction/narrative-production'

function fail(message: string): never {throw new Error(`[chat-production] ${message}`)}
export function chatProductionArtifactPayloadV1(input: Pick<ProductProductionTaskExecutionInputV1, 'inputArtifacts'>, key: string): unknown {
  const rows = input.inputArtifacts.filter(row => row.artifactKey === key)
  if (rows.length !== 1) fail(`缺少唯一情境生产依赖:${key}`)
  return JSON.parse(rows[0].payloadJson)
}
export function chatProductionSourceV1(input: Pick<ProductProductionTaskExecutionInputV1, 'inputArtifacts'>): ChatNarrativeProductionSourceV1 {
  const source = chatProductionArtifactPayloadV1(input, 'design.game') as ChatNarrativeProductionSourceV1
  validateChatNarrativeProductionSourceV1(source)
  return source
}
export async function requireChatOpeningFactCatalogV1(input: ProductProductionTaskExecutionInputV1) {
  const source = chatProductionSourceV1(input)
  const complete = input.task.acceptanceGateIds.includes(CHAT_OPENING_SOURCE_COMPLETENESS_GATE_V1)
  const catalog = await (complete ? validateChatOpeningFactCatalogV2 : validateChatOpeningFactCatalogV1)(chatProductionArtifactPayloadV1(input, CHAT_OPENING_FACT_CATALOG_KEY), source)
  if (!input.authorDraftJson) {
    const packets = input.contextText.split(/\n\s*\n/g).flatMap(segment => {
      try {const value = JSON.parse(segment); return value?.schema === 'storyforge.product-production.artifact-inputs' ? [value] : []} catch {return []}
    })
    if (packets.length !== 1 || packets[0].buildNumber !== input.buildNumber) fail('引用目录缺少本次实际交付的上下文')
    for (const [key, expected] of [['design.game', source], [CHAT_OPENING_FACT_CATALOG_KEY, catalog]] as const) {
      const delivered = packets[0].artifacts?.filter((item: {artifactKey: string}) => item.artifactKey === key)
      if (delivered?.length !== 1 || canonicalProductProductionJsonV2(delivered[0].payload) !== canonicalProductProductionJsonV2(expected)) fail('引用来源或目录未完整交付模型')
    }
  }
  return catalog
}
async function reviewedSelection(input: Pick<ProductProductionTaskExecutionInputV1, 'inputArtifacts' | 'task'>, selection: ChatSituationSelectionV1) {
  const source = chatProductionSourceV1(input), candidates = chatProductionArtifactPayloadV1(input, 'content.chat-candidates')
  if (input.task.acceptanceGateIds.includes(CHAT_OPENING_SOURCE_COMPLETENESS_GATE_V1)) await assertChatOpeningSourceCompletenessV1(candidates, source)
  if (minimumChatOpeningReviewVersionV1(input.task.acceptanceGateIds) > 1 && !input.task.inputArtifactKeys.includes(CHAT_OPENING_REVIEW_KEY)) fail('行动机会验收缺少开场审查依赖')
  if (input.task.inputArtifactKeys.includes(CHAT_OPENING_REVIEW_KEY)) await assertChatOpeningReviewedV1(
    chatProductionArtifactPayloadV1(input, CHAT_OPENING_REVIEW_KEY), source, parseChatSituationCandidatesV1(candidates, source), selection.selectedOptionKey, minimumChatOpeningReviewVersionV1(input.task.acceptanceGateIds))
  return selectChatNarrativeCandidateV1({source, candidates, selection})
}
export async function selectedChatProductionNarrativeV1(input: Pick<ProductProductionTaskExecutionInputV1, 'inputArtifacts' | 'task'>) {
  return reviewedSelection(input, chatProductionArtifactPayloadV1(input, 'content.chat-selection') as ChatSituationSelectionV1)
}
/* Author-gated selections from old frozen plans remain readable. New plans
 * require the review dependency at selection, assembly and publication. */

export async function executeChatSituationDeterministicTaskV1(input: ProductProductionTaskExecutionInputV1, options: {
  production: ProductProductionRecordV1; brief: ProductProductionBriefV3
}): Promise<ProductProductionTaskExecutionResultV1> {
  const startedAt = performance.now()
  const settings = options.brief.characterChat
  if (options.brief.intent.productType !== 'character-interaction' || settings?.version !== 3) fail('情境制作需要聊天 v3 Brief')
  const artifacts: ProductProductionTaskExecutionResultV1['artifacts'] = []
  if (input.task.taskKey === 'content.design') {
    const worldScope = await readProductProductionBuildWorldScopeV1({...input, brief: options.brief})
    const sourceCatalog = await loadProductProductionWorldSourceCatalogV2({scope: input.scope,
      worldReleaseId: worldScope.worldReleaseId, selection: options.brief.source.selection, chatPrivateCharacters: settings.privateCharacters})
    const projected = prepareChatNarrativeCompilerSourceV1({brief: options.brief, sourceCatalog})
    // Raw authored prose can be unclassified or author-only. Only the reviewed
    // projection may enter a production model's input, including for new cast.
    const {privateCharacters: _privateCharacters, visuals: _visuals, experienceInfo: _experienceInfo, ...reviewedSettings} = settings
    const source: ChatNarrativeProductionSourceV1 = {
      schema: 'storyforge.chat-narrative-production-source', version: 1, settings: reviewedSettings,
      source: projected.content,
      participants: projected.participantKeys.map((participantKey, index) => ({
        participantKey, characterKey: projected.characterKeys[index], name: projected.names[index],
        voiceRules: projected.roleProfiles[index] ? composeChatRoleVoiceRulesV1(projected.voices[index], settings.characters.find(c => c.sourceKey === projected.characterKeys[index])?.voiceRules ?? '', projected.roleProfiles[index])
          : [projected.voices[index], settings.characters.find(c => c.sourceKey === projected.characterKeys[index])?.voiceRules].filter(Boolean).join('\n') || '按已确认的人物性格自然表达',
      })),
    }
    validateChatNarrativeProductionSourceV1(source)
    artifacts.push({artifactKey: 'design.game', kind: 'product-design', payload: source, quality: {reviewedSourceOnly: true}, rights: {}})
    if (input.task.outputArtifactKeys.includes(CHAT_OPENING_FACT_CATALOG_KEY)) artifacts.push({
      artifactKey: CHAT_OPENING_FACT_CATALOG_KEY, kind: 'product-design', payload: await (input.task.acceptanceGateIds.includes(CHAT_OPENING_SOURCE_COMPLETENESS_GATE_V1) ? buildChatOpeningFactCatalogV2 : buildChatOpeningFactCatalogV1)(source),
      quality: {deterministicFrozenReferences: true}, rights: {},
    })
  } else if (input.task.taskKey === 'content.chat-author-gate') {
    const decision = input.authorResolution
    if (decision?.blockerKey !== input.task.taskKey || decision.resolution.action !== 'confirm-chat-situation' || !decision.resolution.chatSituation) fail('请比较初始情境并选择一个开场后继续')
    const selection: ChatSituationSelectionV1 = {
      schema: 'storyforge.chat-situation-selection', version: 1,
      ...decision.resolution.chatSituation, authorCommandId: decision.commandId,
    }
    await reviewedSelection(input, selection)
    artifacts.push(
      {artifactKey: 'content.chat-selection', kind: 'product-design', payload: selection, quality: {authorSelected: true}, rights: {}},
      {artifactKey: 'content.product-module', kind: 'product-module', payload: {
        schema: 'storyforge.product-module-artifact', version: 1, productType: 'character-interaction',
        interfaceStyle: settings.experience || '角色聊天', interactionNotes: ['角色按情境和自身目标行动，玩家可以拒绝、改道和休息'],
        presentationPolicy: {pacing: 'balanced', transitionMs: 0, backgroundStrategy: 'none'},
      }, quality: {authorSelected: true}, rights: {}},
    )
  } else if (input.task.taskKey === 'content.narrative') {
    artifacts.push({artifactKey: 'content.narrative', kind: 'narrative', payload: chatNarrativeShellV1(await selectedChatProductionNarrativeV1(input)), quality: {openSituation: true}, rights: {}})
  } else fail('未登记的情境制作任务')
  return {artifacts, passedGateIds: [...input.task.acceptanceGateIds], usage: {
    modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    storageBytes: 0,
  }}
}

export async function verifyChatNarrativeShellV1(input: Pick<ProductProductionTaskExecutionInputV1, 'inputArtifacts' | 'task'>) {
  const content = await selectedChatProductionNarrativeV1(input)
  const shell = chatNarrativeShellV1(content)
  if (canonicalProductProductionJsonV2(chatProductionArtifactPayloadV1(input, 'content.narrative')) !== canonicalProductProductionJsonV2(shell)) fail('情境导航与作者选定开场不一致')
  return {content, shell}
}
