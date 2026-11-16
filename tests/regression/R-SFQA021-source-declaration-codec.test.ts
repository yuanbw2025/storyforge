import { describe, expect, it } from 'vitest'
import { encodeWorldSourceDeclarationV1, inspectCommunityWorldOriginV1, parseWorldSourceDeclarationV1 } from '../../src/lib/world-engine/source-declaration'
import { sfqa021Manifest } from '../helpers/sfqa021-sharing'

describe('SFQA021 F1 · portable declaration consistency, without usage authorization', () => {
  // Independently calculated UTF-8 canonical vectors; no production hash helper.
  const goldenHashes = {"3": "580cf3162a3c48cb5e978ffb2702a6d95866f5abe241653d1bd2a5faeeed35e1", "4": "513a4e60d9000d9ff314d752643e7373d2cb0f527468552e30bce2f5e2d76d3a", "5": "671ebdaef1efcbbba6fd50568c22e319e9cc0eaba829e8d91a0426d6c0812dad"}
  it.each([3, 4, 5] as const)('v%i canonical declaration hash keeps its pinned bytes', packageVersion => {
    expect(encodeWorldSourceDeclarationV1({ manifest: sfqa021Manifest, packageVersion,
      packageDigest: 'b'.repeat(64) }).declarationHash).toBe(goldenHashes[packageVersion])
  })

  it.each([3, 4, 5] as const)('v%i declarations retain original text, flags, warning order and separate wire identity', packageVersion => {
    const manifest = structuredClone(sfqa021Manifest), before = structuredClone(manifest)
    const declaration = encodeWorldSourceDeclarationV1({ manifest, packageVersion, packageDigest: 'b'.repeat(64) })
    expect(manifest).toEqual(before)
    expect(parseWorldSourceDeclarationV1(JSON.parse(JSON.stringify(declaration)))).toEqual(declaration)
    expect(declaration).toMatchObject({ ...before, packageVersion, packageDigest: 'b'.repeat(64) })
    expect(declaration.declarationHash).toMatch(/^[a-f0-9]{64}$/)
    expect(declaration.declarationHash).not.toBe(declaration.packageDigest)
    expect(declaration.declarationHash).not.toBe(declaration.releaseHash)
    const inspected = inspectCommunityWorldOriginV1({ ...declaration, importedAt: 1_700_000_001_000 })
    expect(inspected).toEqual({ status: 'self-consistent', declaration, errors: [] })
    expect(inspected).not.toHaveProperty('allowed')
    expect(inspected).not.toHaveProperty('permission')
    expect(inspectCommunityWorldOriginV1({ ...declaration, importedAt: 1_800_000_001_000 }).declaration?.declarationHash).toBe(declaration.declarationHash)
  })

  it('returns detached values; edits do not mutate input and no longer verify with the old hash', () => {
    const manifest = structuredClone(sfqa021Manifest)
    const declaration = encodeWorldSourceDeclarationV1({ manifest, packageVersion: 3, packageDigest: 'b'.repeat(64) })
    const parsed = parseWorldSourceDeclarationV1(declaration)
    parsed.allowedUses.avg = true; parsed.contentWarnings.push('新的警告')
    expect(manifest.allowedUses.avg).toBe(false)
    expect(declaration.allowedUses.avg).toBe(false)
    expect(declaration.contentWarnings).toEqual(sfqa021Manifest.contentWarnings)
    expect(() => parseWorldSourceDeclarationV1(parsed)).toThrow('摘要不匹配')
  })

  it.each([
    { version: 2 }, { schema: 'other' }, { packageVersion: 6 },
    { packageDigest: 'not-a-hash' }, { declarationHash: 'c'.repeat(64) },
    { packageId: 'another-package' }, { sourceWorldVersion: 8 },
    { authorName: '另一个作者' }, { attribution: '被替换的署名' },
    { contentWarnings: ['警'.repeat(201)] }, { allowedUses: { ttrpg: true } },
    { worldId: 999 }, { localReleaseRecordId: 5 },
  ])('rejects unsupported, altered or local declaration fields %j', patch => {
    const declaration = encodeWorldSourceDeclarationV1({ manifest: sfqa021Manifest, packageVersion: 4, packageDigest: 'b'.repeat(64) })
    const corrupted = { ...declaration, ...patch }, before = structuredClone(corrupted)
    expect(() => parseWorldSourceDeclarationV1(corrupted)).toThrow()
    const report = inspectCommunityWorldOriginV1({ ...corrupted, importedAt: 1_700_000_001_000 })
    expect(report.status).toBe('invalid'); expect(report.errors.length).toBeGreaterThan(0)
    expect(corrupted).toEqual(before)
  })

  it('does not silently hide reserved extra metadata while encoding', () => {
    const manifest = { ...sfqa021Manifest, schema: 'injected' }
    expect(() => encodeWorldSourceDeclarationV1({ manifest,
      packageVersion: 3, packageDigest: 'b'.repeat(64) })).toThrow('未知字段')
  })

  it.each([undefined, null, { packageId: 'old', authorName: '旧作者', license: 'CC-BY-4.0',
    sourceWorldCode: 'old-world', sourceWorldVersion: 1, importedAt: 42 },
  { ...sfqa021Manifest, importedAt: 42 }])('keeps old/absent unversioned information unknown without adding flags %j', value => {
    const before = structuredClone(value)
    expect(inspectCommunityWorldOriginV1(value)).toEqual({ status: 'unknown', declaration: null, errors: [] })
    expect(value).toEqual(before)
  })

  it('requires the installed carrier timestamp without putting it in declaration bytes', () => {
    const declaration = encodeWorldSourceDeclarationV1({ manifest: sfqa021Manifest, packageVersion: 5, packageDigest: 'b'.repeat(64) })
    expect(inspectCommunityWorldOriginV1(declaration).status).toBe('invalid')
    expect(inspectCommunityWorldOriginV1({ ...declaration, importedAt: Number.NaN }).status).toBe('invalid')
    expect(() => parseWorldSourceDeclarationV1({ ...declaration, importedAt: 42 })).toThrow('未知字段')
  })
})
