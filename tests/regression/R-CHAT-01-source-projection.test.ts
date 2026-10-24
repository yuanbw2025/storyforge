import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { loadCurrentProductWorldSourceCatalogV1, seedCurrentProductWorld } from '../helpers/current-product-world'
import {
  createChatSourceProjectionDraftV1, readChatSourceProjectionViewV1,
  type ChatSourceClassificationV1,
} from '../../src/lib/character-interaction/source-projection'

beforeEach(async () => { db.close(); await db.delete(); await db.open() })
afterEach(() => db.close())

async function source() {
  const world = await seedCurrentProductWorld('CHAT-PROJECTION')
  const catalog = await loadCurrentProductWorldSourceCatalogV1({
    scope: world.scope, worldReleaseId: world.release.id!, productType: 'character-interaction',
  })
  const input = {
    worldReferenceHash: catalog.worldReference.referenceHash,
    worldReleaseHash: world.release.contentHash,
    characterResourceKeys: catalog.characters.map(character => character.resourceKey).reverse(),
    resources: catalog.resources,
  }
  return { input, draft: await createChatSourceProjectionDraftV1(input), catalog, world }
}

describe('CHAT-01 · immutable Gateway projection and viewpoint filtering', () => {
  it('splits escaped and Unicode text without dropping whitespace, breaking pairs or changing short-field identity', async () => {
    const {input, draft} = await source()
    const target = input.resources.find(r => r.descriptor.resourceKey === input.characterResourceKeys[0])!
    const value = '\u0000"\\\n🌕中文原文 '.repeat(1600) + '末尾证据'
    target.value.background = value
    target.descriptor.contentHash = await hashCanonicalValue(target.value)
    const projected = await createChatSourceProjectionDraftV1(input)
    const owner = projected.characters.find(c => c.resourceKey === target.descriptor.resourceKey)!
    const fragments = owner.fragments.filter(f => f.pointer === '/background')
    expect(fragments.length).toBeGreaterThan(1)
    expect(fragments.map(f => JSON.parse(f.valueJson)).join('')).toBe(value)
    let offset = 0
    for (const f of fragments) {
      const content = JSON.parse(f.valueJson) as string
      expect(f.textRange).toEqual({start: offset, end: offset + content.length})
      expect(f.valueJson.length).toBeLessThanOrEqual(6000)
      expect(content).toBe(value.slice(f.textRange!.start, f.textRange!.end))
      expect(/[\uD800-\uDBFF]$/.test(content)).toBe(false)
      offset += content.length
    }
    expect(owner.fragments.find(f => f.pointer === '/name')).toEqual(draft.characters.find(c => c.resourceKey === owner.resourceKey)!.fragments.find(f => f.pointer === '/name'))
  })
  it('keeps a caller transaction alive across source and projection hashing', async () => {
    const {input, world} = await source()
    await db.transaction('r', db.projects, async () => {
      await createChatSourceProjectionDraftV1(input)
      expect(await db.projects.get(world.scope.projectId)).toBeDefined()
    })
  })
  it('preserves nested arrays, escaped object paths, empty values and long Unicode leaves without oversized fragments', async () => {
    const {input} = await source()
    const target = input.resources.find(r => r.descriptor.resourceKey === input.characterResourceKeys[0])!
    const original = {
      'a/b~c': [{title: '经历一', text: '🌕守灯记事。\n'.repeat(1600)}, {title: '经历二', text: '不可漏掉的末条'}],
      '': {empty: [], blank: {}, none: null, no: false, zero: 0},
      '0': ['数组次序一', '数组次序二'],
    }
    target.value.records = original
    target.descriptor.contentHash = await hashCanonicalValue(target.value)
    const draft = await createChatSourceProjectionDraftV1(input)
    const fragments = draft.characters.find(c => c.resourceKey === target.descriptor.resourceKey)!.fragments.filter(f => f.pointer.startsWith('/records/'))
    expect(fragments.length).toBeGreaterThan(3)
    expect(fragments.every(f => f.valueJson.length <= 6000)).toBe(true)
    expect(fragments.some(f => f.pointer === '/records/a~1b~0c/0/text' && f.textRange)).toBe(true)
    const restore = (value: unknown, pointer: string): unknown => {
      const parts = fragments.filter(f => f.pointer === pointer)
      if (parts.length) return parts[0].textRange ? parts.map(f => JSON.parse(f.valueJson)).join('') : JSON.parse(parts[0].valueJson)
      if (Array.isArray(value)) return value.map((v, i) => restore(v, `${pointer}/${i}`))
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, restore(v, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`)]))
      throw new Error(`uncovered source: ${pointer}`)
    }
    expect(restore(original, '/records')).toEqual(original)
    expect(await createChatSourceProjectionDraftV1(input)).toEqual(draft)
    expect(await readChatSourceProjectionViewV1({draft, classifications: [], viewerKey: 'player'})).toEqual([])
    const publicItem = fragments.find(f => f.pointer === '/records/a~1b~0c/1')!
    const view = await readChatSourceProjectionViewV1({draft, viewerKey: 'player', classifications: [{
      projectionHash: draft.projectionHash, fragmentKey: publicItem.fragmentKey, purpose: 'knowledge', visibility: 'public', audienceKeys: [],
    }]})
    expect(view.map(f => f.fragmentKey)).toEqual([publicItem.fragmentKey])
    expect(JSON.stringify(view)).not.toContain('守灯记事')
  })
  it('rejects excessive structured fragments and unrepresentable source paths without truncating the source', async () => {
    const {input} = await source()
    const target = input.resources.find(r => r.descriptor.resourceKey === input.characterResourceKeys[0])!
    target.value.records = Array.from({length: 2001}, (_, i) => `条目 ${i}`)
    target.descriptor.contentHash = await hashCanonicalValue(target.value)
    await expect(createChatSourceProjectionDraftV1(input)).rejects.toThrow('超过 2000 项')
    target.value.records = {['x'.repeat(1000)]: '长正文'.repeat(3000)}
    target.descriptor.contentHash = await hashCanonicalValue(target.value)
    await expect(createChatSourceProjectionDraftV1(input)).rejects.toThrow('字段名过长')
  })
  it('retains full semantic fields, portable identities and evidence from the actual frozen gateway', async () => {
    const { input, draft } = await source()
    expect(draft.characters.map(character => character.resourceKey)).toEqual([...input.characterResourceKeys].sort())
    for (const character of draft.characters) {
      const original = input.resources.find(item => item.descriptor.resourceKey === character.resourceKey)!
      expect(character.sourceHash).toBe(original.descriptor.contentHash)
      const restored = Object.fromEntries(character.fragments.map(fragment => [
        fragment.pointer.slice(1).replace(/~1/g, '/').replace(/~0/g, '~'), JSON.parse(fragment.valueJson),
      ]))
      expect(restored).toEqual(Object.fromEntries(Object.entries(original.value).filter(([key]) => !key.startsWith('_'))))
    }
    expect(await createChatSourceProjectionDraftV1(input)).toEqual(draft)
    expect(await createChatSourceProjectionDraftV1({...input, characterResourceKeys: [...input.characterResourceKeys].reverse()})).toEqual(draft)
    expect(await readChatSourceProjectionViewV1({ draft, classifications: [], viewerKey: 'player' })).toEqual([])
  })

  it('filters knowledge, voice and goals by the same classification, including unknown and author-only fields', async () => {
    const { draft } = await source()
    const [owner, other] = draft.characters
    const fragments = owner.fragments.slice(0, 4)
    expect(fragments).toHaveLength(4)
    const classifications: ChatSourceClassificationV1[] = fragments.map((fragment, index) => ({
      projectionHash: draft.projectionHash, fragmentKey: fragment.fragmentKey,
      purpose: index === 0 ? 'voice' : 'motivation',
      visibility: (['participants', 'public', 'author-only', 'unclassified'] as const)[index],
      audienceKeys: index === 0 ? [owner.resourceKey] : [],
    }))
    const read = (viewerKey: string) => readChatSourceProjectionViewV1({ draft, classifications, viewerKey })
    expect((await read(owner.resourceKey)).map(item => item.fragmentKey)).toEqual(fragments.slice(0, 2).map(item => item.fragmentKey))
    for (const viewer of ['player', other.resourceKey]) {
      expect((await read(viewer)).map(item => item.fragmentKey)).toEqual([fragments[1].fragmentKey])
    }
  })

  it('rejects mismatched release, missing or duplicate identities and altered source content', async () => {
    const { input } = await source()
    await expect(createChatSourceProjectionDraftV1({ ...input, worldReleaseHash: 'f'.repeat(64) })).rejects.toThrow('世界版本不一致')
    await expect(createChatSourceProjectionDraftV1({ ...input, characterResourceKeys: ['foreign'] })).rejects.toThrow('角色来源缺失')
    await expect(createChatSourceProjectionDraftV1({ ...input, characterResourceKeys: [input.characterResourceKeys[0], input.characterResourceKeys[0]] })).rejects.toThrow('不重复')
    const altered = structuredClone(input)
    altered.resources.find(item => item.descriptor.resourceKey === altered.characterResourceKeys[0])!.value.background = '伪造的原文'
    await expect(createChatSourceProjectionDraftV1(altered)).rejects.toThrow('原文与资源证据不一致')
  })

  it('rejects stale classifications, unknown recipients, duplicate decisions and tampered drafts', async () => {
    const { draft } = await source()
    const decision: ChatSourceClassificationV1 = {
      projectionHash: draft.projectionHash, fragmentKey: draft.characters[0].fragments[0].fragmentKey,
      purpose: 'knowledge', visibility: 'public', audienceKeys: [],
    }
    const read = (classifications: ChatSourceClassificationV1[]) => readChatSourceProjectionViewV1({ draft, classifications, viewerKey: 'player' })
    await expect(read([{ ...decision, projectionHash: 'a'.repeat(64) }])).rejects.toThrow('已过期')
    await expect(read([{ ...decision, visibility: 'participants', audienceKeys: ['foreign'] }])).rejects.toThrow('接收者无效')
    await expect(read([{ ...decision, visibility: 'author-only', audienceKeys: ['player'] }])).rejects.toThrow('接收者不匹配')
    await expect(read([decision, decision])).rejects.toThrow('引用缺失或重复')
    const altered = structuredClone(draft)
    altered.characters[0].fragments[0].valueJson = '"篡改"'
    await expect(readChatSourceProjectionViewV1({ draft: altered, classifications: [decision], viewerKey: 'player' })).rejects.toThrow('投影内容与版本证据不一致')
  })

  it('prepares the projection on the actual chat source path without changing AI Town source preparation', async () => {
    const { catalog, world } = await source()
    expect(catalog.chatSourceProjection?.characters.map(item => item.resourceKey)).toEqual(catalog.characters.map(item => item.resourceKey))
    expect(catalog.chatSourceProjection?.worldReferenceHash).toBe(catalog.worldReference.referenceHash)
    expect(await readChatSourceProjectionViewV1({
      draft: catalog.chatSourceProjection!, classifications: [], viewerKey: 'player',
    })).toEqual([])
    const town = await loadCurrentProductWorldSourceCatalogV1({
      scope: world.scope, worldReleaseId: world.release.id!, productType: 'ai-town',
    })
    expect(town).not.toHaveProperty('chatSourceProjection')
    expect(town.characters).toEqual(catalog.characters)
  })
})
