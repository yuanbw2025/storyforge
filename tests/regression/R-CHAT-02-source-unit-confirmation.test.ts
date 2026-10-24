import {beforeEach, afterEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedChatSourceUnitConfirmationFixture, sourceUnitAuthorizationReportFixture} from '../helpers/chat-source-unit-confirmation'
import {reviewChatSourceUnitConfirmationV1, adoptChatSourceUnitConfirmationV1, readChatSourceUnitConfirmationRunV1, recoverChatSourceUnitConfirmationV1, readLatestChatSourceUnitConfirmationRunV1} from '../../src/lib/character-interaction/source-unit-confirmation-harness'
import {readChatDraftV1, saveChatDraftV1, confirmChatSourceReviewV1} from '../../src/lib/character-interaction/draft-service'
import {parseChatSourceUnitSetV1} from '../../src/lib/character-interaction/source-unit-authorization'
import {readAgentRunV1} from '../../src/lib/agent/run/event-store'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatRoleProfileCompilerInput} from '../helpers/chat-role-profile'
import {prepareChatNarrativeCompilerSourceV1, compileInteractionModulesV1} from '../../src/lib/product-production/product-module-compilers'
import {parseFrozenChatSourceV1, createInitialInteractionState, interactionVisibilityView, applyInteractionEvent} from '../../src/lib/character-interaction/runtime'
import {chatSituationCandidatesFixture} from '../helpers/chat-narrative-production-fixture'
import {selectChatNarrativeCandidateV1, chatNarrativeShellV1, type ChatNarrativeProductionSourceV1} from '../../src/lib/character-interaction/narrative-production'
import {hashCanonicalValue, canonicalStringify} from '../../src/lib/agent/run/hash'
import {selectChatCoordinatorContextV1} from '../../src/lib/character-interaction/coordinator-selection'
import {applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {applyChatSituationV1} from '../../src/lib/character-interaction/narrative-situations'
import {chatActionReviewFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'
import {seedCurrentProductBuild} from '../helpers/current-product-build'
import {readProductRuntimeState, readProductRuntimeStateVersion, startInteractionScene, requestChatNarrativeTrigger, commitChatNarrativeAction, commitChatSituation, branchProductRuntimeSession} from '../../src/lib/character-interaction/runtime-api'
import {assembleContext} from '../../src/lib/registry/assemble-context'
import {removeChatSourceUnitBundleV1} from '../../src/lib/character-interaction/source-unit-store'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function prepared() {
  const f = await seedChatSourceUnitConfirmationFixture(), runAI = vi.fn(async () => JSON.stringify(sourceUnitAuthorizationReportFixture(f.candidate, f.permissions)))
  const view = await reviewChatSourceUnitConfirmationV1({scope: f.scope, request: f.request, runAI})
  return {...f, view, runAI, adoption: {scope: f.scope, runId: view.runId, expectedCandidateHash: view.candidateHash!, candidate: f.candidate, permissions: f.permissions}}
}
it('requires exact independent permission review and explicit confirmation before atomic governed adoption', async () => {
  const f = await prepared(), worlds = await db.worldReleases.toArray()
  expect(f.view.status).toBe('ready'); expect(f.view.result?.passed).toBe(true)
  expect((await readChatDraftV1(f.scope)).sourceUnitsJson).toBeUndefined()
  expect((await readAgentRunV1(f.scope, f.view.runId)).contract.permissions.writeTargets).toEqual([{table: 'chatAuthoringDrafts', fields: ['sourceUnitsJson'], mode: 'author-confirmed'}])
  const changed = structuredClone(f.permissions); changed[0].audienceKeys = ['player']
  await expect(adoptChatSourceUnitConfirmationV1({...f.adoption, permissions: changed})).rejects.toThrow('与复核结果不符')
  const result = await adoptChatSourceUnitConfirmationV1(f.adoption)
  expect(result.status).toBe('adopted')
  const saved = await readChatDraftV1(f.scope), set = parseChatSourceUnitSetV1(JSON.parse(saved.sourceUnitsJson!))
  expect(saved.revision).toBe(f.draft.revision + 1); expect(set.bundles[0].candidate).toEqual(f.candidate)
  expect(set.bundles[0].source.fragments[0].valueJson).toContain('掌柜拿去拓印')
  expect(await adoptChatSourceUnitConfirmationV1(f.adoption)).toEqual(result)
  expect(await readChatDraftV1(f.scope)).toEqual(saved); expect(await db.worldReleases.toArray()).toEqual(worlds)
  expect(f.runAI).toHaveBeenCalledTimes(1)
})
it.each(['initialKnowledgeFaithful', 'discoverySupported'] as const)('retains %s denial and blocks confirmation', async flag => {
  const f = await seedChatSourceUnitConfirmationFixture(), report = sourceUnitAuthorizationReportFixture(f.candidate, f.permissions)
  report.permissions[0][flag] = false
  const result = await reviewChatSourceUnitConfirmationV1({scope: f.scope, request: f.request, runAI: async () => JSON.stringify(report)})
  expect(result.status).toBe('blocked'); expect(result.result?.report).toEqual(report)
  await expect(adoptChatSourceUnitConfirmationV1({scope: f.scope, runId: result.runId, expectedCandidateHash: result.candidateHash!, candidate: f.candidate, permissions: f.permissions})).rejects.toThrow()
  expect((await readChatDraftV1(f.scope)).sourceUnitsJson).toBeUndefined()
})
it('rolls back the data and confirmation events on a write failure, then safely retries the same author action', async () => {
  const f = await prepared(), before = await readAgentRunV1(f.scope, f.view.runId)
  await expect(adoptChatSourceUnitConfirmationV1({...f.adoption, onBoundary: boundary => {if (boundary === 'written-in-transaction') throw new Error('write interrupted')}})).rejects.toThrow('write interrupted')
  expect((await readChatDraftV1(f.scope)).sourceUnitsJson).toBeUndefined()
  expect(await readAgentRunV1(f.scope, f.view.runId)).toEqual(before)
  expect((await adoptChatSourceUnitConfirmationV1(f.adoption)).status).toBe('adopted'); expect(f.runAI).toHaveBeenCalledTimes(1)
})
it('blocks a newer draft and raw-source reclassification without overwriting author work', async () => {
  const f = await prepared()
  await saveChatDraftV1(f.scope, f.draft.revision, {...f.settings, playerRole: '新的玩家背景'})
  expect((await readChatSourceUnitConfirmationRunV1(f.scope, f.view.runId)).status).toBe('stale')
  await expect(adoptChatSourceUnitConfirmationV1(f.adoption)).rejects.toThrow('方案已变化')
  expect((await readChatDraftV1(f.scope)).sourceUnitsJson).toBeUndefined()
})
it('restores adopted history after import without resending or reverting a later draft', async () => {
  const f = await prepared(); await adoptChatSourceUnitConfirmationV1(f.adoption)
  const saved = await readChatDraftV1(f.scope)
  await saveChatDraftV1(f.scope, saved.revision, {...f.settings, playerRole: '确认后的新玩家背景'})
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), draft = (await db.chatAuthoringDrafts.where('projectId').equals(projectId).first())!
  const scope = {projectId, worldId: draft.worldId, workId: draft.workId}, view = (await readLatestChatSourceUnitConfirmationRunV1(scope))!
  expect((await recoverChatSourceUnitConfirmationV1(scope, view.runId)).status).toBe('adopted')
  expect((await readChatDraftV1(scope)).settingsJson).toContain('确认后的新玩家背景')
  expect((await readChatDraftV1(scope)).sourceUnitsJson).toBe(saved.sourceUnitsJson)
  expect(f.runAI).toHaveBeenCalledTimes(1)
})
it('compiles confirmed units into v6, retains all canonical units and exposes no whole-source provenance to actors', async () => {
  const f = await prepared(); await adoptChatSourceUnitConfirmationV1(f.adoption)
  const input = await chatRoleProfileCompilerInput(f.scope), compiled = prepareChatNarrativeCompilerSourceV1(input)
  expect(compiled.content.version).toBe(6)
  expect(compiled.content.sourceUnits?.bundles[0].source.fragments[0].valueJson).toContain('掌柜拿去拓印')
  const atoms = compiled.content.knowledge.filter(row => row.source.unit)
  expect(atoms).toHaveLength(3); expect(atoms.every(row => row.audienceKeys.length === 0)).toBe(true)
  expect(atoms.filter(row => row.discovery)).toHaveLength(1)
  expect(parseFrozenChatSourceV1(compiled.content, compiled.participantKeys, compiled.characterKeys)).toEqual(compiled.content)
  const source: ChatNarrativeProductionSourceV1 = {schema: 'storyforge.chat-narrative-production-source', version: 1, settings: input.brief.characterChat as ChatNarrativeProductionSourceV1['settings'], source: compiled.content,
    participants: compiled.participantKeys.map((participantKey, index) => ({participantKey, characterKey: compiled.characterKeys[index], name: compiled.names[index], voiceRules: compiled.voices[index] || '自然表达'}))}
  const candidates = chatSituationCandidatesFixture(source)
  const chatNarrative = await selectChatNarrativeCandidateV1({candidates, source, selection: {schema: 'storyforge.chat-situation-selection', version: 1,
    candidatesHash: await hashCanonicalValue(candidates), sourceHash: await hashCanonicalValue(source), selectedOptionKey: candidates.options[0].optionKey, authorCommandId: 'explicit-fixture-selection'}})
  const modules = compileInteractionModulesV1({...input, narrative: chatNarrativeShellV1(chatNarrative), chatNarrative})
  const initial = createInitialInteractionState(modules)
  const body = {commandId: 'units.scene', baseSequence: 0, baseStateHash: '0'.repeat(64), sceneId: 'units.fixture', sceneKey: initial.sceneTemplates[0].sceneKey}
  const state = applyInteractionEvent(initial, {projectId: f.scope.projectId, sessionId: 1, sequence: 1, type: 'interaction.scene.started', actorKey: null,
    targetKey: body.sceneKey, commandId: body.commandId, baseSequence: 0, baseStateHash: body.baseStateHash, payloadJson: JSON.stringify(body), createdAt: Date.now()})!
  const actor = JSON.stringify(interactionVisibilityView(state, compiled.participantKeys[0]))
  expect(actor).not.toContain('掌柜拿去拓印'); expect(actor).not.toContain('柜台下的木箱'); expect(actor).not.toContain('sourceUnits')
  const coordinator = selectChatCoordinatorContextV1(state, {text: '', sourceUnits: compiled.content.sourceUnits})
  expect(coordinator).toContain('掌柜拿去拓印'); expect(coordinator).toContain('sourceInterpretationConstraints')
  const locationUnit = atoms.find(row => row.source.unit!.unitKey === 'location')!
  const actorKey = compiled.participantKeys[0], fact = state.chatNarrative!.situation.facts.find(row => row.sourceKnowledgeKey === locationUnit.key)!, rule = fact.discovery!
  let active = requestChatNarrativeTriggerV1(state, {sequence: 2, kind: 'scene-start', sourceEventSequence: 1, seed: null})
  const inspected = '林舟打开柜台下的木箱，实际查看其中的物品。'
  const action: ChatNarrativeActionV1 = {kind: 'complete', text: inspected, goalKey: active.chatNarrative!.situation.goals.find(row => row.actorKey === actorKey)!.goalKey,
    evidenceFactKeys: rule.prerequisiteFactKeys, audienceKeys: ['player', actorKey], waitingForPlayer: false, disclosures: [], threadUpdates: [], goalStatus: null,
    newFacts: [{factKey: 'inspected-box', kind: 'observation', text: inspected, evidenceFactKeys: rule.prerequisiteFactKeys, evidenceExcerpt: inspected}],
    situationRequest: {threadKey: active.chatNarrative!.situation.threads.find(row => row.participantKeys.includes(actorKey))!.threadKey, direction: '确认本次实际检查的结果。', evidenceFactKeys: [...rule.prerequisiteFactKeys, 'inspected-box'], evidenceExcerpt: inspected}}
  active = applyReviewedChatNarrativeActionV1(active, {sequence: 3, triggerSequence: 2, actorKey, messageId: 'unit-investigation', action, review: chatActionReviewFixture(action)})
  active = requestChatNarrativeTriggerV1(active, {sequence: 4, kind: 'continue', sourceEventSequence: 3, seed: null})
  const discovered: ChatSituationDraftV1 = {kind: 'chat-situation', title: '木箱检查结果', location: chatNarrative.initialSituation.location, timeLabel: chatNarrative.initialSituation.timeLabel,
    newFacts: [], newGoals: [], newThreads: [], possibilities: [], discoveries: [{factKey: fact.factKey, actorKey, actionSequence: 3, evidenceFactKeys: [...rule.prerequisiteFactKeys, 'inspected-box'], evidenceExcerpt: inspected, result: 'discovered', reason: '工程隔离夹具，不代替真实语义验收'}]}
  const after = applyChatSituationV1(active, {sequence: 5, triggerSequence: 4, draft: discovered, review: {reviewedProposalJson: canonicalStringify(discovered), checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具'}))}})
  const known = JSON.stringify(interactionVisibilityView(after, actorKey))
  expect(known).toContain('铜印放在柜台下的木箱里'); expect(known).not.toContain('掌柜'); expect(known).not.toContain('拓印')
  expect(JSON.stringify(interactionVisibilityView(after, 'player'))).not.toContain('铜印放在柜台下的木箱里')
  for (const unit of atoms.filter(row => row.source.unit!.unitKey !== 'location')) expect(after.chatNarrative!.situation.facts.find(row => row.sourceKnowledgeKey === unit.key)!.audienceKeys).toEqual([])
  const tampered = structuredClone(compiled.content); tampered.knowledge.find(row => row.source.unit)!.audienceKeys = ['player']
  expect(() => parseFrozenChatSourceV1(tampered, compiled.participantKeys, compiled.characterKeys)).toThrow('初知范围')
  const missing = structuredClone(compiled.content); missing.knowledge = missing.knowledge.filter(row => row.source.unit?.unitKey !== 'purpose')
  expect(() => parseFrozenChatSourceV1(missing, compiled.participantKeys, compiled.characterKeys)).toThrow('正文、来源或初知范围')
  const oversized = structuredClone(compiled.content.sourceUnits!)
  oversized.bundles[0].source.fragments[0].valueJson = '不可截断的原文'.repeat(6000)
  expect(() => selectChatCoordinatorContextV1(state, {text: '', sourceUnits: oversized})).toThrow('超过本轮预算')
  // Exercise the actual verified Build/session -> registry -> import path.
  const release = (await db.worldReleases.get(f.draft.worldReleaseId!))!
  const shell = chatNarrativeShellV1(chatNarrative), {schema: _schema, version: _version, ...narrative} = shell
  const {session} = await seedCurrentProductBuild({scope: f.scope, worldRelease: {...release, id: f.draft.worldReleaseId!}, title: '事实知情验证', brief: input.brief, runtimePackage: {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'character-interaction',
    definition: {productKey: 'chat.atomic-units', title: '事实知情验证', description: '工程夹具', enabledCapabilities: ['narrative', 'interaction'], rulesetVersion: 1, initialVariables: {}},
    sourceWorld: {contentHash: release.contentHash, selection: input.brief.source.selection}, narrative, interaction: modules,
  }})
  const version = await readProductRuntimeStateVersion(session.id!)
  const started = await startInteractionScene({sessionId: session.id!, commandId: 'unit.registry.scene', baseSequence: version.sequence, baseStateHash: version.stateHash, sceneId: 'units.registry', sceneKey: modules.sceneTemplates[0].sceneKey})
  const registered = await assembleContext({scope: f.scope, projectId: f.scope.projectId, productRuntimeSessionId: session.id!, sourceKeys: ['chatSituationRuntime'], inputBudgetTokens: 20000})
  expect(registered.included).toEqual(['chatSituationRuntime']); expect(registered.trimmed).toEqual([])
  expect(registered.text).toContain('掌柜拿去拓印'); expect(registered.text).toContain('sourceInterpretationConstraints')
  const perspective = await assembleContext({scope: f.scope, projectId: f.scope.projectId, productRuntimeSessionId: session.id!, sourceKeys: ['interactionRuntime'], interactionParticipantKey: actorKey})
  expect(perspective.text).not.toContain('掌柜拿去拓印'); expect(perspective.text).not.toContain('sourceInterpretationConstraints')
  const envelope = async (commandId: string) => {const v = await readProductRuntimeStateVersion(session.id!); return {sessionId: session.id!, commandId, baseSequence: v.sequence, baseStateHash: v.stateHash}}
  const triggered = await requestChatNarrativeTrigger({...await envelope('unit.trigger'), kind: 'scene-start', sourceEventSequence: started.sequence})
  const performed = await commitChatNarrativeAction({...await envelope('unit.inspection'), actorKey, triggerSequence: triggered.sequence, messageId: 'unit-investigation', action, review: chatActionReviewFixture(action)})
  const continued = await requestChatNarrativeTrigger({...await envelope('unit.continue'), kind: 'continue', sourceEventSequence: performed.sequence})
  const actualDiscovery = {...discovered, discoveries: discovered.discoveries!.map(row => ({...row, actionSequence: performed.sequence}))}
  await commitChatSituation({...await envelope('unit.discovery'), triggerSequence: continued.sequence, draft: actualDiscovery, review: {reviewedProposalJson: canonicalStringify(actualDiscovery), checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具'}))}})
  const installed = await readProductRuntimeState(session.id!)
  const branch = await branchProductRuntimeSession({parentSessionId: session.id!, throughSequence: installed.lastSequence, title: '位置已知的独立分支'})
  const branched = (await readProductRuntimeState(branch.id!)).interaction!
  expect(JSON.stringify(interactionVisibilityView(branched, actorKey))).toContain('铜印放在柜台下的木箱里')
  expect(JSON.stringify(interactionVisibilityView(branched, actorKey))).not.toContain('拓印')
  expect(JSON.stringify(interactionVisibilityView(branched, 'player'))).not.toContain('铜印放在柜台下的木箱里')
  const currentDraft = await readChatDraftV1(f.scope)
  await removeChatSourceUnitBundleV1(f.scope, currentDraft.revision, f.request.source.fragmentKeys)
  expect((prepareChatNarrativeCompilerSourceV1(await chatRoleProfileCompilerInput(f.scope))).content.version).not.toBe(6)
  expect(await readProductRuntimeState(session.id!)).toEqual(installed)
  const currentContext = await assembleContext({scope: f.scope, projectId: f.scope.projectId, productRuntimeSessionId: session.id!, sourceKeys: ['chatSituationRuntime'], inputBudgetTokens: 20000})
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => row.parentSessionId == null)!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(installed.interaction)
  const restored = await assembleContext({scope: {projectId, worldId: imported.worldId, workId: imported.workId}, projectId, productRuntimeSessionId: imported.id!, sourceKeys: ['chatSituationRuntime'], inputBudgetTokens: 20000})
  expect(restored.text).toBe(currentContext.text)
  expect((await db.worldReleases.get(f.draft.worldReleaseId!))!.contentHash).toBe(release.contentHash)
})
it.each(['foreign-original', 'missing-actor', 'raw-parent', 'missing-review', 'forged-origin'] as const)('rejects %s in portable confirmed source', async change => {
  const f = await prepared(); await adoptChatSourceUnitConfirmationV1(f.adoption)
  const compiled = prepareChatNarrativeCompilerSourceV1(await chatRoleProfileCompilerInput(f.scope)), source = structuredClone(compiled.content)
  const bundle = source.sourceUnits!.bundles[0], original = bundle.source.fragments[0]
  if (change === 'foreign-original') {original.resourceKey = 'forged:resource'; original.fragmentKey = `${original.resourceKey}#${original.pointer}`}
  if (change === 'missing-actor') bundle.source.cast.pop()
  if (change === 'raw-parent') source.knowledge.push({key: 'forged.parent', content: original.valueJson, audienceKeys: ['player'], source: {resourceKey: original.resourceKey, sourceHash: original.sourceHash, pointer: '/entries/seal', purpose: 'knowledge'}})
  if (change === 'missing-review') bundle.review.permissions.pop()
  if (change === 'forged-origin') original.origin = 'product-private'
  expect(() => parseFrozenChatSourceV1(source, compiled.participantKeys, compiled.characterKeys)).toThrow()
})
it('refuses to compile after the raw compound passage becomes public instead of silently revealing adjacent secrets', async () => {
  const f = await prepared(); await adoptChatSourceUnitConfirmationV1(f.adoption)
  const draft = await readChatDraftV1(f.scope)
  if (f.settings.version !== 3) throw new Error('fixture')
  const review = structuredClone(f.settings.sourceReview!)
  review.classifications.find(row => row.fragmentKey === f.fragment.fragmentKey)!.visibility = 'public'
  await confirmChatSourceReviewV1(f.scope, draft.revision, review)
  await expect(chatRoleProfileCompilerInput(f.scope)).rejects.toThrow('原文或分类已变化')
})
