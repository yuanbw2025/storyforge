import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  publish: vi.fn(),
}))

vi.mock('../../src/lib/product-production/adoption', () => ({
  prepareProductProductionAdoption: mocks.prepare,
  publishProductProductionBuild: mocks.publish,
}))

import {
  prepareTextOpenWorldCreatorReleaseV1,
  publishTextOpenWorldCreatorReleaseV1,
} from '../../src/lib/open-world/creator-release'
import { parseProductProductionCommandV1 } from '../../src/lib/product-production/contracts'

const scope = { projectId: 1, worldId: 2, workId: 3 }

function prepared() {
  return {
    intent: {
      schema: 'storyforge.product-production-adoption-intent', version: 1,
      productionId: 10, productionKey: 'creator.release.fixture',
      expectedStateRevision: 7, buildId: 20, buildNumber: 2, controlEpoch: 3,
      briefHash: '1'.repeat(64), planHash: '2'.repeat(64), manifestHash: '3'.repeat(64),
      packageHash: '4'.repeat(64), previewHash: '5'.repeat(64), qualityReportHash: '6'.repeat(64),
      rootTerminalReceiptHash: '7'.repeat(64), browserPerformanceReceiptHash: null,
      mainRoutePlaythroughReceiptHash: null, mediaRuntimeReceiptHash: null,
      worldReleaseId: null, worldContentHash: '8'.repeat(64),
    },
    adoptionIntentHash: '9'.repeat(64), productType: 'text-open-world' as const,
    title: '盐脊', releaseVersion: 2, mediaAssetKeys: ['map.world'],
    creatorRelease: {
      sourceKind: 'novel' as const, sourceVersionHash: '8'.repeat(64),
      sourceBoundaryHash: 'a'.repeat(64), sourcePlanHash: 'b'.repeat(64),
      sourcePinHash: 'c'.repeat(64), sourceManifestHash: 'd'.repeat(64),
      artifactSetHash: 'e'.repeat(64), integrationReportHash: 'f'.repeat(64),
      governanceSnapshotHash: '0'.repeat(64), releaseQualityReceiptHash: 'a'.repeat(64),
    },
  }
}

const acknowledgement = {
  sourceAndRightsReviewed: true,
  buildAndQualityReviewed: true,
  immutableReleaseReviewed: true,
  publishNow: true,
}

beforeEach(() => {
  mocks.prepare.mockReset().mockResolvedValue(prepared())
  mocks.publish.mockReset().mockResolvedValue({
    productionId: 10, buildId: 20, buildNumber: 2, productReleaseId: 30,
    releaseVersion: 2, releaseContentHash: 'b'.repeat(64), packageHash: '4'.repeat(64),
    adoptionIntentHash: '9'.repeat(64), stateRevision: 8, replayed: false,
  })
})

describe('TOW-G5-10 · Creator发布服务', () => {
  it('从复验准备态生成一次性作者授权和绑定Hash的幂等发布命令', async () => {
    const current = await prepareTextOpenWorldCreatorReleaseV1({
      scope, productionId: 10, expectedBuildId: 20,
    })
    const result = await publishTextOpenWorldCreatorReleaseV1({
      scope, productionId: 10, prepared: current, releaseLabel: ' 盐脊 正式版 ',
      acknowledgement, authorizationNonce: 'creator-release-nonce', authorizedAt: 100,
    })
    expect(result.receipt.productReleaseId).toBe(30)
    expect(result.authorization).toMatchObject({
      productInstanceKey: 'creator.release.fixture', buildNumber: 2,
      adoptionIntentHash: '9'.repeat(64), buildManifestHash: '3'.repeat(64),
      runtimePackageHash: '4'.repeat(64), releaseQualityReceiptHash: 'a'.repeat(64),
      releaseLabel: '盐脊 正式版', authorizedAt: 100,
    })
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({
      scope, productionId: 10, label: '盐脊 正式版',
      creatorReleaseAuthorization: result.authorization,
      command: expect.objectContaining({
        type: 'publish', expectedStateRevision: 7, buildNumber: 2,
        expectedManifestHash: '3'.repeat(64), adoptionIntentHash: '9'.repeat(64),
        creatorReleaseAuthorizationHash: result.authorization.authorizationHash,
      }),
    }))
    expect(mocks.publish.mock.calls[0]![0].command.commandId)
      .toBe(`text-open-world.publish.${result.authorization.authorizationHash.slice(0, 24)}`)
  })

  it('拒绝通用Production、过期Build和未完成的最终确认', async () => {
    mocks.prepare.mockResolvedValueOnce({ ...prepared(), creatorRelease: null })
    await expect(prepareTextOpenWorldCreatorReleaseV1({ scope, productionId: 10 }))
      .rejects.toThrow(/不是通过Creator双来源/)

    await expect(prepareTextOpenWorldCreatorReleaseV1({
      scope, productionId: 10, expectedBuildId: 99,
    })).rejects.toThrow(/Build已经变化/)

    await expect(publishTextOpenWorldCreatorReleaseV1({
      scope, productionId: 10, prepared: prepared(), releaseLabel: '盐脊 v2',
      acknowledgement: { ...acknowledgement, publishNow: false },
      authorizationNonce: 'creator-release-nonce',
    })).rejects.toThrow(/四项作者确认/)
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('共享publish命令只在显式携带Creator授权时扩展精确字段合同', () => {
    const base = {
      type: 'publish' as const, commandId: 'publish.creator.fixture',
      expectedStateRevision: 7, buildNumber: 2,
      expectedManifestHash: '3'.repeat(64), adoptionIntentHash: '9'.repeat(64),
    }
    expect(parseProductProductionCommandV1(base)).toEqual(base)
    expect(parseProductProductionCommandV1({
      ...base, creatorReleaseAuthorizationHash: 'a'.repeat(64),
    })).toEqual({ ...base, creatorReleaseAuthorizationHash: 'a'.repeat(64) })
    expect(() => parseProductProductionCommandV1({
      ...base, creatorReleaseAuthorizationHash: 'invalid',
    })).toThrow(/creatorReleaseAuthorizationHash/)
  })
})
