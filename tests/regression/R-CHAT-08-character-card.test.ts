import {CONTEXT_SOURCES} from '../../src/lib/registry/context-sources'
import {beforeEach, afterEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {previewChatCharacterCardV2, confirmChatCharacterCardPreviewV1} from '../../src/lib/character-interaction/character-card'
import {parseChatPrivateCharactersV1} from '../../src/lib/character-interaction/private-character'
import {saveChatDraftV1, loadChatSourceProjectionV1, readChatDraftV1} from '../../src/lib/character-interaction/draft-service'
import {readChatSourceReviewContextV1} from '../../src/lib/character-interaction/source-review-context'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {deleteWorkspace} from '../../src/lib/workspace/lifecycle'
import {seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'
import {chatCharacterCardFixture} from '../helpers/chat-character-card-fixture'
import {CHAT_CARD_PNG_FIXTURE} from '../helpers/chat-character-card-png-fixture'
import {parseChatCharacterCardCreditsV1} from '../../src/lib/character-interaction/card-credits'
import {compileInteractionModulesV1} from '../../src/lib/product-production/product-module-compilers'
import {selectChatNarrativeCandidateV1, chatNarrativeShellV1} from '../../src/lib/character-interaction/narrative-production'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer
const preview = (value = chatCharacterCardFixture()) => previewChatCharacterCardV2({bytes: bytes(value), fileName: '角色.json'})
beforeEach(async () => {await db.delete(); await db.open()})
afterEach(() => db.close())

it('previews exact mappings without saving, rejects altered previews, and creates fresh private identities only after confirmation', async () => {
  const p = await preview(), original = structuredClone(p)
  expect(await db.chatAuthoringDrafts.count()).toBe(0)
  expect(p.origin.unsupportedFields).toEqual(['/data/alternate_greetings', '/data/character_book', '/data/extensions', '/data/first_mes', '/data/post_history_instructions', '/data/scenario', '/data/system_prompt', '/data/tags'])
  const actor = confirmChatCharacterCardPreviewV1(p, '本体验的修灯人')
  expect(actor).toMatchObject({name: '桥灯', background: chatCharacterCardFixture().data.description, identity: '本体验的修灯人', cardOrigin: p.origin})
  expect(actor.characterKey).not.toBe(confirmChatCharacterCardPreviewV1(p, '修灯人').characterKey)
  expect(JSON.stringify(actor)).not.toMatch(/CARD_SYSTEM|CARD_HISTORY|CARD_BOOK|CARD_EXTENSION/)
  expect(() => confirmChatCharacterCardPreviewV1(p, '')).toThrow()
  p.background += '变更'
  expect(() => confirmChatCharacterCardPreviewV1(p, '修灯人')).toThrow('预览已变化')
  expect(() => confirmChatCharacterCardPreviewV1(original, '修灯人')).toThrow('预览已变化')
})

it('reads a standard PNG text chunk without adopting its picture and rejects damaged or ambiguous bytes', async () => {
  const png = Uint8Array.from(atob(CHAT_CARD_PNG_FIXTURE), c => c.charCodeAt(0))
  const p = await previewChatCharacterCardV2({bytes: png.buffer, fileName: '角色.png'})
  expect(p).toMatchObject({name: '桥灯', origin: {format: 'png'}})
  expect(await db.mediaBlobObjects.count()).toBe(0)
  const chunkLength = new DataView(png.buffer).getUint32(33) + 12
  const duplicate = new Uint8Array(png.length + chunkLength)
  duplicate.set(png.subarray(0, 33), 0); duplicate.set(png.subarray(33, 33 + chunkLength), 33); duplicate.set(png.subarray(33), 33 + chunkLength)
  await expect(previewChatCharacterCardV2({bytes: duplicate.buffer, fileName: 'duplicate.png'})).rejects.toThrow('多份角色卡')
  png[45] ^= 1
  await expect(previewChatCharacterCardV2({bytes: png.buffer, fileName: 'bad.png'})).rejects.toThrow('校验失败')
  await expect(previewChatCharacterCardV2({bytes: png.slice(0, 32).buffer, fileName: 'short.png'})).rejects.toThrow()
})

it('rejects unknown versions, invalid required fields, oversized input and unsupported metadata shapes without truncation', async () => {
  const valid = chatCharacterCardFixture()
  for (const bad of [
    {...valid, spec_version: '3.0'}, {...valid, data: {...valid.data, name: ''}},
    {...valid, data: {...valid.data, description: 'x'.repeat(16001)}},
    {...valid, data: {...valid.data, extensions: 'script'}}, {...valid, data: {...valid.data, tags: [1]}},
    {...valid, data: {...valid.data, creator: null}}, {...valid, data: {...valid.data, character_book: []}},
  ]) await expect(previewChatCharacterCardV2({bytes: bytes(bad), fileName: 'card.json'})).rejects.toThrow()
  await expect(previewChatCharacterCardV2({bytes: new ArrayBuffer(16 * 1024 * 1024 + 1), fileName: 'large.png'})).rejects.toThrow()
  await expect(previewChatCharacterCardV2({bytes: new Uint8Array([0xff]).buffer, fileName: 'bad.json'})).rejects.toThrow('UTF-8')
  const actor = confirmChatCharacterCardPreviewV1(await preview(), '修灯人')
  expect(() => parseChatPrivateCharactersV1([{...actor, cardOrigin: {...actor.cardOrigin, contentHash: 'unverified'}}])).toThrow()
})

it('keeps attribution through Work backup and removal, excludes it from registered AI source fragments, and leaves the world untouched', async () => {
  const f = await seedChatNarrativeProductionFixture({privateCast: 'only'}), world = await db.worldReleases.toArray()
  const actor = confirmChatCharacterCardPreviewV1(await preview(), '修灯人')
  const saved = await saveChatDraftV1(f.scope, f.confirmed.revision, {...f.settings, privateCharacters: [actor]})
  expect(JSON.parse(saved.settingsJson).sourceReview).toBeNull()
  const projection = await loadChatSourceProjectionV1(f.scope, saved.revision)
  expect(projection.characters[0]).toMatchObject({origin: 'product-private', resourceKey: actor.characterKey})
  const context = await readChatSourceReviewContextV1(f.scope, {draftRevision: saved.revision, projectionHash: projection.projectionHash,
    fragmentKeys: projection.characters[0].fragments.map(fragment => fragment.fragmentKey)})
  expect(JSON.stringify(context)).toContain('修灯人')
  expect(JSON.stringify(context)).not.toMatch(/CARD_CREATOR|CARD_NOTES|CARD_SYSTEM|CARD_HISTORY|CARD_BOOK|CARD_EXTENSION|cardOrigin/)
  const authorContext = await CONTEXT_SOURCES.find(source => source.key === 'chat.authoring')!.read({projectId: f.scope.projectId, scope: f.scope})
  expect(authorContext).not.toMatch(/CARD_CREATOR|CARD_NOTES|cardOrigin/)
  expect(JSON.parse((await readChatDraftV1(f.scope)).settingsJson).privateCharacters[0].cardOrigin).toEqual(actor.cardOrigin)
  const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const copy = (await db.chatAuthoringDrafts.where('projectId').equals(importedId).first())!
  expect(JSON.parse(copy.settingsJson).privateCharacters).toEqual([actor])
  const importedScope = {projectId: importedId, worldId: copy.worldId, workId: copy.workId}
  expect((await loadChatSourceProjectionV1(importedScope, copy.revision)).projectionHash).toBe(projection.projectionHash)
  expect((await db.worldReleases.toArray()).filter(row => world.some(old => old.id === row.id))).toEqual(world)
  await deleteWorkspace(importedId)
  expect(await db.chatAuthoringDrafts.where('projectId').equals(importedId).count()).toBe(0)
  expect(JSON.parse((await readChatDraftV1(f.scope)).settingsJson).privateCharacters).toEqual([actor])
})

it('binds public release credits to the confirmed private character source without publishing creator notes', async () => {
  const origin = (await preview()).origin, f = await seedChatNarrativeProductionFixture({privateCast: 'only', cardOrigin: origin})
  const content = await selectChatNarrativeCandidateV1({source: f.source, candidates: f.candidates, selection: {
    schema: 'storyforge.chat-situation-selection', version: 1, candidatesHash: await hashProductProductionValueV2(f.candidates),
    sourceHash: await hashProductProductionValueV2(f.source), selectedOptionKey: 'option-1', authorCommandId: 'card-credits.choose'}})
  const interaction = compileInteractionModulesV1({brief: f.brief, sourceCatalog: f.sourceCatalog, narrative: chatNarrativeShellV1(content), chatNarrative: content})
  const credits = interaction.chatCardCredits!
  expect(parseChatCharacterCardCreditsV1(credits, interaction)).toEqual(credits)
  expect(credits.characters[0]).toMatchObject({cardContentHash: origin.contentHash, creator: origin.creator})
  expect(JSON.stringify(interaction)).not.toContain(origin.creatorNotes)
  expect(JSON.stringify(interaction.chatSource)).not.toContain(origin.creator)
  for (const patch of [{participantKey: 'player'}, {characterKey: 'world:invented'}, {sourceHash: 'f'.repeat(64)}, {creatorNotes: origin.creatorNotes}]) {
    expect(() => parseChatCharacterCardCreditsV1({...credits, characters: [{...credits.characters[0], ...patch}]}, interaction)).toThrow()
  }
  expect(() => parseChatCharacterCardCreditsV1({...credits, characters: [credits.characters[0], credits.characters[0]]}, interaction)).toThrow()
})
