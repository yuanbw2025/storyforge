import {buildChatOpeningReviewReferencesV1} from '../../src/lib/character-interaction/opening-review-references'
import type {ChatExperienceInfoV1} from '../../src/lib/character-interaction/experience-info'
import type {ChatCharacterCardOriginV1} from '../../src/lib/character-interaction/private-character'
import {CHAT_OPENING_CHECKS, type ChatOpeningReviewDraftV1} from '../../src/lib/character-interaction/situation-production-review'
import { seedCurrentProductWorld } from './current-product-world'
import { createChatDraftV3, selectChatWorldV1, saveChatDraftV1, loadChatSourceProjectionV1, confirmChatSourceReviewV1, readChatDraftV1 } from '../../src/lib/character-interaction/draft-service'
import {generateChatConsultationV2, adoptChatConsultationV2} from '../../src/lib/character-interaction/consultation-harness'
import { parseChatAuthoringSettings } from '../../src/lib/character-interaction/authoring-contract'
import { loadProductProductionConsultationSourceV2, loadProductProductionWorldSourceCatalogV2 } from '../../src/lib/product-production/world-source'
import { suggestProductStartingPoints, draftProductProductionBriefV3 } from '../../src/lib/product-production/consultation'
import { prepareChatNarrativeCompilerSourceV1 } from '../../src/lib/product-production/product-module-compilers'
import type { ChatNarrativeProductionSourceV1, ChatSituationCandidatesV1 } from '../../src/lib/character-interaction/narrative-production'
import {chatProjectionResourcesV1} from '../../src/lib/character-interaction/source-projection'
import {createChatPrivateCharacterV1} from '../../src/lib/character-interaction/private-character'

export async function seedChatNarrativeProductionFixture(options: {mappedPlayer?: boolean; factDiscovery?: boolean; worldDiscovery?: boolean; privateKnownFact?: boolean; privateCast?: 'only' | 'mixed'; consultation?: boolean; cardOrigin?: ChatCharacterCardOriginV1; experienceInfo?: ChatExperienceInfoV1} = {}) {
  const world = await seedCurrentProductWorld('CHAT situation production', options.worldDiscovery ? {characterDetails: {
    background: '红铜钥匙藏在修钟台下的木匣里。', shortDescription: '修钟台下有一只获准由店主检查的木匣。',
  }} : options.privateKnownFact ? {characterDetails: {background: '自己保存了一块能试用的旧发条，但不确定能否耐久。'}} : {})
  const {scope} = await createChatDraftV3('修钟铺的一天')
  const linked = await selectChatWorldV1(scope, 0, world.release.id!)
  const index = await loadProductProductionConsultationSourceV2({scope, worldReleaseId: linked.worldReleaseId!})
  const sourceKey = index.selectionOptions.characters.find(c => c.label === '林舟')!.resourceKey
  const base = parseChatAuthoringSettings(JSON.parse(linked.settingsJson))
  if (base.version !== 3) throw new Error('fixture version')
  const playerCharacterKey = index.selectionOptions.characters.find(c => c.label === '守潮人')!.resourceKey
  const draft = await saveChatDraftV1(scope, linked.revision, {...base,
    ...(options.experienceInfo ? {experienceInfo: options.experienceInfo} : {}),
    ...(options.privateCast ? {mode: options.privateCast === 'mixed' ? 'multi' : 'single', privateCharacters: [{...createChatPrivateCharacterV1(), ...(options.cardOrigin ? {cardOrigin: options.cardOrigin} : {}), name: '苏禾', identity: '本体验的修钟铺店主', background: '希望修好旧钟，愿意自己检查工具。', personality: '温和而有主见。', voice: '仅作者掌握的私域结局'}]} : {}),
    ...(options.mappedPlayer || options.factDiscovery || options.worldDiscovery ? {narrative: {...base.narrative, ...(options.mappedPlayer ? {playerCharacterKey, personaName: '守潮人'} : {}), ...(options.factDiscovery || options.worldDiscovery ? {permissions: {...base.narrative.permissions, allowActorSituationExpansion: true, maxDiscoveriesPerSituation: 2}} : {})}} : {}),
    playerRole: options.mappedPlayer ? '来到修钟铺的守潮人，没有答应帮忙修理。' : '来店里借书的旅人沈禾，没有答应帮忙修理。', openingSituation: '雨天，修钟铺的一台旧钟停了。',
    characters: options.privateCast === 'only' ? [] : [{sourceKey, voiceRules: '', privateKnowledge: '', initialTrust: 0}]})
  const projection = await loadChatSourceProjectionV1(scope, draft.revision)
  let confirmed = await confirmChatSourceReviewV1(scope, draft.revision, {
    projectionHash: projection.projectionHash,
    classifications: chatProjectionResourcesV1(projection).flatMap(c => c.fragments.map(f => options.worldDiscovery && c.resourceKey === sourceKey && f.pointer === '/background' ? ({
      projectionHash: projection.projectionHash, fragmentKey: f.fragmentKey, purpose: 'knowledge', visibility: 'discoverable', audienceKeys: [],
      discovery: {actorKeys: [sourceKey], condition: '店主实际打开并查看修钟台下木匣的内部；仅查看外观不足以发现。', prerequisiteFragmentKeys: [c.fragments.find(item => item.pointer === '/shortDescription')!.fragmentKey]},
    }) : options.worldDiscovery && c.resourceKey === sourceKey && f.pointer === '/shortDescription' ? ({
      projectionHash: projection.projectionHash, fragmentKey: f.fragmentKey, purpose: 'knowledge', visibility: 'public', audienceKeys: [],
    }) : options.privateKnownFact && c.resourceKey === sourceKey && f.pointer === '/background' ? ({
      projectionHash: projection.projectionHash, fragmentKey: f.fragmentKey, purpose: 'knowledge', visibility: 'participants', audienceKeys: [sourceKey],
    }) : c.resourceKey === projection.playerCharacter?.resourceKey ? ({
      projectionHash: projection.projectionHash, fragmentKey: f.fragmentKey,
      purpose: ['/name', '/identity'].includes(f.pointer) ? 'identity' : 'knowledge',
      visibility: ['/name', '/identity'].includes(f.pointer) ? 'public' : f.pointer === '/background' ? 'participants' : 'author-only',
      audienceKeys: f.pointer === '/background' ? ['player'] : [],
    }) : ({
      projectionHash: projection.projectionHash, fragmentKey: f.fragmentKey,
      purpose: f.pointer === '/background' ? 'motivation' : f.pointer === '/personality' ? 'voice' : 'identity',
      visibility: f.pointer === '/name' ? 'public' : ['/background','/personality'].includes(f.pointer) ? 'participants' : 'author-only',
      audienceKeys: ['/background','/personality'].includes(f.pointer) ? [c.resourceKey] : [],
    }))),
  })
  if (options.consultation) {
    const fragment = projection.characters.find(c => c.origin === 'product-private')!.fragments.find(f => f.pointer === '/background')!
    const view = await generateChatConsultationV2({scope, request: {draftRevision: confirmed.revision, question: '让角色自己尝试，不要求旅人参与。', priorRunId: null,
      source: {draftRevision: confirmed.revision, projectionHash: projection.projectionHash, fragmentKeys: [fragment.fragmentKey]}},
      runAI: async () => JSON.stringify({answer: '只给作者的会谈备注 S2AUTHOR-ONLY-LINEAGE-NOTE', changes: [{field: 'openingSituation', value: '雨天旧钟停了，苏禾可以先自己检查，旅人可继续看书。',
        basis: 'proposal', reason: '保留角色自己的愿望和玩家选择', evidence: [{fragmentKey: fragment.fragmentKey, quote: '希望修好旧钟，愿意自己检查工具。'}]}]}),
    })
    await adoptChatConsultationV2({scope, runId: view.runId, expectedCandidateHash: view.candidateHash!, fields: ['openingSituation']})
    confirmed = await readChatDraftV1(scope)
  }
  const settings = parseChatAuthoringSettings(JSON.parse(confirmed.settingsJson))
  if (settings.version !== 3) throw new Error('fixture version')
  const starting = await suggestProductStartingPoints({scope, worldReleaseId: confirmed.worldReleaseId!})
  const brief = await draftProductProductionBriefV3({scope, worldReleaseId: confirmed.worldReleaseId!,
    suggestionKey: starting.suggestions[0].suggestionKey, productType: 'character-interaction', characterChat: settings,
    playerRole: settings.playerRole, openingSituation: settings.openingSituation, visualLevel: 'none', audioLevel: 'none'})
  const sourceCatalog = await loadProductProductionWorldSourceCatalogV2({scope, worldReleaseId: confirmed.worldReleaseId!, selection: brief.source.selection, chatPrivateCharacters: settings.privateCharacters})
  const projected = prepareChatNarrativeCompilerSourceV1({brief, sourceCatalog})
  const {privateCharacters: _privateCharacters, visuals: _visuals, experienceInfo: _experienceInfo, ...reviewedSettings} = settings
  const source: ChatNarrativeProductionSourceV1 = {
    schema: 'storyforge.chat-narrative-production-source', version: 1, settings: reviewedSettings, source: projected.content,
    participants: projected.participantKeys.map((participantKey, i) => ({participantKey, characterKey: projected.characterKeys[i], name: projected.names[i], voiceRules: projected.voices[i] || '自然表达'})),
  }
  return {world, scope, confirmed, settings, brief, sourceCatalog, source, candidates: chatSituationCandidatesFixture(source)}
}

export function chatSituationCandidatesFixture(source: ChatNarrativeProductionSourceV1): ChatSituationCandidatesV1 {
  const actor = source.participants[0].participantKey
  const audienceKeys = ['player', ...source.participants.map(p => p.participantKey)]
  const discoverySources = source.source.knowledge.filter(s => s.discovery || s.source.unit || source.source.knowledge.some(t => t.discovery?.prerequisiteKnowledgeKeys.includes(s.key)))
  const factKeys = new Map(discoverySources.map((s, index) => [s.key, `world-discovery-${index}`]))
  return {schema: 'storyforge.chat-situation-candidates', version: 1, options: ['缺失零件', '旧账本', '停摆的纪念钟'].map((title, i) => ({
    optionKey: `option-${i + 1}`, title, pitch: `从${title}展开，可以先喝茶也可以一起查看。`,
    situation: {situationKey: `situation-${i + 1}`, sceneKey: `scene-${i + 1}`, title, location: '修钟铺', timeLabel: '雨天下午',
      facts: [{factKey: 'clock', text: `${title}放在工作台上。`, audienceKeys, origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0}, ...(source.settings.narrative.permissions.maxDiscoveriesPerSituation ? [
        {factKey: 'parcel', text: '工作台上的蓝色布包获准由店主自行打开查看。', audienceKeys, origin: 'author-private' as const, sourceKnowledgeKey: null, sourceEventSequence: 0},
        {factKey: 'hidden-note', text: '蓝色布包里存着一张未署名的清单。', audienceKeys: [], origin: 'author-private' as const, sourceKnowledgeKey: null, sourceEventSequence: 0,
          discovery: {sceneKey: `scene-${i + 1}`, actorKeys: [actor], condition: '店主实际打开并查看获准检查的蓝色布包内部；这不证明谁写了清单。', prerequisiteFactKeys: ['parcel']}},
      ] : []), ...discoverySources.map(s => ({factKey: factKeys.get(s.key)!, text: s.content, audienceKeys: s.audienceKeys,
        origin: 'reviewed-world' as const, sourceKnowledgeKey: s.key, sourceEventSequence: 0,
        ...(s.discovery ? {discovery: {sceneKey: `scene-${i + 1}`, actorKeys: [...s.discovery.actorKeys], condition: s.discovery.condition,
          prerequisiteFactKeys: s.discovery.prerequisiteKnowledgeKeys.map(key => factKeys.get(key)!)}} : {}),
      }))],
      goals: source.participants.map((p, index) => ({goalKey: index ? `repair-${index}` : 'repair', actorKey: p.participantKey, desire: `了解${title}`, concern: '不想打扰旅人', boundary: '不强求帮忙', evidenceFactKeys: ['clock'], status: 'active', updatedSequence: 0})),
      beliefs: [],
      threads: [{threadKey: 'repair-clock', title, question: `${title}应如何处理？`, audienceKeys, participantKeys: source.participants.map(p => p.participantKey), evidenceFactKeys: ['clock'], closureSignals: ['解决问题或决定暂缓'], status: 'open', updatedSequence: 0}],
      possibilities: [{actorKey: actor, text: '可以自己检查，也可以先停下来喝茶。', evidenceFactKeys: ['clock']}],
    },
  }))}
}

export function chatOpeningReviewFixture(candidates: ChatSituationCandidatesV1, rejectedOptionKey?: string): ChatOpeningReviewDraftV1 {
  return {options: candidates.options.map(option => ({optionKey: option.optionKey, checks: CHAT_OPENING_CHECKS.map(check => ({
    check, passed: option.optionKey !== rejectedOptionKey || check !== 'viable-agency', reason: '工程审查夹具，不是叙事质量验收。',
    evidence: [{target: 'option' as const, pointer: '/title', quote: option.title}],
  }))}))}
}

/** Structural fixture only; the injected verdict is not evidence of story quality. */
export function chatOpeningAgencyReviewFixture(candidates: ChatSituationCandidatesV1, rejectedOptionKey?: string): ChatOpeningReviewDraftV1 {
  const draft = chatOpeningReviewFixture(candidates, rejectedOptionKey)
  for (const row of draft.options) {
    const option = candidates.options.find(o => o.optionKey === row.optionKey)!, direction = option.situation.possibilities[0]
    const check = row.checks.find(c => c.check === 'viable-agency')!
    row.agency = check.passed ? {actorKey: direction.actorKey, goalKey: option.situation.goals.find(g => g.actorKey === direction.actorKey)!.goalKey,
      possibilityIndex: 0, basisFactKeys: direction.evidenceFactKeys.slice(0, 3), mode: 'act', expectedChange: '核实当前物件的状态，再决定处理方式。', unresolved: '具体状态及是否能处理尚未确认。'} : null
    if (row.agency) check.evidence = [{target: 'option', pointer: '/situation/possibilities/0/text', quote: direction.text}, ...row.agency.basisFactKeys.map(key => {
      const i = option.situation.facts.findIndex(f => f.factKey === key)
      return {target: 'option' as const, pointer: `/situation/facts/${i}/text`, quote: option.situation.facts[i].text}
    })]
  }
  return draft
}

/** Injected v3 evidence for pipeline tests, not an independent quality verdict. */
export function chatOpeningDevelopmentReviewFixture(candidates: ChatSituationCandidatesV1, rejectedOptionKey?: string): ChatOpeningReviewDraftV1 {
  const draft = chatOpeningAgencyReviewFixture(candidates, rejectedOptionKey)
  for (const row of draft.options) {
    const check = row.checks.find(c => c.check === 'open-development')!
    const agency = row.agency
    row.development = agency ? {mode: 'direct', possibilityIndex: agency.possibilityIndex,
      basisFactKeys: [...agency.basisFactKeys], expectedChange: '工程注入的背景依据，不代表真实模型认为故事可持续。', unresolved: agency.unresolved} : null
    check.passed = !!agency
    if (agency) check.evidence = structuredClone(row.checks.find(c => c.check === 'viable-agency')!.evidence)
  }
  return draft
}

/** Convert a known valid test draft into the v9 wire format. Production does
 * not use this helper, and its authored verdicts are not model-quality proof. */
export async function chatSituationReferenceDraftFixture(source: ChatNarrativeProductionSourceV1, candidates = chatSituationCandidatesFixture(source)) {
  const {buildChatOpeningFactCatalogV1, CHAT_OPENING_REFERENCE_SCHEMA} = await import('../../src/lib/character-interaction/opening-source-references')
  const catalog = await buildChatOpeningFactCatalogV1(source)
  return {schema: CHAT_OPENING_REFERENCE_SCHEMA, version: 1, options: candidates.options.map(option => {
    const s = option.situation
    const mappings = new Map(s.facts.filter(f => f.origin === 'reviewed-world').map(f =>
      [f.factKey, catalog.facts.find(entry => entry.sourceKnowledgeKey === f.sourceKnowledgeKey)!.factKey]))
    const remap = (keys: string[]) => keys.map(key => mappings.get(key) ?? key)
    return {...option, situation: {
      situationKey: s.situationKey, sceneKey: s.sceneKey, title: s.title, location: s.location, timeLabel: s.timeLabel,
      worldFactKeys: [...mappings.values()],
      localFacts: s.facts.filter(f => f.origin !== 'reviewed-world').map(f => ({
        factKey: f.factKey, text: f.text, audienceKeys: f.audienceKeys,
        ...(f.discovery ? {discovery: {...f.discovery, prerequisiteFactKeys: remap(f.discovery.prerequisiteFactKeys)}} : {}),
      })),
      goals: s.goals.map(({status: _status, updatedSequence: _updated, ...g}) => ({...g, evidenceFactKeys: remap(g.evidenceFactKeys)})),
      beliefs: s.beliefs.map(({updatedSequence: _updated, ...belief}) => ({...belief, evidenceFactKeys: remap(belief.evidenceFactKeys)})),
      threads: s.threads.map(({status: _status, updatedSequence: _updated, ...thread}) => ({...thread, evidenceFactKeys: remap(thread.evidenceFactKeys)})),
      possibilities: s.possibilities.map(p => ({...p, evidenceFactKeys: remap(p.evidenceFactKeys)})),
    }}
  })}
}

/** Explicit injected wire fixture. Never converts model responses in production. */
export function chatOpeningReferenceReviewFixture(source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1, draft = chatOpeningDevelopmentReviewFixture(candidates)) {
  const references = buildChatOpeningReviewReferencesV1(source, candidates)
  return {...draft, options: draft.options.map(option => ({...option, checks: option.checks.map(check => ({...check,
    evidence: check.evidence.map(evidence => {
      const ref = references.find(ref => ref.target === evidence.target && (ref.target === 'source' || ref.optionKey === option.optionKey)
        && ref.pointer === evidence.pointer && ref.quote.includes(evidence.quote))
      if (!ref) throw new Error('Engineering review fixture must select actual bounded evidence')
      return {refId: ref.refId}
    }),
  }))}))}
}

/** Explicit current keyed wire; the canonical judgment remains authored by the test. */
export function chatOpeningKeyedReviewFixture(source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1, draft = chatOpeningDevelopmentReviewFixture(candidates)) {
  const wire = chatOpeningReferenceReviewFixture(source, candidates, draft)
  return {options: Object.fromEntries(wire.options.map(({optionKey, checks, ...option}) => [optionKey, {
    ...option, checks: Object.fromEntries(checks.map(({check, ...result}) => [check, result])),
  }]))}
}

/** Explicit v13 fixture; no model output is converted by this helper. */
export function chatOpeningProofReviewFixture(source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1, draft = chatOpeningDevelopmentReviewFixture(candidates)) {
  const wire = chatOpeningKeyedReviewFixture(source, candidates, draft)
  return {options: Object.fromEntries(Object.entries(wire.options).map(([key, option]) => [key, {...option,
    checks: Object.fromEntries(Object.entries(option.checks).map(([check, result]) => {
      const proof = check === 'viable-agency' ? 'agency' : check === 'open-development' ? 'development' : null
      return [check, {...result, evidence: proof ? option[proof] ? {proof} : {refs: result.evidence} : result.evidence}]
    })),
  }]))}
}
