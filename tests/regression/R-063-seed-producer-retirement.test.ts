import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as adoption from '../../src/lib/registry/adopt'
import { createSaltRidgeWorldV1, verifySaltRidgeShowcaseSourceV1 } from '../../src/lib/world-engine/salt-ridge-preset'
import { createMistHarborWorld } from '../../src/lib/world-engine/mist-harbor-preset'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { hashWorldReleaseValueV1 } from '../../src/lib/world-engine/release-hash'
import { readWorldReleaseEditionV3, verifyPureWorldReleaseManifestV3 } from '../../src/lib/world-engine/release-codec'
import { TOOL_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-tools'
import { usePromptStore } from '../../src/stores/prompt'

beforeEach(async () => {
  await db.delete(); await db.open()
  usePromptStore.setState({ templates: [], loaded: false })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('063 isolated seed checks prohibit network/model requests') }))
})
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  usePromptStore.setState({ templates: [], loaded: false })
  db.close()
})

async function seedSaltEdition() {
  const made = await createSaltRidgeWorldV1()
  const release = await db.worldReleases.get(made.worldReleaseId)
  if (!release) throw new Error('Missing actual seeded WorldRelease')
  const input = { manifest: release.manifestJson, expectedContentHash: release.contentHash, expectedWorldCode: release.sourceWorldCode }
  const manifest = await verifyPureWorldReleaseManifestV3(input)
  const edition = await readWorldReleaseEditionV3(input)
  return { made, release, manifest, edition }
}

it('calibrates the new salt edition against exactly the original category-key delta across independent installs', async () => {
  const first = await seedSaltEdition()
  // Reconstruct only the one intended semantic difference, independently of the allowlist.
  const oldContent = Object.fromEntries(Object.entries(first.manifest.records).filter(([, rows]) => rows.length).map(([table, rows]) => [
    table, rows.map(row => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid verified semantic row')
      const record: Record<string, unknown> = { ...row }
      const { createdAt: _created, updatedAt: _updated, ragDocumentId: _localDocument, ...portable } = record
      return portable
    }),
  ]))
  const lore = oldContent.codexCategories?.filter(row => row.name === '盐脊地方知识') ?? []
  expect(lore).toHaveLength(1)
  expect(lore[0]).not.toHaveProperty('builtInKey')
  lore[0].builtInKey = 'humEvent'
  const originalEditionHash = await hashWorldReleaseValueV1(oldContent)
  expect(originalEditionHash).toBe('3d5917b91c01073aab9ee9c093706e99d099f5014d89ba15a1259fc18e895390')
  await db.delete(); await db.open()
  const second = await seedSaltEdition()
  expect(second.edition.editionHash).toBe(first.edition.editionHash)
  expect(second.edition.sourceWorkspaceUid).toBe(first.edition.sourceWorkspaceUid)
  const calibration = {
    first: first.edition, second: second.edition, originalEditionHash,
    allowedDelta: 'only codexCategories[盐脊地方知识].builtInKey humEvent -> absent; all other normalized semantic records unchanged',
    firstContentHash: first.release.contentHash, secondContentHash: second.release.contentHash,
  }
  const evidencePath = process.env.STORYFORGE_063_CALIBRATION_RECEIPT
  if (evidencePath) writeFileSync(evidencePath, JSON.stringify(calibration, null, 2) + '\n', { flag: 'wx' })
})

for (const [label, createWorld, categoryName, names] of [
  ['salt', createSaltRidgeWorldV1, '盐脊地方知识', ['潮脉与潮井', '旧引潮机', '盐灯商会', '拾潮民议会', '迟砾的测潮尺', '分流阀芯图', '井钟礼']],
  ['mist', createMistHarborWorld, '雾港世界知识', ['黑潮事故', '守灯人旧誓']],
] as const) {
  it(`${label}: new lore follows its exact adoption receipt and leaves an existing reused humEvent untouched`, async () => {
    const originalAdopt = adoption.adopt
    let legacyCategoryId: number | undefined
    let legacyEntryId: number | undefined
    let actualCategoryId: number | undefined
    let legacyCategory: unknown
    let legacyEntry: unknown
    vi.spyOn(adoption, 'adopt').mockImplementation(async input => {
      const categoryData = input.data !== null && typeof input.data === 'object' ? input.data : null
      const loreAdd = input.target === 'codexCategories' && input.mode === 'add'
        && categoryData !== null && 'name' in categoryData && categoryData.name === categoryName
      if (loreAdd && legacyCategoryId === undefined) {
        const old = await originalAdopt({ ...input, data: { ...categoryData, builtInKey: 'humEvent', name: '作者复用的设施分类' } })
        legacyCategoryId = old.written[0]?.id
        if (!legacyCategoryId) throw new Error('Missing isolated legacy category fixture')
        const entry = await originalAdopt({ ...input, target: 'codexEntries', mode: 'add', data: {
          categoryId: legacyCategoryId, name: '作者纪念灯', summary: '仅用来照明', description: '保留原作者知识', fields: {}, refs: {}, tags: ['旧分类沿用'], order: 0,
        } })
        legacyEntryId = entry.written[0]?.id
        if (!legacyEntryId) throw new Error('Missing isolated legacy entry fixture')
        legacyCategory = await db.codexCategories.get(legacyCategoryId)
        legacyEntry = await db.codexEntries.get(legacyEntryId)
      }
      const result = await originalAdopt(input)
      if (loreAdd) actualCategoryId = result.written[0]?.id
      return result
    })
    const made = await createWorld()
    expect(actualCategoryId).toBeDefined()
    expect(actualCategoryId).not.toBe(legacyCategoryId)
    const category = await db.codexCategories.get(actualCategoryId!)
    expect(category).toEqual(expect.objectContaining({ projectId: made.scope.projectId, worldId: made.scope.worldId, name: categoryName }))
    expect(category?.builtInKey).toBeUndefined()
    const entries = await db.codexEntries.where('categoryId').equals(actualCategoryId!).sortBy('order')
    expect(entries.map(row => row.name)).toEqual([...names])
    expect(entries.every(row => row.projectId === made.scope.projectId && row.summary && row.description)).toBe(true)
    expect(await db.codexCategories.get(legacyCategoryId!)).toEqual(legacyCategory)
    expect(await db.codexEntries.get(legacyEntryId!)).toEqual(legacyEntry)
    // Existing frozen installations return without reseeding or converting any current rows.
    const before = { categories: await db.codexCategories.toArray(), entries: await db.codexEntries.toArray(), releases: await db.worldReleases.toArray() }
    expect((await createWorld()).worldReleaseId).toBe(made.worldReleaseId)
    expect({ categories: await db.codexCategories.toArray(), entries: await db.codexEntries.toArray(), releases: await db.worldReleases.toArray() }).toEqual(before)
  })
}

it('admits the actual new salt edition and rejects a different authored edition or foreign owner', async () => {
  const { made, release } = await seedSaltEdition()
  await expect(verifySaltRidgeShowcaseSourceV1(made.scope, made.worldReleaseId)).resolves.toEqual({ contentHash: release.contentHash, scope: made.scope })
  await expect(verifySaltRidgeShowcaseSourceV1({ ...made.scope, worldId: made.scope.worldId + 1000 }, made.worldReleaseId)).rejects.toThrow('不属于该世界')
  const category = await db.codexCategories.where('projectId').equals(made.scope.projectId).filter(row => row.name === '盐脊地方知识').first()
  if (!category?.id) throw new Error('Missing new custom lore')
  await db.codexCategories.update(category.id, { name: '作者实际改编的地方知识' })
  const revision = await createWorldRevision({ scope: made.scope, label: '不同作者版本' })
  const changed = await publishWorldRevision(revision.id!)
  await expect(verifySaltRidgeShowcaseSourceV1(made.scope, changed.id!)).rejects.toThrow('冻结来源与内置盐脊展示作品不一致')
  expect(await db.worldReleases.get(made.worldReleaseId)).toEqual(release)
})

it('keeps the original installed edition, author rows and runtime evidence byte-exact on reopen', async () => {
  const prefix = resolve('tests/fixtures/salt-ridge/sfqa132-original-public-install')
  const bytes = readFileSync(`${prefix}.json.gz`)
  const provenance = JSON.parse(readFileSync(`${prefix}.provenance.json`, 'utf8')) as { compressedSHA256: string; uncompressedSHA256: string }
  const raw = gunzipSync(bytes)
  const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex')
  expect(digest(bytes)).toBe(provenance.compressedSHA256)
  expect(digest(raw)).toBe(provenance.uncompressedSHA256)
  const fixture = JSON.parse(raw.toString('utf8')) as { tables: Record<string, object[]> }
  await db.transaction('rw', db.tables, async () => {
    for (const [name, rows] of Object.entries(fixture.tables)) if (rows.length) await db.table(name).bulkPut(rows)
  })
  const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
  const before = await snapshot()
  const made = await createSaltRidgeWorldV1()
  await expect(verifySaltRidgeShowcaseSourceV1(made.scope, made.worldReleaseId)).resolves.toEqual(expect.objectContaining({ contentHash: expect.any(String) }))
  expect(await snapshot()).toEqual(before)
})

it('refreshes current system variables while keeping user template bytes and active selection', async () => {
  const seed = TOOL_PROMPT_SEEDS.find(row => row.moduleKey === 'codex.extract')!
  const userId = await db.promptTemplates.add({ ...seed, scope: 'user', name: '作者沿用旧变量的模板', isActive: true,
    systemPrompt: '作者原文 {{codex_humEvent}}', variables: [...seed.variables, 'codex_humEvent'], createdAt: 1, updatedAt: 1 })
  const systemId = await db.promptTemplates.add({ ...seed, isActive: false, variables: [...seed.variables, 'codex_humEra', 'codex_humEvent'], createdAt: 1, updatedAt: 1 })
  const user = await db.promptTemplates.get(userId)
  await usePromptStore.getState().init()
  expect(await db.promptTemplates.get(userId)).toEqual(user)
  expect(usePromptStore.getState().getActive('codex.extract')).toEqual(user)
  const system = await db.promptTemplates.get(systemId)
  expect(system?.isActive).toBe(false)
  expect(system?.variables).not.toContain('codex_humEra')
  expect(system?.variables).not.toContain('codex_humEvent')
  expect(system?.variables).toContain('codex_humSociety')
})
