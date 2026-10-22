import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createStoryForgeRulePackV1 } from '../../src/lib/ttrpg/storyforge-rule-pack'
import { parseRulePackV2, projectTtrpgRulePackMechanicalCoreV1 } from '../../src/lib/ttrpg/rule-pack-v2'
import {
  assertTtrpgCreatorPackageExecutionAllowedV1,
  createSignedTtrpgCreatorPackageV1, createSignedTtrpgCreatorPackageV2,
  createSignedTtrpgCreatorTrustManifestV1, createTtrpgCreatorDependencyLockV1, createTtrpgCreatorDependencyLockV2,
  prepareTtrpgCreatorPackageInstallV1, prepareTtrpgCreatorPackageInstallVersionedV1,
  verifyTtrpgCreatorPackageV1, verifyTtrpgCreatorPackageVersionedV1,
  verifyTtrpgCreatorPackageAgainstTrustManifestVersionedV1,
  TTRPG_CREATOR_SDK_CAPABILITIES_V2,
} from '../../src/lib/ttrpg/creator-sdk'
import {
  listValidatedTtrpgRulePacksV1, listValidatedTtrpgRulePacksV2,
  readTtrpgRulePackVersionedV1, saveTtrpgRulePackV1, saveTtrpgRulePackV2,
  prepareTtrpgRulePackOverlayV2,
} from '../../src/lib/ttrpg/rule-pack-library'
import { hashTtrpgFrozenPredicateIndexV1 } from '../../src/lib/ttrpg/content-version'
import { applyTtrpgHouseRuleOverlayV2, previewTtrpgCheckProbabilityV2 } from '../../src/lib/ttrpg/house-rule'
import { applyTtrpgHouseRuleOverlayV3, type TtrpgHouseRuleOverlayV3 } from '../../src/lib/ttrpg/house-rule-v2'
import type { RulePackV1 } from '../../src/lib/types'
import type { RulePackV2 } from '../../src/lib/ttrpg/open-contract'
import { openRuleFixture, openCampaignFixture } from '../helpers/ttrpg-open-content'

const NOW = 1_800_000_000_000

function openRule(): RulePackV2 {
  return parseRulePackV2(openRuleFixture())
}

async function signedPackage(version: 1 | 2, withCampaign = false) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const input = {
    packageId: 'rules.test', packageVersion: '1.0.0', publisherId: 'publisher.test',
    publisherDisplayName: '测试发布者', ...keys,
  }
  const campaign = version === 2 && withCampaign ? openCampaignFixture() : null
  if (campaign) {
    campaign.frozenWorldPredicateIndex.indexHash = await hashTtrpgFrozenPredicateIndexV1(campaign.frozenWorldPredicateIndex)
  }
  return version === 1
    ? createSignedTtrpgCreatorPackageV1({ ...input, rulePack: createStoryForgeRulePackV1() })
    : createSignedTtrpgCreatorPackageV2({ ...input, rulePack: openRule(), campaign })
}

async function trustedInstall(version: 1 | 2, withCampaign = false) {
  const pkg = await signedPackage(version, withCampaign)
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const trustManifest = await createSignedTtrpgCreatorTrustManifestV1({
    ...keys, issuerId: 'issuer.test', sequence: 2, issuedAt: NOW - 1000, expiresAt: NOW + 1000,
    trustedPublisherKeyIds: [pkg.publisher.keyId],
  })
  const input = { packages: [pkg], trustManifest, pinnedIssuerKeyIds: new Set([trustManifest.issuer.keyId]), now: NOW, playerVersion: 2 as const }
  const lockInput = { ...input, rootPackageId: pkg.packageId, rootPackageVersion: pkg.packageVersion }
  const dependencyLock = version === 1
    ? await createTtrpgCreatorDependencyLockV1(lockInput)
    : await createTtrpgCreatorDependencyLockV2(lockInput)
  return { ...input, dependencyLock, pkg, issuerKeys: keys }
}

async function workspace() {
  return createWorkspace(
    { name: 'SDK 规则隔离', description: '', genres: [], status: 'drafting', targetWordCount: 10000 },
    { kind: 'ttrpg' },
  )
}

describe('R-TTRPGOPEN1 · Creator SDK protocol boundary', () => {
  it.each([1, 2] as const)('protocol%s 验证和安装准备保留原始内容与 hash', async version => {
    const input = await trustedInstall(version)
    const before = JSON.stringify(input.pkg)
    const prepared = await prepareTtrpgCreatorPackageInstallVersionedV1(input)
    expect(JSON.stringify(prepared.package)).toBe(before)
    expect(prepared.package.payloadHash).toBe(await hashCanonicalValue(input.pkg.payload))
    expect(prepared.receipt.dependencyLockHash).toBe(input.dependencyLock.lockHash)
    if (version === 1) {
      expect(prepared).toEqual(await prepareTtrpgCreatorPackageInstallV1(input))
      expect(prepared.package.payload.rulePack).not.toHaveProperty('runFormat')
      expect(prepared.receipt).not.toHaveProperty('execution')
      expect(() => assertTtrpgCreatorPackageExecutionAllowedV1(prepared.receipt)).not.toThrow()
    } else {
      expect(prepared.receipt).toMatchObject({ version: 2, runtimeProtocol: 2, execution: 'unsupported' })
      expect(() => assertTtrpgCreatorPackageExecutionAllowedV1(prepared.receipt)).toThrow('尚不支持实际运行')
      await expect(prepareTtrpgCreatorPackageInstallV1(input)).rejects.toThrow()
      await expect(prepareTtrpgCreatorPackageInstallVersionedV1({ ...input, playerVersion: 1 })).rejects.toThrow()
    }
    expect(JSON.stringify(input.pkg)).toBe(before)
    expect(TTRPG_CREATOR_SDK_CAPABILITIES_V2.executionProtocols).toEqual([1])
  })

  it('旧 parser/player 拒绝 V2，V1 内容不能伪装为 V2', async () => {
    const pkg = await signedPackage(2)
    await expect(verifyTtrpgCreatorPackageV1({ value: pkg })).rejects.toThrow()
    await expect(verifyTtrpgCreatorPackageVersionedV1({ value: pkg, playerVersion: 1 })).rejects.toThrow()
    const old = await signedPackage(1)
    const mixed = { ...old, version: 2, compatibility: pkg.compatibility }
    await expect(verifyTtrpgCreatorPackageVersionedV1({ value: mixed, playerVersion: 2 })).rejects.toThrow()
    await expect(verifyTtrpgCreatorPackageVersionedV1({
      value: { ...pkg, compatibility: { ...pkg.compatibility, minimumPlayerVersion: 1 } }, playerVersion: 2,
    })).rejects.toThrow()
    await expect(verifyTtrpgCreatorPackageVersionedV1({ value: { ...pkg, unknown: true }, playerVersion: 2 })).rejects.toThrow()
    await expect(verifyTtrpgCreatorPackageVersionedV1({
      value: { ...pkg, permissions: ['network'] }, playerVersion: 2,
    })).rejects.toThrow('不允许声明权限')
  })

  it('完整 V2 campaign 可以验签并准备安装，损坏引用或混合格式明确拒绝', async () => {
    const input = await trustedInstall(2, true)
    const prepared = await prepareTtrpgCreatorPackageInstallVersionedV1(input)
    expect(prepared.package.payload.kind).toBe('campaign-pack')
    expect(prepared.package.payload.campaign).toMatchObject({ version: 2, runFormat: 'open' })
    expect(prepared.package.payloadHash).toBe(input.pkg.payloadHash)
    expect(() => assertTtrpgCreatorPackageExecutionAllowedV1(prepared.receipt)).toThrow('尚不支持实际运行')
    const mixed = structuredClone(input.pkg)
    if (mixed.version !== 2 || !mixed.payload.campaign) throw new Error('fixture')
    mixed.payload.campaign.openingSituationKeys = ['missing.situation']
    await expect(verifyTtrpgCreatorPackageVersionedV1({ value: mixed, playerVersion: 2 })).rejects.toThrow()
    await expect(verifyTtrpgCreatorPackageVersionedV1({
      value: { ...input.pkg, payload: { ...input.pkg.payload, campaign: { ...input.pkg.payload.campaign, runFormat: 'scripted' } } },
      playerVersion: 2,
    })).rejects.toThrow()
  })

  it('V2 SDK 签名前及验签后校验真实 indexHash，外层合法签名不能掩盖索引损坏', async () => {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const campaign = openCampaignFixture()
    campaign.frozenWorldPredicateIndex.indexHash = await hashTtrpgFrozenPredicateIndexV1(campaign.frozenWorldPredicateIndex)
    const before = JSON.stringify(campaign)
    const signingInput = {
      ...keys, packageId: 'campaign.index', packageVersion: '2.0.0',
      publisherId: 'publisher.index', publisherDisplayName: '索引校验',
      rulePack: openRule(), campaign,
    }
    const pkg = await createSignedTtrpgCreatorPackageV2(signingInput)
    const verified = await verifyTtrpgCreatorPackageVersionedV1({ value: pkg, playerVersion: 2 })
    expect(verified.package.payload.campaign).toEqual(campaign)
    expect(JSON.stringify(campaign)).toBe(before)

    const trustManifest = await createSignedTtrpgCreatorTrustManifestV1({
      ...keys, issuerId: 'issuer.index', sequence: 1, issuedAt: NOW - 1000, expiresAt: NOW + 1000,
      trustedPublisherKeyIds: [pkg.publisher.keyId],
    })
    const installInput = {
      packages: [pkg], trustManifest, pinnedIssuerKeyIds: new Set([trustManifest.issuer.keyId]),
      now: NOW, playerVersion: 2 as const,
    }
    const dependencyLock = await createTtrpgCreatorDependencyLockV2({
      ...installInput, rootPackageId: pkg.packageId, rootPackageVersion: pkg.packageVersion,
    })
    await expect(prepareTtrpgCreatorPackageInstallVersionedV1({ ...installInput, dependencyLock }))
      .resolves.toMatchObject({ package: pkg })

    const brokenCampaign = structuredClone(campaign)
    brokenCampaign.frozenWorldPredicateIndex.indexHash = '0'.repeat(64)
    await expect(createSignedTtrpgCreatorPackageV2({ ...signingInput, campaign: brokenCampaign }))
      .rejects.toThrow('indexHash')
    const altered = { ...pkg, payload: { ...pkg.payload, campaign: brokenCampaign } }
    altered.payloadHash = await hashCanonicalValue(altered.payload)
    const { signature: _signature, ...unsigned } = altered
    // Model an external publisher signing a semantically inconsistent package.
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey,
      new TextEncoder().encode(canonicalProductProductionJsonV2(unsigned)),
    )
    altered.signature = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    const alteredBefore = JSON.stringify(altered)
    await expect(verifyTtrpgCreatorPackageVersionedV1({ value: altered, playerVersion: 2 }))
      .rejects.toThrow('indexHash')
    dependencyLock.packages[0].payloadHash = altered.payloadHash
    const { lockHash: _lockHash, ...lockBody } = dependencyLock
    dependencyLock.lockHash = await hashCanonicalValue(lockBody)
    await expect(prepareTtrpgCreatorPackageInstallVersionedV1({
      ...installInput, packages: [altered], dependencyLock,
    })).rejects.toThrow('indexHash')
    expect(JSON.stringify(altered)).toBe(alteredBefore)
  })

  it.each([1, 2] as const)('protocol%s 不绕过 payload/signature/trust/dependency 检查', async version => {
    const input = await trustedInstall(version)
    const changed = structuredClone(input.pkg)
    changed.payload.rulePack.title += ' tampered'
    await expect(verifyTtrpgCreatorPackageVersionedV1({ value: changed, playerVersion: 2 })).rejects.toThrow('payloadHash')
    changed.payloadHash = await hashCanonicalValue(changed.payload)
    await expect(verifyTtrpgCreatorPackageVersionedV1({ value: changed, playerVersion: 2 })).rejects.toThrow('signature')
    await expect(verifyTtrpgCreatorPackageAgainstTrustManifestVersionedV1({
      ...input, value: input.pkg, pinnedIssuerKeyIds: new Set(),
    })).rejects.toThrow('可信根')
    await expect(prepareTtrpgCreatorPackageInstallVersionedV1({ ...input, now: NOW + 2000 })).rejects.toThrow('过期')
    await expect(prepareTtrpgCreatorPackageInstallVersionedV1({ ...input, minimumManifestSequence: 3 })).rejects.toThrow('回滚')
    await expect(prepareTtrpgCreatorPackageInstallVersionedV1({ ...input, packages: [] })).rejects.toThrow()
    await expect(prepareTtrpgCreatorPackageInstallVersionedV1({
      ...input, dependencyLock: { ...input.dependencyLock, lockHash: '0'.repeat(64) },
    })).rejects.toThrow('lockHash')
    const mismatchedLock = structuredClone(input.dependencyLock)
    mismatchedLock.packages[0].payloadHash = '0'.repeat(64)
    const { lockHash: _lockHash, ...lockBody } = mismatchedLock
    mismatchedLock.lockHash = await hashCanonicalValue(lockBody)
    await expect(prepareTtrpgCreatorPackageInstallVersionedV1({
      ...input, dependencyLock: mismatchedLock,
    })).rejects.toThrow('实际安装包集合')
    const trustManifest = await createSignedTtrpgCreatorTrustManifestV1({
      ...input.issuerKeys, issuerId: 'issuer.test', sequence: 3, issuedAt: NOW - 1000, expiresAt: NOW + 1000,
      trustedPublisherKeyIds: [input.pkg.publisher.keyId],
      revokedPackages: [{ packageId: input.pkg.packageId, packageVersion: null, payloadHash: null, reason: 'publisher-request', effectiveAt: NOW }],
    })
    await expect(prepareTtrpgCreatorPackageInstallVersionedV1({ ...input, trustManifest })).rejects.toThrow('已撤销')
    const revokedKey = await createSignedTtrpgCreatorTrustManifestV1({
      ...input.issuerKeys, issuerId: 'issuer.test', sequence: 3, issuedAt: NOW - 1000, expiresAt: NOW + 1000,
      trustedPublisherKeyIds: [input.pkg.publisher.keyId],
      revokedPublisherKeys: [{ keyId: input.pkg.publisher.keyId, reason: 'key-compromise', effectiveAt: NOW }],
    })
    await expect(prepareTtrpgCreatorPackageInstallVersionedV1({ ...input, trustManifest: revokedKey })).rejects.toThrow('已撤销')
  })

  it('V2 原始 Oracle 内容参与签名/hash，机械投影不能替换 payload', async () => {
    const pkg = await signedPackage(2)
    if (pkg.version !== 2) throw new Error('fixture')
    const core = projectTtrpgRulePackMechanicalCoreV1(pkg.payload.rulePack)
    const modified = structuredClone(pkg)
    modified.payload.rulePack.oracles[0].title += ' modified'
    await expect(verifyTtrpgCreatorPackageVersionedV1({ value: modified, playerVersion: 2 })).rejects.toThrow('payloadHash')
    await expect(verifyTtrpgCreatorPackageVersionedV1({
      value: { ...pkg, payload: { ...pkg.payload, rulePack: core } }, playerVersion: 2,
    })).rejects.toThrow()
    expect(await hashCanonicalValue({ ...pkg.payload, rulePack: core })).not.toBe(pkg.payloadHash)
  })

  it('V2 dependency lock 拒绝混合协议依赖', async () => {
    const input = await trustedInstall(2)
    const old = await signedPackage(1)
    const trustManifest = await createSignedTtrpgCreatorTrustManifestV1({
      ...input.issuerKeys, issuerId: 'issuer.test', sequence: 3, issuedAt: NOW - 1000, expiresAt: NOW + 1000,
      trustedPublisherKeyIds: [input.pkg.publisher.keyId, old.publisher.keyId],
    })
    await expect(createTtrpgCreatorDependencyLockV2({
      ...input, trustManifest, packages: [input.pkg, old],
      rootPackageId: input.pkg.packageId, rootPackageVersion: input.pkg.packageVersion,
    })).rejects.toThrow('混合版本')
  })
})

describe('R-TTRPGOPEN1 · rule library and house overlay identity', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  function overlayFor(rulePack: RulePackV1 | RulePackV2, contentHash: string): TtrpgHouseRuleOverlayV3 {
    return {
      schema: 'storyforge.ttrpg-house-rule-overlay', version: 3, baseRulePackVersion: 2,
      overlayKey: 'house.candidate', title: '行动候选', author: '作者',
      baseRuleSystemId: rulePack.ruleSystemId, baseRuleSystemVersion: rulePack.ruleSystemVersion,
      baseContentHash: contentHash,
      patches: [{ patchKey: 'extra-action', operation: 'replace', path: 'turnStructure.actionsPerTurn', value: 2, reason: '测试候选' }],
    }
  }

  it('规则库 V2 overlay 返回新版本候选，显式保存后旧 validated 行保持原样', async () => {
    const { scope } = await workspace()
    const rulePack = openRule()
    const base = await saveTtrpgRulePackV2({ scope, rulePack })
    const candidate = await prepareTtrpgRulePackOverlayV2({
      scope, rulePackId: base.id!, overlay: overlayFor(rulePack, base.contentHash),
      newRuleSystemVersion: '2.1.0-house',
    })
    expect(candidate.baseRecord).toEqual(base)
    expect(candidate.rulePack).toMatchObject({ version: 2, ruleSystemVersion: '2.1.0-house', turnStructure: { actionsPerTurn: 2 } })
    expect(candidate.rulePack.oracles).toEqual(rulePack.oracles)
    expect(candidate.contentHash).toBe(await hashProductProductionValueV2(candidate.rulePack))
    expect(candidate.diff).toContainEqual(expect.objectContaining({ path: 'turnStructure.actionsPerTurn', after: 2 }))
    expect(await db.ttrpgRulePacks.toArray()).toEqual([base])
    const saved = await saveTtrpgRulePackV2({ scope, rulePack: candidate.rulePack, immutable: true })
    expect(saved.id).not.toBe(base.id)
    expect(saved.contentHash).toBe(candidate.contentHash)
    expect(await db.ttrpgRulePacks.get(base.id!)).toEqual(base)
    expect(await db.ttrpgRulePacks.count()).toBe(2)
  })

  it('规则库 V2 overlay 拒绝错作用域、旧版本、未验证基线、陈旧 hash 和原版本候选', async () => {
    const { scope } = await workspace()
    const other = await workspace()
    const rulePack = openRule()
    const base = await saveTtrpgRulePackV2({ scope, rulePack })
    const input = {
      scope, rulePackId: base.id!, overlay: overlayFor(rulePack, base.contentHash),
      newRuleSystemVersion: '2.1.0-house',
    }
    await expect(prepareTtrpgRulePackOverlayV2({ ...input, scope: other.scope })).rejects.toThrow('作用域')
    await expect(prepareTtrpgRulePackOverlayV2({
      ...input, overlay: { ...input.overlay, baseContentHash: '0'.repeat(64) },
    })).rejects.toThrow('hash')
    await expect(prepareTtrpgRulePackOverlayV2({
      ...input, newRuleSystemVersion: rulePack.ruleSystemVersion,
    })).rejects.toThrow('新规则版本')
    const oldRule = createStoryForgeRulePackV1()
    const old = await saveTtrpgRulePackV1({ scope: other.scope, rulePack: oldRule })
    await expect(prepareTtrpgRulePackOverlayV2({
      ...input, scope: other.scope, rulePackId: old.id!, overlay: overlayFor(oldRule, old.contentHash),
    })).rejects.toThrow('validated V2')
    const draftRule = { ...rulePack, ruleSystemVersion: '2.2.0-draft' }
    const draft = await saveTtrpgRulePackV2({ scope, rulePack: draftRule, status: 'draft' })
    await expect(prepareTtrpgRulePackOverlayV2({
      ...input, rulePackId: draft.id!, overlay: overlayFor(draftRule, draft.contentHash),
    })).rejects.toThrow('validated')
    expect(await db.ttrpgRulePacks.get(base.id!)).toEqual(base)
    expect(await db.ttrpgRulePacks.count()).toBe(3)
  })

  it('validated V1 读取和重复保存不改 JSON、hash、时间戳，也不能被 V2 覆盖', async () => {
    const { scope } = await workspace()
    const rulePack = createStoryForgeRulePackV1()
    const row = await saveTtrpgRulePackV1({ scope, rulePack })
    // Simulate historical serialization that need not match today's JSON.stringify layout.
    const rulePackJson = JSON.stringify(rulePack, null, 2)
    await db.ttrpgRulePacks.update(row.id!, { rulePackJson, updatedAt: 123 })
    const original = await db.ttrpgRulePacks.get(row.id!)
    expect((await readTtrpgRulePackVersionedV1({ scope, rulePackId: row.id! })).record).toEqual(original)
    expect(await saveTtrpgRulePackV1({ scope, rulePack })).toEqual(original)
    await expect(saveTtrpgRulePackV1({ scope, rulePack: { ...rulePack, title: 'changed' } })).rejects.toThrow('不可修改')
    await expect(saveTtrpgRulePackV2({ scope, rulePack: openRule() })).rejects.toThrow('跨版本')
    expect(await db.ttrpgRulePacks.get(row.id!)).toEqual(original)
  })

  it('V2 保存、读取、分版本列表只使用原始 V2；投影无法写回同一规则身份', async () => {
    const { scope } = await workspace()
    const rulePack = openRule()
    const row = await saveTtrpgRulePackV2({ scope, rulePack })
    const before = JSON.stringify(row)
    expect(row.contentHash).toBe(await hashProductProductionValueV2(rulePack))
    const core = projectTtrpgRulePackMechanicalCoreV1(rulePack)
    expect(row.contentHash).not.toBe(await hashProductProductionValueV2(core))
    expect((await readTtrpgRulePackVersionedV1({ scope, rulePackId: row.id! })).rulePack).toEqual(rulePack)
    expect(await listValidatedTtrpgRulePacksV1(scope)).toEqual([])
    expect(await listValidatedTtrpgRulePacksV2(scope)).toEqual([row])
    await expect(saveTtrpgRulePackV2({ scope, rulePack: core })).rejects.toThrow()
    await expect(saveTtrpgRulePackV1({ scope, rulePack: core })).rejects.toThrow('跨版本')
    expect(JSON.stringify(await db.ttrpgRulePacks.get(row.id!))).toBe(before)
  })

  it('拒绝跨 Work/World/Project、错产品与损坏 hash/版本', async () => {
    const { scope } = await workspace()
    const other = await workspace()
    const rulePack = openRule()
    const row = await saveTtrpgRulePackV2({ scope, rulePack })
    await expect(readTtrpgRulePackVersionedV1({ scope: other.scope, rulePackId: row.id! })).rejects.toThrow('作用域')
    await expect(saveTtrpgRulePackV2({ scope: { ...scope, worldId: other.scope.worldId }, rulePack })).rejects.toThrow()
    await db.works.update(scope.workId, { kind: 'chat' })
    await expect(saveTtrpgRulePackV2({ scope, rulePack })).rejects.toThrow('ttrpg')
    await expect(listValidatedTtrpgRulePacksV2(scope)).rejects.toThrow('ttrpg')
    await db.works.update(scope.workId, { kind: 'ttrpg' })
    await db.ttrpgRulePacks.update(row.id!, { projectId: other.scope.projectId })
    await expect(saveTtrpgRulePackV2({ scope, rulePack })).rejects.toThrow('作用域')
    await db.ttrpgRulePacks.update(row.id!, { projectId: scope.projectId, contentHash: '0'.repeat(64) })
    await expect(readTtrpgRulePackVersionedV1({ scope, rulePackId: row.id! })).rejects.toThrow('contentHash')
    await db.ttrpgRulePacks.update(row.id!, { contentHash: row.contentHash, rulePackJson: JSON.stringify({ ...rulePack, version: 1 }) })
    await expect(listValidatedTtrpgRulePacksV2(scope)).rejects.toThrow()
  })

  it('V2 overlay 验原始 hash、保留 open 字段，机械算法与 V1 等值', async () => {
    const rulePack = openRule()
    const original = JSON.stringify(rulePack)
    const core = projectTtrpgRulePackMechanicalCoreV1(rulePack)
    const overlay: TtrpgHouseRuleOverlayV3 = {
      schema: 'storyforge.ttrpg-house-rule-overlay', version: 3, baseRulePackVersion: 2,
      overlayKey: 'house.test', title: '更多行动', author: '作者',
      baseRuleSystemId: rulePack.ruleSystemId, baseRuleSystemVersion: rulePack.ruleSystemVersion,
      baseContentHash: await hashProductProductionValueV2(rulePack),
      patches: [{ patchKey: 'extra-action', operation: 'replace', path: 'turnStructure.actionsPerTurn', value: 2, reason: '测试' }],
    }
    const applied = await applyTtrpgHouseRuleOverlayV3({ baseRulePack: rulePack, overlay })
    expect(applied.rulePack.version).toBe(2)
    expect(applied.rulePack.oracles).toEqual(rulePack.oracles)
    expect(applied.rulePack.factPolicy).toEqual(rulePack.factPolicy)
    expect(applied.contentHash).toBe(await hashProductProductionValueV2(applied.rulePack))
    expect(JSON.stringify(rulePack)).toBe(original)
    const previewInput = { checkKey: core.checks[0].key, attributeValue: 2 }
    expect(previewTtrpgCheckProbabilityV2({ ...previewInput, rulePack: core })).toEqual(
      previewTtrpgCheckProbabilityV2({ ...previewInput, rulePack: createStoryForgeRulePackV1() }),
    )
    await expect(applyTtrpgHouseRuleOverlayV3({
      baseRulePack: rulePack, overlay: { ...overlay, baseContentHash: await hashProductProductionValueV2(core) },
    })).rejects.toThrow('hash')
    await expect(applyTtrpgHouseRuleOverlayV3({
      baseRulePack: rulePack, overlay: { ...overlay, patches: [{ ...overlay.patches[0], path: 'oracles.oracle.test.title' }] },
    })).rejects.toThrow('白名单')
    await expect(applyTtrpgHouseRuleOverlayV3({
      baseRulePack: core as unknown as RulePackV2, overlay,
    })).rejects.toThrow()
    await expect(applyTtrpgHouseRuleOverlayV2({
      baseRulePack: rulePack as unknown as RulePackV1, overlay: { ...overlay, version: 2 },
    })).rejects.toThrow()
  })
})
