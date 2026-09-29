import { describe, expect, it } from 'vitest'
import { isTextAdventureClockCapacityRevisionV1 } from '../../src/lib/product-production/clock-capacity-revision'
import { hasFrozenAuthorUploadRightsV1 } from '../../src/lib/product-production/media-rights'

describe('文字冒险终检修复边界', () => {
  const original = { schema: 'storyforge.text-adventure-systems-artifact', version: 1,
    resources: [{ key: 'clock', role: 'clock', initial: 0, minimum: 0, maximum: 100 }], abilities: [] }
  it('允许修正分钟容量，拒绝降低上限、无变化和夹带系统变化', () => {
    const revised = structuredClone(original)
    revised.resources[0].maximum = 4320
    expect(isTextAdventureClockCapacityRevisionV1(original, revised)).toBe(true)
    expect(isTextAdventureClockCapacityRevisionV1(original, original)).toBe(false)
    expect(isTextAdventureClockCapacityRevisionV1(revised, original)).toBe(false)
    revised.resources[0].initial = 1
    expect(isTextAdventureClockCapacityRevisionV1(original, revised)).toBe(false)
    expect(isTextAdventureClockCapacityRevisionV1(original, {})).toBe(false)
  })
  const asset = { assetKey: 'image.1', contentHash: 'a'.repeat(64), source: 'author-upload', license: 'Original AI artwork' }
  const declaration = { origin: 'author-upload', license: asset.license,
    commercialUse: true, redistribution: true, declaration: 'Created for this production.' }
  const entry = { ...asset, declaration }
  it('完整上传权利声明按资产 key、hash、来源和许可证冻结', () => {
    expect(hasFrozenAuthorUploadRightsV1(asset, { mediaLicenses: [entry] })).toBe(true)
    expect(hasFrozenAuthorUploadRightsV1(asset, { mediaLicenses: [{ ...entry, contentHash: 'b'.repeat(64) }] })).toBe(false)
    expect(hasFrozenAuthorUploadRightsV1(asset, { mediaLicenses: [entry, entry] })).toBe(false)
    expect(hasFrozenAuthorUploadRightsV1(asset, {})).toBe(false)
    for (const field of ['commercialUse', 'redistribution', 'declaration', 'license']) {
      expect(hasFrozenAuthorUploadRightsV1(asset, { mediaLicenses: [{ ...entry, declaration: { ...declaration, [field]: null } }] })).toBe(false)
    }
  })
})
