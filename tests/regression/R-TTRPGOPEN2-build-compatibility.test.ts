import { describe, expect, it } from 'vitest'
import { openRuntimePackageFixture } from '../helpers/ttrpg-open-package'
import { createProductBuildCompatibilityReportV1 } from '../../src/lib/product-production/compatibility'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import type { ProductRuntimePackageWithTtrpgV2 } from '../../src/lib/ttrpg/content-version'

describe('R-TTRPGOPEN2 conservative open save compatibility', () => {
  async function ref(pkg: ProductRuntimePackageWithTtrpgV2, buildNumber: number) {
    return { buildNumber, runtimePackage: pkg, packageHash: await hashProductProductionValueV2(pkg) }
  }
  it('preserves identical open package identity and registers its real rule/campaign/source semantics', async () => {
    const pkg = await openRuntimePackageFixture(), current = await ref(pkg, 1)
    const initial = await createProductBuildCompatibilityReportV1({ previous: null, current })
    expect(initial.addedStableKeys.filter(key => key.startsWith('ttrpg-open:'))).toEqual([
      'ttrpg-open:campaign', 'ttrpg-open:rule-pack', 'ttrpg-open:source',
    ])
    expect(await createProductBuildCompatibilityReportV1({ previous: current, current: await ref(pkg, 2) }))
      .toMatchObject({ level: 'compatible', migrationPolicy: 'identity', changedStableKeys: [] })
  })
  it.each(['rule', 'pressure', 'visibility'] as const)('pins the old save after an open %s change instead of calling it cosmetic', async kind => {
    const before = await openRuntimePackageFixture(), after = structuredClone(before)
    if (after.ttrpg?.campaign.version !== 2 || after.ttrpg.rulePack.content.version !== 2) throw new Error('fixture protocol')
    if (kind === 'rule') {
      after.ttrpg.rulePack.content.genericChecks[0].difficulty++
      after.ttrpg.rulePack.contentHash = await hashProductProductionValueV2(after.ttrpg.rulePack.content)
    } else if (kind === 'pressure') after.ttrpg.campaign.fronts[0].telegraph[0].minLeadWorldTurns++
    else after.ttrpg.campaign.informationPolicy.interPlayerWhispers = false
    const report = await createProductBuildCompatibilityReportV1({ previous: await ref(before, 1), current: await ref(after, 2) })
    expect(report).toMatchObject({ level: 'breaking', migrationPolicy: 'pin-old-save' })
    expect(report.changedStableKeys).toContain(`ttrpg-open:${kind === 'rule' ? 'rule-pack' : 'campaign'}`)
  })
})
