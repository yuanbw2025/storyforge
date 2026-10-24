import {describe, expect, it} from 'vitest'
import {chatMediaFrameV1} from '../../src/lib/character-interaction/media-contract'
import {createInitialInteractionState} from '../../src/lib/character-interaction/runtime'
import {chatNarrativeShellV1} from '../../src/lib/character-interaction/narrative-production'
import {parseProductRuntimePackageV1} from '../../src/lib/product-production/runtime-package'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {createProductBuildPreviewManifestV1, verifyProductBuildPreviewManifestV1} from '../../src/lib/product-production/preview-manifest'
import type {FrozenRuntimeMediaAssetV2, ProductRuntimePackageV1} from '../../src/lib/types'
import {chatNarrativeFixture} from '../helpers/chat-narrative-fixture'
import {currentProductSelection} from '../helpers/current-product-world'

function fixture(withMedia = true): ProductRuntimePackageV1 {
  const characterKeys = ['world-release:fixture:semantic:character:1', 'world-release:fixture:semantic:character:2']
  const interaction = chatNarrativeFixture('1'.repeat(64), characterKeys), {schema: _schema, version: _version, ...narrative} = chatNarrativeShellV1(interaction.chatNarrative!)
  const pkg: ProductRuntimePackageV1 = {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'character-interaction',
    definition: {productKey: 'chat.media.fixture', title: '图片合同工程夹具', description: '', enabledCapabilities: ['narrative', 'interaction'], rulesetVersion: 1, initialVariables: {}},
    sourceWorld: {contentHash: '1'.repeat(64), selection: currentProductSelection('character-interaction', {participants: characterKeys})},
    narrative, interaction,
  }
  if (withMedia) {
    const image: FrozenRuntimeMediaAssetV2 = {assetKey: 'guard.portrait', version: 1, kind: 'character-pose', name: '守卫', mimeType: 'image/png', byteSize: 67,
      width: 1, height: 1, durationMs: null, contentHash: 'a'.repeat(64), blobContentHash: 'a'.repeat(64), source: 'engineering-fixture', license: 'test-only', altText: '守卫的工程测试图片', characterTag: characterKeys[0], sceneTag: ''}
    pkg.presentation = {version: 1, cues: [], assets: [image, {...image, assetKey: 'inn.background', kind: 'background', name: '驿站', characterTag: '', sceneTag: 'inn'}]}
    pkg.definition.enabledCapabilities.push('presentation')
    interaction.chatMedia = {schema: 'storyforge.chat-media', version: 1,
      participants: [{participantKey: 'guard', avatarAssetKey: image.assetKey, portraitAssetKey: image.assetKey}],
      scenes: [{sceneKey: 'inn', location: '驿站', backgroundAssetKey: 'inn.background'}]}
  }
  return pkg
}

describe('CHAT-07 frozen player media foundation', () => {
  it('preserves old text-only packages byte-for-byte and parses the new optional catalog without scheduling beats', async () => {
    for (const raw of [fixture(false), fixture()]) {
      const parsed = parseProductRuntimePackageV1(raw)
      if (!raw.presentation) expect(JSON.stringify(parsed)).toBe(JSON.stringify(raw))
      else expect(parsed).toEqual(raw)
      expect(JSON.stringify(parseProductRuntimePackageV1(parsed))).toBe(JSON.stringify(parsed))
      expect(await hashProductProductionValueV2(parsed)).toBe(await hashProductProductionValueV2(raw))
      expect(createInitialInteractionState(parsed.interaction!)).toEqual(createInitialInteractionState(fixture(false).interaction!))
    }
  })
  it('requires matching product capability, bindings and media catalog', () => {
    const missingBinding = fixture(); delete missingBinding.interaction!.chatMedia
    const missingCatalog = fixture(); delete missingCatalog.presentation; missingCatalog.definition.enabledCapabilities.pop()
    const missingCapability = fixture(); missingCapability.definition.enabledCapabilities.pop()
    const crossProduct = fixture(); crossProduct.productType = 'ai-town'
    delete crossProduct.interaction!.chatSource; delete crossProduct.interaction!.chatNarrative
    for (const invalid of [missingBinding, missingCatalog, missingCapability]) expect(() => parseProductRuntimePackageV1(invalid)).toThrow(/图片目录与绑定|enabledCapabilities/)
    expect(() => parseProductRuntimePackageV1(crossProduct)).toThrow('角色图片绑定只属于角色聊天产品')
  })
  it('uses existing hashed Build preview media bindings and rejects a mismatched binary reference', async () => {
    const runtimePackage = fixture()
    const preview = await createProductBuildPreviewManifestV1({productionKey: 'chat.media.fixture', buildNumber: 1, buildManifestHash: 'b'.repeat(64), runtimePackage,
      mediaBindings: runtimePackage.presentation!.assets.map(asset => ({assetKey: asset.assetKey, artifactKey: `media.${asset.assetKey}`, blobContentHash: asset.blobContentHash}))})
    expect(await verifyProductBuildPreviewManifestV1(preview)).toEqual(preview)
    const bad = structuredClone(preview); bad.mediaBindings[0].blobContentHash = 'c'.repeat(64)
    await expect(verifyProductBuildPreviewManifestV1(bad)).rejects.toThrow()
  })
  it('rejects future beat cues instead of executing AVG presentation from chat', () => {
    const pkg = fixture()
    pkg.presentation!.cues.push({cueKey: 'reveal-future', beatKey: pkg.narrative.beats[0].beatKey, phase: 'before', type: 'set-background', assetKey: 'inn.background', durationMs: 0, easing: 'linear', order: 0})
    expect(() => parseProductRuntimePackageV1(pkg)).toThrow('预设节拍')
  })
  it.each(['missing-role', 'missing-scene', 'wrong-location', 'wrong-asset', 'duplicate-role', 'duplicate-scene', 'unknown-field', 'wrong-version'] as const)('rejects broken or ambiguous binding: %s', kind => {
    const pkg = fixture(), media = pkg.interaction!.chatMedia!
    if (kind === 'missing-role') media.participants[0].participantKey = 'unknown'
    if (kind === 'missing-scene') media.scenes[0].sceneKey = 'unknown'
    if (kind === 'wrong-location') media.scenes[0].location = '隐秘地窖'
    if (kind === 'wrong-asset') media.participants[0].avatarAssetKey = 'missing'
    if (kind === 'duplicate-role') media.participants.push({...media.participants[0]})
    if (kind === 'duplicate-scene') media.scenes.push({...media.scenes[0]})
    if (kind === 'unknown-field') Object.assign(media, {secretCue: 'future'})
    if (kind === 'wrong-version') Object.assign(media, {version: 2})
    expect(() => parseProductRuntimePackageV1(pkg)).toThrow(/chat-media/)
  })
  it.each(['voice', 'html', 'zero-size', 'wrong-character', 'wrong-scene', 'unbound'] as const)('rejects an incompatible asset: %s', kind => {
    const pkg = fixture(), assets = pkg.presentation!.assets
    if (kind === 'voice') assets[0].kind = 'voice'
    if (kind === 'html') assets[0].mimeType = 'text/html'
    if (kind === 'zero-size') assets[0].width = 0
    if (kind === 'wrong-character') assets[0].characterTag = 'character:artisan'
    if (kind === 'wrong-scene') assets[1].sceneTag = 'other-scene'
    if (kind === 'unbound') assets.push({...assets[0], assetKey: 'unused'})
    expect(() => parseProductRuntimePackageV1(pkg)).toThrow(/chat-media|presentation/)
  })
  it('selects committed presence/location, clears stale backgrounds and leaves state unchanged', () => {
    const pkg = parseProductRuntimePackageV1(fixture()), state = createInitialInteractionState(pkg.interaction!)
    expect(chatMediaFrameV1(pkg, state)).toEqual({backgroundAssetKey: null, participants: []})
    state.activeScene = {...state.sceneTemplates[0], sceneId: 'current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
    const before = structuredClone(state)
    expect(chatMediaFrameV1(pkg, state)).toEqual({backgroundAssetKey: 'inn.background', participants: pkg.interaction!.chatMedia!.participants})
    expect(state).toEqual(before)
    state.activeScene.activeParticipantKeys = ['artisan']
    expect(chatMediaFrameV1(pkg, state).participants).toEqual([])
    state.activeScene.location = '后院'
    expect(chatMediaFrameV1(pkg, state).backgroundAssetKey).toBeNull()
    state.chatNarrative!.situation.possibilities.push({actorKey: 'artisan', text: '打算回驿站', evidenceFactKeys: ['road']})
    expect(chatMediaFrameV1(pkg, state).backgroundAssetKey).toBeNull()
  })
})
