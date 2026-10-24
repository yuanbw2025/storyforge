import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'
import {loadChatSourceProjectionV1} from '../../src/lib/character-interaction/draft-service'
import {readChatSourceProjectionViewV1} from '../../src/lib/character-interaction/source-projection'
import {parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {parseFrozenChatSourceV1, createInitialInteractionState, interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {parseChatSituationCandidatesV1, selectChatNarrativeCandidateV1, chatNarrativeShellV1} from '../../src/lib/character-interaction/narrative-production'
import {compileInteractionModulesV1} from '../../src/lib/product-production/product-module-compilers'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {applyChatSituationV1} from '../../src/lib/character-interaction/narrative-situations'
import {chatActionReviewFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

it('freezes explicitly discoverable original passages and evidence without making them initially known or importing author-only material', async () => {
  const f = await seedChatNarrativeProductionFixture({worldDiscovery: true}), source = f.source.source
  expect(source.version).toBe(4); expect(source.playerCharacterSource).toBeNull()
  const secret = source.knowledge.find(s => s.discovery)!, actor = f.source.participants[0].participantKey
  expect(secret).toMatchObject({content: JSON.stringify('红铜钥匙藏在修钟台下的木匣里。'), audienceKeys: [], discovery: {actorKeys: [actor]}})
  expect(secret.source.sourceHash).toHaveLength(64); expect(secret.source.pointer).toBe('/background')
  expect(JSON.stringify(source)).not.toContain('谨慎的守灯调查者')
  expect(parseFrozenChatSourceV1(source, [actor], f.source.participants.map(p => p.characterKey))).toEqual(source)
  const draft = await loadChatSourceProjectionV1(f.scope, f.confirmed.revision)
  for (const viewerKey of ['player', f.settings.characters[0].sourceKey]) {
    expect(JSON.stringify(await readChatSourceProjectionViewV1({draft, classifications: f.settings.sourceReview!.classifications, viewerKey}))).not.toContain('红铜钥匙')
  }
  expect(parseChatSituationCandidatesV1(f.candidates, f.source)).toEqual(f.candidates)
})

it('rejects missing, stale, author-only, motive, player, already-known or unknowable source discovery authorizations', async () => {
  const f = await seedChatNarrativeProductionFixture({worldDiscovery: true}), draft = await loadChatSourceProjectionV1(f.scope, f.confirmed.revision)
  for (const kind of ['missing', 'condition', 'stale', 'author-only', 'motivation', 'player', 'foreign', 'known', 'missing-prerequisite', 'private-prerequisite', 'self'] as const) {
    const review = structuredClone(f.settings.sourceReview!), row = review.classifications.find(c => c.discovery)!
    if (kind === 'missing') delete row.discovery
    if (kind === 'condition') row.discovery!.condition = ''
    if (kind === 'stale') row.projectionHash = 'f'.repeat(64)
    if (kind === 'author-only') row.visibility = 'author-only'
    if (kind === 'motivation') row.purpose = 'motivation'
    if (kind === 'player') row.discovery!.actorKeys = ['player']
    if (kind === 'foreign') row.discovery!.actorKeys = ['absent']
    if (kind === 'known') {row.visibility = 'participants'; row.audienceKeys = [...row.discovery!.actorKeys]}
    if (kind === 'missing-prerequisite') row.discovery!.prerequisiteFragmentKeys = ['absent']
    if (kind === 'private-prerequisite') review.classifications.find(c => c.fragmentKey === row.discovery!.prerequisiteFragmentKeys[0])!.visibility = 'author-only'
    if (kind === 'self') row.discovery!.prerequisiteFragmentKeys = [row.fragmentKey]
    await expect(readChatSourceProjectionViewV1({draft, classifications: review.classifications, viewerKey: 'player'}), kind).rejects.toThrow()
  }
  expect(() => parseChatAuthoringSettings({...f.settings, narrative: {...f.settings.narrative, permissions: {...f.settings.narrative.permissions, maxDiscoveriesPerSituation: 0}}})).toThrow('额度')
  const {narrative: _setup, ...legacy} = f.settings
  expect(() => parseChatAuthoringSettings({...legacy, version: 2})).toThrow('实验')
})

it('preserves an initial holder while authorizing a different AI investigator and rejects frozen source authority tampering', async () => {
  const f = await seedChatNarrativeProductionFixture({worldDiscovery: true}), draft = await loadChatSourceProjectionV1(f.scope, f.confirmed.revision)
  const review = structuredClone(f.settings.sourceReview!), row = review.classifications.find(c => c.discovery)!
  row.visibility = 'participants'; row.audienceKeys = ['player']
  expect(JSON.stringify(await readChatSourceProjectionViewV1({draft, classifications: review.classifications, viewerKey: 'player'}))).toContain('红铜钥匙')
  expect(JSON.stringify(await readChatSourceProjectionViewV1({draft, classifications: review.classifications, viewerKey: f.settings.characters[0].sourceKey}))).not.toContain('红铜钥匙')
  const withHolder = structuredClone(f.source)
  withHolder.source.knowledge.find(s => s.discovery)!.audienceKeys = ['player']
  expect(() => parseChatSituationCandidatesV1(f.candidates, withHolder)).toThrow('来源授权')
  const matching = structuredClone(f.candidates)
  for (const option of matching.options) option.situation.facts.find(f => f.origin === 'reviewed-world' && f.discovery)!.audienceKeys = ['player']
  expect(parseChatSituationCandidatesV1(matching, withHolder)).toEqual(matching)
  for (const kind of ['legacy', 'missing-rule', 'player', 'unknown-prerequisite', 'private-prerequisite', 'known', 'purpose'] as const) {
    const source = structuredClone(f.source.source), secret = source.knowledge.find(s => s.discovery)!
    if (kind === 'legacy') source.version = 3
    if (kind === 'missing-rule') delete secret.discovery
    if (kind === 'player') secret.discovery!.actorKeys = ['player']
    if (kind === 'unknown-prerequisite') secret.discovery!.prerequisiteKnowledgeKeys = ['absent']
    if (kind === 'private-prerequisite') source.knowledge.find(s => s.key === secret.discovery!.prerequisiteKnowledgeKeys[0])!.audienceKeys = ['player']
    if (kind === 'known') secret.audienceKeys = [...secret.discovery!.actorKeys]
    if (kind === 'purpose') secret.source.purpose = 'motivation'
    expect(() => parseFrozenChatSourceV1(source, f.source.participants.map(p => p.participantKey), f.source.participants.map(p => p.characterKey)), kind).toThrow()
  }
})

it('prevents production from rewriting, omitting, duplicating or weakening source-authorized truths and conditions', async () => {
  const f = await seedChatNarrativeProductionFixture({worldDiscovery: true})
  for (const kind of ['text', 'condition', 'actors', 'prerequisite', 'omit', 'private-origin', 'duplicate', 'unapproved-rule'] as const) {
    const candidate = structuredClone(f.candidates), situation = candidate.options[0].situation, secret = situation.facts.find(f => f.origin === 'reviewed-world' && f.discovery)!
    if (kind === 'text') secret.text = '另外的答案'
    if (kind === 'condition') secret.discovery!.condition = '想知道就会发现'
    if (kind === 'actors') secret.discovery!.actorKeys = ['player']
    if (kind === 'prerequisite') secret.discovery!.prerequisiteFactKeys = ['clock']
    if (kind === 'omit') situation.facts = situation.facts.filter(f => f !== secret)
    if (kind === 'private-origin') {secret.origin = 'author-private'; secret.sourceKnowledgeKey = null}
    if (kind === 'duplicate') situation.facts.push({...structuredClone(secret), factKey: 'second-truth'})
    if (kind === 'unapproved-rule') situation.facts.find(f => f.origin === 'reviewed-world' && !f.discovery)!.discovery = {...secret.discovery!, prerequisiteFactKeys: ['clock']}
    expect(() => parseChatSituationCandidatesV1(candidate, f.source), kind).toThrow()
  }
})

it('discovers the canonical world fact only for the investigator while preserving its original text, source and frozen world', async () => {
  const f = await seedChatNarrativeProductionFixture({worldDiscovery: true}), sourceBefore = structuredClone(f.source.source)
  const content = await selectChatNarrativeCandidateV1({source: f.source, candidates: f.candidates, selection: {schema: 'storyforge.chat-situation-selection', version: 1,
    candidatesHash: await hashProductProductionValueV2(f.candidates), sourceHash: await hashProductProductionValueV2(f.source), selectedOptionKey: 'option-1', authorCommandId: 'world-discovery.select'}})
  const compiled = compileInteractionModulesV1({brief: f.brief, sourceCatalog: f.sourceCatalog, narrative: chatNarrativeShellV1(content), chatNarrative: content})
  let state = createInitialInteractionState(compiled)
  const actorKey = state.profiles[0].participantKey, secret = state.chatNarrative!.situation.facts.find(f => f.origin === 'reviewed-world' && f.discovery)!, rule = secret.discovery!
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'active', status: 'active', activeParticipantKeys: [actorKey], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}; state.remainingDirectorBudget = 50
  state = requestChatNarrativeTriggerV1(state, {sequence: 2, kind: 'scene-start', sourceEventSequence: 1, seed: null})
  const inspected = '店主打开修钟台下的木匣，查看里面。'
  const action: ChatNarrativeActionV1 = {kind: 'complete', text: inspected, goalKey: 'repair', evidenceFactKeys: rule.prerequisiteFactKeys, audienceKeys: ['player', actorKey], waitingForPlayer: false,
    newFacts: [{factKey: 'inspected', kind: 'observation', text: inspected, evidenceFactKeys: rule.prerequisiteFactKeys, evidenceExcerpt: inspected}], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {threadKey: 'repair-clock', direction: '确认此次实际检查获得的结果。', evidenceFactKeys: [...rule.prerequisiteFactKeys, 'inspected'], evidenceExcerpt: inspected}}
  state = applyReviewedChatNarrativeActionV1(state, {sequence: 3, triggerSequence: 2, actorKey, messageId: 'inspect', action, review: chatActionReviewFixture(action)})
  state = requestChatNarrativeTriggerV1(state, {sequence: 4, kind: 'continue', sourceEventSequence: 3, seed: null})
  const candidate: ChatSituationDraftV1 = {kind: 'chat-situation', title: '检查后的修钟铺', location: content.initialSituation.location, timeLabel: content.initialSituation.timeLabel, newFacts: [], newGoals: [], newThreads: [], possibilities: [],
    discoveries: [{factKey: secret.factKey, actorKey, actionSequence: 3, evidenceFactKeys: [...rule.prerequisiteFactKeys, 'inspected'], evidenceExcerpt: inspected, result: 'discovered', reason: '工程审查夹具，不是语义质量验收'}]}
  const after = applyChatSituationV1(state, {sequence: 5, triggerSequence: 4, draft: candidate, review: {reviewedProposalJson: canonicalStringify(candidate), checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具'}))}})
  expect(after.chatNarrative!.situation.facts.find(f => f.factKey === secret.factKey)).toEqual({...secret, audienceKeys: [actorKey]})
  expect(JSON.stringify(interactionVisibilityView(after, actorKey))).toContain('红铜钥匙')
  expect(JSON.stringify(interactionVisibilityView(after, 'player'))).not.toContain('红铜钥匙')
  expect(JSON.stringify(interactionVisibilityView(after, actorKey))).not.toContain(rule.condition)
  expect(f.source.source).toEqual(sourceBefore)
})
