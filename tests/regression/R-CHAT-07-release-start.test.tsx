import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {createElement, act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {db} from '../../src/lib/db/schema'
import {useCharacterInteractionPlayerStore as store} from '../../src/stores/character-interaction-player'
import {chatReleasePreviewV1, resolveChatOpeningSceneV1} from '../../src/lib/character-interaction/release-preview'
import ReleaseStartCard from '../../src/components/character-interaction/ReleaseStartCard'
import {seedChatLibraryFixture} from '../helpers/chat-library-fixture'
import * as harness from '../../src/lib/character-interaction/harness'

let host: HTMLDivElement, root: Root
beforeEach(async () => {
  db.close(); await db.delete(); await db.open()
  store.setState({busy: false, generatingRunId: null, scope: null, selectedSessionId: null})
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close()})
async function library() {
  const f = await seedChatLibraryFixture()
  await store.getState().load(f.scope, null)
  return {f, item: store.getState().releases[0]}
}

it('displays external card attribution as release information without replacing the player opening', async () => {
  const {item} = await library(), manifest = structuredClone(item.manifest!), profile = manifest.interaction.profiles[0]
  manifest.interaction.chatCardCredits = {version: 1, characters: [{participantKey: profile.participantKey, characterKey: profile.characterKey,
    sourceHash: 'a'.repeat(64), cardContentHash: 'b'.repeat(64), creator: '卡片原作者', characterVersion: '1.2'}]}
  await act(async () => root.render(createElement(ReleaseStartCard, {item: {...item, manifest}, disabled: false, onStart: vi.fn()})))
  expect(host.textContent).toContain('外部角色卡来源与署名')
  expect(host.textContent).toContain('卡片原作者')
  expect(host.textContent).toContain('卡片版本：1.2')
  expect(host.textContent).toContain('原卡 SHA-256：' + 'b'.repeat(64))
  expect(host.querySelector('button')!.disabled).toBe(false)
})

it('shows only player-known opening facts and public character identities, never private motivations, beliefs or knowledge', async () => {
  const {item} = await library(), manifest = structuredClone(item.manifest!)
  manifest.interaction.profiles[0].voiceRules = 'private-voice-direction'
  manifest.interaction.chatNarrative!.initialSituation.goals[0].desire = 'private-goal-direction'
  manifest.interaction.chatNarrative!.initialSituation.beliefs[0].text = 'private-belief-direction'
  const secret = manifest.interaction.chatNarrative!.initialSituation.facts.find(f => !f.audienceKeys.includes('player'))!
  secret.text = 'private-secret-direction'
  const projection = chatReleasePreviewV1(manifest)
  expect(projection.scenes[0].participants.map(p => p.name)).toEqual(['叶岑', '程素'])
  expect(projection.scenes[0].facts).toContain('铜印失踪。')
  await act(async () => root.render(createElement(ReleaseStartCard, {item: {...item, manifest}, disabled: false, onStart: vi.fn()})))
  expect(host.textContent).toContain('你将扮演 沈禾')
  for (const value of ['private-secret-direction', 'private-voice-direction', 'private-goal-direction', 'private-belief-direction']) {
    expect(JSON.stringify(projection)).not.toContain(value); expect(host.textContent).not.toContain(value)
  }
})

it('offers prepared narrative openings only, while ordinary interaction releases retain their scene choices', async () => {
  const {item} = await library(), manifest = structuredClone(item.manifest!)
  manifest.interaction.sceneTemplates.unshift({...manifest.interaction.sceneTemplates[0], sceneKey: 'unprepared', title: '尚未衔接的场景'})
  expect(resolveChatOpeningSceneV1(manifest)).toBe('inn')
  expect(() => resolveChatOpeningSceneV1(manifest, 'unprepared')).toThrow('已准备好')
  expect(() => resolveChatOpeningSceneV1(manifest, 'missing')).toThrow('已准备好')
  delete manifest.interaction.chatNarrative
  expect(chatReleasePreviewV1(manifest).scenes).toHaveLength(2)
  expect(resolveChatOpeningSceneV1(manifest, 'unprepared')).toBe('unprepared')
  const onStart = vi.fn()
  await act(async () => root.render(createElement(ReleaseStartCard, {item: {...item, manifest}, disabled: false, onStart})))
  const select = host.querySelector('select')!
  await act(async () => {select.value = 'inn'; select.dispatchEvent(new Event('change', {bubbles: true}))})
  await act(async () => host.querySelector('button')!.click())
  expect(onStart).toHaveBeenLastCalledWith('inn', undefined)
})

it('creates the selected opening without model calls, and rejects invalid selection before any session or event write', async () => {
  const {f, item} = await library(), spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1')
  const before = {sessions: await db.productRuntimeSessions.toArray(), events: await db.productRuntimeEvents.toArray(), worlds: await db.worldReleases.toArray()}
  await expect(store.getState().start(item.release.id!, undefined, {sceneKey: 'missing'})).rejects.toThrow('已准备好')
  expect(await db.productRuntimeSessions.toArray()).toEqual(before.sessions)
  expect(await db.productRuntimeEvents.toArray()).toEqual(before.events)
  const created = await store.getState().start(item.release.id!, '明确选择的开场', {sceneKey: 'inn'})
  expect(created).not.toBe(f.sessionId)
  expect(store.getState().runtimeState.interaction!.activeScene?.sceneKey).toBe('inn')
  expect(store.getState().runtimeState.interaction!.messages).toHaveLength(0)
  expect(await db.worldReleases.toArray()).toEqual(before.worlds)
  expect(spy).not.toHaveBeenCalled()
})

it('starts a chosen ordinary scene instead of silently using the first scene', async () => {
  const f = await seedChatLibraryFixture({secondOrdinaryScene: true})
  await store.getState().load(f.scope, null)
  await store.getState().start(f.releaseId, undefined, {sceneKey: 'courtyard'})
  expect(store.getState().runtimeState.interaction!.activeScene).toMatchObject({sceneKey: 'courtyard', title: '雨后庭院'})
})

it('requires an explicit multi-role opening actor choice and disables invalid releases', async () => {
  const {item} = await library(), onStart = vi.fn()
  await act(async () => root.render(createElement(ReleaseStartCard, {item, disabled: false, onStart})))
  const select = host.querySelector('select')!, button = host.querySelector('button')!
  expect(select.value).toBe('')
  await act(async () => button.click())
  expect(onStart).toHaveBeenLastCalledWith('inn', undefined)
  await act(async () => {select.value = 'artisan'; select.dispatchEvent(new Event('change', {bubbles: true}))})
  await act(async () => button.click())
  expect(onStart).toHaveBeenLastCalledWith('inn', 'artisan')
  const noOpening = structuredClone(item.manifest!)
  noOpening.interaction.chatNarrative!.permissions.triggers = ['player-response']
  await act(async () => root.render(createElement(ReleaseStartCard, {item: {...item, manifest: noOpening}, disabled: false, onStart})))
  expect(host.querySelector('select')).toBeNull()
  await act(async () => host.querySelector('button')!.click())
  expect(onStart).toHaveBeenLastCalledWith('inn', undefined)
  await act(async () => root.render(createElement(ReleaseStartCard, {item: {...item, error: '发行校验失败'}, disabled: false, onStart})))
  expect(host.querySelector('button')!.disabled).toBe(true)
  expect(host.textContent).not.toContain('铜印失踪')
})
