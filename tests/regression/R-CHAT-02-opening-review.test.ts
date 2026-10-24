import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {assertChatOpeningReviewedV1, createChatOpeningReviewV1, parseChatOpeningReviewDraftV1, readChatOpeningReviewV1} from '../../src/lib/character-interaction/situation-production-review'
import {chatOpeningDevelopmentReviewFixture, chatOpeningReviewFixture, seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'
import {seedIllustratedChatBriefFixture} from '../helpers/chat-media-production-fixture'
import {createProductProductionPlanV3} from '../../src/lib/product-production/plan'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {draftProductProductionBriefV3, suggestProductStartingPoints} from '../../src/lib/product-production/consultation'
import {getAgentSkillV1} from '../../src/lib/agent/skill-registry'
import {productProductionTaskUsesWorldGatewayV1} from '../../src/lib/product-production/source-contracts'
import {verifyChatNarrativeShellV1} from '../../src/lib/product-production/chat-situation-tasks'
import {buildChatOpeningFactCatalogV2, parseChatOpeningSourceBoundOutputV2} from '../../src/lib/character-interaction/opening-source-references'
import {selectChatNarrativeCandidateV1, chatNarrativeShellV1} from '../../src/lib/character-interaction/narrative-production'
import type {ProductProductionTaskExecutionInputV1} from '../../src/lib/product-production/scheduler'
import type {ChatAuthoringSettingsV3} from '../../src/lib/character-interaction/authoring-contract'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

it('binds all option reviews to exact source and candidate content; a failed option cannot borrow another option approval', async () => {
  const f = await seedChatNarrativeProductionFixture(), draft = chatOpeningReviewFixture(f.candidates, 'option-1')
  const report = await createChatOpeningReviewV1(draft, f.source, f.candidates)
  await expect(assertChatOpeningReviewedV1(report, f.source, f.candidates, 'option-1')).rejects.toThrow('未通过')
  await expect(assertChatOpeningReviewedV1(report, f.source, f.candidates, 'option-2')).resolves.toEqual(report)
  const changed = structuredClone(f.candidates); changed.options[1].situation.goals[0].desire = '改变后的目标'
  await expect(assertChatOpeningReviewedV1(report, f.source, changed, 'option-2')).rejects.toThrow('版本')
  const source = structuredClone(f.source); source.settings.openingSituation = '另一个矛盾'
  await expect(assertChatOpeningReviewedV1(report, source, f.candidates, 'option-2')).rejects.toThrow('版本')
  expect(() => readChatOpeningReviewV1({...report, sourceHash: 'f'.repeat(64)}, {...report, source: f.source, candidates: f.candidates})).toThrow('版本')
})

it.each(['missing option', 'duplicate option', 'missing check', 'duplicate check', 'unknown check', 'invented quote', 'foreign option quote', 'missing path', 'non-text path', 'no evidence', 'model hash'] as const)('rejects an unverifiable model report: %s', async invalid => {
  const f = await seedChatNarrativeProductionFixture(), draft = chatOpeningReviewFixture(f.candidates)
  const checks = draft.options[0].checks, evidence = checks[0].evidence[0]
  if (invalid === 'missing option') draft.options.pop()
  if (invalid === 'duplicate option') draft.options[1].optionKey = draft.options[0].optionKey
  if (invalid === 'missing check') checks.pop()
  if (invalid === 'duplicate check') checks[1].check = checks[0].check
  if (invalid === 'unknown check') checks[0].check = 'extra' as never
  if (invalid === 'invented quote') evidence.quote = '原文不存在的结论'
  if (invalid === 'foreign option quote') evidence.quote = f.candidates.options[1].title
  if (invalid === 'missing path') evidence.pointer = '/situation/no-such-field'
  if (invalid === 'non-text path') evidence.pointer = '/situation/goals'
  if (invalid === 'no evidence') checks[0].evidence = []
  const value = invalid === 'model hash' ? {...draft, sourceHash: 'model-chosen'} : draft
  expect(() => parseChatOpeningReviewDraftV1(value, f.source, f.candidates)).toThrow()
})

it('registers the review between creation and author choice, and requires the same report again for navigation and integration', async () => {
  const f = await seedChatNarrativeProductionFixture(), plan = await createProductProductionPlanV3({brief: f.brief, briefHash: await hashProductProductionValueV2(f.brief), buildNumber: 1})
  // Reach the quality-report boundary with a valid current producer output.
  const candidates = await parseChatOpeningSourceBoundOutputV2(f.candidates, f.source, await buildChatOpeningFactCatalogV2(f.source))
  const task = plan.tasks.find(t => t.taskKey === 'content.chat-opening-review')!
  expect(task.dependsOn).toEqual(['content.product-module'])
  expect(task.maxAttempts).toBe(1)
  expect(task.inputArtifactKeys).toEqual(['design.game', 'content.chat-candidates'])
  expect(productProductionTaskUsesWorldGatewayV1(task)).toBe(false)
  expect(getAgentSkillV1(task.skillId!).contextSourceKeys).toEqual(['product-production.chat-opening-review-inputs'])
  for (const key of ['content.chat-author-gate', 'content.narrative', 'integration.package']) expect(plan.tasks.find(t => t.taskKey === key)!.inputArtifactKeys).toContain('quality.chat-openings')
  const selection = {schema: 'storyforge.chat-situation-selection', version: 1, candidatesHash: await hashProductProductionValueV2(candidates), sourceHash: await hashProductProductionValueV2(f.source), selectedOptionKey: 'option-2', authorCommandId: 'test.author'}
  const artifacts = [{artifactKey: 'design.game', payloadJson: JSON.stringify(f.source)}, {artifactKey: 'content.chat-candidates', payloadJson: JSON.stringify(candidates)}, {artifactKey: 'content.chat-selection', payloadJson: JSON.stringify(selection)}]
  const input = {task: plan.tasks.find(t => t.taskKey === 'integration.package')!, inputArtifacts: artifacts} as unknown as ProductProductionTaskExecutionInputV1
  await expect(verifyChatNarrativeShellV1(input)).rejects.toThrow('缺少唯一情境生产依赖:quality.chat-openings')
  const report = await createChatOpeningReviewV1(chatOpeningDevelopmentReviewFixture(candidates), f.source, candidates, 3)
  const content = await selectChatNarrativeCandidateV1({source: f.source, candidates: candidates, selection: {...selection, schema: 'storyforge.chat-situation-selection', version: 1}})
  artifacts.push({artifactKey: 'content.narrative', payloadJson: JSON.stringify(chatNarrativeShellV1(content))})
  artifacts.push({artifactKey: 'quality.chat-openings', payloadJson: JSON.stringify(report)})
  await expect(verifyChatNarrativeShellV1(input)).resolves.toMatchObject({content})
  report.options[1].checks[0].passed = false
  artifacts[artifacts.length - 1].payloadJson = JSON.stringify(report)
  await expect(verifyChatNarrativeShellV1(input)).rejects.toThrow('未通过')
  // Read a genuinely older topology without claiming it had this new review.
  const legacy = {...input, task: {...input.task, acceptanceGateIds: input.task.acceptanceGateIds.filter(g => !['chat.opening-grounded-agency.v2', 'chat.opening-development.v3'].includes(g)), inputArtifactKeys: input.task.inputArtifactKeys.filter(key => key !== 'quality.chat-openings')}, inputArtifacts: input.inputArtifacts.filter(a => a.artifactKey !== 'quality.chat-openings')}
  await expect(verifyChatNarrativeShellV1(legacy)).resolves.toMatchObject({content})
})

it.each([['key-scenes', 'none'], ['none', 'music-sfx'], ['key-scenes', 'full']] as const)('keeps opening review inside the authorized budget with visual=%s audio=%s', async (visualLevel, audioLevel) => {
  // Picture production requires the author's public descriptions; device speech
  // remains outside the production media budget even when generic audio is requested.
  const f = visualLevel === 'none' ? await seedChatNarrativeProductionFixture() : await seedIllustratedChatBriefFixture()
  const starting = await suggestProductStartingPoints({scope: f.scope, worldReleaseId: f.confirmed.worldReleaseId!})
  const brief = await draftProductProductionBriefV3({scope: f.scope, worldReleaseId: f.confirmed.worldReleaseId!, suggestionKey: starting.suggestions[0].suggestionKey,
    productType: 'character-interaction', characterChat: f.settings, playerRole: f.settings.playerRole, openingSituation: f.settings.openingSituation, visualLevel, audioLevel})
  expect(brief.media).toMatchObject({visualLevel, audioLevel: 'none', imageCount: visualLevel === 'none' ? 0 : 2})
  const before = structuredClone(brief.productionBudget)
  const plan = await createProductProductionPlanV3({brief, briefHash: await hashProductProductionValueV2(brief), buildNumber: 1})
  expect(plan.tasks.some(task => task.taskKey === 'content.chat-opening-review')).toBe(true)
  expect(brief.productionBudget).toEqual(before)
  expect(plan.tasks.reduce((sum, task) => sum + task.budgetReservation.inputTokens, 0)).toBeLessThanOrEqual(before.maximumInputTokens)
  expect(plan.tasks.reduce((sum, task) => sum + task.budgetReservation.durationMs, 0)).toBeLessThanOrEqual(before.maximumDurationMs)
})

it.each(['missing-public-descriptions', 'unsupported-illustrated-level'] as const)('rejects invalid visual production before assigning an opening budget: %s', async invalid => {
  const f = await seedIllustratedChatBriefFixture(), settings: ChatAuthoringSettingsV3 = structuredClone(f.settings)
  if (invalid === 'missing-public-descriptions') delete settings.visuals
  const starting = await suggestProductStartingPoints({scope: f.scope, worldReleaseId: f.confirmed.worldReleaseId!})
  await expect(draftProductProductionBriefV3({scope: f.scope, worldReleaseId: f.confirmed.worldReleaseId!,
    suggestionKey: starting.suggestions[0].suggestionKey, productType: 'character-interaction', characterChat: settings,
    playerRole: settings.playerRole, openingSituation: settings.openingSituation,
    visualLevel: invalid === 'unsupported-illustrated-level' ? 'illustrated' : 'key-scenes', audioLevel: 'none'}))
    .rejects.toThrow('[chat-visual-intent]')
})
