import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {act, createElement} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {db} from '../../src/lib/db/schema'
import {useCharacterInteractionPlayerStore as store} from '../../src/stores/character-interaction-player'
import {useChatMedia, type ChatMediaView} from '../../src/components/character-interaction/useChatMedia'
import ChatMedia, {ChatImage} from '../../src/components/character-interaction/ChatMedia'
import * as source from '../../src/lib/product-production/preview-source'
import {readProductRuntimeState} from '../../src/lib/character-interaction/runtime-api'
import {seedChatMediaPlayerFixture} from '../helpers/chat-media-fixture'

let host: HTMLDivElement, root: Root, view: ChatMediaView
const made = vi.fn(), revoked = vi.fn()
function Probe(props: Parameters<typeof useChatMedia>[0]) {
  view = useChatMedia(props)
  return createElement('div', {}, createElement(ChatMedia, {media: view}), createElement(ChatImage, {image: view.avatars.guard, fallback: '头像文字回退'}))
}
beforeEach(async () => {
  db.close(); await db.delete(); await db.open()
  store.setState({scope: null, selectedSessionId: null, busy: false, generatingRunId: null})
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  made.mockReset(); revoked.mockReset(); made.mockImplementation(() => `blob:chat-test-${made.mock.calls.length}`)
  vi.stubGlobal('URL', class extends URL {static createObjectURL = made; static revokeObjectURL = revoked})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close()})
async function playable() {
  const f = await seedChatMediaPlayerFixture()
  await store.getState().load(f.scope, null)
  const id = await store.getState().start(f.releaseId), session = (await db.productRuntimeSessions.get(id))!
  const interaction = (await readProductRuntimeState(id)).interaction!
  return {f, props: {scope: f.scope, session, interaction, enabled: true}}
}
async function render(props: Parameters<typeof useChatMedia>[0]) {
  await act(async () => root.render(createElement(Probe, props)))
}
async function settled(check: () => void) {
  for (let attempt = 0; attempt < 200; attempt++) {
    await act(async () => {await new Promise(resolve => setTimeout(resolve, 10))})
    try {check(); return} catch (error) {if (attempt === 199) throw error}
  }
}
async function loaded() {await settled(() => expect(view.background).not.toBeNull())}

it('shows frozen avatars and only present portraits; old text-only saves clear images immediately', async () => {
  const {f, props} = await playable(), worlds = await db.worldReleases.toArray()
  await render(props); await loaded()
  expect(Object.keys(view.avatars)).toEqual(['guard', 'artisan'])
  expect(view.portraits.map(p => p.name)).toEqual(['叶岑', '程素'])
  await store.getState().setParticipantPresence('guard', false)
  await render({...props, interaction: (await readProductRuntimeState(props.session.id!)).interaction!}); await loaded()
  expect(view.portraits.map(p => p.participantKey)).toEqual(['artisan'])
  expect(view.avatars.guard).toBeDefined()
  const old = (await db.productRuntimeSessions.get(f.sessionId))!, oldState = (await readProductRuntimeState(f.sessionId)).interaction!
  await render({...props, session: old, interaction: oldState})
  expect(view.background).toBeNull(); expect(view.avatars).toEqual({}); expect(host.querySelector('img')).toBeNull()
  expect(revoked).toHaveBeenCalled()
  expect(await db.agentRuns.count()).toBe(0); expect(await db.worldReleases.toArray()).toEqual(worlds)
})

it('keeps usable text and remaining art when one binary is missing or an image fails to decode', async () => {
  const {f, props} = await playable()
  await db.productMediaBlobs.where('mediaAssetId').equals(f.assetIds[1]).delete()
  await render(props); await loaded()
  expect(view.missing).toBe(1); expect(view.avatars.artisan).toBeUndefined(); expect(view.avatars.guard).toBeDefined()
  expect(host.textContent).toContain('仍可继续文字聊天')
  const avatar = host.querySelector('div > img')!
  await act(async () => avatar.dispatchEvent(new Event('error')))
  expect(host.textContent).toContain('头像文字回退')
  expect(await db.agentRuns.count()).toBe(0)
})

it('rejects a mismatched save source before allocating image URLs', async () => {
  const {props} = await playable()
  await render({...props, session: {...props.session, runtimeSourceHash: 'f'.repeat(64)}})
  await settled(() => expect(view.missing).toBe(1))
  expect(view.background).toBeNull(); expect(made).not.toHaveBeenCalled()
})

it('disposes a late resolver without loading or displaying images from a previously selected save', async () => {
  const {f, props} = await playable()
  const resolved = await source.resolveProductRuntimeSource({scope: f.scope, source: await source.productRuntimeSourceForSessionV1(props.session)})
  const preload = vi.spyOn(resolved.mediaResolver, 'preload'), dispose = vi.spyOn(resolved.mediaResolver, 'dispose')
  let finish!: (value: typeof resolved) => void
  vi.spyOn(source, 'resolveProductRuntimeSource').mockImplementationOnce(() => new Promise(resolve => {finish = resolve}))
  await render(props)
  await act(async () => {await vi.waitFor(() => expect(finish).toBeDefined())})
  const old = (await db.productRuntimeSessions.get(f.sessionId))!, oldState = (await readProductRuntimeState(f.sessionId)).interaction!
  await render({...props, session: old, interaction: oldState})
  await act(async () => finish(resolved))
  expect(preload).not.toHaveBeenCalled(); expect(dispose).toHaveBeenCalled()
  expect(view.background).toBeNull(); expect(host.querySelector('img')).toBeNull(); expect(made).not.toHaveBeenCalled()
})
