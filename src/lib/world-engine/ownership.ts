import Dexie, { type Collection } from 'dexie'
import { db } from '../db/schema'
import {
  effectiveWorkspacePurpose,
  generateWorkspaceScopeCode,
  generateWorldCode,
  isShareableWorld,
} from '../product/world-identity'
import { generateWorkCode } from '../memory/identity'
import { PROJECT_TABLES } from '../registry/project-tables'
import { transactionTablesFor } from '../registry/lifecycle'
import type { TableSpec } from '../registry/types'
import {
  migrateGenre,
  type OwnershipBeforeImageRow,
  type OwnershipBeforeImageValue,
  type OwnershipMigrationReceipt,
  type Project,
  type Work,
  type WorkspaceScope,
  type World,
} from '../types'

export const WORKSPACE_OWNERSHIP_CONTRACT_VERSION = 1

/**
 * Native workspaces do not pass through the legacy migration, but scope
 * conversions still need one durable audit receipt. The missing
 * readyFingerprint intentionally keeps migration rollback unavailable for a
 * workspace that was born on the current ownership contract.
 */
export function nativeOwnershipReceipt(input: {
  projectId: number
  worldId: number
  workId: number
  workspaceUid: string
  createdAt: number
}): OwnershipMigrationReceipt {
  return {
    projectId: input.projectId,
    contractVersion: WORKSPACE_OWNERSHIP_CONTRACT_VERSION,
    status: 'ready',
    sourceFingerprint: `native:${input.workspaceUid}`,
    sourceCounts: { projects: 1, worlds: 1, works: 1 },
    defaultWorldId: input.worldId,
    defaultWorkId: input.workId,
    createdDefaultWorld: false,
    createdDefaultWork: false,
    projectBeforeImage: {},
    ownerBeforeImages: {},
    preparedAt: input.createdAt,
    completedAt: input.createdAt,
    updatedAt: input.createdAt,
  }
}

const PROJECT_MIRROR_FIELDS = [
  'activeWorldId',
  'activeWorkId',
  'ownershipSchemaVersion',
  'workspacePurpose',
  'workspacePurposeDecision',
  'worldCode',
  'worldVersion',
  'communityOrigin',
] as const

type CapturedValue = number | string | null | undefined

interface CapturedRow {
  key: number
  hadWorldId: boolean
  hadWorkId: boolean
  worldId?: number | null
  workId?: number | null
  references: Record<string, CapturedValue>
  fingerprintFields: Record<string, unknown>
}

interface WorkspaceState {
  project: Project
  rows: Map<string, CapturedRow[]>
  sourceCounts: Record<string, number>
  sourceFingerprint: string
}

interface OwnershipMigrationPlan {
  state: WorkspaceState
  existingWorldId: number | null
  existingWorkId: number | null
  createWorld: boolean
  createWork: boolean
  projectBeforeImage: Record<string, OwnershipBeforeImageValue>
  ownerBeforeImages: Record<string, OwnershipBeforeImageRow[]>
}

export interface WorkspaceOwnershipPreflight {
  projectId: number
  contractVersion: number
  status: 'ready' | 'migration-required'
  sourceFingerprint: string
  sourceCounts: Record<string, number>
  willCreateDefaultWorld: boolean
  willCreateDefaultWork: boolean
}

export interface WorkspaceOwnershipResolution {
  scope: WorkspaceScope
  project: Project
  world: World
  work: Work
  migrated: boolean
}

export class WorkspaceOwnershipError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'WorkspaceOwnershipError'
  }
}

const inFlightResolutions = new Map<number, Promise<WorkspaceOwnershipResolution>>()

function fail(code: string, message: string): never {
  throw new WorkspaceOwnershipError(code, message)
}

function hasOwn(row: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, field)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

function primaryKeyFor(spec: TableSpec, row: Record<string, unknown>): number {
  const keyPath = spec.table.schema.primKey.keyPath
  const key = typeof keyPath === 'string' ? row[keyPath] : row.id
  if (typeof key !== 'number') {
    fail('OWNERSHIP_UNSUPPORTED_PRIMARY_KEY', `${spec.name} 存在无法记录的非数字主键`)
  }
  return key
}

function indirectLinkField(spec: TableSpec): string | null {
  const ref = spec.refs?.find(candidate => candidate.kind === 'indirect')
  return ref?.kind === 'indirect' ? ref.via.field : null
}

function captureRow(spec: TableSpec, value: unknown): CapturedRow {
  const row = asRecord(value)
  const references: Record<string, CapturedValue> = {}
  for (const remap of spec.exportRemap ?? []) {
    const reference = row[remap.field]
    if (typeof reference === 'number' || typeof reference === 'string' || reference == null) {
      references[remap.field] = reference as CapturedValue
    }
  }

  const fingerprintFields: Record<string, unknown> = {}
  if (spec.name === 'worlds' || spec.name === 'works') {
    fingerprintFields.updatedAt = row.updatedAt
    fingerprintFields.projectId = row.projectId
    if (spec.name === 'works') fingerprintFields.worldId = row.worldId
  }

  return {
    key: primaryKeyFor(spec, row),
    hadWorldId: hasOwn(row, 'worldId'),
    hadWorkId: hasOwn(row, 'workId'),
    worldId: row.worldId as number | null | undefined,
    workId: row.workId as number | null | undefined,
    references,
    fingerprintFields,
  }
}

async function captureCollection(spec: TableSpec, collection: Collection): Promise<CapturedRow[]> {
  // Ownership already materializes the complete project snapshot to fingerprint it.
  // `Collection.each()` advances one IndexedDB cursor request per row and becomes
  // pathologically slow for thousand-scale semantic catalogs (notably in Safari
  // and fake-indexeddb). One bulk read preserves identical snapshot semantics while
  // avoiding an unbounded request chain.
  const rows = (await collection.toArray()).map(value => captureRow(spec, value))
  rows.sort((left, right) => left.key - right.key)
  return rows
}

async function captureRowsForSpec(spec: TableSpec, projectId: number): Promise<CapturedRow[]> {
  if (spec.name === 'projects') {
    const project = await db.projects.get(projectId)
    return project ? [captureRow(spec, project)] : []
  }

  if (spec.owner === 'project' || spec.owner === 'transient') {
    return captureCollection(spec, spec.table.where('projectId').equals(projectId))
  }

  if (spec.owner === 'direct-child' || spec.owner === 'indirect') {
    const parentKeys = await spec.projectResolver?.(projectId) ?? []
    const linkField = indirectLinkField(spec)
    if (!parentKeys.length || !linkField) return []
    return captureCollection(spec, spec.table.where(linkField).anyOf(parentKeys))
  }

  if (spec.owner === 'blob') {
    const sessionKeys = await db.importSessions.where('projectId').equals(projectId).primaryKeys()
    if (!sessionKeys.length) return []
    const keys = await spec.table.where(':id').anyOf(sessionKeys).primaryKeys()
    return keys.map(key => {
      if (typeof key !== 'number') {
        fail('OWNERSHIP_UNSUPPORTED_PRIMARY_KEY', `${spec.name} 存在无法记录的非数字主键`)
      }
      return {
        key,
        hadWorldId: false,
        hadWorkId: false,
        references: {},
        fingerprintFields: {},
      }
    }).sort((left, right) => left.key - right.key)
  }

  return []
}

function stableFingerprintPayload(project: Project, rows: Map<string, CapturedRow[]>): string {
  const tables = [...rows.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([table, tableRows]) => ({
      table,
      rows: tableRows.map(row => ({
        key: row.key,
        worldId: row.hadWorldId ? row.worldId ?? null : '__absent__',
        workId: row.hadWorkId ? row.workId ?? null : '__absent__',
        ...row.fingerprintFields,
      })),
    }))

  const projectFields = Object.fromEntries(PROJECT_MIRROR_FIELDS.map(field => [
    field,
    hasOwn(asRecord(project), field) ? asRecord(project)[field] ?? null : '__absent__',
  ]))
  return JSON.stringify({ projectId: project.id, projectFields, tables })
}

async function sha256(value: string): Promise<string> {
  const digestPromise = crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const digest = Dexie.currentTransaction
    ? await Dexie.waitFor(digestPromise)
    : await digestPromise
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function readWorkspaceState(projectId: number): Promise<WorkspaceState> {
  const project = await db.projects.get(projectId)
  if (!project) fail('OWNERSHIP_PROJECT_NOT_FOUND', `本地工作区 ${projectId} 不存在`)

  const rows = new Map<string, CapturedRow[]>()
  const sourceSpecs = PROJECT_TABLES.filter(
    spec => spec.owner !== 'global' && spec.name !== 'ownershipMigrations',
  )
  const captured = await Promise.all(sourceSpecs.map(async spec => [
    spec.name,
    await captureRowsForSpec(spec, projectId),
  ] as const))
  for (const [name, tableRows] of captured) rows.set(name, tableRows)
  const sourceCounts = Object.fromEntries([...rows.entries()].map(([name, tableRows]) => [name, tableRows.length]))
  const sourceFingerprint = await sha256(stableFingerprintPayload(project, rows))
  return { project, rows, sourceCounts, sourceFingerprint }
}

function rowsFor(state: WorkspaceState, table: string): CapturedRow[] {
  return state.rows.get(table) ?? []
}

function requiresLegacyOwnerStamp(spec: TableSpec): boolean {
  if (spec.name === 'worlds' || spec.name === 'works' || spec.name === 'workCharacterBindings') return false
  const locator = spec.domainOwner?.locator
  if (locator?.kind === 'parent') return false
  return spec.domainOwner?.legacyDefault === 'world' || spec.domainOwner?.legacyDefault === 'work'
}

async function validateExplicitReferences(state: WorkspaceState): Promise<void> {
  const missingByTarget = new Map<string, Set<number | string>>()
  const requiredByTarget = new Map<string, Set<number | string>>()
  const targetKeysByTable = new Map(
    [...state.rows.entries()].map(([name, tableRows]) => [name, new Set(tableRows.map(row => row.key))]),
  )

  for (const spec of PROJECT_TABLES) {
    for (const row of rowsFor(state, spec.name)) {
      for (const remap of spec.exportRemap ?? []) {
        const value = row.references[remap.field]
        if (value == null) continue
        const targetKeys = targetKeysByTable.get(remap.remapVia) ?? new Set<number>()
        if (targetKeys.has(value as number)) continue
        const bucket = missingByTarget.get(remap.remapVia) ?? new Set()
        bucket.add(value)
        missingByTarget.set(remap.remapVia, bucket)
        if (remap.onUnmapped === 'require') {
          const required = requiredByTarget.get(remap.remapVia) ?? new Set()
          required.add(value)
          requiredByTarget.set(remap.remapVia, required)
        }
      }
    }
  }

  for (const [targetName, values] of missingByTarget) {
    const target = PROJECT_TABLES.find(spec => spec.name === targetName)
    if (!target) fail('OWNERSHIP_REFERENCE_TARGET_UNKNOWN', `未登记的引用目标 ${targetName}`)
    const existing = await target.table.bulkGet([...values] as number[])
    if (existing.some(Boolean)) {
      fail('OWNERSHIP_CROSS_WORKSPACE_REFERENCE', `${targetName} 存在跨工作区引用`)
    }
    if (requiredByTarget.get(targetName)?.size) {
      fail('OWNERSHIP_REQUIRED_REFERENCE_MISSING', `${targetName} 存在缺失的必填引用`)
    }
  }
}

function assertNoUnknownOwners(state: WorkspaceState): void {
  for (const spec of PROJECT_TABLES) {
    if (!requiresLegacyOwnerStamp(spec)) continue
    for (const row of rowsFor(state, spec.name)) {
      if (row.worldId != null || row.workId != null) {
        fail('OWNERSHIP_UNKNOWN_OWNER', `${spec.name} 已存在无法确认来源的 owner 字段`)
      }
    }
  }
}

function assertKnownRoots(state: WorkspaceState): { worldId: number; workId: number } {
  const project = state.project
  if (project.ownershipSchemaVersion !== WORKSPACE_OWNERSHIP_CONTRACT_VERSION) {
    fail('OWNERSHIP_CONTRACT_NOT_READY', '工作区 ownership 合同尚未就绪')
  }
  if (project.activeWorldId == null || project.activeWorkId == null) {
    fail('OWNERSHIP_ACTIVE_SCOPE_MISSING', '工作区缺少当前 World/Work 指针')
  }

  const world = rowsFor(state, 'worlds').find(row => row.key === project.activeWorldId)
  const work = rowsFor(state, 'works').find(row => row.key === project.activeWorkId)
  if (!world || !work || work.worldId !== world.key) {
    fail('OWNERSHIP_ACTIVE_SCOPE_INVALID', '当前 World/Work 指针不属于同一工作区或绑定无效')
  }
  return { worldId: world.key, workId: work.key }
}

function buildBeforeImage(project: Project): Record<string, OwnershipBeforeImageValue> {
  const record = asRecord(project)
  return Object.fromEntries(PROJECT_MIRROR_FIELDS.map(field => [field, {
    present: hasOwn(record, field),
    ...(hasOwn(record, field) ? { value: record[field] } : {}),
  }]))
}

function buildOwnerBeforeImages(state: WorkspaceState): Record<string, OwnershipBeforeImageRow[]> {
  const result: Record<string, OwnershipBeforeImageRow[]> = {}
  for (const spec of PROJECT_TABLES) {
    if (!requiresLegacyOwnerStamp(spec)) continue
    const images = rowsFor(state, spec.name).map(row => ({
      id: row.key,
      hadWorldId: row.hadWorldId,
      hadWorkId: row.hadWorkId,
      ...(row.hadWorldId ? { worldId: row.worldId } : {}),
      ...(row.hadWorkId ? { workId: row.workId } : {}),
    }))
    if (images.length) result[spec.name] = images
  }
  return result
}

async function migrationPlan(projectId: number): Promise<OwnershipMigrationPlan | WorkspaceOwnershipResolution> {
  const state = await readWorkspaceState(projectId)
  if ((state.project.ownershipSchemaVersion ?? 0) > WORKSPACE_OWNERSHIP_CONTRACT_VERSION) {
    fail('OWNERSHIP_CONTRACT_NEWER', '工作区由更高版本的 StoryForge ownership 合同创建')
  }

  if (state.project.ownershipSchemaVersion === WORKSPACE_OWNERSHIP_CONTRACT_VERSION) {
    const roots = assertKnownRoots(state)
    return readReadyResolution(roots.worldId, roots.workId, false)
  }

  const receipt = await db.ownershipMigrations
    .where('[projectId+contractVersion]')
    .equals([projectId, WORKSPACE_OWNERSHIP_CONTRACT_VERSION])
    .first()
  if (receipt?.status === 'ready') {
    fail('OWNERSHIP_RECEIPT_CONFLICT', '迁移凭证已完成，但工作区指针未就绪')
  }
  if ((receipt?.status === 'prepared' || receipt?.status === 'failed')
    && receipt.sourceFingerprint !== state.sourceFingerprint) {
    fail('OWNERSHIP_SOURCE_CHANGED', '迁移准备后源记录发生变化，拒绝覆盖旧恢复证据')
  }

  await validateExplicitReferences(state)
  assertNoUnknownOwners(state)

  const worlds = rowsFor(state, 'worlds')
  const works = rowsFor(state, 'works')
  let existingWorldId: number | null = null
  let existingWorkId: number | null = null
  if (worlds.length || works.length) {
    if (state.project.activeWorldId == null || state.project.activeWorkId == null) {
      fail('OWNERSHIP_UNKNOWN_ROOTS', '旧工作区已有未登记的 World/Work 根')
    }
    const world = worlds.find(row => row.key === state.project.activeWorldId)
    const work = works.find(row => row.key === state.project.activeWorkId)
    if (!world || !work || work.worldId !== world.key) {
      fail('OWNERSHIP_UNKNOWN_ROOTS', '旧工作区的 World/Work 根与兼容指针不一致')
    }
    existingWorldId = world.key
    existingWorkId = work.key
  } else if (state.project.activeWorldId != null || state.project.activeWorkId != null) {
    fail('OWNERSHIP_DANGLING_ACTIVE_SCOPE', '工作区指针引用了不存在的 World/Work')
  }

  return {
    state,
    existingWorldId,
    existingWorkId,
    createWorld: existingWorldId == null,
    createWork: existingWorkId == null,
    projectBeforeImage: buildBeforeImage(state.project),
    ownerBeforeImages: buildOwnerBeforeImages(state),
  }
}

function isResolution(value: OwnershipMigrationPlan | WorkspaceOwnershipResolution): value is WorkspaceOwnershipResolution {
  return 'scope' in value
}

export async function preflightWorkspaceOwnership(projectId: number): Promise<WorkspaceOwnershipPreflight> {
  const result = await migrationPlan(projectId)
  if (isResolution(result)) {
    const state = await readWorkspaceState(projectId)
    return {
      projectId,
      contractVersion: WORKSPACE_OWNERSHIP_CONTRACT_VERSION,
      status: 'ready',
      sourceFingerprint: state.sourceFingerprint,
      sourceCounts: state.sourceCounts,
      willCreateDefaultWorld: false,
      willCreateDefaultWork: false,
    }
  }
  return {
    projectId,
    contractVersion: WORKSPACE_OWNERSHIP_CONTRACT_VERSION,
    status: 'migration-required',
    sourceFingerprint: result.state.sourceFingerprint,
    sourceCounts: result.state.sourceCounts,
    willCreateDefaultWorld: result.createWorld,
    willCreateDefaultWork: result.createWork,
  }
}

async function persistPreparedReceipt(plan: OwnershipMigrationPlan): Promise<number> {
  const projectId = plan.state.project.id!
  const now = Date.now()
  return db.transaction('rw', db.ownershipMigrations, async () => {
    const existing = await db.ownershipMigrations
      .where('[projectId+contractVersion]')
      .equals([projectId, WORKSPACE_OWNERSHIP_CONTRACT_VERSION])
      .first()
    if (existing?.status === 'ready') return existing.id!
    if ((existing?.status === 'prepared' || existing?.status === 'failed')
      && existing.sourceFingerprint !== plan.state.sourceFingerprint) {
      fail('OWNERSHIP_SOURCE_CHANGED', '迁移源指纹与已保存的恢复证据不一致')
    }

    const receipt: OwnershipMigrationReceipt = {
      ...existing,
      projectId,
      contractVersion: WORKSPACE_OWNERSHIP_CONTRACT_VERSION,
      status: 'prepared',
      sourceFingerprint: plan.state.sourceFingerprint,
      sourceCounts: plan.state.sourceCounts,
      projectBeforeImage: plan.projectBeforeImage,
      ownerBeforeImages: plan.ownerBeforeImages,
      errorCode: undefined,
      preparedAt: existing?.preparedAt ?? now,
      updatedAt: now,
    }
    return await db.ownershipMigrations.put(receipt) as number
  })
}

async function allocateWorldRootCode(project: Project, shareable: boolean): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = shareable
      ? (attempt === 0 && project.worldCode ? project.worldCode : generateWorldCode())
      : generateWorkspaceScopeCode()
    const collision = await db.worlds.where('code').equals(code).first()
    if (!collision || collision.projectId === project.id) return code
  }
  fail('OWNERSHIP_WORLD_CODE_COLLISION', '无法分配唯一的世界编号')
}

async function stampLegacyOwners(plan: OwnershipMigrationPlan, worldId: number, workId: number): Promise<void> {
  for (const spec of PROJECT_TABLES) {
    if (!requiresLegacyOwnerStamp(spec)) continue
    const domain = spec.domainOwner
    if (!domain) continue
    const images = plan.ownerBeforeImages[spec.name] ?? []
    if (!images.length) continue
    const changes = domain.legacyDefault === 'world'
      ? { worldId }
      : { workId, ...(domain.allowed.includes('world') ? { worldId: null } : {}) }
    for (const image of images) await spec.table.update(image.id, changes)
  }
}

function assertCountsUnchanged(
  before: Record<string, number>,
  after: Record<string, number>,
  createdWorld: boolean,
  createdWork: boolean,
): void {
  for (const [table, count] of Object.entries(before)) {
    const expected = count
      + (table === 'worlds' && createdWorld ? 1 : 0)
      + (table === 'works' && createdWork ? 1 : 0)
    if (after[table] !== expected) {
      fail('OWNERSHIP_COUNT_CHANGED', `${table} 在迁移事务内出现了意外计数变化`)
    }
  }
}

function assertStampedOwners(state: WorkspaceState, worldId: number, workId: number): void {
  for (const spec of PROJECT_TABLES) {
    if (!requiresLegacyOwnerStamp(spec)) continue
    const domain = spec.domainOwner
    if (!domain) continue
    for (const row of rowsFor(state, spec.name)) {
      const actual = domain.legacyDefault === 'world' ? row.worldId : row.workId
      const expected = domain.legacyDefault === 'world' ? worldId : workId
      if (actual !== expected) fail('OWNERSHIP_STAMP_INVALID', `${spec.name} owner 盖章不完整`)
      if (domain.allowed.includes('world') && domain.allowed.includes('work')
        && row.worldId != null && row.workId != null) {
        fail('OWNERSHIP_EXCLUSIVE_OWNER_INVALID', `${spec.name} 同时绑定了 World 和 Work`)
      }
    }
  }
}

async function readReadyResolution(
  worldId: number,
  workId: number,
  migrated: boolean,
): Promise<WorkspaceOwnershipResolution> {
  const [world, work] = await Promise.all([db.worlds.get(worldId), db.works.get(workId)])
  if (!world || !work || work.worldId !== world.id || work.projectId !== world.projectId) {
    fail('OWNERSHIP_ACTIVE_SCOPE_INVALID', '当前 World/Work 不存在或不属于同一工作区')
  }
  const project = await db.projects.get(world.projectId)
  if (!project || project.activeWorldId !== worldId || project.activeWorkId !== workId) {
    fail('OWNERSHIP_ACTIVE_SCOPE_INVALID', '工作区兼容指针与 World/Work 不一致')
  }
  if (isShareableWorld(world)
    && (project.worldCode !== world.code || project.worldVersion !== world.currentVersion)) {
    fail('OWNERSHIP_WORLD_MIRROR_INVALID', '工作区世界编号/版本镜像与当前 World 不一致')
  }
  return { scope: { projectId: world.projectId, worldId, workId }, project, world, work, migrated }
}

async function markReceiptFailed(projectId: number, error: unknown): Promise<void> {
  const errorCode = error instanceof WorkspaceOwnershipError ? error.code : 'OWNERSHIP_MIGRATION_FAILED'
  await db.transaction('rw', db.ownershipMigrations, async () => {
    const receipt = await db.ownershipMigrations
      .where('[projectId+contractVersion]')
      .equals([projectId, WORKSPACE_OWNERSHIP_CONTRACT_VERSION])
      .first()
    if (receipt && receipt.status !== 'ready') {
      await db.ownershipMigrations.update(receipt.id!, { status: 'failed', errorCode, updatedAt: Date.now() })
    }
  })
}

async function runOwnershipMigration(plan: OwnershipMigrationPlan, receiptId: number): Promise<WorkspaceOwnershipResolution> {
  const projectId = plan.state.project.id!
  try {
    return await db.transaction('rw', transactionTablesFor('deleteProject'), async () => {
      const latest = await db.projects.get(projectId)
      if (!latest) fail('OWNERSHIP_PROJECT_NOT_FOUND', `本地工作区 ${projectId} 不存在`)
      if (latest.ownershipSchemaVersion === WORKSPACE_OWNERSHIP_CONTRACT_VERSION) {
        const latestState = await readWorkspaceState(projectId)
        const roots = assertKnownRoots(latestState)
        return readReadyResolution(roots.worldId, roots.workId, false)
      }

      const current = await readWorkspaceState(projectId)
      if (current.sourceFingerprint !== plan.state.sourceFingerprint) {
        fail('OWNERSHIP_SOURCE_CHANGED', '迁移开始前源记录发生变化')
      }

      const normalized = migrateGenre(latest)
      const workspacePurpose = effectiveWorkspacePurpose(normalized)
      const workspacePurposeDecision = normalized.workspacePurposeDecision ?? 'legacy-review-required'
      const identityKind = workspacePurpose === 'world-engine'
        && workspacePurposeDecision !== 'legacy-review-required'
        ? 'world-draft'
        : 'workspace-scope'
      const now = Date.now()
      const existingWorld = plan.existingWorldId == null ? undefined : await db.worlds.get(plan.existingWorldId)
      if (plan.existingWorldId != null && !existingWorld) {
        fail('OWNERSHIP_UNKNOWN_ROOTS', '迁移准备阶段登记的 World 已不存在')
      }
      const worldCode = existingWorld?.code ?? await allocateWorldRootCode(normalized, identityKind === 'world-draft')
      const worldVersion = existingWorld?.currentVersion ?? (identityKind === 'world-draft' ? normalized.worldVersion ?? 0 : 0)
      const worldId = plan.existingWorldId ?? await db.worlds.add({
        projectId,
        identityKind,
        code: worldCode,
        name: normalized.name,
        description: normalized.description,
        currentVersion: worldVersion,
        communityOrigin: normalized.communityOrigin,
        createdAt: normalized.createdAt ?? now,
        updatedAt: normalized.updatedAt ?? now,
      }) as number
      if (existingWorld && existingWorld.identityKind !== identityKind) {
        await db.worlds.update(existingWorld.id!, { identityKind, updatedAt: now })
      }
      const workId = plan.existingWorkId ?? await db.works.add({
        projectId,
        worldId,
        code: generateWorkCode(),
        title: normalized.name,
        description: normalized.description,
        genres: normalized.genres,
        status: normalized.status,
        targetWordCount: normalized.targetWordCount,
        currentWordCount: normalized.currentWordCount,
        coverImage: normalized.coverImage,
        writingStyleId: normalized.writingStyleId,
        methodologyId: normalized.methodologyId,
        activeCharacterDrivenPlanId: normalized.activeCharacterDrivenPlanId,
        postAdoptionPolicy: 'suggest',
        postAdoptionTaskTypes: ['organization', 'memory', 'retrieval', 'consistency'],
        postAdoptionBudget: {
          maxModelCalls: 2,
          maxInputTokens: 48_000,
          maxOutputTokens: 16_000,
          maxCostUsd: 0.25,
          allowUnknownCost: false,
        },
        createdAt: normalized.createdAt ?? now,
        updatedAt: normalized.updatedAt ?? now,
      }) as number

      await stampLegacyOwners(plan, worldId, workId)
      await db.projects.update(projectId, {
        workspaceUid: normalized.workspaceUid,
        activeWorldId: worldId,
        activeWorkId: workId,
        ownershipSchemaVersion: WORKSPACE_OWNERSHIP_CONTRACT_VERSION,
        workspacePurpose,
        workspacePurposeDecision,
        worldCode: identityKind === 'world-draft' ? worldCode : undefined,
        worldVersion: identityKind === 'world-draft' ? worldVersion : undefined,
      })

      const readyState = await readWorkspaceState(projectId)
      assertCountsUnchanged(plan.state.sourceCounts, readyState.sourceCounts, plan.createWorld, plan.createWork)
      assertStampedOwners(readyState, worldId, workId)
      await validateExplicitReferences(readyState)
      const readyFingerprint = readyState.sourceFingerprint
      await db.ownershipMigrations.update(receiptId, {
        status: 'ready',
        defaultWorldId: worldId,
        defaultWorkId: workId,
        createdDefaultWorld: plan.createWorld,
        createdDefaultWork: plan.createWork,
        readyFingerprint,
        completedAt: now,
        errorCode: undefined,
        updatedAt: now,
      })
      return readReadyResolution(worldId, workId, true)
    })
  } catch (error) {
    await markReceiptFailed(projectId, error)
    throw error
  }
}

async function ensureWorkspaceOwnershipInternal(projectId: number): Promise<WorkspaceOwnershipResolution> {
  const plan = await migrationPlan(projectId)
  if (isResolution(plan)) return plan
  const receiptId = await persistPreparedReceipt(plan)
  return runOwnershipMigration(plan, receiptId)
}

/** First-entry compatibility resolver. Repeated calls for a ready workspace perform no writes. */
export function ensureWorkspaceOwnership(projectId: number): Promise<WorkspaceOwnershipResolution> {
  const existing = inFlightResolutions.get(projectId)
  if (existing) return existing
  const pending = ensureWorkspaceOwnershipInternal(projectId)
    .finally(() => inFlightResolutions.delete(projectId))
  inFlightResolutions.set(projectId, pending)
  return pending
}

/** The only resolver for legacy routes that carry only projectId. */
export async function resolveWorkspaceScope(projectId: number): Promise<WorkspaceScope> {
  return (await ensureWorkspaceOwnership(projectId)).scope
}

/**
 * Resolve only an ownership contract that already exists. This path is safe for
 * read-only tools: it never creates roots, stamps rows, or writes a migration
 * receipt. A null result means the workspace is still a completely legacy,
 * single-work project; partial ownership state fails closed because its owner
 * cannot be inferred safely.
 */
export async function resolveExistingWorkspaceScope(projectId: number): Promise<WorkspaceScope | null> {
  const project = await db.projects.get(projectId)
  // Context assembly also supports in-memory prompt projects and deliberate
  // cross-project probes. Write boundaries still reject a missing project root.
  if (!project) return null

  if (
    project.ownershipSchemaVersion === WORKSPACE_OWNERSHIP_CONTRACT_VERSION
    && project.activeWorldId != null
    && project.activeWorkId != null
  ) {
    const [world, work] = await Promise.all([
      db.worlds.get(project.activeWorldId),
      db.works.get(project.activeWorkId),
    ])
    if (
      !world
      || !work
      || world.projectId !== projectId
      || work.projectId !== projectId
      || work.worldId !== world.id
    ) {
      fail('OWNERSHIP_ACTIVE_SCOPE_INVALID', '已登记的 World/Work 不属于同一工作区')
    }
    return { projectId, worldId: world.id!, workId: work.id! }
  }

  const hasPartialPointers = project.ownershipSchemaVersion != null
    || project.activeWorldId != null
    || project.activeWorkId != null
  const [worldCount, workCount] = await Promise.all([
    db.worlds.where('projectId').equals(projectId).count(),
    db.works.where('projectId').equals(projectId).count(),
  ])
  if (!hasPartialPointers && worldCount === 0 && workCount === 0) return null

  fail('OWNERSHIP_PARTIAL_STATE', '工作区存在不完整的 World/Work 归属，只读入口已拒绝猜测')
}

function restoreChanges(beforeImage: Record<string, OwnershipBeforeImageValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(beforeImage).map(([field, before]) => [
    field,
    before.present ? before.value : undefined,
  ]))
}

export async function rollbackWorkspaceOwnership(projectId: number): Promise<void> {
  await db.transaction('rw', transactionTablesFor('deleteProject'), async () => {
    const receipt = await db.ownershipMigrations
      .where('[projectId+contractVersion]')
      .equals([projectId, WORKSPACE_OWNERSHIP_CONTRACT_VERSION])
      .first()
    if (!receipt || receipt.status !== 'ready' || !receipt.readyFingerprint) {
      fail('OWNERSHIP_ROLLBACK_NOT_READY', '没有可回滚的已完成迁移')
    }

    const current = await readWorkspaceState(projectId)
    if (current.sourceFingerprint !== receipt.readyFingerprint) {
      fail('OWNERSHIP_ROLLBACK_DIVERGED', '迁移后已经新增记录、修改作用域或变更默认根，自动回滚已拒绝')
    }

    for (const [tableName, images] of Object.entries(receipt.ownerBeforeImages)) {
      const spec = PROJECT_TABLES.find(candidate => candidate.name === tableName)
      if (!spec) fail('OWNERSHIP_ROLLBACK_TABLE_UNKNOWN', `恢复凭证引用了未知表 ${tableName}`)
      for (const image of images) {
        await spec.table.update(image.id, {
          worldId: image.hadWorldId ? image.worldId : undefined,
          workId: image.hadWorkId ? image.workId : undefined,
        })
      }
    }

    if (receipt.createdDefaultWork && receipt.defaultWorkId != null) {
      await db.works.delete(receipt.defaultWorkId)
    }
    if (receipt.createdDefaultWorld && receipt.defaultWorldId != null) {
      await db.worlds.delete(receipt.defaultWorldId)
    }
    await db.projects.update(projectId, restoreChanges(receipt.projectBeforeImage) as Partial<Project>)
    await db.ownershipMigrations.update(receipt.id!, {
      status: 'rolled-back',
      updatedAt: Date.now(),
    })
  })
}

export function isWorkspaceOwnershipReady(project: Project): boolean {
  return project.ownershipSchemaVersion === WORKSPACE_OWNERSHIP_CONTRACT_VERSION
    && project.activeWorldId != null
    && project.activeWorkId != null
}
