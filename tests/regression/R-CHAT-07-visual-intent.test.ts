import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {DEFAULT_CHAT_SETTINGS_V3, parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {compileChatVisualIntentV1, createChatVisualRequirementsV1, parseChatVisualIntentV1, type ChatVisualIntentV1} from '../../src/lib/character-interaction/visual-intent'
import {createChatDraftV3, readChatDraftV1, saveChatDraftV1} from '../../src/lib/character-interaction/draft-service'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatNarrativeFixture} from '../helpers/chat-narrative-fixture'
import {seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'
import {validateChatNarrativeProductionSourceV1} from '../../src/lib/character-interaction/narrative-production'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
function fixture() {
  const content = chatNarrativeFixture()
  const intent: ChatVisualIntentV1 = {version: 1, characters: [{characterKey: content.profiles[0].characterKey, description: '灰色短发，深蓝布衣。'}], openingBackground: '雨夜的空驿站，木桌上燃着一盏油灯。'}
  return {content, intent}
}

it('keeps historical settings byte-for-byte and rejects unknown fields and legacy visual extensions', () => {
  expect(JSON.stringify(parseChatAuthoringSettings(DEFAULT_CHAT_SETTINGS_V3))).toBe(JSON.stringify(DEFAULT_CHAT_SETTINGS_V3))
  const {intent} = fixture()
  expect(parseChatAuthoringSettings({...DEFAULT_CHAT_SETTINGS_V3, visuals: intent})).toEqual({...DEFAULT_CHAT_SETTINGS_V3, visuals: intent})
  expect(() => parseChatAuthoringSettings({...DEFAULT_CHAT_SETTINGS_V3, version: 2, visuals: intent})).toThrow()
  for (const invalid of [{...intent, hiddenPrompt: 'secret'}, {...intent, version: 2}, {...intent, characters: [...intent.characters, ...intent.characters]},
    {...intent, characters: [{...intent.characters[0], description: ' '.repeat(5)}]}, {...intent, openingBackground: '长'.repeat(4001)}]) {
    expect(() => parseChatVisualIntentV1(invalid)).toThrow()
  }
})

it('projects only explicit picture descriptions and exact IDs, never private or future story material', () => {
  const {content, intent} = fixture(), before = JSON.stringify(content)
  const projected = compileChatVisualIntentV1(intent, content)
  expect(projected).toEqual({characters: [{...intent.characters[0], participantKey: content.profiles[0].participantKey}], openingBackground: {
    sceneKey: content.chatNarrative!.initialSituation.sceneKey, location: content.chatNarrative!.initialSituation.location, description: intent.openingBackground,
  }})
  const changed = structuredClone(content)
  changed.chatNarrative!.initialSituation.goals.forEach(goal => {goal.desire = '只有角色知道的未来计划'})
  changed.profiles[0].voiceRules = '只有作者知道的秘密口吻'
  expect(compileChatVisualIntentV1(intent, changed)).toEqual(projected)
  expect(JSON.stringify(projected)).not.toContain('秘密')
  expect(JSON.stringify(content)).toBe(before)
  intent.characters[0].description = '后来改写的描述'
  expect(projected.characters[0].description).toBe('灰色短发，深蓝布衣。')
})

it('retains stale draft descriptions but rejects production with a missing role, ambiguous role or mismatched opening', () => {
  const {content, intent} = fixture()
  const stale = {...intent, characters: [{characterKey: 'old.world.character', description: '作者需要找回的旧外观'}]}
  expect(parseChatVisualIntentV1(stale)).toEqual(stale)
  expect(() => compileChatVisualIntentV1(stale, content)).toThrow('不属于当前聊天')
  const duplicate = structuredClone(content); duplicate.profiles.push({...duplicate.profiles[0], participantKey: 'duplicate'})
  expect(() => compileChatVisualIntentV1(intent, duplicate)).toThrow('不属于当前聊天')
  const moved = structuredClone(content); moved.chatNarrative!.initialSituation.location = '别处'
  expect(() => compileChatVisualIntentV1(intent, moved)).toThrow('已选定')
  expect(compileChatVisualIntentV1({version: 1, characters: [], openingBackground: ''}, content)).toEqual({characters: [], openingBackground: null})
})

it('saves, refreshes and transfers explicit draft pictures through the existing Work lifecycle', async () => {
  const {intent} = fixture(), created = await createChatDraftV3('画面草稿')
  const saved = await saveChatDraftV1(created.scope, 0, {...DEFAULT_CHAT_SETTINGS_V3, visuals: intent})
  db.close(); await db.open()
  expect((await readChatDraftV1(created.scope)).settingsJson).toBe(saved.settingsJson)
  const imported = await importProjectJSON(await exportProjectJSON(created.scope.projectId))
  const copy = (await db.chatAuthoringDrafts.where('projectId').equals(imported).first())!
  expect(copy.settingsJson).toBe(saved.settingsJson)
  expect(await db.productProductions.count()).toBe(0)
  expect(await db.mediaBlobObjects.count()).toBe(0)
})

it('makes an exact media request from public author text without sending role secrets, names or location prose', () => {
  const {content, intent} = fixture()
  const requirements = createChatVisualRequirementsV1(intent, content, 'opening-beat')
  expect(requirements.visual.map(row => row.artifactKey)).toEqual(['media.visual.001', 'media.visual.002'])
  expect(requirements.visual.map(row => row.prompt)).toEqual([intent.characters[0].description, intent.openingBackground])
  expect(requirements.visual[0].characterAnchorRefs).toEqual([content.profiles[0].characterKey])
  expect(requirements.visual[1].characterAnchorRefs).toEqual([])
  expect(requirements.audio).toEqual([])
  const changed = structuredClone(content)
  changed.profiles[0].name = '不应发给图片服务的名字'
  changed.chatNarrative!.initialSituation.facts[0].text = '不应发给图片服务的剧情'
  changed.chatNarrative!.initialSituation.location = changed.sceneTemplates[0].location = '不应发给图片服务的地点正文'
  expect(createChatVisualRequirementsV1(intent, changed, 'opening-beat')).toEqual(requirements)
  expect(createChatVisualRequirementsV1({...intent, characters: []}, content, 'opening-beat').visual).toHaveLength(1)
  expect(createChatVisualRequirementsV1({...intent, openingBackground: ''}, content, 'opening-beat').visual).toHaveLength(1)
  expect(() => createChatVisualRequirementsV1(intent, content, '')).toThrow('导航')
})

it('rejects picture drafts at the narrative model source boundary while preserving the existing story source', async () => {
  const f = await seedChatNarrativeProductionFixture(), {intent} = fixture()
  expect(() => validateChatNarrativeProductionSourceV1(f.source)).not.toThrow()
  expect(() => validateChatNarrativeProductionSourceV1({...f.source, settings: {...f.source.settings, visuals: intent}})).toThrow('画面草稿')
  expect(f.source.settings.visuals).toBeUndefined()
})
