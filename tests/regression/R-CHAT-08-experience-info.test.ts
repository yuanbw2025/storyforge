import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {parseChatExperienceInfoV1} from '../../src/lib/character-interaction/experience-info'
import {DEFAULT_CHAT_SETTINGS_V3, parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {assertChatPlanAdoptionV1, applyChatPlanChangesV1} from '../../src/lib/character-interaction/consultation-plan'
import {readChatConsultationContextV2} from '../../src/lib/character-interaction/consultation-context'
import {saveChatDraftV1, createChatDraftV3} from '../../src/lib/character-interaction/draft-service'
import {validateChatNarrativeProductionSourceV1, selectChatNarrativeCandidateV1, chatNarrativeShellV1} from '../../src/lib/character-interaction/narrative-production'
import {CONTEXT_SOURCES} from '../../src/lib/registry/context-sources'
import {executeProductProductionCommand} from '../../src/lib/product-production/commands'
import {readProductProductionBriefContext} from '../../src/lib/product-production/context'
import {compileInteractionModulesV1} from '../../src/lib/product-production/product-module-compilers'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {parseProductRuntimePackageV1} from '../../src/lib/product-production/runtime-package'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {deleteWorkspace} from '../../src/lib/workspace/lifecycle'
import {previewChatExperiencePackageV1, installChatExperiencePackageV1, exportChatExperiencePackageV1} from '../../src/lib/character-interaction/experience-package'
import {seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'
import {seedChatExperiencePackageFixture} from '../helpers/chat-experience-package-fixture'
import {seedChatMediaConfirmationFixture} from '../helpers/chat-media-production-fixture'

const info = {version: 1 as const, author: 'NOTICE_AUTHOR', attribution: 'NOTICE_CREDIT', usageTerms: 'NOTICE_TERMS: 工程样本，无对外分发授权'}
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

it('keeps old drafts unchanged, rejects incomplete or unknown declarations and denies AI alteration through the governed plan guard', () => {
  expect(parseChatAuthoringSettings(DEFAULT_CHAT_SETTINGS_V3)).not.toHaveProperty('experienceInfo')
  const settings = {...structuredClone(DEFAULT_CHAT_SETTINGS_V3), experienceInfo: info}
  expect(parseChatAuthoringSettings(settings)).toEqual(settings)
  for (const bad of [null, {...info, version: 2}, {...info, author: ' '}, {...info, usageTerms: ''}, {...info, attribution: 1},
    {...info, author: 'x'.repeat(201)}, {...info, usageTerms: 'x'.repeat(8001)}, {...info, verifiedByPlatform: true}]) {
    expect(() => parseChatExperienceInfoV1(bad)).toThrow()
  }
  const edited = applyChatPlanChangesV1(settings, [{field: 'experience', value: '尊重拒绝后继续处理自己的工作'}])
  expect(() => assertChatPlanAdoptionV1(settings, edited)).not.toThrow()
  expect(() => assertChatPlanAdoptionV1(settings, {...settings, experienceInfo: {...info, usageTerms: '伪造授权'}})).toThrow()
  const {experienceInfo: _info, ...removed} = settings
  expect(() => assertChatPlanAdoptionV1(settings, removed)).toThrow()
  expect(() => assertChatPlanAdoptionV1(removed, settings)).toThrow()
})

it('freezes author statements without exposing them to registered author, production or story-source readers; preserves them in Work backup', async () => {
  const f = await seedChatNarrativeProductionFixture({privateCast: 'only', experienceInfo: info})
  const world = (await db.worldReleases.get(f.world.release.id!))!
  const author = await CONTEXT_SOURCES.find(source => source.key === 'chat.authoring')!.read({projectId: f.scope.projectId, scope: f.scope})
  const discussion = await readChatConsultationContextV2(f.scope, {draftRevision: f.confirmed.revision, question: '让角色自主行动', source: null, priorRunId: null})
  for (const material of [author, JSON.stringify(discussion), JSON.stringify(f.source)]) expect(material).not.toMatch(/NOTICE_|experienceInfo/)
  expect(() => validateChatNarrativeProductionSourceV1({...f.source, settings: {...f.source.settings, experienceInfo: info}})).toThrow('作品署名')
  const created = await executeProductProductionCommand({scope: f.scope, command: {type: 'create-intent', commandId: 'notice.create',
    productionKey: 'chat.notice-fixture', productType: 'character-interaction', worldReleaseId: f.confirmed.worldReleaseId!, userText: '发行说明工程验证'}})
  if (!created.ok) throw new Error('create-intent failed')
  const productionId = created.productionId
  const saved = await executeProductProductionCommand({scope: f.scope, productionId, command: {type: 'save-brief-revision',
    commandId: 'notice.brief', expectedStateRevision: 0, parentRevision: null, brief: f.brief}})
  if (!saved.ok) throw new Error('save-brief failed')
  const started = await executeProductProductionCommand({scope: f.scope, productionId, command: {type: 'authorize-start', commandId: 'notice.start',
    expectedStateRevision: 1, briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'engineering-fixture-author'}})
  expect(started.ok).toBe(true)
  expect(await readProductProductionBriefContext({scope: f.scope, projectId: f.scope.projectId, productProductionId: productionId})).not.toMatch(/NOTICE_|experienceInfo/)
  const storedBrief = (await db.productProductionBriefs.where('productionId').equals(productionId).first())!
  expect(JSON.parse(storedBrief.briefJson).characterChat.experienceInfo).toEqual(info)
  const content = await selectChatNarrativeCandidateV1({source: f.source, candidates: f.candidates, selection: {
    schema: 'storyforge.chat-situation-selection', version: 1, candidatesHash: await hashProductProductionValueV2(f.candidates),
    sourceHash: await hashProductProductionValueV2(f.source), selectedOptionKey: 'option-1', authorCommandId: 'notice.choose'}})
  const compiled = compileInteractionModulesV1({brief: f.brief, sourceCatalog: f.sourceCatalog, narrative: chatNarrativeShellV1(content), chatNarrative: content})
  expect(compiled.chatExperienceInfo).toEqual(info)
  expect(JSON.stringify(compiled.chatSource) + JSON.stringify(compiled.profiles) + JSON.stringify(compiled.chatNarrative)).not.toMatch(/NOTICE_/)
  const changed = await saveChatDraftV1(f.scope, f.confirmed.revision, {...f.settings, experienceInfo: {...info, author: '新署名'}})
  expect(JSON.parse(changed.settingsJson).sourceReview).toEqual(f.settings.sourceReview)
  expect(compiled.chatExperienceInfo).toEqual(info)
  const copyId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const copy = (await db.chatAuthoringDrafts.where('projectId').equals(copyId).first())!
  expect(JSON.parse(copy.settingsJson).experienceInfo.author).toBe('新署名')
  await deleteWorkspace(copyId)
  expect(await db.chatAuthoringDrafts.where('projectId').equals(copyId).count()).toBe(0)
  expect(await db.worldReleases.get(world.id!)).toEqual(world)
}, 30_000)

it('installs and re-exports exact frozen statements without the author workspace and rejects malformed runtime declarations', async () => {
  const f = await seedChatExperiencePackageFixture({experienceInfo: info}), target = await createChatDraftV3('无作者工作区的体验')
  const preview = await previewChatExperiencePackageV1({scope: target.scope, bytes: new TextEncoder().encode(JSON.stringify(f.illustrated)).buffer})
  expect(preview.summary.experienceInfo).toEqual(info)
  const installed = await installChatExperiencePackageV1(preview)
  await deleteWorkspace(f.sourceScope.projectId)
  expect(await exportChatExperiencePackageV1({scope: target.scope, productReleaseId: installed.id!})).toEqual(f.illustrated)
  const restoredId = await importProjectJSON(await exportProjectJSON(target.scope.projectId))
  const restored = (await db.productReleases.where('projectId').equals(restoredId).first())!
  expect(JSON.parse(restored.manifestJson).runtimePackage.interaction.chatExperienceInfo).toEqual(info)
  const bad = structuredClone(f.illustrated.productRelease.manifest.runtimePackage)
  bad.interaction!.chatExperienceInfo!.version = 2 as never
  expect(() => parseProductRuntimePackageV1(bad)).toThrow('作品署名')
  expect(await db.agentRuns.where('workId').equals(target.scope.workId).count()).toBe(0)
}, 30_000)

it('keeps publication metadata out of the actual deterministic design and injected production model requests', async () => {
  const f = await seedChatMediaConfirmationFixture(info)
  expect(f.textRequests).toHaveLength(2)
  expect(f.textRequests.join('\n')).not.toMatch(/NOTICE_|experienceInfo/)
  const design = (await db.productBuildArtifacts.where('buildId').equals(f.buildId).filter(row => row.artifactKey === 'design.game').last())!
  expect(design.payloadJson).not.toMatch(/NOTICE_|experienceInfo/)
  const brief = (await db.productProductionBriefs.where('productionId').equals(f.productionId).first())!
  expect(JSON.parse(brief.briefJson).characterChat.experienceInfo).toEqual(info)
}, 30_000)
