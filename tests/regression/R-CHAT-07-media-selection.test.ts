import {expect, it} from 'vitest'
import {createChatMediaReviewSourceV1, confirmChatMediaSelectionV1, readConfirmedChatMediaV1} from '../../src/lib/character-interaction/media-selection'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import type {FrozenRuntimeMediaAssetV2} from '../../src/lib/types'
import type {ChatMediaBindingsV1} from '../../src/lib/character-interaction/media-contract'
import {chatNarrativeFixture} from '../helpers/chat-narrative-fixture'

function fixture() {
  const content = chatNarrativeFixture()
  const portrait: FrozenRuntimeMediaAssetV2 = {assetKey: 'guard.portrait', version: 1, kind: 'character-pose', name: '工程人物图',
    mimeType: 'image/png', byteSize: 67, width: 1, height: 1, durationMs: null,
    contentHash: 'a'.repeat(64), blobContentHash: 'a'.repeat(64), source: 'engineering-fixture', license: 'test-only', altText: '工程检查像素图', characterTag: 'character:guard', sceneTag: ''}
  const assets = [portrait, {...portrait, assetKey: 'inn.background', kind: 'background' as const, characterTag: '', sceneTag: 'inn'}]
  const bindings: ChatMediaBindingsV1 = {schema: 'storyforge.chat-media', version: 1,
    participants: [{participantKey: 'guard', avatarAssetKey: portrait.assetKey, portraitAssetKey: portrait.assetKey}],
    scenes: [{sceneKey: 'inn', location: '驿站', backgroundAssetKey: 'inn.background'}]}
  return {content, assets, bindings, source: createChatMediaReviewSourceV1(content, assets)}
}
async function selected() {
  const f = fixture(), sourceHash = await hashProductProductionValueV2(f.source)
  const confirmation = {commandId: 'author.confirm.1', submitted: {sourceHash, bindings: f.bindings}}
  return {...f, confirmation, selection: await confirmChatMediaSelectionV1({source: f.source, submitted: confirmation.submitted, authorCommandId: confirmation.commandId})}
}

it('binds explicit author selection to the complete frozen input without changing narrative, media or prior bindings', async () => {
  const f = fixture(), before = structuredClone(f)
  const sourceHash = await hashProductProductionValueV2(f.source)
  const selection = await confirmChatMediaSelectionV1({source: f.source, submitted: {sourceHash, bindings: f.bindings}, authorCommandId: 'author.confirm.1'})
  expect(await readConfirmedChatMediaV1(selection, f.source, {commandId: 'author.confirm.1', submitted: {sourceHash, bindings: f.bindings}})).toEqual(f.bindings)
  expect(f).toEqual(before)
  const reordered = createChatMediaReviewSourceV1(f.content, [...f.assets].reverse())
  expect(await hashProductProductionValueV2(reordered)).toBe(sourceHash)
  const withPrior = createChatMediaReviewSourceV1({...f.content, chatMedia: f.bindings}, f.assets)
  expect(withPrior).toEqual(f.source)
})

it.each(['bytes', 'license', 'character', 'place', 'source'] as const)('requires renewed confirmation after %s changes', async kind => {
  const f = await selected(), content = structuredClone(f.content), assets = structuredClone(f.assets)
  if (kind === 'bytes') assets[0].contentHash = assets[0].blobContentHash = 'b'.repeat(64)
  if (kind === 'license') assets[0].license = 'changed-rights'
  if (kind === 'source') assets[0].source = 'changed-origin'
  if (kind === 'character') content.profiles[0].name = '另一个呈现名称'
  if (kind === 'place') content.sceneTemplates[0].location = '后院'
  const changed = createChatMediaReviewSourceV1(content, assets)
  await expect(readConfirmedChatMediaV1(f.selection, changed, f.confirmation)).rejects.toThrow('重新查看并确认')
})

it('cannot turn a forged command, old schema or extra policy field into an approval', async () => {
  const f = await selected()
  await expect(readConfirmedChatMediaV1(f.selection, f.source, {...f.confirmation, commandId: 'different.command'})).rejects.toThrow('作者命令')
  await expect(readConfirmedChatMediaV1({...f.selection, version: 2}, f.source, f.confirmation)).rejects.toThrow()
  await expect(readConfirmedChatMediaV1({...f.selection, bypass: true}, f.source, f.confirmation)).rejects.toThrow('字段')
  const alteredChoice = structuredClone(f.selection); alteredChoice.bindings.participants[0].avatarAssetKey = null
  await expect(readConfirmedChatMediaV1(alteredChoice, f.source, f.confirmation)).rejects.toThrow('作者命令')
  await expect(confirmChatMediaSelectionV1({source: f.source, submitted: {sourceHash: f.selection.sourceHash, bindings: f.bindings}, authorCommandId: ''})).rejects.toThrow('作者确认命令')
})

it('rejects ambiguous, unsupported and unlicensed media before confirming it', async () => {
  const f = fixture()
  expect(() => createChatMediaReviewSourceV1(f.content, [...f.assets, f.assets[0]])).toThrow('重复')
  expect(() => createChatMediaReviewSourceV1(f.content, [{...f.assets[0], license: ''}])).toThrow('许可')
  expect(() => createChatMediaReviewSourceV1(f.content, [{...f.assets[0], blobContentHash: 'c'.repeat(64)}])).toThrow('字节')
  expect(() => createChatMediaReviewSourceV1(f.content, [{...f.assets[0], kind: 'voice'}])).toThrow('类型')
  const sourceHash = await hashProductProductionValueV2(f.source), bad = structuredClone(f.bindings)
  bad.participants[0].participantKey = 'unselected-role'
  await expect(confirmChatMediaSelectionV1({source: f.source, submitted: {sourceHash, bindings: bad}, authorCommandId: 'author.confirm.1'})).rejects.toThrow('冻结版本')
})

it('captures the actual submitted choice before asynchronous hashing and returns an independent value', async () => {
  const f = fixture(), sourceHash = await hashProductProductionValueV2(f.source)
  const input = {source: f.source, submitted: {sourceHash, bindings: f.bindings}, authorCommandId: 'author.confirm.1'}
  const pending = confirmChatMediaSelectionV1(input)
  input.submitted.bindings.participants[0].avatarAssetKey = null
  input.authorCommandId = 'late.command'
  input.source.interaction.profiles[0].name = '迟到改名'
  const selection = await pending
  expect(selection.authorCommandId).toBe('author.confirm.1')
  expect(selection.bindings.participants[0].avatarAssetKey).toBe('guard.portrait')
  expect(selection.sourceHash).toBe(sourceHash)
})
