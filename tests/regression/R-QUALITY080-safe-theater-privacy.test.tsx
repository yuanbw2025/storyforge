import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import TtrpgCampaignGuide from '../../src/components/ttrpg/TtrpgCampaignGuide'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { createTtrpgViewerProjectionV1 } from '../../src/lib/ttrpg/viewer-projection'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import {
  completeTtrpgSessionZero,
  openTtrpgCampaignScene,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
  discoverTtrpgClue,
  startTtrpgCampaignSessionV2,
  completeTtrpgCampaignSessionV2,
  resolveTtrpgRuleAction,
  recordTtrpgHumanResponseV2,
} from '../../src/lib/ttrpg/runtime-api'
import type { TtrpgProductionSeatV2 } from '../../src/lib/types'
import { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } from '../helpers/current-product-world'
import { createCurrentTtrpgRuntimePackageFixture } from '../helpers/current-ttrpg-runtime-package'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { startCommunityTtrpgGameV1 } from '../../src/lib/ttrpg/community-games'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { adoptTtrpgPrivateGuidanceV1, captureTtrpgPrivateGuidanceViewV1, generateTtrpgPrivateGuidanceV1 } from '../../src/lib/ttrpg/private-guidance'
import * as runtimeSource from '../../src/lib/product-production/preview-source'

const PRIVATE_KNOWLEDGE = 'QUALITY080_ONLY_SELF_PRIVATE_KNOWLEDGE'
const PRIVATE_SAFETY = 'QUALITY080_ONLY_SELF_SAFETY_NOTE'
const PRIVATE_GM = 'QUALITY080_ONLY_GM_NPC_KNOWLEDGE'
const PRIVATE_DRAFT = 'QUALITY080_PENDING_PRIVATE_MEDIA_DRAFT'
const PRIVATE_ACTION_DRAFT = 'QUALITY080_PENDING_PRIVATE_ACTION_DRAFT'
const OTHER_PRIVATE = 'QUALITY080_OTHER_PLAYER_PRIVATE_KNOWLEDGE'
const PRIVATE_CLUE = 'QUALITY080_ACTOR_PRIVATE_CLUE'
const PUBLIC_CLUE = 'QUALITY080_PUBLIC_CLUE_REMAINS'
const PRIVATE_MEMORY = 'QUALITY080_ACTOR_PRIVATE_MEMORY'
const GM_MEMORY = 'QUALITY080_GM_ONLY_MEMORY'
const PUBLIC_MEMORY = 'QUALITY080_PUBLIC_MEMORY_REMAINS'
const PRIVATE_BUILDER_DRAFT = 'QUALITY080_UNSAVED_PRIVATE_CHARACTER_KNOWLEDGE'
const PUBLIC_MEDIA = 'QUALITY080_PUBLIC_MEDIA_FALLBACK'
const PRIVATE_MEDIA = 'QUALITY080_PRIVATE_MEDIA_FALLBACK'
const PRIVATE_INVITE = 'QUALITY080_PRIVATE_ONLINE_INVITATION'
const PRIVATE_GUIDANCE = 'QUALITY080_ADOPTED_PRIVATE_GUIDANCE'
const PRIVATE_RESPONSE = 'QUALITY080_ONLY_SELF_AND_GM_HUMAN_RESPONSE'
const PRIVATE_RESPONSE_DRAFT = 'QUALITY080_UNSUBMITTED_HUMAN_RESPONSE'
const PUBLIC_RESPONSE = 'QUALITY080_EXPLICIT_PARTY_HUMAN_RESPONSE'
const PRIVATE_SAFETY_DRAFT = 'QUALITY080_UNSUBMITTED_SAFETY_REASON'
const PRIVATE_ERROR = 'QUALITY080_PERSONAL_CHECKPOINT_ERROR_DETAIL'
const PRIVATE_HANDOUT = 'QUALITY080_PRIVATE_CLUE_HANDOUT'
const PUBLIC_HANDOUT = 'QUALITY080_PUBLIC_CLUE_HANDOUT'
const PRIVATE_TABLETOP = 'QUALITY080_GM_ONLY_MAP_AREA'
const PRIVATE_MEMORY_DRAFT = 'QUALITY080_UNSUBMITTED_GM_MEMORY'

type FixtureOptions = { twoPlayers?: boolean; clues?: boolean; handouts?: boolean; memories?: boolean; activeCampaign?: boolean; tabletop?: boolean; beforeSessionZero?: boolean; mediaSlots?: boolean; adviceAllowed?: boolean; privateKnowledge?: string }
async function readyScripted(options: FixtureOptions = {}) {
  const owner = await seedCurrentProductWorld('QUALITY080 isolated scripted world')
  if (owner.release.id == null) throw new Error('current World fixture requires a persisted release')
  const release = { ...owner.release, id: owner.release.id }
  const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({
    scope: owner.scope, worldReleaseId: release.id, productType: 'ttrpg',
  })
  const seats = options.twoPlayers ? ['QUALITY080 public first', 'QUALITY080 public second']
    .map((name, index): TtrpgProductionSeatV2 => ({
      seatKey: 'player.' + (index + 1), label: name, controller: 'human', role: 'player',
      characterMode: 'quick-card', sourceCharacterResourceKey: null, characterName: name,
      rankTier: 'B', privateGoal: 'Retain this individual character goal.',
    })) : undefined
  const input = await createCurrentTtrpgRuntimePackageFixture({
    scope: owner.scope, worldRelease: release, sourceCatalog,
    playerController: 'human', gmMode: 'human', authoredScenario: true, seats,
  })
  const player = input.ttrpg?.campaign.characterTemplates.find(row => row.role === 'player')
  if (!player?.characterSheet) throw new Error('current scripted fixture requires a complete player sheet')
  if (!input.ttrpg) throw new Error('current package requires TTRPG content')
  for (const npc of input.ttrpg.campaign.characterTemplates.filter(row => row.role === 'npc')) {
    npc.characterSheet ??= createCompleteTtrpgCharacterSheetV2({ template: npc, rulePack: input.ttrpg.rulePack.content })
    npc.characterSheet.identity.privateKnowledge = [PRIVATE_GM]
  }
  player.characterSheet.identity.privateKnowledge = [options.privateKnowledge ?? PRIVATE_KNOWLEDGE]
  player.characterSheet.identity.safetyNotes = [PRIVATE_SAFETY]
  const otherPlayer = input.ttrpg.campaign.characterTemplates.filter(row => row.role === 'player')[1]
  if (otherPlayer?.characterSheet) otherPlayer.characterSheet.identity.privateKnowledge = [OTHER_PRIVATE]
  const opening = input.ttrpg.campaign.scenes.find(row => row.sceneKey === input.ttrpg?.campaign.openingSceneKey)
  if (!opening) throw new Error('current scripted fixture requires its opening scene')
  if (options.tabletop) {
    opening.tabletopMapKey = 'quality080.public-map'
    input.ttrpg.campaign.tabletop = { maps: [{
      mapKey: opening.tabletopMapKey, title: 'QUALITY080 public map', width: 20, height: 12,
      backgroundAssetKey: null, fallbackDescription: 'QUALITY080 public map remains visible',
      grid: { kind: 'zone', cellSize: 1, distancePerCell: 1, unit: '区域' },
      layers: [{ layerKey: 'quality080.terrain', title: 'QUALITY080 public terrain', kind: 'terrain',
        zIndex: 0, opacity: 1, gmOnly: false }],
      areas: [{ areaKey: 'quality080.private-area', title: PRIVATE_TABLETOP, x: 5, y: 5, width: 20, height: 20, gmOnly: true }],
      fog: [], tokens: [{ tokenKey: 'quality080.player-token', entityKey: player.characterKey,
        x: 10, y: 25, size: 1, controllerKey: player.characterKey, hidden: false }],
    }] }
  }
  if (options.clues) {
    const privateClue = input.ttrpg.campaign.clues.find(row => row.clueKey === opening.clueKeys[0])
    const publicClue = input.ttrpg.campaign.clues.find(row => row.clueKey === opening.clueKeys[1])
    if (!privateClue || !publicClue) throw new Error('current authored scenario requires two opening clues')
    privateClue.visibility = 'discoverable'
    privateClue.description = PRIVATE_CLUE
    publicClue.visibility = 'public'
    publicClue.description = PUBLIC_CLUE
  }
  if (options.handouts) {
    input.ttrpg.campaign.handouts.push({ handoutKey: 'quality080.private-handout', title: PRIVATE_HANDOUT,
      body: PRIVATE_HANDOUT, fallbackText: PRIVATE_HANDOUT, assetKey: null, revealClueKey: opening.clueKeys[0] },
    { handoutKey: 'quality080.public-handout', title: PUBLIC_HANDOUT,
      body: PUBLIC_HANDOUT, fallbackText: PUBLIC_HANDOUT, assetKey: null, revealClueKey: opening.clueKeys[1] })
  }
  if (options.mediaSlots) {
    const media = input.ttrpg.campaign.mediaManifest
    if (!media) throw new Error('current package requires a frozen media manifest')
    media.slots.push({ slotKey: 'quality080.public-scene', kind: 'scene', targetRef: opening.sceneKey,
      audience: 'public', productionRequired: false, assetKey: null, fallbackText: PUBLIC_MEDIA,
      altText: PUBLIC_MEDIA, promptTemplate: 'QUALITY080 public frozen scene', width: 1536, height: 1024 },
    { slotKey: 'quality080.private-portrait', kind: 'character-portrait', targetRef: player.characterKey,
      audience: 'private', productionRequired: false, assetKey: null, fallbackText: PRIVATE_MEDIA,
      altText: PRIVATE_MEDIA, promptTemplate: 'QUALITY080 private frozen portrait', width: 1024, height: 1536 })
  }
  const runtimePackage = parseProductRuntimePackageV1(input)
  if (!runtimePackage.ttrpg) throw new Error('current package is not TTRPG')
  const made = await seedCurrentProductBuild({
    scope: owner.scope, worldRelease: release, runtimePackage,
    title: 'QUALITY080 isolated scripted preview', seed: 'quality080-deterministic',
  })
  if (made.session.id == null) throw new Error('current preview requires a persisted session')
  const sessionId = made.session.id
  if (options.adviceAllowed) for (const seat of await readTtrpgSessionParticipantsV2(sessionId)) {
    await configureTtrpgSessionParticipantV2({ sessionId, seatKey: seat.seatKey,
      expectedRevision: seat.revision, commandId: 'quality080.advice-consent.' + seat.seatKey,
      requestedByViewerKey: 'viewer.gm', consent: { aiIdentityDisclosed: true, aiAdviceAllowed: true } })
  }
  const envelope = async (commandId: string) => {
    const version = await readProductRuntimeStateVersion(sessionId)
    return { sessionId, commandId, baseSequence: version.sequence, baseStateHash: version.stateHash }
  }
  const initial = await readProductRuntimeState(sessionId)
  if (!initial.ttrpg?.product) throw new Error('current preview is missing product state')
  if (options.beforeSessionZero) return { ...owner, ...made, sessionId, runtimePackage, state: initial }
  await completeTtrpgSessionZero({
    ...await envelope('quality080.zero'),
    acceptedItemKeys: initial.ttrpg.product.sessionZero.requiredItemKeys,
    selectedCharacterKeys: runtimePackage.ttrpg.campaign.characterTemplates
      .filter(row => row.role === 'player').map(row => row.characterKey),
    completedBy: 'viewer.gm',
  })
  await openTtrpgCampaignScene({
    ...await envelope('quality080.open'), sceneKey: runtimePackage.ttrpg.campaign.openingSceneKey,
  })
  const playerKeys = runtimePackage.ttrpg.campaign.characterTemplates.filter(row => row.role === 'player')
    .map(row => row.characterKey)
  if (options.clues) {
    await discoverTtrpgClue({ ...await envelope('quality080.private-clue'),
      clueKey: opening.clueKeys[0], actorKey: playerKeys[0], visibility: 'private' })
    await discoverTtrpgClue({ ...await envelope('quality080.public-clue'),
      clueKey: opening.clueKeys[1], actorKey: playerKeys[0], visibility: 'party' })
  }
  if (options.memories || options.activeCampaign) {
    await startTtrpgCampaignSessionV2({ ...await envelope('quality080.memory-start'),
      sessionKey: 'quality080.session', title: 'QUALITY080 public session', participantKeys: playerKeys, gmKey: 'viewer.gm' })
  }
  if (options.memories) {
    await completeTtrpgCampaignSessionV2({ ...await envelope('quality080.memory-complete'),
      sessionKey: 'quality080.session', summary: 'QUALITY080 public session summary', gmKey: 'viewer.gm', memories: [
        { memoryKey: 'quality080.private-memory', subjectKey: playerKeys[0], summary: PRIVATE_MEMORY, audience: `actor:${playerKeys[0]}` },
        { memoryKey: 'quality080.gm-memory', subjectKey: playerKeys[0], summary: GM_MEMORY, audience: 'gm-only' },
        { memoryKey: 'quality080.public-memory', subjectKey: playerKeys[0], summary: PUBLIC_MEMORY, audience: 'party' },
      ] })
  }
  return { ...owner, ...made, sessionId, runtimePackage, state: await readProductRuntimeState(sessionId) }
}

async function snapshotAllRows() {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
}

async function readyPublishedScripted() {
  const fixture = await readyScripted({ beforeSessionZero: true })
  const manifest = await createFixtureProductReleaseManifestV1({ runtimePackage: fixture.runtimePackage })
  const body = { schema: 'storyforge.product-distribution-bundle' as const, version: 2 as const,
    productRelease: { manifest, contentHash: await hashProductProductionValueV2(manifest) },
    sourceWorld: { contentHash: manifest.sourceWorldRelease.contentHash }, media: [] }
  const bundle = { ...body, bundleHash: await hashProductProductionValueV2(body) }
  const sessionId = await startCommunityTtrpgGameV1({ key: 'quality080-published', title: 'QUALITY080 public release',
    tagline: 'QUALITY080 isolated release fixture', description: 'Metadata fixture; not production or human acceptance.',
    coverPath: null, bundlePath: 'games/quality080.json', bundleHash: bundle.bundleHash,
    minutes: 45, playerCount: '1 player', version: 'quality080-test' }, bundle)
  const session = await db.productRuntimeSessions.get(sessionId)
  if (!session || session.worldId == null || session.workId == null) throw new Error('published installation requires real owner')
  const scope = { projectId: session.projectId, worldId: session.worldId, workId: session.workId }
  const initial = await readProductRuntimeState(sessionId)
  if (!initial.ttrpg?.product || !fixture.runtimePackage.ttrpg) throw new Error('published installation requires TTRPG state')
  let version = await readProductRuntimeStateVersion(sessionId)
  await completeTtrpgSessionZero({ sessionId, commandId: 'quality080.published.zero', baseSequence: version.sequence,
    baseStateHash: version.stateHash, acceptedItemKeys: initial.ttrpg.product.sessionZero.requiredItemKeys,
    selectedCharacterKeys: fixture.runtimePackage.ttrpg.campaign.characterTemplates
      .filter(row => row.role === 'player').map(row => row.characterKey), completedBy: 'viewer.gm' })
  version = await readProductRuntimeStateVersion(sessionId)
  await openTtrpgCampaignScene({ sessionId, commandId: 'quality080.published.open', baseSequence: version.sequence,
    baseStateHash: version.stateHash, sceneKey: fixture.runtimePackage.ttrpg.campaign.openingSceneKey })
  return { ...fixture, session, scope, sessionId, state: await readProductRuntimeState(sessionId) }
}

async function readyHumanResponse() {
  const fixture = await readyScripted({ twoPlayers: true })
  const content = fixture.runtimePackage.ttrpg
  const actorKey = fixture.state.ttrpg?.activeActorKey
  if (!content || !actorKey) throw new Error('real human-response fixture requires an active actor')
  const actor = content.campaign.characterTemplates.find(row => row.characterKey === actorKey)
  const scene = content.campaign.scenes.find(row => row.sceneKey === fixture.state.ttrpg?.scene?.sceneKey)
  const action = content.rulePack.content.actions.find(row => row.key === 'investigate'
    && actor?.actionKeys.includes(row.key) && scene?.actionKeys.includes(row.key))
  if (!action) throw new Error('real current initiative requires a legal investigation action')
  const version = await readProductRuntimeStateVersion(fixture.sessionId)
  await resolveTtrpgRuleAction({ sessionId: fixture.sessionId, commandId: 'quality080.actual-action',
    baseSequence: version.sequence, baseStateHash: version.stateHash, actorKey, actionKey: action.key,
    targetKey: null, difficulty: 8, declaredIntent: { intentKey: 'quality080.intent',
      rawInput: 'Inspect the current evidence in front of both players.', goal: 'Find the signal source', method: 'Careful investigation' } })
  const state = await readProductRuntimeState(fixture.sessionId)
  const gmView = createTtrpgViewerProjectionV1({ state, campaign: content.campaign,
    rulePack: content.rulePack.content, role: 'gm' })
  const response = gmView.pendingHumanResponses[0]
  if (!response) throw new Error('actual ActionReceipt did not open a human response window')
  const seat = (await readTtrpgSessionParticipantsV2(fixture.sessionId)).find(row => row.actorKey === response.actorKey)
  if (!seat || seat.controller !== 'human') throw new Error('actual response must belong to a human seat')
  return { fixture: { ...fixture, state }, response, seat }
}

describe('R-QUALITY080 · safe theater uses public audience', () => {
  let root: Root | undefined
  let host: HTMLDivElement
  let fetchCanary: ReturnType<typeof vi.fn>
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    fetchCanary = vi.fn(async () => { throw new Error('QUALITY080 real network is forbidden') })
    vi.stubGlobal('fetch', fetchCanary)
    await db.delete()
    await db.open()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    root = undefined
    host.remove()
    expect(fetchCanary).not.toHaveBeenCalled()
    db.close()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  const button = (name: string) => [...host.querySelectorAll('button')]
    .find(element => element.textContent?.trim() === name)
  const sheet = () => host.querySelector('[data-testid="ttrpg-complete-character-sheet"]')
  async function changeField(element: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
    if (!element) throw new Error('test requires an actual mounted form field')
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setValue = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (!setValue) throw new Error('test requires the native form value setter')
    await act(async () => {
      setValue.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  async function renderPrepared(fixture: Pick<Awaited<ReturnType<typeof readyScripted>>, 'session' | 'state' | 'scope'>,
    panel: 'inventory' | 'tabletop' | 'room' | 'history' | null = 'inventory', strict = false,
    overrides: Partial<Pick<Parameters<typeof TtrpgCampaignGuide>[0], 'onCheckpoint'>> = {}) {
    const onChanged = vi.fn(async () => {})
    const guide = createElement(TtrpgCampaignGuide, {
      panel: panel ?? undefined, session: fixture.session, state: fixture.state, workspaceScope: fixture.scope,
      checkpoints: [], onChanged, onCheckpoint: async () => {},
      onBranch: async () => 0, onRestoreCheckpoint: async () => 0,
      ...overrides,
    })
    await act(async () => root?.render(strict ? createElement(StrictMode, null, guide) : guide))
    await vi.waitFor(() => expect(button('安全投屏')).toBeDefined())
    await act(async () => button('玩家视图')?.click())
    return onChanged
  }
  function guideFor(fixture: Pick<Awaited<ReturnType<typeof readyScripted>>, 'session' | 'state' | 'scope'>,
    onChanged: () => Promise<void>) {
    return createElement(TtrpgCampaignGuide, { panel: 'inventory', session: fixture.session,
      state: fixture.state, workspaceScope: fixture.scope, checkpoints: [], onChanged,
      onCheckpoint: async () => {}, onBranch: async () => 0, onRestoreCheckpoint: async () => 0 })
  }
  async function renderInventory(panel: 'inventory' | 'tabletop' | 'room' | 'history' | null = 'inventory', strict = false, options: FixtureOptions = {}) {
    const fixture = await readyScripted(options)
    const onChanged = await renderPrepared(fixture, panel, strict)
    if (!options.beforeSessionZero) await vi.waitFor(() => expect(sheet()?.textContent).toContain(PRIVATE_KNOWLEDGE))
    return { fixture, onChanged }
  }

  it('retains ordinary own-player and GM private access while existing spectator projection redacts it', async () => {
    const { fixture } = await renderInventory()
    expect(sheet()?.textContent).toContain(PRIVATE_KNOWLEDGE)
    expect(sheet()?.textContent).toContain(PRIVATE_SAFETY)
    expect(host.textContent).not.toContain(PRIVATE_GM)
    await act(async () => button('主持人视图')?.click())
    expect(sheet()?.textContent).toContain(PRIVATE_GM)
    const content = fixture.runtimePackage.ttrpg
    if (!content) throw new Error('missing TTRPG content')
    const spectator = createTtrpgViewerProjectionV1({
      state: fixture.state, campaign: content.campaign, rulePack: content.rulePack.content,
      role: 'spectator', actorKey: null,
    })
    expect(JSON.stringify(spectator)).not.toContain(PRIVATE_KNOWLEDGE)
    expect(JSON.stringify(spectator)).not.toContain(PRIVATE_SAFETY)
    expect(JSON.stringify(spectator)).not.toContain(PRIVATE_GM)
  })

  it.each([PRIVATE_KNOWLEDGE, PRIVATE_SAFETY])('does not put private sentinel in any theater DOM: %s', async sentinel => {
    const { fixture, onChanged } = await renderInventory()
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    expect(button('退出投屏')?.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[aria-label="玩家安全投屏模式"]')).not.toBeNull()
    expect(host.textContent).toContain(fixture.runtimePackage.ttrpg?.campaign.title)
    expect(await snapshotAllRows()).toEqual(before)
    expect(onChanged).not.toHaveBeenCalled()
    // Check the entire DOM, including hidden panels: CSS is not a privacy boundary.
    expect(host.textContent).not.toContain(sentinel)
  })

  it.each(['tabletop', 'room', 'history', null] as const)('keeps the same public audience on the %s entry', async panel => {
    const { onChanged } = await renderInventory(panel)
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    expect(host.textContent).not.toContain(PRIVATE_KNOWLEDGE)
    expect(host.textContent).not.toContain(PRIVATE_SAFETY)
    expect(host.textContent).not.toContain(PRIVATE_GM)
    expect(await snapshotAllRows()).toEqual(before)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it.each([false, true])('restores the same own-player view and state after repeated theater toggles, StrictMode=%s', async strict => {
    await renderInventory('inventory', strict)
    const before = await snapshotAllRows()
    for (let index = 0; index < 2; index++) {
      await act(async () => button('安全投屏')?.click())
      expect(host.textContent).not.toContain(PRIVATE_KNOWLEDGE)
      await act(async () => button('退出投屏')?.click())
      expect(sheet()?.textContent).toContain(PRIVATE_KNOWLEDGE)
      expect(sheet()?.textContent).toContain(PRIVATE_SAFETY)
      expect(button('玩家视图')?.getAttribute('aria-pressed')).toBe('true')
    }
    expect(await snapshotAllRows()).toEqual(before)
  })

  it('does not publish a pending media draft in public theater and restores it after exit', async () => {
    await renderInventory('tabletop')
    const mediaInput = () => host.querySelector<HTMLInputElement>('[data-testid="ttrpg-runtime-media-panel"] input')
    await vi.waitFor(() => expect(mediaInput()).not.toBeNull())
    await changeField(mediaInput(), PRIVATE_DRAFT)
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    const publicInputValues = [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')]
      .map(element => element.value).join('\n')
    await act(async () => button('退出投屏')?.click())
    // This positive control also proves the native event updated React state.
    expect(mediaInput()?.value).toBe(PRIVATE_DRAFT)
    expect(await snapshotAllRows()).toEqual(before)
    expect(publicInputValues).not.toContain(PRIVATE_DRAFT)
  })

  it('does not publish a pending personal action draft and restores it after theater', async () => {
    await renderInventory('tabletop')
    const actionInput = () => [...host.querySelectorAll('label')]
      .find(label => label.textContent?.trim().startsWith('角色行动声明'))?.querySelector('textarea') ?? null
    await changeField(actionInput(), PRIVATE_ACTION_DRAFT)
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    const publicInputValues = [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')]
      .map(element => element.value).join('\n')
    await act(async () => button('退出投屏')?.click())
    expect(actionInput()?.value).toBe(PRIVATE_ACTION_DRAFT)
    expect(await snapshotAllRows()).toEqual(before)
    expect(publicInputValues).not.toContain(PRIVATE_ACTION_DRAFT)
  })

  it('uses the public audience at the inventory display rather than rebuilding the owner ledger', async () => {
    const { fixture } = await renderInventory('tabletop')
    const content = fixture.runtimePackage.ttrpg
    if (!content) throw new Error('missing TTRPG content')
    const publicView = createTtrpgViewerProjectionV1({ state: fixture.state, campaign: content.campaign,
      rulePack: content.rulePack.content, role: 'spectator', actorKey: null })
    expect(publicView.inventory).toEqual([])
    expect(host.textContent).toContain('持有者：')
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    const publicOwnerLedger = host.querySelector('[data-testid="ttrpg-inventory-ledger"]')?.textContent ?? ''
    await act(async () => button('退出投屏')?.click())
    expect(host.textContent).toContain('持有者：')
    expect(await snapshotAllRows()).toEqual(before)
    expect(publicOwnerLedger).not.toContain('持有者：')
  })

  it('passes the existing spectator tabletop role and keeps the public map after theater switch', async () => {
    await renderInventory('tabletop', false, { tabletop: true })
    expect(host.textContent).toContain('玩家安全投影')
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    expect(host.textContent).toContain('观战安全投影')
    expect(host.textContent).toContain('QUALITY080 public map')
    await act(async () => button('退出投屏')?.click())
    expect(host.textContent).toContain('玩家安全投影')
    expect(await snapshotAllRows()).toEqual(before)
  })

  it('keeps all selected character changes public in theater and restores the selected own view on exit', async () => {
    await renderInventory('inventory', false, { twoPlayers: true })
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    const selectors = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
      .filter(element => element.getAttribute('aria-label')?.startsWith('查看角色：'))
    expect(selectors).toHaveLength(2)
    for (const element of selectors) {
      await act(async () => element.click())
      expect(host.textContent).not.toContain(PRIVATE_KNOWLEDGE)
      expect(host.textContent).not.toContain(OTHER_PRIVATE)
      expect(host.textContent).not.toContain(PRIVATE_SAFETY)
    }
    await act(async () => button('退出投屏')?.click())
    expect(sheet()?.textContent).toContain(OTHER_PRIVATE)
    expect(sheet()?.textContent).not.toContain(PRIVATE_KNOWLEDGE)
    expect(await snapshotAllRows()).toEqual(before)
  })

  it('redacts actual private clue discoveries while retaining the public discovery', async () => {
    await renderInventory('tabletop', false, { clues: true })
    expect(host.textContent).toContain(PRIVATE_CLUE)
    expect(host.textContent).toContain(PUBLIC_CLUE)
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    expect(host.textContent).not.toContain(PRIVATE_CLUE)
    expect(host.textContent).toContain(PUBLIC_CLUE)
    await act(async () => button('退出投屏')?.click())
    expect(host.textContent).toContain(PRIVATE_CLUE)
    expect(await snapshotAllRows()).toEqual(before)
  })

  it('redacts actual actor and GM memories while retaining public continuity and ordinary own access', async () => {
    await renderInventory('history', false, { memories: true })
    expect(host.textContent).toContain(PRIVATE_MEMORY)
    expect(host.textContent).not.toContain(GM_MEMORY)
    expect(host.textContent).toContain(PUBLIC_MEMORY)
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    expect(host.textContent).not.toContain(PRIVATE_MEMORY)
    expect(host.textContent).not.toContain(GM_MEMORY)
    expect(host.textContent).toContain(PUBLIC_MEMORY)
    await act(async () => button('退出投屏')?.click())
    expect(host.textContent).toContain(PRIVATE_MEMORY)
    expect(await snapshotAllRows()).toEqual(before)
  })

  it('keeps unsaved character-builder secrets out of theater before Session Zero without clearing the draft', async () => {
    await renderInventory('inventory', false, { beforeSessionZero: true })
    const privateKnowledge = () => [...host.querySelectorAll('label')]
      .find(label => label.textContent?.trim().startsWith('角色私密知识'))?.querySelector('textarea') ?? null
    await vi.waitFor(() => expect(privateKnowledge()).not.toBeNull())
    await changeField(privateKnowledge(), PRIVATE_BUILDER_DRAFT)
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    const theaterText = host.textContent ?? ''
    const theaterInputs = [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')]
      .map(element => element.value).join('\n')
    await act(async () => button('退出投屏')?.click())
    expect(privateKnowledge()?.value).toBe(PRIVATE_BUILDER_DRAFT)
    expect(await snapshotAllRows()).toEqual(before)
    expect(theaterInputs).not.toContain(PRIVATE_BUILDER_DRAFT)
    expect(theaterInputs + theaterText).not.toContain(PRIVATE_KNOWLEDGE)
    expect(theaterInputs + theaterText).not.toContain(PRIVATE_SAFETY)
  })

  it('retains explicitly public media slots but removes private slots from theater without deleting either', async () => {
    await renderInventory('tabletop', false, { mediaSlots: true })
    const media = () => host.querySelector('[data-testid="ttrpg-runtime-media-panel"]')
    await vi.waitFor(() => expect(media()?.textContent).toContain(PRIVATE_MEDIA))
    expect(media()?.textContent).toContain(PUBLIC_MEDIA)
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    expect(media()?.textContent).toContain(PUBLIC_MEDIA)
    expect(host.textContent).not.toContain(PRIVATE_MEDIA)
    expect(button('主持人视图')).toBeUndefined()
    await act(async () => button('退出投屏')?.click())
    expect(media()?.textContent).toContain(PRIVATE_MEDIA)
    expect(media()?.textContent).toContain(PUBLIC_MEDIA)
    expect(await snapshotAllRows()).toEqual(before)
  })

  it('does not expose a pending hosted-room invitation in theater and keeps the mounted room draft after exit', async () => {
    vi.stubEnv('VITE_STORYFORGE_ONLINE_SERVICE_URL', 'https://quality080.invalid')
    const fixture = await readyPublishedScripted()
    const onChanged = await renderPrepared(fixture, 'room')
    const inviteInput = () => host.querySelector<HTMLInputElement>('input[aria-label="邀请凭据"]')
    await vi.waitFor(() => expect(inviteInput()).not.toBeNull())
    await changeField(inviteInput(), PRIVATE_INVITE)
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    const publicValues = [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')]
      .map(element => element.value).join('\n')
    await act(async () => button('退出投屏')?.click())
    expect(inviteInput()?.value).toBe(PRIVATE_INVITE)
    expect(await snapshotAllRows()).toEqual(before)
    expect(onChanged).not.toHaveBeenCalled()
    expect(publicValues).not.toContain(PRIVATE_INVITE)
  })

  it('retains actual adopted private guidance for its owner without including it in the public display', async () => {
    const fixture = await readyScripted({ adviceAllowed: true })
    const actor = fixture.runtimePackage.ttrpg?.campaign.characterTemplates.find(row => row.role === 'player')
    if (!actor) throw new Error('guidance requires an existing player')
    let syntheticCalls = 0
    const input = { scope: fixture.scope, productRuntimeSessionId: fixture.sessionId, actorKey: actor.characterKey }
    const generated = await generateTtrpgPrivateGuidanceV1({ ...input, objective: 'Help me consider my private goal.',
      runAI: async () => { syntheticCalls++; return JSON.stringify({ actorKey: actor.characterKey, advice: PRIVATE_GUIDANCE, suggestedActionKey: null }) } })
    await adoptTtrpgPrivateGuidanceV1({ scope: fixture.scope, actorKey: actor.characterKey, runId: generated.candidate.runId })
    const own = await captureTtrpgPrivateGuidanceViewV1(input)
    expect(own.view.priorGuidance.map(row => row.advice)).toContain(PRIVATE_GUIDANCE)
    expect(syntheticCalls).toBe(1)
    const state = await readProductRuntimeState(fixture.sessionId)
    await renderPrepared({ ...fixture, state })
    await vi.waitFor(() => expect(sheet()?.textContent).toContain(PRIVATE_KNOWLEDGE))
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    expect(host.textContent).not.toContain(PRIVATE_GUIDANCE)
    expect(host.textContent).not.toContain(PRIVATE_KNOWLEDGE)
    await act(async () => button('退出投屏')?.click())
    expect(sheet()?.textContent).toContain(PRIVATE_KNOWLEDGE)
    expect((await captureTtrpgPrivateGuidanceViewV1(input)).view.priorGuidance.map(row => row.advice)).toContain(PRIVATE_GUIDANCE)
    expect(await snapshotAllRows()).toEqual(before)
  })

  it.each(['gm-only', 'party'] as const)('protects actual human-response drafts and respects accepted %s audience', async audience => {
    const { fixture, response, seat } = await readyHumanResponse()
    await renderPrepared(fixture, 'tabletop')
    const actorName = fixture.state.entities[response.actorKey]?.name
    const actorButton = host.querySelector<HTMLButtonElement>(`button[aria-label="查看角色：${actorName}"]`)
    if (!actorButton) throw new Error('actual response owner must be selectable in the current Guide')
    await act(async () => actorButton.click())
    const responseInput = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="真人角色回应"]')
    await vi.waitFor(() => expect(responseInput()).not.toBeNull())
    await changeField(responseInput(), PRIVATE_RESPONSE_DRAFT)
    const beforeDraftToggle = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    expect([...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')]
      .map(row => row.value).join('\n')).not.toContain(PRIVATE_RESPONSE_DRAFT)
    await act(async () => button('退出投屏')?.click())
    expect(responseInput()?.value).toBe(PRIVATE_RESPONSE_DRAFT)
    expect(await snapshotAllRows()).toEqual(beforeDraftToggle)
    const version = await readProductRuntimeStateVersion(fixture.sessionId)
    const text = audience === 'gm-only' ? PRIVATE_RESPONSE : PUBLIC_RESPONSE
    await recordTtrpgHumanResponseV2({ sessionId: fixture.sessionId, commandId: 'quality080.human-response',
      baseSequence: version.sequence, baseStateHash: version.stateHash, ...response,
      kind: 'speak', text, audience, viewerKey: seat.viewerKey })
    await renderPrepared({ ...fixture, state: await readProductRuntimeState(fixture.sessionId) }, 'tabletop')
    expect(host.textContent).toContain(text)
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    if (audience === 'gm-only') expect(host.textContent).not.toContain(PRIVATE_RESPONSE)
    else expect(host.textContent).toContain(PUBLIC_RESPONSE)
    await act(async () => button('退出投屏')?.click())
    expect(host.textContent).toContain(text)
    expect(await snapshotAllRows()).toEqual(before)
  })

  it('keeps actual safety pause available in theater without publishing an unsubmitted reason', async () => {
    const { fixture, onChanged } = await renderInventory('tabletop')
    const reasonInput = () => host.querySelector<HTMLInputElement>('input[aria-label="安全暂停原因"]')
    await changeField(reasonInput(), PRIVATE_SAFETY_DRAFT)
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    const publicValues = [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')]
      .map(row => row.value).join('\n')
    expect(button('立即暂停')?.disabled).toBe(false)
    expect(await snapshotAllRows()).toEqual(before)
    await act(async () => button('退出投屏')?.click())
    expect(reasonInput()?.value).toBe(PRIVATE_SAFETY_DRAFT)
    expect(await snapshotAllRows()).toEqual(before)
    expect(publicValues).not.toContain(PRIVATE_SAFETY_DRAFT)
    await act(async () => button('安全投屏')?.click())
    await act(async () => button('立即暂停')?.click())
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    const paused = await readProductRuntimeState(fixture.sessionId)
    expect(paused.ttrpg?.product?.safety.status).toBe('paused')
    expect(paused.ttrpg?.product?.safety.reason).not.toContain(PRIVATE_SAFETY_DRAFT)
  })

  it('keeps personal operation failure details private in theater and preserves them and the GM draft after exit', async () => {
    const fixture = await readyScripted()
    const onCheckpoint = vi.fn(async () => { throw new Error(PRIVATE_ERROR) })
    const onChanged = await renderPrepared(fixture, 'history', false, { onCheckpoint })
    await act(async () => button('主持人视图')?.click())
    const checkpointInput = () => host.querySelector<HTMLInputElement>('input[aria-label="正式战役检查点名称"]')
    await changeField(checkpointInput(), PRIVATE_ERROR)
    await act(async () => button('保存')?.click())
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain(PRIVATE_ERROR))
    expect(onCheckpoint).toHaveBeenCalledWith(PRIVATE_ERROR)
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    const publicText = host.textContent ?? ''
    expect([...host.querySelectorAll<HTMLInputElement>('input')].map(row => row.value)).not.toContain(PRIVATE_ERROR)
    await act(async () => button('退出投屏')?.click())
    expect(button('玩家视图')?.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(PRIVATE_ERROR)
    await act(async () => button('主持人视图')?.click())
    expect(checkpointInput()?.value).toBe(PRIVATE_ERROR)
    expect(await snapshotAllRows()).toEqual(before)
    expect(onChanged).not.toHaveBeenCalled()
    expect(publicText).not.toContain(PRIVATE_ERROR)
  })

  it('keeps theater public during a real next-Work source verification delay and restores only the new owner view', async () => {
    const first = await readyScripted()
    const second = await readyScripted({ privateKnowledge: OTHER_PRIVATE })
    const onChanged = await renderPrepared(first)
    await act(async () => button('安全投屏')?.click())
    const before = await snapshotAllRows()
    let releaseGate = () => {}
    const gate = new Promise<void>(resolve => { releaseGate = resolve })
    let started = false
    const verify = runtimeSource.verifyProductRuntimeSource
    const observer = vi.spyOn(runtimeSource, 'verifyProductRuntimeSource').mockImplementation(async input => {
      const result = await verify(input)
      if (input.source.kind === 'build' && input.source.productBuildId === second.session.productBuildId) {
        started = true
        await gate
      }
      return result
    })
    try {
      await act(async () => root?.render(guideFor(second, onChanged)))
      await vi.waitFor(() => expect(started).toBe(true))
      expect(host.textContent).toContain('正在校验冻结 RulePack')
      expect(host.textContent).not.toContain(PRIVATE_KNOWLEDGE)
      expect(host.textContent).not.toContain(OTHER_PRIVATE)
      await act(async () => releaseGate())
      await vi.waitFor(() => expect(button('退出投屏')).toBeDefined())
      expect(host.textContent).not.toContain(PRIVATE_KNOWLEDGE)
      expect(host.textContent).not.toContain(OTHER_PRIVATE)
      await act(async () => button('退出投屏')?.click())
      expect(sheet()?.textContent).toContain(OTHER_PRIVATE)
      expect(sheet()?.textContent).not.toContain(PRIVATE_KNOWLEDGE)
      expect(await snapshotAllRows()).toEqual(before)
      expect(onChanged).not.toHaveBeenCalled()
    } finally {
      await act(async () => releaseGate())
      observer.mockRestore()
    }
  })

  it.each(['missing', 'hash-corrupt'] as const)('fails closed during an actual %s next-Work source failure', async fault => {
    const first = await readyScripted()
    const second = await readyScripted({ privateKnowledge: OTHER_PRIVATE })
    const buildId = second.session.productBuildId
    if (buildId == null) throw new Error('negative source fixture requires a real Build preview')
    if (fault === 'missing') await db.productBuilds.delete(buildId)
    else await db.productBuilds.update(buildId, { previewHash: '0'.repeat(64) })
    const onChanged = await renderPrepared(first)
    await act(async () => button('安全投屏')?.click())
    const before = await snapshotAllRows()
    await act(async () => root?.render(guideFor(second, onChanged)))
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('冻结 TTRPG 产品校验失败'))
    expect(host.textContent).not.toContain(PRIVATE_KNOWLEDGE)
    expect(host.textContent).not.toContain(OTHER_PRIVATE)
    expect(host.querySelector('input,textarea')).toBeNull()
    expect(await snapshotAllRows()).toEqual(before)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('does not reconstruct private inventory instances inside a public character sheet', async () => {
    const { fixture } = await renderInventory()
    const content = fixture.runtimePackage.ttrpg
    if (!content) throw new Error('inventory requires real TTRPG content')
    expect(Object.keys(fixture.state.ttrpg?.product?.inventory?.items ?? {}).length).toBeGreaterThan(0)
    expect(sheet()?.textContent).toContain('物品实例')
    const publicView = createTtrpgViewerProjectionV1({ state: fixture.state, campaign: content.campaign,
      rulePack: content.rulePack.content, role: 'spectator', actorKey: null })
    expect(publicView.inventory).toEqual([])
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    const publicSheet = sheet()?.textContent ?? ''
    await act(async () => button('退出投屏')?.click())
    expect(sheet()?.textContent).toContain('物品实例')
    expect(await snapshotAllRows()).toEqual(before)
    expect(publicSheet).not.toContain('物品实例')
  })

  it('shows an actual privately discovered handout only to its ordinary owner and retains the public handout', async () => {
    await renderInventory('tabletop', false, { clues: true, handouts: true })
    expect(host.textContent).toContain(PRIVATE_HANDOUT)
    expect(host.textContent).toContain(PUBLIC_HANDOUT)
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    expect(host.textContent).not.toContain(PRIVATE_HANDOUT)
    expect(host.textContent).toContain(PUBLIC_HANDOUT)
    await act(async () => button('退出投屏')?.click())
    expect(host.textContent).toContain(PRIVATE_HANDOUT)
    expect(await snapshotAllRows()).toEqual(before)
  })

  it('preserves the real GM-only map area for the GM and the public map for theater', async () => {
    await renderInventory('tabletop', false, { tabletop: true })
    expect(host.textContent).not.toContain(PRIVATE_TABLETOP)
    await act(async () => button('主持人视图')?.click())
    expect(host.textContent).toContain(PRIVATE_TABLETOP)
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    expect(host.textContent).not.toContain(PRIVATE_TABLETOP)
    expect(host.textContent).toContain('QUALITY080 public map')
    await act(async () => button('退出投屏')?.click())
    expect(host.textContent).not.toContain(PRIVATE_TABLETOP)
    await act(async () => button('主持人视图')?.click())
    expect(host.textContent).toContain(PRIVATE_TABLETOP)
    expect(await snapshotAllRows()).toEqual(before)
  })

  it('preserves an unsubmitted GM-only cross-session memory without putting it in theater DOM', async () => {
    await renderInventory('history', false, { activeCampaign: true })
    await act(async () => button('主持人视图')?.click())
    const memory = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="长期战役跨场记忆"]')
    await changeField(memory(), PRIVATE_MEMORY_DRAFT)
    const audience = () => host.querySelector<HTMLSelectElement>('select[aria-label="长期战役记忆受众"]')
    await act(async () => {
      const select = audience()
      if (!select) throw new Error('memory requires its actual audience control')
      select.value = 'gm-only'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const before = await snapshotAllRows()
    await act(async () => button('安全投屏')?.click())
    expect(host.textContent).not.toContain(PRIVATE_MEMORY_DRAFT)
    expect([...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')]
      .map(row => row.value).join('\n')).not.toContain(PRIVATE_MEMORY_DRAFT)
    await act(async () => button('退出投屏')?.click())
    expect(button('玩家视图')?.getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('主持人视图')?.click())
    expect(memory()?.value).toBe(PRIVATE_MEMORY_DRAFT)
    expect(audience()?.value).toBe('gm-only')
    expect(await snapshotAllRows()).toEqual(before)
  })
})
