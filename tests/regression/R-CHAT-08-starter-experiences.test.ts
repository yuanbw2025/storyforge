import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {listChatStarterExperiencesV1, previewChatStarterExperienceV1, createChatStarterDraftV1} from '../../src/lib/character-interaction/starter-experiences'
import {readChatDraftV1, saveChatDraftV1, loadChatSourceProjectionV1} from '../../src/lib/character-interaction/draft-service'
import {parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {deleteWorkspace} from '../../src/lib/workspace/lifecycle'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
it('keeps previews read-only and creates separate editable Works with no source approval or production authority', async () => {
  const catalogue = listChatStarterExperiencesV1()
  expect(catalogue.map(item => item.category)).toEqual(['单角色', '关系发展', '多人调查'])
  for (const item of catalogue) {
    const preview = previewChatStarterExperienceV1(item.id)
    preview.settings.openingSituation = '篡改预览不会改变内置原稿'
    expect(previewChatStarterExperienceV1(item.id).settings.openingSituation).not.toBe(preview.settings.openingSituation)
  }
  expect(await db.projects.count()).toBe(0)
  const allKeys = new Set<string>()
  for (const item of catalogue) {
    const created = await createChatStarterDraftV1(item.id), draft = await readChatDraftV1(created.scope)
    const settings = parseChatAuthoringSettings(JSON.parse(draft.settingsJson))
    expect(settings.version).toBe(3)
    if (settings.version !== 3) throw new Error('expected narrative draft')
    expect(created.work.kind).toBe('character-interaction')
    expect(created.work.title).toBe(item.title)
    expect(draft).toMatchObject({worldReleaseId: null, productionId: null, revision: 0})
    expect(settings).toMatchObject({sourceReview: null, characters: [], qualityProfile: 'prototype'})
    for (const actor of settings.privateCharacters!) {expect(allKeys.has(actor.characterKey)).toBe(false); allKeys.add(actor.characterKey)}
    expect(created.project.productPlatformOptIns?.productProductionV3).not.toBe(true)
    await expect(loadChatSourceProjectionV1(created.scope, 0)).rejects.toThrow('冻结世界')
    await saveChatDraftV1(created.scope, draft.revision, {...settings, openingSituation: '作者可重新决定开场。'})
    expect(JSON.parse((await readChatDraftV1(created.scope)).settingsJson).openingSituation).toBe('作者可重新决定开场。')
  }
  expect(await db.worldReleases.count()).toBe(0)
  expect(await db.productProductions.count()).toBe(0)
  expect(await db.productReleases.count()).toBe(0)
  expect(await db.productRuntimeSessions.count()).toBe(0)
  expect(await db.agentRuns.count()).toBe(0)
  await expect(createChatStarterDraftV1('unknown')).rejects.toThrow('不存在')
  expect(await db.projects.count()).toBe(3)
})

it('preserves an existing author draft, assigns independent cast to repeated starts and restores all private characters after deleting the original Work', async () => {
  const first = await createChatStarterDraftV1('last-ferry'), original = await readChatDraftV1(first.scope)
  const second = await createChatStarterDraftV1('last-ferry'), repeat = await readChatDraftV1(second.scope)
  expect(await readChatDraftV1(first.scope)).toEqual(original)
  const originalSettings = JSON.parse(original.settingsJson), repeatSettings = JSON.parse(repeat.settingsJson)
  expect(originalSettings.privateCharacters.map((actor: {characterKey: string}) => actor.characterKey))
    .not.toEqual(repeatSettings.privateCharacters.map((actor: {characterKey: string}) => actor.characterKey))
  const imported = await importProjectJSON(await exportProjectJSON(first.scope.projectId))
  await deleteWorkspace(first.scope.projectId)
  const restored = (await db.chatAuthoringDrafts.where('projectId').equals(imported).first())!
  expect(JSON.parse(restored.settingsJson)).toEqual(originalSettings)
  expect((await db.works.get(restored.workId))!.title).toBe('末班渡轮的空座')
  expect(await readChatDraftV1(second.scope)).toEqual(repeat)
}, 30_000)
