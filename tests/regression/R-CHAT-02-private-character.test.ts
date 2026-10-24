import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {createChatPrivateCharacterV1, parseChatPrivateCharactersV1} from '../../src/lib/character-interaction/private-character'
import {parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {loadChatSourceProjectionV1, readChatDraftV1, saveChatDraftV1, selectChatWorldV1} from '../../src/lib/character-interaction/draft-service'
import {readChatSourceProjectionViewV1} from '../../src/lib/character-interaction/source-projection'
import {readChatSourceReviewContextV1} from '../../src/lib/character-interaction/source-review-context'
import {generateChatConsultationV2} from '../../src/lib/character-interaction/consultation-harness'
import {compileInteractionModulesV1, prepareChatNarrativeCompilerSourceV1} from '../../src/lib/product-production/product-module-compilers'
import {parseFrozenChatSourceV1} from '../../src/lib/character-interaction/runtime'
import {chatNarrativeShellV1, selectChatNarrativeCandidateV1, validateChatNarrativeProductionSourceV1} from '../../src/lib/character-interaction/narrative-production'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'
import {seedCurrentProductWorld} from '../helpers/current-product-world'
import {loadProductProductionWorldSourceCatalogV2} from '../../src/lib/product-production/world-source'
import {confirmChatRoleProfileV1, readChatRoleProfilesV1} from '../../src/lib/character-interaction/role-profile-store'
import {validateChatRoleProfilesForSourceV1} from '../../src/lib/character-interaction/role-profile'
import {deleteWorkspace} from '../../src/lib/workspace/lifecycle'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

it('requires separate portable identities, bounded content and a combined cast limit', async () => {
  const f = await seedChatNarrativeProductionFixture({privateCast: 'only'}), own = f.settings.privateCharacters![0]
  expect(parseChatPrivateCharactersV1([own])).toEqual([own])
  expect(createChatPrivateCharacterV1().characterKey).not.toBe(own.characterKey)
  for (const invalid of [[own, own], [{...own, characterKey: f.sourceCatalog.characters[0]?.resourceKey ?? 'world-release:character:1'}], [{...own, name: ''}], [{...own, identity: ''}], [{...own, background: 'x'.repeat(16001)}], [{...own, worldId: 1}]]) expect(() => parseChatPrivateCharactersV1(invalid)).toThrow()
  expect(() => parseChatAuthoringSettings({...f.settings, characters: [{sourceKey: own.characterKey, voiceRules: '', privateKnowledge: '', initialTrust: 0}]})).toThrow('伪装')
  expect(() => parseChatAuthoringSettings({...f.settings, narrative: {...f.settings.narrative, playerCharacterKey: own.characterKey}})).toThrow('伪装')
  expect(() => parseChatAuthoringSettings({...f.settings, characters: Array.from({length: 8}, (_, i) => ({sourceKey: `world-character-${i}`, voiceRules: '', privateKnowledge: '', initialTrust: 0}))})).toThrow('合计')
  expect(() => parseChatAuthoringSettings({...f.settings, version: 2})).toThrow()
  await expect(loadProductProductionWorldSourceCatalogV2({scope: f.scope, worldReleaseId: f.confirmed.worldReleaseId!,
    selection: {...f.brief.source.selection, productType: 'avg'}, chatPrivateCharacters: [own]})).rejects.toThrow('仅属于角色聊天')
  expect(f.brief.source.selection.resourceKeys).not.toContain(own.characterKey)
  expect(Object.values(f.brief.source.selection.roleBindings).flat()).not.toContain(own.characterKey)
})

it('preserves private ownership and stable IDs through import and world reselection, but resets source consent', async () => {
  const f = await seedChatNarrativeProductionFixture({privateCast: 'only'}), before = await db.worldReleases.toArray()
  const exported = await exportProjectJSON(f.scope.projectId), projectId = await importProjectJSON(exported)
  const draft = (await db.chatAuthoringDrafts.where('projectId').equals(projectId).first())!
  const scope = {projectId, worldId: draft.worldId, workId: draft.workId}
  const projection = await loadChatSourceProjectionV1(scope, draft.revision)
  expect(projection.projectionHash).toBe(f.settings.sourceReview!.projectionHash)
  expect(projection.characters[0].origin).toBe('product-private')
  expect(JSON.parse(draft.settingsJson).privateCharacters).toEqual(f.settings.privateCharacters)
  expect((await db.worldReleases.toArray()).filter(w => before.some(b => b.id === w.id))).toEqual(before)
  const other = await seedCurrentProductWorld('another world')
  const changed = await selectChatWorldV1(scope, draft.revision, other.release.id!)
  expect(JSON.parse(changed.settingsJson)).toMatchObject({privateCharacters: f.settings.privateCharacters, characters: [], sourceReview: null})
  expect((await readChatDraftV1(f.scope)).settingsJson).toBe(f.confirmed.settingsJson)
  await deleteWorkspace(projectId)
  expect(await db.chatAuthoringDrafts.where('projectId').equals(projectId).count()).toBe(0)
  expect((await readChatDraftV1(f.scope)).settingsJson).toBe(f.confirmed.settingsJson)
})

it('adopts a private character interpretation through existing governance and rejects it after source edits', async () => {
  const f = await seedChatNarrativeProductionFixture({privateCast: 'mixed'}), draft = f.sourceCatalog.chatSourceProjection!
  const actorKey = f.settings.privateCharacters![0].characterKey, actor = draft.characters.find(row => row.resourceKey === actorKey)!
  const fragment = actor.fragments.find(row => row.pointer === '/background')!
  const saved = await confirmChatRoleProfileV1(f.scope, {draftRevision: f.confirmed.revision, projectionHash: draft.projectionHash, fragmentKeys: [fragment.fragmentKey], actorKey},
    {traits: [{kind: 'goal', text: '苏禾希望修好旧钟，并愿意自主检查工具。', evidence: [{fragmentKey: fragment.fragmentKey, quote: '希望修好旧钟，愿意自己检查工具。'}]}]})
  const profiles = (await readChatRoleProfilesV1(f.scope))!
  const brief = {...f.brief, characterChatProfiles: profiles}
  const prepared = prepareChatNarrativeCompilerSourceV1({brief, sourceCatalog: f.sourceCatalog})
  expect(prepared.roleProfiles[prepared.characterKeys.indexOf(actorKey)]).toContain('苏禾希望修好旧钟')
  const content = await selectChatNarrativeCandidateV1({source: f.source, candidates: f.candidates, selection: {schema: 'storyforge.chat-situation-selection', version: 1,
    candidatesHash: await hashProductProductionValueV2(f.candidates), sourceHash: await hashProductProductionValueV2(f.source), selectedOptionKey: 'option-1', authorCommandId: 'private-profile.choose'}})
  const compiled = compileInteractionModulesV1({brief, sourceCatalog: f.sourceCatalog, narrative: chatNarrativeShellV1(content), chatNarrative: content})
  expect(compiled.profiles.find(p => p.characterKey === actorKey)!.voiceRules).toContain('苏禾希望修好旧钟')
  expect(compiled.profiles.filter(p => p.characterKey !== actorKey).map(p => p.voiceRules).join('')).not.toContain('苏禾希望修好旧钟')
  const changed = await saveChatDraftV1(f.scope, saved.revision, {...f.settings, privateCharacters: f.settings.privateCharacters!.map(row => ({...row, background: '今天先休息。'}))})
  const next = await loadChatSourceProjectionV1(f.scope, changed.revision)
  expect(() => validateChatRoleProfilesForSourceV1(profiles, next, f.settings.sourceReview!)).toThrow()
  expect(await readChatRoleProfilesV1(f.scope)).toEqual(profiles)
})

it('invalidates all prior consent when authored text changes and rejects stale or cross-work edits', async () => {
  const f = await seedChatNarrativeProductionFixture({privateCast: 'only'}), old = f.sourceCatalog.chatSourceProjection!
  const changed = await saveChatDraftV1(f.scope, f.confirmed.revision, {...f.settings, privateCharacters: f.settings.privateCharacters!.map(c => ({...c, background: '改写后的新经历。'}))})
  const settings = JSON.parse(changed.settingsJson)
  expect(settings.sourceReview).toBeNull()
  expect(settings.privateCharacters[0].characterKey).toBe(f.settings.privateCharacters![0].characterKey)
  expect((await loadChatSourceProjectionV1(f.scope, changed.revision)).projectionHash).not.toBe(old.projectionHash)
  await expect(saveChatDraftV1(f.scope, f.confirmed.revision, f.settings)).rejects.toThrow('其他页面')
  await expect(saveChatDraftV1({...f.scope, workId: 999}, changed.revision, settings)).rejects.toThrow()
  expect(() => prepareChatNarrativeCompilerSourceV1({brief: {...f.brief, characterChat: settings}, sourceCatalog: f.sourceCatalog})).toThrow()
})

it('keeps author-only private prose out of actor/player/production views and reads selected known private evidence through the registry reader', async () => {
  const f = await seedChatNarrativeProductionFixture({privateCast: 'only'}), draft = f.sourceCatalog.chatSourceProjection!, actorKey = f.settings.privateCharacters![0].characterKey
  const body = draft.characters[0].fragments.find(row => row.pointer === '/background')!, hidden = draft.characters[0].fragments.find(row => row.pointer === '/voice')!
  const input = {scope: f.scope, request: {draftRevision: f.confirmed.revision, projectionHash: draft.projectionHash, fragmentKeys: [body.fragmentKey], actorKey}}
  const context = await readChatSourceReviewContextV1(input.scope, input.request)
  expect(context.fragments[0]).toMatchObject({origin: 'product-private', resourceKey: actorKey, knownPurpose: 'motivation'})
  expect(JSON.stringify(context)).not.toContain('仅作者掌握的私域结局')
  await expect(readChatSourceReviewContextV1(f.scope, {...input.request, fragmentKeys: [hidden.fragmentKey]})).rejects.toThrow('尚未获准')
  const player = await readChatSourceProjectionViewV1({draft, classifications: f.settings.sourceReview!.classifications, viewerKey: 'player'})
  expect(JSON.stringify(player)).not.toContain('自己检查工具')
  expect(JSON.stringify(f.source)).not.toContain('仅作者掌握的私域结局')
  expect(f.source.settings.privateCharacters).toBeUndefined()
  expect(() => validateChatNarrativeProductionSourceV1({...f.source, settings: f.settings})).toThrow('未分类')
})

it('does not let S2 consultation replace authored identities, while preserving untouched private cast', async () => {
  const f = await seedChatNarrativeProductionFixture({privateCast: 'only'})
  const request = {draftRevision: f.confirmed.revision, question: '讨论开场', source: null, priorRunId: null}
  const rejected = await generateChatConsultationV2({scope: f.scope, request, runAI: async () => JSON.stringify({answer: '换掉人物', changes: [{field: 'privateCharacters', value: [], reason: '替换', basis: 'proposal', evidence: []}]})})
  expect(rejected.status).toBe('blocked')
  const candidate = await generateChatConsultationV2({scope: f.scope, request, runAI: async () => JSON.stringify({answer: '保留资料', changes: []})})
  expect(candidate.status).toBe('ready')
  expect(JSON.parse((await readChatDraftV1(f.scope)).settingsJson)).toEqual(f.settings)
})

it('rejects private source impersonation, missing provenance, mismatched hashes and a mutated prepared source', async () => {
  const f = await seedChatNarrativeProductionFixture({privateCast: 'only'}), content = f.source.source, participants = f.source.participants.map(p => p.participantKey), characters = f.source.participants.map(p => p.characterKey)
  expect(parseFrozenChatSourceV1(content, participants, characters)).toEqual(content)
  const mismatched = structuredClone(content); mismatched.privateCharacterSources![0].sourceHash = 'f'.repeat(64)
  expect(() => parseFrozenChatSourceV1(mismatched, participants, characters)).toThrow('来源证据')
  const duplicate = structuredClone(content); duplicate.privateCharacterSources!.push(duplicate.privateCharacterSources![0])
  expect(() => parseFrozenChatSourceV1(duplicate, participants, characters)).toThrow('身份')
  const foreign = structuredClone(content); foreign.privateCharacterSources![0].resourceKey = 'world-release:character:1'
  expect(() => parseFrozenChatSourceV1(foreign, participants, characters)).toThrow('身份')
  const {privateCharacterSources: _private, ...legacy} = content
  expect(() => parseFrozenChatSourceV1({...legacy, version: 4}, participants, characters)).toThrow('独立来源')
  f.sourceCatalog.chatSourceProjection!.characters[0].fragments[0].valueJson = '"不经确认的篡改"'
  expect(() => prepareChatNarrativeCompilerSourceV1({brief: f.brief, sourceCatalog: f.sourceCatalog})).toThrow('已核验')
})
