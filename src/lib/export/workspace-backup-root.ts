import { isWorkCode, isWorkspaceUid } from '../memory/identity'
import { isCurrentWorldCode } from '../workspace/identity'
import { snapshotWorkspaceImportReviewJsonV1 } from './workspace-import-review'

export interface WorkspaceBackupRootV1 {
  readonly contractVersion: 1
  readonly worldExportId: number
  readonly workExportId: number
}

export interface WorkspaceBackupWorldOnlyRootV2 {
  readonly contractVersion: 2
  readonly kind: 'world-only'
  readonly worldExportId: number
  readonly workExportId: null
}

export type WorkspaceBackupRoot = WorkspaceBackupRootV1 | WorkspaceBackupWorldOnlyRootV2

function fail(message: string): never {
  throw new Error(`[workspace-backup-root] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  return value as Record<string, unknown>
}

function has(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function portableId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function sourceVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 14 || value > 21) fail('unsupported source backup version')
  return value
}

/** Closed wire root only; does not authorize restore or validate registered table rows. */
export function parseWorkspaceBackupRootV1(input: unknown, sourceBackupVersion: number): WorkspaceBackupRoot {
  const version = sourceVersion(sourceBackupVersion)
  const root = record(snapshotWorkspaceImportReviewJsonV1(input), 'ownership')
  const keys = root.contractVersion === 1
    ? ['contractVersion', 'worldExportId', 'workExportId']
    : ['contractVersion', 'kind', 'worldExportId', 'workExportId']
  if (Object.keys(root).length !== keys.length || keys.some(key => !has(root, key))) fail('unknown or missing root field')
  if (!portableId(root.worldExportId)) fail('invalid root World coordinate')
  if (root.contractVersion === 1 && portableId(root.workExportId)) {
    return Object.freeze({ contractVersion: 1, worldExportId: root.worldExportId, workExportId: root.workExportId })
  }
  if (version === 21 && root.contractVersion === 2 && root.kind === 'world-only' && root.workExportId === null) {
    return Object.freeze({ contractVersion: 2, kind: 'world-only', worldExportId: root.worldExportId, workExportId: null })
  }
  fail('invalid root contract or source version')
}

/** Source-format gate BEFORE any future normalization. Opaque historical strings stay opaque. */
function assertLegacySourceFormat(input: Record<string, unknown>, version: number): void {
  if (version === 21) return
  if (has(input, 'workspaceImportReceipts')) fail('legacy source contains v21 receipt table')
  if (!has(input, 'agentRuns')) return
  if (!Array.isArray(input.agentRuns)) fail('agentRuns must be an array')
  for (const value of input.agentRuns) {
    const row = record(value, 'agentRun')
    if (['_worldOwnerExportId', '_worldExportId', 'worldId', 'worldAuthoring'].some(key => has(row, key))) {
      fail('legacy source contains operative World run owner')
    }
    if (typeof row.contractJson !== 'string') fail('invalid operative run contract JSON')
    let parsed: unknown
    try { parsed = JSON.parse(row.contractJson) } catch { fail('invalid operative run contract JSON') }
    const contract = record(parsed, 'run contract')
    const scope = record(contract.scope, 'run contract scope')
    if (has(scope, 'worldAuthoring') || has(scope, 'worldId')) fail('legacy source contains World authoring scope')
  }
}

function rows(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  return value.map(row => record(row, label))
}

/**
 * Pure root selection over captured PORTABLE project/world/work rows. It validates
 * every captured root identity/parent, but is not a complete backup/table decoder.
 * No DB read, active-pointer fallback, normalization or v21 emission occurs here.
 */
export function selectCapturedWorkspaceBackupRootV1(input: unknown): WorkspaceBackupRoot {
  const captured = record(snapshotWorkspaceImportReviewJsonV1(input), 'captured backup roots')
  const version = sourceVersion(captured.version)
  assertLegacySourceFormat(captured, version)
  const project = record(captured.project, 'project')
  if (!isWorkspaceUid(project.workspaceUid)
    || (project.workspacePurpose !== 'world-engine' && project.workspacePurpose !== 'independent-work')) fail('invalid workspace root identity')
  const worlds = rows(captured.worlds, 'World')
  const works = rows(captured.works, 'Work')
  const byWorld = new Map<number, Record<string, unknown>>()
  const worldCodes = new Set<string>()
  for (const world of worlds) {
    if (!portableId(world._exportId) || byWorld.has(world._exportId)
      || (world.identityKind !== 'world-draft' && world.identityKind !== 'workspace-scope')
      || !isCurrentWorldCode(world.identityKind, world.code) || worldCodes.has(world.code)) fail('invalid or duplicate World root identity')
    byWorld.set(world._exportId, world)
    worldCodes.add(world.code)
  }
  const byWork = new Map<number, Record<string, unknown>>()
  const workCodes = new Set<string>()
  for (const work of works) {
    if (!portableId(work._exportId) || byWork.has(work._exportId) || !portableId(work._worldExportId)
      || !byWorld.has(work._worldExportId) || !isWorkCode(work.code) || workCodes.has(work.code)) fail('invalid or duplicate Work root identity/parent')
    byWork.set(work._exportId, work)
    workCodes.add(work.code)
  }
  const worldId = project._activeWorldExportId
  if (!portableId(worldId) || !byWorld.has(worldId)) fail('active World is missing or foreign')
  const world = byWorld.get(worldId)!
  if (world.identityKind !== (project.workspacePurpose === 'world-engine' ? 'world-draft' : 'workspace-scope')) fail('active World identity does not match workspace purpose')
  if (!has(project, '_activeWorkExportId')) fail('active Work pointer must be explicit')
  const workId = project._activeWorkExportId
  let selected: WorkspaceBackupRoot
  if (workId === null) {
    if (version !== 21 || project.workspacePurpose !== 'world-engine'
      || works.some(work => work._worldExportId === worldId)) fail('World-only root requires no Work in the selected World')
    selected = Object.freeze({ contractVersion: 2, kind: 'world-only', worldExportId: worldId, workExportId: null })
  } else {
    if (!portableId(workId) || byWork.get(workId)?._worldExportId !== worldId) fail('active Work is missing or foreign')
    selected = Object.freeze({ contractVersion: 1, worldExportId: worldId, workExportId: workId })
  }
  if (has(captured, 'ownership')) {
    const declared = parseWorkspaceBackupRootV1(captured.ownership, version)
    if (declared.contractVersion !== selected.contractVersion || declared.worldExportId !== selected.worldExportId
      || declared.workExportId !== selected.workExportId) fail('declared root differs from captured active roots')
  }
  return selected
}

/** Existing wire input must declare its root; a selector result cannot repair a missing root. */
export function parseCapturedWorkspaceBackupRootV1(input: unknown): WorkspaceBackupRoot {
  const captured = record(snapshotWorkspaceImportReviewJsonV1(input), 'backup')
  if (!has(captured, 'ownership')) fail('missing ownership root')
  return selectCapturedWorkspaceBackupRootV1(captured)
}
