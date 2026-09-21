import { describe, expect, it } from 'vitest'
import {
  textAdventureCommunityPackageFileNameV1,
  verifyTextAdventureCommunityPackageV1,
} from '../../src/lib/adventure/community-package'
import { createTextAdventureCommunityPackageFixtureV1 } from '../helpers/text-adventure-community-package'

describe('TEXTADV-7 · community candidate package', () => {
  it('从冻结 RuntimePackage 和质量证据确定性生成可离线复验的候选档案', async () => {
    const candidate = await createTextAdventureCommunityPackageFixtureV1()
    expect(candidate.dossier).toMatchObject({
      status: 'eligible-for-community-submission',
      systems: { mediaAssets: 0 },
      evidence: { authorMainRouteChoiceCount: expect.any(Number) },
      offlineFallback: 'text-only',
    })
    await expect(verifyTextAdventureCommunityPackageV1(JSON.parse(JSON.stringify(candidate))))
      .resolves.toEqual(candidate)
    expect(textAdventureCommunityPackageFileNameV1({
      title: '潮钟/群岛:*?', releaseVersion: 1, candidatePackageHash: candidate.candidatePackageHash,
    })).toMatch(/^潮钟-群岛----v1-[a-f0-9]{12}\.storyforge-adventure\.json$/)
  })

  it('拒绝篡改剧情指标、自动游玩和真人试玩回执', async () => {
    const candidate = await createTextAdventureCommunityPackageFixtureV1()
    const dossierTamper = structuredClone(candidate)
    dossierTamper.dossier.metrics.minimumRouteTextUnits += 1
    await expect(verifyTextAdventureCommunityPackageV1(dossierTamper)).rejects.toThrow(/候选档案/)

    const autoplayTamper = structuredClone(candidate)
    const autoplay = autoplayTamper.evidence.artifacts.find(item => item.artifactKey === 'quality.autoplay')!
    ;(autoplay.payload as { passed: boolean }).passed = false
    await expect(verifyTextAdventureCommunityPackageV1(autoplayTamper)).rejects.toThrow(/Artifact 内容哈希/)

    const receiptTamper = structuredClone(candidate)
    receiptTamper.evidence.gateReceipts[0].status = 'failed'
    await expect(verifyTextAdventureCommunityPackageV1(receiptTamper)).rejects.toThrow(/receiptHash|未通过/)
  })
})
