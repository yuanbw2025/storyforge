import {
  applyProductRuntimeEvent,
  hashProductRuntimeStateV1,
  parseProductRuntimeState,
} from '../product/runtime-core'
import { createProductBuildCompatibilityReportV1 } from '../product-production/compatibility'
import { hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import type {
  ProductRelease,
  ProductReleaseManifestV1,
  ProductRuntimeEvent,
  ProductRuntimeSession,
} from '../types'

export const TEXT_OPEN_WORLD_SAVE_MIGRATION_PLAN_SCHEMA_V1 =
  'storyforge.text-open-world-save-migration-plan' as const

export interface TextOpenWorldSaveMigrationPlanV1 {
  schema: typeof TEXT_OPEN_WORLD_SAVE_MIGRATION_PLAN_SCHEMA_V1
  version: 1
  productInstanceKey: string
  source: {
    releaseUid: string
    releaseHash: string
    releaseVersion: number
    packageHash: string
    throughSequence: number
    stateHash: string
  }
  target: {
    releaseUid: string
    releaseHash: string
    releaseVersion: number
    packageHash: string
    migratedStateHash: string
  }
  policy: {
    directCompatibleChildOnly: true
    sourceEventsCopied: false
    originalSessionMutated: false
    originalReleaseMutated: false
    compatibilityReportHash: string
  }
}

export interface TextOpenWorldSaveMigrationCanonV1 extends TextOpenWorldSaveMigrationPlanV1 {
  previewHash: string
}

type ReleasedSessionV1 = Pick<
  ProductRuntimeSession,
  | 'kind'
  | 'runtimeSourceHash'
  | 'canonSnapshotJson'
  | 'initialStateJson'
  | 'parentThroughSequence'
>

type ReleaseRootV1 = Pick<
  ProductRelease,
  'productionKey' | 'productType' | 'version' | 'contentHash'
>

function fail(message: string): never {
  throw new Error(`[text-open-world-save-migration-contract] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label}字段集合无效`)
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 2_000) {
    fail(`${label}无效`)
  }
  return value
}

function hash(value: unknown, label: string): string {
  if (!isSha256Hash(value)) fail(`${label}无效`)
  return value
}

function integer(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(`${label}无效`)
  return value as number
}

function parsePlan(value: unknown): TextOpenWorldSaveMigrationPlanV1 {
  const row = record(value, '迁移计划')
  exactKeys(row, ['schema', 'version', 'productInstanceKey', 'source', 'target', 'policy'], '迁移计划')
  if (row.schema !== TEXT_OPEN_WORLD_SAVE_MIGRATION_PLAN_SCHEMA_V1 || row.version !== 1) {
    fail('迁移计划身份无效')
  }
  const source = record(row.source, 'source')
  exactKeys(source, [
    'releaseUid', 'releaseHash', 'releaseVersion', 'packageHash', 'throughSequence', 'stateHash',
  ], 'source')
  const target = record(row.target, 'target')
  exactKeys(target, [
    'releaseUid', 'releaseHash', 'releaseVersion', 'packageHash', 'migratedStateHash',
  ], 'target')
  const policy = record(row.policy, 'policy')
  exactKeys(policy, [
    'directCompatibleChildOnly', 'sourceEventsCopied', 'originalSessionMutated',
    'originalReleaseMutated', 'compatibilityReportHash',
  ], 'policy')
  if (policy.directCompatibleChildOnly !== true
    || policy.sourceEventsCopied !== false
    || policy.originalSessionMutated !== false
    || policy.originalReleaseMutated !== false) {
    fail('迁移策略无效')
  }
  const parsed: TextOpenWorldSaveMigrationPlanV1 = {
    schema: TEXT_OPEN_WORLD_SAVE_MIGRATION_PLAN_SCHEMA_V1,
    version: 1,
    productInstanceKey: text(row.productInstanceKey, 'productInstanceKey'),
    source: {
      releaseUid: text(source.releaseUid, 'source.releaseUid'),
      releaseHash: hash(source.releaseHash, 'source.releaseHash'),
      releaseVersion: integer(source.releaseVersion, 'source.releaseVersion', 1),
      packageHash: hash(source.packageHash, 'source.packageHash'),
      throughSequence: integer(source.throughSequence, 'source.throughSequence', 0),
      stateHash: hash(source.stateHash, 'source.stateHash'),
    },
    target: {
      releaseUid: text(target.releaseUid, 'target.releaseUid'),
      releaseHash: hash(target.releaseHash, 'target.releaseHash'),
      releaseVersion: integer(target.releaseVersion, 'target.releaseVersion', 1),
      packageHash: hash(target.packageHash, 'target.packageHash'),
      migratedStateHash: hash(target.migratedStateHash, 'target.migratedStateHash'),
    },
    policy: {
      directCompatibleChildOnly: true,
      sourceEventsCopied: false,
      originalSessionMutated: false,
      originalReleaseMutated: false,
      compatibilityReportHash: hash(policy.compatibilityReportHash, 'policy.compatibilityReportHash'),
    },
  }
  if (parsed.target.releaseVersion <= parsed.source.releaseVersion) fail('目标版本顺序无效')
  return parsed
}

export async function parseTextOpenWorldSaveMigrationCanonV1(
  value: unknown,
): Promise<TextOpenWorldSaveMigrationCanonV1> {
  const migration = record(value, 'migration')
  exactKeys(migration, [
    'schema', 'version', 'productInstanceKey', 'source', 'target', 'policy', 'previewHash',
  ], 'migration')
  const { previewHash: previewHashValue, ...planValue } = migration
  const plan = parsePlan(planValue)
  const previewHash = hash(previewHashValue, 'previewHash')
  if (await hashProductProductionValueV2(plan) !== previewHash) fail('previewHash不匹配')
  return { ...plan, previewHash }
}

/** Replays the exact local branch prefix used when a migration was created. */
export async function replayTextOpenWorldMigrationSourceStateHashV1(input: {
  session: Pick<ProductRuntimeSession, 'initialStateJson'>
  events: readonly ProductRuntimeEvent[]
  throughSequence: number
}): Promise<string> {
  if (!Number.isSafeInteger(input.throughSequence) || input.throughSequence < 0) {
    fail('父分支序号无效')
  }
  let state = parseProductRuntimeState(input.session.initialStateJson)
  const events = [...input.events]
    .filter(event => event.sequence <= input.throughSequence)
    .sort((left, right) => left.sequence - right.sequence)
  if (events.length !== input.throughSequence
    || events.some((event, index) => event.sequence !== index + 1)) {
    fail('父分支事件前缀不完整')
  }
  for (const event of events) state = applyProductRuntimeEvent(state, event)
  if (state.lastSequence !== input.throughSequence) fail('父分支状态序号不一致')
  return hashProductRuntimeStateV1(state)
}

/**
 * Cross-Release parent/child branches are legal only for the G5-11 migration
 * protocol. Every portable coordinate is rebound to the two immutable Release
 * manifests and the actual branch state; ordinary branches keep the stricter
 * same-source rule in the caller.
 */
export async function verifyTextOpenWorldSaveMigrationBranchV1(input: {
  parentSession: ReleasedSessionV1
  childSession: ReleasedSessionV1
  parentRelease: ReleaseRootV1
  childRelease: ReleaseRootV1
  parentManifest: ProductReleaseManifestV1
  childManifest: ProductReleaseManifestV1
  sourceStateHash: string
}): Promise<TextOpenWorldSaveMigrationCanonV1> {
  if (input.parentSession.kind !== 'text-open-world'
    || input.childSession.kind !== 'text-open-world'
    || input.childSession.parentThroughSequence == null) {
    fail('只接受文字开放世界迁移子分支')
  }
  let canon: Record<string, unknown>
  try { canon = record(JSON.parse(input.childSession.canonSnapshotJson), 'canon') }
  catch { fail('子分支Canon不是合法JSON') }
  const migration = await parseTextOpenWorldSaveMigrationCanonV1(canon.migration)
  const sourceLineage = input.parentManifest.lineage
  const targetLineage = input.childManifest.lineage
  const targetParent = targetLineage.parentRelease
  if (input.parentRelease.productType !== 'text-open-world'
    || input.childRelease.productType !== 'text-open-world'
    || input.parentRelease.productionKey !== input.childRelease.productionKey
    || input.parentRelease.productionKey !== migration.productInstanceKey
    || input.parentManifest.productType !== 'text-open-world'
    || input.childManifest.productType !== 'text-open-world'
    || input.parentManifest.productionProvenance.productionKey !== migration.productInstanceKey
    || input.childManifest.productionProvenance.productionKey !== migration.productInstanceKey
    || input.parentRelease.version !== migration.source.releaseVersion
    || input.childRelease.version !== migration.target.releaseVersion
    || sourceLineage.releaseVersion !== input.parentRelease.version
    || targetLineage.releaseVersion !== input.childRelease.version
    || sourceLineage.releaseUid !== migration.source.releaseUid
    || sourceLineage.releaseHash !== migration.source.releaseHash
    || input.parentManifest.releaseIdentityHash !== migration.source.releaseHash
    || input.parentManifest.packageHash !== migration.source.packageHash
    || targetLineage.releaseUid !== migration.target.releaseUid
    || targetLineage.releaseHash !== migration.target.releaseHash
    || input.childManifest.releaseIdentityHash !== migration.target.releaseHash
    || input.childManifest.packageHash !== migration.target.packageHash
    || targetParent?.releaseUid !== sourceLineage.releaseUid
    || targetParent.releaseHash !== sourceLineage.releaseHash
    || input.parentSession.runtimeSourceHash !== migration.source.packageHash
    || input.childSession.runtimeSourceHash !== migration.target.packageHash
    || input.childSession.parentThroughSequence !== migration.source.throughSequence
    || input.sourceStateHash !== migration.source.stateHash) {
    fail('Session、Release与迁移坐标不闭合')
  }
  if (canon.schema !== 'storyforge.product-runtime-source'
    || canon.version !== 1
    || canon.productType !== 'text-open-world'
    || canon.runtimeSourceHash !== input.childManifest.packageHash
    || canon.sourceWorldContentHash !== input.childManifest.runtimePackage.sourceWorld.contentHash) {
    fail('子分支Canon与目标Release不一致')
  }
  const childState = parseProductRuntimeState(input.childSession.initialStateJson)
  if (childState.lastSequence !== 0
    || await hashProductRuntimeStateV1(childState) !== migration.target.migratedStateHash) {
    fail('迁移后的初始状态Hash不匹配')
  }
  const compatibility = await createProductBuildCompatibilityReportV1({
    previous: {
      buildNumber: input.parentManifest.productionProvenance.buildNumber,
      packageHash: input.parentManifest.packageHash,
      runtimePackage: input.parentManifest.runtimePackage,
    },
    current: {
      buildNumber: input.childManifest.productionProvenance.buildNumber,
      packageHash: input.childManifest.packageHash,
      runtimePackage: input.childManifest.runtimePackage,
    },
  })
  if (compatibility.level !== 'compatible'
    || compatibility.reportHash !== migration.policy.compatibilityReportHash) {
    fail('兼容报告不匹配')
  }
  return migration
}
