import { hashCanonicalValue } from '../agent/run/hash'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type { RulePackV1, TtrpgCampaignContentV1 } from '../types'
import { parseTtrpgCampaignContentV1 } from './campaign'
import { evaluateRuleNumberExpressionV1, parseRulePackV1 } from './rule-pack'
import type { RulePackV2, TtrpgCampaignContentV2 } from './open-contract'
import { parseRulePackV2, projectTtrpgRulePackMechanicalCoreV1 } from './rule-pack-v2'
import { parseTtrpgCampaignContentV2 } from './campaign-v2'
import { assertTtrpgPlayerProtocolV1 } from './run-format'
import { hashTtrpgFrozenPredicateIndexV1 } from './content-version'

export interface TtrpgCreatorPackageV1 {
  schema: 'storyforge.creator-package'
  version: 1
  packageId: string
  packageVersion: string
  publisher: {
    publisherId: string
    displayName: string
    keyId: string
    publicKeyJwk: JsonWebKey
  }
  compatibility: {
    minimumRuntimeProtocol: 1
    maximumRuntimeProtocol: 1
  }
  /** Data-only v1 has no host, network, model or storage permissions. */
  permissions: []
  payload: {
    kind: 'rule-pack' | 'campaign-pack'
    rulePack: RulePackV1
    campaign: TtrpgCampaignContentV1 | null
  }
  payloadHash: string
  signatureAlgorithm: 'ECDSA-P256-SHA256'
  signature: string
}

export interface RulePackFixtureReportV1 {
  valid: boolean
  cases: Array<{
    fixtureKey: string
    valid: boolean
    errors: string[]
  }>
}

/** Explicit open package; V1 envelopes and their signed bytes remain unchanged. */
export interface TtrpgCreatorPackageV2 extends Omit<TtrpgCreatorPackageV1, 'version' | 'compatibility' | 'payload'> {
  version: 2
  compatibility: {
    minimumRuntimeProtocol: 2
    maximumRuntimeProtocol: 2
    minimumPlayerVersion: 2
  }
  payload: {
    kind: 'rule-pack' | 'campaign-pack'
    rulePack: RulePackV2
    campaign: TtrpgCampaignContentV2 | null
  }
}

export type TtrpgVersionedCreatorPackage = TtrpgCreatorPackageV1 | TtrpgCreatorPackageV2

/** Parsing/install preparation support is distinct from actual runtime support. */
export const TTRPG_CREATOR_SDK_CAPABILITIES_V2 = Object.freeze({
  packageVersions: Object.freeze([1, 2] as const),
  validationProtocols: Object.freeze([1, 2] as const),
  installationPreparationProtocols: Object.freeze([1, 2] as const),
  executionProtocols: Object.freeze([1] as const),
})

export type TtrpgCreatorRevocationReasonV1 =
  | 'key-compromise'
  | 'rights-withdrawn'
  | 'malware'
  | 'policy-violation'
  | 'publisher-request'
  | 'superseded'

export interface TtrpgCreatorTrustManifestV1 {
  schema: 'storyforge.creator-trust-manifest'
  version: 1
  sequence: number
  issuedAt: number
  expiresAt: number
  issuer: {
    issuerId: string
    keyId: string
    publicKeyJwk: JsonWebKey
  }
  trustedPublisherKeyIds: string[]
  revokedPublisherKeys: Array<{
    keyId: string
    reason: TtrpgCreatorRevocationReasonV1
    effectiveAt: number
  }>
  revokedPackages: Array<{
    packageId: string
    packageVersion: string | null
    payloadHash: string | null
    reason: TtrpgCreatorRevocationReasonV1
    effectiveAt: number
  }>
  manifestHash: string
  signatureAlgorithm: 'ECDSA-P256-SHA256'
  signature: string
}

export interface TtrpgCreatorDependencyLockV1 {
  schema: 'storyforge.creator-dependency-lock'
  version: 1
  runtimeProtocol: 1
  root: {
    packageId: string
    packageVersion: string
  }
  packages: Array<{
    packageId: string
    packageVersion: string
    payloadHash: string
    publisherKeyId: string
  }>
  lockHash: string
}

export interface TtrpgCreatorInstallReceiptV1 {
  schema: 'storyforge.creator-install-receipt'
  version: 1
  packageId: string
  packageVersion: string
  payloadHash: string
  publisherKeyId: string
  trustManifestHash: string
  trustManifestSequence: number
  dependencyLockHash: string
  verifiedAt: number
  isolation: {
    mode: 'data-only'
    executableCode: false
    permissions: []
  }
}

export interface TtrpgCreatorDependencyLockV2 extends Omit<TtrpgCreatorDependencyLockV1, 'version' | 'runtimeProtocol'> {
  version: 2
  runtimeProtocol: 2
}

export interface TtrpgCreatorInstallReceiptV2 extends Omit<TtrpgCreatorInstallReceiptV1, 'version'> {
  version: 2
  runtimeProtocol: 2
  execution: 'unsupported'
}

export interface TtrpgCreatorLoadCircuitBreakerStateV1 {
  schema: 'storyforge.creator-load-circuit-breaker'
  version: 1
  packageId: string
  packageVersion: string
  payloadHash: string
  dependencyLockHash: string
  consecutiveFailures: number
  lastFailureAt: number | null
  trippedAt: number | null
}

const REVOCATION_REASONS = new Set<TtrpgCreatorRevocationReasonV1>([
  'key-compromise', 'rights-withdrawn', 'malware', 'policy-violation',
  'publisher-request', 'superseded',
])
const MAX_CREATOR_PACKAGE_BYTES = 16 * 1024 * 1024

function fail(message: string): never {
  throw new Error(`[ttrpg-creator-sdk] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value)
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) {
    fail(`${label} 字段不符合合同`)
  }
}

function stableKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) fail(`${label} 无效`)
  return value
}

function semver(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    fail(`${label} 必须是 SemVer`)
  }
  return value
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string, label = 'signature'): ArrayBuffer {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) fail(`${label} 不是 base64url`)
  const padded = `${value.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - value.length % 4) % 4)}`
  let binary: string
  try { binary = atob(padded) } catch { fail(`${label} 不是合法 base64url`) }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  // Reject alternate encodings that change only unused padding bits. They
  // decode to the same signature bytes and therefore pass WebCrypto verify,
  // but accepting them makes the signed envelope non-canonical.
  if (base64Url(bytes) !== value) fail(`${label} 不是规范 base64url`)
  return bytes.buffer as ArrayBuffer
}

function timestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) fail(`${label} 必须是正整数时间戳`)
  return Number(value)
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail(`${label} 无效`)
  return value
}

function publicP256Jwk(value: unknown, label: string): JsonWebKey {
  const jwk = record(value, label) as JsonWebKey
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256'
    || typeof jwk.x !== 'string' || !/^[A-Za-z0-9_-]{40,50}$/.test(jwk.x)
    || typeof jwk.y !== 'string' || !/^[A-Za-z0-9_-]{40,50}$/.test(jwk.y)
    || 'd' in jwk) {
    fail(`${label} 必须是未携带私钥材料的 P-256 公钥`)
  }
  return structuredClone(jwk)
}

function uniqueStableKeys(value: unknown, label: string, maximum = 1_024): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 必须是有界数组`)
  const result = value.map((item, index) => stableKey(item, `${label}[${index}]`))
  if (new Set(result).size !== result.length) fail(`${label} 不允许重复`)
  return result
}

function revocationReason(value: unknown, label: string): TtrpgCreatorRevocationReasonV1 {
  if (!REVOCATION_REASONS.has(value as TtrpgCreatorRevocationReasonV1)) fail(`${label} 无效`)
  return value as TtrpgCreatorRevocationReasonV1
}

function assertBoundedJson(value: unknown, label: string, maximumBytes = MAX_CREATOR_PACKAGE_BYTES): void {
  let json: string
  try { json = canonicalProductProductionJsonV2(value) } catch { fail(`${label} 不是可序列化的纯数据`) }
  if (new TextEncoder().encode(json).byteLength > maximumBytes) fail(`${label} 超过 ${maximumBytes} bytes`)
}

function signingBody(pkg: Omit<TtrpgCreatorPackageV1, 'signature'> | Omit<TtrpgCreatorPackageV2, 'signature'>): string {
  return canonicalProductProductionJsonV2(pkg)
}

function parsePackage(value: unknown): TtrpgCreatorPackageV1
function parsePackage(value: unknown, version: 2): TtrpgCreatorPackageV2
function parsePackage(value: unknown, version: 1 | 2 = 1): TtrpgVersionedCreatorPackage {
  const pkg = record(value, 'package')
  exact(pkg, [
    'schema', 'version', 'packageId', 'packageVersion', 'publisher', 'compatibility',
    'permissions', 'payload', 'payloadHash', 'signatureAlgorithm', 'signature',
  ], 'package')
  if (pkg.schema !== 'storyforge.creator-package' || pkg.version !== version) fail('package schema/version 无效')
  if (pkg.signatureAlgorithm !== 'ECDSA-P256-SHA256') fail('signatureAlgorithm 无效')
  if (!Array.isArray(pkg.permissions) || pkg.permissions.length !== 0) fail(`data-only v${version} 不允许声明权限`)
  const publisher = record(pkg.publisher, 'publisher')
  exact(publisher, ['publisherId', 'displayName', 'keyId', 'publicKeyJwk'], 'publisher')
  const compatibility = record(pkg.compatibility, 'compatibility')
  exact(compatibility, version === 1
    ? ['minimumRuntimeProtocol', 'maximumRuntimeProtocol']
    : ['minimumRuntimeProtocol', 'maximumRuntimeProtocol', 'minimumPlayerVersion'], 'compatibility')
  if (compatibility.minimumRuntimeProtocol !== version || compatibility.maximumRuntimeProtocol !== version
    || (version === 2 && compatibility.minimumPlayerVersion !== 2)) {
    fail('runtime protocol 不兼容')
  }
  const payload = record(pkg.payload, 'payload')
  exact(payload, ['kind', 'rulePack', 'campaign'], 'payload')
  if (!['rule-pack', 'campaign-pack'].includes(String(payload.kind))) fail('payload.kind 无效')
  if ((payload.kind === 'rule-pack' && payload.campaign !== null)
    || (payload.kind === 'campaign-pack' && payload.campaign == null)) fail('payload.kind 与 campaign 不一致')
  const publicKeyJwk = publicP256Jwk(publisher.publicKeyJwk, 'publisher.publicKeyJwk')
  if (typeof pkg.payloadHash !== 'string' || !/^[0-9a-f]{64}$/.test(pkg.payloadHash)) fail('payloadHash 无效')
  const common = {
    schema: 'storyforge.creator-package' as const,
    packageId: stableKey(pkg.packageId, 'packageId'),
    packageVersion: semver(pkg.packageVersion, 'packageVersion'),
    publisher: {
      publisherId: stableKey(publisher.publisherId, 'publisherId'),
      displayName: typeof publisher.displayName === 'string' && publisher.displayName.trim()
        ? publisher.displayName.trim().normalize('NFC') : fail('publisher.displayName 无效'),
      keyId: stableKey(publisher.keyId, 'publisher.keyId'),
      publicKeyJwk: structuredClone(publicKeyJwk),
    },
    permissions: [] as [],
    payloadHash: pkg.payloadHash,
    signatureAlgorithm: 'ECDSA-P256-SHA256' as const,
    signature: typeof pkg.signature === 'string' ? pkg.signature : fail('signature 无效'),
  }
  if (version === 2) {
    const rulePack = parseRulePackV2(payload.rulePack)
    return {
      ...common, version: 2,
      compatibility: { minimumRuntimeProtocol: 2, maximumRuntimeProtocol: 2, minimumPlayerVersion: 2 },
      payload: {
        kind: payload.kind as TtrpgCreatorPackageV2['payload']['kind'],
        rulePack,
        campaign: payload.campaign === null ? null : parseTtrpgCampaignContentV2(payload.campaign, rulePack),
      },
    }
  }
  return {
    schema: common.schema, version: 1,
    packageId: common.packageId, packageVersion: common.packageVersion,
    publisher: common.publisher,
    compatibility: { minimumRuntimeProtocol: 1, maximumRuntimeProtocol: 1 },
    permissions: common.permissions,
    payload: {
      kind: payload.kind as TtrpgCreatorPackageV1['payload']['kind'],
      rulePack: parseRulePackV1(payload.rulePack),
      campaign: payload.campaign == null ? null : structuredClone(payload.campaign as TtrpgCampaignContentV1),
    },
    payloadHash: common.payloadHash,
    signatureAlgorithm: common.signatureAlgorithm,
    signature: common.signature,
  }
}

function trustManifestHashBody(
  manifest: Omit<TtrpgCreatorTrustManifestV1, 'manifestHash' | 'signature'>,
): string {
  return canonicalProductProductionJsonV2(manifest)
}

function trustManifestSigningBody(manifest: Omit<TtrpgCreatorTrustManifestV1, 'signature'>): string {
  return canonicalProductProductionJsonV2(manifest)
}

function parseTrustManifest(value: unknown): TtrpgCreatorTrustManifestV1 {
  const manifest = record(value, 'trustManifest')
  exact(manifest, [
    'schema', 'version', 'sequence', 'issuedAt', 'expiresAt', 'issuer',
    'trustedPublisherKeyIds', 'revokedPublisherKeys', 'revokedPackages',
    'manifestHash', 'signatureAlgorithm', 'signature',
  ], 'trustManifest')
  if (manifest.schema !== 'storyforge.creator-trust-manifest' || manifest.version !== 1) {
    fail('trustManifest schema/version 无效')
  }
  if (!Number.isSafeInteger(manifest.sequence) || Number(manifest.sequence) <= 0) {
    fail('trustManifest.sequence 必须是正整数')
  }
  const issuer = record(manifest.issuer, 'trustManifest.issuer')
  exact(issuer, ['issuerId', 'keyId', 'publicKeyJwk'], 'trustManifest.issuer')
  if (!Array.isArray(manifest.revokedPublisherKeys) || manifest.revokedPublisherKeys.length > 1_024) {
    fail('revokedPublisherKeys 必须是有界数组')
  }
  const revokedPublisherKeys = manifest.revokedPublisherKeys.map((value, index) => {
    const item = record(value, `revokedPublisherKeys[${index}]`)
    exact(item, ['keyId', 'reason', 'effectiveAt'], `revokedPublisherKeys[${index}]`)
    return {
      keyId: stableKey(item.keyId, `revokedPublisherKeys[${index}].keyId`),
      reason: revocationReason(item.reason, `revokedPublisherKeys[${index}].reason`),
      effectiveAt: timestamp(item.effectiveAt, `revokedPublisherKeys[${index}].effectiveAt`),
    }
  })
  if (new Set(revokedPublisherKeys.map(item => item.keyId)).size !== revokedPublisherKeys.length) {
    fail('revokedPublisherKeys 不允许重复')
  }
  if (!Array.isArray(manifest.revokedPackages) || manifest.revokedPackages.length > 4_096) {
    fail('revokedPackages 必须是有界数组')
  }
  const revokedPackages = manifest.revokedPackages.map((value, index) => {
    const item = record(value, `revokedPackages[${index}]`)
    exact(item, ['packageId', 'packageVersion', 'payloadHash', 'reason', 'effectiveAt'], `revokedPackages[${index}]`)
    return {
      packageId: stableKey(item.packageId, `revokedPackages[${index}].packageId`),
      packageVersion: item.packageVersion == null ? null : semver(item.packageVersion, `revokedPackages[${index}].packageVersion`),
      payloadHash: item.payloadHash == null ? null : sha256(item.payloadHash, `revokedPackages[${index}].payloadHash`),
      reason: revocationReason(item.reason, `revokedPackages[${index}].reason`),
      effectiveAt: timestamp(item.effectiveAt, `revokedPackages[${index}].effectiveAt`),
    }
  })
  const revokedPackageKeys = revokedPackages.map(item => `${item.packageId}\u0000${item.packageVersion ?? '*'}\u0000${item.payloadHash ?? '*'}`)
  if (new Set(revokedPackageKeys).size !== revokedPackageKeys.length) fail('revokedPackages 不允许重复')
  const issuedAt = timestamp(manifest.issuedAt, 'trustManifest.issuedAt')
  const expiresAt = timestamp(manifest.expiresAt, 'trustManifest.expiresAt')
  if (expiresAt <= issuedAt) fail('trustManifest.expiresAt 必须晚于 issuedAt')
  if (manifest.signatureAlgorithm !== 'ECDSA-P256-SHA256') fail('trustManifest.signatureAlgorithm 无效')
  return {
    schema: 'storyforge.creator-trust-manifest', version: 1,
    sequence: Number(manifest.sequence), issuedAt, expiresAt,
    issuer: {
      issuerId: stableKey(issuer.issuerId, 'trustManifest.issuer.issuerId'),
      keyId: stableKey(issuer.keyId, 'trustManifest.issuer.keyId'),
      publicKeyJwk: publicP256Jwk(issuer.publicKeyJwk, 'trustManifest.issuer.publicKeyJwk'),
    },
    trustedPublisherKeyIds: uniqueStableKeys(manifest.trustedPublisherKeyIds, 'trustedPublisherKeyIds'),
    revokedPublisherKeys,
    revokedPackages,
    manifestHash: sha256(manifest.manifestHash, 'trustManifest.manifestHash'),
    signatureAlgorithm: 'ECDSA-P256-SHA256',
    signature: typeof manifest.signature === 'string' ? manifest.signature : fail('trustManifest.signature 无效'),
  }
}

export function runRulePackFixturesV1(value: RulePackV1 | unknown): RulePackFixtureReportV1 {
  const rulePack = parseRulePackV1(value)
  const cases = rulePack.tests.map(fixture => {
    const errors: string[] = []
    for (const definition of rulePack.derivedStats) {
      let actual = evaluateRuleNumberExpressionV1(definition.formula, fixture.attributes)
      if (definition.minimum != null) actual = Math.max(definition.minimum, actual)
      if (definition.maximum != null) actual = Math.min(definition.maximum, actual)
      if (fixture.expectedDerivedStats[definition.key] !== actual) {
        errors.push(`derived.${definition.key}: expected ${fixture.expectedDerivedStats[definition.key]}, got ${actual}`)
      }
    }
    for (const definition of rulePack.resources) {
      const actual = evaluateRuleNumberExpressionV1(definition.maximumFormula, fixture.attributes)
      if (fixture.expectedResourceMaximums[definition.key] !== actual) {
        errors.push(`resource.${definition.key}: expected ${fixture.expectedResourceMaximums[definition.key]}, got ${actual}`)
      }
    }
    return { fixtureKey: fixture.fixtureKey, valid: errors.length === 0, errors }
  })
  return { valid: cases.length > 0 && cases.every(item => item.valid), cases }
}

export async function createSignedTtrpgCreatorPackageV1(input: {
  packageId: string
  packageVersion: string
  publisherId: string
  publisherDisplayName: string
  publicKey: CryptoKey
  privateKey: CryptoKey
  rulePack: RulePackV1
  campaign?: TtrpgCampaignContentV1 | null
}): Promise<TtrpgCreatorPackageV1> {
  const rulePack = parseRulePackV1(input.rulePack)
  const fixtureReport = runRulePackFixturesV1(rulePack)
  if (!fixtureReport.valid) fail(`RulePack fixture 未通过:${fixtureReport.cases.flatMap(item => item.errors).join('；')}`)
  const campaign = input.campaign == null ? null : parseTtrpgCampaignContentV1(input.campaign, rulePack)
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', input.publicKey)
  const keyId = `key.${(await hashCanonicalValue(publicKeyJwk)).slice(0, 32)}`
  const payload = {
    kind: campaign ? 'campaign-pack' as const : 'rule-pack' as const,
    rulePack,
    campaign,
  }
  const unsigned: Omit<TtrpgCreatorPackageV1, 'signature'> = {
    schema: 'storyforge.creator-package', version: 1,
    packageId: stableKey(input.packageId, 'packageId'),
    packageVersion: semver(input.packageVersion, 'packageVersion'),
    publisher: {
      publisherId: stableKey(input.publisherId, 'publisherId'),
      displayName: input.publisherDisplayName.trim().normalize('NFC'),
      keyId,
      publicKeyJwk,
    },
    compatibility: { minimumRuntimeProtocol: 1, maximumRuntimeProtocol: 1 },
    permissions: [],
    payload,
    payloadHash: await hashCanonicalValue(payload),
    signatureAlgorithm: 'ECDSA-P256-SHA256',
  }
  if (!unsigned.publisher.displayName) fail('publisherDisplayName 无效')
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, input.privateKey,
    new TextEncoder().encode(signingBody(unsigned)),
  )
  return parsePackage({ ...unsigned, signature: base64Url(new Uint8Array(signature)) })
}

export async function verifyTtrpgCreatorPackageV1(input: {
  value: TtrpgCreatorPackageV1 | unknown
  revokedKeyIds?: ReadonlySet<string>
  trustedKeyIds?: ReadonlySet<string>
}): Promise<{
  package: TtrpgCreatorPackageV1
  trustedPublisher: boolean
  fixtureReport: RulePackFixtureReportV1
}> {
  assertBoundedJson(input.value, 'creator package')
  const pkg = parsePackage(input.value)
  if (input.revokedKeyIds?.has(pkg.publisher.keyId)) fail('publisher key 已撤销')
  const expectedKeyId = `key.${(await hashCanonicalValue(pkg.publisher.publicKeyJwk)).slice(0, 32)}`
  if (expectedKeyId !== pkg.publisher.keyId) {
    fail('publisher keyId 与公钥不一致')
  }
  if (await hashCanonicalValue(pkg.payload) !== pkg.payloadHash) fail('payloadHash 校验失败')
  const fixtureReport = runRulePackFixturesV1(pkg.payload.rulePack)
  if (!fixtureReport.valid) fail('RulePack fixture 未通过')
  if (pkg.payload.campaign) parseTtrpgCampaignContentV1(pkg.payload.campaign, pkg.payload.rulePack)
  const publicKey = await crypto.subtle.importKey(
    'jwk', pkg.publisher.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
  )
  const { signature: _signature, ...unsigned } = pkg
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromBase64Url(pkg.signature),
    new TextEncoder().encode(signingBody(unsigned)),
  )
  if (!valid) fail('package signature 校验失败')
  return {
    package: pkg,
    trustedPublisher: input.trustedKeyIds?.has(pkg.publisher.keyId) ?? false,
    fixtureReport,
  }
}

export async function createSignedTtrpgCreatorTrustManifestV1(input: {
  sequence: number
  issuedAt: number
  expiresAt: number
  issuerId: string
  publicKey: CryptoKey
  privateKey: CryptoKey
  trustedPublisherKeyIds: string[]
  revokedPublisherKeys?: TtrpgCreatorTrustManifestV1['revokedPublisherKeys']
  revokedPackages?: TtrpgCreatorTrustManifestV1['revokedPackages']
}): Promise<TtrpgCreatorTrustManifestV1> {
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', input.publicKey)
  const keyId = `key.${(await hashCanonicalValue(publicKeyJwk)).slice(0, 32)}`
  const base: Omit<TtrpgCreatorTrustManifestV1, 'manifestHash' | 'signature'> = {
    schema: 'storyforge.creator-trust-manifest', version: 1,
    sequence: input.sequence,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    issuer: { issuerId: input.issuerId, keyId, publicKeyJwk },
    trustedPublisherKeyIds: [...input.trustedPublisherKeyIds],
    revokedPublisherKeys: structuredClone(input.revokedPublisherKeys ?? []),
    revokedPackages: structuredClone(input.revokedPackages ?? []),
    signatureAlgorithm: 'ECDSA-P256-SHA256',
  }
  const manifestHash = await hashCanonicalValue(JSON.parse(trustManifestHashBody(base)))
  const unsigned: Omit<TtrpgCreatorTrustManifestV1, 'signature'> = { ...base, manifestHash }
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, input.privateKey,
    new TextEncoder().encode(trustManifestSigningBody(unsigned)),
  )
  return parseTrustManifest({ ...unsigned, signature: base64Url(new Uint8Array(signature)) })
}

export async function verifyTtrpgCreatorTrustManifestV1(input: {
  value: TtrpgCreatorTrustManifestV1 | unknown
  pinnedIssuerKeyIds: ReadonlySet<string>
  now: number
  minimumSequence?: number
}): Promise<{
  manifest: TtrpgCreatorTrustManifestV1
  trustedPublisherKeyIds: ReadonlySet<string>
  revokedPublisherKeyIds: ReadonlySet<string>
}> {
  assertBoundedJson(input.value, 'creator trust manifest', 2 * 1024 * 1024)
  const manifest = parseTrustManifest(input.value)
  const now = timestamp(input.now, 'now')
  if (manifest.issuedAt > now) fail('trustManifest 尚未生效')
  if (manifest.expiresAt <= now) fail('trustManifest 已过期')
  if (input.minimumSequence != null
    && (!Number.isSafeInteger(input.minimumSequence) || input.minimumSequence < 0)) {
    fail('minimumSequence 无效')
  }
  if (manifest.sequence < (input.minimumSequence ?? 0)) fail('trustManifest sequence 回滚')
  const expectedKeyId = `key.${(await hashCanonicalValue(manifest.issuer.publicKeyJwk)).slice(0, 32)}`
  if (expectedKeyId !== manifest.issuer.keyId) fail('trustManifest issuer keyId 与公钥不一致')
  if (!input.pinnedIssuerKeyIds.has(manifest.issuer.keyId)) fail('trustManifest issuer 不在固定可信根中')
  const { signature: _signature, manifestHash: _manifestHash, ...base } = manifest
  if (await hashCanonicalValue(JSON.parse(trustManifestHashBody(base))) !== manifest.manifestHash) {
    fail('trustManifest manifestHash 校验失败')
  }
  const publicKey = await crypto.subtle.importKey(
    'jwk', manifest.issuer.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
  )
  const { signature: _ignored, ...unsigned } = manifest
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, publicKey,
    fromBase64Url(manifest.signature, 'trustManifest.signature'),
    new TextEncoder().encode(trustManifestSigningBody(unsigned)),
  )
  if (!valid) fail('trustManifest signature 校验失败')
  const revokedPublisherKeyIds = new Set(
    manifest.revokedPublisherKeys.filter(item => item.effectiveAt <= now).map(item => item.keyId),
  )
  return {
    manifest,
    revokedPublisherKeyIds,
    trustedPublisherKeyIds: new Set(
      manifest.trustedPublisherKeyIds.filter(keyId => !revokedPublisherKeyIds.has(keyId)),
    ),
  }
}

export async function verifyTtrpgCreatorPackageAgainstTrustManifestV1(input: {
  value: TtrpgCreatorPackageV1 | unknown
  trustManifest: TtrpgCreatorTrustManifestV1 | unknown
  pinnedIssuerKeyIds: ReadonlySet<string>
  now: number
  minimumManifestSequence?: number
}): Promise<{
  package: TtrpgCreatorPackageV1
  fixtureReport: RulePackFixtureReportV1
  trustManifest: TtrpgCreatorTrustManifestV1
}> {
  const trust = await verifyTtrpgCreatorTrustManifestV1({
    value: input.trustManifest,
    pinnedIssuerKeyIds: input.pinnedIssuerKeyIds,
    now: input.now,
    minimumSequence: input.minimumManifestSequence,
  })
  const verified = await verifyTtrpgCreatorPackageV1({
    value: input.value,
    revokedKeyIds: trust.revokedPublisherKeyIds,
    trustedKeyIds: trust.trustedPublisherKeyIds,
  })
  if (!verified.trustedPublisher) fail('publisher key 不在当前 trustManifest 允许列表中')
  const revoked = trust.manifest.revokedPackages.find(item =>
    item.effectiveAt <= input.now
    && item.packageId === verified.package.packageId
    && (item.packageVersion == null || item.packageVersion === verified.package.packageVersion)
    && (item.payloadHash == null || item.payloadHash === verified.package.payloadHash))
  if (revoked) fail(`creator package 已撤销:${revoked.reason}`)
  return {
    package: verified.package,
    fixtureReport: verified.fixtureReport,
    trustManifest: trust.manifest,
  }
}

function dependencyLockBody(lock: Omit<TtrpgCreatorDependencyLockV1, 'lockHash'> | Omit<TtrpgCreatorDependencyLockV2, 'lockHash'>): string {
  return canonicalProductProductionJsonV2(lock)
}

function parseDependencyLock(value: unknown): TtrpgCreatorDependencyLockV1
function parseDependencyLock(value: unknown, version: 2): TtrpgCreatorDependencyLockV2
function parseDependencyLock(value: unknown, version: 1 | 2 = 1): TtrpgCreatorDependencyLockV1 | TtrpgCreatorDependencyLockV2 {
  const lock = record(value, 'dependencyLock')
  exact(lock, ['schema', 'version', 'runtimeProtocol', 'root', 'packages', 'lockHash'], 'dependencyLock')
  if (lock.schema !== 'storyforge.creator-dependency-lock' || lock.version !== version || lock.runtimeProtocol !== version) {
    fail('dependencyLock schema/version/runtimeProtocol 无效')
  }
  const root = record(lock.root, 'dependencyLock.root')
  exact(root, ['packageId', 'packageVersion'], 'dependencyLock.root')
  if (!Array.isArray(lock.packages) || lock.packages.length === 0 || lock.packages.length > 256) {
    fail('dependencyLock.packages 必须包含 1..256 个包')
  }
  const packages = lock.packages.map((value, index) => {
    const item = record(value, `dependencyLock.packages[${index}]`)
    exact(item, ['packageId', 'packageVersion', 'payloadHash', 'publisherKeyId'], `dependencyLock.packages[${index}]`)
    return {
      packageId: stableKey(item.packageId, `dependencyLock.packages[${index}].packageId`),
      packageVersion: semver(item.packageVersion, `dependencyLock.packages[${index}].packageVersion`),
      payloadHash: sha256(item.payloadHash, `dependencyLock.packages[${index}].payloadHash`),
      publisherKeyId: stableKey(item.publisherKeyId, `dependencyLock.packages[${index}].publisherKeyId`),
    }
  })
  if (new Set(packages.map(item => item.packageId)).size !== packages.length) {
    fail('dependencyLock 不允许同一 packageId 出现多个版本')
  }
  const sorted = [...packages].sort((left, right) => left.packageId.localeCompare(right.packageId))
  if (canonicalProductProductionJsonV2(sorted) !== canonicalProductProductionJsonV2(packages)) {
    fail('dependencyLock.packages 必须按 packageId 排序')
  }
  const parsed = {
    schema: 'storyforge.creator-dependency-lock' as const,
    root: {
      packageId: stableKey(root.packageId, 'dependencyLock.root.packageId'),
      packageVersion: semver(root.packageVersion, 'dependencyLock.root.packageVersion'),
    },
    packages,
    lockHash: sha256(lock.lockHash, 'dependencyLock.lockHash'),
  }
  if (!packages.some(item => item.packageId === parsed.root.packageId
    && item.packageVersion === parsed.root.packageVersion)) fail('dependencyLock.root 不在 packages 中')
  return version === 1
    ? { schema: parsed.schema, version: 1, runtimeProtocol: 1, root: parsed.root, packages, lockHash: parsed.lockHash }
    : { schema: parsed.schema, version: 2, runtimeProtocol: 2, root: parsed.root, packages, lockHash: parsed.lockHash }
}

export async function createTtrpgCreatorDependencyLockV1(input: {
  rootPackageId: string
  rootPackageVersion: string
  packages: Array<TtrpgCreatorPackageV1 | unknown>
  trustManifest: TtrpgCreatorTrustManifestV1 | unknown
  pinnedIssuerKeyIds: ReadonlySet<string>
  now: number
  minimumManifestSequence?: number
}): Promise<TtrpgCreatorDependencyLockV1> {
  const verified = await Promise.all(input.packages.map(value =>
    verifyTtrpgCreatorPackageAgainstTrustManifestV1({
      value, trustManifest: input.trustManifest,
      pinnedIssuerKeyIds: input.pinnedIssuerKeyIds, now: input.now,
      minimumManifestSequence: input.minimumManifestSequence,
    })))
  const packages = verified.map(item => ({
    packageId: item.package.packageId,
    packageVersion: item.package.packageVersion,
    payloadHash: item.package.payloadHash,
    publisherKeyId: item.package.publisher.keyId,
  })).sort((left, right) => left.packageId.localeCompare(right.packageId))
  const base: Omit<TtrpgCreatorDependencyLockV1, 'lockHash'> = {
    schema: 'storyforge.creator-dependency-lock', version: 1, runtimeProtocol: 1,
    root: {
      packageId: stableKey(input.rootPackageId, 'rootPackageId'),
      packageVersion: semver(input.rootPackageVersion, 'rootPackageVersion'),
    },
    packages,
  }
  const lockHash = await hashCanonicalValue(JSON.parse(dependencyLockBody(base)))
  return parseDependencyLock({ ...base, lockHash })
}

export async function verifyTtrpgCreatorDependencyLockV1(input: {
  value: TtrpgCreatorDependencyLockV1 | unknown
  packages: Array<TtrpgCreatorPackageV1 | unknown>
  trustManifest: TtrpgCreatorTrustManifestV1 | unknown
  pinnedIssuerKeyIds: ReadonlySet<string>
  now: number
  minimumManifestSequence?: number
}): Promise<{
  lock: TtrpgCreatorDependencyLockV1
  packages: TtrpgCreatorPackageV1[]
  trustManifest: TtrpgCreatorTrustManifestV1
}> {
  const lock = parseDependencyLock(input.value)
  const { lockHash: _lockHash, ...base } = lock
  if (await hashCanonicalValue(JSON.parse(dependencyLockBody(base))) !== lock.lockHash) {
    fail('dependencyLock.lockHash 校验失败')
  }
  const verified = await Promise.all(input.packages.map(value =>
    verifyTtrpgCreatorPackageAgainstTrustManifestV1({
      value, trustManifest: input.trustManifest,
      pinnedIssuerKeyIds: input.pinnedIssuerKeyIds, now: input.now,
      minimumManifestSequence: input.minimumManifestSequence,
    })))
  const actualEntries = verified.map(item => ({
    packageId: item.package.packageId,
    packageVersion: item.package.packageVersion,
    payloadHash: item.package.payloadHash,
    publisherKeyId: item.package.publisher.keyId,
  })).sort((left, right) => left.packageId.localeCompare(right.packageId))
  if (canonicalProductProductionJsonV2(actualEntries) !== canonicalProductProductionJsonV2(lock.packages)) {
    fail('dependencyLock 与实际安装包集合不一致')
  }
  return {
    lock,
    packages: verified.map(item => item.package),
    trustManifest: verified[0]?.trustManifest ?? fail('dependencyLock 缺少安装包'),
  }
}

export async function prepareTtrpgCreatorPackageInstallV1(input: {
  dependencyLock: TtrpgCreatorDependencyLockV1 | unknown
  packages: Array<TtrpgCreatorPackageV1 | unknown>
  trustManifest: TtrpgCreatorTrustManifestV1 | unknown
  pinnedIssuerKeyIds: ReadonlySet<string>
  now: number
  minimumManifestSequence?: number
}): Promise<{
  /** Deep-cloned, data-only package safe to hand to the parser/runtime boundary. */
  package: TtrpgCreatorPackageV1
  receipt: TtrpgCreatorInstallReceiptV1
}> {
  const verified = await verifyTtrpgCreatorDependencyLockV1({
    value: input.dependencyLock,
    packages: input.packages,
    trustManifest: input.trustManifest,
    pinnedIssuerKeyIds: input.pinnedIssuerKeyIds,
    now: input.now,
    minimumManifestSequence: input.minimumManifestSequence,
  })
  const root = verified.packages.find(item => item.packageId === verified.lock.root.packageId
    && item.packageVersion === verified.lock.root.packageVersion) ?? fail('dependencyLock root package 缺失')
  assertBoundedJson(root, 'creator package')
  return {
    package: structuredClone(root),
    receipt: {
      schema: 'storyforge.creator-install-receipt', version: 1,
      packageId: root.packageId, packageVersion: root.packageVersion,
      payloadHash: root.payloadHash, publisherKeyId: root.publisher.keyId,
      trustManifestHash: verified.trustManifest.manifestHash,
      trustManifestSequence: verified.trustManifest.sequence,
      dependencyLockHash: verified.lock.lockHash,
      verifiedAt: timestamp(input.now, 'now'),
      isolation: { mode: 'data-only', executableCode: false, permissions: [] },
    },
  }
}

export function createTtrpgCreatorLoadCircuitBreakerStateV1(
  receipt: TtrpgCreatorInstallReceiptV1,
): TtrpgCreatorLoadCircuitBreakerStateV1 {
  return {
    schema: 'storyforge.creator-load-circuit-breaker', version: 1,
    packageId: receipt.packageId, packageVersion: receipt.packageVersion,
    payloadHash: receipt.payloadHash, dependencyLockHash: receipt.dependencyLockHash,
    consecutiveFailures: 0, lastFailureAt: null, trippedAt: null,
  }
}

export function recordTtrpgCreatorLoadFailureV1(input: {
  state: TtrpgCreatorLoadCircuitBreakerStateV1
  failedAt: number
  failureThreshold?: number
}): TtrpgCreatorLoadCircuitBreakerStateV1 {
  const threshold = input.failureThreshold ?? 3
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 20) fail('failureThreshold 必须在 1..20')
  const consecutiveFailures = Math.min(threshold, input.state.consecutiveFailures + 1)
  const failedAt = timestamp(input.failedAt, 'failedAt')
  return {
    ...structuredClone(input.state), consecutiveFailures, lastFailureAt: failedAt,
    trippedAt: consecutiveFailures >= threshold ? input.state.trippedAt ?? failedAt : null,
  }
}

export function assertTtrpgCreatorPackageLoadAllowedV1(input: {
  receipt: TtrpgCreatorInstallReceiptV1
  state: TtrpgCreatorLoadCircuitBreakerStateV1
}): void {
  if (input.receipt.version !== 1) fail('protocol2 仅支持验证/准备安装，尚不支持实际运行')
  if (input.state.packageId !== input.receipt.packageId
    || input.state.packageVersion !== input.receipt.packageVersion
    || input.state.payloadHash !== input.receipt.payloadHash
    || input.state.dependencyLockHash !== input.receipt.dependencyLockHash) {
    fail('circuit breaker 与安装收据不匹配')
  }
  if (input.state.trippedAt != null) fail('creator package 因连续加载失败已熔断')
}

export function recordTtrpgCreatorLoadSuccessV1(
  state: TtrpgCreatorLoadCircuitBreakerStateV1,
): TtrpgCreatorLoadCircuitBreakerStateV1 {
  return { ...structuredClone(state), consecutiveFailures: 0, lastFailureAt: null, trippedAt: null }
}

async function verifyCreatorCampaignIndexV2(campaign: TtrpgCampaignContentV2 | null): Promise<void> {
  if (campaign && await hashTtrpgFrozenPredicateIndexV1(campaign.frozenWorldPredicateIndex)
    !== campaign.frozenWorldPredicateIndex.indexHash) fail('frozen indexHash 校验失败')
}

export async function createSignedTtrpgCreatorPackageV2(input: Omit<
  Parameters<typeof createSignedTtrpgCreatorPackageV1>[0], 'rulePack' | 'campaign'
> & { rulePack: RulePackV2; campaign?: TtrpgCampaignContentV2 | null }): Promise<TtrpgCreatorPackageV2> {
  const rulePack = parseRulePackV2(input.rulePack)
  const fixtureReport = runRulePackFixturesV1(projectTtrpgRulePackMechanicalCoreV1(rulePack))
  if (!fixtureReport.valid) fail('RulePack fixture 未通过')
  const campaign = input.campaign == null ? null : parseTtrpgCampaignContentV2(input.campaign, rulePack)
  await verifyCreatorCampaignIndexV2(campaign)
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', input.publicKey)
  const payload: TtrpgCreatorPackageV2['payload'] = {
    kind: campaign ? 'campaign-pack' : 'rule-pack', rulePack, campaign,
  }
  const unsigned: Omit<TtrpgCreatorPackageV2, 'signature'> = {
    schema: 'storyforge.creator-package', version: 2,
    packageId: stableKey(input.packageId, 'packageId'),
    packageVersion: semver(input.packageVersion, 'packageVersion'),
    publisher: {
      publisherId: stableKey(input.publisherId, 'publisherId'),
      displayName: input.publisherDisplayName.trim().normalize('NFC'),
      keyId: `key.${(await hashCanonicalValue(publicKeyJwk)).slice(0, 32)}`,
      publicKeyJwk,
    },
    compatibility: { minimumRuntimeProtocol: 2, maximumRuntimeProtocol: 2, minimumPlayerVersion: 2 },
    permissions: [], payload,
    payloadHash: await hashCanonicalValue(payload),
    signatureAlgorithm: 'ECDSA-P256-SHA256',
  }
  if (!unsigned.publisher.displayName) fail('publisherDisplayName 无效')
  assertBoundedJson(unsigned, 'creator package')
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, input.privateKey,
    new TextEncoder().encode(signingBody(unsigned)),
  )
  return parsePackage({ ...unsigned, signature: base64Url(new Uint8Array(signature)) }, 2)
}

/** Opt-in reader; legacy envelopes still pass the entire original verifier. */
export async function verifyTtrpgCreatorPackageVersionedV1(input:
  Parameters<typeof verifyTtrpgCreatorPackageV1>[0] & { playerVersion: 1 | 2 },
): Promise<{
  package: TtrpgVersionedCreatorPackage
  trustedPublisher: boolean
  fixtureReport: RulePackFixtureReportV1
}> {
  const version = record(input.value, 'package').version
  if (version !== 1 && version !== 2) fail('package schema/version 无效')
  assertTtrpgPlayerProtocolV1({ runtimeProtocol: version, minimumPlayerVersion: version, playerVersion: input.playerVersion })
  if (version === 1) return verifyTtrpgCreatorPackageV1(input)
  assertBoundedJson(input.value, 'creator package')
  const pkg = parsePackage(input.value, 2)
  if (input.revokedKeyIds?.has(pkg.publisher.keyId)) fail('publisher key 已撤销')
  const expectedKeyId = `key.${(await hashCanonicalValue(pkg.publisher.publicKeyJwk)).slice(0, 32)}`
  if (pkg.publisher.keyId !== expectedKeyId) fail('publisher keyId 与公钥不一致')
  // Only the parsed original V2 payload participates in identity/signature.
  if (await hashCanonicalValue(pkg.payload) !== pkg.payloadHash) fail('payloadHash 校验失败')
  const publicKey = await crypto.subtle.importKey(
    'jwk', pkg.publisher.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
  )
  const { signature: _signature, ...unsigned } = pkg
  if (!await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromBase64Url(pkg.signature),
    new TextEncoder().encode(signingBody(unsigned)),
  )) fail('package signature 校验失败')
  await verifyCreatorCampaignIndexV2(pkg.payload.campaign)
  const fixtureReport = runRulePackFixturesV1(projectTtrpgRulePackMechanicalCoreV1(pkg.payload.rulePack))
  if (!fixtureReport.valid) fail('RulePack fixture 未通过')
  return { package: pkg, trustedPublisher: input.trustedKeyIds?.has(pkg.publisher.keyId) ?? false, fixtureReport }
}

export async function verifyTtrpgCreatorPackageAgainstTrustManifestVersionedV1(input:
  Parameters<typeof verifyTtrpgCreatorPackageAgainstTrustManifestV1>[0] & { playerVersion: 1 | 2 },
) {
  const trust = await verifyTtrpgCreatorTrustManifestV1({
    value: input.trustManifest, pinnedIssuerKeyIds: input.pinnedIssuerKeyIds,
    now: input.now, minimumSequence: input.minimumManifestSequence,
  })
  const verified = await verifyTtrpgCreatorPackageVersionedV1({
    value: input.value, playerVersion: input.playerVersion,
    revokedKeyIds: trust.revokedPublisherKeyIds, trustedKeyIds: trust.trustedPublisherKeyIds,
  })
  if (!verified.trustedPublisher) fail('publisher key 不在当前 trustManifest 允许列表中')
  const revoked = trust.manifest.revokedPackages.find(item =>
    item.effectiveAt <= input.now && item.packageId === verified.package.packageId
    && (item.packageVersion === null || item.packageVersion === verified.package.packageVersion)
    && (item.payloadHash === null || item.payloadHash === verified.package.payloadHash))
  if (revoked) fail(`creator package 已撤销:${revoked.reason}`)
  return { package: verified.package, fixtureReport: verified.fixtureReport, trustManifest: trust.manifest }
}

type CreatorLockInputV2 = Omit<Parameters<typeof createTtrpgCreatorDependencyLockV1>[0], 'rootPackageId' | 'rootPackageVersion'>
  & { playerVersion: 1 | 2 }

async function verifyProtocol2Packages(input: CreatorLockInputV2) {
  if (!Array.isArray(input.packages) || input.packages.length < 1 || input.packages.length > 256) {
    fail('dependencyLock.packages 必须包含 1..256 个包')
  }
  return Promise.all(input.packages.map(async value => {
    const verified = await verifyTtrpgCreatorPackageAgainstTrustManifestVersionedV1({ ...input, value })
    if (verified.package.version !== 2) fail('dependencyLock protocol2 不接受混合版本包')
    return { ...verified, package: verified.package }
  }))
}

function creatorLockEntries(packages: readonly TtrpgVersionedCreatorPackage[]): TtrpgCreatorDependencyLockV1['packages'] {
  return packages.map(pkg => ({
    packageId: pkg.packageId, packageVersion: pkg.packageVersion,
    payloadHash: pkg.payloadHash, publisherKeyId: pkg.publisher.keyId,
  })).sort((left, right) => left.packageId.localeCompare(right.packageId))
}

export async function createTtrpgCreatorDependencyLockV2(input: CreatorLockInputV2 & {
  rootPackageId: string
  rootPackageVersion: string
}): Promise<TtrpgCreatorDependencyLockV2> {
  const verified = await verifyProtocol2Packages(input)
  const base: Omit<TtrpgCreatorDependencyLockV2, 'lockHash'> = {
    schema: 'storyforge.creator-dependency-lock', version: 2, runtimeProtocol: 2,
    root: { packageId: stableKey(input.rootPackageId, 'rootPackageId'), packageVersion: semver(input.rootPackageVersion, 'rootPackageVersion') },
    packages: creatorLockEntries(verified.map(item => item.package)),
  }
  return parseDependencyLock({ ...base, lockHash: await hashCanonicalValue(base) }, 2)
}

export async function verifyTtrpgCreatorDependencyLockVersionedV1(input:
  Parameters<typeof verifyTtrpgCreatorDependencyLockV1>[0] & { playerVersion: 1 | 2 },
): Promise<{
  lock: TtrpgCreatorDependencyLockV1 | TtrpgCreatorDependencyLockV2
  packages: TtrpgVersionedCreatorPackage[]
  trustManifest: TtrpgCreatorTrustManifestV1
}> {
  if (record(input.value, 'dependencyLock').version === 1) {
    return verifyTtrpgCreatorDependencyLockV1(input)
  }
  assertTtrpgPlayerProtocolV1({ runtimeProtocol: 2, minimumPlayerVersion: 2, playerVersion: input.playerVersion })
  const lock = parseDependencyLock(input.value, 2)
  const { lockHash: _lockHash, ...base } = lock
  if (await hashCanonicalValue(base) !== lock.lockHash) fail('dependencyLock.lockHash 校验失败')
  const verified = await verifyProtocol2Packages(input)
  const entries = creatorLockEntries(verified.map(item => item.package))
  if (canonicalProductProductionJsonV2(entries) !== canonicalProductProductionJsonV2(lock.packages)) {
    fail('dependencyLock 与实际安装包集合不一致')
  }
  return { lock, packages: verified.map(item => item.package), trustManifest: verified[0].trustManifest }
}

/** No database writes and no runtime activation. V2 receipt explicitly forbids execution. */
export async function prepareTtrpgCreatorPackageInstallVersionedV1(input:
  Parameters<typeof prepareTtrpgCreatorPackageInstallV1>[0] & { playerVersion: 1 | 2 },
): Promise<
  | { package: TtrpgCreatorPackageV1; receipt: TtrpgCreatorInstallReceiptV1 }
  | { package: TtrpgCreatorPackageV2; receipt: TtrpgCreatorInstallReceiptV2 }
> {
  if (record(input.dependencyLock, 'dependencyLock').version === 1) {
    return prepareTtrpgCreatorPackageInstallV1(input)
  }
  const verified = await verifyTtrpgCreatorDependencyLockVersionedV1({ ...input, value: input.dependencyLock })
  const root = verified.packages.find(pkg => pkg.packageId === verified.lock.root.packageId
    && pkg.packageVersion === verified.lock.root.packageVersion) ?? fail('dependencyLock root package 缺失')
  if (root.version !== 2) fail('dependencyLock root protocol 不一致')
  return {
    package: structuredClone(root),
    receipt: {
      schema: 'storyforge.creator-install-receipt', version: 2, runtimeProtocol: 2, execution: 'unsupported',
      packageId: root.packageId, packageVersion: root.packageVersion,
      payloadHash: root.payloadHash, publisherKeyId: root.publisher.keyId,
      trustManifestHash: verified.trustManifest.manifestHash,
      trustManifestSequence: verified.trustManifest.sequence,
      dependencyLockHash: verified.lock.lockHash, verifiedAt: timestamp(input.now, 'now'),
      isolation: { mode: 'data-only', executableCode: false, permissions: [] },
    },
  }
}

export function assertTtrpgCreatorPackageExecutionAllowedV1(receipt: TtrpgCreatorInstallReceiptV1 | TtrpgCreatorInstallReceiptV2): void {
  if (receipt.version !== 1) fail('protocol2 仅支持验证/准备安装，尚不支持实际运行')
}
