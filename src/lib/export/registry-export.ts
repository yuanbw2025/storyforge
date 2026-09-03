/**
 * 注册表派生的项目导出引擎(AUDIT-1)
 *
 * 取代 json-export.ts 中 580 行手写枚举:遍历 PROJECT_TABLES 中 exportable 的表,
 * 按其元数据(worldScoped / tree / exportRemap / exportIdField / exportRefRemap)自动
 * 把库内记录转成可移植的 ProjectExportData——加新表只需在注册表登记一行,自动进出导出。
 *
 * 产物与旧手写版**逐字段等价**(R-export-derive-equivalence 锁死),故旧备份格式、Gist
 * 云存档全部兼容。
 */
import Dexie from 'dexie'
import { db } from '../db/schema'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from '../registry/project-tables'
import { remapWorldPortalTargets } from '../utils/world-portals'
import type { TableSpec } from '../registry/types'
import type { ProjectExportData } from './json-export'
import { redactAuthoringSecrets } from '../node-authoring/contracts'
import { ensureWorkspaceOwnership } from '../workspace/ownership'
import { portableizeAgentRunLedgerExportV1 } from '../agent/run/ledger-portability'
import { assertAgentRunArtifactRecordIntegrityV1 } from '../memory/artifact-record'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'

/** 旧 fixture 等价导出版本；仅供兼容测试和无 ownership 的空项目使用。 */
const EXPORT_VERSION = 3
/** v10 adds the closed upper-product production/runtime graph contract. */
export const STRICT_EXPORT_VERSION = 10

export interface StrictProjectExportSnapshot {
  data: ProjectExportData
  exportIds: ReadonlyMap<string, ReadonlyMap<number, number>>
}

/** 取一张 exportable 表的库内记录(项目级按 projectId;direct-child 经 projectResolver) */
async function queryRows(spec: TableSpec, projectId: number): Promise<any[]> {
  if (spec.owner === 'project') {
    const coll = (db as any)[spec.name].where('projectId').equals(projectId)
    return spec.exportOrderBy ? await coll.sortBy(spec.exportOrderBy) : await coll.toArray()
  }
  // direct-child / indirect:用 projectResolver 拿父键,再用关联字段 anyOf 查
  if (!spec.projectResolver) return []
  const parentIds = await spec.projectResolver(projectId)
  if (!parentIds.length) return []
  const linkRemap = (spec.exportRemap ?? []).find(rm => REGISTRY_BY_NAME.get(rm.remapVia)?.owner === 'project')
  if (!linkRemap) return []
  return await (db as any)[spec.name].where(linkRemap.field).anyOf(parentIds).toArray()
}

/** 把一行库记录转成导出对象(剥 id/projectId、外键→导出序号、写 _exportId、JSON 引用重映射) */
function toExportRow(
  spec: TableSpec,
  row: any,
  index: number,
  idMaps: Map<string, Map<number, number>>,
  strictOwners = false,
): any | null {
  const obj: any = { ...row }
  delete obj.id
  if ('projectId' in obj) delete obj.projectId

  for (const rm of spec.exportRemap ?? []) {
    const val = obj[rm.field]
    delete obj[rm.field]
    const targetMap = rm.selfTree ? idMaps.get(spec.name) : idMaps.get(rm.remapVia)
    let mapped: number | null = null
    if (val != null) {
      const got = targetMap?.get(val)
      mapped = got ?? null
      if (got == null && rm.onUnmapped === 'drop') return null // 孤儿行丢弃
    }
    obj[rm.exportAs] = mapped
  }

  if (spec.exportIdField) obj._exportId = index

  for (const rr of spec.exportRefRemap ?? []) {
    if (rr.kind === 'portals') {
      const map = idMaps.get(rr.remapVia)
      obj[rr.field] = remapWorldPortalTargets(obj[rr.field], (targetId: number) => map?.get(targetId))
    } else if (rr.kind === 'id-array') {
      const map = idMaps.get(rr.remapVia)
      const raw = parseIdArray(obj[rr.field])
      obj[rr.exportAs] = raw.map(id => map?.get(id)).filter((id): id is number => id != null)
      // v4 is a portable contract: the shadow indexes are authoritative and
      // local numeric IDs must not leak into or destabilize a later restore.
      if (strictOwners) delete obj[rr.field]
    } else if (rr.kind === 'scene-character-ids') {
      const map = idMaps.get(rr.remapVia)
      obj[rr.exportAs] = Array.isArray(obj[rr.field])
        ? obj[rr.field].map((scene: any) => Array.isArray(scene?.characterIds)
          ? scene.characterIds.map((id: unknown) => typeof id === 'number' ? map?.get(id) : undefined).filter((id: unknown): id is number => typeof id === 'number')
          : [])
        : []
    } else if (rr.kind === 'object-array-id') {
      const map = idMaps.get(rr.remapVia)
      const items = parseObjectArray(obj[rr.field])
      obj[rr.exportAs] = items.map(item => {
        const id = item[rr.itemField]
        return typeof id === 'number' ? (map?.get(id) ?? null) : null
      })
      if (strictOwners) {
        const sanitized = items.map(item => rr.itemField in item ? { ...item, [rr.itemField]: null } : item)
        obj[rr.field] = rr.storage === 'json-string' ? JSON.stringify(sanitized) : sanitized
      }
    } else if (rr.kind === 'json-id-paths') {
      obj[rr.exportAs] = remapJsonIdPathsForExport(
        obj[rr.field],
        rr.paths,
        idMaps.get(rr.remapVia),
        rr.onUnmapped === 'require',
        `${spec.name}.${rr.field}`,
      )
      // The portable shadow is authoritative. Never leak embedded local IDs
      // into either ordinary or strict backups.
      delete obj[rr.field]
    }
  }

  if (strictOwners && spec.name !== 'worlds' && spec.name !== 'works') {
    const locator = spec.domainOwner?.locator
    if (locator?.kind === 'field' && (locator.owner === 'world' || locator.owner === 'work')) {
      const ownerMap = idMaps.get(locator.owner === 'world' ? 'worlds' : 'works')
      const portableId = ownerMap?.get(row[locator.field])
      if (portableId == null) throw new Error(`[strictExport] ${spec.name}.${locator.field} 缺失或越界`)
      obj[locator.owner === 'world' ? '_worldOwnerExportId' : '_workOwnerExportId'] = portableId
      delete obj.worldId
      delete obj.workId
    } else if (locator?.kind === 'exclusive-fields') {
      const hasWorld = row[locator.worldField] != null
      const hasWork = row[locator.workField] != null
      if (hasWorld === hasWork) throw new Error(`[strictExport] ${spec.name} 必须且只能有一个 owner`)
      const kind = hasWorld ? 'world' : 'work'
      const portableId = idMaps.get(kind === 'world' ? 'worlds' : 'works')
        ?.get(row[hasWorld ? locator.worldField : locator.workField])
      if (portableId == null) throw new Error(`[strictExport] ${spec.name} owner 缺失或越界`)
      obj[kind === 'world' ? '_worldOwnerExportId' : '_workOwnerExportId'] = portableId
      delete obj.worldId
      delete obj.workId
    } else if (locator?.kind === 'exclusive-work-instance') {
      const hasWork = row[locator.workField] != null
      const hasInstance = row[locator.instanceField] != null
      if (hasWork === hasInstance) throw new Error(`[strictExport] ${spec.name} 必须且只能有一个 Work/Instance owner`)
      if (hasWork) {
        const portableId = idMaps.get('works')?.get(row[locator.workField])
        if (portableId == null) throw new Error(`[strictExport] ${spec.name} Work owner 缺失或越界`)
        obj._workOwnerExportId = portableId
      } else if (!Number.isInteger(obj._productRuntimeSessionExportId)) {
        throw new Error(`[strictExport] ${spec.name} Instance owner 缺失或越界`)
      } else {
        obj._instanceOwnerExportId = obj._productRuntimeSessionExportId
      }
      delete obj[locator.workField]
      delete obj[locator.instanceField]
    }
  }

  return spec.name === 'nodeFlows' || spec.name === 'nodeRuns'
    ? redactAuthoringSecrets(obj)
    : obj
}

function remapJsonIdPathsForExport(
  value: unknown,
  paths: readonly string[],
  idMap: Map<number, number> | undefined,
  required: boolean,
  label: string,
): string | null {
  if (value == null) return null
  let parsed: unknown
  try { parsed = typeof value === 'string' ? JSON.parse(value) : structuredClone(value) } catch {
    throw new Error(`[deriveExport] ${label} 不是合法 JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`[deriveExport] ${label} 必须是 JSON 对象`)
  }
  for (const path of paths) {
    const parts = path.split('.').filter(Boolean)
    let owner = parsed as Record<string, unknown>
    for (const part of parts.slice(0, -1)) {
      const child = owner[part]
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        if (required) throw new Error(`[deriveExport] ${label}.${path} 缺失`)
        owner = {}
        break
      }
      owner = child as Record<string, unknown>
    }
    const field = parts[parts.length - 1]
    if (!field) continue
    const localId = owner[field]
    if (localId == null) { owner[field] = null; continue }
    const portableId = typeof localId === 'number' ? idMap?.get(localId) : undefined
    if (portableId == null && required) throw new Error(`[deriveExport] ${label}.${path} 缺少便携映射`)
    owner[field] = portableId ?? null
  }
  return JSON.stringify(parsed)
}

function parseObjectArray(value: unknown): Array<Record<string, unknown>> {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { return [] }
  }
  return Array.isArray(parsed)
    ? parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    : []
}

function parseIdArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.filter((id): id is number => typeof id === 'number')
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : []
  } catch {
    return []
  }
}

/**
 * 派生导出:产出与手写 exportProjectJSON 逐字段等价的 ProjectExportData。
 */
export async function deriveExportProjectJSON(
  projectId: number,
  options: { strict?: boolean } = {},
): Promise<ProjectExportData> {
  return options.strict
    ? deriveStrictExportProjectJSON(projectId)
    : deriveProjectExport(projectId, EXPORT_VERSION, false)
}

async function captureProjectExportInTransaction(
  projectId: number,
  version: number,
  strictOwners: boolean,
): Promise<StrictProjectExportSnapshot> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('项目不存在')

  const specs = PROJECT_TABLES.filter(s => s.exportable && s.name !== 'projects')

  // 第一遍:查询每张表 + 建 dbId → 导出序号 映射
  const rowsByTable = new Map<string, any[]>()
  const idMaps = new Map<string, Map<number, number>>()
  // Schedule every registered read before awaiting. With 100+ tables, a
  // sequential chain can leave IndexedDB without a pending request between
  // empty-table resolutions and let the browser auto-commit the snapshot.
  const capturedRows = await Promise.all(specs.map(async spec => ({
    spec,
    rows: await queryRows(spec, projectId),
  })))
  for (const { spec, rows } of capturedRows) {
    rowsByTable.set(spec.name, rows)
    const idMap = new Map<number, number>()
    rows.forEach((r, i) => { if (r.id != null) idMap.set(r.id, i) })
    idMaps.set(spec.name, idMap)
  }

  // 第二遍:逐行转导出对象
  const projectSpec = REGISTRY_BY_NAME.get('projects')
  if (!projectSpec) throw new Error('[deriveExport] PROJECT_TABLES 缺少 projects 根表')
  const projectData = toExportRow(projectSpec, project, 0, idMaps, strictOwners)
  const result: any = {
    version,
    exportedAt: Date.now(),
    project: projectData,
  }
  for (const spec of specs) {
    const rows = rowsByTable.get(spec.name)!
    const out: any[] = []
    rows.forEach((row, i) => {
      const exported = toExportRow(spec, row, i, idMaps, strictOwners)
      if (exported != null) out.push(exported)
    })
    result[spec.name] = out
  }

  return { data: result as ProjectExportData, exportIds: idMaps }
}

async function captureProjectExport(projectId: number, version: number, strictOwners: boolean): Promise<StrictProjectExportSnapshot> {
  const tables = [...new Set(PROJECT_TABLES.filter(spec => spec.exportable).map(spec => spec.table))]
  return db.transaction('r', tables, () => captureProjectExportInTransaction(projectId, version, strictOwners))
}

async function deriveProjectExport(projectId: number, version: number, strictOwners: boolean): Promise<ProjectExportData> {
  const captured = await captureProjectExport(projectId, version, strictOwners)
  // Binary materialization (Blob/OPFS/crypto) is intentionally outside the
  // read snapshot transaction. Dexie's promise zone can otherwise preserve a
  // just-finished transaction into this continuation and report a premature
  // commit when an external storage promise is awaited.
  const result = await Dexie.ignoreTransaction(() => portableizeSnapshot(captured))
  return result.data
}

async function portableizeSnapshot(snapshot: StrictProjectExportSnapshot): Promise<StrictProjectExportSnapshot> {
  if (PROJECT_TABLES.some(spec => spec.portableData?.kind === 'agent-run-root')) {
    const portableLedger = portableizeAgentRunLedgerExportV1(snapshot.data, snapshot.exportIds)
    if (Dexie.currentTransaction) await Dexie.waitFor(portableLedger)
    else await portableLedger
  }
  const portable = snapshot.data as unknown as Record<string, unknown>
  for (const spec of PROJECT_TABLES) {
    if (spec.portableData?.kind === 'exact-run-artifact') {
      const rows = portable[spec.name]
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        await assertAgentRunArtifactRecordIntegrityV1(row as any, { requireProjectId: false })
      }
      continue
    }
    if (spec.portableData?.kind !== 'binary-blob' && spec.portableData?.kind !== 'shared-media-object') continue
    const rows = portable[spec.name]
    if (!Array.isArray(rows)) continue
    for (const row of rows as Array<Record<string, unknown>>) {
      const portableData: NonNullable<TableSpec['portableData']> = spec.portableData
      const dataField = portableData.kind === 'binary-blob' ? portableData.field : portableData.dataField
      const value = row[dataField]
      const blobLike = value as { arrayBuffer?: () => Promise<ArrayBuffer>; type?: string } | null
      let buffer = value instanceof ArrayBuffer
        ? value
        : ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer
          : blobLike && typeof blobLike.arrayBuffer === 'function'
            ? (Dexie.currentTransaction ? await Dexie.waitFor(blobLike.arrayBuffer()) : await blobLike.arrayBuffer())
            : null
      if (!buffer && portableData.kind === 'shared-media-object') {
        const read = readVerifiedMediaBlobObjectData(
          row as unknown as import('../types').MediaBlobObjectRecordV1,
        )
        buffer = Dexie.currentTransaction ? await Dexie.waitFor(read) : await read
      }
      if (!buffer && portableData.kind === 'binary-blob'
        && portableData.allowMissingWhen && row[portableData.allowMissingWhen.exportField] != null) {
        row[dataField] = null
        continue
      }
      if (!buffer) throw new Error(`[deriveExport] ${spec.name}.${dataField} 不是便携二进制`)

      let mimeType = blobLike?.type || 'application/octet-stream'
      if (portableData.kind === 'shared-media-object') {
        if (row[portableData.stateField] !== 'ready') {
          throw new Error(`[deriveExport] ${spec.name} 只允许导出 ready 共享媒资`)
        }
        if (row[portableData.sizeField] !== buffer.byteLength) {
          throw new Error(`[deriveExport] ${spec.name} 二进制大小与记录不一致`)
        }
        const digestPromise = crypto.subtle.digest('SHA-256', buffer)
        const digest = Dexie.currentTransaction ? await Dexie.waitFor(digestPromise) : await digestPromise
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
        if (row[portableData.hashField] !== hash) {
          throw new Error(`[deriveExport] ${spec.name} 二进制哈希与记录不一致`)
        }
        const declaredMime = row[portableData.mimeField]
        if (typeof declaredMime !== 'string' || !declaredMime.trim()) {
          throw new Error(`[deriveExport] ${spec.name} 缺少 MIME 类型`)
        }
        mimeType = declaredMime
        row[portableData.backendField] = 'indexeddb'
        row[portableData.pathField] = null
        row[portableData.leaseOwnerField] = null
        row[portableData.leaseExpiresAtField] = null
      }
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      }
      row[dataField] = `data:${mimeType};base64,${btoa(binary)}`
    }
  }
  return snapshot
}

/**
 * WORLD-2C C4 strict export. The v3 derivation remains available for old
 * fixture equivalence tests, while all user-facing backups use this boundary.
 * Logical World/Work ownership is represented only by portable shadow IDs;
 * physical IDs never cross the backup boundary.
 */
export async function deriveStrictExportProjectJSON(projectId: number): Promise<ProjectExportData> {
  return (await deriveStrictExportProjectSnapshot(projectId)).data
}

export async function deriveStrictExportProjectSnapshot(projectId: number): Promise<StrictProjectExportSnapshot> {
  const existingWorlds = await db.worlds.where('projectId').equals(projectId).count()
  const existingWorks = await db.works.where('projectId').equals(projectId).count()
  if (existingWorlds === 0 && existingWorks === 0) {
    // Preserve the zero-data backup contract: there is no ownership to
    // migrate, so an empty workspace remains a compact v3-compatible file.
    return captureProjectExport(projectId, EXPORT_VERSION, false)
  }
  const ownership = await ensureWorkspaceOwnership(projectId)
  const captured = await captureProjectExport(projectId, STRICT_EXPORT_VERSION, true)
  const snapshot = await Dexie.ignoreTransaction(() => portableizeSnapshot(captured))
  const worldExportId = snapshot.exportIds.get('worlds')?.get(ownership.scope.worldId)
  const workExportId = snapshot.exportIds.get('works')?.get(ownership.scope.workId)
  if (worldExportId == null || workExportId == null) throw new Error('[strictExport] ownership 根不在导出快照中')
  snapshot.data.ownership = {
    contractVersion: 1,
    worldExportId,
    workExportId,
  }
  // Keep the ownership resolver observable to callers and make an accidental
  // unused migration result impossible to hide in diagnostics.
  if (!ownership.scope.worldId || !ownership.scope.workId) throw new Error('[strictExport] ownership 根不完整')
  return snapshot
}

/**
 * Capture a strict portable snapshot inside a caller-owned Dexie transaction.
 * World-release freezing uses this boundary so the source rows and release
 * manifest are observed atomically instead of nesting another transaction.
 */
export async function deriveStrictExportProjectSnapshotInCurrentTransaction(
  projectId: number,
  ownership: { worldId: number; workId: number },
): Promise<StrictProjectExportSnapshot> {
  if (!Dexie.currentTransaction) {
    throw new Error('[strictExport] 当前事务快照只能在已打开的 Dexie 事务中派生')
  }
  const snapshot = await portableizeSnapshot(
    await captureProjectExportInTransaction(projectId, STRICT_EXPORT_VERSION, true),
  )
  const worldExportId = snapshot.exportIds.get('worlds')?.get(ownership.worldId)
  const workExportId = snapshot.exportIds.get('works')?.get(ownership.workId)
  if (worldExportId == null || workExportId == null) {
    throw new Error('[strictExport] 当前事务的 ownership 根不在导出快照中')
  }
  snapshot.data.ownership = { contractVersion: 1, worldExportId, workExportId }
  return snapshot
}
