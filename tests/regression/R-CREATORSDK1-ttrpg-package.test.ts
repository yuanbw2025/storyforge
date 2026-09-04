import { describe, expect, it } from 'vitest'
import { compileTtrpgCampaignDraftV1 } from '../../src/lib/ttrpg/campaign'
import {
  assertTtrpgCreatorPackageLoadAllowedV1,
  createSignedTtrpgCreatorTrustManifestV1,
  createSignedTtrpgCreatorPackageV1,
  createTtrpgCreatorDependencyLockV1,
  createTtrpgCreatorLoadCircuitBreakerStateV1,
  prepareTtrpgCreatorPackageInstallV1,
  recordTtrpgCreatorLoadFailureV1,
  recordTtrpgCreatorLoadSuccessV1,
  runRulePackFixturesV1,
  verifyTtrpgCreatorPackageAgainstTrustManifestV1,
  verifyTtrpgCreatorPackageV1,
  verifyTtrpgCreatorTrustManifestV1,
} from '../../src/lib/ttrpg/creator-sdk'
import { createStoryForgeRulePackV1 } from '../../src/lib/ttrpg/storyforge-rule-pack'
import type { ProductWorldSourceBundleV1 } from '../../src/lib/types'

const NOW = 1_800_000_000_000

function worldSourceBundle(): ProductWorldSourceBundleV1 {
  return {
    schema: 'storyforge.product-world-source-bundle', version: 1, compilerVersion: 1,
    source: { worldCode: 'creator-sdk', worldName: '创作者群岛', worldContentHash: 'a'.repeat(64) },
    createdAt: NOW,
    canonSnapshot: {
      schema: 'storyforge.product-runtime-canon', version: 1, createdAt: NOW,
      worldGroupId: null, worldLabel: '创作者群岛',
      sources: [{
        sourceKey: 'release-world:creator-sdk', kind: 'world', recordId: null,
        name: '创作者群岛', summary: '用于包验证的冻结来源。', fields: {}, updatedAt: NOW,
        contentHash: 'c'.repeat(64),
      }],
      snapshotHash: 'd'.repeat(64),
    },
    initialState: {
      version: 1, clock: 0,
      entities: {
        'release-character:1': {
          entityKey: 'release-character:1', kind: 'player', name: '巡图师',
          locationKey: 'release-location:1', lifecycleStatus: 'active', attributes: { identity: '谨慎的调查者' },
        },
        'release-character:2': {
          entityKey: 'release-character:2', kind: 'npc', name: '引路人',
          locationKey: 'release-location:1', lifecycleStatus: 'active', attributes: { identity: '掌握旧路秘密的向导', role: 'npc' },
        },
        'release-location:1': {
          entityKey: 'release-location:1', kind: 'location', name: '潮痕塔',
          locationKey: 'release-location:1', lifecycleStatus: 'active', attributes: {},
        },
      },
      memories: [], narratives: [], ttrpg: null, chat: null, interaction: null, narrative: null,
      adventure: null, presentation: null, openWorldEvolution: null, openWorld: null, lastSequence: 0,
    },
    diagnostics: [], bundleHash: 'b'.repeat(64),
  }
}

async function signingKeys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  ) as Promise<CryptoKeyPair>
}

describe('CREATOR-SDK-1 · signed data-only TTRPG packages', () => {
  it('CampaignPack 先跑 RulePack fixture 和严格 parser，再签名、验签并区分可信发布者', async () => {
    const keys = await signingKeys()
    const rulePack = createStoryForgeRulePackV1()
    const campaign = compileTtrpgCampaignDraftV1({
      worldSourceBundle: worldSourceBundle(), rulePack, fixtureOnly: true, confirmDefaultMappings: true,
    })
    const signed = await createSignedTtrpgCreatorPackageV1({
      packageId: 'storyforge.campaign.creator-islands', packageVersion: '1.0.0',
      publisherId: 'publisher.first-party', publisherDisplayName: 'StoryForge',
      publicKey: keys.publicKey, privateKey: keys.privateKey, rulePack, campaign,
    })
    expect(signed).toMatchObject({
      schema: 'storyforge.creator-package', version: 1,
      payload: { kind: 'campaign-pack', campaign: { campaignKey: expect.any(String) } },
      permissions: [], signatureAlgorithm: 'ECDSA-P256-SHA256',
    })
    const verified = await verifyTtrpgCreatorPackageV1({
      value: signed, trustedKeyIds: new Set([signed.publisher.keyId]),
    })
    expect(verified).toMatchObject({ trustedPublisher: true, fixtureReport: { valid: true } })
    expect(verified.package.payload.campaign?.sourceWorld.contentHash).toBe('a'.repeat(64))

    const untrusted = await verifyTtrpgCreatorPackageV1({ value: signed })
    expect(untrusted.trustedPublisher).toBe(false)
  })

  it('篡改 payload、签名、权限或撤销发布密钥时 fail-closed', async () => {
    const keys = await signingKeys()
    const signed = await createSignedTtrpgCreatorPackageV1({
      packageId: 'storyforge.rules.core', packageVersion: '1.0.0',
      publisherId: 'publisher.rules', publisherDisplayName: 'Rules Publisher',
      publicKey: keys.publicKey, privateKey: keys.privateKey,
      rulePack: createStoryForgeRulePackV1(),
    })
    const payloadTamper = structuredClone(signed)
    payloadTamper.payload.rulePack.title = '被替换的规则名'
    await expect(verifyTtrpgCreatorPackageV1({ value: payloadTamper })).rejects.toThrow('payloadHash')

    const signatureTamper = structuredClone(signed)
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const tailIndex = alphabet.indexOf(signatureTamper.signature.at(-1) ?? '')
    expect(signatureTamper.signature.length % 4).toBe(2)
    expect(tailIndex % 16).toBe(0)
    // Preserve the two meaningful bits and alter only one of the four unused
    // padding bits. A permissive decoder produces identical signature bytes.
    signatureTamper.signature = `${signatureTamper.signature.slice(0, -1)}${alphabet[tailIndex + 1]}`
    await expect(verifyTtrpgCreatorPackageV1({ value: signatureTamper })).rejects.toThrow('signature')

    await expect(verifyTtrpgCreatorPackageV1({
      value: { ...signed, permissions: ['network'] },
    })).rejects.toThrow('不允许声明权限')
    await expect(verifyTtrpgCreatorPackageV1({
      value: signed, revokedKeyIds: new Set([signed.publisher.keyId]),
    })).rejects.toThrow('已撤销')
  })

  it('fixture 报告指出精确失败字段，失败规则不能被签名打包', async () => {
    const broken = createStoryForgeRulePackV1()
    broken.tests[0].expectedDerivedStats.defense += 1
    const report = runRulePackFixturesV1(broken)
    expect(report.valid).toBe(false)
    expect(report.cases[0].valid).toBe(false)
    expect(report.cases[0].errors[0]).toContain('derived.defense')
    const keys = await signingKeys()
    await expect(createSignedTtrpgCreatorPackageV1({
      packageId: 'storyforge.rules.broken', packageVersion: '1.0.0',
      publisherId: 'publisher.broken', publisherDisplayName: 'Broken Publisher',
      publicKey: keys.publicKey, privateKey: keys.privateKey, rulePack: broken,
    })).rejects.toThrow('fixture 未通过')
  })

  it('可信根签发短期撤销清单，并用完整依赖锁生成 data-only 安装收据', async () => {
    const publisherKeys = await signingKeys()
    const trustRootKeys = await signingKeys()
    const signed = await createSignedTtrpgCreatorPackageV1({
      packageId: 'storyforge.rules.trusted', packageVersion: '1.2.0',
      publisherId: 'publisher.trusted', publisherDisplayName: 'Trusted Publisher',
      publicKey: publisherKeys.publicKey, privateKey: publisherKeys.privateKey,
      rulePack: createStoryForgeRulePackV1(),
    })
    const trustManifest = await createSignedTtrpgCreatorTrustManifestV1({
      sequence: 7, issuedAt: NOW - 1_000, expiresAt: NOW + 86_400_000,
      issuerId: 'storyforge.trust-root',
      publicKey: trustRootKeys.publicKey, privateKey: trustRootKeys.privateKey,
      trustedPublisherKeyIds: [signed.publisher.keyId],
    })
    const pinnedIssuerKeyIds = new Set([trustManifest.issuer.keyId])
    const trust = await verifyTtrpgCreatorTrustManifestV1({
      value: trustManifest, pinnedIssuerKeyIds, now: NOW, minimumSequence: 7,
    })
    expect(trust.trustedPublisherKeyIds.has(signed.publisher.keyId)).toBe(true)

    const lock = await createTtrpgCreatorDependencyLockV1({
      rootPackageId: signed.packageId, rootPackageVersion: signed.packageVersion,
      packages: [signed], trustManifest, pinnedIssuerKeyIds, now: NOW,
      minimumManifestSequence: 7,
    })
    const installed = await prepareTtrpgCreatorPackageInstallV1({
      dependencyLock: lock, packages: [signed], trustManifest,
      pinnedIssuerKeyIds, now: NOW, minimumManifestSequence: 7,
    })
    expect(installed.receipt).toMatchObject({
      packageId: signed.packageId, payloadHash: signed.payloadHash,
      trustManifestSequence: 7,
      isolation: { mode: 'data-only', executableCode: false, permissions: [] },
    })
    expect(installed.receipt.dependencyLockHash).toBe(lock.lockHash)

    const missingPackage = { ...lock, packages: [] }
    await expect(prepareTtrpgCreatorPackageInstallV1({
      dependencyLock: missingPackage, packages: [signed], trustManifest,
      pinnedIssuerKeyIds, now: NOW,
    })).rejects.toThrow('1..256')
  })

  it('撤销、过期、清单篡改和 sequence 回滚都会阻断第三方包安装', async () => {
    const publisherKeys = await signingKeys()
    const trustRootKeys = await signingKeys()
    const signed = await createSignedTtrpgCreatorPackageV1({
      packageId: 'storyforge.rules.revocable', packageVersion: '2.0.0',
      publisherId: 'publisher.revocable', publisherDisplayName: 'Revocable Publisher',
      publicKey: publisherKeys.publicKey, privateKey: publisherKeys.privateKey,
      rulePack: createStoryForgeRulePackV1(),
    })
    const manifest = await createSignedTtrpgCreatorTrustManifestV1({
      sequence: 9, issuedAt: NOW - 10_000, expiresAt: NOW + 10_000,
      issuerId: 'storyforge.trust-root',
      publicKey: trustRootKeys.publicKey, privateKey: trustRootKeys.privateKey,
      trustedPublisherKeyIds: [signed.publisher.keyId],
      revokedPackages: [{
        packageId: signed.packageId, packageVersion: signed.packageVersion,
        payloadHash: signed.payloadHash, reason: 'rights-withdrawn', effectiveAt: NOW - 1,
      }],
    })
    const pinnedIssuerKeyIds = new Set([manifest.issuer.keyId])
    await expect(verifyTtrpgCreatorPackageAgainstTrustManifestV1({
      value: signed, trustManifest: manifest, pinnedIssuerKeyIds, now: NOW,
    })).rejects.toThrow('已撤销:rights-withdrawn')
    await expect(verifyTtrpgCreatorTrustManifestV1({
      value: manifest, pinnedIssuerKeyIds, now: NOW + 10_000,
    })).rejects.toThrow('已过期')
    await expect(verifyTtrpgCreatorTrustManifestV1({
      value: manifest, pinnedIssuerKeyIds, now: NOW, minimumSequence: 10,
    })).rejects.toThrow('sequence 回滚')

    const tampered = structuredClone(manifest)
    tampered.trustedPublisherKeyIds = []
    await expect(verifyTtrpgCreatorTrustManifestV1({
      value: tampered, pinnedIssuerKeyIds, now: NOW,
    })).rejects.toThrow('manifestHash')

    const leakedPrivateMaterial = structuredClone(signed)
    leakedPrivateMaterial.publisher.publicKeyJwk.d = 'private-material-must-never-ship'
    await expect(verifyTtrpgCreatorPackageV1({ value: leakedPrivateMaterial })).rejects.toThrow('未携带私钥材料')
  })

  it('连续加载失败会按安装收据熔断，成功后清零且不能拿别的锁绕过', async () => {
    const receipt = {
      schema: 'storyforge.creator-install-receipt' as const, version: 1 as const,
      packageId: 'storyforge.rules.breaker', packageVersion: '1.0.0',
      payloadHash: 'a'.repeat(64), publisherKeyId: 'key.publisher',
      trustManifestHash: 'b'.repeat(64), trustManifestSequence: 3,
      dependencyLockHash: 'c'.repeat(64), verifiedAt: NOW,
      isolation: { mode: 'data-only' as const, executableCode: false as const, permissions: [] as [] },
    }
    let state = createTtrpgCreatorLoadCircuitBreakerStateV1(receipt)
    state = recordTtrpgCreatorLoadFailureV1({ state, failedAt: NOW + 1 })
    state = recordTtrpgCreatorLoadFailureV1({ state, failedAt: NOW + 2 })
    expect(() => assertTtrpgCreatorPackageLoadAllowedV1({ receipt, state })).not.toThrow()
    state = recordTtrpgCreatorLoadFailureV1({ state, failedAt: NOW + 3 })
    expect(() => assertTtrpgCreatorPackageLoadAllowedV1({ receipt, state })).toThrow('已熔断')
    expect(() => assertTtrpgCreatorPackageLoadAllowedV1({
      receipt: { ...receipt, dependencyLockHash: 'd'.repeat(64) }, state,
    })).toThrow('安装收据不匹配')
    expect(recordTtrpgCreatorLoadSuccessV1(state)).toMatchObject({
      consecutiveFailures: 0, lastFailureAt: null, trippedAt: null,
    })
  })
})
