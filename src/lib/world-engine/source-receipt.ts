import { db } from '../db/schema'
import type { World, WorldDerivationV1, WorldOwnerScope, WorldRelease, WorldSourceReceiptV1 } from '../types'
import { PROJECT_TABLES } from '../registry/project-tables'
import { canonicalStringify } from '../agent/run/hash'
import { resolveWorldOwnerScopeLike, scopeTransactionTables } from '../workspace/scope'
import { cacheFrozenWorldReleaseInTransactionV1 } from './reference-cache'
import { assertCapturedWorldSourceWireV1, captureWorldSourceWireV1, type CapturedWorldSourceWireV1 } from './world-package'
import { assertWorldSourceReceiptBindingV1, assertWorldSourceReceiptRowV1 } from './source-receipt-contract'
import { inspectCommunityWorldOriginV1 } from './source-declaration'
import type { VerifiedWorldReleaseV1 } from './release-codec'

type Row = Record<string, unknown>
type Rows = ReadonlyMap<string, readonly Row[]>
type Coordinate = 'local' | 'portable'
function captureOwner(scope: WorldOwnerScope): WorldOwnerScope {
  return { projectId: scope.projectId, worldId: scope.worldId }
}
function fail(message: string): never { throw Error(`[world-source-receipt] ${message}`) }
function record(value: unknown): value is Row { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function json(value: unknown): unknown {
  if (typeof value !== 'string') fail('缺少规范 JSON 来源字段')
  try { return JSON.parse(value) } catch { return fail('来源字段不是 JSON') }
}
function key(row: object, coordinate: Coordinate): unknown { return Reflect.get(row, coordinate === 'local' ? 'id' : '_exportId') }
function worldKey(row: object, coordinate: Coordinate): unknown { return Reflect.get(row, coordinate === 'local' ? 'worldId' : '_worldExportId') }
function hasOrigin(root: object): boolean { return Object.prototype.hasOwnProperty.call(root, 'communityOrigin') && Reflect.get(root, 'communityOrigin') !== undefined }
function copiedLineage(verified: VerifiedWorldReleaseV1): boolean {
  return verified.version === 4 && verified.manifest.sourceManifest.lineage?.kind === 'world-copy'
}
function assertFrozenCache(row: Row | WorldRelease, owner: unknown, coordinate: Coordinate, captured: CapturedWorldSourceWireV1): void {
  const source = captured.frozenRelease
  if (worldKey(row, coordinate) !== owner || row.releaseUid !== source.releaseUid
    || row.manifestJson !== source.manifestJson || row.contentHash !== source.contentHash
    || row.version !== source.version || row.sourceWorldCode !== source.sourceWorldCode) fail('回执与冻结 R 缓存/owner 不一致')
}
async function verifyReceipt(row: Row | WorldSourceReceiptV1, coordinate: Coordinate): Promise<CapturedWorldSourceWireV1> {
  assertWorldSourceReceiptRowV1(row, coordinate)
  const captured = await captureWorldSourceWireV1(row.wireJson)
  if (row.packageDigest !== captured.declaration.packageDigest || row.declarationHash !== captured.declaration.declarationHash
    || row.releaseUid !== captured.frozenRelease.releaseUid) fail('原 wire 与 P/R/D 派生索引不一致')
  return captured
}
function assertEditingBinding(row: Row | WorldDerivationV1, world: Row | World, captured: CapturedWorldSourceWireV1): void {
  assertWorldPackageEditingSourceV1(captured)
  assertWorldSourceReceiptBindingV1(row.sourceReceiptBinding)
  if (!record(row.sourceReceiptBinding) || row.sourceKind !== 'world-release-copy'
    || row.sourceReceiptBinding.declarationHash !== captured.declaration.declarationHash) fail('编辑起源没有精确绑定所选 D')
  const inspection = inspectCommunityWorldOriginV1(world.communityOrigin)
  if (inspection.status !== 'self-consistent'
    || canonicalStringify(inspection.declaration) !== canonicalStringify(captured.declaration)) fail('origin 历史快照与所选 receipt 不一致')
  const range = json(row.sourceRangeJson)
  if (!record(range) || Object.keys(range).length !== 2 || range.kind !== 'frozen-world-release'
    || range.releaseUid !== captured.frozenRelease.releaseUid || row.sourceContentHash !== captured.frozenRelease.contentHash
    || row.sourceWorkspaceUid !== captured.verified.manifest.sourceManifest.sourceWorkspaceUid
    || row.sourceWorkCode !== String(captured.verified.manifest.semanticSnapshot.works[0].code)) fail('编辑来源边与实际原 R 不一致')
  if (captured.verified.version === 3) {
    if (row.narrativeLineageJson !== undefined
      || canonicalStringify(json(row.sourceRevisionVectorJson)) !== canonicalStringify(captured.verified.manifest.sourceManifest)) fail('v3 起源必须保存真实冻结来源，不能捏造 v4 lineage')
  } else {
    const lineage = json(row.narrativeLineageJson)
    if (!record(lineage) || lineage.sourceReleaseUid !== captured.frozenRelease.releaseUid
      || lineage.sourceContentHash !== captured.frozenRelease.contentHash) fail('编辑 lineage 未绑定实际来源 R')
  }
}

/** Registry-selected preflight for both backup directions. All cryptography
 * consumes immutable captured rows outside IDB write transactions. */
export async function assertWorldSourceReceiptRowsV1(rows: Rows, coordinate: Coordinate): Promise<void> {
  const worlds = new Map((rows.get('worlds') ?? []).map(row => [key(row, coordinate), row]))
  const releases = new Map((rows.get('worldReleases') ?? []).map(row => [key(row, coordinate), row]))
  const verified = new Map<string, { row: Row; captured: CapturedWorldSourceWireV1 }>()
  for (const spec of PROJECT_TABLES.filter(item => item.portableData?.kind === 'world-source-receipt')) {
    for (const row of rows.get(spec.name) ?? []) {
      const captured = await verifyReceipt(row, coordinate), owner = worldKey(row, coordinate)
      const world = worlds.get(owner)
      if (!world || (coordinate === 'local' && row.projectId !== world.projectId)) fail('receipt owner 缺失或跨工作区')
      const identity = `${String(owner)}:${captured.declaration.declarationHash}`
      if (verified.has(identity)) fail('同 World 重复 D 回执')
      const locator = row[coordinate === 'local' ? 'worldReleaseId' : '_worldReleaseExportId']
      if (locator != null) {
        const release = releases.get(locator)
        if (!release || (coordinate === 'local' && release.projectId !== row.projectId)) fail('回执缓存 locator 缺失或跨工作区')
        assertFrozenCache(release, owner, coordinate, captured)
      }
      verified.set(identity, { row, captured })
    }
  }
  for (const spec of PROJECT_TABLES.filter(item => item.portableData?.kind === 'world-source-receipt-binding')) {
    const bindings = rows.get(spec.name) ?? []
    for (const row of bindings) {
      if (row.sourceReceiptBinding === undefined) continue // Legacy is not upgraded.
      assertWorldSourceReceiptBindingV1(row.sourceReceiptBinding)
      if (!record(row.sourceReceiptBinding)) fail('编辑绑定无效')
      const owner = worldKey(row, coordinate), world = worlds.get(owner)
      const found = verified.get(`${String(owner)}:${String(row.sourceReceiptBinding.declarationHash)}`)
      if (!world || !found || (coordinate === 'local' && (world.projectId !== row.projectId || found.row.projectId !== row.projectId))) fail('显式编辑绑定缺所选 receipt 或跨 owner')
      if (bindings.filter(item => worldKey(item, coordinate) === owner && item.sourceKind === 'world-release-copy').length !== 1) fail('编辑起源重复，不能选择第一条或最新 D')
      assertEditingBinding(row, world, found.captured)
    }
  }
}

/** No domain materialization, World identity changes, origin mirrors or product
 * authorization. The caller must not treat storage as a started product. */
export async function installCapturedWorldSourceInTransactionV1(scopeInput: WorldOwnerScope, captured: CapturedWorldSourceWireV1) {
  assertCapturedWorldSourceWireV1(captured)
  const scope = await resolveWorldOwnerScopeLike(captureOwner(scopeInput))
  const samePackage = await db.worldSourceReceipts.where('[worldId+packageDigest]')
    .equals([scope.worldId, captured.declaration.packageDigest]).toArray()
  for (const previous of samePackage) {
    assertWorldSourceReceiptRowV1(previous, 'local')
    if (previous.projectId !== scope.projectId || previous.declarationHash !== captured.declaration.declarationHash
      || previous.releaseUid !== captured.frozenRelease.releaseUid
      || canonicalStringify(json(previous.wireJson)) !== canonicalStringify(json(captured.wireJson))) fail('同 P 回执的原 wire/D/R 冲突')
  }
  const worldReleaseId = await cacheFrozenWorldReleaseInTransactionV1(scope, captured.frozenRelease)
  const existing = await db.worldSourceReceipts.where('[worldId+declarationHash]')
    .equals([scope.worldId, captured.declaration.declarationHash]).first()
  if (existing) {
    assertWorldSourceReceiptRowV1(existing, 'local')
    if (existing.projectId !== scope.projectId || existing.packageDigest !== captured.declaration.packageDigest
      || existing.releaseUid !== captured.frozenRelease.releaseUid
      || canonicalStringify(json(existing.wireJson)) !== canonicalStringify(json(captured.wireJson))) fail('同 D 回执损坏或与原规范 wire 冲突')
    if (existing.worldReleaseId !== null) {
      const cached = await db.worldReleases.get(existing.worldReleaseId)
      if (!cached || cached.projectId !== scope.projectId) fail('已有回执的缓存定位损坏')
      assertFrozenCache(cached, scope.worldId, 'local', captured)
    } else await db.worldSourceReceipts.update(existing.id!, { worldReleaseId })
    return { receiptId: existing.id!, worldReleaseId: existing.worldReleaseId ?? worldReleaseId, declarationHash: existing.declarationHash, releaseUid: existing.releaseUid, status: 'stored-unselected' as const }
  }
  const receiptId = await db.worldSourceReceipts.add({ ...scope, worldReleaseId, receiptVersion: 1,
    wireJson: captured.wireJson, packageDigest: captured.declaration.packageDigest,
    declarationHash: captured.declaration.declarationHash, releaseUid: captured.frozenRelease.releaseUid, importedAt: Date.now() })
  return { receiptId, worldReleaseId, declarationHash: captured.declaration.declarationHash,
    releaseUid: captured.frozenRelease.releaseUid, status: 'stored-unselected' as const }
}

export async function installWorldSourcePackageV1(scopeInput: WorldOwnerScope, input: unknown) {
  const selectedOwner = captureOwner(scopeInput)
  const captured = await captureWorldSourceWireV1(input)
  const scope = await resolveWorldOwnerScopeLike(selectedOwner)
  return db.transaction('rw', scopeTransactionTables(db.worldReleases, db.worldRevisions, db.worldSourceReceipts),
    () => installCapturedWorldSourceInTransactionV1(scope, captured))
}

export async function readWorldSourceReceiptV1(scopeInput: WorldOwnerScope, declarationHash: string) {
  const scope = await resolveWorldOwnerScopeLike(captureOwner(scopeInput))
  const row = await db.worldSourceReceipts.where('[worldId+declarationHash]').equals([scope.worldId, declarationHash]).first()
  if (!row || row.projectId !== scope.projectId) fail('所选 D 原 receipt 缺失；来源 unknown')
  const captured = await verifyReceipt(row, 'local')
  if (row.worldReleaseId !== null) {
    const cached = await db.worldReleases.get(row.worldReleaseId)
    if (!cached || cached.projectId !== scope.projectId) fail('所选 receipt 的冻结缓存损坏')
    assertFrozenCache(cached, scope.worldId, 'local', captured)
  }
  const current = await db.worldSourceReceipts.get(row.id!)
  await resolveWorldOwnerScopeLike(scope)
  if (canonicalStringify(current) !== canonicalStringify(row)) fail('所选来源在读取期间变化')
  return { row, captured }
}

export async function copyWorldSourceReceiptV1(targetInput: WorldOwnerScope, sourceInput: WorldOwnerScope, declarationHash: string) {
  const selectedTarget = captureOwner(targetInput), selectedSource = captureOwner(sourceInput)
  const target = await resolveWorldOwnerScopeLike(selectedTarget), source = await resolveWorldOwnerScopeLike(selectedSource)
  const evidence = await readWorldSourceReceiptV1(source, declarationHash)
  return db.transaction('rw', scopeTransactionTables(db.worldReleases, db.worldRevisions, db.worldSourceReceipts), async () => {
    await resolveWorldOwnerScopeLike(source)
    if (canonicalStringify(await db.worldSourceReceipts.get(evidence.row.id!)) !== canonicalStringify(evidence.row)) fail('复制期间所选来源变化')
    return installCapturedWorldSourceInTransactionV1(target, evidence.captured)
  })
}

/** Explicit variants, never releaseUid-only dedup or a merged permission set.
 * Existing R-only references remain unknown for a newly selected purpose. */
export async function listWorldSourceReceiptsV1(scopeInput: WorldOwnerScope) {
  const scope = await resolveWorldOwnerScopeLike(captureOwner(scopeInput))
  const rows = await db.worldSourceReceipts.where('worldId').equals(scope.worldId).toArray()
  const choices = []
  for (const row of rows) {
    const evidence = await readWorldSourceReceiptV1(scope, row.declarationHash)
    choices.push({ key: `${row.releaseUid}:${row.declarationHash}`, receiptId: row.id!, worldReleaseId: row.worldReleaseId,
      releaseUid: row.releaseUid, declarationHash: row.declarationHash, declaration: evidence.captured.declaration,
      releaseFormatVersion: evidence.captured.verified.version, status: 'verified-wire' as const })
  }
  return choices
}

/** Local original-wire export, not repackaging or a new redistribution grant. */
export async function exportOriginalWorldSourceWireV1(scope: WorldOwnerScope, declarationHash: string): Promise<string> {
  return (await readWorldSourceReceiptV1(scope, declarationHash)).row.wireJson
}

export async function resolveWorldEditingSourceV1(scopeInput: WorldOwnerScope) {
  const scope = await resolveWorldOwnerScopeLike(captureOwner(scopeInput))
  const bindings = (await db.worldDerivations.where('worldId').equals(scope.worldId).toArray())
    .filter(row => row.sourceKind === 'world-release-copy')
  if (bindings.length !== 1 || !bindings[0].sourceReceiptBinding) fail('编辑来源无唯一明确 D 绑定；unknown')
  const binding = bindings[0]
  if (binding.projectId !== scope.projectId) fail('编辑来源跨工作区')
  const evidence = await readWorldSourceReceiptV1(scope, binding.sourceReceiptBinding!.declarationHash)
  const world = await db.worlds.get(scope.worldId)
  if (!world) fail('编辑 World 已不存在')
  assertEditingBinding(binding, world, evidence.captured)
  return { ...evidence, binding, world }
}

export function assertWorldPackageEditingSourceV1(captured: CapturedWorldSourceWireV1): void {
  assertCapturedWorldSourceWireV1(captured)
  if (!captured.declaration.allowedUses['world-remix']) fail('world-remix=false，拒绝创建可编辑副本')
  const root = captured.verified.manifest.semanticSnapshot.worlds[0]
  if (hasOrigin(root) || copiedLineage(captured.verified)) fail('已知上游来源缺完整 wire/绑定链；旧格式不能新增编辑派生')
}

/** The existing public creation API must enforce this even when no UI runs.
 * A readonly cached R never proves inheritance by the author's unrelated R. */
export async function guardWorldPackageCreationV1(release: WorldRelease, verified: VerifiedWorldReleaseV1): Promise<() => Promise<void>> {
  const { readWorldPublicationAuthorityV1 } = await import('./publication-origin')
  const world = await db.worlds.get(release.worldId)
  if (!world || world.projectId !== release.projectId || world.identityKind !== 'world-draft'
    || world.code !== release.sourceWorldCode || verified.manifest.worldCode !== world.code) fail('不能将外来冻结缓存重新署名打包；请选择 D 导出原来源包')
  const authority = await readWorldPublicationAuthorityV1(release, verified)
  if (!authority.author) fail('外来冻结缓存或未知作者来源不能重新署名打包；请选择 D 导出原来源包')
  const derivations = await db.worldDerivations.where('worldId').equals(world.id!).toArray()
  const copies = derivations.filter(row => row.sourceKind === 'world-release-copy')
  const external = hasOrigin(world) || hasOrigin(verified.manifest.semanticSnapshot.worlds[0])
    || copiedLineage(verified) || copies.length > 0
  if (external) {
    if (copies.some(row => row.sourceReceiptBinding !== undefined)) {
      await resolveWorldEditingSourceV1({ projectId: release.projectId, worldId: release.worldId })
    }
    fail('外部来源或 unknown 不能经旧 v3/v4/v5 重包；请导出所选原 wire，或等待显式完整来源链新版')
  }
  const snapshot = canonicalStringify({ world, derivations, release })
  return async () => {
    const [currentWorld, currentDerivations, currentRelease] = await Promise.all([
      db.worlds.get(world.id!), db.worldDerivations.where('worldId').equals(world.id!).toArray(), db.worldReleases.get(release.id!),
    ])
    if (snapshot !== canonicalStringify({ world: currentWorld, derivations: currentDerivations, release: currentRelease })
      || authority.rows !== (await readWorldPublicationAuthorityV1(release, verified)).rows) fail('打包期间冻结版本或编辑来源变化；拒绝 stale 包')
  }
}
